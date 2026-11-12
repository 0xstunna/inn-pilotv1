/**
 * POST /api/ai/concierge — the guest-facing AI gateway.
 *
 * HTTP concerns only: method, CORS, rate limit, input validation, status
 * codes. The core turn processing lives in server/ai/conciergeTurn.ts,
 * shared with the WhatsApp webhook so the AI gateway is not duplicated.
 *
 * This endpoint takes no login, by design: a guest has no account. What
 * protects it is everything else — an in-memory rate limit, a validated and
 * length-capped payload, a server-held API key the browser never sees, tools
 * that only reach the conversation's one hotel, and a booking that
 * needs a confirmed summary (DECISIONS D27).
 *
 * `publicHotelId` scopes the conversation to exactly one hotel. A workspace
 * hotelId is never accepted and never sent back (D2, D14).
 */
import { enforceRateLimit } from "../../server/ai/rateLimit.js";
import { processGuestTurn, type ProcessGuestTurnInput } from "../../server/ai/conciergeTurn.js";
import { isTurnId } from "../../server/conversations.js";
import {
  AiInvalidRequestError,
  errorMessage,
  guestMessageFor,
  isAiError,
  isRateLimitError,
} from "../../server/ai/errors.js";
import {
  applyCors,
  clientKey,
  handlePreflight,
  newRequestId,
  readJsonBody,
  requireMethod,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../../server/ai/http.js";
import { readNumber } from "../../server/ai/config.js";
import type {
  AiMessage,
  ConciergeAvailability,
  ConciergeBooking,
  ConciergeQuote,
  ConciergeReply,
} from "../../server/ai/types.js";

const env = process.env;

/** Generous for a person typing, restrictive for a script. */
const RATE_LIMIT = {
  limit: readNumber(env, "CONCIERGE_RATE_LIMIT", 12, { min: 1, max: 1000 }),
  windowMs: readNumber(env, "CONCIERGE_RATE_WINDOW_MS", 60_000, { min: 1_000, max: 3_600_000 }),
};

const MAX_MESSAGE_CHARS = 2_000;
/** Turns of history accepted from the client, newest kept. */
export const MAX_HISTORY_TURNS = 8;
/** Total characters of history sent to the model — keeps the free plan's token budget in check. */
export const MAX_HISTORY_CHARS = 6_000;

function requireMessage(body: Record<string, unknown>): string {
  const value = body.message;
  if (typeof value !== "string" || !value.trim()) {
    throw new AiInvalidRequestError(
      "'message' is required.",
      "I didn't catch that — could you type your question again?",
    );
  }
  if (value.length > MAX_MESSAGE_CHARS) {
    throw new AiInvalidRequestError(
      `'message' exceeds ${MAX_MESSAGE_CHARS} characters.`,
      "That message is a bit long for me. Could you shorten it?",
    );
  }
  return value.trim();
}

/**
 * The client's transcript, sanitised.
 *
 * Anything here is untrusted: a caller can forge an "assistant" turn. That is
 * tolerable for conversational context and no more — every fact comes from a
 * tool that re-reads the hotels' data, and a booking needs a summary the
 * SERVER recorded in an earlier turn, so a forged turn can't book or price
 * anything. Malformed turns are skipped rather than rejected.
 */
export function readHistory(body: Record<string, unknown>): AiMessage[] {
  if (!Array.isArray(body.history)) return [];

  const turns: AiMessage[] = [];
  for (const entry of body.history) {
    if (!entry || typeof entry !== "object") continue;
    const { role, content } = entry as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || !content.trim()) continue;
    turns.push({ role, content: content.slice(0, MAX_MESSAGE_CHARS) });
  }
  // Newest turns first within the char budget.
  let totalChars = 0;
  const kept: AiMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    if (kept.length >= MAX_HISTORY_TURNS) break;
    const turn = turns[i];
    if (totalChars + turn.content.length > MAX_HISTORY_CHARS && kept.length > 0) break;
    kept.unshift(turn);
    totalChars += turn.content.length;
  }
  return kept;
}

/* ------------------------------------------------------------------ */
/* What crosses to the browser                                        */
/* ------------------------------------------------------------------ */

/*
 * Allow-lists: only the named fields cross to the browser, so a field added to
 * a tool result later (say, guidance for the model) is never published by
 * accident.
 */

function pickAvailability(result: Record<string, unknown>): ConciergeAvailability {
  const types = result.roomTypes as ConciergeAvailability["roomTypes"];
  return {
    hotel: String(result.hotel),
    hotelName: String(result.hotelName),
    city: String(result.city ?? ""),
    checkIn: String(result.checkIn),
    checkOut: String(result.checkOut),
    nights: Number(result.nights),
    currency: String(result.currency),
    totalAvailable: Number(result.totalAvailable),
    roomTypes: types.map((type) => ({
      roomType: String(type.roomType),
      availableRooms: Number(type.availableRooms),
      capacity: typeof type.capacity === "number" ? type.capacity : null,
      nightlyRate: Number(type.nightlyRate),
      stayTotal: Number(type.stayTotal),
    })),
  };
}

function pickQuote(summary: ConciergeQuote): ConciergeQuote {
  return {
    hotel: String(summary.hotel),
    hotelName: String(summary.hotelName),
    city: String(summary.city ?? ""),
    roomType: String(summary.roomType),
    checkIn: String(summary.checkIn),
    checkOut: String(summary.checkOut),
    nights: Number(summary.nights),
    numberOfGuests: Number(summary.numberOfGuests),
    guestName: String(summary.guestName),
    guestPhone: String(summary.guestPhone),
    guestEmail: String(summary.guestEmail ?? ""),
    nightlyRate: Number(summary.nightlyRate),
    totalPrice: Number(summary.totalPrice),
    currency: String(summary.currency),
  };
}

function pickBooking(booking: ConciergeBooking): ConciergeBooking {
  return {
    reservationId: String(booking.reservationId),
    hotel: String(booking.hotel),
    hotelName: String(booking.hotelName),
    city: String(booking.city ?? ""),
    hotelPhone: String(booking.hotelPhone ?? ""),
    hotelEmail: String(booking.hotelEmail ?? ""),
    roomType: String(booking.roomType),
    checkIn: String(booking.checkIn),
    checkOut: String(booking.checkOut),
    nights: Number(booking.nights),
    numberOfGuests: Number(booking.numberOfGuests),
    guestName: String(booking.guestName),
    nightlyRate: Number(booking.nightlyRate),
    totalPrice: Number(booking.totalPrice),
    currency: String(booking.currency),
    paymentStatus: String(booking.paymentStatus),
  };
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "POST")) return;

  const requestId = newRequestId();
  const startedAt = Date.now();

  try {
    enforceRateLimit(`concierge:${clientKey(req)}`, RATE_LIMIT);

    const body = await readJsonBody(req);
    if (!body) {
      throw new AiInvalidRequestError(
        "Request body must be a JSON object.",
        "I couldn't send that. Send it again.",
      );
    }
    if ("hotelId" in body) {
      // The workspace key never travels in a guest request (D14).
      throw new AiInvalidRequestError(
        "'hotelId' is not accepted; use 'publicHotelId' or nothing.",
        "I'm not sure which hotel this chat belongs to. Please reopen it from the hotel's page.",
      );
    }

    const message = requireMessage(body);
    const turnId = isTurnId(body.turnId) ? body.turnId : undefined;
    const history = readHistory(body);

    const input: ProcessGuestTurnInput = {
      message,
      publicHotelId: body.publicHotelId as string | undefined,
      conversationId: typeof body.conversationId === "string" ? body.conversationId : undefined,
      turnId,
      history,
      channel: "web",
    };

    const output = await processGuestTurn(input);

    const reply: ConciergeReply = {
      reply: output.reply,
      model: output.model,
      requestId: output.requestId,
      conversationId: output.conversationId,
      handledBy: output.handledBy,
      ...(output.availability ? {
        availability: pickAvailability(output.availability as unknown as Record<string, unknown>),
      } : {}),
      ...(output.quote ? { quote: pickQuote(output.quote) } : {}),
      ...(output.booking ? { booking: pickBooking(output.booking) } : {}),
      ...(output.guestRequest ? { guestRequest: output.guestRequest } : {}),
    };

    console.info("[concierge] ok", {
      requestId,
      scopedPublicHotelId: body.publicHotelId,
      conversationId: output.conversationId,
      model: output.model,
      ...(output.booking ? { reservationId: output.booking.reservationId } : {}),
    });

    sendJson(res, 200, reply);
  } catch (error) {
    // Guests get `guestMessage`; operators get the detail, in the log only.
    console.error("[concierge] failed", {
      requestId,
      code: isAiError(error) ? error.code : "unexpected",
      detail: errorMessage(error),
      timing: { totalMs: Date.now() - startedAt },
    });

    const status = isAiError(error) ? error.status : 500;
    if (isRateLimitError(error)) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    sendJson(res, status, {
      error: guestMessageFor(error),
      code: isAiError(error) ? error.code : "unexpected",
      requestId,
    });
  }
}

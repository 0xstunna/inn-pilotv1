/**
 * processGuestTurn — shared concierge turn processing.
 *
 * Used by both the web AI Concierge endpoint (api/ai/concierge.ts) and the
 * WhatsApp webhook (api/ai/webhook/whatsapp.ts). Contains no HTTP concerns:
 * no CORS, no rate limiting, no request/response objects. Callers handle
 * those themselves.
 *
 * Steps:
 *   1. Resolve which hotels this conversation may reach (network context).
 *   2. Open (or create) the guest thread.
 *   3. If staff have taken over, record a holding reply and return.
 *   4. Otherwise run the AI model with tools, record the turn, return the
 *      reply plus any search/availability/quote/booking results.
 */
import { generate } from "./provider.js";
import { conciergeSystemPrompt } from "./prompts/concierge.js";
import { createToolbox } from "./tools/index.js";
import {
  openGuestThread,
  recordGuestTurn,
  scopeForOne,
  threadHandledBy,
} from "../guestConversations.js";
import { createNetworkContext } from "../network.js";
import { COLLECTIONS } from "../../src/lib/collections.js";
import { HUMAN_HOLDING_REPLY } from "../../src/lib/conversations.js";
import { classifyGuestMessage, type GuestRequestCategory, type GuestRequestPriority, type GuestRequestType } from "../../src/lib/guestRequest.js";
import { errorMessage } from "./errors.js";
import type {
  AiMessage,
  ConciergeAvailability,
  ConciergeBooking,
  ConciergeQuote,
  GuestRequestAck,
  TurnTrace,
} from "./types.js";

export interface ProcessGuestTurnInput {
  /** The guest's message text. */
  message: string;
  /** The hotel's public id, when the conversation is on one hotel's own link. */
  publicHotelId?: string;
  /** Existing conversation id, when continuing a thread. */
  conversationId?: string;
  /** Client-supplied turn id for duplicate prevention. */
  turnId?: string;
  /** Sanitised conversation history (newest turns first within budget). */
  history: AiMessage[];
  /** The source channel of this turn. Defaults to "web" in the mirror. */
  channel?: "web" | "whatsapp";
}

export interface ProcessGuestTurnOutput {
  reply: string;
  model: string;
  requestId: string;
  conversationId: string;
  handledBy: "ai" | "human";
  /** One hotel's availability, when the turn checked availability. */
  availability?: ConciergeAvailability;
  /** Booking summary, when the turn prepared a booking. */
  quote?: ConciergeQuote;
  /** Confirmed reservation, when the turn created one. */
  booking?: ConciergeBooking;
  /** Logged guest request/complaint, when the turn recorded one. */
  guestRequest?: GuestRequestAck;
}

/**
 * Captures tool results as they execute. Mirrors the TurnOutcome pattern
 * used by the web endpoint so both entry points see the same structured data.
 */
class TurnOutcome {
  availability?: ConciergeAvailability;
  quote?: ConciergeQuote;
  booking?: ConciergeBooking;
  guestRequest?: GuestRequestAck;
  readonly quotedHotelIds = new Set<string>();

  private readonly resolve: (reference: unknown) => Promise<{ hotelId: string; publicId: string } | null>;

  constructor(resolve: (reference: unknown) => Promise<{ hotelId: string; publicId: string } | null>) {
    this.resolve = resolve;
  }

  private async addScoped(scope: { hotelId: string; publicId: string } | null, quoted = false): Promise<void> {
    if (!scope) return;
    if (quoted) this.quotedHotelIds.add(scope.hotelId);
  }

  focus(scope: { hotelId: string; publicId: string }): void {
    void this.addScoped(scope);
  }

  async observe(
    name: string,
    _args: Record<string, unknown>,
    result: Record<string, unknown>,
  ): Promise<void> {
    if (name === "check_availability" && Array.isArray(result.roomTypes)) {
      this.availability = result as unknown as ConciergeAvailability;
      const scope = await this.resolve(result.hotel);
      const totalAvailable = (result as { totalAvailable?: number }).totalAvailable ?? 0;
      await this.addScoped(scope, totalAvailable > 0);
    }
    if (name === "calculate_stay_price" && result.available === true) {
      const scope = await this.resolve(result.hotel);
      await this.addScoped(scope, true);
    }
    if (name === "get_hotel_info" && typeof result.hotel === "string") {
      const scope = await this.resolve(result.hotel);
      await this.addScoped(scope);
    }
    if (name === "prepare_booking" && result.status === "ready" && result.summary) {
      const scope = await this.resolve((result.summary as { hotel?: string }).hotel);
      await this.addScoped(scope, true);
      this.quote = result.summary as unknown as ConciergeQuote;
    }
    if (name === "create_reservation" && result.status === "confirmed" && result.booking) {
      const scope = await this.resolve((result.booking as { hotel?: string }).hotel);
      await this.addScoped(scope, true);
      this.booking = result.booking as unknown as ConciergeBooking;
    }
    if (name === "log_guest_request" && result.status === "logged") {
      this.guestRequest = {
        id: String(result.id),
        reference: String(result.reference),
        type: (result.type ?? "request") as GuestRequestType,
        category: (result.category ?? "other") as GuestRequestCategory,
        priority: (result.priority ?? "normal") as GuestRequestPriority,
        department: String(result.department ?? ""),
        duplicate: Boolean(result.duplicate),
        message: String(result.message ?? ""),
      };
    }
  }
}

/**
 * The one place a guest turn decides which hotels it may reach, runs the AI
 * with tools, and records the result. Shared by web and WhatsApp entry points.
 */
export async function processGuestTurn(
  input: ProcessGuestTurnInput,
): Promise<ProcessGuestTurnOutput> {
  const requestId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  const trace: TurnTrace = { modelCalls: [], toolCalls: [] };

  // Resolve which hotel this conversation reaches.
  const network = await createNetworkContext(input.publicHotelId);
  const openThread = await openGuestThread(input.conversationId, network.scopedPublicId);
  const scopedHotel = network.scopedHotel;
  const attachedScope = await scopeForOne(openThread.hotelId);

  const outcome = new TurnOutcome(network.resolve.bind(network));
  if (scopedHotel) outcome.focus({ hotelId: scopedHotel.hotelId, publicId: scopedHotel.publicId });

  // A member of staff took this conversation over: the AI stays quiet.
  if ((await threadHandledBy(openThread, attachedScope)) === "human") {
    await recordGuestTurn(openThread, {
      guestText: input.message,
      receivedAt: startedAt,
      turnId: input.turnId,
      replyText: HUMAN_HOLDING_REPLY,
      replyRole: "ai",
      ...(input.channel ? { channel: input.channel } : {}),
    });
    return {
      reply: HUMAN_HOLDING_REPLY,
      model: "staff",
      requestId,
      conversationId: openThread.id,
      handledBy: "human",
    };
  }

  const toolbox = createToolbox(
    {
      network,
      guestMessage: input.message,
      // Only a summary recorded in an EARLIER turn can be confirmed (D27).
      pendingBooking: openThread.pendingBooking,
      now: new Date(startedAt),
    },
    requestId,
  );

  const executeTool = async (call: { name: string; args?: Record<string, unknown> }) => {
    const result = await toolbox.execute({ name: call.name, args: call.args ?? {} });
    await outcome.observe(call.name, call.args ?? {}, result);
    return result;
  };

  // Deterministic pre-classifier hint (R13): no model call of its own, just one
  // line appended to the system prompt when the guest's words look like a
  // request or complaint. The model decides whether to call log_guest_request.
  const classification = classifyGuestMessage(input.message);
  let systemPrompt = conciergeSystemPrompt({ hotelName: scopedHotel?.profile.name, now: new Date(startedAt) });
  if (classification.confidence === "medium" || classification.confidence === "high") {
    systemPrompt +=
      "\n\nPRE-CLASSIFIER HINT: this guest message looks like a " +
      classification.type +
      " about " +
      classification.category +
      " (priority " +
      classification.priority +
      ", confidence " +
      classification.confidence +
      "). If the guest is reporting an issue or asking for something that is not a room booking, " +
      "call log_guest_request with the details, then give the guest the reference number and say staff will follow up. " +
      "Never promise a refund, compensation, or a resolution time. Reasons: " +
      classification.reasons.join("; ") +
      ".";
  }

  const generation = await generate({
    system: systemPrompt,
    messages: [...input.history, { role: "user", content: input.message }],
    tools: toolbox.definitions,
    executeTool,
    trace,
  });

  // Record the turn in the canonical thread and every attached inbox mirror.
  await recordGuestTurn(openThread, {
    guestText: input.message,
    receivedAt: startedAt,
    turnId: input.turnId,
    replyText: generation.text,
    ...(input.channel ? { channel: input.channel } : {}),
  }).catch((error: unknown) =>
    console.error("[conciergeTurn] conversation write failed", {
      requestId,
      conversationId: openThread.id,
      detail: errorMessage(error),
    }),
  );

  // Urgent or safety requests flip the conversation to human handoff (R14):
  // staff take over, the AI goes quiet, and the Inbox shows "Human".
  const needsHandoff =
    outcome.guestRequest &&
    (outcome.guestRequest.priority === "urgent" || outcome.guestRequest.category === "safety");
  if (needsHandoff && scopedHotel) {
    try {
      await scopedHotel
        .collection(COLLECTIONS.CONVERSATIONS)
        .doc(openThread.id)
        .update({ handledBy: "human" });
    } catch (error: unknown) {
      console.error("[conciergeTurn] handoff flip failed", {
        requestId,
        conversationId: openThread.id,
        detail: errorMessage(error),
      });
    }
  }

  return {
    reply: generation.text,
    model: generation.model,
    requestId,
    conversationId: openThread.id,
    handledBy: "ai",
    ...(outcome.availability ? { availability: outcome.availability } : {}),
    ...(outcome.quote ? { quote: outcome.quote } : {}),
    ...(outcome.booking ? { booking: outcome.booking } : {}),
    ...(outcome.guestRequest ? { guestRequest: outcome.guestRequest } : {}),
  };
}

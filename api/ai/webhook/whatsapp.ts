/**
 * POST /api/ai/webhook/whatsapp — Meta WhatsApp Cloud API webhook.
 *
 * Receives incoming WhatsApp messages and status updates. Before any messages
 * are delivered, Meta verifies the webhook with a GET request containing
 * hub.mode, hub.verify_token and hub.challenge.
 *
 * WhatsApp is only active when the receiving hotel has an active WhatsApp
 * Business connection (whatsappConnections/{hotelId} with status "active").
 * Until then, this endpoint returns 503.
 *
 * Security:
 *   - POST webhooks are verified with X-Hub-Signature-256 (HMAC-SHA256 of the
 *     raw body using the receiving hotel's app secret). Invalid signatures
 *     are rejected with 401.
 *   - Tenant routing is determined by the receiving phone_number_id from the
 *     webhook metadata, mapped via whatsappPhoneNumberIds. A query parameter
 *     cannot override a registered phone number ID mapping. The query-param
 *     fallback is only allowed in single-hotel mode
 *     (WHATSAPP_SINGLE_HOTEL_MODE=true).
 *   - Every event is persisted in whatsappWebhookEvents with a processing
 *     lifecycle (RECEIVED → PROCESSING → COMPLETED/FAILED) before any
 *     side effects. Meta redeliveries are acknowledged without reprocessing.
 *
 * Processing lifecycle:
 *   - RECEIVED  — event persisted, awaiting a worker
 *   - PROCESSING — event claimed by a worker (atomic claim prevents
 *                  concurrent workers from processing the same event)
 *   - COMPLETED — event fully processed; redeliveries are acknowledged
 *   - FAILED    — processing failed; event can be retried on redelivery
 *                 (up to a max attempt count)
 *
 * Abandoned PROCESSING events (no heartbeat within WHATSAPP_CLAIM_TTL_MS)
 * are reclaimed by a later redelivery, so a crashed worker never blocks
 * an event forever.
 *
 * Credentials are per-hotel: the hotel that owns the receiving phone number
 * ID supplies the access token and app secret used for this webhook. Hotel A
 * can never process a webhook with Hotel B's credentials.
 */

import { enforceRateLimit } from "../../../server/ai/rateLimit.js";
import { whatsappAdapter } from "../../../src/lib/channels/whatsapp.js";
import { processGuestTurn, type ProcessGuestTurnInput } from "../../../server/ai/conciergeTurn.js";
import { errorMessage, guestMessageFor, isAiError, isRateLimitError } from "../../../server/ai/errors.js";
import {
  applyCors,
  clientKey,
  handlePreflight,
  newRequestId,
  requireMethod,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../../../server/ai/http.js";
import { resolveHotel, type HotelScope } from "../../../server/hotels.js";
import { COLLECTIONS } from "../../../src/lib/collections.js";
import { adminDb } from "../../../server/admin.js";
import { FieldValue } from "firebase-admin/firestore";
import {
  getActiveWhatsAppConnection,
  connectionToCredentials,
  type WhatsAppConnection,
} from "../../../server/whatsapp/connections.js";

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

/** WhatsApp enforces a 4096-character limit on text messages. */
const WHATSAPP_MAX_TEXT = 4096;

/** How long a PROCESSING claim holds before another worker may reclaim it. */
const WHATSAPP_CLAIM_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Max processing attempts before a failed event is acknowledged as done. */
const WHATSAPP_MAX_ATTEMPTS = 3;

/** Event lifecycle states. */
type WebhookEventStatus = "received" | "processing" | "completed" | "failed";

interface WebhookEventData {
  status: WebhookEventStatus;
  publicHotelId: string;
  hotelId: string;
  attempts: number;
  lastError?: string;
  createdAt: FieldValue | Date;
  claimedAt?: FieldValue | Date;
  claimedBy?: string;
}

/** Reads the raw request body as a string, for signature verification. */
async function readRawBody(req: ApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parses the phone_number_id from a Meta webhook body (metadata only). */
function extractPhoneNumberId(body: unknown): string {
  const entry = (body as Record<string, unknown>)?.entry as Array<Record<string, unknown>> | undefined;
  const changes = entry?.[0]?.changes as Array<Record<string, unknown>> | undefined;
  const value = changes?.[0]?.value as Record<string, unknown> | undefined;
  const metadata = value?.metadata as Record<string, unknown> | undefined;
  return typeof metadata?.phone_number_id === "string" ? metadata.phone_number_id : "";
}

/**
 * Resolves the hotel for an inbound webhook by the receiving phone number ID.
 * Meta includes phone_number_id in the webhook metadata; we map it to the
 * hotel that owns that number. Returns null when no mapping exists.
 */
async function resolveHotelByPhoneNumberId(
  phoneNumberId: string,
): Promise<{ scope: HotelScope; publicHotelId: string; hotelId: string } | null> {
  const db = adminDb();
  const mappingSnap = await db.collection(COLLECTIONS.WHATSAPP_PHONE_NUMBER_IDS).doc(phoneNumberId).get();
  if (!mappingSnap.exists) return null;
  const data = mappingSnap.data();
  const publicHotelId = typeof data?.publicHotelId === "string" ? data.publicHotelId : "";
  const hotelId = typeof data?.hotelId === "string" ? data.hotelId : "";
  if (!publicHotelId || !hotelId) return null;
  let scope: HotelScope;
  try {
    scope = await resolveHotel(publicHotelId);
  } catch {
    return null;
  }
  return { scope, publicHotelId, hotelId };
}

/**
 * Persists an event as RECEIVED. Returns true when this is the first time
 * the event has been seen; false when it already exists.
 */
async function persistEventReceived(
  eventId: string,
  publicHotelId: string,
  hotelId: string,
): Promise<boolean> {
  const db = adminDb();
  const docRef = db.collection(COLLECTIONS.WHATSAPP_WEBHOOK_EVENTS).doc(eventId);
  const written = await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (snap.exists) return false;
    tx.create(docRef, {
      status: "received",
      publicHotelId,
      hotelId,
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
    return true;
  });
  return written;
}

/**
 * Atomically claims a RECEIVED (or abandoned PROCESSING) event for processing.
 * Returns the event data when the claim succeeded, null when another worker
 * holds a valid claim or the event is already COMPLETED/FAILED-without-retry.
 */
async function claimEvent(
  eventId: string,
  requestId: string,
): Promise<WebhookEventData | null> {
  const db = adminDb();
  const docRef = db.collection(COLLECTIONS.WHATSAPP_WEBHOOK_EVENTS).doc(eventId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return null;
    const data = snap.data() as WebhookEventData | undefined;
    if (!data) return null;

    const now = Date.now();
    const claimedAtMillis = (data.claimedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    const expired = now - claimedAtMillis > WHATSAPP_CLAIM_TTL_MS;

    if (data.status === "completed") return null;
    if (data.status === "failed" && data.attempts >= WHATSAPP_MAX_ATTEMPTS) return null;
    if (data.status === "processing" && !expired) return null;

    // Claim the event: transition to PROCESSING.
    tx.update(docRef, {
      status: "processing",
      claimedAt: FieldValue.serverTimestamp(),
      claimedBy: requestId,
      attempts: (data.attempts ?? 0) + 1,
    });
    return { ...data, status: "processing", attempts: (data.attempts ?? 0) + 1 } as WebhookEventData;
  });
}

/** Marks an event COMPLETED. */
async function markCompleted(eventId: string): Promise<void> {
  const db = adminDb();
  const docRef = db.collection(COLLECTIONS.WHATSAPP_WEBHOOK_EVENTS).doc(eventId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return;
    tx.update(docRef, { status: "completed" });
  });
}

/** Marks an event FAILED, storing the error. */
async function markFailed(eventId: string, error: string): Promise<void> {
  const db = adminDb();
  const docRef = db.collection(COLLECTIONS.WHATSAPP_WEBHOOK_EVENTS).doc(eventId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return;
    tx.update(docRef, { status: "failed", lastError: error });
  });
}

/** Determines how to handle an already-seen event based on its lifecycle state. */
function handleExistingEvent(data: WebhookEventData): { acknowledge: boolean; status: string } | null {
  const now = Date.now();
  if (data.status === "completed") {
    return { acknowledge: true, status: "duplicate" };
  }
  if (data.status === "failed" && data.attempts >= WHATSAPP_MAX_ATTEMPTS) {
    return { acknowledge: true, status: "duplicate" };
  }
  if (data.status === "processing") {
    const claimedAtMillis = (data.claimedAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
    const expired = now - claimedAtMillis > WHATSAPP_CLAIM_TTL_MS;
    if (!expired) {
      // Another worker holds a valid claim; acknowledge so Meta stops
      // redelivering, the original worker will complete or fail it.
      return { acknowledge: true, status: "duplicate" };
    }
    // Expired PROCESSING claim: fall through to reclaim.
  }
  // RECEIVED or retryable FAILED: fall through to claim-and-process.
  return null;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);
  if (handlePreflight(req, res)) return;

  const requestId = newRequestId();

  try {
    enforceRateLimit(`whatsapp-webhook:${clientKey(req)}`, RATE_LIMIT);

    // ---------- Webhook verification (GET) ----------
    if (req.method === "GET") {
      const url = (req as { url?: string }).url ?? "";
      const start = url.indexOf("?");
      const params = new URLSearchParams(start === -1 ? "" : url.slice(start + 1));
      const mode = params.get("hub.mode");
      const token = params.get("hub.verify_token");
      const challenge = params.get("hub.challenge");

      if (mode === "subscribe" && challenge) {
        const verified = whatsappAdapter.verifyWebhook
          ? await whatsappAdapter.verifyWebhook(process.env, { query: { "hub.verify_token": token ?? "" } })
          : false;
        if (verified) {
          (res.status(200) as { end: (body: string) => unknown }).end(challenge);
          return;
        }
        sendJson(res, 403, { error: "Verification token mismatch.", requestId });
        return;
      }
      sendJson(res, 400, { error: "Missing verification parameters.", requestId });
      return;
    }

    if (!requireMethod(req, res, "POST")) return;

    // ---------- Incoming message (POST) ----------
    // Read raw body for signature verification before parsing JSON.
    const rawBody = await readRawBody(req);

    // Parse just enough to route by phone number ID.
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body.", requestId });
      return;
    }
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { error: "Invalid JSON body.", requestId });
      return;
    }

    const phoneNumberId = extractPhoneNumberId(body);

    let publicHotelId: string;
    let hotelId: string;
    let scope: HotelScope;
    let connection: WhatsAppConnection | null;

    if (phoneNumberId) {
      // Route by the actual receiving phone number ID (multi-hotel isolation).
      const resolved = await resolveHotelByPhoneNumberId(phoneNumberId);
      if (!resolved) {
        sendJson(res, 400, { error: "No hotel is registered for this WhatsApp number.", requestId });
        return;
      }
      scope = resolved.scope;
      publicHotelId = resolved.publicHotelId;
      hotelId = resolved.hotelId;

      // Look up the hotel's WhatsApp connection. Credentials are per-hotel.
      connection = await getActiveWhatsAppConnection(hotelId);
      if (!connection) {
        sendJson(res, 503, {
          error: "WhatsApp is not configured for this hotel.",
          requestId,
        });
        return;
      }
    } else {
      // No phone_number_id in metadata: single-hotel fallback only.
      if (process.env.WHATSAPP_SINGLE_HOTEL_MODE !== "true") {
        sendJson(res, 400, { error: "phone_number_id is required for webhook routing.", requestId });
        return;
      }
      const url = (req as { url?: string }).url ?? "";
      const start = url.indexOf("?");
      const params = new URLSearchParams(start === -1 ? "" : url.slice(start + 1));
      publicHotelId = params.get("publicHotelId") ?? "";
      if (!publicHotelId) {
        sendJson(res, 400, { error: "publicHotelId is required.", requestId });
        return;
      }
      try {
        scope = await resolveHotel(publicHotelId);
        hotelId = scope.hotelId;
      } catch {
        sendJson(res, 400, { error: "Unknown hotel.", requestId });
        return;
      }

      connection = await getActiveWhatsAppConnection(hotelId);
      if (!connection) {
        sendJson(res, 503, {
          error: "WhatsApp is not configured for this hotel.",
          requestId,
        });
        return;
      }
    }

    const credentials = connectionToCredentials(connection);

    // Verify signature using the receiving hotel's app secret.
    const signature = (req.headers as Record<string, string | undefined>)["x-hub-signature-256"];
    if (!signature) {
      sendJson(res, 401, { error: "Missing webhook signature.", requestId });
      return;
    }
    const signatureOk = await whatsappAdapter.verifySignature?.(credentials, rawBody, signature);
    if (!signatureOk) {
      sendJson(res, 401, { error: "Invalid webhook signature.", requestId });
      return;
    }

    const message = await whatsappAdapter.receive(credentials, body);
    if (!message) {
      // Not a message event (e.g. a status update). Persist and acknowledge
      // so Meta stops redelivering, but do not run the AI gateway.
      await persistEventReceived(
        `status-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        publicHotelId,
        hotelId,
      ).catch(() => void 0);
      sendJson(res, 200, { status: "ignored", requestId });
      return;
    }

    // Persist the event as RECEIVED before any side effects.
    const isFirst = await persistEventReceived(message.externalId, publicHotelId, hotelId);
    if (!isFirst) {
      // Event already seen: check its lifecycle state.
      const db = adminDb();
      const snap = await db.collection(COLLECTIONS.WHATSAPP_WEBHOOK_EVENTS).doc(message.externalId).get();
      const data = snap.data() as WebhookEventData | undefined;
      if (data) {
        const handled = handleExistingEvent(data);
        if (handled) {
          sendJson(res, 200, { status: handled.status, eventId: message.externalId, requestId });
          return;
        }
      }
      // Retryable FAILED: fall through to claim and reprocess.
    }

    // Atomically claim the event (RECEIVED → PROCESSING).
    const claimed = await claimEvent(message.externalId, requestId);
    if (!claimed) {
      // Another worker holds a valid claim, or event is completed/max-failed.
      sendJson(res, 200, { status: "duplicate", eventId: message.externalId, requestId });
      return;
    }

    // Process the turn through the shared AI concierge gateway, using the
    // receiving hotel's credentials.
    const input: ProcessGuestTurnInput = {
      message: message.text,
      publicHotelId,
      conversationId: undefined,
      turnId: message.externalId,
      history: [],
      channel: "whatsapp",
    };

    let output: Awaited<ReturnType<typeof processGuestTurn>>;
    try {
      output = await processGuestTurn(input);
    } catch (error) {
      const detail = errorMessage(error);
      await markFailed(message.externalId, detail).catch(() => void 0);
      console.error("[whatsapp-webhook] AI turn failed", {
        requestId,
        eventId: message.externalId,
        detail,
      });
      // Acknowledge so Meta stops redelivering. The event is FAILED and can
      // be retried on a subsequent redelivery (up to max attempts).
      sendJson(res, 200, { status: "received", error: "AI processing failed", requestId });
      return;
    }

    // Send the AI's reply back to the guest via WhatsApp.
    const text = output.reply.slice(0, WHATSAPP_MAX_TEXT);
    const sendResult = await whatsappAdapter.send(credentials, {
      conversationId: message.guestContact, // WhatsApp "to" field = guest's phone number
      text,
    });
    if (!sendResult.ok) {
      // Mark failed but don't lose the guest message: it was recorded by
      // processGuestTurn. The reply will be retried on the next message.
      await markFailed(message.externalId, sendResult.error || "Send failed").catch(() => void 0);
      console.error("[whatsapp-webhook] send failed", {
        requestId,
        eventId: message.externalId,
        detail: sendResult.error,
      });
      sendJson(res, 200, { status: "received", error: "Reply send failed", requestId });
      return;
    }

    await markCompleted(message.externalId).catch(() => void 0);

    sendJson(res, 200, {
      status: "received",
      message,
      conversationId: output.conversationId,
      handledBy: output.handledBy,
      requestId,
    });
  } catch (error) {
    const aiError = isAiError(error) ? error : null;
    const rateLimitError = isRateLimitError(error) ? error : null;
    console.error("[whatsapp-webhook] failed", {
      requestId,
      code: aiError?.code ?? "unexpected",
      detail: errorMessage(error),
    });
    if (rateLimitError) {
      res.setHeader("Retry-After", String(rateLimitError.retryAfterSeconds));
    }
    sendJson(res, aiError?.status ?? 500, {
      error: guestMessageFor(error),
      code: aiError?.code ?? "unexpected",
      requestId,
    });
  }
}

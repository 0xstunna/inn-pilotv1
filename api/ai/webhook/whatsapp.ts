/**
 * POST /api/ai/webhook/whatsapp — Meta WhatsApp Cloud API webhook.
 *
 * Receives incoming WhatsApp messages and status updates. Before any messages
 * are delivered, Meta verifies the webhook with a GET request containing
 * hub.mode, hub.verify_token and hub.challenge. Hotels configure their Meta
 * webhook URL with their publicHotelId as a query parameter so the webhook
 * knows which hotel the message belongs to.
 *
 * WhatsApp is only active when WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 * and WHATSAPP_VERIFY_TOKEN are set as server environment variables. Until then,
 * this endpoint returns 503 and the inbox shows WhatsApp as "not configured".
 *
 * Duplicate webhook prevention: Meta may redeliver the same message id. The
 * conversation write path deduplicates by external id (externalMessageId on
 * TurnRecord), so a message is recorded once.
 */
import { enforceRateLimit } from "../../../server/ai/rateLimit.js";
import { whatsappAdapter } from "../../../src/lib/channels/whatsapp.js";
import { errorMessage, guestMessageFor, isAiError, isRateLimitError } from "../../../server/ai/errors.js";
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
} from "../../../server/ai/http.js";
import { resolveHotel, type HotelScope } from "../../../server/hotels.js";
import { openConversation, recordTurn, type OpenConversation } from "../../../server/conversations.js";
import { COLLECTIONS } from "../../../src/lib/collections.js";

const RATE_LIMIT = { limit: 60, windowMs: 60_000 };

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
    const url = (req as { url?: string }).url ?? "";
    const start = url.indexOf("?");
    const params = new URLSearchParams(start === -1 ? "" : url.slice(start + 1));
    const publicHotelId = params.get("publicHotelId") ?? "";
    if (!publicHotelId) {
      sendJson(res, 400, { error: "publicHotelId is required.", requestId });
      return;
    }

    let scope: HotelScope;
    try {
      scope = await resolveHotel(publicHotelId);
    } catch {
      sendJson(res, 400, { error: "Unknown hotel.", requestId });
      return;
    }

    const body = await readJsonBody(req);
    if (!body) {
      sendJson(res, 400, { error: "Invalid JSON body.", requestId });
      return;
    }

    const message = await whatsappAdapter.receive(process.env, body);
    if (!message) {
      // Not a message event (e.g. a status update). Acknowledge anyway so Meta stops redelivering.
      sendJson(res, 200, { status: "ignored", requestId });
      return;
    }

    // Find an existing WhatsApp conversation for this guest at this hotel,
    // or create a new one.
    const conversationsRef = scope.collection(COLLECTIONS.CONVERSATIONS);
    const existingSnap = await conversationsRef
      .where("guestContact", "==", message.guestContact)
      .where("channel", "==", "whatsapp")
      .limit(1)
      .get();

    let conversation: OpenConversation;
    if (existingSnap.docs.length > 0) {
      const docSnap = existingSnap.docs[0];
      const data = docSnap.data();
      conversation = {
        id: docSnap.id,
        ref: docSnap.ref,
        exists: true,
        handledBy: (data.handledBy as "ai" | "human") ?? "ai",
        bookingStatus: (data.bookingStatus as "none" | "quoted" | "booked") ?? "none",
        messageCount: typeof data.messageCount === "number" ? data.messageCount : 0,
      };
    } else {
      conversation = await openConversation(scope, undefined);
    }

    await recordTurn(scope, conversation, {
      guestText: message.text,
      receivedAt: message.at.getTime(),
      turnId: message.externalId,
      externalMessageId: message.externalId,
      channel: "whatsapp",
      guest: { name: message.guestName, phone: message.guestContact },
    });

    sendJson(res, 200, { status: "received", message, requestId });
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

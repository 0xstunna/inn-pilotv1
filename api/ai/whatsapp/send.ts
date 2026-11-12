/**
 * POST /api/ai/whatsapp/send — send a staff reply or follow-up to a guest via WhatsApp.
 *
 * The inbox calls this when staff reply to a WhatsApp conversation. It delivers
 * the message through the WhatsApp adapter (Meta Graph API) and reports success
 * or failure honestly — a message is not reported as delivered when Meta rejects it.
 *
 * Credentials are per-hotel: the access token and phone number ID come from the
 * requesting hotel's WhatsApp Business connection (whatsappConnections/{hotelId}),
 * never from global environment variables. Hotel A can never send through Hotel B's
 * WhatsApp account.
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
import {
  getActiveWhatsAppConnection,
  connectionToCredentials,
} from "../../../server/whatsapp/connections.js";

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

/** WhatsApp enforces a 4096-character limit on text messages. */
const WHATSAPP_MAX_TEXT = 4096;

interface SendRequest {
  hotelId: string;
  conversationId: string;
  guestContact: string;
  text: string;
}

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "POST")) return;

  const requestId = newRequestId();

  try {
    enforceRateLimit(`whatsapp-send:${clientKey(req)}`, RATE_LIMIT);

    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") {
      sendJson(res, 400, { error: "Invalid request body.", requestId });
      return;
    }

    const { hotelId, conversationId, guestContact, text } = body as unknown as SendRequest;
    if (!hotelId || !conversationId || !guestContact || !text) {
      sendJson(res, 400, { error: "Missing required fields.", requestId });
      return;
    }

    // Resolve this hotel's WhatsApp connection. Per-hotel credentials only.
    const connection = await getActiveWhatsAppConnection(hotelId);
    if (!connection) {
      sendJson(res, 503, {
        error: "WhatsApp is not configured for this hotel.",
        requestId,
      });
      return;
    }

    const credentials = connectionToCredentials(connection);

    const sendResult = await whatsappAdapter.send(credentials, {
      conversationId: guestContact, // WhatsApp "to" field = guest's phone number
      text: text.slice(0, WHATSAPP_MAX_TEXT),
    });

    if (!sendResult.ok) {
      console.error("[whatsapp-send] failed", {
        requestId,
        hotelId,
        conversationId,
        detail: sendResult.error,
      });
      sendJson(res, 502, {
        error: sendResult.error || "WhatsApp delivery failed.",
        requestId,
        delivered: false,
      });
      return;
    }

    sendJson(res, 200, {
      status: "sent",
      externalId: sendResult.externalId,
      requestId,
      delivered: true,
    });
  } catch (error) {
    const aiError = isAiError(error) ? error : null;
    const rateLimitError = isRateLimitError(error) ? error : null;
    console.error("[whatsapp-send] failed", {
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
      delivered: false,
    });
  }
}

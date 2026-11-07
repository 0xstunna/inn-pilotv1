/**
 * GET /api/ai/channels — which messaging channels are configured for this hotel.
 *
 * WhatsApp is configured when WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 * and WHATSAPP_VERIFY_TOKEN are set as server environment variables. Instagram
 * and Email are not yet implemented. The web channel (AI Concierge) is always
 * available.
 *
 * The client uses this to show channel configuration status in the inbox and
 * settings — never presenting an unconfigured channel as a real integration.
 */
import { getAdapter, type Channel } from "../../src/lib/channels.js";
import { enforceRateLimit } from "../../server/ai/rateLimit.js";
import { errorMessage, guestMessageFor, isAiError, isRateLimitError } from "../../server/ai/errors.js";
import {
  applyCors,
  clientKey,
  handlePreflight,
  newRequestId,
  requireMethod,
  sendJson,
  type ApiRequest,
  type ApiResponse,
} from "../../server/ai/http.js";

const RATE_LIMIT = { limit: 30, windowMs: 60_000 };

export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);
  if (handlePreflight(req, res)) return;
  if (!requireMethod(req, res, "GET")) return;

  const requestId = newRequestId();

  try {
    enforceRateLimit(`channels:${clientKey(req)}`, RATE_LIMIT);

    const channelIds: Channel[] = ["web", "whatsapp", "instagram", "email"];
    const channels = channelIds.map((id) => {
      const adapter = getAdapter(id);
      const config = adapter ? adapter.configured(process.env) : { configured: false, missing: "No adapter registered." };
      return {
        id,
        name: adapter?.name || id.charAt(0).toUpperCase() + id.slice(1),
        configured: config.configured,
        missing: config.missing,
      };
    });

    sendJson(res, 200, { channels, requestId });
  } catch (error) {
    console.error("[channels] failed", {
      requestId,
      code: isAiError(error) ? error.code : "unexpected",
      detail: errorMessage(error),
    });
    if (isRateLimitError(error)) res.setHeader("Retry-After", String(error.retryAfterSeconds));
    sendJson(res, isAiError(error) ? error.status : 500, {
      error: guestMessageFor(error),
      code: isAiError(error) ? error.code : "unexpected",
      requestId,
    });
  }
}

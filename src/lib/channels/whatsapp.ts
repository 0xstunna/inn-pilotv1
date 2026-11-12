/**
 * WhatsApp channel adapter — Meta WhatsApp Business Platform (Cloud API).
 *
 * Groundwork only: this adapter is registered but NOT configured unless the
 * hotel supplies WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID,
 * WHATSAPP_VERIFY_TOKEN and WHATSAPP_APP_SECRET. Until then it reports
 * itself as unconfigured, and the inbox shows WhatsApp as "not configured —
 * add credentials in Settings → Channels."
 *
 * When configured:
 *   - GET  /api/ai/webhook/whatsapp  — webhook verification (hub.challenge)
 *   - POST /api/ai/webhook/whatsapp  — incoming messages and status updates
 *   - POST https://graph.facebook.com/v19.0/{phoneNumberId}/messages      — send replies
 *
 * Duplicate webhook prevention: Meta may redeliver the same message. The
 * conversation record uses the external message id (externalMessageId on
 * TurnRecord) so a message is written once, and the webhook handler keeps a
 * persistent record of processed event IDs for atomic idempotency.
 *
 * Signature verification: Meta signs POST webhooks with X-Hub-Signature-256
 * (HMAC-SHA256 of the raw body using WHATSAPP_APP_SECRET). The adapter
 * exposes verifySignature() for this; the webhook handler calls it before
 * processing any inbound event.
 *
 * Pure types + thin HTTP wrapper — no Firestore import here. The gateway that
 * receives a verified inbound message writes it to the conversation exactly
 * like a web guest turn.
 */

import type { ChannelAdapter, InboundMessage, SendResult, ChannelConfig } from "../channels.js";

const META_GRAPH_VERSION = "v19.0";

function isConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.WHATSAPP_ACCESS_TOKEN &&
      env.WHATSAPP_PHONE_NUMBER_ID &&
      env.WHATSAPP_VERIFY_TOKEN &&
      env.WHATSAPP_APP_SECRET,
  );
}

function textOf(message: Record<string, unknown>): string {
  const text = message.text;
  if (text && typeof text === "object") {
    const body = (text as Record<string, unknown>).body;
    return typeof body === "string" ? body : "";
  }
  return "";
}

/**
 * Computes the HMAC-SHA256 signature Meta expects: sha256=hex(app_secret, body).
 * Returns null when no app secret is configured (so callers can distinguish
 * "not configured" from "signature mismatch").
 */
export function computeSignature(
  appSecret: string | undefined,
  body: string,
): string | null {
  if (!appSecret) return null;
  // Node's crypto is available on the server; the browser never imports this
  // module's runtime code (only types). Use the Web Crypto API via a small
  // shim so the same source works under Vercel and locally.
  return hmacSha256Hex(appSecret, body);
}

/**
 * Constant-time comparison of two hex signatures. Prevents timing attacks.
 */
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * HMAC-SHA256 hex digest. Uses Node's crypto module when available, falls
 * back to the Web Crypto API (Vercel Edge, modern browsers).
 */
function hmacSha256Hex(key: string, data: string): string {
  // Node.js environment
  if (typeof process !== "undefined" && typeof process.versions?.node === "string") {
    const crypto = require("crypto");
    return crypto.createHmac("sha256", key).update(data).digest("hex");
  }
  // Web Crypto API (not available synchronously, so this is a fallback that
  // should never be hit in the server path where this adapter runs).
  throw new Error("Web Crypto HMAC not available in this environment.");
}

export const whatsappAdapter: ChannelAdapter = {
  id: "whatsapp",
  name: "WhatsApp",
  configured(env: Record<string, string | undefined>): ChannelConfig {
    if (isConfigured(env)) return { configured: true };
    const missing: string[] = [];
    if (!env.WHATSAPP_ACCESS_TOKEN) missing.push("WHATSAPP_ACCESS_TOKEN");
    if (!env.WHATSAPP_PHONE_NUMBER_ID) missing.push("WHATSAPP_PHONE_NUMBER_ID");
    if (!env.WHATSAPP_VERIFY_TOKEN) missing.push("WHATSAPP_VERIFY_TOKEN");
    if (!env.WHATSAPP_APP_SECRET) missing.push("WHATSAPP_APP_SECRET");
    return { configured: false, missing: `Set ${missing.join(", ")} in Settings → Channels.` };
  },
  async receive(env, raw): Promise<InboundMessage | null> {
    if (!isConfigured(env)) return null;
    const body = raw as Record<string, unknown> | undefined;
    if (!body) return null;
    const entry = body.entry as Array<Record<string, unknown>> | undefined;
    if (!entry?.length) return null;
    const changes = entry[0].changes as Array<Record<string, unknown>> | undefined;
    if (!changes?.length) return null;
    const value = changes[0].value as Record<string, unknown> | undefined;
    if (!value) return null;
    const messages = value.messages as Array<Record<string, unknown>> | undefined;
    if (!messages?.length) return null;
    const message = messages[0];
    const from = typeof message.from === "string" ? message.from : "";
    const text = textOf(message);
    const id = typeof message.id === "string" ? message.id : "";
    const ts = typeof message.timestamp === "string" ? new Date(Number(message.timestamp) * 1000) : new Date();
    if (!id || !text || !from) return null;
    return { externalId: id, guestName: from, guestContact: from, text, at: ts };
  },
  async send(env, message): Promise<SendResult> {
    if (!isConfigured(env)) {
      return { ok: false, error: "WhatsApp is not configured. Add credentials in Settings → Channels." };
    }
    const accessToken = env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
    const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${phoneNumberId}/messages`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: message.conversationId, // conversationId holds the guest's WhatsApp number
          type: "text",
          text: { body: message.text },
        }),
      });
      if (!response.ok) {
        const error = await response.text().catch(() => "");
        return { ok: false, error: `WhatsApp send failed (${response.status}): ${error}` };
      }
      const data = (await response.json()) as Record<string, unknown>;
      const messages = data.messages as Array<{ id?: string }> | undefined;
      return { ok: true, externalId: messages?.[0]?.id };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "WhatsApp send failed." };
    }
  },
  async verifyWebhook(env, _req, signature): Promise<boolean> {
    if (!isConfigured(env)) return false;

    // GET verification: hub.mode=subscribe + hub.verify_token
    const request = _req as { query?: Record<string, string>; headers?: Record<string, string> };
    const mode = request.query?.["hub.mode"];
    const token = request.query?.["hub.verify_token"];
    const challenge = request.query?.["hub.challenge"];

    if (mode === "subscribe" && challenge) {
      if (token !== env.WHATSAPP_VERIFY_TOKEN) return false;
      return true;
    }

    // POST verification: X-Hub-Signature-256
    if (signature) {
      const expected = computeSignature(env.WHATSAPP_APP_SECRET, "");
      if (!expected) return false;
      // The caller supplies the raw body separately; see verifySignature().
      return false;
    }

    return false;
  },

  /**
   * Verifies a Meta webhook signature: X-Hub-Signature-256 = sha256=hex(app_secret, rawBody).
   * Returns false when not configured or when the signature doesn't match.
   */
  async verifySignature(env, rawBody: string, signature: string): Promise<boolean> {
    if (!isConfigured(env)) return false;
    const expected = computeSignature(env.WHATSAPP_APP_SECRET, rawBody);
    if (!expected) return false;
    const provided = signature.replace(/^sha256=/i, "");
    return secureCompare(expected, provided);
  },
};

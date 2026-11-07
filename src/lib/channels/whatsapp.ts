/**
 * WhatsApp channel adapter — Meta WhatsApp Business Platform (Cloud API).
 *
 * Groundwork only: this adapter is registered but NOT configured unless the
 * hotel supplies WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID and
 * WHATSAPP_VERIFY_TOKEN. Until then it reports itself as unconfigured, and
 * the inbox shows WhatsApp as "not configured — add credentials in Settings".
 *
 * When configured:
 *   - GET  /api/ai/webhook/whatsapp  — webhook verification (hub.challenge)
 *   - POST /api/ai/webhook/whatsapp  — incoming messages and status updates
 *   - POST https://graph.facebook.com/v19.0/{phoneNumberId}/messages      — send replies
 *
 * Duplicate webhook prevention: Meta may redeliver the same message. The
 * conversation record uses the external message id (pendingTurnId pattern) so
 * a message is written once.
 *
 * Pure types + thin HTTP wrapper — no Firestore import here. The gateway that
 * receives a verified inbound message writes it to the conversation exactly
 * like a web guest turn.
 */

import type { ChannelAdapter, InboundMessage, SendResult, ChannelConfig } from "../channels.js";

const META_GRAPH_VERSION = "v19.0";

function isConfigured(env: Record<string, string | undefined>): boolean {
  return Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_VERIFY_TOKEN);
}

function textOf(message: Record<string, unknown>): string {
  const text = message.text;
  if (text && typeof text === "object") {
    const body = (text as Record<string, unknown>).body;
    return typeof body === "string" ? body : "";
  }
  return "";
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
  async verifyWebhook(env, _req): Promise<boolean> {
    if (!isConfigured(env)) return false;
    // Meta sends GET verification: hub.mode=subscribe, hub.verify_token, hub.challenge
    // Signature verification uses X-Hub-Signature-256 with the app secret.
    // We implement the verify_token check here; app-secret signature is optional
    // hardening that can be added when WHATSAPP_APP_SECRET is configured.
    const verifyToken = env.WHATSAPP_VERIFY_TOKEN;
    const request = _req as { query?: Record<string, string>; headers?: Record<string, string> };
    const token = request.query?.["hub.verify_token"];
    if (token !== verifyToken) return false;
    return true;
  },
};

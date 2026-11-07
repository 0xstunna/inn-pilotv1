/**
 * Channel adapters — how InnPilot receives and sends messages on channels
 * other than the web AI Concierge.
 *
 * The web channel is handled directly by the concierge gateway (server-side,
 * Firestore-backed). Every other channel (WhatsApp, Instagram, Email) goes
 * through an adapter that translates that channel's protocol into InnPilot's
 * conversation model and back.
 *
 * Adapters are registered here. A channel that has no configured adapter is
 * shown as "not configured" in the inbox — never presented as a real
 * integration. When a hotel adds credentials in Settings, the adapter becomes
 * active and messages flow in both directions.
 *
 * Pure types — no Firestore import — so the app, the server and the tests
 * share one definition.
 */

import { whatsappAdapter } from "./channels/whatsapp.js";
import type { Channel } from "./conversations.js";
export type { Channel };

const ALL_CHANNELS: readonly Channel[] = ["web", "whatsapp", "instagram", "email"];

/** An inbound message from a channel, ready to be written as a guest turn. */
export interface InboundMessage {
  /** The channel's own message id, for duplicate-webhook prevention. */
  externalId: string;
  /** The guest's name, when the channel provides it. */
  guestName: string;
  /** Phone, handle or email, when the channel provides it. */
  guestContact: string;
  /** The message text. */
  text: string;
  /** When the message was sent, as reported by the channel. */
  at: Date;
}

/** An outbound message from the hotel to a guest on a channel. */
export interface OutboundMessage {
  /** The conversation id this reply belongs to. */
  conversationId: string;
  /** The text to send. */
  text: string;
}

/** The result of sending a message. */
export interface SendResult {
  ok: boolean;
  /** The channel's own message id, when the send succeeded. */
  externalId?: string;
  error?: string;
}

/** What a hotel needs to configure before a channel can be used. */
export interface ChannelConfig {
  /** Whether this channel has been set up with real credentials. */
  configured: boolean;
  /** Human-readable description of what's missing, when not configured. */
  missing?: string;
}

/**
 * A channel adapter translates between a messaging platform and InnPilot.
 *
 * `id` must match a value in CHANNELS (whatsapp, instagram, email).
 * `configured()` tells the UI whether this channel is ready to use.
 * `receive()` turns an inbound webhook into an InnPilot message.
 * `send()` delivers a staff reply to the guest.
 * `verifyWebhook()` checks a webhook request's signature (when the platform signs them).
 */
export interface ChannelAdapter {
  readonly id: Channel;
  readonly name: string;
  configured(env: Record<string, string | undefined>): ChannelConfig;
  receive(env: Record<string, string | undefined>, raw: unknown): Promise<InboundMessage | null>;
  send(env: Record<string, string | undefined>, message: OutboundMessage): Promise<SendResult>;
  verifyWebhook?(env: Record<string, string | undefined>, req: unknown, signature?: string): Promise<boolean>;
}

/** Adapters registered by channel id. Empty until adapters are added below. */
const ADAPTERS: Map<Channel, ChannelAdapter> = new Map();

export function registerAdapter(adapter: ChannelAdapter): void {
  ADAPTERS.set(adapter.id, adapter);
}

export function getAdapter(id: Channel): ChannelAdapter | undefined {
  return ADAPTERS.get(id);
}

export function configuredChannels(env: Record<string, string | undefined>): Channel[] {
  return ALL_CHANNELS.filter((channel) => {
    if (channel === "web") return true;
    const adapter = ADAPTERS.get(channel);
    if (!adapter) return false;
    return adapter.configured(env).configured;
  });
}

/** No adapter yet for this channel: it is mocked and requires configuration. */
export function unconfiguredAdapter(id: Channel, name: string, missing: string): ChannelAdapter {
  return {
    id,
    name,
    configured: () => ({ configured: false, missing }),
    receive: async () => null,
    send: async () => ({ ok: false, error: `${name} is not configured. Add credentials in Settings → Channels.` }),
  };
}

/** Register every known channel adapter. WhatsApp is real when configured; Instagram and Email are placeholders. */
export function registerAllAdapters(): void {
  registerAdapter(whatsappAdapter);
  registerAdapter(unconfiguredAdapter("instagram", "Instagram", "Instagram integration is not yet implemented."));
  registerAdapter(unconfiguredAdapter("email", "Email", "Email integration is not yet implemented."));
}

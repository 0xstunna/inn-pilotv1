/**
 * The AI layer's vocabulary.
 *
 * Deliberately free of any vendor type: nothing here mentions Gemini, and
 * nothing outside `gemini.ts` imports the Google SDK. A later model or
 * provider change rewrites one file, not the callers.
 *
 * These types are also the contract the browser sees, so they must stay
 * describable as plain JSON — no Dates, no class instances.
 */

import type {
  GuestRequestCategory,
  GuestRequestPriority,
  GuestRequestType,
} from "../../src/lib/guestRequest.js";

/** A turn in a conversation. "model" is Gemini's word; ours is "assistant". */
export type AiRole = "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

/** What one generation cost, when the provider reports it. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

/** The result of a single model call. */
export interface AiGeneration {
  text: string;
  /** The model that actually served the response. */
  model: string;
  /** Summed over every model call in the turn. */
  usage: AiUsage;
  /** Names of the tools run to produce this reply, in order. */
  toolCalls?: string[];
  /** How many provider retries happened inside this turn (0 = none). */
  retryAttempt?: number;
}

/**
 * A server tool the model may ask to run.
 *
 * `parameters` is a JSON Schema object describing the arguments. Nothing
 * about which hotel a tool serves appears here: that is bound on the
 * server when the tools are created, never supplied by the model.
 */
export interface AiToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

/** One tool invocation the model requested. */
export interface AiToolCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Where one guest turn's time went. Filled in as the turn runs, so a turn
 * that times out or fails still shows how far it got. Logged by the
 * gateway; never sent to the guest.
 */
export interface TurnTrace {
  /** One entry per model request (a retried request counts once), in order. */
  modelCalls: {
    ms: number;
    finishReason?: string;
    inputTokens?: number;
    outputTokens?: number;
    thoughtTokens?: number;
    toolCallsRequested?: number;
    failed?: string;
  }[];
  toolCalls: { name: string; ms: number }[];
}

/** What a tool hands back to the model: plain JSON. */
export type AiToolResult = Record<string, unknown>;

export type AiToolExecutor = (call: AiToolCall) => Promise<AiToolResult>;

/** One guest turn's request to whichever provider is configured (server/ai/provider.ts). */
export interface GenerateInput {
  /** The system instruction. Built by a prompt module, never by a component. */
  system: string;
  /** Chronological turns, oldest first. Must end with a user turn. */
  messages: AiMessage[];
  /** Overrides the configured cap for this one call. */
  maxOutputTokens?: number;
  /** Overrides the configured temperature for this one call. */
  temperature?: number;
  env?: Record<string, string | undefined>;
  /** Server tools the model may call. Requires `executeTool`. */
  tools?: AiToolDefinition[];
  /** Runs a tool the model asked for; its result goes back to the model. */
  executeTool?: AiToolExecutor;
  /** Filled in with per-call timings as the turn runs, including when it fails. */
  trace?: TurnTrace;
}

/**
 * A guest's turn, as the gateway receives it.
 *
 * Every conversation belongs to exactly one hotel. `publicHotelId` is the
 * hotel's own concierge link; it reaches that hotel only (DECISIONS D32).
 * It is always a public id, never a workspace hotelId, and it arrives from
 * an untrusted client.
 */
export interface ConciergeRequest {
  message: string;
  /** Prior turns, oldest first. Trimmed and length-capped by the gateway. */
  history: AiMessage[];
  publicHotelId?: string;
  /** The guest's thread, from an earlier reply. */
  conversationId?: string;
  /** The browser's id for this message, so a retry isn't recorded twice. */
  turnId?: string;
}

/** A nightly rate (or capacity) across several rooms; null when none is recorded. */
export type RateRange = { from: number; to: number } | null;

/** One bookable choice from availability: a room type at a hotel, priced
 * from its cheapest free room for the stay. `hotel` is the public id.
 */
export interface ConciergeOption {
  optionNumber: number;
  hotel: string;
  hotelName: string;
  city: string;
  region: string;
  roomType: string;
  /** Guests the room sleeps, when the hotel recorded it. */
  capacity: number | null;
  availableRooms: number;
  nightlyRate: number;
  nights: number;
  stayTotal: number;
  currency: string;
  amenities: string[];
  /** False when the guest asked for another room type and none was free. */
  matchesRequestedRoomType: boolean;
}

/** Room types free at one hotel for a stay, as check_availability found them. */
export interface ConciergeAvailability {
  hotel: string;
  hotelName: string;
  city: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  currency: string;
  totalAvailable: number;
  roomTypes: {
    roomType: string;
    availableRooms: number;
    capacity: number | null;
    nightlyRate: number;
    stayTotal: number;
  }[];
}

/** A booking the guest is being asked to confirm (prepare_booking said "ready"). */
export interface ConciergeQuote {
  hotel: string;
  hotelName: string;
  city: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  numberOfGuests: number;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  nightlyRate: number;
  totalPrice: number;
  currency: string;
}

/**
 * The quote the guest was shown, kept on the server's copy of the
 * conversation until they confirm it (DECISIONS D27). Never sent to a client.
 */
export interface PendingBooking extends ConciergeQuote {
  /** When prepare_booking produced it (ms). */
  preparedAt: number;
}

/**
 * What the log_guest_request tool returned this turn, allow-listed to the
 * guest so the page can show an acknowledgement with the reference number.
 */
export interface GuestRequestAck {
  id: string;
  reference: string;
  type: GuestRequestType;
  category: GuestRequestCategory;
  priority: GuestRequestPriority;
  department: string;
  duplicate: boolean;
  message: string;
}

/** A reservation create_reservation confirmed this turn. */
export interface ConciergeBooking {
  reservationId: string;
  hotel: string;
  hotelName: string;
  city: string;
  hotelPhone: string;
  hotelEmail: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  numberOfGuests: number;
  guestName: string;
  nightlyRate: number;
  totalPrice: number;
  currency: string;
  paymentStatus: string;
}

/** The gateway's answer. */
export interface ConciergeReply {
  reply: string;
  model: string;
  /** Quotable in a support conversation; identifies nothing else. */
  requestId: string;
  /**
   * Straight from the tool results of this turn, so the page shows figures
   * the hotels' systems produced rather than parsing the model's prose.
   * Each is absent when its tool didn't run (or didn't succeed) this turn.
   */
  availability?: ConciergeAvailability;
  quote?: ConciergeQuote;
  booking?: ConciergeBooking;
  /** Logged guest request/complaint, when the turn recorded one. */
  guestRequest?: GuestRequestAck;
  /** The guest's thread; send it back with the next message. */
  conversationId?: string;
  /** "human" when staff have taken the conversation over and the AI is not replying. */
  handledBy?: "ai" | "human";
  /** How many provider retries happened inside this turn (0 = none). */
  retryAttempt?: number;
}

/** GET /api/ai/hotel: one hotel's public header, for its own concierge link. No hotelId, ever. */
export interface ConciergeHotel {
  publicHotelId: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  currency: string;
  amenities: string[];
  roomTypes: { roomType: string; roomCount: number; nightlyRate: RateRange; capacity: RateRange }[];
}

/**
 * What /api/ai/health reports.
 *
 * `configured` is answerable without spending a token; `reachable` costs a
 * real (tiny) call and is therefore only filled in when explicitly probed.
 */
export interface AiHealthReport {
  configured: boolean;
  model: string | null;
  reachable?: boolean;
  latencyMs?: number;
  /** Why the probe's model call stopped (e.g. STOP, MAX_TOKENS). Informational only. */
  finishReason?: string;
  /** Operator-facing reason a probe failed. Never shown to a guest. */
  error?: string;
}

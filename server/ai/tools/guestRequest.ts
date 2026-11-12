/**
 * log_guest_request — record a guest request or complaint (R13/R14).
 *
 * The model calls this when a guest reports an issue or makes a non-booking
 * request. It validates its enums, dedupes within the conversation, caps the
 * per-conversation rate, then writes the record plus an audit entry through
 * createGuestRequest — all inside the turn's HotelScope.
 *
 * Returns { id, reference, status, department, duplicate } so the model can
 * tell the guest the reference number and that staff will follow up.
 */

import { readHotelArg, type ConciergeTool } from "./types.js";
import { readString } from "./args.js";
import { createGuestRequest, listGuestRequests } from "../guestRequests.js";
import {
  type CreateGuestRequestInput,
  type GuestRequestCategory,
  type GuestRequestPriority,
  type GuestRequestType,
  excerptOf,
} from "../../../src/lib/guestRequest.js";

const VALID_TYPES: GuestRequestType[] = ["request", "complaint", "feedback"];
const VALID_CATEGORIES: GuestRequestCategory[] = [
  "housekeeping", "maintenance", "food_beverage", "front_desk", "noise", "billing", "safety", "other",
];
const VALID_PRIORITIES: GuestRequestPriority[] = ["normal", "high", "urgent"];
const VALID_CHANNELS: ("web" | "whatsapp")[] = ["web", "whatsapp"];

/** How long a request excerpt is remembered for dedupe, in ms. */
const DEDUPE_WINDOW_MS = 60 * 60_000;
/** Max requests one conversation may log in the dedupe window. */
const RATE_LIMIT_PER_CONVERSATION = 5;

/** Read one enum arg, returning null when absent or invalid. */
function readEnum<T extends string>(args: Record<string, unknown>, key: string, valid: T[]): T | undefined {
  const raw = readString(args, key);
  if (!raw) return undefined;
  if (valid.includes(raw as T)) return raw as T;
  return undefined;
}

const notLogged = (reason: string, message: string) => ({
  status: "not_logged" as const,
  reason,
  message,
});

export const guestRequestTool: ConciergeTool = {
  definition: {
    name: "log_guest_request",
    description:
      "Log a guest request or complaint so hotel staff can track and resolve it. Use it when a guest reports an " +
      "issue (dirty room, broken facility, noise, billing problem, safety concern) or asks for something that is " +
      "not a room booking (late checkout, extra towel, taxi, restaurant table). Never promise a refund, " +
      "compensation or a resolution time — just give the guest the reference number and say staff will follow up.",
    parameters: {
      type: "object",
      properties: {
        hotel: { type: "string", description: "The hotel's `hotel` value from this concierge, or its exact hotel name." },
        type: {
          type: "string",
          description: '"request" for a guest asking for something, "complaint" for an issue, "feedback" for a comment.',
        },
        category: {
          type: "string",
          description:
            'One of: housekeeping, maintenance, food_beverage, front_desk, noise, billing, safety, other. Use "safety" for anything urgent.',
        },
        priority: {
          type: "string",
          description: '"normal", "high" or "urgent". Safety issues are urgent; billing/refund is high.',
        },
        channel: { type: "string", description: '"web" or "whatsapp", the channel the message arrived on.' },
        conversationId: { type: "string", description: "The guest thread this record is linked to." },
        guestName: { type: "string", description: "The guest's name, if they gave it." },
        guestPhone: { type: "string", description: "The guest's phone number, if they gave it." },
        guestRoom: { type: "string", description: "The guest's room number, if they gave it." },
        summary: { type: "string", description: "A short staff-facing summary of what the guest needs." },
        guestExcerpt: { type: "string", description: "The guest's own words (kept for staff context, never shown back to the guest)." },
      },
      required: ["type", "category", "priority", "channel", "summary"],
    },
  },

  async run(context, args) {
    const hotel = await readHotelArg(context, args);
    if (hotel.ok === false) return notLogged("unknown_hotel", String(hotel.result.message));
    const { scope } = hotel;

    const type = readEnum(args, "type", VALID_TYPES);
    if (!type) return notLogged("invalid_type", 'type must be one of: request, complaint, feedback.');

    const category = readEnum(args, "category", VALID_CATEGORIES);
    if (!category) return notLogged("invalid_category", "category must be one of: housekeeping, maintenance, food_beverage, front_desk, noise, billing, safety, other.");

    const priority = readEnum(args, "priority", VALID_PRIORITIES);
    if (!priority) return notLogged("invalid_priority", 'priority must be one of: normal, high, urgent.');

    const channel = readEnum(args, "channel", VALID_CHANNELS);
    if (!channel) return notLogged("invalid_channel", 'channel must be "web" or "whatsapp".');

    const summary = readString(args, "summary", 500);
    if (!summary) return notLogged("missing_summary", "Please provide a short summary of the request.");

    const conversationId = readString(args, "conversationId", 100);
    const guestExcerpt = excerptOf(readString(args, "guestExcerpt", 500));
    const guestName = readString(args, "guestName", 120) || undefined;
    const guestPhone = readString(args, "guestPhone", 40) || undefined;
    const guestRoom = readString(args, "guestRoom", 20) || undefined;

    // Dedupe + rate limit within this conversation.
    const now = Date.now();
    const windowStart = now - DEDUPE_WINDOW_MS;
    const recent = (await listGuestRequests(scope)).filter((r) => {
      if (r.conversationId && r.conversationId !== conversationId) return false;
      if (!r.conversationId && conversationId) return false;
      return r.createdAt >= windowStart;
    });

    if (guestExcerpt) {
      const dup = recent.find((r) => r.guestExcerpt === guestExcerpt);
      if (dup) {
        return {
          status: "duplicate" as const,
          id: dup.id,
          reference: dup.id,
          department: dup.department,
          duplicate: true,
          message: "This request was already logged for this conversation.",
        };
      }
    }

    if (recent.length >= RATE_LIMIT_PER_CONVERSATION) {
      return notLogged("rate_limited", "Too many requests in this conversation. Please tell the hotel team directly.");
    }

    const input: CreateGuestRequestInput = {
      type,
      category,
      priority,
      channel,
      ...(conversationId ? { conversationId } : {}),
      ...(guestName ? { guestName } : {}),
      ...(guestPhone ? { guestPhone } : {}),
      ...(guestRoom ? { guestRoom } : {}),
      summary,
      ...(guestExcerpt ? { guestExcerpt } : {}),
    };

    const record = await createGuestRequest(scope, input);

    return {
      status: "logged" as const,
      id: record.id,
      reference: record.id,
      department: record.department,
      duplicate: false,
      message: `Logged as ${record.id}. The hotel team will follow up.`,
    };
  },
};

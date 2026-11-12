/**
 * Per-hotel guest conversations (DECISIONS D32).
 *
 * Every conversation belongs to exactly one hotel, so the conversation has
 * one home per hotel:
 *
 *   conciergeConversations/{id}              the CANONICAL thread (server-only)
 *     hotelId, selectedHotelId, pendingBooking, reservation, messageCount
 *     messages/{messageId}  role, text, at
 *
 *   hotels/{hotelId}/conversations/{id}      that hotel's inbox MIRROR
 *
 * The canonical thread is server-only: firestore.rules' catch-all denies it
 * to every client. The mirrors are the existing per-hotel inbox documents
 * (D19), written by recordTurn(), so lead scoring, follow-ups and handoff work unchanged.
 *
 * Old conversation documents may still carry a `hotelIds[]` array (from the
 * network era). When reading one, the first entry is used as the hotel id.
 */
import type { DocumentReference } from "firebase-admin/firestore";
import { toDate, toMessage, type ConversationMessage, type Handler, type MessageRole } from "../src/lib/conversations.js";
import { MAX_MESSAGE_TEXT } from "../src/lib/conversations.js";
import { adminDb } from "./admin.js";
import type { PendingBooking } from "./ai/types.js";
import { isTurnId, openMirror, readConversation, recordTurn } from "./conversations.js";
import { scopeForHotelId, type HotelScope } from "./hotels.js";

export const GUEST_CONVERSATIONS_COLLECTION = "conciergeConversations";
const BACKFILL_LIMIT = 200;

const CONVERSATION_ID = /^[A-Za-z0-9]{20}$/;

export interface GuestThread {
  id: string;
  ref: DocumentReference;
  exists: boolean;
  /** The public id of the hotel whose own link started this thread. */
  scope: string;
  /** The one hotel's internal id. Server-only. */
  hotelId: string;
  selectedHotelId: string;
  /** The summary the guest was shown and hasn't confirmed yet (D27). */
  pendingBooking: PendingBooking | null;
  reservation: { hotelId: string; reservationId: string } | null;
}

function readPendingBooking(value: unknown): PendingBooking | null {
  if (!value || typeof value !== "object") return null;
  const pending = value as Partial<PendingBooking>;
  return typeof pending.hotel === "string" &&
    typeof pending.roomType === "string" &&
    typeof pending.checkIn === "string" &&
    typeof pending.checkOut === "string" &&
    typeof pending.guestName === "string" &&
    typeof pending.guestPhone === "string" &&
    typeof pending.totalPrice === "number" &&
    typeof pending.preparedAt === "number"
    ? (pending as PendingBooking)
    : null;
}

const readIds = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && id.length > 0) : [];

/** The guest's thread, or a new one when the id is absent, malformed, unknown or from another scope. */
export async function openGuestThread(rawId: unknown, scope: string): Promise<GuestThread> {
  const collection = adminDb().collection(GUEST_CONVERSATIONS_COLLECTION);
  if (typeof rawId === "string" && CONVERSATION_ID.test(rawId)) {
    const ref = collection.doc(rawId);
    const snap = await ref.get();
    const data = snap.data();
    if (snap.exists && data && (typeof data.scope === "string" ? data.scope : "") === scope) {
      const reservation = data.reservation as GuestThread["reservation"] | undefined;
      // Backward compat: old network-era docs carried hotelIds[]; use the first entry.
      const hotelIds = readIds(data.hotelIds);
      const hotelId = hotelIds[0] || typeof data.selectedHotelId === "string" ? data.selectedHotelId : "";
      return {
        id: rawId,
        ref,
        exists: true,
        scope,
        hotelId,
        selectedHotelId: typeof data.selectedHotelId === "string" ? data.selectedHotelId : "",
        pendingBooking: readPendingBooking(data.pendingBooking),
        reservation: reservation?.hotelId && reservation?.reservationId ? reservation : null,
      };
    }
  }
  const ref = collection.doc();
  return { id: ref.id, ref, exists: false, scope, hotelId: "", selectedHotelId: "", pendingBooking: null, reservation: null };
}

/** The scope for one hotel id, reusing any this turn already resolved. Null when it no longer exists. */
export async function scopeForOne(hotelId: string, known: Map<string, HotelScope> = new Map()): Promise<HotelScope | null> {
  return known.get(hotelId) ?? (await scopeForHotelId(hotelId));
}

/** "human" when staff at this hotel have taken this guest over. */
export async function threadHandledBy(thread: GuestThread, scope: HotelScope | null): Promise<Handler> {
  if (!thread.exists || !scope) return "ai";
  const mirror = await openMirror(scope, thread.id);
  return mirror.exists && mirror.handledBy === "human" ? "human" : "ai";
}

export interface GuestTurn {
  guestText: string;
  receivedAt?: number;
  turnId?: string;
  /** Absent when the turn failed. */
  replyText?: string;
  replyRole?: MessageRole;
  /** The hotel the guest is focused on (a summary, a booking, or one hotel's availability). */
  selected?: HotelScope;
  /** undefined leaves it as it is; null clears it. */
  pendingBooking?: PendingBooking | null;
  booking?: {
    scope: HotelScope;
    reservationId: string;
    guestName: string;
    guestPhone: string;
    nights: number;
    guests: number;
    roomType: string;
  };
  /** The source channel of this turn (defaults to "web" in the mirror). */
  channel?: "web" | "whatsapp";
}

/**
 * Records one guest turn: in the canonical thread (one transaction), then in
 * this hotel's inbox mirror.
 */
export async function recordGuestTurn(thread: GuestThread, turn: GuestTurn): Promise<void> {
  const now = Date.now();
  const receivedAt = Math.min(turn.receivedAt ?? now, now);

  const written = await adminDb().runTransaction(async (tx) => {
    const snap = await tx.get(thread.ref);
    const data = snap.data();
    const repeat = isTurnId(turn.turnId) && data?.pendingTurnId === turn.turnId;

    const entries: { role: MessageRole; text: string; at: Date }[] = [];
    if (!repeat) entries.push({ role: "guest", text: turn.guestText, at: new Date(receivedAt) });
    if (turn.replyText) {
      entries.push({ role: turn.replyRole ?? "ai", text: turn.replyText, at: new Date(Math.max(now, receivedAt + 1)) });
    }
    const createdIds: string[] = [];
    for (const entry of entries) {
      const ref = thread.ref.collection("messages").doc();
      tx.create(ref, { ...entry, text: entry.text.slice(0, MAX_MESSAGE_TEXT) });
      createdIds.push(ref.id);
    }

    const bookedHotelId = turn.booking?.scope.hotelId ?? "";
    const selectedHotelId =
      bookedHotelId || turn.selected?.hotelId || (typeof data?.selectedHotelId === "string" ? data.selectedHotelId : "");
    const previous = data?.reservation as GuestThread["reservation"] | undefined;
    const reservation = turn.booking
      ? { hotelId: bookedHotelId, reservationId: turn.booking.reservationId }
      : previous?.hotelId
        ? previous
        : null;

    const summary: Record<string, unknown> = {
      hotelId: selectedHotelId,
      selectedHotelId,
      reservation,
      messageCount: (typeof data?.messageCount === "number" ? data.messageCount : 0) + entries.length,
      pendingTurnId: !turn.replyText && isTurnId(turn.turnId) ? turn.turnId : "",
      updatedAt: new Date(now),
      ...(turn.pendingBooking !== undefined ? { pendingBooking: turn.pendingBooking } : {}),
    };
    if (snap.exists) tx.update(thread.ref, summary);
    else tx.create(thread.ref, { ...summary, scope: thread.scope, hotelId: selectedHotelId, createdAt: new Date(receivedAt) });
    return { selectedHotelId, reservation, createdIds };
  });

  thread.exists = true;
  thread.hotelId = written.selectedHotelId || thread.hotelId;
  thread.selectedHotelId = written.selectedHotelId;
  thread.reservation = written.reservation;
  if (turn.pendingBooking !== undefined) thread.pendingBooking = turn.pendingBooking;

  const scope = thread.hotelId ? await scopeForOne(thread.hotelId) : null;
  if (!scope) return;
  const selected = turn.selected && turn.selected.hotelId === scope.hotelId ? turn.selected : undefined;

  const mirror = await openMirror(scope, thread.id);
  let history: { role: MessageRole; text: string; at: Date }[] | null = null;
  if (!mirror.exists) {
    const created = new Set(written.createdIds);
    const snap = await thread.ref.collection("messages").orderBy("at").limit(BACKFILL_LIMIT).get();
    history = snap.docs
      .filter((doc) => !created.has(doc.id))
      .map((doc) => {
        const message = toMessage(doc.id, doc.data());
        return { role: message.role, text: message.text, at: toDate(doc.data().at) ?? new Date(receivedAt - 1) };
      });
  }

  const guest = turn.pendingBooking ? { name: turn.pendingBooking.guestName, phone: turn.pendingBooking.guestPhone } : undefined;
  const booking = turn.booking && turn.booking.scope.hotelId === scope.hotelId ? turn.booking : undefined;

  try {
    await recordTurn(scope, mirror, {
      guestText: turn.guestText,
      receivedAt,
      turnId: turn.turnId,
      replyText: turn.replyText,
      replyRole: turn.replyRole,
      backfill: mirror.exists ? undefined : (history ?? undefined),
      selection: selected ? "this" : "none",
      selectedHotelName: selected?.profile.name ?? "",
      bookedElsewhere: Boolean(written.reservation && written.reservation.hotelId !== scope.hotelId),
      guest,
      ...(booking
        ? {
            booking: {
              reservationId: booking.reservationId,
              guestName: booking.guestName,
              guestPhone: booking.guestPhone,
              nights: booking.nights,
              guests: booking.guests,
              roomType: booking.roomType,
            },
          }
        : {}),
      ...(turn.pendingBooking
        ? {
            inquiry: {
              checkIn: turn.pendingBooking.checkIn,
              checkOut: turn.pendingBooking.checkOut,
              guestCount: turn.pendingBooking.numberOfGuests,
              roomType: turn.pendingBooking.roomType,
              budget: turn.pendingBooking.totalPrice,
            },
          }
        : {}),
      ...(turn.channel ? { channel: turn.channel } : {}),
    });
  } catch (error) {
    console.error("[concierge] inbox mirror write failed", {
      conversationId: thread.id,
      hotelId: scope.hotelId,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Staff replies for the guest's page, from this hotel's mirror,
 * newer than `afterMs` (server time), and whether staff are handling it.
 * Null when the thread doesn't exist in this scope.
 */
export async function readGuestThreadUpdates(
  rawId: unknown,
  afterMs = 0,
  scope: string = ""
): Promise<{ handledBy: Handler; messages: ConversationMessage[] } | null> {
  if (typeof rawId !== "string" || !CONVERSATION_ID.test(rawId)) return null;
  const thread = await openGuestThread(rawId, scope);
  if (!thread.exists || !thread.hotelId) return null;

  const hotelScope = await scopeForOne(thread.hotelId);
  if (!hotelScope) return null;

  const entry = await readConversation(hotelScope, rawId, afterMs);
  if (!entry) return null;
  return { handledBy: entry.handledBy, messages: entry.messages.filter((message) => message.role === "staff") };
}

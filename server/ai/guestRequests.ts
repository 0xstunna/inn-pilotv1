/**
 * Guest request / complaint records (R13/R14), written through the Admin
 * SDK inside a HotelScope so they can only ever touch the scoped hotel's
 * own `hotels/{hotelId}/guestRequests/…` subtree.
 *
 * Records are created by the `log_guest_request` tool (Task 2) and updated
 * by staff from the requests queue (Task 6). Every create and every status
 * change also writes an audit entry in the same commit.
 */

import type { DocumentData, Transaction } from "firebase-admin/firestore";
import { COLLECTIONS } from "../../src/lib/collections.js";
import {
  departmentFor,
  type CreateGuestRequestInput,
  type GuestRequest,
  type GuestRequestCategory,
  type GuestRequestPriority,
  type GuestRequestStatus,
  type GuestRequestType,
  excerptOf,
  isValidStatusTransition,
  makeRequestId,
} from "../../src/lib/guestRequest.js";
import type { HotelScope } from "../hotels.js";
import { AiInvalidRequestError } from "./errors.js";

const TYPES: Record<GuestRequestType, true> = { request: true, complaint: true, feedback: true };
const CATEGORIES: Record<GuestRequestCategory, true> = {
  housekeeping: true,
  maintenance: true,
  food_beverage: true,
  front_desk: true,
  noise: true,
  billing: true,
  safety: true,
  other: true,
};
const PRIORITIES: Record<GuestRequestPriority, true> = { normal: true, high: true, urgent: true };
const STATUSES: Record<GuestRequestStatus, true> = {
  new: true,
  acknowledged: true,
  in_progress: true,
  resolved: true,
  closed: true,
};

/** A Firestore timestamp, a JS Date, or epoch ms → epoch ms. */
function toMillis(value: unknown): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    const d = (value as { toDate: () => Date }).toDate();
    return d ? d.getTime() : 0;
  }
  return 0;
}

function toGuestRequest(id: string, data: DocumentData): GuestRequest | null {
  if (!data) return null;
  const status: GuestRequestStatus =
    typeof data.status === "string" && data.status in STATUSES ? (data.status as GuestRequestStatus) : "new";
  const rawNotes: Array<{ text?: unknown; at?: unknown; by?: unknown }> = Array.isArray(data.notes) ? data.notes : [];
  return {
    id,
    hotelId: typeof data.hotelId === "string" ? data.hotelId : "",
    type: typeof data.type === "string" && data.type in TYPES ? (data.type as GuestRequestType) : "request",
    category:
      typeof data.category === "string" && data.category in CATEGORIES ? (data.category as GuestRequestCategory) : "other",
    priority:
      typeof data.priority === "string" && data.priority in PRIORITIES ? (data.priority as GuestRequestPriority) : "normal",
    status,
    department: typeof data.department === "string" ? data.department : "",
    assigneeId: typeof data.assigneeId === "string" ? data.assigneeId : undefined,
    assigneeName: typeof data.assigneeName === "string" ? data.assigneeName : undefined,
    channel: data.channel === "whatsapp" ? "whatsapp" : "web",
    conversationId: typeof data.conversationId === "string" ? data.conversationId : undefined,
    guestName: typeof data.guestName === "string" ? data.guestName : undefined,
    guestPhone: typeof data.guestPhone === "string" ? data.guestPhone : undefined,
    guestRoom: typeof data.guestRoom === "string" ? data.guestRoom : undefined,
    summary: typeof data.summary === "string" ? data.summary : "",
    guestExcerpt: typeof data.guestExcerpt === "string" ? data.guestExcerpt : undefined,
    createdAt: toMillis(data.createdAt),
    acknowledgedAt: data.acknowledgedAt === undefined ? undefined : toMillis(data.acknowledgedAt),
    resolvedAt: data.resolvedAt === undefined ? undefined : toMillis(data.resolvedAt),
    notes: rawNotes.map((note) => ({
      text: typeof note.text === "string" ? note.text : "",
      at: toMillis(note.at),
      by: typeof note.by === "string" ? note.by : "system",
    })),
  };
}

/** Write a new request record plus an audit entry, in one commit. */
export async function createGuestRequest(
  scope: HotelScope,
  input: CreateGuestRequestInput
): Promise<GuestRequest> {
  const id = makeRequestId();
  const now = Date.now();
  const record: GuestRequest = {
    id,
    hotelId: scope.hotelId,
    type: input.type,
    category: input.category,
    priority: input.priority,
    status: "new",
    department: departmentFor(input.category),
    channel: input.channel,
    conversationId: input.conversationId,
    guestName: input.guestName,
    guestPhone: input.guestPhone,
    guestRoom: input.guestRoom,
    summary: input.summary.trim().slice(0, 500),
    guestExcerpt: excerptOf(input.guestExcerpt),
    createdAt: now,
    notes: [],
  };

  await scope.runTransaction(async (tx: Transaction) => {
    const ref = scope.collection(COLLECTIONS.GUEST_REQUESTS).doc(id);
    const snap = await tx.get(ref);
    if (snap.exists) {
      throw new AiInvalidRequestError("request_id_taken", "This request reference is already in use. Send again.");
    }
    const createdAt = new Date(now);
    tx.create(ref, {
      ...record,
      hotelId: scope.hotelId,
      createdAt,
      notes: [],
    });
    tx.create(scope.collection(COLLECTIONS.AUDIT).doc(), {
      action: "Request created",
      entity: "guestRequest",
      entityId: id,
      details: `${id} · ${input.type} · ${input.category} · ${input.priority} · via ${input.channel}`,
      hotelId: scope.hotelId,
      at: createdAt,
    });
  });

  return record;
}

/** Read one request by id, within the scoped hotel. */
export async function getGuestRequest(scope: HotelScope, requestId: string): Promise<GuestRequest | null> {
  const snap = await scope.collection(COLLECTIONS.GUEST_REQUESTS).doc(requestId).get();
  return toGuestRequest(snap.id, snap.data() ?? {});
}

/** All requests for the scoped hotel, newest first. Staff-side filtering
 *  happens in memory (the queue page). */
export async function listGuestRequests(scope: HotelScope): Promise<GuestRequest[]> {
  const snap = await scope.collection(COLLECTIONS.GUEST_REQUESTS).orderBy("createdAt", "desc").get();
  return snap.docs
    .map((doc) => toGuestRequest(doc.id, doc.data() ?? {}))
    .filter((r): r is GuestRequest => r !== null);
}

/**
 * Move a request to a new status. Enforces valid transitions in one shared
 * function (isValidStatusTransition), stamps acknowledgedAt/resolvedAt,
 * appends an optional staff note, and writes an audit entry — all in one
 * commit.
 */
export async function updateGuestRequestStatus(
  scope: HotelScope,
  requestId: string,
  nextStatus: GuestRequestStatus,
  options: { note?: string; by?: string } = {}
): Promise<GuestRequest> {
  const now = Date.now();
  return scope.runTransaction(async (tx: Transaction) => {
    const ref = scope.collection(COLLECTIONS.GUEST_REQUESTS).doc(requestId);
    const snap = await tx.get(ref);
    const current = toGuestRequest(snap.id, snap.data() ?? {});
    if (!current) {
      throw new AiInvalidRequestError("request_not_found", `No request ${requestId} for this hotel.`);
    }
    if (!isValidStatusTransition(current.status, nextStatus)) {
      throw new AiInvalidRequestError(
        "invalid_transition",
        `Cannot move ${requestId} from ${current.status} to ${nextStatus}.`
      );
    }

    const nowDate = new Date(now);
    const acknowledgedAt =
      nextStatus === "acknowledged" && !current.acknowledgedAt ? nowDate : current.acknowledgedAt;
    const resolvedAt =
      nextStatus === "resolved" && !current.resolvedAt ? nowDate : current.resolvedAt;
    const notes = options.note
      ? [...current.notes, { text: options.note.trim(), at: now, by: options.by ?? "system" }]
      : current.notes;

    tx.update(ref, {
      status: nextStatus,
      updatedAt: nowDate,
      ...(acknowledgedAt !== current.acknowledgedAt ? { acknowledgedAt } : {}),
      ...(resolvedAt !== current.resolvedAt ? { resolvedAt } : {}),
      ...(options.note ? { notes } : {}),
    });

    tx.create(scope.collection(COLLECTIONS.AUDIT).doc(), {
      action: `Request ${nextStatus}`,
      entity: "guestRequest",
      entityId: requestId,
      details: `${current.status} → ${nextStatus}${options.note ? ` · ${options.note}` : ""}`,
      hotelId: scope.hotelId,
      at: nowDate,
    });

    return {
      ...current,
      status: nextStatus,
      updatedAt: now,
      acknowledgedAt:
        nextStatus === "acknowledged" && !current.acknowledgedAt ? now : current.acknowledgedAt,
      resolvedAt:
        nextStatus === "resolved" && !current.resolvedAt ? now : current.resolvedAt,
      notes,
    };
  });
}

/**
 * Client-side guest request service for the staff requests queue (Task 6).
 *
 * Reads and writes hotels/{hotelId}/guestRequests/{requestId} directly from
 * the browser, gated by firestore.rules (workspaceWrite). Status transitions
 * are enforced with the same shared function the server uses
 * (isValidStatusTransition in src/lib/guestRequest.ts), and every change
 * writes an audit entry.
 *
 * Mirror of server/ai/guestRequests.ts, but for staff clients: no Admin SDK,
 * no HotelScope — just the active workspace's hotelId.
 */

import { useEffect, useState } from "react";
import { getDoc, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { logAction } from "./audit";
import { COLLECTIONS } from "./collections";
import { hotelCollection, hotelDoc } from "./hotelScope";
import { fail, ok, type ServiceResult } from "./serviceResult";
import {
  departmentFor,
  type GuestRequest,
  type GuestRequestCategory,
  type GuestRequestStatus,
  isValidStatusTransition,
  validStatusTransitions,
} from "./guestRequest";

const LIST_LIMIT = 200;

/** Firestore timestamp / Date / ms → ms since epoch. */
function toMillis(value: unknown): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function toGuestRequest(id: string, data: Record<string, unknown>): GuestRequest | null {
  const rawNotes: Array<{ text?: unknown; at?: unknown; by?: unknown }> = Array.isArray(data.notes) ? data.notes : [];
  return {
    id,
    hotelId: typeof data.hotelId === "string" ? data.hotelId : "",
    type: (typeof data.type === "string" ? data.type : "request") as GuestRequest["type"],
    category: (typeof data.category === "string" ? data.category : "other") as GuestRequest["category"],
    priority: (typeof data.priority === "string" ? data.priority : "normal") as GuestRequest["priority"],
    status: (typeof data.status === "string" ? data.status : "new") as GuestRequestStatus,
    department: typeof data.department === "string" ? data.department : departmentFor((typeof data.category === "string" ? data.category : "other") as GuestRequestCategory),
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

export function useGuestRequests(hotelId: string | null): {
  requests: GuestRequest[];
  loading: boolean;
  error: string;
} {
  const [requests, setRequests] = useState<GuestRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!hotelId) {
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(
        hotelCollection(hotelId, COLLECTIONS.GUEST_REQUESTS),
        orderBy("createdAt", "desc"),
        limit(LIST_LIMIT),
      ),
      (snap) => {
        setRequests(
          snap.docs
            .map((d) => toGuestRequest(d.id, d.data() as Record<string, unknown>))
            .filter((r): r is GuestRequest => r !== null),
        );
        setError("");
        setLoading(false);
      },
      (err) => {
        console.error("Failed to read guest requests:", err);
        setError("Couldn't load requests. Check your connection and try again.");
        setLoading(false);
      },
    );
    return () => unsub();
  }, [hotelId]);

  return { requests, loading, error };
}

/** Which statuses staff may move this request to right now. */
export function nextStatuses(current: GuestRequestStatus): GuestRequestStatus[] {
  return validStatusTransitions(current);
}

/**
 * Move a request to a new status, stamping timestamps, appending an optional
 * staff note, and writing an audit entry — all in one commit.
 */
export async function updateGuestRequestStatus(
  hotelId: string,
  requestId: string,
  nextStatus: GuestRequestStatus,
  options: { note?: string; by?: string } = {},
): Promise<ServiceResult<GuestRequest>> {
  try {
    const ref = hotelDoc(hotelId, COLLECTIONS.GUEST_REQUESTS, requestId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return fail("This request no longer exists.");
    const current = toGuestRequest(snap.id, snap.data() as Record<string, unknown>);
    if (!current) return fail("This request no longer exists.");
    if (!isValidStatusTransition(current.status, nextStatus)) {
      return fail(`Can't move ${requestId} from ${current.status} to ${nextStatus}.`);
    }

    const now = Date.now();
    const nowDate = new Date(now);
    const acknowledgedAt =
      nextStatus === "acknowledged" && !current.acknowledgedAt ? nowDate : new Date(current.acknowledgedAt ?? now);
    const resolvedAt =
      nextStatus === "resolved" && !current.resolvedAt ? nowDate : new Date(current.resolvedAt ?? now);
    const notes = options.note
      ? [...current.notes, { text: options.note.trim(), at: now, by: options.by ?? "Staff" }]
      : current.notes;

    const payload: Record<string, unknown> = {
      status: nextStatus,
      updatedAt: nowDate,
      ...(acknowledgedAt.getTime() !== current.acknowledgedAt ? { acknowledgedAt } : {}),
      ...(resolvedAt.getTime() !== current.resolvedAt ? { resolvedAt } : {}),
      ...(options.note ? { notes } : {}),
    };
    await updateDoc(ref, payload);

    logAction(
      hotelId,
      `Request ${nextStatus}${options.note ? ` · ${options.note}` : ""}`,
      "guestRequest",
      requestId,
      `${current.status} → ${nextStatus}`,
    );

    return ok({
      ...current,
      status: nextStatus,
      updatedAt: now,
      acknowledgedAt: acknowledgedAt.getTime(),
      resolvedAt: resolvedAt.getTime(),
      notes,
    });
  } catch (err) {
    console.error("Failed to update request:", err);
    return fail("Couldn't update this request. Please try again.");
  }
}

/** Append an internal staff note to a request (guests never see it). */
export async function addGuestRequestNote(
  hotelId: string,
  requestId: string,
  staffName: string,
  text: string,
): Promise<ServiceResult<GuestRequest>> {
  const body = text.trim();
  if (!body) return fail("Write a note first.");

  try {
    const ref = hotelDoc(hotelId, COLLECTIONS.GUEST_REQUESTS, requestId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return fail("This request no longer exists.");
    const current = toGuestRequest(snap.id, snap.data() as Record<string, unknown>);
    if (!current) return fail("This request no longer exists.");

    const now = Date.now();
    const notes = [...current.notes, { text: body, at: now, by: staffName }];
    await updateDoc(ref, { notes, updatedAt: new Date(now) });

    logAction(hotelId, "Request note added", "guestRequest", requestId, body.slice(0, 120));

    return ok({
      ...current,
      updatedAt: now,
      notes,
    });
  } catch (err) {
    console.error("Failed to add note:", err);
    return fail("Couldn't add the note. Please try again.");
  }
}

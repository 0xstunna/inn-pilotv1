/**
 * Rooms — configure and manage this hotel's room inventory.
 *
 * Rooms are created and managed ONLY here (not at registration). Reads
 * hotels/{hotelId}/rooms live from Firestore. Staff can add, edit and
 * delete rooms; each room has a number, type, nightly rate and status.
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Edit2, RefreshCw } from "lucide-react";
import {
  doc,
  onSnapshot,
  orderBy,
  query,
  deleteDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

import { useWorkspace } from "../workspace/workspaceContext";
import { useHotelProfile } from "../lib/hotelProfile";
import {
  PageHeader,
  EmptyState,
  useToast,
  StatCard,
  StatGrid,
} from "../components/ui";
import { COLLECTIONS, ROOM_TYPES, type RoomStatus, type RoomType } from "../lib/collections";
import { hotelCollection } from "../lib/hotelScope";
import { money } from "../lib/format";

interface Room {
  id: string;
  hotelId: string;
  number: string;
  type: RoomType;
  price: number;
  status: RoomStatus;
  createdAt: Date | null;
}

type RoomDraft = Pick<Room, "number" | "type" | "price" | "status">;

const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  Available: "Available",
  Occupied: "Occupied",
  Cleaning: "Cleaning",
  Maintenance: "Maintenance",
  "Out of Service": "Out of Service",
};

const ROOM_STATUS_TONE: Record<RoomStatus, string> = {
  Available: "badge-success",
  Occupied: "badge-info",
  Cleaning: "badge-warning",
  Maintenance: "badge-danger",
  "Out of Service": "badge-neutral",
};

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function toRoom(id: string, data: Record<string, unknown>): Room {
  const createdAt = asDate(data.createdAt);
  return {
    id,
    hotelId: typeof data.hotelId === "string" ? data.hotelId : "",
    number: typeof data.number === "string" ? data.number : "",
    type: (typeof data.type === "string" && ROOM_TYPES.includes(data.type as RoomType)
      ? data.type
      : "Single") as RoomType,
    price: typeof data.price === "number" ? data.price : 0,
    status: (typeof data.status === "string" && data.status in ROOM_STATUS_LABEL
      ? data.status
      : "Available") as RoomStatus,
    createdAt,
  };
}

export default function Rooms() {
  const { hotelId: workspaceHotelId } = useWorkspace();
  const hotelId = workspaceHotelId ?? "";
  const { profile } = useHotelProfile(hotelId);
  const toast = useToast();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const currency = profile?.currency || "UGX";

  // Add/edit draft state (lazy-initialized per room)
  const [drafts, setDrafts] = useState<Record<string, RoomDraft>>({});

  useEffect(() => {
    if (!hotelId) {
      setRooms([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(hotelCollection(hotelId, COLLECTIONS.ROOMS), orderBy("number", "asc")),
      (snap) => {
        setRooms(snap.docs.map((d) => toRoom(d.id, d.data() as Record<string, unknown>)));
        setError("");
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load rooms:", err);
        setError("Couldn't load rooms. Check your connection and try again.");
        setLoading(false);
      },
    );
    return () => unsub();
  }, [hotelId]);

  const availableCount = rooms.filter((r) => r.status === "Available").length;
  const occupiedCount = rooms.filter((r) => r.status === "Occupied").length;

  const startEdit = (room: Room) => {
    setEditingId(room.id);
    setDrafts((prev) => ({
      ...prev,
      [room.id]: { number: room.number, type: room.type, price: room.price, status: room.status },
    }));
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async (room: Room, draft: RoomDraft) => {
    if (!draft.number.trim()) {
      toast.error("Enter a room number.");
      return;
    }
    try {
      // updateDoc keeps hotelId/createdAt and any other fields intact.
      await updateDoc(doc(hotelCollection(hotelId, COLLECTIONS.ROOMS), room.id), {
        number: draft.number.trim(),
        type: draft.type,
        price: draft.price,
        status: draft.status,
        updatedAt: serverTimestamp(),
      });
      toast.success(`Room ${draft.number.trim()} updated`);
      setEditingId(null);
    } catch {
      toast.error("Couldn't save the room. Please try again.");
    }
  };

  const deleteRoom = async (room: Room) => {
    if (!window.confirm(`Delete room ${room.number}? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(hotelCollection(hotelId, COLLECTIONS.ROOMS), room.id));
      toast.success(`Room ${room.number} deleted`);
    } catch {
      toast.error("Couldn't delete the room. Please try again.");
    }
  };

  const addRoom = async () => {
    const numbers = new Set(rooms.map((r) => r.number));
    let nextNumber = 101;
    while (numbers.has(String(nextNumber))) nextNumber++;
    try {
      await setDoc(doc(hotelCollection(hotelId, COLLECTIONS.ROOMS)), {
        hotelId,
        number: String(nextNumber),
        type: "Single",
        price: 0,
        status: "Available",
        createdAt: serverTimestamp(),
      });
      toast.success(`Room ${nextNumber} added`);
    } catch {
      toast.error("Couldn't add the room. Please try again.");
    }
  };

  const visibleRooms = useMemo(() => rooms, [rooms]);

  if (!loading && rooms.length === 0) {
    return (
      <div className="space-y-5">
        <PageHeader title="Rooms" subtitle="Configure your room inventory before accepting bookings" />
        <div className="card">
          <EmptyState
            icon={<Plus size={22} />}
            title="No rooms yet"
            description="Add your first room to start accepting bookings. Each room needs a number, type, nightly rate and status."
            action={
              <button
                type="button"
                className="btn btn-primary"
                onClick={addRoom}
              >
                <Plus size={15} /> Add room
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Rooms" subtitle="Manage your room inventory" />

      {error && (
        <div className="card p-4 text-sm" role="alert" style={{ color: "var(--danger-text)", borderColor: "var(--danger-border)" }}>
          {error}
        </div>
      )}

      <StatGrid>
        <StatCard label="Total rooms" value={String(rooms.length)} icon={<RefreshCw size={18} />} />
        <StatCard label="Available" value={String(availableCount)} icon={<RefreshCw size={18} />} tone="success" />
        <StatCard label="Occupied" value={String(occupiedCount)} icon={<RefreshCw size={18} />} tone="warning" />
      </StatGrid>

      <div className="card overflow-hidden min-h-[400px]">
        <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <h3 className="font-semibold" style={{ color: "var(--text)" }}>{rooms.length} room{rooms.length === 1 ? "" : "s"}</h3>
            <p className="text-xs muted">Currency: {currency}</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={addRoom}>
            <Plus size={15} /> Add room
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm divide-y divide-border">
            <thead>
              <tr className="text-xs uppercase muted">
                <th className="text-left px-4 py-3">Number</th>
                <th className="text-left px-4 py-3">Type</th>
                <th className="text-left px-4 py-3">Price/night</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-right px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRooms.map((room) => (
                <tr key={room.id} className="hover:bg-surface-muted">
                  {editingId === room.id ? (
                    <EditRow draft={drafts[room.id]!} onSave={(draft) => saveEdit(room, draft)} onCancel={cancelEdit} />
                  ) : (
                    <>
                      <td className="px-4 py-3" style={{ color: "var(--text)" }}>{room.number}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{room.type}</td>
                      <td className="px-4 py-3" style={{ color: "var(--text-secondary)" }}>{money(room.price, currency)}</td>
                      <td className="px-4 py-3">
                        <span className={`badge badge-plain ${ROOM_STATUS_TONE[room.status]}`}>
                          {ROOM_STATUS_LABEL[room.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => startEdit(room)}
                          className="btn btn-ghost btn-sm"
                          title="Edit room"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteRoom(room)}
                          className="btn btn-ghost btn-sm"
                          title="Delete room"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rooms.length === 0 && (
          <div className="card">
            <EmptyState icon={<Plus size={22} />} title="No rooms yet" description="Add your first room to start accepting bookings." />
          </div>
        )}
      </div>
    </div>
  );
}

function EditRow({
  draft,
  onSave,
  onCancel,
}: {
  draft: RoomDraft;
  onSave: (draft: RoomDraft) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [localDraft, setLocalDraft] = useState<RoomDraft>(draft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLocalDraft(draft);
  }, [draft]);

  const number = localDraft.number;
  const type = localDraft.type;
  const price = localDraft.price;
  const status = localDraft.status;

  return (
    <>
      <td className="px-4 py-3">
        <input
          className="input h-9 w-full text-sm"
          value={number}
          onChange={(e) => setLocalDraft((d) => ({ ...d, number: e.target.value }))}
        />
      </td>
      <td className="px-4 py-3">
        <select
          className="select h-9 w-full text-sm"
          value={type}
          onChange={(e) => setLocalDraft((d) => ({ ...d, type: e.target.value as RoomType }))}
        >
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3">
        <input
          className="input h-9 w-full text-sm"
          type="number"
          min="0"
          value={price}
          onChange={(e) => setLocalDraft((d) => ({ ...d, price: Number(e.target.value) || 0 }))}
        />
      </td>
      <td className="px-4 py-3">
        <select
          className="select h-9 w-full text-sm"
          value={status}
          onChange={(e) => setLocalDraft((d) => ({ ...d, status: e.target.value as RoomStatus }))}
        >
          {(Object.keys(ROOM_STATUS_LABEL) as RoomStatus[]).map((s) => (
            <option key={s} value={s}>
              {ROOM_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(localDraft);
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving || !localDraft.number.trim()}
          className="btn btn-sm btn-primary"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} className="btn btn-sm btn-ghost">
          Cancel
        </button>
      </td>
    </>
  );
}

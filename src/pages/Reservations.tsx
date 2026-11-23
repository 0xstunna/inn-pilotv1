/**
 * Reservations — every booking made for this hotel, whether by the AI
 * concierge or at the front desk.
 *
 * Reads hotels/{hotelId}/accomodation live from Firestore (realtime), so
 * new bookings from the concierge appear within seconds. Staff can update
 * a booking's status (check in, check out, cancel), record manual payments
 * and open the source conversation from the inbox.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CreditCard,
  MessagesSquare,
  ShieldAlert,
  Ticket,
} from "lucide-react";
import { onSnapshot, query, orderBy, Timestamp, updateDoc, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { Link, useNavigate } from "react-router-dom";
import { db } from "../../firebase";

import { useWorkspace } from "../workspace/workspaceContext";
import { useHotelProfile } from "../lib/hotelProfile";
import {
  PageHeader,
  EmptyState,
  StatCard,
  StatGrid,
  SegmentedControl,
  useToast,
} from "../components/ui";
import { COLLECTIONS, BOOKING_STATUSES, PAYMENT_METHODS, type BookingStatus, type PaymentMethod } from "../lib/collections";
import { derivePaymentStatus, type PaymentEntry, type PaymentStatus } from "../lib/booking";
import { hotelCollection } from "../lib/hotelScope";
import { money, dateShort } from "../lib/format";

type BookingStatusValue = BookingStatus;

interface Booking {
  id: string;
  reservationId: string;
  conversationId: string;
  guestName: string;
  guestPhoneNumber: string;
  guestEmail?: string;
  roomNumber: string;
  roomType: string;
  numberOfGuests: number;
  checkIn: Date | null;
  checkOut: Date | null;
  pricePaid: number;
  paymentStatus: PaymentStatus;
  paymentHistory: PaymentEntry[];
  notes?: string;
  status: BookingStatusValue;
  hotelId: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  source?: string;
  totalAmount?: number;
  quotedTotal?: number;
}

type StatusFilter = "all" | BookingStatusValue;
type PaymentFilter = "all" | PaymentStatus;

const BOOKING_STATUS_LABEL: Record<BookingStatusValue, string> = {
  Confirmed: "Confirmed",
  "Checked In": "Checked In",
  "Checked Out": "Checked Out",
  Cancelled: "Cancelled",
  "No Show": "No Show",
};

const BOOKING_STATUS_TONE: Record<BookingStatusValue, string> = {
  Confirmed: "badge-info",
  "Checked In": "badge-success",
  "Checked Out": "badge-neutral",
  Cancelled: "badge-danger",
  "No Show": "badge-neutral",
};

const PAYMENT_TONE: Record<PaymentStatus, string> = {
  Unpaid: "badge-danger",
  Pending: "badge-warning",
  Paid: "badge-success",
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

function toBooking(id: string, data: Record<string, unknown>): Booking {
  const createdAt = asDate(data.createdAt);
  const updatedAt = asDate(data.updatedAt);
  const checkIn = asDate(data.checkIn);
  const checkOut = asDate(data.checkOut);
  return {
    id,
    reservationId: typeof data.reservationId === "string" ? data.reservationId : "",
    conversationId: typeof data.conversationId === "string" ? data.conversationId : "",
    guestName: typeof data.guestName === "string" ? data.guestName : "Guest",
    guestPhoneNumber: typeof data.guestPhoneNumber === "string" ? data.guestPhoneNumber : "",
    guestEmail: typeof data.guestEmail === "string" ? data.guestEmail : undefined,
    roomNumber: typeof data.roomNumber === "string" ? data.roomNumber : "",
    roomType: typeof data.roomType === "string" ? data.roomType : "",
    numberOfGuests: typeof data.numberOfGuests === "number" ? data.numberOfGuests : 1,
    checkIn,
    checkOut,
    pricePaid: typeof data.pricePaid === "number" ? data.pricePaid : 0,
    paymentStatus: (data.paymentStatus === "Paid" || data.paymentStatus === "Pending" || data.paymentStatus === "Unpaid"
      ? data.paymentStatus
      : "Unpaid") as PaymentStatus,
    paymentHistory: Array.isArray(data.paymentHistory) ? data.paymentHistory as PaymentEntry[] : [],
    notes: typeof data.notes === "string" ? data.notes : undefined,
    status: (typeof data.status === "string" && data.status in BOOKING_STATUS_LABEL
      ? data.status
      : "Confirmed") as BookingStatusValue,
    hotelId: typeof data.hotelId === "string" ? data.hotelId : "",
    createdAt,
    updatedAt,
    source: typeof data.source === "string" ? data.source : undefined,
    totalAmount: typeof data.totalAmount === "number" ? data.totalAmount : undefined,
    quotedTotal: typeof data.quotedTotal === "number" ? data.quotedTotal : undefined,
  };
}

export default function Reservations() {
  const { hotelId: workspaceHotelId } = useWorkspace();
  const hotelId = workspaceHotelId ?? "";
  const { profile } = useHotelProfile(hotelId);
  const navigate = useNavigate();
  const toast = useToast();

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState({
    amount: "",
    method: "Cash" as PaymentMethod,
    reference: "",
    note: "",
  });
  const [recordingPayment, setRecordingPayment] = useState(false);

  useEffect(() => {
    setPaymentDraft({ amount: "", method: "Cash", reference: "", note: "" });
  }, [selectedId]);

  useEffect(() => {
    if (!hotelId) {
      setBookings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      query(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), orderBy("createdAt", "desc")),
      (snap) => {
        setBookings(snap.docs.map((d) => toBooking(d.id, d.data() as Record<string, unknown>)));
        setError("");
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load bookings:", err);
        setError("Couldn't load bookings. Check your connection and try again.");
        setLoading(false);
      },
    );
    return () => unsub();
  }, [hotelId]);

  const currency = profile?.currency || "UGX";

  const visible = useMemo(() => {
    return bookings.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (paymentFilter !== "all" && b.paymentStatus !== paymentFilter) return false;
      if (dateFrom && b.checkIn && b.checkIn < new Date(dateFrom)) return false;
      if (dateTo && b.checkOut && b.checkOut > new Date(dateTo + "T23:59:59")) return false;
      return true;
    });
  }, [bookings, statusFilter, paymentFilter, dateFrom, dateTo]);

  const dayAgo = Date.now() - 24 * 60 * 60_000;
  const isNew = (b: Booking) => (b.createdAt?.getTime() ?? 0) >= dayAgo;
  const newCount = bookings.filter(isNew).length;
  const checkedInCount = bookings.filter((b) => b.status === "Checked In").length;

  const balanceDue = (b: Booking) => {
    const total = b.totalAmount ?? b.quotedTotal ?? 0;
    return Math.max(0, total - (b.pricePaid || 0));
  };

  const updateStatus = async (booking: Booking, nextStatus: BookingStatusValue) => {
    if (updating) return;
    setUpdating(booking.id);
    try {
      await updateDoc(doc(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), booking.id), {
        status: nextStatus,
        updatedAt: new Date(),
      });
      toast.success(`Booking ${booking.reservationId} is now ${nextStatus}`);
    } catch {
      toast.error("Couldn't update this booking. Please try again.");
    } finally {
      setUpdating(null);
    }
  };

  const recordPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || recordingPayment) return;
    const amount = Number(paymentDraft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Enter an amount greater than zero.");
      return;
    }
    const balance = balanceDue(selected);
    if (balance > 0 && amount > balance) {
      toast.error(`That is more than the ${money(balance, currency)} balance due.`);
      return;
    }
    setRecordingPayment(true);
    const bookingRef = doc(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), selected.id);
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(bookingRef);
        if (!snap.exists()) throw new Error("Booking no longer exists");
        const data = snap.data() as Record<string, unknown>;
        const currentPaid = typeof data.pricePaid === "number" ? data.pricePaid : 0;
        const total = typeof data.totalAmount === "number"
          ? data.totalAmount
          : typeof data.quotedTotal === "number" ? data.quotedTotal : 0;
        const newPaid = currentPaid + amount;
        const history = Array.isArray(data.paymentHistory) ? data.paymentHistory : [];
        const entry: PaymentEntry = {
          amount,
          method: paymentDraft.method,
          ...(paymentDraft.reference.trim() ? { reference: paymentDraft.reference.trim() } : {}),
          ...(paymentDraft.note.trim() ? { note: paymentDraft.note.trim() } : {}),
          recordedAt: serverTimestamp(),
          recordedBy: "Staff",
        };
        tx.update(bookingRef, {
          pricePaid: newPaid,
          paymentStatus: derivePaymentStatus(total, newPaid),
          paymentHistory: [...history, entry],
          updatedAt: serverTimestamp(),
        });
      });
      toast.success(`Recorded ${money(amount, currency)} for ${selected.reservationId}`);
      setPaymentDraft({ amount: "", method: "Cash", reference: "", note: "" });
    } catch {
      toast.error("Couldn't record the payment. Please try again.");
    } finally {
      setRecordingPayment(false);
    }
  };

  const goToConversation = (conversationId: string) => {
    navigate("/dashboard/inbox");
    toast.success(`Open conversation ${conversationId} in the Inbox to view the thread.`);
  };

  const selected = bookings.find((b) => b.id === selectedId) ?? null;

  const statusOptions: { key: StatusFilter; label: string }[] = [
    { key: "all", label: `All ${bookings.length}` },
    ...BOOKING_STATUSES.map((k) => ({ key: k, label: `${BOOKING_STATUS_LABEL[k]} ${bookings.filter((b) => b.status === k).length}` })),
  ];

  const paymentOptions: { key: PaymentFilter; label: string }[] = [
    { key: "all", label: `All ${bookings.length}` },
    { key: "Unpaid", label: `Unpaid ${bookings.filter((b) => b.paymentStatus === "Unpaid").length}` },
    { key: "Pending", label: `Pending ${bookings.filter((b) => b.paymentStatus === "Pending").length}` },
    { key: "Paid", label: `Paid ${bookings.filter((b) => b.paymentStatus === "Paid").length}` },
  ];

  const totalValue = bookings.reduce((s, b) => s + (b.totalAmount ?? b.quotedTotal ?? 0), 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reservations"
        subtitle="All bookings for this property, updated live from the concierge and front desk"
      />

      {error && (
        <div className="card p-4 text-sm" role="alert" style={{ color: "var(--danger-text)", borderColor: "var(--danger-border)" }}>
          {error}
        </div>
      )}

      <StatGrid>
        <StatCard label="Total bookings" value={String(bookings.length)} icon={<Ticket size={18} />} />
        <StatCard
          label="New bookings (24h)"
          value={String(newCount)}
          icon={<ShieldAlert size={18} />}
          tone="warning"
          hint={newCount > 0 ? "check these first" : "all caught up"}
        />
        <StatCard
          label="Checked in"
          value={String(checkedInCount)}
          icon={<CreditCard size={18} />}
          tone="success"
        />
        <StatCard label="Total value" value={money(totalValue, currency)} icon={<ArrowRight size={18} />} />
      </StatGrid>

      {!loading && bookings.length === 0 ? (
        !error && (
          <div className="card">
            <EmptyState
              icon={<Ticket size={22} />}
              title="No bookings yet"
              description="When a guest confirms a booking through your concierge, or you add one at the front desk, it will appear here."
              action={
                <Link
                  to="/dashboard/rooms"
                  className="inline-flex items-center gap-2 text-sm font-semibold"
                  style={{ color: "var(--primary)" }}
                >
                  Set up rooms <ArrowRight size={14} />
                </Link>
              }
            />
          </div>
        )
      ) : (
        <div className="card overflow-hidden min-h-[560px]">
          <div className="p-3 space-y-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <SegmentedControl label="Filter by status" value={statusFilter} options={statusOptions} onChange={(key) => setStatusFilter(key)} />
            <SegmentedControl label="Filter by payment" value={paymentFilter} options={paymentOptions} onChange={(key) => setPaymentFilter(key)} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-[11px] uppercase muted tracking-wider block mb-1">From</label>
                <input
                  type="date"
                  className="input h-10 w-full text-sm"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="text-[11px] uppercase muted tracking-wider block mb-1">To</label>
                <input
                  type="date"
                  className="input h-10 w-full text-sm"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="skeleton" style={{ height: 72 }} />
                ))}
              </div>
            ) : visible.length === 0 ? (
              <p className="p-6 text-sm text-center muted">No bookings match this filter.</p>
            ) : (
              <div className="divide-y divide-border">
                {visible.map((booking) => (
                  <div
                    key={booking.id}
                    className="px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer hover:bg-surface-muted"
                    onClick={() => setSelectedId(selectedId === booking.id ? null : booking.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-semibold truncate" style={{ color: "var(--text)" }}>
                          {booking.guestName}
                        </span>
                        <span className="text-xs muted shrink-0">
                          {booking.reservationId}
                        </span>
                      </div>
                      <span className="block text-sm truncate mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        Room {booking.roomNumber} ({booking.roomType}) · {booking.numberOfGuests} guest{booking.numberOfGuests === 1 ? "" : "s"}
                      </span>
                      <span className="block text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {dateShort(booking.checkIn)} → {dateShort(booking.checkOut)}
                      </span>
                      <span className="flex flex-wrap gap-1.5 mt-2">
                        <span className={`badge badge-plain ${BOOKING_STATUS_TONE[booking.status]}`}>
                          {BOOKING_STATUS_LABEL[booking.status]}
                        </span>
                        {isNew(booking) && <span className="badge badge-plain badge-info">New</span>}
                        <span className={`badge badge-plain ${PAYMENT_TONE[booking.paymentStatus] ?? "badge-neutral"}`}>
                          {booking.paymentStatus}
                        </span>
                        <span className="badge badge-plain badge-neutral">
                          {money(balanceDue(booking), currency)} due
                        </span>
                        {booking.conversationId && (
                          <button
                            type="button"
                            className="text-xs font-semibold"
                            style={{ color: "var(--primary)" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              goToConversation(booking.conversationId);
                            }}
                          >
                            View conversation
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {booking.status === "Confirmed" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateStatus(booking, "Checked In");
                          }}
                          disabled={updating === booking.id}
                          className="btn btn-sm btn-primary"
                        >
                          Check in
                        </button>
                      )}
                      {booking.status === "Checked In" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateStatus(booking, "Checked Out");
                          }}
                          disabled={updating === booking.id}
                          className="btn btn-sm btn-secondary"
                        >
                          Check out
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateStatus(booking, "Cancelled");
                        }}
                        disabled={updating === booking.id}
                        className="btn btn-sm btn-ghost"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {selected && (
        <div className="card">
          <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <h3 className="font-semibold" style={{ color: "var(--text)" }}>Booking details</h3>
              <p className="text-xs muted">{selected.reservationId} · {selected.guestName}</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelectedId(null)}>
              <span className="text-[14px]">&times;</span>
            </button>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Guest</p>
                <p className="text-sm" style={{ color: "var(--text)" }}>{selected.guestName}</p>
                {selected.guestPhoneNumber && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{selected.guestPhoneNumber}</p>}
                {selected.guestEmail && <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>{selected.guestEmail}</p>}
              </div>
              <div>
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Room</p>
                <p className="text-sm" style={{ color: "var(--text)" }}>
                  {selected.roomNumber} · {selected.roomType}
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
                  {selected.numberOfGuests} guest{selected.numberOfGuests === 1 ? "" : "s"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Dates</p>
                <p className="text-sm" style={{ color: "var(--text)" }}>
                  {dateShort(selected.checkIn)} → {dateShort(selected.checkOut)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Status</p>
                <span className={`badge ${BOOKING_STATUS_TONE[selected.status]}`}>
                  {BOOKING_STATUS_LABEL[selected.status]}
                </span>
              </div>
              <div>
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Payment</p>
                <span className={`badge badge-plain ${PAYMENT_TONE[selected.paymentStatus] ?? "badge-neutral"}`}>
                  {selected.paymentStatus}
                </span>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Total / paid / balance</p>
                <div className="text-sm font-mono" style={{ color: "var(--text)" }}>
                  {money(selected.totalAmount ?? selected.quotedTotal ?? 0, currency)} /{' '}
                  {money(selected.pricePaid, currency)} /{' '}
                  {money(balanceDue(selected), currency)} due
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <p className="text-[11px] uppercase muted tracking-wider">Manual payment</p>
                {balanceDue(selected) > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-semibold"
                    style={{ color: "var(--primary)" }}
                    onClick={() => setPaymentDraft((d) => ({ ...d, amount: String(balanceDue(selected)) }))}
                  >
                    Use balance due
                  </button>
                ) : (
                  <span className="text-xs muted">Paid in full</span>
                )}
              </div>
              <form onSubmit={recordPayment} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] uppercase muted tracking-wider block mb-1" htmlFor="payment-amount">
                    Amount ({currency})
                  </label>
                  <input
                    id="payment-amount"
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    className="input h-10 w-full text-sm"
                    placeholder="0"
                    value={paymentDraft.amount}
                    onChange={(e) => setPaymentDraft((d) => ({ ...d, amount: e.target.value }))}
                    disabled={recordingPayment}
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase muted tracking-wider block mb-1" htmlFor="payment-method">
                    Method
                  </label>
                  <select
                    id="payment-method"
                    className="select h-10 w-full text-sm"
                    value={paymentDraft.method}
                    onChange={(e) => setPaymentDraft((d) => ({ ...d, method: e.target.value as PaymentMethod }))}
                    disabled={recordingPayment}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>{method}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] uppercase muted tracking-wider block mb-1" htmlFor="payment-reference">
                    Reference <span className="font-normal normal-case">(optional)</span>
                  </label>
                  <input
                    id="payment-reference"
                    className="input h-10 w-full text-sm"
                    placeholder="e.g. receipt or transaction ID"
                    maxLength={120}
                    value={paymentDraft.reference}
                    onChange={(e) => setPaymentDraft((d) => ({ ...d, reference: e.target.value }))}
                    disabled={recordingPayment}
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase muted tracking-wider block mb-1" htmlFor="payment-note">
                    Note <span className="font-normal normal-case">(optional)</span>
                  </label>
                  <input
                    id="payment-note"
                    className="input h-10 w-full text-sm"
                    placeholder="e.g. deposit on arrival"
                    maxLength={240}
                    value={paymentDraft.note}
                    onChange={(e) => setPaymentDraft((d) => ({ ...d, note: e.target.value }))}
                    disabled={recordingPayment}
                  />
                </div>
                <div className="sm:col-span-2">
                  <button type="submit" className="btn btn-primary btn-sm" disabled={recordingPayment || !paymentDraft.amount.trim()}>
                    {recordingPayment ? "Recording…" : "Record payment"}
                  </button>
                  <p className="text-[11px] muted mt-2">
                    Payments are recorded manually by staff. No card is charged and no online payment is taken.
                  </p>
                </div>
              </form>

              {selected.paymentHistory.length > 0 && (
                <div className="mt-4">
                  <p className="text-[11px] uppercase muted tracking-wider mb-2">Payment history</p>
                  <ul className="space-y-2">
                    {selected.paymentHistory.map((entry, index) => (
                      <li
                        key={`${index}-${entry.recordedAt ? String(entry.recordedAt) : "payment"}`}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs rounded-lg px-3 py-2"
                        style={{ background: "var(--surface-muted)", color: "var(--text-secondary)" }}
                      >
                        <span className="font-semibold" style={{ color: "var(--text)" }}>
                          {money(entry.amount, currency)} · {entry.method}
                        </span>
                        <span>
                          {entry.reference && `${entry.reference} · `}
                          {asDate(entry.recordedAt) ? dateShort(asDate(entry.recordedAt)) : "—"}
                        </span>
                        {entry.note && <span className="w-full muted">{entry.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {selected.notes && (
              <div>
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Notes</p>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{selected.notes}</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase muted tracking-wider">Source:</span>
              <span className="text-xs muted">
                {selected.source === "concierge" ? "AI Concierge (Web chat)" : selected.source || "Front desk"}
              </span>
              {selected.conversationId && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => goToConversation(selected.conversationId)}
                >
                  <MessagesSquare size={14} /> Open conversation
                </button>
              )}
            </div>
            <div className="pt-4 border-t border-border">
              <p className="text-[11px] uppercase muted tracking-wider mb-2">Change status</p>
              <div className="flex flex-wrap gap-2">
                {BOOKING_STATUSES.filter((s) => s !== selected.status).map((next) => (
                  <button
                    key={next}
                    type="button"
                    onClick={() => updateStatus(selected, next)}
                    disabled={updating === selected.id}
                    className={`btn btn-sm ${next === "Cancelled" ? "btn-ghost" : "btn-secondary"}`}
                  >
                    {next}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

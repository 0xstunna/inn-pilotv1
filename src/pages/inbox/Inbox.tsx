/**
 * Inbox — the hotel's live guest conversations.
 *
 * Web is the only live channel: the AI concierge records each guest thread
 * as they chat. The default queue is the short list of guests the hotel still
 * owes something; everything else is one click away under All. Filter
 * details live behind "More filters" and in each thread's Details panel so
 * the list reads as work to do rather than a wall of badges.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { onSnapshot, query, Timestamp, where } from "firebase/firestore";
import { Archive, ArchiveRestore, ArrowLeft, BellRing, Bot, Headset, Inbox as InboxIcon, Search, Send, Ticket } from "lucide-react";

import { useWorkspace } from "../../workspace/workspaceContext";
import { useHotelProfile } from "../../lib/hotelProfile";
import { Link } from "react-router-dom";
import {
  conversationStatus,
  filterConversations,
  LEAD_LABEL,
  MAX_MESSAGE_TEXT,
  PIPELINE_STAGE_LABEL,
  sortConversations,
  type AttentionFilter,
  type Conversation,
  type ConversationMessage,
  type LeadFilter,
  type LeadScore,
  type PipelineFilter,
  type ResponseFilter,
} from "../../lib/conversations";
import {
  draftFollowUp,
  dueFollowUp,
  FOLLOW_UP_KIND_LABEL,
  type FollowUp,
  type FollowUpKind,
} from "../../lib/followUps";
import { dateShort, dateTime, money } from "../../lib/format";
import { COLLECTIONS } from "../../lib/collections";
import { hotelCollection } from "../../lib/hotelScope";
import { useGuestRequests } from "../../lib/guestRequests";
import {
  addInternalNote,
  sendFollowUp,
  sendStaffReply,
  setClosed,
  setHandler,
  snoozeFollowUp,
  useConversations,
  useMessages,
} from "../../lib/inbox";
import { EmptyState, SegmentedControl, useToast } from "../../components/ui";
import {
  AssignedStaffBadge,
  ConversationRow,
  FollowUpBadge,
  GuestAvatar,
  HandlerBadge,
  LeadBadge,
  LeadReasons,
  MessageBubble,
  NextActionBadge,
  PipelineBadge,
  SelectedHotelBadge,
  StatusBadge,
} from "./parts";

type Queue = "needsReply" | "all" | "booked" | "closed";
type ComposerMode = "reply" | "note";

interface AdvancedFilters {
  lead: LeadFilter;
  attention: AttentionFilter;
  response: ResponseFilter;
  pipeline: PipelineFilter;
}

const EMPTY_FILTERS: AdvancedFilters = {
  lead: "all",
  attention: "all",
  response: "all",
  pipeline: "all",
};

const LEAD_RANK: Record<LeadScore, number> = { vip: 0, hot: 1, warm: 2, cold: 3 };
const SEEN_PREFIX = "innpilot_inbox_seen:";

function readSeen(key: string | null): Record<string, number> {
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function lastActivity(conversation: Conversation): Date | null {
  return conversation.lastMessage?.at ?? conversation.updatedAt ?? conversation.createdAt ?? null;
}

/** Hottest lead first, then whoever has been left longest. */
function sortQueue(list: Conversation[], now: Date): Conversation[] {
  const rank = (c: Conversation) => LEAD_RANK[c.lead?.score ?? "cold"];
  const waited = (c: Conversation) => {
    const at = lastActivity(c);
    return at ? now.getTime() - at.getTime() : 0;
  };
  return [...list].sort((a, b) => rank(a) - rank(b) || waited(b) - waited(a));
}

export default function Inbox() {
  const { hotelId } = useWorkspace();
  const { profile } = useHotelProfile(hotelId);
  const { conversations, loading, error } = useConversations(hotelId);
  const { requests: guestRequests } = useGuestRequests(hotelId);

  const newRequestCount = useMemo(() => guestRequests.filter((r) => r.status === "new").length, [guestRequests]);

  const [queue, setQueue] = useState<Queue>("needsReply");
  const [filters, setFilters] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // "Unread" is local to this browser: the last time staff opened each thread.
  const seenKey = hotelId ? `${SEEN_PREFIX}${hotelId}` : null;
  const [seen, setSeen] = useState<Record<string, number>>(() => readSeen(seenKey));
  useEffect(() => {
    setSeen(readSeen(seenKey));
  }, [seenKey]);
  useEffect(() => {
    if (seenKey) localStorage.setItem(seenKey, JSON.stringify(seen));
  }, [seenKey, seen]);

  // Keep row times honest without a refresh.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // Web is the only live channel. Ignore any legacy sample threads still in Firestore.
  const webConversations = useMemo(
    () => conversations.filter((c) => c.channel === "web"),
    [conversations],
  );

  // Who the hotel still owes something, worked out from the thread itself (D21).
  const followUps = useMemo(() => {
    const due = new Map<string, FollowUp>();
    for (const conversation of webConversations) {
      const followUp = dueFollowUp(conversation, now);
      if (followUp) due.set(conversation.id, followUp);
    }
    return due;
  }, [webConversations, now]);

  const queueLists = useMemo(() => {
    const guestIsWaiting = (c: Conversation) =>
      !c.closed && c.bookingStatus !== "booked" && c.lastMessage?.role === "guest";

    const needsReply = sortQueue(
      webConversations.filter((c) => guestIsWaiting(c) || followUps.has(c.id)),
      now
    );
    return {
      needsReply,
      all: sortConversations(webConversations),
      booked: sortConversations(webConversations.filter((c) => conversationStatus(c) === "booked")),
      closed: sortConversations(webConversations.filter((c) => conversationStatus(c) === "closed")),
    };
  }, [webConversations, followUps, now]);

  const visible = useMemo(
    () => filterConversations(queueLists[queue], { ...filters, query: search }),
    [queueLists, queue, filters, search]
  );
  const selected = webConversations.find((c) => c.id === selectedId) ?? null;

  const queueOptions: { key: Queue; label: string }[] = [
    { key: "needsReply", label: `Needs reply ${queueLists.needsReply.length}` },
    { key: "all", label: `All ${queueLists.all.length}` },
    { key: "booked", label: `Booked ${queueLists.booked.length}` },
    { key: "closed", label: `Closed ${queueLists.closed.length}` },
  ];

  const setFilter = <K extends keyof AdvancedFilters>(key: K, value: AdvancedFilters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setSearch("");
  };

  const activeChips: { key: string; label: string; clear: () => void }[] = [];
  if (filters.lead !== "all") {
    activeChips.push({
      key: "lead",
      label: `Lead: ${LEAD_LABEL[filters.lead]}`,
      clear: () => setFilter("lead", "all"),
    });
  }
  if (filters.attention !== "all") {
    activeChips.push({
      key: "attention",
      label: `Attention: ${filters.attention === "needsAttention" ? "Needs attention" : "Lost"}`,
      clear: () => setFilter("attention", "all"),
    });
  }
  if (filters.response !== "all") {
    activeChips.push({
      key: "response",
      label: `Response: ${filters.response === "awaitingHotel" ? "Awaiting hotel" : "Awaiting guest"}`,
      clear: () => setFilter("response", "all"),
    });
  }
  if (filters.pipeline !== "all") {
    activeChips.push({
      key: "pipeline",
      label: `Stage: ${PIPELINE_STAGE_LABEL[filters.pipeline]}`,
      clear: () => setFilter("pipeline", "all"),
    });
  }
  if (search.trim()) {
    activeChips.push({ key: "search", label: `Search: ${search.trim()}`, clear: () => setSearch("") });
  }

  const isUnread = (conversation: Conversation): boolean => {
    const at = lastActivity(conversation);
    const seenAt = seen[conversation.id];
    return !!at && (seenAt === undefined || at.getTime() > seenAt);
  };

  // Opening a thread marks it read, including a new message that lands while it is open.
  useEffect(() => {
    if (!selectedId) return;
    const conversation = webConversations.find((c) => c.id === selectedId);
    const at = conversation ? lastActivity(conversation) : null;
    if (!at) return;
    const stamp = at.getTime();
    setSeen((current) => (current[selectedId] === stamp ? current : { ...current, [selectedId]: stamp }));
  }, [selectedId, webConversations]);

  return (
    <div className="space-y-5">
      {error && (
        <div className="card p-4 text-sm" role="alert" style={{ color: "var(--danger-text)", borderColor: "var(--danger-border)" }}>
          {error}
        </div>
      )}

      {!loading && webConversations.length === 0 ? (
        // A load that failed is not an empty inbox: the error above says so.
        !error && (
          <div className="card">
            <EmptyState
              icon={<InboxIcon size={22} />}
              title="No conversations yet"
              description="Chats from your guest AI concierge appear here as they happen. WhatsApp and other channels are coming soon."
            />
          </div>
        )
      ) : (
        <div className="card overflow-hidden grid lg:grid-cols-[minmax(320px,400px)_1fr] lg:h-[calc(100vh-12rem)] min-h-[560px]">
          {/* ---------- LIST ---------- */}
          <section
            className={`flex flex-col min-h-0 ${selected ? "hidden lg:flex" : "flex"}`}
            style={{ borderRight: "1px solid var(--border)" }}
            aria-label="Conversations"
          >
            <div className="p-3 space-y-3" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between gap-2">
                <SegmentedControl label="Conversation queue" value={queue} options={queueOptions} onChange={setQueue} />
                {newRequestCount > 0 && (
                  <Link
                    to="/dashboard/requests"
                    className="btn btn-secondary btn-sm shrink-0"
                    title={`${newRequestCount} new guest request${newRequestCount === 1 ? "" : "s"} awaiting acknowledgement`}
                  >
                    <Ticket size={14} /> Requests <span className="badge badge-danger">{newRequestCount}</span>
                  </Link>
                )}
              </div>

              <div className="flex items-start gap-2">
                <div className="search-wrap flex-1">
                  <Search size={16} />
                  <input
                    className="input"
                    aria-label="Search conversations"
                    placeholder="Search guest, message or reference…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <details className="shrink-0" open={showFilters} onToggle={(e) => setShowFilters(e.currentTarget.open)}>
                  <summary className="btn btn-secondary btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    More filters{activeChips.length ? ` · ${activeChips.length}` : ""}
                  </summary>
                  <div className="card mt-2 p-3 space-y-3">
                    <SegmentedControl
                      label="Filter by lead score"
                      value={filters.lead}
                      options={[
                        { key: "all" as LeadFilter, label: "All leads" },
                        { key: "vip" as LeadFilter, label: "VIP" },
                        { key: "hot" as LeadFilter, label: "Hot" },
                        { key: "warm" as LeadFilter, label: "Warm" },
                        { key: "cold" as LeadFilter, label: "Cold" },
                      ]}
                      onChange={(value) => setFilter("lead", value)}
                    />
                    <SegmentedControl
                      label="Filter by attention"
                      value={filters.attention}
                      options={[
                        { key: "all" as AttentionFilter, label: "All" },
                        { key: "needsAttention" as AttentionFilter, label: "Needs attention" },
                        { key: "lost" as AttentionFilter, label: "Lost" },
                      ]}
                      onChange={(value) => setFilter("attention", value)}
                    />
                    <SegmentedControl
                      label="Filter by response awaited"
                      value={filters.response}
                      options={[
                        { key: "all" as ResponseFilter, label: "All" },
                        { key: "awaitingHotel" as ResponseFilter, label: "Awaiting hotel" },
                        { key: "awaitingGuest" as ResponseFilter, label: "Awaiting guest" },
                      ]}
                      onChange={(value) => setFilter("response", value)}
                    />
                    <SegmentedControl
                      label="Filter by pipeline stage"
                      value={filters.pipeline}
                      options={[
                        { key: "all" as PipelineFilter, label: "All stages" },
                        { key: "new" as PipelineFilter, label: "New" },
                        { key: "qualified" as PipelineFilter, label: "Qualified" },
                        { key: "quoted" as PipelineFilter, label: "Quoted" },
                        { key: "interested" as PipelineFilter, label: "Interested" },
                        { key: "followUp" as PipelineFilter, label: "Follow-up" },
                        { key: "booked" as PipelineFilter, label: "Booked" },
                        { key: "lost" as PipelineFilter, label: "Lost" },
                      ]}
                      onChange={(value) => setFilter("pipeline", value)}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm w-full"
                      onClick={clearAll}
                      disabled={activeChips.length === 0}
                    >
                      Clear all filters
                    </button>
                  </div>
                </details>
              </div>

              {activeChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {activeChips.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      className="badge badge-plain badge-neutral"
                      onClick={chip.clear}
                      title="Remove this filter"
                    >
                      {chip.label} <span aria-hidden>×</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="text-xs font-semibold"
                    style={{ color: "var(--primary)" }}
                    onClick={clearAll}
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="p-4 space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="skeleton" style={{ height: 72 }} />
                  ))}
                </div>
              ) : visible.length === 0 ? (
                <p className="p-6 text-sm text-center muted">
                  {queue === "needsReply" && activeChips.length === 0
                    ? "Nobody needs a reply right now."
                    : "No conversations match this filter."}
                </p>
              ) : (
                visible.map((conversation) => (
                  <ConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    followUp={followUps.get(conversation.id) ?? null}
                    selected={conversation.id === selectedId}
                    onSelect={() => setSelectedId(conversation.id)}
                    now={now}
                    unread={isUnread(conversation)}
                  />
                ))
              )}
            </div>
          </section>

          {/* ---------- THREAD ---------- */}
          <section className={`flex-col min-h-0 ${selected ? "flex" : "hidden lg:flex"}`} aria-label="Conversation">
            {selected && hotelId ? (
              <Thread
                key={selected.id}
                hotelId={hotelId}
                conversation={selected}
                hotelName={profile.name}
                currency={profile.currency}
                followUp={followUps.get(selected.id) ?? null}
                onBack={() => setSelectedId(null)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center p-8">
                <p className="text-sm muted text-center">Select a conversation to read it.</p>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

interface ThreadBooking {
  id: string;
  reservationId: string;
  roomNumber: string;
  roomType: string;
  checkIn: Date | null;
  checkOut: Date | null;
  status: string;
  paymentStatus: string;
  totalAmount: number;
  pricePaid: number;
}

function bookingDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** The booking this conversation produced, if the guest completed one. */
function useConversationBooking(hotelId: string, conversationId: string): ThreadBooking[] {
  const [bookings, setBookings] = useState<ThreadBooking[]>([]);
  useEffect(() => {
    if (!hotelId || !conversationId) {
      setBookings([]);
      return;
    }
    return onSnapshot(
      query(hotelCollection(hotelId, COLLECTIONS.BOOKINGS), where("conversationId", "==", conversationId)),
      (snap) => {
        setBookings(snap.docs.map((doc) => {
          const data = doc.data() as Record<string, unknown>;
          return {
            id: doc.id,
            reservationId: typeof data.reservationId === "string" ? data.reservationId : "",
            roomNumber: typeof data.roomNumber === "string" ? data.roomNumber : "",
            roomType: typeof data.roomType === "string" ? data.roomType : "",
            checkIn: bookingDate(data.checkIn),
            checkOut: bookingDate(data.checkOut),
            status: typeof data.status === "string" ? data.status : "Confirmed",
            paymentStatus: typeof data.paymentStatus === "string" ? data.paymentStatus : "Unpaid",
            totalAmount: typeof data.totalAmount === "number" ? data.totalAmount : 0,
            pricePaid: typeof data.pricePaid === "number" ? data.pricePaid : 0,
          };
        }));
      },
      (err) => console.error("Failed to load booking for conversation:", err)
    );
  }, [hotelId, conversationId]);
  return bookings;
}

function Thread({
  hotelId,
  conversation,
  hotelName,
  currency,
  followUp,
  onBack,
}: {
  hotelId: string;
  conversation: ReturnType<typeof useConversations>["conversations"][number];
  hotelName: string;
  currency: string;
  followUp: FollowUp | null;
  onBack: () => void;
}) {
  const toast = useToast();
  const { messages, loading } = useMessages(hotelId, conversation.id);
  const bookings = useConversationBooking(hotelId, conversation.id);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [composerMode, setComposerMode] = useState<ComposerMode>("reply");
  const [followUpKind, setFollowUpKind] = useState<FollowUpKind | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const human = conversation.handledBy === "human";
  const showComposer = human || followUpKind !== null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  useEffect(() => {
    if (!followUpKind) return;
    composerRef.current?.focus();
    composerRef.current?.scrollIntoView({ block: "nearest" });
  }, [followUpKind]);

  const switchHandler = async (handledBy: "ai" | "human") => {
    setBusy(true);
    const result = await setHandler(hotelId, conversation, handledBy);
    setBusy(false);
    if (result.ok) toast.success(handledBy === "human" ? "You're handling this conversation" : "The AI concierge is back on this conversation");
    else toast.error(result.error);
  };

  const toggleClosed = async () => {
    setBusy(true);
    const result = await setClosed(hotelId, conversation, !conversation.closed);
    setBusy(false);
    if (result.ok) toast.success(conversation.closed ? "Conversation unarchived" : "Conversation archived");
    else toast.error(result.error);
  };

  /** One composer, three intents: follow-up, internal note, or guest reply. */
  const submitComposer = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    const text = draft;
    const kind = followUpKind;
    const mode = composerMode;
    setDraft("");
    setBusy(true);

    let result;
    if (kind) {
      result = await sendFollowUp(hotelId, conversation, text);
    } else if (mode === "note") {
      result = await addInternalNote(hotelId, conversation, conversation.assignedStaffName || "Staff", text);
    } else {
      result = await sendStaffReply(hotelId, conversation, text);
    }
    setBusy(false);

    if (!result.ok) {
      setDraft(text);
      toast.error(result.error);
      return;
    }
    if (kind) {
      setFollowUpKind(null);
      toast.success(`Follow-up sent to ${conversation.guestName}`);
    }
  };

  const useFollowUpDraft = (kind: FollowUpKind) => {
    setFollowUpKind(kind);
    setDraft(draftFollowUp(conversation, hotelName, kind));
    setComposerMode("reply");
  };

  return (
    <>
      <header className="px-4 py-3 flex flex-wrap items-center gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <button type="button" className="icon-btn lg:hidden" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft size={18} />
        </button>
        <GuestAvatar conversation={conversation} size={36} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold truncate" style={{ color: "var(--text)" }}>
            {conversation.guestName}
          </p>
          <p className="text-xs muted truncate">
            {conversation.guestContact || "No contact details yet"}
            {conversation.reservationId && ` · ${conversation.reservationId}`}
          </p>
          {conversation.inquiry.checkIn || conversation.inquiry.guestCount || conversation.inquiry.roomType && (
            <p className="text-xs muted truncate">
              {conversation.inquiry.checkIn && conversation.inquiry.checkOut && (
                <>
                  {conversation.inquiry.checkIn} → {conversation.inquiry.checkOut}
                  {conversation.inquiry.guestCount && ` · ${conversation.inquiry.guestCount} guest${conversation.inquiry.guestCount === 1 ? "" : "s"}`}
                </>
              )}
              {conversation.inquiry.checkIn && !conversation.inquiry.checkOut && conversation.inquiry.guestCount && (
                <>
                  {conversation.inquiry.checkIn} · {conversation.inquiry.guestCount} guest{conversation.inquiry.guestCount === 1 ? "" : "s"}
                </>
              )}
              {!conversation.inquiry.checkIn && conversation.inquiry.guestCount && (
                `${conversation.inquiry.guestCount} guest${conversation.inquiry.guestCount === 1 ? "" : "s"}`
              )}
              {conversation.inquiry.roomType && <>{` · ${conversation.inquiry.roomType}`}</>}
              {conversation.inquiry.budget !== undefined && conversation.inquiry.budget !== null && (
                <>
                  {" · "}
                  <span className="font-semibold">{money(conversation.inquiry.budget, "UGX")}</span>
                </>
              )}
            </p>
          )}
        </div>
        <HandlerBadge handledBy={conversation.handledBy} />
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={toggleClosed}
          disabled={busy}
          title={conversation.closed
            ? "Show this conversation in the queue again"
            : "Hides it from the queue; the AI will still answer if the guest returns"}
        >
          {conversation.closed ? <ArchiveRestore size={14} /> : <Archive size={14} />} {conversation.closed ? "Unarchive" : "Archive"}
        </button>
        {human ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => switchHandler("ai")} disabled={busy}>
            <Bot size={14} /> Return to AI
          </button>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => switchHandler("human")} disabled={busy}>
            <Headset size={14} /> Take over
          </button>
        )}
        <details className="w-full">
          <summary className="text-xs font-semibold cursor-pointer muted">Details</summary>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <LeadBadge lead={conversation.lead} />
            <StatusBadge conversation={conversation} />
            <SelectedHotelBadge conversation={conversation} hotelName={hotelName} />
            <FollowUpBadge followUp={followUp} />
            <LeadReasons lead={conversation.lead} />
            <PipelineBadge stage={conversation.pipelineStage} />
            <NextActionBadge action={conversation.nextAction} />
            <AssignedStaffBadge conversation={conversation} />
          </div>
        </details>
      </header>

      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-[240px]" aria-live="polite">
        {loading && messages.length === 0 ? (
          <div className="space-y-3">
            <div className="skeleton" style={{ height: 48, width: "60%" }} />
            <div className="skeleton ml-auto" style={{ height: 48, width: "50%" }} />
          </div>
        ) : (
          <>
            {bookings.map((booking) => (
              <ConversationBookingCard key={booking.id} booking={booking} currency={currency} />
            ))}
            {messages.map((message) =>
              message.role === "internal_note" ? (
                <InternalNote key={message.id} message={message} />
              ) : (
                <MessageBubble key={message.id} message={message} guestName={conversation.guestName} />
              )
            )}
          </>
        )}
      </div>

      {followUp && !followUpKind && (
        <FollowUpCard
          key={`${conversation.id}-${followUp.kind}`}
          hotelId={hotelId}
          conversation={conversation}
          hotelName={hotelName}
          followUp={followUp}
          onUseDraft={useFollowUpDraft}
        />
      )}

      {showComposer ? (
        <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border)" }}>
          {followUpKind && (
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <span
                className="badge badge-plain"
                style={{ background: "var(--primary-soft)", color: "var(--primary-active)", borderColor: "var(--primary-border)" }}
              >
                <BellRing size={12} /> Follow-up · {FOLLOW_UP_KIND_LABEL[followUpKind]}
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setFollowUpKind(null);
                  setDraft("");
                }}
              >
                Discard draft
              </button>
            </div>
          )}

          {human && !followUpKind && (
            <div className="segmented inline-flex w-fit mb-2" role="tablist" aria-label="Composer mode">
              {(["reply", "note"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  role="tab"
                  aria-selected={composerMode === mode}
                  className={`segmented-item ${composerMode === mode ? "is-active" : ""}`}
                  onClick={() => setComposerMode(mode)}
                >
                  {mode === "reply" ? "Reply" : "Internal note"}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={submitComposer} className="flex items-end gap-2">
            <label htmlFor="staff-composer" className="sr-only">
              {followUpKind
                ? `Follow-up to ${conversation.guestName}`
                : composerMode === "note"
                  ? "Internal note"
                  : `Reply to ${conversation.guestName}`}
            </label>
            <textarea
              ref={composerRef}
              id="staff-composer"
              className="input resize-none"
              rows={2}
              maxLength={MAX_MESSAGE_TEXT}
              placeholder={
                followUpKind
                  ? `Follow-up to ${conversation.guestName}…`
                  : composerMode === "note"
                    ? "Internal note (staff only, guests cannot see)…"
                    : `Reply to ${conversation.guestName}…`
              }
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !draft.trim()}>
              <Send size={15} /> {followUpKind ? "Send follow-up" : composerMode === "note" ? "Add note" : "Send"}
            </button>
          </form>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm" style={{ color: "var(--text-secondary)" }}>
          <span className="flex items-center gap-2">
            <Bot size={16} style={{ color: "var(--primary)" }} /> The AI concierge is answering this guest.
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => switchHandler("human")} disabled={busy}>
            <Headset size={14} /> Take over to reply
          </button>
        </div>
      )}
    </>
  );
}

/** Internal notes now sit in the timeline at the moment they were written. */
function InternalNote({ message }: { message: ConversationMessage }) {
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] sm:max-w-[70%]">
        <p className="text-[11px] mb-1 flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <span>Internal note</span> · <span>{dateTime(message.at)}</span>
        </p>
        <div
          className="rounded-2xl rounded-tr-md px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words"
          style={{ background: "var(--surface-muted)", color: "var(--text-secondary)", border: "1px dashed var(--border)" }}
        >
          {message.text}
          {message.staffName && <span className="block text-[10px] mt-1 opacity-70">— {message.staffName}</span>}
        </div>
      </div>
    </div>
  );
}

function ConversationBookingCard({ booking, currency }: { booking: ThreadBooking; currency: string }) {
  const statusTone = booking.status === "Cancelled" || booking.status === "No Show"
    ? "badge-danger"
    : booking.status === "Pending" ? "badge-warning" : "badge-info";
  const balance = Math.max(0, booking.totalAmount - booking.pricePaid);

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--surface-muted)", border: "1px solid var(--border)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
          <Ticket size={16} style={{ color: "var(--primary)" }} /> Booking from this conversation
        </p>
        <Link to="/dashboard/reservations" className="text-xs font-semibold" style={{ color: "var(--primary)" }}>
          Open in Reservations
        </Link>
      </div>
      <p className="text-sm font-mono" style={{ color: "var(--text)" }}>{booking.reservationId || "Booking"}</p>
      <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
        Room {booking.roomNumber} ({booking.roomType}) · {dateShort(booking.checkIn)} → {dateShort(booking.checkOut)}
      </p>
      <div className="flex flex-wrap gap-1.5 mt-2">
        <span className={`badge badge-plain ${statusTone}`}>{booking.status}</span>
        <span className="badge badge-plain badge-neutral">{booking.paymentStatus}</span>
        <span className="badge badge-plain badge-neutral">
          {money(booking.totalAmount, currency)} total · {money(balance, currency)} due
        </span>
      </div>
    </div>
  );
}

/**
 * The suggested follow-up is now a single action, not a second composer. It
 * loads an editable draft into the one composer below; nothing is sent until
 * staff press Send, and follow-ups deliberately leave the AI on the chat.
 */
function FollowUpCard({
  hotelId,
  conversation,
  hotelName,
  followUp,
  onUseDraft,
}: {
  hotelId: string;
  conversation: ReturnType<typeof useConversations>["conversations"][number];
  hotelName: string;
  followUp: FollowUp;
  onUseDraft: (kind: FollowUpKind) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const preview = draftFollowUp(conversation, hotelName, followUp.kind);

  const notNow = async () => {
    setBusy(true);
    const result = await snoozeFollowUp(hotelId, conversation);
    setBusy(false);
    if (result.ok) toast.success("Put off for a day");
    else toast.error(result.error);
  };

  return (
    <div
      className="px-4 py-3 space-y-2"
      style={{ borderTop: "1px solid var(--primary-border)", background: "var(--primary-soft)" }}
      aria-label="Suggested follow-up"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--primary-active)" }}>
          <BellRing size={14} /> Suggested follow-up
        </p>
        <p className="text-xs muted">{followUp.reason}</p>
      </div>
      <p className="text-xs muted truncate" title={preview}>{preview}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs muted">Opens the composer below with an editable draft. The AI stays on this chat.</p>
        <span className="flex gap-2 shrink-0">
          <button type="button" className="btn btn-secondary btn-sm" onClick={notNow} disabled={busy}>
            Not now
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onUseDraft(followUp.kind)} disabled={busy}>
            <Send size={14} /> Use draft
          </button>
        </span>
      </div>
    </div>
  );
}

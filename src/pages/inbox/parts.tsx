/**
 * Pieces of the unified inbox: channel, lead and follow-up badges, a
 * conversation row, and a message bubble.
 */
import type { ReactNode } from "react";
import { BellRing, Bot, Building2, Globe, Headset, Ticket, User2 } from "lucide-react";

import {
  BOOKING_STATE_LABEL,
  conversationStatus,
  selectedHotelLabel,
  STATUS_LABEL,
  LEAD_LABEL,
  PIPELINE_STAGE_LABEL,
  NEXT_ACTION_LABEL,
  NEXT_ACTION_TONE,
  relativeTime,
  snippet,
  type Conversation,
  type ConversationBookingState,
  type ConversationMessage,
  type Handler,
  type LeadAssessment,
  type NextAction,
  type PipelineStage,
} from "../../lib/conversations";
import { FOLLOW_UP_KIND_LABEL, waitedLabel, type FollowUp } from "../../lib/followUps";
import { LEAD_EMOJI, LEAD_MEANING } from "../../lib/leadScoring";
import { dateTime } from "../../lib/format";

/** Web is the only live channel; every row gets the same small source marker. */
const WEB_MARKER: { icon: ReactNode; color: string; soft: string } = {
  icon: <Globe size={12} />,
  color: "var(--primary-active)",
  soft: "var(--primary-soft)",
};

export function HandlerBadge({ handledBy }: { handledBy: Handler }) {
  return handledBy === "ai" ? (
    <span className="badge badge-plain badge-info">
      <Bot size={12} /> AI
    </span>
  ) : (
    <span className="badge badge-plain badge-warning">
      <Headset size={12} /> Human
    </span>
  );
}

export function BookingBadge({ status }: { status: ConversationBookingState }) {
  const tone = status === "booked" ? "badge-success" : status === "quoted" ? "badge-info" : "badge-neutral";
  return <span className={`badge ${tone}`}>{BOOKING_STATE_LABEL[status]}</span>;
}

/** New / Active / Booked / Closed (D29). "Closed" says why when the guest booked elsewhere. */
export function StatusBadge({ conversation }: { conversation: Conversation }) {
  const status = conversationStatus(conversation);
  const tone = { new: "badge-neutral", active: "badge-info", booked: "badge-success", closed: "badge-neutral" }[status];
  const title =
    status === "closed" && conversation.bookedElsewhere && !conversation.closed
      ? `Booked at ${conversation.selectedHotelName || "another property"}`
      : BOOKING_STATE_LABEL[conversation.bookingStatus];
  return (
    <span className={`badge ${tone}`} title={title}>
      {STATUS_LABEL[status]}
    </span>
  );
}

/** The hotel a network guest chose, when they chose one. */
export function SelectedHotelBadge({ conversation, hotelName }: { conversation: Conversation; hotelName: string }) {
  const label = selectedHotelLabel(conversation, hotelName);
  if (!label) return null;
  const here = conversation.selection === "this";
  return (
    <span
      className={`badge badge-plain ${here ? "badge-success" : "badge-neutral"}`}
      title={here ? "The guest chose your hotel" : "The guest chose another property"}
    >
      <Building2 size={12} /> {label}
    </span>
  );
}

/**
 * How close this guest is to booking. The reasons are in the tooltip, so
 * staff can always see what the score was based on (D20). A conversation
 * from before scoring existed reads "not scored" until its next message.
 */
export function LeadBadge({ lead }: { lead: LeadAssessment | null }) {
  if (!lead) {
    return (
      <span className="badge badge-plain badge-neutral" title="Scored on the guest's next message">
        Lead: not scored
      </span>
    );
  }
  const tone = lead.score === "hot" ? "badge-danger" : lead.score === "warm" ? "badge-warning" : lead.score === "vip" ? "badge-success" : "badge-neutral";
  return (
    <span className={`badge badge-plain ${tone}`} title={`${LEAD_MEANING[lead.score]}: ${lead.reasons.join(", ").toLowerCase()}`}>
      <span aria-hidden>{LEAD_EMOJI[lead.score]}</span> {LEAD_LABEL[lead.score]}
    </span>
  );
}

/** Why this guest scored as they did, spelled out when Details is opened. */
export function LeadReasons({ lead }: { lead: LeadAssessment | null }) {
  if (!lead) return null;
  return (
    <p className="text-xs muted w-full">
      <span style={{ color: "var(--text-secondary)" }}>{LEAD_MEANING[lead.score]}</span>
      {lead.reasons.length > 0 && ` — ${lead.reasons.join(" · ")}`}
    </p>
  );
}

/**
 * A guest this hotel still owes something (D21). The wait is on the badge
 * because it is the whole decision: who has been left longest.
 */
export function FollowUpBadge({ followUp }: { followUp: FollowUp | null }) {
  if (!followUp) return null;
  return (
    <span
      className="badge badge-plain"
      style={{ background: "var(--primary-soft)", color: "var(--primary-active)", borderColor: "var(--primary-border)" }}
      title={`${FOLLOW_UP_KIND_LABEL[followUp.kind]} — ${followUp.reason}`}
    >
      <BellRing size={12} /> Follow up · {waitedLabel(followUp.hours)}
    </span>
  );
}

/** Which stage of the lead pipeline this conversation is at. */
export function PipelineBadge({ stage }: { stage: PipelineStage }) {
  const tone = {
    new: "badge-neutral",
    qualified: "badge-info",
    quoted: "badge-info",
    interested: "badge-success",
    followUp: "badge-warning",
    booked: "badge-success",
    lost: "badge-neutral",
  }[stage];
  return (
    <span className={`badge badge-plain ${tone}`} title={PIPELINE_STAGE_LABEL[stage]}>
      {PIPELINE_STAGE_LABEL[stage]}
    </span>
  );
}

/** The next recommended action for staff. */
export function NextActionBadge({ action }: { action: NextAction | null }) {
  if (!action) return null;
  return (
    <span
      className={`badge badge-plain ${NEXT_ACTION_TONE[action]}`}
      title={NEXT_ACTION_LABEL[action]}
    >
      {NEXT_ACTION_LABEL[action]}
    </span>
  );
}

/** Who this conversation is assigned to, or "Unassigned". */
export function AssignedStaffBadge({ conversation }: { conversation: Conversation }) {
  const hasAssignment = Boolean(conversation.assignedStaffId);
  return (
    <span
      className={`badge badge-plain ${hasAssignment ? "badge-info" : "badge-neutral"}`}
      title={hasAssignment ? `Assigned to ${conversation.assignedStaffName}` : "Unassigned"}
    >
      {hasAssignment ? (
        <>
          <User2 size={12} /> {conversation.assignedStaffName}
        </>
      ) : (
        <>
          <User2 size={12} /> Unassigned
        </>
      )}
    </span>
  );
}

/**
 * The one badge a row needs: why should staff open this now? Everything else
 * stays in the tooltip, and the full set is in the thread's Details panel.
 */
export function ConversationSummaryBadge({
  conversation,
  followUp,
  now,
}: {
  conversation: Conversation;
  followUp: FollowUp | null;
  now: Date;
}) {
  const status = conversationStatus(conversation);
  const score = conversation.lead?.score;
  const detail = [
    score ? `${LEAD_LABEL[score]} lead` : "Not scored yet",
    conversation.lead?.reasons.join(" · "),
    PIPELINE_STAGE_LABEL[conversation.pipelineStage],
    conversation.nextAction ? NEXT_ACTION_LABEL[conversation.nextAction] : "",
    conversation.assignedStaffName ? `Assigned to ${conversation.assignedStaffName}` : "Unassigned",
  ]
    .filter(Boolean)
    .join(" · ");

  let tone = "badge-neutral";
  let content: ReactNode;

  if (status === "booked") {
    tone = "badge-success";
    content = (
      <>
        <Ticket size={12} /> Booked{conversation.reservationId ? ` · ${conversation.reservationId}` : ""}
      </>
    );
  } else if (followUp) {
    tone = score === "vip" || score === "hot" ? "badge-danger" : "badge-warning";
    content = (
      <>
        {score && <span aria-hidden>{LEAD_EMOJI[score]} </span>}
        {followUp.kind === "quiet" ? "Quiet" : "Waiting"} {waitedLabel(followUp.hours)}
      </>
    );
  } else if (status === "closed") {
    content = <>Archived</>;
  } else if (conversation.handledBy === "human") {
    tone = "badge-warning";
    content = (
      <>
        <Headset size={12} /> You're handling
      </>
    );
  } else if (conversation.lastMessage?.role === "guest") {
    tone = "badge-info";
    content = <>Needs reply · {relativeTime(conversation.lastMessage.at, now)}</>;
  } else {
    content = <>Awaiting guest</>;
  }

  return (
    <span className={`badge badge-plain ${tone}`} title={detail}>
      {content}
    </span>
  );
}

export function GuestAvatar({ conversation, size = 40 }: { conversation: Conversation; size?: number }) {
  const initials =
    conversation.guestName
      .replace(/^@/, "")
      .split(/\s+/)
      .map((part) => part[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "G";
  const style = WEB_MARKER;
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <span
        className="w-full h-full rounded-full flex items-center justify-center text-sm font-semibold"
        style={{ background: "var(--surface-muted)", color: "var(--text-secondary)" }}
      >
        {initials}
      </span>
      <span
        className="absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center"
        style={{ background: style.soft, color: style.color, border: "2px solid var(--surface)" }}
      >
        {style.icon}
      </span>
    </span>
  );
}

const ROLE_PREFIX: Record<string, string> = { ai: "AI: ", staff: "You: ", guest: "" };

export function ConversationRow({
  conversation,
  followUp,
  selected,
  onSelect,
  now,
  unread,
}: {
  conversation: Conversation;
  followUp: FollowUp | null;
  selected: boolean;
  onSelect: () => void;
  now: Date;
  unread: boolean;
}) {
  const last = conversation.lastMessage;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className="w-full text-left px-4 py-3 flex gap-3 transition-colors"
      style={{
        background: selected ? "var(--primary-soft)" : undefined,
        borderLeft: `3px solid ${selected ? "var(--primary)" : "transparent"}`,
        borderBottom: "1px solid var(--border)",
      }}
    >
      <GuestAvatar conversation={conversation} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 min-w-0">
            {unread && (
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: "var(--primary)" }}
                title="New activity since you last opened this"
              >
                <span className="sr-only">Unread</span>
              </span>
            )}
            <span className="font-semibold truncate" style={{ color: "var(--text)" }}>
              {conversation.guestName}
            </span>
          </span>
          <span className="text-xs muted shrink-0">{relativeTime(last?.at ?? conversation.updatedAt, now)}</span>
        </span>
        <span
          className={`block text-sm truncate mt-0.5 ${unread ? "font-medium" : ""}`}
          style={{ color: "var(--text-secondary)" }}
        >
          {last ? `${ROLE_PREFIX[last.role]}${snippet(last.text)}` : "No messages yet"}
        </span>
        <span className="block mt-2">
          <ConversationSummaryBadge conversation={conversation} followUp={followUp} now={now} />
        </span>
      </span>
    </button>
  );
}

const ROLE_LABEL = { guest: "", ai: "AI concierge", staff: "Staff", internal_note: "Internal note" } as const;

export function MessageBubble({ message, guestName }: { message: ConversationMessage; guestName: string }) {
  const fromGuest = message.role === "guest";
  const background = fromGuest ? "var(--surface-muted)" : message.role === "ai" ? "var(--primary-soft)" : "var(--primary)";
  const color = message.role === "staff" ? "#fff" : "var(--text)";
  return (
    <div className={`flex ${fromGuest ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[85%] sm:max-w-[70%]">
        <p className={`text-[11px] mb-1 flex items-center gap-1.5 ${fromGuest ? "" : "justify-end"}`} style={{ color: "var(--text-muted)" }}>
          {message.role === "ai" && <Bot size={12} />}
          {message.role === "staff" && <Headset size={12} />}
          <span>{fromGuest ? guestName : ROLE_LABEL[message.role]}</span>
          <span>· {dateTime(message.at)}</span>
        </p>
        <div
          className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${fromGuest ? "rounded-tl-md" : "rounded-tr-md"}`}
          style={{ background, color, border: message.role === "ai" ? "1px solid var(--primary-border)" : undefined }}
        >
          {message.text.replace(/\*\*/g, "")}
        </div>
      </div>
    </div>
  );
}

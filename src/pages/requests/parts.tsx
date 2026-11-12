/**
 * Pieces of the staff requests queue: badges and the list row. Mirrors the
 * inbox's parts so a request feels like part of the same workspace — same
 * badge grammar, same spacing. Clicking a row opens the request detail view.
 */

import type { ReactNode } from "react";
import { ArrowRight, Headset, MessageCircle, ShieldAlert, Users } from "lucide-react";
import { Link } from "react-router-dom";

import { dateTime } from "../../lib/format";
import {
  departmentFor,
  type GuestRequest,
  type GuestRequestCategory,
  type GuestRequestPriority,
  type GuestRequestStatus,
} from "../../lib/guestRequest";

const STATUS_TONE: Record<GuestRequestStatus, string> = {
  new: "badge-neutral",
  acknowledged: "badge-info",
  in_progress: "badge-warning",
  resolved: "badge-success",
  closed: "badge-neutral",
};

const STATUS_LABEL: Record<GuestRequestStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

const PRIORITY_TONE: Record<GuestRequestPriority, string> = {
  normal: "badge-neutral",
  high: "badge-warning",
  urgent: "badge-danger",
};

const PRIORITY_LABEL: Record<GuestRequestPriority, string> = {
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

const CHANNEL_STYLE: Record<"web" | "whatsapp", { icon: ReactNode; color: string }> = {
  web: { icon: <Globe size={12} />, color: "var(--primary-active)" },
  whatsapp: { icon: <MessageCircle size={12} />, color: "#15803d" },
};

function Globe(props: { size?: number }): ReactNode {
  return (
    <svg
      width={props.size ?? 12}
      height={props.size ?? 12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function RequestStatusBadge({ status }: { status: GuestRequestStatus }) {
  return (
    <span className={`badge badge-plain ${STATUS_TONE[status]}`} title={STATUS_LABEL[status]}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function RequestPriorityBadge({ priority }: { priority: GuestRequestPriority }) {
  const urgent = priority === "urgent";
  return (
    <span className={`badge badge-plain ${PRIORITY_TONE[priority]}`} title={`${PRIORITY_LABEL[priority]} priority`}>
      {urgent ? <ShieldAlert size={12} /> : ""} {PRIORITY_LABEL[priority]}
    </span>
  );
}

export function RequestCategoryBadge({ category }: { category: GuestRequestCategory }) {
  const label =
    {
      housekeeping: "Housekeeping",
      maintenance: "Maintenance",
      food_beverage: "Food & Beverage",
      front_desk: "Front Desk",
      noise: "Front Desk",
      billing: "Accounts",
      safety: "Management",
      other: "Other",
    }[category] ?? "Other";
  return (
    <span className="badge badge-plain badge-neutral" title={departmentFor(category)}>
      {label}
    </span>
  );
}

export function RequestChannelBadge({ channel }: { channel: "web" | "whatsapp" }) {
  const style = CHANNEL_STYLE[channel];
  return (
    <span className="badge badge-plain badge-info" style={{ background: "var(--primary-soft)", color: style.color, borderColor: "transparent" }}>
      {style.icon} {channel === "web" ? "Web" : "WhatsApp"}
    </span>
  );
}

const ROLE_ICON: Record<GuestRequest["type"], { icon: ReactNode; label: string }> = {
  request: { icon: <Headset size={12} />, label: "Request" },
  complaint: { icon: <ShieldAlert size={12} />, label: "Complaint" },
  feedback: { icon: <Users size={12} />, label: "Feedback" },
};

export function RequestTypeBadge({ type }: { type: GuestRequest["type"] }) {
  const { icon, label } = ROLE_ICON[type];
  return <span className="badge badge-plain badge-info" title={label}>{icon} {label}</span>;
}

/**
 * One row of the requests queue — a link to the request's detail view, so
 * staff can acknowledge, assign, resolve and add a note.
 */
export function RequestRow({ request }: { request: GuestRequest }) {
  const urgent = request.priority === "urgent";
  const hasConversation = Boolean(request.conversationId);
  return (
    <Link
      to={`/dashboard/requests/${request.id}`}
      className="block text-left px-4 py-3 transition-colors border-b"
      style={{
        borderLeft: `3px solid ${urgent ? "var(--danger-text)" : "var(--primary)"}`,
      }}
    >
      <div className="flex items-start gap-3">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-semibold shrink-0"
          style={{ background: urgent ? "var(--danger-soft)" : "var(--surface-muted)", color: urgent ? "var(--danger-text)" : "var(--text-secondary)" }}
        >
          {request.id.slice(-4)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-semibold truncate" style={{ color: "var(--text)" }}>
              {request.summary.length > 60 ? request.summary.slice(0, 60) + "…" : request.summary}
            </span>
            <span className="text-xs muted shrink-0">{dateTime(new Date(request.createdAt))}</span>
          </div>
          <span className="block text-sm truncate mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {request.guestName ?? "Web visitor"}
            {request.guestRoom ? ` · Room ${request.guestRoom}` : ""}
          </span>
          <span className="flex flex-wrap gap-1.5 mt-2">
            <RequestStatusBadge status={request.status} />
            <RequestPriorityBadge priority={request.priority} />
            <RequestChannelBadge channel={request.channel} />
            <RequestCategoryBadge category={request.category} />
          </span>
        </div>
        {hasConversation && <ArrowRight size={14} className="text-xs muted shrink-0" aria-hidden />}
      </div>
    </Link>
  );
}

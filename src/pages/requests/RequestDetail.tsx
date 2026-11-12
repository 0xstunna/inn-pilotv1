/**
 * Request detail view (Task 6): acknowledge, assign, resolve, add a note,
 * and jump to the linked conversation. Only valid status transitions are
 * offered, enforced by the same shared function the server uses.
 */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, Headset, ShieldAlert, Users } from "lucide-react";
import { useParams, useNavigate } from "react-router-dom";

import { useWorkspace } from "../../workspace/workspaceContext";
import { PageHeader, useToast } from "../../components/ui";
import { Card } from "../../components/ui";
import { useGuestRequests, updateGuestRequestStatus, addGuestRequestNote } from "../../lib/guestRequests";
import { type GuestRequestStatus } from "../../lib/guestRequest";
import { hotelDoc } from "../../lib/hotelScope";
import { dateTime } from "../../lib/format";
import { updateDoc } from "firebase/firestore";

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

const STATUS_ACTIONS: Record<GuestRequestStatus, Exclude<GuestRequestStatus, "new">[]> = {
  new: ["acknowledged", "in_progress", "resolved", "closed"],
  acknowledged: ["in_progress", "resolved", "closed"],
  in_progress: ["resolved", "closed"],
  resolved: ["closed"],
  closed: [],
};

const NEXT_LABEL: Record<Exclude<GuestRequestStatus, "new">, string> = {
  acknowledged: "Acknowledge",
  in_progress: "Start work",
  resolved: "Mark resolved",
  closed: "Close",
};

const NEXT_ICON: Record<Exclude<GuestRequestStatus, "new">, ReactNode> = {
  acknowledged: <Headset size={14} />,
  in_progress: <ShieldAlert size={14} />,
  resolved: <ShieldAlert size={14} />,
  closed: <Users size={14} />,
};

export default function RequestDetail() {
  const { requestId } = useParams<{ requestId: string }>();
  const navigate = useNavigate();
  const { hotelId } = useWorkspace();
  const toast = useToast();

  const { requests, loading, error } = useGuestRequests(hotelId);
  const request = requestId ? requests.find((r) => r.id === requestId) ?? null : null;

  const [noteDraft, setNoteDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [assignedStaffId, setAssignedStaffId] = useState(request?.assigneeId ?? "");
  const [assignedStaffName, setAssignedStaffName] = useState(request?.assigneeName ?? "");

  useEffect(() => {
    if (request && assignedStaffId !== request.assigneeId) {
      setAssignedStaffId(request.assigneeId ?? "");
      setAssignedStaffName(request.assigneeName ?? "");
    }
  }, [request, assignedStaffId]);

  if (!requestId || !hotelId) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm muted">No request selected.</p>
      </div>
    );
  }

  const currentStatus = request?.status ?? "new";
  const nextOptions = STATUS_ACTIONS[currentStatus] ?? [];

  const transition = async (next: Exclude<GuestRequestStatus, "new">) => {
    if (!request || busy) return;
    setBusy(true);
    const result = await updateGuestRequestStatus(hotelId, requestId, next);
    setBusy(false);
    if (result.ok) {
      toast.success(`Request ${requestId} is now ${NEXT_LABEL[next]}`);
    } else {
      toast.error(result.error);
    }
  };

  const assignStaff = async () => {
    if (!request || busy) return;
    setBusy(true);
    try {
      await updateDoc(hotelDoc(hotelId, "guestRequests", requestId), {
        assigneeId: assignedStaffId || null,
        assigneeName: assignedStaffId ? assignedStaffName : null,
        updatedAt: new Date(),
      });
      toast.success(assignedStaffId ? `Assigned to ${assignedStaffName}` : "Unassigned");
    } catch {
      toast.error("Couldn't save the assignment. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const addNote = async () => {
    if (!request || busy || !noteDraft.trim()) return;
    setBusy(true);
    const result = await addGuestRequestNote(hotelId, requestId, assignedStaffName || "Staff", noteDraft);
    setBusy(false);
    if (result.ok) {
      setNoteDraft("");
      toast.success("Note added");
    } else {
      toast.error(result.error);
    }
  };

  const goToConversation = () => {
    if (request?.conversationId) navigate(`/dashboard/inbox`);
  };

  if (loading) return <div className="p-8 text-center">Loading request…</div>;
  if (error) return <div className="p-8 text-center">{error}</div>;
  if (!request) {
    return (
      <div className="card p-8 text-center">
        <p className="text-sm muted">Request "{requestId}" not found for this hotel.</p>
      </div>
    );
  }

  const channelLabel = request.channel === "web" ? "Website chat" : "WhatsApp";

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Request ${request.id}`}
        subtitle={`Logged ${dateTime(new Date(request.createdAt))} via ${channelLabel}`}
        actions={
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate("/dashboard/requests")}>
            <ArrowLeft size={14} /> Back to queue
          </button>
        }
      />

      {error && (
        <div className="card p-4 text-sm" role="alert" style={{ color: "var(--danger-text)", borderColor: "var(--danger-border)" }}>
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        {/* LEFT: request card */}
        <section className="lg:col-span-3 space-y-4">
          <Card title="Request" bodyClassName="p-0">
            <div className="px-5 py-4 border-b border-bborder/50">
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <span className="text-lg font-semibold truncate" style={{ color: "var(--text)" }}>
                  {request.summary}
                </span>
                <span className={`badge badge-plain ${STATUS_TONE[currentStatus]}`}>
                  {STATUS_LABEL[currentStatus]}
                </span>
              </div>
              <p className="text-sm muted">
                {request.type === "complaint" ? "Complaint" : request.type === "feedback" ? "Feedback" : "Request"} ·
                {request.priority === "urgent" ? "Urgent" : request.priority === "high" ? "High priority" : "Normal priority"}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <span className="badge badge-plain badge-neutral">
                  {channelLabel}
                </span>
                <span className="badge badge-plain badge-neutral">{request.category.replace(/_/g, " ")}</span>
              </div>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Guest</p>
                <p className="text-sm">{request.guestName ?? "Web visitor"}</p>
                {request.guestPhone && <p className="text-xs muted mt-1">{request.guestPhone}</p>}
                {request.guestRoom && <p className="text-xs muted mt-1">Room {request.guestRoom}</p>}
              </div>
              <div>
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Reference</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate text-sm font-mono text-[13px] select-all" style={{ color: "var(--text)" }}>
                    {request.id}
                  </code>
                </div>
              </div>
              <div>
                <p className="text-[11px] uppercase muted tracking-wider mb-1">Guest's own words</p>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {request.guestExcerpt ?? "—"}
                </p>
                <p className="text-[10px] muted mt-1">Internal context only — never shown back to the guest.</p>
              </div>
              {request.conversationId && (
                <div>
                  <p className="text-[11px] uppercase muted tracking-wider mb-1">Linked conversation</p>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-left w-full"
                    onClick={goToConversation}
                    title="Open the guest thread in the inbox"
                  >
                    Conversation {request.conversationId}
                  </button>
                </div>
              )}
            </div>
          </Card>

          {/* ACTIONS: status transitions */}
          <Card title="What to do next" bodyClassName="p-0">
            <div className="px-5 py-3 border-b border-bborder/50">
              <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Move {request.id} through its lifecycle
              </p>
              <p className="text-xs muted mt-1">
                {currentStatus === "closed" ? "Closed — no further transitions." : "Pick the next status the team agrees on."}
              </p>
            </div>
            <div className="px-5 py-4">
              {nextOptions.length === 0 ? (
                <p className="text-sm muted">No further transitions — this request is closed.</p>
              ) : (
                <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
                  {nextOptions.map((next) => (
                    <button
                      key={next}
                      type="button"
                      onClick={() => transition(next)}
                      disabled={busy}
                      className={`btn btn-sm w-full text-left ${
                        next === "closed" ? "btn-secondary" : "btn-primary"
                      } ${busy ? "opacity-50" : ""}`}
                    >
                      {NEXT_ICON[next]} {NEXT_LABEL[next]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </section>

        {/* RIGHT: assign + notes */}
        <section className="lg:col-span-1 space-y-4">
          <Card title="Assign" bodyClassName="p-0">
            <div className="px-4 py-4 space-y-3">
              <label className="text-[11px] uppercase muted tracking-wider block mb-1">Staff member</label>
              <select
                value={assignedStaffId}
                onChange={(e) => {
                  setAssignedStaffId(e.target.value);
                  setAssignedStaffName(e.target.value === "me" ? "Staff" : "");
                }}
                disabled={busy}
                className="select w-full"
              >
                <option value="">Unassigned</option>
                <option value="me">Me</option>
              </select>
              <button
                type="button"
                className="btn btn-secondary btn-sm w-full"
                onClick={assignStaff}
                disabled={busy || assignedStaffId === request.assigneeId}
              >
                {busy ? "Saving…" : "Save assignment"}
              </button>
              {request.assigneeId && (
                <p className="text-xs muted">Currently assigned to {request.assigneeName}</p>
              )}
            </div>
          </Card>

          <Card title="Internal note" bodyClassName="p-0">
            <div className="px-4 py-4 space-y-3">
              <label className="text-[11px] uppercase muted tracking-wider block mb-1">Note (staff only)</label>
              <textarea
                className="input resize-none"
                rows={3}
                maxLength={4000}
                placeholder="What was done, who was told, what's still open…"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm w-full"
                onClick={addNote}
                disabled={busy || !noteDraft.trim()}
              >
                {busy ? "Adding…" : "Add note"}
              </button>
            </div>
          </Card>

          {/* Notes history */}
          {request.notes.length > 0 && (
            <Card title="Notes" bodyClassName="p-0">
              <div className="px-4 py-4 space-y-3">
                {request.notes.slice().reverse().map((note, i) => (
                  <div key={i} className="text-sm space-y-1">
                    <p className="text-xs font-semibold flex gap-1.5" style={{ color: "var(--text-secondary)" }}>
                      {note.by} · {dateTime(new Date(note.at))}
                    </p>
                    <p className="text-sm" style={{ color: "var(--text)" }}>{note.text.replace(/\*\*/g, "")}</p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

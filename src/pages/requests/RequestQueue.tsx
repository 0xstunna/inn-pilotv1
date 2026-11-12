/**
 * Staff requests queue (Task 6): every guest request/complaint logged for
 * this hotel, filterable by status, category, channel and type. Click a row
 * to open its detail view — acknowledge, assign, resolve, add a note, and
 * jump to the linked conversation.
 *
 * Reads hotels/{hotelId}/guestRequests live from Firestore, gated by
 * firestore.rules (workspaceWrite).
 */

import { useMemo, useState } from "react";
import { AlertCircle, Filter, Ticket } from "lucide-react";

import { useWorkspace } from "../../workspace/workspaceContext";
import { PageHeader, SegmentedControl, StatCard, StatGrid } from "../../components/ui";
import { useGuestRequests } from "../../lib/guestRequests";
import { plural } from "../../lib/format";
import { RequestRow } from "./parts";
import { EmptyState } from "../../components/ui";

type RequestStatusFilter =
  | "all"
  | "new"
  | "acknowledged"
  | "in_progress"
  | "resolved"
  | "closed";
type RequestCategoryFilter =
  | "all"
  | "housekeeping"
  | "maintenance"
  | "food_beverage"
  | "front_desk"
  | "noise"
  | "billing"
  | "safety"
  | "other";
type RequestChannelFilter = "all" | "web" | "whatsapp";
type RequestTypeFilter = "all" | "request" | "complaint" | "feedback";

export default function RequestQueue() {
  const { hotelId } = useWorkspace();

  const [status, setStatus] = useState<RequestStatusFilter>("all");
  const [category, setCategory] = useState<RequestCategoryFilter>("all");
  const [channel, setChannel] = useState<RequestChannelFilter>("all");
  const [type, setType] = useState<RequestTypeFilter>("all");
  const [search, setSearch] = useState("");

  const { requests, loading, error } = useGuestRequests(hotelId);

  // Counts for the KPI strip.
  const total = requests.length;
  const newCount = requests.filter((r) => r.status === "new").length;
  const urgentCount = requests.filter((r) => r.priority === "urgent" && r.status !== "closed").length;
  const openCount = requests.filter((r) => r.status !== "resolved" && r.status !== "closed").length;

  const visible = useMemo(() => {
    return requests.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (category !== "all" && r.category !== category) return false;
      if (channel !== "all" && r.channel !== channel) return false;
      if (type !== "all" && r.type !== type) return false;
      const q = search.toLowerCase();
      if (q && !r.summary.toLowerCase().includes(q) && !r.id.toLowerCase().includes(q) && !(r.guestName ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [requests, status, category, channel, type, search]);

  const filterOptions = [
    { key: "all" as RequestStatusFilter, label: `All ${total}` },
    { key: "new" as RequestStatusFilter, label: `New ${newCount}` },
    { key: "acknowledged" as RequestStatusFilter, label: `Acknowledged ${requests.filter((r) => r.status === "acknowledged").length}` },
    { key: "in_progress" as RequestStatusFilter, label: `In progress ${requests.filter((r) => r.status === "in_progress").length}` },
    { key: "resolved" as RequestStatusFilter, label: `Resolved ${requests.filter((r) => r.status === "resolved").length}` },
    { key: "closed" as RequestStatusFilter, label: `Closed ${requests.filter((r) => r.status === "closed").length}` },
  ];

  const channelOptions = [
    { key: "all" as RequestChannelFilter, label: `All ${total}` },
    { key: "web" as RequestChannelFilter, label: `Web ${requests.filter((r) => r.channel === "web").length}` },
    { key: "whatsapp" as RequestChannelFilter, label: `WhatsApp ${requests.filter((r) => r.channel === "whatsapp").length}` },
  ];

  const typeOptions = [
    { key: "all" as RequestTypeFilter, label: `All ${total}` },
    { key: "request" as RequestTypeFilter, label: `Requests ${requests.filter((r) => r.type === "request").length}` },
    { key: "complaint" as RequestTypeFilter, label: `Complaints ${requests.filter((r) => r.type === "complaint").length}` },
    { key: "feedback" as RequestTypeFilter, label: `Feedback ${requests.filter((r) => r.type === "feedback").length}` },
  ];

  const categoryOptions = [
    { key: "all" as RequestCategoryFilter, label: `All ${total}` },
    { key: "housekeeping" as RequestCategoryFilter, label: `Housekeeping ${requests.filter((r) => r.category === "housekeeping").length}` },
    { key: "maintenance" as RequestCategoryFilter, label: `Maintenance ${requests.filter((r) => r.category === "maintenance").length}` },
    { key: "food_beverage" as RequestCategoryFilter, label: `F&B ${requests.filter((r) => r.category === "food_beverage").length}` },
    { key: "front_desk" as RequestCategoryFilter, label: `Front Desk ${requests.filter((r) => r.category === "front_desk").length}` },
    { key: "noise" as RequestCategoryFilter, label: `Noise ${requests.filter((r) => r.category === "noise").length}` },
    { key: "billing" as RequestCategoryFilter, label: `Accounts ${requests.filter((r) => r.category === "billing").length}` },
    { key: "safety" as RequestCategoryFilter, label: `Management ${requests.filter((r) => r.category === "safety").length}` },
    { key: "other" as RequestCategoryFilter, label: `Other ${requests.filter((r) => r.category === "other").length}` },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Guest requests"
        subtitle="Issues and requests guests raised through the AI Concierge and WhatsApp. Acknowledge, assign and resolve each one."
        actions={
          <button type="button" className="btn btn-secondary btn-sm" aria-label="Filter requests">
            <Filter size={14} />
          </button>
        }
      />

      {error && (
        <div className="card p-4 text-sm" role="alert" style={{ color: "var(--danger-text)", borderColor: "var(--danger-border)" }}>
          {error}
        </div>
      )}

      <StatGrid>
        <StatCard label="Total requests" value={String(total)} icon={<Ticket size={18} />} />
        <StatCard label="New" value={String(newCount)} icon={<AlertCircle size={18} />} tone="warning" hint={newCount > 0 ? "needs acknowledging" : "all caught up"} />
        <StatCard label="Open" value={String(openCount)} icon={<AlertCircle size={18} />} tone="primary" />
        <StatCard label="Urgent" value={String(urgentCount)} icon={<AlertCircle size={18} />} tone="danger" />
      </StatGrid>

      {!loading && total === 0 ? (
        !error && (
          <div className="card">
            <EmptyState
              icon={<Ticket size={22} />}
              title="No requests yet"
              description="When a guest reports an issue or asks for something that isn't a booking, the concierge logs it here with a reference number."
            />
          </div>
        )
      ) : (
        <div className="card overflow-hidden min-h-[560px]">
          <div className="p-3 space-y-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <SegmentedControl label="Filter by status" value={status} options={filterOptions} onChange={(key) => setStatus(key)} />
            <SegmentedControl label="Filter by category" value={category} options={categoryOptions} onChange={(key) => setCategory(key)} />
            <SegmentedControl label="Filter by channel" value={channel} options={channelOptions} onChange={(key) => setChannel(key)} />
            <SegmentedControl label="Filter by type" value={type} options={typeOptions} onChange={(key) => setType(key)} />
            <div className="search-wrap">
              <span className="text-[11px] muted" style={{ marginRight: 6 }}>Search reference, guest or summary…</span>
              <input
                className="input"
                aria-label="Search requests"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
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
              <p className="p-6 text-sm text-center muted">
                {search ? "No requests match your search." : "No requests match this filter."}
              </p>
            ) : (
              visible.map((request) => <RequestRow key={request.id} request={request} />)
            )}
          </div>
          {!loading && visible.length > 0 && (
            <div className="px-4 pb-4 text-xs muted" style={{ borderTop: "1px solid var(--border)" }}>
              Showing {plural(visible.length, "request")} of {plural(total, "request")}{newCount > 0 ? ` · ${newCount} new` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

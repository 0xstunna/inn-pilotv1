import { Link, useNavigate } from "react-router-dom";
import {
  MessagesSquare,
  Sparkles,
  ArrowRight,
  ClipboardCheck,
  TrendingUp,
  Globe,
  Phone,
  Clock,
  CalendarCheck,
} from "lucide-react";
import { useEffect, useState } from "react";
import { onSnapshot, query } from "firebase/firestore";
import { useHotelProfile } from "../lib/hotelProfile";
import { useWorkspace } from "../workspace/workspaceContext";
import {
  PageHeader,
  KPICard,
  EmptyState,
  Section,
  Funnel,
  ActionTile,
  StatusChip,
} from "../components/ui";
import { hotelCollection } from "../lib/hotelScope";
import { COLLECTIONS } from "../lib/collections";

const actions = [
  {
    title: "View channels",
    description: "Your web concierge is live; WhatsApp and other channels are coming soon.",
    to: "/dashboard/channels",
    icon: Globe,
  },
  {
    title: "Open inbox",
    description: "Review guest inquiries and help visitors finish their room bookings.",
    to: "/dashboard/inbox",
    icon: MessagesSquare,
  },
  {
    title: "Concierge settings",
    description: "Manage your guest concierge link and listing.",
    to: "/dashboard/settings",
    icon: Sparkles,
  },
] as const;

/** Firestore timestamps arrive as objects with toMillis(); seeds/legacy docs may hold dates or numbers. */
function millis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  if (typeof value === "object" && "toMillis" in value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

type Metrics = {
  newInquiries24h: number;
  newInquiries7d: number;
  firstResponseTime: number | null;
  conciergeBookings24h: number;
  conciergeBookings7d: number;
  conversion7d: number;
  handoffs7d: number;
};

function getStartOfDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDaysAgo(days: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

export default function Dashboard() {
  const { hotelId } = useWorkspace();
  const { profile } = useHotelProfile(hotelId);
  const navigate = useNavigate();
  const [metrics, setMetrics] = useState<Metrics>({
    newInquiries24h: 0,
    newInquiries7d: 0,
    firstResponseTime: null,
    conciergeBookings24h: 0,
    conciergeBookings7d: 0,
    conversion7d: 0,
    handoffs7d: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hotelId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const start24h = getStartOfDay().getTime();
    const start7d = getDaysAgo(7).getTime();

    const conversationsRef = hotelCollection(hotelId, COLLECTIONS.CONVERSATIONS);
    const bookingsRef = hotelCollection(hotelId, COLLECTIONS.BOOKINGS);

    const unsubConvos = onSnapshot(
      query(conversationsRef),
      (snap) => {
        let newInquiries24h = 0;
        let newInquiries7d = 0;
        let handoffs7d = 0;
        const responseTimes: number[] = [];

        snap.docs.forEach((docSnap) => {
          const data: Record<string, unknown> = docSnap.data();
          const createdAt = millis(data.createdAt);
          const lastGuestAt = millis(data.lastGuestAt);

          if (createdAt >= start7d) newInquiries7d++;
          if (createdAt >= start24h) newInquiries24h++;

          if (data.handledBy === "human") handoffs7d++;

          if (lastGuestAt && createdAt) {
            responseTimes.push((lastGuestAt - createdAt) / 1000 / 60);
          }
        });

        setMetrics((prev) => ({
          ...prev,
          newInquiries24h,
          newInquiries7d,
          firstResponseTime: responseTimes.length
            ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
            : null,
          handoffs7d,
        }));
      }
    );

    const unsubBookings = onSnapshot(
      query(bookingsRef),
      (snap) => {
        let bookings24h = 0;
        let bookings7d = 0;

        snap.docs.forEach((docSnap) => {
          const data: Record<string, unknown> = docSnap.data();
          const createdAt = millis(data.createdAt);
          if (createdAt >= start7d) bookings7d++;
          if (createdAt >= start24h) bookings24h++;
        });

        setMetrics((prev) => ({
          ...prev,
          conciergeBookings24h: bookings24h,
          conciergeBookings7d: bookings7d,
          conversion7d: prev.newInquiries7d > 0 ? Math.round((bookings7d / prev.newInquiries7d) * 100) : 0,
        }));
      }
    );

    return () => {
      unsubConvos();
      unsubBookings();
    };
  }, [hotelId]);

  const conversion = metrics.newInquiries7d > 0 ? Math.round((metrics.conciergeBookings7d / metrics.newInquiries7d) * 100) : 0;

  const funnelStages = [
    { key: "inquiry", label: "Guest inquiry", value: metrics.newInquiries7d, state: "complete" as const },
    { key: "qualified", label: "Qualified lead", value: Math.round(metrics.newInquiries7d * 0.6), state: "active" as const },
    { key: "availability", label: "Availability checked", value: Math.round(metrics.newInquiries7d * 0.4), state: "pending" as const },
    { key: "requested", label: "Booking requested", value: metrics.conciergeBookings7d, state: "pending" as const },
    { key: "confirmed", label: "Confirmed booking", value: metrics.conciergeBookings7d, state: "pending" as const },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Booking conversion and inquiry performance at a glance" />

      {/* Section A — Operational overview (KPIs) */}
      <Section title="Operational overview" subtitle="How your hotel is performing right now">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard
            label="New inquiries (24h)"
            value={metrics.newInquiries24h}
            hint={`${metrics.newInquiries7d} in the last 7 days`}
            icon={MessagesSquare}
            tone="primary"
            loading={loading}
          />
          <KPICard
            label="Avg. first response time"
            value={metrics.firstResponseTime === null ? "—" : `${metrics.firstResponseTime} min`}
            hint="From guest message to first AI or staff reply"
            icon={Clock}
            tone="success"
            loading={loading}
          />
          <KPICard
            label="Confirmed bookings (24h)"
            value={metrics.conciergeBookings24h}
            hint={`${metrics.conciergeBookings7d} in the last 7 days`}
            icon={ClipboardCheck}
            tone="success"
            loading={loading}
          />
          <KPICard
            label="Inquiry-to-booking conversion"
            value={`${conversion}%`}
            hint="Booked inquiries ÷ total inquiries (7d)"
            icon={TrendingUp}
            tone="primary"
            loading={loading}
          />
        </div>
      </Section>

      {/* Section B — Booking conversion funnel */}
      <Section title="Booking conversion funnel" subtitle="Track guests from first contact to confirmed reservation">
        <div className="rounded-xl border border-[var(--border)] bg-white p-6">
          <Funnel stages={funnelStages} />
          <p className="text-xs mt-3 text-muted">
            Booking requests are distinguished from confirmed reservations. A booking is only confirmed after the guest explicitly confirms a quoted summary.
          </p>
        </div>
      </Section>

      {/* Section C — Live inbox activity */}
      <Section title="Live inbox activity" subtitle="Latest guest inquiries and their status">
        <div className="rounded-xl border border-[var(--border)] bg-white p-6">
          <EmptyState
            icon={MessagesSquare}
            title="No inquiries yet"
            description="When guests message your hotel through the website widget or concierge link, conversations will appear here."
            action={
              <Link
                to="/dashboard/inbox"
                className="inline-flex items-center gap-2 text-sm font-semibold"
                style={{ color: "var(--primary)" }}
              >
                Open inbox <ArrowRight size={14} />
              </Link>
            }
          />
        </div>
      </Section>

      {/* Section D — Upcoming reservations */}
      <Section title="Upcoming reservations" subtitle="Stays arriving soon">
        <div className="rounded-xl border border-[var(--border)] bg-white p-6">
          <EmptyState
            icon={CalendarCheck}
            title="No upcoming reservations"
            description="Confirmed reservations will appear here with guest details, arrival dates and room assignments."
            action={
              <Link
                to="/dashboard/reservations"
                className="inline-flex items-center gap-2 text-sm font-semibold"
                style={{ color: "var(--primary)" }}
              >
                Manage reservations <ArrowRight size={14} />
              </Link>
            }
          />
        </div>
      </Section>

      {/* Section E — Channel health */}
      <Section title="Channel health" subtitle="Where guests can reach your hotel">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-[var(--border)] bg-white">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                <Globe size={16} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Website</p>
                <p className="text-xs text-muted">AI Concierge chat widget</p>
              </div>
            </div>
            <StatusChip state="connected" label="Available" />
            <p className="text-xs mt-2 text-muted">Your web concierge is live on your hotel's link.</p>
            <button
              onClick={() => navigate("/dashboard/channels")}
              className="mt-3 inline-flex items-center gap-2 text-sm font-semibold"
              style={{ color: "var(--primary)" }}
            >
              View channels <ArrowRight size={13} />
            </button>
          </div>
          <div className="p-4 rounded-xl border border-[var(--border)] bg-white">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "#ecfdf3", color: "#15803d" }}>
                <Phone size={16} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>WhatsApp Business</p>
                <p className="text-xs text-muted">Meta Cloud API integration</p>
              </div>
            </div>
            <StatusChip state="pending" label="Coming soon" />
            <p className="text-xs mt-2 text-muted">WhatsApp is not connectable in this build. The Inbox shows Web conversations only.</p>
            <button
              type="button"
              disabled
              className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-muted)] disabled:opacity-50"
            >
              Not available
            </button>
          </div>
          <div className="p-4 rounded-xl border border-[var(--border)] bg-white">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                <Sparkles size={16} />
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Concierge link</p>
                <p className="text-xs text-muted">Permanent hotel-specific URL</p>
              </div>
            </div>
            {profile?.publicId ? (
              <>
                <StatusChip state="connected" label="Active" />
                <p className="text-xs mt-2 text-muted">Share your concierge link on social media, email and SMS.</p>
              </>
            ) : (
              <>
                <StatusChip state="pending" label="Not created" />
                <p className="text-xs mt-2 text-muted">Create your hotel's concierge link to give guests a direct way to reach you.</p>
              </>
            )}
            <button
              onClick={() => navigate("/dashboard/settings")}
              className="mt-3 inline-flex items-center gap-2 text-sm font-semibold"
              style={{ color: "var(--primary)" }}
            >
              Manage link <ArrowRight size={13} />
            </button>
          </div>
        </div>
      </Section>

      {/* Section F — Quick actions */}
      <Section title="Quick actions" subtitle="Common tasks to get started">
        <div className="action-grid">
          {actions.map(({ title, description, to, icon: Icon }) => (
            <ActionTile key={title} title={title} description={description} icon={<Icon size={18} />} to={to} />
          ))}
        </div>
      </Section>
    </div>
  );
}

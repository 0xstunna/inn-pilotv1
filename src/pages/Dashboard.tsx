import { Link } from "react-router-dom";
import { BedDouble, CalendarCheck, MessagesSquare, Sparkles, ArrowRight, ClipboardCheck, AlertCircle, Users, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { onSnapshot, query } from "firebase/firestore";
import { useHotelProfile } from "../lib/hotelProfile";
import { useWorkspace } from "../workspace/workspaceContext";
import { PageHeader } from "../components/ui";
import { hotelCollection } from "../lib/hotelScope";
import { COLLECTIONS } from "../lib/collections";
import { db } from "../../firebase";

const actions = [
  {
    title: "Room inventory",
    description: "Register real room names or numbers, choose room types, and review nightly rates and status.",
    to: "/dashboard/accommodation",
    action: "Manage rooms",
    icon: BedDouble,
  },
  {
    title: "Reservations",
    description: "Review guest stays, reservation status, check-in details and room assignments.",
    to: "/dashboard/accommodation",
    action: "View reservations",
    icon: CalendarCheck,
  },
  {
    title: "Guest inquiries",
    description: "Follow up on conversations and help guests finish their accommodation bookings.",
    to: "/dashboard/inbox",
    action: "Open inbox",
    icon: MessagesSquare,
  },
  {
    title: "AI Concierge",
    description: "Preview the guest booking experience and verify your public listing before sharing it.",
    to: "/",
    action: "Open concierge",
    icon: Sparkles,
  },
];

type Metrics = {
  needsAttention: number;
  newInquiries24h: number;
  newInquiries7d: number;
  conciergeBookings24h: number;
  conciergeBookings7d: number;
  handoffs7d: number;
  conversion7d: number;
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
  const [metrics, setMetrics] = useState<Metrics>({
    needsAttention: 0,
    newInquiries24h: 0,
    newInquiries7d: 0,
    conciergeBookings24h: 0,
    conciergeBookings7d: 0,
    handoffs7d: 0,
    conversion7d: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hotelId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const now = Date.now();
    const start24h = getStartOfDay().getTime();
    const start7d = getDaysAgo(7).getTime();

    const conversationsRef = hotelCollection(hotelId, COLLECTIONS.CONVERSATIONS);
    const bookingsRef = hotelCollection(hotelId, COLLECTIONS.BOOKINGS);

    const unsubConvos = onSnapshot(
      query(conversationsRef),
      (snap) => {
        let needsAttention = 0;
        let newInquiries24h = 0;
        let newInquiries7d = 0;
        let handoffs7d = 0;

        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          
          // Needs attention: not closed, not booked elsewhere, not handled by human
          if (data.closed !== true && data.bookedElsewhere !== true && data.handledBy !== "human") {
            needsAttention++;
          }

          // New inquiries
          const createdAt = data.createdAt?.toMillis ? data.createdAt.toMillis() : (data.createdAt ? new Date(data.createdAt).getTime() : 0);
          if (createdAt >= start24h) newInquiries24h++;
          if (createdAt >= start7d) newInquiries7d++;

          // Handoffs to human in last 7 days
          if (data.handledBy === "human") {
            const updatedAt = data.updatedAt?.toMillis ? data.updatedAt.toMillis() : (data.updatedAt ? new Date(data.updatedAt).getTime() : createdAt);
            if (updatedAt >= start7d) handoffs7d++;
          }
        });

        setMetrics((prev) => ({
          ...prev,
          needsAttention,
          newInquiries24h,
          newInquiries7d,
          handoffs7d,
        }));
        setLoading(false);
      },
      (err) => {
        console.error("Failed to load conversation metrics:", err);
        setLoading(false);
      }
    );

    const unsubBookings = onSnapshot(
      query(bookingsRef),
      (snap) => {
        let conciergeBookings24h = 0;
        let conciergeBookings7d = 0;

        snap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (data.source !== "concierge") return;

          const createdAt = data.createdAt?.toMillis ? data.createdAt.toMillis() : (data.createdAt ? new Date(data.createdAt).getTime() : 0);
          if (createdAt >= start24h) conciergeBookings24h++;
          if (createdAt >= start7d) conciergeBookings7d++;
        });

        setMetrics((prev) => {
          const conversion7d = prev.newInquiries7d > 0 ? Math.round((conciergeBookings7d / prev.newInquiries7d) * 100) : 0;
          return {
            ...prev,
            conciergeBookings24h,
            conciergeBookings7d,
            conversion7d,
          };
        });
      },
      (err) => {
        console.error("Failed to load booking metrics:", err);
      }
    );

    return () => {
      unsubConvos();
      unsubBookings();
    };
  }, [hotelId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={profile.name ? `Welcome to ${profile.name}` : "InnPilot workspace"}
        subtitle="Your accommodation booking workspace — rooms, guest inquiries and reservations in one place."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          to="/dashboard/inbox"
          className="block rounded-xl p-5 transition-transform hover:-translate-y-0.5"
          style={{ background: "var(--surface)", border: metrics.needsAttention > 0 ? "1px solid var(--warning, #f59e0b)" : "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: metrics.needsAttention > 0 ? "rgba(245, 158, 11, 0.1)" : "var(--surface-muted)", color: metrics.needsAttention > 0 ? "#f59e0b" : "var(--primary)" }}>
              <AlertCircle size={20} />
            </span>
            {metrics.needsAttention > 0 && (
              <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ background: "rgba(245, 158, 11, 0.1)", color: "#f59e0b" }}>
                Action needed
              </span>
            )}
          </div>
          <h3 className="text-2xl font-bold" style={{ color: "var(--text)" }}>{loading ? "—" : metrics.needsAttention}</h3>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Needs attention</p>
        </Link>

        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--surface-muted)", color: "var(--primary)" }}>
              <MessagesSquare size={20} />
            </span>
          </div>
          <h3 className="text-2xl font-bold" style={{ color: "var(--text)" }}>{loading ? "—" : metrics.newInquiries24h}</h3>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>New inquiries (24h)</p>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{metrics.newInquiries7d} in last 7 days</p>
        </div>

        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--surface-muted)", color: "var(--primary)" }}>
              <CalendarCheck size={20} />
            </span>
          </div>
          <h3 className="text-2xl font-bold" style={{ color: "var(--text)" }}>{loading ? "—" : metrics.conciergeBookings24h}</h3>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Bookings from concierge (24h)</p>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{metrics.conciergeBookings7d} in last 7 days</p>
        </div>

        <div className="rounded-xl p-5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <span className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--surface-muted)", color: "var(--primary)" }}>
              <TrendingUp size={20} />
            </span>
          </div>
          <h3 className="text-2xl font-bold" style={{ color: "var(--text)" }}>{loading ? "—" : `${metrics.conversion7d}%`}</h3>
          <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>Conversion rate (7d)</p>
          <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>{metrics.handoffs7d} handoffs to human (7d)</p>
        </div>
      </div>

      <div className="rounded-2xl p-5 sm:p-6" style={{ background: "var(--primary-soft)", border: "1px solid var(--border)" }}>
        <div className="flex items-start gap-3">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--surface)", color: "var(--primary)" }}>
            <ClipboardCheck size={22} />
          </span>
          <div>
            <h2 className="font-semibold text-base" style={{ color: "var(--text)" }}>Before you accept bookings</h2>
            <p className="text-sm mt-1" style={{ color: "var(--text-secondary)" }}>
              Verify each room's real name or number, type, guest capacity, nightly rate and status. Starter room entries or sample prices should not be treated as verified inventory.
            </p>
            <Link to="/dashboard/accommodation" className="inline-flex items-center gap-2 text-sm font-semibold mt-3" style={{ color: "var(--primary)" }}>
              Review accommodation <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {actions.map(({ title, description, to, action, icon: Icon }) => (
          <Link key={title} to={to} className="block rounded-xl p-5 transition-transform hover:-translate-y-0.5" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
            <span className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: "var(--surface-muted)", color: "var(--primary)" }}>
              <Icon size={20} />
            </span>
            <h2 className="font-semibold" style={{ color: "var(--text)" }}>{title}</h2>
            <p className="text-sm mt-2 min-h-10" style={{ color: "var(--text-secondary)" }}>{description}</p>
            <span className="inline-flex items-center gap-2 text-sm font-semibold mt-4" style={{ color: "var(--primary)" }}>{action}<ArrowRight size={15} /></span>
          </Link>
        ))}
      </div>
    </div>
  );
}

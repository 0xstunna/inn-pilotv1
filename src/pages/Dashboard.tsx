import { Link } from "react-router-dom";
import { BedDouble, CalendarCheck, MessagesSquare, Sparkles, ArrowRight, ClipboardCheck } from "lucide-react";
import { useHotelProfile } from "../lib/hotelProfile";
import { useWorkspace } from "../workspace/workspaceContext";
import { PageHeader } from "../components/ui";

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

export default function Dashboard() {
  const { hotelId } = useWorkspace();
  const { profile } = useHotelProfile(hotelId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={profile.name ? `Welcome to ${profile.name}` : "InnPilot workspace"}
        subtitle="Your accommodation booking workspace — rooms, guest inquiries and reservations in one place."
      />

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

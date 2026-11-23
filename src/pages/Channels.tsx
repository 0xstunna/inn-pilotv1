import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Globe,
  Phone,
  Sparkles,
  FileCode,
} from "lucide-react";
import { PageHeader, Section, StatusChip, LoaderOverlay } from "../components/ui";
import { apiFetch } from "../lib/apiFetch";

const CHANNELS = [
  {
    id: "web",
    name: "Website",
    description: "AI Concierge chat widget embedded on your hotel website.",
    icon: Globe,
  },
  {
    id: "whatsapp",
    name: "WhatsApp Business",
    description: "Coming soon — WhatsApp Business is not connectable in this build.",
    icon: Phone,
  },
  {
    id: "concierge",
    name: "Concierge link",
    description: "Permanent hotel-specific URL guests can open from anywhere.",
    icon: Sparkles,
  },
] as const;

export default function Channels() {
  const navigate = useNavigate();
  const [channelStatus, setChannelStatus] = useState<Record<string, { configured: boolean; missing?: string }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch("/api/ai/channels");
        if (res.ok) {
          const data = await res.json();
          const byId: Record<string, { configured: boolean; missing?: string }> = {};
          for (const ch of data.channels) {
            byId[ch.id] = { configured: ch.configured, missing: ch.missing };
          }
          setChannelStatus(byId);
        }
      } catch {
        // Channel status unavailable — UI shows disconnected states.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="space-y-6">
      <LoaderOverlay visible={loading} />

      <PageHeader
        title="Channels & Integrations"
        subtitle="Your AI concierge is live on the web. WhatsApp and other channels are coming soon."
      />

      {/* Connection summary */}
      <Section title="Connection summary" subtitle="Overall state of your guest communication channels">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {CHANNELS.map((ch) => {
            const status = channelStatus[ch.id];
            const configured = status?.configured ?? false;
            const live = configured && ch.id !== "whatsapp";
            return (
              <div key={ch.id} className="p-5 rounded-xl border border-[var(--border)] bg-white">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: live ? "var(--success-soft)" : "var(--neutral-soft)", color: live ? "var(--success-text)" : "var(--text-muted)" }}>
                    <ch.icon size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{ch.name}</p>
                    <p className="text-xs text-muted">{ch.description}</p>
                  </div>
                </div>
                {ch.id === "whatsapp" ? (
                  <StatusChip state="pending" label="Coming soon" />
                ) : live ? (
                  <StatusChip state="connected" label="Operational" />
                ) : ch.id === "concierge" ? (
                  <StatusChip state="pending" label={configured ? "Connected" : "Not created"} />
                ) : (
                  <StatusChip state="disconnected" label="Not connected" />
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Section A — Website integration */}
      <Section title="Website integration" subtitle="Share your hotel's web concierge with guests">
        <div className="p-5 rounded-xl border border-[var(--border)] bg-white">
          <p className="text-sm text-secondary mb-5" style={{ color: "var(--text-secondary)" }}>
            Guests can ask about rooms, availability and prices from your hotel's own concierge link.
            Create and copy that link in Settings, then add it to your website's contact page.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                  <Globe size={14} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Connection status</p>
              </div>
              <StatusChip state={channelStatus.web?.configured ? "connected" : "disconnected"} label={channelStatus.web?.configured ? "Connected" : "Not configured"} />

              <div className="pt-4 border-t border-[var(--border)]">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">How to share it</p>
                <ol className="text-sm space-y-2 text-muted" style={{ listStylePosition: "inside" }}>
                  <li>Open Settings → Guest AI Concierge.</li>
                  <li>Create the link if it doesn't exist yet.</li>
                  <li>Copy the link and add it to your website's contact page.</li>
                  <li>Guests open it to check rooms, availability and prices, and to book.</li>
                </ol>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--surface-muted)", color: "var(--text-muted)" }}>
                  <Sparkles size={14} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Your live link</p>
              </div>
              <p className="text-sm text-muted">
                Settings shows the real URL for this hotel and lets you copy it. No widget code is needed.
              </p>
              <button
                onClick={() => navigate("/dashboard/settings")}
                className="w-full flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg border border-[var(--primary-soft)] bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-[var(--primary-hover)] hover:text-[var(--primary-active)] transition-colors"
              >
                Manage concierge link
              </button>
              <div className="pt-4 space-y-2">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Share surfaces</p>
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs px-2 py-1 rounded-full border border-[var(--border)]" style={{ color: "var(--text-muted)" }}>Website</span>
                  <span className="text-xs px-2 py-1 rounded-full border border-[var(--border)]" style={{ color: "var(--text-muted)" }}>Email</span>
                  <span className="text-xs px-2 py-1 rounded-full border border-[var(--border)]" style={{ color: "var(--text-muted)" }}>SMS</span>
                  <span className="text-xs px-2 py-1 rounded-full border border-[var(--border)]" style={{ color: "var(--text-muted)" }}>Social</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Section B — WhatsApp Business */}
      <Section title="WhatsApp Business" subtitle="Coming soon — not connectable yet">
        <div className="p-5 rounded-xl border border-[var(--border)] bg-[var(--neutral-soft)]">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md flex items-center justify-center shrink-0" style={{ background: "var(--surface-muted)", color: "var(--text-muted)" }}>
              <Phone size={14} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Coming soon</p>
                <StatusChip state="pending" label="Coming soon" />
              </div>
              <p className="text-sm text-muted">
                WhatsApp is not available in this build, so the Inbox shows Web conversations only.
                There is nothing to connect here yet.
              </p>
              <button
                type="button"
                disabled
                className="mt-4 w-full flex items-center justify-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--border)] bg-white text-[var(--text-muted)] disabled:opacity-50"
              >
                Not available
              </button>
            </div>
          </div>
        </div>
      </Section>

      {/* Section C — Dedicated concierge link */}
      <Section title="Dedicated concierge link" subtitle="Your hotel's permanent AI concierge URL">
        <div className="p-5 rounded-xl border border-[var(--border)] bg-white">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-md flex items-center justify-center" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                  <Sparkles size={14} />
                </div>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Your concierge link</p>
              </div>
              <div className="text-xs rounded-md px-3 py-2" style={{ background: "var(--surface-muted)", color: "var(--text-muted)" }}>
                Create and copy your hotel's live link in Settings → Guest AI Concierge.
              </div>
              <button
                onClick={() => navigate("/dashboard/settings")}
                className="w-full flex items-center justify-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg border border-[var(--primary-soft)] bg-[var(--primary-soft)] text-[var(--primary)] hover:bg-[var(--primary-hover)] hover:text-[var(--primary-active)] transition-colors"
              >
                Manage concierge link
              </button>
            </div>
            <div className="space-y-4">
              <p className="text-sm text-secondary">
                Share this link on your website, social media, email signatures and SMS. Guests who open it reach
                your AI concierge directly — they can ask about rooms, check availability and book around the clock.
              </p>
              <div className="pt-4 border-t border-[var(--border)]">
                <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Share instructions</p>
                <ul className="text-sm space-y-2 text-muted" style={{ listStylePosition: "inside" }}>
                  <li>Add the link to your website's contact page.</li>
                  <li>Include it in email signatures and newsletters.</li>
                  <li>Post it on your social media profiles.</li>
                  <li>Add it to printed in-room materials.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Section D — Future integrations */}
      <Section title="Coming soon" subtitle="Planned channel integrations">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {([
            ["instagram", "Instagram", "Connect your hotel's Instagram account so guests can DM you and the AI concierge replies."],
            ["email", "Email", "Connect your hotel's support email so inquiries from email arrive in the same inbox."],
          ] as [string, string, string][]).map(([id, name, desc]) => (
            <div key={id} className="p-4 rounded-xl border border-[var(--border)] bg-[var(--neutral-soft)]">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--surface-muted)", color: "var(--text-muted)" }}>
                  <FileCode size={14} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{name}</p>
                  <span className="text-xs px-1.5 py-0.5 rounded-full border border-[var(--neutral-border)]" style={{ color: "var(--text-muted)", background: "var(--surface)" }}>
                    Planned
                  </span>
                </div>
              </div>
              <p className="text-sm text-muted">{desc}</p>
              <button className="mt-3 w-full flex items-center justify-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-lg border border-[var(--border)] bg-white text-[var(--text-muted)] hover:bg-[var(--layer-raised)] transition-colors disabled:opacity-50" disabled>
                Not available
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Section E — Connection monitoring */}
      <Section title="Connection monitoring" subtitle="Health checks for every connected channel">
        <div className="p-5 rounded-xl border border-[var(--border)] bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Channel</th>
                <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">State</th>
                <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Last activity</th>
                <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Webhook</th>
                <th className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--border)]">
                <td className="py-3" style={{ color: "var(--text)" }}>Website</td>
                <td className="py-3"><StatusChip state="connected" label="Available" /></td>
                <td className="py-3 text-muted">—</td>
                <td className="py-3 text-muted">N/A</td>
                <td className="py-3 text-muted">—</td>
              </tr>
              <tr className="border-t border-[var(--border)]">
                <td className="py-3" style={{ color: "var(--text)" }}>WhatsApp Business</td>
                <td className="py-3"><StatusChip state="pending" label="Coming soon" /></td>
                <td className="py-3 text-muted">—</td>
                <td className="py-3 text-muted">N/A</td>
                <td className="py-3 text-muted">—</td>
              </tr>
              <tr className="border-t border-[var(--border)]">
                <td className="py-3" style={{ color: "var(--text)" }}>Concierge link</td>
                <td className="py-3">{channelStatus.concierge?.configured ? <StatusChip state="connected" label="Active" /> : <StatusChip state="pending" label="Not created" />}</td>
                <td className="py-3 text-muted">{channelStatus.concierge?.configured ? "Active" : "—"}</td>
                <td className="py-3 text-muted">N/A</td>
                <td className="py-3">
                  <button onClick={() => navigate("/dashboard/settings")} className="text-xs font-semibold" style={{ color: "var(--primary)" }}>Manage</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

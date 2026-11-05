import { useState, type FormEvent, type MouseEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { getDoc } from "firebase/firestore";
import {
  ArrowRight,
  ChevronDown,
  Mail,
  MapPin,
  Wallet,
  KeyRound,
  Sparkles,
  Zap,
  Bot,
  Headset,
  Clock,
  BedDouble,
  LayoutDashboard,
} from "lucide-react";

import innpilotLogoLight from "../assets/brand/innpilot-logo-full-light.png";
import { hotelDocRef } from "../lib/hotelScope";
import { useWorkspace } from "../workspace/workspaceContext";

/**
 * The app routes with HashRouter, so a plain "#features" link would be read
 * as a route. In-page links scroll instead.
 */
const jumpTo = (id: string) => (event: MouseEvent<HTMLAnchorElement>) => {
  event.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
};

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Open an existing workspace by pasting its id (DECISIONS D30). The id is
 * checked against Firestore before the browser remembers it, exactly like a
 * stored one.
 */
function OpenWorkspace() {
  const { enterWorkspace } = useWorkspace();
  const navigate = useNavigate();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const open = async (event: FormEvent) => {
    event.preventDefault();
    const hotelId = value.trim();
    if (!WORKSPACE_ID_PATTERN.test(hotelId)) {
      setError("That doesn't look like a workspace ID. Copy it from Settings → Workspace.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const snap = await getDoc(hotelDocRef(hotelId));
      if (!snap.exists()) {
        setError("We couldn't find a workspace with that ID.");
        return;
      }
      enterWorkspace(hotelId);
      navigate("/dashboard");
    } catch {
      setError("We couldn't check that ID. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="open" className="max-w-6xl mx-auto px-6 -mt-10 relative z-10">
      <form onSubmit={open} className="card p-5 sm:p-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <p className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <KeyRound size={16} className="text-[var(--primary)]" /> Open your workspace
          </p>
          <p className="text-xs text-slate-500 mt-1 mb-3">
            Hotel staff: paste your workspace ID to manage your AI Concierge inbox, rooms and reservations.
          </p>
          <label htmlFor="workspace-id" className="sr-only">
            Workspace ID
          </label>
          <input
            id="workspace-id"
            className="input font-mono"
            placeholder="Workspace ID"
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {error && (
            <p className="text-xs mt-2" role="alert" style={{ color: "var(--danger-text)" }}>
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
          {busy ? "Opening…" : "Open workspace"} <ArrowRight size={16} />
        </button>
      </form>
    </section>
  );
}

const CONTACT_EMAIL = "hello@innpilot.app";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

/* ------------------------------------------------------------
   Feature grid
   ------------------------------------------------------------ */
const features: { icon: React.ReactNode; title: string; description: string }[] = [
  { icon: <Bot size={20} />, title: "AI Concierge for guests", description: "Answers guest messages, checks availability and takes bookings 24/7 — every chat lands in your inbox." },
  { icon: <Headset size={20} />, title: "Staff inbox", description: "Every guest conversation in one place. Take over any thread, reply, or hand it back to the AI." },
  { icon: <BedDouble size={20} />, title: "Rooms & reservations", description: "Track bookings from confirmation to check-out with live availability, so no room is ever double-booked." },
  { icon: <LayoutDashboard size={20} />, title: "Dashboard with AI metrics", description: "AI-sourced bookings, revenue, inquiry-to-booking conversion and average response time — all owner-facing." },
  { icon: <Clock size={20} />, title: "Set up in under a minute", description: "Create your hotel's workspace, get a ready-made room inventory with nightly rates, and take your first booking. No sign-up, no installation." },
  { icon: <Wallet size={20} />, title: "Honest payments", description: "Guests pay at the hotel on arrival. No fake deposit buttons, no hidden payment claims." },
];

/* ------------------------------------------------------------
   Why independent hotels choose InnPilot
   ------------------------------------------------------------ */
const valueProps: { icon: React.ReactNode; title: string; description: string }[] = [
  { icon: <Zap size={20} />, title: "Built for how you actually run a hotel", description: "Not a scaled-down enterprise suite. InnPilot is sized, priced and designed for independent properties." },
  { icon: <Bot size={20} />, title: "AI Concierge, not just a chat widget", description: "Guests get real availability, real prices and confirmed bookings — not a form they never hear back from." },
  { icon: <Headset size={20} />, title: "Your team stays in control", description: "Every guest conversation lands in your inbox. Take over any thread, reply, or hand it back to the AI." },
  { icon: <Wallet size={20} />, title: "Priced for independent operations", description: "No enterprise contracts or per-module upsells. Straightforward pricing that scales with your property." },
];

/* ------------------------------------------------------------
   FAQ
   ------------------------------------------------------------ */
const faqs: { q: string; a: string }[] = [
  { q: "Do I need to create an account?", a: "No. Click Get Started, tell us about your hotel and your workspace is ready straight away. There is no sign-up and no password." },
  { q: "What do I get when I create a workspace?", a: "A dashboard for your hotel with a starting room inventory and nightly rates in your currency, so you can take a reservation immediately. Add rooms any time from Accommodation." },
  { q: "How long does setup take?", a: "Under a minute. Name your hotel, add your contact details and how many rooms you have, and InnPilot builds your workspace." },
  { q: "Do you publish pricing?", a: "Every workspace starts on a free trial. Pricing is straightforward and scales with your property — no enterprise contracts or per-module upsells." },
  { q: "Does InnPilot work if my internet connection is unreliable?", a: "InnPilot is a cloud-based platform designed to stay fast and responsive on the connectivity typical of independent hotels." },
];

/* ------------------------------------------------------------
   FAQ accordion
   ------------------------------------------------------------ */
const FaqItem = ({ q, a, defaultOpen = false }: { q: string; a: string; defaultOpen?: boolean }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 p-4 sm:p-5 text-left"
      >
        <span className="font-medium text-slate-800 text-sm sm:text-base">{q}</span>
        <ChevronDown
          size={18}
          className="shrink-0 text-slate-400 transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="px-4 sm:px-5 pb-4 sm:pb-5 text-sm text-slate-500 leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ------------------------------------------------------------
   Page
   ------------------------------------------------------------ */
const LandingPage = () => {
  return (
    <div className="min-h-screen w-full font-poppins text-slate-800" style={{ background: "var(--app-bg)" }}>
      {/* Nav */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-slate-200">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <img src={innpilotLogoLight} alt="InnPilot" className="h-8 w-auto object-contain" />
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-500">
            <Link to="/" className="hover:text-slate-900 transition inline-flex items-center gap-1.5"><Sparkles size={14} /> Guest concierge</Link>
            <a href="#features" onClick={jumpTo("features")} className="hover:text-slate-900 transition">Features</a>
            <a href="#faq" onClick={jumpTo("faq")} className="hover:text-slate-900 transition">FAQ</a>
          </div>
          <div className="flex items-center gap-3">
            <a href="#open" onClick={jumpTo("open")} className="btn btn-secondary text-sm px-4 py-2">
              Open workspace
            </a>
            <Link to="/staff/get-started" className="btn btn-primary text-sm px-4 py-2">
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: "var(--rail)" }}>
        <div
          className="pointer-events-none absolute -top-32 -right-24 w-[420px] h-[420px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(45,212,200,0.22) 0%, transparent 70%)" }}
        />
        <div
          className="pointer-events-none absolute -bottom-40 -left-24 w-[420px] h-[420px] rounded-full blur-3xl"
          style={{ background: "radial-gradient(circle, rgba(14,147,163,0.18) 0%, transparent 70%)" }}
        />
        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-24 grid lg:grid-cols-2 gap-12 items-center">
          <motion.div initial="hidden" animate="show" variants={fadeUp}>
            <span className="inline-block text-xs font-semibold tracking-wide uppercase text-[var(--brand-cyan)] mb-4">
              InnPilot AI Concierge
            </span>
            <h1 className="text-4xl sm:text-5xl font-bold text-white leading-tight mb-5">
              The AI Concierge that books rooms for your hotel
            </h1>
            <p className="text-[var(--rail-text)] text-base sm:text-lg leading-relaxed mb-8 max-w-xl">
              Your guests get instant answers, availability checks and confirmed bookings — 24/7.
              Every conversation lands in your staff inbox, every booking lands in your
              reservations, and your team can step in at any moment. Set up in under a minute.
              No sign-up required.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/staff/get-started" className="btn btn-primary px-6 py-3 text-sm inline-flex items-center gap-2">
                Get Started <ArrowRight size={16} />
              </Link>
              <a
                href="#product"
                onClick={jumpTo("product")}
                className="px-6 py-3 text-sm font-semibold rounded-lg border border-white/15 text-white hover:bg-white/5 transition"
              >
                See how it works
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      <OpenWorkspace />

      {/* Feature grid */}
      <section id="features" className="max-w-6xl mx-auto px-6 py-20">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Everything your hotel needs, in one place</h2>
          <p className="text-slate-500">Built around the day-to-day of running an independent property.</p>
        </motion.div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f, i) => (
            <motion.div
              key={f.title}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={fadeUp}
              transition={{ delay: (i % 3) * 0.05 }}
              className="card p-5"
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                {f.icon}
              </div>
              <h3 className="font-semibold text-slate-800 mb-1">{f.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{f.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Product showcase */}
      <section id="product" className="py-20" style={{ background: "var(--surface-muted)" }}>
        <div className="max-w-6xl mx-auto px-6">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">How it works</h2>
            <p className="text-slate-500">From a guest's first message to a confirmed booking, everything in one place.</p>
          </motion.div>
          <div className="grid lg:grid-cols-3 gap-6">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={fadeUp}
              className="card p-6"
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                <Bot size={20} />
              </div>
              <h3 className="font-semibold text-slate-800 mb-2">Guest chats with the AI Concierge</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-4">
                The guest asks about availability, gets real prices and room options, and confirms a booking —
                all through the AI Concierge on your hotel's page.
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-cyan)]">
                1 <ArrowRight size={12} />
              </span>
            </motion.div>
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={fadeUp}
              transition={{ delay: 0.1 }}
              className="card p-6"
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                <Headset size={20} />
              </div>
              <h3 className="font-semibold text-slate-800 mb-2">Conversation lands in your inbox</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-4">
                Every guest thread appears in your staff inbox with the lead score, booking status and
                suggested follow-ups. Take over any time to reply yourself.
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-cyan)]">
                2 <ArrowRight size={12} />
              </span>
            </motion.div>
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={fadeUp}
              transition={{ delay: 0.2 }}
              className="card p-6"
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: "var(--primary-soft)", color: "var(--primary)" }}>
                <BedDouble size={20} />
              </div>
              <h3 className="font-semibold text-slate-800 mb-2">Booking confirmed in Accommodation</h3>
              <p className="text-sm text-slate-500 leading-relaxed mb-4">
                Confirmed bookings appear in Accommodation with the guest details, dates and room type.
                Guests pay at the hotel on arrival — no fake deposit buttons.
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--brand-cyan)]">
                3 <ArrowRight size={12} />
              </span>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Why independent hotels choose InnPilot */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="max-w-2xl mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Why independent hotels choose InnPilot</h2>
          <p className="text-slate-500">Not a scaled-down enterprise suite, a platform sized and priced for properties like yours.</p>
        </motion.div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {valueProps.map((v, i) => (
            <motion.div
              key={v.title}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={fadeUp}
              transition={{ delay: i * 0.05 }}
              className="card p-5"
            >
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: "rgba(45,212,200,0.14)", color: "var(--primary)" }}>
                {v.icon}
              </div>
              <h3 className="font-semibold text-slate-800 mb-1">{v.title}</h3>
              <p className="text-sm text-slate-500 leading-relaxed">{v.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Get Started */}
      <section id="pricing" className="py-20" style={{ background: "var(--rail)" }}>
        <div className="max-w-6xl mx-auto px-6">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="text-center max-w-xl mx-auto mb-10">
            <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">Ready to run your hotel?</h2>
            <p className="text-[var(--rail-text)]">
              Create your workspace in under a minute. Your AI Concierge, staff inbox and
              room inventory are ready straight away — no sign-up, no installation.
            </p>
          </motion.div>
          <div className="max-w-md mx-auto">
            <Link
              to="/staff/get-started"
              className="btn btn-primary w-full py-3 text-sm inline-flex items-center justify-center gap-2"
            >
              Get Started <ArrowRight size={16} />
            </Link>
            <p className="text-sm text-[var(--rail-text-muted)] mt-4 text-center">
              No account needed. Your workspace is remembered in this browser.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-6 py-20">
        <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} className="mb-10">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-3">Frequently asked questions</h2>
          <p className="text-slate-500">Everything you need to know before you get started.</p>
        </motion.div>
        <div className="space-y-3">
          {faqs.map((f, i) => (
            <motion.div key={f.q} initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp} transition={{ delay: i * 0.04 }}>
              <FaqItem q={f.q} a={f.a} defaultOpen={i === 0} />
            </motion.div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden" style={{ background: "var(--rail)" }}>
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={fadeUp}>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">Your hotel deserves better tools.</h2>
            <p className="text-[var(--rail-text)] mb-8 max-w-xl mx-auto">
              Start running your property with InnPilot.
            </p>
            <Link to="/staff/get-started" className="btn btn-primary px-8 py-3 text-sm inline-flex items-center gap-2">
              Get Started <ArrowRight size={16} />
            </Link>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 pt-12 pb-8" style={{ background: "var(--surface)" }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
            <div>
              <img src={innpilotLogoLight} alt="InnPilot" className="h-8 w-auto object-contain mb-3" />
              <p className="text-sm text-slate-500 leading-relaxed max-w-xs">
                The AI Concierge for independent hotels — guest chats, staff inbox and room inventory in one workspace.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Product</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><a href="#features" onClick={jumpTo("features")} className="hover:text-slate-900 transition">Features</a></li>
                <li><a href="#product" onClick={jumpTo("product")} className="hover:text-slate-900 transition">Product</a></li>
                <li><a href="#pricing" onClick={jumpTo("pricing")} className="hover:text-slate-900 transition">Pricing</a></li>
                <li><a href="#faq" onClick={jumpTo("faq")} className="hover:text-slate-900 transition">FAQ</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Workspace</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li><Link to="/staff/get-started" className="hover:text-slate-900 transition">Get Started</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Contact</h4>
              <ul className="space-y-2 text-sm text-slate-500">
                <li className="flex items-center gap-2">
                  <Mail size={14} className="shrink-0" />
                  <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-slate-900 transition">{CONTACT_EMAIL}</a>
                </li>
                <li className="flex items-center gap-2">
                  <MapPin size={14} className="shrink-0" />
                  Kampala, Uganda
                </li>
              </ul>
            </div>
          </div>
          <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-slate-400">© {new Date().getFullYear()} InnPilot · Built by Masai Labs</p>
            <p className="text-xs text-slate-400">AI Concierge for independent hotels, simplified.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default LandingPage;

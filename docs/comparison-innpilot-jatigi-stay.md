# Comparison: InnPilot vs. Jatigi Stay

**To:** Darius Twesigomwe  
**From:** Felix A. Masai  
**Date:** Fri Nov 06 2026  
**Subject:** What InnPilot and Jatigi Stay have in common — and what it means for our roadmap

---

## 1. Purpose

I reviewed the Jatigi Stay "Technology Stack & Solution Architecture" document alongside our InnPilot codebase. Both products were built for the **K Hotels AI Innovation Challenge** (November 2026). This note captures what they have in common, where they differ, and what it means for how we rank our roadmap items (MUST / SHOULD / LATER).

All InnPilot details are confirmed from the repo. Jatigi Stay details are drawn from its architecture document.

---

## 2. What they have in common

| Dimension | InnPilot (confirmed from repo) | Jatigi Stay (per architecture doc) |
|---|---|---|
| Challenge context | K Hotels AI Innovation Challenge | K Hotels AI Innovation Challenge |
| Domain | Hotels, guesthouses, lodges, resorts, hostels | Accommodation providers / hospitality |
| Core guest interaction | Conversational AI guest interface (web chat) | Conversational AI guest interface (WhatsApp) |
| Guest message interpretation | Natural-language inquiry → intent (dates, destination, room) | Guest message → intent (enquiry, request, complaint) |
| Staff handoff / human-in-the-loop | AI→human handoff in Inbox; staff take over, AI goes quiet | Smart Request Routing + escalation to staff/department |
| Structured operational records | Reservations (`RSV-…` reference), conversations | Request/complaint records (ID, category, assignee, timestamps, acknowledgement, resolution states) |
| Property-specific configuration | Per-hotel workspace (`hotelId`), listing, `publicId`, rooms, rates | Per-property knowledge base, brand, services, routing rules, escalation rules |
| Reusable across properties | Yes — multi-property network (`listed: true` + `publicId`) | Yes — common architecture, property-specific configuration |
| Complement, not replace | Complements staff/PMS; does not replace human teams | Explicitly complements existing staff/systems; not a PMS replacement |
| Staff notifications / inbox | Staff Inbox (conversations, lead score, status) | Staff/department notifications via n8n; handoff status tracked |
| Core challenge metric | Inquiry → confirmed-booking conversion | Request capture → routing → acknowledgement → resolution |
| No payment gateway in MVP | "Pay at hotel on arrival"; no deposit buttons | Support-focused; no payment mentioned |

**Bottom line:** both products are built around the same value proposition — *slow guest response and lost opportunity* — solved with conversational AI, structured records, staff handoff, and property-specific configuration. Jatigi Stay is a useful benchmark for the features we're already prioritizing (inbox, handoff, structured records, per-property config).

---

## 3. Where they differ

| Area | InnPilot | Jatigi Stay |
|---|---|---|
| Primary job | Booking concierge: inquiry → **confirmed reservation** | Guest support: enquiry → request/complaint → **routing & resolution** |
| Channel | Web chat (`/#/`, `/#/c/:publicHotelId`) | WhatsApp Business Platform (Cloud API) |
| Conversational AI | Groq (default `openai/gpt-oss-120b`) or Gemini; server-only tools | Botpress Cloud + LLM |
| Backend orchestration | Vercel functions + `server/ai/` tools | n8n workflows |
| Data store | Firebase Firestore | Google Sheets / Airtable (initial); dedicated DB later |
| Core artifact | Reservation with `RSV-…` reference | Structured request/complaint record |
| Booking safety | Server-enforced re-check + explicit confirmation + transaction | Routing rules configured with hotel; not AI-inferred |
| Auth model | Workspace-id key; no user accounts | Not specified in doc |
| Stack | React 19 + Firebase + Vercel + Groq/Gemini | Botpress + n8n + WhatsApp + Sheets/Airtable |

---

## 4. Implications for our roadmap ranking

The commonalities reinforce our current MUST / SHOULD / LATER split (see `docs/` specs):

- **MUST** — things both products need to win on: destination-first copy & search, low-friction booking (no home address, optional arrival/flight/passport), operator metrics view on the Staff Portal. These map directly to the shared core value proposition.
- **SHOULD** — funnel dashboard with persistent rollup, `countryOfResidence` + arrival/flight fields, booking-to-conversation attribution, concierge on/off switch.
- **LATER** — multi-leg trip planning & arrival-night recommendations; platform admin console with plans/metering/entitlements; payment gateway.

If Jatigi Stay's emphasis on Smart Request Routing (structured records, routing rules, acknowledgement/resolution states) proves to be a differentiator judges care about, we could consider whether a lightweight "request logging" complement fits within our MUST scope — but for the K Hotels challenge, conversion-focused booking (our core metric) should stay first.

---

## 5. Suggested next steps

1. Read the attached Jatigi Stay architecture doc and confirm the comparison columns above.
2. Decide whether any Jatigi Stay capability (e.g., structured request/complaint logging, department routing) should be added to our roadmap and at what priority.
3. Keep `docs/admin-dashboard-spec.md` (phased, builds on existing codebase) and `docs/trip-planning-spec.md` (LATER/pitch-only) as the reference for what we build next.
4. Use `docs/innpilot-technology-stack-solution-architecture.md` as our own one-pager when we need to describe InnPilot's stack in the same format as Jatigi Stay's document.

---

Let me know once you've reviewed and I can update the roadmap labels or the one-pager accordingly.

# InnPilot — Admin / Operator Dashboard Spec

Short, phased spec. **No code changes are implemented by this document.** All paths relative to `C:\inn-pilotv1`.

## Criteria used

Core challenge metric: **inquiry → confirmed-booking conversion**.
Supporting: first response time, completed inquiries, availability-check success, booking completion rate, abandoned booking steps.

Everything in Phase 0 must build on what the existing codebase already supports:
`src/lib/metrics.ts` (`computeMetrics`), `src/pages/Dashboard.tsx` (KPI cards + `conversion7d`), `src/pages/Accommodation.tsx`, `src/pages/inbox/Inbox.tsx`, `src/pages/Settings.tsx` (`saveConciergeListing`, `publishConciergeLink`), `src/lib/hotelListing.ts` (`matchesDestination`), `firestore.rules` (trial plan required on create; `conciergeConversations`/`publicHotels` client-denied; subscription field gated).

---

## Phase 0 — Challenge MVP (demo, seeded/simulated data, clearly labeled)

Operator console: one hotel at a time, workspace id is the key (`/#/staff` → `/#/dashboard/*`).

- **Funnel KPI cards on the existing dashboard** — inquiries (conversations created in range), quoted (`bookingStatus === "quoted"`), confirmed (`bookingStatus === "booked"` + `reservationId` present), conversion % = confirmed ÷ inquiries × 100. Computed in-memory from existing snapshots — **no new collections, no persistent rollup**. Label the looseness: every conversation counts as an inquiry, including general questions.
- **Reservations list / detail** — existing Accommodation list; detail shows reservationId (`RSV-…`), guest name, phone, room type, dates, nights, total, currency, `source` ("concierge" vs front-desk), payment status ("Pending — pay at hotel"), status, createdAt. Displays `countryOfResidence` only if the field exists (it does not yet — adding it is the small booking-field change in the roadmap).
- **Concierge on/off** — toggle `listed: true/false` on the hotel listing. When off, the hotel's concierge link returns not-found. Wired through Settings (currently deferred D13/D14 — a concrete "should do" candidate).
- **Inbox** — existing `Inbox.tsx`: take over / reply / hand back to AI / close / snooze, lead-score and status badges, selected-hotel badge, filters. Empty state: "No conversations yet — share your concierge link."
- **Platform admin** — none for the demo. Show a clearly simulated/mocked screen with illustrative metering numbers, labeled **"simulated — not connected to real metering"**.

**Effort:** S–M. **Label:** all demo data "simulated / seeded".

---

## Phase 1 — Production operator console (post-challenge)

- **Funnel screen** (`/dashboard/funnel` or panel on `/#/dashboard`): exact formulas — inquiries; qualified (lead hot/warm); reservation requested (bookingStatus "quoted"); confirmed (booked + `reservationId`); conversion = confirmed ÷ inquiries; average first reply time (median of first reply − first guest message, from `messages[].at`); after-hours inquiries handled (first message outside business window + any reply); abandoned at summary (`pendingBooking` set, no booking within 24h).
- **Reservations detail**: guest **country of residence**, optional arrival/flight details (arrival time, flight number, pickup needed — captured **after** confirmation, not required at booking), link to the inbox thread.
- **Concierge control screen**: property info (name, location, region, country, description, phone, email, currency), knowledge-base editor (policies text + amenities tags), read-only rates/availability table with "no rate" warnings, `listed` on/off, destination tag for destination-first matching.
- **Quality screen**: unanswered/low-confidence conversations derivable from error turns; guest-feedback thumbs labeled demo-only (not persisted); "teach the concierge" notes written as audit entries.
- **Plan & usage**: current plan (trial active by default per `firestore.rules`), usage vs limits this billing period (conversations, messages, estimated tokens, attributed bookings), progress bars, upgrade prompt that logs intent to audit (**no payment integration**).
- **Attribution**: `sourceConversationId` on `accomodation` bookings so every attributed booking traces to its conversation — basis for any per-attributed-booking fee later.

**Depends on:** Phase 0 field additions (`countryOfResidence`, `arrivalDetails`, `sourceConversationId`).

---

## Phase 2 — Platform admin console (post-challenge, separate app)

Tenant management (list all hotels/workspaces, plan, status, listed, concierge link, last activity, suspend/reactivate, change plan), metering per tenant per period (conversations, messages, estimated tokens, attributed bookings, API calls), entitlements (plans/tier limits + enforcement at concierge turn start: soft warning at 80%, hard stop/guest-safe message at 100%), unit economics (LLM cost per conversation/booking as assumptions), system health (latency p50/p95, error rate, rate-limit rate, failed bookings, health endpoint), safety (abuse flags, PII access log, retention policy), audit log, view-as-tenant (logged).

**Effort:** L. Requires a platform app separate from the hotel workspace; Admin SDK reads bypass `firestore.rules`.

---

## Out of scope for the challenge MVP

Per-attributed-booking billing, payment gateway/deposit logic, per-user staff roles, workspace-id rotation, multilingual AI, native mobile apps, real WhatsApp/Instagram/Email channels.

## Open questions

- No explicit judging rubric/deadline file in the repo; criteria derived from `MVP_SCOPE.md`, `CHALLENGE_PRODUCT_SCOPE.md`, `README.md`.
- Subscription tier prices and per-attributed-booking fee amounts not defined.
- No payment provider selected; judges must accept "pay at hotel" with no payment flow.

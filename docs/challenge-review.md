# InnPilot — Challenge Review

Read-only review of the codebase against the K Hotels AI Innovation Challenge, with the product reframing
from the new brief applied: InnPilot is conversational AI for the whole hospitality sector (not one brand),
the guest UI is destination-first (tourist experience; AI supporting, not headline), booking is low-friction,
and the business model is free pilots → monthly subscription by plan tier + per-attributed-confirmed-booking fee,
with metering and entitlement enforcement.

No code is changed by this document. All file paths are relative to `C:\inn-pilotv1`.

---

## Source of truth used

The challenge does not ship an explicit judging rubric or deadline file. Criteria below are derived from
`MVP_SCOPE.md` ("product in one sentence", "in scope / out of scope", "golden path", "challenge success metric"),
`CHALLENGE_PRODUCT_SCOPE.md` (primary guest journey, staff MVP, room inventory quality rule) and
`README.md` §Challenge Demonstration. Open questions from that absence are listed at the end.

Key evidence files reviewed:
- `MVP_SCOPE.md`, `CHALLENGE_PRODUCT_SCOPE.md`, `README.md`, `PROJECT_STATUS.md`, `DECISIONS.md`,
  `ARCHITECTURE.md`, `DEPLOYMENT.md`, `TEST_PLAN.md`, `firestore.rules`
- `src/pages/concierge/` (guest UI), `src/pages/home.tsx` (staff landing), `src/pages/inbox/`,
  `src/pages/Dashboard.tsx`, `src/pages/Settings.tsx`, `src/pages/Accommodation.tsx`
- `src/lib/booking.ts`, `src/lib/conversations.ts`, `src/lib/leadScoring.ts`, `src/lib/followUps.ts`,
  `src/lib/metrics.ts`, `src/lib/hotelListing.ts`, `src/lib/publicHotel.ts`, `src/lib/confirmation.ts`,
  `src/lib/concierge.ts`, `src/lib/useHotelData.ts`, `src/workspace/`
- `api/ai/concierge.ts`, `api/ai/network.ts`, `api/ai/hotel.ts`, `api/ai/conversation.ts`, `api/ai/health.ts`
- `server/network.ts`, `server/hotels.ts`, `server/guestConversations.ts`, `server/conversations.ts`,
  `server/ai/prompts/concierge.ts`, `server/ai/types.ts`, `server/ai/groq.ts`

---

## 1. Criteria scorecard

| # | Criterion (derived) | Score /10 | Evidence | Highest-impact improvement |
|---|---------------------|-----------|----------|----------------------------|
| 1 | **Golden path**: natural-language inquiry → confirmed reservation (no login, real reference) | 8 | `MVP_SCOPE.md` golden path is implemented end-to-end; verified 39/39 on real Groq (`PROJECT_STATUS.md` Phase 9, run 3). `create_reservation` requires earlier summary + explicit yes (`src/lib/confirmation.ts`, `server/ai/tools/createReservation.ts`). | Re-run the full golden path against the current build to reconfirm after copy/reframe edits; add a one-click "demo mode" seed button in Settings so a judge can populate 5 properties + rooms without the CLI. |
| 2 | **Inquiry→booking conversion** tracked & shown | 7 | `src/lib/metrics.ts` `computeMetrics` is source-aware (concierge bookings vs total inquiries). Dashboard KPI cards show concierge bookings + conversion7d (`src/pages/Dashboard.tsx`). `src/lib/leadScoring.ts` + `src/lib/followUps.ts` score leads deterministically. | Conversion is computed in-memory from two snapshots in `Dashboard.tsx` (lines 93-164) with no persistent rollup — add a per-conversation attribution flag so a booking can be tied to the conversation that produced it (see data model additions in `docs/admin-dashboard-spec.md`). |
| 3 | **Multi-hotel network search** | 9 | `server/network.ts` resolves public ids, `listed: true` opt-in, destination matching (`src/lib/hotelListing.ts`), ≤5 options ranked by type/fit/price. `GET /api/ai/network` feeds the home page. | None critical — this is the strongest area. |
| 4 | **Staff MVP**: Accommodation, Reservations, Inbox, Settings | 8 | Routes exist (`App.tsx` lines 82-100). `Accommodation.tsx`, `Inbox.tsx`, `Settings.tsx` present. Legacy restaurant/bar/parking/expenses/reports redirect to Accommodation (`App.tsx` lines 94-98). | Staff has no funnel or usage view (the gap this review's admin spec addresses). Reservations list/detail does not surface guest country of residence or optional arrival/flight details (not captured at booking). |
| 5 | **Booking safety**: re-check + explicit confirmation, server-enforced | 9 | `prepare_booking` re-checks availability/price, writes nothing (`server/ai/tools/`). `create_reservation` refuses without a matching pending booking from an earlier turn + explicit yes (`isExplicitConfirmation`, `src/lib/confirmation.ts`). Transactional per-candidate booking, cheapest free room, price-change guard (`price_changed`). Mutation checks in tests (`PROJECT_STATUS.md` Phase 4/5). | None critical. |
| 6 | **Destination-first tourist reframing** (Bwindi, Buyonyi, Entebbe, Murchison Falls; AI supporting not headline) | 3 | Home page says "Find your stay with AI" (`ConciergePage.tsx` line 619). Result cards are hotel-first, not destination-first. README/MVP_SCOPE still center "K Hotels properties" and AI as the headline. | Reframe guest UI to destination-first: lead with regions/parks ("stays near Bwindi"), AI as the helper inside the conversation, not the page headline. Copy pass across `ConciergePage.tsx`, `home.tsx`, `README.md`. |
| 7 | **Low-friction booking** (no home address; country of residence only; optional arrival/flight after confirmation; passport/ID at pre-arrival/check-in) | 5 | `prepare_booking` collects name + phone (+ optional email) — no address, no passport (`types.ts` `ConciergeQuote`, `src/lib/booking.ts` `validateBookingDetails`). But no `countryOfResidence` field, no optional arrival/flight step after confirmation. | Add `countryOfResidence` to the booking summary (prompt asks for it), make arrival/flight details optional post-confirmation upsell, remove any address capture. |
| 8 | **Free Groq tier demo reliability** | 6 | Groq default `openai/gpt-oss-120b`; free limits 30 RPM / 1K RPD / 8K TPM documented (`DECISIONS.md` D31). One bounded retry, 429 `retry-after`, guest-safe messages (`server/ai/groq.ts`). ~140 full booking conversations/day (`PROJECT_STATUS.md`). | Concurrent guests will hit the safe "try again" message (known issue #5 in `PROJECT_STATUS.md`). For a 90-second demo this is acceptable if paced; add a visible "demo pace" note and pre-seeded fallback responses if the judge runs live. |
| 9 | **Branding**: InnPilot/neutral; K Hotels only as property names/data on results cards | 6 | Recent commits dropped most "K Hotels" copy from UI (`ConciergePage.tsx`, `ErrorBoundary.tsx`, `parts.tsx`, `home.tsx`, `Settings.tsx`, `inbox/parts.tsx`, `WorkspaceRoute.tsx`). But `README.md` line 264 still says "Built by Masai Labs for the K Hotels AI Innovation Challenge", `package.json` description says "search K Hotels properties", and seed data is 5 K Hotels properties (`scripts/seed/k-hotels.ts`). | Rename product references in README/package.json to "InnPilot"; label seed data explicitly as demo; keep K Hotels only as property names/locations/photos on cards. |
| 10 | **Honest payment disclosure** (pay at hotel on arrival; no fake deposit buttons) | 8 | Prompt rule 5 says "payment is settled at the hotel" (`server/ai/prompts/concierge.ts` line 86). Recent rework of `home.tsx` replaced "Contact Sales"/"Custom plan" pricing teaser with honest "Get Started". | None critical — keep payment out of the concierge entirely; no payment provider integration per rules. |

**Overall:** The booking engine and safety model are strong (scores 8-9). The weakest areas for this challenge are destination-first reframing (3), low-friction booking-field completeness (5), and Groq reliability under concurrent demo load (6). Branding is mid-fix (6) after the recent copy pass.

---

## 2. Demo story — 90 seconds

**Audience:** challenge judges. **Goal:** show a tourist booking a stay near a destination, then the hotel operator seeing it arrive in their inbox — proving both sides of the two-sided marketplace in one flow.

### Setup (before the clock starts)
- Emulator running with `npm run seed:k-hotels -- --reset` (5 demo properties in Western Uganda: Kabale, Mbarara, Fort Portal, plus Kampala/Jinja). Label them clearly as demo data.
- Two browser tabs open: Tab A = guest concierge `http://localhost:5173/#/`; Tab B = staff workspace `http://localhost:5173/#/staff` → open the Kabale workspace id (paste from seed output).
- Groq key configured; health `GET /api/ai/health` → `{"status":"ok","provider":"groq","configured":true}`.

### 0:00–0:10 — Hook: destination first (guest tab)
Judge sees the concierge home. **Say:** "InnPilot helps a tourist find and book a stay near a destination — Bwindi, Buyonyi, Entebbe or Murchison Falls — without calling or waiting for a quote."
- Type: *"I need a double room near Bwindi from 10–15 October."*
- AI replies within ~20-40s (Groq free tier) with 3 options: hotel, location, room type, price/night, nights, total, availability — all from live inventory, not invented.

### 0:10–0:35 — Choose & confirm (guest tab)
- Guest picks option 1: *"I'll take the first one."*
- AI asks for name and phone (one question). Guest gives them.
- AI shows the booking summary: hotel, room, dates, total. **Say:** "Every figure came from the hotel's own inventory — the AI can't invent a price."
- Guest clicks **Confirm** (or types "Yes, confirm this booking").
- **Booking confirmed** card appears with a real `RSV-…` reference. **Say:** "Payment is settled at the hotel on arrival — no deposit button, no payment gateway."

### 0:35–0:55 — Operator value (staff tab)
Staff switches to Tab B. **Say:** "While the guest was booking, this arrived in the hotel's inbox — no one monitored a phone or email."
- Inbox row: guest name, "Web", AI, lead score (🔥 Hot / ⭐ VIP), status **Booked**, selected hotel badge = Kabale.
- Staff opens the thread: full conversation, booking summary attached.
- Staff opens Accommodation: the `RSV-…` reservation is there with `source: "concierge"`, guest name, dates, room, total.
- Dashboard: concierge bookings 24h and conversion rate tick up.

### 0:55–1:30 — Handoff & after-hours (optional, if time)
- **Say:** "If the guest had asked something the AI couldn't answer, a staff member takes over — the AI goes quiet and staff reply from the same inbox."
- Demonstrate: staff clicks "Take over" on a thread, types a reply, guest page shows it via polling (`GET /api/ai/conversation`).
- **Say:** "After-hours inquiries that used to be lost now convert — that's the revenue InnPilot recovers."

### What could break / weaken the demo
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Groq free-tier 429 (8K TPM shared across all guests) | Medium during a live demo with multiple turns | Pace the demo to one turn every ~40s; have a scripted fallback video ready; pre-warm with one turn before the judge watches. |
| Conversation takes >25s (turn timeout) | Low-Medium | Keep the demo request simple (dates + destination + room type); avoid multi-turn clarification. |
| Staff workspace id not copied | Low | Copy the seed-printed id into Tab B before starting; the id is the key (no accounts). |
| Seed data reads as "K Hotels" brand (confuses "not one brand" reframe) | Medium | Verbally label seed as demo data; show a destination-first query ("near Bwindi") not a hotel-name query. |
| Booking reference not visible in staff Accommodation immediately | Low | Transactional write is synchronous; refresh the Accommodation tab if needed. |

---

## 3. Gaps and risks

### Fragile flows
1. **Groq free-tier concurrency** — `PROJECT_STATUS.md` known issue #5: ~8K TPM means about one tool turn per 40s across all guests; concurrent guests get the safe "try again" message. `api/ai/concierge.ts` has an in-memory rate limit (`RATE_LIMIT`, 12/min) that resets per serverless instance/cold start — not a security control (`DEPLOYMENT.md` §8). For the demo, one judge at a time is fine; for a public demo, budget turns carefully.
2. **Turn timeout** — `GROQ_TIMEOUT_MS` default 25s, below `vercel.json` `maxDuration` 30s (`DEPLOYMENT.md` §3). A slow model call surfaces a 504 to the guest with a safe message.
3. **Inbox messages not copied across hotels** — `PROJECT_STATUS.md` known issue #3: a staff reply at one hotel is not copied into other hotels' mirrors of the same guest thread (D29). A network guest who booked elsewhere shows "Closed" in other inboxes; staff can't see the full thread from another property.
4. **No conversation survives across tabs** — conversation id lives in `sessionStorage` (`src/lib/concierge.ts`); a new tab starts a new thread. A judge reloading mid-demo loses context.
5. **Settings concierge listing not clicked through in a browser** — `PROJECT_STATUS.md` known issue #7; `saveConciergeListing` / `publishConciergeLink` are unproven end-to-end via UI.

### Empty states
- Network home with zero listed hotels: `Properties` renders `null` (ConciergePage.tsx line 701-702) — shows nothing, no "no hotels yet" guidance. Acceptable for demo (seed ensures hotels), weak for a real hotel onboarding.
- Inbox empty state: exists (`EmptyState` component) but not verified against live web threads.

### Mobile
- `ConciergePage.tsx` mobile 390px checked ("no horizontal overflow") per `PROJECT_STATUS.md` Phase 1. Composer grows to 160px on empty chat (`large` prop). Dashboard/inbox cards are grid-based; likely usable but not explicitly mobile-tested for the new destination-first layout.

### Security / privacy
1. **Workspace id is the key** — anyone holding a 20-char `hotelId` can open that workspace (`DECISIONS.md` D2, `firestore.rules` allow `get: if true` on `/hotels/{hotelId}`). No per-user accounts, no revocation. `Settings.tsx` warns but there's no way to rotate a leaked id.
2. **Guest PII** — booking captures name + phone (+ optional email) and stores them in `accomodation`. No country-of-residence field yet (gap #7 above). No retention policy; records are never deleted (D4: "nothing ... can be deleted"). No PII access log.
3. **`conciergeConversations` client-denied** — good (rules line 338-340), but canonical thread holds `pendingBooking` (the summary the guest must confirm) and internal hotelIds; only the Admin SDK touches it.
4. **No abuse/spam flags or rate-limit persistence** — in-memory rate limit per instance; no tenant-level throttling yet.
5. **`ALLOWED_ORIGINS` unset = same-origin only** — fine for Vercel, but any future embedding needs a conscious decision.

---

## 4. Impact proof (metrics to show honestly)

All computable from existing data; label clearly as "demo data" or "measured locally".

| KPI | Formula (exact) | Where it lives | Honesty note |
|-----|----------------|----------------|--------------|
| First response time | `guest message at → first AI/staff reply at`, median | TurnTrace timing persisted per turn (`server/ai/gemini.ts` D17, logged via `api/ai/concierge.ts` timing) | Not surfaced in UI today; pull from logs for the demo. |
| Inquiry→booking conversion (7d) | `concierge bookings (source="concierge") in 7d ÷ new inquiries (conversations created) in 7d × 100` | `src/pages/Dashboard.tsx` lines 151-158 (`conversion7d`) | Counts every conversation as an inquiry, including general questions — overstates funnel; label "inquiries that reached a booking summary" as the tighter metric. |
| Concierge bookings (24h / 7d) | count of `accomodation` docs with `source: "concierge"` in range | `Dashboard.tsx` bookings snapshot | Real, server-enforced. |
| After-hours inquiries handled | conversations with guest message outside 08:00-18:00 local that got a reply | Not currently computed | Would need a new query; derivable from `messages[].at`. |
| Abandoned booking steps | turns where `prepare_booking` returned ready but no `create_reservation` followed | Not currently tracked | Derivable from `pendingBooking` staleness; add to dashboard if time permits. |
| Tokens per booking conversation | summed `inputTokens` + `outputTokens` across the turn | Logged per turn (`api/ai/concierge.ts` lines 480-481) | Measured locally: ~18K tokens / 7 requests per booking (`PROJECT_STATUS.md` Phase 9). |

**How to present:** Show the Dashboard KPI cards live (they're real), then one slide with the formula + the locally-measured numbers labeled "demo environment, seeded data". Do not present aggregate revenue or occupancy as proven business results.

---

## 5. Credibility package

### README improvements
- Rewrite the hero and "Challenge Demonstration" to be destination-first (Bwindi/Buyonyi/Entebbe/Murchison Falls), AI as the helper, not the headline.
- Replace "K Hotels AI Innovation Challenge" branding line (line 264) with neutral wording; note K Hotels seed data is illustrative demo data only.
- Add a "Demo in 90 seconds" section (the script from Section 2).
- Add a "Data honesty" section: demo data is seeded and labelled; prices are illustrative; no payment processing.
- Add low-friction booking promise: country of residence only, no home address, payment at the hotel.

### Architecture diagram
A single-sheet diagram replacing `ARCHITECTURE.md` §1 with three layers: (1) guest destination-first concierge (`/#/`, `/#/c/:id`) → `/api/ai/*` → Groq + tools → Firestore; (2) staff workspace (`/#/staff`, `/#/dashboard/*`) → Firestore client + rules; (3) platform (future) metering/entitlements admin. Cite the actual modules so judges can trace it to code.

### Demo video outline (90s)
1. 0-10s: Open `localhost:5173/#/`, type "double room near Bwindi 10-15 October".
2. 10-25s: AI shows 3 real options with prices; guest picks option 1.
3. 25-45s: Guest gives name/phone, reviews summary, clicks Confirm.
4. 45-60s: `RSV-…` reference appears; staff tab shows the inbox row (Booked, lead score, selected hotel).
5. 60-75s: Staff opens Accommodation — reservation present with `source: "concierge"`.
6. 75-90s: Staff takes over a waiting thread and replies; guest page shows it via polling. Close with "pay at the hotel on arrival".

### One-page pitch outline
- Problem: slow replies + low inquiry→booking conversion for lodges/hotels near tourist destinations.
- Product: destination-first booking concierge; AI supporting, not headline; guests book in one conversation; staff see everything in one inbox.
- Proof: golden path verified on real Groq (39/39), booking safety enforced server-side, no fake prices or deposits.
- Model: free pilot → monthly subscription by tier + small fee per attributed confirmed booking (metering enforced).
- Ask: pilot with one real lodge/hotel near a destination.

### Pilot plan with one real hotel/lodge
- Pick one lodge near Bwindi/Buyonyi/Entebbe/Murchison Falls.
- Seed their real property (name, location, rooms, rates) — NOT the K Hotels demo data.
- Staff onboards via `/#/staff` → Settings → publish concierge link (`publishConciergeLink`, `src/lib/hotelProfile.ts`).
- Run 2-4 weeks; measure inquiry→booking conversion and first response time against their before numbers (manual baseline).
- Label all figures "pilot, n=1, illustrative".

---

## 6. Prioritized roadmap

Effort: S = days, M = 1-2 weeks, L = 3+ weeks. Impact = effect on challenge judging.

### Must do before submission
| # | Task | Effort | Impact | Dependencies |
|---|------|--------|--------|--------------|
| M1 | Destination-first copy reframe on guest UI (`ConciergePage.tsx`, `home.tsx`, `README.md`) | S | High | None |
| M2 | Add `countryOfResidence` to booking summary & prompt; remove address capture | S | High | `server/ai/prompts/concierge.ts`, `types.ts` |
| M3 | Re-verify full golden path on real Groq after copy edits | S | High | Groq key |
| M4 | Label seed data as demo data everywhere (README, package.json, seed script) | S | Medium | None |
| M5 | One-click demo seed in Settings (so judges don't need the CLI) | M | Medium | `publishConciergeLink` exists |
| M6 | Pre-record 90s demo video fallback (Groq 429 risk) | S | High | None |
| M7 | README credibility package (demo script, data honesty, pilot plan) | S | Medium | None |

### Should do
| # | Task | Effort | Impact | Dependencies |
|---|------|--------|--------|--------------|
| S1 | Staff funnel dashboard (inquiries → quoted → booked → confirmed, reply time, after-hours) | M | High | `metrics.ts`, `useHotelData.ts`, `Dashboard.tsx` |
| S2 | Reservations detail: guest country of residence, optional arrival/flight, pickup needs | M | Medium | booking field additions |
| S3 | Conversation attribution: link each `accomodation` booking to its source conversation id | S | Medium | `createReservation.ts`, `guestConversations.ts` |
| S4 | Concierge on/off switch per hotel (currently deferred D13/D14) | M | Medium | `firestore.rules`, `Settings.tsx` |
| S5 | Empty-state guidance for zero listed hotels | S | Low | `ConciergePage.tsx` `Properties` |

### Later
| # | Task | Effort | Impact | Dependencies |
|---|------|--------|--------|--------------|
| L1 | Platform admin console (metering, entitlements, unit economics) — see `docs/admin-dashboard-spec.md` | L | High (post-challenge business model) | None yet |
| L2 | Persistent rate limiting & tenant throttling (replace in-memory) | M | Medium | Redis or similar |
| L3 | PII access log + retention policy | M | Low (challenge) | Legal review |
| L4 | Multi-language (confirmation/lead scoring are English-only) | L | Low | None |

---

## Open questions (max 5)

1. **Judging rubric:** No explicit judging criteria, deadline or submission requirements file found in the repo. Criteria in this review are derived from `MVP_SCOPE.md` / `CHALLENGE_PRODUCT_SCOPE.md` / `README.md` — confirm with the challenge organizers before finalizing the scorecard.
2. **Demo project:** Which Firebase project should the demo run against? Production writes and rule deploys are gated (`DEPLOYMENT.md`, `PROJECT_STATUS.md` known issue #6). A scratch project + emulator is the safe demo path.
3. **Business model pricing:** Subscription tiers and per-attributed-booking fee amounts are not yet defined — these feed the admin spec's entitlements and unit-economics sections.
4. **Payment provider:** Per the rules, no payment integration is to be built; "settled at the hotel" is the position. Confirm judges accept no payment flow in the demo.
5. **K Hotels brand scope:** The new brief says K Hotels is demo data only, but `README.md` line 264, `package.json` description and the seed script still center it. Confirm how much rebranding is expected before submission.

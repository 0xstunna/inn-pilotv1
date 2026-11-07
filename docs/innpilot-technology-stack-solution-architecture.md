# InnPilot — Technology Stack & Solution Architecture

Prepared: November 2026 | Context: K Hotels AI Innovation Challenge

---

## 1. Product Overview

InnPilot is an AI-powered booking concierge designed for hotels, guesthouses, lodges, resorts, and other accommodation providers. It solves two of the industry's most costly problems: **slow guest response times** and **lost booking opportunities**. Guests message in plain language, and the system checks the property's actual rooms, availability, and rates — then guides them to a confirmed reservation with a real booking reference, without guesswork.

For the K Hotels Innovation Challenge, InnPilot is focused on the **primary guest journey**:

1. Guest describes destination, dates, party size, and room needs in natural language.
2. Concierge finds eligible hotels, checks room inventory, date availability, and rates from live inventory.
3. Guest compares options with nightly and total-stay pricing.
4. Guest supplies booking details and explicitly confirms.
5. The system re-checks availability/pricing and creates a reservation with a real reference; staff see the reservation and conversation.

InnPilot complements existing hotel staff and systems — it does not replace the property management system or human service teams. Payments are settled at the hotel on arrival; no payment gateway is integrated in the MVP.

---

## 2. Technology Stack

The architecture is organised into the following components:

| Layer | Technology | Purpose |
|---|---|---|
| Guest communication | Web chat (`/#/` and `/#/c/:publicHotelId`) | Primary channel through which guests interact with the concierge — no login required |
| Conversational interface | React 19 + Vite + Tailwind CSS v4 (frontend); HashRouter | Guest-facing UI, mobile-first, conversation area, result cards, booking summary and confirmation cards |
| AI provider | Groq (default `openai/gpt-oss-120b`) or Google Gemini | Interprets guest messages, drives the tool-use loop, generates responses |
| API layer | Vercel serverless functions (`/api/ai/*`); local dev server (`server/dev-server.ts`) | Framework-free handlers for concierge, network, hotel, conversation, and health endpoints |
| Conversational AI engine | `server/ai/` — provider seam, prompts, tools | Tool loop, system instruction (12 rules + booking protocol), server-enquired booking safety |
| Concierge tools | `search_hotels`, `check_availability`, `get_hotel_info`, `calculate_stay_price`, `prepare_booking`, `create_reservation` | Live inventory, availability, pricing, booking preparation, reservation creation — none takes a `hotelId` from the guest/model |
| Data store | Firebase Firestore (emulator `:8080` locally) | Hotels, rooms, accommodations/bookings, conversations, public ID mappings |
| Admin SDK | `server/admin.ts` (lazy; emulator or service account / ADC) | Server-side writes: canonical conversations, reservations, audit entries |
| Auth / access | Workspace-id based; no guest or staff user accounts | `hotelId` is the workspace key; `conciergeConversations` and `publicHotels` are client-denied |
| Rules / security | `firestore.rules` | Workspace isolation, no enumeration, client-denied collections, server-write-only reservations, gated subscription field |

---

## 3. Proposed Solution Architecture

The architecture separates the guest-facing conversational experience from backend tool execution and property data.

### A. Guest communication and conversational layer

Guests open the concierge at `/#/` (network-wide) or `/#/c/:publicHotelId` (scoped to one hotel, via the link a hotel shares from Settings). No account is required. The conversation survives a reload within the same tab. The AI drives a bounded tool loop: search → (optionally) check availability → prepare booking → create reservation, with server-enforced re-checks and explicit guest confirmation before any write.

### B. Property knowledge and inventory layer

Each participating property maintains its own data:

- Property profile and public concierge configuration (region, country, description, amenities, check-in/out times, policies, `listed` flag, `publicId`)
- Room inventory: physical rooms with unique identifiers, room types, capacity, nightly rates, status (editable by staff in Accommodation)
- Rates: nightly rate × nights; rooms with no rate are never offered

Staff configure these via `/#/staff` → Settings → AI Concierge listing and Dashboard → Accommodation.

### C. Booking safety layer (server-enforced)

Every booking follows a strict protocol enforced on the server:

1. `prepare_booking` validates guest details (name + phone, optional email), re-checks availability and price, and writes nothing.
2. The guest sees a booking summary in an earlier turn.
3. `create_reservation` requires a matching summary from an earlier turn **plus** an explicit guest "yes".
4. A per-candidate transaction books the cheapest free room, re-reads availability, and refuses if the price changed or the room was taken since the summary.
5. The reservation is written with `source: "concierge"`, a real `RSV-…` reference, and an audit entry.

### D. Data and operational records

- `hotels/{hotelId}` — hotel profile and settings
- `hotels/{hotelId}/rooms` — physical room inventory
- `hotels/{hotelId}/accomodation` — bookings/reservations (legacy name preserved)
- `hotels/{hotelId}/conversations` — guest conversation mirrors (inbox)
- `conciergeConversations/{id}` — canonical server-only threads (client-denied)
- `publicHotels/{publicId}` → `{hotelId}` — public ID mapping (client-denied)

Metrics tracked: inquiry → confirmed-booking conversion, first response time, completed inquiries, availability-check success, booking completion rate, abandoned booking steps.

---

## 4. Challenge Focus: Booking Conversion

InnPilot's challenge objective is to turn a natural-language hotel inquiry into a **confirmed reservation**:

1. Guest sends a natural-language request (destination, dates, room type).
2. Concierge searches live inventory across `listed: true` hotels and returns 3–5 ranked options (hotel, location, room type, capacity, price/night, nights, total, availability, amenities).
3. Guest selects an option; AI asks for name and phone (one question; no home address).
4. AI re-checks availability and price and shows a booking summary.
5. Guest confirms explicitly; AI re-checks again inside the transaction and creates the reservation.
6. Guest receives a real `RSV-…` reference; payment is settled at the hotel on arrival.
7. Staff open the hotel workspace: the reservation appears in Accommodation and the conversation appears in the Inbox as Booked.

A staff member can take over any thread at any time; the AI then goes quiet and staff reply from the same inbox (AI→human handoff).

---

## 5. Reusable Product Architecture

InnPilot is built as a reusable hospitality product, not a single-hotel solution. The same architecture serves multiple properties, while each property keeps its own:

- Workspace identified by a 20-character `hotelId`
- Public concierge profile (`listed`, public link)
- Room inventory, rates, amenities, policies
- Region, country, and destination tags for destination-first matching
- Conversations and reservations scoped to its `hotelId` path

Onboarding additional properties is repeatable: staff create a workspace, add rooms and rates, configure the listing, and publish a shareable concierge link.

---

## 6. Future Technical Development

As the product develops, areas for exploration (not claims about existing functionality):

- Persistent tenant-level rate limiting and throttling (currently in-memory per instance)
- Persistent conversion rollup and attribution (`sourceConversationId` on bookings)
- Funnel dashboard: inquiries → quoted → booked → confirmed, reply time, after-hours
- Conversation attribution linking each booking to its source conversation
- Platform admin console: tenant management, metering, entitlements, unit economics (post-challenge business model)
- PII access log and retention policy
- Multilingual conversational support (confirmation and lead scoring are English-only today)
- Payment gateway integration (currently out of scope; "pay at hotel on arrival")

---

## 7. Technical and Product Principles

1. **Truth lives in Firestore/tools**: the model never guesses prices, rooms, or references; results come from tools.
2. **Booking safety**: re-check before summary, re-check inside the transaction, explicit confirmation, price must match.
3. **Server-side enforcement**: `conciergeConversations` client-denied; reservations server-write-only; no hotelId exposed to guest or model.
4. **Workspace isolation**: hotel data scoped by `hotelId` path; no enumeration of `/hotels`.
5. **Human accountability**: AI handles the booking flow, but staff can take over any thread and remain responsible for service delivery.
6. **No payment in MVP**: payments settled at the hotel; no deposit buttons or payment gateway.
7. **Data governance**: guest name/phone stored in bookings; no deletion policy (MVP); service account never exposed as `VITE_*`.

---

## 8. Development Objective

**Immediate (K Hotels Challenge):** Develop and validate a working AI booking concierge that demonstrates a natural-language inquiry becoming a confirmed reservation with real inventory, real pricing, and a real booking reference — measured by inquiry → confirmed-booking conversion.

**Longer-term:** Establish InnPilot as a reusable direct-booking and conversion-recovery product for accommodation providers, with operator metrics, funnel visibility, and platform-level metering/entitlements.

---

**Note:** This document describes the current architecture direction and implementation state of InnPilot. It should not be interpreted as confirmation that every component is fully deployed to production; production deployment and Firestore rules writes remain gated on explicit approval.

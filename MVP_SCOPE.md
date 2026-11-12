# InnPilot AI Concierge: MVP scope

_InnPilot is hotel-first: one hotel per conversation, no marketplace or cross-hotel search._

Progress against this file is tracked only in
[`PROJECT_STATUS.md`](PROJECT_STATUS.md).

## Product in one sentence

InnPilot is an AI booking concierge for one hotel at a time: it turns a
natural-language request into a confirmed reservation at that hotel.

## The problem it solves

**Slow guest response times** and **low conversion from inquiry to booking**.
A guest waits hours for a reply and books elsewhere. InnPilot answers
instantly, checks the hotel's live inventory, and books in the same
conversation — no marketplace, no routing guests between competitors.

**Core metric: inquiry → booking conversion.**

## The one job

> Turn a natural-language hotel inquiry into a confirmed reservation.

### The golden path (must work exactly)

1. Guest opens the hotel's concierge link (no login) and types *"I need a double room between 10th and 15th October."*
2. The AI extracts dates, room type (and guests if given), searches the hotel's live inventory, and shows available options: room type, capacity, price/night, nights, total, availability, amenities.
3. Guest: *"I'll take the first one."* The AI asks for name and phone.
4. The AI re-checks availability and price and shows a booking summary.
5. Guest: *"Confirm."* The AI re-checks again, creates the reservation in the real reservation system, and shows **Booking confirmed** with the real reference.
6. Staff open that hotel's InnPilot workspace: the reservation is in Accommodation and the conversation is in the Inbox as Booked.

## In scope

### Public experience (primary product)
- `/` — marketing landing page: what InnPilot does for one hotel, with a "Try the guest concierge" button linking to the hotel's own concierge link (`/#/c/:publicHotelId`).
- `/#/c/:publicHotelId` — the AI Concierge limited to one hotel (the link a hotel shares from Settings): headline, conversation area, suggested searches, result cards, booking summary card, confirmation card; mobile first.
- No guest account. Conversation survives a reload in the same tab.

### AI layer
- Gemini (server-only) with a dedicated concierge system instruction.
- Tools: `check_availability`, `get_hotel_info`, `calculate_stay_price`, `prepare_booking`, `create_reservation` — all scoped to one hotel.
- Minimal clarification: dates are essential; room type is asked for only when it genuinely blocks a useful search.
- Server-enforced booking safety: re-check before summary, re-check inside the
  booking transaction, summary shown in an earlier turn, explicit guest
  confirmation, price must match.

### Hotel data
- Participation flag and guest-facing profile per hotel: region, country,
  description, amenities, check-in/out times, policies. Room capacity.
- Editable by staff in Settings → AI Concierge listing.
- Demo seed for the emulator (and, only with explicit confirmation,
  a real project).

### Staff experience
- `/#/staff` entry: create a workspace or open one by its id.
- Existing PMS modules unchanged.
- Inbox: guest, conversation, last message, **selected hotel**, **status**
  (New / Active / Booked / Closed), lead (🔥 Hot / 🌤 Warm / ❄ Cold / ⭐ VIP),
  AI/Human. Take over, reply, hand back to AI, close.

## Out of scope (do not build)

Payment processing · OTA / channel manager integrations · loyalty · housekeeping ·
restaurant management changes · accounting · complex analytics · marketing
automation · native mobile apps · multilingual AI · advanced recommendation
algorithms · guest accounts · staff user accounts/roles · real WhatsApp /
Instagram / Email channels (the existing mocked sample threads stay as they are).
Marketplace, cross-hotel search, hotel directory, or OTA-style discovery/comparison.

## Present but not a deliverable

- Existing PMS modules (Restaurant, Bar, Parking, Expenses, Reports) — kept
  working, not extended.
- Electron desktop shell.
- Deploying to Vercel, deploying `firestore.rules`, and writing to the
  production Firebase project — each **gated** on explicit approval.

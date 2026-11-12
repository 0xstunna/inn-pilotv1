# PRODUCT.md (InnPilot)

## Product in one line

InnPilot is an AI booking concierge for one hotel at a time.

## Scope

- One hotel per conversation; every guest thread is scoped to exactly one
  hotel (`hotels/{hotelId}`).
- AI concierge that checks live room inventory, availability and rates, then
  guides a guest to a confirmed reservation with a real `RSV-…` reference.
- Staff workspace: Accommodation, Reservations, Inbox, Settings.
- Booking safety: re-check before summary, re-check inside the transaction,
  explicit guest confirmation, price must match.
- Payments settled at the hotel on arrival; no payment gateway.
- No user accounts; the workspace id is the key.

## Non-goals

- Does not compete with OTAs.
- Does not route guests between hotels.
- No marketplace, cross-hotel search, or OTA-style discovery/comparison.
- No network directory of participating properties.
- No payment processing, OTA/channel-manager integrations, loyalty,
  housekeeping, restaurant changes, accounting, complex analytics,
  marketing automation, native mobile apps, multilingual AI, advanced
  recommendation algorithms, guest accounts, or staff accounts/roles.

## The hotel's core problems (what we exist to fix)

1. Guests wait too long for answers, so they book elsewhere.
2. Inquiries don't turn into bookings.
3. Staff are buried in repetitive questions and have no visibility of
   what was asked, what was promised, or what was lost.
4. Guest requests and complaints get lost in conversations.

## Source

Embodies DECISIONS.md D32 ("Hotel-first, no network"), which supersedes
D23, D24, D25 and D29.

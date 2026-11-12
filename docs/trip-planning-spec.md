# InnPilot — Trip Planning Spec (multi-leg & arrival-night recommendations)

Status: **LATER — pitch / roadmap only. Not part of the challenge MVP.**

## Criteria read

Challenge success metric: **inquiry → confirmed-booking conversion for a single stay**. `MVP_SCOPE.md` golden path is one natural-language inquiry → one confirmed reservation (single room type, single hotel selection, one real `RSV-…` reference). `MVP_SCOPE.md` lists "advanced recommendation algorithms" out of scope. No existing tool supports multiple legs or recommendations — the five tools (`check_availability`, `get_hotel_info`, `calculate_stay_price`, `prepare_booking`, `create_reservation`) all serve a single stay at one hotel, and none takes a `hotelId` or multiple legs.

## MVP (what exists today — do not extend)

- Single destination, dates, party size, room type → available options at one hotel (hotel search; no cross-hotel comparison).
- One booking per conversation: re-check availability + price, explicit confirmation, real `RSV-…` reference, staff see it in Accommodation + Inbox.
- Two entry points only: `/` landing page and per-hotel scoped `/#/c/:publicHotelId`.

## LATER (pitch only)

- **Multi-leg trip planning** — multiple destinations/dates in one conversation.
- **Arrival-night recommendations** — restaurants, transfers, activities near the booked hotel.

If the challenge criteria ever reward trip planning, revisit; until then it stays out of scope and is documented on this page only.

**Effort:** L (new tools, new conversation state, new UX). **No implementation in this repo.**

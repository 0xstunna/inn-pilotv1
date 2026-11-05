# InnPilot — Challenge Product Scope

## Product promise
InnPilot is an AI booking concierge for participating hotels. It helps guests discover suitable accommodation, compare room types and prices, check date-specific availability, and complete a reservation with clear confirmation. Hotel staff manage room inventory, inquiries and reservations.

## Primary guest journey
1. Guest describes destination/property, dates, party size and room needs.
2. Concierge finds eligible hotels and checks room inventory, date availability and rates.
3. Guest compares options with nightly and total-stay pricing.
4. Guest supplies booking details and explicitly confirms.
5. The system rechecks availability/pricing and creates a reservation reference; staff can see the reservation and conversation.

## Staff MVP
- Accommodation: register actual room names/numbers, room types, nightly rates and status.
- Reservations: review stays and booking status.
- Inbox: review guest conversations and handoffs.
- Settings: hotel profile and public concierge configuration.

## Out of scope for the challenge MVP
Restaurant POS, bar sales/stock, parking operations, expense tracking and broad department-finance reporting are not part of the primary navigation or challenge journey. Legacy code/data is retained for safer migration, but legacy URLs redirect to Accommodation.

## Room inventory quality rule
A room count is not inventory. Before publishing a live hotel listing, staff should verify every room identifier, room type, capacity, price and operational status. Starter inventory and sample rates must not be represented as verified hotel facts. Never claim availability unless the booking service confirms it for the requested dates.

## Challenge success metric
Measure inquiry-to-confirmed-booking conversion. Supporting metrics: first response time, completed inquiries, availability-check success, booking completion rate, and abandoned booking steps.

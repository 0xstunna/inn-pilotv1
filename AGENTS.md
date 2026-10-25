# AGENTS.md (InnPilot)

## Repo shape
- Vite + React 19 + TS; HashRouter. `src/` app, `api/ai/*` Vercel functions, `server/` AI/network/Admin, `tests/` (rules/unit/server).
- Firebase: Firestore (emulator :8080), rules in `firestore.rules`/`storage.rules`. Admin SDK in `server/admin.ts` (lazy; uses emulator if `FIRESTORE_EMULATOR_HOST`, else `FIREBASE_SERVICE_ACCOUNT` JSON/base64, else ADC). Service account must never be `VITE_*`.
- AI Concierge is the product: guest routes `/#/` and `/#/c/:publicHotelId`; staff `/#/staff` opens workspace by id (stored in `localStorage["innpilot_hotel"]`). PMS modules exist but legacy restaurant/bar/parking/expenses/dept reports redirect to Accommodation (challenge MVP focus).
- Two networks: guest writes go only via `/api/ai/*` (server-only secrets); staff use Firestore client + `firestore.rules` with workspace key.

## Commands (exact)
```bash
npm install
cp .env.example .env  # set GROQ_API_KEY (or AI_PROVIDER/gemini)

# Local dev (emulator)
npx firebase emulators:start --only firestore  # needs Java
npm run seed:k-hotels -- --reset               # 5 demo K Hotels (emulator only)
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=innpilot-demo npm run dev:api
VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 VITE_FIREBASE_PROJECT_ID=innpilot-demo npm run dev
```
- Tests: `npm run test:rules` (emulator), `npm run test:unit` (no emulator), `npm run test:server` (emulator :8080), `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run` (all), `npm run test:all` (starts emulator). `vitest.config.ts` includes `tests/**/*.test.ts`.
- Checks: `npm run lint && npm run build` (tsc -b + vite). `npm run verify:release` (no secrets in bundle). `npm run verify:vercel` (esbuild bundles api/* as Vercel would + serve). `node scripts/verify/golden-path-ui.mjs` (browser E2E).
- Desktop: `npm run electron`, `npm run desktop` (build + electron). Vite base `./` for Electron.

## Architecture gotchas (critical)
- **Truth lives in Firestore/tools**: model never guesses prices/rooms/refs; results come from tools. Booking requires (1) summary from earlier turn (`pendingBooking`) + (2) explicit confirmation (`src/lib/confirmation.ts`); enforced server-side in `create_reservation`.
- **Network model**: hotels opt in via `listed: true` + `publicId`. Tools take `hotel` (public id) resolved by `server/network.ts` (network = all listed, or scoped `/c/:publicHotelId`). Tools: `search_hotels`, `check_availability`, `get_hotel_info`, `calculate_stay_price`, `prepare_booking`, `create_reservation` (no hotelId). `get_room_rates` retired.
- **Booking**: by room type; server picks cheapest free room in a per-candidate transaction (`server/ai/tools/createReservation.ts`), re-reads availability, never books at unconfirmed price. Writes `accomodation` with `source:"concierge"`, creates `RSV-…`, audit entry. Two collections affect availability: `accomodation` and `reservations`.
- **Canonical threads**: `conciergeConversations/{id}` server-only (client-denied). Mirrored to each attached hotel's `hotels/{hotelId}/conversations/{id}` with `selection/bookedElsewhere/closed`; inbox derived status. If any attached mirror is `handledBy:"human"`, gateway makes **no model call** and merges staff replies via `GET /api/ai/conversation` (polls 5s while human, 15s otherwise).
- **Public ids**: `publicHotels/{publicId} -> { hotelId }` client-denied; `hotels/{hotelId}.publicId` set once. `resolveHotel()` accepts public id only.
- **Shared domain**: `src/lib/booking.ts` (overlap/bookability), `conversations.ts`, `leadScoring.ts`, `followUps.ts`, `hotelListing.ts`, `publicHotel.ts` used by app+server.

## AI provider (Groq default)
- `AI_PROVIDER=groq` (default) or `gemini`. `server/ai/provider.ts` selects; both same contract.
- Groq: `GROQ_MODEL` default `openai/gpt-oss-120b` (tool-capable). **`groq/compound*` refused as config error** (no custom tools). SDK retries off; max 1 retry only for 5xx/dropped/`tool_use_failed` or 429 with `retry-after` ≤10s and fits deadline. Malformed tool args/empty replies fail before tools. `GET /api/ai/health` returns only `{status,provider,configured}` (no model/latency).
- Free plan limits matter: ~5K input tokens/tool turn, ~7 requests/full booking, ~40s/turn across guests; quota hits return guest-safe messages.
- Hotel resolution by public id **or exact unique name** among reachable hotels (to avoid re-searches blowing TPM).
- Dev API: `npm run dev:api` runs `server/dev-server.ts` (proxies `/api` like Vercel). Handlers are framework-free.

## Testing/verification quirks
- Rules tests use `@firebase/rules-unit-testing` against emulator (unauthenticated like app). Each `it()` should assert one allow/deny.
- Server tests use real Admin SDK against emulator; concierge tests script model responses (no real keys needed). Unit tests no emulator.
- `tsconfig.json` is solution file (references app/node/server). `tsconfig.server.json` includes `api`, `server`, `scripts/verify`, `scripts/seed` and requires **relative imports end in `.js`** (ESM). `npm run verify:vercel` catches missing extensions.
- Vite splits chunks (react/firebase/charts/motion/icons); `chunkSizeWarningLimit` 700. Watch ignores `release/**`, `dist-electron/**`.
- `vercel.json`: functions under `api/**/*.ts` maxDuration 30s, security headers, immutable cache for assets.

## Env notes
- `VITE_*` bundled to browser (public). Secrets: `GROQ_API_KEY`/`GEMINI_API_KEY`, `FIREBASE_SERVICE_ACCOUNT` (or ADC), never `VITE_*`. `FIRESTORE_EMULATOR_HOST` used locally.
- `.env.example` documents all vars. `firestore.rules`/`storage.rules` deployed separately (gated). 
- Demo seed refuses real project unless `--confirm-real-project=<id>` and marks hotels `demo: true`.

## Quick pointers
- Concierge flow: `api/ai/concierge.ts` → `server/ai/groq.ts`/`gemini.ts` → `server/ai/tools/*` → `server/network.ts`/`hotels.ts` → Firestore Admin. Shared rules in `src/lib/`.
- Inbox/handoff: `server/guestConversations.ts`, `server/conversations.ts`, `src/pages/inbox/`, `api/ai/conversation.ts`.
- Settings: AI Concierge listing toggles `listed`, sets region/country/amenities/times/policies/publicId.
- Legacy paths redirect to Accommodation; focus on concierge + accommodation/reservations/inbox.

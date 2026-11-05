# InnPilot — The AI Booking Concierge Built for Hospitality

**Turn every guest inquiry into a confirmed booking — without the delay.**

InnPilot is an AI-powered booking concierge designed for hotels, guesthouses, lodges, resorts, and other hospitality businesses. It solves two of the industry's most costly problems: **slow response times** and **lost booking opportunities**. By combining conversational AI with your live inventory, InnPilot captures, qualifies, and books guests in real-time — even outside front desk hours.

## The Problem

- **Slow responses kill bookings.** Most guests won't wait hours for a quote. If you don't reply quickly, they book elsewhere.
- **Lost opportunities add up.** Missed DMs, after-hours inquiries, and back-and-forth over availability mean revenue that never makes it to your property.

## The Solution

InnPilot acts as your always-on booking agent. Guests chat naturally, and the system checks **your actual rooms, availability, and rates** to give real answers — then guides them to a confirmed reservation without guesswork.

## How It Works

1. **Always-on intake** – Guests message in plain language anytime, day or night.
2. **Live inventory check** – Every search pulls from your real rooms and existing bookings to show only what's actually free.
3. **Transparent quotes** – Prices are calculated from your configured rates with no made-up figures.
4. **Guided booking** – The concierge collects only what's needed and confirms before booking.
5. **Instant confirmation** – A real reservation is created with a unique reference the moment a guest confirms.

The AI provides the conversation. **InnPilot enforces the truth** — rooms, rates, availability, and booking references all come from your property data.

## Built For The Entire Hospitality Sector

InnPilot works for any accommodation provider, including:

- **Hotels & boutique hotels** – Manage inventory across room types with ease
- **Guesthouses & B&Bs** – Simple setup, professional booking flow
- **Lodges & safari camps** – Handle inquiries from anywhere, in any currency
- **Resorts & aparthotels** – Scale as you grow with a flexible room model
- **Hostels & multi-room properties** – Keep availability accurate across all rooms

## Key Benefits

### For Your Property
- **Capture more bookings** – Respond instantly to inquiries 24/7
- **Recover after-hours revenue** – Turn night-time messages into confirmed stays
- **Cut response time to seconds** – No more manual availability checks
- **Prevent double-bookings** – Atomic transactions lock rooms at booking time
- **Stay in control** – Hand off to your team in the inbox anytime with AI-to-human handoff
- **Own your listing** – Share your own concierge link and control when you're listed

### For Your Guests
- **Book in one conversation** – No forms, no waiting for quotes
- **See real availability & pricing** – Total stay costs upfront, in your property's currency
- **Instant confirmation** – Get a booking reference right away
- **Local, relevant recommendations** – Find the right fit based on their needs

## Powerful Property Tools

- **Room inventory** – Add physical rooms with numbers/names and assign to room types
- **Pricing & currency** – Set rates per room in UGX, KES, TZS, RWF, USD, EUR, GBP and more
- **Amenities & policies** – Showcase what sets your property apart
- **Public concierge profile** – Publish a shareable link to drive direct bookings
- **Unified inbox** – Track every guest conversation with status, handoffs, and follow-ups
- **Reservation management** – View, manage, and track all bookings in one place
- **AI Concierge controls** – Toggle listing visibility on your terms

## Architecture

### Tech Stack
- **Frontend**: React 19 + TypeScript + Vite
- **Routing**: React Router DOM (HashRouter for Electron compatibility)
- **Styling**: Tailwind CSS v4
- **Backend**: Vercel Functions (Node.js/TypeScript) + local dev server
- **Database**: Firebase Firestore
- **Authentication**: Workspace-based (no user accounts) with hotel/property ID as key
- **AI**: Groq (default) / Google Gemini
- **Desktop**: Electron support

### Directory Structure
```
├── api/ai/          # Vercel serverless functions (concierge, health, etc.)
├── server/          # Server-side logic, AI tools, admin SDK
│   ├── ai/          # AI provider, prompts, tools
│   └── ...          # Network, properties, conversations
├── src/             # React frontend
│   ├── pages/       # Page components (concierge, dashboard, etc.)
│   ├── lib/         # Shared utilities, services, types
│   ├── components/  # UI components
│   └── ...
├── tests/           # Tests (unit, server, rules)
├── scripts/         # Seed scripts, verification tools
└── firestore.rules  # Security rules
```

### Key Concepts
- **Workspace**: Each hotel has a workspace identified by a 20-char hotel ID
- **Public Hotel ID**: Guest-facing identifier for concierge links
- **Rooms**: Physical rooms with unique identifiers within a property
- **Accommodations/Bookings**: Reservations stored in `hotels/{hotelId}/accomodation`
- **Concierge Conversations**: Server-managed guest threads
- **Network**: Collection of listed hotels available for search

## Setup and Environment

### Prerequisites
- **Node.js**: >= 20
- **Java**: Required for Firestore emulator (local development)
- **Firebase CLI**: For emulators and deployment

### Installation
```bash
npm install
```

### Environment Variables
Copy `.env.example` to `.env` and configure:

**Required:**
- `GROQ_API_KEY` or `GEMINI_API_KEY` - AI provider API key
- `AI_PROVIDER` - `groq` (default) or `gemini`

**For local development with emulator:**
- `FIRESTORE_EMULATOR_HOST` - `127.0.0.1:8080`
- `FIREBASE_PROJECT_ID` - Your Firebase project ID

**For production:**
- `FIREBASE_SERVICE_ACCOUNT` - Firebase Admin SDK credentials (JSON or base64)

See `.env.example` for all available options. **Never commit secrets** - use `VITE_*` prefix only for non-sensitive values.

### Firebase Configuration
1. Create a Firebase project
2. Enable Firestore
3. Deploy security rules: `firebase deploy --only firestore:rules`
4. For local development, use the Firestore emulator

### Running Locally

**With Firestore emulator (recommended):**
```bash
# Terminal 1: Start Firestore emulator
npx firebase emulators:start --only firestore

# Terminal 2: Seed demo data (optional)
npm run seed:k-hotels -- --reset

# Terminal 3: Start API server
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_PROJECT_ID=innpilot-demo npm run dev:api

# Terminal 4: Start frontend
VITE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 VITE_FIREBASE_PROJECT_ID=innpilot-demo npm run dev
```

Access:
- **Guest Concierge**: http://localhost:5173/#/
- **Staff Portal**: http://localhost:5173/#/staff

### Testing
```bash
# Unit tests (no emulator needed)
npm run test:unit

# Rules tests (emulator required)
npm run test:rules

# Server tests (emulator required)
npm run test:server

# All tests with emulator
npm run test:all

# Or run all with emulator manually
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx vitest run
```

### Building
```bash
# Production build
npm run build

# Verify build
npm run verify:release
npm run verify:vercel

# Desktop app
npm run desktop
```

### Seeding Data
- **Demo data (emulator only)**: `npm run seed:emulator` or `npm run seed:k-hotels -- --reset`
- **Live data**: Requires explicit authorization with `--confirm-real-project=<id>` flag

## Data Model & Security

### Key Collections
- `hotels/{hotelId}` - Hotel profile and settings
- `hotels/{hotelId}/rooms` - Physical room inventory
- `hotels/{hotelId}/accomodation` - Bookings/reservations (legacy name preserved)
- `hotels/{hotelId}/conversations` - Guest conversations for inbox
- `publicHotels/{publicId}` - Public ID mapping (client-inaccessible)
- `conciergeConversations` - Server-managed canonical threads (client-inaccessible)

### Security Principles
- **Workspace isolation**: Hotel data scoped by hotelId path
- **No enumeration**: Cannot list all hotels or workspaces
- **Guest privacy**: Guests cannot access other guests' reservation details
- **Server-side pricing**: Client cannot override prices
- **Atomic bookings**: Transaction-based booking prevents conflicts
- **Test isolation**: Demo data clearly marked and isolated from production

## Challenge Demonstration

Follow this script to demonstrate the full workflow:

1. **Configure a hotel**
   - Go to Staff Portal → Create/Open workspace
   - Complete setup wizard with hotel details
   - Go to Settings → Configure property details, facilities, and AI Concierge listing

2. **Add rooms and inventory**
   - Go to Dashboard → Accommodation → Add Room
   - Add physical rooms with unique identifiers (e.g., "101", "102")
   - Assign room types, set capacity, configure rates and amenities
   - Set room status as needed

3. **Configure rates and amenities**
   - Set standard nightly rates per room
   - Mark property-wide facilities (pool, gym, parking, etc.)
   - Mark room-specific amenities
   - Configure check-in/check-out times and policies

4. **Start a guest inquiry**
   - Open Guest Concierge at `/#/`
   - Describe travel needs in natural language (e.g., "I need a double room for 2 adults from Oct 10-15 in Western Uganda")

5. **Search and compare**
   - AI searches actual availability
   - Review results with real prices, amenities, and capacity
   - Compare options across properties

6. **Complete booking**
   - Select preferred option
   - Provide guest details (name, contact)
   - Review booking summary
   - Confirm explicitly
   - Receive booking reference

7. **Verify persistence**
   - Check Staff Dashboard → Accommodation for the reservation
   - Check Inbox for the conversation
   - Verify all details are correct

## Metrics & Limitations

### Tracked Metrics
- **Inquiry-to-confirmed-booking conversion**: Tracked via booking events
- First response time, completed inquiries, availability checks, booking completion rate
- Abandoned booking step tracking

### Current Limitations
- **Multi-room bookings**: Full support depends on existing model capabilities
- **Seasonal pricing**: Advanced date-specific pricing may need enhancement
- **Payment processing**: No direct payment gateway integration (payments arranged with hotel)
- **User accounts**: Workspace-based access only (no individual user accounts)
- **Some legacy modules**: Restaurant, bar, parking, expenses redirected to Accommodation in MVP

## License

Built by Masai Labs for the K Hotels AI Innovation Challenge.

# InnPilot — AI-Powered Accommodation Discovery & Booking Concierge

InnPilot is an AI-powered accommodation discovery and booking concierge that helps guests find suitable hotel rooms, compare actual availability and prices, and complete reservations. It addresses slow guest response times and lost booking opportunities by enabling real-time conversation-driven booking with direct integration to hotel inventory.

## Product Overview

InnPilot connects guests with participating hotels through an intelligent AI concierge. Guests describe their travel needs in natural language, and the system:

1. **Understands requirements** - Extracts destination, dates, party size, room preferences
2. **Finds suitable options** - Searches actual hotel inventory for available rooms
3. **Compares transparently** - Shows real prices, amenities, and availability
4. **Guides booking** - Collects only necessary details and confirms before booking
5. **Creates real reservations** - Persists bookings with unique references

The AI provides intelligence while InnPilot provides truth - hotels, rooms, availability, prices, and booking references all come from trusted database sources, never from model inference.

## Core Capabilities

### For Guests
- **Natural conversation** - Describe travel needs in plain language
- **Smart search** - Find accommodation by destination, dates, guests, and preferences
- **Real-time availability** - Only see rooms actually available for requested dates
- **Transparent pricing** - Clear nightly rates and total stay costs with currency
- **Guided booking** - Progressive information collection, only what's needed
- **Instant confirmation** - Get real booking references after successful reservation
- **Multiple room support** - Can handle requests for multiple rooms where supported

### For Hotel Staff
- **Property configuration** - Set hotel details, location, contact info, policies, amenities
- **Room inventory management** - Add physical rooms with unique identifiers (e.g., "101", "Garden Room")
- **Room categories** - Define room types and assign physical rooms to categories
- **Dynamic pricing** - Configure standard nightly rates per room
- **Amenities management** - Distinguish property-wide facilities from room-specific amenities
- **Reservation management** - View and manage bookings from the concierge and front desk
- **Guest inquiries** - Monitor conversations in the inbox with AI handoff capability
- **AI Concierge listing** - Control visibility in network search and configure public profile

### Technical Features
- **Firestore persistence** - All data stored securely in Firestore
- **AI integration** - Supports Groq (default) and Google Gemini providers
- **Security rules** - Granular access control protecting guest data
- **Transaction safety** - Atomic booking creation prevents double-booking
- **Audit trails** - Track important actions
- **Multi-currency support** - UGX, KES, TZS, RWF, USD, EUR, GBP

*Planned capabilities:* Advanced seasonal pricing, paid extras management, multi-property chains

## Architecture

### Tech Stack
- **Frontend**: React 19 + TypeScript + Vite
- **Routing**: React Router DOM (HashRouter for Electron compatibility)
- **Styling**: Tailwind CSS v4
- **Backend**: Vercel Functions (Node.js/TypeScript) + local dev server
- **Database**: Firebase Firestore
- **Authentication**: Workspace-based (no user accounts) with hotel ID as key
- **AI**: Groq SDK / Google Generative AI
- **Desktop**: Electron support

### Directory Structure
```
├── api/ai/          # Vercel serverless functions (concierge, health, etc.)
├── server/          # Server-side logic, AI tools, admin SDK
│   ├── ai/          # AI provider, prompts, tools
│   └── ...          # Network, hotels, conversations
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

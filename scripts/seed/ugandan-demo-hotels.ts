/**
 * Seeds realistic demo hotels across 5 Ugandan cities for the AI Concierge network.
 *
 * Cities: Kampala, Mbarara, Jinja, Entebbe, Fort Portal
 * Creates 12 fictional hotels (distributed across all cities) with rooms,
 * public listings, and demo markers. Compatible with the existing concierge
 * booking flow.
 *
 * Local emulator (the default; refuses anything else):
 *
 *   npx firebase emulators:start --only firestore
 *   npm run seed:ugandan-demo                        # project innpilot-demo
 *   npm run seed:ugandan-demo -- --reset             # clear the emulator project first
 *
 * A real Firebase project — only on purpose, never by accident:
 *
 *   FIREBASE_SERVICE_ACCOUNT=… npm run seed:ugandan-demo -- --confirm-real-project=<projectId>
 */
import { config } from "dotenv";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
const realProject = flag("confirm-real-project")?.split("=")[1]?.trim() ?? "";
const reset = Boolean(flag("reset"));

if (realProject) {
  config();
  delete process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIREBASE_PROJECT_ID = realProject;
} else {
  process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST)) {
    console.error(`Refusing to run: FIRESTORE_EMULATOR_HOST is '${process.env.FIRESTORE_EMULATOR_HOST}', not a local emulator.`);
    process.exit(2);
  }
  process.env.FIREBASE_PROJECT_ID ||= "innpilot-demo";
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
}

const { readFileSync } = await import("node:fs");
const { FieldValue } = await import("firebase-admin/firestore");
const { adminDb } = await import("../../server/admin.js");
const { buildBookingDoc, makeReservationId } = await import("../../src/lib/booking.js");
const { PUBLIC_HOTELS_COLLECTION } = await import("../../src/lib/publicHotel.js");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST;

type RoomSeed = { number: string; type: string; price: number; capacity: number; status?: string; amenities?: string[]; images?: string[] };
type StaySeed = { roomNumber: string; guestName: string; checkIn: string; checkOut: string };
interface HotelSeed {
  emulatorId: string;
  publicId: string;
  name: string;
  city: string;
  region: string;
  country: string;
  description: string;
  phone: string;
  email: string;
  address: string;
  amenities: string[];
  propertyAmenities?: string[];
  photos?: string[];
  checkInTime: string;
  checkOutTime: string;
  policies: string;
  rooms: RoomSeed[];
  stays: StaySeed[];
}

const POLICIES =
  "Payment is settled at the hotel on arrival (cash, mobile money or card). Free cancellation up to 48 hours before " +
  "check-in. Children under 5 stay free in their parents' room. Smoking is prohibited in all indoor areas.";

const HOTEL_PHOTO = "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&q=80&auto=format";
const ROOM_PHOTO = "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=800&q=80&auto=format";

const HOTELS: HotelSeed[] = [
  // Kampala (3 hotels)
  {
    emulatorId: "UgDemoKampala000001",
    publicId: "skyline-plaza-kampala-ug26demo",
    name: "Skyline Plaza Hotel",
    city: "Kampala",
    region: "Central",
    country: "Uganda",
    description: "Modern business hotel in the heart of Kampala's Central Business District with panoramic city views.",
    phone: "+256 700 200 101",
    email: "reservations@skylineplaza.ug",
    address: "Plot 12, Kampala Road, Kampala",
    amenities: ["Free Wi-Fi", "Breakfast included", "Gym", "Paid parking", "Restaurant & bar", "Conference rooms"],
    propertyAmenities: ["Rooftop terrace", "24-hour front desk", "Airport transfer"],
    photos: [HOTEL_PHOTO],
    checkInTime: "14:00",
    checkOutTime: "11:00",
    policies: POLICIES,
    rooms: [
      { number: "501", type: "Single", price: 165_000, capacity: 1, images: [ROOM_PHOTO] },
      { number: "502", type: "Double", price: 245_000, capacity: 2, amenities: ["Queen bed"], images: [ROOM_PHOTO] },
      { number: "503", type: "Double", price: 245_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "601", type: "Deluxe Room", price: 320_000, capacity: 2, amenities: ["King bed", "City view"], images: [ROOM_PHOTO] },
      { number: "701", type: "Suite", price: 450_000, capacity: 2, amenities: ["King bed", "Living room", "City view"], images: [ROOM_PHOTO] },
      { number: "801", type: "Family Room", price: 380_000, capacity: 4, amenities: ["Two queen beds"], images: [ROOM_PHOTO] },
    ],
    stays: [],
  },
  {
    emulatorId: "UgDemoKampala000002",
    publicId: "pearl-gardens-kampala-ug26demo",
    name: "Pearl Gardens Boutique Hotel",
    city: "Kampala",
    region: "Central",
    country: "Uganda",
    description: "Tranquil boutique hotel nestled in Kololo with lush gardens and personalized service.",
    phone: "+256 700 200 102",
    email: "stay@pearlgardens.ug",
    address: "Kololo Hill Drive, Kampala",
    amenities: ["Free Wi-Fi", "Breakfast included", "Garden", "Free parking", "Restaurant"],
    propertyAmenities: ["Outdoor pool", "Spa", "24-hour security"],
    photos: [HOTEL_PHOTO],
    checkInTime: "14:00",
    checkOutTime: "11:00",
    policies: POLICIES,
    rooms: [
      { number: "101", type: "Double", price: 220_000, capacity: 2, amenities: ["Queen bed", "Garden view"], images: [ROOM_PHOTO] },
      { number: "102", type: "Double", price: 220_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "201", type: "Deluxe Room", price: 290_000, capacity: 2, amenities: ["King bed", "Garden view"], images: [ROOM_PHOTO] },
      { number: "301", type: "Suite", price: 420_000, capacity: 3, amenities: ["King bed", "Sitting room", "Garden view"], images: [ROOM_PHOTO] },
    ],
    stays: [{ roomNumber: "102", guestName: "Demo Guest — Kampala", checkIn: "2026-10-12", checkOut: "2026-10-15" }],
  },
  {
    emulatorId: "UgDemoKampala000003",
    publicId: "nile-corner-kampala-ug26demo",
    name: "Nile Corner Hotel",
    city: "Kampala",
    region: "Central",
    country: "Uganda",
    description: "Affordable comfort hotel near Makerere with easy access to the city center.",
    phone: "+256 700 200 103",
    email: "info@nilecorner.ug",
    address: "Wandegeya, Kampala",
    amenities: ["Free Wi-Fi", "Breakfast included", "Free parking"],
    propertyAmenities: ["Laundry service", "24-hour front desk"],
    photos: [HOTEL_PHOTO],
    checkInTime: "13:00",
    checkOutTime: "10:00",
    policies: POLICIES,
    rooms: [
      { number: "1", type: "Single", price: 95_000, capacity: 1, images: [ROOM_PHOTO] },
      { number: "2", type: "Single", price: 95_000, capacity: 1, images: [ROOM_PHOTO] },
      { number: "3", type: "Double", price: 145_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "4", type: "Double", price: 145_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "5", type: "Family Room", price: 210_000, capacity: 4, images: [ROOM_PHOTO] },
    ],
    stays: [],
  },
  // Entebbe (3 hotels)
  {
    emulatorId: "UgDemoEntebbe000001",
    publicId: "lake-vista-entebbe-ug26demo",
    name: "Lake Vista Resort",
    city: "Entebbe",
    region: "Central",
    country: "Uganda",
    description: "Lakeside resort overlooking Lake Victoria, close to Entebbe International Airport.",
    phone: "+256 700 300 101",
    email: "reservations@lakevista.ug",
    address: "Airport Road, Entebbe",
    amenities: ["Free Wi-Fi", "Breakfast included", "Swimming pool", "Free parking", "Restaurant & bar"],
    propertyAmenities: ["Lake view", "Airport shuttle", "Boat rides", "Conference facilities"],
    photos: [HOTEL_PHOTO],
    checkInTime: "14:00",
    checkOutTime: "11:00",
    policies: POLICIES,
    rooms: [
      { number: "101", type: "Double", price: 280_000, capacity: 2, amenities: ["Queen bed", "Lake view"], images: [ROOM_PHOTO] },
      { number: "102", type: "Double", price: 280_000, capacity: 2, amenities: ["Queen bed", "Lake view"], images: [ROOM_PHOTO] },
      { number: "201", type: "Deluxe Room", price: 340_000, capacity: 2, amenities: ["King bed", "Lake view"], images: [ROOM_PHOTO] },
      { number: "301", type: "Suite", price: 520_000, capacity: 2, amenities: ["King bed", "Balcony", "Lake view"], images: [ROOM_PHOTO] },
      { number: "401", type: "Family Room", price: 450_000, capacity: 4, amenities: ["Two queen beds", "Lake view"], images: [ROOM_PHOTO] },
    ],
    stays: [{ roomNumber: "101", guestName: "Demo Guest — Entebbe", checkIn: "2026-10-10", checkOut: "2026-10-12" }],
  },
  {
    emulatorId: "UgDemoEntebbe000002",
    publicId: "airport-inn-entebbe-ug26demo",
    name: "Airport Inn Entebbe",
    city: "Entebbe",
    region: "Central",
    country: "Uganda",
    description: "Convenient hotel just minutes from Entebbe International Airport, ideal for layovers.",
    phone: "+256 700 300 102",
    email: "stay@airportinn.ug",
    address: "Entebbe Road, Entebbe",
    amenities: ["Free Wi-Fi", "Breakfast included", "Free parking", "Airport shuttle"],
    propertyAmenities: ["24-hour front desk", "Laundry service"],
    photos: [HOTEL_PHOTO],
    checkInTime: "12:00",
    checkOutTime: "10:00",
    policies: POLICIES,
    rooms: [
      { number: "A1", type: "Single", price: 130_000, capacity: 1, images: [ROOM_PHOTO] },
      { number: "A2", type: "Double", price: 175_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "A3", type: "Double", price: 175_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "B1", type: "Twin", price: 175_000, capacity: 2, amenities: ["Two single beds"], images: [ROOM_PHOTO] },
    ],
    stays: [],
  },
  {
    emulatorId: "UgDemoEntebbe000003",
    publicId: "botanical-gardens-lodge-entebbe-ug26demo",
    name: "Botanical Gardens Lodge",
    city: "Entebbe",
    region: "Central",
    country: "Uganda",
    description: "Charming lodge near the Entebbe Botanical Gardens with colonial charm and modern comforts.",
    phone: "+256 700 300 103",
    email: "info@botanicallodge.ug",
    address: "Botanical Gardens Road, Entebbe",
    amenities: ["Free Wi-Fi", "Breakfast included", "Garden", "Free parking"],
    propertyAmenities: ["Nature walks", "Bird watching"],
    photos: [HOTEL_PHOTO],
    checkInTime: "14:00",
    checkOutTime: "10:00",
    policies: POLICIES,
    rooms: [
      { number: "C1", type: "Double", price: 200_000, capacity: 2, amenities: ["Queen bed", "Garden view"], images: [ROOM_PHOTO] },
      { number: "C2", type: "Double", price: 200_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "C3", type: "Family Room", price: 290_000, capacity: 4, amenities: ["Two queen beds"], images: [ROOM_PHOTO] },
    ],
    stays: [],
  },
  // Jinja (2 hotels)
  {
    emulatorId: "UgDemoJinja00000001",
    publicId: "source-of-nile-hotel-jinja-ug26demo",
    name: "Source of the Nile Hotel",
    city: "Jinja",
    region: "Eastern",
    country: "Uganda",
    description: "Riverside hotel in Jinja near the source of the Nile with adventure activities nearby.",
    phone: "+256 700 400 101",
    email: "reservations@sourceofnile.ug",
    address: "Nile Avenue, Jinja",
    amenities: ["Free Wi-Fi", "Breakfast included", "River view terrace", "Free parking", "Restaurant & bar"],
    propertyAmenities: ["White water rafting booking", "Boat cruises"],
    photos: [HOTEL_PHOTO],
    checkInTime: "14:00",
    checkOutTime: "10:00",
    policies: POLICIES,
    rooms: [
      { number: "1", type: "Double", price: 210_000, capacity: 2, amenities: ["Queen bed", "River view"], images: [ROOM_PHOTO] },
      { number: "2", type: "Double", price: 210_000, capacity: 2, amenities: ["Queen bed"], images: [ROOM_PHOTO] },
      { number: "3", type: "Deluxe Room", price: 275_000, capacity: 2, amenities: ["King bed", "River view"], images: [ROOM_PHOTO] },
      { number: "4", type: "Family Room", price: 320_000, capacity: 4, amenities: ["Two queen beds"], images: [ROOM_PHOTO] },
      { number: "5", type: "Suite", price: 390_000, capacity: 3, amenities: ["King bed", "Sitting room", "River view"], images: [ROOM_PHOTO] },
    ],
    stays: [],
  },
  {
    emulatorId: "UgDemoJinja00000002",
    publicId: "nile-bridge-guesthouse-jinja-ug26demo",
    name: "Nile Bridge Guesthouse",
    city: "Jinja",
    region: "Eastern",
    country: "Uganda",
    description: "Cozy guesthouse overlooking the Nile Bridge with warm hospitality.",
    phone: "+256 700 400 102",
    email: "stay@nilebridge.ug",
    address: "Bridge Street, Jinja",
    amenities: ["Free Wi-Fi", "Breakfast included", "Free parking"],
    propertyAmenities: ["Bicycle rental", "Garden"],
    photos: [HOTEL_PHOTO],
    checkInTime: "14:00",
    checkOutTime: "10:00",
    policies: POLICIES,
    rooms: [
      { number: "R1", type: "Double", price: 165_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "R2", type: "Double", price: 165_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "R3", type: "Twin", price: 165_000, capacity: 2, amenities: ["Two single beds"], images: [ROOM_PHOTO] },
      { number: "R4", type: "Family Room", price: 235_000, capacity: 4, images: [ROOM_PHOTO] },
    ],
    stays: [{ roomNumber: "R1", guestName: "Demo Guest — Jinja", checkIn: "2026-10-11", checkOut: "2026-10-13" }],
  },
  // Mbarara (2 hotels)
  {
    emulatorId: "UgDemoMbarara000001",
    publicId: "ankole-safari-lodge-mbarara-ug26demo",
    name: "Ankole Safari Lodge",
    city: "Mbarara",
    region: "Western",
    country: "Uganda",
    description: "Lodge with views over Ankole cattle country, perfect for cultural and nature experiences.",
    phone: "+256 700 500 101",
    email: "reservations@ankolesafari.ug",
    address: "Mbarara-Kabale Road, Mbarara",
    amenities: ["Free Wi-Fi", "Breakfast included", "Swimming pool", "Free parking", "Restaurant"],
    propertyAmenities: ["Cattle farm tours", "Nature walks"],
    photos: [HOTEL_PHOTO],
    checkInTime: "13:00",
    checkOutTime: "11:00",
    policies: POLICIES,
    rooms: [
      { number: "11", type: "Double", price: 190_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "12", type: "Double", price: 190_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "21", type: "Deluxe Room", price: 250_000, capacity: 2, amenities: ["King bed", "Countryside view"], images: [ROOM_PHOTO] },
      { number: "31", type: "Family Room", price: 320_000, capacity: 4, images: [ROOM_PHOTO] },
      { number: "41", type: "Suite", price: 380_000, capacity: 2, amenities: ["King bed", "Sitting room"], images: [ROOM_PHOTO] },
    ],
    stays: [],
  },
  {
    emulatorId: "UgDemoMbarara000002",
    publicId: "western-highlands-mbarara-ug26demo",
    name: "Western Highlands Hotel",
    city: "Mbarara",
    region: "Western",
    country: "Uganda",
    description: "Business hotel in central Mbarara with conference facilities and comfortable accommodations.",
    phone: "+256 700 500 102",
    email: "stay@westernhighlands.ug",
    address: "High Street, Mbarara",
    amenities: ["Free Wi-Fi", "Breakfast included", "Free parking", "Conference room", "Restaurant & bar"],
    propertyAmenities: ["Gym", "24-hour front desk"],
    photos: [HOTEL_PHOTO],
    checkInTime: "14:00",
    checkOutTime: "11:00",
    policies: POLICIES,
    rooms: [
      { number: "101", type: "Single", price: 120_000, capacity: 1, images: [ROOM_PHOTO] },
      { number: "102", type: "Double", price: 165_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "103", type: "Double", price: 165_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "201", type: "Deluxe Room", price: 225_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "301", type: "Family Room", price: 295_000, capacity: 5, images: [ROOM_PHOTO] },
    ],
    stays: [{ roomNumber: "102", guestName: "Demo Guest — Mbarara", checkIn: "2026-10-09", checkOut: "2026-10-14" }],
  },
  // Fort Portal (2 hotels)
  {
    emulatorId: "UgDemoFortPortal000001",
    publicId: "crater-lakes-inn-fortportal-ug26demo",
    name: "Crater Lakes Inn",
    city: "Fort Portal",
    region: "Western",
    country: "Uganda",
    description: "Scenic hotel near the famous crater lakes of Fort Portal, gateway to Kibale National Park.",
    phone: "+256 700 600 101",
    email: "reservations@craterlakes.ug",
    address: "Fort Portal-Kasese Road, Fort Portal",
    amenities: ["Free Wi-Fi", "Breakfast included", "Garden", "Free parking", "Restaurant"],
    propertyAmenities: ["Crater lake tours", "Chimpanzee tracking booking"],
    photos: [HOTEL_PHOTO],
    checkInTime: "14:00",
    checkOutTime: "10:00",
    policies: POLICIES,
    rooms: [
      { number: "A1", type: "Double", price: 185_000, capacity: 2, amenities: ["Queen bed"], images: [ROOM_PHOTO] },
      { number: "A2", type: "Double", price: 185_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "B1", type: "Twin", price: 185_000, capacity: 2, amenities: ["Two single beds"], images: [ROOM_PHOTO] },
      { number: "C1", type: "Family Room", price: 265_000, capacity: 4, images: [ROOM_PHOTO] },
      { number: "D1", type: "Suite", price: 345_000, capacity: 3, amenities: ["King bed", "Mountain view"], images: [ROOM_PHOTO] },
    ],
    stays: [],
  },
  {
    emulatorId: "UgDemoFortPortal000002",
    publicId: "rwenzori-view-hotel-fortportal-ug26demo",
    name: "Rwenzori View Hotel",
    city: "Fort Portal",
    region: "Western",
    country: "Uganda",
    description: "Hotel with stunning views of the Rwenzori Mountains, ideal for hiking enthusiasts.",
    phone: "+256 700 600 102",
    email: "stay@rwenzoriview.ug",
    address: "Mpanga Road, Fort Portal",
    amenities: ["Free Wi-Fi", "Breakfast included", "Free parking", "Restaurant"],
    propertyAmenities: ["Mountain view", "Hiking guides"],
    photos: [HOTEL_PHOTO],
    checkInTime: "14:00",
    checkOutTime: "10:00",
    policies: POLICIES,
    rooms: [
      { number: "101", type: "Double", price: 175_000, capacity: 2, amenities: ["Queen bed", "Mountain view"], images: [ROOM_PHOTO] },
      { number: "102", type: "Double", price: 175_000, capacity: 2, images: [ROOM_PHOTO] },
      { number: "201", type: "Twin", price: 175_000, capacity: 2, amenities: ["Two single beds"], images: [ROOM_PHOTO] },
      { number: "301", type: "Family Room", price: 245_000, capacity: 4, amenities: ["Two queen beds"], images: [ROOM_PHOTO] },
    ],
    stays: [{ roomNumber: "101", guestName: "Demo Guest — Fort Portal", checkIn: "2026-10-11", checkOut: "2026-10-12" }],
  },
];

/** YYYY-MM-DD → 12:00 UTC */
const stayDate = (iso: string) => new Date(`${iso}T12:00:00Z`);

if (!realProject && reset) {
  const res = await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Could not clear the emulator project: ${res.status}`);
}

if (!realProject) {
  const rules = await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT_ID}:securityRules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: { files: [{ name: "firestore.rules", content: readFileSync("firestore.rules", "utf8") }] } }),
  });
  if (!rules.ok) throw new Error(`Could not load firestore.rules into the emulator: ${rules.status} ${await rules.text()}`);
}

const db = adminDb();
const report: { name: string; city: string; hotelId: string; publicId: string; status: string }[] = [];

for (const seed of HOTELS) {
  const mapping = await db.collection(PUBLIC_HOTELS_COLLECTION).doc(seed.publicId).get();
  const existingId = mapping.exists ? String(mapping.data()?.hotelId ?? "") : "";
  if (realProject && existingId) {
    report.push({ name: seed.name, city: seed.city, hotelId: existingId, publicId: seed.publicId, status: "already present, skipped" });
    continue;
  }
  const hotelId = realProject ? db.collection("hotels").doc().id : seed.emulatorId;
  const hotelRef = db.collection("hotels").doc(hotelId);

  const batch = db.batch();
  batch.set(hotelRef, {
    name: seed.name,
    location: seed.city,
    currency: "UGX",
    phone: seed.phone,
    email: seed.email,
    address: seed.address,
    taxId: "",
    subscription: { plan: "trial", status: "active" },
    publicId: seed.publicId,
    createdAt: FieldValue.serverTimestamp(),
    listed: true,
    region: seed.region,
    country: seed.country,
    description: seed.description,
    amenities: seed.amenities,
    propertyAmenities: seed.propertyAmenities || seed.amenities,
    photos: seed.photos || [HOTEL_PHOTO],
    checkInTime: seed.checkInTime,
    checkOutTime: seed.checkOutTime,
    policies: seed.policies,
    demo: true,
  });
  batch.set(db.collection(PUBLIC_HOTELS_COLLECTION).doc(seed.publicId), { hotelId, createdAt: FieldValue.serverTimestamp() });

  for (const room of seed.rooms) {
    batch.set(hotelRef.collection("rooms").doc(`room-${room.number}`), {
      number: room.number,
      type: room.type,
      price: room.price,
      capacity: room.capacity,
      status: room.status ?? "Available",
      ...(room.amenities ? { amenities: room.amenities } : {}),
      ...(room.images ? { images: room.images } : {}),
      hotelId,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  for (const [index, stay] of seed.stays.entries()) {
    const room = seed.rooms.find((candidate) => candidate.number === stay.roomNumber);
    if (!room) continue;
    batch.set(
      hotelRef.collection("accomodation").doc(`demo-stay-ug-${hotelId.slice(-4)}-${index + 1}`),
      buildBookingDoc(
        {
          hotelId,
          reservationId: makeReservationId(stayDate(stay.checkIn)),
          room,
          guestName: stay.guestName,
          guestPhoneNumber: "+256 700 000 000",
          numberOfGuests: 1,
          checkIn: stayDate(stay.checkIn),
          checkOut: stayDate(stay.checkOut),
          pricePaid: 0,
          paymentStatus: "Pending",
          notes: "Demo booking seeded for Ugandan demo network.",
        },
        FieldValue.serverTimestamp()
      )
    );
  }
  await batch.commit();
  report.push({ name: seed.name, city: seed.city, hotelId, publicId: seed.publicId, status: `seeded: ${seed.rooms.length} rooms, ${seed.stays.length} bookings` });
}

console.log(`\nUgandan demo hotels → ${realProject ? `REAL project ${realProject}` : `emulator ${EMULATOR}, project ${PROJECT_ID}`}\n`);
console.table(report);
const byCity: Record<string, number> = {};
for (const r of report) byCity[r.city] = (byCity[r.city] || 0) + 1;
console.log("\nDistribution by city:", byCity);
console.log("\nGuest concierge:   http://localhost:5173/#/");
console.log("Staff workspace:   http://localhost:5173/#/staff  → paste a hotelId above into “Open your workspace”.");
console.log("Hotel ids are workspace keys: share them only with that hotel's staff.\n");
process.exit(0);

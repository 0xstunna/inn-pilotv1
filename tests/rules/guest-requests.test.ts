/**
 * Security-rule coverage for guest requests and complaints (R13/R14).
 *
 * The AI writes these records server-side; staff acknowledge, assign and
 * resolve them from the browser. These tests pin down the client side of that
 * lifecycle: a workspace can read its own queue and move requests forward,
 * but cannot invent statuses, delete records or move them to another hotel.
 *
 * Runs the real firestore.rules against the emulator:
 *   firebase emulators:start --only firestore   (then)   npm run test:rules
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

let env: RulesTestEnvironment;
const HOTEL = "hotel-guest-requests";
const OTHER_HOTEL = "hotel-other";
const REQUEST = "REQ-20261123-ABC234";

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "innpilot-guest-requests-rules-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "hotels", HOTEL), { name: "Hotel A", currency: "UGX" });
    await setDoc(doc(db, "hotels", OTHER_HOTEL), { name: "Hotel B", currency: "UGX" });
    await setDoc(doc(db, "hotels", HOTEL, "guestRequests", REQUEST), {
      hotelId: HOTEL,
      type: "complaint",
      category: "housekeeping",
      priority: "high",
      status: "new",
      department: "Housekeeping",
      channel: "web",
      conversationId: "conv_1234567890",
      guestName: "Amina Okello",
      summary: "Room 204 is dirty.",
      createdAt: Timestamp.now(),
      notes: [],
    });
  });
});

const db = () => env.unauthenticatedContext().firestore();
const requestRef = () => doc(db(), "hotels", HOTEL, "guestRequests", REQUEST);

describe("Guest requests", () => {
  it("a workspace can read its request queue", async () => {
    await assertSucceeds(getDocs(collection(db(), "hotels", HOTEL, "guestRequests")));
  });

  it("staff can acknowledge a new request", async () => {
    await assertSucceeds(
      updateDoc(requestRef(), { status: "acknowledged", updatedAt: Timestamp.now() }),
    );
  });

  it("CANNOT write an unknown request status", async () => {
    await assertFails(updateDoc(requestRef(), { status: "pending" }));
  });

  it("CANNOT move a request to another hotel", async () => {
    await assertFails(updateDoc(requestRef(), { hotelId: OTHER_HOTEL }));
  });

  it("CANNOT delete a request", async () => {
    await assertFails(deleteDoc(requestRef()));
  });
});

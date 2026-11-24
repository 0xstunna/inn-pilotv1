/**
 * The guest chat limiter must be shared: two serverless instances (or two
 * separate processes in a test) have no in-memory state in common, but both
 * hit the same Firestore counters.
 */
import { beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "innpilot-shared-rate-limit-test";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
delete process.env.FIREBASE_SERVICE_ACCOUNT;

import { adminDb } from "../../server/admin";
import { AiRateLimitError } from "../../server/ai/errors";
import { enforceSharedRateLimits } from "../../server/ai/sharedRateLimit";
import { clearEmulator } from "./fixtures/network";

const WINDOW = 60_000;
const HOTEL = "k-hotels-kabale-test0001";
const OTHER_HOTEL = "k-hotels-jinja-test00001";
const IP = "203.0.113.7";

beforeEach(async () => {
  await clearEmulator(PROJECT_ID);
});

describe("Firestore-backed guest chat limits", () => {
  it("shares the hotel allowance across different visitors", async () => {
    const now = Date.now();
    const scopes = (hotel: string, ip: string) => [
      { key: `concierge:hotel:${hotel}`, limit: 2, windowMs: WINDOW },
      { key: `concierge:ip:${ip}`, limit: 10, windowMs: WINDOW },
    ];

    await enforceSharedRateLimits(scopes(HOTEL, "198.51.100.1"), { now });
    await enforceSharedRateLimits(scopes(HOTEL, "198.51.100.2"), { now });

    await expect(enforceSharedRateLimits(scopes(HOTEL, "198.51.100.3"), { now })).rejects.toBeInstanceOf(
      AiRateLimitError
    );
  });

  it("shares the visitor allowance across different hotels", async () => {
    const now = Date.now();
    const scopes = (hotel: string) => [
      { key: `concierge:hotel:${hotel}`, limit: 10, windowMs: WINDOW },
      { key: `concierge:ip:${IP}`, limit: 2, windowMs: WINDOW },
    ];

    await enforceSharedRateLimits(scopes(HOTEL), { now });
    await enforceSharedRateLimits(scopes(OTHER_HOTEL), { now });

    await expect(enforceSharedRateLimits(scopes("k-hotels-kampala-test001"), { now })).rejects.toMatchObject({
      status: 429,
      code: "rate_limited",
    });
  });

  it("forgets hits once they fall outside the window", async () => {
    const now = Date.now();
    const scopes = [{ key: `concierge:hotel:${HOTEL}`, limit: 1, windowMs: WINDOW }];

    await enforceSharedRateLimits(scopes, { now });
    await expect(enforceSharedRateLimits(scopes, { now: now + 1 })).rejects.toBeInstanceOf(AiRateLimitError);
    await expect(enforceSharedRateLimits(scopes, { now: now + WINDOW + 1 })).resolves.toBeUndefined();
  });

  it("never stores the raw IP or hotel id", async () => {
    const scopes = [
      { key: `concierge:hotel:${HOTEL}`, limit: 2, windowMs: WINDOW },
      { key: `concierge:ip:${IP}`, limit: 2, windowMs: WINDOW },
    ];
    await enforceSharedRateLimits(scopes);

    const docs = await adminDb().collection("aiRateLimits").get();
    const stored = JSON.stringify(docs.docs.map((doc) => doc.data()));
    expect(stored).not.toContain(IP);
    expect(stored).not.toContain(HOTEL);
    expect(docs.docs).toHaveLength(2);
  });
});

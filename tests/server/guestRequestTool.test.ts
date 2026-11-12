/**
 * log_guest_request tool — record creation, dedupe, rate limit, enum
 * validation (R13/R14). Runs against the Firestore emulator through the real
 * Firebase Admin SDK.
 *
 *   firebase emulators:start --only firestore   (then)   npm run test:server
 */
import { beforeEach, describe, expect, it } from "vitest";

const PROJECT_ID = "innpilot-guest-request-test";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
delete process.env.FIREBASE_SERVICE_ACCOUNT;

import { adminDb } from "../../server/admin";
import { CONCIERGE_TOOLS, createToolbox, type ToolContext } from "../../server/ai/tools";
import { resolveHotel } from "../../server/hotels";
import { createNetworkContext } from "../../server/network";
import {
  clearEmulator,
  KABALE,
  seedNetwork,
} from "./fixtures/network";

type Result = Record<string, unknown>;

async function context(scopedPublicId = KABALE.publicId): Promise<ToolContext> {
  return {
    network: await createNetworkContext(scopedPublicId),
    guestMessage: "",
    pendingBooking: null,
    now: new Date(),
  };
}

async function run(name: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<Result> {
  return createToolbox(ctx ?? (await context())).execute({ name, args });
}

const baseArgs = {
  hotel: KABALE.publicId,
  type: "complaint",
  category: "housekeeping",
  priority: "high",
  channel: "web" as const,
  conversationId: "conv_1234567890abcdefghij",
  guestName: "Amina Okello",
  guestPhone: "+256 772 123 456",
  guestRoom: "204",
  summary: "Room 204 is dirty and has no hot water.",
  guestExcerpt: "My room was dirty and there is no hot water.",
};

beforeEach(async () => {
  await clearEmulator(PROJECT_ID);
  await seedNetwork(adminDb());
});

describe("log_guest_request", () => {
  it("creates a structured request record with id, department, timestamps", async () => {
    const result = await run("log_guest_request", baseArgs);
    expect(result.status).toBe("logged");
    expect(result.id).toMatch(/^REQ-\d{8}-[A-HJ-NP-Z2-9]{6}$/);
    expect(result.reference).toBe(result.id);
    expect(result.department).toBe("Housekeeping");
    expect(result.duplicate).toBe(false);

    // Record is stored in Firestore under the scoped hotel.
    const scope = (await resolveHotel(KABALE.publicId));
    const snap = await scope.collection("guestRequests").doc(result.id).get();
    expect(snap.exists).toBe(true);
    const data = snap.data();
    expect(data!.type).toBe("complaint");
    expect(data!.category).toBe("housekeeping");
    expect(data!.priority).toBe("high");
    expect(data!.channel).toBe("web");
    expect(data!.guestName).toBe("Amina Okello");
    expect(data!.guestPhone).toBe("+256 772 123 456");
    expect(data!.guestRoom).toBe("204");
    expect(data!.summary).toBe("Room 204 is dirty and has no hot water.");
    expect(data!.guestExcerpt).toBe("My room was dirty and there is no hot water.");
    expect(data!.status).toBe("new");
    // Firestore returns Timestamps from the emulator.
    expect(typeof data!.createdAt?.toMillis).toBe("function");
    expect(data!.notes).toEqual([]);
  });

  it("validates enum arguments", async () => {
    const badType = await run("log_guest_request", { ...baseArgs, type: "urgent" as any });
    expect(badType.status).toBe("not_logged");
    expect(badType.reason).toBe("invalid_type");

    const badCategory = await run("log_guest_request", { ...baseArgs, category: "plumbing" as any });
    expect(badCategory.status).toBe("not_logged");
    expect(badCategory.reason).toBe("invalid_category");

    const badPriority = await run("log_guest_request", { ...baseArgs, priority: "critical" as any });
    expect(badPriority.status).toBe("not_logged");
    expect(badPriority.reason).toBe("invalid_priority");

    const badChannel = await run("log_guest_request", { ...baseArgs, channel: "sms" as any });
    expect(badChannel.status).toBe("not_logged");
    expect(badChannel.reason).toBe("invalid_channel");

    const missingSummary = await run("log_guest_request", { ...baseArgs, summary: "" });
    expect(missingSummary.status).toBe("not_logged");
    expect(missingSummary.reason).toBe("missing_summary");
  });

  it("rejects unknown hotels", async () => {
    const result = await run("log_guest_request", { ...baseArgs, hotel: "no-such-hotel-00000000" });
    expect(result.status).toBe("not_logged");
    expect(result.reason).toBe("unknown_hotel");
  });

  it("dedupes the same guest excerpt within the conversation window", async () => {
    const first = await run("log_guest_request", baseArgs);
    expect(first.status).toBe("logged");

    const duplicate = await run("log_guest_request", baseArgs);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.department).toBe("Housekeeping");
  });

  it("does not dedupe a different excerpt in the same conversation", async () => {
    const first = await run("log_guest_request", baseArgs);
    expect(first.status).toBe("logged");

    const second = await run("log_guest_request", { ...baseArgs, guestExcerpt: "The Wi-Fi is broken too." });
    expect(second.status).toBe("logged");
    expect(second.id).not.toBe(first.id);
  });

  it("enforces a per-conversation rate limit", async () => {
    const args = { ...baseArgs, conversationId: "conv_rate_limit" };
    for (let i = 0; i < 5; i++) {
      const result = await run("log_guest_request", { ...args, guestExcerpt: `Request number ${i}` });
      expect(result.status).toBe("logged");
    }
    const overLimit = await run("log_guest_request", { ...args, guestExcerpt: "One too many" });
    expect(overLimit.status).toBe("not_logged");
    expect(overLimit.reason).toBe("rate_limited");
  });

  it("applies the rate limit per conversation, not globally", async () => {
    await run("log_guest_request", { ...baseArgs, conversationId: "conv_a", guestExcerpt: "Issue A" });
    await run("log_guest_request", { ...baseArgs, conversationId: "conv_b", guestExcerpt: "Issue B" });
    // Both conversations can log independently.
    const a = await run("log_guest_request", { ...baseArgs, conversationId: "conv_a", guestExcerpt: "Issue A again" });
    const b = await run("log_guest_request", { ...baseArgs, conversationId: "conv_b", guestExcerpt: "Issue B again" });
    expect(a.status).toBe("logged");
    expect(b.status).toBe("logged");
  });

  it("stores whichever valid priority the model passes (classifier sets defaults)", async () => {
    for (const priority of ["normal", "high", "urgent"] as const) {
      const result = await run("log_guest_request", {
        ...baseArgs,
        category: "other",
        priority,
        guestExcerpt: `Priority ${priority} test`,
      });
      expect(result.status).toBe("logged");
      const scope = (await resolveHotel(KABALE.publicId));
      const snap = await scope.collection("guestRequests").doc(result.id).get();
      expect(snap.data()!.priority).toBe(priority);
    }
  });
});

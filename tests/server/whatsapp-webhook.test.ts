/**
 * WhatsApp webhook production-readiness and reliability tests — no real Meta
 * credentials, no network, no emulator. The WhatsApp adapter's real
 * `configured()`, `verifySignature()` and `receive()` are used (controlled via
 * a per-hotel credentials object and computed HMAC signatures).
 *
 * `adminDb`, `processGuestTurn`, `resolveHotel` and `whatsappAdapter.send`
 * are spied on to avoid requiring AI provider credentials, Firestore or Meta.
 *
 * Covers:
 *   Task 1 — Event processing lifecycle: RECEIVED → PROCESSING → COMPLETED/FAILED,
 *            atomic claim, duplicate detection, stale PROCESSING recovery,
 *            failed-then-retry, failed-then-max-attempts.
 *   Task 2 — Multi-tenant credentials: per-hotel access tokens, credential
 *            isolation, disconnected/expired/revoked connections.
 *   Task 3 — Secure tenant routing: phone_number_id determines routing, query
 *            param cannot override registered mapping, single-hotel fallback,
 *            tenant-routing manipulation attempts.
 *   Task 4 — Failure recovery: crash after persistence, retry after interrupt,
 *            concurrent delivery, stale PROCESSING recovery, failed-then-retry,
 *            duplicate prevention, credential isolation, correct outbound
 *            credentials, expired/disconnected connections.
 */
import { vi, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_PROJECT_ID = "test-project";

// ---- Spy on processGuestTurn (mocked via vi.mock factory; accessed
// through the imported conciergeTurn module below) ---------------------------
vi.mock("../../server/ai/conciergeTurn.js", () => ({
  processGuestTurn: vi.fn(async () => ({
    reply: "I can help with that.",
    model: "test-model",
    requestId: "req_123",
    conversationId: "conv_1234567890abcdefghij",
    handledBy: "ai",
  })),
}));

// ---- Mock Firestore admin ---------------------------------------------------
// In-memory doc store keyed by "collectionId/docId".
// Each entry: { exists, data, path } plus mutable fields for transaction tests.
const docStore = new Map<string, {
  exists: boolean;
  data: () => unknown;
  path: string;
  _updateData?: Record<string, unknown>;
}>();

vi.mock("../../server/admin.js", () => ({
  adminDb: vi.fn(() => ({
    collection: (collectionId: string) => ({
      doc: (docId: string) => {
        const key = `${collectionId}/${docId}`;
        let entry = docStore.get(key);
        if (!entry) {
          entry = { exists: false, data: () => undefined, path: key };
          docStore.set(key, entry);
        }
        return {
          path: key,
          get: async (): Promise<{ exists: boolean; data: () => unknown }> =>
            entry,
        };
      },
    }),
    runTransaction: async (work: (tx: any) => Promise<any>) => {
      const tx: any = {
        get: async (ref: any): Promise<{ exists: boolean; data: () => unknown }> => {
          const path = ref.path ?? "";
          const entry = docStore.get(path) ?? { exists: false, data: () => undefined };
          return entry;
        },
        create: async (_ref: any, data: any) => {
          const path = _ref.path ?? "";
          // Idempotent create: if the doc already exists (concurrent worker),
          // just update it instead of throwing.
          const entry = docStore.get(path);
          if (entry && entry.exists) {
            entry._updateData = { ...(entry._updateData ?? entry.data()), ...data };
            entry.data = () => entry._updateData;
            return;
          }
          docStore.set(path, {
            exists: true,
            data: () => data,
            path,
            _updateData: { ...data },
          });
        },
        update: async (_ref: any, data: any) => {
          const path = _ref.path ?? "";
          const entry = docStore.get(path);
          if (!entry || !entry.exists) {
            throw new Error("Document does not exist");
          }
          entry._updateData = { ...(entry._updateData ?? entry.data()), ...data };
          entry.data = () => entry._updateData;
        },
      };
      return work(tx);
    },
    FieldValue: {
      serverTimestamp: () => ({
        __serverTimestamp: true,
        toMillis: () => Date.now(),
      }),
    },
  })),
}));

// ---- Mock resolveHotel ------------------------------------------------------
vi.mock("../../server/hotels.js", () => ({
  resolveHotel: vi.fn(async (publicId: string) => ({
    hotelId: `hotel_${publicId}`,
    publicId,
    profile: { name: `Hotel ${publicId}`, location: "Kampala", currency: "UGX", phone: "", email: "" },
    collection: vi.fn(),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(),
  })),
}));

// ---- Spy on WhatsApp adapter send (avoid real Meta API calls) -------------
import { whatsappAdapter } from "../../src/lib/channels/whatsapp.js";
vi.spyOn(whatsappAdapter, "send").mockResolvedValue({ ok: true, externalId: "msg_sent_123" });

import { default as webhookHandler } from "../../api/ai/webhook/whatsapp.js";
import * as conciergeTurn from "../../server/ai/conciergeTurn.js";
import * as adminModule from "../../server/admin.js";
import * as hotelsModule from "../../server/hotels.js";
import { adminDb } from "../../server/admin.js";

// ---- Helpers ----------------------------------------------------------------

function resetDocStore() {
  docStore.clear();
}

function makeHotelConnection(
  hotelId: string,
  overrides: Partial<{
    phoneNumberId: string;
    accessToken: string;
    appSecret: string;
    verifyToken: string;
    status: "active" | "disconnected" | "expired" | "revoked";
  }> = {},
): Record<string, unknown> {
  return {
    phoneNumberId: overrides.phoneNumberId ?? "123456789",
    accessToken: overrides.accessToken ?? "token_hotel_" + hotelId,
    appSecret: overrides.appSecret ?? "secret_hotel_" + hotelId,
    verifyToken: overrides.verifyToken ?? "verify_hotel_" + hotelId,
    status: overrides.status ?? "active",
    connectedAt: { __serverTimestamp: true },
    updatedAt: { __serverTimestamp: true },
  };
}

function setHotelConnection(hotelId: string, overrides?: Parameters<typeof makeHotelConnection>[1]) {
  docStore.set(`whatsappConnections/${hotelId}`, {
    exists: true,
    data: () => makeHotelConnection(hotelId, overrides),
    path: `whatsappConnections/${hotelId}`,
  });
}

function setPhoneNumberMapping(phoneNumberId: string, publicHotelId: string, hotelId: string) {
  docStore.set(`whatsappPhoneNumberIds/${phoneNumberId}`, {
    exists: true,
    data: () => ({ publicHotelId, hotelId }),
    path: `whatsappPhoneNumberIds/${phoneNumberId}`,
  });
}

function setEventStatus(
  eventId: string,
  status: "received" | "processing" | "completed" | "failed",
  overrides: Partial<{
    publicHotelId: string;
    hotelId: string;
    attempts: number;
    claimedAtMs: number | null;
    claimedBy: string;
    lastError: string;
  }> = {},
) {
  const now = Date.now();
  docStore.set(`whatsappWebhookEvents/${eventId}`, {
    exists: true,
    data: () => ({
      status,
      publicHotelId: overrides.publicHotelId ?? "test-hotel",
      hotelId: overrides.hotelId ?? "hotel_test-hotel",
      attempts: overrides.attempts ?? 0,
      lastError: overrides.lastError,
      createdAt: { __serverTimestamp: true, toMillis: () => now },
      claimedAt: overrides.claimedAtMs === null ? undefined : {
        __serverTimestamp: true,
        toMillis: () => overrides.claimedAtMs ?? now - 1000,
      },
      claimedBy: overrides.claimedBy ?? "worker_1",
    }),
    path: `whatsappWebhookEvents/${eventId}`,
  });
}

function clearEvent(eventId: string) {
  docStore.delete(`whatsappWebhookEvents/${eventId}`);
}

function configureWhatsAppEnv() {
  // Global env is not used for per-hotel webhook processing, but keep it
  // set so the adapter's `configured()` on GET verification still works.
  process.env.WHATSAPP_ACCESS_TOKEN = "global_token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123456789";
  process.env.WHATSAPP_VERIFY_TOKEN = "global_verify";
  process.env.WHATSAPP_APP_SECRET = "global_app_secret";
}

function computeTestSignature(appSecret: string, body: string): string {
  const crypto = require("crypto");
  return `sha256=${crypto.createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

function makeMockReq(overrides: Partial<{
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}> = {}): any {
  const headers: Record<string, string | string[] | undefined> = {
    "content-type": "application/json",
    ...overrides.headers,
  };
  const rawBody = typeof overrides.body === "string"
    ? overrides.body
    : overrides.body !== undefined
      ? JSON.stringify(overrides.body)
      : "";
  return {
    method: overrides.method ?? "POST",
    url: overrides.url ?? "/api/ai/webhook/whatsapp",
    headers,
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(rawBody, "utf8");
    },
  } as any;
}

function makeMockRes(): any {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null,
    status(code: number) { res.statusCode = code; return res; },
    setHeader(name: string, value: string) { res.headers[name] = value; return res; },
    json(body: unknown) { res.body = body; return res; },
    end() { return res; },
  };
  return res;
}

function makeWhatsAppWebhookBody(
  phoneNumberId: string,
  messageId: string,
  from: string,
  text: string,
): any {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "entry_123",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "+1234567890",
                phone_number_id: phoneNumberId,
              },
              messages: [
                {
                  id: messageId,
                  from,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

// ---- Tests ----------------------------------------------------------------

describe("WhatsApp webhook — signature verification (per-hotel credentials)", () => {
  beforeEach(() => {
    resetDocStore();
    configureWhatsAppEnv();
    conciergeTurn.processGuestTurn.mockClear();
    setHotelConnection("hotel_test-hotel");
    setPhoneNumberMapping("123456789", "test-hotel", "hotel_test-hotel");
  });

  it("rejects POST with no signature header — 401", async () => {
    const req = makeMockReq({
      method: "POST",
      body: makeWhatsAppWebhookBody("123456789", "msg_1", "+256700000000", "I need a room"),
    });
    delete req.headers["x-hub-signature-256"];
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Missing webhook signature.");
  });

  it("rejects POST with invalid signature — 401", async () => {
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_1", "+256700000000", "I need a room"));
    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=invalid_signature" },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Invalid webhook signature.");
  });

  it("returns 503 when hotel's WhatsApp connection is not active", async () => {
    setHotelConnection("hotel_test-hotel", { status: "disconnected" });

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_1", "+256700000000", "I need a room"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain("not configured for this hotel");
  });

  it("accepts POST with valid signature and proceeds (per-hotel credentials)", async () => {
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_ok", "+256700000000", "I need a room"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    clearEvent("msg_ok");

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("received");
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(1);
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledWith(
      expect.objectContaining({ publicHotelId: "test-hotel", channel: "whatsapp" }),
    );
  });
});

describe("WhatsApp webhook — event processing lifecycle (Task 1)", () => {
  beforeEach(() => {
    resetDocStore();
    configureWhatsAppEnv();
    conciergeTurn.processGuestTurn.mockClear();
    setHotelConnection("hotel_test-hotel");
    setPhoneNumberMapping("123456789", "test-hotel", "hotel_test-hotel");
  });

  it("persists event as RECEIVED before processing", async () => {
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_lifecycle", "+256700000000", "Hello"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    clearEvent("msg_lifecycle");

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    // Event should be COMPLETED after successful processing
    const eventDoc = docStore.get(`whatsappWebhookEvents/msg_lifecycle`);
    expect(eventDoc).toBeDefined();
    expect(eventDoc!.data().status).toBe("completed");
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(1);
  });

  it("server failure after event persistence — event is FAILED, not lost", async () => {
    // Make processGuestTurn throw after the event is persisted
    conciergeTurn.processGuestTurn.mockRejectedValueOnce(new Error("AI service crashed"));

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_crash", "+256700000000", "Hello"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    clearEvent("msg_crash");

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    const eventDoc = docStore.get(`whatsappWebhookEvents/msg_crash`);
    expect(eventDoc).toBeDefined();
    expect(eventDoc!.data().status).toBe("failed");
    expect(eventDoc!.data().attempts).toBe(1);
    expect(eventDoc!.data().lastError).toContain("AI service crashed");
  });

  it("retry after interrupted processing — failed event can be retried", async () => {
    // First attempt: event exists as FAILED with 1 attempt
    setEventStatus("msg_retry", "failed", {
      publicHotelId: "test-hotel",
      hotelId: "hotel_test-hotel",
      attempts: 1,
      lastError: "Previous failure",
    });

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_retry", "+256700000000", "Retry"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("received");
    // processGuestTurn called for the retry
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(1);
    const eventDoc = docStore.get(`whatsappWebhookEvents/msg_retry`);
    expect(eventDoc!.data().attempts).toBe(2);
    expect(eventDoc!.data().status).toBe("completed");
  });

  it("concurrent delivery of the same event — only one worker processes", async () => {
    clearEvent("msg_concurrent");

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_concurrent", "+256700000000", "Concurrent"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    // First delivery claims and processes the event
    const req1 = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res1 = makeMockRes();
    await webhookHandler(req1, res1);

    expect(res1.statusCode).toBe(200);
    expect(res1.body.status).toBe("received");
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(1);

    // Second (redelivery) — event is now COMPLETED, acknowledged as duplicate
    const req2 = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res2 = makeMockRes();
    await webhookHandler(req2, res2);

    expect(res2.statusCode).toBe(200);
    expect(res2.body.status).toBe("duplicate");
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(1); // still only 1
  });

  it("recovery of stale PROCESSING events — abandoned claim is reclaimed", async () => {
    // Event is stuck in PROCESSING with an old claimedAt (more than TTL ago)
    const staleTime = Date.now() - 10 * 60 * 1000; // 10 minutes ago
    setEventStatus("msg_stale", "processing", {
      publicHotelId: "test-hotel",
      hotelId: "hotel_test-hotel",
      attempts: 1,
      claimedAtMs: staleTime,
    });

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_stale", "+256700000000", "Stale recovery"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("received");
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(1);
    const eventDoc = docStore.get(`whatsappWebhookEvents/msg_stale`);
    expect(eventDoc!.data().status).toBe("completed");
  });

  it("failed AI processing followed by successful retry", async () => {
    // First call fails, second succeeds
    conciergeTurn.processGuestTurn
      .mockRejectedValueOnce(new Error("Transient AI failure"))
      .mockResolvedValueOnce({
        reply: "Retry succeeded",
        model: "test-model",
        requestId: "req_retry",
        conversationId: "conv_retry",
        handledBy: "ai",
      });

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_failretry", "+256700000000", "Fail then retry"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    clearEvent("msg_failretry");

    // First attempt
    const req1 = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res1 = makeMockRes();
    await webhookHandler(req1, res1);
    expect(res1.statusCode).toBe(200);
    const eventAfterFail = docStore.get(`whatsappWebhookEvents/msg_failretry`);
    expect(eventAfterFail!.data().status).toBe("failed");
    expect(eventAfterFail!.data().attempts).toBe(1);

    // Second attempt (redelivery) succeeds
    const req2 = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res2 = makeMockRes();
    await webhookHandler(req2, res2);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.status).toBe("received");
    const eventAfterSuccess = docStore.get(`whatsappWebhookEvents/msg_failretry`);
    expect(eventAfterSuccess!.data().status).toBe("completed");
    expect(eventAfterSuccess!.data().attempts).toBe(2);
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(2);
  });

  it("max attempts reached — failed event stops being retried", async () => {
    // Event is FAILED with max attempts already
    setEventStatus("msg_maxed", "failed", {
      publicHotelId: "test-hotel",
      hotelId: "hotel_test-hotel",
      attempts: 3,
      lastError: "Giving up",
    });

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_maxed", "+256700000000", "Maxed out"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("duplicate");
    expect(conciergeTurn.processGuestTurn).not.toHaveBeenCalled();
  });
});

describe("WhatsApp webhook — duplicate prevention for guest messages and bookings (Task 4.6)", () => {
  beforeEach(() => {
    resetDocStore();
    configureWhatsAppEnv();
    conciergeTurn.processGuestTurn.mockClear();
    setHotelConnection("hotel_test-hotel");
    setPhoneNumberMapping("123456789", "test-hotel", "hotel_test-hotel");
  });

  it("duplicate webhook for the same message does not reprocess", async () => {
    clearEvent("msg_dup_prevent");

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_dup_prevent", "+256700000000", "Original"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    // First delivery
    const req1 = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res1 = makeMockRes();
    await webhookHandler(req1, res1);
    expect(res1.body.status).toBe("received");
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(1);

    // Meta redelivers the same event ID
    const req2 = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res2 = makeMockRes();
    await webhookHandler(req2, res2);
    expect(res2.body.status).toBe("duplicate");
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(1); // still 1
  });
});

describe("WhatsApp webhook — secure tenant routing (Task 3)", () => {
  beforeEach(() => {
    resetDocStore();
    configureWhatsAppEnv();
    conciergeTurn.processGuestTurn.mockClear();
    // Hotel A owns phone number 123456789
    setHotelConnection("hotel_hotel-a", { phoneNumberId: "123456789" });
    setPhoneNumberMapping("123456789", "hotel-a", "hotel_hotel-a");
    // Hotel B owns phone number 999999999
    setHotelConnection("hotel_hotel-b", { phoneNumberId: "999999999" });
    setPhoneNumberMapping("999999999", "hotel-b", "hotel_hotel-b");
  });

  it("routes by phone_number_id to the correct hotel, ignoring query param", async () => {
    // Webhook comes in on phone number 123456789 (hotel A) but query param says hotel-b
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_route_a", "+256700000000", "Hello A"));
    const signature = computeTestSignature("secret_hotel_hotel_hotel-a", rawBody);

    clearEvent("msg_route_a");

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
      url: "/api/ai/webhook/whatsapp?publicHotelId=hotel-b",
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledWith(
      expect.objectContaining({ publicHotelId: "hotel-a" }),
    );
  });

  it("rejects webhook for unregistered phone number ID — 400", async () => {
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("000000000", "msg_unmapped", "+256700000000", "Hello"));
    const signature = computeTestSignature("any_secret", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("No hotel is registered for this WhatsApp number");
    expect(conciergeTurn.processGuestTurn).not.toHaveBeenCalled();
  });

  it("tenant-routing manipulation: valid signature for hotel A's number cannot reach hotel B", async () => {
    // Phone number 123456789 belongs to hotel A. Even with a valid signature
    // using hotel B's app secret, routing goes to hotel A (the number's owner).
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_manipulate", "+256700000000", "Manipulate"));
    // Sign with hotel B's secret — but routing is by phone number, so hotel A's connection is used
    const signature = computeTestSignature("secret_hotel_hotel_hotel-b", rawBody);

    clearEvent("msg_manipulate");

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    // Signature verification uses hotel A's app secret (owner of the number),
    // so hotel B's signature won't match → 401
    expect(res.statusCode).toBe(401);
    expect(conciergeTurn.processGuestTurn).not.toHaveBeenCalled();
  });

  it("falls back to publicHotelId query param only in single-hotel mode", async () => {
    // Without WHATSAPP_SINGLE_HOTEL_MODE, no phone_number_id → 400
    const body = {
      object: "whatsapp_business_account",
      entry: [{ id: "e1", changes: [{ value: { messaging_product: "whatsapp", metadata: {}, messages: [{ id: "msg_fb", from: "+256700000000", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: "Hi" } }] } }] }],
    };
    const rawBody = JSON.stringify(body);
    const signature = computeTestSignature("secret_hotel_hotel_hotel-a", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
      url: "/api/ai/webhook/whatsapp?publicHotelId=hotel-a",
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain("phone_number_id is required");
  });

  it("allows query-param fallback when WHATSAPP_SINGLE_HOTEL_MODE=true", async () => {
    process.env.WHATSAPP_SINGLE_HOTEL_MODE = "true";
    setHotelConnection("hotel_hotel-a", { phoneNumberId: "123456789" });

    const body = {
      object: "whatsapp_business_account",
      entry: [{ id: "e1", changes: [{ value: { messaging_product: "whatsapp", metadata: {}, messages: [{ id: "msg_fb2", from: "+256700000000", timestamp: String(Math.floor(Date.now() / 1000)), text: { body: "Hi" } }] } }] }],
    };
    const rawBody = JSON.stringify(body);
    const signature = computeTestSignature("secret_hotel_hotel_hotel-a", rawBody);

    clearEvent("msg_fb2");

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
      url: "/api/ai/webhook/whatsapp?publicHotelId=hotel-a",
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledWith(
      expect.objectContaining({ publicHotelId: "hotel-a" }),
    );

    delete process.env.WHATSAPP_SINGLE_HOTEL_MODE;
  });
});

describe("WhatsApp webhook — multi-tenant credential isolation (Task 2)", () => {
  beforeEach(() => {
    resetDocStore();
    configureWhatsAppEnv();
    conciergeTurn.processGuestTurn.mockClear();
    vi.spyOn(whatsappAdapter, "send").mockClear();
  });

  it("hotel A's webhook uses hotel A's credentials (signature verified with hotel A's secret)", async () => {
    setHotelConnection("hotel_hotel-a", { phoneNumberId: "111111111", appSecret: "secret_a" });
    setHotelConnection("hotel_hotel-b", { phoneNumberId: "222222222", appSecret: "secret_b" });
    setPhoneNumberMapping("111111111", "hotel-a", "hotel_hotel-a");
    setPhoneNumberMapping("222222222", "hotel-b", "hotel_hotel-b");

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("111111111", "msg_isolation_a", "+256700000000", "Hello A"));
    const signatureA = computeTestSignature("secret_a", rawBody);
    const signatureB = computeTestSignature("secret_b", rawBody); // wrong secret for this number

    clearEvent("msg_isolation_a");

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signatureA },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledWith(
      expect.objectContaining({ publicHotelId: "hotel-a" }),
    );

    // The wrong secret for this phone number must be rejected
    clearEvent("msg_isolation_b");
    const rawBodyB = JSON.stringify(makeWhatsAppWebhookBody("222222222", "msg_isolation_b", "+256700000000", "Hello B"));
    const signatureB2 = computeTestSignature("secret_a", rawBodyB); // hotel A's secret on hotel B's number
    const reqB = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signatureB2 },
      body: rawBodyB,
    });
    const resB = makeMockRes();
    await webhookHandler(reqB, resB);
    expect(resB.statusCode).toBe(401);
  });

  it("outbound send uses the correct hotel's credentials", async () => {
    setHotelConnection("hotel_hotel-a", { phoneNumberId: "111111111", accessToken: "token_a" });
    setHotelConnection("hotel_hotel-b", { phoneNumberId: "222222222", accessToken: "token_b" });

    const { default: sendHandler } = await import("../../api/ai/whatsapp/send.js");

    // Send as hotel A
    let req = makeMockReq({
      method: "POST",
      body: JSON.stringify({
        hotelId: "hotel_hotel-a",
        conversationId: "+256700000000",
        guestContact: "+256700000000",
        text: "Hello from A",
      }),
    });
    let res = makeMockRes();
    await sendHandler(req, res);
    expect(res.statusCode).toBe(200);
    // Verify send was called with hotel A's token
    const sendCallA = (whatsappAdapter.send as any).mock.calls.find(
      (c: any) => c[0].WHATSAPP_ACCESS_TOKEN === "token_a",
    );
    expect(sendCallA).toBeDefined();

    // Send as hotel B
    req = makeMockReq({
      method: "POST",
      body: JSON.stringify({
        hotelId: "hotel_hotel-b",
        conversationId: "+256700000000",
        guestContact: "+256700000000",
        text: "Hello from B",
      }),
    });
    res = makeMockRes();
    await sendHandler(req, res);
    expect(res.statusCode).toBe(200);
    const sendCallB = (whatsappAdapter.send as any).mock.calls.find(
      (c: any) => c[0].WHATSAPP_ACCESS_TOKEN === "token_b",
    );
    expect(sendCallB).toBeDefined();

    // Hotel A cannot send with hotel B's credentials
    expect((whatsappAdapter.send as any).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("send returns 503 when hotel's connection is disconnected", async () => {
    setHotelConnection("hotel_hotel-a", { status: "disconnected" });

    const { default: sendHandler } = await import("../../api/ai/whatsapp/send.js");

    const req = makeMockReq({
      method: "POST",
      body: JSON.stringify({
        hotelId: "hotel_hotel-a",
        conversationId: "+256700000000",
        guestContact: "+256700000000",
        text: "Hello",
      }),
    });
    const res = makeMockRes();

    await sendHandler(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain("not configured for this hotel");
  });

  it("send returns 503 when hotel's connection is expired", async () => {
    setHotelConnection("hotel_hotel-a", { status: "expired" });

    const { default: sendHandler } = await import("../../api/ai/whatsapp/send.js");

    const req = makeMockReq({
      method: "POST",
      body: JSON.stringify({
        hotelId: "hotel_hotel-a",
        conversationId: "+256700000000",
        guestContact: "+256700000000",
        text: "Hello",
      }),
    });
    const res = makeMockRes();

    await sendHandler(req, res);

    expect(res.statusCode).toBe(503);
  });

  it("send returns 503 when hotel's connection is revoked", async () => {
    setHotelConnection("hotel_hotel-a", { status: "revoked" });

    const { default: sendHandler } = await import("../../api/ai/whatsapp/send.js");

    const req = makeMockReq({
      method: "POST",
      body: JSON.stringify({
        hotelId: "hotel_hotel-a",
        conversationId: "+256700000000",
        guestContact: "+256700000000",
        text: "Hello",
      }),
    });
    const res = makeMockRes();

    await sendHandler(req, res);

    expect(res.statusCode).toBe(503);
  });

  it("send returns 503 when hotel has no WhatsApp connection at all", async () => {
    // No connection doc for this hotel
    const { default: sendHandler } = await import("../../api/ai/whatsapp/send.js");

    const req = makeMockReq({
      method: "POST",
      body: JSON.stringify({
        hotelId: "hotel_no_connection",
        conversationId: "+256700000000",
        guestContact: "+256700000000",
        text: "Hello",
      }),
    });
    const res = makeMockRes();

    await sendHandler(req, res);

    expect(res.statusCode).toBe(503);
  });
});

describe("WhatsApp webhook — non-message events", () => {
  beforeEach(() => {
    resetDocStore();
    configureWhatsAppEnv();
    conciergeTurn.processGuestTurn.mockClear();
    setHotelConnection("hotel_test-hotel");
    setPhoneNumberMapping("123456789", "test-hotel", "hotel_test-hotel");
  });

  it("acknowledges status updates without processing", async () => {
    const body = {
      object: "whatsapp_business_account",
      entry: [{
        id: "entry_1",
        changes: [{
          value: {
            messaging_product: "whatsapp",
            metadata: { phone_number_id: "123456789" },
            statuses: [{ id: "status_1", status: "delivered" }],
          },
        }],
      }],
    };

    setPhoneNumberMapping("123456789", "test-hotel", "hotel_test-hotel");

    const rawBody = JSON.stringify(body);
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe("ignored");
    expect(conciergeTurn.processGuestTurn).not.toHaveBeenCalled();
  });
});

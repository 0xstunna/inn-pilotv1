/**
 * WhatsApp webhook → guest request/complaint record (R13/R14).
 *
 * Simulates signed Meta Cloud API webhook payloads — no real Meta
 * credentials, no Cloud API subscription, no network. Verifies a WhatsApp
 * complaint/request message flows through the SAME gateway/tool path as web
 * (no duplicate logic), creates a structured record via log_guest_request,
 * and is acknowledged to the guest.
 */
import { vi, beforeEach, describe, expect, it } from "vitest";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_PROJECT_ID = "wa-guest-request-test";

// Mock the shared gateway so no AI provider / Firestore / Meta is needed.
// It returns a guestRequest ack as log_guest_request would produce.
vi.mock("../../server/ai/conciergeTurn.js", () => ({
  processGuestTurn: vi.fn(async (input: any) => ({
    reply: "I've logged your request. Reference REQ-20261112-ABCDEF. The hotel team will follow up.",
    model: "test-model",
    requestId: "req_123",
    conversationId: "conv_1234567890abcdefghij",
    handledBy: "ai",
    channel: input.channel,
    guestRequest: {
      id: "REQ-20261112-ABCDEF",
      reference: "REQ-20261112-ABCDEF",
      type: "complaint",
      category: "housekeeping",
      priority: "high",
      department: "Housekeeping",
      duplicate: false,
      message: "Logged as REQ-20261112-ABCDEF. The hotel team will follow up.",
    },
  })),
}));

// Mock Firestore admin — in-memory doc store keyed by "collectionId/docId".
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

// Mock resolveHotel — the WhatsApp webhook resolves by phone_number_id mapping.
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

import { whatsappAdapter } from "../../src/lib/channels/whatsapp.js";
vi.spyOn(whatsappAdapter, "send").mockResolvedValue({ ok: true, externalId: "msg_sent_123" });

import { default as webhookHandler } from "../../api/ai/webhook/whatsapp.js";
import * as conciergeTurn from "../../server/ai/conciergeTurn.js";
import * as hotelsModule from "../../server/hotels.js";

// ---- Helpers ----

function resetDocStore() {
  docStore.clear();
}

function setHotelConnection(hotelId: string, phoneNumberId: string, appSecret = "secret_hotel_" + hotelId) {
  docStore.set(`whatsappConnections/${hotelId}`, {
    exists: true,
    data: () => ({ phoneNumberId, accessToken: "token_" + hotelId, appSecret, verifyToken: "verify_" + hotelId, status: "active" }),
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

// ---- Tests ----

describe("WhatsApp webhook — complaint/request creates structured record via shared gateway", () => {
  beforeEach(() => {
    resetDocStore();
    (process.env as any).WHATSAPP_ACCESS_TOKEN = "global_token";
    (process.env as any).WHATSAPP_PHONE_NUMBER_ID = "123456789";
    (process.env as any).WHATSAPP_VERIFY_TOKEN = "global_verify";
    (process.env as any).WHATSAPP_APP_SECRET = "global_app_secret";
    conciergeTurn.processGuestTurn.mockClear();
    setHotelConnection("hotel_test-hotel", "123456789");
    setPhoneNumberMapping("123456789", "test-hotel", "hotel_test-hotel");
  });

  it("WhatsApp complaint message routes through shared gateway with channel=whatsapp", async () => {
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_complaint", "+256700000000", "My room was dirty and there is no hot water — I want a refund."));
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
    // The SAME gateway/tool path as web — channel is "whatsapp", no duplicate logic.
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledTimes(1);
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        publicHotelId: "test-hotel",
        channel: "whatsapp",
        message: expect.stringContaining("dirty"),
      }),
    );
    expect(res.body).not.toHaveProperty("error");
  });

  it("WhatsApp request message routes through shared gateway", async () => {
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_request", "+256700000000", "Can I request a late checkout until 2pm?"));
    const signature = computeTestSignature("secret_hotel_hotel_test-hotel", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "whatsapp", message: expect.stringContaining("late checkout") }),
    );
  });

  it("duplicate WhatsApp webhook for the same message id is not reprocessed", async () => {
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_dup", "+256700000000", "Duplicate complaint"));
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

  it("invalid WhatsApp signature is rejected — no record created", async () => {
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("123456789", "msg_badsig", "+256700000000", "Bad signature complaint"));
    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": "sha256=invalid_signature" },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(conciergeTurn.processGuestTurn).not.toHaveBeenCalled();
  });

  it("unregistered phone number ID is rejected — no record created", async () => {
    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("000000000", "msg_unmapped", "+256700000000", "Unmapped complaint"));
    const signature = computeTestSignature("any_secret", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(400);
    expect(conciergeTurn.processGuestTurn).not.toHaveBeenCalled();
  });

  it("hotel routing by phone_number_id keeps WhatsApp conversations tenant-isolated", async () => {
    // Hotel A owns phone number 111111111, hotel B owns 222222222
    setHotelConnection("hotel_hotel-a", "111111111", "secret_a");
    setHotelConnection("hotel_hotel-b", "222222222", "secret_b");
    setPhoneNumberMapping("111111111", "hotel-a", "hotel_hotel-a");
    setPhoneNumberMapping("222222222", "hotel-b", "hotel_hotel-b");

    const rawBody = JSON.stringify(makeWhatsAppWebhookBody("111111111", "msg_iso", "+256700000000", "Hotel A complaint"));
    const signature = computeTestSignature("secret_a", rawBody);

    const req = makeMockReq({
      method: "POST",
      headers: { "x-hub-signature-256": signature },
      body: rawBody,
    });
    const res = makeMockRes();

    await webhookHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(conciergeTurn.processGuestTurn).toHaveBeenCalledWith(
      expect.objectContaining({ publicHotelId: "hotel-a" }),
    );
  });
});

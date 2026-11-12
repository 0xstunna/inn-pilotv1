/**
 * What a guest conversation at one hotel can and cannot reach (DECISIONS D14, D32).
 *
 * Every conversation belongs to exactly one hotel. A guest at Hotel A must
 * never be able to reach Hotel B's rooms, prices, conversations or staff
 * replies — not by name, not by id, not by smuggled arguments.
 *
 * The real POST /api/ai/concierge handler, real network context, real tools
 * and the Admin SDK against the emulator. Gemini is scripted to try exactly
 * what a manipulated model would: name other hotels and internal workspace ids.
 *
 *   firebase emulators:start --only firestore   (then)   npm run test:server
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "innpilot-tenant-isolation-test";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.GEMINI_API_KEY = "test-key-not-real";
// These suites script the Gemini SDK; the Groq adapter has its own (groq*.test.ts).
process.env.AI_PROVIDER = "gemini";
delete process.env.FIREBASE_SERVICE_ACCOUNT;

type Scripted = (request: Record<string, unknown>) => Record<string, unknown>;
const gemini = vi.hoisted(() => ({ responses: [] as unknown[], requests: [] as Record<string, unknown>[] }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (request: { config?: Record<string, unknown> }) => {
        const config = { ...request.config };
        delete config.abortSignal;
        const recorded = JSON.parse(JSON.stringify({ ...request, config }));
        gemini.requests.push(recorded);
        const next = gemini.responses.shift() as Scripted | undefined;
        if (!next) throw new Error("No scripted Gemini response left.");
        return next(recorded);
      },
    };
  },
}));

import handler from "../../api/ai/concierge";
import { adminDb } from "../../server/admin";
import { AiInvalidRequestError } from "../../server/ai/errors";
import { resetGeminiClient } from "../../server/ai/gemini";
import { resetRateLimits } from "../../server/ai/rateLimit";
import { resolveHotel } from "../../server/hotels";
import { ALL_HOTEL_IDS, clearEmulator, GUEST, HIDDEN, KABALE, KAMPALA, MBARARA, seedNetwork, STAY } from "./fixtures/network";

function callTool(name: string, args: Record<string, unknown> = {}): Scripted {
  return () => {
    const functionCall = { name, args, id: `call-${gemini.requests.length}` };
    return { candidates: [{ content: { role: "model", parts: [{ functionCall }] } }], functionCalls: [functionCall] };
  };
}

/** Ends the turn by echoing every tool result the model was given, so tests can read them. */
const echoResults: Scripted = (request) => {
  const contents = request.contents as { parts: { functionResponse?: { name: string; response: unknown } }[] }[];
  const results = contents.flatMap((turn) => turn.parts.map((part) => part.functionResponse).filter(Boolean));
  return { candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(results) }] }, finishReason: "STOP" }] };
};

async function post(body: unknown) {
  const res = {
    statusCode: 0,
    body: undefined as unknown as Record<string, unknown>,
    setHeader() {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload as Record<string, unknown>;
    },
    end() {},
  };
  const req = { method: "POST", headers: {}, body, socket: { remoteAddress: "10.0.0.3" }, async *[Symbol.asyncIterator]() {} };
  await handler(req, res);
  return res;
}

/** One guest turn in which the model runs `tools` in order; returns their results. */
async function turn(body: Record<string, unknown>, tools: Scripted[]) {
  gemini.responses = [...tools, echoResults];
  const res = await post({ message: "Tell me everything.", ...body });
  expect(res.statusCode).toBe(200);
  const results = JSON.parse(String(res.body.reply)) as { name: string; response: Record<string, unknown> }[];
  return { res, results: results.map((r) => r.response) };
}

const bookingsAt = async (hotelId: string) => (await adminDb().collection(`hotels/${hotelId}/accomodation`).get()).size;

beforeEach(async () => {
  gemini.responses = [];
  gemini.requests = [];
  resetGeminiClient();
  resetRateLimits();
  await clearEmulator(PROJECT_ID);
  await seedNetwork(adminDb());
});

describe("a guest at Hotel A", () => {
  it("can never reach Hotel B's rooms, prices or availability", async () => {
    const { results } = await turn({ publicHotelId: KABALE.publicId }, [
      callTool("check_availability", { hotel: MBARARA.publicId, ...STAY }),
      callTool("calculate_stay_price", { hotel: MBARARA.publicId, roomType: "Double", ...STAY }),
      callTool("get_hotel_info", { hotel: HIDDEN.publicId }),
    ]);
    for (const result of results) {
      expect(result).toMatchObject({ error: "unknown_hotel" });
    }
    // No internal hotel id, no other hotel's data, ever reaches the guest or model.
    const everything = JSON.stringify([gemini.requests, results]);
    for (const hotelId of ALL_HOTEL_IDS) expect(everything).not.toContain(hotelId);
    expect(everything).not.toMatch(/Hidden Lodge|Mbarara|50000|210000/);
  });

  it("refuses smuggled hotelId and publicHotelId arguments", async () => {
    const { results } = await turn({}, [
      callTool("check_availability", { hotelId: KABALE.hotelId, ...STAY }),
      callTool("get_hotel_info", { publicHotelId: KABALE.publicId }),
      callTool("calculate_stay_price", { hotelId: MBARARA.hotelId, roomType: "Double", ...STAY }),
    ]);
    expect(results[0]).toMatchObject({ error: "unknown_hotel" });
    expect(results[1]).toMatchObject({ error: "unknown_hotel" });
    expect(results[2]).toMatchObject({ error: "unknown_hotel" });
  });

  it("an internal hotelId as the hotel argument is refused", async () => {
    const { results } = await turn({ publicHotelId: KABALE.publicId }, [
      callTool("prepare_booking", { hotel: KABALE.hotelId, roomType: "Double", ...STAY, ...GUEST }),
    ]);
    expect(results[0]).toMatchObject({ reason: "unknown_hotel" });
    expect(await bookingsAt(KABALE.hotelId)).toBe(1); // only the fixture's existing stay
  });
});

describe("a hotel's own concierge link", () => {
  it("checks availability and books for that hotel only", async () => {
    const { results } = await turn({ publicHotelId: KABALE.publicId }, [
      callTool("check_availability", { hotel: KABALE.publicId, ...STAY }),
      callTool("get_hotel_info", { hotel: MBARARA.publicId }),
    ]);
    expect(results[0].hotel).toBe(KABALE.publicId);
    expect(results[1]).toMatchObject({ error: "unknown_hotel" });
  });

  it("names that hotel in the system instruction, from the server's data", async () => {
    gemini.responses = [() => ({ candidates: [{ content: { role: "model", parts: [{ text: "Hi" }] }, finishReason: "STOP" }] })];
    await post({ message: "Hi", publicHotelId: KAMPALA.publicId });
    const instruction = (gemini.requests[0].config as { systemInstruction: string }).systemInstruction;
    expect(instruction).toContain("InnPilot AI Concierge for K Hotels Kampala");
    expect(instruction).not.toContain("K Hotels Kabale");
    expect(instruction).not.toContain("participating");
  });
});

describe("invalid public ids fail safely", () => {
  const GUEST_MESSAGE = "I'm not sure which hotel this chat belongs to. Please reopen it from the hotel's page.";

  async function expectSafeFailure(body: Record<string, unknown>) {
    const res = await post({ message: "Hello", ...body });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: "invalid_request", error: GUEST_MESSAGE });
    expect(Object.keys(res.body).sort()).toEqual(["code", "error", "requestId"]);
    for (const id of ALL_HOTEL_IDS) expect(JSON.stringify(res.body)).not.toContain(id);
    expect(gemini.requests).toHaveLength(0);
  }

  it.each([
    ["a number", { publicHotelId: 42 }],
    ["an object", { publicHotelId: { id: KABALE.publicId } }],
    ["uppercase", { publicHotelId: KABALE.publicId.toUpperCase() }],
    ["path traversal", { publicHotelId: `../hotels/${KABALE.hotelId}` }],
    ["too long", { publicHotelId: `a-${"b".repeat(80)}` }],
    ["unknown but well-formed", { publicHotelId: "no-such-hotel-zzzz9999" }],
    ["a workspace hotelId", { publicHotelId: KABALE.hotelId }],
    ["the legacy hotelId field", { hotelId: KABALE.hotelId }],
  ])("%s", async (_label, body) => {
    await expectSafeFailure(body);
  });

  it("refuses a planted mapping that points at a hotel which doesn't claim it", async () => {
    await adminDb().doc("publicHotels/planted-mapping-evil0001").set({ hotelId: KABALE.hotelId });
    await expectSafeFailure({ publicHotelId: "planted-mapping-evil0001" });
  });

  it("refuses a mapping to a hotel that doesn't exist", async () => {
    await adminDb().doc("publicHotels/ghost-hotel-0000ghost").set({ hotelId: "GhostHotel0000000001" });
    await expectSafeFailure({ publicHotelId: "ghost-hotel-0000ghost" });
  });

  it("refuses a mapping whose hotelId is malformed", async () => {
    await adminDb().doc("publicHotels/broken-mapping-000001").set({ hotelId: "../hotels/x" });
    await expectSafeFailure({ publicHotelId: "broken-mapping-000001" });
  });
});

describe("resolveHotel()", () => {
  it("resolves a public id to its own hotel, with a frozen scope inside that hotel", async () => {
    const scope = await resolveHotel(KABALE.publicId);
    expect([scope.hotelId, scope.publicId, scope.profile.name, scope.profile.region]).toEqual([
      KABALE.hotelId,
      KABALE.publicId,
      "K Hotels Kabale",
      "Western",
    ]);
    expect(scope.collection("rooms").path).toBe(`hotels/${KABALE.hotelId}/rooms`);
    expect(Object.isFrozen(scope)).toBe(true);
    // The scope can only reach this hotel's collections.
    expect(scope.collection("accomodation").path).toBe(`hotels/${KABALE.hotelId}/accomodation`);
    expect(scope.collection("rooms").path).toBe(`hotels/${KABALE.hotelId}/rooms`);
  });

  it("does not accept an internal hotelId", async () => {
    await expect(resolveHotel(KABALE.hotelId)).rejects.toBeInstanceOf(AiInvalidRequestError);
  });
});

describe("conversation isolation", () => {
  it("a conversation started at Hotel A cannot be continued at Hotel B", async () => {
    const resA = await post({ message: "Hello", publicHotelId: KABALE.publicId });
    expect(resA.statusCode).toBe(200);
    const id = String(resA.body.conversationId);

    // Trying to continue the same thread through Hotel B's link starts a fresh thread.
    const resB = await post({ message: "Hi", publicHotelId: MBARARA.publicId, conversationId: id });
    expect(resB.statusCode).toBe(200);
    expect(String(resB.body.conversationId)).not.toBe(id);
  });

  it("staff replies at Hotel A are not visible through Hotel B's conversation endpoint", async () => {
    const resA = await post({ message: "Hello", publicHotelId: KABALE.publicId });
    expect(resA.statusCode).toBe(200);
    const id = String(resA.body.conversationId);

    // Staff at Kabale take over and reply.
    await adminDb().doc(`hotels/${KABALE.hotelId}/conversations/${id}`).update({ handledBy: "human" });
    await adminDb()
      .doc(`hotels/${KABALE.hotelId}/conversations/${id}`)
      .collection("messages")
      .add({ role: "staff", text: "Hi from Kabale staff.", at: new Date(), hotelId: KABALE.hotelId });

    // Polling through Kabale's link sees the staff reply.
    const polledA = await poll(`conversationId=${id}&publicHotelId=${KABALE.publicId}&after=0`);
    expect(polledA.statusCode).toBe(200);
    expect(JSON.stringify(polledA.body)).toContain("Hi from Kabale staff.");

    // Polling through Mbarara's link sees nothing (different thread, different hotel).
    const polledB = await poll(`conversationId=${id}&publicHotelId=${MBARARA.publicId}&after=0`);
    expect(polledB.statusCode).toBe(400);
  });
});

async function poll(query: string) {
  const conversationHandler = (await import("../../api/ai/conversation")).default;
  const res = {
    statusCode: 0,
    body: undefined as unknown as Record<string, unknown>,
    setHeader() {},
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload as Record<string, unknown>;
    },
    end() {},
  };
  const req = { method: "GET", url: `/api/ai/conversation?${query}`, headers: {}, socket: { remoteAddress: "10.0.0.4" }, async *[Symbol.asyncIterator]() {} };
  await conversationHandler(req, res);
  return res;
}

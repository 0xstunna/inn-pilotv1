/**
 * POST /api/ai/concierge end to end, with Gemini scripted.
 *
 * The real handler, real network context, real tools, real conversation
 * record and the real Admin SDK against the Firestore emulator. Only the
 * model is a stand-in: the `@google/genai` client replays scripted responses
 * and records every request, so these tests assert exactly what the model
 * was sent and what landed in InnPilot — without a key or a network call.
 *
 * The first test is the challenge's golden path, turn by turn.
 *
 *   firebase emulators:start --only firestore   (then)   npm run test:server
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ID = "innpilot-concierge-api-test";
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
process.env.GEMINI_API_KEY = "test-key-not-real";
// These suites script the Gemini SDK; the Groq adapter has its own (groq*.test.ts).
process.env.AI_PROVIDER = "gemini";
delete process.env.FIREBASE_SERVICE_ACCOUNT;

type ScriptedResponse = Record<string, unknown>;
const gemini = vi.hoisted(() => ({
  /** "hang" never answers; "fail" throws a provider error. */
  responses: [] as (ScriptedResponse | "hang" | "fail" | ((request: Record<string, unknown>) => ScriptedResponse))[],
  requests: [] as Record<string, unknown>[],
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (request: { config?: Record<string, unknown> }) => {
        const config = { ...request.config };
        delete config.abortSignal;
        const recorded = JSON.parse(JSON.stringify({ ...request, config }));
        gemini.requests.push(recorded);
        const next = gemini.responses.shift();
        if (!next) throw new Error("No scripted Gemini response left.");
        if (next === "fail") throw Object.assign(new Error("upstream exploded"), { status: 500 });
        if (next === "hang") {
          const signal = request.config?.abortSignal as AbortSignal;
          return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
        }
        return typeof next === "function" ? next(recorded) : next;
      },
    };
  },
}));

import handler from "../../api/ai/concierge";
import conversationHandler from "../../api/ai/conversation";
import { adminDb } from "../../server/admin";
import { resetGeminiClient } from "../../server/ai/gemini";
import { resetRateLimits } from "../../server/ai/rateLimit";
import { HUMAN_HOLDING_REPLY } from "../../src/lib/conversations";
import { ALL_HOTEL_IDS, bookStay, clearEmulator, GUEST, KABALE, MBARARA, seedNetwork, STAY } from "./fixtures/network";

/** A model turn that asks for tools, the way the SDK surfaces it. */
function callTools(...calls: { name: string; args: Record<string, unknown> }[]): ScriptedResponse {
  const withIds = calls.map((call, index) => ({ ...call, id: `call-${gemini.requests.length}-${index}` }));
  return {
    candidates: [
      {
        content: {
          role: "model",
          parts: withIds.map((functionCall) => ({ functionCall, thoughtSignature: "opaque-signature" })),
        },
      },
    ],
    functionCalls: withIds,
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
  };
}

function answer(text: string): ScriptedResponse {
  return {
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 30 },
  };
}

/** The tool results the loop sent back in the given request. */
function functionResponses(request: Record<string, unknown>) {
  const contents = request.contents as { role: string; parts: Record<string, unknown>[] }[];
  const last = contents[contents.length - 1];
  return last.parts.map((part) => part.functionResponse as { name: string; response: Record<string, unknown> });
}

function fakeRes() {
  return {
    statusCode: 0,
    body: undefined as unknown as Record<string, unknown>,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload as Record<string, unknown>;
    },
    end() {},
  };
}

async function post(body: Record<string, unknown>) {
  const res = fakeRes();
  const req = { method: "POST", headers: {}, body, socket: { remoteAddress: "10.0.0.1" }, async *[Symbol.asyncIterator]() {} };
  await handler(req, res);
  return res;
}

async function poll(query: string) {
  const res = fakeRes();
  await conversationHandler(
    { method: "GET", url: `/api/ai/conversation?${query}`, headers: {}, socket: { remoteAddress: "10.0.0.2" }, async *[Symbol.asyncIterator]() {} },
    res
  );
  return res;
}

/** A tiny browser: keeps the transcript and conversation id like the page does. */
function guest(extra: Record<string, unknown> = {}) {
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let conversationId: string | undefined;
  return {
    get conversationId() {
      return conversationId;
    },
    async say(message: string) {
      const res = await post({ message, history: [...history], ...(conversationId ? { conversationId } : {}), ...extra });
      if (typeof res.body.conversationId === "string") conversationId = res.body.conversationId;
      if (res.statusCode === 200) history.push({ role: "user", content: message }, { role: "assistant", content: String(res.body.reply) });
      return res;
    },
  };
}

const kabaleDouble = { hotel: KABALE.publicId, roomType: "Double", ...STAY };
const mirror = (hotelId: string, id: string) => adminDb().doc(`hotels/${hotelId}/conversations/${id}`);
const canonical = (id: string) => adminDb().doc(`conciergeConversations/${id}`);
const bookingsBy = async (hotelId: string, guestName = GUEST.guestName) =>
  (await adminDb().collection(`hotels/${hotelId}/accomodation`).where("guestName", "==", guestName).get()).docs.map((d) => d.data());

beforeEach(async () => {
  gemini.responses = [];
  gemini.requests = [];
  resetGeminiClient();
  resetRateLimits();
  await clearEmulator(PROJECT_ID);
  await seedNetwork(adminDb());
});

describe("the golden path", () => {
  it("turns “a double room between 10th and 15th October” into a confirmed reservation staff can see", async () => {
    const browser = guest({ publicHotelId: KABALE.publicId });

    /* 1 — The request: the model checks this hotel's live availability. */
    gemini.responses = [
      callTools({ name: "check_availability", args: kabaleDouble }),
      (request) => {
        const [result] = functionResponses(request);
        const roomTypes = result.response.roomTypes as { roomType: string; stayTotal: number }[];
        return answer(`Here are ${roomTypes.length} available options: ${roomTypes.map((o) => `${o.roomType} ${o.stayTotal}`).join("; ")}`);
      },
    ];
    const t1 = await browser.say("I need a double room between 10th and 15th October.");

    expect(t1.statusCode).toBe(200);
    expect(t1.body.reply).toBe("Here are 2 available options: Double 900000; Family 1600000");
    expect(t1.body.availability).toMatchObject({
      hotel: KABALE.publicId,
      hotelName: "K Hotels Kabale",
      city: "Kabale",
      checkIn: "2031-10-10",
      checkOut: "2031-10-15",
      nights: 5,
      totalAvailable: 2,
      roomTypes: [
        { roomType: "Double", availableRooms: 1, capacity: 2, nightlyRate: 180000, stayTotal: 900000 },
        { roomType: "Family", availableRooms: 1, capacity: 4, nightlyRate: 320000, stayTotal: 1600000 },
      ],
    });
    const id = String(browser.conversationId);
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);

    // What the model was given: the concierge's identity and the six tools.
    const first = gemini.requests[0] as { config: { systemInstruction: string; tools: { functionDeclarations: { name: string }[] }[] } };
    expect(first.config.systemInstruction).toContain("You are InnPilot AI Concierge for K Hotels Kabale.");
    expect(first.config.tools[0].functionDeclarations.map((d) => d.name)).toEqual([
      "check_availability",
      "get_hotel_info",
      "calculate_stay_price",
      "prepare_booking",
      "create_reservation",
    ]);

    // This hotel's inbox has this guest as a quoted lead.
    expect((await mirror(KABALE.hotelId, id).get()).data()).toMatchObject({ channel: "web", bookingStatus: "quoted", selection: "this", messageCount: 2 });

    /* 2 — The choice: only the necessary details are asked for. */
    gemini.responses = [answer("Great choice. May I have your full name and phone number?")];
    const t2 = await browser.say("I'll take the first one.");
    expect(t2.body).not.toHaveProperty("availability");

    /* 3 — The details: availability and price re-checked, summary shown, nothing booked. */
    gemini.responses = [
      callTools({ name: "prepare_booking", args: { ...kabaleDouble, ...GUEST } }),
      answer("BOOKING SUMMARY … Would you like me to confirm this booking?"),
    ];
    const t3 = await browser.say("Amina Okello, +256 772 123 456");
    expect(t3.body.quote).toEqual({
      hotel: KABALE.publicId,
      hotelName: "K Hotels Kabale",
      city: "Kabale",
      roomType: "Double",
      checkIn: "2031-10-10",
      checkOut: "2031-10-15",
      nights: 5,
      numberOfGuests: 1,
      guestName: "Amina Okello",
      guestPhone: "+256 772 123 456",
      guestEmail: "",
      nightlyRate: 180000,
      totalPrice: 900000,
      currency: "UGX",
    });
    expect(t3.body).not.toHaveProperty("booking");
    expect(await bookingsBy(KABALE.hotelId)).toHaveLength(0);
    expect((await mirror(KABALE.hotelId, id).get()).data()).toMatchObject({ selection: "this", guestName: "Amina Okello" });

    /* 4 — Confirm: re-checked inside the transaction, booked, real reference. */
    gemini.responses = [
      callTools({ name: "create_reservation", args: { ...kabaleDouble, ...GUEST } }),
      (request) => {
        const [created] = functionResponses(request);
        const booking = created.response.booking as { reservationId: string };
        return answer(`Booking confirmed. Your reference is ${booking.reservationId}.`);
      },
    ];
    const t4 = await browser.say("Confirm.");

    expect(t4.statusCode).toBe(200);
    const booking = t4.body.booking as { reservationId: string };
    expect(booking).toMatchObject({
      reservationId: expect.stringMatching(/^RSV-\d{8}-[A-Z0-9]{6}$/),
      hotelName: "K Hotels Kabale",
      roomType: "Double",
      guestName: "Amina Okello",
      checkIn: "2031-10-10",
      checkOut: "2031-10-15",
      nights: 5,
      totalPrice: 900000,
      currency: "UGX",
      hotelPhone: "+256 700 100 201",
    });
    expect(t4.body.reply).toBe(`Booking confirmed. Your reference is ${booking.reservationId}.`);
    expect(t4.body).not.toHaveProperty("quote");

    /* 5 — Staff: the reservation is in the PMS and the conversation is Booked. */
    expect(await bookingsBy(KABALE.hotelId)).toEqual([
      expect.objectContaining({
        reservationId: booking.reservationId,
        source: "concierge",
        roomType: "Double",
        status: "Confirmed",
        quotedTotal: 900000,
        guestPhoneNumber: "+256 772 123 456",
      }),
    ]);
    expect((await mirror(KABALE.hotelId, id).get()).data()).toMatchObject({
      bookingStatus: "booked",
      reservationId: booking.reservationId,
      guestName: "Amina Okello",
      guestContact: "+256 772 123 456",
      bookedElsewhere: false,
      messageCount: 8,
      // Booked, and five nights is a long stay (D20).
      lead: { score: "vip" },
    });

    // The workspace key never reached the guest or the model at any point.
    const everything = JSON.stringify([t1.body, t2.body, t3.body, t4.body, gemini.requests]);
    for (const hotelId of ALL_HOTEL_IDS) expect(everything).not.toContain(hotelId);
  });
});

describe("booking safety", () => {
  async function summaryShown() {
    const browser = guest();
    gemini.responses = [callTools({ name: "prepare_booking", args: { ...kabaleDouble, ...GUEST } }), answer("Would you like me to confirm this booking?")];
    await browser.say("Book the Kabale double for Amina Okello, +256 772 123 456, 10-15 Oct 2031");
    return browser;
  }

  it("a model that prepares and books in the same turn books nothing", async () => {
    gemini.responses = [
      callTools({ name: "prepare_booking", args: { ...kabaleDouble, ...GUEST } }),
      callTools({ name: "create_reservation", args: { ...kabaleDouble, ...GUEST } }),
      (request) => answer(`Result: ${functionResponses(request)[0].response.reason}`),
    ];
    const res = await post({ message: "Yes, book the Kabale double for Amina Okello, +256 772 123 456" });
    expect(res.body.reply).toBe("Result: needs_confirmation");
    expect(res.body).not.toHaveProperty("booking");
    expect(res.body).toHaveProperty("quote");
    expect(await bookingsBy(KABALE.hotelId)).toHaveLength(0);
  });

  it("a model that books without a clear yes books nothing", async () => {
    const browser = await summaryShown();
    gemini.responses = [
      callTools({ name: "create_reservation", args: { ...kabaleDouble, ...GUEST } }),
      (request) => answer(`Result: ${functionResponses(request)[0].response.reason}`),
    ];
    const res = await browser.say("Hmm, how far is it from the lake?");
    expect(res.body.reply).toBe("Result: needs_confirmation");
    expect(await bookingsBy(KABALE.hotelId)).toHaveLength(0);
  });

  it("a room taken between the summary and the yes is not booked, and the guest is told", async () => {
    const browser = await summaryShown();
    await bookStay(adminDb(), KABALE.hotelId, "202", "2031-10-11", "2031-10-13");
    gemini.responses = [
      callTools({ name: "create_reservation", args: { ...kabaleDouble, ...GUEST } }),
      (request) => answer(`Result: ${functionResponses(request)[0].response.reason}`),
    ];
    const res = await browser.say("Yes, confirm");
    expect(res.body.reply).toBe("Result: no_longer_available");
    expect(res.body).not.toHaveProperty("booking");
    expect(await bookingsBy(KABALE.hotelId)).toHaveLength(0);
  });

  it("a booking made before the reply failed still reaches the guest", async () => {
    const browser = await summaryShown();
    gemini.responses = [callTools({ name: "create_reservation", args: { ...kabaleDouble, ...GUEST } }), "fail", "fail"];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await browser.say("Yes, confirm");
    error.mockRestore();

    expect(res.statusCode).toBe(503);
    expect(res.body.booking).toMatchObject({ reservationId: expect.stringMatching(/^RSV-/), hotelName: "K Hotels Kabale" });
    expect(await bookingsBy(KABALE.hotelId)).toHaveLength(1);
    expect((await mirror(KABALE.hotelId, String(res.body.conversationId)).get()).data()).toMatchObject({ bookingStatus: "booked" });
  });
});

describe("human handoff", () => {
  it("staff at one hotel take over: the AI stops, the guest is told, and staff replies reach the guest page", async () => {
    const browser = guest();
    gemini.responses = [callTools({ name: "check_availability", args: kabaleDouble }), answer("Here are some options.")];
    await browser.say("Rooms in Western Uganda 10-15 Oct 2031?");
    const id = String(browser.conversationId);

    // Mbarara's staff take the conversation over and reply, the way the inbox writes it.
    const at = new Date(Date.now() + 1000);
    await mirror(MBARARA.hotelId, id).update({ handledBy: "human" });
    await mirror(MBARARA.hotelId, id).collection("messages").add({ role: "staff", text: "Hi Amina, Ruth from Mbarara here.", at, hotelId: MBARARA.hotelId });
    gemini.requests = [];

    const res = await browser.say("Can I bring my dog?");
    expect(gemini.requests).toHaveLength(0);
    expect(res.body).toMatchObject({ reply: HUMAN_HOLDING_REPLY, handledBy: "human", model: "staff" });
    for (const hotelId of [KABALE.hotelId, MBARARA.hotelId]) {
      expect((await mirror(hotelId, id).get()).data()).toMatchObject({ lastMessage: { role: "ai", text: HUMAN_HOLDING_REPLY } });
    }

    const polled = await poll(`conversationId=${id}&after=0`);
    expect(polled.statusCode).toBe(200);
    expect(polled.body).toMatchObject({ handledBy: "human", messages: [{ role: "staff", text: "Hi Amina, Ruth from Mbarara here." }] });
    expect(JSON.stringify(polled.body)).not.toMatch(/NetMbarara|NetKabale/);

    // Handing back to the AI lets it answer again.
    await mirror(MBARARA.hotelId, id).update({ handledBy: "ai" });
    gemini.responses = [answer("I can't confirm the pet policy; the hotel team can.")];
    expect(await browser.say("And breakfast?")).toMatchObject({ body: { handledBy: "ai" } });
  });

  it("a scoped thread can't be continued through another hotel's link", async () => {
    const browser = guest(KABALE.publicId);
    gemini.responses = [answer("Hello!"), answer("Hi from Kabale")];
    await browser.say("Hi");
    const id = String(browser.conversationId);

    // Mbarara's link can't continue this thread.
    const scoped = await post({ message: "Hi", publicHotelId: MBARARA.publicId, conversationId: id });
    expect(scoped.body.conversationId).not.toBe(id);
  });
});

describe("the gateway", () => {
  it("answers without tools when none are needed, with no cards", async () => {
    gemini.responses = [answer("Hello! Where and when would you like to stay?")];
    const res = await post({ message: "Hi", publicHotelId: KABALE.publicId });
    expect(res.statusCode).toBe(200);
    expect(res.body.reply).toBe("Hello! Where and when would you like to stay?");
    for (const card of ["search", "availability", "quote", "booking"]) expect(res.body).not.toHaveProperty(card);
    // The thread is recorded in the one hotel's inbox.
    expect((await mirror(KABALE.hotelId, String(res.body.conversationId)).get()).data()).toMatchObject({ messageCount: 2 });
  });

  it("puts a guest who checks availability and finds nothing in the one hotel's inbox", async () => {
    gemini.responses = [
      callTools({ name: "check_availability", args: kabaleDouble }),
      (request) => answer("Nothing is free for those dates."),
    ];
    const res = await post({ message: "A room 10-15 Oct 2031", publicHotelId: KABALE.publicId });
    expect(res.body.reply).toContain("Nothing is free for those dates.");
    expect(res.body).not.toHaveProperty("availability");
  });

  it("stops a model that keeps calling tools, with a guest-safe error", async () => {
    gemini.responses = Array.from({ length: 10 }, () => callTools({ name: "get_hotel_info", args: { hotel: KABALE.publicId } }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ message: "Tell me about Kabale", publicHotelId: KABALE.publicId });
    error.mockRestore();
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("unavailable");
    expect(String(res.body.error)).not.toMatch(/gemini|tool/i);
    expect(gemini.requests).toHaveLength(6); // first call + MAX_TOOL_ROUNDS
  });

  it("gives a guest-safe error when Gemini fails, and still records the guest", async () => {
    gemini.responses = ["fail", "fail"];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ message: "Any rooms?", publicHotelId: KABALE.publicId });
    error.mockRestore();
    expect(res.statusCode).toBe(503);
    expect(String(res.body.error)).not.toMatch(/upstream|exploded|500/);
    expect((await canonical(String(res.body.conversationId)).get()).data()).toMatchObject({ messageCount: 1 });
  });

  it.each([
    ["no message", {}],
    ["an empty message", { message: "   " }],
    ["an oversized message", { message: "x".repeat(2001) }],
  ])("refuses %s before any model call", async (_label, body) => {
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    expect(gemini.requests).toHaveLength(0);
  });

  it("refuses a missing publicHotelId before any model call", async () => {
    const res = await post({ message: "Any rooms?" });
    expect(res.statusCode).toBe(400);
    expect(gemini.requests).toHaveLength(0);
  });

  it("refuses an unknown valid-format publicHotelId before any model call", async () => {
    const res = await post({ message: "Any rooms?", publicHotelId: "no-such-hotel-abc123" });
    expect(res.statusCode).toBe(400);
    expect(gemini.requests).toHaveLength(0);
  });

  it("logs where a turn's time went: resolution, each model call and each tool", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    gemini.responses = [callTools({ name: "check_availability", args: STAY }), answer("Here are some options.")];
    await post({ message: "Rooms 10-15 Oct 2031?", publicHotelId: KABALE.publicId });
    const ok = info.mock.calls.find((call) => call[0] === "[concierge] ok")?.[1] as { timing: Record<string, unknown> };
    info.mockRestore();
    expect(ok.timing).toMatchObject({
      totalMs: expect.any(Number),
      resolveMs: expect.any(Number),
      modelCalls: [
        { toolCallsRequested: 1, inputTokens: 100, outputTokens: 10 },
        { finishReason: "STOP", toolCallsRequested: 0 },
      ],
      toolCalls: [{ name: "check_availability", ms: expect.any(Number) }],
    });
  });

  describe("when Gemini is slower than the turn budget", () => {
    beforeEach(() => {
      process.env.GEMINI_TIMEOUT_MS = "1000";
    });
    afterEach(() => {
      delete process.env.GEMINI_TIMEOUT_MS;
    });

    it("gives the guest a safe 504 and keeps their conversation", async () => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      gemini.responses = ["hang"];
      const res = await post({ message: "Where are you?", publicHotelId: KABALE.publicId });
      error.mockRestore();
      expect(res.statusCode).toBe(504);
      expect(res.body).toEqual({
        error: "That took longer than expected and I had to stop waiting. Please try asking again.",
        code: "timeout",
        requestId: expect.any(String),
        conversationId: expect.stringMatching(/^[A-Za-z0-9]{20}$/),
      });
    });
  });
});

/**
 * server/ai/conciergeTurn unit tests — pure logic, no emulator, no network.
 *
 * Mocks the network context, thread, tools and model so we can assert the
 * turn-processing behaviour: human takeover, AI reply, tool result capture.
 * Every conversation is scoped to exactly one hotel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const networkMock = vi.hoisted(() => ({
  scopedPublicId: "test-hotel-public",
  scopedHotel: {
    hotelId: "test-hotel-id",
    publicId: "test-hotel-public",
    profile: { name: "Test Hotel", location: "Kampala", currency: "UGX", phone: "", email: "", country: "Uganda", region: "Central" },
    collection: () => null as any,
    runTransaction: async () => null as any,
    serverTimestamp: () => null as any,
  },
  resolve: vi.fn(),
}));

const threadMock = vi.hoisted(() => ({
  id: "conv_1234567890abcdefghij",
  exists: true,
  hotelId: "test-hotel-id",
  pendingBooking: null,
  scope: "test-hotel-public",
}));

const generateResult = vi.hoisted(() => ({
  text: "I can help with that.",
  model: "test-model",
  toolCalls: [] as string[],
}));
const generateMock = vi.hoisted(() => vi.fn(async (input: { executeTool?: (call: { name: string; args?: Record<string, unknown> }) => Promise<Record<string, unknown>> } | any) => {
  if (input.executeTool && generateResult.toolCalls.length > 0) {
    for (const toolName of generateResult.toolCalls) {
      await input.executeTool({ name: toolName, args: {} });
    }
  }
  return { ...generateResult };
}));

const recordGuestTurnMock = vi.fn();
const threadHandledByMock = vi.hoisted(() => vi.fn().mockResolvedValue("ai"));
const openGuestThreadMock = vi.fn();
const createNetworkContextMock = vi.fn();
const createToolboxMock = vi.hoisted(() => vi.fn(() => ({
  definitions: [],
  execute: async (call: { name: string; args?: Record<string, unknown> }) => {
    return { status: "ok" };
  },
})));

vi.mock("../../server/guestConversations.js", () => ({
  openGuestThread: async (...args: unknown[]) => {
    openGuestThreadMock(...args);
    return { ...threadMock };
  },
  recordGuestTurn: async (...args: unknown[]) => {
    recordGuestTurnMock(...args);
  },
  scopeForOne: async (...args: unknown[]) => {
    return {
      hotelId: "test-hotel-id",
      publicId: "test-hotel-public",
      profile: { name: "Test Hotel", location: "Kampala", currency: "UGX", phone: "", email: "", country: "Uganda", region: "Central" },
      collection: () => null as any,
      runTransaction: async () => null as any,
      serverTimestamp: () => null as any,
    };
  },
  threadHandledBy: threadHandledByMock,
}));

vi.mock("../../server/network.js", () => ({
  createNetworkContext: async (...args: unknown[]) => {
    createNetworkContextMock(...args);
    return networkMock;
  },
}));

vi.mock("../../server/ai/provider.js", () => ({
  generate: generateMock,
}));

vi.mock("../../server/ai/tools/index.js", () => ({
  createToolbox: createToolboxMock,
}));

import { processGuestTurn, type ProcessGuestTurnInput } from "../../server/ai/conciergeTurn";

beforeEach(() => {
  vi.resetAllMocks();
  networkMock.scopedPublicId = "test-hotel-public";
  networkMock.resolve.mockResolvedValue(null);
  threadMock.exists = true;
  threadMock.pendingBooking = null;
  generateResult.text = "I can help with that.";
  generateResult.model = "test-model";
  generateResult.toolCalls = [];
  threadHandledByMock.mockResolvedValue("ai");
  generateMock.mockClear();
  recordGuestTurnMock.mockClear();
  openGuestThreadMock.mockClear();
});

describe("processGuestTurn", () => {
  it("returns the AI reply and records the turn", async () => {
    const input: ProcessGuestTurnInput = {
      message: "I need a double room tonight",
      publicHotelId: "test-hotel-public",
      conversationId: undefined,
      turnId: undefined,
      history: [],
    };

    const output = await processGuestTurn(input);

    expect(output.reply).toBe("I can help with that.");
    expect(output.handledBy).toBe("ai");
    expect(output.conversationId).toBe("conv_1234567890abcdefghij");
    expect(openGuestThreadMock).toHaveBeenCalled();
    expect(recordGuestTurnMock).toHaveBeenCalled();
    expect(generateMock).toHaveBeenCalled();
  });

  it("returns the holding reply when staff have taken over", async () => {
    threadHandledByMock.mockResolvedValue("human");

    const input: ProcessGuestTurnInput = {
      message: "I need a room",
      publicHotelId: "test-hotel-public",
      conversationId: "existing_conv",
      turnId: undefined,
      history: [],
    };

    const output = await processGuestTurn(input);

    expect(output.handledBy).toBe("human");
    expect(recordGuestTurnMock).toHaveBeenCalled();
    // The AI model should NOT be called when staff are handling.
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("passes the channel to recordGuestTurn", async () => {
    const input: ProcessGuestTurnInput = {
      message: "I need a room",
      publicHotelId: "test-hotel-public",
      conversationId: undefined,
      turnId: undefined,
      history: [],
      channel: "whatsapp",
    };

    await processGuestTurn(input);

    const recordCall = recordGuestTurnMock.mock.calls[0][1];
    expect(recordCall.channel).toBe("whatsapp");
  });

  it("captures a booking result from create_reservation", async () => {
    generateResult.toolCalls = ["create_reservation"];

    const executeMock = vi.fn().mockResolvedValue({
      status: "confirmed",
      booking: {
        reservationId: "RSV-20261107-A1B2C3",
        hotel: "test-hotel",
        hotelName: "Test Hotel",
        city: "Kampala",
        hotelPhone: "+256 700 000000",
        hotelEmail: "info@test.hotel",
        roomType: "Double",
        checkIn: "2026-11-08",
        checkOut: "2026-11-10",
        nights: 2,
        numberOfGuests: 2,
        guestName: "John Doe",
        nightlyRate: 100000,
        totalPrice: 200000,
        currency: "UGX",
        paymentStatus: "Pending",
      },
    });
    createToolboxMock.mockReturnValueOnce({
      definitions: [],
      execute: executeMock,
    });

    const input: ProcessGuestTurnInput = {
      message: "Yes, confirm this booking.",
      publicHotelId: "test-hotel-public",
      conversationId: undefined,
      turnId: undefined,
      history: [],
    };

    const output = await processGuestTurn(input);

    expect(output.booking).toBeDefined();
    expect(output.booking?.reservationId).toBe("RSV-20261107-A1B2C3");
  });
});

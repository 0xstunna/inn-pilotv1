/**
 * Single-hotel scope: findHotel matches a reference to the one reachable
 * hotel by public id or exact name. No emulator, no network.
 */
import { describe, expect, it } from "vitest";
import { findHotel } from "../../server/network.js";
import type { HotelScope } from "../../server/hotels.js";

function scope(name: string, publicId: string, hotelId = "hotel_" + publicId): HotelScope {
  return {
    hotelId,
    publicId,
    profile: { name, location: "Kampala", currency: "UGX", phone: "", email: "", country: "Uganda", region: "Central" },
    collection: () => null as any,
    runTransaction: async () => null as any,
    serverTimestamp: () => null as any,
  } as unknown as HotelScope;
}

describe("findHotel", () => {
  const hotel = scope("K Hotels Kampala", "kampala-1");

  it("matches by public id", () => {
    expect(findHotel(hotel, "kampala-1")?.publicId).toBe("kampala-1");
  });

  it("matches by exact hotel name (case-insensitive)", () => {
    expect(findHotel(hotel, "k hotels kampala")?.publicId).toBe("kampala-1");
    expect(findHotel(hotel, "K HOTELS KAMPALA")?.publicId).toBe("kampala-1");
  });

  it("returns null for a different hotel's public id", () => {
    expect(findHotel(hotel, "nonexistent")).toBeNull();
  });

  it("returns null for empty or oversized reference", () => {
    expect(findHotel(hotel, "")).toBeNull();
    expect(findHotel(hotel, "x".repeat(121))).toBeNull();
  });

  it("returns null for another hotel's exact name", () => {
    const other = scope("K Hotels Kabale", "kabale-1");
    expect(findHotel(other, "K Hotels Kampala")).toBeNull();
  });
});

describe("createNetworkContext", () => {
  it("requires a publicHotelId — there is no network mode", async () => {
    const { createNetworkContext } = await import("../../server/network.js");
    await expect(createNetworkContext(undefined)).rejects.toThrow();
    await expect(createNetworkContext(null)).rejects.toThrow();
    await expect(createNetworkContext("")).rejects.toThrow();
    await expect(createNetworkContext(42)).rejects.toThrow();
  });
});

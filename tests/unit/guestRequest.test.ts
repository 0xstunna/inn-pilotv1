/**
 * Guest request / complaint domain (R13/R14): pure functions, no emulator.
 *   npm run test:unit
 */
import { describe, expect, it } from "vitest";

import {
  type GuestRequestCategory,
  defaultPriority,
  departmentFor,
  excerptOf,
  isValidStatusTransition,
  makeRequestId,
  validStatusTransitions,
} from "../../src/lib/guestRequest";

const REQUEST_ID = /^REQ-\d{8}-[A-HJ-NP-Z2-9]{6}$/;

describe("makeRequestId", () => {
  it("is REQ-YYYYMMDD-XXXXXX with unambiguous characters", () => {
    const id = makeRequestId();
    expect(id).toMatch(REQUEST_ID);
    const date = id.slice(4, 12);
    const today = new Date();
    const expected = `${today.getUTCFullYear()}${(today.getUTCMonth() + 1).toString().padStart(2, "0")}${today.getUTCDate().toString().padStart(2, "0")}`;
    expect(date).toBe(expected);
  });

  it("is unique across calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(makeRequestId());
    expect(ids.size).toBe(100);
  });
});

describe("validStatusTransitions", () => {
  it("lets new move to any forward state", () => {
    expect(validStatusTransitions("new")).toEqual([
      "acknowledged", "in_progress", "resolved", "closed",
    ]);
  });

  it("lets acknowledged move forward", () => {
    expect(validStatusTransitions("acknowledged")).toEqual([
      "in_progress", "resolved", "closed",
    ]);
  });

  it("lets in_progress resolve or close", () => {
    expect(validStatusTransitions("in_progress")).toEqual(["resolved", "closed"]);
  });

  it("lets resolved close", () => {
    expect(validStatusTransitions("resolved")).toEqual(["closed"]);
  });

  it("makes closed terminal", () => {
    expect(validStatusTransitions("closed")).toEqual([]);
  });
});

describe("isValidStatusTransition", () => {
  it("accepts forward moves", () => {
    expect(isValidStatusTransition("new", "acknowledged")).toBe(true);
    expect(isValidStatusTransition("new", "closed")).toBe(true);
    expect(isValidStatusTransition("in_progress", "resolved")).toBe(true);
  });

  it("rejects backward moves and closed reopening", () => {
    expect(isValidStatusTransition("acknowledged", "new")).toBe(false);
    expect(isValidStatusTransition("resolved", "in_progress")).toBe(false);
    expect(isValidStatusTransition("closed", "new")).toBe(false);
    expect(isValidStatusTransition("closed", "resolved")).toBe(false);
  });
});

describe("departmentFor", () => {
  const samples: Array<[GuestRequestCategory, string]> = [
    ["housekeeping", "Housekeeping"],
    ["maintenance", "Maintenance"],
    ["food_beverage", "Food & Beverage"],
    ["front_desk", "Front Desk"],
    ["noise", "Front Desk"],
    ["billing", "Accounts"],
    ["safety", "Management"],
    ["other", "Front Desk"],
  ];

  it("maps every category to a safe default department", () => {
    for (const [category, expected] of samples) {
      expect(departmentFor(category)).toBe(expected);
    }
  });
});

describe("defaultPriority", () => {
  it("marks safety urgent and billing high", () => {
    expect(defaultPriority("safety")).toBe("urgent");
    expect(defaultPriority("billing")).toBe("high");
    expect(defaultPriority("housekeeping")).toBe("normal");
  });
});

describe("excerptOf", () => {
  it("trims to the cap", () => {
    const long = "x".repeat(600);
    expect(excerptOf(long)!.length).toBe(500);
  });

  it("returns undefined for empty input", () => {
    expect(excerptOf("")).toBeUndefined();
    expect(excerptOf(undefined)).toBeUndefined();
  });

  it("trims whitespace", () => {
    expect(excerptOf("  dirty room  ")).toBe("dirty room");
  });
});

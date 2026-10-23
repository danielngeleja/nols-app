import { describe, expect, it } from "vitest";
import { bedsPerSellableUnit } from "./roomSpecBeds.js";

describe("bedsPerSellableUnit", () => {
  it("counts beds across a complete villa without changing its unit inventory", () => {
    expect(bedsPerSellableUnit({ bookingMode: "ENTIRE_UNIT", roomsCount: 1, beds: { twin: 2, full: 0, queen: 1, king: 1 } })).toBe(4);
  });

  it("supports legacy numeric room counts", () => {
    expect(bedsPerSellableUnit({ beds: 2 })).toBe(2);
    expect(bedsPerSellableUnit({ beds: { twin: 0, queen: 0 } })).toBe(1);
  });
});

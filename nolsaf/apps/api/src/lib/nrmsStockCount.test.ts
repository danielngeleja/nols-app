import { describe, expect, it } from "vitest";
import { DEFAULT_VARIANCE_TOLERANCES, lineVariance, stockFell, summarisePeriod, toleranceFor, withinTolerance } from "./nrmsStockCount.js";

describe("tolerance", () => {
  it("uses the owner's override, else the category default", () => {
    expect(toleranceFor("SPIRITS", { SPIRITS: 0.5 })).toBe(0.5);
    expect(toleranceFor("PRODUCE", { SPIRITS: 0.5 })).toBe(DEFAULT_VARIANCE_TOLERANCES.PRODUCE);
    expect(toleranceFor("UNKNOWN", null)).toBe(DEFAULT_VARIANCE_TOLERANCES.OTHER);
  });

  it("never forgives a whole missing bottle when few were expected", () => {
    // 1% of 48 beers is 0.48: rounded down, one missing bottle is outside.
    expect(withinTolerance({ expected: 48, variance: -1, tolerancePercent: 1, countStyle: "WHOLE" })).toBe(false);
    // 1% of 250 is 2.5 -> 2 bottles allowed.
    expect(withinTolerance({ expected: 250, variance: -2, tolerancePercent: 1, countStyle: "WHOLE" })).toBe(true);
    expect(withinTolerance({ expected: 250, variance: -3, tolerancePercent: 1, countStyle: "WHOLE" })).toBe(false);
  });

  it("lets weighed goods lose a little to trimming", () => {
    // 5% of 10 kg of produce is 500 g.
    expect(withinTolerance({ expected: 10000, variance: -450, tolerancePercent: 5, countStyle: "PARTIAL" })).toBe(true);
    expect(withinTolerance({ expected: 10000, variance: -600, tolerancePercent: 5, countStyle: "PARTIAL" })).toBe(false);
    expect(withinTolerance({ expected: 0, variance: 0, tolerancePercent: 0, countStyle: "WHOLE" })).toBe(true);
  });
});

describe("lineVariance", () => {
  it("values the gap at cost and at the menu price", () => {
    expect(lineVariance({ counted: 36, expected: 48, unitCost: 1700, unitSellPrice: 5000 })).toEqual({ varianceQuantity: -12, varianceCost: -20400, varianceSales: -60000 });
  });

  it("leaves selling value empty when nothing on the menu sells the good alone", () => {
    expect(lineVariance({ counted: 700, expected: 750, unitCost: 26.6667, unitSellPrice: null }).varianceSales).toBeNull();
  });
});

describe("the Kilimanjaro sentence", () => {
  it("rebuilds expected from the period and shows how far stock fell", () => {
    const breakdown = summarisePeriod(20, [
      { type: "RECEIPT", quantity: 50 },
      { type: "TRANSFER_OUT", quantity: -2 },
      { type: "SALE", quantity: -41 },
      { type: "SALE_REVERSAL", quantity: 1 },
      { type: "WASTAGE", quantity: -1 },
      { type: "COUNT_ADJUSTMENT", quantity: -5 }, // the previous count's own adjustment: already inside "opening"
    ]);
    expect(breakdown).toEqual({ opening: 20, received: 50, transferredIn: 0, transferredOut: 2, sold: 40, writtenOff: 1, expected: 27 });
    // Counted 16: sold 40 but the shelf lost 52 (20 + 50 - 2 - 16).
    expect(stockFell(breakdown, 16)).toBe(52);
  });

  it("treats the first opening balance as received when there is no earlier count", () => {
    const breakdown = summarisePeriod(0, [{ type: "OPENING_BALANCE", quantity: 24 }, { type: "SALE", quantity: -4 }]);
    expect(breakdown.received).toBe(24);
    expect(breakdown.expected).toBe(20);
  });
});

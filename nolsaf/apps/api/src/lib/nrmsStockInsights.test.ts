import { describe, expect, it } from "vitest";
import { breakfastSourceId, breakfastUsage, buildDigest, digestDue, isDeadStock, menuItemProfit, priceMovement, recipeCost } from "./nrmsStockInsights.js";
import { usageAccountKey } from "./nrmsStockLedger.js";

describe("menu item profit", () => {
  it("costs a recipe with its yield", () => {
    // 250 g of beef at 85% yield uses 294.118 g; at TZS 28 per g that is 8235.30.
    expect(recipeCost([{ quantity: 250, yieldPercent: 85, unitCost: 28 }, { quantity: 1, yieldPercent: 100, unitCost: 500 }])).toBeCloseTo(8735.3, 1);
  });

  it("flags an item sold below cost and a thin margin", () => {
    expect(menuItemProfit({ price: 5000, cost: 1700 })).toMatchObject({ profit: 3300, margin: 66, belowCost: false, lowMargin: false });
    expect(menuItemProfit({ price: 12000, cost: 8735.3 })).toMatchObject({ belowCost: false, lowMargin: true });
    expect(menuItemProfit({ price: 8000, cost: 8735.3 })).toMatchObject({ belowCost: true });
    expect(menuItemProfit({ price: 0, cost: 100 }).margin).toBeNull();
  });
});

describe("price movement", () => {
  const at = (day: string) => new Date(`${day}T08:00:00Z`);
  it("compares the latest price with the one before and the first", () => {
    expect(priceMovement([
      { unitCost: 1800, at: at("2026-09-20"), flag: "ABOVE_LAST" },
      { unitCost: 1600, at: at("2026-07-01") },
      { unitCost: 1700, at: at("2026-08-10") },
    ])).toEqual({ latest: 1800, previous: 1700, first: 1600, changePercent: 5.9, windowChangePercent: 12.5, receipts: 3, flagged: 1 });
    expect(priceMovement([{ unitCost: 1700, at: at("2026-08-10") }])).toMatchObject({ previous: null, changePercent: null, windowChangePercent: null });
    expect(priceMovement([])).toBeNull();
  });
});

describe("dead stock", () => {
  const now = new Date("2026-09-25T10:00:00Z");
  it("marks stock with no movement for the threshold", () => {
    expect(isDeadStock({ quantity: 6, lastMovedAt: new Date("2026-08-20T10:00:00Z"), days: 30, now })).toBe(true);
    expect(isDeadStock({ quantity: 6, lastMovedAt: new Date("2026-09-10T10:00:00Z"), days: 30, now })).toBe(false);
    expect(isDeadStock({ quantity: 0, lastMovedAt: null, days: 30, now })).toBe(false);
    expect(isDeadStock({ quantity: 2, lastMovedAt: null, days: 30, now })).toBe(true);
  });
});

describe("breakfast", () => {
  it("multiplies covers by the recipe and rounds whole goods up", () => {
    const style = (id: number) => (id === 1 ? "WHOLE" : "PARTIAL");
    expect(breakfastUsage(23, [{ stockItemId: 1, quantity: 1.5 }, { stockItemId: 2, quantity: 30 }], style)).toEqual([
      { stockItemId: 1, quantity: 35 },
      { stockItemId: 2, quantity: 690 },
    ]);
    expect(breakfastUsage(0, [{ stockItemId: 1, quantity: 2 }], style)).toEqual([]);
    expect(breakfastSourceId("2026-09-25")).toBe(20260925);
  });

  it("posts breakfast to cost of sales", () => {
    expect(usageAccountKey({ type: "BREAKFAST_SERVICE", totalCost: -5000, category: "DAIRY_EGGS" })).toBe("COGS_FOOD");
    expect(usageAccountKey({ type: "BREAKFAST_SERVICE", totalCost: -900, category: "SOFT_DRINKS" })).toBe("COGS_BEVERAGE");
  });
});

describe("digest", () => {
  it("is due once a day after 07:00 EAT, or once a week", () => {
    // 04:30 UTC is 07:30 EAT.
    const morning = new Date("2026-09-25T04:30:00Z");
    expect(digestDue({ frequency: "DAILY", lastSentAt: null, now: morning })).toBe(true);
    expect(digestDue({ frequency: "DAILY", lastSentAt: null, now: new Date("2026-09-25T03:00:00Z") })).toBe(false);
    expect(digestDue({ frequency: "DAILY", lastSentAt: new Date("2026-09-25T04:05:00Z"), now: morning })).toBe(false);
    expect(digestDue({ frequency: "DAILY", lastSentAt: new Date("2026-09-24T04:05:00Z"), now: morning })).toBe(true);
    expect(digestDue({ frequency: "WEEKLY", lastSentAt: new Date("2026-09-20T04:05:00Z"), now: morning })).toBe(false);
    expect(digestDue({ frequency: "WEEKLY", lastSentAt: new Date("2026-09-18T04:05:00Z"), now: morning })).toBe(true);
    expect(digestDue({ frequency: "OFF", lastSentAt: null, now: morning })).toBe(false);
  });

  it("puts the three worst losses first, in fixed wording", () => {
    const digest = buildDigest({
      currency: "TZS",
      variances: [
        { name: "Kilimanjaro", locationName: "Bar", varianceSales: -60000, varianceCost: -20400 },
        { name: "Konyagi", locationName: "Bar", varianceSales: -90000, varianceCost: -30000 },
        { name: "Tilapia", locationName: "Kitchen", varianceSales: 0, varianceCost: -12000 },
        { name: "Coke", locationName: "Bar", varianceSales: -2000, varianceCost: -600 },
        { name: "Water", locationName: "Bar", varianceSales: 5000, varianceCost: 1500 },
      ],
      priceJumps: [{ name: "Beef", supplierName: "Butchery", changePercent: 18 }],
      bigWriteOffs: [],
      lowWithoutOrder: [{ name: "Gin", locationName: "Bar" }],
      overduePayables: { total: 250000, suppliers: 1 },
    });
    expect(digest.lines.map((line) => line.kind)).toEqual(["VARIANCE", "VARIANCE", "VARIANCE", "PRICE", "REORDER", "PAYABLES"]);
    expect(digest.lines[0].text).toBe("Konyagi at Bar: short by TZS 90,000 at menu price on the last count.");
    expect(digest.lines[5].text).toBe("TZS 250,000 overdue to 1 supplier.");
    expect(digest.headline).toBe("6 things need your attention in stock.");
    expect(digest.lines.every((line) => !/—/.test(line.text))).toBe(true);
  });

  it("says so when there is nothing to report", () => {
    expect(buildDigest({ currency: "TZS", variances: [], priceJumps: [], bigWriteOffs: [], lowWithoutOrder: [], overduePayables: { total: 0, suppliers: 0 } }).lines).toEqual([]);
  });
});

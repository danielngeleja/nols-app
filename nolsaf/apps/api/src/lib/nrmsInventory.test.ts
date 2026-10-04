import { describe, expect, it } from "vitest";
import { StockError } from "./nrmsStock.js";
import {
  NRMS_STOCK_ALREADY_REVERSED,
  NRMS_STOCK_OPENING_EXISTS,
  NRMS_STOCK_REVERSAL_SHORT,
  averageCostAfterReversal,
  StockShortError,
  consumeOrderStock,
  issueStock,
  linkedAvailabilityPatch,
  placeStock,
  priceFlagFor,
  menuItemCoverable,
  nextAverageCost,
  perUnitConsumption,
  recipeConsumption,
  recordStockReceipt,
  reverseOrderStock,
  reverseStockReceipt,
} from "./nrmsInventory.js";

describe("recipe maths", () => {
  it("grosses consumption up for yield loss", () => {
    expect(perUnitConsumption({ quantity: 250, yieldPercent: 100 })).toBe(250);
    // 850 g usable from 1000 g bought: serving 850 g takes 1000 g off the shelf.
    expect(perUnitConsumption({ quantity: 850, yieldPercent: 85 })).toBe(1000);
    // A missing/zero yield means "no loss", never a divide by zero; out-of-range values clamp.
    expect(perUnitConsumption({ quantity: 10, yieldPercent: 0 })).toBe(10);
    expect(perUnitConsumption({ quantity: 10, yieldPercent: 250 })).toBe(10);
  });

  it("sums ingredients across order lines", () => {
    const need = recipeConsumption(
      [{ menuItemId: 1, quantity: 3 }, { menuItemId: 2, quantity: 2 }, { menuItemId: null, quantity: 5 }],
      [
        { menuItemId: 1, stockItemId: 10, quantity: 1, yieldPercent: 100 }, // beer
        { menuItemId: 2, stockItemId: 20, quantity: 25, yieldPercent: 100 }, // gin tot
        { menuItemId: 2, stockItemId: 30, quantity: 1, yieldPercent: 100 }, // tonic
      ],
    );
    expect(Object.fromEntries(need)).toEqual({ 10: 3, 20: 50, 30: 2 });
  });

  it("only WHOLE ingredients gate availability", () => {
    const recipe = [
      { stockItemId: 1, perUnit: 1, countStyle: "WHOLE" },
      { stockItemId: 2, perUnit: 25, countStyle: "PARTIAL" },
    ];
    expect(menuItemCoverable(recipe, new Map([[1, 1], [2, -40]]))).toBe(true);
    expect(menuItemCoverable(recipe, new Map([[1, 0], [2, 700]]))).toBe(false);
    expect(menuItemCoverable([{ stockItemId: 2, perUnit: 25, countStyle: "PARTIAL" }], new Map())).toBe(true);
  });
});

describe("average cost", () => {
  it("weights the new price by quantity", () => {
    // 20 bottles at 1,600 + 25 at 1,700
    expect(nextAverageCost({ onHand: 20, currentAverage: 1600, receivedQty: 25, receivedUnitCost: 1700 })).toBeCloseTo(1655.5556, 4);
  });

  it("takes the received price when there is nothing to average against", () => {
    expect(nextAverageCost({ onHand: 0, currentAverage: 1600, receivedQty: 10, receivedUnitCost: 1700 })).toBe(1700);
    expect(nextAverageCost({ onHand: -3, currentAverage: 1600, receivedQty: 10, receivedUnitCost: 1700 })).toBe(1700);
    // Converted stock carried at no known cost must not dilute the first real price.
    expect(nextAverageCost({ onHand: 20, currentAverage: 0, receivedQty: 25, receivedUnitCost: 1700 })).toBe(1700);
  });

  it("ignores a zero-cost receipt", () => {
    expect(nextAverageCost({ onHand: 20, currentAverage: 1600, receivedQty: 5, receivedUnitCost: 0 })).toBe(1600);
  });

  it("backs a reversed receipt out of the average", () => {
    const after = nextAverageCost({ onHand: 20, currentAverage: 1600, receivedQty: 25, receivedUnitCost: 1700 });
    expect(averageCostAfterReversal({ onHand: 45, currentAverage: after, reversedQty: 25, reversedUnitCost: 1700 })).toBeCloseTo(1600, 2);
    expect(averageCostAfterReversal({ onHand: 25, currentAverage: 1700, reversedQty: 25, reversedUnitCost: 1700 })).toBe(1700);
  });
});

// A small in-memory stand-in for the Prisma transaction client, covering only
// the calls nrmsInventory makes. Balances and movements are real rows so the
// tests assert on the ledger, not on mock call shapes.
function fakeTx(seed: {
  stockItems: Array<{ id: number; propertyId: number; name: string; countStyle: string; averageCost: number }>;
  recipeLines: Array<{ menuItemId: number; stockItemId: number; quantity: number; yieldPercent: number }>;
  menuItems: Array<{ id: number; outletId: number; status: string; inStock: boolean; stockAutoOut: boolean }>;
}) {
  const locations: any[] = [];
  const balances: any[] = [];
  const movements: any[] = [];
  const stockItems = seed.stockItems.map((row) => ({ ...row }));
  const menuItems = seed.menuItems.map((row) => ({ ...row }));
  const itemById = (id: number) => stockItems.find((row) => row.id === id)!;
  const matchesQty = (value: number, filter: any) => filter == null || (filter.gte == null || value >= filter.gte);
  const inList = (value: number, filter: any) => filter == null || (typeof filter === "number" ? value === filter : filter.in.includes(value));

  const tx: any = {
    $queryRaw: async () => [],
    nrmsStockLocation: {
      findUnique: async ({ where }: any) => locations.find((row) => (where.outletId != null ? row.outletId === where.outletId : row.id === where.id)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: locations.length + 1, ...data };
        locations.push(row);
        return row;
      },
    },
    nrmsStockBalance: {
      upsert: async ({ where, create }: any) => {
        const key = where.locationId_stockItemId;
        let row = balances.find((b) => b.locationId === key.locationId && b.stockItemId === key.stockItemId);
        if (!row) {
          row = { id: balances.length + 1, ...create };
          balances.push(row);
        }
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const rows = balances.filter((b) => b.id === where.id && matchesQty(b.quantity, where.quantity));
        rows.forEach((b) => { b.quantity = Math.round((b.quantity + data.quantity.increment) * 1000) / 1000; });
        return { count: rows.length };
      },
      update: async ({ where, data }: any) => {
        const row = balances.find((b) => b.id === where.id);
        row.quantity = Math.round((row.quantity + data.quantity.increment) * 1000) / 1000;
        return row;
      },
      findMany: async ({ where }: any) => balances.filter((b) => b.locationId === where.locationId && inList(b.stockItemId, where.stockItemId)),
      aggregate: async ({ where }: any) => ({ _sum: { quantity: balances.filter((b) => b.stockItemId === where.stockItemId).reduce((s, b) => s + b.quantity, 0) } }),
    },
    nrmsStockMovement: {
      create: async ({ data }: any) => {
        const row = { id: movements.length + 1, ...data };
        movements.push(row);
        return row;
      },
      findMany: async ({ where }: any) => movements.filter((m) => m.sourceType === where.sourceType && m.sourceId === where.sourceId && m.type === where.type),
      findUnique: async ({ where }: any) => movements.find((m) => m.id === where.id) ?? null,
      count: async ({ where }: any) => movements.filter((m) => Object.entries(where).every(([key, value]) => m[key] === value)).length,
    },
    nrmsStockItem: {
      findUnique: async ({ where }: any) => itemById(where.id) ?? null,
      update: async ({ where, data }: any) => Object.assign(itemById(where.id), data),
    },
    nrmsMenuRecipeLine: {
      findMany: async ({ where }: any) => seed.recipeLines
        .filter((line) => (where.menuItemId.in ? where.menuItemId.in.includes(line.menuItemId) : line.menuItemId === where.menuItemId))
        .map((line) => ({ ...line, stockItem: itemById(line.stockItemId) })),
    },
    nrmsMenuItem: {
      findMany: async ({ where }: any) => menuItems
        .filter((item) => item.outletId === where.outletId && item.status === where.status)
        .map((item) => ({ ...item, recipeLines: seed.recipeLines.filter((line) => line.menuItemId === item.id).map((line) => ({ ...line, stockItem: itemById(line.stockItemId) })) }))
        .filter((item) => item.recipeLines.some((line) => where.recipeLines.some.stockItemId.in.includes(line.stockItemId))),
      update: async ({ where, data }: any) => Object.assign(menuItems.find((item) => item.id === where.id)!, data),
    },
  };
  return { tx, locations, balances, movements, stockItems, menuItems };
}

const OUTLET = { id: 7, propertyId: 1, name: "Pool bar" };

function barSetup() {
  return fakeTx({
    stockItems: [
      { id: 10, propertyId: 1, name: "Kilimanjaro Lager", countStyle: "WHOLE", averageCost: 1700 },
      { id: 20, propertyId: 1, name: "Konyagi 750 ml", countStyle: "PARTIAL", averageCost: 20 },
    ],
    recipeLines: [
      { menuItemId: 1, stockItemId: 10, quantity: 1, yieldPercent: 100 },
      { menuItemId: 2, stockItemId: 20, quantity: 25, yieldPercent: 100 },
    ],
    menuItems: [
      { id: 1, outletId: 7, status: "ACTIVE", inStock: true, stockAutoOut: false },
      { id: 2, outletId: 7, status: "ACTIVE", inStock: true, stockAutoOut: false },
    ],
  });
}

async function receive(tx: any, stockItemId: number, quantity: number, unitCost: number) {
  const location = (await tx.nrmsStockLocation.findUnique({ where: { outletId: 7 } })) ?? await tx.nrmsStockLocation.create({ data: { propertyId: 1, kind: "OUTLET", outletId: 7, name: "Pool bar" } });
  return recordStockReceipt(tx, { propertyId: 1, location, stockItemId, quantity, unitCost, actorId: 99 });
}

describe("order consumption", () => {
  it("takes recipe ingredients off the outlet shelf and writes SALE rows at average cost", async () => {
    const { tx, balances, movements } = barSetup();
    await receive(tx, 10, 24, 1700);
    await consumeOrderStock(tx, { propertyId: 1, outlet: OUTLET, orderId: 500, items: [{ menuItemId: 1, quantity: 3, nameSnapshot: "Kilimanjaro" }], actorId: 5 });
    expect(balances.find((b) => b.stockItemId === 10).quantity).toBe(21);
    const sale = movements.find((m) => m.type === "SALE");
    expect(sale).toMatchObject({ quantity: -3, unitCost: 1700, totalCost: -5100, sourceType: "OUTLET_ORDER", sourceId: 500 });
  });

  it("refuses to sell a WHOLE item the shelf does not have, naming the dish", async () => {
    const { tx, balances, movements } = barSetup();
    await receive(tx, 10, 2, 1700);
    await expect(consumeOrderStock(tx, { propertyId: 1, outlet: OUTLET, orderId: 501, items: [{ menuItemId: 1, quantity: 3, nameSnapshot: "Kilimanjaro" }] }))
      .rejects.toMatchObject({ name: "StockError", itemName: "Kilimanjaro" });
    expect(balances.find((b) => b.stockItemId === 10).quantity).toBe(2);
    expect(movements.filter((m) => m.type === "SALE")).toHaveLength(0);
  });

  it("lets a PARTIAL item go below zero instead of stopping service", async () => {
    const { tx, balances } = barSetup();
    await receive(tx, 20, 30, 20);
    await consumeOrderStock(tx, { propertyId: 1, outlet: OUTLET, orderId: 502, items: [{ menuItemId: 2, quantity: 2, nameSnapshot: "Konyagi single" }] });
    expect(balances.find((b) => b.stockItemId === 20).quantity).toBe(-20);
  });

  it("switches a dish off when its last bottle sells, and a receipt switches it back on", async () => {
    const { tx, menuItems } = barSetup();
    await receive(tx, 10, 1, 1700);
    await consumeOrderStock(tx, { propertyId: 1, outlet: OUTLET, orderId: 503, items: [{ menuItemId: 1, quantity: 1 }] });
    expect(menuItems.find((m) => m.id === 1)).toMatchObject({ inStock: false, stockAutoOut: true });
    await receive(tx, 10, 12, 1700);
    expect(menuItems.find((m) => m.id === 1)).toMatchObject({ inStock: true, stockAutoOut: false });
  });

  it("never switches back on an item a person turned off", async () => {
    const { tx, menuItems } = barSetup();
    menuItems.find((m) => m.id === 1)!.inStock = false; // manual 86, stockAutoOut stays false
    await receive(tx, 10, 12, 1700);
    expect(menuItems.find((m) => m.id === 1)!.inStock).toBe(false);
  });

  it("ignores menu items that have no recipe", async () => {
    const { tx, movements } = barSetup();
    await consumeOrderStock(tx, { propertyId: 1, outlet: OUTLET, orderId: 504, items: [{ menuItemId: 99, quantity: 4 }] });
    expect(movements).toHaveLength(0);
  });
});

describe("order cancellation", () => {
  it("gives the goods back once, at the cost they left at", async () => {
    const { tx, balances, movements } = barSetup();
    await receive(tx, 10, 10, 1700);
    await consumeOrderStock(tx, { propertyId: 1, outlet: OUTLET, orderId: 600, items: [{ menuItemId: 1, quantity: 4 }] });
    await reverseOrderStock(tx, { orderId: 600, actorId: 5 });
    await reverseOrderStock(tx, { orderId: 600, actorId: 5 }); // retried cancel
    expect(balances.find((b) => b.stockItemId === 10).quantity).toBe(10);
    const reversals = movements.filter((m) => m.type === "SALE_REVERSAL");
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({ quantity: 4, unitCost: 1700 });
  });
});

describe("receipts", () => {
  it("allows one opening balance per item and outlet", async () => {
    const { tx } = barSetup();
    const location = await tx.nrmsStockLocation.create({ data: { propertyId: 1, kind: "OUTLET", outletId: 7, name: "Pool bar" } });
    await recordStockReceipt(tx, { propertyId: 1, location, stockItemId: 10, quantity: 24, unitCost: 1700, actorId: 1, type: "OPENING_BALANCE" });
    await expect(recordStockReceipt(tx, { propertyId: 1, location, stockItemId: 10, quantity: 5, unitCost: 1700, actorId: 1, type: "OPENING_BALANCE" }))
      .rejects.toThrow(NRMS_STOCK_OPENING_EXISTS);
  });

  it("updates the average cost across receipts", async () => {
    const { tx, stockItems } = barSetup();
    stockItems[0].averageCost = 0;
    await receive(tx, 10, 20, 1600);
    await receive(tx, 10, 25, 1700);
    expect(stockItems[0].averageCost).toBeCloseTo(1655.5556, 4);
  });

  it("reverses a mistaken receipt once, and not below what was already sold", async () => {
    const { tx, balances } = barSetup();
    const typo = await receive(tx, 10, 100, 1700);
    await reverseStockReceipt(tx, { propertyId: 1, movementId: typo.id, reason: "Typed 100 for 10", actorId: 1 });
    expect(balances.find((b) => b.stockItemId === 10).quantity).toBe(0);
    await expect(reverseStockReceipt(tx, { propertyId: 1, movementId: typo.id, reason: "again", actorId: 1 })).rejects.toThrow(NRMS_STOCK_ALREADY_REVERSED);

    const real = await receive(tx, 10, 10, 1700);
    await consumeOrderStock(tx, { propertyId: 1, outlet: OUTLET, orderId: 700, items: [{ menuItemId: 1, quantity: 4 }] });
    await expect(reverseStockReceipt(tx, { propertyId: 1, movementId: real.id, reason: "wrong", actorId: 1 })).rejects.toThrow(NRMS_STOCK_REVERSAL_SHORT);
  });
});

describe("linkedAvailabilityPatch", () => {
  it("returns null for a menu item without a recipe", async () => {
    const { tx } = barSetup();
    expect(await linkedAvailabilityPatch(tx, { id: 99, outletId: 7 }, { inStock: true })).toBeNull();
  });

  it("refuses a typed quantity and a switch-on while the shelf is empty", async () => {
    const { tx } = barSetup();
    expect((await linkedAvailabilityPatch(tx, { id: 1, outletId: 7 }, { stockQuantity: 5 }))?.error).toMatch(/Stock page/);
    expect((await linkedAvailabilityPatch(tx, { id: 1, outletId: 7 }, { inStock: true }))?.error).toMatch(/out of stock/);
    await receive(tx, 10, 3, 1700);
    expect(await linkedAvailabilityPatch(tx, { id: 1, outletId: 7 }, { inStock: true })).toEqual({ data: { inStock: true, stockAutoOut: false } });
  });
});

// Kept so the import is exercised: the error class is the contract both order routes catch.
it("uses the shared StockError class", () => {
  expect(new StockError("x")).toBeInstanceOf(Error);
});

describe("priceFlagFor", () => {
  it("prefers the agreed price and allows the alert margin", () => {
    expect(priceFlagFor({ unitCost: 1800, lastUnitCost: 1500, agreedUnitCost: 1700, alertPercent: 10 })).toEqual({ flag: "NONE", compared: 1700 });
    expect(priceFlagFor({ unitCost: 1900, lastUnitCost: 1500, agreedUnitCost: 1700, alertPercent: 10 })).toEqual({ flag: "ABOVE_AGREED", compared: 1700 });
  });

  it("falls back to the last price, and flags nothing without history", () => {
    expect(priceFlagFor({ unitCost: 1700, lastUnitCost: 1500, agreedUnitCost: null, alertPercent: 10 }).flag).toBe("ABOVE_LAST");
    expect(priceFlagFor({ unitCost: 99999, lastUnitCost: null, agreedUnitCost: null, alertPercent: 10 })).toEqual({ flag: "NONE", compared: null });
  });
});

describe("transfers and write-offs", () => {
  it("sends from one shelf at average cost and lands only what arrived on the other", async () => {
    const { tx, balances, movements } = barSetup();
    await receive(tx, 10, 24, 1700); // bar location 1
    const kitchen = await tx.nrmsStockLocation.create({ data: { propertyId: 1, kind: "OUTLET", outletId: 8, name: "Kitchen" } });
    const sent = await issueStock(tx, { propertyId: 1, locationId: 1, stockItemId: 10, quantity: 10, type: "TRANSFER_OUT", sourceType: "STOCK_TRANSFER", sourceId: 900, actorId: 3 });
    expect(sent.unitCost).toBe(1700);
    await placeStock(tx, { propertyId: 1, locationId: kitchen.id, stockItemId: 10, quantity: 9, unitCost: sent.unitCost, type: "TRANSFER_IN", sourceType: "STOCK_TRANSFER", sourceId: 900, actorId: 4 });
    expect(balances.find((b) => b.locationId === 1 && b.stockItemId === 10).quantity).toBe(14);
    expect(balances.find((b) => b.locationId === kitchen.id && b.stockItemId === 10).quantity).toBe(9);
    expect(movements.filter((m) => m.sourceId === 900).map((m) => [m.type, m.quantity])).toEqual([["TRANSFER_OUT", -10], ["TRANSFER_IN", 9]]);
  });

  it("refuses to write off more whole units than the shelf holds", async () => {
    const { tx, balances } = barSetup();
    await receive(tx, 10, 2, 1700);
    await expect(issueStock(tx, { propertyId: 1, locationId: 1, stockItemId: 10, quantity: 3, type: "WASTAGE", sourceType: "STOCK_WRITE_OFF", sourceId: 1, actorId: 3 }))
      .rejects.toBeInstanceOf(StockShortError);
    expect(balances.find((b) => b.stockItemId === 10).quantity).toBe(2);
  });

  it("switches a dish off when wastage empties the shelf", async () => {
    const { tx, menuItems } = barSetup();
    await receive(tx, 10, 1, 1700);
    await issueStock(tx, { propertyId: 1, locationId: 1, stockItemId: 10, quantity: 1, type: "WASTAGE", sourceType: "STOCK_WRITE_OFF", sourceId: 2, actorId: 3 });
    expect(menuItems.find((m) => m.id === 1)).toMatchObject({ inStock: false, stockAutoOut: true });
  });
});

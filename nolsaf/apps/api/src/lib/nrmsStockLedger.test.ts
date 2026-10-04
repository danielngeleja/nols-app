import { describe, expect, it } from "vitest";
import { buildStockPostings, receiptEntries, usageAccountKey, usageEntries } from "./nrmsStockLedger.js";

function balanced(entries: Array<{ debit: number; credit: number }>) {
  const debit = entries.reduce((sum, entry) => sum + entry.debit, 0);
  const credit = entries.reduce((sum, entry) => sum + entry.credit, 0);
  return Math.round(debit * 100) === Math.round(credit * 100);
}

describe("usage accounts", () => {
  it("splits cost of sales into drinks and food", () => {
    expect(usageAccountKey({ type: "SALE", totalCost: -1700, category: "BEER" })).toBe("COGS_BEVERAGE");
    expect(usageAccountKey({ type: "SALE", totalCost: -9000, category: "FISH_SEAFOOD" })).toBe("COGS_FOOD");
    expect(usageAccountKey({ type: "TRANSFER_OUT", totalCost: -1700, category: "BEER" })).toBeNull();
    expect(usageAccountKey({ type: "RECEIPT", totalCost: 1700, category: "BEER" })).toBeNull();
    expect(usageAccountKey({ type: "RECEIPT", totalCost: 1700, category: "BEER", plainReceipt: true })).toBe("OPENING");
  });

  it("posts a balanced day of sales, losses and a count gain", () => {
    const entries = usageEntries([
      { type: "SALE", totalCost: -34_000, category: "BEER" },
      { type: "SALE_REVERSAL", totalCost: 1_700, category: "BEER" },
      { type: "SALE", totalCost: -18_000, category: "MEAT" },
      { type: "WASTAGE", totalCost: -3_400, category: "BEER" },
      { type: "COUNT_ADJUSTMENT", totalCost: -5_100, category: "SPIRITS" },
      { type: "COUNT_ADJUSTMENT", totalCost: 1_700, category: "BEER" },
      { type: "TRANSFER_OUT", totalCost: -17_000, category: "BEER" },
      { type: "TRANSFER_IN", totalCost: 17_000, category: "BEER" },
    ]);
    const byCode = Object.fromEntries(entries.map((entry) => [entry.accountCode, entry]));
    expect(byCode["5010"]).toMatchObject({ debit: 32_300, credit: 0 });
    expect(byCode["5020"]).toMatchObject({ debit: 18_000, credit: 0 });
    expect(byCode["5030"]).toMatchObject({ debit: 3_400 });
    expect(byCode["5060"]).toMatchObject({ debit: 3_400 });
    expect(byCode["1200"]).toMatchObject({ debit: 0, credit: 57_100 });
    expect(balanced(entries)).toBe(true);
  });

  it("credits cost of sales when more came back than was sold", () => {
    const entries = usageEntries([
      { type: "SALE", totalCost: -1_700, category: "BEER" },
      { type: "SALE_REVERSAL", totalCost: 3_400, category: "BEER" },
    ]);
    expect(entries.find((entry) => entry.accountCode === "5010")).toMatchObject({ debit: 0, credit: 1_700 });
    expect(entries.find((entry) => entry.accountCode === "1200")).toMatchObject({ debit: 1_700, credit: 0 });
  });

  it("posts opening counts to equity, not to cost", () => {
    const entries = usageEntries([{ type: "OPENING_BALANCE", totalCost: 120_000, category: "BEER" }]);
    expect(entries).toEqual([
      expect.objectContaining({ accountCode: "3900", debit: 0, credit: 120_000 }),
      expect.objectContaining({ accountCode: "1200", debit: 120_000, credit: 0 }),
    ]);
  });
});

describe("receiptEntries", () => {
  it("credits the payable for goods on credit and the till for goods paid", () => {
    expect(receiptEntries({ totalCost: 425_000, paymentMode: "CREDIT", paymentMethod: null }, false).map((entry) => [entry.accountCode, entry.debit, entry.credit]))
      .toEqual([["1200", 425_000, 0], ["2400", 0, 425_000]]);
    expect(receiptEntries({ totalCost: 150_000, paymentMode: "PAID", paymentMethod: "CASH" }, false).map((entry) => [entry.accountCode, entry.debit, entry.credit]))
      .toEqual([["1200", 150_000, 0], ["1000", 0, 150_000]]);
    expect(receiptEntries({ totalCost: 150_000, paymentMode: "PAID", paymentMethod: "MOBILE_MONEY" }, true).map((entry) => [entry.accountCode, entry.debit, entry.credit]))
      .toEqual([["1010", 150_000, 0], ["1200", 0, 150_000]]);
  });
});

describe("buildStockPostings", () => {
  it("posts each delivery once, one usage line, transit losses, and returns every movement to stamp", async () => {
    const movements = [
      { id: 1, type: "RECEIPT", totalCost: 400_000, sourceType: "GOODS_RECEIPT", sourceId: 7, createdAt: new Date(), stockItem: { category: "BEER" } },
      { id: 2, type: "RECEIPT", totalCost: 25_000, sourceType: "GOODS_RECEIPT", sourceId: 7, createdAt: new Date(), stockItem: { category: "BEER" } },
      { id: 3, type: "SALE", totalCost: -1_700, sourceType: "OUTLET_ORDER", sourceId: 90, createdAt: new Date(), stockItem: { category: "BEER" } },
      { id: 4, type: "RECEIPT_REVERSAL", totalCost: -9_000, sourceType: "STOCK_MOVEMENT", sourceId: 55, createdAt: new Date(), stockItem: { category: "FISH_SEAFOOD" } },
      { id: 5, type: "TRANSFER_OUT", totalCost: -17_000, sourceType: "STOCK_TRANSFER", sourceId: 3, createdAt: new Date(), stockItem: { category: "BEER" } },
    ];
    const tx = {
      nrmsStockMovement: {
        findMany: async (args: any) => (args.where.ledgerRunId === null ? movements : [{ id: 55, sourceType: "GOODS_RECEIPT", sourceId: 8 }]),
      },
      nrmsStockTransfer: { findMany: async () => [{ id: 3, transferNumber: "TRF-1", receivedAt: new Date(), lines: [{ quantitySent: 10, quantityReceived: 9, unitCost: 1700 }] }] },
      nrmsGoodsReceipt: {
        findMany: async () => [
          { id: 7, receiptNumber: "GRN-7", totalCost: 425_000, paymentMode: "CREDIT", paymentMethod: null, receivedAt: new Date(), decidedAt: null, voidedAt: null, supplier: { name: "Mlimani" } },
          { id: 8, receiptNumber: "GRN-8", totalCost: 9_000, paymentMode: "PAID", paymentMethod: "CASH", receivedAt: new Date(), decidedAt: null, voidedAt: new Date(), supplier: null },
        ],
      },
    };
    const result = await buildStockPostings(tx, { propertyId: 1, reportNumber: "NA-1", currency: "TZS", occurredAt: new Date(), closeBoundary: new Date(), window: { start: new Date(0), end: new Date() } });
    expect(result.movementIds).toEqual([1, 2, 3, 4, 5]);
    expect(result.postings.map((posting) => posting.sourceKey).sort()).toEqual(["STOCK_GRN:1:7", "STOCK_GRN_VOID:1:8", "STOCK_TRANSFER_LOSS:1:3", "STOCK_USAGE:1:NA-1"]);
    for (const posting of result.postings) expect(balanced(posting.entries)).toBe(true);
    const loss = result.postings.find((posting) => posting.sourceType === "STOCK_TRANSFER_LOSS")!;
    expect(loss.entries[0]).toMatchObject({ accountCode: "5060", debit: 1_700 });
  });
});

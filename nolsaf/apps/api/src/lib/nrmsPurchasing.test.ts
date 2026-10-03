import { describe, expect, it } from "vitest";
import {
  internationalPhone,
  orderNeedsOwner,
  overDeliveryCeiling,
  pickPack,
  requisitionStatus,
  statusAfterReceipt,
  suggestReorder,
  supplierMessage,
} from "./nrmsPurchasing.js";

const crate = { name: "Crate", baseQuantity: 24 };
const single = { name: "Bottle", baseQuantity: 1 };

describe("suggestReorder", () => {
  it("orders up to par in whole packs", () => {
    // Par 96, 25 on the shelf: 71 short, which is 3 crates (72 bottles).
    expect(suggestReorder({ onHand: 25, parLevel: 96, reorderPoint: 30, onOrder: 0, packs: [crate, single], countStyle: "WHOLE" }))
      .toEqual({ shortfall: 71, quantity: 72, pack: crate, packCount: 3 });
  });

  it("counts goods already on order as arriving", () => {
    expect(suggestReorder({ onHand: 25, parLevel: 96, reorderPoint: 30, onOrder: 72, packs: [crate], countStyle: "WHOLE" }).quantity).toBe(0);
    expect(suggestReorder({ onHand: 25, parLevel: 96, reorderPoint: 30, onOrder: 48, packs: [crate], countStyle: "WHOLE" }))
      .toMatchObject({ quantity: 24, packCount: 1 });
  });

  it("still suggests one pack at the reorder point when no par is set", () => {
    expect(suggestReorder({ onHand: 10, parLevel: null, reorderPoint: 10, onOrder: 0, packs: [crate], countStyle: "WHOLE" }))
      .toMatchObject({ quantity: 24, packCount: 1 });
  });

  it("treats a shelf below zero as empty", () => {
    expect(suggestReorder({ onHand: -300, parLevel: 3000, reorderPoint: 1000, onOrder: 0, packs: [], countStyle: "PARTIAL" }))
      .toEqual({ shortfall: 3000, quantity: 3000, pack: null, packCount: null });
  });

  it("rounds whole goods up when there is no pack", () => {
    expect(suggestReorder({ onHand: 2.5, parLevel: 10, reorderPoint: 3, onOrder: 0, packs: [], countStyle: "WHOLE" }).quantity).toBe(8);
  });

  it("prefers the pack the property last bought in", () => {
    const sack = { name: "Sack", baseQuantity: 25000 };
    const bag = { name: "Bag", baseQuantity: 5000 };
    expect(pickPack([sack, bag], 60000, "Bag")).toEqual(bag);
    expect(pickPack([sack, bag], 60000, null)).toEqual(sack);
    expect(pickPack([sack, bag], 3000, null)).toEqual(bag);
    expect(pickPack([single], 10, null)).toBeNull();
  });
});

describe("orderNeedsOwner", () => {
  it("lets the owner through and stops a manager above the limit", () => {
    expect(orderNeedsOwner({ role: "OWNER", total: 5_000_000, limit: 500_000 })).toBe(false);
    expect(orderNeedsOwner({ role: "MANAGER", total: 500_000, limit: 500_000 })).toBe(false);
    expect(orderNeedsOwner({ role: "MANAGER", total: 500_001, limit: 500_000 })).toBe(true);
  });
});

describe("overDeliveryCeiling", () => {
  it("rounds the allowance down for whole goods", () => {
    // 5% of 24 bottles is 1.2: one extra bottle, not 1.2.
    expect(overDeliveryCeiling({ ordered: 24, tolerancePercent: 5, countStyle: "WHOLE" })).toBe(25);
    expect(overDeliveryCeiling({ ordered: 12, tolerancePercent: 5, countStyle: "WHOLE" })).toBe(12);
  });

  it("gives weighed goods their exact allowance", () => {
    expect(overDeliveryCeiling({ ordered: 10000, tolerancePercent: 5, countStyle: "PARTIAL" })).toBe(10500);
    expect(overDeliveryCeiling({ ordered: 10000, tolerancePercent: 0, countStyle: "PARTIAL" })).toBe(10000);
  });
});

describe("statusAfterReceipt", () => {
  it("moves from sent to partly delivered to delivered", () => {
    expect(statusAfterReceipt("SENT", [{ quantity: 24, receivedQuantity: 0 }])).toBe("SENT");
    expect(statusAfterReceipt("SENT", [{ quantity: 24, receivedQuantity: 12 }, { quantity: 10, receivedQuantity: 0 }])).toBe("PARTIALLY_RECEIVED");
    expect(statusAfterReceipt("PARTIALLY_RECEIVED", [{ quantity: 24, receivedQuantity: 25 }, { quantity: 10, receivedQuantity: 10 }])).toBe("RECEIVED");
    expect(statusAfterReceipt("APPROVED", [{ quantity: 24, receivedQuantity: 24 }])).toBe("RECEIVED");
  });

  it("goes back when a delivery is voided", () => {
    expect(statusAfterReceipt("RECEIVED", [{ quantity: 24, receivedQuantity: 12 }])).toBe("PARTIALLY_RECEIVED");
    expect(statusAfterReceipt("PARTIALLY_RECEIVED", [{ quantity: 24, receivedQuantity: 0 }])).toBe("SENT");
  });

  it("never reopens a closed or cancelled order", () => {
    expect(statusAfterReceipt("CLOSED_SHORT", [{ quantity: 24, receivedQuantity: 24 }])).toBe("CLOSED_SHORT");
    expect(statusAfterReceipt("CANCELLED", [{ quantity: 24, receivedQuantity: 0 }])).toBe("CANCELLED");
  });
});

describe("requisitionStatus", () => {
  it("follows how many lines are on orders", () => {
    expect(requisitionStatus("OPEN", [{ purchaseOrderId: null }, { purchaseOrderId: null }])).toBe("OPEN");
    expect(requisitionStatus("OPEN", [{ purchaseOrderId: 4 }, { purchaseOrderId: null }])).toBe("PARTLY_ORDERED");
    expect(requisitionStatus("PARTLY_ORDERED", [{ purchaseOrderId: 4 }, { purchaseOrderId: 5 }])).toBe("ORDERED");
    expect(requisitionStatus("ORDERED", [{ purchaseOrderId: null }])).toBe("OPEN");
    expect(requisitionStatus("CLOSED", [{ purchaseOrderId: null }])).toBe("CLOSED");
  });
});

describe("supplier message", () => {
  it("writes Tanzanian numbers for wa.me", () => {
    expect(internationalPhone("0712 345 678")).toBe("255712345678");
    expect(internationalPhone("+255 712 345 678")).toBe("255712345678");
    expect(internationalPhone("712345678")).toBe("255712345678");
    expect(internationalPhone("")).toBeNull();
  });

  it("carries the order number, total and link", () => {
    const text = supplierMessage({ supplierName: "Juma", propertyName: "Sea View Lodge", orderNumber: "PO-260925-ABC123", lineCount: 3, total: "TZS 450,000", expectedDate: "30 Sep 2026", deliverTo: "Main store", link: "https://nolsaf.com/nrms/supplier-order/x" });
    expect(text).toContain("PO-260925-ABC123");
    expect(text).toContain("3 items (TZS 450,000)");
    expect(text).toContain("https://nolsaf.com/nrms/supplier-order/x");
    expect(text).not.toMatch(/—/);
  });
});

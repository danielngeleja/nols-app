import { describe, expect, it, vi } from "vitest";
import { buildNrmsAttentionSnapshot } from "./nrmsAttention.js";

describe("buildNrmsAttentionSnapshot", () => {
  it("returns only an outlet attendant's active orders and stock queues", async () => {
    const db = {
      nrmsOutletOrder: {
        findMany: vi.fn().mockResolvedValue([
          { outletId: 8, status: "PLACED", reservationId: 44, orderPoint: null },
          { outletId: 8, status: "PREPARING", reservationId: null, orderPoint: { type: "TABLE" } },
        ]),
      },
      nrmsMenuItem: {
        findMany: vi.fn().mockResolvedValue([
          { inStock: false, stockQuantity: 0, lowStockThreshold: 5 },
          { inStock: true, stockQuantity: 2, lowStockThreshold: 5 },
          { inStock: true, stockQuantity: null, lowStockThreshold: 5 },
        ]),
      },
    };

    const result = await buildNrmsAttentionSnapshot(db, 12, { role: "BAR", outletId: 8 }, new Date("2026-09-20T08:00:00.000Z"));

    expect(result.orders).toMatchObject({ openRoom: 1, openTable: 1, placedRoom: 1, placedTable: 0, total: 2 });
    expect(result.orders.byOutlet).toEqual([{ outletId: 8, openRoom: 1, placedRoom: 1 }]);
    expect(result.stock).toEqual({ low: 1, out: 1, total: 2 });
    expect(result.frontDesk.total).toBe(0);
    expect(result.inquiries.total).toBe(0);
    expect(result.finance.total).toBe(0);
    expect(db.nrmsOutletOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ propertyId: 12, outletId: 8 }) }));
  });
});

import { describe, expect, it, vi } from "vitest";
import { expectedCashForShift, shiftDayKey, shiftHandoverSummary, shiftMoney } from "./nrmsShifts.js";

describe("shiftMoney", () => {
  it("rounds to two decimals and coerces junk to zero", () => {
    expect(shiftMoney("412000")).toBe(412000);
    expect(shiftMoney(1.239)).toBe(1.24);
    expect(shiftMoney(null)).toBe(0);
    expect(shiftMoney("not a number")).toBe(0);
  });
});

describe("shiftDayKey", () => {
  it("uses the property timezone so a late-night close books to the local day", () => {
    // 2026-07-24 22:30 UTC is already 2026-07-25 01:30 in Dar es Salaam (UTC+3).
    expect(shiftDayKey(new Date("2026-07-24T22:30:00Z"))).toBe("2026-07-25");
    expect(shiftDayKey(new Date("2026-07-24T10:00:00Z"))).toBe("2026-07-24");
  });
});

describe("expectedCashForShift", () => {
  it("sums the opening float, cash reservation payments and cash outlet sales for this cashier only", async () => {
    const db = {
      externalPaymentRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 150_000 } }) },
      nrmsOutletOrder: { aggregate: vi.fn().mockResolvedValue({ _sum: { total: 250_000 } }) },
    };
    const shift = { userId: 12, propertyId: 3, openedAt: new Date("2026-07-24T13:00:00Z"), openingFloat: 12_000 };
    await expect(expectedCashForShift(db, shift)).resolves.toBe(412_000);
    // Scoped to this cashier's own cash takings during the shift window.
    expect(db.externalPaymentRecord.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ recordedById: 12, method: "CASH" }),
    }));
    expect(db.nrmsOutletOrder.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ settledById: 12, settlementMethod: "CASH", status: "SETTLED" }),
    }));
  });

  it("classifies the handover review into paid-by-method, folio and unpaid", async () => {
    const db = {
      nrmsOutletOrder: {
        groupBy: vi.fn().mockResolvedValue([
          { settlementMethod: "CASH", _sum: { total: 300_000 }, _count: { _all: 4 } },
          { settlementMethod: "MOBILE_MONEY", _sum: { total: 120_000 }, _count: { _all: 2 } },
        ]),
        aggregate: vi.fn()
          .mockResolvedValueOnce({ _sum: { total: 80_000 }, _count: { _all: 3 } })   // folio posted during shift
          .mockResolvedValueOnce({ _sum: { total: 45_000 }, _count: { _all: 2 } })   // unpaid outstanding
          .mockResolvedValueOnce({ _sum: { total: 900_000 }, _count: { _all: 20 } }) // day settled
          .mockResolvedValueOnce({ _sum: { total: 150_000 }, _count: { _all: 5 } }), // day posted
        findMany: vi.fn().mockResolvedValue([
          { id: 7, orderNumber: "ORD-7", customerLabel: null, total: 45_000, status: "SERVING", settlementMode: "OUTLET_PAYMENT", createdAt: new Date(), outlet: { name: "Pool bar" } },
        ]),
      },
      externalPaymentRecord: { groupBy: vi.fn().mockResolvedValue([]) },
    };
    const shift = { userId: 12, propertyId: 3, currency: "TZS", openedAt: new Date("2026-07-24T13:00:00Z") };
    const summary = await shiftHandoverSummary(db, shift, new Date("2026-07-24T20:00:00Z"));
    expect(summary.mySales).toMatchObject({ count: 6, amount: 420_000 });
    expect(summary.mySales.byMethod).toEqual([
      { method: "CASH", count: 4, amount: 300_000 },
      { method: "MOBILE_MONEY", count: 2, amount: 120_000 },
    ]);
    expect(summary.folioPosted).toEqual({ count: 3, amount: 80_000 });
    expect(summary.unpaid.count).toBe(2);
    expect(summary.unpaid.amount).toBe(45_000);
    // A walk-in order with no label is still identified, never blank.
    expect(summary.unpaid.orders[0].customerLabel).toBe("Walk-in");
    expect(summary.daySales.amount).toBe(1_050_000);
    // Own sales are scoped to this attendee; unpaid orders are property-wide so
    // nothing outstanding can hide from the review.
    expect(db.nrmsOutletOrder.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ settledById: 12 }) }));
    expect(db.nrmsOutletOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ["PLACED", "CONFIRMED", "PREPARING", "SERVING"] } }) }));
  });

  it("treats absent takings as zero and returns just the float", async () => {
    const db = {
      externalPaymentRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
      nrmsOutletOrder: { aggregate: vi.fn().mockResolvedValue({ _sum: { total: null } }) },
    };
    const shift = { userId: 5, propertyId: 1, openedAt: new Date(), openingFloat: 20_000 };
    await expect(expectedCashForShift(db, shift)).resolves.toBe(20_000);
  });
});

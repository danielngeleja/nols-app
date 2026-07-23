import { describe, expect, it, vi } from "vitest";
import { expectedCashForShift, shiftDayKey, shiftMoney } from "./nrmsShifts.js";

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

  it("treats absent takings as zero and returns just the float", async () => {
    const db = {
      externalPaymentRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
      nrmsOutletOrder: { aggregate: vi.fn().mockResolvedValue({ _sum: { total: null } }) },
    };
    const shift = { userId: 5, propertyId: 1, openedAt: new Date(), openingFloat: 20_000 };
    await expect(expectedCashForShift(db, shift)).resolves.toBe(20_000);
  });
});

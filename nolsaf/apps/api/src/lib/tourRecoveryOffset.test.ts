import { describe, expect, it } from "vitest";
import { allocateDeduction, outstandingOf, offsetAppliedOf, planRecoveryDeduction, type RecoveryRow } from "./tourRecoveryOffset.js";

const row = (id: number, amount: number, offsetApplied = 0, day = id): RecoveryRow => ({
  id,
  tourBookingId: 100 + id,
  amount,
  offsetApplied,
  createdAt: new Date(`2026-10-${String(day).padStart(2, "0")}T08:00:00Z`),
});

describe("planRecoveryDeduction", () => {
  it("takes the whole debt when the balance covers it", () => {
    expect(planRecoveryDeduction(1000, 300, 0)).toBe(300);
  });

  it("never takes more than the balance", () => {
    expect(planRecoveryDeduction(200, 500, 0)).toBe(200);
  });

  it("leaves out what other in-flight balances already reserved, so a debt is never taken twice", () => {
    expect(planRecoveryDeduction(1000, 500, 400)).toBe(100);
    expect(planRecoveryDeduction(1000, 500, 500)).toBe(0);
    expect(planRecoveryDeduction(1000, 500, 900)).toBe(0);
  });

  it("deducts nothing when nothing is owed", () => {
    expect(planRecoveryDeduction(1000, 0, 0)).toBe(0);
  });
});

describe("allocateDeduction", () => {
  it("settles the oldest recovery first", () => {
    const { allocations, unallocated } = allocateDeduction(250, [row(2, 300, 0, 5), row(1, 100, 0, 1)]);
    expect(allocations).toEqual([
      { recoveryId: 1, tourBookingId: 101, amount: 100, settles: true },
      { recoveryId: 2, tourBookingId: 102, amount: 150, settles: false },
    ]);
    expect(unallocated).toBe(0);
  });

  it("counts what was already deducted from a recovery", () => {
    const { allocations } = allocateDeduction(500, [row(1, 300, 200)]);
    expect(allocations).toEqual([{ recoveryId: 1, tourBookingId: 101, amount: 100, settles: true }]);
  });

  it("reports what could not be placed", () => {
    const { allocations, unallocated } = allocateDeduction(500, [row(1, 120)]);
    expect(allocations).toHaveLength(1);
    expect(unallocated).toBe(380);
  });

  it("skips recoveries already fully deducted", () => {
    const { allocations } = allocateDeduction(50, [row(1, 100, 100), row(2, 80)]);
    expect(allocations).toEqual([{ recoveryId: 2, tourBookingId: 102, amount: 50, settles: false }]);
  });
});

describe("outstanding amounts", () => {
  it("reads the offset from metadata and never goes negative", () => {
    expect(offsetAppliedOf({ offsetApplied: 40 })).toBe(40);
    expect(offsetAppliedOf(null)).toBe(0);
    expect(offsetAppliedOf({ offsetApplied: "x" })).toBe(0);
    expect(outstandingOf({ amount: 100, offsetApplied: 40 })).toBe(60);
    expect(outstandingOf({ amount: 100, offsetApplied: 140 })).toBe(0);
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import { allocateWithdrawal, amountWithdrawalFingerprint } from "./partialWithdrawal.js";

describe("booking portions in one owner withdrawal", () => {
  it("leaves the rest of a large booking for another day", () => {
    const first = allocateWithdrawal([
      { releaseId: 1, invoiceId: 10, remaining: 12_000_000, alreadyRecovered: 0 },
    ], 10_000_000, 0);
    expect(first).toEqual([{ releaseId: 1, invoiceId: 10, grossAmount: 10_000_000, recoveryDeduction: 0, recoveryTarget: 0 }]);
    const later = allocateWithdrawal([
      { releaseId: 1, invoiceId: 10, remaining: 2_000_000, alreadyRecovered: 0 },
    ], 2_000_000, 0);
    expect(later[0].grossAmount).toBe(2_000_000);
  });

  it("combines three bookings, taking only the required part of the last one", () => {
    const plan = allocateWithdrawal([1, 2, 3].map((id) => ({
      releaseId: id, invoiceId: id + 10, remaining: 4_000_000, alreadyRecovered: 0,
    })), 10_000_000, 0);
    expect(plan.map((row) => row.grossAmount)).toEqual([4_000_000, 4_000_000, 2_000_000]);
  });

  it("reserves recovery first and binds the exact deduction", () => {
    const plan = allocateWithdrawal([
      { releaseId: 1, invoiceId: 10, remaining: 100_000, alreadyRecovered: 10_000 },
    ], 50_000, 30_000);
    expect(plan).toEqual([{ releaseId: 1, invoiceId: 10, grossAmount: 80_000, recoveryDeduction: 30_000, recoveryTarget: 40_000 }]);
    const base = amountWithdrawalFingerprint({ ownerId: 5, amount: 50_000, plan, openDebt: 30_000, accountFingerprint: "wallet-a" });
    expect(base).not.toBe(amountWithdrawalFingerprint({ ownerId: 5, amount: 50_000, plan, openDebt: 30_000, accountFingerprint: "wallet-b" }));
    expect(base).not.toBe(amountWithdrawalFingerprint({ ownerId: 5, amount: 49_999, plan, openDebt: 30_000, accountFingerprint: "wallet-a" }));
  });

  it("refuses to reserve more than the booking balance", () => {
    expect(() => allocateWithdrawal([
      { releaseId: 1, invoiceId: 10, remaining: 8_000_000, alreadyRecovered: 0 },
    ], 10_000_000, 0)).toThrow(/ready booking balance changed/);
  });
});

import { describe, expect, it } from "vitest";
import {
  calculateSalesPayoutApproval,
  canApproveCommission,
  canReverseCommission,
  canTransitionSalesPayout,
} from "../lib/salesFinance.js";

describe("sales finance lifecycle", () => {
  it("only approves an eligible commission", () => {
    expect(canApproveCommission("ELIGIBLE")).toBe(true);
    expect(canApproveCommission("VALIDATING")).toBe(false);
    expect(canApproveCommission("AVAILABLE")).toBe(false);
  });

  it("blocks reversal while a commission is locked in an active payout", () => {
    expect(canReverseCommission("AVAILABLE", "REQUESTED")).toBe(false);
    expect(canReverseCommission("AVAILABLE", null)).toBe(true);
    expect(canReverseCommission("PAID", "PAID")).toBe(true);
    expect(canReverseCommission("REVERSED", null)).toBe(false);
  });

  it("allows only the forward payout state machine", () => {
    expect(canTransitionSalesPayout("REQUESTED", "APPROVED")).toBe(true);
    expect(canTransitionSalesPayout("UNDER_REVIEW", "REJECTED")).toBe(true);
    expect(canTransitionSalesPayout("APPROVED", "PROCESSING")).toBe(true);
    expect(canTransitionSalesPayout("PROCESSING", "PAID")).toBe(true);
    expect(canTransitionSalesPayout("PAID", "PROCESSING")).toBe(false);
    expect(canTransitionSalesPayout("REJECTED", "APPROVED")).toBe(false);
  });

  it("calculates a positive net payout and rejects full deductions", () => {
    expect(calculateSalesPayoutApproval(100_000, 12_500)).toEqual({
      approvedAmount: 100_000,
      deductionAmount: 12_500,
      netPaidAmount: 87_500,
    });
    expect(() => calculateSalesPayoutApproval(100_000, 100_000)).toThrow(RangeError);
    expect(() => calculateSalesPayoutApproval(0, 0)).toThrow(RangeError);
  });
});

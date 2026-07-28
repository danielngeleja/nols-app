import { describe, expect, it } from "vitest";
import {
  calculateSalesCommission,
  exclusiveTaxAmount,
  inclusiveTaxComponent,
} from "../lib/salesCommission.js";

describe("sales commission arithmetic", () => {
  it("matches the NRMS inclusive VAT example", () => {
    const tax = inclusiveTaxComponent(240_000, 18);
    expect(tax).toBe(36_610.17);
    expect(calculateSalesCommission({
      grossAmount: 240_000,
      taxAmount: tax,
      processingFeeAmount: 2_400,
      commissionRate: 14,
    })).toEqual({
      grossAmount: 240_000,
      taxAmount: 36_610.17,
      processingFeeAmount: 2_400,
      refundAmount: 0,
      discountAmount: 0,
      eligibleNetRevenue: 200_989.83,
      commissionRate: 14,
      commissionAmount: 28_138.58,
    });
  });

  it("applies marketplace share to NoLSAF commission rather than booking value", () => {
    const calculation = calculateSalesCommission({
      grossAmount: 100_000,
      taxAmount: 10_000,
      processingFeeAmount: 2_000,
      commissionRate: 20,
    });
    expect(calculation.eligibleNetRevenue).toBe(88_000);
    expect(calculation.commissionAmount).toBe(17_600);
  });

  it("uses the invoice revenue convention for exclusive marketplace tax", () => {
    expect(exclusiveTaxAmount(100_000, 18)).toBe(18_000);
  });

  it("never produces negative eligible revenue or a rate over 100 percent", () => {
    expect(calculateSalesCommission({
      grossAmount: 100,
      taxAmount: 150,
      commissionRate: 500,
    })).toEqual(expect.objectContaining({
      eligibleNetRevenue: 0,
      commissionRate: 100,
      commissionAmount: 0,
    }));
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  autoReverseSalesCommission,
  bookingHasOpenCancellation,
  bookingWasCancelled,
  calculateSalesCommission,
  exclusiveTaxAmount,
  inclusiveTaxComponent,
  marketplaceEligibleAt,
} from "../lib/salesCommission.js";
import { partnerBookedStayReason, phoneKey } from "../lib/salesSelfDealing.js";

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

const DAY = 24 * 60 * 60 * 1000;

describe("marketplace commission waits for the stay", () => {
  const paidAt = new Date("2026-01-01T00:00:00Z");

  it("uses the payment window when the stay ends first", () => {
    expect(marketplaceEligibleAt(paidAt, new Date("2026-01-05T00:00:00Z")).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  it("waits until three days after check-out for a stay booked far ahead", () => {
    expect(marketplaceEligibleAt(paidAt, new Date("2026-04-10T00:00:00Z")).toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  it("treats cancelled bookings and settled cancellation requests as cancelled", () => {
    expect(bookingWasCancelled({ status: "CANCELED" })).toBe(true);
    expect(bookingWasCancelled({ status: "CONFIRMED", cancellationRequests: [{ status: "REFUNDED" }] })).toBe(true);
    expect(bookingWasCancelled({ status: "CONFIRMED", cancellationRequests: [{ status: "REJECTED" }] })).toBe(false);
  });

  it("holds while a cancellation request is still open", () => {
    expect(bookingHasOpenCancellation({ cancellationRequests: [{ status: "REVIEWING" }] })).toBe(true);
    expect(bookingHasOpenCancellation({ cancellationRequests: [{ status: "REJECTED" }] })).toBe(false);
  });
});

describe("self-dealing", () => {
  const identity = { userId: 101, emails: new Set(["partner@example.com"]), phones: new Set([phoneKey("+255 712 345 678")!]), payoutKeys: new Set<string>() };

  it("matches phone numbers across local and international formats", () => {
    expect(phoneKey("0712345678")).toBe(phoneKey("+255712345678"));
  });

  it("blocks stays the partner booked on their own account or phone", () => {
    expect(partnerBookedStayReason(identity, { userId: 101 })).toMatch(/same account/);
    expect(partnerBookedStayReason(identity, { userId: null, guestPhone: "0712 345 678" })).toMatch(/same phone/);
    expect(partnerBookedStayReason(identity, { userId: 5, user: { email: "PARTNER@example.com" } })).toMatch(/same email/);
    expect(partnerBookedStayReason(identity, { userId: 5, guestPhone: "0799000000" })).toBeNull();
  });
});

describe("automatic reversal on a cancelled booking", () => {
  function tx(commission: any) {
    return {
      salesCommission: {
        findUnique: vi.fn(async () => commission),
        updateMany: vi.fn(async () => ({ count: 1 })),
        create: vi.fn(async ({ data }: any) => ({ id: 900, ...data })),
      },
      auditLog: { create: vi.fn(async () => ({})) },
    };
  }
  const base = { id: 5, salesPartnerId: 11, propertyId: 4, attributionId: 90, contractId: 31, commissionAmount: "1200", eligibleNetRevenue: "6000", commissionRate: "20", currency: "TZS" };

  it("reverses an unpaid commission", async () => {
    const t = tx({ ...base, status: "ELIGIBLE", payoutItem: null });
    expect(await autoReverseSalesCommission(t, 5, "Booking cancelled")).toBe("REVERSED");
    expect(t.salesCommission.create).not.toHaveBeenCalled();
  });

  it("offsets a paid commission against the next payout", async () => {
    const t = tx({ ...base, status: "PAID", payoutItem: { payout: { status: "PAID" } } });
    expect(await autoReverseSalesCommission(t, 5, "Booking cancelled")).toBe("OFFSET");
    expect(t.salesCommission.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      sourceKey: "ADJUSTMENT:REVERSAL-5", commissionAmount: -1200, status: "AVAILABLE", reversalOfId: 5,
    }) });
  });

  it("leaves a commission inside a pending payout for finance", async () => {
    const t = tx({ ...base, status: "AVAILABLE", payoutItem: { payout: { status: "REQUESTED" } } });
    expect(await autoReverseSalesCommission(t, 5, "Booking cancelled")).toBe("LOCKED");
    expect(t.salesCommission.updateMany).not.toHaveBeenCalled();
  });
});

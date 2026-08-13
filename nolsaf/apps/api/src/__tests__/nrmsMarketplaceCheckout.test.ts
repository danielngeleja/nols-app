import { describe, expect, it, vi } from "vitest";
import { buildNrmsUsageRows, completeMarketplaceBookingCheckout } from "../lib/nrmsBilling.js";

describe("completeMarketplaceBookingCheckout", () => {
  it("does nothing for a non-marketplace reservation", async () => {
    const tx = { booking: { updateMany: vi.fn(), findUnique: vi.fn() } };

    await expect(completeMarketplaceBookingCheckout(tx, { bookingId: null, propertyId: 19 }))
      .resolves.toEqual({ linked: false, alreadyCheckedOut: false });
    expect(tx.booking.updateMany).not.toHaveBeenCalled();
  });

  it("atomically advances the linked checked-in booking", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { booking: { updateMany, findUnique: vi.fn() } };

    await expect(completeMarketplaceBookingCheckout(tx, { bookingId: 31, propertyId: 19 }))
      .resolves.toEqual({ linked: true, alreadyCheckedOut: false });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 31, propertyId: 19, status: "CHECKED_IN" },
      data: { status: "CHECKED_OUT" },
    });
  });

  it("accepts an already checked-out linked booking for safe retry recovery", async () => {
    const tx = {
      booking: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ propertyId: 19, status: "CHECKED_OUT" }),
      },
    };

    await expect(completeMarketplaceBookingCheckout(tx, { bookingId: 31, propertyId: 19 }))
      .resolves.toEqual({ linked: true, alreadyCheckedOut: true });
  });

  it("rejects a split lifecycle state instead of overwriting it", async () => {
    const tx = {
      booking: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ propertyId: 19, status: "CANCELED" }),
      },
    };

    await expect(completeMarketplaceBookingCheckout(tx, { bookingId: 31, propertyId: 19 }))
      .rejects.toThrow("NRMS_MARKETPLACE_STATUS_CONFLICT:CANCELED");
  });

  it("rejects a missing or cross-property link", async () => {
    const tx = {
      booking: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        findUnique: vi.fn().mockResolvedValue({ propertyId: 27, status: "CHECKED_IN" }),
      },
    };

    await expect(completeMarketplaceBookingCheckout(tx, { bookingId: 31, propertyId: 19 }))
      .rejects.toThrow("NRMS_MARKETPLACE_STATUS_CONFLICT:MISSING");
  });
});

describe("buildNrmsUsageRows marketplace classification", () => {
  const base = {
    accountId: 1, propertyId: 19, reservationId: 990, policyId: 3,
    trialEndsAt: new Date("2026-01-01T00:00:00Z"),
    currency: "TZS", roomNightPrice: 1500,
    allocations: [{ id: 7, startDate: new Date("2026-08-01T00:00:00Z"), endDate: new Date("2026-08-04T00:00:00Z") }],
  };

  it("bills an external stay with no linked booking", () => {
    const rows = buildNrmsUsageRows({ ...base, source: "WALK_IN", bookingId: null });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.classification === "BILLABLE_EXTERNAL" && row.amount === 1500)).toBe(true);
  });

  it("never bills a stay carrying a linked booking, even when the source string drifted", () => {
    const rows = buildNrmsUsageRows({ ...base, source: "WALK_IN", bookingId: 4821 });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.classification === "COMMISSION_ONLY" && row.amount === 0)).toBe(true);
  });

  it("still honours the NOLSAF source when no booking id is supplied", () => {
    const rows = buildNrmsUsageRows({ ...base, source: "NOLSAF" });
    expect(rows.every((row) => row.classification === "COMMISSION_ONLY" && row.amount === 0)).toBe(true);
  });
});

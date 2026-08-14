import { describe, expect, it, vi } from "vitest";
import { chargeRequiresCheckoutVerification, finalizeNrmsCheckout } from "./nrmsBilling.js";

describe("finalizeNrmsCheckout guest settlement guard", () => {
  it("trusts a room-folio charge completed through the outlet workflow", () => {
    expect(chargeRequiresCheckoutVerification({
      outletOrder: { status: "POSTED_TO_FOLIO", settlementMode: "ROOM_FOLIO" },
    })).toBe(false);
    expect(chargeRequiresCheckoutVerification({ outletOrder: null })).toBe(true);
  });

  it("does not change the reservation status when authoritative ledger rows leave a balance due", async () => {
    const updateMany = vi.fn();
    const tx = {
      reservation: {
        findUnique: vi.fn().mockResolvedValue({ status: "CHECKED_IN", totalAmount: 80_000 }),
        updateMany,
      },
      externalPaymentRecord: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 80_000 } }),
      },
      reservationCharge: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 75_000 } }),
        findMany: vi.fn().mockResolvedValue([{ id: 41 }, { id: 42 }]),
      },
      nrmsOutletOrder: { count: vi.fn().mockResolvedValue(0) },
      nrmsMasterFolioItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };

    await expect(
      finalizeNrmsCheckout(tx, { id: 1, propertyId: 1, source: "WALK_IN" }, 10),
    ).rejects.toThrow("NRMS_GUEST_BALANCE_DUE:75000");

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does not change the reservation status while guest credit remains", async () => {
    const updateMany = vi.fn();
    const tx = {
      reservation: {
        findUnique: vi.fn().mockResolvedValue({ status: "CHECKED_IN", totalAmount: 80_000 }),
        updateMany,
      },
      externalPaymentRecord: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 90_000 } }),
      },
      reservationCharge: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nrmsOutletOrder: { count: vi.fn().mockResolvedValue(0) },
      nrmsMasterFolioItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };

    await expect(
      finalizeNrmsCheckout(tx, { id: 1, propertyId: 1, source: "WALK_IN" }, 10),
    ).rejects.toThrow("NRMS_GUEST_CREDIT_REMAINS:-10000");

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("blocks checkout while restaurant or bar orders are still open", async () => {
    const updateMany = vi.fn();
    const tx = {
      reservation: {
        findUnique: vi.fn().mockResolvedValue({ status: "CHECKED_IN", totalAmount: 80_000 }),
        updateMany,
      },
      externalPaymentRecord: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 80_000 } }),
      },
      reservationCharge: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nrmsOutletOrder: { count: vi.fn().mockResolvedValue(2) },
      nrmsMasterFolioItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };

    await expect(
      finalizeNrmsCheckout(tx, { id: 1, propertyId: 1, source: "WALK_IN" }, 10),
    ).rejects.toThrow("NRMS_OPEN_OUTLET_ORDERS:2");

    expect(updateMany).not.toHaveBeenCalled();
    expect(tx.nrmsOutletOrder.count).toHaveBeenCalledWith({
      where: { reservationId: 1, status: { in: ["CONFIRMED", "PREPARING", "SERVING"] } },
    });
  });

  it("blocks checkout when a settled outlet payment has no tender method", async () => {
    const updateMany = vi.fn();
    const tx = {
      reservation: {
        findUnique: vi.fn().mockResolvedValue({ status: "CHECKED_IN", totalAmount: 80_000 }),
        updateMany,
      },
      externalPaymentRecord: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 80_000 } }),
      },
      reservationCharge: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nrmsOutletOrder: { count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1) },
      nrmsMasterFolioItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };

    await expect(
      finalizeNrmsCheckout(tx, { id: 1, propertyId: 1, source: "WALK_IN" }, 10),
    ).rejects.toThrow("NRMS_UNCLASSIFIED_OUTLET_PAYMENTS:1");

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("requires every active extra charge id to be verified independently", async () => {
    const updateMany = vi.fn();
    const tx = {
      reservation: {
        findUnique: vi.fn().mockResolvedValue({ status: "CHECKED_IN", totalAmount: 80_000 }),
        updateMany,
      },
      externalPaymentRecord: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 100_000 } }),
      },
      reservationCharge: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 20_000 } }),
        findMany: vi.fn().mockResolvedValue([{ id: 41 }, { id: 42 }]),
      },
      nrmsOutletOrder: { count: vi.fn().mockResolvedValue(0) },
      nrmsMasterFolioItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };

    await expect(
      finalizeNrmsCheckout(tx, { id: 1, propertyId: 1, source: "WALK_IN" }, 10, [42]),
    ).rejects.toThrow("NRMS_CHARGES_NOT_VERIFIED:41");

    expect(updateMany).not.toHaveBeenCalled();
  });

  it("clears the guest with a routed room but blocks the final departure on the unpaid agency bill", async () => {
    const updateMany = vi.fn();
    const tx = {
      reservation: {
        findUnique: vi.fn().mockResolvedValue({ status: "CHECKED_IN", totalAmount: 80_000, groupId: 22 }),
        updateMany,
      },
      externalPaymentRecord: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
      reservationCharge: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }),
        findMany: vi.fn().mockResolvedValue([]),
      },
      nrmsOutletOrder: { count: vi.fn().mockResolvedValue(0) },
      nrmsGroupBlock: {
        findUnique: vi.fn().mockResolvedValue({ billingMode: "SPLIT", masterFolio: { id: 8, settlementPolicy: "PAY_BEFORE_DEPARTURE" } }),
      },
      nrmsMasterFolioItem: {
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 80_000 } }),
        count: vi.fn().mockResolvedValue(0),
      },
      nrmsMasterFolioPayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };

    await expect(
      finalizeNrmsCheckout(tx, { id: 1, propertyId: 1, source: "WALK_IN" }, 10),
    ).rejects.toThrow("NRMS_MASTER_BALANCE_DUE:80000");
    expect(updateMany).not.toHaveBeenCalled();
  });
});

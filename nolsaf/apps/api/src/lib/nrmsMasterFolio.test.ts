import { describe, expect, it, vi } from "vitest";
import {
  billingRoutesExtras,
  billingUsesMasterFolio,
  getMasterCheckoutBlocker,
  refreshMasterFolioStatus,
  routeChargeToMasterFolio,
} from "./nrmsMasterFolio.js";

describe("NRMS master folio", () => {
  it("routes rooms for SPLIT and MASTER, but extras only for MASTER", () => {
    expect(billingUsesMasterFolio("INDIVIDUAL")).toBe(false);
    expect(billingUsesMasterFolio("SPLIT")).toBe(true);
    expect(billingUsesMasterFolio("MASTER")).toBe(true);
    expect(billingRoutesExtras("SPLIT")).toBe(false);
    expect(billingRoutesExtras("MASTER")).toBe(true);
  });

  it("marks an exactly paid agency bill settled", async () => {
    const update = vi.fn();
    const tx = {
      nrmsMasterFolioItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 450_000 } }) },
      nrmsMasterFolioPayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 450_000 } }) },
      nrmsMasterFolio: { update },
    };

    await expect(refreshMasterFolioStatus(tx, 8)).resolves.toMatchObject({ billed: 450_000, paid: 450_000, balance: 0, status: "SETTLED" });
    expect(update).toHaveBeenCalledWith({ where: { id: 8 }, data: { status: "SETTLED", settledAt: expect.any(Date) } });
  });

  it("blocks a group batch while the agency master bill is due", async () => {
    const tx = {
      nrmsGroupBlock: { findUnique: vi.fn().mockResolvedValue({ billingMode: "SPLIT", masterFolio: { id: 8, settlementPolicy: "PAY_BEFORE_DEPARTURE" } }) },
      nrmsMasterFolioItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 600_000 } }) },
      nrmsMasterFolioPayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 100_000 } }) },
    };

    await expect(getMasterCheckoutBlocker(tx, 22, { groupBatch: true })).resolves.toEqual({ code: "MASTER_BALANCE_DUE", balance: 500_000 });
  });

  it("allows an early individual departure but protects the final member", async () => {
    const count = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0);
    const tx = {
      nrmsGroupBlock: { findUnique: vi.fn().mockResolvedValue({ billingMode: "MASTER", masterFolio: { id: 8, settlementPolicy: "PAY_BEFORE_DEPARTURE" } }) },
      nrmsMasterFolioItem: { count, aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 600_000 } }) },
      nrmsMasterFolioPayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
    };

    await expect(getMasterCheckoutBlocker(tx, 22, { reservationId: 1 })).resolves.toBeNull();
    await expect(getMasterCheckoutBlocker(tx, 22, { reservationId: 1 })).resolves.toEqual({ code: "MASTER_BALANCE_DUE", balance: 600_000 });
  });

  it("still protects a detached member by following the routed item", async () => {
    const tx = {
      nrmsGroupBlock: { findUnique: vi.fn().mockResolvedValue(null) },
      nrmsMasterFolioItem: {
        findFirst: vi.fn().mockResolvedValue({
          masterFolio: {
            id: 8,
            settlementPolicy: "PAY_BEFORE_DEPARTURE",
            block: { id: 3, billingMode: "SPLIT" },
          },
        }),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 300_000 } }),
      },
      nrmsMasterFolioPayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };

    await expect(getMasterCheckoutBlocker(tx, null, { reservationId: 5 })).resolves.toEqual({ code: "MASTER_BALANCE_DUE", balance: 300_000 });
  });

  it("routes a MASTER incidental once and reopens the agency bill", async () => {
    const itemUpsert = vi.fn().mockResolvedValue({ id: 30 });
    const update = vi.fn();
    const tx = {
      reservation: { findUnique: vi.fn().mockResolvedValue({ id: 5, groupId: 22 }) },
      nrmsGroupBlock: { findUnique: vi.fn().mockResolvedValue({ id: 3, propertyId: 1, ownerId: 2, reference: "BLK-1", name: "Tour", agencyName: "Agency", billingMode: "MASTER", currency: "TZS" }) },
      nrmsMasterFolio: { upsert: vi.fn().mockResolvedValue({ id: 8 }), update },
      nrmsMasterFolioItem: {
        upsert: itemUpsert,
        aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 75_000 } }),
      },
      nrmsMasterFolioPayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
    };

    await routeChargeToMasterFolio(tx, { id: 90, reservationId: 5, category: "BAR", description: "Bar tab", amount: 75_000, currency: "TZS" });

    expect(itemUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceKey: "CHARGE:90" },
      create: expect.objectContaining({ masterFolioId: 8, reservationId: 5, reservationChargeId: 90, kind: "EXTRA", amount: 75_000 }),
    }));
    expect(update).toHaveBeenCalledWith({ where: { id: 8 }, data: { status: "OPEN", settledAt: null } });
  });
});

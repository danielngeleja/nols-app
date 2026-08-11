import { describe, expect, it, vi } from "vitest";
import {
  billingRoutesExtras,
  billingUsesMasterFolio,
  buildGroupChargeRegister,
  getMasterFolioTotals,
  getMasterCheckoutBlocker,
  masterFolioJoinConflict,
  refreshMasterFolioStatus,
  routeChargeToMasterFolio,
  summarizeReservationMasterSettlement,
} from "./nrmsMasterFolio.js";

describe("NRMS master folio", () => {
  it("routes rooms for SPLIT and MASTER, but extras only for MASTER", () => {
    expect(billingUsesMasterFolio("INDIVIDUAL")).toBe(false);
    expect(billingUsesMasterFolio("SPLIT")).toBe(true);
    expect(billingUsesMasterFolio("MASTER")).toBe(true);
    expect(billingRoutesExtras("SPLIT")).toBe(false);
    expect(billingRoutesExtras("MASTER")).toBe(true);
  });

  it("describes a settled agency payment without inventing guest payment rows", () => {
    const group = {
      block: {
        billingMode: "SPLIT",
        masterFolio: {
          reference: "MF-BLK-1",
          status: "SETTLED",
          settledAt: new Date("2026-08-11T10:00:00Z"),
          payments: [
            { method: "CARD", voidedAt: null },
            { method: "CARD", voidedAt: null },
            { method: "BANK", voidedAt: new Date("2026-08-11T09:00:00Z") },
          ],
        },
      },
    };

    expect(summarizeReservationMasterSettlement(group, 430_000)).toEqual({
      billingMode: "SPLIT",
      masterFolioReference: "MF-BLK-1",
      status: "SETTLED",
      settled: true,
      settledAt: new Date("2026-08-11T10:00:00Z"),
      methods: ["CARD"],
    });
    expect(summarizeReservationMasterSettlement(group, 0)).toBeNull();
  });

  it("keeps transferred guest liability visibly pending while the agency bill is open", () => {
    const group = {
      block: {
        billingMode: "MASTER",
        masterFolio: {
          reference: "MF-BLK-2",
          status: "OPEN",
          settledAt: null,
          payments: [{ method: "BANK", voidedAt: null }],
        },
      },
    };

    expect(summarizeReservationMasterSettlement(group, 250_000)).toMatchObject({
      status: "OPEN",
      settled: false,
      methods: ["BANK"],
    });
  });

  it("traces SPLIT room liability to the agency and restaurant extras to the guest", () => {
    const block = {
      masterFolio: {
        reference: "MF-BLK-3",
        status: "OPEN",
        proFormas: [],
        items: [{ id: 1, reservationId: 10, reservationChargeId: null, kind: "ROOM", amount: 300_000, currency: "TZS", description: "Room stay", createdAt: new Date("2026-08-10T08:00:00Z"), voidedAt: null }],
      },
      group: {
        reservations: [{
          id: 10,
          externalRef: "NRMS-10",
          status: "CHECKED_IN",
          currency: "TZS",
          totalAmount: 300_000,
          amountPaid: 0,
          createdAt: new Date("2026-08-10T07:00:00Z"),
          guestProfile: { fullName: "Asha Musa" },
          allocations: [{ roomUnit: { code: "D-4" }, roomType: { name: "Double" } }],
          charges: [{ id: 40, category: "RESTAURANT", description: "Order RST-40", amount: 25_000, currency: "TZS", createdAt: new Date("2026-08-11T11:00:00Z"), voidedAt: null, outletOrder: { orderNumber: "RST-40", status: "POSTED_TO_FOLIO", outlet: { name: "Main restaurant" } } }],
        }],
      },
    };

    const register = buildGroupChargeRegister(block);
    expect(register.revisionRequired).toBe(false);
    expect(register.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceType: "ROOM", payer: "AGENCY", settlementStatus: "AGENCY_DUE", amount: 300_000 }),
      expect.objectContaining({ sourceReference: "RST-40", payer: "GUEST", settlementStatus: "GUEST_DUE", amount: 25_000 }),
    ]));
  });

  it("flags a MASTER extra posted after the current Pro Forma for revision", () => {
    const block = {
      masterFolio: {
        reference: "MF-BLK-4",
        status: "SETTLED",
        proFormas: [{ number: "PF-4", status: "SENT", issuedAt: new Date("2026-08-10T08:00:00Z"), supersededAt: null }],
        items: [
          { id: 1, reservationId: 10, reservationChargeId: null, kind: "ROOM", amount: 300_000, currency: "TZS", createdAt: new Date("2026-08-09T08:00:00Z"), voidedAt: null },
          { id: 2, reservationId: 10, reservationChargeId: 40, kind: "EXTRA", amount: 25_000, currency: "TZS", createdAt: new Date("2026-08-11T11:00:00Z"), voidedAt: null },
        ],
      },
      group: {
        reservations: [{
          id: 10,
          externalRef: "NRMS-10",
          status: "CHECKED_IN",
          currency: "TZS",
          totalAmount: 300_000,
          amountPaid: 0,
          createdAt: new Date("2026-08-09T07:00:00Z"),
          guestProfile: { fullName: "Asha Musa" },
          allocations: [],
          charges: [{ id: 40, category: "RESTAURANT", description: "Dinner", amount: 25_000, currency: "TZS", createdAt: new Date("2026-08-11T11:00:00Z"), voidedAt: null, outletOrder: { orderNumber: "RST-40", status: "POSTED_TO_FOLIO", outlet: { name: "Main restaurant" } } }],
        }],
      },
    };

    const register = buildGroupChargeRegister(block);
    expect(register.revisionRequired).toBe(true);
    expect(register.rows).toContainEqual(expect.objectContaining({ sourceReference: "RST-40", payer: "AGENCY", settlementStatus: "PAID_BY_AGENCY", documentRevisionRequired: true, destination: "PF-4" }));
  });

  it("accepts only an unpaid same-currency stay with no competing agency bill", () => {
    const folio = { id: 8, currency: "TZS" };
    expect(masterFolioJoinConflict({ currency: "TZS", payments: [], masterFolioItems: [] }, folio)).toBeNull();
    expect(masterFolioJoinConflict({ currency: "USD", payments: [], masterFolioItems: [] }, folio)).toBe("CURRENCY_MISMATCH");
    expect(masterFolioJoinConflict({ currency: "TZS", payments: [{ amount: 20_000 }], masterFolioItems: [] }, folio)).toBe("GUEST_PAYMENT_RECORDED");
    expect(masterFolioJoinConflict({ currency: "TZS", payments: [], masterFolioItems: [{ masterFolioId: 19 }] }, folio)).toBe("OTHER_MASTER_FOLIO");
    expect(masterFolioJoinConflict({ currency: "TZS", payments: [], masterFolioItems: [{ masterFolioId: 8 }] }, folio)).toBeNull();
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

  it("subtracts actual refunds from agency cash without deleting the receipt", async () => {
    const tx = {
      nrmsMasterFolioItem: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 450_000 } }) },
      nrmsMasterFolioPayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 600_000 } }) },
      nrmsMasterFolioRefund: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 150_000 } }) },
    };

    await expect(getMasterFolioTotals(tx, 8)).resolves.toEqual({
      billed: 450_000,
      paymentsReceived: 600_000,
      refunded: 150_000,
      paid: 450_000,
      balance: 0,
    });
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

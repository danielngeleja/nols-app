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
      // GROUP marks the transfer as money separate from the reservation's own
      // payments, which is what lets a caller add the two.
      source: "GROUP",
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

  it("reads the live room line when a re-cut bill left a voided one behind", () => {
    const block = {
      masterFolio: {
        reference: "MF-BLK-9",
        status: "SETTLED",
        proFormas: [],
        items: [
          // The duplicate an earlier split wrote, since voided.
          { id: 1, reservationId: 10, reservationChargeId: null, kind: "ROOM", amount: 1_600_500, currency: "TZS", description: "Room stay BLK-9-01", createdAt: new Date("2026-08-24T02:35:00Z"), voidedAt: new Date("2026-08-24T03:10:00Z") },
          // The live line the agency was actually invoiced for.
          { id: 2, reservationId: 10, reservationChargeId: null, kind: "ROOM", amount: 1_440_450, currency: "TZS", description: "Room 1 of 10", createdAt: new Date("2026-08-24T03:10:00Z"), voidedAt: null },
        ],
      },
      group: {
        reservations: [{
          id: 10,
          externalRef: "BLK-9-01",
          status: "CONFIRMED",
          currency: "TZS",
          totalAmount: 1_440_450,
          amountPaid: 0,
          createdAt: new Date("2026-08-24T02:35:00Z"),
          guestProfile: { fullName: "Daud Mange" },
          allocations: [{ roomUnit: { code: "Double-15" }, roomType: { name: "Double" } }],
          charges: [],
        }],
      },
    };

    const roomRow = buildGroupChargeRegister(block).rows.find((row) => row.sourceType === "ROOM");
    expect(roomRow).toMatchObject({
      id: "MASTER_ITEM:2",
      amount: 1_440_450,
      payer: "AGENCY",
      settlementStatus: "PAID_BY_AGENCY",
    });
  });

  it("shows the commercial discount, so the register reconciles to the invoice", () => {
    const block = {
      masterFolio: {
        reference: "MF-BLK-10",
        billToName: "Serengeti Tours",
        currency: "TZS",
        status: "SETTLED",
        proFormas: [{ number: "PF-10", status: "SENT", issuedAt: new Date("2026-08-21T08:00:00Z"), supersededAt: null }],
        items: [
          { id: 1, reservationId: 10, reservationChargeId: null, kind: "ROOM", amount: 1_600_500, currency: "TZS", description: "Room 1 of 1", createdAt: new Date("2026-08-24T03:18:00Z"), voidedAt: null },
          // Raised against the booking, not against any one room, which is why
          // the reservation loop never saw it.
          { id: 2, reservationId: 700, reservationChargeId: null, kind: "EXTRA", amount: -160_050, currency: "TZS", description: "Commercial discount", createdAt: new Date("2026-08-21T07:00:00Z"), voidedAt: null },
        ],
      },
      group: {
        reservations: [{
          id: 10,
          externalRef: "BLK-10-01",
          status: "CONFIRMED",
          currency: "TZS",
          totalAmount: 1_600_500,
          amountPaid: 0,
          createdAt: new Date("2026-08-24T03:18:00Z"),
          guestProfile: { fullName: "Daud Mange" },
          allocations: [{ roomUnit: { code: "Double-15" }, roomType: { name: "Double" } }],
          charges: [],
        }],
      },
    };

    const rows = buildGroupChargeRegister(block).rows;
    expect(rows.map((row) => row.amount).reduce((sum, value) => sum + value, 0)).toBe(1_440_450);
    expect(rows).toContainEqual(expect.objectContaining({
      sourceType: "FOLIO_ADJUSTMENT",
      description: "Commercial discount",
      amount: -160_050,
      payer: "AGENCY",
      settlementStatus: "PAID_BY_AGENCY",
    }));
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

  // A traveller on a split agency booking ordering from the bar is the daily
  // case this whole conversion exists for: the order must land on whichever
  // bill the agency's own declaration says it should.
  describe("an outlet order charged to a room on a split agency booking", () => {
    const agencyTx = (over: Record<string, any> = {}) => {
      const request = {
        incidentalBilling: "AGENCY",
        incidentalScope: "ALL",
        incidentalCategories: null,
        incidentalCapAmount: null,
        incidentalCapBasis: null,
        adults: 2,
        children: 0,
        checkIn: new Date("2026-09-01T00:00:00.000Z"),
        checkOut: new Date("2026-09-04T00:00:00.000Z"),
        ...over,
      };
      return {
        reservation: { findUnique: vi.fn().mockResolvedValue({ id: 5, groupId: 22 }) },
        // The block the split created, holding the agency's declaration.
        nrmsGroupBlock: { findUnique: vi.fn().mockResolvedValue({ id: 3, propertyId: 1, ownerId: 2, reference: "BLK-9", name: "Serengeti Tours", agencyName: "Serengeti Tours", billingMode: over.billingMode ?? "MASTER", currency: "TZS" }) },
        nrmsMasterFolio: {
          upsert: vi.fn().mockResolvedValue({ id: 8, agentBookingRequestId: 42 }),
          findUnique: vi.fn().mockResolvedValue({ id: 8, agentBookingRequestId: 42 }),
          update: vi.fn(),
        },
        nrmsAgentBookingRequest: { findUnique: vi.fn().mockResolvedValue(request) },
        nrmsMasterFolioItem: {
          upsert: vi.fn().mockResolvedValue({ id: 30 }),
          findMany: vi.fn().mockResolvedValue([]),
          aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        },
        nrmsMasterFolioPayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
      };
    };
    const barTab = { id: 90, reservationId: 5, category: "BAR", description: "Bar tab", amount: 75_000, currency: "TZS" };

    it("puts it on the agency bill when the agency covers everything", async () => {
      const tx = agencyTx();
      await routeChargeToMasterFolio(tx, barTab);
      expect(tx.nrmsMasterFolioItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { sourceKey: "CHARGE:90" },
        create: expect.objectContaining({ masterFolioId: 8, reservationId: 5, kind: "EXTRA", amount: 75_000 }),
      }));
    });

    it("leaves it on the traveller's folio when the agency named other categories", async () => {
      const tx = agencyTx({ incidentalScope: "SELECTED", incidentalCategories: ["RESTAURANT"] });
      await routeChargeToMasterFolio(tx, barTab);
      expect(tx.nrmsMasterFolioItem.upsert).not.toHaveBeenCalled();
    });

    it("leaves it on the traveller's folio when the travellers settle their own extras", async () => {
      const tx = agencyTx({ billingMode: "SPLIT", incidentalBilling: "INDIVIDUAL_GUEST" });
      await routeChargeToMasterFolio(tx, barTab);
      expect(tx.nrmsMasterFolioItem.upsert).not.toHaveBeenCalled();
    });
  });

  it("routes a MASTER incidental once and reopens the agency bill", async () => {
    const itemUpsert = vi.fn().mockResolvedValue({ id: 30 });
    const update = vi.fn();
    const tx = {
      reservation: { findUnique: vi.fn().mockResolvedValue({ id: 5, groupId: 22 }) },
      nrmsGroupBlock: { findUnique: vi.fn().mockResolvedValue({ id: 3, propertyId: 1, ownerId: 2, reference: "BLK-1", name: "Tour", agencyName: "Agency", billingMode: "MASTER", currency: "TZS" }) },
      nrmsMasterFolio: {
        upsert: vi.fn().mockResolvedValue({ id: 8 }),
        // An ordinary group block: no agency declaration to honour, so the
        // billing mode alone decides where the extra lands.
        findUnique: vi.fn().mockResolvedValue({ id: 8, agentBookingRequestId: null }),
        update,
      },
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

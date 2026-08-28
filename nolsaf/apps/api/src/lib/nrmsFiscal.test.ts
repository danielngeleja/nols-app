import { describe, expect, it, vi } from "vitest";
import {
  allocateFiscalCounters,
  applyPendingFiscalDayTransitions,
  burnFiscalReceipt,
  canIssueOnRequest,
  enqueueFiscalReceipt,
  fiscalDateFor,
  fiscalKindFor,
  isFiscalDeadLetter,
  isFiscalisableSourceType,
  fiscalSourceKey,
  fiscaliseSettlement,
  nextFiscalAttemptAt,
  resolveFiscalSource,
  shouldAutoFiscalise,
} from "./nrmsFiscal.js";

/** A tx whose counter allocation returns the numbers the UPDATE would have set. */
function counterTx(globalCounter: number, dailyCounter: number) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ globalCounter, dailyCounter }]),
  };
}

describe("fiscalSourceKey", () => {
  // These strings are built independently in owner.nrms.finance.ts when the
  // night audit derives its ledger postings. If either side drifts, a receipt
  // and its ledger row stop being reconcilable, so pin them exactly.
  it("matches the ledger source keys the night audit builds", () => {
    expect(fiscalSourceKey("OUTLET_SALE", 12, 8842)).toBe("OUTLET:12:8842");
    expect(fiscalSourceKey("FOLIO_PAYMENT", 12, 3391)).toBe("PAYMENT:12:3391");
    expect(fiscalSourceKey("MASTER_FOLIO_PAYMENT", 12, 77)).toBe("MASTER_PAYMENT:12:77");
    expect(fiscalSourceKey("OUTLET_SALE_REVERSAL", 12, 8842)).toBe("OUTLET_VOID:12:8842");
    expect(fiscalSourceKey("PAYMENT_REVERSAL", 12, 3391)).toBe("PAYMENT_VOID:12:3391");
    expect(fiscalSourceKey("MASTER_FOLIO_PAYMENT_REVERSAL", 12, 77)).toBe("MASTER_PAYMENT_VOID:12:77");
  });

  it("refuses a source type it has no ledger prefix for", () => {
    expect(() => fiscalSourceKey("ROOM", 12, 1)).toThrowError(/ROOM/);
  });
});

describe("isFiscalisableSourceType", () => {
  it("treats guest payments and outlet sales as taxable events", () => {
    expect(isFiscalisableSourceType("OUTLET_SALE")).toBe(true);
    expect(isFiscalisableSourceType("FOLIO_PAYMENT")).toBe(true);
    expect(isFiscalisableSourceType("MASTER_FOLIO_PAYMENT")).toBe(true);
  });

  it("excludes internal accruals, so posting a bar order to a room is not a sale", () => {
    // The guest paying the folio at checkout is the taxable event, not the
    // charge landing on it.
    expect(isFiscalisableSourceType("FOLIO_CHARGE")).toBe(false);
    expect(isFiscalisableSourceType("ROOM")).toBe(false);
    expect(isFiscalisableSourceType("PLATFORM_FEE")).toBe(false);
    expect(isFiscalisableSourceType("OPERATING_EXPENSE")).toBe(false);
    // Tips are held for staff, never business revenue.
    expect(isFiscalisableSourceType("OUTLET_TIP")).toBe(false);
  });

  it("maps reversals to credit notes and sales to receipts", () => {
    expect(fiscalKindFor("OUTLET_SALE")).toBe("RECEIPT");
    expect(fiscalKindFor("PAYMENT_REVERSAL")).toBe("CREDIT_NOTE");
  });
});

describe("fiscalDateFor", () => {
  it("uses the Tanzanian calendar day, not UTC", () => {
    // 22:30 UTC is 01:30 the next morning in Dar es Salaam. TRA's daily counter
    // has already rolled over even though UTC has not.
    expect(fiscalDateFor(new Date("2026-08-27T22:30:00.000Z"))).toBe("2026-08-28");
  });

  it("keeps a late-evening local sale on its own day", () => {
    // 20:30 EAT on the 27th.
    expect(fiscalDateFor(new Date("2026-08-27T17:30:00.000Z"))).toBe("2026-08-27");
  });

  it("puts an 01:30 local sale on the new fiscal day even though night audit has not run", () => {
    // This is the business-day/fiscal-day split: the shift still belongs to the
    // 27th operationally, the receipt belongs to the 28th fiscally.
    expect(fiscalDateFor(new Date("2026-08-27T22:30:00.000Z"))).toBe("2026-08-28");
    expect(fiscalDateFor(new Date("2026-08-28T00:30:00.000Z"))).toBe("2026-08-28");
  });
});

describe("allocateFiscalCounters", () => {
  it("locks with the UPDATE then reads its own values back", async () => {
    const tx = counterTx(41, 7);
    const counters = await allocateFiscalCounters(tx, 5, new Date("2026-08-28T09:00:00.000Z"));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    // The write must come first or two settlements can read the same number.
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.$queryRaw.mock.invocationCallOrder[0]);
    expect(counters).toEqual({ receiptNumber: 41, globalCounter: 41, dailyCounter: 7, fiscalDate: "2026-08-28" });
  });

  it("keeps the receipt number equal to the global counter, which is TRA's rule", async () => {
    const tx = counterTx(1, 1);
    const counters = await allocateFiscalCounters(tx, 5, new Date("2026-01-01T06:00:00.000Z"));
    expect(counters.receiptNumber).toBe(counters.globalCounter);
  });

  it("passes the Tanzanian date so the daily counter resets at local midnight", async () => {
    const tx = counterTx(100, 1);
    await allocateFiscalCounters(tx, 5, new Date("2026-08-27T22:30:00.000Z"));
    // The date interpolated into both the CASE comparison and the assignment.
    expect(tx.$executeRaw.mock.calls[0]).toContain("2026-08-28");
  });

  it("throws rather than issuing a document with no number", async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1), $queryRaw: vi.fn().mockResolvedValue([]) };
    await expect(allocateFiscalCounters(tx, 5, new Date())).rejects.toThrowError(/no counter/);
  });
});

describe("enqueueFiscalReceipt", () => {
  const input = {
    propertyId: 12,
    connectionId: 5,
    sourceType: "OUTLET_SALE",
    sourceId: 8842,
    saleOccurredAt: new Date("2026-08-28T09:00:00.000Z"),
    currency: "TZS",
    grossAmount: 45000,
  };

  it("queues a PENDING document without calling TRA, so a settle never waits", async () => {
    const tx = {
      ...counterTx(41, 7),
      nrmsFiscalReceipt: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 900 }),
      },
    };
    const created = await enqueueFiscalReceipt(tx, input);
    expect(created).toEqual({ id: 900 });
    const data = tx.nrmsFiscalReceipt.create.mock.calls[0][0].data;
    expect(data.status).toBe("PENDING");
    expect(data.sourceKey).toBe("OUTLET:12:8842");
    expect(data.kind).toBe("RECEIPT");
    expect(data.receiptNumber).toBe(41);
    expect(data.dailyCounter).toBe(7);
    // Stored as the calendar date, midnight UTC, matching the DATE column.
    expect(data.fiscalDate.toISOString()).toBe("2026-08-28T00:00:00.000Z");
    // The sale time is preserved separately from whenever TRA confirms it.
    expect(data.saleOccurredAt).toBe(input.saleOccurredAt);
    expect(data.issuedAt).toBeUndefined();
  });

  it("collapses a retried settle to one document and burns no number", async () => {
    const tx = {
      ...counterTx(41, 7),
      nrmsFiscalReceipt: {
        findFirst: vi.fn().mockResolvedValue({ id: 900 }),
        create: vi.fn(),
      },
    };
    expect(await enqueueFiscalReceipt(tx, input)).toBeNull();
    expect(tx.nrmsFiscalReceipt.create).not.toHaveBeenCalled();
    // Critically, no counter was consumed on the duplicate path.
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it("files a reversal as a credit note under its own source key", async () => {
    const tx = {
      ...counterTx(42, 8),
      nrmsFiscalReceipt: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 901 }),
      },
    };
    await enqueueFiscalReceipt(tx, { ...input, sourceType: "OUTLET_SALE_REVERSAL", replacesReceiptId: 900 });
    const data = tx.nrmsFiscalReceipt.create.mock.calls[0][0].data;
    expect(data.kind).toBe("CREDIT_NOTE");
    expect(data.sourceKey).toBe("OUTLET_VOID:12:8842");
    expect(data.replacesReceiptId).toBe(900);
  });
});

describe("fiscaliseSettlement", () => {
  const settle = {
    propertyId: 12,
    sourceType: "OUTLET_SALE",
    sourceId: 8842,
    saleOccurredAt: new Date("2026-08-28T09:00:00.000Z"),
    currency: "TZS",
    grossAmount: 45000,
  };

  function settleTx(connection: unknown) {
    return {
      ...counterTx(41, 7),
      nrmsFiscalConnection: { findUnique: vi.fn().mockResolvedValue(connection) },
      nrmsFiscalReceipt: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 900 }),
      },
    };
  }

  it("does nothing for a property that has never enabled fiscalisation", async () => {
    const tx = settleTx(null);
    expect(await fiscaliseSettlement(tx, settle)).toBeNull();
    expect(tx.nrmsFiscalReceipt.create).not.toHaveBeenCalled();
  });

  it("does nothing in ON_REQUEST, where staff issue the receipt by hand", async () => {
    const tx = settleTx({ id: 5, mode: "ON_REQUEST", status: "ACTIVE" });
    expect(await fiscaliseSettlement(tx, settle)).toBeNull();
    expect(tx.nrmsFiscalReceipt.create).not.toHaveBeenCalled();
  });

  it("queues in ALWAYS on an ACTIVE connection", async () => {
    const tx = settleTx({ id: 5, mode: "ALWAYS", status: "ACTIVE" });
    expect(await fiscaliseSettlement(tx, settle)).toEqual({ id: 900 });
    expect(tx.nrmsFiscalReceipt.create.mock.calls[0][0].data.connectionId).toBe(5);
  });

  it("ignores a money movement that is not a sale, without touching the connection", async () => {
    const tx = settleTx({ id: 5, mode: "ALWAYS", status: "ACTIVE" });
    expect(await fiscaliseSettlement(tx, { ...settle, sourceType: "FOLIO_CHARGE" })).toBeNull();
    expect(tx.nrmsFiscalConnection.findUnique).not.toHaveBeenCalled();
  });
});

describe("applyPendingFiscalDayTransitions", () => {
  const TODAY = new Date("2026-08-28T00:00:00.000Z");
  function bulkDb(deactivated = 0, activated = 1) {
    const updateMany = vi.fn()
      .mockResolvedValueOnce({ count: deactivated })
      .mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: activated }, (_, index) => ({ id: index + 1, pendingMode: "ALWAYS" })));
    return { nrmsFiscalConnection: { updateMany, findMany } };
  }

  it("switches off before switching on, so a same-day pair lands off", async () => {
    // Worst case a property fiscalises less than it meant to, which is visible
    // and fixable, rather than more than it meant to, which is neither.
    const db = bulkDb(1, 1);
    await applyPendingFiscalDayTransitions(db, TODAY);
    expect(db.nrmsFiscalConnection.updateMany.mock.calls[0][0].data).toMatchObject({ mode: "OFF", status: "DISABLED" });
    expect(db.nrmsFiscalConnection.updateMany.mock.calls[1][0].data).toMatchObject({ mode: "ALWAYS", status: "ACTIVE" });
  });

  it("only promotes connections whose date has arrived", async () => {
    const db = bulkDb();
    await applyPendingFiscalDayTransitions(db, TODAY);
    const activate = db.nrmsFiscalConnection.findMany.mock.calls[0][0].where;
    expect(activate.activatesOnBusinessDate).toEqual({ lte: TODAY });
  });

  it("only applies a scheduled mode to an eligible connection state", async () => {
    const db = bulkDb();
    await applyPendingFiscalDayTransitions(db, TODAY);
    expect(db.nrmsFiscalConnection.findMany.mock.calls[0][0].where.status).toEqual({ in: ["VALIDATED", "ACTIVE", "FAILED"] });
    expect(db.nrmsFiscalConnection.findMany.mock.calls[0][0].where.pendingMode).toEqual({ in: ["ALWAYS", "ON_REQUEST"] });
  });

  it("clears the scheduled date once it has been applied", async () => {
    const db = bulkDb();
    await applyPendingFiscalDayTransitions(db, TODAY);
    expect(db.nrmsFiscalConnection.updateMany.mock.calls[1][0].data.activatesOnBusinessDate).toBeNull();
  });

  it("reports what it changed", async () => {
    const db = bulkDb(2, 3);
    expect(await applyPendingFiscalDayTransitions(db, TODAY)).toEqual({ deactivated: 2, activated: 3 });
  });
});

describe("burnFiscalReceipt", () => {
  it("keeps the row and records why the number was consumed", async () => {
    const tx = { nrmsFiscalReceipt: { update: vi.fn().mockResolvedValue({}) } };
    await burnFiscalReceipt(tx, 900, "Settlement rolled back after allocation");
    expect(tx.nrmsFiscalReceipt.update).toHaveBeenCalledWith({
      where: { id: 900 },
      data: { status: "BURNED", burnReason: "Settlement rolled back after allocation" },
    });
  });
});

describe("mode gates", () => {
  it("only auto-fiscalises an ACTIVE connection in ALWAYS", () => {
    expect(shouldAutoFiscalise({ mode: "ALWAYS", status: "ACTIVE" })).toBe(true);
    expect(shouldAutoFiscalise({ mode: "ON_REQUEST", status: "ACTIVE" })).toBe(false);
    // Activation lands on a business-day boundary, so VALIDATED is not yet live.
    expect(shouldAutoFiscalise({ mode: "ALWAYS", status: "VALIDATED" })).toBe(false);
    expect(shouldAutoFiscalise({ mode: "ALWAYS", status: "SUSPENDED" })).toBe(false);
    // No row at all is the state of every property today.
    expect(shouldAutoFiscalise(null)).toBe(false);
  });

  it("offers the manual action in both live modes", () => {
    expect(canIssueOnRequest({ mode: "ON_REQUEST", status: "ACTIVE" })).toBe(true);
    expect(canIssueOnRequest({ mode: "ALWAYS", status: "ACTIVE" })).toBe(true);
    expect(canIssueOnRequest({ mode: "OFF", status: "ACTIVE" })).toBe(false);
    expect(canIssueOnRequest(null)).toBe(false);
  });
});

describe("retry schedule", () => {
  it("backs off and then stops for a human", () => {
    const from = new Date("2026-08-28T09:00:00.000Z");
    // The argument counts the failure that just happened, so attempt 1 waits the
    // first step rather than the second.
    expect(nextFiscalAttemptAt(1, from).toISOString()).toBe("2026-08-28T09:01:00.000Z");
    expect(nextFiscalAttemptAt(2, from).toISOString()).toBe("2026-08-28T09:05:00.000Z");
    expect(nextFiscalAttemptAt(3, from).toISOString()).toBe("2026-08-28T09:15:00.000Z");
    // Clamped rather than running off the end of the table.
    expect(nextFiscalAttemptAt(99, from).toISOString()).toBe("2026-08-28T15:00:00.000Z");
    expect(isFiscalDeadLetter(5)).toBe(false);
    expect(isFiscalDeadLetter(6)).toBe(true);
  });
});

describe("resolveFiscalSource", () => {
  it("scopes every branch to the property, so another hotel's id resolves to nothing", async () => {
    const db = {
      nrmsOutletOrder: { findFirst: vi.fn().mockResolvedValue(null) },
      externalPaymentRecord: { findFirst: vi.fn().mockResolvedValue(null) },
      nrmsMasterFolioPayment: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    expect(await resolveFiscalSource(db, 12, "OUTLET_SALE", 1)).toBeNull();
    expect(db.nrmsOutletOrder.findFirst.mock.calls[0][0].where).toMatchObject({ propertyId: 12 });
    await resolveFiscalSource(db, 12, "FOLIO_PAYMENT", 1);
    expect(db.externalPaymentRecord.findFirst.mock.calls[0][0].where).toMatchObject({ reservation: { propertyId: 12 } });
    await resolveFiscalSource(db, 12, "MASTER_FOLIO_PAYMENT", 1);
    expect(db.nrmsMasterFolioPayment.findFirst.mock.calls[0][0].where).toMatchObject({ masterFolio: { propertyId: 12 } });
  });

  it("ignores voided payments, which are not a taxable event", async () => {
    const db = { externalPaymentRecord: { findFirst: vi.fn().mockResolvedValue(null) } };
    await resolveFiscalSource(db, 12, "FOLIO_PAYMENT", 1);
    expect(db.externalPaymentRecord.findFirst.mock.calls[0][0].where).toMatchObject({ voidedAt: null });
  });

  it("only accepts an outlet order that actually settled with a tender", async () => {
    const db = { nrmsOutletOrder: { findFirst: vi.fn().mockResolvedValue(null) } };
    await resolveFiscalSource(db, 12, "OUTLET_SALE", 1);
    expect(db.nrmsOutletOrder.findFirst.mock.calls[0][0].where).toMatchObject({
      settlementMode: "OUTLET_PAYMENT",
      status: "SETTLED",
    });
  });

  it("returns the moment the money moved, not the moment of the request", async () => {
    const settledAt = new Date("2026-08-24T11:00:00.000Z");
    const db = {
      nrmsOutletOrder: { findFirst: vi.fn().mockResolvedValue({ settledAt, currency: "TZS", total: 45000, orderNumber: "BAR-1", customerLabel: "Table 4" }) },
    };
    expect(await resolveFiscalSource(db, 12, "OUTLET_SALE", 1)).toEqual({
      saleOccurredAt: settledAt,
      currency: "TZS",
      grossAmount: 45000,
      label: "BAR-1 · Table 4",
    });
  });

  it("refuses a source type that is not a sale", async () => {
    expect(await resolveFiscalSource({}, 12, "FOLIO_CHARGE", 1)).toBeNull();
  });
});

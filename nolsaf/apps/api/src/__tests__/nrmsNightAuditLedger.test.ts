import { describe, expect, it, vi } from "vitest";
import { createNightAuditLedgerTransactions } from "../lib/nrmsNightAuditLedger.js";

describe("createNightAuditLedgerTransactions", () => {
  it("inserts headers before entries and maps entry FKs by source key", async () => {
    const calls: string[] = [];
    const createHeaders = vi.fn().mockImplementation(async () => { calls.push("headers"); });
    const findHeaders = vi.fn().mockImplementation(async () => {
      calls.push("find");
      return [{ id: 32, sourceKey: "payment:45" }, { id: 31, sourceKey: "reservation:44:room-revenue" }];
    });
    const createEntries = vi.fn().mockImplementation(async () => { calls.push("entries"); });
    const tx = { nrmsLedgerTransaction: { createMany: createHeaders, findMany: findHeaders }, nrmsLedgerEntry: { createMany: createEntries } };
    const data = {
      propertyId: 2,
      businessDayId: 9,
      nightAuditRunId: 14,
      transactionNumber: "GL-20260721-0001-A1B2",
      sourceKey: "reservation:44:room-revenue",
      sourceType: "ROOM_REVENUE",
      sourceId: 44,
      description: "Room revenue",
      currency: "TZS",
      occurredAt: new Date("2026-07-21T12:00:00.000Z"),
      entries: [
        { accountCode: "1100", accountName: "Receivable", accountType: "ASSET", debit: 100, credit: 0 },
        { accountCode: "4000", accountName: "Revenue", accountType: "REVENUE", debit: 0, credit: 100 },
      ],
    };

    await createNightAuditLedgerTransactions(tx, [data, { ...data, sourceKey: "payment:45", transactionNumber: "GL-20260721-0002-A1B2" }]);
    expect(calls).toEqual(["headers", "find", "entries"]);
    expect(createHeaders).toHaveBeenCalledWith({ data: [
      expect.not.objectContaining({ entries: expect.anything() }),
      expect.not.objectContaining({ entries: expect.anything() }),
    ] });
    expect(createEntries).toHaveBeenCalledWith({ data: [
      { ...data.entries[0], transactionId: 31 },
      { ...data.entries[1], transactionId: 31 },
      { ...data.entries[0], transactionId: 32 },
      { ...data.entries[1], transactionId: 32 },
    ] });
  });

  it("does not insert entries if any header cannot be resolved", async () => {
    const createEntries = vi.fn();
    const tx = {
      nrmsLedgerTransaction: { createMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
      nrmsLedgerEntry: { createMany: createEntries },
    };
    const data = {
      propertyId: 2, businessDayId: 9, nightAuditRunId: 14,
      transactionNumber: "GL-20260721-0001-A1B2", sourceKey: "reservation:44:room-revenue",
      sourceType: "ROOM_REVENUE", sourceId: 44, description: "Room revenue", currency: "TZS",
      occurredAt: new Date("2026-07-21T12:00:00.000Z"),
      entries: [{ accountCode: "1100", accountName: "Receivable", accountType: "ASSET", debit: 100, credit: 0 }],
    };
    await expect(createNightAuditLedgerTransactions(tx, [data])).rejects.toThrow("NIGHT_AUDIT_LEDGER_HEADERS_MISSING");
    expect(createEntries).not.toHaveBeenCalled();
  });
});

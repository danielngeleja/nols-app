import { describe, expect, it, vi } from "vitest";
import { createNightAuditLedgerTransaction, requireNightAuditLedgerParent } from "../lib/nrmsNightAuditLedger.js";

function transactionMock(overrides: Record<string, unknown> = {}) {
  return {
    nrmsNightAuditRun: {
      findUnique: vi.fn().mockResolvedValue({ id: 14, propertyId: 2, businessDayId: 9 }),
    },
    nrmsLedgerTransaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 31 }),
      ...overrides,
    },
  };
}

describe("requireNightAuditLedgerParent", () => {
  it("accepts the parent created on the same transaction connection", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 14, propertyId: 2, businessDayId: 9 });

    await expect(requireNightAuditLedgerParent(
      { ...transactionMock(), nrmsNightAuditRun: { findUnique } },
      { auditId: 14, propertyId: 2, businessDayId: 9 },
    )).resolves.toEqual({ id: 14, propertyId: 2, businessDayId: 9 });

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 14 },
      select: { id: true, propertyId: true, businessDayId: true },
    });
  });

  it("fails before ledger insertion when the parent is not visible", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);

    await expect(requireNightAuditLedgerParent(
      { ...transactionMock(), nrmsNightAuditRun: { findUnique } },
      { auditId: 14, propertyId: 2, businessDayId: 9 },
    )).rejects.toThrow(
      "Night Audit parent is not visible in the ledger transaction (auditId=14, propertyId=2, businessDayId=9)",
    );
  });

  it("checks idempotency and then uses a direct create with the verified scalar parent id", async () => {
    const tx = transactionMock();
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
      entries: { create: [{ accountCode: "1100" }, { accountCode: "4000" }] },
    };

    await expect(createNightAuditLedgerTransaction(tx, data)).resolves.toEqual({ id: 31 });
    expect(tx.nrmsLedgerTransaction.findUnique).toHaveBeenCalledWith({
      where: { sourceKey: data.sourceKey },
      select: { id: true },
    });
    expect(tx.nrmsLedgerTransaction.create).toHaveBeenCalledWith({ data });
    expect(tx.nrmsLedgerTransaction.findUnique.mock.invocationCallOrder[0])
      .toBeLessThan(tx.nrmsLedgerTransaction.create.mock.invocationCallOrder[0]);
  });

  it("rejects an existing source key instead of reusing an old ledger posting", async () => {
    const tx = transactionMock({ findUnique: vi.fn().mockResolvedValue({ id: 31 }) });
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
      entries: { create: [] },
    };

    await expect(createNightAuditLedgerTransaction(tx, data)).rejects.toThrow(
      "Ledger source was already posted (sourceKey=reservation:44:room-revenue, transactionId=31)",
    );
    expect(tx.nrmsLedgerTransaction.create).not.toHaveBeenCalled();
  });
});

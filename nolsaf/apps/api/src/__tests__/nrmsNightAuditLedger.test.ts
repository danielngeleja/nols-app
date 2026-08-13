import { describe, expect, it, vi } from "vitest";
import { createNightAuditLedgerTransaction } from "../lib/nrmsNightAuditLedger.js";

describe("createNightAuditLedgerTransaction", () => {
  it("uses a direct create with the audit parent id", async () => {
    const create = vi.fn().mockResolvedValue({ id: 31 });
    const tx = { nrmsLedgerTransaction: { create } };
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
    expect(create).toHaveBeenCalledWith({ data });
  });
});

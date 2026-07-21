import { describe, expect, it, vi } from "vitest";
import { requireNightAuditLedgerParent } from "../lib/nrmsNightAuditLedger.js";

describe("requireNightAuditLedgerParent", () => {
  it("accepts the parent created on the same transaction connection", async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 14, propertyId: 2, businessDayId: 9 });

    await expect(requireNightAuditLedgerParent(
      { nrmsNightAuditRun: { findUnique } },
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
      { nrmsNightAuditRun: { findUnique } },
      { auditId: 14, propertyId: 2, businessDayId: 9 },
    )).rejects.toThrow(
      "Night Audit parent is not visible in the ledger transaction (auditId=14, propertyId=2, businessDayId=9)",
    );
  });
});

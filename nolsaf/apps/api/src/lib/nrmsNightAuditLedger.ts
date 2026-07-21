type NightAuditParentExpectation = {
  auditId: number;
  propertyId: number;
  businessDayId: number;
};

type NightAuditTransactionClient = {
  nrmsNightAuditRun: {
    findUnique(args: unknown): Promise<{
      id: number;
      propertyId: number;
      businessDayId: number;
    } | null>;
  };
};

/**
 * Proves that the parent inserted earlier in the interactive transaction is
 * visible on that same transaction connection before any ledger child is
 * written. This turns an opaque MySQL P2003 into a precise invariant failure.
 */
export async function requireNightAuditLedgerParent(
  tx: NightAuditTransactionClient,
  expected: NightAuditParentExpectation,
) {
  const parent = await tx.nrmsNightAuditRun.findUnique({
    where: { id: expected.auditId },
    select: { id: true, propertyId: true, businessDayId: true },
  });

  if (
    !parent ||
    parent.propertyId !== expected.propertyId ||
    parent.businessDayId !== expected.businessDayId
  ) {
    const error = new Error(
      `Night Audit parent is not visible in the ledger transaction ` +
      `(auditId=${expected.auditId}, propertyId=${expected.propertyId}, ` +
      `businessDayId=${expected.businessDayId})`,
    );
    error.name = "NightAuditLedgerParentError";
    throw error;
  }

  return parent;
}

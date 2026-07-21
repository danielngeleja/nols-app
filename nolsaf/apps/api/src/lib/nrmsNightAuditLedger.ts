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
  nrmsLedgerTransaction: {
    findUnique(args: unknown): Promise<{ id: number } | null>;
    create(args: unknown): Promise<unknown>;
  };
};

type NightAuditLedgerCreateData = {
  propertyId: number;
  businessDayId: number;
  nightAuditRunId: number;
  transactionNumber: string;
  sourceKey: string;
  sourceType: string;
  sourceId: number | null;
  description: string;
  currency: string;
  occurredAt: Date;
  entries: { create: unknown[] };
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

/**
 * Avoids Prisma's upsert query plan for this parent/child write. The source key
 * remains idempotent, but a duplicate is treated as an accounting invariant
 * violation instead of silently attaching an old posting to a new audit.
 */
export async function createNightAuditLedgerTransaction(
  tx: NightAuditTransactionClient,
  data: NightAuditLedgerCreateData,
) {
  const existing = await tx.nrmsLedgerTransaction.findUnique({
    where: { sourceKey: data.sourceKey },
    select: { id: true },
  });

  if (existing) {
    const error = new Error(
      `Ledger source was already posted ` +
      `(sourceKey=${data.sourceKey}, transactionId=${existing.id})`,
    );
    error.name = "NightAuditLedgerDuplicateError";
    throw error;
  }

  return tx.nrmsLedgerTransaction.create({ data });
}

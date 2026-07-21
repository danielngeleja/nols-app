type NightAuditTransactionClient = {
  nrmsLedgerTransaction: {
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
 * Avoids Prisma's upsert query plan for this parent/child write. The database's
 * unique sourceKey constraint remains the idempotency guard; the entire audit
 * transaction rolls back if a duplicate is ever submitted.
 */
export async function createNightAuditLedgerTransaction(
  tx: NightAuditTransactionClient,
  data: NightAuditLedgerCreateData,
) {
  return tx.nrmsLedgerTransaction.create({ data });
}

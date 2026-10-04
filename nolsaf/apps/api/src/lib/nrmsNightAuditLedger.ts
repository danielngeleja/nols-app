type LedgerEntry = {
  accountCode: string;
  accountName: string;
  accountType: string;
  debit: number;
  credit: number;
  description?: string | null;
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
  entries: LedgerEntry[];
};

type NightAuditTransactionClient = {
  nrmsLedgerTransaction: {
    createMany(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<Array<{ id: number; sourceKey: string }>>;
  };
  nrmsLedgerEntry: {
    createMany(args: unknown): Promise<unknown>;
  };
};

const BATCH_SIZE = 200;

/** Insert headers before entries in the caller's atomic Night Audit transaction. */
export async function createNightAuditLedgerTransactions(
  tx: NightAuditTransactionClient,
  postings: NightAuditLedgerCreateData[],
) {
  for (let start = 0; start < postings.length; start += BATCH_SIZE) {
    const batch = postings.slice(start, start + BATCH_SIZE);
    const headers = batch.map(({ entries: _entries, ...header }) => header);
    await tx.nrmsLedgerTransaction.createMany({ data: headers });

    const saved = await tx.nrmsLedgerTransaction.findMany({
      where: { sourceKey: { in: batch.map((posting) => posting.sourceKey) } },
      select: { id: true, sourceKey: true },
    });
    const ids = new Map(saved.map((row) => [row.sourceKey, row.id]));
    if (ids.size !== batch.length) throw new Error("NIGHT_AUDIT_LEDGER_HEADERS_MISSING");

    const entries = batch.flatMap((posting) => {
      const transactionId = ids.get(posting.sourceKey);
      if (transactionId === undefined) throw new Error("NIGHT_AUDIT_LEDGER_HEADERS_MISSING");
      return posting.entries.map((entry) => ({ ...entry, transactionId }));
    });
    for (let offset = 0; offset < entries.length; offset += BATCH_SIZE) {
      await tx.nrmsLedgerEntry.createMany({ data: entries.slice(offset, offset + BATCH_SIZE) });
    }
  }
}

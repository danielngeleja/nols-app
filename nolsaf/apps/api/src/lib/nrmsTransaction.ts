// Scoped limits: do not relax transaction deadlines for the entire application.
export const NRMS_PAYMENT_TRANSACTION_OPTIONS = { maxWait: 5_000, timeout: 15_000 };
export const COMMISSION_TRANSACTION_OPTIONS = { maxWait: 2_000, timeout: 10_000 };

export function isTransactionCapacityError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "P2028" || code === "P2024";
}

export async function runNrmsPaymentTransaction<T>(
  client: any,
  tokenId: number,
  callback: (tx: any) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let acquiredAt: number | null = null;
  let outcome = "failed";
  try {
    const result = await client.$transaction(async (tx: any) => {
      acquiredAt = Date.now();
      return callback(tx);
    }, NRMS_PAYMENT_TRANSACTION_OPTIONS);
    outcome = "committed";
    return result;
  } finally {
    console.info(JSON.stringify({
      event: "nrms_payment_transaction", tokenId, outcome,
      durationMs: Date.now() - startedAt,
      acquisitionMs: acquiredAt === null ? null : acquiredAt - startedAt,
      transactionMs: acquiredAt === null ? null : Date.now() - acquiredAt,
    }));
  }
}

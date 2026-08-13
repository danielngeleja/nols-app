/**
 * Payment amounts are compared as whole TZS using the same tolerance on every
 * settlement entry point. Keeping this pure makes it safe to reuse in webhook,
 * reconciliation, and adversarial tests.
 */
export function expectedInvoicePaymentAmount(invoice: { total?: unknown; netPayable?: unknown }): number {
  return Math.round(Number(invoice.total || invoice.netPayable || 0));
}

/** Allow up to 1% drift or TZS 10, whichever is larger, capped at TZS 500. */
export function isPaymentAmountWithinTolerance(received: number, expected: number): boolean {
  if (!Number.isFinite(received) || !Number.isFinite(expected) || expected <= 0) return false;
  const percentTolerance = expected * 0.01;
  const absoluteTolerance = Math.min(Math.max(percentTolerance, 10), 500);
  return Math.abs(received - expected) <= absoluteTolerance;
}

export class PaymentAmountMismatchError extends Error {
  readonly code = "PAYMENT_AMOUNT_MISMATCH";

  constructor(readonly expected: number, readonly received: number) {
    super(`Payment amount mismatch: expected ${expected} TZS, received ${received} TZS`);
    this.name = "PaymentAmountMismatchError";
  }
}

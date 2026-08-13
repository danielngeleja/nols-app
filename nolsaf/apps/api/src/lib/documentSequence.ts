/**
 * Atomic allocator for customer-facing document numbers.
 *
 * Replaces deriving a receipt number from COUNT(*) WHERE status='PAID', which
 * had two failure modes: two invoices settling in the same moment derived the
 * same string and collided on invoice.receiptNumber (UNIQUE), failing a real
 * payment; and the count dropped whenever an invoice left PAID, so the same
 * number could be derived again on a later day.
 *
 * Requires the `document_sequence` table (migration 20260811230000). Apply that
 * migration BEFORE deploying code that calls this.
 *
 * Guarantees: unique and monotonic per (scope, period). NOT gapless. A number is
 * consumed at allocation, so a settlement that fails afterwards burns it. That
 * is the right trade for a commercial receipt; a gapless fiscal series would
 * need the number allocated inside the committing transaction plus an explicit
 * void register.
 */

import { prisma } from "@nolsaf/prisma";

/**
 * Reserve the next value for a (scope, period) pair.
 *
 * Two MySQL details drive the shape of this:
 *
 *  1. Both statements MUST share one connection, so this runs in an interactive
 *     transaction. Prisma pools connections, and an INSERT followed by a bare
 *     SELECT can otherwise land on different ones.
 *
 *  2. It deliberately does NOT use LAST_INSERT_ID(lastValue + 1). That idiom
 *     only works on the ON DUPLICATE KEY branch; on a genuine INSERT (the first
 *     receipt of a new year) LAST_INSERT_ID() returns the new row's
 *     AUTO_INCREMENT id instead, which silently hands out a wrong number. The
 *     upsert-then-select below is correct on both branches: the row is locked by
 *     the write until commit, so the SELECT reads our own value and no
 *     concurrent allocation can slip in between.
 *
 * The transaction is kept to these two statements on purpose. Holding the row
 * lock across QR generation or mail would serialize every settlement.
 */
export async function allocateSequenceValue(scope: string, period: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO document_sequence (scope, period, lastValue, createdAt, updatedAt)
      VALUES (${scope}, ${period}, 1, NOW(3), NOW(3))
      ON DUPLICATE KEY UPDATE lastValue = lastValue + 1, updatedAt = NOW(3)
    `;
    const rows = await tx.$queryRaw<Array<{ lastValue: number }>>`
      SELECT lastValue FROM document_sequence WHERE scope = ${scope} AND period = ${period}
    `;
    const value = Number(rows[0]?.lastValue);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`document_sequence returned no value for ${scope}/${period}`);
    }
    return value;
  });
}

/**
 * Format a receipt number exactly as every receipt already issued:
 * `RCPT/2026/00042`. Padding stays at 5 digits so numbers within a year keep
 * sorting as strings; widen it at a year boundary if you ever need the headroom,
 * never mid-year.
 */
export function formatReceiptNumber(period: string, value: number): string {
  return `RCPT/${period}/${String(value).padStart(5, "0")}`;
}

/** Calendar year is the reset boundary for receipts. */
export function receiptPeriodFor(when: Date = new Date()): string {
  return String(when.getFullYear());
}

/**
 * Allocate and format the next receipt number. The single place a receipt number
 * is produced; three separate copies of a count()-based helper used to exist.
 */
export async function allocateReceiptNumber(when: Date = new Date()): Promise<string> {
  const period = receiptPeriodFor(when);
  const value = await allocateSequenceValue("RCPT", period);
  return formatReceiptNumber(period, value);
}

/**
 * Keeps the bringing partner's long-stay share in line with the tenancy
 * (docs/LONG_STAY_RENTALS.md section 14): earned at confirmed move-in,
 * reversed if the first month is later refunded or the tenancy stops counting
 * as a move-in. Called next to the revenue ledger sync and by the sales
 * commission worker as a safety net. Both directions are idempotent.
 */
import { COMMISSION_TRANSACTION_OPTIONS } from "../nrmsTransaction.js";
import {
  TENANCY_SHARE_SELECT,
  accrueLongStaySalesCommission,
  autoReverseSalesCommission,
  longStayShareSourceKey,
} from "../salesCommission.js";
import { longStayRevenueFigures } from "./revenueFigures.js";

export type LongStayShareOutcome = "ACCRUED" | "REVERSED" | "OFFSET" | "LOCKED" | "UNCHANGED";

/** Works with the client or inside a transaction a caller already opened. */
function inTransaction<T>(db: any, work: (tx: any) => Promise<T>): Promise<T> {
  return typeof db.$transaction === "function" ? db.$transaction(work, COMMISSION_TRANSACTION_OPTIONS) : work(db);
}

export async function syncLongStaySalesCommission(db: any, tenancyId: number, now = new Date()): Promise<LongStayShareOutcome> {
  const tenancy = await db.tenancy.findUnique({ where: { id: tenancyId }, select: TENANCY_SHARE_SELECT });
  if (!tenancy) return "UNCHANGED";
  const figures = longStayRevenueFigures(tenancy);

  if (figures?.kind === "MOVE_IN") {
    const result = await inTransaction(db, (tx) => accrueLongStaySalesCommission(tx, tenancyId));
    return result.created ? "ACCRUED" : "UNCHANGED";
  }

  const existing = await db.salesCommission.findUnique({ where: { sourceKey: longStayShareSourceKey(tenancyId) } });
  if (!existing || existing.reversalOfId || ["REVERSED", "CANCELLED"].includes(existing.status)) return "UNCHANGED";
  const reason = tenancy.payoutStatus === "REFUND_DUE" || tenancy.payoutStatus === "REFUNDED"
    ? `The first month of tenancy ${tenancy.publicRef} was refunded to the tenant.`
    : `Tenancy ${tenancy.publicRef} no longer counts as a move-in.`;
  return inTransaction(db, (tx) => autoReverseSalesCommission(tx, existing.id, reason, now));
}

/**
 * Landlord payout of the first month (docs/LONG_STAY_RENTALS.md section 5.3,
 * milestone 7).
 *
 * Tenancy payoutStatus:
 *   HELD     paid by the tenant, before move-in is confirmed
 *   READY    move-in confirmed and the balance matched the lease
 *   REVIEW   a mismatch or a dispute: an admin must look first
 *   APPROVED an admin approved it; a TENANCY disbursement goes through the
 *            shared payout ledger (batching, fingerprint, authorisation)
 *   RELEASED the landlord was paid (by the ledger, or recorded by hand)
 *   REFUND_DUE / REFUNDED   the money goes back to the tenant instead
 *
 * During the pilot every long-stay payout is approved by an admin. AzamPay
 * pays out TZS to mobile money only, so a USD tenancy is paid by bank outside
 * NoLSAF and recorded here by hand, with its reference.
 */
import { TenancyError } from "./tenancyService.js";
import { cancellationOf } from "./revenueFigures.js";
import { applyClaimRecovery, planClaimRecovery, revertClaimRecovery } from "./claims.js";

const PAYABLE_TENANCY_STATUSES = ["ACTIVE", "ENDING", "ENDED", "OVERDUE"];

/** Moved in, or cancelled late by the tenant (the landlord keeps the first month less 5%). */
function payable(tenancy: any): boolean {
  if (PAYABLE_TENANCY_STATUSES.includes(tenancy.status)) return true;
  const c = cancellationOf(tenancy);
  return tenancy.status === "CANCELLED" && Boolean(c && c.landlordPayout > 0);
}

/** What NoLSAF owes the landlord: the frozen first-month payout, never more than was paid. */
export function landlordPayoutGross(tenancy: any): number {
  const c = cancellationOf(tenancy);
  const payout = c ? Number(c.landlordPayout ?? 0) : Number((tenancy?.termsSnapshot as any)?.landlordPayout ?? 0);
  const paid = Number(tenancy?.paidAmount ?? 0);
  const rent = Number(tenancy?.monthlyRent ?? 0);
  if (!(payout > 0) || !(paid > 0) || payout > paid || payout > rent) return 0;
  return payout;
}

/** What the landlord actually receives: the payout less what went to their open claims. */
export function landlordPayoutOf(tenancy: any): number {
  const gross = landlordPayoutGross(tenancy);
  const deduction = Number(tenancy?.payoutDeduction ?? 0);
  return Math.max(0, Math.round((gross - (deduction > 0 ? deduction : 0)) * 100) / 100);
}

/** The landlord's verified, active mobile-money account (default first). */
export async function landlordPayoutAccount(db: any, landlordId: number) {
  const accounts = await db.payoutAccount.findMany({
    where: { userId: landlordId, isActive: true, isVerified: true, type: "MOBILE_MONEY" },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    take: 1,
  });
  return accounts[0] ?? null;
}

/**
 * Admin approves the payout. For TZS it requests a TENANCY disbursement in the
 * shared ledger (which then needs the usual approval and batch release). The
 * status flip is compare-and-set, so it can only happen once.
 */
export async function approveTenancyPayout(
  db: any,
  tenancy: any,
  adminId: number,
  requestDisbursement: (params: { sourceType: "TENANCY"; sourceId: number; payoutAccountId: number; requestedById: number; remarks?: string }) => Promise<{ id: number }>,
) {
  if (!payable(tenancy)) throw new TenancyError("Move-in is not confirmed yet.", 409);
  if (!["READY", "REVIEW"].includes(tenancy.payoutStatus)) throw new TenancyError(`The payout is ${String(tenancy.payoutStatus).toLowerCase()}, not waiting for approval.`, 409);
  const gross = landlordPayoutGross(tenancy);
  if (!(gross > 0)) throw new TenancyError("There is no payout amount on this tenancy.", 409);
  if (String(tenancy.currency).toUpperCase() !== "TZS") throw new TenancyError("USD payouts go by bank outside NoLSAF. Pay it, then record it by hand.", 409);
  const account = await landlordPayoutAccount(db, tenancy.landlordId);
  if (!account) throw new TenancyError("The landlord has no verified mobile money account to pay into.", 409);

  // The landlord's unpaid claims on other tenancies come out of this payout first.
  const recovery = await planClaimRecovery(db, tenancy.landlordId, tenancy.currency, gross, tenancy.id);
  const net = Math.round((gross - recovery.total) * 100) / 100;
  const flipped = await db.tenancy.updateMany({
    where: { id: tenancy.id, payoutStatus: tenancy.payoutStatus, version: tenancy.version },
    data: net > 0
      ? { payoutStatus: "APPROVED", payoutDeduction: recovery.total || null, version: { increment: 1 } }
      : { payoutStatus: "RELEASED", payoutDeduction: recovery.total, payoutAmount: 0, payoutReleasedAt: new Date(), version: { increment: 1 } },
  });
  if (flipped.count !== 1) throw new TenancyError("This payout changed a moment ago. Refresh.", 409);
  await applyClaimRecovery(db, recovery.allocations);
  if (recovery.allocations.length) {
    await db.tenancyEvent.create({ data: { tenancyId: tenancy.id, actorId: adminId, actorRole: "ADMIN", type: "PAYOUT_DEDUCTION", data: { allocations: recovery.allocations, total: recovery.total } } });
  }
  if (!(net > 0)) return { disbursementId: null, recovered: recovery.total, net: 0 };
  try {
    const disbursement = await requestDisbursement({ sourceType: "TENANCY", sourceId: tenancy.id, payoutAccountId: account.id, requestedById: adminId, remarks: `Long stay ${tenancy.publicRef}` });
    await db.tenancyEvent.create({ data: { tenancyId: tenancy.id, actorId: adminId, actorRole: "ADMIN", type: "PAYOUT_APPROVED", data: { disbursementId: disbursement.id, amount: net, recovered: recovery.total } } });
    return { disbursementId: disbursement.id, recovered: recovery.total, net };
  } catch (error) {
    // Put everything back so the admin can try again once the cause is fixed.
    await db.tenancy.updateMany({ where: { id: tenancy.id, payoutStatus: "APPROVED" }, data: { payoutStatus: tenancy.payoutStatus, payoutDeduction: tenancy.payoutDeduction ?? null } });
    await revertClaimRecovery(db, recovery.allocations);
    throw error;
  }
}

/** A payout made outside NoLSAF (USD by bank), recorded with its reference. */
export async function recordManualPayout(db: any, tenancy: any, adminId: number, reference: string, now = new Date()) {
  if (!payable(tenancy)) throw new TenancyError("Move-in is not confirmed yet.", 409);
  if (!["READY", "REVIEW"].includes(tenancy.payoutStatus)) throw new TenancyError("This payout is not waiting.", 409);
  const gross = landlordPayoutGross(tenancy);
  if (!(gross > 0)) throw new TenancyError("There is no payout amount on this tenancy.", 409);
  const recovery = await planClaimRecovery(db, tenancy.landlordId, tenancy.currency, gross, tenancy.id);
  const amount = Math.round((gross - recovery.total) * 100) / 100;
  const done = await db.tenancy.updateMany({
    where: { id: tenancy.id, payoutStatus: tenancy.payoutStatus, version: tenancy.version },
    data: { payoutStatus: "RELEASED", payoutAmount: amount, payoutDeduction: recovery.total || null, payoutReleasedAt: now, version: { increment: 1 } },
  });
  if (done.count !== 1) throw new TenancyError("This payout changed a moment ago. Refresh.", 409);
  await applyClaimRecovery(db, recovery.allocations);
  await db.tenancyEvent.create({ data: { tenancyId: tenancy.id, actorId: adminId, actorRole: "ADMIN", type: "PAYOUT_RECORDED", data: { reference, amount, recovered: recovery.total, allocations: recovery.allocations, currency: tenancy.currency } } });
  return { amount, recovered: recovery.total };
}

/** Payout-ledger eligibility for a TENANCY disbursement (services/payouts/eligibility.ts). */
export async function tenancyPayoutSource(db: any, tenancyId: number) {
  const tenancy = await db.tenancy.findUnique({ where: { id: tenancyId } });
  if (!tenancy) return { ok: false as const, reason: "not found" };
  if (tenancy.payoutStatus !== "APPROVED") return { ok: false as const, reason: `payoutStatus is ${tenancy.payoutStatus}, not APPROVED` };
  if (!payable(tenancy)) return { ok: false as const, reason: `status is ${tenancy.status}` };
  if (String(tenancy.currency).toUpperCase() !== "TZS") return { ok: false as const, reason: "only TZS can be paid through AzamPay" };
  const amount = landlordPayoutOf(tenancy);
  if (!(amount > 0)) return { ok: false as const, reason: "no payout amount" };
  return { ok: true as const, payeeUserId: tenancy.landlordId as number, amount, currency: "TZS" };
}

/** Ledger write-back when a TENANCY disbursement is PAID. Idempotent. */
export async function markTenancyPayoutPaid(tx: any, tenancyId: number, amount: number, reference: string, now: Date) {
  const updated = await tx.tenancy.updateMany({
    where: { id: tenancyId, payoutStatus: "APPROVED" },
    data: { payoutStatus: "RELEASED", payoutAmount: amount, payoutReleasedAt: now },
  });
  if (updated.count === 1) {
    await tx.tenancyEvent.create({ data: { tenancyId, actorRole: "SYSTEM", type: "PAYOUT_PAID", data: { reference, amount } } });
  }
  return updated.count === 1;
}

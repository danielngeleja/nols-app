/**
 * Claims under the lease after move-in (docs/LONG_STAY_RENTALS.md section 6.6,
 * milestone 8). NoLSAF never refunds money it does not hold. An admin confirms
 * what the landlord owes the tenant (unused prepaid months, a balance to give
 * back); the landlord has 14 days to pay it directly. After that the landlord's
 * long stays are paused and the claim is recovered from the landlord's next
 * long-stay payouts, which NoLSAF then passes to the tenant.
 */
import { z } from "zod";
import { TenancyError } from "./tenancyService.js";

export const CLAIM_DUE_DAYS = 14;
export const claimSchema = z.object({
  kind: z.enum(["UNUSED_RENT", "BALANCE_RETURN", "OTHER"]),
  amount: z.coerce.number().positive(),
  reason: z.string().trim().min(10).max(500),
}).strict();
export const claimCloseSchema = z.object({
  outcome: z.enum(["SETTLED", "WAIVED", "PAID_TO_TENANT"]),
  note: z.string().trim().min(5).max(500),
}).strict();

const OPEN = ["OPEN", "RECOVERING"];

function scale(currency: string) {
  return String(currency).toUpperCase() === "TZS" ? 1 : 100;
}
function round(value: number, currency: string) {
  const s = scale(currency);
  return Math.round(value * s) / s;
}

export async function openClaim(db: any, tenancy: any, adminId: number, input: { kind: string; amount: number; reason: string }, now = new Date()) {
  if (!["ACTIVE", "ENDING", "ENDED", "OVERDUE", "DISPUTED"].includes(tenancy.status) || !tenancy.moveInConfirmedAt) {
    throw new TenancyError("Claims are for a tenancy that has moved in.", 409);
  }
  const amount = round(Number(input.amount), tenancy.currency);
  const ceiling = Number(tenancy.monthlyRent ?? 0) * Number(tenancy.termMonths ?? 0);
  if (!(amount > 0) || amount > ceiling) throw new TenancyError("The amount must be above zero and within the lease's rent.");
  return db.tenancyClaim.create({
    data: {
      tenancyId: tenancy.id,
      landlordId: tenancy.landlordId,
      tenantId: tenancy.tenantId,
      kind: input.kind,
      amount,
      currency: tenancy.currency,
      reason: input.reason,
      status: "OPEN",
      dueAt: new Date(now.getTime() + CLAIM_DUE_DAYS * 86_400_000),
      createdById: adminId,
    },
  });
}

/**
 * SETTLED: the landlord paid the tenant directly. WAIVED: an admin dropped it.
 * PAID_TO_TENANT: NoLSAF passed the recovered amount to the tenant.
 */
export async function closeClaim(db: any, claim: any, outcome: "SETTLED" | "WAIVED" | "PAID_TO_TENANT", note: string, now = new Date()) {
  if (outcome === "PAID_TO_TENANT") {
    if (claim.status !== "RECOVERED" || claim.closedAt) throw new TenancyError("Only a fully recovered claim can be marked paid to the tenant.", 409);
    await db.tenancyClaim.updateMany({ where: { id: claim.id, status: "RECOVERED", closedAt: null }, data: { closedAt: now, closedNote: note } });
    return;
  }
  if (!OPEN.includes(claim.status)) throw new TenancyError("This claim is already closed.", 409);
  if (outcome === "SETTLED" && Number(claim.recoveredAmount) > 0) throw new TenancyError("Part of this claim was already recovered from a payout; pass that to the tenant first.", 409);
  const done = await db.tenancyClaim.updateMany({ where: { id: claim.id, status: { in: OPEN } }, data: { status: outcome, closedAt: now, closedNote: note } });
  if (done.count !== 1) throw new TenancyError("This claim changed a moment ago. Refresh.", 409);
}

/** Worker: an unpaid claim past due pauses the landlord's long stays and starts recovery. */
export async function escalateOverdueClaims(db: any, now = new Date(), onEscalate?: (claim: any) => Promise<unknown>) {
  const due = await db.tenancyClaim.findMany({ where: { status: "OPEN", dueAt: { lt: now }, escalatedAt: null }, take: 200 });
  let escalated = 0;
  for (const claim of due) {
    const moved = await db.tenancyClaim.updateMany({ where: { id: claim.id, status: "OPEN", escalatedAt: null }, data: { status: "RECOVERING", escalatedAt: now } });
    if (moved.count !== 1) continue;
    const grant = await db.longStayLandlordGrant.findUnique({ where: { userId: claim.landlordId } });
    if (grant && !grant.pausedAt) {
      await db.longStayLandlordGrant.update({ where: { userId: claim.landlordId }, data: { pausedAt: now, pauseReason: "An unpaid long-stay claim is past due" } });
    }
    escalated += 1;
    if (onEscalate) await onEscalate(claim).catch(() => undefined);
  }
  return { escalated };
}

/**
 * How much of a landlord payout goes to their open claims, oldest first, in
 * the payout's currency. Returns the allocations; nothing is written.
 */
export async function planClaimRecovery(db: any, landlordId: number, currency: string, payout: number, excludeTenancyId: number) {
  const claims = await db.tenancyClaim.findMany({
    where: { landlordId, status: { in: OPEN }, currency, tenancyId: { not: excludeTenancyId } },
    orderBy: { createdAt: "asc" },
  });
  let left = payout;
  const allocations: Array<{ claimId: number; amount: number; remainingAfter: number }> = [];
  for (const c of claims) {
    if (!(left > 0)) break;
    const remaining = round(Number(c.amount) - Number(c.recoveredAmount), currency);
    if (!(remaining > 0)) continue;
    const take = round(Math.min(left, remaining), currency);
    allocations.push({ claimId: c.id, amount: take, remainingAfter: round(remaining - take, currency) });
    left = round(left - take, currency);
  }
  return { allocations, total: round(payout - left, currency) };
}

/** Writes a planned recovery: each claim's recovered amount, and RECOVERED when fully covered. */
export async function applyClaimRecovery(db: any, allocations: Array<{ claimId: number; amount: number; remainingAfter: number }>) {
  for (const a of allocations) {
    await db.tenancyClaim.update({
      where: { id: a.claimId },
      data: { recoveredAmount: { increment: a.amount }, ...(a.remainingAfter <= 0 ? { status: "RECOVERED" } : { status: "RECOVERING" }) },
    });
  }
}

/** Undoes a recovery when the payout it was taken from did not go ahead. */
export async function revertClaimRecovery(db: any, allocations: Array<{ claimId: number; amount: number }>) {
  for (const a of allocations) {
    await db.tenancyClaim.update({ where: { id: a.claimId }, data: { recoveredAmount: { decrement: a.amount }, status: "RECOVERING" } });
  }
}

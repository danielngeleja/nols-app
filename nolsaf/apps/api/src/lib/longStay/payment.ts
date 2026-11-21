/**
 * Long-stay booking payment (docs/LONG_STAY_RENTALS.md sections 3.3 step 5
 * and 5, milestone 6): first month + tenant fee by card, held by NoLSAF until
 * move-in is confirmed.
 *
 * The card checkout is a Coral target like a group-stay deposit, with the same
 * hardening: only a verified provider notice can settle it, the amount must
 * equal the frozen booking amount exactly, a tenancy is reserved at most once,
 * and money that arrives for a closed tenancy is never silently kept.
 */
import { randomBytes } from "node:crypto";
import { landlordGate, landlordGateRefusal } from "./listing.js";
import { tenantPaymentRefusal } from "./tenantIdentity.js";
import { moveTenancy, TenancyError } from "./tenancyService.js";
import { longStayOpen } from "./fees.js";

/** Provider reference for a tenancy checkout. Random, so it reveals no row ids. */
export const TENANCY_PAYMENT_REF = /^LST-[0-9a-f]{16}$/;
export function newTenancyPaymentRef(): string {
  return `LST-${randomBytes(8).toString("hex")}`;
}
export function isTenancyPaymentRef(value: unknown): value is string {
  return typeof value === "string" && TENANCY_PAYMENT_REF.test(value);
}

/** A checkout started this close to the deadline still gets this long to settle. */
export const CHECKOUT_GRACE_MS = 30 * 60 * 1000;

function sameMoney(a: unknown, b: unknown, currency: string): boolean {
  const scale = String(currency).toUpperCase() === "TZS" ? 1 : 100;
  const x = Math.round(Number(a) * scale);
  const y = Math.round(Number(b) * scale);
  return Number.isFinite(x) && Number.isFinite(y) && x === y;
}

/**
 * Everything that must hold before a tenant may open a card checkout. Returns
 * the amount and currency to charge, taken from the frozen tenancy only.
 */
export async function checkTenancyPayable(db: any, tenancy: any, tenantId: number, now = new Date()) {
  if (!longStayOpen()) throw new TenancyError("Long stays are not open yet.", 403);
  if (tenancy.tenantId !== tenantId) throw new TenancyError("Not found", 404);
  if (tenancy.status !== "AWAITING_PAYMENT") throw new TenancyError(tenancy.paidAt ? "This home is already paid for." : "This lease is not waiting for payment.", 409);
  if (!tenancy.paymentDueAt || new Date(tenancy.paymentDueAt).getTime() <= now.getTime()) {
    throw new TenancyError("The 48-hour payment window has ended.", 409);
  }
  if (!tenancy.tenantLeaseAcceptedAt || !tenancy.landlordLeaseAcceptedAt) throw new TenancyError("Both sides must accept the lease first.", 409);

  const profile = await db.longStayTenantProfile.findUnique({ where: { userId: tenantId } });
  const idRefusal = tenantPaymentRefusal(profile, tenancy.endDate, now);
  if (idRefusal) throw new TenancyError(idRefusal, 409);
  // A landlord paused for a complaint after signing must not receive a new tenant's money.
  const landlordRefusal = landlordGateRefusal(await landlordGate(db, tenancy.landlordId));
  if (landlordRefusal) throw new TenancyError("This landlord cannot take payments right now. NoLSAF will contact you.", 409);

  const amount = Number(tenancy.bookingAmount);
  const currency = String(tenancy.currency || "").toUpperCase();
  if (!(amount > 0) || (currency !== "TZS" && currency !== "USD")) throw new TenancyError("This lease has no amount to pay. Contact NoLSAF support.", 409);
  return { amount: currency === "TZS" ? Math.round(amount) : Math.round(amount * 100) / 100, currency: currency as "TZS" | "USD" };
}

export type SettleResult =
  | { ok: true; outcome: "RESERVED" | "ALREADY_RESERVED" }
  | { ok: false; outcome: "AMOUNT_MISMATCH" | "NOT_AWAITING" | "NOT_FOUND" };

/**
 * Settles a verified provider success. Idempotent: a repeated callback for an
 * already reserved tenancy is a no-op. Never reserves on a different amount,
 * and never reserves a closed tenancy; both are left to a human.
 */
export async function settleTenancyPayment(
  db: any,
  input: { paymentRef: string; amount: number; currency: string; providerRef: string },
  alert: (kind: string, data: Record<string, unknown>) => Promise<unknown>,
  now = new Date(),
): Promise<SettleResult> {
  const tenancy = await db.tenancy.findFirst({ where: { paymentRef: input.paymentRef } });
  if (!tenancy) return { ok: false, outcome: "NOT_FOUND" };
  if (tenancy.paidAt) return { ok: true, outcome: "ALREADY_RESERVED" };

  if (!sameMoney(input.amount, tenancy.bookingAmount, tenancy.currency) || String(input.currency).toUpperCase() !== String(tenancy.currency).toUpperCase()) {
    await alert("long_stay_payment_review", { reason: "amount", paymentRef: input.paymentRef, tenancyRef: tenancy.publicRef, received: input.amount, expected: Number(tenancy.bookingAmount), currency: tenancy.currency });
    return { ok: false, outcome: "AMOUNT_MISMATCH" };
  }

  if (tenancy.status !== "AWAITING_PAYMENT") {
    // Paid after the window closed or the request was withdrawn: the money is
    // real, so record it on the tenancy and ask a human to refund it.
    await db.tenancy.updateMany({
      where: { id: tenancy.id, paidAt: null },
      data: { paidAt: now, paidAmount: input.amount, payoutStatus: "REFUND_DUE" },
    });
    await db.tenancyEvent.create({ data: { tenancyId: tenancy.id, actorRole: "SYSTEM", type: "PAYMENT_AFTER_CLOSE", data: { providerRef: input.providerRef, amount: input.amount } } });
    await alert("long_stay_payment_review", { reason: "closed", paymentRef: input.paymentRef, tenancyRef: tenancy.publicRef, status: tenancy.status, received: input.amount, currency: tenancy.currency });
    return { ok: false, outcome: "NOT_AWAITING" };
  }

  await moveTenancy(db, tenancy, "RESERVED", "SYSTEM", null, {
    paidAt: now,
    paidAmount: input.amount,
    payoutStatus: "HELD",
  }, { providerRef: input.providerRef, amount: input.amount, currency: tenancy.currency });
  return { ok: true, outcome: "RESERVED" };
}

/**
 * Closes leases whose payment window passed. A checkout opened before the
 * deadline gets a short grace period, since its callback may still be coming.
 */
export async function expireUnpaidTenancies(db: any, now = new Date(), notify?: (tenancy: any) => Promise<unknown>) {
  const due = await db.tenancy.findMany({
    where: { status: "AWAITING_PAYMENT", paidAt: null, paymentDueAt: { lt: now } },
    select: { id: true, status: true, version: true, paymentDueAt: true, checkoutSessionId: true, tenantId: true, landlordId: true, propertyId: true, publicRef: true },
    take: 200,
  });
  let closed = 0;
  for (const tenancy of due) {
    const deadline = new Date(tenancy.paymentDueAt).getTime() + (tenancy.checkoutSessionId ? CHECKOUT_GRACE_MS : 0);
    if (deadline > now.getTime()) continue;
    try {
      await moveTenancy(db, tenancy, "CANCELLED", "SYSTEM", null, { cancelledAt: now, cancelledBy: "SYSTEM", cancelReason: "The first month was not paid within 48 hours." });
      closed += 1;
      if (notify) await notify(tenancy).catch(() => undefined);
    } catch {
      // Moved by someone else (a payment just landed): leave it.
    }
  }
  return { closed };
}

/** On move-in day a reserved tenancy opens its move-in confirmations (section 3.3 step 6). */
export async function openMoveInDay(db: any, todayEat: string) {
  const due = await db.tenancy.findMany({
    where: { status: "RESERVED", moveInDate: { lte: new Date(`${todayEat}T00:00:00Z`) } },
    select: { id: true, status: true, version: true },
    take: 200,
  });
  let opened = 0;
  for (const tenancy of due) {
    try {
      await moveTenancy(db, tenancy, "MOVE_IN", "SYSTEM", null);
      opened += 1;
    } catch {
      // Already moved.
    }
  }
  return { opened };
}

/**
 * After the booking (docs/LONG_STAY_RENTALS.md sections 3.3 step 9, 6.4 and
 * 6.5, milestone 8): cancellation after payment, notice to end, move-out,
 * overdue tenancies, renewal reminders and renewals.
 */
import { z } from "zod";
import { landlordGate, landlordGateRefusal, rowToTerms, todayInEat } from "./listing.js";
import { addMonths } from "./lease.js";
import { LONG_STAY_MAX_TERM_MONTHS } from "./fees.js";
import { moveTenancy, newTenancyRef, TenancyError, type TenancySide } from "./tenancyService.js";
import { cancellationOf, type LongStayCancellation } from "./revenueFigures.js";

/** Cancelling this many days or fewer before move-in costs the tenant the first month (less 5%). */
export const LATE_CANCEL_DAYS = 14;
/** The landlord keeps 5% of the first month on a late tenant cancellation... */
export const LATE_CANCEL_NOLSAF_PERCENT = 5;
/** Landlord cancellations after payment that pause their long stays. */
export const LANDLORD_CANCEL_PAUSE_AT = 2;
/** Days after the end before an unconfirmed move-out is overdue. */
export const OVERDUE_GRACE_DAYS = 3;
/** A renewal can be started this many days before the end at most (payment is at most 60 days ahead). */
export const RENEWAL_WINDOW_DAYS = 60;

export const cancelSchema = z.object({ reason: z.string().trim().min(5).max(300) }).strict();
export const noticeSchema = z.object({ leaveOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), reason: z.string().trim().max(500).optional().nullable() }).strict();

const isoDay = (v: Date | string) => new Date(v).toISOString().slice(0, 10);
function addDays(day: string, days: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
function roundMoney(value: number, currency: string) {
  const scale = String(currency).toUpperCase() === "TZS" ? 1 : 100;
  return Math.round(value * scale) / scale;
}
function noticeDaysOf(tenancy: any): number {
  const v = Number((tenancy?.termsSnapshot as any)?.listing?.noticePeriodDays);
  return Number.isInteger(v) && v > 0 ? v : 30;
}

// ---------- Cancellation after payment (section 6.4) ----------

/** What happens to the money if this side cancels a reserved tenancy today. */
export function cancellationTerms(tenancy: any, by: "TENANT" | "LANDLORD", today = todayInEat()): LongStayCancellation {
  const month = Number(tenancy.monthlyRent ?? 0);
  const fee = Number(tenancy.tenantFee ?? 0);
  const daysToMoveIn = daysBetween(today, isoDay(tenancy.moveInDate));
  if (by === "LANDLORD") {
    return { by, daysToMoveIn, refundToTenant: roundMoney(month + fee, tenancy.currency), landlordPayout: 0, nolsafKeeps: 0 };
  }
  if (daysToMoveIn > LATE_CANCEL_DAYS) {
    return { by, daysToMoveIn, refundToTenant: roundMoney(month, tenancy.currency), landlordPayout: 0, nolsafKeeps: roundMoney(fee, tenancy.currency) };
  }
  const kept = roundMoney((month * LATE_CANCEL_NOLSAF_PERCENT) / 100, tenancy.currency);
  return { by, daysToMoveIn, refundToTenant: 0, landlordPayout: roundMoney(month - kept, tenancy.currency), nolsafKeeps: roundMoney(fee + kept, tenancy.currency) };
}

/**
 * Tenant or landlord cancels a paid, reserved tenancy. The split is decided
 * here, frozen on the tenancy, and an admin then pays out or refunds.
 * Repeated landlord cancellations pause the landlord's long stays.
 */
export async function cancelReserved(db: any, tenancy: any, side: TenancySide, userId: number, reason: string, today = todayInEat(), now = new Date()) {
  if (tenancy.status !== "RESERVED" || !tenancy.paidAt) throw new TenancyError("Only a reserved, paid booking can be cancelled here. On move-in day, report a problem instead.", 409);
  if (cancellationOf(tenancy)) throw new TenancyError("This booking is already cancelled.", 409);
  const terms = cancellationTerms(tenancy, side, today);
  const payoutStatus = terms.refundToTenant > 0 ? "REFUND_DUE" : "READY";
  await moveTenancy(db, tenancy, "CANCELLED", side, userId, {
    cancelledAt: now,
    cancelledBy: side,
    cancelReason: reason,
    payoutStatus,
    termsSnapshot: { ...((tenancy.termsSnapshot as any) ?? {}), cancellation: terms },
  }, { reason, ...terms });

  let landlordPaused = false;
  if (side === "LANDLORD") {
    const count = await db.tenancyEvent.count({ where: { type: "STATUS_CANCELLED", actorRole: "LANDLORD", tenancy: { landlordId: tenancy.landlordId, paidAt: { not: null } } } });
    if (count >= LANDLORD_CANCEL_PAUSE_AT) {
      const gate = await landlordGate(db, tenancy.landlordId);
      if (gate.granted && !gate.paused) {
        await db.longStayLandlordGrant.update({ where: { userId: tenancy.landlordId }, data: { pausedAt: now, pauseReason: `${count} paid long stays cancelled by the landlord` } });
        landlordPaused = true;
      }
    }
  }
  return { terms, payoutStatus, landlordPaused };
}

// ---------- Notice and move-out (section 6.5) ----------

export async function giveNotice(db: any, tenancy: any, side: TenancySide, userId: number, input: { leaveOn: string; reason?: string | null }, today = todayInEat(), now = new Date()) {
  if (tenancy.status !== "ACTIVE") throw new TenancyError("Notice can be given while the home is let.", 409);
  const noticeDays = noticeDaysOf(tenancy);
  const earliest = addDays(today, noticeDays);
  const end = tenancy.endDate ? isoDay(tenancy.endDate) : null;
  if (input.leaveOn < earliest) throw new TenancyError(`The lease needs ${noticeDays} days' notice: the earliest end date is ${earliest}.`);
  if (end && input.leaveOn > end) throw new TenancyError(`The lease already ends on ${end}.`);
  if (side === "LANDLORD" && !(input.reason && input.reason.trim().length >= 10)) {
    throw new TenancyError("A landlord may end early only on a lawful ground. Explain it (at least 10 characters).");
  }
  await moveTenancy(db, tenancy, "ENDING", side, userId, {
    noticeGivenAt: now,
    noticeGivenBy: side,
    endDate: new Date(`${input.leaveOn}T00:00:00Z`),
  }, { leaveOn: input.leaveOn, originalEnd: end, reason: input.reason ?? null });
}

/** The landlord confirms the tenant has left, on or after the end date. */
export async function confirmMoveOut(db: any, tenancy: any, landlordId: number, today = todayInEat(), now = new Date()) {
  if (!["ACTIVE", "ENDING", "OVERDUE"].includes(tenancy.status)) throw new TenancyError("There is no stay to end.", 409);
  if (!tenancy.endDate || isoDay(tenancy.endDate) > today) throw new TenancyError("Move-out can be confirmed from the end date.", 409);
  await moveTenancy(db, tenancy, "ENDED", "LANDLORD", landlordId, { endedAt: now }, { confirmedBy: "LANDLORD" });
}

/**
 * Worker: tenancies past their end (plus grace) with no move-out become
 * OVERDUE; tenancies entering their notice window get one renewal reminder.
 */
export async function sweepTenancyEndings(db: any, today = todayInEat(), notify?: (kind: "overdue" | "renewal", tenancy: any) => Promise<unknown>) {
  const overdueBefore = new Date(`${addDays(today, -OVERDUE_GRACE_DAYS)}T00:00:00Z`);
  const late = await db.tenancy.findMany({ where: { status: { in: ["ACTIVE", "ENDING"] }, endDate: { lt: overdueBefore } }, take: 200 });
  let overdue = 0;
  for (const t of late) {
    try {
      await moveTenancy(db, t, "OVERDUE", "SYSTEM", null, {}, { endDate: isoDay(t.endDate) });
      overdue += 1;
      if (notify) await notify("overdue", t).catch(() => undefined);
    } catch {
      // moved meanwhile
    }
  }

  const soon = await db.tenancy.findMany({ where: { status: "ACTIVE", endDate: { lte: new Date(`${addDays(today, 90)}T00:00:00Z`) } }, take: 200 });
  let reminded = 0;
  for (const t of soon) {
    const remindOn = addDays(isoDay(t.endDate), -noticeDaysOf(t));
    if (remindOn > today) continue;
    const sent = await db.tenancyEvent.count({ where: { tenancyId: t.id, type: "RENEWAL_REMINDER" } });
    if (sent) continue;
    await db.tenancyEvent.create({ data: { tenancyId: t.id, actorRole: "SYSTEM", type: "RENEWAL_REMINDER", data: { endDate: isoDay(t.endDate) } } });
    reminded += 1;
    if (notify) await notify("renewal", t).catch(() => undefined);
  }
  return { overdue, reminded };
}

// ---------- Renewal (section 3.3 step 9) ----------

/**
 * The sitting tenant asks to renew. A new reservation (OFFERED) starts the day
 * the current lease ends, for the same or another listed term; the landlord
 * confirms within 24 hours, then the normal lease and first month payment
 * through NoLSAF follow.
 */
export async function startRenewal(db: any, tenancy: any, tenantId: number, termMonths?: number | null, today = todayInEat(), now = new Date()) {
  if (tenancy.status !== "ACTIVE") throw new TenancyError("Renewal is for a home you are living in, before notice is given.", 409);
  const end = tenancy.endDate ? isoDay(tenancy.endDate) : null;
  if (!end) throw new TenancyError("This lease has no end date.", 409);
  if (daysBetween(today, end) > RENEWAL_WINDOW_DAYS) throw new TenancyError(`You can renew from ${addDays(end, -RENEWAL_WINDOW_DAYS)}.`, 409);
  const refusal = landlordGateRefusal(await landlordGate(db, tenancy.landlordId));
  if (refusal) throw new TenancyError("This landlord cannot take renewals right now. Contact NoLSAF.", 409);
  const property = await db.property.findUnique({ where: { id: tenancy.propertyId }, select: { status: true, rentalMode: true, longStayListing: true } });
  const terms = rowToTerms(property?.longStayListing);
  if (!property || property.status !== "APPROVED" || property.rentalMode !== "LONG_STAY" || !terms) {
    throw new TenancyError("This home is no longer offered for long stays.", 409);
  }
  const open = await db.tenancy.findFirst({ where: { propertyId: tenancy.propertyId, tenantId, id: { not: tenancy.id }, status: { in: ["OFFERED", "ACCEPTED", "AWAITING_PAYMENT", "RESERVED"] } }, select: { publicRef: true } });
  if (open) return { ref: open.publicRef, existing: true };

  const term = Number(termMonths || tenancy.termMonths);
  const max = terms.maxTermMonths ?? LONG_STAY_MAX_TERM_MONTHS;
  if (!Number.isInteger(term) || term < terms.minTermMonths || term > max) throw new TenancyError(`Choose a term from ${terms.minTermMonths} to ${max} months.`);
  const created = await db.tenancy.create({
    data: {
      publicRef: newTenancyRef(),
      propertyId: tenancy.propertyId,
      landlordId: tenancy.landlordId,
      tenantId,
      status: "OFFERED",
      currency: terms.currency,
      moveInDate: new Date(`${end}T00:00:00Z`),
      termMonths: term,
      endDate: new Date(`${addMonths(end, term)}T00:00:00Z`),
      offeredAt: now,
    },
  });
  await db.tenancyEvent.create({ data: { tenancyId: created.id, actorId: tenantId, actorRole: "TENANT", type: "RENEWAL_REQUESTED", toStatus: "OFFERED", data: { renewalOf: tenancy.publicRef, from: end, termMonths: term } } });
  await db.tenancyEvent.create({ data: { tenancyId: tenancy.id, actorId: tenantId, actorRole: "TENANT", type: "RENEWAL_REQUESTED", data: { renewal: created.publicRef } } });
  return { ref: created.publicRef, existing: false };
}

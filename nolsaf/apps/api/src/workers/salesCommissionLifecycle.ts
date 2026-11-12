import { prisma } from "@nolsaf/prisma";
import { COMMISSION_TRANSACTION_OPTIONS } from "../lib/nrmsTransaction.js";
import {
  CANCELLED_BOOKING_STATUSES,
  POST_STAY_BUFFER_DAYS,
  SETTLED_CANCELLATION_STATUSES,
  accrueMarketplaceSalesCommission,
  accrueNrmsSalesCommission,
  autoReverseSalesCommission,
  bookingHasOpenCancellation,
  bookingWasCancelled,
} from "../lib/salesCommission.js";
import { accrueAgencySalesCommission } from "../lib/salesAgency.js";
import { GROUP_CANCELLED_STATUSES, accrueAgencyGroupCommission, groupIdFromSourceKey } from "../lib/salesAgencyGroups.js";
import { TOUR_REFUNDED_STATUSES, accrueAgencyTourCommission, tourIdFromSourceKey } from "../lib/salesAgencyTours.js";
import { sweepOwnerConfirmations } from "../lib/salesOwnerConfirmation.js";
import { lapseUnadoptedNrmsClaims } from "../lib/salesNrmsAdoption.js";
import { closeMonth, liveRankNotices, monthKey, shiftMonth } from "../lib/salesLeaderboard.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import { teamHealthNotices } from "../lib/salesTeamHealth.js";
import { resumeSalesAutoPayouts } from "../services/payouts/salesWithdrawal.js";

let lastLeaderboardRun = 0;
/** Hourly: freeze last month once it has ended, then live ranks and nudges. */
async function leaderboardHousekeeping(now = new Date()) {
  if (now.getTime() - lastLeaderboardRun < 60 * 60 * 1000) return;
  lastLeaderboardRun = now.getTime();
  const closed = await closeMonth(shiftMonth(monthKey(now), -1), notifyUser);
  const notices = await liveRankNotices(notifyUser, now);
  if (closed || notices.topThree || notices.nudged) console.log("[sales-leaderboard]", { closed, ...notices });
  // Weekly per team (deduplicated in the audit log): a tip for the lead, an alert to admins when at risk.
  const health = await teamHealthNotices(db, { user: notifyUser, admins: notifyAdmins }, now);
  if (health.nudged || health.alerted) console.log("[sales-team-health]", health);
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Agency groups and tours are found by when they were paid or completed, within this window. */
const AGENCY_ACCRUAL_LOOKBACK_MS = 90 * DAY_MS;
/** Commissions tied to a stay: they wait for checkout and reverse on cancellation. */
const STAY_COMMISSION_TYPES = ["MARKETPLACE_BOOKING", "AGENCY_STAY"];
/** Commission states that still count toward a partner's balance. */
const OPEN_COMMISSION_STATUSES = ["PENDING", "VALIDATING", "ELIGIBLE", "APPROVED", "AVAILABLE"];

const db = prisma as any;

export async function runSalesCommissionLifecycle(now = new Date()): Promise<{
  nrmsAccrued: number;
  marketplaceAccrued: number;
  agencyAccrued: number;
  madeEligible: number;
  autoReversed: number;
  lockedInPayout: number;
}> {
  // Reconcile recent paid sources as a safety net for transient failures,
  // rolling deployments and every alternate admin collection path. Source-key
  // uniqueness makes this safe to run repeatedly and on startup.
  const [statements, invoices] = await Promise.all([
    db.nrmsBillingStatement.findMany({
      where: { status: "PAID", paidAt: { not: null } },
      orderBy: { paidAt: "desc" },
      take: 1_000,
      select: { id: true },
    }),
    db.invoice.findMany({
      where: { status: "PAID", paidAt: { not: null } },
      orderBy: { paidAt: "desc" },
      take: 1_000,
      select: { id: true },
    }),
  ]);
  const statementIds = statements.map((row: any) => row.id);
  const invoiceIds = invoices.map((row: any) => row.id);
  const existing = statementIds.length || invoiceIds.length
    ? await db.salesCommission.findMany({
        where: {
          OR: [
            ...(statementIds.length ? [{ sourceStatementId: { in: statementIds } }] : []),
            ...(invoiceIds.length ? [{ sourceInvoiceId: { in: invoiceIds } }] : []),
          ],
        },
        select: { sourceStatementId: true, sourceInvoiceId: true, type: true },
      })
    : [];
  const accruedStatementIds = new Set(
    existing.map((row: any) => row.sourceStatementId).filter((id: unknown) => Number.isInteger(id)),
  );
  // Per stream: an Agency Desk row on an invoice must not hide a missing
  // supply-side row on the same invoice, or the other way round.
  const accruedInvoiceIds = new Set(
    existing.filter((row: any) => row.type !== "AGENCY_STAY").map((row: any) => row.sourceInvoiceId).filter((id: unknown) => Number.isInteger(id)),
  );
  const agencyAccruedInvoiceIds = new Set(
    existing.filter((row: any) => row.type === "AGENCY_STAY").map((row: any) => row.sourceInvoiceId).filter((id: unknown) => Number.isInteger(id)),
  );

  let nrmsAccrued = 0;
  let marketplaceAccrued = 0;
  // Bound database work per run; sources remain eligible for the next run.
  let attempted = 0;
  for (const statement of statements) {
    if (accruedStatementIds.has(statement.id)) continue;
    if (attempted >= 50) break;
    attempted += 1;
    const result = await db.$transaction((tx: any) => accrueNrmsSalesCommission(tx, statement.id), COMMISSION_TRANSACTION_OPTIONS);
    if (result.created) nrmsAccrued += 1;
  }
  for (const invoice of invoices) {
    if (accruedInvoiceIds.has(invoice.id)) continue;
    if (attempted >= 100) break;
    attempted += 1;
    const result = await db.$transaction((tx: any) => accrueMarketplaceSalesCommission(tx, invoice.id), COMMISSION_TRANSACTION_OPTIONS);
    if (result.created) marketplaceAccrued += 1;
  }
  // Agency Desk, after the supply-side pass above so the stacking cap sees any
  // supply commission on the same invoice. Only invoices whose booking carries
  // an agency attribution are considered.
  let agencyAccrued = 0;
  const pendingAgency = invoices.filter((inv: any) => !agencyAccruedInvoiceIds.has(inv.id));
  if (pendingAgency.length) {
    const withBookings = await db.invoice.findMany({
      where: { id: { in: pendingAgency.map((inv: any) => inv.id) } },
      select: { id: true, bookingId: true },
    });
    const attributed = await db.bookingChannelAttribution.findMany({
      where: { bookingId: { in: withBookings.map((inv: any) => inv.bookingId) }, status: "ACTIVE" },
      select: { bookingId: true },
    });
    const attributedBookings = new Set(attributed.map((row: any) => row.bookingId));
    let agencyAttempts = 0;
    for (const invoice of withBookings) {
      if (!attributedBookings.has(invoice.bookingId)) continue;
      // The supply pass may have skipped this invoice for its budget; wait for it.
      if (!accruedInvoiceIds.has(invoice.id) && attempted >= 100) continue;
      if (agencyAttempts >= 50) break;
      agencyAttempts += 1;
      const result = await db.$transaction((tx: any) => accrueAgencySalesCommission(tx, invoice.id, now), COMMISSION_TRANSACTION_OPTIONS);
      if (result.created) agencyAccrued += 1;
    }
  }

  // Agency Desk group stays: fully prepaid groups confirmed through a partner request.
  // Start from recently paid groups, not from the newest requests, so a busy desk
  // never pushes an older paid group out of the window before it accrues.
  const recentlyPaidGroups = await db.groupBooking.findMany({
    where: { paymentMode: "FULL", depositPaid: true, depositPaidAt: { gte: new Date(now.getTime() - AGENCY_ACCRUAL_LOOKBACK_MS) } },
    select: { id: true },
    take: 5_000,
  });
  const paidGroups = recentlyPaidGroups.length
    ? await db.salesAgencyGroupRequest.findMany({
        where: { status: "CONFIRMED", groupBookingId: { in: recentlyPaidGroups.map((row: any) => row.id) } },
        select: { groupBookingId: true },
      })
    : [];
  if (paidGroups.length) {
    const groupIds = paidGroups.map((row: any) => row.groupBookingId);
    const accruedGroups = await db.salesCommission.findMany({ where: { sourceKey: { in: groupIds.map((id: number) => `AGENCY_GROUP:${id}`) } }, select: { sourceKey: true } });
    const paid = groupIds.map((id: number) => ({ id }));
    const done = new Set(accruedGroups.map((row: any) => groupIdFromSourceKey(row.sourceKey)));
    let groupAttempts = 0;
    for (const gb of paid) {
      if (done.has(gb.id)) continue;
      if (groupAttempts >= 50) break;
      groupAttempts += 1;
      const result = await db.$transaction((tx: any) => accrueAgencyGroupCommission(tx, gb.id, now), COMMISSION_TRANSACTION_OPTIONS);
      if (result.created) agencyAccrued += 1;
    }
  }

  // Agency Desk tours: accrue once a credited tour is COMPLETED (after its dispute window).
  // Tours are often booked months ahead, so start from recently completed tours
  // rather than the newest credits; an old credit is never left behind.
  const recentlyCompleted = await db.tourBooking.findMany({
    where: { status: "COMPLETED", paymentStatus: "PAID", updatedAt: { gte: new Date(now.getTime() - AGENCY_ACCRUAL_LOOKBACK_MS) } },
    select: { id: true },
    take: 5_000,
  });
  const creditedTours = recentlyCompleted.length
    ? await db.tourBookingAttribution.findMany({
        where: { status: "ACTIVE", tourBookingId: { in: recentlyCompleted.map((row: any) => row.id) } },
        select: { tourBookingId: true },
      })
    : [];
  if (creditedTours.length) {
    const tourIds = creditedTours.map((row: any) => row.tourBookingId);
    const accruedTours = await db.salesCommission.findMany({ where: { sourceKey: { in: tourIds.map((id: number) => `AGENCY_TOUR:${id}`) } }, select: { sourceKey: true } });
    const completed = tourIds.map((id: number) => ({ id }));
    const doneTours = new Set(accruedTours.map((row: any) => tourIdFromSourceKey(row.sourceKey)));
    let tourAttempts = 0;
    for (const tour of completed) {
      if (doneTours.has(tour.id)) continue;
      if (tourAttempts >= 50) break;
      tourAttempts += 1;
      const result = await db.$transaction((tx: any) => accrueAgencyTourCommission(tx, tour.id, now), COMMISSION_TRANSACTION_OPTIONS);
      if (result.created) agencyAccrued += 1;
    }
  }

  // 1. A cancelled or refunded stay earns no commission. Reverse what is still
  //    open, and offset what was already paid so it comes out of the next payout.
  const { autoReversed: stayReversed, lockedInPayout: stayLocked } = await reverseCancelledBookingCommissions(now);
  const groupReversal = await reverseCancelledGroupCommissions(now);
  const tourReversal = await reverseRefundedTourCommissions(now);
  const autoReversed = stayReversed + groupReversal.autoReversed + tourReversal.autoReversed;
  const lockedInPayout = stayLocked + groupReversal.lockedInPayout + tourReversal.lockedInPayout;

  // 2. Promote commissions whose validation window has passed. Marketplace
  //    commissions also wait for the guest to check out (plus the complaint
  //    window) and for any open cancellation request to be decided.
  const candidates = await db.salesCommission.findMany({
    where: { status: "VALIDATING", eligibleAt: { lte: now } },
    orderBy: { eligibleAt: "asc" },
    take: 50,
    select: { id: true, status: true, eligibleAt: true, type: true, sourceBookingId: true, sourceKey: true },
  });
  const groupCandidateIds = candidates
    .filter((c: any) => c.type === "AGENCY_GROUP")
    .map((c: any) => groupIdFromSourceKey(c.sourceKey))
    .filter((id: number | null): id is number => id != null);
  const groups = groupCandidateIds.length
    ? await db.groupBooking.findMany({ where: { id: { in: groupCandidateIds } }, select: { id: true, status: true, checkOut: true, checkedInAt: true } })
    : [];
  const groupById = new Map<number, any>(groups.map((g: any) => [g.id, g]));
  const bookingIds = candidates
    .filter((c: any) => STAY_COMMISSION_TYPES.includes(c.type) && Number.isInteger(c.sourceBookingId))
    .map((c: any) => c.sourceBookingId);
  const bookings = bookingIds.length
    ? await db.booking.findMany({
        where: { id: { in: bookingIds } },
        select: { id: true, status: true, checkOut: true, cancellationRequests: { select: { status: true } } },
      })
    : [];
  const bookingById = new Map<number, any>(bookings.map((b: any) => [b.id, b]));

  let madeEligible = 0;
  for (const candidate of candidates) {
    if (candidate.type === "AGENCY_GROUP") {
      const group = groupById.get(groupIdFromSourceKey(candidate.sourceKey) ?? -1);
      if (group && GROUP_CANCELLED_STATUSES.includes(String(group.status).toUpperCase())) continue; // reversal sweep
      // Earned only once the owner recorded the group's arrival and the stay is over.
      const stayDone = group?.checkOut ? new Date(group.checkOut).getTime() + POST_STAY_BUFFER_DAYS * DAY_MS : NaN;
      if (!group || !group.checkedInAt || !Number.isFinite(stayDone) || stayDone > now.getTime()) {
        const holdUntil = new Date(Number.isFinite(stayDone) && stayDone > now.getTime() ? stayDone : now.getTime() + 7 * DAY_MS);
        await db.salesCommission.updateMany({ where: { id: candidate.id, status: "VALIDATING" }, data: { eligibleAt: holdUntil } });
        continue;
      }
    }
    if (STAY_COMMISSION_TYPES.includes(candidate.type)) {
      const booking = bookingById.get(candidate.sourceBookingId);
      if (bookingWasCancelled(booking)) continue; // handled by the reversal sweep
      // Not ready yet: move the date forward so this row stops holding the queue.
      let holdUntil: Date | null = null;
      if (!booking) holdUntil = new Date(now.getTime() + 7 * DAY_MS);
      else if (bookingHasOpenCancellation(booking)) holdUntil = new Date(now.getTime() + DAY_MS);
      else {
        const stayDone = new Date(booking.checkOut).getTime() + POST_STAY_BUFFER_DAYS * DAY_MS;
        if (!Number.isFinite(stayDone) || stayDone > now.getTime()) {
          holdUntil = new Date(Number.isFinite(stayDone) ? stayDone : now.getTime() + 7 * DAY_MS);
        }
      }
      if (holdUntil) {
        await db.salesCommission.updateMany({
          where: { id: candidate.id, status: "VALIDATING" },
          data: { eligibleAt: holdUntil },
        });
        continue;
      }
    }
    const changed = await db.$transaction(async (tx: any) => {
      const updated = await tx.salesCommission.updateMany({
        where: { id: candidate.id, status: "VALIDATING", eligibleAt: { lte: now } },
        data: { status: "ELIGIBLE" },
      });
      if (updated.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: "SYSTEM",
          action: "SALES_COMMISSION_ELIGIBLE",
          entity: "SALES_COMMISSION",
          entityId: candidate.id,
          beforeJson: { status: candidate.status },
          afterJson: { status: "ELIGIBLE", eligibleAt: candidate.eligibleAt },
        },
      });
      return true;
    }, COMMISSION_TRANSACTION_OPTIONS);
    if (changed) madeEligible += 1;
  }
  return { nrmsAccrued, marketplaceAccrued, agencyAccrued, madeEligible, autoReversed, lockedInPayout };
}

/**
 * Find marketplace commissions whose booking was cancelled or refunded and
 * reverse them. Paid commissions from the last year are included so a refund
 * after payout is recovered from the partner's next payout.
 */
async function reverseCancelledBookingCommissions(now: Date): Promise<{ autoReversed: number; lockedInPayout: number }> {
  const open = await db.salesCommission.findMany({
    where: {
      type: { in: STAY_COMMISSION_TYPES },
      sourceBookingId: { not: null },
      reversalOfId: null,
      OR: [
        { status: { in: OPEN_COMMISSION_STATUSES } },
        { status: "PAID", paidAt: { gte: new Date(now.getTime() - 365 * DAY_MS) } },
      ],
    },
    orderBy: { id: "desc" },
    take: 2_000,
    select: { id: true, sourceBookingId: true },
  });
  if (!open.length) return { autoReversed: 0, lockedInPayout: 0 };
  const cancelled = await db.booking.findMany({
    where: {
      id: { in: [...new Set(open.map((c: any) => c.sourceBookingId))] },
      OR: [
        { status: { in: CANCELLED_BOOKING_STATUSES } },
        { cancellationRequests: { some: { status: { in: SETTLED_CANCELLATION_STATUSES } } } },
      ],
    },
    select: { id: true },
  });
  if (!cancelled.length) return { autoReversed: 0, lockedInPayout: 0 };
  const cancelledIds = new Set(cancelled.map((b: any) => b.id));

  let autoReversed = 0;
  let lockedInPayout = 0;
  for (const commission of open.filter((c: any) => cancelledIds.has(c.sourceBookingId)).slice(0, 50)) {
    const outcome = await db.$transaction(
      (tx: any) => autoReverseSalesCommission(tx, commission.id, `Booking #${commission.sourceBookingId} was cancelled or refunded.`, now),
      COMMISSION_TRANSACTION_OPTIONS,
    );
    if (outcome === "REVERSED" || outcome === "OFFSET") autoReversed += 1;
    if (outcome === "LOCKED") lockedInPayout += 1;
  }
  if (lockedInPayout) {
    console.warn(`[sales-commission] ${lockedInPayout} commission(s) on cancelled bookings are inside a payout request; finance must reject or adjust that payout.`);
  }
  return { autoReversed, lockedInPayout };
}

/** Agency group commissions whose group stay was cancelled: reverse, or offset if paid. */
async function reverseCancelledGroupCommissions(now: Date): Promise<{ autoReversed: number; lockedInPayout: number }> {
  const open = await db.salesCommission.findMany({
    where: {
      type: "AGENCY_GROUP",
      reversalOfId: null,
      OR: [
        { status: { in: OPEN_COMMISSION_STATUSES } },
        { status: "PAID", paidAt: { gte: new Date(now.getTime() - 365 * DAY_MS) } },
      ],
    },
    orderBy: { id: "desc" },
    take: 2_000,
    select: { id: true, sourceKey: true },
  });
  const byGroup = new Map<number, number[]>();
  for (const row of open) {
    const id = groupIdFromSourceKey(row.sourceKey);
    if (id != null) byGroup.set(id, [...(byGroup.get(id) ?? []), row.id]);
  }
  if (!byGroup.size) return { autoReversed: 0, lockedInPayout: 0 };
  const cancelled = await db.groupBooking.findMany({ where: { id: { in: [...byGroup.keys()] }, status: { in: GROUP_CANCELLED_STATUSES } }, select: { id: true } });
  let autoReversed = 0;
  let lockedInPayout = 0;
  for (const gb of cancelled.slice(0, 50)) {
    for (const commissionId of byGroup.get(gb.id) ?? []) {
      const outcome = await db.$transaction(
        (tx: any) => autoReverseSalesCommission(tx, commissionId, `Group stay #${gb.id} was cancelled.`, now),
        COMMISSION_TRANSACTION_OPTIONS,
      );
      if (outcome === "REVERSED" || outcome === "OFFSET") autoReversed += 1;
      if (outcome === "LOCKED") lockedInPayout += 1;
    }
  }
  return { autoReversed, lockedInPayout };
}

/** Agency tour commissions whose tour was later refunded or cancelled: reverse, or offset if paid. */
async function reverseRefundedTourCommissions(now: Date): Promise<{ autoReversed: number; lockedInPayout: number }> {
  const open = await db.salesCommission.findMany({
    where: {
      type: "AGENCY_TOUR",
      reversalOfId: null,
      OR: [
        { status: { in: OPEN_COMMISSION_STATUSES } },
        { status: "PAID", paidAt: { gte: new Date(now.getTime() - 365 * DAY_MS) } },
      ],
    },
    orderBy: { id: "desc" },
    take: 2_000,
    select: { id: true, sourceKey: true },
  });
  const byTour = new Map<number, number[]>();
  for (const row of open) {
    const id = tourIdFromSourceKey(row.sourceKey);
    if (id != null) byTour.set(id, [...(byTour.get(id) ?? []), row.id]);
  }
  if (!byTour.size) return { autoReversed: 0, lockedInPayout: 0 };
  const refunded = await db.tourBooking.findMany({
    where: { id: { in: [...byTour.keys()] }, OR: [{ status: { in: TOUR_REFUNDED_STATUSES } }, { paymentStatus: "REFUNDED" }] },
    select: { id: true },
  });
  let autoReversed = 0;
  let lockedInPayout = 0;
  for (const tour of refunded.slice(0, 50)) {
    for (const commissionId of byTour.get(tour.id) ?? []) {
      const outcome = await db.$transaction(
        (tx: any) => autoReverseSalesCommission(tx, commissionId, `Tour booking ${tour.id} was cancelled or refunded.`, now),
        COMMISSION_TRANSACTION_OPTIONS,
      );
      if (outcome === "REVERSED" || outcome === "OFFSET") autoReversed += 1;
      if (outcome === "LOCKED") lockedInPayout += 1;
    }
  }
  return { autoReversed, lockedInPayout };
}

export function startSalesCommissionLifecycleWorker(): void {
  const intervalMs = Math.max(
    60_000,
    Number(process.env.SALES_COMMISSION_WORKER_INTERVAL_MS || 5 * 60_000),
  );
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      // Owner confirmation housekeeping: expire, cancel on owner change, remind once.
      const confirmations = await sweepOwnerConfirmations().catch((error: any) => {
        console.error("[sales-owner-confirmation] sweep failed:", error?.message || error);
        return null;
      });
      if (confirmations && (confirmations.expired || confirmations.cancelled || confirmations.reminded)) {
        console.log("[sales-owner-confirmation] sweep", confirmations);
      }
      // NRMS claims the owner never adopted lapse, freeing the property for a real NRMS sale.
      const nrms = await lapseUnadoptedNrmsClaims().catch((error: any) => {
        console.error("[sales-nrms-adoption] lapse sweep failed:", error?.message || error);
        return null;
      });
      if (nrms?.lapsed) console.log("[sales-nrms-adoption] lapsed", nrms);
      await leaderboardHousekeeping().catch((error: any) => {
        console.error("[sales-leaderboard] housekeeping failed:", error?.message || error);
      });
      // Automatic withdrawals left halfway (crash or provider hiccup) are resumed or sent to review.
      const handoff = await resumeSalesAutoPayouts().catch((error: any) => {
        console.error("[sales-withdrawal] resume failed:", error?.message || error);
        return null;
      });
      if (handoff && (handoff.queued || handoff.review)) console.log("[sales-withdrawal] resumed", handoff);
      const result = await runSalesCommissionLifecycle();
      if (result.nrmsAccrued || result.marketplaceAccrued || result.agencyAccrued || result.madeEligible || result.autoReversed) {
        console.log("[sales-commission] lifecycle", result);
      }
    } catch (error: any) {
      // During the rolling migration window the new tables may not exist yet.
      // Payments continue; the next run backfills idempotently after migration.
      console.error("[sales-commission] lifecycle failed:", error?.message || error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), intervalMs);
  timer.unref?.();
  console.log(`[sales-commission] Started, interval: ${intervalMs / 1000}s`);
}

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
/** Commission states that still count toward a partner's balance. */
const OPEN_COMMISSION_STATUSES = ["PENDING", "VALIDATING", "ELIGIBLE", "APPROVED", "AVAILABLE"];

const db = prisma as any;

export async function runSalesCommissionLifecycle(now = new Date()): Promise<{
  nrmsAccrued: number;
  marketplaceAccrued: number;
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
        select: { sourceStatementId: true, sourceInvoiceId: true },
      })
    : [];
  const accruedStatementIds = new Set(
    existing.map((row: any) => row.sourceStatementId).filter((id: unknown) => Number.isInteger(id)),
  );
  const accruedInvoiceIds = new Set(
    existing.map((row: any) => row.sourceInvoiceId).filter((id: unknown) => Number.isInteger(id)),
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

  // 1. A cancelled or refunded stay earns no commission. Reverse what is still
  //    open, and offset what was already paid so it comes out of the next payout.
  const { autoReversed, lockedInPayout } = await reverseCancelledBookingCommissions(now);

  // 2. Promote commissions whose validation window has passed. Marketplace
  //    commissions also wait for the guest to check out (plus the complaint
  //    window) and for any open cancellation request to be decided.
  const candidates = await db.salesCommission.findMany({
    where: { status: "VALIDATING", eligibleAt: { lte: now } },
    orderBy: { eligibleAt: "asc" },
    take: 50,
    select: { id: true, status: true, eligibleAt: true, type: true, sourceBookingId: true },
  });
  const bookingIds = candidates
    .filter((c: any) => c.type === "MARKETPLACE_BOOKING" && Number.isInteger(c.sourceBookingId))
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
    if (candidate.type === "MARKETPLACE_BOOKING") {
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
  return { nrmsAccrued, marketplaceAccrued, madeEligible, autoReversed, lockedInPayout };
}

/**
 * Find marketplace commissions whose booking was cancelled or refunded and
 * reverse them. Paid commissions from the last year are included so a refund
 * after payout is recovered from the partner's next payout.
 */
async function reverseCancelledBookingCommissions(now: Date): Promise<{ autoReversed: number; lockedInPayout: number }> {
  const open = await db.salesCommission.findMany({
    where: {
      type: "MARKETPLACE_BOOKING",
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
      if (result.nrmsAccrued || result.marketplaceAccrued || result.madeEligible || result.autoReversed) {
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

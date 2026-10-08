/**
 * Payout Release worker (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md, Phase 1)
 *
 * Each pass:
 *   1. Backfill: creates the release for any recently checked-in booking the
 *      check-in hook missed (hook failure, or a check-in path without a hook).
 *   2. Evaluate: re-checks every LOCKED and AVAILABLE release. Hold signals
 *      move it to HELD, the clock and gates move it to AVAILABLE, a claim the
 *      manual flow already paid moves it to RELEASED.
 *
 * Moves no money. Runs only on the leader and only while
 * PAYOUT_RELEASE_ENABLED is on, which must stay off until migration
 * 20261007090000 is applied.
 */

import { prisma } from "@nolsaf/prisma";
import { ensureGuestCheckInConfirmation } from "../lib/checkInConfirmationSms.js";
import {
  applyReleaseDecision,
  decideRelease,
  ensurePayoutRelease,
  EVALUATED_RELEASE_STATUSES,
  loadReleaseContext,
  payoutReleaseEnabled,
} from "../services/payouts/release.js";
import { remindUnclaimed, withdrawUnclaimed } from "../services/payouts/withdrawal.js";
import { loadAutoLaneSettings } from "../services/payouts/autoLane.js";
import { requestOverdueRepayments } from "../services/payouts/recovery.js";
import { authorizeAutoBatch, autoLaneAuthorizedToday, formAutoBatch } from "../services/payouts/batching.js";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
/** Only recent check-ins are backfilled, so enabling the feature never reopens old, settled stays. */
const BACKFILL_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const BACKFILL_LIMIT = 100;
const EVALUATE_LIMIT = 500;
let lastEvaluatedReleaseId = 0;

export async function runPayoutReleasePass(now = new Date()): Promise<{ created: number; moved: number; failed: number }> {
  let created = 0;
  let moved = 0;
  let failed = 0;

  const missing = await prisma.booking.findMany({
    where: {
      status: { in: ["CHECKED_IN", "CHECKED_OUT"] },
      code: { is: { status: "USED", usedAt: { gte: new Date(now.getTime() - BACKFILL_LOOKBACK_MS) } } },
      payoutReleases: { none: {} },
    },
    select: { id: true },
    take: BACKFILL_LIMIT,
  });
  for (const booking of missing) {
    try {
      if (await ensurePayoutRelease(booking.id)) created++;
    } catch (err: any) {
      failed++;
      console.error("[payout-release] backfill failed", { bookingId: booking.id, code: err?.code, message: err?.message });
    }
  }

  // Rotate through every active release. Permanently blocked old rows must not
  // consume the first page forever and starve newer owners.
  const page = (afterId: number) => prisma.payoutRelease.findMany({
    where: { status: { in: EVALUATED_RELEASE_STATUSES }, id: { gt: afterId } },
    orderBy: { id: "asc" as const },
    take: EVALUATE_LIMIT,
    select: { id: true, status: true, holdReason: true, sourceId: true, bookingId: true, ownerId: true, releaseAt: true, rule: true },
  });
  let releases = await page(lastEvaluatedReleaseId);
  if (releases.length === 0 && lastEvaluatedReleaseId !== 0) {
    lastEvaluatedReleaseId = 0;
    releases = await page(0);
  }
  if (releases.length) lastEvaluatedReleaseId = releases[releases.length - 1].id;
  for (const release of releases) {
    try {
      await ensureGuestCheckInConfirmation(release.bookingId);
      // Convert existing shadow releases made under the former 24-hour rules.
      let current = release;
      if (release.rule !== "CHECKIN_CONFIRMED") {
        const code = await prisma.checkinCode.findUnique({ where: { bookingId: release.bookingId }, select: { usedAt: true, status: true } });
        if (code?.status === "USED" && code.usedAt) {
          current = await prisma.payoutRelease.update({ where: { id: release.id }, data: { rule: "CHECKIN_CONFIRMED", releaseAt: code.usedAt } });
        }
      }
      const decision = decideRelease(await loadReleaseContext(current, now));
      if (await applyReleaseDecision(current, decision, now)) {
        moved++;
        console.log(`[payout-release] release ${release.id}: ${release.status} -> ${decision.next}${decision.reason ? ` (${decision.reason})` : ""}`);
      }
    } catch (err: any) {
      failed++;
      console.error("[payout-release] evaluation failed", { releaseId: release.id, code: err?.code, message: err?.message });
    }
  }

  return { created, moved, failed };
}

/**
 * AUTO lane (Phase 3). Authorizes any automatic batch still waiting on the
 * daily cap, then forms and authorizes new ones from what is left of today's
 * cap. The existing batch worker (processAuthorizedBatches) does the actual
 * sending. Does nothing while the kill switch is off or no cap is set.
 */
export async function runAutoLanePass(
  now = new Date()
): Promise<{ reminded: number; unclaimed: number; authorized: number; skipped: string[] }> {
  const skipped: string[] = [];
  let reminded = 0;
  let unclaimed = 0;
  // Recovery debts not covered within 7 business days: ask the owner to repay.
  try {
    await requestOverdueRepayments(now);
  } catch (err: any) {
    console.error("[payout-release] overdue recovery request failed", { message: err?.message });
  }
  // Reminder first: the unclaimed sender only takes payouts reminded at least 48h ago.
  try {
    reminded = await remindUnclaimed(now);
  } catch (err: any) {
    console.error("[payout-release] unclaimed reminder failed", { message: err?.message });
  }
  try {
    unclaimed = await withdrawUnclaimed(now);
  } catch (err: any) {
    console.error("[payout-release] unclaimed withdrawal failed", { message: err?.message });
  }

  const settings = await loadAutoLaneSettings();
  if (!settings.enabled || settings.dailyCapTzs === null) return { reminded, unclaimed, authorized: 0, skipped };

  let authorized = 0;
  const tryAuthorize = async (batchId: number) => {
    try {
      const result = await authorizeAutoBatch(batchId, now);
      if (result.kind === "authorized") authorized++;
      else skipped.push(`batch ${batchId}: ${result.reason}`);
    } catch (err: any) {
      console.error("[payout-release] automatic batch authorization failed", { batchId, message: err?.message });
    }
  };

  const waiting = await prisma.disbursementBatch.findMany({
    where: { mode: "AUTO", status: "DRAFT" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  for (const batch of waiting) await tryAuthorize(batch.id);

  const remaining = settings.dailyCapTzs - (await autoLaneAuthorizedToday(now));
  const pending = await prisma.disbursement.count({ where: { status: "APPROVED", batchId: null, releaseLane: "AUTO" } });
  if (remaining > 0 && pending > 0) {
    try {
      const formed = await formAutoBatch(remaining);
      for (const batch of formed.batches) await tryAuthorize(batch.id);
    } catch (err: any) {
      console.error("[payout-release] automatic batch formation failed", { message: err?.message });
    }
  }
  return { reminded, unclaimed, authorized, skipped };
}

export function startPayoutReleaseWorker({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}): void {
  if (!payoutReleaseEnabled()) {
    console.log("[payout-release] disabled (PAYOUT_RELEASE_ENABLED is not set)");
    return;
  }
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runPayoutReleasePass();
      if (result.created || result.moved || result.failed) {
        console.log(`[payout-release] pass: created ${result.created}, moved ${result.moved}, failed ${result.failed}`);
      }
      const auto = await runAutoLanePass();
      if (auto.reminded || auto.unclaimed || auto.authorized || auto.skipped.length) {
        console.log(
          `[payout-release] auto lane: reminded ${auto.reminded}, unclaimed ${auto.unclaimed}, batches authorized ${auto.authorized}` +
            (auto.skipped.length ? `, waiting: ${auto.skipped.join("; ")}` : "")
        );
      }
    } catch (error) {
      console.error("[payout-release] worker failed", error);
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[payout-release] started, interval ${intervalMs / 1000}s`);
}

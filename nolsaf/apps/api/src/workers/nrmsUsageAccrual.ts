import { prisma } from "@nolsaf/prisma";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";
import { buildNrmsUsageRows, getAlreadyBilledNights, applyNrmsUsageRows, NRMS_STATEMENT_TRANSACTION_OPTIONS } from "../lib/nrmsBilling.js";

const db = prisma as any;

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * Posts PAYG usage for nights that have already elapsed on reservations still
 * CHECKED_IN, instead of leaving the whole stay to bill in one lump sum at
 * checkout. Safe to run as often as the interval allows - getAlreadyBilledNights
 * plus the DB unique constraint mean a night already posted is never re-billed,
 * so more frequent runs only narrow the exposure window, never double-charge.
 */
export async function runNrmsUsageAccrual(now = new Date()) {
  const today = utcDay(now);
  const processedProperties = new Set<number>();
  const failedProperties = new Set<number>();
  let totalEvents = 0;
  const batchSize = Math.max(50, Math.min(1000, Number(process.env.NRMS_WORKER_BATCH_SIZE || 250)));
  let cursorId = 0;

  while (true) {
    const reservations = await db.reservation.findMany({
      where: {
        id: { gt: cursorId },
        status: "CHECKED_IN",
        allocations: { some: { status: "ACTIVE", startDate: { lt: today } } },
      },
      select: {
        id: true,
        propertyId: true,
        source: true,
        bookingId: true,
        allocations: { where: { status: "ACTIVE" }, select: { id: true, startDate: true, endDate: true } },
      },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (!reservations.length) break;
    const lastId = Number(reservations[reservations.length - 1].id);
    if (!Number.isFinite(lastId) || lastId <= cursorId) {
      throw new Error("NRMS usage accrual pagination did not advance");
    }
    const isLastBatch = reservations.length < batchSize;
    cursorId = lastId;

    const byProperty = new Map<number, typeof reservations>();
    for (const reservation of reservations) {
      const list = byProperty.get(reservation.propertyId) ?? [];
      list.push(reservation);
      byProperty.set(reservation.propertyId, list);
    }

    for (const [propertyId, propertyReservations] of byProperty) {
      // If an earlier batch for this property failed, preserve ordering and
      // retry the whole property on the next run instead of posting later nights.
      if (failedProperties.has(propertyId)) continue;
      const transactionStartedAt = performance.now();
      try {
        const result = await db.$transaction(async (tx: any) => {
          const account = await tx.ownerPaygAccount.findUnique({ where: { propertyId }, include: { policy: true } });
          if (!account) return { usageEvents: 0 };
          const allocationIds = propertyReservations.flatMap((r: any) => r.allocations.map((a: any) => a.id));
          const alreadyBilled = await getAlreadyBilledNights(tx, allocationIds);
          const rows = propertyReservations.flatMap((reservation: any) =>
            buildNrmsUsageRows({
              accountId: account.id,
              propertyId,
              reservationId: reservation.id,
              policyId: account.policyId,
              trialEndsAt: account.trialEndsAt,
              currency: account.policy.currency,
              roomNightPrice: Number(account.policy.roomNightPrice),
              source: reservation.source,
              bookingId: reservation.bookingId ?? null,
              allocations: reservation.allocations,
              postThroughDate: today,
              alreadyBilled,
            }),
          );
          if (!rows.length) return { usageEvents: 0 };
          return applyNrmsUsageRows(tx, account, rows);
        }, NRMS_STATEMENT_TRANSACTION_OPTIONS);
        // A transaction can fail while committing after its callback returns.
        // Count usage only after Prisma confirms the entire statement committed.
        totalEvents += result.usageEvents;
        processedProperties.add(propertyId);
        const durationMs = Math.round(performance.now() - transactionStartedAt);
        if (durationMs > 5_000) {
          console.warn("[nrms-usage-accrual] slow property transaction", { propertyId, reservations: propertyReservations.length, durationMs });
        }
      } catch (error) {
        failedProperties.add(propertyId);
        console.error(`[nrms-usage-accrual] property ${propertyId} failed after ${Math.round(performance.now() - transactionStartedAt)} ms`, error);
      }
    }
    if (isLastBatch) break;
  }
  // Continue other properties, but never mark the worker HEALTHY if any failed.
  if (failedProperties.size) {
    throw new Error(`NRMS usage accrual failed for ${failedProperties.size} propert${failedProperties.size === 1 ? "y" : "ies"}: ${[...failedProperties].join(", ")}`);
  }
  return { properties: processedProperties.size, usageEvents: totalEvents };
}

export function startNrmsUsageAccrualWorker() {
  const intervalMs = Math.max(15 * 60_000, Number(process.env.NRMS_USAGE_ACCRUAL_INTERVAL_MS || 60 * 60_000));
  const run = () =>
    runNrmsWorker("usage-accrual", () => runNrmsUsageAccrual()).catch((error) =>
      console.error("[nrms-usage-accrual] worker failed", error),
    );
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[nrms-usage-accrual] Started, interval: ${intervalMs / 1000}s`);
}

import { prisma } from "@nolsaf/prisma";
import { mapGroupStayLifecycle, mapPropertyLifecycle, mapTourLifecycle } from "../lib/serviceLifecycle.js";
import { persistLifecycleObservation } from "../lib/lifecycleObservationStore.js";

type SweepOptions = { batchSize?: number; updatedSince?: Date };

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function receiptStatus(events: Array<{ type: string }>): string {
  const types = new Set(events.map((event) => String(event.type || "").toUpperCase()));
  if (["OPERATOR_RECEIVED", "ACKNOWLEDGE", "ESCALATE", "OPERATOR_COST_EVIDENCE"].some((type) => types.has(type))) return "RECEIVED";
  if (types.has("OPERATOR_NOTIFIED")) return "AWAITING_RECEIPT";
  return "UNDELIVERED";
}

/** Rebuilds read-only lifecycle state in bounded batches. */
export async function runLifecycleHealthSweep(options: SweepOptions = {}): Promise<{ processed: number; failed: number }> {
  const batchSize = Math.min(250, positiveInt(options.batchSize ?? process.env.LIFECYCLE_HEALTH_BATCH_SIZE, 100));
  const changedSince = options.updatedSince ? { updatedAt: { gte: options.updatedSince } } : {};
  let processed = 0;
  let failed = 0;

  const propertyCount = await (prisma as any).booking.count({ where: changedSince });
  for (let skip = 0; skip < propertyCount; skip += batchSize) {
    const bookings = await (prisma as any).booking.findMany({
      skip,
      take: batchSize,
      where: changedSince,
      orderBy: { id: "asc" },
      select: {
        id: true, status: true, updatedAt: true,
        code: { select: { status: true } },
        invoices: { orderBy: { issuedAt: "desc" }, take: 1, select: { status: true, receiptNumber: true } },
        cancellationRequests: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      },
    });
    for (const booking of bookings) {
      try {
        const invoice = booking.invoices?.[0];
        const cancellation = booking.cancellationRequests?.[0];
        await persistLifecycleObservation({
          serviceType: "PROPERTY",
          bookingId: booking.id,
          lifecycle: mapPropertyLifecycle({ bookingStatus: booking.status, invoiceStatus: invoice?.status, hasInvoice: Boolean(invoice), receiptNumber: invoice?.receiptNumber, checkInCodeStatus: booking.code?.status, cancellationStatus: cancellation?.status, cancellationLoaded: true }),
          metadata: { worker: "lifecycle-health", sourceUpdatedAt: booking.updatedAt },
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[lifecycle-health] property booking ${booking.id} failed`, error);
      }
    }
  }

  const groupCount = await (prisma as any).groupBooking.count({ where: changedSince });
  for (let skip = 0; skip < groupCount; skip += batchSize) {
    const bookings = await (prisma as any).groupBooking.findMany({
      skip,
      take: batchSize,
      where: changedSince,
      orderBy: { id: "asc" },
      select: { id: true, status: true, updatedAt: true, depositPaid: true, depositPaidAt: true, depositAmount: true, depositDueAt: true, confirmedPropertyId: true },
    });
    for (const booking of bookings) {
      try {
        const depositExpired = booking.status === "AWAITING_DEPOSIT" && !booking.depositPaid && booking.depositDueAt && new Date(booking.depositDueAt).getTime() < Date.now();
        await persistLifecycleObservation({
          serviceType: "GROUP_STAY",
          bookingId: booking.id,
          lifecycle: mapGroupStayLifecycle({ bookingStatus: booking.status, depositPaid: booking.depositPaid, depositPaidAt: booking.depositPaidAt, depositAmount: booking.depositAmount, depositExpired: Boolean(depositExpired), confirmedPropertyId: booking.confirmedPropertyId, cancellationLoaded: true }),
          metadata: { worker: "lifecycle-health", sourceUpdatedAt: booking.updatedAt },
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[lifecycle-health] group stay ${booking.id} failed`, error);
      }
    }
  }

  const tourCount = await (prisma as any).tourBooking.count({ where: changedSince });
  for (let skip = 0; skip < tourCount; skip += batchSize) {
    const bookings = await (prisma as any).tourBooking.findMany({
      skip,
      take: batchSize,
      where: changedSince,
      orderBy: { id: "asc" },
      select: { id: true, status: true, paymentStatus: true, paidAt: true, operatorAgentId: true, updatedAt: true, cases: { where: { type: "CANCELLATION" }, orderBy: { createdAt: "desc" }, take: 1, select: { status: true, events: { orderBy: { createdAt: "desc" }, take: 50, select: { type: true } } } } },
    });
    for (const booking of bookings) {
      try {
        const cancellation = booking.cases?.[0];
        await persistLifecycleObservation({
          serviceType: "TOUR",
          bookingId: booking.id,
          lifecycle: mapTourLifecycle({ bookingStatus: booking.status, paymentStatus: booking.paymentStatus, paidAt: booking.paidAt, operatorAssigned: Boolean(booking.operatorAgentId), operatorReceiptStatus: receiptStatus(cancellation?.events || []), cancellationStatus: cancellation?.status, cancellationLoaded: true }),
          metadata: { worker: "lifecycle-health", sourceUpdatedAt: booking.updatedAt },
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        console.error(`[lifecycle-health] tour booking ${booking.id} failed`, error);
      }
    }
  }

  return { processed, failed };
}

export function startLifecycleHealthWorker(): void {
  const intervalMs = Math.max(60_000, positiveInt(process.env.LIFECYCLE_HEALTH_INTERVAL_MS, 300_000));
  let lastSweepStartedAt: Date | undefined;
  const run = async () => {
    const startedAt = new Date();
    const incremental = Boolean(lastSweepStartedAt);
    try {
      const result = await runLifecycleHealthSweep({ updatedSince: lastSweepStartedAt });
      lastSweepStartedAt = startedAt;
      console.log(`[lifecycle-health] sweep complete processed=${result.processed} failed=${result.failed}${incremental ? " (changed records only)" : " (initial backfill)"}`);
    } catch (error) {
      console.error("[lifecycle-health] sweep failed", error);
    }
  };
  run();
  setInterval(() => void run(), intervalMs);
  console.log(`[lifecycle-health] worker enabled intervalMs=${intervalMs}`);
}

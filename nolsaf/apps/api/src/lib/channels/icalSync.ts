// apps/api/src/lib/channels/icalSync.ts
//
// The inbound half of a calendar connection: turning an OTA's published busy
// dates into availability holds that consume inventory.
//
// A calendar carries no guest, rate, confirmation number, or even proof that a
// busy date is a booking. Imported events are therefore availability holds,
// never guest reservations. Reservation records come from a provider API or a
// person at the desk, where their operational and financial meaning is known.
//
// Three rules keep this safe to run unattended:
//   - it never creates or edits a guest stay from availability-only evidence.
//   - it records an external hold even when inventory is already full, then
//     raises a visible reconciliation issue so no additional room can sell.
//   - it is idempotent per event. The provider's UID plus a content hash means
//     a feed polled every half hour does nothing at all until something moves.
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { decrypt } from "../crypto.js";
import { lockPropertyInventory, getRoomTypeAvailability } from "../nrmsAvailability.js";
import { runNrmsWorker } from "../nrmsWorkerHealth.js";
import { fetchIcalText, IcalFetchError } from "./icalFetch.js";
import { parseIcalFeed, type IcalEvent } from "./icalParse.js";

const db = prisma as any;

/** Airbnb refreshes an imported calendar on its own schedule, measured in hours. Polling far below that only burns requests. */
export const ICAL_POLL_INTERVAL_MINUTES = 30;
/** A failing feed backs off so a dead link is not retried every half hour forever. */
export const ICAL_FAILURE_BACKOFF_MINUTES = 120;
/** Airbnb can expose/import up to two years of availability. */
export const ICAL_IMPORT_HORIZON_MONTHS = 24;
/** Missing from this many complete snapshots before an inferred cancellation is trusted. */
export const ICAL_MISSING_GRACE_POLLS = 3;

export type IcalImportSummary = {
  feedId: number;
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  conflicts: number;
  skipped: number;
};

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

async function raiseIssue(tx: any, connectionId: number, kind: string, externalRef: string, details: Record<string, unknown>, severity = "WARNING") {
  const open = await tx.channelReconciliationIssue.findFirst({
    where: { connectionId, kind, externalRef, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    select: { id: true },
  });
  if (open) {
    await tx.channelReconciliationIssue.update({ where: { id: open.id }, data: { lastSeenAt: new Date(), details } });
    return;
  }
  await tx.channelReconciliationIssue.create({ data: { connectionId, kind, severity, status: "OPEN", externalRef, details } });
}

async function resolveIssues(tx: any, connectionId: number, externalRef: string) {
  await tx.channelReconciliationIssue.updateMany({
    where: { connectionId, externalRef, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

/** Evidence row so the admin channel views show a calendar the same way they show an API push. */
async function recordInboundEvent(tx: any, connectionId: number, feedId: number, event: IcalEvent, availabilityBlockId: number | null, status: string) {
  const providerEventId = `${feedId}:${event.uid}:${event.hash.slice(0, 16)}`.slice(0, 200);
  const existing = await tx.channelInboundEvent.findFirst({ where: { connectionId, providerEventId }, select: { id: true } });
  const payload = {
    uid: event.uid,
    start: event.start.toISOString().slice(0, 10),
    end: event.end.toISOString().slice(0, 10),
    summary: event.summary,
    cancelled: event.cancelled,
    feedId,
    availabilityBlockId,
  };
  if (existing) {
    await tx.channelInboundEvent.update({ where: { id: existing.id }, data: { status, reservationId: null, payload, processedAt: new Date(), attemptCount: { increment: 1 } } });
    return;
  }
  await tx.channelInboundEvent.create({
    data: {
      connectionId,
      providerEventId,
      idempotencyKey: providerEventId,
      eventType: "CALENDAR_BLOCK",
      payloadHash: event.hash,
      payload,
      status,
      reservationId: null,
      processedAt: new Date(),
      attemptCount: 1,
    },
  });
}

type FeedContext = {
  feedId: number;
  connectionId: number;
  propertyId: number;
  ownerId: number;
  roomTypeId: number;
  roomTypeName: string;
  providerCode: string;
  label: string | null;
};

export function calendarBlockData(context: Pick<FeedContext, "propertyId" | "ownerId" | "roomTypeName" | "providerCode" | "label">, event: IcalEvent) {
  return {
    propertyId: context.propertyId,
    ownerId: context.ownerId,
    startDate: event.start,
    endDate: event.end,
    roomCode: context.roomTypeName.slice(0, 60),
    source: context.providerCode.slice(0, 50),
    kind: "CHANNEL_CALENDAR",
    bedsBlocked: 1,
    notes: [context.label, event.summary].filter(Boolean).join(" - ").slice(0, 500) || null,
  };
}

export function missingEventAction(currentMissingCount: number, explicitlyCancelled: boolean): { release: boolean; missingCount: number } {
  if (explicitlyCancelled) return { release: true, missingCount: Math.max(0, currentMissingCount) };
  const missingCount = Math.max(0, Math.floor(currentMissingCount)) + 1;
  return { release: missingCount >= ICAL_MISSING_GRACE_POLLS, missingCount };
}

export function isOwnCalendarExport(event: Pick<IcalEvent, "uid">): boolean {
  return /^nrms-\d+-\d{8}-\d{8}@nolsaf\.com$/i.test(event.uid);
}

async function recordCapacityConflict(tx: any, context: FeedContext, event: IcalEvent, summary: IcalImportSummary, excludeBlockId?: number): Promise<boolean> {
  const capacity = await getRoomTypeAvailability(tx, context.propertyId, context.roomTypeId, event.start, event.end, { excludeBlockId });
  if (capacity.available < 1) {
    summary.conflicts += 1;
    await raiseIssue(tx, context.connectionId, "INVENTORY_MISMATCH", event.uid, {
      reason: "NO_CAPACITY",
      roomTypeId: context.roomTypeId,
      start: event.start.toISOString().slice(0, 10),
      end: event.end.toISOString().slice(0, 10),
      capacity: capacity.capacity,
      consumed: capacity.consumed,
      message: "The provider marks a night unavailable after this room type was already full. The calendar hold was retained and the overbooking needs reconciliation.",
    }, "CRITICAL");
    return true;
  }
  return false;
}

async function createFromEvent(tx: any, context: FeedContext, event: IcalEvent, summary: IcalImportSummary): Promise<number> {
  const conflicted = await recordCapacityConflict(tx, context, event, summary);
  const block = await tx.propertyAvailabilityBlock.create({
    data: calendarBlockData(context, event),
  });
  if (!conflicted) await resolveIssues(tx, context.connectionId, event.uid);
  await recordInboundEvent(tx, context.connectionId, context.feedId, event, block.id, "PROCESSED");
  summary.created += 1;
  return block.id;
}

async function updateFromEvent(tx: any, context: FeedContext, event: IcalEvent, blockId: number, summary: IcalImportSummary): Promise<boolean> {
  const block = await tx.propertyAvailabilityBlock.findUnique({
    where: { id: blockId },
    select: { id: true, startDate: true, endDate: true },
  });
  if (!block) return false;
  let conflicted = false;
  if (block.startDate.getTime() !== event.start.getTime() || block.endDate.getTime() !== event.end.getTime()) {
    conflicted = await recordCapacityConflict(tx, context, event, summary, block.id);
    await tx.propertyAvailabilityBlock.update({
      where: { id: block.id },
      data: {
        startDate: event.start,
        endDate: event.end,
        roomCode: context.roomTypeName.slice(0, 60),
        source: context.providerCode.slice(0, 50),
        kind: "CHANNEL_CALENDAR",
        notes: [context.label, event.summary].filter(Boolean).join(" - ").slice(0, 500) || null,
      },
    });
  }
  if (!conflicted) await resolveIssues(tx, context.connectionId, event.uid);
  await recordInboundEvent(tx, context.connectionId, context.feedId, event, block.id, "PROCESSED");
  summary.updated += 1;
  return true;
}

async function releaseCalendarBlock(tx: any, blockId: number | null, summary: IcalImportSummary) {
  if (blockId) await tx.propertyAvailabilityBlock.deleteMany({ where: { id: blockId, kind: "CHANNEL_CALENDAR" } });
  summary.cancelled += 1;
}

/**
 * Poll one IMPORT feed and reconcile it against NRMS.
 *
 * The fetch happens outside the transaction on purpose: holding the property
 * inventory lock across a third-party HTTP call would stall every booking at
 * the property for as long as that provider takes to answer.
 */
export async function importIcalFeed(feedId: number, now = new Date()): Promise<IcalImportSummary> {
  const summary: IcalImportSummary = { feedId, created: 0, updated: 0, cancelled: 0, unchanged: 0, conflicts: 0, skipped: 0 };
  const feed = await db.channelCalendarFeed.findUnique({
    where: { id: feedId },
    include: {
      roomType: { select: { id: true, name: true } },
      connection: { include: { provider: true, property: { select: { id: true, ownerId: true } } } },
    },
  });
  if (!feed) throw new Error(`Calendar feed ${feedId} not found`);
  if (feed.direction !== "IMPORT") throw new Error(`Calendar feed ${feedId} is not an import feed`);
  if (!feed.roomTypeId || !feed.roomType) throw new Error(`Calendar feed ${feedId} has no room type`);
  if (!feed.encryptedUrl) throw new Error(`Calendar feed ${feedId} has no address`);

  const context: FeedContext = {
    feedId: feed.id,
    connectionId: feed.connectionId,
    propertyId: feed.connection.propertyId,
    ownerId: feed.connection.property.ownerId,
    roomTypeId: feed.roomTypeId,
    roomTypeName: feed.roomType.name,
    providerCode: feed.connection.provider.code,
    label: feed.label,
  };

  const run = await db.channelSyncRun.create({ data: { connectionId: context.connectionId, kind: "DELTA", status: "RUNNING" } });
  try {
    const text = await fetchIcalText(decrypt(feed.encryptedUrl));
    const parsed = parseIcalFeed(text);
    if (parsed.truncated) {
      throw new IcalFetchError("FEED_TRUNCATED", "The calendar contains too many events to reconcile safely.");
    }
    summary.skipped = parsed.skipped.length;

    // Past nights cannot be held and far-future ones are noise. Both are
    // dropped before anything is written.
    const today = utcDay(now);
    const horizon = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + ICAL_IMPORT_HORIZON_MONTHS, today.getUTCDate()));
    const liveByUid = new Map<string, IcalEvent>();
    for (const event of parsed.events) {
      if (!isOwnCalendarExport(event) && !event.cancelled && event.end.getTime() > today.getTime() && event.start.getTime() < horizon.getTime()) liveByUid.set(event.uid, event);
    }
    const live = [...liveByUid.values()];
    const cancelled = new Set(parsed.events.filter((event) => !isOwnCalendarExport(event) && event.cancelled).map((event) => event.uid));
    // A malformed event with a readable UID is still present. Protect its
    // existing hold rather than interpreting a parser limitation as a sale.
    const skippedUids = new Set(parsed.skipped.flatMap((entry) => entry.uid ? [entry.uid] : []));
    const seen = new Set([...live.map((event) => event.uid), ...skippedUids]);

    await db.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, context.propertyId);
      const existing = await tx.channelCalendarEventMap.findMany({ where: { feedId: context.feedId } });
      const byUid = new Map<string, any>(existing.map((row: any) => [row.externalEventId, row]));

      for (const event of live) {
        const known = byUid.get(event.uid);
        if (known?.availabilityBlockId && known.eventHash === event.hash) {
          await tx.channelCalendarEventMap.update({ where: { id: known.id }, data: { lastSeenAt: now, missingCount: 0 } });
          summary.unchanged += 1;
          continue;
        }

        let blockId = known?.availabilityBlockId ?? null;
        const updated = blockId ? await updateFromEvent(tx, context, event, blockId, summary) : false;
        if (!updated) blockId = await createFromEvent(tx, context, event, summary);
        const mapData = { eventHash: event.hash, lastSeenAt: now, missingCount: 0, reservationId: null, availabilityBlockId: blockId };
        if (known) await tx.channelCalendarEventMap.update({ where: { id: known.id }, data: mapData });
        else await tx.channelCalendarEventMap.create({ data: { feedId: context.feedId, externalEventId: event.uid.slice(0, 200), ...mapData } });
      }

      // Explicit cancellation is authoritative. Mere absence is trusted only
      // after several complete snapshots so a transient partial response can
      // never reopen sold inventory.
      for (const row of existing) {
        if (skippedUids.has(row.externalEventId)) {
          await tx.channelCalendarEventMap.update({ where: { id: row.id }, data: { lastSeenAt: now, missingCount: 0 } });
          continue;
        }
        if (seen.has(row.externalEventId)) continue;
        const missing = missingEventAction(Number(row.missingCount ?? 0), cancelled.has(row.externalEventId));
        if (missing.release) {
          await releaseCalendarBlock(tx, row.availabilityBlockId ?? null, summary);
          await tx.channelCalendarEventMap.delete({ where: { id: row.id } });
          continue;
        }
        await tx.channelCalendarEventMap.update({ where: { id: row.id }, data: { missingCount: missing.missingCount } });
      }
    });

    const nextPollAt = new Date(now.getTime() + ICAL_POLL_INTERVAL_MINUTES * 60_000);
    await db.channelCalendarFeed.update({
      where: { id: context.feedId },
      data: { status: "ACTIVE", lastPolledAt: now, lastSuccessAt: now, nextPollAt, lastError: null },
    });
    await db.channelConnection.update({
      where: { id: context.connectionId },
      data: { status: "ACTIVE", lastInboundAt: now, lastSuccessAt: now, lastErrorCode: null, lastErrorMessage: null },
    });
    await db.channelSyncRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        completedAt: new Date(),
        itemCount: parsed.events.length,
        successCount: summary.created + summary.updated + summary.unchanged + summary.cancelled,
        failureCount: summary.conflicts,
        details: { ...summary, parseSkipped: parsed.skipped.slice(0, 20) },
      },
    });
    return summary;
  } catch (error) {
    const code = error instanceof IcalFetchError ? error.code : "SYNC_FAILED";
    const message = String(error instanceof Error ? error.message : error).slice(0, 1000);
    const nextPollAt = new Date(now.getTime() + ICAL_FAILURE_BACKOFF_MINUTES * 60_000);
    await db.channelCalendarFeed.update({
      where: { id: feedId },
      data: { status: "ERROR", lastPolledAt: now, nextPollAt, lastError: `${code}: ${message}`.slice(0, 1000) },
    });
    await db.channelConnection.update({
      where: { id: context.connectionId },
      data: { status: "ERROR", lastFailureAt: now, lastErrorCode: code.slice(0, 80), lastErrorMessage: message },
    });
    await db.channelSyncRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date(), errorMessage: message, details: summary },
    });
    throw error;
  }
}

/** Every import feed whose next poll is due. */
export async function runDueIcalImports(now = new Date(), limit = 25): Promise<{ polled: number; failed: number }> {
  const feeds = await db.channelCalendarFeed.findMany({
    where: {
      direction: "IMPORT",
      status: { in: ["ACTIVE", "ERROR"] },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: now } }],
      connection: { status: { notIn: ["DISCONNECTED", "PAUSED"] } },
    },
    select: { id: true },
    orderBy: [{ nextPollAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  let failed = 0;
  for (const feed of feeds) {
    try {
      await importIcalFeed(feed.id, new Date());
    } catch (error) {
      failed += 1;
      // importIcalFeed has already recorded the failure against the feed and
      // the connection. One bad provider must not stop the rest of the batch.
      console.warn(`[ical-sync] feed ${feed.id} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return { polled: feeds.length, failed };
}

export function startIcalCalendarSyncWorker() {
  const intervalMs = Math.max(60_000, Number(process.env.ICAL_SYNC_INTERVAL_MS || 5 * 60_000));
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runNrmsWorker("ical-sync", () => runDueIcalImports(new Date()));
    } catch (error) {
      console.error("[ical-sync] worker failed", error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[ical-sync] Started, interval: ${intervalMs / 1000}s`);
}

import crypto from "node:crypto";
import { decrypt } from "../crypto.js";
import { prisma } from "@nolsaf/prisma";
import { runNrmsWorker } from "../nrmsWorkerHealth.js";
import { bookingComClient, BookingComApiError } from "./bookingComClient.js";
import { buildBookingComAvailabilityXml, type BookingComAriPolicy } from "./bookingComAri.js";
import { parseBookingResponseHasErrors } from "./bookingComReservations.js";
import { notifyOwner } from "../notifications.js";

const db = prisma as any;
const MAX_ATTEMPTS = 8;
const RECENT_EVENT_WINDOW_MS = 48 * 60 * 60 * 1000;

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function credentialsFor(connectionId: number) {
  const row = await db.channelCredentialVersion.findFirst({ where: { connectionId, status: "ACTIVE" }, orderBy: { version: "desc" }, select: { encryptedData: true } });
  if (!row) return null;
  try {
    const parsed = JSON.parse(decrypt(row.encryptedData, { log: false })) as { clientId?: unknown; clientSecret?: unknown };
    return typeof parsed.clientId === "string" && typeof parsed.clientSecret === "string"
      ? { clientId: parsed.clientId, clientSecret: parsed.clientSecret }
      : null;
  } catch {
    return null;
  }
}

async function recordAriIssue(connectionId: number, internalRef: string, details: Record<string, unknown>) {
  const existing = await db.channelReconciliationIssue.findFirst({ where: { connectionId, kind: "INVENTORY_MISMATCH", internalRef, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
  if (existing) {
    await db.channelReconciliationIssue.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), details } });
    return;
  }
  await db.channelReconciliationIssue.create({ data: { connectionId, kind: "INVENTORY_MISMATCH", severity: "WARNING", status: "OPEN", internalRef, details } });
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function minDate(values: Date[]): Date | null {
  return values.length ? new Date(Math.min(...values.map((value) => value.getTime()))) : null;
}

function maxDate(values: Date[]): Date | null {
  return values.length ? new Date(Math.max(...values.map((value) => value.getTime()))) : null;
}

type AriWindow = { reservationId?: number; from?: Date | null; to?: Date | null; forceClosed?: boolean };

async function availabilityXml(connectionId: number, window: AriWindow): Promise<{ xml: string | null; missingPrices: number }> {
  const connection = await db.channelConnection.findUnique({
    where: { id: connectionId },
    select: { id: true, propertyId: true, externalPropertyId: true, status: true },
  });
  if (!connection || !connection.externalPropertyId || !["ACTIVE", "PILOT"].includes(connection.status)) return { xml: null, missingPrices: 0 };

  let roomTypeIds: number[] = [];
  let from = asDate(window.from);
  let to = asDate(window.to);
  if (window.reservationId) {
    const reservation = await db.reservation.findUnique({
      where: { id: window.reservationId },
      select: { propertyId: true, allocations: { select: { roomTypeId: true, startDate: true, endDate: true } } },
    });
    if (!reservation || reservation.propertyId !== connection.propertyId || !reservation.allocations.length) return { xml: null, missingPrices: 0 };
    roomTypeIds = Array.from(new Set<number>(reservation.allocations.map((allocation: any) => Number(allocation.roomTypeId))));
    from = minDate(reservation.allocations.map((allocation: any) => new Date(allocation.startDate) as Date)) ?? from;
    to = maxDate(reservation.allocations.map((allocation: any) => new Date(allocation.endDate) as Date)) ?? to;
  }
  if (!from || !to || to <= from) return { xml: null, missingPrices: 0 };
  if (!roomTypeIds.length) {
    const mappedRooms = await db.channelRoomMapping.findMany({ where: { connectionId, status: "MAPPED" }, select: { roomTypeId: true } });
    roomTypeIds = Array.from(new Set<number>(mappedRooms.map((mapping: any) => Number(mapping.roomTypeId))));
  }
  if (!roomTypeIds.length) return { xml: null, missingPrices: 0 };

  const [roomMappings, rateMappings, roomTypes, allocations] = await Promise.all([
    db.channelRoomMapping.findMany({ where: { connectionId, roomTypeId: { in: roomTypeIds }, status: "MAPPED" }, select: { roomTypeId: true, externalId: true } }),
    db.channelRateMapping.findMany({ where: { connectionId, status: "MAPPED", roomTypeId: { in: roomTypeIds } }, select: { roomTypeId: true, externalId: true, currency: true, metadata: true } }),
    db.roomType.findMany({ where: { propertyId: connection.propertyId, id: { in: roomTypeIds } }, select: { id: true, status: true, baseRate: true, currency: true, units: { select: { status: true } } } }),
    db.reservationRoomAllocation.findMany({ where: { roomTypeId: { in: roomTypeIds }, status: "ACTIVE", startDate: { lt: to }, endDate: { gt: from }, reservation: { status: { notIn: ["CANCELLED", "NO_SHOW", "EXPIRED"] } } }, select: { roomTypeId: true, startDate: true, endDate: true } }),
  ]);
  const mappingByRoomType = new Map(roomMappings.map((mapping: any) => [mapping.roomTypeId, mapping.externalId]));
  const roomTypeById = new Map<number, any>(roomTypes.map((roomType: any) => [Number(roomType.id), roomType] as [number, any]));
  const roomLevel: Array<{ roomId: string; date: string; roomsToSell: number }> = [];
  const rateLevel: Array<{ roomId: string; rateId: string; date: string; currency: string; price: number; closed?: boolean; policy?: BookingComAriPolicy | null }> = [];
  let missingPrices = 0;

  for (const roomTypeId of roomTypeIds) {
    const externalRoomId = mappingByRoomType.get(roomTypeId);
    const roomType = roomTypeById.get(roomTypeId);
    if (!externalRoomId || !roomType) continue;
    const activeUnits = roomType.status === "ACTIVE" ? roomType.units.filter((unit: any) => unit.status === "ACTIVE").length : 0;
    const ratesForRoom = rateMappings.filter((mapping: any) => mapping.roomTypeId === roomTypeId);
    for (let cursor = new Date(from); cursor < to; cursor = addDays(cursor, 1)) {
      const dayStart = new Date(`${dateKey(cursor)}T00:00:00.000Z`);
      const dayEnd = addDays(dayStart, 1);
      const occupied = allocations.filter((allocation: any) => allocation.roomTypeId === roomTypeId && new Date(allocation.startDate) < dayEnd && new Date(allocation.endDate) > dayStart).length;
      roomLevel.push({ roomId: String(externalRoomId), date: dateKey(dayStart), roomsToSell: window.forceClosed ? 0 : Math.max(0, activeUnits - occupied) });
      for (const mapping of ratesForRoom) {
        const price = roomType.baseRate == null ? null : Number(roomType.baseRate);
        if (price == null || !Number.isFinite(price) || price < 0) {
          missingPrices += 1;
          continue;
        }
        const metadata = mapping.metadata && typeof mapping.metadata === "object" ? mapping.metadata as Record<string, unknown> : {};
        const policy = metadata.ariPolicy && typeof metadata.ariPolicy === "object" ? metadata.ariPolicy as BookingComAriPolicy : null;
        rateLevel.push({ roomId: String(externalRoomId), rateId: String(mapping.externalId), date: dateKey(dayStart), currency: String(mapping.currency || roomType.currency || "TZS"), price, closed: window.forceClosed, policy });
      }
    }
  }
  if (!roomLevel.length && !rateLevel.length) return { xml: null, missingPrices };
  return { xml: buildBookingComAvailabilityXml({ hotelId: connection.externalPropertyId, roomLevel, rateLevel }), missingPrices };
}

export async function queueRecentBookingComAvailabilityUpdates(now = new Date(), connectionId?: number): Promise<number> {
  const since = new Date(now.getTime() - RECENT_EVENT_WINDOW_MS);
  const connections = await db.channelConnection.findMany({
    where: { ...(connectionId ? { id: connectionId } : {}), provider: { code: "BOOKING_COM" }, status: { in: ["ACTIVE", "PILOT"] } },
    select: { id: true, propertyId: true },
  });
  let queued = 0;
  for (const connection of connections) {
    const syncCursor = await db.channelSyncCursor.findUnique({
      where: { connectionId_scope: { connectionId: connection.id, scope: "BOOKING_COM_ARI_EVENTS" } },
      select: { cursor: true },
    });
    const lastEventId = Number(syncCursor?.cursor || 0);
    const events = await db.reservationEvent.findMany({
      where: {
        ...(Number.isInteger(lastEventId) && lastEventId > 0 ? { id: { gt: lastEventId } } : { createdAt: { gte: since } }),
        reservation: { propertyId: connection.propertyId },
      },
      select: { id: true, reservationId: true },
      orderBy: { id: "asc" },
      take: 500,
    });
    if (!events.length) continue;
    await db.$transaction(async (tx: any) => {
      for (const event of events) {
        const idempotencyKey = `reservation-event:${event.id}:connection:${connection.id}`;
        await tx.channelOutboundDelivery.upsert({
          where: { connectionId_idempotencyKey: { connectionId: connection.id, idempotencyKey } },
          create: { connectionId: connection.id, idempotencyKey, eventType: "ARI_DELTA", payload: { reservationId: event.reservationId, eventId: event.id }, reservationId: event.reservationId, status: "PENDING", nextAttemptAt: now },
          update: {},
        });
        queued += 1;
      }
      const newestEventId = events[events.length - 1]!.id;
      await tx.channelSyncCursor.upsert({
        where: { connectionId_scope: { connectionId: connection.id, scope: "BOOKING_COM_ARI_EVENTS" } },
        create: { connectionId: connection.id, scope: "BOOKING_COM_ARI_EVENTS", cursor: String(newestEventId), lastSyncedAt: now },
        update: { cursor: String(newestEventId), lastSyncedAt: now },
      });
    });
  }
  return queued;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function nextMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export function bookingComFullAriWindows(from = new Date(), months = 12): Array<{ from: Date; to: Date }> {
  const start = new Date(`${dateKey(from)}T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + Math.max(1, months), start.getUTCDate()));
  const windows: Array<{ from: Date; to: Date }> = [];
  for (let cursor = start; cursor < end;) {
    const boundary = nextMonth(monthStart(cursor));
    const to = boundary < end ? boundary : end;
    windows.push({ from: cursor, to });
    cursor = to;
  }
  return windows;
}

/** Queue a twelve-month initial/resynchronization ARI load in monthly batches. */
async function queueFullAriForConnections(client: any, connectionIds: number[], from: Date, months: number, resyncId: string): Promise<number> {
  const windows = bookingComFullAriWindows(from, months);
  let queued = 0;
  for (const connectionId of connectionIds) {
    for (const window of windows) {
      const idempotencyKey = `ari-full:${resyncId}:${dateKey(window.from)}:${dateKey(window.to)}`;
      await client.channelOutboundDelivery.upsert({
        where: { connectionId_idempotencyKey: { connectionId, idempotencyKey } },
        create: { connectionId, idempotencyKey, eventType: "ARI_FULL", payload: { from: dateKey(window.from), to: dateKey(window.to), resyncId }, status: "PENDING", nextAttemptAt: new Date() },
        update: { status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), acknowledgedAt: null, lastError: null },
      });
      queued += 1;
    }
  }
  return queued;
}

export async function queueBookingComFullAriUpdates(connectionId?: number, from = new Date(), months = 12, resyncId = crypto.randomUUID()): Promise<number> {
  const connections = await db.channelConnection.findMany({
    where: {
      ...(connectionId ? { id: connectionId } : {}),
      provider: { code: "BOOKING_COM" },
      status: { in: ["ACTIVE", "PILOT"] },
    },
    select: { id: true },
  });
  return queueFullAriForConnections(db, connections.map((connection: any) => Number(connection.id)), from, months, resyncId);
}

/** Queue ARI in the caller's transaction when NRMS inventory or pricing changes. */
export async function queueBookingComPropertyAriUpdates(client: any, propertyId: number, reason: string, from = new Date(), months = 12): Promise<number> {
  const connections = await client.channelConnection.findMany({
    where: { propertyId, provider: { code: "BOOKING_COM" }, status: { in: ["ACTIVE", "PILOT"] } },
    select: { id: true },
  });
  const resyncId = `${reason.slice(0, 32)}-${crypto.randomUUID()}`;
  return queueFullAriForConnections(client, connections.map((connection: any) => Number(connection.id)), from, months, resyncId);
}

/** Queue one governed stop-sell/release request using its database identity as
 * the idempotency boundary. `toDate` is inclusive in the admin workflow. */
export async function queueBookingComStopSell(client: any, input: { requestId: number; connectionId: number; action: "APPLY" | "RELEASE"; fromDate: Date; toDate: Date }) {
  const from = new Date(`${dateKey(input.fromDate)}T00:00:00.000Z`);
  const toExclusive = addDays(new Date(`${dateKey(input.toDate)}T00:00:00.000Z`), 1);
  const idempotencyKey = `stop-sell-request:${input.requestId}`;
  return client.channelOutboundDelivery.upsert({
    where: { connectionId_idempotencyKey: { connectionId: input.connectionId, idempotencyKey } },
    create: {
      connectionId: input.connectionId,
      idempotencyKey,
      eventType: input.action === "APPLY" ? "ARI_STOP_SELL" : "ARI_STOP_SELL_RELEASE",
      payload: { from: dateKey(from), to: dateKey(toExclusive), forceClosed: input.action === "APPLY", stopSellRequestId: input.requestId },
      status: "PENDING",
      nextAttemptAt: new Date(),
    },
    update: {},
  });
}

async function failDelivery(delivery: any, error: unknown) {
  const attemptCount = Number(delivery.attemptCount || 0) + 1;
  const providerCode = error instanceof BookingComApiError ? error.providerCode ?? "PROVIDER_ERROR" : "DELIVERY_FAILED";
  const deadLetter = attemptCount >= MAX_ATTEMPTS;
  const changed = await db.channelOutboundDelivery.updateMany({
    where: { id: delivery.id, status: "SENDING" },
    data: {
      status: deadLetter ? "DEAD_LETTER" : "PENDING",
      attemptCount,
      nextAttemptAt: deadLetter ? null : new Date(Date.now() + Math.min(60 * 60_000, 5_000 * (2 ** Math.min(attemptCount, 8)))),
      lastAttemptAt: new Date(),
      lastError: `${providerCode}: ${String(error instanceof Error ? error.message : error).slice(0, 900)}`,
    },
  });
  if (changed.count === 1 && deadLetter) {
    await db.channelReconciliationIssue.create({ data: { connectionId: delivery.connectionId, kind: "DELIVERY_REJECTED", severity: "CRITICAL", status: "OPEN", internalRef: String(delivery.id), details: { eventType: delivery.eventType, attempts: attemptCount, providerCode } } });
    const stopSellRequestId = Number(delivery.payload?.stopSellRequestId);
    if (Number.isInteger(stopSellRequestId) && stopSellRequestId > 0) {
      await db.channelStopSellRequest.updateMany({ where: { id: stopSellRequestId, status: "QUEUED" }, data: { status: "FAILED", failedAt: new Date(), failureMessage: `${providerCode}: provider delivery failed` } });
    }
  }
}

export async function runBookingComOutboundDelivery(now = new Date(), connectionId?: number): Promise<{ queued: number; attempted: number; acknowledged: number; failed: number }> {
  const queued = await queueRecentBookingComAvailabilityUpdates(now, connectionId);
  await db.channelOutboundDelivery.updateMany({
    where: {
      ...(connectionId ? { connectionId } : {}),
      status: "SENDING",
      lastAttemptAt: { lte: new Date(now.getTime() - 10 * 60_000) },
      connection: { provider: { code: "BOOKING_COM" } },
    },
    data: { status: "PENDING", nextAttemptAt: now, lastError: "Recovered after an interrupted delivery lease" },
  });
  const candidates = await db.channelOutboundDelivery.findMany({
    where: { ...(connectionId ? { connectionId } : {}), status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }], connection: { provider: { code: "BOOKING_COM" }, status: { in: ["ACTIVE", "PILOT"] } } },
    orderBy: { id: "asc" },
    take: 50,
  });
  const runByConnection = new Map<number, { id: number; itemCount: number; successCount: number; failureCount: number }>();
  for (const candidate of candidates) {
    if (!runByConnection.has(candidate.connectionId)) {
      const connectionEvents = candidates.filter((item: any) => item.connectionId === candidate.connectionId).map((item: any) => item.eventType);
      const kind = connectionEvents.some((eventType: string) => eventType.startsWith("ARI_STOP_SELL")) ? "STOP_SELL" : connectionEvents.includes("ARI_FULL") ? "FULL" : "DELTA";
      const run = await db.channelSyncRun.create({ data: { connectionId: candidate.connectionId, kind, status: "RUNNING" } });
      runByConnection.set(candidate.connectionId, { id: run.id, itemCount: 0, successCount: 0, failureCount: 0 });
    }
  }
  let attempted = 0;
  let acknowledged = 0;
  let failed = 0;
  for (const candidate of candidates) {
    const claimed = await db.channelOutboundDelivery.updateMany({
      where: { id: candidate.id, status: "PENDING", connection: { status: { in: ["ACTIVE", "PILOT"] } } },
      data: { status: "SENDING", lastAttemptAt: now },
    });
    if (claimed.count !== 1) continue;
    const syncRun = runByConnection.get(candidate.connectionId);
    if (syncRun) { syncRun.itemCount += 1; }
    attempted += 1;
    try {
      const payload = candidate.payload as { reservationId?: number; from?: string; to?: string; forceClosed?: boolean; stopSellRequestId?: number };
      const built = await availabilityXml(candidate.connectionId, payload?.reservationId
        ? { reservationId: Number(payload.reservationId) }
        : { from: asDate(payload?.from), to: asDate(payload?.to), forceClosed: payload?.forceClosed === true });
      if (!built.xml) throw new Error("No mapped room inventory was available for the ARI update");
      if (built.missingPrices > 0) {
        await recordAriIssue(candidate.connectionId, String(candidate.id), { reason: "room_base_rate_missing", skippedRateDates: built.missingPrices });
      }
      const credentials = await credentialsFor(candidate.connectionId);
      if (!credentials) throw new Error("Booking.com credentials are unavailable");
      const token = await bookingComClient.exchangeToken(credentials);
      const response = await bookingComClient.updateAvailability(token.jwt, built.xml);
      if (parseBookingResponseHasErrors(response.body)) throw new Error("Booking.com rejected the availability update");
      const accepted = await db.channelOutboundDelivery.updateMany({ where: { id: candidate.id, status: "SENDING" }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), lastError: null } });
      // An administrator may revoke credentials while a provider request is in flight.
      // Keep that terminal admin state authoritative instead of resurrecting the delivery.
      if (accepted.count !== 1) continue;
      await db.channelConnection.update({ where: { id: candidate.connectionId }, data: { lastOutboundAt: new Date(), lastSuccessAt: new Date(), lastFailureAt: null, lastErrorCode: null, lastErrorMessage: null } });
      const stopSellRequestId = Number(payload?.stopSellRequestId);
      if (Number.isInteger(stopSellRequestId) && stopSellRequestId > 0) {
        const request = await db.channelStopSellRequest.findUnique({ where: { id: stopSellRequestId }, include: { connection: { include: { provider: true, property: { select: { ownerId: true, title: true } } } } } });
        if (request?.status === "QUEUED") {
          await db.channelStopSellRequest.update({ where: { id: request.id }, data: { status: "CONFIRMED", providerConfirmedAt: new Date(), failureMessage: null, failedAt: null } });
          await notifyOwner(request.connection.property.ownerId, "nrms_stop_sell_confirmed", { action: request.action, provider: request.connection.provider.name, propertyTitle: request.connection.property.title, from: dateKey(request.fromDate), to: dateKey(request.toDate), reason: request.reason });
        }
      }
      if (syncRun) { syncRun.successCount += 1; }
      acknowledged += 1;
    } catch (error) {
      failed += 1;
      if (syncRun) { syncRun.failureCount += 1; }
      await failDelivery(candidate, error);
    }
  }
  for (const syncRun of runByConnection.values()) {
    await db.channelSyncRun.update({ where: { id: syncRun.id }, data: { status: syncRun.failureCount > 0 ? "FAILED" : "SUCCEEDED", completedAt: new Date(), itemCount: syncRun.itemCount, successCount: syncRun.successCount, failureCount: syncRun.failureCount } });
  }
  return { queued, attempted, acknowledged, failed };
}

export function startBookingComOutboundDeliveryWorker() {
  const intervalMs = Math.max(30_000, Number(process.env.BOOKING_COM_OUTBOUND_INTERVAL_MS || 60_000));
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runNrmsWorker("booking-com-outbound", () => runBookingComOutboundDelivery());
    } catch (error) {
      console.error("[booking-com-outbound] worker failed", error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[booking-com-outbound] Started, interval: ${intervalMs / 1000}s`);
}

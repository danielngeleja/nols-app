import crypto from "node:crypto";
import type { ChannelOutboundDelivery, Prisma } from "@prisma/client";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { notifyOwner } from "../notifications.js";
import { runNrmsWorker } from "../nrmsWorkerHealth.js";
import { buildExpediaAvailabilityXml, resolveExpediaRateForDate, type ExpediaAriDateOverride, type ExpediaRatePolicy, type ExpediaAriUpdate } from "./expediaAri.js";
import { ExpediaApiError, expediaClient } from "./expediaClient.js";
import { activeExpediaCredentials } from "./expediaReservationSync.js";

const db = prisma;
const MAX_ATTEMPTS = 8;
const RECENT_EVENT_WINDOW_MS = 48 * 60 * 60_000;

function dateKey(value: Date): string { return value.toISOString().slice(0, 10); }
function addDays(value: Date, days: number): Date { const next = new Date(value); next.setUTCDate(next.getUTCDate() + days); return next; }
function asDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") return null;
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

type Window = { reservationId?: number; from?: Date | null; to?: Date | null; forceClosed?: boolean };
type QueueClient = Pick<Prisma.TransactionClient, "channelConnection" | "channelOutboundDelivery">;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function inputJson(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function ratePolicy(metadata: unknown): ExpediaRatePolicy {
  const raw = record(record(metadata).ariPolicy);
  const pricingMode = ["BASE", "FIXED", "OFFSET", "MULTIPLIER"].includes(String(raw.pricingMode))
    ? String(raw.pricingMode) as ExpediaRatePolicy["pricingMode"]
    : "BASE";
  const dateOverrides = Array.isArray(raw.dateOverrides) ? raw.dateOverrides.map((entry): ExpediaAriDateOverride | null => {
    const item = record(entry);
    if (typeof item.from !== "string" || typeof item.to !== "string") return null;
    return {
      from: item.from,
      to: item.to,
      price: nullableNumber(item.price),
      closed: nullableBoolean(item.closed),
      minimumStay: nullableNumber(item.minimumStay),
      maximumStay: nullableNumber(item.maximumStay),
      closedOnArrival: nullableBoolean(item.closedOnArrival),
      closedOnDeparture: nullableBoolean(item.closedOnDeparture),
    };
  }).filter((entry): entry is ExpediaAriDateOverride => entry != null) : [];
  return {
    pricingMode,
    pricingValue: nullableNumber(raw.pricingValue),
    minimumStay: nullableNumber(raw.minimumStay),
    maximumStay: nullableNumber(raw.maximumStay),
    closedOnArrival: nullableBoolean(raw.closedOnArrival),
    closedOnDeparture: nullableBoolean(raw.closedOnDeparture),
    dateOverrides,
  };
}

async function recordIssue(connectionId: number, kind: string, internalRef: string, details: Record<string, unknown>, severity = "WARNING") {
  const existing = await db.channelReconciliationIssue.findFirst({ where: { connectionId, kind, internalRef, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
  if (existing) return db.channelReconciliationIssue.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), details: inputJson(details), severity } });
  return db.channelReconciliationIssue.create({ data: { connectionId, kind, severity, status: "OPEN", internalRef, details: inputJson(details) } });
}

async function buildUpdates(connectionId: number, window: Window): Promise<{ propertyId: string; updates: ExpediaAriUpdate[]; missingPrices: number }> {
  const connection = await db.channelConnection.findUnique({ where: { id: connectionId }, select: { propertyId: true, externalPropertyId: true, status: true } });
  if (!connection?.externalPropertyId || !["ACTIVE", "PILOT"].includes(connection.status)) return { propertyId: "", updates: [], missingPrices: 0 };
  let from = asDate(window.from);
  let to = asDate(window.to);
  let roomTypeIds: number[] = [];
  if (window.reservationId) {
    const reservation = await db.reservation.findUnique({ where: { id: window.reservationId }, select: { propertyId: true, allocations: { select: { roomTypeId: true, startDate: true, endDate: true } } } });
    if (!reservation || reservation.propertyId !== connection.propertyId) return { propertyId: String(connection.externalPropertyId), updates: [], missingPrices: 0 };
    roomTypeIds = [...new Set<number>(reservation.allocations.map((row) => Number(row.roomTypeId)))];
    if (reservation.allocations.length) {
      from = new Date(Math.min(...reservation.allocations.map((row) => new Date(row.startDate).getTime())));
      to = new Date(Math.max(...reservation.allocations.map((row) => new Date(row.endDate).getTime())));
    }
  }
  if (!from || !to || to <= from) return { propertyId: String(connection.externalPropertyId), updates: [], missingPrices: 0 };
  if (!roomTypeIds.length) {
    const rows = await db.channelRoomMapping.findMany({ where: { connectionId, status: "MAPPED" }, select: { roomTypeId: true } });
    roomTypeIds = [...new Set<number>(rows.map((row) => Number(row.roomTypeId)))];
  }
  const [roomMappings, rateMappings, roomTypes, allocations] = await Promise.all([
    db.channelRoomMapping.findMany({ where: { connectionId, roomTypeId: { in: roomTypeIds }, status: "MAPPED" }, select: { roomTypeId: true, externalId: true } }),
    db.channelRateMapping.findMany({ where: { connectionId, roomTypeId: { in: roomTypeIds }, status: "MAPPED" }, select: { roomTypeId: true, externalId: true, currency: true, metadata: true } }),
    db.roomType.findMany({ where: { propertyId: connection.propertyId, id: { in: roomTypeIds } }, select: { id: true, status: true, baseRate: true, currency: true, units: { select: { status: true } } } }),
    db.reservationRoomAllocation.findMany({ where: { roomTypeId: { in: roomTypeIds }, status: "ACTIVE", startDate: { lt: to }, endDate: { gt: from }, reservation: { status: { notIn: ["CANCELLED", "NO_SHOW", "EXPIRED"] } } }, select: { roomTypeId: true, startDate: true, endDate: true } }),
  ]);
  const roomMapping = new Map<number, string>(roomMappings.map((row) => [Number(row.roomTypeId), String(row.externalId)]));
  const roomById = new Map(roomTypes.map((row) => [Number(row.id), row]));
  const updates: ExpediaAriUpdate[] = [];
  let missingPrices = 0;
  for (const roomTypeId of roomTypeIds) {
    const externalRoomId = roomMapping.get(roomTypeId);
    const room = roomById.get(roomTypeId);
    if (!externalRoomId || !room) continue;
    const rates = rateMappings.filter((row) => Number(row.roomTypeId) === roomTypeId);
    const baseRate = room.baseRate == null ? null : Number(room.baseRate);
    for (let day = new Date(from); day < to; day = addDays(day, 1)) {
      const dayStart = new Date(`${dateKey(day)}T00:00:00.000Z`);
      const dayEnd = addDays(dayStart, 1);
      const occupied = allocations.filter((row) => Number(row.roomTypeId) === roomTypeId && new Date(row.startDate) < dayEnd && new Date(row.endDate) > dayStart).length;
      const activeUnits = room.status === "ACTIVE" ? room.units.filter((unit) => unit.status === "ACTIVE").length : 0;
      for (const rate of rates) {
        const resolved = resolveExpediaRateForDate(baseRate, ratePolicy(rate.metadata), dateKey(dayStart));
        if (resolved.price == null) { missingPrices += 1; continue; }
        const closed = window.forceClosed === true || resolved.closed;
        updates.push({ roomId: externalRoomId, rateId: String(rate.externalId), from: dateKey(dayStart), to: dateKey(dayStart), roomsToSell: closed ? 0 : Math.max(0, activeUnits - occupied), currency: String(rate.currency || room.currency || "TZS"), price: resolved.price, closed, policy: resolved.policy });
      }
    }
  }
  return { propertyId: String(connection.externalPropertyId), updates, missingPrices };
}

async function queueFull(client: QueueClient, connectionIds: number[], from: Date, months: number, resyncId: string): Promise<number> {
  let queued = 0;
  const start = new Date(`${dateKey(from)}T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + Math.max(1, months), start.getUTCDate()));
  for (const connectionId of connectionIds) {
    for (let cursor = start; cursor < end;) {
      const monthBoundary = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
      const to = monthBoundary < end ? monthBoundary : end;
      const idempotencyKey = `expedia-ari-full:${resyncId}:${dateKey(cursor)}:${dateKey(to)}`;
      await client.channelOutboundDelivery.upsert({ where: { connectionId_idempotencyKey: { connectionId, idempotencyKey } }, create: { connectionId, idempotencyKey, eventType: "ARI_FULL", payload: { from: dateKey(cursor), to: dateKey(to), resyncId }, status: "PENDING", nextAttemptAt: new Date() }, update: { status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), acknowledgedAt: null, lastError: null } });
      queued += 1;
      cursor = to;
    }
  }
  return queued;
}

export async function queueExpediaFullAriUpdates(connectionId?: number, from = new Date(), months = 12, resyncId = crypto.randomUUID()): Promise<number> {
  const connections = await db.channelConnection.findMany({ where: { ...(connectionId ? { id: connectionId } : {}), provider: { code: "EXPEDIA" }, status: { in: ["ACTIVE", "PILOT"] } }, select: { id: true } });
  return queueFull(db, connections.map((row) => Number(row.id)), from, months, resyncId);
}

export async function queueExpediaPropertyAriUpdates(client: QueueClient, propertyId: number, reason: string, from = new Date(), months = 12): Promise<number> {
  const rows = await client.channelConnection.findMany({ where: { propertyId, provider: { code: "EXPEDIA" }, status: { in: ["ACTIVE", "PILOT"] } }, select: { id: true } });
  return queueFull(client, rows.map((row) => Number(row.id)), from, months, `${reason.slice(0, 32)}-${crypto.randomUUID()}`);
}

export async function queueRecentExpediaAvailabilityUpdates(now = new Date(), connectionId?: number): Promise<number> {
  const connections = await db.channelConnection.findMany({ where: { ...(connectionId ? { id: connectionId } : {}), provider: { code: "EXPEDIA" }, status: { in: ["ACTIVE", "PILOT"] } }, select: { id: true, propertyId: true } });
  let queued = 0;
  for (const connection of connections) {
    const cursor = await db.channelSyncCursor.findUnique({ where: { connectionId_scope: { connectionId: connection.id, scope: "EXPEDIA_ARI_EVENTS" } }, select: { cursor: true } });
    const lastId = Number(cursor?.cursor || 0);
    const events = await db.reservationEvent.findMany({ where: { ...(lastId > 0 ? { id: { gt: lastId } } : { createdAt: { gte: new Date(now.getTime() - RECENT_EVENT_WINDOW_MS) } }), reservation: { propertyId: connection.propertyId } }, select: { id: true, reservationId: true }, orderBy: { id: "asc" }, take: 500 });
    if (!events.length) continue;
    await db.$transaction(async (tx) => {
      for (const event of events) {
        const idempotencyKey = `expedia-reservation-event:${event.id}:connection:${connection.id}`;
        await tx.channelOutboundDelivery.upsert({ where: { connectionId_idempotencyKey: { connectionId: connection.id, idempotencyKey } }, create: { connectionId: connection.id, idempotencyKey, eventType: "ARI_DELTA", payload: { reservationId: event.reservationId, eventId: event.id }, reservationId: event.reservationId, status: "PENDING", nextAttemptAt: now }, update: {} });
        queued += 1;
      }
      const latest = events.at(-1)!.id;
      await tx.channelSyncCursor.upsert({ where: { connectionId_scope: { connectionId: connection.id, scope: "EXPEDIA_ARI_EVENTS" } }, create: { connectionId: connection.id, scope: "EXPEDIA_ARI_EVENTS", cursor: String(latest), lastSyncedAt: now }, update: { cursor: String(latest), lastSyncedAt: now } });
    });
  }
  return queued;
}

export async function queueExpediaStopSell(client: Pick<Prisma.TransactionClient, "channelOutboundDelivery">, input: { requestId: number; connectionId: number; action: "APPLY" | "RELEASE"; fromDate: Date; toDate: Date }) {
  const toExclusive = addDays(new Date(`${dateKey(input.toDate)}T00:00:00.000Z`), 1);
  const idempotencyKey = `stop-sell-request:${input.requestId}`;
  return client.channelOutboundDelivery.upsert({ where: { connectionId_idempotencyKey: { connectionId: input.connectionId, idempotencyKey } }, create: { connectionId: input.connectionId, idempotencyKey, eventType: input.action === "APPLY" ? "ARI_STOP_SELL" : "ARI_STOP_SELL_RELEASE", payload: { from: dateKey(input.fromDate), to: dateKey(toExclusive), forceClosed: input.action === "APPLY", stopSellRequestId: input.requestId }, status: "PENDING", nextAttemptAt: new Date() }, update: {} });
}

async function fail(delivery: ChannelOutboundDelivery, error: unknown) {
  const attemptCount = Number(delivery.attemptCount || 0) + 1;
  const providerCode = error instanceof ExpediaApiError ? error.providerCode ?? "PROVIDER_ERROR" : "DELIVERY_FAILED";
  const dead = attemptCount >= MAX_ATTEMPTS || error instanceof ExpediaApiError && !error.retryable;
  const changed = await db.channelOutboundDelivery.updateMany({ where: { id: delivery.id, status: "SENDING" }, data: { status: dead ? "DEAD_LETTER" : "PENDING", attemptCount, nextAttemptAt: dead ? null : new Date(Date.now() + Math.min(60 * 60_000, 5_000 * 2 ** Math.min(attemptCount, 8))), lastAttemptAt: new Date(), lastError: `${providerCode}: ${String(error instanceof Error ? error.message : error).slice(0, 900)}` } });
  if (changed.count === 1) await db.channelConnection.updateMany({ where: { id: delivery.connectionId, status: { in: ["ACTIVE", "PILOT", "ERROR"] } }, data: { lastFailureAt: new Date(), lastErrorCode: providerCode, lastErrorMessage: "Expedia availability and rates delivery failed" } });
  if (changed.count === 1 && dead) {
    await recordIssue(delivery.connectionId, "DELIVERY_REJECTED", String(delivery.id), { eventType: delivery.eventType, attempts: attemptCount, providerCode }, "CRITICAL");
    const requestId = Number(record(delivery.payload).stopSellRequestId);
    if (requestId > 0) await db.channelStopSellRequest.updateMany({ where: { id: requestId, status: "QUEUED" }, data: { status: "FAILED", failedAt: new Date(), failureMessage: `${providerCode}: provider delivery failed` } });
  }
}

export async function runExpediaOutboundDelivery(now = new Date(), connectionId?: number): Promise<{ queued: number; attempted: number; acknowledged: number; failed: number }> {
  if (!expediaClient.isAriConfigured()) return { queued: 0, attempted: 0, acknowledged: 0, failed: 0 };
  const queued = await queueRecentExpediaAvailabilityUpdates(now, connectionId);
  await db.channelOutboundDelivery.updateMany({ where: { ...(connectionId ? { connectionId } : {}), status: "SENDING", lastAttemptAt: { lte: new Date(now.getTime() - 10 * 60_000) }, connection: { provider: { code: "EXPEDIA" } } }, data: { status: "PENDING", nextAttemptAt: now, lastError: "Recovered after an interrupted delivery lease" } });
  const candidates = await db.channelOutboundDelivery.findMany({ where: { ...(connectionId ? { connectionId } : {}), status: "PENDING", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }], connection: { provider: { code: "EXPEDIA" }, status: { in: ["ACTIVE", "PILOT"] } } }, orderBy: { createdAt: "asc" }, take: 50 });
  let attempted = 0; let acknowledged = 0; let failed = 0;
  const runByConnection = new Map<number, { id: number; itemCount: number; successCount: number; failureCount: number }>();
  for (const candidate of candidates) {
    const claimed = await db.channelOutboundDelivery.updateMany({ where: { id: candidate.id, status: "PENDING" }, data: { status: "SENDING", lastAttemptAt: new Date() } });
    if (claimed.count !== 1) continue;
    let syncRun = runByConnection.get(candidate.connectionId);
    if (!syncRun) {
      const created = await db.channelSyncRun.create({ data: { connectionId: candidate.connectionId, kind: "DELTA", status: "RUNNING" } });
      syncRun = { id: created.id, itemCount: 0, successCount: 0, failureCount: 0 };
      runByConnection.set(candidate.connectionId, syncRun);
    }
    syncRun.itemCount += 1;
    attempted += 1;
    try {
      const payload = candidate.payload as { reservationId?: number; from?: string; to?: string; forceClosed?: boolean; stopSellRequestId?: number };
      const built = await buildUpdates(candidate.connectionId, payload.reservationId ? { reservationId: Number(payload.reservationId) } : { from: asDate(payload.from), to: asDate(payload.to), forceClosed: payload.forceClosed === true });
      if (!built.updates.length) throw new Error("No mapped Expedia room-rate inventory was available for this update");
      if (built.missingPrices) await recordIssue(candidate.connectionId, "INVENTORY_MISMATCH", String(candidate.id), { reason: "mapped_rate_price_missing", skippedRateDates: built.missingPrices });
      const credentials = await activeExpediaCredentials(candidate.connectionId);
      if (!credentials) throw new Error("Expedia credentials are unavailable");
      const warnings: string[] = [];
      for (let offset = 0; offset < built.updates.length; offset += 5_000) {
        const xml = buildExpediaAvailabilityXml({ credentials, propertyId: built.propertyId, updates: built.updates.slice(offset, offset + 5_000) });
        const response = await expediaClient.updateAvailability(credentials, xml);
        warnings.push(...response.warnings);
      }
      if (warnings.length) await recordIssue(candidate.connectionId, "DELIVERY_REJECTED", String(candidate.id), { reason: "provider_warnings", warnings: warnings.slice(0, 50), warningCount: warnings.length });
      const accepted = await db.channelOutboundDelivery.updateMany({ where: { id: candidate.id, status: "SENDING" }, data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), lastError: warnings.length ? `Provider accepted with ${warnings.length} warning(s)` : null } });
      if (accepted.count !== 1) continue;
      await db.channelConnection.update({ where: { id: candidate.connectionId }, data: { lastOutboundAt: new Date(), lastSuccessAt: new Date(), lastFailureAt: null, lastErrorCode: null, lastErrorMessage: null } });
      const requestId = Number(payload.stopSellRequestId);
      if (requestId > 0) {
        const request = await db.channelStopSellRequest.findUnique({ where: { id: requestId }, include: { connection: { include: { provider: true, property: { select: { ownerId: true, title: true } } } } } });
        if (request?.status === "QUEUED") {
          await db.channelStopSellRequest.update({ where: { id: request.id }, data: { status: "CONFIRMED", providerConfirmedAt: new Date(), failureMessage: null, failedAt: null } });
          await notifyOwner(request.connection.property.ownerId, "nrms_stop_sell_confirmed", { action: request.action, provider: request.connection.provider.name, propertyTitle: request.connection.property.title, from: dateKey(request.fromDate), to: dateKey(request.toDate), reason: request.reason });
        }
      }
      acknowledged += 1;
      syncRun.successCount += 1;
    } catch (error) { failed += 1; syncRun.failureCount += 1; await fail(candidate, error); }
  }
  for (const run of runByConnection.values()) await db.channelSyncRun.update({ where: { id: run.id }, data: { status: run.failureCount ? "FAILED" : "SUCCEEDED", completedAt: new Date(), itemCount: run.itemCount, successCount: run.successCount, failureCount: run.failureCount } });
  return { queued, attempted, acknowledged, failed };
}

export function startExpediaOutboundDeliveryWorker() {
  if (!expediaClient.isAriConfigured()) {
    console.log("[expedia-outbound] Worker awaiting the Expedia-assigned ARI endpoint");
    return;
  }
  const intervalMs = Math.max(30_000, Number(process.env.EXPEDIA_OUTBOUND_INTERVAL_MS || 60_000));
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runNrmsWorker("expedia-outbound", () => runExpediaOutboundDelivery()); }
    catch (error) { console.error("[expedia-outbound] worker failed", error); }
    finally { running = false; }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[expedia-outbound] Started, interval: ${intervalMs / 1000}s`);
}

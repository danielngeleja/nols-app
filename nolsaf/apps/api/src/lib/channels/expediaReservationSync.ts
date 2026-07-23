import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { decrypt } from "../crypto.js";
import { lockPropertyInventory } from "../nrmsAvailability.js";
import { runNrmsWorker } from "../nrmsWorkerHealth.js";
import { ExpediaApiError, expediaClient, type ExpediaCredentials } from "./expediaClient.js";
import { expediaEventPayload, parseExpediaReservation, type ExpediaReservationMessage } from "./expediaReservations.js";

const db = prisma;
const INBOX_LEASE_MS = 10 * 60_000;
type ExpediaConnection = Prisma.ChannelConnectionGetPayload<{ include: { property: { select: { ownerId: true } } } }>;

function inputJson(value: Record<string, unknown>): Prisma.InputJsonObject {
  return value as Prisma.InputJsonObject;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isUniqueConstraintError(error: unknown): boolean {
  return record(error).code === "P2002";
}

export type ExpediaSyncResult = {
  connections: number;
  pages: number;
  received: number;
  processed: number;
  skipped: number;
  failed: number;
};

function date(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function credentialPayload(value: unknown): ExpediaCredentials | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { username?: unknown; password?: unknown };
  return typeof row.username === "string" && row.username && typeof row.password === "string" && row.password
    ? { username: row.username, password: row.password }
    : null;
}

export async function activeExpediaCredentials(connectionId: number): Promise<ExpediaCredentials | null> {
  const row = await db.channelCredentialVersion.findFirst({ where: { connectionId, status: "ACTIVE" }, orderBy: { version: "desc" }, select: { encryptedData: true } });
  if (!row) return null;
  try {
    return credentialPayload(JSON.parse(decrypt(row.encryptedData, { log: false })));
  } catch {
    return null;
  }
}

async function issue(connectionId: number, kind: string, externalRef: string | null, internalRef: string | null, details: Record<string, unknown>, severity = "CRITICAL") {
  const existing = await db.channelReconciliationIssue.findFirst({ where: { connectionId, kind, externalRef, internalRef, status: { in: ["OPEN", "ACKNOWLEDGED"] } } });
  if (existing) return db.channelReconciliationIssue.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), details: inputJson(details), severity } });
  return db.channelReconciliationIssue.create({ data: { connectionId, kind, severity, status: "OPEN", externalRef, internalRef, details: inputJson(details) } });
}

function eventIdentity(message: ExpediaReservationMessage): string {
  const version = message.updatedAt || crypto.createHash("sha256").update(JSON.stringify(expediaEventPayload(message))).digest("hex").slice(0, 24);
  return `reservation:${message.providerReservationId}:${message.action}:${version}`.slice(0, 200);
}

async function claimReservationEvent(connectionId: number, message: ExpediaReservationMessage) {
  const providerEventId = eventIdentity(message);
  const payload = expediaEventPayload(message);
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  try {
    const event = await db.channelInboundEvent.create({ data: { connectionId, providerEventId, idempotencyKey: `${connectionId}:${providerEventId}`, eventType: `RESERVATION_${message.action}`, payloadHash, payload: inputJson(payload), status: "PROCESSING", processingStartedAt: new Date(), attemptCount: 1 } });
    return { event, duplicate: false };
  } catch (error: unknown) {
    if (!isUniqueConstraintError(error)) throw error;
    const existing = await db.channelInboundEvent.findFirst({ where: { connectionId, providerEventId } });
    if (!existing || existing.status === "PROCESSED") return { event: existing, duplicate: true };
    const staleBefore = new Date(Date.now() - INBOX_LEASE_MS);
    const changed = await db.channelInboundEvent.updateMany({ where: { id: existing.id, OR: [{ status: { in: ["RECEIVED", "FAILED"] } }, { status: "PROCESSING", processingStartedAt: { lte: staleBefore } }] }, data: { status: "PROCESSING", processingStartedAt: new Date(), attemptCount: { increment: 1 }, errorMessage: null, payload: inputJson(payload), payloadHash } });
    return { event: changed.count === 1 ? await db.channelInboundEvent.findUnique({ where: { id: existing.id } }) : existing, duplicate: changed.count !== 1 };
  }
}

async function normalize(connection: ExpediaConnection, message: ExpediaReservationMessage): Promise<number | null> {
  const checkIn = date(message.checkIn);
  const checkOut = date(message.checkOut);
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    await issue(connection.id, "RESERVATION_MISMATCH", message.providerReservationId, null, { reason: "invalid_dates" });
    throw new Error("Expedia reservation has invalid dates");
  }
  if (String(message.propertyId) !== String(connection.externalPropertyId)) {
    await issue(connection.id, "RESERVATION_MISMATCH", message.providerReservationId, null, { reason: "property_id_mismatch" });
    throw new Error("Expedia reservation belongs to another property");
  }
  const mappings = await db.channelRoomMapping.findMany({ where: { connectionId: connection.id, externalId: { in: message.roomTypeExternalIds }, status: "MAPPED" }, select: { roomTypeId: true, externalId: true } });
  const mappingByExternalId = new Map<string, number>(mappings.map((mapping) => [String(mapping.externalId), Number(mapping.roomTypeId)]));
  const unmapped = message.roomTypeExternalIds.filter((id) => !mappingByExternalId.has(id));
  if (message.action !== "CANCEL" && (!message.roomStays.length || unmapped.length)) {
    await issue(connection.id, "UNMAPPED", message.providerReservationId, null, { reason: "room_type_mapping_missing", externalRoomIds: unmapped.length ? unmapped : message.roomTypeExternalIds });
    throw new Error("One or more Expedia reservation rooms are not mapped");
  }

  return db.$transaction(async (tx) => {
    await lockPropertyInventory(tx, connection.propertyId);
    const existing = await tx.reservation.findFirst({ where: { propertyId: connection.propertyId, source: "EXPEDIA", externalRef: message.providerReservationId }, orderBy: { id: "desc" } });
    if (message.action === "CANCEL") {
      if (!existing) return null;
      await tx.reservation.update({ where: { id: existing.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Cancelled on Expedia Group" } });
      await tx.reservationRoomAllocation.updateMany({ where: { reservationId: existing.id, status: "ACTIVE" }, data: { status: "RELEASED" } });
      await tx.reservationEvent.create({ data: { reservationId: existing.id, type: "CANCELLED", data: { source: "EXPEDIA", externalRef: message.providerReservationId } } });
      return existing.id;
    }

    const guestIdentifiers = [
      ...(message.guestEmail ? [{ email: message.guestEmail }] : []),
      ...(message.guestPhone ? [{ phone: message.guestPhone }] : []),
    ];
    let guest = guestIdentifiers.length ? await tx.guestProfile.findFirst({ where: { propertyId: connection.propertyId, OR: guestIdentifiers }, orderBy: { id: "asc" } }) : null;
    if (!guest) guest = await tx.guestProfile.create({ data: { propertyId: connection.propertyId, ownerId: connection.property.ownerId, fullName: message.guestName, phone: message.guestPhone, email: message.guestEmail } });
    const values = {
      propertyId: connection.propertyId,
      ownerId: connection.property.ownerId,
      guestProfileId: guest.id,
      source: "EXPEDIA",
      attribution: "EXTERNAL_RECORDED",
      externalRef: message.providerReservationId,
      status: "CONFIRMED",
      checkIn,
      checkOut,
      adults: message.adults,
      children: message.children,
      currency: message.currency,
      totalAmount: message.totalAmount,
      confirmedAt: existing?.confirmedAt ?? new Date(),
    };
    const reservation = existing ? await tx.reservation.update({ where: { id: existing.id }, data: values }) : await tx.reservation.create({ data: values });
    if (existing) await tx.reservationRoomAllocation.updateMany({ where: { reservationId: existing.id, status: "ACTIVE" }, data: { status: "RELEASED" } });
    for (const stay of message.roomStays) {
      const roomTypeId = mappingByExternalId.get(stay.roomTypeExternalId);
      if (!roomTypeId) continue;
      for (let index = 0; index < Math.max(1, stay.quantity); index += 1) {
        await tx.reservationRoomAllocation.create({ data: { reservationId: reservation.id, roomTypeId, startDate: checkIn, endDate: checkOut, status: "ACTIVE" } });
      }
    }
    await tx.reservationEvent.create({ data: { reservationId: reservation.id, type: existing ? "EDITED" : "CREATED", data: { source: "EXPEDIA", externalRef: message.providerReservationId, action: message.action } } });
    return reservation.id;
  });
}

async function processMessage(connection: ExpediaConnection, message: ExpediaReservationMessage, event: { id: number }, result: ExpediaSyncResult, confirmation?: { actionType: string; token: string } | null) {
  try {
    const reservationId = await normalize(connection, message);
    if (confirmation?.token) {
      const credentials = await activeExpediaCredentials(connection.id);
      if (!credentials) throw new Error("Expedia credentials are unavailable");
      const token = await expediaClient.exchangeToken(credentials);
      await expediaClient.confirmReservationNotification(token.accessToken, { propertyId: message.propertyId, reservationId: message.providerReservationId, actionType: confirmation.actionType, confirmationToken: confirmation.token });
    }
    await db.channelInboundEvent.updateMany({ where: { id: event.id, status: "PROCESSING" }, data: { status: "PROCESSED", processedAt: new Date(), processingStartedAt: null, reservationId, payload: inputJson(expediaEventPayload(message)), errorMessage: null } });
    result.processed += 1;
  } catch (error) {
    await db.channelInboundEvent.updateMany({ where: { id: event.id, status: "PROCESSING" }, data: { status: "FAILED", processingStartedAt: null, errorMessage: String(error instanceof Error ? error.message : error).slice(0, 1000) } });
    result.failed += 1;
  }
}

async function processQueuedNotifications(connection: ExpediaConnection, token: string, result: ExpediaSyncResult) {
  const staleBefore = new Date(Date.now() - INBOX_LEASE_MS);
  await db.channelInboundEvent.updateMany({ where: { connectionId: connection.id, status: "PROCESSING", processingStartedAt: { lte: staleBefore } }, data: { status: "RECEIVED", processingStartedAt: null, errorMessage: "Recovered after an interrupted Expedia inbox lease" } });
  const queued = await db.channelInboundEvent.findMany({ where: { connectionId: connection.id, status: { in: ["RECEIVED", "FAILED"] } }, orderBy: { receivedAt: "asc" }, take: 200 });
  const candidates = queued.filter((row) => typeof record(row.payload).reservationId === "string").slice(0, 50);
  for (const candidate of candidates) {
    const claimed = await db.channelInboundEvent.updateMany({ where: { id: candidate.id, status: { in: ["RECEIVED", "FAILED"] } }, data: { status: "PROCESSING", processingStartedAt: new Date(), attemptCount: { increment: 1 }, errorMessage: null } });
    if (claimed.count !== 1) continue;
    const payload = record(candidate.payload);
    try {
      const response = await expediaClient.getReservation(token, String(payload.propertyId || connection.externalPropertyId), String(payload.reservationId || ""));
      const node = response.data.property?.reservations.edges[0]?.node;
      if (!node) throw new Error("Expedia reservation notification referenced an unavailable reservation");
      const message = parseExpediaReservation(node);
      result.received += 1;
      await processMessage(connection, message, candidate, result, typeof payload.confirmationToken === "string" ? { actionType: String(payload.actionType || message.action), token: payload.confirmationToken } : null);
    } catch (error) {
      await db.channelInboundEvent.updateMany({ where: { id: candidate.id, status: "PROCESSING" }, data: { status: "FAILED", processingStartedAt: null, errorMessage: String(error instanceof Error ? error.message : error).slice(0, 1000) } });
      result.failed += 1;
    }
  }
}

async function reconcileConnection(connection: ExpediaConnection, result: ExpediaSyncResult) {
  const run = await db.channelSyncRun.create({ data: { connectionId: connection.id, kind: "RECONCILIATION", status: "RUNNING" } });
  const before = { received: result.received, processed: result.processed, skipped: result.skipped, failed: result.failed };
  try {
    const credentials = await activeExpediaCredentials(connection.id);
    if (!credentials) throw new Error("Expedia credentials are unavailable");
    const token = await expediaClient.exchangeToken(credentials);
    await processQueuedNotifications(connection, token.accessToken, result);
    const cursorRow = await db.channelSyncCursor.findUnique({ where: { connectionId_scope: { connectionId: connection.id, scope: "EXPEDIA_RESERVATIONS" } }, select: { cursor: true } });
    const now = new Date();
    const parsedCursor = cursorRow?.cursor ? new Date(cursorRow.cursor) : new Date(now.getTime() - 48 * 60 * 60_000);
    const from = Number.isNaN(parsedCursor.getTime()) ? new Date(now.getTime() - 48 * 60 * 60_000) : new Date(parsedCursor.getTime() - 5 * 60_000);
    let after: string | null = null;
    do {
      const page = await expediaClient.getReservationsUpdatedBetween(token.accessToken, String(connection.externalPropertyId), from.toISOString(), now.toISOString(), after);
      result.pages += 1;
      const reservations = page.data.property?.reservations;
      if (!reservations) throw new Error("Expedia property reservation data was unavailable");
      for (const edge of reservations.edges) {
        const message = parseExpediaReservation(edge.node);
        if (!message.providerReservationId) continue;
        result.received += 1;
        const claimed = await claimReservationEvent(connection.id, message);
        if (claimed.duplicate || !claimed.event) { result.skipped += 1; continue; }
        await processMessage(connection, message, claimed.event, result, null);
      }
      after = reservations.pageInfo.hasNextPage ? reservations.pageInfo.endCursor : null;
    } while (after);
    await db.channelSyncCursor.upsert({ where: { connectionId_scope: { connectionId: connection.id, scope: "EXPEDIA_RESERVATIONS" } }, create: { connectionId: connection.id, scope: "EXPEDIA_RESERVATIONS", cursor: now.toISOString(), lastSyncedAt: now }, update: { cursor: now.toISOString(), lastSyncedAt: now } });
    const failed = result.failed - before.failed;
    await db.channelConnection.update({ where: { id: connection.id }, data: failed ? { status: "ERROR", lastFailureAt: new Date(), lastErrorCode: "EXPEDIA_RESERVATION_PROCESSING_FAILED", lastErrorMessage: "One or more Expedia reservations could not be processed" } : { status: "ACTIVE", lastInboundAt: new Date(), lastSuccessAt: new Date(), lastFailureAt: null, lastErrorCode: null, lastErrorMessage: null } });
    await db.channelSyncRun.update({ where: { id: run.id }, data: { status: failed ? "FAILED" : "SUCCEEDED", completedAt: new Date(), itemCount: result.received - before.received, successCount: result.processed - before.processed + result.skipped - before.skipped, failureCount: failed, details: { pages: result.pages } } });
  } catch (error) {
    const providerCode = error instanceof ExpediaApiError ? error.providerCode ?? "PROVIDER_ERROR" : "SYNC_FAILED";
    result.failed += 1;
    await db.channelConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastFailureAt: new Date(), lastErrorCode: providerCode, lastErrorMessage: "Expedia reservation synchronization failed" } });
    await db.channelSyncRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), itemCount: result.received - before.received, successCount: result.processed - before.processed + result.skipped - before.skipped, failureCount: result.failed - before.failed, errorMessage: "Expedia reservation synchronization failed" } });
  }
}

export async function runExpediaReservationSync(connectionId?: number): Promise<ExpediaSyncResult> {
  const result: ExpediaSyncResult = { connections: 0, pages: 0, received: 0, processed: 0, skipped: 0, failed: 0 };
  const connections = await db.channelConnection.findMany({ where: { ...(connectionId ? { id: connectionId } : {}), provider: { code: "EXPEDIA" }, status: { in: ["ACTIVE", "PILOT", "ERROR"] }, externalPropertyId: { not: null } }, include: { property: { select: { ownerId: true } } } });
  result.connections = connections.length;
  for (const connection of connections) await reconcileConnection(connection, result);
  return result;
}

export function startExpediaReservationSyncWorker() {
  const intervalMs = Math.max(60_000, Number(process.env.EXPEDIA_RESERVATION_RECONCILIATION_INTERVAL_MS || 5 * 60_000));
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runNrmsWorker("expedia-reservations", () => runExpediaReservationSync()); }
    catch (error) { console.error("[expedia-reservations] worker failed", error); }
    finally { running = false; }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[expedia-reservations] Started, interval: ${intervalMs / 1000}s`);
}

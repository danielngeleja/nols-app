import crypto from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { decrypt } from "../crypto.js";
import { runNrmsWorker } from "../nrmsWorkerHealth.js";
import { lockPropertyInventory } from "../nrmsAvailability.js";
import { resolveAllocationMealPlan } from "../nrmsMealPlan.js";
import { BookingComApiError, bookingComClient } from "./bookingComClient.js";
import { bookingComEventPayload, parseBookingReservationMessages, parseBookingResponseHasErrors, type BookingReservationMessage } from "./bookingComReservations.js";

const db = prisma as any;

export type BookingComSyncResult = {
  connections: number;
  responses: number;
  received: number;
  processed: number;
  skipped: number;
  failed: number;
};

function hashMessage(message: BookingReservationMessage): string {
  return crypto.createHash("sha256").update(JSON.stringify(message.raw)).digest("hex").slice(0, 40);
}

function asDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function recordIssue(connectionId: number, kind: string, externalRef: string | null, internalRef: string | null, details: Record<string, unknown>) {
  const existing = await db.channelReconciliationIssue.findFirst({
    where: { connectionId, kind, externalRef, internalRef, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  });
  if (existing) {
    return db.channelReconciliationIssue.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), details } });
  }
  return db.channelReconciliationIssue.create({ data: { connectionId, kind, severity: "CRITICAL", status: "OPEN", externalRef, internalRef, details } });
}

async function activeCredentials(connectionId: number) {
  const credential = await db.channelCredentialVersion.findFirst({
    where: { connectionId, status: "ACTIVE" },
    orderBy: { version: "desc" },
    select: { encryptedData: true },
  });
  if (!credential) return null;
  try {
    const parsed = JSON.parse(decrypt(credential.encryptedData, { log: false })) as { clientId?: unknown; clientSecret?: unknown };
    if (typeof parsed.clientId !== "string" || typeof parsed.clientSecret !== "string") return null;
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  } catch {
    return null;
  }
}

async function claimInboundEvent(connectionId: number, message: BookingReservationMessage) {
  const hash = hashMessage(message);
  const providerEventId = `${message.action}:${message.providerReservationId}:${hash}`;
  const idempotencyKey = `${connectionId}:${providerEventId}`;
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 10 * 60_000);
  const payload = bookingComEventPayload(message);
  try {
    const event = await db.channelInboundEvent.create({
      data: {
        connectionId,
        providerEventId,
        idempotencyKey,
        eventType: `RESERVATION_${message.action}`,
        payloadHash: hash,
        payload,
        status: "PROCESSING",
        processingStartedAt: now,
        attemptCount: 1,
      },
    });
    return { event, duplicate: false, providerEventId };
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    const existing = await db.channelInboundEvent.findFirst({ where: { connectionId, providerEventId } });
    if (!existing) throw error;
    if (existing.status === "PROCESSED") return { event: existing, duplicate: true, providerEventId };
    const claimed = await db.channelInboundEvent.updateMany({
      where: {
        id: existing.id,
        OR: [
          { status: { in: ["RECEIVED", "FAILED"] } },
          { status: "PROCESSING", OR: [{ processingStartedAt: null }, { processingStartedAt: { lte: staleBefore } }] },
        ],
      },
      data: {
        status: "PROCESSING",
        processingStartedAt: now,
        attemptCount: { increment: 1 },
        errorMessage: null,
        payload,
      },
    });
    if (claimed.count !== 1) return { event: existing, duplicate: true, providerEventId };
    const event = await db.channelInboundEvent.findUnique({ where: { id: existing.id } });
    if (!event) throw new Error("Claimed Booking.com inbox event disappeared");
    return { event, duplicate: false, providerEventId };
  }
}

async function normalizeReservation(connection: any, message: BookingReservationMessage): Promise<number | null> {
  const propertyId = connection.propertyId as number;
  const ownerId = connection.property.ownerId as number;
  const checkIn = asDate(message.checkIn);
  const checkOut = asDate(message.checkOut);
  if (!checkIn || !checkOut || checkOut <= checkIn) {
    await recordIssue(connection.id, "RESERVATION_MISMATCH", message.providerReservationId, null, { reason: "invalid_dates" });
    throw new Error("Booking.com reservation has invalid dates");
  }
  if (message.hotelId != null && String(message.hotelId) !== String(connection.externalPropertyId)) {
    await recordIssue(connection.id, "RESERVATION_MISMATCH", message.providerReservationId, null, { reason: "hotel_id_mismatch" });
    throw new Error("Booking.com reservation belongs to another property");
  }
  const roomStays = message.roomStays.map((stay) => ({ ...stay, startDate: asDate(stay.checkIn), endDate: asDate(stay.checkOut) }));
  if (message.action !== "CANCEL" && (!roomStays.length || roomStays.some((stay) => !stay.startDate || !stay.endDate || stay.endDate <= stay.startDate))) {
    await recordIssue(connection.id, "RESERVATION_MISMATCH", message.providerReservationId, null, { reason: "invalid_room_stays" });
    throw new Error("Booking.com reservation has invalid room-stay details");
  }
  const mappings = await db.channelRoomMapping.findMany({
    where: { connectionId: connection.id, externalId: { in: message.roomTypeExternalIds }, status: "MAPPED" },
    select: { roomTypeId: true, externalId: true },
  });
  if (!mappings.length && message.action !== "CANCEL") {
    await recordIssue(connection.id, "UNMAPPED", message.providerReservationId, null, { reason: "room_type_mapping_missing", externalRoomIds: message.roomTypeExternalIds });
    throw new Error("Booking.com reservation room is not mapped");
  }
  const mappingByExternalId = new Map<string, number>(mappings.map((mapping: any) => [String(mapping.externalId), Number(mapping.roomTypeId)]));
  const unmappedRoomIds = message.roomTypeExternalIds.filter((externalId) => !mappingByExternalId.has(externalId));
  if (unmappedRoomIds.length && message.action !== "CANCEL") {
    await recordIssue(connection.id, "UNMAPPED", message.providerReservationId, null, { reason: "room_type_mapping_incomplete", externalRoomIds: unmappedRoomIds });
    throw new Error("One or more Booking.com reservation rooms are not mapped");
  }

  return db.$transaction(async (tx: any) => {
    await lockPropertyInventory(tx, propertyId);
    const guestIdentifiers = [
      ...(message.guestEmail ? [{ email: message.guestEmail }] : []),
      ...(message.guestPhone ? [{ phone: message.guestPhone }] : []),
    ];
    let guest = guestIdentifiers.length
      ? await tx.guestProfile.findFirst({ where: { propertyId, OR: guestIdentifiers }, orderBy: { id: "asc" } })
      : null;
    if (!guest && message.action !== "CANCEL") {
      guest = await tx.guestProfile.create({ data: { propertyId, ownerId, fullName: message.guestName, phone: message.guestPhone, email: message.guestEmail } });
    }

    const existing = await tx.reservation.findFirst({
      where: { propertyId, source: "BOOKING_COM", externalRef: message.providerReservationId },
      orderBy: { id: "desc" },
    });
    if (message.action === "CANCEL") {
      if (!existing) return null;
      const updated = await tx.reservation.update({
        where: { id: existing.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Cancelled on Booking.com", guestProfileId: guest?.id ?? existing.guestProfileId },
      });
      await tx.reservationRoomAllocation.updateMany({ where: { reservationId: existing.id, status: "ACTIVE" }, data: { status: "RELEASED" } });
      await tx.reservationEvent.create({ data: { reservationId: existing.id, type: "CANCELLED", data: { source: "BOOKING_COM", externalRef: message.providerReservationId } } });
      return updated.id;
    }

    const status = "CONFIRMED";
    const data = {
      propertyId,
      ownerId,
      guestProfileId: guest?.id ?? null,
      source: "BOOKING_COM",
      attribution: "EXTERNAL_RECORDED",
      externalRef: message.providerReservationId,
      status,
      checkIn,
      checkOut,
      adults: Math.max(1, message.adults),
      children: Math.max(0, message.children),
      currency: message.currency,
      totalAmount: message.totalAmount,
      confirmedAt: existing?.confirmedAt ?? new Date(),
    };
    const reservation = existing
      ? await tx.reservation.update({ where: { id: existing.id }, data })
      : await tx.reservation.create({ data });
    if (existing) {
      await tx.reservationRoomAllocation.updateMany({ where: { reservationId: existing.id, status: "ACTIVE" }, data: { status: "RELEASED" } });
    }
    for (const stay of roomStays) {
      const roomTypeId = mappingByExternalId.get(stay.roomTypeExternalId);
      if (!roomTypeId || !stay.startDate || !stay.endDate) continue;
      // Booking.com carries no rate plan NoLSAF can map, so entitlement falls
      // back to the property default, which is what a PMS does with an
      // unmapped rate code. Left NULL when there is no default, and the
      // breakfast list prints that as "verify" for the desk to settle.
      const plan = await resolveAllocationMealPlan(tx, { propertyId: reservation.propertyId, roomTypeId });
      for (let unit = 0; unit < stay.quantity; unit += 1) {
        await tx.reservationRoomAllocation.create({ data: { reservationId: reservation.id, roomTypeId, startDate: stay.startDate, endDate: stay.endDate, status: "ACTIVE", ratePlanId: plan.ratePlanId, mealPlan: plan.mealPlan } });
      }
    }
    await tx.reservationEvent.create({ data: { reservationId: reservation.id, type: existing ? "EDITED" : "CREATED", data: { source: "BOOKING_COM", externalRef: message.providerReservationId, action: message.action } } });
    return reservation.id;
  });
}

async function processResponse(connection: any, token: string, xml: string, modified: boolean, result: BookingComSyncResult): Promise<void> {
  if (parseBookingResponseHasErrors(xml)) {
    await recordIssue(connection.id, "DELIVERY_REJECTED", null, null, { direction: "INBOUND", endpoint: modified ? "OTA_HotelResModifyNotif" : "OTA_HotelResNotif" });
    result.failed += 1;
    return;
  }
  const messages = parseBookingReservationMessages(xml);
  result.received += messages.length;
  for (const message of messages) {
    const claimed = await claimInboundEvent(connection.id, message);
    if (claimed.duplicate) {
      result.skipped += 1;
      continue;
    }
    try {
      const reservationId = await normalizeReservation(connection, message);
      const acknowledgement = await bookingComClient.acknowledgeReservations(token, [message.providerReservationId], modified);
      if (parseBookingResponseHasErrors(acknowledgement.body)) throw new Error("Booking.com rejected the reservation acknowledgement");
      await db.channelInboundEvent.update({ where: { id: claimed.event.id }, data: { status: "PROCESSED", processedAt: new Date(), processingStartedAt: null, reservationId } });
      result.processed += 1;
    } catch (error) {
      await db.channelInboundEvent.update({ where: { id: claimed.event.id }, data: { status: "FAILED", processingStartedAt: null, errorMessage: String(error instanceof Error ? error.message : error).slice(0, 1000) } });
      result.failed += 1;
    }
  }
}

async function syncConnection(connection: any, result: BookingComSyncResult): Promise<void> {
  const syncRun = await db.channelSyncRun.create({ data: { connectionId: connection.id, kind: "DELTA", status: "RUNNING" } });
  const receivedBefore = result.received;
  const processedBefore = result.processed;
  const skippedBefore = result.skipped;
  const failedBefore = result.failed;
  const credentials = await activeCredentials(connection.id);
  const hotelId = Number(connection.externalPropertyId);
  if (!credentials || !Number.isInteger(hotelId) || hotelId <= 0) {
    await recordIssue(connection.id, "STALE", null, null, { reason: "credentials_or_hotel_id_missing" });
    result.failed += 1;
    await db.channelSyncRun.update({ where: { id: syncRun.id }, data: { status: "FAILED", completedAt: new Date(), itemCount: 0, successCount: 0, failureCount: 1, errorMessage: "Credentials or hotel ID is missing" } });
    return;
  }
  try {
    const token = await bookingComClient.exchangeToken(credentials);
    const [newReservations, modifiedReservations] = await Promise.all([
      bookingComClient.getNewReservations(token.jwt, hotelId),
      bookingComClient.getModifiedOrCancelledReservations(token.jwt, hotelId),
    ]);
    result.responses += 2;
    await processResponse(connection, token.jwt, newReservations.body, false, result);
    await processResponse(connection, token.jwt, modifiedReservations.body, true, result);
    const failed = result.failed > failedBefore;
    await db.channelConnection.update({
      where: { id: connection.id },
      data: failed
        ? { status: "ERROR", lastInboundAt: new Date(), lastFailureAt: new Date(), lastErrorCode: "RESERVATION_PROCESSING_FAILED", lastErrorMessage: "One or more Booking.com reservations could not be processed" }
        : { status: "ACTIVE", lastInboundAt: new Date(), lastSuccessAt: new Date(), lastFailureAt: null, lastErrorCode: null, lastErrorMessage: null },
    });
    await db.channelSyncRun.update({ where: { id: syncRun.id }, data: { status: result.failed > failedBefore ? "FAILED" : "SUCCEEDED", completedAt: new Date(), itemCount: result.received - receivedBefore, successCount: (result.processed - processedBefore) + (result.skipped - skippedBefore), failureCount: result.failed - failedBefore, details: { responses: 2, skipped: result.skipped - skippedBefore } } });
  } catch (error) {
    const code = error instanceof BookingComApiError ? error.providerCode ?? "PROVIDER_ERROR" : "SYNC_FAILED";
    await db.channelConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastFailureAt: new Date(), lastErrorCode: code, lastErrorMessage: "Booking.com reservation sync failed" } });
    result.failed += 1;
    await db.channelSyncRun.update({ where: { id: syncRun.id }, data: { status: "FAILED", completedAt: new Date(), itemCount: result.received - receivedBefore, successCount: (result.processed - processedBefore) + (result.skipped - skippedBefore), failureCount: result.failed - failedBefore, errorMessage: "Booking.com reservation sync failed" } });
  }
}

export async function runBookingComReservationSync(connectionId?: number): Promise<BookingComSyncResult> {
  const result: BookingComSyncResult = { connections: 0, responses: 0, received: 0, processed: 0, skipped: 0, failed: 0 };
  const connections = await db.channelConnection.findMany({
    where: {
      ...(connectionId ? { id: connectionId } : {}),
      provider: { code: "BOOKING_COM" },
      status: { in: ["ACTIVE", "PILOT", "ERROR"] },
      externalPropertyId: { not: null },
    },
    include: { property: { select: { ownerId: true } } },
  });
  result.connections = connections.length;
  for (const connection of connections) await syncConnection(connection, result);
  return result;
}

export function startBookingComReservationSyncWorker() {
  const intervalMs = Math.max(20_000, Number(process.env.BOOKING_COM_RESERVATION_INTERVAL_MS || 60_000));
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runNrmsWorker("booking-com-reservations", () => runBookingComReservationSync());
    } catch (error) {
      console.error("[booking-com-reservations] worker failed", error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[booking-com-reservations] Started, interval: ${intervalMs / 1000}s`);
}

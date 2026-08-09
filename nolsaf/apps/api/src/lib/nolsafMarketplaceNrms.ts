// Connects confirmed NoLSAF marketplace bookings to NRMS operations without
// duplicating commercial state. Booking remains authoritative for inventory,
// payment and commission; Reservation carries only the operational room view.
import { computeDraftBookingAvailability, type DraftBookingAvailability } from "./draftBookingAvailability.js";
import { lockPropertyInventory } from "./nrmsAvailability.js";
import { queueNrmsCheckInWelcome } from "./nrmsCheckInWelcome.js";
import { resolveAllocationMealPlan } from "./nrmsMealPlan.js";

type DbLike = any;

const CONNECTED_BOOKING_STATUSES = new Set(["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN", "CHECKED_OUT", "CANCELED"]);

export class NoLsafInventoryConflictError extends Error {
  readonly code = "NOLSAF_INVENTORY_CONFLICT";
  constructor(readonly availability: DraftBookingAvailability) {
    super(availability.message || "The selected room is no longer available");
    this.name = "NoLsafInventoryConflictError";
  }
}

function reservationStatus(status: string): string | null {
  switch (String(status || "").toUpperCase()) {
    case "CONFIRMED":
    case "PENDING_CHECKIN":
      return "CONFIRMED";
    case "CHECKED_IN":
      return "CHECKED_IN";
    case "CHECKED_OUT":
      return "CHECKED_OUT";
    case "CANCELED":
    case "CANCELLED":
      return "CANCELLED";
    default:
      return null;
  }
}

function roomTypeKey(roomCode: string | null | undefined): string | null {
  const value = String(roomCode ?? "").trim();
  if (!value) return null;
  return value.replace(/-\d+$/, "") || value;
}

function profileText(value: unknown, maxLength: number): string | null {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : null;
}

async function resolveGuestProfile(db: DbLike, booking: any) {
  const fullName = profileText(
    booking.guestName ?? booking.user?.fullName ?? booking.user?.name,
    160,
  ) ?? "NoLSAF guest";
  const phone = profileText(booking.guestPhone ?? booking.user?.phone, 40);
  const email = profileText(booking.user?.email, 160)?.toLowerCase() ?? null;
  const nationality = profileText(booking.nationality ?? booking.user?.nationality, 80);

  let existing = booking.nrmsReservation?.guestProfileId
    ? await db.guestProfile.findFirst({
        where: {
          id: booking.nrmsReservation.guestProfileId,
          propertyId: booking.propertyId,
          ownerId: booking.property.ownerId,
        },
        select: { id: true },
      })
    : null;

  if (!existing && (phone || email)) {
    existing = await db.guestProfile.findFirst({
      where: {
        propertyId: booking.propertyId,
        ownerId: booking.property.ownerId,
        OR: [
          ...(phone ? [{ phone }] : []),
          ...(email ? [{ email }] : []),
        ],
      },
      select: { id: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  const identity = {
    fullName,
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(nationality ? { nationality } : {}),
  };
  if (existing) {
    return db.guestProfile.update({ where: { id: existing.id }, data: identity });
  }
  return db.guestProfile.create({
    data: {
      propertyId: booking.propertyId,
      ownerId: booking.property.ownerId,
      ...identity,
      notes: `Created from NoLSAF marketplace booking #${booking.id}`,
    },
  });
}

async function resolveRoom(db: DbLike, propertyId: number, roomCode: string | null) {
  if (!roomCode) return { roomTypeId: null as number | null, roomUnitId: null as number | null };

  const unit = await db.roomUnit.findFirst({
    where: { propertyId, code: roomCode },
    select: { id: true, roomTypeId: true },
  });
  if (unit) return { roomTypeId: unit.roomTypeId, roomUnitId: unit.id };

  const key = roomTypeKey(roomCode);
  const type = key
    ? await db.roomType.findFirst({
        where: { propertyId, OR: [{ name: key }, { sourceSpecKey: key }] },
        select: { id: true },
      })
    : null;
  return { roomTypeId: type?.id ?? null, roomUnitId: null as number | null };
}

/**
 * Idempotently projects an active marketplace booking into NRMS. NEW/unpaid
 * bookings deliberately produce no Reservation and consume no NRMS calendar
 * space. Non-NRMS properties are also left untouched.
 */
export async function syncNoLsafBookingToNrms(db: DbLike, bookingId: number) {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      property: { select: { ownerId: true, nrmsActivatedAt: true } },
      user: { select: { name: true, fullName: true, email: true, phone: true, nationality: true } },
      nrmsReservation: {
        select: {
          id: true,
          guestProfileId: true,
          status: true,
          checkIn: true,
          checkOut: true,
          allocations: {
            where: { status: "ACTIVE" },
            select: { id: true, roomTypeId: true, roomUnitId: true, startDate: true, endDate: true },
          },
        },
      },
    },
  });
  if (!booking) return null;

  const status = String(booking.status || "").toUpperCase();
  if (status === "NEW" || !booking.property?.nrmsActivatedAt) return null;
  if (!CONNECTED_BOOKING_STATUSES.has(status)) return null;

  const mappedStatus = reservationStatus(status);
  if (!mappedStatus) return null;
  const guestProfile = await resolveGuestProfile(db, booking);
  const now = new Date();
  const operational = {
    propertyId: booking.propertyId,
    ownerId: booking.property.ownerId,
    guestProfileId: guestProfile.id,
    source: "NOLSAF",
    attribution: "NOLSAF_MARKETPLACE",
    externalRef: `NOLSAF-${booking.id}`,
    status: mappedStatus,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    holdExpiresAt: null,
    ...(mappedStatus === "CONFIRMED" ? { confirmedAt: booking.nrmsReservation?.status === "CONFIRMED" ? undefined : now } : {}),
    ...(mappedStatus === "CHECKED_IN" ? { checkedInAt: now } : {}),
    ...(mappedStatus === "CHECKED_OUT" ? { checkedOutAt: now } : {}),
    ...(mappedStatus === "CANCELLED" ? { cancelledAt: now, cancelReason: booking.cancelReason ?? "NoLSAF booking cancelled" } : {}),
  };

  const reservation = await db.reservation.upsert({
    where: { bookingId: booking.id },
    update: operational,
    create: {
      ...operational,
      bookingId: booking.id,
      events: { create: { type: "MARKETPLACE_CONNECTED", data: { bookingId: booking.id, source: "NOLSAF", status: mappedStatus } } },
    },
  });

  if (mappedStatus === "CANCELLED") {
    await db.reservationRoomAllocation.updateMany({
      where: { reservationId: reservation.id, status: "ACTIVE" },
      data: { status: "RELEASED" },
    });
    return reservation;
  }

  const room = await resolveRoom(db, booking.propertyId, booking.roomCode ?? null);
  if (!room.roomTypeId) return reservation;

  const desiredCount = Math.max(1, Number(booking.roomsQty ?? 1));
  const active = await db.reservationRoomAllocation.findMany({
    where: { reservationId: reservation.id, status: "ACTIVE" },
    select: { id: true, roomTypeId: true, roomUnitId: true, startDate: true, endDate: true },
  });
  const datesChanged = active.some((allocation: any) =>
    new Date(allocation.startDate).getTime() !== new Date(booking.checkIn).getTime()
      || new Date(allocation.endDate).getTime() !== new Date(booking.checkOut).getTime(),
  );
  const roomChanged = active.some((allocation: any) =>
    allocation.roomTypeId !== room.roomTypeId || (room.roomUnitId != null && allocation.roomUnitId !== room.roomUnitId),
  );
  if (datesChanged || roomChanged || active.length !== desiredCount) {
    if (active.length) {
      await db.reservationRoomAllocation.updateMany({
        where: { reservationId: reservation.id, status: "ACTIVE" },
        data: { status: "RELEASED" },
      });
    }
    // Marketplace bookings do not choose an NRMS rate plan, so the meal plan
    // comes from the property default. Snapshotted onto the allocation so the
    // breakfast list can answer for these stays like any other.
    const plan = await resolveAllocationMealPlan(db, { propertyId: reservation.propertyId, roomTypeId: room.roomTypeId });
    await db.reservationRoomAllocation.createMany({
      data: Array.from({ length: desiredCount }, (_, index) => ({
        reservationId: reservation.id,
        roomTypeId: room.roomTypeId,
        // A specific physical room can represent only one allocation. Any
        // additional quantity stays type-level until staff assigns units.
        roomUnitId: index === 0 ? room.roomUnitId : null,
        startDate: booking.checkIn,
        endDate: booking.checkOut,
        status: "ACTIVE",
        ratePlanId: plan.ratePlanId,
        mealPlan: plan.mealPlan,
      })),
    });
  }

  if (mappedStatus === "CHECKED_IN") await queueNrmsCheckInWelcome(db, reservation.id);

  return reservation;
}

/**
 * The only safe NEW -> CONFIRMED transition: serialize property inventory,
 * re-check all NoLSAF/NRMS/block consumers, then connect the NRMS projection in
 * the same transaction. Callers own the surrounding database transaction.
 */
export async function confirmNoLsafBooking(db: DbLike, bookingId: number) {
  const seed = await db.booking.findUnique({ where: { id: bookingId }, select: { id: true, propertyId: true, status: true } });
  if (!seed) return null;
  await lockPropertyInventory(db, seed.propertyId);

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { property: { select: { id: true, status: true, roomsSpec: true, totalBedrooms: true } } },
  });
  if (!booking) return null;
  if (["CANCELED", "CANCELLED", "VOID"].includes(String(booking.status).toUpperCase())) {
    throw new Error("CANCELED_BOOKING_CANNOT_BE_CONFIRMED");
  }

  let updated = booking;
  if (booking.status === "NEW") {
    const availability = await computeDraftBookingAvailability(booking, { db, excludeBookingId: booking.id });
    if (!availability.available) throw new NoLsafInventoryConflictError(availability);
    updated = await db.booking.update({ where: { id: booking.id }, data: { status: "CONFIRMED" } });
  }
  await syncNoLsafBookingToNrms(db, booking.id);
  return updated;
}

export async function updateNoLsafBookingStatus(db: DbLike, bookingId: number, status: string, data: Record<string, unknown> = {}) {
  const updated = await db.booking.update({ where: { id: bookingId }, data: { ...data, status } });
  await syncNoLsafBookingToNrms(db, bookingId);
  return updated;
}

/** One-time/self-healing connection for confirmed bookings created before this projection existed. */
export async function connectExistingNoLsafBookings(db: DbLike, propertyId: number, start: Date, end: Date) {
  const missing = await db.booking.findMany({
    where: {
      propertyId,
      status: { in: ["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN", "CHECKED_OUT"] },
      OR: [
        { nrmsReservation: null },
        { nrmsReservation: { is: { guestProfileId: null } } },
      ],
      AND: [{ checkIn: { lt: end } }, { checkOut: { gt: start } }],
    },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 200,
  });
  for (const booking of missing) {
    if (typeof db.$transaction === "function") {
      await db.$transaction(async (tx: DbLike) => {
        await lockPropertyInventory(tx, propertyId);
        await syncNoLsafBookingToNrms(tx, booking.id);
      });
    } else {
      await syncNoLsafBookingToNrms(db, booking.id);
    }
  }
  return missing.length;
}

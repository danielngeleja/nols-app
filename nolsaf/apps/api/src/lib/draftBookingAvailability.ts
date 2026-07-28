import { prisma } from "@nolsaf/prisma";
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES } from "./bookingStatus.js";
import { filterPayableAvailabilityBlocks } from "./groupStayAvailabilityBlocks.js";
import { getNrmsCapacityConsumers } from "./nrmsAvailability.js";

export type DraftBookingAvailability = {
  available: boolean;
  status: "AVAILABLE" | "UNAVAILABLE" | "PROPERTY_UNAVAILABLE";
  reason: "AVAILABLE" | "BOOKED" | "BLOCKED" | "FULL" | "PROPERTY_UNAVAILABLE";
  message: string;
  checkedAt: string;
  propertyId: number;
  bookingId: number;
  roomCode: string | null;
  requestedRooms: number;
  availableRooms: number;
  bookedRooms: number;
  blockedRooms: number;
  totalRooms: number;
  selectedRoomType: string | null;
};

type DbLike = typeof prisma;

function toFiniteInt(value: unknown, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

function roomCodeToTypeKey(roomCode: string | null | undefined): string {
  const s = String(roomCode ?? "").trim();
  if (!s) return "default";
  return s.replace(/-\d+$/, "") || s;
}

function findBucketKey(roomCode: string | null | undefined, keys: string[]): string | null {
  const typeKey = roomCodeToTypeKey(roomCode);
  if (keys.includes(typeKey)) return typeKey;
  const rc = String(roomCode ?? "");
  return keys.find((key) => rc === key || (key && rc.startsWith(key + "-"))) || null;
}

function isSpecificRoom(roomCode: string | null | undefined): boolean {
  return /-\d+$/.test(String(roomCode ?? "").trim());
}

function extractRoomTypes(roomsSpec: unknown): any[] {
  if (!roomsSpec || typeof roomsSpec !== "object") return [];
  if (Array.isArray(roomsSpec)) return roomsSpec;
  const spec = roomsSpec as any;
  return Array.isArray(spec.rooms) ? spec.rooms : [];
}

function roomTypeKeyFromSpec(roomType: any): string {
  const raw = String(
    roomType?.code ??
      roomType?.roomCode ??
      roomType?.roomType ??
      roomType?.type ??
      roomType?.name ??
      roomType?.label ??
      "",
  ).trim();
  return roomCodeToTypeKey(raw);
}

function buildBuckets(property: any, requestedRoomCode: string | null) {
  const roomTypes = extractRoomTypes(property?.roomsSpec);
  const buckets: Record<string, { totalRooms: number; bookedRooms: number; blockedRooms: number }> = {};
  const requestedType = requestedRoomCode ? roomCodeToTypeKey(requestedRoomCode) : null;

  if (roomTypes.length) {
    for (const roomType of roomTypes) {
      const key = roomTypeKeyFromSpec(roomType);
      const rooms = Math.max(
        1,
        toFiniteInt(roomType?.rooms ?? roomType?.roomsCount ?? roomType?.count ?? property?.totalBedrooms ?? 1, 1),
      );
      if (!buckets[key]) buckets[key] = { totalRooms: 0, bookedRooms: 0, blockedRooms: 0 };
      buckets[key].totalRooms += rooms;
    }
  }

  if (!Object.keys(buckets).length) {
    buckets.default = {
      totalRooms: Math.max(1, toFiniteInt(property?.totalBedrooms ?? 1, 1)),
      bookedRooms: 0,
      blockedRooms: 0,
    };
  }

  if (requestedRoomCode && requestedType) {
    if (isSpecificRoom(requestedRoomCode)) {
      for (const key of Object.keys(buckets)) delete buckets[key];
      buckets[requestedRoomCode] = { totalRooms: 1, bookedRooms: 0, blockedRooms: 0 };
    } else {
      const selected = buckets[requestedType] ?? { totalRooms: 0, bookedRooms: 0, blockedRooms: 0 };
      for (const key of Object.keys(buckets)) delete buckets[key];
      buckets[requestedType] = selected;
    }
  }

  return buckets;
}

export async function getDraftBookingAvailability(
  bookingId: number,
  options: { db?: DbLike; excludeBookingId?: number } = {},
): Promise<DraftBookingAvailability | null> {
  const db = (options.db ?? prisma) as any;
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      property: {
        select: {
          id: true,
          status: true,
          roomsSpec: true,
          totalBedrooms: true,
        },
      },
    },
  });

  if (!booking) return null;
  return computeDraftBookingAvailability(booking, options);
}

export async function computeDraftBookingAvailability(
  booking: any,
  options: { db?: DbLike; excludeBookingId?: number } = {},
): Promise<DraftBookingAvailability> {
  const db = (options.db ?? prisma) as any;
  const requestedRooms = Math.max(1, toFiniteInt(booking?.roomsQty ?? 1, 1));
  const roomCode = booking?.roomCode ? String(booking.roomCode).trim() : null;
  const propertyId = Number(booking?.propertyId ?? booking?.property?.id ?? 0);
  const bookingId = Number(booking?.id ?? 0);
  const checkedAt = new Date().toISOString();

  if (!booking?.property || booking.property.status !== "APPROVED") {
    return {
      available: false,
      status: "PROPERTY_UNAVAILABLE",
      reason: "PROPERTY_UNAVAILABLE",
      message: "This property is no longer available for booking. Please select another property.",
      checkedAt,
      propertyId,
      bookingId,
      roomCode,
      requestedRooms,
      availableRooms: 0,
      bookedRooms: 0,
      blockedRooms: 0,
      totalRooms: 0,
      selectedRoomType: roomCode ? roomCodeToTypeKey(roomCode) : null,
    };
  }

  const checkIn = new Date(booking.checkIn);
  const checkOut = new Date(booking.checkOut);
  const buckets = buildBuckets(booking.property, roomCode);
  const keys = Object.keys(buckets);

  const [conflictingBookings, rawConflictingBlocks, nrmsConsumers] = await Promise.all([
    db.booking.findMany({
      where: {
        propertyId,
        status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
        id: { not: options.excludeBookingId ?? bookingId },
        AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gt: checkIn } }],
      },
      select: { id: true, roomCode: true, roomsQty: true },
    }),
    db.propertyAvailabilityBlock.findMany({
      where: {
        propertyId,
        AND: [{ startDate: { lt: checkOut } }, { endDate: { gt: checkIn } }],
      },
      select: { id: true, roomCode: true, bedsBlocked: true, source: true, notes: true },
    }),
    getNrmsCapacityConsumers(db, propertyId, checkIn, checkOut),
  ]);
  const conflictingBlocks = await filterPayableAvailabilityBlocks(rawConflictingBlocks, db);

  const applyToBucket = (sourceRoomCode: string | null | undefined, count: number, kind: "bookedRooms" | "blockedRooms") => {
    if (roomCode && isSpecificRoom(roomCode) && sourceRoomCode !== roomCode) return;

    const mapped = findBucketKey(sourceRoomCode, keys);
    const explicitMismatch = !!(sourceRoomCode && !mapped);
    const bucketKey = explicitMismatch ? null : mapped || keys[0] || null;
    if (!bucketKey || !buckets[bucketKey]) return;
    buckets[bucketKey][kind] += Math.max(1, count);
  };

  for (const row of conflictingBookings) {
    applyToBucket(row.roomCode, toFiniteInt(row.roomsQty ?? 1, 1), "bookedRooms");
  }

  for (const row of conflictingBlocks) {
    applyToBucket(row.roomCode, toFiniteInt(row.bedsBlocked ?? 1, 1), "blockedRooms");
  }
  for (const row of nrmsConsumers) {
    applyToBucket(row.roomUnitCode ?? row.roomTypeName, 1, "blockedRooms");
  }

  const selectedRoomType = roomCode ? roomCodeToTypeKey(roomCode) : null;
  const selectedKey = roomCode
    ? (isSpecificRoom(roomCode) ? roomCode : selectedRoomType)
    : null;
  const selectedBucket = selectedKey ? buckets[selectedKey] : null;
  const summaryBuckets = selectedBucket ? [selectedBucket] : Object.values(buckets);

  const totalRooms = summaryBuckets.reduce((sum, bucket) => sum + bucket.totalRooms, 0);
  const bookedRooms = summaryBuckets.reduce((sum, bucket) => sum + bucket.bookedRooms, 0);
  const blockedRooms = summaryBuckets.reduce((sum, bucket) => sum + bucket.blockedRooms, 0);
  const availableRooms = Math.max(0, totalRooms - bookedRooms - blockedRooms);
  const available = availableRooms >= requestedRooms;

  const reason: DraftBookingAvailability["reason"] = available
    ? "AVAILABLE"
    : blockedRooms > 0 && availableRooms < requestedRooms
      ? "BLOCKED"
      : bookedRooms > 0 && availableRooms < requestedRooms
        ? "BOOKED"
        : "FULL";

  const message = available
    ? "Selected room is still available for payment."
    : reason === "BLOCKED"
      ? "This room is currently blocked by the property owner. Please select another room or property."
      : "This room has been booked by another guest. Please select another room or property.";

  return {
    available,
    status: available ? "AVAILABLE" : "UNAVAILABLE",
    reason,
    message,
    checkedAt,
    propertyId,
    bookingId,
    roomCode,
    requestedRooms,
    availableRooms,
    bookedRooms,
    blockedRooms,
    totalRooms,
    selectedRoomType,
  };
}

export function unavailableDraftPaymentResponse(availability: DraftBookingAvailability) {
  return {
    error: "room_unavailable",
    code: "DRAFT_ROOM_UNAVAILABLE",
    message: availability.message,
    availability,
  };
}

// apps/api/src/lib/bookingAvailability.ts
import { prisma } from "@nolsaf/prisma";
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES } from "./bookingStatus.js";
import { matchingRoomSelectionCodes } from "./roomSelectionCode.js";

/**
 * Check if a property is available for the given dates
 * Returns true if available, false if there's a conflict
 * Now includes availability blocks (external bookings) in the check
 */
export async function checkPropertyAvailability(
  propertyId: number,
  checkIn: Date,
  checkOut: Date,
  excludeBookingId?: number,
  roomCode?: string | null
): Promise<{ available: boolean; conflictingBookings?: any[]; conflictingBlocks?: any[] }> {
  const property = roomCode
    ? await prisma.property.findUnique({ where: { id: propertyId }, select: { roomsSpec: true } })
    : null;
  const overlapsRequestedRoom = (existing: string | null | undefined) => {
    if (!roomCode || !existing) return true;
    return (
      matchingRoomSelectionCodes(existing, [roomCode], property?.roomsSpec).length > 0 ||
      matchingRoomSelectionCodes(roomCode, [existing], property?.roomsSpec).length > 0
    );
  };

  // Find all bookings for this property that overlap with the requested dates
  const overlappingBookings = await prisma.booking.findMany({
    where: {
      propertyId,
      status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
      // Check for date overlap: existing booking starts before requested checkout
      // AND existing booking ends after requested checkin
      AND: [
        {
          checkIn: {
            lt: checkOut, // Existing booking starts before requested checkout
          },
        },
        {
          checkOut: {
            gt: checkIn, // Existing booking ends after requested checkin
          },
        },
      ],
      // Exclude the current booking if updating
      ...(excludeBookingId && { id: { not: excludeBookingId } }),
    },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      status: true,
      guestName: true,
      roomCode: true,
    },
  });
  const conflictingBookings = overlappingBookings.filter((booking) =>
    overlapsRequestedRoom(booking.roomCode),
  );

  // Find all availability blocks that overlap with the requested dates
  const overlappingBlocks = await prisma.propertyAvailabilityBlock.findMany({
    where: {
      propertyId,
      AND: [
        {
          startDate: {
            lt: checkOut,
          },
        },
        {
          endDate: {
            gt: checkIn,
          },
        },
      ],
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      roomCode: true,
      source: true,
      bedsBlocked: true,
    },
  });
  const conflictingBlocks = overlappingBlocks.filter((block) =>
    overlapsRequestedRoom(block.roomCode),
  );

  const hasConflict = conflictingBookings.length > 0 || conflictingBlocks.length > 0;

  return {
    available: !hasConflict,
    conflictingBookings: conflictingBookings.length > 0 ? conflictingBookings : undefined,
    conflictingBlocks: conflictingBlocks.length > 0 ? conflictingBlocks : undefined,
  };
}

/**
 * Check if property can accommodate the requested number of guests
 */
export async function checkGuestCapacity(
  propertyId: number,
  adults: number,
  children: number,
  pets: number
): Promise<{ canAccommodate: boolean; maxGuests?: number; message?: string }> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { maxGuests: true },
  });

  if (!property) {
    return { canAccommodate: false, message: "Property not found" };
  }

  const totalGuests = adults + children;
  const maxGuests = property.maxGuests || 0;

  if (maxGuests > 0 && totalGuests > maxGuests) {
    return {
      canAccommodate: false,
      maxGuests,
      message: `Property can accommodate maximum ${maxGuests} guests, but ${totalGuests} requested`,
    };
  }

  return { canAccommodate: true, maxGuests };
}

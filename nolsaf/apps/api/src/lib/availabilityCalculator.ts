// apps/api/src/lib/availabilityCalculator.ts
/**
 * Comprehensive Availability Calculator
 * 
 * PRINCIPLES FOR CONFLICT AVOIDANCE:
 * 
 * 1. DATE OVERLAP RULE:
 *    - A room is considered booked/blocked if ANY booking or block overlaps with the requested dates
 *    - Overlap occurs when: (existingStart < requestedEnd) AND (existingEnd > requestedStart)
 * 
 * 2. ROOM TYPE SPECIFICITY:
 *    - If roomCode is specified, only check that specific room
 *    - If roomCode is null/empty, check all rooms of that type
 *    - Room types are identified by matching roomCode patterns (e.g., "Single-1", "Double-2")
 * 
 * 3. BOOKING STATUS FILTERING:
 *    - Only payment-confirmed/arrival-active bookings count: CONFIRMED, PENDING_CHECKIN, CHECKED_IN
 *    - Unpaid holds (NEW), cancelled, checked-out, or rejected bookings don't block availability
 * 
 * 4. AVAILABILITY BLOCKS (External Bookings):
 *    - All blocks are considered active (no status field)
 *    - Blocks represent bookings from external sources (Airbnb, Booking.com, walk-ins, etc.)
 *    - Blocks have equal weight to nolsaf bookings in conflict detection
 * 
 * 5. BEDS/ROOMS COUNTING:
 *    - Each booking blocks the entire room (1 room = 1 booking)
 *    - bedsBlocked in availability blocks indicates how many beds/rooms are blocked
 *    - Default bedsBlocked = 1 if not specified
 * 
 * 6. CALCULATION ACCURACY:
 *    - Total rooms = Sum of all rooms of specified type(s) in property
 *    - Booked rooms = Count of overlapping bookings + Sum of bedsBlocked from overlapping blocks
 *    - Available rooms = Total rooms - Booked rooms
 *    - Availability percentage = (Available rooms / Total rooms) * 100
 */

import { prisma } from "@nolsaf/prisma";
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES } from "./bookingStatus.js";
import { getNrmsCapacityConsumers } from "./nrmsAvailability.js";
import { evaluateRestrictionRules, type RestrictionBlock } from "./nrmsRestrictions.js";
import { matchingRoomSelectionCodes } from "./roomSelectionCode.js";

/** Normalize Prisma DateTime (Date or ISO string) to Date for .getTime() / .toISOString() */
function toDate(x: unknown): Date {
  if (x instanceof Date) return x;
  if (x == null) return new Date(0);
  const d = new Date(x as string | number);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

export type AvailabilityCalculationResult = {
  // Date range analyzed
  dateRange: {
    startDate: Date;
    endDate: Date;
    nights: number;
  };
  
  // Room type breakdown
  byRoomType: Record<string, {
    roomType: string;
    totalRooms: number;
    bookedRooms: number;
    blockedRooms: number;
    availableRooms: number;
    availabilityPercentage: number;
    /** Physically free rooms that may actually be sold: 0 when an NRMS control closes these dates. */
    sellableRooms: number;
    /** The control closing this room type, if any. Null means nothing is in the way. */
    restriction: { restrictionId: number; name: string; code: string; message: string } | null;
    bookings: Array<{
      id: number;
      type: 'booking' | 'block';
      checkIn: Date;
      checkOut: Date;
      roomCode: string | null;
      guestName?: string;
      source?: string;
      totalAmount?: number;
      bedsBlocked?: number;
    }>;
  }>;
  
  // Overall summary
  summary: {
    totalRooms: number;
    totalBookedRooms: number;
    totalBlockedRooms: number;
    totalAvailableRooms: number;
    overallAvailabilityPercentage: number;
    /** What can be sold once NRMS controls are applied. Search and the booking funnel must gate on this, not on totalAvailableRooms. */
    totalSellableRooms: number;
  };

  /**
   * NRMS controls closing part or all of this date range. Physical counts above
   * stay truthful so an owner still sees real capacity; these say what may be
   * sold. A property-wide rule appears once with roomType null.
   */
  restrictions: Array<{ restrictionId: number; name: string; code: string; message: string; roomType: string | null }>;
  
  // Conflict detection
  hasConflicts: boolean;
  conflicts: Array<{
    type: 'booking' | 'block';
    id: number;
    roomCode: string | null;
    startDate: Date;
    endDate: Date;
    details: any;
  }>;
};

export type CalculateAvailabilityOptions = {
  /** When editing a block, exclude it from the blocks count so capacity is correct */
  excludeBlockId?: number;
};

/**
 * Calculate comprehensive availability for a property
 * 
 * @param propertyId - Property ID
 * @param startDate - Start date of the period to analyze
 * @param endDate - End date of the period to analyze (exclusive, like checkout)
 * @param roomCode - Optional: specific room code to check. If null, checks all rooms
 * @param roomTypePattern - Optional: pattern to match room types (e.g., "Single", "Double")
 * @param options - Optional: excludeBlockId when editing a block to get accurate capacity
 */
export async function calculateAvailability(
  propertyId: number,
  startDate: Date,
  endDate: Date,
  roomCode?: string | null,
  roomTypePattern?: string,
  options?: CalculateAvailabilityOptions
): Promise<AvailabilityCalculationResult> {
  // Validate dates
  if (endDate <= startDate) {
    throw new Error("End date must be after start date");
  }

  // Get property with room specifications
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      id: true,
      roomsSpec: true,
      layout: true,
    },
  });

  if (!property) {
    throw new Error("Property not found");
  }

  // Extract room types and counts from roomsSpec or layout
  const roomTypes = extractRoomTypes(property.roomsSpec, property.layout, roomCode, roomTypePattern);
  
  // Calculate nights
  const nights = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  // Get all overlapping bookings (nolsaf bookings)
  const bookings = await prisma.booking.findMany({
    where: {
      propertyId,
      status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
      AND: [
        { checkIn: { lt: endDate } },
        { checkOut: { gt: startDate } },
      ],
    },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      status: true,
      guestName: true,
      roomCode: true,
      totalAmount: true,
    },
    orderBy: { checkIn: 'asc' },
  });

  // Get all overlapping availability blocks (external bookings)
  const blocks: any[] = await prisma.propertyAvailabilityBlock.findMany({
    where: {
      propertyId,
      AND: [
        { startDate: { lt: endDate } },
        { endDate: { gt: startDate } },
      ],
      ...(options?.excludeBlockId != null && { id: { not: options.excludeBlockId } }),
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      roomCode: true,
      source: true,
      bedsBlocked: true,
    },
    orderBy: { startDate: 'asc' },
  });
  const nrmsConsumers = await getNrmsCapacityConsumers(prisma, propertyId, startDate, endDate);
  blocks.push(...nrmsConsumers.map((row) => ({
    id: -row.allocationId,
    startDate: row.startDate,
    endDate: row.endDate,
    roomCode: row.roomUnitCode ?? row.roomTypeName,
    source: "NRMS",
    bedsBlocked: 1,
  })));

  /**
   * NRMS controls covering this range. Loaded once for the property, then
   * matched to each room-type bucket by name, because this calculator works in
   * roomsSpec type names while a control points at an NRMS RoomType row.
   *
   * A property that never activated NRMS simply has none of these, so the
   * query costs one indexed lookup and changes nothing for it.
   */
  const restrictionRules: any[] = await prisma.nrmsRateRestriction.findMany({
    where: {
      propertyId,
      status: "ACTIVE",
      startDate: { lte: endDate },
      endDate: { gte: startDate },
      OR: [{ channelCode: null }, { channelCode: "NOLSAF" }],
    },
    include: { roomType: { select: { id: true, name: true } } },
  });

  const restrictionFor = (typeName: string | null): RestrictionBlock | null => {
    if (restrictionRules.length === 0) return null;
    const scoped = restrictionRules.filter((rule) => {
      if (rule.roomTypeId == null) return true;
      if (!typeName) return false;
      // roomsSpec names and NRMS room type names are the same strings, entered
      // by the same owner, so compare them case and space insensitively rather
      // than demanding an exact match.
      const ruleName = String(rule.roomType?.name ?? "").trim().toLowerCase();
      return ruleName !== "" && ruleName === typeName.trim().toLowerCase();
    });
    if (scoped.length === 0) return null;
    // Scoping was just done by name, so the room type is cleared before the
    // date and stay checks run. Leaving the id on would make the evaluator
    // filter these rules out again, since this context has no room type id.
    // A rule bound to one rate plan is deliberately left to the quote step:
    // a search has no plan, and one plan being closed does not close the room.
    const blocks = evaluateRestrictionRules(scoped.map((rule) => ({ ...rule, roomTypeId: null })), {
      propertyId,
      roomTypeId: null,
      ratePlanId: null,
      checkIn: startDate,
      checkOut: endDate,
      channelCode: "NOLSAF",
    });
    return blocks[0] ?? null;
  };

  const propertyWideRestriction = restrictionFor(null);

  // Group by room type
  const byRoomType: Record<string, AvailabilityCalculationResult['byRoomType'][string]> = {};

  // Bookings/blocks without a roomCode cannot be mapped to a specific room type.
  // We still count them in overall totals so owners see all Nolsaf bookings for the selected date range.
  const unassignedBookings = !roomCode ? bookings.filter((b) => !b.roomCode) : [];
  const unassignedBlocks = !roomCode ? blocks.filter((b) => !b.roomCode) : [];

  for (const roomType of roomTypes) {
    const typeName = roomType.type;
    const totalRooms = roomType.count;
    
    // Filter bookings for this room type
    const typeBookings = bookings.filter(b => {
      if (!b.roomCode) return false;
      if (roomCode) {
        return matchingRoomSelectionCodes(
          b.roomCode,
          [String(roomCode)],
          property.roomsSpec,
        ).length > 0;
      }
      // Match room type pattern (e.g., "Single-1", "Single-2" -> "Single")
      return b.roomCode.startsWith(typeName);
    });

    // Filter blocks for this room type
    const typeBlocks = blocks.filter(b => {
      if (roomCode) {
        return matchingRoomSelectionCodes(
          b.roomCode,
          [String(roomCode)],
          property.roomsSpec,
        ).length > 0;
      }
      if (!b.roomCode) return false;
      return b.roomCode.startsWith(typeName);
    });

    // Count booked rooms (each booking = 1 room)
    const bookedRooms = typeBookings.length;

    // Count blocked rooms (sum of bedsBlocked, default 1)
    const blockedRooms = typeBlocks.reduce((sum, b) => sum + (b.bedsBlocked || 1), 0);

    // Calculate available rooms
    const availableRooms = Math.max(0, totalRooms - bookedRooms - blockedRooms);
    const availabilityPercentage = totalRooms > 0 
      ? Math.round((availableRooms / totalRooms) * 100) 
      : 0;

    // Combine bookings and blocks for display (normalize dates: Prisma may return Date or string)
    const allBookings = [
      ...typeBookings.map(b => ({
        id: b.id,
        type: 'booking' as const,
        checkIn: toDate(b.checkIn),
        checkOut: toDate(b.checkOut),
        roomCode: b.roomCode,
        guestName: b.guestName || undefined,
        totalAmount: b.totalAmount ? Number(b.totalAmount) : undefined,
      })),
      ...typeBlocks.map(b => ({
        id: b.id,
        type: 'block' as const,
        checkIn: toDate(b.startDate),
        checkOut: toDate(b.endDate),
        roomCode: b.roomCode,
        source: b.source || undefined,
        bedsBlocked: b.bedsBlocked || 1,
      })),
    ].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime());

    // A control closing these dates makes free rooms unsellable. The physical
    // counts above stay honest so the owner still sees real capacity.
    const typeRestriction = restrictionFor(typeName) ?? propertyWideRestriction;

    byRoomType[typeName] = {
      roomType: typeName,
      totalRooms,
      bookedRooms,
      blockedRooms,
      availableRooms,
      availabilityPercentage,
      sellableRooms: typeRestriction ? 0 : availableRooms,
      restriction: typeRestriction
        ? { restrictionId: typeRestriction.restrictionId, name: typeRestriction.name, code: typeRestriction.code, message: typeRestriction.message }
        : null,
      bookings: allBookings,
    };
  }

  // Surface unassigned bookings/blocks in a dedicated bucket so they're visible in the owner UI.
  // (These rows do not represent a real room type capacity; they exist for transparency.)
  if (!roomCode && (unassignedBookings.length > 0 || unassignedBlocks.length > 0)) {
    const unassignedBookedRooms = unassignedBookings.length;
    const unassignedBlockedRooms = unassignedBlocks.reduce((sum, b) => sum + (b.bedsBlocked || 1), 0);
    byRoomType["Unassigned"] = {
      roomType: "Unassigned",
      totalRooms: 0,
      bookedRooms: unassignedBookedRooms,
      blockedRooms: unassignedBlockedRooms,
      availableRooms: 0,
      availabilityPercentage: 0,
      sellableRooms: 0,
      restriction: null,
      bookings: [
        ...unassignedBookings.map((b) => ({
          id: b.id,
          type: 'booking' as const,
          checkIn: toDate(b.checkIn),
          checkOut: toDate(b.checkOut),
          roomCode: null,
          guestName: b.guestName || undefined,
          totalAmount: b.totalAmount ? Number(b.totalAmount) : undefined,
        })),
        ...unassignedBlocks.map((b) => ({
          id: b.id,
          type: 'block' as const,
          checkIn: toDate(b.startDate),
          checkOut: toDate(b.endDate),
          roomCode: null,
          source: b.source || undefined,
          bedsBlocked: b.bedsBlocked || 1,
        })),
      ].sort((a, b) => a.checkIn.getTime() - b.checkIn.getTime()),
    };
  }

  // Calculate summary
  const totalRooms = roomTypes.reduce((sum, rt) => sum + rt.count, 0);
  // Count totals from raw sources so bookings/blocks without roomCode still appear in summary.
  const totalBookedRooms = bookings.length;
  const totalBlockedRooms = blocks.reduce((sum, b) => sum + (b.bedsBlocked || 1), 0);
  const totalAvailableRooms = totalRooms - totalBookedRooms - totalBlockedRooms;
  const overallAvailabilityPercentage = totalRooms > 0
    ? Math.round((totalAvailableRooms / totalRooms) * 100)
    : 0;
  // Sellable is summed from the room-type buckets, so a control closing one
  // type leaves the others sellable instead of shutting the whole property.
  const totalSellableRooms = propertyWideRestriction
    ? 0
    : Math.max(0, Math.min(totalAvailableRooms, Object.values(byRoomType).reduce((sum, bucket) => sum + bucket.sellableRooms, 0)));

  const appliedRestrictions: AvailabilityCalculationResult["restrictions"] = [];
  if (propertyWideRestriction) {
    appliedRestrictions.push({ ...propertyWideRestriction, roomType: null });
  }
  for (const bucket of Object.values(byRoomType)) {
    if (bucket.restriction && !appliedRestrictions.some((entry) => entry.restrictionId === bucket.restriction!.restrictionId)) {
      appliedRestrictions.push({ ...bucket.restriction, roomType: bucket.roomType });
    }
  }

  // Detect conflicts (normalize dates for route's .toISOString())
  const conflicts = [
    ...bookings.map(b => ({
      type: 'booking' as const,
      id: b.id,
      roomCode: b.roomCode,
      startDate: toDate(b.checkIn),
      endDate: toDate(b.checkOut),
      details: {
        guestName: b.guestName,
        status: b.status,
        totalAmount: b.totalAmount ? Number(b.totalAmount) : 0,
      },
    })),
    ...blocks.map(b => ({
      type: 'block' as const,
      id: b.id,
      roomCode: b.roomCode,
      startDate: toDate(b.startDate),
      endDate: toDate(b.endDate),
      details: {
        source: b.source,
        bedsBlocked: b.bedsBlocked || 1,
      },
    })),
  ];

  return {
    dateRange: {
      startDate,
      endDate,
      nights,
    },
    byRoomType,
    summary: {
      totalRooms,
      totalBookedRooms,
      totalBlockedRooms,
      totalAvailableRooms: Math.max(0, totalAvailableRooms),
      overallAvailabilityPercentage,
      totalSellableRooms,
    },
    restrictions: appliedRestrictions,
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}

/**
 * Extract room types from property data
 */
function extractRoomTypes(
  roomsSpec: any,
  layout: any,
  roomCode?: string | null,
  roomTypePattern?: string
): Array<{ type: string; count: number; codes: string[] }> {
  const roomTypes: Record<string, { count: number; codes: string[] }> = {};

  // Try to extract from layout first (most accurate)
  if (layout && typeof layout === 'object') {
    try {
      const layoutData = typeof layout === 'string' ? JSON.parse(layout) : layout;
      if (layoutData.floors && Array.isArray(layoutData.floors)) {
        for (const floor of layoutData.floors) {
          if (floor.rooms && Array.isArray(floor.rooms)) {
            for (const room of floor.rooms) {
              if (room.code) {
                // Extract room type from code (e.g., "Single-1" -> "Single")
                const match = room.code.match(/^([A-Za-z]+)/);
                if (match) {
                  const type = match[1];
                  if (!roomTypes[type]) {
                    roomTypes[type] = { count: 0, codes: [] };
                  }
                  roomTypes[type].count++;
                  roomTypes[type].codes.push(room.code);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      // Fall back to roomsSpec
    }
  }

  // Fall back to roomsSpec if layout didn't provide data
  if (Object.keys(roomTypes).length === 0 && roomsSpec) {
    try {
      const spec = typeof roomsSpec === 'string' ? JSON.parse(roomsSpec) : roomsSpec;
      const rooms = Array.isArray(spec) ? spec : (spec && Array.isArray(spec.rooms) ? spec.rooms : []);
      
      for (const room of rooms) {
        const roomType = room.roomType || room.type || 'Room';
        const count = Number(room.roomsCount || room.count || 1);
        
        if (!roomTypes[roomType]) {
          roomTypes[roomType] = { count: 0, codes: [] };
        }
        roomTypes[roomType].count += count;
        
        // Generate codes if not provided
        for (let i = 0; i < count; i++) {
          const code = room.code || `${roomType}-${i + 1}`;
          roomTypes[roomType].codes.push(code);
        }
      }
    } catch (e) {
      // If parsing fails, create a default
      roomTypes['Room'] = { count: 1, codes: [roomCode || 'Room-1'] };
    }
  }

  // Filter by roomCode if specified
  if (roomCode) {
    const filtered: Record<string, { count: number; codes: string[] }> = {};
    for (const [type, data] of Object.entries(roomTypes)) {
      const matchingCodes = data.codes.filter(c => c === roomCode);
      if (matchingCodes.length > 0) {
        filtered[type] = { count: matchingCodes.length, codes: matchingCodes };
      }
    }
    return Object.entries(filtered).map(([type, data]) => ({ type, ...data }));
  }

  // Filter by roomTypePattern if specified
  if (roomTypePattern) {
    const filtered: Record<string, { count: number; codes: string[] }> = {};
    for (const [type, data] of Object.entries(roomTypes)) {
      if (type && type.toLowerCase().includes(roomTypePattern.toLowerCase())) {
        filtered[type] = data;
      }
    }
    return Object.entries(filtered).map(([type, data]) => ({ type, ...data }));
  }

  // Return all room types
  return Object.entries(roomTypes).map(([type, data]) => ({ type, ...data }));
}

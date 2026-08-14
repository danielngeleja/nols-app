// apps/api/src/routes/public.availability.ts
// Public endpoint to check property availability for specific dates
import { Router, type Request, type Response } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES } from "../lib/bookingStatus.js";
import { filterPayableAvailabilityBlocks } from "../lib/groupStayAvailabilityBlocks.js";
import { isCheckInBeforeToday } from "../lib/bookingDateRules.js";
import { findRestrictionBlocks, resolveRoomTypeIdForCode } from "../lib/nrmsRestrictions.js";

export const router = Router();

const availabilityCache = new Map<string, { expiresAt: number; payload: any }>();
const availabilityCacheTtlMs = 0;
const maxAvailabilityCacheEntries = 500;

/** Derive room-type key from roomCode (e.g. "Suite-1" -> "Suite", "Suite" -> "Suite") */
function roomCodeToTypeKey(roomCode: string | null | undefined): string {
  const s = String(roomCode ?? "").trim();
  if (!s) return "default";
  return s.replace(/-\d+$/, "") || s;
}

/** Find which availability bucket (room type) a roomCode belongs to. Uses prefix match so "Suite-1" maps to "Suite". */
function findBucketKey(roomCode: string | null | undefined, keys: string[]): string | null {
  const typeKey = roomCodeToTypeKey(roomCode);
  if (keys.includes(typeKey)) return typeKey;
  const rc = String(roomCode ?? "");
  return keys.find((k) => rc === k || (k && rc.startsWith(k + "-"))) || null;
}

function parseAvailabilityDate(value: string): Date {
  const trimmed = String(value || "").trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(trimmed);
}

// Rate limiter for availability checks
const availabilityLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: process.env.NODE_ENV === "production" ? 300 : 10_000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many availability requests. Please wait a moment." },
  // In local dev (or same-machine setups), we don't want rate limiting to block testing.
  skip: (req) => {
    if (process.env.NODE_ENV !== "production") return true;
    const ip = String((req as any).ip || "");
    return ip === "127.0.0.1" || ip === "::1";
  },
});

// Validation schema
const checkAvailabilitySchema = z.object({
  propertyId: z.number().int().positive(),
  checkIn: z.string().min(1), // YYYY-MM-DD or ISO 8601 format
  checkOut: z.string().min(1),
  roomCode: z.string().max(60).optional().nullable(), // Optional: check specific room
});

/**
 * POST /api/public/availability/check
 * Check property availability for specific dates
 * Returns available rooms/beds count and detailed availability info
 */
router.post("/check", availabilityLimiter, (async (req: Request, res: Response) => {
  try {
    const validationResult = checkAvailabilitySchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({
        error: "Invalid request data",
        details: validationResult.error.issues,
      });
      return;
    }

    const { propertyId, checkIn: checkInStr, checkOut: checkOutStr, roomCode } = validationResult.data;
    const requestedRoomCode = roomCode ? String(roomCode).trim() : null;
    const requestedIsSpecificRoom = !!(requestedRoomCode && /-\d+$/.test(requestedRoomCode));
    const requestedTypeKey = requestedRoomCode ? roomCodeToTypeKey(requestedRoomCode) : null;

    // Validate dates
    const checkIn = parseAvailabilityDate(checkInStr);
    const checkOut = parseAvailabilityDate(checkOutStr);
    const now = new Date();

    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
      res.status(400).json({ error: "Invalid date format" });
      return;
    }

    if (isCheckInBeforeToday(checkIn, now)) {
      res.status(400).json({ error: "Check-in date cannot be in the past" });
      return;
    }

    if (checkOut <= checkIn) {
      res.status(400).json({ error: "Check-out date must be after check-in date" });
      return;
    }

    const cacheKey = [
      propertyId,
      checkIn.toISOString(),
      checkOut.toISOString(),
      requestedRoomCode || "",
    ].join("|");
    const cached = availabilityCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json(cached.payload);
      return;
    }

    // Fetch property
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        status: true,
        title: true,
        roomsSpec: true,
        layout: true,
        totalBedrooms: true,
        maxGuests: true,
      },
    });

    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    if (property.status !== "APPROVED") {
      res.status(400).json({
        error: "Property is not available for booking",
        reason: `Property status is ${property.status}`,
      });
      return;
    }

    // Get all bookings that overlap with the requested dates
    // NOTE: We do not filter by roomCode unless a specific room instance (e.g. "Suite-1") is requested.
    // For a type-level request (e.g. "Suite"), we bucket by prefix so "Suite-1" counts toward "Suite".
    const conflictingBookings = await prisma.booking.findMany({
      where: {
        propertyId,
        status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
        AND: [
          {
            checkIn: { lt: checkOut },
          },
          {
            checkOut: { gt: checkIn },
          },
        ],
        ...(requestedIsSpecificRoom && requestedRoomCode ? { roomCode: requestedRoomCode } : {}),
      },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        status: true,
        roomCode: true,
      },
    });

    // Get all availability blocks that overlap with the requested dates
    const rawAvailabilityBlocks = await prisma.propertyAvailabilityBlock.findMany({
      where: {
        propertyId,
        AND: [
          {
            startDate: { lt: checkOut },
          },
          {
            endDate: { gt: checkIn },
          },
        ],
        ...(requestedIsSpecificRoom && requestedRoomCode ? { roomCode: requestedRoomCode } : {}),
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        roomCode: true,
        bedsBlocked: true,
        source: true,
        notes: true,
      },
    });
    const availabilityBlocks = await filterPayableAvailabilityBlocks(rawAvailabilityBlocks);

    // Parse roomsSpec to get room types and their capacities.
    // Supports multiple shapes across the app: {code, rooms, beds} or {roomType, roomsCount, beds} etc.
    let roomTypes: Array<any> = [];
    if (property.roomsSpec && typeof property.roomsSpec === "object") {
      const spec = property.roomsSpec as any;
      if (Array.isArray(spec)) roomTypes = spec;
      else if (spec.rooms && Array.isArray(spec.rooms)) roomTypes = spec.rooms;
    }

    // Build type buckets: key = room type key (e.g., "Suite")
    const buckets: Record<string, { totalRooms: number; totalBeds: number }> = {};
    if (roomTypes.length > 0) {
      for (const rt of roomTypes) {
        const rawKey = String(rt?.code ?? rt?.roomCode ?? rt?.roomType ?? rt?.type ?? rt?.name ?? rt?.label ?? "").trim();
        const key = roomCodeToTypeKey(rawKey) || "default";
        const rooms = Number(rt?.rooms ?? rt?.roomsCount ?? rt?.count ?? 0) || 0;
        const bedsPerRoom = Number(rt?.beds ?? rt?.bedsPerRoom ?? rt?.bedsCount ?? rt?.capacity ?? 0) || 0;

        const effectiveRooms = rooms > 0 ? rooms : (property.totalBedrooms || 1);
        const effectiveBedsPerRoom = bedsPerRoom > 0 ? bedsPerRoom : 1;

        if (!buckets[key]) buckets[key] = { totalRooms: 0, totalBeds: 0 };
        buckets[key].totalRooms += effectiveRooms;
        buckets[key].totalBeds += effectiveRooms * effectiveBedsPerRoom;
      }
    }

    if (Object.keys(buckets).length === 0) {
      // Safe fallback
      const totalRooms = property.totalBedrooms || 1;
      const bedsPerRoom = 2;
      buckets["default"] = { totalRooms, totalBeds: totalRooms * bedsPerRoom };
    }

    // If caller asked for a type key (e.g. "Suite"), restrict to that bucket.
    // If caller asked for a specific room instance (e.g. "Suite-1"), treat it as a single room.
    if (requestedRoomCode && requestedTypeKey) {
      if (requestedIsSpecificRoom) {
        const base = buckets[requestedTypeKey] || buckets["default"];
        const bedsPerRoom = Math.max(1, Math.round((base?.totalBeds || 1) / Math.max(1, base?.totalRooms || 1)));
        for (const k of Object.keys(buckets)) delete buckets[k];
        buckets[requestedRoomCode] = { totalRooms: 1, totalBeds: bedsPerRoom };
      } else {
        const only = buckets[requestedTypeKey];
        for (const k of Object.keys(buckets)) {
          if (k !== requestedTypeKey) delete buckets[k];
        }
        if (!only) {
          // Ensure a stable response even if roomsSpec is missing this key
          buckets[requestedTypeKey] = { totalRooms: 0, totalBeds: 0 };
        }
      }
    }

    // Calculate availability per room type
    const availabilityByRoomType: Record<string, {
      totalRooms: number;
      totalBeds: number;
      bookedRooms: number;
      bookedBeds: number;
      blockedRooms: number;
      blockedBeds: number;
      availableRooms: number;
      availableBeds: number;
    }> = {};

    // Initialize buckets
    Object.entries(buckets).forEach(([key, b]) => {
      availabilityByRoomType[key] = {
        totalRooms: b.totalRooms,
        totalBeds: b.totalBeds,
        bookedRooms: 0,
        bookedBeds: 0,
        blockedRooms: 0,
        blockedBeds: 0,
        availableRooms: b.totalRooms,
        availableBeds: b.totalBeds,
      };
    });

    const keys = Object.keys(availabilityByRoomType);
    const bedsPerRoomFor = (key: string) => {
      const v = availabilityByRoomType[key];
      if (!v) return 1;
      return Math.max(1, Math.round((v.totalBeds || 1) / Math.max(1, v.totalRooms || 1)));
    };

    // Count bookings by room type bucket
    conflictingBookings.forEach((booking) => {
      if (requestedRoomCode && requestedIsSpecificRoom && booking.roomCode !== requestedRoomCode) return;

      const mappedBucket = findBucketKey(booking.roomCode, keys);
      // When a type filter is active, a booking with an explicit roomCode that doesn't match
      // the requested type should be skipped — don't fall back to keys[0] and inflate counts.
      // Bookings with null/empty roomCode still fall back (legacy: no per-room tracking).
      const hasExplicitMismatch = !!(booking.roomCode && !mappedBucket);
      const bucket = hasExplicitMismatch
        ? null
        : (mappedBucket || (keys.length ? keys[0] : null));
      if (!bucket || !availabilityByRoomType[bucket]) return;

      const bedsPerRoom = bedsPerRoomFor(bucket);
      availabilityByRoomType[bucket].bookedRooms += 1;
      availabilityByRoomType[bucket].bookedBeds += bedsPerRoom;
    });

    // Count blocks by room type bucket (bedsBlocked represents number of rooms/beds blocked)
    availabilityBlocks.forEach((block) => {
      if (requestedRoomCode && requestedIsSpecificRoom && block.roomCode !== requestedRoomCode) return;

      const mappedBucket = findBucketKey(block.roomCode, keys);
      const hasExplicitMismatch = !!(block.roomCode && !mappedBucket);
      const bucket = hasExplicitMismatch
        ? null
        : (mappedBucket || (keys.length ? keys[0] : null));
      if (!bucket || !availabilityByRoomType[bucket]) return;

      const roomsBlocked = Number(block.bedsBlocked ?? 1) || 1;
      const bedsPerRoom = bedsPerRoomFor(bucket);
      availabilityByRoomType[bucket].blockedRooms += roomsBlocked;
      availabilityByRoomType[bucket].blockedBeds += roomsBlocked * bedsPerRoom;
    });

    // Calculate available counts
    Object.keys(availabilityByRoomType).forEach((code) => {
      const avail = availabilityByRoomType[code];
      avail.availableRooms = Math.max(0, avail.totalRooms - avail.bookedRooms - avail.blockedRooms);
      avail.availableBeds = Math.max(0, avail.totalBeds - avail.bookedBeds - avail.blockedBeds);
    });

    // Overall availability
    const totalAvailableRooms = Object.values(availabilityByRoomType).reduce(
      (sum, a) => sum + a.availableRooms,
      0
    );
    const totalAvailableBeds = Object.values(availabilityByRoomType).reduce(
      (sum, a) => sum + a.availableBeds,
      0
    );

    // An owner who closed these dates in NRMS closes them here too. Without
    // this the funnel reported free rooms and the guest was only stopped at
    // invoice creation, after filling the whole form.
    const restrictionBlocks = await findRestrictionBlocks(prisma, {
      propertyId,
      roomTypeId: await resolveRoomTypeIdForCode(prisma, propertyId, requestedRoomCode),
      checkIn,
      checkOut,
      channelCode: "NOLSAF",
    });
    const closed = restrictionBlocks[0] ?? null;

    const isAvailable = !closed && (totalAvailableRooms > 0 || totalAvailableBeds > 0);

    const payload = {
      available: isAvailable,
      // Present only when a control closed the dates, so the funnel can say why
      // rather than showing a bare "no availability" over empty rooms.
      closed: closed ? { reason: closed.code, message: closed.message } : null,
      propertyId,
      checkIn: checkIn.toISOString(),
      checkOut: checkOut.toISOString(),
      roomCode: requestedRoomCode || null,
      summary: {
        totalAvailableRooms,
        totalAvailableBeds,
        totalBookedRooms: Object.values(availabilityByRoomType).reduce((sum, a) => sum + a.bookedRooms, 0),
        totalBlockedRooms: Object.values(availabilityByRoomType).reduce((sum, a) => sum + a.blockedRooms, 0),
      },
      byRoomType: availabilityByRoomType,
      conflictingBookings: conflictingBookings.length,
      availabilityBlocks: availabilityBlocks.length,
    };

    availabilityCache.set(cacheKey, { expiresAt: Date.now() + availabilityCacheTtlMs, payload });
    if (availabilityCache.size > maxAvailabilityCacheEntries) {
      const firstKey = availabilityCache.keys().next().value;
      if (firstKey) availabilityCache.delete(firstKey);
    }

    res.json(payload);
  } catch (error: any) {
    console.error("POST /api/public/availability/check error:", error);
    res.status(500).json({ error: "Failed to check availability" });
  }
}) as RequestHandler);

export default router;



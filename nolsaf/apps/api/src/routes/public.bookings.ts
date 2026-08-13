// apps/api/src/routes/public.bookings.ts
// apps/api/src/routes/public.bookings.ts
import { Router, Request, Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { checkPropertyAvailability, checkGuestCapacity } from "../lib/bookingAvailability.js";
import { sanitizeText } from "../lib/sanitize.js";
import { maybeAuth } from "../middleware/auth.js";
import { AUTO_DISPATCH_LOOKAHEAD_MS, MIN_TRANSPORT_LEAD_MS } from "../lib/transportPolicy.js";
import { generateTransportTripCode } from "../lib/tripCode.js";
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES } from "../lib/bookingStatus.js";
import { filterPayableAvailabilityBlocks } from "../lib/groupStayAvailabilityBlocks.js";
import { isCheckInBeforeToday } from "../lib/bookingDateRules.js";
import { getNrmsCapacityConsumers } from "../lib/nrmsAvailability.js";
import { getTransportAvailability } from "../lib/serviceAvailability.js";

/** Sign a short-lived token proving the caller created this booking. */
function signBookingAccessToken(bookingId: number): string {
  const secret =
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? "dev_jwt_secret" : "");
  if (!secret) throw new Error("booking_access_secret_missing");
  return jwt.sign(
    { typ: "BOOKING_ACCESS", bookingId },
    secret,
    { expiresIn: "2h", issuer: "nolsaf-public", subject: String(bookingId) }
  );
}

async function getEffectiveCommissionPercent(params: { propertyServices: unknown }): Promise<number> {
  // Per-property override (admin sets this via /admin/properties/:id -> services.commissionPercent)
  const fromProperty = (() => {
    const services = params.propertyServices as any;
    const v = services?.commissionPercent;
    // null means "use system default" (admin chose Use System Default → stored as null).
    // Treat null/undefined the same: fall through to system default.
    if (v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  })();

  if (fromProperty != null) return fromProperty;

  // Global default (SystemSetting singleton)
  try {
    const s =
      (await prisma.systemSetting.findUnique({ where: { id: 1 }, select: { commissionPercent: true } as any })) ??
      (await prisma.systemSetting.create({ data: { id: 1 } } as any));
    const n = Number((s as any)?.commissionPercent ?? 0);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
  } catch {
    return 0;
  }
}

function formatBlockSourceSummary(blocks: Array<{ source?: string | null }>): string | null {
  const labels = new Map<string, string>();
  for (const block of blocks) {
    const source = String(block.source || "OTHER").toUpperCase();
    if (source === "GROUP_STAY") labels.set(source, "confirmed group-stay reservations");
    else if (source === "AIRBNB") labels.set(source, "Airbnb reservations");
    else if (source === "BOOKING_COM") labels.set(source, "Booking.com reservations");
    else if (source === "WALK_IN") labels.set(source, "walk-in reservations");
    else labels.set(source, "external reservations");
  }
  const unique = Array.from(labels.values());
  if (!unique.length) return null;
  if (unique.length === 1) return `Availability is held by ${unique[0]}`;
  return `Availability is held by ${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function parseBookingDate(value: string): Date {
  const trimmed = String(value || "").trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(trimmed);
}

type CreatedTransportBooking = {
  id: number;
  tripCode: string | null;
  vehicleType: string | null;
  scheduledDate: Date;
  fromAddress: string | null;
  toAddress: string | null;
  amount: number | null;
  currency: string | null;
};

// Helper function to calculate distance (Haversine formula)
function calculateDistance(origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLon = toRadians(destination.longitude - origin.longitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(origin.latitude)) *
      Math.cos(toRadians(destination.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round((R * c) * 100) / 100;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function toFiniteInt(value: unknown, fallback: number): number {
  const n = Math.floor(toFiniteNumber(value, fallback));
  return Number.isFinite(n) ? n : fallback;
}

type TransportVehicleType = "BODA" | "BAJAJI" | "CAR" | "XL" | "PREMIUM";

type VehiclePricingConfig = {
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  averageSpeedKmh: number;
};

const TRANSPORT_PRICING: Record<TransportVehicleType, VehiclePricingConfig> = {
  BODA: { baseFare: 1500, perKmRate: 350, perMinuteRate: 35, averageSpeedKmh: 35 },
  BAJAJI: { baseFare: 1800, perKmRate: 420, perMinuteRate: 40, averageSpeedKmh: 28 },
  CAR: { baseFare: 2000, perKmRate: 500, perMinuteRate: 50, averageSpeedKmh: 30 },
  XL: { baseFare: 2500, perKmRate: 650, perMinuteRate: 60, averageSpeedKmh: 30 },
  // Premium: exceptional service tier
  PREMIUM: { baseFare: 5000, perKmRate: 1200, perMinuteRate: 80, averageSpeedKmh: 30 },
};

function getTransportPricing(vehicleType: TransportVehicleType): VehiclePricingConfig {
  return TRANSPORT_PRICING[vehicleType] || TRANSPORT_PRICING.CAR;
}

function estimateTravelTimeForVehicle(distanceKm: number, vehicleType: TransportVehicleType): number {
  const cfg = getTransportPricing(vehicleType);
  const averageSpeedKmh = cfg.averageSpeedKmh || 30;
  const timeHours = distanceKm / averageSpeedKmh;
  const timeMinutes = Math.ceil(timeHours * 60);
  return Math.max(5, timeMinutes);
}

function calculateSurgeMultiplier(hourOfDay: number, dayOfWeek: number): number {
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isMorningRush = hourOfDay >= 7 && hourOfDay < 9;
  const isEveningRush = hourOfDay >= 17 && hourOfDay < 19;

  if (isWeekday && (isMorningRush || isEveningRush)) return 1.2;
  if (!isWeekday && hourOfDay >= 18 && hourOfDay < 22) return 1.15;
  return 1.0;
}

function getPricingTimeParts(date: Date, timeZone = "Africa/Dar_es_Salaam"): { hour: number; dayOfWeek: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const rawHour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);

  return {
    hour: Number.isFinite(rawHour) ? rawHour % 24 : 0,
    dayOfWeek: dayOfWeek >= 0 ? dayOfWeek : 0,
  };
}

/** Derive room-type key from roomCode (e.g. "Suite-1" -> "Suite", "Suite" -> "Suite") for capacity by type */
function roomCodeToTypeKey(roomCode: string | null | undefined): string {
  const s = String(roomCode ?? "").trim();
  if (!s) return "default";
  return s.replace(/-\d+$/, "") || s;
}

/** Derive a stable room-type key from a roomsSpec entry across differing shapes (code/roomCode/name/label/etc). */
function roomTypeKeyFromSpec(rt: any): string {
  const rawKey = String(rt?.code ?? rt?.roomCode ?? rt?.roomType ?? rt?.type ?? rt?.name ?? rt?.label ?? "").trim();
  return roomCodeToTypeKey(rawKey);
}

/** Find which availability bucket (room type) a roomCode belongs to. Uses prefix match so "Suite-1" maps to "Suite". */
function findBucketKey(roomCode: string | null | undefined, keys: string[]): string | null {
  const typeKey = roomCodeToTypeKey(roomCode);
  if (keys.includes(typeKey)) return typeKey;
  const rc = String(roomCode ?? "");
  return keys.find((k) => rc === k || (k && rc.startsWith(k + "-"))) || null;
}

function isExplicitRoomUnitCode(roomCode: string | null | undefined): boolean {
  return /-\d+$/.test(String(roomCode ?? "").trim());
}

const router = Router();

class AvailabilityConflictError extends Error {
  public readonly payload: Record<string, unknown>;
  constructor(payload: Record<string, unknown>) {
    super(String(payload.message || "Property not available for selected dates"));
    this.name = "AvailabilityConflictError";
    this.payload = payload;
  }
}

function buildPhoneVariants(phoneRaw: string | null | undefined): string[] {
  const raw = String(phoneRaw ?? "").trim();
  if (!raw) return [];

  const compact = raw.replace(/\s+/g, "").replace(/-/g, "");
  const noPlus = compact.replace(/^\+/, "");
  const digitsOnly = noPlus.replace(/\D+/g, "");

  const variants = new Set<string>([raw, compact, noPlus]);

  // Tanzania-friendly normalization: 0XXXXXXXXX <-> 255XXXXXXXXX
  if (digitsOnly.length === 9) {
    variants.add("0" + digitsOnly);
    variants.add("255" + digitsOnly);
    variants.add("+255" + digitsOnly);
  }

  if (digitsOnly.startsWith("0") && digitsOnly.length === 10) {
    const t = "255" + digitsOnly.slice(1);
    variants.add(t);
    variants.add("+" + t);
  }

  if (digitsOnly.startsWith("255") && digitsOnly.length === 12) {
    variants.add(digitsOnly);
    variants.add("+" + digitsOnly);
    variants.add("0" + digitsOnly.slice(3));
  }

  return Array.from(variants).filter(Boolean);
}

function parseOptionalDate(value: unknown): Date | null {
  if (value == null) return null;
  const d = new Date(String(value));
  return Number.isFinite(d.getTime()) ? d : null;
}

function toDecimal6(n: unknown): number | null {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 1_000_000) / 1_000_000;
}

function isLikelyDomesticTanzania(nationality: unknown): boolean {
  const n = String(nationality ?? "").trim().toLowerCase();
  if (!n) return true; // unknown => don't enforce international-only rules
  return n.includes("tanzania") || n.includes("tanzan") || n === "tz";
}

// Rate limiting for booking creation (5 requests per 15 minutes)
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5, // 5 requests per window
  message: "Too many booking requests, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation schema for booking creation
const createBookingSchema = z.object({
  propertyId: z.number().int().positive(),
  checkIn: z.string().min(1), // YYYY-MM-DD or ISO 8601 format
  checkOut: z.string().min(1),
  guestName: z.string().min(2).max(160),
  guestPhone: z.string().min(10).max(40),
  guestEmail: z.string().email().optional().nullable(),
  nationality: z.string().max(80).optional().nullable(),
  sex: z.enum(["Male", "Female", "Other"]).optional().nullable(),
  ageGroup: z.enum(["Adult", "Child"]).optional().nullable(),
  rooms: z.number().int().min(1).max(20).optional().default(1),
  roomCode: z.string().max(60).optional().nullable(),
  specialRequests: z.string().max(1000).optional().nullable(),
  adults: z.number().int().min(1).max(100).optional().default(1),
  children: z.number().int().min(0).max(100).optional().default(0),
  pets: z.number().int().min(0).max(10).optional().default(0),
  // Transportation fields
  includeTransport: z.boolean().optional().default(false),
  transportOriginLat: z.number().min(-90).max(90).optional().nullable(),
  transportOriginLng: z.number().min(-180).max(180).optional().nullable(),
  transportOriginAddress: z.string().max(255).optional().nullable(),
  transportFare: z.number().min(0).optional().nullable(), // Optional client hint; server computes authoritative fare
  transportVehicleType: z.enum(["BODA", "BAJAJI", "CAR", "XL", "PREMIUM"]).optional().nullable(),
  transportPickupMode: z.enum(["current", "arrival", "manual"]).optional().nullable(),
  // Flexible arrival fields
  arrivalType: z.enum(["FLIGHT", "BUS", "TRAIN", "FERRY", "OTHER"]).optional().nullable(),
  arrivalNumber: z.string().max(50).optional().nullable(),
  transportCompany: z.string().max(100).optional().nullable(),
  arrivalTime: z.string().datetime().optional().nullable(),
  pickupLocation: z.string().max(255).optional().nullable(),
}).superRefine((data, ctx) => {
  if (data.roomCode && isExplicitRoomUnitCode(data.roomCode) && (data.rooms ?? 1) > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["rooms"],
      message: "Multiple rooms are not supported when selecting a specific room unit",
    });
  }

  if (!data.includeTransport) return;

  if (!data.transportVehicleType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transportVehicleType"],
      message: "Transport type is required when transportation is included",
    });
  }

  if (data.transportOriginLat == null || data.transportOriginLng == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transportOriginLat"],
      message: "Pickup coordinates are required when transportation is included",
    });
  }

  const addr = String(data.transportOriginAddress ?? "").trim();
  if (!addr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transportOriginAddress"],
      message: "Pickup address is required when transportation is included",
    });
  }

  const hasArrivalMetadata =
    !!data.arrivalType ||
    !!String(data.arrivalNumber ?? "").trim() ||
    !!String(data.transportCompany ?? "").trim() ||
    !!String(data.pickupLocation ?? "").trim();

  // Arrival date/time is only required when:
  // - the user is scheduling an ARRIVAL pickup (airport/bus terminal/etc), OR
  // - they provided arrival metadata (type/company/number/pickupLocation)
  const pickupMode = String(data.transportPickupMode ?? "").trim().toLowerCase();
  const requiresArrivalTime = pickupMode === "arrival" || hasArrivalMetadata;

  if (String(data.pickupLocation ?? "").trim() && !data.arrivalType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["arrivalType"],
      message: "Arrival type is required when a specific pickup location/terminal is provided",
    });
  }

  if (requiresArrivalTime && !data.arrivalTime) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["arrivalTime"],
      message: "Arrival date/time is required to schedule pickup for international/travel bookings",
    });
  }

  if (data.arrivalType && !String(data.pickupLocation ?? "").trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pickupLocation"],
      message: "Pickup location is required when arrival type is provided",
    });
  }
});

/**
 * POST /api/public/bookings
 * Create a new booking (public endpoint, no authentication required)
 * 
 * Security:
 * - Rate limiting (5 requests per 15 minutes)
 * - Input validation
 * - Property validation (must be approved)
 * - Date validation
 * - Amount calculation (server-side only)
 */
router.post("/", bookingLimiter, maybeAuth as any, async (req: Request, res: Response) => {
  const requestId =
    (crypto as any).randomUUID?.() ||
    crypto.randomBytes(16).toString("hex");

  try {
    // Validate request body
    const validationResult = createBookingSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Invalid request data",
        details: validationResult.error.issues ?? (validationResult.error as any).errors,
        requestId,
      });
    }

    const data = validationResult.data;
  const transportPickupMode = String(data.transportPickupMode ?? "").trim().toLowerCase();

    // Validate dates
    const checkIn = parseBookingDate(data.checkIn);
    const checkOut = parseBookingDate(data.checkOut);
    const now = new Date();

    if (isNaN(checkIn.getTime()) || isNaN(checkOut.getTime())) {
      return res.status(400).json({ error: "Invalid date format", requestId });
    }

    if (isCheckInBeforeToday(checkIn, now)) {
      return res.status(400).json({ error: "Check-in date cannot be in the past", requestId });
    }

    if (checkOut <= checkIn) {
      return res.status(400).json({ error: "Check-out date must be after check-in date", requestId });
    }

    // Calculate nights
    const nights = Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
    const roomsQty = Math.max(1, Number(data.rooms ?? 1));

    // Fetch property and validate
    const property = await prisma.property.findUnique({
      where: { id: data.propertyId },
      select: {
        id: true,
        status: true,
        title: true,
        basePrice: true,
        currency: true,
        services: true,
        roomsSpec: true,
        latitude: true,
        longitude: true,
        regionName: true,
        district: true,
        ward: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    if (!property) {
      return res.status(404).json({ error: "Property not found", requestId });
    }

    if (property.status !== "APPROVED") {
      return res.status(400).json({
        error: "Property is not available for booking",
        reason: `Property status is ${property.status}`,
        requestId,
      });
    }

    // Never trust the client's disabled-toggle state — re-check the transport
    // gate for this property's region/district/ward server-side.
    if (data.includeTransport) {
      const transportGate = await getTransportAvailability(property);
      if (!transportGate.enabled) {
        return res.status(400).json({
          error: "transport_unavailable",
          message: transportGate.reason,
          requestId,
        });
      }
    }

    // Check guest capacity
    const capacityCheck = await checkGuestCapacity(
      data.propertyId,
      data.adults || 1,
      data.children || 0,
      data.pets || 0
    );
    if (!capacityCheck.canAccommodate) {
      return res.status(400).json({
        error: "Guest capacity exceeded",
        message: capacityCheck.message,
        maxGuests: capacityCheck.maxGuests,
        requestId,
      });
    }

    // Check property availability (with database lock to prevent concurrent bookings)
    // Use a transaction with SELECT FOR UPDATE to lock the property row
    // Enhanced to include availability blocks (external bookings)
    // Now checks capacity, not just conflicts (matching availability checker logic)
    const availabilityCheck = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Lock property row to prevent concurrent bookings (parameterized query for security)
      await tx.$executeRaw`
        SELECT id FROM \`property\` WHERE id = ${data.propertyId} FOR UPDATE
      `;

      // Fetch property to get room specifications
      const propertyForCheck = await tx.property.findUnique({
        where: { id: data.propertyId },
        select: {
          id: true,
          roomsSpec: true,
          totalBedrooms: true,
        },
      });

      if (!propertyForCheck) {
        return {
          available: false,
          conflictingBookings: undefined,
          conflictingBlocks: undefined,
        };
      }

      // Now check availability within the locked transaction
      // Fetch ALL overlapping bookings (no roomCode filter) so we can count by room TYPE for capacity
      const conflictingBookings = await tx.booking.findMany({
        where: {
          propertyId: data.propertyId,
          status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
          AND: [
            { checkIn: { lt: checkOut } },
            { checkOut: { gt: checkIn } },
          ],
        },
        select: {
          id: true,
          checkIn: true,
          checkOut: true,
          status: true,
          guestName: true,
          roomCode: true,
          roomsQty: true,
        },
      });

      // Check availability blocks (external bookings); fetch all overlapping to count by room TYPE
      const rawConflictingBlocks = await tx.propertyAvailabilityBlock.findMany({
        where: {
          propertyId: data.propertyId,
          AND: [
            { startDate: { lt: checkOut } },
            { endDate: { gt: checkIn } },
          ],
        },
        select: {
          id: true,
          startDate: true,
          endDate: true,
          roomCode: true,
          source: true,
          bedsBlocked: true,
          notes: true,
        },
      });
      const conflictingBlocks = await filterPayableAvailabilityBlocks(rawConflictingBlocks, tx as any);
      const nrmsConsumers = await getNrmsCapacityConsumers(tx, data.propertyId, checkIn, checkOut);
      for (const row of nrmsConsumers) {
        conflictingBlocks.push({
          id: -row.allocationId,
          startDate: row.startDate,
          endDate: row.endDate,
          roomCode: row.roomUnitCode ?? row.roomTypeName,
          source: "NRMS",
          bedsBlocked: 1,
          notes: `NRMS reservation ${row.reservationId}`,
        } as any);
      }

      // Parse roomsSpec to get room types and their capacities
      let roomTypes: Array<{ code?: string; roomCode?: string; name?: string; beds?: number; rooms?: number; roomsCount?: number }> = [];
      if (propertyForCheck.roomsSpec && typeof propertyForCheck.roomsSpec === "object") {
        const spec = propertyForCheck.roomsSpec as any;
        if (Array.isArray(spec)) {
          roomTypes = spec;
        } else if (spec.rooms && Array.isArray(spec.rooms)) {
          roomTypes = spec.rooms;
        }
      }

      // Calculate availability per room type (matching availability checker logic)
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

      // Initialize room types
      if (data.roomCode) {
        // Resolve room TYPE from roomCode: "Suite-1" -> "Suite" so we count by type for capacity
        const typeFromCode = roomCodeToTypeKey(data.roomCode);
        let roomType = roomTypes.find((rt) => roomTypeKeyFromSpec(rt) === typeFromCode);
        if (!roomType) {
          const ix = Number(data.roomCode);
          if (!isNaN(ix) && ix >= 0 && ix < roomTypes.length) roomType = roomTypes[ix];
        }
        if (!roomType) {
          roomType = roomTypes.find((rt) => {
            const x: any = rt as any;
            const c = String(x?.code ?? x?.roomCode ?? x?.roomType ?? x?.type ?? x?.name ?? x?.label ?? "").trim();
            return c && (data.roomCode === c || (data.roomCode || "").startsWith(c + "-"));
          });
        }
        if (roomType) {
          const code = roomTypeKeyFromSpec(roomType) || typeFromCode;
          const totalRooms = Math.max(1, toFiniteInt(roomType.rooms ?? roomType.roomsCount ?? 1, 1));
          const bedsPerRoom = Math.max(1, toFiniteInt((roomType as any).beds ?? 1, 1));
          availabilityByRoomType[code] = {
            totalRooms,
            totalBeds: bedsPerRoom * totalRooms,
            bookedRooms: 0,
            bookedBeds: 0,
            blockedRooms: 0,
            blockedBeds: 0,
            availableRooms: totalRooms,
            availableBeds: bedsPerRoom * totalRooms,
          };
        } else if (roomTypes.length > 0) {
          roomTypes.forEach((rt) => {
            const code = roomTypeKeyFromSpec(rt);
            if (!availabilityByRoomType[code]) {
              const totalRooms = Math.max(1, toFiniteInt(rt.rooms ?? rt.roomsCount ?? propertyForCheck.totalBedrooms ?? 1, 1));
              const bedsPerRoom = Math.max(1, toFiniteInt((rt as any).beds ?? 1, 1));
              availabilityByRoomType[code] = {
                totalRooms,
                totalBeds: bedsPerRoom * totalRooms,
                bookedRooms: 0,
                bookedBeds: 0,
                blockedRooms: 0,
                blockedBeds: 0,
                availableRooms: totalRooms,
                availableBeds: bedsPerRoom * totalRooms,
              };
            }
          });
        }
      } else {
        // Check all room types
        if (roomTypes.length > 0) {
          roomTypes.forEach((rt) => {
            const code = roomTypeKeyFromSpec(rt);
            const totalRooms = Math.max(1, toFiniteInt(rt.rooms ?? propertyForCheck.totalBedrooms ?? 1, 1));
            const bedsPerRoom = Math.max(1, toFiniteInt((rt as any).beds ?? 1, 1));
            availabilityByRoomType[code] = {
              totalRooms,
              totalBeds: bedsPerRoom * totalRooms,
              bookedRooms: 0,
              bookedBeds: 0,
              blockedRooms: 0,
              blockedBeds: 0,
              availableRooms: totalRooms,
              availableBeds: bedsPerRoom * totalRooms,
            };
          });
        } else {
          // Fallback: use totalBedrooms if no room spec
          const totalRooms = Math.max(1, toFiniteInt(propertyForCheck.totalBedrooms ?? 1, 1));
          availabilityByRoomType["default"] = {
            totalRooms,
            totalBeds: totalRooms * 2, // Assume 2 beds per room
            bookedRooms: 0,
            bookedBeds: 0,
            blockedRooms: 0,
            blockedBeds: 0,
            availableRooms: totalRooms,
            availableBeds: totalRooms * 2,
          };
        }
      }

      const bedsPerRoomFor = (key: string) => {
        const v = availabilityByRoomType[key];
        if (!v) return 1;
        return Math.max(1, Math.round((v.totalBeds || 1) / Math.max(1, v.totalRooms || 1)));
      };

      // Count bookings by room TYPE (e.g. "Suite-1","Suite-2" -> "Suite") so capacity is per type
      const keys = Object.keys(availabilityByRoomType);
      conflictingBookings.forEach((booking: any) => {
        const code = findBucketKey(booking.roomCode, keys) || (booking.roomCode ? null : keys[0] || null);
        if (code && availabilityByRoomType[code]) {
          const bedsPerRoom = bedsPerRoomFor(code);
          const bookedRooms = Math.max(1, Number((booking as any).roomsQty ?? 1));
          availabilityByRoomType[code].bookedRooms += bookedRooms;
          availabilityByRoomType[code].bookedBeds += bedsPerRoom * bookedRooms;
        }
      });

      // Count blocks by room TYPE; use bedsBlocked for rooms (not just += 1)
      conflictingBlocks.forEach((block: any) => {
        const code = findBucketKey(block.roomCode, keys) || (block.roomCode ? null : keys[0] || null);
        if (code && availabilityByRoomType[code]) {
          const roomsBlocked = Number(block.bedsBlocked ?? 1) || 1;
          const bedsPerRoom = bedsPerRoomFor(code);
          availabilityByRoomType[code].blockedRooms += roomsBlocked;
          availabilityByRoomType[code].blockedBeds += roomsBlocked * bedsPerRoom;
        }
      });

      // Calculate available counts
      Object.keys(availabilityByRoomType).forEach((code) => {
        const avail = availabilityByRoomType[code];
        avail.availableRooms = Math.max(0, avail.totalRooms - avail.bookedRooms - avail.blockedRooms);
        avail.availableBeds = Math.max(0, avail.totalBeds - avail.bookedBeds - avail.blockedBeds);
      });

      const totalAvailableRooms = Object.values(availabilityByRoomType).reduce((sum, a) => sum + (Number.isFinite(a.availableRooms) ? a.availableRooms : 0), 0);
      const totalAvailableBeds = Object.values(availabilityByRoomType).reduce((sum, a) => sum + (Number.isFinite(a.availableBeds) ? a.availableBeds : 0), 0);

      const isRoomIndexSelection = !!(data.roomCode && /^\d+$/.test(String(data.roomCode)));
      const roomCodeForBucket = (() => {
        if (!data.roomCode) return null;
        if (!isRoomIndexSelection) return data.roomCode;
        const ix = Number(data.roomCode);
        const rt = Number.isFinite(ix) && ix >= 0 && ix < roomTypes.length ? roomTypes[ix] : null;
        const derived = rt ? String((rt as any).code ?? (rt as any).roomCode ?? (rt as any).roomType ?? (rt as any).type ?? (rt as any).name ?? (rt as any).label ?? "").trim() : "";
        return derived || data.roomCode;
      })();

      // Same-room double-book only applies to explicit unit codes, not index-based type selection
      const sameRoomConflict =
        !!(
          !isRoomIndexSelection &&
          data.roomCode &&
          isExplicitRoomUnitCode(data.roomCode) &&
          (conflictingBookings.some((b: any) => b.roomCode === data.roomCode) || nrmsConsumers.some((row) => row.roomUnitCode === data.roomCode))
        );

      // Type-level capacity: when roomCode is set, the selected TYPE must have at least 1 room available
      const typeKey = data.roomCode ? findBucketKey(roomCodeForBucket, keys) : null;
      const isAvailable =
        !sameRoomConflict &&
        (data.roomCode
          ? !!(typeKey && (availabilityByRoomType[typeKey]?.availableRooms ?? 0) >= roomsQty)
          : totalAvailableRooms >= roomsQty || totalAvailableBeds > 0);

      return {
        available: isAvailable,
        conflictingBookings: conflictingBookings.length > 0 ? conflictingBookings : undefined,
        conflictingBlocks: conflictingBlocks.length > 0 ? conflictingBlocks : undefined,
        totalAvailableRooms,
        totalAvailableBeds,
        selectedRoomType: typeKey || undefined,
        availableForSelectedType: typeKey != null ? (availabilityByRoomType[typeKey]?.availableRooms ?? 0) : undefined,
      };
    });

    if (!availabilityCheck.available) {
      const conflictReasons: string[] = [];
      if (availabilityCheck.conflictingBookings && availabilityCheck.conflictingBookings.length > 0) {
        conflictReasons.push(`${availabilityCheck.conflictingBookings.length} existing booking(s)`);
      }
      if (availabilityCheck.conflictingBlocks && availabilityCheck.conflictingBlocks.length > 0) {
        const blockSummary = formatBlockSourceSummary(availabilityCheck.conflictingBlocks);
        if (blockSummary) conflictReasons.push(blockSummary);
      }

      const availableRooms = Number.isFinite(availabilityCheck.totalAvailableRooms as any) ? (availabilityCheck.totalAvailableRooms as any) : 0;
      const availableBeds = Number.isFinite(availabilityCheck.totalAvailableBeds as any) ? (availabilityCheck.totalAvailableBeds as any) : 0;

      const selType = (availabilityCheck as any).selectedRoomType;
      const selAvail = (availabilityCheck as any).availableForSelectedType;
      const typeMsg =
        selType != null && typeof selAvail === "number"
          ? selAvail < roomsQty
            ? ` Only ${selAvail} ${selType} room(s) left for this type (need ${roomsQty}).`
            : ` ${selAvail} ${selType} room(s) available for this type.`
          : "";

      const leading = (() => {
        if (selType != null && typeof selAvail === "number") {
          if (selAvail < roomsQty) return `The selected room type (${selType}) does not have enough rooms for the selected dates.`;
          return `Limited availability for the selected room type (${selType}).`;
        }
        return "The property is fully booked for the selected dates.";
      })();
      return res.status(409).json({
        error: "Property not available for selected dates",
        message: [leading + typeMsg, ...conflictReasons, `Available: ${availableRooms} rooms, ${availableBeds} beds.`].filter(Boolean).join(" "),
        selectedRoomType: selType,
        availableForSelectedType: selAvail,
        requestId,
        conflictingBookings: availabilityCheck.conflictingBookings?.map((b: any) => ({
          id: b.id,
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          status: b.status,
          roomCode: b.roomCode,
        })),
        conflictingBlocks: availabilityCheck.conflictingBlocks?.map((b: any) => ({
          id: b.id,
          startDate: b.startDate,
          endDate: b.endDate,
          roomCode: b.roomCode,
          source: b.source,
        })),
        totalAvailableRooms: availableRooms,
        totalAvailableBeds: availableBeds,
      });
    }

    // Sanitize user inputs
    const sanitizedGuestName = sanitizeText(data.guestName);
    const sanitizedGuestPhone = sanitizeText(data.guestPhone);
    const sanitizedGuestEmail = data.guestEmail ? sanitizeText(data.guestEmail) : null;
    const sanitizedNationality = data.nationality ? sanitizeText(data.nationality) : null;
    const sanitizedRoomCode = data.roomCode ? sanitizeText(data.roomCode) : null;
    const sanitizedTransportAddress = data.transportOriginAddress ? sanitizeText(data.transportOriginAddress) : null;

    // Calculate booking amount (server-side only - NEVER trust client)
    // If roomCode is provided, use that room's price from roomsSpec, otherwise use basePrice
    let pricePerNight = property.basePrice ? Number(property.basePrice) : 0;
    
    if (data.roomCode && property.roomsSpec) {
      // Parse roomsSpec to find the selected room's price
      let roomTypes: Array<any> = [];
      if (typeof property.roomsSpec === "object") {
        const spec = property.roomsSpec as any;
        if (Array.isArray(spec)) {
          roomTypes = spec;
        } else if (spec.rooms && Array.isArray(spec.rooms)) {
          roomTypes = spec.rooms;
        } else if (spec && typeof spec === "object") {
          // Some properties store rooms under different keys; flatten any arrays found.
          roomTypes = Object.values(spec)
            .filter((v: any) => Array.isArray(v))
            .flat();
        }
      }
      
      const parseRoomPrice = (value: unknown): number | null => {
        if (value == null) return null;
        if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
        const s = String(value).trim();
        if (!s) return null;
        // Accept values like "88,000".
        const n = Number(s.replace(/,/g, ""));
        return Number.isFinite(n) && n > 0 ? n : null;
      };

      // Find the selected room type (support index selection + flexible room keys)
      const roomCodeRaw = String(data.roomCode).trim();
      const asIndex = /^\d+$/.test(roomCodeRaw) ? Number(roomCodeRaw) : NaN;
      const selectedRoom = (() => {
        if (Number.isFinite(asIndex) && asIndex >= 0 && asIndex < roomTypes.length) {
          return roomTypes[asIndex];
        }

        const typeFromCode = roomCodeToTypeKey(roomCodeRaw);
        return (
          roomTypes.find((rt) => roomTypeKeyFromSpec(rt) === typeFromCode) ||
          roomTypes.find((rt) => {
            const c = String(rt?.code ?? rt?.roomCode ?? rt?.roomType ?? rt?.type ?? rt?.name ?? rt?.label ?? "").trim();
            return c && (roomCodeRaw === c || roomCodeRaw.startsWith(c + "-"));
          }) ||
          null
        );
      })();
      if (selectedRoom) {
        const roomPrice = parseRoomPrice(selectedRoom.pricePerNight ?? selectedRoom.price ?? null);
        if (roomPrice != null) pricePerNight = roomPrice;
      }
    }
    
    // Pricing model:
    // - Owner provides base/net price.
    // - Admin sets commissionPercent (per-property override or system default).
    // - Guest pays the published price (net + commission) + any optional transport fare.
    const commissionPercent = await getEffectiveCommissionPercent({ propertyServices: (property as any).services });
    const safeCommission = Number.isFinite(commissionPercent) ? Math.max(0, Math.min(100, commissionPercent)) : 0;

    const accommodationNet = pricePerNight * nights * roomsQty;
    const commissionAmount = safeCommission > 0 ? (accommodationNet * safeCommission) / 100 : 0;
    const accommodationGross = accommodationNet + commissionAmount;
    
    // Add transportation fare if included
    let transportFare = 0;
    if (data.includeTransport) {
      const vehicleType: TransportVehicleType = (data.transportVehicleType || "CAR") as TransportVehicleType;
      const cfg = getTransportPricing(vehicleType);

      // If we have coordinates + property coordinates, compute the server-side fare deterministically.
      if (
        data.transportOriginLat != null &&
        data.transportOriginLng != null &&
        property.latitude != null &&
        property.longitude != null
      ) {
        const distance = calculateDistance(
          { latitude: Number(data.transportOriginLat), longitude: Number(data.transportOriginLng) },
          { latitude: Number(property.latitude), longitude: Number(property.longitude) }
        );

        const estimatedTime = estimateTravelTimeForVehicle(distance, vehicleType);

        const pricingTime = (() => {
          if (!data.arrivalTime) return new Date();
          const d = new Date(data.arrivalTime);
          return isNaN(d.getTime()) ? new Date() : d;
        })();

        const { hour, dayOfWeek } = getPricingTimeParts(pricingTime);
        const surgeMultiplier = calculateSurgeMultiplier(hour, dayOfWeek);

        const baseFare = cfg.baseFare;
        const distanceFare = distance * cfg.perKmRate;
        const timeFare = estimatedTime * cfg.perMinuteRate;
        const subtotal = baseFare + distanceFare + timeFare;
        const computed = Math.max(baseFare, Math.ceil(subtotal * surgeMultiplier));

        // Security: never trust client pricing. Use server-computed fare.
        transportFare = computed;
      } else {
        // Property coords are missing — compute from haversine origin→origin (0 km) which gives
        // the base fare only. This is conservative but safe: never accept a client-supplied amount.
        transportFare = cfg.baseFare;
      }
    }

    const totalAmount = roundMoney(accommodationGross + transportFare);

    // Ownership linking:
    // - If authenticated, always link to the authenticated user.
    // - If not authenticated, try best-effort linking by guest contact (email/phone).
    // Security: never let guest-provided identifiers override an authenticated session.
    let userId: number | null = (req as any)?.user?.id ?? null;
    if (!userId) {
      if (data.guestEmail) {
        const user = await prisma.user.findUnique({
          where: { email: data.guestEmail },
          select: { id: true },
        });
        if (user) userId = user.id;
      }

      // Fallback: link by phone when email is missing or doesn't match
      if (!userId && (sanitizedGuestPhone || data.guestPhone)) {
        const phoneVariants = buildPhoneVariants((sanitizedGuestPhone || data.guestPhone) as any);
        if (phoneVariants.length) {
          const user = await prisma.user.findFirst({
            where: {
              phone: { in: phoneVariants },
            },
            select: { id: true },
          });

          if (user) userId = user.id;
        }
      }
    }

    // Create booking and booking code in a transaction with row-level locking
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Keep transport booking details so we can emit realtime offers AFTER the transaction commits.
      let transportBookingForOffer: CreatedTransportBooking | null = null;

      // Double-check availability with lock (prevent race conditions)
      await tx.$executeRaw`
        SELECT id FROM \`property\` WHERE id = ${data.propertyId} FOR UPDATE
      `;

      // Final availability check: fetch ALL overlapping to count by room TYPE
      const finalConflictingBookings = await tx.booking.findMany({
        where: {
          propertyId: data.propertyId,
          status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
          AND: [{ checkIn: { lt: checkOut } }, { checkOut: { gt: checkIn } }],
        },
      });

      const rawFinalConflictingBlocks = await tx.propertyAvailabilityBlock.findMany({
        where: {
          propertyId: data.propertyId,
          AND: [{ startDate: { lt: checkOut } }, { endDate: { gt: checkIn } }],
        },
      });
      const finalConflictingBlocks = await filterPayableAvailabilityBlocks(rawFinalConflictingBlocks, tx as any);
      const finalNrmsConsumers = await getNrmsCapacityConsumers(tx, data.propertyId, checkIn, checkOut);
      for (const row of finalNrmsConsumers) {
        finalConflictingBlocks.push({
          id: -row.allocationId,
          startDate: row.startDate,
          endDate: row.endDate,
          roomCode: row.roomUnitCode ?? row.roomTypeName,
          source: "NRMS",
          bedsBlocked: 1,
          notes: `NRMS reservation ${row.reservationId}`,
        } as any);
      }

      // Fetch property to check capacity (matching availability checker logic)
      const propertyForFinalCheck = await tx.property.findUnique({
        where: { id: data.propertyId },
        select: {
          roomsSpec: true,
          totalBedrooms: true,
        },
      });

      if (!propertyForFinalCheck) {
        throw new Error("Property not found");
      }

      // Parse roomsSpec to get room types and their capacities
      let roomTypes: Array<{ code?: string; roomCode?: string; name?: string; beds?: number; rooms?: number; roomsCount?: number }> = [];
      if (propertyForFinalCheck.roomsSpec && typeof propertyForFinalCheck.roomsSpec === "object") {
        const spec = propertyForFinalCheck.roomsSpec as any;
        if (Array.isArray(spec)) {
          roomTypes = spec;
        } else if (spec.rooms && Array.isArray(spec.rooms)) {
          roomTypes = spec.rooms;
        }
      }

      // Calculate availability per room type
      const finalAvailabilityByRoomType: Record<string, {
        totalRooms: number;
        totalBeds: number;
        bookedRooms: number;
        bookedBeds: number;
        blockedRooms: number;
        blockedBeds: number;
        availableRooms: number;
        availableBeds: number;
      }> = {};

      // Initialize room types (type-level key so "Suite-1"/"Suite-2" count toward "Suite")
      if (data.roomCode) {
        const typeFromCode = roomCodeToTypeKey(data.roomCode);
        let roomType = roomTypes.find((rt) => roomTypeKeyFromSpec(rt) === typeFromCode);
        if (!roomType) {
          const ix = Number(data.roomCode);
          if (!isNaN(ix) && ix >= 0 && ix < roomTypes.length) roomType = roomTypes[ix];
        }
        if (!roomType) {
          roomType = roomTypes.find((rt) => {
            const x: any = rt as any;
            const c = String(x?.code ?? x?.roomCode ?? x?.roomType ?? x?.type ?? x?.name ?? x?.label ?? "").trim();
            return c && (data.roomCode === c || (data.roomCode || "").startsWith(c + "-"));
          });
        }
        if (roomType) {
          const code = roomTypeKeyFromSpec(roomType) || typeFromCode;
          const totalRooms = Math.max(1, toFiniteInt(roomType.rooms ?? roomType.roomsCount ?? 1, 1));
          const bedsPerRoom = Math.max(1, toFiniteInt((roomType as any).beds ?? 1, 1));
          finalAvailabilityByRoomType[code] = {
            totalRooms,
            totalBeds: bedsPerRoom * totalRooms,
            bookedRooms: 0,
            bookedBeds: 0,
            blockedRooms: 0,
            blockedBeds: 0,
            availableRooms: totalRooms,
            availableBeds: bedsPerRoom * totalRooms,
          };
        } else if (roomTypes.length > 0) {
          roomTypes.forEach((rt) => {
            const code = roomTypeKeyFromSpec(rt);
            if (!finalAvailabilityByRoomType[code]) {
              const totalRooms = Math.max(1, toFiniteInt(rt.rooms ?? rt.roomsCount ?? propertyForFinalCheck.totalBedrooms ?? 1, 1));
              const bedsPerRoom = Math.max(1, toFiniteInt((rt as any).beds ?? 1, 1));
              finalAvailabilityByRoomType[code] = {
                totalRooms,
                totalBeds: bedsPerRoom * totalRooms,
                bookedRooms: 0,
                bookedBeds: 0,
                blockedRooms: 0,
                blockedBeds: 0,
                availableRooms: totalRooms,
                availableBeds: bedsPerRoom * totalRooms,
              };
            }
          });
        }
      } else {
        if (roomTypes.length > 0) {
          roomTypes.forEach((rt) => {
            const code = roomTypeKeyFromSpec(rt);
            const totalRooms = Math.max(1, toFiniteInt(rt.rooms ?? propertyForFinalCheck.totalBedrooms ?? 1, 1));
            const bedsPerRoom = Math.max(1, toFiniteInt((rt as any).beds ?? 1, 1));
            finalAvailabilityByRoomType[code] = {
              totalRooms,
              totalBeds: bedsPerRoom * totalRooms,
              bookedRooms: 0,
              bookedBeds: 0,
              blockedRooms: 0,
              blockedBeds: 0,
              availableRooms: totalRooms,
              availableBeds: bedsPerRoom * totalRooms,
            };
          });
        } else {
          const totalRooms = Math.max(1, toFiniteInt(propertyForFinalCheck.totalBedrooms ?? 1, 1));
          finalAvailabilityByRoomType["default"] = {
            totalRooms,
            totalBeds: totalRooms * 2,
            bookedRooms: 0,
            bookedBeds: 0,
            blockedRooms: 0,
            blockedBeds: 0,
            availableRooms: totalRooms,
            availableBeds: totalRooms * 2,
          };
        }
      }

      const finalBedsPerRoomFor = (key: string) => {
        const v = finalAvailabilityByRoomType[key];
        if (!v) return 1;
        return Math.max(1, Math.round((v.totalBeds || 1) / Math.max(1, v.totalRooms || 1)));
      };

      // Count by room TYPE; blocks use bedsBlocked for rooms
      const finalKeys = Object.keys(finalAvailabilityByRoomType);
      finalConflictingBookings.forEach((booking: any) => {
        const code = findBucketKey(booking.roomCode, finalKeys) || (booking.roomCode ? null : finalKeys[0] || null);
        if (code && finalAvailabilityByRoomType[code]) {
          const bedsPerRoom = finalBedsPerRoomFor(code);
          const bookedRooms = Math.max(1, Number((booking as any).roomsQty ?? 1));
          finalAvailabilityByRoomType[code].bookedRooms += bookedRooms;
          finalAvailabilityByRoomType[code].bookedBeds += bedsPerRoom * bookedRooms;
        }
      });
      finalConflictingBlocks.forEach((block: any) => {
        const code = findBucketKey(block.roomCode, finalKeys) || (block.roomCode ? null : finalKeys[0] || null);
        if (code && finalAvailabilityByRoomType[code]) {
          const roomsBlocked = Number(block.bedsBlocked ?? 1) || 1;
          const bedsPerRoom = finalBedsPerRoomFor(code);
          finalAvailabilityByRoomType[code].blockedRooms += roomsBlocked;
          finalAvailabilityByRoomType[code].blockedBeds += roomsBlocked * bedsPerRoom;
        }
      });

      Object.keys(finalAvailabilityByRoomType).forEach((code) => {
        const avail = finalAvailabilityByRoomType[code];
        avail.availableRooms = Math.max(0, avail.totalRooms - avail.bookedRooms - avail.blockedRooms);
        avail.availableBeds = Math.max(0, avail.totalBeds - avail.bookedBeds - avail.blockedBeds);
      });

      const finalTotalAvailableRooms = Object.values(finalAvailabilityByRoomType).reduce((sum, a) => sum + (Number.isFinite(a.availableRooms) ? a.availableRooms : 0), 0);
      const finalTotalAvailableBeds = Object.values(finalAvailabilityByRoomType).reduce((sum, a) => sum + (Number.isFinite(a.availableBeds) ? a.availableBeds : 0), 0);

      const finalIsRoomIndexSelection = !!(data.roomCode && /^\d+$/.test(String(data.roomCode)));
      const finalRoomCodeForBucket = (() => {
        if (!data.roomCode) return null;
        if (!finalIsRoomIndexSelection) return data.roomCode;
        const ix = Number(data.roomCode);
        const rt = Number.isFinite(ix) && ix >= 0 && ix < roomTypes.length ? roomTypes[ix] : null;
        const derived = rt ? String((rt as any).code ?? (rt as any).roomCode ?? (rt as any).roomType ?? (rt as any).type ?? (rt as any).name ?? (rt as any).label ?? "").trim() : "";
        return derived || data.roomCode;
      })();

      const finalSameRoom =
        !!(
          !finalIsRoomIndexSelection &&
          data.roomCode &&
          isExplicitRoomUnitCode(data.roomCode) &&
          (finalConflictingBookings.some((b: any) => b.roomCode === data.roomCode) || finalNrmsConsumers.some((row) => row.roomUnitCode === data.roomCode))
        );
      const finalTypeKey = data.roomCode ? findBucketKey(finalRoomCodeForBucket, finalKeys) : null;
      const finalTypeOk = data.roomCode ? !!(finalTypeKey && (finalAvailabilityByRoomType[finalTypeKey]?.availableRooms ?? 0) >= roomsQty) : true;
      const finalTotalOk = finalTotalAvailableRooms >= roomsQty || finalTotalAvailableBeds > 0;

      if (finalSameRoom || !finalTypeOk || !finalTotalOk) {
        const selAvail = finalTypeKey != null ? (finalAvailabilityByRoomType[finalTypeKey]?.availableRooms ?? 0) : undefined;
        throw new AvailabilityConflictError({
          error: "Property not available for selected dates",
          code: "AVAILABILITY_CONFLICT",
          message: "The property is no longer available for those dates. Please choose different dates and try again.",
          selectedRoomType: finalTypeKey || undefined,
          availableForSelectedType: typeof selAvail === "number" ? selAvail : undefined,
          totalAvailableRooms: finalTotalAvailableRooms,
          totalAvailableBeds: finalTotalAvailableBeds,
        });
      }

      // Ensure we have a userId when transport is included (TransportBooking requires userId)
      if (data.includeTransport && !userId) {
        if (sanitizedGuestEmail) {
          const u = await tx.user.findUnique({ where: { email: sanitizedGuestEmail }, select: { id: true } });
          if (u) userId = u.id;
        }

        if (!userId && sanitizedGuestPhone) {
          const phoneVariants = buildPhoneVariants(sanitizedGuestPhone);
          const u = await tx.user.findFirst({
            where: { phone: { in: phoneVariants } },
            select: { id: true },
          });
          if (u) userId = u.id;
        }

        if (!userId) {
          // Create a minimal customer record so transport requests can be linked correctly.
          const created = await tx.user.create({
            data: {
              role: "CUSTOMER",
              name: sanitizedGuestName,
              fullName: sanitizedGuestName,
              email: sanitizedGuestEmail,
              phone: sanitizedGuestPhone,
              kycStatus: "PENDING_KYC",
            } as any,
            select: { id: true },
          });
          userId = created.id;
        }
      }

      const transportSummary = (() => {
        if (!data.includeTransport) return null;

        // Instant pickup (current/manual) should be scheduled immediately.
        // Arrival pickup schedules against arrivalTime (fallback: check-in).
        const scheduledRaw =
          transportPickupMode === "current" || transportPickupMode === "manual"
            ? new Date()
            : parseOptionalDate(data.arrivalTime) || checkIn;
        const minLeadMs = MIN_TRANSPORT_LEAD_MS;
        const effectiveScheduled =
          scheduledRaw.getTime() >= Date.now() + minLeadMs
            ? scheduledRaw
            : new Date(Date.now() + minLeadMs);

        const title = sanitizeText(String((property as any).title || "")) || "";
        const ward = sanitizeText(String((property as any).ward || "")) || "";
        const district = sanitizeText(String((property as any).district || "")) || "";
        const region = sanitizeText(String((property as any).regionName || "")) || "";
        const street = sanitizeText(String((property as any).street || "")) || "";
        const city = sanitizeText(String((property as any).city || "")) || "";

        const parts = [title, street, ward, district, region, city].filter((p) => !!p);
        const toAddressLabel = (parts.join(" - ") || title).slice(0, 255) || null;

        return {
          effectiveScheduled,
          toAddressLabel,
        };
      })();

      // Create booking with sanitized data
      const booking = await tx.booking.create({
        data: {
          propertyId: data.propertyId,
          userId: userId,
          status: "NEW",
          checkIn: checkIn,
          checkOut: checkOut,
          totalAmount: totalAmount,
          roomsQty: roomsQty,
          roomCode: sanitizedRoomCode,
          guestName: sanitizedGuestName,
          guestPhone: sanitizedGuestPhone,
          nationality: sanitizedNationality,
          sex: data.sex || null,
          ageGroup: data.ageGroup || null,
          includeTransport: !!data.includeTransport,
          transportVehicleType: data.includeTransport ? String(data.transportVehicleType || "CAR") : null,
          transportScheduledDate: data.includeTransport ? (transportSummary?.effectiveScheduled ?? null) : null,
          transportOriginAddress: data.includeTransport ? sanitizedTransportAddress : null,
          transportFare: data.includeTransport ? (transportFare as any) : null,
        },
      });

      // Persist scheduled transport request (hidden from drivers until payment is confirmed)
      if (data.includeTransport && userId) {
        const effectiveScheduled = transportSummary?.effectiveScheduled ?? (parseOptionalDate(data.arrivalTime) || checkIn);

        const fromLat = toDecimal6(data.transportOriginLat);
        const fromLng = toDecimal6(data.transportOriginLng);
        const toLat = toDecimal6((property as any).latitude);
        const toLng = toDecimal6((property as any).longitude);

        let created = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          const { tripCode, tripCodeHash } = generateTransportTripCode();

          try {
            const tb = await tx.transportBooking.create({
              data: {
            userId,
            propertyId: data.propertyId,
            // Transport booking is held as PAYMENT_PENDING until the invoice is paid.
            // The webhook handler (webhooks.payments.ts markInvoicePaid) upgrades
            // PAYMENT_PENDING → PENDING_ASSIGNMENT once AzamPay confirms the payment.
            status: "PAYMENT_PENDING",
            scheduledDate: effectiveScheduled,
            fromLatitude: fromLat as any,
            fromLongitude: fromLng as any,
            fromAddress: sanitizedTransportAddress,
            toLatitude: toLat as any,
            toLongitude: toLng as any,
            toAddress: transportSummary?.toAddressLabel ?? (sanitizeText(String((property as any).title || "")) || null),
            vehicleType: (data.transportVehicleType || "CAR") as any,
            amount: transportFare as any,
            currency: (property as any).currency || "TZS",
            arrivalType: (data.arrivalType as any) || null,
            arrivalNumber: data.arrivalNumber ? sanitizeText(data.arrivalNumber) : null,
            transportCompany: data.transportCompany ? sanitizeText(data.transportCompany) : null,
            arrivalTime: parseOptionalDate(data.arrivalTime),
            pickupLocation: data.pickupLocation ? sanitizeText(data.pickupLocation) : null,
            numberOfPassengers: Math.max(1, Number(data.adults || 1) + Number(data.children || 0)),
            notes: sanitizeText(
              `NoLSAF Auction Policy: Claim only if you can commit to the pickup time. No-shows/cancellations after claiming may affect your driver rating.`
            ),
            paymentStatus: "UNPAID",
            paymentRef: `BOOKING:${booking.id}`,
            tripCode,
            tripCodeHash,
          } as any,
            });

            transportBookingForOffer = {
              id: Number((tb as any).id),
              tripCode: ((tb as any).tripCode ?? null) as any,
              vehicleType: ((tb as any).vehicleType ?? null) as any,
              scheduledDate: new Date((tb as any).scheduledDate),
              fromAddress: ((tb as any).fromAddress ?? null) as any,
              toAddress: ((tb as any).toAddress ?? null) as any,
              amount: (tb as any).amount != null ? Number((tb as any).amount) : null,
              currency: ((tb as any).currency ?? null) as any,
            };
            created = true;
            break;
          } catch (e: any) {
            const isUnique = e?.code === "P2002" || String(e?.message ?? "").includes("Unique constraint");
            if (isUnique && attempt < 4) continue;
            throw e;
          }
        }

        if (!created) {
          throw new Error("Failed to create transport booking (trip code generation)");
        }
      }

      return {
        bookingId: booking.id,
        totalAmount: totalAmount,
        accommodationAmount: roundMoney(accommodationGross),
        transportFare: transportFare,
        nights: nights,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        transportBookingForOffer,
      };
    });

    // NOTE: do not broadcast transport offers here.
    // The transport auto-dispatch worker issues targeted offers (top drivers) based on live locations.

    // Publish only availability holds for unpaid bookings.
    // Owner/admin booking notifications and check-in codes are sent after payment succeeds.
    try {
      const io = (req.app.get("io") as any) || (global as any).io;
      const checkInShort = result.checkIn?.toISOString?.().slice(0, 10) || "";
      const checkOutShort = result.checkOut?.toISOString?.().slice(0, 10) || "";

      // Real-time availability refresh for owner UI + public availability listeners
      try {
        io?.to?.(`property:${property.id}:availability`)?.emit?.("availability:update", {
          event: "booking_created",
          propertyId: property.id,
          data: {
            bookingId: result.bookingId,
            checkIn: checkInShort,
            checkOut: checkOutShort,
            status: "NEW",
          },
          timestamp: new Date().toISOString(),
        });
        io?.to?.(`property:${property.id}:availability:public`)?.emit?.("availability:update", {
          event: "booking_created",
          propertyId: property.id,
          data: {
            bookingId: result.bookingId,
            checkIn: checkInShort,
            checkOut: checkOutShort,
            status: "NEW",
          },
          timestamp: new Date().toISOString(),
        });
      } catch {}
    } catch {}

    // NOTE: Confirmation email (with PDF receipts) and SMS are sent AFTER payment is confirmed.
    // See: webhooks.payments.ts — the AzamPay SUCCESS handler sends the full confirmation.
    // Sending here would fire before the guest pays, which is incorrect.

    // Return success response
    return res.status(201).json({
      ok: true,
      bookingId: result.bookingId,
      // Short-lived proof-of-creation token. Required by POST /api/public/invoices/from-booking
      // to prevent sequential-ID enumeration of other users' bookings.
      bookingAccessToken: signBookingAccessToken(result.bookingId),
      bookingCode: null,
      totalAmount: result.totalAmount,
      accommodationAmount: result.accommodationAmount,
      transportFare: result.transportFare,
      nights: result.nights,
      checkIn: result.checkIn.toISOString(),
      checkOut: result.checkOut.toISOString(),
      currency: property.currency || "TZS",
      requestId,
      property: {
        id: property.id,
        title: property.title,
      },
      message: "Booking created successfully",
    });
  } catch (error: any) {
    console.error("POST /api/public/bookings error:", error);
    console.error("Error details:", {
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    });

    if (error instanceof AvailabilityConflictError) {
      return res.status(409).json({
        ...(error.payload || {}),
        requestId,
      });
    }

    // Availability may disappear during the final locked transaction.
    // Treat this as a booking conflict (409) so the client can block checkout.
    const msg = String(error?.message || "");
    if (
      msg.includes("became unavailable") ||
      msg.includes("no capacity remaining") ||
      msg.includes("fully booked")
    ) {
      return res.status(409).json({
        error: "Property not available for selected dates",
        code: "AVAILABILITY_CONFLICT",
        message: "The property is no longer available for those dates. Please choose different dates and try again.",
        requestId,
      });
    }

    // Handle Prisma errors
    if (error?.code === "P2002") {
      return res.status(409).json({ 
        error: "Booking conflict detected",
        message: "A booking with similar details already exists",
        requestId,
      });
    }

    // Handle validation errors
    if (error?.name === "ZodError") {
      return res.status(400).json({
        error: "Invalid request data",
        details: error.issues,
        requestId,
      });
    }

    // Generic error response (include message in development for debugging)
    return res.status(500).json({
      error: "Failed to create booking",
      message: process.env.NODE_ENV === "development" ? error?.message : "An unexpected error occurred. Please try again.",
      ...(process.env.NODE_ENV === "development" && { 
        details: {
          code: error?.code,
          name: error?.name,
        }
      }),
      requestId,
    });
  }
});

/**
 * GET /api/public/bookings/:id
 * Get booking details by ID (public, but limited information)
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const bookingId = Number(req.params.id);
    const bookingCode = String(req.query.bookingCode || "").trim().toUpperCase();
    if (!bookingId || isNaN(bookingId)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    if (!bookingCode) {
      return res.status(400).json({ error: "Booking code is required" });
    }

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        property: {
          select: {
            id: true,
            title: true,
            type: true,
            regionName: true,
            district: true,
            city: true,
            country: true,
          },
        },
        code: {
          select: {
            code: true,
            status: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (!booking.code?.code || booking.code.code.toUpperCase() !== bookingCode) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const nights = Math.ceil(
      (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) /
        (1000 * 60 * 60 * 24)
    );

    return res.json({
      ok: true,
      booking: {
        id: booking.id,
        bookingCode: booking.code?.code || null,
        guestName: booking.guestName,
        guestPhone: booking.guestPhone,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        nights: nights,
        totalAmount: Number(booking.totalAmount),
        status: booking.status,
        property: booking.property,
      },
    });
  } catch (error: any) {
    console.error("GET /api/public/bookings/:id error:", error);
    return res.status(500).json({ error: "Failed to retrieve booking" });
  }
});

export default router;


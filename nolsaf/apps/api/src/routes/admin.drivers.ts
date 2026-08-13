// apps/api/src/routes/admin.drivers.ts
import { Router, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { Prisma } from "@prisma/client";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { hashTripCode, normalizeTripCode } from "../lib/tripCode.js";
import { sendSms } from "../lib/sms.js";
import { sendMail } from "../lib/mailer.js";
import { baseEmail, infoCard, calloutBox, ctaButton, BRAND_TEAL, BRAND_DARK } from "../lib/emailBase.js";
import { buildDriverCaseRef } from "../lib/driverCaseRef.js";
import { isTrustedUserDocumentUrl, sanitizeUserDocument } from "../lib/userDocumentSecurity.js";
import { revokeUserAuthorization } from "../lib/authorizationInvalidation.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

const adminRateKey = (req: any) => {
  const id = req?.user?.id;
  if (id != null) return `admin:${String(id)}`;
  return req.ip || req.socket?.remoteAddress || "unknown";
};

// Admin pages can be chatty (polling, filtering). Keep this permissive but not unlimited.
const limitAdminTripsRead = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminRateKey,
  message: { error: "Too many requests. Please wait a moment and try again." },
});

// Writes should be significantly tighter.
const limitAdminTripsWrite = rateLimit({
  windowMs: 10 * 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminRateKey,
  message: { error: "Too many admin actions. Please wait and try again." },
});

// Trip-code lookups are sensitive and should be tighter.
const limitAdminTripCodeLookup = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: adminRateKey,
  message: { error: "Too many lookups. Please wait and try again." },
});

/**
 * GET /admin/drivers/trips/lookup-by-code?tripCode=TRP_.....
 * Used for reconciliation: verify a code maps to a real transport booking.
 */
router.get("/trips/lookup-by-code", limitAdminTripCodeLookup, async (req, res) => {
  try {
    const raw = String((req.query as any)?.tripCode ?? "");
    const tripCode = normalizeTripCode(raw);
    if (!tripCode || !tripCode.startsWith("TRP_")) {
      return res.status(400).json({ error: "invalid_trip_code" });
    }

    if (!(prisma as any).transportBooking) return res.status(404).json({ error: "not_found" });

    const tripCodeHash = hashTripCode(tripCode);

    const booking =
      (await (prisma as any).transportBooking.findFirst({
        where: {
          OR: [{ tripCodeHash }, { tripCode }],
        },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          driver: { select: { id: true, name: true, email: true, phone: true } },
          property: { select: { id: true, title: true, regionName: true, district: true } },
        },
      })) ?? null;

    // Best-effort audit trail
    try {
      const adminId = Number((req as any)?.user?.id);
      await (prisma as any).adminAudit?.create?.({
        data: {
          adminId: Number.isFinite(adminId) ? adminId : null,
          targetUserId: booking?.driverId ?? null,
          action: "TRANSPORT_TRIP_CODE_LOOKUP",
          details: { tripCode, found: !!booking, bookingId: booking?.id ?? null },
        },
      });
    } catch {
      // ignore
    }

    if (!booking) return res.status(404).json({ error: "not_found" });

    return res.json({
      booking: {
        id: booking.id,
        tripCode: booking.tripCode || null,
        scheduledAt: (booking.scheduledDate ?? booking.createdAt)?.toISOString?.() ?? String(booking.scheduledDate ?? booking.createdAt ?? ""),
        vehicleType: booking.vehicleType ?? null,
        amount: booking.amount != null ? Number(booking.amount) : 0,
        currency: booking.currency ?? "TZS",
        status: booking.status ?? null,
        paymentStatus: booking.paymentStatus ?? null,
        paymentRef: booking.paymentRef ?? null,
        pickup: booking.fromAddress ?? null,
        dropoff: booking.toAddress ?? null,
        passenger: booking.user ?? null,
        driver: booking.driver ?? null,
        property: booking.property ?? null,
        createdAt: booking.createdAt ? new Date(booking.createdAt).toISOString() : null,
      },
    });
  } catch (err) {
    console.error("GET /admin/drivers/trips/lookup-by-code error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const normalizeSearchTerm = (v: unknown, maxLen = 80) =>
  String(v ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLen);

const normalizeReason = (v: unknown, maxLen = 500) => {
  const s = String(v ?? "")
    .replace(/\u0000/g, "")
    .trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
};

const sanitizeFieldApprovals = (v: unknown) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;

  const allowedKeys = new Set([
    "name", "email", "phone", "gender", "nationality", "dateOfBirth", "nin",
    "region", "district", "operationArea",
    "vehicleType", "plateNumber", "licenseNumber",
    "paymentPhone",
    "drivingLicense", "nationalId", "latra", "insurance",
  ]);
  const allowedValues = new Set(["approved", "flagged"]);

  const cleaned = Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([key, value]) => allowedKeys.has(key) && allowedValues.has(String(value)))
      .map(([key, value]) => [key, String(value)])
  );

  return Object.keys(cleaned).length > 0 ? cleaned : null;
};

type DriverEligibilityResult = { eligible: boolean; reasons: string[] };

const normalizeArea = (v: unknown) => String(v ?? "").trim().toLowerCase();
const parseAreas = (v: unknown) =>
  String(v ?? "")
    .split(/[;,|]/g)
    .map((x) => normalizeArea(x))
    .filter(Boolean);

const allowedAreasForDriver = (driver: any) => {
  const areas = new Set<string>();
  const region = normalizeArea(driver?.region);
  if (region) areas.add(region);
  for (const a of parseAreas(driver?.operationArea)) areas.add(a);
  return Array.from(areas);
};

const bookingAreasForBooking = (booking: any) =>
  [normalizeArea(booking?.fromRegion), normalizeArea(booking?.toRegion), normalizeArea(booking?.property?.regionName)].filter(Boolean);

const isAreaMatch = (driver: any, booking: any) => {
  const allowed = allowedAreasForDriver(driver);
  const bookingAreas = bookingAreasForBooking(booking);
  if (!bookingAreas.length) return true; // can't enforce if booking has no region data
  if (!allowed.length) return false;
  return bookingAreas.some((a) => allowed.includes(a));
};

const normalizeVehicleType = (v: unknown): "BODA" | "BAJAJI" | "CAR" | "XL" | "PREMIUM" | null => {
  const s = String(v ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("premium") || s.includes("vip")) return "PREMIUM";
  if (s.includes("motor") || s.includes("boda") || s.includes("bike")) return "BODA";
  if (s.includes("tuktuk") || s.includes("bajaji") || s.includes("tuk") || s.includes("auto")) return "BAJAJI";
  if (s.includes("xl") || s.includes("van") || s.includes("hiace") || s.includes("coaster") || s.includes("minibus")) return "XL";
  if (s.includes("car") || s.includes("sedan") || s.includes("suv")) return "CAR";
  return null;
};

const isDriverAvailable = (driver: any) => {
  if (driver?.available === false) return false;
  return true;
};

const driverEligibilityForBooking = (driver: any, booking: any): DriverEligibilityResult => {
  const reasons: string[] = [];

  if (!driver) return { eligible: false, reasons: ["Driver not found"] };
  if (String(driver?.role ?? "").toUpperCase() !== "DRIVER") reasons.push("Not a driver");
  if (driver?.isDisabled) reasons.push("Driver disabled");
  if (driver?.suspendedAt) reasons.push("Driver suspended");
  if (!isDriverAvailable(driver)) reasons.push("Driver unavailable");

  const bookingVehicleType = String(booking?.vehicleType ?? "").toUpperCase().trim();
  if (bookingVehicleType === "PREMIUM" && !Boolean(driver?.isVipDriver)) reasons.push("VIP required");
  if (bookingVehicleType && ["BODA", "BAJAJI", "CAR", "XL"].includes(bookingVehicleType)) {
    const driverNorm = normalizeVehicleType(driver?.vehicleType);
    if (!driverNorm) reasons.push("Vehicle type not set");
    else if (driverNorm !== bookingVehicleType) reasons.push("Vehicle mismatch");
  }

  if (!isAreaMatch(driver, booking)) reasons.push("Outside service area");

  return { eligible: reasons.length === 0, reasons };
};

/** GET /admin/drivers/bonuses/drivers
 * Returns drivers that have bonus history (auto-filter for the bonuses page)
 */
router.get("/bonuses/drivers", async (req, res) => {
  try {
    const take = Math.min(Number((req.query as any).take || 500), 1000);

    let driverIds: number[] = [];

    // Preferred source: AdminAudit bonus grants
    try {
      const rows = await prisma.adminAudit.findMany({
        where: {
          action: "GRANT_BONUS",
          targetUserId: { not: null },
        },
        distinct: ["targetUserId"],
        select: { targetUserId: true },
        orderBy: { createdAt: "desc" },
        take,
      });

      driverIds = rows
        .map((r: any) => Number(r.targetUserId))
        .filter((id: number) => Number.isFinite(id) && id > 0);
    } catch (e) {
      console.warn("AdminAudit distinct targetUserId failed for bonuses/drivers", e);
    }

    // Fallback: Bonus table (if present)
    if (driverIds.length === 0) {
      try {
        if ((prisma as any).bonus) {
          const rows = await (prisma as any).bonus.findMany({
            distinct: ["driverId"],
            select: { driverId: true },
            orderBy: { createdAt: "desc" },
            take,
          });
          driverIds = rows
            .map((r: any) => Number(r.driverId))
            .filter((id: number) => Number.isFinite(id) && id > 0);
        }
      } catch (e) {
        console.warn("Bonus table distinct driverId failed for bonuses/drivers", e);
      }
    }

    if (driverIds.length === 0) {
      return res.json({ items: [], total: 0 });
    }

    const drivers = await prisma.user.findMany({
      where: { id: { in: driverIds }, role: "DRIVER" },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });

    return res.json({ items: drivers, total: drivers.length });
  } catch (err: any) {
    console.error("Unhandled error in GET /admin/drivers/bonuses/drivers:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /admin/drivers?q=&status=&page=&pageSize= */
router.get("/", async (req, res) => {
  try {
    const { q = "", status = "", page = "1", pageSize = "50" } = req.query as any;

    const where: any = { role: "DRIVER" };
    if (q) {
      where.OR = [
        // MySQL doesn't support `mode: "insensitive"`, so use plain contains
        { name: { contains: q } },
        { email: { contains: q } },
        { phone: { contains: q } },
      ];
    }
    if (status) {
      if (status === "SUSPENDED") where.suspendedAt = { not: null };
      if (status === "ACTIVE") {
        where.suspendedAt = null;
        where.isDisabled = false;
      }
      if (status === "DISABLED") where.isDisabled = true;
      if (status === "UNAVAILABLE") {
        where.AND = [
          { suspendedAt: null },
          { isDisabled: false },
          { OR: [{ available: false }, { isAvailable: false }] },
        ];
      }
      if (status === "PENDING_KYC") where.kycStatus = "PENDING_KYC";
      if (status === "APPROVED_KYC") {
        where.kycStatus = "APPROVED_KYC";
        where.suspendedAt = null;
      }
      if (status === "REJECTED_KYC") {
        where.kycStatus = "REJECTED_KYC";
        where.suspendedAt = null;
      }
      if (status === "REVOKED") where.suspendedAt = { not: null };
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    // Try querying without _count first to see if that's the issue
    let items: any[];
    let total: number;
    
    try {
      [items, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true, 
            name: true, 
            email: true, 
            phone: true,
            suspendedAt: true,
            isDisabled: true,
            available: true,
            isAvailable: true,
            isVipDriver: true,
            kycStatus: true,
            rating: true,
            vehicleType: true,
            plateNumber: true,
            operationArea: true,
            region: true,
            district: true,
            createdAt: true,
          },
          orderBy: { id: "desc" },
          skip, 
          take,
        }),
        prisma.user.count({ where }),
      ]);
      
    } catch (queryErr: any) {
      console.error('[GET /admin/drivers] Query error:', queryErr);
      // If the rich query fails, keep the same filters and retry with a reduced field set.
      try {
        [items, total] = await Promise.all([
          prisma.user.findMany({
            where,
            select: {
              id: true, 
              name: true, 
              email: true, 
              phone: true,
              suspendedAt: true,
              isDisabled: true,
              available: true,
              isAvailable: true,
              isVipDriver: true,
              kycStatus: true,
              rating: true,
              vehicleType: true,
              plateNumber: true,
              operationArea: true,
              region: true,
              district: true,
              createdAt: true,
            },
            orderBy: { id: "desc" },
            skip, 
            take,
          }),
          prisma.user.count({ where }),
        ]);
      } catch (fallbackErr: any) {
        console.error('[GET /admin/drivers] Fallback query also failed:', fallbackErr);
        throw fallbackErr;
      }
    }

    const numOrNull = (v: any): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const hasFlaggedKycFields = (v: unknown): boolean => {
      if (!v || typeof v !== "object") return false;
      try {
        return Object.values(v as Record<string, unknown>).some((x) => x === "flagged");
      } catch {
        return false;
      }
    };

    // Aggregate transport performance for this page of drivers
    const driverIds = (items ?? []).map((x: any) => x?.id).filter((x: any) => Number.isFinite(Number(x))) as number[];
    const perfByDriver = new Map<number, { totalTrips: number; completedTrips: number; canceledTrips: number; avgRating: number | null; lastTripAt: string | null }>();
    const includePerformance = String((req.query as any).includePerformance ?? "true") !== "false" && take > 1;
    if (includePerformance && driverIds.length && (prisma as any).transportBooking) {
      const [overall, completed, canceled] = await Promise.all([
        (prisma as any).transportBooking.groupBy({
          by: ["driverId"],
          where: { driverId: { in: driverIds } },
          _count: { _all: true },
          _avg: { userRating: true, rating: true },
          _max: { scheduledDate: true },
        }),
        (prisma as any).transportBooking.groupBy({
          by: ["driverId"],
          where: { driverId: { in: driverIds }, status: "COMPLETED" },
          _count: { _all: true },
        }),
        (prisma as any).transportBooking.groupBy({
          by: ["driverId"],
          where: { driverId: { in: driverIds }, status: "CANCELED" },
          _count: { _all: true },
        }),
      ]);

      const completedMap = new Map<number, number>();
      for (const row of completed ?? []) {
        const id = Number((row as any).driverId);
        if (!Number.isFinite(id)) continue;
        completedMap.set(id, Number((row as any)?._count?._all ?? 0));
      }
      const canceledMap = new Map<number, number>();
      for (const row of canceled ?? []) {
        const id = Number((row as any).driverId);
        if (!Number.isFinite(id)) continue;
        canceledMap.set(id, Number((row as any)?._count?._all ?? 0));
      }

      for (const row of overall ?? []) {
        const id = Number((row as any).driverId);
        if (!Number.isFinite(id)) continue;
        const totalTrips = Number((row as any)?._count?._all ?? 0);
        const completedTrips = completedMap.get(id) ?? 0;
        const canceledTrips = canceledMap.get(id) ?? 0;
        const avgUser = numOrNull((row as any)?._avg?.userRating);
        const avgLegacy = numOrNull((row as any)?._avg?.rating);
        const avgRating = avgUser ?? avgLegacy;
        const lastTripAtRaw = (row as any)?._max?.scheduledDate;
        const lastTripAt = lastTripAtRaw ? new Date(lastTripAtRaw).toISOString() : null;
        perfByDriver.set(id, { totalTrips, completedTrips, canceledTrips, avgRating, lastTripAt });
      }
    }

    // Format items to ensure dates are strings and handle nulls
    const formattedItems = items.map((item: any) => ({
      id: item.id,
      name: item.name || `Driver #${item.id}`,
      email: item.email || "",
      phone: item.phone || null,
      suspendedAt: item.suspendedAt ? new Date(item.suspendedAt).toISOString() : null,
      isDisabled: Boolean(item.isDisabled ?? false),
      available: item.available ?? null,
      isAvailable: item.isAvailable ?? null,
      isVipDriver: Boolean(item.isVipDriver ?? false),
      kycStatus: item.kycStatus ?? null,
      kycNote: null,
      isRevoked: Boolean(item.suspendedAt),
      revocationReason: null,
      revocationCaseRef: item.suspendedAt ? buildDriverCaseRef(item.id, item.suspendedAt) : null,
      district: item.district ?? null,
      needsKycFix: (item.kycStatus === "PENDING_KYC") ? hasFlaggedKycFields(item.kycFieldApprovals) : false,
      rating: numOrNull(item.rating),
      vehicleType: item.vehicleType ?? null,
      plateNumber: item.plateNumber ?? null,
      operationArea: item.operationArea ?? null,
      region: item.region ?? null,
      createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
      performance: perfByDriver.get(Number(item.id)) ?? { totalTrips: 0, completedTrips: 0, canceledTrips: 0, avgRating: null, lastTripAt: null },
    }));

    return res.json({ total, page: Number(page), pageSize: take, items: formattedItems });
  } catch (err: any) {
    console.error('[GET /admin/drivers] Error details:', {
      message: err?.message,
      code: err?.code,
      name: err?.name,
      stack: err?.stack,
    });
    
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying drivers list:', err.message);
      const page = Number((req.query as any).page ?? 1);
      const pageSize = Math.min(Number((req.query as any).pageSize ?? 50), 100);
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      console.warn('Prisma validation error when querying drivers list:', err.message);
      const page = Number((req.query as any).page ?? 1);
      const pageSize = Math.min(Number((req.query as any).pageSize ?? 50), 100);
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    console.error('Unhandled error in GET /admin/drivers:', err);
    return res.status(500).json({ error: 'Internal server error', details: err?.message });
  }
});

/**
 * GET /admin/drivers/trips/:id/eligible-drivers?q=&page=&pageSize=
 * Returns only eligible drivers for a direct-admin-assigned trip.
 */
router.get("/trips/:id(\\d+)/eligible-drivers", limitAdminTripsRead, async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    const { q = "", page = "1", pageSize = "10" } = req.query as any;

    if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: "Invalid id" });
    if (!(prisma as any).transportBooking) return res.status(409).json({ error: "Transport model not available" });

    const booking = await (prisma as any).transportBooking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        fromRegion: true,
        toRegion: true,
        vehicleType: true,
        property: { select: { regionName: true } },
      },
    });
    if (!booking) return res.status(404).json({ error: "Trip not found" });

    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(Math.max(1, Number(pageSize) || 10), 50);
    const term = normalizeSearchTerm(q);

    const where: any = {
      role: "DRIVER",
      suspendedAt: null,
      AND: [{ OR: [{ isDisabled: false }, { isDisabled: null }] }],
    };

    if (term) {
      where.AND.push({
        OR: [{ name: { contains: term } }, { email: { contains: term } }, { phone: { contains: term } }],
      });
    }

    // Best-effort prefilter by booking regions to avoid scanning all drivers.
    const rawAreas = [booking?.fromRegion, booking?.toRegion, booking?.property?.regionName].map((x) => String(x ?? "").trim()).filter(Boolean);
    if (rawAreas.length) {
      where.AND.push({
        OR: [
          { region: { in: rawAreas } },
          ...rawAreas.map((a) => ({ operationArea: { contains: a } })),
        ],
      });
    }

    const candidates = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        fullName: true,
        email: true,
        phone: true,
        role: true,
        region: true,
        operationArea: true,
        vehicleType: true,
        isVipDriver: true,
        suspendedAt: true,
        isDisabled: true,
        available: true,
        isAvailable: true,
      },
      orderBy: { id: "desc" },
      take: term ? 400 : 600,
    });

    const eligible = (candidates ?? []).filter((d: any) => driverEligibilityForBooking(d, booking).eligible);
    const total = eligible.length;
    const items = eligible.slice((p - 1) * ps, (p - 1) * ps + ps).map((d: any) => ({
      id: d.id,
      name: String(d.fullName || d.name || `Driver #${d.id}`),
      email: String(d.email || ""),
      phone: d.phone ?? null,
    }));

    return res.json({ total, page: p, pageSize: ps, items });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      return res.status(404).json({ error: "Not found" });
    }
    console.error("Unhandled error in GET /admin/drivers/trips/:id/eligible-drivers:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /admin/drivers/trips?driverId=&status=&date=&start=&end=&page=&pageSize=&q= */
/** GET /admin/drivers/trips/stats?period=7d|30d|month|year */
router.get("/trips/stats", limitAdminTripsRead, async (req, res) => {
  try {
    const { period = "30d" } = req.query as any;
    
    let startDate: Date;
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    // Calculate start date based on period
    switch (period) {
      case "7d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        break;
      case "month":
        startDate = new Date();
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "year":
        startDate = new Date();
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      default:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
    }
    startDate.setHours(0, 0, 0, 0);

    // Transport trips live in TransportBooking (NOT Booking).
    // Booking is for property stays and does not have driverId/scheduledAt/price.
    if (!(prisma as any).transportBooking) {
      return res.json({
        stats: [],
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    }

    // Get all transport trips in the date range
    const trips = await (prisma as any).transportBooking.findMany({
      where: {
        driverId: { not: null },
        scheduledDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        scheduledDate: true,
        status: true,
        amount: true,
      },
      orderBy: {
        scheduledDate: "asc",
      },
    });

    // Group by date
    const dateMap = new Map<string, { count: number; completed: number; amount: number }>();
    
    type TripResult = {
      scheduledDate: Date;
      status: string;
      amount: number | null;
    };
    
    (trips as TripResult[]).forEach((trip: TripResult) => {
      const dateKey = trip.scheduledDate.toISOString().split("T")[0];
      const existing = dateMap.get(dateKey) || { count: 0, completed: 0, amount: 0 };
      existing.count += 1;
      if (trip.status === "COMPLETED") {
        existing.completed += 1;
      }
      existing.amount += Number(trip.amount ?? 0);
      dateMap.set(dateKey, existing);
    });

    // Convert to array and sort
    const stats = Array.from(dateMap.entries())
      .map(([date, data]) => ({
        date,
        count: data.count,
        completed: data.completed,
        amount: data.amount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return res.json({ stats, period, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying trip stats:', err.message);
      return res.json({ stats: [], period: (req.query as any).period || "30d", startDate: new Date().toISOString(), endDate: new Date().toISOString() });
    }
    console.error('Unhandled error in GET /admin/drivers/trips/stats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get("/trips", limitAdminTripsRead, async (req, res) => {
  try {
    const {
      driverId,
      status,
      assignment = "assigned", // assigned|unassigned|all
      date,
      start,
      end,
      page = "1",
      pageSize = "50",
      q = "",
    } = req.query as any;
    
    const where: any = {};

    // This endpoint powers the admin "Trips" page for direct-accept/dispatch trips.
    // Scheduled claim-based trips are handled separately under /trips/scheduled.
    // Exclude any transport bookings that have at least one claim.
    (where as any).claims = { none: {} };

    // Keep "Trips" focused on rides that need attention now / already happened.
    // Additionally include near-term unassigned dispatch trips (for 5m warnings / 10m takeover)
    // and admin-takeover trips regardless of scheduledDate.
    const now = Date.now();
    const lookahead = new Date(now + 20 * 60 * 1000);
    (where as any).OR = [
      { scheduledDate: { lte: new Date(now) } },
      { status: { in: ["CONFIRMED", "IN_PROGRESS"] } },
      { status: "PENDING_ADMIN_ASSIGNMENT" },
      {
        AND: [
          { driverId: null },
          { status: { in: ["PENDING", "PENDING_ASSIGNMENT"] } },
          { scheduledDate: { lte: lookahead } },
        ],
      },
    ];
    
    // Filter by driver if specified
    if (typeof driverId !== "undefined" && String(driverId).trim() !== "") {
      const did = Number(driverId);
      if (Number.isFinite(did) && did > 0) {
        (where as any).driverId = did;
      }
    } else {
      // Assignment filtering (default stays backwards-compatible: assigned)
      const a = String(assignment || "assigned").toLowerCase();
      if (a === "all") {
        // no driverId constraint
      } else if (a === "unassigned") {
        (where as any).driverId = null;
      } else {
        (where as any).driverId = { not: null };
      }
    }
    
    // Filter by status
    if (status) {
      where.status = status;
    }
    
    // Date filtering
    if (date) {
      const s = new Date(String(date) + "T00:00:00.000Z");
      const e = new Date(String(date) + "T23:59:59.999Z");
      where.scheduledDate = { gte: s, lte: e };
    } else if (start || end) {
      const s = start ? new Date(String(start) + "T00:00:00.000Z") : new Date(0);
      const e = end ? new Date(String(end) + "T23:59:59.999Z") : new Date();
      where.scheduledDate = { gte: s, lte: e };
    }
    
    // Search query
    if (q) {
      const term = String(q).trim();
      if (term) {
        // MySQL doesn't support `mode: "insensitive"`, so we use plain contains.
        where.OR = [
          { fromAddress: { contains: term } },
          { toAddress: { contains: term } },
          { fromDistrict: { contains: term } },
          { toDistrict: { contains: term } },
          { fromRegion: { contains: term } },
          { toRegion: { contains: term } },
          { paymentRef: { contains: term } },
          { tripCode: { contains: term } },
          // Optional relation filter needs `is`
          { driver: { is: { name: { contains: term } } } },
          { driver: { is: { email: { contains: term } } } },
        ];
      }
    }
    
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);
    
    if (!(prisma as any).transportBooking) {
      return res.json({ total: 0, page: Number(page), pageSize: take, items: [] });
    }

    const [items, total] = await Promise.all([
      (prisma as any).transportBooking.findMany({
        where,
        select: {
          id: true,
          tripCode: true,
          paymentRef: true,
          fromAddress: true,
          fromWard: true,
          fromDistrict: true,
          fromRegion: true,
          toAddress: true,
          toWard: true,
          toDistrict: true,
          toRegion: true,
          scheduledDate: true,
          amount: true,
          vehicleType: true,
          paymentStatus: true,
          paymentMethod: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          driver: {
            select: { id: true, name: true, email: true, phone: true },
          },
        },
        orderBy: { scheduledDate: "desc" },
        skip,
        take,
      }),
      (prisma as any).transportBooking.count({ where }),
    ]);

    // Map TransportBooking.paymentRef -> Invoice.id (used for linking to the existing invoice/payment templates)
    const paymentRefs = Array.from(
      new Set(
        (items as any[])
          .map((b: any) => (b?.paymentRef ? String(b.paymentRef) : ""))
          .filter((v: string) => v.trim() !== "")
      )
    );
    const invoiceIdByPaymentRef = new Map<string, number>();
    if (paymentRefs.length > 0) {
      const invoices = await prisma.invoice.findMany({
        where: { paymentRef: { in: paymentRefs } },
        select: { id: true, paymentRef: true },
      });
      for (const inv of invoices) {
        if (inv.paymentRef) invoiceIdByPaymentRef.set(String(inv.paymentRef), inv.id);
      }
    }
    
    const fmtLoc = (kind: "from" | "to", row: any) => {
      const addr = kind === "from" ? row.fromAddress : row.toAddress;
      if (addr) return addr;
      const ward = kind === "from" ? row.fromWard : row.toWard;
      const district = kind === "from" ? row.fromDistrict : row.toDistrict;
      const region = kind === "from" ? row.fromRegion : row.toRegion;
      const parts = [ward, district, region].filter(Boolean);
      return parts.length ? parts.join(", ") : "N/A";
    };

    const mapped = (items as any[]).map((b: any) => ({
      id: b.id,
      tripCode: b.tripCode || b.paymentRef || `TRIP-${b.id}`,
      driver: b.driver
        ? {
            id: b.driver.id,
            name: b.driver.name || "Unknown Driver",
            email: b.driver.email,
            phone: b.driver.phone,
          }
        : null,
      pickup: fmtLoc("from", b),
      dropoff: fmtLoc("to", b),
      scheduledAt: (b.scheduledDate ?? b.createdAt)?.toISOString?.() ?? String(b.scheduledDate ?? b.createdAt ?? ""),
      amount: Number(b.amount ?? 0),
      vehicleType: b.vehicleType ?? null,
      paymentStatus: b.paymentStatus ?? null,
      paymentMethod: b.paymentMethod ?? null,
      paymentRef: b.paymentRef ?? null,
      invoiceId: b.paymentRef ? invoiceIdByPaymentRef.get(String(b.paymentRef)) ?? null : null,
      status: b.status || "PENDING",
      createdAt: (b.createdAt ?? b.updatedAt)?.toISOString?.() ?? String(b.createdAt ?? b.updatedAt ?? ""),
    }));
    
    return res.json({ total, page: Number(page), pageSize: take, items: mapped });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying trips:', err.message);
      const page = Number((req.query as any).page ?? 1);
      const pageSize = Math.min(Number((req.query as any).pageSize ?? 50), 100);
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    console.error('Unhandled error in GET /admin/drivers/trips:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /admin/drivers/trips/:id/assign
 * Body: { driverId: number, reason: string }
 * Assigns a driver to a transport booking (direct admin control; non-claim based).
 */
router.post("/trips/:id(\\d+)/assign", limitAdminTripsWrite, async (req, res) => {
  try {
    const r = req as any;
    const adminId = Number(r?.user?.id);
    const bookingId = Number(req.params.id);
    const driverId = Number((req.body as any)?.driverId);
    const reason = normalizeReason((req.body as any)?.reason, 500);

    if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: "Invalid id" });
    if (!Number.isFinite(driverId) || driverId <= 0) return res.status(400).json({ error: "driverId is required" });
    if (!reason) return res.status(400).json({ error: "reason is required" });
    if (reason.length > 500) return res.status(400).json({ error: "reason is too long" });

    if (!(prisma as any).transportBooking) return res.status(409).json({ error: "Transport model not available" });

    const result = await prisma.$transaction(async (tx) => {
      const booking = await (tx as any).transportBooking.findUnique({
        where: { id: bookingId },
        select: {
          id: true,
          driverId: true,
          status: true,
          fromRegion: true,
          toRegion: true,
          vehicleType: true,
          property: { select: { regionName: true } },
        },
      });
      if (!booking) {
        const err: any = new Error("Booking not found");
        err.code = "NOT_FOUND";
        throw err;
      }
      if (booking.status === "COMPLETED" || booking.status === "CANCELED") {
        const err: any = new Error("Trip is not active");
        err.code = "NOT_ACTIVE";
        throw err;
      }
      if (booking.driverId != null) {
        const err: any = new Error("Booking already assigned");
        err.code = "ALREADY_ASSIGNED";
        throw err;
      }

      // Ensure target user exists (best-effort; schema differs between deployments)
      const driver = await (tx as any).user?.findUnique?.({
        where: { id: driverId },
        select: {
          id: true,
          role: true,
          name: true,
          email: true,
          phone: true,
          region: true,
          operationArea: true,
          vehicleType: true,
          isVipDriver: true,
          suspendedAt: true,
          isDisabled: true,
          available: true,
          isAvailable: true,
        },
      });
      if (!driver) {
        const err: any = new Error("Driver not found");
        err.code = "DRIVER_NOT_FOUND";
        throw err;
      }

      const eligibility = driverEligibilityForBooking(driver, booking);
      if (!eligibility.eligible) {
        const err: any = new Error(
          eligibility.reasons.length ? `Driver not eligible: ${eligibility.reasons.join(", ")}` : "Driver not eligible"
        );
        err.code = "DRIVER_NOT_ELIGIBLE";
        throw err;
      }

      const updated = await (tx as any).transportBooking.update({
        where: { id: bookingId },
        data: {
          driverId,
          status: booking.status === "PENDING" ? "CONFIRMED" : booking.status,
        },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          driver: { select: { id: true, name: true, email: true, phone: true } },
        },
      });

      await (tx as any).auditLog?.create?.({
        data: {
          actorId: Number.isFinite(adminId) ? adminId : null,
          actorRole: "ADMIN",
          action: "TRANSPORT_ADMIN_ASSIGN_DRIVER",
          entity: "TRANSPORT_BOOKING",
          entityId: bookingId,
          beforeJson: { driverId: null },
          afterJson: { bookingId, driverId, reason },
          ip: (req.headers["x-forwarded-for"] as string) || (req.socket as any)?.remoteAddress || null,
          ua: String(req.headers["user-agent"] || ""),
        },
      });

      if (Number.isFinite(adminId)) {
        await (tx as any).adminAudit?.create?.({
          data: {
            adminId,
            targetUserId: driverId,
            action: "TRANSPORT_ADMIN_ASSIGN_DRIVER",
            details: { bookingId, driverId, reason },
          },
        });
      }

      return updated;
    });

    return res.json({ success: true, booking: result });
  } catch (error: any) {
    const status =
      error?.code === "NOT_FOUND" ? 404 :
      error?.code === "DRIVER_NOT_FOUND" ? 404 :
      error?.code === "ALREADY_ASSIGNED" ? 409 :
      error?.code === "NOT_ACTIVE" ? 409 :
      error?.code === "DRIVER_NOT_ELIGIBLE" ? 409 :
      500;
    console.error("POST /admin/drivers/trips/:id/assign error:", error);
    return res.status(status).json({ error: error?.message || "Failed to assign" });
  }
});

/**
 * POST /admin/drivers/trips/:id/unassign
 * Body: { reason: string }
 */
router.post("/trips/:id(\\d+)/unassign", limitAdminTripsWrite, async (req, res) => {
  try {
    const r = req as any;
    const adminId = Number(r?.user?.id);
    const bookingId = Number(req.params.id);
    const reason = normalizeReason((req.body as any)?.reason, 500);

    if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: "Invalid id" });
    if (!reason) return res.status(400).json({ error: "reason is required" });
    if (reason.length > 500) return res.status(400).json({ error: "reason is too long" });
    if (!(prisma as any).transportBooking) return res.status(409).json({ error: "Transport model not available" });

    const result = await prisma.$transaction(async (tx) => {
      const booking = await (tx as any).transportBooking.findUnique({
        where: { id: bookingId },
        select: { id: true, driverId: true, status: true },
      });
      if (!booking) {
        const err: any = new Error("Booking not found");
        err.code = "NOT_FOUND";
        throw err;
      }
      if (booking.driverId == null) {
        const err: any = new Error("Trip is already unassigned");
        err.code = "ALREADY_UNASSIGNED";
        throw err;
      }
      if (booking.status === "COMPLETED" || booking.status === "CANCELED") {
        const err: any = new Error("Trip is not active");
        err.code = "NOT_ACTIVE";
        throw err;
      }
      if (booking.status === "IN_PROGRESS") {
        const err: any = new Error("Trip is in progress");
        err.code = "IN_PROGRESS";
        throw err;
      }

      const prevDriverId = booking.driverId;

      const updated = await (tx as any).transportBooking.update({
        where: { id: bookingId },
        data: {
          driverId: null,
          status: "PENDING",
        },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          driver: { select: { id: true, name: true, email: true, phone: true } },
        },
      });

      await (tx as any).auditLog?.create?.({
        data: {
          actorId: Number.isFinite(adminId) ? adminId : null,
          actorRole: "ADMIN",
          action: "TRANSPORT_ADMIN_UNASSIGN_DRIVER",
          entity: "TRANSPORT_BOOKING",
          entityId: bookingId,
          beforeJson: { driverId: prevDriverId },
          afterJson: { bookingId, driverId: null, reason },
          ip: (req.headers["x-forwarded-for"] as string) || (req.socket as any)?.remoteAddress || null,
          ua: String(req.headers["user-agent"] || ""),
        },
      });

      if (Number.isFinite(adminId) && Number.isFinite(Number(prevDriverId))) {
        await (tx as any).adminAudit?.create?.({
          data: {
            adminId,
            targetUserId: Number(prevDriverId),
            action: "TRANSPORT_ADMIN_UNASSIGN_DRIVER",
            details: { bookingId, prevDriverId, reason },
          },
        });
      }

      return updated;
    });

    return res.json({ success: true, booking: result });
  } catch (error: any) {
    const status =
      error?.code === "NOT_FOUND" ? 404 :
      error?.code === "ALREADY_UNASSIGNED" ? 409 :
      error?.code === "IN_PROGRESS" ? 409 :
      error?.code === "NOT_ACTIVE" ? 409 :
      500;
    console.error("POST /admin/drivers/trips/:id/unassign error:", error);
    return res.status(status).json({ error: error?.message || "Failed to unassign" });
  }
});

/**
 * POST /admin/drivers/trips/:id/cancel
 * Body: { reason: string }
 */
router.post("/trips/:id(\\d+)/cancel", limitAdminTripsWrite, async (req, res) => {
  try {
    const r = req as any;
    const adminId = Number(r?.user?.id);
    const bookingId = Number(req.params.id);
    const reason = normalizeReason((req.body as any)?.reason, 800);

    if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: "Invalid id" });
    if (!reason) return res.status(400).json({ error: "reason is required" });
    if (reason.length < 40) return res.status(400).json({ error: "reason must be at least 40 characters" });
    if (reason.length > 800) return res.status(400).json({ error: "reason is too long" });
    if (!(prisma as any).transportBooking) return res.status(409).json({ error: "Transport model not available" });

    const result = await prisma.$transaction(async (tx) => {
      const booking = await (tx as any).transportBooking.findUnique({
        where: { id: bookingId },
        select: { id: true, driverId: true, status: true, notes: true },
      });
      if (!booking) {
        const err: any = new Error("Booking not found");
        err.code = "NOT_FOUND";
        throw err;
      }
      if (booking.status === "COMPLETED" || booking.status === "CANCELED") {
        const err: any = new Error("Trip is not active");
        err.code = "NOT_ACTIVE";
        throw err;
      }

      const newNotes =
        (booking.notes ? String(booking.notes) + "\n" : "") +
        `Admin cancelled: ${reason}`;

      const updated = await (tx as any).transportBooking.update({
        where: { id: bookingId },
        data: { status: "CANCELED", notes: newNotes },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          driver: { select: { id: true, name: true, email: true, phone: true } },
        },
      });

      await (tx as any).auditLog?.create?.({
        data: {
          actorId: Number.isFinite(adminId) ? adminId : null,
          actorRole: "ADMIN",
          action: "TRANSPORT_ADMIN_CANCEL_TRIP",
          entity: "TRANSPORT_BOOKING",
          entityId: bookingId,
          beforeJson: { status: booking.status, driverId: booking.driverId ?? null },
          afterJson: { bookingId, status: "CANCELED", reason },
          ip: (req.headers["x-forwarded-for"] as string) || (req.socket as any)?.remoteAddress || null,
          ua: String(req.headers["user-agent"] || ""),
        },
      });

      if (Number.isFinite(adminId)) {
        await (tx as any).adminAudit?.create?.({
          data: {
            adminId,
            targetUserId: booking.driverId ?? null,
            action: "TRANSPORT_ADMIN_CANCEL_TRIP",
            details: { bookingId, status: "CANCELED", reason, previousStatus: booking.status },
          },
        });
      }

      return updated;
    });

    return res.json({ success: true, booking: result });
  } catch (error: any) {
    const status =
      error?.code === "NOT_FOUND" ? 404 :
      error?.code === "NOT_ACTIVE" ? 409 :
      500;
    console.error("POST /admin/drivers/trips/:id/cancel error:", error);
    return res.status(status).json({ error: error?.message || "Failed to cancel" });
  }
});

/**
 * GET /admin/drivers/trips/:id
 * Returns details for a transport trip (TransportBooking) so admins can manage direct-accept flows.
 */
router.get("/trips/:id(\\d+)", async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: "Invalid id" });

    if (!(prisma as any).transportBooking) return res.status(404).json({ error: "Not found" });

    const booking = await (prisma as any).transportBooking.findUnique({
      where: { id: bookingId },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        driver: { select: { id: true, name: true, email: true, phone: true } },
        offers: {
          select: { id: true, status: true, driverId: true, distanceKm: true, score: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        },
      },
    });

    if (!booking) return res.status(404).json({ error: "Not found" });

    let payout: any = null;
    try {
      if ((prisma as any).transportPayout) {
        payout = await (prisma as any).transportPayout.findUnique({
          where: { transportBookingId: bookingId },
          select: {
            id: true,
            status: true,
            currency: true,
            grossAmount: true,
            commissionPercent: true,
            commissionAmount: true,
            netPaid: true,
            approvedAt: true,
            approvedBy: true,
            paidAt: true,
            paidBy: true,
            paymentMethod: true,
            paymentRef: true,
            createdAt: true,
            updatedAt: true,
            approver: { select: { id: true, name: true, email: true } },
            payer: { select: { id: true, name: true, email: true } },
          },
        });
      }
    } catch {
      payout = null;
    }

    const coordinateText = (lat: any, lng: any) => {
      if (lat == null || lng == null) return null;
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
      return `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
    };

    const distanceKm = (fromLat: any, fromLng: any, toLat: any, toLng: any) => {
      const lat1 = Number(fromLat);
      const lng1 = Number(fromLng);
      const lat2 = Number(toLat);
      const lng2 = Number(toLng);
      if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
      const toRad = (value: number) => (value * Math.PI) / 180;
      const earthKm = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return Math.round(earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
    };

    const durationMinutes = (start: any, end: any) => {
      if (!start || !end) return null;
      const startedAt = new Date(start).getTime();
      const endedAt = new Date(end).getTime();
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
      return Math.round((endedAt - startedAt) / 60000);
    };

    const acceptedOffer = (booking.offers || []).find((offer: any) => String(offer?.status || "").toUpperCase() === "ACCEPTED");
    const notesUpper = String(booking.notes || "").toUpperCase();
    const tripType = notesUpper.includes("AUTO_DISPATCH") || acceptedOffer ? "AUTO_DISPATCHED" : "SCHEDULED";

    const trip = {
      id: Number(booking.id),
      tripCode: booking.tripCode || booking.paymentRef || `TRIP-${booking.id}`,

      status: booking.status || "PENDING",
      scheduledAt: (booking.scheduledDate ?? booking.createdAt)?.toISOString?.() ?? String(booking.scheduledDate ?? booking.createdAt ?? ""),
      pickupTime: booking.pickupTime ? new Date(booking.pickupTime).toISOString() : null,
      dropoffTime: booking.dropoffTime ? new Date(booking.dropoffTime).toISOString() : null,
      accomplishedAt: (booking.dropoffTime ?? booking.updatedAt ?? booking.scheduledDate ?? booking.createdAt)?.toISOString?.() ?? String(booking.dropoffTime ?? booking.updatedAt ?? booking.scheduledDate ?? booking.createdAt ?? ""),
      pickup: booking.fromAddress || [booking.fromWard, booking.fromDistrict, booking.fromRegion].filter(Boolean).join(", ") || "N/A",
      dropoff: booking.toAddress || [booking.toWard, booking.toDistrict, booking.toRegion].filter(Boolean).join(", ") || "N/A",
      pickupCoordinate: coordinateText(booking.fromLatitude, booking.fromLongitude),
      dropoffCoordinate: coordinateText(booking.toLatitude, booking.toLongitude),
      distanceKm: distanceKm(booking.fromLatitude, booking.fromLongitude, booking.toLatitude, booking.toLongitude),
      durationMinutes: durationMinutes(booking.pickupTime, booking.dropoffTime),
      tripType,
      vehicleType: booking.vehicleType ?? null,
      passengerCount: booking.numberOfPassengers != null ? Number(booking.numberOfPassengers) : null,
      amount: booking.amount != null ? Number(booking.amount) : 0,
      currency: booking.currency ?? "TZS",
      paymentStatus: booking.paymentStatus ?? null,
      paymentMethod: booking.paymentMethod ?? null,
      paymentRef: booking.paymentRef ?? null,
      notes: booking.notes ?? null,
      customerRating: booking.userRating != null ? Number(booking.userRating) : booking.rating != null ? Number(booking.rating) : null,
      customerReview: booking.userReview ?? booking.ratingComment ?? null,
      driverRating: booking.driverRating != null ? Number(booking.driverRating) : null,
      driverReview: booking.driverReview ?? null,
      createdAt: booking.createdAt ? new Date(booking.createdAt).toISOString() : null,
      updatedAt: booking.updatedAt ? new Date(booking.updatedAt).toISOString() : null,
      user: booking.user
        ? {
            id: Number(booking.user.id),
            name: booking.user.name ?? "",
            email: booking.user.email ?? "",
            phone: booking.user.phone ?? null,
          }
        : null,
      driver: booking.driver
        ? {
            id: Number(booking.driver.id),
            name: booking.driver.name ?? "",
            email: booking.driver.email ?? "",
            phone: booking.driver.phone ?? null,
          }
        : null,
      payout: payout
        ? {
            id: Number(payout.id),
            status: payout.status,
            currency: payout.currency,
            grossAmount: payout.grossAmount != null ? Number(payout.grossAmount) : null,
            commissionPercent: payout.commissionPercent != null ? Number(payout.commissionPercent) : null,
            commissionAmount: payout.commissionAmount != null ? Number(payout.commissionAmount) : null,
            netPaid: payout.netPaid != null ? Number(payout.netPaid) : null,
            approvedAt: payout.approvedAt ? new Date(payout.approvedAt).toISOString() : null,
            paidAt: payout.paidAt ? new Date(payout.paidAt).toISOString() : null,
            paymentMethod: payout.paymentMethod ?? null,
            paymentRef: payout.paymentRef ?? null,
            createdAt: payout.createdAt ? new Date(payout.createdAt).toISOString() : null,
            updatedAt: payout.updatedAt ? new Date(payout.updatedAt).toISOString() : null,
            approvedBy: payout.approver ?? null,
            paidBy: payout.payer ?? null,
          }
        : null,
    };

    let audits: any[] = [];
    try {
      if ((prisma as any).auditLog) {
        audits = await (prisma as any).auditLog.findMany({
          where: {
            entity: "TRANSPORT_BOOKING",
            entityId: bookingId,
            action: {
              in: [
                "TRANSPORT_ASSIGN_DRIVER",
                "TRANSPORT_ADMIN_ASSIGN_DRIVER",
                "TRANSPORT_ADMIN_UNASSIGN_DRIVER",
                "TRANSPORT_ADMIN_CANCEL_TRIP",
              ],
            },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
      }
    } catch {
      audits = [];
    }

    const assignmentAudits = (audits || []).map((a: any) => {
      const afterJson = a?.afterJson;
      const reason = typeof afterJson === "object" && afterJson ? (afterJson.reason ?? null) : null;
      return {
        id: Number(a.id),
        action: a.action,
        actorId: a.actorId != null ? Number(a.actorId) : null,
        createdAt: a.createdAt ? new Date(a.createdAt).toISOString() : null,
        reason,
      };
    });

    return res.json({ trip, assignmentAudits });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      return res.status(404).json({ error: "Not found" });
    }
    console.error("Unhandled error in GET /admin/drivers/trips/:id:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

const DEFAULT_TRANSPORT_DRIVER_COMMISSION_PERCENT = 10;
function roundMoney(amount: number) {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

/** Read driverCommissionPercent from SystemSetting; falls back to the hardcoded default. */
async function getDriverCommissionPercent(): Promise<number> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { driverCommissionPercent: true } as any,
    });
    const pct = Number((setting as any)?.driverCommissionPercent ?? DEFAULT_TRANSPORT_DRIVER_COMMISSION_PERCENT);
    return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : DEFAULT_TRANSPORT_DRIVER_COMMISSION_PERCENT;
  } catch {
    return DEFAULT_TRANSPORT_DRIVER_COMMISSION_PERCENT;
  }
}

/**
 * POST /admin/drivers/trips/:id/payout/approve
 * Body: { acknowledgeCommission?: boolean }
 * Creates/updates a TransportPayout record and moves it to APPROVED.
 * Requires explicit acknowledgement so payout cannot be silently bypassed.
 */
router.post("/trips/:id(\\d+)/payout/approve", async (req, res) => {
  try {
    const r = req as any;
    const adminId = Number(r?.user?.id);
    const bookingId = Number(req.params.id);
    const acknowledgeCommission = Boolean((req.body as any)?.acknowledgeCommission);

    if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: "Invalid id" });
    if (!(prisma as any).transportBooking) return res.status(404).json({ error: "Not found" });
    if (!(prisma as any).transportPayout) return res.status(409).json({ error: "Transport payout model not available" });

    const booking = await (prisma as any).transportBooking.findUnique({
      where: { id: bookingId },
      select: { id: true, status: true, driverId: true, amount: true, currency: true },
    });
    if (!booking) return res.status(404).json({ error: "Not found" });

    const status = String(booking.status ?? "").toUpperCase();
    if (!['COMPLETED', 'FINISHED'].includes(status)) return res.status(409).json({ error: "Trip is not completed" });
    if (!booking.driverId) return res.status(409).json({ error: "Trip has no driver assigned" });

    const grossAmount = Number(booking.amount ?? 0);
    if (!Number.isFinite(grossAmount) || grossAmount <= 0) return res.status(409).json({ error: "Trip amount is not set" });
    const currency = booking.currency ?? 'TZS';

    const commissionPercent = await getDriverCommissionPercent();
    const commissionAmount = roundMoney((grossAmount * commissionPercent) / 100);
    const netPaid = roundMoney(grossAmount - commissionAmount);

    if (!acknowledgeCommission) {
      return res.status(409).json({
        error: "commission_ack_required",
        message: "Commission acknowledgement required before approving payout",
        currency,
        grossAmount,
        commissionPercent,
        commissionAmount,
        netPaid,
      });
    }

    const payout = await prisma.$transaction(async (tx) => {
      const existing = await (tx as any).transportPayout.findUnique({ where: { transportBookingId: bookingId } });
      if (existing && String(existing.status ?? '').toUpperCase() === 'PAID') {
        const err: any = new Error('Payout already paid');
        err.code = 'ALREADY_PAID';
        throw err;
      }
      // If the driver already submitted a payout claim (row exists as
      // PENDING via driver.scheduled.ts), it must go through the same
      // VERIFIED checkpoint as the Invoices review screen
      // (/invoices/:id/verify) before this action can approve it — this
      // endpoint no longer skips that review by upserting straight to
      // APPROVED. A row that doesn't exist yet has no driver claim to
      // review, so admin-initiated approval here still works directly.
      if (existing && String(existing.status ?? '').toUpperCase() === 'PENDING') {
        const err: any = new Error('This payout has a pending driver claim — verify it first in Driver Payout Invoices before approving.');
        err.code = 'NOT_VERIFIED';
        throw err;
      }

      const upserted = await (tx as any).transportPayout.upsert({
        where: { transportBookingId: bookingId },
        create: {
          transportBookingId: bookingId,
          driverId: Number(booking.driverId),
          currency,
          grossAmount: grossAmount as any,
          commissionPercent: commissionPercent as any,
          commissionAmount: commissionAmount as any,
          netPaid: netPaid as any,
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: Number.isFinite(adminId) ? adminId : null,
        },
        update: {
          driverId: Number(booking.driverId),
          currency,
          grossAmount: grossAmount as any,
          commissionPercent: commissionPercent as any,
          commissionAmount: commissionAmount as any,
          netPaid: netPaid as any,
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedBy: Number.isFinite(adminId) ? adminId : null,
        },
      });

      try {
        await (tx as any).auditLog?.create?.({
          data: {
            actorId: Number.isFinite(adminId) ? adminId : null,
            actorRole: 'ADMIN',
            action: 'TRANSPORT_PAYOUT_APPROVED',
            entity: 'TRANSPORT_BOOKING',
            entityId: bookingId,
            beforeJson: existing ? { payoutStatus: existing.status } : null,
            afterJson: {
              payoutStatus: 'APPROVED',
              currency,
              grossAmount,
              commissionPercent,
              commissionAmount,
              netPaid,
            },
            ip: (req.headers["x-forwarded-for"] as string) || (req.socket as any)?.remoteAddress || null,
            ua: String(req.headers["user-agent"] || ""),
          },
        });
      } catch {
        // ignore
      }

      return upserted;
    });

    return res.json({
      ok: true,
      payout: {
        id: payout.id,
        status: payout.status,
        currency: payout.currency,
        grossAmount: Number(payout.grossAmount),
        commissionPercent: Number(payout.commissionPercent),
        commissionAmount: Number(payout.commissionAmount),
        netPaid: Number(payout.netPaid),
        approvedAt: payout.approvedAt ? new Date(payout.approvedAt).toISOString() : null,
      },
    });
  } catch (error: any) {
    const status =
      error?.code === 'ALREADY_PAID' ? 409 :
      error?.code === 'NOT_VERIFIED' ? 409 :
      500;
    console.error('POST /admin/drivers/trips/:id/payout/approve error:', error);
    return res.status(status).json({ error: error?.message || 'Failed to approve payout' });
  }
});

// POST /trips/:id/payout/pay (manual "mark paid") was retired — driver
// trip payouts are now paid exclusively through the AzamPay Disbursement
// ledger (services/payouts/ledger.ts), reached once /payout/approve above
// has moved the TransportPayout to APPROVED. See admin.disbursements.ts.
// The write-back in ledger.ts sets TransportPayout.status = "PAID" once
// AzamPay confirms.

/**
 * GET /admin/drivers/trips/scheduled
 * List scheduled transport bookings (paid by default) for operational control.
 * Query:
 * - bucket=unassigned|assigned|all (default: unassigned)
 * - futureOnly=true|false (default: true)
 * - paymentStatus=PAID|PENDING|REFUNDED (default: PAID)
 * - vehicleType=BODA|BAJAJI|CAR|XL|PREMIUM
 * - q=search
 * - page/pageSize
 */
router.get("/trips/scheduled", limitAdminTripsRead, async (req, res) => {
  try {
    const {
      stage,
      bucket = "unassigned",
      futureOnly = "true",
      paymentStatus = "PAID",
      vehicleType,
      q = "",
      page = "1",
      pageSize = "50",
    } = req.query as any;

    if (!(prisma as any).transportBooking) {
      return res.json({ total: 0, page: Number(page), pageSize: Math.min(Number(pageSize) || 50, 100), items: [] });
    }

    const now = new Date();
    const CLAIM_WINDOW_HOURS = 72;
    const claimWindowMs = CLAIM_WINDOW_HOURS * 60 * 60 * 1000;
    const claimOpenCutoff = new Date(now.getTime() + claimWindowMs);

    const where: any = {
      paymentStatus: paymentStatus ? String(paymentStatus) : undefined,
    };

    // Stage is a higher-level filter for ops workflows.
    // If stage is provided, it takes precedence over bucket/futureOnly.
    const stageValue = stage ? String(stage) : "";
    if (stageValue) {
      switch (stageValue) {
        case "waiting": {
          // Paid, unassigned, future, but claim window not open yet (scheduled > now+72h)
          where.driverId = null;
          where.scheduledDate = { gt: claimOpenCutoff };
          break;
        }
        case "claim_open": {
          // Paid, unassigned, future, and within claim window (scheduled <= now+72h)
          where.driverId = null;
          where.scheduledDate = { gte: now, lte: claimOpenCutoff };
          break;
        }
        case "assigned": {
          // Driver assigned but trip not yet completed — keep regardless of scheduled date.
          where.driverId = { not: null };
          where.status = { in: ["ASSIGNED", "CONFIRMED", "PENDING"] };
          break;
        }
        case "in_progress": {
          where.status = "IN_PROGRESS";
          break;
        }
        case "completed": {
          where.status = "COMPLETED";
          break;
        }
        case "driver_left": {
          // Trips returned to pool because the driver deleted their account
          where.driverId = null;
          where.notes = { contains: '[DRIVER_DELETED]' };
          break;
        }
        case "all": {
          // no extra filtering
          break;
        }
        default: {
          // fall back to legacy behavior
          break;
        }
      }
    } else {
      const wantFutureOnly = String(futureOnly).toLowerCase() !== "false";
      if (wantFutureOnly) {
        where.scheduledDate = { gte: now };
      }

      if (bucket === "unassigned") where.driverId = null;
      else if (bucket === "assigned") where.driverId = { not: null };
    }

    if (vehicleType) {
      where.vehicleType = String(vehicleType);
    }

    const term = String(q).trim();
    if (term) {
      where.OR = [
        { fromAddress: { contains: term } },
        { toAddress: { contains: term } },
        { fromDistrict: { contains: term } },
        { toDistrict: { contains: term } },
        { fromRegion: { contains: term } },
        { toRegion: { contains: term } },
        { paymentRef: { contains: term } },
        { tripCode: { contains: term } },
        { user: { is: { name: { contains: term } } } },
        { user: { is: { email: { contains: term } } } },
      ];
    }

    const p = Math.max(1, Number(page) || 1);
    const ps = Math.max(1, Math.min(100, Number(pageSize) || 50));
    const skip = (p - 1) * ps;

    const [items, total] = await Promise.all([
      (prisma as any).transportBooking.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          driver: { select: { id: true, name: true, email: true, phone: true } },
          _count: { select: { claims: true } },
        },
        orderBy: { scheduledDate: "asc" },
        skip,
        take: ps,
      }),
      (prisma as any).transportBooking.count({ where }),
    ]);

    const fmtLoc = (kind: "from" | "to", row: any) => {
      const addr = kind === "from" ? row.fromAddress : row.toAddress;
      if (addr) return addr;
      const ward = kind === "from" ? row.fromWard : row.toWard;
      const district = kind === "from" ? row.fromDistrict : row.toDistrict;
      const region = kind === "from" ? row.fromRegion : row.toRegion;
      const parts = [ward, district, region].filter(Boolean);
      return parts.length ? parts.join(", ") : "N/A";
    };

    const claimLimit = 5;

    const computeClaimOpensAt = (scheduledDate: Date) => new Date(scheduledDate.getTime() - claimWindowMs);

    const mapped = (items as any[]).map((b: any) => {
      const claimCount = Number(b?._count?.claims ?? 0);
      const scheduledDate = new Date(b.scheduledDate);
      const claimOpensAt = computeClaimOpensAt(scheduledDate);
      const canClaimNow = now >= claimOpensAt && now <= scheduledDate && b.driverId == null;

      const derivedStage = (() => {
        if (b.status === "COMPLETED") return "completed";
        if (b.status === "IN_PROGRESS") return "in_progress";
        if (b.driverId != null) return "assigned";
        if (b.driverId == null && typeof b.notes === 'string' && b.notes.includes('[DRIVER_DELETED]')) return "driver_left";
        if (scheduledDate > claimOpenCutoff) return "waiting";
        if (scheduledDate >= now && scheduledDate <= claimOpenCutoff) return "claim_open";
        return "all";
      })();

      return {
        id: b.id,
        tripCode: b.tripCode || b.paymentRef || `TRIP-${b.id}`,
        passenger: b.user
          ? { id: b.user.id, name: b.user.name, email: b.user.email, phone: b.user.phone }
          : null,
        driver: b.driver
          ? { id: b.driver.id, name: b.driver.name || "Unknown Driver", email: b.driver.email, phone: b.driver.phone }
          : null,
        pickup: fmtLoc("from", b),
        dropoff: fmtLoc("to", b),
        scheduledAt: (b.scheduledDate ?? b.createdAt)?.toISOString?.() ?? String(b.scheduledDate ?? b.createdAt ?? ""),
        vehicleType: b.vehicleType ?? null,
        amount: Number(b.amount ?? 0),
        currency: b.currency ?? "TZS",
        status: b.status || "PENDING",
        paymentStatus: b.paymentStatus || "PENDING",
        stage: derivedStage,
        claimWindowHours: CLAIM_WINDOW_HOURS,
        claimOpensAt: claimOpensAt.toISOString(),
        canClaimNow,
        claimCount,
        claimLimit,
        claimsRemaining: Math.max(0, claimLimit - claimCount),
        createdAt: (b.createdAt ?? b.updatedAt)?.toISOString?.() ?? String(b.createdAt ?? b.updatedAt ?? ""),
        notes: b.notes ?? null,
      };
    });

    return res.json({ total, page: p, pageSize: ps, items: mapped });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      const p = Number((req.query as any).page ?? 1);
      const ps = Math.min(Number((req.query as any).pageSize ?? 50), 100);
      return res.json({ total: 0, page: p, pageSize: ps, items: [] });
    }
    console.error("Unhandled error in GET /admin/drivers/trips/scheduled:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /admin/drivers/trips/scheduled/:id
 * Fetch one scheduled transport booking with claims.
 */
router.get("/trips/scheduled/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Invalid id" });
    if (!(prisma as any).transportBooking) return res.status(404).json({ error: "Not found" });

    const booking = await (prisma as any).transportBooking.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        driver: { select: { id: true, name: true, email: true, phone: true } },
        property: { select: { id: true, title: true, regionName: true, district: true, ward: true } },
        claims: {
          include: {
            driver: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                isVipDriver: true,
                vehicleType: true,
                region: true,
                operationArea: true,
                suspendedAt: true,
                isDisabled: true,
              },
            },
            reviewer: { select: { id: true, name: true, email: true } },
          },
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
        },
      },
    });

    if (!booking) return res.status(404).json({ error: "Not found" });

    const audits = await prisma.auditLog.findMany({
      where: {
        entity: "TRANSPORT_BOOKING",
        entityId: id,
        action: "TRANSPORT_ASSIGN_DRIVER",
      },
      include: {
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const afterJson = audits[0]?.afterJson as any;
    const latestAssignmentAudit = audits[0]
      ? {
          assignedAt: audits[0].createdAt.toISOString(),
          assignedBy: audits[0].actor,
          kind: typeof afterJson === "object" && afterJson ? (afterJson.kind ?? "ASSIGN") : "ASSIGN",
          reason: typeof afterJson === "object" && afterJson ? afterJson.reason ?? null : null,
          claimId: typeof afterJson === "object" && afterJson ? afterJson.claimId ?? null : null,
          driverId: typeof afterJson === "object" && afterJson ? afterJson.driverId ?? null : null,
        }
      : null;

    const assignmentAudits = audits.map((a) => {
      const aj = a.afterJson as any;
      return {
        assignedAt: a.createdAt.toISOString(),
        assignedBy: a.actor,
        kind: typeof aj === "object" && aj ? (aj.kind ?? "ASSIGN") : "ASSIGN",
        reason: typeof aj === "object" && aj ? aj.reason ?? null : null,
        claimId: typeof aj === "object" && aj ? aj.claimId ?? null : null,
        driverId: typeof aj === "object" && aj ? aj.driverId ?? null : null,
      };
    });

    // Recommendation scoring is server-side only (admins just receive a recommended flag + short reasons).
    const rawClaims = ((booking as any).claims ?? []) as any[];
    const pendingClaims = rawClaims.filter((c) => String(c.status ?? "").toUpperCase() === "PENDING");
    const pendingDriverIds = Array.from(new Set(pendingClaims.map((c) => Number(c.driverId)).filter((x) => Number.isFinite(x) && x > 0)));

    const normalizeArea = (v: unknown) => String(v ?? "").trim().toLowerCase();
    const parseAreas = (v: unknown) =>
      String(v ?? "")
        .split(/[;,|]/g)
        .map((x) => normalizeArea(x))
        .filter(Boolean);
    const allowedAreasForDriver = (d: any) => {
      const areas = new Set<string>();
      const region = normalizeArea(d?.region);
      if (region) areas.add(region);
      for (const a of parseAreas(d?.operationArea)) areas.add(a);
      return Array.from(areas);
    };
    const bookingAreas = [
      normalizeArea((booking as any)?.fromRegion),
      normalizeArea((booking as any)?.toRegion),
      normalizeArea((booking as any)?.property?.regionName),
    ].filter(Boolean);
    const isAreaMatch = (d: any) => {
      const allowed = allowedAreasForDriver(d);
      if (!allowed.length || !bookingAreas.length) return false;
      return bookingAreas.some((a) => allowed.includes(a));
    };

    const normalizeVehicleType = (v: unknown): "BODA" | "BAJAJI" | "CAR" | "XL" | null => {
      const s = String(v ?? "").toLowerCase();
      if (!s) return null;
      if (s.includes("motor") || s.includes("boda") || s.includes("bike")) return "BODA";
      if (s.includes("tuktuk") || s.includes("bajaji") || s.includes("tuk") || s.includes("auto")) return "BAJAJI";
      if (s.includes("xl") || s.includes("van") || s.includes("hiace") || s.includes("coaster") || s.includes("minibus")) return "XL";
      if (s.includes("car") || s.includes("sedan") || s.includes("suv")) return "CAR";
      return null;
    };

    const recommendationByClaimId = new Map<number, { recommended: boolean; score: number; reasons: string[] }>();
    if (pendingDriverIds.length > 0 && (prisma as any).transportBooking?.groupBy) {
      const now = new Date();
      const days = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
      const since90 = days(90);
      const since180 = days(180);
      const since7 = days(7);

      const [statusRows, ratingRows, workloadRows] = await Promise.all([
        (prisma as any).transportBooking.groupBy({
          by: ["driverId", "status"],
          where: {
            driverId: { in: pendingDriverIds },
            scheduledDate: { gte: since90 },
            status: { in: ["COMPLETED", "CANCELED", "CANCELLED"] },
          },
          _count: { _all: true },
        }),
        (prisma as any).transportBooking.groupBy({
          by: ["driverId"],
          where: {
            driverId: { in: pendingDriverIds },
            scheduledDate: { gte: since180 },
            status: "COMPLETED",
            userRating: { not: null },
          },
          _avg: { userRating: true },
        }),
        (prisma as any).transportBooking.groupBy({
          by: ["driverId"],
          where: {
            driverId: { in: pendingDriverIds },
            scheduledDate: { gte: since7 },
            status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
          },
          _count: { _all: true },
        }),
      ]);

      const statsByDriverId = new Map<number, { completed: number; canceled: number }>();
      for (const r of statusRows ?? []) {
        const driverId = Number((r as any).driverId);
        if (!Number.isFinite(driverId)) continue;
        const status = String((r as any).status ?? "").toUpperCase();
        const count = Number((r as any)?._count?._all ?? 0);
        const prev = statsByDriverId.get(driverId) || { completed: 0, canceled: 0 };
        if (status === "COMPLETED") prev.completed += count;
        if (status === "CANCELED" || status === "CANCELLED") prev.canceled += count;
        statsByDriverId.set(driverId, prev);
      }

      const avgRatingByDriverId = new Map<number, number>();
      for (const r of ratingRows ?? []) {
        const driverId = Number((r as any).driverId);
        const avg = (r as any)?._avg?.userRating;
        const n = typeof avg === "number" ? avg : Number(avg);
        if (Number.isFinite(driverId) && Number.isFinite(n)) avgRatingByDriverId.set(driverId, n);
      }

      const workloadByDriverId = new Map<number, number>();
      for (const r of workloadRows ?? []) {
        const driverId = Number((r as any).driverId);
        const cnt = Number((r as any)?._count?._all ?? 0);
        if (Number.isFinite(driverId)) workloadByDriverId.set(driverId, cnt);
      }

      const claimOrder = [...pendingClaims]
        .sort((a, b) => new Date(String(a.createdAt ?? 0)).getTime() - new Date(String(b.createdAt ?? 0)).getTime())
        .map((c) => Number(c.id));
      const rankByClaimId = new Map<number, number>();
      claimOrder.forEach((id, idx) => rankByClaimId.set(id, idx));
      const denom = Math.max(1, claimOrder.length - 1);

      const bookingVehicleType = String((booking as any).vehicleType ?? "").toUpperCase();

      let best: { claimId: number; score: number; reasons: string[] } | null = null;

      for (const c of pendingClaims) {
        const claimId = Number(c.id);
        const driver = c.driver;
        const driverId = Number(driver?.id);
        if (!Number.isFinite(claimId) || !Number.isFinite(driverId)) continue;

        const reasons: string[] = [];

        // Hard disqualifiers (premium/security posture): disabled/suspended drivers should never be recommended.
        if (driver?.isDisabled || driver?.suspendedAt) {
          recommendationByClaimId.set(claimId, { recommended: false, score: -999, reasons: ["Driver not eligible"] });
          continue;
        }

        if (bookingVehicleType === "PREMIUM" && !Boolean(driver?.isVipDriver)) {
          recommendationByClaimId.set(claimId, { recommended: false, score: -999, reasons: ["VIP required"] });
          continue;
        }

        if (bookingVehicleType && ["BODA", "BAJAJI", "CAR", "XL"].includes(bookingVehicleType)) {
          const driverNorm = normalizeVehicleType(driver?.vehicleType);
          if (!driverNorm) {
            recommendationByClaimId.set(claimId, { recommended: false, score: -999, reasons: ["Vehicle type not set"] });
            continue;
          }
          if (driverNorm !== bookingVehicleType) {
            recommendationByClaimId.set(claimId, { recommended: false, score: -999, reasons: ["Vehicle mismatch"] });
            continue;
          }
        }

        const { completed, canceled } = statsByDriverId.get(driverId) || { completed: 0, canceled: 0 };
        const totalReviewed = completed + canceled;
        const completionRate = totalReviewed > 0 ? completed / totalReviewed : 0.75;
        const reliability = 45 * Math.max(0, Math.min(1, completionRate));
        if (reliability >= 35) reasons.push("High reliability");

        const experienceBonus = 5 * Math.max(0, Math.min(1, completed / 20));
        if (completed >= 10) reasons.push("Experienced");

        const avgRatingRaw = avgRatingByDriverId.get(driverId);
        const hasAvgRating = typeof avgRatingRaw === "number" && Number.isFinite(avgRatingRaw);
        const avgRating = hasAvgRating ? avgRatingRaw : null;
        const ratingScore = avgRating != null ? (Math.max(0, Math.min(5, avgRating)) / 5) * 10 : 6;
        if (avgRating != null && avgRating >= 4.5) reasons.push("Top rated");

        const workload7d = workloadByDriverId.get(driverId) ?? 0;
        const fairness = 5 * Math.max(0, 1 - Math.min(1, workload7d / 10));
        if (workload7d <= 2) reasons.push("Low recent workload");

        const area = isAreaMatch(driver) ? 8 : 0;
        if (area > 0) reasons.push("In service area");

        const rank = rankByClaimId.get(claimId) ?? 0;
        const claimSpeed = 2 * (1 - rank / denom);
        if (claimSpeed > 1.5) reasons.push("Fast response");

        const score = reliability + experienceBonus + ratingScore + fairness + area + claimSpeed;
        recommendationByClaimId.set(claimId, { recommended: false, score, reasons: reasons.slice(0, 3) });

        if (!best || score > best.score) {
          best = { claimId, score, reasons: reasons.slice(0, 3) };
        }
      }

      if (best) {
        const prev = recommendationByClaimId.get(best.claimId);
        if (prev) recommendationByClaimId.set(best.claimId, { ...prev, recommended: true });
      }
    }

    return res.json({
      booking: {
        id: booking.id,
        tripCode: booking.tripCode || booking.paymentRef || `TRIP-${booking.id}`,
        scheduledAt: (booking.scheduledDate ?? booking.createdAt)?.toISOString?.() ?? String(booking.scheduledDate ?? booking.createdAt ?? ""),
        vehicleType: booking.vehicleType ?? null,
        amount: Number((booking as any).amount ?? 0),
        currency: (booking as any).currency ?? "TZS",
        status: (booking as any).status || "PENDING",
        paymentStatus: (booking as any).paymentStatus || "PENDING",
        pickup: {
          address: (booking as any).fromAddress ?? null,
          ward: (booking as any).fromWard ?? null,
          district: (booking as any).fromDistrict ?? null,
          region: (booking as any).fromRegion ?? null,
        },
        dropoff: {
          address: (booking as any).toAddress ?? null,
          ward: (booking as any).toWard ?? null,
          district: (booking as any).toDistrict ?? null,
          region: (booking as any).toRegion ?? null,
        },
        passenger: booking.user,
        driver: booking.driver,
        property: booking.property,
        createdAt: (booking.createdAt ?? (booking as any).updatedAt)?.toISOString?.() ?? String(booking.createdAt ?? (booking as any).updatedAt ?? ""),
      },
      assignmentAudit: latestAssignmentAudit,
      assignmentAudits,
      claims: (booking as any).claims.map((c: any) => ({
        id: c.id,
        status: c.status,
        createdAt: (c.createdAt ?? c.updatedAt)?.toISOString?.() ?? String(c.createdAt ?? c.updatedAt ?? ""),
        reviewedAt: c.reviewedAt ? new Date(c.reviewedAt).toISOString() : null,
        driver: c.driver,
        reviewer: c.reviewer,
        recommendation: (() => {
          const id = Number(c.id);
          if (!Number.isFinite(id)) return null;
          const r = recommendationByClaimId.get(id);
          if (!r) return null;
          return { recommended: r.recommended, score: Math.round(r.score * 10) / 10, reasons: r.reasons };
        })(),
      })),
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      return res.status(404).json({ error: "Not found" });
    }
    console.error("Unhandled error in GET /admin/drivers/trips/scheduled/:id:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /admin/drivers/trips/scheduled/:id/award
 * Body: { claimId: number }
 * Assigns the booking to the claim's driver and accepts/rejects claims.
 */
router.post("/trips/scheduled/:id/award", async (req, res) => {
  try {
    const r = req as any;
    const adminId = Number(r?.user?.id);
    const bookingId = Number(req.params.id);
    const claimId = Number((req.body as any)?.claimId);
    const reason = String((req.body as any)?.reason ?? "").trim();

    if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: "Invalid id" });
    if (!Number.isFinite(claimId) || claimId <= 0) return res.status(400).json({ error: "claimId is required" });
    if (!reason) return res.status(400).json({ error: "reason is required" });

    if (!(prisma as any).transportBooking || !(prisma as any).transportBookingClaim) {
      return res.status(409).json({ error: "Claims model not available" });
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const booking = await (tx as any).transportBooking.findUnique({
        where: { id: bookingId },
        select: {
          id: true, driverId: true, paymentStatus: true, status: true,
          tripCode: true,
          scheduledDate: true, pickupTime: true, pickupLocation: true,
          fromRegion: true, fromDistrict: true, fromWard: true, fromAddress: true,
          toRegion: true, toDistrict: true, toWard: true, toAddress: true,
          vehicleType: true, amount: true, currency: true,
        },
      });
      if (!booking) throw new Error("Booking not found");
      if (booking.driverId != null) {
        const err: any = new Error("Booking already assigned");
        err.code = "ALREADY_ASSIGNED";
        throw err;
      }
      if (String(booking.paymentStatus ?? "").toUpperCase() !== "PAID") {
        const err: any = new Error("Booking is not paid");
        err.code = "NOT_PAID";
        throw err;
      }

      const claim = await (tx as any).transportBookingClaim.findUnique({
        where: { id: claimId },
        select: { id: true, bookingId: true, driverId: true, status: true },
      });
      if (!claim || claim.bookingId !== bookingId) throw new Error("Claim not found");
      if (claim.status !== "PENDING") {
        const err: any = new Error("Claim is not pending");
        err.code = "CLAIM_NOT_PENDING";
        throw err;
      }

      // Capture rejected claimants before the updateMany so we can notify them.
      const pendingRejectedClaims = await (tx as any).transportBookingClaim.findMany({
        where: { bookingId, id: { not: claimId }, status: "PENDING" },
        select: { id: true, driverId: true },
      });

      const updatedBooking = await (tx as any).transportBooking.update({
        where: { id: bookingId },
        data: {
          driverId: claim.driverId,
          status: "CONFIRMED",
        },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          driver: { select: { id: true, name: true, email: true, phone: true } },
        },
      });

      await (tx as any).transportBookingClaim.update({
        where: { id: claimId },
        data: {
          status: "ACCEPTED",
          reviewedAt: now,
          reviewedBy: Number.isFinite(adminId) ? adminId : null,
        },
      });

      await (tx as any).transportBookingClaim.updateMany({
        where: { bookingId, id: { not: claimId }, status: "PENDING" },
        data: {
          status: "REJECTED",
          reviewedAt: now,
          reviewedBy: Number.isFinite(adminId) ? adminId : null,
        },
      });

      // Persist assignment audit trail using existing audit tables (no schema changes required).
      await (tx as any).auditLog.create({
        data: {
          actorId: Number.isFinite(adminId) ? adminId : null,
          actorRole: "ADMIN",
          action: "TRANSPORT_ASSIGN_DRIVER",
          entity: "TRANSPORT_BOOKING",
          entityId: bookingId,
          beforeJson: { driverId: null },
          afterJson: { bookingId, claimId, driverId: claim.driverId, reason },
          ip: (req.headers["x-forwarded-for"] as string) || (req.socket as any)?.remoteAddress || null,
          ua: String(req.headers["user-agent"] || ""),
        },
      });

      if (Number.isFinite(adminId)) {
        await (tx as any).adminAudit.create({
          data: {
            adminId,
            targetUserId: claim.driverId,
            action: "TRANSPORT_ASSIGN_DRIVER",
            details: { bookingId, tripCode: booking.tripCode ?? null, claimId, driverId: claim.driverId, reason },
          },
        });
      }

      // ── Build human-readable trip detail strings for notifications ──────────
      const tripDateLabel = booking.scheduledDate
        ? new Date(booking.scheduledDate).toLocaleDateString("en-GB", {
            weekday: "long", day: "2-digit", month: "long", year: "numeric",
          })
        : "the scheduled date";
      const fromLabel = [booking.fromAddress, booking.fromWard, booking.fromDistrict, booking.fromRegion]
        .filter(Boolean).join(", ") || "Origin";
      const toLabel = [booking.toAddress, booking.toWard, booking.toDistrict, booking.toRegion]
        .filter(Boolean).join(", ") || "Destination";
      const amountLabel = booking.amount
        ? `${booking.currency || "TZS"} ${Number(booking.amount).toLocaleString()}`
        : null;
      const vehicleLabel = booking.vehicleType ? ` · ${booking.vehicleType}` : "";

      // Notification for the awarded driver
      try {
        await tx.notification.create({
          data: {
            userId: claim.driverId,
            title: "Trip awarded to you",
            body: [
              `Congratulations! You have been selected for the trip on ${tripDateLabel}.`,
              `Route: ${fromLabel} → ${toLabel}${vehicleLabel}`,
              amountLabel ? `Fare: ${amountLabel}` : null,
              booking.pickupLocation ? `Pickup point: ${booking.pickupLocation}` : null,
              `Open the Trips tab for full details and to confirm your readiness.`,
            ].filter(Boolean).join("\n"),
            unread: true,
            type: "ride",
            meta: {
              status: "CLAIM_AWARDED",
              transportBookingId: bookingId,
              claimId,
              tripDate: booking.scheduledDate,
              pickupTime: booking.pickupTime,
              pickupLocation: booking.pickupLocation,
              from: fromLabel,
              to: toLabel,
              vehicleType: booking.vehicleType,
              amount: booking.amount ? Number(booking.amount) : null,
              currency: booking.currency,
              link: `/driver/trips/${bookingId}`,
            },
          },
        });
      } catch (notifErr) {
        console.warn("[award] failed to create award notification:", notifErr);
      }

      // Encouraging notifications for drivers whose claims were not selected
      for (const rejected of pendingRejectedClaims) {
        try {
          await tx.notification.create({
            data: {
              userId: rejected.driverId,
              title: "Thank you for your offer",
              body: [
                `Your offer for the trip on ${tripDateLabel} (${fromLabel} → ${toLabel}) was carefully reviewed.`,
                `This trip was awarded to another driver who was the best match for this route.`,
                `We truly value your dedication as part of the NoLSAF family. Do not be discouraged — keep claiming trips and your commitment will be rewarded soon.`,
                `Thank you for being with us!`,
              ].join("\n"),
              unread: true,
              type: "ride",
              meta: {
                status: "CLAIM_NOT_SELECTED",
                transportBookingId: bookingId,
                tripDate: booking.scheduledDate,
                from: fromLabel,
                to: toLabel,
              },
            },
          });
        } catch (notifErr) {
          console.warn("[award] failed to create rejection notification for driver", rejected.driverId, ":", notifErr);
        }
      }

      return { updatedBooking, claimDriverId: claim.driverId, rejectedDriverIds: pendingRejectedClaims.map((c: any) => c.driverId), tripDateLabel, fromLabel, toLabel, amountLabel, vehicleLabel };
    }, { timeout: 15000 });

    // ── Post-transaction: real-time socket events ─────────────────────────────
    try {
      const io = (req.app as any)?.get?.("io");
      if (io && typeof io.to === "function") {
        const { claimDriverId, rejectedDriverIds } = result as any;
        io.to(`driver:${claimDriverId}`).emit("notification:new", { type: "driver" });
        io.to(`driver:${claimDriverId}`).emit("transport:booking:claim_awarded", { transportBookingId: bookingId, claimId });
        for (const dId of (rejectedDriverIds as number[])) {
          io.to(`driver:${dId}`).emit("notification:new", { type: "driver" });
        }
      }
    } catch (socketErr) {
      console.warn("[award] socket emit error:", socketErr);
    }

    // ── Post-transaction: SMS to the awarded driver ───────────────────────────
    try {
      const { updatedBooking, tripDateLabel, fromLabel, toLabel, amountLabel, vehicleLabel } = result as any;
      const driverPhone: string | undefined = updatedBooking?.driver?.phone;
      const driverName: string = updatedBooking?.driver?.name || "Driver";
      if (driverPhone) {
        const smsBody = [
          `Congratulations ${driverName}! Your offer has been accepted.`,
          `Trip: ${tripDateLabel}`,
          `Route: ${fromLabel} → ${toLabel}${vehicleLabel}`,
          amountLabel ? `Fare: ${amountLabel}` : null,
          `Open the NoLSAF Driver app for full details. - NoLSAF Team`,
        ].filter(Boolean).join(" | ");
        await sendSms(driverPhone, smsBody).catch((smsErr: any) =>
          console.warn("[award] SMS to awarded driver failed:", smsErr?.message || smsErr)
        );
      }
    } catch (smsErr) {
      console.warn("[award] SMS dispatch error:", smsErr);
    }

    return res.json({ success: true, booking: (result as any).updatedBooking });
  } catch (error: any) {
    const status =
      error?.code === "ALREADY_ASSIGNED" ? 409 :
      error?.code === "NOT_PAID" ? 409 :
      error?.code === "CLAIM_NOT_PENDING" ? 409 :
      error?.message?.includes("not found") ? 404 :
      500;
    console.error("POST /admin/drivers/trips/scheduled/:id/award error:", error);
    return res.status(status).json({ error: error?.message || "Failed to award" });
  }
});

/**
 * POST /admin/drivers/trips/scheduled/:id/reassign
 * Body: { claimId: number, reason: string }
 * Reassigns an already-assigned booking to a different claim's driver.
 */
router.post("/trips/scheduled/:id/reassign", async (req, res) => {
  try {
    const r = req as any;
    const adminId = Number(r?.user?.id);
    const bookingId = Number(req.params.id);
    const claimId = Number((req.body as any)?.claimId);
    const reason = String((req.body as any)?.reason ?? "").trim();

    if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: "Invalid id" });
    if (!Number.isFinite(claimId) || claimId <= 0) return res.status(400).json({ error: "claimId is required" });
    if (!reason) return res.status(400).json({ error: "reason is required" });

    if (!(prisma as any).transportBooking || !(prisma as any).transportBookingClaim) {
      return res.status(409).json({ error: "Claims model not available" });
    }

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const booking = await (tx as any).transportBooking.findUnique({
        where: { id: bookingId },
        select: { id: true, driverId: true, paymentStatus: true, status: true, tripCode: true },
      });
      if (!booking) throw new Error("Booking not found");
      if (booking.driverId == null) {
        const err: any = new Error("Booking is not assigned yet");
        err.code = "NOT_ASSIGNED";
        throw err;
      }

      const bookingStatus = String(booking.status ?? "").toUpperCase();
      if (["IN_PROGRESS", "COMPLETED", "CANCELED", "CANCELLED"].includes(bookingStatus)) {
        const err: any = new Error("Cannot reassign this booking at its current status");
        err.code = "BAD_STATUS";
        throw err;
      }

      if (String(booking.paymentStatus ?? "").toUpperCase() !== "PAID") {
        const err: any = new Error("Booking is not paid");
        err.code = "NOT_PAID";
        throw err;
      }

      const claim = await (tx as any).transportBookingClaim.findUnique({
        where: { id: claimId },
        select: { id: true, bookingId: true, driverId: true },
      });
      if (!claim || claim.bookingId !== bookingId) throw new Error("Claim not found");

      if (Number(claim.driverId) === Number(booking.driverId)) {
        const err: any = new Error("Selected driver is already assigned");
        err.code = "SAME_DRIVER";
        throw err;
      }

      const updatedBooking = await (tx as any).transportBooking.update({
        where: { id: bookingId },
        data: {
          driverId: claim.driverId,
          status: "CONFIRMED",
        },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          driver: { select: { id: true, name: true, email: true, phone: true } },
        },
      });

      // Make the selected claim accepted and ensure no other claim remains accepted.
      await (tx as any).transportBookingClaim.update({
        where: { id: claimId },
        data: {
          status: "ACCEPTED",
          reviewedAt: now,
          reviewedBy: Number.isFinite(adminId) ? adminId : null,
        },
      });

      await (tx as any).transportBookingClaim.updateMany({
        where: {
          bookingId,
          id: { not: claimId },
          status: { in: ["PENDING", "ACCEPTED"] },
        },
        data: {
          status: "REJECTED",
          reviewedAt: now,
          reviewedBy: Number.isFinite(adminId) ? adminId : null,
        },
      });

      await (tx as any).auditLog.create({
        data: {
          actorId: Number.isFinite(adminId) ? adminId : null,
          actorRole: "ADMIN",
          action: "TRANSPORT_ASSIGN_DRIVER",
          entity: "TRANSPORT_BOOKING",
          entityId: bookingId,
          beforeJson: { driverId: booking.driverId },
          afterJson: {
            bookingId,
            claimId,
            driverId: claim.driverId,
            reason,
            kind: "REASSIGN",
            reassignedFromDriverId: booking.driverId,
          },
          ip: (req.headers["x-forwarded-for"] as string) || (req.socket as any)?.remoteAddress || null,
          ua: String(req.headers["user-agent"] || ""),
        },
      });

      if (Number.isFinite(adminId)) {
        await (tx as any).adminAudit.create({
          data: {
            adminId,
            targetUserId: claim.driverId,
            action: "TRANSPORT_ASSIGN_DRIVER",
            details: {
              bookingId,
              tripCode: booking.tripCode ?? null,
              claimId,
              driverId: claim.driverId,
              reason,
              kind: "REASSIGN",
              reassignedFromDriverId: booking.driverId,
            },
          },
        });
      }

      return updatedBooking;
    });

    return res.json({ success: true, booking: result });
  } catch (error: any) {
    const status =
      error?.code === "NOT_ASSIGNED" ? 409 :
      error?.code === "NOT_PAID" ? 409 :
      error?.code === "SAME_DRIVER" ? 409 :
      error?.code === "BAD_STATUS" ? 409 :
      error?.message?.includes("not found") ? 404 :
      500;
    console.error("POST /admin/drivers/trips/scheduled/:id/reassign error:", error);
    return res.status(status).json({ error: error?.message || "Failed to reassign" });
  }
});

/**
 * POST /admin/drivers/trips/scheduled/:id/unassign
 * Body: { reason: string }
 * Removes assigned driver and reopens claims.
 */
router.post("/trips/scheduled/:id/unassign", async (req, res) => {
  try {
    const r = req as any;
    const adminId = Number(r?.user?.id);
    const bookingId = Number(req.params.id);
    const reason = String((req.body as any)?.reason ?? "").trim();

    if (!Number.isFinite(bookingId) || bookingId <= 0) return res.status(400).json({ error: "Invalid id" });
    if (!reason) return res.status(400).json({ error: "reason is required" });

    if (!(prisma as any).transportBooking || !(prisma as any).transportBookingClaim) {
      return res.status(409).json({ error: "Claims model not available" });
    }

    const result = await prisma.$transaction(async (tx) => {
      const booking = await (tx as any).transportBooking.findUnique({
        where: { id: bookingId },
        select: { id: true, driverId: true, paymentStatus: true, status: true, tripCode: true },
      });
      if (!booking) throw new Error("Booking not found");
      if (booking.driverId == null) {
        const err: any = new Error("Booking is not assigned");
        err.code = "NOT_ASSIGNED";
        throw err;
      }

      const bookingStatus = String(booking.status ?? "").toUpperCase();
      if (["IN_PROGRESS", "COMPLETED", "CANCELED", "CANCELLED"].includes(bookingStatus)) {
        const err: any = new Error("Cannot unassign this booking at its current status");
        err.code = "BAD_STATUS";
        throw err;
      }

      if (String(booking.paymentStatus ?? "").toUpperCase() !== "PAID") {
        const err: any = new Error("Booking is not paid");
        err.code = "NOT_PAID";
        throw err;
      }

      const prevDriverId = booking.driverId;

      const updatedBooking = await (tx as any).transportBooking.update({
        where: { id: bookingId },
        data: {
          driverId: null,
          status: "PENDING",
        },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
          driver: { select: { id: true, name: true, email: true, phone: true } },
        },
      });

      // Reopen claims for re-awarding.
      await (tx as any).transportBookingClaim.updateMany({
        where: { bookingId },
        data: {
          status: "PENDING",
          reviewedAt: null,
          reviewedBy: null,
        },
      });

      await (tx as any).auditLog.create({
        data: {
          actorId: Number.isFinite(adminId) ? adminId : null,
          actorRole: "ADMIN",
          action: "TRANSPORT_ASSIGN_DRIVER",
          entity: "TRANSPORT_BOOKING",
          entityId: bookingId,
          beforeJson: { driverId: prevDriverId },
          afterJson: { bookingId, driverId: null, reason, kind: "UNASSIGN", unassignedDriverId: prevDriverId },
          ip: (req.headers["x-forwarded-for"] as string) || (req.socket as any)?.remoteAddress || null,
          ua: String(req.headers["user-agent"] || ""),
        },
      });

      if (Number.isFinite(adminId)) {
        await (tx as any).adminAudit.create({
          data: {
            adminId,
            targetUserId: prevDriverId,
            action: "TRANSPORT_ASSIGN_DRIVER",
            details: { bookingId, tripCode: booking.tripCode ?? null, driverId: null, reason, kind: "UNASSIGN", unassignedDriverId: prevDriverId },
          },
        });
      }

      return updatedBooking;
    });

    return res.json({ success: true, booking: result });
  } catch (error: any) {
    const status =
      error?.code === "NOT_ASSIGNED" ? 409 :
      error?.code === "NOT_PAID" ? 409 :
      error?.code === "BAD_STATUS" ? 409 :
      error?.message?.includes("not found") ? 404 :
      500;
    console.error("POST /admin/drivers/trips/scheduled/:id/unassign error:", error);
    return res.status(status).json({ error: error?.message || "Failed to unassign" });
  }
});

/** GET /admin/drivers/invoices?driverId=&status=&date=&start=&end=&page=&pageSize=&q= */
router.get("/invoices", async (req, res) => {
  try {
    const { driverId, status, date, start, end, page = "1", pageSize = "50", q = "" } = req.query as any;

    if (!(prisma as any).transportPayout) {
      return res.json({ total: 0, page: Number(page), pageSize: Math.min(Number(pageSize), 100), items: [] });
    }

    const where: any = {};

    if (typeof driverId !== "undefined" && String(driverId).trim() !== "") {
      const did = Number(driverId);
      if (Number.isFinite(did) && did > 0) {
        where.driverId = did;
      }
    }

    if (status) {
      where.status = status;
    }

    if (date) {
      const s = new Date(String(date) + "T00:00:00.000Z");
      const e = new Date(String(date) + "T23:59:59.999Z");
      where.createdAt = { gte: s, lte: e };
    } else if (start || end) {
      const s = start ? new Date(String(start) + "T00:00:00.000Z") : new Date(0);
      const e = end ? new Date(String(end) + "T23:59:59.999Z") : new Date();
      where.createdAt = { gte: s, lte: e };
    }

    if (q) {
      const term = String(q).trim();
      if (term) {
        where.OR = [
          { paymentRef: { contains: term } },
          { paymentMethod: { contains: term } },
          { booking: { is: { tripCode: { contains: term } } } },
          { driver: { is: { name: { contains: term } } } },
          { driver: { is: { email: { contains: term } } } },
        ];
      }
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    const [payouts, total] = await Promise.all([
      (prisma as any).transportPayout.findMany({
        where,
        include: {
          driver: {
            select: { id: true, name: true, email: true, phone: true },
          },
          booking: {
            select: {
              id: true,
              tripCode: true,
              status: true,
              scheduledDate: true,
              fromAddress: true,
              fromWard: true,
              fromDistrict: true,
              fromRegion: true,
              fromLatitude: true,
              fromLongitude: true,
              toAddress: true,
              toWard: true,
              toDistrict: true,
              toRegion: true,
              toLatitude: true,
              toLongitude: true,
              vehicleType: true,
              amount: true,
              currency: true,
            },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      (prisma as any).transportPayout.count({ where }),
    ]);

    const driverIds = [
      ...new Set((payouts as any[]).map((p: any) => Number(p.driverId)).filter((id: number) => Number.isFinite(id))),
    ];
    let withdrawals: any[] = [];
    if ((prisma as any).referralWithdrawal && driverIds.length > 0) {
      withdrawals = await (prisma as any).referralWithdrawal.findMany({
        where: { driverId: { in: driverIds } },
        orderBy: { createdAt: "desc" },
        take: Math.max(100, take * 4),
      });
    }

    const findWithdrawalForPayout = (p: any) => {
      const net = Number(p.netPaid ?? 0);
      return withdrawals.find((w: any) => (
        Number(w.driverId) === Number(p.driverId) &&
        String(w.status || "").toUpperCase() === String(p.status || "").toUpperCase() &&
        Math.round(Number(w.totalAmount ?? 0)) === Math.round(net)
      )) ?? withdrawals.find((w: any) => (
        Number(w.driverId) === Number(p.driverId) &&
        Math.round(Number(w.totalAmount ?? 0)) === Math.round(net)
      )) ?? null;
    };

    const coordinateText = (lat: any, lng: any) => {
      if (lat == null || lng == null) return null;
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
      return `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
    };

    const routeText = (b: any) => ({
      pickup: b?.fromAddress || [b?.fromWard, b?.fromDistrict, b?.fromRegion].filter(Boolean).join(", ") || "N/A",
      dropoff: b?.toAddress || [b?.toWard, b?.toDistrict, b?.toRegion].filter(Boolean).join(", ") || "N/A",
      pickupCoordinate: coordinateText(b?.fromLatitude, b?.fromLongitude),
      dropoffCoordinate: coordinateText(b?.toLatitude, b?.toLongitude),
    });

    const mapped = (payouts as any[]).map((p: any) => {
      const withdrawal = findWithdrawalForPayout(p);
      const route = routeText(p.booking);
      return {
        id: Number(p.id),
        payoutId: Number(p.id),
        invoiceId: withdrawal ? Number(withdrawal.id) : null,
        invoiceNumber: withdrawal ? `WD-${withdrawal.id}` : `DP-${p.id}`,
        receiptNumber: withdrawal?.paymentRef ?? p.paymentRef ?? null,
        trip: p.booking
          ? {
              id: Number(p.booking.id),
              code: p.booking.tripCode || p.paymentRef || `TRIP-${p.booking.id}`,
              status: p.booking.status || "COMPLETED",
              scheduledAt: p.booking.scheduledDate ? new Date(p.booking.scheduledDate).toISOString() : null,
              pickup: route.pickup,
              dropoff: route.dropoff,
              pickupCoordinate: route.pickupCoordinate,
              dropoffCoordinate: route.dropoffCoordinate,
              vehicleType: p.booking.vehicleType ?? null,
            }
          : null,
        driver: p.driver
        ? {
            id: Number(p.driver.id),
            name: p.driver.name || "Unknown Driver",
            email: p.driver.email,
            phone: p.driver.phone,
          }
        : null,
        amount: Number(p.netPaid ?? 0),
        currency: p.currency || p.booking?.currency || "TZS",
        gross: Number(p.grossAmount ?? p.booking?.amount ?? 0),
        commissionPercent: Number(p.commissionPercent ?? 0),
        commissionAmount: Number(p.commissionAmount ?? 0),
        status: p.status || "PENDING",
        paymentMethod: withdrawal?.paymentMethod ?? p.paymentMethod ?? null,
        paymentRef: withdrawal?.paymentRef ?? p.paymentRef ?? null,
        adminNotes: withdrawal?.adminNotes ?? null,
        requestedAt: (withdrawal?.createdAt ?? p.createdAt)?.toISOString?.() ?? String(withdrawal?.createdAt ?? p.createdAt ?? ""),
        issuedAt: (withdrawal?.createdAt ?? p.createdAt)?.toISOString?.() ?? String(withdrawal?.createdAt ?? p.createdAt ?? ""),
        createdAt: (withdrawal?.createdAt ?? p.createdAt)?.toISOString?.() ?? String(withdrawal?.createdAt ?? p.createdAt ?? ""),
      };
    });

    return res.json({ total, page: Number(page), pageSize: take, items: mapped });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver invoices:', err.message);
      const page = Number((req.query as any).page ?? 1);
      const pageSize = Math.min(Number((req.query as any).pageSize ?? 50), 100);
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      console.warn('Prisma validation error when querying driver invoices:', err.message);
      const page = Number((req.query as any).page ?? 1);
      const pageSize = Math.min(Number((req.query as any).pageSize ?? 50), 100);
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    console.error('Unhandled error in GET /admin/drivers/invoices:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/invoices/stats?period=7d|30d|month|year */
router.get("/invoices/stats", async (req, res) => {
  try {
    const { period = "30d" } = req.query as any;
    
    let startDate: Date;
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    // Calculate start date based on period
    switch (period) {
      case "7d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        break;
      case "month":
        startDate = new Date();
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "year":
        startDate = new Date();
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      default:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
    }
    startDate.setHours(0, 0, 0, 0);

    // Driver "invoice" statistics: use ReferralWithdrawal (driver withdrawal applications)
    const withdrawals = await prisma.referralWithdrawal.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        createdAt: true,
        status: true,
        totalAmount: true,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    // Group by date
    const dateMap = new Map<string, { count: number; paid: number; amount: number }>();
    
    withdrawals.forEach((w: any) => {
      const dateKey = w.createdAt.toISOString().split("T")[0];
      const existing = dateMap.get(dateKey) || { count: 0, paid: 0, amount: 0 };
      existing.count += 1;
      if (w.status === "PAID") {
        existing.paid += 1;
      }
      existing.amount += Number(w.totalAmount ?? 0);
      dateMap.set(dateKey, existing);
    });

    // Convert to array and sort
    const stats = Array.from(dateMap.entries())
      .map(([date, data]) => ({
        date,
        count: data.count,
        paid: data.paid,
        amount: data.amount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return res.json({ stats, period, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying invoice stats:', err.message);
      return res.json({ stats: [], period: (req.query as any).period || "30d", startDate: new Date().toISOString(), endDate: new Date().toISOString() });
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      console.warn('Prisma validation error when querying invoice stats:', err.message);
      return res.json({ stats: [], period: (req.query as any).period || "30d", startDate: new Date().toISOString(), endDate: new Date().toISOString() });
    }
    console.error('Unhandled error in GET /admin/drivers/invoices/stats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/invoices/:id - full trip payout invoice review details */
router.get("/invoices/:id(\\d+)", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid_invoice_id" });
    if (!(prisma as any).transportPayout) return res.status(400).json({ error: "Driver payout invoices are not available" });

    const payout = await (prisma as any).transportPayout.findUnique({
      where: { id },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            payout: true,
            paymentPhone: true,
            vehicleType: true,
            plateNumber: true,
            kycStatus: true,
          },
        },
        approver: { select: { id: true, name: true, email: true } },
        payer: { select: { id: true, name: true, email: true } },
        booking: {
          select: {
            id: true,
            tripCode: true,
            status: true,
            paymentStatus: true,
            paymentMethod: true,
            paymentRef: true,
            scheduledDate: true,
            pickupTime: true,
            dropoffTime: true,
            fromAddress: true,
            fromWard: true,
            fromDistrict: true,
            fromRegion: true,
            fromLatitude: true,
            fromLongitude: true,
            toAddress: true,
            toWard: true,
            toDistrict: true,
            toRegion: true,
            toLatitude: true,
            toLongitude: true,
            vehicleType: true,
            numberOfPassengers: true,
            amount: true,
            currency: true,
            notes: true,
            userRating: true,
            userReview: true,
            driverRating: true,
            driverReview: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, name: true, email: true, phone: true } },
            offers: {
              select: { id: true, status: true, driverId: true, distanceKm: true, score: true },
              orderBy: { createdAt: "desc" },
              take: 5,
            },
          },
        },
      },
    });

    if (!payout) return res.status(404).json({ error: "Driver payout invoice not found" });

    let withdrawal: any = null;
    if ((prisma as any).referralWithdrawal) {
      withdrawal = await (prisma as any).referralWithdrawal.findFirst({
        where: {
          driverId: payout.driverId,
          totalAmount: payout.netPaid,
        },
        orderBy: { createdAt: "desc" },
      });
    }

    let verifiedAudit: any = null;
    let approvedAudit: any = null;
    try {
      if ((prisma as any).adminAudit) {
        const auditRows = await (prisma as any).adminAudit.findMany({
          where: {
            targetUserId: payout.driverId,
            action: { in: ["DRIVER_PAYOUT_INVOICE_VERIFY", "DRIVER_PAYOUT_INVOICE_APPROVE"] },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            admin: { select: { id: true, name: true, email: true } },
          },
        });

        for (const row of auditRows as any[]) {
          const details = row?.details && typeof row.details === "object" ? row.details : {};
          if (Number((details as any).invoiceId) !== Number(payout.id)) continue;
          if (!verifiedAudit && row.action === "DRIVER_PAYOUT_INVOICE_VERIFY") verifiedAudit = row;
          if (!approvedAudit && row.action === "DRIVER_PAYOUT_INVOICE_APPROVE") approvedAudit = row;
          if (verifiedAudit && approvedAudit) break;
        }
      }
    } catch (auditErr: any) {
      console.warn("Failed to load driver invoice audit timestamps:", auditErr?.message ?? auditErr);
    }

    const coordinateText = (lat: any, lng: any) => {
      if (lat == null || lng == null) return null;
      const latNum = Number(lat);
      const lngNum = Number(lng);
      if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return null;
      return `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
    };

    const distanceKm = (fromLat: any, fromLng: any, toLat: any, toLng: any) => {
      const lat1 = Number(fromLat);
      const lng1 = Number(fromLng);
      const lat2 = Number(toLat);
      const lng2 = Number(toLng);
      if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return null;
      const toRad = (value: number) => (value * Math.PI) / 180;
      const earthKm = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLng = toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
      return Math.round(earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
    };

    const durationMinutes = (start: any, end: any) => {
      if (!start || !end) return null;
      const startedAt = new Date(start).getTime();
      const endedAt = new Date(end).getTime();
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || endedAt < startedAt) return null;
      return Math.round((endedAt - startedAt) / 60000);
    };

    const notesUpper = String(payout.booking?.notes || "").toUpperCase();
    const acceptedOffer = (payout.booking?.offers || []).find((offer: any) => String(offer?.status || "").toUpperCase() === "ACCEPTED");
    const tripType = notesUpper.includes("AUTO_DISPATCH") || acceptedOffer
      ? "AUTO_DISPATCHED"
      : "SCHEDULED";
    const tripDistanceKm = distanceKm(
      payout.booking?.fromLatitude,
      payout.booking?.fromLongitude,
      payout.booking?.toLatitude,
      payout.booking?.toLongitude,
    );
    const tripDurationMinutes = durationMinutes(payout.booking?.pickupTime, payout.booking?.dropoffTime);

    const route = {
      pickup:
        payout.booking?.fromAddress ||
        [payout.booking?.fromWard, payout.booking?.fromDistrict, payout.booking?.fromRegion].filter(Boolean).join(", ") ||
        "N/A",
      dropoff:
        payout.booking?.toAddress ||
        [payout.booking?.toWard, payout.booking?.toDistrict, payout.booking?.toRegion].filter(Boolean).join(", ") ||
        "N/A",
      pickupCoordinate: coordinateText(payout.booking?.fromLatitude, payout.booking?.fromLongitude),
      dropoffCoordinate: coordinateText(payout.booking?.toLatitude, payout.booking?.toLongitude),
    };

    return res.json({
      invoice: {
        id: Number(payout.id),
        payoutId: Number(payout.id),
        invoiceId: withdrawal ? Number(withdrawal.id) : null,
        invoiceNumber: withdrawal ? `WD-${withdrawal.id}` : `DP-${payout.id}`,
        status: payout.status || "PENDING",
        amount: Number(payout.netPaid ?? 0),
        currency: payout.currency || payout.booking?.currency || "TZS",
        gross: Number(payout.grossAmount ?? payout.booking?.amount ?? 0),
        commissionPercent: Number(payout.commissionPercent ?? 0),
        commissionAmount: Number(payout.commissionAmount ?? 0),
        paymentMethod: withdrawal?.paymentMethod ?? payout.paymentMethod ?? null,
        paymentRef: withdrawal?.paymentRef ?? payout.paymentRef ?? null,
        adminNotes: withdrawal?.adminNotes ?? null,
        requestedAt: (withdrawal?.createdAt ?? payout.createdAt)?.toISOString?.() ?? String(withdrawal?.createdAt ?? payout.createdAt ?? ""),
        verifiedAt: verifiedAudit?.createdAt ? new Date(verifiedAudit.createdAt).toISOString() : null,
        approvedAt: payout.approvedAt ? new Date(payout.approvedAt).toISOString() : null,
        paidAt: payout.paidAt ? new Date(payout.paidAt).toISOString() : null,
        createdAt: payout.createdAt ? new Date(payout.createdAt).toISOString() : null,
        updatedAt: payout.updatedAt ? new Date(payout.updatedAt).toISOString() : null,
        driver: payout.driver
          ? {
              id: Number(payout.driver.id),
              name: payout.driver.name || "Unknown Driver",
              email: payout.driver.email,
              phone: payout.driver.phone,
              payout: payout.driver.payout ?? null,
              paymentPhone: payout.driver.paymentPhone ?? null,
              vehicleType: payout.driver.vehicleType ?? null,
              plateNumber: payout.driver.plateNumber ?? null,
              kycStatus: payout.driver.kycStatus ?? null,
            }
          : null,
        approvedBy: payout.approver ?? null,
        verifiedBy: verifiedAudit?.admin ?? null,
        paidBy: payout.payer ?? null,
        trip: payout.booking
          ? {
              id: Number(payout.booking.id),
              code: payout.booking.tripCode || payout.paymentRef || `TRIP-${payout.booking.id}`,
              status: payout.booking.status || "COMPLETED",
              paymentStatus: payout.booking.paymentStatus ?? null,
              paymentMethod: payout.booking.paymentMethod ?? null,
              paymentRef: payout.booking.paymentRef ?? null,
              scheduledAt: payout.booking.scheduledDate ? new Date(payout.booking.scheduledDate).toISOString() : null,
              pickupTime: payout.booking.pickupTime ? new Date(payout.booking.pickupTime).toISOString() : null,
              dropoffTime: payout.booking.dropoffTime ? new Date(payout.booking.dropoffTime).toISOString() : null,
              pickup: route.pickup,
              dropoff: route.dropoff,
              pickupCoordinate: route.pickupCoordinate,
              dropoffCoordinate: route.dropoffCoordinate,
              distanceKm: tripDistanceKm,
              durationMinutes: tripDurationMinutes,
              tripType,
              vehicleType: payout.booking.vehicleType ?? null,
              passengerCount: payout.booking.numberOfPassengers ?? null,
              amount: Number(payout.booking.amount ?? 0),
              currency: payout.booking.currency ?? "TZS",
              notes: payout.booking.notes ?? null,
              customerRating: payout.booking.userRating != null ? Number(payout.booking.userRating) : null,
              customerReview: payout.booking.userReview ?? null,
              driverRating: payout.booking.driverRating != null ? Number(payout.booking.driverRating) : null,
              driverReview: payout.booking.driverReview ?? null,
              createdAt: payout.booking.createdAt ? new Date(payout.booking.createdAt).toISOString() : null,
              updatedAt: payout.booking.updatedAt ? new Date(payout.booking.updatedAt).toISOString() : null,
              user: payout.booking.user ?? null,
            }
          : null,
      },
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      console.warn("Prisma schema mismatch when querying driver invoice details:", err.message);
      return res.status(404).json({ error: "Driver payout invoice not found" });
    }
    if (err instanceof Prisma.PrismaClientValidationError) {
      console.warn("Prisma validation error when querying driver invoice details:", err.message);
      return res.status(404).json({ error: "Driver payout invoice not found" });
    }
    console.error("Unhandled error in GET /admin/drivers/invoices/:id:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /admin/drivers/invoices/:id/verify - verify a pending driver payout invoice before approval */
router.post("/invoices/:id(\\d+)/verify", limitAdminTripsWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid_invoice_id" });

    if (!(prisma as any).transportPayout) {
      return res.status(400).json({ error: "Driver payout invoices are not available" });
    }

    const adminId = Number((req as any)?.user?.id);
    const adminNotes = normalizeReason((req.body as any)?.adminNotes, 500);

    const payout = await (prisma as any).transportPayout.findUnique({
      where: { id },
      include: {
        driver: { select: { id: true, name: true, email: true, phone: true } },
        booking: { select: { id: true, tripCode: true } },
      },
    });

    if (!payout) return res.status(404).json({ error: "Driver payout invoice not found" });
    if (payout.status !== "PENDING") {
      return res.status(409).json({ error: `Invoice is already ${payout.status}` });
    }

    const updated = await (prisma as any).transportPayout.update({
      where: { id },
      data: {
        status: "VERIFIED",
      },
      include: {
        driver: { select: { id: true, name: true, email: true, phone: true } },
        booking: { select: { id: true, tripCode: true } },
      },
    });

    let verifiedAt = new Date();
    try {
      if (Number.isFinite(adminId)) {
        const audit = await (prisma as any).adminAudit?.create?.({
          data: {
            adminId,
            targetUserId: updated.driverId,
            action: "DRIVER_PAYOUT_INVOICE_VERIFY",
            details: {
              invoiceId: updated.id,
              invoiceNumber: `DP-${updated.id}`,
              tripId: updated.booking?.id ?? null,
              tripCode: updated.booking?.tripCode ?? null,
              amount: Number(updated.netPaid ?? 0),
              paymentMethod: updated.paymentMethod ?? null,
              paymentRef: updated.paymentRef ?? null,
              adminNotes: adminNotes || null,
            },
          },
        });
        if (audit?.createdAt) verifiedAt = new Date(audit.createdAt);
      }
    } catch {
      // audit is best-effort
    }

    try {
      const io = (req as any).app?.get?.("io") || (global as any).io;
      if (io) {
        io.emit("admin:driver-payout-invoice-verified", {
          invoiceId: updated.id,
          driverId: updated.driverId,
          tripId: updated.booking?.id ?? null,
          amount: Number(updated.netPaid ?? 0),
        });
      }
    } catch (emitErr: any) {
      console.warn("Failed to emit driver payout invoice verification notification:", emitErr?.message ?? emitErr);
    }

    return res.json({
      success: true,
      invoice: {
        id: updated.id,
        invoiceNumber: `DP-${updated.id}`,
        tripId: updated.booking?.id ?? null,
        tripCode: updated.booking?.tripCode ?? null,
        driver: updated.driver
          ? {
              id: updated.driver.id,
              name: updated.driver.name || "Unknown Driver",
              email: updated.driver.email,
              phone: updated.driver.phone,
            }
          : null,
        amount: Number(updated.netPaid ?? 0),
        currency: updated.currency || "TZS",
        status: updated.status,
        verifiedAt: verifiedAt.toISOString(),
      },
    });
  } catch (err: any) {
    console.error("Unhandled error in POST /admin/drivers/invoices/:id/verify:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /admin/drivers/invoices/:id/approve - approve a verified driver payout invoice */
router.post("/invoices/:id(\\d+)/approve", limitAdminTripsWrite, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "invalid_invoice_id" });

    if (!(prisma as any).transportPayout) {
      return res.status(400).json({ error: "Driver payout invoices are not available" });
    }

    const adminId = Number((req as any)?.user?.id);
    const adminNotes = normalizeReason((req.body as any)?.adminNotes, 500);

    const payout = await (prisma as any).transportPayout.findUnique({
      where: { id },
      include: {
        driver: { select: { id: true, name: true, email: true, phone: true } },
        booking: { select: { id: true, tripCode: true } },
      },
    });

    if (!payout) return res.status(404).json({ error: "Driver payout invoice not found" });
    if (payout.status !== "VERIFIED") {
      if (payout.status === "PENDING") return res.status(409).json({ error: "Invoice must be verified before approval" });
      return res.status(409).json({ error: `Invoice is already ${payout.status}` });
    }

    const updated = await (prisma as any).transportPayout.update({
      where: { id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedBy: Number.isFinite(adminId) ? adminId : null,
      },
      include: {
        driver: { select: { id: true, name: true, email: true, phone: true } },
        booking: { select: { id: true, tripCode: true } },
      },
    });

    try {
      if ((prisma as any).referralWithdrawal) {
        const withdrawal = await (prisma as any).referralWithdrawal.findFirst({
          where: {
            driverId: payout.driverId,
            totalAmount: payout.netPaid,
            status: "PENDING",
          },
          orderBy: { createdAt: "desc" },
        });

        if (withdrawal) {
          await (prisma as any).referralWithdrawal.update({
            where: { id: withdrawal.id },
            data: {
              status: "APPROVED",
              processedBy: Number.isFinite(adminId) ? adminId : null,
              approvedAt: new Date(),
              rejectedAt: null,
              rejectionReason: null,
              adminNotes: adminNotes || withdrawal.adminNotes,
            },
          });
        }
      }
    } catch (withdrawalErr: any) {
      console.warn("Failed to approve linked withdrawal for driver invoice:", withdrawalErr?.message ?? withdrawalErr);
    }

    try {
      if ((prisma as any).referralEarning) {
        await (prisma as any).referralEarning.updateMany({
          where: { driverId: payout.driverId, withdrawal: { is: { totalAmount: payout.netPaid } }, status: "AVAILABLE_FOR_WITHDRAWAL" },
          data: {
            status: "WITHDRAWN",
            withdrawnAt: new Date(),
          },
        });
      }
    } catch (earningsErr: any) {
      console.warn("Failed to mark referral earnings withdrawn for driver invoice approval:", earningsErr?.message ?? earningsErr);
    }

    try {
      if (Number.isFinite(adminId)) {
        await (prisma as any).adminAudit?.create?.({
          data: {
            adminId,
            targetUserId: updated.driverId,
            action: "DRIVER_PAYOUT_INVOICE_APPROVE",
            details: {
              invoiceId: updated.id,
              invoiceNumber: `DP-${updated.id}`,
              tripId: updated.booking?.id ?? null,
              tripCode: updated.booking?.tripCode ?? null,
              amount: Number(updated.netPaid ?? 0),
              paymentMethod: updated.paymentMethod ?? null,
              paymentRef: updated.paymentRef ?? null,
            },
          },
        });
      }
    } catch {
      // audit is best-effort
    }

    try {
      const io = (req as any).app?.get?.("io") || (global as any).io;
      if (io) {
        io.to(`driver:${updated.driverId}`).emit("driver-payout-invoice-approved", {
          invoiceId: updated.id,
          tripId: updated.booking?.id ?? null,
          amount: Number(updated.netPaid ?? 0),
          approvedAt: updated.approvedAt,
          processedBy: Number.isFinite(adminId) ? adminId : null,
        });
        io.emit("admin:driver-payout-invoice-approved", {
          invoiceId: updated.id,
          driverId: updated.driverId,
          tripId: updated.booking?.id ?? null,
          amount: Number(updated.netPaid ?? 0),
        });
      }
    } catch (emitErr: any) {
      console.warn("Failed to emit driver payout invoice approval notification:", emitErr?.message ?? emitErr);
    }

    return res.json({
      success: true,
      invoice: {
        id: updated.id,
        invoiceNumber: `DP-${updated.id}`,
        tripId: updated.booking?.id ?? null,
        tripCode: updated.booking?.tripCode ?? null,
        driver: updated.driver
          ? {
              id: updated.driver.id,
              name: updated.driver.name || "Unknown Driver",
              email: updated.driver.email,
              phone: updated.driver.phone,
            }
          : null,
        amount: Number(updated.netPaid ?? 0),
        currency: updated.currency || "TZS",
        status: updated.status,
        approvedAt: updated.approvedAt ? new Date(updated.approvedAt).toISOString() : null,
      },
    });
  } catch (err: any) {
    console.error("Unhandled error in POST /admin/drivers/invoices/:id/approve:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /admin/drivers/paid?driverId=&date=&start=&end=&page=&pageSize=&q= */
router.get("/paid", async (req, res) => {
  try {
    const { driverId, date, start, end, page = "1", pageSize = "50", q = "" } = req.query as any;

    if (!(prisma as any).transportPayout) {
      return res.json({ total: 0, page: Number(page), pageSize: Math.min(Number(pageSize), 100), items: [] });
    }

    const where: any = {
      status: "PAID",
      booking: {
        is: {
          status: "COMPLETED",
        },
      },
    };

    if (driverId) {
      where.driverId = Number(driverId);
    }

    if (date) {
      const s = new Date(String(date) + "T00:00:00.000Z");
      const e = new Date(String(date) + "T23:59:59.999Z");
      where.paidAt = { gte: s, lte: e };
    } else if (start || end) {
      const s = start ? new Date(String(start) + "T00:00:00.000Z") : new Date(0);
      const e = end ? new Date(String(end) + "T23:59:59.999Z") : new Date();
      where.paidAt = { gte: s, lte: e };
    }

    if (q) {
      where.OR = [
        { booking: { is: { tripCode: { contains: q } } } },
        { paymentRef: { contains: q } },
        { paymentMethod: { contains: q } },
        { driver: { is: { name: { contains: q } } } },
        { driver: { is: { email: { contains: q } } } },
        { payer: { is: { name: { contains: q } } } },
        { payer: { is: { email: { contains: q } } } },
      ];
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    try {
      const [payouts, total] = await Promise.all([
        (prisma as any).transportPayout.findMany({
          where,
          include: {
            driver: {
              select: { id: true, name: true, email: true, phone: true },
            },
            payer: {
              select: { id: true, name: true, email: true },
            },
            booking: {
              select: {
                id: true,
                tripCode: true,
                status: true,
                scheduledDate: true,
                fromAddress: true,
                fromWard: true,
                fromDistrict: true,
                fromRegion: true,
                toAddress: true,
                toWard: true,
                toDistrict: true,
                toRegion: true,
                vehicleType: true,
              },
            },
          },
          orderBy: [{ paidAt: "desc" }, { id: "desc" }],
          skip,
          take,
        }),
        (prisma as any).transportPayout.count({ where }),
      ]);

      const items = payouts.map((p: any) => ({
        id: Number(p.id),
        trip: {
          id: Number(p.booking.id),
          code: p.booking.tripCode || p.paymentRef || `TRIP-${p.booking.id}`,
          status: p.booking.status || "COMPLETED",
          scheduledAt: p.booking.scheduledDate ? new Date(p.booking.scheduledDate).toISOString() : null,
          pickup:
            p.booking.fromAddress ||
            [p.booking.fromWard, p.booking.fromDistrict, p.booking.fromRegion].filter(Boolean).join(", ") ||
            "N/A",
          dropoff:
            p.booking.toAddress ||
            [p.booking.toWard, p.booking.toDistrict, p.booking.toRegion].filter(Boolean).join(", ") ||
            "N/A",
          vehicleType: p.booking.vehicleType ?? null,
        },
        driver: p.driver
          ? {
              id: Number(p.driver.id),
              name: p.driver.name ?? "",
              email: p.driver.email ?? "",
              phone: p.driver.phone ?? null,
            }
          : null,
        gross: p.grossAmount != null ? Number(p.grossAmount) : 0,
        commissionAmount: p.commissionAmount != null ? Number(p.commissionAmount) : 0,
        netPaid: p.netPaid != null ? Number(p.netPaid) : 0,
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : new Date(p.updatedAt ?? p.createdAt).toISOString(),
        paymentMethod: p.paymentMethod ?? null,
        paymentRef: p.paymentRef ?? null,
        paidBy: p.payer
          ? {
              id: Number(p.payer.id),
              name: p.payer.name ?? "",
              email: p.payer.email ?? "",
            }
          : null,
      }));

      return res.json({ total, page: Number(page), pageSize: take, items });
    } catch (err: any) {
      console.warn("Error querying transport payouts:", err.message);
      return res.json({ total: 0, page: Number(page), pageSize: take, items: [] });
    }
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver payments:', err.message);
      const page = Number((req.query as any).page ?? 1);
      const pageSize = Math.min(Number((req.query as any).pageSize ?? 50), 100);
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    console.error('Unhandled error in GET /admin/drivers/paid:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/paid/stats?period=7d|30d|month|year */
router.get("/paid/stats", async (req, res) => {
  try {
    const { period = "30d" } = req.query as any;

    let startDate: Date;
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    switch (period) {
      case "7d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        break;
      case "month":
        startDate = new Date();
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "year":
        startDate = new Date();
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      default:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
    }
    startDate.setHours(0, 0, 0, 0);

    if (!(prisma as any).transportPayout) {
      return res.json({
        stats: [],
        summary: { totalPaid: 0, totalCount: 0, totalCommission: 0, averagePayment: 0 },
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    }

    let payments: any[] = [];

    try {
      payments = await (prisma as any).transportPayout.findMany({
        where: {
          status: "PAID",
          paidAt: {
            gte: startDate,
            lte: endDate,
          },
          booking: {
            is: {
              status: "COMPLETED",
            },
          },
        },
        select: {
          paidAt: true,
          netPaid: true,
          commissionAmount: true,
        },
      });
    } catch (err: any) {
      console.warn("Error querying payment stats:", err.message);
    }

    const dateKeyFor = (value: Date) => {
      if (period === "year") {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-01`;
      }
      return value.toISOString().split("T")[0];
    };

    const buildEmptySeries = () => {
      const seeded = new Map<string, { count: number; totalPaid: number; totalCommission: number }>();
      const cursor = new Date(startDate);
      cursor.setHours(0, 0, 0, 0);

      if (period === "year") {
        cursor.setDate(1);
        while (cursor <= endDate) {
          seeded.set(dateKeyFor(cursor), { count: 0, totalPaid: 0, totalCommission: 0 });
          cursor.setMonth(cursor.getMonth() + 1);
        }
        return seeded;
      }

      while (cursor <= endDate) {
        seeded.set(dateKeyFor(cursor), { count: 0, totalPaid: 0, totalCommission: 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
      return seeded;
    };

    // Group by date while preserving zero buckets so charts draw a real timeline.
    const dateMap = new Map<string, { count: number; totalPaid: number; totalCommission: number }>();
    buildEmptySeries().forEach((value, key) => dateMap.set(key, value));
    
    payments.forEach((p) => {
      const dateKey = dateKeyFor(new Date(p.paidAt));
      const existing = dateMap.get(dateKey) || { count: 0, totalPaid: 0, totalCommission: 0 };
      existing.count += 1;
      existing.totalPaid += Number(p.netPaid ?? 0);
      existing.totalCommission += Number(p.commissionAmount ?? 0);
      dateMap.set(dateKey, existing);
    });

    const stats = Array.from(dateMap.entries())
      .map(([date, data]) => ({
        date,
        count: data.count,
        totalPaid: Math.round(data.totalPaid),
        totalCommission: Math.round(data.totalCommission),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const summary = {
      totalPaid: stats.reduce((sum, s) => sum + s.totalPaid, 0),
      totalCount: stats.reduce((sum, s) => sum + s.count, 0),
      totalCommission: stats.reduce((sum, s) => sum + s.totalCommission, 0),
      averagePayment: stats.length > 0 
        ? stats.reduce((sum, s) => sum + s.totalPaid, 0) / stats.reduce((sum, s) => sum + s.count, 0)
        : 0,
    };

    return res.json({ stats, summary, period, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying payment stats:', err.message);
      return res.json({ 
        stats: [], 
        summary: { totalPaid: 0, totalCount: 0, totalCommission: 0, averagePayment: 0 },
        period: (req.query as any).period || "30d", 
        startDate: new Date().toISOString(), 
        endDate: new Date().toISOString() 
      });
    }
    console.error('Unhandled error in GET /admin/drivers/paid/stats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/revenues?driverId=&date=&start=&end=&page=&pageSize=&q= */
router.get("/revenues", async (req, res) => {
  try {
    const { driverId, date, start, end, page = "1", pageSize = "50", q = "" } = req.query as any;

    if (!(prisma as any).transportPayout) {
      return res.json({ total: 0, page: Number(page), pageSize: Math.min(Number(pageSize), 100), items: [] });
    }

    const where: any = {
      booking: {
        is: {
          status: { in: ["COMPLETED", "FINISHED"] },
        },
      },
    };

    if (driverId) {
      const did = Number(driverId);
      if (Number.isFinite(did) && did > 0) where.driverId = did;
    }

    if (date) {
      const s = new Date(String(date) + "T00:00:00.000Z");
      const e = new Date(String(date) + "T23:59:59.999Z");
      where.createdAt = { gte: s, lte: e };
    } else if (start || end) {
      const s = start ? new Date(String(start) + "T00:00:00.000Z") : new Date(0);
      const e = end ? new Date(String(end) + "T23:59:59.999Z") : new Date();
      where.createdAt = { gte: s, lte: e };
    }

    if (q) {
      const term = String(q).trim();
      where.OR = [
        { paymentRef: { contains: term } },
        { paymentMethod: { contains: term } },
        { driver: { is: { name: { contains: term } } } },
        { driver: { is: { email: { contains: term } } } },
        { booking: { is: { tripCode: { contains: term } } } },
        { booking: { is: { fromAddress: { contains: term } } } },
        { booking: { is: { toAddress: { contains: term } } } },
      ];
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    const payouts = await (prisma as any).transportPayout.findMany({
      where,
      include: {
        driver: {
          select: { id: true, name: true, email: true, phone: true, vehicleType: true, plateNumber: true },
        },
        booking: {
          select: {
            id: true,
            tripCode: true,
            status: true,
            fromAddress: true,
            fromDistrict: true,
            fromRegion: true,
            toAddress: true,
            toDistrict: true,
            toRegion: true,
            vehicleType: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const driverMap = new Map<number, {
      driver: any;
      grossRevenue: number;
      commissionAmount: number;
      netRevenue: number;
      tripIds: Set<number>;
      invoiceCount: number;
      lastPaymentDate: Date | null;
      areaRegistered: string | null;
      vehicleType: string | null;
      registrationNumber: string | null;
    }>();

    const areaRegistered = (booking: any) => {
      const district = booking?.fromDistrict || booking?.toDistrict || "";
      const region = booking?.fromRegion || booking?.toRegion || "";
      return [district, region].filter(Boolean).join(", ") || null;
    };

    (payouts as any[]).forEach((payout: any) => {
      const payoutDriverId = Number(payout.driverId);
      if (!Number.isFinite(payoutDriverId)) return;

      const gross = Number(payout.grossAmount ?? payout.booking?.amount ?? 0);
      const commission = Number(payout.commissionAmount ?? 0);
      const net = Number(payout.netPaid ?? Math.max(0, gross - commission));

      if (!driverMap.has(payoutDriverId)) {
        driverMap.set(payoutDriverId, {
          driver: payout.driver,
          grossRevenue: 0,
          commissionAmount: 0,
          netRevenue: 0,
          tripIds: new Set<number>(),
          invoiceCount: 0,
          lastPaymentDate: null,
          areaRegistered: areaRegistered(payout.booking),
          vehicleType: payout.driver?.vehicleType || payout.booking?.vehicleType || null,
          registrationNumber: payout.driver?.plateNumber || null,
        });
      }

      const entry = driverMap.get(payoutDriverId)!;
      const activityDate = payout.paidAt ?? payout.approvedAt ?? payout.updatedAt ?? payout.createdAt;
      const activityDateValue = activityDate ? new Date(activityDate) : null;
      if (!entry.lastPaymentDate || (activityDateValue && activityDateValue > entry.lastPaymentDate)) {
        entry.areaRegistered = areaRegistered(payout.booking) || entry.areaRegistered;
        entry.vehicleType = payout.driver?.vehicleType || payout.booking?.vehicleType || entry.vehicleType;
        entry.registrationNumber = payout.driver?.plateNumber || entry.registrationNumber;
      }
      entry.grossRevenue += gross;
      entry.commissionAmount += commission;
      entry.netRevenue += net;
      entry.invoiceCount += 1;
      if (payout.booking?.id) entry.tripIds.add(Number(payout.booking.id));

      if (activityDate && (!entry.lastPaymentDate || new Date(activityDate) > entry.lastPaymentDate)) {
        entry.lastPaymentDate = new Date(activityDate);
      }
    });

    let items = Array.from(driverMap.values())
      .map((entry, idx) => ({
        id: idx + 1,
        driver: entry.driver,
        grossRevenue: Math.round(entry.grossRevenue),
        commissionAmount: Math.round(entry.commissionAmount),
        netRevenue: Math.round(entry.netRevenue),
        tripCount: entry.tripIds.size,
        invoiceCount: entry.invoiceCount,
        areaRegistered: entry.areaRegistered,
        vehicleType: entry.vehicleType,
        registrationNumber: entry.registrationNumber,
        lastPaymentDate: entry.lastPaymentDate?.toISOString() || null,
      }))
      .sort((a, b) => b.netRevenue - a.netRevenue);

    const total = items.length;
    items = items.slice(skip, skip + take);

    return res.json({ total, page: Number(page), pageSize: take, items });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver revenues:', err.message);
      const page = Number((req.query as any).page ?? 1);
      const pageSize = Math.min(Number((req.query as any).pageSize ?? 50), 100);
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    console.error('Unhandled error in GET /admin/drivers/revenues:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/revenues/stats?period=7d|30d|month|year */
router.get("/revenues/stats", async (req, res) => {
  try {
    const { period = "30d" } = req.query as any;
    
    let startDate: Date;
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    switch (period) {
      case "7d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30d":
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
        break;
      case "month":
        startDate = new Date();
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);
        break;
      case "year":
        startDate = new Date();
        startDate.setMonth(0, 1);
        startDate.setHours(0, 0, 0, 0);
        break;
      default:
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
    }
    startDate.setHours(0, 0, 0, 0);

    if (!(prisma as any).transportPayout) {
      return res.json({
        stats: [],
        summary: { totalGrossRevenue: 0, totalNetRevenue: 0, totalCommission: 0, totalTrips: 0, totalInvoices: 0, averageRevenue: 0, growthRate: 0 },
        topDrivers: [],
        period,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
    }

    const payouts = await (prisma as any).transportPayout.findMany({
      where: {
        createdAt: { gte: startDate, lte: endDate },
        booking: {
          is: {
            status: { in: ["COMPLETED", "FINISHED"] },
          },
        },
      },
      include: {
        driver: {
          select: { id: true, name: true, email: true, phone: true },
        },
        booking: {
          select: {
            id: true,
            tripCode: true,
            status: true,
          },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    const dateKeyFor = (value: Date) => {
      if (period === "year") {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-01`;
      }
      return value.toISOString().split("T")[0];
    };

    const buildEmptySeries = () => {
      const seeded = new Map<string, { grossRevenue: number; netRevenue: number; commissionAmount: number; tripCount: number }>();
      const cursor = new Date(startDate);
      cursor.setHours(0, 0, 0, 0);

      if (period === "year") {
        cursor.setDate(1);
        while (cursor <= endDate) {
          seeded.set(dateKeyFor(cursor), { grossRevenue: 0, netRevenue: 0, commissionAmount: 0, tripCount: 0 });
          cursor.setMonth(cursor.getMonth() + 1);
        }
        return seeded;
      }

      while (cursor <= endDate) {
        seeded.set(dateKeyFor(cursor), { grossRevenue: 0, netRevenue: 0, commissionAmount: 0, tripCount: 0 });
        cursor.setDate(cursor.getDate() + 1);
      }
      return seeded;
    };

    // Group by date while preserving zero buckets so charts draw a real timeline.
    const dateMap = new Map<string, { grossRevenue: number; netRevenue: number; commissionAmount: number; tripCount: number }>();
    buildEmptySeries().forEach((value, key) => dateMap.set(key, value));
    const driverRevenueMap = new Map<number, { name: string; total: number; tripCount: number }>();
    const tripIds = new Set<number>();

    (payouts as any[]).forEach((payout: any) => {
      const createdAt = payout.createdAt ? new Date(payout.createdAt) : new Date();
      const dateKey = dateKeyFor(createdAt);
      const existing = dateMap.get(dateKey) || { grossRevenue: 0, netRevenue: 0, commissionAmount: 0, tripCount: 0 };

      const gross = Number(payout.grossAmount ?? 0);
      const commission = Number(payout.commissionAmount ?? 0);
      const net = Number(payout.netPaid ?? Math.max(0, gross - commission));

      existing.grossRevenue += gross;
      existing.netRevenue += net;
      existing.commissionAmount += commission;
      if (payout.booking?.id) {
        existing.tripCount += 1;
        tripIds.add(Number(payout.booking.id));
      }
      dateMap.set(dateKey, existing);

      const driverId = Number(payout.driverId);
      if (Number.isFinite(driverId)) {
        if (!driverRevenueMap.has(driverId)) {
          driverRevenueMap.set(driverId, {
            name: payout.driver?.name || "Unknown Driver",
            total: 0,
            tripCount: 0,
          });
        }
        const driverEntry = driverRevenueMap.get(driverId)!;
        driverEntry.total += net;
        if (payout.booking?.id) driverEntry.tripCount += 1;
      }
    });

    const stats = Array.from(dateMap.entries())
      .map(([date, data]) => ({
        date,
        grossRevenue: Math.round(data.grossRevenue),
        netRevenue: Math.round(data.netRevenue),
        commissionAmount: Math.round(data.commissionAmount),
        tripCount: data.tripCount,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const topDrivers = Array.from(driverRevenueMap.entries())
      .map(([driverId, data]) => ({
        driverId,
        driverName: data.name,
        totalRevenue: Math.round(data.total),
        tripCount: data.tripCount,
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 5);

    const summary = {
      totalGrossRevenue: stats.reduce((sum, s) => sum + s.grossRevenue, 0),
      totalNetRevenue: stats.reduce((sum, s) => sum + s.netRevenue, 0),
      totalCommission: stats.reduce((sum, s) => sum + s.commissionAmount, 0),
      totalTrips: tripIds.size,
      totalInvoices: (payouts as any[]).length,
      averageRevenue: tripIds.size > 0
        ? stats.reduce((sum, s) => sum + s.netRevenue, 0) / tripIds.size
        : 0,
      growthRate: 0, // Calculate based on previous period if needed
    };

    return res.json({ stats, summary, topDrivers, period, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying revenue stats:', err.message);
      return res.json({ 
        stats: [], 
        summary: { totalGrossRevenue: 0, totalNetRevenue: 0, totalCommission: 0, totalTrips: 0, totalInvoices: 0, averageRevenue: 0, growthRate: 0 },
        topDrivers: [],
        period: (req.query as any).period || "30d", 
        startDate: new Date().toISOString(), 
        endDate: new Date().toISOString() 
      });
    }
    console.error('Unhandled error in GET /admin/drivers/revenues/stats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/revenues/:driverId/details?date=&start=&end= */
router.get("/revenues/:driverId(\\d+)/details", async (req, res) => {
  try {
    const driverId = Number(req.params.driverId);
    const { date, start, end } = req.query as any;
    if (!Number.isFinite(driverId) || driverId <= 0) return res.status(400).json({ error: "Invalid driver id" });

    if (!(prisma as any).transportPayout) {
      return res.status(400).json({ error: "Driver revenue details are not available" });
    }

    const where: any = {
      driverId,
      booking: {
        is: {
          status: { in: ["COMPLETED", "FINISHED"] },
        },
      },
    };

    if (date) {
      const s = new Date(String(date) + "T00:00:00.000Z");
      const e = new Date(String(date) + "T23:59:59.999Z");
      where.createdAt = { gte: s, lte: e };
    } else if (start || end) {
      const s = start ? new Date(String(start) + "T00:00:00.000Z") : new Date(0);
      const e = end ? new Date(String(end) + "T23:59:59.999Z") : new Date();
      where.createdAt = { gte: s, lte: e };
    }

    const payouts = await (prisma as any).transportPayout.findMany({
      where,
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            vehicleType: true,
            plateNumber: true,
            payout: true,
            paymentPhone: true,
            kycStatus: true,
          },
        },
        booking: {
          select: {
            id: true,
            tripCode: true,
            status: true,
            scheduledDate: true,
            pickupTime: true,
            dropoffTime: true,
            fromAddress: true,
            fromWard: true,
            fromDistrict: true,
            fromRegion: true,
            toAddress: true,
            toWard: true,
            toDistrict: true,
            toRegion: true,
            vehicleType: true,
            numberOfPassengers: true,
            userRating: true,
            userReview: true,
            driverRating: true,
            driverReview: true,
            createdAt: true,
            updatedAt: true,
            user: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const driver = payouts[0]?.driver ?? await (prisma as any).user?.findUnique?.({
      where: { id: driverId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        vehicleType: true,
        plateNumber: true,
        payout: true,
        paymentPhone: true,
        kycStatus: true,
      },
    });

    const areaRegistered = (booking: any) => {
      const district = booking?.fromDistrict || booking?.toDistrict || "";
      const region = booking?.fromRegion || booking?.toRegion || "";
      return [district, region].filter(Boolean).join(", ") || null;
    };

    const routeText = (booking: any) => ({
      pickup: booking?.fromAddress || [booking?.fromWard, booking?.fromDistrict, booking?.fromRegion].filter(Boolean).join(", ") || "N/A",
      dropoff: booking?.toAddress || [booking?.toWard, booking?.toDistrict, booking?.toRegion].filter(Boolean).join(", ") || "N/A",
    });

    const customerRatings: number[] = [];
    const driverRatings: number[] = [];
    const tripIds = new Set<number>();
    let grossRevenue = 0;
    let commissionAmount = 0;
    let netRevenue = 0;
    let lastPaymentDate: Date | null = null;

    const trips = (payouts as any[]).map((payout: any) => {
      const booking = payout.booking;
      const route = routeText(booking);
      const gross = Number(payout.grossAmount ?? 0);
      const commission = Number(payout.commissionAmount ?? 0);
      const net = Number(payout.netPaid ?? Math.max(0, gross - commission));
      grossRevenue += gross;
      commissionAmount += commission;
      netRevenue += net;
      if (booking?.id) tripIds.add(Number(booking.id));
      if (booking?.userRating != null) customerRatings.push(Number(booking.userRating));
      if (booking?.driverRating != null) driverRatings.push(Number(booking.driverRating));

      const activityDate = payout.paidAt ?? payout.approvedAt ?? payout.updatedAt ?? payout.createdAt;
      if (activityDate && (!lastPaymentDate || new Date(activityDate) > lastPaymentDate)) {
        lastPaymentDate = new Date(activityDate);
      }

      return {
        payoutId: Number(payout.id),
        tripId: booking?.id != null ? Number(booking.id) : null,
        tripCode: booking?.tripCode || payout.paymentRef || `TRIP-${booking?.id ?? payout.id}`,
        status: booking?.status || "COMPLETED",
        areaRegistered: areaRegistered(booking),
        pickup: route.pickup,
        dropoff: route.dropoff,
        vehicleType: driver?.vehicleType || booking?.vehicleType || null,
        registrationNumber: driver?.plateNumber || null,
        passengerCount: booking?.numberOfPassengers != null ? Number(booking.numberOfPassengers) : null,
        grossRevenue: Math.round(gross),
        commissionAmount: Math.round(commission),
        netRevenue: Math.round(net),
        customerRating: booking?.userRating != null ? Number(booking.userRating) : null,
        driverRating: booking?.driverRating != null ? Number(booking.driverRating) : null,
        scheduledAt: booking?.scheduledDate ? new Date(booking.scheduledDate).toISOString() : null,
        pickupTime: booking?.pickupTime ? new Date(booking.pickupTime).toISOString() : null,
        dropoffTime: booking?.dropoffTime ? new Date(booking.dropoffTime).toISOString() : null,
        paidAt: payout.paidAt ? new Date(payout.paidAt).toISOString() : null,
        paymentMethod: payout.paymentMethod ?? null,
        paymentRef: payout.paymentRef ?? null,
        customer: booking?.user ?? null,
      };
    });

    const average = (values: number[]) => values.length
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
      : null;

    return res.json({
      driver: driver
        ? {
            id: Number(driver.id),
            name: driver.name ?? "",
            email: driver.email ?? "",
            phone: driver.phone ?? null,
            vehicleType: driver.vehicleType ?? null,
            registrationNumber: driver.plateNumber ?? null,
            payout: driver.payout ?? null,
            paymentPhone: driver.paymentPhone ?? null,
            kycStatus: driver.kycStatus ?? null,
          }
        : null,
      summary: {
        grossRevenue: Math.round(grossRevenue),
        commissionAmount: Math.round(commissionAmount),
        netRevenue: Math.round(netRevenue),
        tripCount: tripIds.size,
        invoiceCount: payouts.length,
        averageCustomerRating: average(customerRatings),
        averageDriverRating: average(driverRatings),
        lastPaymentDate: (lastPaymentDate as Date | null)?.toISOString() ?? null,
      },
      trips,
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      console.warn("Prisma schema mismatch when querying driver revenue details:", err.message);
      return res.status(404).json({ error: "Driver revenue details not found" });
    }
    console.error("Unhandled error in GET /admin/drivers/revenues/:driverId/details:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /admin/drivers/:id */
router.get("/:id(\\d+)", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid driver id" });
    }
    const driver = await prisma.user.findFirst({
      where: { id, role: "DRIVER" },
      select: {
        id: true, name: true, email: true, phone: true,
        suspendedAt: true, isDisabled: true, createdAt: true,
        // vetting fields
        kycStatus: true,
        kycNote: true,
        kycFieldApprovals: true,
        licenseNumber: true,
        plateNumber: true,
        vehicleType: true,
        operationArea: true,
        isVipDriver: true,
        gender: true,
        nationality: true,
        dateOfBirth: true,
        nin: true,
        region: true,
        district: true,
        paymentPhone: true,
        paymentVerified: true,
        payout: true, // contains drivingLicenseUrl, nationalIdUrl etc stored by profile page
        _count: true,
      } as any,
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    // Fetch kycFieldApprovals separately — column may not exist on an older DB schema
    try {
      const kfaRow = await prisma.user.findFirst({
        where: { id },
        select: { kycFieldApprovals: true } as any,
      });
      (driver as any).kycFieldApprovals = (kfaRow as any)?.kycFieldApprovals ?? null;
    } catch {
      (driver as any).kycFieldApprovals = null;
    }

    // Attach UserDocument records (new per-doc upload flow)
    try {
      if ((prisma as any).userDocument) {
        const docs = await prisma.userDocument.findMany({
          where: { userId: id },
          orderBy: { id: 'desc' },
          take: 50,
          select: { id: true, type: true, url: true, status: true, reason: true, metadata: true, createdAt: true } as any,
        });
        const sanitizedDocs = (docs as any[]).map((doc) => sanitizeUserDocument(doc, 'DRIVER'));
        (driver as any).documents = sanitizedDocs;
        // Resolve URL fields for backward compat (admin vetting page still reads payout URLs)
        const latestByType = new Map<string, any>();
        for (const d of sanitizedDocs as any[]) {
          const t = String((d as any).type ?? '').toUpperCase();
          if (!t || latestByType.has(t)) continue;
          latestByType.set(t, d);
        }
        const payout = (driver as any).payout ?? {};
        const lic   = latestByType.get('DRIVER_LICENSE') || latestByType.get('DRIVING_LICENSE') || latestByType.get('LICENSE');
        const nid   = latestByType.get('NATIONAL_ID');
        const latra = latestByType.get('VEHICLE_REGISTRATION') || latestByType.get('LATRA');
        const ins   = latestByType.get('INSURANCE');
        if (lic?.url)   payout.drivingLicenseUrl    = lic.url;
        if (nid?.url)   payout.nationalIdUrl         = nid.url;
        if (latra?.url) { payout.latraUrl = latra.url; payout.vehicleRegistrationUrl = latra.url; }
        if (ins?.url)   payout.insuranceUrl          = ins.url;
        (driver as any).payout = payout;
      }
    } catch {
      // UserDocument table may not exist in older DBs — ignore
    }

    (driver as any).isRevoked = Boolean((driver as any).suspendedAt);
    (driver as any).revocationCaseRef = (driver as any).suspendedAt
      ? buildDriverCaseRef(id, (driver as any).suspendedAt)
      : null;
    (driver as any).revocationReason = (driver as any).suspendedAt
      ? ((driver as any).kycNote ?? null)
      : null;

    // Note: Booking model is for property stays, not transport
    // Transport bookings would be in TransportBooking model
    const recent: any[] = [];
    try {
      if ((prisma as any).transportBooking) {
        const transportBookings = await (prisma as any).transportBooking.findMany({
          where: { driverId: id },
          select: { id: true, status: true, createdAt: true, amount: true },
          orderBy: { id: "desc" },
          take: 10,
        });
        recent.push(...transportBookings.map((tb: any) => ({
          id: tb.id,
          status: tb.status,
          createdAt: tb.createdAt,
          totalAmount: Number(tb.amount ?? 0),
        })));
      }
    } catch (e) {
      // TransportBooking model may not exist
    }

    return res.json({ driver, snapshot: { recentBookings: recent } });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver by id:', err.message);
      return res.status(200).json({ driver: null, snapshot: { recentBookings: [] } });
    }
    console.error('Unhandled error in GET /admin/drivers/:id', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /admin/drivers/:id/documents/:docId/approve
 * Approves a specific uploaded document for a driver.
 */
router.post("/:id(\\d+)/documents/:docId(\\d+)/approve", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    const docId = Number(req.params.docId);
    const me = (req.user as any)?.id;

    if (!(prisma as any).userDocument) {
      return res.status(400).json({ error: "UserDocument not supported" });
    }

    const doc = await prisma.userDocument.findUnique({ where: { id: docId } as any });
    if (!doc || (doc as any).userId !== driverId) {
      return res.status(404).json({ error: "Document not found" });
    }

    const updated = await prisma.userDocument.update({
      where: { id: docId } as any,
      data: { status: "APPROVED", reason: null } as any,
    });

    // Best-effort: sync kycFieldApprovals for doc-type keys
    try {
      const keyByType: Record<string, string> = {
        DRIVER_LICENSE: "drivingLicense",
        DRIVING_LICENSE: "drivingLicense",
        DRIVER_LICENCE: "drivingLicense",
        DRIVING_LICENCE: "drivingLicense",
        LICENSE: "drivingLicense",
        NATIONAL_ID: "nationalId",
        ID: "nationalId",
        PASSPORT: "nationalId",
        VEHICLE_REGISTRATION: "latra",
        LATRA: "latra",
        VEHICLE_REG: "latra",
        INSURANCE: "insurance",
      };
      const t = String((doc as any).type ?? "").toUpperCase();
      const key = keyByType[t];
      if (key) {
        const u = await prisma.user.findUnique({ where: { id: driverId }, select: { kycFieldApprovals: true } as any });
        const prev = (u as any)?.kycFieldApprovals && typeof (u as any).kycFieldApprovals === "object" ? (u as any).kycFieldApprovals : {};
        await prisma.user.update({ where: { id: driverId }, data: { kycFieldApprovals: { ...(prev as any), [key]: "approved" } } as any });
      }
    } catch {
      // ignore
    }

    try {
      await prisma.adminAudit.create({
        data: {
          adminId: me,
          targetUserId: driverId,
          action: "DRIVER_DOCUMENT_APPROVE",
          details: JSON.stringify({ documentId: docId, documentType: (doc as any).type || "Unknown" }),
        },
      });
    } catch {
      // ignore audit errors
    }

    try {
      req.app.get("io")?.to?.(`driver:${driverId}`)?.emit?.("driver:documents:updated", { driverId, at: new Date().toISOString() });
      req.app.get("io")?.to?.(`user:${driverId}`)?.emit?.("driver:documents:updated", { driverId, at: new Date().toISOString() });
    } catch {
      // ignore socket errors
    }

    return res.json({ ok: true, doc: updated });
  } catch (err: any) {
    console.error("POST /admin/drivers/:id/documents/:docId/approve error:", err);
    return res.status(500).json({ error: "internal_error", message: err?.message });
  }
});

/**
 * POST /admin/drivers/:id/documents/:docId/reject {reason}
 * Rejects a specific uploaded document for a driver.
 */
router.post("/:id(\\d+)/documents/:docId(\\d+)/reject", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    const docId = Number(req.params.docId);
    const reason = String(req.body?.reason ?? "").trim();
    const me = (req.user as any)?.id;

    if (!(prisma as any).userDocument) {
      return res.status(400).json({ error: "UserDocument not supported" });
    }

    const doc = await prisma.userDocument.findUnique({ where: { id: docId } as any });
    if (!doc || (doc as any).userId !== driverId) {
      return res.status(404).json({ error: "Document not found" });
    }

    const updated = await prisma.userDocument.update({
      where: { id: docId } as any,
      data: { status: "REJECTED", reason: reason || null } as any,
    });

    // Best-effort: sync kycFieldApprovals for doc-type keys
    try {
      const keyByType: Record<string, string> = {
        DRIVER_LICENSE: "drivingLicense",
        DRIVING_LICENSE: "drivingLicense",
        DRIVER_LICENCE: "drivingLicense",
        DRIVING_LICENCE: "drivingLicense",
        LICENSE: "drivingLicense",
        NATIONAL_ID: "nationalId",
        ID: "nationalId",
        PASSPORT: "nationalId",
        VEHICLE_REGISTRATION: "latra",
        LATRA: "latra",
        VEHICLE_REG: "latra",
        INSURANCE: "insurance",
      };
      const t = String((doc as any).type ?? "").toUpperCase();
      const key = keyByType[t];
      if (key) {
        const u = await prisma.user.findUnique({ where: { id: driverId }, select: { kycFieldApprovals: true } as any });
        const prev = (u as any)?.kycFieldApprovals && typeof (u as any).kycFieldApprovals === "object" ? (u as any).kycFieldApprovals : {};
        await prisma.user.update({ where: { id: driverId }, data: { kycFieldApprovals: { ...(prev as any), [key]: "flagged" } } as any });
      }
    } catch {
      // ignore
    }

    try {
      await prisma.adminAudit.create({
        data: {
          adminId: me,
          targetUserId: driverId,
          action: "DRIVER_DOCUMENT_REJECT",
          details: JSON.stringify({ documentId: docId, documentType: (doc as any).type || "Unknown", reason }),
        },
      });
    } catch {
      // ignore audit errors
    }

    try {
      req.app.get("io")?.to?.(`driver:${driverId}`)?.emit?.("driver:documents:updated", { driverId, at: new Date().toISOString() });
      req.app.get("io")?.to?.(`user:${driverId}`)?.emit?.("driver:documents:updated", { driverId, at: new Date().toISOString() });
    } catch {
      // ignore socket errors
    }

    return res.json({ ok: true, doc: updated });
  } catch (err: any) {
    console.error("POST /admin/drivers/:id/documents/:docId/reject error:", err);
    return res.status(500).json({ error: "internal_error", message: err?.message });
  }
});

/**
 * POST /admin/drivers/:id/documents/:docId/pending
 * Resets a driver document back to PENDING (undo approve/reject).
 */
router.post("/:id(\\d+)/documents/:docId(\\d+)/pending", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    const docId = Number(req.params.docId);
    const me = (req.user as any)?.id;

    if (!(prisma as any).userDocument) {
      return res.status(400).json({ error: "UserDocument not supported" });
    }

    const doc = await prisma.userDocument.findUnique({ where: { id: docId } as any });
    if (!doc || (doc as any).userId !== driverId) {
      return res.status(404).json({ error: "Document not found" });
    }

    const updated = await prisma.userDocument.update({
      where: { id: docId } as any,
      data: { status: "PENDING", reason: null } as any,
    });

    // Best-effort: remove the approval flag for this doc field
    try {
      const keyByType: Record<string, string> = {
        DRIVER_LICENSE: "drivingLicense",
        DRIVING_LICENSE: "drivingLicense",
        DRIVER_LICENCE: "drivingLicense",
        DRIVING_LICENCE: "drivingLicense",
        LICENSE: "drivingLicense",
        NATIONAL_ID: "nationalId",
        ID: "nationalId",
        PASSPORT: "nationalId",
        VEHICLE_REGISTRATION: "latra",
        LATRA: "latra",
        VEHICLE_REG: "latra",
        INSURANCE: "insurance",
      };
      const t = String((doc as any).type ?? "").toUpperCase();
      const key = keyByType[t];
      if (key) {
        const u = await prisma.user.findUnique({ where: { id: driverId }, select: { kycFieldApprovals: true } as any });
        const prev = (u as any)?.kycFieldApprovals && typeof (u as any).kycFieldApprovals === "object" ? { ...(u as any).kycFieldApprovals } : {};
        if (Object.prototype.hasOwnProperty.call(prev, key)) {
          delete (prev as any)[key];
          await prisma.user.update({ where: { id: driverId }, data: { kycFieldApprovals: prev } as any });
        }
      }
    } catch {
      // ignore
    }

    try {
      await prisma.adminAudit.create({
        data: {
          adminId: me,
          targetUserId: driverId,
          action: "DRIVER_DOCUMENT_PENDING",
          details: JSON.stringify({ documentId: docId, documentType: (doc as any).type || "Unknown" }),
        },
      });
    } catch {
      // ignore audit errors
    }

    try {
      req.app.get("io")?.to?.(`driver:${driverId}`)?.emit?.("driver:documents:updated", { driverId, at: new Date().toISOString() });
      req.app.get("io")?.to?.(`user:${driverId}`)?.emit?.("driver:documents:updated", { driverId, at: new Date().toISOString() });
    } catch {
      // ignore socket errors
    }

    return res.json({ ok: true, doc: updated });
  } catch (err: any) {
    console.error("POST /admin/drivers/:id/documents/:docId/pending error:", err);
    return res.status(500).json({ error: "internal_error", message: err?.message });
  }
});

/** POST /admin/drivers/:id/suspend {reason} */
router.post("/:id/suspend", async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason ?? "");
  const me = (req.user as any).id;

  const updated = await prisma.user.update({ where: { id }, data: { suspendedAt: new Date() } });
  await prisma.adminAudit.create({ data: { adminId: me, targetUserId: id, action: "SUSPEND_DRIVER", details: reason } });
  await revokeUserAuthorization(id);

  req.app.get("io")?.emit?.("admin:driver:updated", { driverId: id });
  res.json({ ok: true, driverId: updated.id, suspendedAt: updated.suspendedAt });
});

/** POST /admin/drivers/:id/unsuspend */
router.post("/:id/unsuspend", async (req, res) => {
  const id = Number(req.params.id);
  const me = (req.user as any).id;
  const updated = await prisma.user.update({ where: { id }, data: { suspendedAt: null } });
  await prisma.adminAudit.create({ data: { adminId: me, targetUserId: id, action: "UNSUSPEND_DRIVER" } });

  req.app.get("io")?.emit?.("admin:driver:updated", { driverId: id });
  res.json({ ok: true, driverId: updated.id });
});

/** GET /admin/drivers/:id/referrals
 * Returns referral information for a specific driver
 */
router.get("/:id(\\d+)/referrals", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    
    // Verify driver exists
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER" },
      select: { id: true, name: true, email: true },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const referralCode = `DRIVER-${driverId}`;
    const referralLink = `${process.env.FRONTEND_URL || process.env.WEB_ORIGIN || process.env.APP_ORIGIN || 'http://localhost:3000'}/register?ref=${referralCode}`;

    let referrals: any[] = [];
    let totalReferrals = 0;
    let activeReferrals = 0;
    let totalCredits = 0;
    let pendingCredits = 0;

    try {
      // Check if there's a dedicated Referral table
      if ((prisma as any).referral) {
        const referralRecords = await (prisma as any).referral.findMany({
          where: { referrerId: driverId },
          include: {
            referredUser: {
              select: {
                id: true,
                fullName: true,
                name: true,
                email: true,
                phone: true,
                createdAt: true,
                region: true,
                district: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        });

        for (const ref of referralRecords) {
          const referredUserId = ref.referredUser?.id || ref.referredUserId;
          let status = 'active' as 'active' | 'completed';
          let spend = 0;
          let creditsEarned = 0;
          const referredUser = ref.referredUser;
          const userRole = (referredUser as any)?.role;

          // Check if user has used the platform (active = used platform at least once)
          try {
            let hasUsedPlatform = false;

            // Check for OWNER: has listed properties
            if (userRole === 'OWNER') {
              if ((prisma as any).property) {
                const propertyCount = await (prisma as any).property.count({
                  where: { ownerId: referredUserId },
                });
                hasUsedPlatform = propertyCount > 0;
              }
              // OWNER: spend = 0, credits = 0 (only counts for level/bonus)
              spend = 0;
              creditsEarned = 0;
            }
            // Check for DRIVER: has completed trips
            else if (userRole === 'DRIVER') {
              if ((prisma as any).booking) {
                const tripCount = await (prisma as any).booking.count({
                  where: { driverId: referredUserId, status: 'COMPLETED' },
                });
                hasUsedPlatform = tripCount > 0;
              }
              // DRIVER: spend = 0, credits = 0 (only counts for level/bonus)
              spend = 0;
              creditsEarned = 0;
            }
            // Check for CUSTOMER/USER/TRAVELLER: has made bookings and calculate spend
            else if (userRole === 'CUSTOMER' || userRole === 'USER') {
              if ((prisma as any).booking) {
                const bookings = await (prisma as any).booking.findMany({
                  where: { userId: referredUserId },
                  select: { price: true, total: true, fare: true, status: true },
                });
                hasUsedPlatform = bookings.length > 0;
                
                // Calculate total spend from completed bookings
                const completedBookings = bookings.filter((b: any) => b.status === 'COMPLETED');
                spend = completedBookings.reduce((sum: number, b: any) => sum + (Number(b.price || b.total || b.fare) || 0), 0);

                // Calculate credits using configurable percentage
                if (completedBookings.length > 0) {
                  const { getReferralCreditPercent } = await import("../lib/business-config.js");
                  const referralPercent = await getReferralCreditPercent();
                  creditsEarned = completedBookings.reduce((sum: number, b: any) => {
                    const bookingAmount = Number(b.price || b.total || b.fare) || 0;
                    return sum + Math.round(bookingAmount * referralPercent);
                  }, 0);
                  
                  // Check for completed status (5+ completed bookings)
                  if (completedBookings.length >= 5) {
                    status = 'completed';
                  }
                }
              }
            }

            // If user has used platform, they are active
            if (hasUsedPlatform) {
              status = 'active';
            }
          } catch (e) {
            console.warn('Failed to check platform usage', e);
            // Default to active if check fails
            status = 'active';
            if (userRole === 'CUSTOMER' || userRole === 'USER') {
              // Default credits for customers if calculation fails
              creditsEarned = 500;
            }
          }

          referrals.push({
            id: String(ref.referredUser?.id || ref.id),
            name: ref.referredUser?.fullName || ref.referredUser?.name || 'N/A',
            email: ref.referredUser?.email || 'N/A',
            phone: ref.referredUser?.phone || ref.phone || null,
            status,
            joinedAt: ref.referredUser?.createdAt || ref.createdAt || new Date().toISOString(),
            registeredAt: ref.referredUser?.createdAt || ref.createdAt || new Date().toISOString(),
            linkSharedAt: ref.createdAt || ref.sharedAt || new Date(ref.referredUser?.createdAt || Date.now()).toISOString(),
            region: ref.referredUser?.region || ref.region || null,
            district: ref.referredUser?.district || ref.district || null,
            spend,
            creditsEarned,
          });
        }

        totalReferrals = referrals.length;
        activeReferrals = referrals.filter((r: any) => r.status === 'active' || r.status === 'completed').length;
        totalCredits = referrals.reduce((sum: number, r: any) => sum + r.creditsEarned, 0);
        pendingCredits = 0; // No pending credits since all registered users who use platform are active
      }

      // Fallback: check user table for referredBy field
      if (referrals.length === 0 && (prisma as any).user) {
        const userSelect = {
          id: true,
          fullName: true,
          name: true,
          email: true,
          phone: true,
          createdAt: true,
          region: true,
          district: true,
        };

        let referredUsers: any[] = [];
        try {
          let ors: any[] = [
            { referredBy: driverId },
            { referralCode: referralCode },
            { referralId: driverId },
          ];

          // Some deployments have slightly different Prisma schemas.
          // Retry by stripping unknown fields (e.g., `referralId`) if Prisma rejects them.
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              referredUsers = await (prisma as any).user.findMany({
                where: { OR: ors },
                select: userSelect,
                orderBy: { createdAt: 'desc' },
              });
              break;
            } catch (e: any) {
              const msg = String(e?.message || "");
              const m = msg.match(/Unknown argument `([^`]+)`/);
              const unknownField = m?.[1] || "";
              if (!unknownField) throw e;

              const next = ors.filter((cond) => {
                const key = Object.keys(cond || {})[0];
                return key && key !== unknownField;
              });

              if (next.length === ors.length || next.length === 0) throw e;
              ors = next;
            }
          }
        } catch (e) {
          console.warn("Referrals fallback user.findMany failed", e);
          referredUsers = [];
        }

        for (const ref of referredUsers) {
          let status = 'active' as 'active' | 'completed';
          let spend = 0;
          let creditsEarned = 500; // Default active credits
          const userRole = (ref as any).role;

          try {
            let hasUsedPlatform = false;

            // Check for OWNER: has listed properties
            if (userRole === 'OWNER') {
              if ((prisma as any).property) {
                const propertyCount = await (prisma as any).property.count({
                  where: { ownerId: ref.id },
                });
                hasUsedPlatform = propertyCount > 0;
              }
              // OWNER: spend = 0, credits = 0 (only counts for level/bonus)
              spend = 0;
              creditsEarned = 0;
            }
            // Check for CUSTOMER/USER/TRAVELLER: has made bookings
            else if (userRole === 'CUSTOMER' || userRole === 'USER') {
              if ((prisma as any).booking) {
                const bookings = await (prisma as any).booking.findMany({
                  where: { userId: ref.id },
                  select: { price: true, total: true, fare: true, status: true, totalAmount: true },
                });
                hasUsedPlatform = bookings.length > 0;
                
                // Calculate total spend from completed bookings
                const completedBookings = bookings.filter((b: any) => b.status === 'COMPLETED');
                spend = completedBookings.reduce((sum: number, b: any) => sum + (Number(b.price || b.total || b.fare || b.totalAmount) || 0), 0);
              }
            }
            // Check for DRIVER: has completed trips
            else if (userRole === 'DRIVER') {
              if ((prisma as any).booking) {
                const tripCount = await (prisma as any).booking.count({
                  where: { driverId: ref.id, status: 'COMPLETED' },
                });
                hasUsedPlatform = tripCount > 0;
              }
              // DRIVER: spend = 0, credits = 0 (only counts for level/bonus)
              spend = 0;
              creditsEarned = 0;
            }

            // If user has used platform, they are active
            if (hasUsedPlatform) {
              status = 'active';
              creditsEarned = 500;

              // Check for completed status
              if (userRole === 'OWNER') {
                if ((prisma as any).property) {
                  const approvedProperties = await (prisma as any).property.count({
                    where: { ownerId: ref.id, status: 'APPROVED' },
                  });
                  if (approvedProperties >= 5) {
                    status = 'completed';
                    creditsEarned = 1000;
                  }
                }
              } else {
                if ((prisma as any).booking) {
                  const completedBookings = await (prisma as any).booking.count({
                    where: {
                      userId: ref.id,
                      status: 'COMPLETED',
                    },
                  });
                  if (completedBookings >= 5) {
                    status = 'completed';
                    creditsEarned = 1000;
                  }
                }
              }
            }
          } catch (e) {
            console.warn('Failed to check platform usage', e);
            // Default to active if check fails
            status = 'active';
            if (userRole === 'CUSTOMER' || userRole === 'USER') {
              // Default credits for customers if calculation fails
              creditsEarned = 500;
            } else {
              creditsEarned = 0;
            }
            spend = 0;
          }

          referrals.push({
            id: String(ref.id),
            name: ref.fullName || ref.name || 'N/A',
            email: ref.email || 'N/A',
            phone: ref.phone || null,
            status,
            joinedAt: ref.createdAt || new Date().toISOString(),
            registeredAt: ref.createdAt || new Date().toISOString(),
            linkSharedAt: ref.referralSharedAt || ref.createdAt || new Date().toISOString(), // Approximate: use createdAt if sharedAt not available
            region: ref.region || null,
            district: ref.district || null,
            spend,
            creditsEarned,
          });
        }

        totalReferrals = referrals.length;
        activeReferrals = referrals.filter((r: any) => r.status === 'active' || r.status === 'completed').length;
        totalCredits = referrals.reduce((sum: number, r: any) => sum + r.creditsEarned, 0);
        pendingCredits = 0; // No pending credits since all registered users who use platform are active
      }
    } catch (e) {
      console.warn('Failed to fetch referrals', e);
    }

    // Get driver's region and district if available
    let driverRegion = null;
    let driverDistrict = null;
    try {
      const driverData = await prisma.user.findUnique({
        where: { id: driverId },
        select: { region: true, district: true } as any,
      });
      driverRegion = (driverData as any)?.region || null;
      driverDistrict = (driverData as any)?.district || null;
    } catch (e) {
      // Ignore if region/district fields don't exist
    }

    return res.json({
      driver: {
        id: driver.id,
        name: driver.name,
        email: driver.email,
        region: driverRegion,
        district: driverDistrict,
      },
      referralCode,
      referralLink,
      totalReferrals,
      activeReferrals,
      totalCredits,
      pendingCredits,
      referrals,
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver referrals:', err.message);
      return res.json({
        driver: null,
        referralCode: '',
        referralLink: '',
        totalReferrals: 0,
        activeReferrals: 0,
        totalCredits: 0,
        pendingCredits: 0,
        referrals: [],
      });
    }
    console.error('Unhandled error in GET /admin/drivers/:id/referrals:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/:id/bonuses
 * Returns bonus history for a specific driver
 */
router.get("/:id(\\d+)/bonuses", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    const { page = "1", pageSize = "50" } = req.query as any;
    
    // Verify driver exists
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER" },
      select: { id: true, name: true, email: true },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    let bonuses: any[] = [];

    try {
      // Check AdminAudit for bonus grants
      const auditRecords = await prisma.adminAudit.findMany({
        where: {
          targetUserId: driverId,
          action: 'GRANT_BONUS',
        },
        include: {
          admin: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      });

      bonuses = auditRecords.map((record: any) => {
        const details = typeof record.details === 'string' ? JSON.parse(record.details) : record.details;
        return {
          id: String(record.id),
          date: record.createdAt || new Date().toISOString(),
          amount: Number(details.bonusAmount || 0),
          period: details.period || (details.to ? new Date(details.to).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : 'Unknown'),
          status: 'paid' as const,
          reason: details.reason || null,
          bonusReasonType: details.bonusReasonType || null,
          paidAt: record.createdAt || null,
          grantedBy: record.admin ? {
            id: record.admin.id,
            name: record.admin.name,
            email: record.admin.email,
          } : null,
        };
      });
    } catch (e) {
      console.warn('AdminAudit query failed, trying alternative bonus sources', e);
    }

    // Alternative: Check if there's a Bonus table
    try {
      if ((prisma as any).bonus) {
        const bonusRecords = await (prisma as any).bonus.findMany({
          where: { driverId },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        });
        
        if (bonusRecords.length > 0) {
          bonuses = bonusRecords.map((b: any) => ({
            id: String(b.id),
            date: b.createdAt || b.date || new Date().toISOString(),
            amount: Number(b.amount || b.bonusAmount || 0),
            period: b.period || new Date(b.createdAt || b.date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
            status: (b.status || 'pending').toLowerCase(),
            reason: b.reason || null,
            paidAt: b.paidAt || b.settledAt || null,
            grantedBy: null,
          }));
        }
      }
    } catch (e) {
      console.warn('Bonus table query failed', e);
    }

    // Get total count
    let total = 0;
    try {
      total = await prisma.adminAudit.count({
        where: {
          targetUserId: driverId,
          action: 'GRANT_BONUS',
        },
      });
    } catch (e) {
      // If count fails, use bonuses length
      total = bonuses.length;
    }

    return res.json({
      driver: {
        id: driver.id,
        name: driver.name,
        email: driver.email,
      },
      total,
      page: Number(page),
      pageSize: take,
      items: bonuses,
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver bonuses:', err.message);
      return res.json({
        driver: null,
        total: 0,
        page: Number((req.query as any).page || 1),
        pageSize: Number((req.query as any).pageSize || 50),
        items: [],
      });
    }
    console.error('Unhandled error in GET /admin/drivers/:id/bonuses:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/:id/level
 * Returns driver level information and progress
 */
router.get("/:id(\\d+)/level", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    
    // Verify driver exists
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER" },
      select: { id: true, name: true, email: true },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    // Fetch driver statistics
    let totalMiles = 0;
    let totalTrips = 0;
    let averageRating = 0;
    let totalReviews = 0;
    let goalsCompleted = 0;

    try {
      // Calculate total miles from trips/bookings
      if ((prisma as any).booking) {
        const bookings = await (prisma as any).booking.findMany({
          where: {
            driverId,
            status: {
              in: ['COMPLETED', 'FINISHED', 'PAID', 'CONFIRMED'],
            },
          },
          select: {
            distance: true,
          },
        });

        totalTrips = bookings.length;
        totalMiles = bookings.reduce((sum: number, b: any) => {
          const distance = Number(b.distance || 0);
          return sum + (distance * 0.621371); // km to miles conversion
        }, 0);
      }
    } catch (e) {
      console.warn('Failed to fetch trips/miles', e);
    }

    // Get driver rating and reviews
    try {
      const driverData = await prisma.user.findUnique({
        where: { id: driverId },
        select: { rating: true } as any,
      });
      if (driverData && typeof (driverData as any).rating === 'number') {
        averageRating = (driverData as any).rating;
      }

      if ((prisma as any).review) {
        const reviewCount = await (prisma as any).review.count({
          where: { driverId },
        });
        totalReviews = reviewCount;
      } else {
        totalReviews = averageRating > 0 ? Math.round(averageRating * 25) : 0;
      }
    } catch (e) {
      console.warn('Failed to fetch rating/reviews', e);
    }

    // Count completed goals
    try {
      if ((prisma as any).adminAudit) {
        const goalCompletions = await (prisma as any).adminAudit.count({
          where: {
            targetUserId: driverId,
            action: {
              in: ['GOAL_COMPLETED', 'ACHIEVEMENT_UNLOCKED'],
            },
          },
        });
        goalsCompleted = goalCompletions;
      }
    } catch (e) {
      console.warn('Failed to fetch goals', e);
    }

    // Calculate level
    let currentLevel = 1;
    let levelName = "Silver";
    let nextLevel = 2;
    let nextLevelName = "Gold";

    if (totalMiles >= 3000 || (totalTrips >= 500 && averageRating >= 4.8)) {
      currentLevel = 3;
      levelName = "Diamond";
      nextLevel = 3;
      nextLevelName = "Diamond";
    } else if (totalMiles >= 1000 || (totalTrips >= 200 && averageRating >= 4.6)) {
      currentLevel = 2;
      levelName = "Gold";
      nextLevel = 3;
      nextLevelName = "Diamond";
    }

    // Calculate requirements for next level
    const milesForNextLevel = currentLevel === 3 ? 0 : (currentLevel === 1 ? 1000 : 3000);
    const tripsForNextLevel = currentLevel === 3 ? 0 : (currentLevel === 1 ? 200 : 500);
    const ratingForNextLevel = currentLevel === 3 ? 0 : (currentLevel === 1 ? 4.6 : 4.8);
    const reviewsForNextLevel = currentLevel === 3 ? 0 : (currentLevel === 1 ? 100 : 300);
    const goalsForNextLevel = currentLevel === 3 ? 0 : (currentLevel === 1 ? 10 : 25);

    // Calculate progress percentages
    const progress = {
      miles: currentLevel === 3 ? 100 : Math.min((totalMiles / milesForNextLevel) * 100, 100),
      trips: currentLevel === 3 ? 100 : Math.min((totalTrips / tripsForNextLevel) * 100, 100),
      rating: currentLevel === 3 ? 100 : Math.min((averageRating / ratingForNextLevel) * 100, 100),
      reviews: currentLevel === 3 ? 100 : Math.min((totalReviews / reviewsForNextLevel) * 100, 100),
      goals: currentLevel === 3 ? 100 : Math.min((goalsCompleted / goalsForNextLevel) * 100, 100),
    };

    // Level benefits
    const getLevelBenefits = (level: number): string[] => {
      const benefits: { [key: number]: string[] } = {
        1: ["Standard support", "Standard commission rate", "Access to basic features", "Basic trip assignments"],
        2: ["Priority support", "10% bonus on earnings", "Access to premium features", "Priority trip assignments", "Early access to new features"],
        3: ["Elite support", "20% bonus on earnings", "Access to all features", "Highest priority assignments", "Exclusive partnerships", "Lifetime benefits", "Brand Ambassador", "Invited to events"],
      };
      return benefits[level] || benefits[1];
    };

    return res.json({
      driver: {
        id: driver.id,
        name: driver.name,
        email: driver.email,
      },
      currentLevel,
      levelName,
      nextLevel,
      nextLevelName,
      totalMiles: Math.round(totalMiles),
      milesForNextLevel,
      totalTrips,
      tripsForNextLevel,
      averageRating: parseFloat(averageRating.toFixed(1)),
      ratingForNextLevel,
      totalReviews,
      reviewsForNextLevel,
      goalsCompleted,
      goalsForNextLevel,
      progress: {
        miles: Math.round(progress.miles),
        trips: Math.round(progress.trips),
        rating: Math.round(progress.rating),
        reviews: Math.round(progress.reviews),
        goals: Math.round(progress.goals),
      },
      levelBenefits: getLevelBenefits(currentLevel),
      nextLevelBenefits: getLevelBenefits(nextLevel),
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver level:', err.message);
      return res.json({
        driver: null,
        currentLevel: 1,
        levelName: "Silver",
        nextLevel: 2,
        nextLevelName: "Gold",
        totalMiles: 0,
        milesForNextLevel: 1000,
        totalTrips: 0,
        tripsForNextLevel: 200,
        averageRating: 0,
        ratingForNextLevel: 4.6,
        totalReviews: 0,
        reviewsForNextLevel: 100,
        goalsCompleted: 0,
        goalsForNextLevel: 10,
        progress: { miles: 0, trips: 0, rating: 0, reviews: 0, goals: 0 },
        levelBenefits: [],
        nextLevelBenefits: [],
      });
    }
    console.error('Unhandled error in GET /admin/drivers/:id/level:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/:id/reminders
 * Returns reminders for a specific driver
 */
router.get("/:id(\\d+)/reminders", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    const { page = "1", pageSize = "50" } = req.query as any;
    
    // Verify driver exists
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER" },
      select: { id: true, name: true, email: true },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    let reminders: any[] = [];
    let total = 0;

    try {
      if ((prisma as any).driverReminder) {
        const [items, count] = await Promise.all([
          (prisma as any).driverReminder.findMany({
            where: { driverId },
            orderBy: { createdAt: 'desc' },
            skip,
            take,
          }),
          (prisma as any).driverReminder.count({
            where: { driverId },
          }),
        ]);

        reminders = items.map((r: any) => ({
          id: String(r.id),
          type: r.type || 'INFO',
          message: r.message,
          action: r.action || null,
          actionLink: r.actionLink || null,
          expiresAt: r.expiresAt || null,
          isRead: Boolean((r as any).read ?? (r as any).isRead),
          createdAt: r.createdAt || new Date().toISOString(),
        }));

        total = count;
      }
    } catch (e) {
      console.warn('Failed to fetch reminders', e);
    }

    return res.json({
      driver: {
        id: driver.id,
        name: driver.name,
        email: driver.email,
      },
      total,
      page: Number(page),
      pageSize: take,
      items: reminders,
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver reminders:', err.message);
      return res.json({
        driver: null,
        total: 0,
        page: Number((req.query as any).page || 1),
        pageSize: Number((req.query as any).pageSize || 50),
        items: [],
      });
    }
    console.error('Unhandled error in GET /admin/drivers/:id/reminders:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /admin/drivers/:id/reminders
 * Creates a reminder for a specific driver. Admin-only by router guard.
 */
router.post("/:id(\\d+)/reminders", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    if (!Number.isFinite(driverId) || driverId <= 0) return res.status(400).json({ error: "Invalid driver id" });

    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER" },
      select: { id: true, name: true, email: true },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    if (!(prisma as any).driverReminder) {
      return res.status(501).json({ error: "Reminders feature is not enabled" });
    }

    const { type, message, action, actionLink, expiresAt, meta } = req.body ?? {};
    const cleanedMessage = String(message ?? "").trim();
    const cleanedAction = action != null ? String(action).trim() : "";
    const cleanedActionLink = actionLink != null ? String(actionLink).trim() : "";
    if (!cleanedMessage) return res.status(400).json({ error: "message required" });

    const created = await (prisma as any).driverReminder.create({
      data: {
        driverId,
        type: String(type ?? "INFO").trim() || "INFO",
        message: cleanedMessage,
        action: cleanedAction || null,
        actionLink: cleanedActionLink || null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        meta: meta ?? null,
      },
    });

    const io = (req as any).app?.get("io");
    if (io && typeof io.to === "function") {
      io.to(`driver:${driverId}`).emit("new-reminder", {
        id: String(created.id),
        type: created.type || "INFO",
        message: created.message,
        action: created.action || null,
        actionLink: created.actionLink || null,
        expiresAt: created.expiresAt ? new Date(created.expiresAt).toISOString() : null,
        createdAt: created.createdAt ? new Date(created.createdAt).toISOString() : new Date().toISOString(),
        meta: created.meta || null,
      });
    }

    return res.status(201).json({
      id: String(created.id),
      driver: {
        id: driver.id,
        name: driver.name,
        email: driver.email,
      },
      type: created.type || "INFO",
      message: created.message,
      action: created.action || null,
      actionLink: created.actionLink || null,
      expiresAt: created.expiresAt ? new Date(created.expiresAt).toISOString() : null,
      isRead: Boolean((created as any).read ?? false),
      createdAt: created.createdAt ? new Date(created.createdAt).toISOString() : new Date().toISOString(),
      meta: created.meta || null,
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when creating driver reminder:', err.message);
      return res.status(501).json({ error: 'Reminders feature is not enabled' });
    }
    console.error('Unhandled error in POST /admin/drivers/:id/reminders:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/expiring-documents
 * Get all drivers with expiring documents (license/insurance)
 * License: checks 100 days before expiry
 * Insurance: checks 90 days before expiry
 */
router.get("/expiring-documents", async (req, res) => {
  try {
    const driversWithExpiringDocs: any[] = [];

    try {
      // Get all drivers
      const drivers = await prisma.user.findMany({
        where: { role: "DRIVER" },
        select: { id: true, name: true, email: true, phone: true },
      });

      for (const driver of drivers) {
        const expiringDocs: any[] = [];

        // Check for license expiration (100 days before)
        try {
          if ((prisma as any).driverDocument) {
            const licenses = await (prisma as any).driverDocument.findMany({
              where: {
                driverId: driver.id,
                type: "LICENSE",
              },
              orderBy: { expiryDate: "desc" },
              take: 1,
            });

            if (licenses[0]?.expiryDate) {
              const expiry = new Date(licenses[0].expiryDate);
              const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              if (daysLeft <= 100 && daysLeft > 0) {
                expiringDocs.push({
                  type: "LICENSE",
                  expiryDate: licenses[0].expiryDate,
                  daysLeft,
                  documentId: licenses[0].id,
                  threshold: 100,
                });
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to check license for driver ${driver.id}`, e);
        }

        // Check for insurance expiration (90 days before)
        try {
          if ((prisma as any).driverDocument) {
            const insurances = await (prisma as any).driverDocument.findMany({
              where: {
                driverId: driver.id,
                type: "INSURANCE",
              },
              orderBy: { expiryDate: "desc" },
              take: 1,
            });

            if (insurances[0]?.expiryDate) {
              const expiry = new Date(insurances[0].expiryDate);
              const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              if (daysLeft <= 90 && daysLeft > 0) {
                expiringDocs.push({
                  type: "INSURANCE",
                  expiryDate: insurances[0].expiryDate,
                  daysLeft,
                  documentId: insurances[0].id,
                  threshold: 90,
                });
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to check insurance for driver ${driver.id}`, e);
        }

        if (expiringDocs.length > 0) {
          driversWithExpiringDocs.push({
            driver,
            expiringDocuments: expiringDocs,
          });
        }
      }
    } catch (e) {
      console.warn("Failed to check expiring documents", e);
    }

    return res.json({ drivers: driversWithExpiringDocs, total: driversWithExpiringDocs.length });
  } catch (err: any) {
    console.error("Failed to get expiring documents", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** POST /admin/drivers/auto-create-reminders
 * Comprehensive auto-create reminders system
 * - License: 100 days before expiry
 * - Insurance: 90 days before expiry
 * - Rating-based reminders (auto)
 * - General safety/security reminders (auto)
 */
router.post("/auto-create-reminders", async (req, res) => {
  try {
    const createdReminders: any[] = [];
    const stats = {
      license: 0,
      insurance: 0,
      rating: 0,
      safety: 0,
      security: 0,
      goals: 0,
      earnings: 0,
    };

    try {
      // Get all drivers with their details
      const drivers = await prisma.user.findMany({
        where: { role: "DRIVER" },
        select: { 
          id: true, 
          name: true, 
          email: true, 
          vehicleType: true,
          rating: true,
        } as any,
      });

      for (const driver of drivers) {
        const driverId = driver.id;
        const vehicleType = (driver as any).vehicleType || null;
        const rating = (driver as any).rating ? Number((driver as any).rating) : 0;

        // 1. Check for license expiration (100 days before)
        try {
          if ((prisma as any).driverDocument && (prisma as any).driverReminder) {
            const licenses = await (prisma as any).driverDocument.findMany({
              where: {
                driverId: driverId,
                type: "LICENSE",
              },
              orderBy: { expiryDate: "desc" },
              take: 1,
            });

            if (licenses[0]?.expiryDate) {
              const expiry = new Date(licenses[0].expiryDate);
              const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              
              // Create reminder 100 days before expiry
              if (daysLeft <= 100 && daysLeft > 0) {
                // Check if reminder already exists for this document
                const existingReminders = await (prisma as any).driverReminder.findMany({
                  where: {
                    driverId: driverId,
                    type: "LICENSE_EXPIRY",
                    expiresAt: { gte: new Date() },
                  },
                });
                const existing = existingReminders.find((r: any) => {
                  try {
                    const meta = r.meta || {};
                    return meta.documentId === licenses[0].id || meta.documentId === String(licenses[0].id);
                  } catch {
                    return false;
                  }
                });

                if (!existing) {
                  const message = `Your driver's license expires in ${daysLeft} days (${expiry.toLocaleDateString()}). Please renew it before the expiration date to avoid service interruption.`;
                  const reminder = await (prisma as any).driverReminder.create({
                    data: {
                      driverId: driverId,
                      type: "LICENSE_EXPIRY",
                      message,
                      action: "Renew Now",
                      actionLink: "/driver/management?tab=documents",
                      expiresAt: expiry,
                      meta: { documentId: licenses[0].id, autoGenerated: true, daysRemaining: daysLeft },
                    },
                  });
                  
                  // Emit Socket.IO notification
                  const app = (req as any).app;
                  const io = app?.get('io');
                  if (io && typeof io.emit === 'function') {
                    io.to(`driver:${driverId}`).emit('new-reminder', {
                      id: String(reminder.id),
                      type: reminder.type,
                      message: reminder.message,
                      action: reminder.action,
                      actionLink: reminder.actionLink,
                      expiresAt: reminder.expiresAt ? new Date(reminder.expiresAt).toISOString() : null,
                      createdAt: reminder.createdAt ? new Date(reminder.createdAt).toISOString() : new Date().toISOString(),
                    });
                  }
                  
                  createdReminders.push(reminder);
                  stats.license++;
                }
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to check/create license reminder for driver ${driverId}`, e);
        }

        // 2. Check for insurance expiration (90 days before)
        try {
          if ((prisma as any).driverDocument && (prisma as any).driverReminder) {
            const insurances = await (prisma as any).driverDocument.findMany({
              where: {
                driverId: driverId,
                type: "INSURANCE",
              },
              orderBy: { expiryDate: "desc" },
              take: 1,
            });

            if (insurances[0]?.expiryDate) {
              const expiry = new Date(insurances[0].expiryDate);
              const daysLeft = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              
              // Create reminder 90 days before expiry
              if (daysLeft <= 90 && daysLeft > 0) {
                // Check if reminder already exists for this document
                const existingReminders = await (prisma as any).driverReminder.findMany({
                  where: {
                    driverId: driverId,
                    type: "INSURANCE_EXPIRY",
                    expiresAt: { gte: new Date() },
                  },
                });
                const existing = existingReminders.find((r: any) => {
                  try {
                    const meta = r.meta || {};
                    return meta.documentId === insurances[0].id || meta.documentId === String(insurances[0].id);
                  } catch {
                    return false;
                  }
                });

                if (!existing) {
                  const message = `Your vehicle insurance expires in ${daysLeft} days (${expiry.toLocaleDateString()}). Please renew it before the expiration date to maintain coverage.`;
                  const reminder = await (prisma as any).driverReminder.create({
                    data: {
                      driverId: driverId,
                      type: "INSURANCE_EXPIRY",
                      message,
                      action: "Renew Now",
                      actionLink: "/driver/management?tab=documents",
                      expiresAt: expiry,
                      meta: { documentId: insurances[0].id, autoGenerated: true, daysRemaining: daysLeft },
                    },
                  });
                  createdReminders.push(reminder);
                  stats.insurance++;
                }
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to check/create insurance reminder for driver ${driverId}`, e);
        }

        // 3. Rating-based reminders (auto)
        try {
          if ((prisma as any).driverReminder && rating > 0) {
            // Check if rating reminder already exists (within last 7 days)
            const recentReminders = await (prisma as any).driverReminder.findMany({
              where: {
                driverId: driverId,
                type: { in: ["WARNING", "ALERT", "INFO"] },
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
              },
            });
            const recentRatingReminder = recentReminders.find((r: any) => {
              try {
                const meta = r.meta || {};
                return meta.autoGenerated === true && meta.type === "rating";
              } catch {
                return false;
              }
            });

            if (!recentRatingReminder) {
              let ratingMessage: string | null = null;
              let ratingType = "WARNING";

              if (rating < 3.5) {
                ratingMessage = `Your driver rating is ${rating.toFixed(1)}/5.0, which is below the minimum threshold. Immediate action required to improve service quality and maintain your driver status.`;
                ratingType = "ALERT";
              } else if (rating < 4.0) {
                ratingMessage = `Your driver rating is ${rating.toFixed(1)}/5.0. Please focus on improving service quality to meet our standards. Consider reviewing customer feedback and addressing any concerns.`;
                ratingType = "WARNING";
              } else if (rating < 4.5) {
                ratingMessage = `Your driver rating is ${rating.toFixed(1)}/5.0. Keep up the good work! Aim for 4.5+ to unlock premium benefits and higher earnings.`;
                ratingType = "INFO";
              }

              if (ratingMessage) {
                const reminder = await (prisma as any).driverReminder.create({
                  data: {
                    driverId: driverId,
                    type: ratingType,
                    message: ratingMessage,
                    action: "View Feedback",
                    actionLink: "/driver/feedback",
                    expiresAt: null,
                    meta: { autoGenerated: true, rating: rating, type: "rating" },
                  },
                });
                // Emit Socket.IO notification
                const app = (req as any).app;
                const io = app?.get('io');
                if (io && typeof io.emit === 'function') {
                  io.to(`driver:${driverId}`).emit('new-reminder', {
                    id: String(reminder.id),
                    type: reminder.type,
                    message: reminder.message,
                    action: reminder.action,
                    actionLink: reminder.actionLink,
                    expiresAt: reminder.expiresAt ? new Date(reminder.expiresAt).toISOString() : null,
                    createdAt: reminder.createdAt ? new Date(reminder.createdAt).toISOString() : new Date().toISOString(),
                  });
                }
                createdReminders.push(reminder);
                stats.rating++;
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to check/create rating reminder for driver ${driverId}`, e);
        }

        // 4. General safety reminders (auto) - Vehicle type specific
        try {
          if ((prisma as any).driverReminder) {
            // Check if safety reminder exists (within last 30 days)
            const recentReminders = await (prisma as any).driverReminder.findMany({
              where: {
                driverId: driverId,
                type: "SAFETY",
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            });
            const recentSafetyReminder = recentReminders.find((r: any) => {
              try {
                const meta = r.meta || {};
                return meta.autoGenerated === true && meta.type === "safety";
              } catch {
                return false;
              }
            });

            if (!recentSafetyReminder) {
              let safetyMessage: string | null = null;
              
              if (vehicleType === "MotorCycle") {
                safetyMessage = "Safety Reminder: Always wear a helmet while driving. Ensure your helmet meets safety standards and is properly fastened. Safety is our top priority.";
              } else if (vehicleType === "Car" || vehicleType === "Tuktuk") {
                safetyMessage = "Safety Reminder: Always wear your seatbelt and ensure all passengers do the same. Check your vehicle's safety equipment regularly (first aid kit, fire extinguisher, etc.).";
              } else {
                safetyMessage = "Safety Reminder: Follow all traffic rules and regulations. Maintain your vehicle in good condition and report any safety concerns immediately.";
              }

              if (safetyMessage) {
                const reminder = await (prisma as any).driverReminder.create({
                  data: {
                    driverId: driverId,
                    type: "SAFETY",
                    message: safetyMessage,
                    action: "Review Safety Guidelines",
                    actionLink: "/driver/management?tab=safety",
                    expiresAt: null,
                    meta: { autoGenerated: true, vehicleType: vehicleType, type: "safety" },
                  },
                });
                // Emit Socket.IO notification
                const app = (req as any).app;
                const io = app?.get('io');
                if (io && typeof io.emit === 'function') {
                  io.to(`driver:${driverId}`).emit('new-reminder', {
                    id: String(reminder.id),
                    type: reminder.type,
                    message: reminder.message,
                    action: reminder.action,
                    actionLink: reminder.actionLink,
                    expiresAt: reminder.expiresAt ? new Date(reminder.expiresAt).toISOString() : null,
                    createdAt: reminder.createdAt ? new Date(reminder.createdAt).toISOString() : new Date().toISOString(),
                  });
                }
                createdReminders.push(reminder);
                stats.safety++;
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to check/create safety reminder for driver ${driverId}`, e);
        }

        // 5. General security reminders (auto) - Monthly
        try {
          if ((prisma as any).driverReminder) {
            // Check if security reminder exists (within last 30 days)
            const recentReminders = await (prisma as any).driverReminder.findMany({
              where: {
                driverId: driverId,
                type: "INFO",
                createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
              },
            });
            const recentSecurityReminder = recentReminders.find((r: any) => {
              try {
                const meta = r.meta || {};
                return meta.type === "security" && meta.autoGenerated === true;
              } catch {
                return false;
              }
            });

            if (!recentSecurityReminder) {
              const securityMessage = "Security Reminder: Keep your driver app account secure. Never share your login credentials. Report any suspicious activity immediately. Regularly update your password.";
              
              const reminder = await (prisma as any).driverReminder.create({
                data: {
                  driverId: driverId,
                  type: "INFO",
                  message: securityMessage,
                  action: "Update Password",
                  actionLink: "/driver/settings",
                  expiresAt: null,
                  meta: { autoGenerated: true, type: "security" },
                },
              });
              
              // Emit Socket.IO notification
              const app = (req as any).app;
              const io = app?.get('io');
              if (io && typeof io.emit === 'function') {
                io.to(`driver:${driverId}`).emit('new-reminder', {
                  id: String(reminder.id),
                  type: reminder.type,
                  message: reminder.message,
                  action: reminder.action,
                  actionLink: reminder.actionLink,
                  expiresAt: reminder.expiresAt ? new Date(reminder.expiresAt).toISOString() : null,
                  createdAt: reminder.createdAt ? new Date(reminder.createdAt).toISOString() : new Date().toISOString(),
                });
              }
              
              createdReminders.push(reminder);
              stats.security++;
            }
          }
        } catch (e) {
          console.warn(`Failed to check/create security reminder for driver ${driverId}`, e);
        }

        // 6. Automatic Goals and Earnings Reminders
        try {
          if ((prisma as any).driverReminder) {
            // Calculate driver's recent earnings
            let todayEarnings = 0;
            let weeklyEarnings = 0;
            let monthlyEarnings = 0;
            let todayTrips = 0;
            let weeklyTrips = 0;
            let monthlyTrips = 0;

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const weekAgo = new Date(today);
            weekAgo.setDate(weekAgo.getDate() - 7);
            const monthAgo = new Date(today);
            monthAgo.setDate(monthAgo.getDate() - 30);

            try {
              // Get trips with invoices
              if ((prisma as any).trip) {
                const allTrips = await (prisma as any).trip.findMany({
                  where: {
                    driverId: driverId,
                    createdAt: { gte: monthAgo },
                  },
                  include: {
                    booking: {
                      include: {
                        invoice: true,
                      },
                    },
                  },
                });

                // Calculate today's stats
                const todayTripsData = allTrips.filter((t: any) => {
                  const tripDate = new Date(t.createdAt);
                  return tripDate >= today && tripDate < tomorrow;
                });
                todayTrips = todayTripsData.length;
                todayEarnings = todayTripsData.reduce((sum: number, trip: any) => {
                  return sum + Number(trip.booking?.invoice?.totalAmount || trip.booking?.invoice?.total || trip.booking?.invoice?.amount || 0);
                }, 0);

                // Calculate weekly stats
                const weeklyTripsData = allTrips.filter((t: any) => {
                  const tripDate = new Date(t.createdAt);
                  return tripDate >= weekAgo;
                });
                weeklyTrips = weeklyTripsData.length;
                weeklyEarnings = weeklyTripsData.reduce((sum: number, trip: any) => {
                  return sum + Number(trip.booking?.invoice?.totalAmount || trip.booking?.invoice?.total || trip.booking?.invoice?.amount || 0);
                }, 0);

                // Calculate monthly stats
                monthlyTrips = allTrips.length;
                monthlyEarnings = allTrips.reduce((sum: number, trip: any) => {
                  return sum + Number(trip.booking?.invoice?.totalAmount || trip.booking?.invoice?.total || trip.booking?.invoice?.amount || 0);
                }, 0);
              }
            } catch (e) {
              console.warn(`Failed to calculate earnings for driver ${driverId}`, e);
            }

            // Calculate average daily earnings (from last 7 days)
            const avgDailyEarnings = weeklyEarnings / 7;
            const avgDailyTrips = weeklyTrips / 7;

            // Set automatic goals based on performance using configurable values
            const { getGoalConfig } = await import("../lib/business-config.js");
            const goalConfig = await getGoalConfig();
            const dailyEarningsGoal = Math.max(100000, Math.ceil(avgDailyEarnings * goalConfig.multiplier)); // Configurable multiplier above average or 100K minimum
            const dailyTripsGoal = Math.max(10, Math.ceil(avgDailyTrips * goalConfig.multiplier)); // Configurable multiplier above average or 10 trips minimum
            const weeklyEarningsGoal = Math.max(700000, Math.ceil(avgDailyEarnings * 7 * goalConfig.multiplier)); // Weekly goal
            const monthlyEarningsGoal = Math.max(goalConfig.minimumMonthly, Math.ceil(avgDailyEarnings * 30 * goalConfig.multiplier)); // Monthly goal

            // Check if goal reminder exists (within last 7 days)
            const recentGoalReminders = await (prisma as any).driverReminder.findMany({
              where: {
                driverId: driverId,
                type: { in: ["INFO", "WARNING"] },
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
              },
            });
            const recentGoalReminder = recentGoalReminders.find((r: any) => {
              try {
                const meta = r.meta || {};
                return meta.type === "goal" && meta.autoGenerated === true;
              } catch {
                return false;
              }
            });

            if (!recentGoalReminder) {
              // Create goal reminder
              const goalProgress = todayEarnings > 0 ? Math.min(100, Math.round((todayEarnings / dailyEarningsGoal) * 100)) : 0;
              const tripsProgress = todayTrips > 0 ? Math.min(100, Math.round((todayTrips / dailyTripsGoal) * 100)) : 0;

              let goalMessage: string | null = null;
              let goalType = "INFO";

              if (goalProgress < 50 && todayEarnings > 0) {
                goalMessage = `Daily Goal Progress: You've earned ${todayEarnings.toLocaleString()} TZS today (${goalProgress}% of your ${dailyEarningsGoal.toLocaleString()} TZS goal). Keep pushing to reach your daily target!`;
                goalType = "WARNING";
              } else if (goalProgress >= 50 && goalProgress < 100) {
                goalMessage = `Daily Goal Progress: Great work! You've earned ${todayEarnings.toLocaleString()} TZS today (${goalProgress}% of your ${dailyEarningsGoal.toLocaleString()} TZS goal). You're ${((dailyEarningsGoal - todayEarnings) / 1000).toFixed(0)}K TZS away from your daily target.`;
                goalType = "INFO";
              } else if (goalProgress >= 100) {
                goalMessage = `Congratulations! You've exceeded your daily earnings goal of ${dailyEarningsGoal.toLocaleString()} TZS. You've earned ${todayEarnings.toLocaleString()} TZS today. Keep up the excellent work!`;
                goalType = "INFO";
              } else {
                goalMessage = `Your daily goals are set: Earn ${dailyEarningsGoal.toLocaleString()} TZS and complete ${dailyTripsGoal} trips. Current progress: ${todayEarnings.toLocaleString()} TZS (${goalProgress}%) and ${todayTrips} trips (${tripsProgress}%).`;
                goalType = "INFO";
              }

              if (goalMessage) {
                const reminder = await (prisma as any).driverReminder.create({
                  data: {
                    driverId: driverId,
                    type: goalType,
                    message: goalMessage,
                    action: "View Dashboard",
                    actionLink: "/driver/dashboard",
                    expiresAt: new Date(tomorrow.getTime() - 1), // Expires at end of day
                    meta: { 
                      autoGenerated: true, 
                      type: "goal",
                      dailyEarningsGoal,
                      dailyTripsGoal,
                      weeklyEarningsGoal,
                      monthlyEarningsGoal,
                      todayEarnings,
                      todayTrips,
                      goalProgress,
                      tripsProgress,
                    },
                  },
                });
                // Emit Socket.IO notification
                const app = (req as any).app;
                const io = app?.get('io');
                if (io && typeof io.emit === 'function') {
                  io.to(`driver:${driverId}`).emit('new-reminder', {
                    id: String(reminder.id),
                    type: reminder.type,
                    message: reminder.message,
                    action: reminder.action,
                    actionLink: reminder.actionLink,
                    expiresAt: reminder.expiresAt ? new Date(reminder.expiresAt).toISOString() : null,
                    createdAt: reminder.createdAt ? new Date(reminder.createdAt).toISOString() : new Date().toISOString(),
                  });
                }
                createdReminders.push(reminder);
                stats.goals++;
              }
            }

            // 7. Earnings Performance Reminders
            const recentEarningsReminders = await (prisma as any).driverReminder.findMany({
              where: {
                driverId: driverId,
                type: { in: ["INFO", "WARNING"] },
                createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
              },
            });
            const recentEarningsReminder = recentEarningsReminders.find((r: any) => {
              try {
                const meta = r.meta || {};
                return meta.type === "earnings" && meta.autoGenerated === true;
              } catch {
                return false;
              }
            });

            if (!recentEarningsReminder) {
              let earningsMessage: string | null = null;
              let earningsType = "INFO";

              // Weekly earnings analysis
              if (weeklyEarnings > 0) {
                const weeklyProgress = Math.min(100, Math.round((weeklyEarnings / weeklyEarningsGoal) * 100));
                
                if (weeklyProgress < 60) {
                  earningsMessage = `Weekly Earnings Alert: You've earned ${weeklyEarnings.toLocaleString()} TZS this week (${weeklyProgress}% of your ${weeklyEarningsGoal.toLocaleString()} TZS goal). Consider increasing your online hours or accepting more trips to reach your target.`;
                  earningsType = "WARNING";
                } else if (weeklyProgress >= 60 && weeklyProgress < 100) {
                  earningsMessage = `Weekly Earnings Update: You've earned ${weeklyEarnings.toLocaleString()} TZS this week (${weeklyProgress}% of your ${weeklyEarningsGoal.toLocaleString()} TZS goal). You're on track! Keep it up.`;
                  earningsType = "INFO";
                } else {
                  earningsMessage = `Excellent Performance! You've exceeded your weekly earnings goal. You've earned ${weeklyEarnings.toLocaleString()} TZS this week (${weeklyProgress}% of ${weeklyEarningsGoal.toLocaleString()} TZS). Outstanding work!`;
                  earningsType = "INFO";
                }
              } else {
                earningsMessage = `Earnings Summary: Your average daily earnings are ${Math.round(avgDailyEarnings).toLocaleString()} TZS. Set a goal to earn ${dailyEarningsGoal.toLocaleString()} TZS daily and ${weeklyEarningsGoal.toLocaleString()} TZS weekly to maximize your income.`;
                earningsType = "INFO";
              }

              if (earningsMessage) {
                const reminder = await (prisma as any).driverReminder.create({
                  data: {
                    driverId: driverId,
                    type: earningsType,
                    message: earningsMessage,
                    action: "View Earnings",
                    actionLink: "/driver/dashboard",
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Expires in 7 days
                    meta: { 
                      autoGenerated: true, 
                      type: "earnings",
                      todayEarnings,
                      weeklyEarnings,
                      monthlyEarnings,
                      todayTrips,
                      weeklyTrips,
                      monthlyTrips,
                      avgDailyEarnings: Math.round(avgDailyEarnings),
                      avgDailyTrips: Math.round(avgDailyTrips),
                    },
                  },
                });
                // Emit Socket.IO notification
                const app = (req as any).app;
                const io = app?.get('io');
                if (io && typeof io.emit === 'function') {
                  io.to(`driver:${driverId}`).emit('new-reminder', {
                    id: String(reminder.id),
                    type: reminder.type,
                    message: reminder.message,
                    action: reminder.action,
                    actionLink: reminder.actionLink,
                    expiresAt: reminder.expiresAt ? new Date(reminder.expiresAt).toISOString() : null,
                    createdAt: reminder.createdAt ? new Date(reminder.createdAt).toISOString() : new Date().toISOString(),
                  });
                }
                createdReminders.push(reminder);
                stats.earnings++;
              }
            }
          }
        } catch (e) {
          console.warn(`Failed to check/create goals/earnings reminders for driver ${driverId}`, e);
        }
      }
    } catch (e) {
      console.warn("Failed to auto-create reminders", e);
    }

    return res.json({ 
      created: createdReminders.length, 
      reminders: createdReminders,
      stats: {
        license: stats.license,
        insurance: stats.insurance,
        rating: stats.rating,
        safety: stats.safety,
        security: stats.security,
        goals: stats.goals,
        earnings: stats.earnings,
      },
    });
  } catch (err: any) {
    console.error("Failed to auto-create reminders", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /admin/drivers/stats/daily?date=YYYY-MM-DD
 * Returns per-driver daily transport payout statistics for the selected date.
 */
router.get("/stats/daily", async (req, res) => {
  try {
    const { date } = req.query as any;
    const selected = String(date || new Date().toISOString().split("T")[0]).slice(0, 10);
    const start = new Date(selected + "T00:00:00.000Z");
    const end = new Date(selected + "T23:59:59.999Z");
    const range = { gte: start, lte: end };

    const drivers = await prisma.user.findMany({
      where: { role: "DRIVER" },
      select: { id: true, name: true, email: true, phone: true },
      orderBy: { id: "desc" },
      take: 250,
    });

    const byDriver = new Map<number, any>();
    for (const driver of drivers) {
      byDriver.set(driver.id, {
        id: driver.id,
        name: driver.name || driver.email || `Driver ${driver.id}`,
        email: driver.email || "",
        phone: driver.phone || null,
        todaysRides: 0,
        earnings: 0,
        grossRevenue: 0,
        nolsafRevenue: 0,
        paidEarnings: 0,
        paidPayouts: 0,
        pendingPayouts: 0,
        verifiedPayouts: 0,
        approvedPayouts: 0,
        invoiceCount: 0,
        rating: 0,
        totalReviews: 0,
      });
    }

    if ((prisma as any).transportPayout) {
      const payouts = await (prisma as any).transportPayout.findMany({
        where: {
          booking: {
            status: { in: ["COMPLETED", "FINISHED"] },
            OR: [
              { dropoffTime: range },
              { scheduledDate: range },
              { updatedAt: range },
            ],
          },
        },
        include: {
          booking: {
            select: {
              id: true,
              driverId: true,
              userRating: true,
              rating: true,
            },
          },
        },
      });

      const tripIdsByDriver = new Map<number, Set<number>>();
      const ratingsByDriver = new Map<number, number[]>();

      for (const payout of payouts || []) {
        const driverId = Number((payout as any).driverId ?? (payout as any).booking?.driverId);
        if (!Number.isFinite(driverId)) continue;
        const row = byDriver.get(driverId);
        if (!row) continue;

        const bookingId = Number((payout as any).transportBookingId ?? (payout as any).booking?.id);
        if (Number.isFinite(bookingId)) {
          if (!tripIdsByDriver.has(driverId)) tripIdsByDriver.set(driverId, new Set());
          tripIdsByDriver.get(driverId)!.add(bookingId);
        }

        const status = String((payout as any).status ?? "").toUpperCase();
        const gross = Number((payout as any).grossAmount ?? 0) || 0;
        const commission = Number((payout as any).commissionAmount ?? 0) || 0;
        const net = Number((payout as any).netPaid ?? 0) || 0;

        row.grossRevenue += gross;
        row.nolsafRevenue += commission;
        row.earnings += net;
        row.invoiceCount += 1;

        if (status === "PAID") {
          row.paidPayouts += 1;
          row.paidEarnings += net;
        } else if (status === "PENDING") {
          row.pendingPayouts += 1;
        } else if (status === "VERIFIED") {
          row.verifiedPayouts += 1;
        } else if (status === "APPROVED") {
          row.approvedPayouts += 1;
        }

        const rating = Number((payout as any).booking?.userRating ?? (payout as any).booking?.rating ?? 0);
        if (Number.isFinite(rating) && rating > 0) {
          if (!ratingsByDriver.has(driverId)) ratingsByDriver.set(driverId, []);
          ratingsByDriver.get(driverId)!.push(rating);
        }
      }

      for (const [driverId, row] of byDriver.entries()) {
        const trips = tripIdsByDriver.get(driverId);
        const ratings = ratingsByDriver.get(driverId) || [];
        row.todaysRides = trips?.size || 0;
        row.rating = ratings.length ? Number((ratings.reduce((sum, r) => sum + r, 0) / ratings.length).toFixed(1)) : 0;
        row.totalReviews = ratings.length;
        row.earnings = Math.round(row.earnings);
        row.grossRevenue = Math.round(row.grossRevenue);
        row.nolsafRevenue = Math.round(row.nolsafRevenue);
        row.paidEarnings = Math.round(row.paidEarnings);
      }
    }

    const items = Array.from(byDriver.values()).sort((a, b) => {
      const byRides = Number(b.todaysRides || 0) - Number(a.todaysRides || 0);
      if (byRides !== 0) return byRides;
      return Number(b.earnings || 0) - Number(a.earnings || 0);
    });

    return res.json({
      date: selected,
      total: items.length,
      items,
      summary: {
        drivers: items.length,
        activeDrivers: items.filter((x) => Number(x.todaysRides || 0) > 0).length,
        rides: items.reduce((sum, x) => sum + Number(x.todaysRides || 0), 0),
        grossRevenue: items.reduce((sum, x) => sum + Number(x.grossRevenue || 0), 0),
        driverNet: items.reduce((sum, x) => sum + Number(x.earnings || 0), 0),
        nolsafRevenue: items.reduce((sum, x) => sum + Number(x.nolsafRevenue || 0), 0),
      },
    });
  } catch (err: any) {
    console.error("Unhandled error in GET /admin/drivers/stats/daily:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /admin/drivers/:id/stats
 * Returns comprehensive stats for a specific driver
 */
router.get("/:id(\\d+)/stats", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    const { date } = req.query as any;
    
    // Verify driver exists
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER" },
      select: { id: true, name: true, email: true },
    });
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const today = new Date();
    if (date) {
      today.setTime(new Date(date + "T00:00:00.000Z").getTime());
    }
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let todaysRides = 0;
    let earnings = 0;
    let grossRevenue = 0;
    let nolsafRevenue = 0;
    let paidEarnings = 0;
    let paidPayouts = 0;
    let pendingPayouts = 0;
    let verifiedPayouts = 0;
    let approvedPayouts = 0;
    let invoiceCount = 0;
    let rating = 0;
    let totalReviews = 0;
    let trips: any[] = [];

    try {
      const start = date ? new Date(date + "T00:00:00.000Z") : today;
      const end = date ? new Date(date + "T23:59:59.999Z") : tomorrow;
      const range: any = date ? { gte: start, lte: end } : { gte: start, lt: end };

      // Prefer connected transport payouts so rides, earnings, commission, and paid state reconcile with finance pages.
      let usedTransport = false;
      if ((prisma as any).transportPayout) {
        try {
          const payouts = await (prisma as any).transportPayout.findMany({
            where: {
              driverId,
              booking: {
                status: { in: ["COMPLETED", "FINISHED"] },
                OR: [
                  { dropoffTime: range },
                  { scheduledDate: range },
                  { updatedAt: range },
                ],
              },
            },
            include: {
              booking: {
                select: {
                  id: true,
                  tripCode: true,
                  status: true,
                  scheduledDate: true,
                  pickupTime: true,
                  dropoffTime: true,
                  updatedAt: true,
                  fromAddress: true,
                  toAddress: true,
                  fromRegion: true,
                  fromDistrict: true,
                  toRegion: true,
                  toDistrict: true,
                  vehicleType: true,
                  userRating: true,
                  rating: true,
                },
              },
            },
            orderBy: [{ paidAt: "desc" }, { updatedAt: "desc" }],
          });

          const tripIds = new Set<number>();
          const ratings: number[] = [];

          for (const payout of payouts || []) {
            const booking = (payout as any).booking;
            const bookingId = Number((payout as any).transportBookingId ?? booking?.id);
            if (Number.isFinite(bookingId)) tripIds.add(bookingId);

            const status = String((payout as any).status ?? "").toUpperCase();
            const gross = Number((payout as any).grossAmount ?? 0) || 0;
            const commission = Number((payout as any).commissionAmount ?? 0) || 0;
            const net = Number((payout as any).netPaid ?? 0) || 0;

            grossRevenue += gross;
            nolsafRevenue += commission;
            earnings += net;
            invoiceCount += 1;

            if (status === "PAID") {
              paidPayouts += 1;
              paidEarnings += net;
            } else if (status === "PENDING") {
              pendingPayouts += 1;
            } else if (status === "VERIFIED") {
              verifiedPayouts += 1;
            } else if (status === "APPROVED") {
              approvedPayouts += 1;
            }

            const r = Number(booking?.userRating ?? booking?.rating ?? 0);
            if (Number.isFinite(r) && r > 0) ratings.push(r);

            trips.push({
              id: booking?.id ?? bookingId,
              tripCode: booking?.tripCode ?? `TRP-${bookingId}`,
              route: {
                pickup: booking?.fromAddress ?? ([booking?.fromDistrict, booking?.fromRegion].filter(Boolean).join(", ") || "N/A"),
                dropoff: booking?.toAddress ?? ([booking?.toDistrict, booking?.toRegion].filter(Boolean).join(", ") || "N/A"),
              },
              vehicleType: booking?.vehicleType ?? null,
              status: booking?.status ?? null,
              payoutStatus: status,
              grossAmount: Math.round(gross),
              commissionAmount: Math.round(commission),
              driverNet: Math.round(net),
              rating: Number.isFinite(r) && r > 0 ? Number(r.toFixed(1)) : null,
              completedAt: (booking?.dropoffTime ?? booking?.updatedAt ?? booking?.scheduledDate ?? payout?.updatedAt)?.toISOString?.() ?? null,
            });
          }

          todaysRides = tripIds.size;
          totalReviews = ratings.length;
          rating = ratings.length ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : 0;
          usedTransport = true;
        } catch (e: any) {
          // ignore and fall back to booking model
          console.warn("Failed to fetch stats from TransportPayout", e);
        }
      }

      if (!usedTransport && (prisma as any).booking) {
        const booking = (prisma as any).booking;

        // Some schemas store transport rides inside Booking under transportScheduledDate
        const tryCountWith = async (where: any) => booking.count({ where });
        const tryFindCompletedWith = async (where: any) => {
          // Prefer totalAmount if present
          try {
            return await booking.findMany({
              where: { ...where, status: { in: ["COMPLETED", "FINISHED", "PAID"] } },
              select: { totalAmount: true, price: true, total: true, fare: true } as any,
            });
          } catch {
            return await booking.findMany({
              where: { ...where, status: { in: ["COMPLETED", "FINISHED", "PAID"] } },
              select: { totalAmount: true } as any,
            });
          }
        };

        const baseWhere: any = { driverId };

        // Try transportScheduledDate, then checkIn, then createdAt.
        const attempts: Array<{ label: string; where: any }> = [
          { label: "transportScheduledDate", where: { ...baseWhere, transportScheduledDate: range } },
          { label: "checkIn", where: { ...baseWhere, checkIn: range } },
          { label: "createdAt", where: { ...baseWhere, createdAt: range } },
        ];

        let lastErr: any = null;
        for (const a of attempts) {
          try {
            todaysRides = await tryCountWith(a.where);
            const completed = await tryFindCompletedWith(a.where);
            earnings = (completed || []).reduce(
              (s: number, b: any) => s + (Number(b.totalAmount ?? b.price ?? b.total ?? b.fare) || 0),
              0
            );
            grossRevenue = earnings;
            lastErr = null;
            break;
          } catch (err: any) {
            lastErr = err;
          }
        }

        if (lastErr) {
          console.warn("Failed to fetch stats from Booking model", lastErr);
        }
      }
    } catch (e) {
      // Errors in stats aggregation should not break the page
      console.warn("Failed to fetch stats", e);
    }

    try {
      const u = await prisma.user.findUnique({
        where: { id: driverId },
        select: { rating: true } as any,
      });
      const storedRating = Number((u as any)?.rating ?? 0);
      if (!rating && Number.isFinite(storedRating)) rating = storedRating;
    } catch (e) {
      console.warn('Failed to fetch rating', e);
    }

    return res.json({
      driver: {
        id: driver.id,
        name: driver.name,
        email: driver.email,
      },
      date: date || today.toISOString().split('T')[0],
      todaysRides,
      earnings: Math.round(earnings),
      grossRevenue: Math.round(grossRevenue),
      nolsafRevenue: Math.round(nolsafRevenue),
      paidEarnings: Math.round(paidEarnings),
      paidPayouts,
      pendingPayouts,
      verifiedPayouts,
      approvedPayouts,
      invoiceCount,
      rating: parseFloat(rating.toFixed(1)),
      totalReviews,
      trips,
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver stats:', err.message);
      return res.json({
        driver: null,
        date: (req.query as any).date || new Date().toISOString().split('T')[0],
        todaysRides: 0,
        earnings: 0,
        grossRevenue: 0,
        nolsafRevenue: 0,
        paidEarnings: 0,
        paidPayouts: 0,
        pendingPayouts: 0,
        verifiedPayouts: 0,
        approvedPayouts: 0,
        invoiceCount: 0,
        rating: 0,
        totalReviews: 0,
        trips: [],
      });
    }
    console.error('Unhandled error in GET /admin/drivers/:id/stats:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** GET /admin/drivers/:id/activities
 * Returns a comprehensive summary of all driver activities
 */
router.get("/:id(\\d+)/activities", async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    if (!Number.isFinite(driverId)) {
      return res.status(400).json({ error: "Invalid driver ID" });
    }
    
    // Verify driver exists
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: "DRIVER" },
      select: { id: true, name: true, email: true, createdAt: true },
    });
    if (!driver) {
      return res.status(404).json({ error: "Driver not found" });
    }

    // Get all activity summaries - use proper Prisma models
    const [referrals, bonuses, level, reminders, stats, trips, invoices] = await Promise.all([
      // Referrals summary
      (async () => {
        try {
          let totalReferrals = 0;
          // Check for referredBy field in User model
          totalReferrals = await prisma.user.count({
            where: {
              referredBy: driverId,
            },
          });
          return { totalReferrals };
        } catch (e: any) {
          // If referredBy field doesn't exist, return 0
          console.warn('Error counting referrals:', e?.message);
          return { totalReferrals: 0 };
        }
      })(),
      // Bonuses summary
      (async () => {
        try {
          const bonusCount = await prisma.adminAudit.count({
            where: {
              targetUserId: driverId,
              action: 'GRANT_BONUS',
            },
          });
          return { totalBonuses: bonusCount };
        } catch (e: any) {
          console.warn('Error counting bonuses:', e?.message);
          return { totalBonuses: 0 };
        }
      })(),
      // Level summary - count completed bookings/trips
      (async () => {
        try {
          let totalTrips = 0;
          // Try TransportBooking first (for transport rides)
          try {
            totalTrips = await prisma.transportBooking.count({
              where: {
                driverId,
                status: { in: ['COMPLETED', 'CONFIRMED', 'IN_PROGRESS'] },
              },
            });
          } catch (e: any) {
            // If TransportBooking doesn't exist or fails, try Booking model
            try {
              totalTrips = await prisma.booking.count({
                where: {
                  driverId,
                  status: { in: ['CHECKED_IN', 'CHECKED_OUT', 'CONFIRMED'] },
                },
              });
            } catch (e2: any) {
              console.warn('Error counting trips from Booking:', e2?.message);
            }
          }
          return { totalTrips };
        } catch (e: any) {
          console.warn('Error counting trips:', e?.message);
          return { totalTrips: 0 };
        }
      })(),
      // Reminders summary
      (async () => {
        try {
          let unreadReminders = 0;
          // Try to find driver reminders - check if model exists
          try {
            if ((prisma as any).driverReminder) {
              unreadReminders = await (prisma as any).driverReminder.count({
                where: { driverId, read: false },
              });
            }
          } catch (e: any) {
            // Model doesn't exist, return 0
            console.warn('DriverReminder model not found:', e?.message);
          }
          return { unreadReminders };
        } catch (e: any) {
          console.warn('Error counting reminders:', e?.message);
          return { unreadReminders: 0 };
        }
      })(),
      // Stats summary - today's trips
      (async () => {
        try {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          
          let todayTrips = 0;
          // Try TransportBooking first
          try {
            todayTrips = await prisma.transportBooking.count({
              where: {
                driverId,
                scheduledDate: { gte: today, lt: tomorrow },
              },
            });
          } catch (e: any) {
            // If TransportBooking fails, try Booking
            try {
              todayTrips = await prisma.booking.count({
                where: {
                  driverId,
                  checkIn: { gte: today, lt: tomorrow },
                },
              });
            } catch (e2: any) {
              console.warn('Error counting today trips:', e2?.message);
            }
          }
          return { todayTrips };
        } catch (e: any) {
          console.warn('Error counting today trips:', e?.message);
          return { todayTrips: 0 };
        }
      })(),
      // Trips summary - total trips (all statuses)
      (async () => {
        try {
          let totalTrips = 0;
          // Try TransportBooking first
          try {
            totalTrips = await prisma.transportBooking.count({
              where: { driverId },
            });
          } catch (e: any) {
            // If TransportBooking fails, try Booking
            try {
              totalTrips = await prisma.booking.count({
                where: { driverId },
              });
            } catch (e2: any) {
              console.warn('Error counting total trips:', e2?.message);
            }
          }
          return { totalTrips };
        } catch (e: any) {
          console.warn('Error counting total trips:', e?.message);
          return { totalTrips: 0 };
        }
      })(),
      // Invoices summary (Invoice is for property bookings, not transport)
      (async () => {
        try {
          // Invoices are for property bookings, not driver transport bookings
          // Return 0 as invoices don't apply to transport bookings
          return { totalInvoices: 0 };
        } catch (e: any) {
          return { totalInvoices: 0 };
        }
      })(),
    ]);

    return res.json({
      driver: {
        id: driver.id,
        name: driver.name || `Driver #${driver.id}`,
        email: driver.email || '',
        createdAt: driver.createdAt.toISOString(),
      },
      activities: {
        referrals: referrals.totalReferrals,
        bonuses: bonuses.totalBonuses,
        trips: level.totalTrips,
        unreadReminders: reminders.unreadReminders,
        todayTrips: stats.todayTrips,
        totalTrips: trips.totalTrips,
        totalInvoices: invoices.totalInvoices,
      },
      lastUpdated: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying driver activities:', err.message);
      // Still return driver info if available, with zero activities
      const driver = await prisma.user.findFirst({
        where: { id: Number(req.params.id), role: "DRIVER" },
        select: { id: true, name: true, email: true, createdAt: true },
      }).catch(() => null);
      
      return res.json({
        driver: driver ? {
          id: driver.id,
          name: driver.name,
          email: driver.email,
          createdAt: driver.createdAt,
        } : null,
        activities: {
          referrals: 0,
          bonuses: 0,
          trips: 0,
          unreadReminders: 0,
          todayTrips: 0,
          totalTrips: 0,
          totalInvoices: 0,
        },
        lastUpdated: new Date().toISOString(),
      });
    }
    console.error('Unhandled error in GET /admin/drivers/:id/activities:', err);
    return res.status(500).json({ error: 'Internal server error', message: err?.message });
  }
});

/** PATCH /admin/drivers/:id/kyc — approve, reject, request_info, or field_review */
router.patch('/:id(\\d+)/kyc', limitAdminTripsWrite, async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    if (!Number.isFinite(driverId) || driverId <= 0) {
      return res.status(400).json({ error: 'Invalid driver id' });
    }

    const { action, reason, note, fieldApprovals } = req.body ?? {};
    const validActions = ['approve', 'reject', 'request_info', 'field_review', 'revoke', 'unrevoke'];
    if (!validActions.includes(String(action))) {
      return res.status(400).json({ error: `action must be one of: ${validActions.join(', ')}` });
    }

    const sanitizedReason = normalizeReason(reason);
    const sanitizedNote = normalizeReason(note, 1000);
    const sanitizedFieldApprovals = sanitizeFieldApprovals(fieldApprovals);

    const driver = await prisma.user.findUnique({ where: { id: driverId, role: 'DRIVER' } as any });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    if (action === 'approve') {
      const missingFields: string[] = [];
      if (!String((driver as any).name ?? '').trim()) missingFields.push('full name');
      if (!String((driver as any).email ?? '').trim()) missingFields.push('email');
      if (!String((driver as any).phone ?? '').trim()) missingFields.push('phone');
      if (!String((driver as any).gender ?? '').trim()) missingFields.push('gender');
      if (!String((driver as any).nationality ?? '').trim()) missingFields.push('nationality');
      if (!(driver as any).dateOfBirth) missingFields.push('date of birth');
      if (!String((driver as any).nin ?? '').trim()) missingFields.push('NIN');
      if (!String((driver as any).region ?? '').trim()) missingFields.push('region');
      if (!String((driver as any).district ?? '').trim()) missingFields.push('district');
      if (!String((driver as any).operationArea ?? '').trim()) missingFields.push('operation area');
      if (!String((driver as any).vehicleType ?? '').trim()) missingFields.push('vehicle type');
      if (!String((driver as any).plateNumber ?? '').trim()) missingFields.push('plate number');
      if (!String((driver as any).licenseNumber ?? '').trim()) missingFields.push('licence number');
      if (!String((driver as any).paymentPhone ?? '').trim()) missingFields.push('payment phone');
      if (!Boolean((driver as any).paymentVerified)) missingFields.push('verified payment phone');

      const currentApprovals = {
        ...(((driver as any).kycFieldApprovals && typeof (driver as any).kycFieldApprovals === 'object')
          ? (driver as any).kycFieldApprovals as Record<string, string>
          : {}),
        ...((sanitizedFieldApprovals && typeof sanitizedFieldApprovals === 'object')
          ? sanitizedFieldApprovals as Record<string, string>
          : {}),
      };
      const requiredApprovalKeys = [
        'name', 'email', 'phone', 'gender', 'nationality', 'dateOfBirth', 'nin',
        'region', 'district', 'operationArea', 'vehicleType', 'plateNumber',
        'licenseNumber', 'paymentPhone', 'drivingLicense', 'nationalId', 'latra', 'insurance',
      ];
      const unapprovedKeys = requiredApprovalKeys.filter((key) => String(currentApprovals[key] ?? '').toLowerCase() !== 'approved');
      if (unapprovedKeys.length > 0) {
        return res.status(400).json({
          error: 'driver_review_incomplete',
          message: 'Approve every required KYC field and document before granting driver access.',
          missingApprovals: unapprovedKeys,
        });
      }

      if (!(prisma as any).userDocument) {
        return res.status(503).json({
          error: 'driver_documents_unavailable',
          message: 'Driver documents are unavailable for review, so this account cannot be approved.',
        });
      }

      const requiredDocumentGroups = [
        {
          label: 'driving licence',
          types: ['DRIVER_LICENSE', 'DRIVING_LICENSE', 'DRIVER_LICENCE', 'DRIVING_LICENCE', 'LICENSE'],
          fallbackUrls: [String((driver as any)?.payout?.drivingLicenseUrl ?? '').trim()],
        },
        {
          label: 'National ID',
          types: ['NATIONAL_ID', 'ID', 'PASSPORT'],
          fallbackUrls: [String((driver as any)?.payout?.nationalIdUrl ?? '').trim()],
        },
        {
          label: 'vehicle registration',
          types: ['VEHICLE_REGISTRATION', 'LATRA', 'VEHICLE_REG'],
          fallbackUrls: [
            String((driver as any)?.payout?.latraUrl ?? '').trim(),
            String((driver as any)?.payout?.vehicleRegistrationUrl ?? '').trim(),
          ],
        },
        {
          label: 'insurance certificate',
          types: ['INSURANCE'],
          fallbackUrls: [String((driver as any)?.payout?.insuranceUrl ?? '').trim()],
        },
      ];
      const docs = await prisma.userDocument.findMany({
        where: { userId: driverId, url: { not: null } } as any,
        select: { type: true, url: true } as any,
      });
      const presentTypes = new Set((docs as any[]).map((doc) => String(doc?.type ?? '').toUpperCase()));
      const missingDocuments = requiredDocumentGroups
        .filter((group) => !group.types.some((type) => presentTypes.has(type)) && !group.fallbackUrls.some((url) => url.length > 0))
        .map((group) => group.label);

      if (missingFields.length > 0 || missingDocuments.length > 0) {
        return res.status(400).json({
          error: 'driver_application_incomplete',
          message: 'Driver approval is blocked until all required onboarding details and documents are present.',
          missingFields,
          missingDocuments,
        });
      }
    }

    // Determine requesting admin id (best-effort)
    const adminId: number | null = (req as any).user?.id ?? null;

    const actionAt = new Date();
    const wasSuspended = Boolean((driver as any).suspendedAt);

    let kycStatus: string = (driver as any).kycStatus ?? 'PENDING_KYC';
    if (action === 'approve') kycStatus = 'APPROVED_KYC';
    else if (action === 'reject' || action === 'revoke') kycStatus = 'REJECTED_KYC';
    else if (action === 'unrevoke') kycStatus = 'APPROVED_KYC';
    // request_info and field_review keep current kycStatus

    // When admins approve/flag driver documents in the vetting UI we store it in kycFieldApprovals.
    // The driver portal, however, renders statuses from UserDocument.status (PENDING/APPROVED/REJECTED).
    // Keep these in sync so the driver sees changes immediately.
    const syncDriverDocumentStatusesFromFieldApprovals = async (approvals: any) => {
      try {
        if (!approvals || typeof approvals !== 'object') return;
        const io = (req as any).app?.get?.('io');

        const docFieldToTypes: Record<string, string[]> = {
          drivingLicense: ['DRIVER_LICENSE', 'DRIVING_LICENSE', 'DRIVER_LICENCE', 'DRIVING_LICENCE', 'LICENSE'],
          nationalId: ['NATIONAL_ID', 'ID', 'PASSPORT'],
          latra: ['VEHICLE_REGISTRATION', 'LATRA', 'VEHICLE_REG'],
          insurance: ['INSURANCE'],
        };

        const normalize = (v: any) => String(v ?? '').toLowerCase();
        const desiredStatusFor = (v: any): 'PENDING' | 'APPROVED' | 'REJECTED' => {
          const nv = normalize(v);
          if (nv === 'approved') return 'APPROVED';
          if (nv === 'flagged') return 'REJECTED';
          return 'PENDING';
        };

        const updates: Promise<any>[] = [];
        for (const [fieldKey, types] of Object.entries(docFieldToTypes)) {
          if (!Object.prototype.hasOwnProperty.call(approvals, fieldKey)) continue;
          const desired = desiredStatusFor((approvals as any)[fieldKey]);
          const latest = await prisma.userDocument.findFirst({
            where: {
              userId: driverId,
              type: { in: types },
              url: { not: null },
            } as any,
            orderBy: { createdAt: 'desc' },
            select: { id: true, status: true },
          });
          if (!latest) continue;

          const current = String(latest.status ?? '').toUpperCase();
          if (current === desired) continue;

          updates.push(
            prisma.userDocument.update({
              where: { id: latest.id },
              data: {
                status: desired,
                reason: desired === 'REJECTED'
                  ? (typeof note === 'string' && note.trim() ? note.trim() : null)
                  : null,
              } as any,
            })
          );
        }
        if (updates.length > 0) {
          await Promise.all(updates);
          try {
            io?.to?.(`driver:${driverId}`)?.emit?.('driver:documents:updated', { driverId, at: new Date().toISOString() });
            io?.to?.(`user:${driverId}`)?.emit?.('driver:documents:updated', { driverId, at: new Date().toISOString() });
          } catch {
            // ignore socket errors
          }
        }
      } catch {
        // best-effort; do not block admin actions on doc sync
      }
    };

    if (action === 'field_review') {
      // Silent save: persist field approvals only, no notification to driver
      await prisma.user.update({
        where: { id: driverId },
        data: { kycFieldApprovals: sanitizedFieldApprovals } as any,
      });

      // Keep driver-facing document statuses in sync (realtime refresh)
      await syncDriverDocumentStatusesFromFieldApprovals(sanitizedFieldApprovals);
    } else if (action === 'request_info') {
      // Persist note + field approvals, then notify driver
      await prisma.user.update({
        where: { id: driverId },
        data: { kycNote: sanitizedNote || null, kycFieldApprovals: sanitizedFieldApprovals } as any,
      });

      // Keep driver-facing document statuses in sync (realtime refresh)
      await syncDriverDocumentStatusesFromFieldApprovals(sanitizedFieldApprovals);
    } else {
      // approve / reject / revoke / unrevoke — update status, clear note + field approvals
      const statusData: any = {
        kycStatus,
        kycNote: (action === 'reject' || action === 'revoke') ? (sanitizedReason || null) : null,
        kycFieldApprovals: null,
      };
      if (action === 'revoke') {
        statusData.suspendedAt = actionAt;
      }
      if (action === 'approve' || action === 'unrevoke') {
        statusData.suspendedAt = null;
      }
      await prisma.user.update({
        where: { id: driverId },
        data: statusData as any,
      });
    }

    // Write audit log entry — skip field_review (silent save, not a meaningful admin decision)
    if (action !== 'field_review') {
      try {
        await (prisma as any).kycAuditLog.create({
          data: {
            driverId,
            adminId,
            action,
            note: sanitizedNote || (sanitizedReason
              ? `${action === 'revoke'
                  ? 'Revocation reason'
                  : action === 'unrevoke'
                    ? 'Restoration reason'
                    : 'Rejection reason'}: ${sanitizedReason}`
              : null),
            fieldApprovals: sanitizedFieldApprovals,
          },
        });
      } catch (auditErr) {
        console.warn('KYC audit log write failed (non-fatal):', auditErr);
      }
    }

    // Emit real-time notification — only for actions that the driver needs to see
    if (action !== 'field_review') {
      try {
        const io = (req as any).app?.get?.('io');
        if (io) {
          const message =
            action === 'approve'
              ? 'Your driver application has been approved! You can now access your dashboard.'
              : action === 'unrevoke'
                ? `Your NoLSAF driver account suspension has been lifted. ${sanitizedReason ? `Reason: ${sanitizedReason}` : 'You can log in again and continue using your dashboard.'}`
              : action === 'revoke'
                ? `Your access to the NoLSAF driver portal has been revoked. ${sanitizedReason ? `Reason: ${sanitizedReason}` : 'Please contact support for more details.'}`
                : action === 'reject'
                  ? `Your driver application was not approved. ${sanitizedReason ? `Reason: ${sanitizedReason}` : 'Please contact support for more details.'}`
                  : `The admin needs more information to process your application. ${sanitizedNote ? `Message: ${sanitizedNote}` : 'Please update your profile with the required details.'}`;
          io.to(`user:${driverId}`).emit('kyc_status_update', { kycStatus, action, message });
        }
      } catch (e) { /* socket errors are non-fatal */ }
    }

    // Send SMS for request_info — build a clear template listing the flagged fields
    if (action === 'request_info') {
      try {
        const phone = (driver as any).phone as string | null | undefined;
        if (phone) {
          const fieldLabels: Record<string, string> = {
            name:          'Full Name',
            email:         'Email',
            phone:         'Phone Number',
            gender:        'Gender',
            region:        'Region',
            district:      'District',
            plateNumber:   'Plate Number',
            vehicleType:   'Vehicle Type',
            licenseNumber: 'License Number',
            operationArea: 'Operation Area',
            latra:         'LATRA Certificate',
            insurance:     'Insurance',
            nationalId:    'National ID',
            drivingLicense:'Driving Licence',
          };

          // Collect the flagged fields from fieldApprovals (value !== "approved")
          const flagged: string[] = fieldApprovals
            ? Object.entries(sanitizedFieldApprovals as Record<string, string>)
                .filter(([, v]) => v !== 'approved')
                .map(([k]) => fieldLabels[k] ?? k)
            : [];

          const fieldList = flagged.length > 0
            ? flagged.join(', ')
            : sanitizedNote || 'your profile information';

          const smsText =
            `Following our review of your driver application, please update the following: ${fieldList}. ` +
            `Open the NoLSAF app to make the required corrections. For help, contact support.`;

          await sendSms(phone, smsText);
        }
      } catch (smsErr: any) {
        console.warn('[KYC] SMS notification failed (non-fatal):', smsErr?.message ?? smsErr);
      }
    }

    // Send SMS + Email on approve
    if (action === 'approve') {
      const driverName  = (driver as any).name  as string | null ?? 'Driver';
      const driverEmail = (driver as any).email as string | null | undefined;
      const driverPhone = (driver as any).phone as string | null | undefined;
      const firstName   = driverName.split(' ')[0];
      const loginUrl    = `${process.env.APP_ORIGIN ?? 'https://app.nolsaf.com'}/login`;

      // ── SMS ──────────────────────────────────────────────────────────────────
      if (driverPhone) {
        try {
          const smsTxt = `Congratulations ${firstName}! Your driver account is approved. Log in now and start earning with Africa's leading travel & stays platform. Welcome aboard!`;
          await sendSms(driverPhone, smsTxt);
        } catch (smsErr: any) {
          console.warn('[KYC approve] SMS failed (non-fatal):', smsErr?.message ?? smsErr);
        }
      }

      // ── Email ─────────────────────────────────────────────────────────────────
      if (driverEmail) {
        try {
          const heroEmoji = '🎉';
          const heroSubTitle = 'You are officially a NoLSAF Driver';
          const opening = `After reviewing your application, we are delighted to confirm that your driver account has been <strong style="color:${BRAND_TEAL};">fully approved and activated</strong>. Your profile is live, your documents are verified, and you are ready to roll.`;
          const statusLabel = '✅ Approved — Account Active';
          const ctaLabel = 'Log In & Start Driving';
          const stepsHtml = `<ol style="margin:8px 0 0;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">
                <li><strong>Log in</strong> using the email and password you registered with.</li>
                <li><strong>Complete your driver profile</strong> — add your photo and preferred zones.</li>
                <li><strong>Go online</strong> and start accepting your first trips!</li>
              </ol>`;
          const html = baseEmail(
            BRAND_TEAL,
            BRAND_DARK,
            'Application Approved',
            heroEmoji,
            `
            <!-- ── Hero greeting ────────────────────────────────────────── -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
              style="background:linear-gradient(135deg,${BRAND_TEAL}12 0%,#e6faf8 100%);border:1px solid ${BRAND_TEAL}22;border-radius:12px;margin:0 0 28px;">
              <tr><td style="padding:28px 28px 24px;text-align:center;">
                <div style="font-size:48px;line-height:1;margin-bottom:12px;">${heroEmoji}</div>
                <h1 style="margin:0 0 8px;font-size:26px;font-weight:800;color:#0d2623;letter-spacing:-0.3px;">
                  Congratulations, ${firstName}!
                </h1>
                <p style="margin:0;font-size:16px;color:${BRAND_TEAL};font-weight:600;letter-spacing:0.2px;">
                  ${heroSubTitle}
                </p>
              </td></tr>
            </table>

            <!-- ── Opening ──────────────────────────────────────────────── -->
            <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.75;">
              ${opening}
            </p>

            <!-- ── Account details card ──────────────────────────────────── -->
            ${infoCard(BRAND_TEAL, [
              ['Status',    statusLabel],
              ['Login Email', driverEmail],
              ['Platform',  'NoLSAF Driver App'],
              ['Effective', new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })],
            ])}

            <!-- ── What's next callout ───────────────────────────────────── -->
            ${calloutBox(BRAND_TEAL, '🚀', 'Get Started in 3 Simple Steps',
              stepsHtml
            )}

            <!-- ── CTA ───────────────────────────────────────────────────── -->
            ${ctaButton(loginUrl, ctaLabel, BRAND_TEAL)}

            <!-- ── Mission paragraph ─────────────────────────────────────── -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
              style="background:#fafffe;border:1px solid ${BRAND_TEAL}18;border-radius:10px;margin:8px 0 24px;">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:${BRAND_TEAL};text-transform:uppercase;letter-spacing:1.2px;">
                  You are part of something bigger
                </p>
                <p style="margin:0 0 12px;font-size:14px;color:#374151;line-height:1.75;">
                  At NoLSAF, we are building Tanzania's first truly modernised transport and
                  logistics platform; one that puts <strong>drivers, customers, and communities
                  first</strong>. No hidden fees. No surprises. Just fair, transparent, and
                  reliable service that earns trust every kilometre.
                </p>
                <p style="margin:0;font-size:14px;color:#374151;line-height:1.75;">
                  You are not just a driver. You are a <strong style="color:${BRAND_TEAL};">founding partner</strong>
                  in this journey. Every trip you complete helps write a new chapter for tourism, travel, and economic opportunity
                  in Tanzania; and we are incredibly proud to have you with us.
                </p>
              </td></tr>
            </table>

            <!-- ── Sign-off ──────────────────────────────────────────────── -->
            <p style="margin:0 0 4px;font-size:15px;color:#374151;line-height:1.7;">
              Welcome aboard, <strong>${firstName}</strong>. Let's build something great together. 🌍
            </p>
            <p style="margin:16px 0 0;font-size:14px;color:${BRAND_TEAL};font-weight:700;">
              The NoLSAF Team
            </p>
            <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;">
              Dar es Salaam, Tanzania &bull; <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;">support@nolsaf.com</a>
            </p>
            `
          );

          await sendMail(
            driverEmail,
            `🎉 Congratulations ${firstName} — Your NoLSAF Driver Account is Approved!`,
            html,
          );
        } catch (emailErr: any) {
          console.warn('[KYC approve] Email failed (non-fatal):', emailErr?.message ?? emailErr);
        }
      }
    }

    // Send SMS + Email on reject
    if (action === 'reject') {
      const driverName  = (driver as any).name  as string | null ?? 'Driver';
      const driverEmail = (driver as any).email as string | null | undefined;
      const driverPhone = (driver as any).phone as string | null | undefined;
      const firstName   = driverName.split(' ')[0];
      const rejectReason = sanitizedReason;

      if (driverPhone) {
        try {
          const smsTxt = `Hello ${firstName}, your driver application was not approved.${rejectReason ? ` Reason: ${rejectReason}.` : ''} Review the feedback in your account or contact support@nolsaf.com for guidance.`;
          await sendSms(driverPhone, smsTxt);
        } catch (smsErr: any) {
          console.warn('[KYC reject] SMS failed (non-fatal):', smsErr?.message ?? smsErr);
        }
      }

      if (driverEmail) {
        try {
          const REJECT_RED = '#dc2626';
          const html = baseEmail(
            REJECT_RED,
            BRAND_DARK,
            'Driver Application Not Approved',
            '📄',
            `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
              style="background:#fff5f5;border:1px solid #fecaca;border-radius:12px;margin:0 0 28px;">
              <tr><td style="padding:28px 28px 24px;text-align:center;">
                <div style="font-size:48px;line-height:1;margin-bottom:12px;">📄</div>
                <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#7f1d1d;letter-spacing:-0.3px;">
                  Application Not Approved
                </h1>
                <p style="margin:0;font-size:15px;color:${REJECT_RED};font-weight:600;">
                  Your NoLSAF driver application requires correction before it can be accepted
                </p>
              </td></tr>
            </table>

            <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.75;">
              Dear <strong>${firstName}</strong>,
            </p>
            <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.75;">
              We reviewed your driver application and it was <strong style="color:${REJECT_RED};">not approved</strong> at this time.
              This is not a suspension of an active driver account. It means your onboarding application still needs correction or clarification.
            </p>

            ${infoCard(REJECT_RED, [
              ['Applicant', driverName],
              ['Email', driverEmail],
              ['Status', '❌ Application Not Approved'],
              ['Reason', rejectReason || 'Not specified'],
              ['Reviewed', actionAt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })],
            ])}

            ${calloutBox(REJECT_RED, '🛠️', 'What happens next',
              `<ol style="margin:8px 0 0;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">
                <li>Review the reason above carefully and correct the affected information or documents.</li>
                <li>Contact <a href="mailto:support@nolsaf.com" style="color:${REJECT_RED};text-decoration:none;">support@nolsaf.com</a> if you need clarification.</li>
                <li>Resubmit once your documents and details are complete and accurate.</li>
              </ol>`
            )}

            <p style="margin:24px 0 4px;font-size:14px;color:#374151;line-height:1.7;">
              The NoLSAF Team
            </p>
            <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;">
              Dar es Salaam, Tanzania &bull; <a href="mailto:support@nolsaf.com" style="color:${REJECT_RED};text-decoration:none;">support@nolsaf.com</a>
            </p>
            `
          );

          await sendMail(
            driverEmail,
            `Update Needed: Your NoLSAF Driver Application Was Not Approved`,
            html,
          );
        } catch (emailErr: any) {
          console.warn('[KYC reject] Email failed (non-fatal):', emailErr?.message ?? emailErr);
        }
      }
    }

    // Send SMS + Email on revoke
    if (action === 'revoke') {
      const driverName  = (driver as any).name  as string | null ?? 'Driver';
      const driverEmail = (driver as any).email as string | null | undefined;
      const driverPhone = (driver as any).phone as string | null | undefined;
      const firstName   = driverName.split(' ')[0];
      const revokedAt = actionAt;
      const caseRef = buildDriverCaseRef(driverId, revokedAt) ?? `NOLS-DRV-${String(driverId).padStart(5, '0')}-REVOKED`;

      // ── SMS ──────────────────────────────────────────────────────────────────
      if (driverPhone) {
        try {
          const smsTxt =
            `Your driver account access has been revoked. Ref: ${caseRef}. ${sanitizedReason ? `Reason: ${sanitizedReason}. ` : ''}For assistance contact support@nolsaf.com.`;
          await sendSms(driverPhone, smsTxt, { bypassEligibilityCheck: true });
        } catch (smsErr: any) {
          console.warn('[KYC revoke] SMS failed (non-fatal):', smsErr?.message ?? smsErr);
        }
      }

      // ── Email ─────────────────────────────────────────────────────────────────
      if (driverEmail) {
        try {
          const REVOKE_RED = '#dc2626';
          const html = baseEmail(
            REVOKE_RED,
            BRAND_DARK,
            'Driver Access Revoked',
            '🔒',
            `
            <!-- ── Hero ───────────────────────────────────────────────────── -->
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
              style="background:#fff5f5;border:1px solid #fecaca;border-radius:12px;margin:0 0 28px;">
              <tr><td style="padding:28px 28px 24px;text-align:center;">
                <div style="font-size:48px;line-height:1;margin-bottom:12px;">🔒</div>
                <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#7f1d1d;letter-spacing:-0.3px;">
                  Driver Access Revoked
                </h1>
                <p style="margin:0;font-size:15px;color:${REVOKE_RED};font-weight:600;">
                  Your NoLSAF driver portal access has been removed
                </p>
              </td></tr>
            </table>

            <!-- ── Body ───────────────────────────────────────────────────── -->
            <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.75;">
              Dear <strong>${firstName}</strong>,
            </p>
            <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.75;">
              We are writing to inform you that your access to the NoLSAF driver portal has been
              <strong style="color:${REVOKE_RED};">revoked</strong> by an administrator.
              Your account is no longer active and you will not be able to log in to the driver app.
            </p>
            <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.75;">
              In line with NoLSAF policy, any <strong>active and unpaid payout</strong> already due to you at the time of revocation
              will still be reviewed and processed through our payout procedure.
            </p>

            ${infoCard(REVOKE_RED, [
              ['Driver',      driverName],
              ['Email',       driverEmail],
              ['Reference Number', caseRef],
              ['Status',      '❌ Access Revoked'],
              ['Reason',      sanitizedReason || 'Not specified'],
              ['Effective',   new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })],
            ])}

            <!-- ── Next steps ───────────────────────────────────────────── -->
            ${calloutBox(REVOKE_RED, '📞', 'What to do next',
              `<p style="margin:0 0 10px;font-size:14px;color:#374151;line-height:1.75;">
                If you believe this action was taken in error or you would like to appeal,
                please contact our support team as soon as possible and include your reference number <strong>${caseRef}</strong>:
              </p>
              <ul style="margin:0;padding-left:20px;font-size:14px;color:#374151;line-height:1.8;">
                <li>Email: <a href="mailto:support@nolsaf.com" style="color:${REVOKE_RED};text-decoration:none;">support@nolsaf.com</a></li>
                <li>Include your registered email address, the reference number, and a description of your situation.</li>
              </ul>`
            )}

            <!-- ── Sign-off ──────────────────────────────────────────────── -->
            <p style="margin:24px 0 4px;font-size:14px;color:#374151;line-height:1.7;">
              The NoLSAF Team
            </p>
            <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;">
              Dar es Salaam, Tanzania &bull; <a href="mailto:support@nolsaf.com" style="color:${REVOKE_RED};text-decoration:none;">support@nolsaf.com</a>
            </p>
            `
          );

          await sendMail(
            driverEmail,
            `Important Notice: Your NoLSAF Driver Access Has Been Revoked`,
            html,
            undefined,
            { bypassEligibilityCheck: true },
          );
        } catch (emailErr: any) {
          console.warn('[KYC revoke] Email failed (non-fatal):', emailErr?.message ?? emailErr);
        }
      }
    }

    // Send SMS + Email on unrevoke
    if (action === 'unrevoke') {
      const driverName  = (driver as any).name  as string | null ?? 'Driver';
      const driverEmail = (driver as any).email as string | null | undefined;
      const driverPhone = (driver as any).phone as string | null | undefined;
      const firstName   = driverName.split(' ')[0];
      const restoreReason = sanitizedReason;
      const loginUrl    = `${process.env.APP_ORIGIN ?? 'https://app.nolsaf.com'}/login`;

      if (driverPhone) {
        try {
          const smsTxt = `Hello ${firstName}, your driver account suspension has been lifted.${restoreReason ? ` Reason: ${restoreReason}.` : ''} You can now log in again and continue using your NoLSAF driver account.`;
          await sendSms(driverPhone, smsTxt);
        } catch (smsErr: any) {
          console.warn('[KYC unrevoke] SMS failed (non-fatal):', smsErr?.message ?? smsErr);
        }
      }

      if (driverEmail) {
        try {
          const RESTORE_TEAL = '#0f766e';
          const html = baseEmail(
            RESTORE_TEAL,
            BRAND_DARK,
            'Driver Suspension Lifted',
            '🔓',
            `
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
              style="background:linear-gradient(135deg,${RESTORE_TEAL}12 0%,#e6faf8 100%);border:1px solid ${RESTORE_TEAL}22;border-radius:12px;margin:0 0 28px;">
              <tr><td style="padding:28px 28px 24px;text-align:center;">
                <div style="font-size:48px;line-height:1;margin-bottom:12px;">🔓</div>
                <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#0d2623;letter-spacing:-0.3px;">
                  Suspension Lifted
                </h1>
                <p style="margin:0;font-size:15px;color:${RESTORE_TEAL};font-weight:600;">
                  Your NoLSAF driver account is active again
                </p>
              </td></tr>
            </table>

            <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.75;">
              Dear <strong>${firstName}</strong>,
            </p>
            <p style="margin:0 0 18px;font-size:15px;color:#374151;line-height:1.75;">
              Your driver account suspension has been <strong style="color:${RESTORE_TEAL};">lifted</strong> by the NoLSAF admin team.
              You may now sign in again and continue using your driver dashboard.
            </p>

            ${infoCard(RESTORE_TEAL, [
              ['Driver', driverName],
              ['Email', driverEmail],
              ['Status', '✅ Suspension Lifted — Account Active'],
              ['Restoration reason', restoreReason || 'Administrative review completed'],
              ['Effective', actionAt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })],
            ])}

            ${calloutBox(RESTORE_TEAL, '🚀', 'What to do next',
              `<ol style="margin:8px 0 0;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">
                <li><strong>Log in again</strong> using your registered email and password.</li>
                <li><strong>Review any pending trips, payouts, or notices</strong> in your dashboard.</li>
                <li><strong>Continue operating</strong> in line with NoLSAF driver policies.</li>
              </ol>`
            )}

            ${ctaButton(loginUrl, 'Log In Again', RESTORE_TEAL)}

            <p style="margin:24px 0 4px;font-size:14px;color:#374151;line-height:1.7;">
              The NoLSAF Team
            </p>
            <p style="margin:2px 0 0;font-size:12px;color:#9ca3af;">
              Dar es Salaam, Tanzania &bull; <a href="mailto:support@nolsaf.com" style="color:${RESTORE_TEAL};text-decoration:none;">support@nolsaf.com</a>
            </p>
            `
          );

          await sendMail(
            driverEmail,
            `🔓 ${firstName}, your NoLSAF driver suspension has been lifted`,
            html,
          );
        } catch (emailErr: any) {
          console.warn('[KYC unrevoke] Email failed (non-fatal):', emailErr?.message ?? emailErr);
        }
      }
    }

    return res.json({
      ok: true,
      driverId,
      kycStatus,
      action,
      suspendedAt: action === 'revoke' ? actionAt.toISOString() : null,
      isRevoked: action === 'revoke',
      revocationCaseRef: action === 'revoke' ? (buildDriverCaseRef(driverId, actionAt) ?? null) : null,
      wasSuspended,
    });
  } catch (err: any) {
    console.error('PATCH /admin/drivers/:id/kyc error:', err);
    return res.status(500).json({ error: 'internal_error', message: err?.message });
  }
});

/** GET /admin/drivers/:id/kyc-audit — return audit history for a driver */
router.get('/:id(\\d+)/kyc-audit', async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    let logs: any[] = [];
    try {
      logs = await (prisma as any).kycAuditLog.findMany({
        where: { driverId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          action: true,
          note: true,
          fieldApprovals: true,
          createdAt: true,
          adminId: true,
        },
      });
    } catch (innerErr: any) {
      // P2021 = table does not exist (migration not yet applied on this DB)
      if (innerErr?.code === 'P2021' || innerErr?.message?.includes('kyc_audit_log')) {
        return res.json({ ok: true, logs: [] });
      }
      throw innerErr;
    }

    // Enrich with admin names
    const adminIds = [...new Set((logs as any[]).map((l: any) => l.adminId).filter(Boolean))] as number[];
    let adminMap: Record<number, string> = {};
    if (adminIds.length > 0) {
      const admins = await prisma.user.findMany({
        where: { id: { in: adminIds } },
        select: { id: true, name: true, email: true },
      });
      adminMap = Object.fromEntries(admins.map((a: any) => [a.id, a.name ?? a.email ?? `Admin #${a.id}`]));
    }
    const enrichedLogs = (logs as any[]).map((l: any) => ({
      ...l,
      adminName: l.adminId ? (adminMap[l.adminId] ?? `Admin #${l.adminId}`) : null,
    }));

    return res.json({ ok: true, logs: enrichedLogs });
  } catch (err: any) {
    console.error('GET /admin/drivers/:id/kyc-audit error:', err);
    return res.status(500).json({ error: 'internal_error', message: err?.message });
  }
});

/**
 * POST /admin/drivers/:id/upload-doc
 * Admin uploads a document for a driver (e.g. insurance certificate).
 * Body JSON: { docType: 'INSURANCE' | 'LATRA' | ..., docUrl: string }
 * The frontend uploads the file to Cloudinary first (via /api/uploads/cloudinary/sign),
 * then sends the resulting URL to this endpoint.
 */
router.post('/:id(\\d+)/upload-doc', async (req, res) => {
  try {
    const driverId = Number(req.params.id);
    if (!Number.isFinite(driverId)) return res.status(400).json({ error: 'invalid_driver_id' });

    const { docType, docUrl } = req.body ?? {};
    if (!docType || typeof docType !== 'string') return res.status(400).json({ error: 'docType is required' });
    if (!docUrl || typeof docUrl !== 'string') return res.status(400).json({ error: 'docUrl is required' });

    const allowedTypes = ['INSURANCE', 'LATRA', 'DRIVER_LICENSE', 'NATIONAL_ID'];
    const normalizedType = String(docType).toUpperCase();
    if (!allowedTypes.includes(normalizedType)) {
      return res.status(400).json({ error: 'invalid_doc_type', allowed: allowedTypes });
    }
    if (!isTrustedUserDocumentUrl(docUrl, 'DRIVER')) {
      return res.status(400).json({ error: 'invalid_doc_url', message: 'Document URL must point to approved NoLSAF-managed storage.' });
    }

    const driver = await prisma.user.findFirst({ where: { id: driverId, role: 'DRIVER' } as any });
    if (!driver) return res.status(404).json({ error: 'Driver not found' });

    // Upsert UserDocument record
    if ((prisma as any).userDocument) {
      const existing = await prisma.userDocument.findFirst({
        where: { userId: driverId, type: normalizedType },
        orderBy: { id: 'desc' },
      });
      if (existing) {
        await prisma.userDocument.update({
          where: { id: existing.id },
          data: { url: docUrl, status: 'PENDING', metadata: { uploadedByAdmin: true, uploadedAt: new Date().toISOString() } } as any,
        });
      } else {
        await prisma.userDocument.create({
          data: {
            userId: driverId,
            type: normalizedType,
            url: docUrl,
            status: 'PENDING',
            metadata: { uploadedByAdmin: true, uploadedAt: new Date().toISOString() },
          } as any,
        });
      }
    }

    // Also persist to payout JSON for quick access on vetting page
    try {
      const currentPayout = (driver as any).payout;
      const payoutObj: any = (typeof currentPayout === 'object' && currentPayout !== null) ? { ...currentPayout } : {};
      const urlKey =
        normalizedType === 'INSURANCE' ? 'insuranceUrl' :
        normalizedType === 'LATRA' ? 'latraUrl' :
        normalizedType === 'DRIVER_LICENSE' ? 'drivingLicenseUrl' :
        normalizedType === 'NATIONAL_ID' ? 'nationalIdUrl' : null;
      if (urlKey) {
        payoutObj[urlKey] = docUrl;
        await prisma.user.update({ where: { id: driverId }, data: { payout: payoutObj } as any });
      }
    } catch (e) { /* ignore payout update errors */ }

    return res.json({ ok: true, driverId, docType: normalizedType, docUrl });
  } catch (err: any) {
    console.error('POST /admin/drivers/:id/upload-doc error:', err);
    return res.status(500).json({ error: 'internal_error', message: err?.message });
  }
});

export default router;

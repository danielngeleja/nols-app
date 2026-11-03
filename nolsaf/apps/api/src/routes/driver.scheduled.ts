import { Router, type Response } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { z } from "zod";
import { limitDriverTripAction, limitDriverTripClaim, limitDriverTripsList } from "../middleware/rateLimit.js";
import { AUTO_DISPATCH_GRACE_MS, AUTO_DISPATCH_LOOKAHEAD_MS } from "../lib/transportPolicy.js";
import { sendSms } from "../lib/sms.js";
import { notifyAdmins } from "../lib/notifications.js";

export const router = Router();

const MAX_CLAIMS_PER_BOOKING = 5;
const CLAIM_WINDOW_HOURS = 72;

// All routes require driver authentication
router.use(requireAuth as RequestHandler);
router.use(requireRole("DRIVER") as RequestHandler);

type TransportTripStage =
  | "accepted"
  | "arrived_at_pickup"
  | "passenger_picked_up"
  | "in_transit"
  | "arrived_at_destination"
  | "completed";

const transportTripStageSchema = z
  .object({
    stage: z.enum([
      "accepted",
      "pickup",
      "arrived_at_pickup",
      "picked_up",
      "passenger_picked_up",
      "in_transit",
      "arrived",
      "arrived_at_destination",
      "dropoff",
      "completed",
    ]),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracyM: z.number().min(0).max(10_000).optional(),
    route: z
      .object({
        type: z.enum(["pickup", "destination"]).optional(),
        distanceMeters: z.number().min(0).optional(),
        durationSec: z.number().min(0).optional(),
        provider: z.string().max(40).optional(),
      })
      .passthrough()
      .optional(),
    clientEventId: z.string().trim().max(120).optional(),
  })
  .strict();

function normalizeTransportTripStage(stage: string): TransportTripStage {
  if (stage === "pickup") return "arrived_at_pickup";
  if (stage === "picked_up") return "passenger_picked_up";
  if (stage === "arrived" || stage === "dropoff") return "arrived_at_destination";
  return stage as TransportTripStage;
}

function stageToBookingStatus(stage: TransportTripStage): "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" {
  if (stage === "completed") return "COMPLETED";
  if (stage === "passenger_picked_up" || stage === "in_transit" || stage === "arrived_at_destination") return "IN_PROGRESS";
  return "CONFIRMED";
}

function requestIp(req: any): string | null {
  return String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim() || req.socket?.remoteAddress || null;
}

function emitTransportTripEvent(req: any, booking: { id: number; userId: number; driverId?: number | null }, event: string, payload: any) {
  try {
    const io = (req.app && (req.app as any).get && (req.app as any).get("io")) || (global as any).io;
    if (!io || typeof io.to !== "function") return;
    const enriched = { transportBookingId: booking.id, ...payload };
    io.to("admin").emit(event, enriched);
    io.to(`transport:${booking.id}`).emit(event, enriched);
    io.to(`user:${booking.userId}`).emit(event, enriched);
    if (booking.driverId) io.to(`driver:${booking.driverId}`).emit(event, enriched);
  } catch {
    // realtime is best-effort
  }
}

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

const paginationSchema = z.object({
  page: z.preprocess(
    (v) => firstQueryValue(v),
    z.coerce.number().int().min(1).default(1)
  ),
  pageSize: z.preprocess(
    (v) => firstQueryValue(v),
    z.coerce.number().int().min(1).max(50).default(20)
  ),
});

const scheduledQuerySchema = paginationSchema.extend({
  vehicleType: z
    .preprocess((v) => firstQueryValue(v), z.string().trim().min(1).max(50))
    .optional(),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

function badRequest(res: Response, message: string, issues?: unknown) {
  return res.status(400).json({ error: message, issues });
}

function normalizeDriverVehicleType(vehicleType?: string): "BODA" | "BAJAJI" | "CAR" | "XL" | null {
  if (!vehicleType) return null;
  const v = vehicleType.toLowerCase();
  if (v.includes("motor") || v.includes("boda") || v.includes("bike")) return "BODA";
  if (v.includes("tuktuk") || v.includes("bajaji") || v.includes("tuk") || v.includes("auto")) return "BAJAJI";
  if (v.includes("xl") || v.includes("van") || v.includes("hiace") || v.includes("coaster") || v.includes("minibus")) return "XL";
  if (v.includes("car") || v.includes("sedan") || v.includes("suv")) return "CAR";
  return null;
}

function normalizeAreaName(v?: string | null): string {
  return String(v ?? "").trim().toLowerCase();
}

function parseOperationAreas(v?: string | null): string[] {
  const raw = String(v ?? "").trim();
  if (!raw) return [];
  return raw
    .split(/[;,|]/g)
    .map((x) => normalizeAreaName(x))
    .filter(Boolean);
}

function getAllowedAreasForDriver(driver: any): string[] {
  const areas = new Set<string>();
  const region = normalizeAreaName(driver?.region);
  if (region) areas.add(region);
  for (const a of parseOperationAreas(driver?.operationArea)) areas.add(a);
  return Array.from(areas);
}

function isTripWithinAreas(trip: any, allowedAreas: string[]): boolean {
  if (!allowedAreas.length) return false;
  const tripAreas = [trip?.fromRegion, trip?.toRegion, trip?.property?.regionName]
    .map((x) => normalizeAreaName(x))
    .filter(Boolean);
  return tripAreas.some((a) => allowedAreas.includes(a));
}

function getAreaIneligibilityReason(driver: any, trip: any): string | null {
  const allowedAreas = getAllowedAreasForDriver(driver);
  if (!allowedAreas.length) return "Set your region/operation area in your profile to bid on trips";
  if (!isTripWithinAreas(trip, allowedAreas)) {
    const driverAreaLabel = String(driver?.region || driver?.operationArea || "").trim();
    const tripAreaLabel = String(trip?.fromRegion || trip?.toRegion || trip?.property?.regionName || "").trim();
    return `This trip is outside your area of operation${tripAreaLabel ? ` (${tripAreaLabel})` : ""}${driverAreaLabel ? `. Your area: ${driverAreaLabel}` : ""}`;
  }
  return null;
}

function getClaimOpensAt(pickupAt: Date): Date {
  return new Date(pickupAt.getTime() - CLAIM_WINDOW_HOURS * 60 * 60 * 1000);
}

function getAutoDispatchEndsAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + AUTO_DISPATCH_GRACE_MS);
}

function getClaimReasonForDriver({
  bookingVehicleType,
  driverNormalizedVehicleType,
  isVipDriver,
}: {
  bookingVehicleType?: string | null;
  driverNormalizedVehicleType: "BODA" | "BAJAJI" | "CAR" | "XL" | null;
  isVipDriver: boolean;
}): string | null {
  if (!bookingVehicleType) return null;
  if (bookingVehicleType === "PREMIUM") {
    return isVipDriver ? null : "VIP drivers only";
  }
  if (bookingVehicleType === "BODA" || bookingVehicleType === "BAJAJI" || bookingVehicleType === "CAR" || bookingVehicleType === "XL") {
    if (!driverNormalizedVehicleType) return `Your profile vehicle type isn't set`;
    if (driverNormalizedVehicleType !== bookingVehicleType) return `This trip requires ${bookingVehicleType}`;
  }
  return null;
}

/**
 * GET /api/driver/trips
 * The driver "Trips" table: rides that need attention now or already happened
 * (future, not-yet-started rides live under /scheduled instead).
 * Query: ?date=YYYY-MM-DD&start=YYYY-MM-DD&end=YYYY-MM-DD&page=&pageSize=
 */
router.get("/", limitDriverTripsList, (async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const page = Math.max(1, Number((req.query as any).page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number((req.query as any).pageSize ?? 100)));
  const skip = (page - 1) * pageSize;

  try {
    const now = new Date();
    const where: any = { driverId: user.id };

    // Trips = needs attention now OR already happened. Scheduled = future rides not started yet.
    where.OR = [
      { scheduledDate: { lte: now } },
      { status: { in: ["CONFIRMED", "IN_PROGRESS"] } },
    ];

    const date = (req.query.date as string) || undefined;
    const start = (req.query.start as string) || undefined;
    const end = (req.query.end as string) || undefined;
    try {
      if (date) {
        const s = new Date(date + "T00:00:00.000Z");
        const e = new Date(date + "T23:59:59.999Z");
        where.OR = undefined;
        where.scheduledDate = { gte: s, lte: e };
      } else if (start || end) {
        const s = start ? new Date(start + "T00:00:00.000Z") : new Date(0);
        const e = end ? new Date(end + "T23:59:59.999Z") : new Date();
        where.OR = undefined;
        where.scheduledDate = { gte: s, lte: e };
      }
    } catch {
      // ignore date parsing errors
    }

    const [items, total] = await Promise.all([
      prisma.transportBooking.findMany({ where, orderBy: { scheduledDate: "desc" }, skip, take: pageSize }),
      prisma.transportBooking.count({ where }),
    ]);

    const ids = items.map((b) => Number(b.id)).filter((id) => Number.isFinite(id) && id > 0);

    // Classify each trip's assignment source (admin vs auto/driver) from audit history.
    const assignmentSourceByBookingId = new Map<number, "ADMIN" | "AUTO">();
    try {
      if (ids.length > 0 && (prisma as any).auditLog) {
        const audits = await (prisma as any).auditLog.findMany({
          where: {
            entity: "TRANSPORT_BOOKING",
            entityId: { in: ids },
            action: { in: ["TRANSPORT_ADMIN_ASSIGN_DRIVER", "TRANSPORT_ASSIGN_DRIVER"] },
          },
          orderBy: { createdAt: "desc" },
          take: Math.min(1000, ids.length * 5),
        });
        for (const a of audits || []) {
          const entityId = Number((a as any)?.entityId);
          if (!Number.isFinite(entityId) || entityId <= 0) continue;
          if (assignmentSourceByBookingId.has(entityId)) continue;
          const action = String((a as any)?.action ?? "");
          const actorRole = String((a as any)?.actorRole ?? "").toUpperCase();
          if (action === "TRANSPORT_ADMIN_ASSIGN_DRIVER") {
            assignmentSourceByBookingId.set(entityId, "ADMIN");
            continue;
          }
          if (action === "TRANSPORT_ASSIGN_DRIVER") {
            assignmentSourceByBookingId.set(entityId, actorRole === "ADMIN" ? "ADMIN" : "AUTO");
            continue;
          }
        }
      }
    } catch {
      // ignore if AuditLog model/fields differ
    }

    const mapped = items.map((b: any) => ({
      id: b.id,
      date: b.pickupTime ?? b.scheduledDate ?? b.createdAt,
      scheduledDate: b.scheduledDate ? new Date(b.scheduledDate).toISOString() : null,
      pickupTime: b.pickupTime ? new Date(b.pickupTime).toISOString() : null,
      dropoffTime: b.dropoffTime ? new Date(b.dropoffTime).toISOString() : null,
      pickup: b.fromAddress || b.pickupLocation || b.fromRegion || null,
      dropoff: b.toAddress || b.toRegion || null,
      tripCode: b.tripCode || null,
      amount: b.amount ?? null,
      currency: b.currency ?? "TZS",
      status: b.status || null,
      assignmentSource: assignmentSourceByBookingId.get(Number(b.id)) ?? "AUTO",
    }));

    return res.json({ total, page, pageSize, trips: mapped });
  } catch (err) {
    console.warn("driver.trips: failed", String(err));
    return res.status(500).json({ error: "failed" });
  }
}) as RequestHandler);

/** Recover live offers after a socket disconnect or app restart. */
router.get("/offers", limitDriverTripsList, (async (req: AuthedRequest, res: Response) => {
  try {
    const offers = await prisma.transportBookingOffer.findMany({
      where: {
        driverId: req.user!.id,
        status: "OFFERED",
        expiresAt: { gt: new Date() },
        booking: { is: { driverId: null, paymentStatus: "PAID", status: { in: ["PENDING_ASSIGNMENT", "PENDING"] } } },
      },
      select: {
        bookingId: true,
        expiresAt: true,
        radiusKm: true,
        booking: {
          select: {
            tripCode: true,
            vehicleType: true,
            scheduledDate: true,
            fromAddress: true,
            toAddress: true,
            fromLatitude: true,
            fromLongitude: true,
            toLatitude: true,
            toLongitude: true,
            amount: true,
            currency: true,
          },
        },
      },
      orderBy: { expiresAt: "asc" },
      take: 10,
    });

    return res.json({
      offers: offers.map(({ booking, ...offer }) => ({
        bookingId: offer.bookingId,
        tripCode: booking.tripCode,
        vehicleType: booking.vehicleType,
        scheduledDate: booking.scheduledDate?.toISOString() ?? null,
        fromAddress: booking.fromAddress,
        toAddress: booking.toAddress,
        fromLatitude: booking.fromLatitude == null ? null : Number(booking.fromLatitude),
        fromLongitude: booking.fromLongitude == null ? null : Number(booking.fromLongitude),
        toLatitude: booking.toLatitude == null ? null : Number(booking.toLatitude),
        toLongitude: booking.toLongitude == null ? null : Number(booking.toLongitude),
        amount: booking.amount == null ? null : Number(booking.amount),
        currency: booking.currency ?? "TZS",
        offer: { expiresAt: offer.expiresAt.toISOString(), radiusKm: offer.radiusKm == null ? undefined : Number(offer.radiusKm) },
      })),
    });
  } catch (error) {
    console.error("GET /driver/trips/offers error:", error);
    return res.status(500).json({ error: "Failed to fetch trip offers" });
  }
}) as RequestHandler);

/**
 * GET /api/driver/trips/scheduled
 * Get scheduled trips available for driver to claim
 * Query: ?vehicleType=BODA&page=1&pageSize=20
 */
router.get("/scheduled", limitDriverTripsList, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const parsed = scheduledQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return badRequest(res, "Invalid query parameters", parsed.error.flatten());
    }
    const { vehicleType, page: pageNum, pageSize: pageSizeNum } = parsed.data;
    const skip = (pageNum - 1) * pageSizeNum;

    const now = new Date();
    const autoDispatchGraceCutoff = new Date(now.getTime() - AUTO_DISPATCH_GRACE_MS);
    const autoDispatchLookaheadCutoff = new Date(now.getTime() + AUTO_DISPATCH_LOOKAHEAD_MS);

    const driver = await prisma.user.findUnique({
      where: { id: user.id },
      select: { vehicleType: true, isVipDriver: true, region: true, operationArea: true } as any,
    });
    const driverNormalizedVehicleType = normalizeDriverVehicleType((driver as any)?.vehicleType || undefined);
    const isVipDriver = Boolean((driver as any)?.isVipDriver);
    const allowedAreas = getAllowedAreasForDriver(driver);

    // Get driver's vehicle type preference (if stored in user profile)
    // For now, we'll filter by vehicleType query param if provided

    const where: any = {
      // Only claimable pool; admin takeover (manual assignment) is excluded.
      status: "PENDING_ASSIGNMENT",
      driverId: null, // Not yet assigned
      paymentStatus: "PAID", // Only show paid trips
      scheduledDate: {
        gte: now, // Only future trips
      },
    };

    // For near-term trips (happening soon), the system attempts auto-dispatch first.
    // Only expose to claim workflow after the grace window expires.
    where.AND = where.AND || [];
    where.AND.push({
      OR: [
        // Far future trips are always eligible to show (claim window still applies).
        { scheduledDate: { gte: autoDispatchLookaheadCutoff } },
        // Near-term trips only show after auto-dispatch grace ends.
        { createdAt: { lte: autoDispatchGraceCutoff } },
      ],
    });

    // Area-of-operation restriction: drivers only see trips in their region/operationArea.
    if (allowedAreas.length) {
      const inAreas = { in: allowedAreas };
      where.AND.push({ OR: [{ fromRegion: inAreas }, { toRegion: inAreas }, { property: { regionName: inAreas } }] });
    } else {
      // No operation area configured -> show nothing (and canClaim will be false with reason).
      where.id = -1;
    }

    if (vehicleType) where.vehicleType = vehicleType;

    const [trips, total] = await Promise.all([
      prisma.transportBooking.findMany({
        where,
        include: {
          _count: { select: { claims: true } },
          claims: {
            where: { driverId: user.id },
            select: { id: true, status: true } as any,
            take: 1,
          } as any,
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
          property: {
            select: {
              id: true,
              title: true,
              regionName: true,
              district: true,
              ward: true,
            },
          },
        },
        orderBy: { scheduledDate: "asc" },
        skip,
        take: pageSizeNum,
      }),
      prisma.transportBooking.count({ where }),
    ]);

    res.json({
      items: trips.map((trip) => ({
        claimCount: (trip as any)._count?.claims ?? 0,
        claimsRemaining: Math.max(0, MAX_CLAIMS_PER_BOOKING - ((trip as any)._count?.claims ?? 0)),
        claimLimit: MAX_CLAIMS_PER_BOOKING,
        claimWindowHours: CLAIM_WINDOW_HOURS,
        claimOpensAt: getClaimOpensAt(new Date(trip.pickupTime || trip.scheduledDate)).toISOString(),
        canClaim: (() => {
          const pickupAt = new Date(trip.pickupTime || trip.scheduledDate);
          const opensAt = getClaimOpensAt(pickupAt);
          const autoEndsAt = getAutoDispatchEndsAt(new Date(trip.createdAt));
          const inImmediateWindow = pickupAt < autoDispatchLookaheadCutoff;

          return (
            !Boolean((trip as any).claims?.length) &&
            Math.max(0, MAX_CLAIMS_PER_BOOKING - ((trip as any)._count?.claims ?? 0)) > 0 &&
            now >= opensAt &&
            (!inImmediateWindow || now >= autoEndsAt) &&
            getAreaIneligibilityReason(driver, trip) === null &&
            getClaimReasonForDriver({
              bookingVehicleType: trip.vehicleType,
              driverNormalizedVehicleType,
              isVipDriver,
            }) === null
          );
        })(),
        claimIneligibilityReason: (() => {
          const opensAt = getClaimOpensAt(new Date(trip.pickupTime || trip.scheduledDate));
          if (now < opensAt) return "Bidding opens 72 hours before pickup";
          if (Boolean((trip as any).claims?.length)) return "You already submitted a bid";

          const pickupAt = new Date(trip.pickupTime || trip.scheduledDate);
          const autoEndsAt = getAutoDispatchEndsAt(new Date(trip.createdAt));
          const inImmediateWindow = pickupAt < autoDispatchLookaheadCutoff;
          if (inImmediateWindow && now < autoEndsAt) {
            const minsLeft = Math.max(1, Math.ceil((autoEndsAt.getTime() - now.getTime()) / 60000));
            return `Auto-allocating a driver (try again in ~${minsLeft} min)`;
          }
          const count = (trip as any)._count?.claims ?? 0;
          if (count >= MAX_CLAIMS_PER_BOOKING) return "No bids left";
          const areaReason = getAreaIneligibilityReason(driver, trip);
          if (areaReason) return areaReason;
          return (
            getClaimReasonForDriver({
              bookingVehicleType: trip.vehicleType,
              driverNormalizedVehicleType,
              isVipDriver,
            }) || null
          );
        })(),
        id: trip.id,
        vehicleType: trip.vehicleType,
        scheduledDate: trip.scheduledDate,
        pickupTime: trip.pickupTime,
        fromAddress: trip.fromAddress,
        fromLatitude: trip.fromLatitude,
        fromLongitude: trip.fromLongitude,
        toAddress: trip.toAddress || trip.property?.title,
        toLatitude: trip.toLatitude,
        toLongitude: trip.toLongitude,
        amount: trip.amount,
        currency: trip.currency,
        numberOfPassengers: trip.numberOfPassengers,
        arrivalType: trip.arrivalType,
        arrivalNumber: trip.arrivalNumber,
        transportCompany: trip.transportCompany,
        arrivalTime: trip.arrivalTime,
        pickupLocation: trip.pickupLocation,
        notes: trip.notes,
        passenger: trip.user,
        property: trip.property,
        tripCode: trip.tripCode,
        createdAt: trip.createdAt,
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (error: any) {
    console.error("GET /driver/trips/scheduled error:", error);
    res.status(500).json({ error: "Failed to fetch scheduled trips" });
  }
}) as RequestHandler);

/**
 * GET /api/driver/trips/claims/pending
 * Trips this driver has claimed that are awaiting NoLSAF team review.
 */
router.get("/claims/pending", limitDriverTripsList, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return badRequest(res, "Invalid query parameters", parsed.error.flatten());
    }
    const { page: pageNum, pageSize: pageSizeNum } = parsed.data;
    const skip = (pageNum - 1) * pageSizeNum;

    const now = new Date();

    const where: any = {
      driverId: user.id,
      status: "PENDING",
      booking: {
        scheduledDate: { gte: now },
      },
    };

    const [claims, total] = await Promise.all([
      (prisma as any).transportBookingClaim.findMany({
        where,
        include: {
          booking: {
            include: {
              user: { select: { id: true, name: true, phone: true, email: true } },
              property: { select: { id: true, title: true, regionName: true, district: true, ward: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSizeNum,
      }),
      (prisma as any).transportBookingClaim.count({ where }),
    ]);

    res.json({
      items: claims.map((c: any) => {
        const trip = c.booking;
        return {
          id: trip.id,
          claimId: c.id,
          claimStatus: c.status,
          claimCreatedAt: c.createdAt,
          vehicleType: trip.vehicleType,
          scheduledDate: trip.scheduledDate,
          pickupTime: trip.pickupTime,
          fromAddress: trip.fromAddress,
          fromLatitude: trip.fromLatitude,
          fromLongitude: trip.fromLongitude,
          toAddress: trip.toAddress || trip.property?.title,
          toLatitude: trip.toLatitude,
          toLongitude: trip.toLongitude,
          amount: trip.amount,
          currency: trip.currency,
          numberOfPassengers: trip.numberOfPassengers,
          arrivalType: trip.arrivalType,
          arrivalNumber: trip.arrivalNumber,
          transportCompany: trip.transportCompany,
          arrivalTime: trip.arrivalTime,
          pickupLocation: trip.pickupLocation,
          notes: trip.notes,
          passenger: trip.user,
          property: trip.property,
          status: trip.status,
          tripCode: trip.tripCode,
          createdAt: trip.createdAt,
        };
      }),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (error: any) {
    console.error("GET /driver/trips/claims/pending error:", error);
    res.status(500).json({ error: "Failed to fetch pending claims" });
  }
}) as RequestHandler);

/**
 * GET /api/driver/trips/claims/finished
 * Trips completed by this driver (for history + ratings).
 */
router.get("/claims/finished", limitDriverTripsList, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return badRequest(res, "Invalid query parameters", parsed.error.flatten());
    }
    const { page: pageNum, pageSize: pageSizeNum } = parsed.data;
    const skip = (pageNum - 1) * pageSizeNum;

    const where: any = {
      driverId: user.id,
      status: { in: ["COMPLETED", "FINISHED"] },
    };

    const [trips, total] = await Promise.all([
      prisma.transportBooking.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, phone: true, email: true } },
              property: { select: { id: true, title: true, regionName: true, district: true, ward: true } },
              payout: true,
        },
        orderBy: { scheduledDate: "desc" },
        skip,
        take: pageSizeNum,
      }),
      prisma.transportBooking.count({ where }),
    ]);

    res.json({
      items: trips.map((trip) => ({
        id: trip.id,
        vehicleType: trip.vehicleType,
        scheduledDate: trip.scheduledDate,
        pickupTime: trip.pickupTime,
        fromAddress: trip.fromAddress,
        fromLatitude: trip.fromLatitude,
        fromLongitude: trip.fromLongitude,
        toAddress: trip.toAddress || trip.property?.title,
        toLatitude: trip.toLatitude,
        toLongitude: trip.toLongitude,
        amount: trip.amount,
        currency: trip.currency,
        numberOfPassengers: trip.numberOfPassengers,
        arrivalType: trip.arrivalType,
        arrivalNumber: trip.arrivalNumber,
        transportCompany: trip.transportCompany,
        arrivalTime: trip.arrivalTime,
        pickupLocation: trip.pickupLocation,
        notes: trip.notes,
        passenger: trip.user,
        property: trip.property,
        status: trip.status,
        userRating: trip.userRating,
        userReview: trip.userReview,
        driverRating: trip.driverRating,
        driverReview: trip.driverReview,
        tripCode: trip.tripCode,
        createdAt: trip.createdAt,
        completedAt: trip.dropoffTime || trip.updatedAt,
        payoutId: trip.payout?.id ?? null,
        payoutStatus: trip.payout?.status ?? null,
        payoutGrossAmount: trip.payout ? Number(trip.payout.grossAmount) : null,
        payoutCommissionAmount: trip.payout ? Number(trip.payout.commissionAmount) : null,
        payoutNetPaid: trip.payout ? Number(trip.payout.netPaid) : null,
        payoutCurrency: trip.payout?.currency ?? null,
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (error: any) {
    console.error("GET /driver/trips/claims/finished error:", error);
    res.status(500).json({ error: "Failed to fetch finished trips" });
  }
}) as RequestHandler);

const DEFAULT_DRIVER_COMMISSION_PERCENT = 10;

function roundMoney(amount: number): number {
  return Math.round((Number(amount) || 0) * 100) / 100;
}

async function getDriverCommissionPercent(): Promise<number> {
  try {
    const setting = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { driverCommissionPercent: true } as any,
    });
    const pct = Number((setting as any)?.driverCommissionPercent ?? DEFAULT_DRIVER_COMMISSION_PERCENT);
    return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : DEFAULT_DRIVER_COMMISSION_PERCENT;
  } catch {
    return DEFAULT_DRIVER_COMMISSION_PERCENT;
  }
}

/**
 * POST /api/driver/trips/:id/payout-claim
 * Driver claims their payout for a completed trip, creating a pending
 * TransportPayout record for NoLSAF to review and pay out.
 */
router.post("/:id/payout-claim", limitDriverTripAction, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) return badRequest(res, "Invalid trip id", parsed.error.flatten());
    const bookingId = parsed.data.id;

    const booking = await prisma.transportBooking.findFirst({
      where: { id: bookingId, driverId: user.id },
      select: { id: true, status: true, amount: true, currency: true, tripCode: true },
    });
    if (!booking) return res.status(404).json({ error: "Trip not found" });

    const status = String(booking.status ?? "").toUpperCase();
    if (!["COMPLETED", "FINISHED"].includes(status)) {
      return res.status(409).json({ error: "This trip is not completed yet" });
    }

    const grossAmount = Number(booking.amount ?? 0);
    if (!Number.isFinite(grossAmount) || grossAmount <= 0) {
      return res.status(409).json({ error: "This trip has no fare amount to claim" });
    }

    const existing = await prisma.transportPayout.findUnique({ where: { transportBookingId: bookingId } });
    if (existing) {
      return res.json({
        ok: true,
        alreadyClaimed: true,
        payout: {
          id: existing.id,
          status: existing.status,
          grossAmount: existing.grossAmount,
          commissionAmount: existing.commissionAmount,
          netPaid: existing.netPaid,
          currency: existing.currency,
        },
      });
    }

    const commissionPercent = await getDriverCommissionPercent();
    const commissionAmount = roundMoney((grossAmount * commissionPercent) / 100);
    const netPaid = roundMoney(grossAmount - commissionAmount);
    const currency = booking.currency ?? "TZS";

    try {
      const payout = await prisma.transportPayout.create({
        data: {
          transportBookingId: bookingId,
          driverId: user.id,
          currency,
          grossAmount: grossAmount as any,
          commissionPercent: commissionPercent as any,
          commissionAmount: commissionAmount as any,
          netPaid: netPaid as any,
          status: "PENDING",
        },
      });

      // Notify admins that a driver submitted a payout claim to review.
      try {
        await notifyAdmins("transport_payout_claim_submitted", {
          transportBookingId: bookingId,
          driverName: (user as any)?.name || (user as any)?.fullName || null,
          grossAmount,
          netPaid,
        });
      } catch (notifyErr) {
        console.error("notifyAdmins(transport_payout_claim_submitted) failed:", notifyErr);
      }

      return res.json({
        ok: true,
        alreadyClaimed: false,
        payout: {
          id: payout.id,
          status: payout.status,
          grossAmount: Number(payout.grossAmount),
          commissionAmount: Number(payout.commissionAmount),
          netPaid: Number(payout.netPaid),
          currency: payout.currency,
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        const payout = await prisma.transportPayout.findUnique({ where: { transportBookingId: bookingId } });
        return res.json({
          ok: true,
          alreadyClaimed: true,
          payout: payout && {
            id: payout.id,
            status: payout.status,
            grossAmount: Number(payout.grossAmount),
            commissionAmount: Number(payout.commissionAmount),
            netPaid: Number(payout.netPaid),
            currency: payout.currency,
          },
        });
      }
      throw err;
    }
  } catch (error: any) {
    console.error("POST /driver/trips/:id/payout-claim error:", error);
    res.status(500).json({ error: "Failed to submit your payout claim" });
  }
}) as RequestHandler);

/**
 * POST /api/driver/trips/:id/claim
 * Driver claims a scheduled trip (competitive advantage feature)
 */
router.post("/:id/claim", limitDriverTripClaim, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) {
      return badRequest(res, "Invalid trip ID", parsed.error.flatten());
    }
    const tripId = parsed.data.id;

    // Use transaction to prevent race conditions
    const result = await prisma.$transaction(async (tx) => {
      const driver = await tx.user.findUnique({
        where: { id: user.id },
        select: { vehicleType: true, isVipDriver: true, region: true, operationArea: true } as any,
      });
      if (!driver) {
        throw new Error("Driver not found");
      }

      // Check if trip exists and is available
      const trip = await tx.transportBooking.findUnique({
        where: { id: tripId },
        include: {
          user: { select: { id: true, name: true, phone: true } },
          property: { select: { id: true, title: true, regionName: true, district: true, ward: true } },
        },
      });

      if (!trip) {
        throw new Error("Trip not found");
      }

      if (trip.status !== "PENDING_ASSIGNMENT") {
        throw new Error("Trip is not available for bidding");
      }

      if (trip.paymentStatus !== "PAID") {
        throw new Error("Trip is not yet paid");
      }

      if (trip.driverId !== null) {
        throw new Error("Trip has already been assigned");
      }

      // Area-of-operation restriction
      const areaReason = getAreaIneligibilityReason(driver, trip);
      if (areaReason) {
        const err: any = new Error(areaReason);
        err.code = "OUT_OF_AREA";
        throw err;
      }

      // Check if trip is in the future
      if (new Date(trip.scheduledDate) < new Date()) {
        throw new Error("Cannot bid on past trips");
      }

      const pickupAt = new Date(trip.pickupTime || trip.scheduledDate);
      const opensAt = getClaimOpensAt(pickupAt);
      const now = new Date();

      // If the trip is happening soon, the platform tries auto-dispatch first.
      // Only allow claim after the grace window expires.
      const autoEndsAt = getAutoDispatchEndsAt(new Date(trip.createdAt));
      const inImmediateWindow = pickupAt.getTime() < now.getTime() + AUTO_DISPATCH_LOOKAHEAD_MS;
      if (inImmediateWindow && now < autoEndsAt) {
        const minsLeft = Math.max(1, Math.ceil((autoEndsAt.getTime() - now.getTime()) / 60000));
        const err: any = new Error(`Auto-allocating a driver (try again in ~${minsLeft} min)`);
        err.code = "AUTO_DISPATCH_IN_PROGRESS";
        err.availableAt = autoEndsAt.toISOString();
        throw err;
      }

      if (now < opensAt) {
        const hoursLeft = Math.ceil((opensAt.getTime() - now.getTime()) / (60 * 60 * 1000));
        const err: any = new Error(`Bidding opens 72 hours before pickup (opens in ~${hoursLeft}h)`);
        err.code = "CLAIMS_NOT_OPEN";
        err.opensAt = opensAt.toISOString();
        throw err;
      }

      // Enforce eligibility (VIP + vehicle type matching)
      const driverNormalizedVehicleType = normalizeDriverVehicleType((driver as any).vehicleType || undefined);
      const isVipDriver = Boolean((driver as any).isVipDriver);
      const reason = getClaimReasonForDriver({
        bookingVehicleType: trip.vehicleType,
        driverNormalizedVehicleType,
        isVipDriver,
      });
      if (reason) {
        const err: any = new Error(reason);
        err.code = "NOT_ELIGIBLE";
        throw err;
      }

      // Enforce claim range (max 5 claims)
      const existingCount = await (tx as any).transportBookingClaim.count({
        where: {
          bookingId: tripId,
          status: { in: ["PENDING", "ACCEPTED"] },
        },
      });
      if (existingCount >= MAX_CLAIMS_PER_BOOKING) {
        throw new Error("No bids left");
      }

      const existingByDriver = await (tx as any).transportBookingClaim.findUnique({
        where: { bookingId_driverId: { bookingId: tripId, driverId: user.id } },
        select: { id: true } as any,
      });
      if (existingByDriver) {
        throw new Error("You already submitted a bid for this trip");
      }

      const claim = await (tx as any).transportBookingClaim.create({
        data: {
          bookingId: tripId,
          driverId: user.id,
          status: "PENDING",
        },
      });

      // Driver submits a claim. NoLSAF team reviews before awarding.
      const updated = await tx.transportBooking.findUnique({
        where: { id: tripId },
        include: {
          user: { select: { id: true, name: true, phone: true, email: true } },
          property: { select: { id: true, title: true, regionName: true, district: true, ward: true } },
        },
      });

      if (!updated) {
        throw new Error("Trip not found");
      }

      // Create notifications
      try {
        const tripDateLabel = new Date(updated.scheduledDate).toLocaleDateString("en-GB", {
          weekday: "long", day: "2-digit", month: "long", year: "numeric",
        });
        const fromLabel = [updated.fromAddress, updated.fromWard, updated.fromDistrict, updated.fromRegion]
          .filter(Boolean).join(", ") || "Origin";
        const toLabel = [updated.toAddress || updated.property?.title, updated.toWard, updated.toDistrict, updated.toRegion]
          .filter(Boolean).join(", ") || "Destination";
        const amountLabel = updated.amount
          ? `${updated.currency || "TZS"} ${Number(updated.amount).toLocaleString()}`
          : null;
        const vehicleLabel = updated.vehicleType ? ` (${updated.vehicleType})` : "";

        // Estimate review deadline: results are declared before the trip date.
        // We give drivers a realistic expectation: selection is typically confirmed
        // at least 24 hours before pickup.
        const pickupAt = updated.pickupTime || updated.scheduledDate;
        const reviewDeadline = new Date(new Date(pickupAt).getTime() - 24 * 60 * 60 * 1000);
        const reviewDeadlineLabel = reviewDeadline.toLocaleDateString("en-GB", {
          weekday: "short", day: "2-digit", month: "short", year: "numeric",
        });

        await tx.notification.create({
          data: {
            userId: user.id,
            title: "Claim submitted: pending review",
            body: [
              `Your offer for the trip on ${tripDateLabel} has been received and is now under review by the NoLSAF team.`,
              `Route: ${fromLabel} → ${toLabel}${vehicleLabel}`,
              amountLabel ? `Fare: ${amountLabel}` : null,
              updated.pickupLocation ? `Pickup point: ${updated.pickupLocation}` : null,
              ``,
              `What happens next:`,
              `• Our team reviews all driver offers for this trip.`,
              `• The selected driver will be notified by ${reviewDeadlineLabel}, at least 24 hours before the trip.`,
              `• You will receive a notification here and an SMS on your phone with the result.`,
              ``,
              `Thank you for being part of the NoLSAF family. Keep bidding and stay ready!`,
            ].filter((l) => l !== null).join("\n"),
            unread: true,
            type: "ride",
            meta: {
              transportBookingId: updated.id,
              status: "CLAIM_PENDING",
              claimId: claim.id,
              tripDate: updated.scheduledDate,
              pickupTime: updated.pickupTime,
              pickupLocation: updated.pickupLocation,
              from: fromLabel,
              to: toLabel,
              vehicleType: updated.vehicleType,
              amount: updated.amount ? Number(updated.amount) : null,
              currency: updated.currency,
              reviewDeadline: reviewDeadline.toISOString(),
            },
          },
        });
      } catch (notifError) {
        console.warn("Failed to create notifications:", notifError);
        // Don't fail the claim if notifications fail
      }

      return { updated, claim };
    }, { timeout: 15000 });

    // Audit log for driver claim
    try {
      // Fetch driver name + phone for audit log and SMS
      const driverUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { name: true, email: true, phone: true },
      });

      // SMS confirmation to the driver
      if (driverUser?.phone) {
        const b = (result as any).updated;
        const tripDateSms = new Date(b.scheduledDate).toLocaleDateString("en-GB", {
          day: "2-digit", month: "short", year: "numeric",
        });
        const fromSms = [b.fromAddress, b.fromRegion].filter(Boolean).join(", ") || "Origin";
        const toSms = [b.toAddress || b.property?.title, b.toRegion].filter(Boolean).join(", ") || "Destination";
        const pickupAt = b.pickupTime || b.scheduledDate;
        const reviewDeadlineSms = new Date(new Date(pickupAt).getTime() - 24 * 60 * 60 * 1000)
          .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        const smsBody = [
          `Claim received for trip on ${tripDateSms}.`,
          `Route: ${fromSms} → ${toSms}.`,
          `Our team will select a driver by ${reviewDeadlineSms}. You will be notified of the result via app & SMS.`,
          `Thank you!`,
        ].join(" ");
        await sendSms(driverUser.phone, smsBody).catch((smsErr: any) =>
          console.warn("[claim] SMS confirmation failed:", smsErr?.message || smsErr)
        );
      }

      await audit(req, "TRANSPORT_BOOKING_CLAIM_SUBMITTED", `transport-booking:${result.id}`, {
        status: "PENDING_ASSIGNMENT",
        driverId: null,
      }, {
        status: "CLAIM_PENDING",
        driverId: user.id,
        driverName: driverUser?.name || driverUser?.email || `User ${user.id}`,
      });
    } catch (auditError) {
      console.warn("Failed to create audit log for driver claim:", auditError);
      // Don't fail the request if audit logging fails
    }

    // Emit real-time event
    try {
      const io = (req.app && (req.app as any).get && (req.app as any).get("io")) || (global as any).io;
      if (io && typeof io.to === "function") {
        io.to(`driver:${user.id}`).emit("transport:booking:claim_submitted", {
          transportBookingId: (result as any).updated.id,
          status: "CLAIM_PENDING",
        });
      }
    } catch (socketError) {
      console.warn("Failed to emit socket event:", socketError);
    }

    res.json({
      ok: true,
      claim: {
        id: (result as any).claim.id,
        status: (result as any).claim.status,
        createdAt: (result as any).claim.createdAt,
      },
      trip: {
        id: (result as any).updated.id,
        status: (result as any).updated.status,
        scheduledDate: (result as any).updated.scheduledDate,
        passenger: (result as any).updated.user,
        property: (result as any).updated.property,
      },
    });
  } catch (error: any) {
    console.error("POST /driver/trips/:id/claim error:", error);
    const statusCode =
      error?.code === "NOT_ELIGIBLE" ? 403 :
      error?.code === "CLAIMS_NOT_OPEN" ? 409 :
      error.message.includes("not found") ? 404 :
      error.message.includes("not available") || error.message.includes("already") || error.message.includes("No bids left") ? 409 :
      500;
    res.status(statusCode).json({
      error: error.message || "Failed to submit your bid",
      opensAt: error?.opensAt,
    });
  }
}) as RequestHandler);

/**
 * GET /api/driver/trips/scheduled/assigned
 * Get driver's assigned scheduled trips
 */
router.get("/scheduled/assigned", limitDriverTripsList, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return badRequest(res, "Invalid query parameters", parsed.error.flatten());
    }
    const { page: pageNum, pageSize: pageSizeNum } = parsed.data;
    const skip = (pageNum - 1) * pageSizeNum;

    const where: any = {
      driverId: user.id,
      scheduledDate: {
        gte: new Date(), // Only future trips
      },
      status: {
        // Keep legacy statuses but also include the schema's documented status values.
        // Some admin/ops flows assign driverId without changing status away from PENDING.
        in: ["ASSIGNED", "CONFIRMED", "PENDING", "IN_PROGRESS"],
      },
    };

    const [trips, total] = await Promise.all([
      prisma.transportBooking.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              phone: true,
              email: true,
            },
          },
          property: {
            select: {
              id: true,
              title: true,
              regionName: true,
              district: true,
            },
          },
        },
        orderBy: { scheduledDate: "asc" },
        skip,
        take: pageSizeNum,
      }),
      prisma.transportBooking.count({ where }),
    ]);

    // Awarded-at timestamp comes from the driver's accepted claim, if one exists.
    const acceptedClaims = trips.length
      ? await prisma.transportBookingClaim.findMany({
          where: {
            bookingId: { in: trips.map((trip) => trip.id) },
            driverId: user.id,
            status: "ACCEPTED",
          },
          select: { bookingId: true, reviewedAt: true },
        })
      : [];
    const awardedAtByBookingId = new Map(acceptedClaims.map((claim) => [claim.bookingId, claim.reviewedAt]));

    res.json({
      items: trips.map((trip) => ({
        id: trip.id,
        vehicleType: trip.vehicleType,
        scheduledDate: trip.scheduledDate,
        pickupTime: trip.pickupTime,
        fromAddress: trip.fromAddress,
        fromLatitude: trip.fromLatitude,
        fromLongitude: trip.fromLongitude,
        toAddress: trip.toAddress || trip.property?.title,
        toLatitude: trip.toLatitude,
        toLongitude: trip.toLongitude,
        amount: trip.amount,
        currency: trip.currency,
        numberOfPassengers: trip.numberOfPassengers,
        arrivalType: trip.arrivalType,
        arrivalNumber: trip.arrivalNumber,
        transportCompany: trip.transportCompany,
        arrivalTime: trip.arrivalTime,
        pickupLocation: trip.pickupLocation,
        notes: trip.notes,
        passenger: trip.user,
        property: trip.property,
        status: trip.status,
        tripCode: trip.tripCode,
        createdAt: trip.createdAt,
        awardedAt: awardedAtByBookingId.get(trip.id) || trip.updatedAt,
      })),
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (error: any) {
    console.error("GET /driver/trips/scheduled/assigned error:", error);
    res.status(500).json({ error: "Failed to fetch assigned trips" });
  }
}) as RequestHandler);

/**
 * POST /api/driver/trips/:id/accept
 * Driver accepts a real-time offer pushed by the auto-dispatch worker.
 * Atomically assigns the driver and marks the offer ACCEPTED.
 */
router.post("/:id/accept", limitDriverTripAction, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) return badRequest(res, "Invalid trip ID", parsed.error.flatten());
    const tripId = parsed.data.id;
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const booking = await tx.transportBooking.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          driverId: true,
          status: true,
          paymentStatus: true,
          userId: true,
          vehicleType: true,
          scheduledDate: true,
          pickupTime: true,
          fromAddress: true,
          fromLatitude: true,
          fromLongitude: true,
          toAddress: true,
          toLatitude: true,
          toLongitude: true,
          amount: true,
          currency: true,
          tripCode: true,
          user: { select: { id: true, name: true, phone: true, email: true } },
        },
      });

      if (!booking) {
        const err: any = new Error("Trip not found");
        err.code = "NOT_FOUND";
        throw err;
      }
      if (booking.driverId !== null) {
        const err: any = new Error("Trip already accepted by another driver");
        err.code = "ALREADY_ASSIGNED";
        throw err;
      }
      if (String(booking.status ?? "") === "PENDING_ADMIN_ASSIGNMENT") {
        const err: any = new Error("admin_takeover");
        err.code = "admin_takeover";
        throw err;
      }
      if (!["PENDING_ASSIGNMENT", "PENDING"].includes(String(booking.status ?? ""))) {
        const err: any = new Error("Trip is not available for acceptance");
        err.code = "UNAVAILABLE";
        throw err;
      }
      if (booking.paymentStatus !== "PAID") {
        const err: any = new Error("Trip payment is not confirmed");
        err.code = "UNAVAILABLE";
        throw err;
      }

      // Only a persisted, live offer authorizes an app acceptance.
      {
        const offer = await tx.transportBookingOffer.findFirst({
          where: {
            bookingId: tripId,
            driverId: user.id,
            status: "OFFERED",
            expiresAt: { gt: now },
          },
          select: { id: true },
        });
        if (!offer) {
          const err: any = new Error("Offer expired or you were not offered this trip");
          err.code = "NO_VALID_OFFER";
          throw err;
        }
      }

      // The booking must remain paid, offerable, and unassigned at write time.
      const updated = await (tx as any).transportBooking.update({
        where: {
          id: tripId,
          driverId: null,
          paymentStatus: "PAID",
          status: { in: ["PENDING_ASSIGNMENT", "PENDING"] },
        } as any,
        data: { driverId: user.id, status: "CONFIRMED" },
        include: { user: { select: { id: true, name: true, phone: true, email: true } } },
      }).catch((e: any) => {
        // P2025 = record not found (another driver grabbed it first)
        if (e?.code === "P2025") {
          const err: any = new Error("Trip is no longer available");
          err.code = "UNAVAILABLE";
          throw err;
        }
        throw e;
      });

      // Mark this driver's offer ACCEPTED; expire all other open offers.
      if ((prisma as any).transportBookingOffer) {
        await Promise.all([
          (tx as any).transportBookingOffer.updateMany({
            where: { bookingId: tripId, driverId: user.id },
            data: { status: "ACCEPTED", respondedAt: now },
          }),
          (tx as any).transportBookingOffer.updateMany({
            where: { bookingId: tripId, driverId: { not: user.id }, status: "OFFERED" },
            data: { status: "EXPIRED", respondedAt: now },
          }),
        ]);
      }

      return updated;
    });

    // Notify the passenger in real-time.
    try {
      const io = (req.app as any)?.get?.("io");
      if (io) {
        io.to(`user:${result.userId}`).emit("transport:booking:accepted", {
          bookingId: tripId,
          driverId: user.id,
        });
      }
    } catch {
      // ignore
    }

    // Best-effort: assignment audit record so trip lists can classify admin vs auto/driver allocations.
    try {
      if ((prisma as any).auditLog) {
        await (prisma as any).auditLog.create({
          data: {
            actorId: Number(user.id),
            actorRole: "DRIVER",
            action: "TRANSPORT_ASSIGN_DRIVER",
            entity: "TRANSPORT_BOOKING",
            entityId: Number(result.id),
            beforeJson: { driverId: null },
            afterJson: { bookingId: Number(result.id), driverId: Number(user.id), kind: "DRIVER_ACCEPT" },
            ip: requestIp(req),
            ua: String(req.headers["user-agent"] || "") || null,
          },
        });
      }
    } catch {
      // ignore
    }

    // Inbox notifications (customer + driver).
    try {
      await prisma.notification.create({
        data: {
          userId: result.userId,
          title: "Driver accepted your ride",
          body: "Your driver is on the way to your pickup location.",
          unread: true,
          type: "ride",
          meta: { transportBookingId: result.id, status: result.status, driverId: user.id },
        },
      });
    } catch {
      // ignore
    }
    try {
      await prisma.notification.create({
        data: {
          userId: Number(user.id),
          title: "Trip accepted",
          body: "Navigate to pickup location.",
          unread: true,
          type: "ride",
          meta: { transportBookingId: result.id, status: result.status },
        },
      });
    } catch {
      // ignore
    }

    // Realtime trip:update to driver + passenger.
    try {
      const io = (req.app && (req.app as any).get && (req.app as any).get("io")) || (global as any).io;
      if (io && typeof io.to === "function") {
        io.to(`driver:${user.id}`).emit("trip:update", { id: result.id, status: result.status });
        io.to(`user:${result.userId}`).emit("trip:update", { id: result.id, status: result.status });
      }
    } catch {
      // ignore
    }

    const currency = String(result.currency ?? "TZS").toUpperCase();
    const amountNum = Number(result.amount ?? 0);
    const fare = Number.isFinite(amountNum) && amountNum > 0
      ? `${currency} ${amountNum.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
      : undefined;

    return res.json({
      ok: true,
      trip: {
        id: result.id,
        status: result.status,
        tripCode: result.tripCode,
        pickupAddress: result.fromAddress,
        dropoffAddress: result.toAddress,
        pickupLat: result.fromLatitude ? Number(result.fromLatitude) : null,
        pickupLng: result.fromLongitude ? Number(result.fromLongitude) : null,
        dropoffLat: result.toLatitude ? Number(result.toLatitude) : null,
        dropoffLng: result.toLongitude ? Number(result.toLongitude) : null,
        fare,
        amount: amountNum,
        currency: result.currency,
        passengerName: (result as any).user?.name ?? "Passenger",
        phoneNumber: (result as any).user?.phone ?? null,
        passengerUserId: (result as any).user?.id ?? null,
      },
    });
  } catch (error: any) {
    console.error("POST /driver/trips/:id/accept error:", error);
    const statusCode =
      error?.code === "NOT_FOUND" ? 404 :
      error?.code === "ALREADY_ASSIGNED" ? 409 :
      error?.code === "admin_takeover" ? 409 :
      error?.code === "NO_VALID_OFFER" ? 409 :
      error?.code === "UNAVAILABLE" ? 409 :
      500;
    return res.status(statusCode).json({ error: error?.message || "Failed to accept trip" });
  }
}) as RequestHandler);

/**
 * POST /api/driver/trips/:id/decline
 * Driver declines a real-time offer. Marks the offer DECLINED so the worker
 * can issue offers to the next available driver.
 */
router.post("/:id/decline", limitDriverTripAction, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) return badRequest(res, "Invalid trip ID", parsed.error.flatten());
    const tripId = parsed.data.id;
    const now = new Date();

    // Mark the offer DECLINED so the next dispatch round can offer it to another driver.
    // Best-effort — decline is always acknowledged even if the offer model is unavailable.
    try {
      if ((prisma as any).transportBookingOffer) {
        await (prisma as any).transportBookingOffer.updateMany({
          where: { bookingId: tripId, driverId: user.id, status: "OFFERED" },
          data: { status: "DECLINED", respondedAt: now },
        });
      }
    } catch {
      // ignore
    }

    return res.json({ ok: true });
  } catch (error: any) {
    console.error("POST /driver/trips/:id/decline error:", error);
    return res.status(500).json({ error: "Failed to decline trip" });
  }
}) as RequestHandler);

/**
 * POST /api/driver/trips/:id/cancel
 * Cancels an in-progress/accepted trip (driver must be the assigned driver).
 * Body: { reason?: string }
 */
router.post("/:id/cancel", limitDriverTripAction, (async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) return badRequest(res, "Invalid trip id", parsed.error.flatten());
  const tripId = parsed.data.id;

  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

  try {
    const existing = await prisma.transportBooking.findUnique({ where: { id: tripId } });
    if (!existing) return res.status(404).json({ error: "not_found" });
    if (!existing.driverId || Number(existing.driverId) !== Number(user.id)) {
      return res.status(403).json({ error: "not_assigned_to_you" });
    }

    const newNotes =
      (existing.notes ? String(existing.notes) + "\n" : "") +
      (reason ? `Driver cancelled: ${reason}` : "Driver cancelled");

    const updated = await prisma.transportBooking.update({
      where: { id: tripId },
      data: { status: "CANCELED", notes: newNotes },
    });

    // Notify customer
    try {
      await prisma.notification.create({
        data: {
          userId: updated.userId,
          title: "Ride cancelled",
          body: reason ? `Your ride was cancelled by the driver. Reason: ${reason}` : "Your ride was cancelled by the driver.",
          unread: true,
          type: "ride",
          meta: { transportBookingId: updated.id, status: updated.status, driverId: updated.driverId },
        },
      });
    } catch {
      // ignore
    }

    // Realtime emit
    try {
      const io = (req.app && (req.app as any).get && (req.app as any).get("io")) || (global as any).io;
      if (io && typeof io.to === "function") {
        io.to(`driver:${user.id}`).emit("trip:update", { id: tripId, status: updated.status });
        io.to(`user:${updated.userId}`).emit("trip:update", { id: tripId, status: updated.status });
      }
    } catch {
      // ignore
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("driver.trip.cancel failed", err);
    return res.status(500).json({ error: "failed", details: err?.message || String(err) });
  }
}) as RequestHandler);

/**
 * POST /api/driver/trips/:id/stage
 * Persists driver trip-stage movement and records a server-side route/stage audit.
 */
router.post("/:id/stage", limitDriverTripAction, (async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const parsed = idParamSchema.safeParse(req.params);
  if (!parsed.success) return badRequest(res, "Invalid trip id", parsed.error.flatten());
  const tripId = parsed.data.id;

  const parsedBody = transportTripStageSchema.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    return res.status(400).json({ error: "Invalid payload", issues: parsedBody.error.issues });
  }

  const stage = normalizeTransportTripStage(parsedBody.data.stage);
  const nextStatus = stageToBookingStatus(stage);
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.transportBooking.findUnique({
        where: { id: tripId },
        select: {
          id: true,
          userId: true,
          driverId: true,
          status: true,
          pickupTime: true,
          dropoffTime: true,
        },
      });

      if (!existing) {
        const err: any = new Error("not_found");
        err.code = "NOT_FOUND";
        throw err;
      }
      if (!existing.driverId || Number(existing.driverId) !== Number(user.id)) {
        const err: any = new Error("not_assigned_to_you");
        err.code = "NOT_ASSIGNED_TO_YOU";
        throw err;
      }
      if (existing.status === "CANCELED") {
        const err: any = new Error("trip_canceled");
        err.code = "TRIP_CANCELED";
        throw err;
      }
      if (existing.status === "COMPLETED" && stage !== "completed") {
        const err: any = new Error("trip_completed");
        err.code = "TRIP_COMPLETED";
        throw err;
      }

      const data: any = { status: nextStatus };
      if ((stage === "passenger_picked_up" || stage === "in_transit") && !existing.pickupTime) {
        data.pickupTime = now;
      }
      if (stage === "completed" && !existing.dropoffTime) {
        data.dropoffTime = now;
      }

      const updated = await tx.transportBooking.update({
        where: { id: tripId },
        data,
        select: {
          id: true,
          userId: true,
          driverId: true,
          status: true,
          pickupTime: true,
          dropoffTime: true,
        },
      });

      if (
        typeof parsedBody.data.lat === "number" &&
        typeof parsedBody.data.lng === "number" &&
        (tx as any).driverLocationPing
      ) {
        await (tx as any).driverLocationPing.create({
          data: {
            driverId: Number(user.id),
            transportBookingId: tripId,
            lat: parsedBody.data.lat,
            lng: parsedBody.data.lng,
            accuracyM: typeof parsedBody.data.accuracyM === "number" ? parsedBody.data.accuracyM : undefined,
          },
        });
      }

      await (tx as any).auditLog?.create?.({
        data: {
          actorId: Number(user.id),
          actorRole: "DRIVER",
          action: "TRANSPORT_TRIP_STAGE_UPDATE",
          entity: "TRANSPORT_BOOKING",
          entityId: tripId,
          beforeJson: {
            status: existing.status,
            pickupTime: existing.pickupTime,
            dropoffTime: existing.dropoffTime,
          },
          afterJson: {
            stage,
            status: updated.status,
            pickupTime: updated.pickupTime,
            dropoffTime: updated.dropoffTime,
            route: parsedBody.data.route ?? null,
            clientEventId: parsedBody.data.clientEventId ?? null,
          },
          ip: requestIp(req),
          ua: String(req.headers["user-agent"] || "") || null,
        },
      });

      return updated;
    });

    const payload = {
      id: result.id,
      stage,
      status: result.status,
      pickupTime: result.pickupTime ? result.pickupTime.toISOString() : null,
      dropoffTime: result.dropoffTime ? result.dropoffTime.toISOString() : null,
      route: parsedBody.data.route ?? null,
      at: now.toISOString(),
    };

    emitTransportTripEvent(
      req,
      { id: result.id, userId: result.userId, driverId: result.driverId },
      "transport:trip:stage:update",
      payload
    );
    emitTransportTripEvent(req, { id: result.id, userId: result.userId, driverId: result.driverId }, "trip:update", {
      id: result.id,
      status: result.status,
      stage,
    });

    return res.json({ ok: true, trip: payload });
  } catch (err: any) {
    const msg = String(err?.message || "");
    if (err?.code === "NOT_FOUND" || msg === "not_found") return res.status(404).json({ error: "not_found" });
    if (err?.code === "NOT_ASSIGNED_TO_YOU" || msg === "not_assigned_to_you") return res.status(403).json({ error: "not_assigned_to_you" });
    if (err?.code === "TRIP_CANCELED" || msg === "trip_canceled") return res.status(409).json({ error: "trip_canceled" });
    if (err?.code === "TRIP_COMPLETED" || msg === "trip_completed") return res.status(409).json({ error: "trip_completed" });
    console.error("driver.trip.stage failed", err);
    return res.status(500).json({ error: "failed", details: err?.message || String(err) });
  }
}) as RequestHandler);

/**
 * GET /api/driver/trips/:id
 * Full detail for a single trip — accessible if the driver is assigned to it or has a claim on it.
 * Returns the shape the driver app's TripDetail screen consumes (stageHistory, assignmentSource, etc.).
 * Must be registered AFTER all /prefix routes to avoid shadowing them.
 */
router.get("/:id", limitDriverTripsList, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const parsed = idParamSchema.safeParse(req.params);
    if (!parsed.success) return badRequest(res, "Invalid trip ID", parsed.error.flatten());
    const tripId = parsed.data.id;

    const booking = await prisma.transportBooking.findUnique({
      where: { id: tripId },
      include: {
        user: { select: { id: true, name: true, phone: true, email: true } },
        claims: {
          where: { driverId: user.id },
          select: { id: true, status: true, createdAt: true },
          take: 1,
        } as any,
        _count: { select: { messages: true, driverLocationPings: true } } as any,
      },
    });

    if (!booking) return res.status(404).json({ error: "Trip not found" });

    const isAssigned = booking.driverId === user.id;
    const hasClaim = ((booking as any).claims?.length ?? 0) > 0;
    if (!isAssigned && !hasClaim) {
      return res.status(403).json({ error: "You do not have access to this trip" });
    }

    const pickup = booking.fromAddress || booking.pickupLocation || booking.fromRegion || null;
    const dropoff = booking.toAddress || booking.toRegion || null;
    const pickupLat = (booking as any).fromLatitude != null ? Number((booking as any).fromLatitude) : null;
    const pickupLng = (booking as any).fromLongitude != null ? Number((booking as any).fromLongitude) : null;
    const dropoffLat = (booking as any).toLatitude != null ? Number((booking as any).toLatitude) : null;
    const dropoffLng = (booking as any).toLongitude != null ? Number((booking as any).toLongitude) : null;

    let assignmentSource: "ADMIN" | "AUTO" = "AUTO";
    let stageHistory: Array<{ stage: string; at: string }> = [];
    try {
      if ((prisma as any).auditLog) {
        const last = await (prisma as any).auditLog.findFirst({
          where: {
            entity: "TRANSPORT_BOOKING",
            entityId: tripId,
            action: { in: ["TRANSPORT_ADMIN_ASSIGN_DRIVER", "TRANSPORT_ASSIGN_DRIVER"] },
          },
          orderBy: { createdAt: "desc" },
        });
        if (last) {
          const action = String((last as any)?.action ?? "");
          const actorRole = String((last as any)?.actorRole ?? "").toUpperCase();
          if (action === "TRANSPORT_ADMIN_ASSIGN_DRIVER") assignmentSource = "ADMIN";
          else if (action === "TRANSPORT_ASSIGN_DRIVER") assignmentSource = actorRole === "ADMIN" ? "ADMIN" : "AUTO";
        }

        const stageLogs = await (prisma as any).auditLog.findMany({
          where: {
            entity: "TRANSPORT_BOOKING",
            entityId: tripId,
            action: "TRANSPORT_TRIP_STAGE_UPDATE",
          },
          orderBy: { createdAt: "asc" },
          select: { afterJson: true, createdAt: true },
        });
        const seenStages = new Set<string>();
        stageHistory = stageLogs
          .map((log: any) => ({ stage: String(log.afterJson?.stage || ""), at: new Date(log.createdAt).toISOString() }))
          .filter((entry: { stage: string }) => {
            if (!entry.stage || seenStages.has(entry.stage)) return false;
            seenStages.add(entry.stage);
            return true;
          });
      }
    } catch {
      // ignore
    }

    const claim = ((booking as any).claims?.[0]) ?? null;

    return res.json({
      id: booking.id,
      status: booking.status ?? null,
      scheduledDate: booking.scheduledDate ? new Date(booking.scheduledDate).toISOString() : null,
      pickupTime: booking.pickupTime ? new Date(booking.pickupTime).toISOString() : null,
      dropoffTime: booking.dropoffTime ? new Date(booking.dropoffTime).toISOString() : null,
      pickup,
      dropoff,
      pickupAddress: pickup,
      dropoffAddress: dropoff,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      passengerUserId: (booking as any).user?.id ?? booking.userId,
      passengerName: (booking as any).user?.name ?? null,
      phoneNumber: (booking as any).user?.phone ?? null,
      tripCode: booking.tripCode ?? null,
      amount: booking.amount != null ? Number(booking.amount) : null,
      currency: booking.currency ?? null,
      paymentStatus: booking.paymentStatus ?? null,
      notes: booking.notes ?? null,
      requiredLanguage: (booking as any).requiredLanguage ?? null,
      createdAt: booking.createdAt ? new Date(booking.createdAt).toISOString() : null,
      updatedAt: booking.updatedAt ? new Date(booking.updatedAt).toISOString() : null,
      messagesCount: (booking as any)._count?.messages ?? 0,
      locationPingsCount: (booking as any)._count?.driverLocationPings ?? 0,
      assignmentSource,
      stageHistory,
      claim: claim ? { id: claim.id, status: claim.status, createdAt: claim.createdAt } : null,
      isAssigned,
    });
  } catch (error: any) {
    console.error("GET /driver/trips/:id error:", error);
    return res.status(500).json({ error: "Failed to fetch trip" });
  }
}) as RequestHandler);

export default router;


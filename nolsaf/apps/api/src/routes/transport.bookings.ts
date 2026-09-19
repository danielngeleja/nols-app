import { Router, type Request, type Response } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import {
  customerRecordReference,
  isCustomerRecordReference,
  matchesCustomerRecordReference,
} from "../lib/customerBookingReference.js";
import { z } from "zod";
import { sanitizeText } from "../lib/sanitize.js";
import { limitTransportBooking } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";
import { calculateETA, validateCoordinates } from "../lib/mapbox.js";
import { generateTransportTripCode } from "../lib/tripCode.js";
import { computeTransportFare } from "../lib/transportPolicy.js";

export const router = Router();

/**
 * POST /api/public/transport-bookings
 * Create a new transport booking (public, no auth required for guest bookings)
 * Body: {
 *   userId?: number, // Optional if guest booking
 *   guestName?: string,
 *   guestPhone?: string,
 *   guestEmail?: string,
 *   propertyId?: number,
 *   vehicleType: "BODA" | "BAJAJI" | "CAR" | "XL" | "PREMIUM",
 *   scheduledDate: string, // ISO date string
 *   fromLatitude: number,
 *   fromLongitude: number,
 *   fromAddress: string,
 *   toLatitude: number,
 *   toLongitude: number,
 *   toAddress: string,
 *   amount: number,
 *   arrivalType?: "FLIGHT" | "BUS" | "TRAIN" | "FERRY" | "OTHER",
 *   arrivalNumber?: string, // Flight number, bus number, train number, etc.
 *   transportCompany?: string, // Airline, bus company, train operator, etc.
 *   arrivalTime?: string, // ISO date string
 *   pickupLocation?: string, // Pickup location description (e.g., "JNIA Terminal 1", "Ubungo Bus Terminal")
 *   numberOfPassengers?: number,
 *   notes?: string,
 *   requiredLanguage?: string // e.g. "sw", "en" - language the passenger wants the driver to speak
 * }
 */
router.post("/", limitTransportBooking, async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      userId: z.number().optional(),
      guestName: z.string().optional(),
      guestPhone: z.string().optional(),
      guestEmail: z.string().email().optional(),
      propertyId: z.number().optional(),
      vehicleType: z.enum(["BODA", "BAJAJI", "CAR", "XL", "PREMIUM"]),
      scheduledDate: z.string().datetime(),
      fromLatitude: z.number().min(-90).max(90), // Validate latitude range
      fromLongitude: z.number().min(-180).max(180), // Validate longitude range
      fromAddress: z.string().min(1).max(255),
      toLatitude: z.number().min(-90).max(90), // Validate latitude range
      toLongitude: z.number().min(-180).max(180), // Validate longitude range
      toAddress: z.string().min(1).max(255),
      // amount is intentionally NOT accepted from the client — server computes it from distance + vehicle type.
      arrivalType: z.enum(["FLIGHT", "BUS", "TRAIN", "FERRY", "OTHER"]).optional(),
      arrivalNumber: z.string().optional(),
      transportCompany: z.string().optional(),
      arrivalTime: z.string().datetime().optional(),
      pickupLocation: z.string().optional(),
      numberOfPassengers: z.number().int().positive().max(20).default(1), // Max 20 passengers
      notes: z.string().optional(),
      // Language the passenger would like the driver to speak, e.g. "sw", "en"
      requiredLanguage: z.string().min(1).max(40).optional(),
    });

    const data = schema.parse(req.body);

    // Determine userId - if not provided, try to find by email/phone
    let userId = data.userId;
    if (!userId) {
      if (data.guestEmail) {
        const user = await prisma.user.findUnique({
          where: { email: data.guestEmail },
        });
        if (user) userId = user.id;
      } else if (data.guestPhone) {
        const user = await prisma.user.findUnique({
          where: { phone: data.guestPhone },
        });
        if (user) userId = user.id;
      }
    }

    // If still no userId and no guest info, return error
    if (!userId && !data.guestName && !data.guestPhone) {
      res.status(400).json({ error: "User ID or guest information required" });
      return;
    }

    // Validate coordinates
    if (!validateCoordinates(data.fromLongitude, data.fromLatitude)) {
      res.status(400).json({ error: "Invalid from coordinates" });
      return;
    }
    if (!validateCoordinates(data.toLongitude, data.toLatitude)) {
      res.status(400).json({ error: "Invalid to coordinates" });
      return;
    }

    // Calculate ETA and distance — also used below to compute the authoritative fare.
    let estimatedDistance: number | null = null;
    let estimatedDuration: number | null = null;
    let estimatedDurationTypical: number | null = null;
    
    try {
      const scheduledDate = new Date(data.scheduledDate);
      const etaResult = await calculateETA(
        { lng: data.fromLongitude, lat: data.fromLatitude },
        { lng: data.toLongitude, lat: data.toLatitude },
        scheduledDate
      );
      
      if (etaResult) {
        estimatedDistance = etaResult.distance;
        estimatedDuration = etaResult.duration;
        estimatedDurationTypical = etaResult.durationTypical;
      }
    } catch (etaError) {
      console.warn("Failed to calculate ETA for transport booking:", etaError);
      // Don't fail the booking if ETA calculation fails
    }

    // ── Server-side fare computation ─────────────────────────────────────────
    // Client-supplied amount is never trusted. The fare is derived exclusively
    // from the Mapbox road distance (or haversine fallback) + vehicle rates.
    const serverFare = computeTransportFare(
      data.vehicleType,
      estimatedDistance,
      {
        fromLat: data.fromLatitude, fromLon: data.fromLongitude,
        toLat:   data.toLatitude,   toLon:   data.toLongitude,
      },
    );

    // Create transport booking (generate strong tripCode for reconciliation/invoicing)
    let booking: any = null;

    for (let attempt = 0; attempt < 5; attempt++) {
      const { tripCode, tripCodeHash } = generateTransportTripCode();

      try {
        booking = await prisma.transportBooking.create({
          data: {
            userId: userId || 0, // Temporary: will need to create guest user or handle differently
            propertyId: data.propertyId || null,
            status: "PENDING_ASSIGNMENT",
            vehicleType: data.vehicleType,
            scheduledDate: new Date(data.scheduledDate),
            fromLatitude: data.fromLatitude,
            fromLongitude: data.fromLongitude,
            fromAddress: sanitizeText(data.fromAddress),
            toLatitude: data.toLatitude,
            toLongitude: data.toLongitude,
            toAddress: sanitizeText(data.toAddress),
            amount: serverFare,
            currency: "TZS",
            arrivalType: data.arrivalType || null,
            arrivalNumber: data.arrivalNumber || null,
            transportCompany: data.transportCompany || null,
            arrivalTime: data.arrivalTime ? new Date(data.arrivalTime) : null,
            pickupLocation: data.pickupLocation ? sanitizeText(data.pickupLocation) : null,
            numberOfPassengers: data.numberOfPassengers || 1,
            notes: data.notes ? sanitizeText(data.notes) : null,
            requiredLanguage: data.requiredLanguage ? sanitizeText(data.requiredLanguage) : null,
            paymentStatus: "PENDING",
            tripCode,
            tripCodeHash,
          },
          include: {
            user: { select: { id: true, name: true, email: true, phone: true } },
            property: { select: { id: true, title: true } },
          },
        });
        break;
      } catch (e: any) {
        const isUnique = e?.code === "P2002" || String(e?.message ?? "").includes("Unique constraint");
        if (isUnique && attempt < 4) continue;
        throw e;
      }
    }

    if (!booking) {
      throw new Error("Failed to create transport booking (trip code generation)");
    }

    // Audit log for transport booking creation
    try {
      await audit(req, "TRANSPORT_BOOKING_CREATED", `transport-booking:${booking.id}`, null, {
        bookingId: booking.id,
        vehicleType: booking.vehicleType,
        scheduledDate: booking.scheduledDate,
        amount: serverFare,
        userId: booking.userId,
        guestName: data.guestName,
        guestPhone: data.guestPhone,
        guestEmail: data.guestEmail,
      });
    } catch (auditError) {
      console.warn("Failed to create audit log for transport booking:", auditError);
      // Don't fail the request if audit logging fails
    }

    // NOTE: do not broadcast transport offers here.
    // The transport auto-dispatch worker issues targeted offers (top drivers) based on live locations.

    res.status(201).json({
      id: booking.id,
      status: booking.status,
      vehicleType: booking.vehicleType,
      scheduledDate: booking.scheduledDate,
      amount: serverFare,
      currency: "TZS",
      // Include calculated route data if available
      ...(estimatedDistance !== null && estimatedDuration !== null && {
        estimatedDistance: Math.round(estimatedDistance / 1000 * 100) / 100, // km, 2 decimals
        estimatedDuration: Math.round(estimatedDuration / 60), // minutes
        estimatedDurationTypical: estimatedDurationTypical ? Math.round(estimatedDurationTypical / 60) : null, // minutes (traffic-aware)
      }),
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request", details: error.issues });
    }
    console.error("POST /transport-bookings error:", error);
    return res.status(500).json({ error: "Failed to create transport booking" });
  }
});

/**
 * GET /api/transport-bookings/:id
 * Get transport booking details (requires auth - driver, passenger, or admin)
 */
router.get("/:id", requireAuth as RequestHandler, (async (req: AuthedRequest, res: Response) => {
  try {
    const user = req.user!;
    const requestedId = String(req.params.id || "").trim();
    let bookingId = /^\d+$/.test(requestedId) ? Number(requestedId) : NaN;

    if (isCustomerRecordReference(requestedId, "ride")) {
      const candidates = await prisma.transportBooking.findMany({
        where: { userId: user.id },
        select: { id: true },
      });
      bookingId = candidates.find(({ id }) => matchesCustomerRecordReference(requestedId, "ride", id))?.id ?? NaN;
    }

    if (!Number.isFinite(bookingId)) {
      res.status(400).json({ error: "Invalid booking ID" });
      return;
    }

    const booking = await prisma.transportBooking.findUnique({
      where: { id: bookingId },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        driver: {
          select: {
            id: true, name: true, email: true, phone: true,
            avatarUrl: true,
            plateNumber: true,
            vehiclePlate: true,
            vehicleType: true,
            vehicleMake: true,
            rating: true,
            isVipDriver: true,
            operationArea: true,
            district: true,
            region: true,
          },
        },
        property: { select: { id: true, title: true, regionName: true, district: true } },
      },
    });

    if (!booking) {
      res.status(404).json({ error: "Transport booking not found" });
      return;
    }

    // Verify user has access
    const isPassenger = booking.userId === user.id;
    const isDriver = booking.driverId === user.id;
    const isAdmin = user.role === "ADMIN";

    if (!isPassenger && !isDriver && !isAdmin) {
      res.status(403).json({ error: "Unauthorized" });
      return;
    }

    res.json({
      id: booking.id,
      rideReference: customerRecordReference("ride", booking.id),
      status: booking.status,
      vehicleType: booking.vehicleType,
      scheduledDate: booking.scheduledDate,
      pickupTime: booking.pickupTime,
      dropoffTime: booking.dropoffTime,
      fromAddress: booking.fromAddress,
      fromLatitude: booking.fromLatitude,
      fromLongitude: booking.fromLongitude,
      toAddress: booking.toAddress,
      toLatitude: booking.toLatitude,
      toLongitude: booking.toLongitude,
      amount: booking.amount,
      currency: booking.currency,
      arrivalType: booking.arrivalType,
      arrivalNumber: booking.arrivalNumber,
      transportCompany: booking.transportCompany,
      arrivalTime: booking.arrivalTime,
      pickupLocation: booking.pickupLocation,
      numberOfPassengers: booking.numberOfPassengers,
      notes: booking.notes,
      user: booking.user,
      driver: booking.driver,
      property: booking.property,
      paymentStatus: booking.paymentStatus,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    });
  } catch (error: any) {
    console.error("GET /transport-bookings/:id error:", error);
    res.status(500).json({ error: "Failed to fetch transport booking" });
  }
}) as RequestHandler);

export default router;


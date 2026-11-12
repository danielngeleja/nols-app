/**
 * @fileoverview Group Booking API Routes
 * @module routes/groupBookings
 * 
 * Provides REST API endpoints for managing group accommodation bookings.
 * Handles creation, retrieval, updates, and status management of group bookings.
 * 
 * @requires authentication All routes require user authentication
 */

import { Router, type RequestHandler, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { sanitizeText } from "../lib/sanitize.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import {
  CreateGroupBookingInput,
  UpdateGroupBookingStatusInput,
  GroupBookingQueryInput,
  type PassengerInput,
} from "../schemas/groupBookingSchemas.js";
import { z } from "zod";

const AUTO_RECEIVED_MESSAGE =
  "Thanks for posting your group stay request on NoLSAF! It is now open for verified property owners in your destination area to bid with their best offers. Our team is reviewing the responses and will share the top picks here so you can pick the one that suits your group best. We appreciate your patience!";

const router = Router();

function parseGroupBookingRouteDate(value: string): Date {
  const trimmed = String(value || "").trim();
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  return new Date(trimmed);
}

// Apply authentication middleware to all routes in this router
router.use(requireAuth as RequestHandler);

/**
 * @route POST /api/group-bookings
 * @description Create a new group booking
 * @access Private - Requires authentication
 * 
 * @body {CreateGroupBookingInput} Group booking details including:
 *   - groupType: Type of group (family, workers, event, etc.)
 *   - origin: Optional origin location details
 *   - destination: Required destination location details
 *   - accommodation: Type, headcount, room configuration
 *   - dates: Check-in/check-out dates (optional if flexible)
 *   - arrangements: Additional services (pickup, transport, meals, etc.)
 *   - roster: Array of passenger details
 * 
 * @returns {201} Successfully created group booking with booking ID
 * @returns {400} Validation error or invalid input
 * @returns {401} Unauthorized - authentication required
 * @returns {500} Server error during booking creation
 */
const createGroupBooking: RequestHandler = async (req, res) => {
  const r = req as AuthedRequest;
  
  try {
    // Validate request body against schema
    const validatedInput = CreateGroupBookingInput.parse(req.body);
    
    // Extract user from authenticated request
    const userId = r.user!.id;
    
    // Calculate duration if dates are provided
    let duration: number | null = null;
    if (validatedInput.checkin && validatedInput.checkout) {
      const checkInDate = parseGroupBookingRouteDate(validatedInput.checkin);
      const checkOutDate = parseGroupBookingRouteDate(validatedInput.checkout);
      duration = Math.ceil((checkOutDate.getTime() - checkInDate.getTime()) / (1000 * 60 * 60 * 24));
    }
    
    // Create group booking with nested passenger creation
    const groupBooking = await (prisma as any).groupBooking.create({
      data: {
        // User association
        userId,
        
        // Group details
        groupType: validatedInput.groupType,
        
        // Origin information
        fromCountry: validatedInput.fromCountry || null,
        fromRegion: validatedInput.fromRegion || null,
        fromDistrict: validatedInput.fromDistrict || null,
        fromWard: validatedInput.fromWard || null,
        fromLocation: validatedInput.fromLocation || null,
        
        // Destination information
        toRegion: validatedInput.toRegion,
        toDistrict: validatedInput.toDistrict || null,
        toWard: validatedInput.toWard || null,
        toLocation: validatedInput.toLocation || null,
        
        // Accommodation details
        accommodationType: validatedInput.accommodationType,
        minHotelStarLabel: validatedInput.accommodationType === "hotel" ? (validatedInput.minHotelStarLabel ?? null) : null,
        headcount: validatedInput.headcount,
        maleCount: validatedInput.maleCount ?? null,
        femaleCount: validatedInput.femaleCount ?? null,
        otherCount: validatedInput.otherCount ?? null,
        roomSize: validatedInput.roomSize,
        roomsNeeded: validatedInput.roomsNeeded,
        needsPrivateRoom: validatedInput.needsPrivateRoom,
        privateRoomCount: validatedInput.privateRoomCount,
        
        // Date information
        checkIn: validatedInput.checkin ? parseGroupBookingRouteDate(validatedInput.checkin) : null,
        checkOut: validatedInput.checkout ? parseGroupBookingRouteDate(validatedInput.checkout) : null,
        useDates: validatedInput.useDates ?? true,
        
        // Arrangement details
        arrPickup: validatedInput.arrangements.pickup,
        arrTransport: validatedInput.arrangements.transport,
        arrMeals: validatedInput.arrangements.meals,
        arrGuide: validatedInput.arrangements.guide,
        arrEquipment: validatedInput.arrangements.equipment,
        pickupLocation: validatedInput.arrangements.pickupLocation || null,
        pickupTime: validatedInput.arrangements.pickupTime || null,
        arrangementNotes: validatedInput.arrangements.notes || null,
        
        // Store roster as JSON for quick access
        roster: validatedInput.roster as any,
        
        // Initial status
        status: "PENDING",
        currency: "TZS",
      },
      // Include user details in response
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });
    
    // Optionally create individual passenger records for structured querying
    if (validatedInput.roster && validatedInput.roster.length > 0) {
      await (prisma as any).groupBookingPassenger.createMany({
        data: validatedInput.roster.map((passenger: PassengerInput, index: number) => ({
          groupBookingId: groupBooking.id,
          firstName: passenger.firstname,
          lastName: passenger.lastname,
          phone: passenger.phone || null,
          age: passenger.age ? parseInt(passenger.age, 10) : null,
          gender: passenger.gender || null,
          nationality: passenger.nationality || null,
          sequenceNumber: index + 1,
        })),
        skipDuplicates: true,
      });
    }

    // Auto-send "application received" message (system) so the customer immediately sees confirmation.
    // Best-effort: should never block booking creation.
    try {
      const sanitizedBody = sanitizeText(AUTO_RECEIVED_MESSAGE);

      await (prisma as any).groupBookingMessage.create({
        data: {
          groupBookingId: groupBooking.id,
          senderId: null,
          senderRole: "SYSTEM",
          senderName: "NoLSaf",
          messageType: "APPLICATION_RECEIVED",
          body: sanitizedBody,
          isInternal: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      await notifyUser(groupBooking.userId, "group_stay_update", {
        bookingId: groupBooking.id,
        status: groupBooking.status,
        title: "Booking request received",
        body: AUTO_RECEIVED_MESSAGE,
        message: AUTO_RECEIVED_MESSAGE,
      });

      // Best-effort realtime emit (if Socket.IO is configured)
      try {
        const io = (req.app as any)?.get?.("io") || (global as any).io;
        if (io && typeof io.to === "function") {
          io.to(`user:${groupBooking.userId}`).emit("group-booking:message:new", {
            groupBookingId: groupBooking.id,
            senderRole: "SYSTEM",
            message: sanitizedBody,
            messageType: "APPLICATION_RECEIVED",
            createdAt: new Date().toISOString(),
          });

          io.to("admin").emit("group-booking:message:new", {
            groupBookingId: groupBooking.id,
            senderRole: "SYSTEM",
            message: sanitizedBody,
            messageType: "APPLICATION_RECEIVED",
            createdAt: new Date().toISOString(),
          });
        }
      } catch {
        // ignore socket failures
      }
    } catch (e) {
      console.warn("[GroupBooking] Failed to send auto-received message:", e);
    }
    
    // The admin inbox gets every new request: someone has to invite owners to bid.
    void notifyAdmins("group_stay_request_created", {
      groupBookingId: groupBooking.id,
      customerName: (req as AuthedRequest).user?.name || null,
      headcount: groupBooking.headcount ?? null,
      destination: [groupBooking.toDistrict, groupBooking.toRegion].filter(Boolean).join(", ") || null,
      checkIn: groupBooking.checkIn ? new Date(groupBooking.checkIn).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : null,
      href: "/admin/group-stays/bookings",
    }).catch(() => undefined);

    // Log successful creation
    console.log(`[GroupBooking] Created booking #${groupBooking.id} for user #${userId}`);
    
    // Return successful response
    return (res as Response).status(201).json({
      success: true,
      bookingId: groupBooking.id,
      booking: {
        id: groupBooking.id,
        groupType: groupBooking.groupType,
        accommodationType: groupBooking.accommodationType,
        minHotelStarLabel: (groupBooking as any).minHotelStarLabel ?? null,
        destination: {
          region: groupBooking.toRegion,
          district: groupBooking.toDistrict,
          ward: groupBooking.toWard,
          location: groupBooking.toLocation,
        },
        headcount: groupBooking.headcount,
        status: groupBooking.status,
        passengerCount: validatedInput.roster.length,
        checkIn: groupBooking.checkIn,
        checkOut: groupBooking.checkOut,
        duration,
        createdAt: groupBooking.createdAt,
      },
      message: "Group booking created successfully",
    });
  } catch (error) {
    // Handle Zod validation errors
    if (error instanceof z.ZodError) {
      console.error("[GroupBooking] Validation error:", error.issues);
      return (res as Response).status(400).json({
        success: false,
        error: "Validation failed",
        details: error.issues.map((err) => ({
          field: err.path.join("."),
          message: err.message,
        })),
      });
    }
    
    // Handle database errors
    if ((error as any).code === "P2002") {
      console.error("[GroupBooking] Database constraint violation:", error);
      return (res as Response).status(409).json({
        success: false,
        error: "Duplicate booking detected",
        message: "A similar booking already exists",
      });
    }
    
    // Handle generic errors
    console.error("[GroupBooking] Creation error:", error);
    return (res as Response).status(500).json({
      success: false,
      error: "Failed to create group booking",
      message: error instanceof Error ? error.message : "Unknown error occurred",
    });
  }
};

/**
 * @route GET /api/group-bookings
 * @description Retrieve list of group bookings with optional filtering
 * @access Private - Returns only user's own bookings (unless admin)
 * 
 * @query {GroupBookingQueryInput} Optional filters:
 *   - status: Filter by booking status
 *   - groupType: Filter by group type
 *   - region: Filter by destination region
 *   - dateFrom: Filter bookings from this date
 *   - dateTo: Filter bookings until this date
 *   - page: Page number for pagination (default: 1)
 *   - pageSize: Items per page (default: 20, max: 100)
 * 
 * @returns {200} List of group bookings with pagination metadata
 * @returns {400} Invalid query parameters
 * @returns {401} Unauthorized
 * @returns {500} Server error
 */
const getGroupBookings: RequestHandler = async (req, res) => {
  const r = req as AuthedRequest;
  
  try {
    // Parse and validate query parameters
    const query = GroupBookingQueryInput.parse(req.query);
    
    // Build where clause for filtering
    const where: any = {
      userId: r.user!.id, // Only return user's own bookings
    };
    
    if (query.status) {
      where.status = query.status;
    }
    
    if (query.groupType) {
      where.groupType = query.groupType;
    }
    
    if (query.region) {
      where.toRegion = query.region;
    }
    
    if (query.dateFrom || query.dateTo) {
      where.checkIn = {};
      if (query.dateFrom) {
        where.checkIn.gte = new Date(query.dateFrom);
      }
      if (query.dateTo) {
        where.checkIn.lte = new Date(query.dateTo);
      }
    }
    
    // Calculate pagination
    const skip = (query.page - 1) * query.pageSize;
    const take = query.pageSize;
    
    // Execute queries in parallel
    const [bookings, totalCount] = await Promise.all([
      (prisma as any).groupBooking.findMany({
        where,
        skip,
        take,
        orderBy: {
          createdAt: "desc",
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          passengers: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
            take: 5, // Limit passengers in list view
          },
        },
      }),
      (prisma as any).groupBooking.count({ where }),
    ]);
    
    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / query.pageSize);
    
    return (res as Response).json({
      success: true,
      data: bookings,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: totalCount,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPrevPage: query.page > 1,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return (res as Response).status(400).json({
        success: false,
        error: "Invalid query parameters",
        details: error.issues,
      });
    }
    
    console.error("[GroupBooking] Retrieval error:", error);
    return (res as Response).status(500).json({
      success: false,
      error: "Failed to retrieve group bookings",
    });
  }
};

/**
 * @route GET /api/group-bookings/:id
 * @description Retrieve detailed information about a specific group booking
 * @access Private - User can only access their own bookings
 * 
 * @param {number} id - Group booking ID
 * 
 * @returns {200} Detailed group booking information including all passengers
 * @returns {401} Unauthorized
 * @returns {403} Forbidden - booking belongs to another user
 * @returns {404} Booking not found
 * @returns {500} Server error
 */
const getGroupBookingById: RequestHandler = async (req, res) => {
  const r = req as AuthedRequest;
  
  try {
    const bookingId = parseInt(req.params.id, 10);
    
    if (isNaN(bookingId)) {
      return (res as Response).status(400).json({
        success: false,
        error: "Invalid booking ID",
      });
    }
    
    const booking = await (prisma as any).groupBooking.findFirst({
      where: {
        id: bookingId,
        userId: r.user!.id, // Ensure user can only access their own bookings
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        passengers: {
          orderBy: {
            sequenceNumber: "asc",
          },
        },
      },
    });
    
    if (!booking) {
      return (res as Response).status(404).json({
        success: false,
        error: "Group booking not found",
      });
    }
    
    return (res as Response).json({
      success: true,
      data: booking,
    });
  } catch (error) {
    console.error("[GroupBooking] Retrieval by ID error:", error);
    return (res as Response).status(500).json({
      success: false,
      error: "Failed to retrieve group booking",
    });
  }
};

/**
 * @route PATCH /api/group-bookings/:id/status
 * @description Update the status of a group booking
 * @access Private - User can only update their own bookings
 * 
 * @param {number} id - Group booking ID
 * @body {UpdateGroupBookingStatusInput} Status update details
 * 
 * @returns {200} Successfully updated booking status
 * @returns {400} Invalid input
 * @returns {401} Unauthorized
 * @returns {403} Forbidden - booking belongs to another user
 * @returns {404} Booking not found
 * @returns {500} Server error
 */
const updateGroupBookingStatus: RequestHandler = async (req, res) => {
  const r = req as AuthedRequest;
  
  try {
    const bookingId = parseInt(req.params.id, 10);
    
    if (isNaN(bookingId)) {
      return (res as Response).status(400).json({
        success: false,
        error: "Invalid booking ID",
      });
    }
    
    const validatedInput = UpdateGroupBookingStatusInput.parse(req.body);
    
    // Verify booking exists and belongs to user
    const existing = await (prisma as any).groupBooking.findFirst({
      where: {
        id: bookingId,
        userId: r.user!.id,
      },
    });
    
    if (!existing) {
      return (res as Response).status(404).json({
        success: false,
        error: "Group booking not found",
      });
    }

    // A guest may only withdraw their own unpaid request. Confirming, completing
    // or reopening is NoLSAF's and the owner's job, and once money is paid a
    // cancellation must go through NoLSAF so any refund is recorded.
    if (validatedInput.status !== "CANCELED") {
      return (res as Response).status(403).json({ success: false, error: "Only NoLSAF can change this booking's status" });
    }
    if (existing.depositPaid || !["PENDING", "AWAITING_DEPOSIT", "EXPIRED"].includes(String(existing.status).toUpperCase())) {
      return (res as Response).status(409).json({ success: false, error: "This group stay is paid or in progress. Contact NoLSAF support to cancel it." });
    }

    // Guarded write: a payment landing between the read and here wins.
    const moved = await (prisma as any).groupBooking.updateMany({
      where: { id: bookingId, userId: r.user!.id, depositPaid: false, status: existing.status },
      data: { status: "CANCELED", cancelReason: validatedInput.cancelReason ?? null, canceledAt: new Date(), isOpenForClaims: false },
    });
    if (moved.count !== 1) {
      return (res as Response).status(409).json({ success: false, error: "This group stay changed. Refresh and try again." });
    }
    const updated = await (prisma as any).groupBooking.findUnique({ where: { id: bookingId } });
    
    console.log(`[GroupBooking] Updated booking #${bookingId} status to ${validatedInput.status}`);
    
    return (res as Response).json({
      success: true,
      data: updated,
      message: `Booking status updated to ${validatedInput.status}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return (res as Response).status(400).json({
        success: false,
        error: "Validation failed",
        details: error.issues,
      });
    }
    
    console.error("[GroupBooking] Status update error:", error);
    return (res as Response).status(500).json({
      success: false,
      error: "Failed to update booking status",
    });
  }
};

/**
 * @route DELETE /api/group-bookings/:id
 * @description Delete (cancel) a group booking
 * @access Private - User can only delete their own pending bookings
 * 
 * @param {number} id - Group booking ID
 * 
 * @returns {200} Successfully deleted booking
 * @returns {400} Cannot delete non-pending booking
 * @returns {401} Unauthorized
 * @returns {403} Forbidden
 * @returns {404} Booking not found
 * @returns {500} Server error
 */
const deleteGroupBooking: RequestHandler = async (req, res) => {
  const r = req as AuthedRequest;
  
  try {
    const bookingId = parseInt(req.params.id, 10);
    
    if (isNaN(bookingId)) {
      return (res as Response).status(400).json({
        success: false,
        error: "Invalid booking ID",
      });
    }
    
    // Verify booking exists and belongs to user
    const existing = await (prisma as any).groupBooking.findFirst({
      where: {
        id: bookingId,
        userId: r.user!.id,
      },
    });
    
    if (!existing) {
      return (res as Response).status(404).json({
        success: false,
        error: "Group booking not found",
      });
    }
    
    // Only allow deletion of pending bookings
    if (existing.status !== "PENDING") {
      return (res as Response).status(400).json({
        success: false,
        error: "Only pending bookings can be deleted",
        message: `Cannot delete booking with status: ${existing.status}`,
      });
    }
    
    // Soft delete by updating status to CANCELED. Guarded so a paid booking is never withdrawn here.
    const moved = await (prisma as any).groupBooking.updateMany({
      where: { id: bookingId, userId: r.user!.id, status: "PENDING", depositPaid: false },
      data: {
        status: "CANCELED",
        cancelReason: "Deleted by user",
        canceledAt: new Date(),
        isOpenForClaims: false,
      },
    });
    if (moved.count !== 1) {
      return (res as Response).status(409).json({ success: false, error: "This group stay changed. Refresh and try again." });
    }
    
    console.log(`[GroupBooking] Deleted booking #${bookingId}`);
    
    return (res as Response).json({
      success: true,
      message: "Group booking deleted successfully",
    });
  } catch (error) {
    console.error("[GroupBooking] Deletion error:", error);
    return (res as Response).status(500).json({
      success: false,
      error: "Failed to delete group booking",
    });
  }
};

// ==================== Route Registration ====================

router.post("/", createGroupBooking);
router.get("/", getGroupBookings);
router.get("/:id", getGroupBookingById);
router.patch("/:id/status", updateGroupBookingStatus);
router.delete("/:id", deleteGroupBooking);

export default router;

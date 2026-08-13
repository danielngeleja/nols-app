// apps/api/src/routes/owner.availability.ts
// Owner endpoints to manage property availability blocks
import { Router, type Request, type Response } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { sanitizeText } from "../lib/sanitize.js";
import { calculateAvailability } from "../lib/availabilityCalculator.js";
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES } from "../lib/bookingStatus.js";

// Helper to emit availability updates via Socket.IO
function emitAvailabilityUpdate(req: Request, propertyId: number, event: 'block_created' | 'block_updated' | 'block_deleted' | 'bulk_updated', data: any) {
  const io = (req as any).app?.get('io');
  if (!io) return;
  
  // Emit to property-specific room (owners/admins)
  io.to(`property:${propertyId}:availability`).emit('availability:update', {
    event,
    propertyId,
    data,
    timestamp: new Date().toISOString(),
  });
  
  // Emit to public room (for real-time availability checking)
  io.to(`property:${propertyId}:availability:public`).emit('availability:update', {
    event,
    propertyId,
    data,
    timestamp: new Date().toISOString(),
  });
}

export const router = Router();

router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler);

// Validation schemas
const createBlockSchema = z.object({
  propertyId: z.number().int().positive(),
  startDate: z.string().min(1).refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, {
    message: "Invalid start date format",
  }),
  endDate: z.string().min(1).refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, {
    message: "Invalid end date format",
  }),
  roomCode: z.string().max(60).optional().nullable(),
  source: z.string().max(50).optional().nullable(),
  guestName: z.string().max(160).optional().nullable(),
  guestPhone: z.string().max(40).optional().nullable(),
  nationality: z.string().max(80).optional().nullable(),
  roomRate: z.number().nonnegative().optional().nullable(),
  calculatedAmount: z.number().nonnegative().optional().nullable(),
  amountPaid: z.number().nonnegative().optional().nullable(),
  paidVia: z.enum(["CASH", "MOBILE"]).optional().nullable(),
  currency: z.string().max(8).optional().nullable(),
  bedsBlocked: z.number().int().positive().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const updateBlockSchema = z.object({
  startDate: z.string().min(1).refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, {
    message: "Invalid start date format",
  }).optional(),
  endDate: z.string().min(1).refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, {
    message: "Invalid end date format",
  }).optional(),
  roomCode: z.string().max(60).optional().nullable(),
  source: z.string().max(50).optional().nullable(),
  guestName: z.string().max(160).optional().nullable(),
  guestPhone: z.string().max(40).optional().nullable(),
  nationality: z.string().max(80).optional().nullable(),
  roomRate: z.number().nonnegative().optional().nullable(),
  calculatedAmount: z.number().nonnegative().optional().nullable(),
  amountPaid: z.number().nonnegative().optional().nullable(),
  paidVia: z.enum(["CASH", "MOBILE"]).optional().nullable(),
  currency: z.string().max(8).optional().nullable(),
  bedsBlocked: z.number().int().positive().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
});

const availabilityBlockExtraSelect: any = {
  guestName: true,
  guestPhone: true,
  nationality: true,
  roomRate: true,
  calculatedAmount: true,
  amountPaid: true,
  paidVia: true,
  currency: true,
};

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatAvailabilityBlock(block: any) {
  return {
    id: block.id,
    propertyId: block.propertyId,
    propertyTitle: block.property?.title,
    startDate: block.startDate,
    endDate: block.endDate,
    roomCode: block.roomCode,
    source: block.source,
    guestName: block.guestName ?? null,
    guestPhone: block.guestPhone ?? null,
    nationality: block.nationality ?? null,
    roomRate: decimalToNumber(block.roomRate),
    calculatedAmount: decimalToNumber(block.calculatedAmount),
    amountPaid: decimalToNumber(block.amountPaid),
    paidVia: block.paidVia ?? null,
    currency: block.currency ?? null,
    bedsBlocked: block.bedsBlocked,
    notes: block.notes,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

function cleanExternalBookingFields(data: z.infer<typeof createBlockSchema> | z.infer<typeof updateBlockSchema>) {
  return {
    guestName: data.guestName ? sanitizeText(data.guestName) : null,
    guestPhone: data.guestPhone ? sanitizeText(data.guestPhone) : null,
    nationality: data.nationality ? sanitizeText(data.nationality) : null,
    roomRate: data.roomRate != null ? data.roomRate : null,
    calculatedAmount: data.calculatedAmount != null ? data.calculatedAmount : null,
    amountPaid: data.amountPaid != null ? data.amountPaid : null,
    paidVia: data.paidVia ? sanitizeText(data.paidVia).toUpperCase() : null,
    currency: data.currency ? sanitizeText(data.currency).toUpperCase() : null,
  };
}

/**
 * GET /api/owner/availability/blocks
 * List all availability blocks for owner's properties
 * Query: propertyId?, startDate?, endDate?
 */
router.get("/blocks", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const { propertyId, startDate, endDate } = req.query;

    const where: any = {
      ownerId,
    };

    if (propertyId) {
      where.propertyId = Number(propertyId);
    }

    if (startDate || endDate) {
      where.AND = [];
      if (startDate) {
        where.AND.push({ endDate: { gte: new Date(String(startDate)) } });
      }
      if (endDate) {
        where.AND.push({ startDate: { lte: new Date(String(endDate)) } });
      }
    }

    const blocks = await prisma.propertyAvailabilityBlock.findMany({
      where,
      include: {
        property: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: {
        startDate: "asc",
      },
    });

    res.json({
      ok: true,
      blocks: blocks.map(formatAvailabilityBlock),
    });
  } catch (error: any) {
    console.error("GET /api/owner/availability/blocks error:", error);
    res.status(500).json({ error: "Failed to fetch availability blocks" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/availability/blocks
 * Create a new availability block
 */
router.post("/blocks", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const validationResult = createBlockSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: "Invalid request data",
        details: validationResult.error.issues,
      });
      return;
    }

    const data = validationResult.data;

    // Verify property belongs to owner
    const property = await prisma.property.findFirst({
      where: {
        id: data.propertyId,
        ownerId,
      },
    });

    if (!property) {
      res.status(404).json({ error: "Property not found or access denied" });
      return;
    }

    // Validate dates
    const startDate = new Date(data.startDate);
    const endDate = new Date(data.endDate);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      res.status(400).json({ error: "Invalid date format" });
      return;
    }

    if (endDate <= startDate) {
      res.status(400).json({ error: "End date must be after start date" });
      return;
    }

    // Reject past start dates
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (startDate < todayStart) {
      res.status(400).json({ error: "Cannot block past dates. Start date must be today or in the future." });
      return;
    }

    // Reject same-day blocks
    const startDay = new Date(startDate); startDay.setHours(0, 0, 0, 0);
    const endDay   = new Date(endDate);   endDay.setHours(0, 0, 0, 0);
    if (startDay.getTime() >= endDay.getTime()) {
      res.status(400).json({ error: "End date must be on a different day from start date. Same-day blocks are not allowed." });
      return;
    }

    // Conflict check: reject if active bookings overlap with the requested date range.
    const conflictingBookings = await prisma.booking.findMany({
      where: {
        propertyId: data.propertyId,
        status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
        AND: [{ checkIn: { lt: endDate } }, { checkOut: { gt: startDate } }],
        ...(data.roomCode ? { roomCode: data.roomCode } : {}),
      },
      select: { id: true, checkIn: true, checkOut: true, status: true, guestName: true, roomCode: true },
    });

    if (conflictingBookings.length > 0) {
      res.status(409).json({
        error: "CONFLICT_BOOKINGS",
        message: "There are active bookings overlapping with this date range. Cancel or modify those bookings before blocking.",
        conflictingBookings: conflictingBookings.map((b) => ({
          id: b.id,
          checkIn: b.checkIn.toISOString(),
          checkOut: b.checkOut.toISOString(),
          status: b.status,
          guestName: b.guestName,
          roomCode: b.roomCode,
        })),
      });
      return;
    }

    // Duplicate block check: warn but allow — overlapping blocks are redundant, not harmful.
    // (Frontend surfaces this as a warning via check-conflicts before the user reaches this POST.)

    // Capacity check: do not allow booked+blocked to exceed total registered rooms for this type.
    // Single calculateAvailability call (no roomType filter) returns all room types at once,
    // avoiding a second sequential DB call when we need to list alternatives.
    if (data.roomCode) {
      const roomType = (data.roomCode || "").replace(/-\d+$/, "") || data.roomCode || "";
      const all = await calculateAvailability(data.propertyId, startDate, endDate, null, undefined, {});
      const rt =
        all.byRoomType[roomType] ??
        Object.entries(all.byRoomType).find(([k]) => k.toLowerCase() === (roomType || "").toLowerCase())?.[1];
      const beds = data.bedsBlocked ?? 1;
      const roomsLeft = rt?.availableRooms ?? 0;
      if (rt && beds > roomsLeft) {
        const otherRoomTypes = Object.entries(all.byRoomType)
          .filter(([k, v]) => v.availableRooms > 0 && k.toLowerCase() !== (roomType || "").toLowerCase())
          .map(([k, v]) => ({ type: k, roomsLeft: v.availableRooms }));
        res.status(400).json({
          error: "ROOMS_AT_CAPACITY",
          message: "The room(s) you intend to assign are occupied on the selected dates.",
          roomType,
          roomsLeft,
          totalRooms: rt.totalRooms,
          bookedRooms: rt.bookedRooms,
          blockedRooms: rt.blockedRooms,
          bedsRequested: beds,
          otherRoomTypes,
        });
        return;
      }
    }

    const externalBookingFields = cleanExternalBookingFields(data);

    // Create block
    const block = await prisma.propertyAvailabilityBlock.create({
      data: {
        propertyId: data.propertyId,
        ownerId,
        startDate,
        endDate,
        roomCode: data.roomCode ? sanitizeText(data.roomCode) : null,
        source: data.source ? sanitizeText(data.source) : null,
        ...externalBookingFields,
        bedsBlocked: data.bedsBlocked || 1,
        notes: data.notes ? sanitizeText(data.notes) : null,
      } as any,
      include: {
        property: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    const blockData = formatAvailabilityBlock(block);

    // Emit Socket.IO event for real-time updates
    emitAvailabilityUpdate(req, data.propertyId, 'block_created', blockData);

    res.status(201).json({
      ok: true,
      block: blockData,
    });
  } catch (error: any) {
    console.error("POST /api/owner/availability/blocks error:", error);
    res.status(500).json({ error: "Failed to create availability block" });
  }
}) as RequestHandler);

/**
 * PUT /api/owner/availability/blocks/:id
 * Update an availability block
 */
router.put("/blocks/:id", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const blockId = Number(req.params.id);

    if (!blockId || isNaN(blockId)) {
      res.status(400).json({ error: "Invalid block ID" });
      return;
    }

    const validationResult = updateBlockSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: "Invalid request data",
        details: validationResult.error.issues,
      });
      return;
    }

    const data = validationResult.data;

    // Verify block belongs to owner
    const existingBlock = await prisma.propertyAvailabilityBlock.findFirst({
      where: {
        id: blockId,
        ownerId,
      },
    });

    if (!existingBlock) {
      res.status(404).json({ error: "Availability block not found or access denied" });
      return;
    }

    // Prepare update data
    const updateData: any = {};

    if (data.startDate !== undefined) {
      const startDate = new Date(data.startDate);
      if (isNaN(startDate.getTime())) {
        res.status(400).json({ error: "Invalid start date format" });
        return;
      }
      updateData.startDate = startDate;
    }

    if (data.endDate !== undefined) {
      const endDate = new Date(data.endDate);
      if (isNaN(endDate.getTime())) {
        res.status(400).json({ error: "Invalid end date format" });
        return;
      }
      updateData.endDate = endDate;
    }

    // Validate date range if both are being updated
    if (updateData.startDate && updateData.endDate) {
      if (updateData.endDate <= updateData.startDate) {
        res.status(400).json({ error: "End date must be after start date" });
        return;
      }
    } else if (updateData.startDate && existingBlock.endDate) {
      if (existingBlock.endDate <= updateData.startDate) {
        res.status(400).json({ error: "End date must be after start date" });
        return;
      }
    } else if (updateData.endDate && existingBlock.startDate) {
      if (updateData.endDate <= existingBlock.startDate) {
        res.status(400).json({ error: "End date must be after start date" });
        return;
      }
    }

    if (data.roomCode !== undefined) {
      updateData.roomCode = data.roomCode ? sanitizeText(data.roomCode) : null;
    }
    if (data.source !== undefined) {
      updateData.source = data.source ? sanitizeText(data.source) : null;
    }
    if (data.guestName !== undefined) updateData.guestName = data.guestName ? sanitizeText(data.guestName) : null;
    if (data.guestPhone !== undefined) updateData.guestPhone = data.guestPhone ? sanitizeText(data.guestPhone) : null;
    if (data.nationality !== undefined) updateData.nationality = data.nationality ? sanitizeText(data.nationality) : null;
    if (data.roomRate !== undefined) updateData.roomRate = data.roomRate;
    if (data.calculatedAmount !== undefined) updateData.calculatedAmount = data.calculatedAmount;
    if (data.amountPaid !== undefined) updateData.amountPaid = data.amountPaid;
    if (data.paidVia !== undefined) updateData.paidVia = data.paidVia ? sanitizeText(data.paidVia).toUpperCase() : null;
    if (data.currency !== undefined) updateData.currency = data.currency ? sanitizeText(data.currency).toUpperCase() : null;
    if (data.bedsBlocked !== undefined) {
      updateData.bedsBlocked = data.bedsBlocked;
    }
    if (data.notes !== undefined) {
      updateData.notes = data.notes ? sanitizeText(data.notes) : null;
    }

    // Capacity check when block has roomCode: do not exceed total registered rooms
    const effectiveRoomCode = data.roomCode !== undefined ? (data.roomCode ? sanitizeText(data.roomCode) : null) : existingBlock.roomCode;
    const effectiveBeds = data.bedsBlocked ?? existingBlock.bedsBlocked ?? 1;
    const effectiveStart = updateData.startDate ?? existingBlock.startDate;
    const effectiveEnd = updateData.endDate ?? existingBlock.endDate;
    if (effectiveRoomCode && effectiveEnd > effectiveStart) {
      const roomType = (effectiveRoomCode || "").replace(/-\d+$/, "") || effectiveRoomCode || "";
      const all = await calculateAvailability(
        existingBlock.propertyId,
        effectiveStart,
        effectiveEnd,
        null,
        undefined,
        { excludeBlockId: blockId }
      );
      const rt =
        all.byRoomType[roomType] ??
        Object.entries(all.byRoomType).find(([k]) => k.toLowerCase() === (roomType || "").toLowerCase())?.[1];
      const roomsLeft = rt?.availableRooms ?? 0;
      if (rt && effectiveBeds > roomsLeft) {
        const otherRoomTypes = Object.entries(all.byRoomType)
          .filter(([k, v]) => v.availableRooms > 0 && k.toLowerCase() !== (roomType || "").toLowerCase())
          .map(([k, v]) => ({ type: k, roomsLeft: v.availableRooms }));
        res.status(400).json({
          error: "ROOMS_AT_CAPACITY",
          message: "The room(s) you intend to assign are occupied on the selected dates.",
          roomType,
          roomsLeft,
          totalRooms: rt.totalRooms,
          bookedRooms: rt.bookedRooms,
          blockedRooms: rt.blockedRooms,
          bedsRequested: effectiveBeds,
          otherRoomTypes,
        });
        return;
      }
    }

    // Update block
    const block = await prisma.propertyAvailabilityBlock.update({
      where: { id: blockId },
      data: updateData as any,
      include: {
        property: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    const blockData = formatAvailabilityBlock(block);

    // Emit Socket.IO event for real-time updates
    emitAvailabilityUpdate(req, existingBlock.propertyId, 'block_updated', blockData);

    res.json({
      ok: true,
      block: blockData,
    });
  } catch (error: any) {
    console.error("PUT /api/owner/availability/blocks/:id error:", error);
    res.status(500).json({ error: "Failed to update availability block" });
  }
}) as RequestHandler);

/**
 * DELETE /api/owner/availability/blocks/:id
 * Delete an availability block
 */
router.delete("/blocks/:id", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const blockId = Number(req.params.id);

    if (!blockId || isNaN(blockId)) {
      res.status(400).json({ error: "Invalid block ID" });
      return;
    }

    // Verify block belongs to owner
    const block = await prisma.propertyAvailabilityBlock.findFirst({
      where: {
        id: blockId,
        ownerId,
      },
    });

    if (!block) {
      res.status(404).json({ error: "Availability block not found or access denied" });
      return;
    }

    // Delete block
    await prisma.propertyAvailabilityBlock.delete({
      where: { id: blockId },
    });

    // Emit Socket.IO event for real-time updates
    emitAvailabilityUpdate(req, block.propertyId, 'block_deleted', { id: blockId });

    res.json({
      ok: true,
      message: "Availability block deleted successfully",
    });
  } catch (error: any) {
    console.error("DELETE /api/owner/availability/blocks/:id error:", error);
    res.status(500).json({ error: "Failed to delete availability block" });
  }
}) as RequestHandler);

/**
 * GET /api/owner/availability/calendar
 * Get availability calendar view for a property with bookings and blocks
 * Query: propertyId, startDate, endDate, roomCode?
 */
router.get("/calendar", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user?.id;
    if (!ownerId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { propertyId, startDate, endDate, roomCode } = req.query;

    if (!propertyId) {
      res.status(400).json({ error: "propertyId is required" });
      return;
    }

    const propertyIdNum = Number(propertyId);
    if (isNaN(propertyIdNum)) {
      res.status(400).json({ error: "Invalid propertyId" });
      return;
    }

    // Verify property belongs to owner
    const property = await prisma.property.findFirst({
      where: {
        id: propertyIdNum,
        ownerId,
      },
      select: {
        id: true,
        title: true,
        currency: true,
        basePrice: true,
        roomsSpec: true,
      },
    });

    if (!property) {
      res.status(404).json({ error: "Property not found or access denied" });
      return;
    }

    // Parse date range (default to next 90 days if not provided)
    const start = startDate ? new Date(String(startDate)) : new Date();
    const end = endDate ? new Date(String(endDate)) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({ error: "Invalid date format" });
      return;
    }

    // Get all bookings in date range
    const bookings = await prisma.booking.findMany({
      where: {
        propertyId: propertyIdNum,
        status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
        AND: [
          { checkIn: { lt: end } },
          { checkOut: { gt: start } },
        ],
        ...(roomCode && { roomCode: String(roomCode) }),
      },
      select: {
        id: true,
        checkIn: true,
        checkOut: true,
        status: true,
        guestName: true,
        guestPhone: true,
        roomCode: true,
      },
      orderBy: { checkIn: "asc" },
    });

    // Get all availability blocks in date range
    const blocks = await prisma.propertyAvailabilityBlock.findMany({
      where: {
        propertyId: propertyIdNum,
        ownerId,
        AND: [
          { startDate: { lt: end } },
          { endDate: { gt: start } },
        ],
        ...(roomCode && { roomCode: String(roomCode) }),
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        roomCode: true,
        source: true,
        ...availabilityBlockExtraSelect,
        bedsBlocked: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { startDate: "asc" },
    });

    // Parse roomsSpec to get room types
    const roomsSpec = property.roomsSpec as any;
    const roomTypes = Array.isArray(roomsSpec) ? roomsSpec : [];

    res.json({
      ok: true,
      property: {
        id: property.id,
        title: property.title,
        roomTypes: roomTypes.map((r: any) => ({
          roomType: r.roomType || r.name || "Unknown",
          roomCode: r.roomCode || null,
          roomsCount: r.roomsCount || r.count || 0,
          basePrice: Number(r.pricePerNight ?? r.price ?? property.basePrice ?? 0) || null,
          currency: r.currency || property.currency || "TZS",
        })),
      },
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
      bookings: bookings.map((b) => ({
        id: b.id,
        checkIn: b.checkIn.toISOString(),
        checkOut: b.checkOut.toISOString(),
        status: b.status,
        guestName: b.guestName,
        guestPhone: b.guestPhone,
        roomCode: b.roomCode,
      })),
      blocks: blocks.map((b: any) => ({
        ...formatAvailabilityBlock(b),
        propertyTitle: property.title,
        startDate: b.startDate.toISOString(),
        endDate: b.endDate.toISOString(),
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      })),
    });
  } catch (error: any) {
    console.error("GET /api/owner/availability/calendar error:", error);
    res.status(500).json({ error: "Failed to fetch availability calendar" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/availability/blocks/bulk
 * Create multiple availability blocks at once
 */
router.post("/blocks/bulk", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const bulkSchema = z.object({
      propertyId: z.number().int().positive(),
      blocks: z.array(createBlockSchema.omit({ propertyId: true })),
    });

    const validationResult = bulkSchema.safeParse(req.body);

    if (!validationResult.success) {
      res.status(400).json({
        error: "Invalid request data",
        details: validationResult.error.issues,
      });
      return;
    }

    const { propertyId, blocks } = validationResult.data;

    // Verify property belongs to owner
    const property = await prisma.property.findFirst({
      where: {
        id: propertyId,
        ownerId,
      },
    });

    if (!property) {
      res.status(404).json({ error: "Property not found or access denied" });
      return;
    }

    // Validate all blocks
    const validatedBlocks = blocks.map((block) => {
      const startDate = new Date(block.startDate);
      const endDate = new Date(block.endDate);

      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        throw new Error(`Invalid date format in block`);
      }

      if (endDate <= startDate) {
        throw new Error(`End date must be after start date in block`);
      }

      return {
        propertyId,
        ownerId,
        startDate,
        endDate,
        roomCode: block.roomCode ? sanitizeText(block.roomCode) : null,
        source: block.source ? sanitizeText(block.source) : null,
        ...cleanExternalBookingFields(block),
        bedsBlocked: block.bedsBlocked || 1,
        notes: block.notes ? sanitizeText(block.notes) : null,
      };
    });

    // Create all blocks in a transaction
    const createdBlocks = await prisma.$transaction(
      validatedBlocks.map((data) =>
        prisma.propertyAvailabilityBlock.create({
          data: data as any,
          include: {
            property: {
              select: {
                id: true,
                title: true,
              },
            },
          },
        })
      )
    );

    const blocksData = createdBlocks.map((block) => ({
      ...formatAvailabilityBlock(block),
    }));

    // Emit Socket.IO event for real-time updates
    emitAvailabilityUpdate(req, propertyId, 'bulk_updated', { blocks: blocksData });

    res.status(201).json({
      ok: true,
      created: createdBlocks.length,
      blocks: blocksData,
    });
  } catch (error: any) {
    console.error("POST /api/owner/availability/blocks/bulk error:", error);
    res.status(500).json({ error: error.message || "Failed to create availability blocks" });
  }
}) as RequestHandler);

/**
 * GET /api/owner/availability/check-conflicts
 * Check for conflicts before creating/updating a block
 * Uses conflict avoidance principles:
 * - Date overlap detection (existingStart < requestedEnd AND existingEnd > requestedStart)
 * - Room type specificity (roomCode matching)
 * - Active booking status filtering (payment-confirmed/arrival-active bookings only)
 * - External booking blocks (all blocks are active)
 * 
 * Query: propertyId, startDate, endDate, roomCode?, excludeBlockId?
 */
router.get("/check-conflicts", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const { propertyId, startDate, endDate, roomCode, excludeBlockId } = req.query;

    if (!propertyId || !startDate || !endDate) {
      res.status(400).json({ error: "propertyId, startDate, and endDate are required" });
      return;
    }

    const propertyIdNum = Number(propertyId);
    const start = new Date(String(startDate));
    const end = new Date(String(endDate));

    if (isNaN(propertyIdNum) || isNaN(start.getTime()) || isNaN(end.getTime())) {
      res.status(400).json({ error: "Invalid propertyId or date format" });
      return;
    }

    if (end <= start) {
      res.status(400).json({ error: "End date must be after start date" });
      return;
    }

    // Verify property belongs to owner
    const property = await prisma.property.findFirst({
      where: {
        id: propertyIdNum,
        ownerId,
      },
    });

    if (!property) {
      res.status(404).json({ error: "Property not found or access denied" });
      return;
    }

    // Check for conflicting bookings
    const conflictingBookings = await prisma.booking.findMany({
      where: {
        propertyId: propertyIdNum,
        status: { in: [...AVAILABILITY_BLOCKING_BOOKING_STATUSES] },
        AND: [
          { checkIn: { lt: end } },
          { checkOut: { gt: start } },
        ],
        ...(roomCode && { roomCode: String(roomCode) }),
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
    });

    // Check for conflicting blocks
    const conflictingBlocks = await prisma.propertyAvailabilityBlock.findMany({
      where: {
        propertyId: propertyIdNum,
        AND: [
          { startDate: { lt: end } },
          { endDate: { gt: start } },
        ],
        ...(roomCode && { roomCode: String(roomCode) }),
        ...(excludeBlockId && { id: { not: Number(excludeBlockId) } }),
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

    const hasConflicts = conflictingBookings.length > 0 || conflictingBlocks.length > 0;

    res.json({
      ok: true,
      hasConflicts,
      conflictingBookings: conflictingBookings.map((b) => ({
        id: b.id,
        checkIn: b.checkIn.toISOString(),
        checkOut: b.checkOut.toISOString(),
        status: b.status,
        guestName: b.guestName,
        roomCode: b.roomCode,
        totalAmount: b.totalAmount ? Number(b.totalAmount) : 0,
      })),
      conflictingBlocks: conflictingBlocks.map((b) => ({
        id: b.id,
        startDate: b.startDate.toISOString(),
        endDate: b.endDate.toISOString(),
        roomCode: b.roomCode,
        source: b.source,
        bedsBlocked: b.bedsBlocked,
      })),
    });
  } catch (error: any) {
    console.error("GET /api/owner/availability/check-conflicts error:", error);
    res.status(500).json({ error: "Failed to check conflicts" });
  }
}) as RequestHandler);

/**
 * GET /api/owner/availability/summary
 * Get availability summary for a property (available/booked/blocked counts)
 * Query: propertyId, startDate?, endDate?, roomCode?, roomType?
 * Uses comprehensive availability calculator with conflict avoidance principles
 */
router.get("/summary", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const { propertyId, startDate, endDate, roomCode, roomType } = req.query;

    if (!propertyId) {
      res.status(400).json({ error: "propertyId is required" });
      return;
    }

    const propertyIdNum = Number(propertyId);
    if (isNaN(propertyIdNum)) {
      res.status(400).json({ error: "Invalid propertyId" });
      return;
    }

    // Verify property belongs to owner
    const property = await prisma.property.findFirst({
      where: {
        id: propertyIdNum,
        ownerId,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!property) {
      res.status(404).json({ error: "Property not found or access denied" });
      return;
    }

    // Parse date range (default to next 30 days if not provided)
    const start = startDate ? new Date(String(startDate)) : new Date();
    const end = endDate ? new Date(String(endDate)) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Use comprehensive availability calculator
    const calculation = await calculateAvailability(
      propertyIdNum,
      start,
      end,
      roomCode ? String(roomCode) : null,
      roomType ? String(roomType) : undefined
    );

    res.json({
      ok: true,
      property: {
        id: property.id,
        title: property.title,
      },
      dateRange: {
        start: calculation.dateRange.startDate.toISOString(),
        end: calculation.dateRange.endDate.toISOString(),
        nights: calculation.dateRange.nights,
      },
      summary: calculation.summary,
      byRoomType: calculation.byRoomType,
      hasConflicts: calculation.hasConflicts,
    });
  } catch (error: any) {
    console.error("GET /api/owner/availability/summary error:", error);
    res.status(500).json({ error: error.message || "Failed to fetch availability summary" });
  }
}) as RequestHandler);

/**
 * GET /api/owner/availability/calculate
 * Get detailed availability calculation with all bookings and blocks
 * Query: propertyId, startDate, endDate, roomCode?, roomType?, excludeBlockId?
 * Returns comprehensive breakdown by room type with all conflicts
 */
router.get("/calculate", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const { propertyId, startDate, endDate, roomCode, roomType, excludeBlockId } = req.query;

    if (!propertyId || !startDate || !endDate) {
      res.status(400).json({ error: "propertyId, startDate, and endDate are required" });
      return;
    }

    const propertyIdNum = Number(propertyId);
    const excludeBlockIdNum = excludeBlockId ? Number(excludeBlockId) : undefined;
    const start = new Date(String(startDate));
    const end = new Date(String(endDate));

    if (isNaN(propertyIdNum) || isNaN(start.getTime()) || isNaN(end.getTime()) || (excludeBlockId !== undefined && isNaN(Number(excludeBlockIdNum)))) {
      res.status(400).json({ error: "Invalid propertyId or date format" });
      return;
    }

    // Verify property belongs to owner
    const property = await prisma.property.findFirst({
      where: {
        id: propertyIdNum,
        ownerId,
      },
      select: {
        id: true,
        title: true,
      },
    });

    if (!property) {
      res.status(404).json({ error: "Property not found or access denied" });
      return;
    }

    // Use comprehensive availability calculator
    const calculation = await calculateAvailability(
      propertyIdNum,
      start,
      end,
      roomCode ? String(roomCode) : null,
      roomType ? String(roomType) : undefined,
      excludeBlockIdNum ? { excludeBlockId: excludeBlockIdNum } : undefined
    );

    // Convert dates to ISO strings for JSON response
    const response = {
      ok: true,
      property: {
        id: property.id,
        title: property.title,
      },
      dateRange: {
        startDate: calculation.dateRange.startDate.toISOString(),
        endDate: calculation.dateRange.endDate.toISOString(),
        nights: calculation.dateRange.nights,
      },
      byRoomType: Object.fromEntries(
        Object.entries(calculation.byRoomType).map(([key, value]) => [
          key,
          {
            ...value,
            bookings: value.bookings.map(b => ({
              ...b,
              checkIn: b.checkIn.toISOString(),
              checkOut: b.checkOut.toISOString(),
            })),
          },
        ])
      ),
      summary: calculation.summary,
      conflicts: calculation.conflicts.map(c => ({
        ...c,
        startDate: c.startDate.toISOString(),
        endDate: c.endDate.toISOString(),
      })),
      hasConflicts: calculation.hasConflicts,
    };

    res.json(response);
  } catch (error: any) {
    console.error("GET /api/owner/availability/calculate error:", error);
    res.status(500).json({ error: error.message || "Failed to calculate availability" });
  }
}) as RequestHandler);

export default router;



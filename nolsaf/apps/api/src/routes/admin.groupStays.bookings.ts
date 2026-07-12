import { Router } from "express";
import type { RequestHandler } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { mapGroupStayLifecycle } from "../lib/serviceLifecycle.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

/** GET /admin/group-stays/bookings?status=&groupType=&region=&date=&start=&end=&page=&pageSize=&q= */
router.get("/", async (req, res) => {
  try {
    // Explicitly set Content-Type to JSON
    res.setHeader('Content-Type', 'application/json');
    
    const { status, groupType, region, date, start, end, page = "1", pageSize = "50", q = "" } = req.query as any;

    const where: any = {};

    // Filter by status - only if status is a non-empty string
    if (status && String(status).trim() !== '') {
      where.status = String(status).trim();
    }

    // Filter by group type - only if groupType is a non-empty string
    if (groupType && String(groupType).trim() !== '') {
      where.groupType = String(groupType).trim();
    }

    // Filter by region - only if region is a non-empty string
    if (region && String(region).trim() !== '') {
      where.toRegion = String(region).trim();
    }

    // Date filtering - only apply if dates are actually provided (not empty strings)
    if (date && String(date).trim() !== '') {
      const s = new Date(String(date).trim() + "T00:00:00.000Z");
      const e = new Date(String(date).trim() + "T23:59:59.999Z");
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        where.checkIn = { gte: s, lte: e };
      }
    } else if (start && end && String(start).trim() !== '' && String(end).trim() !== '') {
      // Only apply date range filter if both start and end are provided
      const s = new Date(String(start).trim() + "T00:00:00.000Z");
      const e = new Date(String(end).trim() + "T23:59:59.999Z");
      if (!isNaN(s.getTime()) && !isNaN(e.getTime())) {
        where.checkIn = { gte: s, lte: e };
      }
    }

    // Search query - only if q is a non-empty string
    if (q && String(q).trim() !== '') {
      // MySQL doesn't support `mode: "insensitive"`; rely on default CI collations.
      const search = String(q).trim().slice(0, 120);
      if (!search) {
        // no-op
      } else
      where.OR = [
        { user: { is: { name: { contains: search } } } },
        { user: { is: { email: { contains: search } } } },
        { toRegion: { contains: search } },
        { toDistrict: { contains: search } },
        { toLocation: { contains: search } },
      ];
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    // Build query - include user + confirmed property + a lead passenger snapshot
    const queryOptions: any = {
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
        confirmedProperty: {
          select: { id: true, title: true },
        },
        passengers: {
          select: { firstName: true, lastName: true, phone: true, gender: true, nationality: true, sequenceNumber: true },
          orderBy: [{ sequenceNumber: 'asc' }, { id: 'asc' }],
          take: 1,
        },
        claims: {
          where: { status: 'ACCEPTED' },
          select: {
            totalAmount: true,
            reviewedAt: true,
            property: { select: { id: true, title: true } },
          },
          orderBy: [{ reviewedAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    };

    // Only add where if it has conditions - if empty object, Prisma returns all
    if (Object.keys(where).length > 0) {
      queryOptions.where = where;
    }

    const countOptions: any = Object.keys(where).length > 0 ? { where } : {};

    const [items, total] = await Promise.all([
      (prisma as any).groupBooking.findMany(queryOptions),
      (prisma as any).groupBooking.count(countOptions),
    ]);

    const mapped = items.map((b: any) => {
      const leadPassenger = Array.isArray(b.passengers) && b.passengers.length > 0 ? b.passengers[0] : null;
      const acceptedClaim = Array.isArray(b.claims) && b.claims.length > 0 ? b.claims[0] : null;

      return {
      id: b.id,
      groupType: b.groupType || "other",
      accommodationType: b.accommodationType || "other",
      headcount: b.headcount || 0,
      maleCount: b.maleCount ?? null,
      femaleCount: b.femaleCount ?? null,
      otherCount: b.otherCount ?? null,
      roomsNeeded: b.roomsNeeded || 0,
      toRegion: b.toRegion || "N/A",
      toDistrict: b.toDistrict || null,
      toLocation: b.toLocation || null,
      checkIn: b.checkIn || null,
      checkOut: b.checkOut || null,
      status: b.status || "PENDING",
      // Amounts: expose both accepted claim amount and confirmed booking amount where available.
      acceptedTotalAmount: acceptedClaim?.totalAmount ?? null,
      confirmedTotalAmount: b.totalAmount ?? null,
      totalAmount: b.totalAmount ?? acceptedClaim?.totalAmount ?? null,
      currency: b.currency || "TZS",
      user: b.user ? {
        id: b.user.id,
        name: b.user.name || "Unknown User",
        email: b.user.email,
        phone: b.user.phone,
      } : null,
      leadPassenger: leadPassenger
        ? {
            name: `${leadPassenger.firstName ?? ''} ${leadPassenger.lastName ?? ''}`.trim() || null,
            phone: leadPassenger.phone ?? null,
            gender: leadPassenger.gender ?? null,
            nationality: leadPassenger.nationality ?? null,
          }
        : null,
      confirmedProperty: b.confirmedProperty ? { id: b.confirmedProperty.id, title: b.confirmedProperty.title } : null,
      acceptedProperty: acceptedClaim?.property ? { id: acceptedClaim.property.id, title: acceptedClaim.property.title } : null,
      acceptedAt: acceptedClaim?.reviewedAt ?? null,
      confirmedAt: b.confirmedAt ?? null,
      createdAt: b.createdAt,
      // Arrangements
      arrPickup: b.arrPickup || false,
      arrTransport: b.arrTransport || false,
      arrMeals: b.arrMeals || false,
      arrGuide: b.arrGuide || false,
      arrEquipment: b.arrEquipment || false,
    };
    });

    return res.json({ total, page: Number(page), pageSize: take, items: mapped });
  } catch (err: any) {
    // Ensure error responses are JSON
    res.setHeader('Content-Type', 'application/json');
    
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying group bookings:', err.message);
      const page = Number((req.query as any).page ?? 1);
      const pageSize = Math.min(Number((req.query as any).pageSize ?? 50), 100);
      return res.json({ total: 0, page, pageSize, items: [] });
    }
    console.error('Unhandled error in GET /admin/group-stays/bookings:', err);
    console.error('Error stack:', err?.stack);
    return res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

/** GET /admin/group-stays/bookings/stats?period=7d|30d|month|year */
router.get("/stats", async (req, res) => {
  try {
    // Explicitly set Content-Type to JSON
    res.setHeader('Content-Type', 'application/json');
    
    const { period = "30d" } = req.query as any;

    let startDate: Date;
    let endDate = new Date();
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

    // Get all bookings in the date range
    const bookings = await (prisma as any).groupBooking.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        createdAt: true,
        status: true,
        headcount: true,
      },
    });

    // Group by date
    const dateMap = new Map<string, { count: number; confirmed: number; totalHeadcount: number }>();

    bookings.forEach((b: any) => {
      const dateKey = new Date(b.createdAt).toISOString().split("T")[0];
      const existing = dateMap.get(dateKey) || { count: 0, confirmed: 0, totalHeadcount: 0 };
      existing.count += 1;
      if (b.status === "CONFIRMED" || b.status === "COMPLETED") {
        existing.confirmed += 1;
      }
      existing.totalHeadcount += Number(b.headcount) || 0;
      dateMap.set(dateKey, existing);
    });

    // Fill in all dates in range
    const stats: Array<{ date: string; count: number; confirmed: number; totalHeadcount: number }> = [];
    const current = new Date(startDate);
    while (current <= endDate) {
      const dateKey = current.toISOString().split("T")[0];
      const data = dateMap.get(dateKey) || { count: 0, confirmed: 0, totalHeadcount: 0 };
      stats.push({
        date: dateKey,
        ...data,
      });
      current.setDate(current.getDate() + 1);
    }

    return res.json({
      stats,
      period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });
  } catch (err: any) {
    console.error('Error in GET /admin/group-stays/bookings/stats:', err);
    console.error('Error stack:', err?.stack);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

/**
 * GET /admin/group-stays/bookings/earnings?filter=CHECKED_IN|ALL&page=&pageSize=
 * Read-only owner-earnings reference for confirmed group stays. NoLSAF's commission is the
 * deposit; the owner collects the balance (total minus deposit) from the guest at the property.
 * NoLSAF does not disburse to owners, so there is no action here. Registered before /:id so
 * "earnings" is not parsed as an id.
 */
router.get("/earnings", async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");

    const { filter = "CHECKED_IN", ownerId = "", q = "", page = "1", pageSize = "50" } = req.query as any;
    const filterUpper = String(filter).trim().toUpperCase();
    const where: any = { status: { in: ["CONFIRMED", "COMPLETED"] }, depositPaid: true };
    if (filterUpper === "CHECKED_IN") {
      where.checkedInAt = { not: null };
    }

    // Filter to a single owner by id, or fuzzy-search owners by name/email.
    const ownerIdNum = Number(ownerId);
    if (Number.isFinite(ownerIdNum) && ownerIdNum > 0) {
      where.assignedOwnerId = ownerIdNum;
    } else {
      where.assignedOwnerId = { not: null };
      const search = String(q).trim();
      if (search) {
        where.assignedOwner = { is: { OR: [{ name: { contains: search } }, { email: { contains: search } }] } };
      }
    }

    const skip = (Math.max(1, Number(page) || 1) - 1) * Math.min(Number(pageSize) || 50, 100);
    const take = Math.min(Number(pageSize) || 50, 100);

    const [items, total] = await Promise.all([
      (prisma as any).groupBooking.findMany({
        where,
        include: {
          assignedOwner: { select: { id: true, name: true, email: true, phone: true } },
          confirmedProperty: { select: { id: true, title: true } },
        },
        orderBy: [{ checkedInAt: "desc" }, { confirmedAt: "desc" }, { id: "desc" }],
        skip,
        take,
      }),
      (prisma as any).groupBooking.count({ where }),
    ]);

    // Best-effort: attach the guest's review of the confirmed property (matched by property + customer).
    const propertyIds = Array.from(new Set(items.map((b: any) => b.confirmedPropertyId).filter((v: any) => Number.isFinite(v))));
    const customerIds = Array.from(new Set(items.map((b: any) => b.userId).filter((v: any) => Number.isFinite(v))));
    const reviewByKey = new Map<string, any>();
    if (propertyIds.length > 0 && customerIds.length > 0) {
      const reviews = await (prisma as any).propertyReview.findMany({
        where: { propertyId: { in: propertyIds }, userId: { in: customerIds }, isHidden: false },
        select: { propertyId: true, userId: true, rating: true, title: true, comment: true, ownerResponse: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
      for (const rv of reviews) {
        const k = `${rv.propertyId}:${rv.userId}`;
        if (!reviewByKey.has(k)) reviewByKey.set(k, rv); // keep most recent per (property, customer)
      }
    }

    const mapped = items.map((b: any) => {
      const totalAmount = b.totalAmount != null ? Number(b.totalAmount) : 0;
      const depositAmount = b.depositAmount != null ? Number(b.depositAmount) : 0;
      const review = reviewByKey.get(`${b.confirmedPropertyId}:${b.userId}`) || null;
      return {
        id: b.id,
        toRegion: b.toRegion || null,
        toDistrict: b.toDistrict || null,
        checkIn: b.checkIn || null,
        checkOut: b.checkOut || null,
        checkedInAt: b.checkedInAt || null,
        currency: b.currency || "TZS",
        totalAmount,
        // NoLSAF commission is the deposit; the owner collects the rest at the property.
        commissionAmount: Math.round(depositAmount),
        ownerCollects: Math.max(0, Math.round(totalAmount - depositAmount)),
        assignedOwner: b.assignedOwner
          ? { id: b.assignedOwner.id, name: b.assignedOwner.name || "Owner", email: b.assignedOwner.email, phone: b.assignedOwner.phone }
          : null,
        confirmedProperty: b.confirmedProperty ? { id: b.confirmedProperty.id, title: b.confirmedProperty.title } : null,
        guestReview: review
          ? {
              rating: review.rating,
              title: review.title || null,
              comment: review.comment || null,
              ownerResponse: review.ownerResponse || null,
              createdAt: review.createdAt,
            }
          : null,
      };
    });

    return res.json({ total, page: Number(page) || 1, pageSize: take, items: mapped });
  } catch (err: any) {
    res.setHeader("Content-Type", "application/json");
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      return res.json({ total: 0, page: 1, pageSize: 50, items: [] });
    }
    console.error("Error in GET /admin/group-stays/bookings/earnings:", err);
    return res.status(500).json({ error: "Internal server error", message: err?.message || "Unknown error" });
  }
});

/**
 * GET /admin/group-stays/bookings/earnings/owners
 * Distinct owners who have confirmed group stays, with record counts (for the earnings filter).
 * Registered before /:id so the path is not parsed as an id.
 */
router.get("/earnings/owners", async (_req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");

    const grouped = await (prisma as any).groupBooking.groupBy({
      by: ["assignedOwnerId"],
      where: { status: { in: ["CONFIRMED", "COMPLETED"] }, depositPaid: true, assignedOwnerId: { not: null } },
      _count: { _all: true },
    });

    const ownerIds = grouped.map((g: any) => g.assignedOwnerId).filter((v: any) => Number.isFinite(v));
    const users = ownerIds.length
      ? await (prisma as any).user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true } })
      : [];
    const nameById = new Map<number, string>(users.map((u: any) => [u.id, u.name || ""]));

    const owners = grouped
      .map((g: any) => ({
        id: g.assignedOwnerId as number,
        name: nameById.get(g.assignedOwnerId) || "Deleted Owner",
        count: g._count?._all ?? 0,
      }))
      .sort((a: any, b: any) => b.count - a.count);

    return res.json({ owners });
  } catch (err: any) {
    res.setHeader("Content-Type", "application/json");
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      return res.json({ owners: [] });
    }
    console.error("Error in GET /admin/group-stays/bookings/earnings/owners:", err);
    return res.status(500).json({ error: "Internal server error", message: err?.message || "Unknown error" });
  }
});

/** GET /admin/group-stays/bookings/:id - Get single booking details */
router.get("/:id", async (req, res) => {
  try {
    // Explicitly set Content-Type to JSON
    res.setHeader('Content-Type', 'application/json');
    
    const id = Number(req.params.id);
    if (!id || isNaN(id)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    const booking = await (prisma as any).groupBooking.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });

    if (!booking) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(404).json({ error: "Booking not found" });
    }

    const mapped = {
      id: booking.id,
      groupType: booking.groupType || "other",
      accommodationType: booking.accommodationType || "other",
      headcount: booking.headcount || 0,
      maleCount: booking.maleCount ?? null,
      femaleCount: booking.femaleCount ?? null,
      otherCount: booking.otherCount ?? null,
      roomsNeeded: booking.roomsNeeded || 0,
      roomSize: booking.roomSize || 0,
      needsPrivateRoom: booking.needsPrivateRoom || false,
      privateRoomCount: booking.privateRoomCount || 0,
      toRegion: booking.toRegion || "N/A",
      toDistrict: booking.toDistrict || null,
      toLocation: booking.toLocation || null,
      checkIn: booking.checkIn || null,
      checkOut: booking.checkOut || null,
      status: booking.status || "PENDING",
      user: booking.user ? {
        id: booking.user.id,
        name: booking.user.name || "Unknown User",
        email: booking.user.email,
        phone: booking.user.phone,
      } : null,
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt || null,
      // Arrangements
      arrPickup: booking.arrPickup || false,
      arrTransport: booking.arrTransport || false,
      arrMeals: booking.arrMeals || false,
      arrGuide: booking.arrGuide || false,
      arrEquipment: booking.arrEquipment || false,
      // Additional fields that might exist
      pickupLocation: booking.pickupLocation || null,
      pickupTime: booking.pickupTime || null,
      arrangementNotes: booking.arrangementNotes || null,
      notes: booking.notes || null,
      // Property recommendations
      recommendedPropertyIds: booking.recommendedPropertyIds || null,
      confirmedPropertyId: booking.confirmedPropertyId || null,
      propertyConfirmedAt: booking.propertyConfirmedAt || null,
      // Admin notes/suggestions
      adminNotes: booking.adminNotes || null,
      // Financials: NoLSAF's commission is the deposit; the owner collects the balance at the property.
      totalAmount: booking.totalAmount != null ? Number(booking.totalAmount) : null,
      depositAmount: booking.depositAmount != null ? Number(booking.depositAmount) : null,
      depositPaid: booking.depositPaid || false,
      depositPaidAt: booking.depositPaidAt || null,
      depositDueAt: booking.depositDueAt || null,
      currency: booking.currency || "TZS",
      checkedInAt: booking.checkedInAt || null,
      lifecycle: mapGroupStayLifecycle({
        bookingStatus: booking.status,
        depositPaid: Boolean(booking.depositPaid),
        depositPaidAt: booking.depositPaidAt,
        depositAmount: booking.depositAmount,
        depositExpired: booking.status === "AWAITING_DEPOSIT" && !booking.depositPaid && Boolean(booking.depositDueAt) && new Date(booking.depositDueAt).getTime() < Date.now(),
        confirmedPropertyId: booking.confirmedPropertyId,
        cancellationLoaded: true,
      }),
    };

    return res.json(mapped);
  } catch (err: any) {
    // Ensure error responses are JSON
    res.setHeader('Content-Type', 'application/json');
    
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying group booking:', err.message);
      return res.status(404).json({ error: "Booking not found", message: err.message });
    }
    console.error('Error in GET /admin/group-stays/bookings/:id:', err);
    console.error('Error stack:', err?.stack);
    return res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

/** PATCH /admin/group-stays/bookings/:id - Update booking status, suggestions, or other fields */
router.patch("/:id", async (req: any, res) => {
  try {
    const bookingId = Number(req.params.id);
    const adminId = req.user!.id;
    const { status, adminSuggestions } = req.body;

    if (!bookingId || isNaN(bookingId)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    // Get current booking to track changes
    const currentBooking = await (prisma as any).groupBooking.findUnique({
      where: { id: bookingId },
      select: { id: true, status: true, userId: true },
    });

    if (!currentBooking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    const updateData: any = {};
    const auditEntries: any[] = [];
    let statusChangeNotification: { title: string; body: string } | null = null;

    // Update status if provided
    if (status && status !== currentBooking.status) {
      updateData.status = status;
      auditEntries.push({
        groupBookingId: bookingId,
        adminId,
        action: "STATUS_CHANGED",
        description: `Status changed from ${currentBooking.status} to ${status}`,
        metadata: {
          previousStatus: currentBooking.status,
          newStatus: status,
        },
      });

      // Set notification message based on status
      switch (status) {
        case "REVIEWING":
          statusChangeNotification = {
            title: "Your Group Stay is Under Review",
            body: "Thanks for posting your group stay request on NoLSAF! It is now open for verified property owners in your destination area to bid with their best offers. Our team is reviewing the responses and will share the top picks here so you can pick the one that suits your group best.",
          };
          break;
        case "PROCESSING":
          statusChangeNotification = {
            title: "Your Group Stay is Being Processed",
            body: "Great news! We're now processing your group stay booking. Our team is working on finding the best accommodation options for your group. We'll contact you shortly with recommendations and pricing details.",
          };
          break;
        case "CONFIRMED":
          statusChangeNotification = {
            title: "Your Group Stay is Confirmed",
            body: "Excellent! Your group stay booking has been confirmed. We've found suitable accommodation options for your group. Please review the recommendations we've sent and let us know if you'd like to proceed.",
          };
          break;
        case "COMPLETED":
          statusChangeNotification = {
            title: "Group Stay Completed",
            body: "Your group stay has been completed. Thank you for choosing NoLSaf! We hope you had a wonderful experience.",
          };
          break;
        case "CANCELED":
          statusChangeNotification = {
            title: "Group Stay Canceled",
            body: "Your group stay booking has been canceled. If you have any questions, please contact our support team.",
          };
          break;
      }
    }

    // Update admin suggestions if provided
    if (adminSuggestions) {
      updateData.adminNotes = JSON.stringify(adminSuggestions);
      auditEntries.push({
        groupBookingId: bookingId,
        adminId,
        action: "SUGGESTIONS_PROVIDED",
        description: "Admin provided suggestions and recommendations to customer",
        metadata: {
          hasAccommodationOptions: !!adminSuggestions.accommodationOptions,
          hasPricing: !!adminSuggestions.pricing,
          hasRecommendations: !!adminSuggestions.recommendations,
          hasNextSteps: !!adminSuggestions.nextSteps,
        },
      });
    }

    // Update booking
    if (Object.keys(updateData).length > 0) {
      await (prisma as any).groupBooking.update({
        where: { id: bookingId },
        data: updateData,
      });

      // Create audit log entries
      for (const auditEntry of auditEntries) {
        try {
          await (prisma as any).groupBookingAudit.create({
            data: auditEntry,
          });
        } catch (auditErr) {
          console.error("Failed to create audit log:", auditErr);
          // Don't fail the request if audit logging fails
        }
      }

      // Send notification to user if status changed
      if (statusChangeNotification && currentBooking.userId) {
        try {
          const { notifyUser } = await import("../lib/notifications.js");
          await notifyUser(currentBooking.userId, "group_stay_update", {
            bookingId: bookingId,
            status: status,
            title: statusChangeNotification.title,
            body: statusChangeNotification.body,
          });

          // Also create a direct notification
          await (prisma as any).notification.create({
            data: {
              userId: currentBooking.userId,
              ownerId: null,
              title: statusChangeNotification.title,
              body: statusChangeNotification.body,
              unread: true,
              meta: {
                type: "group_stay",
                bookingId: bookingId,
                status: status,
              },
              type: "group_stay",
            },
          });

          // Emit real-time notification
          try {
            const io = (global as any).io;
            if (io && typeof io.to === "function") {
              io.to(`user:${currentBooking.userId}`).emit("notification:new", {
                title: statusChangeNotification.title,
                body: statusChangeNotification.body,
                type: "group_stay",
                bookingId: bookingId,
              });
            }
          } catch (ioErr) {
            // Ignore real-time errors
          }
        } catch (notifyErr) {
          console.error("Failed to send notification to user:", notifyErr);
          // Don't fail the request if notification fails
        }
      }
    }

    return res.json({
      success: true,
      message: "Booking updated successfully",
    });
  } catch (err: any) {
    console.error("Error in PATCH /admin/group-stays/bookings/:id:", err);
    console.error('Error stack:', err?.stack);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: "Failed to update booking", message: err?.message || 'Unknown error' });
  }
});

export default router;


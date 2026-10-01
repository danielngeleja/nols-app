import { Router } from "express";
import type { RequestHandler } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "@nolsaf/prisma";
import { adminBookingReference } from "../lib/adminBookingReference.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

type TransportBookingListItem = {
  kind: "group" | "individual";
  id: number;
  /** Opaque admin URL reference; individual bookings only. */
  reference?: string;
  groupType: string;
  toRegion: string;
  toLocation: string | null;
  fromRegion: string | null;
  fromLocation: string | null;
  checkIn: string | null;
  checkOut: string | null;
  useDates: boolean;
  headcount: number | null;
  roomsQty: number | null;
  status: string;
  totalAmount: number | null;
  currency: string | null;
  pickupLocation: string | null;
  pickupTime: string | null;
  arrangementNotes: string | null;
  createdAt: string;
  urgency: "urgent" | "later" | "specified" | "flexible";
  urgencyReason: string;
  user: {
    id: number | null;
    name: string | null;
    email: string | null;
    phone: string | null;
  };
};

type SortKey = "date" | "pickup" | "created" | "destination" | "customer" | "status" | "urgency";
type SortDir = "asc" | "desc";

function computeUrgency(useDates: boolean, checkIn: Date | string | null | undefined) {
  let urgency: "urgent" | "later" | "specified" | "flexible" = "flexible";
  let urgencyReason = "";

  if (useDates && checkIn) {
    const checkInDate = new Date(checkIn);
    const now = new Date();
    const daysUntil = Math.ceil((checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (daysUntil <= 7 && daysUntil >= 0) {
      urgency = "urgent";
      urgencyReason = `In ${daysUntil} day${daysUntil !== 1 ? "s" : ""}`;
    } else if (daysUntil > 7) {
      urgency = "later";
      urgencyReason = `In ${daysUntil} days`;
    } else if (daysUntil < 0) {
      urgency = "later";
      urgencyReason = "Past date";
    } else {
      urgency = "specified";
      urgencyReason = checkInDate.toLocaleDateString();
    }
  } else {
    urgency = "flexible";
    urgencyReason = "Flexible dates";
  }

  return { urgency, urgencyReason };
}

/**
 * GET /admin/users/transport-bookings
 * List customers who requested transport alongside their accommodation booking.
 * Includes both:
 * - Group stays (GroupBooking.arrTransport = true)
 * - Individual property bookings (Booking.includeTransport = true)
 */
router.get("/", async (req, res) => {
  try {
    const { page = "1", pageSize = "30", status, q, sort, dir } = req.query as any;
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.max(1, Math.min(100, Number(pageSize) || 30));

    const search = String(q || "").trim().slice(0, 120);
    const statusStr = status ? String(status) : "";

    const allowedSorts: SortKey[] = ["date", "pickup", "created", "destination", "customer", "status", "urgency"];
    const sortKey: SortKey = allowedSorts.includes(String(sort) as SortKey) ? (String(sort) as SortKey) : "date";
    const sortDir: SortDir = String(dir || "").toLowerCase() === "desc" ? "desc" : "asc";
    const sortMult = sortDir === "desc" ? -1 : 1;

    const whereGroup: any = {
      arrTransport: true,
      user: {
        role: "CUSTOMER",
      },
    };

    const whereBooking: any = {
      includeTransport: true,
      user: {
        role: "CUSTOMER",
      },
    };

    if (statusStr) {
      whereGroup.status = statusStr;
      whereBooking.status = statusStr;
    }

    if (search) {
      whereGroup.OR = [
        { user: { is: { name: { contains: search } } } },
        { user: { is: { email: { contains: search } } } },
        { user: { is: { phone: { contains: search } } } },
        { toRegion: { contains: search } },
        { toLocation: { contains: search } },
        { pickupLocation: { contains: search } },
      ];

      whereBooking.OR = [
        { user: { is: { name: { contains: search } } } },
        { user: { is: { email: { contains: search } } } },
        { user: { is: { phone: { contains: search } } } },
        { guestName: { contains: search } },
        { guestPhone: { contains: search } },
        { transportOriginAddress: { contains: search } },
        { property: { is: { title: { contains: search } } } },
        { property: { is: { regionName: { contains: search } } } },
        { property: { is: { district: { contains: search } } } },
        { property: { is: { city: { contains: search } } } },
      ];
    }

    const skip = (p - 1) * ps;
    // Sorting happens after merging group + individual results.
    // For non-default sorts, fetch a wider window so pagination remains meaningful.
    const takeTotal = sortKey === "date" ? Math.min(1000, skip + ps) : 1000;

    const [totalGroups, totalBookings, groups, bookings] = await Promise.all([
      (prisma as any).groupBooking.count({ where: whereGroup }),
      prisma.booking.count({ where: whereBooking }),
      (prisma as any).groupBooking.findMany({
        where: whereGroup,
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
        orderBy: [{ useDates: "desc" }, { checkIn: "asc" }, { createdAt: "desc" }],
        take: takeTotal,
      }),
      prisma.booking.findMany({
        where: whereBooking,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          property: {
            select: {
              id: true,
              title: true,
              regionName: true,
              district: true,
              city: true,
            },
          },
        },
        orderBy: [{ checkIn: "asc" }, { createdAt: "desc" }],
        take: takeTotal,
      }),
    ]);

    const groupItems: TransportBookingListItem[] = (groups || []).map((g: any) => {
      const { urgency, urgencyReason } = computeUrgency(Boolean(g.useDates), g.checkIn);
      return {
        kind: "group",
        id: Number(g.id),
        groupType: String(g.groupType || "group"),
        toRegion: String(g.toRegion || ""),
        toLocation: g.toLocation ?? null,
        fromRegion: g.fromRegion ?? null,
        fromLocation: g.fromLocation ?? null,
        checkIn: g.checkIn ? new Date(g.checkIn).toISOString() : null,
        checkOut: g.checkOut ? new Date(g.checkOut).toISOString() : null,
        useDates: Boolean(g.useDates),
        headcount: typeof g.headcount === "number" ? g.headcount : null,
        roomsQty: null,
        status: String(g.status || ""),
        totalAmount: g.totalAmount == null ? null : Number(g.totalAmount),
        currency: g.currency ?? null,
        pickupLocation: g.pickupLocation ?? null,
        pickupTime: g.pickupTime ?? null,
        arrangementNotes: g.arrangementNotes ?? null,
        createdAt: g.createdAt ? new Date(g.createdAt).toISOString() : new Date().toISOString(),
        urgency,
        urgencyReason,
        user: {
          id: g.user?.id ?? null,
          name: g.user?.name ?? null,
          email: g.user?.email ?? null,
          phone: g.user?.phone ?? null,
        },
      };
    });

    const bookingItems: TransportBookingListItem[] = (bookings || []).map((b: any) => {
      const { urgency, urgencyReason } = computeUrgency(true, b.checkIn);
      const pickupTime = b.transportScheduledDate ? new Date(b.transportScheduledDate).toISOString() : null;

      return {
        kind: "individual",
        id: Number(b.id),
        reference: adminBookingReference(Number(b.id)),
        groupType: "individual",
        toRegion: String(b.property?.regionName || ""),
        toLocation: b.property?.title ?? b.property?.city ?? null,
        fromRegion: null,
        fromLocation: b.transportOriginAddress ?? null,
        checkIn: b.checkIn ? new Date(b.checkIn).toISOString() : null,
        checkOut: b.checkOut ? new Date(b.checkOut).toISOString() : null,
        useDates: true,
        headcount: null,
        roomsQty: typeof b.roomsQty === "number" ? b.roomsQty : null,
        status: String(b.status || ""),
        totalAmount: b.totalAmount == null ? null : Number(b.totalAmount),
        currency: "TZS",
        pickupLocation: b.transportOriginAddress ?? null,
        pickupTime,
        arrangementNotes: b.transportVehicleType ?? null,
        createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : new Date().toISOString(),
        urgency,
        urgencyReason,
        user: {
          id: b.user?.id ?? (b.userId ?? null),
          name: b.user?.name ?? b.guestName ?? null,
          email: b.user?.email ?? null,
          phone: b.user?.phone ?? b.guestPhone ?? null,
        },
      };
    });

    const combined = [...groupItems, ...bookingItems];

    const urgencyRank: Record<TransportBookingListItem["urgency"], number> = {
      urgent: 0,
      specified: 1,
      later: 2,
      flexible: 3,
    };

    const toTime = (value: string | null | undefined) => {
      if (!value) return Number.POSITIVE_INFINITY;
      const t = new Date(value).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };

    const compareString = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

    combined.sort((a, b) => {
      let primary = 0;

      if (sortKey === "pickup") {
        primary = (toTime(a.pickupTime) - toTime(b.pickupTime)) * sortMult;
      } else if (sortKey === "created") {
        primary = (toTime(a.createdAt) - toTime(b.createdAt)) * sortMult;
      } else if (sortKey === "destination") {
        primary = compareString(String(a.toRegion || ""), String(b.toRegion || "")) * sortMult;
      } else if (sortKey === "customer") {
        primary = compareString(String(a.user?.name || ""), String(b.user?.name || "")) * sortMult;
      } else if (sortKey === "status") {
        primary = compareString(String(a.status || ""), String(b.status || "")) * sortMult;
      } else if (sortKey === "urgency") {
        primary = (urgencyRank[a.urgency] - urgencyRank[b.urgency]) * sortMult;
      } else {
        // default: "date" (check-in if available, else createdAt)
        const aSort = a.useDates && a.checkIn ? toTime(a.checkIn) : toTime(a.createdAt);
        const bSort = b.useDates && b.checkIn ? toTime(b.checkIn) : toTime(b.createdAt);
        primary = (aSort - bSort) * sortMult;
      }

      if (primary !== 0) return primary;

      // stable-ish tie-breakers
      const fallbackA = a.useDates && a.checkIn ? toTime(a.checkIn) : toTime(a.createdAt);
      const fallbackB = b.useDates && b.checkIn ? toTime(b.checkIn) : toTime(b.createdAt);
      if (fallbackA !== fallbackB) return fallbackA - fallbackB;
      return toTime(b.createdAt) - toTime(a.createdAt);
    });

    const pageItems = combined.slice(skip, skip + ps);

    res.json({
      items: pageItems,
      total: Number(totalGroups) + Number(totalBookings),
      page: p,
      pageSize: ps,
    });
  } catch (err) {
    console.error("admin.users.transportBookings error", err);
    res.status(500).json({ error: "failed" });
  }
});

export default router;


import { Router } from "express";
import type { RequestHandler } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "@nolsaf/prisma";
import { adminBookingReference } from "../lib/adminBookingReference.js";
import { adminRecordReferenceOrNull as recordRef } from "../lib/adminRecordReference.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

/**
 * GET /admin/users/transport-bookings?view=upcoming|past|cancelled|all&q=&page=&pageSize=
 *
 * Travellers who asked for transport with their stay, and whether that ride is
 * actually covered:
 * - Individual stays (Booking.includeTransport): the ride is the TransportBooking
 *   created with paymentRef "BOOKING:<id>"; its status and driver say where it stands.
 *   Unpaid (NEW) bookings are not listed; their ride is not real until payment.
 * - Group stays (GroupBooking.arrTransport): transport is arranged inside the
 *   Group Stay flow, so the row points there.
 */

type View = "upcoming" | "past" | "cancelled" | "all";
type RideState = "awaiting_payment" | "needs_driver" | "driver_assigned" | "in_progress" | "completed" | "cancelled" | "no_trip" | "group_flow";

const PAID_BOOKING = ["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN", "CHECKED_OUT", "CANCELED"];
const DAY = 86_400_000;

/** Start of today in East Africa Time (UTC+3), as a UTC instant. */
function startOfTodayEAT(now = new Date()) {
  const eat = new Date(now.getTime() + 3 * 3_600_000);
  return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate()) - 3 * 3_600_000);
}

function rideState(trip: { status: string; driverId: number | null } | undefined): RideState {
  if (!trip) return "no_trip";
  const s = String(trip.status || "").toUpperCase();
  if (s === "CANCELED" || s === "CANCELLED") return "cancelled";
  if (s === "COMPLETED") return "completed";
  if (s === "IN_PROGRESS") return "in_progress";
  if (s === "PAYMENT_PENDING") return "awaiting_payment";
  if (trip.driverId) return "driver_assigned";
  return "needs_driver";
}

router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim().slice(0, 120);
    const viewRaw = String(req.query.view ?? "upcoming");
    const view: View = (["upcoming", "past", "cancelled", "all"] as const).includes(viewRaw as View) ? (viewRaw as View) : "upcoming";
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize) || 25));

    const userSearch = q
      ? [{ user: { is: { name: { contains: q } } } }, { user: { is: { email: { contains: q } } } }, { user: { is: { phone: { contains: q } } } }]
      : null;

    const [groups, bookings] = await Promise.all([
      (prisma as any).groupBooking.findMany({
        where: {
          arrTransport: true,
          ...(userSearch ? { OR: [...userSearch, { toRegion: { contains: q } }, { toLocation: { contains: q } }, { pickupLocation: { contains: q } }] } : {}),
        },
        select: {
          id: true, groupType: true, toRegion: true, toLocation: true, fromRegion: true, fromLocation: true,
          checkIn: true, checkOut: true, useDates: true, headcount: true, status: true, pickupLocation: true, pickupTime: true, createdAt: true,
          user: { select: { id: true, name: true, fullName: true, email: true, phone: true } },
        },
        take: 2000,
        orderBy: { createdAt: "desc" },
      }),
      prisma.booking.findMany({
        where: {
          includeTransport: true,
          status: { in: PAID_BOOKING },
          ...(userSearch
            ? { OR: [...userSearch, { guestName: { contains: q } }, { guestPhone: { contains: q } }, { transportOriginAddress: { contains: q } }, { property: { is: { title: { contains: q } } } }, { property: { is: { regionName: { contains: q } } } }] }
            : {}),
        },
        select: {
          id: true, status: true, checkIn: true, checkOut: true, roomsQty: true, guestName: true, guestPhone: true,
          transportVehicleType: true, transportScheduledDate: true, transportOriginAddress: true, createdAt: true,
          user: { select: { id: true, name: true, fullName: true, email: true, phone: true } },
          property: { select: { title: true, regionName: true, district: true } },
        },
        take: 2000,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // The ride behind each individual booking.
    const trips = bookings.length
      ? await prisma.transportBooking.findMany({
          where: { paymentRef: { in: bookings.map((b) => `BOOKING:${b.id}`) } } as any,
          select: { status: true, driverId: true, scheduledDate: true, paymentRef: true, driver: { select: { name: true, fullName: true } } } as any,
        })
      : [];
    const tripByBooking = new Map<number, any>();
    for (const t of trips as any[]) {
      const id = Number(String(t.paymentRef || "").replace("BOOKING:", ""));
      if (Number.isFinite(id)) tripByBooking.set(id, t);
    }

    const today = startOfTodayEAT();
    const weekEnd = new Date(today.getTime() + 8 * DAY);

    type Row = {
      key: string;
      kind: "group" | "individual";
      href: string | null;
      customer: { ref: string | null; name: string | null; email: string | null; phone: string | null };
      to: { place: string | null; region: string | null };
      from: string | null;
      date: string | null;
      dateEnd: string | null;
      pickupAt: string | null;
      pickupNote: string | null;
      people: number | null;
      rooms: number | null;
      groupType: string | null;
      vehicle: string | null;
      bookingStatus: string;
      ride: { state: RideState; driver: string | null };
      when: "upcoming" | "past" | "cancelled";
      sortAt: number;
    };

    const rows: Row[] = [];

    for (const g of groups as any[]) {
      const date: Date | null = g.useDates && g.checkIn ? new Date(g.checkIn) : null;
      const cancelled = String(g.status).toUpperCase() === "CANCELED";
      const past = !cancelled && (String(g.status).toUpperCase() === "COMPLETED" || (date ? date < today : false));
      rows.push({
        key: `g:${recordRef("group-stay", g.id) ?? g.id}`,
        kind: "group",
        href: `/admin/group-stays/bookings?bookingId=${recordRef("group-stay", g.id) ?? ""}`,
        customer: { ref: recordRef("user", g.user?.id), name: (g.user?.fullName || g.user?.name || "").trim() || null, email: g.user?.email ?? null, phone: g.user?.phone ?? null },
        to: { place: g.toLocation ?? null, region: g.toRegion ?? null },
        from: [g.fromLocation, g.fromRegion].filter(Boolean).join(", ") || null,
        date: date ? date.toISOString() : null,
        dateEnd: g.useDates && g.checkOut ? new Date(g.checkOut).toISOString() : null,
        pickupAt: g.pickupTime ?? null,
        pickupNote: g.pickupLocation ?? null,
        people: typeof g.headcount === "number" ? g.headcount : null,
        rooms: null,
        groupType: g.groupType ?? null,
        vehicle: null,
        bookingStatus: String(g.status || ""),
        ride: { state: "group_flow", driver: null },
        when: cancelled ? "cancelled" : past ? "past" : "upcoming",
        sortAt: date ? date.getTime() : Number.POSITIVE_INFINITY,
      });
    }

    for (const b of bookings) {
      const trip = tripByBooking.get(b.id);
      const pickup = trip?.scheduledDate ?? b.transportScheduledDate ?? b.checkIn;
      const date = pickup ? new Date(pickup) : null;
      const status = String(b.status).toUpperCase();
      const cancelled = status === "CANCELED";
      const past = !cancelled && (status === "CHECKED_OUT" || (date ? date < today : false));
      rows.push({
        key: `b:${adminBookingReference(b.id)}`,
        kind: "individual",
        href: `/admin/bookings/${adminBookingReference(b.id)}`,
        customer: {
          ref: recordRef("user", b.user?.id),
          name: (b.user?.fullName || b.user?.name || b.guestName || "").trim() || null,
          email: b.user?.email ?? null,
          phone: b.user?.phone ?? b.guestPhone ?? null,
        },
        to: { place: b.property?.title ?? null, region: b.property?.regionName ?? null },
        from: b.transportOriginAddress ?? null,
        date: date ? date.toISOString() : null,
        dateEnd: b.checkOut ? new Date(b.checkOut).toISOString() : null,
        pickupAt: date ? date.toISOString() : null,
        pickupNote: null,
        people: null,
        rooms: typeof b.roomsQty === "number" ? b.roomsQty : null,
        groupType: null,
        vehicle: b.transportVehicleType ?? null,
        bookingStatus: status,
        ride: { state: cancelled ? "cancelled" : rideState(trip), driver: (trip?.driver?.fullName || trip?.driver?.name || "").trim() || null },
        when: cancelled ? "cancelled" : past ? "past" : "upcoming",
        sortAt: date ? date.getTime() : Number.POSITIVE_INFINITY,
      });
    }

    const upcoming = rows.filter((r) => r.when === "upcoming");
    const summary = {
      upcoming: upcoming.length,
      thisWeek: upcoming.filter((r) => r.date && new Date(r.date) < weekEnd).length,
      needsDriver: upcoming.filter((r) => r.ride.state === "needs_driver" || r.ride.state === "no_trip").length,
      groups: upcoming.filter((r) => r.kind === "group").length,
      past: rows.filter((r) => r.when === "past").length,
      cancelled: rows.filter((r) => r.when === "cancelled").length,
      all: rows.length,
    };

    const list = view === "all" ? rows : rows.filter((r) => r.when === view);
    // Upcoming: soonest first, dateless (flexible) last. Past and cancelled: most recent first.
    list.sort((a, b) => (view === "upcoming" ? a.sortAt - b.sortAt : (Number.isFinite(b.sortAt) ? b.sortAt : 0) - (Number.isFinite(a.sortAt) ? a.sortAt : 0)));

    const total = list.length;
    const items = list.slice((page - 1) * pageSize, page * pageSize).map(({ sortAt: _s, ...r }) => r);

    res.json({ summary, view, total, page, pageSize, items });
  } catch (err) {
    console.error("admin.users.transportBookings error", err);
    res.status(500).json({ error: "failed" });
  }
});

export default router;

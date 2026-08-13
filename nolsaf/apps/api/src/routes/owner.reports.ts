// apps/api/src/routes/owner.reports.ts
import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { addDays, eachDay, fmtKey, GroupBy, startOfDayTZ } from "../lib/reporting";
import { withCache, makeKey } from "../lib/cache";
import { getEffectiveCommissionPercent, extractOwnerPayoutFromAccommodationGross } from "../lib/accommodationPayout.js";
import { signOwnerReportPrintHandoff } from "../lib/ownerReportPrintHandoff.js";

// If you have generated Prisma types, replace these any aliases.
type Invoice = any;
type Booking = any;

import type { RequestHandler, Response } from 'express';
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("OWNER") as unknown as RequestHandler);

function ownerRevenueVisibilityClause() {
  return {
    OR: [
      { invoiceNumber: { startsWith: "OINV-" } },
      {
        AND: [
          { invoiceNumber: { startsWith: "INV-" } },
          { status: "PAID" },
        ],
      },
    ],
  };
}

router.get(
  "/print-token",
  asyncHandler(async (req, res) => {
    const r = req as AuthedRequest;
    const token = signOwnerReportPrintHandoff(r.user!.id);
    return res.json({ ok: true, token, expiresInSeconds: 5 * 60 });
  })
);

/** Parse common query params */
function parseQuery(q: any) {
  const now = new Date();
  let from: Date;
  let to: Date;
  
  try {
    from = q.from ? new Date(String(q.from)) : new Date(now.getFullYear(), now.getMonth(), 1);
    to = q.to ? new Date(String(q.to)) : now;
    
    // Validate dates
    if (isNaN(from.getTime())) {
      from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    if (isNaN(to.getTime())) {
      to = now;
    }
    
    // Ensure to is after from
    if (to < from) {
      const temp = from;
      from = to;
      to = temp;
    }
  } catch (err) {
    // Fallback to default dates on parse error
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = now;
  }

  // Enforce max report range (<= 12 months) for performance and consistency.
  // We treat input dates as day-granularity and allow up to 366 days inclusive.
  try {
    const MAX_DAYS_INCLUSIVE = 366;
    const from0 = startOfDayTZ(from);
    const to0 = startOfDayTZ(to);
    const dayDiff = Math.floor((to0.getTime() - from0.getTime()) / 864e5);
    if (dayDiff > MAX_DAYS_INCLUSIVE - 1) {
      to = addDays(from0, MAX_DAYS_INCLUSIVE - 1);
    }
  } catch {
    // ignore, keep parsed dates
  }
  
  const groupBy = (q.groupBy as GroupBy) || "day";
  const propertyId = q.propertyId ? Number(q.propertyId) : undefined;
  return { from, to, groupBy, propertyId };
}

/** -------------------------
 *  /owner/reports/overview
 *  ------------------------- */
router.get(
  "/overview",
  asyncHandler(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const r = req as AuthedRequest;
    const ownerId = r.user!.id;
    const { from, to, groupBy, propertyId } = parseQuery(req.query);

    const key = makeKey(ownerId, "overview", {
      v: 2,
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy,
      propertyId,
    });

    const data = await withCache(key, async () => {
      const rangeStart = startOfDayTZ(from);
      const rangeEndExclusive = addDays(startOfDayTZ(to), 1);
      const rangeEndInclusive = addDays(rangeEndExclusive, -1);

      const invoices: Invoice[] = await prisma.invoice.findMany({
        where: {
          AND: [ownerRevenueVisibilityClause()],
          ownerId,
          issuedAt: { gte: rangeStart, lt: rangeEndExclusive },
          ...(propertyId ? { booking: { propertyId } } : {}),
        },
        include: {
          booking: {
            select: {
              propertyId: true,
              property: { select: { id: true, title: true } },
            },
          },
        },
      });

      const bookings: Booking[] = await prisma.booking.findMany({
        where: {
          property: { ownerId, ...(propertyId ? { id: propertyId } : {}) },
          status: { notIn: ['NEW', 'VOID'] },
          checkIn: { lt: rangeEndExclusive },
          checkOut: { gt: rangeStart },
        },
        select: {
          id: true,
          propertyId: true,
          checkIn: true,
          checkOut: true,
          status: true,
          totalAmount: true,
          transportFare: true,
          roomsQty: true,
          property: { select: { id: true, title: true, services: true } },
        },
      });

      function nightsOverlap(aStart: Date, aEndExclusive: Date) {
        const start = Math.max(+aStart, +rangeStart);
        const end = Math.min(+aEndExclusive, +rangeEndExclusive);
        const diff = Math.max(0, end - start);
        return Math.max(0, Math.ceil(diff / 864e5));
      }

      const defaultCommissionPercent = await getEffectiveCommissionPercent(null);
      const bookingsWithPayout = bookings.map((b: any) => {
        const accommodationGross = Math.max(0, Number(b.totalAmount ?? 0) - Number(b.transportFare ?? 0));
        const commissionPercent = (() => {
          const v = Number(b.property?.services?.commissionPercent);
          return Number.isFinite(v) && v >= 0 ? Math.min(100, v) : defaultCommissionPercent;
        })();
        const { ownerPayout } = extractOwnerPayoutFromAccommodationGross(accommodationGross, commissionPercent);
        return { ...b, ownerBaseAmount: ownerPayout };
      });

      const bookingGross = bookings.reduce((s: number, b: any) => {
        if (String(b.status || '').toUpperCase() === 'CANCELED') return s;
        return s + Number(b.totalAmount ?? 0);
      }, 0);
      const bookingNet = bookingsWithPayout.reduce((s: number, b: any) => {
        if (String(b.status || '').toUpperCase() === 'CANCELED') return s;
        return s + Number(b.ownerBaseAmount ?? 0);
      }, 0);
      const invoiceGross = invoices.reduce((s: number, i: any) => s + Number(i.total), 0);
      const invoiceNet = invoices.reduce((s: number, i: any) => s + Number(i.netPayable), 0);
      const gross = bookingGross > 0 ? bookingGross : invoiceGross;
      const net = bookingNet > 0 ? bookingNet : invoiceNet;
      const bCnt = bookings.length;
      const nights = bookings.reduce((s: number, b: any) => s + nightsOverlap(b.checkIn, b.checkOut), 0);
      const adr = nights ? gross / nights : 0;

      // Time series buckets
      const series: Record<string, { gross: number; net: number; bookings: number }> = {};
      for (const d of eachDay(rangeStart, rangeEndInclusive)) series[fmtKey(d, groupBy)] = { gross: 0, net: 0, bookings: 0 };
      for (const b of bookingsWithPayout) {
        const anchor = new Date(Math.max(+b.checkIn, +rangeStart));
        const k = fmtKey(startOfDayTZ(anchor), groupBy);
        if (!series[k]) series[k] = { gross: 0, net: 0, bookings: 0 };
        series[k].bookings += 1;
        if (String(b.status || '').toUpperCase() !== 'CANCELED') {
          series[k].gross += Number(b.totalAmount ?? 0);
          series[k].net += Number(b.ownerBaseAmount ?? 0);
        }
      }
      if (bookingGross <= 0 && bookingNet <= 0) {
        for (const inv of invoices) {
          const k = fmtKey(startOfDayTZ(inv.issuedAt), groupBy);
          if (!series[k]) series[k] = { gross: 0, net: 0, bookings: 0 };
          series[k].gross += Number(inv.total);
          series[k].net += Number(inv.netPayable);
        }
      }

      // Booking status distribution
      const byStatus: Record<string, number> = {};
      for (const b of bookings) byStatus[b.status] = (byStatus[b.status] ?? 0) + 1;

      // Top properties by net
      const byProp: Record<number, { title: string; net: number }> = {};
      for (const b of bookingsWithPayout) {
        if (String(b.status || '').toUpperCase() === 'CANCELED') continue;
        const pid = b.propertyId;
        const title = b.property?.title ?? `#${pid}`;
        if (!byProp[pid]) byProp[pid] = { title, net: 0 };
        byProp[pid].net += Number(b.ownerBaseAmount ?? 0);
      }
      if (Object.keys(byProp).length === 0) {
        for (const inv of invoices) {
          const pid = inv.booking.propertyId;
          const title = inv.booking.property?.title ?? `#${pid}`;
          if (!byProp[pid]) byProp[pid] = { title, net: 0 };
          byProp[pid].net += Number(inv.netPayable);
        }
      }

      return {
        kpis: { gross, net, bookings: bCnt, nights, adr },
        series: Object.entries(series).map(([key, v]) => ({ key, ...v })),
        status: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
        topProperties: Object.entries(byProp)
          .map(([pid, v]) => ({ propertyId: Number(pid), title: v.title, net: v.net }))
          .sort((a, b) => b.net - a.net)
          .slice(0, 5),
      };
    });

    res.json(data);
  })
);

/** -------------------------
 *  /owner/reports/revenue
 *  ------------------------- */
router.get(
  "/revenue",
  asyncHandler(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const r = req as AuthedRequest;
    const ownerId = r.user!.id;
    const { from, to, groupBy, propertyId } = parseQuery(req.query);

    const key = makeKey(ownerId, "revenue", {
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy,
      propertyId,
    });

    const data = await withCache(key, async () => {
      const items: Invoice[] = await prisma.invoice.findMany({
        where: {
          ownerId,
          issuedAt: { gte: from, lte: to },
          ...(propertyId ? { booking: { propertyId } } : {}),
        },
        include: {
          booking: {
            select: {
              propertyId: true,
              property: { select: { id: true, title: true } },
            },
          },
        },
      });

      // Series
      const series: Record<string, { gross: number; net: number; commission: number }> = {};
      for (const d of eachDay(from, to)) series[fmtKey(d, groupBy)] = { gross: 0, net: 0, commission: 0 };
      for (const i of items) {
        const k = fmtKey(startOfDayTZ(i.issuedAt), groupBy);
        if (!series[k]) series[k] = { gross: 0, net: 0, commission: 0 };
        series[k].gross += Number(i.total);
        series[k].net += Number(i.netPayable);
        series[k].commission += Number(i.commissionAmount);
      }

      // By property
      const byProp: Record<string, { gross: number; net: number; commission: number }> = {};
      for (const i of items) {
        const name = i.booking.property?.title ?? `#${i.booking.propertyId}`;
        if (!byProp[name]) byProp[name] = { gross: 0, net: 0, commission: 0 };
        byProp[name].gross += Number(i.total);
        byProp[name].net += Number(i.netPayable);
        byProp[name].commission += Number(i.commissionAmount);
      }

      return {
        series: Object.entries(series).map(([key, v]) => ({ key, ...v })),
        byProperty: Object.entries(byProp).map(([title, v]) => ({ title, ...v })),
        table: items.map((i: any) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          issuedAt: i.issuedAt,
          property: i.booking.property?.title ?? `#${i.booking.propertyId}`,
          gross: i.total,
          commissionPercent: i.commissionPercent,
          commissionAmount: i.commissionAmount,
          net: i.netPayable,
          status: i.status,
          receiptNumber: i.receiptNumber ?? null,
        })),
      };
    });

    res.json(data);
  })
);

/** -------------------------
 *  /owner/reports/bookings
 *  ------------------------- */
const bookingsHandler: RequestHandler = async (req, res, next) => {
  // Set content type early to ensure JSON response
  res.setHeader('Content-Type', 'application/json');
  
  try {
    const r = req as AuthedRequest;
    const ownerId = r.user?.id;
    const { from, to, groupBy, propertyId } = parseQuery(req.query);

    if (!ownerId) {
      return res.status(401).json({ error: "Unauthorized", series: [], stacked: [], table: [] });
    }

    const key = makeKey(ownerId, "bookings", {
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy,
      propertyId,
    });

    const data = await withCache(key, async () => {
      const t0 = Date.now();
      
      // Try to include code relation, but handle gracefully if it fails
      let bs: any[];

      // Always select the fields we need. The existing try/catch handles schema-mismatch errors.
      const bookingSelect: any = {
        id: true,
        propertyId: true,
        checkIn: true,
        checkOut: true,
        status: true,
        totalAmount: true,
        guestName: true,
        transportFare: true,
      };
      try {
        bs = await prisma.booking.findMany({
          where: {
            property: { ownerId },
            status: { notIn: ['NEW', 'VOID'] },
            checkIn: { gte: from, lte: to },
            ...(propertyId ? { propertyId } : {}),
          },
          select: {
            ...bookingSelect,
            property: { select: { id: true, title: true, services: true } },
            code: {
              select: {
                usedAt: true,
                status: true,
              },
            },
          } as any,
        });
      } catch (includeErr: any) {
        // If code relation fails, retry without it
        console.warn('Failed to include code relation, retrying without it:', includeErr?.message);
        bs = await prisma.booking.findMany({
          where: {
            property: { ownerId },
            status: { notIn: ['NEW', 'VOID'] },
            checkIn: { gte: from, lte: to },
            ...(propertyId ? { propertyId } : {}),
          },
          select: {
            ...bookingSelect,
            property: { select: { id: true, title: true, services: true } },
          } as any,
        });
      }

      const series: Record<string, { count: number }> = {};
      const stack: Record<string, Record<string, number>> = {};
      for (const d of eachDay(from, to)) {
        const k = fmtKey(d, groupBy);
        series[k] = { count: 0 };
        stack[k] = {};
      }
      for (const b of bs) {
        const k = fmtKey(startOfDayTZ(b.checkIn), groupBy);
        // Defensive: if timezone edge cases produce a key not in range, initialize it.
        if (!series[k]) { series[k] = { count: 0 }; stack[k] = stack[k] ?? {}; }
        series[k].count += 1;
        stack[k][b.status] = (stack[k][b.status] ?? 0) + 1;
      }
      const stacked = Object.entries(stack).map(([key, obj]) => ({ key, ...obj }));

      const defaultCommissionPercent = await getEffectiveCommissionPercent(null);

      return {
        series: Object.entries(series).map(([key, v]) => ({ key, ...v })),
        stacked,
        table: bs.map((b: any) => {
          const accommodationGross = Math.max(0, Number(b.totalAmount || 0) - Number((b as any).transportFare || 0));
          const commissionPercent = (() => {
            const v = Number((b as any).property?.services?.commissionPercent);
            return Number.isFinite(v) && v >= 0 ? Math.min(100, v) : defaultCommissionPercent;
          })();
          const { ownerPayout } = extractOwnerPayoutFromAccommodationGross(accommodationGross, commissionPercent);
          return {
            id: b.id,
            property: b.property?.title ?? `#${b.propertyId}`,
            propertyId: b.propertyId,
            checkIn: b.checkIn,
            checkOut: b.checkOut,
            status: b.status,
            totalAmount: b.totalAmount,
            transportFare: (b as any).transportFare ?? null,
            ownerBaseAmount: ownerPayout,
            guestName: (b as any).guestName ?? null,
            checkedInAt: (b.code?.usedAt ?? null),
          };
        }),
      };
    });

    res.json(data);
  } catch (err: any) {
    console.error('Error in GET /owner/reports/bookings:', err);
    
    // If headers already sent, pass to error handler
    if (res.headersSent) {
      return next(err);
    }
    
    // Handle Prisma schema mismatch errors (table/column not found)
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch in owner.reports.bookings:', err.message);
      return res.json({
        series: [],
        stacked: [],
        table: [],
      });
    }
    
    // Handle Prisma relation errors (relation not found)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2017') {
      console.warn('Prisma relation error in owner.reports.bookings:', err.message);
      // Retry without the code relation
      try {
        const r = req as AuthedRequest;
        const ownerId = r.user?.id;
        const { from, to, groupBy, propertyId } = parseQuery(req.query);

        const bookingMeta = (prisma as any).booking?._meta ?? {};
        const bookingHasField = (field: string) => Object.prototype.hasOwnProperty.call(bookingMeta, field);
        const bookingSelect: any = {
          id: true,
          propertyId: true,
          checkIn: true,
          checkOut: true,
          status: true,
        };
        if (bookingHasField('totalAmount')) bookingSelect.totalAmount = true;
        if (bookingHasField('guestName')) bookingSelect.guestName = true;

        const bs: any[] = await prisma.booking.findMany({
          where: {
            property: { ownerId },
            status: { notIn: ['NEW', 'VOID'] },
            checkIn: { gte: from, lte: to },
            ...(propertyId ? { propertyId } : {}),
          },
          select: {
            ...bookingSelect,
            property: { select: { id: true, title: true } },
          } as any,
        });

        const series: Record<string, { count: number }> = {};
        const stack: Record<string, Record<string, number>> = {};
        for (const d of eachDay(from, to)) {
          const k = fmtKey(d, groupBy);
          series[k] = { count: 0 };
          stack[k] = {};
        }
        for (const b of bs) {
          const k = fmtKey(startOfDayTZ(b.checkIn), groupBy);
          if (!series[k]) { series[k] = { count: 0 }; stack[k] = stack[k] ?? {}; }
          series[k].count += 1;
          stack[k][b.status] = (stack[k][b.status] ?? 0) + 1;
        }
        const stacked = Object.entries(stack).map(([key, obj]) => ({ key, ...obj }));

        return res.json({
          series: Object.entries(series).map(([key, v]) => ({ key, ...v })),
          stacked,
          table: bs.map((b: any) => ({
            id: b.id,
            property: b.property?.title ?? `#${b.propertyId}`,
            propertyId: b.propertyId,
            checkIn: b.checkIn,
            checkOut: b.checkOut,
            status: b.status,
            totalAmount: b.totalAmount,
            transportFare: (b as any).transportFare ?? null,
            ownerBaseAmount: Math.max(0, Number(b.totalAmount || 0) - Number((b as any).transportFare || 0)),
            guestName: (b as any).guestName ?? null,
            checkedInAt: null, // code relation unavailable
          })),
        });
      } catch (retryErr: any) {
        console.error('Retry failed in owner.reports.bookings:', retryErr);
        return res.json({
          series: [],
          stacked: [],
          table: [],
        });
      }
    }
    
    // Handle other errors
    return res.status(500).json({
      error: 'Internal server error',
      message: err?.message || 'Unknown error',
      series: [],
      stacked: [],
      table: [],
    });
  }
};
router.get("/bookings", bookingsHandler);

/** -------------------------
 *  /owner/reports/stays
 *
 *  Operational export for owners:
 *  - NoLSAF bookings (Booking)
 *  - External reservations (PropertyAvailabilityBlock)
 *
 *  Uses overlap logic so items spanning the window are included.
 *  ------------------------- */
const staysHandler: RequestHandler = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const r = req as AuthedRequest;
  const ownerId = r.user?.id;
  if (!ownerId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { from, to, groupBy, propertyId } = parseQuery(req.query);
  const rangeStart = startOfDayTZ(from);
  const rangeEndExclusive = addDays(startOfDayTZ(to), 1);
  const rangeEndInclusive = addDays(rangeEndExclusive, -1);

  const key = makeKey(ownerId, "stays", {
    from: rangeStart.toISOString(),
    to: rangeEndInclusive.toISOString(),
    groupBy,
    propertyId,
  });

  try {
    const generatedAt = new Date().toISOString();

    const data = await withCache(key, async () => {
      const owner = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { id: true, fullName: true, name: true, email: true, phone: true, address: true },
      });

      if (!owner) {
        return {
          header: { owner: null, property: null },
          stats: {
            nolsafBookings: 0,
            externalReservations: 0,
            groupStaysReceived: 0,
            auctionClaimsSubmitted: 0,
            auctionClaimsAccepted: 0,
            revenueTzs: 0,
            nightsBooked: 0,
            nightsBlocked: 0,
            groupStayNights: 0,
          },
          series: [],
          bookings: [],
          external: [],
          groupStays: [],
          auctionClaims: [],
        };
      }

      const property = propertyId
        ? await prisma.property.findFirst({
            where: { id: propertyId, ownerId },
            select: {
              id: true,
              title: true,
              regionName: true,
              district: true,
              ward: true,
              street: true,
              apartment: true,
              city: true,
              zip: true,
              country: true,
              latitude: true,
              longitude: true,
            },
          })
        : null;

      if (propertyId && !property) {
        // Property not found or not owned by requester.
        return {
          header: { owner, property: null },
          stats: {
            nolsafBookings: 0,
            externalReservations: 0,
            groupStaysReceived: 0,
            auctionClaimsSubmitted: 0,
            auctionClaimsAccepted: 0,
            revenueTzs: 0,
            nightsBooked: 0,
            nightsBlocked: 0,
            groupStayNights: 0,
          },
          series: [],
          bookings: [],
          external: [],
          groupStays: [],
          auctionClaims: [],
          notFound: true,
        };
      }

      const bookings = await prisma.booking.findMany({
        where: {
          property: { ownerId, ...(propertyId ? { id: propertyId } : {}) },
          status: { notIn: ['NEW', 'VOID'] },
          checkIn: { lt: rangeEndExclusive },
          checkOut: { gt: rangeStart },
        },
        select: {
          id: true,
          propertyId: true,
          checkIn: true,
          checkOut: true,
          status: true,
          totalAmount: true,
          transportFare: true,
          roomsQty: true,
          roomCode: true,
          guestName: true,
          guestPhone: true,
          nationality: true,
          sex: true,
          createdAt: true,
          property: {
            select: {
              id: true,
              title: true,
              regionName: true,
              district: true,
              ward: true,
              street: true,
              apartment: true,
              city: true,
              zip: true,
              country: true,
              services: true,
            },
          },
        },
        orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
      });

      const external = await prisma.propertyAvailabilityBlock.findMany({
        where: {
          property: { ownerId, ...(propertyId ? { id: propertyId } : {}) },
          startDate: { lt: rangeEndExclusive },
          endDate: { gt: rangeStart },
        },
        select: {
          id: true,
          propertyId: true,
          startDate: true,
          endDate: true,
          roomCode: true,
          source: true,
          guestName: true,
          guestPhone: true,
          nationality: true,
          roomRate: true,
          calculatedAmount: true,
          amountPaid: true,
          currency: true,
          bedsBlocked: true,
          createdAt: true,
          property: {
            select: {
              id: true,
              title: true,
              regionName: true,
              district: true,
              ward: true,
              street: true,
              apartment: true,
              city: true,
              zip: true,
              country: true,
            },
          },
        },
        orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      });

      // Group stays received (assigned to this owner)
      const groupStays = await (prisma as any).groupBooking.findMany({
        where: {
          assignedOwnerId: ownerId,
          ...(propertyId ? { confirmedPropertyId: propertyId } : {}),
          OR: [
            {
              checkIn: { lt: rangeEndExclusive },
              checkOut: { gt: rangeStart },
            },
            {
              // Flexible/no-dates group stays: fall back to createdAt window
              checkIn: null,
              createdAt: { gte: rangeStart, lt: rangeEndExclusive },
            },
            {
              checkOut: null,
              createdAt: { gte: rangeStart, lt: rangeEndExclusive },
            },
          ],
        },
        select: {
          id: true,
          groupType: true,
          accommodationType: true,
          headcount: true,
          roomsNeeded: true,
          toRegion: true,
          toDistrict: true,
          toWard: true,
          toLocation: true,
          checkIn: true,
          checkOut: true,
          useDates: true,
          status: true,
          totalAmount: true,
          currency: true,
          isOpenForClaims: true,
          openedForClaimsAt: true,
          confirmedPropertyId: true,
          createdAt: true,
          confirmedProperty: {
            select: {
              id: true,
              title: true,
              regionName: true,
              district: true,
              ward: true,
              street: true,
              apartment: true,
              city: true,
              zip: true,
              country: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      });

      // Group-stay auction participation (claims)
      const auctionClaims = await (prisma as any).groupBookingClaim.findMany({
        where: {
          ownerId,
          ...(propertyId ? { propertyId } : {}),
          createdAt: { gte: rangeStart, lt: rangeEndExclusive },
          status: { not: 'WITHDRAWN' },
        },
        select: {
          id: true,
          groupBookingId: true,
          ownerId: true,
          propertyId: true,
          offeredPricePerNight: true,
          discountPercent: true,
          totalAmount: true,
          currency: true,
          status: true,
          reviewedAt: true,
          createdAt: true,
          updatedAt: true,
          property: {
            select: {
              id: true,
              title: true,
              regionName: true,
              district: true,
              ward: true,
              street: true,
              apartment: true,
              city: true,
              zip: true,
              country: true,
            },
          },
          groupBooking: {
            select: {
              id: true,
              groupType: true,
              accommodationType: true,
              headcount: true,
              roomsNeeded: true,
              toRegion: true,
              toDistrict: true,
              toWard: true,
              toLocation: true,
              checkIn: true,
              checkOut: true,
              useDates: true,
              status: true,
              totalAmount: true,
              currency: true,
              isOpenForClaims: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      });

      function nightsOverlap(aStart: Date, aEndExclusive: Date) {
        const start = Math.max(+aStart, +rangeStart);
        const end = Math.min(+aEndExclusive, +rangeEndExclusive);
        const diff = Math.max(0, end - start);
        return Math.max(0, Math.ceil(diff / 864e5));
      }

      const defaultCommissionPercent = await getEffectiveCommissionPercent(null);
      const bookingsWithPayout = bookings.map((b: any) => {
        const accommodationGross = Math.max(0, Number(b.totalAmount ?? 0) - Number(b.transportFare ?? 0));
        const cp = (() => {
          const v = Number(b.property?.services?.commissionPercent);
          return Number.isFinite(v) && v >= 0 ? Math.min(100, v) : defaultCommissionPercent;
        })();
        const { ownerPayout } = extractOwnerPayoutFromAccommodationGross(accommodationGross, cp);
        return { ...b, ownerBaseAmount: String(ownerPayout) };
      });

      const nolsafRevenueTzs = bookingsWithPayout.reduce((sum: number, b: any) => {
        if (String(b.status || '').toUpperCase() === 'CANCELED') return sum;
        return sum + Number(b.ownerBaseAmount ?? b.totalAmount ?? 0);
      }, 0);
      const externalRevenueTzs = external.reduce((sum: number, blk: any) => {
        return sum + Number(blk.amountPaid ?? blk.calculatedAmount ?? 0);
      }, 0);
      const revenueTzs = nolsafRevenueTzs + externalRevenueTzs;
      const nightsBooked = bookings.reduce((sum: number, b: any) => sum + nightsOverlap(b.checkIn, b.checkOut), 0);
      const nightsBlocked = external.reduce((sum: number, blk: any) => sum + nightsOverlap(blk.startDate, blk.endDate), 0);
      const groupStayNights = (groupStays || []).reduce((sum: number, gb: any) => {
        if (!gb?.checkIn || !gb?.checkOut) return sum;
        return sum + nightsOverlap(gb.checkIn, gb.checkOut);
      }, 0);

      const auctionClaimsAccepted = (auctionClaims || []).reduce((sum: number, c: any) => {
        return sum + (String(c?.status || '').toUpperCase() === 'ACCEPTED' ? 1 : 0);
      }, 0);

      // Simple series: bucket by checkIn/startDate
      const buckets: Record<string, { nolsaf: number; external: number; groupStays: number; revenueTzs: number }> = {};
      for (const d of eachDay(rangeStart, rangeEndInclusive)) {
        const k = fmtKey(d, groupBy);
        buckets[k] = buckets[k] ?? { nolsaf: 0, external: 0, groupStays: 0, revenueTzs: 0 };
      }
      for (const b of bookingsWithPayout) {
        const k = fmtKey(startOfDayTZ(b.checkIn), groupBy);
        buckets[k] = buckets[k] ?? { nolsaf: 0, external: 0, groupStays: 0, revenueTzs: 0 };
        buckets[k].nolsaf += 1;
        if (String(b.status || '').toUpperCase() !== 'CANCELED') buckets[k].revenueTzs += Number(b.ownerBaseAmount ?? b.totalAmount ?? 0);
      }
      for (const blk of external) {
        const k = fmtKey(startOfDayTZ(blk.startDate), groupBy);
        buckets[k] = buckets[k] ?? { nolsaf: 0, external: 0, groupStays: 0, revenueTzs: 0 };
        buckets[k].external += 1;
        buckets[k].revenueTzs += Number(blk.amountPaid ?? blk.calculatedAmount ?? 0);
      }

      for (const gb of groupStays || []) {
        const anchor = gb?.checkIn ? gb.checkIn : gb?.createdAt;
        if (!anchor) continue;
        const k = fmtKey(startOfDayTZ(anchor), groupBy);
        buckets[k] = buckets[k] ?? { nolsaf: 0, external: 0, groupStays: 0, revenueTzs: 0 };
        buckets[k].groupStays += 1;
      }

      return {
        header: {
          from: rangeStart.toISOString(),
          to: rangeEndInclusive.toISOString(),
          groupBy,
          owner,
          property,
        },
        stats: {
          nolsafBookings: bookings.length,
          externalReservations: external.length,
          groupStaysReceived: (groupStays || []).length,
          auctionClaimsSubmitted: (auctionClaims || []).length,
          auctionClaimsAccepted,
          revenueTzs,
          nightsBooked,
          nightsBlocked,
          groupStayNights,
        },
        series: Object.entries(buckets).map(([key, v]) => ({ key, ...v })),
        bookings: bookingsWithPayout,
        external,
        groupStays,
        auctionClaims,
      };
    });

    if ((data as any)?.notFound) {
      return res.status(404).json({ error: 'Property not found', ...data, generatedAt });
    }

    return res.json({ ...data, generatedAt });
  } catch (err: any) {
    console.error('owner.reports.stays error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      message: err?.message || 'Unknown error',
    });
  }
};
router.get("/stays", staysHandler);

/** -------------------------
 *  /owner/reports/occupancy
 *  ------------------------- */
const occupancyHandler: RequestHandler = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  try {
    const r = req as AuthedRequest;
    const ownerId = r.user?.id;
    const { from, to, groupBy, propertyId } = parseQuery(req.query);

    if (!ownerId) {
      return res.status(401).json({ error: 'Unauthorized', heat: [], byProperty: [] });
    }

    const key = makeKey(ownerId, "occupancy", {
      from: from.toISOString(),
      to: to.toISOString(),
      groupBy,
      propertyId,
    });

    const data = await withCache(key, async () => {
      const props = await prisma.property.findMany({
        where: { ownerId, ...(propertyId ? { id: propertyId } : {}) },
        // Property does not have roomsCount; use totalBedrooms as a best-available capacity proxy.
        select: { id: true, title: true, totalBedrooms: true },
      });

      const totalRooms = props.reduce((sum, p) => sum + (p.totalBedrooms ?? 1), 0);
      const available = Math.max(1, totalRooms);

      // Occupancy per day (as a %). Use roomsQty rather than booking count.
      const days = eachDay(from, to);
      const occ: Array<{ date: string; occupancy: number }> = [];

      for (const d of days) {
        const agg = await prisma.booking.aggregate({
          where: {
            property: { ownerId, ...(propertyId ? { id: propertyId } : {}) },
            checkIn: { lte: d },
            checkOut: { gt: d },
            status: { notIn: ['NEW', 'VOID', 'CANCELED'] },
          },
          _sum: { roomsQty: true },
        });

        const soldRooms = Number(agg._sum.roomsQty ?? 0);
        const rate = Math.min(100, Math.round((soldRooms / available) * 100));
        occ.push({ date: fmtKey(d, groupBy), occupancy: rate });
      }

      // Net revenue by property in the window
      const invoices: Invoice[] = await prisma.invoice.findMany({
        where: {
          ownerId,
          issuedAt: { gte: from, lte: to },
          ...(propertyId ? { booking: { propertyId } } : {}),
        },
        include: { booking: true },
      });
      const byProp: Record<number, { title: string; net: number }> = {};
      for (const inv of invoices) {
        const pid = inv.booking.propertyId;
        const title = props.find((p) => p.id === pid)?.title ?? `#${pid}`;
        if (!byProp[pid]) byProp[pid] = { title, net: 0 };
        byProp[pid].net += Number(inv.netPayable);
      }
      const byProperty = Object.entries(byProp).map(([pid, v]) => ({
        propertyId: Number(pid),
        title: v.title,
        net: v.net,
      }));

      return { heat: occ, byProperty };
    });

    return res.json(data);
  } catch (err: any) {
    console.error('owner.reports.occupancy error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      message: err?.message || 'Unknown error',
      heat: [],
      byProperty: [],
    });
  }
};
router.get("/occupancy", occupancyHandler);

/** -------------------------
 *  /owner/reports/customers
 *  ------------------------- */
router.get(
  "/customers",
  asyncHandler(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const r = req as AuthedRequest;
    const ownerId = r.user!.id;
    const { from, to, propertyId } = parseQuery(req.query);

    const key = makeKey(ownerId, "customers", {
      from: from.toISOString(),
      to: to.toISOString(),
      propertyId,
    });

    const data = await withCache(key, async () => {
      const bs = await prisma.booking.findMany({
        where: {
          property: { ownerId },
          status: { notIn: ['NEW', 'VOID'] },
          checkIn: { gte: from, lte: to },
          ...(propertyId ? { propertyId } : {}),
        },
        select: {
          id: true,
          totalAmount: true,
          checkIn: true,
          checkOut: true,
          guestName: true,
          nationality: true,
        },
      });

      // By nationality
      const byNat: Record<string, number> = {};
      for (const b of bs) {
        const k = (b.nationality ?? "Unknown").toString();
        byNat[k] = (byNat[k] ?? 0) + 1;
      }

      // Top customers (by guestName proxy)
      const byGuest: Record<string, { stays: number; spend: number }> = {};
      for (const b of bs) {
        const k = (b.guestName ?? "Guest").toString();
        if (!byGuest[k]) byGuest[k] = { stays: 0, spend: 0 };
        byGuest[k].stays += 1;
        byGuest[k].spend += Number(b.totalAmount);
      }
      const topCustomers = Object.entries(byGuest)
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 20);

      return {
        byNationality: Object.entries(byNat).map(([nationality, count]) => ({ nationality, count })),
        topCustomers,
      };
    });

    res.json(data);
  })
);

export default router;

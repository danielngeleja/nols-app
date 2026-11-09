import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { withCache, cacheKeys, cacheTags, measureTime } from "../lib/performance.js";
import { adminRecordReferenceOrNull, resolveAdminRecordReference } from "../lib/adminRecordReference.js";
import { adminBookingReference } from "../lib/adminBookingReference.js";
import { summarizeBookingInsights } from "../lib/bookingInsights.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

function parseDays(value: unknown, fallback = 30) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const d = Math.round(n);
  if (d < 1) return 1;
  if (d > 365) return 365;
  return d;
}

function displayName(row: any, fallback: string) {
  const name = (row?.fullName || row?.name || "").toString().trim();
  return name || fallback;
}

router.get("/highlights", async (req, res) => {
  try {
    const days = parseDays((req.query as any)?.days, 30);
    const now = new Date();
    const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const { result, duration } = await measureTime("admin.performance.highlights", async () => {
      return await withCache(
        cacheKeys.adminPerformanceHighlights(days),
        async () => {
          const sinceIso = since.toISOString();

          const [bestTypeRows, bestDriverRows, bestOwnerRows, bestRegionRows, topPropertyRows] = await Promise.all([
            prisma.$queryRaw<any[]>`
              SELECT t.type,
                     t.bookings,
                     COALESCE(rv.reviews, 0) AS reviews,
                     COALESCE(sv.saves, 0) AS saves,
                     (COALESCE(rv.reviews, 0) + COALESCE(sv.saves, 0)) AS interactions
              FROM (
                SELECT p.type AS type, COUNT(*) AS bookings
                FROM booking b
                JOIN property p ON p.id = b.propertyId
                WHERE b.checkIn >= ${sinceIso} AND b.status <> 'CANCELED'
                GROUP BY p.type
              ) t
              LEFT JOIN (
                SELECT p.type AS type, COUNT(*) AS reviews
                FROM property_reviews r
                JOIN property p ON p.id = r.propertyId
                WHERE r.createdAt >= ${sinceIso}
                GROUP BY p.type
              ) rv ON rv.type = t.type
              LEFT JOIN (
                SELECT p.type AS type, COUNT(*) AS saves
                FROM savedproperty s
                JOIN property p ON p.id = s.propertyId
                WHERE s.savedAt >= ${sinceIso}
                GROUP BY p.type
              ) sv ON sv.type = t.type
              ORDER BY t.bookings DESC, interactions DESC
              LIMIT 1
            `,

            prisma.$queryRaw<any[]>`
              SELECT b.driverId AS driverId,
                     COALESCE(d.fullName, d.name) AS name,
                     COUNT(DISTINCT b.id) AS bookings,
                     COALESCE(SUM(i.commissionAmount), 0) AS nolsRevenue
              FROM invoice i
              JOIN booking b ON b.id = i.bookingId
              LEFT JOIN \`user\` d ON d.id = b.driverId
              WHERE i.status IN ('APPROVED', 'PAID')
                AND i.issuedAt >= ${sinceIso}
                AND b.driverId IS NOT NULL
              GROUP BY b.driverId
              ORDER BY nolsRevenue DESC, bookings DESC
              LIMIT 1
            `,

            prisma.$queryRaw<any[]>`
              SELECT p.ownerId AS ownerId,
                     COALESCE(o.fullName, o.name) AS name,
                     COUNT(DISTINCT b.id) AS bookings,
                     COALESCE(SUM(i.commissionAmount), 0) AS nolsRevenue
              FROM invoice i
              JOIN booking b ON b.id = i.bookingId
              JOIN property p ON p.id = b.propertyId
              LEFT JOIN \`user\` o ON o.id = p.ownerId
              WHERE i.status IN ('APPROVED', 'PAID')
                AND i.issuedAt >= ${sinceIso}
              GROUP BY p.ownerId
              ORDER BY nolsRevenue DESC, bookings DESC
              LIMIT 1
            `,

            prisma.$queryRaw<any[]>`
              SELECT COALESCE(p.regionName, 'Unknown') AS regionName,
                     COUNT(*) AS bookings
              FROM booking b
              JOIN property p ON p.id = b.propertyId
              WHERE b.checkIn >= ${sinceIso} AND b.status <> 'CANCELED'
              GROUP BY regionName
              ORDER BY bookings DESC
              LIMIT 60
            `,

            prisma.$queryRaw<any[]>`
              SELECT p.id AS propertyId,
                     p.title AS title,
                     p.type AS type,
                     COALESCE(p.regionName, 'Unknown') AS regionName,
                     COUNT(b.id) AS bookings,
                     (COALESCE(rv.reviews, 0) + COALESCE(sv.saves, 0)) AS interactions,
                     COALESCE(rv.reviews, 0) AS reviews,
                     COALESCE(sv.saves, 0) AS saves
              FROM property p
              JOIN booking b ON b.propertyId = p.id AND b.checkIn >= ${sinceIso} AND b.status <> 'CANCELED'
              LEFT JOIN (
                SELECT propertyId, COUNT(*) AS reviews
                FROM property_reviews
                WHERE createdAt >= ${sinceIso}
                GROUP BY propertyId
              ) rv ON rv.propertyId = p.id
              LEFT JOIN (
                SELECT propertyId, COUNT(*) AS saves
                FROM savedproperty
                WHERE savedAt >= ${sinceIso}
                GROUP BY propertyId
              ) sv ON sv.propertyId = p.id
              GROUP BY p.id
              ORDER BY bookings DESC, interactions DESC
              LIMIT 1
            `,
          ]);

          const bestType = (bestTypeRows && bestTypeRows[0]) || null;
          const bestDriver = (bestDriverRows && bestDriverRows[0]) || null;
          const bestOwner = (bestOwnerRows && bestOwnerRows[0]) || null;
          const mostBookedRegion = (bestRegionRows && bestRegionRows[0]) || null;
          const topProperty = (topPropertyRows && topPropertyRows[0]) || null;

          return {
            windowDays: days,
            from: sinceIso,
            to: now.toISOString(),
            bestPropertyType: bestType
              ? {
                  type: String(bestType.type || "Other"),
                  bookings: Number(bestType.bookings || 0),
                  interactions: Number(bestType.interactions || 0),
                  interactionsBreakdown: {
                    reviews: Number(bestType.reviews || 0),
                    saves: Number(bestType.saves || 0),
                  },
                }
              : null,
            bestDriver: bestDriver
              ? {
                  driverId: Number(bestDriver.driverId),
                  name: displayName(bestDriver, "Top driver"),
                  bookings: Number(bestDriver.bookings || 0),
                  nolsRevenue: Number(bestDriver.nolsRevenue || 0),
                }
              : null,
            bestOwner: bestOwner
              ? {
                  ownerId: Number(bestOwner.ownerId),
                  name: displayName(bestOwner, "Top owner"),
                  bookings: Number(bestOwner.bookings || 0),
                  nolsRevenue: Number(bestOwner.nolsRevenue || 0),
                }
              : null,
            // Every region with bookings in the window, same definition as mostBookedRegion
            // (first row), so the home map and the leaders strip always agree.
            regions: (bestRegionRows || []).map((r: any) => ({
              regionName: String(r.regionName || "Unknown"),
              bookings: Number(r.bookings || 0),
            })),
            mostBookedRegion: mostBookedRegion
              ? {
                  regionName: String(mostBookedRegion.regionName || "Unknown"),
                  bookings: Number(mostBookedRegion.bookings || 0),
                }
              : null,
            topProperty: topProperty
              ? {
                  propertyId: Number(topProperty.propertyId),
                  propertyRef: adminRecordReferenceOrNull("property", Number(topProperty.propertyId)),
                  title: String(topProperty.title || "Property"),
                  type: String(topProperty.type || "Other"),
                  regionName: String(topProperty.regionName || "Unknown"),
                  bookings: Number(topProperty.bookings || 0),
                  interactions: Number(topProperty.interactions || 0),
                  interactionsBreakdown: {
                    reviews: Number(topProperty.reviews || 0),
                    saves: Number(topProperty.saves || 0),
                  },
                }
              : null,
          };
        },
        {
          ttl: 60,
          tags: [cacheTags.adminPerformanceHighlights],
        }
      );
    });

    res.set("X-Response-Time", `${duration.toFixed(2)}ms`);
    res.json(result);
  } catch (err) {
    console.error("admin.performance.highlights error", err);
    res.status(500).json({ error: "failed" });
  }
});

const INSIGHT_WINDOWS = new Set([7, 30, 90]);
const INSIGHT_BOOKING_CAP = 20_000;

/**
 * GET /api/admin/performance/booking-insights?days=30&property=<ref>
 * GET /api/admin/performance/booking-insights?days=30&type=BUNGALOW
 *
 * Booking funnel for one property or one property type: bookings placed in the
 * window, how many reached payment, and how each ended (received, still paying,
 * did not pay, cancelled). Compared with the window before it.
 */
router.get("/booking-insights", async (req, res) => {
  try {
    const q = req.query as Record<string, unknown>;
    const requestedDays = Number(q.days);
    const days = INSIGHT_WINDOWS.has(requestedDays) ? requestedDays : 30;
    const propertyRef = typeof q.property === "string" ? q.property.trim() : "";
    const type = typeof q.type === "string" ? q.type.trim().toUpperCase() : "";
    if (!propertyRef && !type) return res.status(400).json({ error: "property or type is required" });
    if (type && !/^[A-Z_]{2,40}$/.test(type)) return res.status(400).json({ error: "invalid type" });

    let property: any = null;
    if (propertyRef) {
      // Opaque references only; row ids never appear in admin URLs.
      const id = await resolveAdminRecordReference("property", propertyRef);
      if (!id) return res.status(404).json({ error: "property not found" });
      property = await prisma.property.findUnique({
        where: { id },
        select: { id: true, title: true, type: true, status: true, regionName: true, district: true },
      });
      if (!property) return res.status(404).json({ error: "property not found" });
    }

    const now = new Date();
    const previousSince = new Date(now.getTime() - 2 * days * 86_400_000);
    const bookings = await prisma.booking.findMany({
      where: {
        createdAt: { gte: previousSince },
        ...(property ? { propertyId: property.id } : { property: { type } }),
      },
      select: {
        id: true, propertyId: true, status: true, createdAt: true, checkIn: true, checkOut: true, totalAmount: true,
        invoices: {
          select: {
            status: true, receiptNumber: true, commissionAmount: true, paymentMethod: true,
            paymentEvents: { select: { status: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: INSIGHT_BOOKING_CAP,
    });

    const summary = summarizeBookingInsights(bookings as any, { now, days });

    let properties: any[] | undefined;
    let propertyCount: number | undefined;
    if (!property) {
      propertyCount = await prisma.property.count({ where: { type, status: "APPROVED" } });
      const ranked = [...summary.byProperty.entries()]
        .sort((a, b) => b[1].received - a[1].received || b[1].tried - a[1].tried)
        .slice(0, 10);
      const rows = ranked.length
        ? await prisma.property.findMany({
            where: { id: { in: ranked.map(([id]) => id) } },
            select: { id: true, title: true, regionName: true },
          })
        : [];
      const byId = new Map<number, { title: string; regionName: string | null }>(rows.map((row) => [row.id, row]));
      properties = ranked.map(([id, counts]) => ({
        ref: adminRecordReferenceOrNull("property", id),
        title: byId.get(id)?.title ?? "Property",
        regionName: byId.get(id)?.regionName ?? null,
        ...counts,
      }));
    }

    const recent = property
      ? summary.classified.slice(0, 10).map(({ booking, outcome }) => ({
          ref: adminBookingReference(booking.id),
          createdAt: booking.createdAt,
          checkIn: booking.checkIn,
          nights: Math.max(1, Math.round((new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) / 86_400_000)),
          amount: Math.round(Number(booking.totalAmount ?? 0)),
          outcome,
        }))
      : undefined;

    res.set("Cache-Control", "private, no-store");
    return res.json({
      scope: property ? "property" : "type",
      subject: property
        ? {
            title: property.title,
            type: property.type,
            status: property.status,
            regionName: property.regionName,
            district: property.district,
            propertyRef: adminRecordReferenceOrNull("property", property.id),
          }
        : { type, propertyCount },
      window: summary.window,
      totals: summary.totals,
      previous: summary.previous,
      daily: summary.daily,
      channels: summary.channels,
      properties,
      recent,
      truncated: bookings.length >= INSIGHT_BOOKING_CAP,
    });
  } catch (err) {
    console.error("admin.performance.booking-insights error", err);
    return res.status(500).json({ error: "failed" });
  }
});

export default router;

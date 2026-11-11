import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { withCache, cacheKeys, cacheTags, measureTime } from "../lib/performance.js";
import { adminRecordReferenceOrNull, resolveAdminRecordReference } from "../lib/adminRecordReference.js";
import { adminBookingReference } from "../lib/adminBookingReference.js";
import { summarizeBookingInsights } from "../lib/bookingInsights.js";
import { summarizeSeasonality } from "../lib/bookingSeasonality.js";

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
const SEASON_STAY_CAP = 50_000;
const RECEIVED_BOOKING_STATUSES = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
/** The highlights query groups properties with no region under this label. */
const UNKNOWN_REGION = "Unknown";

/**
 * GET /api/admin/performance/booking-insights?days=30&property=<ref>
 * GET /api/admin/performance/booking-insights?days=30&type=BUNGALOW
 * GET /api/admin/performance/booking-insights?days=30&region=Dar es Salaam
 *
 * Booking funnel for one property, one property type or one region: bookings
 * placed in the window, how many reached payment, and how each ended (received,
 * still paying, did not pay, cancelled). Compared with the window before it.
 * Every scope also carries `seasons`: when guests come, month by month, from
 * received stays (lib/bookingSeasonality.ts), independent of the window.
 * A region also carries its districts and property types.
 */
router.get("/booking-insights", async (req, res) => {
  try {
    const q = req.query as Record<string, unknown>;
    const requestedDays = Number(q.days);
    const days = INSIGHT_WINDOWS.has(requestedDays) ? requestedDays : 30;
    const propertyRef = typeof q.property === "string" ? q.property.trim() : "";
    const type = typeof q.type === "string" ? q.type.trim().toUpperCase() : "";
    const region = typeof q.region === "string" ? q.region.trim() : "";
    if (!propertyRef && !type && !region) return res.status(400).json({ error: "property, type or region is required" });
    if (type && !/^[A-Z_]{2,40}$/.test(type)) return res.status(400).json({ error: "invalid type" });
    if (region && !/^[\p{L}\p{M}' .-]{2,80}$/u.test(region)) return res.status(400).json({ error: "invalid region" });

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
    const regionName = region && region.toLowerCase() !== UNKNOWN_REGION.toLowerCase() ? region : null;
    const scope = property
      ? { propertyId: property.id }
      : type
        ? { property: { type } }
        : { property: { regionName } };
    // Received stays from three years back to seven months ahead, for the seasons.
    const seasonStays = prisma.booking.findMany({
      where: {
        ...scope,
        status: { in: RECEIVED_BOOKING_STATUSES },
        checkIn: { gte: new Date(now.getTime() - 37 * 31 * 86_400_000), lte: new Date(now.getTime() + 7 * 31 * 86_400_000) },
      },
      select: { checkIn: true, checkOut: true, createdAt: true, totalAmount: true },
      orderBy: { checkIn: "desc" },
      take: SEASON_STAY_CAP,
    });
    const bookings = await prisma.booking.findMany({
      where: {
        createdAt: { gte: previousSince },
        ...scope,
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
    let breakdown: { districts: Array<{ name: string; tried: number; received: number }>; types: Array<{ type: string; tried: number; received: number }> } | undefined;
    if (!property) {
      propertyCount = await prisma.property.count({ where: type ? { type, status: "APPROVED" } : { regionName, status: "APPROVED" } });
      const all = [...summary.byProperty.entries()];
      const ranked = [...all]
        .sort((a, b) => b[1].received - a[1].received || b[1].tried - a[1].tried)
        .slice(0, 10);
      // A region needs every listing's district and type for its breakdown.
      const wanted = type ? ranked.map(([id]) => id) : all.map(([id]) => id);
      const rows = wanted.length
        ? await prisma.property.findMany({
            where: { id: { in: wanted } },
            select: { id: true, title: true, regionName: true, district: true, type: true },
          })
        : [];
      const byId = new Map<number, { title: string; regionName: string | null; district: string | null; type: string }>(rows.map((row) => [row.id, row as any]));
      properties = ranked.map(([id, counts]) => ({
        ref: adminRecordReferenceOrNull("property", id),
        title: byId.get(id)?.title ?? "Property",
        regionName: (type ? byId.get(id)?.regionName : byId.get(id)?.district) ?? null,
        ...counts,
      }));
      if (!type) {
        const add = (map: Map<string, { tried: number; received: number }>, key: string, c: { tried: number; received: number }) => {
          const cur = map.get(key) ?? { tried: 0, received: 0 };
          cur.tried += c.tried;
          cur.received += c.received;
          map.set(key, cur);
        };
        const districts = new Map<string, { tried: number; received: number }>();
        const types = new Map<string, { tried: number; received: number }>();
        for (const [id, counts] of all) {
          const row = byId.get(id);
          add(districts, row?.district?.trim() || "District not set", counts);
          add(types, row?.type || "OTHER", counts);
        }
        const rank = <T extends { tried: number; received: number }>(a: T, b: T) => b.received - a.received || b.tried - a.tried;
        breakdown = {
          districts: [...districts.entries()].map(([name, c]) => ({ name, ...c })).sort(rank),
          types: [...types.entries()].map(([t, c]) => ({ type: t, ...c })).sort(rank),
        };
      }
    }

    const seasons = summarizeSeasonality(await seasonStays as any, { now });

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
      scope: property ? "property" : type ? "type" : "region",
      subject: property
        ? {
            title: property.title,
            type: property.type,
            status: property.status,
            regionName: property.regionName,
            district: property.district,
            propertyRef: adminRecordReferenceOrNull("property", property.id),
          }
        : type
          ? { type, propertyCount }
          : { type: "", regionName: regionName ?? UNKNOWN_REGION, propertyCount },
      window: summary.window,
      totals: summary.totals,
      previous: summary.previous,
      daily: summary.daily,
      channels: summary.channels,
      properties,
      breakdown,
      recent,
      seasons,
      truncated: bookings.length >= INSIGHT_BOOKING_CAP,
    });
  } catch (err) {
    console.error("admin.performance.booking-insights error", err);
    return res.status(500).json({ error: "failed" });
  }
});

export default router;

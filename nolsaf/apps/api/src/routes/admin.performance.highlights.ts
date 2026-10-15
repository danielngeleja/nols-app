import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { withCache, cacheKeys, cacheTags, measureTime } from "../lib/performance.js";

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

export default router;

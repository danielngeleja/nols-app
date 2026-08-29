import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { toPublicCard, toPublicDetail } from "../lib/publicPropertyDto.js";
import { Prisma } from "@prisma/client";
import QRCode from "qrcode";
import { withCache, cacheKeys, cacheTags, measureTime, publicCacheKey } from "../lib/performance.js";
import { REAL_BOOKING_STATUSES } from "../lib/bookingStatus.js";
import { calculateAvailability } from "../lib/availabilityCalculator.js";
import { signPropertyVerificationToken, verifyPropertyVerificationToken } from "../lib/propertyVerificationToken.js";
import { buildMenuUrl } from "../lib/nrmsOrderPoints.js";
import { rateLimitWithRedis } from "../lib/redisRateLimitStore.js";

/**
 * Certificate lookups are signature-gated, so this is about protecting the
 * database from a scripted replay rather than about guessing: an invalid token
 * is rejected before any query, a valid one hits a join every time.
 */
const limitPropertyCertificate = rateLimitWithRedis({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" },
});

const router = Router();
const DEFAULT_PROPERTY_VERIFICATION_METHOD = "Site visit and listing review";

const HOME_PROPERTY_TYPE_CARDS = [
  { key: "HOTEL" },
  { key: "LODGE" },
  { key: "APARTMENT" },
  { key: "VILLA" },
  { key: "GUEST_HOUSE" },
  { key: "BUNGALOW" },
  { key: "CABIN" },
  { key: "HOMESTAY" },
  { key: "CONDO" },
  { key: "HOUSE" },
] as const;

const HOME_FEATURED_DESTINATIONS = [
  { city: "Dar es Salaam", filterParam: "region" },
  { city: "Nairobi", filterParam: "city" },
  { city: "Zanzibar", filterParam: "region" },
  { city: "Arusha", filterParam: "region" },
  { city: "Mwanza", filterParam: "region" },
  { city: "Dodoma", filterParam: "region" },
] as const;

function isMysqlSortMemoryError(err: any) {
  const code = err?.cause?.originalCode ?? err?.cause?.code ?? err?.code;
  const msg = err?.cause?.originalMessage ?? err?.message;
  return String(code) === "1038" || /Out of sort memory/i.test(String(msg || ""));
}

function parseIntOrUndefined(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function parseFloatOrUndefined(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function resolveWebOrigin(req?: any): string {
  const configured = [
    process.env.WEB_ORIGIN,
    process.env.FRONTEND_URL,
    process.env.APP_ORIGIN,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ];
  for (const value of configured) {
    const raw = String(value || "").trim().replace(/\/+$/, "");
    if (raw) return raw;
  }
  const proto = String(req?.headers?.["x-forwarded-proto"] || req?.protocol || "http").split(",")[0].trim();
  const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "localhost:3000").split(",")[0].trim();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function formatPublicLocation(p: any): string {
  return [p?.street, p?.ward, p?.district, p?.regionName, p?.country]
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .join(", ");
}

function parseCsv(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function expandPropertyTypeFilters(types: string[]): string[] {
  const aliases = new Set<string>();
  for (const raw of types) {
    const value = String(raw || "").trim();
    if (!value) continue;

    const spaced = value.replace(/_/g, " ").trim();
    const titled = spaced
      .toLowerCase()
      .replace(/\b\w/g, (ch) => ch.toUpperCase());

    aliases.add(value);
    aliases.add(value.toUpperCase());
    aliases.add(value.toLowerCase());
    aliases.add(spaced);
    aliases.add(spaced.toUpperCase());
    aliases.add(spaced.toLowerCase());
    aliases.add(titled);
  }
  return Array.from(aliases).filter(Boolean);
}

function toTitleLocation(value: string): string {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => (part === "es" ? "es" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function expandLocationAliases(value: string): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];

  const spaced = raw.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  const dashed = spaced.replace(/\s+/g, "-");
  const compact = spaced.replace(/\s+/g, "");
  const title = toTitleLocation(spaced);
  const aliases = new Set<string>([
    raw,
    raw.toUpperCase(),
    raw.toLowerCase(),
    spaced,
    spaced.toUpperCase(),
    spaced.toLowerCase(),
    dashed,
    dashed.toUpperCase(),
    dashed.toLowerCase(),
    compact,
    compact.toUpperCase(),
    compact.toLowerCase(),
    title,
  ]);

  if (spaced.toLowerCase() === "dar es salaam") {
    aliases.add("Dar es Salaam");
    aliases.add("DAR-ES-SALAAM");
    aliases.add("Dar-es-Salaam");
    aliases.add("DSM");
  }

  return Array.from(aliases).filter(Boolean);
}

function locationContainsClauses(field: "regionName" | "city" | "district" | "ward" | "street", value: string) {
  return expandLocationAliases(value).map((alias) => ({ [field]: { contains: alias } }));
}

function parseAmenities(v: any): string[] {
  const out = parseCsv(v);
  // cap to avoid abuse
  return out.slice(0, 50);
}

function extractIdFromSlug(idOrSlug: string): number | null {
  const raw = String(idOrSlug || "").trim();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  const m = raw.match(/(\d+)\s*$/);
  if (!m) return null;
  return Number(m[1]);
}

function bboxFromKm(lat: number, lng: number, radiusKm: number) {
  // Very good approximation for small radii.
  const kmPerDegLat = 111.32;
  const dLat = radiusKm / kmPerDegLat;
  const cos = Math.cos((lat * Math.PI) / 180);
  const kmPerDegLng = kmPerDegLat * Math.max(0.15, cos);
  const dLng = radiusKm / kmPerDegLng;
  return {
    minLat: lat - dLat,
    maxLat: lat + dLat,
    minLng: lng - dLng,
    maxLng: lng + dLng,
  };
}

/**
 * Batch-resolve the primary image URL for a list of property IDs using
 * the same 3-tier COALESCE used in the raw-SQL browse paths:
 *   Tier 1 — thumbnailUrl from property_images WHERE status IN (READY, PROCESSING)
 *   Tier 2 — any url from property_images (catches PENDING / no-status rows)
 *   Tier 3 — JSON_EXTRACT(photos, '$[0]') legacy fallback
 *
 * This is the permanent fix for images disappearing when filters are active.
 * The filtered code path previously used a Prisma relation that only included
 * READY/PROCESSING images, so any property whose images were still PENDING
 * would silently fall back to the photos JSON field, which is often empty or
 * contains base64 data URIs that are rejected by isRenderablePublicImageUrl.
 */
async function batchResolvePrimaryImages(ids: number[]): Promise<Map<number, string | null>> {
  if (ids.length === 0) return new Map();
  try {
    const rows = (await prisma.$queryRaw(
      Prisma.sql`
        SELECT p.id,
          COALESCE(
            (SELECT pi.thumbnailUrl FROM \`property_images\` pi
              WHERE pi.propertyId = p.id
                AND pi.status IN ('READY','PROCESSING')
                AND pi.thumbnailUrl IS NOT NULL
              ORDER BY pi.id ASC LIMIT 1),
            (SELECT pi.url FROM \`property_images\` pi
              WHERE pi.propertyId = p.id
                AND pi.url IS NOT NULL
              ORDER BY pi.id ASC LIMIT 1),
            (SELECT legacy.url
              FROM JSON_TABLE(
                p.photos,
                '$[*]' COLUMNS (
                  photoOrder FOR ORDINALITY,
                  url VARCHAR(2048) PATH '$'
                )
              ) legacy
              WHERE legacy.url IS NOT NULL
                AND legacy.url <> ''
                AND legacy.url NOT LIKE 'data:%'
                AND legacy.url NOT LIKE 'blob:%'
                AND legacy.url NOT LIKE 'file:%'
              ORDER BY legacy.photoOrder ASC
              LIMIT 1)
          ) AS primaryImage
        FROM \`property\` p
        WHERE p.id IN (${Prisma.join(ids)})
      `
    )) as Array<{ id: number; primaryImage: string | null }>;
    return new Map<number, string | null>(
      (rows || []).map((r) => [Number(r.id), r.primaryImage ?? null])
    );
  } catch {
    // If the batch query fails (e.g. property_images table not yet migrated),
    // return an empty map — toPublicCard will fall back to pickImages(photos).
    return new Map();
  }
}

/** Merge a primaryImage map into an items array (mutates each item in-place). */
function applyPrimaryImages(items: any[], imgMap: Map<number, string | null>): any[] {
  if (imgMap.size === 0) return items;
  return items.map((p: any) => ({ ...p, primaryImage: imgMap.get(Number(p.id)) ?? null }));
}

async function resolveLegacyPhotoUrls(propertyId: number, limit = 24): Promise<string[]> {
  try {
    const rows = (await prisma.$queryRaw(
      Prisma.sql`
        SELECT legacy.url
        FROM \`property\` p
        JOIN JSON_TABLE(
          p.photos,
          '$[*]' COLUMNS (
            photoOrder FOR ORDINALITY,
            url VARCHAR(2048) PATH '$'
          )
        ) legacy
        WHERE p.id = ${propertyId}
          AND legacy.url IS NOT NULL
          AND legacy.url <> ''
          AND legacy.url NOT LIKE 'data:%'
          AND legacy.url NOT LIKE 'blob:%'
          AND legacy.url NOT LIKE 'file:%'
        ORDER BY legacy.photoOrder ASC
        LIMIT ${Math.max(1, Math.min(48, limit))}
      `
    )) as Array<{ url: string | null }>;

    return (rows || [])
      .map((row) => (typeof row.url === "string" ? row.url.trim() : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * GET /api/public/properties
 * Public browse/search endpoint for APPROVED properties only.
 */
const listPublicProperties: RequestHandler = async (req, res) => {
  const q = String((req.query as any)?.q ?? "").trim();
  const region = String((req.query as any)?.region ?? "").trim();
  const district = String((req.query as any)?.district ?? "").trim();
  const ward = String((req.query as any)?.ward ?? "").trim();
  const street = String((req.query as any)?.street ?? "").trim();
  const city = String((req.query as any)?.city ?? "").trim();
  const types = parseCsv((req.query as any)?.types ?? (req.query as any)?.type);
  const typeFilters = expandPropertyTypeFilters(types);
  const amenities = parseAmenities((req.query as any)?.amenities ?? (req.query as any)?.services);
  const nearbyServices = parseCsv((req.query as any)?.nearbyServices);
  const paymentModes = parseCsv((req.query as any)?.paymentModes);
  const freeCancellation = String((req.query as any)?.freeCancellation ?? "").trim();
  const groupStay = String((req.query as any)?.groupStay ?? "").trim();

  const tourismSiteSlug = String((req.query as any)?.tourismSiteSlug ?? (req.query as any)?.tourismSite ?? "").trim();
  const parkPlacementRaw = String((req.query as any)?.parkPlacement ?? "").trim();
  const parkPlacement = parkPlacementRaw === "INSIDE" || parkPlacementRaw === "NEARBY" ? parkPlacementRaw : "";

  const minPrice = parseIntOrUndefined((req.query as any)?.minPrice);
  const maxPrice = parseIntOrUndefined((req.query as any)?.maxPrice);
  const guests = parseIntOrUndefined((req.query as any)?.guests);
  const nearLat = parseFloatOrUndefined((req.query as any)?.nearLat);
  const nearLng = parseFloatOrUndefined((req.query as any)?.nearLng);
  const radiusKm = Math.min(100, Math.max(1, parseFloatOrUndefined((req.query as any)?.radiusKm) ?? 15));

  const page = Math.max(1, parseIntOrUndefined((req.query as any)?.page) ?? 1);
  const pageSize = Math.min(50, Math.max(1, parseIntOrUndefined((req.query as any)?.pageSize) ?? 20));
  const skip = (page - 1) * pageSize;

  const sort = String((req.query as any)?.sort ?? "newest");

  const where: any = {
    status: "APPROVED",
  };

  // IMPORTANT: Do not filter via relation `tourismSite.slug` here.
  // Prisma will generate a JOIN which can trigger MariaDB/MySQL "Out of sort memory" errors
  // for otherwise simple list queries. Resolve the slug to an id first, then filter on the
  // indexed Property.tourismSiteId column.
  if (tourismSiteSlug) {
    try {
      const site = await prisma.tourismSite.findUnique({
        where: { slug: tourismSiteSlug },
        select: { id: true },
      });
      if (!site) return res.json({ items: [], total: 0, page, pageSize });
      where.tourismSiteId = site.id;
    } catch (e: any) {
      // If DB migrations haven't been applied yet (missing TourismSite table), fail soft.
      if (e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2021" || e.code === "P2022")) {
        return res.json({ items: [], total: 0, page, pageSize, warning: "db_not_migrated" });
      }
      throw e;
    }

    // When browsing a specific tourism site, only show properties that the owner explicitly
    // linked to that site AND marked as INSIDE/NEARBY.
    // If a specific parkPlacement is requested, honor it.
    where.parkPlacement = parkPlacement ? parkPlacement : { in: ["INSIDE", "NEARBY"] };
  }
  // Allow explicit placement filtering for general browse (no tourismSiteSlug)
  if (!tourismSiteSlug && parkPlacement) {
    where.parkPlacement = parkPlacement;
  }

  if (q) {
    where.OR = [
      { title: { contains: q } },
      { regionName: { contains: q } },
      { district: { contains: q } },
      { ward: { contains: q } },
      { city: { contains: q } },
      { street: { contains: q } },
    ];

    // A property may not mention a park by name (e.g. its title is "Riverside Lodge"),
    // but the owner may have linked it to a TourismSite (e.g. "Serengeti National Park")
    // and marked it as INSIDE/NEARBY. Resolve matching sites by name and surface those
    // properties too, so searching "Serengeti" or "Ngorongoro" finds them.
    try {
      const matchingSites = await prisma.tourismSite.findMany({
        where: { name: { contains: q } },
        select: { id: true },
      });
      if (matchingSites.length > 0) {
        where.OR.push({ tourismSiteId: { in: matchingSites.map((s) => s.id) } });
      }
    } catch (e: any) {
      // Fail soft if the TourismSite table isn't migrated yet.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2021" || e.code === "P2022"))) {
        throw e;
      }
    }
  }

  if (region) {
    // Support regionId (e.g. "11") and regionName variants:
    // "Dar es Salaam", "DAR-ES-SALAAM", "dar-es-salaam", etc.
    where.AND = Array.isArray(where.AND) ? where.AND : [];
    where.AND.push({
      OR: [{ regionId: region }, ...locationContainsClauses("regionName", region)],
    });
  }
  if (district) {
    where.AND = Array.isArray(where.AND) ? where.AND : [];
    where.AND.push({ OR: locationContainsClauses("district", district) });
  }
  if (ward) {
    where.AND = Array.isArray(where.AND) ? where.AND : [];
    where.AND.push({ OR: locationContainsClauses("ward", ward) });
  }
  if (street) {
    where.AND = Array.isArray(where.AND) ? where.AND : [];
    where.AND.push({ OR: locationContainsClauses("street", street) });
  }
  if (city) {
    where.AND = Array.isArray(where.AND) ? where.AND : [];
    where.AND.push({ OR: locationContainsClauses("city", city) });
  }
  if (typeFilters.length > 0) where.type = { in: typeFilters };

  // Services filter: Property.services is Json (array of strings)
  // We implement "must include all selected tags" via JSON_CONTAINS (MySQL).
  // This avoids incorrect pagination that would happen with in-memory filtering.
  const serviceTags = [
    ...amenities,
    ...nearbyServices,
    ...paymentModes.map((m) => `Payment: ${m}`),
    ...(freeCancellation ? ["Free cancellation"] : []),
    ...(groupStay ? ["Group stay"] : []),
  ];
  if (serviceTags.length > 0) {
    try {
      const clauses: Prisma.Sql[] = [
        Prisma.sql`status = 'APPROVED'`,
      ];
      for (const tag of serviceTags) {
        const needle = JSON.stringify(tag); // e.g. "\"Pool\""
        // Guard against legacy rows or non-JSON column types.
        clauses.push(
          Prisma.sql`(services IS NOT NULL AND JSON_VALID(services) AND JSON_CONTAINS(CAST(services AS JSON), ${needle}))`
        );
      }

      const servicesWhere = Prisma.join(clauses, " AND ");
      const idsRows = (await prisma.$queryRaw(
        Prisma.sql`SELECT id FROM \`property\` WHERE ${servicesWhere}`
      )) as Array<{ id: number }>;
      const ids = (idsRows || []).map((r: { id: number }) => Number(r.id)).filter((n: number) => Number.isFinite(n));
      // If no ids match, we can return early.
      if (ids.length === 0) return res.json({ items: [], total: 0, page, pageSize });
      where.id = { in: ids };
    } catch (e) {
      // If JSON filtering fails (e.g. DB not migrated yet), fail soft by returning no results
      console.error("[public.properties] services filter failed", e);
      return res.json({ items: [], total: 0, page, pageSize, warning: "services_filter_unavailable" });
    }
  }

  if (minPrice !== undefined || maxPrice !== undefined) {
    where.basePrice = {
      ...(minPrice !== undefined ? { gte: minPrice } : {}),
      ...(maxPrice !== undefined ? { lte: maxPrice } : {}),
    };
  }

  if (guests !== undefined) {
    where.maxGuests = { gte: guests };
  }

  // Nearby filter (lat/lng required)
  if (typeof nearLat === "number" && typeof nearLng === "number") {
    const box = bboxFromKm(nearLat, nearLng, radiusKm);
    where.AND = Array.isArray(where.AND) ? where.AND : [];
    where.AND.push(
      { latitude: { not: null } },
      { longitude: { not: null } },
      { latitude: { gte: box.minLat, lte: box.maxLat } },
      { longitude: { gte: box.minLng, lte: box.maxLng } }
    );
  }

  const orderBy: any[] = [];
  // NOTE: Avoid MySQL "Out of sort memory" errors on large tables by sorting on indexed PK.
  // "newest" is approximated by highest id (monotonic in our schema).
  if (sort === "price_asc") orderBy.push({ basePrice: "asc" }, { id: "desc" });
  else if (sort === "price_desc") orderBy.push({ basePrice: "desc" }, { id: "desc" });
  else orderBy.push({ id: "desc" });

  try {
    // Generate cache key from query parameters
    const cacheKey = cacheKeys.propertyList({
      q, region, district, ward, city, street,
      types, amenities, nearbyServices, paymentModes,
      freeCancellation, groupStay,
      tourismSiteSlug, parkPlacement,
      minPrice, maxPrice, guests,
      nearLat, nearLng, radiusKm,
      page, pageSize, sort,
    });

    const { result, duration } = await measureTime('public.properties.list', async () => {
      return await withCache(
        cacheKey,
        async () => {
          let items: any[] = [];
          let total = 0;

          try {
            const isParkBrowse =
              !!tourismSiteSlug &&
              !q &&
              !region &&
              !district &&
              !ward &&
              !street &&
              !city &&
              !parkPlacement &&
              serviceTags.length === 0 &&
              minPrice === undefined &&
              maxPrice === undefined &&
              guests === undefined &&
              !(typeof nearLat === "number" && typeof nearLng === "number") &&
              sort !== "price_asc" &&
              sort !== "price_desc";

            const isSimpleBrowse =
              !q &&
              !region &&
              !district &&
              !ward &&
              !street &&
              !city &&
              !tourismSiteSlug &&
              !parkPlacement &&
              serviceTags.length === 0 &&
              minPrice === undefined &&
              maxPrice === undefined &&
              guests === undefined &&
              !(typeof nearLat === "number" && typeof nearLng === "number") &&
              sort !== "price_asc" &&
              sort !== "price_desc";

            const isLatestApprovedTypeBrowse =
              sort === "latest_approved" &&
              types.length > 0 &&
              !q &&
              !region &&
              !district &&
              !ward &&
              !street &&
              !city &&
              !tourismSiteSlug &&
              !parkPlacement &&
              serviceTags.length === 0 &&
              minPrice === undefined &&
              maxPrice === undefined &&
              guests === undefined &&
              !(typeof nearLat === "number" && typeof nearLng === "number");

            if (isLatestApprovedTypeBrowse) {
              const rows = (await prisma.$queryRaw(
                Prisma.sql`
                  SELECT
                    p.id, p.title, p.type, p.parkPlacement, p.regionName,
                    p.district, p.ward, p.street, p.city, p.country,
                    p.services, p.basePrice, p.currency, p.roomsSpec,
                    p.maxGuests, p.totalBedrooms, p.totalBathrooms,
                    COALESCE(
                      (SELECT pi.thumbnailUrl FROM \`property_images\` pi
                        WHERE pi.propertyId = p.id
                          AND pi.status IN ('READY','PROCESSING')
                          AND pi.thumbnailUrl IS NOT NULL
                        ORDER BY pi.id ASC LIMIT 1),
                      (SELECT pi.url FROM \`property_images\` pi
                        WHERE pi.propertyId = p.id
                          AND pi.url IS NOT NULL
                        ORDER BY pi.id ASC LIMIT 1),
                      CASE
                        WHEN JSON_EXTRACT(p.photos, '$[0]') IS NOT NULL
                          AND JSON_UNQUOTE(JSON_EXTRACT(p.photos, '$[0]')) != ''
                        THEN JSON_UNQUOTE(JSON_EXTRACT(p.photos, '$[0]'))
                        ELSE NULL
                      END
                    ) AS primaryImage
                  FROM \`property\` p
                  LEFT JOIN (
                    SELECT entityId, MAX(createdAt) AS approvedAt
                    FROM \`auditlog\` FORCE INDEX (\`idx_AuditLog_entity_entityId_id\`)
                    WHERE entity = 'PROPERTY'
                      AND action IN ('PROPERTY_APPROVE', 'PROPERTY_UNSUSPEND')
                    GROUP BY entityId
                  ) latestApproval ON latestApproval.entityId = p.id
                  WHERE p.status = 'APPROVED'
                    AND p.type IN (${Prisma.join(typeFilters.map((t) => Prisma.sql`${t}`))})
                  ORDER BY COALESCE(latestApproval.approvedAt, p.updatedAt, p.createdAt) DESC, p.id DESC
                  LIMIT ${pageSize} OFFSET ${skip}
                `
              )) as any[];

              items = rows || [];
              total = await prisma.property.count({ where });
            } else if (isParkBrowse) {
              // Park/tourism-site browsing can still trigger MariaDB "Out of sort memory" even
              // with ORDER BY id when the optimizer chooses a non-PK index and then filesorts.
              // Use a PK-desc scan for ids and then hydrate rows.
              const tourismSiteId = Number(where.tourismSiteId);
              if (!Number.isFinite(tourismSiteId)) return { items: [], total: 0, page, pageSize };

              const typeClause = typeFilters.length
                ? Prisma.sql` AND type IN (${Prisma.join(typeFilters.map((t) => Prisma.sql`${t}`))})`
                : Prisma.empty;

              const placementClause = parkPlacement
                ? Prisma.sql` AND parkPlacement = ${parkPlacement}`
                : Prisma.sql` AND parkPlacement IN ('INSIDE','NEARBY')`;

              const idsRows = (await prisma.$queryRaw(
                Prisma.sql`
                  SELECT id
                  FROM \`property\`
                  FORCE INDEX (PRIMARY)
                  WHERE status = 'APPROVED'
                    AND tourismSiteId = ${tourismSiteId}
                    ${placementClause}
                    ${typeClause}
                  ORDER BY id DESC
                  LIMIT ${pageSize} OFFSET ${skip}
                `
              )) as Array<{ id: number }>;
              const ids = (idsRows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));

              // Use a single raw query instead of findMany to avoid fetching the
              // large photos JSON blob. JSON_EXTRACT pulls only the first photo URL.
              // We only return a non-base64 fallback to keep card responses lightweight.
              const [rows, cnt] = await Promise.all([
                ids.length
                  ? (prisma.$queryRaw(
                      Prisma.sql`
                        SELECT
                          p.id, p.title, p.type, p.parkPlacement, p.regionName,
                          p.district, p.ward, p.street, p.city, p.country,
                          p.services, p.basePrice, p.currency, p.roomsSpec,
                          p.maxGuests, p.totalBedrooms, p.totalBathrooms,
                          COALESCE(
                            (SELECT pi.thumbnailUrl FROM \`property_images\` pi
                              WHERE pi.propertyId = p.id
                                AND pi.status IN ('READY','PROCESSING')
                                AND pi.thumbnailUrl IS NOT NULL
                              ORDER BY pi.id ASC LIMIT 1),
                            (SELECT pi.url FROM \`property_images\` pi
                              WHERE pi.propertyId = p.id
                                AND pi.url IS NOT NULL
                              ORDER BY pi.id ASC LIMIT 1),
                            -- Fall back to photos[0] from legacy JSON field
                            CASE 
                              WHEN JSON_EXTRACT(p.photos, '$[0]') IS NOT NULL 
                                AND JSON_UNQUOTE(JSON_EXTRACT(p.photos, '$[0]')) != ''
                              THEN JSON_UNQUOTE(JSON_EXTRACT(p.photos, '$[0]'))
                              ELSE NULL
                            END
                          ) AS primaryImage
                        FROM \`property\` p
                        WHERE p.id IN (${Prisma.join(ids)})
                      `
                    ) as Promise<any[]>)
                  : Promise.resolve([] as any[]),
                prisma.property.count({ where }),
              ]);

              const byId = new Map<number, any>((rows as any[]).map((r) => [Number(r.id), r]));
              items = ids.map((id) => byId.get(id)).filter(Boolean);
              total = cnt as number;
            } else if (isSimpleBrowse) {
              // MariaDB can throw "Out of sort memory" when it picks a non-PK index for filters
              // and then needs a filesort for ORDER BY. Force a PK scan (descending) and apply
              // filters as it scans until it collects enough ids.
              const typeClause = typeFilters.length
                ? Prisma.sql` AND type IN (${Prisma.join(typeFilters.map((t) => Prisma.sql`${t}`))})`
                : Prisma.empty;

              const idsRows = (await prisma.$queryRaw(
                Prisma.sql`
                  SELECT id
                  FROM \`property\`
                  FORCE INDEX (PRIMARY)
                  WHERE status = 'APPROVED'
                  ${typeClause}
                  ORDER BY id DESC
                  LIMIT ${pageSize} OFFSET ${skip}
                `
              )) as Array<{ id: number }>;
              const ids = (idsRows || []).map((r) => Number(r.id)).filter((n) => Number.isFinite(n));

              // Use raw SQL to avoid fetching the large photos blob — JSON_EXTRACT(photos, '$[0]')
              // returns only the first photo URL without transferring all base64 image data.
              // Only non-base64 fallbacks are used so card responses stay lightweight.
              const [rows, cnt] = await Promise.all([
                ids.length
                  ? (prisma.$queryRaw(
                      Prisma.sql`
                        SELECT
                          p.id, p.title, p.type, p.parkPlacement, p.regionName,
                          p.district, p.ward, p.street, p.city, p.country,
                          p.services, p.basePrice, p.currency, p.roomsSpec,
                          p.maxGuests, p.totalBedrooms, p.totalBathrooms,
                          COALESCE(
                            (SELECT pi.thumbnailUrl FROM \`property_images\` pi
                              WHERE pi.propertyId = p.id
                                AND pi.status IN ('READY','PROCESSING')
                                AND pi.thumbnailUrl IS NOT NULL
                              ORDER BY pi.id ASC LIMIT 1),
                            (SELECT pi.url FROM \`property_images\` pi
                              WHERE pi.propertyId = p.id
                                AND pi.url IS NOT NULL
                              ORDER BY pi.id ASC LIMIT 1),
                            -- Fall back to photos[0] from legacy JSON field
                            CASE 
                              WHEN JSON_EXTRACT(p.photos, '$[0]') IS NOT NULL 
                                AND JSON_UNQUOTE(JSON_EXTRACT(p.photos, '$[0]')) != ''
                              THEN JSON_UNQUOTE(JSON_EXTRACT(p.photos, '$[0]'))
                              ELSE NULL
                            END
                          ) AS primaryImage
                        FROM \`property\` p
                        WHERE p.id IN (${Prisma.join(ids)})
                      `
                    ) as Promise<any[]>)
                  : Promise.resolve([] as any[]),
                prisma.property.count({ where }),
              ]);

              const byId = new Map<number, any>((rows as any[]).map((r) => [Number(r.id), r]));
              items = ids.map((id) => byId.get(id)).filter(Boolean);
              total = cnt as number;
            } else {
              const [dbItems, cnt] = await Promise.all([
                prisma.property.findMany({
                  where,
                  skip,
                  take: pageSize,
                  orderBy,
                  select: {
                    id: true,
                    title: true,
                    type: true,
                    parkPlacement: true,
                    regionName: true,
                    district: true,
                    ward: true,
                    street: true,
                    city: true,
                    country: true,
                    services: true,
                    basePrice: true,
                    currency: true,
                    roomsSpec: true,
                    maxGuests: true,
                    totalBedrooms: true,
                    totalBathrooms: true,
                  },
                }),
                prisma.property.count({ where }),
              ]);
              items = dbItems as any[];
              total = cnt as number;
              // Resolve primary images for all filtered results in one query.
              const imgMap = await batchResolvePrimaryImages(
                items.map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n))
              );
              items = applyPrimaryImages(items, imgMap);
            }
          } catch (e) {
            if ((sort === "price_asc" || sort === "price_desc") && isMysqlSortMemoryError(e)) {
              console.warn("public.properties.list price sort exceeded DB sort memory; falling back to newest", e);
              const fallbackOrderBy = [{ id: "desc" }];
              const [fbItems, fbCnt] = await Promise.all([
                prisma.property.findMany({
                  where,
                  skip,
                  take: pageSize,
                  orderBy: fallbackOrderBy,
                  select: {
                    id: true,
                    title: true,
                    type: true,
                    parkPlacement: true,
                    regionName: true,
                    district: true,
                    ward: true,
                    street: true,
                    city: true,
                    country: true,
                    services: true,
                    basePrice: true,
                    currency: true,
                    roomsSpec: true,
                    maxGuests: true,
                    totalBedrooms: true,
                    totalBathrooms: true,
                  },
                }),
                prisma.property.count({ where }),
              ]);
              const fbImgMap = await batchResolvePrimaryImages(
                (fbItems as any[]).map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n))
              );
              const fbItemsWithImages = applyPrimaryImages(fbItems as any[], fbImgMap);
              const dto = fbItemsWithImages.map(toPublicCard);
              return {
                items: dto,
                total: fbCnt as number,
                page,
                pageSize,
                warning: "price_sort_fallback_newest",
              };
            }

            // Fail-soft for environments where DB migrations aren't fully applied yet
            // (missing columns like ward/street or missing relations like images).
            console.warn("public.properties.list falling back to minimal select", e);

            const [minItems, minCnt] = await Promise.all([
              prisma.property.findMany({
                where,
                skip,
                take: pageSize,
                orderBy,
                select: {
                  id: true,
                  title: true,
                  type: true,
                  parkPlacement: true,
                  regionName: true,
                  district: true,
                  city: true,
                  country: true,
                  services: true,
                  basePrice: true,
                  currency: true,
                  roomsSpec: true,
                  maxGuests: true,
                  totalBedrooms: true,
                  totalBathrooms: true,
                },
              }),
              prisma.property.count({ where }),
            ]);
            const minImgMap = await batchResolvePrimaryImages(
              (minItems as any[]).map((p: any) => Number(p.id)).filter((n: number) => Number.isFinite(n))
            );
            items = applyPrimaryImages(minItems as any[], minImgMap);
            total = minCnt as number;
          }

          const dto = (items || []).map(toPublicCard);
          return { items: dto, total, page, pageSize };
        },
        {
          ttl: 300, // Cache for 5 minutes (property listings don't change frequently)
          tags: [cacheTags.propertyList],
        }
      );
    });

    // Add performance headers
    res.set('X-Response-Time', `${duration.toFixed(2)}ms`);
    // Avoid HTTP-level caching so newly approved/linked properties appear immediately.
    // Redis caching (withCache) still provides performance benefits.
    res.set('Cache-Control', 'no-store');
    
    return res.json(result);
  } catch (err: any) {
    console.error("public.properties.list failed", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      return res.json({ items: [], total: 0, page, pageSize, warning: "db_not_migrated" });
    }
    return res.status(500).json({ error: "failed", message: err?.message || String(err) });
  }
};

/**
 * GET /api/public/properties/:idOrSlug
 * Public details endpoint for an APPROVED property.
 */
const getPublicProperty: RequestHandler = async (req, res) => {
  const idOrSlug = String((req.params as any)?.idOrSlug ?? "");
  const id = extractIdFromSlug(idOrSlug);
  if (!id) return res.status(400).json({ error: "invalid_id" });

  try {
    const { result, duration } = await measureTime(`public.properties.get:${id}`, async () => {
      return await withCache(
        cacheKeys.property(id),
        async () => {
          const p = await prisma.property.findFirst({
            where: { id, status: "APPROVED" },
            select: {
              id: true,
              title: true,
              type: true,
              status: true,
              description: true,
              buildingType: true,
              totalFloors: true,
              regionName: true,
              district: true,
              ward: true,
              city: true,
              street: true,
              country: true,
              latitude: true,
              longitude: true,
              basePrice: true,
              currency: true,
              maxGuests: true,
              totalBedrooms: true,
              totalBathrooms: true,
              services: true,
              roomsSpec: true,
              ownerId: true, // Include ownerId to check ownership on frontend
              nrmsActivatedAt: true,
              nrmsMenuPublic: true,
              images: {
                where: {
                  // Show all uploaded images on public details as long as they're not rejected.
                  // Some uploads can remain PENDING/PROCESSING for a while, but should still count/display.
                  status: { in: ["READY", "PROCESSING", "PENDING"] },
                  url: { not: null }, // Ensure URL exists
                },
                select: { url: true, thumbnailUrl: true, status: true },
                orderBy: { createdAt: "asc" },
              },
            },
          });

          if (!p) return null;

          const [legacyPhotos, physicalVerification] = await Promise.all([
            resolveLegacyPhotoUrls(id),
            prisma.$queryRaw(
              Prisma.sql`
                SELECT
                  pv.\`id\`,
                  pv.\`status\`,
                  pv.\`verifiedAt\`,
                  pv.\`method\`,
                  pv.\`note\`,
                  pv.\`checklist\`,
                  u.\`fullName\` AS \`verifierFullName\`,
                  u.\`name\` AS \`verifierName\`
                FROM \`property_verification\` pv
                LEFT JOIN \`user\` u ON u.\`id\` = pv.\`verifiedBy\`
                WHERE pv.\`propertyId\` = ${id}
                LIMIT 1
              `
            ).then((rows: any) => {
              const row = Array.isArray(rows) ? rows[0] : null;
              return row
                ? {
                    id: row.id,
                    status: row.status,
                    verifiedAt: row.verifiedAt,
                    method: row.method,
                    note: row.note,
                    checklist: row.checklist,
                    verifier: {
                      fullName: row.verifierFullName,
                      name: row.verifierName,
                    },
                  }
                : null;
            }).catch(() => null),
          ]);

          let verificationUrl: string | null = null;
          let qrCodeDataUrl: string | null = null;
          if (physicalVerification?.status === "VERIFIED" && Number.isFinite(Number(physicalVerification.id))) {
            const verificationToken = signPropertyVerificationToken(id, Number(physicalVerification.id));
            verificationUrl = `${resolveWebOrigin(req)}/verify/property?t=${encodeURIComponent(verificationToken)}`;
            qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
              margin: 1,
              width: 260,
              errorCorrectionLevel: "M",
            });
          }

          // A guest browsing before booking never needs a room/table QR to
          // see the menu: the read-only PREVIEW order point stands in for one.
          let nrmsMenuUrl: string | null = null;
          if (p.nrmsActivatedAt && p.nrmsMenuPublic) {
            const previewPoint = await prisma.nrmsOrderPoint.findFirst({
              where: { propertyId: id, type: "PREVIEW", active: true },
              select: { token: true },
            });
            if (previewPoint) nrmsMenuUrl = buildMenuUrl(previewPoint.token);
          }

          const dto = toPublicDetail({
            ...p,
            nrmsMenuUrl,
            photos: legacyPhotos,
            physicalVerification: {
              status: "VERIFIED",
              verifiedAt: physicalVerification?.verifiedAt ?? null,
              method: physicalVerification?.method ?? DEFAULT_PROPERTY_VERIFICATION_METHOD,
              note: physicalVerification?.note ?? "This stay is listed publicly after NoLSAF approval.",
              checklist: physicalVerification?.checklist ?? null,
              verifier: physicalVerification?.verifier ?? null,
              verificationUrl,
              qrCodeDataUrl,
            },
          });
          return { property: dto };
        },
        {
          skipCache: true,
          ttl: 600, // Cache for 10 minutes (property details change less frequently)
          tags: [cacheTags.property(id), cacheTags.propertyList],
        }
      );
    });

    if (!result || !result.property) {
      return res.status(404).json({ error: "not_found" });
    }

    // Add performance headers
    res.set('X-Response-Time', `${duration.toFixed(2)}ms`);
    // Avoid HTTP-level caching so updated property details appear immediately.
    // Redis caching (withCache) still provides performance benefits.
    res.set('Cache-Control', 'no-store');
    
    return res.json(result);
  } catch (err: any) {
    console.error("public.properties.get failed", err);
    return res.status(500).json({ error: "failed", message: err?.message || String(err) });
  }
};

router.get("/", listPublicProperties);

/**
 * GET /api/public/properties/home-summary
 * Batches public-home counters/samples so the landing page does not fan out
 * into many browser API calls on every load.
 */
const homeSummary: RequestHandler = async (_req, res) => {
  try {
    const { result, duration } = await measureTime("public.properties.homeSummary", async () => {
      return await withCache(
        publicCacheKey("properties-home-summary", { version: 2 }),
        async () => {
          const aliasesByKey = new Map<string, Set<string>>();
          const allTypeAliases = new Set<string>();
          for (const card of HOME_PROPERTY_TYPE_CARDS) {
            const aliases = new Set(expandPropertyTypeFilters([card.key]));
            aliasesByKey.set(card.key, aliases);
            for (const alias of aliases) allTypeAliases.add(alias);
          }

          const allTypeAliasList = Array.from(allTypeAliases);

          const trustPartnersPromise = prisma.trustPartner
            .findMany({
              where: { isActive: true },
              orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
              select: {
                id: true,
                name: true,
                logoUrl: true,
                href: true,
              },
            })
            .catch((err: any) => {
              if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
                return [];
              }
              throw err;
            });

          const groupedTypesPromise = allTypeAliasList.length
            ? prisma.property.groupBy({
                by: ["type"],
                where: {
                  status: "APPROVED",
                  type: { in: allTypeAliasList },
                },
                _count: { type: true },
              })
            : Promise.resolve([]);

          const typeSampleRowsPromise = allTypeAliasList.length
            ? (prisma.$queryRaw(
                Prisma.sql`
                  SELECT
                    p.id, p.title, p.type, p.parkPlacement, p.regionName,
                    p.district, p.ward, p.street, p.city, p.country,
                    p.services, p.basePrice, p.currency, p.roomsSpec,
                    p.maxGuests, p.totalBedrooms, p.totalBathrooms,
                    COALESCE(
                      (SELECT pi.thumbnailUrl FROM \`property_images\` pi
                        WHERE pi.propertyId = p.id
                          AND pi.status IN ('READY','PROCESSING','PENDING')
                          AND pi.thumbnailUrl IS NOT NULL
                          AND pi.thumbnailUrl NOT LIKE 'data:%'
                          AND pi.thumbnailUrl NOT LIKE 'blob:%'
                          AND pi.thumbnailUrl NOT LIKE 'file:%'
                        ORDER BY pi.updatedAt DESC, pi.createdAt DESC, pi.id DESC LIMIT 1),
                      (SELECT pi.url FROM \`property_images\` pi
                        WHERE pi.propertyId = p.id
                          AND pi.status IN ('READY','PROCESSING','PENDING')
                          AND pi.url IS NOT NULL
                          AND pi.url NOT LIKE 'data:%'
                          AND pi.url NOT LIKE 'blob:%'
                          AND pi.url NOT LIKE 'file:%'
                        ORDER BY pi.updatedAt DESC, pi.createdAt DESC, pi.id DESC LIMIT 1),
                      CASE
                        WHEN JSON_EXTRACT(p.photos, '$[0]') IS NOT NULL
                          AND JSON_UNQUOTE(JSON_EXTRACT(p.photos, '$[0]')) != ''
                        THEN JSON_UNQUOTE(JSON_EXTRACT(p.photos, '$[0]'))
                        ELSE NULL
                      END
                    ) AS primaryImage
                  FROM \`property\` p
                  LEFT JOIN (
                    SELECT entityId, MAX(createdAt) AS approvedAt
                    FROM \`auditlog\` FORCE INDEX (\`idx_AuditLog_entity_entityId_id\`)
                    WHERE entity = 'PROPERTY'
                      AND action IN ('PROPERTY_APPROVE', 'PROPERTY_UNSUSPEND')
                    GROUP BY entityId
                  ) latestApproval ON latestApproval.entityId = p.id
                  WHERE p.status = 'APPROVED'
                    AND p.type IN (${Prisma.join(allTypeAliasList.map((t) => Prisma.sql`${t}`))})
                  ORDER BY p.updatedAt DESC, COALESCE(latestApproval.approvedAt, p.createdAt) DESC, p.id DESC
                  LIMIT ${HOME_PROPERTY_TYPE_CARDS.length * 12}
                `
              ) as Promise<any[]>)
            : Promise.resolve([] as any[]);

          const destinationCountsPromise = Promise.all(
            HOME_FEATURED_DESTINATIONS.map(async (destination) => {
              const field = destination.filterParam === "region" ? "regionName" : "city";
              const total = await prisma.property.count({
                where: {
                  status: "APPROVED",
                  AND: [
                    {
                      OR: locationContainsClauses(field, destination.city),
                    },
                  ],
                },
              });
              return [destination.city, total] as const;
            })
          );

          const [trustPartners, groupedTypes, typeSampleRows, destinationCounts] = await Promise.all([
            trustPartnersPromise,
            groupedTypesPromise,
            typeSampleRowsPromise,
            destinationCountsPromise,
          ]);

          const typeCounts: Record<string, number | null> = {};
          const typeSamples: Record<string, PublicHomeSample | null> = {};
          for (const card of HOME_PROPERTY_TYPE_CARDS) {
            const aliases = aliasesByKey.get(card.key) ?? new Set<string>();
            typeCounts[card.key] = (groupedTypes as any[]).reduce((sum, row: any) => {
              return aliases.has(String(row.type || "")) ? sum + Number(row._count?.type ?? 0) : sum;
            }, 0);
            typeSamples[card.key] = null;
          }

          for (const row of typeSampleRows || []) {
            const rowType = String(row?.type || "");
            for (const card of HOME_PROPERTY_TYPE_CARDS) {
              if (typeSamples[card.key]) continue;
              const aliases = aliasesByKey.get(card.key);
              if (!aliases?.has(rowType)) continue;
              const cardDto = toPublicCard(row);
              typeSamples[card.key] = {
                title: cardDto.title,
                location: cardDto.location,
                primaryImage: cardDto.primaryImage,
                basePrice: cardDto.basePrice,
                currency: cardDto.currency,
              };
            }
          }

          const featuredCityCounts: Record<string, number | null> = {};
          for (const [city, total] of destinationCounts) {
            featuredCityCounts[city] = Number.isFinite(total) ? total : null;
          }

          return {
            trustPartners: {
              items: trustPartners,
            },
            propertyTypes: {
              counts: typeCounts,
              samples: typeSamples,
            },
            featuredDestinations: {
              counts: featuredCityCounts,
            },
          };
        },
        {
          ttl: 300,
          tags: [cacheTags.propertyList],
        }
      );
    });

    res.set("X-Response-Time", `${duration.toFixed(2)}ms`);
    res.set("Cache-Control", "no-store");
    return res.json(result);
  } catch (err: any) {
    console.error("public.properties.homeSummary failed", err);
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022")) {
      return res.json({
        trustPartners: { items: [] },
        propertyTypes: { counts: {}, samples: {} },
        featuredDestinations: { counts: {} },
        warning: "db_not_migrated",
      });
    }
    return res.status(500).json({ error: "failed", message: err?.message || String(err) });
  }
};

type PublicHomeSample = {
  title: string;
  location: string;
  primaryImage: string | null;
  basePrice: number | null;
  currency: string | null;
};

router.get("/home-summary", homeSummary);

/**
 * GET /api/public/properties/top-cities?take=8
 * Returns the top cities by number of APPROVED listings, plus a representative listing card.
 */
const topCities: RequestHandler = async (req, res) => {
  const take = Math.min(12, Math.max(1, parseIntOrUndefined((req.query as any)?.take) ?? 8));
  try {
    const grouped = await prisma.property.groupBy({
      by: ["city"],
      where: {
        status: "APPROVED",
        city: { not: null },
      },
      _count: { city: true },
      orderBy: { _count: { city: "desc" } },
      take: take * 2, // overfetch then clean empty strings
    });

    const cleaned = grouped
      .map((g: any) => ({ city: String(g.city || "").trim(), count: Number(g._count?.city ?? 0) }))
      .filter((g: { city: string; count: number }) => Boolean(g.city) && Number.isFinite(g.count) && g.count > 0)
      .slice(0, take);

    const items = await Promise.all(
      cleaned.map(async (g: { city: string; count: number }) => {
        const sample = await prisma.property.findFirst({
          where: { status: "APPROVED", city: g.city },
          // Avoid MySQL sort memory on updatedAt; id is indexed and stable for "newest".
          orderBy: { id: "desc" },
          select: {
            id: true,
            title: true,
            type: true,
            regionName: true,
            district: true,
            ward: true,
            street: true,
            city: true,
            country: true,
            basePrice: true,
            currency: true,
            roomsSpec: true,
            maxGuests: true,
            totalBedrooms: true,
            totalBathrooms: true,
            // photos omitted — large base64 blobs; use images relation instead
            images: {
              select: { url: true, thumbnailUrl: true, status: true },
              orderBy: { createdAt: "asc" },
              take: 6,
            },
          },
        });
        return {
          city: g.city,
          count: g.count,
          sample: sample ? toPublicCard(sample) : null,
        };
      })
    );

    return res.json({ items });
  } catch (err: any) {
    console.error("public.properties.topCities failed", err);
    return res.status(500).json({ error: "failed", message: err?.message || String(err) });
  }
};

router.get("/top-cities", topCities);

/**
 * GET /api/public/properties/verification?token=...
 * Public, no-login property verification certificate endpoint.
 */
router.get("/verification", limitPropertyCertificate as RequestHandler, (async (req, res) => {
  const token = String(req.query.token || req.query.t || "").trim();
  if (!token) return res.status(400).json({ ok: false, error: "missing_token" });

  const payload = verifyPropertyVerificationToken(token);
  if (!payload) return res.json({ ok: true, valid: false });

  try {
    const rows = (await prisma.$queryRaw(
      Prisma.sql`
        SELECT
          pv.\`id\`,
          pv.\`status\`,
          pv.\`verifiedAt\`,
          pv.\`method\`,
          pv.\`note\`,
          pv.\`checklist\`,
          u.\`fullName\` AS \`verifierFullName\`,
          u.\`name\` AS \`verifierName\`,
          p.\`id\` AS \`propertyId\`,
          p.\`title\`,
          p.\`type\`,
          p.\`regionName\`,
          p.\`district\`,
          p.\`ward\`,
          p.\`street\`,
          p.\`city\`,
          p.\`country\`,
          p.\`updatedAt\`
        FROM \`property_verification\` pv
        INNER JOIN \`property\` p ON p.\`id\` = pv.\`propertyId\`
        LEFT JOIN \`user\` u ON u.\`id\` = pv.\`verifiedBy\`
        WHERE pv.\`id\` = ${payload.verificationId}
          AND pv.\`propertyId\` = ${payload.propertyId}
          AND pv.\`status\` = 'VERIFIED'
          AND p.\`status\` = 'APPROVED'
        LIMIT 1
      `
    )) as any[];
    const row = Array.isArray(rows) ? rows[0] : null;
    const record = row
      ? {
          id: row.id,
          status: row.status,
          verifiedAt: row.verifiedAt,
          method: row.method,
          note: row.note,
          checklist: row.checklist,
          verifier: {
            fullName: row.verifierFullName,
            name: row.verifierName,
          },
          property: {
            id: row.propertyId,
            title: row.title,
            type: row.type,
            regionName: row.regionName,
            district: row.district,
            ward: row.ward,
            street: row.street,
            city: row.city,
            country: row.country,
            updatedAt: row.updatedAt,
          },
        }
      : null;

    if (!record?.property) return res.json({ ok: true, valid: false });

    const property = record.property;
    const checklist = Array.isArray(record.checklist)
      ? record.checklist.map((item: any) => String(item || "").trim()).filter(Boolean)
      : [];

    return res.json({
      ok: true,
      valid: true,
      certificate: {
        issuer: "NoLS Africa Co Ltd",
        property: {
          id: property.id,
          title: property.title,
          type: property.type,
          location: formatPublicLocation(property),
        },
        verification: {
          status: "VERIFIED",
          verifiedAt: record.verifiedAt ? new Date(record.verifiedAt).toISOString() : null,
          verifiedBy: record.verifier?.fullName || record.verifier?.name || "NoLSAF Admin",
          verifiedByRole: "ADMIN",
          method: record.method || DEFAULT_PROPERTY_VERIFICATION_METHOD,
          note: record.note || "This stay is listed publicly only after NoLSAF verification and approval.",
          checklist: checklist.length
            ? checklist
            : ["Property details reviewed", "Location and listing information checked", "Photos and stay information reviewed", "Host listing approved"],
          lastRefreshedAt: property.updatedAt ? new Date(property.updatedAt).toISOString() : null,
        },
      },
    });
  } catch (err) {
    console.error("[public property verification] failed", err);
    return res.status(500).json({ ok: false, error: "verification_failed" });
  }
}) as RequestHandler);

/**
 * GET /api/public/properties/availability?ids=1,2,3&date=YYYY-MM-DD
 * GET /api/public/properties/availability?ids=1&checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD&roomType=Single
 * Returns rooms-available counts for a set of properties on a given day
 * (or for a check-in/check-out range, optionally narrowed to a room type).
 */
router.get("/availability", (async (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
  if (ids.length === 0) return res.status(400).json({ error: "invalid_ids" });

  const dateParam = req.query.date ? String(req.query.date) : undefined;
  const checkInParam = req.query.checkIn ? String(req.query.checkIn) : undefined;
  const checkOutParam = req.query.checkOut ? String(req.query.checkOut) : undefined;
  const roomType = req.query.roomType ? String(req.query.roomType) : undefined;

  let startDate: Date;
  let endDate: Date;
  let dateLabel: string;

  if (checkInParam && checkOutParam) {
    startDate = new Date(`${checkInParam}T00:00:00.000Z`);
    endDate = new Date(`${checkOutParam}T00:00:00.000Z`);
    dateLabel = checkInParam;
  } else if (dateParam) {
    startDate = new Date(`${dateParam}T00:00:00.000Z`);
    endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
    dateLabel = dateParam;
  } else {
    return res.status(400).json({ error: "missing_date" });
  }

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
    return res.status(400).json({ error: "invalid_date" });
  }

  const items = await Promise.all(
    ids.map(async (id) => {
      try {
        const result = await calculateAvailability(id, startDate, endDate, null, roomType);
        // Sellable, not physically free: an owner who closed these dates in
        // NRMS must read as unavailable here, or a guest is walked all the way
        // to payment before anything objects.
        const closed = result.restrictions[0] ?? null;
        return {
          id,
          roomsAvailable: result.summary.totalSellableRooms,
          totalRooms: result.summary.totalRooms,
          // Kept separate so the owner-facing calendar can still see real capacity behind a closure.
          roomsPhysicallyFree: result.summary.totalAvailableRooms,
          closed: !!closed,
          closedReason: closed ? closed.message : null,
        };
      } catch {
        return { id, roomsAvailable: null, totalRooms: null, roomsPhysicallyFree: null, closed: false, closedReason: null };
      }
    })
  );

  return res.json({ date: dateLabel, items });
}) as RequestHandler);

/**
 * GET /api/public/properties/:id/booking-count
 * Returns total number of confirmed/paid bookings for a property.
 */
router.get("/:id/booking-count", (async (req, res) => {
  const id = parseInt((req.params as any).id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    const count = await prisma.booking.count({
      where: {
        propertyId: id,
        status: { in: [...REAL_BOOKING_STATUSES] },
      },
    });
    return res.json({ count });
  } catch (err: any) {
    return res.status(500).json({ error: "failed" });
  }
}) as RequestHandler);

router.get("/:idOrSlug", getPublicProperty);

export default router;


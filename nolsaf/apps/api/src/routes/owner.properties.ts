// apps/api/src/routes/owner.properties.ts
import { Router, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { cleanHtml } from "../lib/sanitize";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auditLog } from "../lib/audit.js";

// ✅ ADD THIS IMPORT NEAR THE TOP
import { regenerateAndSaveLayout } from "../lib/autoLayout.js";
import { invalidateCache, cacheKeys } from "../lib/performance.js";

// ---------- Schemas & Helpers ----------
// Minimal Zod schema for property body used by create/update
const baseBodySchema = z.object({
  // basics
  title: z.string().trim().min(3, "title must be at least 3 characters").max(200, "title must be at most 200 characters"),
  type: z.string().trim().min(1).max(50), // e.g. VILLA | APARTMENT | HOTEL | ...
  description: z.string().max(10_000).optional().nullable(),

  // building / structure
  buildingType: z.string().optional().nullable(),
  totalFloors: z.number().int().nonnegative().optional().nullable(),

  // location
  // regionId: Accept string (slug like "dar-es-salaam") or number (code like 11)
  // Database stores as VARCHAR(50), so both formats work
  regionId: z.union([z.string().trim().min(1).max(50), z.number().int().positive()]).optional(),
  regionName: z.string().trim().max(120).optional(),
  district: z.string().trim().max(120).optional(),
  ward: z.string().trim().max(120).optional().nullable(),
  street: z.string().trim().max(200).optional().nullable(),
  apartment: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional(),
  zip: z.string().trim().max(30).optional(),
  country: z.string().trim().max(120).optional(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),

  // counts
  totalBedrooms: z.number().int().nonnegative().default(0),
  totalBathrooms: z.number().int().nonnegative().default(0),
  maxGuests: z.number().int().positive().default(1),

  // media
  photos: z.array(z.string()).default([]),

  // hotel-specific
  hotelStar: z.number().int().min(1).max(5).optional().nullable(),

  // room & services
  roomsSpec: z.array(z.any()).default([]),
  // services can be array of strings (legacy) or object with tags and nearbyFacilities
  services: z.union([
    z.array(z.string()),
    z.object({
      tags: z.array(z.string()).optional(),
      nearbyFacilities: z.array(z.any()).optional(),
    }).passthrough(),
  ]).default([]),
  // house rules captured in the creation flow (stored into `services.houseRules` for now)
  houseRules: z.any().optional().nullable(),

  // pricing
  basePrice: z.number().nonnegative().optional().nullable(),
  currency: z.string().min(1).max(8).default("TZS"),

  // tourism / park placement
  tourismSiteId: z.number().int().positive().optional().nullable(),
  parkPlacement: z.enum(["INSIDE", "NEARBY"]).optional().nullable(),
  
});

function normalizeHotelStar(v: unknown): string | null {
  // DB schema stores hotelStar as string label (basic/simple/moderate/high/luxury)
  if (v === null || typeof v === "undefined") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const map: Record<number, string> = {
    1: "basic",
    2: "simple",
    3: "moderate",
    4: "high",
    5: "luxury",
  };
  return map[Math.trunc(n)] ?? String(v);
}

function cleanServices(services: unknown): any {
  // Handle legacy array format
  if (Array.isArray(services)) {
    const out = services
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(out)).slice(0, 200);
  }
  
  // Handle object format with tags, nearbyFacilities, and service properties
  if (services && typeof services === 'object' && !Array.isArray(services)) {
    const obj = services as any;
    const result: any = {};
    
    // Preserve all service properties (parking, restaurant, bar, pool, etc.)
    const serviceProperties = [
      'parking', 'parkingPrice', 'breakfastIncluded', 'breakfastAvailable',
      'restaurant', 'bar', 'pool', 'sauna', 'laundry', 'roomService',
      'security24', 'firstAid', 'fireExtinguisher', 'onSiteShop', 'nearbyMall',
      'socialHall', 'sportsGames', 'gym', 'wifi', 'ac',
      'acceptGroupBookings', 'freeCancellation',
      // Persist house rules inside services JSON for admin/owner previews
      'houseRules'
    ];
    
    for (const prop of serviceProperties) {
      if (obj[prop] !== undefined && obj[prop] !== null && obj[prop] !== '') {
        result[prop] = obj[prop];
      }
    }
    
    // Clean and add tags if present
    if (Array.isArray(obj.tags)) {
      const cleanTags = obj.tags
        .filter((s: any): s is string => typeof s === "string")
        .map((s: string) => s.trim())
        .filter(Boolean);
      result.tags = Array.from(new Set(cleanTags)).slice(0, 200);
    }
    
    // Preserve nearbyFacilities array if present
    if (Array.isArray(obj.nearbyFacilities)) {
      result.nearbyFacilities = obj.nearbyFacilities;
    }
    
    return result;
  }
  
  return [];
}

function normalizeRoomsSpec(value: unknown): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function inferBasePriceFromRooms(roomsSpec: unknown): number | null {
  const roomPrices = normalizeRoomsSpec(roomsSpec)
    .map((room: any) => {
      const raw = room?.pricePerNight ?? room?.price ?? null;
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    })
    .filter((value: number | null): value is number => value != null);

  return roomPrices.length ? Math.min(...roomPrices) : null;
}

function resolveSubmittedBasePrice(basePrice: unknown, roomsSpec: unknown): number | null {
  const explicit = basePrice != null ? Number(basePrice) : NaN;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return inferBasePriceFromRooms(roomsSpec);
}

// Extra business validation hook used during submit; keep permissive for now
function submitGuard(_p: any): boolean {
  return true;
}

function safeParseJsonWithRepair(value: unknown) {
  if (typeof value !== "string") {
    return { ok: true as const, value, repaired: false, snippet: "" };
  }

  const raw = value.trim();
  if (!raw) {
    return { ok: true as const, value: null, repaired: false, snippet: "" };
  }

  try {
    return { ok: true as const, value: JSON.parse(raw), repaired: false, snippet: "" };
  } catch (error: any) {
    const repairedRaw = raw
      .replace(/\\u(?![0-9a-fA-F]{4})/g, "\\\\u")
      .replace(/\\(?![\"\\/bfnrtu])/g, "\\\\");

    if (repairedRaw !== raw) {
      try {
        return { ok: true as const, value: JSON.parse(repairedRaw), repaired: true, snippet: "" };
      } catch {
        // continue to detailed error info
      }
    }

    const msg = String(error?.message || "");
    const m = msg.match(/position\s+(\d+)/i);
    const pos = m ? Number(m[1]) : -1;
    const start = pos >= 0 ? Math.max(0, pos - 24) : 0;
    const end = pos >= 0 ? Math.min(raw.length, pos + 24) : Math.min(raw.length, 48);
    const snippet = raw.slice(start, end);

    return { ok: false as const, value: null, repaired: false, snippet };
  }
}

function sanitizePropertyJsonFields(property: any, contextLabel: string) {
  const updateData: any = {};
  let hasRepairForDb = false;

  const rooms = safeParseJsonWithRepair(property?.roomsSpec);
  if (rooms.ok) {
    if (typeof property?.roomsSpec === "string") {
      property.roomsSpec = rooms.value;
      if (rooms.repaired) {
        updateData.roomsSpec = rooms.value;
        hasRepairForDb = true;
      }
    }
  } else if (typeof property?.roomsSpec === "string") {
    property.roomsSpec = [];
    console.warn(`[owner.properties] invalid roomsSpec JSON (${contextLabel})`, rooms.snippet);
  }

  const services = safeParseJsonWithRepair(property?.services);
  if (services.ok) {
    if (typeof property?.services === "string") {
      property.services = services.value;
      if (services.repaired) {
        updateData.services = services.value;
        hasRepairForDb = true;
      }
    }
  } else if (typeof property?.services === "string") {
    property.services = {};
    console.warn(`[owner.properties] invalid services JSON (${contextLabel})`, services.snippet);
  }

  return { hasRepairForDb, updateData };
}

export const router = Router();

// Note: Body parser middleware with 10mb limit is applied at app level in index.ts
// before the global 100kb limit, so property routes can handle large payloads

// Cast middlewares so Router.use picks the correct overload
router.use(
  requireAuth as unknown as import("express").RequestHandler,
  requireRole("OWNER") as unknown as import("express").RequestHandler
);

function isSchemaMismatchError(err: any) {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P2021" || err.code === "P2022");
}

async function findOwnerPropertyById(ownerId: number, id: number) {
  const baseSelect: any = {
    id: true,
    ownerId: true,
    status: true,
    title: true,
    type: true,
    description: true,
    buildingType: true,
    totalFloors: true,
    regionId: true,
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
    totalBedrooms: true,
    totalBathrooms: true,
    maxGuests: true,
    photos: true,
    hotelStar: true,
    roomsSpec: true,
    services: true,
    basePrice: true,
    currency: true,
    rejectionReasons: true,
    lastSubmittedAt: true,
    createdAt: true,
    updatedAt: true,
    owner: {
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    },
    // Include PropertyImage records so the owner edit page can show existing photos
    images: {
      where: { status: { not: "REJECTED" }, url: { not: null } },
      select: { id: true, url: true, thumbnailUrl: true, status: true },
      orderBy: { createdAt: "asc" },
    },
  };

  // First try: include tourism fields (works once DB migration is applied)
  try {
    return await prisma.property.findFirst({
      where: { id, ownerId },
      select: {
        ...baseSelect,
        tourismSiteId: true,
        parkPlacement: true,
      },
    });
  } catch (err: any) {
    // Fallback for older DBs without the new columns
    if (isSchemaMismatchError(err)) {
      return await prisma.property.findFirst({
        where: { id, ownerId },
        select: baseSelect,
      });
    }
    throw err;
  }
}

/* … your Zod schemas and helpers stay the same … */

// ---------- LIST MINE ----------
router.get("/mine", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    if (!ownerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { status, page = "1", pageSize = "20" } = req.query as any;

    const where: any = { ownerId };
    if (status) {
      where.status = status;
    }

    const skip = Math.max(0, (Number(page) - 1) * Number(pageSize));
    const take = Math.max(1, Math.min(100, Number(pageSize))); // Limit pageSize to prevent abuse

    let items: any[] = [];
    let total = 0;

    const listSelectBase: any = {
      id: true,
      ownerId: true,
      status: true,
      title: true,
      type: true,
      photos: true,
      regionName: true,
      district: true,
      ward: true,
      city: true,
      country: true,
      basePrice: true,
      currency: true,
      hotelStar: true,
      services: true,
      rejectionReasons: true,
      lastSubmittedAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { bookings: true } },
    };

    // Availability UI needs these fields to render real counts (otherwise it shows 0 rooms/floors).
    // Keep drift-safe: if the DB is behind on these columns, fall back to the minimal select.
    const listSelectWithStructure: any = {
      ...listSelectBase,
      roomsSpec: true,
      buildingType: true,
      totalFloors: true,
    };

    // Tourism UI needs these fields to show the selected park in owner tables/cards.
    // Keep drift-safe: if the DB is behind on these columns/tables, fall back.
    const listSelectWithStructureAndTourism: any = {
      ...listSelectWithStructure,
      tourismSiteId: true,
      parkPlacement: true,
      tourismSite: {
        select: {
          id: true,
          slug: true,
          name: true,
          country: true,
        },
      },
    };

    try {
      [items, total] = await Promise.all([
        prisma.property.findMany({
          where,
          // Avoid MySQL "Out of sort memory" on large tables by ordering on indexed PK
          orderBy: { id: "desc" },
          skip,
          take,
          select: listSelectWithStructureAndTourism,
        }),
        prisma.property.count({ where }),
      ]);
      console.log(`GET /mine: Found ${items.length} items (total: ${total}) with status=${status || 'all'} for ownerId=${ownerId}`);
    } catch (dbError: any) {
      // If the DB is behind and doesn't have some columns, retry with minimal fields.
      if (isSchemaMismatchError(dbError)) {
        try {
          [items, total] = await Promise.all([
            prisma.property.findMany({
              where,
              orderBy: { id: "desc" },
              skip,
              take,
              select: listSelectWithStructure,
            }),
            prisma.property.count({ where }),
          ]);
          console.log(`GET /mine: Drift fallback used. Found ${items.length} items (total: ${total}) with status=${status || 'all'} for ownerId=${ownerId}`);
        } catch (retryError: any) {
          if (isSchemaMismatchError(retryError)) {
            try {
              [items, total] = await Promise.all([
                prisma.property.findMany({
                  where,
                  orderBy: { id: "desc" },
                  skip,
                  take,
                  select: listSelectBase,
                }),
                prisma.property.count({ where }),
              ]);
              console.log(`GET /mine: Drift fallback (minimal) used. Found ${items.length} items (total: ${total}) with status=${status || 'all'} for ownerId=${ownerId}`);
            } catch (finalRetryError: any) {
              console.error("Database error in GET /mine (final retry):", finalRetryError);
              return res.json({
                page: Number(page),
                pageSize: take,
                total: 0,
                items: [],
              });
            }
          } else {
            console.error("Database error in GET /mine (retry):", retryError);
            return res.json({
              page: Number(page),
              pageSize: take,
              total: 0,
              items: [],
            });
          }
        }
      } else {
      console.error("Database error in GET /mine:", dbError);
      console.error("Error details:", {
        code: dbError?.code,
        message: dbError?.message,
        meta: dbError?.meta,
      });
      // Return empty result instead of crashing (following admin.properties pattern)
      return res.json({
        page: Number(page),
        pageSize: take,
        total: 0,
        items: [],
      });
      }
    }

    // Safety check - ensure items is an array
    if (!Array.isArray(items)) {
      console.error("Items is not an array:", typeof items, items);
      items = [];
    }

    // Sanitize JSON fields in-place (no-op on already-parsed objects)
    for (const item of items) {
      sanitizePropertyJsonFields(item, `GET /mine property ${item?.id ?? "unknown"}`);
    }

    // Batch-fetch suspension reasons for all SUSPENDED properties in one query
    // (avoids N+1 sequential awaits that were stalling the response)
    const suspendedIds = items
      .filter((item) => item.status === "SUSPENDED" && item.id)
      .map((item) => item.id as number);

    const suspensionReasonMap = new Map<number, string | null>();
    const suspensionReferenceMap = new Map<number, string | null>();
    if (suspendedIds.length > 0) {
      try {
        const [auditLogs, restrictionCases] = await Promise.all([
          prisma.auditLog.findMany({
            where: {
              entity: "PROPERTY",
              entityId: { in: suspendedIds },
              action: "PROPERTY_SUSPEND",
            },
            orderBy: { id: "desc" },
            select: { entityId: true, afterJson: true },
          }),
          (prisma as any).platformRestrictionCase.findMany({
            where: { scope: "MARKETPLACE_PROPERTY", targetId: { in: suspendedIds }, status: "OPEN" },
            orderBy: { id: "desc" },
            select: { targetId: true, referenceCode: true, reason: true },
          }),
        ]);
        // Keep only the most-recent log per property (list is already desc by id)
        for (const log of auditLogs) {
          if (!suspensionReasonMap.has(log.entityId)) {
            let reason: string | null = null;
            try {
              const afterJson =
                typeof log.afterJson === "string"
                  ? JSON.parse(log.afterJson)
                  : log.afterJson;
              reason = (afterJson as any)?.reason ?? null;
            } catch {
              reason = (log.afterJson as any)?.reason ?? null;
            }
            suspensionReasonMap.set(log.entityId, reason);
          }
        }
        for (const restriction of restrictionCases) {
          if (!suspensionReferenceMap.has(restriction.targetId)) {
            suspensionReferenceMap.set(restriction.targetId, restriction.referenceCode);
          }
          if (!suspensionReasonMap.has(restriction.targetId)) {
            suspensionReasonMap.set(restriction.targetId, restriction.reason ?? null);
          }
        }
      } catch (err) {
        console.error("Error batch-fetching suspension reasons:", err);
      }
    }

    // Prisma select returns plain objects - no custom serializer needed.
    // Attach suspension reason where applicable.
    const processedItems = items.map((item) => {
      const out = { ...item };
      if (item.status === "SUSPENDED" && item.id) {
        out.suspensionReason = suspensionReasonMap.get(item.id) ?? null;
        out.suspensionReference = suspensionReferenceMap.get(item.id) ?? null;
      }
      return out;
    });

    res.json({
      page: Number(page),
      pageSize: take,
      total,
      items: processedItems,
    });
  } catch (error: any) {
    console.error("Error in GET /mine:", error);
    console.error("Error stack:", error?.stack);
    console.error("Error details:", {
      code: (error as any)?.code,
      message: error?.message,
      meta: (error as any)?.meta,
    });
    // Return empty result instead of error to prevent breaking the UI
    try {
      res.json({
        page: Number(req.query?.page) || 1,
        pageSize: Number(req.query?.pageSize) || 20,
        total: 0,
        items: [],
      });
    } catch (responseError: any) {
      // If even sending empty response fails, send minimal error
      console.error("Failed to send error response:", responseError);
      res.status(500).json({ 
        error: "Internal Server Error",
        message: "Failed to fetch properties"
      });
    }
  }
}) as RequestHandler);

// ---------- GET BY ID ----------
router.get("/:id", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const property = await findOwnerPropertyById(ownerId, id);
    if (!property) return res.status(404).json({ error: "Property not found" });

    const sanitized = sanitizePropertyJsonFields(property as any, `GET /:id property ${id}`);
    if (sanitized.hasRepairForDb && Object.keys(sanitized.updateData).length > 0) {
      try {
        await prisma.property.update({
          where: { id, ownerId },
          data: sanitized.updateData,
        });
      } catch (persistErr) {
        console.warn(`[owner.properties] failed to persist repaired JSON for property ${id}`, persistErr);
      }
    }

  // Safely serialize the property object
  const serializePrismaObject = (obj: any): any => {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;
    
    const result: any = {};
    const keys = Object.keys(obj);
    
    for (const key of keys) {
      try {
        const value = obj[key];
        
        if (typeof value === 'function' || typeof value === 'symbol') continue;
        
        if (value instanceof Date) {
          result[key] = value.toISOString();
        } else if (typeof value === 'bigint') {
          result[key] = value.toString();
        } else if (value === null || value === undefined) {
          result[key] = value;
        } else if (Array.isArray(value)) {
          result[key] = value.map(v => serializePrismaObject(v));
        } else if (typeof value === 'object') {
          if (key.startsWith('_') || key === 'toJSON' || key === 'toString') continue;
          try {
            result[key] = serializePrismaObject(value);
          } catch {
            continue;
          }
        } else {
          result[key] = value;
        }
      } catch {
        continue;
      }
    }
    
    return result;
  };

    try {
      const serialized = serializePrismaObject(property);
      JSON.stringify(serialized); // Test serialization
      return res.json(serialized);
    } catch (err: any) {
      console.error(`Error serializing property ${id}:`, err);
      return res.status(500).json({ error: "Failed to serialize property data" });
    }
  } catch (err: any) {
    console.error("Error in GET /api/owner/properties/:id:", err);
    return res.status(500).json({ error: "Internal Server Error", message: err?.message || "Failed to fetch property" });
  }
}) as RequestHandler);

// ---------- CREATE ----------
router.post("/", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    const parsed = baseBodySchema.parse(req.body);

    // Normalize tourism / park placement fields
    const normalizedTourismSiteId = parsed.tourismSiteId ?? null;
    const normalizedParkPlacementRaw = typeof parsed.parkPlacement === "undefined" ? null : parsed.parkPlacement;
    if (!normalizedTourismSiteId && (normalizedParkPlacementRaw === "INSIDE" || normalizedParkPlacementRaw === "NEARBY")) {
      return res.status(400).json({ error: "tourismSiteId_required_when_parkPlacement_set" });
    }
    const normalizedParkPlacement = normalizedTourismSiteId
      ? (normalizedParkPlacementRaw === "INSIDE" || normalizedParkPlacementRaw === "NEARBY" ? normalizedParkPlacementRaw : "NEARBY")
      : null;

    // Merge house rules into services so they are available in admin/owner previews
    let servicesForSave: any = cleanServices(parsed.services);
    if (parsed.houseRules) {
      if (Array.isArray(servicesForSave)) {
        servicesForSave = { tags: servicesForSave };
      }
      if (servicesForSave && typeof servicesForSave === "object" && !Array.isArray(servicesForSave)) {
        servicesForSave.houseRules = parsed.houseRules;
      }
    }

    const createData: any = {
        ownerId,
        title: parsed.title,
        type: parsed.type,
  description: cleanHtml(parsed.description ?? null),
        status: "DRAFT",
        buildingType: parsed.buildingType ?? null,
        totalFloors: parsed.totalFloors ?? null,
        // location …
        // Prisma schema expects String? for regionId, but UI may send numeric codes (e.g. 11)
        regionId: parsed.regionId == null ? null : String(parsed.regionId),
        regionName: parsed.regionName,
        district: parsed.district,
        ward: parsed.ward ?? null,
        street: parsed.street,
        apartment: parsed.apartment,
        city: parsed.city,
        zip: parsed.zip,
        country: parsed.country,
        latitude: parsed.latitude ?? null,
        longitude: parsed.longitude ?? null,
        // counts …
        totalBedrooms: parsed.totalBedrooms,
        totalBathrooms: parsed.totalBathrooms,
        maxGuests: parsed.maxGuests,
        // media …
        photos: parsed.photos,
        // hotel …
        hotelStar: normalizeHotelStar(parsed.hotelStar),
        // room & services …
        roomsSpec: parsed.roomsSpec,
        services: servicesForSave,
        // pricing …
        basePrice: resolveSubmittedBasePrice(parsed.basePrice, parsed.roomsSpec),
        currency: parsed.currency,

        // tourism / park placement …
        tourismSiteId: normalizedTourismSiteId,
        parkPlacement: normalizedParkPlacement,
      };

    let created: any;
    try {
      created = await prisma.property.create({ data: createData });
    } catch (err: any) {
      // If DB isn't migrated yet, retry without the new tourism columns.
      if (isSchemaMismatchError(err)) {
        delete createData.tourismSiteId;
        delete createData.parkPlacement;
        created = await prisma.property.create({ data: createData });
      } else {
        throw err;
      }
    }

    // Persist PropertyImage records for any photos provided
    try {
      const photos: string[] = Array.isArray(parsed.photos) ? parsed.photos : [];
      await Promise.all(
        photos.map(async (p) => {
          if (typeof p !== "string") return;
          // Never persist local preview/base64 strings into DB
          if (p.startsWith("blob:") || p.startsWith("data:")) return;
          // Keep URLs within reasonable size to avoid DB driver length mismatches
          if (p.length > 2048) return;
          const filename = p.split("/").pop() || p;
          // Scope the key per property to prevent cross-property storageKey collisions
          // (global @unique on storageKey means different properties with same filename would overwrite each other)
          const storageKey = `${created.id}:${filename}`.slice(0, 190);
          await prisma.propertyImage.upsert({
            where: { storageKey },
            create: { propertyId: created.id, storageKey, url: p, status: "PENDING" },
            update: { url: p },
          });
        })
      );
    } catch (e) {
      // don't fail the request on image persistence issues
      console.log("property image persist failed", e);
    }
    // ✅ AFTER CREATE — AUTO GENERATE LAYOUT IF WE HAVE ROOMS
    if (Array.isArray(created.roomsSpec) && created.roomsSpec.length > 0) {
      try { await regenerateAndSaveLayout(created.id); } catch {}
    }

    // Invalidate cache for property lists (new property created)
    await invalidateCache('properties:list:*').catch(() => {});

    res.status(201).json({ id: created.id });
  } catch (e: any) {
    console.error("Error in POST /api/owner/properties:", e);
    console.error("Error details:", {
      message: e?.message,
      code: e?.code,
      meta: e?.meta,
      stack: e?.stack,
    });
    res.status(400).json({ error: e?.errors ?? e?.message ?? "Invalid payload" });
  }
}) as RequestHandler);

// Only TZS is actually enforced today; the allowlist is the single source of truth the
// UI's disabled options mirror, so widening currency support later is a one-line change here.
const ALLOWED_PROPERTY_CURRENCIES = ["TZS"] as const;

// ---------- SET CURRENCY ----------
router.patch("/:id/currency", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const parsed = z.object({ currency: z.string().trim().toUpperCase() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid currency" });
    if (!(ALLOWED_PROPERTY_CURRENCIES as readonly string[]).includes(parsed.data.currency)) {
      return res.status(400).json({ error: `Only ${ALLOWED_PROPERTY_CURRENCIES.join(", ")} is supported right now` });
    }

    const exists = await prisma.property.findFirst({ where: { id, ownerId }, select: { id: true, currency: true } });
    if (!exists) return res.status(404).json({ error: "Property not found" });

    const updated = await prisma.property.update({ where: { id }, data: { currency: parsed.data.currency } });

    await invalidateCache(cacheKeys.property(id)).catch(() => {});

    await auditLog({
      actorId: ownerId,
      actorRole: req.user!.role,
      action: "PROPERTY_CURRENCY_SET",
      entity: "PROPERTY",
      entityId: id,
      before: { currency: exists.currency },
      after: { currency: updated.currency },
      ip: req.ip,
      ua: req.headers["user-agent"] as string,
    });

    res.json({ currency: updated.currency });
  } catch (e: any) {
    res.status(400).json({ error: e?.message ?? "Failed to set currency" });
  }
}) as RequestHandler);

// ---------- UPDATE ----------
router.put("/:id", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const exists = await prisma.property.findFirst({
      where: { id, ownerId },
      select: { id: true, tourismSiteId: true, parkPlacement: true, status: true },
    });
    if (!exists) return res.status(404).json({ error: "Property not found" });

    const beforeForAudit = await prisma.property.findFirst({
      where: { id, ownerId },
    });

    const parsed = baseBodySchema.parse(req.body);

    // Normalize tourism / park placement fields
    const incomingTourismSiteId = typeof parsed.tourismSiteId === "undefined" ? undefined : (parsed.tourismSiteId ?? null);
    const incomingParkPlacementRaw = typeof parsed.parkPlacement === "undefined" ? undefined : (parsed.parkPlacement ?? null);

    const nextTourismSiteId = incomingTourismSiteId !== undefined ? incomingTourismSiteId : (exists as any).tourismSiteId ?? null;

    // If parkPlacement is being set, ensure we have a tourism site.
    if ((incomingParkPlacementRaw === "INSIDE" || incomingParkPlacementRaw === "NEARBY") && !nextTourismSiteId) {
      return res.status(400).json({ error: "tourismSiteId_required_when_parkPlacement_set" });
    }

    // If tourism site is set (or remains set), ensure parkPlacement is valid.
    const nextParkPlacement = nextTourismSiteId
      ? (incomingParkPlacementRaw === "INSIDE" || incomingParkPlacementRaw === "NEARBY"
          ? incomingParkPlacementRaw
          : ((exists as any).parkPlacement === "INSIDE" || (exists as any).parkPlacement === "NEARBY")
            ? (exists as any).parkPlacement
            : "NEARBY")
      : null;

    // Merge house rules into services so they are available in admin/owner previews
    let servicesForSave: any = cleanServices(parsed.services);
    if (parsed.houseRules) {
      if (Array.isArray(servicesForSave)) {
        servicesForSave = { tags: servicesForSave };
      }
      if (servicesForSave && typeof servicesForSave === "object" && !Array.isArray(servicesForSave)) {
        servicesForSave.houseRules = parsed.houseRules;
      }
    }

    const updateData: any = {
        title: parsed.title,
        type: parsed.type,
  description: cleanHtml(parsed.description ?? null),
        buildingType: parsed.buildingType ?? null,
        totalFloors: parsed.totalFloors ?? null,
        // location …
        // Keep existing value if field omitted; coerce number -> string when provided
        regionId: typeof parsed.regionId === "undefined" ? undefined : (parsed.regionId == null ? null : String(parsed.regionId)),
        regionName: parsed.regionName,
        district: parsed.district,
        ward: parsed.ward ?? null,
        street: parsed.street,
        apartment: parsed.apartment,
        city: parsed.city,
        zip: parsed.zip,
        country: parsed.country,
        latitude: typeof parsed.latitude === "undefined" ? undefined : parsed.latitude ?? null,
        longitude: typeof parsed.longitude === "undefined" ? undefined : parsed.longitude ?? null,
        // counts …
        totalBedrooms: parsed.totalBedrooms,
        totalBathrooms: parsed.totalBathrooms,
        maxGuests: parsed.maxGuests,
        // media …
        photos: parsed.photos,
        // hotel …
        hotelStar: typeof parsed.hotelStar === "undefined" ? undefined : normalizeHotelStar(parsed.hotelStar),
        // room & services …
        roomsSpec: parsed.roomsSpec,
        services: servicesForSave,
        // pricing …
        basePrice: resolveSubmittedBasePrice(parsed.basePrice, parsed.roomsSpec),
        currency: parsed.currency,

        // tourism / park placement …
        tourismSiteId: incomingTourismSiteId === undefined ? undefined : nextTourismSiteId,
        // If tourism site is being changed/cleared, reflect placement accordingly.
        // If tourism site exists (even unchanged), keep placement valid (default NEARBY).
        parkPlacement:
          incomingTourismSiteId !== undefined || incomingParkPlacementRaw !== undefined || nextTourismSiteId
            ? nextParkPlacement
            : undefined,
      };

    // Editing must never auto-submit. If a live (APPROVED) or previously REJECTED
    // listing is changed, revert it to DRAFT so the owner explicitly clicks
    // "Submit for review" again — an edit alone should never land it in PENDING.
    if (exists.status === "APPROVED" || exists.status === "REJECTED") {
      updateData.status = "DRAFT";
    }

    let updated: any;
    try {
      updated = await prisma.property.update({ where: { id }, data: updateData });
    } catch (err: any) {
      if (isSchemaMismatchError(err)) {
        delete updateData.tourismSiteId;
        delete updateData.parkPlacement;
        updated = await prisma.property.update({ where: { id }, data: updateData });
      } else {
        throw err;
      }
    }

    // Persist PropertyImage records for any photos provided
    try {
      const photos: string[] = Array.isArray(parsed.photos) ? parsed.photos : [];
      await Promise.all(
        photos.map(async (p) => {
          if (typeof p !== "string") return;
          if (p.startsWith("blob:") || p.startsWith("data:")) return;
          if (p.length > 2048) return;
          const filename = p.split("/").pop() || p;
          // Scope the key per property to prevent cross-property storageKey collisions
          const storageKey = `${updated.id}:${filename}`.slice(0, 190);
          await prisma.propertyImage.upsert({
            where: { storageKey },
            create: { propertyId: updated.id, storageKey, url: p, status: "PENDING" },
            update: { url: p },
          });
        })
      );
    } catch (e) {
      console.log("property image persist failed", e);
    }
    // ✅ AFTER UPDATE — OPTIONAL ?regen=1 OR WHEN ROOMS EXIST
    const regen = String(req.query.regen ?? "") === "1";
    if (regen || (Array.isArray(parsed.roomsSpec) && parsed.roomsSpec.length > 0)) {
      try { await regenerateAndSaveLayout(id); } catch {}
    }

    // Invalidate cache for this property and property lists
    await Promise.all([
      invalidateCache(cacheKeys.property(id)),
      invalidateCache('properties:list:*'),
    ]).catch(() => {}); // Don't fail the request if cache invalidation fails

    await auditLog({
      actorId: ownerId,
      actorRole: req.user!.role,
      action: "PROPERTY_UPDATE",
      entity: "PROPERTY",
      entityId: id,
      before: beforeForAudit,
      after: updated,
      ip: req.ip,
      ua: req.headers["user-agent"] as string,
    });

    res.json({ id: updated.id, status: updated.status, statusChanged: updated.status !== exists.status });
  } catch (e: any) {
    console.error("Error in PUT /api/owner/properties/:id:", e);
    console.error("Error details:", {
      message: e?.message,
      code: e?.code,
      meta: e?.meta,
      stack: e?.stack,
    });
    res.status(400).json({ error: e?.errors ?? e?.message ?? "Update failed" });
  }
}) as RequestHandler);

// ---------- SUBMIT ----------
router.post("/:id/submit", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const p = await prisma.property.findFirst({
      where: { id, ownerId },
      select: {
        id: true,
        ownerId: true,
        status: true,
        title: true,
        regionId: true,
        regionName: true,
        district: true,
        ward: true,
        zip: true,
        latitude: true,
        longitude: true,
        photos: true,
        roomsSpec: true,
        _count: { select: { images: true } },
      },
    });
    if (!p) {
      console.error(`Property ${id} not found for owner ${ownerId}`);
      return res.status(404).json({ error: "Property not found" });
    }

    // Prisma returns Decimal objects (not plain JS numbers) for @db.Decimal fields.
    // Use Number() coercion which works for both plain numbers and Prisma.Decimal.
    const latNum = p.latitude != null ? Number(p.latitude) : null;
    const lngNum = p.longitude != null ? Number(p.longitude) : null;
    const hasPin = latNum !== null && lngNum !== null && Number.isFinite(latNum) && Number.isFinite(lngNum);

    // Accept photos from either the legacy JSON field OR the PropertyImage relation.
    const jsonPhotoCount = Array.isArray(p.photos) ? (p.photos as unknown[]).length : 0;
    const imageRecordCount = (p as any)._count?.images ?? 0;
    const photoCount = Math.max(jsonPhotoCount, imageRecordCount);

    const complete =
      (p.title?.trim()?.length ?? 0) >= 3 &&
      !!p.regionId &&
      !!p.district &&
      hasPin &&
      photoCount >= 3 &&
      Array.isArray(p.roomsSpec) && p.roomsSpec.length >= 1 &&
      submitGuard(p);

    if (!complete) {
      console.error(`Property ${id} incomplete. Title: ${p.title?.length}, regionId: ${!!p.regionId}, district: ${!!p.district}, lat: ${p.latitude} (${latNum}), lng: ${p.longitude} (${lngNum}), hasPin: ${hasPin}, photos: ${photoCount} (json:${jsonPhotoCount} images:${imageRecordCount}), rooms: ${Array.isArray(p.roomsSpec) ? p.roomsSpec.length : 0}`);
      return res.status(400).json({ error: "Incomplete property. Please complete required fields (name, exact location pin, ≥3 photos, ≥1 room type)." });
    }

    // The owner-placed map pin is the authoritative coordinate. We intentionally
    // do NOT cross-check it against the selected region/district/ward via reverse
    // geocoding: Mapbox's Tanzania admin boundaries are coarse/incorrect (e.g. it
    // reports Ilala as "Dar es Salaam"), which rejected perfectly valid listings.
    // The completeness check above already guarantees a valid pin exists.

    const updated = await prisma.property.update({
      where: { id },
      data: { status: "PENDING" },
    });

    // Invalidate cache for this property and property lists
    await Promise.all([
      invalidateCache(cacheKeys.property(id)),
      invalidateCache('properties:list:*'),
      invalidateCache(cacheKeys.adminSummary()),
    ]).catch(() => {}); // Don't fail the request if cache invalidation fails

    // Verify the update worked
    const verified = await prisma.property.findFirst({
      where: { id, ownerId },
      select: { id: true, status: true, title: true },
    });

    console.log(`Property ${id} submitted successfully. Status: ${updated.status}, Verified status: ${verified?.status}, Owner: ${ownerId}`);
    
    if (verified?.status !== "PENDING") {
      console.error(`WARNING: Property ${id} status update may have failed. Expected PENDING, got ${verified?.status}`);
    }

    // ✅ BEFORE RETURN — ENSURE LAYOUT IS FRESH
    try { await regenerateAndSaveLayout(id); } catch (err) {
      console.error(`Failed to regenerate layout for property ${id}:`, err);
    }

    // Notify owner and admins that property has been submitted
    try {
      const { notifyOwner, notifyAdmins } = await import("../lib/notifications.js");
      const propertyData = { 
        propertyId: id, 
        propertyTitle: p.title,
        ownerId: ownerId,
      };
      await Promise.all([
        notifyOwner(ownerId, "property_submitted", propertyData),
        notifyAdmins("property_submitted", propertyData),
      ]);
    } catch (notifyError) {
      // Don't fail the request if notifications fail
      console.error(`Failed to send notifications for property ${id}:`, notifyError);
    }

    await auditLog({
      actorId: ownerId,
      actorRole: req.user!.role,
      action: "PROPERTY_SUBMIT",
      entity: "PROPERTY",
      entityId: id,
      before: { status: (p as any).status ?? null },
      after: { status: "PENDING", title: p.title },
      ip: req.ip,
      ua: req.headers["user-agent"] as string,
    });

    res.json({ ok: true, id: updated.id, status: updated.status });
  } catch (error: any) {
    console.error("Error in POST /:id/submit:", error);
    console.error("Error details:", {
      message: error?.message,
      stack: error?.stack,
      code: error?.code,
    });
    res.status(500).json({ 
      error: "Internal Server Error",
      message: error?.message || "Failed to submit property"
    });
  }
}) as RequestHandler);

// ---------- DELETE ----------
router.delete("/:id", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const p = await prisma.property.findFirst({
      where: { id, ownerId },
      select: { id: true, status: true },
    });
    if (!p) return res.status(404).json({ error: "Property not found" });
    if (p.status !== "DRAFT") {
      return res.status(403).json({ error: "Only draft properties can be deleted." });
    }

    await prisma.property.delete({ where: { id } });

    await Promise.all([
      invalidateCache(cacheKeys.property(id)),
      invalidateCache("properties:list:*"),
      invalidateCache(cacheKeys.adminSummary()),
    ]).catch(() => {});

    return res.json({ success: true });
  } catch (error: any) {
    console.error("Error in DELETE /:id:", error);
    res.status(500).json({ error: "Internal Server Error", message: error?.message });
  }
}) as RequestHandler);

// ---------- OWNER AUDIT HISTORY ----------
router.get("/:id/audit-history", (async (req: AuthedRequest, res) => {
  try {
    const ownerId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    // Verify ownership
    const exists = await prisma.property.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (!exists) return res.status(404).json({ error: "Property not found" });

    const audits = await prisma.auditLog.findMany({
      where: { entity: "PROPERTY", entityId: id },
      orderBy: { id: "desc" },
      take: 50,
      select: {
        id: true,
        actorRole: true,
        action: true,
        createdAt: true,
        actor: { select: { name: true } },
      },
    });

    // Return simplified audit data (no sensitive admin details / IPs)
    const visibleAudits = audits.filter((a) => !(a.action === "PROPERTY_UPDATE" && a.actorRole === "ADMIN"));

    const result = visibleAudits.map((a) => ({
      id: Number(a.id),
      action: a.action,
      actorRole: a.actorRole,
      actorName:
        a.actorRole === "ADMIN"
          ? "NoLSAF Review"
          : (a.actor?.name || "You"),
      createdAt: a.createdAt,
    }));

    res.json(result);
  } catch (e: any) {
    console.error("Error in GET /:id/audit-history:", e);
    res.status(500).json({ error: "Failed to load audit history" });
  }
}) as RequestHandler);

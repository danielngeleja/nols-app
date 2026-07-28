// apps/api/src/routes/admin.properties.ts
import { Router, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import {
  ApprovePropertyInput,
  RejectPropertyInput,
  SuspendPropertyInput,
  UnsuspendPropertyInput,
} from "../schemas/adminPropertySchemas.js";
import { toAdminPropertyDTO } from "../lib/adminPropertyDto.js";
import { emitEvent } from "../lib/events.js";
import { notifyOwner } from "../lib/notifications.js";
import {
  invalidateAdminPropertyQueues,
  invalidateOwnerPropertyLists,
} from "../lib/cache.js";
import { auditLog } from "../lib/audit.js";
import { invalidateCache, cacheKeys, cacheTags } from "../lib/performance.js";
import {
  RESTRICTION_SCOPE,
  createRestrictionCase,
  resolveRestrictionCase,
  sendRestrictionOpenedEmail,
  sendRestrictionResolvedEmail,
} from "../lib/restrictionCases.js";

export const router = Router();
router.use(requireAuth as RequestHandler, requireAdmin as RequestHandler);

/** Helper: socket broadcast to Admin UI */
function broadcastStatus(req: any, payload: any) {
  const io = req.app?.get?.("io");
  if (io) io.emit("admin:property:status", payload);
}

async function createAdminAuditSafe(data: { adminId: number; targetUserId?: number | null; action: string; details?: any }) {
  try {
    await prisma.adminAudit.create({
      data: {
        adminId: data.adminId,
        targetUserId: data.targetUserId ?? null,
        action: data.action,
        details: data.details ?? null,
      },
    });
  } catch (e) {
    console.warn("adminAudit.create failed:", String(e));
  }
}

const DEFAULT_PROPERTY_VERIFICATION_CHECKLIST = [
  "Property details reviewed",
  "Location and listing information checked",
  "Photos and stay information reviewed",
  "Host listing approved",
] as const;
const DEFAULT_PROPERTY_VERIFICATION_METHOD = "Site visit and listing review";

function verificationNoteFor(status: "VERIFIED" | "PENDING" | "REJECTED", reason?: string | null) {
  if (status === "VERIFIED") return "This stay is listed publicly only after NoLSAF verification and approval.";
  if (status === "REJECTED") return reason ? `Verification rejected: ${reason}` : "Verification rejected during NoLSAF review.";
  return reason ? `Verification paused: ${reason}` : "Verification is pending NoLSAF review.";
}

async function upsertPropertyVerification(
  db: any,
  propertyId: number,
  params: {
    status: "VERIFIED" | "PENDING" | "REJECTED";
    adminId?: number | null;
    method: string;
    note?: string | null;
  }
) {
  const isVerified = params.status === "VERIFIED";
  const verifiedAt = isVerified ? new Date() : null;
  const verifiedBy = isVerified ? params.adminId ?? null : null;
  const note = params.note ?? verificationNoteFor(params.status);

  return db.$executeRaw(
    Prisma.sql`
      INSERT INTO \`property_verification\` (
        \`propertyId\`,
        \`status\`,
        \`verifiedAt\`,
        \`verifiedBy\`,
        \`method\`,
        \`note\`,
        \`checklist\`,
        \`createdAt\`,
        \`updatedAt\`
      )
      VALUES (
        ${propertyId},
        ${params.status},
        ${verifiedAt},
        ${verifiedBy},
        ${params.method},
        ${note},
        JSON_ARRAY(${Prisma.join(DEFAULT_PROPERTY_VERIFICATION_CHECKLIST.map((item) => Prisma.sql`${item}`))}),
        CURRENT_TIMESTAMP(3),
        CURRENT_TIMESTAMP(3)
      )
      ON DUPLICATE KEY UPDATE
        \`status\` = VALUES(\`status\`),
        \`verifiedAt\` = VALUES(\`verifiedAt\`),
        \`verifiedBy\` = VALUES(\`verifiedBy\`),
        \`method\` = VALUES(\`method\`),
        \`note\` = VALUES(\`note\`),
        \`checklist\` = VALUES(\`checklist\`),
        \`updatedAt\` = CURRENT_TIMESTAMP(3)
    `
  );
}

const adminPropertyOwnerSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
} as const;

function normalizePhotoList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((photo) => (typeof photo === "string" ? photo.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed
            .map((photo) => (typeof photo === "string" ? photo.trim() : ""))
            .filter(Boolean);
        }
      } catch {
        // fall back to direct string handling below
      }
    }
    return [raw];
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

function effectivePropertyBasePrice(property: { basePrice?: unknown; roomsSpec?: unknown }): number | null {
  const explicit = property.basePrice != null ? Number(property.basePrice) : NaN;
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const roomPrices = normalizeRoomsSpec(property.roomsSpec)
    .map((room: any) => {
      const raw = room?.pricePerNight ?? room?.price ?? null;
      const value = Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    })
    .filter((value: number | null): value is number => value != null);

  return roomPrices.length ? Math.min(...roomPrices) : null;
}

// Drift-safe select: avoid selecting columns that may not exist in older DBs
// (e.g. Property.tourismSiteId).
const adminPropertyDTOSelect = {
  id: true,
  status: true,
  title: true,
  type: true,
  description: true,
  hotelStar: true,
  buildingType: true,
  totalFloors: true,
  owner: { select: adminPropertyOwnerSelect },
  regionId: true,
  regionName: true,
  district: true,
  street: true,
  apartment: true,
  city: true,
  zip: true,
  country: true,
  latitude: true,
  longitude: true,
  ward: true,
  photos: true,
  roomsSpec: true,
  services: true,
  basePrice: true,
  currency: true,
  totalBedrooms: true,
  totalBathrooms: true,
  maxGuests: true,
  layout: true,
  createdAt: true,
  updatedAt: true,
  lastSubmittedAt: true,
  rejectionReasons: true,
} as const;

/** GET /admin/properties?status=&q=&regionId=&regionName=&type=&ownerId=&page=&pageSize= */
router.get("/", (async (req: AuthedRequest, res) => {
  try {
    // Explicitly set Content-Type to JSON
    res.setHeader('Content-Type', 'application/json');
    
    const { status, statuses, q, regionId, regionName, type, ownerId, page = "1", pageSize = "20" } =
      req.query as any;

    const where: any = {};
    
    // Build base filters
    const statusList = String(statuses || status || "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 8);
    if (statusList.length === 1 && statusList[0] !== "ALL") {
      where.status = statusList[0];
    } else if (statusList.length > 1) {
      where.status = { in: statusList.filter((value) => value !== "ALL") };
    }
    if (regionId) {
      const regionIdNum = Number(regionId);
      if (!isNaN(regionIdNum)) {
        where.regionId = regionIdNum;
      }
    }
    if (regionName) {
      where.regionName = { contains: String(regionName) };
    }
    if (type) {
      where.type = type;
    }
    if (ownerId) {
      const ownerIdNum = Number(ownerId);
      if (!isNaN(ownerIdNum)) {
        where.ownerId = ownerIdNum;
      }
    }
    
    // If search query is provided, combine with existing filters using AND
    if (q) {
      const searchTerm = String(q).trim().slice(0, 120);
      if (searchTerm) {
        // Save regionName filter separately if it exists
        const savedRegionName = where.regionName;
        delete where.regionName;
        
        // If we have other filters, combine them with search using AND
        const hasOtherFilters = Object.keys(where).length > 0;
        
        // Clear where to rebuild
        const otherFilters = hasOtherFilters ? { ...where } : null;
        Object.keys(where).forEach(key => delete where[key]);
        
        // Build the search conditions
        const searchConditions = {
          OR: [
            { title: { contains: searchTerm } },
            { regionName: { contains: searchTerm } },
            { district: { contains: searchTerm } },
          ],
        };
        
        if (hasOtherFilters || savedRegionName) {
          // Combine filters with search using AND
          const baseFilters: any = otherFilters || {};
          if (savedRegionName) {
            // If we have a regionName filter, it should match exactly (not via search)
            baseFilters.regionName = savedRegionName;
          }
          where.AND = [
            baseFilters,
            searchConditions,
          ];
        } else {
          // No existing filters, just use OR for search
          where.OR = searchConditions.OR;
        }
      }
      // If searchTerm is empty after trim, where already has the base filters, so we're good
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    let items: any[] = [];
    let total = 0;

    try {
      const findManyPromise = prisma.property.findMany({
          where,
          // Avoid MySQL "Out of sort memory" on large tables by ordering on indexed PK
          orderBy: { id: "desc" },
          select: {
            id: true,
            title: true,
            status: true,
            type: true,
            owner: { select: { id: true, name: true, email: true } },
            regionName: true,
            district: true,
            photos: true,
            basePrice: true,
            currency: true,
            services: true,
            updatedAt: true,
          },
          skip,
          take,
        });

      const shouldIncludeTotal = String((req.query as any).includeTotal ?? "true") !== "false";
      const countPromise = shouldIncludeTotal ? prisma.property.count({ where }) : Promise.resolve(null);

      const [foundItems, foundTotal] = await Promise.all([findManyPromise, countPromise]);
      items = foundItems;
      total = foundTotal ?? items.length;
      
      // Safety check - ensure items is an array
      if (!Array.isArray(items)) {
        console.error('[GET /admin/properties] Items is not an array:', typeof items, items);
        items = [];
      }

    } catch (dbError: any) {
      console.error('Database query failed in GET /admin/properties:', dbError);
      console.error('Error details:', {
        code: dbError?.code,
        message: dbError?.message,
        meta: dbError?.meta,
        stack: dbError?.stack,
      });
      
      // Check for Prisma errors
      if (dbError instanceof Prisma.PrismaClientKnownRequestError) {
        if (dbError.code === 'P2021' || dbError.code === 'P2022') {
          console.warn('Prisma schema mismatch in GET /admin/properties:', dbError.message);
        }
      }
      
      // Return empty result instead of crashing
      return res.json({
        page: Number(page),
        pageSize: take,
        total: 0,
        items: [],
      });
    }

    interface AdminPropertyOwner {
      id: number;
      name: string | null;
      email: string | null;
    }

    interface AdminPropertyRow {
      id: number;
      title: string;
      status: string;
      type: string | null;
      owner: AdminPropertyOwner | null;
      regionName?: string | null;
      district?: string | null;
      photos?: string[] | null;
      roomsSpec?: any;
      basePrice?: number | null;
      currency?: string | null;
      services?: any;
      updatedAt: Date;
    }

    interface AdminPropertyListItem {
      id: number;
      title: string;
      status: string;
      type: string | null;
      owner: AdminPropertyOwner | null;
      regionName?: string | null;
      district?: string | null;
      photos: string[];
      roomsSpec?: any;
      basePrice?: number | null;
      currency?: string | null;
      services?: any;
      updatedAt: string; // ISO string for JSON serialization
    }

    interface AdminPropertyListResponse {
      page: number;
      pageSize: number;
      total: number;
      items: AdminPropertyListItem[];
    }

    // Helper function to safely serialize Prisma objects
    const serializePrismaObject = (obj: any): any => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj !== 'object') return obj;
      
      const result: any = {};
      const keys = Object.keys(obj);
      
      for (const key of keys) {
        try {
          const value = obj[key];
          
          // Skip functions and symbols
          if (typeof value === 'function' || typeof value === 'symbol') {
            continue;
          }
          
          // Handle Dates
          if (value instanceof Date) {
            result[key] = value.toISOString();
          }
          // Handle BigInt
          else if (typeof value === 'bigint') {
            result[key] = value.toString();
          }
          // Handle null/undefined
          else if (value === null || value === undefined) {
            result[key] = value;
          }
          // Handle arrays
          else if (Array.isArray(value)) {
            result[key] = value.map(v => serializePrismaObject(v));
          }
          // Handle nested objects (but skip Prisma internal properties)
          else if (typeof value === 'object') {
            // Skip Prisma internal properties
            if (key.startsWith('_') || key === 'toJSON' || key === 'toString') {
              continue;
            }
            try {
              result[key] = serializePrismaObject(value);
            } catch {
              // If nested object can't be serialized, skip it
              continue;
            }
          }
          // Handle primitives
          else {
            result[key] = value;
          }
        } catch (fieldError) {
          // Skip fields that can't be serialized
          continue;
        }
      }
      
      return result;
    };

    // Safety check - ensure items is an array before processing
    if (!Array.isArray(items)) {
      console.error('[GET /admin/properties] Items is not an array before serialization:', typeof items);
      items = [];
    }
    
    // Serialize items safely
    const serializedItems: AdminPropertyListItem[] = [];
    for (const p of items as AdminPropertyRow[]) {
      try {
        // Manually construct the item to ensure proper serialization
        // Handle owner object safely
        let ownerObj: any = null;
        if (p.owner) {
          try {
            ownerObj = {
              id: typeof p.owner.id === 'bigint' ? Number(p.owner.id) : Number(p.owner.id),
              name: p.owner.name ?? null,
              email: p.owner.email ?? null,
            };
            // Test owner serialization
            JSON.stringify(ownerObj);
          } catch (ownerError) {
            console.error(`[GET /admin/properties] Error serializing owner for property ${p.id}:`, ownerError);
            ownerObj = null;
          }
        }
        
        // Handle services safely (might be object or array)
        let servicesValue: any = null;
        try {
          if (p.services !== null && p.services !== undefined) {
            if (typeof p.services === 'string') {
              // Try to parse if it's a JSON string
              try {
                servicesValue = JSON.parse(p.services);
              } catch {
                servicesValue = p.services;
              }
            } else {
              servicesValue = p.services;
            }
            // Test services serialization
            JSON.stringify(servicesValue);
          }
        } catch (servicesError) {
          console.error(`[GET /admin/properties] Error serializing services for property ${p.id}:`, servicesError);
          servicesValue = null;
        }
        
        const photosFromJson = normalizePhotoList(p.photos);
        const mergedPhotos = photosFromJson.slice(0, 3);

        const effectiveBasePrice = effectivePropertyBasePrice(p);
        const item: any = {
          id: typeof p.id === 'bigint' ? Number(p.id) : Number(p.id),
          title: String(p.title || ''),
          status: String(p.status || 'DRAFT'),
          type: p.type ? String(p.type) : null,
          owner: ownerObj,
          regionName: p.regionName ? String(p.regionName) : null,
          district: p.district ? String(p.district) : null,
          photos: mergedPhotos,
          roomsSpec: p.roomsSpec ?? null,
          basePrice: effectiveBasePrice,
          currency: p.currency ? String(p.currency) : null,
          services: servicesValue,
          updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : (typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString()),
        };
        
        // Test full item serialization
        JSON.stringify(item);
        serializedItems.push(item as AdminPropertyListItem);
      } catch (itemError: any) {
        console.error(`[GET /admin/properties] Error serializing property ${p?.id}:`, itemError);
        console.error(`[GET /admin/properties] Property data:`, {
          id: p?.id,
          title: p?.title,
          status: p?.status,
          hasOwner: !!p?.owner,
          ownerType: typeof p?.owner,
        });
        // Add minimal item if serialization fails
        try {
          serializedItems.push({
            id: p?.id || 0,
            title: p?.title || '',
            status: p?.status || 'DRAFT',
            type: p?.type || null,
            owner: p?.owner ? {
              id: p.owner.id,
              name: p.owner.name,
              email: p.owner.email,
            } : null,
            regionName: p?.regionName ?? null,
            district: p?.district ?? null,
            photos: [],
            roomsSpec: p?.roomsSpec ?? null,
            basePrice: effectivePropertyBasePrice(p),
            currency: p?.currency ?? null,
            services: p?.services ?? null,
            updatedAt: p?.updatedAt instanceof Date ? p.updatedAt.toISOString() : new Date().toISOString(),
          });
        } catch (minimalError) {
          console.error(`[GET /admin/properties] Failed to create minimal item for property ${p?.id}:`, minimalError);
          // Skip this item entirely if even minimal serialization fails
        }
      }
    }

    const response: AdminPropertyListResponse = {
      page: Number(page),
      pageSize: take,
      total,
      items: serializedItems,
    };

    // Test JSON serialization before sending
    try {
      JSON.stringify(response);
      res.json(response);
    } catch (jsonError: any) {
      console.error('[GET /admin/properties] JSON serialization error:', jsonError);
      // Return minimal safe response
      res.json({
        page: Number(page),
        pageSize: take,
        total: 0,
        items: [],
      });
    }
  } catch (err: any) {
    // Ensure error responses are JSON
    res.setHeader('Content-Type', 'application/json');
    // Ultimate fallback - catch ANY error
    console.error('CRITICAL ERROR in GET /admin/properties:', err);
    console.error('Error type:', typeof err);
    console.error('Error constructor:', err?.constructor?.name);
    console.error('Error message:', err?.message);
    console.error('Error stack:', err?.stack);
    
    // Check for Prisma errors
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.warn('Prisma error in GET /admin/properties:', err.code, err.message);
    } else if (err instanceof Prisma.PrismaClientValidationError) {
      console.warn('Prisma validation error in GET /admin/properties:', err.message);
    }
    
    // Always return valid JSON response - use same structure as success response
    const pageNum = Number((req.query as any)?.page) || 1;
    const pageSizeNum = Math.min(Number((req.query as any)?.pageSize || 20), 200);
    
    // Create safe error response
    const errorResponse = {
      page: pageNum,
      pageSize: pageSizeNum,
      total: 0,
      items: [],
    };
    
    // Test serialization before sending
    try {
      JSON.stringify(errorResponse);
      return res.status(500).json(errorResponse);
    } catch (serializeError) {
      // If even error response can't be serialized, send minimal response
      console.error('Failed to serialize error response:', serializeError);
      return res.status(500).json({ 
        page: 1, 
        pageSize: 20, 
        total: 0, 
        items: [] 
      });
    }
  }
}) as RequestHandler);

/**
 * GET /admin/properties/booked
 * Query: status=&q=&page=&pageSize=
 * Returns properties that have at least one Booking.
 */
router.get("/booked", (async (req: AuthedRequest, res) => {
  try {
    res.setHeader('Content-Type', 'application/json');

    const { status = "APPROVED", q, page = "1", pageSize = "50" } = req.query as any;

    const where: any = {
      bookings: { some: {} },
    };

    if (status && status !== "ALL") {
      where.status = String(status);
    }

    const searchTerm = typeof q === "string" ? q.trim().slice(0, 120) : "";
    if (searchTerm) {
      where.OR = [
        { title: { contains: searchTerm } },
        { regionName: { contains: searchTerm } },
        { district: { contains: searchTerm } },
      ];
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 200);

    const [items, total] = await Promise.all([
      prisma.property.findMany({
        where,
        orderBy: { id: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          regionName: true,
          district: true,
          updatedAt: true,
          owner: { select: { id: true, name: true, email: true } },
        },
        skip,
        take,
      }),
      prisma.property.count({ where }),
    ]);

    return res.json({
      page: Number(page),
      pageSize: take,
      total,
      items: items.map((p: any) => ({
        ...p,
        updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
      })),
    });
  } catch (err: any) {
    console.error('[GET /admin/properties/booked] failed:', err?.message || err);
    return res.status(500).json({ page: 1, pageSize: 50, total: 0, items: [] });
  }
}) as RequestHandler);

/** GET /admin/properties/counts - return counts by status for quick badges */
router.get("/counts", (async (req: AuthedRequest, res) => {
  try {
    const statuses = ["DRAFT","PENDING","APPROVED","NEEDS_FIXES","REJECTED","SUSPENDED"] as const;
    const results: Record<string, number> = {};
    
    await Promise.all(statuses.map(async (s) => {
      try {
        const c = await prisma.property.count({ where: { status: s as any } });
        // Ensure count is a number (not BigInt) for JSON serialization
        results[s] = typeof c === 'bigint' ? Number(c) : Number(c);
      } catch (countErr: any) {
        console.error(`[GET /admin/properties/counts] Failed to count status ${s}:`, countErr);
        results[s] = 0;
      }
    }));
    
    // Test JSON serialization before sending
    try {
      JSON.stringify(results);
      res.setHeader('Content-Type', 'application/json');
      res.json(results);
    } catch (jsonError: any) {
      console.error('[GET /admin/properties/counts] JSON serialization error:', jsonError);
      // Return empty results on serialization error
      res.setHeader('Content-Type', 'application/json');
      res.json({ DRAFT:0, PENDING:0, APPROVED:0, NEEDS_FIXES:0, REJECTED:0, SUSPENDED:0 });
    }
  } catch (err: any) {
    console.error("/admin/properties/counts failed:", err?.message || err);
    console.error("/admin/properties/counts error stack:", err?.stack);
    // Fail-open with zeros to avoid breaking UI - always return JSON
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ DRAFT:0, PENDING:0, APPROVED:0, NEEDS_FIXES:0, REJECTED:0, SUSPENDED:0 });
  }
}) as RequestHandler);

/** GET /admin/properties/:id/audit-history - Get audit history for a property */
router.get("/:id/audit-history", (async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid property ID" });

    const limitRaw = Number((req.query as any)?.limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;
    const includeDetailsRaw = String((req.query as any)?.includeDetails ?? "1");
    const includeDetails = includeDetailsRaw === "1" || includeDetailsRaw.toLowerCase() === "true";

    console.log(`[audit-history] Fetching audit history for property ID: ${id}`);

    const where = {
      entity: "PROPERTY" as const,
      entityId: id,
    };

    const auditBaseSelect = {
      id: true,
      actorId: true,
      actorRole: true,
      action: true,
      entity: true,
      entityId: true,
      ip: true,
      ua: true,
      createdAt: true,
      actor: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    } as const;

    const fetchAuditBase = async (take: number) =>
      prisma.auditLog.findMany({
        where,
        // Avoid MariaDB "Out of sort memory" by ordering on indexed PK.
        // A composite index on (entity, entityId, id) makes this fast.
        orderBy: { id: "desc" },
        take,
        select: auditBaseSelect,
      });

    let auditsBase: Array<(typeof fetchAuditBase extends (...args: any) => Promise<infer R> ? R : never)[number]> = [];
    try {
      auditsBase = await fetchAuditBase(limit);
    } catch (dbErr: any) {
      const msg = String(dbErr?.message || "");
      const isSortBufferError = msg.toLowerCase().includes("out of sort memory") || msg.toLowerCase().includes("sort buffer");
      if (!isSortBufferError) throw dbErr;

      console.warn("[audit-history] sort-buffer error; retrying with smaller limit and no details", {
        propertyId: id,
        limit,
        error: msg,
      });

      auditsBase = await fetchAuditBase(Math.min(20, limit));
    }

    let detailsById = new Map<
      string,
      {
        beforeJson: any;
        afterJson: any;
        changes: Array<{ field: string; from: any; to: any }>;
      }
    >();
    if (includeDetails && auditsBase.length > 0) {
      const ids = auditsBase.map((a) => a.id);

      try {
        // Fetch raw JSON once (capped) and compute a safe, compact diff in JS.
        const detailIds = ids.slice(0, Math.min(ids.length, 50));
        const detailRows = await prisma.auditLog.findMany({
          where: { id: { in: detailIds } },
          select: { id: true, beforeJson: true, afterJson: true },
        });

        const allowedStatuses = new Set(["DRAFT", "PENDING", "APPROVED", "NEEDS_FIXES", "REJECTED", "SUSPENDED"]);
        const normalizeNullableText = (v: any) => {
          if (v === null || v === undefined) return null;
          if (typeof v === "string") {
            const t = v.trim();
            return t.length ? t : null;
          }
          if (typeof v === "number" || typeof v === "boolean") return String(v);
          return null;
        };
        const clip = (v: any) => {
          if (v === null || v === undefined) return null;
          const s = String(v);
          return s.length > 140 ? s.slice(0, 140) + "…" : s;
        };
        const parseMaybeJson = (v: any) => {
          if (v === null || v === undefined) return null;
          if (typeof v === "object") return v;
          if (typeof v === "string") {
            try {
              return JSON.parse(v);
            } catch {
              return null;
            }
          }
          return null;
        };
        const get = (obj: any, key: string) => (obj && typeof obj === "object" ? (obj as any)[key] : undefined);
        const has = (obj: any, key: string) =>
          !!(obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, key));

        detailsById = new Map(
          detailRows.map((row) => {
            const before = parseMaybeJson(row.beforeJson);
            const after = parseMaybeJson(row.afterJson);

            const beforeStatusRaw = normalizeNullableText(get(before, "status"));
            const afterStatusRaw = normalizeNullableText(get(after, "status"));
            const safeBeforeStatus = beforeStatusRaw && allowedStatuses.has(beforeStatusRaw) ? beforeStatusRaw : null;
            const safeAfterStatus = afterStatusRaw && allowedStatuses.has(afterStatusRaw) ? afterStatusRaw : null;
            const afterReason = normalizeNullableText(get(after, "reason"));
            const safeAfterReason = afterReason ? afterReason.slice(0, 500) : null;

            const changes: Array<{ field: string; from: any; to: any }> = [];
            const pushChange = (field: string, fromV: any, toV: any) => {
              const fromN = normalizeNullableText(fromV);
              const toN = normalizeNullableText(toV);
              if (fromN === toN) return;
              changes.push({ field, from: clip(fromN), to: clip(toN) });
            };

            // Many audits store afterJson as a patch (only changed keys). To avoid false removals,
            // only compute diffs for fields that exist in afterJson.
            const compareField = (key: string, label: string) => {
              if (!has(after, key)) return;
              if (key === "status") {
                pushChange(label, safeBeforeStatus, safeAfterStatus);
                return;
              }
              if (key === "reason") {
                pushChange(label, null, safeAfterReason);
                return;
              }
              const fromV = has(before, key) ? get(before, key) : null;
              const toV = get(after, key);
              pushChange(label, fromV, toV);
            };

            compareField("title", "Title");
            compareField("description", "Description");
            compareField("type", "Type");
            compareField("status", "Status");
            compareField("basePrice", "Base price");
            compareField("currency", "Currency");
            compareField("regionName", "Region");
            compareField("district", "District");
            compareField("ward", "Ward");
            compareField("zip", "ZIP");
            compareField("city", "City");
            compareField("latitude", "Latitude");
            compareField("longitude", "Longitude");
            compareField("reason", "Reason");

            // Photos: show count changes
            if (has(after, "photos")) {
              const photosBefore = Array.isArray(get(before, "photos")) ? (get(before, "photos") as any[]).length : null;
              const photosAfter = Array.isArray(get(after, "photos")) ? (get(after, "photos") as any[]).length : null;
              if (photosBefore !== photosAfter && (photosBefore !== null || photosAfter !== null)) {
                changes.push({ field: "Photos", from: photosBefore, to: photosAfter });
              }
            }

            // Services: surface a couple admin-relevant knobs.
            if (has(after, "services")) {
              const bServices = get(before, "services");
              const aServices = get(after, "services");
              if (bServices && aServices && typeof bServices === "object" && typeof aServices === "object") {
                const bCommission = (bServices as any).commissionPercent;
                const aCommission = (aServices as any).commissionPercent;
                if (bCommission !== aCommission) {
                  changes.push({ field: "Commission %", from: clip(bCommission), to: clip(aCommission) });
                }

                const bDiscount = (bServices as any).discountRules;
                const aDiscount = (aServices as any).discountRules;
                const bDiscStr = bDiscount === undefined ? undefined : JSON.stringify(bDiscount);
                const aDiscStr = aDiscount === undefined ? undefined : JSON.stringify(aDiscount);
                if (bDiscStr !== aDiscStr) {
                  changes.push({ field: "Discount rules", from: clip(bDiscStr), to: clip(aDiscStr) });
                }
              }
            }

            // Rooms: show a few changed room prices if present.
            if (has(after, "roomsSpec")) {
              const bRooms = Array.isArray(get(before, "roomsSpec")) ? (get(before, "roomsSpec") as any[]) : null;
              const aRooms = Array.isArray(get(after, "roomsSpec")) ? (get(after, "roomsSpec") as any[]) : null;
              if (bRooms && aRooms) {
                const bByKey = new Map<string, any>();
                bRooms.forEach((room, idx) => {
                  const key = room?.id ? String(room.id) : `#${idx}`;
                  bByKey.set(key, room);
                });

                let roomDiffs = 0;
                for (let idx = 0; idx < aRooms.length && roomDiffs < 8; idx++) {
                  const room = aRooms[idx];
                  const key = room?.id ? String(room.id) : `#${idx}`;
                  const prev = bByKey.get(key);
                  const prevPrice = prev?.pricePerNight ?? prev?.price;
                  const nextPrice = room?.pricePerNight ?? room?.price;
                  if (prevPrice !== nextPrice && (prevPrice !== undefined || nextPrice !== undefined)) {
                    const label = room?.name ? `Room ${room.name} price` : `Room ${key} price`;
                    changes.push({ field: label, from: clip(prevPrice), to: clip(nextPrice) });
                    roomDiffs++;
                  }
                }
              }
            }

            const beforeJson = safeBeforeStatus ? { status: safeBeforeStatus } : null;
            const afterJson =
              safeAfterStatus || safeAfterReason
                ? {
                    ...(safeAfterStatus ? { status: safeAfterStatus } : {}),
                    ...(safeAfterReason ? { reason: safeAfterReason } : {}),
                  }
                : null;

            return [row.id.toString(), { beforeJson, afterJson, changes: changes.slice(0, 20) }];
          })
        );
      } catch (detailErr: any) {
        console.warn("[audit-history] Failed to fetch audit details; returning base rows only", {
          propertyId: id,
          error: detailErr?.message || String(detailErr),
        });
      }
    }

    console.log(`[audit-history] Found ${auditsBase.length} audit logs for property ${id}`);

    // Transform to ensure consistent response format
    const formattedAudits = auditsBase.map((audit: any) => {
      const detail = detailsById.get(audit.id.toString());
      return {
        id: audit.id.toString(),
        actorId: audit.actorId,
        actorRole: audit.actorRole,
        action: audit.action,
        entity: audit.entity,
        entityId: audit.entityId,
        beforeJson: detail?.beforeJson ?? null,
        afterJson: detail?.afterJson ?? null,
        changes: detail?.changes ?? [],
        ip: audit.ip,
        ua: audit.ua,
        createdAt: audit.createdAt.toISOString(),
        actor: audit.actor
          ? {
              id: audit.actor.id,
              name: audit.actor.name,
              email: audit.actor.email,
            }
          : null,
      };
    });

    console.log(`[audit-history] Returning ${formattedAudits.length} formatted audit logs`);
    res.setHeader('Content-Type', 'application/json');
    res.json(formattedAudits);
  } catch (err: any) {
    console.error("Failed to fetch audit history:", {
      error: err?.message || String(err),
      stack: err?.stack,
      propertyId: req.params.id,
    });
    // Fail-open for UI stability: return empty list instead of 500.
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json([]);
  }
}) as RequestHandler);

/** GET /admin/properties/:id */
router.get(
  "/:id",
  (async (req: AuthedRequest, res) => {
    const id = Number(req.params.id);
    const p = await prisma.property.findFirst({
      where: { id },
      select: adminPropertyDTOSelect,
    });
    if (!p) return res.status(404).json({ error: "Not found" });
    const dto = toAdminPropertyDTO(p);
    res.json(dto);
  }) as RequestHandler
);

/** PATCH /admin/properties/:id - Admin can edit property details */
router.patch("/:id", (async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const property = await prisma.property.findFirst({ 
      where: { id },
      select: adminPropertyDTOSelect,
    });
    if (!property) return res.status(404).json({ error: "Property not found" });

    const {
      title,
      description,
      basePrice,
      currency,
      commissionPercent,
      discountRules,
      roomPrices,
      latitude,
      longitude,
      coordinateCorrectionReason,
    } = req.body;

    const updateData: any = {};
    if (title !== undefined) updateData.title = String(title);
    if (description !== undefined) updateData.description = String(description);
    if (basePrice !== undefined) updateData.basePrice = Number(basePrice);
    if (currency !== undefined) updateData.currency = String(currency);

    const coordinatesRequested = latitude !== undefined || longitude !== undefined;
    let correctionReason: string | null = null;
    if (coordinatesRequested) {
      if (latitude === undefined || longitude === undefined) {
        return res.status(400).json({ error: "Latitude and longitude must be provided together" });
      }
      if (String(latitude).trim() === "" || String(longitude).trim() === "") {
        return res.status(400).json({ error: "Latitude and longitude cannot be empty" });
      }

      const latitudeNumber = Number(latitude);
      const longitudeNumber = Number(longitude);
      if (!Number.isFinite(latitudeNumber) || latitudeNumber < -90 || latitudeNumber > 90) {
        return res.status(400).json({ error: "Latitude must be between -90 and 90" });
      }
      if (!Number.isFinite(longitudeNumber) || longitudeNumber < -180 || longitudeNumber > 180) {
        return res.status(400).json({ error: "Longitude must be between -180 and 180" });
      }

      correctionReason = String(coordinateCorrectionReason || "").trim();
      if (correctionReason.length < 5 || correctionReason.length > 500) {
        return res.status(400).json({ error: "A correction reason between 5 and 500 characters is required" });
      }

      updateData.latitude = latitudeNumber;
      updateData.longitude = longitudeNumber;
    }

    // Store commission and discount rules in services JSON field
    if (commissionPercent !== undefined || discountRules !== undefined) {
      // Get existing services or initialize as object
      const existingServices = property.services && typeof property.services === 'object' 
        ? property.services as any 
        : {};
      
      const updatedServices = { ...existingServices };
      
      // Store commission percent (null means use system default)
      if (commissionPercent !== undefined) {
        if (commissionPercent === null) {
          delete updatedServices.commissionPercent;
        } else {
          updatedServices.commissionPercent = Number(commissionPercent);
        }
      }
      
      // Store discount rules
      if (discountRules !== undefined) {
        if (Array.isArray(discountRules) && discountRules.length > 0) {
          updatedServices.discountRules = discountRules;
        } else {
          delete updatedServices.discountRules;
        }
      }
      
      updateData.services = updatedServices;
    }

    let updated = await prisma.property.update({
      where: { id },
      data: updateData,
      select: adminPropertyDTOSelect,
    });

    // Invalidate cache for this property and property lists
    await Promise.all([
      invalidateCache(cacheKeys.property(id)),
      invalidateCache('properties:list:*'),
      invalidateCache(cacheKeys.adminSummary()),
    ]).catch(() => {}); // Don't fail the request if cache invalidation fails

    // Update room prices if provided
    // Rooms are stored in the roomsSpec JSON field, not a separate Room table
    if (roomPrices && typeof roomPrices === 'object') {
      if (property.roomsSpec && Array.isArray(property.roomsSpec)) {
        const roomsArray = property.roomsSpec as any[];
        const updatedRoomsSpec = roomsArray.map((room: any, index: number) => {
          // Try to match by room ID or index
          const roomId = room.id ? String(room.id) : null;
          
          // Check if this room's price should be updated
          const priceUpdate = roomId && roomPrices[roomId] !== undefined
            ? roomPrices[roomId]
            : roomPrices[index] !== undefined
            ? roomPrices[index]
            : null;
          
          if (priceUpdate !== null && Number.isFinite(Number(priceUpdate))) {
            return {
              ...room,
              pricePerNight: Number(priceUpdate),
              price: Number(priceUpdate),
            };
          }
          return room;
        });
        
        // Update roomsSpec in the property
        updated = await prisma.property.update({
          where: { id },
          data: { roomsSpec: updatedRoomsSpec },
          select: adminPropertyDTOSelect,
        });
        
        // Invalidate cache for this property
        await invalidateCache(cacheKeys.property(id)).catch(() => {});
      }
    }

    await auditLog({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: coordinatesRequested ? "PROPERTY_COORDINATES_UPDATE" : "PROPERTY_UPDATE",
      entity: "PROPERTY",
      entityId: id,
      before: property,
      after: coordinatesRequested ? { ...updated, reason: correctionReason } : updated,
      ip: req.ip,
      ua: req.headers["user-agent"] as string,
    });

    res.json(toAdminPropertyDTO(updated));
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Update failed" });
  }
}) as RequestHandler);

/** GET /admin/properties/:id/images */
router.get("/:id/images", (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const images = await prisma.propertyImage.findMany({ where: { propertyId: id }, orderBy: { createdAt: 'asc' } });
  res.json({ items: images });
}) as RequestHandler);

/** PATCH /admin/properties/images/:imageId { status?: string, moderationNote?: string } */
router.patch("/images/:imageId", (async (req: AuthedRequest, res) => {
  const imageId = Number(req.params.imageId);
  const { status, moderationNote } = req.body as any;
  const before = await prisma.propertyImage.findFirst({ where: { id: imageId } });
  if (!before) return res.status(404).json({ error: 'Not found' });

  const updated = await prisma.propertyImage.update({ where: { id: imageId }, data: { status: status ?? before.status, moderationNote: moderationNote ?? before.moderationNote, moderatedAt: status ? new Date() : before.moderatedAt } });

  // audit
  await auditLog({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: `PROPERTY_IMAGE_MODERATE`,
    entity: "PROPERTY",
    entityId: before.propertyId,
    before: before,
    after: updated,
    ip: req.ip,
    ua: req.headers['user-agent'] as string,
  });

  res.json({ ok: true, image: updated });
}) as RequestHandler);

/** POST /admin/properties/images/:imageId/process - mark for processing (thumbnail/webp) */
router.post("/images/:imageId/process", (async (req: AuthedRequest, res) => {
  const imageId = Number(req.params.imageId);
  const img = await prisma.propertyImage.findFirst({ where: { id: imageId } });
  if (!img) return res.status(404).json({ error: 'Not found' });

  // mark as processing; actual background worker will pick this up by polling or queue
  const updated = await prisma.propertyImage.update({ where: { id: imageId }, data: { status: 'PROCESSING' } });

  await auditLog({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: `PROPERTY_IMAGE_PROCESS_REQUEST`,
    entity: "PROPERTY",
    entityId: img.propertyId,
    before: img,
    after: updated,
    ip: req.ip,
    ua: req.headers['user-agent'] as string,
  });

  // emit event for real-time UIs
  emitEvent('property.image.processing', { propertyId: img.propertyId, imageId });

  res.json({ ok: true });
}) as RequestHandler);

/** POST /admin/properties/:id/approve */
router.post("/:id/approve", (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parse = ApprovePropertyInput.safeParse(req.body);
  if (!parse.success) { res.status(400).json({ error: parse.error.flatten() }); return; }

  const before = await prisma.property.findFirst({
    where: { id },
    select: { status: true, ownerId: true, title: true, tourismSiteId: true, parkPlacement: true },
  });
  if (!before) { res.status(404).json({ error: "Not found" }); return; }
  if ((before.parkPlacement === "INSIDE" || before.parkPlacement === "NEARBY") && !before.tourismSiteId) {
    res.status(400).json({ error: "tourismSiteId_required_when_parkPlacement_set" });
    return;
  }
  if (before.tourismSiteId) {
    const site = await prisma.tourismSite.findUnique({ where: { id: before.tourismSiteId }, select: { id: true } });
    if (!site) {
      res.status(400).json({ error: "invalid_tourismSiteId" });
      return;
    }
  }
  // Approve can only be used for initial approval (PENDING) or re-approval after rejection (REJECTED)
  // Once approved, properties can only be suspended/unsuspended, not re-approved
  // To restore a suspended property, use unsuspend instead
  if (!["PENDING", "REJECTED"].includes(before.status)) {
    res.status(400).json({ 
      error: `Cannot approve from status ${before.status}. Approval is only available for PENDING or REJECTED properties. To restore a SUSPENDED property, use unsuspend instead.` 
    }); 
    return;
  }

  const updated = await prisma.$transaction(async (tx) => {
    const property = await tx.property.update({
      where: { id },
      data: {
        status: "APPROVED",
        ...(before.tourismSiteId && !(before.parkPlacement === "INSIDE" || before.parkPlacement === "NEARBY")
          ? { parkPlacement: "NEARBY" }
          : {}),
      },
      select: { id: true, status: true },
    });

    await upsertPropertyVerification(tx as any, id, {
      status: "VERIFIED",
      adminId: req.user!.id,
      method: DEFAULT_PROPERTY_VERIFICATION_METHOD,
    });

    return property;
  });

  // Ensure PropertyImage records exist for every photo URL.
  // Properties submitted before the PropertyImage system was active (or where the initial
  // upsert silently failed) only have URLs in the `photos` JSON field.
  // Backfill them here so the public page can show photos immediately after approval.
  try {
    const existingCount = await prisma.propertyImage.count({ where: { propertyId: id } });
    if (existingCount === 0) {
      const propData = await prisma.property.findUnique({ where: { id }, select: { photos: true } });
      let photosArr: any[] = [];
      const rawPhotos = propData?.photos;
      if (Array.isArray(rawPhotos)) {
        photosArr = rawPhotos;
      } else if (typeof rawPhotos === "string") {
        try { photosArr = JSON.parse(rawPhotos); } catch { photosArr = []; }
      }
      await Promise.all(
        photosArr.map(async (url: any) => {
          if (typeof url !== "string" || !url.startsWith("http")) return;
          if (url.length > 2048) return;
          const filename = url.split("/").pop() || url;
          const storageKey = `${id}:${filename}`.slice(0, 190);
          await prisma.propertyImage.upsert({
            where: { storageKey },
            create: { propertyId: id, storageKey, url, status: "PENDING" },
            update: { url },
          });
        })
      );
      console.log(`[admin.approve] Backfilled PropertyImage records for property ${id} from photos JSON`);
    }
  } catch (backfillErr) {
    console.warn(`[admin.approve] PropertyImage backfill failed for property ${id}:`, backfillErr);
  }

  // Invalidate cache for this property and property lists
  await Promise.all([
    invalidateCache(cacheKeys.property(id)),
    invalidateCache('properties:list:*'),
    invalidateCache(cacheKeys.adminSummary()),
  ]).catch(() => {}); // Don't fail the request if cache invalidation fails

  const payload = { id, from: before.status, to: "APPROVED", by: req.user!.id };
  const [admin, property] = await Promise.all([
    prisma.user.findFirst({
      where: { id: req.user!.id },
      select: { id: true, name: true, email: true },
    }),
    prisma.property.findFirst({
      where: { id },
      select: { id: true, owner: { select: { id: true, name: true, email: true } } },
    }),
  ]);

  const notificationData = { 
    propertyId: id, 
    propertyTitle: before.title,
    approvedBy: req.user!.id,
    approvedByName: admin?.name || admin?.email || `Admin #${req.user!.id}`,
    ownerId: before.ownerId,
    ownerName: property?.owner?.name || null,
    ownerEmail: property?.owner?.email || null,
  };

  const { notifyOwner, notifyAdmins } = await import("../lib/notifications.js");

  await Promise.all([
    emitEvent("property.status.changed", payload),
    invalidateAdminPropertyQueues(),
    invalidateOwnerPropertyLists(before.ownerId),
    notifyOwner(before.ownerId, "property_approved", notificationData),
    notifyAdmins("property_approved", notificationData),
    createAdminAuditSafe({
      adminId: req.user!.id,
      targetUserId: before.ownerId,
      action: "PROPERTY_APPROVE",
      details: { propertyId: id, title: before.title, fromStatus: before.status, toStatus: "APPROVED" },
    }),
    auditLog({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "PROPERTY_APPROVE",
      entity: "PROPERTY",
      entityId: id,
      before,
      after: { status: "APPROVED" },
      ip: req.ip,
      ua: req.headers["user-agent"] as string,
    }),
  ]);

  broadcastStatus(req, payload);
  res.json({ ok: true, id: updated.id, status: updated.status });
}) as RequestHandler);

/** POST /admin/properties/:id/reject { reasons: string[], note?: string } */
router.post("/:id/reject", (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid property ID" });
  
  const parse = RejectPropertyInput.safeParse(req.body);
  if (!parse.success) {
    const errors = parse.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return res.status(400).json({ error: `Validation failed: ${errors}` });
  }

  const before = await prisma.property.findFirst({
    where: { id },
    select: { status: true, ownerId: true, title: true, tourismSiteId: true, parkPlacement: true },
  });
  if (!before) return res.status(404).json({ error: "Not found" });
  if ((before.parkPlacement === "INSIDE" || before.parkPlacement === "NEARBY") && !before.tourismSiteId) {
    return res.status(400).json({ error: "tourismSiteId_required_when_parkPlacement_set" });
  }
  if (before.tourismSiteId) {
    const site = await prisma.tourismSite.findUnique({ where: { id: before.tourismSiteId }, select: { id: true } });
    if (!site) {
      return res.status(400).json({ error: "invalid_tourismSiteId" });
    }
  }
  // Reject can only be used for properties awaiting initial approval (PENDING)
  // Once approved, properties can only be suspended/unsuspended, not rejected
  if (before.status !== "PENDING") {
    return res.status(400).json({ 
      error: `Cannot reject from status ${before.status}. Rejection is only available for PENDING properties awaiting initial approval.` 
    });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const property = await tx.property.update({
      where: { id },
      data: { status: "REJECTED" },
      select: { id: true, status: true },
    });

    await upsertPropertyVerification(tx as any, id, {
      status: "REJECTED",
      adminId: req.user!.id,
      method: "NoLSAF property review",
      note: verificationNoteFor("REJECTED", parse.data.reasons.join("; ")),
    });

    return property;
  });

  // Invalidate cache for this property and property lists
  await Promise.all([
    invalidateCache(cacheKeys.property(id)),
    invalidateCache('properties:list:*'),
    invalidateCache(cacheKeys.adminSummary()),
  ]).catch(() => {}); // Don't fail the request if cache invalidation fails

  const payload = {
    id,
    from: before.status,
    to: "REJECTED",
    by: req.user!.id,
    reasons: parse.data.reasons,
  };

  await Promise.all([
    emitEvent("property.status.changed", payload),
    invalidateAdminPropertyQueues(),
    invalidateOwnerPropertyLists(before.ownerId),
    notifyOwner(before.ownerId, "property_rejected", {
      propertyId: id,
      propertyTitle: before.title,
      reasons: parse.data.reasons,
      note: parse.data.note,
    }),
    createAdminAuditSafe({
      adminId: req.user!.id,
      targetUserId: before.ownerId,
      action: "PROPERTY_REJECT",
      details: { propertyId: id, title: before.title, fromStatus: before.status, toStatus: "REJECTED", reasons: parse.data.reasons, note: parse.data.note ?? null },
    }),
    auditLog({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "PROPERTY_REJECT",
      entity: "PROPERTY",
      entityId: id,
      before,
      after: { status: "REJECTED", reasons: parse.data.reasons },
      ip: req.ip,
      ua: req.headers["user-agent"] as string,
    }),
  ]);

  broadcastStatus(req, payload);
  res.json({ ok: true, id: updated.id, status: updated.status });
}) as RequestHandler);

/** POST /admin/properties/:id/suspend { reason } */
router.post("/:id/suspend", (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid property ID" });
  
  const parse = SuspendPropertyInput.safeParse(req.body);
  if (!parse.success) {
    const errors = parse.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return res.status(400).json({ error: `Validation failed: ${errors}` });
  }

  const before = await prisma.property.findFirst({
    where: { id },
    select: { status: true, ownerId: true, title: true, tourismSiteId: true, parkPlacement: true },
  });
  if (!before) return res.status(404).json({ error: "Not found" });
  
  // If already suspended, return error
  if (before.status === "SUSPENDED")
    return res.status(400).json({ error: "Property is already suspended" });
  
  // Only APPROVED properties can be suspended
  // Once approved, properties can only be suspended/unsuspended, not rejected
  if (before.status !== "APPROVED") {
    return res.status(400).json({ 
      error: `Cannot suspend property with status ${before.status}. Only APPROVED properties can be suspended.` 
    });
  }
  
  // Change status from APPROVED to SUSPENDED
  const newStatus = "SUSPENDED";
  
  const appliedAt = new Date();
  const { property: updated, restriction } = await prisma.$transaction(async (tx) => {
    const property = await tx.property.update({
      where: { id },
      data: { status: newStatus },
      select: { id: true, status: true },
    });

    await upsertPropertyVerification(tx as any, id, {
      status: "PENDING",
      adminId: req.user!.id,
      method: "NoLSAF property suspension",
      note: verificationNoteFor("PENDING", parse.data.reason),
    });

    const restriction = await createRestrictionCase(tx as any, {
      scope: RESTRICTION_SCOPE.MARKETPLACE_PROPERTY,
      ownerId: before.ownerId,
      targetId: id,
      propertyId: id,
      reason: parse.data.reason,
      appliedByAdminId: req.user!.id,
      appliedAt,
    });

    return { property, restriction };
  });

  // Invalidate cache for this property and property lists
  await Promise.all([
    invalidateCache(cacheKeys.property(id)),
    invalidateCache('properties:list:*'),
    invalidateCache(cacheKeys.adminSummary()),
  ]).catch(() => {}); // Don't fail the request if cache invalidation fails

  const payload = {
    id,
    from: before.status,
    to: newStatus,
    by: req.user!.id,
    reason: parse.data.reason,
  };

  const promises: Promise<any>[] = [
    emitEvent("property.status.changed", payload),
    invalidateAdminPropertyQueues(),
    invalidateOwnerPropertyLists(before.ownerId),
    // Always notify owner immediately when property is suspended
    notifyOwner(before.ownerId, "property_suspended", {
      propertyId: id,
      propertyTitle: before.title,
      reason: parse.data.reason,
      referenceCode: restriction.referenceCode,
    }),
    createAdminAuditSafe({
      adminId: req.user!.id,
      targetUserId: before.ownerId,
      action: "PROPERTY_SUSPEND",
      details: { propertyId: id, title: before.title, fromStatus: before.status, toStatus: newStatus, reason: parse.data.reason, referenceCode: restriction.referenceCode },
    }),
    (async () => {
      const auditResult = await auditLog({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: "PROPERTY_SUSPEND",
        entity: "PROPERTY",
        entityId: id,
        before,
        after: { status: newStatus, reason: parse.data.reason, referenceCode: restriction.referenceCode },
        ip: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || req.ip || undefined,
        ua: (req.headers["user-agent"] as string) || undefined,
      });
      if (!auditResult) {
        console.error(`[suspend] Failed to create audit log for property ${id}`);
      } else {
        console.log(`[suspend] Successfully created audit log for property ${id}, audit ID: ${auditResult.id}`);
      }
      return auditResult;
    })(),
  ];

  await Promise.all(promises);

  const emailDelivery = await sendRestrictionOpenedEmail(restriction, before.title);

  broadcastStatus(req, payload);
  res.json({ ok: true, id: updated.id, status: updated.status, referenceCode: restriction.referenceCode, emailDelivery });
}) as RequestHandler);

/** POST /admin/properties/:id/unsuspend { reason } */
router.post("/:id/unsuspend", (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid property ID" });
  
  const parse = UnsuspendPropertyInput.safeParse(req.body);
  if (!parse.success) {
    const errors = parse.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return res.status(400).json({ error: `Validation failed: ${errors}` });
  }

  const before = await prisma.property.findFirst({
    where: { id },
    select: { status: true, ownerId: true, title: true, tourismSiteId: true, parkPlacement: true },
  });
  if (!before) return res.status(404).json({ error: "Not found" });
  
  // Can only unsuspend from SUSPENDED status
  // Once approved, properties can only be suspended/unsuspended, not rejected
  if (before.status !== "SUSPENDED") {
    return res.status(400).json({ 
      error: `Cannot unsuspend from ${before.status}. Property must be SUSPENDED to be unsuspended.` 
    });
  }

  const { property: updated, restriction } = await prisma.$transaction(async (tx) => {
    const property = await tx.property.update({
      where: { id },
      data: {
        status: "APPROVED",
        ...(before.tourismSiteId && !(before.parkPlacement === "INSIDE" || before.parkPlacement === "NEARBY")
          ? { parkPlacement: "NEARBY" }
          : {}),
      },
      select: { id: true, status: true },
    });

    await upsertPropertyVerification(tx as any, id, {
      status: "VERIFIED",
      adminId: req.user!.id,
      method: "NoLSAF property unsuspension",
      note: "This stay was re-verified and restored to public listing by NoLSAF.",
    });

    const restriction = await resolveRestrictionCase(tx as any, {
      scope: RESTRICTION_SCOPE.MARKETPLACE_PROPERTY,
      targetId: id,
      resolvedByAdminId: req.user!.id,
      resolutionNote: parse.data.reason,
    });

    return { property, restriction };
  });

  // Invalidate cache for this property and property lists
  await Promise.all([
    invalidateCache(cacheKeys.property(id)),
    invalidateCache('properties:list:*'),
    invalidateCache(cacheKeys.adminSummary()),
  ]).catch(() => {}); // Don't fail the request if cache invalidation fails

  const payload = { 
    id, 
    from: before.status, 
    to: "APPROVED", 
    by: req.user!.id,
    reason: parse.data.reason,
  };

  await Promise.all([
    emitEvent("property.status.changed", payload),
    invalidateAdminPropertyQueues(),
    invalidateOwnerPropertyLists(before.ownerId),
    notifyOwner(before.ownerId, "property_unsuspended", { 
      propertyId: id, 
      propertyTitle: before.title,
      reason: parse.data.reason,
      referenceCode: restriction?.referenceCode ?? null,
    }),
    auditLog({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "PROPERTY_UNSUSPEND",
      entity: "PROPERTY",
      entityId: id,
      before,
      after: { status: "APPROVED", reason: parse.data.reason, referenceCode: restriction?.referenceCode ?? null },
      ip: req.ip,
      ua: req.headers["user-agent"] as string,
    }),
  ]);

  const emailDelivery = restriction
    ? await sendRestrictionResolvedEmail(restriction, before.title)
    : { sent: false, error: "No tracked restriction case was found" };

  broadcastStatus(req, payload);
  res.json({ ok: true, id: updated.id, status: updated.status, referenceCode: restriction?.referenceCode ?? null, emailDelivery });
}) as RequestHandler);

export default router;

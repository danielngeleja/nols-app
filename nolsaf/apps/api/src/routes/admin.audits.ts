// apps/api/src/routes/admin.audits.ts
import { Router, Response } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { Prisma } from "@prisma/client";
import { asyncHandler } from "../middleware/errorHandler.js";

// ============================================================
// Constants
// ============================================================
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const DEFAULT_MAX_RECORDS = 1000;
const MAX_RECORDS_LIMIT = 5000; // Hard limit to prevent memory issues
const CSV_FIELDS = ["id", "adminId", "targetUserId", "action", "details", "createdAt"] as const;

// ============================================================
// TypeScript Interfaces
// ============================================================
interface AuditLogResponse {
  id: number;
  adminId: number | null;
  targetUserId: number | null;
  action: string;
  details: any;
  createdAt: Date;
}

interface PaginatedAuditResponse {
  page: number;
  pageSize: number;
  total: number;
  items: AuditLogResponse[];
}

// ============================================================
// Rate Limiter
// ============================================================
const limitAuditAccess = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // 100 requests per admin per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many audit log requests. Please wait before trying again." },
  keyGenerator: (req) => {
    const adminId = (req as AuthedRequest).user?.id;
    return adminId ? `admin-audits:${adminId}` : req.ip || req.socket.remoteAddress || "unknown";
  },
});

// ============================================================
// Zod Validation Schemas
// ============================================================
const listAuditsQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  adminId: z.string().regex(/^\d+$/).optional().transform((val) => val ? Number(val) : undefined),
  targetId: z.string().regex(/^\d+$/).optional().transform((val) => val ? Number(val) : undefined),
  action: z.string().min(1).max(80).optional(),
  from: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional()),
  to: z.string().datetime().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/).optional()),
  format: z.enum(["csv", "json"]).optional().default("json"),
  page: z.string().regex(/^\d+$/).optional().default("1").transform((val) => Number(val) || 1),
  pageSize: z.string().regex(/^\d+$/).optional().default(String(DEFAULT_PAGE_SIZE)).transform((val) => Number(val) || DEFAULT_PAGE_SIZE),
  sortBy: z.enum(["id", "createdAt", "action", "adminId"]).optional().default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).optional().default("desc"),
}).strict();

// ============================================================
// Helper Functions
// ============================================================
function sendError(res: Response, status: number, message: string, details?: any): void {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json({
    error: message,
    ...(details && { details }),
  });
}

function sendSuccess<T>(res: Response, data?: T, message?: string): void {
  res.setHeader('Content-Type', 'application/json');
  res.json({
    ok: true,
    ...(message && { message }),
    ...(data && { data }),
  });
}

function getAdminId(req: AuthedRequest): number {
  return req.user!.id;
}

/**
 * Parse date string with validation
 */
function parseDate(dateString: string): Date | null {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch {
    return null;
  }
}

/**
 * Lightweight CSV serializer (avoid adding dependency)
 */
function toCsv(rows: Array<Record<string, any>>, fields: readonly string[]): string {
  const esc = (v: any): string => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    if (s.includes(',') || s.includes('\n') || s.includes('"')) return `"${s}"`;
    return s;
  };
  const header = fields.join(',');
  const lines = rows.map((r) => fields.map((f) => esc(r[f])).join(','));
  return [header, ...lines].join('\n');
}

// Validation middleware helper
function validate<T extends z.ZodTypeAny>(schema: T) {
  return (req: any, res: Response, next: any) => {
    try {
      const result = schema.safeParse(req.query);
      if (!result.success) {
        return sendError(res, 400, "Invalid request parameters", { errors: result.error.issues });
      }
      req.validatedQuery = result.data;
      next();
    } catch (validateError: any) {
      sendError(res, 500, "Validation error", { error: validateError.message });
    }
  };
}

// ============================================================
// Router Setup
// ============================================================
const router = Router();
// Note: Authentication is handled at the app level in index.ts
// router.use(requireAuth as unknown as RequestHandler);
// router.use(requireRole("ADMIN") as unknown as RequestHandler);
router.use(limitAuditAccess);

// ============================================================
// GET /api/admin/audits
// ============================================================
router.get("/", validate(listAuditsQuerySchema), asyncHandler(async (req: any, res) => {
  // Set Content-Type early to ensure JSON response
  res.setHeader('Content-Type', 'application/json');
  try {
    const {
      q,
      adminId,
      targetId,
      action,
      from,
      to,
      format,
      page,
      pageSize,
      sortBy,
      sortDir,
    } = req.validatedQuery;

    const adminIdForAudit = getAdminId(req as AuthedRequest);

    // Validate and parse dates
    let fromDate: Date | null = null;
    let toDate: Date | null = null;
    
    if (from) {
      fromDate = parseDate(from);
      if (!fromDate) {
        return sendError(res, 400, "Invalid 'from' date format. Use ISO 8601 format (YYYY-MM-DD or full datetime)");
      }
    }
    
    if (to) {
      toDate = parseDate(to);
      if (!toDate) {
        return sendError(res, 400, "Invalid 'to' date format. Use ISO 8601 format (YYYY-MM-DD or full datetime)");
      }
    }

    // Validate date range
    if (fromDate && toDate && fromDate > toDate) {
      return sendError(res, 400, "'from' date must be before 'to' date");
    }

    // Build where clause with proper Prisma types
    const where: Prisma.AdminAuditWhereInput = {};

    if (adminId) {
      where.adminId = adminId;
    }

    if (targetId) {
      where.targetUserId = targetId;
    }

    if (action) {
      const sanitizedAction = sanitizeText(action);
      where.action = { contains: sanitizedAction };
    }

    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) {
        where.createdAt.gte = fromDate;
      }
      if (toDate) {
        where.createdAt.lte = toDate;
      }
    }

    // Search functionality - MySQL compatible
    if (q) {
      const sanitizedQ = sanitizeText(q);
      // For action field, use contains (MySQL supports this)
      // For JSON details field, we'll need to filter in memory or use raw query
      where.OR = [
        { action: { contains: sanitizedQ } },
        // JSON search will be done in memory after fetch for MySQL compatibility
      ];
    }

    // Build orderBy
    const orderBy: Prisma.AdminAuditOrderByWithRelationInput = {};
    if (sortBy === "id") {
      orderBy.id = sortDir;
    } else if (sortBy === "createdAt") {
      orderBy.createdAt = sortDir;
    } else if (sortBy === "action") {
      orderBy.action = sortDir;
    } else if (sortBy === "adminId") {
      orderBy.adminId = sortDir;
    } else {
      orderBy.createdAt = "desc"; // Default
    }

    // Calculate pagination
    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
    const skip = (pageNum - 1) * pageSizeNum;
    const take = pageSizeNum;

    // For CSV export, use larger limit but cap it
    const effectiveTake = format === "csv" 
      ? Math.min(DEFAULT_MAX_RECORDS, MAX_RECORDS_LIMIT)
      : take;
    // Fetch total count and items
    let total: number;
    let items: any[];
    try {
      [total, items] = await Promise.all([
        prisma.adminAudit.count({ where }),
        prisma.adminAudit.findMany({
          where,
          orderBy,
          skip: format === "csv" ? 0 : skip,
          take: effectiveTake,
        }),
      ]);
    } catch (queryError: any) {
      throw queryError;
    }

    // Filter by JSON search in memory if needed (MySQL JSON search limitation)
    let filteredItems = items;
    if (q) {
      const searchTerm = sanitizeText(q).toLowerCase();
      filteredItems = items.filter((item) => {
        // Search in action (already filtered in query)
        if (item.action.toLowerCase().includes(searchTerm)) {
          return true;
        }
        // Search in JSON details (in memory)
        if (item.details) {
          try {
            const detailsString = JSON.stringify(item.details).toLowerCase();
            return detailsString.includes(searchTerm);
          } catch {
            // If JSON parsing fails, skip this item
            return false;
          }
        }
        return false;
      });
    }

    // Adjust total for CSV (if filtered in memory)
    const effectiveTotal = format === "csv" && q 
      ? filteredItems.length 
      : total;

    // Audit log access (don't fail if audit logging fails)
    try {
      await audit(req as AuthedRequest, "AUDIT_LOG_ACCESSED", "audits", null, {
        filters: { adminId, targetId, action, from, to, q: q ? "***" : undefined },
        format,
        page: pageNum,
        pageSize: pageSizeNum,
      });
    } catch (auditError: any) {
      console.warn('[GET /admin/audits] Failed to log audit access:', auditError);
      // Continue - don't fail the request if audit logging fails
    }

    // Handle CSV export
    if (format === "csv") {
      const rows = filteredItems.map((item) => ({
        id: item.id,
        adminId: item.adminId,
        targetUserId: item.targetUserId,
        action: item.action,
        details: item.details ? JSON.stringify(item.details) : "",
        createdAt: item.createdAt.toISOString(),
      }));
      const csv = toCsv(rows, CSV_FIELDS);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="audits-${Date.now()}.csv"`);
      return res.send(csv);
    }

    // Return paginated JSON response
    const response: PaginatedAuditResponse = {
      page: pageNum,
      pageSize: pageSizeNum,
      total: effectiveTotal,
      items: filteredItems.map((item) => ({
        id: item.id,
        adminId: item.adminId,
        targetUserId: item.targetUserId,
        action: item.action,
        details: item.details,
        createdAt: item.createdAt,
      })),
    };

    sendSuccess(res, response);
  } catch (err: any) {
    // Handle Prisma schema mismatch errors gracefully
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('[GET /admin/audits] Prisma schema mismatch:', err.message);
      const format = req.validatedQuery?.format || "json";
      
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="audits-${Date.now()}.csv"`);
        return res.send(CSV_FIELDS.join(',') + '\n');
      }
      
      return sendSuccess(res, {
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        total: 0,
        items: [],
      });
    }
    console.error('[GET /admin/audits] Error:', err);
    sendError(res, 500, "Failed to fetch audit logs", {
      message: err.message || "Unknown error",
    });
  }
}) as RequestHandler);

export default router;

// apps/api/src/routes/admin.no4pOtp.ts
import { Router } from "express";
import type { RequestHandler, Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { asyncHandler } from "../middleware/errorHandler.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { safeJsonResponse } from "../lib/serializePrisma.js";
import { maskOtpDestination, otpAuditSearchRefs, type OtpAuditDestinationType } from "../lib/otpAudit.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const OTP_RETENTION_DAYS = 30;

const limitAdminNo4pOtpList = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
  keyGenerator: (req) => {
    const adminId = (req as any)?.user?.id;
    if (adminId) return `admin:no4p-otp:${String(adminId)}`;
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

const listQuerySchema = z.object({
  q: z.string().min(1).max(200).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .default("1")
    .transform((v) => Number(v) || 1),
  pageSize: z
    .string()
    .regex(/^\d+$/)
    .optional()
    .default(String(DEFAULT_PAGE_SIZE))
    .transform((v) => Math.min(Number(v) || DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE)),
  status: z.enum(["valid", "expired", "used", "all"]).optional().default("all"),
}).strict();

function sendError(res: Response, status: number, message: string, details?: any): void {
  res.status(status).json({
    error: message,
    ...(details && { details }),
  });
}

function normalizeStatus(now: Date, expiresAt: string | null | undefined, usedAt: Date | null): "valid" | "expired" | "used" | "unknown" {
  if (usedAt) return "used";
  if (!expiresAt) return "unknown";
  const exp = new Date(expiresAt);
  if (Number.isNaN(exp.getTime())) return "unknown";
  return now > exp ? "expired" : "valid";
}

function sanitizeProvider(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    return s.length > 120 ? s.slice(0, 120) : s;
  }

  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    const candidate =
      (typeof v.provider === "string" ? v.provider : null) ||
      (typeof v.name === "string" ? v.name : null) ||
      (typeof v.type === "string" ? v.type : null) ||
      (typeof v.channel === "string" ? v.channel : null) ||
      null;

    if (!candidate) return null;
    const s = candidate.trim();
    if (!s) return null;
    return s.length > 120 ? s.slice(0, 120) : s;
  }

  return null;
}

// Entities are `OTP:<type>:<keyed destination ref>:<keyed code ref>`. Rows
// written before that change embedded the raw destination and a bare code hash,
// so a query also matches the literal text for those older rows.
function otpSearchWhere(q: string): any {
  const terms = [q, ...otpAuditSearchRefs(q)];
  return { OR: terms.map((term) => ({ entity: { contains: term } })) };
}

// Never expose the full destination, or any digits of a code that may still be
// usable. Older rows stored both; newer rows store neither.
function presentOtpRow(after: any, status: string) {
  const type = String(after.destinationType || "") as OtpAuditDestinationType;
  const destination = after.destinationMasked
    ?? (after.destination ? maskOtpDestination(type, String(after.destination)) : null);
  return {
    destination,
    codeMasked: status === "valid" ? null : (after.codeMasked ?? null),
  };
}

function retentionCutoff(now = new Date()): Date {
  return new Date(now.getTime() - OTP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export const router = Router();

// AuthN/AuthZ are mounted in index.ts with requireRole('ADMIN')
router.get(
  "/",
  limitAdminNo4pOtpList as unknown as RequestHandler,
  asyncHandler(async (req: any, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return sendError(res, 400, "Invalid request parameters", { errors: parsed.error.issues });
    }

    const { q, date, page, pageSize, status } = parsed.data;

    // We encode OTP correlation in AuditLog.entity as:
    // `OTP:${destinationType}:${destinationRef}:${codeRef}` (keyed HMACs, see lib/otpAudit.ts)
    // NOTE: AuditLog.entity is non-nullable, so do not filter by `not: null`.
    const cutoff = retentionCutoff();
    const baseWhere: any = {
      action: "NO4P_OTP_SENT",
      entity: { startsWith: "OTP:" },
      createdAt: { gte: cutoff },
    };

    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        baseWhere.createdAt = { gte: maxDate(start, cutoff), lt: end };
      }
    }

    const where: any = q
      ? {
          AND: [
            baseWhere,
            otpSearchWhere(q),
          ],
        }
      : baseWhere;

    const [total, sent] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const entities = sent.map((s: any) => s.entity).filter(Boolean);
    const usedLogs = entities.length
      ? await prisma.auditLog.findMany({
          where: {
            action: "NO4P_OTP_USED",
            entity: { in: entities },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const usedByEntity = new Map<string, any>();
    for (const u of usedLogs as any[]) {
      if (!u?.entity) continue;
      if (!usedByEntity.has(u.entity)) usedByEntity.set(u.entity, u);
    }

    const now = new Date();

    let items = (sent as any[]).map((row) => {
      const after = (row.afterJson ?? {}) as any;
      const used = row.entity ? usedByEntity.get(row.entity) : null;
      const expiresAt: string | null = after.expiresAt ?? null;
      const usedAt: Date | null = used?.createdAt ?? null;
      const computedStatus = normalizeStatus(now, expiresAt, usedAt);

      return {
        id: row.id,
        role: after.userRole ?? row.actorRole ?? null,
        name: after.userName ?? null,
        codeMasked: presentOtpRow(after, computedStatus).codeMasked,
        destinationType: after.destinationType ?? null,
        destination: presentOtpRow(after, computedStatus).destination,
        requestedAt: row.createdAt,
        expiresAt,
        status: computedStatus,
        usedAt,
        usedFor: after.usedFor ?? null,
        provider: sanitizeProvider(after.provider),
        policyCompliant: after.policyCompliant ?? null,
      };
    });

    if (status !== "all") {
      items = items.filter((i) => i.status === status);
    }

    res.json(safeJsonResponse({
      ok: true,
      data: items,
      meta: {
        page,
        pageSize,
        total,
        retentionDays: OTP_RETENTION_DAYS,
      },
    }));
  })
);

router.get(
  "/export.csv",
  limitAdminNo4pOtpList as unknown as RequestHandler,
  asyncHandler(async (req: any, res) => {
    const parsed = listQuerySchema.safeParse({ ...req.query, page: "1", pageSize: String(MAX_PAGE_SIZE) });
    if (!parsed.success) {
      return sendError(res, 400, "Invalid request parameters", { errors: parsed.error.issues });
    }

    const { q, date, status } = parsed.data;
    const cutoff = retentionCutoff();
    const baseWhere: any = {
      action: "NO4P_OTP_SENT",
      entity: { startsWith: "OTP:" },
      createdAt: { gte: cutoff },
    };

    if (date) {
      const start = new Date(`${date}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        baseWhere.createdAt = { gte: maxDate(start, cutoff), lt: end };
      }
    }

    const where: any = q
      ? {
          AND: [
            baseWhere,
            otpSearchWhere(q),
          ],
        }
      : baseWhere;

    const sent = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 10_000,
    });

    const entities = sent.map((s: any) => s.entity).filter(Boolean);
    const usedLogs = entities.length
      ? await prisma.auditLog.findMany({
          where: {
            action: "NO4P_OTP_USED",
            entity: { in: entities },
          },
          orderBy: { createdAt: "asc" },
        })
      : [];

    const usedByEntity = new Map<string, any>();
    for (const u of usedLogs as any[]) {
      if (!u?.entity) continue;
      if (!usedByEntity.has(u.entity)) usedByEntity.set(u.entity, u);
    }

    const now = new Date();
    const rows = (sent as any[])
      .map((row) => {
        const after = (row.afterJson ?? {}) as any;
        const used = row.entity ? usedByEntity.get(row.entity) : null;
        const expiresAt: string | null = after.expiresAt ?? null;
        const usedAt: Date | null = used?.createdAt ?? null;
        const computedStatus = normalizeStatus(now, expiresAt, usedAt);

        return {
          id: row.id,
          role: after.userRole ?? row.actorRole ?? null,
          name: after.userName ?? null,
          codeMasked: presentOtpRow(after, computedStatus).codeMasked,
          destinationType: after.destinationType ?? null,
          destination: presentOtpRow(after, computedStatus).destination,
          requestedAt: row.createdAt,
          expiresAt,
          status: computedStatus,
          usedAt,
          usedFor: after.usedFor ?? null,
          provider: sanitizeProvider(after.provider),
          policyCompliant: after.policyCompliant ?? null,
        };
      })
      .filter((row) => status === "all" || row.status === status);

    const headers = [
      "id",
      "role",
      "name",
      "codeMasked",
      "destinationType",
      "destination",
      "requestedAt",
      "expiresAt",
      "status",
      "usedAt",
      "usedFor",
      "provider",
      "policyCompliant",
    ];
    const csv = [
      headers.join(","),
      ...rows.map((row) =>
        headers
          .map((header) => csvCell((row as Record<string, unknown>)[header]))
          .join(",")
      ),
    ].join("\r\n");

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="no4p-otp-${stamp}.csv"`);
    res.send(csv);
  })
);

export default router;

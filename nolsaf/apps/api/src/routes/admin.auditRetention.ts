import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import type { AuthedRequest } from "../middleware/auth.js";
import {
  AUDIT_RETENTION_DAYS,
  LEGAL_HOLD_RELEASE_GRACE_DAYS,
  legalHoldReleaseExpiresAt,
  retentionFields,
} from "../lib/auditRetention.js";

const router = Router();
const db = prisma as any;

const legalHoldSchema = z.object({
  recordType: z.enum(["AUDIT_LOG", "ADMIN_AUDIT", "ADMIN_WORK_ITEM"]),
  id: z.union([z.string().regex(/^\d+$/), z.number().int().positive()]),
  enabled: z.boolean(),
  reason: z.string().trim().min(5).max(500).optional(),
}).superRefine((value, context) => {
  if (value.enabled && !value.reason) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["reason"],
      message: "A legal hold reason is required",
    });
  }
});

router.get("/policy", ((_req, res) => {
  res.json({
    classes: {
      OTP: { days: AUDIT_RETENTION_DAYS.OTP },
      TECHNICAL: { days: AUDIT_RETENTION_DAYS.TECHNICAL },
      SECURITY: { days: AUDIT_RETENTION_DAYS.SECURITY },
      OPERATIONAL: { days: AUDIT_RETENTION_DAYS.OPERATIONAL },
      FINANCIAL: { days: AUDIT_RETENTION_DAYS.FINANCIAL },
      COMPLIANCE: { days: AUDIT_RETENTION_DAYS.COMPLIANCE },
    },
    legalHoldOverridesExpiry: true,
    cleanupIntervalHours: 24,
  });
}) as RequestHandler);

router.patch("/legal-hold", (async (req: AuthedRequest, res) => {
  const parsed = legalHoldSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid legal hold request", details: parsed.error.flatten() });
  }

  const actorId = Number(req.user?.id);
  if (!Number.isInteger(actorId) || actorId <= 0) {
    return res.status(401).json({ error: "Admin session is required" });
  }

  const { recordType, enabled, reason } = parsed.data;
  const rawId = String(parsed.data.id);
  const where = recordType === "AUDIT_LOG" ? { id: BigInt(rawId) } : { id: Number(rawId) };
  const delegate = recordType === "AUDIT_LOG"
    ? db.auditLog
    : recordType === "ADMIN_AUDIT"
      ? db.adminAudit
      : db.adminWorkItem;
  const existing = await delegate.findUnique({
    where,
    select: { id: true, expiresAt: true, legalHoldAt: true },
  });
  if (!existing) return res.status(404).json({ error: "Audit record not found" });

  const now = new Date();
  await db.$transaction(async (tx: any) => {
    const transactionDelegate = recordType === "AUDIT_LOG"
      ? tx.auditLog
      : recordType === "ADMIN_AUDIT"
        ? tx.adminAudit
        : tx.adminWorkItem;
    const releasedExpiresAt = enabled
      ? existing.expiresAt
      : legalHoldReleaseExpiresAt(existing.expiresAt, now);
    await transactionDelegate.update({
      where,
      data: enabled
        ? { legalHoldAt: existing.legalHoldAt || now, legalHoldReason: reason }
        : { legalHoldAt: null, legalHoldReason: null, expiresAt: releasedExpiresAt },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        actorRole: "ADMIN",
        action: enabled ? "AUDIT_LEGAL_HOLD_SET" : "AUDIT_LEGAL_HOLD_RELEASED",
        entity: "AUDIT_RETENTION",
        entityId: null,
        beforeJson: { recordType, recordId: rawId, held: Boolean(existing.legalHoldAt) },
        afterJson: {
          recordType,
          recordId: rawId,
          held: enabled,
          reason: enabled ? reason : null,
          expiresAt: releasedExpiresAt?.toISOString?.() || releasedExpiresAt || null,
          releaseGraceDays: enabled ? null : LEGAL_HOLD_RELEASE_GRACE_DAYS,
        },
        ip: req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.socket.remoteAddress || null,
        ua: req.headers["user-agent"]?.toString() || null,
        createdAt: now,
        ...retentionFields("COMPLIANCE", now),
      },
    });
  });

  return res.json({
    ok: true,
    legalHold: {
      recordType,
      id: rawId,
      enabled,
      reason: enabled ? reason : null,
      releaseGraceDays: enabled ? null : LEGAL_HOLD_RELEASE_GRACE_DAYS,
    },
  });
}) as RequestHandler);

export default router;

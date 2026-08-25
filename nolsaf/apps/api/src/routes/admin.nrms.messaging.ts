import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { replayMetaMessagingFailures } from "../lib/nrmsMetaWebhookJobs.js";
import { sanitizeText } from "../lib/sanitize.js";
import { runNrmsMetaDiagnostic } from "../lib/nrmsMetaDiagnostics.js";

const router = Router();
const db = prisma as any;

router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);

const reason = z.string().trim().min(8).max(300).transform(sanitizeText);
const replaySchema = z.object({ propertyId: z.number().int().positive().optional(), reason });
const connectionStateSchema = z.object({
  action: z.enum(["FLAG_REAUTH", "CLEAR_ERROR", "DISCONNECT"]),
  reason,
});

function counts(rows: Array<{ status: string; _count?: { _all?: number } }>): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [String(row.status), Number(row._count?._all ?? 0)]));
}

function publicConnection(connection: any) {
  const phoneRegistrationComplete = connection.provider === "WHATSAPP"
    ? Boolean(connection.metadata && typeof connection.metadata === "object" && connection.metadata.phoneRegisteredAt)
    : null;
  return {
    id: connection.id,
    propertyId: connection.propertyId,
    ownerId: connection.ownerId,
    provider: connection.provider,
    status: connection.provider === "WHATSAPP" && connection.status === "CONNECTED" && !phoneRegistrationComplete ? "PENDING" : connection.status,
    displayName: connection.displayName,
    externalAccountId: connection.externalAccountId,
    phoneRegistrationComplete,
    tokenExpiresAt: connection.tokenExpiresAt,
    webhookSubscribedAt: connection.webhookSubscribedAt,
    lastWebhookAt: connection.lastWebhookAt,
    lastOutboundAt: connection.lastOutboundAt,
    lastError: connection.lastError,
    updatedAt: connection.updatedAt,
    property: connection.property,
  };
}

router.get("/overview", (async (_req, res) => {
  const [connections, connectionStatusRows, webhookRows, outboundRows, inquiryRows, worker, recentDeadJobs, recentFailedMessages] = await Promise.all([
    db.nrmsMessagingConnection.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: {
        property: {
          select: {
            id: true,
            title: true,
            regionName: true,
            owner: { select: { id: true, fullName: true, name: true, email: true } },
          },
        },
      },
    }),
    db.nrmsMessagingConnection.groupBy({ by: ["status"], _count: { _all: true } }),
    db.nrmsMetaWebhookJob.groupBy({ by: ["status"], _count: { _all: true } }),
    db.nrmsGuestMessage.groupBy({ by: ["deliveryStatus"], where: { direction: "OUTBOUND", channel: { in: ["INSTAGRAM", "WHATSAPP"] } }, _count: { _all: true } }),
    db.nrmsGuestInquiry.groupBy({ by: ["channel"], where: { channel: { in: ["INSTAGRAM", "WHATSAPP"] } }, _count: { _all: true } }),
    db.nrmsWorkerHealth.findUnique({ where: { worker: "meta-messaging" } }),
    db.nrmsMetaWebhookJob.findMany({ where: { status: "DEAD" }, orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, propertyId: true, provider: true, eventKind: true, attemptCount: true, lastError: true, createdAt: true, updatedAt: true } }),
    db.nrmsGuestMessage.findMany({ where: { direction: "OUTBOUND", channel: { in: ["INSTAGRAM", "WHATSAPP"] }, deliveryStatus: "FAILED" }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, inquiryId: true, channel: true, attemptCount: true, errorMessage: true, createdAt: true, inquiry: { select: { propertyId: true, reference: true, property: { select: { title: true } } } } } }),
  ]);

  const workerLastSuccess = worker?.lastSuccessAt ? new Date(worker.lastSuccessAt).getTime() : 0;
  const workerHealthy = Boolean(
    worker
    && ["HEALTHY", "RUNNING"].includes(String(worker.status))
    && workerLastSuccess > Date.now() - 120_000,
  );

  res.json({
    generatedAt: new Date(),
    readiness: {
      appConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
      instagramOAuthConfigured: Boolean(process.env.META_INSTAGRAM_REDIRECT_URI),
      whatsappEmbeddedSignupConfigured: Boolean(process.env.META_WHATSAPP_CONFIG_ID),
      webhookConfigured: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      graphVersion: process.env.META_GRAPH_API_VERSION || "v23.0",
    },
    worker: worker ? { worker: worker.worker, status: worker.status, healthy: workerHealthy, lastSuccessAt: worker.lastSuccessAt, lastFailureAt: worker.lastFailureAt, lastError: worker.lastError } : null,
    summary: {
      connections: counts(connectionStatusRows),
      webhookJobs: counts(webhookRows),
      outboundMessages: Object.fromEntries(outboundRows.map((row: any) => [String(row.deliveryStatus), Number(row._count?._all ?? 0)])),
      inquiries: Object.fromEntries(inquiryRows.map((row: any) => [String(row.channel), Number(row._count?._all ?? 0)])),
    },
    connections: connections.map(publicConnection),
    failures: { webhookJobs: recentDeadJobs, outboundMessages: recentFailedMessages },
  });
}) as RequestHandler);

router.post("/failures/replay", (async (req: AuthedRequest, res) => {
  const parsed = replaySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "A valid replay reason is required" });

  const property = parsed.data.propertyId
    ? await db.property.findUnique({ where: { id: parsed.data.propertyId }, select: { id: true, ownerId: true, title: true } })
    : null;
  if (parsed.data.propertyId && !property) return res.status(404).json({ error: "Property not found" });

  const replayed = await replayMetaMessagingFailures(parsed.data.propertyId);
  await db.adminAudit.create({ data: {
    adminId: req.user!.id,
    targetUserId: property?.ownerId ?? null,
    action: property ? "NRMS_META_FAILURES_REPLAY_PROPERTY" : "NRMS_META_FAILURES_REPLAY_ALL",
    details: { propertyId: property?.id ?? null, propertyTitle: property?.title ?? null, ...replayed, reason: parsed.data.reason, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) },
  } });
  res.json({ replayed, scope: property ? { propertyId: property.id, propertyTitle: property.title } : { allProperties: true } });
}) as RequestHandler);

router.post("/connections/:connectionId/state", (async (req: AuthedRequest, res) => {
  const connectionId = Number(req.params.connectionId);
  const parsed = connectionStateSchema.safeParse(req.body ?? {});
  if (!Number.isInteger(connectionId) || connectionId <= 0 || !parsed.success) return res.status(400).json({ error: parsed.success ? "A valid connection is required" : parsed.error.issues[0]?.message || "Invalid control request" });

  const connection = await db.nrmsMessagingConnection.findUnique({ where: { id: connectionId }, include: { property: { select: { id: true, title: true, ownerId: true } } } });
  if (!connection) return res.status(404).json({ error: "Messaging connection not found" });

  const data = parsed.data.action === "DISCONNECT"
    ? { status: "DISCONNECTED", externalBusinessId: null, externalAccountId: null, phoneNumberId: null, accessTokenEncrypted: null, tokenExpiresAt: null, webhookSubscribedAt: null, lastError: null, version: { increment: 1 } }
    : parsed.data.action === "FLAG_REAUTH"
      ? { status: "REAUTH_REQUIRED", lastError: parsed.data.reason, version: { increment: 1 } }
      : { lastError: null, version: { increment: 1 } };

  const updated = await db.$transaction(async (tx: any) => {
    const saved = await tx.nrmsMessagingConnection.update({ where: { id: connection.id }, data });
    await tx.adminAudit.create({ data: {
      adminId: req.user!.id,
      targetUserId: connection.property.ownerId,
      action: `NRMS_META_CONNECTION_${parsed.data.action}`,
      details: { connectionId: connection.id, propertyId: connection.property.id, propertyTitle: connection.property.title, provider: connection.provider, beforeStatus: connection.status, afterStatus: saved.status, reason: parsed.data.reason, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) },
    } });
    return saved;
  });
  res.json({ connection: publicConnection({ ...updated, property: connection.property }) });
}) as RequestHandler);

router.post("/connections/:connectionId/diagnose", (async (req: AuthedRequest, res) => {
  const connectionId = Number(req.params.connectionId);
  if (!Number.isInteger(connectionId) || connectionId <= 0) return res.status(400).json({ error: "A valid messaging connection is required" });
  const connection = await db.nrmsMessagingConnection.findUnique({ where: { id: connectionId }, include: { property: { select: { id: true, title: true, ownerId: true } } } });
  if (!connection || !["WHATSAPP", "INSTAGRAM"].includes(String(connection.provider))) return res.status(404).json({ error: "Messaging connection not found" });

  const startedAt = Date.now();
  const diagnostic = await runNrmsMetaDiagnostic(connection.propertyId, connection.provider);
  const summary = diagnostic.checks.reduce((result: Record<string, number>, item: any) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  await db.adminAudit.create({ data: {
    adminId: req.user!.id,
    targetUserId: connection.property.ownerId,
    action: "NRMS_META_CONNECTION_DIAGNOSTIC",
    details: { connectionId: connection.id, propertyId: connection.propertyId, propertyTitle: connection.property.title, provider: connection.provider, verdict: diagnostic.verdict, summary, durationMs: Date.now() - startedAt, ip: req.ip, userAgent: req.get("user-agent")?.slice(0, 255) },
  } });
  res.json({ diagnostic });
}) as RequestHandler);

export default router;

import { Router, type RequestHandler } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { sanitizeText } from "../lib/sanitize.js";
import { classifyAdminChannelHealth } from "../lib/channels/adminChannelHealth.js";
import { encrypt } from "../lib/crypto.js";
import { notifyAdmins } from "../lib/notifications.js";
import { BookingComApiError, bookingComClient } from "../lib/channels/bookingComClient.js";
import { parseBookingResponseHasErrors } from "../lib/channels/bookingComReservations.js";
import { queueBookingComStopSell, runBookingComOutboundDelivery } from "../lib/channels/bookingComDelivery.js";
import { summarizeChannelSnapshots } from "../lib/channels/channelOperations.js";
import { ExpediaApiError, expediaClient } from "../lib/channels/expediaClient.js";
import { queueExpediaStopSell, runExpediaOutboundDelivery } from "../lib/channels/expediaDelivery.js";

const router = Router();
const db = prisma;
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);

const reasonSchema = z.object({ reason: z.string().trim().min(8).max(300).transform(sanitizeText) });
const stateSchema = reasonSchema.extend({ action: z.enum(["PAUSE", "RESUME"]) });
const alertRouteSchema = reasonSchema.extend({ adminsEnabled: z.boolean(), ownerEnabled: z.boolean(), minimumSeverity: z.enum(["ATTENTION", "CRITICAL"]), cooldownMinutes: z.number().int().min(5).max(1440) });
const rotationSchema = reasonSchema.extend({
  clientId: z.string().trim().min(1).max(200).optional(),
  clientSecret: z.string().min(1).max(500).optional(),
  username: z.string().trim().min(1).max(200).optional(),
  password: z.string().min(16).max(500).optional(),
}).refine((value) => Boolean(value.clientId && value.clientSecret) || Boolean(value.username && value.password), { message: "A provider credential pair is required" });
const stopSellSchema = reasonSchema.extend({ action: z.enum(["APPLY", "RELEASE"]), from: z.string().date(), to: z.string().date() });
const stopSellDecisionSchema = reasonSchema.extend({ action: z.enum(["APPROVE", "REJECT"]) });

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function countMap(rows: Array<{ connectionId: number; status: string; _count: { _all: number } }>): Map<number, Record<string, number>> {
  const result = new Map<number, Record<string, number>>();
  for (const row of rows) {
    const current = result.get(Number(row.connectionId)) ?? {};
    current[String(row.status)] = Number(row._count?._all ?? 0);
    result.set(Number(row.connectionId), current);
  }
  return result;
}

async function connectionForControl(id: number) {
  return db.channelConnection.findUnique({
    where: { id },
    include: {
      provider: { select: { code: true, name: true } },
      property: { select: { id: true, title: true, ownerId: true } },
      credentialVersions: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 },
    },
  });
}

type AuditedConnection = { id: number; propertyId: number; provider?: { code: string } | null };

function auditDetails(req: AuthedRequest, connection: AuditedConnection, reason: string, extra: Record<string, unknown> = {}) {
  return {
    connectionId: connection.id,
    propertyId: connection.propertyId,
    provider: connection.provider?.code ?? null,
    reason,
    ip: req.ip,
    userAgent: req.get("user-agent")?.slice(0, 255),
    ...extra,
  };
}

/** Portfolio-wide provider-neutral channel health and queue picture. */
router.get("/overview", (async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const cursor = positiveId(req.query.cursor);
  const provider = String(req.query.provider || "").trim().toUpperCase();
  const status = String(req.query.status || "").trim().toUpperCase();
  const query = String(req.query.q || "").trim().slice(0, 120);
  const where: Prisma.ChannelConnectionWhereInput = {
    ...(cursor ? { id: { gt: cursor } } : {}),
    ...(provider ? { provider: { code: provider } } : {}),
    ...(status ? { status } : {}),
    ...(query ? {
      OR: [
        { externalPropertyId: { contains: query } },
        { property: { title: { contains: query } } },
        { property: { owner: { email: { contains: query } } } },
        { property: { owner: { fullName: { contains: query } } } },
      ],
    } : {}),
  };
  const connections = await db.channelConnection.findMany({
    where,
    orderBy: { id: "asc" },
    take: limit + 1,
    include: {
      provider: { select: { id: true, code: true, name: true } },
      property: { select: { id: true, title: true, status: true, regionName: true, owner: { select: { id: true, fullName: true, name: true, email: true } } } },
      propertyMapping: { select: { externalId: true, status: true } },
      roomMappings: { where: { status: "MAPPED" }, select: { id: true } },
      rateMappings: { where: { status: "MAPPED" }, select: { id: true } },
      credentialVersions: { where: { status: "ACTIVE" }, orderBy: { version: "desc" }, select: { id: true, version: true, activatedAt: true }, take: 1 },
      alertRoute: { select: { adminsEnabled: true, ownerEnabled: true, minimumSeverity: true, cooldownMinutes: true, updatedAt: true } },
      operationalAlerts: { where: { status: "OPEN" }, orderBy: { lastSeenAt: "desc" }, select: { id: true, kind: true, severity: true, occurrenceCount: true, firstSeenAt: true, lastSeenAt: true, lastNotifiedAt: true, details: true }, take: 5 },
      stopSellRequests: { orderBy: { requestedAt: "desc" }, select: { id: true, action: true, status: true, fromDate: true, toDate: true, reason: true, requestedById: true, approvedById: true, decisionReason: true, deliveryId: true, requestedAt: true, decidedAt: true, providerConfirmedAt: true, failedAt: true, failureMessage: true }, take: 5 },
    },
  });
  const hasMore = connections.length > limit;
  const page = hasMore ? connections.slice(0, limit) : connections;
  const ids = page.map((connection) => Number(connection.id));
  const staleBefore = new Date(Date.now() - 10 * 60_000);
  const [inboundGroups, outboundGroups, issueGroups, criticalGroups, stuckGroups, recentRuns, failedDeliveryRows, issueRows, connectionStatusGroups, providerRows, deadLetters, openIssues, workers] = await Promise.all([
    ids.length ? db.channelInboundEvent.groupBy({ by: ["connectionId", "status"], where: { connectionId: { in: ids } }, _count: { _all: true } }) : [],
    ids.length ? db.channelOutboundDelivery.groupBy({ by: ["connectionId", "status"], where: { connectionId: { in: ids } }, _count: { _all: true } }) : [],
    ids.length ? db.channelReconciliationIssue.groupBy({ by: ["connectionId", "status"], where: { connectionId: { in: ids }, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, _count: { _all: true } }) : [],
    ids.length ? db.channelReconciliationIssue.groupBy({ by: ["connectionId"], where: { connectionId: { in: ids }, status: { in: ["OPEN", "ACKNOWLEDGED"] }, severity: "CRITICAL" }, _count: { _all: true } }) : [],
    ids.length ? db.channelOutboundDelivery.groupBy({ by: ["connectionId"], where: { connectionId: { in: ids }, status: "SENDING", lastAttemptAt: { lte: staleBefore } }, _count: { _all: true } }) : [],
    ids.length ? db.channelSyncRun.findMany({ where: { connectionId: { in: ids } }, orderBy: { startedAt: "desc" }, take: Math.max(100, ids.length * 5), select: { id: true, connectionId: true, kind: true, status: true, startedAt: true, completedAt: true, itemCount: true, successCount: true, failureCount: true, errorMessage: true } }) : [],
    ids.length ? db.channelOutboundDelivery.findMany({ where: { connectionId: { in: ids }, status: { in: ["FAILED", "DEAD_LETTER"] } }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, connectionId: true, eventType: true, status: true, attemptCount: true, lastError: true, updatedAt: true } }) : [],
    ids.length ? db.channelReconciliationIssue.findMany({ where: { connectionId: { in: ids }, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { lastSeenAt: "desc" }, take: 100, select: { id: true, connectionId: true, kind: true, severity: true, status: true, externalRef: true, internalRef: true, lastSeenAt: true } }) : [],
    db.channelConnection.groupBy({ by: ["status"], _count: { _all: true } }),
    db.channelProvider.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true, status: true, _count: { select: { connections: true } } } }),
    db.channelOutboundDelivery.count({ where: { status: "DEAD_LETTER" } }),
    db.channelReconciliationIssue.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    db.nrmsWorkerHealth.findMany({ where: { OR: [{ worker: { contains: "booking" } }, { worker: { contains: "channel" } }, { worker: { contains: "expedia" } }] }, orderBy: { worker: "asc" } }),
  ]);
  const inbound = countMap(inboundGroups);
  const outbound = countMap(outboundGroups);
  const issues = countMap(issueGroups);
  const critical = new Map<number, number>(criticalGroups.map((row) => [Number(row.connectionId), Number(row._count._all)] as const));
  const stuck = new Map<number, number>(stuckGroups.map((row) => [Number(row.connectionId), Number(row._count._all)] as const));
  const runByConnection = new Map<number, any>();
  for (const run of recentRuns) if (!runByConnection.has(Number(run.connectionId))) runByConnection.set(Number(run.connectionId), run);
  const failuresByConnection = new Map<number, any[]>();
  for (const delivery of failedDeliveryRows) failuresByConnection.set(Number(delivery.connectionId), [...(failuresByConnection.get(Number(delivery.connectionId)) ?? []), delivery]);
  const issuesByConnection = new Map<number, any[]>();
  for (const issue of issueRows) issuesByConnection.set(Number(issue.connectionId), [...(issuesByConnection.get(Number(issue.connectionId)) ?? []), issue]);
  const confirmedStopSellRows = ids.length ? await db.channelStopSellRequest.findMany({ where: { connectionId: { in: ids }, status: "CONFIRMED" }, distinct: ["connectionId"], orderBy: [{ connectionId: "asc" }, { providerConfirmedAt: "desc" }], select: { connectionId: true, action: true, fromDate: true, toDate: true, providerConfirmedAt: true } }) : [];
  const confirmedStopSellByConnection = new Map<number, any>();
  for (const request of confirmedStopSellRows) if (!confirmedStopSellByConnection.has(Number(request.connectionId))) confirmedStopSellByConnection.set(Number(request.connectionId), request);

  const rows = page.map((connection) => {
    const inboundCounts = inbound.get(connection.id) ?? {};
    const outboundCounts = outbound.get(connection.id) ?? {};
    const issueCounts = issues.get(connection.id) ?? {};
    const openIssueCount = Number(issueCounts.OPEN ?? 0) + Number(issueCounts.ACKNOWLEDGED ?? 0);
    const health = classifyAdminChannelHealth({
      status: connection.status,
      connectionType: connection.connectionType,
      hasActiveCredential: connection.credentialVersions.length > 0,
      lastSuccessAt: connection.lastSuccessAt,
      pendingDeliveries: Number(outboundCounts.PENDING ?? 0),
      sendingDeliveries: Number(outboundCounts.SENDING ?? 0),
      failedDeliveries: Number(outboundCounts.FAILED ?? 0),
      deadLetterDeliveries: Number(outboundCounts.DEAD_LETTER ?? 0),
      failedInboundEvents: Number(inboundCounts.FAILED ?? 0),
      openIssues: openIssueCount,
      criticalIssues: critical.get(connection.id) ?? 0,
      stuckDeliveries: stuck.get(connection.id) ?? 0,
    });
    return {
      id: connection.id,
      provider: connection.provider,
      property: connection.property,
      connectionType: connection.connectionType,
      status: connection.status,
      trustTier: connection.trustTier,
      externalPropertyId: connection.externalPropertyId,
      lastInboundAt: connection.lastInboundAt,
      lastOutboundAt: connection.lastOutboundAt,
      lastSuccessAt: connection.lastSuccessAt,
      lastFailureAt: connection.lastFailureAt,
      lastErrorCode: connection.lastErrorCode,
      lastErrorMessage: connection.lastErrorMessage,
      mapping: { property: connection.propertyMapping?.status ?? "UNMAPPED", rooms: connection.roomMappings.length, rates: connection.rateMappings.length },
      credential: connection.credentialVersions[0] ? { active: true, version: connection.credentialVersions[0].version, activatedAt: connection.credentialVersions[0].activatedAt } : { active: false, version: null, activatedAt: null },
      alertRoute: connection.alertRoute ?? { adminsEnabled: true, ownerEnabled: true, minimumSeverity: "ATTENTION", cooldownMinutes: 30, updatedAt: null },
      activeAlerts: connection.operationalAlerts,
      stopSellRequests: connection.stopSellRequests,
      stopSellState: confirmedStopSellByConnection.get(connection.id) ?? null,
      queues: { inbound: inboundCounts, outbound: outboundCounts, openIssues: openIssueCount, criticalIssues: critical.get(connection.id) ?? 0, stuckDeliveries: stuck.get(connection.id) ?? 0 },
      health,
      lastRun: runByConnection.get(connection.id) ?? null,
      recentFailures: (failuresByConnection.get(connection.id) ?? []).slice(0, 5),
      recentIssues: (issuesByConnection.get(connection.id) ?? []).slice(0, 5),
    };
  });

  res.json({
    summary: {
      totalConnections: connectionStatusGroups.reduce((sum, row) => sum + Number(row._count._all), 0),
      byStatus: Object.fromEntries(connectionStatusGroups.map((row) => [row.status, Number(row._count._all)])),
      deadLetters,
      openIssues,
    },
    providers: providerRows,
    workers,
    connections: rows,
    pagination: { limit, nextCursor: hasMore ? rows.at(-1)?.id ?? null : null },
  });
}) as RequestHandler);

/** Historical SLO, lag and queue evidence. Samples are retained for 90 days. */
router.get("/history", (async (req, res) => {
  const days = [1, 7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const connectionId = req.query.connectionId == null || req.query.connectionId === "" ? null : positiveId(req.query.connectionId);
  if (req.query.connectionId != null && req.query.connectionId !== "" && !connectionId) return res.status(400).json({ error: "A valid connection is required" });
  const from = new Date(Date.now() - days * 24 * 60 * 60_000);
  const limit = 50_000;
  const rows = await db.channelOperationalSnapshot.findMany({
    where: { capturedAt: { gte: from }, ...(connectionId ? { connectionId } : {}) },
    orderBy: { capturedAt: "desc" },
    take: limit + 1,
    select: { connectionId: true, capturedAt: true, healthState: true, lagMinutes: true, pendingDeliveries: true, sendingDeliveries: true, failedDeliveries: true, deadLetters: true, openIssues: true, criticalIssues: true, deliverySuccessBps: true },
  });
  const truncated = rows.length > limit;
  const samples = (truncated ? rows.slice(0, limit) : rows).reverse();
  const bucketMinutes = days <= 1 ? 60 : days <= 7 ? 360 : 1440;
  const lag = samples.map((row) => row.lagMinutes).filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
  const delivery = samples.map((row) => row.deliverySuccessBps).filter((value): value is number => typeof value === "number");
  const measured = samples.filter((row) => !["PAUSED", "DISCONNECTED"].includes(row.healthState));
  const healthy = measured.filter((row) => ["HEALTHY", "SYNCING"].includes(row.healthState)).length;
  const byConnection = new Map<number, any[]>();
  for (const sample of samples) byConnection.set(Number(sample.connectionId), [...(byConnection.get(Number(sample.connectionId)) ?? []), sample]);
  const connections = await db.channelConnection.findMany({ where: { id: { in: Array.from(byConnection.keys()) } }, select: { id: true, property: { select: { title: true } }, provider: { select: { code: true, name: true } } } });
  res.json({
    window: { days, from, to: new Date(), bucketMinutes, truncated },
    slo: {
      samples: samples.length,
      availabilityBps: measured.length ? Math.round((healthy / measured.length) * 10_000) : null,
      p95LagMinutes: lag.length ? lag[Math.min(lag.length - 1, Math.ceil(lag.length * 0.95) - 1)] : null,
      deliverySuccessBps: delivery.length ? Math.round(delivery.reduce((sum: number, value: number) => sum + value, 0) / delivery.length) : null,
      attentionSamples: samples.filter((row) => row.healthState === "ATTENTION").length,
      criticalSamples: samples.filter((row) => row.healthState === "CRITICAL").length,
    },
    buckets: summarizeChannelSnapshots(samples, bucketMinutes),
    connections: connections.map((connection) => {
      const connectionSamples = byConnection.get(connection.id) ?? [];
      const measuredSamples = connectionSamples.filter((row) => !["PAUSED", "DISCONNECTED"].includes(row.healthState));
      const available = measuredSamples.filter((row) => ["HEALTHY", "SYNCING"].includes(row.healthState)).length;
      const connectionLag = connectionSamples.map((row) => row.lagMinutes).filter((value): value is number => typeof value === "number").sort((a, b) => a - b);
      return { id: connection.id, propertyTitle: connection.property.title, provider: connection.provider, samples: connectionSamples.length, availabilityBps: measuredSamples.length ? Math.round((available / measuredSamples.length) * 10_000) : null, p95LagMinutes: connectionLag.length ? connectionLag[Math.min(connectionLag.length - 1, Math.ceil(connectionLag.length * 0.95) - 1)] : null };
    }),
  });
}) as RequestHandler);

router.put("/connections/:connectionId/alert-route", (async (req: AuthedRequest, res) => {
  const connectionId = positiveId(req.params.connectionId);
  const parsed = alertRouteSchema.safeParse(req.body);
  if (!connectionId || !parsed.success) return res.status(400).json({ error: "Valid alert destinations, threshold, cooldown and reason are required" });
  if (!parsed.data.adminsEnabled && !parsed.data.ownerEnabled) return res.status(400).json({ error: "At least one alert destination must remain enabled" });
  const connection = await connectionForControl(connectionId);
  if (!connection) return res.status(404).json({ error: "Channel connection not found" });
  const route = await db.$transaction(async (tx) => {
    const saved = await tx.channelAlertRoute.upsert({
      where: { connectionId },
      create: { connectionId, adminsEnabled: parsed.data.adminsEnabled, ownerEnabled: parsed.data.ownerEnabled, minimumSeverity: parsed.data.minimumSeverity, cooldownMinutes: parsed.data.cooldownMinutes, updatedById: req.user!.id },
      update: { adminsEnabled: parsed.data.adminsEnabled, ownerEnabled: parsed.data.ownerEnabled, minimumSeverity: parsed.data.minimumSeverity, cooldownMinutes: parsed.data.cooldownMinutes, updatedById: req.user!.id },
    });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: connection.property.ownerId, action: "NRMS_CHANNEL_ALERT_ROUTE_UPDATE", details: auditDetails(req, connection, parsed.data.reason, { adminsEnabled: parsed.data.adminsEnabled, ownerEnabled: parsed.data.ownerEnabled, minimumSeverity: parsed.data.minimumSeverity, cooldownMinutes: parsed.data.cooldownMinutes }) } });
    return saved;
  });
  res.json({ alertRoute: route });
}) as RequestHandler);

/** Verify replacement credentials before atomically activating them. Existing
 * credentials remain active throughout provider verification. */
router.post("/connections/:connectionId/rotate-credentials", (async (req: AuthedRequest, res) => {
  const connectionId = positiveId(req.params.connectionId);
  const parsed = rotationSchema.safeParse(req.body);
  if (!connectionId || !parsed.success) return res.status(400).json({ error: "Replacement credentials and an operational reason are required" });
  const connection = await connectionForControl(connectionId);
  if (!connection) return res.status(404).json({ error: "Channel connection not found" });
  if (!["BOOKING_COM", "EXPEDIA"].includes(connection.provider.code)) return res.status(409).json({ error: "Automated credential rotation is not available for this provider yet" });
  const externalPropertyId = String(connection.externalPropertyId || "");
  if (!externalPropertyId) return res.status(409).json({ error: "The provider property ID is unavailable" });
  let encryptedCredentials: Record<string, string>;
  try {
    if (connection.provider.code === "BOOKING_COM") {
      if (!parsed.data.clientId || !parsed.data.clientSecret) return res.status(400).json({ error: "Booking.com client ID and secret are required" });
      const hotelId = Number(externalPropertyId);
      if (!Number.isInteger(hotelId) || hotelId <= 0) return res.status(409).json({ error: "The provider hotel ID is unavailable" });
      const token = await bookingComClient.exchangeToken({ clientId: parsed.data.clientId, clientSecret: parsed.data.clientSecret });
      const propertyCheck = await bookingComClient.getReservationsSummary(token.jwt, hotelId);
      if (parseBookingResponseHasErrors(propertyCheck.body)) throw new BookingComApiError("Replacement credentials do not have access to this hotel", { status: 422 });
      encryptedCredentials = { clientId: parsed.data.clientId, clientSecret: parsed.data.clientSecret };
    } else {
      if (!parsed.data.username || !parsed.data.password) return res.status(400).json({ error: "Expedia API username and password are required" });
      const token = await expediaClient.exchangeToken({ username: parsed.data.username, password: parsed.data.password });
      await expediaClient.verifyProperty(token.accessToken, externalPropertyId);
      encryptedCredentials = { username: parsed.data.username, password: parsed.data.password };
    }
  } catch (error) {
    const providerCode = error instanceof BookingComApiError || error instanceof ExpediaApiError ? error.providerCode ?? null : null;
    const providerStatus = error instanceof BookingComApiError || error instanceof ExpediaApiError ? error.status : 502;
    return res.status(providerStatus >= 400 && providerStatus < 500 ? 422 : 502).json({ error: "Replacement credentials failed provider verification", code: "CHANNEL_CREDENTIAL_ROTATION_FAILED", providerCode });
  }
  const activatedAt = new Date();
  const result = await db.$transaction(async (tx) => {
    const latest = await tx.channelCredentialVersion.findFirst({ where: { connectionId }, orderBy: { version: "desc" }, select: { version: true } });
    const version = Number(latest?.version ?? 0) + 1;
    const created = await tx.channelCredentialVersion.create({ data: { connectionId, version, status: "ACTIVE", encryptedData: encrypt(JSON.stringify(encryptedCredentials)), validationStatus: "VALIDATED", validatedAt: activatedAt, activatedAt, createdById: req.user!.id } });
    const revoked = await tx.channelCredentialVersion.updateMany({ where: { connectionId, status: "ACTIVE", id: { not: created.id } }, data: { status: "REVOKED", revokedAt: activatedAt } });
    await tx.channelConnection.update({ where: { id: connectionId }, data: { status: "ACTIVE", lastSuccessAt: activatedAt, lastFailureAt: null, lastErrorCode: null, lastErrorMessage: null } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: connection.property.ownerId, action: "NRMS_CHANNEL_CREDENTIAL_ROTATE", details: auditDetails(req, connection, parsed.data.reason, { version, replacedVersions: revoked.count, verifiedPropertyId: externalPropertyId }) } });
    return { version, replacedVersions: revoked.count };
  });
  res.json({ credential: { active: true, version: result.version, activatedAt }, replacedVersions: result.replacedVersions });
}) as RequestHandler);

router.post("/connections/:connectionId/stop-sell/requests", (async (req: AuthedRequest, res) => {
  const connectionId = positiveId(req.params.connectionId);
  const parsed = stopSellSchema.safeParse(req.body);
  if (!connectionId || !parsed.success) return res.status(400).json({ error: "A valid action, date range and operational reason are required" });
  const connection = await connectionForControl(connectionId);
  if (!connection) return res.status(404).json({ error: "Channel connection not found" });
  if (!["BOOKING_COM", "EXPEDIA"].includes(connection.provider.code)) return res.status(409).json({ error: "Stop-sell delivery is not available for this provider yet" });
  if (!["ACTIVE", "PILOT"].includes(connection.status) || !connection.credentialVersions.length) return res.status(409).json({ error: "The channel must be active with verified credentials" });
  const fromDate = new Date(`${parsed.data.from}T00:00:00.000Z`);
  const toDate = new Date(`${parsed.data.to}T00:00:00.000Z`);
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  if (fromDate < today || toDate < fromDate || toDate.getTime() - fromDate.getTime() > 365 * 24 * 60 * 60_000) return res.status(400).json({ error: "Stop-sell dates must begin today or later and cover no more than 366 days" });
  const pending = await db.channelStopSellRequest.findFirst({ where: { connectionId, status: { in: ["PENDING_APPROVAL", "QUEUED"] } } });
  if (pending) return res.status(409).json({ error: "This channel already has a pending or queued stop-sell decision" });
  const latestConfirmed = await db.channelStopSellRequest.findFirst({ where: { connectionId, status: "CONFIRMED" }, orderBy: { providerConfirmedAt: "desc" }, select: { action: true } });
  if (parsed.data.action === "APPLY" && latestConfirmed?.action === "APPLY") return res.status(409).json({ error: "Stop-sell is already confirmed; request a release instead" });
  if (parsed.data.action === "RELEASE" && latestConfirmed?.action !== "APPLY") return res.status(409).json({ error: "There is no confirmed stop-sell to release" });
  const request = await db.$transaction(async (tx) => {
    const created = await tx.channelStopSellRequest.create({ data: { connectionId, action: parsed.data.action, fromDate, toDate, reason: parsed.data.reason, requestedById: req.user!.id } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: connection.property.ownerId, action: parsed.data.action === "APPLY" ? "NRMS_CHANNEL_STOP_SELL_REQUEST" : "NRMS_CHANNEL_STOP_SELL_RELEASE_REQUEST", details: auditDetails(req, connection, parsed.data.reason, { requestId: created.id, from: parsed.data.from, to: parsed.data.to }) } });
    return created;
  });
  await notifyAdmins("nrms_stop_sell_approval_requested", { requestId: request.id, action: request.action, propertyTitle: connection.property.title, provider: connection.provider.name, requestedBy: `Administrator #${req.user!.id}`, path: "/admin/nrms/channels" });
  res.status(201).json({ request });
}) as RequestHandler);

router.post("/stop-sell/requests/:requestId/decision", (async (req: AuthedRequest, res) => {
  const requestId = positiveId(req.params.requestId);
  const parsed = stopSellDecisionSchema.safeParse(req.body);
  if (!requestId || !parsed.success) return res.status(400).json({ error: "A valid decision and reason are required" });
  const request = await db.channelStopSellRequest.findUnique({ where: { id: requestId }, include: { connection: { include: { provider: true, property: { select: { id: true, title: true, ownerId: true } }, credentialVersions: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 } } } } });
  if (!request) return res.status(404).json({ error: "Stop-sell request not found" });
  if (request.status !== "PENDING_APPROVAL") return res.status(409).json({ error: "This request has already been decided" });
  if (parsed.data.action === "APPROVE" && request.requestedById === req.user!.id) return res.status(409).json({ error: "A different administrator must approve this request" });
  const connection = request.connection;
  if (parsed.data.action === "REJECT") {
    await db.$transaction(async (tx) => {
      await tx.channelStopSellRequest.update({ where: { id: request.id }, data: { status: "REJECTED", rejectedById: req.user!.id, decidedAt: new Date(), decisionReason: parsed.data.reason } });
      await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: connection.property.ownerId, action: "NRMS_CHANNEL_STOP_SELL_REJECT", details: auditDetails(req, connection, parsed.data.reason, { requestId: request.id, requestedById: request.requestedById, action: request.action }) } });
    });
    return res.json({ request: { id: request.id, status: "REJECTED" } });
  }
  if (!["BOOKING_COM", "EXPEDIA"].includes(connection.provider.code) || !["ACTIVE", "PILOT"].includes(connection.status) || !connection.credentialVersions.length) return res.status(409).json({ error: "The provider connection is not ready for stop-sell delivery" });
  if (request.action !== "APPLY" && request.action !== "RELEASE") return res.status(409).json({ error: "The stop-sell request action is invalid" });
  const stopSellAction: "APPLY" | "RELEASE" = request.action;
  const queued = await db.$transaction(async (tx) => {
    const claimed = await tx.channelStopSellRequest.updateMany({ where: { id: request.id, status: "PENDING_APPROVAL" }, data: { status: "QUEUED", approvedById: req.user!.id, decidedAt: new Date(), decisionReason: parsed.data.reason } });
    if (claimed.count !== 1) throw new Error("STOP_SELL_ALREADY_DECIDED");
    const delivery = connection.provider.code === "EXPEDIA"
      ? await queueExpediaStopSell(tx, { requestId: request.id, connectionId: connection.id, action: stopSellAction, fromDate: request.fromDate, toDate: request.toDate })
      : await queueBookingComStopSell(tx, { requestId: request.id, connectionId: connection.id, action: stopSellAction, fromDate: request.fromDate, toDate: request.toDate });
    await tx.channelStopSellRequest.update({ where: { id: request.id }, data: { deliveryId: delivery.id } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: connection.property.ownerId, action: "NRMS_CHANNEL_STOP_SELL_APPROVE", details: auditDetails(req, connection, parsed.data.reason, { requestId: request.id, requestedById: request.requestedById, action: request.action, deliveryId: delivery.id }) } });
    return delivery;
  });
  const deliveryRun = connection.provider.code === "EXPEDIA" ? await runExpediaOutboundDelivery(new Date(), connection.id) : await runBookingComOutboundDelivery(new Date(), connection.id);
  const fresh = await db.channelStopSellRequest.findUnique({ where: { id: request.id }, select: { id: true, action: true, status: true, deliveryId: true, providerConfirmedAt: true, failureMessage: true } });
  res.json({ request: fresh, delivery: { id: queued.id, run: deliveryRun } });
}) as RequestHandler);

/** Pause/resume delivery without exposing or replacing provider credentials. */
router.post("/connections/:connectionId/state", (async (req: AuthedRequest, res) => {
  const connectionId = positiveId(req.params.connectionId);
  const parsed = stateSchema.safeParse(req.body);
  if (!connectionId || !parsed.success) return res.status(400).json({ error: "A valid action and operational reason are required" });
  const connection = await connectionForControl(connectionId);
  if (!connection) return res.status(404).json({ error: "Channel connection not found" });
  if (parsed.data.action === "PAUSE" && connection.status === "DISCONNECTED") return res.status(409).json({ error: "A disconnected channel cannot be paused" });
  if (parsed.data.action === "RESUME") {
    if (connection.status === "DISCONNECTED") return res.status(409).json({ error: "Reconnect credentials through the property onboarding flow" });
    if (connection.connectionType === "API" && !connection.credentialVersions.length) return res.status(409).json({ error: "The channel has no active credentials and cannot be resumed" });
  }
  const nextStatus = parsed.data.action === "PAUSE" ? "PAUSED" : "ACTIVE";
  const updated = await db.$transaction(async (tx) => {
    const saved = await tx.channelConnection.update({
      where: { id: connection.id },
      data: parsed.data.action === "PAUSE"
        ? { status: nextStatus, lastErrorCode: "ADMIN_PAUSED", lastErrorMessage: parsed.data.reason }
        : { status: nextStatus, lastErrorCode: null, lastErrorMessage: null },
    });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: connection.property.ownerId, action: parsed.data.action === "PAUSE" ? "NRMS_CHANNEL_PAUSE" : "NRMS_CHANNEL_RESUME", details: auditDetails(req, connection, parsed.data.reason, { beforeStatus: connection.status, afterStatus: nextStatus }) } });
    return saved;
  });
  res.json({ connection: { id: updated.id, status: updated.status } });
}) as RequestHandler);

/** Requeue failed/dead-letter deliveries for one active connection. */
router.post("/connections/:connectionId/requeue", (async (req: AuthedRequest, res) => {
  const connectionId = positiveId(req.params.connectionId);
  const parsed = reasonSchema.safeParse(req.body);
  if (!connectionId || !parsed.success) return res.status(400).json({ error: "A valid connection and operational reason are required" });
  const connection = await connectionForControl(connectionId);
  if (!connection) return res.status(404).json({ error: "Channel connection not found" });
  if (!["ACTIVE", "PILOT"].includes(connection.status)) return res.status(409).json({ error: "Resume the connection before requeueing delivery" });
  const changed = await db.$transaction(async (tx) => {
    const result = await tx.channelOutboundDelivery.updateMany({ where: { connectionId, status: { in: ["FAILED", "DEAD_LETTER"] } }, data: { status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), acknowledgedAt: null, lastError: null } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: connection.property.ownerId, action: "NRMS_CHANNEL_REQUEUE", details: auditDetails(req, connection, parsed.data.reason, { deliveryCount: result.count }) } });
    return result.count;
  });
  res.json({ requeued: changed });
}) as RequestHandler);

/** Revoke every active credential and disconnect the provider connection. */
router.post("/connections/:connectionId/revoke-credentials", (async (req: AuthedRequest, res) => {
  const connectionId = positiveId(req.params.connectionId);
  const parsed = reasonSchema.safeParse(req.body);
  if (!connectionId || !parsed.success) return res.status(400).json({ error: "A valid connection and security reason are required" });
  const connection = await connectionForControl(connectionId);
  if (!connection) return res.status(404).json({ error: "Channel connection not found" });
  const result = await db.$transaction(async (tx) => {
    const revoked = await tx.channelCredentialVersion.updateMany({ where: { connectionId, status: { in: ["ACTIVE", "STAGED"] } }, data: { status: "REVOKED", revokedAt: new Date() } });
    const deliveries = await tx.channelOutboundDelivery.updateMany({ where: { connectionId, status: { in: ["PENDING", "SENDING"] } }, data: { status: "FAILED", nextAttemptAt: null, lastError: "Credentials revoked by NRMS administration" } });
    await tx.channelConnection.update({ where: { id: connectionId }, data: { status: "DISCONNECTED", trustTier: "UNTRUSTED", lastFailureAt: new Date(), lastErrorCode: "ADMIN_CREDENTIAL_REVOCATION", lastErrorMessage: parsed.data.reason } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: connection.property.ownerId, action: "NRMS_CHANNEL_CREDENTIALS_REVOKE", details: auditDetails(req, connection, parsed.data.reason, { credentialVersions: revoked.count, stoppedDeliveries: deliveries.count }) } });
    return { revoked: revoked.count, stoppedDeliveries: deliveries.count };
  });
  res.json(result);
}) as RequestHandler);

router.post("/deliveries/:deliveryId/retry", (async (req: AuthedRequest, res) => {
  const deliveryId = positiveId(req.params.deliveryId);
  const parsed = reasonSchema.safeParse(req.body);
  if (!deliveryId || !parsed.success) return res.status(400).json({ error: "A valid delivery and operational reason are required" });
  const delivery = await db.channelOutboundDelivery.findUnique({ where: { id: deliveryId }, include: { connection: { include: { provider: true, property: { select: { ownerId: true } } } } } });
  if (!delivery) return res.status(404).json({ error: "Delivery not found" });
  if (!["FAILED", "DEAD_LETTER"].includes(delivery.status)) return res.status(409).json({ error: "Only failed or dead-letter deliveries can be retried" });
  await db.$transaction(async (tx) => {
    await tx.channelOutboundDelivery.update({ where: { id: delivery.id }, data: { status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), acknowledgedAt: null, lastError: null } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: delivery.connection.property.ownerId, action: "NRMS_CHANNEL_DELIVERY_RETRY", details: auditDetails(req, delivery.connection, parsed.data.reason, { deliveryId: delivery.id, eventType: delivery.eventType }) } });
  });
  res.json({ retried: true });
}) as RequestHandler);

router.post("/issues/:issueId/resolve", (async (req: AuthedRequest, res) => {
  const issueId = positiveId(req.params.issueId);
  const parsed = reasonSchema.safeParse(req.body);
  if (!issueId || !parsed.success) return res.status(400).json({ error: "A valid issue and resolution reason are required" });
  const issue = await db.channelReconciliationIssue.findUnique({ where: { id: issueId }, include: { connection: { include: { provider: true, property: { select: { ownerId: true } } } } } });
  if (!issue) return res.status(404).json({ error: "Reconciliation issue not found" });
  await db.$transaction(async (tx) => {
    await tx.channelReconciliationIssue.update({ where: { id: issue.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: req.user!.id, details: { ...(issue.details && typeof issue.details === "object" ? issue.details : {}), adminResolutionReason: parsed.data.reason } } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, targetUserId: issue.connection.property.ownerId, action: "NRMS_CHANNEL_ISSUE_RESOLVE", details: auditDetails(req, issue.connection, parsed.data.reason, { issueId: issue.id, kind: issue.kind }) } });
  });
  res.json({ resolved: true });
}) as RequestHandler);

export default router;

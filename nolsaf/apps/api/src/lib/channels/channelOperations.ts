import { prisma } from "@nolsaf/prisma";
import { notifyAdmins, notifyOwner } from "../notifications.js";
import { runNrmsWorker } from "../nrmsWorkerHealth.js";
import { classifyAdminChannelHealth } from "./adminChannelHealth.js";

const db = prisma as any;
const DAY_MS = 24 * 60 * 60_000;

export type ChannelSnapshotRow = {
  connectionId: number;
  capturedAt: Date | string;
  healthState: string;
  lagMinutes: number | null;
  pendingDeliveries: number;
  sendingDeliveries: number;
  failedDeliveries: number;
  deadLetters: number;
  openIssues: number;
  criticalIssues: number;
  deliverySuccessBps: number | null;
};

function groupedCounts(rows: any[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [String(row.status), Number(row._count?._all ?? 0)]));
}

function severityAllowed(actual: "ATTENTION" | "CRITICAL", minimum: string): boolean {
  if (minimum === "CRITICAL") return actual === "CRITICAL";
  return true;
}

export function summarizeChannelSnapshots(rows: ChannelSnapshotRow[], bucketMinutes: number) {
  const widthMs = Math.max(5, bucketMinutes) * 60_000;
  const buckets = new Map<number, ChannelSnapshotRow[]>();
  for (const row of rows) {
    const timestamp = new Date(row.capturedAt).getTime();
    if (!Number.isFinite(timestamp)) continue;
    const start = Math.floor(timestamp / widthMs) * widthMs;
    buckets.set(start, [...(buckets.get(start) ?? []), row]);
  }
  return Array.from(buckets.entries()).sort(([a], [b]) => a - b).map(([start, samples]) => {
    const lag = samples.map((sample) => sample.lagMinutes).filter((value): value is number => value != null).sort((a, b) => a - b);
    const success = samples.map((sample) => sample.deliverySuccessBps).filter((value): value is number => value != null);
    const measured = samples.filter((sample) => !["PAUSED", "DISCONNECTED"].includes(sample.healthState));
    const healthy = measured.filter((sample) => ["HEALTHY", "SYNCING"].includes(sample.healthState)).length;
    return {
      startedAt: new Date(start).toISOString(),
      samples: samples.length,
      availabilityBps: measured.length ? Math.round((healthy / measured.length) * 10_000) : null,
      averageLagMinutes: lag.length ? Math.round(lag.reduce((sum, value) => sum + value, 0) / lag.length) : null,
      p95LagMinutes: lag.length ? lag[Math.min(lag.length - 1, Math.ceil(lag.length * 0.95) - 1)] : null,
      deliverySuccessBps: success.length ? Math.round(success.reduce((sum, value) => sum + value, 0) / success.length) : null,
      attentionSamples: samples.filter((sample) => sample.healthState === "ATTENTION").length,
      criticalSamples: samples.filter((sample) => sample.healthState === "CRITICAL").length,
      maxQueueDepth: Math.max(0, ...samples.map((sample) => sample.pendingDeliveries + sample.sendingDeliveries)),
    };
  });
}

async function notifyOperationalAlert(connection: any, alert: any, route: any) {
  const payload = {
    connectionId: connection.id,
    propertyId: connection.property.id,
    propertyTitle: connection.property.title,
    provider: connection.provider.name,
    severity: alert.severity,
    reasons: Array.isArray(alert.details?.reasons) ? alert.details.reasons : [],
    path: "/admin/nrms/channels",
  };
  await Promise.all([
    route.adminsEnabled ? notifyAdmins("nrms_channel_health_alert", payload) : Promise.resolve(),
    route.ownerEnabled ? notifyOwner(connection.property.ownerId, "nrms_channel_health_alert", payload) : Promise.resolve(),
  ]);
}

export async function captureChannelOperations(now = new Date()) {
  const connections = await db.channelConnection.findMany({
    include: {
      provider: { select: { code: true, name: true } },
      property: { select: { id: true, title: true, ownerId: true } },
      credentialVersions: { where: { status: "ACTIVE" }, select: { id: true }, take: 1 },
      alertRoute: true,
    },
  });
  let snapshots = 0;
  let notifications = 0;
  let resolved = 0;
  const deliveryWindow = new Date(now.getTime() - DAY_MS);
  const staleBefore = new Date(now.getTime() - 10 * 60_000);

  for (const connection of connections) {
    const [outboundRows, inboundRows, issueRows, criticalIssues, stuckDeliveries, deliverySloRows] = await Promise.all([
      db.channelOutboundDelivery.groupBy({ by: ["status"], where: { connectionId: connection.id }, _count: { _all: true } }),
      db.channelInboundEvent.groupBy({ by: ["status"], where: { connectionId: connection.id }, _count: { _all: true } }),
      db.channelReconciliationIssue.groupBy({ by: ["status"], where: { connectionId: connection.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, _count: { _all: true } }),
      db.channelReconciliationIssue.count({ where: { connectionId: connection.id, status: { in: ["OPEN", "ACKNOWLEDGED"] }, severity: "CRITICAL" } }),
      db.channelOutboundDelivery.count({ where: { connectionId: connection.id, status: "SENDING", lastAttemptAt: { lte: staleBefore } } }),
      db.channelOutboundDelivery.groupBy({ by: ["status"], where: { connectionId: connection.id, updatedAt: { gte: deliveryWindow }, status: { in: ["ACKNOWLEDGED", "FAILED", "DEAD_LETTER"] } }, _count: { _all: true } }),
    ]);
    const outbound = groupedCounts(outboundRows);
    const inbound = groupedCounts(inboundRows);
    const issues = groupedCounts(issueRows);
    const slo = groupedCounts(deliverySloRows);
    const terminal = Number(slo.ACKNOWLEDGED ?? 0) + Number(slo.FAILED ?? 0) + Number(slo.DEAD_LETTER ?? 0);
    const deliverySuccessBps = terminal ? Math.round((Number(slo.ACKNOWLEDGED ?? 0) / terminal) * 10_000) : null;
    const openIssues = Number(issues.OPEN ?? 0) + Number(issues.ACKNOWLEDGED ?? 0);
    const health = classifyAdminChannelHealth({
      status: connection.status,
      connectionType: connection.connectionType,
      hasActiveCredential: connection.credentialVersions.length > 0,
      lastSuccessAt: connection.lastSuccessAt,
      pendingDeliveries: Number(outbound.PENDING ?? 0),
      sendingDeliveries: Number(outbound.SENDING ?? 0),
      failedDeliveries: Number(outbound.FAILED ?? 0),
      deadLetterDeliveries: Number(outbound.DEAD_LETTER ?? 0),
      failedInboundEvents: Number(inbound.FAILED ?? 0),
      openIssues,
      criticalIssues,
      stuckDeliveries,
    }, now);
    await db.channelOperationalSnapshot.create({ data: {
      connectionId: connection.id,
      capturedAt: now,
      healthState: health.state,
      lagMinutes: health.lagMinutes,
      pendingDeliveries: Number(outbound.PENDING ?? 0),
      sendingDeliveries: Number(outbound.SENDING ?? 0),
      failedDeliveries: Number(outbound.FAILED ?? 0),
      deadLetters: Number(outbound.DEAD_LETTER ?? 0),
      openIssues,
      criticalIssues,
      deliverySuccessBps,
      lastSuccessAt: connection.lastSuccessAt,
    } });
    snapshots += 1;

    const activeKey = `channel:${connection.id}:health`;
    if (!["ATTENTION", "CRITICAL"].includes(health.state)) {
      const changed = await db.channelOperationalAlert.updateMany({ where: { activeKey, status: "OPEN" }, data: { activeKey: null, status: "RESOLVED", resolvedAt: now, lastSeenAt: now } });
      resolved += changed.count;
      continue;
    }
    const severity = health.state as "ATTENTION" | "CRITICAL";
    const route = connection.alertRoute ?? { adminsEnabled: true, ownerEnabled: true, minimumSeverity: "ATTENTION", cooldownMinutes: 30 };
    const existing = await db.channelOperationalAlert.findUnique({ where: { activeKey } });
    const alert = existing
      ? await db.channelOperationalAlert.update({ where: { id: existing.id }, data: { severity, lastSeenAt: now, occurrenceCount: { increment: 1 }, details: { reasons: health.reasons, lagMinutes: health.lagMinutes, outbound, openIssues, criticalIssues, stuckDeliveries } } })
      : await db.channelOperationalAlert.create({ data: { connectionId: connection.id, activeKey, kind: "CHANNEL_HEALTH", severity, details: { reasons: health.reasons, lagMinutes: health.lagMinutes, outbound, openIssues, criticalIssues, stuckDeliveries } } });
    const cooldownMs = Math.max(5, Math.min(1440, Number(route.cooldownMinutes) || 30)) * 60_000;
    const due = !alert.lastNotifiedAt || now.getTime() - new Date(alert.lastNotifiedAt).getTime() >= cooldownMs;
    if (due && severityAllowed(severity, route.minimumSeverity) && (route.adminsEnabled || route.ownerEnabled)) {
      await notifyOperationalAlert(connection, alert, route);
      await db.channelOperationalAlert.update({ where: { id: alert.id }, data: { lastNotifiedAt: now } });
      notifications += 1;
    }
  }

  await Promise.all([
    db.channelOperationalSnapshot.deleteMany({ where: { capturedAt: { lt: new Date(now.getTime() - 90 * DAY_MS) } } }),
    db.channelCredentialVersion.updateMany({ where: { status: "STAGED", stagedExpiresAt: { lte: now } }, data: { status: "REVOKED", revokedAt: now } }),
  ]);
  return { connections: connections.length, snapshots, notifications, resolved };
}

export function startChannelOperationsWorker() {
  const intervalMs = Math.max(60_000, Number(process.env.CHANNEL_OPERATIONS_INTERVAL_MS || 5 * 60_000));
  const run = () => runNrmsWorker("channel-operations", () => captureChannelOperations()).catch((error) => console.error("[channel-operations] worker failed", error));
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[channel-operations] Started, interval: ${intervalMs / 1000}s`);
}

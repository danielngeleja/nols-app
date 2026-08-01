import { prisma } from "@nolsaf/prisma";
import { retentionFields } from "../lib/auditRetention.js";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

const db = prisma as any;

type AuditRetentionRunOptions = {
  batchSize?: number;
  maxBatchesPerModel?: number;
};

async function deleteExpiredInBatches(
  delegate: any,
  where: Record<string, unknown>,
  batchSize: number,
  maxBatches: number
): Promise<{ count: number; batches: number; limitReached: boolean }> {
  let count = 0;
  let batches = 0;
  let limitReached = false;

  while (batches < maxBatches) {
    const rows = await delegate.findMany({
      where,
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (rows.length === 0) break;

    const result = await delegate.deleteMany({
      where: {
        AND: [where, { id: { in: rows.map((row: { id: number | bigint }) => row.id) } }],
      },
    });
    count += Number(result.count || 0);
    batches += 1;

    if (rows.length < batchSize) break;
    if (batches === maxBatches) limitReached = true;
  }

  return { count, batches, limitReached };
}

export async function runAuditRetention(
  now = new Date(),
  client: any = db,
  options: AuditRetentionRunOptions = {}
) {
  const batchSize = Math.min(2_000, Math.max(1, options.batchSize ?? Number(process.env.AUDIT_RETENTION_BATCH_SIZE || 500)));
  const maxBatches = Math.min(1_000, Math.max(1, options.maxBatchesPerModel ?? Number(process.env.AUDIT_RETENTION_MAX_BATCHES || 100)));
  const due = { expiresAt: { lte: now }, legalHoldAt: null };

  // Keep every select and delete as a short independent database operation.
  // Models are drained sequentially so one connection never receives concurrent work.
  const auditLogs = await deleteExpiredInBatches(client.auditLog, due, batchSize, maxBatches);
  const adminAudits = await deleteExpiredInBatches(client.adminAudit, due, batchSize, maxBatches);
  const workItems = await deleteExpiredInBatches(
    client.adminWorkItem,
    { status: "RESOLVED", ...due },
    batchSize,
    maxBatches
  );

  const deleted = {
    auditLogs: auditLogs.count,
    adminAudits: adminAudits.count,
    workItems: workItems.count,
  };
  const batches = {
    auditLogs: auditLogs.batches,
    adminAudits: adminAudits.batches,
    workItems: workItems.batches,
  };
  const limitReached = auditLogs.limitReached || adminAudits.limitReached || workItems.limitReached;

  if (deleted.auditLogs + deleted.adminAudits + deleted.workItems > 0) {
    await client.auditLog.create({
      data: {
        actorId: null,
        actorRole: "SYSTEM",
        action: "AUDIT_RETENTION_PURGE_COMPLETED",
        entity: "AUDIT_RETENTION",
        entityId: null,
        beforeJson: null,
        afterJson: { deleted, batches, limitReached, completedAt: now.toISOString() },
        ip: null,
        ua: null,
        createdAt: now,
        ...retentionFields("OPERATIONAL", now),
      },
    });
  }

  return { ...deleted, batches, limitReached };
}

export function startAuditRetentionWorker(): void {
  const intervalMs = Math.max(
    60 * 60_000,
    Number(process.env.AUDIT_RETENTION_INTERVAL_MS || 24 * 60 * 60_000)
  );
  const run = () => runNrmsWorker("audit-retention", () => runAuditRetention()).catch((error) =>
    console.error("[audit-retention] Worker failed", error)
  );
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[audit-retention] Started, interval: ${intervalMs / 1000}s`);
}

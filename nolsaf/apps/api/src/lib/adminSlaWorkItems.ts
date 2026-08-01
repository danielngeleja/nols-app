import { prisma } from "@nolsaf/prisma";
import { slaTargetFor, type ActionCenterItem, type ActionWorkflow } from "./adminActionCenter.js";
import { retentionClassForActionCenter } from "./auditRetention.js";

const teamByCategory: Record<string, string> = {
  PAYMENTS: "Finance Operations",
  TRANSPORT: "Transport Operations",
  CANCELLATIONS: "Customer Resolution",
  APPROVALS: "Partner Operations",
  LIFECYCLE: "Platform Operations",
  NRMS: "NRMS Operations",
};

// Action Center can be requested twice during initial client rendering and can
// also refresh while a previous request is still finishing. Keep this process's
// synchronization writes in one lane; database-level retries below still cover
// another API instance or a concurrent admin workflow mutation.
let synchronizationWriteTail: Promise<void> = Promise.resolve();

async function withSynchronizationWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = synchronizationWriteTail;
  let release!: () => void;
  synchronizationWriteTail = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

function isWriteConflict(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "P2034");
}

export async function retryAdminWorkItemWrite<T>(
  operation: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 25);
  let attempt = 0;
  while (attempt < maxAttempts) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (!isWriteConflict(error) || attempt >= maxAttempts) throw error;
      const delayMs = baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * Math.max(1, baseDelayMs));
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error("Admin work item write retry exhausted");
}

function validDate(value: string | null | undefined, fallback: Date): Date {
  const parsed = value ? new Date(value) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function plusMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

function workflowFromRow(row: any, now: Date): ActionWorkflow {
  const status = String(row.status || "OPEN").toUpperCase() as ActionWorkflow["status"];
  const responseSatisfied = Boolean(row.acknowledgedAt || row.resolvedAt);
  const resolutionSatisfied = Boolean(row.resolvedAt);
  return {
    id: row.id,
    status,
    assignedTeam: row.assignedTeam ?? null,
    assignedTo: row.assignedTo
      ? { id: row.assignedTo.id, name: row.assignedTo.name ?? row.assignedTo.fullName ?? null, email: row.assignedTo.email ?? null }
      : null,
    openedAt: row.openedAt.toISOString(),
    responseDueAt: row.responseDueAt.toISOString(),
    resolutionDueAt: row.resolutionDueAt.toISOString(),
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    resolutionNote: row.resolutionNote ?? null,
    responseBreached: !responseSatisfied && row.responseDueAt.getTime() < now.getTime(),
    resolutionBreached: !resolutionSatisfied && row.resolutionDueAt.getTime() < now.getTime(),
    responseTargetMinutes: row.responseTargetMinutes,
    resolutionTargetMinutes: row.resolutionTargetMinutes,
    policyVersion: row.slaPolicyVersion,
  };
}

function severityFrom(value: unknown): ActionCenterItem["severity"] {
  const severity = String(value || "").toUpperCase();
  return severity === "CRITICAL" || severity === "HIGH" || severity === "LOW" ? severity : "MEDIUM";
}

function historicalItemFromRow(row: any, now: Date): ActionCenterItem {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const exposure = metadata.exposure && typeof metadata.exposure === "object"
    ? {
        amount: Number(metadata.exposure.amount || 0),
        currency: String(metadata.exposure.currency || "TZS"),
      }
    : null;
  return {
    id: `SLA-${row.id}`,
    category: row.category,
    severity: severityFrom(row.severity),
    title: row.title,
    summary: row.summary,
    subject: row.subject,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    createdAt: row.openedAt.toISOString(),
    dueAt: row.operationalDueAt?.toISOString() ?? null,
    detailHref: row.detailHref,
    actionLabel: row.actionLabel,
    exposure: exposure && exposure.amount > 0 ? exposure : null,
    metadata: metadata.source && typeof metadata.source === "object" ? metadata.source : undefined,
    workflow: workflowFromRow(row, now),
  };
}

export async function synchronizeAdminWorkItems(items: ActionCenterItem[], now = new Date()): Promise<ActionCenterItem[]> {
  const keys = items.map((item) => ({ sourceType: item.sourceType, sourceId: item.sourceId }));
  if (keys.length > 0) {
    try {
      await withSynchronizationWriteLock(() => retryAdminWorkItemWrite(async () => {
        // Re-read inside every retry. A competing request may have committed the
        // missing rows before this attempt starts, making the next attempt a safe
        // update-only pass.
        const existing = await prisma.adminWorkItem.findMany({
          where: { OR: keys },
          select: { sourceType: true, sourceId: true },
        });
        const existingKeys = new Set(existing.map((item) => `${item.sourceType}:${item.sourceId}`));
        const missing = items.filter((item) => !existingKeys.has(`${item.sourceType}:${item.sourceId}`));

        if (missing.length > 0) {
          await prisma.adminWorkItem.createMany({
            data: missing.map((item) => {
              const openedAt = validDate(item.createdAt, now);
              const policy = slaTargetFor(item.severity);
              return {
                sourceType: item.sourceType,
                sourceId: item.sourceId,
                category: item.category,
                title: item.title.slice(0, 240),
                summary: item.summary,
                subject: item.subject.slice(0, 240),
                detailHref: item.detailHref.slice(0, 500),
                actionLabel: item.actionLabel.slice(0, 80),
                severity: item.severity,
                status: "OPEN",
                slaPolicyVersion: "2026-08",
                responseTargetMinutes: policy.responseMinutes,
                resolutionTargetMinutes: policy.resolutionMinutes,
                retentionClass: retentionClassForActionCenter(item.category),
                openedAt,
                responseDueAt: plusMinutes(openedAt, policy.responseMinutes),
                resolutionDueAt: plusMinutes(openedAt, policy.resolutionMinutes),
                operationalDueAt: item.dueAt ? validDate(item.dueAt, now) : null,
                assignedTeam: teamByCategory[item.category] || "Admin Operations",
                lastObservedAt: now,
                metadata: { source: item.metadata ?? null, exposure: item.exposure },
              };
            }),
            skipDuplicates: true,
          });
        }

        // Presence is only diagnostic; throttling it avoids turning every
        // 30-second UI refresh into a write across the whole queue.
        await prisma.adminWorkItem.updateMany({
          where: {
            AND: [
              { OR: keys },
              { lastObservedAt: { lt: new Date(now.getTime() - 5 * 60 * 1000) } },
            ],
          },
          data: { lastObservedAt: now },
        });
      }));
    } catch (error) {
      if (!isWriteConflict(error)) throw error;
      // The queue remains useful in a degraded read-only state. Missing rows
      // will be retried on the next refresh instead of failing the whole page.
      console.warn("[action-center] SLA synchronization deferred after repeated write conflicts");
    }
  }

  const includeAssignee = { assignedTo: { select: { id: true, name: true, fullName: true, email: true } } } as const;
  const [rows, resolvedHistory] = await Promise.all([
    keys.length > 0
      ? prisma.adminWorkItem.findMany({ where: { OR: keys }, include: includeAssignee })
      : Promise.resolve([]),
    prisma.adminWorkItem.findMany({
      where: {
        status: "RESOLVED",
        ...(keys.length > 0 ? { NOT: { OR: keys } } : {}),
      },
      orderBy: { resolvedAt: "desc" },
      take: 50,
      include: includeAssignee,
    }),
  ]);
  const rowByKey = new Map(rows.map((row) => [`${row.sourceType}:${row.sourceId}`, row]));

  const activeItems = items.map((item) => {
    const row = rowByKey.get(`${item.sourceType}:${item.sourceId}`);
    return row ? { ...item, workflow: workflowFromRow(row, now) } : item;
  });
  return [...activeItems, ...resolvedHistory.map((row) => historicalItemFromRow(row, now))];
}

export function serializeAdminWorkItem(row: any, now = new Date()): ActionWorkflow {
  return workflowFromRow(row, now);
}

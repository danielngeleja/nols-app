export type ActionSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type ActionWorkflow = {
  id: number;
  status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED";
  assignedTeam: string | null;
  assignedTo: { id: number; name: string | null; email: string | null } | null;
  openedAt: string;
  responseDueAt: string;
  resolutionDueAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
  responseTargetMinutes: number;
  resolutionTargetMinutes: number;
  policyVersion: string;
};

export type ActionCenterItem = {
  id: string;
  category: string;
  severity: ActionSeverity;
  title: string;
  summary: string;
  subject: string;
  sourceType: string;
  sourceId: string;
  createdAt: string;
  dueAt: string | null;
  detailHref: string;
  actionLabel: string;
  exposure: { amount: number; currency: string } | null;
  metadata?: Record<string, unknown>;
  workflow?: ActionWorkflow;
};

const severityWeight: Record<ActionSeverity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const slaPolicyBySeverity: Record<ActionSeverity, { responseMinutes: number; resolutionMinutes: number }> = {
  CRITICAL: { responseMinutes: 15, resolutionMinutes: 60 },
  HIGH: { responseMinutes: 60, resolutionMinutes: 240 },
  MEDIUM: { responseMinutes: 240, resolutionMinutes: 1440 },
  LOW: { responseMinutes: 1440, resolutionMinutes: 4320 },
};

export function slaTargetFor(severity: ActionSeverity) {
  return slaPolicyBySeverity[severity];
}

export function deadlineFrom(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 60 * 60 * 1000);
}

export function isActionOverdue(item: Pick<ActionCenterItem, "dueAt">, now = new Date()): boolean {
  return Boolean(item.dueAt && new Date(item.dueAt).getTime() < now.getTime());
}

export function sortActionItems(items: ActionCenterItem[], now = new Date()): ActionCenterItem[] {
  return [...items].sort((left, right) => {
    const resolvedDifference = Number(left.workflow?.status === "RESOLVED") - Number(right.workflow?.status === "RESOLVED");
    if (resolvedDifference !== 0) return resolvedDifference;

    const severityDifference = severityWeight[right.severity] - severityWeight[left.severity];
    if (severityDifference !== 0) return severityDifference;

    const resolutionBreachDifference = Number(right.workflow?.resolutionBreached) - Number(left.workflow?.resolutionBreached);
    if (resolutionBreachDifference !== 0) return resolutionBreachDifference;

    const responseBreachDifference = Number(right.workflow?.responseBreached) - Number(left.workflow?.responseBreached);
    if (responseBreachDifference !== 0) return responseBreachDifference;

    const overdueDifference = Number(isActionOverdue(right, now)) - Number(isActionOverdue(left, now));
    if (overdueDifference !== 0) return overdueDifference;

    const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (leftDue !== rightDue) return leftDue - rightDue;

    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

export function paginateActionItems<T>(items: T[], requestedPage: number, requestedPerPage: number) {
  const perPage = Math.min(50, Math.max(10, Number.isFinite(requestedPerPage) ? Math.floor(requestedPerPage) : 15));
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1));
  const start = (page - 1) * perPage;
  return {
    items: items.slice(start, start + perPage),
    pagination: { page, perPage, total, totalPages },
  };
}

export function summarizeActionItems(items: ActionCenterItem[], now = new Date()) {
  const exposureByCurrency = items.reduce<Record<string, number>>((totals, item) => {
    if (!item.exposure || item.exposure.amount <= 0) return totals;
    const currency = item.exposure.currency || "TZS";
    totals[currency] = (totals[currency] || 0) + item.exposure.amount;
    return totals;
  }, {});

  const byCategory = items.reduce<Record<string, number>>((totals, item) => {
    totals[item.category] = (totals[item.category] || 0) + 1;
    return totals;
  }, {});

  return {
    total: items.filter((item) => item.workflow?.status !== "RESOLVED").length,
    critical: items.filter((item) => item.workflow?.status !== "RESOLVED" && item.severity === "CRITICAL").length,
    high: items.filter((item) => item.workflow?.status !== "RESOLVED" && item.severity === "HIGH").length,
    overdue: items.filter((item) => item.workflow?.status !== "RESOLVED" && (item.workflow?.resolutionBreached ?? isActionOverdue(item, now))).length,
    responseBreached: items.filter((item) => item.workflow?.status !== "RESOLVED" && item.workflow?.responseBreached).length,
    resolutionBreached: items.filter((item) => item.workflow?.status !== "RESOLVED" && item.workflow?.resolutionBreached).length,
    unassigned: items.filter((item) => item.workflow?.status !== "RESOLVED" && !item.workflow?.assignedTo).length,
    acknowledged: items.filter((item) => item.workflow?.status === "ACKNOWLEDGED").length,
    resolved: items.filter((item) => item.workflow?.status === "RESOLVED").length,
    exposureByCurrency,
    byCategory,
  };
}

export function normalizeSeverity(value: unknown, fallback: ActionSeverity = "MEDIUM"): ActionSeverity {
  const severity = String(value || "").trim().toUpperCase();
  if (severity === "CRITICAL" || severity === "ERROR") return "CRITICAL";
  if (severity === "HIGH") return "HIGH";
  if (severity === "MEDIUM" || severity === "WARNING" || severity === "WARN") return "MEDIUM";
  if (severity === "LOW" || severity === "INFO") return "LOW";
  return fallback;
}

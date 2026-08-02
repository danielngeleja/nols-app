import { prisma } from "@nolsaf/prisma";
import { buildErrorDiagnostic, type ErrorDiagnostic } from "./errorDiagnostics.js";

export type ObservedRequest = {
  requestId: string;
  method: string;
  path: string;
  route: string;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  actorId?: number | null;
  actorRole?: string | null;
  exceptionCaptured?: boolean;
  timestamp: string;
};

export type ObservabilitySummary = {
  generatedAt: string;
  uptimeSeconds: number;
  windowSize: number;
  totalRequestsObserved: number;
  requestsInWindow: number;
  errorRate: number;
  averageDurationMs: number;
  p95DurationMs: number;
  p99DurationMs: number;
  slowRequestThresholdMs: number;
  slowRequestsInWindow: number;
  statusCounts: Record<string, number>;
  methodCounts: Record<string, number>;
  topRoutes: Array<{
    route: string;
    count: number;
    errors: number;
    averageDurationMs: number;
    p95DurationMs: number;
  }>;
  slowRoutes: Array<{
    route: string;
    count: number;
    slowCount: number;
    errors: number;
    averageDurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
  }>;
};

export type ImpactedUserSummary = {
  key: string;
  userId: number | null;
  role: string | null;
  profile: {
    kind: "admin" | "agent" | "customer" | "driver" | "owner";
    href: string;
    label: string;
  } | null;
  name: string | null;
  email: string | null;
  label: string;
  eventCount: number;
  slowCount: number;
  serverErrorCount: number;
  clientErrorCount: number;
  routes: string[];
  lastSeenAt: string | null;
  // Timestamp of the most recent event that actually contributes to this
  // item's current severity tier: the last server/client error (if any),
  // and the last slow-but-otherwise-fine request. Tracked separately from
  // lastSeenAt because lastSeenAt is "most recent event of any kind" and can
  // be a benign slow-200 that arrived after the real error, which must not
  // make an already-resolved-looking error read as "active right now".
  lastErrorAt: string | null;
  lastSlowAt: string | null;
  lastEvent: {
    action: string;
    route: string | null;
    path: string | null;
    statusCode: number | null;
    durationMs: number | null;
    message: string | null;
    requestId: string | null;
    source: string | null;
    stack: string | null;
    componentStack: string | null;
    release: string | null;
    diagnostic: ErrorDiagnostic | null;
  } | null;
  resolution: {
    status: "open" | "restored";
    note: string | null;
    restoredAt: string | null;
    restoredBy: {
      id: number | null;
      name: string | null;
      email: string | null;
      role: string | null;
    } | null;
  };
  // Triage signal for open incidents: "active" = still erroring within the
  // attention window (fix now), "unconfirmed" = aged out with no recovery proof
  // (review), "none" = restored/healed.
  attention: "active" | "unconfirmed" | "none";
};

const maxRequests = 1000;
const recentRequests: ObservedRequest[] = [];
const pendingImportantRequests: ObservedRequest[] = [];
let totalRequestsObserved = 0;
let lastRepeatedErrorAlertAt = 0;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushInFlight = false;

export const slowRequestThresholdMs = 1000;
const repeatedErrorWindowMs = 5 * 60 * 1000;
const repeatedErrorThreshold = 5;
const repeatedErrorAlertCooldownMs = 15 * 60 * 1000;
const maxPendingImportantRequests = 500;
const importantRequestFlushDelayMs = 2000;
const importantRequestFlushBatchSize = 100;
const apiRouteHealthThrottleMs = 5 * 60 * 1000;
// An open incident whose most recent error is within this window is treated as
// actively firing ("needs attention now"); older ones age into "unconfirmed".
const activeAttentionWindowMs = 15 * 60 * 1000;
// Routes that recently returned a 5xx or slow response. We only persist a
// durable health signal when one of these recovers, which keeps the audit
// volume to roughly one row per recovery episode.
const degradedRoutes = new Map<string, number>();
const lastApiRouteHealthAt = new Map<string, number>();

export function normalizeRoute(path: string): string {
  return path
    .replace(/\/\d+(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, "/:hash")
    .replace(/\/[0-9a-f-]{32,}(?=\/|$)/gi, "/:uuid");
}

export function recordObservedRequest(entry: ObservedRequest) {
  totalRequestsObserved += 1;
  recentRequests.push(entry);
  if (recentRequests.length > maxRequests) recentRequests.shift();
  const isServerError = entry.statusCode >= 500;
  const isSlow = entry.durationMs >= slowRequestThresholdMs;
  if ((!entry.exceptionCaptured && isServerError) || isSlow) {
    queueImportantRequest(entry);
  }
  if (isServerError || isSlow) {
    if (entry.route) degradedRoutes.set(entry.route, Date.now());
  } else {
    maybeRecordRouteHealth(entry);
  }
  if (isServerError) {
    void maybeAlertRepeatedServerErrors(entry);
  }
}

// Persists a durable "this API route is healthy again" signal the moment a
// previously-degraded route returns a fast, non-5xx response. Unlike the
// in-memory recentRequests window, this survives restarts and is shared across
// instances via the database, so the Impact Center can auto-close server/slow
// incidents instead of leaving them stuck red.
function maybeRecordRouteHealth(entry: ObservedRequest) {
  const route = entry.route;
  if (!route || !route.startsWith("/api/")) return;
  if (!degradedRoutes.has(route)) return;
  const now = Date.now();
  const last = lastApiRouteHealthAt.get(route) ?? 0;
  if (now - last < apiRouteHealthThrottleMs) return;
  lastApiRouteHealthAt.set(route, now);
  degradedRoutes.delete(route);
  void persistRouteHealth(entry);
}

async function persistRouteHealth(entry: ObservedRequest) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        action: "API_ROUTE_HEALTH",
        entity: "OBSERVABILITY",
        entityId: null,
        ip: entry.ip,
        ua: entry.userAgent,
        beforeJson: null,
        afterJson: {
          route: entry.route,
          path: entry.path,
          statusCode: entry.statusCode,
          durationMs: Math.round(entry.durationMs * 100) / 100,
          timestamp: entry.timestamp,
        },
      },
    });
  } catch (err: any) {
    console.warn("[observability] failed to persist route health", err?.message || err);
  }
}

export function maskIpAddress(ip: string | null | undefined) {
  if (!ip) return null;
  const normalized = ip.replace(/^::ffff:/, "").trim();
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0`;
  const parts = normalized.split(":").filter(Boolean);
  if (parts.length >= 3) return `${parts.slice(0, 3).join(":")}::`;
  return "masked";
}

export function getRecentRequests(limit = 100) {
  return recentRequests.slice(-clampLimit(limit)).reverse();
}

export function getRecentSlowRequests(limit = 50) {
  return recentRequests
    .filter((request) => request.durationMs >= slowRequestThresholdMs)
    .slice(-clampLimit(limit))
    .reverse();
}

export function getRecentErrorRequests(limit = 50) {
  return recentRequests
    .filter((request) => request.statusCode >= 500)
    .slice(-clampLimit(limit))
    .reverse();
}

export function clearObservedRequests() {
  recentRequests.length = 0;
  totalRequestsObserved = 0;
}

export function getObservabilitySummary(): ObservabilitySummary {
  const requests = recentRequests.slice();
  const durations = requests.map((request) => request.durationMs).sort((a, b) => a - b);
  const errors = requests.filter((request) => request.statusCode >= 500).length;
  const statusCounts = countBy(requests, (request) => String(request.statusCode));
  const methodCounts = countBy(requests, (request) => request.method);
  const routeBuckets = new Map<string, ObservedRequest[]>();

  for (const request of requests) {
    const bucket = routeBuckets.get(request.route) ?? [];
    bucket.push(request);
    routeBuckets.set(request.route, bucket);
  }

  const topRoutes = Array.from(routeBuckets.entries())
    .map(([route, bucket]) => {
      const routeDurations = bucket.map((request) => request.durationMs).sort((a, b) => a - b);
      const slowCount = bucket.filter((request) => request.durationMs >= slowRequestThresholdMs).length;
      return {
        route,
        count: bucket.length,
        slowCount,
        errors: bucket.filter((request) => request.statusCode >= 500).length,
        averageDurationMs: roundMs(average(routeDurations)),
        p95DurationMs: roundMs(percentile(routeDurations, 95)),
        maxDurationMs: roundMs(routeDurations.at(-1) ?? 0),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const slowRoutes = Array.from(routeBuckets.entries())
    .map(([route, bucket]) => {
      const routeDurations = bucket.map((request) => request.durationMs).sort((a, b) => a - b);
      const slowCount = bucket.filter((request) => request.durationMs >= slowRequestThresholdMs).length;
      return {
        route,
        count: bucket.length,
        slowCount,
        errors: bucket.filter((request) => request.statusCode >= 500).length,
        averageDurationMs: roundMs(average(routeDurations)),
        p95DurationMs: roundMs(percentile(routeDurations, 95)),
        maxDurationMs: roundMs(routeDurations.at(-1) ?? 0),
      };
    })
    .filter((route) => route.slowCount > 0)
    .sort((a, b) => b.slowCount - a.slowCount || b.p95DurationMs - a.p95DurationMs)
    .slice(0, 10);

  return {
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    windowSize: maxRequests,
    totalRequestsObserved,
    requestsInWindow: requests.length,
    errorRate: requests.length ? roundRatio(errors / requests.length) : 0,
    averageDurationMs: roundMs(average(durations)),
    p95DurationMs: roundMs(percentile(durations, 95)),
    p99DurationMs: roundMs(percentile(durations, 99)),
    slowRequestThresholdMs,
    slowRequestsInWindow: requests.filter((request) => request.durationMs >= slowRequestThresholdMs).length,
    statusCounts,
    methodCounts,
    topRoutes,
    slowRoutes,
  };
}

export function getPrometheusMetrics() {
  const summary = getObservabilitySummary();
  const lines = [
    "# HELP nolsaf_requests_observed_total Total requests observed since process start.",
    "# TYPE nolsaf_requests_observed_total counter",
    `nolsaf_requests_observed_total ${summary.totalRequestsObserved}`,
    "# HELP nolsaf_requests_window Current number of requests retained in memory.",
    "# TYPE nolsaf_requests_window gauge",
    `nolsaf_requests_window ${summary.requestsInWindow}`,
    "# HELP nolsaf_request_duration_average_ms Average request duration in the retained window.",
    "# TYPE nolsaf_request_duration_average_ms gauge",
    `nolsaf_request_duration_average_ms ${summary.averageDurationMs}`,
    "# HELP nolsaf_request_duration_p95_ms P95 request duration in the retained window.",
    "# TYPE nolsaf_request_duration_p95_ms gauge",
    `nolsaf_request_duration_p95_ms ${summary.p95DurationMs}`,
    "# HELP nolsaf_request_duration_p99_ms P99 request duration in the retained window.",
    "# TYPE nolsaf_request_duration_p99_ms gauge",
    `nolsaf_request_duration_p99_ms ${summary.p99DurationMs}`,
    "# HELP nolsaf_request_error_rate Error rate in the retained window.",
    "# TYPE nolsaf_request_error_rate gauge",
    `nolsaf_request_error_rate ${summary.errorRate}`,
    "# HELP nolsaf_slow_requests_window Slow requests in the retained window.",
    "# TYPE nolsaf_slow_requests_window gauge",
    `nolsaf_slow_requests_window ${summary.slowRequestsInWindow}`,
  ];

  for (const [status, count] of Object.entries(summary.statusCounts)) {
    lines.push(`nolsaf_requests_by_status{status="${escapeLabel(status)}"} ${count}`);
  }

  for (const route of summary.topRoutes) {
    lines.push(`nolsaf_requests_by_route{route="${escapeLabel(route.route)}"} ${route.count}`);
    lines.push(`nolsaf_request_route_p95_ms{route="${escapeLabel(route.route)}"} ${route.p95DurationMs}`);
  }

  return `${lines.join("\n")}\n`;
}

function queueImportantRequest(entry: ObservedRequest) {
  pendingImportantRequests.push(entry);
  if (pendingImportantRequests.length > maxPendingImportantRequests) {
    pendingImportantRequests.splice(0, pendingImportantRequests.length - maxPendingImportantRequests);
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushImportantRequests();
    }, importantRequestFlushDelayMs);
  }
}

async function flushImportantRequests() {
  if (flushInFlight || pendingImportantRequests.length === 0) return;
  flushInFlight = true;
  const batch = pendingImportantRequests.splice(0, importantRequestFlushBatchSize);

  try {
    await prisma.auditLog.createMany({
      data: batch.map((entry) => ({
        actorId: entry.actorId ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.statusCode >= 500 ? "OBSERVABILITY_5XX_REQUEST" : "OBSERVABILITY_SLOW_REQUEST",
        entity: "OBSERVABILITY",
        entityId: null,
        ip: entry.ip,
        ua: entry.userAgent,
        beforeJson: null,
        afterJson: {
          requestId: entry.requestId,
          method: entry.method,
          path: entry.path,
          route: entry.route,
          statusCode: entry.statusCode,
          durationMs: Math.round(entry.durationMs * 100) / 100,
          timestamp: entry.timestamp,
          actorId: entry.actorId ?? null,
          actorRole: entry.actorRole ?? null,
        },
      })),
    });
  } catch (err: any) {
    console.warn("[observability] failed to persist request events", err?.message || err);
  } finally {
    flushInFlight = false;
    if (pendingImportantRequests.length > 0 && !flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushImportantRequests();
      }, importantRequestFlushDelayMs);
    }
  }
}

export async function getImpactedUsers(limit = 20): Promise<ImpactedUserSummary[]> {
  const actions = ["OBSERVABILITY_5XX_REQUEST", "OBSERVABILITY_SLOW_REQUEST", "CLIENT_ERROR", "SERVER_EXCEPTION"];
  const rows = await prisma.auditLog.findMany({
    where: { action: { in: actions } },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      actor: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  const healthRows = await prisma.auditLog.findMany({
    where: { action: "CLIENT_ROUTE_HEALTH", entity: "CLIENT" },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const resolutionRows = await prisma.auditLog.findMany({
    where: { action: "IMPACT_MARK_RESTORED", entity: "IMPACT_CENTER" },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: {
      actor: { select: { id: true, name: true, email: true, role: true } },
    },
  });

  const apiHealthRows = await prisma.auditLog.findMany({
    where: { action: "API_ROUTE_HEALTH", entity: "OBSERVABILITY" },
    orderBy: { createdAt: "desc" },
    take: 300,
  });

  const resolutions = new Map<string, ImpactedUserSummary["resolution"]>();
  for (const row of resolutionRows) {
    const after = normalizeJsonObject(row.afterJson);
    const impactKey = textOrNull(after.impactKey);
    if (!impactKey || resolutions.has(impactKey)) continue;
    resolutions.set(impactKey, {
      status: "restored",
      note: textOrNull(after.note),
      restoredAt: row.createdAt ? row.createdAt.toISOString() : null,
      restoredBy: {
        id: row.actor?.id ?? row.actorId ?? null,
        name: row.actor?.name ?? null,
        email: row.actor?.email ?? null,
        role: row.actor?.role ?? row.actorRole ?? null,
      },
    });
  }

  const groups = new Map<string, ImpactedUserSummary>();

  for (const row of rows) {
    const after = normalizeJsonObject(row.afterJson);
    const actorId = typeof row.actorId === "number" ? row.actorId : null;
    const role = row.actorRole ?? row.actor?.role ?? null;
    const key = impactKeyFor(actorId, row.ip, row.ua);
    const route = textOrNull(after.route) ?? textOrNull(after.path);
    const createdAt = row.createdAt ? row.createdAt.toISOString() : null;

    const existing: ImpactedUserSummary =
      groups.get(key) ??
      ({
        key,
        userId: actorId,
        role,
        profile: null,
        name: row.actor?.name ?? null,
        email: row.actor?.email ?? null,
        label: actorId
          ? `${row.actor?.name || row.actor?.email || `User #${actorId}`}`
          : "Visitor session",
        eventCount: 0,
        slowCount: 0,
        serverErrorCount: 0,
        clientErrorCount: 0,
        routes: [],
        lastSeenAt: createdAt,
        lastErrorAt: null,
        lastSlowAt: null,
        lastEvent: null,
        resolution: resolutions.get(key) ?? openImpactResolution(),
        attention: "none",
      } satisfies ImpactedUserSummary);

    existing.eventCount += 1;
    // Rows are fetched newest-first, so the first row of a given action type
    // seen for this key is that type's most recent occurrence.
    if (row.action === "OBSERVABILITY_SLOW_REQUEST") {
      existing.slowCount += 1;
      if (!existing.lastSlowAt && createdAt) existing.lastSlowAt = createdAt;
    }
    if (row.action === "OBSERVABILITY_5XX_REQUEST" || row.action === "SERVER_EXCEPTION") {
      existing.serverErrorCount += 1;
      if (!existing.lastErrorAt && createdAt) existing.lastErrorAt = createdAt;
    }
    if (row.action === "CLIENT_ERROR") {
      existing.clientErrorCount += 1;
      if (!existing.lastErrorAt && createdAt) existing.lastErrorAt = createdAt;
    }
    if (route && !existing.routes.includes(route)) existing.routes.push(route);
    if (!existing.lastSeenAt && createdAt) existing.lastSeenAt = createdAt;
    if (!existing.lastEvent) {
      const storedDiagnostic = diagnosticOrNull(after.diagnostic);
      const hasDiagnosticInput = Boolean(textOrNull(after.stack) || textOrNull(after.source));
      const diagnostic = storedDiagnostic ?? (hasDiagnosticInput
        ? await buildErrorDiagnostic({
            service: row.action === "CLIENT_ERROR" ? "web" : "api",
            message: after.message,
            stack: after.stack,
            source: after.source,
            line: after.line,
            column: after.column,
            release: after.release,
          })
        : null);
      existing.lastEvent = {
        action: row.action,
        route: textOrNull(after.route),
        path: textOrNull(after.path),
        statusCode: numberOrNull(after.statusCode),
        durationMs: numberOrNull(after.durationMs),
        message: textOrNull(after.message),
        requestId: textOrNull(after.requestId),
        source: textOrNull(after.source),
        stack: textOrNull(after.stack),
        componentStack: textOrNull(after.componentStack),
        release: textOrNull(after.release),
        diagnostic,
      };
    }

    groups.set(key, existing);
  }

  applyAutomaticImpactRecovery(groups, resolutions, healthRows, apiHealthRows);

  const impacted = Array.from(groups.values())
    .sort((a, b) => b.eventCount - a.eventCount || Date.parse(b.lastSeenAt ?? "0") - Date.parse(a.lastSeenAt ?? "0"))
    .slice(0, clampLimit(limit))
    .map((item) => ({ ...item, routes: item.routes.slice(0, 8), attention: computeAttention(item) }));

  const agentUserIds = impacted
    .filter((item) => item.userId != null && String(item.role || "").toUpperCase() === "AGENT")
    .map((item) => item.userId as number);
  const agentIdByUserId = new Map<number, number>();

  if (agentUserIds.length > 0) {
    const agents = await prisma.agent.findMany({
      where: { userId: { in: agentUserIds } },
      select: { id: true, userId: true },
    });
    for (const agent of agents) agentIdByUserId.set(agent.userId, agent.id);
  }

  return impacted.map((item) => ({
    ...item,
    profile: buildImpactProfile(item.userId, item.role, agentIdByUserId),
  }));
}

function buildImpactProfile(
  userId: number | null,
  role: string | null,
  agentIdByUserId: Map<number, number>
): ImpactedUserSummary["profile"] {
  if (userId == null) return null;

  switch (String(role || "").toUpperCase()) {
    case "OWNER":
      return { kind: "owner", href: `/admin/owners/${userId}`, label: "View owner" };
    case "DRIVER":
      return { kind: "driver", href: `/admin/drivers/audit/${userId}`, label: "View driver" };
    case "AGENT": {
      const agentId = agentIdByUserId.get(userId);
      return agentId
        ? { kind: "agent", href: `/admin/agents/${agentId}`, label: "View agent" }
        : { kind: "agent", href: `/admin/management/users?userId=${userId}`, label: "Review agent account" };
    }
    case "ADMIN":
      return { kind: "admin", href: `/admin/management/users?userId=${userId}`, label: "View admin" };
    case "CUSTOMER":
    default:
      return { kind: "customer", href: `/admin/users/${userId}`, label: "View customer" };
  }
}

// The timestamp that should drive "is this still happening right now": the
// last error if this item currently reads as Critical, otherwise the last
// slow request if it currently reads as Warning. Falls back to lastSeenAt
// only for the (practically unreachable, since every group is created by a
// qualifying row) case where neither is set.
function lastImpactfulEventAt(item: ImpactedUserSummary): string | null {
  if (item.serverErrorCount > 0 || item.clientErrorCount > 0) return item.lastErrorAt ?? item.lastSeenAt;
  if (item.slowCount > 0) return item.lastSlowAt ?? item.lastSeenAt;
  return item.lastSeenAt;
}

function computeAttention(item: ImpactedUserSummary): ImpactedUserSummary["attention"] {
  if (item.resolution.status === "restored") return "none";
  const lastImpactAt = Date.parse(lastImpactfulEventAt(item) ?? "");
  if (Number.isFinite(lastImpactAt) && Date.now() - lastImpactAt <= activeAttentionWindowMs) return "active";
  return "unconfirmed";
}

function applyAutomaticImpactRecovery(
  groups: Map<string, ImpactedUserSummary>,
  manualResolutions: Map<string, ImpactedUserSummary["resolution"]>,
  healthRows: Array<{ actorId: number | null; ip: string | null; ua: string | null; afterJson: unknown; createdAt: Date | null }>,
  apiHealthRows: Array<{ afterJson: unknown; createdAt: Date | null }>
) {
  // Latest "route healthy again" timestamp per API route, indexed by both the
  // raw and normalized route so either form recorded on an incident matches.
  const apiHealthByRoute = new Map<string, number>();
  for (const row of apiHealthRows) {
    const after = normalizeJsonObject(row.afterJson);
    const route = textOrNull(after.route);
    const at = row.createdAt ? row.createdAt.getTime() : NaN;
    if (!route || !Number.isFinite(at)) continue;
    for (const key of new Set([route, normalizeRoute(route)])) {
      const existing = apiHealthByRoute.get(key);
      if (existing === undefined || at > existing) apiHealthByRoute.set(key, at);
    }
  }

  const healthByKey = new Map<string, Array<{ route: string | null; path: string | null; createdAt: string }>>();

  for (const row of healthRows) {
    const key = impactKeyFor(typeof row.actorId === "number" ? row.actorId : null, row.ip, row.ua);
    const after = normalizeJsonObject(row.afterJson);
    const createdAt = row.createdAt ? row.createdAt.toISOString() : null;
    if (!createdAt) continue;
    const arr = healthByKey.get(key) ?? [];
    arr.push({
      route: textOrNull(after.route),
      path: textOrNull(after.path),
      createdAt,
    });
    healthByKey.set(key, arr);
  }

  for (const item of groups.values()) {
    const lastImpactAt = Date.parse(item.lastSeenAt ?? "0");
    const hasServerOrSlowImpact = item.serverErrorCount > 0 || item.slowCount > 0;
    const hasClientImpact = item.clientErrorCount > 0;
    const manual = manualResolutions.get(item.key);
    if (manual?.status === "restored") {
      const restoredAt = Date.parse(manual.restoredAt ?? "0");
      item.resolution = Number.isFinite(restoredAt) && restoredAt >= lastImpactAt ? manual : openImpactResolution();
    }

    if (item.resolution.status === "restored") continue;

    // Server/slow incidents auto-close once every affected API route has
    // reported a healthy response newer than the last impact ("all healthy =
    // recovered"). Mixed incidents that also carry a frontend crash fall
    // through to the client-side recovery checks below instead.
    if (hasServerOrSlowImpact && !hasClientImpact) {
      const apiRoutes = item.routes.filter((route) => route && route.startsWith("/api/"));
      const healthyAtFor = (route: string) =>
        apiHealthByRoute.get(route) ?? apiHealthByRoute.get(normalizeRoute(route));
      if (apiRoutes.length > 0 && apiRoutes.every((route) => (healthyAtFor(route) ?? 0) > lastImpactAt)) {
        const restoredAtMs = Math.max(...apiRoutes.map((route) => healthyAtFor(route) ?? 0));
        item.resolution = {
          status: "restored",
          note: "Auto-restored after every affected API route returned a healthy response.",
          restoredAt: new Date(restoredAtMs).toISOString(),
          restoredBy: null,
        };
        continue;
      }
    }

    const routeSet = new Set(item.routes.filter(Boolean));
    const healthyEvents = healthByKey.get(item.key) ?? [];
    const healthy = healthyEvents.find((entry) => {
      const healthyAt = Date.parse(entry.createdAt);
      if (!Number.isFinite(healthyAt) || healthyAt <= lastImpactAt) return false;
      const route = entry.route || entry.path;
      if (!route) return false;
      return routeSet.has(route) || routeSet.has(normalizeRoute(route));
    });

    const sharedClientHealth = !hasServerOrSlowImpact && hasClientImpact
      ? healthyEvents.find((entry) => {
          const healthyAt = Date.parse(entry.createdAt);
          if (!Number.isFinite(healthyAt) || healthyAt <= lastImpactAt) return false;
          const route = entry.route || entry.path || "";
          return route.startsWith("/admin");
        })
      : null;

    const healthyApiRequest = recentRequests
      .slice()
      .reverse()
      .find((request) => {
        if (request.statusCode >= 500 || request.durationMs >= slowRequestThresholdMs) return false;
        const key = impactKeyFor(request.actorId ?? null, request.ip, request.userAgent);
        if (key !== item.key) return false;
        const requestAt = Date.parse(request.timestamp);
        if (!Number.isFinite(requestAt) || requestAt <= lastImpactAt) return false;
        return routeSet.has(request.route) || routeSet.has(request.path);
      });

    const restoredAt = healthy?.createdAt ?? sharedClientHealth?.createdAt ?? healthyApiRequest?.timestamp ?? null;
    if (!restoredAt) continue;

    item.resolution = {
      status: "restored",
      note: healthy
        ? "Auto-restored after the same route mounted successfully without a client error."
        : sharedClientHealth
          ? "Auto-restored after a newer admin page mounted successfully without the same shared UI crash."
        : "Auto-restored after a newer successful request on the affected route.",
      restoredAt,
      restoredBy: null,
    };
  }
}

function openImpactResolution(): ImpactedUserSummary["resolution"] {
  return {
    status: "open",
    note: null,
    restoredAt: null,
    restoredBy: null,
  };
}

function diagnosticOrNull(value: unknown): ErrorDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const diagnostic = value as Partial<ErrorDiagnostic>;
  if (typeof diagnostic.fingerprint !== "string" || !Array.isArray(diagnostic.frames)) return null;
  return diagnostic as ErrorDiagnostic;
}

function impactKeyFor(actorId: number | null, ip: string | null | undefined, ua: string | null | undefined) {
  return actorId ? `user:${actorId}` : `anon:${ip ?? "unknown"}:${ua ?? "unknown"}`;
}

async function maybeAlertRepeatedServerErrors(entry: ObservedRequest) {
  const now = Date.now();
  if (now - lastRepeatedErrorAlertAt < repeatedErrorAlertCooldownMs) return;

  const since = now - repeatedErrorWindowMs;
  const recentErrors = recentRequests.filter((request) => {
    if (request.statusCode < 500) return false;
    const requestTime = new Date(request.timestamp).getTime();
    return Number.isFinite(requestTime) && requestTime >= since;
  });

  if (recentErrors.length < repeatedErrorThreshold) return;

  lastRepeatedErrorAlertAt = now;
  try {
    await prisma.notification.create({
      data: {
        userId: null,
        ownerId: null,
        title: "Repeated API Server Errors",
        body: `${recentErrors.length} server errors were observed in the last 5 minutes. Latest: ${entry.method} ${entry.route} returned ${entry.statusCode}.`,
        unread: true,
        type: "system",
        meta: {
          kind: "observability_repeated_5xx",
          count: recentErrors.length,
          windowMinutes: 5,
          latestRequestId: entry.requestId,
          latestRoute: entry.route,
          latestStatusCode: entry.statusCode,
          latestDurationMs: Math.round(entry.durationMs * 100) / 100,
        },
      },
    });
  } catch (err: any) {
    console.warn("[observability] failed to create repeated 5xx notification", err?.message || err);
  }
}

function clampLimit(limit: number) {
  if (!Number.isFinite(limit)) return 100;
  return Math.max(1, Math.min(500, Math.round(limit)));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(sortedValues: number[], p: number) {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))] ?? 0;
}

function countBy<T>(items: T[], selector: (item: T) => string) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = selector(item);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function roundMs(value: number) {
  return Math.round(value * 100) / 100;
}

function roundRatio(value: number) {
  return Math.round(value * 10000) / 10000;
}

function escapeLabel(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function textOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

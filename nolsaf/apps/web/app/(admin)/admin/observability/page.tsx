"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowRight, Clock3, RefreshCw, Server, Trash2, UserRound, Zap } from "lucide-react";
import apiClient from "@/lib/apiClient";

type ObservedRequest = {
  requestId: string;
  method: string;
  path: string;
  route: string;
  statusCode: number;
  durationMs: number;
  ip: string | null;
  userAgent: string | null;
  timestamp: string;
};

type Summary = {
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
    slowCount: number;
    errors: number;
    averageDurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
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

type ObservabilityData = {
  summary: Summary | null;
  recent: ObservedRequest[];
  slow: ObservedRequest[];
  errors: ObservedRequest[];
  impactedUsers: ImpactedUser[];
};

type ImpactedUser = {
  key: string;
  userId: number | null;
  role: string | null;
  name: string | null;
  email: string | null;
  label: string;
  eventCount: number;
  slowCount: number;
  serverErrorCount: number;
  clientErrorCount: number;
  routes: string[];
  lastSeenAt: string | null;
  lastEvent: {
    action: string;
    route: string | null;
    path: string | null;
    statusCode: number | null;
    durationMs: number | null;
    message: string | null;
    requestId: string | null;
  } | null;
  resolution?: {
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
};

const REFRESH_SECONDS = 15;

/** "2h 14m" from the API's uptime seconds. */
function formatUptime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

const emptyData: ObservabilityData = {
  summary: null,
  recent: [],
  slow: [],
  errors: [],
  impactedUsers: [],
};

export default function AdminObservabilityPage() {
  const [data, setData] = useState<ObservabilityData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);

  const load = async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const snapshotRes = await apiClient.get("/api/admin/observability/snapshot?recentLimit=30&slowLimit=15&errorLimit=15");

      setData({
        summary: snapshotRes.data?.summary ?? null,
        recent: snapshotRes.data?.recent ?? [],
        slow: snapshotRes.data?.slow ?? [],
        errors: snapshotRes.data?.errors ?? [],
        impactedUsers: snapshotRes.data?.impactedUsers ?? [],
      });
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to load observability data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // One second tick drives the visible countdown, and fires the refresh at zero.
  useEffect(() => {
    if (!autoRefresh) return;
    setCountdown(REFRESH_SECONDS);
    const id = window.setInterval(() => {
      setCountdown((seconds) => {
        if (seconds <= 1) {
          void load(true);
          return REFRESH_SECONDS;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [autoRefresh]);

  const statusText = useMemo(() => {
    if (loading) return "Loading";
    if (error) return "Needs attention";
    return "Live";
  }, [error, loading]);

  const summary = data.summary;
  const errorRatePct = summary ? `${(summary.errorRate * 100).toFixed(2)}%` : "0.00%";
  const errorsPresent = Boolean(summary && summary.errorRate > 0) || data.errors.length > 0;
  const latencyWatch = Boolean(summary && summary.p95DurationMs > 750);
  const slowCount = summary?.slowRequestsInWindow ?? 0;
  const slowShare = summary && summary.requestsInWindow > 0 ? (slowCount / summary.requestsInWindow) * 100 : 0;
  const worstRoute = summary?.slowRoutes?.[0] ?? null;

  /** Status codes grouped into the four bands an operator reacts to. */
  const statusMix = useMemo(() => {
    const counts = summary?.statusCounts ?? {};
    const bands = [
      { label: "2xx", bar: "bg-emerald-500", test: (code: number) => code < 300 },
      { label: "3xx", bar: "bg-sky-400", test: (code: number) => code >= 300 && code < 400 },
      { label: "4xx", bar: "bg-amber-400", test: (code: number) => code >= 400 && code < 500 },
      { label: "5xx", bar: "bg-rose-500", test: (code: number) => code >= 500 },
    ];
    const totals = bands.map((band) => ({
      ...band,
      count: Object.entries(counts).reduce((sum, [code, value]) => (band.test(Number(code)) ? sum + Number(value || 0) : sum), 0),
    }));
    const total = totals.reduce((sum, band) => sum + band.count, 0) || 1;
    return totals.map((band) => ({ ...band, pct: (band.count / total) * 100 }));
  }, [summary?.statusCounts]);

  async function clearWindow() {
    await apiClient.delete("/api/admin/observability/requests");
    setConfirmClearOpen(false);
    await load(true);
  }

  return (
    <div className="w-full min-w-0">
      <div className="space-y-4">
        {/* Console header: what this is, whether it is live, and the controls. */}
        <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
            <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-slate-900 text-white"><Activity className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="m-0 flex flex-wrap items-center gap-2">
                <span className="text-base font-bold text-slate-900">Observability</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                  <span className="relative flex h-1.5 w-1.5">
                    {!error && autoRefresh && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400" />}
                    <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${error ? "bg-rose-500" : "bg-emerald-500"}`} />
                  </span>
                  {statusText}
                </span>
              </p>
              <p className="m-0 mt-0.5 text-xs text-slate-500">
                Request logs, latency, slow calls and server errors from the current API process
                {summary ? ` · up ${formatUptime(summary.uptimeSeconds)} · window keeps ${summary.windowSize.toLocaleString()} requests` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* Auto refresh is the page's heartbeat: make it visible and stoppable. */}
              <button
                type="button"
                role="switch"
                aria-checked={autoRefresh}
                onClick={() => setAutoRefresh((on) => !on)}
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-solid border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                title="Refresh every 15 seconds"
              >
                <span className={`relative inline-flex h-4 w-7 rounded-full transition-colors ${autoRefresh ? "bg-emerald-600" : "bg-slate-300"}`}>
                  <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${autoRefresh ? "left-3.5" : "left-0.5"}`} />
                </span>
                <span className="tabular-nums">{autoRefresh ? `Live ${countdown}s` : "Paused"}</span>
              </button>
              <button type="button" onClick={() => load(true)} disabled={refreshing} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
              </button>
              <a href="/api/admin/observability/prometheus" target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 no-underline transition hover:bg-slate-50 hover:no-underline">
                <Server className="h-3.5 w-3.5" /> Metrics
              </a>
              <button type="button" onClick={() => setConfirmClearOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-transparent px-2.5 text-xs font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-700" title="Clear the in-memory request window">
                <Trash2 className="h-3.5 w-3.5" /> Clear
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" /> {error}
          </div>
        ) : null}

        {/* Metric strip: each tile carries its own small visual, not just a number. */}
        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-solid border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
          {/* Traffic with its status mix */}
          <div className="min-w-0 bg-white px-4 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Requests</span>
              <Activity className="h-4 w-4 text-sky-500" />
            </div>
            <p className="m-0 mt-1.5 text-2xl font-bold tabular-nums leading-none text-slate-900">{(summary?.requestsInWindow ?? 0).toLocaleString()}</p>
            <p className="m-0 mt-1 text-[11px] text-slate-500">{(summary?.totalRequestsObserved ?? 0).toLocaleString()} since start</p>
            <div className="mt-2.5 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              {statusMix.map((band) => band.count > 0 ? <span key={band.label} className={band.bar} style={{ width: `${band.pct}%` }} title={`${band.label}: ${band.count}`} /> : null)}
            </div>
            <p className="m-0 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500">
              {statusMix.filter((b) => b.count > 0).map((band) => (
                <span key={band.label} className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${band.bar}`} />{band.label} {band.count}</span>
              ))}
              {statusMix.every((b) => b.count === 0) && <span>No traffic captured yet</span>}
            </p>
          </div>

          {/* Latency percentiles */}
          <div className="min-w-0 bg-white px-4 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Latency</span>
              <Clock3 className={`h-4 w-4 ${latencyWatch ? "text-amber-500" : "text-indigo-500"}`} />
            </div>
            <p className="m-0 mt-1.5 flex items-baseline gap-1 leading-none">
              <span className={`text-2xl font-bold tabular-nums ${latencyWatch ? "text-amber-700" : "text-slate-900"}`}>{Math.round(summary?.averageDurationMs ?? 0)}</span>
              <span className="text-xs text-slate-400">ms average</span>
            </p>
            <p className="m-0 mt-1 text-[11px] text-slate-500">Slow threshold {summary?.slowRequestThresholdMs ?? 1000}ms</p>
            <div className="mt-2.5 space-y-1">
              {[
                { label: "p95", value: summary?.p95DurationMs ?? 0 },
                { label: "p99", value: summary?.p99DurationMs ?? 0 },
              ].map((row) => {
                const threshold = summary?.slowRequestThresholdMs || 1000;
                const width = Math.min(100, (row.value / Math.max(threshold, 1)) * 100);
                return (
                  <div key={row.label} className="flex items-center gap-2">
                    <span className="w-7 text-[10px] text-slate-400">{row.label}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <span className={`block h-full rounded-full ${row.value >= threshold ? "bg-rose-500" : row.value > threshold * 0.6 ? "bg-amber-400" : "bg-indigo-400"}`} style={{ width: `${Math.max(width, 3)}%` }} />
                    </span>
                    <span className="w-14 text-right text-[10px] tabular-nums text-slate-600">{Math.round(row.value)}ms</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Slow requests */}
          <div className="min-w-0 bg-white px-4 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Slow requests</span>
              <Zap className={`h-4 w-4 ${slowCount ? "text-amber-500" : "text-violet-500"}`} />
            </div>
            <p className="m-0 mt-1.5 flex items-baseline gap-2 leading-none">
              <span className={`text-2xl font-bold tabular-nums ${slowCount ? "text-amber-700" : "text-slate-900"}`}>{slowCount}</span>
              <span className="text-xs text-slate-400">{slowShare.toFixed(1)}% of traffic</span>
            </p>
            <p className="m-0 mt-1 truncate text-[11px] text-slate-500">
              {worstRoute ? <>Worst: <span className="font-mono text-slate-700">{worstRoute.route}</span></> : "No slow route captured"}
            </p>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${slowCount ? "bg-amber-400" : "bg-violet-300"}`} style={{ width: `${Math.max(slowShare, slowCount ? 3 : 0)}%` }} />
            </div>
            <p className="m-0 mt-1.5 text-[10px] text-slate-500">{worstRoute ? `p95 ${worstRoute.p95DurationMs}ms on ${worstRoute.slowCount} calls` : "Everything under the threshold"}</p>
          </div>

          {/* Errors */}
          <div className="min-w-0 bg-white px-4 py-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Error rate</span>
              <AlertTriangle className={`h-4 w-4 ${errorsPresent ? "text-rose-500" : "text-emerald-500"}`} />
            </div>
            <p className="m-0 mt-1.5 flex items-baseline gap-2 leading-none">
              <span className={`text-2xl font-bold tabular-nums ${errorsPresent ? "text-rose-700" : "text-emerald-700"}`}>{errorRatePct}</span>
              <span className="text-xs text-slate-400">{errorsPresent ? "needs review" : "healthy"}</span>
            </p>
            <p className="m-0 mt-1 text-[11px] text-slate-500">{data.errors.length} server {data.errors.length === 1 ? "error" : "errors"} in the window</p>
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full ${errorsPresent ? "bg-rose-500" : "bg-emerald-500"}`} style={{ width: `${errorsPresent ? Math.max((summary?.errorRate ?? 0) * 100, 3) : 100}%` }} />
            </div>
            <p className="m-0 mt-1.5 truncate text-[10px] text-slate-500">
              {data.errors[0] ? <>Last: <span className="font-mono">{data.errors[0].statusCode} {data.errors[0].path}</span></> : "No 5xx responses captured"}
            </p>
          </div>
        </div>

        <ImpactCenterSummary items={data.impactedUsers} loading={loading} />

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
          <section className="xl:col-span-3 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader title="Recent Requests" subtitle={`Last ${data.recent.length} captured`} />
            <RequestTable items={data.recent} loading={loading} />
          </section>

          <section className="xl:col-span-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader title="Slowest Routes" subtitle="Most slow calls in the retained window" />
            <div className="divide-y divide-slate-100">
              {(summary?.slowRoutes ?? []).map((route) => <RouteHealthRow key={route.route} route={route} />)}
              {!loading && !summary?.slowRoutes?.length ? <EmptyState label="No slow routes captured yet" /> : null}
            </div>
          </section>
        </div>

        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <SectionHeader title="Route Volume" subtitle="Most requested routes in the retained window" />
          <div className="grid grid-cols-1 divide-y divide-slate-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            {(summary?.topRoutes ?? []).slice(0, 8).map((route) => <RouteHealthRow key={route.route} route={route} compact />)}
            {!loading && !summary?.topRoutes?.length ? <EmptyState label="No routes captured yet" /> : null}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader title="Slow Requests" subtitle={`Over ${summary?.slowRequestThresholdMs ?? 1000}ms`} />
            <RequestTable items={data.slow} loading={loading} compact />
          </section>

          <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader title="Server Errors" subtitle="HTTP 5xx responses" />
            <RequestTable items={data.errors} loading={loading} compact />
          </section>
        </div>
      </div>

      {confirmClearOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg border border-red-100 bg-red-50 text-red-700">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-slate-950">Clear Observability Window</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-600">
                    This clears the current in-memory request sample. It does not delete audit logs or server log files.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setConfirmClearOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/25"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearWindow}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-red-600 bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:border-red-700 hover:bg-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-200"
              >
                Clear Window
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RouteHealthRow({
  route,
  compact = false,
}: {
  route: {
    route: string;
    count: number;
    slowCount: number;
    errors: number;
    averageDurationMs: number;
    p95DurationMs: number;
    maxDurationMs: number;
  };
  compact?: boolean;
}) {
  const severity = route.errors > 0 ? "red" : route.slowCount > 0 ? "amber" : "slate";
  const barPct = Math.max(8, Math.min(100, Math.round((route.p95DurationMs / 5000) * 100)));
  const barClass = severity === "red" ? "bg-red-500" : severity === "amber" ? "bg-amber-500" : "bg-slate-300";

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs font-semibold text-slate-900">{route.route}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>{route.count} requests</span>
            <span className={route.slowCount > 0 ? "font-semibold text-amber-700" : ""}>{route.slowCount} slow</span>
            <span className={route.errors > 0 ? "font-semibold text-red-700" : ""}>{route.errors} errors</span>
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="font-semibold text-slate-900">p95 {route.p95DurationMs}ms</div>
          {!compact ? <div className="text-slate-500">avg {route.averageDurationMs}ms</div> : null}
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

function ImpactCenterSummary({ items, loading }: { items: ImpactedUser[]; loading: boolean }) {
  const activeItems = items.filter((item) => item.resolution?.status !== "restored");
  const restoredItems = items.filter((item) => item.resolution?.status === "restored");
  const activeEvents = activeItems.reduce((sum, item) => sum + item.eventCount, 0);
  const errorEvents = activeItems.reduce((sum, item) => sum + item.serverErrorCount + item.clientErrorCount, 0);
  const slowEvents = activeItems.reduce((sum, item) => sum + item.slowCount, 0);
  const hasCritical = errorEvents > 0;
  const healthLabel = hasCritical ? "Needs review" : restoredItems.length > 0 ? "Recovering" : "Quiet";
  const statusClass = hasCritical
    ? "border-red-200 bg-red-50 text-red-700"
    : restoredItems.length > 0
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : "border-slate-200 bg-slate-50 text-slate-700";
  const statusDotClass = hasCritical ? "bg-red-500" : restoredItems.length > 0 ? "bg-emerald-500" : "bg-slate-400";
  const statusDetail = hasCritical
    ? `${errorEvents} active error ${errorEvents === 1 ? "event" : "events"}`
    : restoredItems.length > 0
      ? `${restoredItems.length} restored ${restoredItems.length === 1 ? "case" : "cases"}`
      : "No active impact";

  // Who is worst affected right now, so the card names a person, not only counts.
  const worst = [...activeItems].sort(
    (a, b) => (b.serverErrorCount + b.clientErrorCount) - (a.serverErrorCount + a.clientErrorCount) || b.eventCount - a.eventCount,
  )[0];
  const stats = [
    { label: "Active", value: activeItems.length, tone: hasCritical ? "text-rose-700" : "text-slate-900", bar: hasCritical ? "bg-rose-500" : "bg-slate-300" },
    { label: "Errors", value: errorEvents, tone: errorEvents ? "text-rose-700" : "text-slate-900", bar: errorEvents ? "bg-rose-500" : "bg-slate-300" },
    { label: "Slow", value: slowEvents, tone: slowEvents ? "text-amber-700" : "text-slate-900", bar: slowEvents ? "bg-amber-400" : "bg-slate-300" },
    { label: "Restored", value: restoredItems.length, tone: restoredItems.length ? "text-emerald-700" : "text-slate-900", bar: restoredItems.length ? "bg-emerald-500" : "bg-slate-300" },
  ];
  const peak = Math.max(1, ...stats.map((s) => s.value));

  return (
    <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
      <div className="grid gap-px bg-slate-200 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        {/* What it is, and the single sentence of current state */}
        <div className="min-w-0 bg-white px-4 py-4 sm:px-5">
          <div className="flex items-start gap-3">
            <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${hasCritical ? "bg-rose-50 text-rose-600" : restoredItems.length > 0 ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>
              <UserRound className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="m-0 flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-slate-900">Impact Center</span>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${statusDotClass}`} />{healthLabel}
                </span>
              </p>
              <p className="m-0 mt-1 text-xs leading-5 text-slate-500">
                Users tied to slow calls, server errors and frontend crashes. {loading ? "Checking…" : statusDetail + "."}
              </p>
              {!loading && worst && (
                <p className="m-0 mt-2 flex min-w-0 items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                  <span className="grid h-6 w-6 flex-shrink-0 place-items-center rounded-full bg-white text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                    {(worst.name || worst.label || "?").trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    Most affected: <span className="font-medium text-slate-800">{worst.name || worst.label}</span>
                    {worst.lastEvent?.route ? <span className="font-mono text-slate-500"> · {worst.lastEvent.route}</span> : null}
                  </span>
                  <span className="flex-shrink-0 tabular-nums text-slate-400">{worst.eventCount} {worst.eventCount === 1 ? "event" : "events"}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Counts with proportion, and the way in */}
        <div className="min-w-0 bg-white px-4 py-4 sm:px-5">
          <div className="grid grid-cols-4 gap-3">
            {stats.map((stat) => (
              <div key={stat.label} className="min-w-0">
                <p className={`m-0 text-xl font-bold tabular-nums leading-none ${stat.tone}`}>{loading ? "…" : stat.value}</p>
                <p className="m-0 mt-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">{stat.label}</p>
                <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <span className={`block h-full rounded-full ${stat.bar}`} style={{ width: `${stat.value > 0 ? Math.max((stat.value / peak) * 100, 12) : 0}%` }} />
                </span>
              </div>
            ))}
          </div>
          <Link
            href="/admin/impact-center"
            className="mt-3.5 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border-0 bg-slate-900 px-4 text-xs font-semibold text-white no-underline transition hover:bg-slate-800 hover:no-underline sm:w-auto"
          >
            Open Impact Center <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
      <div>
        <h2 className="text-sm font-bold text-slate-950">{title}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function RequestTable({ items, loading, compact = false }: { items: ObservedRequest[]; loading: boolean; compact?: boolean }) {
  if (loading) return <EmptyState label="Loading request data" />;
  if (!items.length) return <EmptyState label="No matching requests yet" />;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-100 text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Time</th>
            <th className="px-4 py-3 font-semibold">Request</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Latency</th>
            {!compact ? <th className="px-4 py-3 font-semibold">ID</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <tr key={`${item.requestId}-${item.timestamp}`} className="transition-colors hover:bg-slate-50/70">
              <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">{formatTime(item.timestamp)}</td>
              <td className="px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] font-bold text-slate-700">{item.method}</span>
                  <span className="max-w-[26rem] truncate font-mono text-xs text-slate-800">{item.path}</span>
                </div>
              </td>
              <td className="px-4 py-3">
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusClass(item.statusCode)}`}>{item.statusCode}</span>
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-800">{Math.round(item.durationMs)}ms</td>
              {!compact ? <td className="max-w-[10rem] truncate px-4 py-3 font-mono text-xs text-slate-500">{item.requestId}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="px-4 py-10 text-center text-sm font-medium text-slate-500">{label}</div>;
}

function statusClass(statusCode: number) {
  if (statusCode >= 500) return "bg-red-100 text-red-700";
  if (statusCode >= 400) return "bg-amber-100 text-amber-700";
  if (statusCode >= 300) return "bg-sky-100 text-sky-700";
  return "bg-emerald-100 text-emerald-700";
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

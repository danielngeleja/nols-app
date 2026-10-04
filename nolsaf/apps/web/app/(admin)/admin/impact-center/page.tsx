"use client";

// Impact Center: who is hurting right now, why, and what was done about it.
// Reads GET /api/admin/observability/impacted-users and records recoveries with
// POST .../restore. The heavy stack diagnostics stay, but behind a per-row toggle
// so the queue itself reads as a queue.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Bot, Bug, Building2, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  ClipboardCopy, Clock3, ExternalLink, FileCode2, Flame, History, RefreshCw, Search, ServerCrash,
  ShieldCheck, Truck, UserRound, X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type ImpactedUser = {
  key: string;
  userId: number | null;
  role: string | null;
  profile: { kind: "admin" | "agent" | "customer" | "driver" | "owner"; href: string; label: string } | null;
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
    restoredBy: { id: number | null; name: string | null; email: string | null; role: string | null } | null;
  };
  attention: "active" | "unconfirmed" | "none";
};

type ErrorDiagnostic = {
  service: "web" | "api";
  release: string | null;
  fingerprint: string;
  primaryFrame: DiagnosticFrame | null;
  frames: DiagnosticFrame[];
};

type DiagnosticFrame = {
  functionName: string | null;
  file: string;
  line: number | null;
  column: number | null;
  inApp: boolean;
  mapped: boolean;
  codeContext?: Array<{ line: number; content: string; highlight: boolean }>;
  sourceLink?: string | null;
};

type Filter = "all" | "attention" | "critical" | "slow" | "client" | "server" | "known" | "visitors" | "restored";
const pageSize = 10;
const REFRESH_SECONDS = 30;

export default function AdminImpactCenterPage() {
  const [items, setItems] = useState<ImpactedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [restoreTarget, setRestoreTarget] = useState<ImpactedUser | null>(null);
  const [restoreNote, setRestoreNote] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [environment, setEnvironment] = useState("Environment");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get("/api/admin/observability/impacted-users?limit=80");
      setItems(res.data?.items ?? []);
      setLastUpdatedAt(new Date());
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to load impacted users");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    const configuredEnvironment = process.env.NEXT_PUBLIC_APP_ENV?.trim();
    const hostname = window.location.hostname.toLowerCase();
    setEnvironment(configuredEnvironment || (
      hostname === "localhost" || hostname === "127.0.0.1"
        ? "Local"
        : hostname.includes("staging") || hostname.includes("preview") ? "Staging" : "Production"
    ));
    load();
  }, []);

  // Visible, pausable heartbeat instead of a silent 30s timer.
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

  useEffect(() => { setPage(1); }, [filter, query]);

  const summary = useMemo(() => {
    const activeItems = items.filter((item) => item.resolution?.status !== "restored");
    return {
      people: activeItems.length,
      attention: activeItems.filter((item) => item.attention === "active").length,
      critical: activeItems.filter((item) => item.serverErrorCount > 0 || item.clientErrorCount > 0).length,
      slow: activeItems.filter((item) => item.slowCount > 0).length,
      server: activeItems.filter((item) => item.serverErrorCount > 0).length,
      client: activeItems.filter((item) => item.clientErrorCount > 0).length,
      known: activeItems.filter((item) => item.userId).length,
      visitors: activeItems.filter((item) => !item.userId).length,
      restored: items.filter((item) => item.resolution?.status === "restored").length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "restored" && item.resolution?.status !== "restored") return false;
      if (filter !== "restored" && item.resolution?.status === "restored") return false;
      if (filter === "attention" && item.attention !== "active") return false;
      if (filter === "critical" && item.serverErrorCount + item.clientErrorCount === 0) return false;
      if (filter === "slow" && item.slowCount === 0) return false;
      if (filter === "client" && item.clientErrorCount === 0) return false;
      if (filter === "server" && item.serverErrorCount === 0) return false;
      if (filter === "known" && !item.userId) return false;
      if (filter === "visitors" && item.userId) return false;
      if (!q) return true;
      const haystack = [
        item.label, item.email, item.role, item.userId ? String(item.userId) : "",
        item.lastEvent?.message, item.lastEvent?.route, item.lastEvent?.path,
        item.lastEvent?.diagnostic?.primaryFrame?.file, item.lastEvent?.diagnostic?.fingerprint,
        ...item.routes,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [filter, items, query]);

  // Worst first: active incidents, then errors, then slow, then recency.
  const ordered = useMemo(() => {
    const weight = (item: ImpactedUser) =>
      (item.attention === "active" ? 1000 : 0) +
      (item.serverErrorCount + item.clientErrorCount) * 100 +
      item.slowCount * 10;
    return [...filtered].sort((a, b) => weight(b) - weight(a) || new Date(b.lastSeenAt || 0).getTime() - new Date(a.lastSeenAt || 0).getTime());
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = ordered.slice((safePage - 1) * pageSize, safePage * pageSize);

  async function markRestored() {
    if (!restoreTarget) return;
    setRestoring(true);
    setError(null);
    try {
      await apiClient.post("/api/admin/observability/impacted-users/restore", {
        impactKey: restoreTarget.key,
        label: restoreTarget.label,
        note: restoreNote,
      });
      setRestoreTarget(null);
      setRestoreNote("");
      await load(true);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to mark impact item as restored");
    } finally {
      setRestoring(false);
    }
  }

  /* Derived intelligence: the API returns people, so the shape of the incident
     has to be read out of them. */

  // Last 24 hours of captured impact, bucketed by hour from each person's last signal.
  const timeline = useMemo(() => {
    const now = new Date();
    const buckets = Array.from({ length: 24 }, (_, index) => {
      const start = new Date(now.getTime() - (23 - index) * 3600000);
      return { hour: start.getHours(), events: 0, errors: 0, at: start };
    });
    for (const person of items) {
      if (!person.lastSeenAt) continue;
      const hoursAgo = Math.floor((now.getTime() - new Date(person.lastSeenAt).getTime()) / 3600000);
      if (hoursAgo < 0 || hoursAgo > 23) continue;
      const bucket = buckets[23 - hoursAgo];
      bucket.events += person.eventCount;
      bucket.errors += person.serverErrorCount + person.clientErrorCount;
    }
    return { buckets, peak: Math.max(1, ...buckets.map((b) => b.events)) };
  }, [items]);

  // Routes shared by several people are the fastest path to a root cause.
  const hotspots = useMemo(() => {
    const map = new Map<string, { route: string; people: number; errors: number; slow: number }>();
    for (const person of items) {
      if (person.resolution?.status === "restored") continue;
      for (const route of person.routes) {
        const entry = map.get(route) || { route, people: 0, errors: 0, slow: 0 };
        entry.people += 1;
        entry.errors += person.serverErrorCount + person.clientErrorCount;
        entry.slow += person.slowCount;
        map.set(route, entry);
      }
    }
    return [...map.values()].sort((a, b) => b.errors - a.errors || b.people - a.people).slice(0, 5);
  }, [items]);

  const lastSignalAt = useMemo(() => {
    const times = items.map((item) => (item.lastSeenAt ? new Date(item.lastSeenAt).getTime() : 0)).filter(Boolean);
    return times.length ? new Date(Math.max(...times)) : null;
  }, [items]);
  const quietFor = lastSignalAt ? Math.max(0, Math.round((Date.now() - lastSignalAt.getTime()) / 60000)) : null;
  const quietLabel = quietFor == null ? "no signal captured yet" : quietFor < 60 ? `${quietFor} min` : quietFor < 1440 ? `${Math.round(quietFor / 60)} h` : `${Math.round(quietFor / 1440)} days`;
  const recentlyRestored = useMemo(
    () => items.filter((item) => item.resolution?.status === "restored")
      .sort((a, b) => new Date(b.resolution.restoredAt || 0).getTime() - new Date(a.resolution.restoredAt || 0).getTime())
      .slice(0, 3),
    [items],
  );

  /** One paste-ready triage summary, for a standup or a chat thread. */
  const copySummary = async () => {
    const lines = [
      `Impact Center · ${environment} · ${new Date().toLocaleString()}`,
      `Active ${summary.attention} · with errors ${summary.critical} (${summary.server} server, ${summary.client} frontend) · slow ${summary.slow} · restored ${summary.restored}`,
      ...(hotspots.length ? ["Hotspots:", ...hotspots.map((h) => `  ${h.route} · ${h.people} ${h.people === 1 ? "person" : "people"} · ${h.errors} errors · ${h.slow} slow`)] : []),
      ...(ordered.slice(0, 5).length ? ["Top affected:", ...ordered.slice(0, 5).map((p) => `  ${p.label} · ${p.serverErrorCount + p.clientErrorCount} errors · ${p.slowCount} slow · ${p.lastEvent?.message || p.lastEvent?.route || "no message"}`)] : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy to the clipboard in this browser.");
    }
  };

  const headline = summary.critical > 0
    ? `${summary.critical} with errors`
    : summary.attention > 0
      ? `${summary.attention} active`
      : summary.people > 0 ? `${summary.people} unresolved` : "All clear";
  const alarm = summary.critical > 0 || summary.attention > 0;

  const tiles = [
    { label: "Active incidents", value: summary.attention, note: "Inside the live window", tone: summary.attention > 0 ? "rose" : "emerald", icon: ServerCrash, filter: "attention" as Filter },
    { label: "Unresolved people", value: summary.people, note: "Open or awaiting confirmation", tone: "slate", icon: UserRound, filter: "all" as Filter },
    { label: "With errors", value: summary.critical, note: `${summary.server} server · ${summary.client} frontend`, tone: summary.critical > 0 ? "rose" : "emerald", icon: AlertTriangle, filter: "critical" as Filter },
    { label: "Slow sessions", value: summary.slow, note: "Users hitting slow calls", tone: summary.slow > 0 ? "amber" : "emerald", icon: Clock3, filter: "slow" as Filter },
  ];
  const tileTone: Record<string, { value: string; icon: string; bar: string }> = {
    rose: { value: "text-rose-700", icon: "text-rose-500", bar: "bg-rose-500" },
    amber: { value: "text-amber-700", icon: "text-amber-500", bar: "bg-amber-400" },
    emerald: { value: "text-slate-900", icon: "text-emerald-500", bar: "bg-emerald-500" },
    slate: { value: "text-slate-900", icon: "text-slate-400", bar: "bg-slate-300" },
  };
  const peak = Math.max(1, ...tiles.map((t) => t.value));

  const filters: Array<{ key: Filter; label: string; count?: number }> = [
    { key: "all", label: "All", count: summary.people },
    { key: "attention", label: "Needs attention", count: summary.attention },
    { key: "critical", label: "Errors", count: summary.critical },
    { key: "server", label: "5xx", count: summary.server },
    { key: "client", label: "Frontend", count: summary.client },
    { key: "slow", label: "Slow", count: summary.slow },
    { key: "known", label: "Known users", count: summary.known },
    { key: "visitors", label: "Visitors", count: summary.visitors },
    { key: "restored", label: "Restored", count: summary.restored },
  ];

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Header */}
      <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
          <span className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl ${alarm ? "bg-rose-600" : "bg-slate-900"} text-white`}><UserRound className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex flex-wrap items-center gap-2">
              <Link href="/admin/observability" className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 no-underline hover:text-slate-700"><ArrowLeft className="h-3 w-3" /> Observability</Link>
              <span className="text-slate-300">/</span>
              <span className="text-base font-bold text-slate-900">Impact Center</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${alarm ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
                <span className="relative flex h-1.5 w-1.5">
                  {alarm && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400" />}
                  <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${alarm ? "bg-rose-500" : "bg-emerald-500"}`} />
                </span>
                {headline}
              </span>
            </p>
            <p className="m-0 mt-0.5 text-xs text-slate-500">
              People affected by server errors, frontend crashes and slow calls · {environment}
              {lastUpdatedAt ? ` · updated ${lastUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={autoRefresh}
              onClick={() => setAutoRefresh((on) => !on)}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-solid border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
              title={`Refresh every ${REFRESH_SECONDS} seconds`}
            >
              <span className={`relative inline-flex h-4 w-7 rounded-full transition-colors ${autoRefresh ? "bg-emerald-600" : "bg-slate-300"}`}>
                <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${autoRefresh ? "left-3.5" : "left-0.5"}`} />
              </span>
              <span className="tabular-nums">{autoRefresh ? `Live ${countdown}s` : "Paused"}</span>
            </button>
            <button type="button" onClick={() => void copySummary()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50" title="Copy a triage summary to share">
              {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy summary"}
            </button>
            <button type="button" onClick={() => load(true)} disabled={refreshing} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      ) : null}

      {/* Nothing wrong: say so properly, with the evidence, instead of four zeros. */}
      {!loading && summary.people === 0 ? (
        <section className="overflow-hidden rounded-2xl border border-solid border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white">
          <div className="grid gap-px bg-emerald-100 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="min-w-0 bg-white/80 px-5 py-5">
              <div className="flex items-start gap-3">
                <span className="relative grid h-11 w-11 flex-shrink-0 place-items-center rounded-2xl bg-emerald-600 text-white">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="absolute inset-0 animate-ping rounded-2xl bg-emerald-400/40" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="m-0 text-lg font-bold text-emerald-950">No one is being affected</h2>
                  <p className="m-0 mt-1 text-sm leading-6 text-emerald-900/70">
                    No unresolved errors, crashes or slow sessions in {environment}. Quiet for <span className="font-semibold">{quietLabel}</span>
                    {summary.restored > 0 ? `, with ${summary.restored} ${summary.restored === 1 ? "case" : "cases"} restored.` : "."}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link href="/admin/observability" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 text-xs font-semibold text-white no-underline transition hover:bg-emerald-800 hover:no-underline">
                      <ShieldCheck className="h-3.5 w-3.5" /> View live request logs
                    </Link>
                    {summary.restored > 0 && (
                      <button type="button" onClick={() => setFilter("restored")} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-emerald-200 bg-white px-3.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50">
                        <History className="h-3.5 w-3.5" /> Review {summary.restored} restored
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="min-w-0 bg-white/80 px-5 py-5">
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-700/70">Recently restored</p>
              {recentlyRestored.length ? (
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {recentlyRestored.map((person) => (
                    <li key={person.key} className="flex items-start gap-2 text-xs">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-800">{person.label}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {person.resolution.note || "Restored"} · {person.resolution.restoredAt ? formatTime(person.resolution.restoredAt) : ""}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 mt-2 text-xs text-slate-500">Nothing has needed recovery yet.</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* Summary strip, each tile also filters the queue. Hidden while all clear,
          because four zeros say less than the panel above. */}
      <div className={`grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-solid border-slate-200 bg-slate-200 xl:grid-cols-4 ${!loading && summary.people === 0 ? "hidden" : ""}`}>
        {tiles.map((tile) => {
          const Icon = tile.icon;
          const tone = tileTone[tile.tone];
          const active = filter === tile.filter;
          return (
            <button
              key={tile.label}
              type="button"
              onClick={() => setFilter(tile.filter)}
              aria-pressed={active}
              className={`min-w-0 border-0 px-4 py-3.5 text-left transition ${active ? "bg-slate-50" : "bg-white hover:bg-slate-50/70"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{tile.label}</span>
                <Icon className={`h-4 w-4 ${tone.icon}`} />
              </span>
              <span className={`mt-1.5 block text-2xl font-bold tabular-nums leading-none ${tone.value}`}>{loading ? "…" : tile.value}</span>
              <span className="mt-1 block truncate text-[11px] text-slate-500">{tile.note}</span>
              <span className="mt-2 block h-1 w-full overflow-hidden rounded-full bg-slate-100">
                <span className={`block h-full rounded-full ${tone.bar}`} style={{ width: `${tile.value > 0 ? Math.max((tile.value / peak) * 100, 10) : 0}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Shape of the incident: when it happened, and where it concentrates */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="min-w-0 rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-sm font-bold text-slate-900">Impact over the last 24 hours</h2>
            <span className="text-[11px] text-slate-400">By the hour a person was last affected</span>
          </div>
          <div className="mt-3 flex h-20 items-end gap-[3px]">
            {timeline.buckets.map((bucket, index) => {
              const height = bucket.events > 0 ? Math.max((bucket.events / timeline.peak) * 100, 6) : 2;
              const errorHeight = bucket.events > 0 ? (bucket.errors / Math.max(bucket.events, 1)) * height : 0;
              return (
                <span
                  key={index}
                  className="group relative flex flex-1 flex-col justify-end"
                  title={`${String(bucket.hour).padStart(2, "0")}:00 · ${bucket.events} ${bucket.events === 1 ? "event" : "events"}${bucket.errors ? `, ${bucket.errors} from errors` : ""}`}
                >
                  <span className={`w-full rounded-t-sm ${bucket.events > 0 ? "bg-slate-300" : "bg-slate-100"}`} style={{ height: `${height}%` }}>
                    {errorHeight > 0 && <span className="block w-full rounded-t-sm bg-rose-500" style={{ height: `${(errorHeight / height) * 100}%` }} />}
                  </span>
                </span>
              );
            })}
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-400">
            <span>24h ago</span>
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-500" /> errors</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-slate-300" /> other impact</span>
            </span>
            <span>now</span>
          </div>
        </section>

        <section className="min-w-0 rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 flex items-center gap-1.5 text-sm font-bold text-slate-900"><Flame className="h-4 w-4 text-amber-500" /> Route hotspots</h2>
            <span className="text-[11px] text-slate-400">Shared by unresolved people</span>
          </div>
          {hotspots.length ? (
            <ul className="m-0 mt-2.5 list-none space-y-2 p-0">
              {hotspots.map((spot) => (
                <li key={spot.route}>
                  <button type="button" onClick={() => setQuery(spot.route)} className="flex w-full items-center gap-2 rounded-lg border-0 bg-transparent px-1 py-1 text-left transition hover:bg-slate-50" title="Filter the queue by this route">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">{spot.route}</span>
                    <span className="flex-shrink-0 text-[11px] tabular-nums text-slate-500">
                      {spot.people} {spot.people === 1 ? "person" : "people"}
                      {spot.errors > 0 && <span className="ml-2 text-rose-600">{spot.errors} err</span>}
                      {spot.slow > 0 && <span className="ml-2 text-amber-600">{spot.slow} slow</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-2.5 text-xs text-slate-500">No shared routes among unresolved people.</p>
          )}
        </section>
      </div>

      {/* Queue */}
      <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-slate-900">Review queue</h2>
            <p className="m-0 text-xs tabular-nums text-slate-400">
              {loading ? "Loading…" : ordered.length ? `${(safePage - 1) * pageSize + 1}-${Math.min(safePage * pageSize, ordered.length)} of ${ordered.length}, worst first` : "Nothing to review"}
            </p>
          </div>
          <div className="relative ml-auto w-full min-w-0 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search person, route, message or file"
              className="h-9 w-full min-w-0 rounded-lg border border-solid border-slate-200 bg-white pl-9 pr-9 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-100"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Clear search">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 border-0 border-t border-solid border-slate-100 px-4 py-2.5 sm:px-5">
          {filters.map((entry) => {
            const active = filter === entry.key;
            return (
              <button
                key={entry.key}
                type="button"
                onClick={() => setFilter(entry.key)}
                aria-pressed={active}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-medium transition ${active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
              >
                {entry.label}
                {entry.count != null && <span className={`tabular-nums ${active ? "text-white/70" : "text-slate-400"}`}>{entry.count}</span>}
              </button>
            );
          })}
        </div>

        <ul className="m-0 list-none p-0">
          {loading && !items.length ? (
            <li className="flex items-center justify-center gap-2 border-0 border-t border-solid border-slate-100 py-16 text-sm text-slate-500"><RefreshCw className="h-4 w-4 animate-spin" /> Loading impacted users</li>
          ) : paginated.length === 0 ? (
            <li className="border-0 border-t border-solid border-slate-100 px-6 py-14 text-center">
              <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-5 w-5" /></span>
              <p className="m-0 mt-3 text-sm font-semibold text-slate-800">{query || filter !== "all" ? "Nothing matches this view" : "No impacted users"}</p>
              <p className="m-0 mt-1 text-xs text-slate-500">{query || filter !== "all" ? "Try another filter or search." : "Errors and slow calls affecting people will appear here."}</p>
            </li>
          ) : (
            paginated.map((item) => (
              <ImpactRow
                key={item.key}
                item={item}
                open={expanded === item.key}
                onToggle={() => setExpanded(expanded === item.key ? null : item.key)}
                onRestore={() => setRestoreTarget(item)}
              />
            ))
          )}
        </ul>

        {!loading && ordered.length > pageSize ? (
          <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 px-4 py-3 sm:px-5">
            <span className="text-xs text-slate-400">Page {safePage} of {totalPages}</span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setPage(Math.max(1, safePage - 1))} disabled={safePage <= 1} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={() => setPage(Math.min(totalPages, safePage + 1))} disabled={safePage >= totalPages} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        ) : null}
      </section>

      {/* Restore dialog */}
      {restoreTarget ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 px-4 py-6 backdrop-blur-sm" role="dialog" aria-modal="true" onMouseDown={() => { if (!restoring) setRestoreTarget(null); }}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3 px-5 py-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-base font-bold text-slate-900">Confirm recovery</h2>
                <p className="m-0 mt-0.5 truncate text-xs text-slate-500">{restoreTarget.label}</p>
              </div>
              <button type="button" onClick={() => setRestoreTarget(null)} className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Close"><X className="h-4 w-4" /></button>
            </div>
            <div className="border-0 border-t border-solid border-slate-100 px-5 py-4">
              <label className="block text-xs font-semibold text-slate-700" htmlFor="restore-note">
                What fixed it?
                <textarea
                  id="restore-note"
                  value={restoreNote}
                  onChange={(event) => setRestoreNote(event.target.value)}
                  placeholder="Example: latency returned to normal after the DB index fix"
                  className="mt-1.5 block min-h-24 w-full resize-y rounded-xl border border-solid border-slate-200 bg-white px-3 py-2.5 font-[inherit] text-sm font-normal leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
              </label>
              <p className="m-0 mt-2 text-[11px] text-slate-400">This writes an audit record and marks the person as restored.</p>
            </div>
            <div className="flex justify-end gap-2 border-0 border-t border-solid border-slate-100 bg-slate-50 px-5 py-3">
              <button type="button" onClick={() => setRestoreTarget(null)} className="inline-flex h-10 items-center rounded-lg border border-solid border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={markRestored} disabled={restoring} className="inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60">
                {restoring ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Mark restored
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Queue row. Collapsed it is one scannable line per person; expanded it
 * carries the signal, routes and the source diagnostic.
 * ------------------------------------------------------------------ */
function ImpactRow({ item, open, onToggle, onRestore }: { item: ImpactedUser; open: boolean; onToggle: () => void; onRestore: () => void }) {
  const serverIssue = item.serverErrorCount > 0;
  const clientIssue = item.clientErrorCount > 0;
  const critical = serverIssue || clientIssue;
  const restored = item.resolution?.status === "restored";
  const severity = restored
    ? { label: "Restored", text: "text-emerald-700", soft: "bg-emerald-50", dot: "bg-emerald-500", ring: "ring-emerald-200" }
    : critical
      ? { label: "Errors", text: "text-rose-700", soft: "bg-rose-50", dot: "bg-rose-500", ring: "ring-rose-200" }
      : item.slowCount > 0
        ? { label: "Slow", text: "text-amber-700", soft: "bg-amber-50", dot: "bg-amber-500", ring: "ring-amber-200" }
        : { label: "Watching", text: "text-slate-600", soft: "bg-slate-100", dot: "bg-slate-400", ring: "ring-slate-200" };
  const eventLabel = item.lastEvent?.message || item.lastEvent?.route || item.lastEvent?.path || item.lastEvent?.action || "Observed impact";
  const diagnostic = item.lastEvent?.diagnostic;
  const initial = (item.name || item.label || "?").trim().charAt(0).toUpperCase();

  return (
    <li className={`border-0 border-t border-solid border-slate-100 ${item.attention === "active" && !restored ? "bg-rose-50/30" : ""}`}>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <span className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-full text-xs font-semibold ring-2 ${severity.soft} ${severity.text} ${severity.ring}`}>
          {restored ? <CheckCircle2 className="h-4 w-4" /> : serverIssue ? <ServerCrash className="h-4 w-4" /> : clientIssue ? <Bug className="h-4 w-4" /> : initial}
        </span>

        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-semibold text-slate-900">{item.label}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${severity.soft} ${severity.text}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${severity.dot}`} />{severity.label}
            </span>
            {!restored && item.attention === "active" && <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">Active now</span>}
            {!restored && item.attention === "unconfirmed" && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Recovery unconfirmed</span>}
            {item.role && <span className="text-[11px] text-slate-400">{item.role.toLowerCase()}</span>}
            {!item.userId && <span className="text-[11px] text-slate-400">visitor</span>}
          </p>
          <p className="m-0 mt-0.5 truncate font-mono text-xs text-slate-500" title={eventLabel}>
            {item.lastEvent?.statusCode ? `${item.lastEvent.statusCode} · ` : ""}{eventLabel}
          </p>
        </div>

        {/* Counts, compact */}
        <div className="flex flex-shrink-0 items-center gap-3 text-xs">
          {[
            { label: "events", value: item.eventCount, cls: "text-slate-600" },
            { label: "slow", value: item.slowCount, cls: item.slowCount ? "text-amber-700" : "text-slate-300" },
            { label: "5xx", value: item.serverErrorCount, cls: item.serverErrorCount ? "text-rose-700" : "text-slate-300" },
            { label: "crash", value: item.clientErrorCount, cls: item.clientErrorCount ? "text-rose-700" : "text-slate-300" },
          ].map((count) => (
            <span key={count.label} className="text-center">
              <span className={`block font-semibold tabular-nums ${count.cls}`}>{count.value}</span>
              <span className="block text-[10px] text-slate-400">{count.label}</span>
            </span>
          ))}
          <span className="hidden w-24 text-right text-[11px] text-slate-400 sm:block">{item.lastSeenAt ? formatTime(item.lastSeenAt) : "No timestamp"}</span>
          <button type="button" onClick={onToggle} aria-expanded={open} className="inline-flex h-8 items-center gap-1 rounded-lg border border-solid border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50">
            Details <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {open && (
        <div className="space-y-3 border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-4 py-4 sm:px-5">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
            <div className="min-w-0 space-y-3">
              <div className="rounded-xl border border-solid border-slate-200 bg-white px-3 py-2.5">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Latest signal</p>
                <p className="m-0 mt-1 break-words font-mono text-xs leading-5 text-slate-800">{eventLabel}</p>
                <p className="m-0 mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
                  {item.lastEvent?.statusCode ? <span>HTTP {item.lastEvent.statusCode}</span> : null}
                  {item.lastEvent?.durationMs ? <span>{Math.round(item.lastEvent.durationMs)}ms</span> : null}
                  {item.lastEvent?.requestId ? <span className="font-mono">req {item.lastEvent.requestId}</span> : null}
                  {item.email ? <span className="truncate">{item.email}</span> : null}
                  {item.userId ? <span className="font-mono">#{item.userId}</span> : null}
                </p>
              </div>

              {item.routes.length > 0 && (
                <div>
                  <p className="m-0 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Affected routes</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.routes.slice(0, 8).map((route) => (
                      <span key={route} className="rounded-md bg-white px-2 py-1 font-mono text-[10px] text-slate-600 ring-1 ring-slate-200">{route}</span>
                    ))}
                    {item.routes.length > 8 ? <span className="rounded-md bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">+{item.routes.length - 8} more</span> : null}
                  </div>
                </div>
              )}

              {diagnostic ? <DiagnosticPanel diagnostic={diagnostic} rawStack={item.lastEvent?.stack} /> : null}
            </div>

            <div className="min-w-0 space-y-2">
              {restored ? (
                <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900 ring-1 ring-emerald-200">
                  <p className="m-0 flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-4 w-4" /> Restored {item.resolution.restoredAt ? formatTime(item.resolution.restoredAt) : ""}</p>
                  {item.resolution.restoredBy ? <p className="m-0 mt-0.5 text-[11px]">By {item.resolution.restoredBy.name || item.resolution.restoredBy.email || `Admin #${item.resolution.restoredBy.id}`}</p> : null}
                  {item.resolution.note ? <p className="m-0 mt-1.5 italic leading-5">&ldquo;{item.resolution.note}&rdquo;</p> : null}
                </div>
              ) : (
                <button type="button" onClick={onRestore} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Confirm restored
                </button>
              )}
              {item.profile ? (
                <Link href={item.profile.href} className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 no-underline transition hover:bg-slate-50 hover:no-underline">
                  <ImpactProfileIcon kind={item.profile.kind} /> {item.profile.label}
                </Link>
              ) : null}
              <Link href="/admin/observability" className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 no-underline transition hover:bg-slate-50 hover:no-underline">
                <ShieldCheck className="h-3.5 w-3.5" /> Investigate logs
              </Link>
              <Link href="/admin/management/audit-log" className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 no-underline transition hover:bg-slate-50 hover:no-underline">
                <History className="h-3.5 w-3.5" /> Audit trail
              </Link>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function ImpactProfileIcon({ kind }: { kind: NonNullable<ImpactedUser["profile"]>["kind"] }) {
  const className = "h-3.5 w-3.5";
  if (kind === "owner") return <Building2 className={className} />;
  if (kind === "driver") return <Truck className={className} />;
  if (kind === "agent") return <Bot className={className} />;
  if (kind === "admin") return <ShieldCheck className={className} />;
  return <UserRound className={className} />;
}

function DiagnosticPanel({ diagnostic, rawStack }: { diagnostic: ErrorDiagnostic; rawStack?: string | null }) {
  const frame = diagnostic.primaryFrame;
  const location = frame ? `${frame.file}${frame.line ? `:${frame.line}` : ""}${frame.column ? `:${frame.column}` : ""}` : null;

  return (
    <div className="overflow-hidden rounded-xl bg-slate-950 text-slate-100 ring-1 ring-slate-800">
      <div className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{frame?.mapped ? "Exact source location" : "Generated source location"}</p>
            <p className="m-0 mt-0.5 truncate font-mono text-xs text-slate-100" title={location || undefined}>{location || "No stack frame available"}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[10px]">
          <span className="rounded bg-white/5 px-2 py-1 uppercase text-slate-300">{diagnostic.service}</span>
          {diagnostic.release ? <span className="rounded bg-white/5 px-2 py-1 text-slate-300">{diagnostic.release.slice(0, 12)}</span> : null}
          <span className="rounded bg-white/5 px-2 py-1 font-mono text-slate-400">{diagnostic.fingerprint}</span>
        </div>
      </div>

      {frame?.codeContext?.length ? (
        <div className="overflow-x-auto border-0 border-t border-solid border-white/10 py-2 font-mono text-[11px] leading-5">
          {frame.codeContext.map((codeLine) => (
            <div key={codeLine.line} className={`grid min-w-max grid-cols-[3.5rem_minmax(36rem,1fr)] px-3 ${codeLine.highlight ? "bg-rose-500/15 text-rose-100" : "text-slate-300"}`}>
              <span className={`select-none pr-3 text-right ${codeLine.highlight ? "font-bold text-rose-300" : "text-slate-600"}`}>{codeLine.line}</span>
              <code className="whitespace-pre">{codeLine.content || " "}</code>
            </div>
          ))}
        </div>
      ) : (
        <p className="m-0 border-0 border-t border-solid border-white/10 px-3 py-2 text-xs text-slate-400">
          {frame?.mapped ? "Source identified; nearby code is unavailable in this release artifact." : "Private source map not available for this release. The generated line is retained for correlation."}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-white/10 px-3 py-2">
        <span className="text-[10px] text-slate-500">
          {frame?.functionName ? `Function: ${frame.functionName}` : `${diagnostic.frames.length} captured frame${diagnostic.frames.length === 1 ? "" : "s"}`}
        </span>
        <span className="flex items-center gap-3">
          {rawStack ? (
            <details>
              <summary className="cursor-pointer list-none text-[11px] font-semibold text-slate-300 hover:text-white">Stack trace</summary>
              <pre className="mt-2 max-h-48 max-w-full overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-[10px] leading-4 text-slate-400 sm:max-w-2xl">{rawStack}</pre>
            </details>
          ) : null}
          {frame?.sourceLink ? (
            <a href={frame.sourceLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 no-underline hover:text-emerald-300">
              Open source <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

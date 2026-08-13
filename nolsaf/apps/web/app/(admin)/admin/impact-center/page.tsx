"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Bot, Bug, Building2, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ExternalLink, FileCode2, History, RefreshCw, Search, ServerCrash, ShieldCheck, Truck, UserRound, Users, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

type ImpactedUser = {
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
const pageSize = 8;

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
        : hostname.includes("staging") || hostname.includes("preview")
          ? "Staging"
          : "Production"
    ));
    load();
    const id = window.setInterval(() => load(true), 30000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [filter, query]);

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
        item.label,
        item.email,
        item.role,
        item.userId ? String(item.userId) : "",
        item.lastEvent?.message,
        item.lastEvent?.route,
        item.lastEvent?.path,
        item.lastEvent?.diagnostic?.primaryFrame?.file,
        item.lastEvent?.diagnostic?.fingerprint,
        ...item.routes,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [filter, items, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

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

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5">
        <div
          className="relative overflow-hidden rounded-2xl shadow-xl"
          style={{
            background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)",
            boxShadow: "0 18px 42px -18px rgba(2,102,94,0.50), 0 6px 18px -10px rgba(14,42,122,0.45)",
          }}
        >
          <div className="pointer-events-none absolute inset-0 opacity-60" aria-hidden>
            <div className="absolute -right-20 -top-24 h-56 w-56 rounded-full border border-white/10" />
            <div className="absolute -right-10 -top-14 h-40 w-40 rounded-full border border-white/10" />
            <div className="absolute -bottom-28 left-1/4 h-52 w-[38rem] rotate-[-10deg] rounded-[50%] border-t border-white/15" />
          </div>
          <div className="relative z-10 flex flex-col gap-4 px-5 py-4 sm:px-7 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <Link href="/admin/observability" className="inline-flex items-center gap-2 text-xs font-semibold text-white/60 no-underline transition-colors hover:text-white">
                <ArrowLeft className="h-3.5 w-3.5" />
                Observability
              </Link>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-black tracking-tight text-white">Technical Impact</h1>
                <span className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${summary.critical > 0 ? "border-red-300/40 bg-red-500/20 text-red-100" : "border-emerald-200/30 bg-white/10 text-emerald-100"}`}>
                  <span className={`h-2 w-2 rounded-full ${summary.critical > 0 ? "bg-red-300" : "bg-emerald-300"}`} />
                  {summary.critical > 0
                    ? `${summary.critical} unresolved critical`
                    : summary.attention > 0
                      ? `${summary.attention} active incident${summary.attention === 1 ? "" : "s"}`
                      : summary.people > 0
                        ? `${summary.people} unresolved`
                        : "No unresolved impact"}
                </span>
              </div>
              <p className="mt-1.5 max-w-3xl text-sm leading-5 text-white/65">
                Investigate errors and performance problems affecting customers and visitor sessions.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="text-right text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                <div className="text-white/75">{environment} · Open incidents</div>
                <div className="mt-1 normal-case tracking-normal">{lastUpdatedAt ? `Updated ${lastUpdatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Updating…"}</div>
              </div>
              <button
                type="button"
                onClick={() => load(true)}
                disabled={refreshing}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-sm transition-colors hover:bg-white/20 disabled:opacity-60"
                aria-label="Refresh technical impact"
                title="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
        </div>

        {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">{error}</div> : null}

        <div className="grid w-full min-w-0 max-w-full grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard icon={ServerCrash} label="Active incidents" value={summary.attention} note="Happening inside the active window" tone={summary.attention > 0 ? "red" : "green"} />
          <SummaryCard icon={UserRound} label="Unresolved users" value={summary.people} note="Open or awaiting recovery confirmation" tone="slate" />
          <SummaryCard icon={AlertTriangle} label="Critical impact" value={summary.critical} note="Users with server or client errors" tone={summary.critical > 0 ? "red" : "green"} />
          <SummaryCard icon={Clock3} label="Slow sessions" value={summary.slow} note="Users experiencing slow requests" tone={summary.slow > 0 ? "amber" : "green"} />
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600 shadow-sm">
          <span className="font-black uppercase tracking-[0.12em] text-slate-400">Breakdown</span>
          <span className="inline-flex items-center gap-1.5"><ServerCrash className="h-3.5 w-3.5 text-slate-400" /><strong className="text-slate-900">{summary.server}</strong> users with server errors</span>
          <span className="inline-flex items-center gap-1.5"><Bug className="h-3.5 w-3.5 text-slate-400" /><strong className="text-slate-900">{summary.client}</strong> users with frontend crashes</span>
          <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-slate-400" /><strong className="text-slate-900">{summary.known}</strong> known users</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-slate-400" /><strong className="text-slate-900">{summary.visitors}</strong> visitor sessions</span>
          {summary.restored > 0 ? <span className="ml-auto inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /><strong>{summary.restored}</strong> restored</span> : null}
        </div>

        <section className="w-full max-w-full min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-white/10 bg-gradient-to-br from-[#071b19] via-[#0a211f] to-[#0b202b] px-4 py-3.5 sm:px-5 lg:px-6">
            <div className="flex min-w-0 max-w-full flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <h2 className="text-sm font-black uppercase tracking-[0.16em] text-white/90">Impact review queue</h2>
                <p className="mt-1 text-xs font-medium text-white/45">
                  Showing {filtered.length ? (safePage - 1) * pageSize + 1 : 0}-{Math.min(safePage * pageSize, filtered.length)} of {filtered.length} affected users and sessions
                </p>
              </div>
              <div className="flex w-full min-w-0 max-w-2xl flex-col gap-2.5 sm:flex-row sm:items-center xl:justify-end">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search user or route"
                    className="box-border h-10 w-full min-w-0 rounded-lg border border-white/15 bg-white/[0.08] pl-9 pr-3 text-sm font-semibold text-white outline-none transition-colors placeholder:font-medium placeholder:text-white/45 focus:border-emerald-300/40 focus:bg-white/10 focus:ring-2 focus:ring-emerald-300/10"
                  />
                </div>
                <PaginationControls page={safePage} totalPages={totalPages} onPageChange={setPage} align="end" variant="dark" />
              </div>
            </div>
            <div className="mt-3 flex max-w-full flex-wrap gap-2 border-t border-white/10 pt-3">
              <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>All</FilterButton>
              <FilterButton active={filter === "attention"} onClick={() => setFilter("attention")}>
                Needs attention{summary.attention > 0 ? ` (${summary.attention})` : ""}
              </FilterButton>
              <FilterButton active={filter === "critical"} onClick={() => setFilter("critical")}>Critical</FilterButton>
              <FilterButton active={filter === "server"} onClick={() => setFilter("server")}>5xx</FilterButton>
              <FilterButton active={filter === "client"} onClick={() => setFilter("client")}>Client</FilterButton>
              <FilterButton active={filter === "slow"} onClick={() => setFilter("slow")}>Slow</FilterButton>
              <FilterButton active={filter === "known"} onClick={() => setFilter("known")}>Known users</FilterButton>
              <FilterButton active={filter === "visitors"} onClick={() => setFilter("visitors")}>Visitors</FilterButton>
              <FilterButton active={filter === "restored"} onClick={() => setFilter("restored")}>Restored</FilterButton>
            </div>
          </div>
          <div className="divide-y divide-slate-100">
            {paginated.map((item) => <ImpactPersonCard key={item.key} item={item} onRestore={() => setRestoreTarget(item)} />)}
            {loading ? <EmptyState label="Loading impacted users" /> : null}
            {!loading && filtered.length === 0 ? <EmptyState label="No impacted users match this view" /> : null}
          </div>
          {!loading && filtered.length > pageSize ? (
            <div className="border-t border-slate-100 px-5 py-4">
              <PaginationControls page={safePage} totalPages={totalPages} onPageChange={setPage} align="end" />
            </div>
          ) : null}
        </section>

      {restoreTarget ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/40 px-4 py-6 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="flex min-w-0 gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-black text-slate-950">Mark restored</h2>
                  <p className="mt-1 truncate text-sm text-slate-600">{restoreTarget.label}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                aria-label="Close restore dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-w-0 px-5 py-4">
              <label className="text-xs font-black uppercase tracking-wide text-slate-500" htmlFor="restore-note">
                Restoration note
              </label>
              <div className="mt-2 w-full overflow-hidden rounded-lg">
                <textarea
                  id="restore-note"
                  value={restoreNote}
                  onChange={(event) => setRestoreNote(event.target.value)}
                  placeholder="Example: Latency returned to normal after DB index fix."
                  className="block min-h-28 w-full max-w-full resize-y box-border rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium leading-6 text-slate-800 outline-none transition-colors placeholder:whitespace-normal placeholder:text-slate-400 focus:border-[#02665e]/40 focus:bg-white focus:ring-2 focus:ring-[#02665e]/10"
                  style={{ boxSizing: "border-box" }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">This creates an audit record and updates this item as restored.</p>
            </div>
            <div className="flex flex-col-reverse gap-2 bg-slate-50 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setRestoreTarget(null)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={markRestored}
                disabled={restoring}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-700 bg-emerald-700 px-4 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {restoring ? "Saving..." : "Mark Restored"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ImpactPersonCard({ item, onRestore }: { item: ImpactedUser; onRestore: () => void }) {
  const serverIssue = item.serverErrorCount > 0;
  const clientIssue = item.clientErrorCount > 0;
  const critical = serverIssue || clientIssue;
  const restored = item.resolution?.status === "restored";
  const severity = restored ? "Restored" : critical ? "Critical" : item.slowCount > 0 ? "Warning" : "Reviewed";
  const iconClass = restored ? "border-emerald-100 bg-emerald-50 text-emerald-700" : critical ? "border-red-100 bg-red-50 text-red-700" : item.slowCount > 0 ? "border-amber-100 bg-amber-50 text-amber-700" : "border-emerald-100 bg-emerald-50 text-emerald-700";
  const eventLabel = item.lastEvent?.message || item.lastEvent?.route || item.lastEvent?.path || item.lastEvent?.action || "Observed impact";
  const diagnostic = item.lastEvent?.diagnostic;

  return (
    <article className="px-4 py-4 sm:px-5">
      <div className="grid min-w-0 max-w-full gap-4 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
        <div className="flex min-w-0 gap-3">
          <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${iconClass}`}>
            {restored ? <CheckCircle2 className="h-5 w-5" /> : serverIssue ? <ServerCrash className="h-5 w-5" /> : clientIssue ? <Bug className="h-5 w-5" /> : <Clock3 className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="truncate text-[15px] font-bold leading-6 text-slate-950">{item.label}</h2>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] ${restored ? "border-emerald-200 bg-emerald-50 text-emerald-700" : critical ? "border-red-200 bg-red-50 text-red-700" : item.slowCount > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
                {severity}
              </span>
              {!restored && item.attention === "active" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                  Active
                </span>
              ) : null}
              {!restored && item.attention === "unconfirmed" ? (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-amber-700">
                  Recovery unconfirmed
                </span>
              ) : null}
              {item.role ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{item.role}</span> : null}
              {!item.userId ? <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">Visitor</span> : null}
              {item.userId ? <span className="font-mono text-xs text-slate-400">#{item.userId}</span> : null}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
              {item.email ? <span className="truncate">{item.email}</span> : null}
              {item.lastSeenAt ? <span>Last seen {formatTime(item.lastSeenAt)}</span> : null}
            </div>

            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5">
              <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Latest captured signal</div>
              <p className="mt-1 max-w-4xl break-words font-mono text-xs font-semibold leading-5 text-slate-800">{eventLabel}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                {item.lastEvent?.statusCode ? <span>Latest HTTP {item.lastEvent.statusCode}</span> : null}
                {item.lastEvent?.durationMs ? <span>{Math.round(item.lastEvent.durationMs)}ms</span> : null}
                {item.lastEvent?.requestId ? <span className="font-mono">req {item.lastEvent.requestId}</span> : null}
              </div>
            </div>
            {diagnostic ? <DiagnosticPanel diagnostic={diagnostic} rawStack={item.lastEvent?.stack} /> : null}
            <div className="mt-3">
              <div className="mb-1.5 text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Affected routes</div>
              <div className="flex flex-wrap gap-1.5">
              {item.routes.slice(0, 5).map((route) => (
                <span key={route} className="rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-[10px] text-slate-600">
                  {route}
                </span>
              ))}
              {item.routes.length > 5 ? <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">+{item.routes.length - 5} more</span> : null}
              </div>
            </div>
          </div>
        </div>

        <aside className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-400">Impact counts</span>
            <span className="text-[10px] font-semibold text-slate-400">{item.eventCount} captured</span>
          </div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <ImpactCount label="Events" value={item.eventCount} />
            <ImpactCount label="Slow" value={item.slowCount} tone={item.slowCount > 0 ? "amber" : "slate"} />
            <ImpactCount label="5xx" value={item.serverErrorCount} tone={item.serverErrorCount > 0 ? "red" : "slate"} />
            <ImpactCount label="Client" value={item.clientErrorCount} tone={item.clientErrorCount > 0 ? "red" : "slate"} />
          </div>
          {restored ? (
            <div className="mt-3 border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              <div className="flex flex-wrap items-center gap-2 font-black">
                <CheckCircle2 className="h-4 w-4" />
                Restored {item.resolution.restoredAt ? formatTime(item.resolution.restoredAt) : ""}
              </div>
              {item.resolution.restoredBy ? (
                <div className="mt-1 text-xs font-semibold text-emerald-800">
                  By {item.resolution.restoredBy.name || item.resolution.restoredBy.email || `Admin #${item.resolution.restoredBy.id}`}
                </div>
              ) : null}
              {item.resolution.note ? <p className="mt-2 leading-6 text-emerald-800">{item.resolution.note}</p> : null}
            </div>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2">
            {item.profile ? (
              <Link href={item.profile.href} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 no-underline shadow-sm hover:bg-slate-50">
                <ImpactProfileIcon kind={item.profile.kind} />
                {item.profile.label}
              </Link>
            ) : null}
            <Link href="/admin/observability" className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-900 bg-slate-900 px-3 text-xs font-bold text-white no-underline shadow-sm hover:bg-slate-800 ${item.profile ? "" : "col-span-2"}`}>
              <ShieldCheck className="h-3.5 w-3.5" />
              Investigate logs
            </Link>
            <Link href="/admin/management/audit-log" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 no-underline shadow-sm hover:bg-slate-50">
              <History className="h-3.5 w-3.5" />
              Audit trail
            </Link>
            {!restored ? (
              <button
                type="button"
                onClick={onRestore}
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-700 shadow-sm hover:bg-emerald-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Confirm restored
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </article>
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
  const location = frame
    ? `${frame.file}${frame.line ? `:${frame.line}` : ""}${frame.column ? `:${frame.column}` : ""}`
    : null;

  return (
    <div className="mt-3 overflow-hidden border border-slate-200 bg-slate-950 text-slate-100 shadow-sm">
      <div className="flex flex-col gap-2 border-b border-white/10 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
              {frame?.mapped ? "Exact source location" : "Generated source location"}
            </div>
            <div className="mt-0.5 truncate font-mono text-xs font-semibold text-slate-100" title={location || undefined}>
              {location || "No stack frame available"}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
          <span className="border border-white/10 bg-white/5 px-2 py-1 text-slate-300">{diagnostic.service}</span>
          {diagnostic.release ? <span className="border border-white/10 bg-white/5 px-2 py-1 text-slate-300">{diagnostic.release.slice(0, 12)}</span> : null}
          <span className="border border-white/10 bg-white/5 px-2 py-1 font-mono text-slate-400">{diagnostic.fingerprint}</span>
        </div>
      </div>

      {frame?.codeContext?.length ? (
        <div className="overflow-x-auto py-2 font-mono text-[11px] leading-5">
          {frame.codeContext.map((codeLine) => (
            <div
              key={codeLine.line}
              className={`grid min-w-max grid-cols-[3.5rem_minmax(36rem,1fr)] px-3 ${codeLine.highlight ? "bg-rose-500/15 text-rose-100" : "text-slate-300"}`}
            >
              <span className={`select-none pr-3 text-right ${codeLine.highlight ? "font-black text-rose-300" : "text-slate-600"}`}>{codeLine.line}</span>
              <code className="whitespace-pre">{codeLine.content || " "}</code>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2 text-xs text-slate-400">
          {frame?.mapped
            ? "Source identified; nearby code is unavailable in this release artifact."
            : "Private source map not available for this release. The generated line is retained for correlation."}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-2">
        <div className="text-[10px] font-semibold text-slate-500">
          {frame?.functionName ? `Function: ${frame.functionName}` : `${diagnostic.frames.length} captured frame${diagnostic.frames.length === 1 ? "" : "s"}`}
        </div>
        <div className="flex items-center gap-2">
          {rawStack ? (
            <details className="relative">
              <summary className="cursor-pointer list-none text-[11px] font-bold text-slate-300 hover:text-white">Stack trace</summary>
              <pre className="mt-2 max-h-48 max-w-full overflow-auto whitespace-pre-wrap border border-white/10 bg-black/30 p-2 text-[10px] leading-4 text-slate-400 sm:max-w-2xl">{rawStack}</pre>
            </details>
          ) : null}
          {frame?.sourceLink ? (
            <a
              href={frame.sourceLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 no-underline hover:text-emerald-300"
            >
              Open source <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, note, tone }: { icon: typeof UserRound; label: string; value: number; note: string; tone: "slate" | "red" | "green" | "amber" }) {
  const classes = {
    slate: {
      card: "border-slate-200 bg-white",
      icon: "border-slate-200 bg-slate-50 text-slate-700",
      value: "text-slate-950",
      label: "text-slate-500",
    },
    red: {
      card: "border-red-100 bg-white",
      icon: "border-red-100 bg-red-50 text-red-700",
      value: "text-red-900",
      label: "text-red-700",
    },
    green: {
      card: "border-emerald-100 bg-white",
      icon: "border-emerald-100 bg-emerald-50 text-emerald-700",
      value: "text-emerald-900",
      label: "text-emerald-700",
    },
    amber: {
      card: "border-amber-100 bg-white",
      icon: "border-amber-100 bg-amber-50 text-amber-700",
      value: "text-amber-900",
      label: "text-amber-700",
    },
  }[tone];
  return (
    <div className={`group min-w-0 rounded-xl border p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md ${classes.card}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className={`text-[11px] font-bold uppercase leading-5 tracking-[0.14em] ${classes.label}`}>{label}</div>
          <div className={`mt-1 text-2xl font-black tracking-tight ${classes.value}`}>{value}</div>
          <div className="mt-1 text-[11px] font-medium leading-4 text-slate-400">{note}</div>
        </div>
        <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border shadow-sm transition-transform duration-300 group-hover:scale-105 ${classes.icon}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-8 items-center justify-center rounded-full border px-3 text-xs font-bold transition-all sm:px-3.5 ${
        active
          ? "border-emerald-300/45 bg-emerald-500/20 text-emerald-100 shadow-sm shadow-emerald-950/20"
          : "border-white/10 bg-white/[0.04] text-white/60 hover:border-white/20 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function PaginationControls({
  page,
  totalPages,
  onPageChange,
  align = "start",
  variant = "light",
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  align?: "start" | "end";
  variant?: "light" | "dark";
}) {
  const dark = variant === "dark";
  const buttonClass = dark
    ? "border-white/15 bg-white/[0.08] text-white/70 hover:border-white/25 hover:bg-white/15 disabled:text-white/25"
    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:text-slate-300";
  const pageClass = dark
    ? "border-white/15 bg-white/[0.08] text-white/80"
    : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className={`flex shrink-0 items-center gap-2 ${align === "end" ? "justify-end" : ""}`}>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-colors disabled:cursor-not-allowed ${buttonClass}`}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className={`min-w-20 rounded-full border px-3 py-2 text-center text-xs font-black tracking-wide ${pageClass}`}>
        {page} / {totalPages}
      </div>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition-colors disabled:cursor-not-allowed ${buttonClass}`}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function ImpactCount({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "amber" | "red" }) {
  const valueClass = tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-2 py-2">
      <div className={`text-base font-black ${valueClass}`}>{value}</div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="px-4 py-12 text-center text-sm font-medium text-slate-500">{label}</div>;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

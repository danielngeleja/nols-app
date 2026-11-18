"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CreditCard,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Siren,
  Truck,
  UserCheck,
  UserPlus,
  X,
  type LucideIcon,
  KeyRound,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

type ActionItem = {
  id: string;
  category: string;
  severity: Severity;
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
  workflow?: {
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
};

type Payload = {
  observationMode: boolean;
  workflowMode: boolean;
  generatedAt: string;
  filteredTotal: number;
  pagination: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
  summary: {
    total: number;
    critical: number;
    high: number;
    overdue: number;
    responseBreached: number;
    resolutionBreached: number;
    unassigned: number;
    acknowledged: number;
    resolved: number;
    exposureByCurrency: Record<string, number>;
    byCategory: Record<string, number>;
  };
  items: ActionItem[];
};

const EMPTY: Payload = {
  observationMode: true,
  workflowMode: false,
  generatedAt: "",
  filteredTotal: 0,
  pagination: { page: 1, perPage: 10, total: 0, totalPages: 1 },
  summary: { total: 0, critical: 0, high: 0, overdue: 0, responseBreached: 0, resolutionBreached: 0, unassigned: 0, acknowledged: 0, resolved: 0, exposureByCurrency: {}, byCategory: {} },
  items: [],
};

const categoryDetails: Record<string, { label: string; Icon: LucideIcon }> = {
  ALL: { label: "All work", Icon: Siren },
  PAYMENTS: { label: "Payments", Icon: CreditCard },
  TRANSPORT: { label: "Transport", Icon: Truck },
  CANCELLATIONS: { label: "Cancellations", Icon: CalendarClock },
  APPROVALS: { label: "Approvals", Icon: Building2 },
  LIFECYCLE: { label: "Lifecycle", Icon: Activity },
  NRMS: { label: "NRMS", Icon: ShieldCheck },
  BOOKINGS: { label: "Bookings", Icon: KeyRound },
};

const severityStyle: Record<Severity, string> = {
  CRITICAL: "border-red-200 bg-red-50 text-red-800",
  HIGH: "border-amber-200 bg-amber-50 text-amber-800",
  MEDIUM: "border-blue-200 bg-blue-50 text-blue-800",
  LOW: "border-slate-200 bg-slate-50 text-slate-700",
};

function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-TZ", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "TZS" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency || "TZS"} ${amount.toLocaleString("en-TZ")}`;
  }
}

function formatAge(value: string, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m old`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h old`;
  return `${Math.floor(hours / 24)}d old`;
}

function dueLabel(value: string | null, now = Date.now()) {
  if (!value) return { label: "No deadline", overdue: false };
  const difference = new Date(value).getTime() - now;
  const absoluteMinutes = Math.max(1, Math.floor(Math.abs(difference) / 60000));
  const duration = absoluteMinutes < 60
    ? `${absoluteMinutes}m`
    : absoluteMinutes < 1440
      ? `${Math.floor(absoluteMinutes / 60)}h`
      : `${Math.floor(absoluteMinutes / 1440)}d`;
  return difference < 0
    ? { label: `${duration} overdue`, overdue: true }
    : { label: `Due in ${duration}`, overdue: false };
}

type WorkflowAction = "CLAIM" | "ACKNOWLEDGE" | "REOPEN";

export default function AdminActionCenterPage() {
  const [data, setData] = useState<Payload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("ALL");
  const [severity, setSeverity] = useState("ALL");
  const [status, setStatus] = useState("ACTIVE");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [actionBusy, setActionBusy] = useState<number | null>(null);
  const [resolveTarget, setResolveTarget] = useState<ActionItem | null>(null);
  const [resolutionNote, setResolutionNote] = useState("");
  const [page, setPage] = useState(1);
  const perPage = 10;

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<Payload>("/api/admin/action-center", {
        params: {
          category,
          severity,
          status,
          page,
          perPage,
          q: appliedQuery || undefined,
        },
      });
      const payload = response.data;
      setData({
        ...payload,
        pagination: payload.pagination || {
          page: 1,
          perPage,
          total: payload.filteredTotal || payload.items.length,
          totalPages: Math.max(1, Math.ceil((payload.filteredTotal || payload.items.length) / perPage)),
        },
      });
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.message || "Unable to load operational work");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [appliedQuery, category, page, severity, status]);

  useEffect(() => { void load(); }, [load]);

  const totalExposure = useMemo(() => {
    const entries = Object.entries(data.summary.exposureByCurrency);
    if (!entries.length) return "TZS 0";
    if (entries.length === 1) return formatMoney(entries[0][1], entries[0][0]);
    return entries.map(([currency, amount]) => formatMoney(amount, currency)).join(" + ");
  }, [data.summary.exposureByCurrency]);

  const categories = useMemo(() => {
    const available = Object.keys(data.summary.byCategory);
    return ["ALL", ...Object.keys(categoryDetails).filter((key) => key !== "ALL" && available.includes(key))];
  }, [data.summary.byCategory]);

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
  }

  function clearFilters() {
    setCategory("ALL");
    setSeverity("ALL");
    setStatus("ACTIVE");
    setQuery("");
    setAppliedQuery("");
    setPage(1);
  }

  // One sentence that says how the queue stands, from the live summary.
  const pressure = useMemo(() => {
    const sm = data.summary;
    const rest = Math.max(0, sm.total - sm.critical - sm.high);
    if (loading) return { verdict: "Reading the queue…", tone: "calm" as const, rest };
    if (!sm.total) return { verdict: "Nothing waits on the team. Every deadline is clear.", tone: "calm" as const, rest };
    const parts: string[] = [];
    if (sm.responseBreached) parts.push(`${sm.responseBreached} past the response deadline`);
    if (sm.resolutionBreached) parts.push(`${sm.resolutionBreached} past the resolution target`);
    if (sm.unassigned) parts.push(`${sm.unassigned} without an owner`);
    const lead = `${sm.total} ${sm.total === 1 ? "item is" : "items are"} active`;
    const verdict = parts.length ? `${lead}: ${parts.join(", ")}.` : `${lead}, all inside their deadlines.`;
    const tone = sm.responseBreached || sm.critical ? ("hot" as const) : sm.resolutionBreached || sm.high ? ("warn" as const) : ("calm" as const);
    return { verdict, tone, rest };
  }, [data.summary, loading]);

  type Tile = { label: string; value: string | number; note: string; Icon: LucideIcon; hot: boolean; hotText: string; hotDot: string; filter?: { kind: "severity" | "status"; value: string; shows: string } };
  const sm = data.summary;
  const pressureTiles: Tile[] = [
    { label: "Critical", value: sm.critical, note: "Highest impact first", Icon: AlertTriangle, hot: sm.critical > 0, hotText: "text-rose-300", hotDot: "bg-rose-400", filter: { kind: "severity", value: "CRITICAL", shows: "critical work" } },
    { label: "High", value: sm.high, note: "Next in line", Icon: Siren, hot: sm.high > 0, hotText: "text-amber-300", hotDot: "bg-amber-300", filter: { kind: "severity", value: "HIGH", shows: "high-priority work" } },
    { label: "Response overdue", value: sm.responseBreached, note: "Not acknowledged in time", Icon: Clock3, hot: sm.responseBreached > 0, hotText: "text-rose-300", hotDot: "bg-rose-400", filter: { kind: "status", value: "OPEN", shows: "work not yet acknowledged" } },
    { label: "Resolution overdue", value: sm.resolutionBreached, note: "Beyond the target", Icon: CalendarClock, hot: sm.resolutionBreached > 0, hotText: "text-amber-300", hotDot: "bg-amber-300", filter: { kind: "severity", value: "OVERDUE", shows: "work past its resolution target" } },
    { label: "Without owner", value: sm.unassigned, note: "Take ownership in the list", Icon: UserPlus, hot: sm.unassigned > 0, hotText: "text-amber-300", hotDot: "bg-amber-300" },
    { label: "Money at risk", value: totalExposure, note: `${sm.acknowledged} acknowledged`, Icon: CircleDollarSign, hot: false, hotText: "", hotDot: "" },
  ];
  // The top-ranked item, only when the whole active queue is in view.
  const startHere = !loading && page === 1 && category === "ALL" && severity === "ALL" && status === "ACTIVE" && !appliedQuery ? data.items[0] ?? null : null;

  const filtersActive = category !== "ALL" || severity !== "ALL" || status !== "ACTIVE" || Boolean(appliedQuery);

  async function updateWorkflow(item: ActionItem, action: "CLAIM" | "ACKNOWLEDGE" | "RESOLVE" | "REOPEN", note?: string) {
    if (!item.workflow) return;
    setActionBusy(item.workflow.id);
    setError("");
    try {
      await apiClient.patch(`/api/admin/action-center/work-items/${item.workflow.id}`, { action, note });
      setResolveTarget(null);
      setResolutionNote("");
      await load(true);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.message || "Unable to update the SLA workflow");
    } finally {
      setActionBusy(null);
    }
  }

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Command band: verdict, the one item to start with, and a pressure strip that filters the queue */}
      <section className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white" aria-label="Action Center status">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.18)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xl font-bold tracking-tight text-white">
                Action Center
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-200/60">
                  <span className={`h-1.5 w-1.5 rounded-full ${pressure.tone === "calm" ? "bg-emerald-300" : pressure.tone === "warn" ? "bg-amber-300" : "bg-rose-400 animate-pulse"}`} aria-hidden />
                  SLA tracked
                </span>
              </h1>
              <p className="m-0 mt-1 text-[13px] leading-5 text-emerald-50/70">{pressure.verdict}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {data.generatedAt ? (
                <span className="hidden text-[11px] tabular-nums text-emerald-100/45 sm:inline">
                  {new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT
                </span>
              ) : null}
              <Link href="/admin/impact-center" className="inline-flex h-8 items-center gap-1 rounded-md border border-solid border-white/10 bg-white/[0.06] px-2.5 text-xs font-semibold text-emerald-50/80 no-underline transition hover:bg-white/[0.12] hover:text-white hover:no-underline">
                Technical impact <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={() => void load(true)}
                aria-disabled={refreshing}
                className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-solid border-white/10 bg-white/[0.06] text-white transition hover:bg-white/[0.12]"
                aria-label="Refresh action center"
                title="Refresh"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          {/* Pressure strip: one joined row; each cell filters the queue, click again to clear */}
          <div className="mt-3 overflow-hidden rounded-md ring-1 ring-white/10">
            <div className="grid grid-cols-3 gap-px bg-white/10 lg:grid-cols-6">
              {pressureTiles.map((t) => {
                const on = t.filter ? (t.filter.kind === "severity" ? severity === t.filter.value : status === t.filter.value) : false;
                const Icon = t.Icon;
                const body = (
                  <>
                    <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-emerald-50/55">
                      <Icon className={`h-3.5 w-3.5 shrink-0 ${t.hot ? t.hotText : "text-emerald-200/40"}`} aria-hidden />
                      <span className="truncate">{t.label}</span>
                    </span>
                    <span className={`mt-1 block truncate font-bold tabular-nums leading-none ${typeof t.value === "string" && t.value.length > 8 ? "text-[15px]" : "text-lg"} ${t.hot ? t.hotText || "text-white" : "text-white/80"}`}>{loading ? "..." : t.value}</span>
                  </>
                );
                const base = `flex min-w-0 flex-col px-3 py-2 text-left transition ${on ? "bg-[#174a42]" : "bg-[#0d2a25]"}`;
                return t.filter ? (
                  <button
                    key={t.label}
                    type="button"
                    aria-pressed={on}
                    title={on ? "Show all work again" : `${t.note}. Show ${t.filter.shows}`}
                    onClick={() => {
                      const f = t.filter!;
                      if (f.kind === "severity") setSeverity(on ? "ALL" : f.value);
                      else setStatus(on ? "ACTIVE" : f.value);
                      setPage(1);
                    }}
                    className={`${base} w-full cursor-pointer appearance-none border-0 hover:bg-[#113430]`}
                  >
                    {body}
                  </button>
                ) : (
                  <div key={t.label} className={base} title={t.note}>{body}</div>
                );
              })}
            </div>
            {/* Urgency mix of active work, as the strip's bottom edge */}
            {!loading && data.summary.total > 0 ? (
              <div className="flex h-1 w-full bg-white/[0.06]" role="img" aria-label={`Urgency mix: ${data.summary.critical} critical, ${data.summary.high} high, ${pressure.rest} medium or low`}>
                <span className="h-full bg-rose-400" style={{ width: `${(data.summary.critical / data.summary.total) * 100}%` }} />
                <span className="h-full bg-amber-300" style={{ width: `${(data.summary.high / data.summary.total) * 100}%` }} />
                <span className="h-full bg-emerald-300/50" style={{ width: `${(pressure.rest / data.summary.total) * 100}%` }} />
              </div>
            ) : null}
          </div>

          {/* Start here: the queue's top-ranked item, when looking at the whole queue */}
          {startHere ? (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-white/[0.04] px-3 py-2 ring-1 ring-inset ring-white/10">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200/50">Start here</span>
              <span className={`rounded-sm px-1.5 py-0.5 text-[10px] font-bold ${startHere.severity === "CRITICAL" ? "bg-rose-400/15 text-rose-200" : startHere.severity === "HIGH" ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-emerald-50/70"}`}>{startHere.severity.charAt(0) + startHere.severity.slice(1).toLowerCase()}</span>
              <span className="min-w-0 flex-1 truncate text-[13px]">
                <span className="font-semibold text-white">{startHere.title}</span>
                <span className="text-emerald-100/45"> · {startHere.subject}</span>
              </span>
              {(() => {
                const due = dueLabel(startHere.workflow?.resolutionDueAt ?? startHere.dueAt);
                return <span className={`text-[11px] font-semibold tabular-nums ${due.overdue ? "text-rose-300" : "text-emerald-100/60"}`}>{due.label}</span>;
              })()}
              <Link href={startHere.detailHref} className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-300 px-2.5 text-[12px] font-bold text-emerald-950 no-underline hover:bg-emerald-200 hover:no-underline">
                {startHere.actionLabel || "Open"} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700">Retry</button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        {/* Category tabs: underline style, scroll sideways on small screens */}
        <nav className="scrollbar-hide flex min-w-0 items-stretch gap-1 overflow-x-auto overscroll-x-contain border-0 border-b border-solid border-slate-200 px-2 sm:px-3" aria-label="Action categories">
          {categories.map((key) => {
            const detail = categoryDetails[key] || { label: key, Icon: Activity };
            const count = key === "ALL" ? data.summary.total : data.summary.byCategory[key] || 0;
            const active = category === key;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => { setCategory(key); setPage(1); }}
                className={`relative inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-0 bg-transparent px-2.5 text-[13px] font-semibold transition ${active ? "text-[#02665e]" : count ? "text-slate-600 hover:text-slate-900" : "text-slate-400 hover:text-slate-600"}`}
              >
                <detail.Icon className="h-3.5 w-3.5" aria-hidden />
                {detail.label}
                <span className={`rounded-sm px-1 text-[11px] tabular-nums ${active ? "bg-[#02665e] text-white" : count ? "bg-slate-100 text-slate-600" : "text-slate-300"}`}>{count}</span>
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[#02665e]" aria-hidden />}
              </button>
            );
          })}
        </nav>

        {/* One-line toolbar: search first, then the two filters */}
        <form onSubmit={applySearch} className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-slate-100 bg-slate-50/70 px-3 py-2.5 sm:px-4">
          <label className="relative min-w-[200px] flex-1">
            <span className="sr-only">Search action items</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search person, booking or property, then Enter"
              className="box-border h-9 w-full rounded-md border border-solid border-slate-200 bg-white pl-8 pr-3 text-[13px] outline-none placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
            />
          </label>
          <select
            value={severity}
            onChange={(event) => { setSeverity(event.target.value); setPage(1); }}
            className={`h-9 cursor-pointer rounded-md border border-solid px-2.5 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#02665e]/10 ${severity !== "ALL" ? "border-[#02665e] bg-emerald-50 text-[#02665e]" : "border-slate-200 bg-white text-slate-700"}`}
            aria-label="Filter by urgency"
          >
            <option value="ALL">Any urgency</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="OVERDUE">Overdue</option>
          </select>
          <select
            value={status}
            onChange={(event) => { setStatus(event.target.value); setPage(1); }}
            className={`h-9 cursor-pointer rounded-md border border-solid px-2.5 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-[#02665e]/10 ${status !== "ACTIVE" ? "border-[#02665e] bg-emerald-50 text-[#02665e]" : "border-slate-200 bg-white text-slate-700"}`}
            aria-label="Filter by SLA status"
          >
            <option value="ACTIVE">Active SLA</option>
            <option value="OPEN">Unacknowledged</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All SLA states</option>
          </select>
          <button type="submit" className="h-9 cursor-pointer rounded-md border-0 bg-[#02665e] px-3 text-xs font-semibold text-white transition hover:bg-[#014d47]">Search</button>
          {filtersActive ? (
            <button type="button" onClick={clearFilters} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-2 text-xs font-semibold text-slate-500 hover:text-slate-900">
              <X className="h-3.5 w-3.5" aria-hidden /> Clear
            </button>
          ) : null}
          <span className="ml-auto text-[11px] text-slate-500">
            {loading ? "Loading..." : data.pagination.total > 0 ? (
              <><span className="font-semibold text-slate-900">{data.pagination.total}</span> in view, most urgent first</>
            ) : "Nothing matches"}
          </span>
        </form>

        {loading ? (
          <div className="space-y-1.5 p-3">
            {Array.from({ length: 6 }).map((_, value) => <div key={value} className="h-14 animate-pulse rounded-md bg-slate-100" />)}
          </div>
        ) : data.items.length ? (
          <>
            {(() => {
              // Triage list: work is banded by how late it is, each row leads with its clock,
              // shows where it sits on the owner > acknowledged > resolved track, and offers the next step.
              type Band = "MONTH" | "LATE" | "SOON" | "TRACK" | "NONE" | "DONE";
              const BAND: Record<Band, { label: string; dot: string; text: string }> = {
                MONTH: { label: "Over a month late", dot: "bg-rose-500", text: "text-rose-700" },
                LATE: { label: "Late", dot: "bg-rose-400", text: "text-rose-600" },
                SOON: { label: "Due soon", dot: "bg-amber-400", text: "text-amber-700" },
                TRACK: { label: "On track", dot: "bg-emerald-500", text: "text-emerald-700" },
                NONE: { label: "No deadline", dot: "bg-slate-300", text: "text-slate-500" },
                DONE: { label: "Resolved", dot: "bg-emerald-500", text: "text-emerald-700" },
              };
              const ORDER: Band[] = ["MONTH", "LATE", "SOON", "TRACK", "NONE", "DONE"];
              const now = Date.now();
              const rows = data.items.map((item) => {
                const categoryDetail = categoryDetails[item.category] || { label: item.category, Icon: Activity };
                const wf = item.workflow;
                const dueAt = wf?.resolutionDueAt || item.dueAt || null;
                const due = dueLabel(dueAt, now);
                const used = wf
                  ? Math.min(1, Math.max(0, (now - new Date(wf.openedAt).getTime()) / Math.max(1, new Date(wf.resolutionDueAt).getTime() - new Date(wf.openedAt).getTime())))
                  : null;
                const lateMs = dueAt ? now - new Date(dueAt).getTime() : 0;
                const band: Band = wf?.resolvedAt ? "DONE"
                  : !dueAt ? "NONE"
                  : lateMs > 30 * 86_400_000 ? "MONTH"
                  : lateMs > 0 ? "LATE"
                  : (used != null && used > 0.75) || -lateMs < 86_400_000 ? "SOON"
                  : "TRACK";
                const owner = wf?.assignedTo?.name || wf?.assignedTo?.email || null;
                const steps = [
                  { key: "owner", label: owner ? owner.split(/\s+/)[0] : "Owner", done: Boolean(owner) },
                  { key: "ack", label: "Acknowledged", done: Boolean(wf?.acknowledgedAt) },
                  { key: "res", label: "Resolved", done: Boolean(wf?.resolvedAt) },
                ];
                const next: { label: string; run: () => void } | null = !wf ? null
                  : wf.resolvedAt ? { label: "Reopen", run: () => void updateWorkflow(item, "REOPEN") }
                  : !owner ? { label: "Take it", run: () => void updateWorkflow(item, "CLAIM") }
                  : wf.status === "OPEN" ? { label: "Acknowledge", run: () => void updateWorkflow(item, "ACKNOWLEDGE") }
                  : { label: "Resolve", run: () => { setResolveTarget(item); setResolutionNote(""); } };
                const nextHint = !wf ? "No SLA attached"
                  : wf.resolvedAt ? "Closed"
                  : !owner ? "Needs an owner"
                  : !wf.acknowledgedAt ? (wf.responseBreached ? "Response missed" : "Waiting for acknowledgement")
                  : "Being worked";
                return { item, categoryDetail, wf, due, band, steps, next, nextHint, busy: actionBusy === wf?.id };
              });
              const groups = ORDER.map((b) => ({ band: b, rows: rows.filter((r) => r.band === b) })).filter((g) => g.rows.length);
              const clockTone = (b: Band) =>
                b === "MONTH" || b === "LATE" ? "bg-rose-50 text-rose-700 ring-rose-100"
                : b === "SOON" ? "bg-amber-50 text-amber-800 ring-amber-100"
                : b === "DONE" ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                : "bg-slate-50 text-slate-700 ring-slate-200";
              return (
                <ol className="m-0 list-none p-0">
                  {groups.map((g) => (
                    <li key={g.band}>
                      <p className="m-0 flex items-center gap-2 border-0 border-b border-solid border-slate-100 bg-slate-50/80 px-4 py-1.5 text-[11px] font-bold">
                        <span className={`h-1.5 w-1.5 rounded-full ${BAND[g.band].dot}`} aria-hidden />
                        <span className={BAND[g.band].text}>{BAND[g.band].label}</span>
                        <span className="font-semibold text-slate-400">{g.rows.length}</span>
                      </p>
                      <ol className="m-0 list-none p-0">
                        {g.rows.map((r) => {
                          const late = r.band === "MONTH" || r.band === "LATE";
                          const currentIndex = r.steps.findIndex((s) => !s.done);
                          const clockNumber = r.band === "DONE" ? "" : r.band === "NONE" ? "--" : r.due.label.replace(" overdue", "").replace("Due in ", "");
                          return (
                            <li key={r.item.id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-2.5 border-0 border-b border-solid border-slate-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-slate-50/60 lg:grid-cols-[60px_minmax(0,1fr)_220px_auto] lg:items-center lg:gap-x-5">
                              {/* Clock block */}
                              <div className={`flex h-14 flex-col items-center justify-center rounded-md ring-1 ring-inset ${clockTone(r.band)}`} title={r.due.label}>
                                {r.band === "DONE" ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <span className="text-[17px] font-bold tabular-nums leading-none">{clockNumber}</span>}
                                <span className="mt-1 text-[9px] font-bold uppercase tracking-[0.12em] opacity-80">{r.band === "DONE" ? "Done" : r.band === "NONE" ? "Open" : late ? "Late" : "Left"}</span>
                              </div>

                              {/* What it is */}
                              <div className="min-w-0">
                                <p className="m-0 flex min-w-0 items-center gap-2">
                                  <span className={`shrink-0 rounded-sm border border-solid px-1 text-[10px] font-bold ${severityStyle[r.item.severity]}`}>{r.item.severity.charAt(0) + r.item.severity.slice(1).toLowerCase()}</span>
                                  <Link href={r.item.detailHref} className="min-w-0 truncate text-[14px] font-semibold text-slate-950 no-underline hover:text-[#02665e] hover:no-underline" title={r.item.title}>{r.item.title}</Link>
                                </p>
                                <p className="m-0 mt-0.5 truncate text-[12px] text-slate-500" title={[r.item.subject, r.item.summary].filter(Boolean).join(" · ")}>
                                  <span className="font-medium text-slate-700">{r.item.subject}</span>{r.item.summary ? <span> · {r.item.summary}</span> : null}
                                </p>
                                <p className="m-0 mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400">
                                  <span className="inline-flex items-center gap-1"><r.categoryDetail.Icon className="h-3 w-3" aria-hidden />{r.categoryDetail.label}</span>
                                  <span>opened {formatAge(r.item.createdAt).replace(" old", " ago")}</span>
                                  {r.item.exposure ? (
                                    <span className="font-semibold text-slate-700">{formatMoney(r.item.exposure.amount, r.item.exposure.currency)} {r.item.metadata?.payoutVerified === true ? "owner payout" : "at stake"}</span>
                                  ) : null}
                                </p>
                              </div>

                              {/* Stage track: owner > acknowledged > resolved */}
                              <div className="col-span-2 min-w-0 lg:col-span-1">
                                <p className={`m-0 text-[11px] font-semibold ${r.nextHint === "Response missed" || (late && currentIndex === 0) ? "text-rose-600" : currentIndex === -1 ? "text-emerald-700" : "text-slate-600"}`}>{r.nextHint}</p>
                                {r.wf ? (
                                  <>
                                    <span className="mt-1.5 flex gap-1" aria-hidden>
                                      {r.steps.map((s, i) => (
                                        <span key={s.key} className={`h-1.5 flex-1 rounded-full ${s.done ? "bg-[#02665e]" : i === currentIndex ? (late ? "animate-pulse bg-rose-400" : "bg-amber-400") : "bg-slate-200"}`} />
                                      ))}
                                    </span>
                                    <span className="mt-1 grid grid-cols-3 gap-1 text-[10px]">
                                      {r.steps.map((s, i) => (
                                        <span key={s.key} className={`truncate ${s.done ? "font-semibold text-[#02665e]" : i === currentIndex ? "font-semibold text-slate-700" : "text-slate-400"}`}>{s.label}</span>
                                      ))}
                                    </span>
                                  </>
                                ) : null}
                              </div>

                              {/* Next step, then the case itself */}
                              <div className={`col-span-2 flex items-center justify-end gap-1.5 lg:col-span-1 ${r.busy ? "pointer-events-none opacity-50" : ""}`} aria-busy={r.busy}>
                                {r.next ? (
                                  <button type="button" onClick={r.next.run} className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border-0 px-3 text-xs font-semibold transition ${r.next.label === "Reopen" ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-[#02665e] text-white hover:bg-[#014d47]"}`}>
                                    {r.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}{r.next.label}
                                  </button>
                                ) : null}
                                <Link href={r.item.detailHref} title="Open the case" className="inline-flex h-8 max-w-[180px] items-center gap-1 rounded-md border border-solid border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 no-underline transition hover:border-[#02665e] hover:text-[#02665e] hover:no-underline">
                                  <span className="truncate">{r.item.actionLabel || "Open"}</span> <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                </Link>
                              </div>
                            </li>
                          );
                        })}
                      </ol>
                    </li>
                  ))}
                </ol>
              );
            })()}

            {data.pagination.totalPages > 1 ? (
              <nav className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-slate-100 px-3 py-2.5 sm:px-4" aria-label="Action pages">
                <span className="text-[11px] text-slate-500">
                  Showing <span className="font-semibold text-slate-800">{(data.pagination.page - 1) * data.pagination.perPage + 1} to {Math.min(data.pagination.page * data.pagination.perPage, data.pagination.total)}</span> of {data.pagination.total}
                </span>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={data.pagination.page <= 1 || loading} aria-label="Previous page" className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 disabled:cursor-default disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  {(() => {
                    const total = data.pagination.totalPages;
                    const current = data.pagination.page;
                    const pages = Array.from(new Set([1, current - 1, current, current + 1, total])).filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
                    return pages.map((n, i) => (
                      <span key={n} className="flex items-center gap-1">
                        {i > 0 && n - pages[i - 1] > 1 ? <span className="px-0.5 text-xs text-slate-400">...</span> : null}
                        <button type="button" onClick={() => setPage(n)} aria-current={n === current ? "page" : undefined} className={`h-8 min-w-8 cursor-pointer rounded-md border border-solid px-2 text-xs font-semibold tabular-nums transition ${n === current ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{n}</button>
                      </span>
                    ));
                  })()}
                  <button type="button" onClick={() => setPage((current) => Math.min(data.pagination.totalPages, current + 1))} disabled={data.pagination.page >= data.pagination.totalPages || loading} aria-label="Next page" className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 disabled:cursor-default disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </span>
              </nav>
            ) : null}
          </>
        ) : (
          <div className="flex min-h-44 flex-col items-center justify-center px-6 py-8 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden /></span>
            <h2 className="m-0 mt-3 text-sm font-bold text-slate-900">No matching operational work</h2>
            <p className="m-0 mt-1 max-w-md text-xs leading-5 text-slate-500">This queue is clear. Change the filters to look at other work.</p>
            {filtersActive ? <button type="button" onClick={clearFilters} className="mt-3 cursor-pointer rounded-md border border-solid border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">Clear filters</button> : null}
          </div>
        )}
      </section>

      <p className="m-0 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] leading-5 text-slate-500">
        <span>Ownership, acknowledgement and resolution are recorded and audited here. The booking, payment, driver, property or NRMS record itself only changes in its own workflow.</span>
        <Link href="/admin/lifecycle-health" className="inline-flex shrink-0 items-center gap-1 font-semibold text-[#02665e] no-underline hover:underline">Lifecycle detail <ChevronRight className="h-3.5 w-3.5" aria-hidden /></Link>
      </p>

      {resolveTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-4" role="dialog" aria-modal="true" aria-labelledby="resolve-sla-title">
          <div className="box-border max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 id="resolve-sla-title" className="text-lg font-black text-slate-950">Confirm SLA resolution</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">Confirm that the authoritative workflow was handled. This records SLA evidence but does not modify the source record.</p>
              </div>
              <button type="button" onClick={() => setResolveTarget(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Close resolution dialog"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-4 min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="break-words text-xs font-black text-slate-900">{resolveTarget.title}</p>
              <p className="mt-1 break-words text-xs text-slate-500">{resolveTarget.subject}</p>
            </div>
            <label className="mt-4 block">
              <span className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">Resolution note</span>
              <textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} rows={4} maxLength={1000} placeholder="What was completed, verified, or corrected?" className="mt-2 box-border w-full max-w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10" />
            </label>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setResolveTarget(null)} className="box-border h-10 w-full rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 hover:bg-slate-50 sm:w-auto">Cancel</button>
              <button type="button" disabled={resolutionNote.trim().length < 5 || actionBusy === resolveTarget.workflow?.id} onClick={() => void updateWorkflow(resolveTarget, "RESOLVE", resolutionNote.trim())} className="box-border inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#02665e] px-4 text-xs font-bold text-white hover:bg-[#01544d] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto">
                <CheckCircle2 className="h-4 w-4" /> Record resolution
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

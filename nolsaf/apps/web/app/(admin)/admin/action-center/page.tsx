"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
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

function WorkflowActionButtons({ item, busy, onUpdate, onResolve }: {
  item: ActionItem;
  busy: boolean;
  onUpdate: (item: ActionItem, action: WorkflowAction) => void;
  onResolve: (item: ActionItem) => void;
}) {
  const wf = item.workflow;
  const ghost = "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-slate-500 transition hover:bg-white hover:text-slate-900 hover:shadow-sm";
  return (
    <div className="flex items-center gap-1.5">
      <Link
        href={item.detailHref}
        className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#02665e] px-3 text-xs font-semibold text-white no-underline transition hover:bg-[#01544d] hover:no-underline"
        title={item.actionLabel}
      >
        Open <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
      {wf ? (
        <div className={`flex items-center gap-0.5 rounded-lg bg-slate-100 p-0.5 ${busy ? "pointer-events-none opacity-50" : ""}`} aria-busy={busy}>
          {wf.status !== "RESOLVED" && !wf.assignedTo ? (
            <button type="button" onClick={() => onUpdate(item, "CLAIM")} className={ghost} aria-label="Take ownership" title="Take ownership">
              <UserPlus className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          {wf.status === "OPEN" ? (
            <button type="button" onClick={() => onUpdate(item, "ACKNOWLEDGE")} className={ghost} aria-label="Acknowledge" title="Acknowledge">
              <UserCheck className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
          {wf.status !== "RESOLVED" ? (
            <button type="button" onClick={() => onResolve(item)} className={`${ghost} hover:text-emerald-700`} aria-label="Confirm resolved" title="Confirm resolved">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <button type="button" onClick={() => onUpdate(item, "REOPEN")} className={`${ghost} hover:text-amber-700`} aria-label="Reopen SLA" title="Reopen SLA">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

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
  const selectedCategoryDetail = categoryDetails[category] || { label: category, Icon: Activity };
  const SelectedCategoryIcon = selectedCategoryDetail.Icon;

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
    <div className="min-w-0 space-y-4 p-3 sm:space-y-5 sm:p-5 lg:p-6">
      {/* Command band: a verdict, the single most urgent item, and pressure tiles that filter the queue */}
      <section className="relative overflow-hidden rounded-2xl border border-solid border-emerald-950/60 bg-[#0b2420] text-white shadow-[0_18px_45px_-30px_rgba(2,102,94,0.8)]" aria-label="Action Center status">
        <div className="pointer-events-none absolute inset-0" aria-hidden style={{ background: "radial-gradient(700px circle at 8% -30%, rgba(52,211,153,0.16), transparent 60%), radial-gradient(520px circle at 95% 0%, rgba(56,189,248,0.08), transparent 60%)" }} />
        <div className="relative px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-200/70">
                <span className={`h-1.5 w-1.5 rounded-full ${pressure.tone === "calm" ? "bg-emerald-300" : pressure.tone === "warn" ? "bg-amber-300" : "bg-rose-400"} shadow-[0_0_8px_2px_currentColor]`} aria-hidden />
                Operations · SLA tracked
              </p>
              <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight text-white sm:text-[28px]">Action Center</h1>
              <p className="m-0 mt-1.5 max-w-2xl text-sm leading-6 text-emerald-50/75">{pressure.verdict}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {data.generatedAt ? (
                <span className="hidden text-[11px] text-emerald-100/50 sm:inline">
                  Updated {new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT
                </span>
              ) : null}
              <Link href="/admin/impact-center" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/10 bg-white/[0.06] px-3 text-xs font-semibold text-emerald-50/80 no-underline transition hover:bg-white/[0.12] hover:text-white hover:no-underline">
                Technical impact <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={() => void load(true)}
                aria-disabled={refreshing}
                className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-solid border-white/10 bg-white/[0.06] text-white transition hover:bg-white/[0.12]"
                aria-label="Refresh action center"
                title="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          {/* Start here: the queue's top-ranked item, when looking at the whole queue */}
          {startHere ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.05] px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-200/60">Start here</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${startHere.severity === "CRITICAL" ? "bg-rose-400/15 text-rose-200" : startHere.severity === "HIGH" ? "bg-amber-400/15 text-amber-200" : "bg-white/10 text-emerald-50/70"}`}>{startHere.severity.charAt(0) + startHere.severity.slice(1).toLowerCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-white">{startHere.title}</span>
                <span className="block truncate text-[11px] text-emerald-100/55">{startHere.subject}</span>
              </span>
              {(() => {
                const due = dueLabel(startHere.workflow?.resolutionDueAt ?? startHere.dueAt);
                return <span className={`text-[11px] font-semibold tabular-nums ${due.overdue ? "text-rose-300" : "text-emerald-100/60"}`}>{due.label}</span>;
              })()}
              <Link href={startHere.detailHref} className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-300 px-3 text-[12px] font-bold text-emerald-950 no-underline hover:bg-emerald-200 hover:no-underline">
                {startHere.actionLabel || "Open"} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          ) : null}

          {/* Pressure tiles: each one filters the queue below; click again to clear */}
          <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(168px,1fr))] gap-2">
            {pressureTiles.map((t) => {
              const on = t.filter ? (t.filter.kind === "severity" ? severity === t.filter.value : status === t.filter.value) : false;
              const Icon = t.Icon;
              const body = (
                <>
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-start gap-1.5 text-[11px] font-semibold text-emerald-50/65">
                      <Icon className={`mt-px h-3.5 w-3.5 shrink-0 ${t.hot ? t.hotText : "text-emerald-200/60"}`} aria-hidden />
                      <span className="leading-tight">{t.label}</span>
                    </span>
                    {t.hot ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.hotDot}`} aria-hidden /> : null}
                  </span>
                  <span className={`mt-1.5 block break-words font-bold tabular-nums leading-tight tracking-tight ${typeof t.value === "string" && t.value.length > 8 ? "text-base" : "text-xl"} ${t.hot ? "text-white" : "text-emerald-50/80"}`}>{loading ? "…" : t.value}</span>
                  <span className="mt-1 block text-[11px] leading-snug text-emerald-100/45">{t.note}</span>
                </>
              );
              const base = `flex min-w-0 flex-col rounded-xl px-3 py-2.5 text-left transition ${on ? "bg-emerald-300/[0.14] shadow-[inset_0_0_0_1px_rgba(110,231,183,0.45)]" : "bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"}`;
              return t.filter ? (
                <button
                  key={t.label}
                  type="button"
                  aria-pressed={on}
                  title={on ? "Show all work again" : `Show ${t.filter.shows}`}
                  onClick={() => {
                    const f = t.filter!;
                    if (f.kind === "severity") setSeverity(on ? "ALL" : f.value);
                    else setStatus(on ? "ACTIVE" : f.value);
                    setPage(1);
                  }}
                  className={`${base} w-full cursor-pointer appearance-none border-0 hover:bg-white/[0.08]`}
                >
                  {body}
                </button>
              ) : (
                <div key={t.label} className={base}>{body}</div>
              );
            })}
          </div>

          {/* Urgency mix of active work: critical, high, everything else */}
          {!loading && data.summary.total > 0 ? (
            <div className="mt-4">
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]" role="img" aria-label={`Urgency mix: ${data.summary.critical} critical, ${data.summary.high} high, ${pressure.rest} other`}>
                <span className="h-full bg-rose-400" style={{ width: `${(data.summary.critical / data.summary.total) * 100}%` }} />
                <span className="h-full bg-amber-300" style={{ width: `${(data.summary.high / data.summary.total) * 100}%` }} />
                <span className="h-full bg-emerald-300/50" style={{ width: `${(pressure.rest / data.summary.total) * 100}%` }} />
              </div>
              <p className="m-0 mt-1.5 flex flex-wrap gap-x-4 text-[11px] text-emerald-100/50">
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden /> {data.summary.critical} critical</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden /> {data.summary.high} high</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300/50" aria-hidden /> {pressure.rest} medium or low</span>
              </p>
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

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-slate-50/80 p-4 sm:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative min-w-0 lg:hidden">
              <SelectedCategoryIcon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#02665e]" aria-hidden />
              <select
                value={category}
                onChange={(event) => { setCategory(event.target.value); setPage(1); }}
                className="h-10 w-full appearance-none rounded-xl border border-slate-200 bg-white pl-10 pr-10 text-sm font-bold text-slate-700 outline-none transition focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
                aria-label="Action category"
              >
                {categories.map((key) => {
                  const detail = categoryDetails[key] || { label: key, Icon: Activity };
                  const count = key === "ALL" ? data.summary.total : data.summary.byCategory[key] || 0;
                  return <option key={key} value={key}>{detail.label} ({count})</option>;
                })}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            </div>
            <div
              className="scrollbar-hide hidden min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 touch-pan-x lg:flex xl:flex-1"
              aria-label="Action categories"
            >
              {categories.map((key) => {
                const detail = categoryDetails[key] || { label: key, Icon: Activity };
                const count = key === "ALL" ? data.summary.total : data.summary.byCategory[key] || 0;
                const active = category === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setCategory(key); setPage(1); }}
                    className={`inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 text-xs font-bold transition ${active ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-[#02665e]/30 hover:text-[#02665e]"}`}
                  >
                    <detail.Icon className="h-3.5 w-3.5" />
                    {detail.label}
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            <form onSubmit={applySearch} className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <select
                value={severity}
                onChange={(event) => { setSeverity(event.target.value); setPage(1); }}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
                aria-label="Filter by urgency"
              >
                <option value="ALL">All urgency</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="OVERDUE">Overdue</option>
              </select>
              <select
                value={status}
                onChange={(event) => { setStatus(event.target.value); setPage(1); }}
                className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
                aria-label="Filter by SLA status"
              >
                <option value="ACTIVE">Active SLA</option>
                <option value="OPEN">Unacknowledged</option>
                <option value="ACKNOWLEDGED">Acknowledged</option>
                <option value="RESOLVED">Resolved</option>
                <option value="ALL">All SLA states</option>
              </select>
              <label className="relative min-w-0 sm:w-72">
                <span className="sr-only">Search action items</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search person, booking or property"
                  className="box-border h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
                />
              </label>
              <button type="submit" className="h-10 rounded-lg bg-slate-900 px-4 text-xs font-bold text-white transition hover:bg-slate-800">Search</button>
              {filtersActive ? (
                <button type="button" onClick={clearFilters} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">
                  <X className="h-3.5 w-3.5" /> Clear
                </button>
              ) : null}
            </form>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3 sm:px-5">
          <p className="m-0 text-xs text-slate-500">
            {loading ? (
              "Loading the queue…"
            ) : data.pagination.total > 0 ? (
              <>
                <span className="font-semibold text-slate-900">{data.pagination.total} in this view</span>
                <span className="text-slate-400"> · showing {(data.pagination.page - 1) * data.pagination.perPage + 1} to {Math.min(data.pagination.page * data.pagination.perPage, data.pagination.total)}, most urgent first</span>
              </>
            ) : (
              "No matching actions"
            )}
          </p>
          {data.generatedAt ? (
            <p className="m-0 text-[11px] text-slate-400">
              Updated {new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT
            </p>
          ) : null}
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, value) => <div key={value} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        ) : data.items.length ? (
          <>
            <ol className="m-0 list-none divide-y divide-slate-100 p-0">
              {data.items.map((item) => {
                const categoryDetail = categoryDetails[item.category] || { label: item.category, Icon: Activity };
                const wf = item.workflow;
                const resolution = dueLabel(wf?.resolutionDueAt || item.dueAt || null);
                const response = dueLabel(wf?.responseDueAt || null);
                // Share of the resolution window already used (opened to target).
                const used = wf
                  ? Math.min(1, Math.max(0, (Date.now() - new Date(wf.openedAt).getTime()) / Math.max(1, new Date(wf.resolutionDueAt).getTime() - new Date(wf.openedAt).getTime())))
                  : null;
                const late = !wf?.resolvedAt && resolution.overdue;
                const tight = !late && used != null && used > 0.75;
                const clock = wf?.resolvedAt
                  ? { pill: "bg-emerald-50 text-emerald-800", bar: "bg-emerald-500" }
                  : late
                    ? { pill: "bg-rose-50 text-rose-700", bar: "bg-rose-500" }
                    : tight
                      ? { pill: "bg-amber-50 text-amber-800", bar: "bg-amber-500" }
                      : { pill: "bg-slate-100 text-slate-700", bar: "bg-[#02665e]" };
                const responseLate = Boolean(wf && !wf.acknowledgedAt && wf.responseBreached);
                const busy = actionBusy === wf?.id;
                const owner = wf?.assignedTo?.name || wf?.assignedTo?.email || null;
                const sevDot = item.severity === "CRITICAL" ? "bg-rose-500" : item.severity === "HIGH" ? "bg-amber-500" : item.severity === "MEDIUM" ? "bg-sky-500" : "bg-slate-400";
                return (
                  <li key={item.id} className="flex gap-3.5 px-4 py-4 transition-colors hover:bg-slate-50/70 sm:px-5">
                    <span className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                      <categoryDetail.Icon className="h-[18px] w-[18px]" aria-hidden />
                      <span className={`absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${sevDot}`} aria-hidden />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                        {/* What it is */}
                        <div className="min-w-[240px] flex-1">
                          <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                            <span className={`rounded-full border border-solid px-1.5 py-px text-[10px] font-bold ${severityStyle[item.severity]}`}>{item.severity.charAt(0) + item.severity.slice(1).toLowerCase()}</span>
                            <span className="whitespace-nowrap font-medium text-slate-600">{categoryDetail.label}</span>
                            <span className="whitespace-nowrap text-slate-400">opened {formatAge(item.createdAt).replace(" old", " ago")}</span>
                          </p>
                          <Link href={item.detailHref} className="mt-1.5 line-clamp-2 block break-words text-[15px] font-semibold leading-snug text-slate-950 no-underline hover:text-[#02665e] hover:no-underline">{item.title}</Link>
                          <p className="m-0 mt-0.5 line-clamp-1 break-words text-[13px] text-slate-500">
                            <span className="font-medium text-slate-700">{item.subject}</span>
                            {item.summary ? <span> · {item.summary}</span> : null}
                          </p>
                        </div>

                        {/* What is at stake, and what to do */}
                        <div className="flex shrink-0 items-center gap-4">
                          {item.exposure ? (
                            <span className="text-right">
                              <span className="block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">{item.metadata?.payoutVerified === true ? "Owner payout" : "At stake"}</span>
                              <span className="block text-sm font-semibold tabular-nums text-slate-900">{formatMoney(item.exposure.amount, item.exposure.currency)}</span>
                            </span>
                          ) : null}
                          <WorkflowActionButtons item={item} busy={busy} onUpdate={(target, action) => void updateWorkflow(target, action)} onResolve={(target) => { setResolveTarget(target); setResolutionNote(""); }} />
                        </div>
                      </div>

                      {/* Where it stands: the clock, the response, the owner */}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums ${clock.pill}`}>
                          <Clock3 className="h-3.5 w-3.5" aria-hidden />
                          {wf?.resolvedAt ? "Resolved" : resolution.label}
                          {used != null && !wf?.resolvedAt ? (
                            <span className="h-1 w-12 overflow-hidden rounded-full bg-black/10" aria-hidden>
                              <span className={`block h-full rounded-full ${clock.bar}`} style={{ width: `${Math.round(used * 100)}%` }} />
                            </span>
                          ) : null}
                        </span>
                        {wf ? (
                          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${wf.acknowledgedAt ? "bg-emerald-50 text-emerald-800" : responseLate ? "bg-rose-50 text-rose-700" : "bg-slate-100 text-slate-600"}`}>
                            <UserCheck className="h-3.5 w-3.5" aria-hidden />
                            {wf.acknowledgedAt ? "Acknowledged" : responseLate ? `Response ${response.label}` : `Response ${response.label.replace("Due in", "due in")}`}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">No SLA attached</span>
                        )}
                        <span className={`inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2.5 text-[11px] font-semibold ${owner ? "bg-[#02665e]/[0.07] text-[#02665e]" : "bg-amber-50 text-amber-800"}`}>
                          <span className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-bold ${owner ? "bg-[#02665e] text-white" : "bg-amber-200 text-amber-900"}`}>{owner ? owner.trim().charAt(0).toUpperCase() : "?"}</span>
                          {owner || "No owner yet"}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 sm:px-5">
              <p className="m-0 text-xs font-semibold text-slate-500">Page {data.pagination.page} of {data.pagination.totalPages}</p>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={data.pagination.page <= 1 || loading} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                  <ChevronLeft className="h-4 w-4" aria-hidden /> Previous
                </button>
                <button type="button" onClick={() => setPage((current) => Math.min(data.pagination.totalPages, current + 1))} disabled={data.pagination.page >= data.pagination.totalPages || loading} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                  Next <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center px-6 py-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-6 w-6" aria-hidden /></span>
            <h2 className="mt-3 text-base font-black text-slate-900">No matching operational work</h2>
            <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">The selected queue is clear. Adjust the filters to inspect other work.</p>
            {filtersActive ? <button type="button" onClick={clearFilters} className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700">Clear filters</button> : null}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-xs leading-5 text-blue-900 sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0"><strong>SLA workflow:</strong> ownership, acknowledgment, and resolution evidence are persisted and audited here. Business state still changes only in the authoritative booking, payment, driver, property, or NRMS workflow.</p>
        <Link href="/admin/lifecycle-health" className="inline-flex shrink-0 items-center gap-1 font-black text-blue-800 no-underline hover:underline">Lifecycle detail <ChevronRight className="h-3.5 w-3.5" /></Link>
      </div>

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

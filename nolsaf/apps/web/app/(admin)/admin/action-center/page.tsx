"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

function SummaryCard({ label, value, note, Icon, tone }: {
  label: string;
  value: string | number;
  note: string;
  Icon: LucideIcon;
  tone: "red" | "amber" | "teal" | "slate";
}) {
  const tones = {
    red: "bg-red-50 text-red-700",
    amber: "bg-amber-50 text-amber-700",
    teal: "bg-emerald-50 text-[#02665e]",
    slate: "bg-slate-100 text-slate-700",
  };
  return (
    <div className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_-22px_rgba(15,23,42,0.4)]">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <p className="m-0 text-xs font-bold text-slate-600">{label}</p>
      </div>
      <p className="mt-3 break-words text-2xl font-black tracking-tight text-slate-950">{value}</p>
      <p className="mt-0.5 text-[11px] font-medium leading-4 text-slate-500">{note}</p>
    </div>
  );
}

function SupportingMetric({ label, value, note, Icon, tone }: {
  label: string;
  value: string | number;
  note: string;
  Icon: LucideIcon;
  tone: "amber" | "blue" | "teal";
}) {
  const tones = {
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    teal: "bg-emerald-50 text-[#02665e]",
  };
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="m-0 text-xs font-bold text-slate-700">{label}</p>
          <p className="m-0 break-words text-base font-black text-slate-950">{value}</p>
        </div>
        <p className="m-0 mt-0.5 text-[11px] leading-4 text-slate-500">{note}</p>
      </div>
    </div>
  );
}

type WorkflowAction = "CLAIM" | "ACKNOWLEDGE" | "REOPEN";

function WorkflowActionButtons({ item, busy, onUpdate, onResolve }: {
  item: ActionItem;
  busy: boolean;
  onUpdate: (item: ActionItem, action: WorkflowAction) => void;
  onResolve: (item: ActionItem) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Link
        href={item.detailHref}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#02665e] px-2.5 text-[11px] font-bold text-white no-underline hover:bg-[#01544d]"
        title={item.actionLabel}
      >
        Open <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
      {item.workflow && item.workflow.status !== "RESOLVED" && !item.workflow.assignedTo ? (
        <button type="button" disabled={busy} onClick={() => onUpdate(item, "CLAIM")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-50" aria-label="Take ownership" title="Take ownership">
          <UserPlus className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
      {item.workflow?.status === "OPEN" ? (
        <button type="button" disabled={busy} onClick={() => onUpdate(item, "ACKNOWLEDGE")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-50" aria-label="Acknowledge" title="Acknowledge">
          <UserCheck className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
      {item.workflow && item.workflow.status !== "RESOLVED" ? (
        <button type="button" disabled={busy} onClick={() => onResolve(item)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" aria-label="Confirm resolved" title="Confirm resolved">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : null}
      {item.workflow?.status === "RESOLVED" ? (
        <button type="button" disabled={busy} onClick={() => onUpdate(item, "REOPEN")} className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50" aria-label="Reopen SLA" title="Reopen SLA">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </button>
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
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const [tableCanScroll, setTableCanScroll] = useState({ left: false, right: true });
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

  const updateTableScrollState = useCallback(() => {
    const element = tableScrollRef.current;
    if (!element) return;
    const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
    setTableCanScroll({
      left: element.scrollLeft > 4,
      right: element.scrollLeft < maximum - 4,
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateTableScrollState);
    window.addEventListener("resize", updateTableScrollState);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateTableScrollState);
    };
  }, [data.items.length, updateTableScrollState]);

  function slideTable(direction: -1 | 1) {
    tableScrollRef.current?.scrollBy({ left: direction * 520, behavior: "smooth" });
  }

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
      <section
        className="relative overflow-hidden rounded-2xl border border-white/10 shadow-[0_18px_45px_-30px_rgba(2,102,94,0.8)]"
        style={{ background: "linear-gradient(135deg, #071b19 0%, #0a302c 48%, #0b3f55 100%)" }}
      >
        <div className="pointer-events-none absolute inset-y-0 right-0 w-1/3 bg-gradient-to-l from-cyan-300/[0.06] to-transparent" aria-hidden />
        <div className="relative z-10 flex flex-col gap-5 px-5 py-5 sm:px-7 sm:py-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-100">
                <Siren className="h-3.5 w-3.5" /> Operations
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.07] px-2.5 py-1 text-[10px] font-bold text-white/70">
                <ShieldCheck className="h-3.5 w-3.5" /> SLA tracking active
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-white sm:text-[2rem]">Action Center</h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-white/65">
              Urgent work across money, trips, cancellations, approvals, booking lifecycles, and NRMS. Ranked by impact and response deadline.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="/admin/impact-center" className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.07] px-3 text-xs font-bold text-white/75 no-underline transition hover:bg-white/15 hover:text-white">
              Technical impact <ChevronRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => void load(true)}
              disabled={refreshing}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-60"
              aria-label="Refresh action center"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-700">Retry</button>
        </div>
      ) : null}

      <section className="space-y-2.5" aria-label="Action Center summary">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Active work" value={loading ? "…" : data.summary.total} note="Items requiring operational attention" Icon={Siren} tone="slate" />
          <SummaryCard label="Critical priority" value={loading ? "…" : data.summary.critical} note={`${data.summary.high} more items have high priority`} Icon={AlertTriangle} tone={data.summary.critical ? "red" : "teal"} />
          <SummaryCard label="Response overdue" value={loading ? "…" : data.summary.responseBreached} note="Items waiting for acknowledgment" Icon={Clock3} tone={data.summary.responseBreached ? "red" : "teal"} />
          <SummaryCard label="Resolution overdue" value={loading ? "…" : data.summary.resolutionBreached} note="Items beyond their resolution target" Icon={CalendarClock} tone={data.summary.resolutionBreached ? "amber" : "teal"} />
        </div>
        <div className="grid grid-cols-1 gap-2.5 rounded-xl border border-slate-200/80 bg-white p-2.5 shadow-[0_8px_24px_-22px_rgba(15,23,42,0.35)] md:grid-cols-3">
          <SupportingMetric label="Without owner" value={loading ? "…" : data.summary.unassigned} note="Needs an individual administrator" Icon={UserPlus} tone="amber" />
          <SupportingMetric label="Acknowledged" value={loading ? "…" : data.summary.acknowledged} note="Work with an active response" Icon={UserCheck} tone="blue" />
          <SupportingMetric label="Money at risk" value={loading ? "…" : totalExposure} note="Value connected to active work" Icon={CircleDollarSign} tone="teal" />
        </div>
      </section>

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

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 sm:px-5">
          <p className="m-0 text-xs font-semibold text-slate-500">
            {loading
              ? "Loading operational state…"
              : data.pagination.total > 0
                ? `Showing ${(data.pagination.page - 1) * data.pagination.perPage + 1} to ${Math.min(data.pagination.page * data.pagination.perPage, data.pagination.total)} of ${data.pagination.total}`
                : "No matching actions"}
          </p>
          <div className="flex items-center gap-2">
            {data.generatedAt ? <p className="m-0 text-[11px] font-medium text-slate-400">Updated {new Date(data.generatedAt).toLocaleTimeString()}</p> : null}
            <div className="hidden items-center gap-2 lg:flex">
              <span className="text-[11px] font-semibold text-slate-500">Slide columns</span>
              <button type="button" onClick={() => slideTable(-1)} disabled={!tableCanScroll.left} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#02665e]/30 hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-30" aria-label="Slide columns left" title="Slide columns left">
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" onClick={() => slideTable(1)} disabled={!tableCanScroll.right} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-[#02665e]/30 hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-30" aria-label="Slide columns right" title="Slide columns right">
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, value) => <div key={value} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        ) : data.items.length ? (
          <>
            <div ref={tableScrollRef} onScroll={updateTableScrollState} className="hidden overflow-x-auto overscroll-x-contain scroll-smooth pb-1 [scrollbar-color:#94a3b8_#f1f5f9] [scrollbar-width:thin] lg:block">
              <table className="min-w-[1840px] w-full table-fixed border-collapse">
                <thead className="bg-slate-50 text-left">
                  <tr className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                    <th className="sticky left-0 z-20 w-[12%] bg-slate-50 px-4 py-3 shadow-[5px_0_12px_-12px_rgba(15,23,42,0.6)]">Urgency</th>
                    <th className="w-[31%] px-4 py-3">Work item</th>
                    <th className="w-[16%] px-4 py-3">Ownership</th>
                    <th className="w-[18%] px-4 py-3">SLA timing</th>
                    <th className="w-[10%] px-4 py-3">Exposure</th>
                    <th className="sticky right-0 z-20 w-[13%] bg-slate-50 px-4 py-3 text-right shadow-[-5px_0_12px_-12px_rgba(15,23,42,0.6)]">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((item) => {
                    const categoryDetail = categoryDetails[item.category] || { label: item.category, Icon: Activity };
                    const operationalDue = dueLabel(item.dueAt);
                    const responseDue = dueLabel(item.workflow?.responseDueAt || null);
                    const resolutionDue = dueLabel(item.workflow?.resolutionDueAt || null);
                    const busy = actionBusy === item.workflow?.id;
                    return (
                      <tr key={item.id} className="group/row align-top transition-colors duration-150 hover:bg-emerald-50/60 focus-within:bg-emerald-50/60">
                        <td className="sticky left-0 z-10 bg-white px-4 py-3.5 shadow-[5px_0_12px_-12px_rgba(15,23,42,0.5)] transition-colors duration-150 group-hover/row:bg-[#f2fbf8] group-focus-within/row:bg-[#f2fbf8]">
                          <div className="flex items-start gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#02665e] transition-transform duration-150 group-hover/row:scale-105"><categoryDetail.Icon className="h-4 w-4" aria-hidden /></span>
                            <div className="min-w-0 space-y-1.5">
                              <span className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${severityStyle[item.severity]}`}>{item.severity}</span>
                              <p className="m-0 text-[11px] font-bold text-slate-500">{categoryDetail.label}</p>
                              <p className="m-0 text-[10px] text-slate-400">{formatAge(item.createdAt)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="m-0 text-sm font-black text-slate-950 transition-colors duration-150 group-hover/row:text-[#02665e]">{item.title}</p>
                          <p className="m-0 mt-1 text-xs font-bold text-slate-700">{item.subject}</p>
                          <p className="m-0 mt-1 line-clamp-1 text-xs leading-5 text-slate-500">{item.summary}</p>
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="m-0 text-xs font-bold text-slate-700">{item.workflow?.assignedTeam || "Admin Operations"}</p>
                          <p className={`m-0 mt-1 text-[11px] font-semibold ${item.workflow?.assignedTo ? "text-emerald-700" : "text-amber-700"}`}>{item.workflow?.assignedTo?.name || item.workflow?.assignedTo?.email || "No individual owner"}</p>
                          <p className="m-0 mt-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">{item.workflow?.status || "Pending"}</p>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="space-y-1.5 text-[11px] font-semibold">
                            <p className={`m-0 ${item.workflow?.responseBreached ? "text-red-700" : "text-slate-600"}`}>Response: {item.workflow?.acknowledgedAt ? "Met" : responseDue.label}</p>
                            <p className={`m-0 ${item.workflow?.resolutionBreached ? "text-red-700" : "text-slate-600"}`}>Resolution: {item.workflow?.resolvedAt ? "Met" : resolutionDue.label}</p>
                            <p className={`m-0 ${operationalDue.overdue ? "text-amber-700" : "text-slate-400"}`}>Operational: {operationalDue.label}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <p className="m-0 break-words text-xs font-black text-emerald-800">{item.exposure ? formatMoney(item.exposure.amount, item.exposure.currency) : "None"}</p>
                        </td>
                        <td className="sticky right-0 z-10 bg-white px-4 py-3.5 shadow-[-5px_0_12px_-12px_rgba(15,23,42,0.5)] transition-colors duration-150 group-hover/row:bg-[#f2fbf8] group-focus-within/row:bg-[#f2fbf8]">
                          <WorkflowActionButtons item={item} busy={busy} onUpdate={(target, action) => void updateWorkflow(target, action)} onResolve={(target) => { setResolveTarget(target); setResolutionNote(""); }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-slate-100 lg:hidden">
              {data.items.map((item) => {
                const categoryDetail = categoryDetails[item.category] || { label: item.category, Icon: Activity };
                const responseDue = dueLabel(item.workflow?.responseDueAt || null);
                const resolutionDue = dueLabel(item.workflow?.resolutionDueAt || null);
                const busy = actionBusy === item.workflow?.id;
                return (
                  <article key={item.id} className="p-4 transition-colors duration-150 hover:bg-emerald-50/60 focus-within:bg-emerald-50/60">
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-[#02665e]"><categoryDetail.Icon className="h-4 w-4" aria-hidden /></span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${severityStyle[item.severity]}`}>{item.severity}</span>
                          <span className="text-[10px] font-bold text-slate-400">{categoryDetail.label}</span>
                          <span className="text-[10px] text-slate-400">{formatAge(item.createdAt)}</span>
                        </div>
                        <h2 className="mt-2 text-sm font-black text-slate-950">{item.title}</h2>
                        <p className="mt-1 text-xs font-bold text-slate-700">{item.subject}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                          <div><span className="block text-slate-400">Owner</span><strong className="font-bold text-slate-700">{item.workflow?.assignedTo?.name || "Not assigned"}</strong></div>
                          <div><span className="block text-slate-400">Team</span><strong className="font-bold text-slate-700">{item.workflow?.assignedTeam || "Admin Operations"}</strong></div>
                          <div><span className="block text-slate-400">Response</span><strong className={item.workflow?.responseBreached ? "text-red-700" : "text-slate-700"}>{item.workflow?.acknowledgedAt ? "Met" : responseDue.label}</strong></div>
                          <div><span className="block text-slate-400">Resolution</span><strong className={item.workflow?.resolutionBreached ? "text-red-700" : "text-slate-700"}>{item.workflow?.resolvedAt ? "Met" : resolutionDue.label}</strong></div>
                        </div>
                        <div className="mt-3"><WorkflowActionButtons item={item} busy={busy} onUpdate={(target, action) => void updateWorkflow(target, action)} onResolve={(target) => { setResolveTarget(target); setResolutionNote(""); }} /></div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

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

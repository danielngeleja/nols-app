"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Eye, FileText, Filter, RefreshCw, Search, ShieldCheck, type LucideIcon } from "lucide-react";
import api from "@/lib/apiClient";

type ServiceType = "PROPERTY" | "GROUP_STAY" | "TOUR";
type LifecycleIssue = { code: string; severity: "WARNING" | "ERROR"; message: string };
type Lifecycle = {
  bookingStage: string;
  paymentStage: string;
  receiptStage: string;
  responsibilityStage: string;
  caseStage: string;
  requiredAction: string;
  requiredActionLabel: string;
  consistency: { status: "CONSISTENT" | "REVIEW_REQUIRED"; issues: LifecycleIssue[] };
};
type Row = {
  id: string;
  serviceType: ServiceType;
  bookingId: number;
  bookingCode: string;
  title: string;
  customer: string | null;
  createdAt: string;
  detailHref: string;
  lifecycle: Lifecycle;
  source: Record<string, unknown>;
};
type Payload = {
  observationMode: boolean;
  generatedAt: string;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  summary: {
    observedOnPage: number;
    consistentOnPage: number;
    reviewRequiredOnPage: number;
    byService: { property: number; groupStay: number; tour: number };
  };
  items: Row[];
};

const EMPTY: Payload = {
  observationMode: true,
  generatedAt: "",
  total: 0,
  page: 1,
  pageSize: 25,
  pageCount: 1,
  summary: { observedOnPage: 0, consistentOnPage: 0, reviewRequiredOnPage: 0, byService: { property: 0, groupStay: 0, tour: 0 } },
  items: [],
};

const serviceLabel: Record<ServiceType, string> = { PROPERTY: "Property", GROUP_STAY: "Group stay", TOUR: "Tour package" };
const humanize = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
const displayValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return new Date(value).toLocaleString();
  return String(value);
};

function Stage({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="whitespace-normal text-xs font-bold leading-4 text-slate-800" title={humanize(value)}>{humanize(value)}</div>
      <div className="mt-1 whitespace-normal text-[9px] font-semibold uppercase leading-3 tracking-[0.08em] text-slate-500">{label}</div>
    </div>
  );
}

function HealthBadge({ status }: { status: Lifecycle["consistency"]["status"] }) {
  const healthy = status === "CONSISTENT";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${healthy ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
      {healthy ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {healthy ? "Consistent" : "Review required"}
    </span>
  );
}

export default function LifecycleHealthPage() {
  const [data, setData] = useState<Payload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [service, setService] = useState("ALL");
  const [health, setHealth] = useState("ALL");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<Payload>("/api/admin/lifecycle-health", { params: { service, q: appliedQuery || undefined, page, pageSize: 25 } });
      setData(response.data);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || requestError?.message || "Unable to load lifecycle health");
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, page, service]);

  useEffect(() => { void load(); }, [load]);

  const visibleItems = useMemo(() => data.items.filter((item) => health === "ALL" || item.lifecycle.consistency.status === health), [data.items, health]);
  const currentPageNote = health === "ALL" ? null : `Health filter applies to the ${data.items.length} records loaded on this page.`;
  const summaryItems: Array<{ label: string; value: number; Icon: LucideIcon; color: string; bg: string }> = [
    { label: "Records observed", value: data.total, Icon: Activity, color: "text-[#02665e]", bg: "bg-[#02665e]/15" },
    { label: "Consistent on page", value: data.summary.consistentOnPage, Icon: CheckCircle2, color: "text-blue-700", bg: "bg-blue-100" },
    { label: "Review required", value: data.summary.reviewRequiredOnPage, Icon: AlertTriangle, color: "text-amber-700", bg: "bg-amber-100" },
  ];

  function applySearch(event: React.FormEvent) {
    event.preventDefault();
    setPage(1);
    setAppliedQuery(query.trim());
  }

  return (
    <div className="mx-auto max-w-7xl min-w-0 space-y-4 px-3 py-4 sm:px-4 lg:px-6 xl:px-8">
      <section className="box-border min-w-0 max-w-full overflow-hidden rounded-2xl border border-white/15 shadow-2xl" style={{ background: "linear-gradient(135deg, #0a1a19 0%, #0d2320 60%, #0a1f2e 100%)", boxShadow: "0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)" }}>
        <div className="min-w-0 p-4 sm:p-5 lg:p-6">
          <div className="mb-4 flex min-w-0 items-center justify-between gap-3">
            <div className="min-w-0"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-teal-200"><Activity className="h-4 w-4" /> Operations observation</div><h1 className="mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Lifecycle health</h1></div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-white/75"><ShieldCheck className="h-3.5 w-3.5" /> Read only</span>
          </div>
          <form onSubmit={applySearch} className="min-w-0">
            <label className="relative block min-w-0">
              <span className="sr-only">Search lifecycle records</span><FileText className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search # / booking / traveller / service" className="box-border h-12 w-full min-w-0 max-w-full rounded-lg border border-white/15 bg-white/[0.07] pl-10 pr-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-teal-300/60 focus:ring-2 focus:ring-teal-300/20" />
            </label>
          </form>
          <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
            {[["ALL", "All", data.total], ["PROPERTY", "Property", data.summary.byService.property], ["GROUP_STAY", "Group stays", data.summary.byService.groupStay], ["TOUR", "Tours", data.summary.byService.tour]].map(([key, label, count]) => {
              const active = service === key;
              return <button key={String(key)} type="button" onClick={() => { setService(String(key)); setHealth("ALL"); setPage(1); }} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${active ? "border-white/40 bg-white/20 text-white" : "border-white/15 bg-white/[0.05] text-white/65 hover:bg-white/10"}`}><span>{label}</span><span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] text-white/75">{loading ? "…" : count}</span></button>;
            })}
            <button type="button" onClick={() => { setHealth(health === "REVIEW_REQUIRED" ? "ALL" : "REVIEW_REQUIRED"); setPage(1); }} className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${health === "REVIEW_REQUIRED" ? "border-amber-300/60 bg-amber-400/20 text-amber-100" : "border-amber-400/25 bg-amber-400/[0.08] text-amber-200/80 hover:bg-amber-400/15"}`}><span>Review required</span><span className="rounded-full bg-amber-300/20 px-2 py-0.5 text-[10px]">{loading ? "…" : data.summary.reviewRequiredOnPage}</span></button>
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => void load()} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/[0.07] text-white/75 hover:bg-white/15" title="Refresh lifecycle health" aria-label="Refresh lifecycle health"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
              <button type="button" onClick={() => setShowFilters((value) => !value)} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${showFilters ? "border-teal-300/60 bg-teal-400/20 text-teal-100" : "border-white/15 bg-white/[0.07] text-white/75 hover:bg-white/15"}`}><Filter className="h-4 w-4" /> Filters</button>
            </div>
          </div>
          <p className="mt-4 text-[11px] text-white/40 sm:text-xs">One row per booking. Lifecycle health interprets existing booking, payment, receipt, responsibility, and case records.</p>
          {showFilters ? <div className="mt-4 grid min-w-0 gap-3 border-t border-white/10 pt-4 sm:grid-cols-2"><select value={service} onChange={(event) => { setService(event.target.value); setPage(1); }} className="box-border h-10 w-full min-w-0 rounded-lg border border-white/15 bg-white/[0.07] px-3 text-sm text-white outline-none"><option className="bg-[#0d2320]" value="ALL">All services</option><option className="bg-[#0d2320]" value="PROPERTY">Property</option><option className="bg-[#0d2320]" value="GROUP_STAY">Group stays</option><option className="bg-[#0d2320]" value="TOUR">Tour packages</option></select><select value={health} onChange={(event) => setHealth(event.target.value)} className="box-border h-10 w-full min-w-0 rounded-lg border border-white/15 bg-white/[0.07] px-3 text-sm text-white outline-none"><option className="bg-[#0d2320]" value="ALL">All health states</option><option className="bg-[#0d2320]" value="CONSISTENT">Consistent</option><option className="bg-[#0d2320]" value="REVIEW_REQUIRED">Review required</option></select></div> : null}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-xl border border-[#02665e]/20 bg-gradient-to-r from-[#02665e]/10 to-emerald-50 p-4 shadow-sm sm:p-5">
        <div className="grid gap-4 sm:grid-cols-3 sm:divide-x sm:divide-[#02665e]/15">
          {summaryItems.map(({ label, value, Icon, color, bg }) => <div key={label} className="flex min-w-0 items-center gap-3 sm:px-5 first:sm:pl-0 last:sm:pr-0"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${bg}`}><Icon className={`h-5 w-5 ${color}`} /></div><div className="min-w-0"><div className="truncate text-xs font-medium text-gray-600 sm:text-sm">{label}</div><div className={`mt-1 text-xl font-bold ${color}`}>{loading ? "…" : Number(value).toLocaleString()}</div></div></div>)}
        </div>
      </section>
      {currentPageNote ? <p className="px-1 text-xs text-slate-500">{currentPageNote}</p> : null}

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">{error}</div> : null}

      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex min-w-0 flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Service lifecycle records</h2>
            <p className="mt-1 text-xs text-slate-500">Booking state and operational consistency across the selected services.</p>
          </div>
          <div className="text-xs font-semibold text-slate-500">{loading ? "Loading…" : `${visibleItems.length} records shown`}</div>
        </div>
        {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading lifecycle records…</div> : visibleItems.length === 0 ? (
          <div className="p-10 text-center"><div className="text-sm font-bold text-slate-800">No lifecycle records match this view</div><div className="mt-1 text-xs text-slate-500">Change the service, health, or search filter.</div></div>
        ) : (
          <div className="min-w-0 max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[1120px] table-fixed text-xs">
              <thead className="bg-slate-50 text-left font-bold uppercase tracking-[0.12em] text-slate-500">
                <tr><th className="w-[13%] px-4 py-3">Record</th><th className="w-[18%] px-4 py-3">Booking</th><th className="w-[52%] px-4 py-3">Lifecycle</th><th className="w-[12%] px-4 py-3">Health</th><th className="w-[5%] px-4 py-3 text-center">Open</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleItems.map((item) => {
                  const open = expanded === item.id;
                  return (
                    <Fragment key={item.id}>
                      <tr className="align-top transition-colors hover:bg-sky-50">
                        <td className="px-4 py-3"><div className="font-bold uppercase tracking-wide text-teal-700">{serviceLabel[item.serviceType]}</div><div className="mt-1 truncate font-mono font-semibold text-slate-800">{item.bookingCode}</div><div className="mt-1 whitespace-nowrap text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleDateString()}</div></td>
                        <td className="px-4 py-3"><div className="truncate font-semibold text-slate-900" title={item.title}>{item.title}</div><div className="mt-1 truncate text-slate-500" title={item.customer || ""}>{item.customer || "Traveller not recorded"}</div></td>
                        <td className="px-4 py-3"><div className="grid grid-cols-5 gap-2 rounded-lg bg-slate-50 p-3"><Stage label="Booking" value={item.lifecycle.bookingStage} /><Stage label="Payment" value={item.lifecycle.paymentStage} /><Stage label="Receipt" value={item.lifecycle.receiptStage} /><Stage label="Responsibility" value={item.lifecycle.responsibilityStage} /><Stage label="Case" value={item.lifecycle.caseStage} /></div></td>
                        <td className="px-4 py-3"><HealthBadge status={item.lifecycle.consistency.status} /></td>
                        <td className="px-4 py-3 text-center"><button type="button" onClick={() => setExpanded(open ? null : item.id)} aria-expanded={open} aria-label={`Inspect ${item.bookingCode}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-white hover:bg-teal-800"><Eye className="h-4 w-4" /></button></td>
                      </tr>
                      {open ? <tr><td colSpan={5} className="bg-slate-50/80 px-4 py-4"><div className="grid gap-3 lg:grid-cols-[1fr_1.4fr_auto]"><div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Required action</div><div className="mt-2 text-sm font-bold text-slate-900">{item.lifecycle.requiredActionLabel}</div></div><div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">Consistency explanation</div>{item.lifecycle.consistency.issues.length ? <ul className="mt-2 space-y-1">{item.lifecycle.consistency.issues.map((issue) => <li key={issue.code} className="flex gap-2 text-xs text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{issue.message}</li>)}</ul> : <p className="mt-2 text-xs text-emerald-800">No contradiction was detected in the observed fields.</p>}</div><Link href={item.detailHref} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-teal-700 bg-white px-4 text-xs font-bold text-teal-800 hover:bg-teal-50">Open workspace <ChevronRight className="h-4 w-4" /></Link></div><details className="mt-3 rounded-lg border border-slate-200 bg-white p-3"><summary className="flex cursor-pointer list-none items-center justify-between text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600">Observed source fields <ChevronDown className="h-4 w-4" /></summary><dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(item.source).map(([key, value]) => <div key={key} className="min-w-0 rounded-md bg-slate-50 p-2"><dt className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">{humanize(key)}</dt><dd className="mt-1 break-words text-xs font-semibold text-slate-800">{displayValue(value)}</dd></div>)}</dl></details></td></tr> : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-600">Page <strong>{data.page}</strong> of <strong>{data.pageCount}</strong> · {data.total.toLocaleString()} matching records</div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={loading || page <= 1} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /> Previous</button>
          <button type="button" onClick={() => setPage((value) => Math.min(data.pageCount, value + 1))} disabled={loading || page >= data.pageCount} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 disabled:opacity-40">Next <ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );
}

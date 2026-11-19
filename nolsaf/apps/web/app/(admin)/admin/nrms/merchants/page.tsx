"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ChevronDown, ChevronRight, ChevronsUpDown, ChevronUp, Eye, Filter, Inbox, Loader2, RefreshCw, Search, ShieldCheck, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useAdminHref } from "@/lib/adminRecordRefs";

type QueueRow = {
  id: number; version: number; status: string; submittedAt: string | null; reviewedAt: string | null;
  connection: { provider: string; environment: string } | null;
  merchant: { id: number | null; legalName: string | null; tradingName: string | null; country: string | null; propertyCount: number; owner: { id: number; name: string | null } | null };
};
type QueueResponse = { total: number; page: number; pageSize: number; counts: Record<string, number>; applications: QueueRow[] };
type QueueTone = "amber" | "blue" | "emerald" | "red";
type QueueSortKey = "id" | "legalName" | "owner" | "provider" | "propertyCount" | "version" | "submittedAt";

const QUEUE_GROUPS: Array<{ caption: string; queues: Array<{ key: string; label: string; tone: QueueTone }> }> = [
  { caption: "With NoLSAF", queues: [{ key: "READY_FOR_ADMIN_REVIEW", label: "Awaiting review", tone: "amber" }, { key: "ACTION_REQUIRED", label: "Returned", tone: "amber" }] },
  { caption: "With the provider", queues: [{ key: "SUBMISSION_QUEUED", label: "Approved", tone: "blue" }, { key: "SUBMITTED_TO_PROVIDER", label: "Sent", tone: "blue" }, { key: "PROVIDER_REVIEW", label: "In review", tone: "blue" }, { key: "PROVIDER_ACTION_REQUIRED", label: "Action needed", tone: "amber" }] },
  { caption: "Settled", queues: [{ key: "ACTIVE", label: "Active", tone: "emerald" }, { key: "ADMIN_REJECTED", label: "Rejected", tone: "red" }, { key: "REJECTED", label: "Provider rejected", tone: "red" }] },
];

const FILTER_TONES: Record<QueueTone, { active: string; idle: string; badge: string; dot: string }> = {
  amber: { active: "border-amber-400/70 bg-amber-400/20 text-amber-200", idle: "border-amber-300/20 bg-amber-300/[0.06] text-amber-100/70 hover:bg-amber-300/10", badge: "bg-amber-300/15 text-amber-100", dot: "bg-amber-500" },
  blue: { active: "border-sky-400/70 bg-sky-400/20 text-sky-200", idle: "border-sky-300/20 bg-sky-300/[0.06] text-sky-100/70 hover:bg-sky-300/10", badge: "bg-sky-300/15 text-sky-100", dot: "bg-sky-500" },
  emerald: { active: "border-emerald-400/70 bg-emerald-400/20 text-emerald-200", idle: "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-100/70 hover:bg-emerald-300/10", badge: "bg-emerald-300/15 text-emerald-100", dot: "bg-emerald-500" },
  red: { active: "border-rose-400/70 bg-rose-400/20 text-rose-200", idle: "border-rose-300/20 bg-rose-300/[0.06] text-rose-100/70 hover:bg-rose-300/10", badge: "bg-rose-300/15 text-rose-100", dot: "bg-rose-500" },
};
const FILTER_CONTROL_CLASS = "box-border !h-10 !min-h-10 w-full rounded-lg border border-white/15 bg-white/[0.07] px-3 !py-0 text-xs font-medium leading-10 text-white outline-none transition focus:border-emerald-400/70 focus:bg-white/10 focus:ring-2 focus:ring-emerald-400/10 sm:text-sm";
const QUEUE_TONE_BY_KEY: Record<string, QueueTone> = Object.fromEntries(QUEUE_GROUPS.flatMap((group) => group.queues.map((queue) => [queue.key, queue.tone])));

function titleCase(value: string | null | undefined): string {
  return String(value ?? "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function formatSubmittedAt(value: string | null): { date: string; time: string } {
  if (!value) return { date: "Not recorded", time: "" };
  const submittedAt = new Date(value);
  if (!Number.isFinite(submittedAt.getTime())) return { date: "Not recorded", time: "" };
  return { date: submittedAt.toLocaleDateString(), time: submittedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
}
function requestMessage(error: unknown, fallback: string): string {
  const cause = error as { response?: { data?: { error?: unknown } } };
  const message = cause.response?.data?.error;
  return typeof message === "string" && message.trim() ? message : fallback;
}
function statusTone(status: string): string {
  const value = String(status ?? "").toUpperCase();
  if (value === "ACTIVE") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (["READY_FOR_ADMIN_REVIEW", "ACTION_REQUIRED"].includes(value)) return "bg-amber-50 text-amber-800 ring-amber-200";
  if (["ADMIN_REJECTED", "PROVIDER_REJECTED", "REJECTED"].includes(value)) return "bg-rose-50 text-rose-700 ring-rose-200";
  return "bg-blue-50 text-blue-800 ring-blue-200";
}

export default function AdminMerchantOnboardingPage() {
  const recordHref = useAdminHref();
  const [status, setStatus] = useState("READY_FOR_ADMIN_REVIEW");
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [providerFilter, setProviderFilter] = useState("");
  const [environmentFilter, setEnvironmentFilter] = useState("");
  const [minimumProperties, setMinimumProperties] = useState("");
  const [sortBy, setSortBy] = useState<QueueSortKey>("submittedAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadQueue = useCallback(async (nextStatus: string) => {
    setLoading(true); setError(null);
    try {
      const response = await apiClient.get<QueueResponse>(`/api/admin/payments/merchants/applications?status=${encodeURIComponent(nextStatus)}&pageSize=50`);
      setQueue(response.data);
    } catch (cause) {
      setQueue(null); setError(requestMessage(cause, "The review queue could not be loaded."));
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void loadQueue(status); }, [loadQueue, status]);

  const providers = useMemo(() => Array.from(new Set((queue?.applications ?? []).map((row) => row.connection?.provider).filter((value): value is string => Boolean(value)))).sort(), [queue]);
  const environments = useMemo(() => Array.from(new Set((queue?.applications ?? []).map((row) => row.connection?.environment).filter((value): value is string => Boolean(value)))).sort(), [queue]);
  const visibleRows = useMemo(() => {
    let rows = [...(queue?.applications ?? [])];
    const term = search.trim().toLowerCase();
    if (term) rows = rows.filter((row) => `${row.id} ${row.merchant.legalName ?? ""} ${row.merchant.tradingName ?? ""} ${row.merchant.owner?.name ?? ""} ${row.connection?.provider ?? ""}`.toLowerCase().includes(term));
    if (providerFilter) rows = rows.filter((row) => row.connection?.provider === providerFilter);
    if (environmentFilter) rows = rows.filter((row) => row.connection?.environment === environmentFilter);
    if (minimumProperties) { const minimum = Number(minimumProperties); if (Number.isFinite(minimum)) rows = rows.filter((row) => row.merchant.propertyCount >= minimum); }
    const readValue = (row: QueueRow): string | number => {
      switch (sortBy) {
        case "id": return row.id;
        case "legalName": return (row.merchant.legalName ?? "").toLowerCase();
        case "owner": return (row.merchant.owner?.name ?? "").toLowerCase();
        case "provider": return (row.connection?.provider ?? "").toLowerCase();
        case "propertyCount": return row.merchant.propertyCount;
        case "version": return row.version;
        case "submittedAt": return row.submittedAt ? new Date(row.submittedAt).getTime() : 0;
      }
    };
    rows.sort((first, second) => { const a = readValue(first); const b = readValue(second); const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)); return sortDirection === "asc" ? result : -result; });
    return rows;
  }, [environmentFilter, minimumProperties, providerFilter, queue, search, sortBy, sortDirection]);

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const paginatedRows = visibleRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const activeFilterCount = [providerFilter, environmentFilter, minimumProperties].filter(Boolean).length;
  useEffect(() => setCurrentPage(1), [environmentFilter, minimumProperties, providerFilter, search, status]);
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages); }, [currentPage, totalPages]);
  const selectStatus = (nextStatus: string) => { setStatus(nextStatus); setProviderFilter(""); setEnvironmentFilter(""); setMinimumProperties(""); };
  const onSort = (field: QueueSortKey) => { if (sortBy === field) { setSortDirection((value) => value === "asc" ? "desc" : "asc"); return; } setSortBy(field); setSortDirection(field === "submittedAt" ? "desc" : "asc"); };
  const sortIcon = (field: QueueSortKey) => sortBy !== field ? <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" /> : sortDirection === "asc" ? <ChevronUp className="h-3.5 w-3.5 text-[#02665e]" /> : <ChevronDown className="h-3.5 w-3.5 text-[#02665e]" />;

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Onboarding band: the route every merchant takes, with live counts at each stage */}
      <header className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.20)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link href="/admin/nrms" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80 no-underline hover:text-emerald-200">
                <ArrowLeft className="h-3 w-3" aria-hidden /> NRMS · Payments
              </Link>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Merchant onboarding</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Check each owner&apos;s verification package, then follow it through the payment provider to a live merchant account.</p>
            </div>
            {(() => {
              const waiting = (queue?.counts?.READY_FOR_ADMIN_REVIEW ?? 0) + (queue?.counts?.PROVIDER_ACTION_REQUIRED ?? 0);
              return waiting > 0 ? (
                <button type="button" onClick={() => selectStatus((queue?.counts?.READY_FOR_ADMIN_REVIEW ?? 0) > 0 ? "READY_FOR_ADMIN_REVIEW" : "PROVIDER_ACTION_REQUIRED")} className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 self-start rounded-md border-0 bg-amber-400/15 px-3 text-xs font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/25 transition hover:bg-amber-400/25">
                  <span className="relative flex h-2 w-2" aria-hidden>
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                  </span>
                  {waiting} need{waiting === 1 ? "s" : ""} you
                </button>
              ) : (
                <span className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md bg-white/[0.06] px-3 text-xs font-semibold text-white/70 ring-1 ring-inset ring-white/10">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" aria-hidden /> Nothing waiting on NoLSAF
                </span>
              );
            })()}
          </div>

          {/* Route map: three stages, each one opens its first queue */}
          <ol className="m-0 mt-5 grid list-none grid-cols-1 gap-px overflow-hidden rounded-md bg-white/10 p-0 ring-1 ring-white/10 sm:grid-cols-3" aria-label="Onboarding stages">
            {QUEUE_GROUPS.map((group, index) => {
              const total = group.queues.reduce((sum: number, q) => sum + (queue?.counts?.[q.key] ?? 0), 0);
              const here = group.queues.some((q) => q.key === status);
              return (
                <li key={group.caption} className="min-w-0">
                  <div className={`flex h-full flex-col p-3 sm:p-4 ${here ? "bg-[#113430]" : "bg-[#0d2a25]"}`}>
                    <p className="m-0 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/40">
                      <span className="font-mono text-white/30">0{index + 1}</span> {group.caption}
                      {index < QUEUE_GROUPS.length - 1 && <ChevronRight className="ml-auto hidden h-3.5 w-3.5 text-white/20 sm:block" aria-hidden />}
                    </p>
                    <p className="m-0 mt-2 text-2xl font-bold tabular-nums leading-none text-white">{loading && !queue ? "..." : total}</p>
                    <span className="mt-2.5 flex flex-wrap gap-1">
                      {group.queues.map((q) => {
                        const n = queue?.counts?.[q.key] ?? 0;
                        const on = status === q.key;
                        return (
                          <button
                            key={q.key}
                            type="button"
                            onClick={() => selectStatus(q.key)}
                            aria-pressed={on}
                            className={`inline-flex h-6 cursor-pointer items-center gap-1 rounded-sm border-0 px-1.5 text-[11px] font-semibold transition ${on ? "bg-white text-neutral-900" : n > 0 ? "bg-white/[0.08] text-white/80 hover:bg-white/[0.14]" : "bg-transparent text-white/35 hover:text-white/60"}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${FILTER_TONES[q.tone].dot}`} aria-hidden />
                            {q.label}
                            <span className={`tabular-nums ${on ? "text-[#02665e]" : ""}`}>{n}</span>
                          </button>
                        );
                      })}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </header>
      {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}

      <section className="overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#0a1a19] via-[#0d2320] to-[#0a1f2e] shadow-[0_8px_32px_rgba(0,0,0,0.35)]"><div className="flex flex-col gap-3 px-4 py-4 sm:gap-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
        <div className="relative min-w-0"><Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-white/40" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search application ID, company, owner or provider" className="box-border h-11 w-full rounded-lg border border-white/15 bg-white/[0.07] pl-10 pr-10 text-sm font-medium text-white outline-none placeholder:text-white/35 focus:border-emerald-400/70 focus:ring-2 focus:ring-emerald-400/10" />{search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-white/10 text-white/60"><X className="h-3.5 w-3.5" /></button>}</div>
        <div className="flex min-w-0 flex-nowrap items-center gap-2"><p className="m-0 flex min-w-0 flex-1 items-center gap-2 truncate text-xs font-semibold text-white/80"><span className={`h-2 w-2 shrink-0 rounded-full ${FILTER_TONES[QUEUE_TONE_BY_KEY[status] ?? "blue"].dot}`} aria-hidden /><span className="truncate">{QUEUE_GROUPS.flatMap((group) => group.queues).find((entry) => entry.key === status)?.label ?? titleCase(status)}</span><span className="shrink-0 font-normal text-white/40">{QUEUE_GROUPS.find((group) => group.queues.some((entry) => entry.key === status))?.caption}</span></p><div className="flex shrink-0 items-center gap-1.5 border-l border-white/10 pl-2"><button type="button" onClick={() => void loadQueue(status)} aria-label="Refresh applications" className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/15 bg-white/[0.07] text-white/75"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button><button type="button" onClick={() => setShowFilters((value) => !value)} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold ${showFilters ? "border-emerald-400/70 bg-emerald-400/20 text-emerald-200" : "border-white/15 bg-white/[0.07] text-white/75"}`}><Filter className="h-4 w-4" />Filters{activeFilterCount > 0 && <span className="rounded-md bg-emerald-300/20 px-1.5 py-0.5 text-[10px]">{activeFilterCount}</span>}</button></div></div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/40 sm:text-xs"><span>Pick a queue in the stages above. Open a row to review the full application.</span><span className="inline-flex items-center gap-2 whitespace-nowrap font-semibold text-white/55"><span className={`h-1.5 w-1.5 rounded-full ${FILTER_TONES[QUEUE_TONE_BY_KEY[status] ?? "blue"].dot}`} />{visibleRows.length} of {queue?.total ?? 0} shown</span></div>
        {showFilters && <div className="space-y-3 border-t border-white/10 pt-4"><div className="flex items-center justify-between"><h2 className="m-0 text-sm font-semibold text-white/85">Advanced filters</h2><button type="button" onClick={() => { setProviderFilter(""); setEnvironmentFilter(""); setMinimumProperties(""); }} className="inline-flex items-center gap-1 rounded-md border-0 bg-white/[0.06] px-2 py-1 text-xs text-white/50"><X className="h-3 w-3" />Clear</button></div><div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          <label className="min-w-0 text-xs font-medium text-white/55"><span className="mb-1.5 block">Payment provider</span><span className="relative block"><select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} className={`${FILTER_CONTROL_CLASS} appearance-none pr-10`}><option value="" className="bg-[#0d2320]">All providers</option>{providers.map((provider) => <option key={provider} value={provider} className="bg-[#0d2320]">{titleCase(provider)}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" /></span></label>
          <label className="min-w-0 text-xs font-medium text-white/55"><span className="mb-1.5 block">Environment</span><span className="relative block"><select value={environmentFilter} onChange={(event) => setEnvironmentFilter(event.target.value)} className={`${FILTER_CONTROL_CLASS} appearance-none pr-10`}><option value="" className="bg-[#0d2320]">All environments</option>{environments.map((environment) => <option key={environment} value={environment} className="bg-[#0d2320]">{titleCase(environment)}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" /></span></label>
          <label className="min-w-0 text-xs font-medium text-white/55"><span className="mb-1.5 block">Minimum properties</span><input type="number" min="0" value={minimumProperties} onChange={(event) => setMinimumProperties(event.target.value)} placeholder="No minimum" className={`${FILTER_CONTROL_CLASS} [appearance:textfield] placeholder:text-white/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`} /></label>
        </div></div>}
      </div></section>

      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading ? <div className="flex min-h-40 items-center justify-center text-xs font-semibold text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin text-[#02665e]" />Loading applications</div> : visibleRows.length === 0 ? <div className="flex min-h-40 flex-col items-center justify-center gap-2 px-6 text-center"><Inbox className="h-7 w-7 text-slate-300" /><p className="m-0 text-xs font-semibold text-slate-500">No application matches the current filters.</p></div> : <>
          <div className="hidden w-full max-w-full overflow-x-auto overscroll-x-contain lg:block [scrollbar-gutter:stable]"><table className="w-full min-w-[1120px] table-fixed border-collapse text-left text-xs"><colgroup><col className="w-[7%]" /><col className="w-[20%]" /><col className="w-[13%]" /><col className="w-[12%]" /><col className="w-[8%]" /><col className="w-[7%]" /><col className="w-[13%]" /><col className="w-[14%]" /><col className="w-[6%]" /></colgroup>
            <thead><tr className="whitespace-nowrap border-b border-slate-200 bg-slate-50 [&>th]:px-3 [&>th]:py-3 [&>th]:font-semibold [&>th]:text-slate-600">{([['id', 'ID'], ['legalName', 'Company'], ['owner', 'Owner'], ['provider', 'Provider'], ['propertyCount', 'Properties'], ['version', 'Version'], ['submittedAt', 'Submitted']] as Array<[QueueSortKey, string]>).map(([field, label]) => <th key={field} scope="col" className={["propertyCount", "version"].includes(field) ? "text-center" : ""}><button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 border-0 bg-transparent p-0">{label} {sortIcon(field)}</button></th>)}<th scope="col">Status</th><th scope="col" className="text-center">Action</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{paginatedRows.map((row) => { const submitted = formatSubmittedAt(row.submittedAt); return <tr key={row.id} className="transition-colors hover:bg-slate-50 [&>td]:overflow-hidden [&>td]:px-3 [&>td]:py-3 [&>td]:align-middle"><td><span className="font-bold tabular-nums text-[#02665e]">#{row.id}</span></td><td><span className="block truncate font-semibold text-slate-900">{row.merchant.legalName || "Unnamed company"}</span>{row.merchant.tradingName && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{row.merchant.tradingName}</span>}</td><td><span className="block truncate text-slate-700">{row.merchant.owner?.name || "Not named"}</span></td><td><span className="block truncate font-medium text-slate-700">{titleCase(row.connection?.provider) || "Not assigned"}</span><span className="block truncate text-[10px] uppercase text-slate-400">{row.connection?.environment || "No environment"}</span></td><td className="text-center font-semibold tabular-nums text-slate-800">{row.merchant.propertyCount}</td><td className="text-center font-semibold tabular-nums text-slate-800">v{row.version}</td><td><span className="block whitespace-nowrap font-medium tabular-nums text-slate-700">{submitted.date}</span><span className="block text-[10px] text-slate-400">{submitted.time}</span></td><td><span className={`inline-flex max-w-full rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${statusTone(row.status)}`}><span className="truncate">{titleCase(row.status)}</span></span></td><td className="text-center"><Link href={recordHref("merchant-application", row.id)} aria-label={`Open application ${row.id}`} title="Open full application" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#02665e] no-underline transition hover:bg-emerald-50"><Eye className="h-4 w-4" /></Link></td></tr>; })}</tbody>
          </table></div>
          <div className="divide-y divide-slate-100 lg:hidden">{paginatedRows.map((row) => { const submitted = formatSubmittedAt(row.submittedAt); return <Link key={row.id} href={recordHref("merchant-application", row.id)} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-4 text-left no-underline transition hover:bg-slate-50"><span className="min-w-0"><span className="block text-[10px] font-bold text-[#02665e]">APPLICATION #{row.id}</span><span className="mt-1 block truncate text-sm font-semibold text-slate-900">{row.merchant.legalName || "Unnamed company"}</span><span className="block truncate text-xs text-slate-500">{row.merchant.owner?.name || "Owner not named"}</span></span><span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-[#02665e]"><Eye className="h-4 w-4" /></span><span className="col-span-2 grid grid-cols-2 gap-3 sm:grid-cols-4"><span><span className="block text-[9px] font-bold uppercase text-slate-400">Provider</span><span className="mt-1 block truncate text-xs text-slate-700">{titleCase(row.connection?.provider) || "Not assigned"}</span></span><span><span className="block text-[9px] font-bold uppercase text-slate-400">Properties</span><span className="mt-1 block text-xs text-slate-700">{row.merchant.propertyCount} · v{row.version}</span></span><span><span className="block text-[9px] font-bold uppercase text-slate-400">Submitted</span><span className="mt-1 block text-xs text-slate-700">{submitted.date}</span></span><span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${statusTone(row.status)}`}>{titleCase(row.status)}</span></span></Link>; })}</div>
          <div className="flex flex-col items-start justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center"><span>Showing {(currentPage - 1) * pageSize + 1} to {Math.min(currentPage * pageSize, visibleRows.length)} of {visibleRows.length}</span><div className="flex items-center gap-2"><button type="button" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage <= 1} className="rounded border border-slate-300 px-2.5 py-1 disabled:opacity-50">Previous</button><span className="font-medium">Page {currentPage} / {totalPages}</span><button type="button" onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))} disabled={currentPage >= totalPages} className="rounded border border-slate-300 px-2.5 py-1 disabled:opacity-50">Next</button></div></div>
        </>}
      </section>
    </div>
  );
}

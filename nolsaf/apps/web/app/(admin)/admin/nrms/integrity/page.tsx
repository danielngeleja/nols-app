"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { CountPill, SectionHeader, SummaryCard } from "../_components/CommercialUi";

type Signal = { id: number; propertyId: number; kind: string; severity: string; status: string; metricValue: number | null; baseline: number | null; details: any; detectedAt: string; property: { id: number; title: string } };

const SEVERITY_BADGE: Record<string, { badge: string; accent: string }> = {
  HIGH: { badge: "border-red-100 bg-red-50 text-red-700", accent: "bg-red-500" },
  ATTENTION: { badge: "border-amber-100 bg-amber-50 text-amber-700", accent: "bg-amber-400" },
};

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "ACKNOWLEDGED", label: "Acknowledged" },
  { value: "ALL", label: "All" },
];

const inputClass = "block min-h-9 w-full min-w-0 rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";

const SIGNAL_PAGE_SIZE = 10;

function shortDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function IntegrityPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [reasons, setReasons] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("OPEN");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiClient.get("/api/admin/nrms/integrity/signals", { params: { status: statusFilter } });
      setSignals(r.data?.signals ?? []);
      setError(null);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load integrity signals");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);
  useEffect(() => { void load(); }, [load]);

  const ack = async (s: Signal) => {
    setBusyId(s.id);
    setError(null);
    try {
      await apiClient.post(`/api/admin/nrms/integrity/signals/${s.id}/acknowledge`, { reason: reasons[s.id] });
      setNotice(`Signal on ${s.property.title} acknowledged.`);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Review failed");
    } finally {
      setBusyId(null);
    }
  };

  const filteredSignals = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return signals;
    return signals.filter((s) => s.property.title.toLowerCase().includes(q) || s.kind.toLowerCase().includes(q));
  }, [signals, query]);

  const pageCount = Math.max(1, Math.ceil(filteredSignals.length / SIGNAL_PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedSignals = filteredSignals.slice((currentPage - 1) * SIGNAL_PAGE_SIZE, currentPage * SIGNAL_PAGE_SIZE);

  const highCount = signals.filter((s) => s.severity === "HIGH").length;

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div id="nrms-integrity" className="min-w-0 w-full space-y-4 py-4">
      {/* Preflight is disabled in this project; without border-box, w-full controls overflow their container */}
      <style>{`
        #nrms-integrity, #nrms-integrity * { box-sizing: border-box; }
        #nrms-integrity [class~="border"] { border-style: solid; }
        #nrms-integrity .grid > * { min-width: 0; }
        #nrms-integrity .text-neutral-400 { color: #64748b; }
        #nrms-integrity .integrity-metrics > div { padding: 12px 16px; background: #f8fafc; border-radius: 12px; }
        #nrms-integrity .integrity-metrics > div > span { width: 36px; height: 36px; }
        #nrms-integrity h2 + p { white-space: normal; }
      `}</style>

      <Link href="/admin/nrms" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline"><ArrowLeft className="h-3.5 w-3.5" />NRMS directory</Link>
      <section className="flex flex-col gap-4 rounded-2xl border border-slate-800 bg-[linear-gradient(120deg,#102b3a_0%,#123f49_65%,#075e54_100%)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-200"><Activity className="h-5 w-5" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-200">NRMS integrity workspace</p>
              <span className="inline-flex rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-emerald-100">Detection only</span>
            </div>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Integrity signals</h1>
            <p className="mb-0 mt-1 text-xs leading-5 text-emerald-100">Review anomalies and record context before any enforcement action.</p>
          </div>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-xs font-bold text-white hover:bg-white/20"><RefreshCw className="h-4 w-4" />Refresh signals</button>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}
      {notice && <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{notice}</span></div>}

      <div className="integrity-metrics grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={ShieldAlert} label={statusFilter === "OPEN" ? "Open signals" : "Signals loaded"} value={String(signals.length)} detail={statusFilter === "OPEN" ? "Awaiting review" : `Filtered: ${STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label}`} tone={signals.length > 0 && statusFilter !== "ACKNOWLEDGED" ? "amber" : "slate"} />
        <SummaryCard icon={AlertTriangle} label="High severity" value={String(highCount)} detail="Needs priority review" tone={highCount > 0 ? "amber" : "emerald"} />
        <SummaryCard icon={Clock3} label="Detection window" value="Automated" detail="Runs continuously in the background" tone="blue" />
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={Activity} title="Signals" subtitle="Anomalies detected across properties" right={<CountPill count={filteredSignals.length} singular="signal" plural="signals" />} />
        <div className="flex flex-col gap-2.5 border-b border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search property or signal kind" className={`${inputClass} pl-9`} aria-label="Search signals" />
          </div>
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className={`${inputClass} font-bold sm:w-44 sm:shrink-0`} aria-label="Filter by review status">
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <div className="bg-slate-50/70 p-3 sm:p-4">
          {filteredSignals.length === 0 && (
            <div className={`flex items-start gap-3 rounded-xl p-4 ${signals.length === 0 ? "bg-emerald-50 text-emerald-800" : "bg-white text-slate-700"}`} role="status">
              {signals.length === 0 ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" /> : <Search className="mt-0.5 h-5 w-5 shrink-0" />}
              <div><p className="m-0 text-sm font-bold">{signals.length > 0 ? "No matching signals" : statusFilter === "OPEN" ? "No signals awaiting review" : "No signals in this view"}</p><p className="mb-0 mt-1 text-xs leading-5">{signals.length > 0 ? "Try a different property or signal kind." : "Detected anomalies will appear here. Enforcement always requires human review."}</p></div>
            </div>
          )}
          <div className="space-y-2.5">
            {pagedSignals.map((s) => {
              const severity = SEVERITY_BADGE[s.severity] ?? { badge: "border-neutral-200 bg-neutral-100 text-neutral-500", accent: "bg-neutral-300" };
              const reason = reasons[s.id] ?? "";
              const canAck = reason.trim().length >= 5 && s.status === "OPEN";
              const busy = busyId === s.id;
              return (
                <div key={s.id} className="relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_8px_24px_-24px_rgba(15,23,42,0.7)]">
                  <span className={`absolute inset-y-0 left-0 w-1 ${severity.accent}`} aria-hidden="true" />
                  <div className="p-3.5 pl-4 sm:p-4 sm:pl-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-bold">
                          <Link href={`/admin/nrms/${s.propertyId}`} className="truncate text-neutral-900 no-underline transition hover:text-emerald-700">{s.property.title}</Link>
                          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${severity.badge}`}>{s.severity}</span>
                          {s.status !== "OPEN" && <span className="shrink-0 rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{s.status}</span>}
                        </p>
                        <p className="mb-0 mt-1 text-xs text-neutral-600">{s.kind.replaceAll("_", " ")}</p>
                        <p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">Detected {shortDateTime(s.detectedAt)} · value {s.metricValue ?? "n/a"} · baseline {s.baseline ?? "n/a"}</p>
                      </div>
                    </div>
                    {s.status === "OPEN" && (
                      <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                        <input value={reason} onChange={(e) => setReasons({ ...reasons, [s.id]: e.target.value })} placeholder="Review note, at least 5 characters" className={inputClass} aria-label={`Review note for signal ${s.id}`} />
                        <button type="button" disabled={busy || !canAck} onClick={() => void ack(s)} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border-0 bg-emerald-700 px-3.5 text-xs font-bold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Acknowledge</button>
                        <Link href={`/admin/nrms/integrity/${s.propertyId}`} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 no-underline transition hover:bg-emerald-100">Timeline</Link>
                      </div>
                    )}
                    {s.status !== "OPEN" && (
                      <div className="mt-3">
                        <Link href={`/admin/nrms/integrity/${s.propertyId}`} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 no-underline transition hover:bg-emerald-100">Timeline</Link>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {filteredSignals.length > SIGNAL_PAGE_SIZE && (
          <div className="flex flex-col gap-2 border-t border-neutral-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="m-0 text-[11px] text-neutral-500">Showing <b className="font-bold text-neutral-700">{(currentPage - 1) * SIGNAL_PAGE_SIZE + 1}-{Math.min(currentPage * SIGNAL_PAGE_SIZE, filteredSignals.length)}</b> of {filteredSignals.length} signals</p>
            <div className="flex items-center gap-2">
              <button type="button" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></button>
              <span className="text-[11px] font-bold tabular-nums text-neutral-700">Page {currentPage} of {pageCount}</span>
              <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Next page"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

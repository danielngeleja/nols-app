"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Loader2, RefreshCw, Search, ShieldAlert } from "lucide-react";
import { CountPill, SectionHeader } from "../_components/CommercialUi";
import { useAdminHref } from "@/lib/adminRecordRefs";

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
  const recordHref = useAdminHref();
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
  const openSignals = useMemo(() => signals.filter((s) => s.status === "OPEN"), [signals]);
  const highOpen = openSignals.filter((s) => s.severity === "HIGH").length;
  /** Signal kinds firing most in the loaded view, for the watch panel. */
  const topKinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of signals) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, [signals]);
  const busiest = useMemo(() => {
    const counts = new Map<number, { title: string; count: number }>();
    for (const s of signals) {
      const row = counts.get(s.propertyId) ?? { title: s.property.title, count: 0 };
      row.count += 1;
      counts.set(s.propertyId, row);
    }
    return [...counts.values()].sort((a, b) => b.count - a.count)[0] ?? null;
  }, [signals]);
  const oldestWaiting = useMemo(() => {
    if (!openSignals.length) return "None";
    const oldest = Math.min(...openSignals.map((s) => new Date(s.detectedAt).getTime()));
    const hours = Math.floor((Date.now() - oldest) / 3_600_000);
    if (hours < 1) return "Under an hour";
    if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
    const days = Math.floor(hours / 24);
    return `${days} days`;
  }, [openSignals]);

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div id="nrms-integrity" className="min-w-0 w-full space-y-4">
      {/* Preflight is disabled in this project; without border-box, w-full controls overflow their container */}
      <style>{`
        #nrms-integrity, #nrms-integrity * { box-sizing: border-box; }
        #nrms-integrity [class~="border"] { border-style: solid; }
        #nrms-integrity .grid > * { min-width: 0; }
        #nrms-integrity .text-neutral-400 { color: #64748b; }
        #nrms-integrity h2 + p { white-space: normal; }
      `}</style>

      {/* Identity band with the watch panel, in the operator-record language */}
      <section className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_100%_0%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden="true" />
        <div className="relative grid min-w-0 gap-5 px-4 py-5 sm:px-6 sm:py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center">
          <div className="min-w-0">
            <Link href="/admin/nrms" className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/45 no-underline transition hover:text-emerald-300">
              <ArrowLeft className="h-3 w-3" aria-hidden /> NRMS directory
            </Link>
            <p className="m-0 mt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300/80">NRMS integrity workspace</p>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Integrity signals</h1>
            <p className="m-0 mt-1 text-[12px] text-white/60">Review anomalies and record context before any enforcement action.</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {highOpen > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-md bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-bold text-rose-200">
                  <span className="relative flex h-2 w-2" aria-hidden><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" /></span>
                  {highOpen} high-severity signal{highOpen === 1 ? "" : "s"} need priority review
                </span>
              ) : openSignals.length > 0 ? (
                <span className="inline-flex items-center gap-2 rounded-md bg-amber-400/15 px-2.5 py-1.5 text-[11px] font-bold text-amber-200">
                  <span className="relative flex h-2 w-2" aria-hidden><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" /></span>
                  {openSignals.length} signal{openSignals.length === 1 ? "" : "s"} awaiting review
                </span>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-md bg-emerald-400/10 px-2.5 py-1.5 text-[11px] font-bold text-emerald-200"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> No anomaly awaiting review</span>
              )}
            </div>
          </div>

          {/* Watch panel: what is firing, where, and for how long */}
          <div className="min-w-0 rounded-md bg-white/[0.04] p-4 ring-1 ring-white/10">
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Watch</p>
              <p className="m-0 text-[11px] text-white/55">{statusFilter === "OPEN" ? "Open signals" : `${STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label} signals`}</p>
            </div>
            {signals.length === 0 ? (
              <div className="mt-3 flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-400/10 ring-1 ring-emerald-400/30"><ShieldAlert className="h-4 w-4 text-emerald-300" aria-hidden /></span>
                <p className="m-0 text-[12px] text-white/60">Detection runs continuously. Anything unusual shows up here for a person to review first.</p>
              </div>
            ) : (
              <>
                <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-white/10" role="img" aria-label={`${highCount} high severity, ${signals.length - highCount} attention`}>
                  <span className="h-full bg-rose-400" style={{ width: `${(highCount / signals.length) * 100}%` }} />
                  <span className="h-full bg-amber-400" style={{ width: `${((signals.length - highCount) / signals.length) * 100}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-[10px] font-semibold text-white/50">
                  <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" aria-hidden /> High {highCount}</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden /> Attention {signals.length - highCount}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-1">
                  {topKinds.map(([kind, count]) => (
                    <span key={kind} className="inline-flex items-center gap-1.5 rounded bg-white/[0.06] px-2 py-1 text-[10px] font-semibold text-white/75">
                      {kind.replaceAll("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}
                      <span className="tabular-nums text-white/45">{count}</span>
                    </span>
                  ))}
                </div>
                <dl className="m-0 mt-3 grid grid-cols-2 gap-2 border-0 border-t border-solid border-white/10 pt-3">
                  <div className="min-w-0">
                    <dt className="text-[10px] font-semibold text-white/50">Most signals</dt>
                    <dd className="m-0 mt-0.5 truncate text-[12px] font-bold text-white/90">{busiest ? `${busiest.title} (${busiest.count})` : "-"}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] font-semibold text-white/50">Oldest waiting</dt>
                    <dd className="m-0 mt-0.5 truncate text-[12px] font-bold text-white/90">{oldestWaiting}</dd>
                  </div>
                </dl>
              </>
            )}
          </div>
        </div>

        {/* The detection-only promise and refresh */}
        <div className="relative flex min-w-0 flex-wrap items-center gap-2 border-0 border-t border-solid border-white/10 px-4 py-3 sm:px-6">
          <span className="inline-flex w-full items-center gap-1.5 text-[11px] text-white/45 sm:w-auto"><Activity className="h-3.5 w-3.5" aria-hidden /> Detection only: nothing is enforced without a person reviewing it first</span>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-white/[0.08] px-4 text-xs font-bold text-white transition hover:bg-white/15 sm:ml-auto sm:w-auto"
          >
            <RefreshCw className="h-4 w-4" aria-hidden /> Refresh signals
          </button>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}
      {notice && <div className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> <span>{notice}</span></div>}

      {/* Summary, joined cells like the operator statement's money strip */}
      <section aria-label="Signal summary" className="grid min-w-0 grid-cols-1 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-3">
        {[
          {
            Icon: ShieldAlert, label: statusFilter === "OPEN" ? "Open signals" : "Signals loaded", value: String(signals.length),
            detail: statusFilter === "OPEN" ? "Awaiting review" : `Filtered: ${STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label}`,
            ink: signals.length > 0 && statusFilter !== "ACKNOWLEDGED" ? "text-amber-600" : "text-neutral-400", iconTone: signals.length > 0 && statusFilter !== "ACKNOWLEDGED" ? "text-amber-500" : "text-neutral-300",
          },
          { Icon: AlertTriangle, label: "High severity", value: String(highCount), detail: "Needs priority review", ink: highCount > 0 ? "text-rose-600" : "text-neutral-400", iconTone: highCount > 0 ? "text-rose-500" : "text-neutral-300" },
          { Icon: Clock3, label: "Oldest waiting", value: oldestWaiting, detail: openSignals.length ? "Longest an open signal has waited" : "Nothing waiting", ink: openSignals.length ? "text-neutral-950" : "text-neutral-400", iconTone: "text-neutral-300" },
        ].map(({ Icon, label, value, detail, ink, iconTone }) => (
          <div key={label} className="min-w-0 bg-white px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="m-0 text-[11px] font-semibold text-neutral-500">{label}</p>
              <Icon className={`h-4 w-4 shrink-0 ${iconTone}`} aria-hidden />
            </div>
            <p className={`m-0 mt-1 break-words text-lg font-black tabular-nums tracking-tight ${ink}`}>{value}</p>
            <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400">{detail}</p>
          </div>
        ))}
      </section>

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
                          <Link href={recordHref("property", s.propertyId)} className="truncate text-neutral-900 no-underline transition hover:text-emerald-700">{s.property.title}</Link>
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
                        <Link href={recordHref("property", s.propertyId, { base: "/admin/nrms/integrity" })} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 no-underline transition hover:bg-emerald-100">Timeline</Link>
                      </div>
                    )}
                    {s.status !== "OPEN" && (
                      <div className="mt-3">
                        <Link href={recordHref("property", s.propertyId, { base: "/admin/nrms/integrity" })} className="inline-flex min-h-9 items-center justify-center rounded-lg border border-emerald-100 bg-emerald-50 px-3.5 text-xs font-bold text-emerald-800 no-underline transition hover:bg-emerald-100">Timeline</Link>
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

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, ArrowRightLeft, Ban, ChevronDown, LockKeyhole, Building2, CheckCircle2,
  ChevronLeft, ChevronRight, CircleDollarSign, Handshake, Hotel, Loader2,
  Eye, RefreshCw, RotateCcw, Save, Search, ShieldCheck, Users, X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type LinkStatus = "INVITED" | "REQUESTED" | "AGENT_ACCEPTED" | "ACTIVE" | "SUSPENDED" | "REJECTED" | "TERMINATED";
type Partnership = {
  id: number; status: LinkStatus; initiatedBy: string; requestedAt: string;
  hotelConsentStatus: string; hotelConsentedAt: string | null;
  agentConsentStatus: string; agentConsentedAt: string | null;
  activatedAt: string | null; suspendedAt: string | null; suspensionAuthority: "HOTEL" | "ADMIN" | null; terminatedAt: string | null;
  currency: string; paymentTerms: string; bookingMode: string;
  decisionReason: string | null; terminationReason: string | null; updatedAt: string;
  property: { id: number; title: string; region: string | null; status: string; nrmsActivatedAt: string | null; billingStatus: string | null; maxAgents: number; seatsInUse: number };
  agentAccount: { id: number; legalName: string; tradingName: string | null; status: string; verificationStatus: string; countryCode: string };
  _count: { rateAccess: number; bookingRequests: number; reservations: number };
};

const STATUS: Record<LinkStatus, { label: string; badge: string; dot: string }> = {
  INVITED: { label: "Hotel invited", badge: "border-sky-200 bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  REQUESTED: { label: "Operator requested", badge: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  AGENT_ACCEPTED: { label: "Agent accepted", badge: "border-cyan-200 bg-cyan-50 text-cyan-800", dot: "bg-cyan-500" },
  ACTIVE: { label: "Active", badge: "border-emerald-200 bg-emerald-50 text-emerald-800", dot: "bg-emerald-500" },
  SUSPENDED: { label: "Suspended", badge: "border-red-200 bg-red-50 text-red-700", dot: "bg-red-500" },
  REJECTED: { label: "Rejected", badge: "border-neutral-200 bg-neutral-100 text-neutral-600", dot: "bg-neutral-400" },
  TERMINATED: { label: "Terminated", badge: "border-neutral-300 bg-neutral-100 text-neutral-600", dot: "bg-neutral-500" },
};

const dateTime = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "Not recorded";
const displayName = (row: Partnership) => row.agentAccount.tradingName || row.agentAccount.legalName;

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="min-w-0 rounded-xl bg-white px-3.5 py-3 shadow-sm ring-1 ring-inset ring-neutral-200/70 transition hover:ring-neutral-300"><dt className="text-[9px] font-bold uppercase tracking-[.12em] text-neutral-400">{label}</dt><dd className="m-0 mt-1 break-words text-xs font-extrabold text-neutral-900">{value}</dd></div>;
}

export default function AdminNrmsPartnershipsPage() {
  const [rows, setRows] = useState<Partnership[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<LinkStatus | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [limitValue, setLimitValue] = useState("");
  const [limitReason, setLimitReason] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [resumeReason, setResumeReason] = useState("");
  const [confirmResume, setConfirmResume] = useState(false);
  const [lifecycleReady, setLifecycleReady] = useState(true);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await apiClient.get("/api/admin/nrms/commercial/partnerships", { params: { status, query: query.trim() || undefined, page, limit: 40 } });
      const next = (response.data?.partnerships ?? []) as Partnership[];
      setRows(next); setSummary(response.data?.summary ?? {}); setTotal(response.data?.pagination?.total ?? next.length); setPages(response.data?.pagination?.pages ?? 1); setLifecycleReady(response.data?.lifecycleReady !== false);
      setSelectedId((current) => next.some((row) => row.id === current) ? current : next[0]?.id ?? null);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Partnership portfolio could not be loaded"); }
    finally { setLoading(false); }
  }, [page, query, status]);

  useEffect(() => { const timer = setTimeout(() => void load(), 250); return () => clearTimeout(timer); }, [load]);
  useEffect(() => { setPage(1); setDetailOpen(false); }, [query, status]);
  const selected = useMemo(() => rows.find((row) => row.id === selectedId) ?? null, [rows, selectedId]);
  useEffect(() => { if (selected) setLimitValue(String(selected.property.maxAgents)); }, [selected]);

  useEffect(() => {
    if (!detailOpen) return;
    const priorOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = priorOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [detailOpen]);

  const selectRow = (row: Partnership) => { setSelectedId(row.id); setDetailOpen(true); setNotice(null); setError(null); setSuspendReason(""); setConfirmSuspend(false); setResumeReason(""); setConfirmResume(false); setDangerOpen(false); setLimitReason(""); };
  const financeError = (cause: any, fallback: string) => cause?.response?.data?.require2fa ? "Finance OTP verification is required. Complete re-authentication and retry." : cause?.response?.data?.error || fallback;

  const saveLimit = async () => {
    if (!selected || saving) return;
    const next = Number(limitValue);
    if (!Number.isInteger(next) || next < selected.property.seatsInUse || next > 1000) { setError(`Enter a whole-number limit between ${selected.property.seatsInUse} and 1000.`); return; }
    if (limitReason.trim().length < 5) { setError("Enter a reason of at least 5 characters for the audit log."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      await apiClient.post(`/api/admin/nrms/commercial/property/${selected.property.id}/agent-limit`, { maxAgents: next, reason: limitReason.trim() });
      setNotice(`Partner capacity updated to ${next}.`); setLimitReason(""); await load();
    } catch (cause: any) { setError(financeError(cause, "Partner capacity could not be updated")); }
    finally { setSaving(false); }
  };

  const suspend = async () => {
    if (!selected || saving || selected.status !== "ACTIVE") return;
    if (suspendReason.trim().length < 5) { setError("Enter a suspension reason of at least 5 characters."); return; }
    if (!confirmSuspend) { setError("Confirm that new booking activity must stop immediately."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      await apiClient.post(`/api/admin/nrms/commercial/partnerships/${selected.id}/suspend`, { reason: suspendReason.trim() });
      setNotice("Partnership suspended. New booking activity is blocked and both parties were notified."); setSuspendReason(""); setConfirmSuspend(false); setDangerOpen(false); await load();
    } catch (cause: any) { setError(financeError(cause, "Partnership could not be suspended")); }
    finally { setSaving(false); }
  };

  const resume = async () => {
    if (!selected || saving || selected.status !== "SUSPENDED" || selected.suspensionAuthority !== "ADMIN") return;
    if (resumeReason.trim().length < 5) { setError("Enter a resumption reason of at least 5 characters."); return; }
    if (!confirmResume) { setError("Confirm that central review is complete before resuming the partnership."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      await apiClient.post(`/api/admin/nrms/commercial/partnerships/${selected.id}/resume`, { reason: resumeReason.trim() });
      setNotice("Partnership resumed by central authority. Both parties were notified."); setResumeReason(""); setConfirmResume(false); setDangerOpen(false); await load();
    } catch (cause: any) { setError(financeError(cause, "Partnership could not be resumed")); }
    finally { setSaving(false); }
  };

  const activeCount = summary.ACTIVE ?? 0;
  const pendingCount = (summary.REQUESTED ?? 0) + (summary.INVITED ?? 0) + (summary.AGENT_ACCEPTED ?? 0);

  return (
    <main id="nrms-partnership-portfolio" className="w-full min-w-0 max-w-none px-3 pb-5 pt-4 sm:px-5 sm:pt-5 lg:px-6">
      <style>{`#nrms-partnership-portfolio, #nrms-partnership-portfolio * { box-sizing: border-box; }`}</style>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <header className="partnership-workspace-header relative overflow-hidden bg-[linear-gradient(120deg,#102b3a_0%,#123f49_65%,#075e54_100%)] p-4 sm:p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full border border-emerald-700/[.06]" />
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-emerald-900/[.06] pb-3"><Link href="/admin/nrms" className="inline-flex min-h-8 items-center gap-2 text-[11px] font-bold text-emerald-700 no-underline hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> NRMS directory</Link><span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-neutral-400"><ShieldCheck className="h-3.5 w-3.5" /> Every control is audited</span></div>
        <div className="relative mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3.5"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-800 text-white shadow-sm"><Handshake className="h-5 w-5" /></span><div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-700">NRMS commercial trust</p><h1 className="m-0 mt-1 text-xl font-extrabold tracking-tight text-neutral-950 sm:text-2xl">Accommodation partnerships</h1><p className="m-0 mt-1 max-w-2xl text-xs leading-5 text-neutral-500">Review consent, compliance and property capacity without leaving the portfolio.</p></div></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-700 shadow-sm hover:border-emerald-200 hover:text-emerald-800 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></div>
      </header>

      <section className="partnership-metrics grid min-w-0 border-0 border-t border-solid border-neutral-100 bg-slate-50/70 min-[480px]:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Relationships", value: total, detail: "Filtered portfolio", Icon: Handshake, tone: "bg-emerald-50 text-emerald-700", divider: "" },
          { label: "Active", value: activeCount, detail: "Booking eligible", Icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700", divider: "border-0 border-t border-solid border-neutral-100 sm:border-l sm:border-t-0" },
          { label: "Awaiting consent", value: pendingCount, detail: "Requests & invitations", Icon: Users, tone: "bg-amber-50 text-amber-700", divider: "border-0 border-t border-solid border-neutral-100 lg:border-l lg:border-t-0" },
          { label: "Suspended", value: summary.SUSPENDED ?? 0, detail: "New bookings blocked", Icon: Ban, tone: "bg-neutral-100 text-neutral-600", divider: "border-0 border-t border-solid border-neutral-100 sm:border-l lg:border-t-0" },
        ].map(({ label, value, detail, Icon, tone, divider }) => <div key={label} className={`flex items-center gap-3 p-4 ${divider}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></span><div><p className="m-0 text-[9px] font-bold uppercase tracking-[.12em] text-neutral-400">{label}</p><p className="m-0 mt-0.5 text-lg font-black text-neutral-950">{value}</p><p className="m-0 text-[10px] text-neutral-400">{detail}</p></div></div>)}
      </section>
      {(error || notice) && <div className={`mx-4 mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm sm:mx-5 ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role={error ? "alert" : "status"}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || notice}</span></div>}
      {!lifecycleReady && <div className="mx-4 mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-900 sm:mx-5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><p className="m-0 font-bold">Partnership lifecycle activation is pending</p><p className="m-0 mt-0.5 text-amber-800">Legacy hotel–agent relationships remain visible. Consent and suspension controls unlock after the prepared lifecycle migration is applied.</p></div></div>}

      <section className="partnership-filters grid min-w-0 grid-cols-1 items-center gap-3 border-0 border-t border-solid border-neutral-100 bg-white p-4 sm:grid-cols-[minmax(0,1fr)_minmax(160px,220px)] sm:px-5 lg:grid-cols-[minmax(0,1fr)_220px_auto]">
        <label className="relative min-w-0 flex-1"><span className="sr-only">Search partnerships</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search hotel, operator or registration" className="min-h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-xs outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100" /></label>
        <label className="sm:w-56"><span className="sr-only">Relationship status</span><select value={status} onChange={(event) => setStatus(event.target.value as LinkStatus | "ALL")} className="min-h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs font-semibold text-neutral-700 outline-none focus:border-emerald-400 focus:bg-white"><option value="ALL">All relationship states</option>{Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
        <span className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 px-3 text-[10px] font-bold text-emerald-800">{total} {total === 1 ? "relationship" : "relationships"}</span>
      </section>

      <div className="border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 p-4 sm:p-5">{loading ? <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white p-5"><div className="flex items-center gap-3"><div className="h-10 w-10 animate-pulse rounded-xl bg-neutral-100" /><div className="space-y-2"><div className="h-3 w-40 animate-pulse rounded bg-neutral-100" /><div className="h-2.5 w-64 max-w-full animate-pulse rounded bg-neutral-100" /></div></div><div className="mt-5 space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-neutral-50" />)}</div></section> : rows.length === 0 ? <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="mx-auto flex min-h-[260px] max-w-lg flex-col items-center justify-center px-6 py-9 text-center"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Handshake className="h-6 w-6" /></span><p className="m-0 mt-4 text-base font-extrabold text-neutral-900">{query.trim() || status !== "ALL" ? "No partnerships match these filters" : "No accommodation partnerships yet"}</p><p className="m-0 mt-1.5 text-xs leading-5 text-neutral-500">{query.trim() || status !== "ALL" ? "Clear the search or choose another relationship state." : "Verified operators and hotel invitations will appear here as soon as a bilateral relationship is created."}</p><div className="mt-5 flex flex-wrap justify-center gap-2">{query.trim() || status !== "ALL" ? <button type="button" onClick={() => { setQuery(""); setStatus("ALL"); }} className="inline-flex min-h-10 items-center rounded-xl border border-emerald-700 bg-emerald-700 px-4 text-xs font-bold text-white hover:bg-emerald-800">Clear filters</button> : <Link href="/admin/nrms/agents" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-xs font-bold text-emerald-800 no-underline hover:bg-emerald-100"><ShieldCheck className="h-4 w-4" /> Review agency identities</Link>}<Link href="/admin/nrms" className="inline-flex min-h-10 items-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-700 no-underline hover:bg-neutral-50">NRMS directory</Link></div></div></section> : <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div className="hidden w-full min-w-0 max-w-full overflow-x-auto md:block">
          <table className="partnership-register w-full min-w-[1200px] table-fixed border-collapse text-left">
            <caption className="sr-only">Accommodation partnership portfolio</caption>
            <colgroup>{[17, 15, 13, 11, 15, 13, 9, 7].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
            <thead><tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-50 text-[9px] font-bold uppercase tracking-[.11em] text-neutral-400"><th className="px-4 py-3">Operator</th><th className="px-4 py-3">Hotel</th><th className="px-4 py-3">Relationship</th><th className="px-4 py-3">Verification</th><th className="px-4 py-3">Consent</th><th className="px-4 py-3">Terms</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3 text-right">Details</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} onClick={() => selectRow(row)} className="cursor-pointer border-0 border-b border-solid border-neutral-100 text-xs transition-colors last:border-b-0 hover:bg-emerald-50"><td className="max-w-52 px-4 py-3.5"><p className="m-0 truncate font-extrabold text-neutral-900">{displayName(row)}</p><p className="m-0 mt-1 truncate text-[10px] text-neutral-400">{row.agentAccount.legalName} · {row.agentAccount.countryCode}</p></td><td className="max-w-48 px-4 py-3.5"><p className="m-0 truncate font-bold text-neutral-800">{row.property.title}</p><p className="m-0 mt-1 truncate text-[10px] text-neutral-400">{row.property.region || "Region not recorded"}</p></td><td className="px-4 py-3.5"><span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-bold ${STATUS[row.status].badge}`}>{STATUS[row.status].label}</span><p className="m-0 mt-1.5 text-[9px] text-neutral-400">{row.initiatedBy === "AGENT" ? "Operator initiated" : "Hotel initiated"}</p></td><td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1.5 text-[10px] font-bold ${row.agentAccount.verificationStatus === "VERIFIED" ? "text-emerald-700" : "text-amber-700"}`}><span className={`h-1.5 w-1.5 rounded-full ${row.agentAccount.verificationStatus === "VERIFIED" ? "bg-emerald-500" : "bg-amber-500"}`} />{row.agentAccount.verificationStatus}</span></td><td className="px-4 py-3.5"><p className="m-0 text-[10px] font-semibold text-neutral-700">Hotel: {row.hotelConsentStatus}</p><p className="m-0 mt-1 text-[10px] font-semibold text-neutral-500">Operator: {row.agentConsentStatus}</p></td><td className="px-4 py-3.5"><p className="m-0 text-[10px] font-bold text-neutral-700">{row.currency} · {row.bookingMode}</p><p className="m-0 mt-1 text-[10px] text-neutral-400">{row.paymentTerms} · {row._count.rateAccess} rate grants</p></td><td className="px-4 py-3.5"><p className="m-0 text-[10px] font-bold text-neutral-700">{row._count.bookingRequests} requests</p><p className="m-0 mt-1 text-[10px] text-neutral-400">{row._count.reservations} reservations</p></td><td className="px-4 py-3.5 text-right"><button type="button" onClick={(event) => { event.stopPropagation(); selectRow(row); }} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100" aria-label={`View ${displayName(row)} partnership details`} title="View details"><Eye className="h-4 w-4" /></button></td></tr>)}</tbody>
          </table>
        </div>
        <div className="divide-y divide-neutral-100 md:hidden">{rows.map((row) => <article key={row.id} onClick={() => selectRow(row)} className="cursor-pointer p-4 transition-colors hover:bg-emerald-50/60 active:bg-emerald-50"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="m-0 truncate text-sm font-extrabold text-neutral-900">{displayName(row)}</p><p className="m-0 mt-1 truncate text-xs font-medium text-neutral-500">{row.property.title}</p></div><button type="button" onClick={(event) => { event.stopPropagation(); selectRow(row); }} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800" aria-label={`View ${displayName(row)} partnership details`}><Eye className="h-4 w-4" /></button></div><div className="mt-3 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${STATUS[row.status].badge}`}>{STATUS[row.status].label}</span><span className="rounded-full bg-neutral-100 px-2 py-1 text-[9px] font-bold text-neutral-600">{row.agentAccount.verificationStatus}</span><span className="ml-auto text-[10px] text-neutral-400">{row.currency} · {row.bookingMode}</span></div></article>)}</div>
        {pages > 1 && <div className="flex items-center justify-between border-0 border-t border-solid border-neutral-100 p-3"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="text-[10px] font-bold text-neutral-500">Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div>}
      </section>}</div>

      {mounted && detailOpen && selected && createPortal((() => {
        const pretty = (v: string | null | undefined) => {
          const t = String(v || "").replace(/[_-]+/g, " ").trim().toLowerCase();
          return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Not recorded";
        };
        const daysBetween = (a?: string | null, b?: string | null) => (a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)) : null);
        const dayOnly = (v?: string | null) => (v ? new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(v)) : null);

        // Readiness with a plain-language fix for anything pending.
        const steps = [
          { label: "Agency identity", value: pretty(selected.agentAccount.verificationStatus), ready: selected.agentAccount.status === "ACTIVE" && selected.agentAccount.verificationStatus === "VERIFIED", fix: "Verify the operator's agency identity", href: "/admin/nrms/agents" },
          { label: "Hotel consent", value: pretty(selected.hotelConsentStatus), ready: selected.hotelConsentStatus === "ACCEPTED", fix: "Waiting for the hotel to accept", href: null },
          { label: "Operator consent", value: pretty(selected.agentConsentStatus), ready: selected.agentConsentStatus === "ACCEPTED", fix: "Waiting for the operator to accept", href: null },
          { label: "Property billing", value: pretty(selected.property.billingStatus || "Unavailable"), ready: ["TRIAL", "ACTIVE", "WARNING"].includes(selected.property.billingStatus || ""), fix: "Property must settle NRMS billing", href: `/admin/nrms/${selected.property.id}` },
        ];
        const done = steps.filter((s) => s.ready).length;
        const blockers = steps.filter((s) => !s.ready);
        const eligible = selected.status === "ACTIVE" && blockers.length === 0;

        // Relationship journey.
        const journey = [
          { label: selected.initiatedBy === "AGENT" ? "Operator requested" : "Hotel invited", at: selected.requestedAt, done: true },
          { label: "Hotel accepted", at: selected.hotelConsentedAt, done: selected.hotelConsentStatus === "ACCEPTED" },
          { label: "Operator accepted", at: selected.agentConsentedAt, done: selected.agentConsentStatus === "ACCEPTED" },
          selected.status === "SUSPENDED"
            ? { label: `Suspended${selected.suspensionAuthority ? ` by ${selected.suspensionAuthority === "ADMIN" ? "NoLSAF" : "hotel"}` : ""}`, at: selected.suspendedAt, done: true, danger: true }
            : selected.status === "TERMINATED" || selected.status === "REJECTED"
              ? { label: STATUS[selected.status].label, at: selected.terminatedAt, done: true, danger: true }
              : { label: "Active", at: selected.activatedAt, done: selected.status === "ACTIVE" },
        ] as Array<{ label: string; at: string | null; done: boolean; danger?: boolean }>;
        const consentDays = daysBetween(selected.requestedAt, [selected.hotelConsentedAt, selected.agentConsentedAt].filter(Boolean).sort().pop() || null);

        // Capacity preview.
        const used = selected.property.seatsInUse;
        const cap = selected.property.maxAgents;
        const draft = Number(limitValue);
        const draftValid = Number.isInteger(draft) && draft >= used && draft <= 1000;
        const delta = draftValid ? draft - cap : 0;
        const previewCap = draftValid ? draft : cap;
        const capacityReady = draftValid && delta !== 0 && limitReason.trim().length >= 5;
        const capacityHint = !Number.isInteger(draft) || limitValue === ""
          ? "Enter a whole number"
          : draft < used
            ? `Cannot go below the ${used} seats already in use`
            : draft > 1000
              ? "The maximum is 1000"
              : delta === 0
                ? "No change yet"
                : limitReason.trim().length < 5
                  ? `${5 - limitReason.trim().length} more characters in the reason`
                  : `${delta > 0 ? "Adds" : "Removes"} ${Math.abs(delta)} ${Math.abs(delta) === 1 ? "seat" : "seats"}`;

        const conversion = selected._count.bookingRequests > 0 ? Math.round((selected._count.reservations / selected._count.bookingRequests) * 100) : null;
        const canSuspend = lifecycleReady && selected.status === "ACTIVE";
        const canResume = lifecycleReady && selected.status === "SUSPENDED" && selected.suspensionAuthority === "ADMIN";

        return (
        <div
          id="nrms-partnership-detail-modal"
          className="box-border fixed inset-0 z-[90] flex items-stretch justify-center bg-neutral-950/55 p-0 backdrop-blur-sm sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="partnership-detail-title"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOpen(false); }}
        >
          <style>{`#nrms-partnership-detail-modal, #nrms-partnership-detail-modal * { box-sizing: border-box; }`}</style>
          <aside className="box-border relative flex h-full w-full min-w-0 max-w-[1400px] flex-col overflow-hidden bg-white shadow-[0_32px_100px_-24px_rgba(0,0,0,.55)] sm:rounded-2xl">
            {/* Header */}
            <header className="shrink-0 border-0 border-b border-solid border-neutral-200 bg-white">
              <div className="flex items-start gap-4 px-4 pt-4 sm:px-6 sm:pt-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#102b3a] text-emerald-300"><Handshake className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <span className="font-mono">Partnership #{selected.id}</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border border-solid px-2 py-0.5 text-[11px] font-semibold ${STATUS[selected.status].badge}`}><span className={`h-1.5 w-1.5 rounded-full ${STATUS[selected.status].dot}`} />{STATUS[selected.status].label}</span>
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${eligible ? "text-emerald-700" : "text-amber-700"}`}>
                      {eligible ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      {eligible ? "Booking eligible" : selected.status !== "ACTIVE" ? "Not taking bookings" : `Blocked by ${blockers.map((b) => b.label.toLowerCase()).join(", ")}`}
                    </span>
                  </p>
                  <h2 id="partnership-detail-title" className="m-0 mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-xl font-bold tracking-tight text-neutral-950">
                    <span className="truncate">{displayName(selected)}</span>
                    <ArrowRightLeft className="h-4 w-4 flex-shrink-0 text-neutral-300" aria-hidden />
                    <span className="truncate text-neutral-700">{selected.property.title}</span>
                  </h2>
                </div>
                <button type="button" onClick={() => setDetailOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-800" aria-label="Close partnership details"><X className="h-4 w-4" /></button>
              </div>

              {/* Journey */}
              <ol className="m-0 mt-4 flex list-none gap-0 overflow-x-auto px-4 pb-4 sm:px-6">
                {journey.map((step, i) => (
                  <li key={step.label} className="flex min-w-[9.5rem] flex-1 items-start gap-2">
                    <span className="flex flex-col items-center">
                      <span className={`grid h-6 w-6 place-items-center rounded-full ${step.danger ? "bg-rose-600 text-white" : step.done ? "bg-emerald-600 text-white" : "border-2 border-solid border-neutral-300 bg-white text-neutral-300"}`}>
                        {step.danger ? <Ban className="h-3.5 w-3.5" /> : step.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-neutral-300" />}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-xs font-semibold ${step.danger ? "text-rose-700" : step.done ? "text-neutral-900" : "text-neutral-400"}`}>{step.label}</span>
                        {i < journey.length - 1 && <span className={`hidden h-px flex-1 sm:block ${journey[i + 1].done ? "bg-emerald-300" : "bg-neutral-200"}`} />}
                      </span>
                      <span className="block truncate text-[11px] text-neutral-400">{step.at ? dayOnly(step.at) : step.done ? "Date not recorded" : "Pending"}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </header>

            {(error || notice) && (
              <div className={`mx-4 mt-3 flex shrink-0 items-start gap-2 rounded-xl border border-solid px-3 py-2.5 text-xs sm:mx-6 ${error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`} role={error ? "alert" : "status"}>
                {error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                <span className="flex-1">{error || notice}</span>
                <button type="button" onClick={() => { setError(null); setNotice(null); }} className="border-0 bg-transparent p-0 text-xs font-semibold opacity-80 hover:underline">Dismiss</button>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
                {/* Left rail */}
                <aside className="space-y-6 border-0 border-b border-solid border-neutral-200 bg-neutral-50 p-4 sm:p-5 lg:border-b-0 lg:border-r">
                  {/* Readiness */}
                  <section>
                    <div className="flex items-center justify-between gap-2">
                      <p className="m-0 text-xs font-semibold text-neutral-800">Booking readiness</p>
                      <span className="text-[11px] tabular-nums text-neutral-500">{done} of {steps.length}</span>
                    </div>
                    <div className="mt-2 flex gap-1" aria-hidden>
                      {steps.map((s) => <span key={s.label} className={`h-1.5 flex-1 rounded-full ${s.ready ? "bg-emerald-500" : "bg-amber-400"}`} />)}
                    </div>
                    <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
                      {steps.map((s) => (
                        <li key={s.label} className={`rounded-lg px-3 py-2 ${s.ready ? "bg-white" : "border border-solid border-amber-200 bg-amber-50/60"}`}>
                          <div className="flex items-center gap-2">
                            {s.ready ? <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 flex-shrink-0 text-amber-600" />}
                            <span className="min-w-0 flex-1 text-xs text-neutral-600">{s.label}</span>
                            <span className={`truncate text-xs font-semibold ${s.ready ? "text-neutral-900" : "text-amber-800"}`}>{s.value}</span>
                          </div>
                          {!s.ready && (
                            <p className="m-0 mt-1 flex items-center gap-1 pl-6 text-[11px] text-amber-800">
                              {s.fix}
                              {s.href && <Link href={s.href} className="ml-auto inline-flex items-center gap-0.5 font-semibold text-amber-900 no-underline hover:underline">Open <ChevronRight className="h-3 w-3" /></Link>}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>

                  {/* Parties */}
                  <section>
                    <p className="m-0 text-xs font-semibold text-neutral-800">Parties</p>
                    <div className="mt-2 overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                      <div className="flex items-center gap-3 px-3 py-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Users className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-[11px] text-neutral-400">Tour operator · {selected.agentAccount.countryCode}</p>
                          <p className="m-0 truncate text-sm font-semibold text-neutral-900">{displayName(selected)}</p>
                          {selected.agentAccount.tradingName && selected.agentAccount.tradingName !== selected.agentAccount.legalName && <p className="m-0 truncate text-[11px] text-neutral-500">Legal: {selected.agentAccount.legalName}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 border-0 border-t border-solid border-neutral-100 px-3 py-2.5">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-50 text-sky-700"><Hotel className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-[11px] text-neutral-400">Accommodation · {selected.property.region || "Region not recorded"}</p>
                          <p className="m-0 truncate text-sm font-semibold text-neutral-900">{selected.property.title}</p>
                        </div>
                        <Link href={`/admin/nrms/${selected.property.id}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 no-underline hover:bg-neutral-100 hover:text-neutral-700" aria-label="Open property"><ChevronRight className="h-4 w-4" /></Link>
                      </div>
                    </div>
                  </section>

                  {/* Activity funnel */}
                  <section>
                    <p className="m-0 text-xs font-semibold text-neutral-800">Activity</p>
                    <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200">
                      {[["Rate grants", selected._count.rateAccess], ["Requests", selected._count.bookingRequests], ["Bookings", selected._count.reservations]].map(([label, value]) => (
                        <div key={label} className="bg-white px-2 py-2.5 text-center">
                          <p className="m-0 text-xl font-bold tabular-nums leading-none text-neutral-900">{value}</p>
                          <p className="m-0 mt-1 text-[10px] text-neutral-500">{label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="m-0 mt-2 text-[11px] text-neutral-500">
                      {conversion == null ? "No booking requests yet." : <><span className="font-semibold text-neutral-900">{conversion}%</span> of requests became bookings.</>}
                      {selected._count.rateAccess === 0 && " No rates shared, so the operator cannot quote."}
                    </p>
                  </section>
                </aside>

                {/* Main */}
                <div className="min-w-0 space-y-5 p-4 sm:p-6">
                  {/* Agreement */}
                  <section className="rounded-xl border border-solid border-neutral-200 bg-white">
                    <div className="flex items-center gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-3 sm:px-5">
                      <CircleDollarSign className="h-4 w-4 text-neutral-500" />
                      <h3 className="m-0 text-sm font-semibold text-neutral-900">Agreement</h3>
                      <span className="ml-auto text-[11px] text-neutral-400">Updated {dayOnly(selected.updatedAt)}</span>
                    </div>
                    <div className="grid gap-px bg-neutral-100 sm:grid-cols-2 xl:grid-cols-4">
                      {[
                        { label: "Currency", value: selected.currency, sub: null },
                        { label: "Payment", value: pretty(selected.paymentTerms), sub: selected.paymentTerms === "PREPAID" ? "Operator pays before arrival" : null },
                        { label: "Booking mode", value: pretty(selected.bookingMode), sub: selected.bookingMode === "INSTANT" ? "Confirms without hotel approval" : selected.bookingMode === "REQUEST" ? "Hotel approves each booking" : null },
                        { label: "Initiated by", value: selected.initiatedBy === "AGENT" ? "Tour operator" : "Hotel", sub: consentDays != null ? `Both sides agreed in ${consentDays} ${consentDays === 1 ? "day" : "days"}` : null },
                      ].map((f) => (
                        <div key={f.label} className="min-w-0 bg-white px-4 py-3 sm:px-5">
                          <p className="m-0 text-[11px] text-neutral-400">{f.label}</p>
                          <p className="m-0 mt-0.5 truncate text-sm font-semibold text-neutral-900">{f.value}</p>
                          {f.sub && <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-500">{f.sub}</p>}
                        </div>
                      ))}
                    </div>
                    <dl className="m-0 grid gap-x-6 gap-y-2 border-0 border-t border-solid border-neutral-100 px-4 py-3 text-xs sm:grid-cols-3 sm:px-5">
                      <div className="flex justify-between gap-2 sm:block"><dt className="text-neutral-400">Requested</dt><dd className="m-0 text-neutral-800">{dateTime(selected.requestedAt)}</dd></div>
                      <div className="flex justify-between gap-2 sm:block"><dt className="text-neutral-400">Hotel consent</dt><dd className="m-0 text-neutral-800">{selected.hotelConsentedAt ? dateTime(selected.hotelConsentedAt) : pretty(selected.hotelConsentStatus)}</dd></div>
                      <div className="flex justify-between gap-2 sm:block"><dt className="text-neutral-400">Operator consent</dt><dd className="m-0 text-neutral-800">{selected.agentConsentedAt ? dateTime(selected.agentConsentedAt) : pretty(selected.agentConsentStatus)}</dd></div>
                    </dl>
                    {(selected.decisionReason || selected.terminationReason) && (
                      <p className="m-0 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 text-xs italic text-neutral-600 sm:px-5">&ldquo;{selected.terminationReason || selected.decisionReason}&rdquo;</p>
                    )}
                  </section>

                  {/* Capacity */}
                  <section className="rounded-xl border border-solid border-neutral-200 bg-white">
                    <div className="flex flex-wrap items-center gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-3 sm:px-5">
                      <Building2 className="h-4 w-4 text-neutral-500" />
                      <h3 className="m-0 text-sm font-semibold text-neutral-900">Partner capacity for {selected.property.title}</h3>
                      <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-neutral-500"><LockKeyhole className="h-3 w-3" /> Finance OTP</span>
                    </div>
                    <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      {/* Live seat map */}
                      <div>
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="m-0 text-xs text-neutral-500">Seats</p>
                          <p className="m-0 text-xs text-neutral-500">
                            <span className="text-2xl font-bold tabular-nums text-neutral-900">{used}</span> / {previewCap} used
                            {delta !== 0 && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${delta > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{delta > 0 ? `+${delta}` : delta}</span>}
                          </p>
                        </div>
                        {previewCap <= 40 ? (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {Array.from({ length: Math.max(previewCap, cap) }).map((_, i) => {
                              const inUse = i < used;
                              const removed = i >= previewCap;
                              const added = i >= cap && i < previewCap;
                              return (
                                <span
                                  key={i}
                                  className={`h-6 w-6 rounded-md transition ${
                                    inUse ? "bg-emerald-600" : removed ? "border border-dashed border-rose-300 bg-rose-50" : added ? "border-2 border-solid border-emerald-400 bg-emerald-50" : "border border-solid border-neutral-200 bg-white"
                                  }`}
                                  title={inUse ? "In use" : removed ? "Will be removed" : added ? "New seat" : "Open"}
                                />
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, (used / previewCap) * 100)}%` }} /></div>
                        )}
                        <p className="m-0 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-500">
                          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> In use</span>
                          <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-solid border-neutral-300 bg-white" /> Open</span>
                          {delta > 0 && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border-2 border-solid border-emerald-400 bg-emerald-50" /> New</span>}
                          {delta < 0 && <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-rose-300 bg-rose-50" /> Removed</span>}
                        </p>
                      </div>

                      {/* Editor */}
                      <div className="space-y-3">
                        <div>
                          <p className="m-0 text-xs font-semibold text-neutral-800">Maximum partners</p>
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="inline-flex h-10 items-center overflow-hidden rounded-lg border border-solid border-neutral-200">
                              <button type="button" onClick={() => setLimitValue(String(Math.max(used, (Number(limitValue) || cap) - 1)))} disabled={saving || Number(limitValue) <= used} className="h-full w-10 border-0 bg-white text-lg text-neutral-500 hover:bg-neutral-50 disabled:opacity-40" aria-label="Decrease">-</button>
                              <input
                                type="number"
                                min={used}
                                max={1000}
                                value={limitValue}
                                onChange={(event) => setLimitValue(event.target.value)}
                                className="h-full w-16 border-0 border-x border-solid border-neutral-200 bg-white text-center font-mono text-sm font-semibold tabular-nums text-neutral-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                aria-label="Maximum partners"
                              />
                              <button type="button" onClick={() => setLimitValue(String(Math.min(1000, (Number(limitValue) || cap) + 1)))} disabled={saving || Number(limitValue) >= 1000} className="h-full w-10 border-0 bg-white text-lg text-neutral-500 hover:bg-neutral-50 disabled:opacity-40" aria-label="Increase">+</button>
                            </div>
                            {delta !== 0 && (
                              <button type="button" onClick={() => setLimitValue(String(cap))} className="border-0 bg-transparent p-0 text-xs font-semibold text-neutral-500 hover:text-neutral-800 hover:underline">Reset to {cap}</button>
                            )}
                            <span className="ml-auto text-[11px] text-neutral-400">Min {used}</span>
                          </div>
                        </div>
                        <label className="block text-xs font-semibold text-neutral-800">
                          Audit reason
                          <input value={limitReason} onChange={(event) => setLimitReason(event.target.value)} maxLength={300} placeholder="Why this capacity is changing" className="mt-1.5 min-h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm font-normal text-neutral-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                        </label>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className={`m-0 text-xs ${capacityReady ? "text-emerald-700" : draftValid || limitValue === "" ? "text-neutral-500" : "text-rose-600"}`}>{capacityHint}</p>
                          <button type="button" onClick={() => void saveLimit()} disabled={saving || !capacityReady} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {delta !== 0 && draftValid ? `Set capacity to ${draft}` : "Save capacity"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Danger zone */}
                  <section className={`rounded-xl border border-solid ${canSuspend ? "border-rose-200" : canResume ? "border-emerald-200" : "border-neutral-200"} bg-white`}>
                    <button
                      type="button"
                      onClick={() => setDangerOpen((v) => !v)}
                      disabled={!canSuspend && !canResume}
                      aria-expanded={dangerOpen}
                      className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3 text-left disabled:cursor-default sm:px-5"
                    >
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${canResume ? "bg-emerald-50 text-emerald-700" : canSuspend ? "bg-rose-50 text-rose-600" : "bg-neutral-100 text-neutral-400"}`}>
                        {canResume ? <RotateCcw className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-neutral-900">{canResume ? "Resume partnership" : "Emergency suspension"}</span>
                        <span className="block text-xs text-neutral-500">
                          {canSuspend
                            ? "Stops new bookings now. Existing reservations and audit records stay."
                            : canResume
                              ? "Suspended by NoLSAF. Clear it once central review is complete."
                              : !lifecycleReady
                                ? "Unlocks after the lifecycle migration is applied."
                                : selected.status === "SUSPENDED"
                                  ? "Suspended by the hotel. Only the hotel can lift it."
                                  : `Only available for active partnerships. Current state: ${STATUS[selected.status].label}.`}
                        </span>
                      </span>
                      {(canSuspend || canResume) && <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${dangerOpen ? "rotate-180" : ""}`} />}
                    </button>

                    {dangerOpen && canSuspend && (
                      <div className="space-y-3 border-0 border-t border-solid border-rose-100 bg-rose-50/40 px-4 py-4 sm:px-5">
                        <label className="block text-xs font-semibold text-neutral-800">
                          Suspension reason
                          <textarea value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} maxLength={300} rows={3} placeholder="The compliance, security or commercial reason" className="mt-1.5 w-full resize-none rounded-lg border border-solid border-rose-200 bg-white p-3 font-[inherit] text-sm font-normal text-neutral-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
                        </label>
                        <label className="flex cursor-pointer items-start gap-2.5 text-xs text-neutral-700">
                          <input type="checkbox" checked={confirmSuspend} onChange={(event) => setConfirmSuspend(event.target.checked)} className="mt-0.5 h-4 w-4 accent-rose-600" />
                          <span>New bookings between <b>{displayName(selected)}</b> and <b>{selected.property.title}</b> must stop immediately. Both parties will be notified.</span>
                        </label>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setDangerOpen(false)} className="h-10 rounded-lg border-0 bg-transparent px-3 text-sm font-semibold text-neutral-500 hover:text-neutral-800">Cancel</button>
                          <button type="button" onClick={() => void suspend()} disabled={saving || !confirmSuspend || suspendReason.trim().length < 5} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border-0 bg-rose-600 px-4 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-45">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Suspend now
                          </button>
                        </div>
                      </div>
                    )}

                    {dangerOpen && canResume && (
                      <div className="space-y-3 border-0 border-t border-solid border-emerald-100 bg-emerald-50/40 px-4 py-4 sm:px-5">
                        <label className="block text-xs font-semibold text-neutral-800">
                          Resumption reason
                          <textarea value={resumeReason} onChange={(event) => setResumeReason(event.target.value)} maxLength={300} rows={3} placeholder="Why the central suspension can now be cleared" className="mt-1.5 w-full resize-none rounded-lg border border-solid border-emerald-200 bg-white p-3 font-[inherit] text-sm font-normal text-neutral-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                        </label>
                        <label className="flex cursor-pointer items-start gap-2.5 text-xs text-neutral-700">
                          <input type="checkbox" checked={confirmResume} onChange={(event) => setConfirmResume(event.target.checked)} className="mt-0.5 h-4 w-4 accent-emerald-600" />
                          <span>Central review is complete and booking activity may resume.</span>
                        </label>
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setDangerOpen(false)} className="h-10 rounded-lg border-0 bg-transparent px-3 text-sm font-semibold text-neutral-500 hover:text-neutral-800">Cancel</button>
                          <button type="button" onClick={() => void resume()} disabled={saving || !confirmResume || resumeReason.trim().length < 5} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border-0 bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-45">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Resume now
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>

            <footer className="flex shrink-0 items-center gap-3 border-0 border-t border-solid border-neutral-200 bg-white px-4 py-2.5 sm:px-6">
              <p className="m-0 hidden items-center gap-1.5 text-[11px] text-neutral-400 sm:flex"><ShieldCheck className="h-3.5 w-3.5" /> Every protected change is written to the NRMS audit trail.</p>
              <button type="button" onClick={() => setDetailOpen(false)} className="ml-auto inline-flex h-9 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50">Close</button>
            </footer>
          </aside>
        </div>
        );
      })(),
        document.body
      )}
      </section>
    </main>
  );
}

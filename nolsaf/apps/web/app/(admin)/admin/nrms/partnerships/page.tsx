"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Ban, Building2, CheckCircle2,
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

  const selectRow = (row: Partnership) => { setSelectedId(row.id); setDetailOpen(true); setNotice(null); setError(null); setSuspendReason(""); setConfirmSuspend(false); setResumeReason(""); setConfirmResume(false); };
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
      setNotice("Partnership suspended. New booking activity is blocked and both parties were notified."); setSuspendReason(""); setConfirmSuspend(false); await load();
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
      setNotice("Partnership resumed by central authority. Both parties were notified."); setResumeReason(""); setConfirmResume(false); await load();
    } catch (cause: any) { setError(financeError(cause, "Partnership could not be resumed")); }
    finally { setSaving(false); }
  };

  const activeCount = summary.ACTIVE ?? 0;
  const pendingCount = (summary.REQUESTED ?? 0) + (summary.INVITED ?? 0) + (summary.AGENT_ACCEPTED ?? 0);

  return (
    <main id="nrms-partnership-portfolio" className="mx-auto w-full max-w-[1320px] px-3 pb-28 pt-4 sm:px-5 sm:pt-5 lg:px-6 lg:pb-10">
      <style>{`#nrms-partnership-portfolio, #nrms-partnership-portfolio * { box-sizing: border-box; }`}</style>
      <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white shadow-[0_24px_65px_-52px_rgba(15,23,42,.48)]">
      <header className="relative overflow-hidden bg-[linear-gradient(135deg,#ffffff_0%,#f3faf7_62%,#ebf7f3_100%)] p-4 sm:p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full border border-emerald-700/[.06]" />
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-emerald-900/[.06] pb-3"><Link href="/admin/nrms" className="inline-flex min-h-8 items-center gap-2 text-[11px] font-bold text-emerald-700 no-underline hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> NRMS directory</Link><span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-neutral-400"><ShieldCheck className="h-3.5 w-3.5" /> Every control is audited</span></div>
        <div className="relative mt-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-3.5"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-800 text-white shadow-sm"><Handshake className="h-5 w-5" /></span><div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-700">NRMS commercial trust</p><h1 className="m-0 mt-1 text-xl font-extrabold tracking-tight text-neutral-950 sm:text-2xl">Accommodation partnerships</h1><p className="m-0 mt-1 max-w-2xl text-xs leading-5 text-neutral-500">Review consent, compliance and property capacity without leaving the portfolio.</p></div></div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-10 w-fit items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-700 shadow-sm hover:border-emerald-200 hover:text-emerald-800 disabled:opacity-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button></div>
      </header>

      <section className="grid border-0 border-t border-solid border-neutral-100 bg-white sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Relationships", value: total, detail: "Filtered portfolio", Icon: Handshake, tone: "bg-emerald-50 text-emerald-700", divider: "" },
          { label: "Active", value: activeCount, detail: "Booking eligible", Icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700", divider: "border-0 border-t border-solid border-neutral-100 sm:border-l sm:border-t-0" },
          { label: "Awaiting consent", value: pendingCount, detail: "Requests & invitations", Icon: Users, tone: "bg-amber-50 text-amber-700", divider: "border-0 border-t border-solid border-neutral-100 lg:border-l lg:border-t-0" },
          { label: "Suspended", value: summary.SUSPENDED ?? 0, detail: "New bookings blocked", Icon: Ban, tone: "bg-neutral-100 text-neutral-600", divider: "border-0 border-t border-solid border-neutral-100 sm:border-l lg:border-t-0" },
        ].map(({ label, value, detail, Icon, tone, divider }) => <div key={label} className={`flex items-center gap-3 p-4 ${divider}`}><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></span><div><p className="m-0 text-[9px] font-bold uppercase tracking-[.12em] text-neutral-400">{label}</p><p className="m-0 mt-0.5 text-lg font-black text-neutral-950">{value}</p><p className="m-0 text-[10px] text-neutral-400">{detail}</p></div></div>)}
      </section>
      {(error || notice) && <div className={`mx-4 mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm sm:mx-5 ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role={error ? "alert" : "status"}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || notice}</span></div>}
      {!lifecycleReady && <div className="mx-4 mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-xs leading-5 text-amber-900 sm:mx-5"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><p className="m-0 font-bold">Partnership lifecycle activation is pending</p><p className="m-0 mt-0.5 text-amber-800">Legacy hotel–agent relationships remain visible. Consent and suspension controls unlock after the prepared lifecycle migration is applied.</p></div></div>}

      <section className="mt-4 flex flex-col gap-3 border-0 border-t border-solid border-neutral-100 bg-white p-4 sm:flex-row sm:items-center sm:px-5">
        <label className="relative min-w-0 flex-1"><span className="sr-only">Search partnerships</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search hotel, operator or registration" className="min-h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-xs outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100" /></label>
        <label className="sm:w-56"><span className="sr-only">Relationship status</span><select value={status} onChange={(event) => setStatus(event.target.value as LinkStatus | "ALL")} className="min-h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 text-xs font-semibold text-neutral-700 outline-none focus:border-emerald-400 focus:bg-white"><option value="ALL">All relationship states</option>{Object.entries(STATUS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
        <span className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 px-3 text-[10px] font-bold text-emerald-800">{total} {total === 1 ? "relationship" : "relationships"}</span>
      </section>

      <div className="border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 p-4 sm:p-5">{loading ? <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white p-5"><div className="flex items-center gap-3"><div className="h-10 w-10 animate-pulse rounded-xl bg-neutral-100" /><div className="space-y-2"><div className="h-3 w-40 animate-pulse rounded bg-neutral-100" /><div className="h-2.5 w-64 max-w-full animate-pulse rounded bg-neutral-100" /></div></div><div className="mt-5 space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-neutral-50" />)}</div></section> : rows.length === 0 ? <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white"><div className="mx-auto flex min-h-[260px] max-w-lg flex-col items-center justify-center px-6 py-9 text-center"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Handshake className="h-6 w-6" /></span><p className="m-0 mt-4 text-base font-extrabold text-neutral-900">{query.trim() || status !== "ALL" ? "No partnerships match these filters" : "No accommodation partnerships yet"}</p><p className="m-0 mt-1.5 text-xs leading-5 text-neutral-500">{query.trim() || status !== "ALL" ? "Clear the search or choose another relationship state." : "Verified operators and hotel invitations will appear here as soon as a bilateral relationship is created."}</p><div className="mt-5 flex flex-wrap justify-center gap-2">{query.trim() || status !== "ALL" ? <button type="button" onClick={() => { setQuery(""); setStatus("ALL"); }} className="inline-flex min-h-10 items-center rounded-xl border border-emerald-700 bg-emerald-700 px-4 text-xs font-bold text-white hover:bg-emerald-800">Clear filters</button> : <Link href="/admin/nrms/agents" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-xs font-bold text-emerald-800 no-underline hover:bg-emerald-100"><ShieldCheck className="h-4 w-4" /> Review agency identities</Link>}<Link href="/admin/nrms" className="inline-flex min-h-10 items-center rounded-xl border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-700 no-underline hover:bg-neutral-50">NRMS directory</Link></div></div></section> : <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white">
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1050px] border-collapse text-left">
            <thead><tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-50 text-[9px] font-bold uppercase tracking-[.11em] text-neutral-400"><th className="px-4 py-3">Operator</th><th className="px-4 py-3">Hotel</th><th className="px-4 py-3">Relationship</th><th className="px-4 py-3">Verification</th><th className="px-4 py-3">Consent</th><th className="px-4 py-3">Terms</th><th className="px-4 py-3">Activity</th><th className="px-4 py-3 text-right">Details</th></tr></thead>
            <tbody>{rows.map((row) => <tr key={row.id} onClick={() => selectRow(row)} className="cursor-pointer border-0 border-b border-solid border-neutral-100 text-xs transition-colors last:border-b-0 hover:bg-emerald-50"><td className="max-w-52 px-4 py-3.5"><p className="m-0 truncate font-extrabold text-neutral-900">{displayName(row)}</p><p className="m-0 mt-1 truncate text-[10px] text-neutral-400">{row.agentAccount.legalName} · {row.agentAccount.countryCode}</p></td><td className="max-w-48 px-4 py-3.5"><p className="m-0 truncate font-bold text-neutral-800">{row.property.title}</p><p className="m-0 mt-1 truncate text-[10px] text-neutral-400">{row.property.region || "Region not recorded"}</p></td><td className="px-4 py-3.5"><span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-bold ${STATUS[row.status].badge}`}>{STATUS[row.status].label}</span><p className="m-0 mt-1.5 text-[9px] text-neutral-400">{row.initiatedBy === "AGENT" ? "Operator initiated" : "Hotel initiated"}</p></td><td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1.5 text-[10px] font-bold ${row.agentAccount.verificationStatus === "VERIFIED" ? "text-emerald-700" : "text-amber-700"}`}><span className={`h-1.5 w-1.5 rounded-full ${row.agentAccount.verificationStatus === "VERIFIED" ? "bg-emerald-500" : "bg-amber-500"}`} />{row.agentAccount.verificationStatus}</span></td><td className="px-4 py-3.5"><p className="m-0 text-[10px] font-semibold text-neutral-700">Hotel: {row.hotelConsentStatus}</p><p className="m-0 mt-1 text-[10px] font-semibold text-neutral-500">Operator: {row.agentConsentStatus}</p></td><td className="px-4 py-3.5"><p className="m-0 text-[10px] font-bold text-neutral-700">{row.currency} · {row.bookingMode}</p><p className="m-0 mt-1 text-[10px] text-neutral-400">{row.paymentTerms} · {row._count.rateAccess} rate grants</p></td><td className="px-4 py-3.5"><p className="m-0 text-[10px] font-bold text-neutral-700">{row._count.bookingRequests} requests</p><p className="m-0 mt-1 text-[10px] text-neutral-400">{row._count.reservations} reservations</p></td><td className="px-4 py-3.5 text-right"><button type="button" onClick={(event) => { event.stopPropagation(); selectRow(row); }} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100" aria-label={`View ${displayName(row)} partnership details`} title="View details"><Eye className="h-4 w-4" /></button></td></tr>)}</tbody>
          </table>
        </div>
        <div className="divide-y divide-neutral-100 md:hidden">{rows.map((row) => <article key={row.id} onClick={() => selectRow(row)} className="cursor-pointer p-4 transition-colors hover:bg-emerald-50/60 active:bg-emerald-50"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="m-0 truncate text-sm font-extrabold text-neutral-900">{displayName(row)}</p><p className="m-0 mt-1 truncate text-xs font-medium text-neutral-500">{row.property.title}</p></div><button type="button" onClick={(event) => { event.stopPropagation(); selectRow(row); }} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800" aria-label={`View ${displayName(row)} partnership details`}><Eye className="h-4 w-4" /></button></div><div className="mt-3 flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${STATUS[row.status].badge}`}>{STATUS[row.status].label}</span><span className="rounded-full bg-neutral-100 px-2 py-1 text-[9px] font-bold text-neutral-600">{row.agentAccount.verificationStatus}</span><span className="ml-auto text-[10px] text-neutral-400">{row.currency} · {row.bookingMode}</span></div></article>)}</div>
        {pages > 1 && <div className="flex items-center justify-between border-0 border-t border-solid border-neutral-100 p-3"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button><span className="text-[10px] font-bold text-neutral-500">Page {page} of {pages}</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => Math.min(pages, value + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button></div>}
      </section>}</div>

      {mounted && detailOpen && selected && createPortal(
        <div
          id="nrms-partnership-detail-modal"
          className="box-border fixed inset-0 z-[90] flex items-center justify-center bg-neutral-950/55 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="partnership-detail-title"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOpen(false); }}
        >
          <style>{`#nrms-partnership-detail-modal, #nrms-partnership-detail-modal * { box-sizing: border-box; }`}</style>
          <aside className="box-border relative flex h-[90vh] w-full max-w-[1400px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_32px_100px_-24px_rgba(0,0,0,.55)] sm:border sm:border-white/20">
            <header className="flex shrink-0 items-center justify-between gap-4 border-0 border-b border-solid border-neutral-100 bg-[linear-gradient(135deg,#ffffff_0%,#f3faf7_62%,#ebf7f3_100%)] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
              <div className="flex min-w-0 items-center gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm ring-1 ring-inset ring-emerald-800/10"><Handshake className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-[.18em] text-emerald-700">Partnership #{selected.id}</span>
                  <h2 id="partnership-detail-title" className="m-0 mt-1 truncate text-xl font-extrabold tracking-tight text-neutral-950 sm:text-2xl">{displayName(selected)}</h2>
                  <p className="m-0 mt-1.5 flex items-center gap-1.5 text-xs text-neutral-500"><Hotel className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{selected.property.title}{selected.property.region ? ` · ${selected.property.region}` : ""}</span></p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2.5 sm:gap-3.5">
                <span className={`hidden items-center rounded-full border px-3 py-1 text-[10px] font-bold sm:inline-flex ${STATUS[selected.status].badge}`}>{STATUS[selected.status].label}</span>
                <button type="button" onClick={() => setDetailOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-800" aria-label="Close partnership details"><X className="h-4 w-4" /></button>
              </div>
            </header>

            {(error || notice) && <div className={`mx-4 mt-4 flex shrink-0 items-start gap-2 rounded-xl border p-3 text-xs sm:mx-6 lg:mx-8 ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role={error ? "alert" : "status"}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || notice}</span></div>}

            <div className="min-h-0 flex-1 overflow-y-auto">
             <div className="grid lg:grid-cols-[300px_minmax(0,1fr)]">
              <aside className="border-0 border-b border-solid border-neutral-200 bg-neutral-50 p-4 sm:p-5 lg:border-b-0 lg:border-r lg:p-6">
                <section>
                  <p className="m-0 mb-3 text-[9px] font-bold uppercase tracking-[.14em] text-neutral-400">Relationship parties</p>
                  <div className="space-y-2.5">
                    <div className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-inset ring-neutral-200/70"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm"><Users className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="m-0 text-[9px] font-bold uppercase tracking-wider text-emerald-600">Tour operator</p><p className="m-0 mt-0.5 truncate text-sm font-extrabold text-neutral-900">{displayName(selected)}</p><p className="m-0 mt-0.5 truncate text-[10px] text-neutral-500">{selected.agentAccount.legalName}</p></div><span className="shrink-0 rounded-md bg-neutral-100 px-1.5 py-0.5 text-[9px] font-bold text-neutral-600">{selected.agentAccount.countryCode}</span></div>
                    <div className="flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-sm ring-1 ring-inset ring-neutral-200/70"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-sm"><Hotel className="h-5 w-5" /></span><div className="min-w-0 flex-1"><p className="m-0 text-[9px] font-bold uppercase tracking-wider text-sky-600">Accommodation</p><p className="m-0 mt-0.5 truncate text-sm font-extrabold text-neutral-900">{selected.property.title}</p><p className="m-0 mt-0.5 truncate text-[10px] text-neutral-500">{selected.property.region || "Region not recorded"}</p></div></div>
                  </div>
                </section>

                {(() => {
                  const steps = [
                    { label: "Agency identity", value: selected.agentAccount.verificationStatus, ready: selected.agentAccount.status === "ACTIVE" && selected.agentAccount.verificationStatus === "VERIFIED" },
                    { label: "Hotel consent", value: selected.hotelConsentStatus, ready: selected.hotelConsentStatus === "ACCEPTED" },
                    { label: "Operator consent", value: selected.agentConsentStatus, ready: selected.agentConsentStatus === "ACCEPTED" },
                    { label: "Property billing", value: selected.property.billingStatus || "Unavailable", ready: ["TRIAL", "ACTIVE", "WARNING"].includes(selected.property.billingStatus || "") },
                  ];
                  const done = steps.filter((step) => step.ready).length;
                  const allReady = done === steps.length;
                  return (
                    <section className="mt-6">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <p className="m-0 text-[9px] font-bold uppercase tracking-[.14em] text-neutral-400">Control readiness</p>
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold ${allReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}><ShieldCheck className="h-3 w-3" />{done}/{steps.length}</span>
                      </div>
                      <ol className="relative m-0 list-none rounded-2xl bg-white p-4 shadow-sm ring-1 ring-inset ring-neutral-200/70">
                        {steps.map((step, index) => (
                          <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
                            {index < steps.length - 1 && <span aria-hidden className="absolute left-[13px] top-8 h-[calc(100%-1.25rem)] w-px bg-neutral-200" />}
                            <span className={`relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full ${step.ready ? "bg-emerald-600 text-white shadow-sm" : "bg-white text-amber-500 ring-2 ring-inset ring-amber-300"}`}>{step.ready ? <CheckCircle2 className="h-4 w-4" /> : <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}</span>
                            <div className="min-w-0 flex-1 pt-0.5">
                              <p className="m-0 text-[9px] font-bold uppercase tracking-wider text-neutral-400">{step.label}</p>
                              <p className="m-0 mt-0.5 truncate text-xs font-extrabold text-neutral-900">{step.value.replaceAll("_", " ")}</p>
                            </div>
                            <span className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${step.ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{step.ready ? "Ready" : "Pending"}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  );
                })()}

                <section className="mt-6">
                  <p className="m-0 mb-3 text-[9px] font-bold uppercase tracking-[.14em] text-neutral-400">Portfolio activity</p>
                  <div className="grid grid-cols-3 gap-2">
                    {[["Rates", selected._count.rateAccess], ["Requests", selected._count.bookingRequests], ["Bookings", selected._count.reservations]].map(([label, value]) => (
                      <div key={label} className="rounded-2xl bg-white p-3 text-center shadow-sm ring-1 ring-inset ring-neutral-200/70">
                        <p className="m-0 text-2xl font-black leading-none text-neutral-900">{value}</p>
                        <p className="m-0 mt-1.5 text-[8px] font-bold uppercase tracking-wide text-neutral-400">{label}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </aside>

              <div className="bg-neutral-50/60 p-4 sm:p-6 lg:p-8">
                <div className="mx-auto max-w-[980px] space-y-5">
                  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-inset ring-neutral-200/70">
                    <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-100 bg-neutral-50/70 px-4 py-3.5 sm:px-5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm"><CircleDollarSign className="h-4 w-4" /></span><div><h3 className="m-0 text-sm font-extrabold text-neutral-900">Agreement overview</h3><p className="m-0 mt-0.5 text-[10px] text-neutral-500">Commercial terms, consent record and relationship evidence.</p></div></div>
                    <div className="grid gap-5 p-4 sm:p-5 xl:grid-cols-2">
                      <div><p className="m-0 text-[9px] font-bold uppercase tracking-[.13em] text-neutral-400">Commercial terms</p><dl className="mb-0 mt-3 grid grid-cols-2 gap-2.5"><DetailField label="Currency" value={selected.currency} /><DetailField label="Payment" value={selected.paymentTerms} /><DetailField label="Booking mode" value={selected.bookingMode} /><DetailField label="Rate grants" value={selected._count.rateAccess} /></dl></div>
                      <div><p className="m-0 text-[9px] font-bold uppercase tracking-[.13em] text-neutral-400">Relationship record</p><dl className="mb-0 mt-3 grid grid-cols-2 gap-2.5"><DetailField label="Initiated by" value={selected.initiatedBy === "AGENT" ? "Tour operator" : "Hotel"} /><DetailField label="Requested" value={dateTime(selected.requestedAt)} /><DetailField label="Hotel consent" value={selected.hotelConsentedAt ? dateTime(selected.hotelConsentedAt) : selected.hotelConsentStatus} /><DetailField label="Operator consent" value={selected.agentConsentedAt ? dateTime(selected.agentConsentedAt) : selected.agentConsentStatus} /></dl></div>
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-inset ring-emerald-200/70">
                    <div className="flex flex-col gap-3 border-0 border-b border-solid border-emerald-100 bg-emerald-50/50 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div className="flex items-center gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm"><Building2 className="h-4 w-4" /></span><div><h3 className="m-0 text-sm font-extrabold text-neutral-900">Property partner capacity</h3><p className="m-0 mt-0.5 text-[10px] text-neutral-500">Control how many active agency relationships this property can hold.</p></div></div><span className="w-fit shrink-0 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[9px] font-bold text-emerald-800">Finance OTP protected</span></div>
                    <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,250px)_minmax(0,1fr)]">
                      {(() => {
                        const used = selected.property.seatsInUse;
                        const cap = selected.property.maxAgents;
                        const remaining = Math.max(0, cap - used);
                        const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 0;
                        const full = cap > 0 && used >= cap;
                        return (
                          <div className="flex flex-col justify-between gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4">
                            <div>
                              <div className="flex items-center justify-between gap-2">
                                <p className="m-0 text-[9px] font-bold uppercase tracking-wider text-emerald-700">Seats in use</p>
                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${full ? "bg-amber-100 text-amber-800" : "bg-white text-emerald-700"}`}>{full ? "Full" : `${remaining} open`}</span>
                              </div>
                              {cap > 0 && cap <= 12
                                ? <div className="mt-3 flex flex-wrap gap-1.5">{Array.from({ length: cap }).map((_, index) => <span key={index} className={`h-7 w-7 rounded-lg transition ${index < used ? "bg-emerald-600 shadow-sm ring-1 ring-inset ring-emerald-700" : "border border-dashed border-emerald-300 bg-white"}`} />)}</div>
                                : <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-emerald-100"><div className={`h-full rounded-full ${full ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${pct}%` }} /></div>}
                            </div>
                            <p className="m-0 flex items-baseline gap-1.5"><span className="text-3xl font-black leading-none text-neutral-900">{used}</span><span className="text-base font-bold text-neutral-400">/ {cap}</span><span className="ml-0.5 text-[11px] font-semibold text-neutral-500">occupied</span></p>
                          </div>
                        );
                      })()}
                      <div className="flex flex-col justify-center gap-3">
                        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
                          <label className="grid content-start text-[9px] font-bold uppercase tracking-wider text-neutral-500">Maximum partners<input type="number" min={selected.property.seatsInUse} max={1000} value={limitValue} onChange={(event) => setLimitValue(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm font-bold text-neutral-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label>
                          <label className="grid content-start text-[9px] font-bold uppercase tracking-wider text-neutral-500">Audit reason<input value={limitReason} onChange={(event) => setLimitReason(event.target.value)} maxLength={300} placeholder="Explain why this capacity is changing" className="mt-1.5 min-h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-xs font-normal normal-case tracking-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label>
                        </div>
                        <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-emerald-100 pt-3"><p className="m-0 hidden items-center gap-1.5 text-[10px] font-medium text-neutral-400 sm:flex"><ShieldCheck className="h-3.5 w-3.5" /> Verified with a finance OTP before it applies.</p><button type="button" onClick={() => void saveLimit()} disabled={saving} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-800 bg-emerald-800 px-5 text-xs font-bold text-white transition hover:bg-emerald-900 disabled:opacity-50 sm:ml-auto sm:w-auto">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save capacity</button></div>
                      </div>
                    </div>
                  </section>

                  <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-inset ring-red-200/70">
                    <div className="flex items-start gap-3 bg-red-50 px-4 py-3.5 sm:px-5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-red-500 to-red-700 text-white shadow-sm"><Ban className="h-4 w-4" /></span><div><h3 className="m-0 text-sm font-extrabold text-neutral-900">Emergency suspension</h3><p className="m-0 mt-0.5 text-[10px] leading-4 text-neutral-500">Stops new booking activity immediately while preserving existing reservation records and audit evidence.</p></div></div>
                    <div className="p-4 sm:p-5">
                      {lifecycleReady && selected.status === "ACTIVE" ? (
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                          <label className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">Suspension reason<textarea value={suspendReason} onChange={(event) => setSuspendReason(event.target.value)} maxLength={300} rows={4} placeholder="Record the compliance, security or commercial reason…" className="mt-1.5 w-full resize-none rounded-xl border border-red-200 bg-white p-3 text-xs font-normal leading-5 normal-case tracking-normal outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" /></label>
                          <div className="rounded-xl border border-red-100 bg-red-50/60 p-3.5"><label className="flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-neutral-700"><input type="checkbox" checked={confirmSuspend} onChange={(event) => setConfirmSuspend(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-red-600 focus:ring-red-500" /><span>I confirm that new booking activity must stop immediately.</span></label><button type="button" onClick={() => void suspend()} disabled={saving || !confirmSuspend} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-700 bg-red-700 px-5 text-xs font-bold text-white transition hover:bg-red-800 disabled:opacity-45">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Suspend partnership</button></div>
                        </div>
                      ) : lifecycleReady && selected.status === "SUSPENDED" && selected.suspensionAuthority === "ADMIN" ? (
                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                          <label className="text-[9px] font-bold uppercase tracking-wider text-neutral-500">Resumption reason<textarea value={resumeReason} onChange={(event) => setResumeReason(event.target.value)} maxLength={300} rows={4} placeholder="Record why the central suspension can now be cleared…" className="mt-1.5 w-full resize-none rounded-xl border border-emerald-200 bg-white p-3 text-xs font-normal leading-5 normal-case tracking-normal outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label>
                          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3.5"><label className="flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-neutral-700"><input type="checkbox" checked={confirmResume} onChange={(event) => setConfirmResume(event.target.checked)} className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500" /><span>I confirm that central review is complete and booking activity may resume.</span></label><button type="button" onClick={() => void resume()} disabled={saving || !confirmResume} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-emerald-800 bg-emerald-800 px-5 text-xs font-bold text-white transition hover:bg-emerald-900 disabled:opacity-45">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Resume partnership</button></div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs font-semibold leading-5 text-neutral-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /><span>{!lifecycleReady ? "Suspension controls unlock after the lifecycle migration is applied." : selected.status === "SUSPENDED" ? "This hotel-owned suspension can be managed by the hotel; central controls cannot silently override it." : `Suspension is available only for an active partnership. Current state: ${STATUS[selected.status].label}.`}</span></div>
                      )}
                    </div>
                  </section>
                </div>
              </div>
             </div>
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
              <p className="m-0 hidden items-center gap-1.5 text-[10px] font-semibold text-neutral-400 sm:flex"><ShieldCheck className="h-3.5 w-3.5" /> Every protected change is written to the NRMS audit trail.</p>
              <button type="button" onClick={() => setDetailOpen(false)} className="ml-auto inline-flex min-h-10 items-center justify-center rounded-xl border border-neutral-200 bg-white px-5 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50">Close details</button>
            </footer>
          </aside>
        </div>,
        document.body
      )}
      </section>
    </main>
  );
}

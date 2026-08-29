"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, ArrowUpDown, BadgeCheck, Building2, CheckCircle2,
  ChevronLeft, ChevronRight, ExternalLink, Eye, FileCheck2, FileWarning, Loader2, Mail, MapPin, Phone, Search,
  ShieldCheck, Users, X, XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";
type SortField = "name" | "submitted" | "hotels" | "status";
type SortDir = "asc" | "desc";
type Agency = {
  id: number; legalName: string; tradingName?: string | null;
  registrationNo?: string | null; tin?: string | null; licenseNo?: string | null;
  contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null; address?: string | null;
  countryCode: string; nationality?: string | null;
  documents?: Array<{ type?: string; url?: string; uploadedAt?: string }> | null;
  status: string; verificationStatus: VerificationStatus; verificationNote?: string | null;
  verifiedAt?: string | null; createdAt: string;
  primaryUser: { id: number; email?: string | null; fullName?: string | null };
  _count: { propertyLinks: number };
};

const STATUS: Record<VerificationStatus, { label: string; shortLabel: string; pill: string; active: string }> = {
  PENDING: { label: "Pending review", shortLabel: "Pending", pill: "border-amber-200 bg-amber-50 text-amber-800", active: "border-amber-300 bg-amber-50 text-amber-900 shadow-sm" },
  VERIFIED: { label: "Verified agencies", shortLabel: "Verified", pill: "border-emerald-200 bg-emerald-50 text-emerald-800", active: "border-emerald-300 bg-emerald-50 text-emerald-900 shadow-sm" },
  REJECTED: { label: "Rejected agencies", shortLabel: "Rejected", pill: "border-red-200 bg-red-50 text-red-700", active: "border-red-200 bg-red-50 text-red-800 shadow-sm" },
};

const PAGE_SIZE = 10;

const submittedDate = (value: string) => new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return `${words[0]?.[0] ?? "A"}${words[1]?.[0] ?? ""}`.toUpperCase();
}

function Panel({ icon, title, tone = "emerald", action, children }: { icon: ReactNode; title: string; tone?: "emerald" | "amber"; action?: ReactNode; children: ReactNode }) {
  const iconTone = tone === "amber" ? "bg-gradient-to-br from-amber-400 to-amber-600" : "bg-gradient-to-br from-emerald-500 to-emerald-700";
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-inset ring-neutral-200/70">
      <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 bg-neutral-50/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white shadow-sm ${iconTone}`}>{icon}</span>
          <h3 className="m-0 text-xs font-extrabold tracking-tight text-neutral-900">{title}</h3>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ label, value, icon }: { label: string; value?: string | null; icon?: ReactNode }) {
  const available = Boolean(String(value ?? "").trim());
  return (
    <tr className="border-0 border-b border-solid border-neutral-100 transition last:border-b-0 hover:bg-neutral-50/70">
      <th scope="row" className="w-[40%] py-3.5 pl-4 pr-3 text-left align-top">
        <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">{icon}{label}</span>
      </th>
      <td className={`py-3.5 pr-4 align-top text-[13px] leading-5 break-words ${available ? "font-bold text-neutral-900" : "italic text-neutral-400"}`}>{available ? value : "Not provided"}</td>
    </tr>
  );
}

function SortHeader({ label, field, activeField, dir, onSort, align = "left" }: { label: string; field: SortField; activeField: SortField; dir: SortDir; onSort: (field: SortField) => void; align?: "left" | "right" }) {
  const active = activeField === field;
  return (
    <th scope="col" className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(field)} className={`inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[9px] font-bold uppercase tracking-[.11em] outline-none transition ${active ? "text-emerald-700" : "text-neutral-400 hover:text-neutral-600"} ${align === "right" ? "flex-row-reverse" : ""}`}>
        {label}
        {active ? (dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />) : <ArrowUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}

export default function NrmsAgencyVerificationPage() {
  const [status, setStatus] = useState<VerificationStatus>("PENDING");
  const [query, setQuery] = useState("");
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("submitted");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await apiClient.get("/api/admin/nrms/commercial/agents", { params: { status, query: query.trim() || undefined, limit: 100 } });
      const rows = (response.data?.agencies || []) as Agency[];
      setAgencies(rows);
      setSelectedId((current) => rows.some((row) => row.id === current) ? current : null);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Agency verification queue could not be loaded");
    } finally { setLoading(false); }
  }, [query, status]);

  useEffect(() => { const timer = setTimeout(() => void load(), 300); return () => clearTimeout(timer); }, [load]);
  useEffect(() => { setNotice(null); setPage(1); }, [status, query]);

  const sortedAgencies = useMemo(() => {
    const list = [...agencies];
    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === "name") cmp = (a.tradingName || a.legalName).localeCompare(b.tradingName || b.legalName);
      else if (sortField === "hotels") cmp = a._count.propertyLinks - b._count.propertyLinks;
      else if (sortField === "status") cmp = a.verificationStatus.localeCompare(b.verificationStatus);
      else cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [agencies, sortField, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sortedAgencies.length / PAGE_SIZE));
  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);
  const pageRows = sortedAgencies.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (field: SortField) => {
    if (sortField === field) { setSortDir((current) => (current === "asc" ? "desc" : "asc")); return; }
    setSortField(field); setSortDir(field === "name" ? "asc" : "desc");
  };

  const selected = useMemo(() => agencies.find((row) => row.id === selectedId) || null, [agencies, selectedId]);
  const documents = useMemo(() => Array.isArray(selected?.documents) ? selected.documents.filter((document) => document?.url) : [], [selected]);
  const hasIdentityEvidence = Boolean(documents.length || selected?.registrationNo || selected?.tin || selected?.licenseNo);

  const selectAgency = (agency: Agency) => {
    setSelectedId(agency.id); setNote(agency.verificationNote || ""); setError(null); setNotice(null); setDetailOpen(true);
  };

  useEffect(() => {
    if (!detailOpen) return;
    const priorOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setDetailOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = priorOverflow; window.removeEventListener("keydown", closeOnEscape); };
  }, [detailOpen]);

  const decide = async (decision: "VERIFIED" | "REJECTED") => {
    if (!selected || saving) return;
    if (decision === "VERIFIED" && !hasIdentityEvidence) { setError("Identity evidence is required before this agency can be verified."); return; }
    if (decision === "REJECTED" && note.trim().length < 5) { setError("Enter a clear rejection reason of at least 5 characters."); return; }
    setSaving(true); setError(null);
    try {
      await apiClient.post(`/api/admin/nrms/commercial/agents/${selected.id}/verification`, { decision, note: note.trim() || undefined });
      setNotice(decision === "VERIFIED" ? "Agency verified successfully." : "Agency rejected and the decision was recorded.");
      setNote(""); setDetailOpen(false); await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "The verification decision could not be saved");
    } finally { setSaving(false); }
  };

  return (
    <main id="nrms-agent-verification" className="mx-auto w-full max-w-[1500px] px-3 pb-28 pt-4 sm:px-5 sm:pt-5 lg:px-6 lg:pb-10">
      <style>{`#nrms-agent-verification, #nrms-agent-verification * { box-sizing: border-box; }`}</style>

      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href="/admin/nrms" className="inline-flex min-h-9 items-center gap-2 rounded-lg px-1 text-xs font-bold text-emerald-700 no-underline transition hover:text-emerald-900"><ArrowLeft className="h-4 w-4" /> NRMS directory</Link>
        <span className="hidden items-center gap-1.5 text-[11px] font-semibold text-neutral-400 sm:inline-flex"><ShieldCheck className="h-3.5 w-3.5" /> Central KYC control</span>
      </div>

      <header className="relative overflow-hidden rounded-2xl border border-emerald-800 bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-800 p-5 text-white shadow-sm sm:p-7">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3.5 sm:items-center">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 ring-1 ring-white/20 sm:h-14 sm:w-14 sm:rounded-2xl"><ShieldCheck className="h-5 w-5 sm:h-6 sm:w-6" /></span>
            <div className="min-w-0"><p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200">NRMS trust operations</p><h1 className="m-0 mt-1 text-xl font-extrabold tracking-tight sm:text-2xl">Agency verification</h1><p className="m-0 mt-1 max-w-2xl text-xs leading-5 text-emerald-100/80 sm:text-[13px]">Review identity evidence once, record a defensible decision, and reuse verification across approved hotels.</p></div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:min-w-56">
            <div className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15 backdrop-blur-sm"><p className="m-0 text-[9px] font-bold uppercase tracking-wider text-emerald-200">In this list</p><p className="m-0 mt-1 text-lg font-extrabold">{loading ? "—" : agencies.length}</p></div>
            <div className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-white/15 backdrop-blur-sm"><p className="m-0 text-[9px] font-bold uppercase tracking-wider text-emerald-200">Viewing</p><p className="m-0 mt-1 truncate text-sm font-extrabold">{STATUS[status].shortLabel}</p></div>
          </div>
        </div>
      </header>

      {(error || notice) && <div className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role={error ? "alert" : "status"}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || notice}</span></div>}

      <section className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="inline-flex gap-1.5 rounded-xl bg-neutral-100 p-1">
          {(Object.keys(STATUS) as VerificationStatus[]).map((item) => <button key={item} type="button" aria-pressed={status === item} onClick={() => setStatus(item)} className={`min-h-9 rounded-lg border px-3 text-[10px] font-bold transition ${status === item ? STATUS[item].active : "border-transparent bg-transparent text-neutral-500 hover:bg-white hover:text-neutral-800"}`}>{STATUS[item].shortLabel}</button>)}
        </div>
        <label className="relative min-w-0 flex-1"><span className="sr-only">Search agencies</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agency, registration or TIN" className="min-h-11 w-full rounded-xl border border-neutral-200 bg-white py-2 pl-9 pr-3 text-xs outline-none transition placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label>
        <span className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 px-3 text-[10px] font-bold text-emerald-800">{sortedAgencies.length} {sortedAgencies.length === 1 ? "agency" : "agencies"}</span>
      </section>

      <section className="mt-4 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        {loading ? (
          <div className="p-5"><div className="space-y-2.5" aria-label="Loading agencies">{[0, 1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-xl bg-neutral-100" />)}</div></div>
        ) : sortedAgencies.length === 0 ? (
          <div className="mx-auto flex min-h-[260px] max-w-lg flex-col items-center justify-center px-6 py-9 text-center"><span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Users className="h-6 w-6" /></span><p className="m-0 mt-4 text-base font-extrabold text-neutral-900">No agencies found</p><p className="m-0 mt-1.5 text-xs leading-5 text-neutral-500">Try another status or clear your search.</p></div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[1000px] border-collapse text-left">
                <thead>
                  <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-50">
                    <SortHeader label="Agency" field="name" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                    <th scope="col" className="px-4 py-3 text-[9px] font-bold uppercase tracking-[.11em] text-neutral-400">Registration</th>
                    <th scope="col" className="px-4 py-3 text-[9px] font-bold uppercase tracking-[.11em] text-neutral-400">Country</th>
                    <SortHeader label="Submitted" field="submitted" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Hotels" field="hotels" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                    <th scope="col" className="px-4 py-3 text-[9px] font-bold uppercase tracking-[.11em] text-neutral-400">Evidence</th>
                    <SortHeader label="Status" field="status" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                    <th scope="col" className="px-4 py-3 text-right text-[9px] font-bold uppercase tracking-[.11em] text-neutral-400">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((agency) => {
                    const evidenceReady = Boolean((agency.documents?.length ?? 0) || agency.registrationNo || agency.tin || agency.licenseNo);
                    return (
                      <tr key={agency.id} onClick={() => selectAgency(agency)} className="cursor-pointer border-0 border-b border-solid border-neutral-100 text-xs transition-colors last:border-b-0 hover:bg-emerald-50">
                        <td className="max-w-56 px-4 py-3.5"><div className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-100 text-[10px] font-extrabold text-neutral-600">{initials(agency.tradingName || agency.legalName)}</span><div className="min-w-0"><p className="m-0 truncate font-extrabold text-neutral-900">{agency.tradingName || agency.legalName}</p><p className="m-0 mt-0.5 truncate text-[10px] text-neutral-400">{agency.legalName}</p></div></div></td>
                        <td className="px-4 py-3.5"><p className="m-0 font-semibold text-neutral-700">{agency.registrationNo || "—"}</p><p className="m-0 mt-1 text-[10px] text-neutral-400">TIN {agency.tin || "—"}</p></td>
                        <td className="px-4 py-3.5"><p className="m-0 font-semibold text-neutral-700">{agency.countryCode}</p>{agency.nationality && <p className="m-0 mt-1 text-[10px] text-neutral-400">{agency.nationality}</p>}</td>
                        <td className="px-4 py-3.5 text-neutral-600">{submittedDate(agency.createdAt)}</td>
                        <td className="px-4 py-3.5 text-neutral-600">{agency._count.propertyLinks}</td>
                        <td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${evidenceReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{evidenceReady ? <FileCheck2 className="h-3 w-3" /> : <FileWarning className="h-3 w-3" />}{evidenceReady ? "Ready" : "Missing"}</span></td>
                        <td className="px-4 py-3.5"><span className={`inline-flex rounded-full border px-2 py-1 text-[9px] font-bold ${STATUS[agency.verificationStatus].pill}`}>{STATUS[agency.verificationStatus].shortLabel}</span></td>
                        <td className="px-4 py-3.5 text-right"><button type="button" onClick={(event) => { event.stopPropagation(); selectAgency(agency); }} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 transition hover:border-emerald-300 hover:bg-emerald-100" aria-label={`Review ${agency.tradingName || agency.legalName}`} title="Review agency"><Eye className="h-4 w-4" /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-neutral-100 md:hidden">
              {pageRows.map((agency) => {
                const evidenceReady = Boolean((agency.documents?.length ?? 0) || agency.registrationNo || agency.tin || agency.licenseNo);
                return (
                  <article key={agency.id} onClick={() => selectAgency(agency)} className="cursor-pointer p-4 transition-colors hover:bg-emerald-50/60 active:bg-emerald-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-neutral-100 text-xs font-extrabold text-neutral-600">{initials(agency.tradingName || agency.legalName)}</span><div className="min-w-0"><p className="m-0 truncate text-sm font-extrabold text-neutral-900">{agency.tradingName || agency.legalName}</p><p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{agency.legalName}</p></div></div>
                      <button type="button" onClick={(event) => { event.stopPropagation(); selectAgency(agency); }} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800" aria-label={`Review ${agency.tradingName || agency.legalName}`}><Eye className="h-4 w-4" /></button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-1 text-[9px] font-bold ${STATUS[agency.verificationStatus].pill}`}>{STATUS[agency.verificationStatus].shortLabel}</span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${evidenceReady ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{evidenceReady ? <FileCheck2 className="h-3 w-3" /> : <FileWarning className="h-3 w-3" />}{evidenceReady ? "Evidence" : "Missing"}</span>
                      <span className="ml-auto text-[10px] text-neutral-400">{submittedDate(agency.createdAt)} · {agency._count.propertyLinks} hotel{agency._count.propertyLinks === 1 ? "" : "s"}</span>
                    </div>
                  </article>
                );
              })}
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-between border-0 border-t border-solid border-neutral-100 p-3">
                <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                <span className="text-[10px] font-bold text-neutral-500">Page {page} of {pageCount} · {sortedAgencies.length} total</span>
                <button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="grid h-9 w-9 place-items-center rounded-lg border border-neutral-200 bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
              </div>
            )}
          </>
        )}
      </section>

      {mounted && detailOpen && selected && createPortal(
        <div
          id="nrms-agent-detail-modal"
          className="box-border fixed inset-0 z-[90] flex items-center justify-center bg-neutral-950/55 p-3 backdrop-blur-sm sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agency-detail-title"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOpen(false); }}
        >
          <style>{`#nrms-agent-detail-modal, #nrms-agent-detail-modal * { box-sizing: border-box; }`}</style>
          <aside className="box-border relative flex h-[90vh] w-full max-w-[1100px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_32px_100px_-24px_rgba(0,0,0,.55)] sm:border sm:border-white/20">
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-0 border-b border-solid border-neutral-100 bg-[linear-gradient(135deg,#ffffff_0%,#f3faf7_62%,#ebf7f3_100%)] px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
              <div className="flex min-w-0 flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:gap-4 sm:text-left">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-sm font-extrabold text-white shadow-sm ring-1 ring-inset ring-emerald-800/10">{initials(selected.tradingName || selected.legalName)}</span>
                <div className="min-w-0">
                  <span className="block text-[10px] font-bold uppercase tracking-[.18em] text-emerald-700">Account #{selected.id}</span>
                  <h2 id="agency-detail-title" className="m-0 mt-1 truncate text-xl font-extrabold tracking-tight text-neutral-950 sm:text-2xl">{selected.legalName}</h2>
                  <p className="m-0 mt-1.5 text-xs text-neutral-500">{selected.tradingName || "No separate trading name"}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2.5 sm:gap-3.5">
                <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold ${STATUS[selected.verificationStatus].pill}`}>{STATUS[selected.verificationStatus].label}</span>
                <button type="button" onClick={() => setDetailOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-500 transition hover:border-neutral-300 hover:text-neutral-800" aria-label="Close agency details"><X className="h-4 w-4" /></button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50/60">
              <div className="space-y-5 p-4 sm:p-5 lg:p-6">
                <div className="grid items-start gap-5 xl:grid-cols-2">
                  <Panel icon={<Building2 className="h-4 w-4" />} title="Registration and identity">
                    <table className="w-full border-collapse text-left">
                      <tbody>
                        <FieldRow label="Registration number" value={selected.registrationNo} />
                        <FieldRow label="TIN" value={selected.tin} />
                        <FieldRow label="Tourism licence" value={selected.licenseNo} />
                        <FieldRow label="Country / nationality" value={[selected.countryCode, selected.nationality].filter(Boolean).join(" · ")} />
                        <FieldRow label="Submitted" value={submittedDate(selected.createdAt)} />
                        <FieldRow label="Hotel relationships" value={`${selected._count.propertyLinks} linked hotel${selected._count.propertyLinks === 1 ? "" : "s"}`} />
                      </tbody>
                    </table>
                  </Panel>
                  <Panel icon={<Users className="h-4 w-4" />} title="Agency contact">
                    <table className="w-full border-collapse text-left">
                      <tbody>
                        <FieldRow label="Contact person" value={selected.contactName || selected.primaryUser.fullName} />
                        <FieldRow label="Email" value={selected.contactEmail || selected.primaryUser.email} icon={<Mail className="h-3 w-3" />} />
                        <FieldRow label="Phone" value={selected.contactPhone} icon={<Phone className="h-3 w-3" />} />
                        <FieldRow label="Address" value={selected.address} icon={<MapPin className="h-3 w-3" />} />
                      </tbody>
                    </table>
                  </Panel>
                </div>

                <Panel icon={<FileCheck2 className="h-4 w-4" />} title="KYC evidence" tone={hasIdentityEvidence ? "emerald" : "amber"} action={<span className={`rounded-full px-2.5 py-1 text-[9px] font-bold ${hasIdentityEvidence ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{hasIdentityEvidence ? "Evidence available" : "Evidence required"}</span>}>
                  {documents.length > 0 ? (
                    <table className="w-full border-collapse text-left">
                      <thead>
                        <tr className="border-0 border-b border-solid border-neutral-100">
                          <th scope="col" className="py-2.5 pl-4 pr-3 text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">Document</th>
                          <th scope="col" className="py-2.5 pr-4 text-right text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map((document, index) => (
                          <tr key={`${document.url}-${index}`} className="border-0 border-b border-solid border-neutral-100 last:border-b-0 hover:bg-emerald-50/40">
                            <td className="py-2.5 pl-4 pr-3 align-middle"><span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-neutral-800"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><FileCheck2 className="h-3.5 w-3.5" /></span><span className="truncate">{document.type?.replace(/_/g, " ") || `Document ${index + 1}`}</span></span></td>
                            <td className="py-2.5 pr-4 text-right align-middle"><a href={document.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 no-underline hover:text-emerald-900">View <ExternalLink className="h-3.5 w-3.5" /></a></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : <div className="flex items-start gap-3 p-4 text-xs leading-5 text-amber-900"><FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><p className="m-0 font-bold">No document has been uploaded</p><p className="m-0 mt-1 text-amber-800">Do not approve this agency unless a registration number, TIN or licence provides sufficient identity evidence. Request documents when evidence is incomplete.</p></div></div>}
                </Panel>

                <Panel icon={<BadgeCheck className="h-4 w-4" />} title="Record verification decision">
                  <div className="p-4 sm:p-5">
                    <p className="m-0 text-xs leading-5 text-neutral-500">Approval activates central trust. Rejection must include a clear reason the agency can address.</p>
                    <label className="mt-4 block text-xs font-bold text-neutral-700">Decision note <span className="font-normal text-neutral-400">(required for rejection)</span><textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={4} placeholder="Add evidence reviewed, concerns, or the reason for rejection…" className="mt-2 w-full resize-y rounded-xl border border-neutral-200 bg-neutral-50/60 p-3 text-xs font-normal leading-5 outline-none transition placeholder:text-neutral-400 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100" /></label>
                    <div className="mt-4 grid gap-2.5 sm:flex sm:flex-wrap">
                      <button type="button" disabled={saving || !hasIdentityEvidence || selected.verificationStatus === "VERIFIED"} onClick={() => void decide("VERIFIED")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-emerald-700 bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Verify agency</button>
                      <button type="button" disabled={saving || selected.verificationStatus === "REJECTED"} onClick={() => void decide("REJECTED")} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-5 text-xs font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-400"><XCircle className="h-4 w-4" /> Reject agency</button>
                    </div>
                    {!hasIdentityEvidence && <p className="m-0 mt-3 flex items-start gap-1.5 text-[11px] font-semibold text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Verification is disabled until identity evidence is available.</p>}
                  </div>
                </Panel>
              </div>
            </div>

            <footer className="flex shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
              <p className="m-0 hidden items-center gap-1.5 text-[10px] font-semibold text-neutral-400 sm:flex"><ShieldCheck className="h-3.5 w-3.5" /> Verification decisions are recorded to the audit trail.</p>
              <button type="button" onClick={() => setDetailOpen(false)} className="ml-auto inline-flex min-h-10 items-center justify-center rounded-xl border border-neutral-200 bg-white px-5 text-xs font-bold text-neutral-700 transition hover:bg-neutral-50">Close details</button>
            </footer>
          </aside>
        </div>,
        document.body
      )}
    </main>
  );
}

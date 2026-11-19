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
  const iconTone = tone === "amber" ? "text-amber-600" : "text-[#02665e]";
  return (
    <div className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`shrink-0 ${iconTone}`}>{icon}</span>
          <h3 className="m-0 text-[13px] font-bold text-neutral-900">{title}</h3>
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
    <tr className="border-0 border-b border-solid border-neutral-100 last:border-b-0">
      <th scope="row" className="w-[40%] py-2.5 pl-4 pr-3 text-left align-top">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-500">{icon}{label}</span>
      </th>
      <td className={`py-2.5 pr-4 align-top text-[13px] leading-5 break-words ${available ? "font-semibold text-neutral-900" : "text-neutral-400"}`}>
        {available ? value : <span className="inline-flex items-center gap-1 rounded-sm bg-amber-50 px-1.5 text-[11px] font-semibold text-amber-700">Not provided</span>}
      </td>
    </tr>
  );
}

/** The four identity proofs an agency can file, each present or not. */
function evidenceChecks(agency: Agency) {
  const docs = Array.isArray(agency.documents) ? agency.documents.filter((d) => d?.url).length : 0;
  return [
    { key: "Reg", label: "Registration number", ok: Boolean(agency.registrationNo) },
    { key: "TIN", label: "Tax ID (TIN)", ok: Boolean(agency.tin) },
    { key: "Lic", label: "Licence number", ok: Boolean(agency.licenseNo) },
    { key: docs ? `Docs ${docs}` : "Docs", label: `${docs} uploaded ${docs === 1 ? "document" : "documents"}`, ok: docs > 0 },
  ];
}

function daysSince(value: string): number {
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86_400_000)) : 0;
}

function EvidenceStrip({ agency }: { agency: Agency }) {
  const checks = evidenceChecks(agency);
  const have = checks.filter((c) => c.ok).length;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex gap-1">
        {checks.map((c) => (
          <span
            key={c.label}
            title={`${c.label}: ${c.ok ? "on file" : "not given"}`}
            className={`inline-flex h-5 items-center gap-0.5 rounded-sm px-1.5 text-[10px] font-semibold ${c.ok ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100" : "bg-neutral-50 text-neutral-300 ring-1 ring-inset ring-neutral-100 line-through decoration-neutral-300"}`}
          >
            {c.ok && <CheckCircle2 className="h-2.5 w-2.5" aria-hidden />}{c.key}
          </span>
        ))}
      </span>
      <span className={`shrink-0 text-[10px] font-bold tabular-nums ${have === 0 ? "text-amber-600" : "text-neutral-400"}`}>{have}/4</span>
    </div>
  );
}

function SortHeader({ label, field, activeField, dir, onSort, align = "left" }: { label: string; field: SortField; activeField: SortField; dir: SortDir; onSort: (field: SortField) => void; align?: "left" | "right" }) {
  const active = activeField === field;
  return (
    <th scope="col" className={`px-4 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button type="button" onClick={() => onSort(field)} className={`inline-flex cursor-pointer items-center gap-1 whitespace-nowrap border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-[.11em] outline-none transition ${active ? "text-emerald-700" : "text-neutral-400 hover:text-neutral-600"} ${align === "right" ? "flex-row-reverse" : ""}`}>
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

  // What the band reads from the list on screen: evidence readiness, hotels at stake, oldest wait.
  const queue = useMemo(() => {
    const hasEvidence = (a: Agency) => Boolean((Array.isArray(a.documents) && a.documents.some((d) => d?.url)) || a.registrationNo || a.tin || a.licenseNo);
    const ready = agencies.filter(hasEvidence).length;
    const hotels = agencies.reduce((sum: number, a: Agency) => sum + (a._count?.propertyLinks || 0), 0);
    const oldest = agencies.reduce((min: number | null, a: Agency) => {
      const t = new Date(a.createdAt).getTime();
      return Number.isFinite(t) && (min === null || t < min) ? t : min;
    }, null);
    const oldestDays = oldest === null ? null : Math.max(0, Math.floor((Date.now() - oldest) / 86_400_000));
    return { ready, missing: agencies.length - ready, hotels, oldestDays };
  }, [agencies]);

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
    <main id="nrms-agent-verification" className="w-full min-w-0 max-w-none px-3 pb-5 pt-4 sm:px-5 sm:pt-5 lg:px-6">
      <style>{`#nrms-agent-verification, #nrms-agent-verification * { box-sizing: border-box; }`}</style>

      {/* Trust desk band: the decision gate and what the queue on screen is waiting on */}
      <header className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.20)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative p-4 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Link href="/admin/nrms" className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80 no-underline hover:text-emerald-200">
                <ArrowLeft className="h-3 w-3" /> NRMS · Trust operations
              </Link>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Agency verification</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Check identity evidence once, record a decision you can defend, and reuse it across approved hotels.</p>
            </div>
            {status === "PENDING" && !loading && agencies.length > 0 ? (
              <span className="inline-flex h-8 shrink-0 items-center gap-2 self-start rounded-md bg-amber-400/15 px-3 text-xs font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/25">
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                </span>
                {agencies.length} waiting for a decision
              </span>
            ) : (
              <span className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md bg-white/[0.06] px-3 text-xs font-semibold text-white/70 ring-1 ring-inset ring-white/10">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" aria-hidden /> Central KYC control
              </span>
            )}
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
            {/* Decision gate: every agency enters as Pending and leaves Verified or Rejected */}
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 sm:gap-3" role="group" aria-label="Verification status">
              {(() => {
                const gate = (item: VerificationStatus, hint: string, dot: string) => {
                  const on = status === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setStatus(item)}
                      className={`flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border-0 px-3 py-2.5 text-left transition ${on ? "bg-white text-neutral-900" : "bg-white/[0.05] text-white/75 ring-1 ring-inset ring-white/10 hover:bg-white/[0.1]"}`}
                    >
                      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold">{STATUS[item].shortLabel}</span>
                        <span className={`block truncate text-[11px] ${on ? "text-neutral-500" : "text-white/45"}`}>{hint}</span>
                      </span>
                      {on && <span className="shrink-0 text-lg font-bold tabular-nums text-[#02665e]">{loading ? "..." : agencies.length}</span>}
                    </button>
                  );
                };
                return (
                  <>
                    {gate("PENDING", "Awaiting review", "bg-amber-400")}
                    <span className="grid place-items-center text-white/30" aria-hidden><ChevronRight className="h-4 w-4" /></span>
                    <div className="grid min-w-0 gap-2">
                      {gate("VERIFIED", "Trusted across hotels", "bg-emerald-400")}
                      {gate("REJECTED", "Declined with a reason", "bg-rose-400")}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Queue read-out for the list on screen */}
            <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-white/10 ring-1 ring-white/10">
              {[
                { label: "Evidence on file", value: loading ? "..." : String(queue.ready), tone: "text-emerald-300" },
                { label: "Missing evidence", value: loading ? "..." : String(queue.missing), tone: queue.missing > 0 ? "text-amber-300" : "text-white" },
                { label: "Hotels linked", value: loading ? "..." : String(queue.hotels), tone: "text-white" },
                {
                  label: status === "PENDING" ? "Oldest waiting" : "Oldest in list",
                  value: loading || queue.oldestDays === null ? "..." : queue.oldestDays === 0 ? "Today" : `${queue.oldestDays}d`,
                  tone: status === "PENDING" && (queue.oldestDays ?? 0) >= 7 ? "text-rose-300" : "text-white",
                },
              ].map((cell) => (
                <div key={cell.label} className="bg-[#0d2a25] px-3 py-2.5">
                  <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{cell.label}</dt>
                  <dd className={`m-0 mt-1 text-lg font-bold tabular-nums leading-none ${cell.tone}`}>{cell.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </header>

      {(error || notice) && <div className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`} role={error ? "alert" : "status"}>{error ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}<span>{error || notice}</span></div>}

      <section className="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <label className="relative min-w-0 flex-1"><span className="sr-only">Search agencies</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agency, registration or TIN" className="min-h-10 w-full rounded-md border border-solid border-neutral-200 bg-white py-2 pl-9 pr-3 text-xs outline-none transition placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label>
        <span className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 px-3 text-[11px] font-semibold text-emerald-800">{sortedAgencies.length} {sortedAgencies.length === 1 ? "agency" : "agencies"}</span>
      </section>

      <section className="mt-4 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        {loading ? (
          <div className="p-4"><div className="space-y-2" aria-label="Loading agencies">{[0, 1, 2, 3].map((item) => <div key={item} className="h-14 animate-pulse rounded-md bg-neutral-100" />)}</div></div>
        ) : sortedAgencies.length === 0 ? (
          <div className="mx-auto flex min-h-[240px] max-w-lg flex-col items-center justify-center px-6 py-9 text-center"><span className="grid h-12 w-12 place-items-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><Users className="h-5 w-5" /></span><p className="m-0 mt-4 text-base font-bold text-neutral-900">No agencies found</p><p className="m-0 mt-1.5 text-xs leading-5 text-neutral-500">Try another status or clear your search.</p></div>
        ) : (
          <>
            <div className="hidden w-full min-w-0 overflow-x-auto md:block">
              <table className="w-full min-w-[860px] table-fixed border-collapse text-left">
                <caption className="sr-only">Agency identity verification queue</caption>
                <colgroup>{[30, 25, 14, 8, 11, 12].map((width, index) => <col key={index} style={{ width: `${width}%` }} />)}</colgroup>
                <thead>
                  <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-50">
                    <SortHeader label="Agency" field="name" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                    <th scope="col" className="whitespace-nowrap px-4 py-3 text-[10px] font-bold uppercase tracking-[.11em] text-neutral-400">Identity evidence</th>
                    <SortHeader label="Submitted" field="submitted" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                    <SortHeader label="Hotels" field="hotels" activeField={sortField} dir={sortDir} onSort={toggleSort} align="right" />
                    <SortHeader label="Status" field="status" activeField={sortField} dir={sortDir} onSort={toggleSort} />
                    <th scope="col" className="px-4 py-3"><span className="sr-only">Review</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((agency) => {
                    const name = agency.tradingName || agency.legalName;
                    const waited = daysSince(agency.createdAt);
                    const pending = agency.verificationStatus === "PENDING";
                    return (
                      <tr key={agency.id} onClick={() => selectAgency(agency)} className="group cursor-pointer border-0 border-b border-solid border-neutral-100 text-xs transition-colors last:border-b-0 hover:bg-emerald-50/50">
                        <td className="px-4 py-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#0b2420] text-[11px] font-bold text-emerald-200">{initials(name)}</span>
                            <div className="min-w-0">
                              <p className="m-0 truncate text-[13px] font-bold text-neutral-900">{name}</p>
                              <p className="m-0 mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-neutral-500">
                                <span className="shrink-0 rounded-sm bg-neutral-100 px-1 font-mono text-[10px] font-semibold text-neutral-600">{agency.countryCode}</span>
                                <span className="truncate">{agency.tradingName && agency.tradingName !== agency.legalName ? agency.legalName : agency.nationality || agency.contactName || "Agency"}</span>
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <EvidenceStrip agency={agency} />
                          <p className="m-0 mt-1 truncate font-mono text-[10px] text-neutral-400">
                            {[agency.registrationNo && `REG ${agency.registrationNo}`, agency.tin && `TIN ${agency.tin}`].filter(Boolean).join(" · ") || "No numbers given"}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="m-0 text-neutral-700">{submittedDate(agency.createdAt)}</p>
                          <p className={`m-0 mt-0.5 text-[11px] ${pending && waited >= 7 ? "font-semibold text-rose-600" : pending && waited >= 3 ? "font-semibold text-amber-600" : "text-neutral-400"}`}>
                            {waited === 0 ? "Today" : `${waited} ${waited === 1 ? "day" : "days"}${pending ? " waiting" : " ago"}`}
                          </p>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-neutral-700"><Building2 className="h-3.5 w-3.5 text-neutral-300" aria-hidden />{agency._count.propertyLinks}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-md border border-solid px-2 py-0.5 text-[11px] font-semibold ${STATUS[agency.verificationStatus].pill}`}>{STATUS[agency.verificationStatus].shortLabel}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button type="button" onClick={(event) => { event.stopPropagation(); selectAgency(agency); }} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[11px] font-semibold text-neutral-700 transition group-hover:border-[#02665e] group-hover:bg-[#02665e] group-hover:text-white" aria-label={`Review ${name}`}>
                            {pending ? "Review" : "Open"} <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="md:hidden">
              {pageRows.map((agency) => {
                const name = agency.tradingName || agency.legalName;
                const waited = daysSince(agency.createdAt);
                const pending = agency.verificationStatus === "PENDING";
                return (
                  <article key={agency.id} onClick={() => selectAgency(agency)} className="cursor-pointer border-0 border-b border-solid border-neutral-100 p-4 transition-colors last:border-b-0 active:bg-emerald-50">
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#0b2420] text-xs font-bold text-emerald-200">{initials(name)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 truncate text-sm font-bold text-neutral-900">{name}</p>
                        <p className="m-0 mt-0.5 text-[11px] text-neutral-500">
                          <span className="font-mono font-semibold text-neutral-600">{agency.countryCode}</span> · {submittedDate(agency.createdAt)}
                          <span className={pending && waited >= 7 ? "font-semibold text-rose-600" : ""}> · {waited === 0 ? "today" : `${waited}d${pending ? " waiting" : ""}`}</span>
                        </p>
                      </div>
                      <span className={`shrink-0 rounded-md border border-solid px-2 py-0.5 text-[11px] font-semibold ${STATUS[agency.verificationStatus].pill}`}>{STATUS[agency.verificationStatus].shortLabel}</span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <EvidenceStrip agency={agency} />
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-neutral-500"><Building2 className="h-3.5 w-3.5 text-neutral-300" aria-hidden />{agency._count.propertyLinks}</span>
                    </div>
                  </article>
                );
              })}
            </div>

            {pageCount > 1 && (
              <nav className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-3" aria-label="Agency pages">
                <span className="text-[11px] text-neutral-500">
                  Showing <span className="font-semibold text-neutral-800">{(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, sortedAgencies.length)}</span> of {sortedAgencies.length}
                </span>
                <span className="flex items-center gap-1">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous page" className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-600 disabled:cursor-default disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                  {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                    <button key={n} type="button" onClick={() => setPage(n)} aria-current={n === page ? "page" : undefined} className={`h-8 min-w-8 cursor-pointer rounded-md border border-solid px-2 text-xs font-semibold tabular-nums transition ${n === page ? "border-[#02665e] bg-[#02665e] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"}`}>{n}</button>
                  ))}
                  <button type="button" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} aria-label="Next page" className="grid h-8 w-8 cursor-pointer place-items-center rounded-md border border-solid border-neutral-200 bg-white text-neutral-600 disabled:cursor-default disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                </span>
              </nav>
            )}
          </>
        )}
      </section>

      {mounted && detailOpen && selected && (() => {
        const name = selected.tradingName || selected.legalName;
        const checks = evidenceChecks(selected);
        const have = checks.filter((c) => c.ok).length;
        const waited = daysSince(selected.createdAt);
        const pending = selected.verificationStatus === "PENDING";
        const statusOnDark = selected.verificationStatus === "VERIFIED"
          ? "bg-emerald-400/15 text-emerald-200 ring-emerald-400/25"
          : selected.verificationStatus === "REJECTED"
            ? "bg-rose-400/15 text-rose-200 ring-rose-400/25"
            : "bg-amber-400/15 text-amber-200 ring-amber-400/25";
        return createPortal(
        <div
          id="nrms-agent-detail-modal"
          className="box-border fixed inset-0 z-[90] flex items-stretch justify-end bg-neutral-950/55 p-0 backdrop-blur-sm sm:p-3"
          role="dialog"
          aria-modal="true"
          aria-labelledby="agency-detail-title"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setDetailOpen(false); }}
        >
          <style>{`#nrms-agent-detail-modal, #nrms-agent-detail-modal * { box-sizing: border-box; }`}</style>
          <aside className="box-border relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-white shadow-[0_32px_100px_-24px_rgba(0,0,0,.55)] sm:w-[95%] sm:max-w-6xl sm:rounded-lg">
            {/* Case header */}
            <header className="relative shrink-0 overflow-hidden bg-[#0b2420] text-white">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.20)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
              <div className="relative px-4 py-4 sm:px-6 sm:py-5">
                <div className="flex items-start gap-3 sm:gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-white/10 text-sm font-bold text-emerald-200 ring-1 ring-inset ring-white/15 sm:h-12 sm:w-12">{initials(name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">Agency case</p>
                    <h2 id="agency-detail-title" className="m-0 mt-0.5 truncate text-lg font-bold tracking-tight text-white sm:text-2xl">{selected.legalName}</h2>
                    <p className="m-0 mt-0.5 truncate text-xs text-white/55">
                      {selected.tradingName && selected.tradingName !== selected.legalName ? `Trades as ${selected.tradingName}` : "No separate trading name"}
                    </p>
                  </div>
                  <span className={`hidden shrink-0 items-center rounded-md px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset sm:inline-flex ${statusOnDark}`}>{STATUS[selected.verificationStatus].label}</span>
                  <button type="button" onClick={() => setDetailOpen(false)} className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-white/[0.08] text-white/70 transition hover:bg-white/[0.16] hover:text-white" aria-label="Close agency details"><X className="h-4 w-4" /></button>
                </div>

                {/* Case facts strip */}
                <dl className="m-0 mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-md bg-white/10 ring-1 ring-white/10 sm:grid-cols-4">
                  {[
                    { label: "Submitted", value: submittedDate(selected.createdAt), tone: "text-white" },
                    { label: pending ? "Waiting" : "Age", value: waited === 0 ? "Today" : `${waited} ${waited === 1 ? "day" : "days"}`, tone: pending && waited >= 7 ? "text-rose-300" : pending && waited >= 3 ? "text-amber-300" : "text-white" },
                    { label: "Hotels linked", value: String(selected._count.propertyLinks), tone: "text-white" },
                    { label: "Evidence", value: `${have} of 4 proofs`, tone: have === 0 ? "text-amber-300" : "text-emerald-300" },
                  ].map((cell) => (
                    <div key={cell.label} className="bg-[#0d2a25] px-3 py-2">
                      <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/40">{cell.label}</dt>
                      <dd className={`m-0 mt-0.5 text-sm font-semibold tabular-nums ${cell.tone}`}>{cell.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto bg-neutral-50">
              <div className="grid items-start gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_340px]">
                {/* The file */}
                <div className="grid min-w-0 gap-4">
                  <div className="grid items-start gap-4 xl:grid-cols-2">
                    <Panel icon={<Building2 className="h-4 w-4" />} title="Registration and identity">
                      <table className="w-full border-collapse text-left">
                        <tbody>
                          <FieldRow label="Registration number" value={selected.registrationNo} />
                          <FieldRow label="TIN" value={selected.tin} />
                          <FieldRow label="Tourism licence" value={selected.licenseNo} />
                          <FieldRow label="Country" value={[selected.countryCode, selected.nationality].filter(Boolean).join(" · ")} />
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

                  <Panel
                    icon={<FileCheck2 className="h-4 w-4" />}
                    title="Uploaded documents"
                    tone={documents.length ? "emerald" : "amber"}
                    action={<span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${documents.length ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>{documents.length} {documents.length === 1 ? "file" : "files"}</span>}
                  >
                    {documents.length > 0 ? (
                      <ul className="m-0 list-none p-0">
                        {documents.map((document, index) => (
                          <li key={`${document.url}-${index}`} className="flex items-center gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-2.5 last:border-b-0">
                            <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                            <span className="min-w-0 flex-1 truncate text-[13px] font-semibold capitalize text-neutral-800">{document.type?.replace(/_/g, " ").toLowerCase() || `Document ${index + 1}`}</span>
                            {document.uploadedAt && <span className="hidden shrink-0 text-[11px] text-neutral-400 sm:inline">{submittedDate(document.uploadedAt)}</span>}
                            <a href={document.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-solid border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-700 no-underline transition hover:border-[#02665e] hover:text-[#02665e]">Open <ExternalLink className="h-3 w-3" /></a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="m-0 flex items-start gap-2.5 px-4 py-3 text-xs leading-5 text-amber-900">
                        <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                        No document uploaded. Only verify if a registration number, TIN or licence is enough to identify this agency; otherwise ask for documents.
                      </p>
                    )}
                  </Panel>
                </div>

                {/* Decision rail */}
                <section className="min-w-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white lg:sticky lg:top-0" aria-label="Record verification decision">
                  <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3">
                    <p className="m-0 flex items-center gap-2 text-[13px] font-bold text-neutral-900"><BadgeCheck className="h-4 w-4 text-[#02665e]" aria-hidden /> Decision</p>
                    <p className="m-0 mt-0.5 text-[11px] text-neutral-500">Verifying makes this agency trusted at every approved hotel.</p>
                  </div>

                  {/* Evidence checklist: what the decision rests on */}
                  <ul className="m-0 list-none border-0 border-b border-solid border-neutral-100 px-4 py-3">
                    {checks.map((c) => (
                      <li key={c.label} className="flex items-center gap-2 py-1 text-[12px]">
                        {c.ok
                          ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                          : <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full border border-solid border-neutral-300" aria-hidden />}
                        <span className={c.ok ? "font-medium text-neutral-800" : "text-neutral-400"}>{c.label}</span>
                        <span className={`ml-auto text-[11px] ${c.ok ? "text-emerald-700" : "text-neutral-400"}`}>{c.ok ? "On file" : "Not given"}</span>
                      </li>
                    ))}
                    <li className={`mt-2 rounded-md px-2.5 py-2 text-[11px] font-semibold ${hasIdentityEvidence ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                      {hasIdentityEvidence ? `Ready to decide: ${have} of 4 proofs on file.` : "Cannot verify yet: no identity proof on file."}
                    </li>
                  </ul>

                  <div className="px-4 py-3">
                    <label className="block text-[12px] font-semibold text-neutral-700">
                      Decision note <span className="font-normal text-neutral-400">(required to reject)</span>
                      <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={4} placeholder="What you checked, any concern, or the reason for rejecting..." className="mt-1.5 w-full resize-y rounded-md border border-solid border-neutral-200 bg-white p-2.5 text-xs font-normal leading-5 outline-none transition placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                    </label>
                    <p className="m-0 mt-1 text-right text-[10px] tabular-nums text-neutral-400">{note.length}/500</p>
                    <div className="mt-2 grid gap-2">
                      <button type="button" disabled={saving || !hasIdentityEvidence || selected.verificationStatus === "VERIFIED"} onClick={() => void decide("VERIFIED")} className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-xs font-semibold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Verify agency</button>
                      <button type="button" disabled={saving || selected.verificationStatus === "REJECTED" || note.trim().length < 5} onClick={() => void decide("REJECTED")} className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-solid border-rose-200 bg-white px-4 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:text-neutral-400 disabled:hover:bg-white"><XCircle className="h-4 w-4" /> Reject agency</button>
                    </div>
                    {selected.verificationStatus !== "REJECTED" && note.trim().length < 5 && <p className="m-0 mt-2 text-[11px] text-neutral-400">Write a reason of at least 5 characters to reject.</p>}
                    {selected.verificationNote && (
                      <p className="m-0 mt-3 rounded-md bg-neutral-50 px-2.5 py-2 text-[11px] text-neutral-600"><span className="font-semibold text-neutral-800">Last note: </span>{selected.verificationNote}</p>
                    )}
                  </div>
                  <p className="m-0 flex items-center gap-1.5 border-0 border-t border-solid border-neutral-100 bg-neutral-50 px-4 py-2 text-[10px] text-neutral-500"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Every decision is recorded to the audit trail.</p>
                </section>
              </div>
            </div>
          </aside>
        </div>,
        document.body
        );
      })()}
    </main>
  );
}

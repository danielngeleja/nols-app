"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import apiClient from "@/lib/apiClient";
import DatePicker from "@/components/ui/DatePicker";
import { Ban, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, KeyRound, Loader2, Mail, MessageSquare, Search, ShieldAlert, ShieldCheck, X } from "lucide-react";

/**
 * No4P OTP: every one-time code NoLSAF sent, who it went to, what it was for,
 * whether it was used, and whether it followed policy. Codes are masked; the
 * hot database keeps 30 days.
 */

const api = apiClient;

type OtpRow = {
  id: number | string;
  role: string | null;
  name: string | null;
  codeMasked: string | null;
  destinationType: string | null;
  destination: string | null;
  requestedAt: string;
  expiresAt: string | null;
  status: "valid" | "expired" | "used" | "unknown";
  usedAt: string | null;
  usedFor: string | null;
  provider: any;
  policyCompliant: boolean | null;
};
type Meta = { page: number; pageSize: number; total: number };
type Notice = { tone: "success" | "error"; title: string; message?: string };
type StatusKey = "all" | "valid" | "used" | "expired";

const STATUS_TABS: Array<{ key: StatusKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "valid", label: "Valid now" },
  { key: "used", label: "Used" },
  { key: "expired", label: "Expired" },
];
const STATUS_META: Record<OtpRow["status"], { label: string; tag: string; dot: string; Icon: typeof CheckCircle2 }> = {
  used: { label: "Used", tag: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", Icon: CheckCircle2 },
  valid: { label: "Valid", tag: "bg-sky-50 text-sky-700 ring-sky-200", dot: "bg-sky-500", Icon: ShieldCheck },
  expired: { label: "Expired", tag: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-400", Icon: Clock },
  unknown: { label: "Unknown", tag: "bg-slate-100 text-slate-600 ring-slate-200", dot: "bg-slate-400", Icon: Ban },
};

const card = "min-w-0 rounded-lg border border-solid border-slate-200 bg-white";
const EAT = "Africa/Dar_es_Salaam";

const when = (value: string | null | undefined) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: EAT })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: EAT })}`;
};
const seconds = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000)) : null);
const duration = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);
/** "ADMIN_FINANCE_VIEW" -> "Admin finance view". */
const purpose = (v: string | null) => (v ? v.toLowerCase().replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : null);
const initials = (name: string | null) => (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");

function localTodayYmd() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: EAT, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function Page() {
  const [rows, setRows] = useState<OtpRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusKey>("all");
  const [date, setDate] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [total, setTotal] = useState(0);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
  const maxDate = useMemo(() => localTodayYmd(), []);

  // Search after the admin stops typing, not on every key.
  useEffect(() => {
    const t = window.setTimeout(() => setQ(query.trim()), 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, pageSize, status };
      if (q) params.q = q;
      if (date) params.date = date;
      const res = await api.get("/api/admin/no4p-otp", { params });
      const data = res.data?.data;
      const meta: Meta | undefined = res.data?.meta;
      setRows(Array.isArray(data) ? data : []);
      setTotal(meta?.total ?? 0);
    } catch (e) {
      console.error(e);
      setRows([]);
      setTotal(0);
      setNotice({ tone: "error", title: "Could not load OTP records", message: "Please try again in a moment." });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, q, status, date]);

  const exportCsv = useCallback(async () => {
    setNotice(null);
    setExporting(true);
    try {
      const params: any = { status };
      if (q) params.q = q;
      if (date) params.date = date;
      const res = await api.get("/api/admin/no4p-otp/export.csv", { params, responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `no4p-otp-${localTodayYmd()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice({ tone: "success", title: "CSV downloaded", message: "It holds the records in the current view, within the 30-day window." });
    } catch (e) {
      console.error(e);
      setNotice({ tone: "error", title: "The export failed", message: "Please try again in a moment." });
    } finally {
      setExporting(false);
    }
  }, [q, status, date]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [q, status, date]);
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(t);
  }, [notice]);

  // What this page of results says at a glance.
  const glance = useMemo(() => {
    const used = rows.filter((r) => r.status === "used");
    const times = used.map((r) => seconds(r.requestedAt, r.usedAt)).filter((s): s is number => s != null).sort((a, b) => a - b);
    return {
      used: used.length,
      valid: rows.filter((r) => r.status === "valid").length,
      expired: rows.filter((r) => r.status === "expired").length,
      flagged: rows.filter((r) => r.policyCompliant === false).length,
      useRate: rows.length ? Math.round((used.length / rows.length) * 100) : null,
      medianToUse: times.length ? times[Math.floor(times.length / 2)] : null,
    };
  }, [rows]);

  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);

  return (
    <div id="no4p-otp-page" className="w-full min-w-0 space-y-4">
      <style>{`#no4p-otp-page, #no4p-otp-page * { box-sizing: border-box; }`}</style>

      {notice ? (
        <div className={`fixed right-6 top-6 z-50 max-w-sm rounded-md px-4 py-3 text-white shadow-lg ${notice.tone === "success" ? "bg-[#0b2420]" : "bg-rose-600"}`} role="status">
          <p className="m-0 text-sm font-semibold">{notice.title}</p>
          {notice.message ? <p className="m-0 mt-0.5 text-xs opacity-80">{notice.message}</p> : null}
        </div>
      ) : null}

      {/* Header */}
      <header className={card}>
        <div className="flex flex-wrap items-start gap-4 px-5 py-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e] text-white"><KeyRound className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900">No4P OTP</h1>
              <span className="inline-flex items-center gap-1 rounded bg-[#02665e]/10 px-2 py-0.5 text-[11px] font-semibold text-[#02665e]"><ShieldCheck className="h-3 w-3" /> Security log</span>
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"><Clock className="h-3 w-3" /> 30-day retention</span>
            </div>
            <p className="m-0 mt-1 text-sm text-slate-500">Every one-time code sent: who it went to, what it was for, whether it was used, and whether it followed policy. Codes are masked.</p>
          </div>
          <button type="button" onClick={() => void exportCsv()} disabled={exporting} className="inline-flex h-9 items-center gap-2 rounded-md border-0 bg-[#02665e] px-3.5 text-sm font-semibold text-white transition hover:bg-[#014e47] disabled:opacity-60">
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
          </button>
        </div>

        {/* At a glance */}
        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-slate-200 bg-slate-200 md:grid-cols-5">
          {[
            { label: "Records", value: loading ? "..." : total.toLocaleString(), detail: date ? `on ${date}` : "in the 30-day window", tone: "text-slate-900" },
            { label: "Used", value: loading ? "..." : String(glance.used), detail: glance.useRate != null ? `${glance.useRate}% of this page` : "on this page", tone: "text-emerald-700" },
            { label: "Typical time to use", value: loading ? "..." : glance.medianToUse != null ? duration(glance.medianToUse) : "None", detail: "median, request to use", tone: "text-slate-900" },
            { label: "Expired unused", value: loading ? "..." : String(glance.expired), detail: glance.valid ? `${glance.valid} still valid` : "on this page", tone: glance.expired ? "text-amber-700" : "text-slate-900" },
            { label: "Policy flags", value: loading ? "..." : String(glance.flagged), detail: glance.flagged ? "review below" : "all compliant", tone: glance.flagged ? "text-rose-700" : "text-emerald-700" },
          ].map((f) => (
            <div key={f.label} className="min-w-0 bg-white px-5 py-3.5">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{f.label}</dt>
              <dd className={`m-0 mt-1 text-lg font-bold tabular-nums ${f.tone}`}>{f.value}</dd>
              <dd className="m-0 truncate text-[11px] text-slate-500">{f.detail}</dd>
            </div>
          ))}
        </dl>
      </header>

      {/* Records */}
      <section className={card}>
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-slate-200 px-5 py-3">
          <div className="inline-flex rounded-md border border-solid border-slate-200 bg-slate-50 p-0.5" role="tablist" aria-label="Status">
            {STATUS_TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={`h-8 rounded border-0 px-3 text-xs font-semibold transition ${status === t.key ? "bg-white text-slate-900 shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-800"}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input ref={searchInputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search phone or email" aria-label="Search phone or email" className="h-9 w-full rounded-md border border-solid border-slate-300 bg-white pl-9 pr-8 text-sm text-slate-900 outline-none transition focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
            {query ? (
              <button type="button" onClick={() => { setQuery(""); requestAnimationFrame(() => searchInputRef.current?.focus()); }} aria-label="Clear search" className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
            ) : null}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setPickerOpen((v) => !v)} className={`inline-flex h-9 items-center gap-2 rounded-md border border-solid px-3 text-xs font-semibold transition ${date ? "border-[#02665e]/40 bg-[#02665e]/[0.06] text-[#02665e]" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
              <Calendar className="h-4 w-4" /> {date ? new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "Any day"}
            </button>
            {date ? <button type="button" onClick={() => setDate("")} aria-label="Clear the date" className="grid h-9 w-9 place-items-center rounded-md border border-solid border-slate-300 bg-white text-slate-500 hover:bg-slate-50"><X className="h-4 w-4" /></button> : null}
          </div>
        </div>

        {pickerOpen ? (
          <>
            <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setPickerOpen(false)} />
            <div className="fixed left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2">
              <DatePicker
                selected={date || undefined}
                allowRange={false}
                allowPast
                maxDate={maxDate}
                onSelectAction={(s) => { const next = Array.isArray(s) ? s[0] : s; setDate(next || ""); setPickerOpen(false); }}
                onCloseAction={() => setPickerOpen(false)}
              />
            </div>
          </>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-left text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                <th className="px-5 py-3 font-semibold">Who</th>
                <th className="px-3 py-3 font-semibold">Sent to</th>
                <th className="px-3 py-3 font-semibold">For</th>
                <th className="px-3 py-3 font-semibold">Timeline</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Policy</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => <tr key={i} className="border-0 border-t border-solid border-slate-100"><td colSpan={6} className="px-5 py-4"><div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" /></td></tr>)
              ) : rows.length ? (
                rows.map((r) => {
                  const st = STATUS_META[r.status] ?? STATUS_META.unknown;
                  const tookSec = seconds(r.requestedAt, r.usedAt);
                  const lifeSec = seconds(r.requestedAt, r.expiresAt);
                  const Channel = (r.destinationType || "").toUpperCase().includes("MAIL") ? Mail : MessageSquare;
                  return (
                    <tr key={r.id} className={`border-0 border-t border-solid border-slate-100 align-middle transition-colors hover:bg-slate-50 ${r.policyCompliant === false ? "bg-rose-50/40" : ""}`}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[11px] font-bold text-[#02665e]">{initials(r.name)}</span>
                          <div className="min-w-0">
                            <p className="m-0 truncate font-semibold text-slate-900">{r.name || "Unknown user"}</p>
                            <p className="m-0 mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                              <span className="rounded bg-slate-100 px-1.5 py-px font-semibold text-slate-600">{r.role || "No role"}</span>
                              <span className="font-mono tracking-wider">{r.codeMasked || "Code not stored"}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="m-0 flex items-center gap-1.5 text-slate-800"><Channel className="h-3.5 w-3.5 shrink-0 text-slate-400" /><span className="truncate">{r.destination || "Not recorded"}</span></p>
                        <p className="m-0 mt-0.5 text-[11px] text-slate-500">{r.destinationType ? r.destinationType.charAt(0) + r.destinationType.slice(1).toLowerCase() : "Channel not recorded"}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="m-0 text-slate-800">{purpose(r.usedFor) ?? <span className="text-slate-400">Not used</span>}</p>
                        {r.usedFor ? <p className="m-0 mt-0.5 font-mono text-[10px] text-slate-400">{r.usedFor}</p> : null}
                      </td>
                      <td className="px-3 py-3">
                        <p className="m-0 tabular-nums text-slate-800">{when(r.requestedAt)} <span className="text-[11px] text-slate-400">EAT</span></p>
                        <p className="m-0 mt-0.5 text-[11px] text-slate-500">
                          {r.usedAt
                            ? <>Used {tookSec != null ? <b className="font-semibold text-emerald-700">{duration(tookSec)}</b> : null} later, at {when(r.usedAt)}</>
                            : r.expiresAt ? <>Expires {when(r.expiresAt)}{lifeSec != null ? `, a ${duration(lifeSec)} window` : ""}</> : "No expiry recorded"}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${st.tag}`}><st.Icon className="h-3 w-3" />{st.label}</span>
                      </td>
                      <td className="px-5 py-3">
                        {r.policyCompliant === false ? (
                          <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"><ShieldAlert className="h-3 w-3" /> Flagged</span>
                        ) : r.policyCompliant ? (
                          <span className="inline-flex items-center gap-1 rounded bg-[#02665e]/10 px-2 py-0.5 text-[11px] font-semibold text-[#02665e] ring-1 ring-inset ring-[#02665e]/20"><ShieldCheck className="h-3 w-3" /> Compliant</span>
                        ) : (
                          <span className="text-[11px] text-slate-400">Not checked</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr className="border-0 border-t border-solid border-slate-100">
                  <td colSpan={6} className="px-5 py-12 text-center">
                    <KeyRound className="mx-auto h-5 w-5 text-slate-300" />
                    <p className="m-0 mt-2 text-sm font-semibold text-slate-900">No OTP records found</p>
                    <p className="m-0 mt-0.5 text-xs text-slate-500">{q || date || status !== "all" ? "Try clearing the search, status or date." : "Codes appear here as they are sent."}</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span className="tabular-nums">{total ? `${from} to ${to} of ${total.toLocaleString()}` : "No records"}</span>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">Page {page} of {totalPages}</span>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-md border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages || loading} aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-md border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </section>
    </div>
  );
}

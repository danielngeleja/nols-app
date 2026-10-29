"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { ArrowLeft, ArrowRight, CheckCheck, ChevronLeft, ChevronRight, CircleAlert, Clock3, CreditCard, Inbox, RefreshCw, Search, ShieldCheck, WalletCards } from "lucide-react";

type PaymentCase = {
  reference: string; status: string; evidenceState: string; createdAt: string;
  booking: { adminReference: string; propertyTitle: string; guestName: string; amount: number };
};
type Summary = { needsAttention: number; unverified: number; awaitingProvider: number; roomOrRefund: number; resolved: number };
const EMPTY_SUMMARY: Summary = { needsAttention: 0, unverified: 0, awaitingProvider: 0, roomOrRefund: 0, resolved: 0 };
const TZ = "Africa/Dar_es_Salaam";
const reportedAt = (value: string) => `${new Date(value).toLocaleString("en-GB", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })} EAT`;
const money = (amount: number) => `TSh ${Number(amount || 0).toLocaleString("en-GB")}`;
const statusStyle: Record<string, { label: string; className: string }> = {
  OPEN: { label: "New report", className: "bg-sky-50 text-sky-800 ring-sky-200" },
  UNVERIFIED_REPORT: { label: "Needs evidence", className: "bg-violet-50 text-violet-800 ring-violet-200" },
  AWAITING_PROVIDER: { label: "Provider follow-up", className: "bg-amber-50 text-amber-800 ring-amber-200" },
  CODE_READY: { label: "Code delivery", className: "bg-teal-50 text-teal-800 ring-teal-200" },
  REPAIRING: { label: "Repair in progress", className: "bg-indigo-50 text-indigo-800 ring-indigo-200" },
  SENDING_CODE: { label: "Sending code", className: "bg-indigo-50 text-indigo-800 ring-indigo-200" },
  INVENTORY_CONFLICT: { label: "Room unavailable", className: "bg-rose-50 text-rose-800 ring-rose-200" },
  REFUND_REQUIRED: { label: "Refund review", className: "bg-rose-50 text-rose-800 ring-rose-200" },
  RESOLVED: { label: "Resolved", className: "bg-emerald-50 text-emerald-800 ring-emerald-200" },
};
const evidenceLabel: Record<string, string> = {
  CODE_READY: "Code issued",
  PAID_NEEDS_REPAIR: "Payment matched",
  VERIFIED_EVENT: "Provider success recorded",
  PROCESSING: "Payment processing",
  AWAITING_PROVIDER: "Provider result needed",
  CLOSED_BOOKING: "Booking closed",
};

export default function PaymentCasesPage() {
  const [items, setItems] = useState<PaymentCase[]>([]);
  const [filter, setFilter] = useState<"OPEN" | "UNVERIFIED" | "RESOLVED">("OPEN");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [reload, setReload] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(1); setQuery(search.trim()); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    apiClient.get("/api/admin/booking-payment-cases", { params: { status: filter, page, pageSize: 25, q: query } })
      .then(({ data }) => { if (active) { setItems(data.items || []); setTotal(data.total || 0); setSummary(data.summary || EMPTY_SUMMARY); setError(""); } })
      .catch((cause) => { if (active) { setItems([]); setTotal(0); setError(cause?.response?.data?.error || "Could not load payment cases"); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filter, page, query, reload]);
  const statCount = (value: number) => loading || error ? "—" : value;
  return (
    <main className="w-full min-w-0 space-y-4">
      <section className="relative overflow-hidden rounded-2xl border border-solid border-[#174139] bg-[#0b2420] px-5 py-5 text-white sm:px-6" aria-label="Payment cases overview">
        <div className="pointer-events-none absolute inset-0" aria-hidden style={{ background: "radial-gradient(640px circle at 2% -40%, rgba(52,211,153,0.17), transparent 65%)" }} />
        <div className="relative">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-emerald-200 ring-1 ring-white/10"><WalletCards className="h-5 w-5" aria-hidden /></span>
              <div className="min-w-0">
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-200/70">Booking operations</p>
                <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight">Payment and code cases</h1>
                <p className="m-0 mt-1 max-w-2xl text-[13px] leading-5 text-emerald-50/70">Resolve traveller reports with payment evidence and secure code delivery.</p>
              </div>
            </div>
            <Link href="/admin/bookings" className="inline-flex h-9 items-center gap-2 rounded-lg border border-solid border-white/20 bg-white/[0.06] px-3 text-xs font-semibold text-white no-underline transition hover:bg-white/[0.12]"><ArrowLeft className="h-3.5 w-3.5" aria-hidden />Bookings</Link>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-4">
            <div className="flex items-center gap-3 rounded-xl border border-solid border-white/10 bg-white/[0.05] px-3.5 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-300/15 text-amber-200"><CircleAlert className="h-4.5 w-4.5" aria-hidden /></span><div><strong className="block text-xl tabular-nums leading-none">{statCount(summary.needsAttention)}</strong><span className="mt-1 block text-[11px] text-emerald-50/60">Need attention</span></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-solid border-white/10 bg-white/[0.05] px-3.5 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-300/15 text-violet-200"><Search className="h-4 w-4" aria-hidden /></span><div><strong className="block text-xl tabular-nums leading-none">{statCount(summary.unverified)}</strong><span className="mt-1 block text-[11px] text-emerald-50/60">Need initial evidence</span></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-solid border-white/10 bg-white/[0.05] px-3.5 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-300/15 text-sky-200"><Clock3 className="h-4.5 w-4.5" aria-hidden /></span><div><strong className="block text-xl tabular-nums leading-none">{statCount(summary.awaitingProvider)}</strong><span className="mt-1 block text-[11px] text-emerald-50/60">Provider follow-up</span></div></div>
            <div className="flex items-center gap-3 rounded-xl border border-solid border-white/10 bg-white/[0.05] px-3.5 py-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-300/15 text-rose-200"><ShieldCheck className="h-4.5 w-4.5" aria-hidden /></span><div><strong className="block text-xl tabular-nums leading-none">{statCount(summary.roomOrRefund)}</strong><span className="mt-1 block text-[11px] text-emerald-50/60">Rebooking or refund review</span></div></div>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm" aria-label="Payment case queue">
        <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3 sm:px-5">
          <nav aria-label="Case status" className="flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-1">
            {(["OPEN", "UNVERIFIED", "RESOLVED"] as const).map((value) => <button key={value} type="button" onClick={() => { setFilter(value); setPage(1); }} aria-pressed={filter === value} className={`inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md border-0 px-3 text-xs font-bold transition ${filter === value ? "bg-white text-[#075e55] shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-800"}`}>
              {value === "OPEN" ? "Needs attention" : value === "UNVERIFIED" ? "Need evidence" : "Resolved"}<span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${filter === value ? "bg-teal-50 text-teal-800" : "bg-slate-200/70 text-slate-600"}`}>{statCount(value === "OPEN" ? summary.needsAttention : value === "UNVERIFIED" ? summary.unverified : summary.resolved)}</span>
            </button>)}
          </nav>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
            <label className="relative min-w-0 flex-1 sm:w-64"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden /><span className="sr-only">Search payment cases</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Case ref, guest or property" className="h-9 w-full rounded-lg border border-solid border-slate-200 bg-white pl-9 pr-3 text-xs text-slate-900 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" /></label>
            <button type="button" onClick={() => setReload((value) => value + 1)} title="Refresh cases" aria-label="Refresh cases" className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-800"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden /></button>
          </div>
        </div>

        {error ? <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-solid border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{error}</span><button type="button" onClick={() => setReload((value) => value + 1)} className="cursor-pointer border-0 bg-transparent font-bold text-rose-800 underline">Retry</button></div> : null}
        {!error && loading ? <div className="space-y-3 p-5" aria-label="Loading cases">{[0, 1, 2].map((key) => <div key={key} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div> : null}
        {!error && !loading && items.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-[#02665e] ring-1 ring-emerald-100">{filter === "RESOLVED" ? <CheckCheck className="h-6 w-6" aria-hidden /> : <Inbox className="h-6 w-6" aria-hidden />}</span>
            <h2 className="m-0 mt-4 text-base font-bold text-slate-950">{query ? "No matching cases" : filter === "OPEN" ? "All clear for now" : filter === "UNVERIFIED" ? "No reports awaiting evidence" : "No resolved cases yet"}</h2>
            <p className="m-0 mt-1 max-w-md text-[13px] leading-5 text-slate-500">{query ? "Try a different case reference, guest, or property." : filter === "OPEN" ? "Reports with a recorded payment attempt appear here. Unreported attempts remain in Bookings." : filter === "UNVERIFIED" ? "Traveller claims without a recorded payment attempt will appear here for provider verification." : "Cases will appear here after payment and code issues are resolved."}</p>
            {query ? <button type="button" onClick={() => setSearch("")} className="mt-4 cursor-pointer rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">Clear search</button> : filter === "OPEN" && summary.resolved > 0 ? <button type="button" onClick={() => { setFilter("RESOLVED"); setPage(1); }} className="mt-4 cursor-pointer rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 text-xs font-bold text-[#02665e]">View resolved cases</button> : null}
          </div>
        ) : null}
        {!error && !loading && items.length > 0 ? <div>
          <div className="flex items-center justify-between bg-slate-50/70 px-4 py-2 text-[11px] font-semibold text-slate-500 sm:px-5"><span>{filter === "RESOLVED" ? "Recently resolved first" : "Oldest reports first"}</span><span>{total} {total === 1 ? "case" : "cases"}</span></div>
          <div className="divide-y divide-slate-100">{items.map((item) => {
            const state = statusStyle[item.status] || { label: item.status.replace(/_/g, " "), className: "bg-slate-100 text-slate-700 ring-slate-200" };
            return <Link key={item.reference} href={`/admin/payment-cases/${encodeURIComponent(item.reference)}`} className="group grid min-w-0 gap-3 px-4 py-4 text-inherit no-underline transition hover:bg-teal-50/40 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] sm:items-center sm:px-5">
              <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-[#02665e]"><CreditCard className="h-4.5 w-4.5" aria-hidden /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="max-w-full truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">Case {item.reference}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${state.className}`}>{state.label}</span></div><strong className="mt-1 block truncate text-sm text-slate-950">{item.booking.propertyTitle}</strong><span className="mt-0.5 block truncate text-xs text-slate-500">{item.booking.guestName} · {item.booking.adminReference}</span></div></div>
              <div className="min-w-0 pl-[52px] text-xs sm:pl-0"><div className="font-semibold text-slate-700">{evidenceLabel[item.evidenceState] || item.evidenceState.replace(/_/g, " ")}</div><div className="mt-1 text-slate-500">Reported {reportedAt(item.createdAt)}</div></div>
              <div className="flex items-center justify-between gap-4 pl-[52px] sm:justify-end sm:pl-0"><strong className="whitespace-nowrap text-sm tabular-nums text-slate-900">{money(item.booking.amount)}</strong><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-solid border-slate-200 text-slate-400 transition group-hover:border-teal-200 group-hover:bg-white group-hover:text-[#02665e]"><ArrowRight className="h-4 w-4" aria-hidden /></span></div>
            </Link>;
          })}</div>
        </div> : null}
        {!error && !loading && total > 25 ? <div className="flex items-center justify-between border-0 border-t border-solid border-slate-100 px-4 py-3 text-xs text-slate-500 sm:px-5"><span>Page {page} of {Math.ceil(total / 25)}</span><div className="flex gap-2"><button type="button" disabled={page === 1} onClick={() => setPage((value) => value - 1)} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-solid border-slate-200 bg-white px-3 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" aria-hidden />Previous</button><button type="button" disabled={page * 25 >= total} onClick={() => setPage((value) => value + 1)} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-solid border-slate-200 bg-white px-3 font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" aria-hidden /></button></div></div> : null}
      </section>
    </main>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Eye, LockKeyhole, RefreshCw, Search } from "lucide-react";
import apiClient from "@/lib/apiClient";

type TourCase = {
  id: number; type: string; status: string; title: string; description: string; createdAt: string;
  operatorReceiptStatus?: "AWAITING_RECEIPT" | "RECEIVED";
  booking: { id: number; bookingCode: string; title: string; destination?: string | null; startDate?: string | null; status: string; payoutStatus: string; currency: string; grossAmount: number | string; operatorPayoutAmount: number | string; guestName?: string | null };
  events: Array<{ id: number; type: string; message?: string | null; createdAt: string }>;
};

const closed = (status: string) => ["RESOLVED", "REJECTED", "CLOSED", "WITHDRAWN"].includes(status);
const needsRecordReconciliation = (item: TourCase) => {
  const caseStatus = String(item.status || "").toUpperCase();
  const bookingStatus = String(item.booking.status || "").toUpperCase();
  const payoutStatus = String(item.booking.payoutStatus || "").toUpperCase();
  return caseStatus === "REJECTED" && (["CANCELED", "REFUNDED"].includes(bookingStatus) || payoutStatus === "HELD");
};
const label = (value: string) => value.replaceAll("_", " ");
const caseTitle = (value: string) => {
  const [prefix, ...detailParts] = value.split(":");
  if (!detailParts.length) return value;
  const detail = detailParts.join(":").trim().toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  return `${prefix.trim()}: ${detail}`;
};
const conciseDescription = (value: string) => {
  const sentences = value.match(/[^.!?]+[.!?]?/g) || [value];
  return Array.from(new Set(sentences.map((sentence) => sentence.trim()).filter(Boolean))).join(" ");
};
const statusTone = (status: string, active: boolean) => {
  if (status === "REJECTED") return "border-rose-200 bg-rose-50 text-rose-800";
  if (["RESOLVED", "CLOSED"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "APPROVED") return "border-blue-200 bg-blue-50 text-blue-800";
  return active ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700";
};
const PAGE_SIZE = 10;

export default function OperatorCancellationInboxPage() {
  const [items, setItems] = useState<TourCase[]>([]);
  const [summary, setSummary] = useState({ total: 0, submitted: 0, inReview: 0, refundQueue: 0, reconciliation: 0, closed: 0, awaitingReceipt: 0, received: 0, attention: 0 });
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"ACTIVE" | "ALL" | "CLOSED">("ACTIVE");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await apiClient.get("/api/agent/tour-cases");
      setItems(Array.isArray(response.data?.cases) ? response.data.cases : []);
      setSummary(response.data?.summary || summary);
    } catch (requestError: any) { setError(String(requestError?.response?.data?.error || "Could not load the cancellation inbox.")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => items.filter((item) => {
    const caseStatus = String(item.status || "").toUpperCase();
    const reconciliation = needsRecordReconciliation(item);
    if (view === "ACTIVE" && !reconciliation && item.operatorReceiptStatus !== "AWAITING_RECEIPT" && !["OPEN", "ELIGIBLE"].includes(caseStatus)) return false;
    if (view === "CLOSED" && (reconciliation || !closed(caseStatus))) return false;
    const haystack = `${item.id} ${item.title} ${item.description} ${item.booking.bookingCode} ${item.booking.title} ${item.booking.guestName || ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  }), [items, query, view]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [query, view]);

  return <main className="mx-auto box-border w-full max-w-6xl min-w-0 space-y-5 overflow-x-clip px-4 py-6 sm:px-6">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#02665e]">Operator control</div><h1 className="mt-1 text-2xl font-bold text-slate-950">Cancellation and case inbox</h1><p className="mt-1 text-sm text-slate-600">Cases requiring operational response, evidence, or payout awareness.</p></div><button type="button" onClick={() => void load()} className="inline-flex w-fit items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"><RefreshCw className="h-4 w-4" />Refresh</button></header>
    <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">{[
      ["Total cases", summary.total],
      ["Submitted", summary.submitted],
      ["In review", summary.inReview],
      ["Refund queue", summary.refundQueue],
      ["Reconciliation", summary.reconciliation],
      ["Closed", summary.closed],
    ].map(([name, value]) => <div key={String(name)} className={`min-w-0 rounded-lg border bg-white px-3 py-2.5 shadow-sm ${name === "Reconciliation" && Number(value) > 0 ? "border-rose-200 bg-rose-50" : "border-slate-200"}`}><div className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500" title={String(name)}>{name}</div><div className={`mt-1 text-xl font-bold leading-none ${name === "Reconciliation" && Number(value) > 0 ? "text-rose-700" : "text-slate-950"}`}>{value}</div></div>)}</section>
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="relative min-w-0 max-w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search case, booking, traveller, or tour"
          className="box-border block h-11 w-full min-w-0 max-w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
        />
      </div>
      <div className="mt-3 flex min-w-0 flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Case view</span>
        <div className="grid min-w-0 grid-cols-3 gap-2 sm:w-auto">
          {([
            ["ACTIVE", `Needs attention (${summary.attention})`],
            ["ALL", `All (${summary.total})`],
            ["CLOSED", `Closed (${summary.closed})`],
          ] as const).map(([option, text]) => <button key={option} type="button" onClick={() => setView(option)} className={`min-w-0 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors sm:min-w-28 ${view === option ? "bg-[#02665e] text-white shadow-sm" : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{text}</button>)}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">{view === "ACTIVE" ? "Cases the operator must review or remain aware of. The required action is stated in each row." : view === "CLOSED" ? "Completed cases with no unresolved record conflict and no further operator action." : "Every cancellation case across all workflow stages."}</p>
    </section>
    {error && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
    <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="hidden grid-cols-[7rem_minmax(13rem,1.35fr)_minmax(10rem,0.9fr)_minmax(13rem,1.1fr)_9rem_3.5rem] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 xl:grid">
        <div>Case ID</div><div>Traveller request</div><div>Booking</div><div>Required action</div><div>Submitted</div><div className="text-center">Open</div>
      </div>
      {loading ? <div className="p-10 text-center text-sm text-slate-500">Loading cases...</div> : filtered.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No cases match this view.</div> : <div className="divide-y divide-slate-100">{pagedItems.map((item) => {
        const caseStatus = String(item.status || "OPEN").toUpperCase();
        const bookingStatus = String(item.booking.status || "UNKNOWN").toUpperCase();
        const payoutStatus = String(item.booking.payoutStatus || "UNKNOWN").toUpperCase();
        const active = !closed(caseStatus);
        const rejected = caseStatus === "REJECTED";
        const needsReconciliation = needsRecordReconciliation(item);
        const outcome = needsReconciliation ? "Reconciliation required" : rejected ? "Cancellation declined" : caseStatus === "RESOLVED" ? "Case completed" : caseStatus === "APPROVED" ? "Cancellation approved" : active ? "Decision pending" : "Case closed";
        const requiredAction = item.operatorReceiptStatus === "AWAITING_RECEIPT"
          ? "Open the case and acknowledge receipt from NoLSAF"
          : needsReconciliation
          ? "Verify the booking record and await NoLSAF reconciliation"
          : ["OPEN", "ELIGIBLE"].includes(caseStatus)
            ? "Open and acknowledge the traveller request"
            : caseStatus === "ESCALATED"
              ? "Monitor NoLSAF review and provide evidence if requested"
              : caseStatus === "UNDER_REVIEW"
                ? "Submit requested evidence or monitor the review"
                : caseStatus === "ACKNOWLEDGED"
                  ? "Monitor the shared case for the next instruction"
                  : caseStatus === "APPROVED"
                    ? "Stop affected operations and await refund reconciliation"
                    : "No operator action required";
        const displayId = `CASE-${String(item.id).padStart(6, "0")}`;
        return <article key={item.id} className={`grid min-w-0 gap-4 px-4 py-4 md:grid-cols-2 xl:grid-cols-[7rem_minmax(13rem,1.35fr)_minmax(10rem,0.9fr)_minmax(13rem,1.1fr)_9rem_3.5rem] xl:items-center ${needsReconciliation ? "bg-rose-50/40" : "bg-white hover:bg-slate-50/70"}`}>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 xl:hidden">Case ID</div>
            <div className="font-mono text-xs font-bold text-[#02665e]">{displayId}</div>
            <span className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone(caseStatus, active)}`}>{label(caseStatus)}</span>
            <div className={`mt-1 text-[10px] font-semibold ${item.operatorReceiptStatus === "AWAITING_RECEIPT" ? "text-amber-700" : "text-emerald-700"}`}>{item.operatorReceiptStatus === "AWAITING_RECEIPT" ? "Awaiting your receipt" : "Received by operator"}</div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 xl:hidden">Traveller request</div>
            <div className="truncate text-sm font-bold text-slate-950" title={caseTitle(item.title)}>{caseTitle(item.title)}</div>
            <div className="mt-1 line-clamp-1 break-words text-xs text-slate-500">{conciseDescription(item.description)}</div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 xl:hidden">Booking</div>
            <div className="truncate text-sm font-semibold text-slate-900" title={item.booking.title}>{item.booking.title}</div>
            <div className="mt-1 truncate font-mono text-[11px] text-slate-500" title={item.booking.bookingCode}>{item.booking.bookingCode}</div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 xl:hidden">Required action</div>
            <div className={`text-sm font-semibold ${needsReconciliation ? "text-rose-700" : "text-slate-900"}`}>{requiredAction}</div>
            <div className="mt-1 text-[11px] text-slate-500">{outcome} · Booking {label(bookingStatus)} · Payout {active ? "unavailable" : label(payoutStatus)}</div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 xl:hidden">Submitted</div>
            <div className="text-xs font-medium text-slate-700">{new Date(item.createdAt).toLocaleDateString()}</div>
            <div className="mt-1 text-[11px] text-slate-500">{new Date(item.createdAt).toLocaleTimeString()}</div>
          </div>
          <div className="flex items-center md:justify-end xl:justify-center">
            <Link href={`/account/agent/tour-bookings/${item.booking.id}`} aria-label={`Open ${displayId}`} title={`Open ${displayId}`} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#02665e] text-white no-underline shadow-sm hover:bg-[#014d47] focus:outline-none focus:ring-2 focus:ring-[#02665e]/30"><Eye className="h-4 w-4" /></Link>
          </div>
        </article>;
      })}</div>}
      {!loading && filtered.length > 0 && <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-600">Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} cases</div>
        <div className="flex items-center gap-2"><button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button><span className="min-w-16 text-center text-xs font-semibold text-slate-600">Page {currentPage} of {pageCount}</span><button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button></div>
      </div>}
    </section>
    <footer className="flex items-start gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600"><LockKeyhole className="mt-0.5 h-4 w-4 flex-shrink-0" />NoLSAF is the system of record for cancellation, refund, and payout decisions. Email and SMS alerts link back to this workspace.</footer>
  </main>;
}

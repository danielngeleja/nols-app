"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, Inbox, LockKeyhole, RefreshCw, Search } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { publishRailCounts } from "@/lib/agentRailSignals";

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
  if (status === "REJECTED") return "border-red-200 bg-red-50 text-red-700";
  if (["RESOLVED", "CLOSED"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "APPROVED") return "border-blue-200 bg-blue-50 text-blue-700";
  return active ? "border-amber-200 bg-amber-50 text-amber-800" : "border-neutral-200 bg-neutral-50 text-neutral-600";
};
const PAGE_SIZE = 10;

type CaseView = "ACTIVE" | "ALL" | "CLOSED";

const CASE_VIEWS: CaseView[] = ["ACTIVE", "ALL", "CLOSED"];

// The view lives in the URL so the sidebar can deep link into it and a shared
// link reopens the same one.
const VIEW_PARAM = "view";

function parseView(value: string | null): CaseView {
  const key = String(value || "").toUpperCase();
  return (CASE_VIEWS as string[]).includes(key) ? (key as CaseView) : "ACTIVE";
}

const VIEW_DESCRIPTION: Record<CaseView, string> = {
  ACTIVE: "Cases the operator must review or remain aware of. The required action is stated in each row.",
  CLOSED: "Completed cases with no unresolved record conflict and no further operator action.",
  ALL: "Every cancellation case across all workflow stages.",
};

export default function OperatorCancellationInboxPage() {
  const [items, setItems] = useState<TourCase[]>([]);
  const [summary, setSummary] = useState({ total: 0, submitted: 0, inReview: 0, refundQueue: 0, reconciliation: 0, closed: 0, awaitingReceipt: 0, received: 0, attention: 0 });
  const [query, setQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseView(searchParams.get(VIEW_PARAM));

  // View buttons and sidebar links both go through the URL, so there is a
  // single source of truth for which case view is open.
  const setView = useCallback(
    (next: CaseView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "ACTIVE") params.delete(VIEW_PARAM);
      else params.set(VIEW_PARAM, next.toLowerCase());
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );
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

  // The rail marks the entry when cases need attention; publish the tally the
  // page already has rather than having the rail fetch the inbox again.
  useEffect(() => {
    if (loading) return;
    publishRailCounts("cases", {
      attention: summary.attention,
      all: summary.total,
      closed: summary.closed,
    });
  }, [loading, summary.attention, summary.total, summary.closed]);

  return <div className="min-w-0 max-w-full pb-10">
    <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Operator control</p>
        <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-900 sm:text-2xl">Cancellation and case inbox</h1>
        <p className="m-0 mt-1 text-sm text-neutral-500">Cases requiring operational response, evidence, or payout awareness.</p>
      </div>
      <button
        type="button"
        onClick={() => void load()}
        className="inline-flex min-h-9 w-fit shrink-0 cursor-pointer appearance-none items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 outline-none transition hover:border-emerald-200 hover:text-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-600/25"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
        Refresh
      </button>
    </header>

    {/* Hairline grid: one shared border colour showing through the gaps, the
        NRMS tile treatment, instead of six separately bordered cards. */}
    <section aria-label="Case summary" className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-3 xl:grid-cols-6">
      {([
        ["Total cases", summary.total, false],
        ["Submitted", summary.submitted, false],
        ["In review", summary.inReview, false],
        ["Refund queue", summary.refundQueue, false],
        ["Reconciliation", summary.reconciliation, true],
        ["Closed", summary.closed, false],
      ] as const).map(([name, value, alerts]) => {
        const flagged = alerts && Number(value) > 0;
        return (
          <div key={name} className={`min-w-0 px-3 py-2.5 ${flagged ? "bg-red-50" : "bg-white"}`}>
            <p className={`m-0 truncate text-[10px] font-bold uppercase tracking-[0.1em] ${flagged ? "text-red-600" : "text-neutral-400"}`} title={name}>{name}</p>
            <p className={`m-0 mt-1 text-xl font-bold leading-none ${flagged ? "text-red-700" : "text-neutral-900"}`}>{value}</p>
          </div>
        );
      })}
    </section>

    <section className="mb-4 min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white p-4 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
      <div className="relative min-w-0 max-w-full">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search case, booking, traveller, or tour"
          className="box-border block h-10 w-full min-w-0 max-w-full rounded-lg border border-solid border-neutral-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
        />
      </div>

      {/* Case view. Hidden from lg up, where the workspace sidebar owns view
          selection; below lg the sidebar is not rendered, so this stays as the
          only way to switch views. */}
      <div className="mt-3 flex min-w-0 flex-col gap-2 pt-3 shadow-[inset_0_1px_0_0_#f5f5f5] lg:hidden">
        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Case view</span>
        <div className="grid min-w-0 grid-cols-3 gap-2">
          {([
            ["ACTIVE", `Needs attention (${summary.attention})`],
            ["ALL", `All (${summary.total})`],
            ["CLOSED", `Closed (${summary.closed})`],
          ] as const).map(([option, text]) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={`min-w-0 cursor-pointer appearance-none rounded-lg border border-solid px-3 py-2.5 text-xs font-bold transition ${
                view === option
                  ? "border-emerald-700 bg-emerald-700 text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:border-emerald-200 hover:text-emerald-700"
              }`}
            >
              {text}
            </button>
          ))}
        </div>
      </div>

      <p className="m-0 mt-3 text-xs text-neutral-500">{VIEW_DESCRIPTION[view]}</p>
    </section>
    {error && <div className="mb-4 rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
      {!loading && filtered.length > 0 && <div className="hidden grid-cols-[7rem_minmax(13rem,1.35fr)_minmax(10rem,0.9fr)_minmax(13rem,1.1fr)_9rem_3.5rem] gap-4 bg-neutral-50/90 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 shadow-[inset_0_-1px_0_0_#e5e5e5] xl:grid">
        <div>Case ID</div><div>Traveller request</div><div>Booking</div><div>Required action</div><div>Submitted</div><div className="text-center">Open</div>
      </div>}
      {loading ? (
        <div className="flex justify-center py-16 text-neutral-400">
          <RefreshCw className="h-5 w-5 animate-spin" aria-hidden />
          <span className="sr-only">Loading cases</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-8">
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-300 px-6 py-12 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-400">
              <Inbox className="h-5 w-5" aria-hidden />
            </span>
            <p className="m-0 mt-1 text-sm font-bold text-neutral-800">No cases in this view</p>
            <p className="m-0 text-xs text-neutral-500">
              {query.trim() ? "No cases match your search." : "Cancellation cases raised by travellers will appear here."}
            </p>
          </div>
        </div>
      ) : <div>{pagedItems.map((item) => {
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
        return <article key={item.id} className={`grid min-w-0 gap-4 px-4 py-4 shadow-[inset_0_-1px_0_0_#f5f5f5] transition last:shadow-none md:grid-cols-2 xl:grid-cols-[7rem_minmax(13rem,1.35fr)_minmax(10rem,0.9fr)_minmax(13rem,1.1fr)_9rem_3.5rem] xl:items-center ${needsReconciliation ? "bg-red-50/50" : "bg-white hover:bg-emerald-50/35"}`}>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 xl:hidden">Case ID</div>
            <div className="font-mono text-xs font-bold text-emerald-700">{displayId}</div>
            <span className={`mt-2 inline-flex rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${statusTone(caseStatus, active)}`}>{label(caseStatus)}</span>
            <div className={`mt-1 text-[10px] font-semibold ${item.operatorReceiptStatus === "AWAITING_RECEIPT" ? "text-amber-700" : "text-emerald-700"}`}>{item.operatorReceiptStatus === "AWAITING_RECEIPT" ? "Awaiting your receipt" : "Received by operator"}</div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 xl:hidden">Traveller request</div>
            <div className="truncate text-sm font-bold text-neutral-900" title={caseTitle(item.title)}>{caseTitle(item.title)}</div>
            <div className="mt-1 line-clamp-1 break-words text-xs text-neutral-500">{conciseDescription(item.description)}</div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 xl:hidden">Booking</div>
            <div className="truncate text-sm font-semibold text-neutral-800" title={item.booking.title}>{item.booking.title}</div>
            <div className="mt-1 truncate font-mono text-[11px] text-neutral-500" title={item.booking.bookingCode}>{item.booking.bookingCode}</div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 xl:hidden">Required action</div>
            <div className={`text-sm font-semibold ${needsReconciliation ? "text-red-700" : "text-neutral-800"}`}>{requiredAction}</div>
            <div className="mt-1 text-[11px] text-neutral-500">{outcome} · Booking {label(bookingStatus)} · Payout {active ? "unavailable" : label(payoutStatus)}</div>
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400 xl:hidden">Submitted</div>
            <div className="text-xs font-medium text-neutral-700">{new Date(item.createdAt).toLocaleDateString()}</div>
            <div className="mt-1 text-[11px] text-neutral-500">{new Date(item.createdAt).toLocaleTimeString()}</div>
          </div>
          <div className="flex items-center md:justify-end xl:justify-center">
            <Link href={`/account/agent/tour-bookings/${item.booking.id}`} aria-label={`Open ${displayId}`} title={`Open ${displayId}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700 text-white no-underline transition hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/30"><Eye className="h-4 w-4" /></Link>
          </div>
        </article>;
      })}</div>}
      {!loading && filtered.length > 0 && <div className="flex flex-col gap-3 bg-neutral-50/70 px-4 py-3 shadow-[inset_0_1px_0_0_#eeeeee] sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[11px] font-semibold text-neutral-500">Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} cases</div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex min-h-9 cursor-pointer appearance-none items-center rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-600 transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
          <span className="min-w-16 text-center text-[11px] font-semibold text-neutral-500">Page {currentPage} of {pageCount}</span>
          <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="inline-flex min-h-9 cursor-pointer appearance-none items-center rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-600 transition hover:border-emerald-200 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
        </div>
      </div>}
    </section>

    <footer className="mt-4 flex items-start gap-2 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-500"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />NoLSAF is the system of record for cancellation, refund, and payout decisions. Email and SMS alerts link back to this workspace.</footer>
  </div>;
}

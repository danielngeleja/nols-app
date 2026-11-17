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
  booking: { id: number; ref?: string; bookingCode: string; title: string; destination?: string | null; startDate?: string | null; status: string; payoutStatus: string; currency: string; grossAmount: number | string; operatorPayoutAmount: number | string; guestName?: string | null };
  events: Array<{ id: number; type: string; message?: string | null; createdAt: string }>;
};

const closed = (status: string) => ["RESOLVED", "REJECTED", "CLOSED", "WITHDRAWN"].includes(status);
const needsRecordReconciliation = (item: TourCase) => {
  const caseStatus = String(item.status || "").toUpperCase();
  const bookingStatus = String(item.booking.status || "").toUpperCase();
  const payoutStatus = String(item.booking.payoutStatus || "").toUpperCase();
  return caseStatus === "REJECTED" && (["CANCELED", "REFUNDED"].includes(bookingStatus) || payoutStatus === "HELD");
};
const label = (value: string) => {
  const text = value.replaceAll("_", " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};
const EAT = "Africa/Dar_es_Salaam";
const eatDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: EAT });
const eatTime = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: EAT });
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
  const searchParams = useSearchParams();
  // Email and alert links open one case by its booking code (never a row id).
  const [query, setQuery] = useState(() => String(searchParams.get("booking") || "").trim().slice(0, 40));
  const router = useRouter();
  const pathname = usePathname();
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
      setSummary((current) => response.data?.summary || current);
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

  const attention = Number(summary.attention || 0);
  return <div className="min-w-0 max-w-full space-y-4 pb-10">
    {/* Header: what this inbox is, what needs you now, and the one action. */}
    <header className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
            <Inbox className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-[18px] font-bold tracking-tight text-neutral-900 sm:text-xl">Cases and cancellations</h1>
            <p className="m-0 mt-1 text-[13px] leading-5 text-neutral-500">Traveller cancellation requests on your trips. Each case says what NoLSAF needs from you.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border border-solid px-3 text-[13px] font-semibold ${
              attention ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${attention ? "bg-amber-500" : "bg-emerald-500"}`} aria-hidden />
            {attention ? `${attention} need${attention === 1 ? "s" : ""} you` : "Nothing needs you"}
          </span>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh cases"
            className="inline-flex h-9 cursor-pointer appearance-none items-center gap-1.5 rounded-md border border-solid border-neutral-300 bg-white px-3 text-[13px] font-medium text-neutral-700 outline-none transition hover:border-emerald-300 hover:text-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-600/25"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {/* Where every case stands, left to right in the order a case moves. */}
      <dl aria-label="Case summary" className="m-0 grid grid-cols-2 border-0 border-t border-solid border-neutral-200 sm:grid-cols-3 xl:grid-cols-6">
        {([
          ["All cases", summary.total, "", false],
          ["Submitted", summary.submitted, "Waiting for you or NoLSAF", false],
          ["In review", summary.inReview, "NoLSAF is deciding", false],
          ["Refund queue", summary.refundQueue, "Approved, refund pending", false],
          ["Reconciliation", summary.reconciliation, "Records disagree", true],
          ["Closed", summary.closed, "Nothing left to do", false],
        ] as const).map(([name, value, hint, alerts], i) => {
          const flagged = alerts && Number(value) > 0;
          return (
            <div
              key={name}
              className={`min-w-0 px-4 py-3 ${flagged ? "bg-red-50" : ""} ${i ? "border-0 border-l border-solid border-neutral-100" : ""}`}
            >
              <dt className={`truncate text-[12px] ${flagged ? "font-medium text-red-700" : "text-neutral-500"}`}>{name}</dt>
              <dd className={`m-0 mt-0.5 text-[20px] font-bold leading-tight tabular-nums ${flagged ? "text-red-700" : "text-neutral-900"}`}>{value}</dd>
              {hint ? <dd className="m-0 truncate text-[11.5px] text-neutral-400" title={hint}>{hint}</dd> : null}
            </div>
          );
        })}
      </dl>
    </header>

    <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white p-4">
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by booking code, traveller, tour or case"
            aria-label="Search cases"
            className="box-border block h-10 w-full min-w-0 max-w-full rounded-md border border-solid border-neutral-300 bg-white pl-9 pr-3 text-sm outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
          />
        </div>

        {/* Case view. Shown everywhere: the sidebar also links to each view, but
            the operator should not have to look away to switch. */}
        <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-solid border-neutral-300" role="group" aria-label="Case view">
          {([
            ["ACTIVE", "Needs you", summary.attention],
            ["ALL", "All", summary.total],
            ["CLOSED", "Closed", summary.closed],
          ] as const).map(([option, text, count], i) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={`inline-flex h-10 cursor-pointer appearance-none items-center gap-1.5 border-0 px-3.5 text-[13px] font-medium transition ${i ? "border-l border-solid border-neutral-300" : ""} ${
                view === option ? "bg-emerald-700 text-white" : "bg-white text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {text}
              <span className={`rounded px-1.5 text-[11.5px] tabular-nums ${view === option ? "bg-white/20" : "bg-neutral-100 text-neutral-600"}`}>{count}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="m-0 mt-2.5 text-[12.5px] text-neutral-500">{VIEW_DESCRIPTION[view]}</p>
    </section>
    {error && <div className="rounded-lg border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
    <section className="min-w-0 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
      {!loading && filtered.length > 0 && <div className="hidden grid-cols-[7rem_minmax(13rem,1.35fr)_minmax(10rem,0.9fr)_minmax(13rem,1.1fr)_9rem_3.5rem] gap-4 border-0 border-b border-solid border-neutral-200 bg-neutral-50 px-4 py-2.5 text-[12px] font-medium text-neutral-500 xl:grid">
        <div>Case</div><div>Traveller request</div><div>Booking</div><div>What to do</div><div>Submitted (EAT)</div><div className="text-center">Open</div>
      </div>}
      {loading ? (
        <div className="flex justify-center py-16 text-neutral-400">
          <RefreshCw className="h-5 w-5 animate-spin" aria-hidden />
          <span className="sr-only">Loading cases</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-8">
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-300 px-6 py-10 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-neutral-100 text-neutral-400">
              <Inbox className="h-5 w-5" aria-hidden />
            </span>
            <p className="m-0 mt-1 text-sm font-semibold text-neutral-800">{query.trim() ? "No cases match your search" : view === "ACTIVE" ? "Nothing needs you right now" : "No cases here"}</p>
            <p className="m-0 text-[12.5px] leading-5 text-neutral-500">
              {query.trim()
                ? "Try a booking code or the traveller's name."
                : view === "ACTIVE"
                  ? "When a traveller asks to cancel a paid trip, it appears here with what to do and by when."
                  : "Cancellation cases raised by travellers will appear here."}
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
        const mustAct = item.operatorReceiptStatus === "AWAITING_RECEIPT" || needsReconciliation || ["OPEN", "ELIGIBLE"].includes(caseStatus);
        const fieldLabel = "mb-1 text-[11.5px] text-neutral-400 xl:hidden";
        return <article key={item.id} className={`relative grid min-w-0 gap-4 border-0 border-b border-solid border-neutral-100 px-4 py-4 transition last:border-b-0 md:grid-cols-2 xl:grid-cols-[7rem_minmax(13rem,1.35fr)_minmax(10rem,0.9fr)_minmax(13rem,1.1fr)_9rem_3.5rem] xl:items-center ${needsReconciliation ? "bg-red-50/50" : "bg-white hover:bg-emerald-50/35"}`}>
          {mustAct ? <span className={`absolute inset-y-0 left-0 w-[3px] ${needsReconciliation ? "bg-red-500" : "bg-amber-500"}`} aria-hidden /> : null}
          <div className="min-w-0">
            <div className={fieldLabel}>Case</div>
            <div className="font-mono text-[12px] font-semibold text-emerald-800">{displayId}</div>
            <span className={`mt-1.5 inline-flex rounded border border-solid px-1.5 py-0.5 text-[11.5px] font-semibold ${statusTone(caseStatus, active)}`}>{label(caseStatus)}</span>
            <div className={`mt-1 text-[11.5px] font-medium ${item.operatorReceiptStatus === "AWAITING_RECEIPT" ? "text-amber-700" : "text-emerald-700"}`}>{item.operatorReceiptStatus === "AWAITING_RECEIPT" ? "Not opened by you yet" : "Opened by you"}</div>
          </div>
          <div className="min-w-0">
            <div className={fieldLabel}>Traveller request</div>
            <div className="truncate text-[14px] font-semibold text-neutral-900" title={caseTitle(item.title)}>{caseTitle(item.title)}</div>
            <div className="mt-1 line-clamp-1 break-words text-[12.5px] text-neutral-500">{conciseDescription(item.description)}</div>
          </div>
          <div className="min-w-0">
            <div className={fieldLabel}>Booking</div>
            <div className="truncate text-[13.5px] font-medium text-neutral-800" title={item.booking.title}>{item.booking.title}</div>
            <div className="mt-1 truncate font-mono text-[11.5px] text-neutral-500" title={item.booking.bookingCode}>{item.booking.bookingCode}</div>
          </div>
          <div className="min-w-0">
            <div className={fieldLabel}>What to do</div>
            <div className={`text-[13.5px] font-semibold ${needsReconciliation ? "text-red-700" : mustAct ? "text-amber-900" : "text-neutral-800"}`}>{requiredAction}</div>
            <div className="mt-1 text-[11.5px] text-neutral-500">{outcome} · Booking {label(bookingStatus).toLowerCase()}{active ? " · Payouts paused while open" : ` · Payout ${label(payoutStatus).toLowerCase()}`}</div>
          </div>
          <div className="min-w-0">
            <div className={fieldLabel}>Submitted (EAT)</div>
            <div className="text-[12.5px] font-medium text-neutral-700">{eatDate(item.createdAt)}</div>
            <div className="mt-0.5 text-[11.5px] text-neutral-500">{eatTime(item.createdAt)}</div>
          </div>
          <div className="flex items-center md:justify-end xl:justify-center">
            <Link href={`/account/agent/tour-bookings/${encodeURIComponent(item.booking.ref || String(item.booking.id))}`} aria-label={`Open ${displayId}`} title={`Open ${displayId}`} className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-700 text-white no-underline transition hover:bg-emerald-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600/30"><Eye className="h-4 w-4" /></Link>
          </div>
        </article>;
      })}</div>}
      {!loading && filtered.length > 0 && <div className="flex flex-col gap-3 border-0 border-t border-solid border-neutral-200 bg-neutral-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[11px] font-semibold text-neutral-500">Showing {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length} cases</div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="inline-flex min-h-9 cursor-pointer appearance-none items-center rounded-md border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
          <span className="min-w-16 text-center text-[11px] font-semibold text-neutral-500">Page {currentPage} of {pageCount}</span>
          <button type="button" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} className="inline-flex min-h-9 cursor-pointer appearance-none items-center rounded-md border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 transition hover:border-emerald-300 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
        </div>
      </div>}
    </section>

    <footer className="flex items-start gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-4 py-3 text-xs text-neutral-500"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden />NoLSAF is the system of record for cancellation, refund, and payout decisions. Email and SMS alerts link back to this workspace.</footer>
  </div>;
}

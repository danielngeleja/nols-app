"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, FileText, Inbox, Loader2, Search, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { tsh } from "../eventHireTypes";
import { BookingDetails, type Booking } from "../EventHireWorkspace";
import ws from "../event-workspace.module.css";
import { askFinanceGrant, errorText, label, needsFinanceGrant, refreshEventHire, relative, span, usePulse, useWorkspaceRefresh, type Summary } from "./eventAdmin";
import { Drawer, ErrorNote, EyeButton, Loading, Pill, SortTh, btn, sortRows, type SortState } from "./ui";

const BASE = "/api/admin/event-hire/operations";
const STATUSES = ["PAYMENT_REVIEW", "PAYMENT_PENDING", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"] as const;
type BookingView = "attention" | "all" | (typeof STATUSES)[number];
type MoneyView = "all" | "held" | "window" | "hold" | "settling" | "settled";
type SortKey = "date" | "venue" | "organizer" | "guests" | "total" | "deposit" | "owner" | "status";
const TZ = "Africa/Dar_es_Salaam";
const shortDate = (v: string) => new Date(v).toLocaleDateString("en-GB", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" });
const shortTime = (v: string) => new Date(v).toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

/** Why a paid booking needs a reviewer, if it does. */
export function bookingFlags(b: Booking, now = Date.now()): string[] {
  const out: string[] = [];
  if (b.cancellationRequestedAt && b.status !== "CANCELLED") out.push("Cancellation review");
  if (b.claims?.[0] && b.claims[0].status !== "RESOLVED") out.push("Damage claim");
  if (b.status === "CONFIRMED" && new Date(b.endsAt).getTime() <= now) out.push("Ready to close");
  if (b.transfers.some(t => t.status === "REVIEW")) out.push("Payout to approve");
  if (b.status === "PAYMENT_REVIEW") out.push("Check payment");
  return out;
}

/** Event over, deposit still held, owner can still claim against it. */
const inClaimWindow = (b: Booking, now = Date.now()) => b.depositStatus === "HELD" && new Date(b.endsAt).getTime() <= now && now < new Date(b.claimDeadline).getTime();
const moneyMatch = (b: Booking, v: MoneyView) => v === "all" ? Boolean(b.paidAt)
  : v === "held" ? b.depositStatus === "HELD"
  : v === "window" ? inClaimWindow(b)
  : v === "hold" ? ["DISPUTED", "ON_HOLD", "REFUND_REVIEW"].includes(b.depositStatus) || ["DISPUTED", "ON_HOLD"].includes(b.payoutStatus)
  : v === "settling" ? b.transfers.some(t => ["REVIEW", "APPROVED"].includes(t.status))
  : b.payoutStatus === "SETTLED" || b.payoutStatus === "PAID" || b.transfers.some(t => t.status === "PAID");

function sortValue(b: Booking, k: SortKey): string | number {
  switch (k) {
    case "date": return new Date(b.startsAt).getTime();
    case "venue": return b.propertyTitle.toLowerCase();
    case "organizer": return (b.organizer || "").toLowerCase();
    case "guests": return b.people;
    case "total": return b.total;
    case "deposit": return b.deposit;
    case "owner": return b.ownerDue ?? 0;
    case "status": return label(b.status);
  }
}

export default function AdminEventBookings({ mode = "bookings" }: { mode?: "bookings" | "collections" }) {
  return <Suspense fallback={<Loading />}><Bookings mode={mode} /></Suspense>;
}

function Bookings({ mode }: { mode: "bookings" | "collections" }) {
  const pulse = usePulse();
  const s = pulse.summary;
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const urlView = params.get("view");
  const valid = (v: string | null): v is BookingView => Boolean(v && (["attention", "all", ...STATUSES] as string[]).includes(v));
  const [view, setView] = useState<BookingView>(() => (valid(urlView) ? urlView : "all"));
  const [moneyView, setMoneyView] = useState<MoneyView>("all");
  const [rows, setRows] = useState<Booking[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "desc" });
  const [openRef, setOpenRef] = useState<string | null>(params.get("eventBooking"));

  useEffect(() => { if (valid(urlView)) setView(urlView); }, [urlView]);

  const serverView = mode === "collections" ? "all" : view;
  const load = useCallback(async (nextPage = 1) => {
    setLoading(true); setError("");
    try {
      if (serverView === "attention") {
        const [c, d, r] = await Promise.all(["CONFIRMED", "COMPLETED", "PAYMENT_REVIEW"].map(status => apiClient.get(`${BASE}/bookings`, { params: { status } })));
        setRows([...r.data.bookings, ...c.data.bookings, ...d.data.bookings].filter((b: Booking) => bookingFlags(b).length));
        setHasMore(false); setPage(1);
      } else {
        const r = await apiClient.get(`${BASE}/bookings`, { params: { page: nextPage, ...(serverView !== "all" ? { status: serverView } : {}) } });
        setRows(prev => (nextPage === 1 ? r.data.bookings : [...prev, ...r.data.bookings]));
        setHasMore(r.data.hasMore); setPage(nextPage);
      }
    } catch (e) { setError(errorText(e, "Could not load event bookings.")); if (nextPage === 1) setRows([]); }
    finally { setLoading(false); }
  }, [serverView]);
  useEffect(() => { void load(1); }, [load]);
  useWorkspaceRefresh(useCallback(() => { void load(1); }, [load]));

  const pick = (v: BookingView) => { setView(v); router.replace(`${pathname}?view=${v}`, { scroll: false }); };
  const onSort = (k: SortKey) => setSort(p => (p.key === k ? { key: k, dir: p.dir === "asc" ? "desc" : "asc" } : { key: k, dir: ["venue", "organizer", "status"].includes(k) ? "asc" : "desc" }));
  const statusCount = (k: string) => (s ? s.statuses[k] || 0 : null);
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => sortRows(
    rows.filter(b => (mode === "bookings" || moneyMatch(b, moneyView)) && (!q || b.propertyTitle.toLowerCase().includes(q) || (b.organizer || "").toLowerCase().includes(q))),
    sort, sortValue,
  ), [rows, q, mode, moneyView, sort]);

  const cell = (k?: SortKey, extra = "") => `px-3 py-2 align-middle ${k === sort.key ? "bg-[#02665e]/[0.04]" : ""} ${extra}`;
  const divider = "border-0 border-l border-solid border-neutral-100";
  const emptyText = q ? "No booking matches that search."
    : mode === "collections" ? (moneyView === "all" ? "No payments yet. Records appear once a client completes checkout." : "No payment records at this stage.")
    : view === "attention" ? "No booking needs review right now." : "No bookings at this stage. Approved date requests become bookings once the client pays.";

  return (
    <div className="space-y-3">
      {mode === "collections" && <>
        <MoneyJourney rows={rows} ready={!(loading && !rows.length)} partial={hasMore} summary={s} view={moneyView} onView={setMoneyView} />
        <div className="grid min-w-0 items-start gap-3 lg:grid-cols-2">
          <DepositsDue rows={rows} onOpen={setOpenRef} />
          <MoneySplit rows={rows} />
        </div>
      </>}

      {mode === "bookings" && <>
        <BookingLifecycle view={view} onView={pick} count={statusCount} />
        <NextSevenDays onOpen={setOpenRef} />
      </>}

      {error && <ErrorNote>{error}</ErrorNote>}

      <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white" aria-busy={loading}>
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
          <p className="m-0 flex-1 text-[13px] font-semibold text-neutral-900">{mode === "collections" ? "Payment records" : "Bookings"}<span className="ml-1.5 font-normal text-neutral-400">{loading && !rows.length ? "" : visible.length}</span></p>
          <label className="relative w-full sm:w-64">
            <span className="sr-only">Search bookings</span>
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search venue or organizer" className="h-8 w-full rounded-md border border-solid border-neutral-200 bg-neutral-50 pl-8 pr-3 text-[12.5px] text-neutral-900 outline-none focus:border-[#02665e] focus:bg-white focus:ring-2 focus:ring-[#02665e]/15" />
          </label>
        </div>

        {loading && !rows.length ? <Loading>Loading</Loading> : visible.length === 0 ? (
          <p className="m-0 flex items-center gap-2 px-4 py-5 text-[12.5px] text-neutral-500">{mode === "collections" ? <Inbox className="h-4 w-4 shrink-0 text-neutral-400" /> : <FileText className="h-4 w-4 shrink-0 text-neutral-400" />}{emptyText}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] border-collapse text-left text-[12.5px]">
              <thead className="sticky top-0 z-[1]">
                <tr className="border-0 border-b border-solid border-neutral-200 bg-neutral-100">
                  <SortTh k="date" label="Event date" sort={sort} onSort={onSort} first />
                  <SortTh k="venue" label="Venue" sort={sort} onSort={onSort} />
                  {mode === "bookings" ? <>
                    <SortTh k="organizer" label="Organizer" sort={sort} onSort={onSort} />
                    <SortTh k="guests" label="Guests" sort={sort} onSort={onSort} right />
                    <SortTh k="total" label="Client paid" sort={sort} onSort={onSort} right />
                    <SortTh k="status" label="Status" sort={sort} onSort={onSort} />
                    <th className="border-0 border-l border-solid border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-600">Needs</th>
                  </> : <>
                    <SortTh k="total" label="Client paid" sort={sort} onSort={onSort} right />
                    <SortTh k="deposit" label="Deposit" sort={sort} onSort={onSort} right />
                    <th className="border-0 border-l border-solid border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-600">Deposit status</th>
                    <SortTh k="owner" label="Owner earnings" sort={sort} onSort={onSort} right />
                    <th className="border-0 border-l border-solid border-neutral-200 px-3 py-2 text-[11px] font-semibold text-neutral-600">Transfers</th>
                  </>}
                  <th className="w-12 border-0 border-l border-solid border-neutral-200 px-3 py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((b, i) => {
                  const flags = bookingFlags(b);
                  return (
                    <tr key={b.reference} onDoubleClick={() => setOpenRef(b.reference)} className={`border-0 border-t border-solid border-neutral-100 transition-colors hover:bg-[#02665e]/[0.05] ${i % 2 ? "bg-neutral-50" : "bg-white"}`}>
                      <td className={cell("date", "whitespace-nowrap")}><p className="m-0 font-semibold tabular-nums text-neutral-900">{shortDate(b.startsAt)}</p><p className="m-0 text-[11px] tabular-nums text-neutral-500">{shortTime(b.startsAt)} · {relative(b.startsAt)}</p></td>
                      <td className={cell("venue", `${divider} max-w-[240px]`)}><p className="m-0 truncate font-medium text-neutral-900">{b.propertyTitle}</p><p className="m-0 truncate text-[11px] text-neutral-500">{mode === "collections" ? `${label(b.status)} · ${b.organizer}` : span(b.startsAt, b.endsAt)}</p></td>
                      {mode === "bookings" ? <>
                        <td className={cell("organizer", `${divider} max-w-[180px]`)}><p className="m-0 truncate text-neutral-800">{b.organizer}</p></td>
                        <td className={cell("guests", `${divider} text-right tabular-nums text-neutral-800`)}>{b.people}</td>
                        <td className={cell("total", `${divider} text-right tabular-nums`)}><p className="m-0 font-semibold text-neutral-900">{tsh(b.total)}</p><p className="m-0 text-[11px] text-neutral-500">{b.paidAt ? `Verified ${shortDate(b.paidAt)}` : label(b.checkoutStatus)}</p></td>
                        <td className={cell("status", divider)}><Pill status={b.status}>{label(b.status)}</Pill></td>
                        <td className={cell(undefined, divider)}>{flags.length ? <div className="flex flex-wrap gap-1">{flags.map(f => <Pill key={f} kind="amber">{f}</Pill>)}</div> : <span className="text-[11.5px] text-neutral-400">None</span>}</td>
                      </> : <>
                        <td className={cell("total", `${divider} text-right tabular-nums`)}><p className="m-0 font-semibold text-neutral-900">{tsh(b.total)}</p><p className="m-0 text-[11px] text-neutral-500">{b.paidAt ? `Verified ${shortDate(b.paidAt)}` : label(b.checkoutStatus)}</p></td>
                        <td className={cell("deposit", `${divider} text-right font-semibold tabular-nums text-neutral-900`)}>{tsh(b.deposit)}</td>
                        <td className={cell(undefined, divider)}><Pill status={b.depositStatus}>{label(b.depositStatus)}</Pill></td>
                        <td className={cell("owner", `${divider} text-right tabular-nums`)}><p className="m-0 font-semibold text-neutral-900">{tsh(b.ownerDue)}</p><p className="m-0 text-[11px] text-neutral-500">{label(b.payoutStatus)}</p></td>
                        <td className={cell(undefined, divider)}>{b.transfers.length ? <div className="flex flex-col gap-0.5">{b.transfers.map(t => <span key={t.reference} className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-neutral-600"><Pill status={t.status}>{label(t.status)}</Pill>{label(t.kind)} · {tsh(t.amount)}</span>)}</div> : <span className="text-[11.5px] text-neutral-400">Not prepared yet</span>}</td>
                      </>}
                      <td className={`${divider} px-3 py-2 text-right align-middle`}><EyeButton onClick={() => setOpenRef(b.reference)} label={`Open ${b.propertyTitle}`} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {hasMore && (
          <div className="border-0 border-t border-solid border-neutral-100 px-3 py-2 text-center">
            <button type="button" className={btn} disabled={loading} onClick={() => void load(page + 1)}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Load more</button>
          </div>
        )}
        {view === "attention" && mode === "bookings" && rows.length > 0 && <p className="m-0 border-0 border-t border-solid border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-400">Checks the 40 most recent bookings in payment review, confirmed and completed.</p>}
      </section>

      {openRef && <BookingDrawer key={openRef} reference={openRef} onClose={() => { setOpenRef(null); if (params.get("eventBooking")) router.replace(pathname, { scroll: false }); }} />}
    </div>
  );
}

/**
 * Where client money is on its way back out: collected, held as deposits,
 * inside the claim window, settling, paid out. Each stage is also the filter
 * for the table below.
 */
function MoneyJourney({ rows, ready, partial, summary, view, onView }: {
  rows: Booking[]; ready: boolean; partial: boolean; summary: Summary | null; view: MoneyView; onView: (v: MoneyView) => void;
}) {
  const of = (v: MoneyView) => rows.filter(b => moneyMatch(b, v));
  const inWindow = of("window"), frozen = of("hold");
  const settlingSum = rows.reduce((n, b) => n + b.transfers.filter(t => ["REVIEW", "APPROVED"].includes(t.status)).reduce((m, t) => m + t.amount, 0), 0);
  const stages: Array<{ v: MoneyView; label: string; amount: number | undefined; n: number; note: string }> = [
    { v: "all", label: "Collected", amount: summary?.collected, n: of("all").length, note: "verified payments" },
    { v: "held", label: "Deposits held", amount: summary?.depositHeld, n: of("held").length, note: "owed to clients" },
    { v: "window", label: "Claim window", amount: inWindow.reduce((n, b) => n + b.deposit, 0), n: inWindow.length, note: "owner may still claim" },
    { v: "settling", label: "Settling", amount: summary?.settlementPending ?? settlingSum, n: of("settling").length, note: "approve, then release" },
    { v: "settled", label: "Paid out", amount: summary?.settled, n: of("settled").length, note: "provider confirmed" },
  ];
  return (
    <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
        <p className="m-0 text-[13px] font-semibold text-neutral-900">Client money, step by step <span className="font-normal text-neutral-400">· click a step to list its bookings</span></p>
        {frozen.length > 0 && (
          <button type="button" onClick={() => onView(view === "hold" ? "all" : "hold")} className={`inline-flex h-6 items-center gap-1.5 rounded-full border border-solid px-2 text-[11px] font-semibold ${view === "hold" ? "border-amber-500 bg-amber-500 text-white" : "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{frozen.length} disputed or on hold
          </button>
        )}
      </div>
      <ol className="m-0 grid list-none grid-cols-2 p-0 sm:grid-cols-5">
        {stages.map((st, i) => {
          const on = view === st.v;
          return (
            <li key={st.v} className={`relative min-w-0 ${i ? "border-0 border-l border-solid border-neutral-100" : ""}`}>
              <button type="button" onClick={() => onView(st.v)} aria-pressed={on}
                className={`flex w-full min-w-0 flex-col items-start gap-0.5 border-0 px-3 py-2.5 text-left transition-colors ${on ? "bg-[#0b2420] text-white" : "bg-white hover:bg-neutral-50"}`}>
                <span className={`flex w-full items-center gap-1.5 text-[11px] font-semibold ${on ? "text-white/70" : "text-neutral-500"}`}>
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9.5px] ${on ? "bg-white/15 text-white" : "bg-neutral-100 text-neutral-500"}`}>{i + 1}</span>
                  <span className="truncate">{st.label}</span>
                </span>
                <strong className={`truncate text-[16px] font-bold tabular-nums ${on ? "text-white" : "text-neutral-900"}`}>{st.amount === undefined ? "..." : tsh(st.amount)}</strong>
                <span className={`truncate text-[10.5px] ${on ? "text-white/50" : "text-neutral-400"}`}>{ready ? `${st.n} ${st.n === 1 ? "event" : "events"} · ${st.note}` : st.note}</span>
              </button>
              {i < stages.length - 1 && <ChevronRight className="pointer-events-none absolute -right-2 top-1/2 z-[1] hidden h-4 w-4 -translate-y-1/2 rounded-full bg-white text-neutral-300 sm:block" aria-hidden />}
            </li>
          );
        })}
      </ol>
      <p className="m-0 flex items-center gap-1.5 border-0 border-t border-solid border-neutral-100 px-3 py-1.5 text-[11px] text-neutral-500">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#02665e]" />
        {summary && summary.collected === 0 ? "No client payment collected yet. Each step fills in as checkouts are verified." : "Deposits stay apart from venue earnings; a transfer is paid only once the provider confirms it."}
        {partial ? " Event counts read the latest 40 bookings." : ""}
      </p>
    </section>
  );
}

/** Held deposits in the order they come due: event ahead, claim window open, ready to settle. */
function DepositsDue({ rows, onOpen }: { rows: Booking[]; onOpen: (ref: string) => void }) {
  const now = Date.now();
  const held = rows.filter(b => b.depositStatus === "HELD" && b.deposit > 0).map(b => {
    const ended = new Date(b.endsAt).getTime() <= now, closes = new Date(b.claimDeadline).getTime();
    const stage = !ended ? { at: new Date(b.startsAt).getTime(), text: `Event ${relative(b.startsAt)}`, tone: "text-neutral-500" }
      : now < closes ? { at: closes, text: `Claim window closes ${relative(b.claimDeadline)}`, tone: "text-amber-700" }
      : { at: closes, text: "Window closed, ready to settle", tone: "text-[#02665e]" };
    return { b, ...stage };
  }).sort((x, y) => x.at - y.at);
  const total = held.reduce((n, h) => n + h.b.deposit, 0);
  return (
    <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
        <p className="m-0 text-[13px] font-semibold text-neutral-900">Deposits coming due</p>
        <span className="text-[11.5px] font-semibold tabular-nums text-neutral-500">{held.length ? `${tsh(total)} in ${held.length}` : ""}</span>
      </div>
      {held.length === 0 ? (
        <p className="m-0 px-3 py-3 text-[12px] text-neutral-500">No deposit is held right now. Each one appears here with the day it can be returned.</p>
      ) : (
        <ul className="m-0 max-h-[15rem] list-none overflow-y-auto p-0">
          {held.map(({ b, text, tone }) => (
            <li key={b.reference} className="flex items-center gap-2.5 border-0 border-t border-solid border-neutral-100 px-3 py-2 first:border-t-0">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium text-neutral-900">{b.propertyTitle}</span>
                <span className={`block truncate text-[11px] font-semibold ${tone}`}>{text}</span>
              </span>
              <strong className="shrink-0 text-[12.5px] tabular-nums text-neutral-900">{tsh(b.deposit)}</strong>
              <EyeButton onClick={() => onOpen(b.reference)} label={`Open ${b.propertyTitle}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What every shilling a client paid is for. */
function MoneySplit({ rows }: { rows: Booking[] }) {
  const paid = rows.filter(b => b.paidAt);
  const total = paid.reduce((n, b) => n + b.total, 0);
  const owner = paid.reduce((n, b) => n + (b.ownerDue ?? 0), 0);
  const fee = paid.reduce((n, b) => n + (b.fee ?? 0), 0);
  const deposit = paid.reduce((n, b) => n + b.deposit, 0);
  const other = Math.max(0, total - owner - fee - deposit);
  const parts = [
    { k: "Owner earnings", v: owner, c: "bg-[#02665e]" },
    { k: "NoLSAF fees", v: fee, c: "bg-sky-400" },
    { k: "Refundable deposits", v: deposit, c: "bg-amber-400" },
    { k: "Cleaning and other", v: other, c: "bg-neutral-300" },
  ];
  return (
    <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-2">
        <p className="m-0 text-[13px] font-semibold text-neutral-900">Where client money goes</p>
        <span className="text-[11.5px] font-semibold tabular-nums text-neutral-500">{paid.length ? `${tsh(total)} from ${paid.length} paid` : ""}</span>
      </div>
      {total === 0 ? (
        <p className="m-0 px-3 py-3 text-[12px] text-neutral-500">Once clients pay, this shows how each payment splits into owner earnings, NoLSAF fees and deposits.</p>
      ) : (
        <div className="px-3 py-2.5">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
            {parts.map(p => <span key={p.k} className={p.c} style={{ width: `${(p.v / total) * 100}%` }} />)}
          </div>
          <ul className="m-0 mt-2 grid list-none grid-cols-2 gap-x-4 gap-y-1.5 p-0">
            {parts.map(p => (
              <li key={p.k} className="flex min-w-0 items-center gap-2 text-[12px]">
                <span className={`h-2 w-2 shrink-0 rounded-sm ${p.c}`} aria-hidden />
                <span className="min-w-0 flex-1 truncate text-neutral-700">{p.k}</span>
                <span className="shrink-0 tabular-nums text-neutral-400">{Math.round((p.v / total) * 100)}%</span>
                <strong className="shrink-0 tabular-nums text-neutral-900">{tsh(p.v)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** The booking record, beside the list, with every admin decision the existing flow supports. */
export function BookingDrawer({ reference, onClose }: { reference: string; onClose: () => void }) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const open = useCallback(async () => {
    try { const r = await apiClient.get(`${BASE}/bookings/${encodeURIComponent(reference)}`); setBooking(r.data); setError(""); }
    catch (e) { setError(errorText(e, "Could not open this booking.")); }
  }, [reference]);
  useEffect(() => { void open(); }, [open]);

  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    if (!booking) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await apiClient.post(`${BASE}/bookings/${booking.reference}/act`, { version: booking.version, action, ...payload });
      setNotice("Booking updated. Money moves only after finance release and provider confirmation.");
      await open();
      refreshEventHire();
    } catch (e) {
      setError(errorText(e));
      if (needsFinanceGrant(e)) askFinanceGrant();
    } finally { setBusy(false); }
  };

  const flags = booking ? bookingFlags(booking) : [];
  return (
    <Drawer open onClose={onClose} busy={busy} kicker="Event booking" title={booking?.propertyTitle || "Booking"}
      status={booking && <><Pill status={booking.status}>{label(booking.status)}</Pill>{flags.map(f => <Pill key={f} kind="amber">{f}</Pill>)}<span className="text-[12px] text-white/60">{span(booking.startsAt, booking.endsAt)}</span></>}>
      {!booking ? (error ? <ErrorNote>{error}</ErrorNote> : <Loading />) : (
        <div className={ws.workspace}>
          {notice && <p role="status" className="m-0 mb-3 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">{notice}</p>}
          {error && <div className="mb-3"><ErrorNote>{error}</ErrorNote></div>}
          <BookingDetails key={booking.reference} booking={booking} audience="admin" base={BASE} busy={busy} onAction={act} onReload={open} />
        </div>
      )}
    </Drawer>
  );
}

/**
 * Booking status tabs with live counts, plus how many bookings need a reviewer.
 * Each tab filters the table.
 */
function BookingLifecycle({ view, onView, count }: { view: BookingView; onView: (v: BookingView) => void; count: (k: string) => number | null }) {
  const [attention, setAttention] = useState<number | null>(null);
  const load = useCallback(async () => {
    try {
      const all = await Promise.all(["CONFIRMED", "COMPLETED", "PAYMENT_REVIEW"].map(status => apiClient.get(`${BASE}/bookings`, { params: { status } })));
      setAttention(all.flatMap(r => r.data.bookings as Booking[]).filter(b => bookingFlags(b).length).length);
    } catch { setAttention(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useWorkspaceRefresh(useCallback(() => { void load(); }, [load]));

  // One clean row of tabs, each sized to its own label so nothing is cut off.
  const tabs: Array<{ v: BookingView; label: string; n: number | null; warm?: boolean; hint: string }> = [
    { v: "attention", label: "Need review", n: attention, warm: true, hint: "Claims, cancellations, events to close, payouts to approve" },
    { v: "all", label: "All", n: (["PAYMENT_PENDING", "PAYMENT_REVIEW", "CONFIRMED", "COMPLETED", "CANCELLED", "EXPIRED"] as const).reduce((t, k) => t + (count(k) ?? 0), 0), hint: "Every booking" },
    { v: "PAYMENT_PENDING", label: "Paying", n: count("PAYMENT_PENDING"), hint: "Client is in checkout now" },
    { v: "PAYMENT_REVIEW", label: "Payment review", n: count("PAYMENT_REVIEW"), warm: true, hint: "The provider has not confirmed the payment" },
    { v: "CONFIRMED", label: "Confirmed", n: count("CONFIRMED"), hint: "Paid, event ahead or running" },
    { v: "COMPLETED", label: "Completed", n: count("COMPLETED"), hint: "Event done, money settling" },
    { v: "CANCELLED", label: "Cancelled", n: count("CANCELLED"), hint: "Cancelled bookings" },
    { v: "EXPIRED", label: "Expired", n: count("EXPIRED"), hint: "Checkout ran out, never paid" },
  ];
  return (
    <nav aria-label="Booking status" className="flex min-w-0 overflow-x-auto rounded-lg border border-solid border-neutral-200 bg-white [scrollbar-width:thin]">
      {tabs.map((t, i) => {
        const on = view === t.v;
        return (
          <button key={t.v} type="button" onClick={() => onView(t.v)} aria-current={on ? "true" : undefined} title={t.hint}
            className={`flex h-9 shrink-0 flex-1 items-center justify-center gap-2 whitespace-nowrap border-0 px-4 text-[12.5px] font-semibold transition-colors ${i ? "border-l border-solid border-neutral-200" : ""} ${on ? "bg-[#0b2420] text-white" : "bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"}`}>
            {t.warm && t.n ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden /> : null}
            {t.label}
            <span className={`rounded px-1.5 text-[11px] tabular-nums leading-5 ${on ? "bg-white/15 text-white" : t.warm && t.n ? "bg-amber-100 text-amber-900" : t.n ? "bg-neutral-100 text-neutral-800" : "text-neutral-400"}`}>{t.n ?? "..."}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** The coming week at a glance: paid events and checkout holds per day. */
function NextSevenDays({ onOpen }: { onOpen: (ref: string) => void }) {
  type Entry = { reference: string; title: string; startsAt: string; endsAt: string; kind: "BOOKING" | "BLOCK" | "HOLD" };
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(Date.now() + i * 86400000).toLocaleDateString("en-CA", { timeZone: TZ })), []);
  const load = useCallback(async () => {
    try {
      const r = await apiClient.get(`${BASE}/calendar`, { params: { from: `${days[0]}T00:00:00+03:00`, to: `${days[6]}T23:59:59+03:00` } });
      setEntries((r.data.events as Entry[]).filter(e => e.kind !== "BLOCK"));
    } catch { setEntries([]); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  useWorkspaceRefresh(useCallback(() => { void load(); }, [load]));
  const keyOf = (v: string) => new Date(v).toLocaleDateString("en-CA", { timeZone: TZ });
  const on = (d: string) => (entries ?? []).filter(e => keyOf(e.startsAt) <= d && d <= keyOf(new Date(new Date(e.endsAt).getTime() - 1).toISOString()));
  const week = (entries ?? []).filter(e => e.kind === "BOOKING").length;
  return (
    <section className="min-w-0 rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-3 py-1.5">
        <p className="m-0 text-[12.5px] font-semibold text-neutral-900">Next 7 days <span className="font-normal text-neutral-400">· {entries === null ? "..." : week ? `${week} paid ${week === 1 ? "event" : "events"}` : "no paid events"}</span></p>
        <Link href="/admin/event-hire/availability" className="text-[11.5px] font-semibold text-[#02665e] no-underline hover:underline">Calendar</Link>
      </div>
      <div className="grid grid-cols-7">
        {days.map((d, i) => {
          const list = on(d);
          const date = new Date(`${d}T12:00:00+03:00`);
          return (
            <div key={d} className={`min-w-0 px-2 py-1.5 ${i ? "border-0 border-l border-solid border-neutral-100" : ""} ${i === 0 ? "bg-[#02665e]/[0.04]" : ""}`}>
              <p className={`m-0 text-[10.5px] font-semibold ${i === 0 ? "text-[#02665e]" : "text-neutral-500"}`}>{i === 0 ? "Today" : date.toLocaleDateString("en-GB", { weekday: "short", timeZone: TZ })} <span className="font-normal tabular-nums text-neutral-400">{date.toLocaleDateString("en-GB", { day: "numeric", timeZone: TZ })}</span></p>
              <div className="mt-1 flex min-h-[1.25rem] flex-col gap-0.5">
                {list.slice(0, 2).map(e => (
                  <button key={`${e.kind}${e.reference}`} type="button" disabled={e.kind !== "BOOKING"} onClick={() => onOpen(e.reference)} title={e.title}
                    className={`truncate rounded border-0 px-1 py-px text-left text-[10px] font-medium leading-4 ${e.kind === "BOOKING" ? "bg-[#02665e] text-white hover:bg-[#014f49]" : "cursor-default bg-amber-100 text-amber-900"}`}>{e.title}</button>
                ))}
                {list.length > 2 && <span className="text-[10px] font-semibold text-neutral-500">+{list.length - 2} more</span>}
                {list.length === 0 && entries !== null && <span className="text-[10px] text-neutral-300">Free</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

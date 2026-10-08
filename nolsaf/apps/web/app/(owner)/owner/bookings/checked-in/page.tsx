"use client";
import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  ArrowRight, BedDouble, CalendarClock, ChevronLeft, ChevronRight, DoorOpen, LogOut, Phone, ScanLine, UserCheck, Users, X,
} from "lucide-react";
import Link from "next/link";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;
const TZ = "Africa/Dar_es_Salaam";
const DAY = 86_400_000;
const PAGE_SIZES = [6, 12, 24] as const;

type CheckedInBooking = {
  id: number;
  bookingReference: string;
  status: string;
  guestName?: string | null;
  customerName?: string | null;
  guestPhone?: string | null;
  phone?: string | null;
  roomType?: string | null;
  roomCode?: string | null;
  totalAmount?: number | null;
  transportFare?: number | string | null;
  ownerBaseAmount?: number | string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  validatedAt?: string | null;
  code?: { usedAt?: string | null };
  property?: { id: number; title: string };
};

const dayKey = (d: string | number | Date) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });
const fmtDay = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short" }) : "");
const fmtTime = (d?: string | null) =>
  d ? `${new Date(d).toLocaleString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })} EAT` : "";
const fmtTzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
const toNum = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const amountFor = (b: CheckedInBooking) =>
  b.ownerBaseAmount != null ? toNum(b.ownerBaseAmount) : Math.max(0, toNum(b.totalAmount) - toNum(b.transportFare));
const nightsFor = (b: CheckedInBooking) => {
  const inT = new Date(String(b.checkIn ?? "")).getTime();
  const outT = new Date(String(b.checkOut ?? "")).getTime();
  if (!Number.isFinite(inT) || !Number.isFinite(outT)) return null;
  return Math.max(1, Math.round((outT - inT) / DAY));
};

function pageList(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const sorted = [...new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total))].sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push(0); out.push(p); });
  return out;
}

export default function CheckedIn() {
  const [list, setList] = useState<CheckedInBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [now] = useState(() => Date.now());
  const [view, setView] = useState<"all" | "today" | "tomorrow" | "overdue">("all");
  const [sortKey, setSortKey] = useState<string>("checkOut_asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);

  // One-time success banner after a check-in: the validate page sends ?checkedIn=<bk_ reference>.
  const [justCheckedIn, setJustCheckedIn] = useState<string | null>(null);
  const [payoutFlowOn, setPayoutFlowOn] = useState<boolean | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("checkedIn");
    if (!ref) return;
    setJustCheckedIn(ref);
    // Drop it from the address bar so a refresh does not show the banner again.
    params.delete("checkedIn");
    const q = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    api.get<{ enabled?: boolean }>("/api/owner/payouts/releases")
      .then((r) => setPayoutFlowOn(Boolean(r.data?.enabled)))
      .catch(() => setPayoutFlowOn(false));
    const t = window.setTimeout(() => setJustCheckedIn(null), 15000);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    let mounted = true;
    api.get<any>("/api/owner/bookings/checked-in?source=checked-in-page")
      .then((r) => {
        if (!mounted) return;
        const d = r.data;
        setList(Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : Array.isArray(d?.items) ? d.items : []);
      })
      .catch((err: any) => {
        if (!mounted) return;
        console.warn("Failed to load checked-in bookings", err);
        setList([]);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const keys = useMemo(() => ({ today: dayKey(now), tomorrow: dayKey(now + DAY) }), [now]);
  const leaveKind = (b: CheckedInBooking) => {
    if (!b.checkOut) return "later";
    const k = dayKey(b.checkOut);
    if (k === keys.today) return "today";
    if (k === keys.tomorrow) return "tomorrow";
    return new Date(b.checkOut).getTime() < now ? "overdue" : "later";
  };

  const counts = useMemo(() => ({
    all: list.length,
    today: list.filter((b) => leaveKind(b) === "today").length,
    tomorrow: list.filter((b) => leaveKind(b) === "tomorrow").length,
    overdue: list.filter((b) => leaveKind(b) === "overdue").length,
    value: list.reduce((t, b) => t + amountFor(b), 0),
    properties: new Set(list.map((b) => b.property?.id ?? b.property?.title)).size,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [list, keys]);

  const filtered = useMemo(() => {
    const arr = list.filter((b) => view === "all" || leaveKind(b) === view);
    const [key, dir] = sortKey.split("_");
    const mul = dir === "asc" ? 1 : -1;
    const t = (v: any) => { const x = new Date(String(v ?? "")).getTime(); return Number.isFinite(x) ? x : 0; };
    return arr.sort((A, B) => {
      if (key === "name") return mul * String(A.guestName ?? A.customerName ?? "").localeCompare(String(B.guestName ?? B.customerName ?? ""));
      if (key === "amount") return mul * (amountFor(A) - amountFor(B));
      if (key === "checkIn") return mul * (t(A.checkIn) - t(B.checkIn));
      return mul * (t(A.checkOut) - t(B.checkOut));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, view, sortKey, keys]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const shell = "w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6";
  const styles = `
    #owner-inhouse, #owner-inhouse * { box-sizing: border-box; }
    @keyframes ih-shimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
    #owner-inhouse .ih-sk { background: linear-gradient(90deg, #eef2f1 0%, #f8faf9 40%, #eef2f1 80%); background-size: 800px 100%; animation: ih-shimmer 1.3s linear infinite; }
    @keyframes ih-in { from { opacity: 0; transform: translateY(-6px) } to { opacity: 1; transform: none } }
    #owner-inhouse .ih-banner { animation: ih-in .35s cubic-bezier(.2,.7,.2,1) both; }
    #owner-inhouse .ih-sk-dark { background: linear-gradient(90deg, rgba(255,255,255,.06) 0%, rgba(255,255,255,.14) 40%, rgba(255,255,255,.06) 80%); background-size: 800px 100%; animation: ih-shimmer 1.3s linear infinite; }
  `;

  if (loading) {
    return (
      <div id="owner-inhouse" className={shell} aria-busy="true" aria-label="Loading checked-in guests">
        <style>{styles}</style>
        <div className="rounded-3xl bg-[#012a26] px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="space-y-2.5">
            <div className="ih-sk-dark h-3 w-28 rounded-full" />
            <div className="ih-sk-dark h-8 w-48 rounded-lg" />
            <div className="ih-sk-dark h-3.5 w-64 rounded-full" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="ih-sk-dark h-[76px] rounded-2xl" />)}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="ih-sk h-[220px] rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const stats: { key: typeof view; label: string; value: number; Icon: typeof Users; warn?: boolean }[] = [
    { key: "all", label: "In house", value: counts.all, Icon: Users },
    { key: "today", label: "Leaving today", value: counts.today, Icon: LogOut },
    { key: "tomorrow", label: "Leaving tomorrow", value: counts.tomorrow, Icon: CalendarClock },
    { key: "overdue", label: "Past check-out", value: counts.overdue, Icon: DoorOpen, warn: true },
  ];

  const arrived = justCheckedIn ? list.find((b) => b.bookingReference === justCheckedIn) ?? null : null;

  return (
    <div id="owner-inhouse" className={shell}>
      <style>{styles}</style>

      {/* ── Just checked in: confirm it worked and say what happens next ── */}
      {justCheckedIn && (
        <div
          role="status"
          className="ih-banner flex items-start gap-3.5 rounded-2xl border border-solid border-emerald-200 bg-white p-4 shadow-[0_12px_32px_-24px_rgba(1,42,38,0.5)] sm:items-center sm:p-5"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <UserCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-bold text-slate-900">
              {arrived ? `${arrived.guestName ?? arrived.customerName ?? "Your guest"} is checked in` : "Guest checked in"}
              {arrived && (arrived.validatedAt ?? arrived.code?.usedAt) ? (
                <span className="font-normal text-slate-500"> · {fmtTime(arrived.validatedAt ?? arrived.code?.usedAt)}</span>
              ) : null}
            </p>
            <p className="m-0 mt-0.5 text-xs text-slate-600">
              {payoutFlowOn === false
                ? "Next, create the invoice for this stay to claim your payout."
                : "The payout for this stay is now in progress."}
            </p>
          </div>
          {payoutFlowOn !== null && (
            <Link
              href={payoutFlowOn ? "/owner/payouts/in-progress" : `/owner/invoices/new?booking=${encodeURIComponent(justCheckedIn)}`}
              className="hidden shrink-0 items-center gap-1.5 rounded-xl bg-[#012a26] px-3.5 py-2 text-xs font-bold text-white no-underline transition hover:bg-[#02665e] sm:inline-flex"
            >
              {payoutFlowOn ? "See it in My Payouts" : "Create the invoice"} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          )}
          <button
            type="button"
            onClick={() => setJustCheckedIn(null)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      {justCheckedIn && payoutFlowOn !== null && (
        <Link
          href={payoutFlowOn ? "/owner/payouts/in-progress" : `/owner/invoices/new?booking=${encodeURIComponent(justCheckedIn)}`}
          className="-mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline sm:hidden"
        >
          {payoutFlowOn ? "See it in My Payouts" : "Create the invoice"} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}

      {/* ── Header band ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)", WebkitMaskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#5eead4] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#5eead4]" />
                </span>
                Live now
              </p>
              <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">Guests in house</h1>
              <p className="m-0 mt-1.5 text-sm text-white/60">
                {counts.all > 0
                  ? `${counts.all} ${counts.all === 1 ? "guest" : "guests"} staying across ${counts.properties} ${counts.properties === 1 ? "property" : "properties"}, worth ${fmtTzs(counts.value)} to you.`
                  : "Everyone who has been checked in and has not left yet."}
              </p>
            </div>
            <Link
              href="/owner/bookings/validate"
              className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl bg-[#5eead4] px-3.5 py-2 text-sm font-bold text-[#012a26] no-underline transition hover:bg-[#8ff3e1] sm:self-auto"
            >
              <ScanLine className="h-4 w-4" aria-hidden /> Check in a guest
            </Link>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            {stats.map((s) => {
              const on = view === s.key;
              const alert = s.warn && s.value > 0;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => { setView(s.key); setPage(1); }}
                  aria-pressed={on}
                  className={`min-w-0 rounded-2xl border border-solid px-4 py-3 text-left text-white transition ${
                    on ? "border-[#5eead4] bg-[#5eead4]/10" : alert ? "border-amber-300/40 bg-amber-300/[0.07] hover:bg-amber-300/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"
                  }`}
                >
                  <span className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${alert ? "text-amber-200" : "text-white/50"}`}>
                    <s.Icon className={`h-3.5 w-3.5 ${alert ? "text-amber-300" : "text-[#5eead4]"}`} aria-hidden />
                    <span className="truncate">{s.label}</span>
                  </span>
                  <span className={`mt-1 block text-2xl font-bold tabular-nums ${s.value > 0 ? "text-white" : "text-white/35"}`}>{s.value}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {list.length === 0 ? (
        /* ── Empty: point to what the owner can do next ── */
        <section className="grid overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-24px_rgba(15,23,42,0.35)] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="p-7">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <BedDouble className="h-6 w-6" aria-hidden />
            </span>
            <p className="m-0 mt-4 text-lg font-bold text-slate-900">No one is in house right now</p>
            <p className="m-0 mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">
              A guest appears here the moment you validate their booking code, and stays until they check out.
            </p>
          </div>
          <div className="flex flex-col justify-center gap-2.5 border-0 border-t border-solid border-slate-200 bg-slate-50 p-7 md:border-l md:border-t-0">
            <Link
              href="/owner/bookings/validate"
              className="group inline-flex h-12 items-center justify-between gap-2 rounded-xl bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white no-underline transition hover:bg-[#02665e]"
            >
              Check in an arriving guest
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5eead4] text-[#012a26]">
                <ScanLine className="h-4 w-4" aria-hidden />
              </span>
            </Link>
            <Link
              href="/owner/bookings?tab=waiting"
              className="inline-flex h-12 items-center justify-between gap-2 rounded-xl border border-solid border-slate-300 bg-white px-5 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-100"
            >
              See who is arriving
              <ArrowRight className="h-4 w-4 text-slate-400" aria-hidden />
            </Link>
          </div>
        </section>
      ) : (
        <>
          {/* ── Toolbar ── */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-slate-600">
              <span className="font-bold text-slate-900">{filtered.length}</span> {filtered.length === 1 ? "guest" : "guests"}
              {view !== "all" ? <span className="text-slate-500"> · {stats.find((s) => s.key === view)?.label.toLowerCase()}</span> : null}
            </p>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
              Sort
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                className="h-9 rounded-lg border border-solid border-slate-300 bg-white px-2.5 text-sm font-medium text-slate-700 outline-none focus:border-[#02665e]"
                aria-label="Sort guests in house"
              >
                <option value="checkOut_asc">Leaving soonest</option>
                <option value="checkIn_desc">Arrived most recently</option>
                <option value="amount_desc">Highest amount</option>
                <option value="name_asc">Name, A to Z</option>
              </select>
            </label>
          </div>

          {filtered.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
              No guests in this view.{" "}
              <button type="button" onClick={() => setView("all")} className="border-0 bg-transparent p-0 font-semibold text-[#02665e] underline">
                Show everyone in house
              </button>
            </div>
          ) : (
            <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {rows.map((b) => <GuestCard key={b.id} b={b} now={now} kind={leaveKind(b)} />)}
            </ul>
          )}

          {/* ── Pagination ── */}
          {filtered.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-solid border-slate-300/80 bg-white px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-center gap-3">
                <span>
                  Showing <span className="font-semibold tabular-nums text-slate-900">{(safePage - 1) * pageSize + 1}</span> to{" "}
                  <span className="font-semibold tabular-nums text-slate-900">{Math.min(safePage * pageSize, filtered.length)}</span> of{" "}
                  <span className="font-semibold tabular-nums text-slate-900">{filtered.length}</span>
                </span>
                <span className="hidden h-4 w-px bg-slate-300 sm:block" aria-hidden />
                <span className="hidden items-center gap-1 sm:inline-flex" role="group" aria-label="Guests per page">
                  Per page
                  {PAGE_SIZES.map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => { setPageSize(size); setPage(1); }}
                      aria-pressed={pageSize === size}
                      className={`h-7 min-w-[2rem] rounded-md border border-solid px-1.5 text-[11px] font-semibold tabular-nums transition ${
                        pageSize === size ? "border-[#012a26] bg-[#012a26] text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </span>
              </div>
              <nav className="flex items-center gap-1" aria-label="Pages">
                <button
                  type="button"
                  disabled={safePage === 1}
                  onClick={() => setPage(safePage - 1)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-solid border-slate-300 bg-white px-2.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Previous</span>
                </button>
                {pageList(safePage, totalPages).map((p, i) =>
                  p === 0 ? (
                    <span key={`gap-${i}`} className="px-1 text-slate-400" aria-hidden>...</span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPage(p)}
                      aria-current={p === safePage ? "page" : undefined}
                      className={`h-8 min-w-[2rem] rounded-lg border border-solid px-2 font-semibold tabular-nums transition ${
                        p === safePage ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {p}
                    </button>
                  ),
                )}
                <button
                  type="button"
                  disabled={safePage === totalPages}
                  onClick={() => setPage(safePage + 1)}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-solid border-slate-300 bg-white px-2.5 font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Next page"
                >
                  <span className="hidden sm:inline">Next</span> <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
              </nav>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** One in-house guest: who, where, how far into the stay, and when they leave. */
function GuestCard({ b, now, kind }: { b: CheckedInBooking; now: number; kind: string }) {
  const name = b.guestName ?? b.customerName ?? "Guest";
  const initials = name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "G";
  const phone = b.guestPhone ?? b.phone;
  const nights = nightsFor(b) ?? 1;
  const start = new Date(String(b.checkIn ?? "")).getTime();
  const end = new Date(String(b.checkOut ?? "")).getTime();
  const pos = end > start ? Math.max(0, Math.min(1, (now - start) / (end - start))) : 0;
  const night = Math.min(nights, Math.max(1, Math.ceil(pos * nights)));
  const validatedAt = b.validatedAt ?? b.code?.usedAt ?? null;
  const leave =
    kind === "today" ? { text: "Leaves today", cls: "bg-[#02665e] text-white" }
      : kind === "tomorrow" ? { text: "Leaves tomorrow", cls: "bg-[#02665e]/10 text-[#02665e]" }
        : kind === "overdue" ? { text: "Past check-out", cls: "bg-amber-100 text-amber-900" }
          : { text: `Leaves in ${Math.max(1, Math.ceil((end - now) / DAY))} days`, cls: "bg-slate-100 text-slate-600" };

  return (
    <li>
      <Link
        href={`/owner/bookings/checked-in/${encodeURIComponent(b.bookingReference)}`}
        className="group flex h-full flex-col rounded-2xl border border-solid border-slate-300/80 bg-white p-5 no-underline shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-26px_rgba(15,23,42,0.4)] transition hover:-translate-y-0.5 hover:border-[#02665e]/40 hover:shadow-[0_18px_40px_-24px_rgba(1,42,38,0.45)]"
      >
        <div className="flex items-start gap-3">
          <span className="relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#02665e] to-[#012a26] text-base font-bold text-white">
            {initials}
            <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-solid border-white bg-[#5eead4]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-base font-bold text-slate-900">{name}</p>
            <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
              <BedDouble className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              {b.property?.title ?? "Your property"}
              {b.roomType ? ` · ${b.roomType}` : ""}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${leave.cls}`}>{leave.text}</span>
        </div>

        <div className="mt-4">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold text-slate-800">Night {night} of {nights}</span>
            <span className="text-slate-500">{fmtDay(b.checkIn)} to {fmtDay(b.checkOut)}</span>
          </div>
          <div className="mt-2 flex gap-0.5" aria-hidden>
            {Array.from({ length: Math.min(nights, 14) }, (_, i) => {
              const filled = nights <= 14 ? i < night : i < Math.round((night / nights) * 14);
              return <span key={i} className={`h-2 flex-1 rounded-sm ${filled ? "bg-[#02665e]" : "bg-slate-200"}`} />;
            })}
          </div>
        </div>

        <div className="mt-4 flex flex-1 items-end justify-between gap-3 border-0 border-t border-dashed border-slate-200 pt-3">
          <div className="min-w-0 space-y-0.5 text-[11px] text-slate-500">
            {phone ? (
              <p className="m-0 flex items-center gap-1.5"><Phone className="h-3 w-3 text-slate-400" aria-hidden />{phone}</p>
            ) : null}
            {validatedAt ? <p className="m-0">Checked in {fmtTime(validatedAt)}</p> : null}
          </div>
          <div className="shrink-0 text-right">
            <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Your amount</p>
            <p className="m-0 text-base font-bold tabular-nums text-slate-900">{fmtTzs(amountFor(b))}</p>
          </div>
        </div>
      </Link>
    </li>
  );
}

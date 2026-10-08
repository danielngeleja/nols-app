"use client";

import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { ArrowRight, Building2, ChevronLeft, ChevronRight, DoorOpen, History, Loader2, RotateCw, Search, Star, X } from "lucide-react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;
const TZ = "Africa/Dar_es_Salaam";
const DAY = 86_400_000;
const PAGE_SIZES = [6, 12, 24] as const;

type CheckedOutItem = {
  id: number;
  bookingReference?: string;
  property?: { id: number; title: string };
  validatedAt?: string | null;
  guestName?: string | null;
  guestPhone?: string | null;
  guestEmail?: string | null;
  roomType?: string | null;
  roomCode?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  checkoutConfirmedAt?: string | null;
  overdueHours?: number | null;
  overdueDays?: number | null;
  checkoutTiming?: "OVERDUE" | "NORMAL" | "UNKNOWN" | string | null;
  status?: string | null;
  totalAmount?: number | null;
  transportFare?: number | string | null;
  ownerBaseAmount?: number | string | null;
  createdAt?: string | null;
};

type AuditItem = {
  confirmedAt: string;
  note: string | null;
  rating: number | null;
  feedback: string | null;
  actorName?: string | null;
  actorRole?: string | null;
};

const fmtDay = (v?: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit", month: "short" }) : "");
const fmtEat = (v?: string | null) => {
  const d = new Date(String(v ?? ""));
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.toLocaleString("en-GB", { timeZone: TZ, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} EAT`;
};
const monthLabel = (v?: string | null) =>
  v ? new Date(v).toLocaleDateString("en-GB", { timeZone: TZ, month: "long", year: "numeric" }) : "No date";
const fmtTzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
const amountOf = (b: CheckedOutItem) =>
  b.ownerBaseAmount != null ? Number(b.ownerBaseAmount) || 0 : Math.max(0, Number(b.totalAmount ?? 0) - Number(b.transportFare ?? 0));

/** How late the check-out was confirmed, in words an owner reads at a glance. */
function timing(b: CheckedOutItem): { text: string; cls: string; title: string } {
  const kind = String(b.checkoutTiming ?? "UNKNOWN").toUpperCase();
  const confirmed = b.checkoutConfirmedAt ? `Confirmed ${fmtEat(b.checkoutConfirmedAt)}` : "";
  if (kind === "NORMAL") return { text: "On time", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", title: confirmed };
  if (kind === "OVERDUE") {
    const hours = Number(b.overdueHours ?? 0);
    const days = Number(b.overdueDays ?? Math.floor(hours / 24));
    const text = days >= 1 ? `Confirmed ${days} ${days === 1 ? "day" : "days"} late` : `Confirmed ${Math.max(1, Math.round(hours))}h late`;
    return { text, cls: "bg-amber-50 text-amber-900 ring-amber-200", title: confirmed };
  }
  return { text: "No confirmation time", cls: "bg-slate-100 text-slate-600 ring-slate-200", title: "This record has no confirmation timestamp" };
}

function pageList(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const sorted = [...new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total))].sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push(0); out.push(p); });
  return out;
}

export default function OwnerCheckedOutPage() {
  const [list, setList] = useState<CheckedOutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [range, setRange] = useState<"all" | "7" | "30">("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [now] = useState(() => Date.now());

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<CheckedOutItem | null>(null);
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const r = await api.get<unknown>("/api/owner/bookings/checked-out");
      const raw: any = (r as any).data;
      setList(Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.items) ? raw.items : []);
    } catch (e: any) {
      if (!silent) setList([]);
      setError(e?.response?.data?.error ?? e?.message ?? "Failed to load checked-out history");
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openAudit(b: CheckedOutItem) {
    setAuditOpen(true);
    setAuditTarget(b);
    setAuditLoading(true);
    setAuditItems([]);
    try {
      const r = await api.get(`/api/owner/bookings/${b.id}/audit`);
      setAuditItems(Array.isArray((r as any).data?.items) ? (r as any).data.items : []);
    } catch (e: any) {
      setAuditItems([]);
      setError(e?.response?.data?.error ?? e?.message ?? "Failed to load audit history");
    } finally {
      setAuditLoading(false);
    }
  }

  const ageDays = (b: CheckedOutItem) => {
    const t = new Date(String(b.checkOut ?? "")).getTime();
    return Number.isFinite(t) ? (now - t) / DAY : Infinity;
  };

  const stats = useMemo(() => ({
    total: list.length,
    last7d: list.filter((b) => ageDays(b) <= 7).length,
    last30d: list.filter((b) => ageDays(b) <= 30).length,
    value: list.reduce((t, b) => t + amountOf(b), 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [list, now]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list
      .filter((b) => range === "all" || ageDays(b) <= Number(range))
      .filter((b) => {
        if (!q) return true;
        return [b.guestName, b.guestPhone, b.guestEmail, b.bookingReference, b.property?.title, b.roomType ?? b.roomCode]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => new Date(String(b.checkOut ?? 0)).getTime() - new Date(String(a.checkOut ?? 0)).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, search, range, now]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const rows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const shell = "w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6";
  const styles = `
    #owner-history, #owner-history * { box-sizing: border-box; }
    @keyframes oh-shimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
    #owner-history .oh-sk { background: linear-gradient(90deg, #eef2f1 0%, #f8faf9 40%, #eef2f1 80%); background-size: 800px 100%; animation: oh-shimmer 1.3s linear infinite; }
    #owner-history .oh-sk-dark { background: linear-gradient(90deg, rgba(255,255,255,.06) 0%, rgba(255,255,255,.14) 40%, rgba(255,255,255,.06) 80%); background-size: 800px 100%; animation: oh-shimmer 1.3s linear infinite; }
  `;

  if (loading) {
    return (
      <div id="owner-history" className={shell} aria-busy="true" aria-label="Loading check-out history">
        <style>{styles}</style>
        <div className="rounded-3xl bg-[#012a26] px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <div className="space-y-2.5">
            <div className="oh-sk-dark h-3 w-24 rounded-full" />
            <div className="oh-sk-dark h-8 w-56 rounded-lg" />
            <div className="oh-sk-dark h-3.5 w-72 rounded-full" />
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => <div key={i} className="oh-sk-dark h-[76px] rounded-2xl" />)}
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 border-0 border-b border-solid border-slate-200 px-5 py-4 last:border-b-0">
              <div className="oh-sk h-12 w-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="oh-sk h-3.5 w-48 max-w-full rounded-full" />
                <div className="oh-sk h-3 w-32 rounded-full" />
              </div>
              <div className="oh-sk h-4 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const ranges: { key: typeof range; label: string; value: number }[] = [
    { key: "all", label: "All time", value: stats.total },
    { key: "7", label: "Last 7 days", value: stats.last7d },
    { key: "30", label: "Last 30 days", value: stats.last30d },
  ];

  return (
    <div id="owner-history" className={shell}>
      <style>{styles}</style>

      {/* Audit dialog */}
      {auditOpen && auditTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
            <div className="flex items-start justify-between gap-3 bg-[#012a26] px-5 py-4 text-white">
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9fd8cc]">Stay record</p>
                <p className="m-0 mt-0.5 truncate text-base font-bold">{auditTarget.guestName ?? "Guest"}</p>
                <p className="m-0 truncate text-xs text-white/60">{auditTarget.property?.title ?? ""}</p>
              </div>
              <button
                type="button"
                onClick={() => { setAuditOpen(false); setAuditTarget(null); setAuditItems([]); }}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-white/10 text-white hover:bg-white/20"
                aria-label="Close"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              {auditLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin text-[#02665e]" aria-hidden /> Loading the record...
                </div>
              ) : auditItems.length === 0 ? (
                <div className="py-10 text-center">
                  <History className="mx-auto h-9 w-9 text-slate-300" aria-hidden />
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-800">No records yet</p>
                  <p className="m-0 mt-1 text-xs text-slate-500">This stay may predate the activity log.</p>
                </div>
              ) : (
                <ol className="m-0 list-none space-y-0 p-0">
                  {auditItems.map((it, idx) => {
                    const note = String(it.note ?? "").toLowerCase();
                    const label = note === "checkout" ? "Checked out" : note === "checkin" ? "Checked in" : it.note ?? "Event";
                    return (
                      <li key={idx} className="relative pb-5 pl-6 last:pb-0">
                        <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-[#02665e]" aria-hidden />
                        {idx < auditItems.length - 1 ? <span className="absolute bottom-0 left-[4.5px] top-4 w-px bg-slate-200" aria-hidden /> : null}
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="m-0 text-sm font-semibold text-slate-900">{label}</p>
                          <p className="m-0 text-[11px] text-slate-500">{fmtEat(it.confirmedAt)}</p>
                        </div>
                        <p className="m-0 mt-0.5 text-xs text-slate-500">{it.actorName ? `By ${it.actorName}` : ""}</p>
                        {typeof it.rating === "number" ? (
                          <p className="m-0 mt-1.5 flex items-center gap-0.5" aria-label={`Rated ${it.rating} out of 5`}>
                            {[1, 2, 3, 4, 5].map((v) => (
                              <Star key={v} className={`h-3.5 w-3.5 ${v <= (it.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-slate-300"}`} aria-hidden />
                            ))}
                          </p>
                        ) : null}
                        {it.feedback ? <p className="m-0 mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">{it.feedback}</p> : null}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Front desk</p>
              <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">Check-out history</h1>
              <p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">
                {stats.total > 0
                  ? `${stats.total} finished ${stats.total === 1 ? "stay" : "stays"}, worth ${fmtTzs(stats.value)} to you. Open a record to see the rating and notes.`
                  : "Every stay you have checked out, with its rating and notes."}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => load({ silent: true })}
                disabled={refreshing}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-white/15 bg-white/[0.06] px-3.5 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
              >
                <RotateCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} aria-hidden /> Refresh
              </button>
              <Link
                href="/owner/bookings/check-out"
                className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#5eead4] px-3.5 text-sm font-bold text-[#012a26] no-underline transition hover:bg-[#8ff3e1]"
              >
                <DoorOpen className="h-4 w-4" aria-hidden /> Departures
              </Link>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-2.5 sm:gap-3">
            {ranges.map((r) => {
              const on = range === r.key;
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => { setRange(r.key); setPage(1); }}
                  aria-pressed={on}
                  className={`min-w-0 rounded-2xl border border-solid px-4 py-3 text-left text-white transition ${on ? "border-[#5eead4] bg-[#5eead4]/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.07]"}`}
                >
                  <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">{r.label}</span>
                  <span className={`mt-1 block text-2xl font-bold tabular-nums ${r.value > 0 ? "text-white" : "text-white/35"}`}>{r.value}</span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {error ? <div className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      {/* ── List ── */}
      <section className={`overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-24px_rgba(15,23,42,0.35)] transition-opacity ${refreshing ? "opacity-60" : ""}`}>
        <div className="flex flex-col gap-2.5 border-0 border-b border-solid border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="m-0 text-xs text-slate-600">
            <span className="font-bold text-slate-900">{filtered.length}</span> {filtered.length === 1 ? "stay" : "stays"}, most recent first
          </p>
          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search check-out history</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search guest, phone, property or reference"
              className="h-9 w-full rounded-lg border border-solid border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-800 outline-none placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
            />
          </label>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <History className="h-6 w-6" aria-hidden />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-slate-800">{list.length === 0 ? "No finished stays yet" : "Nothing matches"}</p>
            <p className="m-0 mt-1 text-xs text-slate-500">
              {list.length === 0 ? "Stays appear here once you confirm the guest's check-out." : "Try another period or search term."}
            </p>
          </div>
        ) : (
          <>
            <ul className="m-0 list-none p-0">
              {rows.map((b, i) => {
                const month = monthLabel(b.checkOut);
                const startsMonth = i === 0 || monthLabel(rows[i - 1].checkOut) !== month;
                const t = timing(b);
                const name = b.guestName ?? "Guest";
                const start = new Date(String(b.checkIn ?? "")).getTime();
                const end = new Date(String(b.checkOut ?? "")).getTime();
                const nights = end > start ? Math.max(1, Math.round((end - start) / DAY)) : null;
                const out = b.checkOut ? new Date(b.checkOut) : null;
                const href = b.bookingReference ? `/owner/bookings/checked-in/${encodeURIComponent(b.bookingReference)}` : null;
                return (
                  <li key={b.id}>
                    {startsMonth && (
                      <div className="flex items-center gap-2 border-0 border-b border-solid border-slate-200 bg-slate-50/80 px-5 py-2">
                        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">{month}</span>
                        <span className="rounded-full bg-white px-1.5 py-px text-[10px] font-semibold tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200">
                          {filtered.filter((x) => monthLabel(x.checkOut) === month).length}
                        </span>
                      </div>
                    )}
                    <div className="group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-0 border-b border-solid border-slate-200 px-4 py-3.5 transition-colors hover:bg-[#f2f9f7] sm:px-5 md:grid-cols-[auto_minmax(0,1.4fr)_minmax(0,1fr)_auto_auto]">
                      {/* Check-out day */}
                      <span className="flex w-12 shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-[0_6px_14px_-10px_rgba(15,23,42,0.5)] ring-1 ring-slate-200">
                        <span className="bg-slate-700 py-0.5 text-[9px] font-bold tracking-[0.14em] text-white">
                          {out ? out.toLocaleDateString("en-GB", { timeZone: TZ, month: "short" }).toUpperCase() : ""}
                        </span>
                        <span className="pt-0.5 text-lg font-bold leading-none tabular-nums text-slate-900">
                          {out ? out.toLocaleDateString("en-GB", { timeZone: TZ, day: "2-digit" }) : "?"}
                        </span>
                        <span className="pb-1 text-[9px] font-semibold text-slate-400">out</span>
                      </span>

                      <div className="min-w-0">
                        {href ? (
                          <Link href={href} className="block truncate text-[15px] font-semibold text-slate-900 no-underline hover:underline">{name}</Link>
                        ) : (
                          <p className="m-0 truncate text-[15px] font-semibold text-slate-900">{name}</p>
                        )}
                        <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                          {b.property?.title ?? "Your property"}
                          {b.roomType ?? b.roomCode ? ` · ${b.roomType ?? b.roomCode}` : ""}
                        </p>
                      </div>

                      <div className="hidden min-w-0 md:block">
                        <p className="m-0 flex items-center gap-1.5 text-sm text-slate-800">
                          {fmtDay(b.checkIn)} <ArrowRight className="h-3.5 w-3.5 text-slate-300" aria-hidden /> {fmtDay(b.checkOut)}
                          {nights ? <span className="ml-1 rounded-md bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-600">{nights} {nights === 1 ? "night" : "nights"}</span> : null}
                        </p>
                        <span title={t.title} className={`mt-1.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${t.cls}`}>{t.text}</span>
                      </div>

                      <span className="hidden whitespace-nowrap text-right text-[15px] font-bold tabular-nums text-slate-900 md:block">{fmtTzs(amountOf(b))}</span>

                      <button
                        type="button"
                        onClick={() => openAudit(b)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:border-[#02665e]/40 hover:text-[#02665e]"
                        title="Rating, notes and activity"
                      >
                        <History className="h-3.5 w-3.5" aria-hidden /> <span className="hidden sm:inline">Record</span>
                      </button>

                      {/* Phones: the stay and amount under the name */}
                      <div className="col-span-3 -mt-1 flex items-center justify-between gap-2 pl-[62px] md:hidden">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${t.cls}`}>{t.text}</span>
                        <span className="text-sm font-bold tabular-nums text-slate-900">{fmtTzs(amountOf(b))}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Pagination */}
            <div className="flex flex-col gap-3 bg-slate-50 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex items-center gap-3">
                <span>
                  Showing <span className="font-semibold tabular-nums text-slate-900">{(safePage - 1) * pageSize + 1}</span> to{" "}
                  <span className="font-semibold tabular-nums text-slate-900">{Math.min(safePage * pageSize, filtered.length)}</span> of{" "}
                  <span className="font-semibold tabular-nums text-slate-900">{filtered.length}</span>
                </span>
                <span className="hidden h-4 w-px bg-slate-300 sm:block" aria-hidden />
                <span className="hidden items-center gap-1 sm:inline-flex" role="group" aria-label="Rows per page">
                  Rows
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
          </>
        )}
      </section>
    </div>
  );
}

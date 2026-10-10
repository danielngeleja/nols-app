"use client";

import { useEffect, useState, useMemo } from "react";
import apiClient from "@/lib/apiClient";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CalendarX2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  LogIn,
  LogOut,
  ScanLine,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;
const TZ = "Africa/Dar_es_Salaam";
const DAY = 86_400_000;
const PAGE_SIZES = [6, 12, 24] as const;

/** Page numbers with gaps (0) so the bar stays short: 1 ... 4 5 6 ... 12. */
function pageList(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, current - 1, current, current + 1].filter((p) => p >= 1 && p <= total));
  const sorted = [...set].sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push(0); out.push(p); });
  return out;
}

type Booking = {
  id: number;
  bookingReference: string;
  property: string; // Property title from API
  propertyId?: number;
  checkIn: string;
  checkOut: string;
  status: string;
  totalAmount: number | string;
  transportFare?: number | string | null;
  ownerBaseAmount?: number | string | null;
  guestName?: string | null;
  checkedInAt?: string | null;
};

type FilterTab = 'all' | 'recent' | 'waiting' | 'checked-in' | 'checked-out' | 'cancelled';

const isCancelled = (s: string) => s === 'CANCELLED' || s === 'CANCELED';

const STATUS: Record<string, { label: string; chip: string; dot: string; avatar: string }> = {
  CHECKED_IN: { label: 'Checked in', chip: 'bg-emerald-50 text-emerald-800', dot: 'bg-emerald-500', avatar: 'bg-[#02665e] text-white' },
  CONFIRMED: { label: 'Awaiting arrival', chip: 'bg-amber-50 text-amber-800', dot: 'bg-amber-500', avatar: 'bg-amber-100 text-amber-800' },
  CHECKED_OUT: { label: 'Checked out', chip: 'bg-slate-100 text-slate-700', dot: 'bg-slate-500', avatar: 'bg-slate-200 text-slate-700' },
  CANCELLED: { label: 'Cancelled', chip: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500', avatar: 'bg-rose-50 text-rose-400' },
  CANCELED: { label: 'Cancelled', chip: 'bg-rose-50 text-rose-700', dot: 'bg-rose-500', avatar: 'bg-rose-50 text-rose-400' },
  PENDING: { label: 'Pending', chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', avatar: 'bg-slate-100 text-slate-600' },
};

/** Most useful first: in house, then arrivals soonest, then finished, then cancelled. */
function rank(b: Booking): [number, number] {
  const s = b.status.toUpperCase();
  const inMs = new Date(b.checkIn).getTime();
  const outMs = new Date(b.checkOut).getTime();
  if (s === 'CHECKED_IN') return [0, outMs];
  if (s === 'CONFIRMED') return [1, inMs];
  if (s === 'CHECKED_OUT') return [2, -outMs];
  if (isCancelled(s)) return [4, -inMs];
  return [3, -inMs];
}

function amountOf(b: Booking): number {
  const toNum = (v: any) => Number(typeof v === 'string' ? v.replace(/,/g, '') : String(v ?? 0));
  const oba = toNum(b.ownerBaseAmount);
  if (Number.isFinite(oba) && oba > 0) return oba;
  const total = toNum(b.totalAmount);
  return Number.isFinite(total) && total > 0 ? total : 0;
}

const dayKey = (d: string | number | Date) => new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
const fmtDay = (d: string) => new Date(d).toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short' });
const fmtTzs = (n: number) => `TZS ${Math.round(n).toLocaleString('en-US')}`;

export default function OwnerBookingsPage() {
  const [list, setList] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZES[0]);
  const [now] = useState(() => Date.now());
  const router = useRouter();
  const searchParams = useSearchParams();

  const isValidTab = (v: string | null): v is FilterTab =>
    v === 'all' || v === 'recent' || v === 'waiting' || v === 'checked-in' || v === 'checked-out' || v === 'cancelled';

  // Allow deep-linking from sidebar: /owner/bookings?tab=checked-out
  useEffect(() => {
    const tab = searchParams?.get('tab') ?? null;
    if (isValidTab(tab) && tab !== activeTab) {
      setActiveTab(tab);
    }
  }, [searchParams, activeTab]);

  useEffect(() => {
    let mounted = true;

    const loadBookings = async () => {
      try {
        // The reports API enforces a max window (~12 months). Keep the request within that
        // so we don't accidentally exclude current bookings due to server-side clamping.
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 180);
        const toDate = new Date();
        toDate.setDate(toDate.getDate() + 180);

        const response = await api.get('/api/owner/reports/bookings', {
          params: {
            from: fromDate.toISOString().split('T')[0],
            to: toDate.toISOString().split('T')[0],
          }
        });

        if (!mounted) return;
        // NEW (unpaid) bookings are never shown to owners.
        setList((response.data?.table || []).filter((b: Booking) => String(b.status).toUpperCase() !== 'NEW'));
      } catch (err: any) {
        console.error('Failed to load bookings:', err);
        if (mounted) setList([]);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadBookings();
    return () => { mounted = false; };
  }, []);

  const selectTab = (tab: FilterTab) => {
    setActiveTab(tab);
    setPage(1);
    try {
      const next = new URLSearchParams(searchParams?.toString() ?? "");
      if (tab === 'all') next.delete('tab');
      else next.set('tab', tab);
      router.replace(`/owner/bookings${next.toString() ? `?${next.toString()}` : ''}`);
    } catch {}
  };

  const inRecentWindow = (b: Booking) => {
    const t = new Date(b.checkIn).getTime();
    return t >= now - 30 * DAY && t <= now + 30 * DAY;
  };

  const counts = useMemo(() => {
    const by = (fn: (s: string) => boolean) => list.filter((b) => fn(b.status.toUpperCase())).length;
    return {
      all: list.length,
      recent: list.filter(inRecentWindow).length,
      waiting: by((s) => s === 'CONFIRMED'),
      'checked-in': by((s) => s === 'CHECKED_IN'),
      'checked-out': by((s) => s === 'CHECKED_OUT'),
      cancelled: by(isCancelled),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, now]);

  // What the front desk needs to know about today, in East Africa Time.
  const today = useMemo(() => {
    const key = dayKey(now);
    return {
      arriving: list.filter((b) => b.status.toUpperCase() === 'CONFIRMED' && dayKey(b.checkIn) === key).length,
      leaving: list.filter((b) => b.status.toUpperCase() === 'CHECKED_IN' && dayKey(b.checkOut) === key).length,
      inHouse: list.filter((b) => b.status.toUpperCase() === 'CHECKED_IN').length,
      label: new Date(now).toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }),
    };
  }, [list, now]);

  const propertyOptions = useMemo(() => {
    const unique = new Map<string, string>();
    list.forEach((booking) => {
      const key = booking.propertyId ? String(booking.propertyId) : booking.property;
      if (!unique.has(key)) unique.set(key, booking.property);
    });
    return [...unique.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [list]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return list
      .filter((b) => {
        const s = b.status.toUpperCase();
        switch (activeTab) {
          case 'recent': return inRecentWindow(b);
          case 'waiting': return s === 'CONFIRMED';
          case 'checked-in': return s === 'CHECKED_IN';
          case 'checked-out': return s === 'CHECKED_OUT';
          case 'cancelled': return isCancelled(s);
          default: return true;
        }
      })
      .filter((b) => {
        const propertyKey = b.propertyId ? String(b.propertyId) : b.property;
        if (propertyFilter !== 'all' && propertyKey !== propertyFilter) return false;
        if (!query) return true;
        return [b.property, b.guestName, b.bookingReference].filter(Boolean).some((v) => String(v).toLowerCase().includes(query));
      })
      .sort((a, b) => {
        const [ra, ta] = rank(a);
        const [rb, tb] = rank(b);
        return ra - rb || ta - tb;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, activeTab, propertyFilter, searchQuery, now]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);
  const visibleValue = filtered.filter((b) => !isCancelled(b.status.toUpperCase())).reduce((t, b) => t + amountOf(b), 0);

  if (loading) {
    // Skeleton in the page's real shape, so nothing jumps when data lands.
    return (
      <div id="owner-bookings" className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6" aria-busy="true" aria-label="Loading bookings">
        <style>{`
          #owner-bookings, #owner-bookings * { box-sizing: border-box; }
          @keyframes ob-shimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
          #owner-bookings .ob-sk { background: linear-gradient(90deg, #eef2f1 0%, #f8faf9 40%, #eef2f1 80%); background-size: 800px 100%; animation: ob-shimmer 1.3s linear infinite; }
          #owner-bookings .ob-sk-dark { background: linear-gradient(90deg, rgba(255,255,255,.06) 0%, rgba(255,255,255,.14) 40%, rgba(255,255,255,.06) 80%); background-size: 800px 100%; animation: ob-shimmer 1.3s linear infinite; }
        `}</style>
        <div className="rounded-3xl bg-[#012a26] px-5 pb-5 pt-6 sm:px-8 sm:pt-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-2.5">
              <div className="ob-sk-dark h-3 w-28 rounded-full" />
              <div className="ob-sk-dark h-8 w-44 rounded-lg" />
              <div className="ob-sk-dark h-3.5 w-52 rounded-full" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[0, 1, 2].map((i) => <div key={i} className="ob-sk-dark h-[68px] rounded-2xl sm:w-[132px]" />)}
            </div>
          </div>
          <div className="mt-7 flex gap-3">
            {[56, 120, 96, 104, 88].map((w, i) => <div key={i} className="ob-sk-dark h-4 rounded-full" style={{ width: w }} />)}
          </div>
        </div>
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_16rem_10rem]">
          {[0, 1, 2].map((i) => <div key={i} className="ob-sk h-11 rounded-xl" />)}
        </div>
        <div className="overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-24px_rgba(15,23,42,0.35)]">
          <div className="border-0 border-b border-solid border-slate-200 bg-slate-50 px-5 py-3">
            <div className="ob-sk h-3 w-40 rounded-full" />
          </div>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 border-0 border-b border-solid border-slate-200 px-5 py-4 last:border-b-0">
              <div className="ob-sk h-12 w-12 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="ob-sk h-3.5 w-48 max-w-full rounded-full" />
                <div className="ob-sk h-3 w-32 rounded-full" />
              </div>
              <div className="ob-sk hidden h-3 w-40 rounded-full md:block" />
              <div className="ob-sk hidden h-6 w-24 rounded-full md:block" />
              <div className="ob-sk h-4 w-24 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const tabs: { key: FilterTab; label: string; Icon: typeof Clock; count: number }[] = [
    { key: 'all', label: 'All', Icon: CalendarDays, count: counts.all },
    { key: 'waiting', label: 'Awaiting arrival', Icon: Clock, count: counts.waiting },
    { key: 'checked-in', label: 'Checked in', Icon: CheckCircle2, count: counts['checked-in'] },
    { key: 'checked-out', label: 'Checked out', Icon: LogOut, count: counts['checked-out'] },
    { key: 'cancelled', label: 'Cancelled', Icon: CalendarX2, count: counts.cancelled },
  ];

  return (
    <div id="owner-bookings" className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <style>{`#owner-bookings, #owner-bookings * { box-sizing: border-box; }`}</style>

      {/* ── Header band ── */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)", WebkitMaskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative px-5 pt-6 sm:px-8 sm:pt-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Property owner</p>
              <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">Bookings</h1>
              <p className="m-0 mt-1.5 text-sm text-white/60">{today.label}</p>
            </div>

            {/* Today at a glance */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {[
                { label: 'Arriving today', value: today.arriving, Icon: LogIn, onClick: () => selectTab('waiting') },
                { label: 'Leaving today', value: today.leaving, Icon: LogOut, onClick: () => selectTab('checked-in') },
                { label: 'In house now', value: today.inHouse, Icon: CheckCircle2, onClick: () => selectTab('checked-in') },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={t.onClick}
                  className="group min-w-0 rounded-2xl border border-solid border-white/10 bg-white/[0.04] px-3.5 py-3 text-left text-white transition hover:border-[#5eead4]/40 hover:bg-white/[0.07] sm:min-w-[132px] sm:px-4"
                >
                  <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">
                    <t.Icon className="h-3.5 w-3.5 text-[#5eead4]" aria-hidden />
                    <span className="truncate">{t.label}</span>
                  </span>
                  <span className={`mt-1 block text-2xl font-bold tabular-nums ${t.value > 0 ? 'text-white' : 'text-white/35'}`}>{t.value}</span>
                </button>
              ))}
            </div>
          </div>

          <nav className="-mx-1 mt-6 flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Booking status">
            {tabs.map((tab) => {
              const on = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => selectTab(tab.key)}
                  aria-current={on ? 'page' : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 border-0 border-b-2 border-solid bg-transparent px-3 pb-3 pt-1 text-sm font-semibold transition-colors ${
                    on ? 'border-[#5eead4] text-white' : 'border-transparent text-white/55 hover:text-white'
                  }`}
                >
                  <tab.Icon className="h-4 w-4" aria-hidden />
                  {tab.label}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${on ? 'bg-[#5eead4] text-[#012a26]' : 'bg-white/10 text-white/60'}`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
            <Link
              href="/owner/bookings/validate"
              className="ml-auto inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl bg-[#5eead4] px-3.5 py-2 text-sm font-bold text-[#012a26] no-underline transition hover:bg-[#8ff3e1]"
            >
              <ScanLine className="h-4 w-4" aria-hidden /> Check in a guest
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Toolbar ── */}
      <section className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,16rem)_auto]" aria-label="Booking filters">
        <label className="relative block">
          <span className="sr-only">Search bookings</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => { setSearchQuery(event.target.value); setPage(1); }}
            placeholder="Search guest, property or booking reference"
            className="h-11 w-full rounded-xl border border-solid border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
          />
        </label>
        <label className="relative block">
          <span className="sr-only">Filter by property</span>
          <Building2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <select
            value={propertyFilter}
            onChange={(event) => { setPropertyFilter(event.target.value); setPage(1); }}
            className="h-11 w-full rounded-xl border border-solid border-slate-300 bg-white pl-10 pr-3 text-sm text-slate-700 outline-none transition focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
          >
            <option value="all">All properties</option>
            {propertyOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={activeTab === 'recent'}
          onClick={() => selectTab(activeTab === 'recent' ? 'all' : 'recent')}
          className={`inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-solid px-4 text-sm font-semibold transition ${
            activeTab === 'recent' ? 'border-[#02665e] bg-[#02665e] text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Clock className="h-4 w-4" aria-hidden="true" />
          Within 30 days
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${activeTab === 'recent' ? 'bg-white/20' : 'bg-slate-100 text-slate-500'}`}>{counts.recent}</span>
        </button>
      </section>

      {/* ── List ── */}
      <section className="overflow-hidden rounded-2xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-24px_rgba(15,23,42,0.35)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
          <p className="m-0 text-xs text-slate-600">
            <span className="font-bold text-slate-900">{filtered.length}</span> {filtered.length === 1 ? 'booking' : 'bookings'}
            {propertyOptions.length > 1 && propertyFilter === 'all' ? ` across ${propertyOptions.length} properties` : ''}
          </p>
          {visibleValue > 0 && (
            <p className="m-0 text-xs text-slate-600">
              <span className="font-bold tabular-nums text-slate-900">{fmtTzs(visibleValue)}</span> booked value, excluding cancellations
            </p>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
              <CalendarDays className="h-6 w-6" aria-hidden />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-slate-800">No bookings found</p>
            <p className="m-0 mt-1 text-xs text-slate-500">Try another status, property or search term.</p>
            <button
              type="button"
              onClick={() => { selectTab('all'); setPropertyFilter('all'); setSearchQuery(''); }}
              className="mt-4 h-9 rounded-lg border border-solid border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              Clear filters
            </button>
          </div>
        ) : (
          <>
            {/* Column heads, md and up */}
            <div className={`hidden ${GRID} items-center gap-4 border-0 border-b border-solid border-slate-200 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 md:grid`}>
              <span>Guest and arrival</span>
              <span>Stay</span>
              <span>Status</span>
              <span className="text-right">Your amount</span>
              <span aria-hidden />
            </div>

            <ul className="m-0 list-none p-0">
              {pageRows.map((b, i) => {
                const group = rank(b)[0];
                const startsGroup = i === 0 || rank(pageRows[i - 1])[0] !== group;
                return (
                  <li key={b.id}>
                    {startsGroup && activeTab === 'all' && (
                      <div className="flex items-center gap-2 border-0 border-b border-solid border-slate-200 bg-slate-50/80 px-5 py-2">
                        <span className={`h-2 w-2 rounded-full ${GROUPS[group].dot}`} aria-hidden />
                        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-600">{GROUPS[group].label}</span>
                        <span className="rounded-full bg-white px-1.5 py-px text-[10px] font-semibold tabular-nums text-slate-500 ring-1 ring-inset ring-slate-200">
                          {filtered.filter((x) => rank(x)[0] === group).length}
                        </span>
                      </div>
                    )}
                    <BookingRow booking={b} now={now} />
                  </li>
                );
              })}
            </ul>

            {/* Pagination: always shown, so the owner sees where they are in the list. */}
            <div className="flex flex-col gap-3 border-0 border-t border-solid border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-5">
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
                        pageSize === size ? 'border-[#012a26] bg-[#012a26] text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'
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
                      aria-current={p === safePage ? 'page' : undefined}
                      className={`h-8 min-w-[2rem] rounded-lg border border-solid px-2 font-semibold tabular-nums transition ${
                        p === safePage ? 'border-[#02665e] bg-[#02665e] text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
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

/* ── Shared row pieces ── */

const GRID = 'grid-cols-[minmax(0,1.7fr)_minmax(0,1.3fr)_150px_150px_24px]';

const GROUPS: Record<number, { label: string; dot: string }> = {
  0: { label: 'In house', dot: 'bg-emerald-500' },
  1: { label: 'Awaiting arrival', dot: 'bg-amber-500' },
  2: { label: 'Checked out', dot: 'bg-slate-500' },
  3: { label: 'Other', dot: 'bg-slate-400' },
  4: { label: 'Cancelled', dot: 'bg-rose-500' },
};

/** Calendar tile for the arrival day; the colour carries the status. */
function DateTile({ iso, tone }: { iso: string; tone: string }) {
  const d = new Date(iso);
  const month = d.toLocaleDateString('en-GB', { timeZone: TZ, month: 'short' }).toUpperCase();
  const day = d.toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit' });
  const weekday = d.toLocaleDateString('en-GB', { timeZone: TZ, weekday: 'short' });
  return (
    <span className="flex w-12 shrink-0 flex-col overflow-hidden rounded-xl bg-white text-center shadow-[0_6px_14px_-10px_rgba(15,23,42,0.5)] ring-1 ring-slate-200">
      <span className={`py-0.5 text-[9px] font-bold tracking-[0.14em] ${tone}`}>{month}</span>
      <span className="pt-0.5 text-lg font-bold leading-none tabular-nums text-slate-900">{day}</span>
      <span className="pb-1 text-[9px] font-semibold text-slate-400">{weekday}</span>
    </span>
  );
}

function rowFacts(b: Booking, now: number) {
  const s = b.status.toUpperCase();
  const cfg = STATUS[s] ?? { label: b.status, chip: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', avatar: 'bg-slate-100 text-slate-600' };
  const start = new Date(b.checkIn).getTime();
  const end = new Date(b.checkOut).getTime();
  const nights = end > start ? Math.max(1, Math.round((end - start) / DAY)) : 1;
  const pos = end > start ? Math.max(0, Math.min(1, (now - start) / (end - start))) : 0;
  const todayKey = dayKey(now);
  const cancelled = isCancelled(s);
  const tile =
    s === 'CHECKED_IN' ? 'bg-[#02665e] text-white'
      : s === 'CONFIRMED' ? 'bg-amber-500 text-white'
        : cancelled ? 'bg-rose-100 text-rose-600'
          : 'bg-slate-700 text-white';
  const days = (ms: number) => Math.max(1, Math.round(ms / DAY));
  const note =
    s === 'CONFIRMED' && dayKey(b.checkIn) === todayKey ? { text: 'Arrives today', tone: 'text-[#02665e]' }
      : s === 'CHECKED_IN' && dayKey(b.checkOut) === todayKey ? { text: 'Leaves today', tone: 'text-[#02665e]' }
        : s === 'CHECKED_IN' ? { text: `Night ${Math.min(nights, Math.max(1, Math.ceil(pos * nights)))} of ${nights}`, tone: 'text-emerald-700' }
          : s === 'CONFIRMED' && start > now ? { text: `Arrives in ${days(start - now)} days`, tone: 'text-amber-700' }
            : s === 'CONFIRMED' && end < now ? { text: 'Check-out date passed', tone: 'text-slate-500' }
              : s === 'CHECKED_OUT' ? { text: `Left ${days(now - end)} days ago`, tone: 'text-slate-500' }
                : null;
  const href = `/owner/bookings/checked-in/${encodeURIComponent(b.bookingReference)}`;
  return { s, cfg, nights, pos, name: b.guestName || 'Guest', note, href, cancelled, tile, amount: amountOf(b) };
}

function BookingRow({ booking, now }: { booking: Booking; now: number }) {
  const r = rowFacts(booking, now);
  return (
    <Link
      href={r.href}
      className={`group block border-0 border-b border-solid border-slate-200 no-underline transition-colors hover:bg-[#f2f9f7] hover:shadow-[inset_3px_0_0_#02665e] ${r.cancelled ? 'bg-slate-50/40' : 'bg-white'}`}
    >
      {/* md and up */}
      <div className={`hidden ${GRID} items-center gap-4 px-5 py-3.5 md:grid`}>
        <div className="flex min-w-0 items-center gap-3.5">
          <DateTile iso={booking.checkIn} tone={r.tile} />
          <div className="min-w-0">
            <p className={`m-0 truncate text-[15px] font-semibold ${r.cancelled ? 'text-slate-500' : 'text-slate-900'}`}>{r.name}</p>
            <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-500">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              {booking.property}
            </p>
          </div>
        </div>

        <div className="min-w-0">
          <p className="m-0 flex items-center gap-1.5 text-sm text-slate-800">
            {fmtDay(booking.checkIn)}
            <ArrowRight className="h-3.5 w-3.5 text-slate-300" aria-hidden />
            {fmtDay(booking.checkOut)}
            <span className="ml-1 rounded-md bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-600">{r.nights} {r.nights === 1 ? 'night' : 'nights'}</span>
          </p>
          {r.s === 'CHECKED_IN' ? (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="block h-1.5 w-full max-w-[150px] overflow-hidden rounded-full bg-slate-200">
                <span className="block h-full rounded-full bg-[#02665e]" style={{ width: `${Math.round(r.pos * 100)}%` }} />
              </span>
              {r.note ? <span className={`shrink-0 text-[11px] font-semibold ${r.note.tone}`}>{r.note.text}</span> : null}
            </div>
          ) : r.note ? (
            <p className={`m-0 mt-1 text-[11px] font-semibold ${r.note.tone}`}>{r.note.text}</p>
          ) : null}
        </div>

        <span>
          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ring-black/5 ${r.cfg.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${r.cfg.dot}`} aria-hidden />
            {r.cfg.label}
          </span>
        </span>

        <span className={`whitespace-nowrap text-right text-[15px] font-bold tabular-nums ${r.cancelled ? 'text-slate-400 line-through decoration-rose-300' : 'text-slate-900'}`}>
          {r.amount > 0 ? fmtTzs(r.amount) : <span className="text-sm font-normal text-slate-400">Not set</span>}
        </span>

        <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden />
      </div>

      {/* Phones */}
      <div className="flex items-center gap-3 px-4 py-3.5 md:hidden">
        <DateTile iso={booking.checkIn} tone={r.tile} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-sm font-semibold ${r.cancelled ? 'text-slate-500' : 'text-slate-900'}`}>{r.name}</span>
            <span className={`shrink-0 text-sm font-bold tabular-nums ${r.cancelled ? 'text-slate-400 line-through decoration-rose-300' : 'text-slate-900'}`}>
              {r.amount > 0 ? fmtTzs(r.amount) : ''}
            </span>
          </div>
          <p className="m-0 mt-0.5 truncate text-[11px] text-slate-500">
            {booking.property} · {r.nights} {r.nights === 1 ? 'night' : 'nights'} to {fmtDay(booking.checkOut)}
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${r.cfg.chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${r.cfg.dot}`} aria-hidden />
              {r.cfg.label}
            </span>
            {r.note ? <span className={`truncate text-[11px] font-semibold ${r.note.tone}`}>{r.note.text}</span> : null}
          </div>
        </div>
      </div>
    </Link>
  );
}
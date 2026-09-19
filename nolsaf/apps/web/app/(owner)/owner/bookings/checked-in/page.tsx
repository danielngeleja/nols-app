"use client";
import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import { Calendar, Loader2, CheckCircle, User, Phone, FileText, ChevronDown } from "lucide-react";
import Link from "next/link";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

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
  code?: {
    codeVisible: string;
    usedAt?: string | null;
  };
  codeVisible?: string;
  property?: {
    id: number;
    title: string;
  };
};

export default function CheckedIn() {
  const [list, setList] = useState<CheckedInBooking[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters / sorting
  const [nightsFilter, setNightsFilter] = useState<string>("");
  const [sortKey, setSortKey] = useState<string>("checkIn_desc");

  // Load checked-in bookings
  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const url = "/api/owner/bookings/checked-in?source=checked-in-page";

    api.get<CheckedInBooking[] | { data: CheckedInBooking[] } | { items: CheckedInBooking[] }>(url)
      .then((r) => {
        if (!mounted) return;
        // Normalize response: ensure it's always an array
        const normalized = Array.isArray(r.data) 
          ? r.data 
          : (Array.isArray((r.data as any)?.data) 
            ? (r.data as any).data 
            : (Array.isArray((r.data as any)?.items) 
              ? (r.data as any).items 
              : []));
        setList(normalized);
      })
      .catch((err: any) => {
        if (!mounted) return;
        console.warn('Failed to load checked-in bookings', err);
        setList([]);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => { mounted = false; };
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-TZ', {
      style: 'currency',
      currency: 'TZS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatDate = (v: any) => {
    try {
      const d = new Date(String(v ?? ""));
      const t = d.getTime();
      if (!Number.isFinite(t)) return "—";
      return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    } catch {
      return "—";
    }
  };

  const formatDateTime = (v: any) => {
    try {
      const d = new Date(String(v ?? ""));
      const t = d.getTime();
      if (!Number.isFinite(t)) return "—";
      return d.toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "—";
    }
  };

  const nightsFor = (b: any) => {
    const inT = new Date(String(b?.checkIn ?? "")).getTime();
    const outT = new Date(String(b?.checkOut ?? "")).getTime();
    if (!Number.isFinite(inT) || !Number.isFinite(outT)) return null;
    const n = Math.ceil((outT - inT) / 86400000);
    return Number.isFinite(n) ? Math.max(1, n) : null;
  };

  const nightsOptions = useMemo(() => {
    const set = new Set<number>();
    for (const b of list) {
      const n = nightsFor(b);
      if (typeof n === "number") set.add(n);
    }
    return Array.from(set).sort((a, b) => a - b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const filteredSorted = useMemo(() => {
    let arr = list.slice();

    if (nightsFilter) {
      arr = arr.filter((b) => {
        const n = nightsFor(b);
        return n != null && String(n) === nightsFilter;
      });
    }

    const [key, dir] = sortKey.split("_");
    const mul = dir === "asc" ? 1 : -1;
    const toTime = (v: any) => {
      const t = new Date(String(v ?? "")).getTime();
      return Number.isFinite(t) ? t : 0;
    };
    const toNum = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const amountFor = (b: any) => {
      if (b?.ownerBaseAmount != null) return toNum(b.ownerBaseAmount);
      const total = toNum(b?.totalAmount);
      const transport = toNum(b?.transportFare);
      return Math.max(0, total - transport);
    };

    arr.sort((A, B) => {
      if (key === "name") return mul * String(A.guestName ?? A.customerName ?? "").localeCompare(String(B.guestName ?? B.customerName ?? ""));
      if (key === "amount") return mul * (amountFor(A) - amountFor(B));
      if (key === "checkOut") return mul * (toTime(A.checkOut) - toTime(B.checkOut));
      if (key === "validatedAt") return mul * (toTime((A as any)?.validatedAt ?? (A as any)?.code?.usedAt) - toTime((B as any)?.validatedAt ?? (B as any)?.code?.usedAt));
      if (key === "nights") return mul * (toNum(nightsFor(A) ?? 0) - toNum(nightsFor(B) ?? 0));
      // default: checkIn
      return mul * (toTime(A.checkIn) - toTime(B.checkIn));
    });

    return arr;
  }, [list, nightsFilter, sortKey]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="relative inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-emerald-50 border border-emerald-100 mb-5">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
          <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-white animate-pulse" />
        </div>
        <h1 className="text-3xl font-black text-slate-900 tracking-tight">Checked-In</h1>
        <p className="text-sm text-slate-500 mt-2">Loading checked-in guests…</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-5 pb-6">

        {/* ── Hero card ── */}
        <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-xl shadow-slate-100/70">
          <div className="pointer-events-none select-none absolute right-0 bottom-0 text-[72px] font-black text-slate-100/80 leading-none tracking-tighter pr-4 pb-1" aria-hidden>CHECKED-IN</div>
          <div className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-[0.035]" style={{ backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)", backgroundSize: "18px 18px" }} />

          <div className="relative px-6 pt-8 pb-9 sm:px-10 sm:pt-10 sm:pb-11 flex flex-col items-center text-center">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex items-center justify-center h-11 w-11 rounded-xl bg-emerald-50 border border-emerald-100">
                <Calendar className="h-5 w-5 text-emerald-600" aria-hidden />
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                Live Guests
              </div>
            </div>

            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight leading-none">Checked-In</h1>
            <p className="mt-2.5 text-sm text-slate-500 max-w-sm">View and manage all guests currently checked into your properties.</p>

            <div className="mt-5 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 bg-white text-slate-500 text-xs font-bold shadow-sm">
              {filteredSorted.length} {filteredSorted.length === 1 ? "guest" : "guests"} showing
            </div>
          </div>
        </div>

        {/* ── Bookings table card ── */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">

          {/* ── Filter toolbar ── */}
          <div className="border-b border-slate-100 bg-slate-50/50">
            <div className="px-4 sm:px-6 py-4">
              {/* header row */}
              <div className="flex items-center gap-2 mb-3">
                <div className="h-5 w-5 rounded bg-emerald-100 flex items-center justify-center">
                  <span className="text-emerald-600 text-[10px]">⊟</span>
                </div>
                <span className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-500">Filters</span>
              </div>

              {/* controls — stacks on mobile, row on sm+ */}
              <div className="flex flex-col sm:flex-row gap-2.5">

                {/* Nights */}
                <div className="w-full sm:w-[170px] flex-shrink-0">
                  <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 mb-1">Nights</div>
                  <div className="relative group">
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" aria-hidden />
                    <select
                      value={nightsFilter}
                      onChange={(e) => setNightsFilter(e.target.value)}
                      className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 text-sm font-medium text-slate-700 hover:border-emerald-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 appearance-none transition cursor-pointer"
                      aria-label="Filter by nights"
                    >
                      <option value="">All nights</option>
                      {nightsOptions.map((n) => (
                        <option key={n} value={String(n)}>{n} night{n !== 1 ? "s" : ""}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Sort */}
                <div className="w-full sm:w-[200px] flex-shrink-0">
                  <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400 mb-1">Sort</div>
                  <div className="relative group">
                    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-500 transition-colors" aria-hidden />
                    <select
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value)}
                      className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-3.5 pr-8 text-sm font-medium text-slate-700 hover:border-emerald-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 appearance-none transition cursor-pointer"
                      aria-label="Sort checked-in guests"
                    >
                      <option value="checkIn_desc">Latest check-in</option>
                      <option value="checkOut_asc">Earliest check-out</option>
                      <option value="nights_desc">Most nights</option>
                      <option value="name_asc">Name (A → Z)</option>
                      <option value="amount_desc">Amount (high → low)</option>
                    </select>
                  </div>
                </div>

              </div>
            </div>
          </div>

          {filteredSorted.length === 0 ? (
            <div className="p-12 sm:p-16 text-center">
              <Calendar className="h-12 w-12 sm:h-16 sm:w-16 text-slate-400 mx-auto mb-4 opacity-50" />
              <p className="text-sm sm:text-base text-slate-600 font-medium">No guests currently checked-in.</p>
              <p className="text-xs sm:text-sm text-slate-500 mt-2">Checked-in guests will appear here once they validate their booking codes.</p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr className="text-left">
                    <th className="px-4 sm:px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600">Booking Code</th>
                    <th className="px-4 sm:px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600">Full Name</th>
                    <th className="px-4 sm:px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600">Phone No</th>
                    <th className="px-4 sm:px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-right">NIGHTS</th>
                    <th className="px-4 sm:px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-right">Base Amount</th>
                    <th className="px-4 sm:px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600">Status</th>
                    <th className="px-4 sm:px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600">VALIDATED AT</th>
                    <th className="px-4 sm:px-6 py-3 text-xs font-bold uppercase tracking-wide text-slate-600 text-right">CHECK-OUT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {filteredSorted.map((b) => {
                    const bookingCode = b?.code?.codeVisible ?? b.codeVisible ?? b.roomCode ?? `#${b.id}`;
                    const fullName = b?.guestName ?? b?.customerName ?? '—';
                    const phone = b?.guestPhone ?? b?.phone ?? '—';
                    const nights = nightsFor(b);
                    const baseAmount = b?.ownerBaseAmount != null
                      ? Number(b.ownerBaseAmount)
                      : Math.max(0, Number(b?.totalAmount ?? 0) - Number(b?.transportFare ?? 0));
                    const amount = baseAmount > 0 ? formatCurrency(baseAmount) : '—';
                    const validatedAt = (b as any)?.validatedAt ?? (b as any)?.code?.usedAt ?? null;
                    
                    return (
                      <tr key={b.id} className="hover:bg-slate-50/60 transition-colors duration-150">
                        <td className="px-4 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden />
                            <Link
                              href={`/owner/bookings/checked-in/${encodeURIComponent(b.bookingReference)}`}
                              className="font-semibold text-slate-900 font-mono no-underline hover:underline underline-offset-2"
                              aria-label="Open checked-in booking details"
                              title="Open details"
                            >
                              {bookingCode}
                            </Link>
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2 min-w-0">
                            <User className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden />
                            <span className="text-slate-700 truncate">{fullName}</span>
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-3 sm:py-4">
                          <div className="flex items-center gap-2 min-w-0">
                            <Phone className="h-4 w-4 text-slate-400 flex-shrink-0" aria-hidden />
                            <span className="text-slate-700">{phone}</span>
                          </div>
                        </td>
                        <td className="px-4 sm:px-6 py-3 sm:py-4 text-right font-semibold text-slate-900 whitespace-nowrap">
                          {nights != null ? nights : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 sm:px-6 py-3 sm:py-4 text-right font-semibold text-slate-900 whitespace-nowrap">
                          {amount !== '—' ? amount : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 sm:px-6 py-3 sm:py-4">
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                            <CheckCircle className="h-3 w-3" />
                            CHECKED_IN
                          </span>
                        </td>
                        <td className="px-4 sm:px-6 py-3 sm:py-4 text-slate-700 whitespace-nowrap">
                          {validatedAt ? formatDateTime(validatedAt) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 sm:px-6 py-3 sm:py-4 text-right text-slate-700 whitespace-nowrap">
                          {formatDate(b.checkOut)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

    </>
  );
}

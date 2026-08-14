"use client";

import { useEffect, useRef, useState } from "react";
import apiClient from "@/lib/apiClient";
import { DollarSign, Loader2, TrendingUp, FileText, CheckCircle, Check, Clock, XCircle, Search, X, RotateCcw, Calendar, Filter, ChevronDown } from "lucide-react";
import Link from "next/link";
import DatePicker from "@/components/ui/DatePicker";
import TablePagination from "@/components/TablePagination";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Invoice = {
  id: number;
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  paidAt?: string | null;
  total: number | string;
  netPayable: number | string;
  receiptNumber?: string | null;
  booking?: {
    id: number;
    property?: {
      id: number;
      title: string;
    };
  };
};

type RevenueStats = {
  totalRevenue: number;
  paidRevenue: number;
  pendingRevenue: number;
  totalInvoices: number;
  paidInvoices: number;
  pendingInvoices: number;
};

type InvoicesResponse = {
  items: Invoice[];
  hasMore?: boolean;
  nextBeforeId?: number | null;
};

export default function OwnerRevenuePage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [fromPickerOpen, setFromPickerOpen] = useState(false);
  const [toPickerOpen, setToPickerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<string>("issuedAt_desc");
  const [hasMore, setHasMore] = useState(false);
  const [nextBeforeId, setNextBeforeId] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const didInitialLoad = useRef(false);

  // ── Draggable filter modal ──
  const [filterOffset, setFilterOffset] = useState({ x: 0, y: 0 });
  const filterCardRef = useRef<HTMLDivElement>(null);
  const filterDragRef = useRef<{ active: boolean; startX: number; startY: number; originX: number; originY: number }>({
    active: false, startX: 0, startY: 0, originX: 0, originY: 0,
  });

  // Reset position each time the modal closes
  useEffect(() => {
    if (!filtersOpen) setFilterOffset({ x: 0, y: 0 });
  }, [filtersOpen]);

  const [stats, setStats] = useState<RevenueStats>({
    totalRevenue: 0,
    paidRevenue: 0,
    pendingRevenue: 0,
    totalInvoices: 0,
    paidInvoices: 0,
    pendingInvoices: 0,
  });

  useEffect(() => {
    let mounted = true;
    const isInitial = !didInitialLoad.current;
    const pageSize = 50;
    
    const loadRevenue = async () => {
      try {
        if (mounted) {
          if (isInitial) setLoading(true);
          else setRefreshing(true);
        }

        const [invoicesRes, statsRes] = await Promise.all([
          api.get<InvoicesResponse>("/api/owner/revenue/invoices", {
            params: {
              take: pageSize,
              status: statusFilter || undefined,
              date_from: dateFrom || undefined,
              date_to: dateTo || undefined,
            },
          }),
          api.get<RevenueStats>("/api/owner/revenue/stats", {
            params: {
              status: statusFilter || undefined,
              date_from: dateFrom || undefined,
              date_to: dateTo || undefined,
            },
          }),
        ]);

        if (!mounted) return;

        const items = invoicesRes.data?.items || [];
        setInvoices(items);
        setHasMore(Boolean(invoicesRes.data?.hasMore));
        setNextBeforeId(typeof invoicesRes.data?.nextBeforeId === "number" ? invoicesRes.data.nextBeforeId : null);
        setStats({
          totalRevenue: Number(statsRes.data?.totalRevenue ?? 0),
          paidRevenue: Number(statsRes.data?.paidRevenue ?? 0),
          pendingRevenue: Number(statsRes.data?.pendingRevenue ?? 0),
          totalInvoices: Number(statsRes.data?.totalInvoices ?? 0),
          paidInvoices: Number(statsRes.data?.paidInvoices ?? 0),
          pendingInvoices: Number(statsRes.data?.pendingInvoices ?? 0),
        });

        didInitialLoad.current = true;
      } catch (err: any) {
        console.error('Failed to load revenue:', err);
        if (mounted) {
          setInvoices([]);
          setHasMore(false);
          setNextBeforeId(null);
          setStats({
            totalRevenue: 0,
            paidRevenue: 0,
            pendingRevenue: 0,
            totalInvoices: 0,
            paidInvoices: 0,
            pendingInvoices: 0,
          });
        }
      } finally {
        if (mounted) {
          if (isInitial) setLoading(false);
          setRefreshing(false);
        }
      }
    };

    loadRevenue();
    return () => { mounted = false; };
  }, [statusFilter, dateFrom, dateTo]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    const pageSize = 50;
    setLoadingMore(true);
    try {
      const response = await api.get<InvoicesResponse>("/api/owner/revenue/invoices", {
        params: {
          take: pageSize,
          beforeId: nextBeforeId ?? undefined,
          status: statusFilter || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        },
      });

      const items = response.data?.items || [];
      setInvoices((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = prev.slice();
        for (const inv of items) {
          if (!seen.has(inv.id)) merged.push(inv);
        }
        return merged;
      });
      setHasMore(Boolean(response.data?.hasMore));
      setNextBeforeId(typeof response.data?.nextBeforeId === "number" ? response.data.nextBeforeId : null);
    } catch (err) {
      console.error("Failed to load more invoices:", err);
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredSorted = (() => {
    const q = search.trim().toLowerCase();
    let arr = invoices.slice();

    if (q) {
      arr = arr.filter((inv) => {
        const invNo = String(inv.invoiceNumber ?? "").toLowerCase();
        const prop = String(inv.booking?.property?.title ?? "").toLowerCase();
        const receipt = String(inv.receiptNumber ?? "").toLowerCase();
        return invNo.includes(q) || prop.includes(q) || receipt.includes(q);
      });
    }

    const cmpStr = (a: string, b: string) => a.localeCompare(b);
    const cmpNum = (a: number, b: number) => a - b;
    const toNum = (v: any) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toTime = (v: any) => {
      const t = new Date(String(v)).getTime();
      return Number.isFinite(t) ? t : 0;
    };

    const [key, dir] = sortKey.split("_");
    const mul = dir === "asc" ? 1 : -1;

    const payout = (inv: Invoice) => {
      const net = toNum(inv.netPayable);
      if (Number.isFinite(net) && net > 0) return net;
      return toNum(inv.total);
    };

    arr.sort((A, B) => {
      if (key === "invoiceNumber") return mul * cmpStr(String(A.invoiceNumber ?? ""), String(B.invoiceNumber ?? ""));
      if (key === "property") return mul * cmpStr(String(A.booking?.property?.title ?? ""), String(B.booking?.property?.title ?? ""));
      if (key === "status") return mul * cmpStr(String(A.status ?? ""), String(B.status ?? ""));
      if (key === "amount") return mul * cmpNum(payout(A), payout(B));
      // default: issuedAt
      return mul * cmpNum(toTime(A.issuedAt), toTime(B.issuedAt));
    });

    return arr;
  })();

  const paged = filteredSorted.slice((page - 1) * pageSize, page * pageSize);

  // Reset to the first page whenever filters, search, or sort change.
  useEffect(() => { setPage(1); }, [statusFilter, dateFrom, dateTo, search, sortKey]);

  const activePanelFiltersCount =
    (statusFilter ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0) +
    (sortKey !== "issuedAt_desc" ? 1 : 0);

  useEffect(() => {
    if (!filtersOpen) {
      setFromPickerOpen(false);
      setToPickerOpen(false);
    }
  }, [filtersOpen]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-TZ', {
      style: 'currency',
      currency: 'TZS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatIsoShort = (iso?: string) => {
    if (!iso) return "";
    const parts = String(iso).split("-");
    if (parts.length !== 3) return String(iso);
    const [y, m, d] = parts;
    if (!y || !m || !d) return String(iso);
    try {
      const dt = new Date(`${y}-${m}-${d}T00:00:00`);
      if (Number.isNaN(dt.getTime())) return `${d} / ${m} / ${y}`;
      return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
      return `${d} / ${m} / ${y}`;
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { bg: string; text: string; border: string; icon: any }> = {
      'PAID': { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', icon: CheckCircle },
      'PROCESSING': { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200', icon: Clock },
      'APPROVED': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: Clock },
      'VERIFIED': { bg: 'bg-sky-50', text: 'text-sky-700', border: 'border-sky-200', icon: CheckCircle },
      'REQUESTED': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: Clock },
      'PENDING': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', icon: Clock },
      'REJECTED': { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: XCircle },
    };
    
    const config = statusConfig[status.toUpperCase()] || { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', icon: FileText };
    const Icon = config.icon;
    
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${config.bg} ${config.text} border ${config.border}`}>
        <Icon className="h-3 w-3" />
        {status.toUpperCase() === "PAID" ? "DISBURSED" : status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="relative mb-6">
          <span className="absolute inset-0 rounded-full bg-slate-400/20 animate-ping" />
          <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">My Payouts</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">Loading your revenue information…</p>
      </div>
    );
  }

  const disbursedRate = stats.totalRevenue > 0
    ? Math.min(100, Math.round((stats.paidRevenue / stats.totalRevenue) * 100))
    : 0;

  return (
    <div className="w-full max-w-none space-y-5 px-3 pb-12 sm:px-5 lg:px-6 xl:px-8">

      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-xl shadow-slate-100/70">
        <div className="pointer-events-none select-none absolute right-0 bottom-0 text-[100px] font-black text-slate-100/80 leading-none tracking-tighter pr-4 pb-1" aria-hidden>PAYOUTS</div>
        <div className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-[0.035]" style={{ backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)", backgroundSize: "18px 18px" }} />
        <div className="relative px-6 pt-5 pb-5 sm:px-8 sm:pt-6 sm:pb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-slate-100 border border-slate-200">
                <DollarSign className="h-4 w-4 text-slate-700" aria-hidden />
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                Revenue Overview
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Link href="/owner/revenue/paid" className="no-underline inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-semibold tracking-wide transition-all duration-200 active:scale-[0.97]">Disbursed</Link>
              <Link href="/owner/revenue/requested" className="no-underline inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-semibold tracking-wide transition-all duration-200 active:scale-[0.97]">Requested</Link>
            </div>
          </div>
          <div className="mt-4">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight">My Payouts</h1>
            <p className="mt-1.5 text-sm text-slate-500 max-w-md leading-relaxed">View and manage all your payouts from bookings, bonuses, and referrals in one place.</p>
          </div>
          <div className="mt-5 h-px bg-gradient-to-r from-slate-200 via-slate-100 to-transparent" />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 sm:gap-4">
        {/* Total Payout — white */}
        <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100">
              <TrendingUp className="h-4 w-4 text-slate-600" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Total payout</span>
          </div>
          <div className="text-xl font-semibold leading-none tracking-tight text-slate-900 sm:text-2xl">{formatCurrency(stats.totalRevenue)}</div>
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-400">{stats.totalInvoices} payout record{stats.totalInvoices === 1 ? '' : 's'}</span>
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">{disbursedRate}% disbursed</span>
          </div>
        </div>

        {/* Paid Payout — dark emerald */}
        <div className="flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-emerald-950 to-[#03483a] p-4 shadow-[0_10px_28px_rgba(2,44,34,0.16)]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-900/60">
              <CheckCircle className="h-4 w-4 text-emerald-400" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-300/90">Disbursed payout</span>
          </div>
          <div className="text-xl font-semibold leading-none tracking-tight text-white sm:text-2xl">{formatCurrency(stats.paidRevenue)}</div>
          <div className="text-xs text-emerald-300/70">{stats.paidInvoices} completed payout{stats.paidInvoices === 1 ? '' : 's'}</div>
        </div>

        {/* Pending Payout — dark slate */}
        <div className="flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-4 shadow-[0_10px_28px_rgba(15,23,42,0.14)]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-800/80">
              <Clock className="h-4 w-4 text-amber-400" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-300/90">Pending payout</span>
          </div>
          <div className="text-xl font-semibold leading-none tracking-tight text-white sm:text-2xl">{formatCurrency(stats.pendingRevenue)}</div>
          <div className="text-xs text-amber-300/70">
            {stats.pendingInvoices > 0
              ? `${stats.pendingInvoices} awaiting payout`
              : 'No payouts waiting'}
          </div>
        </div>
      </div>

      {/* Invoices List */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_28px_rgba(15,23,42,0.055)]">
        <div className="flex flex-col items-stretch gap-3 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex items-center gap-2">
            <div className="text-sm font-semibold tracking-tight text-slate-900">Invoices</div>
            <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
              {filteredSorted.length}
            </span>
          </div>

          {/* Search + Filter */}
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-xl bg-slate-100 px-3 transition-all duration-200 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-500/20 sm:flex-none">
              <Search className="h-3.5 w-3.5 text-slate-400 pointer-events-none flex-shrink-0" aria-hidden />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="min-w-0 flex-1 appearance-none !border-0 bg-transparent p-0 text-sm text-slate-900 !outline-none !ring-0 placeholder:text-slate-400 focus:!border-0 focus:!outline-none focus:!ring-0 sm:w-48"
                style={{ border: 'none', boxShadow: 'none' }}
                aria-label="Search invoices"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="inline-flex !min-h-0 h-5 w-5 flex-shrink-0 appearance-none items-center justify-center rounded !border-0 !bg-transparent text-slate-400 transition hover:text-slate-700"
                  style={{ border: 'none', boxShadow: 'none' }}
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              ) : null}
            </div>

            {/* Filter button */}
            <div className="relative flex-shrink-0">
              <button
                type="button"
                onClick={() => setFiltersOpen((v) => !v)}
                className={`relative inline-flex !min-h-0 h-9 w-9 appearance-none items-center justify-center rounded-xl !border-0 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/25 active:scale-[0.97] ${filtersOpen ? "!bg-emerald-100 text-emerald-700" : "!bg-slate-100 text-slate-500 hover:!bg-slate-200 hover:text-slate-700"}`}
                style={{ border: 'none', boxShadow: 'none' }}
                aria-label="Open filters"
                aria-expanded={filtersOpen}
                title="Filters"
              >
                <Filter className="h-3.5 w-3.5" aria-hidden />
              </button>

              {activePanelFiltersCount > 0 ? (
                <span className="pointer-events-none absolute -top-1.5 -right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[9px] font-extrabold text-white ring-2 ring-white z-10">
                  {activePanelFiltersCount}
                </span>
              ) : null}

                {filtersOpen ? (
                  <>
                    {/* Backdrop — flex centers the card; click outside to close */}
                    <div
                      className="fixed inset-0 z-[44] flex items-center justify-center"
                      onClick={() => setFiltersOpen(false)}
                    >
                      {/* Draggable card */}
                      <div
                        ref={filterCardRef}
                        className="relative w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-slate-200 bg-white shadow-2xl ring-1 ring-black/5 p-4 nols-soft-popover select-none"
                        style={{ transform: `translate(${filterOffset.x}px, ${filterOffset.y}px)` }}
                        onClick={(e) => e.stopPropagation()}
                        onPointerMove={(e) => {
                          if (!filterDragRef.current.active) return;
                          setFilterOffset({
                            x: filterDragRef.current.originX + e.clientX - filterDragRef.current.startX,
                            y: filterDragRef.current.originY + e.clientY - filterDragRef.current.startY,
                          });
                        }}
                        onPointerUp={() => { filterDragRef.current.active = false; }}
                        onPointerCancel={() => { filterDragRef.current.active = false; }}
                      >
                      {/* Drag handle — grab starts here, captured to card so fast drags stay live */}
                      <div
                        className="flex items-center justify-between gap-3 mb-4 cursor-grab active:cursor-grabbing touch-none"
                        onPointerDown={(e) => {
                          e.preventDefault();
                          filterCardRef.current?.setPointerCapture(e.pointerId);
                          filterDragRef.current = { active: true, startX: e.clientX, startY: e.clientY, originX: filterOffset.x, originY: filterOffset.y };
                        }}
                      >
                        <div className="min-w-0 pointer-events-none">
                          <div className="text-sm font-bold text-slate-900">Filters</div>
                          <div className="text-xs text-slate-500 mt-0.5">Refine by status, date range, and sort.</div>
                        </div>
                        <button
                            type="button"
                            onClick={() => setFiltersOpen(false)}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="flex-shrink-0 pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition cursor-pointer"
                            aria-label="Close filters"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-3 items-end">
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-1.5">Status</div>
                            <div className="relative">
                              <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="appearance-none h-10 w-full rounded-lg border border-slate-200 bg-white pl-3.5 pr-9 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400 transition-all duration-200 cursor-pointer"
                                aria-label="Filter by status"
                              >
                                <option value="">All statuses</option>
                                <option value="REQUESTED">Requested</option>
                                <option value="VERIFIED">Verified</option>
                                <option value="APPROVED">Approved</option>
                                <option value="PROCESSING">Processing</option>
                                <option value="PAID">Disbursed</option>
                                <option value="REJECTED">Rejected</option>
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-1.5">Sort</div>
                            <div className="relative">
                              <select
                                value={sortKey}
                                onChange={(e) => setSortKey(e.target.value)}
                                className="appearance-none h-10 w-full rounded-lg border border-slate-200 bg-white pl-3.5 pr-9 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400/30 focus:border-emerald-400 transition-all duration-200 cursor-pointer"
                                aria-label="Sort invoices"
                              >
                                <option value="issuedAt_desc">Newest</option>
                                <option value="issuedAt_asc">Oldest</option>
                                <option value="amount_desc">Amount (high)</option>
                                <option value="amount_asc">Amount (low)</option>
                                <option value="status_asc">Status (A→Z)</option>
                                <option value="invoiceNumber_asc">Invoice # (A→Z)</option>
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden />
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-1.5">From</div>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setFromPickerOpen(true)}
                                className={
                                  "h-10 w-full rounded-lg border bg-white px-4 pl-11 pr-11 text-left text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400/20 transition-all duration-200 " +
                                  (fromPickerOpen
                                    ? "border-slate-300 ring-slate-400/20"
                                    : "border-slate-200 hover:bg-slate-50/60 hover:border-slate-300")
                                }
                                aria-label="From date"
                                title="From date"
                              >
                                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
                                <span className={dateFrom ? "font-semibold tracking-wide text-slate-900" : "text-slate-400"}>
                                  {formatIsoShort(dateFrom) || "Select date"}
                                </span>
                              </button>

                              {dateFrom ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDateFrom("");
                                  }}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 transition"
                                  aria-label="Clear from date"
                                  title="Clear"
                                >
                                  <X className="h-4 w-4" aria-hidden />
                                </button>
                              ) : null}

                              {fromPickerOpen && (
                                <>
                                  <div className="fixed inset-0 z-[46] bg-black/5 nols-soft-overlay" onClick={() => setFromPickerOpen(false)} />
                                  <div className="absolute z-[47] top-full left-0 mt-2 nols-soft-popover">
                                    <DatePicker
                                      selected={dateFrom || undefined}
                                      onSelectAction={(s) => {
                                        const iso = Array.isArray(s) ? s[0] : s;
                                        if (iso) {
                                          setDateFrom(iso);
                                          if (dateTo && iso > dateTo) setDateTo("");
                                        }
                                        setFromPickerOpen(false);
                                      }}
                                      onCloseAction={() => setFromPickerOpen(false)}
                                      allowRange={false}
                                      allowPast
                                      twoMonths={false}
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="min-w-0">
                            <div className="text-[10px] font-bold tracking-widest text-slate-400 uppercase mb-1.5">To</div>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setToPickerOpen(true)}
                                className={
                                  "h-10 w-full rounded-lg border bg-white px-4 pl-11 pr-11 text-left text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-400/20 transition-all duration-200 " +
                                  (toPickerOpen
                                    ? "border-slate-300 ring-slate-400/20"
                                    : "border-slate-200 hover:bg-slate-50/60 hover:border-slate-300")
                                }
                                aria-label="To date"
                                title="To date"
                              >
                                <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" aria-hidden />
                                <span className={dateTo ? "font-semibold tracking-wide text-slate-900" : "text-slate-400"}>
                                  {formatIsoShort(dateTo) || "Select date"}
                                </span>
                              </button>

                              {dateTo ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDateTo("");
                                  }}
                                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700 transition"
                                  aria-label="Clear to date"
                                  title="Clear"
                                >
                                  <X className="h-4 w-4" aria-hidden />
                                </button>
                              ) : null}

                              {toPickerOpen && (
                                <>
                                  <div className="fixed inset-0 z-[46] bg-black/5 nols-soft-overlay" onClick={() => setToPickerOpen(false)} />
                                  <div className="absolute z-[47] top-full right-0 mt-2 nols-soft-popover">
                                    <DatePicker
                                      selected={dateTo || undefined}
                                      onSelectAction={(s) => {
                                        const iso = Array.isArray(s) ? s[0] : s;
                                        if (iso) {
                                          setDateTo(iso);
                                          if (dateFrom && iso < dateFrom) setDateFrom("");
                                        }
                                        setToPickerOpen(false);
                                      }}
                                      onCloseAction={() => setToPickerOpen(false)}
                                      allowRange={false}
                                      allowPast
                                      minDate={dateFrom || undefined}
                                      twoMonths={false}
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="text-xs text-slate-500 font-medium">
                            {activePanelFiltersCount > 0 ? `${activePanelFiltersCount} filter${activePanelFiltersCount === 1 ? "" : "s"} active` : "No filters applied"}
                          </div>
                          <div className="flex items-center gap-2 sm:justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setStatusFilter("");
                                setDateFrom("");
                                setDateTo("");
                                setSortKey("issuedAt_desc");
                                setFromPickerOpen(false);
                                setToPickerOpen(false);
                              }}
                              disabled={!statusFilter && !dateFrom && !dateTo && sortKey === "issuedAt_desc"}
                              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 bg-white text-slate-600 text-xs font-semibold shadow-sm hover:bg-slate-50 hover:border-slate-300 active:scale-[0.99] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-400/20 disabled:opacity-40 disabled:cursor-not-allowed"
                              aria-label="Reset filters"
                              title="Reset"
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                              Reset
                            </button>
                            <button
                              type="button"
                              onClick={() => setFiltersOpen(false)}
                              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-slate-900 text-white text-xs font-semibold shadow-sm hover:bg-slate-700 active:scale-[0.99] transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-500/25"
                              aria-label="Apply filters"
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              Apply
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}
                </div>
              </div>
            </div>
        
        {filteredSorted.length === 0 ? (
          <div className="py-16 flex flex-col items-center justify-center text-center gap-4">
            <div className="flex items-center justify-center h-14 w-14 rounded-2xl bg-slate-100 border border-slate-200">
              <FileText className="h-6 w-6 text-slate-500" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">No invoices found</p>
              <p className="text-xs text-slate-400 mt-1">Try clearing filters or adjusting the date range.</p>
            </div>
          </div>
        ) : (
          <>
          <div className="w-full overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr className="text-left">
                  <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Invoice</th>
                  <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Property</th>
                  <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Issued</th>
                  <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Status</th>
                  <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 text-right">Amount</th>
                  <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-slate-500 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {paged.map((invoice) => {
                  const propertyTitle = invoice.booking?.property?.title || "Property";
                  const payout = (() => {
                    const net = Number(invoice.netPayable);
                    if (Number.isFinite(net) && net > 0) return net;
                    const gross = Number(invoice.total);
                    return Number.isFinite(gross) ? gross : 0;
                  })();
                  const invoiceNumber = String((invoice as any)?.invoiceNumber ?? "");
                  const isOwnerSubmittedInvoice = invoiceNumber.startsWith("OINV-");
                  const viewHref = isOwnerSubmittedInvoice
                    ? `/owner/invoices/${invoice.id}`
                    : (invoice.status === "PAID" ? `/owner/revenue/receipts/${invoice.id}` : `/owner/revenue/invoices/${invoice.id}`);
                  const viewLabel = invoice.status === "PAID" ? "Receipt" : "View";
                  return (
                    <tr key={invoice.id} className="hover:bg-slate-50/60 transition-colors duration-150">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-slate-100 border border-slate-200 flex-shrink-0">
                            <FileText className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                          </div>
                          <div className="font-semibold text-slate-900 truncate">{invoice.invoiceNumber}</div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-700 truncate max-w-[260px]">{propertyTitle}</td>
                      <td className="px-5 py-3.5 text-slate-600 whitespace-nowrap text-xs">{formatDate(invoice.issuedAt)}</td>
                      <td className="px-5 py-3.5">{getStatusBadge(invoice.status)}</td>
                      <td className="px-5 py-3.5 text-right font-black text-slate-900 whitespace-nowrap">{formatCurrency(payout)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={viewHref}
                          className="inline-flex items-center justify-center gap-1.5 h-8 px-3 text-xs font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 hover:border-slate-300 transition-all duration-200 no-underline active:scale-95"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                          {viewLabel}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} pageSize={pageSize} total={filteredSorted.length} onPageChange={setPage}>
              {refreshing ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Updating…
                </span>
              ) : hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-[11px] font-bold hover:bg-slate-50 active:scale-[0.99] transition disabled:opacity-60 shadow-sm"
                >
                  {loadingMore ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <TrendingUp className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Load more
                </button>
              ) : null}
            </TablePagination>
          </>
        )}
      </div>
    </div>
  );
}


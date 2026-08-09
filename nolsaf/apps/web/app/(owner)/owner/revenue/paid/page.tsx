"use client";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, FileText, Receipt, RotateCw, ArrowUpRight, Hash, SlidersHorizontal, RotateCcw, Search, X, TrendingUp } from "lucide-react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import TableRow from "@/components/TableRow";
import TablePagination from "@/components/TablePagination";

type RevenueFilters = { status?: string; [key: string]: any };

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

export default function Paid() {
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState("paidAt_desc");
  const [search, setSearch] = useState("");
  const [filters] = useState<RevenueFilters>({ status: "PAID" });
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const load = async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const r = await api.get<{ items: Invoice[] }>("/api/owner/revenue/invoices", { params: filters });
      setItems(r.data.items || []);
    } catch (err: any) {
      console.error("Failed to load invoices", err);
      if (!silent) setItems([]);
      setError(err?.response?.data?.error ?? err?.message ?? "Failed to load disbursed invoices");
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mounted) return;
      await load();
    })();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-TZ', {
      style: 'currency',
      currency: 'TZS',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const toNumber = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
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

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const result = items.filter((invoice) => {
      if (!query) return true;
      return [invoice.invoiceNumber, invoice.receiptNumber, invoice.booking?.property?.title]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });

    const [field, dir] = sortKey.split("_");
    const asc = dir === "asc";
    result.sort((a, b) => {
      if (field === "paidAt" || field === "issuedAt") {
        const va = (a.paidAt || a.issuedAt) ?? "";
        const vb = (b.paidAt || b.issuedAt) ?? "";
        return asc ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      if (field === "amount") {
        const va = toNumber(a.netPayable) || toNumber(a.total);
        const vb = toNumber(b.netPayable) || toNumber(b.total);
        return asc ? va - vb : vb - va;
      }
      return 0;
    });

    return result;
  }, [items, search, sortKey]);

  // Reset to first page whenever the sort or the underlying data changes.
  useEffect(() => { setPage(1); }, [search, sortKey, items]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page]
  );

  const stats = useMemo(() => {
    const totalCount = items.length;
    const totalAmount = items.reduce((sum, it) => {
      const net = toNumber(it.netPayable);
      return sum + (net > 0 ? net : toNumber(it.total));
    }, 0);
    return { totalCount, totalAmount };
  }, [items]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="relative mb-6">
          <span className="absolute inset-0 rounded-full bg-emerald-400/20 animate-ping" />
          <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Disbursed Invoices</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">Loading your payment history…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-5 px-3 pb-12 sm:px-5 lg:px-6 xl:px-8">

      {/* ─── Hero Header ─────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-xl shadow-slate-100/70">
        {/* Faint watermark */}
        <div className="pointer-events-none select-none absolute right-0 bottom-0 text-[120px] font-black text-slate-100/80 leading-none tracking-tighter pr-4 pb-1" aria-hidden>
          DISBURSED
        </div>
        {/* Subtle dot grid */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-[0.035]"
          style={{ backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)", backgroundSize: "18px 18px" }}
        />

        <div className="relative px-5 pt-6 pb-6 sm:px-7 sm:pt-7 sm:pb-7 lg:px-10 lg:pt-8 lg:pb-8">
          {/* Top row */}
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-slate-100 border border-slate-200">
                <CheckCircle2 className="h-5 w-5 text-slate-700" aria-hidden />
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                Processed
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/owner/revenue/requested"
                className="no-underline inline-flex items-center gap-1.5 h-8 px-3.5 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-xs font-bold transition-all duration-200 active:scale-[0.97] shadow-sm"
                aria-label="Go to requested invoices"
              >
                Requested
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={() => load({ silent: true })}
                disabled={refreshing}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-all duration-200 active:scale-95 disabled:opacity-50 shadow-sm"
                aria-label="Refresh"
                title="Refresh"
              >
                <RotateCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          {/* Title block */}
          <div className="mt-5">
            <h1 className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight leading-none">
              Disbursed Invoices
            </h1>
            <p className="mt-2.5 text-sm text-slate-500 max-w-md leading-relaxed">
              View all invoices that have been disbursed and processed by NoLSAF.
            </p>
          </div>

          {/* Separator */}
          <div className="mt-6 h-px bg-gradient-to-r from-slate-200 via-slate-100 to-transparent" />
        </div>
      </div>

      {/* ─── Stats Row ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 sm:gap-4">
        {/* Count card */}
        <div className="relative flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.055)] transition-shadow duration-200 hover:shadow-md">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <Hash className="h-4 w-4 text-slate-600" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Invoices</p>
            <p className="mt-1 text-2xl font-semibold leading-none tabular-nums text-slate-900">{stats.totalCount.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-400">Completed payouts</p>
          </div>
        </div>

        {/* Amount card — credit-card style */}
        <div
          className="relative cursor-default select-none overflow-hidden rounded-2xl shadow-[0_8px_24px_rgba(2,102,94,0.18)] transition-shadow duration-300 hover:shadow-lg"
          style={{
            background: "linear-gradient(135deg, #1a3a8f 0%, #0a6b82 45%, #02665e 100%)",
          }}
        >
          {/* ── Decorative SVG layer ── */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 420 300" fill="none" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid slice" aria-hidden>
            {/* Big arc top-right */}
            <circle cx="390" cy="60" r="165" stroke="white" strokeOpacity="0.07" strokeWidth="1" fill="none" />
            <circle cx="390" cy="60" r="125" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none" />
            <circle cx="350" cy="30" r="95" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
            {/* Bottom-left subtle arc */}
            <circle cx="30" cy="260" r="110" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
            {/* Sparkline wave — shifted down so it doesn't overlap amount text */}
            <polyline
              points="20,240 60,212 100,222 140,190 180,200 220,168 260,178 300,148 340,160 380,132 420,118"
              stroke="white" strokeOpacity="0.14" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"
            />
            {/* Area fill under sparkline */}
            <polygon
              points="20,240 60,212 100,222 140,190 180,200 220,168 260,178 300,148 340,160 380,132 420,118 420,300 20,300"
              fill="white" fillOpacity="0.03"
            />
            {/* Sparkline dots */}
            {[[60,212],[140,190],[220,168],[300,148],[380,132]].map(([cx,cy],i) => (
              <circle key={i} cx={cx} cy={cy} r="2.5" fill="white" fillOpacity="0.25" />
            ))}
            {/* NFC arcs top-right */}
            <path d="M396 26 Q407 38 396 50" stroke="white" strokeOpacity="0.55" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M389 20 Q406 38 389 56" stroke="white" strokeOpacity="0.35" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M382 14 Q405 38 382 62" stroke="white" strokeOpacity="0.18" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>

          {/* Top sheen */}
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent pointer-events-none" />

          {/* ── Card content ── */}
          <div className="relative p-4">

            {/* Row 1 — brand + chip */}
            <div className="hidden items-start justify-between">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.25em] text-white/50">NoLSAF</p>
                <p className="text-base font-black text-white tracking-wide leading-tight mt-0.5">Revenue Card</p>
              </div>
              {/* EMV Chip */}
              <svg width="40" height="32" viewBox="0 0 38 30" fill="none" className="opacity-80 flex-shrink-0" aria-hidden>
                <rect x="1" y="1" width="36" height="28" rx="4" fill="#c8a84b" stroke="#a07830" strokeWidth="0.8" />
                <rect x="1" y="10" width="36" height="10" fill="#b8983a" />
                <rect x="13" y="1" width="12" height="28" fill="#b8983a" />
                <rect x="13" y="10" width="12" height="10" fill="#a07830" />
                <rect x="1" y="10" width="36" height="0.8" fill="#8a6820" />
                <rect x="1" y="19.2" width="36" height="0.8" fill="#8a6820" />
                <rect x="13" y="1" width="0.8" height="28" fill="#8a6820" />
                <rect x="24.2" y="1" width="0.8" height="28" fill="#8a6820" />
              </svg>
            </div>

            {/* Row 2 — amount hero */}
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/10">
                <TrendingUp className="h-4 w-4 text-white/85" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">Total revenue received</p>
                <p className="mt-1 truncate text-2xl font-semibold leading-none tabular-nums text-white">
                  {formatCurrency(stats.totalAmount)}
                </p>
                <p className="mt-1 text-xs text-white/55">{stats.totalCount} completed payout{stats.totalCount === 1 ? '' : 's'}</p>
              </div>
            </div>

            {/* Row 3 — stats + logo circles */}
            <div className="hidden items-center justify-between border-t border-white/10 pt-2">
              <div className="flex items-center gap-3 flex-wrap">
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-widest text-white/45">Invoices</p>
                  <p className="text-sm font-black text-white tabular-nums mt-0.5">{stats.totalCount}</p>
                </div>
                <div className="w-px h-8 bg-white/15 flex-shrink-0" />
                <div>
                  <p className="text-[8px] font-bold uppercase tracking-widest text-white/45">Avg per invoice</p>
                  <p className="text-sm font-black text-white tabular-nums mt-0.5">
                    {stats.totalCount > 0 ? formatCurrency(Math.round(stats.totalAmount / stats.totalCount)) : "—"}
                  </p>
                </div>
                <div className="w-px h-8 bg-white/15 flex-shrink-0" />
                <div className="inline-flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                  </span>
                  <p className="text-[8px] font-bold text-white/70 uppercase tracking-wide">Confirmed</p>
                </div>
              </div>

              {/* Dual circles (Mastercard-style) */}
              <div className="flex -space-x-3 flex-shrink-0 ml-2">
                <div className="w-9 h-9 rounded-full opacity-90 flex-shrink-0" style={{ background: "radial-gradient(circle at 40% 40%, #1a6baf, #0a3a7a)" }} />
                <div className="w-9 h-9 rounded-full opacity-75 flex-shrink-0" style={{ background: "radial-gradient(circle at 60% 40%, #02665e, #014d47)" }} />
              </div>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="mt-0.5 h-4 w-4 flex-shrink-0 rounded-full bg-red-200 inline-flex items-center justify-center text-[10px] font-black text-red-600">!</span>
          {error}
        </div>
      ) : null}

      {/* ─── Invoices Table ───────────────────────────────────── */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_28px_rgba(15,23,42,0.055)]">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex flex-col gap-3 bg-white/95 px-4 py-3.5 backdrop-blur lg:flex-row lg:items-center lg:justify-between sm:px-5">
          <div className="min-w-0 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
              <FileText className="h-4 w-4 text-emerald-600" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-semibold leading-none text-slate-900">Invoices</div>
              <div className="text-xs text-slate-400 mt-0.5">{filtered.length} {filtered.length === 1 ? 'invoice' : 'invoices'} showing</div>
            </div>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:flex-nowrap">
            <div className="relative min-w-[12rem] flex-1 lg:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search invoice, property…"
                className="h-9 w-full appearance-none rounded-xl !border-0 bg-slate-100 pl-9 pr-8 text-sm text-slate-900 !outline-none !ring-0 placeholder:text-slate-400 transition focus:bg-white focus:!ring-2 focus:!ring-emerald-500/20 lg:w-56"
                style={{ border: 'none', boxShadow: 'none' }}
                aria-label="Search disbursed invoices"
              />
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 inline-flex !min-h-0 h-5 w-5 -translate-y-1/2 appearance-none items-center justify-center rounded-full !border-0 !bg-transparent text-slate-400 transition hover:!bg-slate-200 hover:text-slate-700"
                  style={{ border: 'none', boxShadow: 'none' }}
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
            </div>

            {/* Sort */}
            <div className="relative flex items-center">
              <SlidersHorizontal className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" aria-hidden />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                className="h-9 cursor-pointer appearance-none rounded-xl !border-0 bg-slate-100 pl-8 pr-8 text-xs font-medium text-slate-700 !outline-none !ring-0 transition-all duration-200 focus:!ring-2 focus:!ring-emerald-500/20"
                style={{ border: 'none', boxShadow: 'none' }}
                aria-label="Sort invoices"
              >
                  <option value="paidAt_desc">Newest disbursed</option>
                  <option value="paidAt_asc">Oldest disbursed</option>
                <option value="amount_desc">Amount (high)</option>
                <option value="amount_asc">Amount (low)</option>
              </select>
            </div>

            {/* Reset — only when sort is non-default */}
            {sortKey !== "paidAt_desc" ? (
              <button
                type="button"
                onClick={() => setSortKey("paidAt_desc")}
                className="inline-flex !min-h-0 h-9 appearance-none items-center gap-1.5 rounded-xl !border-0 !bg-slate-100 px-3 text-xs font-medium text-slate-500 transition hover:!bg-slate-200 hover:text-slate-700"
                style={{ border: 'none', boxShadow: 'none' }}
                aria-label="Reset sort"
                title="Reset sort"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reset
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => load({ silent: true })}
              disabled={refreshing}
              className="inline-flex !min-h-0 h-9 w-9 flex-shrink-0 appearance-none items-center justify-center rounded-xl !border-0 !bg-slate-100 text-slate-600 transition-all hover:!bg-slate-200 active:scale-95 disabled:opacity-50"
              style={{ border: 'none', boxShadow: 'none' }}
              aria-label="Refresh list"
              title="Refresh"
            >
              <RotateCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100">
              <Receipt className="h-5 w-5 text-slate-400" aria-hidden />
            </div>
            <h2 className="mb-1 text-base font-semibold text-slate-900">No disbursed invoices yet</h2>
            <p className="text-sm text-slate-500">Once payments are processed, they&apos;ll appear here.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Link
                href="/owner/revenue/requested"
                className="no-underline inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition active:scale-[0.98] shadow-sm"
              >
                View Requested
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>

        ) : (
          <>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[1280px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[14%]" />
                <col className="w-[16%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                <col className="w-[15%]" />
                <col className="w-[11%]" />
                <col className="w-[13%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Invoice</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Property</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Issued</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Disbursed</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Receipt</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-widest text-slate-500">Amount</th>
                  <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-widest text-slate-500">Action</th>
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
                  const invoiceHref = isOwnerSubmittedInvoice ? `/owner/invoices/${invoice.id}` : `/owner/revenue/invoices/${invoice.id}`;
                  return (
                    <TableRow key={invoice.id} className="group hover:bg-emerald-50/40 transition-colors duration-150">
                      <td className="overflow-hidden px-4 py-3.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="flex-shrink-0 h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center">
                            <FileText className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                          </div>
                          <span className="truncate whitespace-nowrap font-semibold text-slate-900" title={invoice.invoiceNumber}>{invoice.invoiceNumber}</span>
                        </div>
                      </td>
                      <td className="truncate whitespace-nowrap px-4 py-3.5 text-slate-600" title={propertyTitle}>{propertyTitle}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-xs tabular-nums text-slate-500">{formatDate(invoice.issuedAt)}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-xs tabular-nums text-slate-500">
                        {invoice.paidAt ? formatDate(invoice.paidAt) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="overflow-hidden px-4 py-3.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm">
                          <CheckCircle2 className="h-3 w-3" aria-hidden />
                          DISBURSED
                        </span>
                      </td>
                      <td className="overflow-hidden whitespace-nowrap px-4 py-3.5">
                        {invoice.receiptNumber ? (
                          <span
                            className="inline-flex max-w-full whitespace-nowrap rounded border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-slate-700"
                            title={invoice.receiptNumber}
                          >
                            {invoice.receiptNumber}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-base">—</span>
                        )}
                      </td>
                      <td className="overflow-hidden px-4 py-3.5 text-right">
                        <span className="whitespace-nowrap font-semibold tabular-nums text-emerald-700">{formatCurrency(payout)}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={`/owner/revenue/receipts/${invoice.id}`}
                            className="no-underline inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 hover:border-emerald-300 transition-all duration-150 active:scale-95"
                          >
                            <Receipt className="h-3.5 w-3.5" aria-hidden />
                            <span className="hidden sm:inline">Receipt</span>
                          </Link>
                          <Link
                            href={invoiceHref}
                            className="no-underline inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-300 transition-all duration-150 active:scale-95"
                          >
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                            <span className="hidden sm:inline">Invoice</span>
                          </Link>
                        </div>
                      </td>
                    </TableRow>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} />
          </>
        )}
      </div>
    </div>
  );
}

"use client";
import { useEffect, useMemo, useState } from "react";
import { Loader2, FileText, Clock, ArrowRight, RotateCw, Search, X, ArrowUpRight, Hash, TrendingUp, Hourglass } from "lucide-react";
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
  total: number | string;
  netPayable: number | string;
  bookingId?: number;
  booking?: {
    id: number;
    property?: {
      id: number;
      title: string;
    };
  };
};

export default function Requested() {
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Support both legacy SUBMITTED and canonical REQUESTED statuses.
  const [filters] = useState<RevenueFilters>({ status: "REQUESTED,SUBMITTED" });
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const toNumber = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

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
      setError(err?.response?.data?.error ?? err?.message ?? "Failed to load requested invoices");
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
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((inv) => {
      const property = String(inv.booking?.property?.title ?? "").toLowerCase();
      const invoiceNo = String(inv.invoiceNumber ?? "").toLowerCase();
      const bookingId = String(inv.booking?.id ?? inv.bookingId ?? "").toLowerCase();
      return property.includes(q) || invoiceNo.includes(q) || bookingId.includes(q);
    });
  }, [items, search]);

  // Reset to first page whenever the search or the underlying data changes.
  useEffect(() => { setPage(1); }, [search, items]);

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
          <span className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping" />
          <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg shadow-amber-500/30">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Requested Invoices</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">Fetching your pending invoices…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-none space-y-5 px-3 pb-12 sm:px-5 lg:px-6 xl:px-8">

      {/* ─── Hero Header ─────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-xl shadow-slate-100/70">
        {/* Faint watermark */}
        <div className="pointer-events-none select-none absolute right-0 bottom-0 text-[120px] font-black text-slate-100/80 leading-none tracking-tighter pr-4 pb-1" aria-hidden>
          AWAIT
        </div>
        {/* Subtle dot grid */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-[0.035]"
          style={{ backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)", backgroundSize: "18px 18px" }}
        />

        <div className="relative px-6 pt-5 pb-5 sm:px-8 sm:pt-6 sm:pb-6">
          {/* Top row */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-slate-100 border border-slate-200">
                <Hourglass className="h-4 w-4 text-slate-700" aria-hidden />
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                Awaiting Review
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/owner/revenue/paid"
                className="no-underline inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-semibold tracking-wide transition-all duration-200 active:scale-[0.97]"
                aria-label="Go to disbursed invoices"
              >
                Disbursed
                <ArrowUpRight className="h-3 w-3 opacity-70" aria-hidden />
              </Link>
              <Link
                href="/owner/revenue/rejected"
                className="no-underline inline-flex items-center gap-1.5 h-7 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-[11px] font-semibold tracking-wide transition-all duration-200 active:scale-[0.97]"
                aria-label="Go to rejected invoices"
              >
                Rejected
                <ArrowUpRight className="h-3 w-3 opacity-50" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={() => load({ silent: true })}
                disabled={refreshing}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-400 transition-all duration-200 active:scale-95 disabled:opacity-50"
                aria-label="Refresh"
                title="Refresh"
              >
                <RotateCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          {/* Title block */}
          <div className="mt-4">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight">
              Requested Invoices
            </h1>
            <p className="mt-1.5 text-sm text-slate-500 max-w-md leading-relaxed">
              Invoices submitted to NoLSAF awaiting verification and approval.
            </p>
          </div>

          {/* Separator */}
          <div className="mt-5 h-px bg-gradient-to-r from-slate-200 via-slate-100 to-transparent" />
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
            <p className="mt-1 text-xs text-slate-400">Awaiting review</p>
          </div>
        </div>

        {/* Amount card — dark */}
        <div className="relative flex items-center gap-3 rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 p-4 shadow-[0_8px_24px_rgba(15,23,42,0.14)] transition-shadow duration-200 hover:shadow-lg hover:shadow-slate-900/20">
          <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-white/10">
            <TrendingUp className="h-4 w-4 text-white/80" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Total amount</p>
            <p className="mt-1 truncate text-2xl font-semibold leading-none tabular-nums text-white">{formatCurrency(stats.totalAmount)}</p>
            <p className="mt-1 text-xs text-slate-500">Value under review</p>
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
        <div className="sticky top-0 z-10 flex flex-col gap-3 bg-white/95 px-4 py-3.5 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="min-w-0 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
              <FileText className="h-4 w-4 text-amber-600" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-semibold leading-none text-slate-900">Invoices</div>
              <div className="text-xs text-slate-400 mt-0.5">{filtered.length} {filtered.length === 1 ? 'invoice' : 'invoices'} showing</div>
            </div>
          </div>

          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="relative min-w-0 flex-1 sm:flex-none">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <Search className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              </div>
              {search ? (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 z-10 inline-flex !min-h-0 h-5 w-5 -translate-y-1/2 appearance-none items-center justify-center rounded-full !border-0 !bg-transparent text-slate-400 transition hover:!bg-slate-100 hover:text-slate-600"
                  style={{ border: 'none', boxShadow: 'none' }}
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ) : null}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search invoice, property…"
                className="h-9 w-full appearance-none rounded-xl !border-0 bg-slate-100 pl-9 pr-8 text-sm text-slate-900 !outline-none !ring-0 placeholder:text-slate-400 transition-all duration-200 focus:bg-white focus:!outline-none focus:!ring-2 focus:!ring-amber-500/20 sm:w-56"
                style={{ border: 'none', boxShadow: 'none' }}
                aria-label="Search requested invoices"
              />
            </div>
            <button
              type="button"
              onClick={() => load({ silent: true })}
              disabled={refreshing}
              className="inline-flex !min-h-0 h-9 w-9 flex-shrink-0 appearance-none items-center justify-center rounded-xl !border-0 !bg-slate-100 text-slate-500 transition-all hover:!bg-slate-200 active:scale-95 disabled:opacity-50"
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
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50">
              <Clock className="h-5 w-5 text-amber-500" aria-hidden />
            </div>
            <h2 className="mb-1 text-base font-semibold text-slate-900">No pending invoices</h2>
            <p className="text-sm text-slate-500">Nothing is waiting for approval right now.</p>
            <div className="mt-4 flex justify-center">
              <Link
                href="/owner/revenue/paid"
                className="no-underline inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold transition active:scale-[0.98] shadow-sm"
              >
                View Disbursed
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        ) : (
          <>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[960px] table-fixed border-collapse text-sm">
              <colgroup>
                <col className="w-[18%]" />
                <col className="w-[22%]" />
                <col className="w-[13%]" />
                <col className="w-[14%]" />
                <col className="w-[15%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Invoice</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Property</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Issued</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Status</th>
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
                  const viewHref = isOwnerSubmittedInvoice ? `/owner/invoices/${invoice.id}` : `/owner/revenue/invoices/${invoice.id}`;
                  return (
                    <TableRow key={invoice.id} className="group hover:bg-amber-50/40 transition-colors duration-150">
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
                      <td className="overflow-hidden px-4 py-3.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide bg-amber-50 text-amber-700 border border-amber-200 shadow-sm">
                          <Clock className="h-3 w-3" aria-hidden />
                          REQUESTED
                        </span>
                      </td>
                      <td className="overflow-hidden px-4 py-3.5 text-right">
                        <span className="whitespace-nowrap font-semibold tabular-nums text-emerald-700">{formatCurrency(payout)}</span>
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            href={viewHref}
                            className="no-underline inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-300 transition-all duration-150 active:scale-95"
                          >
                            <FileText className="h-3.5 w-3.5" aria-hidden />
                            <span className="hidden sm:inline">View</span>
                          </Link>
                          {invoice.bookingId && (
                            <Link
                              href={`/owner/bookings/checked-in/${invoice.bookingId}`}
                              className="no-underline inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-300 transition-all duration-150 active:scale-95"
                            >
                              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                              <span className="hidden sm:inline">Booking</span>
                            </Link>
                          )}
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

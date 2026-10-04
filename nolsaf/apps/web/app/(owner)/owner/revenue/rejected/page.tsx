"use client";
import { useEffect, useMemo, useState } from "react";
import { XCircle, Loader2, FileText, RotateCw, ArrowUpRight, Hash, TrendingDown } from "lucide-react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import TableRow from "@/components/TableRow";
import TablePagination from "@/components/TablePagination";

type RevenueFilters = { status?: string; [key: string]: any };

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type Invoice = {
  id: number;
  invoiceReference?: string | null;
  invoiceNumber: string;
  status: string;
  issuedAt: string;
  total: number | string;
  netPayable: number | string;
  rejectedReason?: string | null;
  booking?: {
    id: number;
    property?: {
      id: number;
      title: string;
    };
  };
};

export default function Rejected() {
  const [items, setItems] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters] = useState<RevenueFilters>({ status: "REJECTED" });
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
      console.error("Failed to load rejected invoices", err);
      if (!silent) setItems([]);
      setError(err?.response?.data?.error ?? err?.message ?? "Failed to load rejected invoices");
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

  const filtered = useMemo(() => items, [items]);

  // Reset to first page whenever the underlying data changes.
  useEffect(() => { setPage(1); }, [items]);

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
          <span className="absolute inset-0 rounded-full bg-red-400/20 animate-ping" />
          <div className="relative inline-flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-br from-red-500 to-rose-600 shadow-lg shadow-red-500/30">
            <Loader2 className="h-7 w-7 animate-spin text-white" />
          </div>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Rejected Invoices</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-sm">Loading your rejected invoices…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">

      {/* ─── Hero Header ─────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-sm">

        {/* Faint watermark */}
        <div className="pointer-events-none select-none absolute right-2 bottom-0 text-[96px] font-black text-red-100/60 leading-none tracking-tighter pb-1" aria-hidden>
          DENY
        </div>
        {/* Dot grid */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-1/2 opacity-[0.03]"
          style={{ backgroundImage: "radial-gradient(circle, #334155 1px, transparent 1px)", backgroundSize: "18px 18px" }}
        />

        <div className="relative px-5 pt-5 pb-5 sm:px-6 sm:pt-6 sm:pb-6">
          {/* Top row: icon+badge LEFT, nav buttons RIGHT */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center h-9 w-9 rounded-xl bg-red-50 border border-red-200 flex-shrink-0">
                <XCircle className="h-4.5 w-4.5 text-red-500" aria-hidden />
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-600">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 flex-shrink-0" />
                Rejected
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Link
                href="/owner/revenue/requested"
                className="no-underline inline-flex items-center gap-1 h-7 px-3 rounded-md bg-slate-900 hover:bg-slate-700 text-white text-[11px] font-semibold tracking-wide transition-all duration-200 active:scale-[0.97]"
              >
                Requested
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
              <Link
                href="/owner/revenue/paid"
                className="no-underline inline-flex items-center gap-1 h-7 px-3 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11px] font-semibold tracking-wide transition-all duration-200 active:scale-[0.97]"
              >
                Disbursed
                <ArrowUpRight className="h-3 w-3" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={() => load({ silent: true })}
                disabled={refreshing}
                className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-all duration-200 active:scale-95 disabled:opacity-50"
                aria-label="Refresh"
                title="Refresh"
              >
                <RotateCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          {/* Title + description */}
          <div className="mt-4">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
              Rejected Invoices
            </h1>
            <p className="mt-2 text-sm text-slate-500 max-w-sm leading-relaxed">
              Invoices rejected by NoLSAF. Review the rejection reason and take necessary action.
            </p>
          </div>

          {/* Separator */}
          <div className="mt-5 h-px bg-gradient-to-r from-red-200 via-slate-100 to-transparent" />
        </div>
      </div>

      {/* ─── Stats Row ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Count card */}
        <div className="relative rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-200 p-5 flex items-center gap-4">
          <div className="flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-xl bg-slate-100 border border-slate-200">
            <Hash className="h-5 w-5 text-slate-600" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Invoices</p>
            <p className="mt-0.5 text-3xl font-black text-slate-900 tabular-nums leading-none">{stats.totalCount.toLocaleString()}</p>
            <p className="mt-1 text-xs text-slate-400">Total rejected</p>
          </div>
        </div>

        {/* Amount card — deep red */}
        <div className="relative rounded-2xl bg-rose-950 border border-rose-900 shadow-sm hover:shadow-lg hover:shadow-rose-950/30 transition-shadow duration-200 p-5 flex items-center gap-4">
          <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-red-500/20 to-transparent" />
          <div className="flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-xl bg-red-900/60 border border-red-800">
            <TrendingDown className="h-5 w-5 text-red-400" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-red-700">Total amount</p>
            <p className="mt-0.5 text-3xl font-black text-white tabular-nums leading-none truncate">{formatCurrency(stats.totalAmount)}</p>
            <p className="mt-1 text-xs text-red-800">Value rejected</p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* ─── Invoices Table ───────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-100 px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-red-50 border border-red-100">
              <FileText className="h-4 w-4 text-red-500" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900 leading-none">Invoices</div>
              <div className="text-xs text-slate-400 mt-0.5">{filtered.length} {filtered.length === 1 ? 'invoice' : 'invoices'} showing</div>
            </div>
          </div>

          <div className="flex gap-2 items-center">
            <button
              type="button"
              onClick={() => load({ silent: true })}
              disabled={refreshing}
              className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-all active:scale-95 disabled:opacity-50 shadow-sm"
              aria-label="Refresh"
              title="Refresh"
            >
              <RotateCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-16 px-6 text-center">
            <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-red-50 border border-red-200 mb-5">
              <XCircle className="h-8 w-8 text-red-400" aria-hidden />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-1.5">No rejected invoices</h2>
            <p className="text-sm text-slate-500">You&apos;re all clear. Nothing has been rejected.</p>
            <div className="mt-6 flex justify-center">
              <Link
                href="/owner/revenue/requested"
                className="no-underline inline-flex items-center gap-1.5 h-9 px-4 rounded-lg bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold transition active:scale-[0.98] shadow-sm"
              >
                View Requested
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
          </div>
        ) : (
          <>
          <div className="w-full overflow-x-auto">
            <table className="min-w-[820px] w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200">
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Invoice</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Property</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Issued</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Status</th>
                  <th className="px-5 sm:px-6 py-3 text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">Reason</th>
                  <th className="px-5 sm:px-6 py-3 text-right text-[11px] font-bold uppercase tracking-widest text-slate-500">Amount</th>
                  <th className="px-5 sm:px-6 py-3 text-right text-[11px] font-bold uppercase tracking-widest text-slate-500">Action</th>
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
                  const viewHref = isOwnerSubmittedInvoice && invoice.invoiceReference
                    ? `/owner/invoices/${encodeURIComponent(invoice.invoiceReference)}`
                    : `/owner/revenue/invoices/${invoice.id}`;
                  return (
                    <TableRow key={invoice.id} className="group hover:bg-red-50/30 transition-colors duration-150">
                      <td className="px-5 sm:px-6 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-shrink-0 h-7 w-7 rounded-lg bg-slate-100 flex items-center justify-center">
                            <FileText className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                          </div>
                          <span className="font-semibold text-slate-900">{invoice.invoiceNumber}</span>
                        </div>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-slate-600 truncate max-w-[200px]">{propertyTitle}</td>
                      <td className="px-5 sm:px-6 py-3.5 text-slate-500 whitespace-nowrap tabular-nums text-xs">{formatDate(invoice.issuedAt)}</td>
                      <td className="px-5 sm:px-6 py-3.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold tracking-wide bg-red-50 text-red-600 border border-red-200">
                          <XCircle className="h-3 w-3" aria-hidden />
                          REJECTED
                        </span>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-slate-500 max-w-[200px]">
                        <div className="truncate text-xs" title={invoice.rejectedReason || "—"}>
                          {invoice.rejectedReason || "—"}
                        </div>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-right">
                        <span className="font-bold text-slate-800 tabular-nums">{formatCurrency(payout)}</span>
                      </td>
                      <td className="px-5 sm:px-6 py-3.5 text-right">
                        <Link
                          href={viewHref}
                          className="no-underline inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-300 transition-all duration-150 active:scale-95"
                        >
                          <FileText className="h-3.5 w-3.5" aria-hidden />
                          <span className="hidden sm:inline">View</span>
                        </Link>
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

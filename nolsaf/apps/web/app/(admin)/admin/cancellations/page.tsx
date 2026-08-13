"use client";

import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import { Search, XCircle, X, FileX, Clock, CheckCircle, AlertCircle, TrendingUp, BedDouble, Map } from "lucide-react";
import CancellationTableRow from "@/components/admin/CancellationTableRow";
import TourCancellationPanel from "@/components/admin/TourCancellationPanel";

const api = apiClient;

type Row = {
  id: number;
  status: string;
  bookingCode: string;
  createdAt: string;
  updatedAt: string;
  policyEligible: boolean;
  policyRefundPercent: number | null;
  policyRule: string | null;
  user: { id: number; name: string | null; email: string | null; phone: string | null };
  booking: {
    checkIn: string;
    checkOut: string;
    totalAmount: number;
    status: string;
    property: { title: string; regionName?: string | null; city?: string | null; district?: string | null };
  };
};

type CancellationService = "accommodations" | "tours";

function ServiceTabs({ service, onChange }: { service: CancellationService; onChange: (service: CancellationService) => void }) {
  return (
    <div className="mx-auto mt-5 w-full max-w-3xl rounded-xl border border-slate-200 bg-slate-100 p-1.5">
      <div className="grid gap-2 sm:grid-cols-2" role="tablist" aria-label="Cancellation service">
        <button type="button" role="tab" aria-selected={service === "accommodations"} onClick={() => onChange("accommodations")} className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${service === "accommodations" ? "border-[#02665e] bg-[#02665e] text-white shadow-sm" : "border-transparent bg-transparent text-slate-600 hover:bg-white hover:text-slate-900"}`}><BedDouble className="h-4 w-4" />Accommodation</button>
        <button type="button" role="tab" aria-selected={service === "tours"} onClick={() => onChange("tours")} className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${service === "tours" ? "border-[#02665e] bg-[#02665e] text-white shadow-sm" : "border-transparent bg-transparent text-slate-600 hover:bg-white hover:text-slate-900"}`}><Map className="h-4 w-4" />Tour packages</button>
      </div>
    </div>
  );
}

export default function AdminCancellationsPage() {
  const [service, setService] = useState<CancellationService>("accommodations");
  const [items, setItems] = useState<Row[]>([]);
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const stats = useMemo(() => {
    const submitted = items.filter((i) => i.status === "SUBMITTED").length;
    const reviewing = items.filter((i) => i.status === "REVIEWING").length;
    const processing = items.filter((i) => ["APPROVED", "REFUND_PENDING"].includes(i.status)).length;
    const refunded = items.filter((i) => i.status === "REFUNDED").length;
    const rejected = items.filter((i) => i.status === "REJECTED").length;
    return { total: items.length, submitted, reviewing, processing, refunded, rejected };
  }, [items]);

  const filtered = useMemo(() => items, [items]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/api/admin/cancellations", { params: { status: status || undefined, q: q || undefined } });
      setItems(res.data.items || []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load cancellations");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("service") === "tours") setService("tours");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectService = (nextService: CancellationService) => {
    setService(nextService);
    const url = nextService === "tours" ? "/admin/cancellations?service=tours" : "/admin/cancellations";
    window.history.replaceState(null, "", url);
  };

  const header = (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex flex-col items-center text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-red-50 to-red-100"><FileX className="h-6 w-6 text-red-600" /></div>
        <h1 className="text-2xl font-bold text-gray-900">Cancellation Management</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">Select a service below, then review its requests, evidence, decisions, and refunds in one workspace.</p>
      </div>
      <ServiceTabs service={service} onChange={selectService} />
    </div>
  );

  if (service === "tours") {
    return <div className="space-y-5 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">{header}<TourCancellationPanel /></div>;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {header}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-blue-300 hover:-translate-y-1 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Total</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stats.total}</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center group-hover:scale-110 transition-transform">
              <FileX className="h-6 w-6 text-gray-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-slate-300 hover:-translate-y-1 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted</p>
              <p className="text-2xl font-bold text-slate-700 mt-1">{stats.submitted}</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center group-hover:scale-110 transition-transform">
              <Clock className="h-6 w-6 text-slate-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-amber-300 hover:-translate-y-1 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewing</p>
              <p className="text-2xl font-bold text-amber-700 mt-1">{stats.reviewing}</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-amber-50 to-amber-100 flex items-center justify-center group-hover:scale-110 transition-transform">
              <AlertCircle className="h-6 w-6 text-amber-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-blue-300 hover:-translate-y-1 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Refund Queue</p>
              <p className="text-2xl font-bold text-blue-700 mt-1">{stats.processing}</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center group-hover:scale-110 transition-transform">
              <TrendingUp className="h-6 w-6 text-blue-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-emerald-300 hover:-translate-y-1 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Refunded</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{stats.refunded}</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-emerald-50 to-emerald-100 flex items-center justify-center group-hover:scale-110 transition-transform">
              <CheckCircle className="h-6 w-6 text-emerald-600" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-red-300 hover:-translate-y-1 group">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Rejected</p>
              <p className="text-2xl font-bold text-red-700 mt-1">{stats.rejected}</p>
            </div>
            <div className="h-12 w-12 rounded-full bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center group-hover:scale-110 transition-transform">
              <XCircle className="h-6 w-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-col gap-4 w-full max-w-full">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full max-w-full">
            {/* Search Box */}
            <div className="relative w-full min-w-0 sm:col-span-2 lg:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] outline-none text-sm max-w-full box-border"
                placeholder="Search by code or request id"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    load();
                  }
                }}
              />
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    load();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Status Filter */}
            <div className="w-full min-w-0">
              <label htmlFor="status-filter" className="sr-only">
                Filter by status
              </label>
              <select
                id="status-filter"
                aria-label="Filter by status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#02665e] focus:border-[#02665e] outline-none text-sm bg-white max-w-full box-border"
              >
                <option value="">All statuses</option>
                <option value="SUBMITTED">Submitted</option>
                <option value="REVIEWING">Reviewing</option>
                <option value="NEED_INFO">Need info</option>
                <option value="APPROVED">Approved</option>
                <option value="REFUND_PENDING">Refund pending</option>
                <option value="REFUNDED">Refunded</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            {/* Apply Button */}
            <div className="w-full min-w-0">
              <button
                type="button"
                onClick={() => load()}
                className="w-full rounded-lg bg-[#02665e] px-4 py-2 text-sm font-semibold text-white hover:bg-[#014d47] transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
              >
                Apply
              </button>
            </div>
          </div>
          <div className="text-xs text-gray-500 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            <span>Tip: Click a row to open details and message the customer.</span>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm font-semibold text-red-700 flex items-center gap-2">
            <XCircle className="h-4 w-4" />
            {error}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-[#02665e]"></div>
            <p className="mt-4 text-sm text-gray-500">Loading cancellation requests...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
              <FileX className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">No cancellation requests found</h3>
            <p className="mt-2 text-sm text-gray-500">Try adjusting your filters or search terms.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Request</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booking</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Policy</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filtered.map((r) => (
                  <CancellationTableRow key={r.id} row={r} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}



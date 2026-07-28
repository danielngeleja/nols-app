"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import {
  Calendar,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  MessageSquare,
  Search,
  Star,
  User,
  Wallet,
} from "lucide-react";

const api = apiClient;

type Earning = {
  id: number;
  toRegion: string | null;
  toDistrict: string | null;
  checkIn: string | null;
  checkOut: string | null;
  checkedInAt: string | null;
  currency: string;
  totalAmount: number;
  commissionAmount: number;
  ownerCollects: number;
  assignedOwner: { id: number; name: string; email: string | null; phone: string | null } | null;
  confirmedProperty: { id: number; title: string } | null;
  guestReview: { rating: number; title: string | null; comment: string | null; ownerResponse: string | null; createdAt: string } | null;
};

type EarningsSummary = {
  bookingCount: number;
  totalAmount: number;
  commissionAmount: number;
  ownerCollects: number;
};

const EMPTY_SUMMARY: EarningsSummary = { bookingCount: 0, totalAmount: 0, commissionAmount: 0, ownerCollects: 0 };

export default function AdminGroupStayEarningsPage() {
  const [filter, setFilter] = useState<"CHECKED_IN" | "ALL">("CHECKED_IN");
  const [ownerId, setOwnerId] = useState("");
  const [owners, setOwners] = useState<Array<{ id: number; name: string; count: number }>>([]);
  const [items, setItems] = useState<Earning[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<EarningsSummary>(EMPTY_SUMMARY);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pageSize = 25;

  useEffect(() => {
    void (async () => {
      try {
        const response = await api.get("/api/admin/group-stays/bookings/earnings/owners");
        setOwners(Array.isArray(response.data?.owners) ? response.data.owners : []);
      } catch {
        setOwners([]);
      }
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = { filter, page, pageSize };
      if (ownerId) params.ownerId = Number(ownerId);
      if (search) params.q = search;
      const response = await api.get("/api/admin/group-stays/bookings/earnings", { params });
      setItems(Array.isArray(response.data?.items) ? response.data.items : []);
      setTotal(Number(response.data?.total || 0));
      setSummary(response.data?.summary || EMPTY_SUMMARY);
      setExpandedId(null);
    } catch (caught: any) {
      setItems([]);
      setTotal(0);
      setSummary(EMPTY_SUMMARY);
      setError(caught?.response?.data?.error || caught?.message || "Failed to load owner earnings");
    } finally {
      setLoading(false);
    }
  }, [filter, ownerId, page, pageSize, search]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [filter, ownerId, search]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageReviewSummary = useMemo(() => {
    const ratings = items.map((item) => item.guestReview?.rating).filter((rating): rating is number => typeof rating === "number");
    return ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null;
  }, [items]);

  const money = (value: number | null | undefined, currency = "TZS") =>
    value == null ? "—" : `${currency} ${Math.round(Number(value)).toLocaleString("en-US")}`;
  const formatDate = (value: string | null) =>
    value ? new Date(value).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";

  return (
    <div className="mx-auto box-border w-full max-w-full min-w-0 space-y-4 overflow-x-clip px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 lg:px-6 xl:px-8">
      <div className="relative overflow-hidden rounded-2xl shadow-2xl" style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)" }}>
        <div className="relative z-10 flex flex-col items-center px-5 py-8 text-center sm:px-8 sm:py-10">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-white/10 shadow-[0_0_0_7px_rgba(255,255,255,0.05)]">
            <Wallet className="h-6 w-6 text-white/90" aria-hidden />
          </div>
          <div className="text-xs text-white/65">Owner earnings · Group stays</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">Owner earnings</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/65 sm:text-base">
            Confirmed group stays, NoLSAF deposit commission, and the balance each owner collects at the property.
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0a1a19] shadow-[0_8px_32px_rgba(0,0,0,0.25)]">
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" aria-hidden />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { setSearch(searchInput.trim()); setPage(1); } }}
              placeholder="Search owner, booking, property, phone, or destination"
              className="box-border w-full rounded-lg border border-white/15 bg-white/[0.07] py-2.5 pl-9 pr-3 text-sm text-white outline-none placeholder:text-white/40 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <select value={ownerId} onChange={(event) => { setOwnerId(event.target.value); setPage(1); }} className="h-9 min-w-[210px] rounded-full border border-white/15 bg-white/[0.07] px-3 text-sm text-white outline-none">
                <option value="" className="bg-[#0d2320]">All owners</option>
                {owners.map((owner) => <option key={owner.id} value={owner.id} className="bg-[#0d2320]">{owner.name} ({owner.count})</option>)}
              </select>
              {([['CHECKED_IN', 'Checked in'], ['ALL', 'All confirmed']] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => { setFilter(key); setPage(1); }} className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${filter === key ? "border-emerald-400/60 bg-emerald-400/20 text-emerald-200" : "border-white/15 bg-white/[0.06] text-white/65 hover:bg-white/10"}`}>
                  {label}
                </button>
              ))}
              {search && <button type="button" onClick={() => { setSearchInput(""); setSearch(""); setPage(1); }} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/10">Clear search</button>}
            </div>
            <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/[0.07] px-3 text-xs font-semibold text-white/75 hover:bg-white/10">
              <RefreshIcon loading={loading} /> Refresh
            </button>
          </div>
          <p className="text-[11px] text-white/40">One row per group-stay booking. Filter by owner to reconcile all of that owner&apos;s records.</p>
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

      {!loading && total > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          <SummaryCard label="Group stays" value={String(summary.bookingCount || total)} />
          <SummaryCard label="Booking total" value={money(summary.totalAmount)} />
          <SummaryCard label="NoLSAF commission" value={money(summary.commissionAmount)} />
          <SummaryCard label="Owners collect" value={money(summary.ownerCollects)} highlight />
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[35vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-emerald-600" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center shadow-sm"><Wallet className="mx-auto mb-4 h-12 w-12 text-gray-300" /><p className="text-gray-600">{ownerId ? "No group stays match this owner." : filter === "CHECKED_IN" ? "No checked-in group stays yet." : "No confirmed group stays yet."}</p></div>
      ) : (
        <section className="w-full max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4 sm:px-5">
            <div><h2 className="text-sm font-semibold text-slate-900">Owner earnings records</h2><p className="text-xs text-slate-500">Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</p></div>
            {pageReviewSummary != null && <span className="text-xs font-semibold text-amber-600">Page rating {pageReviewSummary.toFixed(1)} ★</span>}
          </div>
          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain [scrollbar-gutter:stable]">
            <table className="w-full min-w-[1180px] table-fixed text-xs">
              <thead><tr className="whitespace-nowrap border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600"><th className="w-[17%] px-3 py-3 text-left">Owner</th><th className="w-[13%] px-3 py-3 text-left">Group stay</th><th className="w-[16%] px-3 py-3 text-left">Property / location</th><th className="w-[12%] px-3 py-3 text-left">Stay</th><th className="w-[10%] px-3 py-3 text-left">Status</th><th className="w-[11%] px-3 py-3 text-right">Booking total</th><th className="w-[11%] px-3 py-3 text-right">Commission</th><th className="w-[11%] px-3 py-3 text-right">Owner collects</th><th className="w-[9%] px-3 py-3 text-right">Open</th></tr></thead>
              <tbody>
                {items.map((earning) => {
                  const expanded = expandedId === earning.id;
                  return (
                    <Fragment key={earning.id}>
                      <tr key={earning.id} className="border-b border-slate-100 align-top transition hover:bg-slate-50">
                        <td className="px-3 py-3"><button type="button" onClick={() => { setOwnerId(String(earning.assignedOwner?.id || "")); setPage(1); }} className="max-w-full truncate text-left font-semibold text-slate-900 hover:text-emerald-700 hover:underline">{earning.assignedOwner?.name || "Unassigned"}</button><div className="mt-1 truncate text-[11px] text-slate-500">{earning.assignedOwner?.phone || earning.assignedOwner?.email || "No contact"}</div></td>
                        <td className="px-3 py-3 font-semibold text-slate-900">#{earning.id}<div className="mt-1 text-[11px] font-normal text-slate-500">Group stay booking</div></td>
                        <td className="px-3 py-3 text-slate-700"><div className="truncate">{earning.confirmedProperty?.title || "Property pending"}</div><div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"><MapPin className="h-3 w-3" />{[earning.toDistrict, earning.toRegion].filter(Boolean).join(", ") || "—"}</div></td>
                        <td className="px-3 py-3 text-slate-700"><div className="flex items-center gap-1"><Calendar className="h-3 w-3 text-slate-400" />{formatDate(earning.checkIn)}</div><div className="mt-1 text-[11px] text-slate-500">to {formatDate(earning.checkOut)}</div></td>
                        <td className="px-3 py-3"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${earning.checkedInAt ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{earning.checkedInAt ? <CheckCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}{earning.checkedInAt ? "Checked in" : "Confirmed"}</span></td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-800">{money(earning.totalAmount, earning.currency)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-slate-700">{money(earning.commissionAmount, earning.currency)}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-emerald-700">{money(earning.ownerCollects, earning.currency)}</td>
                        <td className="px-3 py-3 text-right"><div className="inline-flex items-center gap-1"><button type="button" onClick={() => setExpandedId(expanded ? null : earning.id)} className="rounded-md border border-slate-300 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50">{expanded ? "Hide" : "Details"}</button><Link href={`/admin/group-stays/bookings?id=${earning.id}`} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label={`Open group stay ${earning.id}`}><ExternalLink className="h-4 w-4" /></Link></div></td>
                      </tr>
                      {expanded && <tr key={`${earning.id}-details`} className="border-b border-slate-200 bg-slate-50"><td colSpan={9} className="px-4 py-4"><div className="grid gap-3 md:grid-cols-3"><div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Owner contact</div><div className="mt-1 text-sm text-slate-800">{earning.assignedOwner?.email || "No email"}</div></div><div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Financial rule</div><div className="mt-1 text-sm text-slate-800">NoLSAF keeps the deposit; owner collects the balance at the property.</div></div><div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Guest review</div><div className="mt-1 text-sm text-slate-800">{earning.guestReview ? `${earning.guestReview.rating}/5${earning.guestReview.title ? ` · ${earning.guestReview.title}` : ""}` : "No review recorded"}</div>{earning.guestReview?.comment && <p className="mt-1 text-xs text-slate-600">{earning.guestReview.comment}</p>}{earning.guestReview?.ownerResponse && <p className="mt-1 flex items-start gap-1 text-xs text-slate-600"><MessageSquare className="mt-0.5 h-3 w-3 text-emerald-600" />{earning.guestReview.ownerResponse}</p>}</div></div></td></tr>}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-600"><span>Page {page} of {totalPages}</span><div className="flex items-center gap-2"><button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Prev</button><button type="button" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages} className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 hover:bg-slate-50 disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" /></button></div></div>
        </section>
      )}
    </div>
  );
}

function RefreshIcon({ loading }: { loading: boolean }) {
  return <svg className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M20 11a8.1 8.1 0 0 0-14.8-4L3 10" /><path d="M3 4v6h6" /><path d="M4 13a8.1 8.1 0 0 0 14.8 4L21 14" /><path d="M21 20v-6h-6" /></svg>;
}

function SummaryCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return <div className={`rounded-xl border p-4 shadow-sm ${highlight ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}><p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p><p className={`mt-1 text-lg font-bold ${highlight ? "text-emerald-700" : "text-slate-900"}`}>{value}</p></div>;
}

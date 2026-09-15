"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import TablePagination from "@/components/TablePagination";
import {
  AlertCircle,
  Building2,
  CheckCircle,
  ChevronDown,
  Clock,
  Coins,
  ExternalLink,
  HandCoins,
  Info,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  RefreshCw,
  Search,
  Star,
  TrendingUp,
  Wallet,
  X,
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

function tidyName(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// "dar-es-salaam" -> "Dar es Salaam"; keeps known abbreviations only.
function formatPlaceName(value: string | null | undefined) {
  return String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i > 0 && ["es", "la", "wa", "na", "ya"].includes(word.toLowerCase())) return word.toLowerCase();
      if (["CBD", "UDSM", "JNIA", "KIA"].includes(word.toUpperCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

const gsRef = (id: number) => `GS-${String(id).padStart(4, "0")}`;

function fmtDay(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function nightsBetween(a: string | null, b: string | null) {
  if (!a || !b) return null;
  const n = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function initials(name: string | null | undefined) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.charAt(0) || "") + (parts[1]?.charAt(0) || "")).toUpperCase() || "?";
}

// Where the group is in its stay today, so admins can see who is in-house right now.
function stayProgress(e: { checkIn: string | null; checkOut: string | null; checkedInAt: string | null }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = e.checkIn ? new Date(e.checkIn) : null;
  const end = e.checkOut ? new Date(e.checkOut) : null;
  if (start) start.setHours(0, 0, 0, 0);
  if (end) end.setHours(0, 0, 0, 0);
  const total = start && end ? Math.max(Math.round((end.getTime() - start.getTime()) / 86400000), 1) : null;
  if (end && today >= end) return { label: "Stay ended", pct: 100, bar: "bg-neutral-400", text: "text-neutral-500" };
  if (start && today >= start && total) {
    const day = Math.min(Math.round((today.getTime() - start.getTime()) / 86400000) + 1, total);
    return { label: `In stay · night ${day} of ${total}`, pct: Math.round((day / total) * 100), bar: "bg-blue-600", text: "text-blue-700" };
  }
  if (start) {
    const days = Math.round((start.getTime() - today.getTime()) / 86400000);
    return { label: days === 1 ? "Arrives tomorrow" : `Arrives in ${days} days`, pct: 0, bar: "bg-green-600", text: e.checkedInAt ? "text-blue-700" : "text-green-700" };
  }
  return { label: "Dates not set", pct: 0, bar: "bg-neutral-300", text: "text-neutral-400" };
}

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

  // Search as you type, with a short pause so every keystroke is not a request.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

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

  const pageRating = useMemo(() => {
    const ratings = items.map((item) => item.guestReview?.rating).filter((rating): rating is number => typeof rating === "number");
    return ratings.length ? { avg: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length, count: ratings.length } : null;
  }, [items]);

  const money = (value: number | null | undefined, currency = "TZS") =>
    value == null ? "Not set" : `${currency} ${Math.round(Number(value)).toLocaleString("en-US")}`;

  const selectedOwner = owners.find((o) => String(o.id) === ownerId) || null;
  const commissionShare = summary.totalAmount > 0 ? Math.round((summary.commissionAmount / summary.totalAmount) * 100) : 0;
  const hasFilters = Boolean(ownerId || search);

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-100 sm:h-12 sm:w-12">
            <Wallet className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold tracking-tight text-neutral-900 sm:text-xl">Owner earnings</h1>
            <p className="m-0 mt-0.5 text-xs text-neutral-500 sm:text-sm">Confirmed group stays, NoLSAF deposit commission and the balance each owner collects</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
          <Link
            href="/admin/group-stays/revenue"
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:no-underline"
          >
            <TrendingUp className="h-3.5 w-3.5 text-emerald-600" /> Revenue
          </Link>
        </div>
      </div>

      {/* Summary strip */}
      {(() => {
        const tiles = [
          { icon: Building2, tone: "bg-neutral-100 text-neutral-600", label: filter === "CHECKED_IN" ? "Checked-in stays" : "Confirmed stays", value: (summary.bookingCount || total).toLocaleString(), sub: selectedOwner ? tidyName(selectedOwner.name) : "All owners" },
          { icon: Coins, tone: "bg-blue-50 text-blue-700", label: "Booking total", value: money(summary.totalAmount), sub: "What guests pay in full" },
          { icon: TrendingUp, tone: "bg-emerald-50 text-emerald-700", label: "NoLSAF commission", value: money(summary.commissionAmount), sub: summary.totalAmount > 0 ? `${commissionShare}% of booking total, kept from deposit` : "Kept from the deposit" },
          { icon: HandCoins, tone: "bg-violet-50 text-violet-700", label: "Owners collect", value: money(summary.ownerCollects), sub: "Balance paid at the property" },
        ];
        return (
          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
            <div className="grid grid-cols-1 gap-px bg-neutral-100 sm:grid-cols-2 xl:grid-cols-4">
              {tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <div key={tile.label} className="flex min-w-0 items-center gap-3 bg-white px-4 py-3.5 sm:px-5">
                    <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${tile.tone}`}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 text-xs font-medium text-neutral-500">{tile.label}</p>
                      {loading && items.length === 0 ? (
                        <span className="mt-1 inline-block h-6 w-28 animate-pulse rounded bg-neutral-100" />
                      ) : (
                        <p className="m-0 truncate text-xl font-bold leading-tight tabular-nums text-neutral-900" title={tile.value}>{tile.value}</p>
                      )}
                      <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400" title={tile.sub}>{tile.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Split: where each shilling of the booking goes */}
      {summary.totalAmount > 0 && (
        <div className="rounded-xl border border-solid border-neutral-200 bg-white px-4 py-3.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="m-0 text-sm font-bold text-neutral-900">Booking split</h3>
            <span className="inline-flex items-center gap-1 text-xs text-neutral-400">
              <Info className="h-3.5 w-3.5" /> NoLSAF keeps the deposit; the owner collects the balance at the property
            </span>
          </div>
          <div className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            <div className="h-full bg-emerald-500" style={{ width: `${Math.max(commissionShare, 2)}%` }} title={`NoLSAF ${money(summary.commissionAmount)}`} />
            <div className="h-full bg-violet-500" style={{ width: `${Math.max(100 - commissionShare, 2)}%` }} title={`Owners ${money(summary.ownerCollects)}`} />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500">
            <span className="inline-flex items-center gap-1.5"><span className="h-1 w-3 rounded-full bg-emerald-500" /> NoLSAF {commissionShare}%</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-1 w-3 rounded-full bg-violet-500" /> Owners {100 - commissionShare}%</span>
          </div>
        </div>
      )}

      {/* Records: filters + table in one card */}
      <section className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <h3 className="m-0 text-sm font-bold text-neutral-900">Earnings records</h3>
          <span className="text-xs tabular-nums text-neutral-400">{loading ? "Loading…" : `${total.toLocaleString()} ${total === 1 ? "booking" : "bookings"}`}</span>
          {pageRating && (
            <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              <span className="font-semibold tabular-nums text-neutral-900">{pageRating.avg.toFixed(1)}</span>
              <span className="text-neutral-400">from {pageRating.count} {pageRating.count === 1 ? "review" : "reviews"} on this page</span>
            </span>
          )}
          {/* Status segmented control */}
          <div className="ml-auto inline-flex rounded-lg bg-neutral-100 p-0.5">
            {([["CHECKED_IN", "Checked in"], ["ALL", "All confirmed"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setFilter(key); setPage(1); }}
                aria-pressed={filter === key}
                className={`h-8 rounded-md border-0 px-3 text-xs font-semibold transition-colors ${filter === key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] sm:px-5">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") setSearch(searchInput.trim()); }}
              placeholder="Search owner, booking, property, phone or destination"
              className="h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => { setSearchInput(""); setSearch(""); }}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <select
              value={ownerId}
              onChange={(event) => { setOwnerId(event.target.value); setPage(1); }}
              aria-label="Filter by owner"
              className="h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/15"
            >
              <option value="">All owners</option>
              {owners.map((owner) => <option key={owner.id} value={owner.id}>{tidyName(owner.name)} ({owner.count})</option>)}
            </select>
            {hasFilters && (
              <button
                type="button"
                onClick={() => { setOwnerId(""); setSearchInput(""); setSearch(""); }}
                className="inline-flex h-9 flex-shrink-0 items-center gap-1 rounded-lg border-0 bg-transparent px-2 text-xs font-semibold text-neutral-600 transition-colors hover:bg-neutral-100"
              >
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>

        {error ? (
          <div className="flex items-center gap-3 border-0 border-t border-solid border-rose-100 bg-rose-50/60 px-4 py-3 sm:px-5">
            <AlertCircle className="h-5 w-5 flex-shrink-0 text-rose-600" />
            <p className="m-0 flex-1 text-sm text-rose-800">{error}</p>
            <button type="button" onClick={() => void load()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 hover:bg-rose-50">
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        ) : loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading earnings
          </div>
        ) : items.length === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
            <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
              <Wallet className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">
              {ownerId ? "No group stays for this owner" : filter === "CHECKED_IN" ? "No checked-in group stays yet" : "No confirmed group stays yet"}
            </p>
            <p className="m-0 mt-1 text-xs text-neutral-500">
              {filter === "CHECKED_IN" ? "Switch to All confirmed to see stays that have not checked in." : "Earnings appear once a group stay is confirmed."}
            </p>
          </div>
        ) : (
          <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
            {/* Phone: one compact card per booking */}
            <ul className="m-0 list-none p-0 md:hidden">
              {items.map((earning) => {
                const progress = stayProgress(earning);
                return (
                  <li key={earning.id} className="border-0 border-t border-solid border-neutral-100 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">{gsRef(earning.id)}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">{earning.assignedOwner ? tidyName(earning.assignedOwner.name) : "Unassigned"}</span>
                      <span className="flex-shrink-0 text-sm font-semibold tabular-nums text-violet-700">{money(earning.ownerCollects, earning.currency)}</span>
                    </div>
                    <p className="m-0 mt-1 truncate text-xs text-neutral-500">
                      {[earning.confirmedProperty ? tidyName(earning.confirmedProperty.title) : "Property pending", fmtDay(earning.checkIn)].filter(Boolean).join(" · ")}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between gap-3 text-xs">
                      <span className={progress.text}>{progress.label}</span>
                      <span className="tabular-nums text-neutral-400">NoLSAF {money(earning.commissionAmount, earning.currency)}</span>
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-neutral-100">
                      <div className={`h-full rounded-full ${progress.bar}`} style={{ width: `${progress.pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="hidden overflow-x-auto md:block">
              <table className="table w-full min-w-[1100px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold sm:pl-5">Booking</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Owner</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Property</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Stay</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 text-right font-bold">Booking total</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 text-right font-bold"><span className="normal-case">NoLSAF</span> commission</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 text-right font-bold">Owner collects</th>
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 sm:pr-5"><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((earning) => {
                    const expanded = expandedId === earning.id;
                    const nights = nightsBetween(earning.checkIn, earning.checkOut);
                    const place = [earning.toDistrict, earning.toRegion].filter(Boolean).map((v) => formatPlaceName(v)).join(", ");
                    const share = earning.totalAmount > 0 ? Math.round((earning.commissionAmount / earning.totalAmount) * 100) : null;
                    const progress = stayProgress(earning);
                    return (
                      <Fragment key={earning.id}>
                        <tr
                          onClick={() => setExpandedId(expanded ? null : earning.id)}
                          className={`cursor-pointer border-0 border-b border-solid border-neutral-100 transition-colors ${expanded ? "bg-neutral-50/70" : "hover:bg-neutral-50/70"}`}
                        >
                          <td className="px-4 py-3.5 sm:pl-5">
                            <span className="inline-block rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700">{gsRef(earning.id)}</span>
                            <div className={`mt-1 inline-flex items-center gap-1 text-xs ${earning.checkedInAt ? "text-blue-700" : "text-neutral-500"}`}>
                              {earning.checkedInAt ? <CheckCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                              {earning.checkedInAt ? `Checked in ${fmtDay(earning.checkedInAt) || ""}` : "Confirmed"}
                            </div>
                          </td>
                          <td className="px-4 py-3.5">
                            {earning.assignedOwner ? (
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-violet-50 text-[11px] font-semibold text-violet-700">
                                  {initials(tidyName(earning.assignedOwner.name))}
                                </span>
                                <div className="min-w-0">
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); setOwnerId(String(earning.assignedOwner!.id)); setPage(1); }}
                                    title="Show only this owner"
                                    className="block max-w-[11rem] truncate border-0 bg-transparent p-0 text-left text-sm text-neutral-800 hover:text-violet-700 hover:underline"
                                  >
                                    {tidyName(earning.assignedOwner.name)}
                                  </button>
                                  <div className="mt-0.5 max-w-[11rem] truncate text-xs text-neutral-400">{earning.assignedOwner.phone || earning.assignedOwner.email || "No contact"}</div>
                                </div>
                              </div>
                            ) : (
                              <span className="text-neutral-400">Unassigned</span>
                            )}
                          </td>
                          <td className="px-4 py-3.5">
                            <div className={`max-w-[13rem] truncate ${earning.confirmedProperty ? "text-neutral-800" : "text-neutral-400"}`}>{earning.confirmedProperty ? tidyName(earning.confirmedProperty.title) : "Property pending"}</div>
                            <div className="mt-0.5 max-w-[13rem] truncate text-xs text-neutral-400">{place || " "}</div>
                          </td>
                          <td className="px-4 py-3.5">
                            <div className="whitespace-nowrap text-neutral-800" title={nights ? `${nights} ${nights === 1 ? "night" : "nights"}` : undefined}>
                              {fmtDay(earning.checkIn) || <span className="text-neutral-400">Not set</span>}
                              {earning.checkOut ? <span className="text-neutral-400"> to {fmtDay(earning.checkOut)}</span> : null}
                            </div>
                            <div className={`mt-1 whitespace-nowrap text-xs ${progress.text}`}>{progress.label}</div>
                            <div className="mt-1 h-1 w-full max-w-[11rem] overflow-hidden rounded-full bg-neutral-100">
                              <div className={`h-full rounded-full ${progress.bar}`} style={{ width: `${progress.pct}%` }} />
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-right tabular-nums text-neutral-800">{money(earning.totalAmount, earning.currency)}</td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-right">
                            <div className="tabular-nums text-neutral-800">{money(earning.commissionAmount, earning.currency)}</div>
                            <div className="mt-0.5 text-xs text-neutral-400">{share != null ? `${share}% of total` : " "}</div>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-right font-semibold tabular-nums text-violet-700">{money(earning.ownerCollects, earning.currency)}</td>
                          <td className="px-4 py-3.5 text-right sm:pr-5">
                            <ChevronDown className={`ml-auto h-4 w-4 text-neutral-400 transition-transform ${expanded ? "rotate-180" : ""}`} aria-label={expanded ? "Hide details" : "Show details"} />
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-0 border-b border-solid border-neutral-100 bg-neutral-50/70">
                            <td colSpan={8} className="px-4 pb-4 pt-1 sm:px-5">
                              <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 md:grid-cols-3">
                                {/* Owner contact */}
                                <div className="min-w-0 bg-white px-4 py-3">
                                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Owner contact</p>
                                  <p className="m-0 mt-1.5 flex items-center gap-1.5 truncate text-sm text-neutral-800"><Mail className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />{earning.assignedOwner?.email || "No email"}</p>
                                  <p className="m-0 mt-1 flex items-center gap-1.5 truncate text-sm text-neutral-800"><Phone className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />{earning.assignedOwner?.phone || "No phone"}</p>
                                </div>
                                {/* Money breakdown */}
                                <div className="min-w-0 bg-white px-4 py-3">
                                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Money split</p>
                                  <dl className="m-0 mt-1.5 space-y-1 text-sm">
                                    <div className="flex justify-between gap-3"><dt className="text-neutral-500">Guest pays</dt><dd className="m-0 tabular-nums text-neutral-900">{money(earning.totalAmount, earning.currency)}</dd></div>
                                    <div className="flex justify-between gap-3"><dt className="text-neutral-500"><span>NoLSAF</span> keeps (deposit)</dt><dd className="m-0 tabular-nums text-emerald-700">{money(earning.commissionAmount, earning.currency)}</dd></div>
                                    <div className="flex justify-between gap-3 border-0 border-t border-solid border-neutral-100 pt-1"><dt className="text-neutral-500">Owner collects at property</dt><dd className="m-0 font-semibold tabular-nums text-violet-700">{money(earning.ownerCollects, earning.currency)}</dd></div>
                                  </dl>
                                </div>
                                {/* Guest review */}
                                <div className="min-w-0 bg-white px-4 py-3">
                                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Guest review</p>
                                  {earning.guestReview ? (
                                    <>
                                      <p className="m-0 mt-1.5 flex items-center gap-1.5 text-sm text-neutral-900">
                                        <span className="inline-flex items-center gap-0.5" aria-label={`${earning.guestReview.rating} out of 5`}>
                                          {[1, 2, 3, 4, 5].map((n) => (
                                            <Star key={n} className={`h-3.5 w-3.5 ${n <= Math.round(earning.guestReview!.rating) ? "fill-amber-400 text-amber-400" : "text-neutral-200"}`} />
                                          ))}
                                        </span>
                                        <span className="truncate">{earning.guestReview.title || `${earning.guestReview.rating}/5`}</span>
                                      </p>
                                      {earning.guestReview.comment && <p className="m-0 mt-1 line-clamp-3 text-xs text-neutral-600">{earning.guestReview.comment}</p>}
                                      {earning.guestReview.ownerResponse && (
                                        <p className="m-0 mt-1.5 flex items-start gap-1.5 rounded-md bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600">
                                          <MessageSquare className="mt-0.5 h-3 w-3 flex-shrink-0 text-violet-600" />
                                          <span className="line-clamp-3">{earning.guestReview.ownerResponse}</span>
                                        </p>
                                      )}
                                    </>
                                  ) : (
                                    <p className="m-0 mt-1.5 text-sm text-neutral-400">No review yet</p>
                                  )}
                                </div>
                              </div>
                              <div className="mt-2.5 flex justify-end">
                                <Link
                                  href={`/admin/group-stays/bookings?bookingId=${earning.id}`}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition-colors hover:bg-neutral-50 hover:no-underline"
                                >
                                  Open booking <ExternalLink className="h-3.5 w-3.5" />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}

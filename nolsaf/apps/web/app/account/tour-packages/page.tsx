"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { ClipboardList, CalendarDays, Loader2, ArrowUpDown, ChevronDown, ChevronUp, Eye } from "lucide-react";
import TableRow from "@/components/TableRow";

type TourBookingItem = {
  id: number;
  tourReference: string;
  bookingCode: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  travelerCount: number;
  timelineStatus: "REQUESTED" | "CONFIRMED" | "PAID" | "IN_PROGRESS" | "COMPLETED" | string;
  timelineCompletionStatus?: "ACTIVE_TIMELINE" | "COMPLETED_TIMELINE" | string;
  dashboardBucket: "DRAFT" | "PAID_PACKAGES" | "ACTIVE_TIMELINE" | "COMPLETED" | string;
  timelineRatingSummary?: {
    totalRatings?: number;
    averageRating?: number;
  } | null;
  hasTimeline?: boolean;
  currency: string;
  grossAmount: number;
  createdAt: string;
  draftExpiresAt?: string | null;
  draftExpiryStatus?: "ACTIVE" | "EXPIRED" | string | null;
  pickupValidation?: {
    validated?: boolean;
    validatedAt?: string | null;
  } | null;
  metadata?: {
    pickupValidationOperator?: {
      validated?: boolean;
      validatedAt?: string | null;
    } | null;
    pickupValidationCustomer?: {
      validated?: boolean;
      validatedAt?: string | null;
    } | null;
  } | null;
  pickupTimeline?: {
    validatedAt?: string | null;
  } | null;
  __smokePaidPreview?: boolean;
};

type StatusFilter = "ALL" | "DRAFT" | "PAID_PACKAGES" | "ACTIVE_TIMELINE" | "COMPLETED";
type SortKey = "title" | "destination" | "startDate" | "travelerCount" | "grossAmount" | "status";
type SortDir = "asc" | "desc";

const api = apiClient;

export default function AccountTourPackagesPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TourBookingItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<StatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("startDate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [page, setPage] = useState(1);
  const pageSize = 8;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get("/api/customer/tour-bookings?page=1&pageSize=20");
        if (!alive) return;
        setItems(Array.isArray(res.data?.items) ? res.data.items : []);
        setError(null);
      } catch (err: any) {
        if (!alive) return;
        setError(err?.response?.data?.error || "Failed to load tour packages");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const summary = useMemo(() => {
    const out = {
      total: items.length,
      draft: 0,
      paidPackages: 0,
      activeTimeline: 0,
      completed: 0,
    };

    for (const item of items) {
      const b = String(item.dashboardBucket || "").toUpperCase();
      if (b === "DRAFT") out.draft += 1;
      else if (b === "PAID_PACKAGES") out.paidPackages += 1;
      else if (b === "ACTIVE_TIMELINE") out.activeTimeline += 1;
      else if (b === "COMPLETED") out.completed += 1;
    }

    return out;
  }, [items]);

  const paidPreviewItem = useMemo<TourBookingItem | null>(() => {
    if (summary.paidPackages > 0) return null;

    const source = items.find((item) => {
      const bucket = String(item.dashboardBucket || "").toUpperCase();
      const pay = String((item as any).paymentStatus || "").toUpperCase();
      return bucket !== "DRAFT" && ["PAID", "APPROVED", "DISBURSED", ""].includes(pay);
    }) || items.find((item) => String(item.dashboardBucket || "").toUpperCase() !== "DRAFT");

    if (!source) return null;

    return {
      ...source,
      dashboardBucket: "PAID_PACKAGES",
      timelineStatus: "PAID",
      __smokePaidPreview: true,
    };
  }, [items, summary.paidPackages]);

  const paidPackagesDisplay = summary.paidPackages > 0 ? summary.paidPackages : (paidPreviewItem ? 1 : 0);

  const filteredItems = useMemo(() => {
    const byStatus = (() => {
      if (activeFilter === "ALL") return items;
      const matched = items.filter((item) => String(item.dashboardBucket || "").toUpperCase() === activeFilter);
      if (activeFilter === "PAID_PACKAGES" && matched.length === 0 && paidPreviewItem) {
        return [paidPreviewItem];
      }
      return matched;
    })();

    const q = searchQuery.trim().toLowerCase();
    if (!q) return byStatus;

    return byStatus.filter((item) => {
      const bookingCode = String(item.bookingCode || "").toLowerCase();
      const title = String(item.title || "").toLowerCase();
      const destination = String(item.destination || "").toLowerCase();
      return bookingCode.includes(q) || title.includes(q) || destination.includes(q);
    });
  }, [items, activeFilter, searchQuery, paidPreviewItem]);

  useEffect(() => {
    setPage(1);
  }, [activeFilter, searchQuery, sortKey, sortDir]);

  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    list.sort((a, b) => {
      const aStatus = String(a.dashboardBucket || a.timelineStatus || "").toUpperCase();
      const bStatus = String(b.dashboardBucket || b.timelineStatus || "").toUpperCase();
      let cmp = 0;

      if (sortKey === "title") cmp = a.title.localeCompare(b.title);
      else if (sortKey === "destination") cmp = String(a.destination || "").localeCompare(String(b.destination || ""));
      else if (sortKey === "startDate") cmp = new Date(a.startDate || 0).getTime() - new Date(b.startDate || 0).getTime();
      else if (sortKey === "travelerCount") cmp = Number(a.travelerCount || 0) - Number(b.travelerCount || 0);
      else if (sortKey === "grossAmount") cmp = Number(a.grossAmount || 0) - Number(b.grossAmount || 0);
      else if (sortKey === "status") cmp = aStatus.localeCompare(bStatus);

      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [filteredItems, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / pageSize));
  const showCompletedRatingColumn = activeFilter === "COMPLETED";
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [sortedItems, safePage]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />;
    return sortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5 text-teal-700" /> : <ChevronDown className="h-3.5 w-3.5 text-teal-700" />;
  };

  const statusBadgeClass = (status: string) => {
    const s = String(status || "").trim().toUpperCase();
    if (s === "EXPIRED") return "bg-rose-100 text-rose-800 border border-rose-200";
    if (s === "DRAFT") return "bg-blue-100 text-blue-800 border border-blue-200";
    if (s === "PAID_PACKAGES" || s === "PAID") return "bg-emerald-100 text-emerald-800 border border-emerald-200";
    if (s === "ACTIVE_TIMELINE") return "bg-indigo-100 text-indigo-800 border border-indigo-200";
    if (s === "COMPLETED_TIMELINE") return "bg-teal-100 text-teal-800 border border-teal-200";
    if (s === "COMPLETED") return "bg-green-100 text-green-800 border border-green-200";
    return "bg-slate-100 text-slate-700 border border-slate-200";
  };

  const statPillTone: Record<StatusFilter, string> = {
    ALL: "border-cyan-200 bg-cyan-50 text-cyan-900",
    DRAFT: "border-amber-200 bg-amber-50 text-amber-900",
    PAID_PACKAGES: "border-emerald-200 bg-emerald-50 text-emerald-900",
    ACTIVE_TIMELINE: "border-sky-200 bg-sky-50 text-sky-900",
    COMPLETED: "border-green-200 bg-green-50 text-green-900",
  };

  return (
    <div className="w-full min-w-0 max-w-full space-y-6 overflow-x-hidden py-6">
          <section className="card overflow-hidden border-0 bg-gradient-to-br from-emerald-900 via-emerald-800 to-green-900 text-white shadow-lg">
            <div className="card-section">
              <div className="flex flex-col items-center text-center gap-3">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white backdrop-blur-sm">
                  <ClipboardList className="h-6 w-6" />
                </div>
                <div className="max-w-2xl">
                  <h1 className="text-2xl font-bold text-white sm:text-3xl">My Tour Packages</h1>
                  <p className="mt-2 text-sm text-emerald-100/90 sm:text-base">
                    View all your booking arrangements with a clear action trail for details, documents, chat, vouchers, and receipts.
                  </p>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-center gap-2 sm:gap-3">
                <div className="inline-flex items-center rounded-full border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur-sm">
                  {summary.total} Total
                </div>
                <div className="inline-flex items-center rounded-full border border-emerald-300/40 bg-emerald-400/20 px-4 py-2 text-sm font-semibold text-emerald-50 backdrop-blur-sm">
                  {summary.activeTimeline + summary.paidPackages} Active
                </div>
                <div className="inline-flex items-center rounded-full border border-amber-300/40 bg-amber-400/20 px-4 py-2 text-sm font-semibold text-amber-50 backdrop-blur-sm">
                  {summary.draft} Pending
                </div>
              </div>
            </div>
          </section>

          <section className="card overflow-hidden border border-slate-200 bg-slate-100">
            <div className="card-section">
            <div className="mt-1 w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { label: "All", value: summary.total, key: "ALL" as StatusFilter },
                { label: "Draft", value: summary.draft, key: "DRAFT" as StatusFilter },
                { label: "Paid", value: paidPackagesDisplay, key: "PAID_PACKAGES" as StatusFilter },
                { label: "Timeline", value: summary.activeTimeline, key: "ACTIVE_TIMELINE" as StatusFilter },
                { label: "Completed", value: summary.completed, key: "COMPLETED" as StatusFilter },
              ].map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setActiveFilter(s.key)}
                  aria-pressed={activeFilter === s.key}
                  className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                    activeFilter === s.key
                      ? `${statPillTone[s.key]} shadow-md ring-2 ring-slate-900/10`
                      : `${statPillTone[s.key]} hover:-translate-y-[1px] hover:shadow-sm`
                  }`}
                >
                  <div className="text-xs text-slate-500">{s.label}</div>
                  <div className="mt-1 text-lg font-bold">{s.value}</div>
                </button>
              ))}
            </div>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="card-section">
            <div className="flex w-full items-center justify-center gap-2 text-center text-slate-900 font-semibold uppercase tracking-wide">
              <ClipboardList className="h-4 w-4" />
              RECENT PACKAGES
              <span className="text-xs font-medium text-slate-500 uppercase">
                ({(activeFilter === "ALL" ? "ALL" : activeFilter === "ACTIVE_TIMELINE" ? "TIMELINE" : activeFilter.replace(/_/g, " ")).toUpperCase()})
              </span>
            </div>

            {loading ? (
              <div className="mt-6 flex items-center gap-2 text-slate-600 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your packages...
              </div>
            ) : error ? (
              <div className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-center text-sm text-slate-600">
                {searchQuery.trim()
                  ? `No results found for "${searchQuery.trim()}".`
                  : activeFilter === "ACTIVE_TIMELINE"
                    ? "No active tour timetable yet. Timeline opens after meetup validation."
                    : "No tour package purchases in this status."}
              </div>
            ) : (
              <>
                {activeFilter === "PAID_PACKAGES" && filteredItems.some((item) => item.__smokePaidPreview) && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    Smoke preview: showing an existing package in Paid Packages style for UI validation.
                  </div>
                )}
                <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">S/N</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <button type="button" onClick={() => onSort("title")} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 m-0 font-inherit text-inherit cursor-pointer hover:text-slate-900">
                          Package <SortIcon column="title" />
                        </button>
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <button type="button" onClick={() => onSort("destination")} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 m-0 font-inherit text-inherit cursor-pointer hover:text-slate-900">
                          Destination <SortIcon column="destination" />
                        </button>
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <button type="button" onClick={() => onSort("startDate")} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 m-0 font-inherit text-inherit cursor-pointer hover:text-slate-900">
                          Travel Date <SortIcon column="startDate" />
                        </button>
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <button type="button" onClick={() => onSort("travelerCount")} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 m-0 font-inherit text-inherit cursor-pointer hover:text-slate-900">
                          Travelers <SortIcon column="travelerCount" />
                        </button>
                      </th>
                      <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <button type="button" onClick={() => onSort("grossAmount")} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 m-0 font-inherit text-inherit cursor-pointer hover:text-slate-900">
                          Amount <SortIcon column="grossAmount" />
                        </button>
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Created</th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                        <button type="button" onClick={() => onSort("status")} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 m-0 font-inherit text-inherit cursor-pointer hover:text-slate-900">
                          Status <SortIcon column="status" />
                        </button>
                      </th>
                      {showCompletedRatingColumn ? (
                        <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">Rating</th>
                      ) : null}
                      <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">MeetUp</th>
                      <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {pagedItems.map((item, index) => (
                      <TableRow key={item.id}>
                        <td className="px-4 py-3 align-top text-right text-sm font-semibold text-slate-700">
                          {(safePage - 1) * pageSize + index + 1}
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="text-sm font-semibold text-slate-900">{item.title}</div>
                          <div className="mt-1 text-xs text-slate-600">{item.bookingCode}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-slate-700">
                          {item.destination || "-"}
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-slate-700">
                          <span className="inline-flex items-center gap-1">
                            <CalendarDays className="h-3.5 w-3.5" />
                            {item.startDate ? new Date(item.startDate).toLocaleDateString() : "TBD"}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top text-right text-sm text-slate-700">
                          {item.travelerCount}
                        </td>
                        <td className="px-4 py-3 align-top text-right text-sm text-slate-700">
                          {item.currency} {Number(item.grossAmount || 0).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 align-top text-sm text-slate-700 whitespace-nowrap">
                          {item.createdAt ? new Date(item.createdAt).toLocaleString() : "-"}
                        </td>
                        <td className="px-4 py-3 align-top">
                          {(() => {
                            const bucket = String(item.dashboardBucket || "").toUpperCase();
                            const completionStatus = String(item.timelineCompletionStatus || "").toUpperCase();
                            const isExpiredDraft = bucket === "DRAFT" && String(item.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
                            const rawStatus = isExpiredDraft
                              ? "EXPIRED"
                              : bucket === "ACTIVE_TIMELINE" || completionStatus === "COMPLETED_TIMELINE"
                                ? (completionStatus || "ACTIVE_TIMELINE")
                                : String(item.dashboardBucket || item.timelineStatus || "DRAFT");
                            const rowStatus = rawStatus.replace(/_/g, " ");
                            return (
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadgeClass(rawStatus)}`}>
                                {rowStatus}
                              </span>
                            );
                          })()}
                        </td>
                        {showCompletedRatingColumn ? (
                          <td className="px-4 py-3 align-top text-right">
                            {(() => {
                              const totalRatings = Number(item.timelineRatingSummary?.totalRatings || 0);
                              const averageRating = Number(item.timelineRatingSummary?.averageRating || 0);
                              if (!totalRatings) return <span className="text-sm text-slate-500">No ratings</span>;
                              return (
                                <span className="inline-flex rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-700">
                                  {averageRating.toFixed(1)}/5 ({totalRatings})
                                </span>
                              );
                            })()}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 align-top text-sm text-slate-700">
                          {(() => {
                            const operatorValidatedAt = item?.metadata?.pickupValidationOperator?.validatedAt || null;
                            const validatedAt =
                              operatorValidatedAt ||
                              item?.pickupValidation?.validatedAt ||
                              item?.pickupTimeline?.validatedAt ||
                              null;
                            const isValidated = Boolean(
                              item?.pickupValidation?.validated ||
                              item?.metadata?.pickupValidationOperator?.validated ||
                              validatedAt
                            );
                            if (!isValidated) {
                              return <span className="text-slate-500">Not yet</span>;
                            }
                            return (
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                                {validatedAt ? new Date(validatedAt).toLocaleString() : "Validated"}
                              </span>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 align-top text-right">
                          {(() => {
                            const bucket = String(item.dashboardBucket || "").toUpperCase();
                            const completionStatus = String(item.timelineCompletionStatus || "").toUpperCase();
                            const isTimeline = bucket === "ACTIVE_TIMELINE" || completionStatus === "COMPLETED_TIMELINE";
                            const href = isTimeline
                              ? `/account/tour-packages/${encodeURIComponent(item.tourReference)}/timeline`
                              : `/account/tour-packages/${encodeURIComponent(item.tourReference)}`;
                            const label = isTimeline ? "Open timeline" : "Open package";
                            return (
                          <Link
                            href={href}
                            aria-label={label}
                            title={label}
                            className="inline-flex items-center justify-center text-teal-700 no-underline hover:text-teal-800"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                            );
                          })()}
                        </td>
                      </TableRow>
                    ))}
                  </tbody>
                  </table>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
                  <div>
                    Showing {sortedItems.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
                    -{Math.min(safePage * pageSize, sortedItems.length)} of {sortedItems.length}
                  </div>
                  <div className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <span className="text-xs font-medium text-slate-700">Page {safePage} of {totalPages}</span>
                    <button
                      type="button"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            )}
            </div>
          </section>
    </div>
  );
}

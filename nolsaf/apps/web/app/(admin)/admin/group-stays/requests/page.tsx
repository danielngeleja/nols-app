"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { AlertCircle, Search, X, Calendar, MapPin, Clock, User, UsersRound, TrendingUp, Loader2, Truck, Bus, Coffee, Wrench, Mail, Phone } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import Chart from "@/components/Chart";
import type { ChartData } from "chart.js";
import TablePagination from "@/components/TablePagination";
import Link from "next/link";

// Use same-origin for HTTP calls so Next.js rewrites (/api/*) proxy to the API
const api = apiClient;
function authify() {}

function humanizeGroupLabel(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

// "dar-es-salaam" -> "Dar es Salaam", "PANGANI" -> "Pangani", "CBD" stays "CBD".
function formatPlaceName(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word, i) => {
      if (i > 0 && ["es", "la", "wa", "na", "ya"].includes(word.toLowerCase())) return word.toLowerCase();
      // Keep real abbreviations only; "DAR" in "DAR es Salaam" is a word, not one.
      if (["CBD", "UDSM", "JNIA", "KIA"].includes(word.toUpperCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

type RequestRow = {
  id: number;
  groupType: string;
  accommodationType: string;
  headcount: number;
  roomsNeeded: number;
  toRegion: string;
  toDistrict: string | null;
  toLocation: string | null;
  checkIn: string | null;
  checkOut: string | null;
  createdAt: string;
  user: { id: number; name: string; email: string; phone: string | null } | null;
  arrPickup: boolean;
  arrTransport: boolean;
  arrMeals: boolean;
  arrGuide: boolean;
  arrEquipment: boolean;
  pickupLocation: string | null;
  pickupTime: string | null;
  arrangementNotes: string | null;
};

type RequestStats = {
  totalPending: number;
  groupTypeStats: Record<string, number>;
  regionStats: Record<string, number>;
  accommodationStats: Record<string, number>;
  dateStats: Array<{ date: string; count: number }>;
  withArrangements: number;
};

export default function AdminGroupStaysRequestsPage() {
  const [groupType, setGroupType] = useState<string>("");
  const [date, setDate] = useState<string | string[]>("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<RequestRow | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pickerAnim, setPickerAnim] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Stats state
  const [stats, setStats] = useState<RequestStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize,
      };
      if (groupType) params.groupType = groupType;
      if (date) {
        if (Array.isArray(date)) {
          params.start = date[0];
          params.end = date[1];
        } else {
          params.date = date;
        }
      }
      if (q) params.q = q;

      // IMPORTANT: call via /api/* so we hit the API proxy, not the Next.js page route.
      const r = await api.get<{ items: RequestRow[]; total: number }>("/api/admin/group-stays/requests", { params });
      setList(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);
    } catch (err) {
      console.error("Failed to load requests", err);
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, groupType, date, q]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await api.get<RequestStats>("/api/admin/group-stays/requests/stats");
      setStats(r.data);
    } catch (err) {
      console.error("Failed to load request statistics", err);
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    authify();
    load();
    loadStats();
  }, [load, loadStats]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Prepare Date Trend Chart data
  const dateTrendChartData = useMemo<ChartData<"bar">>(() => {
    if (!stats || !stats.dateStats || stats.dateStats.length === 0) {
      return { labels: [], datasets: [] };
    }

    const labels = stats.dateStats.map((s) => {
      const d = new Date(s.date);
      return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    });

    return {
      labels,
      datasets: [
        {
          label: "New requests",
          data: stats.dateStats.map((s) => s.count),
          backgroundColor: "rgba(139, 92, 246, 0.75)",
          hoverBackgroundColor: "rgba(124, 58, 237, 1)",
          borderRadius: 3,
          maxBarThickness: 18,
        },
      ],
    };
  }, [stats]);

  function openReview(request: RequestRow) {
    setSelectedRequest(request);
    setShowReviewModal(true);
  }

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100 sm:h-12 sm:w-12">
            <AlertCircle className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold tracking-tight text-neutral-900 sm:text-xl">Pending Requests</h1>
            <p className="m-0 mt-0.5 text-xs text-neutral-500 sm:text-sm">Review and manage pending group stay requests</p>
          </div>
        </div>
        <Link
          href="/admin/group-stays"
          className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:no-underline sm:self-auto"
        >
          <TrendingUp className="h-3.5 w-3.5 text-amber-600" />
          Group Stays overview
        </Link>
      </div>

      {/* Summary strip: one card, four tiles. 1px gaps over a tinted grid draw the dividers. */}
      {stats && (() => {
        const topEntry = (record: Record<string, number>) =>
          Object.entries(record).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0] ?? null;
        const groupTypeCount = Object.values(stats.groupTypeStats).filter((n) => n > 0).length;
        const regionCount = Object.values(stats.regionStats).filter((n) => n > 0).length;
        const topType = topEntry(stats.groupTypeStats);
        const topRegion = topEntry(stats.regionStats);
        const arrangementShare = stats.totalPending > 0 ? Math.round((stats.withArrangements / stats.totalPending) * 100) : 0;
        const tiles = [
          { icon: AlertCircle, tone: "bg-amber-50 text-amber-600", label: "Awaiting review", value: stats.totalPending, sub: stats.totalPending === 1 ? "1 request to review" : `${stats.totalPending.toLocaleString()} requests to review` },
          { icon: UsersRound, tone: "bg-blue-50 text-blue-600", label: "With extra services", value: stats.withArrangements, sub: stats.totalPending > 0 ? `${arrangementShare}% of pending` : "No pending requests" },
          { icon: TrendingUp, tone: "bg-purple-50 text-purple-600", label: "Group types", value: groupTypeCount, sub: topType ? `Most: ${humanizeGroupLabel(topType[0])} (${topType[1]})` : "None yet" },
          { icon: MapPin, tone: "bg-emerald-50 text-emerald-600", label: "Regions", value: regionCount, sub: topRegion ? `Top: ${formatPlaceName(topRegion[0])} (${topRegion[1]})` : "None yet" },
        ];
        return (
          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
            <div className="grid grid-cols-1 gap-px bg-neutral-100 sm:grid-cols-2 lg:grid-cols-4">
              {tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <div key={tile.label} className="flex min-w-0 items-center gap-3 bg-white px-4 py-3.5 sm:px-5">
                    <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${tile.tone}`}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 text-xs font-medium text-neutral-500">{tile.label}</p>
                      <p className="m-0 text-xl font-bold leading-tight tabular-nums text-neutral-900">{tile.value.toLocaleString()}</p>
                      <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400" title={tile.sub}>{tile.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Breakdown: ranked share bars read better than charts for a handful of categories */}
      {stats && (() => {
        const ranked = (record: Record<string, number>, limit: number) =>
          Object.entries(record).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, limit);
        const panels = [
          { key: "types", icon: UsersRound, tone: "bg-purple-50 text-purple-600", bar: "bg-purple-500", title: "By group type", rows: ranked(stats.groupTypeStats, 6).map(([k, n]) => [humanizeGroupLabel(k), n] as const), empty: "No pending requests by type" },
          { key: "regions", icon: MapPin, tone: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-500", title: "Top regions", rows: ranked(stats.regionStats, 5).map(([k, n]) => [formatPlaceName(k), n] as const), empty: "No pending requests by region" },
        ];
        return (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {panels.map((panel) => {
              const Icon = panel.icon;
              const total = panel.rows.reduce((sum, [, n]) => sum + n, 0);
              return (
                <div key={panel.key} className="rounded-xl border border-solid border-neutral-200 bg-white">
                  <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
                    <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${panel.tone}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <h3 className="m-0 text-sm font-bold text-neutral-900">{panel.title}</h3>
                    <span className="ml-auto text-xs text-neutral-400">Pending only</span>
                  </div>
                  <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:px-5">
                    {statsLoading ? (
                      <div className="flex h-16 items-center justify-center">
                        <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
                      </div>
                    ) : panel.rows.length === 0 ? (
                      <p className="m-0 py-2 text-sm text-neutral-500">{panel.empty}</p>
                    ) : (
                      <ul className="m-0 list-none space-y-2.5 p-0">
                        {panel.rows.map(([label, n]) => {
                          const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                          return (
                            <li key={label}>
                              <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="truncate font-medium text-neutral-800">{label}</span>
                                <span className="flex-shrink-0 tabular-nums text-neutral-500">
                                  <span className="font-semibold text-neutral-900">{n}</span> · {pct}%
                                </span>
                              </div>
                              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                                <div className={`h-full rounded-full ${panel.bar}`} style={{ width: `${Math.max(pct, 4)}%` }} />
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Request trend (last 30 days) */}
      {stats && stats.dateStats && stats.dateStats.length > 0 && (() => {
        const newInWindow = stats.dateStats.reduce((sum, s) => sum + (s.count || 0), 0);
        const olderWaiting = Math.max(0, stats.totalPending - newInWindow);
        const busiest = stats.dateStats.reduce((best, s) => (s.count > (best?.count ?? 0) ? s : best), null as { date: string; count: number } | null);
        const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
        // Only trust the table for "oldest waiting" when it holds every pending request.
        const unfiltered = !groupType && !date && !q;
        const oldest = unfiltered && list.length > 0 && list.length >= stats.totalPending
          ? list.reduce((min, r) => (new Date(r.createdAt) < new Date(min.createdAt) ? r : min), list[0])
          : null;

        return (
          <div className="rounded-xl border border-solid border-neutral-200 bg-white">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-5">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-purple-50 text-purple-600">
                <TrendingUp className="h-3.5 w-3.5" />
              </span>
              <h3 className="m-0 text-sm font-bold text-neutral-900">New requests</h3>
              <span className="text-xs text-neutral-400">Last 30 days</span>
              {!statsLoading && newInWindow > 0 && (
                <span className="ml-auto rounded-full bg-purple-50 px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-purple-700">
                  {newInWindow} new{busiest ? ` · busiest ${fmtDay(busiest.date)} (${busiest.count})` : ""}
                </span>
              )}
            </div>

            {statsLoading ? (
              <div className="flex h-24 items-center justify-center border-0 border-t border-solid border-neutral-100">
                <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
              </div>
            ) : newInWindow === 0 ? (
              // Nothing to plot: say so in one line instead of drawing a flat line at zero.
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-0 border-t border-solid border-neutral-100 px-4 py-3 text-sm sm:px-5">
                <span className="font-semibold text-neutral-700">No new requests in the last 30 days.</span>
                {olderWaiting > 0 && (
                  <span className="text-neutral-500">
                    {olderWaiting} older {olderWaiting === 1 ? "request is" : "requests are"} still waiting
                    {oldest ? `, the oldest from ${new Date(oldest.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}.
                  </span>
                )}
              </div>
            ) : (
              <div className="h-40 w-full border-0 border-t border-solid border-neutral-100 px-3 pb-2 pt-3 sm:px-4">
                <Chart
                  type="bar"
                  data={dateTrendChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          label: (context: any) => {
                            const value = context.parsed.y || 0;
                            return `${value} new ${value === 1 ? "request" : "requests"}`;
                          },
                        },
                      },
                    },
                    scales: {
                      y: {
                        beginAtZero: true,
                        ticks: { stepSize: 1, precision: 0, font: { size: 10 }, color: "#a3a3a3" },
                        grid: { color: "rgba(0, 0, 0, 0.05)" },
                        border: { display: false },
                      },
                      x: {
                        grid: { display: false },
                        border: { display: false },
                        ticks: {
                          font: { size: 10 },
                          color: "#a3a3a3",
                          maxRotation: 0,
                          autoSkip: false,
                          // One label a week keeps the axis readable without tilting.
                          callback: (_value: any, index: number) => (index % 7 === 0 || index === stats.dateStats.length - 1 ? dateTrendChartData.labels?.[index] as string : ""),
                        },
                      },
                    },
                  } as any}
                />
              </div>
            )}
          </div>
        );
      })()}

      {/* Search and Filters */}
      <div className="box-border overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5">
          <div className="relative w-full min-w-0 sm:flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              ref={searchRef}
              type="text"
              className="box-border h-10 w-full rounded-lg border border-solid border-neutral-200 bg-neutral-50/60 pl-10 pr-10 font-[inherit] text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
              placeholder="Search requests"
              aria-label="Search requests"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setPage(1);
                  load();
                }
              }}
            />
            {q && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setPage(1);
                  load();
                }}
                className="absolute right-2.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Date Picker */}
          <div className="relative w-full sm:w-auto sm:flex-shrink-0">
            {(() => {
              const dateCount = Array.isArray(date) ? date.filter(Boolean).length : date ? 1 : 0;
              return (
                <button
                  type="button"
                  onClick={() => {
                    setPickerAnim(true);
                    setTimeout(() => setPickerAnim(false), 350);
                    setPickerOpen((v) => !v);
                  }}
                  className={`box-border inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-solid px-3.5 text-sm font-medium transition-all sm:w-auto ${
                    dateCount > 0 ? "border-amber-300 bg-amber-50 text-amber-800" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50"
                  } ${pickerAnim ? "ring-4 ring-amber-100" : ""}`}
                >
                  <Calendar className="h-4 w-4" />
                  <span>{dateCount === 0 ? "Any date" : dateCount === 1 ? "1 date" : `${dateCount} dates`}</span>
                </button>
              );
            })()}
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                <div className="fixed z-50 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
                  <DatePicker
                    selected={date || undefined}
                    onSelectAction={(s) => {
                      setDate(s as string | string[]);
                      setPage(1);
                    }}
                    onCloseAction={() => setPickerOpen(false)}
                  />
                </div>
              </>
            )}
          </div>
        </div>

        {/* Group Type Filters */}
        <div className="flex items-center gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/50 px-4 py-3 sm:px-5">
          <span className="flex-shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-neutral-400">Type</span>
          <div className="flex min-w-0 gap-1.5 overflow-x-auto scrollbar-hide">
            {[
              { label: "All types", value: "" },
              { label: "Family", value: "family" },
              { label: "Workers", value: "workers" },
              { label: "Event", value: "event" },
              { label: "Students", value: "students" },
              { label: "Team", value: "team" },
              { label: "Other", value: "other" },
            ].map((gt) => {
              const isActive = groupType === gt.value;
              const count = gt.value ? stats?.groupTypeStats?.[gt.value] : stats?.totalPending;
              return (
                <button
                  key={gt.value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => {
                    setGroupType(gt.value);
                    setPage(1);
                    setTimeout(() => load(), 0);
                  }}
                  className={`inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-solid px-3 py-1 text-xs font-semibold transition-colors ${
                    isActive ? "border-amber-600 bg-amber-600 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900"
                  }`}
                >
                  {gt.label}
                  {typeof count === "number" ? (
                    <span className={`tabular-nums ${isActive ? "text-amber-100" : "text-neutral-400"}`}>{count}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Requests Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <>
            {/* Skeleton Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead>
                  {/* Same header row as the NRMS reservations table. */}
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="whitespace-nowrap px-4 py-3">Request</th>
                    <th className="whitespace-nowrap px-4 py-3">Group</th>
                    <th className="whitespace-nowrap px-4 py-3">Customer</th>
                    <th className="whitespace-nowrap px-4 py-3">Destination</th>
                    <th className="whitespace-nowrap px-4 py-3">Check-in</th>
                    <th className="whitespace-nowrap px-4 py-3">Extra services</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      {[16, 24, 32, 28, 24, 24, 16].map((w, c) => (
                        <td key={c} className="border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <div className="h-3.5 rounded bg-neutral-200" style={{ width: `${w * 0.25}rem`, marginLeft: c === 6 ? "auto" : undefined }} />
                          {c > 0 && c < 5 ? <div className="mt-1.5 h-2.5 w-16 rounded bg-neutral-100" /> : null}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : list.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <AlertCircle className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No pending requests found.</p>
            <p className="text-xs text-gray-400 mt-1">All requests have been processed or try adjusting your filters.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table: follows the NRMS reservations table (two lines per cell at most) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
                <thead>
                  {/* Same header row as the NRMS reservations table. */}
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <th className="whitespace-nowrap px-4 py-3">Request</th>
                    <th className="whitespace-nowrap px-4 py-3">Group</th>
                    <th className="whitespace-nowrap px-4 py-3">Customer</th>
                    <th className="whitespace-nowrap px-4 py-3">Destination</th>
                    <th className="whitespace-nowrap px-4 py-3">Check-in</th>
                    <th className="whitespace-nowrap px-4 py-3">Extra services</th>
                    <th className="whitespace-nowrap px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((request) => {
                    const checkIn = request.checkIn ? new Date(request.checkIn) : null;
                    const checkOut = request.checkOut ? new Date(request.checkOut) : null;
                    const nights = checkIn && checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000)) : null;
                    const arrangements = [
                      { on: request.arrPickup, icon: Truck, label: "Pickup" },
                      { on: request.arrTransport, icon: Bus, label: "Transport" },
                      { on: request.arrMeals, icon: Coffee, label: "Meals" },
                      { on: request.arrGuide, icon: User, label: "Guide" },
                      { on: request.arrEquipment, icon: Wrench, label: "Equipment" },
                    ].filter((a) => a.on);
                    return (
                      <tr key={request.id} className="transition-colors hover:bg-neutral-50/80">
                        <td className="whitespace-nowrap border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-xs font-semibold tabular-nums text-neutral-700">
                            GS-{String(request.id).padStart(4, "0")}
                          </span>
                          <div className="mt-1 text-[11px] text-neutral-400">
                            {new Date(request.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                          </div>
                        </td>
                        <td className="max-w-[12rem] border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <div className="truncate font-bold text-neutral-900">{humanizeGroupLabel(request.groupType)}</div>
                          <div className="mt-0.5 text-xs text-neutral-400">
                            {request.headcount} {request.headcount === 1 ? "guest" : "guests"} · {request.roomsNeeded} {request.roomsNeeded === 1 ? "room" : "rooms"}
                          </div>
                        </td>
                        <td className="max-w-[15rem] border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <div className="truncate font-bold text-neutral-900" title={request.user?.name || undefined}>{request.user?.name || "Unknown customer"}</div>
                          {request.user?.email ? <div className="mt-0.5 truncate text-xs text-neutral-400" title={request.user.email}>{request.user.email}</div> : null}
                        </td>
                        <td className="max-w-[15rem] border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          <div className="truncate font-semibold text-neutral-800">{request.toRegion ? formatPlaceName(request.toRegion) : "Not set"}</div>
                          {request.toDistrict ? <div className="mt-0.5 truncate text-xs text-neutral-400">{formatPlaceName(request.toDistrict)}</div> : null}
                        </td>
                        <td className="whitespace-nowrap border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          {checkIn ? (
                            <>
                              <div className="font-semibold text-neutral-800">{checkIn.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>
                              <div className="mt-0.5 text-xs text-neutral-400">{nights != null ? `${nights} ${nights === 1 ? "night" : "nights"}` : "Open checkout"}</div>
                            </>
                          ) : (
                            <div className="font-semibold text-neutral-400">Flexible</div>
                          )}
                        </td>
                        <td className="whitespace-nowrap border-0 border-t border-solid border-neutral-100 px-4 py-3.5">
                          {arrangements.length === 0 ? (
                            <span className="text-xs text-neutral-400">None</span>
                          ) : (
                            // Icon row on one line; labels live in the tooltip so the row never wraps.
                            <div className="flex items-center gap-1" title={arrangements.map((a) => a.label).join(", ")}>
                              {arrangements.map((a) => {
                                const Icon = a.icon;
                                return (
                                  <span key={a.label} aria-label={a.label} className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                                    <Icon className="h-3.5 w-3.5" />
                                  </span>
                                );
                              })}
                              <span className="ml-1 text-xs font-semibold tabular-nums text-neutral-500">{arrangements.length}</span>
                            </div>
                          )}
                        </td>
                        <td className="whitespace-nowrap border-0 border-t border-solid border-neutral-100 px-4 py-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => openReview(request)}
                            className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800"
                          >
                            Review
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-gray-200">
              {list.map((request) => (
                <div key={request.id} className="p-4 bg-white hover:bg-gray-50 transition-colors duration-150">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-900">#{request.id}</span>
                    <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-amber-100 text-amber-700">
                      Pending
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <User className="h-4 w-4 text-gray-400" />
                    <span>Customer: {request.user?.name || "N/A"}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <UsersRound className="h-4 w-4 text-gray-400" />
                    <span>Type: {request.groupType} • {request.headcount} people ({request.roomsNeeded} rooms)</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    <span>Destination: {request.toRegion}{request.toDistrict ? `, ${request.toDistrict}` : ""}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-gray-400" />
                    <span>Check-In: {request.checkIn ? new Date(request.checkIn).toLocaleDateString() : "Flexible"}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-2">
                    <span className="font-medium">Extra services: </span>
                    <div className="flex items-center gap-1 flex-wrap mt-1">
                      {request.arrPickup && <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">Pickup</span>}
                      {request.arrTransport && <span className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded">Transport</span>}
                      {request.arrMeals && <span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">Meals</span>}
                      {request.arrGuide && <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">Guide</span>}
                      {request.arrEquipment && <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded">Equipment</span>}
                      {!request.arrPickup && !request.arrTransport && !request.arrMeals && !request.arrGuide && !request.arrEquipment && (
                        <span className="text-gray-400 text-xs">None</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 text-right">
                    <button type="button" onClick={() => openReview(request)} className="text-amber-600 hover:text-amber-900 text-sm">
                      Review Request
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Pagination: the shared table footer used by the NRMS reservations table */}
        {!loading && list.length > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={(next) => setPage(Math.min(pages, Math.max(1, next)))}
          />
        )}
      </div>

      {/* Review Modal */}
      {showReviewModal && selectedRequest && (() => {
        const r = selectedRequest;
        const checkIn = r.checkIn ? new Date(r.checkIn) : null;
        const checkOut = r.checkOut ? new Date(r.checkOut) : null;
        const nights = checkIn && checkOut ? Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000)) : null;
        const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
        const created = new Date(r.createdAt);
        const facts = [
          { icon: UsersRound, label: "Group", value: humanizeGroupLabel(r.groupType), sub: r.accommodationType ? humanizeGroupLabel(r.accommodationType) : null },
          { icon: User, label: "Guests", value: `${r.headcount} ${r.headcount === 1 ? "guest" : "guests"}`, sub: `${r.roomsNeeded} ${r.roomsNeeded === 1 ? "room" : "rooms"} needed` },
          { icon: MapPin, label: "Destination", value: r.toRegion ? formatPlaceName(r.toRegion) : "Not set", sub: [r.toDistrict ? formatPlaceName(r.toDistrict) : null, r.toLocation].filter(Boolean).join(" · ") || null },
          { icon: Calendar, label: "Stay", value: checkIn ? fmt(checkIn) : "Flexible dates", sub: checkIn ? `${checkOut ? `to ${fmt(checkOut)}` : "Open checkout"}${nights != null ? ` · ${nights} ${nights === 1 ? "night" : "nights"}` : ""}` : null },
        ];
        const arrangements = [
          { on: r.arrPickup, icon: Truck, label: "Pickup" },
          { on: r.arrTransport, icon: Bus, label: "Transport" },
          { on: r.arrMeals, icon: Coffee, label: "Meals" },
          { on: r.arrGuide, icon: User, label: "Guide" },
          { on: r.arrEquipment, icon: Wrench, label: "Equipment" },
        ].filter((a) => a.on);
        const initials = (r.user?.name || r.user?.email || "?").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();

        return (
          <>
            <div className="fixed inset-0 z-50 bg-neutral-950/50 backdrop-blur-sm" onClick={() => setShowReviewModal(false)} />
            <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-3 sm:p-6">
              <div className="box-border flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-neutral-50 shadow-2xl">
                {/* Header */}
                <div className="flex items-start gap-3 border-0 border-b border-solid border-neutral-200 bg-white px-4 py-4 sm:gap-4 sm:px-6">
                  <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100">
                    <AlertCircle className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="m-0 text-lg font-bold tracking-tight text-neutral-900">Request GS-{String(r.id).padStart(4, "0")}</h2>
                      <span className="inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Pending review</span>
                    </div>
                    <p className="m-0 mt-1 text-xs text-neutral-500">
                      Received {fmt(created)} at {created.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowReviewModal(false)}
                    className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-neutral-200 bg-white text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-900"
                    aria-label="Close modal"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
                  {/* Key facts: 1px gaps over a tinted grid draw the dividers */}
                  <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
                    <div className="grid grid-cols-1 gap-px bg-neutral-100 sm:grid-cols-2">
                      {facts.map((fact) => {
                        const Icon = fact.icon;
                        return (
                          <div key={fact.label} className="flex min-w-0 items-start gap-3 bg-white p-4">
                            <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                              <Icon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">{fact.label}</p>
                              <p className="m-0 mt-0.5 truncate text-sm font-bold text-neutral-900" title={fact.value}>{fact.value}</p>
                              {fact.sub ? <p className="m-0 mt-0.5 truncate text-xs text-neutral-500" title={fact.sub}>{fact.sub}</p> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Customer */}
                  <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-amber-50 text-sm font-bold text-amber-700">{initials}</span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Customer</p>
                        <p className="m-0 mt-0.5 truncate text-sm font-bold text-neutral-900">{r.user?.name || "Unknown customer"}</p>
                      </div>
                      <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                        {r.user?.email ? (
                          <a href={`mailto:${r.user.email}`} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 no-underline transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 hover:no-underline">
                            <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                            <span className="truncate">{r.user.email}</span>
                          </a>
                        ) : null}
                        {r.user?.phone ? (
                          <a href={`tel:${r.user.phone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 no-underline transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 hover:no-underline">
                            <Phone className="h-3.5 w-3.5" />
                            {r.user.phone}
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Arrangements */}
                  <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-indigo-50 text-indigo-600">
                          <Wrench className="h-3.5 w-3.5" />
                        </span>
                        <h4 className="m-0 text-sm font-bold text-neutral-900">Extra services</h4>
                      </div>
                      <div className="flex flex-wrap gap-1.5 sm:ml-auto">
                        {arrangements.length === 0 ? (
                          <span className="text-xs text-neutral-400">None requested</span>
                        ) : arrangements.map((a) => {
                          const Icon = a.icon;
                          return (
                            <span key={a.label} className="inline-flex items-center gap-1 rounded-full border border-solid border-neutral-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-neutral-700">
                              <Icon className="h-3 w-3 text-indigo-600" />
                              {a.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    {(r.pickupLocation || r.pickupTime) && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-neutral-50 px-3 py-2.5 text-sm">
                        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Pickup</span>
                        {r.pickupLocation && (
                          <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-neutral-900">
                            <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-neutral-400" />
                            <span className="truncate">{r.pickupLocation}</span>
                          </span>
                        )}
                        {r.pickupTime && (
                          <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-neutral-900">
                            <Clock className="h-3.5 w-3.5 text-neutral-400" />
                            {r.pickupTime}
                          </span>
                        )}
                      </div>
                    )}
                    {r.arrangementNotes && (
                      <div className="mt-3 border-0 border-l-2 border-solid border-indigo-200 pl-3">
                        <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">Notes from the customer</p>
                        <p className="m-0 mt-1 whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{r.arrangementNotes}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 border-0 border-t border-solid border-neutral-200 bg-white px-4 py-3 sm:px-6">
                  <button
                    type="button"
                    onClick={() => setShowReviewModal(false)}
                    className="rounded-lg border border-solid border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 hover:text-neutral-900"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}


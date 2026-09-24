"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Wrench, Search, X, Calendar, MapPin, UsersRound, Truck, Bus, Coffee, User, Package, AlertCircle, RefreshCw, Loader2, TrendingUp, ExternalLink, Layers } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import TablePagination from "@/components/TablePagination";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;

// Input sanitization helper
function sanitizeInput(input: string): string {
  return input.replace(/[<>]/g, "").slice(0, 200);
}

// Validate filter values
function isValidArrType(value: string): boolean {
  return ["", "pickup", "transport", "meals", "guide", "equipment"].includes(value);
}

function isValidGroupType(value: string): boolean {
  return ["", "family", "workers", "event", "students", "team", "other"].includes(value);
}

function isValidStatus(value: string): boolean {
  return ["", "PENDING", "CONFIRMED", "PROCESSING", "COMPLETED", "CANCELED"].includes(value);
}

type ServiceKey = "pickup" | "transport" | "meals" | "guide" | "equipment";

type ArrangementRow = {
  id: number;
  groupType: string;
  customer: { id: number; name: string; email: string; phone: string | null } | null;
  destination: {
    region: string;
    district: string | null;
    ward: string | null;
    location: string | null;
  };
  headcount: number;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  arrangements: Record<ServiceKey, boolean>;
  createdAt: string;
};

type ArrangementStats = {
  arrangementCounts: Record<ServiceKey, number>;
  groupTypeArrangements: Record<string, Record<string, number>>;
  regionArrangements: Record<string, Record<string, number>>;
  statusArrangements: Record<string, Record<string, number>>;
  topRegions: Array<{ region: string; total: number } & Record<ServiceKey, number>>;
  bookingsWithArrangements: number;
  totalBookings: number;
};

// One definition drives tiles, table icons, filters and the modal. Classes spelled out for Tailwind.
const SERVICES: Array<{ key: ServiceKey; label: string; icon: typeof Truck; tone: string; bar: string }> = [
  { key: "pickup", label: "Pickup", icon: Truck, tone: "bg-blue-50 text-blue-600", bar: "bg-blue-500" },
  { key: "transport", label: "Transport", icon: Bus, tone: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-500" },
  { key: "meals", label: "Meals", icon: Coffee, tone: "bg-amber-50 text-amber-600", bar: "bg-amber-500" },
  { key: "guide", label: "Guide", icon: User, tone: "bg-violet-50 text-violet-600", bar: "bg-violet-500" },
  { key: "equipment", label: "Equipment", icon: Package, tone: "bg-rose-50 text-rose-600", bar: "bg-rose-500" },
];

const STATUS_TONE: Record<string, string> = {
  PENDING: "text-amber-700",
  AWAITING_DEPOSIT: "text-sky-700",
  CONFIRMED: "text-blue-700",
  PROCESSING: "text-violet-700",
  COMPLETED: "text-neutral-600",
  CANCELED: "text-rose-600",
  CANCELLED: "text-rose-600",
};

function humanizeLabel(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
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

function tidyName(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
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

const inputCls =
  "h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/15";

export default function AdminGroupStaysArrangementsPage() {
  const [arrType, setArrType] = useState<string>("");
  const [groupType, setGroupType] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [date, setDate] = useState<string | string[]>("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [list, setList] = useState<ArrangementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Stats state
  const [stats, setStats] = useState<ArrangementStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Details modal state
  const [selected, setSelected] = useState<ArrangementRow | null>(null);
  const [detailsMounted, setDetailsMounted] = useState(false);
  const [detailsVisible, setDetailsVisible] = useState(false);

  const openDetails = useCallback((booking: ArrangementRow) => {
    setSelected(booking);
    setDetailsMounted(true);
    requestAnimationFrame(() => setDetailsVisible(true));
  }, []);

  const closeDetails = useCallback(() => {
    setDetailsVisible(false);
    window.setTimeout(() => {
      setDetailsMounted(false);
      setSelected(null);
    }, 160);
  }, []);

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQ(q.trim());
      setPage(1);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = { page, pageSize };
      if (arrType && isValidArrType(arrType)) params.arrType = arrType;
      if (groupType && isValidGroupType(groupType)) params.groupType = groupType;
      if (status && isValidStatus(status)) params.status = status;
      if (date) {
        if (Array.isArray(date)) {
          params.start = date[0];
          params.end = date[1];
        } else {
          params.date = date;
        }
      }
      if (debouncedQ) params.q = sanitizeInput(debouncedQ);

      const r = await api.get<{ items: ArrangementRow[]; total: number }>("/api/admin/group-stays/arrangements", { params });
      setList(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Failed to load arrangements");
      console.error("Failed to load arrangements", err);
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, arrType, groupType, status, date, debouncedQ]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const r = await api.get<ArrangementStats>("/api/admin/group-stays/arrangements/stats");
      setStats(r.data);
    } catch (err: any) {
      setStatsError(err?.response?.data?.error || err?.message || "Failed to load arrangement statistics");
      console.error("Failed to load arrangement statistics", err);
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!detailsMounted) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetails();
    };
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [detailsMounted, closeDetails]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const dateLabel = Array.isArray(date)
    ? [fmtDay(date[0]), fmtDay(date[1])].filter(Boolean).join(" to ")
    : date
      ? fmtDay(date)
      : null;
  const activeFilters = [arrType, groupType, status, dateLabel, q].filter(Boolean).length;
  const clearFilters = () => {
    setQ("");
    setDebouncedQ("");
    setArrType("");
    setGroupType("");
    setStatus("");
    setDate("");
    setPage(1);
  };

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-100 sm:h-12 sm:w-12">
            <Wrench className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold tracking-tight text-neutral-900 sm:text-xl">Extra services</h1>
            <p className="m-0 mt-0.5 text-xs text-neutral-500 sm:text-sm">Extra services customers asked for on their group stays</p>
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

      {/* Summary strip */}
      {statsError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 sm:px-5">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-rose-600" />
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold text-rose-900">Could not load statistics</p>
            <p className="m-0 mt-0.5 truncate text-xs text-rose-700">{statsError}</p>
          </div>
          <button
            type="button"
            onClick={loadStats}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : stats ? (() => {
        const withShare = stats.totalBookings > 0 ? Math.round((stats.bookingsWithArrangements / stats.totalBookings) * 100) : 0;
        const shareOf = (n: number) => (stats.bookingsWithArrangements > 0 ? Math.round((n / stats.bookingsWithArrangements) * 100) : 0);
        return (
          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
            <div className="grid grid-cols-1 gap-px bg-neutral-100 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              <div className="flex min-w-0 items-center gap-3 bg-white px-4 py-3.5 sm:px-5">
                <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-600">
                  <Layers className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-xs font-medium text-neutral-500">With services</p>
                  <p className="m-0 text-xl font-bold leading-tight tabular-nums text-neutral-900">{stats.bookingsWithArrangements.toLocaleString()}</p>
                  <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400">{withShare}% of {stats.totalBookings.toLocaleString()} bookings</p>
                </div>
              </div>
              {SERVICES.map((s) => {
                const Icon = s.icon;
                const n = stats.arrangementCounts?.[s.key] ?? 0;
                return (
                  <div key={s.key} className="flex min-w-0 items-center gap-3 bg-white px-4 py-3.5 sm:px-5">
                    <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${s.tone}`}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 text-xs font-medium text-neutral-500">{s.label}</p>
                      <p className="m-0 text-xl font-bold leading-tight tabular-nums text-neutral-900">{n.toLocaleString()}</p>
                      <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400">{shareOf(n)}% of those bookings</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })() : statsLoading ? (
        <div className="flex h-[78px] items-center justify-center rounded-xl border border-solid border-neutral-200 bg-white">
          <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
        </div>
      ) : null}

      {/* Breakdown: group type matrix + top regions */}
      {stats && (() => {
        const typeRows = Object.entries(stats.groupTypeArrangements || {})
          .map(([type, counts]) => ({ type, counts, total: SERVICES.reduce((sum, s) => sum + (counts?.[s.key] || 0), 0) }))
          .filter((r) => r.total > 0)
          .sort((a, b) => b.total - a.total);
        const cellMax = Math.max(1, ...typeRows.flatMap((r) => SERVICES.map((s) => r.counts?.[s.key] || 0)));
        const regions = (stats.topRegions || []).filter((r) => r.total > 0).slice(0, 6);
        const regionMax = Math.max(1, ...regions.map((r) => r.total));
        return (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            {/* Group type x service */}
            <div className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white">
              <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-violet-50 text-violet-600">
                  <UsersRound className="h-3.5 w-3.5" />
                </span>
                <h3 className="m-0 text-sm font-bold text-neutral-900">Services by group type</h3>
                <span className="ml-auto text-xs text-neutral-400">Darker means more requests</span>
              </div>
              {typeRows.length === 0 ? (
                <p className="m-0 border-0 border-t border-solid border-neutral-100 px-4 py-4 text-sm text-neutral-500 sm:px-5">No services requested yet</p>
              ) : (
                <div className="overflow-x-auto border-0 border-t border-solid border-neutral-100">
                  <table className="table w-full min-w-[520px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                        <th className="px-4 py-2.5 font-bold sm:pl-5">Group</th>
                        {SERVICES.map((s) => (
                          <th key={s.key} className="px-2 py-2.5 text-center font-bold">{s.label}</th>
                        ))}
                        <th className="px-4 py-2.5 text-right font-bold sm:pr-5">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {typeRows.map((row) => (
                        <tr key={row.type} className="border-0 border-t border-solid border-neutral-100">
                          <td className="px-4 py-2 text-neutral-800 sm:pl-5">{humanizeLabel(row.type)}</td>
                          {SERVICES.map((s) => {
                            const n = row.counts?.[s.key] || 0;
                            const strength = n / cellMax;
                            return (
                              <td key={s.key} className="px-2 py-1.5 text-center">
                                <span
                                  className={`inline-flex h-7 min-w-[2.5rem] items-center justify-center rounded-md px-2 text-xs tabular-nums ${
                                    n === 0 ? "text-neutral-300" : strength > 0.66 ? "bg-amber-500 font-semibold text-white" : strength > 0.33 ? "bg-amber-200 text-amber-900" : "bg-amber-50 text-amber-800"
                                  }`}
                                >
                                  {n === 0 ? "0" : n}
                                </span>
                              </td>
                            );
                          })}
                          <td className="px-4 py-2 text-right font-semibold tabular-nums text-neutral-900 sm:pr-5">{row.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Top regions */}
            <div className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white">
              <div className="flex items-center gap-2 px-4 py-3 sm:px-5">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                  <MapPin className="h-3.5 w-3.5" />
                </span>
                <h3 className="m-0 text-sm font-bold text-neutral-900">Top regions</h3>
                <span className="ml-auto text-xs text-neutral-400">All services</span>
              </div>
              <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3 sm:px-5">
                {regions.length === 0 ? (
                  <p className="m-0 py-2 text-sm text-neutral-500">No regions yet</p>
                ) : (
                  <ul className="m-0 list-none space-y-3 p-0">
                    {regions.map((r, idx) => (
                      <li key={`${r.region}-${idx}`}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate text-neutral-800">{formatPlaceName(r.region)}</span>
                          <span className="flex-shrink-0 font-semibold tabular-nums text-neutral-900">{r.total}</span>
                        </div>
                        {/* Stacked bar: each service's slice of this region */}
                        <div className="mt-1 flex h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                          <div className="flex h-full" style={{ width: `${Math.max((r.total / regionMax) * 100, 4)}%` }}>
                            {SERVICES.map((s) => {
                              const n = r[s.key] || 0;
                              return n > 0 ? <div key={s.key} className={`h-full ${s.bar}`} style={{ width: `${(n / r.total) * 100}%` }} title={`${s.label}: ${n}`} /> : null;
                            })}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {regions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 border-0 border-t border-solid border-neutral-100 pt-2.5">
                    {SERVICES.map((s) => (
                      <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-neutral-500">
                        <span className={`h-1 w-3 rounded-full ${s.bar}`} /> {s.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bookings: filters + table in one card */}
      <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <h3 className="m-0 text-sm font-bold text-neutral-900">Bookings</h3>
          <span className="text-xs tabular-nums text-neutral-400">
            {loading ? "Loading…" : `${total.toLocaleString()} ${total === 1 ? "booking" : "bookings"}`}
          </span>
          {activeFilters > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="ml-auto inline-flex items-center gap-1 rounded-md border-0 bg-transparent px-2 py-1 text-xs font-semibold text-neutral-600 transition-colors hover:bg-neutral-100"
            >
              <X className="h-3.5 w-3.5" /> Clear {activeFilters} {activeFilters === 1 ? "filter" : "filters"}
            </button>
          )}
        </div>

        {/* Service quick filter */}
        <div className="flex flex-wrap items-center gap-1.5 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 sm:px-5">
          {[{ key: "", label: "All services", icon: Layers }, ...SERVICES].map((s) => {
            const Icon = s.icon;
            const active = arrType === s.key;
            return (
              <button
                key={s.key || "all"}
                type="button"
                onClick={() => {
                  setArrType(s.key);
                  setPage(1);
                }}
                aria-pressed={active}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-medium transition-colors ${
                  active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {s.label}
                {stats && s.key ? <span className={`tabular-nums ${active ? "text-white/70" : "text-neutral-400"}`}>{stats.arrangementCounts?.[s.key as ServiceKey] ?? 0}</span> : null}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-3 sm:grid-cols-2 sm:px-5 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <div className="relative min-w-0 sm:col-span-2 lg:col-span-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              className={`${inputCls} pl-9 pr-9`}
              placeholder="Search customer, email or destination"
              value={q}
              onChange={(e) => setQ(sanitizeInput(e.target.value))}
              aria-label="Search arrangements by customer name, email, or destination"
              maxLength={200}
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <select
            value={groupType}
            onChange={(e) => {
              setGroupType(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by group type"
            className={inputCls}
          >
            <option value="">All group types</option>
            <option value="family">Family</option>
            <option value="workers">Workers</option>
            <option value="event">Event</option>
            <option value="students">Students</option>
            <option value="team">Team</option>
            <option value="other">Other</option>
          </select>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            aria-label="Filter by status"
            className={inputCls}
          >
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PROCESSING">Processing</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELED">Canceled</option>
          </select>
          <div className="relative min-w-0">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              aria-label="Select date filter"
              className={`${inputCls} flex items-center gap-2 text-left ${dateLabel ? "pr-8" : ""}`}
            >
              <Calendar className="h-4 w-4 flex-shrink-0 text-neutral-400" aria-hidden="true" />
              <span className={`truncate ${dateLabel ? "text-neutral-800" : "text-neutral-400"}`}>{dateLabel || "Any date"}</span>
            </button>
            {dateLabel && (
              <button
                type="button"
                onClick={() => {
                  setDate("");
                  setPage(1);
                }}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Clear date"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                <div className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2">
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

        {error ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-12 text-center">
            <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
              <AlertCircle className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">Could not load extra services</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">{error}</p>
            <button
              type="button"
              onClick={load}
              className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
            >
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
          </div>
        ) : loading && list.length === 0 ? (
          <div className="flex items-center justify-center gap-2 border-0 border-t border-solid border-neutral-100 py-16 text-sm text-neutral-500" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading bookings
          </div>
        ) : list.length === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
            <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
              <Wrench className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No bookings found</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">
              {activeFilters > 0 ? "Try removing a filter or changing the search." : "Bookings with extra services will appear here."}
            </p>
          </div>
        ) : (
          <div className={`transition-opacity ${loading ? "opacity-60" : ""}`}>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="table w-full min-w-[1040px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    {["Booking", "Customer", "Destination", "Group", "Services", "Stay", "Status"].map((h, i) => (
                      <th key={h} className={`border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold ${i === 0 ? "sm:pl-5" : ""}`}>{h}</th>
                    ))}
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 sm:pr-5">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((b) => {
                    const st = String(b.status || "").toUpperCase();
                    const chosen = SERVICES.filter((s) => b.arrangements?.[s.key]);
                    const nights = nightsBetween(b.checkIn, b.checkOut);
                    return (
                      <tr
                        key={b.id}
                        onClick={() => openDetails(b)}
                        className="cursor-pointer border-0 border-b border-solid border-neutral-100 transition-colors last:border-b-0 hover:bg-neutral-50/70"
                      >
                        <td className="px-4 py-3.5 sm:pl-5">
                          <span className="inline-block rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700">{gsRef(b.id)}</span>
                          <div className="mt-0.5 text-xs text-neutral-400">{fmtDay(b.createdAt)}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          {b.customer ? (
                            <>
                              <div className="max-w-[12rem] truncate text-neutral-800">{tidyName(b.customer.name)}</div>
                              <div className="mt-0.5 max-w-[12rem] truncate text-xs text-neutral-400" title={b.customer.email}>{b.customer.email}</div>
                            </>
                          ) : (
                            <span className="text-neutral-400">Not linked</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="max-w-[11rem] truncate text-neutral-800">{formatPlaceName(b.destination?.region) || "Not set"}</div>
                          <div className="mt-0.5 max-w-[11rem] truncate text-xs text-neutral-400">{b.destination?.district ? formatPlaceName(b.destination.district) : " "}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="text-neutral-800">{humanizeLabel(b.groupType)}</div>
                          <div className="mt-0.5 text-xs tabular-nums text-neutral-400">{b.headcount} {b.headcount === 1 ? "guest" : "guests"}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          {/* Five fixed slots so services line up row to row */}
                          <div className="flex items-center gap-1">
                            {SERVICES.map((s) => {
                              const Icon = s.icon;
                              const on = Boolean(b.arrangements?.[s.key]);
                              return (
                                <span
                                  key={s.key}
                                  title={`${s.label}: ${on ? "requested" : "not requested"}`}
                                  aria-label={`${s.label} ${on ? "requested" : "not requested"}`}
                                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${on ? s.tone : "text-neutral-200"}`}
                                >
                                  <Icon className="h-3.5 w-3.5" />
                                </span>
                              );
                            })}
                          </div>
                          <div className="mt-0.5 text-xs text-neutral-400">{chosen.length === 0 ? "None" : `${chosen.length} of 5`}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="whitespace-nowrap text-neutral-800">{fmtDay(b.checkIn) || <span className="text-neutral-400">Not set</span>}</div>
                          <div className="mt-0.5 text-xs text-neutral-400">{nights ? `${nights} ${nights === 1 ? "night" : "nights"}` : " "}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span className={`whitespace-nowrap ${STATUS_TONE[st] || "text-neutral-500"}`}>{humanizeLabel(st)}</span>
                        </td>
                        <td className="px-4 py-3.5 text-right sm:pr-5">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDetails(b);
                            }}
                            aria-label={`View details for booking ${gsRef(b.id)}`}
                            className="inline-flex h-8 items-center rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="m-0 list-none p-0 md:hidden">
              {list.map((b) => {
                const st = String(b.status || "").toUpperCase();
                return (
                  <li key={b.id} className="border-0 border-t border-solid border-neutral-100">
                    <button
                      type="button"
                      onClick={() => openDetails(b)}
                      className="block w-full border-0 bg-transparent px-4 py-3 text-left transition-colors hover:bg-neutral-50"
                    >
                      <span className="flex items-center gap-2">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-700">{gsRef(b.id)}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900">{b.customer ? tidyName(b.customer.name) : "No customer"}</span>
                        <span className={`flex-shrink-0 text-xs ${STATUS_TONE[st] || "text-neutral-500"}`}>{humanizeLabel(st)}</span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-neutral-500">
                        {[formatPlaceName(b.destination?.region), humanizeLabel(b.groupType), `${b.headcount} guests`, fmtDay(b.checkIn)].filter(Boolean).join(" · ")}
                      </span>
                      <span className="mt-1.5 flex items-center gap-1">
                        {SERVICES.map((s) => {
                          const Icon = s.icon;
                          const on = Boolean(b.arrangements?.[s.key]);
                          return (
                            <span key={s.key} className={`inline-flex h-6 w-6 items-center justify-center rounded-md ${on ? s.tone : "text-neutral-200"}`} aria-label={`${s.label} ${on ? "requested" : "not requested"}`}>
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <TablePagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* Details modal */}
      {detailsMounted && selected && (() => {
        const b = selected;
        const st = String(b.status || "").toUpperCase();
        const nights = nightsBetween(b.checkIn, b.checkOut);
        const chosenCount = SERVICES.filter((s) => b.arrangements?.[s.key]).length;
        const facts = [
          { label: "Customer", value: b.customer ? tidyName(b.customer.name) : "Not linked", sub: [b.customer?.email, b.customer?.phone].filter(Boolean).join(" · ") || null },
          { label: "Destination", value: formatPlaceName(b.destination?.region) || "Not set", sub: [b.destination?.district, b.destination?.ward, b.destination?.location].filter(Boolean).map((v) => formatPlaceName(v as string)).join(" · ") || null },
          { label: "Group", value: humanizeLabel(b.groupType), sub: `${b.headcount} ${b.headcount === 1 ? "guest" : "guests"}` },
          { label: "Stay", value: fmtDay(b.checkIn) || "Dates not set", sub: b.checkOut ? `Until ${fmtDay(b.checkOut)}${nights ? ` · ${nights} ${nights === 1 ? "night" : "nights"}` : ""}` : null },
        ];
        return (
          <div className={`fixed inset-0 z-50 ${detailsVisible ? "" : "pointer-events-none"}`} aria-modal="true" role="dialog" aria-label="Extra services details">
            <div className={`absolute inset-0 bg-neutral-900/50 transition-opacity duration-200 ease-out ${detailsVisible ? "opacity-100" : "opacity-0"}`} onClick={closeDetails} />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              <div
                className={`pointer-events-auto flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-2xl transition-all duration-200 ease-out ${
                  detailsVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0"
                }`}
              >
                <div className="flex items-start gap-3 px-5 py-4">
                  <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                    <Wrench className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h2 className="m-0 text-base font-bold text-neutral-900">{gsRef(b.id)}</h2>
                      <span className={`text-xs ${STATUS_TONE[st] || "text-neutral-500"}`}>{humanizeLabel(st)}</span>
                    </div>
                    <p className="m-0 mt-0.5 text-xs text-neutral-500">Requested {fmtDay(b.createdAt) || "on an unknown date"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeDetails}
                    className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto border-0 border-t border-solid border-neutral-100 px-5 py-4">
                  <div>
                    <p className="m-0 mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                      <span>Services</span>
                      <span className="font-medium normal-case tracking-normal">{chosenCount} of 5 requested</span>
                    </p>
                    <ul className="m-0 grid list-none grid-cols-1 gap-1.5 p-0 sm:grid-cols-2">
                      {SERVICES.map((s) => {
                        const Icon = s.icon;
                        const on = Boolean(b.arrangements?.[s.key]);
                        return (
                          <li
                            key={s.key}
                            className={`flex items-center gap-2.5 rounded-lg border border-solid px-3 py-2 ${on ? "border-neutral-200 bg-white" : "border-neutral-100 bg-neutral-50/60"}`}
                          >
                            <span className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${on ? s.tone : "bg-neutral-100 text-neutral-300"}`}>
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className={`flex-1 text-sm ${on ? "text-neutral-900" : "text-neutral-400"}`}>{s.label}</span>
                            <span className={`text-xs ${on ? "text-emerald-700" : "text-neutral-400"}`}>{on ? "Requested" : "Not needed"}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-solid border-neutral-100 bg-neutral-100 sm:grid-cols-2">
                    {facts.map((f) => (
                      <div key={f.label} className="min-w-0 bg-white px-3 py-2.5">
                        <p className="m-0 text-[11px] text-neutral-400">{f.label}</p>
                        <p className="m-0 mt-0.5 truncate text-sm text-neutral-900" title={f.value}>{f.value}</p>
                        {f.sub ? <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400" title={f.sub}>{f.sub}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-5 py-3">
                  <button
                    type="button"
                    onClick={closeDetails}
                    className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-200 bg-white px-3.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
                  >
                    Close
                  </button>
                  <Link
                    href={`/admin/group-stays/bookings?bookingId=${encodeURIComponent(String(b.id))}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-amber-700 hover:no-underline"
                  >
                    Open booking <ExternalLink className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import { Car, Star, User, CheckCircle, Calendar, ArrowRight, Phone, Eye, Clock, RefreshCw, AlertCircle, ChevronLeft, ChevronRight, ChevronDown, Search, SlidersHorizontal, X, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import DatePicker from "@/components/ui/DatePicker";

const api = apiClient;

const RIDE_SORTS = [
  { key: "date-late", label: "Ride date, latest" },
  { key: "date-soon", label: "Ride date, soonest" },
  { key: "amount-high", label: "Highest fare" },
  { key: "amount-low", label: "Lowest fare" },
] as const;
type RideSort = (typeof RIDE_SORTS)[number]["key"];

const DRIVER_OPTIONS = [
  { key: "any", label: "Any" },
  { key: "assigned", label: "Assigned" },
  { key: "none", label: "Not yet" },
] as const;
type DriverKey = (typeof DRIVER_OPTIONS)[number]["key"];

/** "2026-09-12" reads as "12 Sep 2026". */
function shortDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "DAR-ES-SALAAM" and "dar es salaam" both read as "Dar Es Salaam". */
function tidy(value?: string | null): string {
  return String(value || "").replace(/[-_]+/g, " ").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-[11.5px] font-semibold text-slate-700">
      {label}
      <button type="button" aria-label={`Remove ${label}`} onClick={onClear} className="inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-slate-500 hover:bg-slate-200">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

type Ride = {
  id: number;
  rideReference: string;
  scheduledDate: string;
  pickupTime?: string;
  dropoffTime?: string;
  fromRegion?: string;
  fromDistrict?: string;
  fromWard?: string;
  fromAddress?: string;
  toRegion?: string;
  toDistrict?: string;
  toWard?: string;
  toAddress?: string;
  driver?: {
    id: number;
    name: string;
    phone?: string;
  };
  property?: {
    id: number;
    title: string;
  };
  status: string;
  amount?: number;
  rating?: number;
  isValid: boolean;
  createdAt: string;
};

export default function MyRidesPage() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "scheduled" | "completed" | "expired">("all");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<RideSort>("date-late");
  const [showFilters, setShowFilters] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [region, setRegion] = useState("");
  const [driverFilter, setDriverFilter] = useState<DriverKey>("any");
  const [entered, setEntered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRides();
  }, []);

  // Gentle mount animation
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  const loadRides = async () => {
    try {
      setLoading(true);
      setError(null);
      // Walk the API pages: tabs and counts need every ride, not just the first page
      const items: Ride[] = [];
      for (let p = 1; p <= 20; p += 1) {
        const response = await api.get(`/api/customer/rides?pageSize=50&page=${p}`);
        const batch: Ride[] = response.data.items || [];
        items.push(...batch);
        const total = Number(response.data.total || 0);
        if (batch.length < 50 || (total > 0 && items.length >= total)) break;
      }
      setRides(items);
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to load rides";
      setError(msg);
      try {
        window.dispatchEvent(
          new CustomEvent("nols:toast", {
            detail: { type: "error", title: "Rides", message: msg, duration: 4500 },
          })
        );
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  const filteredRides = rides.filter((ride) => {
    if (filter === "scheduled") return ride.isValid;
    if (filter === "completed") return !ride.isValid && ride.status === "COMPLETED";
    if (filter === "expired") return !ride.isValid && ride.status !== "COMPLETED";
    return true;
  });

  // Search and filters narrow the tab; options come from the customer's own rides
  const regionOptions = Array.from(new Set(rides.map((r) => tidy(r.toRegion)).filter(Boolean))).sort();
  const filterCount = (dateFrom ? 1 : 0) + (region ? 1 : 0) + (driverFilter !== "any" ? 1 : 0);
  const clearFinders = () => {
    setQuery("");
    setDateFrom("");
    setDateTo("");
    setRegion("");
    setDriverFilter("any");
    setPage(1);
  };
  const queryWords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
  const toMs = dateTo ? new Date(`${dateTo}T23:59:59`).getTime() : null;
  const timeOf = (v?: string | null) => (v ? new Date(v).getTime() || 0 : 0);
  const shownRides = filteredRides
    .filter((r) => {
      if (queryWords.length) {
        const bag = [r.fromAddress, r.fromWard, r.fromDistrict, r.fromRegion, r.toAddress, r.toWard, r.toDistrict, r.toRegion, r.property?.title, r.driver?.name, r.rideReference]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!queryWords.every((w) => bag.includes(w))) return false;
      }
      const at = timeOf(r.scheduledDate);
      if (fromMs != null && at < fromMs) return false;
      if (toMs != null && at > toMs) return false;
      if (region && tidy(r.toRegion) !== region) return false;
      if (driverFilter === "assigned" && !r.driver) return false;
      if (driverFilter === "none" && r.driver) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "date-soon") return timeOf(a.scheduledDate) - timeOf(b.scheduledDate);
      if (sortBy === "amount-high") return Number(b.amount || 0) - Number(a.amount || 0);
      if (sortBy === "amount-low") return Number(a.amount || 0) - Number(b.amount || 0);
      return timeOf(b.scheduledDate) - timeOf(a.scheduledDate);
    });

  // Page the list on screen; a new tab or filter starts on page 1
  const PAGE_SIZE = 10;
  const pageCount = Math.max(1, Math.ceil(shownRides.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedRides = shownRides.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const goToPage = (next: number) => {
    setPage(Math.min(pageCount, Math.max(1, next)));
    window.requestAnimationFrame(() => document.getElementById("rides-list")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const scheduledCount = rides.filter((r) => r.isValid).length;
  const completedCount = rides.filter((r) => !r.isValid && r.status === "COMPLETED").length;
  const expiredCount = rides.filter((r) => !r.isValid && r.status !== "COMPLETED").length;

  const formatTime = (timeString?: string) => {
    if (!timeString) return "N/A";
    return new Date(timeString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatLocation = (ride: Ride, type: "from" | "to") => {
    const parts = [];
    if (type === "from") {
      if (ride.fromAddress) parts.push(ride.fromAddress);
      if (ride.fromWard) parts.push(ride.fromWard);
      if (ride.fromDistrict) parts.push(ride.fromDistrict);
      if (ride.fromRegion) parts.push(ride.fromRegion);
    } else {
      if (ride.property?.title) parts.push(ride.property.title);
      if (ride.toAddress) parts.push(ride.toAddress);
      if (ride.toWard) parts.push(ride.toWard);
      if (ride.toDistrict) parts.push(ride.toDistrict);
      if (ride.toRegion) parts.push(ride.toRegion);
    }
    return parts.length > 0 ? parts.join(", ") : "Not specified";
  };

  const getStatusLabel = (ride: Ride) => {
    if (!ride.isValid) {
      return ride.status === "COMPLETED" ? "Completed" : "Expired";
    }
    return ride.status === "CONFIRMED" ? "Confirmed" : "Scheduled";
  };

  // The soonest scheduled ride, for the header
  const nextRide = rides
    .filter((r) => r.isValid)
    .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime())[0];
  const nextRideLabel = nextRide
    ? `${new Date(nextRide.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${
        nextRide.pickupTime ? ` · pickup ${formatTime(nextRide.pickupTime)}` : ""
      }`
    : null;

  const tabs = [
    { key: "all" as const, label: "All", count: rides.length },
    { key: "scheduled" as const, label: "Scheduled", count: scheduledCount },
    { key: "completed" as const, label: "Completed", count: completedCount },
    { key: "expired" as const, label: "Expired", count: expiredCount },
  ];

  const DateTile = ({ date, muted }: { date: string; muted?: boolean }) => {
    const d = new Date(date);
    return (
      <div
        className={[
          "flex h-16 w-14 flex-shrink-0 flex-col overflow-hidden rounded-xl border border-solid text-center",
          muted ? "border-slate-200 bg-slate-50" : "border-[#02665e]/25 bg-white",
        ].join(" ")}
      >
        <span className={["py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white", muted ? "bg-slate-400" : "bg-[#02665e]"].join(" ")}>
          {d.toLocaleDateString("en-US", { month: "short" })}
        </span>
        <span className={["flex flex-1 items-center justify-center text-[22px] font-extrabold leading-none tabular-nums", muted ? "text-slate-500" : "text-slate-900"].join(" ")}>
          {d.getDate()}
        </span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="w-full space-y-4" aria-busy="true">
        <span role="status" className="sr-only">Loading rides</span>
        <div className="rounded-2xl bg-[#0a1110] px-5 py-5 sm:px-6">
          <div className="h-3 w-28 rounded bg-white/10" />
          <div className="mt-3 h-7 w-40 rounded-lg bg-white/15" />
          <div className="mt-2 h-3 w-56 rounded bg-white/10" />
          <div className="mt-5 flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 w-24 rounded-lg bg-white/10" />
            ))}
          </div>
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-2xl border border-solid border-slate-200 bg-white p-4">
            <div className="h-16 w-14 rounded-xl bg-slate-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-56 rounded bg-slate-100" />
              <div className="h-4 w-48 rounded bg-slate-100" />
              <div className="h-3 w-32 rounded bg-slate-100" />
            </div>
            <div className="hidden w-36 space-y-2 sm:block">
              <div className="ml-auto h-5 w-24 rounded bg-slate-100" />
              <div className="ml-auto h-9 w-28 rounded-lg bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full">
        <div className="flex flex-col items-center rounded-2xl border border-solid border-rose-200 bg-white px-6 py-12 text-center shadow-sm">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
            <AlertCircle className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="m-0 mt-3 text-[18px] font-bold text-slate-900">We could not load your rides</h1>
          <p className="m-0 mt-1 max-w-md text-sm text-slate-500">{error}</p>
          <button
            type="button"
            onClick={loadRides}
            className="mt-5 inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#014e47]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={[
        "w-full space-y-4 transition-all duration-300 ease-out",
        entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
      ].join(" ")}
    >
      {/* ── Header band ── */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0a1110] text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.8)]" style={{ isolation: "isolate" }}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.6), rgba(2,102,94,0))" }} />
        <div className="px-5 pb-4 pt-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#5ec8bb]">
                <Car className="h-3.5 w-3.5" aria-hidden />
                Your transport
              </div>
              <h1 className="m-0 mt-1.5 text-[26px] font-bold leading-tight text-white">
                My rides
                {rides.length > 0 ? <span className="ml-2 align-middle text-[14px] font-semibold text-white/50">{rides.length}</span> : null}
              </h1>
              <p className="m-0 mt-1 text-[13.5px] text-white/60">
                {nextRideLabel ? (
                  <>
                    Next ride: <span className="font-semibold text-white">{nextRideLabel}</span>
                  </>
                ) : (
                  "Rides that come with your bookings, past and upcoming."
                )}
              </p>
            </div>
            <Link
              href="/public/properties"
              className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 self-start rounded-lg bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#03786f]"
            >
              Book a stay
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          <div role="tablist" aria-label="Filter rides" className="mt-5 flex w-full gap-1 overflow-x-auto rounded-xl border border-solid border-white/10 bg-white/[0.04] p-1 [scrollbar-width:none] sm:w-fit sm:max-w-full">
            {tabs.map((t) => {
              const on = filter === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => {
                    setFilter(t.key);
                    setPage(1);
                  }}
                  style={{ fontFamily: "inherit" }}
                  className={[
                    "inline-flex flex-shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border-0 px-3.5 py-2 text-[13.5px] font-semibold transition-colors",
                    on ? "bg-white text-slate-900" : "bg-transparent text-white/70 hover:bg-white/[0.06] hover:text-white",
                  ].join(" ")}
                >
                  {t.label}
                  <span className={["inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 py-px text-[11.5px] font-bold tabular-nums", on ? "bg-[#02665e] text-white" : "bg-white/10 text-white/80"].join(" ")}>
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Find: search, filters and sort ── */}
      {rides.length > 0 ? (
        <section aria-label="Find a ride" className="rounded-2xl border border-solid border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-solid border-slate-300 bg-white px-4 text-slate-400 transition-[border-color,box-shadow] hover:border-slate-400 focus-within:border-[#02665e] focus-within:text-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]">
              <Search className="h-4 w-4 flex-shrink-0" aria-hidden />
              <span className="sr-only">Search rides</span>
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search place, stay, driver or reference"
                className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />
            </label>
            <div className="flex items-center gap-2">
              <span className="relative block min-w-0 flex-1 sm:w-48 sm:flex-none">
                <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <select
                  aria-label="Sort rides"
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as RideSort);
                    setPage(1);
                  }}
                  className="h-10 w-full cursor-pointer appearance-none bg-none rounded-full border border-solid border-slate-300 bg-white pl-9 pr-9 text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-400 focus:border-[#02665e] focus:outline-none"
                >
                  {RIDE_SORTS.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              </span>
              <button
                type="button"
                aria-expanded={showFilters}
                aria-controls="ride-filters"
                onClick={() => setShowFilters((v) => !v)}
                className={`inline-flex h-10 flex-shrink-0 cursor-pointer items-center gap-2 rounded-full border border-solid px-3.5 text-[13px] font-semibold transition-colors sm:px-4 ${
                  showFilters || filterCount > 0
                    ? "border-[#02665e] bg-[#02665e]/[0.06] text-[#02665e]"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"
                }`}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Filters</span>
                {filterCount > 0 ? (
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#02665e] px-1.5 text-[11px] font-bold text-white">{filterCount}</span>
                ) : null}
              </button>
            </div>
          </div>

          {showFilters ? (
            <div id="ride-filters" className="mt-3 grid gap-x-4 gap-y-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-3 sm:p-4">
              {/* Every filter: a label on one line, then one 40px control */}
              <div className="relative min-w-0">
                <div className="text-[11.5px] font-bold text-slate-600">Ride dates</div>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={datePickerOpen}
                  onClick={() => setDatePickerOpen((v) => !v)}
                  className={`mt-1.5 flex h-10 w-full cursor-pointer items-center gap-2 rounded-xl border border-solid bg-white px-3 text-left text-[13px] font-semibold transition-colors ${
                    dateFrom || datePickerOpen ? "border-[#02665e] text-slate-900" : "border-slate-300 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  <Calendar className={`h-4 w-4 flex-shrink-0 ${dateFrom ? "text-[#02665e]" : "text-slate-400"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{dateFrom ? `${shortDay(dateFrom)} to ${dateTo ? shortDay(dateTo) : "any"}` : "Any dates"}</span>
                  {dateFrom ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Clear dates"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDateFrom("");
                        setDateTo("");
                        setPage(1);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          setDateFrom("");
                          setDateTo("");
                          setPage(1);
                        }
                      }}
                      className="inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </span>
                  ) : null}
                </button>
                {datePickerOpen ? (
                  <div className="absolute left-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)]">
                    <DatePicker
                      selected={dateFrom ? (dateTo ? [dateFrom, dateTo] : dateFrom) : undefined}
                      allowRange
                      allowPast
                      resetRangeAnchor
                      onSelectAction={(value) => {
                        if (Array.isArray(value)) {
                          setDateFrom(value[0] || "");
                          setDateTo(value[value.length - 1] || "");
                          setDatePickerOpen(false);
                        } else {
                          setDateFrom(value);
                          setDateTo("");
                        }
                        setPage(1);
                      }}
                      onCloseAction={() => setDatePickerOpen(false)}
                    />
                  </div>
                ) : null}
              </div>

              <label className="block min-w-0">
                <span className="block text-[11.5px] font-bold text-slate-600">Going to</span>
                <span className="relative mt-1.5 block">
                  <select
                    value={region}
                    onChange={(e) => {
                      setRegion(e.target.value);
                      setPage(1);
                    }}
                    className="h-10 w-full cursor-pointer appearance-none bg-none rounded-xl border border-solid border-slate-300 bg-white pl-3 pr-9 text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-400 focus:border-[#02665e] focus:outline-none"
                  >
                    <option value="">All regions</option>
                    {regionOptions.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                </span>
              </label>

              <div className="min-w-0">
                <div className="text-[11.5px] font-bold text-slate-600">Driver</div>
                <div role="radiogroup" aria-label="Driver" className="mt-1.5 flex h-10 rounded-xl bg-white p-1 ring-1 ring-slate-300">
                  {DRIVER_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={driverFilter === o.key}
                      onClick={() => {
                        setDriverFilter(o.key);
                        setPage(1);
                      }}
                      className={`h-full min-w-0 flex-1 cursor-pointer whitespace-nowrap rounded-lg border-0 px-1.5 text-[12.5px] font-semibold transition-colors ${
                        driverFilter === o.key ? "bg-[#02665e] text-white shadow-sm" : "bg-transparent text-slate-600 hover:bg-slate-100"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {query || filterCount > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-slate-100 pt-3">
              <span className="text-[12.5px] text-slate-500">
                <strong className="font-bold tabular-nums text-slate-900">{shownRides.length}</strong> of {filteredRides.length} match
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {dateFrom ? (
                  <FilterChip label={`${shortDay(dateFrom)} to ${dateTo ? shortDay(dateTo) : "any"}`} onClear={() => { setDateFrom(""); setDateTo(""); setPage(1); }} />
                ) : null}
                {region ? <FilterChip label={`To ${region}`} onClear={() => { setRegion(""); setPage(1); }} /> : null}
                {driverFilter !== "any" ? (
                  <FilterChip label={driverFilter === "assigned" ? "Driver assigned" : "No driver yet"} onClear={() => { setDriverFilter("any"); setPage(1); }} />
                ) : null}
                <button type="button" onClick={clearFinders} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline">
                  Clear all
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ── Nothing matches the search or filters ── */}
      {filteredRides.length > 0 && shownRides.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-solid border-slate-200 bg-white px-6 py-10 text-center">
          <Search className="h-6 w-6 text-slate-300" aria-hidden />
          <div className="mt-3 text-[15px] font-bold text-slate-900">
            {query.trim() ? <>Nothing matches &ldquo;{query.trim()}&rdquo;</> : "No rides match these filters"}
          </div>
          <div className="mt-1 text-[13px] text-slate-500">Try another word, widen the dates or clear the filters.</div>
          <button type="button" onClick={clearFinders} className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-full border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-800 hover:border-[#02665e] hover:text-[#02665e]">
            Clear all
          </button>
        </div>
      ) : null}

      {/* ── Empty state ── */}
      {filteredRides.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
            <Car className="h-6 w-6" aria-hidden />
          </span>
          <div className="mt-3 text-[16px] font-bold text-slate-900">No rides here yet</div>
          <div className="mt-1 max-w-xs text-sm text-slate-500">
            {filter === "scheduled"
              ? "You have no scheduled rides at the moment."
              : filter === "completed"
                ? "Completed rides will appear here."
                : filter === "expired"
                  ? "You have no expired rides."
                  : "Rides appear here when you book a stay that includes transport."}
          </div>
          {filter === "all" ? (
            <Link
              href="/public/properties"
              className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
            >
              Book a stay
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : (
        /* ── Ride cards ── */
        <div id="rides-list" className={`scroll-mt-24 space-y-3 ${shownRides.length === 0 ? "hidden" : ""}`}>
          {pagedRides.map((ride) => {
            const isActive = ride.isValid;
            const isCompleted = !ride.isValid && ride.status === "COMPLETED";
            const muted = !isActive;
            const statusLabel = getStatusLabel(ride);
            return (
              <div
                key={ride.id}
                className="rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-[#02665e]/30 hover:shadow-md sm:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <DateTile date={ride.scheduledDate} muted={muted || undefined} />

                    <div className="min-w-0 flex-1">
                      {/* Route */}
                      <div className="relative pl-5">
                        <span aria-hidden className="absolute bottom-2 left-[5px] top-2 w-px bg-slate-200" />
                        <div className="relative flex min-w-0 items-center gap-2">
                          <span aria-hidden className="absolute -left-5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full bg-[#02665e] ring-2 ring-white" />
                          <span className="flex-shrink-0 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">From</span>
                          <span className="truncate text-[14px] font-semibold text-slate-900" title={formatLocation(ride, "from")}>{formatLocation(ride, "from")}</span>
                        </div>
                        <div className="relative mt-1.5 flex min-w-0 items-center gap-2">
                          <span aria-hidden className="absolute -left-5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border-2 border-solid border-[#02665e] bg-white" />
                          <span className="flex-shrink-0 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">To</span>
                          <span className="truncate text-[14px] font-semibold text-slate-900" title={formatLocation(ride, "to")}>{formatLocation(ride, "to")}</span>
                        </div>
                      </div>

                      {/* Time and driver */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-slate-600">
                        {ride.pickupTime ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                            Pickup {formatTime(ride.pickupTime)}
                          </span>
                        ) : null}
                        {ride.driver ? (
                          <span className="inline-flex min-w-0 items-center gap-1.5">
                            <User className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                            <span className="truncate font-semibold text-slate-800">{ride.driver.name}</span>
                            {ride.driver.phone ? (
                              <a href={`tel:${ride.driver.phone}`} className="inline-flex items-center gap-1 font-semibold text-[#02665e] no-underline hover:underline">
                                <Phone className="h-3 w-3" aria-hidden />
                                Call
                              </a>
                            ) : null}
                          </span>
                        ) : null}
                        {ride.rating ? (
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                            <span className="font-bold text-slate-800">{ride.rating.toFixed(1)}</span>
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 pt-3 sm:w-48 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                    <div className="text-right">
                      <span
                        className={[
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                          isActive ? "bg-[#02665e]/10 text-[#02665e]" : isCompleted ? "bg-slate-100 text-slate-700" : "bg-rose-50 text-rose-700",
                        ].join(" ")}
                      >
                        {isActive || isCompleted ? <CheckCircle className="h-3.5 w-3.5" aria-hidden /> : <Calendar className="h-3.5 w-3.5" aria-hidden />}
                        {statusLabel}
                      </span>
                      {ride.amount != null ? (
                        <div className="mt-1 text-[17px] font-extrabold tabular-nums text-slate-900">
                          {Number(ride.amount).toLocaleString("en-US")} <span className="text-[12px] font-semibold text-slate-500">TZS</span>
                        </div>
                      ) : null}
                    </div>
                    <Link
                      href={`/account/rides/${encodeURIComponent(ride.rideReference)}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
                    >
                      <Eye className="h-4 w-4" aria-hidden />
                      View details
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Pagination ── */}
      {shownRides.length > PAGE_SIZE ? (
        <nav aria-label="Rides pages" className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3 sm:flex-row">
          <span className="text-[12.5px] text-slate-500">
            Showing{" "}
            <strong className="font-bold tabular-nums text-slate-900">
              {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, shownRides.length)}
            </strong>{" "}
            of <span className="tabular-nums">{shownRides.length}</span> rides
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-700 transition-colors hover:border-[#02665e]/40 hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1)
              // First, last, and the pages around the current one; gaps become "..."
              .filter((n) => n === 1 || n === pageCount || Math.abs(n - currentPage) <= 1)
              .map((n, i, list) => (
                <span key={n} className="flex items-center gap-1">
                  {i > 0 && n - list[i - 1] > 1 ? <span className="px-1 text-[13px] text-slate-400">...</span> : null}
                  <button
                    type="button"
                    onClick={() => goToPage(n)}
                    aria-current={n === currentPage ? "page" : undefined}
                    className={[
                      "inline-flex h-9 min-w-[36px] cursor-pointer items-center justify-center rounded-lg px-2 text-[13px] font-semibold tabular-nums transition-colors",
                      n === currentPage
                        ? "border-0 bg-[#02665e] text-white"
                        : "border border-solid border-slate-200 bg-white text-slate-700 hover:border-[#02665e]/40 hover:text-[#02665e]",
                    ].join(" ")}
                  >
                    {n}
                  </button>
                </span>
              ))}
            <button
              type="button"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === pageCount}
              aria-label="Next page"
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-700 transition-colors hover:border-[#02665e]/40 hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import {
  Calendar, Download, CheckCircle, XCircle, Eye,
  ArrowRight, BookOpen, MapPin, Clock, CreditCard,
  Hash, BedDouble, DoorOpen, ChevronLeft, ChevronRight, ChevronDown,
  Search, SlidersHorizontal, X, ArrowUpDown,
} from "lucide-react";
import Link from "next/link";
import DatePicker from "@/components/ui/DatePicker";

const api = apiClient;
const PAGE_SIZE = 10;

/**
 * Tabs in the order a booking lives: unpaid, then paid and ahead, then stayed.
 * "Completed" (paid, checked out) and "Expired" (never paid, window closed)
 * used to share one "Past" tab; they mean different things, so they are apart.
 */
type BookingTab = "all" | "draft" | "active" | "completed" | "expired";
const BOOKING_TABS: Array<{ key: BookingTab; label: string; meaning: string; empty: string }> = [
  { key: "all", label: "All", meaning: "Every booking on your account.", empty: "When you book a stay, it will appear here." },
  { key: "draft", label: "Awaiting payment", meaning: "Reserved but not paid yet. Pay before the timer runs out to keep the room.", empty: "Nothing is waiting for payment." },
  { key: "active", label: "Upcoming", meaning: "Paid stays that have not ended yet, including one you are staying at now.", empty: "You have no upcoming stays right now." },
  { key: "completed", label: "Completed", meaning: "Paid stays whose check-out date has passed.", empty: "Stays move here after check-out." },
  { key: "expired", label: "Expired", meaning: "Bookings that were not paid in time. No money was taken; book again to stay.", empty: "No expired bookings." },
];

const BOOKING_SORTS = [
  { key: "checkin-late", label: "Check-in, latest" },
  { key: "checkin-soon", label: "Check-in, soonest" },
  { key: "booked-new", label: "Newest booking" },
  { key: "amount-high", label: "Highest amount" },
  { key: "amount-low", label: "Lowest amount" },
] as const;
type BookingSort = (typeof BOOKING_SORTS)[number]["key"];

const NIGHT_OPTIONS = [
  { key: "any", label: "Any", min: 0, max: Infinity },
  { key: "short", label: "1-2", min: 1, max: 2 },
  { key: "mid", label: "3-6", min: 3, max: 6 },
  { key: "long", label: "7+", min: 7, max: Infinity },
] as const;
type NightsKey = (typeof NIGHT_OPTIONS)[number]["key"];

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

type Booking = {
  id: number;
  bookingReference: string;
  property: {
    id: number;
    title: string;
    type: string;
    regionName?: string;
    district?: string;
    city?: string;
    slug?: string;
  };
  checkIn: string;
  checkOut: string;
  status: string;
  totalAmount: number;
  roomType?: string;
  rooms?: number;
  services?: any;
  isValid: boolean;
  isPaid: boolean;
  bookingCode: string | null;
  codeStatus: string | null;
  invoice?: {
    invoiceNumber?: string;
    receiptNumber?: string;
    status?: string;
  };
  dashboardBucket?: "DRAFT" | "PAID" | string;
  draftExpiresAt?: string | null;
  draftExpiryStatus?: "ACTIVE" | "EXPIRED" | null;
  draftAvailability?: {
    available: boolean;
    status: "AVAILABLE" | "UNAVAILABLE" | "PROPERTY_UNAVAILABLE";
    reason: "AVAILABLE" | "BOOKED" | "BLOCKED" | "FULL" | "PROPERTY_UNAVAILABLE";
    message: string;
    checkedAt: string;
    requestedRooms: number;
    availableRooms: number;
    bookedRooms: number;
    blockedRooms: number;
    selectedRoomType: string | null;
  } | null;
  invoiceId?: number | null;
  invoiceAccessToken?: string | null;
  createdAt: string;
};

const isDraftBooking = (b: Booking) => String(b.dashboardBucket || "").toUpperCase() === "DRAFT";
const isExpiredDraftBooking = (b: Booking) =>
  isDraftBooking(b) && String(b.draftExpiryStatus || "").toUpperCase() === "EXPIRED";

function canRequestCancellation(b: Booking): boolean {
  if (!b.bookingCode) return false;
  if (b.status === "CANCELED") return false;
  if (b.codeStatus !== "ACTIVE") return false;
  const now = new Date();
  const checkIn = new Date(b.checkIn);
  return now < checkIn;
}

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<BookingTab>("all");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<BookingSort>("checkin-late");
  const [showFilters, setShowFilters] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [checkInFrom, setCheckInFrom] = useState("");
  const [checkInTo, setCheckInTo] = useState("");
  const [region, setRegion] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [nightsFilter, setNightsFilter] = useState<NightsKey>("any");
  const [entered, setEntered] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());

  useEffect(() => {
    loadBookings();
  }, []);

  // Gentle mount animation (clean + modern)
  useEffect(() => {
    const t = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const loadBookings = async () => {
    try {
      setLoading(true);
      // The API already returns exactly what belongs here: unpaid drafts (NEW with an
      // unpaid invoice) + confirmed stays (CONFIRMED/CHECKED_IN/CHECKED_OUT with a code).
      // Keep them all so the count matches the dashboard, and so expired (checked-out)
      // stays still appear under the Expired tab. Cancelled bookings are excluded by the API.
      // The API serves at most 50 per page, so walk the pages: tabs and counts need the whole set.
      const items: Booking[] = [];
      for (let page = 1; page <= 20; page += 1) {
        const response = await api.get(`/api/customer/bookings?pageSize=50&page=${page}`);
        const batch: Booking[] = response.data.items || [];
        items.push(...batch);
        const total = Number(response.data.total || 0);
        if (batch.length < 50 || (total > 0 && items.length >= total)) break;
      }
      const visible = items.filter((b) => isDraftBooking(b) || Boolean(b?.isPaid) || Boolean(b?.bookingCode));
      setBookings(visible);
    } catch (err: any) {
      // Keep UI clean: show a small toast instead of a big banner.
      const msg = err?.response?.data?.error || "Failed to load bookings";
      try {
        window.dispatchEvent(
          new CustomEvent("nols:toast", {
            detail: { type: "error", title: "Bookings", message: msg, duration: 4500 },
          })
        );
      } catch {}
    } finally {
      setLoading(false);
    }
  };

  // Expired means: checkout date has passed (after a completed stay).
  const isExpired = (b: Booking) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const co = new Date(b.checkOut);
      co.setHours(0, 0, 0, 0);
      return co.getTime() < today.getTime();
    } catch {
      return false;
    }
  };
  const isActive = (b: Booking) => !isExpired(b);

  // Confirmed paid stays (for the "next stay" line in the header)
  const paidStays = bookings.filter((b) => !isDraftBooking(b));

  // One home per booking, so the tab counts always add up to All
  const tabOf = (b: Booking): Exclude<BookingTab, "all"> => {
    if (isExpiredDraftBooking(b)) return "expired";
    if (isDraftBooking(b)) return "draft";
    return isExpired(b) ? "completed" : "active";
  };
  const filteredBookings = filter === "all" ? bookings : bookings.filter((b) => tabOf(b) === filter);

  // Choices come from the customer's own bookings, so every option returns something
  const regionOptions = Array.from(new Set(bookings.map((b) => tidy(b.property.regionName)).filter(Boolean))).sort();
  const typeOptions = Array.from(new Set(bookings.map((b) => tidy(b.property.type)).filter(Boolean))).sort();
  const filterCount = (checkInFrom ? 1 : 0) + (region ? 1 : 0) + (propertyType ? 1 : 0) + (nightsFilter !== "any" ? 1 : 0);
  const clearFinders = () => {
    setQuery("");
    setCheckInFrom("");
    setCheckInTo("");
    setRegion("");
    setPropertyType("");
    setNightsFilter("any");
    setPage(1);
  };
  const queryWords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const fromMs = checkInFrom ? new Date(`${checkInFrom}T00:00:00`).getTime() : null;
  const toMs = checkInTo ? new Date(`${checkInTo}T23:59:59`).getTime() : null;
  const nightsRange = NIGHT_OPTIONS.find((o) => o.key === nightsFilter) || NIGHT_OPTIONS[0];
  const timeOf = (v?: string | null) => (v ? new Date(v).getTime() || 0 : 0);
  const shownBookings = filteredBookings
    .filter((b) => {
      if (queryWords.length) {
        const bag = [b.property.title, b.property.type, b.property.regionName, b.property.district, b.property.city, b.bookingCode, b.bookingReference, b.roomType]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!queryWords.every((w) => bag.includes(w))) return false;
      }
      const ci = timeOf(b.checkIn);
      if (fromMs != null && ci < fromMs) return false;
      if (toMs != null && ci > toMs) return false;
      if (region && tidy(b.property.regionName) !== region) return false;
      if (propertyType && tidy(b.property.type) !== propertyType) return false;
      if (nightsFilter !== "any") {
        const n = Math.round((timeOf(b.checkOut) - ci) / 86400000);
        if (n < nightsRange.min || n > nightsRange.max) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "checkin-soon") return timeOf(a.checkIn) - timeOf(b.checkIn);
      if (sortBy === "booked-new") return timeOf(b.createdAt) - timeOf(a.createdAt);
      if (sortBy === "amount-high") return Number(b.totalAmount || 0) - Number(a.totalAmount || 0);
      if (sortBy === "amount-low") return Number(a.totalAmount || 0) - Number(b.totalAmount || 0);
      return timeOf(b.checkIn) - timeOf(a.checkIn);
    });

  // Page the list on screen; a new tab or filter starts on page 1
  const pageCount = Math.max(1, Math.ceil(shownBookings.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pagedBookings = shownBookings.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const goToPage = (next: number) => {
    setPage(Math.min(pageCount, Math.max(1, next)));
    window.requestAnimationFrame(() => document.getElementById("bookings-list")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const tabCounts = bookings.reduce<Record<BookingTab, number>>(
    (acc, b) => {
      acc[tabOf(b)] += 1;
      acc.all += 1;
      return acc;
    },
    { all: 0, draft: 0, active: 0, completed: 0, expired: 0 },
  );
  const currentTab = BOOKING_TABS.find((t) => t.key === filter) || BOOKING_TABS[0];

  // Time-left helper for draft payment windows.
  const draftTimeLeft = (b: Booking): string | null => {
    if (!b.draftExpiresAt) return null;
    const ms = new Date(b.draftExpiresAt).getTime() - nowTick;
    if (ms <= 0) return null;
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes <= 0) return "<1m";
    return `${minutes}m`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const formatAmount = (amount: number) => {
    return Number(amount).toLocaleString("en-US");
  };

  const nights = (checkIn: string, checkOut: string) => {
    const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
    return Math.round(diff / 86400000);
  };

  const daysUntil = (dateString: string) => {
    const d = new Date(dateString);
    d.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((d.getTime() - today.getTime()) / 86400000);
  };

  // The soonest upcoming paid stay, for the header
  const nextStay = paidStays
    .filter((b) => daysUntil(b.checkOut) >= 0)
    .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime())[0];
  const nextStayLabel = (() => {
    if (!nextStay) return null;
    const d = daysUntil(nextStay.checkIn);
    if (d <= 0) return `${nextStay.property.title} · staying now`;
    if (d === 1) return `${nextStay.property.title} · tomorrow`;
    return `${nextStay.property.title} · in ${d} days`;
  })();

  const tabs = BOOKING_TABS.map((t) => ({ ...t, count: tabCounts[t.key] }));

  const CalendarTile = ({ date, muted }: { date: string; muted?: boolean }) => {
    const d = new Date(date);
    return (
      <div
        className={[
          "flex h-16 w-14 flex-shrink-0 flex-col items-center justify-center overflow-hidden rounded-xl border border-solid text-center",
          muted ? "border-slate-200 bg-slate-50" : "border-[#02665e]/25 bg-white",
        ].join(" ")}
      >
        <span className={["w-full py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white", muted ? "bg-slate-400" : "bg-[#02665e]"].join(" ")}>
          {d.toLocaleDateString("en-US", { month: "short" })}
        </span>
        <span className={["flex-1 pt-1 text-[22px] font-extrabold leading-none tabular-nums", muted ? "text-slate-500" : "text-slate-900"].join(" ")}>
          {d.getDate()}
        </span>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="w-full space-y-4" aria-busy="true">
        <span role="status" className="sr-only">Loading bookings</span>
        <div className="rounded-2xl bg-[#0a1110] px-5 py-5 sm:px-6">
          <div className="h-3 w-24 rounded bg-white/10" />
          <div className="mt-3 h-7 w-48 rounded-lg bg-white/15" />
          <div className="mt-2 h-3 w-64 rounded bg-white/10" />
          <div className="mt-5 flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-9 w-24 rounded-lg bg-white/10" />
            ))}
          </div>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-2xl border border-solid border-slate-200 bg-white p-4">
            <div className="h-16 w-14 rounded-xl bg-slate-100" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-52 rounded bg-slate-100" />
              <div className="h-3 w-40 rounded bg-slate-100" />
              <div className="h-3 w-64 rounded bg-slate-100" />
            </div>
            <div className="hidden w-40 space-y-2 sm:block">
              <div className="ml-auto h-5 w-28 rounded bg-slate-100" />
              <div className="ml-auto h-9 w-32 rounded-lg bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={["w-full space-y-4 transition-all duration-300 ease-out", entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"].join(" ")}>
      {/* ── Header band ── */}
      <div className="relative overflow-hidden rounded-2xl bg-[#0a1110] text-white shadow-[0_18px_40px_-26px_rgba(0,0,0,0.8)]" style={{ isolation: "isolate" }}>
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.6), rgba(2,102,94,0))" }} />
        <div className="px-5 pb-4 pt-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#5ec8bb]">
                <BookOpen className="h-3.5 w-3.5" aria-hidden />
                Your stays
              </div>
              <h1 className="m-0 mt-1.5 text-[26px] font-bold leading-tight text-white">
                My bookings
                {bookings.length > 0 ? <span className="ml-2 align-middle text-[14px] font-semibold text-white/50">{bookings.length}</span> : null}
              </h1>
              <p className="m-0 mt-1 text-[13.5px] text-white/60">
                {nextStayLabel ? (
                  <>
                    Next stay: <span className="font-semibold text-white">{nextStayLabel}</span>
                  </>
                ) : (
                  "Every stay you have booked, paid or awaiting payment."
                )}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <Link
                href="/account/cancellations"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/20 bg-white/5 px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-white/10"
              >
                <XCircle className="h-4 w-4" aria-hidden />
                Manage cancellations
              </Link>
              <Link
                href="/public/properties"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#03786f]"
              >
                Browse stays
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
          </div>

          {/* Filters as a segmented control */}
          <div role="tablist" aria-label="Filter bookings" className="mt-5 flex w-full gap-1 overflow-x-auto rounded-xl border border-solid border-white/10 bg-white/[0.04] p-1 [scrollbar-width:none] sm:w-fit sm:max-w-full">
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
          <p className="m-0 mt-2.5 text-[12.5px] text-white/55">{currentTab.meaning}</p>
        </div>
      </div>

      {/* ── Find: search, filters and sort ── */}
      {bookings.length > 0 ? (
        <section aria-label="Find a booking" className="rounded-2xl border border-solid border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-solid border-slate-300 bg-white px-4 text-slate-400 transition-[border-color,box-shadow] hover:border-slate-400 focus-within:border-[#02665e] focus-within:text-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]">
              <Search className="h-4 w-4 flex-shrink-0" aria-hidden />
              <span className="sr-only">Search bookings</span>
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search property, place or booking code"
                className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />
            </label>
            <div className="flex items-center gap-2">
              <span className="relative block min-w-0 flex-1 sm:w-52 sm:flex-none">
                <span className="sr-only">Sort bookings</span>
                <ArrowUpDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                <select
                  aria-label="Sort bookings"
                  value={sortBy}
                  onChange={(e) => {
                    setSortBy(e.target.value as BookingSort);
                    setPage(1);
                  }}
                  className="h-10 w-full cursor-pointer appearance-none bg-none rounded-full border border-solid border-slate-300 bg-white pl-9 pr-9 text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-400 focus:border-[#02665e] focus:outline-none"
                >
                  {BOOKING_SORTS.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              </span>
              <button
                type="button"
                aria-expanded={showFilters}
                aria-controls="booking-filters"
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
            <div id="booking-filters" className="mt-3 grid gap-x-4 gap-y-3 rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-2 sm:p-4 lg:grid-cols-4">
              {/* Every filter: a label on one line, then one 40px control */}
              <div className="relative min-w-0">
                <div className="text-[11.5px] font-bold text-slate-600">Check-in dates</div>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={datePickerOpen}
                  onClick={() => setDatePickerOpen((v) => !v)}
                  className={`mt-1.5 flex h-10 w-full cursor-pointer items-center gap-2 rounded-xl border border-solid bg-white px-3 text-left text-[13px] font-semibold transition-colors ${
                    checkInFrom || datePickerOpen ? "border-[#02665e] text-slate-900" : "border-slate-300 text-slate-500 hover:border-slate-400"
                  }`}
                >
                  <Calendar className={`h-4 w-4 flex-shrink-0 ${checkInFrom ? "text-[#02665e]" : "text-slate-400"}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {checkInFrom ? `${shortDay(checkInFrom)} to ${checkInTo ? shortDay(checkInTo) : "any"}` : "Any dates"}
                  </span>
                  {checkInFrom ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label="Clear dates"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCheckInFrom("");
                        setCheckInTo("");
                        setPage(1);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          setCheckInFrom("");
                          setCheckInTo("");
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
                      selected={checkInFrom ? (checkInTo ? [checkInFrom, checkInTo] : checkInFrom) : undefined}
                      allowRange
                      allowPast
                      resetRangeAnchor
                      onSelectAction={(value) => {
                        if (Array.isArray(value)) {
                          setCheckInFrom(value[0] || "");
                          setCheckInTo(value[value.length - 1] || "");
                          setDatePickerOpen(false);
                        } else {
                          setCheckInFrom(value);
                          setCheckInTo("");
                        }
                        setPage(1);
                      }}
                      onCloseAction={() => setDatePickerOpen(false)}
                    />
                  </div>
                ) : null}
              </div>

              <label className="block min-w-0">
                <span className="block text-[11.5px] font-bold text-slate-600">Region</span>
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

              <label className="block min-w-0">
                <span className="block text-[11.5px] font-bold text-slate-600">Property type</span>
                <span className="relative mt-1.5 block">
                  <select
                    value={propertyType}
                    onChange={(e) => {
                      setPropertyType(e.target.value);
                      setPage(1);
                    }}
                    className="h-10 w-full cursor-pointer appearance-none bg-none rounded-xl border border-solid border-slate-300 bg-white pl-3 pr-9 text-[13px] font-semibold text-slate-800 transition-colors hover:border-slate-400 focus:border-[#02665e] focus:outline-none"
                  >
                    <option value="">All types</option>
                    {typeOptions.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                </span>
              </label>

              <div className="min-w-0">
                <div className="text-[11.5px] font-bold text-slate-600">Nights</div>
                <div role="radiogroup" aria-label="Nights" className="mt-1.5 flex h-10 rounded-xl bg-white p-1 ring-1 ring-slate-300">
                  {NIGHT_OPTIONS.map((o) => (
                    <button
                      key={o.key}
                      type="button"
                      role="radio"
                      aria-checked={nightsFilter === o.key}
                      onClick={() => {
                        setNightsFilter(o.key);
                        setPage(1);
                      }}
                      className={`h-full min-w-0 flex-1 cursor-pointer whitespace-nowrap rounded-lg border-0 px-1 text-[12.5px] font-semibold transition-colors ${
                        nightsFilter === o.key ? "bg-[#02665e] text-white shadow-sm" : "bg-transparent text-slate-600 hover:bg-slate-100"
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
                <strong className="font-bold tabular-nums text-slate-900">{shownBookings.length}</strong> of {filteredBookings.length} match
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {checkInFrom ? (
                  <FilterChip label={`${shortDay(checkInFrom)} to ${checkInTo ? shortDay(checkInTo) : "any"}`} onClear={() => { setCheckInFrom(""); setCheckInTo(""); setPage(1); }} />
                ) : null}
                {region ? <FilterChip label={region} onClear={() => { setRegion(""); setPage(1); }} /> : null}
                {propertyType ? <FilterChip label={propertyType} onClear={() => { setPropertyType(""); setPage(1); }} /> : null}
                {nightsFilter !== "any" ? (
                  <FilterChip label={NIGHT_OPTIONS.find((o) => o.key === nightsFilter)?.label + " nights"} onClear={() => { setNightsFilter("any"); setPage(1); }} />
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
      {filteredBookings.length > 0 && shownBookings.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-solid border-slate-200 bg-white px-6 py-10 text-center">
          <Search className="h-6 w-6 text-slate-300" aria-hidden />
          <div className="mt-3 text-[15px] font-bold text-slate-900">
            {query.trim() ? <>Nothing matches &ldquo;{query.trim()}&rdquo;</> : "No bookings match these filters"}
          </div>
          <div className="mt-1 text-[13px] text-slate-500">Try another word, widen the dates or clear the filters.</div>
          <button type="button" onClick={clearFinders} className="mt-4 inline-flex h-9 cursor-pointer items-center rounded-full border border-solid border-slate-300 bg-white px-4 text-[13px] font-semibold text-slate-800 hover:border-[#02665e] hover:text-[#02665e]">
            Clear all
          </button>
        </div>
      ) : null}

      {/* ── Empty state ── */}
      {filteredBookings.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]">
            <BookOpen className="h-6 w-6" aria-hidden />
          </span>
          <div className="mt-3 text-[16px] font-bold text-slate-900">No bookings here yet</div>
          <div className="mt-1 max-w-xs text-sm text-slate-500">
            {currentTab.empty}
          </div>
          {filter === "all" ? (
            <Link
              href="/public/properties"
              className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
            >
              Browse stays
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : (
        <div id="bookings-list" className={`scroll-mt-24 space-y-3 ${shownBookings.length === 0 ? "hidden" : ""}`}>
          {pagedBookings.map((booking) => {
            const nightCount = nights(booking.checkIn, booking.checkOut);
            const location = [booking.property.district, booking.property.city, booking.property.regionName].filter(Boolean).join(", ");
            const facts = [
              `${formatDate(booking.checkIn)} to ${formatDate(booking.checkOut)}`,
              nightCount > 0 ? `${nightCount} ${nightCount === 1 ? "night" : "nights"}` : "",
              booking.roomType || "",
              booking.rooms ? `${booking.rooms} ${booking.rooms === 1 ? "room" : "rooms"}` : "",
            ].filter(Boolean);

            // ── Awaiting payment ──
            if (isDraftBooking(booking)) {
              const expired = String(booking.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
              const timeLeft = draftTimeLeft(booking);
              const unavailable = booking.draftAvailability && !booking.draftAvailability.available;
              const canPay = !expired && !unavailable && Boolean(booking.invoiceId && booking.invoiceAccessToken);
              const payHref = canPay
                ? `/public/booking/payment?invoiceId=${encodeURIComponent(String(booking.invoiceId))}&accessToken=${encodeURIComponent(String(booking.invoiceAccessToken))}`
                : null;
              const reselectHref = booking.property.slug ? `/public/properties/${encodeURIComponent(booking.property.slug)}` : "/public/properties";
              const blocked = expired || unavailable;
              return (
                <div
                  key={booking.id}
                  className={[
                    "rounded-2xl border border-solid bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-5",
                    blocked ? "border-rose-200" : "border-amber-300",
                  ].join(" ")}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-4">
                      <CalendarTile date={booking.checkIn} muted={blocked || undefined} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="m-0 truncate text-[16px] font-bold text-slate-900">{booking.property.title}</h3>
                          <span
                            className={[
                              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                              blocked ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800",
                            ].join(" ")}
                          >
                            {blocked ? <XCircle className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
                            {expired ? "Payment window closed" : unavailable ? "Room no longer available" : "Awaiting payment"}
                          </span>
                        </div>
                        {location ? (
                          <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-slate-500">
                            <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                            <span className="truncate">{location}</span>
                          </div>
                        ) : null}
                        <div className="mt-1.5 text-[13px] text-slate-700">{facts.join(" · ")}</div>
                        {booking.invoice?.invoiceNumber ? (
                          <div className="mt-1 font-mono text-[11.5px] text-slate-400">Invoice {booking.invoice.invoiceNumber}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 pt-3 sm:w-52 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                      <div className="text-right">
                        <div className="text-[18px] font-extrabold tabular-nums text-slate-900">
                          {formatAmount(booking.totalAmount)} <span className="text-[12px] font-semibold text-slate-500">TZS</span>
                        </div>
                        {!expired && timeLeft ? (
                          <div className="text-[12px] font-semibold text-amber-700">Pay within {timeLeft}</div>
                        ) : null}
                      </div>
                      {payHref ? (
                        <Link
                          href={payHref}
                          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
                        >
                          <CreditCard className="h-4 w-4" aria-hidden />
                          Complete payment
                        </Link>
                      ) : (
                        <Link
                          href={reselectHref}
                          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-4 text-[13px] font-semibold text-slate-800 no-underline transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                        >
                          {unavailable ? "Select another room" : "Book again"}
                          <ArrowRight className="h-4 w-4" aria-hidden />
                        </Link>
                      )}
                    </div>
                  </div>
                  <p className="m-0 mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">
                    {expired
                      ? "This payment window has closed. Please make a new booking."
                      : unavailable
                        ? booking.draftAvailability?.message || "Payment is disabled because live availability changed after this draft was created."
                        : "Complete payment to confirm this booking and receive your check-in code."}
                  </p>
                </div>
              );
            }

            // ── Paid stay ──
            const active = isActive(booking);
            const inDays = daysUntil(booking.checkIn);
            const staying = active && inDays <= 0;
            const statusLabel = !active ? "Past stay" : staying ? "Staying now" : inDays === 1 ? "Tomorrow" : `In ${inDays} days`;
            return (
              <div
                key={booking.id}
                className="rounded-2xl border border-solid border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-[#02665e]/30 hover:shadow-md sm:p-5"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-start gap-4">
                    <CalendarTile date={booking.checkIn} muted={!active || undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <h3 className="m-0 truncate text-[16px] font-bold text-slate-900">{booking.property.title}</h3>
                        <span
                          className={[
                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-bold",
                            !active ? "bg-slate-100 text-slate-600" : staying ? "bg-[#02665e] text-white" : "bg-[#02665e]/10 text-[#02665e]",
                          ].join(" ")}
                        >
                          {active ? <CheckCircle className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
                          {statusLabel}
                        </span>
                      </div>
                      {location ? (
                        <div className="mt-0.5 flex items-center gap-1 text-[12.5px] text-slate-500">
                          <MapPin className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" aria-hidden />
                          <span className="truncate">{location}</span>
                        </div>
                      ) : null}
                      <div className="mt-1.5 text-[13px] text-slate-700">{facts.join(" · ")}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11.5px] text-slate-400">
                        {booking.bookingCode ? <span>Code {booking.bookingCode}</span> : null}
                        {booking.invoice?.receiptNumber ? <span>Receipt {booking.invoice.receiptNumber}</span> : null}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-shrink-0 items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 pt-3 sm:w-56 sm:flex-col sm:items-end sm:border-t-0 sm:pt-0">
                    <div className="text-right">
                      <div className="text-[18px] font-extrabold tabular-nums text-slate-900">
                        {formatAmount(booking.totalAmount)} <span className="text-[12px] font-semibold text-slate-500">TZS</span>
                      </div>
                      <div className="text-[11.5px] text-slate-500">Paid</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {canRequestCancellation(booking) ? (
                        <Link
                          href={`/account/cancellations?code=${encodeURIComponent(booking.bookingCode!)}`}
                          title="Request cancellation"
                          aria-label="Request cancellation"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-500 no-underline transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <XCircle className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : null}
                      {booking.bookingCode ? (
                        <Link
                          href={`/account/bookings/${encodeURIComponent(booking.bookingReference)}/receipt`}
                          title="Receipt"
                          aria-label="Open receipt"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 no-underline transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : null}
                      <Link
                        href={`/account/bookings/${encodeURIComponent(booking.bookingReference)}`}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#02665e] px-3.5 text-[13px] font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
                      >
                        <Eye className="h-4 w-4" aria-hidden />
                        View details
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Pagination ── */}
      {shownBookings.length > PAGE_SIZE ? (
        <nav aria-label="Bookings pages" className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3 sm:flex-row">
          <span className="text-[12.5px] text-slate-500">
            Showing{" "}
            <strong className="font-bold tabular-nums text-slate-900">
              {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, shownBookings.length)}
            </strong>{" "}
            of <span className="tabular-nums">{shownBookings.length}</span> bookings
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

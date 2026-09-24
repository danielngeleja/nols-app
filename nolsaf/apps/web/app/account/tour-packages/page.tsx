"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import type { ReactNode } from "react";
import { ArrowRight, ArrowUpDown, Compass, CreditCard, Eye, Map as MapIcon, RotateCcw, Route, Search, SlidersHorizontal, Star, Ticket, Users, X, XCircle } from "lucide-react";

type TourBookingItem = {
  id: number;
  tourReference: string;
  bookingCode: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  travelerCount: number;
  timelineStatus: string;
  timelineCompletionStatus?: string;
  dashboardBucket: "DRAFT" | "PAID_PACKAGES" | "ACTIVE_TIMELINE" | "COMPLETED" | string;
  timelineRatingSummary?: { totalRatings?: number; averageRating?: number } | null;
  hasTimeline?: boolean;
  currency: string;
  grossAmount: number;
  createdAt: string;
  draftExpiresAt?: string | null;
  draftExpiryStatus?: "ACTIVE" | "EXPIRED" | string | null;
  operatorSnapshot?: { companyName?: string | null } | null;
  pickupValidation?: { validated?: boolean; validatedAt?: string | null } | null;
  metadata?: {
    pickupValidationOperator?: { validated?: boolean; validatedAt?: string | null } | null;
  } | null;
  pickupTimeline?: { validatedAt?: string | null } | null;
};

/** A trip someone else booked whose itinerary you joined by invite. */
type SharedTrip = {
  tourReference: string;
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  travelerCount: number;
  completed: boolean;
  operatorName: string | null;
  sharedBy: string | null;
};

/**
 * Where a trip sits from the traveller's point of view. OVERDUE is a paid trip
 * whose start date has passed without the meetup being recorded: it is not
 * "upcoming" any more, and it must never be offered as the next trip.
 */
type Stage = "ON_TOUR" | "DRAFT" | "UPCOMING" | "OVERDUE" | "COMPLETED" | "EXPIRED";
type Filter = "ALL" | "DRAFT" | "UPCOMING" | "ON_TOUR" | "COMPLETED" | "EXPIRED";

const JOURNEY_STEPS = ["Booked", "Paid", "Meetup", "On tour", "Completed"] as const;
const STAGE_ORDER: Record<Stage, number> = { ON_TOUR: 0, DRAFT: 1, UPCOMING: 2, OVERDUE: 3, COMPLETED: 4, EXPIRED: 5 };
const PAGE_STEP = 12;

type SortKey = "SMART" | "DEPART_ASC" | "DEPART_DESC" | "PRICE_DESC" | "PRICE_ASC" | "GUESTS_DESC" | "BOOKED_DESC" | "RATING_DESC" | "NAME_ASC";
const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "SMART", label: "Smart order" },
  { key: "DEPART_ASC", label: "Departure: soonest" },
  { key: "DEPART_DESC", label: "Departure: latest" },
  { key: "BOOKED_DESC", label: "Recently booked" },
  { key: "PRICE_DESC", label: "Price: high to low" },
  { key: "PRICE_ASC", label: "Price: low to high" },
  { key: "GUESTS_DESC", label: "Most travellers" },
  { key: "RATING_DESC", label: "Highest rated" },
  { key: "NAME_ASC", label: "Tour name: A to Z" },
];
const SORT_STORAGE_KEY = "nolsaf.account.tours.sort";

type DepartureWindow = "ANY" | "NEXT_30" | "NEXT_90" | "THIS_YEAR" | "PAST";
const WINDOW_OPTIONS: Array<{ key: DepartureWindow; label: string }> = [
  { key: "ANY", label: "Any time" },
  { key: "NEXT_30", label: "Next 30 days" },
  { key: "NEXT_90", label: "Next 90 days" },
  { key: "THIS_YEAR", label: "This year" },
  { key: "PAST", label: "Already departed" },
];

type AdvancedFilters = {
  destination: string;
  operator: string;
  window: DepartureWindow;
  currency: string;
  minPrice: string;
  maxPrice: string;
  minGuests: string;
};
const EMPTY_FILTERS: AdvancedFilters = { destination: "", operator: "", window: "ANY", currency: "", minPrice: "", maxPrice: "", minGuests: "" };

type ActionKind = "PAY" | "LIVE" | "VIEW" | "PAST" | "REBOOK";
const ACTION_STYLE: Record<ActionKind, { className: string; icon: typeof ArrowRight }> = {
  PAY: { className: "border-0 bg-amber-500 text-white hover:bg-amber-600", icon: CreditCard },
  LIVE: { className: "border-0 bg-[#02665e] text-white hover:bg-[#014e47]", icon: Route },
  VIEW: { className: "border-2 border-solid border-[#02665e] bg-white text-[#02665e] hover:bg-[#02665e] hover:text-white", icon: Ticket },
  PAST: { className: "border-0 bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900", icon: MapIcon },
  REBOOK: { className: "border border-dashed border-slate-400 bg-white text-slate-700 hover:border-[#02665e] hover:text-[#02665e]", icon: RotateCcw },
};
const BRAND = "#02665e";
// Preflight is off in this app, so nothing sets border-box globally: a w-full
// element with padding (the search field, the pass button) would render wider
// than its column and overflow on phones. Scoped to this page only.
const PAGE_BOX_SIZING = "#tour-packages-page, #tour-packages-page * { box-sizing: border-box; }";

function meetupValidated(item: TourBookingItem): boolean {
  return Boolean(
    item.pickupValidation?.validated ||
      item.metadata?.pickupValidationOperator?.validated ||
      item.metadata?.pickupValidationOperator?.validatedAt ||
      item.pickupValidation?.validatedAt ||
      item.pickupTimeline?.validatedAt,
  );
}

function startOfDay(value: string | number | Date): number {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function daysUntil(value: string): number {
  return Math.round((startOfDay(value) - startOfDay(Date.now())) / 86_400_000);
}

function stageOf(item: TourBookingItem): Stage {
  const bucket = String(item.dashboardBucket || "").toUpperCase();
  const completion = String(item.timelineCompletionStatus || "").toUpperCase();
  if (bucket === "DRAFT") return String(item.draftExpiryStatus || "").toUpperCase() === "EXPIRED" ? "EXPIRED" : "DRAFT";
  if (bucket === "COMPLETED" || completion === "COMPLETED_TIMELINE") return "COMPLETED";
  if (bucket === "ACTIVE_TIMELINE") return "ON_TOUR";
  if (item.startDate && daysUntil(item.startDate) < 0 && !meetupValidated(item)) return "OVERDUE";
  return "UPCOMING";
}

/** Index of the last journey step reached. */
function journeyIndex(item: TourBookingItem, stage: Stage): number {
  if (stage === "DRAFT" || stage === "EXPIRED") return 0;
  if (stage === "UPCOMING" || stage === "OVERDUE") return meetupValidated(item) ? 2 : 1;
  if (stage === "ON_TOUR") return 3;
  return 4;
}

/** Three-letter code in the style of an airport code: Serengeti becomes SER. */
function placeCode(item: TourBookingItem): string {
  const letters = String(item.destination || item.title || "").replace(/[^A-Za-z]/g, "");
  return (letters.slice(0, 3) || "TRP").toUpperCase();
}

function shortDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-US", { day: "numeric", month: "short" }) : "TBC";
}

function formatAmount(amount: number): string {
  return Number(amount || 0).toLocaleString("en-US");
}

function tourDays(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const days = Math.round((startOfDay(end) - startOfDay(start)) / 86_400_000) + 1;
  return days > 0 ? days : null;
}

const STATUS_STYLE: Record<Stage, { dot: string; chip: string }> = {
  ON_TOUR: { dot: "bg-white", chip: "bg-[#02665e] text-white" },
  DRAFT: { dot: "bg-amber-500", chip: "bg-amber-50 text-amber-800" },
  UPCOMING: { dot: "bg-[#02665e]", chip: "bg-[#02665e]/10 text-[#02665e]" },
  OVERDUE: { dot: "bg-orange-500", chip: "bg-orange-50 text-orange-800" },
  COMPLETED: { dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600" },
  EXPIRED: { dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700" },
};

/**
 * A torn-ticket perforation: a dashed rule with a half-circle bite out of each
 * edge. The bites are page-coloured circles clipped to the half that overlaps
 * the ticket, so the ticket's own border reads as cut, not as a bump.
 */
function Perforation({ tone = "light" }: { tone?: "light" | "brand" }) {
  const bite: CSSProperties = { width: 20, height: 20 };
  const borderClass = tone === "brand" ? "border-white/25" : "border-slate-200";
  return (
    <div className="relative" aria-hidden>
      <div className={`mx-5 border-0 border-t-2 border-dashed ${borderClass}`} />
      <span className="absolute top-1/2 -translate-y-1/2 rounded-full border border-solid border-slate-200 bg-neutral-50" style={{ ...bite, left: -11, clipPath: "inset(0 0 0 50%)" }} />
      <span className="absolute top-1/2 -translate-y-1/2 rounded-full border border-solid border-slate-200 bg-neutral-50" style={{ ...bite, right: -11, clipPath: "inset(0 50% 0 0)" }} />
    </div>
  );
}

// One box language for every control: a visible slate-300 edge, a firmer edge
// on hover, and a soft brand halo on focus. Selects keep right padding for the
// forms-plugin arrow; text inputs do not need it.
const BOX_BASE = "h-10 w-full min-w-0 rounded-xl border border-solid border-slate-300 bg-white py-0 text-[13px] text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] hover:border-slate-400 focus:border-[#02665e] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]";
const FIELD_CLASS = `${BOX_BASE} cursor-pointer pl-3 pr-9`;
const INPUT_CLASS = `${BOX_BASE} px-3 tabular-nums placeholder:text-slate-400`;

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      {children}
    </div>
  );
}

/** Five dots on a line; filled up to the step this trip has reached. */
function JourneyDots({ reached, muted, onBrand }: { reached: number; muted?: boolean; onBrand?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center" role="img" aria-label={`Journey: ${JOURNEY_STEPS[reached]}, step ${reached + 1} of ${JOURNEY_STEPS.length}`}>
        {JOURNEY_STEPS.map((step, index) => {
          const done = index <= reached;
          const dot = onBrand
            ? done ? "bg-white" : "bg-white/25"
            : done ? (muted ? "bg-slate-400" : "bg-[#02665e]") : "bg-slate-200";
          const line = onBrand
            ? index <= reached ? "bg-white/70" : "bg-white/20"
            : index <= reached ? (muted ? "bg-slate-300" : "bg-[#02665e]/50") : "bg-slate-200";
          return (
            <span key={step} className="flex items-center">
              {index > 0 ? <span className={`h-px w-4 ${line}`} /> : null}
              <span className={`h-2 w-2 rounded-full ${dot}`} />
            </span>
          );
        })}
      </div>
      <span className={`text-[11.5px] font-semibold ${onBrand ? "text-white/80" : muted ? "text-slate-400" : "text-slate-600"}`}>{JOURNEY_STEPS[reached]}</span>
    </div>
  );
}

export default function AccountTourPackagesPage() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TourBookingItem[]>([]);
  const [shared, setShared] = useState<SharedTrip[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_STEP);
  const [nowTick, setNowTick] = useState(Date.now());
  const [sort, setSort] = useState<SortKey>("SMART");
  const [advanced, setAdvanced] = useState<AdvancedFilters>(EMPTY_FILTERS);
  const [panelOpen, setPanelOpen] = useState(false);

  // Sort is a per-viewer convenience; storage may be unavailable, so never rely on it.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(SORT_STORAGE_KEY) as SortKey | null;
      if (saved && SORT_OPTIONS.some((option) => option.key === saved)) setSort(saved);
    } catch {}
  }, []);
  const changeSort = (next: SortKey) => {
    setSort(next);
    try { window.localStorage.setItem(SORT_STORAGE_KEY, next); } catch {}
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Trips shared with you load alongside your own; a failure there
        // never blocks your own list.
        const [res, sharedRes] = await Promise.all([
          apiClient.get("/api/customer/tour-bookings?page=1&pageSize=50"),
          apiClient.get("/api/customer/tour-bookings/shared").catch(() => null),
        ]);
        if (!alive) return;
        setItems(Array.isArray(res.data?.items) ? res.data.items : []);
        setShared(Array.isArray(sharedRes?.data?.items) ? sharedRes!.data.items : []);
        setError(null);
      } catch (err: any) {
        if (alive) setError(err?.response?.data?.error || "We could not load your tours");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Keeps the "pay within" countdown honest without a reload.
  useEffect(() => {
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => setVisibleCount(PAGE_STEP), [filter, query, sort, advanced]);

  const staged = useMemo(
    () =>
      items
        .map((item) => ({ item, stage: stageOf(item) }))
        .sort((a, b) => {
          const byStage = STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
          if (byStage !== 0) return byStage;
          if (a.stage === "UPCOMING") {
            const aPast = a.item.startDate != null && daysUntil(a.item.startDate) < 0;
            const bPast = b.item.startDate != null && daysUntil(b.item.startDate) < 0;
            if (aPast !== bPast) return aPast ? 1 : -1;
          }
          const aStart = a.item.startDate ? new Date(a.item.startDate).getTime() : Number.MAX_SAFE_INTEGER;
          const bStart = b.item.startDate ? new Date(b.item.startDate).getTime() : Number.MAX_SAFE_INTEGER;
          // Soonest first while a trip is ahead; most recent first once it is behind.
          return a.stage === "DRAFT" || a.stage === "UPCOMING" || a.stage === "ON_TOUR" ? aStart - bStart : bStart - aStart;
        }),
    [items],
  );

  // Every trip lands in exactly one tab, so the tabs always add up to All.
  const counts = useMemo(() => {
    const out: Record<Filter, number> = { ALL: staged.length, DRAFT: 0, UPCOMING: 0, ON_TOUR: 0, COMPLETED: 0, EXPIRED: 0 };
    for (const { stage } of staged) out[stage === "OVERDUE" ? "UPCOMING" : stage] += 1;
    return out;
  }, [staged]);

  // The hero is the trip happening now, or the next one still in the future.
  const hero = useMemo(
    () =>
      staged.find(({ stage }) => stage === "ON_TOUR") ??
      staged.find(({ item, stage }) => stage === "UPCOMING" && (!item.startDate || daysUntil(item.startDate) >= 0)),
    [staged],
  );
  // Choices for the advanced panel come from the traveller's own trips, so a
  // dropdown never offers a destination or operator that returns nothing.
  const options = useMemo(() => {
    const uniq = (values: Array<string | null | undefined>) =>
      [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return {
      destinations: uniq(items.map((item) => item.destination)),
      operators: uniq(items.map((item) => item.operatorSnapshot?.companyName)),
      currencies: uniq(items.map((item) => item.currency)),
    };
  }, [items]);

  const activeChips = useMemo(() => {
    const chips: Array<{ key: keyof AdvancedFilters; label: string }> = [];
    if (advanced.destination) chips.push({ key: "destination", label: advanced.destination });
    if (advanced.operator) chips.push({ key: "operator", label: advanced.operator });
    if (advanced.window !== "ANY") chips.push({ key: "window", label: WINDOW_OPTIONS.find((option) => option.key === advanced.window)?.label ?? advanced.window });
    if (advanced.currency) chips.push({ key: "currency", label: advanced.currency });
    if (advanced.minPrice || advanced.maxPrice) {
      chips.push({ key: "minPrice", label: `${advanced.minPrice ? formatAmount(Number(advanced.minPrice)) : "0"} to ${advanced.maxPrice ? formatAmount(Number(advanced.maxPrice)) : "any"}` });
    }
    if (advanced.minGuests) chips.push({ key: "minGuests", label: `${advanced.minGuests}+ guests` });
    return chips;
  }, [advanced]);

  const clearChip = (key: keyof AdvancedFilters) =>
    setAdvanced((current) => ({
      ...current,
      [key]: EMPTY_FILTERS[key],
      ...(key === "minPrice" ? { maxPrice: "" } : {}),
    }));

  const refining = Boolean(query.trim()) || activeChips.length > 0 || sort !== "SMART";
  const showHero = Boolean(hero) && filter === "ALL" && !refining;

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    const minPrice = advanced.minPrice ? Number(advanced.minPrice) : null;
    const maxPrice = advanced.maxPrice ? Number(advanced.maxPrice) : null;
    const minGuests = advanced.minGuests ? Number(advanced.minGuests) : null;
    const rows = staged.filter(({ item, stage }) => {
      const tab: Filter = stage === "OVERDUE" ? "UPCOMING" : stage;
      if (filter !== "ALL" && tab !== filter) return false;
      if (advanced.destination && item.destination !== advanced.destination) return false;
      if (advanced.operator && item.operatorSnapshot?.companyName !== advanced.operator) return false;
      if (advanced.currency && item.currency !== advanced.currency) return false;
      if (minPrice != null && Number(item.grossAmount || 0) < minPrice) return false;
      if (maxPrice != null && Number(item.grossAmount || 0) > maxPrice) return false;
      if (minGuests != null && Number(item.travelerCount || 0) < minGuests) return false;
      if (advanced.window !== "ANY") {
        if (!item.startDate) return false;
        const d = daysUntil(item.startDate);
        if (advanced.window === "NEXT_30" && (d < 0 || d > 30)) return false;
        if (advanced.window === "NEXT_90" && (d < 0 || d > 90)) return false;
        if (advanced.window === "THIS_YEAR" && new Date(item.startDate).getFullYear() !== new Date().getFullYear()) return false;
        if (advanced.window === "PAST" && d >= 0) return false;
      }
      if (!q) return true;
      return [item.title, item.destination, item.bookingCode, item.operatorSnapshot?.companyName]
        .some((value) => String(value || "").toLowerCase().includes(q));
    });
    if (sort === "SMART") return rows;
    const time = (value: string | null, missing: number) => (value ? new Date(value).getTime() : missing);
    const compare: Record<Exclude<SortKey, "SMART">, (a: TourBookingItem, b: TourBookingItem) => number> = {
      DEPART_ASC: (a, b) => time(a.startDate, Number.MAX_SAFE_INTEGER) - time(b.startDate, Number.MAX_SAFE_INTEGER),
      DEPART_DESC: (a, b) => time(b.startDate, 0) - time(a.startDate, 0),
      PRICE_DESC: (a, b) => Number(b.grossAmount || 0) - Number(a.grossAmount || 0),
      PRICE_ASC: (a, b) => Number(a.grossAmount || 0) - Number(b.grossAmount || 0),
      GUESTS_DESC: (a, b) => Number(b.travelerCount || 0) - Number(a.travelerCount || 0),
      BOOKED_DESC: (a, b) => time(b.createdAt, 0) - time(a.createdAt, 0),
      RATING_DESC: (a, b) => Number(b.timelineRatingSummary?.averageRating || 0) - Number(a.timelineRatingSummary?.averageRating || 0),
      NAME_ASC: (a, b) => a.title.localeCompare(b.title),
    };
    return [...rows].sort((a, b) => compare[sort](a.item, b.item));
  }, [staged, filter, query, advanced, sort]);

  // The hero trip is shown above the grid, so it is not repeated inside it.
  const filtered = useMemo(
    () => (showHero ? matching.filter(({ item }) => item.id !== hero?.item.id) : matching),
    [matching, showHero, hero],
  );
  const resultCount = matching.length;

  const draftTimeLeft = (item: TourBookingItem): string | null => {
    if (!item.draftExpiresAt) return null;
    const ms = new Date(item.draftExpiresAt).getTime() - nowTick;
    if (ms <= 0) return null;
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return minutes <= 0 ? "<1m" : `${minutes}m`;
  };

  const statusLabel = (item: TourBookingItem, stage: Stage): string => {
    if (stage === "EXPIRED") return "Payment window closed";
    if (stage === "DRAFT") return "Awaiting payment";
    if (stage === "ON_TOUR") return "On tour";
    if (stage === "COMPLETED") return "Completed";
    if (stage === "OVERDUE") return "Date passed";
    if (!item.startDate) return "Paid";
    const d = daysUntil(item.startDate);
    // Meetup recorded but the itinerary never opened: past, not "in -97 days".
    if (d < 0) return `Started ${shortDate(item.startDate)}`;
    return d === 0 ? "Departs today" : d === 1 ? "Departs tomorrow" : `Departs in ${d} days`;
  };

  /**
   * One action per ticket, and each kind has its own look so they read apart at
   * a glance: pay (amber), live itinerary (brand, pulsing), view trip (brand
   * outline), past itinerary (soft grey), book again (dashed, rebook icon).
   */
  const actionFor = (item: TourBookingItem, stage: Stage): { kind: ActionKind; href: string; label: string; detailHref: string } => {
    const detailHref = `/account/tour-packages/${encodeURIComponent(item.tourReference)}`;
    if (stage === "DRAFT") return { kind: "PAY", href: detailHref, label: "Pay now", detailHref };
    if (stage === "EXPIRED") return { kind: "REBOOK", href: "/public/tour-packages", label: "Book again", detailHref };
    if (stage === "ON_TOUR" && item.hasTimeline !== false) return { kind: "LIVE", href: `${detailHref}/timeline`, label: "Live itinerary", detailHref };
    if (stage === "COMPLETED" && item.hasTimeline !== false) return { kind: "PAST", href: `${detailHref}/timeline`, label: "Itinerary", detailHref };
    return { kind: "VIEW", href: detailHref, label: "View trip", detailHref };
  };

  const tabs: Array<{ key: Filter; label: string }> = [
    { key: "ALL", label: "All" },
    { key: "DRAFT", label: "To pay" },
    { key: "UPCOMING", label: "Upcoming" },
    { key: "ON_TOUR", label: "On tour" },
    { key: "COMPLETED", label: "Completed" },
    { key: "EXPIRED", label: "Expired" },
  ];

  if (loading) {
    return (
      <div id="tour-packages-page" className="w-full space-y-6" aria-busy="true">
        <style>{PAGE_BOX_SIZING}</style>
        <span role="status" className="sr-only">Loading your tours</span>
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-slate-200" />
          <div className="h-8 w-44 rounded-lg bg-slate-200" />
        </div>
        <div className="h-52 rounded-3xl bg-[#02665e]/15" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-60 rounded-3xl border border-solid border-slate-200 bg-white" />)}
        </div>
      </div>
    );
  }

  const heroItem = hero?.item;
  const heroStage = hero?.stage;
  const heroDays = heroItem ? tourDays(heroItem.startDate, heroItem.endDate) : null;
  const heroCountdown = (() => {
    if (!heroItem || !heroStage) return null;
    if (heroStage === "ON_TOUR") {
      const day = heroItem.startDate ? Math.max(1, 1 - daysUntil(heroItem.startDate)) : null;
      return day && heroDays ? { big: String(Math.min(day, heroDays)), small: `day of ${heroDays}` } : { big: "Now", small: "on tour" };
    }
    if (!heroItem.startDate) return { big: "TBC", small: "date to confirm" };
    const d = daysUntil(heroItem.startDate);
    return d === 0 ? { big: "Today", small: "departure day" } : { big: String(d), small: d === 1 ? "day to go" : "days to go" };
  })();

  return (
    // Full width of the account layout's container, like the other account pages.
    <div id="tour-packages-page" className="w-full min-w-0 space-y-6">
      <style>{PAGE_BOX_SIZING}</style>
      {/* Title row */}
      {/* One row at every width: the action sits beside the title, not under it. */}
      <header className="flex items-start justify-between gap-3 sm:items-end">
        <div className="min-w-0">
          <p className="m-0 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#02665e]">
            <Compass className="h-3.5 w-3.5" aria-hidden />
            Your journeys
          </p>
          <h1 className="m-0 mt-1.5 text-[26px] font-extrabold leading-none tracking-tight text-slate-900 sm:text-[30px]">My tours</h1>
          <p className="m-0 mt-2 text-[12.5px] text-slate-500 sm:text-[13.5px]">
            {items.length === 0
              ? "Tours you book will be kept here, from payment to the last day."
              : `${items.length} ${items.length === 1 ? "tour" : "tours"} · ${counts.UPCOMING} upcoming · ${counts.COMPLETED} completed`}
          </p>
        </div>
        <Link
          href="/public/tour-packages"
          aria-label="Find a tour"
          className="mt-5 inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-800 no-underline transition-colors hover:border-[#02665e] hover:text-[#02665e] sm:mt-0 sm:h-10 sm:px-4"
        >
          <span className="hidden min-[400px]:inline">Find a tour</span>
          <span className="min-[400px]:hidden">Find</span>
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </header>

      {/* Control bar: status, search, sort, advanced filters */}
      {items.length > 0 ? (
        <section aria-label="Find and sort your tours" className="rounded-3xl border border-solid border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(15,23,42,0.25)] sm:p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div role="tablist" aria-label="Filter tours by status" className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]">
              {tabs.map((tab) => {
                const on = filter === tab.key;
                if (tab.key !== "ALL" && counts[tab.key] === 0 && !on) return null;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setFilter(tab.key)}
                    style={{ fontFamily: "inherit" }}
                    className={[
                      "inline-flex h-9 flex-shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border-0 px-3.5 text-[13px] font-semibold transition-colors",
                      on ? "bg-slate-900 text-white" : "bg-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    ].join(" ")}
                  >
                    {tab.label}
                    <span className={["inline-flex min-w-[20px] justify-center rounded-full px-1.5 text-[11.5px] font-bold tabular-nums", on ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"].join(" ")}>{counts[tab.key]}</span>
                  </button>
                );
              })}
            </div>
            <label className="flex h-10 w-full items-center gap-2 rounded-full border border-solid border-slate-300 bg-white px-4 text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] hover:border-slate-400 focus-within:border-[#02665e] focus-within:text-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)] lg:w-80">
              <Search className="h-4 w-4 flex-shrink-0" aria-hidden />
              <span className="sr-only">Search tours</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tour, place, operator or code"
                className="h-full w-full min-w-0 border-0 bg-transparent p-0 text-[13.5px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                style={{ fontFamily: "inherit" }}
              />
            </label>
          </div>

          {/* Count on the left, sort and filters on the right: one row even on a phone. */}
          <div className="mt-3 flex items-center justify-between gap-2 border-0 border-t border-solid border-slate-100 pt-3">
            <span className="min-w-0 truncate text-[12.5px] text-slate-500">
              <span className="hidden sm:inline">Showing </span>
              <strong className="font-bold text-slate-900 tabular-nums">{resultCount}</strong> of {items.length}
              <span className="hidden min-[400px]:inline"> {items.length === 1 ? "tour" : "tours"}</span>
            </span>

            <div className="flex min-w-0 flex-shrink-0 items-center gap-2">
              <label className="inline-flex h-9 min-w-0 max-w-[11.5rem] items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white pl-3 text-[13px] text-slate-500 shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-[border-color,box-shadow] hover:border-slate-400 focus-within:border-[#02665e] focus-within:shadow-[0_0_0_3px_rgba(2,102,94,0.14)] sm:max-w-none">
                <ArrowUpDown className="h-4 w-4 flex-shrink-0" aria-hidden />
                <span className="sr-only">Sort tours</span>
                <select
                  value={sort}
                  onChange={(event) => changeSort(event.target.value as SortKey)}
                  className="h-full w-full min-w-0 cursor-pointer truncate rounded-full border-0 bg-transparent py-0 pl-0 pr-8 text-[13px] font-semibold text-slate-900 focus:outline-none focus:ring-0"
                  style={{ fontFamily: "inherit" }}
                >
                  {SORT_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setPanelOpen((open) => !open)}
                aria-expanded={panelOpen}
                aria-controls="tour-advanced-filters"
                aria-label="Filters"
                style={{ fontFamily: "inherit" }}
                className={[
                  "inline-flex h-9 flex-shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-solid px-3 text-[13px] font-semibold transition-colors sm:px-3.5",
                  panelOpen || activeChips.length > 0 ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:border-slate-400",
                ].join(" ")}
              >
                <SlidersHorizontal className="h-4 w-4" aria-hidden />
                <span className="hidden sm:inline">Filters</span>
                {activeChips.length > 0 ? <span className="inline-flex min-w-[18px] justify-center rounded-full bg-[#5ec8bb] px-1 text-[11px] font-bold text-slate-900">{activeChips.length}</span> : null}
              </button>
            </div>
          </div>

          {/* Active filters get their own wrapping row so they never squeeze the controls. */}
          {activeChips.length > 0 || query.trim() ? (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {activeChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => clearChip(chip.key)}
                  aria-label={`Remove filter ${chip.label}`}
                  style={{ fontFamily: "inherit" }}
                  className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border-0 bg-[#02665e]/10 px-2.5 text-[12px] font-semibold text-[#02665e] transition-colors hover:bg-[#02665e]/20"
                >
                  {chip.label}
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              ))}
              <button
                type="button"
                onClick={() => { setAdvanced(EMPTY_FILTERS); setQuery(""); }}
                style={{ fontFamily: "inherit" }}
                className="h-7 cursor-pointer rounded-full border-0 bg-transparent px-2 text-[12px] font-semibold text-slate-500 underline-offset-2 hover:text-slate-900 hover:underline"
              >
                Clear all
              </button>
            </div>
          ) : null}

          {panelOpen ? (
            <div id="tour-advanced-filters" className="mt-3 grid gap-x-4 gap-y-3.5 rounded-2xl border border-solid border-slate-200 bg-slate-50/70 p-3.5 sm:grid-cols-2 sm:p-4 lg:grid-cols-3">
              <FilterField label="Destination">
                <select value={advanced.destination} onChange={(event) => setAdvanced((current) => ({ ...current, destination: event.target.value }))} className={FIELD_CLASS} style={{ fontFamily: "inherit" }}>
                  <option value="">All destinations</option>
                  {options.destinations.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </FilterField>
              <FilterField label="Operator">
                <select value={advanced.operator} onChange={(event) => setAdvanced((current) => ({ ...current, operator: event.target.value }))} className={FIELD_CLASS} style={{ fontFamily: "inherit" }}>
                  <option value="">All operators</option>
                  {options.operators.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </FilterField>
              <FilterField label="Departure">
                <select value={advanced.window} onChange={(event) => setAdvanced((current) => ({ ...current, window: event.target.value as DepartureWindow }))} className={FIELD_CLASS} style={{ fontFamily: "inherit" }}>
                  {WINDOW_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                </select>
              </FilterField>
              <FilterField label={options.currencies.length === 1 ? `Price (${options.currencies[0]})` : "Price"}>
                <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                  <input inputMode="numeric" value={advanced.minPrice} onChange={(event) => setAdvanced((current) => ({ ...current, minPrice: event.target.value.replace(/[^\d]/g, "") }))} placeholder="Min" aria-label="Minimum price" className={INPUT_CLASS} style={{ fontFamily: "inherit" }} />
                  <span className="h-px w-3 bg-slate-300" aria-hidden />
                  <input inputMode="numeric" value={advanced.maxPrice} onChange={(event) => setAdvanced((current) => ({ ...current, maxPrice: event.target.value.replace(/[^\d]/g, "") }))} placeholder="Max" aria-label="Maximum price" className={INPUT_CLASS} style={{ fontFamily: "inherit" }} />
                </div>
              </FilterField>
              <FilterField label="Travellers">
                <select value={advanced.minGuests} onChange={(event) => setAdvanced((current) => ({ ...current, minGuests: event.target.value }))} className={FIELD_CLASS} style={{ fontFamily: "inherit" }}>
                  <option value="">Any group size</option>
                  {[2, 4, 6, 10].map((value) => <option key={value} value={String(value)}>{value}+ travellers</option>)}
                </select>
              </FilterField>
              {options.currencies.length > 1 ? (
                <FilterField label="Currency">
                  <select value={advanced.currency} onChange={(event) => setAdvanced((current) => ({ ...current, currency: event.target.value }))} className={FIELD_CLASS} style={{ fontFamily: "inherit" }}>
                    <option value="">All currencies</option>
                    {options.currencies.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </FilterField>
              ) : (
                <div className="flex items-end justify-end">
                  <button
                    type="button"
                    onClick={() => setPanelOpen(false)}
                    style={{ fontFamily: "inherit" }}
                    className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition-colors hover:bg-[#014e47]"
                  >
                    Show {resultCount} {resultCount === 1 ? "tour" : "tours"}
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Boarding pass for the trip that matters most right now */}
      {showHero && heroItem && heroStage && heroCountdown ? (() => {
        const action = actionFor(heroItem, heroStage);
        const ActionIcon = ACTION_STYLE[action.kind].icon;
        return (
          <section aria-label="Next trip" className="relative overflow-hidden rounded-3xl text-white shadow-[0_24px_48px_-28px_rgba(2,102,94,0.9)]" style={{ backgroundColor: BRAND }}>
            <div className="grid md:grid-cols-[minmax(0,1fr)_14rem] lg:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="min-w-0 p-5 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-white/70">
                    {heroStage === "ON_TOUR" ? "On tour now" : "Next departure"}
                  </p>
                  {heroItem.bookingCode ? <span className="font-mono text-[11px] text-white/50">{heroItem.bookingCode}</span> : null}
                </div>
                <div className="mt-4 flex items-end gap-3 sm:gap-4">
                  <span className="text-[40px] font-black leading-none tracking-[0.08em] text-white sm:text-[56px]">{placeCode(heroItem)}</span>
                  <div className="min-w-0 pb-1.5">
                    <h2 className="m-0 truncate text-[19px] font-bold leading-tight text-white">{heroItem.title}</h2>
                    <p className="m-0 mt-0.5 truncate text-[13px] text-white/70">
                      {[heroItem.destination, heroItem.operatorSnapshot?.companyName ? `with ${heroItem.operatorSnapshot.companyName}` : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <dl className="m-0 mt-5 grid grid-cols-3 gap-3 sm:mt-6 sm:max-w-md sm:gap-4">
                  {[
                    { label: "Depart", value: shortDate(heroItem.startDate) },
                    { label: "Return", value: shortDate(heroItem.endDate) },
                    { label: "Travellers", value: String(heroItem.travelerCount) },
                  ].map((fact) => (
                    <div key={fact.label}>
                      <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/55">{fact.label}</dt>
                      <dd className="m-0 mt-1 text-[16px] font-bold tabular-nums text-white">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-6">
                  <JourneyDots reached={journeyIndex(heroItem, heroStage)} onBrand />
                </div>
              </div>

              {/* Stub: dashed tear line with bites, countdown, action */}
              {/* Phones: countdown and button side by side under a horizontal tear.
                  Tablet up: a vertical stub with bites top and bottom. */}
              <div className="relative flex items-center justify-between gap-4 border-0 border-t-2 border-dashed border-white/25 px-5 py-4 md:flex-col md:justify-center md:border-l-2 md:border-t-0 md:p-6 md:text-center">
                <span aria-hidden className="absolute -top-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-neutral-50 md:block" />
                <span aria-hidden className="absolute -bottom-[11px] left-[-11px] hidden h-5 w-5 rounded-full bg-neutral-50 md:block" />
                <div className="flex items-baseline gap-2 md:block">
                  <div className="text-[36px] font-black leading-none tabular-nums text-white md:text-[52px]">{heroCountdown.big}</div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/70 md:mt-1.5 md:text-[12px]">{heroCountdown.small}</div>
                </div>
                <Link
                  href={action.href}
                  className="inline-flex h-10 flex-shrink-0 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#02665e] no-underline transition-colors hover:bg-white/90 md:w-full"
                >
                  <ActionIcon className="h-4 w-4" aria-hidden />
                  {action.label}
                </Link>
              </div>
            </div>
          </section>
        );
      })() : null}

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
          {error}
        </div>
      ) : filtered.length === 0 && !showHero ? (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
          <span className="text-[44px] font-black leading-none tracking-[0.08em] text-slate-200">TRP</span>
          <div className="mt-4 text-[16px] font-bold text-slate-900">{query.trim() || activeChips.length > 0 ? "No matching tours" : "Nothing here yet"}</div>
          <div className="mt-1 max-w-xs text-sm text-slate-500">
            {activeChips.length > 0
              ? "No tour fits these filters. Remove one to widen the search."
              : query.trim()
              ? `Nothing matches "${query.trim()}". Try a place or booking code.`
              : filter === "DRAFT"
                ? "No tour is waiting for payment."
                : filter === "ON_TOUR"
                  ? "Your live itinerary opens here once the operator records your meetup."
                  : "When you book a tour, your ticket will appear here."}
          </div>
          {activeChips.length > 0 || query.trim() ? (
            <button
              type="button"
              onClick={() => { setAdvanced(EMPTY_FILTERS); setQuery(""); }}
              style={{ fontFamily: "inherit" }}
              className="mt-5 inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:border-[#02665e] hover:text-[#02665e]"
            >
              Clear filters
            </button>
          ) : filter === "ALL" ? (
            <Link href="/public/tour-packages" className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-full px-5 text-sm font-semibold text-white no-underline" style={{ backgroundColor: BRAND }}>
              Find a tour
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : null}
        </div>
      ) : filtered.length > 0 ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.slice(0, visibleCount).map(({ item, stage }) => {
              const action = actionFor(item, stage);
              const ActionIcon = ACTION_STYLE[action.kind].icon;
              const muted = stage === "COMPLETED" || stage === "EXPIRED";
              const days = tourDays(item.startDate, item.endDate);
              const timeLeft = stage === "DRAFT" ? draftTimeLeft(item) : null;
              const ratingCount = Number(item.timelineRatingSummary?.totalRatings || 0);
              const style = STATUS_STYLE[stage];
              const operator = item.operatorSnapshot?.companyName;
              return (
                <article
                  key={item.id}
                  className={[
                    "flex flex-col rounded-3xl border border-solid bg-white transition-shadow hover:shadow-[0_16px_32px_-24px_rgba(15,23,42,0.45)]",
                    stage === "DRAFT" ? "border-amber-300" : stage === "OVERDUE" ? "border-orange-200" : "border-slate-200",
                  ].join(" ")}
                >
                  <div className="flex-1 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <span className={["text-[34px] font-black leading-none tracking-[0.08em]", muted ? "text-slate-300" : "text-[#02665e]"].join(" ")}>{placeCode(item)}</span>
                      <span className={["inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold", style.chip].join(" ")}>
                        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden />
                        {statusLabel(item, stage)}
                      </span>
                    </div>
                    <h2 className="m-0 mt-3 truncate text-[15.5px] font-bold text-slate-900">{item.title}</h2>
                    <p className="m-0 mt-0.5 truncate text-[12.5px] text-slate-500">
                      {[item.destination, operator ? `with ${operator}` : null].filter(Boolean).join(" · ") || "Tour package"}
                    </p>
                    <dl className="m-0 mt-4 grid grid-cols-3 gap-3">
                      {[
                        { label: "Depart", value: shortDate(item.startDate) },
                        { label: days ? `${days} ${days === 1 ? "day" : "days"}` : "Return", value: shortDate(item.endDate) },
                        { label: "Guests", value: String(item.travelerCount) },
                      ].map((fact) => (
                        <div key={fact.label} className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{fact.label}</dt>
                          <dd className={["m-0 mt-0.5 truncate text-[14px] font-bold tabular-nums", muted ? "text-slate-500" : "text-slate-900"].join(" ")}>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <JourneyDots reached={journeyIndex(item, stage)} muted={muted} />
                      {stage === "COMPLETED" && ratingCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[12px] font-bold text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
                          {Number(item.timelineRatingSummary?.averageRating || 0).toFixed(1)}
                          <span className="font-medium text-slate-400">({ratingCount})</span>
                        </span>
                      ) : null}
                    </div>
                    {stage === "OVERDUE" ? (
                      <p className="m-0 mt-3 text-[12px] leading-5 text-orange-800">The start date has passed and no meetup was recorded. Open the trip to contact the operator.</p>
                    ) : null}
                  </div>

                  <Perforation />

                  <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-5 pt-4">
                    <div className="min-w-0">
                      <div className={["text-[18px] font-extrabold leading-tight tabular-nums", muted ? "text-slate-500" : "text-slate-900"].join(" ")}>
                        {formatAmount(item.grossAmount)} <span className="text-[11.5px] font-semibold text-slate-400">{item.currency}</span>
                      </div>
                      <div className={["mt-0.5 truncate text-[11.5px]", timeLeft ? "font-semibold text-amber-700" : "text-slate-400"].join(" ")}>
                        {stage === "DRAFT" ? (timeLeft ? `Pay within ${timeLeft}` : "Total due") : stage === "EXPIRED" ? "Not paid" : "Paid"}
                        {item.bookingCode ? <span className="font-mono text-slate-300"> · {item.bookingCode}</span> : null}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1.5">
                      {action.href !== action.detailHref && stage !== "EXPIRED" ? (
                        <Link
                          href={action.detailHref}
                          title="Trip details"
                          aria-label={`Open details for ${item.title}`}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-solid border-slate-200 bg-white text-slate-500 no-underline transition-colors hover:border-[#02665e] hover:text-[#02665e]"
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </Link>
                      ) : null}
                      <Link
                        href={action.href}
                        aria-label={`${action.label}: ${item.title}`}
                        className={`inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-bold no-underline transition-colors ${ACTION_STYLE[action.kind].className}`}
                      >
                        {action.kind === "LIVE" ? (
                          <span className="relative flex h-2 w-2" aria-hidden>
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                          </span>
                        ) : (
                          <ActionIcon className="h-4 w-4" aria-hidden />
                        )}
                        {action.label}
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {filtered.length > visibleCount ? (
            <div className="flex flex-col items-center gap-1">
              <button
                type="button"
                onClick={() => setVisibleCount((count) => count + PAGE_STEP)}
                style={{ fontFamily: "inherit" }}
                className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-5 text-[13px] font-semibold text-slate-800 transition-colors hover:border-[#02665e] hover:text-[#02665e]"
              >
                Show more tours
              </button>
              <span className="text-[12px] text-slate-400">{visibleCount} of {filtered.length}</span>
            </div>
          ) : null}
        </>
      ) : null}

      {/* Trips you joined by invite: itinerary only, no payment or documents */}
      {shared.length ? (
        <section aria-labelledby="shared-trips-heading" className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 id="shared-trips-heading" className="m-0 text-[17px] font-extrabold tracking-tight text-slate-900">Shared with you</h2>
              <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">Trips you joined as a traveller. You can follow the itinerary and rate each stop.</p>
            </div>
            <span className="flex-shrink-0 rounded-full bg-sky-50 px-2.5 py-1 text-[12px] font-bold text-sky-700">{shared.length}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shared.map((trip) => {
              const start = trip.startDate ? new Date(trip.startDate).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : null;
              return (
                <Link
                  key={trip.tourReference}
                  href={`/account/tour-packages/${encodeURIComponent(trip.tourReference)}/timeline`}
                  className="group flex min-w-0 flex-col gap-3 rounded-3xl border border-solid border-sky-200 bg-white p-5 no-underline transition-all hover:-translate-y-px hover:border-sky-400 hover:shadow-[0_14px_28px_-22px_rgba(2,132,199,0.7)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[30px] font-black leading-none tracking-[0.08em] text-sky-700">{placeCode({ destination: trip.destination, title: trip.title } as TourBookingItem)}</span>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-sky-50 px-2.5 py-1 text-[11.5px] font-bold text-sky-700">
                      <Users className="h-3.5 w-3.5" aria-hidden />
                      {trip.sharedBy ? `Shared by ${trip.sharedBy}` : "Shared trip"}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-[15.5px] font-bold text-slate-900">{trip.title}</div>
                    <div className="truncate text-[12.5px] text-slate-500">
                      {[start, trip.destination, trip.operatorName ? `with ${trip.operatorName}` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="mt-auto flex items-center justify-between border-0 border-t border-dashed border-sky-200 pt-3">
                    <span className="text-[12px] font-semibold text-slate-500">{trip.completed ? "Trip completed" : `${trip.travelerCount} travellers`}</span>
                    <span className="inline-flex items-center gap-1 text-[13px] font-bold text-sky-700">
                      <Route className="h-4 w-4" aria-hidden />
                      Itinerary
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

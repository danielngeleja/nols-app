"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ChevronUp,
  Eye,
  EyeOff,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";

const api = apiClient;

type TourCommerceSummary = {
  operators: number;
  activeOperators: number;
  publicReadyOperators: number;
  packages: number;
  livePackages: number;
  paidBookings: number;
  disbursedPayoutBookings?: number;
  grossBookingRevenue: number;
  nolsafCommission: number;
  operatorPayout: number;
  operatorPaidOut?: number;
  operatorOwed?: number;
  owedPayoutBookings?: number;
  grossPackageFloor: number;
  currency: string;
  journey?: {
    started: { count: number; amount: number };
    paid: { count: number; amount: number };
    completed: { count: number; amount: number };
    paidOut: { count: number; amount: number };
    unpaidOpen: { count: number; amount: number; oldestAt: string | null };
    cancelledBeforePayment: number;
  };
};

type TourOperator = {
  id: number;
  status: string;
  isAvailable: boolean;
  name: string;
  email?: string | null;
  phone?: string | null;
  regions: string[];
  completedTrips: number;
  totalRevenueGenerated: number;
  readiness: {
    hasCompanyName: boolean;
    hasContact: boolean;
    approvedDocs: number;
    requiredDocs: number;
    packageCount: number;
    publicReady: boolean;
  };
};

type TourPackage = {
  id: string;
  agentId: number;
  operatorName: string;
  title: string;
  destination: string;
  category: string;
  duration: string;
  minPax: number;
  maxPax: number;
  pricePerPerson: number;
  estimatedGross: number;
  currency: string;
  nolsafPercent: number;
  bookingsCount: number;
  totalGenerated: number;
  status: string;
  onSale?: boolean;
  operatorVisible?: boolean;
  issues?: string[];
};

type TourBooking = {
  id: number;
  bookingCode: string;
  operatorName: string;
  customerName: string;
  customerEmail?: string | null;
  paidAt?: string | null;
  endDate?: string | null;
  title: string;
  destination?: string | null;
  travelerCount: number;
  startDate?: string | null;
  status: string;
  paymentStatus: string;
  payoutStatus: string;
  isPaid?: boolean;
  currency: string;
  grossAmount: number;
  amountPaid?: number;
  commissionAmount: number;
  operatorPayoutAmount: number;
  pickupValidated?: boolean;
  pickupValidatedAt?: string | null;
  createdAt: string;
};

type BookingActivityHistoryItem = {
  activityId: string;
  checked: boolean;
  at: string;
  byAgentId: number | null;
  byUserId: number | null;
  actorName: string | null;
  action: "CHECKED" | "UNCHECKED";
};

type BookingActivityHistoryResponse = {
  ok: boolean;
  history: BookingActivityHistoryItem[];
};

type ActivityHistoryFilter = {
  action: "ALL" | "CHECKED" | "UNCHECKED";
  from: string;
  to: string;
};

type OverviewPayload = {
  ok: boolean;
  summary: TourCommerceSummary;
  operators: TourOperator[];
  packages: TourPackage[];
  bookings: TourBooking[];
  draftBookings?: TourBooking[];
};

type BookingSortKey =
  | "booking"
  | "operator"
  | "customer"
  | "status"
  | "pickup"
  | "gross"
  | "commission"
  | "operatorPayout";

type PackageSortKey =
  | "package"
  | "operator"
  | "pax"
  | "from"
  | "nolsaf"
  | "bookings"
  | "generated"
  | "status";

function authify() {}

function money(value: number, currency = "TZS") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "TZS" }).format(Number(value || 0));
}

function packageStatusMeta(status: string) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "APPROVED" || normalized === "LIVE" || normalized === "PUBLISHED") {
    return {
      label: "Approved",
      className: "bg-emerald-50 text-emerald-700",
    };
  }
  if (normalized === "REJECTED") {
    return {
      label: "Rejected",
      className: "bg-rose-50 text-rose-700",
    };
  }
  if (normalized === "SUSPENDED") {
    return {
      label: "Suspended",
      className: "bg-orange-50 text-orange-700",
    };
  }
  return {
    label: "Admin review",
    className: "bg-sky-50 text-sky-700",
  };
}

function bookingStatusBadge(status: string) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "PAID" || normalized === "CONFIRMED" || normalized === "COMPLETED") {
    return "bg-emerald-50 text-emerald-700";
  }
  if (normalized === "CANCELLED" || normalized === "CANCELED" || normalized === "REFUNDED" || normalized === "REJECTED") {
    return "bg-rose-50 text-rose-700";
  }
  return "bg-sky-50 text-sky-700";
}

// "PENDING_PAYMENT" -> "Pending payment": status codes read as words, never shouted.
function readable(value: string | null | undefined) {
  const v = String(value || "").trim().replace(/_/g, " ").toLowerCase();
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : "Unknown";
}

// "DANIEL NGELEJA" -> "Daniel Ngeleja"; mixed-case names are left as typed.
function tidyName(value: string | null | undefined) {
  const v = String(value || "").trim();
  if (!v || /[a-z]/.test(v)) return v || "Guest";
  return v.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

function daysAgo(iso?: string | null) {
  if (!iso) return "at an unknown time";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "recently";
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function eatDate(iso?: string | null, withTime = false) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: "Africa/Dar_es_Salaam" }) + (withTime ? " EAT" : "");
}

// The steps a booking passes through, each marked done, waiting or not reached.
function bookingTimeline(b: TourBooking, draft: boolean) {
  const started = b.startDate ? new Date(b.startDate).getTime() <= Date.now() : false;
  const steps: Array<{ label: string; when: string; done: boolean; warn?: boolean }> = [
    { label: "Checkout started", when: eatDate(b.createdAt, true) || "Not recorded", done: true },
    b.isPaid
      ? { label: "Paid", when: eatDate(b.paidAt, true) || "Paid, time not recorded", done: true }
      : { label: "Payment", when: `Not paid, waiting since ${daysAgo(b.createdAt)}`, done: false, warn: true },
    { label: started ? "Trip started" : "Trip starts", when: b.startDate ? eatDate(b.startDate) : "Date not set", done: started && !draft },
  ];
  if (draft) return steps;
  steps.push(
    b.pickupValidated
      ? { label: "Pickup validated", when: eatDate(b.pickupValidatedAt, true) || "Validated", done: true }
      : { label: "Pickup validation", when: started ? "Trip started without it" : "Happens at the meetup", done: false, warn: started },
    /^(DISBURSED|PAID)$/i.test(String(b.payoutStatus || ""))
      ? { label: "Payout sent", when: "Operator paid", done: true }
      : { label: "Payout", when: readable(b.payoutStatus), done: false },
  );
  return steps;
}

// What a package's state means for selling it, most blocking reason first.
type PackageTone = "sale" | "hidden" | "review" | "blocked";
function packageState(p: TourPackage): { label: string; detail: string; tone: PackageTone } {
  const s = String(p.status || "").toUpperCase();
  if (p.issues && p.issues.length) return { label: "Incomplete", detail: `${p.issues.join(", ")}. Travellers cannot buy it.`, tone: "blocked" };
  if (s === "REJECTED") return { label: "Rejected", detail: "Returned to the operator.", tone: "blocked" };
  if (s === "SUSPENDED") return { label: "Suspended", detail: "Taken off sale.", tone: "blocked" };
  if (!["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"].includes(s)) return { label: "In review", detail: "Waiting for admin approval.", tone: "review" };
  if (p.operatorVisible === false) return { label: "Operator hidden", detail: "Approved, but the operator is not visible to travellers.", tone: "hidden" };
  return { label: "On sale", detail: "Travellers can book it now.", tone: "sale" };
}
const PACKAGE_TONES: Record<PackageTone, { pill: string; dot: string }> = {
  sale: { pill: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  hidden: { pill: "bg-amber-50 text-amber-700", dot: "bg-amber-400" },
  review: { pill: "bg-sky-50 text-sky-700", dot: "bg-sky-400" },
  blocked: { pill: "bg-rose-50 text-rose-700", dot: "bg-rose-400" },
};

function applyHistoryFilters(items: BookingActivityHistoryItem[], filter: ActivityHistoryFilter) {
  const fromDate = filter.from ? new Date(`${filter.from}T00:00:00`) : null;
  const toDate = filter.to ? new Date(`${filter.to}T23:59:59.999`) : null;

  return items.filter((item) => {
    if (filter.action !== "ALL" && item.action !== filter.action) return false;

    const at = new Date(item.at);
    if (Number.isNaN(at.getTime())) return false;

    if (fromDate && !Number.isNaN(fromDate.getTime()) && at < fromDate) return false;
    if (toDate && !Number.isNaN(toDate.getTime()) && at > toDate) return false;

    return true;
  });
}

function titleizeWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function formatActivityLabel(activityId: string) {
  const raw = String(activityId || "").trim();
  if (!raw) return "Activity";

  const parts = raw.split("-").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return raw;

  let cursor = 0;
  let dayLabel = "";
  const dayMatch = parts[0].match(/^d(\d+)$/i);
  if (dayMatch) {
    dayLabel = `Day ${dayMatch[1]}`;
    cursor = 1;
    if (parts[cursor] && /^\d+$/.test(parts[cursor]) && Number(parts[cursor]) === Number(dayMatch[1])) {
      cursor += 1;
    }
  }

  let timeLabel = "";
  if (
    parts.length >= cursor + 4 &&
    /^\d{1,2}$/.test(parts[cursor]) &&
    /^\d{1,2}$/.test(parts[cursor + 1]) &&
    /^\d{1,2}$/.test(parts[cursor + 2]) &&
    /^\d{1,2}$/.test(parts[cursor + 3])
  ) {
    const hh1 = parts[cursor].padStart(2, "0");
    const mm1 = parts[cursor + 1].padStart(2, "0");
    const hh2 = parts[cursor + 2].padStart(2, "0");
    const mm2 = parts[cursor + 3].padStart(2, "0");
    timeLabel = `${hh1}:${mm1}-${hh2}:${mm2}`;
    cursor += 4;
  }

  const namePart = parts.slice(cursor).join(" ").replace(/_/g, " ").trim();
  const nameLabel = namePart ? titleizeWords(namePart) : raw;

  return [dayLabel, timeLabel, nameLabel].filter(Boolean).join(" - ");
}

function recencyBucketLabel(isoDateTime: string): "Today" | "Yesterday" | "Earlier" {
  const at = new Date(isoDateTime);
  if (Number.isNaN(at.getTime())) return "Earlier";

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  if (at >= todayStart) return "Today";
  if (at >= yesterdayStart && at < todayStart) return "Yesterday";
  return "Earlier";
}

type ActivityLedgerEntry = {
  action: "CHECKED" | "UNCHECKED";
  at: string;
  actorName: string | null;
  byAgentId: number | null;
};

type ActivityLedgerTask = {
  activityId: string;
  label: string;
  currentAction: "CHECKED" | "UNCHECKED";
  latestAt: string;
  entries: ActivityLedgerEntry[];
};

function formatLedgerEventTime(isoDateTime: string) {
  const at = new Date(isoDateTime);
  if (Number.isNaN(at.getTime())) return isoDateTime;
  return at.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function groupHistoryIntoTaskLedger(items: BookingActivityHistoryItem[]) {
  const byTask = new Map<string, BookingActivityHistoryItem[]>();
  for (const item of items) {
    const key = String(item.activityId || "").trim();
    if (!key) continue;
    const arr = byTask.get(key) || [];
    arr.push(item);
    byTask.set(key, arr);
  }

  const tasks: ActivityLedgerTask[] = Array.from(byTask.entries()).map(([activityId, taskItems]) => {
    const entries = [...taskItems]
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map((item) => ({
        action: item.action,
        at: item.at,
        actorName: item.actorName,
        byAgentId: item.byAgentId,
      }));

    const latest = entries[entries.length - 1];
    return {
      activityId,
      label: formatActivityLabel(activityId),
      currentAction: latest?.action || "UNCHECKED",
      latestAt: latest?.at || "",
      entries,
    };
  });

  tasks.sort((a, b) => String(b.latestAt).localeCompare(String(a.latestAt)));
  return tasks;
}

function groupTaskLedgerByRecency(items: BookingActivityHistoryItem[]) {
  const ledger = groupHistoryIntoTaskLedger(items);
  const orderedLabels: Array<"Today" | "Yesterday" | "Earlier"> = ["Today", "Yesterday", "Earlier"];
  const buckets: Record<"Today" | "Yesterday" | "Earlier", ActivityLedgerTask[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  };

  for (const item of ledger) {
    const label = recencyBucketLabel(item.latestAt);
    buckets[label].push(item);
  }

  return orderedLabels
    .map((label) => ({ label, items: buckets[label] }))
    .filter((group) => group.items.length > 0);
}

export default function AdminAgentsTourBookingsPage() {
  const PACKAGES_PAGE_SIZE = 9;
  const BOOKINGS_PAGE_SIZE = 10;
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [showCommission, setShowCommission] = useState(false);
  const [packagesPage, setPackagesPage] = useState(1);
  const [packageSortBy, setPackageSortBy] = useState<PackageSortKey>("package");
  const [packageSortDir, setPackageSortDir] = useState<"asc" | "desc">("asc");
  const [bookingsPage, setBookingsPage] = useState(1);
  const [bookingBucket, setBookingBucket] = useState<"PAID" | "DRAFT">("PAID");
  const [bookingQuery, setBookingQuery] = useState("");
  const [bookingSortBy, setBookingSortBy] = useState<BookingSortKey>("booking");
  const [bookingSortDir, setBookingSortDir] = useState<"asc" | "desc">("desc");
  const [expandedHistory, setExpandedHistory] = useState<Record<number, boolean>>({});
  const [historyLoading, setHistoryLoading] = useState<Record<number, boolean>>({});
  const [historyByBookingId, setHistoryByBookingId] = useState<Record<number, BookingActivityHistoryItem[]>>({});
  const [historyError, setHistoryError] = useState<Record<number, string | null>>({});
  const [historyFilterByBookingId, setHistoryFilterByBookingId] = useState<Record<number, ActivityHistoryFilter>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      authify();
      const res = await api.get<OverviewPayload>("/api/admin/tour-commerce/overview");
      setOverview(res.data);
    } catch (e: any) {
      setOverview(null);
      setError(e?.response?.data?.error || e?.message || "Failed to load tour commerce");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep link from Tour experience: ?booking=CODE searches the bookings table for it,
  // on whichever list (paid or unpaid) holds that booking.
  const [deepLinkDone, setDeepLinkDone] = useState(false);
  useEffect(() => {
    if (deepLinkDone || !overview) return;
    setDeepLinkDone(true);
    const code = new URLSearchParams(window.location.search).get("booking")?.trim();
    if (!code) return;
    const inDrafts = (overview.draftBookings ?? []).some((b) => b.bookingCode === code);
    setBookingBucket(inDrafts ? "DRAFT" : "PAID");
    setBookingQuery(code);
    window.setTimeout(() => document.getElementById("tour-bookings-table")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
  }, [overview, deepLinkDone]);

  const summary = overview?.summary;
  const packages = useMemo(() => overview?.packages ?? [], [overview?.packages]);
  const paidBookings = useMemo(() => overview?.bookings ?? [], [overview?.bookings]);
  const draftBookings = useMemo(() => overview?.draftBookings ?? [], [overview?.draftBookings]);
  const bookings = useMemo(
    () => bookingBucket === "DRAFT" ? draftBookings : paidBookings,
    [bookingBucket, draftBookings, paidBookings]
  );
  const currency = summary?.currency || packages[0]?.currency || bookings[0]?.currency || "TZS";
  const [packageFilter, setPackageFilter] = useState<"ALL" | "ON_SALE" | "ATTENTION">("ALL");
  const sortedPackages = useMemo(() => {
    const rows = packages.filter((p) => {
      const tone = packageState(p).tone;
      return packageFilter === "ALL" ? true : packageFilter === "ON_SALE" ? tone === "sale" : tone !== "sale";
    });
    const readValue = (p: TourPackage): string | number => {
      switch (packageSortBy) {
        case "package":
          return `${String(p.title || "").toLowerCase()} ${String(p.destination || "").toLowerCase()}`;
        case "operator":
          return String(p.operatorName || "").toLowerCase();
        case "pax":
          return Number(p.minPax || 0) * 1000 + Number(p.maxPax || 0);
        case "from":
          return Number(p.pricePerPerson || 0);
        case "nolsaf":
          return Number(p.nolsafPercent || 0);
        case "bookings":
          return Number(p.bookingsCount || 0);
        case "generated":
          return Number(p.totalGenerated || 0);
        case "status":
          return String(p.status || "").toLowerCase();
        default:
          return 0;
      }
    };

    rows.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return packageSortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return packageSortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [packages, packageFilter, packageSortBy, packageSortDir]);

  const totalPackagePages = Math.max(1, Math.ceil(sortedPackages.length / PACKAGES_PAGE_SIZE));
  const safePackagesPage = Math.min(packagesPage, totalPackagePages);
  const packagesStart = (safePackagesPage - 1) * PACKAGES_PAGE_SIZE;
  const packagesEnd = packagesStart + PACKAGES_PAGE_SIZE;
  const pagedPackages = sortedPackages.slice(packagesStart, packagesEnd);

  // Search across the loaded list: booking code, trip, traveller and operator.
  const searchedBookings = useMemo(() => {
    const q = bookingQuery.trim().toLowerCase();
    if (!q) return bookings;
    return bookings.filter((b) => `${b.bookingCode} ${b.title} ${b.customerName} ${b.customerEmail || ""} ${b.operatorName}`.toLowerCase().includes(q));
  }, [bookings, bookingQuery]);

  const sortedBookings = useMemo(() => {
    const rows = [...searchedBookings];
    const readValue = (b: TourBooking): string | number => {
      switch (bookingSortBy) {
        case "booking":
          return `${String(b.bookingCode || "").toLowerCase()} ${String(b.title || "").toLowerCase()}`;
        case "operator":
          return String(b.operatorName || "").toLowerCase();
        case "customer":
          return String(b.customerName || "").toLowerCase();
        case "status":
          return `${String(b.status || "").toLowerCase()} ${String(b.paymentStatus || "").toLowerCase()} ${String(b.payoutStatus || "").toLowerCase()}`;
        case "pickup":
          return b.pickupValidated ? 1 : 0;
        case "gross":
          return bookingBucket === "DRAFT" ? Number(b.grossAmount || 0) : Number(b.amountPaid || 0);
        case "commission":
          return Number(b.commissionAmount || 0);
        case "operatorPayout":
          return Number(b.operatorPayoutAmount || 0);
        default:
          return 0;
      }
    };

    rows.sort((a, b) => {
      const av = readValue(a);
      const bv = readValue(b);
      if (typeof av === "number" && typeof bv === "number") {
        return bookingSortDir === "asc" ? av - bv : bv - av;
      }
      const cmp = String(av).localeCompare(String(bv));
      return bookingSortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [bookingBucket, searchedBookings, bookingSortBy, bookingSortDir]);

  const totalBookingPages = Math.max(1, Math.ceil(sortedBookings.length / BOOKINGS_PAGE_SIZE));
  const safeBookingsPage = Math.min(bookingsPage, totalBookingPages);
  const bookingsStart = (safeBookingsPage - 1) * BOOKINGS_PAGE_SIZE;
  const bookingsEnd = bookingsStart + BOOKINGS_PAGE_SIZE;
  const pagedBookings = sortedBookings.slice(bookingsStart, bookingsEnd);

  const handleBookingSort = (field: BookingSortKey) => {
    if (bookingSortBy === field) {
      setBookingSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setBookingSortBy(field);
    setBookingSortDir(field === "booking" ? "desc" : "asc");
  };

  const switchBookingBucket = (bucket: "PAID" | "DRAFT") => {
    setBookingBucket(bucket);
    setBookingsPage(1);
    setExpandedHistory({});
  };

  const handlePackageSort = (field: PackageSortKey) => {
    if (packageSortBy === field) {
      setPackageSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setPackageSortBy(field);
    setPackageSortDir(field === "generated" || field === "bookings" ? "desc" : "asc");
  };

  const renderBookingSortIcon = (field: BookingSortKey) => {
    if (bookingSortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return bookingSortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-[#02665e]" />
      : <ChevronDown className="h-3.5 w-3.5 text-[#02665e]" />;
  };

  // Unpaid checkouts have no trip, so their details never ask for a trip log.
  const toggleBookingHistory = useCallback(async (bookingId: number, withLog = true) => {
    const currentlyOpen = Boolean(expandedHistory[bookingId]);
    if (currentlyOpen) {
      setExpandedHistory((prev) => ({ ...prev, [bookingId]: false }));
      return;
    }

    setExpandedHistory((prev) => ({ ...prev, [bookingId]: true }));
    if (!withLog || historyByBookingId[bookingId]) return;

    setHistoryLoading((prev) => ({ ...prev, [bookingId]: true }));
    setHistoryError((prev) => ({ ...prev, [bookingId]: null }));
    try {
      const res = await api.get<BookingActivityHistoryResponse>(`/api/admin/tour-commerce/bookings/${bookingId}/activity-progress-history`, {
        params: { limit: 120 },
      });
      setHistoryByBookingId((prev) => ({ ...prev, [bookingId]: Array.isArray(res.data?.history) ? res.data.history : [] }));
    } catch (e: any) {
      setHistoryError((prev) => ({ ...prev, [bookingId]: e?.response?.data?.error || "Could not load activity history" }));
    } finally {
      setHistoryLoading((prev) => ({ ...prev, [bookingId]: false }));
    }
  }, [expandedHistory, historyByBookingId]);

  const updateHistoryFilter = useCallback((bookingId: number, patch: Partial<ActivityHistoryFilter>) => {
    setHistoryFilterByBookingId((prev) => {
      const current = prev[bookingId] || { action: "ALL", from: "", to: "" };
      return { ...prev, [bookingId]: { ...current, ...patch } };
    });
  }, []);

  const resetHistoryFilter = useCallback((bookingId: number) => {
    setHistoryFilterByBookingId((prev) => ({
      ...prev,
      [bookingId]: { action: "ALL", from: "", to: "" },
    }));
  }, []);

  useEffect(() => {
    setPackagesPage(1);
  }, [packages.length, packageSortBy, packageSortDir]);

  useEffect(() => {
    setBookingsPage(1);
  }, [bookings.length, bookingQuery, bookingSortBy, bookingSortDir]);

  // ── What needs an admin today, worked out from the loaded data ──
  const operators = overview?.operators ?? [];
  const payoutSent = (b: TourBooking) => /^(DISBURSED|PAID)$/i.test(String(b.payoutStatus || ""));
  const packagesInReview = packages.filter((p) => packageStatusMeta(p.status).label === "Admin review");
  const startedWithoutPickup = paidBookings.filter((b) => !b.pickupValidated && b.startDate && new Date(b.startDate).getTime() < Date.now());
  // All-time owed figures come from the server; the loaded list only holds the latest 100 bookings.
  const payoutsWaitingCount = summary?.owedPayoutBookings ?? paidBookings.filter((b) => !payoutSent(b)).length;
  const payoutWaitingAmount = summary?.operatorOwed ?? paidBookings.filter((b) => !payoutSent(b)).reduce((sum, b) => sum + Number(b.operatorPayoutAmount || 0), 0);
  const operatorsBlocked = operators.filter((o) => o.readiness.packageCount > 0 && !o.readiness.publicReady);

  const jumpTo = (id: string, then?: () => void) => {
    then?.();
    window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const attentionAll: Array<{ key: string; count: number; title: string; detail: string; tone: "amber" | "red" | "blue"; action: string; run: () => void }> = [
    {
      key: "review",
      count: packagesInReview.length,
      title: `${packagesInReview.length} ${packagesInReview.length === 1 ? "package waits" : "packages wait"} for review`,
      detail: "Operators can't sell them until they're approved.",
      tone: "amber",
      action: "Open inventory",
      run: () => jumpTo("package-inventory", () => { setPackageSortBy("status"); setPackageSortDir("asc"); }),
    },
    {
      key: "pickup",
      count: startedWithoutPickup.length,
      title: `${startedWithoutPickup.length} ${startedWithoutPickup.length === 1 ? "trip" : "trips"} started without pickup check`,
      detail: "The start date passed but the operator never validated the meetup.",
      tone: "red",
      action: "See bookings",
      run: () => jumpTo("tour-bookings-table", () => { switchBookingBucket("PAID"); setBookingSortBy("pickup"); setBookingSortDir("asc"); }),
    },
    {
      key: "payout",
      count: payoutsWaitingCount,
      title: `${payoutsWaitingCount} ${payoutsWaitingCount === 1 ? "payout" : "payouts"} not sent yet`,
      detail: `${money(payoutWaitingAmount, currency)} owed to operators on paid bookings.`,
      tone: "blue",
      action: "See bookings",
      run: () => jumpTo("tour-bookings-table", () => switchBookingBucket("PAID")),
    },
    {
      key: "drafts",
      count: draftBookings.length,
      title: `${draftBookings.length} unpaid booking ${draftBookings.length === 1 ? "attempt" : "attempts"}`,
      detail: "Travellers started checkout but haven't paid.",
      tone: "amber",
      action: "See attempts",
      run: () => jumpTo("tour-bookings-table", () => switchBookingBucket("DRAFT")),
    },
    {
      key: "operators",
      count: operatorsBlocked.length,
      title: `${operatorsBlocked.length} ${operatorsBlocked.length === 1 ? "operator has" : "operators have"} packages but can't go public`,
      detail: "Travellers only see active operators with an approved profile.",
      tone: "amber",
      action: "View operators",
      run: () => router.push("/admin/agents/tour-operators"),
    },
  ];
  const attention = attentionAll.filter((item) => item.count > 0);

  // Three honest ratios instead of one mixed funnel: each lane compares like with like
  const laneOf = (done: number, total: number) => ({ done, total, rate: total > 0 ? Math.round((done / total) * 100) : 0 });
  const operatorsTotal = summary?.operators ?? 0;
  const operatorsReady = summary?.publicReadyOperators ?? 0;
  const packagesTotal = summary?.packages ?? 0;
  const packagesLive = summary?.livePackages ?? 0;
  const bookingsPaid = summary?.paidBookings ?? 0;
  const payoutsSent = summary?.disbursedPayoutBookings ?? 0;
  const lanes = [
    {
      key: "operators",
      Icon: Building2,
      title: "Operators",
      verb: "visible to travellers",
      ...laneOf(operatorsReady, operatorsTotal),
      note: operatorsTotal === 0 ? "No operators yet" : operatorsTotal - operatorsReady > 0 ? `${operatorsTotal - operatorsReady} still hidden from travellers` : "All visible to travellers",
    },
    {
      key: "packages",
      Icon: PackageCheck,
      title: "Packages",
      verb: "live",
      ...laneOf(packagesLive, packagesTotal),
      note: packagesTotal === 0 ? "No packages yet" : packagesTotal - packagesLive > 0 ? `${packagesTotal - packagesLive} not on sale yet` : "Everything is on sale",
    },
    {
      key: "bookings",
      Icon: BadgeDollarSign,
      title: "Paid bookings",
      verb: "paid out",
      ...laneOf(payoutsSent, bookingsPaid),
      note: bookingsPaid === 0 ? "No paid bookings yet" : bookingsPaid - payoutsSent > 0 ? `${bookingsPaid - payoutsSent} payouts still to send` : "Every operator has been paid",
    },
  ];
  const laneTone = (rate: number, total: number) =>
    total === 0 ? { bar: "bg-neutral-300", text: "text-neutral-400" }
      : rate >= 80 ? { bar: "bg-emerald-600", text: "text-emerald-700" }
        : rate >= 40 ? { bar: "bg-amber-500", text: "text-amber-700" }
          : { bar: "bg-red-500", text: "text-red-600" };

  const gross = Number(summary?.grossBookingRevenue ?? 0);
  const commission = Number(summary?.nolsafCommission ?? 0);
  const paidOut = Number(summary?.operatorPaidOut ?? 0);
  const pct = (part: number) => (gross > 0 ? Math.max(0, Math.min(100, Math.round((part / gross) * 100))) : 0);
  const commissionShare = pct(commission);
  const paidOutShare = pct(paidOut);
  const owedShare = Math.max(0, Math.min(100 - commissionShare - paidOutShare, pct(payoutWaitingAmount)));
  const topPackages = [...packages].filter((p) => Number(p.totalGenerated || 0) > 0).sort((a, b) => Number(b.totalGenerated) - Number(a.totalGenerated)).slice(0, 4);
  const topMax = Math.max(1, ...topPackages.map((p) => Number(p.totalGenerated || 0)));

  const ATTENTION_TONES = {
    amber: "bg-amber-50 text-amber-700",
    red: "bg-rose-50 text-rose-700",
    blue: "bg-sky-50 text-sky-700",
  } as const;
  const CARD = "min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white";
  // Booking journey, all time, from the server (not the 100 loaded rows).
  const journey = summary?.journey;
  const jStarted = journey?.started.count ?? 0;
  const jPaid = journey?.paid.count ?? 0;
  const jDone = journey?.completed.count ?? 0;
  const jPaidOut = journey?.paidOut.count ?? 0;
  const rateOf = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : null);
  const journeyStages = [
    { key: "started", label: "Checkout started", count: jStarted, amount: journey?.started.amount ?? 0, note: "Value of every checkout", dot: "bg-white/50" },
    { key: "paid", label: "Paid", count: jPaid, amount: journey?.paid.amount ?? 0, note: "Collected, after refunds", dot: "bg-emerald-400" },
    { key: "done", label: "Trip done", count: jDone, amount: journey?.completed.amount ?? 0, note: "Paid trips completed", dot: "bg-teal-300" },
    { key: "paidout", label: "Payout sent", count: jPaidOut, amount: journey?.paidOut.amount ?? 0, note: "Sent to operators", dot: "bg-violet-300" },
  ];
  const journeyHops = [
    {
      label: "checkout to payment",
      rate: rateOf(jPaid, jStarted),
      text: `${jPaid} of ${jStarted} checkouts were paid. ${journey?.unpaidOpen.count ?? 0} are still open and ${journey?.cancelledBeforePayment ?? 0} were abandoned.`,
    },
    {
      label: "payment to trip",
      rate: rateOf(jDone, jPaid),
      text: `${jDone} of ${jPaid} paid trips are completed. The rest are still upcoming or under way.`,
    },
    {
      label: "trip to payout",
      rate: rateOf(jPaidOut, jDone),
      text: `${jPaidOut} payouts sent against ${jDone} completed trips. Operators are waiting on the rest.`,
    },
  ];
  // Payment to trip is time, not loss (trips are simply in the future), so it never counts as a leak.
  const leakIndex = (() => {
    let worst: number | null = null;
    [0, 2].forEach((i) => {
      const r = journeyHops[i].rate;
      if (r != null && r < 50 && (worst == null || r < (journeyHops[worst].rate ?? 100))) worst = i;
    });
    return worst as number | null;
  })();
  const refundedAfterPaying = Math.max(0, jStarted - jPaid - (journey?.unpaidOpen.count ?? 0) - (journey?.cancelledBeforePayment ?? 0));
  const journeySplit = [
    { key: "paid", label: "Paid", count: jPaid, bar: "bg-emerald-400" },
    { key: "open", label: "Still unpaid", count: journey?.unpaidOpen.count ?? 0, bar: "bg-amber-400" },
    { key: "abandoned", label: "Abandoned before paying", count: journey?.cancelledBeforePayment ?? 0, bar: "bg-rose-400" },
    { key: "refunded", label: "Refunded or cancelled after paying", count: refundedAfterPaying, bar: "bg-violet-300" },
  ].filter((s) => s.count > 0).map((s) => ({ ...s, pct: jStarted > 0 ? (s.count / jStarted) * 100 : 0 }));
  const oldestUnpaidDays = journey?.unpaidOpen.oldestAt
    ? Math.max(0, Math.floor((Date.now() - new Date(journey.unpaidOpen.oldestAt).getTime()) / 86_400_000))
    : null;

  // Facts for the list on screen; they add up the loaded rows the table shows.
  const sumOf = (rows: TourBooking[], pick: (b: TourBooking) => number) => rows.reduce((n, b) => n + Number(pick(b) || 0), 0);
  const draftAges = draftBookings.map((b) => Math.max(0, Math.floor((Date.now() - new Date(b.createdAt).getTime()) / 86_400_000)));
  const staleDrafts = draftAges.filter((d) => d > 7).length;
  const paidOwedRows = paidBookings.filter((b) => !payoutSent(b));
  const bookingFacts: Array<{ label: string; value: string; sub?: string; tone?: string }> = bookingBucket === "DRAFT"
    ? [
        { label: "Unpaid attempts", value: String(draftBookings.length), sub: `${new Set(draftBookings.map((b) => b.customerEmail || b.customerName)).size} different travellers` },
        { label: "Value left unpaid", value: money(sumOf(draftBookings, (b) => b.grossAmount), currency), sub: "What they would have paid", tone: draftBookings.length ? "text-amber-700" : undefined },
        { label: "Oldest waiting", value: draftAges.length ? `${Math.max(...draftAges)} ${Math.max(...draftAges) === 1 ? "day" : "days"}` : "None", sub: "Since checkout started" },
        { label: "Older than a week", value: String(staleDrafts), sub: staleDrafts ? "Unlikely to pay now" : "All recent", tone: staleDrafts ? "text-rose-600" : undefined },
      ]
    : [
        { label: "Paid bookings", value: String(paidBookings.length), sub: `${sumOf(paidBookings, (b) => b.travelerCount)} travellers` },
        { label: "Collected", value: money(sumOf(paidBookings, (b) => b.amountPaid ?? b.grossAmount), currency), sub: "From these bookings" },
        { label: "NoLSAF commission", value: showCommission ? money(sumOf(paidBookings, (b) => b.commissionAmount), currency) : "Hidden", sub: showCommission ? "Kept by NoLSAF" : "Show it in Where the money goes", tone: "text-violet-700" },
        { label: "Owed to operators", value: money(sumOf(paidOwedRows, (b) => b.operatorPayoutAmount), currency), sub: `${paidOwedRows.length} ${paidOwedRows.length === 1 ? "payout" : "payouts"} not sent`, tone: paidOwedRows.length ? "text-amber-700" : undefined },
      ];
  // The endpoint returns the latest 100 bookings; say so when the all-time total is larger.
  // Unpaid rows include abandoned checkouts, which the all-time "still unpaid" figure leaves out,
  // so only the paid list has a like-for-like total to compare against.
  const allTimeInBucket = bookingBucket === "DRAFT" ? undefined : summary?.paidBookings;
  const loadedInBucket = bookingBucket === "DRAFT" ? draftBookings.length : paidBookings.length;
  const loadedWindowNote = allTimeInBucket != null && allTimeInBucket > loadedInBucket
    ? `Showing the latest ${loadedInBucket} of ${allTimeInBucket}.`
    : "";

  const HERO_BUTTON =
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline";

  return (
    <div id="tour-commerce" className="space-y-4 min-w-0 w-full">
      {/* Preflight is disabled in this project; scope border-box so w-full pieces don't overflow */}
      <style>{`#tour-commerce, #tour-commerce * { box-sizing: border-box; }`}</style>

      {/* Header: the booking journey, from checkout to the operator being paid */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_120%_at_0%_100%,rgba(16,185,129,0.14)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
        <div className="relative px-5 pb-2 pt-5 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Agents module</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tour commerce</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Where tour bookings travel, and where they stop. All time.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/agents/tour-operators" className={HERO_BUTTON}><Building2 className="h-3.5 w-3.5" aria-hidden /> Tour operators</Link>
              <Link href="/admin/agents/tour-experience" className={HERO_BUTTON}><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Tour experience</Link>
              <button type="button" onClick={() => void load()} aria-disabled={loading} title="Refresh tour commerce" aria-label="Refresh tour commerce" className={`${HERO_BUTTON} w-9 px-0`}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          {/* Stages with the hand-off rate between each pair */}
          <ol className="m-0 mt-6 grid list-none grid-cols-2 gap-x-3 gap-y-5 p-0 lg:grid-cols-4 lg:gap-0">
            {journeyStages.map((stage, i) => {
              const hop = i > 0 ? journeyHops[i - 1] : null;
              const isLeak = hop != null && leakIndex === i - 1;
              return (
                <li key={stage.key} className="relative min-w-0 lg:pl-6 lg:first:pl-0">
                  {hop ? (
                    <span
                      className={`absolute -top-3 left-0 hidden -translate-x-1/2 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums lg:inline-flex ${isLeak ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-400/40" : "bg-white/10 text-white/70"}`}
                      title={`${hop.rate == null ? "Nothing reached" : `${hop.rate}% of`} ${journeyStages[i - 1].label.toLowerCase()} moved on`}
                    >
                      <ChevronRight className="h-3 w-3" aria-hidden /> {hop.rate == null ? "None" : `${hop.rate}%`}
                    </span>
                  ) : null}
                  {i > 0 ? <span className="absolute bottom-1 left-0 top-1 hidden w-px bg-white/10 lg:block" aria-hidden /> : null}
                  <p className="m-0 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">
                    <span className={`h-1.5 w-1.5 rounded-full ${stage.dot}`} aria-hidden /> {stage.label}
                  </p>
                  <p className={`m-0 mt-2 text-3xl font-bold tabular-nums leading-none ${stage.count ? "text-white" : "text-white/30"}`}>{loading && !summary ? "..." : stage.count}</p>
                  <p className={`m-0 mt-1.5 text-xs tabular-nums ${stage.count ? "text-white/70" : "text-white/30"}`}>{money(stage.amount, currency)}</p>
                  <p className="m-0 mt-0.5 text-[11px] text-white/40">{stage.note}</p>
                </li>
              );
            })}
          </ol>

          {/* Where every checkout ended up */}
          {journey && journey.started.count > 0 ? (
            <div className="mt-6">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                {journeySplit.map((seg) => (
                  <span key={seg.key} className={`${seg.bar} transition-all duration-700`} style={{ width: `${seg.pct}%` }} title={`${seg.label}: ${seg.count}`} />
                ))}
              </div>
              <p className="m-0 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/55">
                {journeySplit.map((seg) => (
                  <span key={seg.key} className="inline-flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${seg.bar}`} aria-hidden /> {seg.label} <span className="font-semibold tabular-nums text-white/85">{seg.count}</span>
                  </span>
                ))}
              </p>
            </div>
          ) : null}

          {/* The one sentence an admin needs */}
          <div className="mt-5 flex flex-col gap-3 border-0 border-t border-solid border-white/10 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-white/70">
              {!journey || journey.started.count === 0 ? (
                "No traveller has started a tour checkout yet."
              ) : leakIndex != null ? (
                <>
                  <span className="font-semibold text-rose-200">Biggest leak: {journeyHops[leakIndex].label}.</span>{" "}
                  {journeyHops[leakIndex].text}
                </>
              ) : (
                <span className="text-emerald-200">Every stage is moving. No step is losing most of its bookings.</span>
              )}
            </p>
            {journey && journey.unpaidOpen.count > 0 ? (
              <button type="button" onClick={() => jumpTo("tour-bookings-table", () => switchBookingBucket("DRAFT"))} className={`${HERO_BUTTON} shrink-0`}>
                {journey.unpaidOpen.count} unpaid{oldestUnpaidDays != null ? `, oldest ${oldestUnpaidDays} ${oldestUnpaidDays === 1 ? "day" : "days"}` : ""} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-solid border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{error}</span>
        </div>
      ) : null}

      <div id="overview-cards" className="grid min-w-0 scroll-mt-24 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Needs attention */}
        <section className={CARD}>
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Needs attention</p>
            {!loading ? (
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${attention.length ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
                {attention.length ? `${attention.length} open` : "All clear"}
              </span>
            ) : null}
          </div>
          {loading && !overview ? (
            <div className="space-y-2 px-5 pb-5">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-neutral-100" />)}
            </div>
          ) : attention.length ? (
            <ul className="m-0 list-none p-0">
              {attention.map((item) => (
                <li key={item.key} className="flex items-center gap-3 border-0 border-t border-solid border-neutral-100 px-5 py-3">
                  <span className={`inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-bold tabular-nums ${ATTENTION_TONES[item.tone]}`}>
                    {item.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-neutral-900">{item.title}</span>
                    <span className="block text-[11px] leading-snug text-neutral-500">{item.detail}</span>
                  </span>
                  <button
                    type="button"
                    onClick={item.run}
                    className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-[11px] font-semibold text-neutral-700 transition hover:bg-neutral-50"
                  >
                    {item.action} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-3 px-5 pb-5 pt-2">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#0b2420] text-emerald-300"><CheckCircle2 className="h-5 w-5" aria-hidden /></span>
              <span>
                <span className="block text-[13px] font-semibold text-neutral-900">Nothing waiting on you</span>
                <span className="block text-[11px] text-neutral-500">Packages reviewed, pickups validated, payouts sent.</span>
              </span>
            </div>
          )}
        </section>

        {/* Where the money goes: operator share + commission = gross */}
        <section className={CARD}>
          <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Where the money goes</p>
            <button
              type="button"
              onClick={() => setShowCommission((prev) => !prev)}
              aria-label={showCommission ? "Hide commission amount" : "Show commission amount"}
              className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-2 text-[11px] font-semibold text-neutral-600 transition hover:bg-neutral-50"
            >
              {showCommission ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
              {showCommission ? "Hide" : "Show"} commission
            </button>
          </div>
          <div className="px-5 pb-5">
            <p className="m-0 text-[11px] text-neutral-500">Paid bookings, all time, after refunds</p>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
              <span className="bg-emerald-700 transition-all duration-500" style={{ width: `${paidOutShare}%` }} title="Sent to operators" />
              <span className="bg-emerald-300 transition-all duration-500" style={{ width: `${owedShare}%` }} title="Owed to operators" />
              <span className="bg-violet-500 transition-all duration-500" style={{ width: `${commissionShare}%` }} title="NoLSAF commission" />
            </div>
            <dl className="m-0 mt-3 grid grid-cols-3 gap-3">
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-[11px] text-neutral-500"><span className="h-2 w-2 rounded-full bg-emerald-700" aria-hidden /> Sent to operators</dt>
                <dd className="m-0 mt-0.5 break-words text-sm font-bold tabular-nums text-neutral-900">{money(paidOut, currency)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-[11px] text-neutral-500"><span className="h-2 w-2 rounded-full bg-emerald-300" aria-hidden /> Still owed</dt>
                <dd className={`m-0 mt-0.5 break-words text-sm font-bold tabular-nums ${payoutWaitingAmount > 0 ? "text-amber-700" : "text-neutral-900"}`}>{money(payoutWaitingAmount, currency)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-[11px] text-neutral-500"><span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden /> NoLSAF</dt>
                <dd className="m-0 mt-0.5 break-words text-sm font-bold tabular-nums text-violet-700">{showCommission ? money(commission, currency) : "Hidden"}</dd>
                <dd className="m-0 text-[11px] text-neutral-400">{commissionShare}% of gross</dd>
              </div>
            </dl>
            {gross === 0 && !loading ? (
              <p className="m-0 mt-4 rounded-xl bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500">No paid tour booking yet. Unpaid checkout attempts never count here.</p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Pipeline health */}
        <section className={CARD}>
          <p className="m-0 px-5 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Pipeline health</p>
          <ul className="m-0 list-none p-0">
            {lanes.map((lane) => {
              const tone = laneTone(lane.rate, lane.total);
              return (
                <li key={lane.key} className="flex items-center gap-3.5 border-0 border-t border-solid border-neutral-100 px-5 py-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/[0.08] text-[#02665e]">
                    <lane.Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="m-0 text-[13px] font-semibold text-neutral-900">{lane.title}</p>
                      <p className="m-0 shrink-0 text-[11px] text-neutral-500">
                        <span className="text-sm font-bold tabular-nums text-neutral-950">{lane.done}</span>
                        <span className="tabular-nums"> of {lane.total}</span> {lane.verb}
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100">
                        <span className={`block h-1.5 rounded-full transition-all duration-500 ${tone.bar}`} style={{ width: `${lane.rate}%` }} />
                      </span>
                      <span className={`w-10 shrink-0 text-right text-[11px] font-bold tabular-nums ${tone.text}`}>{lane.total ? `${lane.rate}%` : "None"}</span>
                    </div>
                    <p className="m-0 mt-1 text-[11px] text-neutral-500">{lane.note}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Top earning packages */}
        <section className={CARD}>
          <p className="m-0 px-5 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Top earning packages</p>
          {topPackages.length ? (
            <ol className="m-0 list-none space-y-3 px-5 pb-5 pt-1">
              {topPackages.map((pkg, i) => (
                <li key={pkg.id} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] font-semibold text-neutral-900">
                      <span className="mr-1.5 text-neutral-400">{i + 1}</span>{pkg.title}
                    </span>
                    <span className="shrink-0 text-xs font-bold tabular-nums text-neutral-900">{money(pkg.totalGenerated, pkg.currency)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100">
                      <span className="block h-1.5 rounded-full bg-emerald-600" style={{ width: `${(Number(pkg.totalGenerated || 0) / topMax) * 100}%` }} />
                    </span>
                    <span className="shrink-0 text-[11px] text-neutral-400">{pkg.operatorName} · {pkg.bookingsCount} {pkg.bookingsCount === 1 ? "booking" : "bookings"}</span>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="m-0 px-5 pb-5 text-xs text-neutral-500">No package has earned from a paid booking yet.</p>
          )}
        </section>
      </div>
      {/* Package inventory: the shelf of what operators sell */}
      <section id="package-inventory" className={`scroll-mt-24 ${CARD}`}>
        <div className="flex flex-col gap-3 px-5 pb-3 pt-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Package inventory</p>
            <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Filter packages">
              {([
                ["ALL", "All", packages.length],
                ["ON_SALE", "On sale", packages.filter((p) => packageState(p).tone === "sale").length],
                ["ATTENTION", "Not on sale", packages.filter((p) => packageState(p).tone !== "sale").length],
              ] as const).map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={packageFilter === key}
                  onClick={() => { setPackageFilter(key); setPackagesPage(1); }}
                  className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-solid px-3 text-xs font-semibold transition ${packageFilter === key ? "border-[#0b2420] bg-[#0b2420] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
                >
                  {label}
                  <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${packageFilter === key ? "bg-white/15" : "bg-neutral-100 text-neutral-500"}`}>{count}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-neutral-400">Sort</span>
            {([["generated", "Earned"], ["from", "Price"], ["package", "Name"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => handlePackageSort(key)}
                aria-pressed={packageSortBy === key}
                className={`inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border-0 px-2 text-xs font-semibold transition ${packageSortBy === key ? "bg-neutral-100 text-neutral-900" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}
              >
                {label} {packageSortBy === key ? (packageSortDir === "asc" ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />) : null}
              </button>
            ))}
            <Link href="/admin/agents/tour-operators" className="inline-flex h-8 items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50">
              Operators <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>

        {loading && !overview ? (
          <div className="grid gap-3 border-0 border-t border-solid border-neutral-100 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-44 animate-pulse rounded-xl bg-neutral-100" />)}
          </div>
        ) : sortedPackages.length === 0 ? (
          <p className="m-0 border-0 border-t border-solid border-neutral-100 px-5 py-12 text-center text-sm text-neutral-500">
            {packages.length === 0 ? "No operator has built a tour package yet." : packageFilter === "ON_SALE" ? "No package is on sale right now." : "Every package is on sale."}
          </p>
        ) : (
          <ul className="m-0 grid list-none gap-3 border-0 border-t border-solid border-neutral-100 p-5 sm:grid-cols-2 xl:grid-cols-3">
            {pagedPackages.map((pkg) => {
              const state = packageState(pkg);
              const tone = PACKAGE_TONES[state.tone];
              const pct = Number(pkg.nolsafPercent || 0);
              const perPersonCut = pct > 0 && pkg.pricePerPerson > 0 ? (pkg.pricePerPerson * pct) / 100 : 0;
              const groupSize = pkg.minPax === pkg.maxPax ? `${pkg.minPax} ${pkg.minPax === 1 ? "person" : "people"}` : `${pkg.minPax} to ${pkg.maxPax} people`;
              return (
                <li key={pkg.id} className={`flex min-w-0 flex-col rounded-xl border border-solid bg-white transition hover:shadow-[0_8px_24px_-16px_rgba(15,23,42,0.35)] ${state.tone === "blocked" ? "border-rose-200" : "border-neutral-200"}`}>
                  <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${tone.pill}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden /> {state.label}
                    </span>
                    <span className="min-w-0 truncate text-[11px] text-neutral-400">{pkg.operatorName}</span>
                  </div>
                  <div className="px-4 pt-2">
                    <p className={`m-0 truncate text-sm font-bold ${pkg.issues?.includes("No title") ? "italic text-neutral-400" : "text-neutral-950"}`}>{pkg.title}</p>
                    <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-500">{[pkg.destination, pkg.duration, pkg.category].filter(Boolean).join(" · ") || "No destination or duration yet"}</p>
                  </div>
                  <div className="mx-4 mt-3 flex items-end justify-between gap-3 border-0 border-t border-solid border-neutral-100 pt-3">
                    <div className="min-w-0">
                      <p className="m-0 text-[10px] text-neutral-400">From, per person</p>
                      <p className={`m-0 text-lg font-bold tabular-nums leading-tight ${pkg.pricePerPerson > 0 ? "text-neutral-950" : "text-neutral-300"}`}>{pkg.pricePerPerson > 0 ? money(pkg.pricePerPerson, pkg.currency) : "No price"}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="m-0 text-[10px] text-neutral-400">Group</p>
                      <p className="m-0 text-xs font-semibold tabular-nums text-neutral-700">{groupSize}</p>
                    </div>
                  </div>
                  <p className="m-0 mx-4 mb-3 mt-1.5 text-[11px] text-violet-700">
                    {pct > 0 ? <>NoLSAF {pct}%{perPersonCut ? <span className="text-neutral-400"> · {money(perPersonCut, pkg.currency)} per person</span> : null}</> : <span className="text-neutral-400">No commission rate yet</span>}
                  </p>
                  <div className="mt-auto flex items-center justify-between gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-2.5">
                    {state.tone === "sale" ? (
                      <>
                        <span className="text-[11px] text-neutral-500"><span className="font-semibold tabular-nums text-neutral-900">{Number(pkg.bookingsCount || 0)}</span> paid {Number(pkg.bookingsCount || 0) === 1 ? "booking" : "bookings"}</span>
                        <span className="text-[11px] font-semibold tabular-nums text-neutral-900">{Number(pkg.totalGenerated || 0) ? money(pkg.totalGenerated, pkg.currency) : <span className="font-normal text-neutral-400">Not sold yet</span>}</span>
                      </>
                    ) : (
                      <span className={`text-[11px] ${state.tone === "blocked" ? "text-rose-700" : state.tone === "hidden" ? "text-amber-700" : "text-sky-700"}`}>{state.detail}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && sortedPackages.length > PACKAGES_PAGE_SIZE ? (
          <Pager start={packagesStart} end={Math.min(packagesEnd, sortedPackages.length)} total={sortedPackages.length} page={safePackagesPage} pages={totalPackagePages} onPage={setPackagesPage} />
        ) : null}
      </section>

      {/* Tour bookings */}
      <section id="tour-bookings-table" className={`scroll-mt-24 ${CARD}`}>
        {/* Title and the two lists as underline tabs */}
        <div className="flex flex-col gap-1 px-5 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Tour bookings</p>
            <div className="mt-2 flex gap-1" role="tablist" aria-label="Booking type">
              {([["PAID", "Paid", paidBookings.length, "bg-emerald-500"], ["DRAFT", "Unpaid attempts", draftBookings.length, "bg-amber-400"]] as const).map(([key, label, count, dot]) => {
                const on = bookingBucket === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => switchBookingBucket(key)}
                    className={`relative inline-flex h-10 cursor-pointer items-center gap-2 border-0 bg-transparent px-1 pr-3 text-sm font-semibold transition-colors first:pl-0 ${on ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700"}`}
                  >
                    <span className={`h-2 w-2 rounded-full ${dot} ${on ? "" : "opacity-50"}`} aria-hidden />
                    {label}
                    <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500"}`}>{count}</span>
                    {on ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-neutral-900 first:left-0" aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="relative w-full pb-2 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-[calc(50%-4px)] h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              value={bookingQuery}
              onChange={(e) => { setBookingQuery(e.target.value); setBookingsPage(1); }}
              placeholder="Code, traveller or operator"
              aria-label="Search tour bookings"
              className="block h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-8 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            {bookingQuery ? (
              <button type="button" onClick={() => setBookingQuery("")} aria-label="Clear search" className="absolute right-1.5 top-[calc(50%-4px)] grid h-6 w-6 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-neutral-400 hover:bg-neutral-100"><X className="h-3.5 w-3.5" aria-hidden /></button>
            ) : null}
          </div>
        </div>

        {/* What this list adds up to */}
        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-y border-solid border-neutral-100 bg-neutral-100 lg:grid-cols-4">
          {bookingFacts.map((f) => (
            <div key={f.label} className="min-w-0 bg-white px-5 py-3">
              <dt className="text-[11px] text-neutral-500">{f.label}</dt>
              <dd className={`m-0 mt-0.5 truncate text-base font-bold tabular-nums ${f.tone ?? "text-neutral-900"}`}>{f.value}</dd>
              {f.sub ? <dd className="m-0 truncate text-[11px] text-neutral-400">{f.sub}</dd> : null}
            </div>
          ))}
        </dl>
        <p className="m-0 flex items-center gap-1.5 px-5 py-2.5 text-[11px] text-neutral-500">
          {bookingBucket === "DRAFT" ? <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-hidden /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />}
          {bookingBucket === "DRAFT"
            ? "Checkouts that never reached payment. They earn nothing and are listed so you can spot drop-off and follow up."
            : "Bookings the traveller paid, with the split between NoLSAF and the operator."}
          {loadedWindowNote ? <span className="text-neutral-400">{loadedWindowNote}</span> : null}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-0 border-y border-solid border-neutral-100">
                {([
                  ["booking", "Booking", "left"],
                  ["operator", "Operator", "left"],
                  ["customer", "Traveller", "left"],
                  ["status", "State", "left"],
                  ["pickup", "Pickup", "left"],
                  ["gross", bookingBucket === "DRAFT" ? "Would be" : "Paid", "right"],
                  ["commission", "NoLSAF", "right"],
                  ["operatorPayout", "Operator", "right"],
                ] as const).map(([key, label, align]) => (
                  <th key={key} className={`px-3 py-2.5 first:pl-5 ${align === "right" ? "text-right" : ""}`}>
                    <button type="button" onClick={() => handleBookingSort(key)} className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400 hover:text-neutral-700">
                      {label} {renderBookingSortIcon(key)}
                    </button>
                  </th>
                ))}
                <th className="px-3 py-2.5 pr-5"><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-5 py-12 text-center text-neutral-500">Loading bookings</td></tr>
              ) : sortedBookings.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-12 text-center text-neutral-500">
                    {bookingQuery.trim() ? `Nothing matches "${bookingQuery.trim()}".` : bookingBucket === "DRAFT" ? "No unpaid checkout attempts." : "No paid tour bookings yet."}
                  </td>
                </tr>
              ) : (
                pagedBookings.map((booking) => {
                  const isOpen = Boolean(expandedHistory[booking.id]);
                  const isHistoryLoading = Boolean(historyLoading[booking.id]);
                  const historyItems = historyByBookingId[booking.id] || [];
                  const historyFilter = historyFilterByBookingId[booking.id] || { action: "ALL", from: "", to: "" };
                  const filteredHistoryItems = applyHistoryFilters(historyItems, historyFilter);
                  const groupedHistoryItems = groupTaskLedgerByRecency(filteredHistoryItems);
                  const bookingHistoryError = historyError[booking.id];
                  const draft = bookingBucket === "DRAFT";
                  return (
                    <Fragment key={booking.id}>
                      <tr className="border-0 border-b border-solid border-neutral-100 transition hover:bg-emerald-50/40">
                        <td className="px-3 py-3 pl-5">
                          <div className="whitespace-nowrap font-mono text-[11px] font-semibold text-neutral-800">{booking.bookingCode}</div>
                          <div className="max-w-[230px] truncate text-[11px] text-neutral-500">{booking.title}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-neutral-700">{booking.operatorName}</td>
                        <td className="px-3 py-3">
                          <div className="whitespace-nowrap font-semibold text-neutral-800">{tidyName(booking.customerName)}</div>
                          <div className="text-[11px] text-neutral-500">{booking.travelerCount} {booking.travelerCount === 1 ? "traveller" : "travellers"}{booking.startDate ? ` · ${new Date(booking.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${bookingStatusBadge(booking.status)}`}>{readable(booking.status)}</span>
                          <div className="mt-1 text-[11px] text-neutral-500">{draft ? `Started ${daysAgo(booking.createdAt)}` : `Payout ${readable(booking.payoutStatus).toLowerCase()}`}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {draft ? (
                            <span className="text-neutral-300">Not applicable</span>
                          ) : booking.pickupValidated ? (
                            <>
                              <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Validated</span>
                              {booking.pickupValidatedAt ? (
                                <div className="mt-1 text-[11px] text-neutral-500">
                                  {new Date(booking.pickupValidatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">Waiting</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right">
                          {draft ? (
                            <span className="font-semibold tabular-nums text-neutral-500">{money(booking.grossAmount, booking.currency)}</span>
                          ) : booking.isPaid ? (
                            <span className="font-semibold tabular-nums text-neutral-900">{money(booking.amountPaid ?? booking.grossAmount, booking.currency)}</span>
                          ) : (
                            <span className="text-[11px] font-semibold text-amber-700">Waiting payment</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-violet-700">
                          {draft ? <span className="text-neutral-300">None</span> : money(booking.commissionAmount, booking.currency)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-emerald-700">
                          {draft ? <span className="font-normal text-neutral-300">None</span> : money(booking.operatorPayoutAmount, booking.currency)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 pr-5">
                          <button
                            type="button"
                            onClick={() => void toggleBookingHistory(booking.id, !draft)}
                            aria-expanded={isOpen}
                            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50"
                          >
                            {isOpen ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
                            {isOpen ? "Hide" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colSpan={9} className="border-0 border-b border-solid border-neutral-100 bg-neutral-50/70 px-5 py-4">
                            <div className={`grid gap-4 ${draft ? "lg:grid-cols-2" : "lg:grid-cols-[minmax(0,15rem)_minmax(0,15rem)_minmax(0,1fr)]"}`}>
                              {/* Timeline: what happened to this booking, in order */}
                              <div className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white p-4">
                                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Timeline</p>
                                <ol className="m-0 mt-3 list-none p-0">
                                  {bookingTimeline(booking, draft).map((step, idx, all) => (
                                    <li key={step.label} className="relative flex gap-2.5 pb-3 last:pb-0">
                                      {idx < all.length - 1 ? <span className="absolute bottom-0 left-[4px] top-3 w-px bg-neutral-200" aria-hidden /> : null}
                                      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${step.done ? "bg-emerald-500" : step.warn ? "bg-amber-400" : "bg-neutral-200"}`} aria-hidden />
                                      <span className="min-w-0">
                                        <span className={`block text-xs font-semibold ${step.done ? "text-neutral-900" : "text-neutral-500"}`}>{step.label}</span>
                                        <span className={`block text-[11px] ${step.warn ? "text-amber-700" : "text-neutral-400"}`}>{step.when}</span>
                                      </span>
                                    </li>
                                  ))}
                                </ol>
                              </div>

                              {/* Money split */}
                              <div className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white p-4">
                                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{draft ? "If it is paid" : "Money"}</p>
                                <dl className="m-0 mt-3 space-y-2 text-xs">
                                  <div className="flex justify-between gap-3"><dt className="text-neutral-500">{draft ? "Traveller would pay" : "Traveller paid"}</dt><dd className="m-0 font-semibold tabular-nums text-neutral-900">{money(draft ? booking.grossAmount : booking.amountPaid ?? booking.grossAmount, booking.currency)}</dd></div>
                                  <div className="flex justify-between gap-3"><dt className="text-neutral-500">NoLSAF commission</dt><dd className="m-0 font-semibold tabular-nums text-violet-700">{money(booking.commissionAmount, booking.currency)}</dd></div>
                                  <div className="flex justify-between gap-3 border-0 border-t border-solid border-neutral-100 pt-2"><dt className="text-neutral-500">To the operator</dt><dd className="m-0 font-semibold tabular-nums text-emerald-700">{money(booking.operatorPayoutAmount, booking.currency)}</dd></div>
                                  {!draft ? (
                                    <div className="flex justify-between gap-3"><dt className="text-neutral-500">Payout</dt><dd className="m-0 font-semibold text-neutral-800">{readable(booking.payoutStatus)}</dd></div>
                                  ) : null}
                                </dl>
                                {draft ? <p className="m-0 mt-3 text-[11px] text-neutral-400">Nothing is earned or owed until the traveller pays.</p> : null}
                              </div>

                              {/* Trip log: only a paid booking has a trip to log */}
                              {draft ? null : (
                                <div className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white p-4">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Trip log{historyItems.length ? ` · ${filteredHistoryItems.length} of ${historyItems.length}` : ""}</p>
                                    {historyItems.length > 0 ? (
                                      <div className="flex gap-1" role="group" aria-label="Filter trip log">
                                        {(["ALL", "CHECKED", "UNCHECKED"] as const).map((a) => (
                                          <button
                                            key={a}
                                            type="button"
                                            aria-pressed={historyFilter.action === a}
                                            onClick={() => updateHistoryFilter(booking.id, { action: a })}
                                            className={`h-6 cursor-pointer rounded-md border border-solid px-2 text-[10px] font-semibold ${historyFilter.action === a ? "border-[#0b2420] bg-[#0b2420] text-white" : "border-neutral-200 bg-white text-neutral-600"}`}
                                          >
                                            {a === "ALL" ? "All" : a === "CHECKED" ? "Ticked" : "Unticked"}
                                          </button>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>

                                  {/* Date range only earns its space on a long log */}
                                  {historyItems.length > 8 ? (
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <div className="w-[140px]">
                                        <DatePickerField label="From" value={historyFilter.from} onChangeAction={(nextIso) => updateHistoryFilter(booking.id, { from: String(nextIso).split("T")[0] })} max={historyFilter.to || undefined} allowPast={true} twoMonths={false} widthClassName="w-full" size="sm" />
                                      </div>
                                      <div className="w-[140px]">
                                        <DatePickerField label="To" value={historyFilter.to} onChangeAction={(nextIso) => updateHistoryFilter(booking.id, { to: String(nextIso).split("T")[0] })} min={historyFilter.from || undefined} allowPast={true} twoMonths={false} widthClassName="w-full" size="sm" />
                                      </div>
                                      {historyFilter.from || historyFilter.to || historyFilter.action !== "ALL" ? (
                                        <button type="button" onClick={() => resetHistoryFilter(booking.id)} className="cursor-pointer border-0 bg-transparent p-0 text-[11px] font-semibold text-neutral-500 hover:text-neutral-900 hover:underline">Clear</button>
                                      ) : null}
                                    </div>
                                  ) : null}

                                  <div className="mt-3">
                                    {isHistoryLoading ? (
                                      <p className="m-0 text-xs text-neutral-500">Loading the trip log</p>
                                    ) : bookingHistoryError ? (
                                      <p className="m-0 text-xs text-rose-600">{bookingHistoryError}</p>
                                    ) : historyItems.length === 0 ? (
                                      <p className="m-0 text-xs text-neutral-500">
                                        {booking.startDate && new Date(booking.startDate).getTime() > Date.now()
                                          ? "The trip has not started. The operator ticks itinerary items as the trip runs."
                                          : "The operator has not ticked any itinerary item."}
                                      </p>
                                    ) : filteredHistoryItems.length === 0 ? (
                                      <p className="m-0 text-xs text-neutral-500">No events match these filters.</p>
                                    ) : (
                                      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                                        {groupedHistoryItems.map((group) => (
                                          <div key={group.label}>
                                            <p className="m-0 mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{group.label}</p>
                                            <ul className="m-0 list-none p-0">
                                              {group.items.map((item, idx) => (
                                                <li key={`${group.label}-${item.activityId}-${idx}`} className="flex items-start gap-2.5 border-0 border-b border-solid border-neutral-100 py-2 last:border-b-0">
                                                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.currentAction === "CHECKED" ? "bg-emerald-500" : "bg-amber-400"}`} aria-hidden />
                                                  <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-xs font-semibold text-neutral-900">{item.label}</span>
                                                    <span className="block text-[11px] text-neutral-500">
                                                      {item.entries.map((entry, entryIdx) => (
                                                        <span key={`${item.activityId}-${entry.at}-${entryIdx}`} title={`By ${entry.actorName || "the operator"}`}>
                                                          {entryIdx ? " · " : ""}{entry.action === "CHECKED" ? "Ticked" : "Unticked"} {formatLedgerEventTime(entry.at)}
                                                        </span>
                                                      ))}
                                                    </span>
                                                  </span>
                                                  <span className={`shrink-0 text-[10px] font-bold ${item.currentAction === "CHECKED" ? "text-emerald-700" : "text-amber-700"}`}>{item.currentAction === "CHECKED" ? "Done" : "Undone"}</span>
                                                </li>
                                              ))}
                                            </ul>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && sortedBookings.length > BOOKINGS_PAGE_SIZE ? (
          <Pager start={bookingsStart} end={Math.min(bookingsEnd, sortedBookings.length)} total={sortedBookings.length} page={safeBookingsPage} pages={totalBookingPages} onPage={setBookingsPage} />
        ) : null}
      </section>
    </div>
  );
}

function Pager({ start, end, total, page, pages, onPage }: { start: number; end: number; total: number; page: number; pages: number; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-5 py-3 text-xs text-neutral-500">
      <span>Showing <span className="font-bold text-neutral-800">{start + 1} to {end}</span> of <span className="font-bold text-neutral-800">{total}</span></span>
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => onPage(Math.max(1, page - 1))} aria-disabled={page <= 1} className="h-8 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 hover:bg-neutral-50 aria-disabled:pointer-events-none aria-disabled:opacity-40">Prev</button>
        <span className="tabular-nums">Page {page} of {pages}</span>
        <button type="button" onClick={() => onPage(Math.min(pages, page + 1))} aria-disabled={page >= pages} className="h-8 cursor-pointer rounded-lg border border-solid border-neutral-200 bg-white px-2.5 font-bold text-neutral-600 hover:bg-neutral-50 aria-disabled:pointer-events-none aria-disabled:opacity-40">Next</button>
      </div>
    </div>
  );
}

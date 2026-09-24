"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  Eye,
  EyeOff,
  Info,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  Wallet,
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
  grossPackageFloor: number;
  currency: string;
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
};

type TourBooking = {
  id: number;
  bookingCode: string;
  operatorName: string;
  customerName: string;
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
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }
  if (normalized === "REJECTED") {
    return {
      label: "Rejected",
      className: "border-rose-200 bg-rose-50 text-rose-700",
    };
  }
  if (normalized === "SUSPENDED") {
    return {
      label: "Suspended",
      className: "border-orange-200 bg-orange-50 text-orange-700",
    };
  }
  return {
    label: "Admin review",
    className: "border-blue-200 bg-blue-50 text-blue-700",
  };
}

function bookingStatusBadge(status: string) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "PAID" || normalized === "CONFIRMED" || normalized === "COMPLETED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  if (normalized === "CANCELLED" || normalized === "REJECTED") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  return "border-blue-200 bg-blue-50 text-blue-700";
}

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
  const PACKAGES_PAGE_SIZE = 10;
  const BOOKINGS_PAGE_SIZE = 10;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [showCommission, setShowCommission] = useState(false);
  const [packagesPage, setPackagesPage] = useState(1);
  const [packageSortBy, setPackageSortBy] = useState<PackageSortKey>("package");
  const [packageSortDir, setPackageSortDir] = useState<"asc" | "desc">("asc");
  const [bookingsPage, setBookingsPage] = useState(1);
  const [bookingBucket, setBookingBucket] = useState<"PAID" | "DRAFT">("PAID");
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

  const summary = overview?.summary;
  const packages = useMemo(() => overview?.packages ?? [], [overview?.packages]);
  const paidBookings = useMemo(() => overview?.bookings ?? [], [overview?.bookings]);
  const draftBookings = useMemo(() => overview?.draftBookings ?? [], [overview?.draftBookings]);
  const bookings = useMemo(
    () => bookingBucket === "DRAFT" ? draftBookings : paidBookings,
    [bookingBucket, draftBookings, paidBookings]
  );
  const currency = summary?.currency || packages[0]?.currency || bookings[0]?.currency || "TZS";
  const sortedPackages = useMemo(() => {
    const rows = [...packages];
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
  }, [packages, packageSortBy, packageSortDir]);

  const totalPackagePages = Math.max(1, Math.ceil(sortedPackages.length / PACKAGES_PAGE_SIZE));
  const safePackagesPage = Math.min(packagesPage, totalPackagePages);
  const packagesStart = (safePackagesPage - 1) * PACKAGES_PAGE_SIZE;
  const packagesEnd = packagesStart + PACKAGES_PAGE_SIZE;
  const pagedPackages = sortedPackages.slice(packagesStart, packagesEnd);

  const sortedBookings = useMemo(() => {
    const rows = [...bookings];
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
  }, [bookingBucket, bookings, bookingSortBy, bookingSortDir]);

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

  const renderPackageSortIcon = (field: PackageSortKey) => {
    if (packageSortBy !== field) return <ChevronsUpDown className="h-3.5 w-3.5 text-gray-400" />;
    return packageSortDir === "asc"
      ? <ChevronUp className="h-3.5 w-3.5 text-[#02665e]" />
      : <ChevronDown className="h-3.5 w-3.5 text-[#02665e]" />;
  };

  const formatHistoryAt = (value: string) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const toggleBookingHistory = useCallback(async (bookingId: number) => {
    const currentlyOpen = Boolean(expandedHistory[bookingId]);
    if (currentlyOpen) {
      setExpandedHistory((prev) => ({ ...prev, [bookingId]: false }));
      return;
    }

    setExpandedHistory((prev) => ({ ...prev, [bookingId]: true }));
    if (historyByBookingId[bookingId]) return;

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
  }, [bookings.length, bookingSortBy, bookingSortDir]);

  const kpis = [
    { label: "Operators", value: summary?.operators ?? 0, icon: Building2, color: "from-blue-500 to-blue-600" },
    { label: "Public Ready", value: summary?.publicReadyOperators ?? 0, icon: ShieldCheck, color: "from-emerald-500 to-emerald-600" },
    { label: "Packages", value: summary?.packages ?? 0, icon: PackageCheck, color: "from-amber-500 to-amber-600" },
    { label: "Disbursed Payout", value: summary?.disbursedPayoutBookings ?? 0, icon: CheckCircle2, color: "from-cyan-500 to-cyan-600" },
    {
      label: "NoLSAF Commission",
      value: showCommission ? money(summary?.nolsafCommission ?? 0, currency) : "*****",
      icon: BadgeDollarSign,
      color: "from-violet-500 to-violet-600",
    },
  ];

  return (
    <div className="space-y-4 sm:space-y-6 min-w-0 w-full">
      <div
        className="relative rounded-2xl overflow-hidden shadow-2xl"
        style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)" }}
      >
        <svg
          aria-hidden
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          preserveAspectRatio="xMidYMid slice"
          viewBox="0 0 900 220"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="860" cy="45" r="200" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none" />
          <circle cx="860" cy="45" r="155" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
          <circle cx="820" cy="15" r="115" stroke="white" strokeOpacity="0.045" strokeWidth="1" fill="none" />
          <circle cx="28" cy="208" r="130" stroke="white" strokeOpacity="0.04" strokeWidth="1" fill="none" />
          {[44, 88, 132, 176].map((y) => (
            <line key={y} x1="0" y1={y} x2="900" y2={y} stroke="rgba(255,255,255,0.030)" strokeWidth="1" />
          ))}
          <polyline
            points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78"
            fill="none"
            stroke="white"
            strokeOpacity="0.16"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polygon
            points="0,188 80,165 160,178 240,145 320,160 400,125 480,142 560,108 640,124 720,90 800,106 880,78 900,220 0,220"
            fill="white"
            fillOpacity="0.026"
          />
          <polyline
            points="0,200 100,186 200,194 300,172 400,180 500,160 600,168 700,148 800,156 900,136"
            fill="none"
            stroke="white"
            strokeOpacity="0.07"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {([[720, 90], [560, 108], [880, 78], [240, 145]] as [number, number][]).map(([px, py]) => (
            <circle key={`${px}-${py}`} cx={px} cy={py} r="3" fill="white" fillOpacity="0.22" />
          ))}
          <radialGradient id="tourCommerceHeaderGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(10,92,130,0.45)" />
            <stop offset="100%" stopColor="rgba(10,92,130,0)" />
          </radialGradient>
          <ellipse cx="450" cy="110" rx="300" ry="140" fill="url(#tourCommerceHeaderGlow)" />
        </svg>

        <button
          type="button"
          onClick={() => void load()}
          className="absolute right-4 top-4 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full text-white transition-all duration-150 hover:bg-white/15 focus:outline-none"
          style={{ background: "rgba(255,255,255,0.10)", border: "1px solid rgba(255,255,255,0.15)" }}
          title="Refresh tour commerce"
          aria-label="Refresh tour commerce"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>

        <div className="relative z-10 flex flex-col items-center text-center px-6 py-10 sm:py-14">
          <div
            className="mb-5 inline-flex items-center justify-center rounded-full"
            style={{
              width: 64,
              height: 64,
              background: "rgba(255,255,255,0.10)",
              border: "1.5px solid rgba(255,255,255,0.18)",
              boxShadow: "0 0 0 8px rgba(255,255,255,0.05), 0 8px 32px rgba(0,0,0,0.35)",
            }}
          >
            <Wallet className="h-7 w-7" style={{ color: "rgba(255,255,255,0.92)" }} aria-hidden />
          </div>

          <div className="text-xs font-black uppercase tracking-widest text-emerald-100">No4P Agents Platform</div>
          <h1
            className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight"
            style={{ color: "#ffffff", textShadow: "0 2px 12px rgba(0,0,0,0.4)" }}
          >
            Tour Commerce Control
          </h1>
          <p className="mt-2 max-w-2xl text-sm sm:text-base" style={{ color: "rgba(255,255,255,0.60)" }}>
            Verified operators, sellable packages, paid bookings, commissions and payouts.
          </p>

          <div className="mt-4 relative group/tooltip inline-flex">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all duration-150 focus:outline-none"
              style={{
                background: "rgba(255,255,255,0.10)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "rgba(255,255,255,0.70)",
              }}
              aria-label="Tour commerce info"
              onClick={(e) => {
                e.preventDefault();
                try {
                  (e.currentTarget as HTMLButtonElement).focus();
                } catch {
                  // ignore
                }
              }}
            >
              <Info className="h-3.5 w-3.5" aria-hidden />
              <span>Commerce overview</span>
            </button>
            <div
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 z-50 mb-2 w-72 max-w-[calc(100vw-1rem)] whitespace-normal break-words rounded-xl px-3 py-2.5 text-left text-xs opacity-0 shadow-2xl transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
              style={{ background: "#0b2a38", border: "1px solid rgba(255,255,255,0.10)", color: "rgba(255,255,255,0.85)" }}
            >
              <div className="font-semibold mb-1" style={{ color: "#fff" }}>Tour commerce</div>
              <div className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.60)" }}>
                Track operator readiness, package inventory and the booking money flow from gross paid amount to NoLSAF commission and operator payout.
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {kpis.map((item) => {
          const Icon = item.icon;
          const isCommissionCard = item.label === "NoLSAF Commission";
          return (
            <div key={item.label} className="group relative rounded-xl border border-gray-200 bg-white p-4 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
              <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-0 group-hover:opacity-5 transition-opacity duration-200`} />
              {isCommissionCard ? (
                <button
                  type="button"
                  onClick={() => setShowCommission((prev) => !prev)}
                  className="absolute right-3 top-3 z-20 inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white/90 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-600 hover:bg-white"
                  aria-label={showCommission ? "Hide commission amount" : "Show commission amount"}
                  title={showCommission ? "Hide amount" : "Show amount"}
                >
                  {showCommission ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              ) : null}
              <div className="relative z-10">
                <div className={`inline-flex items-center justify-center h-9 w-9 rounded-lg bg-gradient-to-br ${item.color} text-white shadow-sm`}>
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-3 text-xl font-black text-gray-900">{item.value}</div>
                <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-gray-500">{item.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-gradient-to-r from-[#02665e]/10 to-emerald-50 rounded-xl border border-[#02665e]/20 p-4 sm:p-6 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-[#02665e]/15">
          <div className="text-center sm:pr-6">
            <div className="text-xs sm:text-sm font-medium text-gray-600">Gross Booking Revenue</div>
            <div className="mt-1 text-lg sm:text-xl font-bold text-gray-900">{money(summary?.grossBookingRevenue ?? 0, currency)}</div>
          </div>
          <div className="text-center sm:pl-6">
            <div className="text-xs sm:text-sm font-medium text-gray-600">Operator Payout</div>
            <div className="mt-1 text-lg sm:text-xl font-bold text-[#02665e]">{money(summary?.operatorPayout ?? 0, currency)}</div>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Package Inventory</h2>
            <p className="mt-1 text-xs text-gray-500">Tour packages ready for public listing</p>
          </div>
          <Link href="/admin/agents/tour-operators" className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 no-underline hover:bg-gray-50 transition-colors whitespace-nowrap">
            View Operators
          </Link>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">
                  <button type="button" onClick={() => handlePackageSort("package")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Package {renderPackageSortIcon("package")}
                  </button>
                </th>
                <th className="px-4 py-3 whitespace-nowrap">
                  <button type="button" onClick={() => handlePackageSort("operator")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Operator {renderPackageSortIcon("operator")}
                  </button>
                </th>
                <th className="px-4 py-3 whitespace-nowrap">
                  <button type="button" onClick={() => handlePackageSort("pax")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Pax {renderPackageSortIcon("pax")}
                  </button>
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => handlePackageSort("from")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    From {renderPackageSortIcon("from")}
                  </button>
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => handlePackageSort("nolsaf")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    NoLSAF % {renderPackageSortIcon("nolsaf")}
                  </button>
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => handlePackageSort("bookings")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Bookings {renderPackageSortIcon("bookings")}
                  </button>
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => handlePackageSort("generated")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Generated {renderPackageSortIcon("generated")}
                  </button>
                </th>
                <th className="px-4 py-3 whitespace-nowrap">
                  <button type="button" onClick={() => handlePackageSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Status {renderPackageSortIcon("status")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">Loading packages...</td></tr>
              ) : packages.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">No tour packages have been added by operators yet.</td></tr>
              ) : (
                pagedPackages.map((pkg) => {
                  const status = packageStatusMeta(pkg.status);
                  return (
                    <tr key={pkg.id} className="hover:bg-sky-50 hover:shadow-sm transition duration-150 ease-in-out">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-gray-900 truncate max-w-[260px]">{pkg.title}</div>
                        <div className="text-xs text-gray-500 truncate max-w-[260px]">{[pkg.destination, pkg.duration, pkg.category].filter(Boolean).join(" / ") || "Details pending"}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{pkg.operatorName}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{pkg.minPax}-{pkg.maxPax}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 whitespace-nowrap">{money(pkg.pricePerPerson, pkg.currency)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-violet-700 whitespace-nowrap">{Number(pkg.nolsafPercent || 0)}%</td>
                      <td className="px-4 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">{Number(pkg.bookingsCount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-bold text-gray-900 whitespace-nowrap">{money(pkg.totalGenerated, pkg.currency)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {!loading && packages.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-gray-500">
              Showing {packagesStart + 1}-{Math.min(packagesEnd, packages.length)} of {packages.length}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPackagesPage((prev) => Math.max(1, prev - 1))}
                disabled={safePackagesPage <= 1}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs font-semibold text-gray-600">
                Page {safePackagesPage} of {totalPackagePages}
              </span>
              <button
                type="button"
                onClick={() => setPackagesPage((prev) => Math.min(totalPackagePages, prev + 1))}
                disabled={safePackagesPage >= totalPackagePages}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Tour Bookings</h2>
            <p className="mt-1 text-xs text-gray-500">
              {bookingBucket === "DRAFT"
                ? "Payment-pending attempts for admin monitoring only"
                : "Paid bookings and commission tracking"}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="inline-flex overflow-hidden rounded-xl border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => switchBookingBucket("PAID")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  bookingBucket === "PAID" ? "bg-[#02665e] text-white shadow-sm" : "text-gray-600 hover:bg-white"
                }`}
              >
                Paid ({paidBookings.length})
              </button>
              <button
                type="button"
                onClick={() => switchBookingBucket("DRAFT")}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  bookingBucket === "DRAFT" ? "bg-amber-500 text-white shadow-sm" : "text-gray-600 hover:bg-white"
                }`}
              >
                Draft ({draftBookings.length})
              </button>
            </div>
            <div className={`inline-flex rounded-lg px-4 py-2 text-sm font-semibold whitespace-nowrap ${
              bookingBucket === "DRAFT" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"
            }`}>
              {bookings.length} records
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-[1200px] w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-bold uppercase tracking-wider text-gray-600">
              <tr>
                <th className="px-4 py-3 whitespace-nowrap">S/N</th>
                <th className="px-4 py-3 whitespace-nowrap">
                  <button type="button" onClick={() => handleBookingSort("booking")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Booking {renderBookingSortIcon("booking")}
                  </button>
                </th>
                <th className="px-4 py-3 whitespace-nowrap">
                  <button type="button" onClick={() => handleBookingSort("operator")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Operator {renderBookingSortIcon("operator")}
                  </button>
                </th>
                <th className="px-4 py-3 whitespace-nowrap">
                  <button type="button" onClick={() => handleBookingSort("customer")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Customer {renderBookingSortIcon("customer")}
                  </button>
                </th>
                <th className="px-4 py-3 whitespace-nowrap">
                  <button type="button" onClick={() => handleBookingSort("status")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Status {renderBookingSortIcon("status")}
                  </button>
                </th>
                <th className="px-4 py-3 whitespace-nowrap">
                  <button type="button" onClick={() => handleBookingSort("pickup")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Pickup Validation {renderBookingSortIcon("pickup")}
                  </button>
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => handleBookingSort("gross")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    {bookingBucket === "DRAFT" ? "Draft Value" : "Total Paid"} {renderBookingSortIcon("gross")}
                  </button>
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => handleBookingSort("commission")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    NoLSAF {renderBookingSortIcon("commission")}
                  </button>
                </th>
                <th className="px-4 py-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => handleBookingSort("operatorPayout")} className="inline-flex items-center gap-1 bg-transparent border-0 p-0 m-0 appearance-none hover:text-gray-900">
                    Operator {renderBookingSortIcon("operatorPayout")}
                  </button>
                </th>
                <th className="px-4 py-3 whitespace-nowrap">Activity Trail</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-500">Loading bookings...</td></tr>
              ) : bookings.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-gray-500">
                    {bookingBucket === "DRAFT" ? "No draft/payment-pending attempts found." : "No paid tour bookings yet."}
                  </td>
                </tr>
              ) : (
                pagedBookings.map((booking, pageIdx) => {
                  const rowNumber = bookingsStart + pageIdx + 1;
                  const isOpen = Boolean(expandedHistory[booking.id]);
                  const isHistoryLoading = Boolean(historyLoading[booking.id]);
                  const historyItems = historyByBookingId[booking.id] || [];
                  const historyFilter = historyFilterByBookingId[booking.id] || { action: "ALL", from: "", to: "" };
                  const filteredHistoryItems = applyHistoryFilters(historyItems, historyFilter);
                  const groupedHistoryItems = groupTaskLedgerByRecency(filteredHistoryItems);
                  const bookingHistoryError = historyError[booking.id];
                  return (
                    <Fragment key={booking.id}>
                      <tr className="hover:bg-sky-50 hover:shadow-sm transition duration-150 ease-in-out">
                        <td className="px-4 py-3 whitespace-nowrap text-xs font-bold text-gray-500">{rowNumber}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-900 whitespace-nowrap">{booking.bookingCode}</div>
                          <div className="text-xs text-gray-500 truncate max-w-[240px]">{booking.title}</div>
                        </td>
                        <td className="px-4 py-3 text-gray-700 whitespace-nowrap">{booking.operatorName}</td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-gray-800 whitespace-nowrap">{booking.customerName}</div>
                          <div className="text-xs text-gray-500">{booking.travelerCount} travelers</div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="space-y-1">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${bookingStatusBadge(booking.status)}`}>{booking.status}</span>
                            <div className="text-[11px] font-semibold text-gray-500">{booking.paymentStatus} / {booking.payoutStatus}</div>
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {booking.pickupValidated ? (
                            <div className="space-y-1">
                              <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Validated</span>
                              <div className="text-[11px] font-semibold text-gray-500">
                                {booking.pickupValidatedAt
                                  ? new Date(booking.pickupValidatedAt).toLocaleString("en-GB", {
                                      day: "2-digit",
                                      month: "short",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                      hour12: false,
                                    })
                                  : "-"}
                              </div>
                            </div>
                          ) : (
                            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          {bookingBucket === "DRAFT" ? (
                            <div className="space-y-1">
                              <div className="font-bold text-gray-700">{money(booking.grossAmount, booking.currency)}</div>
                              <div className="text-[11px] font-semibold text-amber-700">Draft value</div>
                            </div>
                          ) : booking.isPaid ? (
                            <div className="font-bold text-gray-900">{money(booking.amountPaid ?? booking.grossAmount, booking.currency)}</div>
                          ) : (
                            <div className="space-y-1">
                              <div className="font-bold text-gray-400">{money(0, booking.currency)}</div>
                              <div className="text-[11px] font-semibold text-amber-700">Waiting payment</div>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700 whitespace-nowrap">
                          {bookingBucket === "DRAFT" ? <span className="text-gray-400">Not eligible</span> : money(booking.commissionAmount, booking.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-gray-700 whitespace-nowrap">
                          {bookingBucket === "DRAFT" ? <span className="text-gray-400">Not eligible</span> : money(booking.operatorPayoutAmount, booking.currency)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => void toggleBookingHistory(booking.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-[#02665e]/25 bg-[#02665e]/5 px-2.5 py-1.5 text-[11px] font-semibold text-[#01564f] hover:bg-[#02665e]/10"
                          >
                            {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            {isOpen ? "Hide" : "View"}
                          </button>
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colSpan={10} className="bg-[#f8fbfb] px-4 py-4">
                            <div className="relative overflow-hidden rounded-lg border border-[#02665e]/20 bg-gradient-to-br from-[#f5fdf9] via-[#f9fcfb] to-[#eef7f4] p-3">
                              <div
                                aria-hidden
                                className="pointer-events-none absolute inset-0"
                                style={{
                                  backgroundImage:
                                    "radial-gradient(circle at 15% 20%, rgba(2,102,94,0.08) 0, rgba(2,102,94,0) 42%), radial-gradient(circle at 85% 75%, rgba(2,102,94,0.06) 0, rgba(2,102,94,0) 40%), repeating-linear-gradient(-28deg, rgba(2,102,94,0.06) 0px, rgba(2,102,94,0.06) 1px, transparent 1px, transparent 22px)",
                                  opacity: 0.45,
                                }}
                              />
                              <div
                                aria-hidden
                                className="pointer-events-none absolute -right-10 top-10 select-none text-[56px] font-black tracking-[0.22em] text-[#02665e]/[0.06]"
                                style={{ transform: "rotate(-22deg)" }}
                              >
                                AUDIT
                              </div>
                              <div
                                aria-hidden
                                className="pointer-events-none absolute left-2 bottom-3 select-none text-[42px] font-black tracking-[0.2em] text-[#02665e]/[0.05]"
                                style={{ transform: "rotate(-22deg)" }}
                              >
                                NO4P
                              </div>

                              <div className="relative z-10 mb-2 text-xs font-bold uppercase tracking-wide text-[#01564f]">Activity Progress History</div>
                              <div className="relative z-10 mb-3 rounded-xl border border-[#02665e]/15 bg-white/80 p-3 backdrop-blur-[1px]">
                                <div className="mx-auto flex max-w-3xl flex-wrap items-end justify-center gap-3">
                                  <label className="w-full sm:w-[190px] flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                                    Action
                                    <select
                                      value={historyFilter.action}
                                      onChange={(e) => updateHistoryFilter(booking.id, { action: e.target.value as ActivityHistoryFilter["action"] })}
                                      className="h-10 rounded-xl border border-gray-300 bg-white px-3 text-base font-semibold text-gray-700 focus:border-[#02665e] focus:outline-none focus:ring-2 focus:ring-[#02665e]/20"
                                    >
                                      <option value="ALL">All events</option>
                                      <option value="CHECKED">Checked only</option>
                                      <option value="UNCHECKED">Unchecked only</option>
                                    </select>
                                  </label>

                                  <div className="w-full sm:w-[190px] flex flex-col gap-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">From</span>
                                    <DatePickerField
                                      label="History from date"
                                      value={historyFilter.from}
                                      onChangeAction={(nextIso) => updateHistoryFilter(booking.id, { from: String(nextIso).split("T")[0] })}
                                      max={historyFilter.to || undefined}
                                      allowPast={true}
                                      twoMonths={false}
                                      widthClassName="w-full"
                                      size="sm"
                                    />
                                  </div>

                                  <div className="w-full sm:w-[190px] flex flex-col gap-1">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600">To</span>
                                    <DatePickerField
                                      label="History to date"
                                      value={historyFilter.to}
                                      onChangeAction={(nextIso) => updateHistoryFilter(booking.id, { to: String(nextIso).split("T")[0] })}
                                      min={historyFilter.from || undefined}
                                      allowPast={true}
                                      twoMonths={false}
                                      widthClassName="w-full"
                                      size="sm"
                                    />
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => resetHistoryFilter(booking.id)}
                                    className="h-10 min-w-[100px] rounded-xl border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                                  >
                                    Reset
                                  </button>
                                </div>
                              </div>
                              <div className="relative z-10">
                              {isHistoryLoading ? (
                                <div className="text-sm text-gray-500">Loading activity history...</div>
                              ) : bookingHistoryError ? (
                                <div className="text-sm text-rose-600">{bookingHistoryError}</div>
                              ) : historyItems.length === 0 ? (
                                <div className="text-sm text-gray-500">No activity check events recorded yet.</div>
                              ) : filteredHistoryItems.length === 0 ? (
                                <div className="text-sm text-gray-500">No history events match the selected filters.</div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="text-[11px] font-semibold text-gray-500">
                                    Showing {filteredHistoryItems.length} of {historyItems.length} events
                                  </div>
                                  {groupedHistoryItems.map((group) => (
                                    <div key={group.label} className="space-y-2">
                                      <div className="sticky top-0 z-[1] inline-flex rounded-full border border-[#02665e]/20 bg-[#02665e]/8 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#01564f]">
                                        {group.label}
                                      </div>
                                      <div className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-3">
                                        {group.items.map((item, idx) => (
                                          <div
                                            key={`${group.label}-${item.activityId}-${idx}`}
                                            className="h-full overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                                          >
                                            <div className="flex">
                                              <div
                                                className={`w-1.5 flex-shrink-0 ${
                                                  item.currentAction === "CHECKED" ? "bg-emerald-400" : "bg-amber-400"
                                                }`}
                                              />
                                              <div className="min-w-0 flex-1 px-3 py-2.5">
                                                <div className="flex flex-wrap items-center gap-2">
                                                  <span
                                                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                                      item.currentAction === "CHECKED"
                                                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                        : "border-amber-200 bg-amber-50 text-amber-700"
                                                    }`}
                                                  >
                                                    {item.currentAction === "CHECKED" ? "Checked" : "Unchecked"}
                                                  </span>
                                                  <span className="truncate text-sm font-semibold text-[#01564f]">{item.label}</span>
                                                </div>

                                                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                                                  {item.entries.map((entry, entryIdx) => (
                                                    <span
                                                      key={`${item.activityId}-${entry.at}-${entryIdx}`}
                                                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold ${
                                                        entry.action === "CHECKED"
                                                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                                          : "border-amber-200 bg-amber-50 text-amber-700"
                                                      }`}
                                                      title={`By ${entry.actorName || "Agent"}${entry.byAgentId ? ` (Agent #${entry.byAgentId})` : ""}`}
                                                    >
                                                      {entry.action === "CHECKED" ? "Ticked" : "Unticked"} at {formatLedgerEventTime(entry.at)}
                                                    </span>
                                                  ))}
                                                </div>

                                                <div className="mt-2 text-xs text-gray-500">
                                                  Last update: {formatHistoryAt(item.latestAt)}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                              </div>
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

        {!loading && bookings.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-gray-500">
              Showing {bookingsStart + 1}-{Math.min(bookingsEnd, bookings.length)} of {bookings.length}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setBookingsPage((prev) => Math.max(1, prev - 1))}
                disabled={safeBookingsPage <= 1}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-xs font-semibold text-gray-600">
                Page {safeBookingsPage} of {totalBookingPages}
              </span>
              <button
                type="button"
                onClick={() => setBookingsPage((prev) => Math.min(totalBookingPages, prev + 1))}
                disabled={safeBookingsPage >= totalBookingPages}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

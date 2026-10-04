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
  ChevronsUpDown,
  ChevronUp,
  Eye,
  EyeOff,
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

  // ── What needs an admin today, worked out from the loaded data ──
  const operators = overview?.operators ?? [];
  const payoutSent = (b: TourBooking) => /^(DISBURSED|PAID)$/i.test(String(b.payoutStatus || ""));
  const packagesInReview = packages.filter((p) => packageStatusMeta(p.status).label === "Admin review");
  const startedWithoutPickup = paidBookings.filter((b) => !b.pickupValidated && b.startDate && new Date(b.startDate).getTime() < Date.now());
  const payoutsWaiting = paidBookings.filter((b) => !payoutSent(b));
  const payoutWaitingAmount = payoutsWaiting.reduce((sum, b) => sum + Number(b.operatorPayoutAmount || 0), 0);
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
      count: payoutsWaiting.length,
      title: `${payoutsWaiting.length} ${payoutsWaiting.length === 1 ? "payout" : "payouts"} not sent yet`,
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
      detail: "Missing documents or contact details keep them hidden.",
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
      verb: "public ready",
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
  const payout = Number(summary?.operatorPayout ?? 0);
  const commissionShare = gross > 0 ? Math.round((commission / gross) * 100) : 0;
  const payoutShare = gross > 0 ? Math.round((payout / gross) * 100) : 0;
  const topPackages = [...packages].filter((p) => Number(p.totalGenerated || 0) > 0).sort((a, b) => Number(b.totalGenerated) - Number(a.totalGenerated)).slice(0, 4);
  const topMax = Math.max(1, ...topPackages.map((p) => Number(p.totalGenerated || 0)));

  const ATTENTION_TONES = {
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    red: "border-red-200 bg-red-50 text-red-700",
    blue: "border-sky-200 bg-sky-50 text-sky-700",
  } as const;
  const CARD = "min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]";

  return (
    <div id="tour-commerce" className="space-y-4 min-w-0 w-full">
      {/* Preflight is disabled in this project; scope border-box so w-full pieces don't overflow */}
      <style>{`#tour-commerce, #tour-commerce * { box-sizing: border-box; }`}</style>

      {/* Workspace header */}
      <section className="relative overflow-hidden rounded-2xl border border-solid border-slate-800 bg-[linear-gradient(120deg,#102b3a_0%,#123f49_65%,#075e54_100%)] p-4 shadow-sm sm:p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-solid border-white/[0.06]" aria-hidden="true" />
        <div className="relative flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-solid border-emerald-100 bg-white text-emerald-700 shadow-sm">
                <Wallet className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Agents module</p>
                <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tour Commerce</h1>
                <p className="m-0 mt-1 text-xs leading-5 text-emerald-100/80 sm:text-sm">
                  Operators, packages, bookings, commission and payouts at a glance.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              suppressHydrationWarning
              title="Refresh tour commerce"
              aria-label="Refresh tour commerce"
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-solid border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-wait"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
          <nav aria-label="Related workspaces" className="flex flex-wrap gap-2 border-0 border-t border-solid border-white/15 pt-4">
            {[
              { href: "/admin/agents/tour-operators", label: "Tour operators", Icon: Building2 },
              { href: "/admin/agents/tour-experience", label: "Tour experience", Icon: ShieldCheck },
            ].map(({ href, label, Icon }) => (
              <Link key={href} href={href} className="inline-flex items-center gap-2 rounded-lg border border-solid border-white/15 bg-white/[0.07] px-3 py-2 text-xs font-bold text-emerald-50 no-underline transition hover:bg-white/15">
                <Icon className="h-4 w-4" aria-hidden /> {label}
              </Link>
            ))}
            <button type="button" onClick={() => jumpTo("package-inventory")} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-solid border-white/15 bg-white/[0.07] px-3 py-2 text-xs font-bold text-emerald-50 transition hover:bg-white/15">
              <PackageCheck className="h-4 w-4" aria-hidden /> Package inventory
            </button>
            <button type="button" onClick={() => jumpTo("tour-bookings-table")} className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-solid border-white/15 bg-white/[0.07] px-3 py-2 text-xs font-bold text-emerald-50 transition hover:bg-white/15">
              <BadgeDollarSign className="h-4 w-4" aria-hidden /> Bookings
            </button>
          </nav>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-solid border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{error}</span>
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Needs attention */}
        <section className={CARD}>
          <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Needs attention</h2>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Worked out from today&apos;s packages and bookings</p>
            </div>
            {!loading ? (
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${attention.length ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>
                {attention.length ? `${attention.length} open` : "All clear"}
              </span>
            ) : null}
          </div>
          {loading && !overview ? (
            <div className="space-y-2 p-4 sm:p-5">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-neutral-100" />)}
            </div>
          ) : attention.length ? (
            <ul className="m-0 list-none divide-y divide-solid divide-neutral-100 p-0">
              {attention.map((item) => (
                <li key={item.key} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <span className={`inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-xl border border-solid px-2 text-sm font-black tabular-nums ${ATTENTION_TONES[item.tone]}`}>
                    {item.count}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-neutral-900">{item.title}</span>
                    <span className="block text-[12px] leading-snug text-neutral-500">{item.detail}</span>
                  </span>
                  <button
                    type="button"
                    onClick={item.run}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-bold text-neutral-700 transition hover:border-emerald-300 hover:text-emerald-800"
                  >
                    {item.action} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-3 px-4 py-6 sm:px-5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" aria-hidden /></span>
              <span>
                <span className="block text-[13px] font-bold text-neutral-900">Nothing waiting on you</span>
                <span className="block text-[12px] text-neutral-500">Packages are reviewed, pickups validated and payouts sent.</span>
              </span>
            </div>
          )}
        </section>

        {/* Where the money goes */}
        <section className={CARD}>
          <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Where the money goes</h2>
              <p className="m-0 mt-0.5 text-[12px] text-neutral-500">Paid tour bookings, all time</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCommission((prev) => !prev)}
              aria-label={showCommission ? "Hide commission amount" : "Show commission amount"}
              title={showCommission ? "Hide commission" : "Show commission"}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-neutral-600 transition hover:bg-neutral-50"
            >
              {showCommission ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
              {showCommission ? "Hide" : "Show"} commission
            </button>
          </div>
          <div className="p-4 sm:p-5">
            <p className="m-0 text-[11px] font-semibold text-neutral-500">Gross booking revenue</p>
            <p className="m-0 mt-0.5 text-2xl font-black tabular-nums tracking-tight text-neutral-950">{money(gross, currency)}</p>
            <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
              <span className="bg-emerald-600 transition-all duration-500" style={{ width: `${payoutShare}%` }} />
              <span className="bg-violet-500 transition-all duration-500" style={{ width: `${commissionShare}%` }} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><span className="h-2 w-2 rounded-full bg-emerald-600" aria-hidden /> Operators</p>
                <p className="m-0 mt-0.5 break-words text-base font-black tabular-nums text-emerald-700">{money(payout, currency)}</p>
                <p className="m-0 text-[11px] text-neutral-400">{payoutShare}% of gross</p>
              </div>
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold text-neutral-500"><span className="h-2 w-2 rounded-full bg-violet-500" aria-hidden /> NoLSAF commission</p>
                <p className="m-0 mt-0.5 break-words text-base font-black tabular-nums text-violet-700">{showCommission ? money(commission, currency) : "Hidden"}</p>
                <p className="m-0 text-[11px] text-neutral-400">{commissionShare}% of gross</p>
              </div>
            </div>
            {payoutsWaiting.length ? (
              <p className="m-0 mt-4 rounded-xl bg-sky-50 px-3 py-2 text-[12px] text-sky-800">
                <span className="font-bold">{money(payoutWaitingAmount, currency)}</span> of the operator share is still waiting to be sent.
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        {/* Pipeline health */}
        <section className={CARD}>
          <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
            <h2 className="m-0 text-sm font-bold text-neutral-900">Pipeline health</h2>
            <p className="m-0 mt-0.5 text-[12px] text-neutral-500">How much of each stage is ready to earn</p>
          </div>
          <ul className="m-0 list-none divide-y divide-solid divide-neutral-100 p-0">
            {lanes.map((lane) => {
              const tone = laneTone(lane.rate, lane.total);
              return (
                <li key={lane.key} className="flex items-center gap-3.5 px-4 py-3.5 sm:px-5">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-emerald-100 bg-emerald-50/60 text-emerald-700">
                    <lane.Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="m-0 text-[13px] font-bold text-neutral-900">{lane.title}</p>
                      <p className="m-0 shrink-0 text-[12px] text-neutral-500">
                        <span className="text-[15px] font-black tabular-nums text-neutral-950">{lane.done}</span>
                        <span className="tabular-nums"> of {lane.total}</span> {lane.verb}
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2.5">
                      <span className="block h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100">
                        <span className={`block h-2 rounded-full transition-all duration-500 ${tone.bar}`} style={{ width: `${lane.rate}%` }} />
                      </span>
                      <span className={`w-9 shrink-0 text-right text-[12px] font-black tabular-nums ${tone.text}`}>{lane.total ? `${lane.rate}%` : "None"}</span>
                    </div>
                    <p className="m-0 mt-1 text-[11.5px] text-neutral-500">{lane.note}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Top earning packages */}
        <section className={CARD}>
          <div className="border-0 border-b border-solid border-neutral-100 px-4 py-3.5 sm:px-5">
            <h2 className="m-0 text-sm font-bold text-neutral-900">Top earning packages</h2>
            <p className="m-0 mt-0.5 text-[12px] text-neutral-500">By money generated from paid bookings</p>
          </div>
          {topPackages.length ? (
            <ul className="m-0 list-none space-y-3 p-4 sm:p-5">
              {topPackages.map((pkg, i) => (
                <li key={pkg.id} className="min-w-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] font-bold text-neutral-900">
                      <span className="mr-1.5 text-neutral-400">{i + 1}.</span>{pkg.title}
                    </span>
                    <span className="shrink-0 text-[12px] font-black tabular-nums text-neutral-900">{money(pkg.totalGenerated, pkg.currency)}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100">
                      <span className="block h-1.5 rounded-full bg-emerald-600" style={{ width: `${(Number(pkg.totalGenerated || 0) / topMax) * 100}%` }} />
                    </span>
                    <span className="shrink-0 text-[11px] text-neutral-400">{pkg.operatorName} · {pkg.bookingsCount} {pkg.bookingsCount === 1 ? "booking" : "bookings"}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 px-4 py-6 text-[12px] text-neutral-500 sm:px-5">No package has earned from a paid booking yet.</p>
          )}
        </section>
      </div>


      <section id="package-inventory" className="scroll-mt-24 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
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

      <section id="tour-bookings-table" className="scroll-mt-24 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
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

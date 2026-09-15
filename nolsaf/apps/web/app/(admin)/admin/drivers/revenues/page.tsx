"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, BadgeCheck, Car, CreditCard, Eye, MapPinned, Star, TrendingUp, Search, X, Calendar, Clock, PieChart, BarChart3, } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import Chart from "@/components/Chart";
import TableRow from "@/components/TableRow";
import type { ChartData } from "chart.js";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;
function authify() {}

type RevenueRow = {
  id: number;
  driver: { id: number; name: string; email: string; phone: string | null } | null;
  areaRegistered: string | null;
  vehicleType: string | null;
  registrationNumber: string | null;
  grossRevenue: number;
  commissionAmount: number;
  netRevenue: number;
  tripCount: number;
  invoiceCount: number;
  lastPaymentDate: string | null;
};

type RevenueStats = {
  date: string;
  grossRevenue: number;
  netRevenue: number;
  commissionAmount: number;
  tripCount: number;
};

type RevenueStatsResponse = {
  stats: RevenueStats[];
  summary: {
    totalGrossRevenue: number;
    totalNetRevenue: number;
    totalCommission: number;
    totalTrips: number;
    totalInvoices: number;
    averageRevenue: number;
    growthRate: number;
  };
  topDrivers: Array<{
    driverId: number;
    driverName: string;
    totalRevenue: number;
    tripCount: number;
  }>;
  period: string;
  startDate: string;
  endDate: string;
};

type RevenueDriverDetails = {
  driver: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    vehicleType: string | null;
    registrationNumber: string | null;
    payout: string | { payoutPreferred?: string | null; mobileMoneyNumber?: string | null; mobileMoneyProvider?: string | null } | null;
    paymentPhone: string | null;
    kycStatus: string | null;
  } | null;
  summary: {
    grossRevenue: number;
    commissionAmount: number;
    netRevenue: number;
    tripCount: number;
    invoiceCount: number;
    averageCustomerRating: number | null;
    averageDriverRating: number | null;
    lastPaymentDate: string | null;
  };
  trips: Array<{
    payoutId: number;
    tripId: number | null;
    tripCode: string;
    status: string;
    areaRegistered: string | null;
    pickup: string;
    dropoff: string;
    vehicleType: string | null;
    registrationNumber: string | null;
    passengerCount: number | null;
    grossRevenue: number;
    commissionAmount: number;
    netRevenue: number;
    customerRating: number | null;
    driverRating: number | null;
    scheduledAt: string | null;
    pickupTime: string | null;
    dropoffTime: string | null;
    paidAt: string | null;
    paymentMethod: string | null;
    paymentRef: string | null;
    customer: { id: number; name: string | null; email: string | null; phone: string | null } | null;
  }>;
};

type RevenueSortKey = "driver" | "areaRegistered" | "vehicleType" | "registrationNumber" | "grossRevenue" | "commissionAmount" | "netRevenue" | "tripCount" | "invoiceCount" | "lastPaymentDate";
type TripDetailSortKey = "tripCode" | "route" | "areaRegistered" | "vehicleType" | "grossRevenue" | "commissionAmount" | "netRevenue" | "customerRating" | "paidAt";
type SortDir = "asc" | "desc";

const revenueDateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const revenueTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

function formatRevenueDateTime(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    date: revenueDateFormatter.format(parsed),
    time: revenueTimeFormatter.format(parsed),
  };
}

function formatRevenueMoney(value: number | null | undefined) {
  return `${Math.round(Number(value || 0)).toLocaleString()} TZS`;
}

function formatRevenueRating(value: number | null | undefined) {
  return value == null ? "N/A" : `${Number(value).toFixed(1)}/5`;
}

function formatDriverPayout(value: RevenueDriverDetails["driver"] extends null ? never : NonNullable<RevenueDriverDetails["driver"]>["payout"]) {
  if (!value) return "N/A";
  if (typeof value === "string") return value;
  return [value.payoutPreferred, value.mobileMoneyProvider, value.mobileMoneyNumber].filter(Boolean).join(" · ") || "N/A";
}

function profileFact(label: string, value: string | null | undefined) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-b-0">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 text-[15px] leading-6 text-slate-950">{value || "N/A"}</div>
    </div>
  );
}

function profileMetric(
  label: string,
  value: string | number,
  tone: "black" | "emerald" | "amber" | "white",
  icon?: React.ReactNode,
) {
  const toneClass = {
    black: "bg-black text-white border-black",
    emerald: "bg-emerald-50 text-emerald-800 border-emerald-100",
    amber: "bg-amber-50 text-amber-800 border-amber-100",
    white: "bg-white text-slate-950 border-slate-200",
  }[tone];
  const labelClass = tone === "black" ? "text-white/60" : "text-slate-500";

  return (
    <div className={`border p-4 shadow-sm ${toneClass}`}>
      <div className={`flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] ${labelClass}`}>
        {icon}
        {label}
      </div>
      <div className="mt-3 text-lg font-semibold leading-7">{value}</div>
    </div>
  );
}

export default function AdminDriversRevenuesPage() {
  const [date, setDate] = useState<string | string[]>("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<RevenueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<RevenueSortKey>("netRevenue");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pickerAnim, setPickerAnim] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  
  // Stats state
  const [statsPeriod, setStatsPeriod] = useState<string>("30d");
  const [statsData, setStatsData] = useState<RevenueStatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsData, setDetailsData] = useState<RevenueDriverDetails | null>(null);
  const [tripDetailSortKey, setTripDetailSortKey] = useState<TripDetailSortKey>("paidAt");
  const [tripDetailSortDir, setTripDetailSortDir] = useState<SortDir>("desc");
  const [tripDetailPage, setTripDetailPage] = useState(1);
  const tripDetailPageSize = 8;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize,
      };
      if (date) {
        if (Array.isArray(date)) {
          params.start = date[0];
          params.end = date[1];
        } else {
          params.date = date;
        }
      }
      if (q) params.q = q;

      const r = await api.get<{ items: RevenueRow[]; total: number }>("/api/admin/drivers/revenues", { params });
      setList(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);
    } catch (err) {
      console.error("Failed to load revenues", err);
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, date, q]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await api.get<RevenueStatsResponse>("/api/admin/drivers/revenues/stats", {
        params: { period: statsPeriod },
      });
      setStatsData(r.data);
    } catch (err) {
      console.error("Failed to load revenue statistics", err);
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  }, [statsPeriod]);

  useEffect(() => {
    authify();
    load();
  }, [load]);

  useEffect(() => {
    authify();
    loadStats();
  }, [loadStats]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const openDriverDetails = useCallback(async (row: RevenueRow) => {
    if (!row.driver?.id) return;
    setDetailsOpen(true);
    setDetailsLoading(true);
    setDetailsError(null);
    setDetailsData(null);
    setTripDetailPage(1);
    try {
      const params: any = {};
      if (date) {
        if (Array.isArray(date)) {
          params.start = date[0];
          params.end = date[1];
        } else {
          params.date = date;
        }
      }
      const response = await api.get<RevenueDriverDetails>(`/api/admin/drivers/revenues/${row.driver.id}/details`, { params });
      setDetailsData(response.data);
    } catch (err) {
      console.error("Failed to load driver revenue details", err);
      setDetailsError("Unable to load driver revenue details right now.");
    } finally {
      setDetailsLoading(false);
    }
  }, [date]);

  const closeDriverDetails = useCallback(() => {
    setDetailsOpen(false);
    setDetailsLoading(false);
    setDetailsError(null);
    setDetailsData(null);
    setTripDetailPage(1);
  }, []);

  const sortedDetailTrips = useMemo(() => {
    if (!detailsData?.trips) return [];
    const valueFor = (trip: RevenueDriverDetails["trips"][number]): string | number => {
      switch (tripDetailSortKey) {
        case "tripCode":
          return trip.tripCode || "";
        case "route":
          return `${trip.pickup || ""} ${trip.dropoff || ""}`;
        case "areaRegistered":
          return trip.areaRegistered || "";
        case "vehicleType":
          return trip.vehicleType || "";
        case "grossRevenue":
          return trip.grossRevenue;
        case "commissionAmount":
          return trip.commissionAmount;
        case "netRevenue":
          return trip.netRevenue;
        case "customerRating":
          return trip.customerRating ?? 0;
        case "paidAt":
        default:
          return new Date(trip.paidAt || "").getTime() || 0;
      }
    };

    return [...detailsData.trips].sort((a, b) => {
      const aValue = valueFor(a);
      const bValue = valueFor(b);
      const result =
        typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" });
      return tripDetailSortDir === "asc" ? result : -result;
    });
  }, [detailsData?.trips, tripDetailSortDir, tripDetailSortKey]);

  const handleTripDetailSort = useCallback((key: TripDetailSortKey) => {
    setTripDetailPage(1);
    setTripDetailSortKey((current) => {
      if (current === key) {
        setTripDetailSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setTripDetailSortDir(["grossRevenue", "commissionAmount", "netRevenue", "customerRating", "paidAt"].includes(key) ? "desc" : "asc");
      return key;
    });
  }, []);

  const renderTripDetailSortIcon = (key: TripDetailSortKey) => {
    if (tripDetailSortKey !== key) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />;
    return tripDetailSortDir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-emerald-600" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-emerald-600" />
    );
  };

  const renderTripDetailSortHeader = (key: TripDetailSortKey, label: string) => (
    <button
      type="button"
      onClick={() => handleTripDetailSort(key)}
      className="inline-flex appearance-none items-center gap-2 whitespace-nowrap border-0 bg-transparent p-0 text-xs font-bold uppercase tracking-wide text-slate-500 transition hover:text-slate-950"
    >
      <span>{label}</span>
      {renderTripDetailSortIcon(key)}
    </button>
  );

  const tripDetailPages = Math.max(1, Math.ceil(sortedDetailTrips.length / tripDetailPageSize));
  const pagedDetailTrips = useMemo(
    () => sortedDetailTrips.slice((tripDetailPage - 1) * tripDetailPageSize, tripDetailPage * tripDetailPageSize),
    [sortedDetailTrips, tripDetailPage, tripDetailPageSize],
  );

  const sortedRevenues = useMemo(() => {
    const valueFor = (row: RevenueRow): string | number => {
      switch (sortKey) {
        case "driver":
          return row.driver?.name || "";
        case "areaRegistered":
          return row.areaRegistered || "";
        case "vehicleType":
          return row.vehicleType || "";
        case "registrationNumber":
          return row.registrationNumber || "";
        case "grossRevenue":
          return row.grossRevenue;
        case "commissionAmount":
          return row.commissionAmount;
        case "netRevenue":
          return row.netRevenue;
        case "tripCount":
          return row.tripCount;
        case "invoiceCount":
          return row.invoiceCount;
        case "lastPaymentDate":
        default:
          return new Date(row.lastPaymentDate || "").getTime() || 0;
      }
    };

    return [...list].sort((a, b) => {
      const aValue = valueFor(a);
      const bValue = valueFor(b);
      const result =
        typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" });
      return sortDir === "asc" ? result : -result;
    });
  }, [list, sortDir, sortKey]);

  const handleSort = useCallback((key: RevenueSortKey) => {
    setSortKey((current) => {
      if (current === key) {
        setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDir(key === "driver" ? "asc" : "desc");
      return key;
    });
  }, []);

  const renderSortIcon = (key: RevenueSortKey) => {
    if (sortKey !== key) return <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />;
    return sortDir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-sky-600" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-sky-600" />
    );
  };

  const renderSortHeader = (key: RevenueSortKey, label: string) => (
    <button
      type="button"
      onClick={() => handleSort(key)}
      className="inline-flex appearance-none items-center gap-2 whitespace-nowrap border-0 bg-transparent p-0 text-xs font-medium uppercase tracking-wider text-gray-500 transition hover:text-slate-900"
    >
      <span>{label}</span>
      {renderSortIcon(key)}
    </button>
  );

  // Prepare area chart data for revenue trends
  const revenueChartData = useMemo<ChartData<"line">>(() => {
    if (!statsData || statsData.stats.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const labels = statsData.stats.map((s) => {
      const d = new Date(s.date);
      return statsPeriod === "year" 
        ? d.toLocaleDateString("en-US", { month: "short" })
        : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    });
    
    return {
      labels,
      datasets: [
        {
          label: "Gross Revenue",
          data: statsData.stats.map((s) => s.grossRevenue),
          fill: true,
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderColor: "rgba(59, 130, 246, 1)",
          borderWidth: 2,
          tension: 0.4,
          pointBackgroundColor: "rgba(59, 130, 246, 1)",
          pointBorderColor: "#fff",
          pointHoverBackgroundColor: "#fff",
          pointHoverBorderColor: "rgba(59, 130, 246, 1)",
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: "Net Revenue",
          data: statsData.stats.map((s) => s.netRevenue),
          fill: true,
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          borderColor: "rgba(16, 185, 129, 1)",
          borderWidth: 2,
          tension: 0.4,
          pointBackgroundColor: "rgba(16, 185, 129, 1)",
          pointBorderColor: "#fff",
          pointHoverBackgroundColor: "#fff",
          pointHoverBorderColor: "rgba(16, 185, 129, 1)",
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    };
  }, [statsData, statsPeriod]);

  // Prepare bar chart data for top drivers
  const topDriversChartData = useMemo<ChartData<"bar">>(() => {
    if (!statsData || !statsData.topDrivers || statsData.topDrivers.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const top5 = statsData.topDrivers.slice(0, 5);
    const labels = top5.map((d) => {
      const cleaned = d.driverName.replace(/^Smoke\s+/i, "").trim();
      return cleaned || d.driverName || "Driver";
    });
    const colors = [
      "rgba(59, 130, 246, 0.8)",
      "rgba(16, 185, 129, 0.8)",
      "rgba(245, 158, 11, 0.8)",
      "rgba(139, 92, 246, 0.8)",
      "rgba(236, 72, 153, 0.8)",
    ];

    return {
      labels,
      datasets: [
        {
          label: "Revenue",
          data: top5.map((d) => d.totalRevenue),
          backgroundColor: colors.slice(0, top5.length),
          borderColor: colors.slice(0, top5.length).map(c => c.replace("0.8", "1")),
          borderWidth: 2,
          borderRadius: 6,
        },
      ],
    };
  }, [statsData]);

  // Prepare donut chart data for revenue breakdown
  const revenueBreakdownData = useMemo<ChartData<"doughnut">>(() => {
    if (!statsData || !statsData.summary) {
      return {
        labels: [],
        datasets: [],
      };
    }

    const { totalCommission, totalNetRevenue } = statsData.summary;
    
    return {
      labels: ["Net Revenue", "Commission"],
      datasets: [
        {
          data: [totalNetRevenue, totalCommission],
          backgroundColor: [
            "rgba(16, 185, 129, 0.8)",
            "rgba(245, 158, 11, 0.8)",
          ],
          borderColor: "#fff",
          borderWidth: 3,
          hoverOffset: 8,
        },
      ],
    };
  }, [statsData]);

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Premium Banner */}
      <div style={{ position: "relative", borderRadius: "1.25rem", overflow: "hidden", background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)", boxShadow: "0 28px 65px -15px rgba(2,102,94,0.45), 0 8px 22px -8px rgba(14,42,122,0.50)", padding: "2rem 2rem 1.75rem" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.13, pointerEvents: "none" }} viewBox="0 0 900 160" preserveAspectRatio="xMidYMid slice">
          <circle cx="820" cy="30" r="90" fill="none" stroke="white" strokeWidth="1.2" />
          <circle cx="820" cy="30" r="55" fill="none" stroke="white" strokeWidth="0.7" />
          <circle cx="60" cy="140" r="70" fill="none" stroke="white" strokeWidth="1.0" />
          <line x1="0" y1="40" x2="900" y2="40" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="72" x2="900" y2="72" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="104" x2="900" y2="104" stroke="white" strokeWidth="0.4" />
          <line x1="0" y1="136" x2="900" y2="136" stroke="white" strokeWidth="0.4" />
          <polyline points="0,130 90,110 180,95 270,80 360,65 450,90 540,55 630,70 720,40 810,52 900,35" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="0,130 90,110 180,95 270,80 360,65 450,90 540,55 630,70 720,40 810,52 900,35 900,160 0,160" fill="white" opacity={0.06} />
          <polyline points="0,145 90,132 180,118 270,128 360,108 450,122 540,98 630,112 720,88 810,102 900,78" fill="none" stroke="white" strokeWidth="1.2" strokeDasharray="6 4" opacity={0.5} />
          <circle cx="540" cy="55" r="5" fill="white" opacity={0.75} />
          <circle cx="720" cy="40" r="5" fill="white" opacity={0.75} />
          <circle cx="900" cy="35" r="5" fill="white" opacity={0.75} />
          <defs><radialGradient id="revBannerGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="white" stopOpacity="0.12" /><stop offset="100%" stopColor="white" stopOpacity="0" /></radialGradient></defs>
          <ellipse cx="450" cy="90" rx="200" ry="70" fill="url(#revBannerGlow)" />
        </svg>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
          <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(255,255,255,0.10)", border: "1.5px solid rgba(255,255,255,0.18)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <TrendingUp style={{ width: 22, height: 22, color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.35rem", fontWeight: 800, color: "white", margin: 0, letterSpacing: "-0.01em" }}>Driver Revenues</h1>
            <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.62)", margin: "2px 0 0" }}>Gross &amp; net earnings · commissions · per-driver revenue analytics</p>
          </div>
        </div>
        <div style={{ position: "relative", zIndex: 1, display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <div style={{ background: "rgba(14,165,233,0.16)", border: "1px solid rgba(14,165,233,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 130 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(125,211,252,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Gross Revenue</div>
            {statsLoading ? (
              <div style={{ height: 28, background: "rgba(255,255,255,0.12)", borderRadius: "0.4rem", marginTop: 4, width: 110 }} />
            ) : (
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#7dd3fc", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {statsData?.summary ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(statsData.summary.totalGrossRevenue) : "--"} <span style={{ fontSize: "0.68rem", opacity: 0.7 }}>TZS</span>
              </div>
            )}
            {statsData?.summary && !statsLoading && statsData.summary.growthRate !== 0 && (
              <div style={{ fontSize: "0.63rem", color: statsData.summary.growthRate > 0 ? "#6ee7b7" : "#fca5a5", marginTop: 2 }}>
                {statsData.summary.growthRate > 0 ? "+" : ""}{statsData.summary.growthRate.toFixed(1)}% growth
              </div>
            )}
          </div>
          <div style={{ background: "rgba(16,185,129,0.16)", border: "1px solid rgba(16,185,129,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 130 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(110,231,183,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Net Revenue</div>
            {statsLoading ? (
              <div style={{ height: 28, background: "rgba(255,255,255,0.12)", borderRadius: "0.4rem", marginTop: 4, width: 110 }} />
            ) : (
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#6ee7b7", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {statsData?.summary ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(statsData.summary.totalNetRevenue) : "--"} <span style={{ fontSize: "0.68rem", opacity: 0.7 }}>TZS</span>
              </div>
            )}
          </div>
          <div style={{ background: "rgba(245,158,11,0.16)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 130 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(252,211,77,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Commission</div>
            {statsLoading ? (
              <div style={{ height: 28, background: "rgba(255,255,255,0.12)", borderRadius: "0.4rem", marginTop: 4, width: 110 }} />
            ) : (
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#fcd34d", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {statsData?.summary ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(statsData.summary.totalCommission) : "--"} <span style={{ fontSize: "0.68rem", opacity: 0.7 }}>TZS</span>
              </div>
            )}
          </div>
          <div style={{ background: "rgba(139,92,246,0.16)", border: "1px solid rgba(139,92,246,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 110 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(196,181,253,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Total Trips</div>
            {statsLoading ? (
              <div style={{ height: 28, background: "rgba(255,255,255,0.12)", borderRadius: "0.4rem", marginTop: 4, width: 80 }} />
            ) : (
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#c4b5fd", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {statsData?.summary?.totalTrips?.toLocaleString() ?? "--"}
              </div>
            )}
            {statsData?.summary && !statsLoading && (
              <div style={{ fontSize: "0.63rem", color: "rgba(255,255,255,0.45)", marginTop: 2 }}>
                Avg {new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(statsData.summary.averageRevenue)} TZS
              </div>
            )}
          </div>
          <div style={{ background: "rgba(20,184,166,0.16)", border: "1px solid rgba(20,184,166,0.35)", borderRadius: "0.85rem", padding: "0.6rem 1rem", minWidth: 100 }}>
            <div style={{ fontSize: "0.63rem", fontWeight: 700, color: "rgba(94,234,212,0.85)", letterSpacing: "0.08em", textTransform: "uppercase" }}>Invoices</div>
            {statsLoading ? (
              <div style={{ height: 28, background: "rgba(255,255,255,0.12)", borderRadius: "0.4rem", marginTop: 4, width: 80 }} />
            ) : (
              <div style={{ fontSize: "1.3rem", fontWeight: 900, color: "#5eead4", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
                {statsData?.summary?.totalInvoices?.toLocaleString() ?? total.toLocaleString()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Revenue Trends - Area Chart */}
        <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-blue-300 hover:-translate-y-1 group">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 group-hover:text-blue-600 transition-colors duration-300">
                <TrendingUp className="h-5 w-5 text-blue-600 group-hover:scale-110 transition-transform duration-300" />
                Revenue Trends
              </h3>
              <p className="text-sm text-gray-500 mt-1">Gross and net revenue over time</p>
            </div>
            
            {/* Period Filter */}
            <div className="flex gap-2 flex-wrap">
              {[
                { label: "7 Days", value: "7d" },
                { label: "30 Days", value: "30d" },
                { label: "This Month", value: "month" },
                { label: "This Year", value: "year" },
              ].map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setStatsPeriod(p.value)}
                  className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-all duration-300 whitespace-nowrap ${
                    statsPeriod === p.value
                      ? "bg-blue-50 border-blue-300 text-blue-700 scale-105 shadow-md"
                      : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50 hover:scale-105 hover:shadow-sm"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {statsLoading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
            </div>
          ) : statsData && statsData.stats.length > 0 ? (
            <div className="h-64 w-full transform transition-all duration-500 group-hover:scale-[1.02]">
              <Chart
                type="line"
                data={revenueChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: true,
                      position: "top",
                      labels: {
                        padding: 15,
                        font: {
                          size: 12,
                        },
                        usePointStyle: true,
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: (context: any) => {
                          const label = context.dataset.label || "";
                          const value = context.parsed.y || 0;
                          return `${label}: ${value.toLocaleString()} TZS`;
                        },
                      },
                    },
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: {
                        callback: (value: any) => {
                          return `${(value / 1000).toFixed(0)}K TZS`;
                        },
                        font: {
                          size: 11,
                        },
                      },
                      grid: {
                        color: "rgba(0, 0, 0, 0.1)",
                      },
                      title: {
                        display: true,
                        text: "Amount (TZS)",
                        font: {
                          size: 12,
                        },
                      },
                    },
                    x: {
                      grid: {
                        display: false,
                      },
                      ticks: {
                        font: {
                          size: 11,
                        },
                        maxRotation: 45,
                        minRotation: 45,
                      },
                    },
                  },
                }}
              />
            </div>
          ) : (
            <div className="h-64 w-full flex flex-col justify-end p-4">
              {/* Skeleton Area Chart */}
              <div className="relative h-full w-full">
                <div className="absolute left-0 top-0 bottom-8 w-8 flex flex-col justify-between">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-4 bg-gray-200 rounded animate-pulse"></div>
                  ))}
                </div>
                <div className="ml-10 h-full relative">
                  <div className="absolute inset-0 flex flex-col justify-between">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-px bg-gray-200"></div>
                    ))}
                  </div>
                  <svg className="w-full h-full" viewBox="0 0 400 300" preserveAspectRatio="none">
                    <path
                      d="M 0 250 Q 80 200, 160 180 T 320 150 T 400 100"
                      fill="rgba(59, 130, 246, 0.1)"
                      stroke="rgba(59, 130, 246, 0.3)"
                      strokeWidth="2"
                      className="animate-pulse"
                    />
                  </svg>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Revenue Breakdown - Donut Chart */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-purple-300 hover:-translate-y-1 group">
          <div className="flex items-center gap-2 mb-6">
            <PieChart className="h-5 w-5 text-purple-600 group-hover:scale-110 group-hover:rotate-12 transition-all duration-300" />
            <h3 className="text-lg font-semibold text-gray-900 group-hover:text-purple-600 transition-colors duration-300">Revenue Breakdown</h3>
          </div>

          {statsLoading ? (
            <div className="h-64 flex items-center justify-center">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-purple-600"></div>
            </div>
          ) : statsData && statsData.summary ? (
            <div className="h-64 w-full transform transition-all duration-500 group-hover:scale-[1.02]">
              <Chart
                type="doughnut"
                data={revenueBreakdownData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: true,
                      position: "bottom",
                      labels: {
                        padding: 15,
                        font: {
                          size: 11,
                        },
                        usePointStyle: true,
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: (context: any) => {
                          const label = context.label || "";
                          const value = context.parsed || 0;
                          const total = context.dataset.data.reduce((a: number, b: number) => a + b, 0);
                          const percentage = ((value / total) * 100).toFixed(1);
                          return `${label}: ${value.toLocaleString()} TZS (${percentage}%)`;
                        },
                      },
                    },
                  },
                }}
              />
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center">
              <div className="text-center">
                <PieChart className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                <p className="text-sm text-gray-500">No revenue data available</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Top Drivers Chart */}
      {statsData && statsData.topDrivers && statsData.topDrivers.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-emerald-300 hover:-translate-y-1 group">
          <div className="flex items-center gap-2 mb-6">
            <BarChart3 className="h-5 w-5 text-emerald-600 group-hover:scale-110 transition-transform duration-300" />
            <h3 className="text-lg font-semibold text-gray-900 group-hover:text-emerald-600 transition-colors duration-300">Top Earning Drivers</h3>
          </div>

          <div className="h-64 w-full transform transition-all duration-500 group-hover:scale-[1.02]">
            <Chart
              type="bar"
              data={topDriversChartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'y',
                plugins: {
                  legend: {
                    display: false,
                  },
                  tooltip: {
                    callbacks: {
                      label: (context: any) => {
                        const value = context.parsed.x || 0;
                        const driver = statsData.topDrivers.slice(0, 5)[context.dataIndex];
                        return `${driver.driverName}: ${value.toLocaleString()} TZS (${driver.tripCount} trips)`;
                      },
                    },
                  },
                },
                scales: {
                  x: {
                    beginAtZero: true,
                    ticks: {
                      callback: (value: any) => {
                        return `${(value / 1000).toFixed(0)}K TZS`;
                      },
                      font: {
                        size: 11,
                      },
                    },
                    grid: {
                      color: "rgba(0, 0, 0, 0.1)",
                    },
                    title: {
                      display: true,
                      text: "Revenue (TZS)",
                      font: {
                        size: 12,
                      },
                    },
                  },
                  y: {
                    grid: {
                      display: false,
                    },
                    ticks: {
                      font: {
                        size: 11,
                      },
                    },
                  },
                },
              }}
            />
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm overflow-hidden">
        <div className="flex flex-col gap-4 w-full box-border">
          {/* Top Row: Search and Date Picker */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full">
            {/* Search Box */}
            <div className="relative w-full sm:flex-1 min-w-0">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 z-10" />
                <input
                  ref={searchRef}
                  type="text"
                  className="w-full box-border pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                  placeholder="Search by driver name or email..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setPage(1);
                      load();
                    }
                  }}
                  style={{ width: '100%', maxWidth: '100%' }}
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => {
                      setQ("");
                      setPage(1);
                      load();
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors z-10"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Date Picker */}
            <div className="relative w-full sm:w-auto sm:flex-shrink-0">
              <button
                type="button"
                onClick={() => {
                  setPickerAnim(true);
                  setTimeout(() => setPickerAnim(false), 350);
                  setPickerOpen((v) => !v);
                }}
                className={`w-full box-border px-3 py-2 rounded-lg border border-gray-300 text-sm flex items-center justify-center gap-2 text-gray-700 bg-white transition-all ${
                  pickerAnim ? "ring-2 ring-blue-100" : "hover:bg-gray-50"
                }`}
                style={{ width: '100%', maxWidth: '100%' }}
              >
                <Calendar className="h-4 w-4" />
                <span>Date</span>
              </button>
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
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
            <p className="mt-3 text-sm text-gray-500">Loading revenues...</p>
          </div>
        ) : list.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <TrendingUp className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No revenue data found.</p>
            <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 whitespace-nowrap">S/N</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("driver", "Driver")}</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("areaRegistered", "Area Registered")}</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("vehicleType", "Vehicle Type")}</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("registrationNumber", "Reg No")}</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("grossRevenue", "Gross Revenue")}</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("commissionAmount", "Commission")}</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("netRevenue", "Net Revenue")}</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("tripCount", "Trips")}</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("invoiceCount", "Invoices")}</th>
                    <th className="px-6 py-3 text-left">{renderSortHeader("lastPaymentDate", "Last Payment")}</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedRevenues.map((revenue, index) => (
                    <TableRow key={revenue.id} className="transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-500">
                        {(page - 1) * pageSize + index + 1}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {revenue.driver ? (
                          <div>
                            <div className="font-medium">{revenue.driver.name}</div>
                            <div className="text-xs text-gray-500">{revenue.driver.email}</div>
                          </div>
                        ) : (
                          <span className="text-gray-400">Unassigned</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {revenue.areaRegistered || <span className="text-gray-400">N/A</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {revenue.vehicleType || <span className="text-gray-400">N/A</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {revenue.registrationNumber || <span className="font-normal text-gray-400">N/A</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">
                        {revenue.grossRevenue.toLocaleString()} TZS
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-amber-600">
                        -{revenue.commissionAmount.toLocaleString()} TZS
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-emerald-600">
                        {revenue.netRevenue.toLocaleString()} TZS
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {revenue.tripCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {revenue.invoiceCount}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {revenue.lastPaymentDate ? (
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            <div className="leading-5">
                              <div>{formatRevenueDateTime(revenue.lastPaymentDate)?.date}</div>
                              <div className="text-xs text-gray-500">{formatRevenueDateTime(revenue.lastPaymentDate)?.time}</div>
                            </div>
                          </div>
                        ) : (
                          <span className="text-gray-400">N/A</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <button
                          type="button"
                          onClick={() => openDriverDetails(revenue)}
                          disabled={!revenue.driver?.id}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                          aria-label={`View revenue details for ${revenue.driver?.name || "driver"}`}
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                      </td>
                    </TableRow>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-2 p-4">
              {sortedRevenues.map((revenue) => (
                <div key={revenue.id} className="border rounded-lg p-3 bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">
                        {revenue.driver?.name || "Unassigned"}
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {revenue.driver?.email}
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <div className="text-sm font-semibold text-emerald-600">
                        {revenue.netRevenue.toLocaleString()} TZS
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {revenue.tripCount} trips
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between text-xs">
                    <span className="text-gray-500">Gross: {revenue.grossRevenue.toLocaleString()} TZS</span>
                    <span className="text-amber-600">Commission: -{revenue.commissionAmount.toLocaleString()} TZS</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2 text-xs">
                    <div>
                      <div className="text-gray-400">Area</div>
                      <div className="mt-0.5 font-medium text-gray-700">{revenue.areaRegistered || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">Vehicle</div>
                      <div className="mt-0.5 font-medium text-gray-700">{revenue.vehicleType || "N/A"}</div>
                    </div>
                    <div>
                      <div className="text-gray-400">Reg No</div>
                      <div className="mt-0.5 font-medium text-gray-700">{revenue.registrationNumber || "N/A"}</div>
                    </div>
                  </div>
                  {revenue.lastPaymentDate && (
                    <div className="mt-2 text-xs text-gray-400">
                      Last payment: {formatRevenueDateTime(revenue.lastPaymentDate)?.date} {formatRevenueDateTime(revenue.lastPaymentDate)?.time}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => openDriverDetails(revenue)}
                    disabled={!revenue.driver?.id}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Eye className="h-4 w-4" />
                    View Details
                  </button>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="px-4 sm:px-6 py-4 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-end gap-3">
              <div className="text-sm text-gray-500 text-center sm:text-right">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total} drivers
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-400">Page {page} of {pages}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pages, p + 1))}
                  disabled={page === pages}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {detailsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-5">
          <button type="button" className="absolute inset-0 cursor-default" onClick={closeDriverDetails} aria-label="Close driver revenue details" />
          <div className="relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-6xl flex-col overflow-hidden bg-white shadow-2xl">
            <div className="flex flex-shrink-0 items-start justify-between gap-4 bg-gradient-to-r from-black via-slate-950 to-emerald-900 px-5 py-4 text-white">
              <div className="min-w-0">
                <div className="text-xs font-bold uppercase tracking-[0.28em] text-emerald-300">Driver Revenue Profile</div>
                <h2 className="mt-1 truncate text-xl font-black">{detailsData?.driver?.name || "Driver Details"}</h2>
                <p className="mt-1 text-sm text-white/65">{detailsData?.driver?.email || "Revenue, trips, ratings, and payout profile"}</p>
              </div>
              <button
                type="button"
                onClick={closeDriverDetails}
                className="border border-white/15 bg-white/10 p-2 text-white transition hover:bg-white/20"
                aria-label="Close driver revenue details"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto bg-slate-50 p-4 sm:p-6">
              {detailsLoading ? (
                <div className="flex min-h-[340px] items-center justify-center">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600" />
                </div>
              ) : detailsError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-5 text-sm text-rose-700">{detailsError}</div>
              ) : detailsData ? (
                <div className="space-y-5">
                  <div className="grid gap-4 lg:grid-cols-[1.05fr_1.2fr]">
                    <div className="border border-slate-200 bg-white p-5 shadow-sm">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-black text-base font-semibold text-white">
                          {(detailsData.driver?.name || "D").slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[17px] font-semibold leading-6 text-slate-950">{detailsData.driver?.name || "Unknown Driver"}</div>
                          <div className="mt-1 truncate text-[15px] leading-6 text-slate-500">{detailsData.driver?.phone || detailsData.driver?.email || "No contact recorded"}</div>
                        </div>
                      </div>
                      <div className="mt-5 grid gap-x-8 gap-y-0 sm:grid-cols-2">
                        {profileFact("Vehicle", detailsData.driver?.vehicleType || "N/A")}
                        {profileFact("Reg No", detailsData.driver?.registrationNumber || "N/A")}
                        {profileFact("Payout Method", formatDriverPayout(detailsData.driver?.payout ?? null))}
                        {profileFact("KYC", detailsData.driver?.kycStatus || "N/A")}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      {profileMetric("Gross", formatRevenueMoney(detailsData.summary.grossRevenue), "black", <TrendingUp className="h-4 w-4 text-emerald-300" />)}
                      {profileMetric("Driver Net", formatRevenueMoney(detailsData.summary.netRevenue), "emerald", <CreditCard className="h-4 w-4" />)}
                      {profileMetric("NoLSAF Revenue", formatRevenueMoney(detailsData.summary.commissionAmount), "amber", <BadgeCheck className="h-4 w-4" />)}
                      {profileMetric("Trips", detailsData.summary.tripCount, "white")}
                      {profileMetric("Rating", formatRevenueRating(detailsData.summary.averageCustomerRating), "white", <Star className="h-4 w-4 text-amber-500" />)}
                      {profileMetric(
                        "Last Payment",
                        `${formatRevenueDateTime(detailsData.summary.lastPaymentDate)?.date || "N/A"}${formatRevenueDateTime(detailsData.summary.lastPaymentDate)?.time ? ` · ${formatRevenueDateTime(detailsData.summary.lastPaymentDate)?.time}` : ""}`,
                        "white",
                      )}
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                      <div>
                        <h3 className="text-base font-black text-slate-950">Accomplished Trips</h3>
                        <p className="text-sm text-slate-500">Completed payout trips connected to this driver revenue record.</p>
                      </div>
                      <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                        {detailsData.trips.length} trips
                      </div>
                    </div>
                    <div className="max-h-[360px] overflow-y-auto">
                      <table className="w-full min-w-[1080px]">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-500 whitespace-nowrap">S/N</th>
                            <th className="px-4 py-3 text-left">{renderTripDetailSortHeader("tripCode", "Trip")}</th>
                            <th className="px-4 py-3 text-left">{renderTripDetailSortHeader("route", "Route")}</th>
                            <th className="px-4 py-3 text-left">{renderTripDetailSortHeader("areaRegistered", "Area")}</th>
                            <th className="px-4 py-3 text-left">{renderTripDetailSortHeader("vehicleType", "Vehicle")}</th>
                            <th className="px-4 py-3 text-left">{renderTripDetailSortHeader("grossRevenue", "Gross")}</th>
                            <th className="px-4 py-3 text-left">{renderTripDetailSortHeader("commissionAmount", "NoLSAF")}</th>
                            <th className="px-4 py-3 text-left">{renderTripDetailSortHeader("netRevenue", "Driver Net")}</th>
                            <th className="px-4 py-3 text-left">{renderTripDetailSortHeader("customerRating", "Rating")}</th>
                            <th className="px-4 py-3 text-left">{renderTripDetailSortHeader("paidAt", "Paid")}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {pagedDetailTrips.map((trip, index) => (
                            <TableRow key={trip.payoutId} className="align-top">
                              <td className="px-4 py-3 text-sm font-bold text-slate-500">{(tripDetailPage - 1) * tripDetailPageSize + index + 1}</td>
                              <td className="px-4 py-3 text-sm">
                                <div className="line-clamp-2 max-w-[150px] break-all font-bold leading-5 text-slate-950">{trip.tripCode}</div>
                                <div className="text-xs text-slate-500">{trip.status}</div>
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-700">
                                <div className="flex gap-2">
                                  <MapPinned className="mt-0.5 h-4 w-4 flex-shrink-0 text-sky-600" />
                                  <div>
                                    <div className="line-clamp-1">{trip.pickup}</div>
                                    <div className="line-clamp-1 text-slate-500">{trip.dropoff}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-slate-700">{trip.areaRegistered || "N/A"}</td>
                              <td className="px-4 py-3 text-sm text-slate-700">
                                <div className="flex items-center gap-2">
                                  <Car className="h-4 w-4 text-slate-400" />
                                  <span>{trip.vehicleType || "N/A"}</span>
                                </div>
                                <div className="text-xs text-slate-500">{trip.registrationNumber || "No reg"}</div>
                              </td>
                              <td className="px-4 py-3 text-sm font-semibold text-slate-950">{formatRevenueMoney(trip.grossRevenue)}</td>
                              <td className="px-4 py-3 text-sm font-semibold text-amber-600">-{formatRevenueMoney(trip.commissionAmount)}</td>
                              <td className="px-4 py-3 text-sm font-semibold text-emerald-700">{formatRevenueMoney(trip.netRevenue)}</td>
                              <td className="px-4 py-3 text-sm text-slate-700">{formatRevenueRating(trip.customerRating)}</td>
                              <td className="px-4 py-3 text-sm text-slate-700">
                                <div>{formatRevenueDateTime(trip.paidAt)?.date || "N/A"}</div>
                                <div className="text-xs text-slate-500">{formatRevenueDateTime(trip.paidAt)?.time || trip.paymentMethod || ""}</div>
                              </td>
                            </TableRow>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex flex-col items-center justify-end gap-3 border-t border-slate-100 px-4 py-3 text-sm sm:flex-row">
                      <div className="text-slate-500">
                        Showing {(tripDetailPage - 1) * tripDetailPageSize + 1} to {Math.min(tripDetailPage * tripDetailPageSize, sortedDetailTrips.length)} of {sortedDetailTrips.length} trips
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-400">Page {tripDetailPage} of {tripDetailPages}</span>
                        <button
                          type="button"
                          onClick={() => setTripDetailPage((current) => Math.max(1, current - 1))}
                          disabled={tripDetailPage === 1}
                          className="border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() => setTripDetailPage((current) => Math.min(tripDetailPages, current + 1))}
                          disabled={tripDetailPage === tripDetailPages}
                          className="border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-600">No driver revenue details available.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


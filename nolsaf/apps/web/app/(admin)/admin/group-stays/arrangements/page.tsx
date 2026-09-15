"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { Wrench, Search, X, Calendar, MapPin, UsersRound, BarChart3, Truck, Bus, Coffee, User, Package, AlertCircle, RefreshCw, Loader2 } from "lucide-react";
import DatePicker from "@/components/ui/DatePicker";
import apiClient from "@/lib/apiClient";
import Chart from "@/components/Chart";
import type { ChartData } from "chart.js";
import Link from "next/link";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;

function authify() {}

// Input sanitization helper
function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "").slice(0, 200);
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
  arrangements: {
    pickup: boolean;
    transport: boolean;
    meals: boolean;
    guide: boolean;
    equipment: boolean;
  };
  createdAt: string;
};

type ArrangementStats = {
  arrangementCounts: {
    pickup: number;
    transport: number;
    meals: number;
    guide: number;
    equipment: number;
  };
  groupTypeArrangements: Record<string, Record<string, number>>;
  regionArrangements: Record<string, Record<string, number>>;
  statusArrangements: Record<string, Record<string, number>>;
  topRegions: Array<{
    region: string;
    total: number;
    pickup: number;
    transport: number;
    meals: number;
    guide: number;
    equipment: number;
  }>;
  bookingsWithArrangements: number;
  totalBookings: number;
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

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
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [pickerAnim, setPickerAnim] = useState(false);
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
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQ(q);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: any = {
        page,
        pageSize,
      };
      
      // Validate and sanitize inputs
      if (arrType && isValidArrType(arrType)) {
        params.arrType = arrType;
      }
      if (groupType && isValidGroupType(groupType)) {
        params.groupType = groupType;
      }
      if (status && isValidStatus(status)) {
        params.status = status;
      }
      if (date) {
        if (Array.isArray(date)) {
          params.start = date[0];
          params.end = date[1];
        } else {
          params.date = date;
        }
      }
      if (debouncedQ) {
        params.q = sanitizeInput(debouncedQ);
      }

      const r = await api.get<{ items: ArrangementRow[]; total: number }>("/api/admin/group-stays/arrangements", { params });
      setList(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);
    } catch (err: any) {
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load arrangements";
      setError(errorMessage);
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
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load arrangement statistics";
      setStatsError(errorMessage);
      console.error("Failed to load arrangement statistics", err);
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    authify();
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
    loadStats();
  }, [load, loadStats]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  // Chart data for Arrangements Distribution (Donut Chart)
  const arrangementsDonutChartData = useMemo<ChartData<"doughnut">>(() => {
    if (!stats || !stats.arrangementCounts) {
      return { labels: [], datasets: [] };
    }

    const labels = ["Pickup", "Transport", "Meals", "Guide", "Equipment"];
    const data = [
      stats.arrangementCounts.pickup,
      stats.arrangementCounts.transport,
      stats.arrangementCounts.meals,
      stats.arrangementCounts.guide,
      stats.arrangementCounts.equipment,
    ];

    const colors = [
      "rgba(59, 130, 246, 0.8)", // Blue
      "rgba(16, 185, 129, 0.8)", // Green
      "rgba(245, 158, 11, 0.8)", // Amber
      "rgba(139, 92, 246, 0.8)", // Purple
      "rgba(239, 68, 68, 0.8)", // Red
    ];

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderColor: "#fff",
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    };
  }, [stats]);

  // Chart data for Arrangements by Group Type (Bar Chart)
  const groupTypeBarChartData = useMemo<ChartData<"bar">>(() => {
    if (!stats || !stats.groupTypeArrangements) {
      return { labels: [], datasets: [] };
    }

    const groupTypes = Object.keys(stats.groupTypeArrangements);
    const labels = groupTypes.map(gt => gt.charAt(0).toUpperCase() + gt.slice(1));

    return {
      labels,
      datasets: [
        {
          label: "Pickup",
          data: groupTypes.map(gt => stats.groupTypeArrangements[gt]?.pickup || 0),
          backgroundColor: "rgba(59, 130, 246, 0.8)",
          borderColor: "rgba(59, 130, 246, 1)",
          borderWidth: 1,
        },
        {
          label: "Transport",
          data: groupTypes.map(gt => stats.groupTypeArrangements[gt]?.transport || 0),
          backgroundColor: "rgba(16, 185, 129, 0.8)",
          borderColor: "rgba(16, 185, 129, 1)",
          borderWidth: 1,
        },
        {
          label: "Meals",
          data: groupTypes.map(gt => stats.groupTypeArrangements[gt]?.meals || 0),
          backgroundColor: "rgba(245, 158, 11, 0.8)",
          borderColor: "rgba(245, 158, 11, 1)",
          borderWidth: 1,
        },
        {
          label: "Guide",
          data: groupTypes.map(gt => stats.groupTypeArrangements[gt]?.guide || 0),
          backgroundColor: "rgba(139, 92, 246, 0.8)",
          borderColor: "rgba(139, 92, 246, 1)",
          borderWidth: 1,
        },
        {
          label: "Equipment",
          data: groupTypes.map(gt => stats.groupTypeArrangements[gt]?.equipment || 0),
          backgroundColor: "rgba(239, 68, 68, 0.8)",
          borderColor: "rgba(239, 68, 68, 1)",
          borderWidth: 1,
        },
      ],
    };
  }, [stats]);

  // Chart data for Top Regions (Horizontal Bar Chart)
  const topRegionsBarChartData = useMemo<ChartData<"bar">>(() => {
    if (!stats || !stats.topRegions || stats.topRegions.length === 0) {
      return { labels: [], datasets: [] };
    }

    const labels = stats.topRegions.map(r => r.region);
    const data = stats.topRegions.map(r => r.total);

    return {
      labels,
      datasets: [
        {
          label: "Total Arrangements",
          data,
          backgroundColor: "rgba(139, 92, 246, 0.8)",
          borderColor: "rgba(139, 92, 246, 1)",
          borderWidth: 1,
        },
      ],
    };
  }, [stats]);

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col items-center text-center">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-amber-50 to-amber-100 flex items-center justify-center mb-4">
            <Wrench className="h-8 w-8 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Arrangements</h1>
          <p className="text-sm text-gray-500 mt-1">Manage and view all service arrangements for group bookings</p>
        </div>
      </div>

      {/* Summary Cards */}
      {statsError ? (
        <div className="bg-white rounded-lg border border-red-200 p-6 shadow-sm">
          <div className="flex flex-col items-center justify-center py-8">
            <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
            <p className="text-sm font-medium text-gray-700 mb-2">Failed to load statistics</p>
            <p className="text-xs text-gray-500 text-center mb-4">{statsError}</p>
            <button
              onClick={loadStats}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        </div>
      ) : stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-all duration-300 hover:border-blue-300 group">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-blue-100 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Truck className="h-6 w-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-500 mb-1">Pickup</div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.arrangementCounts.pickup.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-all duration-300 hover:border-green-300 group">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-green-100 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Bus className="h-6 w-6 text-green-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-500 mb-1">Transport</div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.arrangementCounts.transport.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-all duration-300 hover:border-amber-300 group">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-amber-100 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Coffee className="h-6 w-6 text-amber-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-500 mb-1">Meals</div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.arrangementCounts.meals.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-all duration-300 hover:border-purple-300 group">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-purple-100 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <User className="h-6 w-6 text-purple-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-500 mb-1">Guide</div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.arrangementCounts.guide.toLocaleString()}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm hover:shadow-md transition-all duration-300 hover:border-red-300 group">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-xl bg-red-100 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                <Package className="h-6 w-6 text-red-600" />
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-500 mb-1">Equipment</div>
                <div className="text-2xl font-bold text-gray-900">
                  {stats.arrangementCounts.equipment.toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Donut Chart - Arrangements Distribution */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-amber-300 hover:-translate-y-1 group">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 group-hover:text-amber-600 transition-colors duration-300">
              <Wrench className="h-5 w-5 text-amber-600 group-hover:scale-110 transition-transform duration-300" />
              Arrangements Distribution
            </h3>
            <p className="text-sm text-gray-500 mt-1">Breakdown of all service arrangements</p>
          </div>
          <div className="h-64 w-full max-h-64 min-h-[300px] overflow-hidden relative">
            {statsLoading ? (
              <div className="h-full w-full flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-amber-600"></div>
              </div>
            ) : stats && stats.arrangementCounts ? (
              <Chart
                type="doughnut"
                data={arrangementsDonutChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: "right",
                      labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: {
                          size: 12,
                        },
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: (context: any) => {
                          const label = context.label || "";
                          const value = context.parsed || 0;
                          const total = context.dataset.data.reduce((sum: number, val: number) => sum + val, 0);
                          const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                          return `${label}: ${value} (${percentage}%)`;
                        },
                      },
                    },
                  },
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-center">
                <div>
                  <Wrench className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">No arrangement data available</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bar Chart - Arrangements by Group Type */}
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-purple-300 hover:-translate-y-1 group">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 group-hover:text-purple-600 transition-colors duration-300">
              <BarChart3 className="h-5 w-5 text-purple-600 group-hover:scale-110 transition-transform duration-300" />
              Arrangements by Group Type
            </h3>
            <p className="text-sm text-gray-500 mt-1">Service arrangements breakdown by group type</p>
          </div>
          <div className="h-64 w-full max-h-64 min-h-[300px] overflow-hidden relative">
            {statsLoading ? (
              <div className="h-full w-full flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-purple-600"></div>
              </div>
            ) : stats && stats.groupTypeArrangements && Object.keys(stats.groupTypeArrangements).length > 0 ? (
              <Chart
                type="bar"
                data={groupTypeBarChartData}
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
                          size: 11,
                        },
                        usePointStyle: true,
                      },
                    },
                    tooltip: {
                      callbacks: {
                        label: (context: any) => {
                          const label = context.dataset.label || "";
                          const value = context.parsed.y || 0;
                          return `${label}: ${value}`;
                        },
                      },
                    },
                  },
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: {
                        stepSize: 1,
                        font: {
                          size: 11,
                        },
                      },
                      grid: {
                        color: "rgba(0, 0, 0, 0.1)",
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
                      },
                    },
                  },
                }}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-center">
                <div>
                  <BarChart3 className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">No group type data available</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top Regions Chart */}
      {stats && stats.topRegions && stats.topRegions.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm transition-all duration-300 hover:shadow-lg hover:border-blue-300 hover:-translate-y-1 group">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 group-hover:text-blue-600 transition-colors duration-300">
              <MapPin className="h-5 w-5 text-blue-600 group-hover:scale-110 transition-transform duration-300" />
              Top Regions by Arrangements
            </h3>
            <p className="text-sm text-gray-500 mt-1">Regions with the most service arrangements</p>
          </div>
          <div className="h-64 w-full max-h-64 min-h-[300px] overflow-hidden relative">
            {statsLoading ? (
              <div className="h-full w-full flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
              </div>
            ) : (
              <Chart
                type="bar"
                data={topRegionsBarChartData}
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
                          return `Total Arrangements: ${value}`;
                        },
                      },
                    },
                  },
                  scales: {
                    x: {
                      beginAtZero: true,
                      ticks: {
                        stepSize: 1,
                        font: {
                          size: 11,
                        },
                      },
                      grid: {
                        color: "rgba(0, 0, 0, 0.1)",
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
            )}
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
        <div className="flex flex-col gap-4 w-full max-w-full">
          {/* Search and Filters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 w-full max-w-full">
            {/* Search Box */}
            <div className="relative w-full min-w-0 sm:col-span-2 lg:col-span-2 xl:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-sm max-w-full box-border"
                placeholder="Search bookings..."
                value={q}
                onChange={(e) => setQ(sanitizeInput(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setPage(1);
                  }
                }}
                aria-label="Search arrangements by customer name, email, or destination"
                title="Search arrangements"
                maxLength={200}
              />
              {q && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    setPage(1);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Arrangement Type */}
            <div className="w-full min-w-0">
              <select
                value={arrType}
                onChange={(e) => {
                  setArrType(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by arrangement type"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-sm bg-white max-w-full box-border"
              >
                <option value="">All Arrangements</option>
                <option value="pickup">Pickup</option>
                <option value="transport">Transport</option>
                <option value="meals">Meals</option>
                <option value="guide">Guide</option>
                <option value="equipment">Equipment</option>
              </select>
            </div>

            {/* Group Type */}
            <div className="w-full min-w-0">
              <select
                value={groupType}
                onChange={(e) => {
                  setGroupType(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by group type"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-sm bg-white max-w-full box-border"
              >
                <option value="">All Group Types</option>
                <option value="family">Family</option>
                <option value="workers">Workers</option>
                <option value="event">Event</option>
                <option value="students">Students</option>
                <option value="team">Team</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Status */}
            <div className="w-full min-w-0">
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by status"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none text-sm bg-white max-w-full box-border"
              >
                <option value="">All Status</option>
                <option value="PENDING">Pending</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="PROCESSING">Processing</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELED">Canceled</option>
              </select>
            </div>

            {/* Date Picker */}
            <div className="relative w-full min-w-0">
              <button
                type="button"
                onClick={() => {
                  setPickerAnim(true);
                  setTimeout(() => setPickerAnim(false), 350);
                  setPickerOpen((v) => !v);
                }}
                aria-label="Select date filter"
                title="Select date filter"
                className={`w-full px-3 py-2 rounded-lg border border-gray-300 text-sm flex items-center justify-center gap-2 text-gray-700 bg-white transition-all ${
                  pickerAnim ? "ring-2 ring-amber-100" : "hover:bg-gray-50"
                } box-border`}
              >
                <Calendar className="h-4 w-4" aria-hidden="true" />
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

      {/* Arrangements Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 text-center" role="status" aria-live="polite" aria-label="Loading arrangements">
            <Loader2 className="h-8 w-8 text-amber-600 animate-spin mx-auto mb-4" />
            <p className="text-sm font-medium text-gray-700">Loading arrangements...</p>
          </div>
        ) : error ? (
          <div className="px-6 py-12 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <p className="text-sm font-medium text-gray-700 mb-2">Failed to load arrangements</p>
            <p className="text-xs text-gray-500 text-center mb-4">{error}</p>
            <button
              onClick={load}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </button>
          </div>
        ) : list.length === 0 ? (
          <>
            {/* Skeleton Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booking ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Group Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Headcount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Arrangements</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {[...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-12"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-32"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-28"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-12"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex gap-1">
                          <div className="h-5 bg-gray-200 rounded w-16"></div>
                          <div className="h-5 bg-gray-200 rounded w-20"></div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-6 bg-gray-200 rounded-full w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <div className="h-8 bg-gray-200 rounded w-16 ml-auto"></div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : list.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <Wrench className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No arrangements found.</p>
            <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booking ID</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Group Type</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Customer</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Headcount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Arrangements</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {list.map((booking) => (
                    <tr key={booking.id} className="hover:bg-gray-50 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">#{booking.id}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 capitalize">{booking.groupType}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {booking.customer ? (
                          <div className="flex items-center gap-2">
                            <UsersRound className="h-4 w-4 text-gray-400" />
                            <span className="max-w-xs truncate">{booking.customer.name}</span>
                          </div>
                        ) : (
                          "N/A"
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="flex items-center gap-2">
                          <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          <span className="max-w-xs truncate">{booking.destination.region}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{booking.headcount}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="flex flex-wrap gap-1">
                          {booking.arrangements.pickup && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Pickup</span>
                          )}
                          {booking.arrangements.transport && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">Transport</span>
                          )}
                          {booking.arrangements.meals && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">Meals</span>
                          )}
                          {booking.arrangements.guide && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">Guide</span>
                          )}
                          {booking.arrangements.equipment && (
                            <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 rounded-full">Equipment</span>
                          )}
                          {!booking.arrangements.pickup && !booking.arrangements.transport && !booking.arrangements.meals && !booking.arrangements.guide && !booking.arrangements.equipment && (
                            <span className="text-gray-400">None</span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          booking.status === "COMPLETED" ? "bg-green-100 text-green-800" :
                          booking.status === "CONFIRMED" ? "bg-blue-100 text-blue-800" :
                          booking.status === "PROCESSING" ? "bg-amber-100 text-amber-800" :
                          booking.status === "CANCELED" ? "bg-red-100 text-red-800" :
                          "bg-gray-100 text-gray-800"
                        }`}>
                          {booking.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button 
                          className="text-amber-600 hover:text-amber-900"
                          aria-label={`View details for booking #${booking.id}`}
                          title="View booking details"
                          onClick={() => openDetails(booking)}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden divide-y divide-gray-200">
              {list.map((booking) => (
                <div key={booking.id} className="p-4 bg-white hover:bg-gray-50 transition-colors duration-150">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-900">Booking #{booking.id}</span>
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      booking.status === "COMPLETED" ? "bg-green-100 text-green-800" :
                      booking.status === "CONFIRMED" ? "bg-blue-100 text-blue-800" :
                      booking.status === "PROCESSING" ? "bg-amber-100 text-amber-800" :
                      booking.status === "CANCELED" ? "bg-red-100 text-red-800" :
                      "bg-gray-100 text-gray-800"
                    }`}>
                      {booking.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1">
                    <span>Type: {booking.groupType} • Headcount: {booking.headcount}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <UsersRound className="h-4 w-4 text-gray-400" />
                    <span>Customer: {booking.customer?.name || "N/A"}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-gray-400" />
                    <span>Destination: {booking.destination.region}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1">
                    <div className="font-medium text-gray-700 mb-1">Arrangements:</div>
                    <div className="flex flex-wrap gap-1">
                      {booking.arrangements.pickup && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">Pickup</span>
                      )}
                      {booking.arrangements.transport && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-800 rounded-full">Transport</span>
                      )}
                      {booking.arrangements.meals && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded-full">Meals</span>
                      )}
                      {booking.arrangements.guide && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-purple-100 text-purple-800 rounded-full">Guide</span>
                      )}
                      {booking.arrangements.equipment && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 rounded-full">Equipment</span>
                      )}
                      {!booking.arrangements.pickup && !booking.arrangements.transport && !booking.arrangements.meals && !booking.arrangements.guide && !booking.arrangements.equipment && (
                        <span className="text-gray-400">None</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 text-right">
                    <button 
                      className="text-amber-600 hover:text-amber-900 text-sm"
                      aria-label={`View details for booking #${booking.id}`}
                      title="View booking details"
                      onClick={() => openDetails(booking)}
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Details Modal */}
      {detailsMounted && selected && (
        <div className={`fixed inset-0 z-50 ${detailsVisible ? "" : "pointer-events-none"}`} aria-modal="true" role="dialog">
          <div
            className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ease-out ${detailsVisible ? "opacity-100" : "opacity-0"}`}
            onClick={closeDetails}
          />

          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div
              className={`w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden transform transition-all duration-200 ease-out ${
                detailsVisible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-3 scale-[0.98]"
              }`}
            >
              <div className="px-5 py-4 bg-gradient-to-b from-gray-50 to-white border-b border-gray-100">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs text-gray-500">Booking</div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-gray-900 truncate">#{selected.id} • Arrangements</h2>
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        selected.status === "COMPLETED" ? "bg-green-100 text-green-800" :
                        selected.status === "CONFIRMED" ? "bg-blue-100 text-blue-800" :
                        selected.status === "PROCESSING" ? "bg-amber-100 text-amber-800" :
                        selected.status === "CANCELED" ? "bg-red-100 text-red-800" :
                        "bg-gray-100 text-gray-800"
                      }`}>{selected.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Created {formatDateTime(selected.createdAt)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={closeDetails}
                    className="p-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="max-h-[70vh] overflow-y-auto px-5 py-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                    <div className="text-[11px] font-medium text-gray-500">Customer</div>
                    <div className="text-sm font-semibold text-gray-900 truncate">{selected.customer?.name || "N/A"}</div>
                    <div className="text-xs text-gray-600 truncate">{selected.customer?.email || "—"}</div>
                    <div className="text-xs text-gray-600 truncate">{selected.customer?.phone || "—"}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3">
                    <div className="text-[11px] font-medium text-gray-500">Destination</div>
                    <div className="text-sm font-semibold text-gray-900 truncate">{selected.destination.region}</div>
                    <div className="text-xs text-gray-600 truncate">
                      {[selected.destination.district, selected.destination.ward, selected.destination.location].filter(Boolean).join(" • ") || "—"}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-gray-100 p-3">
                    <div className="text-[11px] font-medium text-gray-500">Headcount</div>
                    <div className="text-sm font-semibold text-gray-900">{selected.headcount}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-3">
                    <div className="text-[11px] font-medium text-gray-500">Check-in</div>
                    <div className="text-sm font-semibold text-gray-900">{formatDateTime(selected.checkIn)}</div>
                  </div>
                  <div className="rounded-xl border border-gray-100 p-3">
                    <div className="text-[11px] font-medium text-gray-500">Check-out</div>
                    <div className="text-sm font-semibold text-gray-900">{formatDateTime(selected.checkOut)}</div>
                  </div>
                </div>

                <div className="rounded-xl border border-gray-100 p-3">
                  <div className="text-[11px] font-medium text-gray-500 mb-2">Arrangements</div>
                  <div className="flex flex-wrap gap-2">
                    {selected.arrangements.pickup && <span className="px-2.5 py-1 text-xs font-medium bg-blue-50 text-blue-700 rounded-full">Pickup</span>}
                    {selected.arrangements.transport && <span className="px-2.5 py-1 text-xs font-medium bg-green-50 text-green-700 rounded-full">Transport</span>}
                    {selected.arrangements.meals && <span className="px-2.5 py-1 text-xs font-medium bg-amber-50 text-amber-700 rounded-full">Meals</span>}
                    {selected.arrangements.guide && <span className="px-2.5 py-1 text-xs font-medium bg-purple-50 text-purple-700 rounded-full">Guide</span>}
                    {selected.arrangements.equipment && <span className="px-2.5 py-1 text-xs font-medium bg-red-50 text-red-700 rounded-full">Equipment</span>}
                    {!selected.arrangements.pickup && !selected.arrangements.transport && !selected.arrangements.meals && !selected.arrangements.guide && !selected.arrangements.equipment && (
                      <span className="text-xs text-gray-500">No arrangements selected.</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
                <Link
                  href={`/admin/group-stays/bookings?bookingId=${encodeURIComponent(String(selected.id))}`}
                  className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 rounded-lg hover:bg-amber-100 transition-colors"
                >
                  Go to booking
                </Link>
                <button
                  type="button"
                  onClick={closeDetails}
                  className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pagination */}
      {list.length > 0 && (
        <div className="flex justify-center py-4">
          <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              aria-label="Go to previous page"
              className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <span className="relative inline-flex items-center px-4 py-2 border border-gray-300 bg-white text-sm font-medium text-gray-700">
              Page {page} of {pages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page === pages}
              aria-label="Go to next page"
              className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </nav>
        </div>
      )}
    </div>
  );
}


"use client";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { Users, Search, X, MapPin, User, UsersRound, Globe, TrendingUp, Calendar, Phone, Hash, ExternalLink } from "lucide-react";
import apiClient from "@/lib/apiClient";
import Chart from "@/components/Chart";
import type { ChartData } from "chart.js";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;
function authify() {}

type PassengerRow = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string | number | null;
  age: number | null;
  gender: string | null;
  nationality: string | null;
  sequenceNumber: number;
  booking: {
    id: number;
    groupType: string;
    destination: string;
    checkIn: string | null;
    checkOut: string | null;
    status: string;
    customer: { id: number; name: string; email: string } | null;
  } | null;
};

type PassengerStats = {
  totalPassengers: number;
  averageAge: number;
  genderStats: Record<string, number>;
  nationalityStats: Record<string, number>;
  ageGroups: Record<string, number>;
  groupTypeStats: Record<string, number>;
  regionStats: Record<string, number>;
  topNationalities: Array<{ nationality: string; count: number }>;
};

export default function AdminGroupStaysPassengersPage() {
  const [bookingId, setBookingId] = useState<string>("");
  const [groupType, setGroupType] = useState<string>("");
  const [gender, setGender] = useState<string>("");
  const [nationality, setNationality] = useState<string>("");
  const [ageMin, setAgeMin] = useState<string>("");
  const [ageMax, setAgeMax] = useState<string>("");
  const [q, setQ] = useState("");
  const [list, setList] = useState<PassengerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 30;
  const searchRef = useRef<HTMLInputElement | null>(null);
  const qRef = useRef(q);

  useEffect(() => {
    qRef.current = q;
  }, [q]);

  // Passenger details modal
  const [selectedPassenger, setSelectedPassenger] = useState<PassengerRow | null>(null);
  const [showPassengerModal, setShowPassengerModal] = useState(false);
  const [passengerModalMounted, setPassengerModalMounted] = useState(false);
  const [passengerModalVisible, setPassengerModalVisible] = useState(false);
  const openPassengerModal = useCallback((passenger: PassengerRow) => {
    setSelectedPassenger(passenger);
    setShowPassengerModal(true);
  }, []);
  const closePassengerModal = useCallback(() => {
    setShowPassengerModal(false);
  }, []);

  useEffect(() => {
    if (showPassengerModal) {
      setPassengerModalMounted(true);
      const id = window.requestAnimationFrame(() => setPassengerModalVisible(true));
      return () => window.cancelAnimationFrame(id);
    }

    setPassengerModalVisible(false);
    const t = window.setTimeout(() => {
      setPassengerModalMounted(false);
      setSelectedPassenger(null);
    }, 180);
    return () => window.clearTimeout(t);
  }, [showPassengerModal]);

  useEffect(() => {
    if (!passengerModalMounted) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closePassengerModal();
      }
    };

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [passengerModalMounted, closePassengerModal]);

  const expandScientificNotation = useCallback((raw: string) => {
    const s = raw.trim();
    const m = s.match(/^([+-]?\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
    if (!m) return raw;

    const intPart = m[1].replace(/^\+/, "");
    const fracPart = m[2] ?? "";
    const exponent = Number(m[3]);
    if (!Number.isFinite(exponent) || exponent < 0) return raw;

    const digits = `${intPart}${fracPart}`.replace(/^0+/, "0");
    const decimalIndex = intPart.length;
    const newIndex = decimalIndex + exponent;

    if (newIndex <= 0) return raw;
    if (newIndex < digits.length) {
      // Would still have decimals; keep original string to avoid surprising formatting.
      return raw;
    }

    return `${digits}${"0".repeat(newIndex - digits.length)}`;
  }, []);

  const formatPhone = useCallback((value: PassengerRow["phone"]) => {
    if (value == null || value === "") return "N/A";
    if (typeof value === "number") {
      try {
        return new Intl.NumberFormat("en-US", {
          useGrouping: false,
          maximumFractionDigits: 0,
        }).format(value);
      } catch {
        return String(value);
      }
    }
    const asString = String(value).trim();
    if (/\d(?:\.\d+)?[eE][+-]?\d+/.test(asString)) {
      return expandScientificNotation(asString);
    }
    return asString;
  }, [expandScientificNotation]);

  const formatDateTime = useCallback((value: string | null | undefined) => {
    if (!value) return "N/A";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  // Stats state
  const [stats, setStats] = useState<PassengerStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {
        page,
        pageSize,
      };
      if (bookingId) params.bookingId = bookingId;
      if (groupType) params.groupType = groupType;
      if (gender) params.gender = gender;
      if (nationality) params.nationality = nationality;
      if (ageMin) params.ageMin = ageMin;
      if (ageMax) params.ageMax = ageMax;
      if (qRef.current) params.q = qRef.current;

      // IMPORTANT: call via /api/* so we hit the API proxy, not the Next.js page route.
      const r = await api.get<{ items: PassengerRow[]; total: number }>("/api/admin/group-stays/passengers", { params });
      setList(r.data?.items ?? []);
      setTotal(r.data?.total ?? 0);
    } catch (err) {
      console.error("Failed to load passengers", err);
      setList([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, bookingId, groupType, gender, nationality, ageMin, ageMax]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const r = await api.get<PassengerStats>("/api/admin/group-stays/passengers/stats");
      setStats(r.data);
    } catch (err) {
      console.error("Failed to load passenger statistics", err);
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

  // Prepare Gender Chart data
  const genderChartData = useMemo<ChartData<"doughnut">>(() => {
    if (!stats || !stats.genderStats) {
      return { labels: [], datasets: [] };
    }

    const labels = Object.keys(stats.genderStats).filter(key => stats.genderStats[key] > 0);
    const data = Object.values(stats.genderStats).filter((v, i) => Object.values(stats.genderStats)[i] > 0);

    const colors = [
      "rgba(59, 130, 246, 0.8)", // Blue
      "rgba(236, 72, 153, 0.8)", // Pink
      "rgba(107, 114, 128, 0.8)", // Gray
    ];

    return {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors.slice(0, labels.length),
          borderColor: "#fff",
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    };
  }, [stats]);

  // Prepare Age Groups Chart data
  const ageGroupsChartData = useMemo<ChartData<"bar">>(() => {
    if (!stats || !stats.ageGroups) {
      return { labels: [], datasets: [] };
    }

    const labels = Object.keys(stats.ageGroups);
    const data = Object.values(stats.ageGroups);

    return {
      labels,
      datasets: [
        {
          label: "Passengers",
          data,
          backgroundColor: "rgba(139, 92, 246, 0.8)",
          borderColor: "rgba(139, 92, 246, 1)",
          borderWidth: 1,
        },
      ],
    };
  }, [stats]);

  // Nationality chart replaced by ranked list — no chartData needed

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Premium Banner */}
      <div style={{ position: "relative", borderRadius: "1.25rem", overflow: "hidden", background: "linear-gradient(135deg, #14532d 0%, #166534 40%, #1e3a5f 100%)", boxShadow: "0 24px 60px -12px rgba(20,83,45,0.45), 0 8px 20px -8px rgba(30,58,138,0.30)", padding: "2rem 2rem 1.75rem" }}>
        <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.10, pointerEvents: "none" }} viewBox="0 0 900 160" preserveAspectRatio="xMidYMid slice">
          <circle cx="820" cy="30" r="100" fill="none" stroke="white" strokeWidth="1.2" />
          <circle cx="820" cy="30" r="60" fill="none" stroke="white" strokeWidth="0.7" />
          <circle cx="60" cy="140" r="75" fill="none" stroke="white" strokeWidth="1.0" />
          <line x1="0" y1="40" x2="900" y2="40" stroke="white" strokeWidth="0.35" />
          <line x1="0" y1="80" x2="900" y2="80" stroke="white" strokeWidth="0.35" />
          <line x1="0" y1="120" x2="900" y2="120" stroke="white" strokeWidth="0.35" />
          <polyline points="0,140 120,118 240,100 360,82 480,95 600,60 720,42 840,55 900,38" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <polygon points="0,140 120,118 240,100 360,82 480,95 600,60 720,42 840,55 900,38 900,160 0,160" fill="white" opacity={0.05} />
          <circle cx="600" cy="60" r="5" fill="white" opacity={0.75} />
          <circle cx="720" cy="42" r="5" fill="white" opacity={0.75} />
        </svg>
        <div style={{ position: "relative", zIndex: 1, display: "flex", alignItems: "center", gap: "1rem" }}>
          <div style={{ width: 50, height: 50, borderRadius: "50%", background: "rgba(255,255,255,0.12)", border: "1.5px solid rgba(255,255,255,0.25)", boxShadow: "0 0 0 8px rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <UsersRound style={{ width: 24, height: 24, color: "white" }} />
          </div>
          <div>
            <h1 style={{ fontSize: "1.4rem", fontWeight: 800, color: "white", margin: 0, letterSpacing: "-0.01em" }}>Passengers</h1>
            <p style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.60)", margin: "3px 0 0" }}>Manage and view all passenger rosters from group bookings</p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Total Passengers */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-emerald-400 to-emerald-600" />
            <div className="p-5 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
                <Users className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Total Passengers</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">{stats.totalPassengers.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Average Age */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-blue-400 to-blue-600" />
            <div className="p-5 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Average Age</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">{stats.averageAge > 0 ? `${stats.averageAge} yrs` : "N/A"}</div>
              </div>
            </div>
          </div>

          {/* Gender Groups */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-purple-400 to-purple-600" />
            <div className="p-5 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center flex-shrink-0">
                <User className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Gender Groups</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">{Object.keys(stats.genderStats).filter(k => stats.genderStats[k] > 0).length}</div>
              </div>
            </div>
          </div>

          {/* Nationalities */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-500" />
            <div className="p-5 flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
                <Globe className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Nationalities</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">{Object.keys(stats.nationalityStats).filter(k => stats.nationalityStats[k] > 0).length}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gender Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-blue-400 to-purple-500" />
          <div className="p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-blue-50 border border-blue-100"><User className="h-4 w-4 text-blue-600" /></span>
              Gender Distribution
            </h3>
            <p className="text-xs text-gray-400 mt-1 ml-9">Breakdown of passengers by gender</p>
          </div>
          <div className="h-64 w-full max-h-64 min-h-[300px] overflow-hidden relative">
            {statsLoading ? (
              <div className="h-full w-full flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
              </div>
            ) : stats && Object.keys(stats.genderStats).some(k => stats.genderStats[k] > 0) ? (
              <Chart
                type="doughnut"
                data={genderChartData}
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
                  <User className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">No gender data available</p>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Age Groups Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-purple-400 to-violet-600" />
          <div className="p-6">
          <div className="mb-4">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-purple-50 border border-purple-100"><TrendingUp className="h-4 w-4 text-purple-600" /></span>
              Age Groups
            </h3>
            <p className="text-xs text-gray-400 mt-1 ml-9">Distribution of passengers by age groups</p>
          </div>
          <div className="h-64 w-full max-h-64 min-h-[300px] overflow-hidden relative">
            {statsLoading ? (
              <div className="h-full w-full flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-purple-600"></div>
              </div>
            ) : stats && Object.keys(stats.ageGroups).some(k => stats.ageGroups[k] > 0) ? (
              <Chart
                type="bar"
                data={ageGroupsChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: false,
                    },
                    tooltip: {
                      callbacks: {
                        label: (context: any) => {
                          const value = context.parsed.y || 0;
                          return `Passengers: ${value}`;
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
                  <TrendingUp className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-500">No age data available</p>
                </div>
              </div>
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Top Nationalities — Premium Ranked List */}
      {stats && stats.topNationalities && stats.topNationalities.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-emerald-400 to-teal-500" />
          <div className="p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                  <span className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-emerald-50 border border-emerald-100"><Globe className="h-4 w-4 text-emerald-600" /></span>
                  Nationalities Breakdown
                </h3>
                <p className="text-xs text-gray-400 mt-1 ml-9">Ranked by passenger count &mdash; {stats.topNationalities.length} {stats.topNationalities.length === 1 ? "nationality" : "nationalities"} found</p>
              </div>
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full tabular-nums">
                {stats.totalPassengers.toLocaleString()} total
              </span>
            </div>

            {statsLoading ? (
              <div className="flex items-center justify-center py-10">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-200 border-t-emerald-500" />
              </div>
            ) : (
              <div className="overflow-y-auto" style={{ maxHeight: "420px" }}>
                <div className="space-y-1.5 pr-1">
                  {stats.topNationalities.map((item, idx) => {
                    const max = stats.topNationalities[0].count;
                    const pct = max > 0 ? Math.round((item.count / max) * 100) : 0;
                    const totalPct = stats.totalPassengers > 0 ? ((item.count / stats.totalPassengers) * 100).toFixed(1) : "0.0";
                    const gradients = [
                      "from-emerald-400 to-teal-500",
                      "from-blue-400 to-cyan-500",
                      "from-violet-400 to-purple-500",
                      "from-amber-400 to-orange-500",
                      "from-rose-400 to-pink-500",
                    ];
                    const grad = gradients[idx % gradients.length];
                    return (
                      <div key={item.nationality} className="group flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 transition-colors">
                        <span className="w-6 text-center text-xs font-bold text-gray-300 flex-shrink-0 tabular-nums">{idx + 1}</span>
                        <span className="w-28 min-w-[6.5rem] text-sm font-semibold text-gray-800 truncate flex-shrink-0">{item.nationality}</span>
                        <div className="flex-1 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${grad} transition-all duration-500`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-14 text-right text-sm font-bold text-gray-900 tabular-nums flex-shrink-0">{item.count.toLocaleString()}</span>
                        <span className="w-12 text-right text-xs text-gray-400 tabular-nums flex-shrink-0">{totalPct}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-emerald-400 to-blue-400" />
        <div className="p-4">
        <div className="flex flex-col gap-4 w-full max-w-full">
          {/* Search and Filters Grid - All fields in same grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3 w-full max-w-full">
            {/* Search Box */}
            <div className="relative w-full min-w-0 sm:col-span-2 lg:col-span-2 xl:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-sm max-w-full box-border"
                placeholder="Search passengers by name, phone, nationality..."
                value={q}
                onChange={(e) => {
                  qRef.current = e.target.value;
                  setQ(e.target.value);
                }}
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
                    qRef.current = "";
                    setQ("");
                    setPage(1);
                    load();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {/* Booking ID */}
            <div className="w-full min-w-0">
              <input
                type="number"
                placeholder="Booking ID"
                value={bookingId}
                onChange={(e) => {
                  setBookingId(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-sm max-w-full box-border"
              />
            </div>

            {/* Group Type */}
            <div className="w-full min-w-0">
              <select
                value={groupType}
                onChange={(e) => {
                  setGroupType(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-sm bg-white max-w-full box-border"
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

            {/* Gender */}
            <div className="w-full min-w-0">
              <select
                value={gender}
                onChange={(e) => {
                  setGender(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-sm bg-white max-w-full box-border"
              >
                <option value="">All Genders</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            {/* Nationality */}
            <div className="w-full min-w-0">
              <input
                type="text"
                placeholder="Nationality"
                value={nationality}
                onChange={(e) => {
                  setNationality(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-sm max-w-full box-border"
              />
            </div>

            {/* Age Range */}
            <div className="w-full min-w-0 sm:col-span-2 lg:col-span-2 xl:col-span-2 flex gap-2">
              <input
                type="number"
                placeholder="Min Age"
                value={ageMin}
                onChange={(e) => {
                  setAgeMin(e.target.value);
                  setPage(1);
                }}
                className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-sm box-border"
              />
              <input
                type="number"
                placeholder="Max Age"
                value={ageMax}
                onChange={(e) => {
                  setAgeMax(e.target.value);
                  setPage(1);
                }}
                className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none text-sm box-border"
              />
            </div>
          </div>
        </div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <>
            {/* Skeleton Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gender</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nationality</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booking</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {[...Array(5)].map((_, i) => (
                    <tr key={i} className="animate-pulse">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-32"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-24"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-12"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-16"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-16 mb-1"></div>
                        <div className="h-3 bg-gray-200 rounded w-20"></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="h-4 bg-gray-200 rounded w-28"></div>
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
            <UsersRound className="h-12 w-12 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No passengers found.</p>
            <p className="text-xs text-gray-400 mt-1">Try adjusting your filters or search query.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Age</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Gender</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nationality</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Booking</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Destination</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {list.map((passenger) => (
                    <tr key={passenger.id} className="hover:bg-gray-50 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          <span className="max-w-xs truncate">{passenger.firstName} {passenger.lastName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <span className="max-w-xs truncate block">{formatPhone(passenger.phone)}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{passenger.age || "N/A"}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{passenger.gender || "N/A"}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          <span className="max-w-xs truncate">{passenger.nationality || "N/A"}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {passenger.booking ? (
                          <div>
                            <div className="font-medium">#{passenger.booking.id}</div>
                            <div className="text-xs text-gray-400 capitalize">{passenger.booking.groupType}</div>
                          </div>
                        ) : (
                          "N/A"
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500">
                        {passenger.booking ? (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-gray-400 flex-shrink-0" />
                            <span className="max-w-xs truncate">{passenger.booking.destination}</span>
                          </div>
                        ) : (
                          "N/A"
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                <button
                                  type="button"
                                  onClick={() => openPassengerModal(passenger)}
                                  className="text-green-600 hover:text-green-900"
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
              {list.map((passenger) => (
                <div key={passenger.id} className="p-4 bg-white hover:bg-gray-50 transition-colors duration-150">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {passenger.firstName} {passenger.lastName}
                    </span>
                    {passenger.booking && (
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-700">
                        #{passenger.booking.id}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600 mb-1">
                    <span>Phone: {formatPhone(passenger.phone)}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1">
                    <span>Age: {passenger.age || "N/A"} • Gender: {passenger.gender || "N/A"}</span>
                  </div>
                  <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                    <Globe className="h-4 w-4 text-gray-400" />
                    <span>Nationality: {passenger.nationality || "N/A"}</span>
                  </div>
                  {passenger.booking && (
                    <>
                      <div className="text-sm text-gray-600 mb-1">
                        <span>Type: {passenger.booking.groupType} • Status: {passenger.booking.status}</span>
                      </div>
                      <div className="text-sm text-gray-600 mb-1 flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-gray-400" />
                        <span>Destination: {passenger.booking.destination}</span>
                      </div>
                    </>
                  )}
                  <div className="mt-3 text-right">
                    <button
                      type="button"
                      onClick={() => openPassengerModal(passenger)}
                      className="text-green-600 hover:text-green-900 text-sm"
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

      {/* Passenger Details Modal */}
      {passengerModalMounted && selectedPassenger && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${
            passengerModalVisible ? "opacity-100 bg-black/50" : "opacity-0 bg-black/0"
          }`}
          onClick={closePassengerModal}
          role="dialog"
          aria-modal="true"
          aria-label="Passenger details"
        >
          <div
            className={`w-full max-w-3xl rounded-2xl bg-white shadow-2xl border border-gray-200 overflow-hidden max-h-[90vh] flex flex-col transform transition-all duration-200 ease-out ${
              passengerModalVisible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 translate-y-2 scale-[0.98]"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 bg-gradient-to-br from-green-50 via-white to-emerald-50 border-b border-gray-200">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-white border border-gray-200 flex items-center justify-center shadow-sm">
                    <User className="h-6 w-6 text-green-700" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500">Passenger Details</div>
                    <h2 className="text-lg sm:text-xl font-semibold text-gray-900 leading-tight">
                      {selectedPassenger.firstName} {selectedPassenger.lastName}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {selectedPassenger.booking?.status && (
                        <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                          {selectedPassenger.booking.status}
                        </span>
                      )}
                      {selectedPassenger.booking?.groupType && (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700 capitalize">
                          {selectedPassenger.booking.groupType}
                        </span>
                      )}
                      {selectedPassenger.nationality && (
                        <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-semibold text-gray-700">
                          <Globe className="h-3.5 w-3.5 mr-1 text-gray-400" />
                          {selectedPassenger.nationality}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {selectedPassenger.booking?.id ? (
                    <Link
                      href={`/admin/group-stays/bookings?bookingId=${selectedPassenger.booking.id}`}
                      className="hidden sm:inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                    >
                      Go to booking
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    onClick={closePassengerModal}
                    className="inline-flex items-center justify-center h-9 w-9 rounded-lg border border-gray-200 bg-white text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                    aria-label="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              <p className="mt-3 text-xs text-gray-500">Tip: press ESC to close</p>
            </div>

            <div className="p-6 space-y-5 bg-white flex-1 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                    <Phone className="h-4 w-4" />
                    Phone
                  </div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{formatPhone(selectedPassenger.phone)}</div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                    <Hash className="h-4 w-4" />
                    Sequence
                  </div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{selectedPassenger.sequenceNumber}</div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                    <Users className="h-4 w-4" />
                    Age
                  </div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{selectedPassenger.age ?? "N/A"}</div>
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-gray-500">
                    <User className="h-4 w-4" />
                    Gender
                  </div>
                  <div className="mt-1 text-sm font-semibold text-gray-900">{selectedPassenger.gender || "N/A"}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-900">Booking</h3>
                  {selectedPassenger.booking?.id ? (
                    <Link
                      href={`/admin/group-stays/bookings?bookingId=${selectedPassenger.booking.id}`}
                      className="sm:hidden inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                    >
                      Go to booking
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  ) : null}
                </div>

                {selectedPassenger.booking ? (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs font-medium text-gray-500">Booking ID</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900">#{selectedPassenger.booking.id}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500">Status</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 capitalize">{selectedPassenger.booking.status}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500">Destination</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-gray-400" />
                        <span className="truncate">{selectedPassenger.booking.destination}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500">Group Type</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 capitalize">{selectedPassenger.booking.groupType}</div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500">Check-in</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span>{formatDateTime(selectedPassenger.booking.checkIn)}</span>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs font-medium text-gray-500">Check-out</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900 flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-gray-400" />
                        <span>{formatDateTime(selectedPassenger.booking.checkOut)}</span>
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <div className="text-xs font-medium text-gray-500">Customer</div>
                      <div className="mt-1 text-sm font-semibold text-gray-900">
                        {selectedPassenger.booking.customer
                          ? `${selectedPassenger.booking.customer.name} (${selectedPassenger.booking.customer.email})`
                          : "N/A"}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-gray-500">No booking linked.</div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closePassengerModal}
                className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
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


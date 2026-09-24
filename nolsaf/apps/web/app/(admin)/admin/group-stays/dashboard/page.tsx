"use client";

import { useEffect, useState, useMemo } from "react";
import { Users, Calendar, CheckCircle, Clock, TrendingUp, Utensils, Car, UserCheck, Wrench, ArrowRight, MapPin } from "lucide-react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import Chart from "@/components/Chart";
import type { ChartData } from "chart.js";

// Use same-origin for HTTP calls so Next.js rewrites proxy to the API
const api = apiClient;
function authify() {}

type SummaryData = {
  totalBookings?: number;
  pendingBookings?: number;
  confirmedBookings?: number;
  processingBookings?: number;
  completedBookings?: number;
  canceledBookings?: number;
  totalPassengers?: number;
  averageHeadcount?: number;
  groupTypeCounts?: Record<string, number>;
  accommodationTypeCounts?: Record<string, number>;
  arrangements?: {
    pickup: number;
    transport: number;
    meals: number;
    guide: number;
    equipment: number;
  };
  recentBookings?: Array<{
    id: number;
    groupType: string;
    headcount: number;
    toRegion: string;
    status: string;
    createdAt: string;
    user: { id: number; name: string; email: string };
  }>;
};

function humanizeLabel(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

// Region slugs arrive as "dar-es-salaam"; keep connective words lowercase.
function formatRegion(slug: string) {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word, i) => (i > 0 && ["es", "la", "wa", "na", "ya"].includes(word.toLowerCase()) ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

function customerInitials(name: string) {
  const parts = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

function relativeDays(date: Date) {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function groupStayStatusTone(status: string) {
  switch (String(status || "").toUpperCase()) {
    case "AWAITING_DEPOSIT":
      return { pill: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" };
    case "CONFIRMED":
      return { pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" };
    case "PROCESSING":
      return { pill: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500" };
    case "COMPLETED":
      return { pill: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-500" };
    case "CANCELED":
    case "CANCELLED":
      return { pill: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" };
    default:
      return { pill: "bg-gray-50 text-gray-600 ring-gray-200", dot: "bg-gray-400" };
  }
}

export default function GroupStaysDashboardPage() {
  const [summary, setSummary] = useState<SummaryData>({});
  const [loading, setLoading] = useState(true);
  const awaitingDepositCount = (summary.recentBookings || []).filter((b) => String(b.status).toUpperCase() === "AWAITING_DEPOSIT").length;

  useEffect(() => {
    authify();
    (async () => {
      try {
        const r = await api.get<SummaryData>("/admin/group-stays/summary");
        if (r?.data) setSummary(r.data);
      } catch (e) {
        console.error("Failed to load group stays summary:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Prepare chart data for Group Types
  const groupTypeChartData = useMemo<ChartData<"bar">>(() => {
    const counts = summary.groupTypeCounts || {};
    const labels = Object.keys(counts).map(key => key.charAt(0).toUpperCase() + key.slice(1));
    const data = Object.values(counts);

    return {
      labels,
      datasets: [
        {
          label: "Bookings by Group Type",
          data,
          backgroundColor: [
            "rgba(139, 92, 246, 0.8)", // Purple
            "rgba(59, 130, 246, 0.8)", // Blue
            "rgba(16, 185, 129, 0.8)", // Green
            "rgba(245, 158, 11, 0.8)", // Amber
            "rgba(239, 68, 68, 0.8)", // Red
            "rgba(107, 114, 128, 0.8)", // Gray
          ],
          borderColor: [
            "rgba(139, 92, 246, 1)",
            "rgba(59, 130, 246, 1)",
            "rgba(16, 185, 129, 1)",
            "rgba(245, 158, 11, 1)",
            "rgba(239, 68, 68, 1)",
            "rgba(107, 114, 128, 1)",
          ],
          borderWidth: 1,
        },
      ],
    };
  }, [summary.groupTypeCounts]);

  // Prepare chart data for Status Distribution
  const statusChartData = useMemo<ChartData<"doughnut">>(() => {
    return {
      labels: ["Pending", "Confirmed", "Processing", "Completed", "Canceled"],
      datasets: [
        {
          label: "Bookings by Status",
          data: [
            summary.pendingBookings || 0,
            summary.confirmedBookings || 0,
            summary.processingBookings || 0,
            summary.completedBookings || 0,
            summary.canceledBookings || 0,
          ],
          backgroundColor: [
            "rgba(156, 163, 175, 0.8)", // Gray - Pending
            "rgba(59, 130, 246, 0.8)", // Blue - Confirmed
            "rgba(245, 158, 11, 0.8)", // Amber - Processing
            "rgba(16, 185, 129, 0.8)", // Green - Completed
            "rgba(239, 68, 68, 0.8)", // Red - Canceled
          ],
          borderColor: "#fff",
          borderWidth: 2,
          hoverOffset: 4,
        },
      ],
    };
  }, [summary]);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center flex-shrink-0">
                <Users className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Total Bookings</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">
                  {loading ? <span className="inline-block h-7 w-12 bg-gray-200 rounded animate-pulse" /> : (summary.totalBookings || 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Pending</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">
                  {loading ? <span className="inline-block h-7 w-8 bg-gray-200 rounded animate-pulse" /> : (summary.pendingBookings || 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Confirmed</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">
                  {loading ? <span className="inline-block h-7 w-8 bg-gray-200 rounded animate-pulse" /> : (summary.confirmedBookings || 0).toLocaleString()}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
          <div className="p-5">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Total Guests</div>
                <div className="text-2xl font-bold text-gray-900 tabular-nums">
                  {loading ? <span className="inline-block h-7 w-16 bg-gray-200 rounded animate-pulse" /> : (summary.totalPassengers || 0).toLocaleString()}
                </div>
                <div className="text-xs text-gray-400 mt-1 font-medium">
                  Avg: {summary.averageHeadcount || 0} per booking
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Links */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          href="/admin/group-stays/bookings"
          className="group bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 no-underline overflow-hidden"
        >
          <div className="p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-purple-50 border border-purple-100 flex items-center justify-center flex-shrink-0 group-hover:bg-purple-100 transition-colors">
              <Calendar className="h-5 w-5 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">All Bookings</div>
              <div className="text-base font-bold text-gray-900 group-hover:text-purple-700 transition-colors">View All</div>
            </div>
            <svg className="h-4 w-4 text-gray-300 group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </div>
        </Link>

        <Link
          href="/admin/group-stays/requests"
          className="group bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 no-underline overflow-hidden"
        >
          <div className="p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Pending Requests</div>
              <div className="text-base font-bold text-gray-900 group-hover:text-blue-700 transition-colors tabular-nums">
                {loading ? <span className="inline-block h-5 w-6 bg-gray-200 rounded animate-pulse" /> : (summary.pendingBookings || 0)}
              </div>
            </div>
            <svg className="h-4 w-4 text-gray-300 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </div>
        </Link>

        <Link
          href="/admin/group-stays/passengers"
          className="group bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 no-underline overflow-hidden"
        >
          <div className="p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-100 transition-colors">
              <Users className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Guests</div>
              <div className="text-base font-bold text-gray-900 group-hover:text-emerald-700 transition-colors">Manage Roster</div>
            </div>
            <svg className="h-4 w-4 text-gray-300 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </div>
        </Link>

        <Link
          href="/admin/group-stays/arrangements"
          className="group bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 no-underline overflow-hidden"
        >
          <div className="p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0 group-hover:bg-amber-100 transition-colors">
              <Wrench className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Extra services</div>
              <div className="text-base font-bold text-gray-900 group-hover:text-amber-700 transition-colors">Services</div>
            </div>
            <svg className="h-4 w-4 text-gray-300 group-hover:text-amber-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </div>
        </Link>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Group Types Chart */}
        <div className="bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
          <div className="p-6">
            <div className="mb-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-purple-50 border border-purple-100"><Users className="h-4 w-4 text-purple-600" /></span>
                Bookings by Group Type
              </h3>
              <p className="text-xs text-gray-400 mt-1 ml-9">Distribution of bookings across different group types</p>
            </div>
          <div className="h-64 w-full max-h-64 min-h-[300px] overflow-hidden relative">
            {loading ? (
              <div className="h-full w-full flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-purple-600"></div>
              </div>
            ) : (
              <Chart
                type="bar"
                data={groupTypeChartData}
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
                          const label = context.label || "";
                          const value = context.parsed.y || 0;
                          return `${label}: ${value} bookings`;
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
                      title: {
                        display: true,
                        text: "Number of Bookings",
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
                      },
                    },
                  },
                }}
              />
            )}
          </div>
          </div>
        </div>

        {/* Status Distribution Chart */}
        <div className="bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 overflow-hidden">
          <div className="p-6">
            <div className="mb-4">
              <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-blue-50 border border-blue-100"><CheckCircle className="h-4 w-4 text-blue-600" /></span>
                Status Distribution
              </h3>
              <p className="text-xs text-gray-400 mt-1 ml-9">Current status breakdown of all bookings</p>
            </div>
          <div className="h-64 w-full max-h-64 min-h-[300px] overflow-hidden relative">
            {loading ? (
              <div className="h-full w-full flex items-center justify-center">
                <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-gray-300 border-t-blue-600"></div>
              </div>
            ) : (
              <Chart
                type="doughnut"
                data={statusChartData}
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
            )}
          </div>
          </div>
        </div>
      </div>

      {/* Arrangements Summary */}
      {summary.arrangements && (
        <div className="bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
          <div className="p-6">
            <h3 className="text-base font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span className="inline-flex items-center justify-center h-7 w-7 rounded-md bg-amber-50 border border-amber-100"><Wrench className="h-4 w-4 text-amber-600" /></span>
              Arrangements Summary
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="text-center p-4 bg-blue-50 rounded-xl border border-blue-100">
                <Car className="h-6 w-6 text-blue-600 mx-auto mb-2" />
                <div className="text-2xl font-bold text-gray-900">{summary.arrangements.pickup}</div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-1">Pickup</div>
              </div>
              <div className="text-center p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                <Car className="h-6 w-6 text-emerald-600 mx-auto mb-2" />
                <div className="text-2xl font-bold text-gray-900">{summary.arrangements.transport}</div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-1">Transport</div>
              </div>
              <div className="text-center p-4 bg-purple-50 rounded-xl border border-purple-100">
                <Utensils className="h-6 w-6 text-purple-600 mx-auto mb-2" />
                <div className="text-2xl font-bold text-gray-900">{summary.arrangements.meals}</div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-1">Meals</div>
              </div>
              <div className="text-center p-4 bg-amber-50 rounded-xl border border-amber-100">
                <UserCheck className="h-6 w-6 text-amber-600 mx-auto mb-2" />
                <div className="text-2xl font-bold text-gray-900">{summary.arrangements.guide}</div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-1">Guide</div>
              </div>
              <div className="text-center p-4 bg-red-50 rounded-xl border border-red-100">
                <Wrench className="h-6 w-6 text-red-600 mx-auto mb-2" />
                <div className="text-2xl font-bold text-gray-900">{summary.arrangements.equipment}</div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mt-1">Equipment</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Bookings */}
      {summary.recentBookings && summary.recentBookings.length > 0 && (
        <div className="bg-white rounded-xl border border-solid border-gray-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6 border-0 border-b border-solid border-gray-100">
            <div className="flex items-center gap-3 min-w-0">
              <span className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-purple-50 text-purple-600 flex-shrink-0">
                <Calendar className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h3 className="m-0 text-sm font-bold text-gray-900">Recent bookings</h3>
                <p className="m-0 mt-0.5 text-xs text-gray-400">
                  Latest {summary.recentBookings.length} group {summary.recentBookings.length === 1 ? "request" : "requests"}
                  {awaitingDepositCount > 0 ? ` · ${awaitingDepositCount} awaiting deposit` : ""}
                </p>
              </div>
            </div>
            <Link
              href="/admin/group-stays/bookings"
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-purple-700 no-underline transition-colors hover:bg-purple-50 hover:no-underline"
            >
              View all
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr className="bg-gray-50/70">
                  {["Booking", "Group", "Destination", "Status", "Customer", "Created"].map((label, i) => (
                    <th
                      key={label}
                      className={`px-5 sm:px-6 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 ${i === 5 ? "text-right" : "text-left"}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.recentBookings.map((booking) => {
                  const tone = groupStayStatusTone(booking.status);
                  const customer = booking.user?.name || booking.user?.email || "Unknown customer";
                  const created = new Date(booking.createdAt);
                  return (
                    <tr key={booking.id} className="group transition-colors hover:bg-purple-50/40">
                      <td className="px-5 sm:px-6 py-2.5 whitespace-nowrap border-0 border-t border-solid border-gray-100">
                        <span className="inline-flex items-center rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-semibold text-gray-700 tabular-nums">
                          GS-{String(booking.id).padStart(4, "0")}
                        </span>
                      </td>
                      <td className="px-5 sm:px-6 py-2.5 whitespace-nowrap border-0 border-t border-solid border-gray-100">
                        <div className="text-sm font-semibold text-gray-900">{humanizeLabel(booking.groupType)}</div>
                        <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-gray-400">
                          <Users className="h-3 w-3" />
                          {booking.headcount} {booking.headcount === 1 ? "guest" : "guests"}
                        </div>
                      </td>
                      <td className="px-5 sm:px-6 py-2.5 whitespace-nowrap border-0 border-t border-solid border-gray-100">
                        <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
                          <MapPin className="h-3.5 w-3.5 text-gray-300" />
                          {booking.toRegion ? formatRegion(booking.toRegion) : <span className="text-gray-400">Not set</span>}
                        </span>
                      </td>
                      <td className="px-5 sm:px-6 py-2.5 whitespace-nowrap border-0 border-t border-solid border-gray-100">
                        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tone.pill}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                          {humanizeLabel(booking.status)}
                        </span>
                      </td>
                      <td className="px-5 sm:px-6 py-2.5 whitespace-nowrap border-0 border-t border-solid border-gray-100">
                        <div className="flex items-center gap-2.5">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 text-[11px] font-bold text-purple-700 flex-shrink-0">
                            {customerInitials(customer)}
                          </span>
                          <span className="text-sm text-gray-700 truncate max-w-[12rem]" title={booking.user?.email || customer}>{customer}</span>
                        </div>
                      </td>
                      <td className="px-5 sm:px-6 py-2.5 whitespace-nowrap text-right border-0 border-t border-solid border-gray-100">
                        <div className="text-sm text-gray-700 tabular-nums">
                          {created.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-400">{relativeDays(created)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}


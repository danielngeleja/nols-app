"use client";

// Management home: the tools an admin jumps to, plus a live read on who is on
// the platform right now. Data comes from /api/admin/summary, /bookings and
// /properties, refreshed every 30 seconds.

import Link from "next/link";
import {
  Activity, ArrowRight, Building2, Calendar, ChevronRight, LayoutDashboard, MapPin, MessageCircle,
  RefreshCw, Settings, Shield, TrendingUp, Truck, Users,
} from "lucide-react";
import Chart from "@/components/Chart";
import { useCallback, useEffect, useState, type ReactNode } from "react";

const REFRESH_SECONDS = 30;
const MAX_TREND_POINTS = 20;

type RoleKey = "users" | "drivers" | "owners" | "admins";

const ROLES: Array<{ key: RoleKey; label: string; icon: typeof Users; color: string; fill: string; tone: string }> = [
  { key: "users", label: "Customers", icon: Users, color: "#2563eb", fill: "rgba(37, 99, 235, 0.14)", tone: "text-blue-600" },
  { key: "drivers", label: "Drivers", icon: Truck, color: "#ea580c", fill: "rgba(234, 88, 12, 0.14)", tone: "text-orange-600" },
  { key: "owners", label: "Owners", icon: Building2, color: "#059669", fill: "rgba(5, 150, 105, 0.14)", tone: "text-emerald-600" },
  { key: "admins", label: "Admins", icon: Shield, color: "#7c3aed", fill: "rgba(124, 58, 237, 0.14)", tone: "text-violet-600" },
];

const TOOLS: Array<{ title: string; subtitle: string; href: string; icon: ReactNode; tone: string }> = [
  { title: "System settings", subtitle: "Settings and feature flags", href: "/admin/management/settings", icon: <Settings className="h-4 w-4" />, tone: "bg-[#02665e]/10 text-[#02665e]" },
  { title: "Audit log", subtitle: "Who changed what, and when", href: "/admin/management/audit-log", icon: <Shield className="h-4 w-4" />, tone: "bg-sky-50 text-sky-600" },
  { title: "Users", subtitle: "Accounts and roles", href: "/admin/management/users", icon: <Users className="h-4 w-4" />, tone: "bg-emerald-50 text-emerald-600" },
  { title: "Updates", subtitle: "News and media", href: "/admin/management/updates", icon: <Calendar className="h-4 w-4" />, tone: "bg-violet-50 text-violet-600" },
  { title: "Pickup points", subtitle: "Transport coordinates", href: "/admin/management/pickup-points", icon: <MapPin className="h-4 w-4" />, tone: "bg-rose-50 text-rose-600" },
  { title: "Meta messaging", subtitle: "WhatsApp and Instagram operations", href: "/admin/nrms/messaging", icon: <MessageCircle className="h-4 w-4" />, tone: "bg-green-50 text-green-600" },
];

export default function AdminManagementPageClient() {
  const [bookingsCount, setBookingsCount] = useState(0);
  const [propertiesCount, setPropertiesCount] = useState(0);
  const [online, setOnline] = useState<Record<RoleKey, number>>({ users: 0, drivers: 0, owners: 0, admins: 0 });
  const [trends, setTrends] = useState<Record<RoleKey, number[]>>({ users: [], drivers: [], owners: [], admins: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState(REFRESH_SECONDS);

  const fetchData = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    const readJson = async (url: string) => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) return null;
      const contentType = response.headers.get("content-type");
      return contentType && contentType.includes("application/json") ? response.json() : null;
    };

    try {
      const [bookings, properties, summary] = await Promise.all([
        readJson("/api/admin/bookings?page=1&pageSize=1").catch(() => null),
        readJson("/api/admin/properties?page=1&pageSize=1").catch(() => null),
        readJson("/api/admin/summary").catch(() => null),
      ]);

      if (bookings) setBookingsCount(Number(bookings.total || 0));
      if (properties) setPropertiesCount(Number(properties.total || 0));

      const roleCounts = summary?.activeSessionsByRole;
      const sessions = Number(summary?.activeSessions || 0) || 0;
      const hasRoleCounts = roleCounts && ROLES.some((role) => typeof roleCounts[role.key] === "number");
      // Legacy fallback kept: older API builds only return a session total.
      const legacyShare: Record<RoleKey, number> = { users: 0.4, drivers: 0.3, owners: 0.2, admins: 0.1 };
      const next = ROLES.reduce((acc, role) => {
        acc[role.key] = hasRoleCounts ? Number(roleCounts?.[role.key] || 0) : Math.floor(sessions * legacyShare[role.key]);
        return acc;
      }, {} as Record<RoleKey, number>);

      setOnline(next);
      setTrends((prev) => {
        const updated = { ...prev };
        for (const role of ROLES) {
          const series = [...(prev[role.key] || []), next[role.key]];
          updated[role.key] = series.length > MAX_TREND_POINTS ? series.slice(series.length - MAX_TREND_POINTS) : series;
        }
        return updated;
      });
      setUpdatedAt(new Date());
    } catch (error) {
      console.error("Failed to load management summary", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setCountdown((seconds) => {
        if (seconds <= 1) {
          void fetchData(true);
          return REFRESH_SECONDS;
        }
        return seconds - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [fetchData]);

  const totalOnline = ROLES.reduce((sum, role) => sum + online[role.key], 0);
  const perProperty = propertiesCount > 0 ? bookingsCount / propertiesCount : null;
  const bookingsShare = bookingsCount + propertiesCount > 0 ? (bookingsCount / (bookingsCount + propertiesCount)) * 100 : 0;

  const sparkData = (values: number[], color: string, fill: string) => {
    const series = values.length >= 2 ? values : values.length === 1 ? [values[0], values[0]] : [0, 0];
    return {
      labels: series.map((_, index) => String(index + 1)),
      datasets: [{ data: series, borderColor: color, backgroundColor: fill, borderWidth: 2, pointRadius: 0, tension: 0.35, fill: true }],
    };
  };
  const sparkOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: { x: { display: false }, y: { display: false } },
    elements: { line: { capBezierPoints: true } },
  };
  const delta = (values: number[]) => {
    if (values.length < 2) return 0;
    return values[values.length - 1] - values[values.length - 2];
  };

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Header */}
      <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
          <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-[#02665e] text-white"><LayoutDashboard className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 flex flex-wrap items-center gap-2">
              <span className="text-base font-bold text-slate-900">Management</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                {loading ? "Loading" : `${totalOnline} online now`}
              </span>
            </p>
            <p className="m-0 mt-0.5 text-xs text-slate-500">
              Administrative tools and controls{updatedAt ? ` · updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
            </p>
          </div>
          <button type="button" onClick={() => void fetchData(true)} disabled={refreshing} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span className="tabular-nums">{refreshing ? "Refreshing" : `Refresh ${countdown}s`}</span>
          </button>
        </div>
      </div>

      {/* Live presence: one strip, a tile per role */}
      <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 sm:px-5">
          <h2 className="m-0 flex items-center gap-1.5 text-sm font-bold text-slate-900"><Activity className="h-4 w-4 text-[#02665e]" /> Who is online</h2>
          <span className="text-[11px] text-slate-400">Active sessions, sampled every {REFRESH_SECONDS} seconds</span>
        </div>
        <div className="grid grid-cols-2 gap-px border-0 border-t border-solid border-slate-100 bg-slate-200 xl:grid-cols-4">
          {ROLES.map((role) => {
            const Icon = role.icon;
            const value = online[role.key];
            const change = delta(trends[role.key] || []);
            const share = totalOnline > 0 ? (value / totalOnline) * 100 : 0;
            return (
              <div key={role.key} className="min-w-0 bg-white px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <Icon className={`h-3.5 w-3.5 ${role.tone}`} /> {role.label}
                  </span>
                  {change !== 0 && (
                    <span className={`text-[11px] font-semibold tabular-nums ${change > 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {change > 0 ? `+${change}` : change}
                    </span>
                  )}
                </div>
                <div className="mt-1.5 flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 text-2xl font-bold tabular-nums leading-none text-slate-900">{loading ? "…" : value}</p>
                    <p className="m-0 mt-1 text-[11px] text-slate-400">{totalOnline > 0 ? `${share.toFixed(0)}% of sessions` : "No sessions"}</p>
                  </div>
                  <div className="h-10 w-24 flex-shrink-0">
                    <Chart type="line" data={sparkData(trends[role.key] || [], role.color, role.fill) as any} options={sparkOptions as any} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Tools */}
        <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 sm:px-5">
            <h2 className="m-0 text-sm font-bold text-slate-900">Tools</h2>
            <span className="text-[11px] text-slate-400">{TOOLS.length} areas</span>
          </div>
          <div className="grid grid-cols-1 gap-px border-0 border-t border-solid border-slate-100 bg-slate-200 sm:grid-cols-2">
            {TOOLS.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                className="group flex min-w-0 items-center gap-3 bg-white px-4 py-3.5 no-underline transition hover:bg-slate-50 hover:no-underline"
              >
                <span className={`grid h-9 w-9 flex-shrink-0 place-items-center rounded-lg ${tool.tone}`}>{tool.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{tool.title}</span>
                  <span className="block truncate text-xs text-slate-500">{tool.subtitle}</span>
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
              </Link>
            ))}
          </div>
        </section>

        {/* Platform totals */}
        <section className="min-w-0 rounded-2xl border border-solid border-slate-200 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 sm:px-5">
            <h2 className="m-0 flex items-center gap-1.5 text-sm font-bold text-slate-900"><TrendingUp className="h-4 w-4 text-[#02665e]" /> Platform totals</h2>
            <span className="text-[11px] text-slate-400">All time</span>
          </div>
          <div className="border-0 border-t border-solid border-slate-100 px-4 py-4 sm:px-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-1.5 text-[11px] text-slate-500"><span className="h-2 w-2 rounded-sm bg-[#02665e]" /> Bookings</p>
                <p className="m-0 mt-1 text-2xl font-bold tabular-nums leading-none text-slate-900">{loading ? "…" : bookingsCount.toLocaleString()}</p>
              </div>
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-1.5 text-[11px] text-slate-500"><span className="h-2 w-2 rounded-sm bg-[#0ea5a0]" /> Properties</p>
                <p className="m-0 mt-1 text-2xl font-bold tabular-nums leading-none text-slate-900">{loading ? "…" : propertiesCount.toLocaleString()}</p>
              </div>
            </div>
            {/* One bar reads the ratio faster than a doughnut of two slices. */}
            <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <span className="h-full bg-[#02665e]" style={{ width: `${bookingsShare}%` }} title={`Bookings ${bookingsCount}`} />
              <span className="h-full bg-[#0ea5a0]" style={{ width: `${100 - bookingsShare}%` }} title={`Properties ${propertiesCount}`} />
            </div>
            <p className="m-0 mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">
              {loading
                ? "Loading platform totals…"
                : perProperty == null
                  ? "No properties listed yet, so there is nothing to compare."
                  : <>On average <span className="font-semibold text-slate-900">{perProperty.toFixed(1)} bookings</span> per listed property.</>}
            </p>
            <Link href="/admin/finance" className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border-0 bg-slate-900 px-3.5 text-xs font-semibold text-white no-underline transition hover:bg-slate-800 hover:no-underline">
              Revenue across all streams <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}

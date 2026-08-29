"use client";

import Link from "next/link";
import { LayoutDashboard, Calendar, Users, Truck, Building2, Shield, TrendingUp, Settings, MapPin, MessageCircle } from "lucide-react";
import Chart from "@/components/Chart";
import { useEffect, useState, type ReactNode } from "react";

export default function AdminManagementPageClient() {
  const [bookingsCount, setBookingsCount] = useState<number>(0);
  const [propertiesCount, setPropertiesCount] = useState<number>(0);
  const [onlineUsers, setOnlineUsers] = useState<number>(0);
  const [onlineDrivers, setOnlineDrivers] = useState<number>(0);
  const [onlineOwners, setOnlineOwners] = useState<number>(0);
  const [onlineAdmins, setOnlineAdmins] = useState<number>(0);

  const [trendOnlineUsers, setTrendOnlineUsers] = useState<number[]>([]);
  const [trendOnlineDrivers, setTrendOnlineDrivers] = useState<number[]>([]);
  const [trendOnlineOwners, setTrendOnlineOwners] = useState<number[]>([]);
  const [trendOnlineAdmins, setTrendOnlineAdmins] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  function pushTrend(setter: React.Dispatch<React.SetStateAction<number[]>>, value: number) {
    setter((prev) => {
      const next = [...prev, value];
      const maxPoints = 20;
      return next.length > maxPoints ? next.slice(next.length - maxPoints) : next;
    });
  }

  useEffect(() => {
    const API = "";

    async function fetchData() {
      try {
        try {
          const bookingsRes = await fetch(`${API}/api/admin/bookings?page=1&pageSize=1`, {
            credentials: "include",
          });
          if (bookingsRes.ok) {
            const contentType = bookingsRes.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              const bookingsData = await bookingsRes.json();
              setBookingsCount(bookingsData?.total || 0);
            }
          }
        } catch (e) {
          console.warn("Failed to fetch bookings:", e);
        }

        try {
          const propsRes = await fetch(`${API}/api/admin/properties?page=1&pageSize=1`, {
            credentials: "include",
          });
          if (propsRes.ok) {
            const contentType = propsRes.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              const propsData = await propsRes.json();
              setPropertiesCount(propsData?.total || 0);
            }
          }
        } catch (e) {
          console.warn("Failed to fetch properties:", e);
        }

        try {
          const summaryRes = await fetch(`${API}/api/admin/summary`, {
            credentials: "include",
          });
          if (summaryRes.ok) {
            const contentType = summaryRes.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              const summaryData = await summaryRes.json();
              const roleCounts = summaryData?.activeSessionsByRole;

              // Prefer real role counts when available.
              const usersRaw = roleCounts?.users;
              const driversRaw = roleCounts?.drivers;
              const ownersRaw = roleCounts?.owners;
              const adminsRaw = roleCounts?.admins;

              const hasRoleCounts =
                typeof usersRaw === "number" ||
                typeof driversRaw === "number" ||
                typeof ownersRaw === "number" ||
                typeof adminsRaw === "number";

              const sessionsRaw = Number(summaryData?.activeSessions || 0);
              const sessions = Number.isFinite(sessionsRaw) ? sessionsRaw : 0;

              // Legacy fallback: derived from sessions (kept for backwards compatibility).
              const legacyUsers = Math.floor(sessions * 0.4);
              const legacyDrivers = Math.floor(sessions * 0.3);
              const legacyOwners = Math.floor(sessions * 0.2);
              const legacyAdmins = Math.floor(sessions * 0.1);

              const users = hasRoleCounts ? Number(usersRaw || 0) : legacyUsers;
              const drivers = hasRoleCounts ? Number(driversRaw || 0) : legacyDrivers;
              const owners = hasRoleCounts ? Number(ownersRaw || 0) : legacyOwners;
              const admins = hasRoleCounts ? Number(adminsRaw || 0) : legacyAdmins;

              setOnlineUsers(users);
              setOnlineDrivers(drivers);
              setOnlineOwners(owners);
              setOnlineAdmins(admins);

              pushTrend(setTrendOnlineUsers, users);
              pushTrend(setTrendOnlineDrivers, drivers);
              pushTrend(setTrendOnlineOwners, owners);
              pushTrend(setTrendOnlineAdmins, admins);
            }
          }
        } catch (e) {
          console.warn("Failed to fetch summary:", e);
          setOnlineUsers(0);
          setOnlineDrivers(0);
          setOnlineOwners(0);
          setOnlineAdmins(0);
        }
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  const bookingsVsPropertiesData = {
    labels: ["Total Bookings", "Total Properties"],
    datasets: [
      {
        label: "Count",
        data: [bookingsCount, propertiesCount],
        backgroundColor: ["#02665e", "#0ea5a0"],
        borderColor: ["rgba(255,255,255,0.85)", "rgba(255,255,255,0.85)"],
        borderWidth: 2,
        offset: (ctx: any) => {
          if (bookingsCount === propertiesCount) return 0;
          const isBookings = Number(ctx?.dataIndex) === 0;
          if (bookingsCount > propertiesCount) return isBookings ? 10 : 0;
          return isBookings ? 0 : 10;
        },
        hoverOffset: 2,
      },
    ],
  };

  const bookingsChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            return `${context.label}: ${context.parsed}`;
          },
        },
      },
    },
    cutout: "72%",
  };

  const totalCount = bookingsCount + propertiesCount;
  const topKey =
    bookingsCount === propertiesCount ? "tie" : bookingsCount > propertiesCount ? "bookings" : "properties";

  function normalizeSpark(values: number[]) {
    if (values.length >= 2) return values;
    if (values.length === 1) return [values[0], values[0]];
    return [0, 0];
  }

  function sparkDelta(values: number[]) {
    const v = normalizeSpark(values);
    const last = v[v.length - 1] ?? 0;
    const prev = v[v.length - 2] ?? last;
    const delta = last - prev;
    return { delta, last, prev };
  }

  function sparkData(values: number[], color: string, fillColor: string) {
    return {
      labels: normalizeSpark(values).map((_, i) => String(i + 1)),
      datasets: [
        {
          data: normalizeSpark(values),
          borderColor: color,
          backgroundColor: fillColor,
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.35,
          fill: true,
        },
      ],
    };
  }

  const sparkOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
    scales: {
      x: { display: false },
      y: { display: false },
    },
    elements: {
      line: { capBezierPoints: true },
    },
  };
  const navCards: Array<{
    title: string;
    subtitle: string;
    href: string;
    icon: ReactNode;
    accentClass: string;
  }> = [
    {
      title: "System Settings",
      subtitle: "Settings & feature flags",
      href: "/admin/management/settings",
      icon: <Settings className="h-4 w-4 text-[#02665e]" />,
      accentClass: "bg-[#02665e]",
    },
    {
      title: "Audit Log",
      subtitle: "Security trail",
      href: "/admin/management/audit-log",
      icon: <Shield className="h-4 w-4 text-sky-600" />,
      accentClass: "bg-sky-500",
    },
    {
      title: "Users",
      subtitle: "Accounts & roles",
      href: "/admin/management/users",
      icon: <Users className="h-4 w-4 text-emerald-600" />,
      accentClass: "bg-emerald-500",
    },
    {
      title: "Updates",
      subtitle: "News & media",
      href: "/admin/management/updates",
      icon: <Calendar className="h-4 w-4 text-purple-600" />,
      accentClass: "bg-purple-500",
    },
    {
      title: "Pickup Points",
      subtitle: "Transport coordinates",
      href: "/admin/management/pickup-points",
      icon: <MapPin className="h-4 w-4 text-rose-600" />,
      accentClass: "bg-rose-500",
    },
    {
      title: "Meta Messaging",
      subtitle: "WhatsApp & Instagram operations",
      href: "/admin/nrms/messaging",
      icon: <MessageCircle className="h-4 w-4 text-green-600" />,
      accentClass: "bg-green-500",
    },
  ];

  return (
    <div className="min-h-full w-full bg-slate-50">
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white/70 shadow-sm backdrop-blur">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50" />
        <div className="relative p-6 sm:p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="rounded-2xl border border-slate-200/60 bg-gradient-to-br from-emerald-50 to-slate-50 p-3 shadow-sm">
            <LayoutDashboard className="h-7 w-7 text-[#02665e]" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">Management</h1>
            <p className="mt-1 text-sm text-slate-600">Administrative tools and controls</p>
          </div>
        </div>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200/60 bg-white/70 p-4 shadow-sm backdrop-blur">
        <div className="mx-auto grid max-w-6xl min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {navCards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group relative block min-w-0 overflow-hidden rounded-2xl border border-slate-200/70 bg-white/70 p-4 shadow-sm ring-1 ring-black/[0.03] backdrop-blur-xl transition-all duration-200 no-underline hover:no-underline focus:no-underline hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-[#02665e]/10"
            aria-label={c.title}
          >
            <div className={`absolute left-0 top-0 h-0.5 w-full ${c.accentClass}`} />
            <div className="flex items-start gap-3">
              <div className="rounded-xl border border-slate-200/70 bg-white/60 p-2 shadow-sm">
                {c.icon}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-snug text-slate-900">{c.title}</div>
                <div className="mt-1 truncate text-xs text-slate-600">{c.subtitle}</div>
              </div>
            </div>
          </Link>
        ))}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
        <div className="group min-w-0 rounded-2xl border border-slate-200/70 bg-white/70 p-6 shadow-sm ring-1 ring-black/[0.03] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Calendar className="h-5 w-5 text-[#02665e] transition-all duration-200 motion-safe:group-hover:rotate-6" />
                <h3 className="text-lg font-semibold text-slate-900">
                  Bookings vs Properties
                </h3>
              </div>
              <p className="text-sm text-slate-600">Totals overview</p>
            </div>
            {loading ? (
              <div className="h-48 flex items-center justify-center text-slate-500">Loading…</div>
            ) : (
              <div className="relative h-56">
                <Chart type="doughnut" data={bookingsVsPropertiesData as any} options={bookingsChartOptions as any} />
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <div className="text-lg font-semibold text-slate-900">{totalCount}</div>
                    <div className="text-[11px] font-medium text-slate-500">Total</div>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-4 flex min-w-0 flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-[#02665e]"></div>
                <span className="text-slate-600">
                  Bookings: <span className="font-semibold text-slate-900">{bookingsCount.toLocaleString()}</span>
                </span>
                {topKey === "bookings" ? (
                  <span className="rounded-full border border-slate-200/70 bg-white/60 px-2 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-black/[0.03]">
                    Top
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-[#0ea5a0]"></div>
                <span className="text-slate-600">
                  Properties: <span className="font-semibold text-slate-900">{propertiesCount.toLocaleString()}</span>
                </span>
                {topKey === "properties" ? (
                  <span className="rounded-full border border-slate-200/70 bg-white/60 px-2 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-black/[0.03]">
                    Top
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="group min-w-0 rounded-2xl border border-slate-200/70 bg-white/70 p-6 shadow-sm ring-1 ring-black/[0.03] backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-5 w-5 text-sky-600 transition-all duration-200 motion-safe:group-hover:rotate-6" />
                <h3 className="text-lg font-semibold text-slate-900">
                  Platform Analytics
                </h3>
              </div>
              <p className="text-sm text-slate-600">Active sessions breakdown</p>
            </div>
            {loading ? (
              <div className="h-48 flex items-center justify-center text-slate-500">Loading…</div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-slate-200/70 bg-white/60 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Users className="h-4 w-4 text-blue-600" />
                          <span className="text-xs text-slate-600">Online Users</span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <div className="text-2xl font-bold text-slate-900">{onlineUsers}</div>
                          {(() => {
                            const { delta } = sparkDelta(trendOnlineUsers);
                            if (!delta) return <span className="text-xs text-slate-500">0</span>;
                            return (
                              <span
                                className={
                                  delta > 0 ? "text-xs font-semibold text-emerald-600" : "text-xs font-semibold text-rose-600"
                                }
                              >
                                {delta > 0 ? `+${delta}` : String(delta)}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="h-10 w-20">
                        <Chart
                          type="line"
                          data={sparkData(trendOnlineUsers, "#2563eb", "rgba(37, 99, 235, 0.14)") as any}
                          options={sparkOptions as any}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/70 bg-white/60 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Truck className="h-4 w-4 text-orange-600" />
                          <span className="text-xs text-slate-600">Online Drivers</span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <div className="text-2xl font-bold text-slate-900">{onlineDrivers}</div>
                          {(() => {
                            const { delta } = sparkDelta(trendOnlineDrivers);
                            if (!delta) return <span className="text-xs text-slate-500">0</span>;
                            return (
                              <span
                                className={
                                  delta > 0 ? "text-xs font-semibold text-emerald-600" : "text-xs font-semibold text-rose-600"
                                }
                              >
                                {delta > 0 ? `+${delta}` : String(delta)}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="h-10 w-20">
                        <Chart
                          type="line"
                          data={sparkData(trendOnlineDrivers, "#ea580c", "rgba(234, 88, 12, 0.14)") as any}
                          options={sparkOptions as any}
                        />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-slate-200/70 bg-white/60 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-emerald-600" />
                          <span className="text-xs text-slate-600">Online Owners</span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <div className="text-2xl font-bold text-slate-900">{onlineOwners}</div>
                          {(() => {
                            const { delta } = sparkDelta(trendOnlineOwners);
                            if (!delta) return <span className="text-xs text-slate-500">0</span>;
                            return (
                              <span
                                className={
                                  delta > 0 ? "text-xs font-semibold text-emerald-600" : "text-xs font-semibold text-rose-600"
                                }
                              >
                                {delta > 0 ? `+${delta}` : String(delta)}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="h-10 w-20">
                        <Chart
                          type="line"
                          data={sparkData(trendOnlineOwners, "#059669", "rgba(5, 150, 105, 0.14)") as any}
                          options={sparkOptions as any}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200/70 bg-white/60 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Shield className="h-4 w-4 text-purple-600" />
                          <span className="text-xs text-slate-600">Online Admins</span>
                        </div>
                        <div className="mt-2 flex items-baseline gap-2">
                          <div className="text-2xl font-bold text-slate-900">{onlineAdmins}</div>
                          {(() => {
                            const { delta } = sparkDelta(trendOnlineAdmins);
                            if (!delta) return <span className="text-xs text-slate-500">0</span>;
                            return (
                              <span
                                className={
                                  delta > 0 ? "text-xs font-semibold text-emerald-600" : "text-xs font-semibold text-rose-600"
                                }
                              >
                                {delta > 0 ? `+${delta}` : String(delta)}
                              </span>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="h-10 w-20">
                        <Chart
                          type="line"
                          data={sparkData(trendOnlineAdmins, "#7c3aed", "rgba(124, 58, 237, 0.14)") as any}
                          options={sparkOptions as any}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
  );
}

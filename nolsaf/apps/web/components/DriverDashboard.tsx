"use client";
import React, { useEffect, useState, useRef } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import { io, Socket } from "socket.io-client";

// Add custom animations
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes fade-in-up {
      from {
        opacity: 0;
        transform: translateY(20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
    .animate-fade-in-up {
      animation: fade-in-up 0.6s ease-out forwards;
      opacity: 0;
    }
    .delay-100 { animation-delay: 0.1s; }
    .delay-200 { animation-delay: 0.2s; }
    .delay-300 { animation-delay: 0.3s; }
    .delay-400 { animation-delay: 0.4s; }
    .delay-500 { animation-delay: 0.5s; }
    .delay-600 { animation-delay: 0.6s; }
  `;
  style.setAttribute('data-dashboard-animations', 'true');
  if (!document.head.querySelector('style[data-dashboard-animations]')) {
    document.head.appendChild(style);
  }
}
import {
  TrendingUp,
  AlertCircle,
  ArrowRight,
  FileText,
  ShieldCheck,
  Clock3,
  Star,
  CheckCircle2,
  Eye,
  Car,
} from 'lucide-react';
import DriverAvailabilitySwitch from "@/components/DriverAvailabilitySwitch";
import useDriverAvailability from "@/hooks/useDriverAvailability";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

type DashboardStats = {
  todayGoal: number;
  todayEarnings: number;
  goalProgress: number; // percentage
  todaysRides: number;
  acceptanceRate: number;
  earningsBreakdown: {
    base: number;
    tips: number;
    bonus: number;
  };
  rating: number;
  totalReviews: number;
  onlineHours: number;
  peakHours: {
    active: boolean;
    start: string;
    end: string;
    multiplier: number;
    timeLeft: string;
  } | null;
  earningsChart: Array<{ day: string; amount: number }>;
  tripsChart: Array<{ hour: string; trips: number }>;
  demandZones: Array<{ name: string; level: 'high' | 'medium' | 'low' }>;
  recentTrips: Array<{
    id: string;
    time: string;
    from: string;
    to: string;
    distance: string;
    amount: number;
  }>;
  reminders: Array<{
    id: string;
    type: 'warning' | 'info';
    message: string;
    action?: string;
    actionLink?: string;
  }>;
};

const unwrapAccountPayload = (payload: any) => {
  if (payload && typeof payload === "object" && "data" in payload && payload.data) {
    return payload.data;
  }
  return payload;
};

const getDriverFirstName = (profile: any) => {
  const account = unwrapAccountPayload(profile);
  const directFirstName = String(account?.firstName ?? account?.firstname ?? "").trim();
  if (directFirstName) return directFirstName;

  const fullName = String(account?.fullName ?? account?.name ?? "").trim();
  if (fullName) {
    const [firstPart] = fullName.split(/\s+/).filter(Boolean);
    if (firstPart) return firstPart;
  }

  return "Driver";
};

const getEastAfricaGreeting = () => {
  const hourText = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    hour12: false,
    timeZone: "Africa/Dar_es_Salaam",
  }).format(new Date());
  const hour = Number.parseInt(hourText, 10);

  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
};

export default function DriverDashboard({ className }: { className?: string }) {
  const [me, setMe] = useState<any | null | undefined>(undefined);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [reminders, setReminders] = useState<Array<DashboardStats['reminders'][number]>>([]);
  const socketRef = useRef<Socket | null>(null);
  const { available } = useDriverAvailability();

  // mapVisible state removed (was unused)

  

  const progressPct = stats ? Math.min(stats.goalProgress, 100) : 0;

  // Local goals stored in localStorage (optional override of server goal)
  const [goals, setGoals] = useState<{ trips?: number; money?: number; moneyUrgent?: boolean } | null>(null);
  const [showGoalsModal, setShowGoalsModal] = useState(false);

  // Form state for modal
  const [formTrips, setFormTrips] = useState<number | ''>('');
  const [formMoney, setFormMoney] = useState<number | ''>('');
  const [formMoneyUrgent, setFormMoneyUrgent] = useState(false);
  const [activeTab, setActiveTab] = React.useState<'earnings' | 'trips'>('earnings');

  useEffect(() => {
    if (showGoalsModal) {
      setFormTrips(goals?.trips ?? '');
      setFormMoney(goals?.money ?? '');
      setFormMoneyUrgent(!!goals?.moneyUrgent);
    }
  }, [showGoalsModal, goals]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('driver_goals');
      if (raw) setGoals(JSON.parse(raw));
    } catch (e) {
      // ignore
    }
  }, []);

  // Once we know which driver is logged in, scope local overrides to that driver.
  useEffect(() => {
    const id = me?.id;
    if (!id) return;

    const goalsKey = `driver_goals:${String(id)}`;
    // Goals: hydrate from per-driver key; migrate legacy key if present.
    try {
      const raw = localStorage.getItem(goalsKey);
      if (raw) {
        setGoals(JSON.parse(raw));
      } else {
        const legacy = localStorage.getItem('driver_goals');
        if (legacy) {
          setGoals(JSON.parse(legacy));
          try {
            localStorage.setItem(goalsKey, legacy);
            localStorage.removeItem('driver_goals');
          } catch {}
        }
      }
    } catch {
      // ignore
    }
  }, [me?.id]);

  // Setup Socket.IO for real-time reminder updates
  useEffect(() => {
    const socket = io(process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000", {
      transports: ["websocket"],
      withCredentials: true, // Send cookies automatically
    });

    socket.on("connect", async () => {
      console.log("Socket connected for reminders");
      try {
        const session = await fetchAccountSession();
        if (session.data?.id) socket.emit("join-driver-room", { driverId: session.data.id });
      } catch {
        // ignore
      }
    });

      // Listen for new reminders
      socket.on("new-reminder", (data: any) => {
        console.log("New reminder received:", data);
        setReminders((prev) => {
          // Check if reminder already exists
          const exists = prev.some((r: any) => String(r.id) === String(data.id));
          if (exists) return prev;
          // Add new reminder at the beginning
          return [data, ...prev];
        });
      });

    socketRef.current = socket;

    return () => {
      try {
        socket.emit("leave-driver-room", { driverId: undefined });
      } catch {}
      socket.disconnect();
    };
  }, []);

  const saveGoals = (g: { trips?: number; money?: number; moneyUrgent?: boolean } | null) => {
    try {
      const goalsKey = me?.id ? `driver_goals:${String(me.id)}` : 'driver_goals';
      if (g) {
        localStorage.setItem(goalsKey, JSON.stringify(g));
        setGoals(g);
      } else {
        localStorage.removeItem(goalsKey);
        setGoals(null);
      }
    } catch (e) {}
  };

    const handleSaveGoals = () => {
      const g: any = {};
      if (formTrips !== '' && formTrips != null) g.trips = Number(formTrips);
      if (formMoney !== '' && formMoney != null) g.money = Number(formMoney);
      if (formMoneyUrgent) g.moneyUrgent = true;
      // if nothing set, treat as clearing goals
      if (Object.keys(g).length === 0) {
        saveGoals(null);
      } else {
        saveGoals(g);
      }
      setShowGoalsModal(false);
    };

    const handleClearGoals = () => {
      saveGoals(null);
      setShowGoalsModal(false);
    };

  // Fetch user profile
  useEffect(() => {
    try {
      fetchAccountSession()
        .then((r) => setMe(r.data))
        .catch(() => setMe(null));
    } catch (err) {
      setMe(null);
    }
  }, []);

  // Fetch dashboard stats
  useEffect(() => {
    const loadStats = async () => {
      const startTime = Date.now();
      setLoading(true);
      try {
        const res = await api.get("/api/driver/dashboard");
        setStats(res.data);
        // attempt to load persisted reminders separately (prefer dedicated endpoint)
        try {
          const rr = await api.get('/api/driver/reminders');
          if (Array.isArray(rr.data)) {
            // merge server reminders with dashboard computed reminders (dedupe by id)
            const computed = Array.isArray(res.data?.reminders) ? res.data.reminders : [];
            const mergedMap: Record<string, any> = {};
            [...rr.data, ...computed].forEach((r: any) => {
              if (r && r.id) mergedMap[String(r.id)] = r;
            });
            const merged = Object.values(mergedMap);
            setReminders(merged as any);
          } else {
            // fallback to dashboard reminders
            setReminders(Array.isArray(res.data?.reminders) ? res.data.reminders : []);
          }
        } catch (e) {
          // endpoint may not exist; fallback to dashboard reminders
          setReminders(Array.isArray(res.data?.reminders) ? res.data.reminders : []);
        }

        // Attempt to derive today's earnings from payout records so the
        // Earnings stat reflects real payout amounts when available.
        try {
          const pr = await api.get('/api/driver/payouts');
          const pdata = pr.data;
          const items = Array.isArray(pdata) ? pdata : Array.isArray(pdata.items) ? pdata.items : [];
          if (items && items.length) {
            // Aggregate month-to-date payouts (same year and month)
            const today = new Date();
            const isSameMonth = (iso: any) => {
              if (!iso) return false;
              try {
                const d = new Date(iso);
                return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth();
              } catch {
                return false;
              }
            };

            const total = items.reduce((acc: number, p: any) => {
              if (!isSameMonth(p.paidAt || p.date || p.createdAt || p.settledAt)) return acc;
              const val = Number(p.netPaid ?? p.net ?? p.amountNet ?? p.amount ?? 0) || 0;
              return acc + val;
            }, 0);

            if (total > 0) {
              // update the Earnings stat to reflect month-to-date payouts
              setStats((s: any) => ({ ...(s || {}), todayEarnings: total }));
            }
          }
        } catch (e) {
          // ignore payout aggregation errors and keep original dashboard stats
          console.debug('DriverDashboard: payout aggregation failed', e);
        }
      } catch (error) {
        console.error("Failed to load dashboard stats:", error);
        // Set default stats (all zero/empty) if API fails — avoid showing sample numbers
        setStats({
          todayGoal: 0,
          todayEarnings: 0,
          goalProgress: 0,
          todaysRides: 0,
          acceptanceRate: 0,
          earningsBreakdown: { base: 0, tips: 0, bonus: 0 },
          rating: 0,
          totalReviews: 0,
          onlineHours: 0,
          peakHours: null,
          earningsChart: [],
          tripsChart: [],
          demandZones: [],
          recentTrips: [],
          reminders: [],
        });
      } finally {
        const elapsed = Date.now() - startTime;
        const remaining = Math.max(0, 1000 - elapsed);
        setTimeout(() => setLoading(false), remaining);
      }
    };

    loadStats();
  }, []);

  // Map initialization is centralized in DriverLiveMap to avoid duplicate instances.

  const profileLoaded = me !== undefined;
  const name = getDriverFirstName(me);
  const greeting = getEastAfricaGreeting;

  const fmtMoney = (n: number | null | undefined) => {
    const val = Number.isFinite(Number(n)) ? Number(n) : 0;
    return val.toLocaleString();
  };

  const acceptRate = stats?.acceptanceRate ?? 0;
  const rating = stats?.rating ?? 0;
  const onlineHours = Math.round(stats?.onlineHours ?? 0);
  const rides = stats?.todaysRides ?? 0;
  const earningsToday = stats?.todayEarnings ?? 0;
  const earningsExtra = (stats?.earningsBreakdown?.tips ?? 0) + (stats?.earningsBreakdown?.bonus ?? 0);

  

  if (loading || !profileLoaded) {
    return (
      <div className={`w-full max-w-full space-y-6 ${className || ""}`}>
        <div className="animate-pulse space-y-6">
          <div className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-800 to-blue-700 p-6 shadow-lg">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="space-y-3 flex-1">
                <div className="h-4 w-36 rounded-full bg-white/20" />
                <div className="h-9 w-full max-w-xl rounded-full bg-white/20" />
                <div className="flex flex-wrap items-center gap-2">
                  <div className="h-9 w-28 rounded-full bg-white/15" />
                  <div className="h-5 w-44 rounded-full bg-white/10" />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="space-y-2 text-right">
                  <div className="ml-auto h-4 w-14 rounded-full bg-white/15" />
                  <div className="ml-auto h-6 w-20 rounded-full bg-white/20" />
                </div>
                <div className="h-11 w-20 rounded-full bg-white/15" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
            <div className="col-span-1 lg:col-span-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <div className="h-10 w-10 rounded-full bg-slate-200" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-20 rounded-full bg-slate-200" />
                    <div className="h-7 w-56 max-w-full rounded-full bg-slate-200" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-4 w-10 rounded-full bg-slate-200" />
                  <div className="h-8 w-24 rounded-lg bg-slate-200" />
                </div>
              </div>
              <div className="mt-4 h-3 w-full rounded-full bg-slate-200" />
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="h-3 w-20 rounded-full bg-slate-200" />
                  <div className="h-3 w-10 rounded-full bg-slate-200" />
                </div>
                <div className="h-2 w-full rounded-full bg-slate-200" />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-16 rounded-full bg-slate-200" />
                  <div className="h-8 w-20 rounded-full bg-slate-200" />
                  <div className="h-3 w-24 rounded-full bg-slate-200" />
                </div>
                <div className="h-12 w-12 rounded-full bg-slate-200" />
              </div>
              <div className="mt-4 border-t border-slate-100 pt-3 space-y-2">
                <div className="h-3 w-24 rounded-full bg-slate-200" />
                <div className="h-6 w-16 rounded-full bg-slate-200" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-slate-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-14 rounded-full bg-slate-200" />
                    <div className="h-5 w-16 rounded-full bg-slate-200" />
                    <div className="h-3 w-20 rounded-full bg-slate-200" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg bg-white p-4 shadow-sm space-y-4">
              <div className="h-5 w-32 rounded-full bg-slate-200" />
              <div className="h-[150px] w-full rounded-lg bg-slate-200" />
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm space-y-4">
              <div className="h-5 w-36 rounded-full bg-slate-200" />
              <div className="h-[240px] w-full rounded-lg bg-slate-200" />
            </div>
          </div>

          <div className="rounded-lg bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="h-5 w-28 rounded-full bg-slate-200" />
              <div className="h-8 w-8 rounded-full bg-slate-200" />
            </div>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                  <div className="flex flex-1 items-center gap-3">
                    <div className="h-4 w-12 rounded-full bg-slate-200" />
                    <div className="h-4 w-4 rounded-full bg-slate-200" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-40 max-w-full rounded-full bg-slate-200" />
                      <div className="h-3 w-20 rounded-full bg-slate-200" />
                    </div>
                  </div>
                  <div className="h-4 w-20 rounded-full bg-slate-200" />
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-white p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="h-5 w-32 rounded-full bg-slate-200" />
              <div className="h-4 w-16 rounded-full bg-slate-200" />
            </div>
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-1 items-center gap-3">
                    <div className="h-5 w-5 rounded-full bg-slate-200" />
                    <div className="h-4 w-52 max-w-full rounded-full bg-slate-200" />
                  </div>
                  <div className="h-4 w-14 rounded-full bg-slate-200" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  // Prepare trips chart data: prefer `name` (property) when available, otherwise fall back to `hour`.
  const rawTripsChart = stats.tripsChart || [];
  const tripsChartData = Array.isArray(rawTripsChart)
    ? rawTripsChart.map((entry: any) => ({
        name: entry?.name ?? entry?.hour ?? String(entry?.label ?? ''),
        trips: Number(entry?.trips ?? entry?.value ?? 0),
      }))
    : [];

  // Map known time buckets to property types and aggregate into property buckets
  const hourToProperty: Record<string, string> = {
    '6AM': 'Hotel',
    '9AM': 'Lodge',
    '12PM': 'Condo',
    '3PM': 'Villa',
    '6PM': 'Apartment',
    '9PM': 'Guest Houses',
  };

  // Known property types include common categories and some region-specific names
  const knownProperties = new Set([
    'Hotel',
    'Lodge',
    'Condo',
    'Villa',
    'Apartment',
    'Guest Houses',
    'House Town',
    'Resort',
    'Cottage',
  ]);

  const propMap: Record<string, number> = {};
  tripsChartData.forEach((e: any) => {
    const key = String(e.name).trim();
    const mapped = hourToProperty[key];
    const prop = mapped ?? (knownProperties.has(key) ? key : 'Others');
    propMap[prop] = (propMap[prop] || 0) + (Number(e.trips) || 0);
  });

  // create array sorted descending by trips
  const sorted = Object.keys(propMap).map((k) => ({ name: k, trips: propMap[k] })).sort((a, b) => (b.trips || 0) - (a.trips || 0));

  // center the largest item in the middle, alternate placing next items to right then left
  const centerArrange = (items: Array<any>) => {
    const n = items.length;
    if (n === 0) return items;
    const res = new Array(n).fill(null);
    const center = Math.floor((n - 1) / 2);
    let left = center - 1;
    let right = center + 1;
    let i = 0;
    res[center] = items[i++];
    while (i < items.length) {
      if (right < n) {
        res[right] = items[i++];
        right++;
      }
      if (i < items.length && left >= 0) {
        res[left] = items[i++];
        left--;
      }
    }
    return res.filter(Boolean);
  };

  const tripsByProperty = centerArrange(sorted);

  // Mark reminder as read (optimistic)
  const markAsRead = async (id: string) => {
    try {
      await api.post(`/api/driver/reminders/${encodeURIComponent(id)}/read`);
    } catch (e) {
      // ignore errors, continue to remove locally
    }
    setReminders((r) => r.filter((x) => String(x.id) !== String(id)));
  };

  return (
    <div className={`w-full max-w-full space-y-6 ${className || ""}`}>
      {/* Hero */}
      <div
        className="relative overflow-hidden rounded-2xl text-white shadow-xl"
        style={{
          background: available
            ? "linear-gradient(135deg, #031c22 0%, #02423d 45%, #0b7a71 100%)"
            : "linear-gradient(135deg, #0f172a 0%, #1e293b 45%, #334155 100%)",
        }}
      >
        {/* Decorative glow */}
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-20 blur-3xl"
          style={{ background: available ? "#35a79c" : "#6366f1" }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-10 left-1/3 h-32 w-32 rounded-full opacity-10 blur-2xl"
          style={{ background: available ? "#02665e" : "#475569" }}
          aria-hidden
        />

        {/* Watermark sparkline — earnings trend silhouette */}
        <svg
          viewBox="0 0 400 90"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="white" stopOpacity="0.07" />
              <stop offset="100%" stopColor="white" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Area fill */}
          <path
            d="M0,70 C30,68 50,55 80,52 C110,49 130,62 160,45 C190,28 210,38 240,30 C270,22 290,40 320,28 C350,16 370,24 400,18 L400,90 L0,90 Z"
            fill="url(#sparkFill)"
          />
          {/* Line */}
          <path
            d="M0,70 C30,68 50,55 80,52 C110,49 130,62 160,45 C190,28 210,38 240,30 C270,22 290,40 320,28 C350,16 370,24 400,18"
            fill="none"
            stroke="white"
            strokeOpacity="0.13"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Highlight dots at peaks */}
          {[
            [160, 45], [240, 30], [320, 28], [400, 18],
          ].map(([cx, cy], i) => (
            <circle key={i} cx={cx} cy={cy} r="2.5" fill="white" fillOpacity="0.18" />
          ))}
        </svg>

        <div className="relative p-5 sm:p-6">
          {/* Top row: greeting + status badge */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <p className="text-sm font-medium text-white/70 tracking-wide">
              {greeting()}, <span className="text-white font-semibold">{name}</span>
            </p>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                available
                  ? "bg-emerald-500/20 text-emerald-300 ring-emerald-400/30"
                  : "bg-slate-500/20 text-slate-300 ring-slate-400/30"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${available ? "bg-emerald-400 animate-pulse" : "bg-slate-400"}`}
              />
              {available ? "Online" : "Offline"}
            </span>
          </div>

          {/* Title + switch on same row */}
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl sm:text-2xl font-bold leading-snug tracking-tight">
                {available ? "Ready for rides" : "Not receiving rides"}
              </h1>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-white/55">
                <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" />
                Safe driving mode active
              </p>
            </div>
            <div className="flex-shrink-0">
              <DriverAvailabilitySwitch />
            </div>
          </div>
        </div>
      </div>

      {/* Goal + rating row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        <div className="col-span-1 lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 transition-all duration-300 hover:shadow-md hover:scale-[1.01] animate-fade-in-up delay-100">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 flex-shrink-0 transition-all duration-300 hover:scale-110 hover:rotate-12" />
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm text-slate-500 transition-colors duration-300">Week Goal</p>
                <p className="text-lg sm:text-xl lg:text-2xl font-semibold text-slate-900 truncate transition-all duration-300">
                  {fmtMoney(earningsToday)} / {fmtMoney(goals?.money ?? stats?.todayGoal ?? 0)} TZS
                </p>
              </div>
              {goals?.moneyUrgent && (
                <span className="ml-2 inline-block text-xs px-2 py-0.5 rounded bg-red-100 text-red-700 font-medium flex-shrink-0 transition-all duration-300 hover:scale-110 animate-pulse">URGENT</span>
              )}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <span className="text-xs sm:text-sm text-slate-500 transition-all duration-300">{Math.round(goals && goals.money ? Math.min((earningsToday / (goals.money || 1)) * 100, 100) : progressPct)}%</span>
              <button onClick={() => setShowGoalsModal(true)} className="text-xs sm:text-sm px-2 sm:px-3 py-1 rounded-lg border bg-white hover:bg-gray-50 whitespace-nowrap transition-all duration-300 hover:scale-105 active:scale-95 hover:shadow-sm">Set Goals</button>
            </div>
          </div>

          <div className="mt-4 h-3 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
              style={{ width: `${goals && goals.money ? Math.min((earningsToday / (goals.money || 1)) * 100, 100) : progressPct}%` }}
            />
          </div>

          {goals && goals.trips ? (
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                <div>Trips: {rides}/{goals.trips}</div>
                <div>{Math.round(Math.min((rides / goals.trips) * 100, 100))}%</div>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all"
                  style={{ width: `${Math.round(Math.min((rides / goals.trips) * 100, 100))}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-3 sm:space-y-4 transition-all duration-300 hover:shadow-md hover:scale-[1.02] animate-fade-in-up delay-200">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs sm:text-sm text-slate-500 transition-colors duration-300">Rating</p>
              <p className="text-xl sm:text-2xl font-semibold text-slate-900 flex items-center gap-1 transition-all duration-300">
                {rating.toFixed(1)} <Star className="h-4 w-4 sm:h-5 sm:w-5 text-amber-400 flex-shrink-0 transition-all duration-300 hover:scale-110 hover:rotate-12" />
              </p>
              <p className="text-xs text-slate-500 truncate transition-colors duration-300">{stats?.totalReviews ?? 0} reviews</p>
            </div>
            <div className="rounded-full bg-slate-50 p-2 sm:p-3 border border-slate-100 flex-shrink-0 transition-all duration-300 hover:bg-amber-50 hover:border-amber-200 hover:scale-110">
              <Star className="h-5 w-5 sm:h-6 sm:w-6 text-amber-400 transition-all duration-300 hover:rotate-12" />
            </div>
          </div>
          <div className="border-t border-slate-100 pt-3 transition-all duration-300">
            <p className="text-xs sm:text-sm text-slate-500 flex items-center gap-2 transition-colors duration-300">
              <Clock3 className="h-3 w-3 sm:h-4 sm:w-4 flex-shrink-0 transition-all duration-300 hover:scale-110 hover:rotate-12" /> <span className="truncate">Online hours</span>
            </p>
            <p className="text-base sm:text-lg font-semibold text-slate-900 transition-all duration-300">{onlineHours} hrs</p>
          </div>
        </div>
      </div>

      {/* KPI bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-lg border border-slate-200 p-3 sm:p-4 shadow-sm flex items-center gap-2 sm:gap-3 transition-all duration-300 hover:shadow-md hover:scale-105 hover:border-blue-300 animate-fade-in-up delay-300 relative overflow-hidden group">
          <div className="rounded-full bg-blue-50 p-2 sm:p-3 flex-shrink-0 transition-all duration-300 hover:bg-blue-100 hover:scale-110">
            <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 transition-all duration-300 hover:rotate-12" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500 transition-colors duration-300">Rides</p>
            <p className="text-base sm:text-lg font-semibold text-slate-900 truncate transition-all duration-300">{rides}</p>
            <p className="text-xs text-slate-500 truncate transition-colors duration-300">Accept: {acceptRate}%</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-200 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 sm:p-4 shadow-sm flex items-center gap-2 sm:gap-3 transition-all duration-300 hover:shadow-md hover:scale-105 hover:border-emerald-300 animate-fade-in-up delay-400 relative overflow-hidden group">
          <div className="rounded-full bg-emerald-50 p-2 sm:p-3 flex-shrink-0 transition-all duration-300 hover:bg-emerald-100 hover:scale-110">
            <FileText className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-600 transition-all duration-300 hover:scale-110" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500 transition-colors duration-300">Earnings</p>
            <p className="text-base sm:text-lg font-semibold text-slate-900 truncate transition-all duration-300">{fmtMoney(earningsToday)}</p>
            <p className="text-xs text-slate-500 truncate transition-colors duration-300">+{fmtMoney(earningsExtra)}</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-200 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 sm:p-4 shadow-sm flex items-center gap-2 sm:gap-3 transition-all duration-300 hover:shadow-md hover:scale-105 hover:border-indigo-300 animate-fade-in-up delay-500 relative overflow-hidden group">
          <div className="rounded-full bg-indigo-50 p-2 sm:p-3 flex-shrink-0 transition-all duration-300 hover:bg-indigo-100 hover:scale-110">
            <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-indigo-600 transition-all duration-300 hover:scale-110 hover:rotate-12" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500 transition-colors duration-300">Completed</p>
            <p className="text-base sm:text-lg font-semibold text-slate-900 truncate transition-all duration-300">{rides}</p>
            <p className="text-xs text-slate-500 truncate transition-colors duration-300">Total trips</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-200 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 p-3 sm:p-4 shadow-sm flex items-center gap-2 sm:gap-3 transition-all duration-300 hover:shadow-md hover:scale-105 hover:border-emerald-300 animate-fade-in-up delay-600 relative overflow-hidden group">
          <div className="rounded-full bg-emerald-50 p-2 sm:p-3 flex-shrink-0 transition-all duration-300 hover:bg-emerald-100 hover:scale-110">
            <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 text-emerald-600 transition-all duration-300 hover:scale-110 hover:rotate-12" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500 transition-colors duration-300">Goal progress</p>
            <p className="text-base sm:text-lg font-semibold text-slate-900 truncate transition-all duration-300">
              {Math.round(goals && goals.money ? Math.min((earningsToday / (goals.money || 1)) * 100, 100) : progressPct)}%
            </p>
            <p className="text-xs text-slate-500 truncate transition-colors duration-300">Week target</p>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-200 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        </div>
      </div>

      {/* Goals Modal */}
      {showGoalsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowGoalsModal(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md p-6 z-10 border border-slate-100 overflow-hidden">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Set Your Goals</h3>
                <p className="text-sm text-slate-500">Track weekly trips and earnings to stay on target.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowGoalsModal(false)}
                className="text-slate-500 hover:text-slate-700"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 max-w-sm">
              <div className="space-y-1">
                <label htmlFor="formTrips" className="block text-sm font-medium text-slate-800">
                  Weekly trips target
                </label>
                <input
                  id="formTrips"
                  type="number"
                  min={0}
                  placeholder="e.g. 20"
                  title="Number of trips goal"
                  value={formTrips as any}
                  onChange={(e) => setFormTrips(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500">How many rides you want to finish this week.</p>
              </div>

              <div className="space-y-1">
                <label htmlFor="formMoney" className="block text-sm font-medium text-slate-800">
                  Weekly earnings target (TZS)
                </label>
                <input
                  id="formMoney"
                  type="number"
                  min={0}
                  placeholder="e.g. 100000"
                  title="Money goal in TZS"
                  value={formMoney as any}
                  onChange={(e) => setFormMoney(e.target.value === '' ? '' : Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-slate-500">Total cash target for this week.</p>
              </div>

              <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={formMoneyUrgent}
                  onChange={(e) => setFormMoneyUrgent(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 bg-blue-50 text-blue-600 focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                />
                Mark this earnings goal as urgent
              </label>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                onClick={handleClearGoals}
                className="text-sm text-red-600 hover:text-red-700"
              >
                Clear goals
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowGoalsModal(false)}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveGoals}
                  className="px-4 py-2 rounded-lg bg-[#02665e] text-white text-sm font-semibold shadow-sm hover:bg-[#015149]"
                >
                  Save goals
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analytics Charts */}
      {(() => {
        const weekTotal = (stats.earningsChart || []).reduce((s: number, d: any) => s + (Number(d.amount) || 0), 0);
        const maxTrips = Math.max(...(tripsByProperty.map((d: any) => d.trips || 0)), 1);
        const BRAND = '#02665e';
        const hasEarnings = weekTotal > 0;
        const hasTrips = tripsByProperty.some((d: any) => (d.trips || 0) > 0);

        return (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            {/* Card header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-widest mb-0.5">Analytics</p>
                <p className="text-base font-semibold text-slate-800">
                  {activeTab === 'earnings' ? (
                    <>Week earnings&nbsp;<span className="text-[#02665e]">{fmtMoney(weekTotal)} TZS</span></>
                  ) : (
                    <>Trips by property type</>
                  )}
                </p>
              </div>
              {/* Tab toggle */}
              <div className="flex items-center gap-3">
                {(['earnings', 'trips'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    title={t === 'earnings' ? 'Earnings' : 'Trips'}
                    className={[
                      'transition-all duration-200 bg-transparent border-none outline-none',
                      activeTab === t
                        ? 'text-[#02665e]'
                        : 'text-slate-300 hover:text-slate-500',
                    ].join(' ')}
                  >
                    {t === 'earnings'
                      ? <TrendingUp className="h-5 w-5" />
                      : <Car className="h-5 w-5" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="px-5 pb-5">
              {activeTab === 'earnings' ? (
                !hasEarnings ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <div className="h-10 w-10 rounded-full bg-slate-50 flex items-center justify-center">
                      <TrendingUp className="h-5 w-5 text-slate-300" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">No earnings this week yet</p>
                    <p className="text-xs text-slate-300">Complete rides to see your chart</p>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={stats.earningsChart} margin={{ top: 6, right: 4, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="earningsGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={BRAND} stopOpacity={0.18} />
                          <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="4 4" stroke="#f1f5f9" vertical={false} />
                      <XAxis
                        dataKey="day"
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#94a3b8' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v: number) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}
                      />
                      <Tooltip
                        contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', fontSize: '12px' }}
                        formatter={(value: any) => [`${fmtMoney(value)} TZS`, 'Earnings']}
                        cursor={{ stroke: BRAND, strokeWidth: 1, strokeDasharray: '4 2' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="amount"
                        stroke={BRAND}
                        strokeWidth={2.5}
                        dot={{ fill: BRAND, r: 3.5, strokeWidth: 0 }}
                        activeDot={{ r: 5, fill: BRAND, strokeWidth: 2, stroke: '#fff' }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )
              ) : (
                !hasTrips ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                    <div className="h-10 w-10 rounded-full bg-slate-50 flex items-center justify-center">
                      <CheckCircle2 className="h-5 w-5 text-slate-300" />
                    </div>
                    <p className="text-sm font-medium text-slate-400">No trips recorded yet</p>
                    <p className="text-xs text-slate-300">Complete trips to see breakdown by property</p>
                  </div>
                ) : (
                  <div className="space-y-3 pt-1">
                    {tripsByProperty.slice(0, 6).map((entry: any, i: number) => {
                      const pct = Math.round(((entry.trips || 0) / maxTrips) * 100);
                      const colors = ['#02665e', '#0b7a71', '#35a79c', '#059669', '#6366f1', '#f59e0b'];
                      return (
                        <div key={entry.name} className="flex items-center gap-3">
                          <div className="w-24 flex-shrink-0 text-xs text-slate-600 font-medium truncate text-right">
                            {entry.name}
                          </div>
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${pct}%`, background: colors[i % colors.length] }}
                            />
                          </div>
                          <div className="w-6 flex-shrink-0 text-xs font-semibold text-slate-500 text-right">
                            {entry.trips}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              )}
            </div>
          </div>
        );
      })()}

      {/* High Demand Zones moved to Live Map page */}

      {/* Recent Trips */}
      <div className="bg-white rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold text-gray-800">RECENT TRIPS</div>
          <Link 
            href="/driver/history" 
            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 no-underline transition-all duration-200 hover:scale-110"
            title="View All History"
          >
            <Eye className="h-5 w-5" />
          </Link>
        </div>
        <div className="space-y-3">
          {stats.recentTrips && stats.recentTrips.length > 0 ? (
            stats.recentTrips.map((trip) => (
              <div 
                key={trip.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="text-sm text-gray-600 w-16">{trip.time}</div>
                  <ArrowRight className="h-4 w-4 text-gray-400" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">
                      {trip.from} → {trip.to}
                    </div>
                    <div className="text-xs text-gray-500">{trip.distance}</div>
                  </div>
                </div>
                <div className="text-sm font-semibold text-gray-900">
                  {fmtMoney(trip.amount)} TZS
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-gray-600 py-4 text-center">
              No recent trips yet. Your completed trips will appear here.
            </div>
          )}
        </div>
      </div>

      {/* Reminders */}
      <div className="bg-white rounded-lg p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <div className="font-semibold text-gray-800">REMINDERS</div>
            {reminders.filter((r: any) => !r.isRead).length > 0 && (
              <span className="px-2 py-0.5 bg-red-500 text-white text-xs rounded-full">
                {reminders.filter((r: any) => !r.isRead).length} New
              </span>
            )}
          </div>
          <Link 
            href="/driver/reminders" 
            className="text-sm text-emerald-600 hover:text-emerald-700 flex items-center gap-1 no-underline transition-all"
          >
            View All
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="space-y-3">
          {reminders.length === 0 ? (
            <div className="text-sm text-gray-600">You have no reminders right now.</div>
          ) : (
            reminders.slice(0, 5).map((reminder) => {
              const containerCls = reminder.type === 'warning' ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50 border border-blue-200';
              return (
                <div key={reminder.id} className={`flex items-center justify-between p-3 rounded-lg ${containerCls}`}>
                  <div className="flex items-center gap-3 flex-1">
                    {reminder.type === 'warning' ? (
                      <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0" />
                    ) : (
                      <FileText className="h-5 w-5 text-blue-600 flex-shrink-0" />
                    )}
                    <span className="text-sm text-gray-700">{reminder.message}</span>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    {reminder.action && reminder.actionLink ? (
                      <Link href={reminder.actionLink} className="text-sm font-medium text-blue-600 hover:text-blue-700 no-underline whitespace-nowrap">
                        {reminder.action}
                      </Link>
                    ) : null}
                    <button onClick={() => markAsRead(String(reminder.id))} className="text-sm text-gray-600 hover:text-gray-800">Dismiss</button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

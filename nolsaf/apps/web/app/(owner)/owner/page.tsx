"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Building2, CalendarCheck, Eye, TrendingUp, Wallet, ChevronRight } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import { io } from "socket.io-client";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Use same-origin requests to leverage Next.js rewrites and avoid CORS
const api = apiClient;

function readOwnerName(): string | null {
  if (typeof window === "undefined") return null;
  // Try several common localStorage keys that might store the owner's name
  const tryKeys = ["ownerName", "name", "fullName", "displayName", "userName", "user"];
  for (const k of tryKeys) {
    try {
      const v = localStorage.getItem(k);
      if (!v) continue;
      // if value looks like JSON, attempt to parse and extract a name field
      if (v.trim().startsWith("{") || v.trim().startsWith("[")) {
        try {
          const obj = JSON.parse(v);
          if (obj?.name) return String(obj.name);
          if (obj?.fullName) return String(obj.fullName);
          if (obj?.displayName) return String(obj.displayName);
          if (obj?.firstName || obj?.lastName) return `${obj.firstName ?? ""} ${obj.lastName ?? ""}`.trim();
        } catch (e) {
          // ignore parse error
        }
      } else {
        return v;
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

export default function OwnerPage() {
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [overview, setOverview] = useState<any>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);
  const [lastOverviewUpdatedAt, setLastOverviewUpdatedAt] = useState<number | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const aliveRef = useRef(true);

  useEffect(() => {
    const n = readOwnerName();
    if (n) setOwnerName(n);
  }, []);

  const fetchOverview = useCallback(async (opts?: { silent?: boolean }) => {
    const now = new Date();
    const from = new Date(now);
    from.setDate(now.getDate() - 13);

    if (!opts?.silent) setLoadingOverview(true);
    try {
      const r = await api.get("/api/owner/reports/overview", {
        params: {
          from: from.toISOString(),
          to: now.toISOString(),
          groupBy: "day",
        },
      })
      if (!aliveRef.current) return;
      setOverview(r.data);
      setLastOverviewUpdatedAt(Date.now());
    } catch {
      if (!aliveRef.current) return;
      if (!opts?.silent) setOverview(null);
    } finally {
      if (!aliveRef.current) return;
      if (!opts?.silent) setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    return () => {
      aliveRef.current = false;
    };
  }, [fetchOverview]);

  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const socket = io(socketUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: 5,
    });

    const refresh = () => {
      fetchOverview({ silent: true });
    };

    (async () => {
      try {
        const me = await fetchAccountSession();
        const ownerId = Number(me.data?.id || 0);
        if (ownerId) socket.emit("join-owner-room", { ownerId });
      } catch {}
    })();

    socket.on("owner:bookings:updated", refresh);

    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onOnline = () => refresh();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    const poll = window.setInterval(refresh, 60000);

    return () => {
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("online", onOnline);
      socket.off("owner:bookings:updated", refresh);
      socket.disconnect();
    };
  }, [fetchOverview]);

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick(Date.now()), 15000);
    return () => window.clearInterval(t);
  }, []);

  const series = useMemo(() => {
    const s = Array.isArray(overview?.series) ? overview.series : [];
    return s.map((p: any) => ({
      key: String(p.key ?? ""),
      gross: Number(p.gross ?? 0),
      net: Number(p.net ?? 0),
      bookings: Number(p.bookings ?? 0),
    }));
  }, [overview]);

  const kpis = useMemo(() => {
    const k = overview?.kpis;
    return {
      bookings: Number(k?.bookings ?? 0),
      net: Number(k?.net ?? 0),
    };
  }, [overview]);

  const fmtTZS = (n: number) => {
    const num = Number(n || 0);
    return num.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const liveAgeLabel = useMemo(() => {
    if (!lastOverviewUpdatedAt) return null;
    const diffSec = Math.max(0, Math.floor((nowTick - lastOverviewUpdatedAt) / 1000));
    return `${diffSec}s`;
  }, [lastOverviewUpdatedAt, nowTick]);

  const isFreshLiveUpdate = useMemo(() => {
    if (!lastOverviewUpdatedAt) return false;
    return nowTick - lastOverviewUpdatedAt < 15000;
  }, [lastOverviewUpdatedAt, nowTick]);

  return (
    <div className="w-full pb-6 space-y-4">

      {/* ══════════════════════════════════════════════════════════════
          HERO
      ══════════════════════════════════════════════════════════════ */}
      <section
        className={`relative overflow-hidden rounded-3xl transition-all duration-700 ease-out ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
        style={{ background: "linear-gradient(135deg,#020f0d 0%,#011c18 22%,#023a32 48%,#025549 72%,#02705f 90%,#048070 100%)" }}
      >
        {/* ── dot grid ── */}
        <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: "radial-gradient(circle,rgba(255,255,255,0.06) 1px,transparent 1px)", backgroundSize: "24px 24px" }} />

        {/* ── horizontal line grid (depth) ── */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,1) 39px,rgba(255,255,255,1) 40px)" }} />

        {/* ── vignette ── */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 60% at 50% 0%,rgba(0,0,0,0) 0%,rgba(0,0,0,0.45) 100%)" }} />

        {/* ── ambient glows ── */}
        <div className="pointer-events-none absolute -top-20 left-1/3 h-72 w-72 rounded-full" style={{ background: "radial-gradient(circle,rgba(4,180,150,0.22) 0%,transparent 70%)" }} />
        <div className="pointer-events-none absolute -bottom-16 -left-10 h-56 w-56 rounded-full" style={{ background: "radial-gradient(circle,rgba(0,240,190,0.10) 0%,transparent 70%)" }} />

        {/* ═══════════════════════ BACKGROUND VISUALIZATION ═══════════════════════ */}
        {/* Decorative bar chart — rendered from live series data */}
        <div className="pointer-events-none absolute inset-0 flex items-end justify-end pr-6 pb-0" aria-hidden>
          <div className="flex items-end gap-[5px] h-full" style={{ paddingBottom: 0, paddingTop: 24, opacity: 0.13 }}>
            {(series.length > 0 ? series : Array.from({ length: 14 }, (_, i) => ({ key: i, bookings: Math.floor(Math.sin(i * 0.7 + 1) * 3 + 4) }))).map((s: any, i: number) => {
              const maxVal = Math.max(...(series.length > 0 ? series : Array.from({ length: 14 }, (_: any, j: number) => ({ bookings: Math.floor(Math.sin(j * 0.7 + 1) * 3 + 4) }))).map((x: any) => Number(x.bookings || 0)), 1);
              const pct = Math.max(0.08, Number(s.bookings || 0) / maxVal);
              return (
                <div key={i} className="rounded-t-sm flex-shrink-0" style={{ width: 14, height: `${pct * 100}%`, background: "linear-gradient(to top,rgba(0,255,200,0.9),rgba(0,255,200,0.3))" }} />
              );
            })}
          </div>
        </div>

        {/* Decorative SVG area curve in background */}
        <svg className="pointer-events-none absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 400 180" style={{ opacity: 0.07 }}>
          <defs>
            <linearGradient id="heroWave" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00ffcc" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#00ffcc" stopOpacity="0" />
            </linearGradient>
          </defs>
          {series.length > 2 && (() => {
            const pts = series.map((s: any, i: number) => ({ x: (i / (series.length - 1)) * 400, y: 160 - (Number(s.net || 0) / Math.max(...series.map((x: any) => Number(x.net || 1)))) * 140 }));
            const d = pts.map((p: any, i: number) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
            const area = `${d} L400,180 L0,180 Z`;
            return (
              <>
                <path d={area} fill="url(#heroWave)" />
                <path d={d} fill="none" stroke="#00ffcc" strokeWidth="2" />
              </>
            );
          })()}
          {/* fallback static wave when no data */}
          {series.length <= 2 && (
            <>
              <path d="M0,140 C60,100 100,160 160,90 C220,30 260,120 320,70 C360,30 380,60 400,50 L400,180 L0,180 Z" fill="url(#heroWave)" />
              <path d="M0,140 C60,100 100,160 160,90 C220,30 260,120 320,70 C360,30 380,60 400,50" fill="none" stroke="#00ffcc" strokeWidth="2" />
            </>
          )}
        </svg>

        {/* ════ CONTENT ══════ */}
        <div className="relative flex flex-col lg:flex-row lg:items-stretch gap-0">

          {/* ── LEFT: greeting + KPI tiles ── */}
          <div className="flex-1 px-5 sm:px-8 lg:px-10 pt-7 pb-6 lg:pb-7">

            {/* chrome row */}
            <div className="mb-6 flex flex-col items-center gap-3 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
              <div className="flex items-center justify-center gap-2 sm:justify-start">
                <div className="h-[3px] w-5 rounded-full" style={{ background: "rgba(0,255,190,0.5)" }} />
                <span className="text-[9px] font-black uppercase tracking-[0.26em]" style={{ color: "rgba(255,255,255,0.28)" }}>Owner Portal</span>
              </div>
              {liveAgeLabel && (
                <div className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-bold" style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)" }}>
                  <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${isFreshLiveUpdate ? "bg-emerald-400 animate-pulse" : "bg-white/25"}`} />
                  {isFreshLiveUpdate ? "Live" : `${liveAgeLabel} ago`}
                </div>
              )}
            </div>

            {/* greeting + title */}
            <div className="mb-7 text-center sm:text-left">
              {ownerName && (
                <p className="mb-2 text-[11px] font-semibold tracking-widest uppercase" style={{ color: "rgba(0,255,190,0.5)" }}>
                  Welcome back
                </p>
              )}
              <h1 className="font-black text-white leading-[1.0] tracking-tight" style={{ fontSize: "clamp(2.1rem,5.5vw,3.2rem)", textShadow: "0 2px 30px rgba(0,0,0,0.5)" }}>
                {ownerName ?? "Your workspace"}
              </h1>
              <p className="mx-auto mt-3 text-[12px] font-medium sm:mx-0" style={{ color: "rgba(255,255,255,0.32)", maxWidth: 320 }}>
                Bookings, revenue & live insights all in one place.
              </p>
            </div>

            {/* KPI tiles — stacked horizontally */}
            <div className="grid grid-cols-2 gap-2.5">
              {/* Bookings */}
              <div className="relative overflow-hidden rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.065)", border: "1px solid rgba(255,255,255,0.10)" }}>
                {/* shimmer top line */}
                <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.4) 50%,transparent 100%)" }} />
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[8.5px] font-black uppercase tracking-[0.22em]" style={{ color: "rgba(56,189,248,0.7)" }}>Bookings</span>
                  <div className="h-5 w-5 rounded-md flex items-center justify-center" style={{ background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.2)" }}>
                    <CalendarCheck className="h-2.5 w-2.5 text-sky-300" />
                  </div>
                </div>
                <div className="text-[2.8rem] font-black text-white leading-none tabular-nums" style={{ textShadow: "0 0 30px rgba(56,189,248,0.3)" }}>
                  {loadingOverview ? <span style={{ color: "rgba(255,255,255,0.15)", fontSize: "2rem" }}>—</span> : kpis.bookings}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <TrendingUp className="h-2.5 w-2.5" style={{ color: "rgba(52,211,153,0.6)" }} />
                  <span className="text-[9px] font-semibold" style={{ color: "rgba(255,255,255,0.25)" }}>Last 14 days</span>
                </div>
              </div>

              {/* Revenue */}
              <div className="relative overflow-hidden rounded-2xl p-4" style={{ background: "rgba(255,255,255,0.065)", border: "1px solid rgba(255,255,255,0.10)" }}>
                <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.4) 50%,transparent 100%)" }} />
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[8.5px] font-black uppercase tracking-[0.22em]" style={{ color: "rgba(52,211,153,0.7)" }}>Net Revenue</span>
                  <div className="h-5 w-5 rounded-md flex items-center justify-center" style={{ background: "rgba(52,211,153,0.15)", border: "1px solid rgba(52,211,153,0.2)" }}>
                    <Wallet className="h-2.5 w-2.5 text-emerald-300" />
                  </div>
                </div>
                <div className="text-[9.5px] font-black mb-0.5" style={{ color: "rgba(255,255,255,0.28)" }}>TZS</div>
                <div className="text-[1.7rem] sm:text-[2rem] font-black text-white leading-none tabular-nums truncate" style={{ textShadow: "0 0 30px rgba(52,211,153,0.3)" }}>
                  {loadingOverview ? <span style={{ color: "rgba(255,255,255,0.15)" }}>—</span> : fmtTZS(kpis.net)}
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <TrendingUp className="h-2.5 w-2.5" style={{ color: "rgba(52,211,153,0.6)" }} />
                  <span className="text-[9px] font-semibold" style={{ color: "rgba(255,255,255,0.25)" }}>Last 14 days</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT: decorative live bar visualization ── */}
          <div className="hidden lg:flex items-end justify-center w-[260px] xl:w-[300px] flex-shrink-0 pr-8 pb-0 pt-8 relative">
            {/* label */}
            <div className="absolute top-7 right-8 flex items-center gap-1.5">
              <span className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "rgba(255,255,255,0.2)" }}>14-day bookings</span>
              <div className="h-1.5 w-1.5 rounded-full" style={{ background: isFreshLiveUpdate ? "#34d399" : "rgba(255,255,255,0.2)", animation: isFreshLiveUpdate ? "pulse 2s infinite" : "none" }} />
            </div>
            {/* bar chart */}
            <div className="flex items-end gap-[5px] w-full" style={{ height: 120 }}>
              {(series.length > 0 ? series : Array.from({ length: 14 }, (_: any, i: number) => ({ bookings: Math.floor(Math.sin(i * 0.8 + 1) * 3 + 5) }))).map((s: any, i: number) => {
                const all = series.length > 0 ? series : Array.from({ length: 14 }, (_: any, j: number) => ({ bookings: Math.floor(Math.sin(j * 0.8 + 1) * 3 + 5) }));
                const maxB = Math.max(...all.map((x: any) => Number(x.bookings || 0)), 1);
                const pct = Math.max(0.06, Number(s.bookings || 0) / maxB);
                const isLast = i === all.length - 1;
                return (
                  <div key={i} className="flex-1 rounded-t-md" style={{
                    height: `${pct * 100}%`,
                    background: isLast
                      ? "linear-gradient(to top,rgba(52,211,153,1),rgba(52,211,153,0.5))"
                      : `linear-gradient(to top,rgba(255,255,255,${0.18 + pct * 0.22}),rgba(255,255,255,${0.05 + pct * 0.08}))`,
                    boxShadow: isLast ? "0 0 12px rgba(52,211,153,0.5)" : "none",
                  }} />
                );
              })}
            </div>
            {/* x-axis line */}
            <div className="absolute bottom-0 left-0 right-8 h-px" style={{ background: "rgba(255,255,255,0.08)" }} />
          </div>
        </div>

        {/* bottom breathing space */}
        <div className="h-1" />
      </section>

      {/* ══════════════════════════════════════════════════════════════
          QUICK ACTIONS
      ══════════════════════════════════════════════════════════════ */}
      <div
        className={`grid grid-cols-2 md:grid-cols-4 gap-3 transition-all duration-700 ease-out delay-100 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
      >
        {[
          { href: "/owner/properties/approved", icon: Building2,     label: "Manage listings",    sub: "Properties", topColor: "#0ea5e9", iconBg: "rgba(14,165,233,0.1)",  iconColor: "#0ea5e9" },
          { href: "/owner/reports/overview",    icon: TrendingUp,    label: "Trends & insights",  sub: "Reports",    topColor: "#10b981", iconBg: "rgba(16,185,129,0.1)",  iconColor: "#10b981" },
          { href: "/owner/revenue/paid",        icon: Wallet,        label: "Payments & receipts",sub: "Revenue",    topColor: "#f59e0b", iconBg: "rgba(245,158,11,0.1)",  iconColor: "#f59e0b" },
          { href: "/owner/properties/availability", icon: CalendarCheck, label: "External bookings", sub: "Reservations", topColor: "#02665e", iconBg: "rgba(2,102,94,0.1)", iconColor: "#02665e" },
        ].map(({ href, icon: Icon, label, sub, topColor, iconBg, iconColor }) => (
          <Link
            key={`${sub}-${label}`}
            href={href}
            className="group relative overflow-hidden rounded-2xl bg-white no-underline block transition-all duration-200 hover:-translate-y-0.5"
            style={{ border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 3px rgba(0,0,0,0.05),0 4px 12px rgba(0,0,0,0.04)" }}
          >
            <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: topColor, opacity: 0.75 }} />
            <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-200" style={{ background: `linear-gradient(135deg,${topColor}10 0%,transparent 60%)` }} />
            <div className="relative px-4 py-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: iconBg }}>
                  <Icon className="h-[18px] w-[18px]" style={{ color: iconColor }} />
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all duration-150 mt-0.5" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: topColor, opacity: 0.85 }}>{sub}</p>
                <p className="text-[13px] font-bold text-slate-800 mt-0.5 leading-snug">{label}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════════
          CHARTS
      ══════════════════════════════════════════════════════════════ */}
      <div
        className={`grid gap-4 grid-cols-1 md:grid-cols-2 transition-all duration-700 ease-out delay-200 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}
      >
        {/* Revenue trend */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5" style={{ border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 3px rgba(0,0,0,0.05),0 4px 12px rgba(0,0,0,0.04)" }}>
          <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: "linear-gradient(90deg,#10b981,#06b6d4)" }} />
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(16,185,129,0.1)" }}>
                <TrendingUp className="h-4 w-4 text-emerald-600" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-slate-900 leading-none">Net revenue</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Last 14 days</p>
              </div>
            </div>
            <Link href="/owner/reports/overview"
              className="inline-flex items-center gap-1 text-[11px] font-bold no-underline transition-opacity hover:opacity-60" style={{ color: "#02665e" }}>
              View all <Eye className="h-3 w-3" />
            </Link>
          </div>
          <div className="h-52">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="#10b981" stopOpacity={0.30} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${(v/1000).toFixed(0)}k`} width={34} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", fontSize: 12 }}
                  labelStyle={{ color: "#1e293b", fontWeight: 700 }}
                  formatter={(value: number) => [`TZS ${fmtTZS(value)}`, "Net"]}
                />
                <Area type="monotone" dataKey="net" stroke="#10b981" strokeWidth={2.5} fill="url(#netFill)" dot={false} activeDot={{ r: 5, fill: "#10b981" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bookings trend */}
        <div className="relative overflow-hidden rounded-2xl bg-white p-5" style={{ border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 3px rgba(0,0,0,0.05),0 4px 12px rgba(0,0,0,0.04)" }}>
          <div className="absolute inset-x-0 top-0 h-[3px] rounded-t-2xl" style={{ background: "linear-gradient(90deg,#8b5cf6,#ec4899)" }} />
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl flex items-center justify-center" style={{ background: "rgba(139,92,246,0.1)" }}>
                <CalendarCheck className="h-4 w-4 text-violet-600" />
              </div>
              <div>
                <p className="text-[13px] font-bold text-slate-900 leading-none">Bookings</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Last 14 days</p>
              </div>
            </div>
            <Link href="/owner/reports/overview"
              className="inline-flex items-center gap-1 text-[11px] font-bold no-underline transition-opacity hover:opacity-60" style={{ color: "#02665e" }}>
              View all <Eye className="h-3 w-3" />
            </Link>
          </div>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={series} margin={{ left: 0, right: 8, top: 6, bottom: 0 }}>
                <defs>
                  <linearGradient id="bookFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"  stopColor="#8b5cf6" stopOpacity={1} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#f1f5f9" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="key" tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fill: "#94a3b8", fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", fontSize: 12 }}
                  labelStyle={{ color: "#1e293b", fontWeight: 700 }}
                  formatter={(value: number) => [value, "Bookings"]}
                />
                <Bar dataKey="bookings" fill="url(#bookFill)" radius={[5, 5, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

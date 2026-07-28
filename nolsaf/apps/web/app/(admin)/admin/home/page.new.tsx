"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  BarChart2,
  Briefcase,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  LineChart,
  MapPin,
  MessagesSquare,
  Sparkles,
  Truck,
  Users,
} from "lucide-react";

import { useAdminHomeKpis, useAdminMonitoring, useAdminPerformanceHighlights, useAdminRecentActivities } from "./adminHomeHooks";
import { useSocket } from "@/hooks/useSocket";

const Chart = dynamic(() => import("../../../../components/Chart"), { ssr: false });

type RevenueChartDataset = {
  label: string;
  data: number[];
  borderColor: string | string[];
  backgroundColor: string | string[];
  tension: number;
  borderWidth: number;
  pointRadius: number;
};

type RevenueChartData = {
  labels: string[];
  datasets: [RevenueChartDataset, RevenueChartDataset];
};

function MiniSparkline({
  values,
  stroke,
  width = 120,
  height = 36,
  className,
}: {
  values: number[];
  stroke: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const safe = Array.isArray(values) ? values.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v)) : [];
  const points = safe.length >= 2 ? safe.slice(-24) : [];
  if (points.length < 2) return null;

  const min = Math.min(...points);
  const max = Math.max(...points);
  const w = width;
  const h = height;
  const pad = 3;
  const range = Math.max(1e-6, max - min);
  const toX = (i: number) => pad + (i * (w - pad * 2)) / (points.length - 1);
  const toY = (v: number) => pad + (1 - (v - min) / range) * (h - pad * 2);
  const d = points
    .map((v, i) => {
      const x = toX(i);
      const y = toY(v);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={"overflow-visible " + (className ?? "")}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function MiniBars({
  values,
  color,
  width = 140,
  height = 66,
  className,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const uid = useId();
  const gradientId = `miniBarsGlow-${uid}`;
  const safe = Array.isArray(values) ? values.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v)) : [];
  const points = safe.length >= 2 ? safe.slice(-14) : [];
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(1e-6, max - min);
  const w = width;
  const h = height;
  const gap = 4;
  const barW = Math.max(2, Math.floor((w - gap * (points.length - 1)) / points.length));

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={"overflow-visible " + (className ?? "")} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.95} />
          <stop offset="100%" stopColor={color} stopOpacity={0.25} />
        </linearGradient>
      </defs>
      {points.map((v, i) => {
        const t = (v - min) / range;
        const barH = 6 + t * (h - 10);
        const x = i * (barW + gap);
        const y = h - barH;
        return <rect key={i} x={x} y={y} width={barW} height={barH} rx={barW / 2} fill={`url(#${gradientId})`} />;
      })}
    </svg>
  );
}

function MiniRing({
  percent,
  color,
  size = 84,
  className,
}: {
  percent: number;
  color: string;
  size?: number;
  className?: string;
}) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  // Derive stroke and radius from size so the ring never overflows its box.
  const strokeWidth = Math.max(4, Math.round(size * 0.1));
  const r = size / 2 - strokeWidth / 2 - 2;
  const cx = size / 2;
  const cy = size / 2;
  const c = 2 * Math.PI * r;
  const dash = (p / 100) * c;
  const gap = c - dash;

  // Scale the label to fit the inner circle, accounting for digit count (e.g. "100%").
  const label = `${Math.round(p)}%`;
  const innerWidth = 2 * r - strokeWidth - 4;
  const fontSize = Math.max(9, Math.min(size * 0.26, innerWidth / (label.length * 0.62)));

  return (
    <div className={"relative " + (className ?? "")} style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={strokeWidth} fill="none" />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className="font-extrabold text-white tabular-nums leading-none"
          style={{ fontSize }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}

function MiniMeter({
  percent,
  color,
  className,
}: {
  percent: number;
  color: string;
  className?: string;
}) {
  const p = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div className={"w-[152px] " + (className ?? "")} aria-hidden>
      <div className="h-2.5 rounded-full bg-white/10 border border-white/10 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${p}%`, background: color }} />
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="text-[11px] text-white/60">Performance</div>
        <div className="text-[11px] font-semibold tabular-nums text-white/80">{Math.round(p)}%</div>
      </div>
    </div>
  );
}

function MiniDotTrend({
  values,
  color,
  width = 156,
  height = 58,
  className,
}: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  const safe = Array.isArray(values) ? values.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v)) : [];
  const points = safe.length >= 2 ? safe.slice(-16) : [];
  if (points.length < 2) return null;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(1e-6, max - min);

  const w = width;
  const h = height;
  const pad = 6;
  const innerW = w - pad * 2;
  const innerH = h - pad * 2;

  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * innerW;
    const t = (v - min) / range;
    const y = pad + (1 - t) * innerH;
    return { x, y };
  });
  const d = coords.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className={"overflow-visible " + (className ?? "")} aria-hidden>
      <path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      {coords.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.3} fill={color} opacity={i === coords.length - 1 ? 1 : 0.75} />
      ))}
    </svg>
  );
}

export default function AdminHomePage() {
  const router = useRouter();

  const { socket } = useSocket(undefined, { enabled: true, joinDriverRoom: false });

  const { monitoring } = useAdminMonitoring();
  const { recentActivities, refresh: refreshRecentActivities } = useAdminRecentActivities();
  const { driversPending, usersNew, paymentsWaiting } = useAdminHomeKpis();
  const { highlights } = useAdminPerformanceHighlights(30);

  const [nowIso, setNowIso] = useState<string | null>(null);

  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [tilesInView, setTilesInView] = useState<boolean>(false);

  const [hoursWindow, setHoursWindow] = useState<number>(24);
  const [monthsWindow, setMonthsWindow] = useState<number>(1);
  const [rangeType, setRangeType] = useState<"hours" | "months" | "properties">("hours");
  const propertiesCount = 5;

  const [chartData, setChartData] = useState<RevenueChartData | null>(null);
  const [chartRefreshNonce, setChartRefreshNonce] = useState(0);
  const refreshTimerRef = useRef<number | null>(null);

  const truncateLabel = (label: string, maxLen = 16) => {
    const s = String(label ?? "");
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(1, maxLen - 1)) + "…";
  };

  const revenueRangeTabClass = (tab: "hours" | "months" | "properties") => {
    const isActive = rangeType === tab;
    const base =
      "px-3 py-1.5 rounded-xl text-xs font-semibold border " +
      "transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/15 ";

    const variants = {
      hours: {
        active: "bg-emerald-500/15 border-emerald-400/25 text-emerald-100",
        inactive: "bg-transparent border-transparent text-slate-300 hover:bg-emerald-500/10 hover:border-emerald-400/20 hover:text-emerald-100",
      },
      months: {
        active: "bg-yellow-500/15 border-yellow-400/25 text-yellow-100",
        inactive: "bg-transparent border-transparent text-slate-300 hover:bg-yellow-500/10 hover:border-yellow-400/20 hover:text-yellow-100",
      },
      properties: {
        active: "bg-blue-500/15 border-blue-400/25 text-blue-100",
        inactive: "bg-transparent border-transparent text-slate-300 hover:bg-blue-500/10 hover:border-blue-400/20 hover:text-blue-100",
      },
    } as const;

    return base + (isActive ? variants[tab].active : variants[tab].inactive);
  };

  useEffect(() => {
    if (!socket) return;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        try {
          window.clearTimeout(refreshTimerRef.current);
        } catch {
          // ignore
        }
      }
      refreshTimerRef.current = window.setTimeout(() => {
        setChartRefreshNonce((n) => n + 1);
        refreshRecentActivities();
      }, 350);
    };

    socket.on("admin:invoice:paid", scheduleRefresh);
    socket.on("admin:invoice:status", scheduleRefresh);
    socket.on("admin:property:status", scheduleRefresh);

    return () => {
      socket.off("admin:invoice:paid", scheduleRefresh);
      socket.off("admin:invoice:status", scheduleRefresh);
      socket.off("admin:property:status", scheduleRefresh);
      if (refreshTimerRef.current) {
        try {
          window.clearTimeout(refreshTimerRef.current);
        } catch {
          // ignore
        }
        refreshTimerRef.current = null;
      }
    };
  }, [socket, refreshRecentActivities]);

  useEffect(() => {
    try {
      const media = window.matchMedia("(prefers-reduced-motion: reduce)");
      const update = () => setReduceMotion(Boolean(media.matches));
      update();
      if (typeof media.addEventListener === "function") media.addEventListener("change", update);
      else (media as any).addListener?.(update);
      return () => {
        if (typeof media.removeEventListener === "function") media.removeEventListener("change", update);
        else (media as any).removeListener?.(update);
      };
    } catch {
      setReduceMotion(false);
    }
  }, []);

  useEffect(() => {
    setNowIso(new Date().toISOString());
  }, []);

  const greetingLabel = useMemo(() => {
    if (!nowIso) return "Welcome";
    const hour = new Date(nowIso).getHours();
    return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  }, [nowIso]);

  function ClientTime({ iso }: { iso?: string | null }) {
    const [label, setLabel] = useState<string | null>(null);
    useEffect(() => {
      if (!iso) return;
      try {
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) {
          setLabel(iso || null);
          return;
        }
        const date = d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
        const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setLabel(`${date}, ${time}`);
      } catch {
        setLabel(iso || null);
      }
    }, [iso]);

    if (!label) return <span className="text-xs text-slate-400">&nbsp;</span>;
    return <span className="text-xs text-slate-400 whitespace-nowrap tabular-nums">{label}</span>;
  }

  function RelativeTime({ iso }: { iso?: string | null }) {
    const [rel, setRel] = useState<string | null>(null);
    const [abs, setAbs] = useState<string>("");
    useEffect(() => {
      if (!iso) return;
      const compute = () => {
        const d = new Date(iso);
        if (!Number.isFinite(d.getTime())) {
          setRel(iso || null);
          return;
        }
        const date = d.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
        const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setAbs(`${date}, ${time}`);

        const diffMs = Date.now() - d.getTime();
        const sec = Math.round(diffMs / 1000);
        if (sec < 45) {
          setRel("just now");
        } else if (sec < 3600) {
          setRel(`${Math.round(sec / 60)}m ago`);
        } else if (sec < 86400) {
          setRel(`${Math.round(sec / 3600)}h ago`);
        } else if (sec < 7 * 86400) {
          setRel(`${Math.round(sec / 86400)}d ago`);
        } else {
          setRel(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
        }
      };
      compute();
      const timer = setInterval(compute, 60_000);
      return () => clearInterval(timer);
    }, [iso]);

    if (!rel) return <span className="text-xs text-slate-500 shrink-0">&nbsp;</span>;
    return (
      <time title={abs} className="text-xs text-slate-500 whitespace-nowrap shrink-0 tabular-nums">
        {rel}
      </time>
    );
  }

  const formatAuditAction = (value: unknown) => {
    const raw = String(value ?? "").trim();
    if (!raw) return "Activity";
    const tokens = raw.replace(/[.]/g, "_").split(/_+/g).filter(Boolean);
    if (!tokens.length) return raw;
    return tokens
      .map((t) => {
        const lower = t.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(" ");
  };

  const auditTone = (action: unknown) => {
    const a = String(action ?? "").toUpperCase();
    if (a.startsWith("PROPERTY_")) {
      return {
        dot: "bg-emerald-400/60",
        pill: "border-emerald-400/20 bg-emerald-500/10 text-emerald-100",
      };
    }
    if (a.startsWith("INVOICE_") || a.includes("PAYMENT")) {
      return {
        dot: "bg-teal-400/60",
        pill: "border-teal-400/20 bg-teal-500/10 text-teal-100",
      };
    }
    if (a.includes("USER") || a.includes("OWNER") || a.includes("DRIVER")) {
      return {
        dot: "bg-blue-400/60",
        pill: "border-blue-400/20 bg-blue-500/10 text-blue-100",
      };
    }
    return {
      dot: "bg-white/30",
      pill: "border-white/10 bg-white/5 text-white",
    };
  };

  const truncateText = (value: unknown, maxLen = 64) => {
    const s = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    if (s.length <= maxLen) return s;
    return s.slice(0, Math.max(1, maxLen - 1)) + "…";
  };

  const parseDetails = (details: unknown): any => {
    if (!details) return null;
    if (typeof details === "object") return details;
    if (typeof details === "string") {
      const t = details.trim();
      if (!t) return null;
      try {
        return JSON.parse(t);
      } catch {
        return details;
      }
    }
    return details;
  };

  const formatAuditDetails = (action: unknown, details: unknown) => {
    const a = String(action ?? "").toUpperCase();
    const d = parseDetails(details);

    if (!d) return "";

    if (typeof d === "object") {
      const obj: any = d;

      const status = obj.toStatus ?? obj.status ?? obj.to ?? obj.result ?? "";
      if (obj.propertyId) return truncateText(`Property ${obj.propertyId}${status ? ` - ${status}` : ""}`);
      if (obj.invoiceId) return truncateText(`Invoice ${obj.invoiceId}${status ? ` - ${status}` : ""}`);
      if (obj.bookingId) return truncateText(`Booking ${obj.bookingId}${status ? ` - ${status}` : ""}`);

      if (a.includes("GRANT_BONUS") && obj.ownerId) return truncateText(`Owner ${obj.ownerId} - bonus granted`);
      if (a.includes("DISABLE_USER") && typeof obj.disable !== "undefined") return truncateText(`disable: ${String(obj.disable)}`);
      if (a.includes("ENABLE_USER")) return "disable: false";

      const ignoreKeys = new Set([
        "from",
        "to",
        "createdAt",
        "updatedAt",
        "payload",
        "png",
        "receiptQrPng",
        "receiptQrPayload",
        "notes",
        "reason",
      ]);

      const parts: string[] = [];
      for (const [k, v] of Object.entries(obj)) {
        if (ignoreKeys.has(k)) continue;
        if (v === null || typeof v === "undefined") continue;
        if (typeof v === "object") continue;
        const piece = `${k}: ${String(v)}`;
        parts.push(piece);
        if (parts.length >= 2) break;
      }

      return truncateText(parts.join(", "));
    }

    return truncateText(d);
  };

  function useCountUp(value: number, enabled: boolean, durationMs = 650) {
    const [display, setDisplay] = useState<number>(value);

    useEffect(() => {
      if (!enabled || reduceMotion) {
        setDisplay(value);
        return;
      }

      let raf = 0;
      const start = performance.now();
      const from = display;
      const delta = value - from;

      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / durationMs);
        const eased = 1 - Math.pow(1 - t, 3);
        setDisplay(from + delta * eased);
        if (t < 1) raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, enabled, durationMs, reduceMotion]);

    return display;
  }

  const pendingApprovalsValue = monitoring?.pendingApprovals ?? 0;
  const bookingsValue = monitoring?.bookings ?? 0;
  const paymentsWaitingValue = Number(paymentsWaiting ?? 0) || 0;
  const driversPendingValue = Number(driversPending ?? 0) || 0;
  const usersNewValue = Number(usersNew ?? 0) || 0;

  const pendingApprovalsAnimated = useCountUp(pendingApprovalsValue, Boolean(monitoring));
  const bookingsAnimated = useCountUp(bookingsValue, Boolean(monitoring));
  const paymentsWaitingAnimated = useCountUp(paymentsWaitingValue, paymentsWaiting !== null && paymentsWaiting !== undefined);

  const opsSnapshot = useMemo(() => {
    const labels = ["Approvals", "Payments", "Bookings", "Drivers", "New users"];
    const values = [pendingApprovalsValue, paymentsWaitingValue, bookingsValue, driversPendingValue, usersNewValue].map((n) =>
      Number.isFinite(n) ? Math.max(0, Number(n)) : 0
    );
    const total = values.reduce((s, v) => s + v, 0);
    const colors = [
      "rgba(2,102,94,0.92)",
      "rgba(6,182,212,0.88)",
      "rgba(56,189,248,0.88)",
      "rgba(16,185,129,0.88)",
      "rgba(148,163,184,0.70)",
    ];

    return { labels, values, total, colors };
  }, [bookingsValue, driversPendingValue, paymentsWaitingValue, pendingApprovalsValue, usersNewValue]);

  const opsPercent = (value: number) => {
    const total = opsSnapshot.total;
    if (!total) return 0;
    return Math.max(0, Math.min(100, (value / total) * 100));
  };

  const formatTsh = (v: number) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "Tsh 0";
    return `Tsh ${Math.round(n).toLocaleString()}`;
  };

  type NavItem = {
    href: string;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    gradient: string;
    iconWrap: string;
    badge?: number | string | null;
    seriesValues?: number[];
    seriesStroke?: string;
    className?: string;
    featured?: boolean;
    progressGradient?: string;
    bottomSlot?: React.ReactNode;
  };

  function NavTile({
    href,
    title,
    description,
    icon: Icon,
    gradient,
    iconWrap,
    badge,
    seriesValues,
    seriesStroke,
    className,
    featured,
    index,
    progressGradient = "from-emerald-400 to-cyan-300",
    bottomSlot,
  }: NavItem & { index: number }) {
    const numericBadge = typeof badge === "number" && Number.isFinite(badge) ? badge : null;
    const badgeDisplay = useCountUp(numericBadge ?? 0, tilesInView && numericBadge !== null);
    const badgeLabel = numericBadge !== null ? Math.round(badgeDisplay).toLocaleString() : badge;
    const progressPct =
      numericBadge !== null ? Math.max(0, Math.min(100, Math.round(100 * (1 - Math.exp(-numericBadge / 8))))) : null;
    const showBadge = featured && badge !== undefined && badge !== null;
    const showSparkline = !featured && Array.isArray(seriesValues) && seriesValues.length >= 2;

    return (
      <Link
        href={href}
        className={
          "group relative block no-underline " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30 " +
          "motion-safe:transition-colors motion-safe:duration-200 " +
          (className ? className : "")
        }
        style={
          reduceMotion
            ? undefined
            : {
                opacity: tilesInView ? 1 : 0,
                transform: tilesInView ? "translateY(0px)" : "translateY(10px)",
                transitionProperty: "opacity, transform, box-shadow",
                transitionDuration: "520ms",
                transitionTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
                transitionDelay: `${110 + index * 55}ms`,
              }
        }
      >
        <div
          className={
            "relative overflow-hidden rounded-[24px] border border-white/10 " +
            gradient +
            " motion-safe:transition-colors motion-safe:duration-200 group-hover:border-white/20"
          }
        >
          <div className={"relative " + (featured ? "min-h-[132px] p-4" : "min-h-[112px] p-3.5")}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={
                    "shrink-0 border border-white/10 bg-black/15 text-white/90 flex items-center justify-center " +
                    (featured ? "h-9 w-9 rounded-xl" : "h-8 w-8 rounded-xl") +
                    " " +
                    iconWrap +
                    " motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.03]"
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </div>

                <div className="min-w-0">
                  <div
                    className={
                      (featured ? "text-base sm:text-lg" : "text-sm") +
                      " font-extrabold tracking-tight text-white leading-tight min-w-0 " +
                      "[display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                    }
                  >
                    {title}
                  </div>
                  <div
                    className={
                      "mt-1 " +
                      (featured ? "text-xs" : "text-[11px]") +
                      " text-white/75 leading-snug min-w-0 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                    }
                  >
                    {description}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                {showBadge ? (
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/15 text-[10px] font-extrabold tabular-nums text-white/85">
                    {badgeLabel}
                  </div>
                ) : null}

                <ChevronRight
                  className={
                    "h-4 w-4 text-white/70 opacity-70 motion-safe:transition motion-safe:duration-300 " +
                    "group-hover:opacity-100 group-hover:translate-x-0.5"
                  }
                  aria-hidden
                />
              </div>
            </div>

            {progressPct !== null ? (
              <div className="mt-4 flex items-center gap-3">
                <div className="flex items-center gap-2 text-[11px] text-white/65">
                  <span className="h-2 w-2 rounded-full bg-black/20 border border-white/15" aria-hidden />
                  <span className="font-medium">Activity</span>
                </div>
                <div className="flex-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-black/20">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${progressGradient} transition-[width] duration-700`}
                      style={{ width: `${tilesInView ? progressPct : 0}%` }}
                      aria-hidden
                    />
                  </div>
                </div>
                <div className="text-[11px] font-semibold tabular-nums text-white/80">{progressPct}%</div>
              </div>
            ) : null}

            {bottomSlot ? (
              <div className="mt-3">{bottomSlot}</div>
            ) : showSparkline ? (
              <div className="mt-4 flex items-center justify-between gap-3">
                <div className="text-[11px] text-white/70">Trend</div>
                <div className="opacity-85">
                  <MiniSparkline
                    values={seriesValues!}
                    stroke={seriesStroke ?? "rgba(255,255,255,0.88)"}
                    width={84}
                    height={24}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </Link>
    );
  }

  function makeSpark(seed: number, len = 18) {
    const s = Number.isFinite(seed) ? Number(seed) : 0;
    const base = Math.max(1, Math.min(9999, Math.abs(s)));
    return Array.from({ length: len }).map((_, i) => {
      const w1 = Math.sin((i + 1) * 0.82 + base / 19);
      const w2 = Math.cos((i + 1) * 0.37 + base / 31);
      const drift = i * 0.12;
      return base * (0.75 + 0.08 * w1 + 0.06 * w2) + drift;
    });
  }

  useEffect(() => {
    (async () => {
      try {
        if (rangeType === "properties") {
          const res = await fetch(`/api/admin/revenue/properties?top=${encodeURIComponent(String(propertiesCount))}`);
          if (!res.ok) throw new Error("no properties");
          const json = await res.json();

          const rows = Array.isArray(json)
            ? json
                .map((it: any) => {
                  const label = it.name ?? it.title ?? `Property ${it.id ?? ""}`;
                  const commission = Number(it.commission ?? it.commission_total ?? it.commissionAmount ?? 0);
                  const subscription = Number(it.subscription ?? it.subscription_total ?? it.subscriptionAmount ?? 0);
                  const total = commission + subscription;
                  return { label: String(label), commission, subscription, total };
                })
                .sort((a, b) => (b.total || 0) - (a.total || 0))
                .slice(0, propertiesCount)
            : [];

          const labels = rows.map((r) => r.label);
          const commission = rows.map((r) => r.commission);
          const subscription = rows.map((r) => r.subscription);

          setChartData({
            labels,
            datasets: [
              {
                label: "Commission",
                data: commission,
                borderColor: [
                  "rgba(34,197,94,0.95)",
                  "rgba(234,179,8,0.95)",
                  "rgba(56,189,248,0.95)",
                  "rgba(249,115,22,0.95)",
                  "rgba(20,184,166,0.95)",
                ].slice(0, commission.length),
                backgroundColor: [
                  "rgba(34,197,94,0.18)",
                  "rgba(234,179,8,0.18)",
                  "rgba(56,189,248,0.18)",
                  "rgba(249,115,22,0.18)",
                  "rgba(20,184,166,0.18)",
                ].slice(0, commission.length),
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
              },
              {
                label: "Subscription",
                data: subscription,
                borderColor: "rgba(148,163,184,0.9)",
                backgroundColor: "rgba(148,163,184,0.08)",
                tension: 0.4,
                borderWidth: 2,
                pointRadius: 0,
              },
            ],
          });
          return;
        }

        const now = new Date();
        let interval: "hour" | "day" | "month" = "day";
        let fromDate = new Date(Date.now() - 30 * 24 * 3600 * 1000);
        if (rangeType === "hours") {
          interval = "hour";
          fromDate = new Date(now.getTime() - (Math.max(1, hoursWindow) - 1) * 60 * 60 * 1000);
        } else if (rangeType === "months") {
          interval = "month";
          fromDate = new Date(now.getFullYear(), now.getMonth() - (Math.max(1, monthsWindow) - 1), 1);
        }

        const q = new URLSearchParams();
        q.set("from", fromDate.toISOString());
        q.set("to", now.toISOString());
        q.set("interval", interval);

        const res = await fetch(`/api/admin/revenue/series?${q.toString()}`);
        if (!res.ok) throw new Error("no series");

        const json = await res.json();
        let labels: string[] = [];
        let commission: number[] = [];
        let subscription: number[] = [];

        if (Array.isArray(json)) {
          labels = json.map((r: any) => String(r?.label ?? ""));
          commission = json.map((r: any) => Number(r?.commission ?? r?.commission_total ?? 0));
          subscription = json.map((r: any) => Number(r?.subscription ?? r?.subscription_total ?? 0));
        } else {
          labels = Array.isArray((json as any)?.labels) ? (json as any).labels.map((v: any) => String(v)) : [];
          commission = Array.isArray((json as any)?.commission) ? (json as any).commission.map((n: any) => Number(n || 0)) : [];
          subscription = Array.isArray((json as any)?.subscription) ? (json as any).subscription.map((n: any) => Number(n || 0)) : [];
        }

        setChartData({
          labels,
          datasets: [
            {
              label: "Commission",
              data: commission,
              borderColor: "rgba(56,189,248,0.95)",
              backgroundColor: "rgba(56,189,248,0.06)",
              tension: 0.4,
              borderWidth: 2,
              pointRadius: 0,
            },
            {
              label: "Subscription",
              data: subscription,
              borderColor: "rgba(34,197,94,0.95)",
              backgroundColor: "rgba(34,197,94,0.05)",
              tension: 0.4,
              borderWidth: 2,
              pointRadius: 0,
            },
          ],
        });
      } catch {
        // keep placeholders on failure
      }
    })();
  }, [hoursWindow, monthsWindow, propertiesCount, rangeType, chartRefreshNonce]);

  const totalCommission = chartData ? chartData.datasets[0].data.reduce((s, v) => s + Number(v || 0), 0) : 0;
  const totalSubscription = chartData ? chartData.datasets[1].data.reduce((s, v) => s + Number(v || 0), 0) : 0;

  return (
    <div className="relative min-h-screen bg-[#070B1C] text-slate-100 overflow-hidden">
      <div className="relative mx-auto max-w-[96rem] px-3 py-5 sm:px-4 sm:py-6 lg:px-6 lg:py-7">
        <div className="grid grid-cols-12 gap-6">
          <main className="col-span-12 rounded-[32px] border border-white/10 bg-white/[0.02] p-4 shadow-[0_26px_110px_-70px_rgba(0,0,0,0.95)] sm:p-5 lg:p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span className="flex items-center gap-[3px]" aria-hidden>
                    {([ 
                      { delay: 0,   color: "bg-sky-400",     shadow: "rgba(56,189,248,0.9)"  },
                      { delay: 400, color: "bg-emerald-400", shadow: "rgba(52,211,153,0.9)"  },
                      { delay: 800, color: "bg-red-400",     shadow: "rgba(248,113,113,0.9)" },
                    ] as const).map(({ delay, color, shadow }) => (
                      <span
                        key={delay}
                        className={`inline-block h-1.5 w-1.5 rounded-full ${color}`}
                        style={{ boxShadow: `0 0 6px ${shadow}`, animation: "nols-seq-blink 1.2s ease-in-out infinite", animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </span>
                  System operational
                  <span className="mx-1 text-white/20">·</span>
                  <ClientTime iso={nowIso} />
                </div>
                <h1 className="mt-1 text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  {greetingLabel},&nbsp;Admin
                </h1>
                <div className="mt-1 text-sm text-slate-400">Approvals · Payments · Bookings · Revenue all in one view</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => router.push("/admin/revenue")}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10 transition"
                >
                  <BarChart2 className="h-4 w-4 text-sky-200" aria-hidden />
                  Revenue
                </button>
                <button
                  type="button"
                  onClick={() => router.push("/admin/properties/previews")}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/15 transition"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-200" aria-hidden />
                  Approvals
                </button>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-6">
              <section className="col-span-12">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5 xl:gap-4">
                  <div className="group relative overflow-hidden rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-[#0a4038] via-[#0b332f] to-[#0a211f] p-4 shadow-[0_22px_80px_-60px_rgba(0,0,0,0.95)] motion-safe:transition hover:-translate-y-0.5 hover:shadow-[0_28px_95px_-60px_rgba(0,0,0,0.98)]">
                    <div
                      className="hidden"
                      aria-hidden
                      style={{
                        background:
                          "radial-gradient(520px circle at 15% 20%, rgba(2,102,94,0.30), transparent 55%), radial-gradient(520px circle at 90% 30%, rgba(34,197,94,0.18), transparent 60%)",
                      }}
                    />
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="text-sm font-medium text-slate-200">Pending approvals</div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-500/15">
                        <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-3 text-3xl font-extrabold tracking-tight text-white tabular-nums">
                      {monitoring ? Math.round(pendingApprovalsAnimated).toLocaleString() : <div className="h-10 w-16 rounded-xl bg-white/10 animate-pulse" />}
                    </div>
                    <div className="relative mt-1.5 text-xs text-slate-400">{monitoring ? "Listings to review" : <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />}</div>
                    <div className="relative mt-3 flex h-12 items-end justify-between gap-3">
                      <div className="text-[11px] text-slate-400">
                        Share <span className="text-slate-200 font-semibold">{opsPercent(pendingApprovalsValue).toFixed(0)}%</span>
                      </div>
                      <MiniBars values={makeSpark(pendingApprovalsValue + 11, 14)} color="rgba(34,197,94,0.95)" width={110} height={48} className="opacity-95" />
                    </div>
                  </div>

                  <div className="group relative overflow-hidden rounded-2xl border border-sky-500/20 bg-gradient-to-br from-[#0d4761] via-[#0c354b] to-[#0a2230] p-4 shadow-[0_22px_80px_-60px_rgba(0,0,0,0.95)] motion-safe:transition hover:-translate-y-0.5 hover:shadow-[0_28px_95px_-60px_rgba(0,0,0,0.98)]">
                    <div
                      className="hidden"
                      aria-hidden
                      style={{
                        background:
                          "radial-gradient(520px circle at 15% 25%, rgba(6,182,212,0.26), transparent 56%), radial-gradient(520px circle at 90% 22%, rgba(56,189,248,0.18), transparent 60%)",
                      }}
                    />
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="text-sm font-medium text-slate-200">Payments waiting</div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-400/25 bg-sky-500/15">
                        <CreditCard className="h-4 w-4 text-sky-300" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-3 text-3xl font-extrabold tracking-tight text-white tabular-nums">
                      {paymentsWaiting != null
                        ? Math.round(paymentsWaitingAnimated).toLocaleString()
                        : <div className="h-10 w-16 rounded-xl bg-white/10 animate-pulse" />}
                    </div>
                    <div className="relative mt-1.5 text-xs text-slate-400">{paymentsWaiting != null ? "Payouts & settlements" : <div className="h-3 w-28 rounded bg-white/10 animate-pulse" />}</div>
                    <div className="relative mt-3 flex h-12 items-end justify-between gap-3">
                      <div className="text-[11px] text-slate-400">
                        Share <span className="text-slate-200 font-semibold">{opsPercent(paymentsWaitingValue).toFixed(0)}%</span>
                      </div>
                      <MiniRing percent={opsPercent(paymentsWaitingValue)} color="rgba(56,189,248,0.95)" size={58} className="opacity-95" />
                    </div>
                  </div>

                  <div className="group relative overflow-hidden rounded-2xl border border-blue-500/20 bg-gradient-to-br from-[#173f70] via-[#14345b] to-[#0b223c] p-4 shadow-[0_22px_80px_-60px_rgba(0,0,0,0.95)] motion-safe:transition hover:-translate-y-0.5 hover:shadow-[0_28px_95px_-60px_rgba(0,0,0,0.98)]">
                    <div
                      className="hidden"
                      aria-hidden
                      style={{
                        background:
                          "radial-gradient(520px circle at 18% 22%, rgba(56,189,248,0.26), transparent 56%), radial-gradient(520px circle at 92% 35%, rgba(59,130,246,0.18), transparent 62%)",
                      }}
                    />
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="text-sm font-medium text-slate-200">Bookings</div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-blue-400/25 bg-blue-500/15">
                        <CalendarDays className="h-4 w-4 text-blue-300" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-3 text-3xl font-extrabold tracking-tight text-white tabular-nums">
                      {monitoring ? Math.round(bookingsAnimated).toLocaleString() : <div className="h-10 w-16 rounded-xl bg-white/10 animate-pulse" />}
                    </div>
                    <div className="relative mt-1.5 text-xs text-slate-400">{monitoring ? "In the current window" : <div className="h-3 w-28 rounded bg-white/10 animate-pulse" />}</div>
                    <div className="relative mt-3 flex h-12 items-end justify-between gap-3">
                      <div className="text-[11px] text-slate-400">
                        Share <span className="text-slate-200 font-semibold">{opsPercent(bookingsValue).toFixed(0)}%</span>
                      </div>
                      <MiniSparkline values={makeSpark(bookingsValue + 17, 24)} stroke="rgba(34,211,238,0.95)" width={112} height={44} className="opacity-95" />
                    </div>
                  </div>

                  <div className="group relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-br from-[#513219] via-[#3f2817] to-[#241b16] p-4 shadow-[0_22px_80px_-60px_rgba(0,0,0,0.95)] motion-safe:transition hover:-translate-y-0.5 hover:shadow-[0_28px_95px_-60px_rgba(0,0,0,0.98)]">
                    <div
                      className="hidden"
                      aria-hidden
                      style={{
                        background:
                          "radial-gradient(520px circle at 18% 26%, rgba(245,158,11,0.22), transparent 56%), radial-gradient(520px circle at 92% 30%, rgba(251,191,36,0.14), transparent 62%)",
                      }}
                    />
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="text-sm font-medium text-slate-200">Drivers pending</div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-500/15">
                        <Truck className="h-4 w-4 text-amber-300" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-3 text-3xl font-extrabold tracking-tight text-white tabular-nums">
                      {driversPending != null ? driversPending : <div className="h-10 w-16 rounded-xl bg-white/10 animate-pulse" />}
                    </div>
                    <div className="relative mt-1.5 text-xs text-slate-400">{driversPending != null ? "Awaiting verification" : <div className="h-3 w-28 rounded bg-white/10 animate-pulse" />}</div>
                    <div className="relative mt-3 flex h-12 items-end justify-between gap-3">
                      <div className="text-[11px] text-slate-400">
                        Share <span className="text-slate-200 font-semibold">{opsPercent(driversPendingValue).toFixed(0)}%</span>
                      </div>
                      <MiniBars values={makeSpark(driversPendingValue + 23, 14)} color="rgba(2,102,94,0.95)" width={110} height={48} className="opacity-95" />
                    </div>
                  </div>

                  <div className="group relative overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-[#372566] via-[#2f2358] to-[#1e193b] p-4 shadow-[0_22px_80px_-60px_rgba(0,0,0,0.95)] motion-safe:transition hover:-translate-y-0.5 hover:shadow-[0_28px_95px_-60px_rgba(0,0,0,0.98)]">
                    <div
                      className="hidden"
                      aria-hidden
                      style={{
                        background:
                          "radial-gradient(520px circle at 18% 20%, rgba(139,92,246,0.22), transparent 56%), radial-gradient(520px circle at 92% 35%, rgba(167,139,250,0.16), transparent 62%)",
                      }}
                    />
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="text-sm font-medium text-slate-200">New users</div>
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-violet-400/25 bg-violet-500/15">
                        <Users className="h-4 w-4 text-violet-300" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-3 text-3xl font-extrabold tracking-tight text-white tabular-nums">
                      {usersNew != null ? usersNew : <div className="h-10 w-16 rounded-xl bg-white/10 animate-pulse" />}
                    </div>
                    <div className="relative mt-1.5 text-xs text-slate-400">{usersNew != null ? "Recently joined" : <div className="h-3 w-24 rounded bg-white/10 animate-pulse" />}</div>
                    <div className="relative mt-3 flex h-12 items-end justify-between gap-3">
                      <div className="text-[11px] text-slate-400">
                        Share <span className="text-slate-200 font-semibold">{opsPercent(usersNewValue).toFixed(0)}%</span>
                      </div>
                      <MiniRing percent={opsPercent(usersNewValue)} color="rgba(16,185,129,0.95)" size={58} className="opacity-95" />
                    </div>
                  </div>
                </div>
              </section>

              <section className="col-span-12">
                <div className="flex items-end justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold text-white">Performance highlights</div>
                    <div className="text-xs text-slate-400">Top performers in the last {highlights?.windowDays ?? 30} days</div>
                  </div>
                  <div className="inline-flex items-center gap-2 text-xs text-slate-400">
                    <Sparkles className="h-4 w-4 text-emerald-200" aria-hidden />
                    Best of NoLSAF
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <Link
                    href="/admin/properties/previews"
                    className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#123c36] p-5 transition-colors duration-200 hover:border-white/20 no-underline hover:no-underline"
                  >
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400">Best property type</div>
                        <div className="mt-1 text-lg font-extrabold text-white tracking-tight truncate">
                          {highlights?.bestPropertyType?.type ?? "--"}
                        </div>
                      </div>
                      <div className="h-9 w-9 rounded-2xl border border-white/10 bg-white/10 flex items-center justify-center">
                        <Building2 className="h-4 w-4 text-white/90" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-3 flex items-end justify-between gap-3">
                      <div className="text-sm text-slate-300">
                        <span className="font-semibold text-white tabular-nums">{(highlights?.bestPropertyType?.bookings ?? 0).toLocaleString()}</span> bookings
                        <div className="mt-1 text-xs text-slate-400">
                          {(highlights?.bestPropertyType?.interactions ?? 0).toLocaleString()} interactions
                        </div>
                      </div>
                      <MiniDotTrend
                        values={makeSpark((highlights?.bestPropertyType?.bookings ?? 0) + (highlights?.bestPropertyType?.interactions ?? 0) + 17, 16)}
                        color="rgba(34,197,94,0.95)"
                        width={156}
                        height={58}
                        className="opacity-95"
                      />
                    </div>
                    <div className="relative mt-3 text-xs text-slate-500">Bookings + saves/reviews</div>
                  </Link>

                  <Link
                    href={highlights?.bestDriver?.driverId ? `/admin/drivers/audit/${highlights.bestDriver.driverId}` : "/admin/drivers"}
                    className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#172f45] p-5 transition-colors duration-200 hover:border-white/20 no-underline hover:no-underline"
                  >
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400">Best driver (NoLSAF revenue)</div>
                        <div className="mt-1 text-lg font-extrabold text-white tracking-tight truncate">
                          {highlights?.bestDriver?.name ?? "--"}
                        </div>
                      </div>
                      <div className="h-9 w-9 rounded-2xl border border-white/10 bg-white/10 flex items-center justify-center">
                        <Truck className="h-4 w-4 text-white/90" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-3 flex items-end justify-between gap-3">
                      <div className="text-sm text-slate-300">
                        <div className="text-base font-extrabold text-white tabular-nums">
                          {formatTsh(highlights?.bestDriver?.nolsRevenue ?? 0)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {(highlights?.bestDriver?.bookings ?? 0).toLocaleString()} bookings
                        </div>
                      </div>
                      <MiniMeter
                        percent={Math.max(
                          0,
                          Math.min(100, Math.round(100 * (1 - Math.exp(-(highlights?.bestDriver?.nolsRevenue ?? 0) / 500000))))
                        )}
                        color="linear-gradient(90deg, rgba(56,189,248,0.95), rgba(34,211,238,0.95))"
                        className="opacity-95"
                      />
                    </div>
                    <div className="relative mt-3 text-xs text-slate-500">Commission from approved/paid invoices</div>
                  </Link>

                  <Link
                    href={highlights?.bestOwner?.ownerId ? `/admin/owners/${highlights.bestOwner.ownerId}` : "/admin/owners"}
                    className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#123a38] p-5 transition-colors duration-200 hover:border-white/20 no-underline hover:no-underline"
                  >
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400">Best owner (revenue + bookings)</div>
                        <div className="mt-1 text-lg font-extrabold text-white tracking-tight truncate">
                          {highlights?.bestOwner?.name ?? "--"}
                        </div>
                      </div>
                      <div className="h-9 w-9 rounded-2xl border border-white/10 bg-white/10 flex items-center justify-center">
                        <Briefcase className="h-4 w-4 text-white/90" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-3 flex items-end justify-between gap-3">
                      <div className="text-sm text-slate-300">
                        <div className="text-base font-extrabold text-white tabular-nums">
                          {formatTsh(highlights?.bestOwner?.nolsRevenue ?? 0)}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">
                          {(highlights?.bestOwner?.bookings ?? 0).toLocaleString()} bookings
                        </div>
                      </div>
                      <MiniDotTrend
                        values={makeSpark((highlights?.bestOwner?.bookings ?? 0) + (highlights?.bestOwner?.nolsRevenue ?? 0) / 10000 + 31, 16)}
                        color="rgba(16,185,129,0.95)"
                        width={156}
                        height={58}
                        className="opacity-95"
                      />
                    </div>
                    <div className="relative mt-3 text-xs text-slate-500">Owner whose bookings earned most commission</div>
                  </Link>

                  <Link
                    href="/admin/bookings"
                    className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#273548] p-5 transition-colors duration-200 hover:border-white/20 no-underline hover:no-underline"
                  >
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400">Most booked region</div>
                        <div className="mt-1 text-lg font-extrabold text-white tracking-tight truncate">
                          {highlights?.mostBookedRegion?.regionName ?? "--"}
                        </div>
                      </div>
                      <div className="h-9 w-9 rounded-2xl border border-white/10 bg-white/10 flex items-center justify-center">
                        <MapPin className="h-4 w-4 text-white/90" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-3 flex items-end justify-between gap-3">
                      <div className="text-sm text-slate-300">
                        <span className="text-base font-extrabold text-white tabular-nums">{(highlights?.mostBookedRegion?.bookings ?? 0).toLocaleString()}</span>
                        <div className="mt-1 text-xs text-slate-400">bookings</div>
                      </div>
                      <MiniMeter
                        percent={Math.max(
                          0,
                          Math.min(100, Math.round(100 * (1 - Math.exp(-(highlights?.mostBookedRegion?.bookings ?? 0) / 25))))
                        )}
                        color="linear-gradient(90deg, rgba(148,163,184,0.95), rgba(56,189,248,0.80))"
                        className="opacity-95"
                      />
                    </div>
                    <div className="relative mt-3 text-xs text-slate-500">Region with highest check-ins</div>
                  </Link>

                  <Link
                    href={
                      highlights?.topProperty?.propertyId
                        ? `/admin/properties/previews?previewId=${highlights.topProperty.propertyId}`
                        : "/admin/properties/previews"
                    }
                    className="group relative overflow-hidden rounded-3xl border border-white/10 bg-[#123845] p-5 transition-colors duration-200 hover:border-white/20 md:col-span-2 xl:col-span-1 no-underline hover:no-underline"
                  >
                    <div className="relative flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs text-slate-400">Top property (bookings + interactions)</div>
                        <div className="mt-1 text-lg font-extrabold text-white tracking-tight truncate">
                          {highlights?.topProperty?.title ?? "--"}
                        </div>
                      </div>
                      <div className="h-9 w-9 rounded-2xl border border-white/10 bg-white/10 flex items-center justify-center">
                        <LayoutDashboard className="h-4 w-4 text-white/90" aria-hidden />
                      </div>
                    </div>
                    <div className="relative mt-2 text-xs text-slate-400 truncate">
                      {highlights?.topProperty ? `${highlights.topProperty.type} - ${highlights.topProperty.regionName}` : ""}
                    </div>
                    <div className="relative mt-3 flex items-end justify-between gap-3">
                      <div className="text-sm text-slate-300">
                        <span className="font-semibold text-white tabular-nums">{(highlights?.topProperty?.bookings ?? 0).toLocaleString()}</span> bookings
                        <div className="mt-1 text-xs text-slate-400">
                          {(highlights?.topProperty?.interactions ?? 0).toLocaleString()} interactions
                        </div>
                      </div>
                      <MiniDotTrend
                        values={makeSpark((highlights?.topProperty?.bookings ?? 0) + (highlights?.topProperty?.interactions ?? 0) + 19, 16)}
                        color="rgba(2,102,94,0.95)"
                        width={156}
                        height={58}
                        className="opacity-95"
                      />
                    </div>
                    <div className="relative mt-3 text-xs text-slate-500">Signals: check-ins, saves & reviews</div>
                  </Link>
                </div>
              </section>

              <section className="col-span-12 lg:col-span-7 overflow-hidden rounded-3xl border border-white/10 bg-[#111827]">
                <div className="p-5 sm:p-6 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold text-white">Revenue analytics</div>
                    <div className="text-xs text-slate-400">Commission & subscription series</div>
                  </div>
                  <div className="scrollbar-hide flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 touch-pan-x">
                    <div className="inline-flex shrink-0 rounded-2xl bg-white/5 p-1 border border-white/10">
                      <button
                        type="button"
                        onClick={() => setRangeType("hours")}
                        className={revenueRangeTabClass("hours")}
                      >
                        Hours
                      </button>
                      <button
                        type="button"
                        onClick={() => setRangeType("months")}
                        className={"mx-1 " + revenueRangeTabClass("months")}
                      >
                        Months
                      </button>
                      <button
                        type="button"
                        onClick={() => setRangeType("properties")}
                        className={revenueRangeTabClass("properties")}
                      >
                        Properties
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => router.push("/admin/revenue")}
                      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-2xl border border-teal-400/20 bg-teal-500/10 px-3 py-2 text-xs font-semibold text-teal-100 hover:bg-teal-500/15 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/25"
                    >
                      View details
                    </button>

                    {rangeType === "hours" && (
                      <select
                        title="Hours range"
                        aria-label="Hours range"
                        className="shrink-0 whitespace-nowrap border border-white/10 rounded-2xl px-3 py-2 bg-white/5 text-xs text-slate-100 hover:bg-white/10 transition-colors duration-200"
                        value={hoursWindow}
                        onChange={(e) => setHoursWindow(Number(e.target.value))}
                      >
                        <option value={6}>Last 6 hours</option>
                        <option value={12}>Last 12 hours</option>
                        <option value={24}>Last 24 hours</option>
                        <option value={48}>Last 48 hours</option>
                      </select>
                    )}
                    {rangeType === "months" && (
                      <select
                        title="Months range"
                        aria-label="Months range"
                        className="shrink-0 whitespace-nowrap border border-white/10 rounded-2xl px-3 py-2 bg-white/5 text-xs text-slate-100 hover:bg-white/10 transition-colors duration-200"
                        value={monthsWindow}
                        onChange={(e) => setMonthsWindow(Number(e.target.value))}
                      >
                        <option value={1}>Last 1 month</option>
                        <option value={2}>Last 2 months</option>
                        <option value={3}>Last 3 months</option>
                        <option value={6}>Last 6 months</option>
                        <option value={9}>Last 9 months</option>
                        <option value={12}>Last 12 months</option>
                      </select>
                    )}
                  </div>
                </div>

                <div className="p-5 sm:p-6">
                  {chartData === null ? (
                    <div className="py-10 text-center text-sm text-slate-400">Loading revenue data…</div>
                  ) : (
                    (() => {
                      const commissionArr = chartData.datasets[0].data;
                      const subscriptionArr = chartData.datasets[1].data;
                      const totalC = commissionArr.reduce((s, v) => s + Number(v || 0), 0);
                      const totalS = subscriptionArr.reduce((s, v) => s + Number(v || 0), 0);
                      const totalT = totalC + totalS;
                      const hasPoints = (chartData?.labels?.length || 0) > 0;
                      const fallbackHourPoints = Math.min(6, Math.max(2, hoursWindow));
                      const fallbackMonthPoints = Math.max(2, monthsWindow);
                      const fallbackLabels = rangeType === "hours"
                        ? Array.from({ length: fallbackHourPoints }, (_, index) => {
                            const hoursAgo = Math.round(((fallbackHourPoints - 1 - index) * Math.max(1, hoursWindow - 1)) / Math.max(1, fallbackHourPoints - 1));
                            return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                          })
                        : rangeType === "months"
                          ? Array.from({ length: fallbackMonthPoints }, (_, index) => {
                              const date = new Date();
                              date.setMonth(date.getMonth() - (fallbackMonthPoints - 1 - index));
                              return date.toLocaleDateString([], { month: "short" });
                            })
                          : Array.from({ length: propertiesCount }, (_, index) => `#${index + 1}`);
                      const baselineLabels = hasPoints ? chartData.labels : fallbackLabels;
                      const totalsByPoint = commissionArr.map((value, index) => Number(value || 0) + Number(subscriptionArr[index] || 0));
                      const activePoints = totalsByPoint.filter((value) => value > 0).length;
                      const hasRevenue = totalT > 0;
                      const averageRevenue = hasPoints ? Math.round(totalT / chartData.labels.length) : 0;
                      const commissionShare = totalT > 0 ? Math.round((totalC / totalT) * 100) : 0;
                      const pointLabel = rangeType === "properties" ? "properties" : rangeType === "months" ? "months" : "hours";

                      return (
                        <>
                          <div className="rounded-2xl border border-white/10 bg-[#0d1524] p-4 sm:p-5">
                            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-slate-100">Revenue performance</div>
                                <div className="mt-0.5 text-xs text-slate-500">
                                  {rangeType === "properties" ? `Top ${propertiesCount} properties ranked by revenue` : `Commission and subscriptions across ${pointLabel}`}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" />Commission</span>
                                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" />Subscription</span>
                              </div>
                            </div>

                            <div className="h-56 sm:h-64">
                            {hasPoints && hasRevenue ? (
                              <Chart
                                type="line"
                                data={chartData}
                                options={{
                                  responsive: true,
                                  maintainAspectRatio: false,
                                  layout: { padding: { left: 4, right: 8, top: 6, bottom: 0 } },
                                  elements: {
                                    line: { tension: 0.35, borderWidth: 2 },
                                    point: { radius: 2.5, hoverRadius: 5, borderWidth: 0 },
                                  },
                                  interaction: { mode: "index", intersect: false },
                                  plugins: {
                                    legend: { display: false },
                                    tooltip: {
                                      callbacks: {
                                        labelColor: (ctx: any) => {
                                          if (rangeType !== "properties") return undefined as any;
                                          try {
                                            const ds: any = ctx?.dataset;
                                            const i = Number(ctx?.dataIndex ?? 0);
                                            const borderColor = Array.isArray(ds?.borderColor) ? ds.borderColor[i] : ds?.borderColor;
                                            const backgroundColor = Array.isArray(ds?.backgroundColor)
                                              ? ds.backgroundColor[i]
                                              : ds?.backgroundColor;
                                            return {
                                              borderColor: borderColor ?? "rgba(226,232,240,0.9)",
                                              backgroundColor: backgroundColor ?? "rgba(226,232,240,0.18)",
                                            };
                                          } catch {
                                            return undefined as any;
                                          }
                                        },
                                      },
                                    },
                                  },
                                  scales: {
                                    y: {
                                      beginAtZero: true,
                                      border: { display: false },
                                      grid: { color: "rgba(255,255,255,0.055)", drawTicks: false },
                                      ticks: { display: false },
                                    },
                                    x: {
                                      border: { display: false },
                                      grid: { display: false },
                                      ticks: {
                                        color: "rgba(226,232,240,0.75)",
                                        autoSkip: rangeType !== "properties",
                                        maxRotation: 45,
                                        minRotation: 0,
                                        callback: (value: any) => {
                                          try {
                                            const idx = Number(value);
                                            const axisLabel = Number.isFinite(idx) ? (chartData.labels as any)?.[idx] : value;
                                            const label = axisLabel ?? value;
                                            if (rangeType !== "properties") return String(label);
                                            return truncateLabel(String(label), 14);
                                          } catch {
                                            return String(value);
                                          }
                                        },
                                      },
                                    },
                                  },
                                }}
                              />
                            ) : (
                              <div className="relative flex h-full flex-col justify-end overflow-hidden rounded-xl border border-white/[0.06] bg-[#0a1220] px-4 pb-8 pt-5">
                                <div className="pointer-events-none absolute inset-x-4 top-1/4 border-t border-dashed border-white/[0.06]" />
                                <div className="pointer-events-none absolute inset-x-4 top-1/2 border-t border-dashed border-white/[0.06]" />
                                <div className="pointer-events-none absolute inset-x-4 top-3/4 border-t border-dashed border-white/[0.06]" />
                                <div className="absolute inset-x-0 top-[38%] text-center">
                                  <div className="text-sm font-semibold text-slate-300">Revenue baseline ready</div>
                                  <div className="mt-1 text-xs text-slate-500">The line will rise when commission or subscription revenue is posted.</div>
                                </div>
                                <div className="relative flex items-center">
                                  {baselineLabels.map((label, index) => (
                                    <div key={`${String(label)}-${index}`} className="flex min-w-0 flex-1 items-center">
                                      <span className="h-2 w-2 shrink-0 rounded-full border-2 border-slate-500 bg-[#0a1220]" />
                                      {index < baselineLabels.length - 1 && <span className="h-px min-w-0 flex-1 bg-slate-600" />}
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-3 flex justify-between text-[10px] text-slate-500">
                                  <span>{String(baselineLabels[0] ?? "Start")}</span>
                                  <span>{String(baselineLabels[baselineLabels.length - 1] ?? "Now")}</span>
                                </div>
                              </div>
                            )}
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                              <div className="text-[11px] font-medium text-slate-500">Total revenue</div>
                              <div className="mt-1 text-base font-bold text-white">Tsh {totalT.toLocaleString()}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                              <div className="text-[11px] font-medium text-slate-500">Average / point</div>
                              <div className="mt-1 text-base font-bold text-white">Tsh {averageRevenue.toLocaleString()}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                              <div className="text-[11px] font-medium text-slate-500">Active {pointLabel}</div>
                              <div className="mt-1 text-base font-bold text-white">{activePoints} / {baselineLabels.length}</div>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.035] p-3">
                              <div className="text-[11px] font-medium text-slate-500">Commission mix</div>
                              <div className="mt-1 text-base font-bold text-white">{commissionShare}%</div>
                            </div>
                          </div>
                        </>
                      );
                    })()
                  )}
                </div>
              </section>

              <section className="col-span-12 lg:col-span-5 overflow-hidden rounded-3xl border border-white/10 bg-[#111827]">
                <div className="p-5 sm:p-6 border-b border-white/10 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">Recent activities</div>
                    <div className="text-xs text-slate-400">Latest changes</div>
                  </div>
                </div>
                <div className="p-3">
                  {(() => {
                    const loading = recentActivities === null;
                    const hasItems = Array.isArray(recentActivities) && recentActivities.length > 0;

                    if (loading) {
                      return (
                        <ul className="list-none divide-y divide-white/10 rounded-2xl border border-white/10 bg-[#0d1524] p-2">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <li key={i} className="py-3 px-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex-1">
                                  <div className="h-3 bg-white/10 rounded w-40 animate-pulse mb-2" />
                                  <div className="h-2 bg-white/10 rounded w-56 animate-pulse" />
                                </div>
                                <div className="h-3 bg-white/10 rounded w-20 animate-pulse" />
                              </div>
                            </li>
                          ))}
                        </ul>
                      );
                    }

                    if (!hasItems) {
                      return <div className="px-3 py-4 text-sm text-slate-400">No recent activities</div>;
                    }

                    return (
                      <ul className="list-none divide-y divide-white/10 rounded-2xl border border-white/10 bg-[#0d1524] p-2">
                        {recentActivities!.slice(0, 5).map((a: any) => {
                          const tone = auditTone(a.action);
                          const detailsText = formatAuditDetails(a.action, a.details);

                          return (
                            <li
                              key={a.id ?? `${a.action}-${a.createdAt ?? ""}`}
                              className="rounded-xl px-3 py-2.5"
                            >
                              <div className="flex items-start gap-3">
                                <div className={"mt-1.5 h-2 w-2 rounded-full shrink-0 " + tone.dot} aria-hidden />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <span className="text-sm font-semibold text-white leading-snug">
                                      {formatAuditAction(a.action)}
                                    </span>
                                    <RelativeTime iso={a.createdAt} />
                                  </div>
                                  {detailsText ? (
                                    <div className="text-xs text-slate-400 mt-0.5 break-words">{detailsText}</div>
                                  ) : null}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </section>


              <section className="col-span-12 rounded-3xl border border-white/10 bg-white/5 shadow-[0_20px_80px_-60px_rgba(0,0,0,0.9)] overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold text-white">Operations snapshot</div>
                    <div className="text-xs text-slate-400">Live distribution (totals)</div>
                  </div>
                  <div className="text-xs text-slate-300">
                    Total: <span className="font-semibold text-white tabular-nums">{opsSnapshot.total.toLocaleString()}</span>
                  </div>
                </div>

                <div className="p-5 sm:p-6 grid grid-cols-12 gap-6 items-center">
                  {/* --- NoLSAF Revenue Visa Card --- */}
                  <div className="col-span-12 sm:col-span-5 lg:col-span-4">
                    <div
                      className="relative rounded-[22px] overflow-hidden shadow-2xl hover:-translate-y-1.5 transition-all duration-500 cursor-default select-none"
                      style={{
                        background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)",
                        minHeight: "230px",
                        boxShadow: "0 28px 65px -15px rgba(2,102,94,0.50), 0 8px 22px -8px rgba(14,42,122,0.55)",
                      }}
                    >
                      {/* Decorative SVG layer */}
                      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 380 260" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden>
                        {/* Big arcs top-right */}
                        <circle cx="360" cy="55"  r="155" stroke="white" strokeOpacity="0.07" strokeWidth="1" fill="none" />
                        <circle cx="360" cy="55"  r="115" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none" />
                        <circle cx="325" cy="25"  r="88"  stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
                        {/* Bottom-left arc */}
                        <circle cx="22"  cy="238" r="100" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
                        {/* Sparkline wave */}
                        <polyline
                          points="18,215 55,190 95,202 135,172 175,182 215,152 255,162 295,132 335,144 375,112"
                          stroke="white" strokeOpacity="0.15" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round"
                        />
                        <polygon
                          points="18,215 55,190 95,202 135,172 175,182 215,152 255,162 295,132 335,144 375,112 380,260 18,260"
                          fill="white" fillOpacity="0.03"
                        />
                        {/* Sparkline dots */}
                        {([[55,190],[135,172],[215,152],[295,132],[375,112]] as [number,number][]).map(([cx,cy],i) => (
                          <circle key={i} cx={cx} cy={cy} r="2.5" fill="white" fillOpacity="0.25" />
                        ))}
                        {/* NFC arcs top-right */}
                        <path d="M357 22 Q368 35 357 48" stroke="white" strokeOpacity="0.55" strokeWidth="2" fill="none" strokeLinecap="round" />
                        <path d="M350 16 Q367 35 350 54" stroke="white" strokeOpacity="0.35" strokeWidth="2" fill="none" strokeLinecap="round" />
                        <path d="M343 10 Q366 35 343 60" stroke="white" strokeOpacity="0.18" strokeWidth="2" fill="none" strokeLinecap="round" />
                      </svg>

                      {/* Top sheen */}
                      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none" />

                      {/* Card content */}
                      <div className="relative flex flex-col justify-between p-5 pb-5" style={{ minHeight: "230px" }}>
                        {/* Row 1 - brand + chip */}
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-[10px] font-black uppercase tracking-[0.28em] text-white/50">NoLSAF</p>
                            <p className="text-sm font-black text-white tracking-wide leading-tight mt-0.5">Revenue Card</p>
                          </div>
                          {/* EMV Chip */}
                          <svg width="36" height="28" viewBox="0 0 38 30" fill="none" className="opacity-80 flex-shrink-0 mt-1" aria-hidden>
                            <rect x="1" y="1" width="36" height="28" rx="4" fill="#c8a84b" stroke="#a07830" strokeWidth="0.8" />
                            <rect x="1" y="10" width="36" height="10" fill="#b8983a" />
                            <rect x="13" y="1" width="12" height="28" fill="#b8983a" />
                            <rect x="13" y="10" width="12" height="10" fill="#a07830" />
                            <rect x="1" y="10" width="36" height="0.8" fill="#8a6820" />
                            <rect x="1" y="19.2" width="36" height="0.8" fill="#8a6820" />
                            <rect x="13" y="1" width="0.8" height="28" fill="#8a6820" />
                            <rect x="24.2" y="1" width="0.8" height="28" fill="#8a6820" />
                          </svg>
                        </div>

                        {/* Row 2 - total revenue hero */}
                        <div className="mt-3">
                          <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-white/45 mb-1.5">Total Platform Revenue</p>
                          <p
                            className="font-black text-white leading-none drop-shadow tabular-nums"
                            style={{ fontSize: "clamp(1.45rem, 3.2vw, 2rem)", letterSpacing: "-0.02em" }}
                          >
                            {formatTsh(totalCommission + totalSubscription)}
                          </p>
                        </div>

                        {/* Row 3 - breakdown + circles */}
                        <div className="mt-4 pt-3 border-t border-white/12 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <div>
                              <p className="text-[7px] font-bold uppercase tracking-widest text-white/40">Commission</p>
                              <p className="text-xs font-black text-white tabular-nums mt-0.5">{formatTsh(totalCommission)}</p>
                            </div>
                            <div className="w-px h-7 bg-white/15 flex-shrink-0" />
                            <div>
                              <p className="text-[7px] font-bold uppercase tracking-widest text-white/40">Subscription</p>
                              <p className="text-xs font-black text-white tabular-nums mt-0.5">{formatTsh(totalSubscription)}</p>
                            </div>
                            <div className="w-px h-7 bg-white/15 flex-shrink-0" />
                            <div className="inline-flex items-center gap-1.5">
                              <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                              </span>
                              <p className="text-[7px] font-bold text-white/60 uppercase tracking-wide">Live</p>
                            </div>
                          </div>

                          {/* Dual circles - Mastercard-style */}
                          <div className="flex -space-x-3 flex-shrink-0 ml-1">
                            <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: "radial-gradient(circle at 38% 38%, #2563eb, #0e2a7a)", opacity: 0.92 }} />
                            <div className="w-8 h-8 rounded-full flex-shrink-0" style={{ background: "radial-gradient(circle at 62% 38%, #02665e, #013f3a)", opacity: 0.80 }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-12 sm:col-span-7 lg:col-span-8">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {opsSnapshot.labels.map((label, i) => {
                        const value = opsSnapshot.values[i] ?? 0;
                        const pct = opsSnapshot.total > 0 ? Math.round((value / opsSnapshot.total) * 100) : 0;
                        return (
                          <div key={label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: opsSnapshot.colors[i] }}
                                  aria-hidden
                                />
                                <div className="text-sm font-semibold text-white truncate">{label}</div>
                              </div>
                              <div className="text-xs text-slate-200 tabular-nums">
                                {value.toLocaleString()} <span className="text-slate-400">({pct}%)</span>
                              </div>
                            </div>
                            <div className="mt-3 h-2 rounded-full bg-white/10 overflow-hidden">
                              <div
                                className="h-full rounded-full transition-[width] duration-700"
                                style={{ width: `${tilesInView ? pct : 0}%`, backgroundColor: opsSnapshot.colors[i] }}
                                aria-hidden
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>

              <section className="col-span-12 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl shadow-[0_20px_80px_-60px_rgba(0,0,0,0.9)] overflow-hidden">
                <div className="p-5 sm:p-6 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-sm font-semibold text-white">Operations Hub</div>
                    <div className="text-xs text-slate-400">Navigate every module instantly</div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500">
                    Live
                  </div>
                </div>

                <div
                  className="p-4 sm:p-5 grid grid-cols-12 gap-3"
                  ref={(node) => {
                    if (!node) return;
                    if (tilesInView) return;
                    if (typeof window === "undefined") return;
                    try {
                      const obs = new IntersectionObserver(
                        (entries) => {
                          if (entries.some((e) => e.isIntersecting)) {
                            setTilesInView(true);
                            obs.disconnect();
                          }
                        },
                        { threshold: 0.12 }
                      );
                      obs.observe(node);
                    } catch {
                      setTilesInView(true);
                    }
                  }}
                >
                  <NavTile
                    href="/admin/properties/previews"
                    title="Approvals"
                    description="Review new properties"
                    icon={CheckCircle2}
                    gradient="bg-[#0a2f2a]"
                    iconWrap="bg-[#123a34] border-emerald-500/20 text-emerald-100"
                    badge={monitoring ? monitoring.pendingApprovals : null}
                    className="col-span-12 sm:col-span-6 lg:col-span-4"
                    featured
                    progressGradient="from-emerald-500 to-emerald-500"
                    index={0}
                  />

                  <NavTile
                    href="/admin/payments"
                    title="Payments"
                    description="Payouts & settlements"
                    icon={CreditCard}
                    gradient="bg-[#0b3040]"
                    iconWrap="bg-[#123747] border-sky-500/20 text-sky-100"
                    badge={paymentsWaiting ?? null}
                    className="col-span-12 sm:col-span-6 lg:col-span-4"
                    featured
                    progressGradient="from-sky-500 to-sky-500"
                    index={1}
                  />

                  <NavTile
                    href="/admin/bookings"
                    title="Bookings"
                    description="Trips, status, issues"
                    icon={CalendarDays}
                    gradient="bg-[#102d4d]"
                    iconWrap="bg-[#173759] border-blue-500/20 text-blue-100"
                    badge={monitoring ? Math.round(bookingsAnimated) : null}
                    className="col-span-12 sm:col-span-6 lg:col-span-4"
                    featured
                    progressGradient="from-blue-500 to-blue-500"
                    index={2}
                  />

                  <NavTile
                    href="/admin/revenue"
                    title="Revenue"
                    description="Reports & breakdown"
                    icon={BarChart2}
                    gradient="bg-[#0d3040]"
                    iconWrap="bg-[#123746] border-cyan-500/20 text-cyan-100"
                    className="col-span-12 sm:col-span-6 lg:col-span-3"
                    index={3}
                    bottomSlot={
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between text-[10px] text-white/65">
                          <span>Commission</span>
                          <span className="font-semibold text-white/85 tabular-nums">{formatTsh(totalCommission)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-black/20 overflow-hidden">
                          <div className="h-full rounded-full bg-sky-500 transition-[width] duration-700"
                            style={{ width: tilesInView && (totalCommission + totalSubscription) > 0 ? `${Math.round((totalCommission / (totalCommission + totalSubscription)) * 100)}%` : "50%" }} />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-white/65 mt-0.5">
                          <span>Subscription</span>
                          <span className="font-semibold text-white/85 tabular-nums">{formatTsh(totalSubscription)}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-black/20 overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-700"
                            style={{ width: tilesInView && (totalCommission + totalSubscription) > 0 ? `${Math.round((totalSubscription / (totalCommission + totalSubscription)) * 100)}%` : "50%" }} />
                        </div>
                      </div>
                    }
                  />

                  <NavTile
                    href="/admin/properties"
                    title="Properties"
                    description="Manage listings"
                    icon={Building2}
                    gradient="bg-[#0c332c]"
                    iconWrap="bg-[#123b33] border-emerald-500/20 text-emerald-100"
                    className="col-span-12 sm:col-span-6 lg:col-span-3"
                    index={4}
                    bottomSlot={
                      <div className="flex items-center gap-3">
                        <MiniRing
                          percent={Math.min(100, Math.round(100 * (1 - Math.exp(-((monitoring?.activeSessions ?? 0) + (pendingApprovalsValue ?? 0)) / 12))))}
                          color="rgba(52,211,153,0.9)"
                          size={50}
                        />
                        <div className="text-[11px] leading-tight">
                          <div className="font-extrabold text-white tabular-nums">{monitoring?.activeSessions ?? 0}</div>
                          <div className="text-white/60 mt-0.5">Active sessions</div>
                        </div>
                      </div>
                    }
                  />

                  <NavTile
                    href="/admin/analytics"
                    title="Analytics"
                    description="Trends & performance"
                    icon={LineChart}
                    gradient="bg-[#26343f]"
                    iconWrap="bg-[#303f4a] border-slate-500/20 text-slate-100"
                    className="col-span-12 sm:col-span-6 lg:col-span-3"
                    index={5}
                    bottomSlot={
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] text-white/65">Signals</div>
                        <MiniDotTrend
                          values={makeSpark(bookingsValue + pendingApprovalsValue + 9, 16)}
                          color="rgba(147,197,253,0.92)"
                          width={88}
                          height={26}
                        />
                      </div>
                    }
                  />

                  <NavTile
                    href="/admin/messages"
                    title="Messages"
                    description="Inbox & communication"
                    icon={MessagesSquare}
                    gradient="bg-[#172f4f]"
                    iconWrap="bg-[#203a5b] border-blue-500/20 text-blue-100"
                    className="col-span-12 sm:col-span-6 lg:col-span-3"
                    index={6}
                    bottomSlot={
                      <div className="flex items-center gap-3">
                        <div className="text-[11px] leading-tight">
                          <span className="font-extrabold text-white tabular-nums">{usersNewValue}</span>
                          <span className="text-white/55 ml-1">new this week</span>
                        </div>
                      </div>
                    }
                  />
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

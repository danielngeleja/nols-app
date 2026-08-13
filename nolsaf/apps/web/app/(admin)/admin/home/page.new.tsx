"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  Activity,
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

const KPI_TONES = {
  emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
  sky: "border-sky-100 bg-sky-50 text-sky-700",
  blue: "border-blue-100 bg-blue-50 text-blue-700",
  amber: "border-amber-100 bg-amber-50 text-amber-700",
  violet: "border-violet-100 bg-violet-50 text-violet-700",
} as const;

type Tone = keyof typeof KPI_TONES;

/** Solid progress-bar fill per tone. Solid, not a gradient: a two-stop gradient
 *  on a 6px bar reads as noise rather than as a value. */
const TONE_BAR: Record<Tone, string> = {
  emerald: "bg-emerald-600",
  sky: "bg-sky-600",
  blue: "bg-blue-600",
  amber: "bg-amber-600",
  violet: "bg-violet-600",
};

/**
 * Operations summary tile. Number and label only: the sparklines, donut rings and
 * share percentages this replaced encoded no real series, they were generated from
 * a seed, so they implied trend information the dashboard does not actually have.
 */
function KpiCard({
  label,
  detail,
  tone,
  Icon,
  value,
  ready,
}: {
  label: string;
  detail: string;
  tone: keyof typeof KPI_TONES;
  Icon: any;
  value: string;
  ready: boolean;
}) {
  return (
    // border-solid is required on every bordered element: preflight is disabled
    // and nothing sets border-style, so a bare `border` utility renders nothing.
    <div className="group min-w-0 rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_36px_-28px_rgba(15,23,42,0.22)] transition duration-200 hover:border-neutral-300 hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_24px_46px_-28px_rgba(15,23,42,0.28)]">
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 min-w-0 truncate text-[11px] font-bold uppercase tracking-[0.06em] text-neutral-500">{label}</p>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid ${KPI_TONES[tone]}`}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>
      {ready ? (
        <p className="m-0 mt-3.5 truncate text-[2rem] font-bold leading-none tabular-nums tracking-tight text-neutral-950">{value}</p>
      ) : (
        <div className="mt-3.5 h-8 w-16 animate-pulse rounded-lg bg-neutral-100" />
      )}
      {ready ? (
        <p className="mb-0 mt-2 truncate text-xs font-medium text-neutral-500">{detail}</p>
      ) : (
        <div className="mt-3 h-3 w-24 animate-pulse rounded bg-neutral-100" />
      )}
    </div>
  );
}

/**
 * Performance highlight card. The right-hand visual each of these used to carry
 * was not real: three were makeSpark() trend lines from a seed, and two were
 * MiniMeter bars showing 1 - exp(-value / k), a saturation curve rendered under
 * a "Performance %" label. Both are dropped in favour of the actual figures.
 */
function HighlightCard({
  href,
  label,
  value,
  meta,
  icon: Icon,
  tone,
  primary,
  secondary,
  footnote,
  className,
}: {
  href: string;
  label: string;
  value: string;
  meta?: string;
  icon: any;
  tone: Tone;
  primary: string;
  secondary: string;
  footnote: string;
  className?: string;
}) {
  const isEmptyValue = !value || value.trim() === "" || value.trim() === "--";
  return (
    <Link
      href={href}
      className={`group flex h-full flex-col rounded-2xl border border-solid border-neutral-200 bg-white p-5 no-underline shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_36px_-28px_rgba(15,23,42,0.22)] transition duration-200 hover:border-neutral-300 hover:no-underline hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_24px_46px_-28px_rgba(15,23,42,0.28)] ${className ?? ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 min-w-0 text-[11px] font-bold uppercase tracking-[0.06em] text-neutral-500">{label}</p>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid ${KPI_TONES[tone]}`}>
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      </div>

      <p
        className={`mb-0 mt-2 truncate text-lg font-bold leading-tight tracking-tight ${
          isEmptyValue ? "font-medium text-neutral-400" : "text-neutral-950"
        }`}
      >
        {isEmptyValue ? "No data yet" : value}
      </p>
      {meta ? <p className="mb-0 mt-1 truncate text-xs font-medium text-neutral-500">{meta}</p> : null}

      {/* mt-auto pins the figures to the card floor, so a label that wraps to two
          lines cannot make this card taller than its neighbours. */}
      <div className="mt-auto border-0 border-t border-solid border-neutral-100 pt-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-2xl font-bold leading-none tabular-nums text-neutral-950">{primary}</span>
          <span className="min-w-0 text-xs font-medium text-neutral-500">{secondary}</span>
        </div>
        <p className="mb-0 mt-2 text-xs text-neutral-400">{footnote}</p>
      </div>
    </Link>
  );
}

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

export default function AdminHomePage() {
  const router = useRouter();

  const { socket } = useSocket(undefined, { enabled: true, joinDriverRoom: false });

  const { monitoring } = useAdminMonitoring();
  const { recentActivities, refresh: refreshRecentActivities } = useAdminRecentActivities();
  const { driversPending, usersNew, paymentsWaiting } = useAdminHomeKpis();
  const { highlights } = useAdminPerformanceHighlights(30);

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

  // One segmented control, one active style. The three tabs previously used three
  // different accent colours (emerald / yellow / blue), which read as three
  // unrelated controls rather than one range switch.
  const revenueRangeTabClass = (tab: "hours" | "months" | "properties") => {
    const isActive = rangeType === tab;
    const base =
      "appearance-none px-3 py-1.5 rounded-lg text-xs font-bold border border-solid " +
      "transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/25 ";

    const selected = {
      active: "border-neutral-200 bg-white text-neutral-900 shadow-[0_1px_2px_rgba(15,23,42,0.06)]",
      inactive: "border-transparent bg-transparent text-neutral-500 hover:text-neutral-900",
    };

    const variants = {
      hours: selected,
      months: selected,
      properties: selected,
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

    if (!rel) return <span className="shrink-0 text-xs text-neutral-400">&nbsp;</span>;
    return (
      <time title={abs} className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-neutral-400">
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
        dot: "bg-emerald-600",
        pill: "border-emerald-100 bg-emerald-50 text-emerald-700",
      };
    }
    if (a.startsWith("INVOICE_") || a.includes("PAYMENT")) {
      return {
        dot: "bg-sky-600",
        pill: "border-sky-100 bg-sky-50 text-sky-700",
      };
    }
    if (a.includes("USER") || a.includes("OWNER") || a.includes("DRIVER")) {
      return {
        dot: "bg-blue-600",
        pill: "border-blue-100 bg-blue-50 text-blue-700",
      };
    }
    return {
      dot: "bg-neutral-400",
      pill: "border-neutral-200 bg-neutral-50 text-neutral-700",
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
    // One colour per metric, matching the KPI tile tone for the same metric above
    // (emerald, sky, blue, amber, violet). Solid 600-level values: the previous
    // set used alpha, and slate-400 at 0.70 was invisible on a white surface.
    const colors = [
      "#059669",
      "#0284c7",
      "#2563eb",
      "#d97706",
      "#7c3aed",
    ];

    return { labels, values, total, colors };
  }, [bookingsValue, driversPendingValue, paymentsWaitingValue, pendingApprovalsValue, usersNewValue]);

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
    tone: Tone;
    badge?: number | string | null;
    seriesValues?: number[];
    seriesStroke?: string;
    className?: string;
    featured?: boolean;
    bottomSlot?: React.ReactNode;
  };

  function NavTile({
    href,
    title,
    description,
    icon: Icon,
    tone,
    badge,
    seriesValues,
    seriesStroke,
    className,
    featured,
    index,
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
        <div className="relative h-full overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_36px_-28px_rgba(15,23,42,0.22)] motion-safe:transition motion-safe:duration-200 group-hover:border-neutral-300 group-hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_24px_46px_-28px_rgba(15,23,42,0.28)]">
          <div className={"relative " + (featured ? "min-h-[132px] p-4" : "min-h-[112px] p-4")}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={
                    "flex shrink-0 items-center justify-center rounded-xl border border-solid " +
                    (featured ? "h-10 w-10" : "h-9 w-9") +
                    " " +
                    KPI_TONES[tone]
                  }
                >
                  <Icon className={featured ? "h-[18px] w-[18px]" : "h-4 w-4"} aria-hidden />
                </span>

                <div className="min-w-0">
                  <div
                    className={
                      (featured ? "text-base" : "text-sm") +
                      " font-bold tracking-tight text-neutral-950 leading-tight min-w-0 " +
                      "[display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden"
                    }
                  >
                    {title}
                  </div>
                  <div className="mt-1 min-w-0 overflow-hidden text-xs font-medium leading-snug text-neutral-500 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]">
                    {description}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {showBadge ? (
                  <span className={`flex h-6 min-w-6 items-center justify-center rounded-full border border-solid px-1.5 text-[11px] font-bold tabular-nums ${KPI_TONES[tone]}`}>
                    {badgeLabel}
                  </span>
                ) : null}

                <ChevronRight
                  className="h-4 w-4 text-neutral-400 motion-safe:transition motion-safe:duration-200 group-hover:translate-x-0.5 group-hover:text-emerald-600"
                  aria-hidden
                />
              </div>
            </div>

            {progressPct !== null ? (
              <div className="mt-4 flex items-center gap-3">
                <span className="text-[11px] font-medium text-neutral-500">Activity</span>
                <div className="min-w-0 flex-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className={`h-full rounded-full ${TONE_BAR[tone]} transition-[width] duration-700`}
                      style={{ width: `${tilesInView ? progressPct : 0}%` }}
                      aria-hidden
                    />
                  </div>
                </div>
                <span className="text-[11px] font-bold tabular-nums text-neutral-700">{progressPct}%</span>
              </div>
            ) : null}

            {bottomSlot ? (
              <div className="mt-3.5">{bottomSlot}</div>
            ) : showSparkline ? (
              <div className="mt-4 flex items-center justify-between gap-3">
                <span className="text-[11px] font-medium text-neutral-500">Trend</span>
                <MiniSparkline
                  values={seriesValues!}
                  stroke={seriesStroke ?? "#059669"}
                  width={84}
                  height={24}
                />
              </div>
            ) : null}
          </div>
        </div>
      </Link>
    );
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
    <div id="admin-home" className="relative min-h-screen bg-neutral-50 text-neutral-900">
      <style>{`
        #admin-home,
        #admin-home * {
          box-sizing: border-box;
        }
      `}</style>
      {/* No max-width here: the admin shell is fluid (see admin-soft-ui.css), so a
          cap at this level would re-centre the content and reintroduce the gutters.
          Horizontal padding deliberately mirrors AdminOperationalFooter's
          `px-3 sm:px-4` so the section cards line up with the footer's edges. */}
      <div className="relative w-full min-w-0 px-3 py-6 sm:px-4">
        <div className="grid grid-cols-12 gap-5">
          <main className="col-span-12 min-w-0">
            {/* No page hero here. AdminSiteHeader carries the identity block and a
                primary tab row that already names Approvals, Payments, Bookings and
                Revenue, so a hero repeated all of it and pushed the KPI tiles
                ~150px down a pane that is already height-capped. */}
            <div className="grid grid-cols-12 gap-5">
              <section className="col-span-12" aria-label="Operations summary">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <KpiCard
                    label="Approvals"
                    detail="Listings to review"
                    tone="emerald"
                    Icon={CheckCircle2}
                    ready={Boolean(monitoring)}
                    value={Math.round(pendingApprovalsAnimated).toLocaleString()}
                  />
                  <KpiCard
                    label="Payments"
                    detail="Payouts and settlements"
                    tone="sky"
                    Icon={CreditCard}
                    ready={paymentsWaiting != null}
                    value={Math.round(paymentsWaitingAnimated).toLocaleString()}
                  />
                  <KpiCard
                    label="Bookings"
                    detail="In the current window"
                    tone="blue"
                    Icon={CalendarDays}
                    ready={Boolean(monitoring)}
                    value={Math.round(bookingsAnimated).toLocaleString()}
                  />
                  <KpiCard
                    label="Drivers"
                    detail="Awaiting verification"
                    tone="amber"
                    Icon={Truck}
                    ready={driversPending != null}
                    value={String(driversPending ?? 0)}
                  />
                  <KpiCard
                    label="New users"
                    detail="Recently joined"
                    tone="violet"
                    Icon={Users}
                    ready={usersNew != null}
                    value={String(usersNew ?? 0)}
                  />
                </div>
              </section>

              <section className="col-span-12" aria-label="Performance highlights">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-emerald-100 bg-emerald-50 text-emerald-700">
                      <Sparkles className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 className="m-0 text-sm font-bold text-neutral-950">Performance highlights</h2>
                      <p className="mb-0 mt-0.5 text-xs font-medium text-neutral-500">
                        Top performers in the last {highlights?.windowDays ?? 30} days
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full border border-solid border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-bold text-neutral-600">
                    Best of NoLSAF
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <HighlightCard
                    href="/admin/properties/previews"
                    label="Best property type"
                    value={highlights?.bestPropertyType?.type ?? "--"}
                    icon={Building2}
                    tone="emerald"
                    primary={(highlights?.bestPropertyType?.bookings ?? 0).toLocaleString()}
                    secondary={`bookings, ${(highlights?.bestPropertyType?.interactions ?? 0).toLocaleString()} interactions`}
                    footnote="Bookings plus saves and reviews"
                  />

                  <HighlightCard
                    href={highlights?.bestDriver?.driverId ? `/admin/drivers/audit/${highlights.bestDriver.driverId}` : "/admin/drivers"}
                    label="Best driver"
                    value={highlights?.bestDriver?.name ?? "--"}
                    icon={Truck}
                    tone="amber"
                    primary={formatTsh(highlights?.bestDriver?.nolsRevenue ?? 0)}
                    secondary={`${(highlights?.bestDriver?.bookings ?? 0).toLocaleString()} bookings`}
                    footnote="Commission from approved and paid invoices"
                  />

                  <HighlightCard
                    href={highlights?.bestOwner?.ownerId ? `/admin/owners/${highlights.bestOwner.ownerId}` : "/admin/owners"}
                    label="Best owner"
                    value={highlights?.bestOwner?.name ?? "--"}
                    icon={Briefcase}
                    tone="violet"
                    primary={formatTsh(highlights?.bestOwner?.nolsRevenue ?? 0)}
                    secondary={`${(highlights?.bestOwner?.bookings ?? 0).toLocaleString()} bookings`}
                    footnote="Owner whose bookings earned most commission"
                  />

                  <HighlightCard
                    href="/admin/bookings"
                    label="Most booked region"
                    value={highlights?.mostBookedRegion?.regionName ?? "--"}
                    icon={MapPin}
                    tone="sky"
                    primary={(highlights?.mostBookedRegion?.bookings ?? 0).toLocaleString()}
                    secondary="bookings"
                    footnote="Region with highest check-ins"
                  />

                  <HighlightCard
                    href={
                      highlights?.topProperty?.propertyId
                        ? `/admin/properties/previews?previewId=${highlights.topProperty.propertyId}`
                        : "/admin/properties/previews"
                    }
                    className="md:col-span-2 xl:col-span-1"
                    label="Top property"
                    value={highlights?.topProperty?.title ?? "--"}
                    meta={highlights?.topProperty ? `${highlights.topProperty.type}, ${highlights.topProperty.regionName}` : undefined}
                    icon={LayoutDashboard}
                    tone="blue"
                    primary={(highlights?.topProperty?.bookings ?? 0).toLocaleString()}
                    secondary={`bookings, ${(highlights?.topProperty?.interactions ?? 0).toLocaleString()} interactions`}
                    footnote="Signals: check-ins, saves and reviews"
                  />
                </div>
              </section>

              <section className="col-span-12 lg:col-span-7 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_36px_-28px_rgba(15,23,42,0.22)]" aria-label="Revenue analytics">
                <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-emerald-100 bg-emerald-50 text-emerald-700">
                      <LineChart className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 className="m-0 text-sm font-bold text-neutral-950">Revenue analytics</h2>
                      <p className="mb-0 mt-0.5 text-xs font-medium text-neutral-500">Commission and subscription series</p>
                    </div>
                  </div>
                  <div className="scrollbar-hide flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 touch-pan-x">
                    <div className="inline-flex shrink-0 rounded-xl border border-solid border-neutral-200 bg-neutral-50 p-1">
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
                      className="inline-flex shrink-0 appearance-none items-center whitespace-nowrap rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/25"
                    >
                      View details
                    </button>

                    {rangeType === "hours" && (
                      <select
                        title="Hours range"
                        aria-label="Hours range"
                        className="shrink-0 whitespace-nowrap appearance-none rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-neutral-300"
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
                        className="shrink-0 whitespace-nowrap appearance-none rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition hover:border-neutral-300"
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
                    <div className="py-10 text-center text-sm font-medium text-neutral-400">Loading revenue data…</div>
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
                          <div className="rounded-2xl border border-solid border-neutral-200 bg-neutral-50 p-4 sm:p-5">
                            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-bold text-neutral-950">Revenue performance</div>
                                <div className="mt-0.5 text-xs font-medium text-neutral-500">
                                  {rangeType === "properties" ? `Top ${propertiesCount} properties ranked by revenue` : `Commission and subscriptions across ${pointLabel}`}
                                </div>
                              </div>
                              <div className="flex items-center gap-3 text-[11px] font-medium text-neutral-600">
                                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-600" />Commission</span>
                                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-600" />Subscription</span>
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
                                              borderColor: borderColor ?? "rgba(82,82,82,0.9)",
                                              backgroundColor: backgroundColor ?? "rgba(15,23,42,0.12)",
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
                                      grid: { color: "rgba(15,23,42,0.08)", drawTicks: false },
                                      ticks: { display: false },
                                    },
                                    x: {
                                      border: { display: false },
                                      grid: { display: false },
                                      ticks: {
                                        color: "rgba(82,82,82,0.9)",
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
                              <div className="relative flex h-full flex-col justify-end overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white px-4 pb-8 pt-5">
                                <div className="pointer-events-none absolute inset-x-4 top-1/4 border-0 border-t border-dashed border-neutral-200" />
                                <div className="pointer-events-none absolute inset-x-4 top-1/2 border-0 border-t border-dashed border-neutral-200" />
                                <div className="pointer-events-none absolute inset-x-4 top-3/4 border-0 border-t border-dashed border-neutral-200" />
                                <div className="absolute inset-x-0 top-[38%] px-4 text-center">
                                  <div className="text-sm font-bold text-neutral-700">Revenue baseline ready</div>
                                  <div className="mt-1 text-xs font-medium text-neutral-500">The line will rise when commission or subscription revenue is posted.</div>
                                </div>
                                <div className="relative flex items-center">
                                  {baselineLabels.map((label, index) => (
                                    <div key={`${String(label)}-${index}`} className="flex min-w-0 flex-1 items-center">
                                      <span className="h-2 w-2 shrink-0 rounded-full border-2 border-solid border-neutral-300 bg-white" />
                                      {index < baselineLabels.length - 1 && <span className="h-px min-w-0 flex-1 bg-neutral-200" />}
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-3 flex justify-between text-[10px] font-medium text-neutral-400">
                                  <span>{String(baselineLabels[0] ?? "Start")}</span>
                                  <span>{String(baselineLabels[baselineLabels.length - 1] ?? "Now")}</span>
                                </div>
                              </div>
                            )}
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                            <div className="rounded-xl border border-solid border-neutral-200 bg-white p-3">
                              <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-neutral-500">Total revenue</div>
                              <div className="mt-1.5 text-base font-bold tabular-nums text-neutral-950">Tsh {totalT.toLocaleString()}</div>
                            </div>
                            <div className="rounded-xl border border-solid border-neutral-200 bg-white p-3">
                              <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-neutral-500">Average / point</div>
                              <div className="mt-1.5 text-base font-bold tabular-nums text-neutral-950">Tsh {averageRevenue.toLocaleString()}</div>
                            </div>
                            <div className="rounded-xl border border-solid border-neutral-200 bg-white p-3">
                              <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-neutral-500">Active {pointLabel}</div>
                              <div className="mt-1.5 text-base font-bold tabular-nums text-neutral-950">{activePoints} / {baselineLabels.length}</div>
                            </div>
                            <div className="rounded-xl border border-solid border-neutral-200 bg-white p-3">
                              <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-neutral-500">Commission mix</div>
                              <div className="mt-1.5 text-base font-bold tabular-nums text-neutral-950">{commissionShare}%</div>
                            </div>
                          </div>
                        </>
                      );
                    })()
                  )}
                </div>
              </section>

              <section className="col-span-12 lg:col-span-5 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_36px_-28px_rgba(15,23,42,0.22)]" aria-label="Recent activities">
                <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-violet-100 bg-violet-50 text-violet-700">
                      <Activity className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 className="m-0 text-sm font-bold text-neutral-950">Recent activities</h2>
                      <p className="mb-0 mt-0.5 text-xs font-medium text-neutral-500">Latest changes</p>
                    </div>
                  </div>
                  <Link
                    href="/admin/management/audit-log"
                    className="shrink-0 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-xs font-bold text-neutral-700 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 hover:no-underline"
                  >
                    View all
                  </Link>
                </div>
                <div className="p-3">
                  {(() => {
                    const loading = recentActivities === null;
                    const hasItems = Array.isArray(recentActivities) && recentActivities.length > 0;

                    if (loading) {
                      return (
                        <ul className="m-0 list-none divide-y divide-solid divide-neutral-100 rounded-xl border border-solid border-neutral-200 bg-white p-0">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <li key={i} className="py-3 px-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex-1">
                                  <div className="mb-2 h-3 w-40 animate-pulse rounded bg-neutral-100" />
                                  <div className="h-2 w-56 animate-pulse rounded bg-neutral-100" />
                                </div>
                                <div className="h-3 w-20 animate-pulse rounded bg-neutral-100" />
                              </div>
                            </li>
                          ))}
                        </ul>
                      );
                    }

                    if (!hasItems) {
                      return <div className="px-3 py-6 text-center text-sm font-medium text-neutral-400">No recent activities</div>;
                    }

                    return (
                      <ul className="m-0 list-none divide-y divide-solid divide-neutral-100 rounded-xl border border-solid border-neutral-200 bg-white p-0">
                        {recentActivities!.slice(0, 5).map((a: any) => {
                          const tone = auditTone(a.action);
                          const detailsText = formatAuditDetails(a.action, a.details);

                          return (
                            <li
                              key={a.id ?? `${a.action}-${a.createdAt ?? ""}`}
                              className="px-4 py-3"
                            >
                              <div className="flex items-start gap-3">
                                <div className={"mt-1.5 h-2 w-2 rounded-full shrink-0 " + tone.dot} aria-hidden />
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-start justify-between gap-3">
                                    <span className="text-sm font-bold leading-snug text-neutral-900">
                                      {formatAuditAction(a.action)}
                                    </span>
                                    <RelativeTime iso={a.createdAt} />
                                  </div>
                                  {detailsText ? (
                                    <div className="mt-1 break-words text-xs font-medium text-neutral-500">{detailsText}</div>
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


              <section className="col-span-12 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_36px_-28px_rgba(15,23,42,0.22)]" aria-label="Operations snapshot">
                <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-emerald-100 bg-emerald-50 text-emerald-700">
                      <BarChart2 className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 className="m-0 text-sm font-bold text-neutral-950">Operations snapshot</h2>
                      <p className="mb-0 mt-0.5 text-xs font-medium text-neutral-500">Live distribution across open work</p>
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full border border-solid border-neutral-200 bg-neutral-50 px-3 py-1 text-xs font-bold text-neutral-600">
                    Total <span className="tabular-nums text-neutral-950">{opsSnapshot.total.toLocaleString()}</span>
                  </div>
                </div>

                <div className="grid grid-cols-12 items-stretch gap-5 p-5 sm:p-6">
                  {/* Platform revenue. Deliberately plain: the previous version was a
                      simulated payment card (EMV chip, NFC arcs, dual circles) which
                      implied a real card product that does not exist. */}
                  <div className="col-span-12 lg:col-span-4">
                    <div className="flex h-full min-h-[14rem] flex-col justify-between rounded-2xl border border-solid border-emerald-950/70 bg-[#082f2a] p-5 shadow-[0_14px_34px_rgba(8,47,42,0.18)]">
                      <div className="min-w-0">
                        <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100/50">Total platform revenue</p>
                        <p className="mb-0 mt-2.5 truncate text-[2rem] font-bold leading-none tabular-nums tracking-tight text-white">
                          {formatTsh(totalCommission + totalSubscription)}
                        </p>
                      </div>

                      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-white/10">
                        <div className="min-w-0 bg-[#082f2a] px-3.5 py-3">
                          <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-100/50">Commission</p>
                          <p className="mb-0 mt-1 truncate text-sm font-bold tabular-nums text-white">{formatTsh(totalCommission)}</p>
                        </div>
                        <div className="min-w-0 bg-[#082f2a] px-3.5 py-3">
                          <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-100/50">Subscription</p>
                          <p className="mb-0 mt-1 truncate text-sm font-bold tabular-nums text-white">{formatTsh(totalSubscription)}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-100/60">Live</span>
                      </div>
                    </div>
                  </div>

                  <div className="col-span-12 lg:col-span-8">
                    <div className="h-full overflow-hidden rounded-2xl border border-solid border-neutral-200">
                      {opsSnapshot.labels.map((label, i) => {
                        const value = opsSnapshot.values[i] ?? 0;
                        const pct = opsSnapshot.total > 0 ? Math.round((value / opsSnapshot.total) * 100) : 0;
                        return (
                          <div
                            key={label}
                            className={`px-4 py-3 ${i > 0 ? "border-0 border-t border-solid border-neutral-100" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: opsSnapshot.colors[i] }}
                                  aria-hidden
                                />
                                <span className="truncate text-sm font-bold text-neutral-800">{label}</span>
                              </div>
                              <div className="shrink-0 tabular-nums">
                                <span className="text-sm font-bold text-neutral-950">{value.toLocaleString()}</span>
                                <span className="ml-1.5 text-xs font-medium text-neutral-500">{pct}%</span>
                              </div>
                            </div>
                            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-neutral-100">
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

              <section className="col-span-12 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_36px_-28px_rgba(15,23,42,0.22)]" aria-label="Operations hub">
                <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4 sm:px-6">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-solid border-emerald-100 bg-emerald-50 text-emerald-700">
                      <LayoutDashboard className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 className="m-0 text-sm font-bold text-neutral-950">Operations hub</h2>
                      <p className="mb-0 mt-0.5 text-xs font-medium text-neutral-500">Jump to any module</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 rounded-full border border-solid border-neutral-200 bg-neutral-50 px-3 py-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
                    <span className="text-xs font-bold text-neutral-600">Live</span>
                  </div>
                </div>

                <div
                  className="grid grid-cols-12 gap-4 p-5 sm:p-6"
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
                    tone="emerald"
                    badge={monitoring ? monitoring.pendingApprovals : null}
                    className="col-span-12 sm:col-span-6 lg:col-span-4"
                    featured
                    index={0}
                  />

                  <NavTile
                    href="/admin/payments"
                    title="Payments"
                    description="Payouts & settlements"
                    icon={CreditCard}
                    tone="sky"
                    badge={paymentsWaiting ?? null}
                    className="col-span-12 sm:col-span-6 lg:col-span-4"
                    featured
                    index={1}
                  />

                  <NavTile
                    href="/admin/bookings"
                    title="Bookings"
                    description="Trips, status, issues"
                    icon={CalendarDays}
                    tone="blue"
                    badge={monitoring ? Math.round(bookingsAnimated) : null}
                    className="col-span-12 sm:col-span-6 lg:col-span-4"
                    featured
                    index={2}
                  />

                  <NavTile
                    href="/admin/revenue"
                    title="Revenue"
                    description="Reports & breakdown"
                    icon={BarChart2}
                    tone="emerald"
                    className="col-span-12 sm:col-span-6 lg:col-span-3"
                    index={3}
                    bottomSlot={
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-neutral-500">Commission</span>
                          <span className="text-xs font-bold tabular-nums text-neutral-900">{formatTsh(totalCommission)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                          <div className="h-full rounded-full bg-sky-600 transition-[width] duration-700"
                            style={{ width: tilesInView && (totalCommission + totalSubscription) > 0 ? `${Math.round((totalCommission / (totalCommission + totalSubscription)) * 100)}%` : "0%" }} />
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-neutral-500">Subscription</span>
                          <span className="text-xs font-bold tabular-nums text-neutral-900">{formatTsh(totalSubscription)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
                          <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-700"
                            style={{ width: tilesInView && (totalCommission + totalSubscription) > 0 ? `${Math.round((totalSubscription / (totalCommission + totalSubscription)) * 100)}%` : "0%" }} />
                        </div>
                      </div>
                    }
                  />

                  <NavTile
                    href="/admin/properties"
                    title="Properties"
                    description="Manage listings"
                    icon={Building2}
                    tone="blue"
                    className="col-span-12 sm:col-span-6 lg:col-span-3"
                    index={4}
                    bottomSlot={
                      // The donut ring here showed 1 - exp(-(sessions + approvals) / 12),
                      // a saturation curve that is not a percentage of anything. Dropped
                      // in favour of the real session count.
                      <div className="flex items-baseline gap-2">
                        <span className="text-xl font-bold leading-none tabular-nums text-neutral-950">{monitoring?.activeSessions ?? 0}</span>
                        <span className="text-[11px] font-medium text-neutral-500">Active sessions</span>
                      </div>
                    }
                  />

                  <NavTile
                    href="/admin/analytics"
                    title="Analytics"
                    description="Trends & performance"
                    icon={LineChart}
                    tone="violet"
                    className="col-span-12 sm:col-span-6 lg:col-span-3"
                    index={5}
                    // The "Signals" trend line here was makeSpark(), a seeded generator,
                    // so it showed a shape unrelated to any analytics data. Removed
                    // rather than replaced: there is no real series available here.
                  />

                  <NavTile
                    href="/admin/messages"
                    title="Messages"
                    description="Inbox & communication"
                    icon={MessagesSquare}
                    tone="sky"
                    className="col-span-12 sm:col-span-6 lg:col-span-3"
                    index={6}
                    // Previously rendered `usersNewValue` as "N new this week" on the
                    // Messages tile. That is the new-user count, not a message count, so
                    // it was mislabelled. Removed until a real unread count is available.
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

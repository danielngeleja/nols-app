"use client";

// "Mother of all revenue": a single, READ-ONLY view that rolls up every
// NoLSAF revenue stream (accommodation, tours, transport, group stay,
// subscriptions) into one command view. It does not collect or mutate
// anything; each stream is still owned by its own page.
// Sources: GET /api/admin/finance/overview?from=&to= and /overview/series.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Car,
  CreditCard,
  Gauge,
  KeyRound,
  Lock,
  Map as MapIcon,
  Minus,
  Radar,
  RefreshCw,
  Send,
  ShieldCheck,
  Timer,
  Users,
  Waypoints,
  Zap,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type StreamKey = "accommodation" | "tours" | "transport" | "groupStay" | "subscriptions";

type StreamSummary = {
  key: StreamKey;
  label: string;
  gmv: number;
  nolsafRevenue: number;
  partnerNet: number;
  realizedCount: number;
  pendingRevenue: number;
  pendingCount: number;
  note?: string;
};

type Overview = {
  ok: boolean;
  baseCurrency: string;
  range: { from: string | null; to: string | null; allTime: boolean };
  totals: { gmv: number; nolsafRevenue: number; partnerNet: number; realizedCount: number; pendingRevenue: number; pendingCount: number };
  streams: StreamSummary[];
  margin?: Margin;
  generatedAt: string;
};

/** NoLSAF's own margin (lib/platformMargin.ts on the API). */
type Margin = {
  revenue: number;
  takeRatePercent: number | null;
  costs: Array<{ key: string; label: string; amount: number; count: number; basis: "RECORDED" | "STATEMENTS" | "ESTIMATE" | "MISSING"; note?: string }>;
  recordedCosts: number;
  contribution: number;
  contributionMarginPercent: number | null;
  operating: Array<{ key: string; label: string; amount: number; count: number }>;
  operatingTotal: number;
  net: number;
  netMarginPercent: number | null;
  atRisk: { payoutRecovery: number; payoutRecoveryCount: number };
  notRecorded: Array<{ key: string; label: string; detail: string }>;
};

const STREAM_META: Record<StreamKey, { icon: any; color: string; href: string | null }> = {
  accommodation: { icon: Building2, color: "#34d399", href: "/admin/revenue" },
  tours: { icon: MapIcon, color: "#38bdf8", href: "/admin/agents/tour-revenue" },
  transport: { icon: Car, color: "#fbbf24", href: "/admin/drivers/invoices" },
  groupStay: { icon: Users, color: "#a78bfa", href: "/admin/group-stays/revenue" },
  subscriptions: { icon: CreditCard, color: "#2dd4bf", href: "/admin/nrms/billing" },
};

type SeriesPoint = { start: string; end: string; revenue: number; gmv: number; partnerNet: number; count: number };
type PeriodKey = "all" | "30d" | "month" | "quarter" | "year";
const PERIODS: Array<{ key: PeriodKey; label: string; short: string }> = [
  { key: "month", label: "This month", short: "Month" },
  { key: "30d", label: "Last 30 days", short: "30 days" },
  { key: "quarter", label: "This quarter", short: "Quarter" },
  { key: "year", label: "This year", short: "Year" },
  { key: "all", label: "All time", short: "All time" },
];

// Current window plus the equal-length window right before it, for comparison.
function periodRange(key: PeriodKey, now = new Date()): { from: Date; to: Date; prevFrom: Date; prevTo: Date } | null {
  if (key === "all") return null;
  const to = now;
  let from: Date;
  if (key === "30d") from = new Date(now.getTime() - 30 * 86400000);
  else if (key === "month") from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (key === "quarter") from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  else from = new Date(now.getFullYear(), 0, 1);
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - span);
  return { from, to, prevFrom, prevTo };
}

/** The chart's window and bucket: days for a month, weeks for a quarter, months for a year or all time (last 12). */
function chartRange(key: PeriodKey, now = new Date()) {
  const r = periodRange(key, now);
  if (!r) {
    const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    return { from, to: now, prevFrom: null as Date | null, prevTo: null as Date | null, bucket: "month" as const };
  }
  const bucket = key === "quarter" ? ("week" as const) : key === "year" ? ("month" as const) : ("day" as const);
  return { from: r.from, to: r.to, prevFrom: r.prevFrom, prevTo: r.prevTo, bucket };
}

const NF = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v || 0);
const pct = (v: number | null) => (v == null ? "n/a" : `${v.toFixed(1)}%`);

function delta(current: number, previous: number | undefined): number | null {
  if (previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

// ── Building blocks ──────────────────────────────────────────────────────

const glass = "min-w-0 rounded-lg border border-solid border-[#284540] bg-[#182c28]";
const eyebrow = "m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8fb5ad]";

function DeltaChip({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null) return null;
  const flat = Math.abs(value) < 0.5;
  const good = invert ? value < 0 : value > 0;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ring-inset ${flat ? "bg-white/[0.04] text-slate-400 ring-white/10" : good ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25" : "bg-rose-400/10 text-rose-300 ring-rose-400/25"}`}>
      <Icon className="h-3 w-3" />
      {flat ? "0%" : `${Math.abs(value).toFixed(value >= 100 ? 0 : 1)}%`}
    </span>
  );
}

/** Smooth path through points: horizontal-tangent cubic curves, so it never overshoots. */
function smoothPath(pts: Array<[number, number]>) {
  if (!pts.length) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
}

function GlowChart({ points, ghost, bucket, money }: { points: SeriesPoint[] | null; ghost: SeriesPoint[] | null; bucket: "day" | "week" | "month"; money: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 1000;
  const H = 240;
  const PAD_T = 22;
  const PAD_B = 8;
  if (!points) return <div className="h-[240px] w-full animate-pulse rounded-md bg-[#13241f]" />;
  if (!points.length) {
    return (
      <div className="grid h-[240px] w-full place-items-center rounded-md border border-dashed border-white/10">
        <span className="text-xs text-slate-500">The chart could not load. Refresh to try again.</span>
      </div>
    );
  }
  const values = points.map((p) => p.revenue);
  const ghostValues = (ghost ?? []).map((p) => p.revenue);
  const max = Math.max(1, ...values, ...ghostValues);
  const n = points.length;
  const x = (i: number, count = n) => (count <= 1 ? W / 2 : (i / (count - 1)) * W);
  const y = (v: number) => PAD_T + (1 - v / max) * (H - PAD_T - PAD_B);
  const line = smoothPath(points.map((p, i) => [x(i), y(p.revenue)]));
  const area = `${line} L${x(n - 1)},${H} L${x(0)},${H} Z`;
  const ghostLine = ghost && ghost.length > 1 ? smoothPath(ghost.map((p, i) => [x(i, ghost.length), y(p.revenue)])) : "";
  const empty = values.every((v) => v === 0);
  const label = (p: SeriesPoint) =>
    bucket === "month"
      ? new Date(`${p.start}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" })
      : new Date(`${p.start}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const ticks = n <= 1 ? [0] : Array.from(new Set([0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(((n - 1) * 3) / 4), n - 1]));
  const hp = hover != null ? points[hover] : null;

  return (
    <div>
      <div
        className="relative h-[240px] w-full"
        onMouseMove={(e) => {
          if (empty) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - rect.left) / rect.width) * (n - 1)))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label="NoLSAF revenue over the period">
          <defs>
            <linearGradient id="cc-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="cc-stroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#5eead4" />
            </linearGradient>
          </defs>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1="0" x2={W} y1={PAD_T + f * (H - PAD_T - PAD_B)} y2={PAD_T + f * (H - PAD_T - PAD_B)} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
          ))}
          {ghostLine ? <path d={ghostLine} fill="none" stroke="rgba(148,163,184,0.45)" strokeWidth="1.5" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" /> : null}
          {!empty ? <path d={area} fill="url(#cc-fill)" /> : null}
          <path d={line} fill="none" stroke={empty ? "rgba(94,234,212,0.35)" : "url(#cc-stroke)"} strokeWidth="2.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hp ? <line x1={x(hover!)} x2={x(hover!)} y1={0} y2={H} stroke="rgba(94,234,212,0.35)" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
        </svg>

        {empty ? (
          <span className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${(x(n - 1) / W) * 100}%`, top: `${(y(0) / H) * 100}%` }}>
            <span className="block h-2.5 w-2.5 rounded-full border-2 border-solid border-[#182c28] bg-[#5eead4]" />
          </span>
        ) : null}

        {hp ? (
          <>
            <span className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-solid border-[#182c28] bg-emerald-300" style={{ left: `${(x(hover!) / W) * 100}%`, top: `${(y(hp.revenue) / H) * 100}%` }} />
            <div className="pointer-events-none absolute top-0 z-10 w-52 -translate-x-1/2 rounded-md border border-solid border-[#2f524b] bg-[#0f1f1b] px-3.5 py-2.5 shadow-lg" style={{ left: `clamp(6.5rem, ${(x(hover!) / W) * 100}%, calc(100% - 6.5rem))` }}>
              <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300/70">{bucket === "week" ? `Week of ${label(hp)}` : label(hp)}</p>
              <p className="m-0 mt-1 text-lg font-bold tabular-nums text-white">{money(hp.revenue)}</p>
              <p className="m-0 mt-1 text-[11px] text-slate-400">GMV {money(hp.gmv)} · {hp.count} paid</p>
              {ghost?.[hover!] ? <p className="m-0 text-[11px] text-slate-500">Period before {money(ghost[hover!].revenue)}</p> : null}
            </div>
          </>
        ) : null}
      </div>
      <div className="relative mt-2 h-4 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
        {ticks.map((i) => (
          <span key={i} className="absolute whitespace-nowrap" style={{ left: `${(x(i) / W) * 100}%`, transform: i === 0 ? "none" : i === n - 1 ? "translateX(-100%)" : "translateX(-50%)" }}>{label(points[i])}</span>
        ))}
      </div>
    </div>
  );
}

/** Take rate on a 240° dial, scaled to 30%. */
function TakeGauge({ value, previous }: { value: number | null; previous: number | null }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const sweep = C * (240 / 360);
  const shown = value == null ? 0 : Math.min(1, value / 30);
  return (
    <div className="relative mx-auto h-40 w-40">
      <svg viewBox="0 0 140 140" className="h-full w-full rotate-[150deg]">
        <defs>
          <linearGradient id="cc-gauge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#5eead4" />
          </linearGradient>
        </defs>
        <circle cx="70" cy="70" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${sweep} ${C}`} />
        {shown > 0 ? <circle cx="70" cy="70" r={R} fill="none" stroke="url(#cc-gauge)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${sweep * shown} ${C}`} /> : null}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">Take rate</span>
        <span className={`text-3xl font-bold tabular-nums ${value == null ? "text-slate-600" : "text-white"}`}>{value == null ? "n/a" : `${value.toFixed(1)}%`}</span>
        {value != null && previous != null ? (
          <span className={`text-[11px] font-bold tabular-nums ${value - previous >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{value - previous >= 0 ? "+" : ""}{(value - previous).toFixed(1)} pts</span>
        ) : (
          <span className="text-[11px] text-slate-500">of GMV kept</span>
        )}
      </div>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────

export default function AdminFinancePage() {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [data, setData] = useState<Overview | null>(null);
  const [previous, setPrevious] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [series, setSeries] = useState<SeriesPoint[] | null>(null);
  const [prevSeries, setPrevSeries] = useState<SeriesPoint[] | null>(null);
  const router = useRouter();

  const load = useCallback(async (key: PeriodKey) => {
    setLoading(true);
    setError(null);
    try {
      const range = periodRange(key);
      const current = apiClient.get("/api/admin/finance/overview", { params: range ? { from: range.from.toISOString(), to: range.to.toISOString() } : {} });
      const prior = range
        ? apiClient.get("/api/admin/finance/overview", { params: { from: range.prevFrom.toISOString(), to: range.prevTo.toISOString() } }).catch(() => null)
        : Promise.resolve(null);
      const [cur, prev] = await Promise.all([current, prior]);
      setData(cur.data as Overview);
      setPrevious(prev ? (prev.data as Overview) : null);
      setLocked(false);
      // The chart loads after the figures, so the page never waits on it.
      const chart = chartRange(key);
      setSeries(null);
      setPrevSeries(null);
      const fetchSeries = (from: Date, to: Date) =>
        apiClient.get("/api/admin/finance/overview/series", { params: { from: from.toISOString(), to: to.toISOString(), bucket: chart.bucket } }).then((r) => (r.data?.points ?? []) as SeriesPoint[]).catch(() => null);
      void Promise.all([fetchSeries(chart.from, chart.to), chart.prevFrom ? fetchSeries(chart.prevFrom, chart.prevTo!) : Promise.resolve(null)]).then(([a, b]) => {
        setSeries(a ?? []);
        setPrevSeries(b);
      });
    } catch (e: any) {
      if (e?.response?.status === 403 && e?.response?.data?.require2fa) {
        // Never keep previously loaded figures on screen once the grant has lapsed.
        setData(null);
        setPrevious(null);
        setLocked(true);
        return;
      }
      setError(e?.response?.data?.error || e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(period); }, [load, period]);

  // Reload as soon as the finance OTP is verified in the admin shell's grant dialog.
  useEffect(() => {
    const onGranted = () => { void load(period); };
    window.addEventListener("finance-grant-granted", onGranted);
    return () => window.removeEventListener("finance-grant-granted", onGranted);
  }, [load, period]);

  const currency = data?.baseCurrency || "TZS";
  const money = (v: number) => `${currency} ${NF.format(Math.round(v || 0))}`;
  const totals = data?.totals;
  const prevTotals = previous?.totals;
  const takeRate = totals && totals.gmv > 0 ? (totals.nolsafRevenue / totals.gmv) * 100 : null;
  const prevTakeRate = prevTotals && prevTotals.gmv > 0 ? (prevTotals.nolsafRevenue / prevTotals.gmv) * 100 : null;

  const streams = useMemo(() => [...(data?.streams || [])].sort((a, b) => b.nolsafRevenue - a.nolsafRevenue), [data?.streams]);
  const prevByKey = useMemo(() => new Map((previous?.streams || []).map((s) => [s.key, s])), [previous?.streams]);

  // Plain-language signals derived from the numbers on screen.
  const signals = useMemo(() => {
    if (!totals || !streams.length) return [];
    const out: Array<{ tone: "up" | "down" | "info" | "warn"; text: string }> = [];
    const top = streams[0];
    if (top && totals.nolsafRevenue > 0) out.push({ tone: "info", text: `${top.label} earns ${((top.nolsafRevenue / totals.nolsafRevenue) * 100).toFixed(0)}% of NoLSAF revenue.` });
    const byRate = streams.filter((s) => s.gmv > 0).map((s) => ({ s, rate: (s.nolsafRevenue / s.gmv) * 100 })).sort((a, b) => b.rate - a.rate);
    if (byRate.length > 1) out.push({ tone: "info", text: `Best take rate: ${byRate[0].s.label} at ${byRate[0].rate.toFixed(1)}%. Lowest: ${byRate[byRate.length - 1].s.label} at ${byRate[byRate.length - 1].rate.toFixed(1)}%.` });
    if (totals.pendingRevenue > 0) out.push({ tone: "warn", text: `${money(totals.pendingRevenue)} is still in the pipeline across ${totals.pendingCount} item${totals.pendingCount === 1 ? "" : "s"}.` });
    if (previous) {
      const movers = streams.map((s) => ({ s, d: s.nolsafRevenue - (prevByKey.get(s.key)?.nolsafRevenue ?? 0) })).filter((m) => Math.abs(m.d) > 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      if (movers[0]) out.push({ tone: movers[0].d > 0 ? "up" : "down", text: `${movers[0].s.label} is ${movers[0].d > 0 ? "up" : "down"} ${money(Math.abs(movers[0].d))} on the period before.` });
    }
    const idle = streams.filter((s) => s.realizedCount === 0);
    if (idle.length && idle.length < streams.length) out.push({ tone: "warn", text: `No revenue yet from ${idle.map((s) => s.label.toLowerCase()).join(", ")}.` });
    return out.slice(0, 4);
  }, [totals, streams, previous, prevByKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const periodLabel = PERIODS.find((p) => p.key === period)?.label || "All time";
  const margin = data?.margin ?? null;
  const prevMargin = previous?.margin ?? null;
  const range = periodRange(period);
  const bucket = chartRange(period).bucket;
  const periodPhrase = period === "month" ? "this month" : period === "30d" ? "in the last 30 days" : period === "quarter" ? "this quarter" : period === "year" ? "this year" : "since launch";
  const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
  const quiet = Boolean(totals && totals.nolsafRevenue === 0 && totals.gmv === 0 && totals.pendingRevenue === 0);
  const updated = data ? new Date(data.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) : null;

  // Canvas shared by every state.
  const canvas = (children: React.ReactNode) => (
    <div className="w-full min-w-0 rounded-xl bg-[#13241f] text-slate-100">
      <div className="space-y-4 p-3 sm:p-5">{children}</div>
    </div>
  );

  if (locked) {
    return canvas(
      <div className="grid min-h-[34rem] place-items-center">
        <div className={`${glass} w-full max-w-md p-7 text-center sm:p-8`}>
          <div className="relative mx-auto grid h-20 w-20 place-items-center">
            <span className="grid h-14 w-14 place-items-center rounded-lg bg-[#02665e] text-white"><Lock className="h-6 w-6" /></span>
          </div>
          <p className={`${eyebrow} mt-5 justify-center`}>Revenue command · locked</p>
          <h1 className="m-0 mt-2 text-xl font-bold tracking-tight text-white">Protected financial data</h1>
          <p className="m-0 mx-auto mt-2 max-w-xs text-xs leading-5 text-slate-400">Revenue and margins across every stream show after finance verification. Access lasts 15 minutes.</p>
          <ol className="m-0 mt-5 grid list-none grid-cols-3 gap-2 p-0 text-left">
            {[
              { icon: Send, title: "Code sent", text: "To your admin contact" },
              { icon: KeyRound, title: "6 digits", text: "Entered once" },
              { icon: Timer, title: "15 minutes", text: "Then it relocks" },
            ].map((step) => (
              <li key={step.title} className="rounded-md border border-solid border-[#284540] bg-[#13241f] px-2.5 py-2.5">
                <step.icon className="h-4 w-4 text-emerald-300" />
                <p className="m-0 mt-1.5 text-[11px] font-semibold text-white">{step.title}</p>
                <p className="m-0 text-[10px] leading-4 text-slate-500">{step.text}</p>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("finance-grant-required"))} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border-0 bg-emerald-400 text-sm font-semibold text-[#06201b] transition hover:bg-emerald-300">
            <KeyRound className="h-4 w-4" /> Verify to view
          </button>
          <button type="button" onClick={() => void load(period)} className="mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md border border-solid border-white/10 bg-transparent text-xs font-medium text-slate-400 transition hover:border-white/20 hover:text-white">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> I have verified, reload
          </button>
          <p className="m-0 mt-4 flex items-center justify-center gap-1.5 text-[10px] text-slate-600"><ShieldCheck className="h-3 w-3" /> Every unlock is recorded in the audit trail</p>
        </div>
      </div>,
    );
  }

  const meters = [
    { key: "gmv", label: "Guests paid", value: totals?.gmv ?? 0, prev: prevTotals?.gmv, color: "#38bdf8", hint: `${totals ? NF.format(totals.realizedCount) : 0} transactions` },
    { key: "partners", label: "To partners", value: totals?.partnerNet ?? 0, prev: prevTotals?.partnerNet, color: "#a78bfa", hint: "Owners, operators, drivers" },
    { key: "pending", label: "On its way", value: totals?.pendingRevenue ?? 0, prev: prevTotals?.pendingRevenue, color: "#fbbf24", hint: `${totals?.pendingCount ?? 0} in the pipeline` },
  ];
  const meterMax = Math.max(1, ...meters.map((m) => m.value));

  return canvas(
    <>
      {/* Command bar */}
      <div className="flex flex-wrap items-center gap-3 px-1 pt-1">
        <div className="mr-auto min-w-0">
          <p className={eyebrow}><Radar className="h-3.5 w-3.5" /> Revenue command</p>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <span className="inline-flex items-center gap-1.5 text-emerald-300"><span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" /> Live</span>
            <span className="text-slate-600">·</span>
            {range ? `${fmtDay(range.from)} to ${fmtDay(range.to)}` : "Since launch"}
            {updated ? <><span className="text-slate-600">·</span> updated {updated} EAT</> : null}
          </p>
        </div>
        <div className="inline-flex rounded-md border border-solid border-[#284540] bg-[#182c28] p-0.5" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={period === p.key} onClick={() => setPeriod(p.key)} className={`h-8 rounded border-0 px-3.5 text-xs font-semibold transition ${period === p.key ? "bg-emerald-400 text-[#06201b]" : "bg-transparent text-slate-400 hover:text-white"}`}>
              {p.short}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load(period)} disabled={loading} aria-label="Refresh" className="grid h-9 w-9 place-items-center rounded-md border border-solid border-[#284540] bg-[#182c28] text-slate-300 transition hover:border-emerald-300/40 hover:text-emerald-200 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {error && <div className="rounded-md border border-solid border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">Could not load the revenue view: {error}</div>}

      {/* Hero: the line, the dial and the meters */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className={`${glass} p-5 sm:p-6`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="m-0 text-xs font-semibold text-slate-400">NoLSAF kept {periodPhrase}</p>
              {loading && !data ? (
                <div className="mt-3 h-12 w-64 animate-pulse rounded-md bg-white/[0.05]" />
              ) : quiet ? (
                <>
                  <p className="m-0 mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">Awaiting the first payment</p>
                  <p className="m-0 mt-1 text-sm text-slate-400">
                    The line lights up the moment a guest pays.
                    {prevTotals && prevTotals.nolsafRevenue > 0 ? <> The period before brought in <b className="font-semibold text-emerald-300">{money(prevTotals.nolsafRevenue)}</b>.</> : null}
                  </p>
                </>
              ) : (
                <>
                  <p className="m-0 mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="flex items-baseline gap-2 whitespace-nowrap">
                      <span className="text-base font-bold text-slate-500">{currency}</span>
                      <span className="text-[44px] font-semibold leading-none tabular-nums tracking-tight text-white">{NF.format(Math.round(totals?.nolsafRevenue || 0))}</span>
                    </span>
                    {previous && totals && (totals.nolsafRevenue || prevTotals?.nolsafRevenue) ? <DeltaChip value={delta(totals.nolsafRevenue, prevTotals?.nolsafRevenue)} /> : null}
                  </p>
                  <p className="m-0 mt-1 text-sm text-slate-400">
                    {totals && totals.gmv > 0 ? <>From <b className="font-semibold text-slate-200">{money(totals.gmv)}</b> guests paid{prevTotals && prevTotals.nolsafRevenue ? <>, against {money(prevTotals.nolsafRevenue)} the period before</> : null}.</> : <>Nothing realized yet. <b className="font-semibold text-amber-300">{money(totals?.pendingRevenue ?? 0)}</b> is on its way.</>}
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-4 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded-full bg-gradient-to-r from-emerald-400 to-teal-300" /> {periodLabel}</span>
              {prevSeries && prevSeries.length > 1 ? <span className="inline-flex items-center gap-1.5"><span className="w-5 border-0 border-t border-dashed border-slate-400/60" /> Before</span> : null}
            </div>
          </div>
          <div className="mt-5">
            <GlowChart points={series} ghost={prevSeries} bucket={bucket} money={money} />
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <section className={`${glass} p-5`}>
            <p className={eyebrow}><Gauge className="h-3.5 w-3.5" /> Efficiency</p>
            <TakeGauge value={takeRate} previous={prevTakeRate} />
          </section>
          <section className={`${glass} space-y-4 p-5`}>
            <p className={eyebrow}><Activity className="h-3.5 w-3.5" /> Flow meters</p>
            {meters.map((m) => (
              <div key={m.key}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-400">{m.label}</span>
                  {previous && (m.value || m.prev) ? <DeltaChip value={delta(m.value, m.prev)} /> : null}
                </div>
                <p className={`m-0 mt-0.5 whitespace-nowrap text-lg font-bold tabular-nums ${m.value ? "text-white" : "text-slate-600"}`}>{m.value ? money(m.value) : "None yet"}</p>
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <span className="block h-full rounded-full transition-[width] duration-700" style={{ width: `${(m.value / meterMax) * 100}%`, background: m.color }} />
                </span>
                <p className="m-0 mt-1 text-[10px] text-slate-500">{m.hint}</p>
              </div>
            ))}
          </section>
        </div>
      </div>

      {/* Streams */}
      <section className={`${glass} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div>
            <p className={eyebrow}><Waypoints className="h-3.5 w-3.5" /> Streams</p>
            <p className="m-0 mt-1 text-sm text-slate-400">Ranked by what NoLSAF keeps. Open one for its own page.</p>
          </div>
          {takeRate != null ? <span className="rounded border border-solid border-[#284540] bg-[#13241f] px-2.5 py-1 text-[11px] font-semibold text-slate-300">Blended take rate <span className="text-emerald-300">{pct(takeRate)}</span></span> : null}
        </div>
        <ul className="m-0 grid list-none gap-px border-0 border-t border-solid border-[#284540] bg-[#284540] p-0 md:grid-cols-2 2xl:grid-cols-5">
          {loading && !data
            ? Array.from({ length: 5 }).map((_, i) => <li key={i} className="bg-[#182c28] p-5"><div className="h-24 animate-pulse rounded-md bg-white/[0.04]" /></li>)
            : streams.map((s) => {
                const meta = STREAM_META[s.key];
                const share = totals && totals.nolsafRevenue > 0 ? (s.nolsafRevenue / totals.nolsafRevenue) * 100 : 0;
                const rate = s.gmv > 0 ? (s.nolsafRevenue / s.gmv) * 100 : null;
                const prev = prevByKey.get(s.key);
                const open = meta.href ? () => router.push(meta.href!) : undefined;
                const idle = s.nolsafRevenue === 0 && s.gmv === 0;
                return (
                  <li key={s.key} className="bg-[#182c28]">
                    <div
                      role={open ? "link" : undefined}
                      tabIndex={open ? 0 : undefined}
                      onClick={open}
                      onKeyDown={(ev) => { if (open && ev.key === "Enter") open(); }}
                      className={`group relative h-full p-5 transition ${open ? "cursor-pointer hover:bg-[#13241f]" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="grid h-10 w-10 place-items-center rounded-md" style={{ background: `${meta.color}1f`, color: meta.color }}><meta.icon className="h-5 w-5" /></span>
                        {previous ? <DeltaChip value={delta(s.nolsafRevenue, prev?.nolsafRevenue)} /> : null}
                      </div>
                      <p className="m-0 mt-3 flex items-center gap-1 text-sm font-semibold text-white">{s.label}{open ? <ArrowUpRight className="h-3.5 w-3.5 text-slate-600 transition group-hover:text-slate-300" /> : null}</p>
                      <p className={`m-0 mt-1 whitespace-nowrap text-xl font-bold tabular-nums ${idle ? "text-slate-600" : "text-white"}`}>{idle ? "No activity" : money(s.nolsafRevenue)}</p>
                      <span className="mt-3 block h-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <span className="block h-full rounded-full" style={{ width: `${share}%`, background: meta.color }} />
                      </span>
                      <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-500">{share.toFixed(0)}% of revenue</span>
                        <span className={`font-semibold tabular-nums ${rate == null ? "text-slate-600" : takeRate != null && rate >= takeRate ? "text-emerald-300" : "text-amber-300"}`}>{rate == null ? "No GMV" : `${pct(rate)} take`}</span>
                      </div>
                      <dl className="m-0 mt-3 grid grid-cols-2 gap-2 border-0 border-t border-solid border-[#284540] pt-3 text-[11px]">
                        <div className="min-w-0"><dt className="text-slate-500">GMV</dt><dd className="m-0 truncate font-semibold tabular-nums text-slate-300">{compact(s.gmv)}</dd></div>
                        <div className="min-w-0"><dt className="text-slate-500">Pending</dt><dd className={`m-0 truncate font-semibold tabular-nums ${s.pendingRevenue > 0 ? "text-amber-300" : "text-slate-600"}`}>{s.pendingRevenue > 0 ? `${compact(s.pendingRevenue)} (${s.pendingCount})` : "None"}</dd></div>
                      </dl>
                    </div>
                  </li>
                );
              })}
        </ul>
      </section>

      {/* Margin as a linear bridge */}
      {margin && (() => {
        const steps: Array<{ key: string; label: string; amount: number; kind: "start" | "less" | "sub" | "end"; tag?: string }> = [
          { key: "revenue", label: "Revenue", amount: margin.revenue, kind: "start" },
          ...margin.costs.map((c) => ({ key: c.key, label: c.label, amount: c.amount, kind: "less" as const, tag: c.basis === "ESTIMATE" ? "est." : c.basis === "MISSING" ? "missing" : undefined })),
          { key: "contribution", label: "Contribution", amount: margin.contribution, kind: "sub" },
          ...margin.operating.filter((c) => c.count > 0 || c.amount !== 0).map((c) => ({ key: c.key, label: c.label, amount: c.amount, kind: "less" as const })),
          { key: "net", label: "Net", amount: margin.net, kind: "end" },
        ];
        // Running level for the floating bars.
        let level = 0;
        const bars = steps.map((st) => {
          let from: number;
          let to: number;
          if (st.kind === "less") { from = level; to = level - st.amount; level = to; }
          else { from = 0; to = st.amount; level = st.amount; }
          return { ...st, from, to };
        });
        const hi = Math.max(1, ...bars.map((b) => Math.max(b.from, b.to)));
        const lo = Math.min(0, ...bars.map((b) => Math.min(b.from, b.to)));
        const span = hi - lo || 1;
        const empty = margin.revenue === 0 && margin.recordedCosts === 0 && margin.operatingTotal === 0;
        return (
          <section className={`${glass} overflow-hidden`}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
              <div className="mr-auto min-w-0">
                <p className={eyebrow}><Zap className="h-3.5 w-3.5" /> Margin engine</p>
                <p className="m-0 mt-1 text-sm text-slate-400">From revenue, less what it costs to earn it, less running costs, to net.</p>
              </div>
              {[
                { label: "Contribution", value: margin.contributionMarginPercent, prev: prevMargin?.contributionMarginPercent },
                { label: "Net margin", value: margin.netMarginPercent, prev: prevMargin?.netMarginPercent },
              ].map((m) => (
                <div key={m.label} className="text-right">
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{m.label}</p>
                  <p className="m-0 flex items-baseline justify-end gap-1.5">
                    <span className={`text-xl font-bold tabular-nums ${m.value == null ? "text-slate-600" : m.value < 0 ? "text-rose-300" : "text-emerald-300"}`}>{pct(m.value)}</span>
                    {m.value != null && m.prev != null ? <span className={`text-[11px] font-bold tabular-nums ${m.value - m.prev >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{m.value - m.prev >= 0 ? "+" : ""}{(m.value - m.prev).toFixed(1)} pts</span> : null}
                  </p>
                </div>
              ))}
              <Link href="/admin/expenses" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-[#284540] bg-[#13241f] px-4 text-xs font-semibold text-slate-200 no-underline transition hover:border-emerald-300/40 hover:text-emerald-200 hover:no-underline">Expenses <ArrowUpRight className="h-3.5 w-3.5" /></Link>
            </div>

            <div className="grid gap-px border-0 border-t border-solid border-[#284540] bg-[#284540] lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="min-w-0 bg-[#182c28] px-5 py-5 sm:px-6">
                {empty ? (
                  <div className="grid h-32 place-items-center border border-dashed border-[#284540] text-center">
                    <p className="m-0 max-w-xs text-xs text-slate-500">No revenue or costs recorded {periodPhrase}. The bridge fills in as money comes in and expenses are booked.</p>
                  </div>
                ) : (
                  <ol className="m-0 list-none p-0">
                    {bars.map((b) => {
                      // Horizontal bridge: each bar sits where the running total stood.
                      const left = ((Math.min(b.from, b.to) - lo) / span) * 100;
                      const width = Math.max(0.6, (Math.abs(b.to - b.from) / span) * 100);
                      const total = b.kind !== "less";
                      const color = b.kind === "less" ? "#f87171" : b.to < 0 ? "#f87171" : b.kind === "end" ? "#5eead4" : "#34d399";
                      return (
                        <li key={b.key} className={`grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)_7.5rem] items-center gap-4 py-2 ${b.kind === "sub" || b.kind === "end" ? "border-0 border-t border-solid border-[#284540]" : ""}`}>
                          <span className={`truncate text-xs ${total ? "font-semibold text-slate-100" : "text-slate-400"}`} title={b.label}>
                            {b.kind === "less" ? <span className="text-slate-500">Less </span> : null}{b.kind === "less" ? b.label.toLowerCase() : b.label}
                            {b.tag ? <span className="ml-1 text-[10px] font-semibold text-amber-300">{b.tag}</span> : null}
                          </span>
                          <span className="relative block h-1.5 bg-[#13241f]">
                            {lo < 0 ? <span className="absolute inset-y-[-3px] w-px bg-slate-500/50" style={{ left: `${((0 - lo) / span) * 100}%` }} aria-hidden /> : null}
                            <span className="absolute inset-y-0" style={{ left: `${left}%`, width: `${width}%`, background: color, opacity: total ? 1 : 0.75 }} />
                          </span>
                          <span className={`whitespace-nowrap text-right text-xs tabular-nums ${b.kind === "less" ? "text-rose-300" : b.to < 0 ? "font-semibold text-rose-300" : total ? "font-semibold text-white" : "text-slate-300"}`}>
                            {b.kind === "less" ? (b.amount ? `- ${money(b.amount)}` : money(0)) : money(b.amount)}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              <div className="space-y-3 bg-[#182c28] p-5 sm:p-6">
                <div className="flex items-center justify-between rounded-md border border-solid border-[#284540] bg-[#13241f] px-4 py-3">
                  <span className="text-xs text-slate-400">Net result</span>
                  <span className={`whitespace-nowrap text-lg font-bold tabular-nums ${margin.net < 0 ? "text-rose-300" : "text-emerald-300"}`}>{money(margin.net)}</span>
                </div>
                <div className={`flex items-center justify-between rounded-md border border-solid px-4 py-3 ${margin.atRisk.payoutRecovery > 0 ? "border-amber-300/25 bg-amber-300/[0.06]" : "border-[#284540] bg-[#13241f]"}`}>
                  <span className="text-xs text-slate-400">At risk<span className="block text-[10px] text-slate-500">{margin.atRisk.payoutRecoveryCount} payout recover{margin.atRisk.payoutRecoveryCount === 1 ? "y" : "ies"} open</span></span>
                  <span className={`whitespace-nowrap text-base font-bold tabular-nums ${margin.atRisk.payoutRecovery > 0 ? "text-amber-300" : "text-slate-500"}`}>{money(margin.atRisk.payoutRecovery)}</span>
                </div>
                {margin.notRecorded.length > 0 ? (
                  <div className="rounded-md border border-dashed border-amber-300/30 px-4 py-3">
                    <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold text-amber-200"><AlertTriangle className="h-3.5 w-3.5" /> Not recorded yet, so net is lower</p>
                    <ul className="m-0 mt-1.5 list-none space-y-1 p-0">
                      {margin.notRecorded.map((item) => <li key={item.key} className="text-[11px] leading-snug text-slate-400"><span className="font-semibold text-slate-200">{item.label}.</span> {item.detail}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        );
      })()}

      {/* Signals */}
      {signals.length > 0 && (
        <section className={`${glass} p-5 sm:p-6`}>
          <p className={eyebrow}><Radar className="h-3.5 w-3.5" /> Signals</p>
          <ul className="m-0 mt-3 grid list-none gap-2 p-0 md:grid-cols-2">
            {signals.map((sig) => (
              <li key={sig.text} className="flex items-start gap-3 rounded-md border border-solid border-[#284540] bg-[#13241f] px-4 py-3 text-sm leading-snug text-slate-300">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sig.tone === "up" ? "bg-emerald-400" : sig.tone === "down" ? "bg-rose-400" : sig.tone === "warn" ? "bg-amber-300" : "bg-sky-300"}`} />
                {sig.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="m-0 px-1 pb-1 text-[10px] uppercase tracking-[0.16em] text-slate-600">
        Read only · money of record {currency} · take rate green above the blended rate, amber below
      </p>
    </>,
  );
}

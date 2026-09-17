"use client";

// "Mother of all revenue": a single, READ-ONLY view that rolls up every
// NoLSAF revenue stream (accommodation, tours, transport, group stay,
// subscriptions) into one set of KPIs. It does not collect or mutate anything;
// each stream is still owned by its own page. Source: GET /api/admin/finance/overview?from=&to=.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  Car,
  CreditCard,
  ExternalLink,
  HandCoins,
  Hourglass,
  KeyRound,
  Lightbulb,
  Lock,
  Map as MapIcon,
  Minus,
  RefreshCw,
  Send,
  ShieldCheck,
  Timer,
  TrendingUp,
  Users,
  Wallet,
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
  generatedAt: string;
};

const STREAM_META: Record<StreamKey, { icon: any; tone: string; color: string; href: string | null }> = {
  accommodation: { icon: Building2, tone: "text-emerald-300", color: "#34d399", href: "/admin/revenue" },
  tours: { icon: MapIcon, tone: "text-sky-300", color: "#38bdf8", href: "/admin/agents/tour-revenue" },
  transport: { icon: Car, tone: "text-amber-300", color: "#fbbf24", href: "/admin/drivers/invoices" },
  groupStay: { icon: Users, tone: "text-violet-300", color: "#a78bfa", href: "/admin/group-stays/revenue" },
  subscriptions: { icon: CreditCard, tone: "text-teal-300", color: "#2dd4bf", href: "/admin/nrms/billing" },
};

type PeriodKey = "all" | "30d" | "month" | "quarter" | "year";
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "month", label: "This month" },
  { key: "30d", label: "Last 30 days" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
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

const NF = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compact = (v: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v || 0);
const pct = (v: number | null) => (v == null ? "n/a" : `${v.toFixed(1)}%`);

function delta(current: number, previous: number | undefined): number | null {
  if (previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function DeltaChip({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null) return null;
  const flat = Math.abs(value) < 0.5;
  const good = invert ? value < 0 : value > 0;
  const Icon = flat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${flat ? "bg-white/[0.07] text-slate-300" : good ? "bg-emerald-400/15 text-emerald-300" : "bg-rose-400/15 text-rose-300"}`}>
      <Icon className="h-3 w-3" />
      {flat ? "0%" : `${Math.abs(value).toFixed(value >= 100 ? 0 : 1)}%`}
    </span>
  );
}

export default function AdminFinancePage() {
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [data, setData] = useState<Overview | null>(null);
  const [previous, setPrevious] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<StreamKey | null>(null);
  const router = useRouter();

  const [locked, setLocked] = useState(false);

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

  // Where GMV goes: platform take, partner payouts, and anything not yet split (taxes, fees, rounding).
  const flow = useMemo(() => {
    if (!totals || totals.gmv <= 0) return null;
    const take = Math.max(0, totals.nolsafRevenue);
    const partners = Math.max(0, totals.partnerNet);
    const other = Math.max(0, totals.gmv - take - partners);
    const base = take + partners + other || 1;
    return { take, partners, other, takePct: (take / base) * 100, partnersPct: (partners / base) * 100, otherPct: (other / base) * 100 };
  }, [totals]);

  // Revenue mix donut as a conic gradient.
  const donut = useMemo(() => {
    const total = streams.reduce((n, s) => n + Math.max(0, s.nolsafRevenue), 0);
    if (total <= 0) return { background: "conic-gradient(rgba(255,255,255,0.08) 0 100%)", total };
    let at = 0;
    const stops = streams.filter((s) => s.nolsafRevenue > 0).map((s) => {
      const start = at;
      at += (s.nolsafRevenue / total) * 100;
      const faded = focus && focus !== s.key;
      return `${faded ? "rgba(255,255,255,0.08)" : STREAM_META[s.key].color} ${start}% ${at}%`;
    });
    return { background: `conic-gradient(${stops.join(", ")})`, total };
  }, [streams, focus]);

  // Plain-language insights derived from the numbers on screen.
  const insights = useMemo(() => {
    if (!totals || !streams.length) return [];
    const out: string[] = [];
    const top = streams[0];
    if (top && totals.nolsafRevenue > 0) out.push(`${top.label} earns ${((top.nolsafRevenue / totals.nolsafRevenue) * 100).toFixed(0)}% of NoLSAF revenue.`);
    const byRate = streams.filter((s) => s.gmv > 0).map((s) => ({ s, rate: (s.nolsafRevenue / s.gmv) * 100 })).sort((a, b) => b.rate - a.rate);
    if (byRate.length > 1) out.push(`Best take rate: ${byRate[0].s.label} at ${byRate[0].rate.toFixed(1)}%. Lowest: ${byRate[byRate.length - 1].s.label} at ${byRate[byRate.length - 1].rate.toFixed(1)}%.`);
    if (totals.pendingRevenue > 0 && totals.nolsafRevenue > 0) out.push(`${money(totals.pendingRevenue)} is still in the pipeline, ${((totals.pendingRevenue / totals.nolsafRevenue) * 100).toFixed(0)}% on top of realized revenue.`);
    if (previous) {
      const movers = streams
        .map((s) => ({ s, d: s.nolsafRevenue - (prevByKey.get(s.key)?.nolsafRevenue ?? 0) }))
        .filter((m) => Math.abs(m.d) > 0)
        .sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
      if (movers[0]) out.push(`Biggest change vs previous period: ${movers[0].s.label} ${movers[0].d > 0 ? "up" : "down"} ${money(Math.abs(movers[0].d))}.`);
    }
    const idle = streams.filter((s) => s.realizedCount === 0);
    if (idle.length) out.push(`No realized revenue yet from ${idle.map((s) => s.label.toLowerCase()).join(", ")} in this period.`);
    return out.slice(0, 4);
  }, [totals, streams, previous, prevByKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const periodLabel = PERIODS.find((p) => p.key === period)?.label || "All time";
  const range = periodRange(period);

  const kpis = [
    { label: "NoLSAF revenue", sub: "Realized platform take", icon: TrendingUp, tone: "text-emerald-300", value: totals?.nolsafRevenue, prev: prevTotals?.nolsafRevenue },
    { label: "Total GMV", sub: `${totals ? NF.format(totals.realizedCount) : "0"} realized transactions`, icon: Wallet, tone: "text-sky-300", value: totals?.gmv, prev: prevTotals?.gmv },
    { label: "Paid to partners", sub: "Owners, operators, drivers", icon: HandCoins, tone: "text-violet-300", value: totals?.partnerNet, prev: prevTotals?.partnerNet },
    { label: "Pending revenue", sub: `${totals?.pendingCount ?? 0} in pipeline`, icon: Hourglass, tone: "text-amber-300", value: totals?.pendingRevenue, prev: prevTotals?.pendingRevenue },
  ];

  if (locked) {
    // The vault: the real page sits behind a redacted preview, so it is obvious what is being
    // protected and what unlocking will reveal. Decorative figures only, never live values.
    const redactedTiles = [
      { label: "NoLSAF revenue", icon: TrendingUp, tone: "text-emerald-300", bars: [70, 52, 88] },
      { label: "Total GMV", icon: Wallet, tone: "text-sky-300", bars: [45, 78, 60] },
      { label: "Paid to partners", icon: HandCoins, tone: "text-violet-300", bars: [62, 40, 75] },
      { label: "Pending revenue", icon: Hourglass, tone: "text-amber-300", bars: [38, 66, 50] },
    ];
    return (
      <div className="relative w-full min-w-0 overflow-hidden rounded-2xl bg-[#070B1C] text-slate-100">
        {/* Redacted page behind the glass */}
        <div className="pointer-events-none select-none p-4 blur-[6px] sm:p-6" aria-hidden>
          <div className="h-3 w-40 rounded-full bg-white/10" />
          <div className="mt-3 h-6 w-80 max-w-full rounded-full bg-white/[0.07]" />
          <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
            {redactedTiles.map((tile) => {
              const Icon = tile.icon;
              return (
                <div key={tile.label} className="rounded-2xl border border-solid border-white/10 bg-white/[0.04] p-4">
                  <div className="flex items-center gap-2 text-[11px] text-slate-400"><Icon className={`h-4 w-4 ${tile.tone}`} /> {tile.label}</div>
                  <div className="mt-2 flex items-end gap-1.5 tracking-[0.2em] text-slate-500">
                    <span className="text-[10px] font-bold">TZS</span>
                    <span className="text-xl font-bold">••••••</span>
                  </div>
                  <div className="mt-3 flex h-10 items-end gap-1">
                    {tile.bars.map((h, i) => <span key={i} className="flex-1 rounded-sm bg-white/10" style={{ height: `${h}%` }} />)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full">
            <div className="flex h-full w-full">
              <span className="h-full w-[13%] bg-teal-400/70" />
              <span className="h-full w-[78%] bg-violet-400/60" />
              <span className="h-full flex-1 bg-slate-500/50" />
            </div>
          </div>
          <div className="mt-5 space-y-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-solid border-white/5 bg-white/[0.03] px-4 py-3">
                <span className="h-7 w-7 rounded-lg bg-white/[0.07]" />
                <span className="h-3 w-32 rounded-full bg-white/10" />
                <span className="ml-auto h-3 w-24 rounded-full bg-white/[0.07]" />
              </div>
            ))}
          </div>
        </div>

        {/* Glass + vault card */}
        <div className="absolute inset-0 flex items-center justify-center bg-[#070B1C]/70 p-4 backdrop-blur-[2px]">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-solid border-white/10 bg-[#0a1024]/95 p-6 text-center shadow-[0_40px_80px_-30px_rgba(0,0,0,0.9)] sm:p-8">
            <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-teal-400/20 blur-3xl" aria-hidden />
            <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)", backgroundSize: "26px 26px" }} aria-hidden />

            <div className="relative mx-auto flex h-20 w-20 items-center justify-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-teal-400/10" aria-hidden />
              <span className="absolute inset-2 rounded-full border border-solid border-teal-400/20" aria-hidden />
              <span className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-300 to-teal-500 text-[#06121a] shadow-[0_12px_30px_-12px_rgba(45,212,191,0.8)]">
                <Lock className="h-6 w-6" />
              </span>
            </div>

            <p className="relative m-0 mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-300/80">Finance overview · Locked</p>
            <h1 className="relative m-0 mt-1.5 text-xl font-bold tracking-tight text-white">Protected financial data</h1>
            <p className="relative m-0 mx-auto mt-2 max-w-xs text-xs leading-5 text-slate-400">
              Platform revenue across every stream is shown only after finance verification.
            </p>

            <ol className="relative m-0 mt-5 grid list-none grid-cols-3 gap-2 p-0 text-left">
              {[
                { n: 1, icon: Send, title: "Code sent", text: "To your admin contact" },
                { n: 2, icon: KeyRound, title: "6 digits", text: "Entered once" },
                { n: 3, icon: Timer, title: "15 minutes", text: "Then it relocks" },
              ].map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.n} className="rounded-xl border border-solid border-white/10 bg-white/[0.04] px-2.5 py-2.5">
                    <Icon className="h-4 w-4 text-teal-300" />
                    <p className="m-0 mt-1.5 text-[11px] font-semibold text-white">{step.title}</p>
                    <p className="m-0 text-[10px] leading-4 text-slate-500">{step.text}</p>
                  </li>
                );
              })}
            </ol>

            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("finance-grant-required"))}
              className="relative mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-gradient-to-r from-teal-300 to-teal-500 text-sm font-bold text-[#06121a] transition hover:from-teal-200 hover:to-teal-400"
            >
              <KeyRound className="h-4 w-4" /> Verify to view
            </button>
            <button
              type="button"
              onClick={() => void load(period)}
              className="relative mt-2 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-solid border-white/10 bg-transparent text-xs font-medium text-slate-400 transition hover:border-white/20 hover:text-white"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> I have verified, reload
            </button>
            <p className="relative m-0 mt-4 flex items-center justify-center gap-1.5 text-[10px] text-slate-600">
              <ShieldCheck className="h-3 w-3" /> Every unlock is recorded in the admin audit trail
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 space-y-4 rounded-2xl bg-[#070B1C] p-3 text-slate-100 sm:space-y-5 sm:p-5">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="m-0 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-teal-300/80">
            <Wallet className="h-3 w-3" /> Finance overview
            <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-[9px] normal-case tracking-normal text-slate-300">Read only</span>
          </p>
          <h1 className="m-0 mt-1 text-lg font-bold tracking-tight text-white sm:text-xl">NoLSAF revenue across all streams</h1>
          <p className="m-0 mt-0.5 text-xs text-slate-400">
            {range
              ? `${range.from.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} to ${range.to.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}, compared with the period before`
              : "Everything recorded since launch"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-xl border border-solid border-white/10 bg-white/[0.04] p-1" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={period === p.key}
                onClick={() => setPeriod(p.key)}
                className={`h-8 rounded-lg border-0 px-3 text-xs font-semibold transition-colors ${period === p.key ? "bg-teal-400 text-[#06121a]" : "bg-transparent text-slate-400 hover:text-white"}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void load(period)} disabled={loading} className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-solid border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50" aria-label="Refresh">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-solid border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">Could not load the finance overview: {error}</div>}

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-solid border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.label} className="min-w-0 bg-[#0b1128] px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-400"><Icon className={`h-4 w-4 ${k.tone}`} /> {k.label}</span>
                {!loading && previous && k.value != null ? <DeltaChip value={delta(k.value, k.prev)} /> : null}
              </div>
              {loading && !data ? (
                <div className="mt-2 h-7 w-36 animate-pulse rounded bg-white/10" />
              ) : (
                <p className="m-0 mt-1.5 flex items-baseline gap-1.5 whitespace-nowrap">
                  <span className="text-[11px] font-bold text-slate-500">{currency}</span>
                  <span className="text-xl font-bold tabular-nums tracking-tight text-white">{NF.format(Math.round(k.value || 0))}</span>
                </p>
              )}
              <p className="m-0 mt-1 truncate text-[11px] text-slate-500">
                {k.sub}
                {previous && k.prev != null ? ` · was ${compact(k.prev)}` : ""}
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* Money flow */}
        <section className="min-w-0 rounded-2xl border border-solid border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="m-0 text-sm font-semibold text-white">Where every {currency} 100 of GMV goes</h2>
            <span className="inline-flex items-center gap-2 text-xs text-slate-400">
              Take rate <span className="text-base font-bold tabular-nums text-teal-300">{pct(takeRate)}</span>
              {previous && takeRate != null && prevTakeRate != null ? (
                <span className={`text-[11px] font-semibold tabular-nums ${takeRate - prevTakeRate >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                  {takeRate - prevTakeRate >= 0 ? "+" : ""}{(takeRate - prevTakeRate).toFixed(1)} pts
                </span>
              ) : null}
            </span>
          </div>
          {flow ? (
            <>
              <div className="mt-4 flex h-10 w-full overflow-hidden rounded-xl">
                <div className="flex items-center justify-center bg-teal-400 text-[11px] font-bold text-[#06121a]" style={{ width: `${flow.takePct}%` }} title={`NoLSAF ${money(flow.take)}`}>{flow.takePct >= 8 ? `${flow.takePct.toFixed(0)}` : ""}</div>
                <div className="flex items-center justify-center bg-violet-400/80 text-[11px] font-bold text-[#06121a]" style={{ width: `${flow.partnersPct}%` }} title={`Partners ${money(flow.partners)}`}>{flow.partnersPct >= 8 ? `${flow.partnersPct.toFixed(0)}` : ""}</div>
                {flow.otherPct > 0.5 && <div className="flex items-center justify-center bg-slate-500/60 text-[11px] font-bold text-white" style={{ width: `${flow.otherPct}%` }} title={`Not split ${money(flow.other)}`}>{flow.otherPct >= 8 ? `${flow.otherPct.toFixed(0)}` : ""}</div>}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {[
                  { label: "NoLSAF keeps", value: flow.take, share: flow.takePct, dot: "bg-teal-400" },
                  { label: "Partners receive", value: flow.partners, share: flow.partnersPct, dot: "bg-violet-400" },
                  { label: "Taxes, fees and unsplit", value: flow.other, share: flow.otherPct, dot: "bg-slate-500" },
                ].map((f) => (
                  <div key={f.label} className="min-w-0">
                    <p className="m-0 flex items-center gap-1.5 text-[11px] text-slate-400"><span className={`h-2 w-2 rounded-full ${f.dot}`} /> {f.label}</p>
                    <p className="m-0 mt-0.5 text-sm font-semibold tabular-nums text-white">{money(f.value)}</p>
                    <p className="m-0 text-[11px] tabular-nums text-slate-500">{currency} {f.share.toFixed(1)} of every 100</p>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="m-0 mt-4 text-sm text-slate-500">{loading ? "Loading…" : "No GMV recorded in this period."}</p>
          )}
        </section>

        {/* Revenue mix */}
        <section className="min-w-0 rounded-2xl border border-solid border-white/10 bg-white/[0.03] p-4 sm:p-5">
          <h2 className="m-0 text-sm font-semibold text-white">Revenue mix</h2>
          <div className="mt-3 flex items-center gap-5">
            <div className="relative h-32 w-32 flex-shrink-0 rounded-full transition-all" style={{ background: donut.background }} aria-hidden>
              <div className="absolute inset-[18%] flex flex-col items-center justify-center rounded-full bg-[#0a0f24] text-center">
                <span className="text-[10px] text-slate-500">{focus ? streams.find((s) => s.key === focus)?.label : "NoLSAF"}</span>
                <span className="text-sm font-bold tabular-nums text-white">{compact(focus ? streams.find((s) => s.key === focus)?.nolsafRevenue || 0 : donut.total)}</span>
              </div>
            </div>
            <ul className="m-0 min-w-0 flex-1 list-none space-y-1.5 p-0">
              {streams.map((s) => {
                const share = donut.total > 0 ? (Math.max(0, s.nolsafRevenue) / donut.total) * 100 : 0;
                return (
                  <li key={s.key} onMouseEnter={() => setFocus(s.key)} onMouseLeave={() => setFocus(null)} className={`flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-xs transition ${focus === s.key ? "bg-white/[0.06]" : ""}`}>
                    <span className="h-2.5 w-2.5 flex-shrink-0 rounded-sm" style={{ background: STREAM_META[s.key].color }} />
                    <span className="min-w-0 flex-1 truncate text-slate-300">{s.label}</span>
                    <span className="tabular-nums font-semibold text-white">{share.toFixed(0)}%</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      </div>

      {/* Insights */}
      {insights.length > 0 && (
        <section className="rounded-2xl border border-solid border-teal-400/20 bg-teal-400/[0.05] px-4 py-3 sm:px-5">
          <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-300"><Lightbulb className="h-3.5 w-3.5" /> What stands out · {periodLabel}</p>
          <ul className="m-0 mt-2 grid list-none gap-x-6 gap-y-1.5 p-0 md:grid-cols-2">
            {insights.map((line) => (
              <li key={line} className="flex gap-2 text-sm text-slate-200"><span className="mt-2 h-1 w-1 flex-shrink-0 rounded-full bg-teal-300" />{line}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Streams table */}
      <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-white/10 bg-white/[0.03]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 sm:px-5">
          <h2 className="m-0 text-sm font-semibold text-white">Revenue by stream</h2>
          <span className="text-xs text-slate-500">Ranked by NoLSAF take · click a stream to open its page</span>
        </div>
        <div className="overflow-x-auto border-0 border-t border-solid border-white/10">
          <table className="table w-full min-w-[1040px] border-collapse text-left text-sm">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                <th className="whitespace-nowrap px-4 py-2.5 font-semibold sm:pl-5">Stream</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">NoLSAF take</th>
                <th className="whitespace-nowrap px-4 py-2.5 font-semibold">Share</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">GMV</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">Take rate</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">Transactions</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold">Avg take</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right font-semibold sm:pr-5">Pending</th>
              </tr>
            </thead>
            <tbody>
              {loading && !data
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-0 border-t border-solid border-white/5"><td colSpan={8} className="px-5 py-3"><div className="h-6 animate-pulse rounded bg-white/5" /></td></tr>
                  ))
                : streams.map((s) => {
                    const meta = STREAM_META[s.key];
                    const Icon = meta.icon;
                    const share = totals && totals.nolsafRevenue > 0 ? (s.nolsafRevenue / totals.nolsafRevenue) * 100 : 0;
                    const rate = s.gmv > 0 ? (s.nolsafRevenue / s.gmv) * 100 : null;
                    const prev = prevByKey.get(s.key);
                    const avg = s.realizedCount > 0 ? s.nolsafRevenue / s.realizedCount : null;
                    const row = (
                      <>
                        <td className="px-4 py-3 sm:pl-5">
                          <span className="flex items-center gap-3">
                            <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ${meta.tone}`}><Icon className="h-4 w-4" /></span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-1.5 font-semibold text-white">{s.label}{meta.href && <ExternalLink className="h-3 w-3 text-slate-500" />}</span>
                              {s.note ? <span className="block truncate text-[11px] text-slate-500">{s.note}</span> : null}
                            </span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="block font-semibold tabular-nums text-white">{money(s.nolsafRevenue)}</span>
                          {previous ? <span className="mt-0.5 inline-block"><DeltaChip value={delta(s.nolsafRevenue, prev?.nolsafRevenue)} /></span> : null}
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2">
                            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full" style={{ width: `${share}%`, background: meta.color }} /></span>
                            <span className="w-10 text-xs tabular-nums text-slate-300">{share.toFixed(0)}%</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-300">{money(s.gmv)}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`tabular-nums font-semibold ${rate == null ? "text-slate-500" : takeRate != null && rate >= takeRate ? "text-emerald-300" : "text-amber-300"}`}>{pct(rate)}</span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-300">{NF.format(s.realizedCount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-300">{avg == null ? "n/a" : money(avg)}</td>
                        <td className="px-4 py-3 text-right sm:pr-5">
                          <span className={`block tabular-nums ${s.pendingRevenue > 0 ? "text-amber-300" : "text-slate-500"}`}>{s.pendingRevenue > 0 ? money(s.pendingRevenue) : "None"}</span>
                          {s.pendingCount > 0 ? <span className="text-[11px] text-slate-500">{s.pendingCount} open</span> : null}
                        </td>
                      </>
                    );
                    return meta.href ? (
                      <tr key={s.key} className="cursor-pointer border-0 border-t border-solid border-white/5 transition-colors hover:bg-white/[0.04]" onClick={() => router.push(meta.href!)} onMouseEnter={() => setFocus(s.key)} onMouseLeave={() => setFocus(null)}>{row}</tr>
                    ) : (
                      <tr key={s.key} className="border-0 border-t border-solid border-white/5">{row}</tr>
                    );
                  })}
            </tbody>
            {totals && !loading && (
              <tfoot>
                <tr className="border-0 border-t border-solid border-white/15 bg-white/[0.03] font-semibold text-white">
                  <td className="px-4 py-3 sm:pl-5">All streams</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(totals.nolsafRevenue)}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">100%</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(totals.gmv)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-teal-300">{pct(takeRate)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{NF.format(totals.realizedCount)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{totals.realizedCount > 0 ? money(totals.nolsafRevenue / totals.realizedCount) : "n/a"}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-amber-300 sm:pr-5">{money(totals.pendingRevenue)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        <p className="m-0 border-0 border-t border-solid border-white/10 px-4 py-2.5 text-[11px] text-slate-500 sm:px-5">
          Take rate is shown green when a stream beats the blended rate and amber when it falls below. Money of record: {currency}
          {data ? `. Generated ${new Date(data.generatedAt).toLocaleString("en-GB")}` : ""}.
        </p>
      </section>

      {/* Quick links, since this page only reads */}
      <div className="flex flex-wrap gap-2">
        {streams.filter((s) => STREAM_META[s.key].href).map((s) => (
          <Link key={s.key} href={STREAM_META[s.key].href!} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-white/10 bg-white/[0.03] px-3 text-xs font-medium text-slate-300 no-underline transition hover:bg-white/[0.07] hover:text-white hover:no-underline">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: STREAM_META[s.key].color }} /> {s.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

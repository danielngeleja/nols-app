"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Building2, CalendarCheck, Gauge, RefreshCw, TrendingUp, Trophy, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { NoLSAFCardHeader, NoLSAFSummaryCard } from "@/components/admin/reports/NoLSAFReportsFrame";

type SeriesResponse = { labels: string[]; data: number[] };
type OverviewResponse = {
  propertiesCount?: number;
  ownerPayouts?: number;
  companyRevenue?: number;
  /** Tour commission, reported separately in its own currency (USD). */
  companyRevenueTour?: number;
  companyRevenueTourCurrency?: string;
  lastUpdated?: string;
};
type SummaryResponse = {
  activeSessions?: number;
  pendingApprovals?: number;
  bookings?: number;
};
type Day = { label: string; value: number };

const DAYS = 30;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function toNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

/** Series labels are calendar days ("2026-09-14"); read them as UTC so the day never shifts. */
function dayLabel(label: string, withYear = false) {
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(label) ? `${label}T00:00:00Z` : label);
  if (Number.isNaN(date.getTime())) return label;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export default function LivePerformancePulse() {
  const [series, setSeries] = useState<SeriesResponse>({ labels: [], data: [] });
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const range = useMemo(() => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (DAYS - 1));
    return { from: isoDate(from), to: isoDate(to) };
  }, []);

  async function load(quiet = false) {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const [seriesRes, overviewRes, summaryRes] = await Promise.all([
        apiClient.get(`/api/admin/stats/revenue-series?from=${range.from}&to=${range.to}`),
        apiClient.get("/api/admin/stats/overview"),
        apiClient.get("/api/admin/summary"),
      ]);

      setSeries({
        labels: Array.isArray(seriesRes.data?.labels) ? seriesRes.data.labels : [],
        data: Array.isArray(seriesRes.data?.data) ? seriesRes.data.data.map(toNumber) : [],
      });
      setOverview(overviewRes.data ?? null);
      setSummary(summaryRes.data ?? null);
    } catch (err: any) {
      setError(err?.response?.data?.message || err?.response?.data?.error || err?.message || "Unable to load live performance data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
    const id = window.setInterval(() => load(true), 60_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => {
    const days: Day[] = series.labels.slice(-DAYS).map((label, index) => ({ label, value: toNumber(series.data.slice(-DAYS)[index]) }));
    const total = days.reduce((sum, day) => sum + day.value, 0);
    const active = days.filter((day) => day.value > 0);
    const best = active.reduce<Day | null>((top, day) => (!top || day.value > top.value ? day : top), null);
    const max = Math.max(0, ...days.map((day) => day.value));
    const latest = days[days.length - 1]?.value ?? 0;
    const previous = days[days.length - 2]?.value ?? 0;
    return {
      days,
      total,
      max,
      best,
      activeDays: active.length,
      average: days.length ? total / days.length : 0,
      change: previous > 0 ? ((latest - previous) / previous) * 100 : null,
    };
  }, [series]);

  const tourCurrency = overview?.companyRevenueTourCurrency || "USD";
  const lastUpdated = overview?.lastUpdated ? new Date(overview.lastUpdated) : null;
  const hasRevenue = stats.total > 0;
  const focus = hover !== null ? stats.days[hover] : null;
  const firstDay = stats.days[0]?.label;
  const lastDay = stats.days[stats.days.length - 1]?.label;

  return (
    <div className="box-border w-full min-w-0 max-w-full space-y-4">
      {error ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-solid border-amber-200 bg-amber-50 p-3.5 text-sm font-medium text-amber-800" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <NoLSAFSummaryCard icon={Wallet} label="Company revenue" value={loading ? "..." : `TZS ${formatMoney(toNumber(overview?.companyRevenue))}`} detail="Property and transport commission" tone="emerald" />
        <NoLSAFSummaryCard icon={TrendingUp} label={`Tour commission (${tourCurrency})`} value={loading ? "..." : `${tourCurrency} ${formatMoney(toNumber(overview?.companyRevenueTour))}`} detail="Own currency, never summed with TZS" tone="blue" />
        <NoLSAFSummaryCard icon={CalendarCheck} label="Bookings 24h" value={loading ? "..." : formatNumber(toNumber(summary?.bookings))} detail="Real booking movement" tone="violet" />
        <NoLSAFSummaryCard icon={Building2} label="Pending approvals" value={loading ? "..." : formatNumber(toNumber(summary?.pendingApprovals))} detail="Owner and property workload" tone={toNumber(summary?.pendingApprovals) > 0 ? "amber" : "slate"} />
        <NoLSAFSummaryCard icon={Activity} label="Active sessions" value={loading ? "..." : formatNumber(toNumber(summary?.activeSessions))} detail="Last active window" tone="slate" />
      </div>

      <section className="box-border w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <NoLSAFCardHeader
          icon={TrendingUp}
          title="Revenue and operations pulse"
          subtitle="Daily company revenue (TZS) over the last 30 days. Refreshes every minute."
          right={
            <>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-solid border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                {stats.change !== null ? `${stats.change >= 0 ? "+" : ""}${stats.change.toFixed(1)}% vs yesterday` : "Live"}
              </span>
              <button
                type="button"
                onClick={() => load(true)}
                disabled={refreshing}
                className="box-border inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs font-bold text-neutral-600 transition hover:border-neutral-300 hover:text-emerald-700 disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden />
                Refresh
              </button>
            </>
          }
        />

        <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_290px]">
          {/* Daily bars */}
          <div className="min-w-0 border-0 border-solid border-neutral-100 p-4 sm:p-5 lg:border-r">
            {loading ? (
              <div className="flex h-56 items-end gap-[3px]" aria-hidden>
                {Array.from({ length: DAYS }, (_, i) => (
                  <span key={i} className="flex-1 animate-pulse rounded-t bg-neutral-100" style={{ height: `${25 + ((i * 37) % 60)}%` }} />
                ))}
              </div>
            ) : !hasRevenue ? (
              <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 px-5 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-solid border-neutral-200 bg-white text-neutral-300">
                  <TrendingUp className="h-5 w-5" aria-hidden />
                </span>
                <p className="m-0 mt-3 text-sm font-bold text-neutral-700">No company revenue in the last 30 days</p>
                <p className="mb-0 mt-1 max-w-sm text-xs leading-5 text-neutral-400">Bars appear here as soon as property or transport commission is recorded. Tour commission is tracked separately in {tourCurrency}.</p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex min-h-[38px] items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{focus ? dayLabel(focus.label, true) : "Last 30 days"}</p>
                    <p className="m-0 mt-0.5 text-xl font-black tabular-nums tracking-tight text-neutral-950">TZS {formatNumber(Math.round(focus ? focus.value : stats.total))}</p>
                  </div>
                  <p className="m-0 text-[11px] text-neutral-400">Peak TZS {formatMoney(stats.max)}</p>
                </div>

                <div className="relative h-48" onMouseLeave={() => setHover(null)}>
                  {[0.5, 1].map((line) => (
                    <span key={line} className="pointer-events-none absolute inset-x-0 border-0 border-t border-dashed border-neutral-200" style={{ bottom: `${line * 100}%` }} aria-hidden />
                  ))}
                  <div className="relative flex h-full items-end gap-[3px]" role="img" aria-label={`Daily revenue bars, total TZS ${formatNumber(Math.round(stats.total))}`}>
                    {stats.days.map((day, index) => {
                      const share = stats.max > 0 ? day.value / stats.max : 0;
                      const isLatest = index === stats.days.length - 1;
                      const isFocus = hover === index;
                      return (
                        <button
                          key={day.label}
                          type="button"
                          onMouseEnter={() => setHover(index)}
                          onFocus={() => setHover(index)}
                          onBlur={() => setHover(null)}
                          title={`${dayLabel(day.label, true)}: TZS ${formatNumber(Math.round(day.value))}`}
                          className="flex h-full min-w-0 flex-1 cursor-default items-end border-0 bg-transparent p-0 focus:outline-none"
                        >
                          <span
                            className={`block w-full rounded-t-[4px] transition-all ${
                              day.value <= 0
                                ? "bg-neutral-200"
                                : isFocus
                                  ? "bg-[#073c35]"
                                  : isLatest
                                    ? "bg-gradient-to-t from-emerald-600 to-emerald-400"
                                    : "bg-gradient-to-t from-emerald-500/80 to-emerald-300/80"
                            }`}
                            style={{ height: day.value <= 0 ? "3px" : `${Math.max(4, share * 100)}%` }}
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-2 flex justify-between text-[10.5px] text-neutral-400">
                  {stats.days
                    .filter((_, index) => index % 5 === 0 || index === stats.days.length - 1)
                    .map((day) => (
                      <span key={day.label}>{dayLabel(day.label)}</span>
                    ))}
                </div>
              </>
            )}
          </div>

          {/* What the month says */}
          <dl className="m-0 grid min-w-0 grid-cols-1 gap-2 border-0 border-t border-solid border-neutral-100 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-1 lg:content-start lg:border-t-0">
            <PulseStat
              icon={Wallet}
              tone="emerald"
              label="30-day total"
              value={loading ? "..." : `TZS ${formatMoney(stats.total)}`}
              detail="Property and transport commission"
            />
            <PulseStat
              icon={Gauge}
              tone="blue"
              label="Daily average"
              value={loading ? "..." : `TZS ${formatMoney(stats.average)}`}
              detail={`Across all ${stats.days.length || DAYS} days`}
            />
            <PulseStat
              icon={Trophy}
              tone={stats.best ? "amber" : "slate"}
              label="Best day"
              value={loading ? "..." : stats.best ? `TZS ${formatMoney(stats.best.value)}` : "None yet"}
              detail={stats.best ? dayLabel(stats.best.label, true) : "No revenue recorded"}
            />
            <PulseStat
              icon={CalendarCheck}
              tone="violet"
              label="Days with revenue"
              value={loading ? "..." : `${stats.activeDays} of ${stats.days.length || DAYS}`}
              detail={stats.activeDays ? `${Math.round((stats.activeDays / (stats.days.length || DAYS)) * 100)}% of the period` : "Nothing recorded yet"}
              progress={loading ? undefined : stats.activeDays / (stats.days.length || DAYS)}
            />
          </dl>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-2.5 text-[11.5px] text-neutral-500 sm:px-5">
          <span>{firstDay && lastDay ? `${dayLabel(firstDay)} to ${dayLabel(lastDay, true)}` : "Last 30 days"}</span>
          <span>Tour commission is reported separately in {tourCurrency}</span>
          {lastUpdated ? <span>Updated {lastUpdated.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT</span> : null}
        </div>
      </section>
    </div>
  );
}

const STAT_TONES = {
  emerald: { icon: "from-emerald-500 to-emerald-700", bar: "bg-emerald-500" },
  blue: { icon: "from-blue-500 to-blue-700", bar: "bg-blue-500" },
  amber: { icon: "from-amber-400 to-amber-600", bar: "bg-amber-500" },
  violet: { icon: "from-violet-500 to-violet-700", bar: "bg-violet-500" },
  slate: { icon: "from-neutral-300 to-neutral-500", bar: "bg-neutral-400" },
} as const;

/** One month figure as an NRMS mini tile: gradient icon, label, value, detail, optional coverage bar. */
function PulseStat({
  icon: Icon,
  tone,
  label,
  value,
  detail,
  progress,
}: {
  icon: typeof Wallet;
  tone: keyof typeof STAT_TONES;
  label: string;
  value: string;
  detail: string;
  progress?: number;
}) {
  const t = STAT_TONES[tone];
  return (
    <div className="box-border flex min-w-0 items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-inset ring-neutral-200/70 transition hover:ring-neutral-300">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${t.icon}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <dt className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</dt>
        <dd className="m-0 mt-0.5 truncate text-base font-black tabular-nums tracking-tight text-neutral-950">{value}</dd>
        {typeof progress === "number" ? (
          <dd className="m-0 mt-1.5">
            <span className="block h-1.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden>
              <span className={`block h-1.5 rounded-full ${t.bar}`} style={{ width: `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` }} />
            </span>
            <span className="mt-1 block truncate text-[11px] text-neutral-400">{detail}</span>
          </dd>
        ) : (
          <dd className="m-0 mt-0.5 truncate text-[11px] text-neutral-400">{detail}</dd>
        )}
      </div>
    </div>
  );
}

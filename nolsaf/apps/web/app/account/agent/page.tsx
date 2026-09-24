"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import { ArrowRight, BadgeCheck, CalendarDays, CheckCircle2, ClipboardList, Clock, CircleAlert, LogIn, RefreshCw, ShieldAlert, Star, TrendingUp, Wallet2, type LucideIcon } from "lucide-react";

const api = apiClient;

const CURRENT_AGENT_ROUTES = {
  me: "/api/agent/me",
  assignments: "/api/agent/tour-bookings",
} as const;

function normalizeWorkflowStatus(input: unknown): string {
  return String(input || "").trim().replace(/[\s-]+/g, "_").toUpperCase();
}

function isCompletedStatus(input: unknown): boolean {
  const s = normalizeWorkflowStatus(input);
  return s === "COMPLETED" || s === "CHECKED_OUT" || s === "DONE" || s === "FINISHED";
}

function isInProgressStatus(input: unknown): boolean {
  const s = normalizeWorkflowStatus(input);
  return (
    s === "IN_PROGRESS" ||
    s === "CHECKED_IN" ||
    s === "PENDING_CHECKIN" ||
    s === "CONFIRMED" ||
    s === "ACTIVE" ||
    s === "ONGOING"
  );
}

type AssignmentStats = {
  total: number;
  completed: number;
  inProgress: number;
};

type AssignmentPreview = {
  id: string | number;
  title?: string;
  description?: string | null;
  status?: string;
  createdAt?: string;
};

type AccountMe = {
  name?: string | null;
  fullName?: string | null;
};

type AgentMe = {
  agent?: {
    level?: string | null;
    performanceMetrics?: {
      overallRating?: number | null;
      totalReviews?: number | null;
    } | null;
  } | null;
};

type TrendVariant = "area" | "line" | "dots" | "step";

// Micro bar sparkline. Daily counts are sparse and zero-heavy, so a line/area
// reads as stray spikes — discrete bars sit on a shared baseline, handle zeros
// gracefully, and fade older days so the most recent activity reads first.
function Sparkline({ values, variant }: { values: number[]; variant: TrendVariant }) {
  const max = useMemo(
    () => Math.max(1, ...values.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))),
    [values]
  );
  if (!values.length) return null;

  const n = values.length;
  return (
    <div className="flex h-full w-full items-end gap-[3px]" data-variant={variant} aria-hidden>
      {values.map((raw, i) => {
        const v = Number(raw) || 0;
        const pct = (v / max) * 100;
        const height = v > 0 ? Math.max(10, pct) : 0;
        const isLast = i === n - 1;
        // Older days fade toward the left; today is fully saturated.
        const opacity = isLast ? 1 : 0.2 + (i / Math.max(1, n - 1)) * 0.45;
        return (
          <div
            key={i}
            className="flex-1 rounded-t-[2.5px] bg-current"
            style={{ height: `${height}%`, minHeight: v > 0 ? 3 : 0, opacity }}
          />
        );
      })}
    </div>
  );
}

// Local mirrors of the NRMS front-desk primitives (WorkloadOverview segmented
// bar, CompactStat strip, OperationList queue), so the operator dashboard reads
// as the same product as the property workspace.
function CompactStat({
  label,
  value,
  helper,
  tone,
}: {
  label: string;
  value: number | string;
  helper: string;
  tone: "emerald" | "blue" | "neutral" | "amber";
}) {
  const valueClass = {
    emerald: "text-emerald-700",
    blue: "text-blue-700",
    neutral: "text-neutral-900",
    amber: "text-amber-700",
  }[tone];
  const backgroundClass = tone === "amber" && Number(value) > 0 ? "bg-amber-50/45" : "bg-white";

  return (
    <article className={`min-w-0 px-5 py-4 transition hover:bg-neutral-50 ${backgroundClass}`}>
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-400">{label}</p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <p className={`m-0 text-2xl font-bold leading-none tabular-nums ${valueClass}`}>{value}</p>
        <span className="truncate text-[11px] font-medium text-neutral-400">{helper}</span>
      </div>
    </article>
  );
}

function DashPanel({
  title,
  description,
  action,
  children,
  bodyClassName = "min-w-0 p-4",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
      <header className="flex items-center justify-between gap-3 px-4 py-3 shadow-[inset_0_-1px_0_0_#f5f5f5]">
        <div className="min-w-0">
          <h2 className="m-0 text-sm font-bold text-neutral-900">{title}</h2>
          {description ? <p className="m-0 mt-0.5 text-[10px] leading-4 text-neutral-500">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

function DashEmpty({
  icon: Icon,
  title,
  text,
  actionHref,
  actionLabel,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 rounded-2xl border border-dashed border-neutral-300 px-6 py-10 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-full bg-neutral-100 text-neutral-400">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="m-0 mt-1 text-sm font-bold text-neutral-800">{title}</p>
      <p className="m-0 text-xs text-neutral-500">{text}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 no-underline transition hover:border-emerald-200 hover:text-emerald-700 hover:no-underline"
        >
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const style =
    s.includes("complete") || s === "done"
      ? "bg-success/5 text-success border-success/20"
      : s.includes("progress")
      ? "bg-info/5 text-info border-info/20"
      : s.includes("cancel")
      ? "bg-danger/5 text-danger border-danger/20"
      : "bg-neutral-50 text-neutral-600 border-neutral-200";

  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border border-solid ${style}`}>
      {status}
    </span>
  );
}

export default function AgentPortalHomePage() {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<AssignmentStats>({ total: 0, completed: 0, inProgress: 0 });
  const [recent, setRecent] = useState<AssignmentPreview[]>([]);
  const [authRequired, setAuthRequired] = useState(false);
  const [dataIssue, setDataIssue] = useState<string | null>(null);
  const [isSuspended, setIsSuspended] = useState(false);
  const [account, setAccount] = useState<AccountMe | null>(null);
  const [agentMe, setAgentMe] = useState<AgentMe | null>(null);
  const [trendItems, setTrendItems] = useState<AssignmentPreview[]>([]);

  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setAuthRequired(false);
        setDataIssue(null);

        // Ensure user is authenticated + load agent context for level/ratings.
        const [sessionRes, agentRes, res] = await Promise.all([
          fetchAccountSession(),
          api.get(CURRENT_AGENT_ROUTES.me).catch((e: any) => {
            if (e?.response?.status === 403 && e?.response?.data?.error === "AGENT_SUSPENDED") {
              if (alive) setIsSuspended(true);
            }
            return { data: null };
          }),
          api.get(CURRENT_AGENT_ROUTES.assignments, {
            params: { page: 1, pageSize: 60 },
          }).catch((e: any) => ({ data: null, __routeError: e })),
        ]);

        if (!alive) return;

        if (!sessionRes.ok) {
          throw new Error(`Session check failed: ${sessionRes.status}`);
        }

        setAccount((sessionRes.data as AccountMe | null) ?? null);
        setAgentMe((agentRes as any)?.data || null);

        const routeError = (res as any)?.__routeError;
        if (routeError) {
          setDataIssue("Booking metrics are unavailable right now.");
        }

        const total = Number((res as any)?.data?.total ?? 0);
        const completed = Number((res as any)?.data?.completed ?? 0);
        const inProgress = Number((res as any)?.data?.inProgress ?? 0);

        const list: any[] = (res as any)?.data?.items ?? [];

        setStats({
          total: Number.isFinite(total) ? total : 0,
          completed: Number.isFinite(completed) ? completed : 0,
          inProgress: Number.isFinite(inProgress) ? inProgress : 0,
        });

        const mapped: AssignmentPreview[] = Array.isArray(list)
          ? list.map((x) => ({
              id: x?.id,
              title: x?.title,
              description: x?.description ?? null,
              status: x?.status,
              createdAt: x?.createdAt,
            }))
          : [];

        setTrendItems(mapped);
        setRecent(mapped.slice(0, 2));
      } catch {
        // Allow UI preview even when not logged in.
        // (In production you will typically be redirected by the account flows anyway.)
        if (!alive) return;
        setAuthRequired(true);
        setRecent([]);
        setTrendItems([]);
        setAccount(null);
        setAgentMe(null);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const displayName = useMemo(() => {
    const name = (account?.fullName || account?.name || "").trim();
    return name;
  }, [account]);

  const agentLevel = useMemo(() => {
    const raw = (agentMe as any)?.agent?.level;
    return typeof raw === "string" && raw.trim() ? raw.trim() : "—";
  }, [agentMe]);

  const levelProgress = useMemo(() => {
    const next = (agentMe as any)?.agent?.levelProgress;
    if (!next || typeof next !== "object") return null;
    const nextLevel = typeof next.level === "string" ? next.level : null;
    if (!nextLevel) return null;
    const met = next.met || {};
    const remaining = next.remaining || {};
    // Surface the single most actionable gap toward the next tier.
    if (!met.reviews) return `Collect reviews to reach ${nextLevel}`;
    const toursLeft = Number(remaining.tours);
    if (!met.tours && Number.isFinite(toursLeft) && toursLeft > 0) {
      return `${toursLeft} more tour${toursLeft === 1 ? "" : "s"} to ${nextLevel}`;
    }
    if (!met.revenue) return `More revenue to reach ${nextLevel}`;
    if (!met.rating) return `Raise rating to reach ${nextLevel}`;
    return `On track for ${nextLevel}`;
  }, [agentMe]);

  const agentRating = useMemo(() => {
    const rating = (agentMe as any)?.agent?.performanceMetrics?.overallRating;
    const totalReviews = (agentMe as any)?.agent?.performanceMetrics?.totalReviews;
    const r = typeof rating === "number" && Number.isFinite(rating) ? rating : null;
    const c = typeof totalReviews === "number" && Number.isFinite(totalReviews) ? totalReviews : 0;
    return { rating: r, totalReviews: c };
  }, [agentMe]);

  const trends = useMemo(() => {
    const days = 14;
    const end = new Date();
    end.setHours(0, 0, 0, 0);

    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));

    const buckets = Array.from({ length: days }, () => ({ total: 0, completed: 0, inProgress: 0 }));

    for (const item of trendItems) {
      if (!item?.createdAt) continue;
      const d = new Date(item.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      d.setHours(0, 0, 0, 0);
      if (d < start || d > end) continue;

      const idx = Math.round((d.getTime() - start.getTime()) / 86400000);
      if (idx < 0 || idx >= buckets.length) continue;

      buckets[idx].total += 1;
      if (isCompletedStatus(item.status)) buckets[idx].completed += 1;
      else if (isInProgressStatus(item.status)) buckets[idx].inProgress += 1;
    }

    return {
      total: buckets.map((b) => b.total),
      completed: buckets.map((b) => b.completed),
      inProgress: buckets.map((b) => b.inProgress),
    };
  }, [trendItems]);

  const trendSummary = useMemo(() => {
    const sum = (arr: number[]) => arr.reduce((a, b) => a + (Number(b) || 0), 0);
    const last14Total = sum(trends.total);
    const last14Completed = sum(trends.completed);
    const last14InProgress = sum(trends.inProgress);

    const completionRate14 = last14Completed / Math.max(1, last14Total);
    const completionRateAll = stats.completed / Math.max(1, stats.total);
    const pendingCount = trendItems.filter((item) => normalizeWorkflowStatus(item.status) === "PENDING").length;

    return {
      last14Total,
      last14Completed,
      last14InProgress,
      completionRate14,
      completionRateAll,
      pendingCount,
    };
  }, [stats.completed, stats.total, trendItems, trends.completed, trends.inProgress, trends.total]);

  const awaitingAction = Math.max(0, stats.total - stats.completed - stats.inProgress);
  const workloadSegments = [
    { label: "completed", value: stats.completed, color: "bg-emerald-600" },
    { label: "in progress", value: stats.inProgress, color: "bg-blue-400" },
    { label: "awaiting action", value: awaitingAction, color: "bg-amber-400" },
  ];
  const completionPercent = Math.round(trendSummary.completionRateAll * 100);

  return (
    <div className="min-w-0 max-w-full space-y-4 pb-10">
      {/* Greeting strip. NRMS fills its hero with a photograph; there is no
          operator equivalent asset, so the right half carries the live position
          instead of decoration, and the band earns its height either way. */}
      <section className="relative overflow-hidden rounded-3xl bg-[#0b2b26] text-white shadow-[0_20px_45px_-34px_rgba(6,78,59,0.72)]">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(120% 100% at 100% 0%, black 0%, transparent 70%)",
            WebkitMaskImage: "radial-gradient(120% 100% at 100% 0%, black 0%, transparent 70%)",
          }}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_130%_at_88%_-10%,rgba(16,185,129,0.42)_0%,rgba(16,185,129,0.10)_38%,transparent_66%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(0deg,rgba(3,20,17,0.55)_0%,transparent_100%)]" aria-hidden />

        <div className="relative grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end xl:gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300/80">Operator workspace</p>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                <BadgeCheck className="h-3 w-3 text-emerald-300" aria-hidden />
                {agentLevel}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-bold">
                <Star className="h-3 w-3 text-amber-300" aria-hidden />
                {agentRating.rating != null ? agentRating.rating.toFixed(1) : "--"}
                <span className="font-medium text-white/45">({agentRating.totalReviews})</span>
              </span>
            </div>

            <h1 className="m-0 mt-2 text-xl font-bold tracking-tight sm:text-2xl">
              {greeting}{displayName ? `, ${displayName}` : ""}
            </h1>
            <p className="m-0 mt-1 text-xs text-white/55">Your bookings, workload and payout position at a glance.</p>

            <div className="mt-4 max-w-full overflow-x-auto rounded-2xl border border-solid border-white/10 bg-black/25 p-1.5 backdrop-blur-md">
              <div className="flex w-max gap-1.5">
                <Link
                  href="/account/agent/bookings"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-400 px-3.5 text-xs font-bold text-emerald-950 no-underline transition hover:bg-emerald-300 hover:no-underline"
                >
                  <CalendarDays className="h-4 w-4" aria-hidden />
                  My bookings
                </Link>
                <Link
                  href="/account/agent/revenues"
                  className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-3.5 text-xs font-semibold text-white no-underline transition hover:bg-white/10 hover:no-underline"
                >
                  <Wallet2 className="h-4 w-4" aria-hidden />
                  My revenues
                </Link>
              </div>
            </div>
          </div>

          {!loading && !authRequired ? (
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-solid border-white/10 bg-white/10 xl:w-[21rem]">
              {[
                { label: "Active", value: stats.inProgress, helper: "in progress", accent: "text-white" },
                { label: "Waiting", value: awaitingAction, helper: "needs action", accent: awaitingAction > 0 ? "text-amber-300" : "text-white" },
                { label: "Done", value: `${completionPercent}%`, helper: "completed", accent: "text-emerald-300" },
              ].map((tile) => (
                <div key={tile.label} className="min-w-0 bg-[#0b2b26]/85 px-3 py-3">
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-white/40">{tile.label}</p>
                  <p className={`m-0 mt-1 text-xl font-bold leading-none tabular-nums ${tile.accent}`}>{tile.value}</p>
                  <p className="m-0 mt-1 truncate text-[10px] text-white/40">{tile.helper}</p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {authRequired ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 text-sm font-bold text-amber-900">Sign in required</p>
            <p className="m-0 mt-0.5 text-xs text-amber-800/80">Sign in to load your bookings and workload.</p>
          </div>
          <Link
            href="/login"
            className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border-0 bg-amber-700 px-3 text-xs font-bold text-white no-underline transition hover:bg-amber-800 hover:no-underline"
          >
            <LogIn className="h-3.5 w-3.5" aria-hidden />
            Sign in
          </Link>
        </div>
      ) : null}

      {isSuspended ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-solid border-red-200 bg-red-50 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" aria-hidden />
          <div className="min-w-0">
            <p className="m-0 text-sm font-bold text-red-800">Account temporarily suspended</p>
            <p className="m-0 mt-0.5 text-xs leading-relaxed text-red-700/85">
              Booking access is paused while this is reviewed. Contact{" "}
              <a href="mailto:security@nolsaf.com" className="font-semibold text-red-800 underline">security@nolsaf.com</a> for
              security matters or <a href="mailto:hr@nolsaf.com" className="font-semibold text-red-800 underline">hr@nolsaf.com</a> for
              account standing.
            </p>
          </div>
        </div>
      ) : null}

      {dataIssue ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{dataIssue}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-solid border-neutral-200 bg-white text-neutral-400">
          <RefreshCw className="h-6 w-6 animate-spin text-emerald-600" aria-hidden />
          <span className="text-sm">Preparing your workspace...</span>
        </div>
      ) : (
        <>
          {/* Workload split, the analogue of the NRMS occupancy bar: one
              headline figure with the composition underneath it. */}
          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                  <ClipboardList className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h2 className="m-0 text-sm font-bold text-neutral-900">Booking workload</h2>
                  <p className="m-0 mt-0.5 text-xs text-neutral-400">Every booking on your account, by stage</p>
                </div>
              </div>
              <p className="m-0 text-sm font-bold tabular-nums text-neutral-900">
                {stats.completed} of {stats.total} completed <span className="text-neutral-400">·</span> {completionPercent}%
              </p>
            </div>

            <div className="mt-5 flex h-2.5 w-full gap-1.5 overflow-hidden rounded-full" aria-label={`${completionPercent}% of bookings completed`}>
              {stats.total > 0 ? (
                workloadSegments.map((segment) =>
                  segment.value > 0 ? (
                    <span
                      key={segment.label}
                      className={`h-full min-w-1 rounded-full ${segment.color}`}
                      style={{ width: `${(segment.value / stats.total) * 100}%` }}
                      title={`${segment.value} ${segment.label}`}
                    />
                  ) : null
                )
              ) : (
                <span className="h-full w-full rounded-full bg-neutral-200" />
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {workloadSegments.map((segment) => (
                <span key={segment.label} className="inline-flex items-center gap-2 text-xs text-neutral-500">
                  <span className={`h-2.5 w-2.5 rounded-sm ${segment.color}`} aria-hidden />
                  <strong className="font-bold text-neutral-700">{segment.value}</strong> {segment.label}
                </span>
              ))}
            </div>

            {levelProgress ? (
              <p className="m-0 mt-4 inline-flex items-center gap-1.5 rounded-lg bg-neutral-50 px-2.5 py-1.5 text-[11px] font-semibold text-neutral-500">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                {levelProgress}
              </p>
            ) : null}
          </section>

          <section aria-label="Last 14 days at a glance" className="overflow-x-auto rounded-2xl border border-solid border-neutral-200 bg-white">
            <div className="grid min-w-[34rem] grid-cols-4 divide-x divide-neutral-100">
              <CompactStat label="Received" value={trendSummary.last14Total} helper="last 14 days" tone="neutral" />
              <CompactStat label="Completed" value={trendSummary.last14Completed} helper="last 14 days" tone="emerald" />
              <CompactStat label="In progress" value={trendSummary.last14InProgress} helper="being handled" tone="blue" />
              <CompactStat label="Awaiting action" value={awaitingAction} helper="needs follow-up" tone="amber" />
            </div>
          </section>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[1.4fr_1fr]">
            <DashPanel
              title="Booking trends"
              description="Bookings received over the last 14 days."
              action={
                <span className="text-[11px] font-bold tabular-nums text-neutral-500">
                  {Math.round(trendSummary.completionRate14 * 100)}% completed
                </span>
              }
            >
              {trendSummary.last14Total === 0 ? (
                <DashEmpty
                  icon={TrendingUp}
                  title="No activity in the last 14 days"
                  text="New bookings will chart here as they arrive."
                />
              ) : (
                <div className="min-w-0 space-y-3">
                  <div>
                    <p className="m-0 mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Received</p>
                    <Sparkline values={trends.total} variant="area" />
                  </div>
                  <div>
                    <p className="m-0 mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Completed</p>
                    <Sparkline values={trends.completed} variant="area" />
                  </div>
                  <div>
                    <p className="m-0 mb-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">In progress</p>
                    <Sparkline values={trends.inProgress} variant="area" />
                  </div>
                </div>
              )}
            </DashPanel>

            <DashPanel
              title="Recent bookings"
              description="Your most recently received bookings."
              action={
                <Link
                  href="/account/agent/bookings"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 no-underline transition hover:text-emerald-800 hover:no-underline"
                >
                  View all
                  <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              }
              bodyClassName="min-w-0 p-3"
            >
              {recent.length === 0 ? (
                <DashEmpty
                  icon={ClipboardList}
                  title="No bookings yet"
                  text="Tour bookings on your account will appear here."
                  actionHref="/account/agent/bookings"
                  actionLabel="Open bookings"
                />
              ) : (
                <ul className="m-0 list-none space-y-1.5 p-0">
                  {recent.map((item) => (
                    <li key={String(item.id)}>
                      <Link
                        href={`/account/agent/tour-bookings/${item.id}`}
                        className="flex min-w-0 items-start gap-3 rounded-xl px-2.5 py-2.5 no-underline transition hover:bg-emerald-50/50 hover:no-underline"
                      >
                        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-50 text-neutral-400">
                          {isCompletedStatus(item.status) ? (
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                          ) : (
                            <Clock className="h-3.5 w-3.5" aria-hidden />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-bold text-neutral-800">{item.title || "Tour booking"}</span>
                          {item.description ? (
                            <span className="mt-0.5 block truncate text-[11px] text-neutral-500">{item.description}</span>
                          ) : null}
                        </span>
                        <StatusPill status={String(item.status || "")} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </DashPanel>
          </div>
        </>
      )}
    </div>
  );
}

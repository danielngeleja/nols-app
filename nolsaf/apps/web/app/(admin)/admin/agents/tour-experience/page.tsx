"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  ExternalLink,
  Loader2,
  RefreshCw,
  Share2,
  ShieldCheck,
  Star,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { CountPill, EmptyState, SectionHeader } from "../../nrms/_components/CommercialUi";

const api = apiClient;

type EventPoint = {
  key: string;
  axisLabel: string;
  day: number;
  time?: string;
  title: string;
  vibe?: string;
  average: number;
  ratingCount: number;
  label: string;
};

type ExperienceItem = {
  id: number;
  bookingCode: string;
  title: string;
  destination?: string | null;
  operatorName: string;
  customerName: string;
  travelerCount: number;
  status: string;
  paymentStatus: string;
  lifecycleStatus: "WAITING_MEETUP" | "ACTIVE_TIMELINE" | "RATED" | string;
  meetup: { validated: boolean; validatedAt?: string | null };
  sharing: {
    generated: boolean;
    generatedAt?: string | null;
    joined: number;
    capacity: number;
    participants: Array<{ userId: number; name: string; acceptedAt?: string | null }>;
  };
  rating: {
    totalEvents: number;
    totalRatings: number;
    averageRating: number;
    topFeeling: string;
    completedTravellers: number;
    highest?: EventPoint | null;
    lowest?: EventPoint | null;
    eventPoints: EventPoint[];
    userCompletion: Array<{ userId: number; name: string; role: string; ratedEvents: number; totalEvents: number; complete: boolean }>;
  };
  updatedAt: string;
};

type OverviewPayload = {
  ok: boolean;
  summary: {
    total: number;
    meetupValidated: number;
    inviteGenerated: number;
    joinedTravellers: number;
    totalRatings: number;
    averageRating: number;
    completedTravellers: number;
  };
  items: ExperienceItem[];
};

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "WAITING_MEETUP", label: "Waiting meetup" },
  { value: "ACTIVE_TIMELINE", label: "Active timeline" },
  { value: "RATED", label: "Rated" },
] as const;

const STATUS_BADGE: Record<string, string> = {
  RATED: "border-emerald-100 bg-emerald-50 text-emerald-700",
  ACTIVE_TIMELINE: "border-sky-100 bg-sky-50 text-sky-700",
  WAITING_MEETUP: "border-amber-100 bg-amber-50 text-amber-700",
};

function statusLabel(value: string) {
  return FILTERS.find((f) => f.value === value)?.label ?? (value || "Unknown");
}

function dateText(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function pct(part: number, whole: number) {
  return whole ? Math.round((part / whole) * 100) : 0;
}

// One colour scale for every score on the page: strong, fair, weak.
function scoreTone(score: number, hasRatings = true) {
  if (!hasRatings) return { text: "text-neutral-400", bar: "bg-neutral-200", chip: "border-neutral-200 bg-neutral-50 text-neutral-400" };
  if (score >= 4) return { text: "text-emerald-700", bar: "bg-emerald-600", chip: "border-emerald-100 bg-emerald-50 text-emerald-700" };
  if (score >= 3) return { text: "text-amber-700", bar: "bg-amber-500", chip: "border-amber-100 bg-amber-50 text-amber-700" };
  return { text: "text-red-700", bar: "bg-red-500", chip: "border-red-100 bg-red-50 text-red-700" };
}

const METRIC_TONES = {
  emerald: "from-emerald-500 to-emerald-700",
  blue: "from-blue-500 to-blue-700",
  amber: "from-amber-400 to-amber-600",
  slate: "from-neutral-400 to-neutral-600",
} as const;

// NRMS SummaryCard look, sized for six across: smaller tile, text wraps instead of truncating.
function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof Star; label: string; value: string; detail: string; tone: keyof typeof METRIC_TONES }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 p-3.5 transition hover:bg-neutral-50/70 sm:p-4">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow-sm ${METRIC_TONES[tone]}`}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="m-0 text-[10px] font-bold uppercase leading-tight tracking-[0.08em] text-neutral-400">{label}</p>
        <p className="m-0 mt-1 whitespace-nowrap text-lg font-black leading-none tracking-tight tabular-nums text-neutral-950">{value}</p>
        <p className="m-0 mt-1 text-[11px] leading-snug text-neutral-500">{detail}</p>
      </div>
    </div>
  );
}

function Fact({ icon: Icon, label, value, detail }: { icon: typeof Star; label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white p-3.5">
      <p className="m-0 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">
        <Icon className="h-3.5 w-3.5 text-emerald-700" aria-hidden />
        {label}
      </p>
      <p className="m-0 mt-1.5 truncate text-sm font-bold text-neutral-900">{value}</p>
      <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-500">{detail}</p>
    </div>
  );
}

export default function AdminTourExperiencePage() {
  const [payload, setPayload] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("ALL");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<OverviewPayload>("/api/admin/tour-experience/overview", { params: { status } });
      setPayload(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load tour experience intelligence.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void load();
    }, 250);
    return () => window.clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const items = useMemo(() => payload?.items || [], [payload]);
  const summary = payload?.summary;
  const total = summary?.total ?? 0;
  const average = Number(summary?.averageRating || 0);

  const topIssues = useMemo(
    () =>
      items
        .flatMap((item) => (item.rating.lowest ? [{ ...item.rating.lowest, bookingCode: item.bookingCode, operatorName: item.operatorName, itemId: item.id }] : []))
        .filter((point) => point.ratingCount > 0)
        .sort((a, b) => a.average - b.average)
        .slice(0, 5),
    [items]
  );

  // How rated timelines split across the score bands
  const bands = useMemo(() => {
    const rated = items.filter((i) => i.rating.totalRatings > 0);
    const strong = rated.filter((i) => i.rating.averageRating >= 4).length;
    const fair = rated.filter((i) => i.rating.averageRating >= 3 && i.rating.averageRating < 4).length;
    const weak = rated.length - strong - fair;
    return { rated: rated.length, rows: [
      { label: "4 and above", value: strong, bar: "bg-emerald-600", text: "text-emerald-700" },
      { label: "3 to 4", value: fair, bar: "bg-amber-500", text: "text-amber-700" },
      { label: "Below 3", value: weak, bar: "bg-red-500", text: "text-red-700" },
    ] };
  }, [items]);

  return (
    <div id="tour-experience" className="w-full min-w-0 space-y-4">
      {/* Preflight is disabled in this project; scope border-box so w-full pieces don't overflow */}
      <style>{`#tour-experience, #tour-experience * { box-sizing: border-box; }`}</style>

      {/* Workspace header */}
      <section className="relative overflow-hidden rounded-2xl border border-solid border-slate-800 bg-[linear-gradient(120deg,#102b3a_0%,#123f49_65%,#075e54_100%)] p-4 shadow-sm sm:p-5">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-solid border-white/[0.06]" aria-hidden="true" />
        <div className="relative flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-solid border-emerald-100 bg-white text-emerald-700 shadow-sm">
                <BarChart3 className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Tour operators</p>
                  <span
                    className="inline-flex items-center gap-1 rounded-full border border-solid border-white/20 bg-white/10 px-2 py-0.5 text-[10px] font-bold text-emerald-50"
                    title="Aggregate and audit-safe. Invite tokens, session tokens and private timeline links are never shown here."
                  >
                    <ShieldCheck className="h-3 w-3" aria-hidden /> Audit-safe
                  </span>
                </div>
                <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tour Experience Intelligence</h1>
                <p className="m-0 mt-1 text-xs leading-5 text-emerald-100/80 sm:text-sm">
                  From meetup validation to shared participation and how travellers rate each moment.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              suppressHydrationWarning
              aria-label="Refresh"
              title="Refresh"
              className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-solid border-white/20 bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-wait"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
            </button>
          </div>
          <nav aria-label="Related workspaces" className="flex flex-wrap gap-2 border-0 border-t border-solid border-white/15 pt-4">
            <Link href="/admin/agents/tour-bookings" className="inline-flex items-center gap-2 rounded-lg border border-solid border-white/15 bg-white/[0.07] px-3 py-2 text-xs font-bold text-emerald-50 no-underline transition hover:bg-white/15">
              <ClipboardList className="h-4 w-4" aria-hidden /> Tour bookings
            </Link>
            <Link href="/admin/agents/tour-operators" className="inline-flex items-center gap-2 rounded-lg border border-solid border-white/15 bg-white/[0.07] px-3 py-2 text-xs font-bold text-emerald-50 no-underline transition hover:bg-white/15">
              <Users className="h-4 w-4" aria-hidden /> Tour operators
            </Link>
          </nav>
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-solid border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span>{error}</span>
        </div>
      ) : null}

      {/* Metrics */}
      {/* One strip, six cells: stays on a single row on desktop without cutting text */}
      <section
        aria-label="Summary"
        className="grid min-w-0 grid-cols-2 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] sm:grid-cols-3 xl:grid-cols-6 [&>*]:border-0 [&>*]:border-b [&>*]:border-r [&>*]:border-solid [&>*]:border-neutral-100"
      >
        <Metric icon={ClipboardList} label="Timelines" value={String(total)} detail={`${bands.rated} with ratings`} tone="emerald" />
        <Metric icon={CheckCircle2} label="Meetup validated" value={String(summary?.meetupValidated ?? 0)} detail={`${pct(summary?.meetupValidated ?? 0, total)}% of timelines`} tone="emerald" />
        <Metric icon={Share2} label="Invites shared" value={String(summary?.inviteGenerated ?? 0)} detail={`${pct(summary?.inviteGenerated ?? 0, total)}% of timelines`} tone="blue" />
        <Metric icon={Users} label="Joined" value={String(summary?.joinedTravellers ?? 0)} detail="Via shared links" tone="blue" />
        <Metric icon={Star} label="Ratings" value={String(summary?.totalRatings ?? 0)} detail={`${summary?.completedTravellers ?? 0} travellers done`} tone="slate" />
        <Metric
          icon={average >= 4 ? TrendingUp : TrendingDown}
          label="Average score"
          value={`${average.toFixed(1)}/5`}
          detail={average >= 4 ? "Travellers are happy" : average >= 3 ? "Room to improve" : summary?.totalRatings ? "Needs attention" : "No ratings yet"}
          tone={!summary?.totalRatings ? "slate" : average >= 4 ? "emerald" : "amber"}
        />
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Timeline register */}
        <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <SectionHeader
            icon={ClipboardList}
            title="Timeline activity"
            subtitle="Meetup, invite usage, traveller completion and ratings per tour"
            right={<CountPill count={items.length} singular="timeline" plural="timelines" />}
          />

          <div role="tablist" aria-label="Filter by stage" className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-neutral-100 px-3 sm:px-4">
            {FILTERS.map((f) => {
              const on = status === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => { setStatus(f.value); setExpandedId(null); }}
                  className={`-mb-px shrink-0 cursor-pointer border-0 border-b-2 border-solid bg-transparent px-3 py-2.5 text-xs font-bold transition ${on ? "border-emerald-700 text-emerald-800" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {loading && !items.length ? (
            <div className="flex min-h-44 items-center justify-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading timelines" /></div>
          ) : !items.length ? (
            <EmptyState icon={ClipboardList} title="No timelines here" text="Nothing matches this stage yet. Try another tab." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] table-fixed border-collapse text-left">
                <caption className="sr-only">Tour experience timelines</caption>
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[15%]" />
                  <col className="w-[13%]" />
                  <col className="w-[14%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[4%]" />
                </colgroup>
                <thead>
                  <tr className="border-0 border-b border-solid border-neutral-100 text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                    <th className="px-4 py-2.5 sm:px-5">Tour</th>
                    <th className="px-3 py-2.5">Stage</th>
                    <th className="px-3 py-2.5">Meetup</th>
                    <th className="px-3 py-2.5">Team joined</th>
                    <th className="px-3 py-2.5 text-right">Ratings</th>
                    <th className="px-3 py-2.5 text-right">Score</th>
                    <th className="px-2 py-2.5"><span className="sr-only">Expand</span></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const open = expandedId === item.id;
                    const hasRatings = item.rating.totalRatings > 0;
                    const tone = scoreTone(item.rating.averageRating, hasRatings);
                    const teamPct = pct(item.sharing.joined, item.sharing.capacity);
                    return (
                      <Fragment key={item.id}>
                        <tr
                          onClick={() => setExpandedId(open ? null : item.id)}
                          className={`cursor-pointer border-0 border-b border-solid border-neutral-50 text-xs transition hover:bg-emerald-50/70 ${open ? "bg-emerald-50/70" : index % 2 === 1 ? "bg-emerald-50/30" : "bg-white"}`}
                        >
                          <td className="px-4 py-3 sm:px-5">
                            <p className="m-0 truncate text-[13px] font-bold text-neutral-900">{item.title}</p>
                            <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-500">
                              <span className="font-mono">{item.bookingCode}</span> · {item.operatorName} · {item.customerName}
                              {item.destination ? ` · ${item.destination}` : ""}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${STATUS_BADGE[item.lifecycleStatus] ?? "border-neutral-200 bg-neutral-100 text-neutral-500"}`}>
                              {statusLabel(item.lifecycleStatus)}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {item.meetup.validated ? (
                              <span className="inline-flex items-center gap-1 font-bold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Validated</span>
                            ) : (
                              <span className="font-semibold text-neutral-400">Waiting</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100">
                                <span className="block h-1.5 rounded-full bg-emerald-600" style={{ width: `${teamPct}%` }} />
                              </span>
                              <span className="shrink-0 font-bold tabular-nums text-neutral-700">{item.sharing.joined}/{item.sharing.capacity}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-bold tabular-nums text-neutral-700">{item.rating.totalRatings}</td>
                          <td className="px-3 py-3 text-right">
                            <span className={`inline-flex rounded-full border border-solid px-2 py-0.5 text-[11px] font-bold tabular-nums ${tone.chip}`}>
                              {hasRatings ? item.rating.averageRating.toFixed(1) : "None"}
                            </span>
                          </td>
                          <td className="px-2 py-3 text-right">
                            <button
                              type="button"
                              aria-expanded={open}
                              aria-label={open ? `Collapse ${item.bookingCode}` : `Expand ${item.bookingCode}`}
                              onClick={(e) => { e.stopPropagation(); setExpandedId(open ? null : item.id); }}
                              className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent text-neutral-400 hover:bg-white hover:text-neutral-700"
                            >
                              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                            </button>
                          </td>
                        </tr>

                        {open ? (
                          <tr className="border-0 border-b border-solid border-neutral-100 bg-neutral-50/60">
                            <td colSpan={7} className="px-4 py-4 sm:px-5">
                              <div className="grid gap-3 sm:grid-cols-3">
                                <Fact icon={CalendarDays} label="Meetup" value={item.meetup.validated ? "Validated" : "Not validated"} detail={dateText(item.meetup.validatedAt)} />
                                <Fact icon={Share2} label="Shared timeline" value={item.sharing.generated ? "Invite generated" : "No invite yet"} detail={`${item.sharing.joined} of ${item.sharing.capacity} invited travellers joined`} />
                                <Fact icon={Star} label="Rating signal" value={item.rating.topFeeling || "No ratings yet"} detail={`${item.rating.completedTravellers} traveller timelines completed`} />
                              </div>

                              <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
                                <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4">
                                  <div className="flex items-baseline justify-between gap-3">
                                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Score by moment</p>
                                    <p className="m-0 text-[10px] text-neutral-400">{item.rating.totalEvents} moments</p>
                                  </div>
                                  {item.rating.eventPoints.length ? (
                                    <div className="mt-3 space-y-2">
                                      {item.rating.eventPoints.map((point) => {
                                        const t = scoreTone(point.average, point.ratingCount > 0);
                                        return (
                                          <div key={point.key} className="grid grid-cols-[76px_minmax(0,1fr)_40px] items-center gap-3 text-[11px]">
                                            <span className="truncate text-neutral-500">{point.axisLabel}</span>
                                            <span className="min-w-0">
                                              <span className="block truncate font-semibold text-neutral-800">{point.title}</span>
                                              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral-100">
                                                <span className={`block h-1.5 rounded-full ${t.bar}`} style={{ width: `${Math.max(0, Math.min(100, (point.average / 5) * 100))}%` }} />
                                              </span>
                                            </span>
                                            <span className={`text-right font-bold tabular-nums ${t.text}`}>{point.ratingCount ? point.average.toFixed(1) : "None"}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <p className="m-0 mt-3 rounded-lg border border-dashed border-neutral-200 px-3 py-5 text-center text-xs text-neutral-500">No timetable moments found.</p>
                                  )}
                                </div>

                                <div className="grid content-start gap-3">
                                  <div className="rounded-xl border border-solid border-emerald-100 bg-white p-3.5">
                                    <p className="m-0 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700"><TrendingUp className="h-3.5 w-3.5" aria-hidden /> Best moment</p>
                                    <p className="m-0 mt-1.5 text-sm font-bold text-neutral-900">{item.rating.highest?.title || "Waiting for ratings"}</p>
                                    <p className="m-0 mt-0.5 text-[11px] text-neutral-500">{item.rating.highest ? `${item.rating.highest.average} / 5 · ${item.rating.highest.label}` : "No ratings yet"}</p>
                                  </div>
                                  <div className="rounded-xl border border-solid border-amber-100 bg-white p-3.5">
                                    <p className="m-0 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700"><TrendingDown className="h-3.5 w-3.5" aria-hidden /> Weakest moment</p>
                                    <p className="m-0 mt-1.5 text-sm font-bold text-neutral-900">{item.rating.lowest?.title || "Waiting for ratings"}</p>
                                    <p className="m-0 mt-0.5 text-[11px] text-neutral-500">{item.rating.lowest ? `${item.rating.lowest.average} / 5 · ${item.rating.lowest.label}` : "No ratings yet"}</p>
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                                <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4">
                                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Traveller completion</p>
                                  <ul className="m-0 mt-2 list-none divide-y divide-solid divide-neutral-100 p-0">
                                    {item.rating.userCompletion.map((user) => (
                                      <li key={user.userId} className="flex items-center justify-between gap-3 py-2 text-xs">
                                        <span className="min-w-0">
                                          <span className="block truncate font-bold text-neutral-800">{user.name}</span>
                                          <span className="block text-[11px] text-neutral-400">{user.role}</span>
                                        </span>
                                        <span className={`shrink-0 rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold tabular-nums ${user.complete ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>
                                          {user.ratedEvents}/{user.totalEvents} rated
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4">
                                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Joined from shared link</p>
                                  {item.sharing.participants.length ? (
                                    <ul className="m-0 mt-2 list-none divide-y divide-solid divide-neutral-100 p-0">
                                      {item.sharing.participants.map((participant) => (
                                        <li key={participant.userId} className="flex items-center justify-between gap-3 py-2 text-xs">
                                          <span className="truncate font-bold text-neutral-800">{participant.name}</span>
                                          <span className="shrink-0 text-[11px] text-neutral-400">{dateText(participant.acceptedAt)}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="m-0 mt-2 rounded-lg border border-dashed border-neutral-200 px-3 py-5 text-center text-xs text-neutral-500">No invited travellers joined yet.</p>
                                  )}
                                </div>
                              </div>

                              <div className="mt-3 flex justify-end">
                                <Link
                                  href={`/admin/agents/tour-bookings?booking=${encodeURIComponent(item.bookingCode)}`}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-emerald-200 bg-white px-3 py-2 text-xs font-bold text-emerald-800 no-underline shadow-sm transition hover:bg-emerald-50"
                                >
                                  Open booking <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                                </Link>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right column */}
        <aside className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
            <SectionHeader icon={TrendingDown} tone="red" title="Improvement watch" subtitle="Lowest rated moments to raise with operators" />
            {topIssues.length ? (
              <ul className="m-0 list-none divide-y divide-solid divide-neutral-100 p-0">
                {topIssues.map((point) => {
                  const t = scoreTone(point.average);
                  return (
                    <li key={`${point.bookingCode}-${point.key}`}>
                      <button
                        type="button"
                        onClick={() => setExpandedId(point.itemId)}
                        className="flex w-full cursor-pointer items-start gap-3 border-0 bg-transparent px-4 py-3 text-left transition hover:bg-neutral-50 sm:px-5"
                      >
                        <span className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-solid text-xs font-bold tabular-nums ${t.chip}`}>
                          {point.average.toFixed(1)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-bold text-neutral-900">{point.title}</span>
                          <span className="mt-0.5 block truncate text-[11px] text-neutral-500">
                            <span className="font-mono">{point.bookingCode}</span> · {point.operatorName}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={ShieldCheck} title="Nothing to raise" text="No low-rated moments in this view." />
            )}
          </section>

          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
            <div className="flex items-baseline justify-between gap-3">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Rating health</p>
              <p className="m-0 text-[10px] text-neutral-400">{bands.rated} rated {bands.rated === 1 ? "timeline" : "timelines"}</p>
            </div>
            <p className="mb-0 mt-1 text-[11px] text-neutral-500">Timelines by average traveller score in this view.</p>
            <div className="mt-3 space-y-1.5">
              {bands.rows.map((row) => (
                <div key={row.label} className="grid grid-cols-[72px_minmax(60px,1fr)_auto] items-center gap-3">
                  <span className="text-[11px] text-neutral-600">{row.label}</span>
                  <span className="block h-1.5 overflow-hidden rounded-full bg-neutral-100">
                    <span className={`block h-1.5 rounded-full ${row.bar}`} style={{ width: `${pct(row.value, bands.rated)}%` }} />
                  </span>
                  <span className="flex min-w-[52px] items-center justify-end gap-1.5">
                    <span className={`text-[11px] font-bold ${row.text}`}>{pct(row.value, bands.rated)}%</span>
                    <span className="text-[10px] text-neutral-400">{row.value}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

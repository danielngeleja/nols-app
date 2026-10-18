"use client";

// Tour experience: how travellers rate each moment of a trip. The signature is the
// moment map: every package's itinerary as a strip of moments, coloured by the score
// pooled across all its trips, so a weak moment reads as a pattern, not a one-off.
// Data: /api/admin/tour-experience/overview (summary + momentMap are always all-time
// across every timeline; `status` only narrows the list).

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type EventPoint = { key: string; axisLabel: string; day: number; time?: string; title: string; average: number; ratingCount: number; label: string };

type ExperienceItem = {
  id: number;
  bookingCode: string;
  title: string;
  destination?: string | null;
  operatorName: string;
  customerName: string;
  travelerCount: number;
  lifecycleStatus: "WAITING_MEETUP" | "ACTIVE_TIMELINE" | "RATED" | string;
  meetup: { validated: boolean; validatedAt?: string | null };
  sharing: { generated: boolean; joined: number; capacity: number; participants: Array<{ userId: number; name: string; acceptedAt?: string | null }> };
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
  startDate?: string | null;
  updatedAt: string;
};

type Moment = { key: string; axisLabel: string; day: number; title: string; average: number; ratingCount: number; trips: number };
type PackageMap = { key: string; title: string; operatorName: string; trips: number; ratingCount: number; average: number; moments: Moment[] };

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
    ratedTimelines?: number;
    stageCounts?: Record<string, number>;
  };
  items: ExperienceItem[];
  momentMap?: PackageMap[];
};

const STAGES = [
  { value: "ALL", label: "All" },
  { value: "WAITING_MEETUP", label: "Waiting for meetup" },
  { value: "ACTIVE_TIMELINE", label: "Trip under way" },
  { value: "RATED", label: "Rated" },
] as const;

const STAGE_PILL: Record<string, string> = {
  RATED: "bg-emerald-50 text-emerald-700",
  ACTIVE_TIMELINE: "bg-sky-50 text-sky-700",
  WAITING_MEETUP: "bg-amber-50 text-amber-700",
};

// Fewer ratings than this behind a score is shown as thin evidence.
const THIN_EVIDENCE = 3;

const HERO_BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline";

// One scale for every score on the page.
function tone(score: number, has = true) {
  if (!has) return { cell: "bg-neutral-100 text-neutral-400", text: "text-neutral-400", bar: "bg-neutral-200", chip: "bg-neutral-100 text-neutral-400", word: "No ratings" };
  if (score >= 4.5) return { cell: "bg-emerald-600 text-white", text: "text-emerald-700", bar: "bg-emerald-600", chip: "bg-emerald-50 text-emerald-700", word: "Loved" };
  if (score >= 4) return { cell: "bg-emerald-400 text-white", text: "text-emerald-700", bar: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700", word: "Strong" };
  if (score >= 3) return { cell: "bg-amber-300 text-amber-950", text: "text-amber-700", bar: "bg-amber-400", chip: "bg-amber-50 text-amber-700", word: "Fair" };
  if (score >= 2) return { cell: "bg-rose-300 text-rose-950", text: "text-rose-700", bar: "bg-rose-400", chip: "bg-rose-50 text-rose-700", word: "Weak" };
  return { cell: "bg-rose-600 text-white", text: "text-rose-700", bar: "bg-rose-600", chip: "bg-rose-50 text-rose-700", word: "Poor" };
}

function eatDate(value?: string | null) {
  if (!value) return "Not recorded";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Not recorded";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function tidyName(value: string) {
  const v = String(value || "").trim();
  if (!v || /[a-z]/.test(v)) return v;
  return v.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function AdminTourExperiencePage() {
  const [payload, setPayload] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("ALL");
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const load = async (nextStatus = status) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<OverviewPayload>("/api/admin/tour-experience/overview", { params: { status: nextStatus } });
      setPayload(res.data);
    } catch (err: any) {
      setError(err?.response?.data?.error || "Failed to load tour experience.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = window.setTimeout(() => void load(status), 150);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const summary = payload?.summary;
  const total = summary?.total ?? 0;
  const average = Number(summary?.averageRating || 0);
  const hasRatings = (summary?.totalRatings ?? 0) > 0;
  const avgTone = tone(average, hasRatings);
  const momentMap = useMemo(() => payload?.momentMap ?? [], [payload]);

  const items = useMemo(() => {
    const list = payload?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((i) => `${i.bookingCode} ${i.title} ${i.destination || ""} ${i.operatorName} ${i.customerName}`.toLowerCase().includes(q));
  }, [payload, query]);

  // Moments to raise with operators: weak pooled scores, most evidence first among equals.
  const raise = useMemo(
    () =>
      momentMap
        .flatMap((pkg) => pkg.moments.filter((m) => m.ratingCount > 0 && m.average < 3.5).map((m) => ({ ...m, pkgTitle: pkg.title, operatorName: pkg.operatorName })))
        .sort((a, b) => a.average - b.average || b.ratingCount - a.ratingCount)
        .slice(0, 6),
    [momentMap]
  );

  // Rated timelines split by their own average.
  const bands = useMemo(() => {
    const rated = (payload?.items ?? []).filter((i) => i.rating.totalRatings > 0);
    const strong = rated.filter((i) => i.rating.averageRating >= 4).length;
    const fair = rated.filter((i) => i.rating.averageRating >= 3 && i.rating.averageRating < 4).length;
    return { rated: rated.length, strong, fair, weak: rated.length - strong - fair };
  }, [payload]);

  const funnel = [
    { label: "Meetup validated", value: summary?.meetupValidated ?? 0, of: total, note: "Operator and traveller met" },
    { label: "Timeline shared", value: summary?.inviteGenerated ?? 0, of: total, note: "Invite link generated" },
    { label: "Travellers joined", value: summary?.joinedTravellers ?? 0, of: null, note: "Through shared links" },
    { label: "Finished rating", value: summary?.completedTravellers ?? 0, of: null, note: `${plural(summary?.totalRatings ?? 0, "rating", "ratings")} in total` },
  ];

  return (
    <div id="tour-experience" className="w-full min-w-0 space-y-4">
      <style>{`#tour-experience, #tour-experience * { box-sizing: border-box; }`}</style>

      {/* Header: the experience pulse */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_100%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
                Tour operators
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-white/70"
                  title="Aggregate only. Invite tokens, session tokens and private timeline links are never shown here."
                >
                  <ShieldCheck className="h-3 w-3" aria-hidden /> Audit-safe
                </span>
              </p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tour experience</h1>
              <p className="m-0 mt-1 max-w-xl text-sm text-white/60">How travellers rate every moment of a trip, pooled across all trips of each package.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/admin/agents/tour-bookings" className={HERO_BUTTON}>Tour commerce</Link>
              <Link href="/admin/agents/tour-operators" className={HERO_BUTTON}>Tour operators</Link>
              <button type="button" onClick={() => void load()} aria-disabled={loading} aria-label="Refresh" title="Refresh" className={`${HERO_BUTTON} w-9 px-0`}>
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-center">
            {/* Overall score */}
            <div className="lg:border-0 lg:border-r lg:border-solid lg:border-white/10 lg:pr-6">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Average traveller score</p>
              <p className="m-0 mt-1 flex items-baseline gap-2">
                <span className={`text-5xl font-bold tabular-nums leading-none ${hasRatings ? "text-white" : "text-white/30"}`}>{loading && !summary ? "..." : hasRatings ? average.toFixed(1) : "None"}</span>
                {hasRatings ? <span className="text-sm text-white/50">/ 5 · {avgTone.word}</span> : null}
              </p>
              {bands.rated ? (
                <>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/10" aria-hidden>
                    <span className="bg-emerald-400" style={{ width: `${pct(bands.strong, bands.rated)}%` }} />
                    <span className="bg-amber-300" style={{ width: `${pct(bands.fair, bands.rated)}%` }} />
                    <span className="bg-rose-400" style={{ width: `${pct(bands.weak, bands.rated)}%` }} />
                  </div>
                  <p className="m-0 mt-1.5 text-[11px] text-white/50">
                    {plural(bands.rated, "rated trip", "rated trips")}: <span className="text-emerald-300">{bands.strong} strong</span> · <span className="text-amber-200">{bands.fair} fair</span> · <span className="text-rose-300">{bands.weak} weak</span>
                  </p>
                </>
              ) : (
                <p className="m-0 mt-2 text-[11px] text-white/45">Scores appear once travellers rate their trip.</p>
              )}
            </div>

            {/* Engagement funnel */}
            <ol className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-4 p-0 sm:grid-cols-4">
              {funnel.map((f) => (
                <li key={f.label} className="min-w-0">
                  <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">{f.label}</p>
                  <p className="m-0 mt-1.5 text-2xl font-bold tabular-nums leading-none text-white">
                    {loading && !summary ? "..." : f.value}
                    {f.of != null ? <span className="ml-1 text-sm font-medium text-white/40">/ {f.of}</span> : null}
                  </p>
                  {f.of != null ? (
                    <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/10"><span className="block h-full rounded-full bg-emerald-400" style={{ width: `${pct(f.value, f.of)}%` }} /></span>
                  ) : null}
                  <p className="m-0 mt-1.5 text-[11px] text-white/45">{f.note}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {error ? (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden /> {error}
        </div>
      ) : null}

      {/* Moment map */}
      <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-col gap-2 px-5 pb-3 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Moment map</p>
            <p className="m-0 mt-0.5 text-xs text-neutral-500">Each square is one itinerary moment. Its colour is the score from every trip of that package.</p>
          </div>
          <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-neutral-500">
            {[["Loved", 4.6], ["Strong", 4.1], ["Fair", 3.2], ["Weak", 2.2], ["Poor", 1.2]].map(([w, s]) => (
              <span key={w as string} className="inline-flex items-center gap-1"><span className={`h-2.5 w-2.5 rounded-[3px] ${tone(s as number).cell}`} aria-hidden /> {w}</span>
            ))}
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-[3px] border border-dashed border-neutral-400" aria-hidden /> Under {THIN_EVIDENCE} ratings</span>
          </p>
        </div>
        {loading && !payload ? (
          <div className="flex min-h-32 items-center justify-center border-0 border-t border-solid border-neutral-100 text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading" /></div>
        ) : momentMap.length === 0 ? (
          <p className="m-0 border-0 border-t border-solid border-neutral-100 px-5 py-10 text-center text-sm text-neutral-500">No trip has an itinerary timeline yet.</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {momentMap.map((pkg) => {
              const t = tone(pkg.average, pkg.ratingCount > 0);
              return (
                <li key={pkg.key} className="grid gap-3 border-0 border-t border-solid border-neutral-100 px-5 py-3.5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-center">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-bold tabular-nums ${t.chip}`}>{pkg.ratingCount ? pkg.average.toFixed(1) : "None"}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-neutral-900">{pkg.title}</span>
                      <span className="block truncate text-[11px] text-neutral-500">{pkg.operatorName} · {plural(pkg.trips, "trip", "trips")} · {plural(pkg.ratingCount, "rating", "ratings")}</span>
                    </span>
                  </div>
                  <div className="flex min-w-0 gap-1 overflow-x-auto pb-1">
                    {pkg.moments.map((m, idx) => {
                      const mt = tone(m.average, m.ratingCount > 0);
                      const thin = m.ratingCount > 0 && m.ratingCount < THIN_EVIDENCE;
                      const newDay = idx > 0 && pkg.moments[idx - 1].day !== m.day;
                      return (
                        <span key={m.key} className={`flex shrink-0 flex-col items-center ${newDay ? "ml-2" : ""}`}>
                          <span
                            className={`grid h-9 w-11 place-items-center rounded-md text-[11px] font-bold tabular-nums ${mt.cell} ${thin ? "outline outline-2 -outline-offset-2 outline-dashed outline-white/80" : ""}`}
                            title={`${m.axisLabel} ${m.title}: ${m.ratingCount ? `${m.average.toFixed(1)} from ${plural(m.ratingCount, "rating", "ratings")} on ${plural(m.trips, "trip", "trips")}` : "not rated yet"}`}
                          >
                            {m.ratingCount ? m.average.toFixed(1) : ""}
                          </span>
                          <span className="mt-1 text-[9px] tabular-nums text-neutral-400">{m.axisLabel}</span>
                        </span>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        {/* Timelines */}
        <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
          <div className="flex flex-col gap-2 px-5 pt-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500">Trips</p>
              <div className="mt-1 flex gap-1 overflow-x-auto" role="tablist" aria-label="Filter by stage">
                {STAGES.map((s) => {
                  const on = status === s.value;
                  const count = s.value === "ALL" ? total : summary?.stageCounts?.[s.value];
                  return (
                    <button
                      key={s.value}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => { setStatus(s.value); setExpandedId(null); }}
                      className={`relative inline-flex h-10 shrink-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 pr-3 text-sm font-semibold transition-colors first:pl-0 ${on ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-700"}`}
                    >
                      {s.label}
                      {count != null ? <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-500"}`}>{count}</span> : null}
                      {on ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-neutral-900" aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="relative w-full pb-2 sm:w-60">
              <Search className="pointer-events-none absolute left-3 top-[calc(50%-4px)] h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Code, tour, operator" aria-label="Search trips" className="block h-9 w-full rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-8 text-xs text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
              {query ? <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-1.5 top-[calc(50%-4px)] grid h-6 w-6 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-neutral-400 hover:bg-neutral-100"><X className="h-3.5 w-3.5" /></button> : null}
            </div>
          </div>

          {loading && !items.length ? (
            <div className="flex min-h-40 items-center justify-center border-0 border-t border-solid border-neutral-100 text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" aria-label="Loading trips" /></div>
          ) : !items.length ? (
            <p className="m-0 border-0 border-t border-solid border-neutral-100 px-5 py-12 text-center text-sm text-neutral-500">{query ? "No trip matches that search." : "No trips in this stage."}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {items.map((item) => {
                const open = expandedId === item.id;
                const rated = item.rating.totalRatings > 0;
                const t = tone(item.rating.averageRating, rated);
                const solo = item.sharing.capacity === 0;
                return (
                  <Fragment key={item.id}>
                    <li className={`border-0 border-t border-solid border-neutral-100 ${open ? "bg-neutral-50/70" : ""}`}>
                      <button type="button" onClick={() => setExpandedId(open ? null : item.id)} aria-expanded={open} className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-3 text-left transition hover:bg-emerald-50/40">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-sm font-bold tabular-nums ${t.chip}`}>{rated ? item.rating.averageRating.toFixed(1) : "None"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-[13px] font-semibold text-neutral-900">{item.title}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${STAGE_PILL[item.lifecycleStatus] ?? "bg-neutral-100 text-neutral-500"}`}>{STAGES.find((s) => s.value === item.lifecycleStatus)?.label ?? item.lifecycleStatus}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-neutral-500"><span className="font-mono">{item.bookingCode}</span> · {item.operatorName} · {tidyName(item.customerName)}</span>
                        </span>
                        {/* Rating strip of this trip's moments */}
                        <span className="hidden shrink-0 items-end gap-0.5 md:flex" aria-hidden>
                          {item.rating.eventPoints.slice(0, 14).map((p) => (
                            <span key={p.key} className={`w-1.5 rounded-sm ${tone(p.average, p.ratingCount > 0).bar}`} style={{ height: `${p.ratingCount ? 6 + (p.average / 5) * 18 : 4}px` }} />
                          ))}
                        </span>
                        <span className="hidden w-28 shrink-0 text-right text-[11px] text-neutral-500 sm:block">
                          {item.meetup.validated ? <span className="font-semibold text-emerald-700">Met up</span> : <span className="font-semibold text-amber-700">Not met yet</span>}
                          <span className="block">{solo ? "Solo trip" : `${item.sharing.joined}/${item.sharing.capacity} joined`} · {plural(item.rating.totalRatings, "rating", "ratings")}</span>
                        </span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
                      </button>

                      {open ? (
                        <div className="grid gap-3 px-5 pb-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
                          <div className="min-w-0 rounded-xl border border-solid border-neutral-200 bg-white p-4">
                            <p className="m-0 flex items-baseline justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">
                              Score by moment <span className="font-medium normal-case tracking-normal">{plural(item.rating.totalEvents, "moment", "moments")}</span>
                            </p>
                            {item.rating.eventPoints.length ? (
                              <ul className="m-0 mt-3 list-none space-y-2 p-0">
                                {item.rating.eventPoints.map((p) => {
                                  const pt = tone(p.average, p.ratingCount > 0);
                                  return (
                                    <li key={p.key} className="grid grid-cols-[48px_minmax(0,1fr)_64px] items-center gap-3 text-[11px]">
                                      <span className="tabular-nums text-neutral-400">{p.axisLabel}</span>
                                      <span className="min-w-0">
                                        <span className="block truncate font-semibold text-neutral-800">{p.title}{p.time ? <span className="font-normal text-neutral-400"> · {p.time}</span> : null}</span>
                                        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral-100"><span className={`block h-1.5 rounded-full ${pt.bar}`} style={{ width: `${(p.average / 5) * 100}%` }} /></span>
                                      </span>
                                      <span className={`text-right font-bold tabular-nums ${pt.text}`}>{p.ratingCount ? `${p.average.toFixed(1)} · ${p.ratingCount}` : "Not rated"}</span>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : (
                              <p className="m-0 mt-3 text-xs text-neutral-500">This trip has no itinerary moments.</p>
                            )}
                          </div>

                          <div className="grid content-start gap-3">
                            <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 text-xs">
                              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Trip</p>
                              <dl className="m-0 mt-2 space-y-1.5">
                                <div className="flex justify-between gap-2"><dt className="text-neutral-500">Meetup</dt><dd className="m-0 text-right font-semibold text-neutral-800">{item.meetup.validated ? eatDate(item.meetup.validatedAt) : "Not validated"}</dd></div>
                                <div className="flex justify-between gap-2"><dt className="text-neutral-500">Best moment</dt><dd className="m-0 truncate text-right font-semibold text-emerald-700">{item.rating.highest ? `${item.rating.highest.title} · ${item.rating.highest.average}` : "None yet"}</dd></div>
                                <div className="flex justify-between gap-2"><dt className="text-neutral-500">Weakest moment</dt><dd className="m-0 truncate text-right font-semibold text-rose-700">{item.rating.lowest ? `${item.rating.lowest.title} · ${item.rating.lowest.average}` : "None yet"}</dd></div>
                              </dl>
                            </div>
                            <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4">
                              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Who rated</p>
                              <ul className="m-0 mt-2 list-none space-y-2 p-0">
                                {item.rating.userCompletion.map((u) => (
                                  <li key={u.userId} className="flex items-center justify-between gap-2 text-xs">
                                    <span className="min-w-0">
                                      <span className="block truncate font-semibold text-neutral-800">{tidyName(u.name)}</span>
                                      <span className="block text-[10px] text-neutral-400">{u.role === "OWNER" ? "Booked the trip" : "Joined by link"}</span>
                                    </span>
                                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${u.complete ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{u.ratedEvents}/{u.totalEvents}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <Link href={`/admin/agents/tour-bookings?booking=${encodeURIComponent(item.bookingCode)}`} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#0b2420] text-xs font-semibold text-white no-underline hover:bg-[#12342f]">
                              Open in Tour commerce <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                            </Link>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  </Fragment>
                );
              })}
            </ul>
          )}
        </section>

        {/* Raise with operators */}
        <aside className="min-w-0 space-y-4">
          <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
            <p className="m-0 flex items-center gap-1.5 px-5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500"><TrendingDown className="h-3.5 w-3.5 text-rose-600" aria-hidden /> Raise with operators</p>
            <p className="m-0 px-5 pb-2 text-[11px] text-neutral-400">Weakest moments, pooled across every trip of the package.</p>
            {raise.length ? (
              <ul className="m-0 list-none p-0">
                {raise.map((m) => {
                  const mt = tone(m.average);
                  const thin = m.ratingCount < THIN_EVIDENCE;
                  return (
                    <li key={`${m.pkgTitle}-${m.key}`} className="flex items-start gap-3 border-0 border-t border-solid border-neutral-100 px-5 py-3">
                      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold tabular-nums ${mt.chip}`}>{m.average.toFixed(1)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold text-neutral-900">{m.title}</span>
                        <span className="block truncate text-[11px] text-neutral-500">{m.pkgTitle} · {m.axisLabel} · {m.operatorName}</span>
                        <span className={`mt-0.5 block text-[11px] ${thin ? "text-neutral-400" : "font-semibold text-rose-700"}`}>
                          {plural(m.ratingCount, "rating", "ratings")} on {plural(m.trips, "trip", "trips")}{thin ? ", too few to act on yet" : m.trips > 1 ? ", a repeat pattern" : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex items-center gap-3 border-0 border-t border-solid border-neutral-100 px-5 py-5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden /></span>
                <span className="text-xs text-neutral-600">{hasRatings ? "No moment is scoring below 3.5." : "Nothing rated yet."}</span>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-5">
            <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-neutral-500"><TrendingUp className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Best loved</p>
            {(() => {
              const best = momentMap.flatMap((p) => p.moments.filter((m) => m.ratingCount >= THIN_EVIDENCE).map((m) => ({ ...m, pkgTitle: p.title }))).sort((a, b) => b.average - a.average).slice(0, 3);
              return best.length ? (
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {best.map((m) => (
                    <li key={`${m.pkgTitle}-${m.key}`} className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0"><span className="block truncate font-semibold text-neutral-800">{m.title}</span><span className="block truncate text-[11px] text-neutral-400">{m.pkgTitle} · {plural(m.ratingCount, "rating", "ratings")}</span></span>
                      <span className="shrink-0 font-bold tabular-nums text-emerald-700">{m.average.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="m-0 mt-2 text-xs text-neutral-500">Needs at least {THIN_EVIDENCE} ratings on a moment.</p>
              );
            })()}
          </section>
        </aside>
      </div>
    </div>
  );
}

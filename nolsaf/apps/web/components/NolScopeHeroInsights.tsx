"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

/**
 * The hero's live answer to "Where is good in my month?". Reads the same
 * destination data as the estimator (best, peak and off-peak months), shows a
 * 12-month chart of how many places are at their best each month, a one-line
 * verdict for the chosen month, and the places ranked for it. Month changes
 * slide in the direction of travel and the list re-ranks with a stagger.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTHS.map((m) => m.slice(0, 3));

type Dest = { code: string; name: string; best: number[]; peak: number[]; offPeak: number[] };
type Fit = "great" | "quiet" | "shoulder" | "peak";

function parseMonths(value: unknown): number[] {
  let raw: unknown = value;
  if (typeof value === "string") {
    try {
      raw = JSON.parse(value);
    } catch {
      raw = value.split(/[,\s]+/);
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw.map(Number).filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
}

// Best conditions first, then quieter months, then peak crowds
const FIT: Record<Fit, { rank: number; label: string; tone: string }> = {
  great: { rank: 0, label: "Great time", tone: "bg-emerald-400/20 text-emerald-200 ring-emerald-300/30" },
  quiet: { rank: 1, label: "Off-peak", tone: "bg-sky-400/15 text-sky-200 ring-sky-300/25" },
  shoulder: { rank: 2, label: "Shoulder", tone: "bg-white/10 text-white/70 ring-white/15" },
  peak: { rank: 3, label: "Peak season", tone: "bg-amber-400/20 text-amber-200 ring-amber-300/30" },
};

function fitFor(d: Dest, month: number): Fit {
  if (d.peak.includes(month)) return "peak";
  if (d.best.includes(month)) return "great";
  if (d.offPeak.includes(month)) return "quiet";
  return "shoulder";
}

/** A plain verdict for the month, from how the places split across it. */
function verdict(counts: Record<Fit, number>, total: number): string {
  if (!total) return "";
  if (counts.peak / total >= 0.5) return "Busy month. Book stays and parks early.";
  if (counts.great / total >= 0.5) return "One of the best months to travel.";
  if (counts.quiet / total >= 0.5) return "Quieter month, often lower prices.";
  return "A mixed month. Pick places carefully.";
}

const MOTION_CSS = `
  @keyframes nsRowIn { from { opacity: 0; transform: translateY(8px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
  @keyframes nsFromRight { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
  @keyframes nsFromLeft { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
  @keyframes nsScan { from { transform: translateX(-100%); opacity: 0; } 20% { opacity: 1; } to { transform: translateX(100%); opacity: 0; } }
  .ns-row { animation: nsRowIn .42s cubic-bezier(.2,.8,.2,1) both; }
  .ns-right { animation: nsFromRight .38s cubic-bezier(.2,.8,.2,1) both; }
  .ns-left { animation: nsFromLeft .38s cubic-bezier(.2,.8,.2,1) both; }
  .ns-scan { animation: nsScan .9s ease-out both; }
  @media (prefers-reduced-motion: reduce) { .ns-row, .ns-right, .ns-left, .ns-scan { animation: none; } }
`;

export default function NolScopeHeroInsights() {
  const [dests, setDests] = useState<Dest[] | null>(null);
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [dir, setDir] = useState<1 | -1>(1);
  const [tick, setTick] = useState(0); // re-keys the animated parts on each change
  // Today's month, read after mount so the server render never disagrees with the browser
  const [nowMonth, setNowMonth] = useState<number | null>(null);
  useEffect(() => setNowMonth(new Date().getMonth() + 1), []);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/nolscope/destinations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setDests(
          (d?.destinations ?? []).map((r: any) => ({
            code: r.destinationCode ?? r.code,
            name: r.displayName ?? r.destinationName ?? r.name,
            best: parseMonths(r.bestMonths),
            peak: parseMonths(r.peakMonths),
            offPeak: parseMonths(r.offPeakMonths),
          }))
        );
      })
      .catch(() => alive && setDests([]));
    return () => {
      alive = false;
    };
  }, []);

  const goTo = (target: number) => {
    if (target === month) return;
    // Direction follows the shorter way round the year
    const forward = (target - month + 12) % 12;
    setDir(forward <= 6 ? 1 : -1);
    setMonth(target);
    setTick((t) => t + 1);
  };
  const shift = (by: number) => goTo(((month - 1 + by + 12) % 12) + 1);

  const ranked = useMemo(
    () => (dests ?? []).map((d) => ({ d, fit: fitFor(d, month) })).sort((a, b) => FIT[a.fit].rank - FIT[b.fit].rank),
    [dests, month]
  );

  // How many places are at their best in each month, for the chart
  const bestByMonth = useMemo(() => MONTHS.map((_, i) => (dests ?? []).filter((d) => fitFor(d, i + 1) === "great").length), [dests]);
  const maxBest = Math.max(1, ...bestByMonth);

  const counts = useMemo(() => {
    const c: Record<Fit, number> = { great: 0, quiet: 0, shoulder: 0, peak: 0 };
    ranked.forEach((r) => (c[r.fit] += 1));
    return c;
  }, [ranked]);

  const slide = dir === 1 ? "ns-right" : "ns-left";

  return (
    <div className="relative overflow-hidden rounded-2xl bg-white/[0.05] ring-1 ring-white/10">
      <style>{MOTION_CSS}</style>

      {/* Title and month controls */}
      <div className="relative px-5 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[12px] text-white/55">Best places to go in</p>
            <p key={`m-${tick}`} className={`m-0 mt-0.5 text-[22px] font-bold leading-tight text-white ${tick ? slide : ""}`} suppressHydrationWarning>
              {MONTHS[month - 1]}
            </p>
            {dests && dests.length ? (
              <p key={`v-${tick}`} className={`m-0 mt-1 text-[12.5px] text-emerald-100/80 ${tick ? slide : ""}`}>
                {verdict(counts, ranked.length)}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white transition hover:scale-105 hover:bg-white/20 active:scale-95">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" aria-label="Next month" onClick={() => shift(1)} className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-0 bg-white/10 text-white transition hover:scale-105 hover:bg-white/20 active:scale-95">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* The year at a glance: bar height = places at their best that month */}
        {dests && dests.length ? (
          <div className="relative mt-6" role="group" aria-label="Pick a month">
            <div className="flex h-12 items-end gap-1">
              {bestByMonth.map((count, i) => {
                const active = i + 1 === month;
                const isNow = i + 1 === nowMonth;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => goTo(i + 1)}
                    aria-label={`${MONTHS[i]}${isNow ? ", this month" : ""}: ${count} place${count === 1 ? "" : "s"} at their best`}
                    aria-pressed={active}
                    className="group relative flex h-full flex-1 cursor-pointer flex-col items-center justify-end border-0 bg-transparent p-0"
                  >
                    {/* Today's month: a glowing beacon with a radar ping, no words */}
                    {isNow ? (
                      <span aria-hidden className="pointer-events-none absolute -top-4 left-1/2 flex h-2.5 w-2.5 -translate-x-1/2 items-center justify-center">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300/70 motion-reduce:animate-none" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-200 shadow-[0_0_10px_3px_rgba(110,231,183,0.75)]" />
                      </span>
                    ) : null}
                    <span
                      className={`w-full rounded-t-[3px] transition-all duration-500 ${
                        active ? "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.7)]" : isNow ? "bg-white/45 group-hover:bg-white/55" : "bg-white/20 group-hover:bg-white/35"
                      }`}
                      style={{ height: `${Math.max(12, (count / maxBest) * 100)}%` }}
                    />
                  </button>
                );
              })}
            </div>
            <div className="mt-1 flex gap-1">
              {SHORT.map((m, i) => (
                <span
                  key={m}
                  className={`flex-1 text-center text-[9.5px] font-semibold transition-colors ${i + 1 === month ? "text-emerald-200" : i + 1 === nowMonth ? "text-white/85" : "text-white/35"}`}
                  style={i + 1 === nowMonth ? { textShadow: "0 0 8px rgba(110,231,183,0.9)" } : undefined}
                >
                  {m[0]}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {/* A light scan across the card on each change */}
        {tick ? (
          <span key={`s-${tick}`} aria-hidden className="ns-scan pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-200 to-transparent" />
        ) : null}
      </div>

      {/* Places ranked for the month */}
      <div className="border-0 border-t border-solid border-white/10 px-3 py-1">
        {dests === null ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[13px] text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading seasons
          </div>
        ) : ranked.length === 0 ? (
          <p className="m-0 py-10 text-center text-[13px] text-white/60">Season data is not available right now.</p>
        ) : (
          <ul key={`l-${tick}`} className="m-0 list-none p-0">
            {ranked.slice(0, 5).map(({ d, fit }, i) => (
              <li
                key={d.code}
                className="ns-row flex items-center gap-3 border-0 border-t border-solid border-white/[0.07] px-2 py-3 first:border-t-0"
                style={{ animationDelay: `${i * 55}ms` }}
              >
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-white/90">{d.name}</span>
                <span className={`flex-shrink-0 rounded-md px-2 py-1 text-[11px] font-bold ring-1 ring-inset ${FIT[fit].tone}`}>{FIT[fit].label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <a href="#estimator" suppressHydrationWarning className="group flex items-center justify-between border-0 border-t border-solid border-white/10 px-5 py-3 text-[13px] font-semibold text-emerald-200 no-underline hover:text-white">
        Price a trip for {MONTHS[month - 1]}
        <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </a>
    </div>
  );
}

"use client";

/**
 * Sales leaderboard: your place first, then the board. Points come only from
 * verified results; earnings never appear here.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Info, Loader2, Minus, Target, Trophy } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Entry = { rank: number; name: string; initials: string; region: string | null; level: string; points: number; confirmed: number; me: boolean };
type Board = {
  period: "month" | "quarter" | "all";
  scope: "national" | "region" | "team";
  month: string;
  hasTeam: boolean;
  hasRegion: boolean;
  total: number;
  me: {
    rank: number | null;
    points: number;
    movement: number;
    target: { goal: number; confirmed: number };
    gap: { rank: number; points: number } | null;
    breakdown: { confirmed: number; live: number; visits: number; revenuePoints: number; denials: number; reversalPoints: number } | null;
    excluded: boolean;
  };
  entries: Entry[];
};

const PERIODS = [["month", "This month"], ["quarter", "This quarter"], ["all", "All time"]] as const;
const SCOPES = [["national", "Tanzania"], ["region", "My region"], ["team", "My team"]] as const;

const LEVEL_TONE: Record<string, string> = {
  PLATINUM: "bg-slate-900 text-white",
  GOLD: "bg-amber-50 text-amber-800",
  SILVER: "bg-slate-100 text-slate-700",
  BRONZE: "bg-orange-50 text-orange-800",
};

function levelLabel(level: string) {
  const l = String(level || "").toLowerCase();
  return l.charAt(0).toUpperCase() + l.slice(1);
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
}

export default function SalesLeaderboardPage() {
  const [period, setPeriod] = useState<Board["period"]>("month");
  const [scope, setScope] = useState<Board["scope"]>("national");
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showRules, setShowRules] = useState(false);
  // Last month's winning team (a badge only, no money).
  const [topTeam, setTopTeam] = useState<{ name: string; month: string; mine: boolean } | null>(null);
  useEffect(() => {
    apiClient.get("/api/sales/team/status").then(({ data }) => setTopTeam(data?.topTeam ?? null)).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await apiClient.get<Board>("/api/sales/leaderboard", { params: { period, scope } });
      setBoard(data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load the leaderboard.");
    } finally {
      setLoading(false);
    }
  }, [period, scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const me = board?.me;
  const progress = me ? Math.min(100, Math.round((me.target.confirmed / Math.max(1, me.target.goal)) * 100)) : 0;

  return (
    <SalesShell>
      <div id="sales-leaderboard">
        <style>{`#sales-leaderboard, #sales-leaderboard * { box-sizing: border-box; }`}</style>
        <SalesPageHeader
          icon={Trophy}
          title="Leaderboard"
          description="Ranked on verified results only: owner-confirmed properties, live properties, clean visits and revenue after check-out."
        />

        {error && <p className="m-0 mt-4 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

        {topTeam ? (
          <section className={`mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-solid px-4 py-3 ${topTeam.mine ? "border-[#f5c451] bg-[#fffbeb]" : "border-slate-200 bg-white"}`}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#f5c451] text-[#4a3205]"><Trophy className="h-4 w-4" aria-hidden /></span>
            <div className="min-w-0">
              <p className="m-0 text-[12px] font-semibold text-[#4a3205]">Top team · {(() => { const [y, m] = topTeam.month.split("-").map(Number); return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }); })()}</p>
              <p className="m-0 text-sm font-bold text-slate-900">{topTeam.mine ? `Your team, ${topTeam.name}, finished first` : `${topTeam.name} finished first`}</p>
            </div>
          </section>
        ) : null}

        {/* Your place */}
        {me && (
          <section className="mt-5 grid gap-4 rounded-lg border border-solid border-slate-200 bg-white p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:p-5">
            <div className="flex items-center gap-4 sm:block sm:min-w-[88px] sm:text-center">
              <div>
                <p className="m-0 text-[12px] text-slate-500">Your rank</p>
                <p className="m-0 text-[34px] font-bold leading-none text-slate-900">{me.excluded ? "–" : me.rank ?? "–"}</p>
              </div>
              {!me.excluded && period === "month" && (
                <p className={`m-0 mt-1 inline-flex items-center gap-0.5 text-[12px] font-semibold ${me.movement > 0 ? "text-emerald-700" : me.movement < 0 ? "text-rose-700" : "text-slate-400"}`}>
                  {me.movement > 0 ? <ArrowUp className="h-3.5 w-3.5" /> : me.movement < 0 ? <ArrowDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                  {me.movement === 0 ? "No change this week" : `${Math.abs(me.movement)} this week`}
                </p>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-900"><Target className="h-4 w-4 text-[#02665e]" /> {board ? monthLabel(board.month) : ""} target</span>
                <span className="text-slate-600">{me.target.confirmed} of {me.target.goal} confirmed properties</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full rounded-full bg-[#02665e] transition-[width] duration-500" style={{ width: `${progress}%` }} />
              </div>
              <p className="m-0 mt-2 text-[13px] text-slate-600">
                {me.excluded
                  ? "You are not on this month's board. Contact NoLSAF support for details."
                  : me.gap
                    ? `${me.gap.points} points behind number ${me.gap.rank}. ${me.gap.points <= 50 ? "One owner-confirmed property gets you there." : "Each owner-confirmed property is worth 50."}`
                    : me.rank === 1
                      ? "You are number 1. Keep your lead with verified results."
                      : "Every owner-confirmed property is worth 50 points."}
              </p>
            </div>

            <div className="flex items-end justify-between gap-4 sm:block sm:text-right">
              <div>
                <p className="m-0 text-[12px] text-slate-500">Points</p>
                <p className="m-0 text-2xl font-bold text-slate-900">{me.points.toLocaleString("en-US")}</p>
              </div>
              <button type="button" onClick={() => setShowRules((v) => !v)} className="mt-1 inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[12px] font-semibold text-[#02665e] [font-family:inherit]">
                <Info className="h-3.5 w-3.5" /> How points work
              </button>
            </div>

            {showRules && (
              <div className="rounded-lg bg-slate-50 p-3 text-[13px] text-slate-700 sm:col-span-3">
                <ul className="m-0 grid list-none gap-1.5 p-0 sm:grid-cols-2">
                  <li><b className="text-slate-900">+50</b> owner confirms you brought them {me.breakdown ? <span className="text-slate-500">· you: {me.breakdown.confirmed}</span> : null}</li>
                  <li><b className="text-slate-900">+30</b> a property's first booking {me.breakdown ? <span className="text-slate-500">· you: {me.breakdown.live}</span> : null}</li>
                  <li><b className="text-slate-900">+5</b> clean visit, up to 3 per lead {me.breakdown ? <span className="text-slate-500">· you: {me.breakdown.visits}</span> : null}</li>
                  <li><b className="text-slate-900">+1</b> per TSh 10,000 NoLSAF revenue after check-out {me.breakdown ? <span className="text-slate-500">· you: {me.breakdown.revenuePoints}</span> : null}</li>
                  <li><b className="text-rose-700">−40</b> owner says no, or doesn't know you {me.breakdown ? <span className="text-slate-500">· you: {me.breakdown.denials}</span> : null}</li>
                  <li><b className="text-rose-700">−</b> revenue points from reversed commissions {me.breakdown ? <span className="text-slate-500">· you: {me.breakdown.reversalPoints}</span> : null}</li>
                </ul>
                <p className="m-0 mt-2 text-[12px] text-slate-500">Flagged visits count once NoLSAF reviews them. The month resets on the 1st, so everyone can win next month.</p>
              </div>
            )}
          </section>
        )}

        {/* Filters */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period">
            {PERIODS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setPeriod(value)} aria-pressed={period === value}
                className={`h-8 rounded-full border border-solid px-3 text-[13px] font-semibold [font-family:inherit] transition ${period === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Who to compare with">
            {SCOPES.filter(([value]) => (value === "team" ? board?.hasTeam : value === "region" ? board?.hasRegion !== false : true)).map(([value, label]) => (
              <button key={value} type="button" onClick={() => setScope(value)} aria-pressed={scope === value}
                className={`h-8 rounded-full border border-solid px-3 text-[13px] font-semibold [font-family:inherit] transition ${scope === value ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-300 bg-white text-slate-600 hover:border-slate-400"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Board */}
        <section className="mt-3 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white" aria-live="polite">
          {loading && !board ? (
            <div className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
          ) : !board?.entries.length ? (
            <div className="p-6 text-center text-sm text-slate-600">No one has scored yet this period. The first owner-confirmed property takes the lead.</div>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
              <table className="w-full border-collapse text-left">
                <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="w-14 px-4 py-2.5 text-center">Rank</th>
                    <th scope="col" className="px-3 py-2.5">Representative</th>
                    <th scope="col" className="hidden px-3 py-2.5 sm:table-cell">Region</th>
                    <th scope="col" className="hidden px-3 py-2.5 md:table-cell">Level</th>
                    <th scope="col" className="px-3 py-2.5 text-right">Confirmed</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {board.entries.map((entry) => (
                    <tr key={`${entry.rank}-${entry.name}`} className={`border-0 border-t border-solid border-slate-100 ${entry.me ? "bg-emerald-50/70" : "hover:bg-slate-50/60"}`}>
                      <td className={`px-4 py-3 text-center text-[15px] font-bold ${entry.rank === 1 ? "text-amber-600" : entry.rank <= 3 ? "text-amber-700/80" : "text-slate-400"}`}>
                        {entry.rank <= 3 ? <Trophy className="mx-auto h-4 w-4" aria-label={`Rank ${entry.rank}`} /> : entry.rank}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[12px] font-bold ${entry.me ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-600"}`}>{entry.initials}</span>
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-semibold text-slate-900">{entry.name}</p>
                            <p className="m-0 text-[12px] text-slate-500 sm:hidden">{entry.region || "Tanzania"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 text-[13px] text-slate-600 sm:table-cell">{entry.region || "Tanzania"}</td>
                      <td className="hidden px-3 py-3 md:table-cell">
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${LEVEL_TONE[entry.level] ?? "bg-slate-100 text-slate-600"}`}>{levelLabel(entry.level)}</span>
                      </td>
                      <td className="px-3 py-3 text-right text-[13px] tabular-nums text-slate-700">{entry.confirmed}</td>
                      <td className="px-4 py-3 text-right text-[15px] font-bold tabular-nums text-slate-900">{entry.points.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        {board && board.total > board.entries.length && (
          <p className="m-0 mt-2 text-center text-[12px] text-slate-500">Showing the top {board.entries.length - (board.entries.some((e) => e.me && e.rank > 50) ? 1 : 0)} of {board.total}.</p>
        )}
        <p className="m-0 mt-3 text-center text-[12px] text-slate-500">Names show first name and initial. Earnings are never shown on the leaderboard.</p>
      </div>
    </SalesShell>
  );
}

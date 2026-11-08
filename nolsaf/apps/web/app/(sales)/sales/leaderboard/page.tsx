"use client";

/**
 * Sales leaderboard: your place first, then the board. Points come only from
 * verified results; earnings never appear here.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown, ChevronUp, Info, Loader2, Minus, Sparkles, Target, Trophy } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import SalesPager from "@/components/sales/SalesPager";
import PointsRulesDialog from "@/components/sales/PointsRulesDialog";

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

const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500";
type SortKey = "rank" | "name" | "region" | "level" | "confirmed" | "points";
const LEVEL_ORDER: Record<string, number> = { STARTER: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4 };
/** First click direction per column: the useful end first. */
const FIRST: Record<SortKey, "asc" | "desc"> = { rank: "asc", name: "asc", region: "asc", level: "desc", confirmed: "desc", points: "desc" };

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
  const [sort, setSort] = useState<SortKey>("rank");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
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
      setPage(1);
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

  // Sort and page the loaded board (the top 50 plus you) in the browser.
  const sorted = useMemo(() => {
    const rows = [...(board?.entries ?? [])];
    const value = (e: Entry): string | number => {
      switch (sort) {
        case "name": return e.name.toLowerCase();
        case "region": return (e.region || "Tanzania").toLowerCase();
        case "level": return LEVEL_ORDER[e.level] ?? 0;
        case "confirmed": return e.confirmed;
        case "points": return e.points;
        default: return e.rank;
      }
    };
    rows.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return (direction === "asc" ? cmp : -cmp) || a.rank - b.rank;
    });
    return rows;
  }, [board, sort, direction]);
  const visible = sorted.slice((page - 1) * pageSize, page * pageSize);
  const myIndex = sorted.findIndex((e) => e.me);
  const myPage = myIndex >= 0 ? Math.floor(myIndex / pageSize) + 1 : null;

  const sortBy = (key: SortKey) => {
    if (sort === key) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDirection(FIRST[key]); }
    setPage(1);
  };
  const sortHead = (key: SortKey, label: string, extra = "", align: "left" | "right" | "center" = "left") => {
    const active = sort === key;
    return (
      <th scope="col" className={`${th} ${extra}`} aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" onClick={() => sortBy(key)} className={`inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-semibold ${align === "right" ? "flex-row-reverse" : ""} ${active ? "text-slate-900" : "text-slate-500 hover:text-slate-800"}`}>
          {label}
          {!active ? <ChevronsUpDown className="h-3 w-3 text-slate-300" aria-hidden /> : direction === "asc" ? <ChevronUp className="h-3 w-3 text-[#02665e]" aria-hidden /> : <ChevronDown className="h-3 w-3 text-[#02665e]" aria-hidden />}
        </button>
      </th>
    );
  };
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

        {/* Your standing: one joined panel */}
        {me && (
          <section className="mt-4 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white" aria-label="Your standing">
            <div className="grid grid-cols-2 gap-px bg-slate-200 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1.4fr)]">
              <div className="min-w-0 bg-white px-4 py-3.5">
                <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><Trophy className="h-3.5 w-3.5" aria-hidden /> Your rank</p>
                <p className="m-0 mt-1 text-2xl font-bold tabular-nums leading-tight text-slate-900">
                  {me.excluded || !me.rank ? "–" : `#${me.rank}`}
                  {!me.excluded && me.rank && board ? <span className="ml-1 text-[13px] font-medium text-slate-400">of {board.total}</span> : null}
                </p>
                {!me.excluded && period === "month" ? (
                  <p className={`m-0 inline-flex items-center gap-0.5 text-[12px] font-semibold ${me.movement > 0 ? "text-emerald-700" : me.movement < 0 ? "text-rose-700" : "text-slate-400"}`}>
                    {me.movement > 0 ? <ArrowUp className="h-3.5 w-3.5" aria-hidden /> : me.movement < 0 ? <ArrowDown className="h-3.5 w-3.5" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
                    {me.movement === 0 ? "No change this week" : `${Math.abs(me.movement)} this week`}
                  </p>
                ) : <p className="m-0 text-[12px] text-slate-400">{SCOPES.find(([v]) => v === scope)?.[1]}</p>}
              </div>
              <div className="min-w-0 bg-white px-4 py-3.5">
                <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><Sparkles className="h-3.5 w-3.5" aria-hidden /> Points</p>
                <p className="m-0 mt-1 text-2xl font-bold tabular-nums leading-tight text-slate-900">{me.points.toLocaleString("en-US")}</p>
                <button type="button" onClick={() => setShowRules(true)} aria-haspopup="dialog" className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[12px] font-semibold text-[#02665e] hover:underline">
                  <Info className="h-3.5 w-3.5" aria-hidden /> How points work
                </button>
              </div>
              <div className="min-w-0 bg-white px-4 py-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><Target className="h-3.5 w-3.5" aria-hidden /> {board ? monthLabel(board.month) : ""} target</p>
                  <span className="text-[12px] font-semibold tabular-nums text-slate-700">{progress}%</span>
                </div>
                <p className="m-0 mt-1 text-[15px] font-semibold tabular-nums text-slate-900">{me.target.confirmed} of {me.target.goal} <span className="text-[12px] font-normal text-slate-500">owner-confirmed properties</span></p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-[#02665e] transition-[width] duration-500" style={{ width: `${progress}%` }} />
                </div>
              </div>
              <div className="min-w-0 bg-white px-4 py-3.5">
                <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><ArrowUp className="h-3.5 w-3.5" aria-hidden /> Your next move</p>
                <p className="m-0 mt-1 text-[13px] leading-5 text-slate-800">
                  {me.excluded
                    ? "You are not on this month's board. Contact NoLSAF support for details."
                    : me.gap
                      ? `${me.gap.points} points behind #${me.gap.rank}. ${me.gap.points <= 50 ? "One owner-confirmed property gets you there." : "Each owner-confirmed property is worth 50."}`
                      : me.rank === 1
                        ? "You lead. Keep it with verified results: confirmed properties and clean visits."
                        : "Every owner-confirmed property is worth 50 points."}
                </p>
              </div>
            </div>

          </section>
        )}

        {/* Board */}
        <section className="mt-4 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-slate-100 px-4 py-2.5">
            <div className="inline-flex rounded-md bg-slate-100 p-0.5" role="group" aria-label="Period">
              {PERIODS.map(([value, label]) => (
                <button key={value} type="button" onClick={() => setPeriod(value)} aria-pressed={period === value}
                  className={`h-7 rounded border-0 px-3 text-[12px] font-semibold transition ${period === value ? "bg-white text-slate-900 shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-800"}`}>
                  {label}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-md bg-slate-100 p-0.5" role="group" aria-label="Who to compare with">
              {SCOPES.filter(([value]) => (value === "team" ? board?.hasTeam : value === "region" ? board?.hasRegion !== false : true)).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setScope(value)} aria-pressed={scope === value}
                  className={`h-7 rounded border-0 px-3 text-[12px] font-semibold transition ${scope === value ? "bg-[#02665e] text-white shadow-sm" : "bg-transparent text-slate-500 hover:text-slate-800"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {loading && !board ? (
            <div className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading</div>
          ) : !board?.entries.length ? (
            <div className="px-4 py-10 text-center">
              <Trophy className="mx-auto h-6 w-6 text-slate-300" aria-hidden />
              <p className="m-0 mt-2 text-sm font-medium text-slate-800">Nobody has scored yet this period</p>
              <p className="m-0 mt-1 text-[13px] text-slate-500">The first owner-confirmed property takes the lead.</p>
            </div>
          ) : (
            <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
              <table className="w-full min-w-[560px] border-collapse text-left">
                <thead className="bg-slate-50">
                  <tr>
                    {sortHead("rank", "Rank", "w-20 pl-4 text-center", "center")}
                    {sortHead("name", "Representative")}
                    {sortHead("region", "Region", "hidden sm:table-cell")}
                    {sortHead("level", "Level", "hidden md:table-cell")}
                    {sortHead("confirmed", "Confirmed", "text-right", "right")}
                    {sortHead("points", "Points", "pr-4 text-right", "right")}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => (
                    <tr key={`${entry.rank}-${entry.name}`} className={`border-0 border-t border-solid border-slate-100 ${entry.me ? "bg-[#02665e]/[0.06]" : "hover:bg-slate-50/60"}`}>
                      <td className="py-3 pl-4 pr-3 text-center">
                        {entry.rank <= 3 ? (
                          <span className={`inline-grid h-7 w-7 place-items-center rounded-md text-[12px] font-bold ${entry.rank === 1 ? "bg-amber-100 text-amber-800" : entry.rank === 2 ? "bg-slate-200 text-slate-700" : "bg-orange-100 text-orange-800"}`} aria-label={`Rank ${entry.rank}`}>{entry.rank}</span>
                        ) : (
                          <span className="text-[13px] font-semibold tabular-nums text-slate-400">{entry.rank}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md text-[11px] font-bold ${entry.me ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-600"}`}>{entry.initials}</span>
                          <div className="min-w-0">
                            <p className="m-0 truncate text-[13px] font-semibold text-slate-900">{entry.me ? entry.name.replace(/ \(you\)$/, "") : entry.name}{entry.me ? <span className="ml-1.5 rounded bg-[#02665e] px-1.5 py-px text-[10px] font-semibold text-white">You</span> : null}</p>
                            <p className="m-0 text-[11px] text-slate-500 sm:hidden">{entry.region || "Tanzania"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="hidden px-3 py-3 text-[12px] text-slate-600 sm:table-cell">{entry.region || "Tanzania"}</td>
                      <td className="hidden px-3 py-3 md:table-cell">
                        <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${LEVEL_TONE[entry.level] ?? "bg-slate-100 text-slate-600"}`}>{levelLabel(entry.level)}</span>
                      </td>
                      <td className="px-3 py-3 text-right text-[13px] tabular-nums text-slate-700">{entry.confirmed}</td>
                      <td className="py-3 pl-3 pr-4 text-right text-[14px] font-bold tabular-nums text-slate-900">{entry.points.toLocaleString("en-US")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {board && board.entries.length ? (
            <SalesPager
              page={page}
              pageSize={pageSize}
              total={sorted.length}
              noun="representatives"
              onPage={setPage}
              onPageSize={(size) => { setPageSize(size); setPage(1); }}
            />
          ) : null}
          {myPage && myPage !== page ? (
            <div className="flex justify-center border-0 border-t border-solid border-slate-100 px-4 py-2">
              <button type="button" onClick={() => setPage(myPage)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-[#02665e]/30 bg-[#02665e]/[0.06] px-3 text-[12px] font-semibold text-[#02665e] hover:bg-[#02665e]/10">
                Jump to my row (page {myPage})
              </button>
            </div>
          ) : null}
          <p className="m-0 flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
            <span>Names show first name and initial. Earnings are never shown here.</span>
            {board && board.total > board.entries.length ? (
              <span>Top {board.entries.length - (board.entries.some((e) => e.me && e.rank > 50) ? 1 : 0)} of {board.total}</span>
            ) : null}
          </p>
        </section>
        {showRules && me ? (
          <PointsRulesDialog
            breakdown={me.breakdown}
            total={me.points}
            periodLabel={period === "month" ? (board ? monthLabel(board.month) : "this month") : period === "quarter" ? "this quarter" : "all time"}
            onClose={() => setShowRules(false)}
          />
        ) : null}
      </div>
    </SalesShell>
  );
}

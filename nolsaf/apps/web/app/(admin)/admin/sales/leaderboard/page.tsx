"use client";

/**
 * Admin leaderboard: real names, full point breakdown, badges, team ranking,
 * exclusions with a reason, and a CSV export. Past months show the result
 * frozen when the month closed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Lock, RefreshCw, Trophy, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";
import LeaderboardExclusionDialog from "@/components/admin/sales/LeaderboardExclusionDialog";

type Breakdown = { confirmed: number; live: number; visits: number; flaggedVisits: number; revenuePoints: number; denials: number; reversalPoints: number };
type Entry = {
  partnerId: number;
  rank: number | null;
  points: number;
  breakdown: Breakdown | null;
  name: string;
  agentCode: string;
  region: string | null;
  level: string | null;
  target: number | null;
  excluded: boolean;
  excludedReason: string | null;
  badges: string[];
};
type Board = { month: string; live: boolean; closed: boolean; entries: Entry[] };
type Team = { id: number; name: string; rank: number; points: number; lead: { name: string }; members: Array<{ partnerId: number }>; topTeam?: { month: string } | null };

/** "2026-10" as "Oct 2026". */
function shortMonth(key: string) {
  const [y, m] = key.split("-").map(Number);
  return y && m ? new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : key;
}

const BADGE_TEXT: Record<string, string> = { TOP_1: "1st", TOP_2: "2nd", TOP_3: "3rd", RISING_STAR: "Rising star", MOST_TRUSTED: "Most trusted" };

function monthKeyNow() {
  const eat = new Date(Date.now() + 3 * 3_600_000);
  return `${eat.getUTCFullYear()}-${String(eat.getUTCMonth() + 1).padStart(2, "0")}`;
}
function shift(key: string, delta: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monthName(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default function AdminSalesLeaderboardPage() {
  const current = monthKeyNow();
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => shift(current, -i)), [current]);
  const [month, setMonth] = useState(current);
  const [board, setBoard] = useState<Board | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [asking, setAsking] = useState<Entry | null>(null);
  const [dialogError, setDialogError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [b, t] = await Promise.all([
        apiClient.get<Board>("/api/admin/sales/leaderboard", { params: { month } }),
        month === current ? apiClient.get("/api/admin/sales/teams") : Promise.resolve({ data: { teams: [] } }),
      ]);
      setBoard(b.data);
      setTeams((t as any).data.teams ?? []);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load the leaderboard.");
    } finally {
      setLoading(false);
    }
  }, [month, current]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExclusion = (entry: Entry) => {
    setDialogError("");
    setAsking(entry);
  };

  const confirmExclusion = async (reason: string) => {
    if (!asking) return;
    setBusy(asking.partnerId);
    setDialogError("");
    try {
      await apiClient.post(`/api/admin/sales/leaderboard/${asking.excluded ? "restore" : "exclude"}`, { salesPartnerId: asking.partnerId, month, reason });
      setAsking(null);
      await load();
    } catch (cause: any) {
      setDialogError(cause?.response?.data?.error || "That did not work. Nothing was changed.");
    } finally {
      setBusy(null);
    }
  };

  const exportCsv = () => {
    if (!board) return;
    const head = ["Rank", "Name", "ID number", "Region", "Level", "Points", "Confirmed", "Live", "Visits", "Flagged visits", "Revenue points", "Owner denials", "Reversal points", "Target", "Badges", "Excluded reason"];
    const rows = board.entries.map((e) => [
      e.rank ?? "", e.name, e.agentCode, e.region ?? "", e.level ?? "", e.points,
      e.breakdown?.confirmed ?? "", e.breakdown?.live ?? "", e.breakdown?.visits ?? "", e.breakdown?.flaggedVisits ?? "",
      e.breakdown?.revenuePoints ?? "", e.breakdown?.denials ?? "", e.breakdown?.reversalPoints ?? "",
      e.target ?? "", (e.badges || []).map((b) => BADGE_TEXT[b] ?? b).join(" "), e.excludedReason ?? "",
    ]);
    const csv = [head, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `NoLSAF-sales-leaderboard-${month}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <div className="w-full min-w-0 space-y-5">
      <header className="rounded-lg border border-solid border-[#12342f] bg-[#0b2420] px-5 py-4 text-white">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300/80">
              Sales
              <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-white/70"><Lock className="h-3 w-3" /> Admin only</span>
            </p>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white">Leaderboard</h1>
            <p className="m-0 mt-0.5 text-[13px] text-white/60">Verified results only. Partners see first names and points; you see everything.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Month stepper: one control instead of a dropdown */}
            <div className="inline-flex h-9 items-stretch overflow-hidden rounded-md border border-solid border-white/15 bg-white/[0.04]">
              <button type="button" onClick={() => setMonth(shift(month, -1))} disabled={month === months[months.length - 1]} className="grid w-8 place-items-center border-0 bg-transparent text-white/70 [font-family:inherit] hover:bg-white/10 hover:text-white disabled:opacity-30" aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="flex min-w-[150px] items-center justify-center gap-1.5 border-0 border-x border-solid border-white/10 px-3 text-xs font-semibold text-white">
                {monthName(month)}
                {month === current && <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Live</span>}
              </span>
              <button type="button" onClick={() => setMonth(shift(month, 1))} disabled={month === current} className="grid w-8 place-items-center border-0 bg-transparent text-white/70 [font-family:inherit] hover:bg-white/10 hover:text-white disabled:opacity-30" aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="inline-flex h-9 items-stretch overflow-hidden rounded-md border border-solid border-white/15 bg-white/[0.04]">
              <button type="button" onClick={exportCsv} disabled={!board?.entries.length} className="inline-flex items-center gap-1.5 border-0 bg-transparent px-3 text-xs font-semibold text-white/85 [font-family:inherit] hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/35 disabled:hover:bg-transparent">
                <Download className="h-3.5 w-3.5" /> Export CSV
              </button>
              <button type="button" onClick={() => void load()} disabled={loading} className="grid w-9 place-items-center border-0 border-l border-solid border-white/10 bg-transparent text-white/80 [font-family:inherit] hover:bg-white/10 hover:text-white" aria-label="Refresh" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {error && <p className="m-0 rounded-md border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}

      {month === current && teams.length > 0 && (
        <section className="rounded-lg border border-solid border-neutral-200 bg-white p-4">
          <h2 className="m-0 flex items-center gap-1.5 text-sm font-bold text-neutral-900"><Users className="h-4 w-4" /> Teams this month</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((t) => (
              <div key={t.id} className={`flex items-center justify-between rounded-md border border-solid px-3 py-2.5 ${t.topTeam ? "border-[#f5c451] bg-[#fffbeb]" : "border-neutral-100"}`}>
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-semibold text-neutral-900">{t.rank}. {t.name}</p>
                  <p className="m-0 text-xs text-neutral-500">Lead {t.lead.name} · {t.members.length} {t.members.length === 1 ? "member" : "members"}</p>
                  {t.topTeam ? (
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-[#f5c451] px-1.5 py-0.5 text-[11px] font-bold text-[#4a3205]">
                      <Trophy className="h-3 w-3" aria-hidden /> Top team · {shortMonth(t.topTeam.month)}
                    </span>
                  ) : null}
                </div>
                <p className="m-0 text-sm font-bold tabular-nums text-neutral-900">{t.points.toLocaleString("en-US")}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-0 border-b border-solid border-neutral-100 px-4 py-3">
          <h2 className="m-0 flex items-center gap-1.5 text-sm font-bold text-neutral-900"><Trophy className="h-4 w-4" /> {board ? monthName(board.month) : ""}</h2>
          <span className="text-xs text-neutral-500">{board ? (board.live ? "Live, updates every minute" : board.closed ? "Final result" : "Not closed yet") : ""}</span>
        </div>
        {loading && !board ? (
          <div className="flex items-center gap-2 p-5 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
        ) : !board?.entries.length ? (
          <p className="m-0 p-5 text-sm text-neutral-500">No results for this month.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-xs">
              <thead className="bg-neutral-50 text-[10px] font-bold uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2.5">Rank</th>
                  <th className="px-3 py-2.5">Representative</th>
                  <th className="px-3 py-2.5 text-right">Points</th>
                  <th className="px-3 py-2.5 text-right">Confirmed</th>
                  <th className="px-3 py-2.5 text-right">Live</th>
                  <th className="px-3 py-2.5 text-right">Visits</th>
                  <th className="px-3 py-2.5 text-right">Revenue pts</th>
                  <th className="px-3 py-2.5 text-right">Penalties</th>
                  <th className="px-3 py-2.5">Badges</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {board.entries.map((e) => (
                  <tr key={e.partnerId} className={`border-0 border-t border-solid border-neutral-100 ${e.excluded ? "bg-neutral-50 text-neutral-400" : ""}`}>
                    <td className="px-3 py-2.5 font-bold text-neutral-900">{e.excluded ? "–" : e.rank}</td>
                    <td className="px-3 py-2.5">
                      <p className="m-0 font-semibold text-neutral-900">{e.name}</p>
                      <p className="m-0 text-neutral-500"><span className="font-mono">{e.agentCode}</span> · {e.region || "No region"}{e.target ? ` · target ${e.target}` : ""}</p>
                      {e.excluded && e.excludedReason && <p className="m-0 text-rose-700">Excluded: {e.excludedReason}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold tabular-nums text-neutral-900">{e.points.toLocaleString("en-US")}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{e.breakdown?.confirmed ?? "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{e.breakdown?.live ?? "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {e.breakdown?.visits ?? "–"}
                      {e.breakdown?.flaggedVisits ? <span className="ml-1 text-amber-700">+{e.breakdown.flaggedVisits} flagged</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{e.breakdown?.revenuePoints ?? "–"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {e.breakdown && (e.breakdown.denials || e.breakdown.reversalPoints)
                        ? <span className="text-rose-700">{e.breakdown.denials ? `${e.breakdown.denials} denial${e.breakdown.denials === 1 ? "" : "s"}` : ""}{e.breakdown.denials && e.breakdown.reversalPoints ? ", " : ""}{e.breakdown.reversalPoints ? `−${e.breakdown.reversalPoints}` : ""}</span>
                        : "–"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {(e.badges || []).map((b) => <span key={b} className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">{BADGE_TEXT[b] ?? b}</span>)}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {board.live && (
                        <button type="button" onClick={() => toggleExclusion(e)} disabled={busy === e.partnerId} className={`h-7 rounded-md border border-solid px-2 text-[11px] font-semibold [font-family:inherit] disabled:opacity-50 ${e.excluded ? "border-neutral-200 bg-white text-neutral-700" : "border-rose-200 bg-white text-rose-700"}`}>
                          {e.excluded ? "Restore" : "Exclude"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {asking ? (
        <LeaderboardExclusionDialog
          target={asking}
          monthLabel={monthName(month)}
          busy={busy === asking.partnerId}
          error={dialogError}
          onCancel={() => setAsking(null)}
          onConfirm={(reason) => void confirmExclusion(reason)}
        />
      ) : null}
    </div>
  );
}

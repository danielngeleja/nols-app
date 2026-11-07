"use client";

/**
 * Team health: which teams are doing well and why. Per member, not totals,
 * so size never beats quality. Read only; leads get the weekly tip and admins
 * the at-risk alert automatically (lib/salesTeamHealth.ts).
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChevronDown, HeartPulse, Lightbulb, Loader2, Minus, RefreshCw } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";
import NextMonthTargets from "@/components/admin/sales/NextMonthTargets";

type Label = "STRONG" | "STEADY" | "NEEDS_SUPPORT" | "AT_RISK";
type Team = {
  teamId: number;
  name: string;
  region: string | null;
  lead: { name: string; agentCode: string };
  members: number;
  label: Label;
  score: number;
  reasons: string[];
  tip: string | null;
  metrics: {
    pointsThisMonth: number;
    perMemberLastMonth: number;
    perMemberBefore: number | null;
    trendPercent: number | null;
    conversionPercent: number | null;
    leadsOpened90d: number;
    confirmed90d: number;
    qualityIssues: number;
    pausedMembers: number;
    openLeads: number;
    staleLeads: number;
    activePercent: number | null;
  };
};
type Data = { teams: Team[]; counts: Record<Label, number> };

const LABEL: Record<Label, { text: string; tone: string; bar: string }> = {
  STRONG: { text: "Strong", tone: "bg-emerald-50 text-emerald-800", bar: "bg-emerald-500" },
  STEADY: { text: "Steady", tone: "bg-sky-50 text-sky-800", bar: "bg-sky-500" },
  NEEDS_SUPPORT: { text: "Needs support", tone: "bg-amber-50 text-amber-800", bar: "bg-amber-500" },
  AT_RISK: { text: "At risk", tone: "bg-rose-50 text-rose-700", bar: "bg-rose-500" },
};
const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-neutral-500";

function Trend({ value }: { value: number | null }) {
  if (value === null) return <span className="text-neutral-400">New</span>;
  const Icon = value > 2 ? ArrowUpRight : value < -2 ? ArrowDownRight : Minus;
  const tone = value > 2 ? "text-emerald-700" : value < -20 ? "text-rose-700" : value < -2 ? "text-amber-700" : "text-neutral-500";
  return <span className={`inline-flex items-center gap-0.5 font-semibold tabular-nums ${tone}`}><Icon className="h-3.5 w-3.5" />{value > 0 ? "+" : ""}{value}%</span>;
}

const pct = (v: number | null) => (v === null ? <span className="text-neutral-400">Too early</span> : `${v}%`);

export default function AdminSalesTeamHealthPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/admin/sales/team-health");
      setData(response.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load team health.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const counts = data?.counts;

  return (
    <div className="w-full min-w-0 space-y-4">
      <SalesAdminHeader
        title="Team health"
        description="How each team is really doing: output per member, conversion, quality, activity and trend. Size never beats quality."
        metrics={[
          { label: "Strong", value: counts?.STRONG ?? "–", tone: "good" },
          { label: "Steady", value: counts?.STEADY ?? "–" },
          { label: "Needs support", value: counts?.NEEDS_SUPPORT ?? "–", tone: counts?.NEEDS_SUPPORT ? "warn" : "muted" },
          { label: "At risk", value: counts?.AT_RISK ?? "–", tone: counts?.AT_RISK ? "warn" : "muted" },
        ]}
        onRefresh={() => void load()}
        loading={loading}
      />

      {error ? <p className="m-0 flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}

      <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-0 border-b border-solid border-neutral-100 px-4 py-3">
          <h2 className="m-0 flex items-center gap-1.5 text-sm font-bold text-neutral-900"><HeartPulse className="h-4 w-4" /> Teams, healthiest first</h2>
          <span className="text-[11px] text-neutral-500">Leads with a team that needs support get one tip a week automatically</span>
        </div>
        {loading && !data ? (
          <div className="flex items-center gap-2 p-5 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
        ) : !data?.teams.length ? (
          <p className="m-0 p-8 text-center text-sm text-neutral-500">No active teams yet. Appoint a team lead from Sales partners.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead className="bg-neutral-50">
                <tr>
                  <th className={`${th} pl-4`}>Team</th>
                  <th className={th}>Health</th>
                  <th className={`${th} text-right`}>Per member (last month)</th>
                  <th className={`${th} text-right`}>Trend</th>
                  <th className={`${th} text-right`}>Conversion (90 days)</th>
                  <th className={`${th} text-right`}>Leads active</th>
                  <th className={`${th} text-right`}>Quality issues</th>
                  <th className={`${th} text-right`}>Points this month</th>
                  <th className={`${th} pr-4`}><span className="sr-only">Details</span></th>
                </tr>
              </thead>
              <tbody>
                {data.teams.map((t) => {
                  const l = LABEL[t.label];
                  const expanded = open === t.teamId;
                  return (
                    <Fragment key={t.teamId}>
                      <tr className="border-0 border-t border-solid border-neutral-100 align-top hover:bg-neutral-50/60">
                        <td className="py-3 pl-4 pr-3">
                          <p className="m-0 text-[13px] font-semibold text-neutral-900">{t.name}</p>
                          <p className="m-0 text-[11px] text-neutral-500">Lead {t.lead.name} <span className="font-mono text-neutral-400">{t.lead.agentCode}</span> · {t.members} active</p>
                        </td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${l.tone}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{l.text}</span>
                          <span className="mt-1.5 block h-1 w-24 overflow-hidden rounded-full bg-neutral-100"><span className={`block h-full rounded-full ${l.bar}`} style={{ width: `${t.score}%` }} /></span>
                          <span className="mt-0.5 block text-[11px] tabular-nums text-neutral-400">Score {t.score}</span>
                        </td>
                        <td className="px-3 py-3 text-right text-[13px] font-semibold tabular-nums text-neutral-900">{t.metrics.perMemberLastMonth.toLocaleString("en-US")}</td>
                        <td className="px-3 py-3 text-right text-[12px]"><Trend value={t.metrics.trendPercent} /></td>
                        <td className="px-3 py-3 text-right text-[12px] tabular-nums text-neutral-700">
                          {pct(t.metrics.conversionPercent)}
                          <span className="block text-[11px] text-neutral-400">{t.metrics.confirmed90d} of {t.metrics.leadsOpened90d} leads</span>
                        </td>
                        <td className="px-3 py-3 text-right text-[12px] tabular-nums text-neutral-700">
                          {pct(t.metrics.activePercent)}
                          <span className="block text-[11px] text-neutral-400">{t.metrics.staleLeads} stuck of {t.metrics.openLeads}</span>
                        </td>
                        <td className={`px-3 py-3 text-right text-[13px] font-semibold tabular-nums ${t.metrics.qualityIssues ? "text-rose-700" : "text-neutral-400"}`}>
                          {t.metrics.qualityIssues}
                          {t.metrics.pausedMembers ? <span className="block text-[11px] font-medium text-rose-700">{t.metrics.pausedMembers} paused</span> : null}
                        </td>
                        <td className="px-3 py-3 text-right text-[12px] tabular-nums text-neutral-600">{t.metrics.pointsThisMonth.toLocaleString("en-US")}</td>
                        <td className="py-3 pl-3 pr-4 text-right">
                          <button type="button" onClick={() => setOpen(expanded ? null : t.teamId)} aria-expanded={expanded}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2 text-[11px] font-semibold text-neutral-700 hover:bg-neutral-50">
                            Why <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
                          </button>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr className="bg-neutral-50/70">
                          <td colSpan={9} className="px-4 pb-4 pt-1">
                            <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                              <div className="rounded-md border border-solid border-neutral-200 bg-white px-3 py-2.5">
                                <p className="m-0 text-[11px] font-semibold text-neutral-500">Reasons</p>
                                <ul className="m-0 mt-1 list-none space-y-1 p-0">
                                  {t.reasons.map((r) => <li key={r} className="text-[13px] text-neutral-800">• {r}</li>)}
                                </ul>
                              </div>
                              <div className="rounded-md border border-solid border-amber-200 bg-amber-50 px-3 py-2.5">
                                <p className="m-0 flex items-center gap-1 text-[11px] font-semibold text-amber-800"><Lightbulb className="h-3.5 w-3.5" /> Tip for the lead this week</p>
                                <p className="m-0 mt-1 text-[13px] text-amber-950">{t.tip || "Nothing pressing. Keep the team's pace."}</p>
                              </div>
                            </div>
                            <p className="m-0 mt-2 text-[11px] text-neutral-400">
                              Per member before: {t.metrics.perMemberBefore ?? "not enough history"} · the score weighs output 40, conversion 20, activity 20 and quality 20.
                            </p>
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
        <p className="m-0 flex items-center gap-1.5 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 text-[11px] text-neutral-400">
          <RefreshCw className="h-3 w-3" /> Worked out live from verified results. A team with a paused member or a flagged visit cannot win Top team.
        </p>
      </section>

      <NextMonthTargets />
    </div>
  );
}

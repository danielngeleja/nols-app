"use client";

/** The team lead's own team health: label, why, and one thing to do this week. */
import { useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, HeartPulse, Lightbulb, Minus } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Health = {
  label: "STRONG" | "STEADY" | "NEEDS_SUPPORT" | "AT_RISK";
  score: number;
  reasons: string[];
  tip: string | null;
  position: number;
  teamCount: number;
  metrics: { perMemberLastMonth: number; trendPercent: number | null; conversionPercent: number | null; activePercent: number | null; qualityIssues: number };
};

const LABEL = {
  STRONG: { text: "Strong", tone: "bg-emerald-50 text-emerald-800", ring: "border-emerald-200" },
  STEADY: { text: "Steady", tone: "bg-sky-50 text-sky-800", ring: "border-slate-200" },
  NEEDS_SUPPORT: { text: "Needs support", tone: "bg-amber-50 text-amber-800", ring: "border-amber-200" },
  AT_RISK: { text: "At risk", tone: "bg-rose-50 text-rose-700", ring: "border-rose-200" },
} as const;

export default function TeamHealthCard() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    apiClient.get("/api/sales/team/health").then(({ data }) => setHealth(data?.health ?? null)).catch(() => setHealth(null));
  }, []);
  if (!health) return null;
  const l = LABEL[health.label];
  const t = health.metrics.trendPercent;
  const TrendIcon = t === null ? Minus : t > 2 ? ArrowUpRight : t < -2 ? ArrowDownRight : Minus;
  const figure = (label: string, value: string, note?: string) => (
    <div className="min-w-0">
      <p className="m-0 text-[11px] text-slate-500">{label}</p>
      <p className="m-0 text-[15px] font-bold tabular-nums text-slate-900">{value}</p>
      {note ? <p className="m-0 text-[11px] text-slate-400">{note}</p> : null}
    </div>
  );
  return (
    <section className={`mt-4 rounded-lg border border-solid ${l.ring} bg-white p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <HeartPulse className="h-4 w-4 text-[#02665e]" aria-hidden /> Team health
            <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${l.tone}`}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{l.text}</span>
          </p>
          <p className="m-0 mt-1 text-[13px] text-slate-600">{health.reasons[0]}</p>
        </div>
        <p className="m-0 text-[12px] text-slate-500">#{health.position} of {health.teamCount} teams by health</p>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {figure("Points per member", health.metrics.perMemberLastMonth.toLocaleString("en-US"), "Last month")}
        <div className="min-w-0">
          <p className="m-0 text-[11px] text-slate-500">Trend</p>
          <p className={`m-0 inline-flex items-center gap-0.5 text-[15px] font-bold tabular-nums ${t === null ? "text-slate-400" : t < -2 ? "text-rose-700" : t > 2 ? "text-emerald-700" : "text-slate-900"}`}>
            <TrendIcon className="h-4 w-4" aria-hidden />{t === null ? "New" : `${t > 0 ? "+" : ""}${t}%`}
          </p>
          <p className="m-0 text-[11px] text-slate-400">vs the 3 months before</p>
        </div>
        {figure("Conversion", health.metrics.conversionPercent === null ? "Too early" : `${health.metrics.conversionPercent}%`, "Leads to confirmed, 90 days")}
        {figure("Leads active", health.metrics.activePercent === null ? "–" : `${health.metrics.activePercent}%`, "Not stuck 14+ days")}
      </div>
      {health.tip ? (
        <p className="m-0 mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden /> <span><span className="font-semibold">This week:</span> {health.tip}</span>
        </p>
      ) : null}
    </section>
  );
}

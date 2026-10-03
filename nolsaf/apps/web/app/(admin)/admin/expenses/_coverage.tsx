"use client";

import { TrendingDown, TrendingUp } from "lucide-react";
import { compactTzs, eatTodayIso, monthLabel, tzs } from "./_shared";

/**
 * Revenue coverage: does NoLSAF's revenue for a month pay for what it costs
 * to run that month? Data from GET /api/admin/finance/payroll/coverage
 * (apps/api/src/lib/payrollCoverage.ts).
 */

export type MonthCoverage = {
  periodMonth: string;
  revenue: number;
  gmv: number;
  revenueByStream: Array<{ key: string; label: string; revenue: number }>;
  payroll: { amount: number; basis: "PAID" | "DRAFT" | "APPROVED" | "PROJECTED" | "NONE"; headcount: number; net: number; runNumber: string | null };
  costOfRevenue: number;
  runningCosts: number;
  costOfRevenueLines: Array<{ key: string; label: string; amount: number; basis: string }>;
  otherCosts: number;
  totalCosts: number;
  coveragePercent: number | null;
  shortfall: number;
  surplus: number;
};

const PAYROLL_BASIS: Record<MonthCoverage["payroll"]["basis"], string> = {
  PAID: "Paid run",
  APPROVED: "Approved run",
  DRAFT: "Draft run",
  PROJECTED: "Projected from the register",
  NONE: "No staff on the payroll",
};

export function coverageTone(percent: number | null) {
  if (percent == null) return { ring: "#d4d4d4", text: "text-neutral-500", soft: "bg-neutral-100", bar: "bg-neutral-300" };
  if (percent >= 100) return { ring: "#02665e", text: "text-emerald-700", soft: "bg-emerald-50", bar: "bg-[#02665e]" };
  if (percent >= 70) return { ring: "#f59e0b", text: "text-amber-700", soft: "bg-amber-50", bar: "bg-amber-400" };
  return { ring: "#e11d48", text: "text-rose-700", soft: "bg-rose-50", bar: "bg-rose-500" };
}

export function CoverageRing({ percent, size = 92 }: { percent: number | null; size?: number }) {
  const tone = coverageTone(percent);
  const shown = percent == null ? 0 : Math.min(100, percent);
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="#eef0ef" strokeWidth="3.5" />
        {shown > 0 ? <circle cx="18" cy="18" r="15.5" fill="none" stroke={tone.ring} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${(shown / 100) * 97.4} 97.4`} /> : null}
      </svg>
      <span className="text-center leading-none">
        <span className={`block font-bold tabular-nums ${tone.text}`} style={{ fontSize: size / 4.2 }}>{percent == null ? "n/a" : `${Math.round(percent)}%`}</span>
        <span className="mt-0.5 block text-[9px] font-semibold text-neutral-400">covered</span>
      </span>
    </span>
  );
}

const HATCH = "bg-[repeating-linear-gradient(135deg,#fecdd3_0,#fecdd3_4px,#fff1f2_4px,#fff1f2_8px)]";

function Row({ dot, label, detail, amount, share }: { dot: string; label: string; detail?: string; amount: number; share: number }) {
  return (
    <li className="py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-neutral-800">{label}</span>
            {detail ? <span className="block truncate text-[11px] text-neutral-500">{detail}</span> : null}
          </span>
        </span>
        <span className="shrink-0 text-xs font-bold tabular-nums text-neutral-900">{tzs(amount)}</span>
      </div>
      <span className="ml-4 mt-1.5 block h-1 overflow-hidden rounded-full bg-neutral-100"><span className={`block h-full rounded-full ${dot}`} style={{ width: `${Math.max(2, Math.min(100, share))}%` }} /></span>
    </li>
  );
}

export default function CoverageCard({ coverage, loading, title }: { coverage: MonthCoverage | null; loading?: boolean; title?: string }) {
  if (!coverage) {
    return (
      <section className="rounded-3xl border border-solid border-neutral-200 bg-white p-5 shadow-sm">
        <p className="m-0 text-sm font-bold text-neutral-900">{title ?? "Revenue coverage"}</p>
        <p className="m-0 mt-2 text-xs text-neutral-500">{loading ? "Working out this month's revenue and costs..." : "Coverage is not available."}</p>
      </section>
    );
  }
  const c = coverage;
  const percent = c.coveragePercent;
  const tone = coverageTone(percent);
  const hasCosts = c.totalCosts > 0;
  const ahead = c.surplus > 0;

  // One track: what revenue covered, the gap still open, and any surplus past break-even.
  const scale = Math.max(c.revenue, c.totalCosts, 1);
  const covered = Math.min(c.revenue, c.totalCosts);
  const coveredW = (covered / scale) * 100;
  const gapW = (c.shortfall / scale) * 100;
  const surplusW = (c.surplus / scale) * 100;

  // Days left only matter for the month still running.
  const today = eatTodayIso();
  const [y, m] = c.periodMonth.split("-").map(Number);
  const daysLeft = c.periodMonth === today.slice(0, 7) ? new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(today.slice(8, 10)) + 1 : 0;

  const streams = c.revenueByStream.filter((s) => s.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const costRows = [
    { key: "payroll", label: "Payroll", detail: `${PAYROLL_BASIS[c.payroll.basis]}${c.payroll.headcount ? `, ${c.payroll.headcount} ${c.payroll.headcount === 1 ? "person" : "people"}` : ""}`, amount: c.payroll.amount, dot: "bg-[#0b2420]" },
    ...c.costOfRevenueLines.map((l) => ({ key: l.key, label: l.label, detail: l.basis === "ESTIMATE" ? "Estimate" : "Cost of earning revenue", amount: l.amount, dot: "bg-sky-500" })),
    { key: "running", label: "Running costs", detail: "From the expense ledger", amount: c.runningCosts, dot: "bg-violet-500" },
  ].filter((r) => r.amount > 0);

  return (
    <section className="overflow-hidden rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm">
      <div className="px-5 pb-5 pt-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-xs font-semibold text-neutral-500">{title ?? `Revenue coverage, ${monthLabel(c.periodMonth)}`}</p>
            <p className="m-0 mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className={`text-3xl font-bold tracking-tight tabular-nums ${tone.text}`}>{percent == null ? "n/a" : `${Math.round(percent)}%`}</span>
              <span className="text-sm text-neutral-600">{hasCosts ? `of ${tzs(c.totalCosts)} in costs is paid for by revenue` : "No costs recorded for this month yet"}</span>
            </p>
          </div>
          {hasCosts ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset ${ahead ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"}`}>
              {ahead ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {ahead ? `${tzs(c.surplus)} left over` : `${tzs(c.shortfall)} short`}
            </span>
          ) : null}
        </div>

        {hasCosts ? (
          <>
            <div className="mt-4 flex h-3 gap-0.5 overflow-hidden rounded-full bg-neutral-100">
              {coveredW > 0 ? <span className={`h-full rounded-full ${tone.bar}`} style={{ width: `${coveredW}%` }} /> : null}
              {gapW > 0 ? <span className={`h-full rounded-full ${HATCH}`} style={{ width: `${gapW}%` }} /> : null}
              {surplusW > 0 ? <span className="h-full rounded-full bg-emerald-300" style={{ width: `${surplusW}%` }} /> : null}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${tone.bar}`} />Revenue in <b className="font-semibold tabular-nums text-neutral-900">{tzs(c.revenue)}</b></span>
              {c.shortfall > 0 ? <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${HATCH}`} />Still to cover <b className="font-semibold tabular-nums text-rose-700">{tzs(c.shortfall)}</b></span> : null}
              {ahead ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-300" />Left over <b className="font-semibold tabular-nums text-emerald-700">{tzs(c.surplus)}</b></span> : null}
              {c.shortfall > 0 && daysLeft > 0 ? <span className="inline-flex items-center gap-1.5 sm:ml-auto">Needs <b className="font-semibold tabular-nums text-neutral-900">{compactTzs(c.shortfall / daysLeft)}</b> a day for the {daysLeft} day{daysLeft === 1 ? "" : "s"} left</span> : null}
            </div>
          </>
        ) : null}
      </div>

      <div className="grid gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 md:grid-cols-2">
        <div className="bg-white px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-xs font-bold text-neutral-900">Revenue in</p>
            <span className="text-xs font-bold tabular-nums text-neutral-900">{tzs(c.revenue)}</span>
          </div>
          {streams.length ? (
            <ul className="m-0 mt-1 list-none p-0">
              {streams.map((s) => <Row key={s.key} dot="bg-emerald-500" label={s.label} amount={s.revenue} share={(s.revenue / Math.max(c.revenue, 1)) * 100} />)}
            </ul>
          ) : (
            <p className="m-0 mt-3 rounded-2xl bg-neutral-50 px-3.5 py-3 text-xs text-neutral-500">No revenue realized for {monthLabel(c.periodMonth)} yet. It appears here as bookings and other streams settle.</p>
          )}
        </div>
        <div className="bg-white px-5 py-4 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-xs font-bold text-neutral-900">Costs to cover</p>
            <span className="text-xs font-bold tabular-nums text-neutral-900">{tzs(c.totalCosts)}</span>
          </div>
          {costRows.length ? (
            <ul className="m-0 mt-1 list-none p-0">
              {costRows.map((r) => <Row key={r.key} dot={r.dot} label={r.label} detail={r.detail} amount={r.amount} share={(r.amount / Math.max(c.totalCosts, 1)) * 100} />)}
            </ul>
          ) : (
            <p className="m-0 mt-3 rounded-2xl bg-neutral-50 px-3.5 py-3 text-xs text-neutral-500">Nothing to cover yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

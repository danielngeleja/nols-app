"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Activity, ArrowUpRight, BookOpenText, CalendarCheck2, ChevronLeft, ChevronRight, Gauge, Landmark, Layers, Radar, RefreshCw, Scale, Users } from "lucide-react";
import { CommandCanvas, Dial, DualLineChart, LinearBridge, eyebrow, ghostButton, panel, type BridgeStep } from "@/components/admin/commandUi";
import { type MonthCoverage } from "./_coverage";
import { LockedCard, compactTzs, eatDate, eatTodayIso, monthLabel, tzs, useFinanceData } from "./_shared";

/**
 * Expenses overview for one month, in the finance "command" look shared with
 * All Revenue: does revenue cover the cost of running NoLSAF, how the year
 * has gone month by month, how revenue turns into net, what the money went
 * on, and where payroll and the statutory payments stand.
 */

type Margin = {
  revenue: number;
  costs: Array<{ key: string; label: string; amount: number; basis: string }>;
  contribution: number;
  contributionMarginPercent: number | null;
  operating: Array<{ key: string; label: string; amount: number; count: number }>;
  net: number;
  netMarginPercent: number | null;
};
type Overview = { margin?: Margin; totals: { nolsafRevenue: number } };
type ExpenseList = { items: Array<{ id: number; category: string; description: string; amount: number; currency: string; incurredAt: string; origin: string; reversedAt: string | null }>; totals: Array<{ category: string; currency: string; amount: number }>; categories: Array<{ key: string; label: string; kind: string }> };
type Runs = { items: Array<{ id: number; runNumber: string; periodMonth: string; status: string; headcount: number; net: number; employerCost: number; paidAt: string | null }> };
type RunDetail = { remittances: Array<{ key: string; payee: string; label: string; amount: number; dueOn: string; paid?: { paidOn: string; reference: string } | null }> };
type Employees = { counts: Record<string, number>; monthlyGross: number };

const CATEGORY_COLOR: Record<string, string> = {
  GATEWAY_FEE: "#38bdf8",
  PARTNER_BONUS: "#a78bfa",
  SMS: "#fbbf24",
  EMAIL: "#fcd34d",
  HOSTING: "#34d399",
  STAFF: "#5eead4",
  MARKETING: "#f0abfc",
  OTHER: "#94a3b8",
};
const RUN_TONE: Record<string, string> = {
  DRAFT: "bg-amber-400/10 text-amber-300 ring-amber-400/25",
  APPROVED: "bg-sky-400/10 text-sky-300 ring-sky-400/25",
  PAID: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/25",
  CANCELLED: "bg-white/[0.04] text-slate-400 ring-white/10",
};
const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${v.toFixed(1)}%`);
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

export default function ExpensesOverviewPage() {
  const today = eatTodayIso();
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [y, m] = month.split("-").map(Number);
  const monthEnd = month === thisMonth ? today : new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const from = new Date(`${month}-01T00:00:00+03:00`).toISOString();
  const to = new Date(`${monthEnd}T23:59:59.999+03:00`).toISOString();

  const overview = useFinanceData<Overview>(`/api/admin/finance/overview?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  const coverage = useFinanceData<{ months: MonthCoverage[] }>(`/api/admin/finance/payroll/coverage?month=${month}`);
  const year = useFinanceData<{ months: MonthCoverage[] }>(`/api/admin/finance/payroll/coverage?year=${y}`);
  const expenses = useFinanceData<ExpenseList>(`/api/admin/finance/expenses?from=${month}-01&to=${monthEnd}&pageSize=6`);
  const runs = useFinanceData<Runs>("/api/admin/finance/payroll/runs");
  const employees = useFinanceData<Employees>("/api/admin/finance/payroll/employees?status=ACTIVE");
  const monthRun = runs.data?.items.find((r) => r.periodMonth === month && r.status !== "CANCELLED") ?? null;
  const latestPayable = runs.data?.items.find((r) => r.status === "PAID" || r.status === "APPROVED") ?? null;
  const runDetail = useFinanceData<RunDetail>(latestPayable ? `/api/admin/finance/payroll/runs/${latestPayable.id}` : null);

  const margin = overview.data?.margin;
  const cover = coverage.data?.months[0] ?? null;

  const byCategory = useMemo(() => {
    const labels = new Map((expenses.data?.categories ?? []).map((c) => [c.key, c.label]));
    return (expenses.data?.totals ?? [])
      .filter((t) => t.currency === "TZS" && t.amount !== 0)
      .map((t) => ({ key: t.category, label: labels.get(t.category) ?? t.category, amount: t.amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses.data]);
  const categoryTotal = byCategory.reduce((s, r) => s + r.amount, 0);

  const yearPoints = useMemo(
    () => (year.data?.months ?? null)?.map((c) => ({ key: c.periodMonth, label: MONTH_SHORT[Number(c.periodMonth.slice(5, 7)) - 1], a: c.revenue, b: c.totalCosts })) ?? null,
    [year.data],
  );

  if (overview.locked || coverage.locked || expenses.locked) return <LockedCard what="Expenses" />;

  const refresh = () => { overview.reload(); coverage.reload(); year.reload(); expenses.reload(); runs.reload(); employees.reload(); runDetail.reload(); };
  const loading = overview.loading || coverage.loading;
  const activeCount = (employees.data?.counts?.ACTIVE ?? 0) + (employees.data?.counts?.ON_LEAVE ?? 0);
  const money = (v: number) => tzs(v);
  const daysLeft = month === thisMonth ? new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(today.slice(8, 10)) + 1 : 0;
  const percent = cover?.coveragePercent ?? null;
  const hasCosts = Boolean(cover && cover.totalCosts > 0);
  const quiet = Boolean(cover && cover.totalCosts === 0 && cover.revenue === 0);

  const steps: BridgeStep[] = margin
    ? [
        { key: "revenue", label: "NoLSAF revenue", amount: margin.revenue, kind: "start" },
        ...margin.costs.filter((c) => c.amount !== 0).map((c) => ({ key: c.key, label: c.label, amount: c.amount, kind: "less" as const, tag: c.basis === "ESTIMATE" ? "est." : undefined })),
        { key: "contribution", label: "Contribution", amount: margin.contribution, kind: "sub" },
        ...margin.operating.filter((c) => c.amount !== 0).map((c) => ({ key: c.key, label: c.label, amount: c.amount, kind: "less" as const })),
        { key: "net", label: "Net", amount: margin.net, kind: "end" },
      ]
    : [];

  return (
    <CommandCanvas>
      {/* Command bar */}
      <div className="flex flex-wrap items-center gap-3 px-1 pt-1">
        <div className="mr-auto min-w-0">
          <p className={eyebrow}><Radar className="h-3.5 w-3.5" /> Expenses command</p>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400">
            <span className="font-semibold text-slate-100">{monthLabel(month)}</span>
            <span className="text-slate-600">·</span>
            {month === thisMonth ? `so far, ${daysLeft} day${daysLeft === 1 ? "" : "s"} left` : "the whole month"}
          </p>
        </div>
        <div className="inline-flex items-center rounded-md border border-solid border-[#284540] bg-[#182c28] p-0.5">
          <button type="button" onClick={() => setMonth((mm) => shiftMonth(mm, -1))} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded border-0 bg-transparent text-slate-400 hover:bg-white/[0.05] hover:text-white"><ChevronLeft className="h-4 w-4" /></button>
          <span className="w-24 text-center text-xs font-semibold text-slate-100">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}</span>
          <button type="button" onClick={() => setMonth((mm) => shiftMonth(mm, 1))} disabled={month >= thisMonth} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded border-0 bg-transparent text-slate-400 hover:bg-white/[0.05] hover:text-white disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {month !== thisMonth ? <button type="button" onClick={() => setMonth(thisMonth)} className={ghostButton}>This month</button> : null}
        <button type="button" onClick={refresh} aria-label="Refresh" className="grid h-9 w-9 place-items-center rounded-md border border-solid border-[#284540] bg-[#182c28] text-slate-300 transition hover:border-emerald-300/40 hover:text-emerald-200">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Hero: the year line, the dial and the meters */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className={`${panel} p-5 sm:p-6`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="m-0 text-xs font-semibold text-slate-400">Does revenue pay for NoLSAF, {monthLabel(month)}</p>
              {loading && !cover ? (
                <div className="mt-3 h-11 w-64 animate-pulse rounded-md bg-white/[0.05]" />
              ) : quiet ? (
                <>
                  <p className="m-0 mt-2 text-xl font-semibold tracking-tight text-white">Nothing recorded for {monthLabel(month)} yet</p>
                  <p className="m-0 mt-1 text-sm text-slate-400">Coverage appears once revenue comes in or payroll and expenses are booked.</p>
                </>
              ) : (
                <>
                  <p className="m-0 mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className={`text-[44px] font-semibold leading-none tabular-nums tracking-tight ${percent == null ? "text-slate-500" : percent >= 100 ? "text-emerald-300" : percent >= 70 ? "text-amber-300" : "text-rose-300"}`}>{percent == null ? "n/a" : `${Math.round(percent)}%`}</span>
                    <span className="text-sm text-slate-400">of the cost covered</span>
                  </p>
                  <p className="m-0 mt-2 text-sm text-slate-400">
                    Revenue <b className="font-semibold text-emerald-300">{money(cover?.revenue ?? 0)}</b> against costs <b className="font-semibold text-rose-300">{money(cover?.totalCosts ?? 0)}</b>.
                    {cover && cover.surplus > 0 ? <> <b className="font-semibold text-white">{money(cover.surplus)}</b> left over.</> : cover && cover.shortfall > 0 ? <> Gap <b className="font-semibold text-white">{money(cover.shortfall)}</b>{daysLeft > 0 ? <>, about <b className="font-semibold text-white">{compactTzs(cover.shortfall / daysLeft)}</b> a day to close it</> : null}.</> : null}
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-4 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 bg-emerald-400" /> Revenue</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 bg-rose-400" /> Cost to run</span>
            </div>
          </div>
          <div className="mt-5">
            <DualLineChart points={yearPoints} aLabel="Revenue" bLabel="Cost to run" money={money} selected={month} onPick={(key) => setMonth(key)} />
          </div>
          <p className="m-0 mt-3 text-[11px] text-slate-500">{y}, month by month. Click a month to open it.</p>
        </section>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <section className={`${panel} p-5`}>
            <p className={eyebrow}><Gauge className="h-3.5 w-3.5" /> Coverage</p>
            <Dial
              value={hasCosts ? percent : null}
              max={150}
              marker={100}
              label="Covered"
              display={hasCosts && percent != null ? `${Math.round(percent)}%` : "n/a"}
              sub={hasCosts ? (percent != null && percent >= 100 ? "past break-even" : "tick is break-even") : "no costs yet"}
              tone={percent == null ? "good" : percent >= 100 ? "good" : percent >= 70 ? "warn" : "bad"}
            />
          </section>
          <section className={`${panel} space-y-4 p-5`}>
            <p className={eyebrow}><Activity className="h-3.5 w-3.5" /> This month</p>
            {[
              { label: "Revenue in", value: cover?.revenue ?? 0, color: "#34d399", hint: "realized NoLSAF revenue" },
              { label: "Cost to run", value: cover?.totalCosts ?? 0, color: "#f87171", hint: cover ? `payroll ${compactTzs(cover.payroll.amount)}` : "" },
              { label: "Net margin", text: margin ? pct(margin.netMarginPercent) : "...", color: "#5eead4", hint: margin ? `contribution ${pct(margin.contributionMarginPercent)}` : "" },
            ].map((f) => {
              const scale = Math.max(1, cover?.revenue ?? 0, cover?.totalCosts ?? 0);
              return (
                <div key={f.label}>
                  <span className="text-xs font-medium text-slate-400">{f.label}</span>
                  <p className={`m-0 mt-0.5 whitespace-nowrap text-lg font-semibold tabular-nums ${"text" in f || f.value ? "text-white" : "text-slate-600"}`}>{"text" in f ? f.text : f.value ? money(f.value) : "None yet"}</p>
                  {"value" in f ? <span className="mt-1.5 block h-1 bg-white/[0.06]"><span className="block h-full" style={{ width: `${((f.value ?? 0) / scale) * 100}%`, background: f.color }} /></span> : null}
                  <p className="m-0 mt-1 text-[10px] text-slate-500">{f.hint}</p>
                </div>
              );
            })}
          </section>
        </div>
      </div>

      {/* Bridge and categories */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className={`${panel} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 sm:px-6">
            <div className="mr-auto min-w-0">
              <p className={eyebrow}><Scale className="h-3.5 w-3.5" /> Revenue to net</p>
              <p className="m-0 mt-1 text-sm text-slate-400">Less what it costs to earn it, less running costs.</p>
            </div>
            <Link href="/admin/finance" className={ghostButton}>All Revenue <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="border-0 border-t border-solid border-[#284540] px-5 py-3 sm:px-6">
            {steps.length && (margin!.revenue !== 0 || steps.some((s) => s.kind === "less")) ? (
              <LinearBridge steps={steps} money={money} />
            ) : (
              <p className="m-0 grid h-24 place-items-center text-xs text-slate-500">{overview.loading ? "Loading..." : `No revenue or costs for ${monthLabel(month)} yet.`}</p>
            )}
          </div>
        </section>

        <section className={`${panel} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 sm:px-6">
            <div className="mr-auto min-w-0">
              <p className={eyebrow}><Layers className="h-3.5 w-3.5" /> What the money went on</p>
              <p className="m-0 mt-1 text-sm text-slate-400">{categoryTotal ? `${money(categoryTotal)} in the ledger` : "From the expense ledger"}</p>
            </div>
            <Link href="/admin/expenses/ledger" className={ghostButton}>Ledger <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          <div className="border-0 border-t border-solid border-[#284540] px-5 py-3 sm:px-6">
            {byCategory.length ? (
              <ul className="m-0 list-none p-0">
                {byCategory.map((c) => (
                  <li key={c.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-4 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-xs text-slate-300"><span className="h-2 w-2 shrink-0" style={{ background: CATEGORY_COLOR[c.key] ?? "#94a3b8" }} /><span className="truncate">{c.label}</span></span>
                    <span className="block h-1.5 bg-[#13241f]"><span className="block h-full" style={{ width: `${(c.amount / categoryTotal) * 100}%`, background: CATEGORY_COLOR[c.key] ?? "#94a3b8" }} /></span>
                    <span className="whitespace-nowrap text-right text-xs tabular-nums"><b className="font-semibold text-white">{compactTzs(c.amount)}</b> <span className="text-slate-500">{Math.round((c.amount / categoryTotal) * 100)}%</span></span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 grid h-24 place-items-center text-center text-xs text-slate-500">{expenses.loading ? "Loading..." : "Nothing in the ledger yet. Paid payroll, bonuses and recorded bills show up here."}</p>
            )}
          </div>
        </section>
      </div>

      {/* Payroll, statutory, latest */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className={`${panel} flex flex-col p-5`}>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-400/10 text-emerald-300"><Users className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-semibold text-white">Payroll, {monthLabel(month)}</h2>
              <p className="m-0 text-xs text-slate-400">{employees.data ? `${activeCount} on the payroll · ${compactTzs(employees.data.monthlyGross)} gross a month` : "Loading..."}</p>
            </div>
          </div>
          <div className="mt-4 flex-1 rounded-md border border-solid border-[#284540] bg-[#13241f] px-4 py-3">
            {monthRun ? (
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-lg font-semibold tabular-nums text-white">{tzs(monthRun.net)}</span>
                  <span className="block text-[11px] text-slate-400">net to {monthRun.headcount} · cost {compactTzs(monthRun.employerCost)}</span>
                </span>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${RUN_TONE[monthRun.status] ?? RUN_TONE.CANCELLED}`}>{monthRun.status.charAt(0) + monthRun.status.slice(1).toLowerCase()}</span>
              </div>
            ) : (
              <p className="m-0 text-sm text-slate-400">{cover?.payroll.basis === "PROJECTED" ? `No run yet. Projected cost ${compactTzs(cover.payroll.amount)}.` : runs.loading ? "Loading..." : "No pay run for this month."}</p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/expenses/payroll/runs" className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-emerald-400 px-3.5 text-xs font-semibold text-[#06201b] no-underline hover:bg-emerald-300 hover:no-underline"><CalendarCheck2 className="h-3.5 w-3.5" /> Pay runs</Link>
            <Link href="/admin/expenses/payroll/employees" className={ghostButton}><Users className="h-3.5 w-3.5" /> Employees</Link>
          </div>
        </section>

        <section className={`${panel} p-5`}>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-400/10 text-emerald-300"><Landmark className="h-4 w-4" /></span>
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-semibold text-white">Statutory payments</h2>
              <p className="m-0 text-xs text-slate-400">{latestPayable ? `From ${monthLabel(latestPayable.periodMonth)} payroll` : "Appear once a pay run is approved"}</p>
            </div>
          </div>
          <ul className="m-0 mt-4 list-none p-0">
            {runDetail.data?.remittances.length ? runDetail.data.remittances.map((r) => {
              const overdue = !r.paid && r.dueOn < today;
              return (
                <li key={r.key} className="flex items-center gap-3 border-0 border-b border-solid border-[#284540] py-2.5 last:border-b-0">
                  <span className="w-12 shrink-0 rounded bg-white/[0.05] py-1 text-center text-[10px] font-bold text-slate-300">{r.payee}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-100">{r.label}</span>
                    {r.paid ? (
                      <span className="block text-[11px] font-semibold text-emerald-300">Paid {eatDate(r.paid.paidOn)}</span>
                    ) : (
                      <span className={`block text-[11px] ${overdue ? "font-semibold text-rose-300" : "text-slate-500"}`}>by {eatDate(`${r.dueOn}T00:00:00+03:00`)}{overdue ? ", past due" : ""}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-white">{compactTzs(r.amount)}</span>
                </li>
              );
            }) : <li className="grid h-20 place-items-center border border-dashed border-[#284540] text-xs text-slate-500">{runs.loading || runDetail.loading ? "Loading..." : "Nothing due yet."}</li>}
          </ul>
        </section>

        <section className={`${panel} p-5`}>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-emerald-400/10 text-emerald-300"><BookOpenText className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-sm font-semibold text-white">Latest entries</h2>
              <p className="m-0 text-xs text-slate-400">{monthLabel(month)}</p>
            </div>
            <Link href="/admin/expenses/ledger" className="text-xs font-semibold text-emerald-300 no-underline hover:underline">All</Link>
          </div>
          <ul className="m-0 mt-4 list-none p-0">
            {expenses.data?.items.length ? expenses.data.items.map((e) => (
              <li key={e.id} className="flex items-center gap-3 border-0 border-b border-solid border-[#284540] py-2.5 last:border-b-0">
                <span className="h-2 w-2 shrink-0" style={{ background: CATEGORY_COLOR[e.category] ?? "#94a3b8" }} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs font-semibold ${e.reversedAt ? "text-slate-500 line-through" : "text-slate-100"}`}>{e.description}</span>
                  <span className="block text-[11px] text-slate-500">{eatDate(e.incurredAt)} · {e.origin === "SYSTEM" ? "by the platform" : "by an admin"}</span>
                </span>
                <span className={`shrink-0 text-sm font-semibold tabular-nums ${e.amount < 0 ? "text-emerald-300" : "text-white"}`}>{compactTzs(e.amount)}</span>
              </li>
            )) : <li className="grid h-20 place-items-center border border-dashed border-[#284540] text-xs text-slate-500">{expenses.loading ? "Loading..." : "No entries this month."}</li>}
          </ul>
        </section>
      </div>
    </CommandCanvas>
  );
}

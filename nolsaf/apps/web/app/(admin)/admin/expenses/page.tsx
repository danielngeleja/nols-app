"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpRight, BookOpenText, CalendarCheck2, ChevronLeft, ChevronRight, Landmark, LayoutDashboard, RefreshCw, TrendingDown, TrendingUp, Users } from "lucide-react";
import { CoverageRing, coverageTone, type MonthCoverage } from "./_coverage";
import { LockedCard, compactTzs, eatDate, eatTodayIso, monthLabel, tzs, useFinanceData } from "./_shared";

/**
 * Expenses overview for one month: does revenue cover the cost of running
 * NoLSAF, how revenue turns into net, what the money went on, and where
 * payroll and the statutory payments stand.
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
  GATEWAY_FEE: "#0ea5e9",
  PARTNER_BONUS: "#8b5cf6",
  SMS: "#f59e0b",
  EMAIL: "#fbbf24",
  HOSTING: "#10b981",
  STAFF: "#0b2420",
  MARKETING: "#d946ef",
  OTHER: "#a3a3a3",
};
const RUN_TONE: Record<string, string> = {
  DRAFT: "bg-amber-50 text-amber-700",
  APPROVED: "bg-sky-50 text-sky-700",
  PAID: "bg-emerald-50 text-emerald-700",
  CANCELLED: "bg-neutral-100 text-neutral-500",
};
const card = "rounded-3xl border border-solid border-neutral-200 bg-white shadow-sm";
const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${v.toFixed(1)}%`);

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
  const expenses = useFinanceData<ExpenseList>(`/api/admin/finance/expenses?from=${month}-01&to=${monthEnd}&pageSize=6`);
  const runs = useFinanceData<Runs>("/api/admin/finance/payroll/runs");
  const employees = useFinanceData<Employees>("/api/admin/finance/payroll/employees?status=ACTIVE");
  const monthRun = runs.data?.items.find((r) => r.periodMonth === month && r.status !== "CANCELLED") ?? null;
  const latestPayable = runs.data?.items.find((r) => r.status === "PAID" || r.status === "APPROVED") ?? null;
  const runDetail = useFinanceData<RunDetail>(latestPayable ? `/api/admin/finance/payroll/runs/${latestPayable.id}` : null);

  const margin = overview.data?.margin;
  const cover = coverage.data?.months[0] ?? null;
  const tone = coverageTone(cover?.coveragePercent ?? null);

  const byCategory = useMemo(() => {
    const labels = new Map((expenses.data?.categories ?? []).map((c) => [c.key, c.label]));
    return (expenses.data?.totals ?? [])
      .filter((t) => t.currency === "TZS" && t.amount !== 0)
      .map((t) => ({ key: t.category, label: labels.get(t.category) ?? t.category, amount: t.amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses.data]);
  const categoryTotal = byCategory.reduce((s, r) => s + r.amount, 0);

  if (overview.locked || coverage.locked || expenses.locked) return <LockedCard what="Expenses" />;

  const refresh = () => { overview.reload(); coverage.reload(); expenses.reload(); runs.reload(); employees.reload(); runDetail.reload(); };
  const loading = overview.loading || coverage.loading;
  const activeCount = (employees.data?.counts?.ACTIVE ?? 0) + (employees.data?.counts?.ON_LEAVE ?? 0);

  // Revenue to net, as steps for the waterfall.
  const steps = margin
    ? [
        { label: "NoLSAF revenue", value: margin.revenue, kind: "total" as const },
        ...margin.costs.filter((c) => c.amount !== 0).map((c) => ({ label: c.label + (c.basis === "ESTIMATE" ? " (est.)" : ""), value: -c.amount, kind: "cost" as const })),
        { label: "Contribution", value: margin.contribution, kind: "subtotal" as const },
        ...margin.operating.filter((c) => c.amount !== 0).map((c) => ({ label: c.label, value: -c.amount, kind: "cost" as const })),
        { label: "Net", value: margin.net, kind: "total" as const },
      ]
    : [];
  const waterScale = Math.max(1, margin?.revenue ?? 0, ...steps.map((s) => Math.abs(s.value)));

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className={`${card} flex flex-wrap items-center gap-4 px-5 py-5 sm:px-6`}>
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[11px] font-semibold text-[#02665e]"><LayoutDashboard className="h-3.5 w-3.5" /> Expenses overview</span>
          <h1 className="m-0 mt-2 text-2xl font-bold tracking-tight text-neutral-900">{monthLabel(month)}</h1>
          <p className="m-0 mt-1 text-sm text-neutral-500">{month === thisMonth ? "So far this month." : "The whole month."} What it cost to run NoLSAF, and whether revenue paid for it.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-full border border-solid border-neutral-200 bg-white p-1">
            <button type="button" onClick={() => setMonth((mm) => shiftMonth(mm, -1))} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-full border-0 bg-transparent text-neutral-600 hover:bg-neutral-100"><ChevronLeft className="h-4 w-4" /></button>
            <span className="w-28 text-center text-sm font-semibold text-neutral-900">{new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}</span>
            <button type="button" onClick={() => setMonth((mm) => shiftMonth(mm, 1))} disabled={month >= thisMonth} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-full border-0 bg-transparent text-neutral-600 hover:bg-neutral-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <button type="button" onClick={refresh} aria-label="Refresh" className="grid h-10 w-10 place-items-center rounded-full border border-solid border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      {/* Coverage: the answer first */}
      <section className={`${card} overflow-hidden`}>
        <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="flex flex-col justify-center px-5 py-6 sm:px-7">
            {cover && cover.totalCosts > 0 ? (() => {
              const percent = cover.coveragePercent ?? 0;
              const state = percent >= 100 ? { label: "Covered", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" } : percent > 0 ? { label: "Partly covered", chip: "bg-amber-50 text-amber-700 ring-amber-200" } : { label: "Not covered yet", chip: "bg-rose-50 text-rose-700 ring-rose-200" };
              // The track runs to whichever is larger, so a surplus shows past the break-even line.
              const scale = Math.max(cover.totalCosts, cover.revenue);
              const fill = (cover.revenue / scale) * 100;
              const breakEven = (cover.totalCosts / scale) * 100;
              const daysLeft = month === thisMonth ? new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(today.slice(8, 10)) + 1 : 0;
              return (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <p className="m-0 text-xs font-semibold text-neutral-500">Revenue coverage</p>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${state.chip}`}>
                      {percent >= 100 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {state.label}
                    </span>
                  </div>
                  <p className="m-0 mt-2 flex flex-wrap items-baseline gap-x-2">
                    <span className={`text-5xl font-bold tracking-tight tabular-nums ${tone.text}`}>{Math.round(percent)}%</span>
                    <span className="text-sm text-neutral-500">of {tzs(cover.totalCosts)} in costs covered by revenue</span>
                  </p>

                  {/* Gauge */}
                  <div className="mt-5">
                    <div className="relative h-3 rounded-full bg-[repeating-linear-gradient(90deg,#f1f3f2_0,#f1f3f2_calc(10%_-_2px),#e5e7e6_calc(10%_-_2px),#e5e7e6_10%)]">
                      <span className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`} style={{ width: `${fill}%`, minWidth: fill > 0 ? 6 : 0 }} />
                      <span className="absolute -top-1.5 h-6 w-0.5 rounded-full bg-neutral-900" style={{ left: `calc(${breakEven}% - 1px)` }} aria-hidden />
                    </div>
                    <div className="relative mt-1.5 h-4 text-[10px] font-semibold text-neutral-400">
                      <span className="absolute left-0">0</span>
                      <span className="absolute -translate-x-1/2 whitespace-nowrap text-neutral-700" style={{ left: `${Math.min(Math.max(breakEven, 10), 90)}%` }}>Break-even {compactTzs(cover.totalCosts)}</span>
                    </div>
                  </div>

                  <dl className="m-0 mt-4 grid grid-cols-2 gap-2.5">
                    <div className="rounded-2xl bg-neutral-50 px-3.5 py-2.5">
                      <dt className="text-[11px] text-neutral-500">{cover.surplus > 0 ? "Left over" : "Revenue gap"}</dt>
                      <dd className={`m-0 mt-0.5 text-base font-bold tabular-nums ${cover.surplus > 0 ? "text-emerald-700" : "text-rose-700"}`}>{tzs(cover.surplus > 0 ? cover.surplus : cover.shortfall)}</dd>
                    </div>
                    <div className="rounded-2xl bg-neutral-50 px-3.5 py-2.5">
                      {cover.surplus > 0 || daysLeft <= 0 ? (
                        <>
                          <dt className="text-[11px] text-neutral-500">Revenue in</dt>
                          <dd className="m-0 mt-0.5 text-base font-bold tabular-nums text-neutral-900">{tzs(cover.revenue)}</dd>
                        </>
                      ) : (
                        <>
                          <dt className="text-[11px] text-neutral-500">Needed per day to break even</dt>
                          <dd className="m-0 mt-0.5 text-base font-bold tabular-nums text-neutral-900">{tzs(cover.shortfall / daysLeft)}</dd>
                          <dd className="m-0 text-[10px] text-neutral-400">over the {daysLeft} day{daysLeft === 1 ? "" : "s"} left</dd>
                        </>
                      )}
                    </div>
                  </dl>
                </>
              );
            })() : (
              <div className="flex items-center gap-4">
                <CoverageRing percent={null} size={72} />
                <div>
                  <p className="m-0 text-sm font-semibold text-neutral-900">{loading ? "Working out revenue and costs..." : "No costs recorded for this month yet"}</p>
                  <p className="m-0 mt-0.5 text-xs text-neutral-500">Coverage appears once payroll or expenses exist for {monthLabel(month)}.</p>
                </div>
              </div>
            )}
          </div>

          <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-neutral-200 bg-neutral-200 lg:border-l lg:border-t-0">
            {[
              { label: "NoLSAF revenue", value: cover ? tzs(cover.revenue) : "...", detail: "realized this month", tone: "text-emerald-700" },
              { label: "Cost to run NoLSAF", value: cover ? tzs(cover.totalCosts) : "...", detail: cover ? `payroll ${compactTzs(cover.payroll.amount)}` : "", tone: "text-neutral-900" },
              { label: "Contribution margin", value: margin ? pct(margin.contributionMarginPercent) : "...", detail: "after costs of earning revenue", tone: "text-neutral-900" },
              { label: "Net margin", value: margin ? pct(margin.netMarginPercent) : "...", detail: "after running costs", tone: margin && (margin.netMarginPercent ?? 0) < 0 ? "text-rose-700" : "text-neutral-900" },
            ].map((f) => (
              <div key={f.label} className="min-w-0 bg-white px-5 py-4">
                <dt className="text-[11px] font-semibold text-neutral-400">{f.label}</dt>
                <dd className={`m-0 mt-1 truncate text-xl font-bold tabular-nums ${f.tone}`}>{f.value}</dd>
                <dd className="m-0 truncate text-[11px] text-neutral-500">{f.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* Revenue to net waterfall */}
        <section className={`${card} p-5 sm:p-6`}>
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-sm font-bold text-neutral-900">From revenue to net</h2>
            <Link href="/admin/finance" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">All Revenue <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          {steps.length ? (
            <ul className="m-0 mt-4 list-none space-y-2.5 p-0">
              {steps.map((s, i) => {
                const width = (Math.abs(s.value) / waterScale) * 100;
                const color = s.kind === "cost" ? "bg-rose-300" : s.value < 0 ? "bg-rose-500" : s.kind === "subtotal" ? "bg-emerald-400" : "bg-[#02665e]";
                return (
                  <li key={`${s.label}-${i}`} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3">
                    <span className={`truncate text-xs ${s.kind === "cost" ? "text-neutral-500" : "font-semibold text-neutral-900"}`}>{s.kind === "cost" ? `less ${s.label.toLowerCase()}` : s.label}</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-neutral-100"><span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.max(width, s.value ? 1.5 : 0)}%` }} /></span>
                    <span className={`text-right text-xs tabular-nums ${s.kind === "cost" ? "text-rose-700" : "font-bold text-neutral-900"}`}>{s.kind === "cost" ? `- ${compactTzs(-s.value)}` : compactTzs(s.value)}</span>
                  </li>
                );
              })}
            </ul>
          ) : <p className="m-0 mt-4 text-xs text-neutral-500">{overview.loading ? "Loading..." : "No revenue or costs for this month yet."}</p>}
        </section>

        {/* Spend by category */}
        <section className={`${card} p-5 sm:p-6`}>
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-sm font-bold text-neutral-900">What the money went on</h2>
            <Link href="/admin/expenses/ledger" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">Ledger <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          {byCategory.length ? (
            <>
              <span className="mt-4 flex h-3 overflow-hidden rounded-full bg-neutral-100">
                {byCategory.map((c) => <span key={c.key} className="h-full" style={{ width: `${(c.amount / categoryTotal) * 100}%`, background: CATEGORY_COLOR[c.key] ?? "#a3a3a3" }} title={`${c.label}: ${tzs(c.amount)}`} />)}
              </span>
              <ul className="m-0 mt-4 list-none space-y-2 p-0">
                {byCategory.map((c) => (
                  <li key={c.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="inline-flex min-w-0 items-center gap-2 text-neutral-700"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[c.key] ?? "#a3a3a3" }} /><span className="truncate">{c.label}</span></span>
                    <span className="shrink-0 tabular-nums"><span className="font-semibold text-neutral-900">{compactTzs(c.amount)}</span> <span className="text-[11px] text-neutral-400">{Math.round((c.amount / categoryTotal) * 100)}%</span></span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="mt-4 rounded-2xl border border-dashed border-neutral-300 px-4 py-6 text-center">
              <p className="m-0 text-sm font-semibold text-neutral-900">Nothing in the ledger yet</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">Paid payroll, bonuses and recorded bills show up here.</p>
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Payroll */}
        <section className={`${card} p-5`}>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#02665e]/10 text-[#02665e]"><Users className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Payroll, {monthLabel(month)}</h2>
              <p className="m-0 text-xs text-neutral-500">{employees.data ? `${activeCount} on the payroll · ${compactTzs(employees.data.monthlyGross)} gross a month` : "Loading..."}</p>
            </div>
          </div>
          <div className="mt-4 rounded-2xl bg-neutral-50 px-4 py-3">
            {monthRun ? (
              <div className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-lg font-bold tabular-nums text-neutral-900">{tzs(monthRun.net)}</span>
                  <span className="block text-[11px] text-neutral-500">net to {monthRun.headcount} · cost {compactTzs(monthRun.employerCost)}</span>
                </span>
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${RUN_TONE[monthRun.status] ?? RUN_TONE.CANCELLED}`}>{monthRun.status.charAt(0) + monthRun.status.slice(1).toLowerCase()}</span>
              </div>
            ) : (
              <p className="m-0 text-sm text-neutral-600">{cover?.payroll.basis === "PROJECTED" ? `No run yet. Projected cost ${compactTzs(cover.payroll.amount)}.` : runs.loading ? "Loading..." : "No pay run for this month."}</p>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/expenses/payroll/runs" className="inline-flex h-9 items-center gap-1.5 rounded-full border-0 bg-[#0b2420] px-3.5 text-xs font-semibold text-white no-underline hover:bg-[#12342f] hover:no-underline"><CalendarCheck2 className="h-3.5 w-3.5" /> Pay runs</Link>
            <Link href="/admin/expenses/payroll/employees" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-solid border-neutral-300 bg-white px-3.5 text-xs font-semibold text-neutral-700 no-underline hover:bg-neutral-50 hover:no-underline"><Users className="h-3.5 w-3.5" /> Employees</Link>
          </div>
        </section>

        {/* Statutory */}
        <section className={`${card} p-5`}>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#02665e]/10 text-[#02665e]"><Landmark className="h-5 w-5" /></span>
            <div className="min-w-0">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Statutory payments</h2>
              <p className="m-0 text-xs text-neutral-500">{latestPayable ? `From ${monthLabel(latestPayable.periodMonth)} payroll` : "Appear once a pay run is approved"}</p>
            </div>
          </div>
          <ul className="m-0 mt-4 list-none space-y-2 p-0">
            {runDetail.data?.remittances.length ? runDetail.data.remittances.map((r) => {
              const overdue = !r.paid && r.dueOn < today;
              return (
                <li key={r.key} className="flex items-center gap-3 rounded-2xl bg-neutral-50 px-3.5 py-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-[9px] font-bold text-emerald-300">{r.payee}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-neutral-900">{r.label}</span>
                    {r.paid ? (
                      <span className="block text-[11px] font-semibold text-emerald-700">Paid {eatDate(r.paid.paidOn)}</span>
                    ) : (
                      <span className={`block text-[11px] ${overdue ? "font-semibold text-rose-700" : "text-neutral-500"}`}>by {eatDate(`${r.dueOn}T00:00:00+03:00`)}{overdue ? ", past due" : ""}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-neutral-900">{compactTzs(r.amount)}</span>
                </li>
              );
            }) : <li className="rounded-2xl border border-dashed border-neutral-300 px-4 py-5 text-center text-xs text-neutral-500">{runs.loading || runDetail.loading ? "Loading..." : "Nothing due yet."}</li>}
          </ul>
        </section>

        {/* Latest entries */}
        <section className={`${card} p-5`}>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[#02665e]/10 text-[#02665e]"><BookOpenText className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-sm font-bold text-neutral-900">Latest entries</h2>
              <p className="m-0 text-xs text-neutral-500">{monthLabel(month)}</p>
            </div>
            <Link href="/admin/expenses/ledger" className="text-xs font-semibold text-[#02665e] no-underline hover:underline">All</Link>
          </div>
          <ul className="m-0 mt-4 list-none space-y-2 p-0">
            {expenses.data?.items.length ? expenses.data.items.map((e) => (
              <li key={e.id} className="flex items-center gap-3 rounded-2xl bg-neutral-50 px-3.5 py-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[e.category] ?? "#a3a3a3" }} />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs font-semibold ${e.reversedAt ? "text-neutral-400 line-through" : "text-neutral-900"}`}>{e.description}</span>
                  <span className="block text-[11px] text-neutral-500">{eatDate(e.incurredAt)} · {e.origin === "SYSTEM" ? "by the platform" : "by an admin"}</span>
                </span>
                <span className={`shrink-0 text-sm font-bold tabular-nums ${e.amount < 0 ? "text-emerald-700" : "text-neutral-900"}`}>{compactTzs(e.amount)}</span>
              </li>
            )) : <li className="rounded-2xl border border-dashed border-neutral-300 px-4 py-5 text-center text-xs text-neutral-500">{expenses.loading ? "Loading..." : "No entries this month."}</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

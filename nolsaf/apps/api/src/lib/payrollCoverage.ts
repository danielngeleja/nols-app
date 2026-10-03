import { prisma } from "@nolsaf/prisma";
import { computeFinanceOverview } from "./financeOverview.js";
import { DEFAULT_PAYROLL_RATES, computePayslip, daysPaidIn, normalizeRates } from "./payroll.js";

/**
 * Does NoLSAF's revenue for a month cover what it costs to run that month?
 *
 *   revenue      NoLSAF revenue for the calendar month (EAT), the same figure
 *                as the Finance overview
 *   payroll      the month's payroll cost to NoLSAF:
 *                  PAID       what was booked to the expense ledger
 *                  DRAFT /    the open run's cost (not in the ledger yet)
 *                  APPROVED
 *                  PROJECTED  no run yet: the register's current pay, costed
 *                             with the statutory rates
 *   other costs  everything else: costs of earning revenue (sales
 *                commissions, referrals, gateway fees, bonuses) and the
 *                running costs in the ledger, without paid payroll so it is
 *                never counted twice
 *   coverage     revenue / total costs, with the shortfall or the surplus
 */

const EAT_OFFSET = "+03:00";
const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function monthBounds(periodMonth: string) {
  const [y, m] = periodMonth.split("-").map(Number);
  const first = `${periodMonth}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return {
    start: new Date(`${first}T00:00:00.000${EAT_OFFSET}`),
    end: new Date(`${last}T23:59:59.999${EAT_OFFSET}`),
    first,
    last,
  };
}

/** Employees paid in the month: started by its end, not ended before its start. */
export function eligibleEmployeesWhere(periodMonth: string) {
  const { start, end } = monthBounds(periodMonth);
  return { startDate: { lte: end }, OR: [{ endDate: null }, { endDate: { gte: start } }], NOT: { AND: [{ status: "TERMINATED" }, { endDate: null }] } };
}

type PayrollBasis = "PAID" | "DRAFT" | "APPROVED" | "PROJECTED" | "NONE";

async function payrollFor(periodMonth: string, range: { gte: Date; lte: Date }) {
  // Payroll already booked to the ledger for this month (paid runs).
  let booked = 0;
  try {
    const rows = await prisma.platformExpense.aggregate({ where: { sourceKey: { startsWith: "PAYROLL:" }, incurredAt: range }, _sum: { amount: true } });
    booked = n(rows._sum.amount);
  } catch {
    booked = 0;
  }

  try {
    const run = await prisma.payrollRun.findFirst({ where: { periodMonth, status: { not: "CANCELLED" } }, orderBy: { id: "desc" } });
    if (run) {
      if (run.status === "PAID") return { amount: booked || n(run.employerCost), basis: "PAID" as PayrollBasis, headcount: run.headcount, booked, net: n(run.net), runNumber: run.runNumber };
      return { amount: n(run.employerCost), basis: run.status as PayrollBasis, headcount: run.headcount, booked, net: n(run.net), runNumber: run.runNumber };
    }

    // No run yet: cost the register as it stands.
    const employees = await prisma.employee.findMany({ where: eligibleEmployeesWhere(periodMonth) as any });
    if (!employees.length) return { amount: booked, basis: "NONE" as PayrollBasis, headcount: 0, booked, net: 0, runNumber: null };
    const setting = await prisma.systemSetting.findUnique({ where: { id: 1 }, select: { payrollSettings: true } });
    const rates = normalizeRates(setting?.payrollSettings ?? DEFAULT_PAYROLL_RATES);
    const sdlApplies = employees.length >= rates.sdlMinEmployees;
    let amount = 0;
    let net = 0;
    for (const e of employees) {
      const days = daysPaidIn(periodMonth, e.startDate, e.endDate);
      const p = computePayslip({ basicSalary: n(e.basicSalary), allowances: n(e.housingAllowance) + n(e.transportAllowance) + n(e.otherAllowance), nssfEnrolled: e.nssfEnrolled, payeExempt: e.payeExempt, heslbDeduct: e.heslbDeduct, daysPaid: days?.daysPaid, periodDays: days?.periodDays }, rates, sdlApplies);
      amount += p.employerCost;
      net += p.net;
    }
    return { amount, basis: "PROJECTED" as PayrollBasis, headcount: employees.length, booked, net, runNumber: null };
  } catch {
    // Payroll tables not migrated yet.
    return { amount: booked, basis: "NONE" as PayrollBasis, headcount: 0, booked, net: 0, runNumber: null };
  }
}

export async function monthCoverage(periodMonth: string) {
  const { start, end } = monthBounds(periodMonth);
  const overview = await computeFinanceOverview(start.toISOString(), end.toISOString());
  const revenue = n(overview.totals.nolsafRevenue);
  const margin = overview.margin;
  const payroll = await payrollFor(periodMonth, { gte: start, lte: end });

  const costOfRevenue = n(margin?.recordedCosts);
  const runningCosts = Math.max(0, n(margin?.operatingTotal) - payroll.booked);
  const otherCosts = costOfRevenue + runningCosts;
  const totalCosts = otherCosts + payroll.amount;
  const coveragePercent = totalCosts > 0 ? Math.round((revenue / totalCosts) * 1000) / 10 : null;

  return {
    periodMonth,
    revenue,
    gmv: n(overview.totals.gmv),
    revenueByStream: overview.streams.map((s) => ({ key: s.key, label: s.label, revenue: n(s.nolsafRevenue) })),
    payroll,
    costOfRevenue,
    runningCosts,
    costOfRevenueLines: (margin?.costs ?? []).filter((c) => n(c.amount) !== 0).map((c) => ({ key: c.key, label: c.label, amount: n(c.amount), basis: c.basis })),
    otherCosts,
    totalCosts,
    coveragePercent,
    shortfall: Math.max(0, totalCosts - revenue),
    surplus: Math.max(0, revenue - totalCosts),
  };
}

/** Coverage for every month of a year up to the current month, oldest first. */
export async function yearCoverage(year: number, currentMonth: string) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter((m) => m <= currentMonth);
  const out: Array<Awaited<ReturnType<typeof monthCoverage>>> = [];
  // A few at a time: each month runs the full revenue aggregation.
  for (let i = 0; i < months.length; i += 3) {
    out.push(...(await Promise.all(months.slice(i, i + 3).map(monthCoverage))));
  }
  return out;
}

import { prisma } from "@nolsaf/prisma";
import { channelOf, estimateGatewayFees, gatewayFeeRates, type FeeChannel } from "./gatewayFees.js";
import { moneyStageOf } from "./invoiceMoneyStage.js";
import { GUEST_MONEY_IN, loadOwnerInvoiceDisbursements } from "./invoiceMoneyStageIndex.js";

/**
 * NoLSAF's own margin, from what the platform records.
 *
 *   Take rate            = NoLSAF revenue / GMV
 *   Contribution         = revenue - costs of earning it (sales commissions,
 *                          referral earnings, gateway fees, partner bonuses)
 *   Contribution margin  = contribution / revenue
 *   Net                  = contribution - running costs (SMS, email, hosting,
 *                          staff, marketing, other)
 *   Net margin           = net / revenue
 *
 * Gateway fees: entries recorded from settlement statements win. A period
 * without any is estimated at the configured rate on guest money collected,
 * and the response says which one it is.
 */

export type DateRange = { gte?: Date; lte?: Date } | undefined;
type ToTzs = (amount: number, currency?: string | null) => number;

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const round2 = (x: number) => Math.round(x * 100) / 100;

export const EXPENSE_CATEGORIES = [
  { key: "GATEWAY_FEE", label: "Payment gateway fees", kind: "COST_OF_REVENUE" },
  { key: "PARTNER_BONUS", label: "Driver and owner bonuses", kind: "COST_OF_REVENUE" },
  { key: "SMS", label: "SMS", kind: "OPERATING" },
  { key: "EMAIL", label: "Email", kind: "OPERATING" },
  { key: "HOSTING", label: "Hosting and software", kind: "OPERATING" },
  { key: "STAFF", label: "Staff", kind: "OPERATING" },
  { key: "MARKETING", label: "Marketing", kind: "OPERATING" },
  { key: "OTHER", label: "Other running costs", kind: "OPERATING" },
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["key"];
export const EXPENSE_CATEGORY_KEYS = new Set<string>(EXPENSE_CATEGORIES.map((c) => c.key));
export const REVENUE_STREAMS = ["accommodation", "tours", "transport", "groupStay", "subscriptions"] as const;

/** Booking invoices only: an OINV- owner claim restates a booking already invoiced to the guest. */
const BOOKING_INVOICE = { OR: [{ invoiceNumber: null }, { NOT: { invoiceNumber: { startsWith: "OINV-" } } }] };

/**
 * Accommodation revenue, one rule for every screen: commission on booking
 * invoices whose guest has paid (money stage in GUEST_MONEY_IN), dated by when
 * the guest paid. Invoice status alone cannot be used: PAID also marks owner
 * payouts, and a paid booking invoice moves on through REQUESTED, VERIFIED and
 * APPROVED as the owner claims it, while its commission stays earned.
 */
export async function accommodationTake(range: DateRange) {
  const where = range
    ? { AND: [BOOKING_INVOICE, { OR: [{ paidAt: range }, { paidAt: null, issuedAt: range }] }] }
    : BOOKING_INVOICE;
  const rows = await prisma.invoice.findMany({
    where: where as any,
    select: { id: true, status: true, invoiceNumber: true, total: true, commissionAmount: true, netPayable: true, paymentMethod: true },
  });
  const disbursements = await loadOwnerInvoiceDisbursements(range ? rows.map((r) => r.id) : undefined);

  const out = { gmv: 0, commission: 0, partnerNet: 0, count: 0, pendingCommission: 0, pendingCount: 0, byChannel: { MNO: 0, BANK: 0, CARD: 0 } as Record<FeeChannel, number> };
  for (const row of rows) {
    const { stage } = moneyStageOf(row, disbursements.get(row.id) ?? []);
    if (GUEST_MONEY_IN.has(stage)) {
      out.gmv += n(row.total);
      out.byChannel[channelOf((row as any).paymentMethod)] += n(row.total);
      out.commission += n(row.commissionAmount);
      out.partnerNet += n(row.netPayable);
      out.count += 1;
    } else if (stage === "AWAITING_GUEST") {
      out.pendingCommission += n(row.commissionAmount);
      out.pendingCount += 1;
    }
  }
  return out;
}

/**
 * Sales commissions that are a real cost to NoLSAF. A reversed commission
 * that was already paid keeps its row and gains a linked negative offset, so
 * the two net to zero. One reversed before payment gets no offset, so it is
 * left out, as are cancelled ones.
 */
export const SALES_COMMISSION_COST_WHERE = {
  OR: [
    { status: { notIn: ["REVERSED", "CANCELLED"] } },
    { status: "REVERSED", paidAt: { not: null } },
  ],
};

/** Costs recorded in other ledgers, plus money at risk. All in TZS. */
export async function platformCosts(range: DateRange, toTzs: ToTzs) {
  const [sales, referrals, recoveries] = await Promise.all([
    prisma.salesCommission.groupBy({
      by: ["currency"],
      where: { ...SALES_COMMISSION_COST_WHERE, ...(range ? { earnedAt: range } : {}) },
      _sum: { commissionAmount: true },
      _count: { _all: true },
    }),
    prisma.referralEarning.groupBy({
      by: ["currency"],
      where: range ? { createdAt: range } : {},
      _sum: { amount: true },
      _count: { _all: true },
    }),
    // Tour operators owe these back after a refund; unrecovered, they are a loss.
    prisma.tourFinancialTransaction.groupBy({
      by: ["currency"],
      where: { kind: "PAYOUT_RECOVERY", status: "PENDING", ...(range ? { createdAt: range } : {}) },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  const sum = (rows: Array<{ currency: string | null; _sum: Record<string, unknown>; _count: { _all: number } }>, field: string) => ({
    amount: rows.reduce((acc, r) => acc + toTzs(n(r._sum[field]), r.currency), 0),
    count: rows.reduce((acc, r) => acc + r._count._all, 0),
  });

  return {
    salesCommissions: sum(sales as any, "commissionAmount"),
    referralEarnings: sum(referrals as any, "amount"),
    payoutRecoveryAtRisk: sum(recoveries as any, "amount"),
  };
}

/**
 * The expense ledger by category, in TZS. Reversing rows carry negative
 * amounts, so the plain sum is the true position; `count` excludes them.
 */
export async function platformExpenses(range: DateRange, toTzs: ToTzs) {
  try {
    return await readPlatformExpenses(range, toTzs);
  } catch (err: any) {
    // The table arrives with migration 20261002090000; until it is applied the
    // margin still loads, with no ledger costs, instead of failing the page.
    console.warn("[platformMargin] expense ledger unavailable:", err?.message || err);
    return new Map<string, { amount: number; count: number }>();
  }
}

async function readPlatformExpenses(range: DateRange, toTzs: ToTzs) {
  const rows = await prisma.platformExpense.groupBy({
    by: ["category", "currency"],
    where: range ? { incurredAt: range } : {},
    _sum: { amount: true },
    _count: { _all: true },
  });
  const entries = await prisma.platformExpense.groupBy({
    by: ["category"],
    where: { reversesExpenseId: null, reversedAt: null, ...(range ? { incurredAt: range } : {}) },
    _count: { _all: true },
  });
  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const current = byCategory.get(row.category) ?? { amount: 0, count: 0 };
    current.amount += toTzs(n(row._sum.amount), row.currency);
    byCategory.set(row.category, current);
  }
  for (const row of entries) {
    const current = byCategory.get(row.category) ?? { amount: 0, count: 0 };
    current.count = row._count._all;
    byCategory.set(row.category, current);
  }
  return byCategory;
}

/** Costs that exist in the business but are still not recorded or estimated. */
export function unrecordedCosts(input: { gatewayFeesKnown: boolean; runningCostsRecorded: boolean }) {
  const out: Array<{ key: string; label: string; detail: string }> = [];
  if (!input.gatewayFeesKnown) {
    out.push({ key: "gatewayFees", label: "Payment gateway fees", detail: "Record them from the provider's settlement statement, or set an estimate rate in Expenses." });
  }
  if (!input.runningCostsRecorded) {
    out.push({ key: "operating", label: "Running costs", detail: "SMS, email, hosting, staff and marketing: record the bills in Expenses to see a net margin." });
  }
  return out;
}

export function marginSummary(input: {
  gmv: number;
  revenue: number;
  salesCommissions: number;
  referralEarnings: number;
  gatewayFees?: number;
  partnerBonuses?: number;
  operatingCosts?: number;
}) {
  const costOfRevenue = input.salesCommissions + input.referralEarnings + (input.gatewayFees ?? 0) + (input.partnerBonuses ?? 0);
  const contribution = input.revenue - costOfRevenue;
  const net = contribution - (input.operatingCosts ?? 0);
  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
  return {
    takeRatePercent: pct(input.revenue, input.gmv),
    recordedCosts: costOfRevenue,
    contribution,
    contributionMarginPercent: pct(contribution, input.revenue),
    net,
    netMarginPercent: pct(net, input.revenue),
  };
}

/**
 * The full margin block for the finance overview: revenue, every cost line
 * with where it comes from, contribution and net, plus money at risk.
 */
export async function buildMargin(input: { range: DateRange; toTzs: ToTzs; gmv: number; revenue: number; channelGmv?: Partial<Record<FeeChannel, number>> }) {
  const [costs, expenses, rates] = await Promise.all([
    platformCosts(input.range, input.toTzs),
    platformExpenses(input.range, input.toTzs),
    gatewayFeeRates(),
  ]);
  const expense = (key: ExpenseCategory) => expenses.get(key) ?? { amount: 0, count: 0 };

  const gatewayRecorded = expense("GATEWAY_FEE");
  const gatewayFromStatements = gatewayRecorded.count > 0 || gatewayRecorded.amount !== 0;
  // Guest money by channel where the platform knows it (accommodation); the
  // rest of GMV is charged at the mobile money rate.
  const attributed = Object.values(input.channelGmv ?? {}).reduce((acc, v) => acc + (v ?? 0), 0);
  const estimate = estimateGatewayFees(input.channelGmv ?? {}, Math.max(0, input.gmv - attributed), rates);
  const gatewayEstimate = !gatewayFromStatements && input.gmv > 0 ? estimate.total : null;
  const gatewayFees = gatewayFromStatements ? gatewayRecorded.amount : gatewayEstimate ?? 0;

  const bonuses = expense("PARTNER_BONUS");
  const operating = EXPENSE_CATEGORIES.filter((c) => c.kind === "OPERATING").map((c) => ({
    key: c.key,
    label: c.label,
    amount: round2(expense(c.key).amount),
    count: expense(c.key).count,
  }));
  const operatingTotal = operating.reduce((acc, c) => acc + c.amount, 0);

  const summary = marginSummary({
    gmv: input.gmv,
    revenue: input.revenue,
    salesCommissions: costs.salesCommissions.amount,
    referralEarnings: costs.referralEarnings.amount,
    gatewayFees,
    partnerBonuses: bonuses.amount,
    operatingCosts: operatingTotal,
  });

  const gatewayBasis = gatewayFromStatements ? "STATEMENTS" : gatewayEstimate != null || input.gmv <= 0 ? "ESTIMATE" : "MISSING";
  return {
    revenue: round2(input.revenue),
    takeRatePercent: summary.takeRatePercent,
    costs: [
      { key: "salesCommissions", label: "Sales partner commissions", amount: round2(costs.salesCommissions.amount), count: costs.salesCommissions.count, basis: "RECORDED" },
      { key: "referralEarnings", label: "Driver referral earnings", amount: round2(costs.referralEarnings.amount), count: costs.referralEarnings.count, basis: "RECORDED" },
      {
        key: "gatewayFees",
        label: "Payment gateway fees",
        amount: round2(gatewayFees),
        count: gatewayRecorded.count,
        basis: gatewayBasis,
        note: gatewayBasis === "ESTIMATE" ? `Estimated with ${rates.provider} rates: mobile money ${rates.MNO}%, bank ${rates.BANK}%, card ${rates.CARD}%` : gatewayBasis === "MISSING" ? "Not recorded" : "From settlement statements",
        estimate: { provider: rates.provider, lines: estimate.lines, total: estimate.total },
      },
      { key: "partnerBonuses", label: "Driver and owner bonuses", amount: round2(bonuses.amount), count: bonuses.count, basis: "RECORDED" },
    ],
    recordedCosts: round2(summary.recordedCosts),
    contribution: round2(summary.contribution),
    contributionMarginPercent: summary.contributionMarginPercent,
    operating,
    operatingTotal: round2(operatingTotal),
    net: round2(summary.net),
    netMarginPercent: summary.netMarginPercent,
    atRisk: { payoutRecovery: round2(costs.payoutRecoveryAtRisk.amount), payoutRecoveryCount: costs.payoutRecoveryAtRisk.count },
    notRecorded: unrecordedCosts({ gatewayFeesKnown: gatewayBasis !== "MISSING", runningCostsRecorded: operating.some((c) => c.count > 0) }),
  };
}

// apps/api/src/lib/salesStatement.ts
//
// A sales partner's monthly statement: what they earned, what was reversed,
// what was paid out, and the withholding tax taken from those payouts.
//
// Mirrors customerStatement.ts: read-only, never throws, and every total is
// computed from the same rows the document lists, so the headline figures and
// the registers can never disagree. Months run on East Africa Time (UTC+3),
// the business day NoLSAF books and pays on.

const EAT_OFFSET = "+03:00";
const num = (v: unknown) => Number(v ?? 0);
const iso = (d: unknown) => (d ? new Date(d as any).toISOString() : null);
const round2 = (v: number) => Math.round(v * 100) / 100;

export const STATEMENT_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function monthRange(month: string): { from: Date; to: Date } | null {
  const m = STATEMENT_MONTH.exec(month);
  if (!m) return null;
  const year = Number(m[1]);
  const index = Number(m[2]);
  const from = new Date(`${m[1]}-${m[2]}-01T00:00:00${EAT_OFFSET}`);
  const nextYear = index === 12 ? year + 1 : year;
  const nextMonth = index === 12 ? 1 : index + 1;
  const to = new Date(`${nextYear}-${String(nextMonth).padStart(2, "0")}-01T00:00:00${EAT_OFFSET}`);
  return { from, to };
}

/** "2026-09" for a date, in East Africa Time. */
export function monthKey(date: Date): string {
  const eat = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${eat.getUTCFullYear()}-${String(eat.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type SalesStatement = {
  month: string;
  period: { from: string; to: string };
  partner: {
    agentCode: string;
    name: string | null;
    email: string | null;
    region: string | null;
    taxIdNumber: string | null;
  };
  currency: string;
  summary: {
    earned: number;
    earnedCount: number;
    reversed: number;
    reversedCount: number;
    netEarned: number;
    payoutsCount: number;
    grossPaid: number;
    deductions: number;
    withholdingTax: number;
    netReceived: number;
  };
  earnings: Array<{
    id: number;
    earnedAt: string | null;
    property: string;
    stream: string;
    eligibleRevenue: number;
    rate: number;
    amount: number;
    status: string;
  }>;
  reversals: Array<{ id: number; reversedAt: string | null; property: string; stream: string; amount: number }>;
  payouts: Array<{
    id: number;
    reference: string;
    paidAt: string | null;
    approved: number;
    deduction: number;
    withholdingTaxRate: number | null;
    withholdingTax: number;
    net: number;
    destination: string;
  }>;
};

function maskAccount(value: unknown): string {
  const digits = String(value ?? "").replace(/\s/g, "");
  return digits.length > 4 ? `ending ${digits.slice(-4)}` : digits || "not recorded";
}

export async function buildSalesStatement(db: any, partnerId: number, month: string): Promise<SalesStatement | null> {
  const range = monthRange(month);
  if (!range) return null;
  const { from, to } = range;

  const empty = (partner: SalesStatement["partner"]): SalesStatement => ({
    month,
    period: { from: from.toISOString(), to: to.toISOString() },
    partner,
    currency: "TZS",
    summary: {
      earned: 0, earnedCount: 0, reversed: 0, reversedCount: 0, netEarned: 0,
      payoutsCount: 0, grossPaid: 0, deductions: 0, withholdingTax: 0, netReceived: 0,
    },
    earnings: [],
    reversals: [],
    payouts: [],
  });

  const profile = await db.salesPartnerProfile
    .findUnique({
      where: { id: partnerId },
      select: { agentCode: true, region: true, taxIdNumber: true, user: { select: { name: true, fullName: true, email: true } } },
    })
    .catch(() => null);
  const partner: SalesStatement["partner"] = {
    agentCode: String(profile?.agentCode || ""),
    name: profile?.user?.fullName || profile?.user?.name || null,
    email: profile?.user?.email || null,
    region: profile?.region || null,
    taxIdNumber: profile?.taxIdNumber || null,
  };

  try {
    const [earnedRows, reversedRows, payoutRows] = await Promise.all([
      db.salesCommission.findMany({
        where: { salesPartnerId: partnerId, earnedAt: { gte: from, lt: to }, status: { not: "CANCELLED" } },
        orderBy: { earnedAt: "asc" },
        select: { id: true, propertyId: true, type: true, status: true, eligibleNetRevenue: true, commissionRate: true, commissionAmount: true, currency: true, earnedAt: true },
      }),
      db.salesCommission.findMany({
        where: { salesPartnerId: partnerId, status: "REVERSED", reversedAt: { gte: from, lt: to } },
        orderBy: { reversedAt: "asc" },
        select: { id: true, propertyId: true, type: true, commissionAmount: true, reversedAt: true },
      }),
      db.salesPayoutRequest.findMany({
        where: { salesPartnerId: partnerId, status: "PAID", paidAt: { gte: from, lt: to } },
        orderBy: { paidAt: "asc" },
        select: {
          id: true, referenceNumber: true, paidAt: true, approvedAmount: true, requestedAmount: true,
          deductionAmount: true, withholdingTaxRate: true, withholdingTaxAmount: true, netPaidAmount: true,
          payoutMethod: true, payoutAccount: true, currency: true,
        },
      }),
    ]);

    const propertyIds = [...new Set([...earnedRows, ...reversedRows].map((r: any) => r.propertyId).filter((id: unknown) => Number.isInteger(id)))];
    const properties = propertyIds.length
      ? await db.property.findMany({ where: { id: { in: propertyIds } }, select: { id: true, title: true } }).catch(() => [])
      : [];
    const titleOf = new Map<number, string>(properties.map((p: any) => [p.id, String(p.title || "")]));
    const propertyLabel = (id: unknown) => (Number.isInteger(id) ? titleOf.get(id as number) || "Property" : "Adjustment");
    const stream = (type: unknown) =>
      String(type || "").toUpperCase() === "NRMS_USAGE"
        ? "NRMS commission"
        : String(type || "").toUpperCase() === "MARKETPLACE_BOOKING"
          ? "Marketplace share"
          : String(type || "").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) || "Other";

    const earnings = earnedRows.map((r: any) => ({
      id: r.id,
      earnedAt: iso(r.earnedAt),
      property: propertyLabel(r.propertyId),
      stream: stream(r.type),
      eligibleRevenue: num(r.eligibleNetRevenue),
      rate: num(r.commissionRate),
      amount: num(r.commissionAmount),
      status: String(r.status || ""),
    }));
    const reversals = reversedRows.map((r: any) => ({
      id: r.id,
      reversedAt: iso(r.reversedAt),
      property: propertyLabel(r.propertyId),
      stream: stream(r.type),
      amount: num(r.commissionAmount),
    }));
    const payouts = payoutRows.map((r: any) => {
      const approved = num(r.approvedAmount ?? r.requestedAmount);
      const deduction = num(r.deductionAmount);
      const withholdingTax = num(r.withholdingTaxAmount);
      return {
        id: r.id,
        reference: String(r.referenceNumber || ""),
        paidAt: iso(r.paidAt),
        approved,
        deduction,
        withholdingTaxRate: r.withholdingTaxRate == null ? null : num(r.withholdingTaxRate),
        withholdingTax,
        net: r.netPaidAmount == null ? round2(approved - deduction - withholdingTax) : num(r.netPaidAmount),
        destination: `${r.payoutMethod || "Payout"} ${maskAccount(r.payoutAccount)}`,
      };
    });

    const sum = (rows: any[], key: string) => round2(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
    const earned = sum(earnings, "amount");
    const reversed = sum(reversals, "amount");
    return {
      ...empty(partner),
      summary: {
        earned,
        earnedCount: earnings.length,
        reversed,
        reversedCount: reversals.length,
        netEarned: round2(earned - reversed),
        payoutsCount: payouts.length,
        grossPaid: sum(payouts, "approved"),
        deductions: sum(payouts, "deduction"),
        withholdingTax: sum(payouts, "withholdingTax"),
        netReceived: sum(payouts, "net"),
      },
      earnings,
      reversals,
      payouts,
    };
  } catch (err: any) {
    console.warn("Failed to build sales statement:", err?.message);
    return empty(partner);
  }
}

/** Months with statement activity, newest first, capped at two years. */
export async function listStatementMonths(db: any, partnerId: number, now = new Date()): Promise<string[]> {
  const [firstCommission, firstPayout] = await Promise.all([
    db.salesCommission.findFirst({ where: { salesPartnerId: partnerId }, orderBy: { earnedAt: "asc" }, select: { earnedAt: true } }).catch(() => null),
    db.salesPayoutRequest.findFirst({ where: { salesPartnerId: partnerId }, orderBy: { requestedAt: "asc" }, select: { requestedAt: true } }).catch(() => null),
  ]);
  const starts = [firstCommission?.earnedAt, firstPayout?.requestedAt].filter(Boolean).map((d: any) => new Date(d).getTime());
  const current = monthKey(now);
  if (!starts.length) return [current];
  const first = monthKey(new Date(Math.min(...starts)));
  const months: string[] = [];
  let [y, m] = current.split("-").map(Number);
  while (months.length < 24) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.push(key);
    if (key <= first) break;
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  return months;
}

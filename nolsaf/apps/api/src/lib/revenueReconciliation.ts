// apps/api/src/lib/revenueReconciliation.ts
//
// The revenue ledger (revenue_entry) next to the figures /admin/finance
// recomputes today, for a range of EAT business days, with the sources behind
// every difference. Read only. This is the check that has to come out clean
// (or explained) before the finance overview reads from the ledger
// (docs/REVENUE_LEDGER.md, "Read switch").

import { prisma } from "@nolsaf/prisma";
import { computeFinanceOverview } from "./financeOverview.js";
import { getFxRates, BASE_CURRENCY } from "./fx.js";
import { GUEST_MONEY_IN, loadOwnerInvoiceDisbursements } from "./invoiceMoneyStageIndex.js";
import { moneyStageOf } from "./invoiceMoneyStage.js";
import { adminRecordReference } from "./adminRecordReference.js";
import { REVENUE_STREAMS, round2, type RevenueStream } from "./revenueLedger.js";

const OVERVIEW_KEY: Record<RevenueStream, "accommodation" | "tours" | "transport" | "groupStay" | "subscriptions"> = {
  ACCOMMODATION: "accommodation",
  TOUR: "tours",
  TRANSPORT: "transport",
  GROUP_STAY: "groupStay",
  SUBSCRIPTION: "subscriptions",
};
const LABEL: Record<RevenueStream, string> = {
  ACCOMMODATION: "Accommodation",
  TOUR: "Tours",
  TRANSPORT: "Transport",
  GROUP_STAY: "Group stay",
  SUBSCRIPTION: "Subscriptions",
};
/** Differences under half a shilling are rounding, not a finding. */
const TOLERANCE = 0.5;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export type DayRange = { from: string; to: string } | null;

export function parseDayRange(from?: unknown, to?: unknown): DayRange | "invalid" {
  if (!from && !to) return null;
  const f = String(from ?? "");
  const t = String(to ?? "");
  if (!DAY.test(f) || !DAY.test(t) || f > t) return "invalid";
  return { from: f, to: t };
}

const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** The instants that bound a range of EAT days, for the overview's own date filters. */
export function eatInstants(range: { from: string; to: string }) {
  return {
    from: new Date(`${range.from}T00:00:00.000+03:00`),
    to: new Date(new Date(`${nextDay(range.to)}T00:00:00.000+03:00`).getTime() - 1),
  };
}

// ── Per-source figures, as the overview counts them ──────────────────────────

export type SourceFigure = { stream: RevenueStream; sourceType: string; sourceId: number; label: string; commissionTzs: number; grossTzs: number };

async function overviewSources(range: DayRange): Promise<SourceFigure[]> {
  const span = range ? eatInstants(range) : null;
  const within = span ? { gte: span.from, lte: span.to } : undefined;
  const fx = await getFxRates();
  const toTzs = (amount: number, currency?: string | null) => {
    const cur = String(currency || BASE_CURRENCY).toUpperCase();
    const rate = fx.tzsPerUnit[cur];
    return cur === BASE_CURRENCY || !(rate > 0) ? amount : amount * rate;
  };
  const db = prisma as any;
  const out: SourceFigure[] = [];

  // Accommodation: lib/platformMargin.accommodationTake, row by row.
  const bookingInvoice = { OR: [{ invoiceNumber: null }, { NOT: { invoiceNumber: { startsWith: "OINV-" } } }] };
  const invoices = await db.invoice.findMany({
    where: within ? { AND: [bookingInvoice, { OR: [{ paidAt: within }, { paidAt: null, issuedAt: within }] }] } : bookingInvoice,
    select: { id: true, status: true, invoiceNumber: true, total: true, commissionAmount: true },
  });
  const disbursements = await loadOwnerInvoiceDisbursements(invoices.map((i: any) => i.id));
  for (const inv of invoices) {
    if (!GUEST_MONEY_IN.has(moneyStageOf(inv, disbursements.get(inv.id) ?? []).stage)) continue;
    out.push({ stream: "ACCOMMODATION", sourceType: "INVOICE", sourceId: inv.id, label: inv.invoiceNumber || "Booking invoice", commissionTzs: n(inv.commissionAmount), grossTzs: n(inv.total) });
  }

  const tours = await db.tourBooking.findMany({
    where: { paymentStatus: "PAID", ...(within ? { paidAt: within } : {}) },
    select: { id: true, bookingCode: true, currency: true, grossAmount: true, commissionAmount: true },
  });
  for (const t of tours) {
    out.push({ stream: "TOUR", sourceType: "TOUR_BOOKING", sourceId: t.id, label: t.bookingCode, commissionTzs: toTzs(n(t.commissionAmount), t.currency), grossTzs: toTzs(n(t.grossAmount), t.currency) });
  }

  const trips = await db.transportPayout.findMany({
    where: { booking: { paymentStatus: "PAID", ...(within ? { updatedAt: within } : {}) } },
    select: { transportBookingId: true, grossAmount: true, commissionAmount: true, booking: { select: { tripCode: true } } },
  });
  for (const p of trips) {
    out.push({ stream: "TRANSPORT", sourceType: "TRANSPORT_BOOKING", sourceId: p.transportBookingId, label: p.booking?.tripCode || "Transport trip", commissionTzs: n(p.commissionAmount), grossTzs: n(p.grossAmount) });
  }

  const groups = await db.groupBooking.findMany({
    where: { depositPaid: true, ...(within ? { depositPaidAt: within } : {}) },
    select: { id: true, totalAmount: true, ownerAmount: true },
  });
  for (const g of groups) {
    out.push({ stream: "GROUP_STAY", sourceType: "GROUP_BOOKING", sourceId: g.id, label: adminRecordReference("group-stay", g.id), commissionTzs: n(g.totalAmount) - n(g.ownerAmount), grossTzs: n(g.totalAmount) });
  }

  const payments = await db.nrmsServicePayment.findMany({
    where: { status: { in: ["VERIFIED", "MANUALLY_VERIFIED"] }, ...(within ? { verifiedAt: within } : {}) },
    select: { id: true, amount: true, currency: true, provider: true, providerRef: true },
  });
  for (const p of payments) {
    const amount = toTzs(n(p.amount), p.currency);
    out.push({ stream: "SUBSCRIPTION", sourceType: "NRMS_SERVICE_PAYMENT", sourceId: p.id, label: p.providerRef ? `${p.provider} ${p.providerRef}` : "NRMS payment", commissionTzs: amount, grossTzs: amount });
  }
  return out;
}

// ── Classification ───────────────────────────────────────────────────────────

export type LedgerSourceFigure = { stream: RevenueStream; sourceType: string; sourceId: number; commissionTzs: number; reversed: boolean };

export type Finding = {
  stream: RevenueStream;
  /** MISSING: no ledger row at all. OTHER_PERIOD: recognized on a day outside the range.
   *  LEDGER_ONLY: in the ledger for the range, not counted by the overview.
   *  AMOUNT: both count it, for different amounts. */
  kind: "MISSING" | "OTHER_PERIOD" | "LEDGER_ONLY" | "AMOUNT";
  sourceType: string;
  label: string;
  ledger: number;
  overview: number;
  difference: number;
  reversed: boolean;
};

const keyOf = (s: { stream: string; sourceType: string; sourceId: number }) => `${s.stream}:${s.sourceType}:${s.sourceId}`;

/**
 * Pairs the overview's sources with the ledger's, per source, and keeps only
 * the ones that disagree. `recognizedElsewhere` holds keys of sources the
 * ledger recognized on a day outside the range.
 */
export function classifySources(
  overview: SourceFigure[],
  ledger: LedgerSourceFigure[],
  recognizedElsewhere: Set<string>,
  labels: Map<string, string> = new Map(),
): Finding[] {
  const fromOverview = new Map(overview.map((s) => [keyOf(s), s]));
  const fromLedger = new Map<string, LedgerSourceFigure>();
  for (const row of ledger) {
    const key = keyOf(row);
    const cur = fromLedger.get(key);
    fromLedger.set(key, cur ? { ...cur, commissionTzs: cur.commissionTzs + row.commissionTzs, reversed: cur.reversed || row.reversed } : { ...row });
  }
  const findings: Finding[] = [];
  for (const [key, o] of fromOverview) {
    const l = fromLedger.get(key);
    if (!l) {
      findings.push({ stream: o.stream, kind: recognizedElsewhere.has(key) ? "OTHER_PERIOD" : "MISSING", sourceType: o.sourceType, label: o.label, ledger: 0, overview: round2(o.commissionTzs), difference: round2(-o.commissionTzs), reversed: false });
    } else if (Math.abs(l.commissionTzs - o.commissionTzs) > TOLERANCE) {
      findings.push({ stream: o.stream, kind: "AMOUNT", sourceType: o.sourceType, label: o.label, ledger: round2(l.commissionTzs), overview: round2(o.commissionTzs), difference: round2(l.commissionTzs - o.commissionTzs), reversed: l.reversed });
    }
  }
  for (const [key, l] of fromLedger) {
    if (fromOverview.has(key) || Math.abs(l.commissionTzs) <= TOLERANCE) continue;
    findings.push({ stream: l.stream, kind: "LEDGER_ONLY", sourceType: l.sourceType, label: labels.get(key) ?? `${l.sourceType.toLowerCase().replace(/_/g, " ")}`, ledger: round2(l.commissionTzs), overview: 0, difference: round2(l.commissionTzs), reversed: l.reversed });
  }
  return findings.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

/** Readable labels for ledger-only sources (the overview has none for them). */
async function labelsFor(keys: Array<{ stream: RevenueStream; sourceType: string; sourceId: number }>) {
  const db = prisma as any;
  const ids = (type: string) => keys.filter((k) => k.sourceType === type).map((k) => k.sourceId);
  const out = new Map<string, string>();
  const put = (stream: RevenueStream, type: string, id: number, label: string | null | undefined) => {
    if (label) out.set(`${stream}:${type}:${id}`, label);
  };
  const [inv, tours, trips, pays] = await Promise.all([
    ids("INVOICE").length ? db.invoice.findMany({ where: { id: { in: ids("INVOICE") } }, select: { id: true, invoiceNumber: true } }) : [],
    ids("TOUR_BOOKING").length ? db.tourBooking.findMany({ where: { id: { in: ids("TOUR_BOOKING") } }, select: { id: true, bookingCode: true } }) : [],
    ids("TRANSPORT_BOOKING").length ? db.transportBooking.findMany({ where: { id: { in: ids("TRANSPORT_BOOKING") } }, select: { id: true, tripCode: true } }) : [],
    ids("NRMS_SERVICE_PAYMENT").length ? db.nrmsServicePayment.findMany({ where: { id: { in: ids("NRMS_SERVICE_PAYMENT") } }, select: { id: true, provider: true, providerRef: true } }) : [],
  ]);
  inv.forEach((r: any) => put("ACCOMMODATION", "INVOICE", r.id, r.invoiceNumber));
  tours.forEach((r: any) => put("TOUR", "TOUR_BOOKING", r.id, r.bookingCode));
  trips.forEach((r: any) => put("TRANSPORT", "TRANSPORT_BOOKING", r.id, r.tripCode));
  pays.forEach((r: any) => put("SUBSCRIPTION", "NRMS_SERVICE_PAYMENT", r.id, r.providerRef ? `${r.provider} ${r.providerRef}` : null));
  ids("GROUP_BOOKING").forEach((id) => put("GROUP_STAY", "GROUP_BOOKING", id, adminRecordReference("group-stay", id)));
  return out;
}

// ── Report ───────────────────────────────────────────────────────────────────

export async function computeRevenueReconciliation(range: DayRange, opts: { limit?: number } = {}) {
  const db = prisma as any;
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200));
  const businessDate = range ? { gte: new Date(`${range.from}T00:00:00.000Z`), lte: new Date(`${range.to}T00:00:00.000Z`) } : undefined;
  const span = range ? eatInstants(range) : null;

  const [overview, rows, sources] = await Promise.all([
    computeFinanceOverview(span?.from.toISOString(), span?.to.toISOString(), { margin: false }),
    db.revenueEntry.findMany({
      where: businessDate ? { businessDate } : {},
      select: { id: true, stream: true, sourceType: true, sourceId: true, entryType: true, reversesId: true, grossTzs: true, commissionTzs: true, partnerNetTzs: true },
    }),
    overviewSources(range),
  ]);

  // Reversals count against the source they reverse, wherever it was recognized.
  const originalIds = [...new Set(rows.filter((r: any) => r.reversesId).map((r: any) => r.reversesId))];
  const originals = new Map<number, any>(rows.map((r: any) => [r.id, r]));
  const missingOriginals = originalIds.filter((id) => !originals.has(id as number));
  if (missingOriginals.length) {
    const extra = await db.revenueEntry.findMany({ where: { id: { in: missingOriginals } }, select: { id: true, stream: true, sourceType: true, sourceId: true } });
    extra.forEach((r: any) => originals.set(r.id, r));
  }
  const ledgerSources: LedgerSourceFigure[] = rows.map((r: any) => {
    const target = r.reversesId ? originals.get(r.reversesId) ?? r : r;
    return { stream: target.stream, sourceType: target.sourceType, sourceId: target.sourceId, commissionTzs: n(r.commissionTzs), reversed: r.entryType === "REVERSAL" };
  });

  // Overview sources with no ledger row in range: recognized on another day, or not at all?
  const inRange = new Set(ledgerSources.map(keyOf));
  const absent = sources.filter((s) => !inRange.has(keyOf(s))).map(keyOf);
  const elsewhere = new Set<string>();
  for (let i = 0; i < absent.length; i += 1000) {
    const found = await db.revenueEntry.findMany({ where: { sourceKey: { in: absent.slice(i, i + 1000) } }, select: { sourceKey: true } });
    found.forEach((f: any) => elsewhere.add(f.sourceKey));
  }

  const overviewKeys = new Set(sources.map(keyOf));
  const ledgerOnly = [...new Map(ledgerSources.filter((s) => !overviewKeys.has(keyOf(s))).map((s) => [keyOf(s), s])).values()];
  const findings = classifySources(sources, ledgerSources, elsewhere, await labelsFor(ledgerOnly));

  const streams = REVENUE_STREAMS.map((stream) => {
    const mine = rows.filter((r: any) => r.stream === stream);
    const sum = (field: string, type?: string) => round2(mine.filter((r: any) => !type || r.entryType === type).reduce((acc: number, r: any) => acc + n(r[field]), 0));
    const o = overview.streams.find((s) => s.key === OVERVIEW_KEY[stream])!;
    const ledgerRevenue = sum("commissionTzs");
    const own = findings.filter((f) => f.stream === stream);
    const count = (kind: Finding["kind"]) => own.filter((f) => f.kind === kind).length;
    return {
      stream,
      label: LABEL[stream],
      ledger: {
        revenue: ledgerRevenue,
        gmv: sum("grossTzs"),
        partnerNet: sum("partnerNetTzs"),
        recognized: mine.filter((r: any) => r.entryType === "RECOGNIZED").length,
        reversals: mine.filter((r: any) => r.entryType === "REVERSAL").length,
        reversedRevenue: -sum("commissionTzs", "REVERSAL"),
      },
      overview: { revenue: round2(o.nolsafRevenue), gmv: round2(o.gmv), partnerNet: round2(o.partnerNet), count: o.realizedCount },
      difference: round2(ledgerRevenue - o.nolsafRevenue),
      findings: { missing: count("MISSING"), otherPeriod: count("OTHER_PERIOD"), ledgerOnly: count("LEDGER_ONLY"), amount: count("AMOUNT") },
    };
  });

  const totals = streams.reduce(
    (acc, s) => ({ ledger: round2(acc.ledger + s.ledger.revenue), overview: round2(acc.overview + s.overview.revenue), difference: round2(acc.difference + s.difference) }),
    { ledger: 0, overview: 0, difference: 0 },
  );

  return {
    ok: true,
    baseCurrency: BASE_CURRENCY,
    range: range ?? null,
    ledgerEntries: rows.length,
    totals,
    streams,
    findings: findings.slice(0, limit),
    findingsTotal: findings.length,
    generatedAt: new Date().toISOString(),
  };
}

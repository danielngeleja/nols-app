import { prisma } from '@nolsaf/prisma';
import { SeriesResponse, BreakdownResponse } from '../types/stats.js';
import { moneyStageOf, MONEY_STAGES } from '../lib/invoiceMoneyStage.js';
import { GUEST_MONEY_IN, OWED_TO_PAYEE, indexMoneyStages, loadOwnerInvoiceDisbursements } from '../lib/invoiceMoneyStageIndex.js';
import { accommodationTake } from '../lib/platformMargin.js';

const TZ_OFFSET_MS = 3 * 60 * 60 * 1000; // EAT UTC+3
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar day in Dar es Salaam (YYYY-MM-DD). API hosts run UTC, so never use the host date. */
const eatDayKey = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);

/** Every EAT day from `from` to `to`, inclusive. */
function eatDayLabels(fromDate: Date, toDate: Date): string[] {
  const labels: string[] = [];
  const last = eatDayKey(toDate);
  let cursor = new Date(`${eatDayKey(fromDate)}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= last) {
    labels.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  return labels;
}

/** Booking invoices only: an OINV- owner claim restates a booking already invoiced to the guest. */
const BOOKING_INVOICE = { OR: [{ invoiceNumber: null }, { NOT: { invoiceNumber: { startsWith: 'OINV-' } } }] };

/**
 * Guest money received in the window: booking invoices whose money stage shows
 * the guest has paid, dated by when they paid (issue date as a fallback for
 * older rows without paidAt). Owner claims are excluded so a booking is never
 * counted twice.
 */
async function guestMoneyInvoices(fromDate: Date, toDate: Date, region?: string) {
  const window = { gte: fromDate, lte: toDate };
  const rows = await prisma.invoice.findMany({
    where: {
      AND: [
        BOOKING_INVOICE,
        { OR: [{ paidAt: window }, { paidAt: null, issuedAt: window }] },
        ...(region && region !== 'ALL' ? [{ booking: { property: { regionId: String(region) } } }] : []),
      ],
    } as any,
    select: {
      id: true,
      status: true,
      invoiceNumber: true,
      total: true,
      paidAt: true,
      issuedAt: true,
      booking: { select: { property: { select: { type: true, regionName: true } } } },
    },
  });
  const disbursements = await loadOwnerInvoiceDisbursements(rows.map((r) => r.id));
  return rows.filter((row) => GUEST_MONEY_IN.has(moneyStageOf(row, disbursements.get(row.id) ?? []).stage));
}

export async function getRevenueSeries(from?: string, to?: string, region?: string): Promise<SeriesResponse> {
  const toDate = to ? new Date(String(to)) : new Date();
  const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * DAY_MS);

  const labels = eatDayLabels(fromDate, toDate);
  const dataMap: Record<string, number> = Object.fromEntries(labels.map((l) => [l, 0]));
  const add = (when: Date, amount: number) => {
    const k = eatDayKey(when);
    if (dataMap[k] !== undefined) dataMap[k] += amount;
  };

  for (const inv of await guestMoneyInvoices(fromDate, toDate, region)) {
    add((inv.paidAt ?? inv.issuedAt) as Date, Number(inv.total ?? 0));
  }

  // Fold in transport (money movement) when not filtering by region. Transport
  // is TZS and not region-scoped in this series. Tours are USD denominated and
  // are intentionally EXCLUDED from this TZS series to avoid mixing currencies.
  if (!region || region === 'ALL') {
    try {
      const payouts = await prisma.transportPayout.findMany({
        where: {
          booking: { paymentStatus: 'PAID' },
          createdAt: { gte: fromDate, lte: toDate },
        },
        select: { grossAmount: true, paidAt: true, createdAt: true },
      });
      for (const p of payouts) {
        add(new Date(((p as any).paidAt ?? (p as any).createdAt) as Date), Number((p as any).grossAmount ?? 0));
      }
    } catch (err) {
      console.warn('getRevenueSeries: transport series skipped:', (err as any)?.message || err);
    }
  }

  const data = labels.map(l => Math.round((dataMap[l] || 0) * 100) / 100);
  return { labels, data };
}

/**
 * Approved properties on the platform at the end of each EAT day. A property's
 * approval time is not stored, so its listing date (createdAt) stands in for
 * when it went live. Better than the flat line this used to return.
 */
export async function getActivePropertiesSeries(from?: string, to?: string, region?: string): Promise<SeriesResponse> {
  const toDate = to ? new Date(String(to)) : new Date();
  const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 30 * DAY_MS);

  const where: any = { status: 'APPROVED' };
  if (region && region !== 'ALL') where.regionId = String(region);
  const listed = await prisma.property.findMany({ where, select: { createdAt: true } });
  const listedDays = listed.map((p) => eatDayKey(p.createdAt)).sort();

  const labels = eatDayLabels(fromDate, toDate);
  let index = 0;
  const data = labels.map((day) => {
    while (index < listedDays.length && listedDays[index] <= day) index += 1;
    return index;
  });
  return { labels, data };
}

/** Guest money received in the window, grouped by property type or region. */
export async function getRevenueByType(from?: string, to?: string, region?: string, groupBy: string = 'propertyType'): Promise<SeriesResponse> {
  const toDate = to ? new Date(String(to)) : new Date();
  const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 365 * DAY_MS);

  const map: Record<string, number> = {};
  for (const inv of await guestMoneyInvoices(fromDate, toDate, region)) {
    const property = inv.booking?.property;
    const key = groupBy === 'region' ? property?.regionName || 'Unknown' : property?.type || 'Other';
    map[key] = (map[key] || 0) + Number(inv.total ?? 0);
  }
  const labels = Object.keys(map).sort((a, b) => map[b] - map[a]);
  const data = labels.map((l: string) => Math.round((map[l] || 0) * 100) / 100);
  return { labels, data };
}

/** Invoices issued in the window, by money stage (see lib/invoiceMoneyStage.ts). */
export async function getInvoiceStages(from?: string, to?: string) {
  const toDate = to ? new Date(String(to)) : new Date();
  const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 365 * DAY_MS);
  const { totals } = await indexMoneyStages({ issuedAt: { gte: fromDate, lte: toDate } });
  return { stages: MONEY_STAGES.map((s) => s.key), totals };
}

export async function getActivePropertiesBreakdown(groupBy = 'propertyType', region?: string): Promise<BreakdownResponse> {
  if (groupBy === 'propertyType') {
    const rows: Array<any> = await prisma.property.groupBy({ by: ['type'], where: { status: 'APPROVED', ...(region && region !== 'ALL' ? { regionId: String(region) } : {}) }, _count: { _all: true } }) as any;
    const labels = rows.map((r: any) => r.type || 'Other');
    const data = rows.map((r: any) => r._count._all);
    return { labels, data };
  }
  const rows: Array<any> = await prisma.property.groupBy({ by: ['regionName'], where: { status: 'APPROVED', ...(region && region !== 'ALL' ? { regionId: String(region) } : {}) }, _count: { _all: true } }) as any;
  const labels = rows.map((r: any) => r.regionName || 'Unknown');
  const data = rows.map((r: any) => r._count._all);
  return { labels, data };
}

export async function getInvoiceStatus(from?: string, to?: string): Promise<Record<string, number>> {
  const toDate = to ? new Date(String(to)) : new Date();
  const fromDate = from ? new Date(String(from)) : new Date(Date.now() - 365 * 24 * 3600 * 1000);
  const rows = await prisma.invoice.groupBy({ by: ['status'], where: { issuedAt: { gte: fromDate, lte: toDate } }, _count: { _all: true } });
  const result: Record<string, number> = {};
  for (const r of rows) result[r.status] = r._count._all;
  return result;
}

export async function getOverview() {
  // 1. Active & approved owners (role=OWNER, suspendedAt IS NULL, has at least 1 APPROVED property)
  const ownersWithApprovedProps = await prisma.property.groupBy({
    by: ['ownerId'],
    where: { status: 'APPROVED' },
  });
  const approvedOwnerIds = ownersWithApprovedProps.map((p: { ownerId: number }) => p.ownerId);
  const activeApprovedOwnersCount = approvedOwnerIds.length > 0
    ? await prisma.user.count({
        where: {
          role: 'OWNER',
          suspendedAt: null,
          kycStatus: 'APPROVED_KYC',
          id: { in: approvedOwnerIds },
        },
      })
    : 0;

  // 2. Active & approved properties (status=APPROVED)
  const approvedPropertiesCount = await prisma.property.count({
    where: { status: 'APPROVED' },
  });

  // 3. Total Payment: accommodation revenue from all active (non-cancelled) bookings.
  //    = SUM(booking.totalAmount - transportFare) for CONFIRMED, CHECKED_IN, CHECKED_OUT.
  //    Excludes transport (pass-through) and excludes cancelled bookings.
  const activeBookings = await prisma.booking.findMany({
    where: { status: { in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] } },
    select: { totalAmount: true, transportFare: true },
  });
  const totalPayment = activeBookings.reduce(
    (sum, b) => sum + Math.max(0, Number(b.totalAmount ?? 0) - Number(b.transportFare ?? 0)),
    0
  );

  // 4. Net Payable: owner payouts from APPROVED + PAID invoices (committed by NoLSAF).
  const settledInvoices = await prisma.invoice.findMany({
    where: { status: { in: ['APPROVED', 'PAID'] } },
    select: { netPayable: true, commissionAmount: true },
  });
  const ownerPayouts = settledInvoices.reduce(
    (sum, inv) => sum + Number(inv.netPayable ?? 0),
    0
  );

  // 5. NoLSAF Revenue: commission earned across ALL active revenue sources.
  //    Property + Transport are TZS (money of record) and form companyRevenue.
  //    Tours are USD-denominated and are reported SEPARATELY (companyRevenueTour)
  //    so we never sum USD into the TZS figure. Each source recognized when the
  //    customer payment is complete.

  // 5a. Property commission: the same rule as the Finance overview
  //     (lib/platformMargin.accommodationTake), so both screens agree.
  const companyRevenueProperty = (await accommodationTake(undefined)).commission;

  // 5b. Tour commission: operator-tour commission, recognized when the customer
  //     has paid (paymentStatus = PAID or paidAt set). Defensive against an
  //     unmigrated DB so the overview never hard-fails.
  let companyRevenueTour = 0;
  let companyRevenueTourCurrency = "USD";
  try {
    const paidTours = await prisma.tourBooking.findMany({
      where: { OR: [{ paymentStatus: "PAID" }, { paidAt: { not: null } }] },
      select: { commissionAmount: true, currency: true },
    });
    companyRevenueTour = paidTours.reduce(
      (sum, t) => sum + Number((t as any).commissionAmount ?? 0),
      0
    );
    // Tours are USD-only in practice; use the first record's currency as the
    // label, falling back to USD.
    const firstCur = paidTours.find((t) => (t as any).currency)?.["currency" as any];
    if (firstCur) companyRevenueTourCurrency = String(firstCur);
  } catch (err) {
    console.warn("getOverview: tour commission skipped:", (err as any)?.message || err);
  }

  // 5c. Transport commission: platform commission on driver trips, recognized
  //     when the customer payment for the trip is complete (booking PAID).
  let companyRevenueTransport = 0;
  try {
    const transportPayouts = await prisma.transportPayout.findMany({
      where: { booking: { paymentStatus: "PAID" } },
      select: { commissionAmount: true },
    });
    companyRevenueTransport = transportPayouts.reduce(
      (sum, p) => sum + Number((p as any).commissionAmount ?? 0),
      0
    );
  } catch (err) {
    console.warn("getOverview: transport commission skipped:", (err as any)?.message || err);
  }

  // 6. Owner payouts by money stage: what NoLSAF owes payees now, and what
  //    has been confirmed delivered. Status alone mixes guest and payout
  //    payments, so these read the disbursement records.
  const stageTotals = (await indexMoneyStages()).totals;
  const owed = stageTotals.filter((t) => OWED_TO_PAYEE.has(t.stage));
  const owedToPayees = owed.reduce((sum, t) => sum + t.netPayable, 0);
  const owedToPayeesCount = owed.reduce((sum, t) => sum + t.count, 0);
  const disbursedToPayees = stageTotals.find((t) => t.stage === "DISBURSED")?.netPayable ?? 0;

  // TZS company revenue = Property + Transport (both TZS). Tour (USD) is kept
  // separate and never added here.
  const companyRevenue = companyRevenueProperty + companyRevenueTransport;

  // grossAmount kept for compatibility: accommodation settled (netPayable + property commission)
  const grossAmount = ownerPayouts + companyRevenueProperty;

  return {
    ownersCount: activeApprovedOwnersCount,
    propertiesCount: approvedPropertiesCount,
    totalPayment,
    grossAmount,
    ownerPayouts,
    companyRevenue,
    // Per-source breakdown so reports can show where revenue comes from.
    // Property + Transport are TZS; Tour is in its own currency (USD).
    companyRevenueProperty,
    companyRevenueTransport,
    companyRevenueTour,
    companyRevenueTourCurrency,
    owedToPayees,
    owedToPayeesCount,
    disbursedToPayees,
    lastUpdated: new Date().toISOString(),
  };
}

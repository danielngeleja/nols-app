// Database side of the Tour Operator Disbursement Policy (tourPayoutPolicy.ts):
// reads an operator's standing and the advance rows already on their bookings.

import { prisma } from "@nolsaf/prisma";
import { computeAgentLevel, resolveTierLadder } from "./agentLevel.js";
import {
  ADVANCE_IN_FLIGHT_STATUSES,
  ADVANCE_LIVE_STATUSES,
  ADVANCE_PAID_STATUSES,
  ADVANCE_TRANCHE,
  type OperatorStanding,
} from "./tourPayoutPolicy.js";

export type AdvanceTotals = {
  /** Not rejected or failed: counts against the 70% cap. */
  committed: number;
  /** Money that has actually left NoLSAF as an advance. */
  paid: number;
  /** Claimed, verified or approved but not paid yet. */
  inFlight: number;
  rows: Array<{ id: number; status: string; amount: number; createdAt: Date; metadata: any }>;
};

const EMPTY_TOTALS: AdvanceTotals = { committed: 0, paid: 0, inFlight: 0, rows: [] };

export function isAdvanceRow(metadata: unknown): boolean {
  return Boolean(metadata && typeof metadata === "object" && (metadata as any).tranche === ADVANCE_TRANCHE);
}

/** Advance totals per booking id. Advance rows are kind PAYOUT tagged metadata.tranche = ADVANCE. */
export async function loadAdvanceTotals(bookingIds: number[]): Promise<Map<number, AdvanceTotals>> {
  const out = new Map<number, AdvanceTotals>();
  if (!bookingIds.length) return out;
  const rows = await prisma.tourFinancialTransaction.findMany({
    where: { tourBookingId: { in: bookingIds }, kind: "PAYOUT" },
    select: { id: true, tourBookingId: true, status: true, amount: true, createdAt: true, metadata: true },
    orderBy: { createdAt: "asc" },
  });
  for (const row of rows) {
    if (!isAdvanceRow(row.metadata)) continue;
    const totals = out.get(row.tourBookingId) ?? { committed: 0, paid: 0, inFlight: 0, rows: [] };
    const status = String(row.status || "").toUpperCase();
    const amount = Number(row.amount) || 0;
    if ((ADVANCE_LIVE_STATUSES as readonly string[]).includes(status)) totals.committed += amount;
    if ((ADVANCE_PAID_STATUSES as readonly string[]).includes(status)) totals.paid += amount;
    if ((ADVANCE_IN_FLIGHT_STATUSES as readonly string[]).includes(status)) totals.inFlight += amount;
    totals.rows.push({ id: row.id, status, amount, createdAt: row.createdAt, metadata: row.metadata });
    out.set(row.tourBookingId, totals);
  }
  return out;
}

export async function loadAdvanceTotalsFor(bookingId: number): Promise<AdvanceTotals> {
  return (await loadAdvanceTotals([bookingId])).get(bookingId) ?? { ...EMPTY_TOTALS, rows: [] };
}

/**
 * Tier (computed live exactly as /api/agent/me does), whether the operator has
 * a verified default payout destination, and any unpaid recovery debt.
 */
export async function loadOperatorStanding(agent: { id: number; userId: number }): Promise<OperatorStanding> {
  const [completedTours, revenueAgg, reviewsAgg, tierSetting, payoutAccount, pendingRecovery] = await Promise.all([
    prisma.tourBooking.count({ where: { operatorAgentId: agent.id, status: "COMPLETED" } }),
    prisma.tourBooking.aggregate({
      // Same "paid" test as /api/agent/me so the tier can never disagree.
      where: { operatorAgentId: agent.id, OR: [{ paymentStatus: "PAID" }, { paidAt: { not: null } }] },
      _sum: { commissionAmount: true },
    }),
    prisma.agentReview.aggregate({
      where: { agentId: agent.id },
      _avg: { punctualityRating: true, customerCareRating: true, communicationRating: true },
      _count: { _all: true },
    }),
    prisma.systemSetting.findUnique({ where: { id: 1 }, select: { agentTierLadder: true } as any }).catch(() => null),
    prisma.payoutAccount.findFirst({
      where: { userId: agent.userId, isVerified: true, isActive: true },
      select: { id: true },
    }),
    prisma.tourFinancialTransaction.aggregate({
      where: { kind: "PAYOUT_RECOVERY", status: "PENDING", booking: { operatorAgentId: agent.id } },
      _sum: { amount: true },
    }),
  ]);

  const avg = (reviewsAgg as any)?._avg || {};
  const totalReviews = Number((reviewsAgg as any)?._count?._all ?? 0) || 0;
  const parts = [avg.punctualityRating, avg.customerCareRating, avg.communicationRating];
  const overallRating = parts.every((n) => typeof n === "number") ? (parts[0] + parts[1] + parts[2]) / 3 : null;
  const tiers = resolveTierLadder((tierSetting as any)?.agentTierLadder);
  const level = computeAgentLevel(
    {
      completedTours,
      noLSAFRevenue: Math.round(Number(revenueAgg._sum.commissionAmount ?? 0)),
      overallRating,
      totalReviews,
    },
    tiers
  );

  return {
    tier: level.level,
    hasVerifiedPayoutDestination: Boolean(payoutAccount),
    pendingRecoveryAmount: Number(pendingRecovery._sum.amount ?? 0),
  };
}

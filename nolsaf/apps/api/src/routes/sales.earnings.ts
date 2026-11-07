import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitSalesPropertyRead } from "../middleware/rateLimit.js";
import {
  partnerIdFor,
  requireActivePartnerContract,
  requireWorkspaceAccess,
  type SalesAuthedRequest,
} from "../middleware/salesWorkspace.js";
import {
  COMMISSION_STATUSES,
  COMMISSION_TYPES,
  MIN_PAYOUT_AMOUNT,
  PENDING_BALANCE_STATUSES,
} from "../lib/salesPartner.js";
import { earningRef } from "../lib/salesReference.js";

const router = Router();
const db = prisma as any;
const DAY_MS = 24 * 60 * 60 * 1000;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "YYYY-MM" of a date in EAT. */
function eatMonth(date: Date) {
  return new Date(date.getTime() + EAT_OFFSET_MS).toISOString().slice(0, 7);
}

/** The UTC instant at which an EAT month starts, `back` months before now. */
function eatMonthStart(now: Date, back = 0) {
  const eat = new Date(now.getTime() + EAT_OFFSET_MS);
  return new Date(Date.UTC(eat.getUTCFullYear(), eat.getUTCMonth() - back, 1) - EAT_OFFSET_MS);
}

/** Where an earning came from, in words. The idempotency key carries row ids, so it never leaves the server. */
function sourceLabel(sourceKey: string, type: string) {
  const key = String(sourceKey || "");
  if (key.startsWith("NRMS_STATEMENT:")) return "NRMS monthly statement";
  if (key.startsWith("INVOICE:")) return type === "MARKETPLACE_BOOKING" ? "Marketplace booking invoice" : "Invoice";
  if (key.startsWith("BONUS:")) return "Performance bonus";
  if (key.startsWith("ADJUSTMENT:REVERSAL-")) return "Reversal of an earlier earning";
  if (key.startsWith("ADJUSTMENT:")) return "Adjustment by NoLSAF";
  return type === "MANUAL_ADJUSTMENT" ? "Adjustment by NoLSAF" : "Programme earning";
}

router.use(
  requireAuth as RequestHandler,
  requireWorkspaceAccess("SALES"),
  requireActivePartnerContract,
  limitSalesPropertyRead,
);

const idSchema = z.object({ commissionId: z.coerce.number().int().positive() });
const rangeFields = {
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  type: z.enum(COMMISSION_TYPES).optional(),
  status: z.enum(COMMISSION_STATUSES).optional(),
  propertyId: z.coerce.number().int().positive().optional(),
  ...rangeFields,
});
const chartSchema = z.object({
  type: z.enum(COMMISSION_TYPES).optional(),
  from: z.coerce.date().default(() => new Date(Date.now() - 89 * DAY_MS)),
  to: z.coerce.date().default(() => new Date()),
});

function invalid(res: Response, parsed: { success: boolean; error?: any }) {
  if (parsed.success) return false;
  res.status(400).json({ error: parsed.error?.issues?.[0]?.message || "Invalid request" });
  return true;
}

function partnerId(req: SalesAuthedRequest, res: Response): number | null {
  const id = partnerIdFor(req);
  if (!id) res.status(403).json({ error: "Sales partner context required" });
  return id;
}

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function publicCommission(row: any) {
  const { id, sourceKey, property, contract, ...rest } = row;
  return {
    ...rest,
    ref: earningRef(id),
    source: sourceLabel(sourceKey, row.type),
    property: property ? { title: property.title } : null,
    contract: contract ? { contractNumber: contract.contractNumber, nrmsCommissionRate: contract.nrmsCommissionRate, marketplaceRevenueRate: contract.marketplaceRevenueRate } : null,
    grossAmount: number(row.grossAmount),
    taxAmount: number(row.taxAmount),
    processingFeeAmount: number(row.processingFeeAmount),
    refundAmount: number(row.refundAmount),
    discountAmount: number(row.discountAmount),
    eligibleNetRevenue: number(row.eligibleNetRevenue),
    commissionRate: number(row.commissionRate),
    commissionAmount: number(row.commissionAmount),
  };
}

function dateWhere(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
}

/** GET /api/sales/earnings/summary */
router.get("/earnings/summary", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const now = new Date();
  const monthStart = eatMonthStart(now);
  const trendStart = eatMonthStart(now, 5);
  const [rows, thisMonth, withdrawable, recent, pendingRows] = await Promise.all([
    db.salesCommission.groupBy({
      by: ["status", "type", "currency"],
      where: { salesPartnerId: scopedPartnerId },
      _sum: { commissionAmount: true, eligibleNetRevenue: true },
      _count: { id: true },
    }),
    db.salesCommission.aggregate({
      where: {
        salesPartnerId: scopedPartnerId,
        earnedAt: { gte: monthStart },
        status: { notIn: ["CANCELLED", "REVERSED"] },
      },
      _sum: { commissionAmount: true },
    }),
    db.salesCommission.aggregate({
      where: { salesPartnerId: scopedPartnerId, status: "AVAILABLE", payoutItem: null },
      _sum: { commissionAmount: true },
    }),
    // Six EAT months, for the trend and last month's comparison.
    db.salesCommission.findMany({
      where: { salesPartnerId: scopedPartnerId, earnedAt: { gte: trendStart }, status: { notIn: ["CANCELLED", "REVERSED"] } },
      select: { earnedAt: true, commissionAmount: true },
      take: 5_000,
    }),
    // Pending money and when its validation window ends.
    db.salesCommission.findMany({
      where: { salesPartnerId: scopedPartnerId, status: { in: [...PENDING_BALANCE_STATUSES] } },
      select: { eligibleAt: true, commissionAmount: true },
      orderBy: { eligibleAt: "asc" },
      take: 5_000,
    }),
  ]);
  const trend = Array.from({ length: 6 }, (_, index) => ({ month: eatMonth(eatMonthStart(now, 5 - index)), amount: 0 }));
  const byMonth = new Map(trend.map((point) => [point.month, point]));
  for (const row of recent) {
    const point = byMonth.get(eatMonth(row.earnedAt));
    if (point) point.amount += number(row.commissionAmount);
  }
  const unlocks = { within7Days: 0, within30Days: 0, later: 0, next: null as null | { at: string; amount: number } };
  for (const row of pendingRows) {
    const amount = number(row.commissionAmount);
    const at = row.eligibleAt ? new Date(row.eligibleAt) : null;
    const days = at ? (at.getTime() - now.getTime()) / DAY_MS : Infinity;
    if (days <= 7) unlocks.within7Days += amount;
    else if (days <= 30) unlocks.within30Days += amount;
    else unlocks.later += amount;
    if (at && at.getTime() > now.getTime()) {
      if (!unlocks.next) unlocks.next = { at: at.toISOString(), amount };
      else if (at.toISOString().slice(0, 10) === unlocks.next.at.slice(0, 10)) unlocks.next.amount += amount;
    }
  }
  const summary = {
    pending: 0,
    available: number(withdrawable._sum.commissionAmount),
    paid: 0,
    reversed: 0,
    totalEarned: 0,
    eligibleNetRevenue: 0,
    thisMonth: number(thisMonth._sum.commissionAmount),
    currency: "TZS",
    count: 0,
    byStream: {
      NRMS_USAGE: 0,
      MARKETPLACE_BOOKING: 0,
      PERFORMANCE_BONUS: 0,
      MANUAL_ADJUSTMENT: 0,
    } as Record<string, number>,
    byStatus: {} as Record<string, number>,
    statusCounts: {} as Record<string, number>,
    lastMonth: trend[4].amount,
    inWithdrawal: 0,
    minimum: MIN_PAYOUT_AMOUNT,
    trend,
    unlocks,
  };
  for (const row of rows) {
    const amount = number(row._sum.commissionAmount);
    summary.count += row._count.id;
    summary.eligibleNetRevenue += number(row._sum.eligibleNetRevenue);
    summary.byStatus[row.status] = (summary.byStatus[row.status] || 0) + amount;
    summary.statusCounts[row.status] = (summary.statusCounts[row.status] || 0) + row._count.id;
    summary.byStream[row.type] = (summary.byStream[row.type] || 0) + amount;
    if (PENDING_BALANCE_STATUSES.includes(row.status)) summary.pending += amount;
    // AVAILABLE rows already locked to a payout are excluded by the separate
    // withdrawable aggregate above.
    if (row.status === "PAID") summary.paid += amount;
    if (row.status === "REVERSED") summary.reversed += Math.abs(amount);
    if (!["CANCELLED", "REVERSED"].includes(row.status)) summary.totalEarned += amount;
  }
  // AVAILABLE earnings already inside an open withdrawal.
  summary.inWithdrawal = Math.max(0, (summary.byStatus.AVAILABLE || 0) - summary.available);
  res.json({ summary });
}));

/** GET /api/sales/earnings */
router.get("/earnings", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const { page, pageSize, type, status, propertyId, from, to } = parsed.data!;
  if (from && to && from > to) return res.status(400).json({ error: "from must be before to" });
  const where: any = {
    salesPartnerId: scopedPartnerId,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(propertyId ? { propertyId } : {}),
    ...(dateWhere(from, to) ? { earnedAt: dateWhere(from, to) } : {}),
  };
  const [total, earnings] = await Promise.all([
    db.salesCommission.count({ where }),
    db.salesCommission.findMany({
      where,
      orderBy: [{ earnedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        status: true,
        sourceKey: true,
        grossAmount: true,
        taxAmount: true,
        processingFeeAmount: true,
        refundAmount: true,
        discountAmount: true,
        eligibleNetRevenue: true,
        commissionRate: true,
        commissionAmount: true,
        currency: true,
        description: true,
        earnedAt: true,
        eligibleAt: true,
        approvedAt: true,
        availableAt: true,
        paidAt: true,
        reversedAt: true,
        property: { select: { id: true, title: true } },
        contract: { select: { id: true, contractNumber: true } },
      },
    }),
  ]);
  res.json({ total, page, pageSize, earnings: earnings.map(publicCommission) });
}));

/** GET /api/sales/earnings/chart */
router.get("/earnings/chart", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = chartSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const { type, from, to } = parsed.data!;
  if (from > to) return res.status(400).json({ error: "from must be before to" });
  if (to.getTime() - from.getTime() > 366 * DAY_MS) {
    return res.status(400).json({ error: "Chart range cannot exceed 366 days" });
  }
  const rows = await db.salesCommission.findMany({
    where: {
      salesPartnerId: scopedPartnerId,
      earnedAt: { gte: from, lte: to },
      status: { notIn: ["CANCELLED", "REVERSED"] },
      ...(type ? { type } : {}),
    },
    orderBy: { earnedAt: "asc" },
    select: { earnedAt: true, type: true, commissionAmount: true },
  });
  const points = new Map<string, { date: string; NRMS_USAGE: number; MARKETPLACE_BOOKING: number; other: number }>();
  for (const row of rows) {
    const date = row.earnedAt.toISOString().slice(0, 10);
    const point = points.get(date) || { date, NRMS_USAGE: 0, MARKETPLACE_BOOKING: 0, other: 0 };
    const amount = number(row.commissionAmount);
    if (row.type === "NRMS_USAGE") point.NRMS_USAGE += amount;
    else if (row.type === "MARKETPLACE_BOOKING") point.MARKETPLACE_BOOKING += amount;
    else point.other += amount;
    points.set(date, point);
  }
  res.json({ from, to, points: [...points.values()] });
}));

/** GET /api/sales/earnings/:commissionId */
router.get("/earnings/:commissionId", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = idSchema.safeParse(req.params);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const commission = await db.salesCommission.findFirst({
    where: { id: parsed.data!.commissionId, salesPartnerId: scopedPartnerId },
    select: {
      id: true,
      type: true,
      status: true,
      sourceKey: true,
      grossAmount: true,
      taxAmount: true,
      processingFeeAmount: true,
      refundAmount: true,
      discountAmount: true,
      eligibleNetRevenue: true,
      commissionRate: true,
      commissionAmount: true,
      currency: true,
      description: true,
      earnedAt: true,
      eligibleAt: true,
      approvedAt: true,
      availableAt: true,
      paidAt: true,
      reversedAt: true,
      reversalReason: true,
      adjustmentReason: true,
      property: { select: { id: true, title: true } },
      contract: {
        select: {
          id: true,
          contractNumber: true,
          nrmsCommissionRate: true,
          marketplaceRevenueRate: true,
        },
      },
    },
  });
  if (!commission) return res.status(404).json({ error: "Earning not found" });
  res.json({ earning: publicCommission(commission) });
}));

export default router;

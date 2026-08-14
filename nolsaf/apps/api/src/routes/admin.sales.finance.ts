import crypto from "crypto";
import { Router, type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { limitSalesAdminRead, limitSalesAdminWrite } from "../middleware/rateLimit.js";
import { COMMISSION_STATUSES, COMMISSION_TYPES, PAYOUT_STATUSES, maskPayoutAccount } from "../lib/salesPartner.js";
import { notifyUser } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import {
  calculateSalesPayoutApproval,
  canApproveCommission,
  canReverseCommission,
  canTransitionSalesPayout,
} from "../lib/salesFinance.js";

const router = Router();
const db = prisma as any;

router.use(
  requireAuth as RequestHandler,
  requireRole("ADMIN") as RequestHandler,
  blockImpersonated as RequestHandler,
);

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const reason = z.string().trim().min(5).max(300).transform(sanitizeText);
const actionSchema = z.object({ reason }).strict();
const commissionListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(COMMISSION_STATUSES).optional(),
  type: z.enum(COMMISSION_TYPES).optional(),
  q: z.string().trim().max(120).optional(),
});
const payoutListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(PAYOUT_STATUSES).optional(),
  q: z.string().trim().max(120).optional(),
});
const approvePayoutSchema = z.object({
  deductionAmount: z.coerce.number().finite().min(0).default(0),
  reason,
}).strict();
const adjustmentSchema = z.object({
  salesPartnerId: z.coerce.number().int().positive(),
  propertyId: z.coerce.number().int().positive().nullable().optional(),
  amount: z.coerce.number().finite().refine((value) => value !== 0, "Amount cannot be zero"),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  reason,
}).strict();

class FinanceConflictError extends Error {}
class FinanceNotFoundError extends Error {}

function invalid(res: Response, parsed: { success: boolean; error?: any }) {
  if (parsed.success) return false;
  res.status(400).json({ error: parsed.error?.issues?.[0]?.message || "Invalid request" });
  return true;
}

function number(value: unknown) {
  return Number(value || 0);
}

function auditData(req: AuthedRequest, action: string, entity: string, entityId: number, beforeJson: any, afterJson: any) {
  return {
    actorId: req.user!.id,
    actorRole: req.user!.role || "ADMIN",
    action,
    entity,
    entityId,
    ip: req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || null,
    ua: String(req.headers["user-agent"] || "") || null,
    beforeJson,
    afterJson,
  };
}

function publicPayout(row: any) {
  return {
    ...row,
    requestedAmount: number(row.requestedAmount),
    approvedAmount: row.approvedAmount == null ? null : number(row.approvedAmount),
    deductionAmount: number(row.deductionAmount),
    netPaidAmount: row.netPaidAmount == null ? null : number(row.netPaidAmount),
    payoutAccount: maskPayoutAccount(row.payoutAccount),
  };
}

router.get("/commissions", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = commissionListSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const { page, pageSize, status, type, q } = parsed.data!;
  const where: any = { ...(status ? { status } : {}), ...(type ? { type } : {}) };
  if (q) {
    where.OR = [
      { sourceKey: { contains: q } },
      { property: { is: { title: { contains: q } } } },
      { salesPartner: { is: { agentCode: { contains: q } } } },
    ];
  }
  const [total, commissions] = await Promise.all([
    db.salesCommission.count({ where }),
    db.salesCommission.findMany({
      where,
      orderBy: [{ earnedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        property: { select: { id: true, title: true } },
        salesPartner: { select: { id: true, agentCode: true, userId: true, user: { select: { name: true, email: true } } } },
        payoutItem: { select: { payoutId: true } },
      },
    }),
  ]);
  res.json({
    total,
    page,
    pageSize,
    commissions: commissions.map((row: any) => ({
      ...row,
      grossAmount: number(row.grossAmount),
      eligibleNetRevenue: number(row.eligibleNetRevenue),
      commissionRate: number(row.commissionRate),
      commissionAmount: number(row.commissionAmount),
    })),
  });
}));

router.post("/commissions/:id/approve", limitSalesAdminWrite, requireAdminFinanceGrant, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idSchema.safeParse(req.params);
  const parsed = actionSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const now = new Date();
  const result = await db.$transaction(async (tx: any) => {
    const current = await tx.salesCommission.findUnique({
      where: { id },
      include: { salesPartner: { select: { userId: true } }, property: { select: { title: true } } },
    });
    if (!current) throw new FinanceNotFoundError("Commission not found");
    if (!canApproveCommission(current.status)) throw new FinanceConflictError("Only an ELIGIBLE commission can be approved");
    const changed = await tx.salesCommission.updateMany({
      where: { id, status: "ELIGIBLE", payoutItem: null },
      data: { status: "AVAILABLE", approvedAt: now, approvedById: req.user!.id, availableAt: now },
    });
    if (changed.count !== 1) throw new FinanceConflictError("Commission was changed or locked by another request");
    await tx.auditLog.create({
      data: auditData(req, "SALES_COMMISSION_APPROVE", "SALES_COMMISSION", id,
        { status: current.status },
        { status: "AVAILABLE", approvedAt: now, reason: parsed.data!.reason }),
    });
    return current;
  });
  await notifyUser(result.salesPartner.userId, "sales_partner_commission_available", {
    amount: number(result.commissionAmount),
    currency: result.currency,
    propertyName: result.property?.title,
  }).catch(() => {});
  res.json({ ok: true, commission: { id, status: "AVAILABLE", availableAt: now } });
}));

router.post("/commissions/:id/reverse", limitSalesAdminWrite, requireAdminFinanceGrant, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idSchema.safeParse(req.params);
  const parsed = actionSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const now = new Date();
  const result = await db.$transaction(async (tx: any) => {
    const current = await tx.salesCommission.findUnique({
      where: { id },
      include: {
        payoutItem: { include: { payout: { select: { status: true } } } },
        salesPartner: { select: { userId: true } },
      },
    });
    if (!current) throw new FinanceNotFoundError("Commission not found");
    const lockedPayoutStatus = current.payoutItem?.payout.status || null;
    if (!canReverseCommission(current.status, lockedPayoutStatus)) {
      if (["REVERSED", "CANCELLED"].includes(current.status)) throw new FinanceConflictError("Commission is already reversed or cancelled");
      throw new FinanceConflictError("Commission is locked in an active payout request");
    }
    const changed = await tx.salesCommission.updateMany({
      where: {
        id,
        status: current.status,
        ...(current.status === "PAID" ? {} : { payoutItem: null }),
      },
      data: { status: "REVERSED", reversedAt: now, reversalReason: parsed.data!.reason },
    });
    if (changed.count !== 1) throw new FinanceConflictError("Commission was changed by another request");
    let adjustmentId: number | null = null;
    if (current.status === "PAID") {
      const adjustment = await tx.salesCommission.create({
        data: {
          salesPartnerId: current.salesPartnerId,
          propertyId: current.propertyId,
          attributionId: current.attributionId,
          contractId: current.contractId,
          type: "MANUAL_ADJUSTMENT",
          status: "AVAILABLE",
          sourceKey: `ADJUSTMENT:REVERSAL-${current.id}`,
          grossAmount: 0,
          taxAmount: 0,
          processingFeeAmount: 0,
          refundAmount: 0,
          discountAmount: 0,
          eligibleNetRevenue: -Math.abs(number(current.eligibleNetRevenue)),
          commissionRate: current.commissionRate,
          commissionAmount: -Math.abs(number(current.commissionAmount)),
          currency: current.currency,
          description: `Reversal offset for paid commission #${current.id}`,
          earnedAt: now,
          eligibleAt: now,
          approvedAt: now,
          approvedById: req.user!.id,
          availableAt: now,
          reversalOfId: current.id,
          adjustmentReason: parsed.data!.reason,
        },
      });
      adjustmentId = adjustment.id;
    }
    await tx.auditLog.create({
      data: auditData(req, "SALES_COMMISSION_REVERSE", "SALES_COMMISSION", id,
        { status: current.status, commissionAmount: current.commissionAmount },
        { status: "REVERSED", reversedAt: now, adjustmentId, reason: parsed.data!.reason }),
    });
    return { current, adjustmentId };
  });
  await notifyUser(result.current.salesPartner.userId, "sales_partner_commission_reversed", {
    amount: number(result.current.commissionAmount),
    currency: result.current.currency,
    reason: parsed.data!.reason,
  }).catch(() => {});
  res.json({ ok: true, commission: { id, status: "REVERSED", reversedAt: now }, adjustmentId: result.adjustmentId });
}));

router.post("/commissions/adjustments", limitSalesAdminWrite, requireAdminFinanceGrant, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = adjustmentSchema.safeParse(req.body);
  if (invalid(res, parsed)) return;
  const input = parsed.data!;
  const now = new Date();
  const adjustment = await db.$transaction(async (tx: any) => {
    const partner = await tx.salesPartnerProfile.findUnique({
      where: { id: input.salesPartnerId },
      select: {
        id: true,
        status: true,
        contracts: {
          where: { status: { in: ["ACTIVE", "EXPIRING"] }, startsAt: { lte: now }, expiresAt: { gt: now } },
          orderBy: { expiresAt: "desc" },
          take: 1,
          select: { id: true },
        },
      },
    });
    if (!partner) throw new FinanceNotFoundError("Sales partner not found");
    if (partner.status !== "ACTIVE" || !partner.contracts[0]) throw new FinanceConflictError("Partner has no active earning contract");
    if (input.propertyId) {
      const attributed = await tx.propertySalesAttribution.findFirst({
        where: { propertyId: input.propertyId, salesPartnerId: partner.id },
        select: { id: true },
      });
      if (!attributed) throw new FinanceConflictError("Property is not attributed to this partner");
    }
    const created = await tx.salesCommission.create({
      data: {
        salesPartnerId: partner.id,
        propertyId: input.propertyId || null,
        contractId: partner.contracts[0].id,
        type: "MANUAL_ADJUSTMENT",
        status: "AVAILABLE",
        sourceKey: `ADJUSTMENT:${crypto.randomUUID()}`,
        grossAmount: 0,
        taxAmount: 0,
        processingFeeAmount: 0,
        refundAmount: 0,
        discountAmount: 0,
        eligibleNetRevenue: input.amount,
        commissionRate: 0,
        commissionAmount: input.amount,
        currency: input.currency,
        description: input.reason,
        earnedAt: now,
        eligibleAt: now,
        approvedAt: now,
        approvedById: req.user!.id,
        availableAt: now,
        adjustmentReason: input.reason,
      },
    });
    await tx.auditLog.create({
      data: auditData(req, "SALES_COMMISSION_ADJUSTMENT", "SALES_COMMISSION", created.id, null, {
        salesPartnerId: partner.id,
        propertyId: input.propertyId || null,
        amount: input.amount,
        currency: input.currency,
        reason: input.reason,
      }),
    });
    return created;
  });
  res.status(201).json({ commission: { id: adjustment.id, status: adjustment.status, amount: number(adjustment.commissionAmount) } });
}));

router.get("/payouts", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = payoutListSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const { page, pageSize, status, q } = parsed.data!;
  const where: any = { ...(status ? { status } : {}) };
  if (q) {
    where.OR = [
      { referenceNumber: { contains: q } },
      { salesPartner: { is: { agentCode: { contains: q } } } },
      { salesPartner: { is: { user: { is: { name: { contains: q } } } } } },
    ];
  }
  const [total, payouts] = await Promise.all([
    db.salesPayoutRequest.count({ where }),
    db.salesPayoutRequest.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        salesPartner: { select: { id: true, agentCode: true, userId: true, user: { select: { name: true, email: true } } } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  res.json({ total, page, pageSize, payouts: payouts.map(publicPayout) });
}));

router.post("/payouts/:id/approve", limitSalesAdminWrite, requireAdminFinanceGrant, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idSchema.safeParse(req.params);
  const parsed = approvePayoutSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const input = parsed.data!;
  const now = new Date();
  const payout = await db.$transaction(async (tx: any) => {
    const current = await tx.salesPayoutRequest.findUnique({
      where: { id },
      include: { items: true, salesPartner: { select: { userId: true } } },
    });
    if (!current) throw new FinanceNotFoundError("Payout request not found");
    if (!canTransitionSalesPayout(current.status, "APPROVED")) throw new FinanceConflictError("Payout cannot be approved in its current state");
    if (!current.items.length) throw new FinanceConflictError("Payout has no locked earnings");
    let amounts;
    try {
      amounts = calculateSalesPayoutApproval(number(current.requestedAmount), input.deductionAmount);
    } catch {
      throw new FinanceConflictError("Deduction must be less than the requested amount");
    }
    const { approvedAmount, netPaidAmount } = amounts;
    const changed = await tx.salesPayoutRequest.updateMany({
      where: { id, status: { in: ["REQUESTED", "UNDER_REVIEW"] } },
      data: {
        status: "APPROVED",
        reviewedAt: now,
        approvedAt: now,
        reviewedById: req.user!.id,
        approvedAmount,
        deductionAmount: input.deductionAmount,
        netPaidAmount,
        adminNotes: input.reason,
      },
    });
    if (changed.count !== 1) throw new FinanceConflictError("Payout was changed by another administrator");
    await tx.auditLog.create({ data: auditData(req, "SALES_PAYOUT_APPROVE", "SALES_PAYOUT_REQUEST", id,
      { status: current.status, requestedAmount: current.requestedAmount },
      { status: "APPROVED", approvedAmount, deductionAmount: input.deductionAmount, netPaidAmount, reason: input.reason }) });
    return { ...current, approvedAmount, deductionAmount: input.deductionAmount, netPaidAmount };
  });
  await notifyUser(payout.salesPartner.userId, "sales_partner_payout_approved", {
    referenceNumber: payout.referenceNumber,
    amount: payout.netPaidAmount,
    currency: payout.currency,
  }).catch(() => {});
  res.json({ ok: true, payout: { id, status: "APPROVED", netPaidAmount: payout.netPaidAmount } });
}));

router.post("/payouts/:id/reject", limitSalesAdminWrite, requireAdminFinanceGrant, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idSchema.safeParse(req.params);
  const parsed = actionSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const now = new Date();
  const payout = await db.$transaction(async (tx: any) => {
    const current = await tx.salesPayoutRequest.findUnique({
      where: { id },
      include: { items: { select: { commissionId: true } }, salesPartner: { select: { userId: true } } },
    });
    if (!current) throw new FinanceNotFoundError("Payout request not found");
    if (!canTransitionSalesPayout(current.status, "REJECTED")) throw new FinanceConflictError("Payout cannot be rejected in its current state");
    const changed = await tx.salesPayoutRequest.updateMany({
      where: { id, status: { in: ["REQUESTED", "UNDER_REVIEW"] } },
      data: { status: "REJECTED", reviewedAt: now, rejectedAt: now, reviewedById: req.user!.id, rejectionReason: parsed.data!.reason },
    });
    if (changed.count !== 1) throw new FinanceConflictError("Payout was changed by another administrator");
    await tx.salesPayoutItem.deleteMany({ where: { payoutId: id } });
    await tx.auditLog.create({ data: auditData(req, "SALES_PAYOUT_REJECT", "SALES_PAYOUT_REQUEST", id,
      { status: current.status, commissionIds: current.items.map((item: any) => item.commissionId) },
      { status: "REJECTED", reason: parsed.data!.reason }) });
    return current;
  });
  await notifyUser(payout.salesPartner.userId, "sales_partner_payout_rejected", {
    referenceNumber: payout.referenceNumber,
    reason: parsed.data!.reason,
  }).catch(() => {});
  res.json({ ok: true, payout: { id, status: "REJECTED" } });
}));

// POST /payouts/:id/processing and /payouts/:id/paid (the manual arm) were
// retired — sales partner payouts are now paid exclusively through the
// AzamPay Disbursement ledger (services/payouts/ledger.ts), reached once a
// payout request is APPROVED. See admin.disbursements.ts. The write-back in
// ledger.ts sets SalesPayoutRequest.status = "PAID" and the linked
// SalesCommission rows to "PAID" once AzamPay confirms.

const financeErrorHandler: ErrorRequestHandler = (error: any, _req, res, next) => {
  if (error instanceof FinanceNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof FinanceConflictError || error?.code === "P2002") {
    res.status(409).json({ error: error instanceof FinanceConflictError ? error.message : "A conflicting finance record already exists" });
    return;
  }
  next(error);
};
router.use(financeErrorHandler);

export default router;

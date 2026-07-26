import crypto from "crypto";
import { Router, type ErrorRequestHandler, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitSalesAdminWrite, limitSalesPropertyRead } from "../middleware/rateLimit.js";
import {
  partnerIdFor,
  requireActivePartnerContract,
  requireWorkspaceAccess,
  type SalesAuthedRequest,
} from "../middleware/salesWorkspace.js";
import { MIN_PAYOUT_AMOUNT, PAYOUT_STATUSES, maskPayoutAccount } from "../lib/salesPartner.js";
import { notifyAdmins } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import { generateSalesPayoutReceiptPdf } from "../lib/salesPayoutReceipt.js";

const router = Router();
const db = prisma as any;

router.use(
  requireAuth as RequestHandler,
  requireWorkspaceAccess("SALES"),
  requireActivePartnerContract,
  blockImpersonated as RequestHandler,
);

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(PAYOUT_STATUSES).optional(),
});
const requestSchema = z.object({
  commissionIds: z.array(z.coerce.number().int().positive()).min(1).max(500).optional(),
}).strict();
const cancelSchema = z.object({
  reason: z.string().trim().min(5).max(300).transform(sanitizeText),
}).strict();

class PayoutConflictError extends Error {}

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

function referenceNumber(partnerId: number) {
  return `SP-${new Date().getUTCFullYear()}-${partnerId}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
}

function number(value: unknown) {
  return Number(value || 0);
}

function publicPayout(row: any) {
  return {
    ...row,
    requestedAmount: number(row.requestedAmount),
    approvedAmount: row.approvedAmount == null ? null : number(row.approvedAmount),
    deductionAmount: number(row.deductionAmount),
    netPaidAmount: row.netPaidAmount == null ? null : number(row.netPaidAmount),
    payoutAccount: maskPayoutAccount(row.payoutAccount),
    items: row.items?.map((item: any) => ({
      ...item,
      amount: number(item.amount),
      commission: item.commission ? {
        ...item.commission,
        commissionAmount: number(item.commission.commissionAmount),
      } : undefined,
    })),
  };
}

/** GET /api/sales/payouts */
router.get("/payouts", limitSalesPropertyRead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const { page, pageSize, status } = parsed.data!;
  const where = { salesPartnerId: scopedPartnerId, ...(status ? { status } : {}) };
  const [total, payouts] = await Promise.all([
    db.salesPayoutRequest.count({ where }),
    db.salesPayoutRequest.findMany({
      where,
      orderBy: { requestedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        referenceNumber: true,
        requestedAmount: true,
        approvedAmount: true,
        deductionAmount: true,
        netPaidAmount: true,
        currency: true,
        status: true,
        payoutMethod: true,
        payoutName: true,
        payoutAccount: true,
        requestedAt: true,
        reviewedAt: true,
        approvedAt: true,
        processedAt: true,
        paidAt: true,
        rejectedAt: true,
        cancelledAt: true,
        rejectionReason: true,
        paymentReference: true,
        receiptUrl: true,
        _count: { select: { items: true } },
      },
    }),
  ]);
  res.json({ total, page, pageSize, payouts: payouts.map(publicPayout) });
}));

/** POST /api/sales/payouts */
router.post("/payouts", limitSalesAdminWrite, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = requestSchema.safeParse(req.body || {});
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const inputIds = parsed.data!.commissionIds;
  const result = await db.$transaction(async (tx: any) => {
    const profile = await tx.salesPartnerProfile.findUnique({
      where: { id: scopedPartnerId },
      select: {
        id: true,
        status: true,
        payoutMethod: true,
        payoutName: true,
        payoutAccount: true,
      },
    });
    if (!profile || profile.status !== "ACTIVE") throw new PayoutConflictError("Sales partner is not active");
    if (!profile.payoutMethod || !profile.payoutName || !profile.payoutAccount) {
      throw new PayoutConflictError("Complete your payout destination before requesting withdrawal");
    }
    const commissions = await tx.salesCommission.findMany({
      where: {
        salesPartnerId: scopedPartnerId,
        status: "AVAILABLE",
        payoutItem: null,
        ...(inputIds ? { id: { in: [...new Set(inputIds)] } } : {}),
      },
      orderBy: [{ availableAt: "asc" }, { id: "asc" }],
      take: 500,
      select: { id: true, commissionAmount: true, currency: true },
    });
    if (!commissions.length) throw new PayoutConflictError("No available earnings can be withdrawn");
    if (inputIds && commissions.length !== new Set(inputIds).size) {
      throw new PayoutConflictError("One or more selected earnings are unavailable or already locked");
    }
    const currencies = [...new Set(commissions.map((item: any) => item.currency))];
    if (currencies.length !== 1) throw new PayoutConflictError("Create separate payouts for each currency");
    const requestedAmount = commissions.reduce((sum: number, item: any) => sum + number(item.commissionAmount), 0);
    if (requestedAmount <= 0) {
      throw new PayoutConflictError("Available credits must exceed recovery adjustments before withdrawal");
    }
    if (currencies[0] === "TZS" && requestedAmount < MIN_PAYOUT_AMOUNT) {
      throw new PayoutConflictError(`Minimum withdrawal is TSh ${MIN_PAYOUT_AMOUNT.toLocaleString("en-US")}`);
    }
    const payout = await tx.salesPayoutRequest.create({
      data: {
        salesPartnerId: scopedPartnerId,
        referenceNumber: referenceNumber(scopedPartnerId),
        requestedAmount,
        currency: currencies[0],
        status: "REQUESTED",
        payoutMethod: profile.payoutMethod,
        payoutName: profile.payoutName,
        payoutAccount: profile.payoutAccount,
      },
      select: { id: true, referenceNumber: true, requestedAmount: true, currency: true, status: true, requestedAt: true },
    });
    await tx.salesPayoutItem.createMany({
      data: commissions.map((item: any) => ({
        payoutId: payout.id,
        commissionId: item.id,
        amount: item.commissionAmount,
      })),
    });
    await tx.auditLog.create({
      data: {
        actorId: req.user!.id,
        actorRole: req.user!.role || "USER",
        action: "SALES_PAYOUT_REQUEST",
        entity: "SALES_PAYOUT_REQUEST",
        entityId: payout.id,
        beforeJson: null,
        afterJson: {
          referenceNumber: payout.referenceNumber,
          requestedAmount,
          currency: currencies[0],
          commissionIds: commissions.map((item: any) => item.id),
          payoutMethod: profile.payoutMethod,
          payoutAccountLast4: maskPayoutAccount(profile.payoutAccount),
        },
      },
    });
    return { payout, itemCount: commissions.length };
  }).catch((error: any) => {
    if (error instanceof PayoutConflictError) throw error;
    if (error?.code === "P2002") throw new PayoutConflictError("An earning was claimed by another payout; reload and try again");
    throw error;
  });
  await notifyAdmins("sales_partner_payout_requested", {
    payoutId: result.payout.id,
    referenceNumber: result.payout.referenceNumber,
    amount: number(result.payout.requestedAmount),
    currency: result.payout.currency,
  });
  res.status(201).json({ payout: publicPayout(result.payout), itemCount: result.itemCount });
}));

/** GET /api/sales/payouts/:id */
router.get("/payouts/:id", limitSalesPropertyRead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = idSchema.safeParse(req.params);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const payout = await db.salesPayoutRequest.findFirst({
    where: { id: parsed.data!.id, salesPartnerId: scopedPartnerId },
    include: {
      items: {
        orderBy: { id: "asc" },
        include: {
          commission: {
            select: {
              id: true,
              type: true,
              status: true,
              commissionAmount: true,
              earnedAt: true,
              property: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  });
  if (!payout) return res.status(404).json({ error: "Payout request not found" });
  res.json({ payout: publicPayout(payout) });
}));

/** GET /api/sales/payouts/:id/receipt */
router.get("/payouts/:id/receipt", limitSalesPropertyRead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = idSchema.safeParse(req.params);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const payout = await db.salesPayoutRequest.findFirst({
    where: {
      id: parsed.data!.id,
      salesPartnerId: scopedPartnerId,
      status: "PAID",
      paidAt: { not: null },
      paymentReference: { not: null },
    },
    include: {
      salesPartner: {
        select: {
          agentCode: true,
          user: { select: { name: true } },
        },
      },
      _count: { select: { items: true } },
    },
  });
  if (!payout) return res.status(404).json({ error: "Paid payout receipt not found" });
  const pdf = await generateSalesPayoutReceiptPdf({
    referenceNumber: payout.referenceNumber,
    agentCode: payout.salesPartner.agentCode,
    partnerName: payout.salesPartner.user.name || payout.payoutName,
    requestedAmount: payout.requestedAmount,
    approvedAmount: payout.approvedAmount,
    deductionAmount: payout.deductionAmount,
    netPaidAmount: payout.netPaidAmount,
    currency: payout.currency,
    payoutMethod: payout.payoutMethod,
    payoutAccountMasked: maskPayoutAccount(payout.payoutAccount) || "unknown",
    paymentReference: payout.paymentReference,
    paidAt: payout.paidAt,
    itemCount: payout._count.items,
  });
  const safeReference = payout.referenceNumber.replace(/[^A-Za-z0-9_-]/g, "_");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${safeReference}-receipt.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.end(pdf);
}));

/** POST /api/sales/payouts/:id/cancel */
router.post("/payouts/:id/cancel", limitSalesAdminWrite, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const params = idSchema.safeParse(req.params);
  const parsed = cancelSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const id = params.data!.id;
  const reason = parsed.data!.reason;
  const cancelled = await db.$transaction(async (tx: any) => {
    const payout = await tx.salesPayoutRequest.findFirst({
      where: { id, salesPartnerId: scopedPartnerId },
      include: { items: { select: { commissionId: true } } },
    });
    if (!payout) return null;
    if (payout.status !== "REQUESTED") throw new PayoutConflictError("Only an unreviewed payout request can be cancelled");
    const changed = await tx.salesPayoutRequest.updateMany({
      where: { id, salesPartnerId: scopedPartnerId, status: "REQUESTED" },
      data: { status: "CANCELLED", cancelledAt: new Date(), adminNotes: reason },
    });
    if (changed.count !== 1) throw new PayoutConflictError("Payout request was changed by an administrator");
    // Release unique commission locks. The payout amount and audit row retain
    // cancellation evidence while the earnings become claimable again.
    await tx.salesPayoutItem.deleteMany({ where: { payoutId: id } });
    await tx.auditLog.create({
      data: {
        actorId: req.user!.id,
        actorRole: req.user!.role || "USER",
        action: "SALES_PAYOUT_CANCEL",
        entity: "SALES_PAYOUT_REQUEST",
        entityId: id,
        beforeJson: { status: payout.status, commissionIds: payout.items.map((item: any) => item.commissionId) },
        afterJson: { status: "CANCELLED", reason },
      },
    });
    return true;
  });
  if (!cancelled) return res.status(404).json({ error: "Payout request not found" });
  res.json({ ok: true, payout: { id, status: "CANCELLED" } });
}));

const payoutErrorHandler: ErrorRequestHandler = (error: any, _req, res, next) => {
  if (error instanceof PayoutConflictError) {
    res.status(409).json({ error: error.message });
    return;
  }
  next(error);
};
router.use(payoutErrorHandler);

export default router;

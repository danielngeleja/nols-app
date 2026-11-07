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
import { PAYOUT_STATUSES, maskPayoutAccount } from "../lib/salesPartner.js";
import { sanitizeText } from "../lib/sanitize.js";
import QRCode from "qrcode";
import { generateSalesPayoutReceiptPdf } from "../lib/pdfDocuments.js";
import {
  buildSalesPayoutReceiptSnapshot,
  buildSalesPayoutReceiptVerificationUrl,
  signSalesPayoutReceipt,
} from "../lib/salesPayoutReceiptSeal.js";
import {
  SalesWithdrawalError,
  confirmSalesWithdrawal,
  salesWithdrawalStatus,
  startSalesWithdrawal,
} from "../services/payouts/salesWithdrawal.js";

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

function number(value: unknown) {
  return Number(value || 0);
}

function publicPayout(input: any) {
  // Which withdrawal rules fired, and handoff internals, are for finance only.
  const { reviewFlags: _flags, handoffError: _error, handoffAttempts: _attempts, challengeId: _challenge, payoutAccountId: _account, ...row } = input;
  return {
    ...row,
    requestedAmount: number(row.requestedAmount),
    approvedAmount: row.approvedAmount == null ? null : number(row.approvedAmount),
    deductionAmount: number(row.deductionAmount),
    withholdingTaxRate: row.withholdingTaxRate == null ? null : number(row.withholdingTaxRate),
    withholdingTaxAmount: number(row.withholdingTaxAmount),
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
        withholdingTaxRate: true,
        withholdingTaxAmount: true,
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
        // AUTO or REVIEW only. The rules a withdrawal broke stay with finance.
        lane: true,
        _count: { select: { items: true } },
      },
    }),
  ]);
  res.json({ total, page, pageSize, payouts: payouts.map(publicPayout) });
}));

const confirmSchema = z.object({
  challengeRef: z.string().trim().min(10).max(40),
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code"),
}).strict();

function sendWithdrawalError(res: Response, error: unknown): boolean {
  if (!(error instanceof SalesWithdrawalError)) return false;
  res.status(error.httpStatus).json({ error: error.message, code: error.code, ...error.extra });
  return true;
}

/** GET /api/sales/payouts/withdrawal: what the Withdraw panel shows. */
router.get("/payouts/withdrawal", limitSalesPropertyRead, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  try {
    res.json(await salesWithdrawalStatus(scopedPartnerId));
  } catch (error) {
    if (!sendWithdrawalError(res, error)) throw error;
  }
}));

/** POST /api/sales/payouts/withdrawal/code: sends a one-time code bound to this withdrawal. */
router.post("/payouts/withdrawal/code", limitSalesAdminWrite, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  try {
    res.status(201).json(await startSalesWithdrawal(scopedPartnerId));
  } catch (error) {
    if (!sendWithdrawalError(res, error)) throw error;
  }
}));

/** POST /api/sales/payouts/withdrawal/confirm: the code creates the payout and runs every rule. */
router.post("/payouts/withdrawal/confirm", limitSalesAdminWrite, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = confirmSchema.safeParse(req.body || {});
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  try {
    res.json(await confirmSalesWithdrawal(scopedPartnerId, parsed.data!.challengeRef, parsed.data!.code));
  } catch (error) {
    if (!sendWithdrawalError(res, error)) throw error;
  }
}));

/**
 * POST /api/sales/payouts (retired). Withdrawals are confirmed with a one-time
 * code and checked against every rule; a request without a code is refused.
 */
router.post("/payouts", limitSalesAdminWrite, asyncHandler(async (_req: SalesAuthedRequest, res: Response) => {
  res.status(409).json({ code: "USE_WITHDRAW", error: "Use Withdraw: withdrawals are now confirmed with a one-time code." });
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
          user: { select: { name: true, fullName: true } },
        },
      },
      _count: { select: { items: true } },
    },
  });
  if (!payout) return res.status(404).json({ error: "Paid payout receipt not found" });
  // The provider's own reference, as on owner payout receipts.
  const disbursement = await db.disbursement.findFirst({
    where: { sourceType: "SALES_PAYOUT", sourceId: payout.id, status: "PAID" },
    orderBy: { paidAt: "desc" },
    select: { fspReferenceId: true, pgReferenceId: true, externalReferenceId: true, bankName: true },
  });
  const snapshot = buildSalesPayoutReceiptSnapshot({
    referenceNumber: payout.referenceNumber,
    partnerName: payout.salesPartner.user.fullName || payout.salesPartner.user.name || payout.payoutName,
    agentCode: payout.salesPartner.agentCode,
    earningsCount: payout._count.items,
    approvedAmount: payout.approvedAmount,
    requestedAmount: payout.requestedAmount,
    deductionAmount: payout.deductionAmount,
    withholdingTaxRate: payout.withholdingTaxRate,
    withholdingTaxAmount: payout.withholdingTaxAmount,
    netPaidAmount: payout.netPaidAmount,
    currency: payout.currency,
    payoutMethod: payout.payoutMethod || disbursement?.bankName,
    payoutAccount: payout.payoutAccount,
    paymentReference: disbursement?.externalReferenceId || payout.paymentReference,
    providerReference: disbursement?.fspReferenceId || disbursement?.pgReferenceId || null,
    paidAt: payout.paidAt,
  });
  const verificationUrl = buildSalesPayoutReceiptVerificationUrl(signSalesPayoutReceipt(snapshot));
  const qrPng = await QRCode.toBuffer(verificationUrl, { type: "png", margin: 1, width: 256, errorCorrectionLevel: "M" });
  const pdf = await generateSalesPayoutReceiptPdf({ ...snapshot, paidAt: snapshot.settledAt, qrPng });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${snapshot.receiptNumber}.pdf"`);
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

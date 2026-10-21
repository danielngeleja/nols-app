/**
 * Owner Payouts — view own payout accounts and disbursement history
 *
 * Per docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md "Recommended NoLSAF code
 * structure": owner.payouts.ts is "request + view partner payout". The
 * owner can register a payout destination and request a disbursement for
 * their own eligible, already-approved invoices — admin approval and the
 * actual AzamPay submission remain a separate, deliberate step
 * (see admin.disbursements.ts), matching how Sales Partner payouts work.
 *
 * Payout destinations are added through the verified two-step account route;
 * this router only lists destinations and handles payout requests.
 */

import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitOwnerPayoutRead } from "../middleware/rateLimit.js";
import { requestDisbursement, PayoutStateError } from "../services/payouts/ledger.js";
import { PayoutIneligibleError } from "../services/payouts/eligibility.js";
import { ownerPayoutStage, payoutReleaseEnabled } from "../services/payouts/release.js";
import { confirmWithdrawal, startWithdrawal, WithdrawalError } from "../services/payouts/withdrawal.js";
import { openRecoveryTotal } from "../services/payouts/recovery.js";
import { loadPayoutSafeguards } from "../services/payouts/riskScoring.js";
import { customerBookingReference, ownerInvoiceReference } from "../lib/customerBookingReference.js";

export const router = Router();
router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, blockImpersonated as RequestHandler);

const requestSchema = z
  .object({
    invoiceId: z.coerce.number().int().positive(),
    payoutAccountId: z.coerce.number().int().positive(),
    remarks: z.string().trim().max(300).optional(),
  })
  .strict();

/** GET /owner/payouts/accounts — list this owner's payout destinations. */
router.get(
  "/accounts",
  limitOwnerPayoutRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const accounts = await prisma.payoutAccount.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: "desc" },
    });
    const { recentChangeHours } = await loadPayoutSafeguards();
    res.json({ ok: true, accounts, securityWaitingHours: recentChangeHours });
  })
);

/** Legacy write path cannot bypass name lookup, owner confirmation, or alerts. */
router.post(
  "/accounts",
  limitOwnerPayoutRead,
  (_req, res) => {
    res.status(410).json({
      ok: false,
      code: "PAYOUT_VERIFICATION_REQUIRED",
      error: "Verify the payout destination, confirm the account holder, then save it through /api/account/payouts.",
    });
  }
);

/** GET /owner/payouts — this owner's disbursement history. */
router.get(
  "/",
  limitOwnerPayoutRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const disbursements = await prisma.disbursement.findMany({
      where: { payoutAccount: { userId: req.user!.id } },
      include: { payoutAccount: { select: { provider: true, accountNumber: true, accountName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json({ ok: true, disbursements });
  })
);

const confirmWithdrawalSchema = z
  .object({
    challengeRef: z.string().trim().min(10).max(40),
    code: z.string().trim().regex(/^\d{6}$/),
  })
  .strict();

function sendWithdrawalError(res: Response, err: unknown): boolean {
  if (!(err instanceof WithdrawalError)) return false;
  res.status(err.httpStatus).json({ ok: false, code: err.code, error: err.message, ...err.extra });
  return true;
}

/**
 * POST /owner/payouts/withdraw/challenge — the owner tapped Withdraw.
 * Sends a code bound to every payout that is ready now and the live
 * destination. The code itself is never returned.
 */
router.post(
  "/withdraw/challenge",
  limitOwnerPayoutRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      res.json({ ok: true, ...(await startWithdrawal(req.user!.id)) });
    } catch (err) {
      if (!sendWithdrawalError(res, err)) throw err;
    }
  })
);

/** POST /owner/payouts/withdraw/confirm — the owner entered the code. */
router.post(
  "/withdraw/confirm",
  limitOwnerPayoutRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = confirmWithdrawalSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ ok: false, code: "INVALID_CODE", error: "Enter the 6-digit code." });
      return;
    }
    try {
      res.json({ ok: true, ...(await confirmWithdrawal(req.user!.id, body.data.challengeRef, body.data.code)) });
    } catch (err) {
      if (!sendWithdrawalError(res, err)) throw err;
    }
  })
);

/**
 * GET /owner/payouts/releases — the date lock on this owner's payouts:
 * what is unlocking (with the unlock time), available, on hold (with the
 * reason) or already released. Read only. Empty while the feature is off,
 * so the page works before migration 20261007090000 is applied.
 */
router.get(
  "/releases",
  limitOwnerPayoutRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    if (!payoutReleaseEnabled()) {
      res.json({ ok: true, enabled: false, releases: [] });
      return;
    }
    const rows = await prisma.payoutRelease.findMany({
      where: { ownerId: req.user!.id },
      orderBy: { releaseAt: "desc" },
      take: 200,
      include: {
        booking: { select: { checkIn: true, checkOut: true, guestName: true, property: { select: { title: true } } } },
        withdrawalJobs: { orderBy: { id: "desc" }, take: 1, select: { status: true } },
      },
    });
    const claims = await prisma.invoice.findMany({
      where: { id: { in: rows.map((r) => r.sourceId) }, ownerId: req.user!.id },
      select: { id: true, netPayable: true, status: true, paidAt: true },
    });
    const claimById = new Map<number, (typeof claims)[number]>(claims.map((c) => [c.id, c]));
    const recovered = await prisma.ownerPayoutRecoveryApplication.groupBy({
      by: ["invoiceId"],
      where: { invoiceId: { in: rows.map((r) => r.sourceId) } },
      _sum: { amount: true },
    });
    const recoveredByClaim = new Map(recovered.map((r) => [r.invoiceId, Number(r._sum.amount ?? 0)]));

    res.json({
      ok: true,
      enabled: true,
      // Still owed from earlier refunds or chargebacks; taken from the next withdrawal.
      recoveryDue: await openRecoveryTotal(req.user!.id),
      releases: rows.map((r) => {
        const claim = claimById.get(r.sourceId);
        return {
          bookingReference: customerBookingReference(r.bookingId),
          invoiceReference: ownerInvoiceReference(r.sourceId),
          propertyTitle: r.booking.property?.title ?? null,
          guestName: r.booking.guestName ?? null,
          checkIn: r.booking.checkIn,
          checkOut: r.booking.checkOut,
          amount: claim?.netPayable ?? null,
          recoveryDeducted: recoveredByClaim.get(r.sourceId) ?? 0,
          currency: "TZS",
          status: r.status,
          stage: ownerPayoutStage({ status: r.status, lane: r.lane, holdReason: r.holdReason, claimStatus: claim?.status ?? null, handoffStatus: r.withdrawalJobs[0]?.status ?? null }),
          rule: r.rule,
          releaseAt: r.releaseAt,
          availableAt: r.availableAt,
          reason: r.status === "WITHDRAWING" && (r.withdrawalJobs[0]?.status === "REVIEW_REQUIRED" || !r.withdrawalJobs[0])
            ? "Our payments team is checking this request" : r.holdReason,
          releasedAt: r.releasedAt,
          paidAt: claim?.paidAt ?? null,
        };
      }),
    });
  })
);

/**
 * POST /owner/payouts/request — request a disbursement for one of this
 * owner's own already-APPROVED invoices. Creates a REQUESTED Disbursement;
 * an admin still has to approve and submit it (see admin.disbursements.ts).
 */
router.post(
  "/request",
  limitOwnerPayoutRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = requestSchema.parse(req.body);

    const invoice = await prisma.invoice.findUnique({ where: { id: body.invoiceId }, select: { ownerId: true } });
    if (!invoice || invoice.ownerId !== req.user!.id) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const account = await prisma.payoutAccount.findUnique({ where: { id: body.payoutAccountId } });
    if (!account || account.userId !== req.user!.id) {
      return res.status(404).json({ error: "Payout account not found" });
    }

    try {
      const disbursement = await requestDisbursement({
        sourceType: "OWNER_INVOICE",
        sourceId: body.invoiceId,
        payoutAccountId: body.payoutAccountId,
        requestedById: req.user!.id,
        remarks: body.remarks,
      });
      return res.status(201).json({ ok: true, disbursement });
    } catch (err) {
      if (err instanceof PayoutIneligibleError || err instanceof PayoutStateError) {
        return res.status(409).json({ error: err.message });
      }
      throw err;
    }
  })
);

export default router;

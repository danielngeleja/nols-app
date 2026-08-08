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
 * Verification (AzamPay Name Lookup) will fail with a clear configuration
 * error until AZAMPAY_DISBURSE_PUBLIC_KEY and the checksum field contract
 * are set — see services/azampay/disbursement. That is expected pre-launch
 * behaviour, not a bug in this route.
 */

import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitOwnerPayoutRead } from "../middleware/rateLimit.js";
import { azamPayNameLookup } from "../services/azampay/disbursement/client.js";
import { AzamPayDisburseError } from "../services/azampay/disbursement/errors.js";
import { requestDisbursement, PayoutStateError } from "../services/payouts/ledger.js";
import { PayoutIneligibleError } from "../services/payouts/eligibility.js";

export const router = Router();
router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, blockImpersonated as RequestHandler);

const addAccountSchema = z
  .object({
    type: z.enum(["MOBILE_MONEY", "BANK"]),
    provider: z.string().trim().min(2).max(30),
    accountNumber: z.string().trim().min(4).max(40),
  })
  .strict();

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
    res.json({ ok: true, accounts });
  })
);

/**
 * POST /owner/payouts/accounts — register a payout destination. Attempts an
 * AzamPay Name Lookup immediately; the account is saved unverified either
 * way (verification cannot block onboarding while the provider contract is
 * still pending confirmation from AzamPay).
 */
router.post(
  "/accounts",
  limitOwnerPayoutRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = addAccountSchema.parse(req.body);

    let accountName = req.user!.name || `Owner #${req.user!.id}`;
    let isVerified = false;
    let verifiedAt: Date | null = null;
    let verificationWarning: string | null = null;

    try {
      const lookup = await azamPayNameLookup({ bankName: body.provider, accountNumber: body.accountNumber });
      accountName = lookup.name || accountName;
      isVerified = Boolean(lookup.status);
      verifiedAt = isVerified ? new Date() : null;
    } catch (err) {
      verificationWarning =
        err instanceof AzamPayDisburseError
          ? `AzamPay verification unavailable: ${err.providerMessage ?? err.message}`
          : err instanceof Error
            ? `AzamPay verification unavailable: ${err.message}`
            : "AzamPay verification unavailable";
    }

    const account = await prisma.payoutAccount.create({
      data: {
        userId: req.user!.id,
        type: body.type,
        provider: body.provider,
        accountNumber: body.accountNumber,
        accountName,
        isVerified,
        verifiedAt,
        // Provenance anchor for riskScoring.RECENT_ACCOUNT_CHANGE. Must be
        // set wherever a destination is created or edited, and nowhere else.
        destinationChangedAt: new Date(),
      },
    });

    res.status(201).json({ ok: true, account, verificationWarning });
  })
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

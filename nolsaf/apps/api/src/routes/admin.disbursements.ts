/**
 * Admin Disbursements — review, approve, submit to AzamPay, reconcile
 *
 * Money-moving actions (approve, submit, check-status since it can also
 * apply a PAID/FAILED transition) are gated behind requireAdminFinanceGrant
 * (OTP re-auth), the same separation-of-duties control already used for
 * Sales Partner payouts — see admin.sales.finance.ts. Read endpoints are
 * plain ADMIN + rate-limited.
 */

import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { limitDisbursementAdminRead, limitDisbursementAdminWrite } from "../middleware/rateLimit.js";
import { approveDisbursement, requestDisbursement, submitToAzamPay, PayoutStateError } from "../services/payouts/ledger.js";
import { PayoutIneligibleError } from "../services/payouts/eligibility.js";
import { checkDisbursementStatus } from "../services/payouts/reconciliation.js";
import { provisionPayoutAccountFromProfile, NoPayoutProfileError } from "../services/payouts/provisioning.js";
import { AzamPayDisburseError } from "../services/azampay/disbursement/errors.js";

export const router = Router();
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);

const idSchema = z.object({ id: z.coerce.number().int().positive() });

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().trim().max(20).optional(),
  sourceType: z.enum(["OWNER_INVOICE", "TOUR_BOOKING", "DRIVER_TRIP", "SALES_PAYOUT"]).optional(),
  q: z.string().trim().max(120).optional(),
});

/** Matches the frontend STALE_MINUTES and the reconciliation worker's threshold. */
const STALE_THRESHOLD_MINUTES = 30;

const createSchema = z
  .object({
    sourceType: z.enum(["OWNER_INVOICE", "TOUR_BOOKING", "DRIVER_TRIP", "SALES_PAYOUT"]),
    sourceId: z.coerce.number().int().positive(),
    payoutAccountId: z.coerce.number().int().positive(),
    remarks: z.string().trim().max(300).optional(),
  })
  .strict();

const provisionSchema = z
  .object({
    sourceType: z.enum(["OWNER_INVOICE", "TOUR_BOOKING", "DRIVER_TRIP", "SALES_PAYOUT"]),
    sourceId: z.coerce.number().int().positive(),
  })
  .strict();

function handlePayoutServiceError(err: unknown, res: Response) {
  if (err instanceof PayoutIneligibleError || err instanceof PayoutStateError || err instanceof NoPayoutProfileError) {
    return res.status(409).json({ error: err.message });
  }
  if (err instanceof AzamPayDisburseError) {
    return res.status(502).json({
      error: err.providerMessage ?? err.message,
      retryClass: err.retryClass,
      httpStatus: err.httpStatus,
    });
  }
  throw err;
}

/**
 * POST /admin/disbursements/payout-accounts/provision — reads the payee's
 * existing User.payout profile details and creates + verifies a
 * PayoutAccount from them, so the request form below has an ID to submit.
 * Does not move money — a normal admin write action, not finance-grant
 * gated.
 */
router.post(
  "/payout-accounts/provision",
  limitDisbursementAdminWrite,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = provisionSchema.parse(req.body);
    try {
      const result = await provisionPayoutAccountFromProfile(body.sourceType, body.sourceId);
      res.status(result.reused ? 200 : 201).json({ ok: true, ...result });
    } catch (err) {
      handlePayoutServiceError(err, res);
    }
  })
);

/** GET /admin/disbursements — list, filterable by status and source flow, free-text searchable. */
router.get(
  "/",
  limitDisbursementAdminRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const query = listSchema.parse(req.query);

    // Free-text search across the columns the operator can actually see on a
    // row: our own reference, AzamPay's reference, and the payout account.
    // MySQL doesn't support `mode: "insensitive"`; its default collations are
    // case-insensitive, so plain `contains` already matches either case.
    const search = query.q
      ? {
          OR: [
            { externalReferenceId: { contains: query.q } },
            { pgReferenceId: { contains: query.q } },
            { payoutAccount: { is: { accountName: { contains: query.q } } } },
            { payoutAccount: { is: { accountNumber: { contains: query.q } } } },
          ],
        }
      : {};

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceType ? { sourceType: query.sourceType } : {}),
      ...search,
    };

    // Operations tiles are a queue-health overview, so they span every page and
    // ignore the status/search filters — they only follow the sourceType scope.
    const scope = query.sourceType ? { sourceType: query.sourceType } : {};
    const staleCutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000);

    const [total, disbursements, stuck, failed] = await Promise.all([
      prisma.disbursement.count({ where }),
      prisma.disbursement.findMany({
        where,
        include: { payoutAccount: { select: { id: true, provider: true, accountNumber: true, accountName: true, userId: true } } },
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.disbursement.count({
        where: { ...scope, status: { in: ["SUBMITTED", "PROCESSING"] }, submittedAt: { lt: staleCutoff } },
      }),
      prisma.disbursement.count({ where: { ...scope, status: "FAILED" } }),
    ]);

    res.json({ ok: true, total, page: query.page, pageSize: query.pageSize, disbursements, stats: { stuck, failed } });
  })
);

/** GET /admin/disbursements/:id — detail, including the event audit trail. */
router.get(
  "/:id",
  limitDisbursementAdminRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = idSchema.parse(req.params);
    const disbursement = await prisma.disbursement.findUnique({
      where: { id },
      include: {
        payoutAccount: true,
        approvedBy: { select: { id: true, name: true, email: true } },
        events: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!disbursement) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true, disbursement });
  })
);

/** POST /admin/disbursements — create a REQUESTED disbursement for any eligible source. */
router.post(
  "/",
  limitDisbursementAdminWrite,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const body = createSchema.parse(req.body);
    try {
      const disbursement = await requestDisbursement({ ...body, requestedById: req.user!.id });
      res.status(201).json({ ok: true, disbursement });
    } catch (err) {
      handlePayoutServiceError(err, res);
    }
  })
);

/** POST /admin/disbursements/:id/approve — REQUESTED -> APPROVED. Requires finance re-auth. */
router.post(
  "/:id/approve",
  limitDisbursementAdminWrite,
  requireAdminFinanceGrant,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = idSchema.parse(req.params);
    try {
      const disbursement = await approveDisbursement(id, req.user!.id);
      res.json({ ok: true, disbursement });
    } catch (err) {
      handlePayoutServiceError(err, res);
    }
  })
);

/** POST /admin/disbursements/:id/submit — APPROVED -> SUBMITTED/PROCESSING via AzamPay. Requires finance re-auth. */
router.post(
  "/:id/submit",
  limitDisbursementAdminWrite,
  requireAdminFinanceGrant,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = idSchema.parse(req.params);
    try {
      const disbursement = await submitToAzamPay(id);
      res.json({ ok: true, disbursement });
    } catch (err) {
      handlePayoutServiceError(err, res);
    }
  })
);

/** POST /admin/disbursements/:id/check-status — manual reconciliation trigger. Requires finance re-auth (can apply PAID/FAILED). */
router.post(
  "/:id/check-status",
  limitDisbursementAdminWrite,
  requireAdminFinanceGrant,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = idSchema.parse(req.params);
    try {
      const disbursement = await checkDisbursementStatus(id);
      res.json({ ok: true, disbursement });
    } catch (err) {
      handlePayoutServiceError(err, res);
    }
  })
);

export default router;

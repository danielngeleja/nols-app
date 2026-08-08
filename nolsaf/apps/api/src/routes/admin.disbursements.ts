/**
 * Admin Disbursements — review, approve, batch, authorize, reconcile
 *
 * REQUESTED -> APPROVED -> BATCHED -> AUTHORIZED -> PROCESSING -> PAID/FAILED,
 * with a SECURITY_REVIEW off-ramp at batch formation and authorize time. See
 * services/payouts/batching.ts for the batch security architecture and
 * docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md.
 *
 * There is no per-item "send to AzamPay". ledger.submitToAzamPay accepts only
 * AUTHORIZED, so the sole route to money leaving NoLSAF is a batch that a
 * second admin released. /:id/submit is a retry of an already-authorized item
 * whose submission never reached AzamPay; it cannot be used to skip batching.
 *
 * Separation of duties, enforced end to end:
 *   - approve requires a finance grant (OTP re-auth)
 *   - the batch authorizer may not have formed the batch or approved any
 *     member (services/payouts/batching.ts)
 *   - clearing a SECURITY_REVIEW hold may not be done by the admin who
 *     approved that payout
 * A finance grant proves the session is live; it does not make one admin
 * sufficient. Read endpoints and batch formation (grouping only, no money
 * movement) are plain ADMIN + rate-limited.
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
import { formBatch, authorizeBatch, describeSelfRelease, BatchStateError, SeparationOfDutiesError } from "../services/payouts/batching.js";
import {
  consumeBatchReleaseChallenge,
  issueBatchReleaseChallenge,
  twoPersonReleaseRequired,
  ReleaseChallengeError,
} from "../services/payouts/releaseChallenge.js";

/**
 * Payout destinations are shown truncated in list views. The queue is a
 * whole-population view of every partner's account number, and its free-text
 * search matches on that column, so returning them in full turned the list
 * into an enumeration oracle for any ADMIN. The unmasked number stays
 * available on the single-item detail view, where access is one record at a
 * time and attributable.
 */
function maskAccountNumber(accountNumber: string): string {
  const value = String(accountNumber ?? "");
  if (value.length <= 4) return "•".repeat(value.length);
  return `${"•".repeat(Math.min(value.length - 4, 8))}${value.slice(-4)}`;
}

/**
 * Every money-touching admin action here leaves a trace. Approve, batch
 * formation and batch authorization already wrote AuditLog rows from the
 * service layer; submit-retry, check-status and security-review clear did
 * not, which meant the one action that re-admits a flagged payout into the
 * pipeline left no record of who did it. Best effort: auditing must not fail
 * the action it is recording.
 */
async function writeAdminAudit(
  req: AuthedRequest,
  action: string,
  disbursementId: number,
  afterJson?: Record<string, unknown>
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: req.user?.id ?? null,
        actorRole: "ADMIN",
        action,
        entity: "DISBURSEMENT",
        entityId: disbursementId,
        afterJson: (afterJson ?? null) as any,
      },
    });
  } catch {
    // Never block the underlying action on an audit write.
  }
}

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
  // 403, not 409: this is an authorization refusal about who the actor is,
  // not a state conflict the actor can resolve by retrying.
  if (err instanceof SeparationOfDutiesError) {
    return res.status(403).json({ error: err.message, separationOfDuties: true });
  }
  if (err instanceof PayoutIneligibleError || err instanceof PayoutStateError || err instanceof NoPayoutProfileError || err instanceof BatchStateError) {
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

    const masked = disbursements.map((d) => ({
      ...d,
      payoutAccount: { ...d.payoutAccount, accountNumber: maskAccountNumber(d.payoutAccount.accountNumber) },
    }));

    res.json({ ok: true, total, page: query.page, pageSize: query.pageSize, disbursements: masked, stats: { stuck, failed } });
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

/**
 * POST /admin/disbursements/:id/submit — retry ONE authorized payout whose
 * submission never reached AzamPay. Requires finance re-auth.
 *
 * This used to accept APPROVED, which made the entire batch architecture
 * optional: approve then submit, performed by one admin, skipped bulk
 * re-verification, risk scoring, the batch fingerprint and the second
 * authorizer. It is now strictly a retry:
 *   - the item must be AUTHORIZED (so a batch someone else released), and
 *   - it must have no pgReferenceId (so AzamPay never accepted it).
 * An item that already has a pgReferenceId is in flight and must be resolved
 * with check-status, never re-sent.
 *
 * The batch worker retries these on its own; this endpoint exists for an
 * operator who does not want to wait for the next pass.
 */
router.post(
  "/:id/submit",
  limitDisbursementAdminWrite,
  requireAdminFinanceGrant,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = idSchema.parse(req.params);

    const current = await prisma.disbursement.findUnique({
      where: { id },
      select: { id: true, status: true, pgReferenceId: true },
    });
    if (!current) return res.status(404).json({ error: "Not found" });
    if (current.status !== "AUTHORIZED") {
      return res.status(409).json({
        error:
          `Disbursement ${id} is ${current.status}. Only an AUTHORIZED payout can be submitted, and only through a batch ` +
          `a second admin released. Form and authorize a batch instead.`,
      });
    }
    if (current.pgReferenceId) {
      return res.status(409).json({
        error: `Disbursement ${id} was already accepted by AzamPay (${current.pgReferenceId}). Use check-status to resolve it; re-sending would pay it twice.`,
      });
    }

    try {
      const disbursement = await submitToAzamPay(id);
      await writeAdminAudit(req, "DISBURSEMENT_SUBMIT_RETRIED", id, { previousStatus: current.status });
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
      await writeAdminAudit(req, "DISBURSEMENT_STATUS_CHECKED", id, { resultStatus: disbursement.status });
      res.json({ ok: true, disbursement });
    } catch (err) {
      handlePayoutServiceError(err, res);
    }
  })
);

/**
 * POST /admin/disbursements/batches — forms a new batch from every APPROVED,
 * unbatched disbursement: bulk re-verifies each payout account, re-checks
 * the approval fingerprint, and risk-scores it. Items that fail any check
 * are excluded and routed to SECURITY_REVIEW rather than blocking the rest.
 * No money moves here — this only groups and locks — so it is a normal
 * admin write, not finance-grant gated. See batching.ts.
 */
router.post(
  "/batches",
  limitDisbursementAdminWrite,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    try {
      const result = await formBatch(req.user!.id);
      res.status(result.batches.length ? 201 : 200).json({ ok: true, ...result });
    } catch (err) {
      handlePayoutServiceError(err, res);
    }
  })
);

/** GET /admin/disbursements/batches — list, newest first. */
router.get(
  "/batches",
  limitDisbursementAdminRead,
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    const batches = await prisma.disbursementBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        formedBy: { select: { id: true, name: true, email: true } },
        authorizedBy: { select: { id: true, name: true, email: true } },
        _count: { select: { items: true } },
      },
    });
    res.json({ ok: true, batches });
  })
);

/** GET /admin/disbursements/batches/:id — detail with every member disbursement. */
router.get(
  "/batches/:id",
  limitDisbursementAdminRead,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = idSchema.parse(req.params);
    const batch = await prisma.disbursementBatch.findUnique({
      where: { id },
      include: {
        formedBy: { select: { id: true, name: true, email: true } },
        authorizedBy: { select: { id: true, name: true, email: true } },
        items: { include: { payoutAccount: true }, orderBy: { id: "asc" } },
      },
    });
    if (!batch) return res.status(404).json({ error: "Not found" });

    // Tell the UI up front how this caller may release the batch, so it can
    // present the release-code step instead of discovering the requirement
    // through a 403 after the admin clicks Authorize.
    const self = describeSelfRelease(batch, req.user!.id);
    const release = {
      isSelfRelease: self.isSelfRelease,
      formedByActor: self.formedByActor,
      approvedByActorCount: self.approvedByActor.length,
      twoPersonRequired: twoPersonReleaseRequired(),
      challengeRequired: self.isSelfRelease && !twoPersonReleaseRequired(),
      blocked: self.isSelfRelease && twoPersonReleaseRequired(),
    };

    // Same reasoning as the queue list: this is many partners' destinations in
    // one response. Last four digits is enough for the authorizer to sanity
    // check a row against what the partner told them.
    res.json({
      ok: true,
      release,
      batch: {
        ...batch,
        items: batch.items.map((item) => ({
          ...item,
          payoutAccount: { ...item.payoutAccount, accountNumber: maskAccountNumber(item.payoutAccount.accountNumber) },
        })),
      },
    });
  })
);

/**
 * POST /admin/disbursements/batches/:id/authorize — the deliberate release
 * step. Requires finance re-auth. Recomputes the batch fingerprint against
 * the live payout accounts before authorizing; a mismatch freezes the batch
 * to SECURITY_REVIEW instead. Refused when the caller formed the batch or
 * approved any member (see batching.authorizeBatch).
 *
 * Authorization is the decision only. Submission is performed by
 * workers/processAuthorizedBatches.ts, which picks the batch up within a
 * minute. It used to run inline here, which meant a gateway timeout partway
 * through a batch stranded the remainder with no way back in.
 */
const authorizeSchema = z.object({ releaseCode: z.string().trim().regex(/^\d{6}$/).optional() }).strict();

/** Loads a DRAFT batch and works out whether this caller would be releasing their own work. */
async function loadDraftBatchForRelease(batchId: number, actorId: number) {
  const batch = await prisma.disbursementBatch.findUnique({
    where: { id: batchId },
    include: { items: { select: { id: true, approvedById: true } } },
  });
  if (!batch) return { batch: null as null, self: null as null };
  return { batch, self: describeSelfRelease(batch, actorId) };
}

/**
 * POST /admin/disbursements/batches/:id/release-challenge — sends a
 * single-use release code, bound to this batch, to the admin's registered
 * email or phone.
 *
 * Only needed for a self-release (the caller formed the batch or approved a
 * member). A different admin releasing someone else's batch is already the
 * stronger two-person path and needs no code.
 */
router.post(
  "/batches/:id/release-challenge",
  limitDisbursementAdminWrite,
  requireAdminFinanceGrant,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = idSchema.parse(req.params);
    const { batch, self } = await loadDraftBatchForRelease(id, req.user!.id);
    if (!batch) return res.status(404).json({ error: "Not found" });
    if (batch.status !== "DRAFT") {
      return res.status(409).json({ error: `Batch ${id} is ${batch.status}, expected DRAFT` });
    }
    if (!self!.isSelfRelease) {
      return res.status(409).json({
        error: "This batch was formed and approved by other admins, so you can authorize it directly without a release code.",
        challengeRequired: false,
      });
    }
    if (twoPersonReleaseRequired()) {
      return res.status(403).json({
        error: "Two-person release is required in this environment. A different admin must authorize this batch.",
        separationOfDuties: true,
      });
    }

    try {
      const issued = await issueBatchReleaseChallenge(
        req.user!.id,
        {
          id: batch.id,
          batchReference: batch.batchReference,
          itemCount: batch.itemCount,
          totalAmount: batch.totalAmount.toString(),
          currency: batch.currency,
        },
        batch.batchFingerprint
      );
      await writeAdminAudit(req, "DISBURSEMENT_BATCH_RELEASE_CHALLENGE_SENT", id, {
        sentVia: issued.sentVia,
        totalAmount: batch.totalAmount.toString(),
        currency: batch.currency,
        itemCount: batch.itemCount,
      });
      res.json({ ok: true, ...issued });
    } catch (err) {
      if (err instanceof ReleaseChallengeError) {
        return res.status(err.reason === "LOCKED" ? 429 : 409).json({ error: err.message, reason: err.reason });
      }
      throw err;
    }
  })
);

/**
 * POST /admin/disbursements/batches/:id/authorize — the deliberate release
 * step. Requires finance re-auth. Recomputes the batch fingerprint against
 * the live payout accounts before authorizing; a mismatch freezes the batch
 * to SECURITY_REVIEW instead.
 *
 * Release authority: a different admin needs nothing beyond the finance
 * grant. An admin releasing their own batch must additionally supply the
 * six-digit `releaseCode` sent by /release-challenge, which is single-use and
 * bound to this batch's id and fingerprint. See services/payouts/batching.ts
 * and services/payouts/releaseChallenge.ts for why the ambient finance grant
 * is not considered sufficient on its own for a self-release.
 *
 * Authorization is the decision only. Submission is performed by
 * workers/processAuthorizedBatches.ts, which picks the batch up within a
 * minute. It used to run inline here, which meant a gateway timeout partway
 * through a batch stranded the remainder with no way back in.
 */
router.post(
  "/batches/:id/authorize",
  limitDisbursementAdminWrite,
  requireAdminFinanceGrant,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = idSchema.parse(req.params);
    const body = authorizeSchema.parse(req.body ?? {});
    const { batch, self } = await loadDraftBatchForRelease(id, req.user!.id);
    if (!batch) return res.status(404).json({ error: "Not found" });

    let releaseChallengePassed = false;

    // Spend the code before authorizing. A code proves possession of the
    // second channel at this moment; it must be burned whether or not the
    // authorization that follows succeeds, so it cannot be reused after a
    // fingerprint mismatch or a state conflict.
    if (self!.isSelfRelease && batch.status === "DRAFT" && !twoPersonReleaseRequired()) {
      if (!body.releaseCode) {
        return res.status(403).json({
          error:
            "Releasing your own batch requires a release code sent to your registered email or phone. " +
            "Request one for this batch, then authorize again with the code.",
          separationOfDuties: true,
          challengeRequired: true,
        });
      }
      try {
        await consumeBatchReleaseChallenge(req.user!.id, id, batch.batchFingerprint, body.releaseCode);
        releaseChallengePassed = true;
      } catch (err) {
        if (err instanceof ReleaseChallengeError) {
          await writeAdminAudit(req, "DISBURSEMENT_BATCH_RELEASE_CHALLENGE_FAILED", id, { reason: err.reason });
          return res.status(err.reason === "LOCKED" ? 429 : 403).json({
            error: err.message,
            reason: err.reason,
            challengeRequired: true,
          });
        }
        throw err;
      }
    }

    try {
      const authorized = await authorizeBatch(id, req.user!.id, { releaseChallengePassed });
      res.json({
        ok: true,
        batch: authorized,
        queued: true,
        releaseAuthority: self!.isSelfRelease ? "SELF_RELEASE_WITH_CHALLENGE" : "TWO_PERSON",
        message: "Batch authorized. Submission to AzamPay runs in the background and starts within a minute.",
      });
    } catch (err) {
      handlePayoutServiceError(err, res);
    }
  })
);

/** GET /admin/disbursements/security-review — every disbursement currently flagged, most recent first. */
router.get(
  "/security-review",
  limitDisbursementAdminRead,
  asyncHandler(async (_req: AuthedRequest, res: Response) => {
    const disbursements = await prisma.disbursement.findMany({
      where: { status: "SECURITY_REVIEW" },
      include: { payoutAccount: true, approvedBy: { select: { id: true, name: true, email: true } } },
      orderBy: { updatedAt: "desc" },
    });
    res.json({
      ok: true,
      disbursements: disbursements.map((d) => ({
        ...d,
        payoutAccount: { ...d.payoutAccount, accountNumber: maskAccountNumber(d.payoutAccount.accountNumber) },
      })),
    });
  })
);

const clearSchema = z.object({ note: z.string().trim().min(10).max(300) }).strict();

/**
 * POST /admin/disbursements/:id/security-review/clear — an admin has
 * confirmed out of band that the flagged item is legitimate (e.g. phoned the
 * partner about the account change) and returns it to APPROVED, unbatched, so
 * the next batch formation can pick it up again.
 *
 * Requires finance re-auth AND a different admin than the one who approved
 * the payout. Without that, risk scoring was advisory only: the same
 * compromised session that pushed a payout through approval could clear its
 * own CRITICAL flag and send it on. A written note is mandatory and recorded,
 * because "why was this released" is the question this queue exists to answer.
 */
router.post(
  "/:id/security-review/clear",
  limitDisbursementAdminWrite,
  requireAdminFinanceGrant,
  asyncHandler(async (req: AuthedRequest, res: Response) => {
    const { id } = idSchema.parse(req.params);
    const body = clearSchema.parse(req.body);

    const current = await prisma.disbursement.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: "Not found" });
    if (current.status !== "SECURITY_REVIEW") {
      return res.status(409).json({ error: `Disbursement ${id} is ${current.status}, expected SECURITY_REVIEW` });
    }
    if (current.approvedById && current.approvedById === req.user!.id) {
      return res.status(403).json({
        error:
          `You approved disbursement ${id}. Clearing its security hold must be done by a different admin, ` +
          `so that one person cannot both push a payout through and dismiss the check that caught it.`,
        separationOfDuties: true,
      });
    }

    const heldReason = current.securityReviewReason;
    const cleared = await prisma.$transaction(async (tx) => {
      const updated = await tx.disbursement.update({
        where: { id },
        data: { status: "APPROVED", batchId: null, securityReviewReason: null },
      });
      // Append-only: the hold and its clearance both stay readable on the
      // detail view after securityReviewReason has been wiped from the row.
      await tx.disbursementEvent.create({
        data: {
          disbursementId: id,
          eventType: "SECURITY_REVIEW",
          eventHash: `src-${id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          status: "CLEARED",
          message: `Cleared by admin #${req.user!.id}: ${body.note}`.slice(0, 300),
        },
      });
      return updated;
    });

    await writeAdminAudit(req, "DISBURSEMENT_SECURITY_REVIEW_CLEARED", id, {
      heldReason,
      riskLevel: current.riskLevel,
      riskFlags: current.riskFlags,
      note: body.note,
      approvedById: current.approvedById,
    });

    res.json({ ok: true, disbursement: cleared });
  })
);

/**
 * GET /admin/disbursements/:id — detail, including the event audit trail.
 * MUST stay last among GETs: it is the single-segment catch-all, so the
 * literal routes (/batches, /security-review) have to be registered before
 * it or Express matches them here with id="batches" (NaN) instead.
 */
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

export default router;

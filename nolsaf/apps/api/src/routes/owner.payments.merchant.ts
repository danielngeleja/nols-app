/**
 * Owner-facing merchant onboarding.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * Security posture for this router, and why each control is here:
 *
 *   - `blockImpersonated` on every write. Onboarding establishes where an
 *     owner's money will be paid, which is exactly the class of action an
 *     admin support session must never perform on a user's behalf.
 *   - Tenant scoping through `loadOwnedActiveNrmsProperty` on every route, so
 *     the merchant is always reached via a property this owner demonstrably
 *     owns, never by an id supplied in the body.
 *   - Field allowlisting in the service layer, so no request shape can write
 *     `status`, `administeredById`, or any provider identifier.
 *   - The feature gate is checked inside the service, so a route that is
 *     mounted but not enabled answers the same way to everyone.
 *
 * Nothing here can activate a merchant. Activation requires a verified
 * provider result, and no endpoint in this file can produce one.
 */

import { Router, type Response, type RequestHandler } from "express";
import { z } from "zod";

import {
  blockImpersonated,
  requireAuth,
  requireRole,
  type AuthedRequest,
} from "../middleware/auth.js";
import { makePaymentRateLimiter } from "../lib/azampay.helpers.js";
import { loadOwnedActiveNrmsProperty, requireNrms } from "../lib/nrms.js";
import { prisma } from "@nolsaf/prisma";
import {
  acceptMerchantPolicy,
  detachPropertyFromMerchant,
  getMerchantOverview,
  matchOwnerWorkspaceTin,
  sanitizeOwnerDraft,
  submitMerchantApplication,
  subscribeMerchant,
  updateMerchantDraft,
  type OnboardingRefusal,
} from "../services/payments/onboarding.js";
import { loadMerchantPolicy } from "../services/payments/policy.js";

const router = Router();

router.use(
  requireAuth as RequestHandler,
  requireRole("OWNER") as RequestHandler,
  requireNrms as RequestHandler
);

/** Reads are cheap; writes touch onboarding state and are limited harder. */
const readLimiter = makePaymentRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  keyFn: (req: any) => `merchant-read:${req.user?.id || req.ip}`,
});

const writeLimiter = makePaymentRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 20,
  keyFn: (req: any) => `merchant-write:${req.user?.id || req.ip}`,
});

/**
 * Maps a service refusal onto a status code.
 *
 * Every message shown to the caller comes from the service, which keeps them
 * uniform and free of configuration detail.
 */
function refuse(res: Response, refusal: OnboardingRefusal) {
  const status =
    refusal.code === "orchestration_disabled" ||
    refusal.code === "production_not_authorized" ||
    refusal.code === "no_connection" ||
    refusal.code === "policy_not_configured" ||
    refusal.code === "policy_unreadable"
      ? 503
      : refusal.code === "not_subscribed"
        ? 404
        : refusal.code === "self_review_forbidden"
          ? 403
          : refusal.code === "incomplete_application"
            ? 400
            : 409;

  return res.status(status).json({ error: refusal.message, code: refusal.code });
}

function propertyIdOf(req: AuthedRequest): number {
  return Number(req.params.propertyId);
}

/**
 * Resolves the merchant for a property this owner owns.
 *
 * Ownership is proven by loading the property under the owner's tenant scope
 * first; the merchant is then reached through that property. A merchant id is
 * never accepted from the client.
 */
async function loadOwnedMerchantId(
  req: AuthedRequest,
  res: Response
): Promise<{ propertyId: number; merchantId: number } | null> {
  const propertyId = propertyIdOf(req);
  const owned = await loadOwnedActiveNrmsProperty(res, req.user!.id, propertyId);
  if (!owned) return null;

  const link = await (prisma as any).merchantPropertyLink.findFirst({
    where: { propertyId, outletId: null, effectiveTo: null },
    select: { merchantId: true },
  });
  if (!link) {
    res.status(404).json({ error: "This property is not subscribed.", code: "not_subscribed" });
    return null;
  }
  return { propertyId, merchantId: link.merchantId };
}

const OWNER_ACTION_STATES = new Set(["ACTION_REQUIRED", "ADMIN_REJECTED", "PROVIDER_ACTION_REQUIRED"]);

/**
 * One cheap portfolio poll for the Payments home and sidebar badge.
 *
 * This deliberately replaces one live-count request per property. A portfolio
 * with four properties previously consumed the entire five-minute read limit
 * through background polling alone (4 properties × 15 polls).
 */
router.get("/live-counts", readLimiter, (async (req: AuthedRequest, res: Response) => {
  const properties = await (prisma as any).property.findMany({
    where: {
      ownerId: req.user!.id,
      status: "APPROVED",
      nrmsActivatedAt: { not: null },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      merchantLinks: {
        where: { outletId: null, effectiveTo: null },
        take: 1,
        select: {
          merchant: {
            select: {
              applications: {
                orderBy: { version: "desc" },
                take: 1,
                select: { status: true },
              },
              providerAccounts: {
                orderBy: { updatedAt: "desc" },
                take: 1,
                select: { status: true },
              },
            },
          },
        },
      },
    },
  });

  const rows = (properties as Array<{
    id: number;
    merchantLinks: Array<{
      merchant?: {
        applications?: Array<{ status?: string | null }>;
        providerAccounts?: Array<{ status?: string | null }>;
      } | null;
    }>;
  }>).map((property) => {
    const status = property.merchantLinks[0]?.merchant?.applications?.[0]?.status ?? null;
    const providerStatus = property.merchantLinks[0]?.merchant?.providerAccounts?.[0]?.status ?? null;
    const actionRequired = (status && OWNER_ACTION_STATES.has(status)) || (providerStatus && OWNER_ACTION_STATES.has(providerStatus)) ? 1 : 0;
    return { propertyId: property.id, status, providerStatus, actionRequired, total: actionRequired };
  });

  return res.json({
    properties: rows,
    actionRequired: rows.reduce((sum, row) => sum + row.actionRequired, 0),
    total: rows.reduce((sum, row) => sum + row.total, 0),
  });
}) as RequestHandler);

/** Current onboarding state for one owned property. */
router.get("/:propertyId", readLimiter, (async (req: AuthedRequest, res: Response) => {
  const propertyId = propertyIdOf(req);
  const owned = await loadOwnedActiveNrmsProperty(res, req.user!.id, propertyId);
  if (!owned) return;

  const overview = await getMerchantOverview(prisma as any, {
    propertyId,
    ownerUserId: req.user!.id,
  });
  if (!overview.ok) return refuse(res, overview);
  return res.json(overview);
}) as RequestHandler);

/**
 * Go back to the company choice.
 *
 * Same posture as subscribe, because it is the same decision in reverse:
 * impersonation blocked, tenant scoped through the owned property, and the
 * service refuses once anything has been submitted for review.
 */
router.post(
  "/:propertyId/detach",
  writeLimiter,
  blockImpersonated as RequestHandler,
  (async (req: AuthedRequest, res: Response) => {
    const propertyId = propertyIdOf(req);
    const owned = await loadOwnedActiveNrmsProperty(res, req.user!.id, propertyId);
    if (!owned) return;

    const result = await detachPropertyFromMerchant(prisma as any, { propertyId });
    if (!result.ok) return refuse(res, result);
    return res.json({ merchantId: result.merchantId });
  }) as RequestHandler
);

/**
 * Sidebar badge poll for "Guest payments".
 *
 * Deliberately not the full overview: this is fetched every 20 seconds by the
 * workspace layout, so it selects one status column and nothing else. It
 * carries no merchant detail, no documents and no review note, so it stays
 * cheap and leaks nothing that the sidebar does not already imply.
 *
 * `actionRequired` counts only states the owner can actually clear. An
 * application sitting with NoLSAF or the provider is not the owner's move and
 * must not nag them.
 */
router.get("/:propertyId/live-count", readLimiter, (async (req: AuthedRequest, res: Response) => {
  const propertyId = propertyIdOf(req);
  const owned = await loadOwnedActiveNrmsProperty(res, req.user!.id, propertyId);
  if (!owned) return;

  const link = await (prisma as any).merchantPropertyLink.findFirst({
    where: { propertyId, effectiveTo: null },
    select: { merchantId: true },
  });
  if (!link) return res.json({ status: null, actionRequired: 0, total: 0 });

  const application = await (prisma as any).merchantApplication.findFirst({
    where: { merchantId: link.merchantId },
    orderBy: { version: "desc" },
    select: { status: true },
  });
  const status: string | null = application?.status ?? null;
  const actionRequired = status && OWNER_ACTION_STATES.has(status) ? 1 : 0;
  return res.json({ status, actionRequired, total: actionRequired });
}) as RequestHandler);

/**
 * The policy text the owner must read before accepting.
 *
 * Served from the server's own copy so the hash recorded on acceptance always
 * corresponds to content the server actually produced.
 */
router.get("/:propertyId/policy", readLimiter, (async (req: AuthedRequest, res: Response) => {
  const owned = await loadOwnedActiveNrmsProperty(res, req.user!.id, propertyIdOf(req));
  if (!owned) return;

  const policy = loadMerchantPolicy();
  if (!policy.ok) return res.status(503).json({ error: policy.message, code: policy.code });

  return res.json({
    policyId: policy.policy.policyId,
    policyVersion: policy.policy.policyVersion,
    content: policy.policy.content,
  });
}) as RequestHandler);

/**
 * Creates the local merchant shell, or joins one the owner already runs.
 *
 * `merchantId` is checked against the owner's own merchants in the service, so
 * a supplied id can only ever name a company this caller administers.
 */
const subscribeSchema = z
  .object({ merchantId: z.coerce.number().int().positive().optional() })
  .strict();

router.post(
  "/:propertyId/subscribe",
  writeLimiter,
  blockImpersonated as RequestHandler,
  (async (req: AuthedRequest, res: Response) => {
    const parsed = subscribeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Check the details you entered.", code: "invalid_body" });
    }

    const propertyId = propertyIdOf(req);
    const owned = await loadOwnedActiveNrmsProperty(res, req.user!.id, propertyId);
    if (!owned) return;

    const result = await subscribeMerchant(prisma as any, {
      ownerUserId: req.user!.id,
      propertyId,
      merchantId: parsed.data.merchantId ?? null,
    });
    if (!result.ok) return refuse(res, result);
    return res.status(201).json({
      merchantId: result.merchantId,
      applicationId: result.applicationId,
      reusedMerchant: result.reusedMerchant,
    });
  }) as RequestHandler
);

/**
 * Only these keys are accepted, and `.strict()` rejects anything else outright
 * rather than ignoring it, so an attempt to set `status` is a 400 the caller
 * can see rather than a silently dropped field.
 */
const draftSchema = z
  .object({
    legalName: z.string().trim().min(1).max(200).optional(),
    tradingName: z.string().trim().max(200).nullable().optional(),
    registrationNumber: z.string().trim().max(60).nullable().optional(),
    tin: z.string().trim().max(20).nullable().optional(),
    country: z.string().trim().length(2).optional(),
  })
  .strict();

const tinMatchSchema = z
  .object({ tin: z.string().trim().min(4).max(20) })
  .strict();

/**
 * Checks a Company TIN against this signed-in owner's own workspace record.
 * POST keeps the identifier out of the URL and the response never returns the
 * stored TIN.
 */
router.post(
  "/:propertyId/tin-match",
  writeLimiter,
  blockImpersonated as RequestHandler,
  (async (req: AuthedRequest, res: Response) => {
    const parsed = tinMatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Enter a valid Company TIN.", code: "invalid_body" });
    }

    const owned = await loadOwnedActiveNrmsProperty(res, req.user!.id, propertyIdOf(req));
    if (!owned) return;

    const result = await matchOwnerWorkspaceTin(
      prisma as any,
      { ownerUserId: req.user!.id, tin: parsed.data.tin },
    );
    if (!result.ok) return refuse(res, result);
    return res.json({ status: result.status });
  }) as RequestHandler,
);

router.put(
  "/:propertyId/draft",
  writeLimiter,
  blockImpersonated as RequestHandler,
  (async (req: AuthedRequest, res: Response) => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Check the details you entered.", code: "invalid_body" });
    }

    const scope = await loadOwnedMerchantId(req, res);
    if (!scope) return;

    const result = await updateMerchantDraft(prisma as any, {
      ownerUserId: req.user!.id,
      merchantId: scope.merchantId,
      draft: sanitizeOwnerDraft(parsed.data),
    });
    if (!result.ok) return refuse(res, result);
    return res.json({ applicationId: result.applicationId, version: result.version });
  }) as RequestHandler
);

const acceptanceSchema = z.object({ policyVersion: z.string().trim().min(1).max(20) }).strict();

router.post(
  "/:propertyId/policy-acceptance",
  writeLimiter,
  blockImpersonated as RequestHandler,
  (async (req: AuthedRequest, res: Response) => {
    const parsed = acceptanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Check the details you entered.", code: "invalid_body" });
    }

    const scope = await loadOwnedMerchantId(req, res);
    if (!scope) return;

    const result = await acceptMerchantPolicy(prisma as any, {
      ownerUserId: req.user!.id,
      merchantId: scope.merchantId,
      // The client states the version it displayed; the server decides whether
      // that is still current and supplies the hash itself.
      acceptedVersion: parsed.data.policyVersion,
      scopePropertyId: scope.propertyId,
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    if (!result.ok) return refuse(res, result);
    return res.status(201).json({ policyVersion: result.policyVersion });
  }) as RequestHandler
);

/** Freezes the application for administrator review. */
router.post(
  "/:propertyId/submit",
  writeLimiter,
  blockImpersonated as RequestHandler,
  (async (req: AuthedRequest, res: Response) => {
    const scope = await loadOwnedMerchantId(req, res);
    if (!scope) return;

    const result = await submitMerchantApplication(prisma as any, {
      ownerUserId: req.user!.id,
      merchantId: scope.merchantId,
    });
    if (!result.ok) return refuse(res, result);
    return res.json({ applicationId: result.applicationId, version: result.version });
  }) as RequestHandler
);

export default router;

/**
 * Administrator review of merchant onboarding applications.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * Security posture:
 *
 *   - `requireAdminFinanceGrant` on the decision endpoint. Approving an
 *     application is the step that lets an owner begin receiving money, so it
 *     is re-authenticated the same way every other money-moving admin action
 *     in this codebase is.
 *   - Separation of duties is enforced in the service: an administrator who
 *     also administers the merchant cannot decide on its application.
 *   - Approving reaches SUBMISSION_QUEUED and stops. No endpoint here can set
 *     a provider account ACTIVE; only a verified provider result can.
 *   - Responses carry status, decision history and the owner's own submitted
 *     values. They never carry document contents, storage keys or provider
 *     credentials.
 */

import { Router, type Response, type RequestHandler } from "express";
import { z } from "zod";

import { blockImpersonated, requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { makePaymentRateLimiter } from "../lib/azampay.helpers.js";
import { isTrustedUserDocumentUrl, sanitizeUserDocument } from "../lib/userDocumentSecurity.js";
import { prisma } from "@nolsaf/prisma";
import {
  applicationPayloadHash,
  CORRECTION_AREAS,
  decideMerchantApplication,
  linkedProperties,
  sanitizeDraft,
} from "../services/payments/onboarding.js";

const router = Router();

router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler);

const adminLimiter = makePaymentRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  keyFn: (req: any) => `merchant-admin:${req.user?.id || req.ip}`,
});

/** Statuses an administrator can filter the queue by. */
const LISTABLE_STATUSES = [
  "READY_FOR_ADMIN_REVIEW",
  "ACTION_REQUIRED",
  "ADMIN_REJECTED",
  "SUBMISSION_QUEUED",
  "SUBMITTED_TO_PROVIDER",
  "PROVIDER_REVIEW",
  "PROVIDER_ACTION_REQUIRED",
  "ACTIVE",
  "REJECTED",
] as const;

const listSchema = z
  .object({
    status: z.enum(LISTABLE_STATUSES).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

/** The review queue. Defaults to what is actually awaiting a decision. */
router.get("/applications", adminLimiter, (async (req: AuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid query", code: "invalid_query" });
  }
  const { status, page, pageSize } = parsed.data;

  const where = { status: status ?? "READY_FOR_ADMIN_REVIEW" };

  const [total, rows, grouped] = await Promise.all([
    (prisma as any).merchantApplication.count({ where }),
    (prisma as any).merchantApplication.findMany({
      where,
      orderBy: { submittedAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        version: true,
        status: true,
        submittedAt: true,
        reviewedAt: true,
        merchant: {
          select: {
            id: true,
            legalName: true,
            tradingName: true,
            country: true,
            administeredBy: { select: { id: true, name: true } },
            _count: { select: { propertyLinks: true } },
          },
        },
        connection: { select: { provider: true, environment: true } },
      },
    }),
    // Queue depth for every state, so the workload is visible without
    // clicking through each filter.
    (prisma as any).merchantApplication.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);

  const counts: Record<string, number> = {};
  for (const row of grouped as Array<{ status: string; _count: { _all: number } }>) {
    counts[row.status] = row._count._all;
  }

  const applications = (rows as any[]).map((row) => ({
    id: row.id,
    version: row.version,
    status: row.status,
    submittedAt: row.submittedAt,
    reviewedAt: row.reviewedAt,
    connection: row.connection,
    merchant: {
      id: row.merchant?.id ?? null,
      legalName: row.merchant?.legalName ?? null,
      tradingName: row.merchant?.tradingName ?? null,
      country: row.merchant?.country ?? null,
      // One approval can now cover several properties, so the reviewer sees
      // the blast radius before opening the application.
      propertyCount: row.merchant?._count?.propertyLinks ?? 0,
      owner: row.merchant?.administeredBy ?? null,
    },
  }));

  return res.json({ total, page, pageSize, counts, applications });
}) as RequestHandler);

/**
 * One application in full.
 *
 * `payloadHash` is returned so a reviewer can confirm the package they are
 * looking at is the one that was frozen at submission. Document metadata is
 * included without storage keys, so nothing here can be used to fetch a KYC
 * file directly.
 */
router.get("/applications/:applicationId", adminLimiter, (async (req: AuthedRequest, res: Response) => {
  const applicationId = Number(req.params.applicationId);
  if (!Number.isInteger(applicationId) || applicationId <= 0) {
    return res.status(400).json({ error: "Invalid application id", code: "invalid_id" });
  }

  const application = await (prisma as any).merchantApplication.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      version: true,
      status: true,
      payloadHash: true,
      frozenAt: true,
      submittedAt: true,
      reviewedAt: true,
      decisionReason: true,
      providerSubmissionRef: true,
      merchant: {
        select: {
          id: true,
          status: true,
          legalName: true,
          tradingName: true,
          registrationNumber: true,
          tin: true,
          country: true,
          contactEmail: true,
          contactPhone: true,
          administeredBy: {
            select: { id: true, name: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
          },
        },
      },
      connection: { select: { provider: true, environment: true } },
      documents: {
        select: {
          id: true,
          documentType: true,
          issuingCountry: true,
          expiresAt: true,
          verificationState: true,
          rejectionCode: true,
          // The live state of the owner's upload, so a reviewer can see that a
          // document approved in the Owner Workspace has since been replaced or
          // rejected. The storage location is never selected here; it is served
          // only by the audited endpoint below.
          userDocument: { select: { id: true, status: true, createdAt: true } },
        },
      },
    },
  });

  if (!application) {
    return res.status(404).json({ error: "Application not found", code: "not_found" });
  }

  const [policyAcceptance, auditTrail] = await Promise.all([
    (prisma as any).policyAcceptance.findFirst({
      where: { merchantId: application.merchant.id, supersededAt: null },
      select: { policyId: true, policyVersion: true, contentHash: true, acceptedAt: true },
    }),
    (prisma as any).merchantAuditEvent.findMany({
      where: { entityType: "APPLICATION", entityId: applicationId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        action: true,
        actorKind: true,
        actorUserId: true,
        previousState: true,
        nextState: true,
        reason: true,
        // Carries the areas flagged on a return, so the trail shows what was
        // actually asked for rather than only that a return happened.
        metadata: true,
        createdAt: true,
      },
    }),
  ]);

  const properties = await linkedProperties(prisma as any, application.merchant.id);

  /**
   * Tamper check.
   *
   * The hash frozen at submission is recomputed from the merchant row as it
   * stands now. A mismatch means the reviewed package and the stored record
   * have diverged, which must block approval rather than be discovered after
   * the provider has the data. Only ever a comparison of two digests; the
   * reviewer is shown both.
   */
  const computedHash = applicationPayloadHash(sanitizeDraft(application.merchant ?? {}));
  const integrity = {
    frozenHash: application.payloadHash ?? null,
    computedHash,
    matches: application.payloadHash ? application.payloadHash === computedHash : null,
  };

  return res.json({ application, policyAcceptance, auditTrail, properties, integrity });
}) as RequestHandler);

/**
 * The storage location of one attached KYC document.
 *
 * Served on its own rather than inside the application payload, so that opening
 * a document is a distinct, recorded act rather than a side effect of listing
 * the queue. Four things gate it:
 *
 *   - the document must be attached to the application named in the path, so an
 *     id cannot be swapped for someone else's upload;
 *   - it must belong to the owner who administers that merchant, which is a
 *     second, independent check on the same fact;
 *   - the stored URL is validated against the trusted owner-document locations
 *     before being returned, so a poisoned row cannot point a reviewer at an
 *     attacker's host;
 *   - the access is written to the audit trail with the reviewer's id.
 *
 * `blockImpersonated` because an admin support session acting as someone must
 * not be able to pull up a third party's identity documents.
 */
router.get(
  "/applications/:applicationId/documents/:documentId",
  adminLimiter,
  blockImpersonated as RequestHandler,
  (async (req: AuthedRequest, res: Response) => {
    const applicationId = Number(req.params.applicationId);
    const documentId = Number(req.params.documentId);
    if (!Number.isInteger(applicationId) || applicationId <= 0 || !Number.isInteger(documentId) || documentId <= 0) {
      return res.status(400).json({ error: "Invalid id", code: "invalid_id" });
    }

    const attached = await (prisma as any).merchantApplicationDocument.findFirst({
      where: { id: documentId, applicationId },
      select: {
        id: true,
        documentType: true,
        expiresAt: true,
        verificationState: true,
        application: { select: { id: true, merchant: { select: { id: true, administeredById: true } } } },
        userDocument: { select: { id: true, userId: true, type: true, status: true, url: true, createdAt: true } },
      },
    });

    if (!attached || !attached.userDocument) {
      return res.status(404).json({ error: "Document not found", code: "not_found" });
    }

    if (attached.userDocument.userId !== attached.application?.merchant?.administeredById) {
      return res.status(404).json({ error: "Document not found", code: "not_found" });
    }

    const sanitized = sanitizeUserDocument(attached.userDocument, "OWNER");

    // Recorded here, on the open, rather than on the byte stream below: a PDF
    // viewer issues several range requests for one document, and an audit trail
    // that logs each of them stops being readable.
    await (prisma as any).merchantAuditEvent.create({
      data: {
        entityType: "APPLICATION",
        entityId: applicationId,
        action: "DOCUMENT_VIEWED",
        actorKind: "USER",
        actorUserId: req.user!.id,
        reason: `${attached.documentType} (upload ${attached.userDocument.id})`,
      },
    });

    return res.json({
      id: attached.id,
      documentType: attached.documentType,
      verificationState: attached.verificationState,
      expiresAt: attached.expiresAt,
      uploadedAt: sanitized.createdAt,
      profileStatus: sanitized.status,
      // The storage location itself is never returned. The file is served by
      // the endpoint below, same origin, so the reviewer's browser never learns
      // where KYC documents live and the page's CSP needs no widening.
      hasFile: Boolean(sanitized.url),
      unsafeUrl: Boolean(sanitized.unsafeUrl),
      kind: documentKind(sanitized.url ?? null),
    });
  }) as RequestHandler
);

/** Content types a reviewer may be shown inline. */
const VIEWABLE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

function documentKind(rawUrl: string | null): "image" | "pdf" | "other" {
  const path = String(rawUrl ?? "").split("?")[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(path)) return "image";
  if (path.endsWith(".pdf")) return "pdf";
  return "other";
}

/**
 * Streams one attached KYC document through the API.
 *
 * Proxied rather than linked because it keeps three properties at once: the
 * storage location never reaches the browser, the response is same origin so it
 * renders under the existing `frame-src 'self'` policy without loosening it,
 * and every fetch passes the same ownership checks as the metadata endpoint.
 *
 * The upstream URL is re-validated against the trusted document hosts on every
 * request, and redirects are refused rather than followed, so a poisoned row
 * cannot turn this into a request forgery primitive pointed at internal hosts.
 */
router.get(
  "/applications/:applicationId/documents/:documentId/file",
  adminLimiter,
  blockImpersonated as RequestHandler,
  (async (req: AuthedRequest, res: Response) => {
    const applicationId = Number(req.params.applicationId);
    const documentId = Number(req.params.documentId);
    if (!Number.isInteger(applicationId) || applicationId <= 0 || !Number.isInteger(documentId) || documentId <= 0) {
      return res.status(400).json({ error: "Invalid id", code: "invalid_id" });
    }

    const attached = await (prisma as any).merchantApplicationDocument.findFirst({
      where: { id: documentId, applicationId },
      select: {
        documentType: true,
        application: { select: { merchant: { select: { administeredById: true } } } },
        userDocument: { select: { userId: true, url: true } },
      },
    });

    const rawUrl = attached?.userDocument?.url ?? null;
    if (
      !attached ||
      !attached.userDocument ||
      attached.userDocument.userId !== attached.application?.merchant?.administeredById ||
      !rawUrl ||
      !isTrustedUserDocumentUrl(rawUrl, "OWNER")
    ) {
      return res.status(404).json({ error: "Document not found", code: "not_found" });
    }

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(rawUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return res.status(502).json({ error: "The document store did not respond.", code: "upstream_failed" });
    }

    if (upstream.status >= 300 && upstream.status < 400) {
      return res.status(502).json({ error: "The document store redirected the request.", code: "upstream_redirect" });
    }
    if (!upstream.ok) {
      return res.status(502).json({ error: "The document could not be retrieved.", code: "upstream_failed" });
    }

    const contentType = String(upstream.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!VIEWABLE_TYPES.has(contentType)) {
      return res.status(415).json({ error: "This file type cannot be shown here.", code: "unsupported_type" });
    }

    const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_DOCUMENT_BYTES) {
      return res.status(413).json({ error: "This document is too large to preview.", code: "too_large" });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > MAX_DOCUMENT_BYTES) {
      return res.status(413).json({ error: "This document is too large to preview.", code: "too_large" });
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buffer.byteLength));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    // KYC material must not sit in a shared cache or on disk.
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("Referrer-Policy", "no-referrer");
    return res.end(buffer);
  }) as RequestHandler
);

const decisionSchema = z
  .object({
    decision: z.enum(["RETURN", "REJECT", "APPROVE"]),
    // Required for every decision, including approval: a decision with no
    // recorded reason is not auditable.
    reason: z.string().trim().min(3).max(300),
    // Which sections the owner must correct. Ignored for APPROVE and REJECT,
    // where there is nothing for the owner to go back and fix.
    correctionAreas: z.array(z.enum(CORRECTION_AREAS)).max(CORRECTION_AREAS.length).optional(),
  })
  .strict()
  .refine((value) => value.decision !== "RETURN" || (value.correctionAreas?.length ?? 0) > 0, {
    path: ["correctionAreas"],
    message: "Select at least one area that needs correction.",
  });

router.post(
  "/applications/:applicationId/decision",
  adminLimiter,
  blockImpersonated as RequestHandler,
  requireAdminFinanceGrant as RequestHandler,
  (async (req: AuthedRequest, res: Response) => {
    const applicationId = Number(req.params.applicationId);
    if (!Number.isInteger(applicationId) || applicationId <= 0) {
      return res.status(400).json({ error: "Invalid application id", code: "invalid_id" });
    }

    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return res.status(400).json({
        error: issue?.path?.[0] === "correctionAreas" ? issue.message : "A decision and a reason are required.",
        code: "invalid_body",
      });
    }

    const result = await decideMerchantApplication(prisma as any, {
      applicationId,
      adminUserId: req.user!.id,
      decision: parsed.data.decision,
      reason: parsed.data.reason,
      correctionAreas: parsed.data.correctionAreas,
    });

    if (!result.ok) {
      const status =
        result.code === "self_review_forbidden"
          ? 403
          : result.code === "not_decidable" || result.code === "package_altered"
            ? 409
            : 503;
      return res.status(status).json({ error: result.message, code: result.code });
    }

    return res.json({ status: result.status });
  }) as RequestHandler
);

export default router;

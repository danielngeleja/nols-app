// Sales administration: conversion review and the attribution earning boundary.
//
// Conversion approval creates VERIFIED rows only. Starting, stopping or moving
// future commission eligibility is a separate finance-OTP-protected action.
// The unique (propertyId, productType) index remains the final concurrency
// backstop against two partners owning the same product attribution.
import { Router, type ErrorRequestHandler, type NextFunction, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { limitSalesAdminRead, limitSalesAdminWrite } from "../middleware/rateLimit.js";
import { notifyUser } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import {
  attributionCommissionStart,
  canActivateAttribution,
  canReassignAttribution,
  canRevokeAttribution,
  currentAttributionContract,
  requestedAttributionProducts,
} from "../lib/salesAttribution.js";
import {
  ATTRIBUTION_STATUSES,
  CONTRACT_EARNING_STATUSES,
  PRODUCT_TYPES,
} from "../lib/salesPartner.js";

const router = Router();
const db = prisma as any;

router.use(
  requireAuth as RequestHandler,
  requireRole("ADMIN") as RequestHandler,
  blockImpersonated as RequestHandler,
);

const reason = z.string().trim().min(5).max(300).transform(sanitizeText);
const idParams = z.object({ id: z.coerce.number().int().positive() });
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(120).optional(),
  product: z.enum(["NRMS", "MARKETPLACE", "NRMS_AND_MARKETPLACE"]).optional(),
  duplicate: z.enum(["ALL", "FLAGGED", "CLEAR"]).default("ALL"),
});
const propertySearchSchema = z.object({
  q: z.string().trim().min(2).max(120),
});
const approveSchema = z.object({
  propertyId: z.coerce.number().int().positive(),
  reason,
  duplicateDecision: z.enum(["CLEAR", "MATCH"]).optional(),
}).strict();
const rejectSchema = z.object({
  reason,
  returnStatus: z.enum([
    "NEW",
    "CONTACTED",
    "MEETING_SCHEDULED",
    "PROPOSAL_SENT",
    "DOCUMENTS_PENDING",
    "TRIAL_STARTED",
  ]).default("DOCUMENTS_PENDING"),
  duplicateDecision: z.enum(["CLEAR", "MATCH"]).optional(),
}).strict();
const attributionListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(ATTRIBUTION_STATUSES).optional(),
  product: z.enum(PRODUCT_TYPES).optional(),
  q: z.string().trim().max(120).optional(),
});
const actionSchema = z.object({ reason }).strict();
const reassignSchema = z.object({
  salesPartnerId: z.coerce.number().int().positive(),
  leadId: z.coerce.number().int().positive().nullable().optional(),
  reason,
}).strict();

class AttributionConflictError extends Error {}
class AttributionNotFoundError extends Error {}

function invalid(res: Response, parsed: { success: boolean; error?: any }): boolean {
  if (parsed.success) return false;
  res.status(400).json({ error: parsed.error?.issues?.[0]?.message || "Invalid request" });
  return true;
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

function activeContractWhere(now: Date) {
  return {
    status: { in: CONTRACT_EARNING_STATUSES },
    startsAt: { lte: now },
    expiresAt: { gt: now },
  };
}

function isUniqueConflict(error: any): boolean {
  return error?.code === "P2002" || String(error?.message || "").includes("Unique constraint");
}

/** GET /api/admin/sales/leads/conversion-requests */
router.get("/leads/conversion-requests", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const { page, pageSize, q, product, duplicate } = parsed.data!;
  const where: any = { status: "CONVERSION_REQUESTED", conversionRequestedAt: { not: null } };
  if (product) where.proposedProduct = product;
  if (duplicate === "FLAGGED") where.duplicateReviewStatus = "POSSIBLE_DUPLICATE";
  if (duplicate === "CLEAR") where.duplicateReviewStatus = { not: "POSSIBLE_DUPLICATE" };
  if (q) {
    where.OR = [
      { propertyName: { contains: q } },
      { contactPerson: { contains: q } },
      { contactPhone: { contains: q } },
      { contactEmail: { contains: q } },
      { salesPartner: { is: { agentCode: { contains: q } } } },
    ];
  }

  const [total, leads] = await Promise.all([
    db.salesLead.count({ where }),
    db.salesLead.findMany({
      where,
      orderBy: [{ conversionRequestedAt: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        propertyName: true,
        contactPerson: true,
        contactPhone: true,
        contactEmail: true,
        location: true,
        region: true,
        district: true,
        ward: true,
        propertyType: true,
        estimatedRooms: true,
        registrationNumber: true,
        taxNumber: true,
        proposedProduct: true,
        duplicateReviewStatus: true,
        duplicateEvidence: true,
        protectionExpiresAt: true,
        conversionRequestedAt: true,
        createdAt: true,
        salesPartner: {
          select: {
            id: true,
            agentCode: true,
            status: true,
            region: true,
            user: { select: { id: true, name: true, email: true } },
          },
        },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, type: true, description: true, createdAt: true },
        },
      },
    }),
  ]);
  res.json({ total, page, pageSize, leads });
}));

/** Narrow existing-property lookup used while binding a conversion. */
router.get("/properties/search", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = propertySearchSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const q = parsed.data!.q;
  const numericId = Number(q);
  const properties = await db.property.findMany({
    where: {
      OR: [
        ...(Number.isInteger(numericId) && numericId > 0 ? [{ id: numericId }] : []),
        { title: { contains: q } },
        { city: { contains: q } },
        { regionName: { contains: q } },
        { owner: { is: { email: { contains: q } } } },
      ],
    },
    orderBy: { id: "desc" },
    take: 20,
    select: {
      id: true,
      title: true,
      status: true,
      type: true,
      city: true,
      regionName: true,
      owner: { select: { id: true, name: true, email: true } },
      salesAttributions: {
        select: {
          id: true,
          productType: true,
          status: true,
          salesPartner: { select: { id: true, agentCode: true } },
        },
      },
    },
  });
  res.json({ properties });
}));

/** POST /api/admin/sales/leads/:id/approve-conversion */
router.post("/leads/:id/approve-conversion", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = approveSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const input = parsed.data!;
  const now = new Date();

  try {
    const result = await db.$transaction(async (tx: any) => {
      const lead = await tx.salesLead.findUnique({
        where: { id },
        select: {
          id: true,
          salesPartnerId: true,
          propertyName: true,
          proposedProduct: true,
          status: true,
          duplicateReviewStatus: true,
          salesPartner: {
            select: {
              id: true,
              userId: true,
              agentCode: true,
              status: true,
              contracts: {
                where: activeContractWhere(now),
                orderBy: { expiresAt: "desc" },
                take: 1,
                select: { id: true, status: true, startsAt: true, expiresAt: true },
              },
            },
          },
        },
      });
      if (!lead) throw new AttributionNotFoundError("Lead not found");
      if (lead.status !== "CONVERSION_REQUESTED") {
        throw new AttributionConflictError("Only a pending conversion request can be approved");
      }
      if (lead.salesPartner.status !== "ACTIVE") {
        throw new AttributionConflictError("The sales partner is not active");
      }
      const contract = currentAttributionContract(lead.salesPartner.contracts, now);
      if (!contract) throw new AttributionConflictError("The sales partner has no active earning contract");
      if (lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" && !input.duplicateDecision) {
        throw new AttributionConflictError("Resolve the duplicate warning before approving conversion");
      }

      const property = await tx.property.findUnique({
        where: { id: input.propertyId },
        select: { id: true, title: true, status: true },
      });
      if (!property) throw new AttributionNotFoundError("Property not found");
      const products = requestedAttributionProducts(lead.proposedProduct);
      const existing = await tx.propertySalesAttribution.findMany({
        where: { propertyId: property.id, productType: { in: products } },
        select: {
          id: true,
          productType: true,
          status: true,
          salesPartnerId: true,
          salesPartner: { select: { agentCode: true } },
        },
      });
      if (existing.length) {
        const labels = existing.map((item: any) => `${item.productType} (${item.salesPartner.agentCode}, ${item.status})`);
        throw new AttributionConflictError(
          `Property attribution already exists for ${labels.join(", ")}. Use the explicit reassignment workflow.`,
        );
      }

      const attributions: any[] = [];
      for (const productType of products) {
        attributions.push(await tx.propertySalesAttribution.create({
          data: {
            propertyId: property.id,
            salesPartnerId: lead.salesPartnerId,
            leadId: lead.id,
            contractId: contract.id,
            productType,
            status: "VERIFIED",
            verifiedAt: now,
            verifiedById: req.user!.id,
            notes: input.reason,
          },
          select: {
            id: true,
            propertyId: true,
            salesPartnerId: true,
            productType: true,
            status: true,
            verifiedAt: true,
          },
        }));
      }
      const updated = await tx.salesLead.updateMany({
        where: { id: lead.id, status: "CONVERSION_REQUESTED" },
        data: {
          status: "CONVERTED",
          convertedPropertyId: property.id,
          convertedAt: now,
          convertedById: req.user!.id,
          duplicateReviewStatus:
            input.duplicateDecision === "MATCH"
              ? "REVIEWED_MATCH"
              : input.duplicateDecision === "CLEAR"
                ? "REVIEWED_CLEAR"
                : lead.duplicateReviewStatus,
        },
      });
      if (updated.count !== 1) throw new AttributionConflictError("Conversion request was changed by another administrator");
      await tx.salesLeadActivity.create({
        data: {
          leadId: lead.id,
          createdById: req.user!.id,
          type: "ADMIN_COMMENT",
          description: `Conversion verified and bound to property #${property.id}. ${input.reason}`,
        },
      });
      await tx.auditLog.create({
        data: auditData(req, "SALES_LEAD_CONVERSION_APPROVE", "SALES_LEAD", lead.id,
          { status: lead.status, duplicateReviewStatus: lead.duplicateReviewStatus },
          {
            status: "CONVERTED",
            propertyId: property.id,
            attributionIds: attributions.map((item: any) => item.id),
            products,
            reason: input.reason,
          }),
      });
      return { lead, property, contract, attributions };
    });

    await notifyUser(result.lead.salesPartner.userId, "sales_partner_attribution_verified", {
      propertyName: result.property.title,
      productType: result.attributions.map((item: any) => item.productType).join(" and "),
    }).catch(() => {});
    return res.status(201).json({
      ok: true,
      lead: { id, status: "CONVERTED", convertedPropertyId: result.property.id },
      property: result.property,
      attributions: result.attributions,
      nextAction: "ACTIVATE_ATTRIBUTIONS",
    });
  } catch (error: any) {
    if (error instanceof AttributionNotFoundError) return res.status(404).json({ error: error.message });
    if (error instanceof AttributionConflictError || isUniqueConflict(error)) {
      return res.status(409).json({
        error: error instanceof AttributionConflictError
          ? error.message
          : "Another request claimed this property product first; reload before reviewing",
      });
    }
    throw error;
  }
}));

/** POST /api/admin/sales/leads/:id/reject-conversion */
router.post("/leads/:id/reject-conversion", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = rejectSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const input = parsed.data!;
  const result = await db.$transaction(async (tx: any) => {
    const lead = await tx.salesLead.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        duplicateReviewStatus: true,
        salesPartner: { select: { userId: true } },
      },
    });
    if (!lead) throw new AttributionNotFoundError("Lead not found");
    if (lead.status !== "CONVERSION_REQUESTED") {
      throw new AttributionConflictError("Only a pending conversion request can be returned");
    }
    if (lead.duplicateReviewStatus === "POSSIBLE_DUPLICATE" && !input.duplicateDecision) {
      throw new AttributionConflictError("Resolve the duplicate warning before returning conversion");
    }
    const updated = await tx.salesLead.updateMany({
      where: { id, status: "CONVERSION_REQUESTED" },
      data: {
        status: input.returnStatus,
        conversionRequestedAt: null,
        duplicateReviewStatus:
          input.duplicateDecision === "MATCH"
            ? "REVIEWED_MATCH"
            : input.duplicateDecision === "CLEAR"
              ? "REVIEWED_CLEAR"
              : lead.duplicateReviewStatus,
      },
    });
    if (updated.count !== 1) throw new AttributionConflictError("Conversion request was changed by another administrator");
    await tx.salesLeadActivity.create({
      data: {
        leadId: id,
        createdById: req.user!.id,
        type: "ADMIN_COMMENT",
        description: `Conversion returned to ${input.returnStatus}. ${input.reason}`,
      },
    });
    await tx.auditLog.create({
      data: auditData(req, "SALES_LEAD_CONVERSION_REJECT", "SALES_LEAD", id,
        { status: lead.status, duplicateReviewStatus: lead.duplicateReviewStatus },
        { status: input.returnStatus, reason: input.reason, duplicateDecision: input.duplicateDecision || null }),
    });
    return lead;
  }).catch((error: any) => {
    if (error instanceof AttributionNotFoundError || error instanceof AttributionConflictError) throw error;
    throw error;
  });
  await notifyUser(result.salesPartner.userId, "sales_partner_conversion_returned", {
    reason: input.reason,
    status: input.returnStatus,
  }).catch(() => {});
  return res.json({ ok: true, lead: { id, status: input.returnStatus } });
}));

/** GET /api/admin/sales/attributions */
router.get("/attributions", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = attributionListSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const { page, pageSize, status, product, q } = parsed.data!;
  const where: any = {};
  if (status) where.status = status;
  if (product) where.productType = product;
  if (q) {
    where.OR = [
      { property: { is: { title: { contains: q } } } },
      { salesPartner: { is: { agentCode: { contains: q } } } },
      { salesPartner: { is: { user: { is: { name: { contains: q } } } } } },
    ];
  }
  const [total, attributions] = await Promise.all([
    db.propertySalesAttribution.count({ where }),
    db.propertySalesAttribution.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        productType: true,
        status: true,
        attributedAt: true,
        verifiedAt: true,
        commissionStartsAt: true,
        commissionEndsAt: true,
        reassignedAt: true,
        revokedAt: true,
        property: { select: { id: true, title: true, status: true } },
        salesPartner: {
          select: { id: true, agentCode: true, status: true, user: { select: { name: true, email: true } } },
        },
        contract: { select: { id: true, contractNumber: true, status: true, expiresAt: true } },
      },
    }),
  ]);
  res.json({ total, page, pageSize, attributions });
}));

/** POST /api/admin/sales/attributions/:id/activate */
router.post("/attributions/:id/activate", limitSalesAdminWrite, requireAdminFinanceGrant, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = actionSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const input = parsed.data!;
  const now = new Date();
  const result = await db.$transaction(async (tx: any) => {
    const attribution = await tx.propertySalesAttribution.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        propertyId: true,
        productType: true,
        salesPartnerId: true,
        property: { select: { title: true } },
        salesPartner: {
          select: {
            userId: true,
            agentCode: true,
            status: true,
            contracts: {
              where: activeContractWhere(now),
              orderBy: { expiresAt: "desc" },
              take: 1,
              select: { id: true, status: true, startsAt: true, expiresAt: true },
            },
          },
        },
      },
    });
    if (!attribution) throw new AttributionNotFoundError("Attribution not found");
    if (!canActivateAttribution(attribution.status)) {
      throw new AttributionConflictError("Only a VERIFIED attribution can be activated");
    }
    if (attribution.salesPartner.status !== "ACTIVE") {
      throw new AttributionConflictError("The attributed sales partner is not active");
    }
    const contract = currentAttributionContract(attribution.salesPartner.contracts, now);
    if (!contract) throw new AttributionConflictError("The sales partner has no active earning contract");
    const commissionStartsAt = attributionCommissionStart(contract, now);
    const updated = await tx.propertySalesAttribution.updateMany({
      where: { id, status: "VERIFIED", salesPartnerId: attribution.salesPartnerId },
      data: {
        status: "ACTIVE",
        contractId: contract.id,
        commissionStartsAt,
        commissionEndsAt: contract.expiresAt,
        revokedAt: null,
        disputeReason: null,
        notes: input.reason,
      },
    });
    if (updated.count !== 1) throw new AttributionConflictError("Attribution was changed by another administrator");
    await tx.auditLog.create({
      data: auditData(req, "SALES_ATTRIBUTION_ACTIVATE", "PROPERTY_SALES_ATTRIBUTION", id,
        { status: attribution.status, salesPartnerId: attribution.salesPartnerId },
        {
          status: "ACTIVE",
          contractId: contract.id,
          commissionStartsAt,
          commissionEndsAt: contract.expiresAt,
          reason: input.reason,
        }),
    });
    return { attribution, contract, commissionStartsAt };
  });
  await notifyUser(result.attribution.salesPartner.userId, "sales_partner_attribution_approved", {
    propertyName: result.attribution.property.title,
    productType: result.attribution.productType,
  }).catch(() => {});
  return res.json({
    ok: true,
    attribution: {
      id,
      status: "ACTIVE",
      contractId: result.contract.id,
      commissionStartsAt: result.commissionStartsAt,
      commissionEndsAt: result.contract.expiresAt,
    },
  });
}));

/** POST /api/admin/sales/attributions/:id/revoke */
router.post("/attributions/:id/revoke", limitSalesAdminWrite, requireAdminFinanceGrant, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = actionSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const input = parsed.data!;
  const now = new Date();
  const result = await db.$transaction(async (tx: any) => {
    const attribution = await tx.propertySalesAttribution.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        salesPartnerId: true,
        productType: true,
        property: { select: { title: true } },
        salesPartner: { select: { userId: true, agentCode: true } },
      },
    });
    if (!attribution) throw new AttributionNotFoundError("Attribution not found");
    if (!canRevokeAttribution(attribution.status)) {
      throw new AttributionConflictError("This attribution is already revoked");
    }
    const updated = await tx.propertySalesAttribution.updateMany({
      where: { id, status: attribution.status, salesPartnerId: attribution.salesPartnerId },
      data: {
        status: "REVOKED",
        revokedAt: now,
        commissionEndsAt: now,
        disputeReason: input.reason,
        notes: input.reason,
      },
    });
    if (updated.count !== 1) throw new AttributionConflictError("Attribution was changed by another administrator");
    await tx.auditLog.create({
      data: auditData(req, "SALES_ATTRIBUTION_REVOKE", "PROPERTY_SALES_ATTRIBUTION", id,
        { status: attribution.status, salesPartnerId: attribution.salesPartnerId },
        { status: "REVOKED", revokedAt: now, commissionEndsAt: now, reason: input.reason }),
    });
    return attribution;
  });
  await notifyUser(result.salesPartner.userId, "sales_partner_attribution_revoked", {
    propertyName: result.property.title,
    productType: result.productType,
    reason: input.reason,
  }).catch(() => {});
  return res.json({ ok: true, attribution: { id, status: "REVOKED", revokedAt: now, commissionEndsAt: now } });
}));

/** POST /api/admin/sales/attributions/:id/reassign */
router.post("/attributions/:id/reassign", limitSalesAdminWrite, requireAdminFinanceGrant, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = reassignSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const input = parsed.data!;
  const now = new Date();
  const result = await db.$transaction(async (tx: any) => {
    const attribution = await tx.propertySalesAttribution.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        propertyId: true,
        productType: true,
        salesPartnerId: true,
        salesPartner: { select: { userId: true, agentCode: true } },
        property: { select: { title: true } },
      },
    });
    if (!attribution) throw new AttributionNotFoundError("Attribution not found");
    if (!canReassignAttribution(attribution.status)) {
      throw new AttributionConflictError("This attribution cannot be reassigned in its current state");
    }
    if (attribution.salesPartnerId === input.salesPartnerId) {
      throw new AttributionConflictError("Choose a different sales partner");
    }
    const target = await tx.salesPartnerProfile.findUnique({
      where: { id: input.salesPartnerId },
      select: {
        id: true,
        userId: true,
        agentCode: true,
        status: true,
        contracts: {
          where: activeContractWhere(now),
          orderBy: { expiresAt: "desc" },
          take: 1,
          select: { id: true, status: true, startsAt: true, expiresAt: true },
        },
      },
    });
    if (!target) throw new AttributionNotFoundError("Target sales partner not found");
    if (target.status !== "ACTIVE") throw new AttributionConflictError("Target sales partner is not active");
    const contract = currentAttributionContract(target.contracts, now);
    if (!contract) throw new AttributionConflictError("Target sales partner has no active earning contract");
    if (input.leadId) {
      const targetLead = await tx.salesLead.findFirst({
        where: { id: input.leadId, salesPartnerId: target.id },
        select: { id: true },
      });
      if (!targetLead) throw new AttributionConflictError("The replacement lead does not belong to the target partner");
    }
    const updated = await tx.propertySalesAttribution.updateMany({
      where: { id, status: attribution.status, salesPartnerId: attribution.salesPartnerId },
      data: {
        salesPartnerId: target.id,
        leadId: input.leadId ?? null,
        contractId: contract.id,
        status: "VERIFIED",
        verifiedAt: now,
        verifiedById: req.user!.id,
        commissionStartsAt: null,
        commissionEndsAt: null,
        reassignedAt: now,
        reassignedToPartnerId: target.id,
        revokedAt: null,
        disputeReason: null,
        notes: input.reason,
      },
    });
    if (updated.count !== 1) throw new AttributionConflictError("Attribution was changed by another administrator");
    await tx.auditLog.create({
      data: auditData(req, "SALES_ATTRIBUTION_REASSIGN", "PROPERTY_SALES_ATTRIBUTION", id,
        {
          status: attribution.status,
          salesPartnerId: attribution.salesPartnerId,
          agentCode: attribution.salesPartner.agentCode,
        },
        {
          status: "VERIFIED",
          salesPartnerId: target.id,
          agentCode: target.agentCode,
          contractId: contract.id,
          previousCommissionEndedAt: now,
          reason: input.reason,
        }),
    });
    return { attribution, target };
  });
  await Promise.all([
    notifyUser(result.attribution.salesPartner.userId, "sales_partner_attribution_reassigned_away", {
      propertyName: result.attribution.property.title,
      productType: result.attribution.productType,
      reason: input.reason,
    }).catch(() => {}),
    notifyUser(result.target.userId, "sales_partner_attribution_verified", {
      propertyName: result.attribution.property.title,
      productType: result.attribution.productType,
    }).catch(() => {}),
  ]);
  return res.json({
    ok: true,
    attribution: { id, status: "VERIFIED", salesPartnerId: result.target.id },
    nextAction: "ACTIVATE_ATTRIBUTION",
  });
}));

const attributionErrorHandler: ErrorRequestHandler = (error: any, _req, res, next: NextFunction) => {
  if (error instanceof AttributionNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof AttributionConflictError || isUniqueConflict(error)) {
    res.status(409).json({
      error: error instanceof AttributionConflictError
        ? error.message
        : "Another request changed this property attribution first; reload before continuing",
    });
    return;
  }
  next(error);
};
router.use(attributionErrorHandler);

export default router;

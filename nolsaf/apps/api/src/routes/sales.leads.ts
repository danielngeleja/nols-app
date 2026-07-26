// Sales partner lead pipeline.
//
// Every query is scoped with partnerIdFor(req). A route parameter identifies a
// lead only inside that already-scoped portfolio, so changing :id can never
// expose or mutate another partner's prospect.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  partnerIdFor,
  requireActivePartnerContract,
  requireWorkspaceAccess,
  type SalesAuthedRequest,
} from "../middleware/salesWorkspace.js";
import {
  LEAD_ACTIVITY_TYPES,
  LEAD_PROTECTION_DAYS,
  LEAD_STATUSES,
  PARTNER_SETTABLE_LEAD_STATUSES,
  PROPOSED_PRODUCTS,
  PROTECTION_EXTENDING_ACTIVITIES,
} from "../lib/salesPartner.js";
import {
  findSalesLeadDuplicateMatches,
  normalizeSalesLeadIdentity,
  type NormalizedSalesLeadIdentity,
  type SalesLeadDuplicateMatch,
} from "../lib/salesLeadMatching.js";
import { sanitizeText } from "../lib/sanitize.js";
import { audit } from "../lib/audit.js";
import { notifyAdmins } from "../lib/notifications.js";
import { limitSalesLeadRead, limitSalesLeadWrite } from "../middleware/rateLimit.js";

const router = Router();
const db = prisma as any;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLOSED_FOR_EDIT = ["CONVERTED"] as const;
const PARTNER_ACTIVITY_TYPES = LEAD_ACTIVITY_TYPES.filter(
  (type) => !["ADMIN_COMMENT", "STATUS_CHANGED"].includes(type),
);

router.use(
  requireAuth as RequestHandler,
  requireWorkspaceAccess("SALES"),
  requireActivePartnerContract,
);

function optionalText(max: number) {
  return z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => {
      if (value == null) return value;
      const clean = sanitizeText(value).trim();
      return clean || null;
    });
}

const leadInputShape = {
  propertyName: z.string().trim().min(2).max(200).transform(sanitizeText),
  contactPerson: optionalText(160),
  contactPhone: optionalText(40),
  contactEmail: z
    .union([z.string().trim().email().max(190), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value ? value.toLocaleLowerCase("en") : null)),
  location: optionalText(200),
  region: optionalText(120),
  propertyType: optionalText(60),
  estimatedRooms: z.union([z.coerce.number().int().min(1).max(100_000), z.null()]).optional(),
  registrationNumber: optionalText(80),
  taxNumber: optionalText(80),
  proposedProduct: z.enum(PROPOSED_PRODUCTS),
  nextFollowUpAt: z.union([z.coerce.date(), z.null()]).optional(),
  notes: optionalText(5_000),
};

const createSchema = z.object(leadInputShape).strict();
const updateSchema = z
  .object({
    ...Object.fromEntries(
      Object.entries(leadInputShape).map(([key, schema]) => [key, schema.optional()]),
    ),
    status: z.enum(PARTNER_SETTABLE_LEAD_STATUSES as [string, ...string[]]).optional(),
    lostReason: optionalText(300),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "No changes supplied" });

const activitySchema = z
  .object({
    type: z.enum(PARTNER_ACTIVITY_TYPES as [string, ...string[]]),
    description: z.string().trim().min(2).max(5_000).transform(sanitizeText),
    nextFollowUpAt: z.union([z.coerce.date(), z.null()]).optional(),
    fileUrl: z
      .string()
      .url()
      .max(500)
      .refine((value) => value.startsWith("https://"), "Document URL must use HTTPS")
      .optional(),
  })
  .strict();

const idSchema = z.object({ id: z.coerce.number().int().positive() });
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(LEAD_STATUSES).optional(),
  product: z.enum(PROPOSED_PRODUCTS).optional(),
  q: z.string().trim().max(120).optional(),
  followUp: z.enum(["OVERDUE", "UPCOMING", "NONE"]).optional(),
  sort: z.enum(["createdAt", "updatedAt", "nextFollowUpAt", "propertyName"]).default("updatedAt"),
  direction: z.enum(["asc", "desc"]).default("desc"),
});

function invalid(res: Response, parsed: { success: boolean; error?: any }) {
  if (parsed.success) return false;
  res.status(400).json({ error: parsed.error?.issues?.[0]?.message || "Invalid request" });
  return true;
}

function protectionExpiry(from = new Date()) {
  return new Date(from.getTime() + LEAD_PROTECTION_DAYS * DAY_MS);
}

function partnerId(req: SalesAuthedRequest, res: Response): number | null {
  const id = partnerIdFor(req);
  if (!id) res.status(403).json({ error: "Sales partner context required" });
  return id;
}

function publicLead(lead: any) {
  const { duplicateEvidence: _duplicateEvidence, ...safe } = lead;
  return safe;
}

function duplicateWarning(matches: SalesLeadDuplicateMatch[], currentPartnerId: number) {
  if (!matches.length) return null;
  const matchedFields = [...new Set(matches.flatMap((match) => match.matchedFields))];
  const ownLeadIds = matches
    .filter((match) => match.salesPartnerId === currentPartnerId)
    .map((match) => match.leadId);
  return {
    code: "POSSIBLE_DUPLICATE",
    message:
      "This prospect may already be registered. It was saved and flagged for administrator review.",
    matchedFields,
    // The partner may navigate to their own matching lead, but receives no id
    // or identity belonging to another partner.
    ownLeadIds,
  };
}

function identityFromLead(lead: any): NormalizedSalesLeadIdentity {
  return normalizeSalesLeadIdentity({
    propertyName: lead.propertyName,
    contactPhone: lead.contactPhone,
    contactEmail: lead.contactEmail,
    location: lead.location,
    registrationNumber: lead.registrationNumber,
    taxNumber: lead.taxNumber,
  });
}

async function duplicateMatches(identity: NormalizedSalesLeadIdentity, excludeId?: number) {
  const strong: any[] = [
    identity.contactPhoneNormalized
      ? { contactPhoneNormalized: identity.contactPhoneNormalized }
      : null,
    identity.contactEmailNormalized
      ? { contactEmailNormalized: identity.contactEmailNormalized }
      : null,
    identity.registrationNumberNormalized
      ? { registrationNumberNormalized: identity.registrationNumberNormalized }
      : null,
    identity.taxNumberNormalized
      ? { taxNumberNormalized: identity.taxNumberNormalized }
      : null,
  ].filter(Boolean);

  const baseWhere = {
    ...(excludeId ? { id: { not: excludeId } } : {}),
    status: { notIn: ["LOST", "CANCELLED"] },
  };
  const select = {
    id: true,
    salesPartnerId: true,
    propertyNameNormalized: true,
    contactPhoneNormalized: true,
    contactEmailNormalized: true,
    locationNormalized: true,
    registrationNumberNormalized: true,
    taxNumberNormalized: true,
  };
  // Query strong identifiers separately so a flood of generic equal names can
  // never push an exact phone, email, tax or registration match past `take`.
  const [strongCandidates, nameCandidates] = await Promise.all([
    strong.length
      ? db.salesLead.findMany({
          where: { ...baseWhere, OR: strong },
          take: 50,
          orderBy: { id: "desc" },
          select,
        })
      : [],
    db.salesLead.findMany({
      where: {
        ...baseWhere,
        propertyNameNormalized: identity.propertyNameNormalized,
      },
      take: 50,
      orderBy: { id: "desc" },
      select,
    }),
  ]);
  const candidates = [...new Map(
    [...strongCandidates, ...nameCandidates].map((candidate: any) => [candidate.id, candidate]),
  ).values()];
  return findSalesLeadDuplicateMatches(identity, candidates as any);
}

function leadSelect() {
  return {
    id: true,
    propertyName: true,
    contactPerson: true,
    contactPhone: true,
    contactEmail: true,
    location: true,
    region: true,
    propertyType: true,
    estimatedRooms: true,
    registrationNumber: true,
    taxNumber: true,
    proposedProduct: true,
    status: true,
    duplicateReviewStatus: true,
    nextFollowUpAt: true,
    notes: true,
    lostReason: true,
    protectionStartsAt: true,
    protectionExpiresAt: true,
    conversionRequestedAt: true,
    convertedPropertyId: true,
    convertedAt: true,
    createdAt: true,
    updatedAt: true,
  };
}

/** GET /api/sales/leads */
router.get("/leads", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res) => {
  const parsed = listSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const { page, pageSize, status, product, q, followUp, sort, direction } = parsed.data!;
  const now = new Date();
  const where: any = { salesPartnerId: scopedPartnerId };
  if (status) where.status = status;
  if (product) where.proposedProduct = product;
  if (q) {
    where.OR = [
      { propertyName: { contains: q } },
      { contactPerson: { contains: q } },
      { contactPhone: { contains: q } },
      { contactEmail: { contains: q } },
      { location: { contains: q } },
    ];
  }
  if (followUp === "OVERDUE") where.nextFollowUpAt = { lt: now };
  if (followUp === "UPCOMING") where.nextFollowUpAt = { gte: now };
  if (followUp === "NONE") where.nextFollowUpAt = null;

  const [total, leads] = await Promise.all([
    db.salesLead.count({ where }),
    db.salesLead.findMany({
      where,
      orderBy: { [sort]: direction },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        ...leadSelect(),
        _count: { select: { activities: true } },
      },
    }),
  ]);
  return res.json({ total, page, pageSize, leads: leads.map(publicLead) });
}));

/** POST /api/sales/leads */
router.post("/leads", limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const input = parsed.data!;
  const identity = normalizeSalesLeadIdentity(input);
  let matches = await duplicateMatches(identity);
  const now = new Date();

  let lead = await db.$transaction(async (tx: any) => {
    const created = await tx.salesLead.create({
      data: {
        salesPartnerId: scopedPartnerId,
        ...input,
        ...identity,
        duplicateReviewStatus: matches.length ? "POSSIBLE_DUPLICATE" : "CLEAR",
        duplicateEvidence: matches.length
          ? {
              checkedAt: now.toISOString(),
              candidates: matches.map((match) => ({
                leadId: match.leadId,
                matchedFields: match.matchedFields,
                score: match.score,
              })),
            }
          : null,
        protectionStartsAt: now,
        protectionExpiresAt: protectionExpiry(now),
      },
      select: leadSelect(),
    });
    await tx.salesLeadActivity.create({
      data: {
        leadId: created.id,
        createdById: req.user!.id,
        type: "NOTE",
        description: "Lead registered.",
      },
    });
    return created;
  });

  // Close the check-then-insert race without making duplicates a hard block.
  // If two matching leads are submitted concurrently, at least the later
  // post-commit scan sees the other committed row and flags itself for review.
  if (!matches.length) {
    const postCommitMatches = await duplicateMatches(identity, lead.id);
    if (postCommitMatches.length) {
      matches = postCommitMatches;
      const duplicateEvidence = {
        checkedAt: new Date().toISOString(),
        candidates: matches.map((match) => ({
          leadId: match.leadId,
          matchedFields: match.matchedFields,
          score: match.score,
        })),
      };
      lead = await db.salesLead.update({
        where: { id: lead.id },
        data: {
          duplicateReviewStatus: "POSSIBLE_DUPLICATE",
          duplicateEvidence,
        },
        select: leadSelect(),
      });
    }
  }

  await audit(req, "SALES_LEAD_CREATE", "SALES_LEAD", null, {
    salesPartnerId: scopedPartnerId,
    propertyName: lead.propertyName,
    proposedProduct: lead.proposedProduct,
    duplicateReviewStatus: lead.duplicateReviewStatus,
  }, lead.id);
  return res.status(201).json({
    lead: publicLead(lead),
    warning: duplicateWarning(matches, scopedPartnerId),
  });
}));

/** GET /api/sales/leads/:id */
router.get("/leads/:id", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res) => {
  const parsed = idSchema.safeParse(req.params);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const lead = await db.salesLead.findFirst({
    where: { id: parsed.data!.id, salesPartnerId: scopedPartnerId },
    select: {
      ...leadSelect(),
      activities: {
        orderBy: { createdAt: "desc" },
        take: 200,
        select: {
          id: true,
          type: true,
          description: true,
          fileUrl: true,
          createdAt: true,
          createdBy: { select: { id: true, name: true, fullName: true } },
        },
      },
    },
  });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  return res.json({ lead: publicLead(lead) });
}));

/** PATCH /api/sales/leads/:id */
router.patch("/leads/:id", limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res) => {
  const params = idSchema.safeParse(req.params);
  const parsed = updateSchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const current = await db.salesLead.findFirst({
    where: { id: params.data!.id, salesPartnerId: scopedPartnerId },
    select: {
      ...leadSelect(),
      salesPartnerId: true,
    },
  });
  if (!current) return res.status(404).json({ error: "Lead not found" });
  if (CLOSED_FOR_EDIT.includes(current.status as any)) {
    return res.status(409).json({ error: "A converted lead is read only" });
  }
  if (
    current.status === "CONVERSION_REQUESTED" &&
    parsed.data!.status
  ) {
    return res.status(409).json({ error: "A submitted conversion cannot be withdrawn by changing status" });
  }
  if (parsed.data!.status === "LOST" && !parsed.data!.lostReason) {
    return res.status(400).json({ error: "Lost reason is required when marking a lead lost" });
  }

  const input = parsed.data!;
  const merged = { ...current, ...input };
  const identity = identityFromLead(merged);
  const matches = await duplicateMatches(identity, current.id);
  const statusChanged = input.status && input.status !== current.status;

  const lead = await db.$transaction(async (tx: any) => {
    const updated = await tx.salesLead.update({
      where: { id: current.id },
      data: {
        ...input,
        ...identity,
        duplicateReviewStatus: matches.length ? "POSSIBLE_DUPLICATE" : "CLEAR",
        duplicateEvidence: matches.length
          ? {
              checkedAt: new Date().toISOString(),
              candidates: matches.map((match) => ({
                leadId: match.leadId,
                matchedFields: match.matchedFields,
                score: match.score,
              })),
            }
          : null,
        ...(input.status && input.status !== "LOST" ? { lostReason: null } : {}),
      },
      select: leadSelect(),
    });
    if (statusChanged) {
      await tx.salesLeadActivity.create({
        data: {
          leadId: current.id,
          createdById: req.user!.id,
          type: "STATUS_CHANGED",
          description: `Status changed from ${current.status} to ${input.status}.`,
        },
      });
    }
    return updated;
  });

  await audit(req, "SALES_LEAD_UPDATE", "SALES_LEAD", {
    status: current.status,
    nextFollowUpAt: current.nextFollowUpAt,
  }, {
    status: lead.status,
    nextFollowUpAt: lead.nextFollowUpAt,
    duplicateReviewStatus: lead.duplicateReviewStatus,
  }, lead.id);
  return res.json({
    lead: publicLead(lead),
    warning: duplicateWarning(matches, scopedPartnerId),
  });
}));

/** POST /api/sales/leads/:id/activities */
router.post("/leads/:id/activities", limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res) => {
  const params = idSchema.safeParse(req.params);
  const parsed = activitySchema.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const lead = await db.salesLead.findFirst({
    where: { id: params.data!.id, salesPartnerId: scopedPartnerId },
    select: { id: true, status: true, protectionExpiresAt: true },
  });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (CLOSED_FOR_EDIT.includes(lead.status as any)) {
    return res.status(409).json({ error: "A converted lead is read only" });
  }
  const input = parsed.data!;
  const extendsProtection = PROTECTION_EXTENDING_ACTIVITIES.includes(input.type as any);
  const now = new Date();
  const nextStatus =
    input.type === "PROPOSAL_SENT" && !["LOST", "CANCELLED"].includes(lead.status)
      ? "PROPOSAL_SENT"
      : lead.status;

  const result = await db.$transaction(async (tx: any) => {
    const activity = await tx.salesLeadActivity.create({
      data: {
        leadId: lead.id,
        createdById: req.user!.id,
        type: input.type,
        description: input.description,
        fileUrl: input.fileUrl || null,
      },
      select: {
        id: true,
        type: true,
        description: true,
        fileUrl: true,
        createdAt: true,
      },
    });
    const updated = await tx.salesLead.update({
      where: { id: lead.id },
      data: {
        status: nextStatus,
        ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt } : {}),
        ...(extendsProtection ? { protectionExpiresAt: protectionExpiry(now) } : {}),
      },
      select: {
        id: true,
        status: true,
        nextFollowUpAt: true,
        protectionExpiresAt: true,
      },
    });
    return { activity, lead: updated };
  });

  await audit(req, "SALES_LEAD_ACTIVITY_CREATE", "SALES_LEAD", null, {
    activityId: result.activity.id,
    type: result.activity.type,
    protectionExtended: extendsProtection,
  }, lead.id);
  return res.status(201).json(result);
}));

/** POST /api/sales/leads/:id/request-conversion */
router.post("/leads/:id/request-conversion", limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res) => {
  const parsed = idSchema.safeParse(req.params);
  if (invalid(res, parsed)) return;
  const scopedPartnerId = partnerId(req, res);
  if (!scopedPartnerId) return;
  const lead = await db.salesLead.findFirst({
    where: { id: parsed.data!.id, salesPartnerId: scopedPartnerId },
    select: {
      id: true,
      propertyName: true,
      proposedProduct: true,
      status: true,
      conversionRequestedAt: true,
      duplicateReviewStatus: true,
    },
  });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  if (lead.status === "CONVERSION_REQUESTED") {
    return res.json({ ok: true, alreadyRequested: true, lead });
  }
  if (["CONVERTED", "LOST", "CANCELLED"].includes(lead.status)) {
    return res.status(409).json({ error: "This lead cannot request conversion in its current status" });
  }
  const now = new Date();
  const result = await db.$transaction(async (tx: any) => {
    const updated = await tx.salesLead.updateMany({
      where: {
        id: lead.id,
        salesPartnerId: scopedPartnerId,
        status: { notIn: ["CONVERSION_REQUESTED", "CONVERTED", "LOST", "CANCELLED"] },
      },
      data: {
        status: "CONVERSION_REQUESTED",
        conversionRequestedAt: now,
      },
    });
    if (updated.count !== 1) return null;
    await tx.salesLeadActivity.create({
      data: {
        leadId: lead.id,
        createdById: req.user!.id,
        type: "STATUS_CHANGED",
        description: "Conversion requested for administrator verification.",
      },
    });
    return tx.salesLead.findUnique({ where: { id: lead.id }, select: leadSelect() });
  });
  if (!result) return res.status(409).json({ error: "Conversion request was already processed" });

  await audit(req, "SALES_LEAD_CONVERSION_REQUEST", "SALES_LEAD", {
    status: lead.status,
  }, {
    status: "CONVERSION_REQUESTED",
    conversionRequestedAt: now,
    duplicateReviewStatus: lead.duplicateReviewStatus,
  }, lead.id);
  await notifyAdmins("sales_partner_conversion_requested", {
    leadId: lead.id,
    propertyName: lead.propertyName,
    proposedProduct: lead.proposedProduct,
    duplicateReviewStatus: lead.duplicateReviewStatus,
  });
  return res.json({ ok: true, lead: publicLead(result) });
}));

export default router;

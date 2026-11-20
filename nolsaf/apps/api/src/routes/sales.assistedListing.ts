/**
 * Sales assisted listing, partner side (docs/SALES_ASSISTED_LISTING.md).
 *
 * GET  /api/sales/leads/:id/assisted-listing           state, eligibility, verified visit
 * POST /api/sales/leads/:id/assisted-listing           start: owner name + phone (+ email)
 * GET  /api/sales/leads/:id/assisted-listing/property  the draft, same shape as the owner GET
 * PUT  /api/sales/leads/:id/assisted-listing/property  save, same handler as the owner PUT
 * POST /api/sales/leads/:id/assisted-listing/submit    submit, same handler as the owner submit
 *
 * There is one listing implementation. The property routes run the owner
 * handlers from owner.properties.ts with `req.listingScope` set to the owner
 * this partner lists for, after this router has proved the partner owns the
 * lead, holds the right, and the listing is still theirs to edit.
 *
 * Every lookup is scoped by partnerIdFor(req) from the session; :id is an
 * opaque sl_ lead reference resolved within the partner's own leads.
 */
import { Router, type NextFunction, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  partnerIdFor,
  requireActivePartnerContract,
  requireWorkspaceAccess,
  type SalesAuthedRequest,
} from "../middleware/salesWorkspace.js";
import { limitSalesLeadRead, limitSalesLeadWrite } from "../middleware/rateLimit.js";
import { resolvePartnerLead, propertyRef } from "../lib/salesReference.js";
import { audit } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { getListingProperty, submitListingProperty, updateListingProperty, type ListingScope } from "./owner.properties.js";
import {
  ASSISTED_EDITABLE,
  ASSISTED_MAX_OPEN_DRAFTS,
  ASSISTED_OPEN,
  AssistedListingError,
  assistedGateOf,
  assistedGateRefusal,
  leadCanStartAssisted,
  maskOwnerPhone,
  newNoticeToken,
  onAssistedSubmitted,
  propertyTypeFromLead,
  resolveOwnerAccount,
  sendAssistedNotice,
} from "../lib/salesAssistedListing.js";

const router = Router();
const db = prisma as any;

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"), requireActivePartnerContract);

router.param("id", (async (req: SalesAuthedRequest, res: Response, next: (err?: any) => void, value: string) => {
  try {
    if ((req as any).user?.imp && !["GET", "HEAD"].includes(req.method)) return next();
    const scoped = partnerIdFor(req);
    if (!scoped) return res.status(403).json({ error: "Sales partner context required" });
    const id = await resolvePartnerLead(db, value, scoped);
    if (!id) return res.status(404).json({ error: "Lead not found" });
    req.params.id = String(id);
    next();
  } catch (error) {
    next(error);
  }
}) as any);

const startSchema = z.object({
  ownerName: z.string().trim().min(3, "Enter the owner's full name").max(160).transform(sanitizeText),
  ownerPhone: z.string().trim().min(9, "Enter the owner's phone number").max(40),
  ownerEmail: z
    .union([z.string().trim().email("Enter a valid email or leave it empty").max(190), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value ? value.toLowerCase() : null)),
}).strict();

const listingSelect = {
  id: true,
  status: true,
  ownerAccountOutcome: true,
  noticeSentAt: true,
  liveNoticeSentAt: true,
  objectedAt: true,
  submittedAt: true,
  approvedAt: true,
  returnedAt: true,
  returnReasons: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  propertyId: true,
  property: { select: { title: true, status: true } },
  owner: { select: { name: true, fullName: true, phone: true } },
};

function serializeListing(row: any) {
  if (!row) return null;
  return {
    status: row.status,
    editable: (ASSISTED_EDITABLE as readonly string[]).includes(row.status),
    ownerAccount: row.ownerAccountOutcome,
    ownerName: row.owner?.fullName || row.owner?.name || null,
    ownerPhone: maskOwnerPhone(row.owner?.phone),
    propertyRef: propertyRef(row.propertyId),
    propertyTitle: row.property?.title ?? null,
    propertyStatus: row.property?.status ?? null,
    noticeSentAt: row.noticeSentAt,
    liveNoticeSentAt: row.liveNoticeSentAt,
    objectedAt: row.objectedAt,
    submittedAt: row.submittedAt,
    approvedAt: row.approvedAt,
    returnedAt: row.returnedAt,
    returnReasons: row.returnReasons ?? null,
    cancelledAt: row.cancelledAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function partnerOr403(req: SalesAuthedRequest, res: Response): number | null {
  const id = partnerIdFor(req);
  if (!id) res.status(403).json({ error: "Sales partner context required" });
  return id;
}

/** The latest verified on-site visit on this lead, which is what allows a listing to start. */
async function latestVerifiedVisit(leadId: number, salesPartnerId: number) {
  return db.salesLeadVisit.findFirst({
    where: { leadId, salesPartnerId, status: "VERIFIED" },
    orderBy: { capturedAt: "desc" },
    select: { id: true, capturedAt: true },
  });
}

/** GET /api/sales/leads/:id/assisted-listing */
router.get("/leads/:id/assisted-listing", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerOr403(req, res);
  if (!partnerId) return;
  const leadId = Number(req.params.id);
  const [lead, profile, row, visit, openCount] = await Promise.all([
    db.salesLead.findFirst({ where: { id: leadId, salesPartnerId: partnerId }, select: { id: true, status: true, propertyName: true, contactPerson: true, contactPhone: true, contactEmail: true } }),
    db.salesPartnerProfile.findUnique({ where: { id: partnerId }, select: { assistedListingEnabledAt: true, assistedListingPausedAt: true, assistedListingPauseReason: true } }),
    db.salesAssistedListing.findFirst({ where: { leadId, salesPartnerId: partnerId }, select: listingSelect }),
    latestVerifiedVisit(leadId, partnerId),
    db.salesAssistedListing.count({ where: { salesPartnerId: partnerId, status: { in: [...ASSISTED_OPEN] } } }),
  ]);
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  const gate = assistedGateOf(profile);
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    gate: { ...gate, refusal: assistedGateRefusal(gate) },
    hasVerifiedVisit: Boolean(visit),
    leadOpen: leadCanStartAssisted(lead.status),
    openDrafts: openCount,
    maxOpenDrafts: ASSISTED_MAX_OPEN_DRAFTS,
    // Prefill for the start form, from what the partner already recorded on the lead.
    prefill: { ownerName: lead.contactPerson ?? "", ownerPhone: lead.contactPhone ?? "", ownerEmail: lead.contactEmail ?? "" },
    listing: serializeListing(row),
  });
}));

/** POST /api/sales/leads/:id/assisted-listing */
router.post("/leads/:id/assisted-listing", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerOr403(req, res);
  if (!partnerId) return;
  const parsed = startSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  const leadId = Number(req.params.id);
  const input = parsed.data;

  try {
    const result = await db.$transaction(async (tx: any) => {
      const [lead, profile] = await Promise.all([
        tx.salesLead.findFirst({
          where: { id: leadId, salesPartnerId: partnerId },
          select: { id: true, status: true, propertyName: true, propertyType: true, region: true, district: true, ward: true },
        }),
        tx.salesPartnerProfile.findUnique({
          where: { id: partnerId },
          select: { agentCode: true, assistedListingEnabledAt: true, assistedListingPausedAt: true, assistedListingPauseReason: true, user: { select: { name: true, fullName: true } } },
        }),
      ]);
      if (!lead) throw new AssistedListingError(404, "Lead not found");
      const refusal = assistedGateRefusal(assistedGateOf(profile));
      if (refusal) throw new AssistedListingError(403, refusal);
      if (!leadCanStartAssisted(lead.status)) throw new AssistedListingError(409, "This lead is closed. Listing for the owner is only possible on an open lead.");
      const existing = await tx.salesAssistedListing.findFirst({ where: { leadId: lead.id }, select: { id: true } });
      if (existing) throw new AssistedListingError(409, "A listing has already been started for this lead.");
      const visit = await tx.salesLeadVisit.findFirst({
        where: { leadId: lead.id, salesPartnerId: partnerId, status: "VERIFIED" },
        orderBy: { capturedAt: "desc" },
        select: { id: true },
      });
      // A visit is not required (partners cannot reach every property), but
      // when one exists it is attached as evidence for the admin review.
      const open = await tx.salesAssistedListing.count({ where: { salesPartnerId: partnerId, status: { in: [...ASSISTED_OPEN] } } });
      if (open >= ASSISTED_MAX_OPEN_DRAFTS) {
        throw new AssistedListingError(409, `You have ${open} listings in progress. Submit some before starting another.`);
      }

      const owner = await resolveOwnerAccount(tx, partnerId, { name: input.ownerName, phone: input.ownerPhone, email: input.ownerEmail });
      // The lead's name is a starting point; the partner sets the real title in the listing steps.
      const leadName = String(lead.propertyName || "").trim().slice(0, 200);
      const property = await tx.property.create({
        data: {
          ownerId: owner.ownerUserId,
          status: "DRAFT",
          title: leadName.length >= 3 ? leadName : `${leadName || "New"} property`,
          type: propertyTypeFromLead(lead.propertyType),
          regionName: lead.region ?? null,
          district: lead.district ?? null,
          ward: lead.ward ?? null,
          country: "Tanzania",
          currency: "TZS",
        },
        select: { id: true, title: true },
      });
      const token = newNoticeToken();
      const row = await tx.salesAssistedListing.create({
        data: {
          leadId: lead.id,
          salesPartnerId: partnerId,
          propertyId: property.id,
          ownerUserId: owner.ownerUserId,
          visitId: visit?.id ?? null,
          ownerAccountOutcome: owner.outcome,
          objectionReferenceHash: token.hash,
        },
        select: { id: true },
      });
      await tx.salesLeadActivity.create({
        data: {
          leadId: lead.id,
          createdById: req.user!.id,
          type: "NOTE",
          description: `Started listing the property for the owner (${owner.outcome === "CREATED" ? "new owner account" : "existing owner account"}). The owner is told by SMS.`,
        },
      });
      return {
        assistedId: row.id,
        propertyId: property.id,
        propertyName: property.title,
        ownerUserId: owner.ownerUserId,
        ownerPhone: owner.phone,
        outcome: owner.outcome,
        partnerName: profile.user?.fullName || profile.user?.name || profile.agentCode,
        noticeRaw: token.raw,
      };
    }, { maxWait: 5000, timeout: 15000 });

    const smsSent = await sendAssistedNotice({
      assistedId: result.assistedId,
      ownerUserId: result.ownerUserId,
      ownerAccountOutcome: result.outcome,
      ownerPhone: result.ownerPhone,
      ownerName: input.ownerName,
      partnerName: result.partnerName,
      propertyName: result.propertyName,
      noticeRaw: result.noticeRaw,
    });
    await audit(req as any, "SALES_ASSISTED_LISTING_START", "SALES_LEAD", null, {
      assistedId: result.assistedId,
      propertyId: result.propertyId,
      ownerAccount: result.outcome,
      noticeSent: smsSent,
    }, leadId);
    const row = await db.salesAssistedListing.findUnique({ where: { id: result.assistedId }, select: listingSelect });
    return res.status(201).json({ listing: serializeListing(row), noticeSent: smsSent });
  } catch (error: any) {
    if (error instanceof AssistedListingError) return res.status(error.status).json({ error: error.message });
    if (error?.code === "P2002") return res.status(409).json({ error: "A listing has already been started for this lead, or that phone or email is taken. Reload and check." });
    throw error;
  }
}));

/**
 * Proves this partner may act on the lead's assisted listing, then hands the
 * request to the owner handler as the owner it lists for.
 */
function scopeAssisted(mode: "read" | "write"): RequestHandler {
  return (async (req: SalesAuthedRequest, res: Response, next: NextFunction) => {
    try {
      const partnerId = partnerOr403(req, res);
      if (!partnerId) return;
      const leadId = Number(req.params.id);
      const row = await db.salesAssistedListing.findFirst({
        where: { leadId, salesPartnerId: partnerId },
        select: { id: true, status: true, propertyId: true, ownerUserId: true, property: { select: { status: true } } },
      });
      if (!row) return res.status(404).json({ error: "No listing has been started for this lead" });
      if (mode === "write") {
        const gate = await db.salesPartnerProfile.findUnique({
          where: { id: partnerId },
          select: { assistedListingEnabledAt: true, assistedListingPausedAt: true, assistedListingPauseReason: true },
        });
        const refusal = assistedGateRefusal(assistedGateOf(gate));
        if (refusal) return res.status(403).json({ error: refusal });
        if (!(ASSISTED_EDITABLE as readonly string[]).includes(row.status)) {
          return res.status(409).json({ error: "This listing is with NoLSAF now and can no longer be edited by you." });
        }
        // Belt and braces: the property itself must still be a draft or returned.
        if (!["DRAFT", "REJECTED"].includes(String(row.property?.status))) {
          return res.status(409).json({ error: "This listing is with NoLSAF now and can no longer be edited by you." });
        }
      }
      const actorUserId = req.user!.id;
      const scope: ListingScope = {
        ownerId: row.ownerUserId,
        onSubmitted: () => onAssistedSubmitted(row.id, actorUserId),
      };
      (req as any).listingScope = scope;
      req.params.id = String(row.propertyId);
      return next();
    } catch (error) {
      return next(error);
    }
  }) as RequestHandler;
}

router.get("/leads/:id/assisted-listing/property", limitSalesLeadRead as any, scopeAssisted("read"), getListingProperty);
router.put("/leads/:id/assisted-listing/property", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, scopeAssisted("write"), updateListingProperty);
router.post("/leads/:id/assisted-listing/submit", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, scopeAssisted("write"), submitListingProperty);

export default router;

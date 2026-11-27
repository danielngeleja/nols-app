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
  ownerRentState,
} from "../lib/salesAssistedListing.js";
import { AccessRequestError, longStayAccessView, requestLongStayAccess } from "../lib/longStay/accessRequest.js";
import { assistedLongStayDraftRefusal, landlordGate } from "../lib/longStay/listing.js";
import { longStayEligibilityBody, longStayLeasePreviewFor, longStayQuoteFor } from "../lib/longStay/listingTools.js";
import { notifyAdmins } from "../lib/notifications.js";
import { sendSms } from "../lib/sms.js";
import { webOrigin } from "../lib/salesPartnerCard.js";
import { eventHireView, loadEventHire, loadPropertyForEvents, saveEventTerms, sendToOwner, setEventSpacePhotos, setExtraEventPhotos } from "../lib/eventHire.js";
import { sendEventHireError } from "./eventHire.js";

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
  // Required, but only a candidate: the owner proves it with a code before it
  // becomes their login (lib/ownerPendingEmail.ts).
  ownerEmail: z
    .string({ error: "Enter the owner's email" })
    .trim()
    .min(1, "Enter the owner's email")
    .email("Enter a valid email, for example name@gmail.com")
    .max(190)
    .transform((value) => value.toLowerCase()),
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
  ownerUserId: true,
  property: { select: { title: true, status: true, type: true } },
  owner: { select: { name: true, fullName: true, phone: true } },
};

/** Long-stay state for the partner; never fails the page if the request table is not migrated yet. */
async function longStayFor(row: any) {
  if (!row) return null;
  try {
    const view = await longStayAccessView(db, { id: row.id, ownerUserId: row.ownerUserId, property: row.property });
    // Whether the owner agreed the rent the partner set (section 15.1). Hidden
    // until the listing is submitted: that is when the owner is asked.
    const rent = row.propertyId ? await ownerRentState(row.propertyId).catch(() => null) : null;
    const ownerRent = rent && (rent.sentAt || rent.confirmed)
      ? { confirmed: rent.confirmed, via: rent.via, sentAt: rent.sentAt, summary: rent.summary }
      : null;
    return view ? { ...view, ownerRent } : view;
  } catch (error: any) {
    if (error?.code === "P2021") return null; // long_stay_access_request not created yet
    throw error;
  }
}

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
    longStay: await longStayFor(row),
  });
}));

const longStayRequestSchema = z.object({
  reason: z.string().trim().min(10, "Say in a sentence why this owner wants long-stay tenants.").max(500).transform(sanitizeText),
}).strict();

/**
 * POST /api/sales/leads/:id/assisted-listing/long-stay-request
 * Ask NoLSAF to switch long stay on for this listing's owner
 * (docs/LONG_STAY_RENTALS.md section 15). Idempotent while a request waits.
 */
router.post("/leads/:id/assisted-listing/long-stay-request", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerOr403(req, res);
  if (!partnerId) return;
  const parsed = longStayRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid request" });
  const leadId = Number(req.params.id);
  const [row, profile] = await Promise.all([
    db.salesAssistedListing.findFirst({ where: { leadId, salesPartnerId: partnerId }, select: listingSelect }),
    db.salesPartnerProfile.findUnique({
      where: { id: partnerId },
      select: { assistedListingEnabledAt: true, assistedListingPausedAt: true, assistedListingPauseReason: true, user: { select: { name: true, fullName: true } } },
    }),
  ]);
  if (!row) return res.status(404).json({ error: "No listing has been started for this lead" });
  const gateRefusal = assistedGateRefusal(assistedGateOf(profile));
  if (gateRefusal) return res.status(403).json({ error: gateRefusal });

  try {
    const result = await requestLongStayAccess(db, { assistedId: row.id, salesPartnerId: partnerId, reason: parsed.data.reason });
    if (result.created && result.request) {
      await audit(req as any, "LONG_STAY_ACCESS_REQUESTED", "SALES_LEAD", null, { ref: result.request.publicRef, propertyId: row.propertyId }, leadId);
      await notifyAdmins("long_stay_access_requested", {
        accessRequestId: result.request.id,
        accessRequestRef: result.request.publicRef,
        propertyTitle: row.property?.title ?? null,
        partnerName: profile?.user?.fullName || profile?.user?.name || null,
      }).catch(() => undefined);
    }
    return res.status(result.created ? 201 : 200).json({ alreadyGranted: result.alreadyGranted, longStay: await longStayFor(row) });
  } catch (error: any) {
    if (error instanceof AccessRequestError) return res.status(error.status).json({ error: error.message });
    if (error?.code === "P2021") return res.status(503).json({ error: "Long-stay requests are not available yet. NoLSAF is finishing an update." });
    throw error;
  }
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
      // The email waits as PENDING for an owner without one; an owner who
      // already has an email keeps theirs and the partner's is not offered.
      const ownerAccount = await tx.user.findUnique({ where: { id: owner.ownerUserId }, select: { email: true } });
      const row = await tx.salesAssistedListing.create({
        data: {
          leadId: lead.id,
          salesPartnerId: partnerId,
          propertyId: property.id,
          ownerUserId: owner.ownerUserId,
          visitId: visit?.id ?? null,
          ownerAccountOutcome: owner.outcome,
          objectionReferenceHash: token.hash,
          ownerEmail: input.ownerEmail,
          ownerEmailStatus: ownerAccount?.email ? null : "PENDING",
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

/**
 * Long-stay tools for the listing wizard on an assisted listing (section 15):
 * eligibility, fee quote and lease preview, the same answers an owner gets.
 * Open while the owner is switched on or the partner's request is waiting.
 */
function scopeLongStayTools(): RequestHandler {
  return (async (req: SalesAuthedRequest, res: Response, next: NextFunction) => {
    try {
      const partnerId = partnerOr403(req, res);
      if (!partnerId) return;
      const row = await db.salesAssistedListing.findFirst({
        where: { leadId: Number(req.params.id), salesPartnerId: partnerId },
        select: { propertyId: true, ownerUserId: true, owner: { select: { fullName: true, name: true } } },
      });
      if (!row) return res.status(404).json({ error: "No listing has been started for this lead" });
      (req as any).assistedOwner = row;
      return next();
    } catch (error) {
      return next(error);
    }
  }) as RequestHandler;
}

router.get("/leads/:id/assisted-listing/long-stay/eligibility", limitSalesLeadRead as any, scopeLongStayTools(), asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const row = (req as any).assistedOwner;
  const gate = await landlordGate(db, row.ownerUserId);
  const refusal = await assistedLongStayDraftRefusal(db, row.propertyId, row.ownerUserId);
  res.setHeader("Cache-Control", "no-store");
  // "granted" here means the partner may write long-stay terms now.
  return res.json(longStayEligibilityBody({ granted: !refusal, paused: gate.paused, pauseReason: gate.pauseReason, refusal }));
}));

router.post("/leads/:id/assisted-listing/long-stay/quote", limitSalesLeadRead as any, scopeLongStayTools(), asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const row = (req as any).assistedOwner;
  const refusal = await assistedLongStayDraftRefusal(db, row.propertyId, row.ownerUserId);
  if (refusal) return res.status(403).json({ error: refusal });
  const result = await longStayQuoteFor(db, req.body);
  return res.status(result.status).json(result.body);
}));

router.post("/leads/:id/assisted-listing/long-stay/lease-preview", limitSalesLeadRead as any, scopeLongStayTools(), asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const row = (req as any).assistedOwner;
  const refusal = await assistedLongStayDraftRefusal(db, row.propertyId, row.ownerUserId);
  if (refusal) return res.status(403).json({ error: refusal });
  const result = await longStayLeasePreviewFor(db, req.body, row.owner?.fullName || row.owner?.name || "[The owner]");
  res.setHeader("Cache-Control", "no-store");
  return res.status(result.status).json(result.body);
}));

router.get("/leads/:id/assisted-listing/property", limitSalesLeadRead as any, scopeAssisted("read"), getListingProperty);
router.put("/leads/:id/assisted-listing/property", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, scopeAssisted("write"), updateListingProperty);
router.post("/leads/:id/assisted-listing/submit", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, scopeAssisted("write"), submitListingProperty);

// ---------- Hire for events (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 4) ----------
// The partner fills the event terms for the owner they list for; the owner
// gives the consent on an SMS link. Open on any listing that is not cancelled
// or paused by an owner objection.

async function eventListingFor(req: SalesAuthedRequest, res: Response) {
  const partnerId = partnerOr403(req, res);
  if (!partnerId) return null;
  const row = await db.salesAssistedListing.findFirst({
    where: { leadId: Number(req.params.id), salesPartnerId: partnerId },
    select: { id: true, status: true, propertyId: true, ownerUserId: true, ownerAccountOutcome: true, owner: { select: { name: true, fullName: true, phone: true } } },
  });
  if (!row) { res.status(404).json({ error: "No listing has been started for this lead" }); return null; }
  if (row.status === "CANCELLED" || row.status === "PAUSED_OBJECTION") { res.status(409).json({ error: "This listing is paused or withdrawn." }); return null; }
  return { partnerId, row };
}

router.get("/leads/:id/assisted-listing/event-hire", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const found = await eventListingFor(req, res);
  if (!found) return;
  try {
    const property = await loadPropertyForEvents(db, found.row.propertyId);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ...eventHireView(await loadEventHire(db, found.row.propertyId), property), ownerPhone: maskOwnerPhone(found.row.owner?.phone) });
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}));

router.put("/leads/:id/assisted-listing/event-hire", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const found = await eventListingFor(req, res);
  if (!found) return;
  const parsed = z.object({ terms: z.record(z.string(), z.unknown()) }).strict().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the event details." });
  try {
    const { row, property } = await saveEventTerms(db, { propertyId: found.row.propertyId, userId: Number((req as any).user.id), by: "SALES_PARTNER", salesPartnerId: found.partnerId, terms: parsed.data.terms });
    await audit(req as any, "EVENT_HIRE_SAVE", "PROPERTY", null, { status: row.status, by: "SALES_PARTNER" }, found.row.propertyId);
    return res.json({ ...eventHireView(row, property), ownerPhone: maskOwnerPhone(found.row.owner?.phone) });
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}));

/** PUT .../event-hire/photos { urls }: mark the listing photos that show the event space (labels only). */
router.put("/leads/:id/assisted-listing/event-hire/photos", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const found = await eventListingFor(req, res);
  if (!found) return;
  const parsed = z.object({ urls: z.array(z.string().max(2048)).max(60) }).strict().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Choose the photos again." });
  try {
    const current = await loadEventHire(db, found.row.propertyId);
    // Same rule as the terms: once the owner has confirmed, changes are theirs to make.
    if (current && !["DRAFT", "AWAITING_OWNER", "RETURNED"].includes(current.status)) {
      return res.status(409).json({ error: "The owner already confirmed this. Ask them to change it from their account." });
    }
    const property = await setEventSpacePhotos(db, found.row.propertyId, parsed.data.urls);
    await audit(req as any, "EVENT_HIRE_PHOTOS", "PROPERTY", null, { count: parsed.data.urls.length, by: "SALES_PARTNER" }, found.row.propertyId);
    return res.json({ ...eventHireView(current, property), ownerPhone: maskOwnerPhone(found.row.owner?.phone) });
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}));

/** PUT .../event-hire/extra-photos { urls }: event space photos the partner uploaded here (kept off the listing). */
router.put("/leads/:id/assisted-listing/event-hire/extra-photos", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const found = await eventListingFor(req, res);
  if (!found) return;
  const parsed = z.object({ urls: z.array(z.string().max(2048)).max(60) }).strict().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Upload the photos again." });
  try {
    const { row, property } = await setExtraEventPhotos(db, { propertyId: found.row.propertyId, userId: Number((req as any).user.id), by: "SALES_PARTNER", salesPartnerId: found.partnerId, urls: parsed.data.urls });
    await audit(req as any, "EVENT_HIRE_EXTRA_PHOTOS", "PROPERTY", null, { count: parsed.data.urls.length, by: "SALES_PARTNER" }, found.row.propertyId);
    return res.json({ ...eventHireView(row, property), ownerPhone: maskOwnerPhone(found.row.owner?.phone) });
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}));

/** POST .../event-hire/send: texts the owner a link to check the terms and give their consent. */
router.post("/leads/:id/assisted-listing/event-hire/send", blockImpersonated as RequestHandler, limitSalesLeadWrite as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const found = await eventListingFor(req, res);
  if (!found) return;
  if (!found.row.owner?.phone) return res.status(409).json({ error: "The owner has no phone number on NoLSAF." });
  try {
    const { row, property, token } = await sendToOwner(db, { propertyId: found.row.propertyId });
    const link = `${webOrigin()}/event-confirm/${encodeURIComponent(token)}`;
    const profile = await db.salesPartnerProfile.findUnique({ where: { id: found.partnerId }, select: { user: { select: { name: true, fullName: true } } } });
    const partnerName = profile?.user?.fullName || profile?.user?.name || "Your NoLSAF sales partner";
    const first = String(found.row.owner.fullName || found.row.owner.name || "").trim().split(/\s+/)[0] || "there";
    const text = `Habari ${first}. ${partnerName} added event hire for "${property.title || "your property"}" on NoLSAF. Check the guests, hours and prices, then confirm: ${link} If you did not agree to this, say so on the same page.`;
    const existing = found.row.ownerAccountOutcome === "ATTACHED_EXISTING";
    const sms = await sendSms(found.row.owner.phone, text, { bypassEligibilityCheck: !existing, sensitiveContent: true }).catch(() => null);
    const smsSent = Boolean(sms?.success && sms.provider !== "suppressed");
    await audit(req as any, "EVENT_HIRE_SENT_TO_OWNER", "PROPERTY", null, { smsSent }, found.row.propertyId);
    return res.json({ ...eventHireView(row, property), ownerPhone: maskOwnerPhone(found.row.owner.phone), smsSent });
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}));

export default router;

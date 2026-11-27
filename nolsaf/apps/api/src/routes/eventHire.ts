/**
 * "Hire for events" add-on routes, phase E1 (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 4).
 *
 * Owner (signed in, own property only):
 *   GET  /api/owner/properties/:id/event-hire
 *   PUT  /api/owner/properties/:id/event-hire            save the terms (draft)
 *   POST /api/owner/properties/:id/event-hire/submit     consent + send for review
 * Owner by SMS link (no sign-in, token only, partner-filled terms):
 *   GET  /api/public/event-hire-confirm/:token
 *   POST /api/public/event-hire-confirm/:token/confirm   { version, consent }
 *   POST /api/public/event-hire-confirm/:token/object    { note }
 * Admin:
 *   GET  /api/admin/event-hire?status=PENDING
 *   POST /api/admin/event-hire/:ref/decide               { action, version?, reason? }
 *
 * The partner side lives in routes/sales.assistedListing.ts (same library).
 * Admin URLs carry the opaque property reference, never the row id.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitAssistedListingNotice } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";
import { notifyAdmins, notifyOwner } from "../lib/notifications.js";
import { customerRecordReference, matchesCustomerRecordReference } from "../lib/customerBookingReference.js";
import {
  EVENT_STATUSES,
  EventHireError,
  adminDecide,
  confirmByToken,
  eventHireView,
  findByConfirmToken,
  loadEventHire,
  loadPropertyForEvents,
  markLinkOpened,
  objectByToken,
  sanitizeEventTerms,
  saveEventTerms,
  setEventSpacePhotos,
  setExtraEventPhotos,
  submitByOwner,
} from "../lib/eventHire.js";

const db = prisma as any;

export function sendEventHireError(res: Response, error: unknown): boolean {
  if (error instanceof EventHireError) { res.status(error.status).json({ error: error.message, code: error.code }); return true; }
  if ((error as any)?.code === "P2021") { res.status(503).json({ error: "Event hire needs a database update first." }); return true; }
  return false;
}

/** Tells admins once an event hire is waiting for review. Never fails the request. */
export async function announceEventHireSubmitted(row: any, propertyTitle: string | null) {
  try {
    const terms = sanitizeEventTerms(row.terms);
    await notifyAdmins("event_hire_submitted", {
      eventHireId: row.id,
      propertyRef: customerRecordReference("property", row.propertyId),
      propertyTitle,
      capacityStanding: terms.capacityStanding,
      via: row.ownerConsentVia,
      href: "/admin/properties/event-hire",
    });
  } catch {
    /* the review list still shows it */
  }
}

const termsBody = z.object({ terms: z.record(z.string(), z.unknown()) }).strict();
const submitBody = z.object({ version: z.string().regex(/^[a-f0-9]{64}$/), consent: z.literal(true) }).strict();

// ---------------------------------------------------------------------------
// Owner
// ---------------------------------------------------------------------------

export const ownerEventHireRouter = Router();
ownerEventHireRouter.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler);

async function ownedProperty(req: AuthedRequest, res: Response): Promise<number | null> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: "Invalid property" }); return null; }
  const owned = await db.property.findFirst({ where: { id, ownerId: req.user!.id }, select: { id: true } });
  if (!owned) { res.status(404).json({ error: "Property not found" }); return null; }
  return id;
}

ownerEventHireRouter.get("/:id/event-hire", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = await ownedProperty(req, res);
  if (!id) return;
  try {
    const property = await loadPropertyForEvents(db, id);
    res.setHeader("Cache-Control", "no-store");
    return res.json(eventHireView(await loadEventHire(db, id), property));
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

ownerEventHireRouter.put("/:id/event-hire", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = await ownedProperty(req, res);
  if (!id) return;
  const parsed = termsBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the event details." });
  try {
    const { row, property } = await saveEventTerms(db, { propertyId: id, userId: req.user!.id, by: "OWNER", terms: parsed.data.terms });
    await audit(req as any, "EVENT_HIRE_SAVE", "PROPERTY", null, { status: row.status, by: "OWNER" }, id);
    return res.json(eventHireView(row, property));
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

const photosBody = z.object({ urls: z.array(z.string().max(2048)).max(60) }).strict();

/** PUT .../event-hire/photos { urls }: which listing photos show the event space. */
ownerEventHireRouter.put("/:id/event-hire/photos", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = await ownedProperty(req, res);
  if (!id) return;
  const parsed = photosBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Choose the photos again." });
  try {
    const property = await setEventSpacePhotos(db, id, parsed.data.urls);
    await audit(req as any, "EVENT_HIRE_PHOTOS", "PROPERTY", null, { count: parsed.data.urls.length }, id);
    return res.json(eventHireView(await loadEventHire(db, id), property));
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

/** PUT .../event-hire/extra-photos { urls }: event space photos uploaded here (kept off the listing). */
ownerEventHireRouter.put("/:id/event-hire/extra-photos", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = await ownedProperty(req, res);
  if (!id) return;
  const parsed = photosBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Upload the photos again." });
  try {
    const { row, property } = await setExtraEventPhotos(db, { propertyId: id, userId: req.user!.id, by: "OWNER", urls: parsed.data.urls });
    await audit(req as any, "EVENT_HIRE_EXTRA_PHOTOS", "PROPERTY", null, { count: parsed.data.urls.length }, id);
    return res.json(eventHireView(row, property));
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

// Consent is the owner's own act: never by an admin impersonating them.
ownerEventHireRouter.post("/:id/event-hire/submit", blockImpersonated as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = await ownedProperty(req, res);
  if (!id) return;
  const parsed = submitBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Tick the box to confirm that events are allowed in this space." });
  try {
    const { row, changed } = await submitByOwner(db, { propertyId: id, version: parsed.data.version, consent: true });
    const property = await loadPropertyForEvents(db, id);
    if (changed) {
      await audit(req as any, "EVENT_HIRE_SUBMIT", "PROPERTY", null, { via: "APP", fingerprint: row.termsFingerprint }, id);
      await announceEventHireSubmitted(row, property.title);
    }
    return res.json(eventHireView(row, property));
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

// ---------------------------------------------------------------------------
// Owner by SMS link
// ---------------------------------------------------------------------------

export const publicEventHireConfirmRouter = Router();
const LINK_GONE = { error: "This link is not valid any more. Ask your sales partner to send it again, or call NoLSAF support." };

publicEventHireConfirmRouter.get("/:token", limitAssistedListingNotice as any, asyncHandler(async (req, res: Response) => {
  const row = await findByConfirmToken(db, String(req.params.token || "")).catch((e: any) => { if (e?.code === "P2021") return null; throw e; });
  if (!row) return res.status(404).json(LINK_GONE);
  const property = await db.property.findUnique({ where: { id: row.propertyId }, select: { id: true, title: true, status: true, photos: true, photoAreas: true } });
  const partner = row.salesPartnerId
    ? await db.salesPartnerProfile.findUnique({ where: { id: row.salesPartnerId }, select: { agentCode: true, user: { select: { name: true, fullName: true } } } })
    : null;
  if (row.status === "AWAITING_OWNER") await markLinkOpened(db, row);
  const view = eventHireView(row, property);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  return res.json({
    status: view.status,
    terms: view.terms,
    version: view.version,
    ownerFeePercent: view.ownerFeePercent,
    clientFeePercent: view.clientFeePercent,
    propertyTitle: view.propertyTitle,
    partnerName: partner?.user?.fullName || partner?.user?.name || null,
    partnerCode: partner?.agentCode ?? null,
    confirmedAt: view.consentCurrent ? view.ownerConsentAt : null,
  });
}) as RequestHandler);

publicEventHireConfirmRouter.post("/:token/confirm", limitAssistedListingNotice as any, asyncHandler(async (req, res: Response) => {
  const parsed = submitBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Tick the box to confirm that events are allowed in this space." });
  try {
    const { row, changed } = await confirmByToken(db, String(req.params.token || ""), parsed.data.version, true);
    if (changed) {
      const property = await db.property.findUnique({ where: { id: row.propertyId }, select: { title: true } });
      await audit(req as any, "EVENT_HIRE_SUBMIT", "PROPERTY", null, { via: "SMS_LINK", fingerprint: row.termsFingerprint }, row.propertyId);
      await announceEventHireSubmitted(row, property?.title ?? null);
    }
    return res.json({ ok: true });
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

publicEventHireConfirmRouter.post("/:token/object", limitAssistedListingNotice as any, asyncHandler(async (req, res: Response) => {
  const parsed = z.object({ note: z.string().trim().min(3).max(500) }).strict().safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Tell us what is wrong (under 500 characters)." });
  try {
    const row = await objectByToken(db, String(req.params.token || ""), parsed.data.note);
    await audit(req as any, "EVENT_HIRE_OWNER_OBJECTED", "PROPERTY", null, { note: row.ownerObjectionNote }, row.propertyId);
    return res.json({ ok: true });
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const adminEventHireRouter = Router();
adminEventHireRouter.use(requireAuth as RequestHandler, requireAdmin as RequestHandler);

adminEventHireRouter.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const status = String(req.query.status || "PENDING").toUpperCase();
  const where = (EVENT_STATUSES as readonly string[]).includes(status) ? { status } : {};
  try {
    const rows = await db.propertyEventHire.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200 });
    const properties = rows.length
      ? await db.property.findMany({
          where: { id: { in: rows.map((r: any) => r.propertyId) } },
          select: { id: true, title: true, status: true, photos: true, photoAreas: true, regionName: true, district: true, owner: { select: { name: true, fullName: true, phone: true } } },
        })
      : [];
    const byId = new Map(properties.map((p: any) => [p.id, p]));
    const counts = await db.propertyEventHire.groupBy({ by: ["status"], _count: { _all: true } });
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      counts: Object.fromEntries(counts.map((c: any) => [c.status, c._count._all])),
      items: rows.map((row: any) => {
        const p: any = byId.get(row.propertyId);
        return {
          ref: customerRecordReference("property", row.propertyId),
          ...eventHireView(row, p),
          area: [p?.district, p?.regionName].filter(Boolean).join(", ") || null,
          ownerName: p?.owner?.fullName || p?.owner?.name || null,
          ownerPhone: p?.owner?.phone ?? null,
          updatedAt: row.updatedAt,
        };
      }),
    });
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

const decideBody = z.object({
  action: z.enum(["APPROVE", "RETURN", "PAUSE", "RESUME"]),
  version: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  reason: z.string().trim().max(500).optional(),
}).strict();

adminEventHireRouter.post("/:ref/decide", blockImpersonated as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = decideBody.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the decision." });
  const ref = String(req.params.ref || "");
  try {
    const candidates = await db.propertyEventHire.findMany({ select: { propertyId: true }, take: 5000 });
    const match = candidates.find((c: any) => matchesCustomerRecordReference(ref, "property", c.propertyId));
    if (!match) return res.status(404).json({ error: "Not found" });
    const row = await adminDecide(db, { propertyId: match.propertyId, adminId: req.user!.id, ...parsed.data });
    const property = await db.property.findUnique({ where: { id: row.propertyId }, select: { id: true, title: true, status: true, ownerId: true, photos: true, photoAreas: true } });
    await audit(req as any, `EVENT_HIRE_${parsed.data.action}`, "PROPERTY", null, { status: row.status, reason: parsed.data.reason ?? null }, row.propertyId);
    if (property?.ownerId && (parsed.data.action === "APPROVE" || parsed.data.action === "RETURN")) {
      await notifyOwner(property.ownerId, parsed.data.action === "APPROVE" ? "event_hire_approved" : "event_hire_returned", {
        propertyId: property.id,
        propertyTitle: property.title,
        reason: row.returnReason,
      }).catch(() => undefined);
    }
    return res.json({ ref, ...eventHireView(row, property) });
  } catch (error) {
    if (sendEventHireError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

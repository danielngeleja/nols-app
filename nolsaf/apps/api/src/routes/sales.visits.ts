/**
 * Visit mode for sales partners: check in at a lead's property.
 *
 * POST /api/sales/leads/:id/visits  (multipart: photo + position fields)
 * GET  /api/sales/leads/:id/visits
 *
 * The server clock decides when the visit was recorded; the device time is
 * kept only to accept check-ins saved offline (up to 48 hours). The photo is
 * uploaded through the API to private storage and hashed, so it can be
 * compared with every other visit. Warning signs are worked out here, not on
 * the phone, and stored with the visit.
 */
import { createHash, createHmac } from "node:crypto";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
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
import { LEAD_PROTECTION_DAYS } from "../lib/salesPartner.js";
import { sanitizeText } from "../lib/sanitize.js";
import { audit } from "../lib/audit.js";
import { publicLinkSigningSecret } from "../lib/publicLinkSecrets.js";
import { serializeVisit, visitSelect } from "../lib/salesVisitView.js";
import {
  MET_WITH,
  VISIT_RULES,
  evaluateVisit,
  visitActivityText,
  visitTimingError,
} from "../lib/salesLeadVisits.js";
import { deleteVisitPhoto, uploadVisitPhoto } from "../lib/salesVisitPhotos.js";
import { teamLeadUserFor } from "../lib/salesTeam.js";
import { resolvePartnerLead } from "../lib/salesReference.js";
import { notifyUser } from "../lib/notifications.js";

const router = Router();
const db = prisma as any;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
/** Visits are progress on an open lead; a finished lead takes no more. */
const CLOSED_FOR_VISITS = ["CONVERTED", "LOST", "CANCELLED"];

router.use(
  requireAuth as RequestHandler,
  requireWorkspaceAccess("SALES"),
  requireActivePartnerContract,
);

// Page addresses carry an opaque lead reference (sl_…), never a row id. It is
// resolved within this partner's own leads before any handler runs.
router.param("id", (async (req: SalesAuthedRequest, res: Response, next: (err?: any) => void, value: string) => {
  try {
    // A support session's write is refused by blockImpersonated on the route
    // itself; let it get there before any lookup.
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

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: 1 } });
function parsePhoto(req: Request, res: Response, next: NextFunction) {
  photoUpload.single("photo")(req, res, (error: any) => {
    if (!error) return next();
    if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "The photo is too large. The limit is 8 MB." });
    return res.status(400).json({ error: "The photo could not be read." });
  });
}

const timeField = z.union([z.coerce.number().int().positive(), z.string().datetime()]).transform((value) => new Date(value));
const visitSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracy: z.coerce.number().min(0).max(100_000),
  positionAt: timeField.optional(),
  capturedAt: timeField,
  metWith: z.enum(MET_WITH),
  note: z.string().trim().max(500).transform(sanitizeText).optional(),
});
const idSchema = z.object({ id: z.coerce.number().int().positive() });

function ipHash(ip: string | undefined): string | null {
  if (!ip) return null;
  try {
    return createHmac("sha256", publicLinkSigningSecret("sales_visit_ip_secret_missing")).update(`sales-visit-ip:${ip}`).digest("hex");
  } catch {
    return null;
  }
}

const num = (value: unknown) => (value == null ? null : Number(value));

/** GET /api/sales/leads/:id/visits */
router.get("/leads/:id/visits", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const params = idSchema.safeParse(req.params);
  const partnerId = partnerIdFor(req);
  if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
  if (!params.success) return res.status(404).json({ error: "Lead not found" });
  const lead = await db.salesLead.findFirst({ where: { id: params.data.id, salesPartnerId: partnerId }, select: { id: true } });
  if (!lead) return res.status(404).json({ error: "Lead not found" });
  const visits = await db.salesLeadVisit.findMany({
    where: { leadId: lead.id, salesPartnerId: partnerId },
    orderBy: { receivedAt: "desc" },
    take: 100,
    select: visitSelect,
  });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ visits: visits.map(serializeVisit) });
}));

/** POST /api/sales/leads/:id/visits */
router.post(
  "/leads/:id/visits",
  blockImpersonated as RequestHandler,
  limitSalesLeadWrite as any,
  parsePhoto,
  asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
    const params = idSchema.safeParse(req.params);
    const parsed = visitSchema.safeParse(req.body ?? {});
    const partnerId = partnerIdFor(req);
    if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
    if (!params.success) return res.status(404).json({ error: "Lead not found" });
    if (!parsed.success) return res.status(400).json({ error: "Location, time and who you met are required." });
    const file = (req as any).file as { buffer: Buffer; size: number; mimetype: string } | undefined;
    if (!file?.buffer?.length) return res.status(400).json({ error: "Take a photo of the property to check in." });
    if (!PHOTO_TYPES.has(String(file.mimetype).toLowerCase())) return res.status(400).json({ error: "The photo must be a JPEG, PNG, WebP or HEIC image." });

    const input = parsed.data;
    const receivedAt = new Date();
    const timing = visitTimingError(input.capturedAt, receivedAt);
    if (timing === "CAPTURED_IN_FUTURE") return res.status(400).json({ error: "Your phone's clock is ahead. Correct the time and try again." });
    if (timing === "TOO_OLD") return res.status(400).json({ error: "This check-in is more than 48 hours old and can no longer be sent." });

    const lead = await db.salesLead.findFirst({
      where: { id: params.data.id, salesPartnerId: partnerId },
      select: { id: true, status: true, propertyName: true, convertedProperty: { select: { latitude: true, longitude: true } } },
    });
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (CLOSED_FOR_VISITS.includes(lead.status)) return res.status(409).json({ error: "This lead is closed and takes no more visits." });

    // Where the property is: its own pin once converted, else the lead's first check-in.
    let referenceSource: "PROPERTY" | "FIRST_VISIT" | "NONE" = "NONE";
    let reference: { lat: number; lng: number } | null = null;
    const pinLat = num(lead.convertedProperty?.latitude);
    const pinLng = num(lead.convertedProperty?.longitude);
    if (pinLat != null && pinLng != null) {
      referenceSource = "PROPERTY";
      reference = { lat: pinLat, lng: pinLng };
    } else {
      const first = await db.salesLeadVisit.findFirst({
        where: { leadId: lead.id },
        orderBy: { receivedAt: "asc" },
        select: { latitude: true, longitude: true },
      });
      if (first) {
        referenceSource = "FIRST_VISIT";
        reference = { lat: Number(first.latitude), lng: Number(first.longitude) };
      }
    }

    const photoHash = createHash("sha256").update(file.buffer).digest("hex");
    const [previous, reused, recentCount] = await Promise.all([
      db.salesLeadVisit.findFirst({
        where: { salesPartnerId: partnerId },
        orderBy: { capturedAt: "desc" },
        select: { latitude: true, longitude: true, capturedAt: true },
      }),
      db.salesLeadVisit.count({ where: { photoHash } }),
      db.salesLeadVisit.count({
        where: { salesPartnerId: partnerId, receivedAt: { gte: new Date(receivedAt.getTime() - VISIT_RULES.burstWindowMs) } },
      }),
    ]);

    const outcome = evaluateVisit({
      position: { lat: input.latitude, lng: input.longitude },
      accuracyMeters: input.accuracy,
      positionAt: input.positionAt ?? null,
      capturedAt: input.capturedAt,
      receivedAt,
      reference,
      previousVisit: previous ? { lat: Number(previous.latitude), lng: Number(previous.longitude), capturedAt: previous.capturedAt } : null,
      photoSeenBefore: reused > 0,
      recentVisitCount: recentCount,
    });

    let photoPublicId: string;
    try {
      photoPublicId = await uploadVisitPhoto(file.buffer, partnerId);
    } catch {
      return res.status(502).json({ error: "The photo could not be saved. Check your connection and try again." });
    }

    const accuracyMeters = Math.round(input.accuracy);
    try {
      const visit = await db.$transaction(async (tx: any) => {
        const created = await tx.salesLeadVisit.create({
          data: {
            leadId: lead.id,
            salesPartnerId: partnerId,
            createdById: req.user!.id,
            status: outcome.status,
            latitude: input.latitude,
            longitude: input.longitude,
            accuracyMeters,
            positionAt: input.positionAt ?? null,
            capturedAt: input.capturedAt,
            receivedAt,
            metWith: input.metWith,
            note: input.note || null,
            photoPublicId,
            photoHash,
            photoBytes: file.size,
            photoMime: String(file.mimetype).toLowerCase().slice(0, 40),
            referenceSource,
            referenceLatitude: reference?.lat ?? null,
            referenceLongitude: reference?.lng ?? null,
            distanceMeters: outcome.distanceMeters,
            flags: outcome.flags.length ? outcome.flags : null,
            userAgent: (req.get("user-agent") || "").slice(0, 255) || null,
            ipHash: ipHash(req.ip),
          },
          select: visitSelect,
        });
        await tx.salesLeadActivity.create({
          data: {
            leadId: lead.id,
            createdById: req.user!.id,
            type: "VISIT",
            description: visitActivityText({
              status: outcome.status,
              distanceMeters: outcome.distanceMeters,
              referenceSource,
              metWith: input.metWith,
              note: input.note,
            }),
          },
        });
        // Only a clean visit holds the claim open: a flagged one waits for review.
        if (outcome.status === "VERIFIED") {
          await tx.salesLead.update({
            where: { id: lead.id },
            data: { protectionExpiresAt: new Date(receivedAt.getTime() + LEAD_PROTECTION_DAYS * DAY_MS) },
          });
        }
        return created;
      });
      await audit(req as any, "SALES_LEAD_VISIT_CREATE", "SALES_LEAD", null, {
        visitId: visit.id,
        status: outcome.status,
        flags: outcome.flags,
        distanceMeters: outcome.distanceMeters,
        referenceSource,
      }, lead.id);
      if (outcome.status === "FLAGGED") {
        // The member's team lead hears about it, so coaching happens before review.
        const leadUserId = await teamLeadUserFor(db, partnerId).catch(() => null);
        if (leadUserId && leadUserId !== req.user!.id) {
          await notifyUser(leadUserId, "sales_team_visit_flagged", { memberName: visit.createdBy?.fullName || visit.createdBy?.name, propertyName: lead.propertyName }).catch(() => undefined);
        }
      }
      return res.status(201).json({ visit: serializeVisit(visit) });
    } catch (error) {
      await deleteVisitPhoto(photoPublicId);
      throw error;
    }
  }),
);

export default router;

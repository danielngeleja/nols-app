/**
 * Public "Request a NoLSAF visit" for property owners (docs/SALES_VISIT_REQUESTS.md).
 *
 * GET  /api/public/visit-requests/regions   the regions an owner can pick
 * POST /api/public/visit-requests           save a request, answer with its VR- number
 *
 * No login. Nothing here lists, names or contacts a Sales Partner: NoLSAF
 * routes the request. A hidden form field catches simple bots (they get a
 * normal-looking answer and nothing is saved), a per-IP limit caps abuse, and
 * a repeat from the same phone returns the first request instead of a new one.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { sanitizeText } from "../lib/sanitize.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import { hashResponseIp } from "../lib/salesOwnerConfirmation.js";
import {
  createVisitRequest,
  isMissingTable,
  newVisitRef,
  publicRegions,
  VISIT_INTERESTS,
  VisitRequestError,
} from "../lib/salesVisitRequests.js";

const router = Router();
const db = prisma as any;

const submitLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests. Please wait a few minutes and try again." },
});
const readLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });

const UNAVAILABLE = { ok: false, error: "Visit requests are not open yet. Please contact NoLSAF support." };

const text = (min: number, max: number) => z.string().trim().min(min).max(max).transform((v) => sanitizeText(v).trim());
const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.literal(""), z.null()]).optional().transform((v) => {
    const clean = v ? sanitizeText(v).trim() : "";
    return clean || null;
  });

const submitSchema = z.object({
  contactName: text(2, 160),
  contactPhone: z.string().trim().min(9).max(40).regex(/^[+\d\s()-]+$/, "Enter a phone number with digits only"),
  contactEmail: z.union([z.string().trim().email().max(190), z.literal(""), z.null()]).optional().transform((v) => (v ? v.toLowerCase() : null)),
  propertyName: text(2, 200),
  propertyType: optionalText(60),
  estimatedRooms: z.union([z.coerce.number().int().min(1).max(5000), z.literal(""), z.null()]).optional().transform((v) => (typeof v === "number" ? v : null)),
  regionCode: z.union([z.string().trim().regex(/^[A-Za-z]{2,8}$/), z.literal(""), z.null()]).optional().transform((v) => (v ? v.toUpperCase() : null)),
  location: text(2, 200),
  interest: z.enum(VISIT_INTERESTS),
  message: optionalText(1000),
  /** The owner agrees NoLSAF and one Sales Partner may contact them. */
  consent: z.literal(true, { message: "Please agree that NoLSAF may contact you about this visit." }),
  /** Hidden from people; a filled value means a bot. */
  website: z.string().max(200).optional(),
});

router.get("/regions", readLimiter, async (_req: Request, res: Response) => {
  try {
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({ ok: true, regions: await publicRegions(db) });
  } catch (error: any) {
    if (isMissingTable(error)) return res.json({ ok: true, regions: [] });
    console.error("[visit-requests] regions failed", error?.message || error);
    return res.status(500).json({ ok: false, error: "Could not load regions." });
  }
});

router.post("/", submitLimiter, async (req: Request, res: Response) => {
  res.setHeader("Cache-Control", "no-store");
  const parsed = submitSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message || "Please check the form and try again." });
  }
  const { consent: _consent, website, ...input } = parsed.data;
  // A bot gets an answer that looks real, so it learns nothing.
  if (website && website.trim()) return res.status(201).json({ ok: true, ref: newVisitRef() });

  try {
    const outcome = await createVisitRequest(db, input, { ipHash: hashResponseIp(req.ip) });
    if (outcome.created) {
      const region = outcome.region ?? null;
      const leadUserId = region?.leadPartnerId
        ? (await db.salesPartnerProfile.findUnique({ where: { id: region.leadPartnerId }, select: { userId: true, status: true } }).catch(() => null))
        : null;
      const regionLead = leadUserId && leadUserId.status === "ACTIVE" ? leadUserId.userId : null;
      await notifyAdmins("sales_visit_request_new", {
        ref: outcome.request.publicRef,
        contactName: input.contactName,
        propertyName: input.propertyName,
        location: input.location,
        regionName: region?.name ?? null,
        regionLead: Boolean(regionLead),
        link: "/admin/sales/visit-requests",
      }).catch(() => undefined);
      if (regionLead) {
        await notifyUser(regionLead, "sales_region_visit_request", {
          ref: outcome.request.publicRef,
          propertyName: input.propertyName,
          location: input.location,
          actionPath: "/sales/region",
        }).catch(() => undefined);
      }
    }
    return res.status(outcome.created ? 201 : 200).json({ ok: true, ref: outcome.request.publicRef, repeat: !outcome.created });
  } catch (error: any) {
    if (error instanceof VisitRequestError) return res.status(error.status).json({ ok: false, error: error.message });
    if (isMissingTable(error)) return res.status(503).json(UNAVAILABLE);
    console.error("[visit-requests] submit failed", error?.message || error);
    return res.status(500).json({ ok: false, error: "Could not save your request. Please try again." });
  }
});

export default router;

/**
 * Sales Partner side of long-stay rentals (docs/LONG_STAY_RENTALS.md section 13).
 *
 * GET  /api/sales/long-stay/inspections              homes NoLSAF asked me to inspect
 * GET  /api/sales/long-stay/inspections/queue        inspection work alongside the lead pipeline
 * POST /api/sales/long-stay/inspections/:ref/report  multipart: three photos, position, checklist, findings, recommendation, note
 * GET  /api/sales/long-stay/visits                   tenants I accompany to view a home
 *
 * A partner only ever sees inspections assigned to them. Photos are uploaded
 * by the API to private storage and hashed; the distance from the listing's
 * pin and the warning signs are worked out on the server. A support session
 * can read but never report.
 */
import { createHash } from "node:crypto";
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import multer from "multer";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { partnerIdFor, requireActivePartnerContract, requireWorkspaceAccess, type SalesAuthedRequest } from "../middleware/salesWorkspace.js";
import { limitSalesLeadRead, limitSalesLeadWrite } from "../middleware/rateLimit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { audit } from "../lib/audit.js";
import { notifyAdmins } from "../lib/notifications.js";
import { deleteVisitPhoto, uploadVisitPhoto } from "../lib/salesVisitPhotos.js";
import { CHECKLIST, checkReport, INSPECTION_PHOTO_COUNT, INSPECTION_PHOTO_SLOTS, InspectionError, isInspectionRef, reportSchema, submitInspection } from "../lib/longStay/inspection.js";

const router = Router();
const db = prisma as any;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"), requireActivePartnerContract);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_PHOTO_BYTES, files: INSPECTION_PHOTO_COUNT } });
function parsePhotos(req: Request, res: Response, next: NextFunction) {
  upload.array("photos", INSPECTION_PHOTO_COUNT)(req, res, (error: any) => {
    if (!error) return next();
    if (error?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "A photo is too large. The limit is 8 MB each." });
    if (error?.code === "LIMIT_FILE_COUNT" || error?.code === "LIMIT_UNEXPECTED_FILE") return res.status(400).json({ error: `Send exactly ${INSPECTION_PHOTO_COUNT} photos.` });
    return res.status(400).json({ error: "The photos could not be read." });
  });
}

const day = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : null);

router.get("/long-stay/inspections/queue", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerIdFor(req);
  if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
  const assigned = { salesPartnerId: partnerId, status: "ASSIGNED" };
  const [toVisit, inReview, upcoming] = await Promise.all([
    db.longStayInspection.count({ where: assigned }),
    db.longStayInspection.count({ where: { salesPartnerId: partnerId, status: "SUBMITTED" } }),
    db.longStayInspection.findMany({
      where: assigned,
      orderBy: [{ dueBy: "asc" }, { id: "asc" }],
      take: 3,
      select: { publicRef: true, dueBy: true, reviewedAt: true, property: { select: { title: true, district: true, regionName: true } } },
    }),
  ]);
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    toVisit,
    inReview,
    upcoming: upcoming.map((item: any) => ({
      ref: item.publicRef,
      title: item.property?.title ?? null,
      area: [item.property?.district, item.property?.regionName].filter(Boolean).join(", "),
      dueBy: item.dueBy,
      redo: Boolean(item.reviewedAt),
    })),
  });
}));

router.get("/long-stay/inspections", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerIdFor(req);
  if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
  const ref = req.query.inspection;
  const since = new Date(Date.now() - 60 * 86_400_000);
  const include = {
    property: {
      select: {
        title: true, district: true, regionName: true, latitude: true, longitude: true, type: true,
        owner: { select: { name: true, fullName: true, phone: true } },
        longStayListing: { select: { monthlyRent: true, currency: true, furnished: true, utilities: true } },
      },
    },
  };
  const rows = await db.longStayInspection.findMany({
    where: { salesPartnerId: partnerId, OR: [{ status: { in: ["ASSIGNED", "SUBMITTED"] } }, { status: { in: ["PASSED", "FAILED"] }, reviewedAt: { gte: since } }] },
    orderBy: [{ status: "asc" }, { dueBy: "asc" }],
    take: 100,
    include,
  });
  if (isInspectionRef(ref) && !rows.some((row: any) => row.publicRef === ref)) {
    const focused = await db.longStayInspection.findFirst({
      where: { salesPartnerId: partnerId, publicRef: ref, status: { in: ["ASSIGNED", "SUBMITTED", "PASSED", "FAILED"] } },
      include,
    });
    if (focused) rows.unshift(focused);
  }
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    checklist: CHECKLIST,
    minPhotos: INSPECTION_PHOTO_COUNT,
    maxPhotos: INSPECTION_PHOTO_COUNT,
    photoSlots: INSPECTION_PHOTO_SLOTS,
    items: rows.map((r: any) => ({
      ref: r.publicRef,
      status: r.status,
      reason: r.reason,
      assignedAt: r.assignedAt,
      dueBy: r.dueBy,
      home: {
        title: r.property?.title ?? null,
        type: r.property?.type ?? null,
        area: [r.property?.district, r.property?.regionName].filter(Boolean).join(", "),
        // The partner goes to the home, so they get the exact pin.
        pin: r.status === "ASSIGNED" && r.property?.latitude != null && r.property?.longitude != null ? { lat: Number(r.property.latitude), lng: Number(r.property.longitude) } : null,
        listing: r.property?.longStayListing ? {
          monthlyRent: Number(r.property.longStayListing.monthlyRent),
          currency: r.property.longStayListing.currency,
          furnished: r.property.longStayListing.furnished,
          utilities: r.property.longStayListing.utilities,
        } : null,
      },
      landlord: r.status === "ASSIGNED"
        ? { name: r.property?.owner?.fullName || r.property?.owner?.name || null, phone: r.property?.owner?.phone ?? null }
        : { name: null, phone: null },
      reviewNote: r.status === "SUBMITTED" ? null : r.reviewNote,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      feeAmount: r.feeAmount != null ? Number(r.feeAmount) : null,
      validUntil: day(r.validUntil),
    })),
  });
}));

router.post(
  "/long-stay/inspections/:ref/report",
  blockImpersonated as RequestHandler,
  limitSalesLeadWrite as any,
  parsePhotos,
  asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
    const partnerId = partnerIdFor(req);
    if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
    const ref = String(req.params.ref);
    if (!isInspectionRef(ref)) return res.status(404).json({ error: "Not found" });
    const inspection = await db.longStayInspection.findFirst({ where: { publicRef: ref, salesPartnerId: partnerId } });
    if (!inspection) return res.status(404).json({ error: "Not found" });
    if (inspection.status !== "ASSIGNED") return res.status(409).json({ error: "This inspection is no longer waiting for a report." });

    const body = req.body ?? {};
    let checklist: unknown;
    let findings: unknown;
    try {
      checklist = JSON.parse(String(body.checklist ?? "null"));
      findings = JSON.parse(String(body.findings ?? "{}"));
    } catch {
      return res.status(400).json({ error: "The checklist or findings could not be read." });
    }
    const parsed = reportSchema.safeParse({ ...body, checklist, findings, note: sanitizeText(String(body.note || "")) });
    if (!parsed.success) {
      const invalidFindings = parsed.error.issues.some(({ path }) => path[0] === "findings");
      return res.status(400).json({ error: invalidFindings
        ? "Findings need a short note and, if linked, one of the three inspection photos."
        : "Location, every checklist item, your recommendation and a note (10 characters or more) are required." });
    }

    const files = ((req as any).files ?? []) as Array<{ buffer: Buffer; size: number; mimetype: string }>;
    if (files.length !== INSPECTION_PHOTO_COUNT) return res.status(400).json({ error: `Take exactly ${INSPECTION_PHOTO_COUNT} photos at the home.` });
    if (files.some((f) => !PHOTO_TYPES.has(String(f.mimetype).toLowerCase()))) return res.status(400).json({ error: "Photos must be JPEG, PNG, WebP or HEIC images." });

    const uploaded: Array<{ publicId: string; hash: string; bytes: number }> = [];
    let outcome: Awaited<ReturnType<typeof submitInspection>>;
    try {
      checkReport(parsed.data);
      for (const file of files) {
        const hash = createHash("sha256").update(file.buffer).digest("hex");
        const publicId = await uploadVisitPhoto(file.buffer, partnerId);
        uploaded.push({ publicId, hash, bytes: file.size });
      }
      outcome = await submitInspection(db, inspection, partnerId, parsed.data, uploaded);
    } catch (error) {
      await Promise.all(uploaded.map((p) => deleteVisitPhoto(p.publicId)));
      if (error instanceof InspectionError) return res.status(error.status).json({ error: error.message });
      if ((error as any)?.message === "CLOUDINARY_NOT_CONFIGURED") return res.status(503).json({ error: "Photo storage is unavailable. Try again later." });
      throw error;
    }
    await audit(req as any, "LONG_STAY_INSPECTION_REPORT", "PROPERTY", null, { ref, recommendation: parsed.data.recommendation, ...outcome }, inspection.propertyId);
    const property = await db.property.findUnique({ where: { id: inspection.propertyId }, select: { title: true } }).catch(() => null);
    await notifyAdmins("long_stay_inspection_report", { inspectionId: inspection.id, inspectionRef: ref, propertyTitle: property?.title ?? null, recommendation: parsed.data.recommendation, flags: outcome.flags });
    return res.status(201).json({ ok: true, status: "SUBMITTED", distanceMeters: outcome.distanceMeters, flags: outcome.flags });
  }),
);

router.get("/long-stay/visits", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerIdFor(req);
  if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
  const rows = await db.longStayEnquiry.findMany({
    where: { salesPartnerId: partnerId, kind: "VISIT", visitAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    orderBy: { visitAt: "asc" },
    take: 50,
    include: {
      property: { select: { title: true, district: true, regionName: true, latitude: true, longitude: true } },
      user: { select: { name: true, fullName: true, phone: true } },
    },
  });
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    items: rows.map((r: any) => ({
      ref: r.publicRef,
      visitAt: r.visitAt,
      status: r.status,
      note: r.answer,
      home: { title: r.property?.title ?? null, area: [r.property?.district, r.property?.regionName].filter(Boolean).join(", "), pin: r.property?.latitude != null ? { lat: Number(r.property.latitude), lng: Number(r.property.longitude) } : null },
      tenant: { name: r.user?.fullName || r.user?.name || null, phone: r.user?.phone ?? null },
    })),
  });
}));

export default router;

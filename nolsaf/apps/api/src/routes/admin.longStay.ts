/**
 * Admin side of long-stay rentals (docs/LONG_STAY_RENTALS.md, decision 7).
 *
 * GET  /api/admin/long-stay/landlords/:ownerId          the landlord's switch and long-stay listings
 * POST /api/admin/long-stay/landlords/:ownerId          ENABLE | DISABLE | PAUSE | RESUME
 * GET  /api/admin/long-stay/properties/:propertyId      a listing's monthly terms, fee preview, living rules and its
 *                                                       on-site inspections (partner, GPS, checklist, photos) for moderation
 * GET  /api/admin/long-stay/properties/:propertyId/lease-preview  the lease a tenant would sign, with sample names
 * GET  /api/admin/long-stay/tenants?status=&q=&idType=&country=
 *                                                       ID checks (PENDING, APPROVED, EXPIRING, REJECTED, BARRED) with counts
 * GET  /api/admin/long-stay/tenants/:id/document?side=  front | back | selfie, via a 5-minute signed link (audited)
 * POST /api/admin/long-stay/tenants/:id/review          APPROVE (every photo opened, name and face confirmed) | REJECT (reason), once
 * POST /api/admin/long-stay/tenants/:id/bar             BAR (reason required) | UNBAR
 * GET  /api/admin/long-stay/inspections?view=           todo | review | passed | failed (Sales Partner inspections)
 * POST /api/admin/long-stay/inspections/:ref/assign     { partnerCode }
 * GET  /api/admin/long-stay/inspections/:ref/photos/:n  an on-site photo (signed link, audited)
 * POST /api/admin/long-stay/inspections/:ref/review     PASS | FAIL (partner earns the flat fee) | REDO
 * POST /api/admin/long-stay/properties/:id/inspection   open an inspection by hand
 * GET  /api/admin/long-stay/enquiries?view=             open | answered | closed (Ask NoLSAF)
 * POST /api/admin/long-stay/enquiries/:ref/answer       { answer, visitAt?, partnerCode? }
 * POST /api/admin/long-stay/enquiries/:ref/close
 *
 * Every change is audited with the acting admin. Pausing or disabling stops
 * new long-stay listings, submits and approvals at once (each re-checks it);
 * tenancies already signed are not touched.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { hasWorkspaceAccess, loadSalesPartnerContext } from "../middleware/salesWorkspace.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { audit, auditOrThrow } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { computeLongStayQuote } from "../lib/longStay/fees.js";
import { currentLongStayRates, landlordGate, rentForTerm, rowToTerms, todayInEat } from "../lib/longStay/listing.js";
import { assignInspection, CHECKLIST, endInspectionAfterDispute, InspectionError, inspectionCurrent, isInspectionRef, latestPassedInspection, longStayInspectionRequiredForApproval, requestInspection, reviewInspection, reviewSchema as inspectionReviewSchema } from "../lib/longStay/inspection.js";
import { answerSchema as enquiryAnswerSchema, isEnquiryRef } from "../lib/longStay/enquiry.js";
import { signedVisitPhotoUrl } from "../lib/salesVisitPhotos.js";
import { createUserNotification, notifyAdmins, notifyOwner, notifyUser, publishUserNotification } from "../lib/notifications.js";
import { CONTRACT_EARNING_STATUSES, isContractEarning } from "../lib/salesPartner.js";
import { isTravellerDocumentPublicId, signedTravellerDocumentUrl } from "../lib/travellerDocuments.js";
import { isTenancyRef, moveTenancy, TenancyError } from "../lib/longStay/tenancyService.js";
import { approveTenancyPayout, landlordPayoutAccount, landlordPayoutOf, recordManualPayout } from "../lib/longStay/payout.js";
import { finishMoveIn } from "../lib/longStay/moveIn.js";
import { claimCloseSchema, claimSchema, closeClaim, openClaim } from "../lib/longStay/claims.js";
import { syncLongStayRevenue } from "../lib/revenueRecognition.js";
import { addDaysToDay, ageOn, dayOf, eatToday, ID_TYPES, idExpiring, isIsoCountry, nameAgreement, RENEW_WINDOW_DAYS, requiredPhotoSides } from "../lib/longStay/tenantIdentity.js";
import { requestDisbursement } from "../services/payouts/ledger.js";
import { houseRulesOf } from "../lib/longStay/offerService.js";
import { LEASE_VERSION } from "../lib/longStay/lease.js";
import { sampleLeaseText } from "../lib/longStay/leasePreview.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const actionSchema = z.object({
  action: z.enum(["ENABLE", "DISABLE", "PAUSE", "RESUME"]),
  reason: z.string().trim().max(300).optional().nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.action === "PAUSE" || value.action === "DISABLE") && !(value.reason && value.reason.length >= 5)) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason of at least 5 characters." });
  }
});

async function landlordSummary(ownerId: number) {
  const [gate, listings] = await Promise.all([
    landlordGate(prisma, ownerId),
    prisma.property.findMany({
      where: { ownerId, rentalMode: "LONG_STAY" },
      select: { id: true, title: true, status: true },
      orderBy: { id: "desc" },
      take: 50,
    }),
  ]);
  return { ...gate, listings: listings.map((p) => ({ title: p.title, status: p.status })) };
}

router.get("/landlords/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid owner" });
  const owner = await prisma.user.findFirst({ where: { id: params.data.id, role: "OWNER" }, select: { id: true } });
  if (!owner) return res.status(404).json({ error: "Owner not found" });
  return res.json(await landlordSummary(owner.id));
}) as RequestHandler);

router.post("/landlords/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParam.safeParse(req.params);
  const body = actionSchema.safeParse(req.body ?? {});
  if (!params.success) return res.status(400).json({ error: "Invalid owner" });
  if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message || "Invalid request" });
  const ownerId = params.data.id;
  const { action } = body.data;
  const reason = body.data.reason ? sanitizeText(body.data.reason).slice(0, 300) : null;

  const owner = await prisma.user.findFirst({ where: { id: ownerId, role: "OWNER" }, select: { id: true, suspendedAt: true, deletedAt: true } });
  if (!owner) return res.status(404).json({ error: "Owner not found" });
  const before = await prisma.longStayLandlordGrant.findUnique({ where: { userId: ownerId } });
  const now = new Date();

  if (action === "ENABLE") {
    if (owner.suspendedAt || owner.deletedAt) return res.status(409).json({ error: "A suspended or closed account cannot be switched on." });
    await prisma.longStayLandlordGrant.upsert({
      where: { userId: ownerId },
      create: { userId: ownerId, enabledById: req.user!.id, enabledAt: now },
      update: { pausedAt: null, pauseReason: null, enabledById: req.user!.id },
    });
  } else if (action === "DISABLE") {
    if (before) await prisma.longStayLandlordGrant.delete({ where: { userId: ownerId } });
  } else {
    if (!before) return res.status(409).json({ error: "Long stays are not switched on for this owner." });
    await prisma.longStayLandlordGrant.update({
      where: { userId: ownerId },
      data: action === "PAUSE" ? { pausedAt: now, pauseReason: reason } : { pausedAt: null, pauseReason: null },
    });
  }

  await audit(req as any, "LONG_STAY_LANDLORD_SWITCH", "USER", {
    granted: Boolean(before),
    pausedAt: before?.pausedAt ?? null,
  }, { action, reason }, ownerId);
  return res.json({ ok: true, ...(await landlordSummary(ownerId)) });
}) as RequestHandler);

// ---------- Tenant identity checks (decision 10) ----------

const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().trim().max(300).optional().nullable(),
  /** The two things only a person can see; both must be ticked to approve. */
  checks: z.object({ nameMatches: z.boolean(), faceMatches: z.boolean() }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "REJECT" && !(value.reason && value.reason.length >= 5)) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Tell the tenant what to fix (at least 5 characters)." });
  }
  if (value.decision === "APPROVE" && !(value.checks?.nameMatches && value.checks?.faceMatches)) {
    ctx.addIssue({ code: "custom", path: ["checks"], message: "Confirm the name and the face match before approving." });
  }
});
const barSchema = z.object({
  action: z.enum(["BAR", "UNBAR"]),
  reason: z.string().trim().max(300).optional().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.action === "BAR" && !(value.reason && value.reason.length >= 5)) {
    ctx.addIssue({ code: "custom", path: ["reason"], message: "Give a reason of at least 5 characters." });
  }
});
const TENANT_STATUSES = ["PENDING", "APPROVED", "EXPIRING", "REJECTED", "BARRED"] as const;
const PHOTO_SIDES = ["front", "back", "selfie"] as const;
type PhotoSide = (typeof PHOTO_SIDES)[number];
const SIDE_FIELD: Record<PhotoSide, "document" | "documentBack" | "selfieDocument"> = { front: "document", back: "documentBack", selfie: "selfieDocument" };

function tenantListWhere(status: string, today: string) {
  if (status === "BARRED") return { barredAt: { not: null } };
  if (status === "EXPIRING") {
    return { status: "APPROVED", barredAt: null, idExpiresOn: { lte: new Date(`${addDaysToDay(today, RENEW_WINDOW_DAYS)}T00:00:00Z`) } };
  }
  return { status, barredAt: null };
}

router.get("/tenants", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const status = String(req.query.status || "PENDING").toUpperCase();
  if (!(TENANT_STATUSES as readonly string[]).includes(status)) return res.status(400).json({ error: "Unknown status" });
  const today = eatToday(new Date());
  const filters: any[] = [tenantListWhere(status, today)];

  const q = sanitizeText(String(req.query.q || "")).trim().slice(0, 60);
  if (q) {
    filters.push({
      OR: [
        { idNumberLast4: q.toUpperCase().slice(-4) },
        { holderName: { contains: q } },
        { user: { name: { contains: q } } },
        { user: { fullName: { contains: q } } },
        { user: { email: { contains: q } } },
        { user: { phone: { contains: q.replace(/\s/g, "") } } },
      ],
    });
  }
  const idType = String(req.query.idType || "").toUpperCase();
  if ((ID_TYPES as readonly string[]).includes(idType)) filters.push({ idType });
  const country = String(req.query.country || "").toUpperCase();
  if (isIsoCountry(country)) filters.push({ idCountry: country });

  const [rows, pending, approved, expiring, rejected, barred, oldest] = await Promise.all([
    prisma.longStayTenantProfile.findMany({
      where: { AND: filters } as any,
      orderBy: status === "EXPIRING" ? { idExpiresOn: "asc" } : { submittedAt: status === "PENDING" ? "asc" : "desc" },
      take: 100,
      include: { user: { select: { id: true, name: true, fullName: true, email: true, phone: true, phoneVerifiedAt: true, createdAt: true } } },
    }),
    prisma.longStayTenantProfile.count({ where: tenantListWhere("PENDING", today) as any }),
    prisma.longStayTenantProfile.count({ where: tenantListWhere("APPROVED", today) as any }),
    prisma.longStayTenantProfile.count({ where: tenantListWhere("EXPIRING", today) as any }),
    prisma.longStayTenantProfile.count({ where: tenantListWhere("REJECTED", today) as any }),
    prisma.longStayTenantProfile.count({ where: tenantListWhere("BARRED", today) as any }),
    prisma.longStayTenantProfile.findFirst({ where: tenantListWhere("PENDING", today) as any, orderBy: { submittedAt: "asc" }, select: { submittedAt: true } }),
  ]);
  // The same ID on another account: shown to the reviewer, never to tenants.
  const hashes = Array.from(new Set(rows.map((row) => row.idNumberHash)));
  const twins = hashes.length
    ? await prisma.longStayTenantProfile.groupBy({ by: ["idNumberHash"], where: { idNumberHash: { in: hashes } }, _count: { _all: true } })
    : [];
  const twinCount = new Map(twins.map((row: any) => [row.idNumberHash, row._count._all - 1]));
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({
    counts: { PENDING: pending, APPROVED: approved, EXPIRING: expiring, REJECTED: rejected, BARRED: barred },
    oldestPendingAt: oldest?.submittedAt ?? null,
    today,
    items: rows.map((row) => {
      const accountName = row.user.fullName || row.user.name || null;
      const birth = dayOf(row.dateOfBirth);
      return {
        id: row.id,
        status: row.barredAt ? "BARRED" : row.status,
        idType: row.idType,
        idCountry: row.idCountry,
        nationality: row.nationality,
        idNumberLast4: row.idNumberLast4,
        holderName: row.holderName,
        dateOfBirth: birth,
        age: birth ? ageOn(birth, today) : null,
        idExpiresOn: dayOf(row.idExpiresOn),
        expiring: row.status === "APPROVED" && idExpiring(row),
        submittedAt: row.submittedAt,
        reviewedAt: row.reviewedAt,
        rejectReason: row.rejectReason,
        barReason: row.barReason,
        photos: { front: Boolean(row.documentId), back: Boolean(row.documentBackId), selfie: Boolean(row.selfieDocumentId) },
        sameIdOnOtherAccounts: twinCount.get(row.idNumberHash) ?? 0,
        nameAgreement: nameAgreement(row.holderName, accountName),
        tenant: {
          name: accountName,
          email: row.user.email,
          phone: row.user.phone,
          phoneVerified: Boolean(row.user.phoneVerifiedAt),
          memberSince: row.user.createdAt,
        },
      };
    }),
  });
}) as RequestHandler);

/**
 * Opens one photo (?side=front|back|selfie) through a 5-minute signed link.
 * Every view is audited, and approval checks this admin opened each photo.
 */
router.get("/tenants/:id/document", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid record" });
  const side = String(req.query.side || "front") as PhotoSide;
  if (!(PHOTO_SIDES as readonly string[]).includes(side)) return res.status(400).json({ error: "Unknown photo" });
  const profile: any = await prisma.longStayTenantProfile.findUnique({
    where: { id: params.data.id },
    include: { [SIDE_FIELD[side]]: { select: { metadata: true } } } as any,
  });
  const meta = (profile?.[SIDE_FIELD[side]]?.metadata ?? {}) as Record<string, unknown>;
  if (!profile || !isTravellerDocumentPublicId(meta.cloudinaryPublicId)) return res.status(404).json({ error: "Document not found" });
  // No audit row, no photo: approval relies on these rows.
  await auditOrThrow(prisma, req as any, "LONG_STAY_TENANT_ID_VIEW", "USER", null, { profileId: profile.id, side }, profile.userId);
  try {
    res.setHeader("Cache-Control", "private, no-store");
    return res.redirect(302, signedTravellerDocumentUrl(meta.cloudinaryPublicId, String(meta.cloudinaryResourceType || "image")));
  } catch {
    return res.status(503).json({ error: "Private document delivery is unavailable" });
  }
}) as RequestHandler);

/** The photos this admin has not opened since the ID was sent. */
async function unopenedSides(profile: any, adminId: number): Promise<PhotoSide[]> {
  const required = requiredPhotoSides(profile);
  if (!required.length) return [];
  const views = await prisma.auditLog.findMany({
    where: { actorId: adminId, action: "LONG_STAY_TENANT_ID_VIEW", entityId: profile.userId, createdAt: { gte: profile.submittedAt } },
    select: { afterJson: true },
    take: 100,
  });
  const seen = new Set(views
    .map((v: any) => v.afterJson as Record<string, unknown> | null)
    .filter((j): j is Record<string, unknown> => Boolean(j) && Number(j!.profileId) === profile.id)
    .map((j) => String(j.side || "front")));
  return required.filter((side) => !seen.has(side));
}

router.post("/tenants/:id/review", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParam.safeParse(req.params);
  const body = reviewSchema.safeParse(req.body ?? {});
  if (!params.success) return res.status(400).json({ error: "Invalid record" });
  if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message || "Invalid request" });
  const reason = body.data.reason ? sanitizeText(body.data.reason).slice(0, 300) : null;
  const profile = await prisma.longStayTenantProfile.findUnique({ where: { id: params.data.id } });
  if (!profile) return res.status(404).json({ error: "Not found" });
  if (profile.userId === req.user!.id) return res.status(403).json({ error: "You cannot review your own ID." });

  const status = body.data.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  if (status === "APPROVED") {
    const missing = await unopenedSides(profile, req.user!.id);
    if (missing.length) return res.status(409).json({ error: `Open every photo before approving (${missing.join(", ")}).`, missing });
    const expires = dayOf(profile.idExpiresOn);
    if (expires && expires <= eatToday(new Date())) return res.status(409).json({ error: "This document has expired. Reject it and ask for a valid one." });
  }
  // Only a pending check can be decided, once: a second admin acting at the same time gets a 409.
  const result = await prisma.longStayTenantProfile.updateMany({
    where: { id: profile.id, status: "PENDING", barredAt: null },
    data: { status, reviewedAt: new Date(), reviewedById: req.user!.id, rejectReason: status === "REJECTED" ? reason : null },
  });
  if (result.count !== 1) return res.status(409).json({ error: "This ID check was already decided." });
  const documentIds = [profile.documentId, profile.documentBackId, profile.selfieDocumentId].filter((id): id is number => Boolean(id));
  for (const documentId of documentIds) {
    await prisma.userDocument.update({ where: { id: documentId }, data: { status, reason: status === "REJECTED" ? reason : null } }).catch(() => undefined);
  }
  await audit(req as any, "LONG_STAY_TENANT_ID_REVIEW", "USER", { status: profile.status }, { status, reason, checks: body.data.checks ?? null }, profile.userId);
  await notifyUser(profile.userId, status === "APPROVED" ? "long_stay_id_approved" : "long_stay_id_rejected", { reason }).catch(() => undefined);
  return res.json({ ok: true, status });
}) as RequestHandler);

router.post("/tenants/:id/bar", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParam.safeParse(req.params);
  const body = barSchema.safeParse(req.body ?? {});
  if (!params.success) return res.status(400).json({ error: "Invalid record" });
  if (!body.success) return res.status(400).json({ error: body.error.issues[0]?.message || "Invalid request" });
  const reason = body.data.reason ? sanitizeText(body.data.reason).slice(0, 300) : null;
  const profile = await prisma.longStayTenantProfile.findUnique({ where: { id: params.data.id } });
  if (!profile) return res.status(404).json({ error: "Not found" });
  if (profile.userId === req.user!.id) return res.status(403).json({ error: "You cannot act on your own ID." });
  const barring = body.data.action === "BAR";
  await prisma.longStayTenantProfile.update({
    where: { id: profile.id },
    data: barring ? { barredAt: new Date(), barReason: reason } : { barredAt: null, barReason: null },
  });
  await audit(req as any, "LONG_STAY_TENANT_BAR", "USER", { barredAt: profile.barredAt }, { action: body.data.action, reason }, profile.userId);
  return res.json({ ok: true, barred: barring });
}) as RequestHandler);

// ---------- Inspections and Ask NoLSAF (section 13) ----------

const INSPECTION_VIEWS: Record<string, any> = {
  todo: { status: { in: ["REQUESTED", "ASSIGNED"] } },
  review: { status: "SUBMITTED" },
  passed: { status: "PASSED" },
  failed: { status: "FAILED" },
};

async function partnerByCode(code: string) {
  const row = await prisma.salesPartnerProfile.findFirst({ where: { agentCode: code.trim().toUpperCase() }, select: { id: true, userId: true, agentCode: true } });
  return row;
}

router.get("/inspections", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const view = String(req.query.view || "todo");
  const where = INSPECTION_VIEWS[view];
  if (!where) return res.status(400).json({ error: "Unknown view" });
  const today = todayInEat();
  const [rows, counts] = await Promise.all([
    prisma.longStayInspection.findMany({
      where,
      orderBy: view === "todo" ? { createdAt: "asc" } : { updatedAt: "desc" },
      take: 100,
      include: {
        property: { select: { title: true, district: true, regionName: true, ownerId: true, latitude: true, longitude: true, owner: { select: { name: true, fullName: true, phone: true } } } },
        salesPartner: { select: { agentCode: true, user: { select: { name: true, fullName: true } } } },
      },
    }),
    Promise.all(Object.entries(INSPECTION_VIEWS).map(async ([key, w]) => [key, await prisma.longStayInspection.count({ where: w })] as const)),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({
    counts: Object.fromEntries(counts),
    inspectionRequiredForApproval: longStayInspectionRequiredForApproval(),
    checklist: CHECKLIST,
    items: rows.map((r: any) => ({
      ref: r.publicRef,
      status: r.status,
      reason: r.reason,
      home: { title: r.property?.title ?? null, area: [r.property?.district, r.property?.regionName].filter(Boolean).join(", "), hasPin: r.property?.latitude != null && r.property?.longitude != null },
      landlord: { name: r.property?.owner?.fullName || r.property?.owner?.name || null, phone: r.property?.owner?.phone ?? null },
      partner: r.salesPartner ? { code: r.salesPartner.agentCode, name: r.salesPartner.user?.fullName || r.salesPartner.user?.name || null } : null,
      assignedAt: r.assignedAt,
      dueBy: r.dueBy,
      overdue: r.status === "ASSIGNED" && r.dueBy ? new Date(r.dueBy).getTime() < Date.now() : false,
      report: r.submittedAt ? {
        checklist: r.checklist,
        photoCount: Array.isArray(r.photos) ? r.photos.length : 0,
        recommendation: r.recommendation,
        note: r.note,
        distanceMeters: r.distanceMeters,
        accuracyMeters: r.accuracyMeters,
        flags: r.flags ?? [],
        capturedAt: r.capturedAt,
        submittedAt: r.submittedAt,
      } : null,
      reviewNote: r.reviewNote,
      reviewedAt: r.reviewedAt,
      validUntil: r.validUntil ? new Date(r.validUntil).toISOString().slice(0, 10) : null,
      current: inspectionCurrent(r, today),
      feeAmount: r.feeAmount != null ? Number(r.feeAmount) : null,
      createdAt: r.createdAt,
    })),
  });
}) as RequestHandler);

async function inspectionByRef(ref: string) {
  if (!isInspectionRef(ref)) return null;
  return prisma.longStayInspection.findUnique({ where: { publicRef: ref } });
}

router.post("/inspections/:ref/assign", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = z.object({ partnerCode: z.string().trim().min(3).max(30) }).strict().safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Enter the partner's code, for example NSA-DAR-0042." });
  const inspection = await inspectionByRef(String(req.params.ref));
  if (!inspection) return res.status(404).json({ error: "Not found" });
  const partner = await partnerByCode(body.data.partnerCode);
  if (!partner) return res.status(404).json({ error: "No Sales Partner has that code." });
  const [context, hasAccess] = await Promise.all([loadSalesPartnerContext(partner.userId), hasWorkspaceAccess(partner.userId, "SALES")]);
  if (context?.status !== "ACTIVE" || !hasAccess || !isContractEarning(context.contract)) {
    return res.status(409).json({ error: "Choose an active partner with access to the Sales workspace and a current contract." });
  }
  let invitation;
  try {
    const propertyTitle = await propertyTitleOf(inspection.propertyId);
    invitation = await prisma.$transaction(async (tx) => {
      await assignInspection(tx, inspection, partner, req.user!.id);
      return createUserNotification(tx, partner.userId, "long_stay_inspection_assigned", {
        propertyTitle,
        actionPath: `/sales/inspections?inspection=${encodeURIComponent(inspection.publicRef)}`,
      });
    });
  } catch (error) {
    if (error instanceof InspectionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  await audit(req as any, "LONG_STAY_INSPECTION_ASSIGN", "PROPERTY", { status: inspection.status, partnerId: inspection.salesPartnerId }, { partner: partner.agentCode }, inspection.propertyId);
  publishUserNotification(invitation);
  return res.json({ ok: true });
}) as RequestHandler);

/** One on-site photo, through a 5-minute signed link. Audited. */
router.get("/inspections/:ref/photos/:n", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const inspection: any = await inspectionByRef(String(req.params.ref));
  const n = Number(req.params.n);
  const photo = inspection && Array.isArray(inspection.photos) && Number.isInteger(n) ? inspection.photos[n] : null;
  const url = photo ? signedVisitPhotoUrl(String(photo.publicId)) : null;
  if (!url) return res.status(404).json({ error: "Photo not found" });
  await audit(req as any, "LONG_STAY_INSPECTION_PHOTO_VIEW", "PROPERTY", null, { ref: inspection.publicRef, n }, inspection.propertyId);
  res.setHeader("Cache-Control", "private, no-store");
  return res.redirect(302, url);
}) as RequestHandler);

router.post("/inspections/:ref/review", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = inspectionReviewSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Choose pass, fail or redo, and write a note (at least 5 characters)." });
  const inspection: any = await inspectionByRef(String(req.params.ref));
  if (!inspection) return res.status(404).json({ error: "Not found" });
  const property = await prisma.property.findUnique({ where: { id: inspection.propertyId }, select: { ownerId: true } });
  if (property?.ownerId === req.user!.id) return res.status(403).json({ error: "You cannot review your own home." });
  const note = sanitizeText(body.data.note).slice(0, 500);
  const title = await propertyTitleOf(inspection.propertyId);
  let review;
  try {
    review = await prisma.$transaction(async (tx) => {
      const result = await reviewInspection(tx, inspection, req.user!.id, body.data.decision, note, todayInEat());
      const partner = inspection.salesPartnerId
        ? await tx.salesPartnerProfile.findUnique({ where: { id: inspection.salesPartnerId }, select: { userId: true } })
        : null;
      const notification = partner ? await createUserNotification(tx, partner.userId, body.data.decision === "REDO" ? "long_stay_inspection_redo" : "long_stay_inspection_decided", {
        propertyTitle: title,
        status: result.status,
        note,
        actionPath: `/sales/inspections?inspection=${encodeURIComponent(inspection.publicRef)}`,
      }) : null;
      return { result, notification };
    });
  } catch (error) {
    if (error instanceof InspectionError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  const { result, notification } = review;
  if (notification) publishUserNotification(notification);
  await audit(req as any, "LONG_STAY_INSPECTION_REVIEW", "PROPERTY", { status: inspection.status }, { decision: body.data.decision, note, fee: result.feeAmount, accrued: result.fee }, inspection.propertyId);
  if (property) {
    if (body.data.decision === "PASS") await notifyOwner(property.ownerId, "long_stay_inspection_passed", { propertyTitle: title }).catch(() => undefined);
    if (body.data.decision === "FAIL") await notifyOwner(property.ownerId, "long_stay_inspection_failed", { propertyTitle: title, note }).catch(() => undefined);
  }
  return res.json({ ok: true, status: result.status, fee: result.fee });
}) as RequestHandler);

/** Opens an inspection by hand: a yearly check, or a home that needs another look. */
router.post("/properties/:id/inspection", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid property" });
  const property = await prisma.property.findFirst({ where: { id: params.data.id, rentalMode: "LONG_STAY" }, select: { id: true } });
  if (!property) return res.status(404).json({ error: "Not a long-stay home" });
  const passed = await latestPassedInspection(prisma, property.id);
  const { inspection, created } = await requestInspection(prisma, property.id, passed ? "YEARLY" : "FIRST");
  if (created) await audit(req as any, "LONG_STAY_INSPECTION_REQUEST", "PROPERTY", null, { ref: inspection.publicRef }, property.id);
  return res.json({ ok: true, ref: inspection.publicRef, created });
}) as RequestHandler);

const ENQUIRY_VIEWS: Record<string, any> = { open: { status: "OPEN" }, answered: { status: "ANSWERED" }, closed: { status: "CLOSED" } };

router.get("/enquiries", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const view = String(req.query.view || "open");
  const where = ENQUIRY_VIEWS[view];
  if (!where) return res.status(400).json({ error: "Unknown view" });
  const [rows, open] = await Promise.all([
    prisma.longStayEnquiry.findMany({
      where,
      orderBy: { createdAt: view === "open" ? "asc" : "desc" },
      take: 100,
      include: {
        property: { select: { title: true, district: true, regionName: true, owner: { select: { name: true, fullName: true, phone: true } } } },
        user: { select: { name: true, fullName: true, phone: true } },
        salesPartner: { select: { agentCode: true } },
      },
    }),
    prisma.longStayEnquiry.count({ where: { status: "OPEN" } }),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({
    openCount: open,
    items: rows.map((r: any) => ({
      ref: r.publicRef,
      kind: r.kind,
      text: r.text,
      slots: Array.isArray(r.slots) ? r.slots : [],
      status: r.status,
      answer: r.answer,
      answeredAt: r.answeredAt,
      visitAt: r.visitAt,
      partnerCode: r.salesPartner?.agentCode ?? null,
      home: { title: r.property?.title ?? null, area: [r.property?.district, r.property?.regionName].filter(Boolean).join(", ") },
      // NoLSAF staff may call the landlord to get an answer; the tenant never sees this.
      landlord: { name: r.property?.owner?.fullName || r.property?.owner?.name || null, phone: r.property?.owner?.phone ?? null },
      tenant: { name: r.user?.fullName || r.user?.name || null, phone: r.user?.phone ?? null },
      createdAt: r.createdAt,
    })),
  });
}) as RequestHandler);

router.post("/enquiries/:ref/answer", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = enquiryAnswerSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Write the answer (5 to 1000 characters)." });
  const ref = String(req.params.ref);
  if (!isEnquiryRef(ref)) return res.status(404).json({ error: "Not found" });
  const enquiry = await prisma.longStayEnquiry.findUnique({ where: { publicRef: ref } });
  if (!enquiry) return res.status(404).json({ error: "Not found" });
  if (enquiry.status === "CLOSED") return res.status(409).json({ error: "This question is closed." });
  let salesPartnerId: number | null = enquiry.salesPartnerId;
  let visitAt: Date | null = enquiry.visitAt;
  if (enquiry.kind === "VISIT" && body.data.visitAt) {
    visitAt = new Date(body.data.visitAt);
    if (!body.data.partnerCode) return res.status(400).json({ error: "Name the partner who goes with the tenant." });
    const partner = await partnerByCode(body.data.partnerCode);
    if (!partner) return res.status(404).json({ error: "No Sales Partner has that code." });
    salesPartnerId = partner.id;
    await notifyUser(partner.userId, "long_stay_visit_assigned", { propertyTitle: await propertyTitleOf(enquiry.propertyId), when: visitAt.toISOString() }).catch(() => undefined);
  }
  const answer = sanitizeText(body.data.answer).slice(0, 1000);
  await prisma.longStayEnquiry.update({ where: { id: enquiry.id }, data: { status: "ANSWERED", answer, answeredById: req.user!.id, answeredAt: new Date(), visitAt, salesPartnerId } });
  await audit(req as any, "LONG_STAY_ENQUIRY_ANSWER", "USER", { status: enquiry.status }, { ref, visitAt }, enquiry.userId);
  await notifyUser(enquiry.userId, "long_stay_enquiry_answered", { propertyTitle: await propertyTitleOf(enquiry.propertyId) }).catch(() => undefined);
  return res.json({ ok: true });
}) as RequestHandler);

router.post("/enquiries/:ref/close", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const ref = String(req.params.ref);
  if (!isEnquiryRef(ref)) return res.status(404).json({ error: "Not found" });
  const result = await prisma.longStayEnquiry.updateMany({ where: { publicRef: ref, status: { not: "CLOSED" } }, data: { status: "CLOSED" } });
  if (result.count !== 1) return res.status(404).json({ error: "Not found" });
  return res.json({ ok: true });
}) as RequestHandler);

async function propertyTitleOf(propertyId: number) {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { title: true } });
  return p?.title ?? null;
}

// ---------- Tenancies: move-in, disputes and payouts (milestone 7) ----------

const TENANCY_VIEWS: Record<string, any> = {
  payouts: { payoutStatus: { in: ["READY", "REVIEW", "APPROVED"] } },
  disputes: { status: "DISPUTED" },
  refunds: { payoutStatus: "REFUND_DUE" },
  ending: { status: { in: ["ENDING", "OVERDUE"] } },
  movein: { status: { in: ["RESERVED", "MOVE_IN"] } },
  all: {},
};

async function adminTenancyByRef(ref: string) {
  if (!isTenancyRef(ref)) return null;
  return prisma.tenancy.findUnique({ where: { publicRef: ref } });
}

router.get("/tenancies", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const view = String(req.query.view || "payouts");
  const where = TENANCY_VIEWS[view];
  if (!where) return res.status(400).json({ error: "Unknown view" });
  const rows = await prisma.tenancy.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      property: { select: { title: true } },
      landlord: { select: { name: true, fullName: true, phone: true } },
      tenant: { select: { name: true, fullName: true, phone: true } },
    },
  });
  // Counts for the header and tabs, from the same filters as the views.
  const countKeys = Object.keys(TENANCY_VIEWS).filter((k) => k !== "all");
  const [viewCounts, openClaims] = await Promise.all([
    Promise.all(countKeys.map(async (k) => [k, await prisma.tenancy.count({ where: TENANCY_VIEWS[k] })] as const)),
    prisma.tenancyClaim.count({ where: { OR: [{ status: { in: ["OPEN", "RECOVERING"] } }, { status: "RECOVERED", closedAt: null }] } as any }),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({
    counts: { ...Object.fromEntries(viewCounts), claims: openClaims },
    items: rows.map((t: any) => ({
      ref: t.publicRef,
      status: t.status,
      payoutStatus: t.payoutStatus,
      home: t.property?.title ?? null,
      landlord: { name: t.landlord?.fullName || t.landlord?.name || null, phone: t.landlord?.phone ?? null },
      tenant: { name: t.tenant?.fullName || t.tenant?.name || null, phone: t.tenant?.phone ?? null },
      currency: t.currency,
      moveInDate: t.moveInDate ? new Date(t.moveInDate).toISOString().slice(0, 10) : null,
      termMonths: t.termMonths,
      paidAmount: t.paidAmount != null ? Number(t.paidAmount) : null,
      balanceDue: t.balanceDue != null ? Number(t.balanceDue) : null,
      landlordBalanceAmount: t.landlordBalanceAmount != null ? Number(t.landlordBalanceAmount) : null,
      tenantBalanceAmount: t.tenantBalanceAmount != null ? Number(t.tenantBalanceAmount) : null,
      balanceMismatch: t.balanceMismatch,
      moveInConfirmedBy: t.moveInConfirmedBy,
      landlordPayout: landlordPayoutOf(t),
      payoutReleasedAt: t.payoutReleasedAt,
      disputedAt: t.disputedAt,
    })),
  });
}) as RequestHandler);

router.get("/tenancies/:ref/events", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenancy = await adminTenancyByRef(String(req.params.ref));
  if (!tenancy) return res.status(404).json({ error: "Not found" });
  const events = await prisma.tenancyEvent.findMany({ where: { tenancyId: tenancy.id }, orderBy: { id: "asc" }, take: 500, select: { actorRole: true, type: true, fromStatus: true, toStatus: true, data: true, createdAt: true } });
  await audit(req as any, "LONG_STAY_TENANCY_VIEW", "TENANCY", null, { ref: tenancy.publicRef }, tenancy.id).catch(() => undefined);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({ events });
}) as RequestHandler);

router.post("/tenancies/:ref/payout/approve", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const tenancy = await adminTenancyByRef(String(req.params.ref));
  if (!tenancy) return res.status(404).json({ error: "Not found" });
  if (tenancy.landlordId === req.user!.id || tenancy.tenantId === req.user!.id) return res.status(403).json({ error: "You cannot approve a payout on your own tenancy." });
  try {
    let result;
    if (tenancy.payoutStatus === "APPROVED") {
      // A failed disbursement releases its source: request a fresh one.
      const live = await prisma.disbursement.findFirst({ where: { sourceType: "TENANCY", sourceId: tenancy.id, status: { not: "FAILED" } }, select: { id: true } });
      if (live) return res.status(409).json({ error: "A payout for this tenancy is already in Disbursements." });
      const account = await landlordPayoutAccount(prisma, tenancy.landlordId);
      if (!account) return res.status(409).json({ error: "The landlord has no verified mobile money account to pay into." });
      const disbursement = await requestDisbursement({ sourceType: "TENANCY", sourceId: tenancy.id, payoutAccountId: account.id, requestedById: req.user!.id, remarks: `Long stay ${tenancy.publicRef}` });
      result = { disbursementId: disbursement.id };
    } else {
      result = await approveTenancyPayout(prisma, tenancy, req.user!.id, requestDisbursement as any);
    }
    await audit(req as any, "LONG_STAY_PAYOUT_APPROVE", "TENANCY", { payoutStatus: tenancy.payoutStatus }, { payoutStatus: "APPROVED", ...result }, tenancy.id);
    return res.json({ ok: true, ...result, next: "Approve and release it in Disbursements." });
  } catch (error: any) {
    if (error instanceof TenancyError) return res.status(error.status).json({ error: error.message });
    if (error?.name === "PayoutStateError" || error?.name === "PayoutIneligibleError") return res.status(409).json({ error: error.message });
    throw error;
  }
}) as RequestHandler);

const manualPayoutSchema = z.object({ reference: z.string().trim().min(4).max(120) }).strict();
router.post("/tenancies/:ref/payout/manual", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = manualPayoutSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Enter the bank transfer reference." });
  const tenancy = await adminTenancyByRef(String(req.params.ref));
  if (!tenancy) return res.status(404).json({ error: "Not found" });
  if (tenancy.landlordId === req.user!.id || tenancy.tenantId === req.user!.id) return res.status(403).json({ error: "You cannot record a payout on your own tenancy." });
  try {
    const result = await recordManualPayout(prisma, tenancy, req.user!.id, sanitizeText(body.data.reference).slice(0, 120));
    await audit(req as any, "LONG_STAY_PAYOUT_MANUAL", "TENANCY", { payoutStatus: tenancy.payoutStatus }, { payoutStatus: "RELEASED", reference: body.data.reference, amount: result.amount }, tenancy.id);
    await notifyUser(tenancy.landlordId, "long_stay_payout_paid", { amount: result.amount, reference: body.data.reference }).catch(() => undefined);
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof TenancyError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}) as RequestHandler);

/**
 * Admin decision on a dispute, or a move-in nobody confirmed. `to` is where
 * the tenancy goes; `payout` what happens to the held first month.
 */
const resolveSchema = z.object({
  to: z.enum(["ACTIVE", "CANCELLED", "ENDED", "RESERVED", "MOVE_IN"]),
  payout: z.enum(["READY", "REVIEW", "REFUND_DUE"]),
  note: z.string().trim().min(10).max(500),
  /** The dispute showed the home itself falls short: end its inspection now. */
  reinspect: z.boolean().optional(),
}).strict();
router.post("/tenancies/:ref/resolve", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = resolveSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Choose the outcome and write a note of at least 10 characters." });
  const tenancy = await adminTenancyByRef(String(req.params.ref));
  if (!tenancy) return res.status(404).json({ error: "Not found" });
  if (tenancy.landlordId === req.user!.id || tenancy.tenantId === req.user!.id) return res.status(403).json({ error: "You cannot decide your own tenancy." });
  if (["RELEASED", "REFUNDED"].includes(tenancy.payoutStatus) && body.data.payout !== "REVIEW") {
    return res.status(409).json({ error: "The money already moved; leave the payout for review." });
  }
  const note = sanitizeText(body.data.note).slice(0, 500);
  try {
    const fromMoveIn = tenancy.status === "MOVE_IN" && body.data.to === "ACTIVE";
    if (fromMoveIn) {
      await finishMoveIn(prisma, tenancy, "ADMIN", req.user!.id);
      await prisma.tenancy.updateMany({ where: { id: tenancy.id }, data: { payoutStatus: body.data.payout } });
    } else {
      await moveTenancy(prisma, tenancy, body.data.to, "ADMIN", req.user!.id, {
        payoutStatus: ["RELEASED", "REFUNDED"].includes(tenancy.payoutStatus) ? tenancy.payoutStatus : body.data.payout,
        ...(body.data.to === "CANCELLED" ? { cancelledAt: new Date(), cancelledBy: "ADMIN", cancelReason: note.slice(0, 300) } : {}),
        ...(body.data.to === "ENDED" ? { endedAt: new Date() } : {}),
        ...(body.data.to === "ACTIVE" && !tenancy.moveInConfirmedAt ? { moveInConfirmedAt: new Date(), moveInConfirmedBy: "ADMIN" } : {}),
      }, { note, payout: body.data.payout });
    }
  } catch (error) {
    if (error instanceof TenancyError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  // A decision can confirm a move-in or send the first month back: keep the ledger in step.
  await syncLongStayRevenue(prisma, tenancy.id).catch((error) => console.error(`[longStay] revenue sync failed for tenancy ${tenancy.id}:`, error?.message ?? error));
  if (body.data.reinspect) {
    await endInspectionAfterDispute(prisma, tenancy.propertyId, todayInEat()).catch((error) => console.error("[longStay] reinspection failed:", error?.message ?? error));
    await notifyAdmins("long_stay_inspection_needed", { propertyTitle: await propertyTitleOf(tenancy.propertyId) }).catch(() => undefined);
  }
  await audit(req as any, "LONG_STAY_RESOLVE", "TENANCY", { status: tenancy.status, payoutStatus: tenancy.payoutStatus }, { ...body.data, note }, tenancy.id);
  return res.json({ ok: true });
}) as RequestHandler);

// ---------- Claims (milestone 8) ----------

router.post("/tenancies/:ref/claims", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const body = claimSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Choose the kind, enter the amount and a reason of at least 10 characters." });
  const tenancy = await adminTenancyByRef(String(req.params.ref));
  if (!tenancy) return res.status(404).json({ error: "Not found" });
  if (tenancy.landlordId === req.user!.id || tenancy.tenantId === req.user!.id) return res.status(403).json({ error: "You cannot open a claim on your own tenancy." });
  try {
    const claim = await openClaim(prisma, tenancy, req.user!.id, { ...body.data, reason: sanitizeText(body.data.reason).slice(0, 500) });
    await audit(req as any, "LONG_STAY_CLAIM_OPEN", "TENANCY", null, { claimId: claim.id, kind: claim.kind, amount: Number(claim.amount) }, tenancy.id);
    const title = (await prisma.property.findUnique({ where: { id: tenancy.propertyId }, select: { title: true } }))?.title;
    await notifyOwner(tenancy.landlordId, "long_stay_claim_owner", { propertyTitle: title, amount: Number(claim.amount), currency: claim.currency, reason: claim.reason }).catch(() => undefined);
    await notifyUser(tenancy.tenantId, "long_stay_claim", { propertyTitle: title, amount: Number(claim.amount), currency: claim.currency }).catch(() => undefined);
    return res.status(201).json({ ok: true, id: claim.id });
  } catch (error) {
    if (error instanceof TenancyError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}) as RequestHandler);

router.get("/claims", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const scope = String(req.query.scope || "open");
  const where = scope === "open" ? { OR: [{ status: { in: ["OPEN", "RECOVERING"] } }, { status: "RECOVERED", closedAt: null }] } : {};
  const rows = await prisma.tenancyClaim.findMany({ where: where as any, orderBy: { dueAt: "asc" }, take: 200, include: { tenancy: { select: { publicRef: true, property: { select: { title: true } } } } } });
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({
    items: rows.map((c: any) => ({
      id: c.id, kind: c.kind, amount: Number(c.amount), recoveredAmount: Number(c.recoveredAmount), currency: c.currency,
      status: c.status, reason: c.reason, dueAt: c.dueAt, escalatedAt: c.escalatedAt, closedAt: c.closedAt, closedNote: c.closedNote,
      tenancyRef: c.tenancy?.publicRef, home: c.tenancy?.property?.title ?? null,
    })),
  });
}) as RequestHandler);

router.post("/claims/:id/close", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParam.safeParse(req.params);
  const body = claimCloseSchema.safeParse(req.body ?? {});
  if (!params.success) return res.status(400).json({ error: "Invalid claim" });
  if (!body.success) return res.status(400).json({ error: "Choose the outcome and write a note." });
  const claim = await prisma.tenancyClaim.findUnique({ where: { id: params.data.id } });
  if (!claim) return res.status(404).json({ error: "Not found" });
  if (claim.landlordId === req.user!.id || claim.tenantId === req.user!.id) return res.status(403).json({ error: "You cannot decide a claim on your own tenancy." });
  try {
    await closeClaim(prisma, claim, body.data.outcome, sanitizeText(body.data.note).slice(0, 500));
  } catch (error) {
    if (error instanceof TenancyError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  await audit(req as any, "LONG_STAY_CLAIM_CLOSE", "TENANCY", { status: claim.status }, { outcome: body.data.outcome, note: body.data.note }, claim.tenancyId);
  return res.json({ ok: true });
}) as RequestHandler);

/**
 * The Sales Partners who brought this home to NoLSAF: an assisted listing
 * (the partner listed it for the owner) or a sales attribution. They may not
 * inspect it (partnerConflict), so the page shows them apart.
 */
async function onboardingPartners(propertyId: number) {
  const partnerSelect = { id: true, agentCode: true, region: true, status: true, phone: true, user: { select: { name: true, fullName: true, phone: true } } } as const;
  const [assisted, attributions] = await Promise.all([
    (prisma as any).salesAssistedListing.findFirst({ where: { propertyId }, select: { status: true, createdAt: true, salesPartner: { select: partnerSelect } } }).catch(() => null),
    prisma.propertySalesAttribution.findMany({
      where: { propertyId, revokedAt: null },
      orderBy: { attributedAt: "asc" },
      select: { status: true, productType: true, attributedAt: true, verifiedAt: true, salesPartner: { select: partnerSelect } },
    }),
  ]);
  const out: Array<{ partnerId: number; code: string; name: string | null; phone: string | null; region: string | null; partnerStatus: string; source: "ASSISTED_LISTING" | "ATTRIBUTION"; status: string; productType: string | null; since: Date; verified: boolean }> = [];
  const push = (p: any, extra: { source: "ASSISTED_LISTING" | "ATTRIBUTION"; status: string; productType: string | null; since: Date; verified: boolean }) => {
    if (!p || out.some((o) => o.partnerId === p.id)) return;
    out.push({ partnerId: p.id, code: p.agentCode, name: p.user?.fullName || p.user?.name || null, phone: p.phone || p.user?.phone || null, region: p.region ?? null, partnerStatus: p.status, ...extra });
  };
  if (assisted?.salesPartner) push(assisted.salesPartner, { source: "ASSISTED_LISTING", status: assisted.status, productType: null, since: assisted.createdAt, verified: false });
  for (const a of attributions) push(a.salesPartner, { source: "ATTRIBUTION", status: a.status, productType: a.productType, since: a.attributedAt, verified: Boolean(a.verifiedAt) });
  return out;
}

/**
 * Active Sales Partners who may inspect this home, best first: working in the
 * home's region, fewest visits already open, most inspections done. Never the
 * owner or a partner who brought the home in.
 */
async function inspectorCandidates(ownerId: number, regionName: string | null, district: string | null, excluded: Set<number>, assignedId: number | null) {
  const now = new Date();
  const partners = await prisma.salesPartnerProfile.findMany({
    where: {
      status: "ACTIVE", suspendedAt: null, terminatedAt: null, userId: { not: ownerId },
      contracts: { some: { status: { in: [...CONTRACT_EARNING_STATUSES] }, startsAt: { lte: now }, expiresAt: { gt: now } } },
      user: { workspaceAccess: { some: { workspace: "SALES", status: "ACTIVE", OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } } },
    },
    select: { id: true, agentCode: true, region: true, territory: true, level: true, user: { select: { name: true, fullName: true } } },
    take: 300,
  });
  const pool = partners.filter((p) => !excluded.has(p.id));
  if (!pool.length) return [];
  const loads = await prisma.longStayInspection.groupBy({
    by: ["salesPartnerId", "status"],
    where: { salesPartnerId: { in: pool.map((p) => p.id) }, status: { in: ["ASSIGNED", "SUBMITTED", "PASSED", "FAILED"] } },
    _count: { _all: true },
  });
  const count = (id: number, statuses: string[]) => loads.filter((l) => l.salesPartnerId === id && statuses.includes(l.status)).reduce((n, l) => n + l._count._all, 0);
  const norm = (v: string | null | undefined) => String(v || "").trim().toLowerCase();
  const region = norm(regionName);
  const area = norm(district);
  return pool
    .map((p) => {
      const where = `${norm(p.region)} ${norm(p.territory)}`;
      const match: "AREA" | "REGION" | "OTHER" = area && where.includes(area) ? "AREA" : region && where.includes(region) ? "REGION" : "OTHER";
      return {
        code: p.agentCode,
        name: p.user?.fullName || p.user?.name || null,
        region: p.region,
        territory: p.territory,
        level: p.level,
        match,
        openVisits: count(p.id, ["ASSIGNED", "SUBMITTED"]),
        doneInspections: count(p.id, ["PASSED", "FAILED"]),
        assigned: p.id === assignedId,
      };
    })
    .sort((a, b) => {
      const rank = { AREA: 0, REGION: 1, OTHER: 2 } as const;
      return Number(b.assigned) - Number(a.assigned) || rank[a.match] - rank[b.match] || a.openVisits - b.openVisits || b.doneInspections - a.doneInspections || a.code.localeCompare(b.code);
    })
    .slice(0, 6);
}

/** One inspection as the moderation page shows it: who went, where they stood, what they saw. */
function inspectionDetail(r: any, today: string) {
  return {
    ref: r.publicRef,
    status: r.status,
    reason: r.reason,
    partner: r.salesPartner
      ? { code: r.salesPartner.agentCode, name: r.salesPartner.user?.fullName || r.salesPartner.user?.name || null, phone: r.salesPartner.user?.phone ?? null }
      : null,
    assignedBy: r.assignedBy ? r.assignedBy.fullName || r.assignedBy.name || null : null,
    assignedAt: r.assignedAt,
    dueBy: r.dueBy,
    overdue: r.status === "ASSIGNED" && r.dueBy ? new Date(r.dueBy).getTime() < Date.now() : false,
    report: r.submittedAt ? {
      checklist: r.checklist ?? {},
      photoCount: Array.isArray(r.photos) ? r.photos.length : 0,
      recommendation: r.recommendation,
      note: r.note,
      position: r.latitude != null && r.longitude != null ? { latitude: Number(r.latitude), longitude: Number(r.longitude) } : null,
      accuracyMeters: r.accuracyMeters,
      distanceMeters: r.distanceMeters,
      flags: Array.isArray(r.flags) ? r.flags : [],
      capturedAt: r.capturedAt,
      submittedAt: r.submittedAt,
    } : null,
    reviewNote: r.reviewNote,
    reviewedAt: r.reviewedAt,
    reviewedBy: r.reviewedBy ? r.reviewedBy.fullName || r.reviewedBy.name || null : null,
    validUntil: r.validUntil ? new Date(r.validUntil).toISOString().slice(0, 10) : null,
    current: inspectionCurrent(r, today),
    feeAmount: r.feeAmount != null ? Number(r.feeAmount) : null,
    createdAt: r.createdAt,
  };
}

router.get("/properties/:id", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid property" });
  const property = await prisma.property.findUnique({
    where: { id: params.data.id },
    select: {
      id: true, ownerId: true, rentalMode: true, longStayListing: true, title: true, district: true, regionName: true,
      latitude: true, longitude: true, services: true,
      owner: { select: { fullName: true, name: true } },
    },
  });
  if (!property) return res.status(404).json({ error: "Property not found" });
  if (property.rentalMode !== "LONG_STAY") return res.json({ rentalMode: property.rentalMode, terms: null });
  const today = todayInEat();
  const inspections = await prisma.longStayInspection.findMany({
    where: { propertyId: property.id },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      salesPartner: { select: { agentCode: true, user: { select: { name: true, fullName: true, phone: true } } } },
      assignedBy: { select: { name: true, fullName: true } },
      reviewedBy: { select: { name: true, fullName: true } },
    },
  });
  const [latest, ...older] = inspections;
  const onboardedBy = await onboardingPartners(property.id);
  const needsPartner = !latest || latest.status === "REQUESTED" || latest.status === "ASSIGNED";
  const candidates = needsPartner
    ? await inspectorCandidates(property.ownerId, property.regionName, property.district, new Set(onboardedBy.map((p) => p.partnerId)), latest?.salesPartnerId ?? null)
    : [];
  let servicesObj: any = property.services;
  if (typeof servicesObj === "string") { try { servicesObj = JSON.parse(servicesObj); } catch { servicesObj = null; } }
  const rawRules = servicesObj && typeof servicesObj === "object" ? servicesObj.houseRules ?? null : null;
  const longStayExtra = {
    inspectionRequiredForApproval: longStayInspectionRequiredForApproval(),
    pin: property.latitude != null && property.longitude != null ? { latitude: Number(property.latitude), longitude: Number(property.longitude) } : null,
    checklist: CHECKLIST,
    inspection: latest ? inspectionDetail(latest, today) : null,
    history: older.map((r: any) => ({
      ref: r.publicRef, status: r.status, reason: r.reason, partnerCode: r.salesPartner?.agentCode ?? null,
      reviewedAt: r.reviewedAt, validUntil: r.validUntil ? new Date(r.validUntil).toISOString().slice(0, 10) : null, createdAt: r.createdAt,
    })),
    onboardedBy: onboardedBy.map(({ partnerId: _partnerId, ...rest }) => rest),
    candidates,
    livingRules: houseRulesOf(property.services),
    rawRules: rawRules && typeof rawRules === "object" ? {
      smokingPolicy: rawRules.smokingPolicy ?? null,
      overnightGuests: rawRules.overnightGuests ?? null,
      overnightNights: rawRules.overnightNights ?? null,
      quietHours: rawRules.quietHours ?? null,
      other: rawRules.other ?? null,
    } : null,
  };
  const terms = rowToTerms(property.longStayListing);
  let quote: ReturnType<typeof computeLongStayQuote> | null = null;
  if (terms) {
    try {
      quote = computeLongStayQuote({
        monthlyRent: rentForTerm(terms, terms.minTermMonths),
        termMonths: terms.minTermMonths,
        upfrontMonths: terms.upfrontMonths,
        currency: terms.currency,
        rates: await currentLongStayRates(prisma),
      });
    } catch {
      quote = null;
    }
  }
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({ rentalMode: "LONG_STAY", terms, quote, landlord: await landlordGate(prisma, property.ownerId), ...longStayExtra });
}) as RequestHandler);

/** The lease a tenant would sign for this listing, with sample names and dates (the landlord's own preview). */
router.get("/properties/:id/lease-preview", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParam.safeParse(req.params);
  if (!params.success) return res.status(400).json({ error: "Invalid property" });
  const property = await prisma.property.findUnique({
    where: { id: params.data.id },
    select: { rentalMode: true, longStayListing: true, title: true, district: true, regionName: true, services: true, owner: { select: { fullName: true, name: true } } },
  });
  if (!property || property.rentalMode !== "LONG_STAY") return res.status(404).json({ error: "Not a long-stay home" });
  const terms = rowToTerms(property.longStayListing);
  if (!terms) return res.status(409).json({ error: "The landlord has not saved monthly terms yet." });
  let servicesObj: any = property.services;
  if (typeof servicesObj === "string") { try { servicesObj = JSON.parse(servicesObj); } catch { servicesObj = null; } }
  const { text } = await sampleLeaseText(prisma, {
    terms,
    houseRules: servicesObj && typeof servicesObj === "object" ? servicesObj.houseRules : null,
    landlordName: property.owner?.fullName || property.owner?.name || "[The landlord's name]",
    homeTitle: property.title || "[This home]",
    homeArea: [property.district, property.regionName].filter(Boolean).join(", "),
    today: todayInEat(),
  });
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({ text, version: LEASE_VERSION });
}) as RequestHandler);

export default router;

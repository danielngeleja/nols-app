/**
 * Tenant side of long-stay rentals (docs/LONG_STAY_RENTALS.md).
 *
 * GET /api/customer/long-stay/identity   my ID check status (never the number or photo)
 * PUT /api/customer/long-stay/identity   submit or replace my ID (an approved one only near expiry)
 * GET  /api/customer/long-stay/quote?property=&termMonths=  what a term of a home would cost
 * POST /api/customer/long-stay/reservations    reserve at the listed terms { property, moveInDate, termMonths }
 * POST /api/customer/long-stay/enquiries       ask NoLSAF { property, kind: QUESTION | VISIT, text, slots? }
 * GET  /api/customer/long-stay/enquiries       my questions and NoLSAF's answers
 * GET  /api/customer/long-stay/tenancies (scope=open|closed), GET /tenancies/:ref
 * POST /api/customer/long-stay/tenancies/:ref/messages { text } (after payment), /cancel { reason }
 * GET  /api/customer/long-stay/tenancies/:ref/lease, POST /lease/accept { leaseHash }
 *
 * A support session (impersonation) can never submit an ID, and the photo must
 * be a private upload under traveller-documents/long-stay-id/.
 */
import { Router, type RequestHandler, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { audit } from "../lib/audit.js";
import { createOwnerReservationNotification, LONG_STAY_RESERVATION_RECEIVED, notifyAdmins, publishUserNotification } from "../lib/notifications.js";
import { recordAcquisitionSource } from "../lib/acquisitionSource.js";
import { isTrustedUserDocumentUrl } from "../lib/userDocumentSecurity.js";
import { canReplaceApprovedId, isTenantRole, prepareIdentity, TenantIdentityError, tenantIdentityView, type IdUpload } from "../lib/longStay/tenantIdentity.js";
import { reserveSchema } from "../lib/longStay/tenancyService.js";
import { createReservation, quoteForHome } from "../lib/longStay/offerService.js";
import { createEnquiry, EnquiryError, enquirySchema, enquiryView } from "../lib/longStay/enquiry.js";
import { acceptLeaseRoute, cancelReservedRoute, cancelTermsRoute, claimReceivedRoute, closeRequest, confirmMoveInRoute, disputeRoute, getLease, getTenancy, listTenancies, noticeRoute, photosRoute, renewRoute, sendMessage, sendTenancyError } from "../lib/longStay/tenancyRoutes.js";
import { extractPublicKeyFromSlug } from "../lib/publicPropertyKey.js";
import { sanitizeText } from "../lib/sanitize.js";
import { longStayReceipt } from "../lib/longStay/receipt.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler);

const limitIdentitySubmit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many ID submissions. Try again in an hour." },
  keyGenerator: (req) => `long-stay-id:${(req as any).user?.id ?? req.ip}`,
});

function tenantOnly(req: AuthedRequest, res: Response): boolean {
  if (isTenantRole(req.user?.role)) return true;
  res.status(403).json({ error: "Long stays are booked from a traveller account." });
  return false;
}

router.get("/identity", asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!tenantOnly(req, res)) return;
  const [profile, user] = await Promise.all([
    prisma.longStayTenantProfile.findUnique({ where: { userId: req.user!.id } }),
    prisma.user.findUnique({ where: { id: req.user!.id }, select: { phoneVerifiedAt: true } }),
  ]);
  res.setHeader("Cache-Control", "private, no-store");
  return res.json(tenantIdentityView(profile, Boolean(user?.phoneVerifiedAt)));
}) as RequestHandler);

router.put("/identity", blockImpersonated as RequestHandler, limitIdentitySubmit as unknown as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!tenantOnly(req, res)) return;
  const userId = req.user!.id;

  let prepared;
  try {
    prepared = prepareIdentity(req.body ?? {});
  } catch (error) {
    if (error instanceof TenantIdentityError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
  const uploads = [prepared.front, prepared.back, prepared.selfie].filter(Boolean) as IdUpload[];
  if (uploads.some((u) => !isTrustedUserDocumentUrl(u.url, req.user!.role))) {
    return res.status(400).json({ error: "Upload the photos again." });
  }

  const [user, existing] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { phoneVerifiedAt: true, suspendedAt: true } }),
    prisma.longStayTenantProfile.findUnique({ where: { userId } }),
  ]);
  if (!user || user.suspendedAt) return res.status(403).json({ error: "This account cannot book long stays." });
  if (!user.phoneVerifiedAt) return res.status(409).json({ error: "Verify your phone number first, in Account security." });
  if (existing?.barredAt) return res.status(403).json({ error: "Your account cannot book long stays. Contact NoLSAF support." });
  if (existing?.status === "APPROVED" && !canReplaceApprovedId(existing)) {
    return res.status(409).json({ error: "Your ID is already verified. Contact NoLSAF support to change it." });
  }

  const docType = prepared.idType === "PASSPORT" ? "PASSPORT" : prepared.idType === "RES_PERMIT" ? "RESIDENCE_PERMIT" : "NATIONAL_ID";
  const saveUpload = (upload: IdUpload, side: "front" | "back" | "selfie") => prisma.userDocument.create({
    data: {
      userId,
      type: side === "selfie" ? "SELFIE" : docType,
      url: upload.url,
      status: "PENDING",
      metadata: { source: "long_stay_id", side, cloudinaryPublicId: upload.publicId, cloudinaryResourceType: upload.resourceType },
    } as any,
  });
  const front = await saveUpload(prepared.front, "front");
  const back = prepared.back ? await saveUpload(prepared.back, "back") : null;
  const selfie = await saveUpload(prepared.selfie, "selfie");

  const data = {
    idType: prepared.idType,
    idCountry: prepared.idCountry,
    nationality: prepared.nationality,
    idNumberHash: prepared.idNumberHash,
    idNumberLast4: prepared.idNumberLast4,
    holderName: prepared.holderName,
    dateOfBirth: prepared.dateOfBirth,
    idExpiresOn: prepared.idExpiresOn,
    documentId: front.id,
    documentBackId: back?.id ?? null,
    selfieDocumentId: selfie.id,
    status: "PENDING",
    submittedAt: new Date(),
    reviewedAt: null,
    reviewedById: null,
    rejectReason: null,
  };
  const profile = await prisma.longStayTenantProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data });

  await audit(req as any, "LONG_STAY_TENANT_ID_SUBMIT", "USER", { status: existing?.status ?? null }, { status: "PENDING", idType: prepared.idType, country: prepared.idCountry, last4: prepared.idNumberLast4, renewal: existing?.status === "APPROVED" }, userId).catch(() => undefined);
  await notifyAdmins("long_stay_tenant_id_submitted", { tenantProfileId: profile.id, idType: prepared.idType, idCountry: prepared.idCountry }).catch(() => undefined);

  res.setHeader("Cache-Control", "private, no-store");
  return res.json(tenantIdentityView(profile, true));
}) as RequestHandler);

const limitReservations = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many reservations. Try again later." },
  keyGenerator: (req) => `long-stay-reserve:${(req as any).user?.id ?? req.ip}`,
});
const limitEnquiries = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many questions. Try again later." },
  keyGenerator: (req) => `long-stay-enquiry:${(req as any).user?.id ?? req.ip}`,
});

/** Verified phone, not suspended, not barred from long stays. Sends the refusal itself. */
async function tenantGate(req: AuthedRequest, res: Response) {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { phoneVerifiedAt: true, suspendedAt: true, fullName: true, name: true } });
  if (!user || user.suspendedAt) { res.status(403).json({ error: "This account cannot book long stays." }); return null; }
  if (!user.phoneVerifiedAt) { res.status(409).json({ error: "Verify your phone number first, in Account security." }); return null; }
  const profile = await prisma.longStayTenantProfile.findUnique({ where: { userId: req.user!.id }, select: { barredAt: true } });
  if (profile?.barredAt) { res.status(403).json({ error: "Your account cannot book long stays. Contact NoLSAF support." }); return null; }
  return user;
}

router.get("/quote", asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!tenantOnly(req, res)) return;
  const key = extractPublicKeyFromSlug(String(req.query.property || ""));
  const term = Number(req.query.termMonths);
  if (!key) return res.status(404).json({ error: "This home is not available for long stays." });
  if (!Number.isInteger(term) || term < 1) return res.status(400).json({ error: "Choose how many months." });
  try {
    const quote = await quoteForHome(prisma, key, term);
    return res.json({ quote: { currency: quote.currency, monthlyRent: quote.monthlyRent, listedRent: quote.listedRent, discountPercent: quote.discountPercent, upfrontMonths: quote.upfrontMonths, tenantFee: quote.tenantFee, bookingAmount: quote.bookingAmount, balanceDue: quote.balanceDue } });
  } catch (error) {
    if (sendTenancyError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

router.post("/reservations", blockImpersonated as RequestHandler, limitReservations as unknown as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!tenantOnly(req, res)) return;
  const body = reserveSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Choose a move-in date and how many months." });
  const propertyKey = extractPublicKeyFromSlug(body.data.property);
  if (!propertyKey) return res.status(404).json({ error: "This home is not available for long stays." });
  if (!(await tenantGate(req, res))) return;
  try {
    const { tenancy, notification, propertyTitle } = await prisma.$transaction(async (tx) => {
      const { tenancy, property } = await createReservation(tx, { tenantId: req.user!.id, propertyKey, moveInDate: body.data.moveInDate, termMonths: body.data.termMonths });
      const notification = await createOwnerReservationNotification(tx, property.ownerId, {
        tenancyRef: tenancy.publicRef, propertyTitle: property.title, moveInDate: body.data.moveInDate, termMonths: body.data.termMonths,
      });
      return { tenancy, notification, propertyTitle: property.title };
    }, { isolationLevel: "Serializable" });
    publishUserNotification(notification, LONG_STAY_RESERVATION_RECEIVED);
    await notifyAdmins("long_stay_reservation_created", { tenancyRef: tenancy.publicRef, propertyTitle });
    // Marketing channel (reporting only, needs the visitor's consent cookie).
    await recordAcquisitionSource(prisma, { type: "TENANCY", id: tenancy.id }, req.headers.cookie);
    return res.status(201).json({ ref: tenancy.publicRef, status: tenancy.status });
  } catch (error) {
    if (sendTenancyError(res, error)) return;
    throw error;
  }
}) as RequestHandler);

router.post("/enquiries", blockImpersonated as RequestHandler, limitEnquiries as unknown as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!tenantOnly(req, res)) return;
  const body = enquirySchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Write your question (5 to 1000 characters)." });
  const propertyKey = extractPublicKeyFromSlug(body.data.property);
  if (!propertyKey) return res.status(404).json({ error: "This home is not available for long stays." });
  if (!(await tenantGate(req, res))) return;
  try {
    const { enquiry, property } = await createEnquiry(prisma, {
      userId: req.user!.id,
      propertyKey,
      kind: body.data.kind,
      text: sanitizeText(body.data.text).slice(0, 1000),
      slots: body.data.slots ?? null,
    });
    await notifyAdmins("long_stay_enquiry", { enquiryId: enquiry.id, enquiryRef: enquiry.publicRef, kind: enquiry.kind, propertyTitle: property.title });
    return res.status(201).json(enquiryView(enquiry, { title: property.title, key: propertyKey }));
  } catch (error) {
    if (error instanceof EnquiryError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}) as RequestHandler);

router.get("/enquiries", asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!tenantOnly(req, res)) return;
  const rows = await prisma.longStayEnquiry.findMany({
    where: { userId: req.user!.id },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { property: { select: { title: true, nrmsBookingKey: true } } },
  });
  res.setHeader("Cache-Control", "private, no-store");
  return res.json({ items: rows.map((r: any) => enquiryView(r, { title: r.property?.title ?? null, key: r.property?.nrmsBookingKey ?? null })) });
}) as RequestHandler);

router.get("/tenancies", listTenancies("TENANT"));
router.get("/tenancies/:ref", getTenancy("TENANT"));
router.get("/tenancies/:ref/receipt.html", blockImpersonated as RequestHandler, longStayReceipt("html"));
router.get("/tenancies/:ref/pdf", blockImpersonated as RequestHandler, longStayReceipt("pdf"));
router.post("/tenancies/:ref/messages", blockImpersonated as RequestHandler, sendMessage("TENANT"));
router.post("/tenancies/:ref/cancel", blockImpersonated as RequestHandler, closeRequest("TENANT"));
router.get("/tenancies/:ref/lease", getLease("TENANT"));
router.post("/tenancies/:ref/lease/accept", blockImpersonated as RequestHandler, acceptLeaseRoute("TENANT"));
router.post("/tenancies/:ref/move-in/confirm", blockImpersonated as RequestHandler, confirmMoveInRoute("TENANT"));
router.post("/tenancies/:ref/dispute", blockImpersonated as RequestHandler, disputeRoute("TENANT"));
router.post("/tenancies/:ref/photos", blockImpersonated as RequestHandler, photosRoute("TENANT"));
router.get("/tenancies/:ref/cancel-terms", cancelTermsRoute("TENANT"));
router.post("/tenancies/:ref/cancel-booking", blockImpersonated as RequestHandler, cancelReservedRoute("TENANT"));
router.post("/tenancies/:ref/notice", blockImpersonated as RequestHandler, noticeRoute("TENANT"));
router.post("/tenancies/:ref/renew", blockImpersonated as RequestHandler, renewRoute);
router.post("/tenancies/:ref/claims/:claimId/received", blockImpersonated as RequestHandler, claimReceivedRoute);

export default router;

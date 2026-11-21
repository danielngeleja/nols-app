/**
 * Owner side of long-stay rentals (docs/LONG_STAY_RENTALS.md).
 *
 * GET  /api/owner/long-stay/eligibility   is long stay switched on for me, and the allowed options
 * POST /api/owner/long-stay/quote         what a tenant pays and what I receive, computed on the server
 * POST /api/owner/long-stay/lease-preview the full lease for my draft terms, with sample names and dates
 * GET  /api/owner/long-stay/tenancies     reservations and tenancies on my homes (scope=open|closed)
 * GET  /api/owner/long-stay/tenancies/:ref
 * POST /api/owner/long-stay/tenancies/:ref/offer/accept      confirm a reservation (within 24h): freezes the money and the lease
 * POST /api/owner/long-stay/tenancies/:ref/offer/decline     { reason }
 * POST /api/owner/long-stay/tenancies/:ref/decline           { reason }
 * POST /api/owner/long-stay/tenancies/:ref/messages          { text } (after payment)
 * GET  /api/owner/long-stay/tenancies/:ref/lease             the lease text and its hash
 * POST /api/owner/long-stay/tenancies/:ref/lease/accept      { leaseHash }
 * Writes are refused during a support session.
 *
 * The rental mode and terms of a listing are saved with the listing itself
 * (PUT /api/owner/properties/:id), through lib/longStay/listing.ts.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  computeLongStayQuote,
  LONG_STAY_CURRENCIES,
  LONG_STAY_MAX_TERM_MONTHS,
  LONG_STAY_PROPERTY_TYPES,
  LONG_STAY_TERM_MONTHS,
  LongStayQuoteError,
  longStayOpen,
} from "../lib/longStay/fees.js";
import { applyDiscount, currentLongStayRates, landlordGate, landlordGateRefusal, parseLongStayTerms, todayInEat } from "../lib/longStay/listing.js";
import { LEASE_VERSION } from "../lib/longStay/lease.js";
import { sampleLeaseText } from "../lib/longStay/leasePreview.js";
import { acceptLeaseRoute, acceptOfferRoute, cancelReservedRoute, cancelTermsRoute, closeRequest, confirmMoveInRoute, disputeRoute, getLease, getTenancy, listTenancies, moveOutRoute, noticeRoute, photosRoute, sendMessage } from "../lib/longStay/tenancyRoutes.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("OWNER") as unknown as RequestHandler);

router.get("/eligibility", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const gate = await landlordGate(prisma, req.user!.id);
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    granted: gate.granted,
    paused: gate.paused,
    pauseReason: gate.pauseReason,
    refusal: landlordGateRefusal(gate),
    bookingsOpen: longStayOpen(),
    propertyTypes: LONG_STAY_PROPERTY_TYPES,
    termMonths: LONG_STAY_TERM_MONTHS,
    maxTermMonths: LONG_STAY_MAX_TERM_MONTHS,
    currencies: LONG_STAY_CURRENCIES,
  });
}) as RequestHandler);

const quoteSchema = z.object({
  monthlyRent: z.coerce.number(),
  termMonths: z.coerce.number().int(),
  upfrontMonths: z.coerce.number().int(),
  currency: z.string().trim().max(3),
  /** The listing's discount for this term, if any (1 to 30). */
  discountPercent: z.coerce.number().int().min(0).max(30).optional(),
}).strict();

router.post("/quote", asyncHandler(async (req: AuthedRequest, res: Response) => {
  // Only a landlord with the switch on needs a quote; nobody else learns the rates this way.
  const refusal = landlordGateRefusal(await landlordGate(prisma, req.user!.id));
  if (refusal) return res.status(403).json({ error: refusal });
  const parsed = quoteSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Send monthlyRent, termMonths, upfrontMonths and currency." });
  try {
    const { discountPercent = 0, ...rest } = parsed.data;
    const quote = computeLongStayQuote({ ...rest, monthlyRent: applyDiscount(rest.monthlyRent, rest.currency, discountPercent), rates: await currentLongStayRates(prisma) });
    return res.json({ quote });
  } catch (error) {
    if (error instanceof LongStayQuoteError) return res.status(400).json({ error: error.message });
    throw error;
  }
}) as RequestHandler);

const previewSchema = z.object({
  terms: z.unknown(),
  houseRules: z.unknown().optional(),
  homeTitle: z.string().trim().max(200).optional().nullable(),
  homeArea: z.string().trim().max(200).optional().nullable(),
}).strict();

/**
 * The lease a tenant would sign for this listing, with sample names and dates,
 * so the landlord can read every word before going live. Built by the same
 * code as the real lease; nothing is saved.
 */
router.post("/lease-preview", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const refusal = landlordGateRefusal(await landlordGate(prisma, req.user!.id));
  if (refusal) return res.status(403).json({ error: refusal });
  const body = previewSchema.safeParse(req.body ?? {});
  if (!body.success) return res.status(400).json({ error: "Send the terms to preview." });
  const today = todayInEat();
  let terms;
  try {
    terms = parseLongStayTerms({ ...(body.data.terms as any), availableFrom: (body.data.terms as any)?.availableFrom || today }, today);
  } catch (error: any) {
    return res.status(400).json({ error: error?.message || "Finish the monthly terms first." });
  }
  const owner = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { fullName: true, name: true } });
  const { text, moveInDate, termMonths } = await sampleLeaseText(prisma, {
    terms,
    houseRules: body.data.houseRules,
    landlordName: owner?.fullName || owner?.name || "[Your name]",
    homeTitle: body.data.homeTitle || "[This home]",
    homeArea: body.data.homeArea,
    today,
  });
  res.setHeader("Cache-Control", "no-store");
  return res.json({ text, version: LEASE_VERSION, sample: { moveInDate, termMonths } });
}) as RequestHandler);

const noSupportSession = blockImpersonated as RequestHandler;
router.get("/tenancies", listTenancies("LANDLORD"));
router.get("/tenancies/:ref", getTenancy("LANDLORD"));
router.post("/tenancies/:ref/decline", noSupportSession, closeRequest("LANDLORD"));
router.post("/tenancies/:ref/messages", noSupportSession, sendMessage("LANDLORD"));
router.post("/tenancies/:ref/offer/accept", noSupportSession, acceptOfferRoute);
router.post("/tenancies/:ref/offer/decline", noSupportSession, closeRequest("LANDLORD"));
router.get("/tenancies/:ref/lease", getLease("LANDLORD"));
router.post("/tenancies/:ref/lease/accept", noSupportSession, acceptLeaseRoute("LANDLORD"));
router.post("/tenancies/:ref/move-in/confirm", noSupportSession, confirmMoveInRoute("LANDLORD"));
router.post("/tenancies/:ref/dispute", noSupportSession, disputeRoute("LANDLORD"));
router.post("/tenancies/:ref/photos", noSupportSession, photosRoute("LANDLORD"));
router.get("/tenancies/:ref/cancel-terms", cancelTermsRoute("LANDLORD"));
router.post("/tenancies/:ref/cancel-booking", noSupportSession, cancelReservedRoute("LANDLORD"));
router.post("/tenancies/:ref/notice", noSupportSession, noticeRoute("LANDLORD"));
router.post("/tenancies/:ref/move-out", noSupportSession, moveOutRoute);

export default router;

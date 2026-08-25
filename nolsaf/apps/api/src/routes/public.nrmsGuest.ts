import crypto from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { getRoomTypeAvailability, getRoomTypesAvailability, lockPropertyInventory } from "../lib/nrmsAvailability.js";
import { evaluateRestrictionRules, findRestrictionBlocks } from "../lib/nrmsRestrictions.js";
import { REVIEW_RECOVERY_THRESHOLD, resolveReviewCategories, reviewCategoryOptions, sanitiseCategoryRatings } from "../lib/nrmsReviewCategories.js";
import { buildPropertySlug } from "../lib/publicPropertyDto.js";
import { computeNightlyRates, money, nightsBetween } from "../lib/nrmsRateMath.js";
import { publicNrmsGuestContact } from "../lib/nrmsGuestContact.js";
import { buildInquiryAcknowledgement } from "../lib/nrmsInquiryAcknowledgement.js";
import { sanitizeText } from "../lib/sanitize.js";
import { directHoldExternalRef } from "../lib/nrmsDirectHoldIdentity.js";
import { limitPublicNrmsDirectHold, limitPublicNrmsDirectQuote, limitPublicNrmsGuestCapability } from "../middleware/rateLimit.js";

export const router = Router();

const capabilityResponseHeaders: RequestHandler = (_req, res, next) => {
  // Capability URLs are bearer credentials. Keep them out of browser/CDN
  // caches and prevent the full URL leaking in an outbound Referer header.
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
};

router.use("/payment-requests/:token", capabilityResponseHeaders);
router.use("/reviews/:token", capabilityResponseHeaders);

// The hold transaction takes the property inventory lock, re-reads availability, upserts the
// guest profile and writes the reservation, its allocation, its event and the payment request.
// Prisma's 5s interactive-transaction default was tripping P2028 in production before the
// reservation was written. 15s gives headroom without holding the inventory lock indefinitely.
const HOLD_TX_OPTIONS = { maxWait: 5000, timeout: 15000 };

const guestWebOrigin = () => String(process.env.WEB_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "https://nolsaf.com").replace(/\/$/, "");
/** Where a happy guest can send the property to someone else. Public listing, no token in it. */
const shareLinks = (propertyId: number, title: string) => {
  const url = `${guestWebOrigin()}/public/properties/${buildPropertySlug(title, propertyId)}`;
  const message = `I stayed at ${title} and it was worth it. You can see the rooms and book it here: ${url}`;
  return { url, message, whatsapp: `https://wa.me/?text=${encodeURIComponent(message)}` };
};

const DIRECT_SOURCES = ["DIRECT", "INSTAGRAM", "FACEBOOK", "WHATSAPP", "EMAIL", "TELEGRAM", "QR", "OTHER"] as const;
const DIRECT_EVENTS = ["PAGE_OPEN", "AVAILABILITY_SEARCH", "ROOM_SELECTED", "INSTAGRAM_CLICK", "WHATSAPP_CLICK", "PHONE_CLICK", "EMAIL_CLICK", "HOLD_CREATED"] as const;
const INQUIRY_CHANNELS = ["WEB", "INSTAGRAM", "WHATSAPP", "PHONE", "EMAIL"] as const;
const directSourceSchema = z.preprocess((value) => String(value || "DIRECT").trim().toUpperCase(), z.enum(DIRECT_SOURCES));
const directQuoteSchema = z.object({ checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), adults: z.coerce.number().int().min(1).max(20).default(1), children: z.coerce.number().int().min(0).max(20).default(0), source: directSourceSchema.default("DIRECT") });
const directHoldSchema = directQuoteSchema.extend({ clientRequestId: z.string().uuid(), roomTypeId: z.number().int().positive(), ratePlanId: z.number().int().positive().nullable().optional(), guest: z.object({ fullName: z.string().trim().min(2).max(160), phone: z.string().trim().min(7).max(40), email: z.string().trim().email().max(160).nullable().optional(), nationality: z.string().trim().max(80).nullable().optional() }), termsAccepted: z.literal(true) });
const directInquirySchema = z.object({
  sessionRef: z.string().trim().min(8).max(100), channel: z.enum(INQUIRY_CHANNELS), source: directSourceSchema.default("DIRECT"),
  guestName: z.string().trim().min(2).max(160).nullable().optional(), guestPhone: z.string().trim().min(7).max(40).nullable().optional(), guestEmail: z.string().trim().email().max(160).nullable().optional(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  adults: z.number().int().min(1).max(20).default(1), children: z.number().int().min(0).max(20).default(0), roomTypeId: z.number().int().positive().nullable().optional(),
  message: z.string().trim().max(1000).nullable().optional(),
}).superRefine((value, context) => {
  if ((value.checkIn && !value.checkOut) || (!value.checkIn && value.checkOut)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["checkOut"], message: "Choose both stay dates" });
  if (value.checkIn && value.checkOut && value.checkOut <= value.checkIn) context.addIssue({ code: z.ZodIssueCode.custom, path: ["checkOut"], message: "Check-out must be after check-in" });
  if (value.channel === "WEB" && (!value.guestName || (!value.guestPhone && !value.guestEmail))) context.addIssue({ code: z.ZodIssueCode.custom, path: ["guestPhone"], message: "Add your name and a phone number or email so reception can reply" });
});
const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
type DirectRoomQuote = {
  roomType: { id: number; name: string; description: string | null; capacityAdults: number; capacityChildren: number; images: unknown };
  ratePlan: { id: number; name: string; refundable: boolean; mealPlan: string; cancellationPolicy: unknown } | null;
  currency: string; nightly: Array<{ date: string; rate: number }>; subtotal: number; tax: number; fees: number; total: number; depositAmount: number; available: number;
};

async function recordDirectMetric(propertyId: number, event: typeof DIRECT_EVENTS[number], source: typeof DIRECT_SOURCES[number]) {
  try {
    const now = new Date();
    const metricDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const kind = `DIRECT:${event}:${source}`;
    await prisma.nrmsPublicMetric.upsert({
      where: { propertyId_metricDate_kind: { propertyId, metricDate, kind } },
      update: { count: { increment: 1 } },
      create: { propertyId, metricDate, kind, count: 1 },
    });
  } catch (error) {
    // Analytics must never make live availability or a contact action fail.
    console.warn("[public.nrms.guest] direct metric failed", error);
  }
}

async function directQuote(propertyId: number, input: z.infer<typeof directQuoteSchema>, requestedRoomTypeId?: number, requestedRatePlanId?: number | null) {
  const checkIn = dateOnly(input.checkIn); const checkOut = dateOnly(input.checkOut); const stayNights = nightsBetween(checkIn, checkOut);
  const today = dateOnly(new Date().toISOString().slice(0, 10)); const advanceDays = Math.floor((checkIn.getTime() - today.getTime()) / 86_400_000); const stayDates = Array.from({ length: Math.max(0, stayNights) }, (_, offset) => new Date(checkIn.getTime() + offset * 86_400_000));
  if (checkIn < today || stayNights < 1 || stayNights > 365) throw new Error("INVALID_DATES");
  const property = await prisma.property.findFirst({ where: { id: propertyId, status: "APPROVED", nrmsActivatedAt: { not: null } }, select: { id: true, ownerId: true, title: true, currency: true, nrmsGuestPayInstructions: true, nrmsGuestContactSettings: true } });
  if (!property) throw new Error("PROPERTY_NOT_FOUND");
  const roomTypes = await prisma.roomType.findMany({ where: { propertyId, status: "ACTIVE", baseRate: { not: null }, ...(requestedRoomTypeId ? { id: requestedRoomTypeId } : {}) }, include: { ratePlans: { where: { status: "ACTIVE", ...(requestedRatePlanId ? { id: requestedRatePlanId } : {}) }, include: { seasons: { where: { status: "ACTIVE", startDate: { lte: checkOut }, endDate: { gte: checkIn } }, orderBy: { priority: "desc" } } }, orderBy: [{ isDefault: "desc" }, { id: "asc" }] } }, orderBy: { sortOrder: "asc" } });
  const roomRestrictionScope = requestedRoomTypeId
    ? [{ roomTypeId: requestedRoomTypeId }]
    : roomTypes.map((room) => ({ roomTypeId: room.id }));
  const restrictions = await prisma.nrmsRateRestriction.findMany({
    where: {
      propertyId,
      status: "ACTIVE",
      startDate: { lte: checkOut },
      endDate: { gte: checkIn },
      AND: [
        { OR: [{ roomTypeId: null }, ...roomRestrictionScope] },
        { OR: [{ channelCode: null }, { channelCode: "DIRECT" }] },
      ],
    },
  });
  const availabilityByRoomType = await getRoomTypesAvailability(
    prisma,
    propertyId,
    roomTypes.map((room) => room.id),
    checkIn,
    checkOut,
  );
  const quotes: DirectRoomQuote[] = [];
  for (const roomType of roomTypes) {
    if (input.adults > roomType.capacityAdults || input.children > roomType.capacityChildren) continue;
    const availability = availabilityByRoomType.get(roomType.id) ?? { capacity: 0, consumed: 0, available: 0 }; if (availability.available < 1) continue;
    const plan = roomType.ratePlans[0] ?? await prisma.nrmsRatePlan.findFirst({
      where: { propertyId, roomTypeId: null, status: "ACTIVE", ...(requestedRatePlanId ? { id: requestedRatePlanId } : {}) },
      include: { seasons: { where: { status: "ACTIVE", startDate: { lte: checkOut }, endDate: { gte: checkIn } }, orderBy: { priority: "desc" } } },
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    });
    if ((plan?.minAdvanceDays != null && advanceDays < plan.minAdvanceDays) || (plan?.maxAdvanceDays != null && advanceDays > plan.maxAdvanceDays) || stayNights < (plan?.defaultMinStay ?? 1) || (plan?.defaultMaxStay != null && stayNights > plan.defaultMaxStay)) continue;
    // Same evaluator the marketplace uses, over rules already loaded above, so
    // a control cannot mean one thing on the direct page and another on NoLSAF.
    if (evaluateRestrictionRules(restrictions, { propertyId, roomTypeId: roomType.id, ratePlanId: plan?.id ?? null, checkIn, checkOut, channelCode: "DIRECT" }).length) continue;
    const { nightly, subtotal: total } = computeNightlyRates(Number(roomType.baseRate), plan, stayDates);
    const taxPolicy = (plan?.taxPolicy && typeof plan.taxPolicy === "object" ? plan.taxPolicy : {}) as Record<string, unknown>; const feePolicy = (plan?.feePolicy && typeof plan.feePolicy === "object" ? plan.feePolicy : {}) as Record<string, unknown>; const tax = money(total * Math.max(0, Number(taxPolicy.percent || 0)) / 100); const fees = money(Number(feePolicy.fixed || 0)); const grandTotal = money(total + tax + fees); const channelPolicy = (plan?.channelPolicy && typeof plan.channelPolicy === "object" ? plan.channelPolicy : {}) as Record<string, unknown>; const depositPercent = Math.min(100, Math.max(0, Number(channelPolicy.directDepositPercent ?? 20)));
    quotes.push({ roomType: { id: roomType.id, name: roomType.name, description: roomType.description, capacityAdults: roomType.capacityAdults, capacityChildren: roomType.capacityChildren, images: roomType.images }, ratePlan: plan ? { id: plan.id, name: plan.name, refundable: plan.refundable, mealPlan: plan.mealPlan, cancellationPolicy: plan.cancellationPolicy } : null, currency: roomType.currency, nightly, subtotal: money(total), tax, fees, total: grandTotal, depositAmount: money(grandTotal * depositPercent / 100), available: availability.available });
  }
  return { property, checkIn, checkOut, stayNights, quotes };
}

router.get("/direct/:propertyId", limitPublicNrmsDirectQuote as RequestHandler, (async (req, res: Response) => {
  const parsed = directQuoteSchema.safeParse(req.query); if (!parsed.success) return res.status(400).json({ error: "Choose valid check-in and check-out dates" });
  try { const quote = await directQuote(Number(req.params.propertyId), parsed.data); await recordDirectMetric(quote.property.id, "AVAILABILITY_SEARCH", parsed.data.source); res.json({ property: { id: quote.property.id, title: quote.property.title }, contact: publicNrmsGuestContact(quote.property.nrmsGuestContactSettings), checkIn: quote.checkIn, checkOut: quote.checkOut, nights: quote.stayNights, quotes: quote.quotes }); }
  catch (error) { if (error instanceof Error && error.message === "PROPERTY_NOT_FOUND") return res.status(404).json({ error: "Direct booking is not available for this property" }); if (error instanceof Error && error.message === "INVALID_DATES") return res.status(400).json({ error: "Stay dates must be future dates with check-out after check-in" }); console.error("[public.nrms.guest] direct quote failed", error); res.status(500).json({ error: "A live quote could not be prepared" }); }
}) as RequestHandler);

router.post("/direct/:propertyId/events", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  const parsed = z.object({ event: z.enum(DIRECT_EVENTS), source: directSourceSchema.default("DIRECT") }).safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid direct-booking event" });
  const propertyId = Number(req.params.propertyId);
  if (!Number.isInteger(propertyId) || propertyId <= 0) return res.status(400).json({ error: "Invalid property" });
  const property = await prisma.property.findFirst({ where: { id: propertyId, status: "APPROVED", nrmsActivatedAt: { not: null } }, select: { id: true } });
  if (!property) return res.status(404).json({ error: "Direct booking is not available for this property" });
  await recordDirectMetric(property.id, parsed.data.event, parsed.data.source);
  res.status(202).json({ recorded: true });
}) as RequestHandler);

router.post("/direct/:propertyId/inquiries", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  const parsed = directInquirySchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Complete the reception request", details: parsed.error.flatten() });
  const propertyId = Number(req.params.propertyId);
  const property = await prisma.property.findFirst({ where: { id: propertyId, status: "APPROVED", nrmsActivatedAt: { not: null } }, select: { id: true, ownerId: true, title: true, nrmsGuestContactSettings: true } });
  if (!property) return res.status(404).json({ error: "Direct booking is not available for this property" });
  if (parsed.data.roomTypeId && !(await prisma.roomType.count({ where: { id: parsed.data.roomTypeId, propertyId, status: "ACTIVE" } }))) return res.status(400).json({ error: "The selected room is no longer available" });
  const now = new Date();
  const existing = await prisma.nrmsGuestInquiry.findFirst({ where: { propertyId, sessionRef: parsed.data.sessionRef, channel: parsed.data.channel, status: { notIn: ["CONVERTED", "CLOSED"] } }, select: { id: true, reference: true, status: true, autoAcknowledgedAt: true } });
  const body = parsed.data.message
    ? sanitizeText(parsed.data.message)
    : `${parsed.data.channel === "WEB" ? "Guest requested reception follow-up" : `${parsed.data.channel.toLowerCase()} handoff started`} from the live availability page.`;
  const common = {
    source: parsed.data.source, guestName: parsed.data.guestName ? sanitizeText(parsed.data.guestName) : null,
    guestPhone: parsed.data.guestPhone ? sanitizeText(parsed.data.guestPhone) : null, guestEmail: parsed.data.guestEmail ? sanitizeText(parsed.data.guestEmail) : null,
    checkIn: parsed.data.checkIn ? dateOnly(parsed.data.checkIn) : null, checkOut: parsed.data.checkOut ? dateOnly(parsed.data.checkOut) : null,
    adults: parsed.data.adults, children: parsed.data.children, roomTypeId: parsed.data.roomTypeId ?? null, lastMessageAt: now,
  };
  const contact = publicNrmsGuestContact(property.nrmsGuestContactSettings);
  const acknowledgement = buildInquiryAcknowledgement({
    propertyTitle: property.title,
    guestName: parsed.data.guestName,
    checkIn: parsed.data.checkIn,
    checkOut: parsed.data.checkOut,
    channels: { whatsapp: Boolean(contact?.whatsappPhone), instagram: Boolean(contact?.instagramUsername), phone: Boolean(contact?.receptionPhone) },
  });
  const guestMessage = { direction: parsed.data.channel === "WEB" ? "INBOUND" : "SYSTEM", channel: parsed.data.channel, senderName: parsed.data.guestName ?? null, body, metadata: { source: parsed.data.source, sessionRef: parsed.data.sessionRef } };
  const automaticMessage = { direction: "OUTBOUND", channel: "WEB", senderName: `${property.title} reception`, body: acknowledgement, deliveryStatus: "DISPLAYED", metadata: { automated: true, kind: "INQUIRY_ACKNOWLEDGEMENT" } };
  const shouldAcknowledge = parsed.data.channel === "WEB" && !existing?.autoAcknowledgedAt;
  const inquiry = existing
    ? await prisma.$transaction(async (tx) => {
        await tx.nrmsGuestInquiry.update({ where: { id: existing.id }, data: { ...common, ...(shouldAcknowledge ? { autoAcknowledgedAt: now } : {}), status: existing.status === "NEW" ? "NEW" : "OPEN", version: { increment: 1 } } });
        await tx.nrmsGuestMessage.create({ data: { inquiryId: existing.id, ...guestMessage } });
        if (shouldAcknowledge) await tx.nrmsGuestMessage.create({ data: { inquiryId: existing.id, ...automaticMessage } });
        return { id: existing.id, reference: existing.reference };
      })
    : await prisma.nrmsGuestInquiry.create({
        data: {
          propertyId, ownerId: property.ownerId, reference: `INQ-${propertyId}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
          sessionRef: parsed.data.sessionRef, channel: parsed.data.channel, ...common, ...(shouldAcknowledge ? { autoAcknowledgedAt: now } : {}),
          messages: { create: shouldAcknowledge ? [guestMessage, automaticMessage] : [guestMessage] },
        },
        select: { id: true, reference: true },
      });
  res.status(existing ? 200 : 201).json({ inquiry: { id: inquiry.id, reference: inquiry.reference, status: existing ? (existing.status === "NEW" ? "NEW" : "OPEN") : "NEW" }, acknowledgement: { message: acknowledgement, automated: shouldAcknowledge } });
}) as RequestHandler);

router.post("/direct/:propertyId/hold", limitPublicNrmsDirectHold as RequestHandler, (async (req, res: Response) => {
  const parsed = directHoldSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Complete the guest details and accept the booking terms", details: parsed.error.flatten() });
  try {
    const propertyId = Number(req.params.propertyId); const quote = await directQuote(propertyId, parsed.data, parsed.data.roomTypeId, parsed.data.ratePlanId); const selected = quote.quotes.find((item) => item.roomType.id === parsed.data.roomTypeId && (!parsed.data.ratePlanId || item.ratePlan?.id === parsed.data.ratePlanId)); if (!selected) return res.status(409).json({ error: "The selected room or rate is no longer available" });
    const holdExpiresAt = new Date(Date.now() + 30 * 60_000); const publicToken = crypto.randomBytes(24).toString("base64url");
    const externalRef = directHoldExternalRef(propertyId, parsed.data.clientRequestId);
    const result = await prisma.$transaction(async (tx) => {
      await lockPropertyInventory(tx, propertyId);
      const existingReservation = await tx.reservation.findFirst({
        where: { propertyId, source: "DIRECT", externalRef },
        include: { paymentRequests: { where: { cancelledAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (existingReservation?.paymentRequests[0]) return { reservation: existingReservation, paymentRequest: existingReservation.paymentRequests[0], replayed: true } as const;
      const capacity = await getRoomTypeAvailability(tx, propertyId, selected.roomType.id, quote.checkIn, quote.checkOut); if (capacity.available < 1) return null;
      // The quote happened before this transaction. Re-evaluate restrictions
      // after the inventory lock so a stop sell activated during checkout wins
      // over the in-flight booking instead of allowing one final reservation.
      const restrictionBlocks = await findRestrictionBlocks(tx, { propertyId, roomTypeId: selected.roomType.id, ratePlanId: selected.ratePlan?.id ?? null, checkIn: quote.checkIn, checkOut: quote.checkOut, channelCode: "DIRECT" });
      if (restrictionBlocks.length) return { restricted: restrictionBlocks[0]!.message } as const;
      // A public booking must not mutate an existing guest merely because the
      // caller knows that guest's phone number. Keep this unverified submission
      // isolated; staff can merge verified duplicates through an audited flow.
      const guest = await tx.guestProfile.create({ data: { propertyId, ownerId: quote.property.ownerId, fullName: parsed.data.guest.fullName, phone: parsed.data.guest.phone, email: parsed.data.guest.email, nationality: parsed.data.guest.nationality } });
      const reservation = await tx.reservation.create({ data: { propertyId, ownerId: quote.property.ownerId, guestProfileId: guest.id, source: "DIRECT", attribution: "OWNER_DIRECT", externalRef, status: "HELD", holdExpiresAt, checkIn: quote.checkIn, checkOut: quote.checkOut, adults: parsed.data.adults, children: parsed.data.children, currency: selected.currency, roomRate: selected.nightly[0]?.rate ?? 0, taxAmount: selected.tax, totalAmount: selected.total, depositAmount: selected.depositAmount, notes: `Guest accepted direct booking terms at ${new Date().toISOString()}.`, allocations: { create: { roomTypeId: selected.roomType.id, startDate: quote.checkIn, endDate: quote.checkOut, ratePlanId: selected.ratePlan?.id ?? null, mealPlan: selected.ratePlan?.mealPlan ?? null } }, events: { create: { type: "CREATED", data: { source: "DIRECT", campaignSource: parsed.data.source, ratePlanId: selected.ratePlan?.id ?? null, termsAccepted: true } } } } });
      const paymentRequest = await tx.nrmsGuestPaymentRequest.create({ data: { reservationId: reservation.id, kind: "DEPOSIT", amount: selected.depositAmount || selected.total, currency: selected.currency, publicToken, dueAt: holdExpiresAt, instructions: quote.property.nrmsGuestPayInstructions ?? undefined } }); return { reservation, paymentRequest, replayed: false } as const;
    }, HOLD_TX_OPTIONS);
    if (!result) return res.status(409).json({ error: "The selected room was just booked. Please choose another available option." });
    if ("restricted" in result) return res.status(409).json({ error: result.restricted, code: "RESTRICTION_CHANGED" });
    if (!result.replayed) await recordDirectMetric(propertyId, "HOLD_CREATED", parsed.data.source);
    res.status(result.replayed ? 200 : 201).json({ hold: { reference: result.reservation.externalRef, expiresAt: result.reservation.holdExpiresAt, status: result.reservation.status, total: Number(result.reservation.totalAmount), depositAmount: Number(result.reservation.depositAmount), currency: result.reservation.currency, paymentToken: result.paymentRequest.publicToken }, replayed: result.replayed });
  } catch (error) { if (error instanceof Error && ["PROPERTY_NOT_FOUND", "INVALID_DATES"].includes(error.message)) return res.status(400).json({ error: "The direct booking request is not valid" }); console.error("[public.nrms.guest] direct hold failed", error); res.status(500).json({ error: "The room could not be held" }); }
}) as RequestHandler);

router.get("/payment-requests/:token", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  try {
    const paymentRequest = await prisma.nrmsGuestPaymentRequest.findUnique({
      where: { publicToken: req.params.token },
      include: { reservation: { select: { id: true, receiptNumber: true, status: true, amountPaid: true, totalAmount: true, chargesTotal: true, guestProfile: { select: { fullName: true } }, property: { select: { title: true, nrmsGuestPayInstructions: true } } } } },
    });
    if (!paymentRequest || paymentRequest.cancelledAt) return res.status(404).json({ error: "Payment request not found" });
    res.json({ paymentRequest: { id: paymentRequest.id, kind: paymentRequest.kind, amount: Number(paymentRequest.amount), currency: paymentRequest.currency, status: paymentRequest.status, dueAt: paymentRequest.dueAt, instructions: paymentRequest.instructions, property: paymentRequest.reservation.property.title, guest: paymentRequest.reservation.guestProfile?.fullName ?? "Guest", receiptNumber: paymentRequest.reservation.receiptNumber, reservationStatus: paymentRequest.reservation.status } });
  } catch (error) { console.error("[public.nrms.guest] payment request failed", error); res.status(500).json({ error: "Payment request could not be loaded" }); }
}) as RequestHandler);

router.get("/reviews/:token", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  try {
    const review = await prisma.nrmsReviewRequest.findUnique({ where: { publicToken: req.params.token }, include: { property: { select: { id: true, title: true, nrmsReviewCategories: true } }, guestProfile: { select: { fullName: true } } } });
    if (!review) return res.status(404).json({ error: "Review request not found" });
    if (!review.openedAt) await prisma.nrmsReviewRequest.update({ where: { id: review.id }, data: { openedAt: new Date(), status: review.status === "SCHEDULED" ? "OPENED" : review.status } });
    res.json({ review: { property: review.property.title, guest: review.guestProfile?.fullName ?? "Guest", status: review.status, rating: review.rating, feedback: review.feedback, categoryRatings: review.categoryRatings ?? null, platformIntent: review.platformIntent, respondedAt: review.respondedAt, categories: reviewCategoryOptions(review.property.nrmsReviewCategories), share: review.respondedAt && !review.needsRecovery ? shareLinks(review.property.id, review.property.title) : null } });
  } catch (error) { console.error("[public.nrms.guest] review request failed", error); res.status(500).json({ error: "Review request could not be loaded" }); }
}) as RequestHandler);

router.post("/reviews/:token", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  const parsed = z.object({ rating: z.number().int().min(1).max(5), feedback: z.string().trim().max(1000).nullable().optional(), categoryRatings: z.record(z.number()).nullable().optional(), platformIntent: z.enum(["YES", "MAYBE", "NO"]).nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a rating from 1 to 5" });
  try {
    const review = await prisma.nrmsReviewRequest.findUnique({ where: { publicToken: req.params.token }, include: { property: { select: { id: true, title: true, nrmsReviewCategories: true } } } });
    if (!review) return res.status(404).json({ error: "Review request not found" });
    if (review.respondedAt) return res.status(409).json({ error: "This review has already been submitted" });
    // Only categories this property opted into are stored, so a later settings
    // change can never leave scores for a question the guest was not shown.
    const categoryRatings = sanitiseCategoryRatings(parsed.data.categoryRatings, resolveReviewCategories(review.property.nrmsReviewCategories));
    const needsRecovery = parsed.data.rating <= REVIEW_RECOVERY_THRESHOLD;
    const saved = await prisma.nrmsReviewRequest.update({ where: { id: review.id }, data: { rating: parsed.data.rating, feedback: parsed.data.feedback, categoryRatings: categoryRatings ?? undefined, platformIntent: parsed.data.platformIntent ?? undefined, needsRecovery, respondedAt: new Date(), status: "RESPONDED", openedAt: review.openedAt ?? new Date() } });
    // An unhappy guest is never asked to recommend the property. They get the
    // private follow-up path instead, and the owner gets a recovery task.
    res.json({ review: { rating: saved.rating, feedback: saved.feedback, categoryRatings: saved.categoryRatings ?? null, platformIntent: saved.platformIntent, respondedAt: saved.respondedAt, needsRecovery }, share: needsRecovery ? null : shareLinks(review.property.id, review.property.title) });
  } catch (error) { console.error("[public.nrms.guest] review response failed", error); res.status(500).json({ error: "Review could not be submitted" }); }
}) as RequestHandler);

/**
 * "Would you book through NoLSAF again?" is asked on the thank-you screen, after
 * the review is already saved, so it gets its own write. Keeping it off the main
 * form protects the review completion rate, and a guest who closes the tab here
 * still leaves a complete review behind.
 */
router.post("/reviews/:token/intent", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  const parsed = z.object({ platformIntent: z.enum(["YES", "MAYBE", "NO"]) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose one of the available answers" });
  try {
    const changed = await prisma.nrmsReviewRequest.updateMany({ where: { publicToken: req.params.token, respondedAt: { not: null } }, data: { platformIntent: parsed.data.platformIntent } });
    if (!changed.count) return res.status(404).json({ error: "Review request not found" });
    res.json({ platformIntent: parsed.data.platformIntent });
  } catch (error) { console.error("[public.nrms.guest] review intent failed", error); res.status(500).json({ error: "Your answer could not be saved" }); }
}) as RequestHandler);

export default router;

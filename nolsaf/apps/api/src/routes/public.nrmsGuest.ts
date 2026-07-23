import crypto from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { getRoomTypeAvailability, lockPropertyInventory } from "../lib/nrmsAvailability.js";
import { limitPublicNrmsDirectHold, limitPublicNrmsDirectQuote, limitPublicNrmsGuestCapability } from "../middleware/rateLimit.js";

export const router = Router();

// The hold transaction takes the property inventory lock, re-reads availability, upserts the
// guest profile and writes the reservation, its allocation, its event and the payment request.
// Prisma's 5s interactive-transaction default was tripping P2028 in production before the
// reservation was written. 15s gives headroom without holding the inventory lock indefinitely.
const HOLD_TX_OPTIONS = { maxWait: 5000, timeout: 15000 };

const directQuoteSchema = z.object({ checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), adults: z.coerce.number().int().min(1).max(20).default(1), children: z.coerce.number().int().min(0).max(20).default(0) });
const directHoldSchema = directQuoteSchema.extend({ roomTypeId: z.number().int().positive(), ratePlanId: z.number().int().positive().nullable().optional(), guest: z.object({ fullName: z.string().trim().min(2).max(160), phone: z.string().trim().min(7).max(40), email: z.string().trim().email().max(160).nullable().optional(), nationality: z.string().trim().max(80).nullable().optional() }), termsAccepted: z.literal(true) });
const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const nights = (start: Date, end: Date) => Math.ceil((end.getTime() - start.getTime()) / 86_400_000);
const adjust = (base: number, type: string, value: number) => type === "FIXED" ? value : type === "OFFSET" ? base + value : type === "PERCENT" ? base * (1 + value / 100) : base;
const money = (value: number) => Math.max(0, Number(value.toFixed(2)));
const appliesOn = (daysOfWeek: unknown, date: Date) => !Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || daysOfWeek.map(Number).includes(date.getUTCDay());
type DirectRoomQuote = {
  roomType: { id: number; name: string; description: string | null; capacityAdults: number; capacityChildren: number; images: unknown };
  ratePlan: { id: number; name: string; refundable: boolean; mealPlan: string; cancellationPolicy: unknown } | null;
  currency: string; nightly: Array<{ date: string; rate: number }>; subtotal: number; tax: number; fees: number; total: number; depositAmount: number; available: number;
};

async function directQuote(propertyId: number, input: z.infer<typeof directQuoteSchema>, requestedRoomTypeId?: number, requestedRatePlanId?: number | null) {
  const checkIn = dateOnly(input.checkIn); const checkOut = dateOnly(input.checkOut); const stayNights = nights(checkIn, checkOut);
  const today = dateOnly(new Date().toISOString().slice(0, 10)); const advanceDays = Math.floor((checkIn.getTime() - today.getTime()) / 86_400_000); const stayDates = Array.from({ length: Math.max(0, stayNights) }, (_, offset) => new Date(checkIn.getTime() + offset * 86_400_000));
  if (checkIn < today || stayNights < 1 || stayNights > 365) throw new Error("INVALID_DATES");
  const property = await prisma.property.findFirst({ where: { id: propertyId, status: "APPROVED", nrmsActivatedAt: { not: null } }, select: { id: true, ownerId: true, title: true, currency: true, nrmsGuestPayInstructions: true } });
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
  const quotes: DirectRoomQuote[] = [];
  for (const roomType of roomTypes) {
    if (input.adults > roomType.capacityAdults || input.children > roomType.capacityChildren) continue;
    const availability = await getRoomTypeAvailability(prisma, propertyId, roomType.id, checkIn, checkOut); if (availability.available < 1) continue;
    const plan = roomType.ratePlans[0] ?? await prisma.nrmsRatePlan.findFirst({
      where: { propertyId, roomTypeId: null, status: "ACTIVE", ...(requestedRatePlanId ? { id: requestedRatePlanId } : {}) },
      include: { seasons: { where: { status: "ACTIVE", startDate: { lte: checkOut }, endDate: { gte: checkIn } }, orderBy: { priority: "desc" } } },
      orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    });
    if ((plan?.minAdvanceDays != null && advanceDays < plan.minAdvanceDays) || (plan?.maxAdvanceDays != null && advanceDays > plan.maxAdvanceDays) || stayNights < (plan?.defaultMinStay ?? 1) || (plan?.defaultMaxStay != null && stayNights > plan.defaultMaxStay)) continue;
    const controls = restrictions.filter((rule) => rule.roomTypeId == null || rule.roomTypeId === roomType.id).filter((rule) => !rule.ratePlanId || rule.ratePlanId === plan?.id).filter((rule) => stayDates.some((date) => date >= rule.startDate && date <= rule.endDate && appliesOn(rule.daysOfWeek, date)));
    if (controls.some((rule) => rule.stopSell || (rule.closedToArrival && rule.startDate <= checkIn && rule.endDate >= checkIn && appliesOn(rule.daysOfWeek, checkIn)) || (rule.closedToDeparture && rule.startDate <= checkOut && rule.endDate >= checkOut && appliesOn(rule.daysOfWeek, checkOut)) || (rule.minStay && stayNights < rule.minStay) || (rule.maxStay && stayNights > rule.maxStay) || (rule.minAdvanceDays != null && advanceDays < rule.minAdvanceDays) || (rule.maxAdvanceDays != null && advanceDays > rule.maxAdvanceDays))) continue;
    let total = 0; const nightly: Array<{ date: string; rate: number }> = [];
    for (let offset = 0; offset < stayNights; offset += 1) { const stayDate = stayDates[offset]!; let rate = adjust(Number(roomType.baseRate), plan?.adjustmentType ?? "BASE", Number(plan?.adjustment ?? 0)); const season = plan?.seasons.find((item) => item.startDate <= stayDate && item.endDate >= stayDate && appliesOn(item.daysOfWeek, stayDate)); if (season) rate = adjust(rate, season.adjustmentType, Number(season.adjustment)); rate = money(rate); total += rate; nightly.push({ date: stayDate.toISOString().slice(0, 10), rate }); }
    const taxPolicy = (plan?.taxPolicy && typeof plan.taxPolicy === "object" ? plan.taxPolicy : {}) as Record<string, unknown>; const feePolicy = (plan?.feePolicy && typeof plan.feePolicy === "object" ? plan.feePolicy : {}) as Record<string, unknown>; const tax = money(total * Math.max(0, Number(taxPolicy.percent || 0)) / 100); const fees = money(Number(feePolicy.fixed || 0)); const grandTotal = money(total + tax + fees); const channelPolicy = (plan?.channelPolicy && typeof plan.channelPolicy === "object" ? plan.channelPolicy : {}) as Record<string, unknown>; const depositPercent = Math.min(100, Math.max(0, Number(channelPolicy.directDepositPercent ?? 20)));
    quotes.push({ roomType: { id: roomType.id, name: roomType.name, description: roomType.description, capacityAdults: roomType.capacityAdults, capacityChildren: roomType.capacityChildren, images: roomType.images }, ratePlan: plan ? { id: plan.id, name: plan.name, refundable: plan.refundable, mealPlan: plan.mealPlan, cancellationPolicy: plan.cancellationPolicy } : null, currency: roomType.currency, nightly, subtotal: money(total), tax, fees, total: grandTotal, depositAmount: money(grandTotal * depositPercent / 100), available: availability.available });
  }
  return { property, checkIn, checkOut, stayNights, quotes };
}

router.get("/direct/:propertyId", limitPublicNrmsDirectQuote as RequestHandler, (async (req, res: Response) => {
  const parsed = directQuoteSchema.safeParse(req.query); if (!parsed.success) return res.status(400).json({ error: "Choose valid check-in and check-out dates" });
  try { const quote = await directQuote(Number(req.params.propertyId), parsed.data); res.json({ property: { id: quote.property.id, title: quote.property.title }, checkIn: quote.checkIn, checkOut: quote.checkOut, nights: quote.stayNights, quotes: quote.quotes }); }
  catch (error) { if (error instanceof Error && error.message === "PROPERTY_NOT_FOUND") return res.status(404).json({ error: "Direct booking is not available for this property" }); if (error instanceof Error && error.message === "INVALID_DATES") return res.status(400).json({ error: "Stay dates must be future dates with check-out after check-in" }); console.error("[public.nrms.guest] direct quote failed", error); res.status(500).json({ error: "A live quote could not be prepared" }); }
}) as RequestHandler);

router.post("/direct/:propertyId/hold", limitPublicNrmsDirectHold as RequestHandler, (async (req, res: Response) => {
  const parsed = directHoldSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Complete the guest details and accept the booking terms", details: parsed.error.flatten() });
  try {
    const propertyId = Number(req.params.propertyId); const quote = await directQuote(propertyId, parsed.data, parsed.data.roomTypeId, parsed.data.ratePlanId); const selected = quote.quotes.find((item) => item.roomType.id === parsed.data.roomTypeId && (!parsed.data.ratePlanId || item.ratePlan?.id === parsed.data.ratePlanId)); if (!selected) return res.status(409).json({ error: "The selected room or rate is no longer available" });
    const holdExpiresAt = new Date(Date.now() + 30 * 60_000); const publicToken = crypto.randomBytes(24).toString("base64url"); const externalRef = `DIRECT-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
    const result = await prisma.$transaction(async (tx) => {
      await lockPropertyInventory(tx, propertyId); const capacity = await getRoomTypeAvailability(tx, propertyId, selected.roomType.id, quote.checkIn, quote.checkOut); if (capacity.available < 1) return null;
      const existingGuest = await tx.guestProfile.findFirst({ where: { propertyId, phone: parsed.data.guest.phone } });
      const guest = existingGuest
        ? await tx.guestProfile.update({ where: { id: existingGuest.id }, data: { fullName: parsed.data.guest.fullName, email: parsed.data.guest.email, nationality: parsed.data.guest.nationality } })
        : await tx.guestProfile.create({ data: { propertyId, ownerId: quote.property.ownerId, fullName: parsed.data.guest.fullName, phone: parsed.data.guest.phone, email: parsed.data.guest.email, nationality: parsed.data.guest.nationality } });
      const reservation = await tx.reservation.create({ data: { propertyId, ownerId: quote.property.ownerId, guestProfileId: guest.id, source: "DIRECT", attribution: "OWNER_DIRECT", externalRef, status: "HELD", holdExpiresAt, checkIn: quote.checkIn, checkOut: quote.checkOut, adults: parsed.data.adults, children: parsed.data.children, currency: selected.currency, roomRate: selected.nightly[0]?.rate ?? 0, taxAmount: selected.tax, totalAmount: selected.total, depositAmount: selected.depositAmount, notes: `Guest accepted direct booking terms at ${new Date().toISOString()}.`, allocations: { create: { roomTypeId: selected.roomType.id, startDate: quote.checkIn, endDate: quote.checkOut } }, events: { create: { type: "CREATED", data: { source: "DIRECT", ratePlanId: selected.ratePlan?.id ?? null, termsAccepted: true } } } } });
      const paymentRequest = await tx.nrmsGuestPaymentRequest.create({ data: { reservationId: reservation.id, kind: "DEPOSIT", amount: selected.depositAmount || selected.total, currency: selected.currency, publicToken, dueAt: holdExpiresAt, instructions: quote.property.nrmsGuestPayInstructions ?? undefined } }); return { reservation, paymentRequest };
    }, HOLD_TX_OPTIONS);
    if (!result) return res.status(409).json({ error: "The selected room was just booked. Please choose another available option." });
    res.status(201).json({ hold: { reference: result.reservation.externalRef, expiresAt: result.reservation.holdExpiresAt, status: result.reservation.status, total: Number(result.reservation.totalAmount), depositAmount: Number(result.reservation.depositAmount), currency: result.reservation.currency, paymentToken: result.paymentRequest.publicToken } });
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
    const review = await prisma.nrmsReviewRequest.findUnique({ where: { publicToken: req.params.token }, include: { property: { select: { title: true } }, guestProfile: { select: { fullName: true } } } });
    if (!review) return res.status(404).json({ error: "Review request not found" });
    if (!review.openedAt) await prisma.nrmsReviewRequest.update({ where: { id: review.id }, data: { openedAt: new Date(), status: review.status === "SCHEDULED" ? "OPENED" : review.status } });
    res.json({ review: { property: review.property.title, guest: review.guestProfile?.fullName ?? "Guest", status: review.status, rating: review.rating, feedback: review.feedback, respondedAt: review.respondedAt } });
  } catch (error) { console.error("[public.nrms.guest] review request failed", error); res.status(500).json({ error: "Review request could not be loaded" }); }
}) as RequestHandler);

router.post("/reviews/:token", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  const parsed = z.object({ rating: z.number().int().min(1).max(5), feedback: z.string().trim().max(1000).nullable().optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a rating from 1 to 5" });
  try {
    const review = await prisma.nrmsReviewRequest.findUnique({ where: { publicToken: req.params.token } });
    if (!review) return res.status(404).json({ error: "Review request not found" });
    if (review.respondedAt) return res.status(409).json({ error: "This review has already been submitted" });
    const saved = await prisma.nrmsReviewRequest.update({ where: { id: review.id }, data: { rating: parsed.data.rating, feedback: parsed.data.feedback, respondedAt: new Date(), status: "RESPONDED", openedAt: review.openedAt ?? new Date() } });
    res.json({ review: { rating: saved.rating, feedback: saved.feedback, respondedAt: saved.respondedAt } });
  } catch (error) { console.error("[public.nrms.guest] review response failed", error); res.status(500).json({ error: "Review could not be submitted" }); }
}) as RequestHandler);

export default router;

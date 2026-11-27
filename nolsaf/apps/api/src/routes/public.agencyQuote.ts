/**
 * An Agency Desk quote as its client sees it (docs/SALES_AGENCY_QUOTES_STRATEGY.md).
 *
 * GET /api/public/agency-quote/:token   the options, prices, partner display name and status
 *
 * No sign-in: the link only goes to the client's phone; the token is random and
 * only its hash is stored. The client pays through POST /api/public/bookings
 * with { agencyQuote: { token, position } }, which checks the booking is exactly
 * the chosen option. Nothing here reveals owner contacts or other quotes.
 */
import { Router, type RequestHandler, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitAssistedListingNotice } from "../middleware/rateLimit.js";
import { buildPropertySlug, toPublicCard } from "../lib/publicPropertyDto.js";
import { readElectricityRuleFromServices } from "../lib/electricityRule.js";
import { effectiveQuoteStatus, hashQuoteToken, isQuoteToken, isoDay } from "../lib/salesAgencyQuotes.js";

export const publicAgencyQuoteRouter = Router();
const db = prisma as any;
const NOT_FOUND = { error: "This quote link is not valid. Ask your sales partner for a new one." };

publicAgencyQuoteRouter.get("/:token", limitAssistedListingNotice as any, asyncHandler(async (req, res: Response) => {
  const token = String(req.params.token || "");
  if (!isQuoteToken(token)) return res.status(404).json(NOT_FOUND);
  const quote = await db.salesQuote.findUnique({ where: { tokenHash: hashQuoteToken(token) }, include: { options: true } }).catch((e: any) => {
    if (e?.code === "P2021") return null;
    throw e;
  });
  if (!quote) return res.status(404).json(NOT_FOUND);
  const booking = quote.bookingId ? await db.booking.findUnique({ where: { id: quote.bookingId }, select: { status: true } }) : null;
  const status = effectiveQuoteStatus(quote, booking?.status ?? null);
  if (!quote.viewedAt && ["SENT"].includes(status)) {
    await db.salesQuote.updateMany({ where: { id: quote.id, viewedAt: null }, data: { viewedAt: new Date(), status: "VIEWED" } }).catch(() => undefined);
  }

  const partner = await db.salesPartnerProfile.findUnique({ where: { id: quote.salesPartnerId }, select: { agentCode: true, user: { select: { name: true, fullName: true } } } });
  const properties = await db.property.findMany({
    where: { id: { in: quote.options.map((o: any) => o.propertyId) } },
    select: {
      id: true, title: true, type: true, status: true, nrmsBookingKey: true, regionName: true, district: true, ward: true, city: true, country: true,
      basePrice: true, currency: true, roomsSpec: true, services: true, maxGuests: true, totalBedrooms: true, totalBathrooms: true,
      images: { select: { url: true, thumbnailUrl: true, status: true }, orderBy: { createdAt: "asc" }, take: 4 },
    },
  });
  const byId = new Map(properties.map((p: any) => [p.id, p]));

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  return res.json({
    status,
    expiresAt: quote.expiresAt,
    clientName: quote.clientName,
    clientPhone: quote.clientPhone,
    note: quote.note,
    partnerName: partner?.user?.fullName || partner?.user?.name || "Your NoLSAF sales partner",
    partnerCode: partner?.agentCode ?? null,
    chosenPosition: quote.options.find((o: any) => o.id === quote.chosenOptionId)?.position ?? null,
    options: quote.options
      .sort((a: any, b: any) => a.position - b.position)
      .map((o: any) => {
        const p: any = byId.get(o.propertyId);
        const card = p ? toPublicCard(p) : null;
        return {
          position: o.position,
          // The booking route needs the property id; public property pages carry it too.
          propertyId: o.propertyId,
          available: Boolean(p && p.status === "APPROVED"),
          title: p?.title ?? o.priceSnapshot?.title ?? "Property",
          slug: p ? buildPropertySlug(String(p.title || ""), String(p.nrmsBookingKey || "")) : null,
          location: card?.location ?? null,
          photo: card?.primaryImage ?? null,
          roomCode: o.roomCode,
          roomLabel: o.priceSnapshot?.roomLabel ?? null,
          rooms: o.rooms,
          checkIn: isoDay(new Date(o.checkIn)),
          checkOut: isoDay(new Date(o.checkOut)),
          nights: o.nights,
          adults: o.adults,
          children: o.children,
          total: Number(o.totalPrice),
          currency: o.currency,
          electricity: p ? readElectricityRuleFromServices(p.services) : null,
        };
      }),
  });
}) as RequestHandler);

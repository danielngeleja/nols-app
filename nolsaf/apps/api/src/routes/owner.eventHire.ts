import { Router, type RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { customerRecordReference } from "../lib/customerBookingReference.js";
import { listingPhotos, readExtraPhotos, sanitizeEventTerms } from "../lib/eventHire.js";

const router = Router();
router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler);

// This is listing navigation, independent of the event booking rollout switch.
// Filter in the database: another owner's venues and unapproved offerings never
// become sidebar entries or appear on the destination page.
router.get("/approved", asyncHandler(async (req: AuthedRequest, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const rows = await (prisma as any).propertyEventHire.findMany({
      where: { status: "APPROVED", property: { ownerId: req.user!.id, status: "APPROVED", rentalMode: "NIGHTLY" } },
      select: { terms: true, extraPhotos: true, property: { select: { id: true, title: true, regionName: true, district: true, ward: true, photos: true, photoAreas: true } } },
      orderBy: { propertyId: "desc" }, take: 101,
    });
    let hasBookings=false;
    try { hasBookings=Boolean(await (prisma as any).eventHireBooking.findFirst({where:{ownerId:req.user!.id},select:{id:true}})); }
    catch(error:any){if(!["P2021","P2022"].includes(error?.code))throw error;}
    return res.json({ items: rows.slice(0, 100).map((row: any) => {
      const terms = sanitizeEventTerms(row.terms);
      const packages = [
        { price: terms.halfDayPrice, label: "Half day" },
        { price: terms.fullDayPrice, label: "Full day" },
        { price: terms.eveningPrice, label: "Evening" },
      ].filter((p): p is { price: number; label: string } => p.price !== null).sort((a, b) => a.price - b.price);
      const eventPhoto = readExtraPhotos(row.extraPhotos)[0]
        || listingPhotos(row.property.photos, row.property.photoAreas).find(photo => photo.area === "EVENT_SPACE" && /^https:\/\//i.test(photo.url))?.url || null;
      return { ref: customerRecordReference("property", row.property.id), title: row.property.title,
        spaceType: terms.spaceType, capacitySeated: terms.capacitySeated, capacityStanding: terms.capacityStanding,
        photo: eventPhoto, location: [row.property.ward, row.property.district, row.property.regionName].filter(Boolean),
        fromPrice: packages[0]?.price ?? null, priceLabel: packages[0]?.label ?? null,
        eventTypes: terms.eventTypes };
    }), hasMore: rows.length > 100, hasBookings });
  } catch (error: any) {
    if (["P2021", "P2022"].includes(error?.code)) return res.status(503).json({ error: "Event hire is unavailable right now." });
    throw error;
  }
}) as RequestHandler);

export default router;

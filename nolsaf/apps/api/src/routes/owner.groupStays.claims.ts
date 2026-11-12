// apps/api/src/routes/owner.groupStays.claims.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { notifyAgencyPartnerAboutGroup } from "../lib/salesAgencyGroups.js";
import type { RequestHandler } from "express";

const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("OWNER") as unknown as RequestHandler);

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeText(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeKey(v: unknown): string {
  return normalizeText(v)
    .replace(/[\s\-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function normalizeDistrictName(v: unknown): string {
  // Make matching resilient to "District" suffix and spacing.
  return normalizeText(v)
    .replace(/\bdistrict\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getServicesTags(services: unknown): string[] {
  if (!services) return [];
  if (Array.isArray(services)) {
    return services
      .filter((s) => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (typeof services === "object") {
    const tags = (services as any)?.tags;
    if (Array.isArray(tags)) {
      return tags
        .filter((s) => typeof s === "string")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function propertyAllowsGroupStay(services: unknown): boolean {
  const tags = getServicesTags(services);
  return tags.some((t) => normalizeText(t) === "group stay");
}

function propertyTypeToAccommodationKey(propertyType: unknown): string {
  // Property.type is stored as UI label (e.g. "Hotel", "Guest House")
  return normalizeKey(propertyType);
}

function bookingAccommodationKey(accommodationType: unknown): string {
  // GroupBooking.accommodationType is typically lower-case like "hotel"/"guest_house".
  return normalizeKey(accommodationType);
}

function isAccommodationCompatible(requested: string, propertyKey: string): boolean {
  if (!requested || !propertyKey) return false;

  // Direct match works for most cases.
  if (requested === propertyKey) return true;

  // Special cases / legacy compatibility.
  // NOTE: We do not have a distinct Property type "Hostel" in the system UI,
  // so we treat hostel requests as compatible with Hotel or Guest House.
  if (requested === "hostel") {
    return propertyKey === "hotel" || propertyKey === "guest_house";
  }

  if (requested === "guesthouse") {
    return propertyKey === "guest_house";
  }

  return false;
}

function hotelStarLabelToNumber(v: unknown): number | null {
  const s = normalizeText(v);
  if (!s) return null;
  // Stored in DB as label (basic/simple/moderate/high/luxury)
  const map: Record<string, number> = {
    basic: 1,
    simple: 2,
    moderate: 3,
    high: 4,
    luxury: 5,
  };
  if (map[s]) return map[s];
  // Fallback: allow numeric strings 1-5
  const n = Number(s);
  if (Number.isFinite(n) && n >= 1 && n <= 5) return Math.trunc(n);
  return null;
}

/**
 * GET /owner/group-stays/claims/available
 * Get group stays available for owners to claim (open for competitive bidding)
 */
router.get("/available", asyncHandler(async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  
  const r = req as AuthedRequest;
  const ownerId = r.user?.id;
  
  if (!ownerId || typeof ownerId !== "number") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Validate and sanitize query parameters
  const { region, accommodationType, page = "1", pageSize = "50" } = req.query as any;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(pageSize) || 50));

    const where: any = {
      isOpenForClaims: true,
      // Allow all statuses except final states (COMPLETED, CANCELED)
      // If admin opened it for claims, it should be visible regardless of intermediate status
      status: {
        notIn: ["COMPLETED", "CANCELED"],
      },
      // Owners should only see bookings they have NOT already claimed.
      // Claimed bookings belong in the dedicated /my-claims experience.
      claims: {
        none: {
          ownerId,
          status: { not: "WITHDRAWN" },
        },
      },
    };

  if (region) {
    where.toRegion = String(region).trim();
  }

  if (accommodationType) {
    where.accommodationType = String(accommodationType).trim();
  }

  const skip = (pageNum - 1) * pageSizeNum;
  const take = pageSizeNum;

  try {
    const [items, total] = await Promise.all([
      prisma.groupBooking.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
          claims: {
            select: {
              id: true,
              ownerId: true,
              offeredPricePerNight: true,
              discountPercent: true,
              status: true,
            },
            orderBy: { totalAmount: "asc" }, // Show cheapest offers first
            take: 10, // Show more offers including owner's claims
          },
          auditLogs: {
            where: { action: { in: ["OPENED_FOR_CLAIMS", "UPDATED_CLAIMS_SETTINGS"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { metadata: true, createdAt: true },
          },
        },
        orderBy: { openedForClaimsAt: "desc" },
        skip,
        take,
      }),
      prisma.groupBooking.count({ where }),
    ]);

    // Extract deadline from audit metadata if available
    const expiredIds: number[] = [];
    const itemsWithDeadline = items.flatMap((gb: any) => {
      const latestAudit = gb.auditLogs?.[0];
      
      // Parse metadata if it's a string (Prisma might store JSON as string)
      let metadata = latestAudit?.metadata;
      if (metadata && typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata);
        } catch (e) {
          console.error('[API] Failed to parse metadata for group booking', gb.id, e);
          metadata = null;
        }
      }
      
      // Extract deadline from metadata, or use default (7 days from when it was opened)
      let deadline = metadata?.deadline ? new Date(metadata.deadline) : null;
      
      // Fallback: If no deadline was set but group stay is open for claims,
      // use 7 days from when it was opened as default deadline
      if (!deadline && gb.isOpenForClaims && gb.openedForClaimsAt) {
        const defaultDeadline = new Date(gb.openedForClaimsAt);
        defaultDeadline.setDate(defaultDeadline.getDate() + 7); // 7 days from opening
        deadline = defaultDeadline;
      }

      // Auto-close if deadline has passed
      if (deadline && gb.isOpenForClaims && new Date() > deadline) {
        expiredIds.push(gb.id);
        return [];
      }
      
      const minDiscountPercent = metadata?.minDiscountPercent || null;

      const customerMinHotelStar = hotelStarLabelToNumber((gb as any).minHotelStarLabel);
      const adminMinHotelStar = typeof metadata?.minHotelStar === "number" ? metadata.minHotelStar : null;
      const minHotelStar = Math.max(customerMinHotelStar ?? 0, adminMinHotelStar ?? 0) || null;
      
      // Separate claims into owner's claims and other claims
      const ownerClaims = gb.claims.filter((c: any) => c.ownerId === ownerId);
      const otherClaims = gb.claims.filter((c: any) => c.ownerId !== ownerId);
      const hasOwnerClaim = ownerClaims.length > 0 && 
        ownerClaims.some((c: any) => c.status === "PENDING" || c.status === "ACCEPTED");
      
      return [{
        id: gb.id,
        groupType: gb.groupType,
        accommodationType: gb.accommodationType,
        headcount: gb.headcount,
        roomsNeeded: gb.roomsNeeded,
        toRegion: gb.toRegion,
        toDistrict: gb.toDistrict,
        toLocation: gb.toLocation,
        checkIn: gb.checkIn,
        checkOut: gb.checkOut,
        status: gb.status,
        totalAmount: gb.totalAmount,
        currency: gb.currency,
        user: gb.user,
        ownerClaims: ownerClaims,
        otherClaims: otherClaims,
        hasOwnerClaim: hasOwnerClaim,
        existingClaimsCount: gb.claims.length,
        existingClaims: gb.claims, // Keep for backward compatibility
        openedForClaimsAt: gb.openedForClaimsAt,
        submissionDeadline: deadline?.toISOString() || null,
        minDiscountPercent: minDiscountPercent,
        minHotelStar: minHotelStar,
        createdAt: gb.createdAt,
      }];
    });

    // Best-effort auto-close expired claims so they disappear immediately.
    if (expiredIds.length > 0) {
      try {
        await prisma.groupBooking.updateMany({
          where: { id: { in: expiredIds }, isOpenForClaims: true },
          data: { isOpenForClaims: false, openedForClaimsAt: null },
        });

        await prisma.groupBookingMessage.createMany({
          data: expiredIds.map((id) => ({
            groupBookingId: id,
            senderRole: "SYSTEM",
            senderName: "System",
            messageType: "Claims Auto-Closed",
            body: "Competitive claims were closed automatically because the submission deadline was reached.",
            isInternal: true,
          })),
        });
      } catch (e) {
        console.warn("[API] Failed to auto-close expired claims:", e);
      }
    }

    return res.json({
      items: itemsWithDeadline,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (err: any) {
    console.error("Error fetching available group stays for claims:", err);
    return res.status(500).json({ error: "Failed to fetch available group stays" });
  }
}));

/**
 * POST /owner/group-stays/claims
 * Owner submits a claim/offer for a group stay
 */
router.post("/", asyncHandler(async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  
  const r = req as AuthedRequest;
  const ownerId = r.user?.id;
  
  if (!ownerId || typeof ownerId !== "number") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { groupBookingId, propertyId, offeredPricePerNight, discountPercent, specialOffers, notes } = req.body as any;

  // Validate required fields
  if (!groupBookingId || !propertyId || !offeredPricePerNight) {
    return res.status(400).json({ error: "Missing required fields: groupBookingId, propertyId, offeredPricePerNight" });
  }

  const groupBookingIdNum = Number(groupBookingId);
  const propertyIdNum = Number(propertyId);
  const basePricePerNight = Number(offeredPricePerNight);
  const discount = discountPercent ? Number(discountPercent) : null;

  if (!Number.isFinite(groupBookingIdNum) || groupBookingIdNum <= 0) {
    return res.status(400).json({ error: "Invalid group booking ID" });
  }

  if (!Number.isFinite(propertyIdNum) || propertyIdNum <= 0) {
    return res.status(400).json({ error: "Invalid property ID" });
  }

  if (!Number.isFinite(basePricePerNight) || basePricePerNight <= 0) {
    return res.status(400).json({ error: "Invalid base price per night" });
  }

  if (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount > 100)) {
    return res.status(400).json({ error: "Invalid discount percentage (must be 0-100)" });
  }

  class HttpError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }

  try {
    // Use transaction to prevent race conditions
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      // Check if group booking exists and is open for claims
      const groupBooking = await tx.groupBooking.findUnique({
        where: { id: groupBookingIdNum },
        include: {
          user: { select: { id: true, name: true } },
          auditLogs: {
            where: { action: { in: ["OPENED_FOR_CLAIMS", "UPDATED_CLAIMS_SETTINGS"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { metadata: true, createdAt: true },
          },
        },
      });

      if (!groupBooking) {
        throw new HttpError(404, "Group stay not found");
      }

      if (!groupBooking.isOpenForClaims) {
        throw new HttpError(409, "This group stay is not open for claims");
      }

      // Allow all statuses except final states
      if (groupBooking.status === "COMPLETED" || groupBooking.status === "CANCELED") {
        throw new HttpError(409, "Group stay is not available for claiming");
      }

      // Check if owner already has a claim for this group booking
      const existingClaim = await tx.groupBookingClaim.findUnique({
        where: {
          groupBookingId_ownerId: {
            groupBookingId: groupBookingIdNum,
            ownerId: ownerId,
          },
        },
      });

      if (existingClaim) {
        throw new HttpError(409, "You have already submitted a claim for this group stay");
      }

      // Verify property belongs to owner
      const property = await tx.property.findFirst({
        where: {
          id: propertyIdNum,
          ownerId: ownerId,
          status: "APPROVED",
        },
        select: {
          id: true,
          ownerId: true,
          status: true,
          title: true,
          type: true,
          regionName: true,
          district: true,
          services: true,
          hotelStar: true,
        },
      });

      if (!property) {
        throw new HttpError(404, "Property not found or not approved, or you don't own it");
      }

      // === Claim eligibility rules (production enforcement) ===
      // 1) Property must be explicitly enabled for Group Stay (via the "Group stay" tag).
      if (!propertyAllowsGroupStay(property.services)) {
        throw new HttpError(400, "This property is not eligible for group stay claims. Enable 'Group stay' in the property settings first.");
      }

      // 2) Accommodation type must match the request (per-property, not per-owner).
      const requestedAccommodation = bookingAccommodationKey(groupBooking.accommodationType);
      const propertyAccommodation = propertyTypeToAccommodationKey(property.type);
      if (!isAccommodationCompatible(requestedAccommodation, propertyAccommodation)) {
        throw new HttpError(400, `This property type does not match the requested accommodation type (${groupBooking.accommodationType}).`);
      }

      // 3) Location must match the requested destination (region + optional district).
      const bookingRegion = normalizeText(groupBooking.toRegion);
      const bookingDistrict = normalizeDistrictName(groupBooking.toDistrict);
      const propertyRegion = normalizeText(property.regionName);
      const propertyDistrict = normalizeDistrictName(property.district);

      if (!propertyRegion) {
        throw new HttpError(400, "This property is missing a region. Please complete the property location details before claiming.");
      }

      if (bookingRegion && propertyRegion !== bookingRegion) {
        throw new HttpError(400, "This property is not in the requested destination region.");
      }

      if (bookingDistrict) {
        if (!propertyDistrict) {
          throw new HttpError(400, "This property is missing a district. Please complete the property location details before claiming.");
        }
        if (propertyDistrict !== bookingDistrict) {
          throw new HttpError(400, "This property is not in the requested destination district.");
        }
      }

      // 4) Auction constraints set by admin (metadata) must be met.
      const latestAudit = (groupBooking as any).auditLogs?.[0];
      let metadata: any = latestAudit?.metadata ?? null;
      if (metadata && typeof metadata === "string") {
        try {
          metadata = JSON.parse(metadata);
        } catch {
          metadata = null;
        }
      }

      // Submission deadline enforcement: if deadline exists and has passed, reject.
      // Fallback: if not set, default to 7 days from openedForClaimsAt (same as /available).
      let deadline: Date | null = null;
      if (metadata?.deadline) {
        const d = new Date(metadata.deadline);
        if (!Number.isNaN(d.getTime())) deadline = d;
      }
      if (!deadline && groupBooking.isOpenForClaims && groupBooking.openedForClaimsAt) {
        const d = new Date(groupBooking.openedForClaimsAt);
        d.setDate(d.getDate() + 7);
        deadline = d;
      }
      if (deadline && new Date() > deadline) {
        throw new HttpError(409, "Competitive claims are closed: the submission deadline has passed.");
      }

      const minDiscountPercent = typeof metadata?.minDiscountPercent === "number" ? metadata.minDiscountPercent : null;
      if (minDiscountPercent !== null) {
        if (discount === null || discount < minDiscountPercent) {
          throw new HttpError(400, `This auction requires at least ${minDiscountPercent}% discount.`);
        }
      }

      const customerMinHotelStar = hotelStarLabelToNumber((groupBooking as any).minHotelStarLabel);
      const adminMinHotelStar = typeof metadata?.minHotelStar === "number" ? metadata.minHotelStar : null;
      const minHotelStar = Math.max(customerMinHotelStar ?? 0, adminMinHotelStar ?? 0) || null;
      if (minHotelStar !== null) {
        const propertyStar = hotelStarLabelToNumber(property.hotelStar);
        if (propertyStar === null || propertyStar < minHotelStar) {
          throw new HttpError(400, `This auction requires a hotel star rating of at least ${minHotelStar}.`);
        }
      }

      // Calculate the owner amount from the base nightly price and discount.
      // The server is the source of truth; client-side totals are preview only.
      const checkIn = groupBooking.checkIn ? new Date(groupBooking.checkIn) : null;
      const checkOut = groupBooking.checkOut ? new Date(groupBooking.checkOut) : null;
      const nights = checkIn && checkOut ? Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24))) : 1;
      const rooms = Math.max(1, Number(groupBooking.roomsNeeded || 1));
      const discountAmountPerNight = roundMoney(basePricePerNight * ((discount ?? 0) / 100));
      const finalPricePerNight = roundMoney(Math.max(0, basePricePerNight - discountAmountPerNight));
      const totalAmount = roundMoney(finalPricePerNight * nights * rooms);

      // Create the claim
      const claim = await tx.groupBookingClaim.create({
        data: {
          groupBookingId: groupBookingIdNum,
          ownerId: ownerId,
          propertyId: propertyIdNum,
          offeredPricePerNight: basePricePerNight,
          discountPercent: discount,
          specialOffers: specialOffers ? String(specialOffers).trim() : null,
          notes: notes ? String(notes).trim() : null,
          totalAmount,
          currency: groupBooking.currency || "TZS",
          status: "PENDING",
        },
        include: {
          property: {
            select: { id: true, title: true, type: true, regionName: true },
          },
          groupBooking: {
            select: { id: true, headcount: true, roomsNeeded: true, toRegion: true },
          },
        },
      });

      return claim;
    });

    // Agency groups: the sales partner shortlists, so tell them an offer is in.
    void notifyAgencyPartnerAboutGroup(prisma, result.groupBookingId, "offer");

    return res.json({
      success: true,
      claim: {
        id: result.id,
        groupBookingId: result.groupBookingId,
        propertyId: result.propertyId,
        offeredPricePerNight: result.offeredPricePerNight,
        discountPercent: result.discountPercent,
        specialOffers: result.specialOffers,
        totalAmount: result.totalAmount,
        currency: result.currency,
        status: result.status,
        property: result.property,
        groupBooking: result.groupBooking,
        createdAt: result.createdAt,
      },
    });
  } catch (err: any) {
    console.error("Error creating group stay claim:", err);
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    return res.status(500).json({ error: err?.message || "Failed to submit claim" });
  }
}));

/**
 * GET /owner/group-stays/claims/my-claims
 * Get owner's submitted claims
 */
router.get("/my-claims", asyncHandler(async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  
  const r = req as AuthedRequest;
  const ownerId = r.user?.id;
  
  if (!ownerId || typeof ownerId !== "number") {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { status, page = "1", pageSize = "50" } = req.query as any;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSizeNum = Math.min(100, Math.max(1, Number(pageSize) || 50));

  const where: any = {
    ownerId: ownerId,
  };

  if (status) {
    where.status = String(status).trim().toUpperCase();
  }

  const skip = (pageNum - 1) * pageSizeNum;
  const take = pageSizeNum;

  try {
    const [items, total] = await Promise.all([
      prisma.groupBookingClaim.findMany({
        where,
        include: {
          groupBooking: {
            select: {
              id: true,
              headcount: true,
              roomsNeeded: true,
              toRegion: true,
              checkIn: true,
              checkOut: true,
              user: {
                select: { id: true, name: true, email: true, phone: true },
              },
            },
          },
          property: {
            select: { 
              id: true, 
              title: true, 
              type: true, 
              regionName: true,
              owner: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      prisma.groupBookingClaim.count({ where }),
    ]);

    return res.json({
      items,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (err: any) {
    console.error("Error fetching owner claims:", err);
    return res.status(500).json({
      error: "Failed to fetch claims",
    });
  }
}));

export default router;


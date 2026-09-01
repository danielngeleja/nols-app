import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { limitPlanRequestMessages } from "../middleware/rateLimit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import { getAzamPayToken, invalidateAzamPayToken } from "../lib/azampay.auth.js";
import {
  normalizePhone,
  azampayPost,
  describeAzamPayResponseBody,
  makePaymentRateLimiter,
} from "../lib/azampay.helpers.js";
import {
  CORAL_UCF_API_URL,
  coralPostJson64,
  parseCoralInitiateResponse,
} from "../lib/coralcommerce.helpers.js";
import { loadGroupStayDepositReceipt, loadGroupStayDepositReceiptData } from "../lib/groupStayReceipts.js";
import { signGroupStayReceiptToken } from "../lib/groupStayReceiptToken.js";
import { getEffectiveCommissionPercent, roundMoney } from "../lib/accommodationPayout.js";
import { mapGroupStayLifecycle } from "../lib/serviceLifecycle.js";
import { getPaymentMethodAvailability } from "../lib/serviceAvailability.js";
import { verifyMnoWalletForCheckout } from "../services/azampay/mnoPreflight.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

// ── Rate limiter for deposit payment initiation ─────────────────────────────
const depositPaymentLimiter = makePaymentRateLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 4,
  keyFn: (req: any) => `group-stay-deposit:${req.user?.id || req.ip || "anon"}`,
});
function coerceIdArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN))
    .filter((v) => Number.isFinite(v));
}

/**
 * GET /api/customer/group-stays
 * Get all group stay bookings for the authenticated customer
 * Query params: status, page, pageSize
 */
router.get("/", async (req, res) => {
  try {
    // Explicitly set Content-Type to JSON
    res.setHeader('Content-Type', 'application/json');
    
    const userId = (req as AuthedRequest).user!.id;
    const { status, page = "1", pageSize = "20" } = req.query as any;
    
    const where: any = { userId };
    
    // Apply status filter if provided
    if (status) {
      where.status = String(status);
    }
    // Note: We return all bookings (including PENDING) so frontend can:
    // 1. Calculate accurate counts for filter buttons
    // 2. Show PENDING in "Pending" filter
    // 3. Hide PENDING from "All" filter (handled on frontend)
    // Visibility is controlled on frontend.

    const pageNum = Number(page);
    const pageSizeNum = Number(pageSize);
    const skip = (pageNum - 1) * pageSizeNum;

    const [groupBookings, total] = await Promise.all([
      prisma.groupBooking.findMany({
        where,
        include: {
          passengers: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true,
              nationality: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSizeNum,
      }),
      prisma.groupBooking.count({ where }),
    ]);

    const now = new Date();
    const groupStaysWithValidity = (groupBookings as any[]).map((gb: any) => {
      const checkOut = gb.checkOut ? new Date(gb.checkOut) : null;
      // For PENDING bookings, they're still valid (waiting for admin review)
      // For other bookings, check if checkout date hasn't passed and not canceled
      const isValid = gb.status === "PENDING" 
        ? true 
        : checkOut 
          ? checkOut >= now && gb.status !== "CANCELED" 
          : gb.status !== "CANCELED" && gb.status !== "COMPLETED";
      
      // Format passengers to match frontend expectations
      const formattedPassengers = gb.passengers?.map((p: any) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        phone: p.phone,
        nationality: p.nationality,
      })) || [];
      
      // Calculate number of guests from passengers or headcount
      const numberOfGuests = formattedPassengers.length > 0 
        ? formattedPassengers.length 
        : (gb.headcount || 0);
      
      // Create a mock arrangement object for compatibility with frontend
      // Since group bookings don't have arrangements initially, we'll use booking data
      const destinationTitle = gb.toLocation 
        ? `${gb.toLocation}${gb.toWard ? `, ${gb.toWard}` : ''}${gb.toDistrict ? `, ${gb.toDistrict}` : ''}`
        : gb.toRegion || "Group Stay";
      
      // Parse admin notes/suggestions if available
      let adminSuggestions: any = null;
      if (gb.adminNotes) {
        try {
          adminSuggestions = typeof gb.adminNotes === 'string' 
            ? JSON.parse(gb.adminNotes) 
            : gb.adminNotes;
        } catch (e) {
          // If parsing fails, treat as plain text
          adminSuggestions = { notes: gb.adminNotes };
        }
      }
      
      return {
        id: gb.id,
        auction: {
          isOpenForClaims: gb.isOpenForClaims,
          recommendedPropertyCount: coerceIdArray(gb.recommendedPropertyIds).length,
          confirmedPropertyId: gb.confirmedPropertyId ?? null,
        },
        arrangement: {
          id: gb.id, // Use booking ID as arrangement ID
          property: {
            id: 0, // No property assigned yet for pending bookings
            title: destinationTitle,
            type: gb.accommodationType || "Group Accommodation",
            regionName: gb.toRegion,
            district: gb.toDistrict,
            city: gb.toWard,
          },
        },
        checkIn: gb.checkIn,
        checkOut: gb.checkOut,
        status: gb.status,
        totalAmount: gb.totalAmount,
        depositAmount: gb.depositAmount != null ? Number(gb.depositAmount) : null,
        ownerAmount: gb.ownerAmount != null ? Number(gb.ownerAmount) : null,
        commissionPercent: gb.commissionPercent != null ? Number(gb.commissionPercent) : null,
        depositPaid: Boolean(gb.depositPaid),
        depositPaidAt: gb.depositPaidAt ?? null,
        depositDueAt: gb.depositDueAt ?? null,
        currency: gb.currency,
        numberOfGuests,
        passengers: formattedPassengers,
        isValid,
        createdAt: gb.createdAt,
        updatedAt: gb.updatedAt,
        adminSuggestions, // Include admin suggestions/messages
        lifecycle: mapGroupStayLifecycle({
          bookingStatus: gb.status,
          depositPaid: Boolean(gb.depositPaid),
          depositPaidAt: gb.depositPaidAt,
          depositAmount: gb.depositAmount,
          depositExpired: gb.status === "AWAITING_DEPOSIT" && !gb.depositPaid && Boolean(gb.depositDueAt) && new Date(gb.depositDueAt).getTime() < now.getTime(),
          confirmedPropertyId: gb.confirmedPropertyId,
          cancellationLoaded: false,
        }),
        deposit: {
          amount: gb.depositAmount != null ? Number(gb.depositAmount) : null,
          paid: gb.depositPaid === true,
          paidAt: gb.depositPaidAt ?? null,
          dueAt: gb.depositDueAt ?? null,
          currency: gb.currency || "TZS",
          commissionPercent: gb.commissionPercent != null ? Number(gb.commissionPercent) : null,
          ownerAmount: gb.ownerAmount != null ? Number(gb.ownerAmount) : null,
          // Deposit window lapsed without payment while awaiting it.
          expired:
            gb.status === "AWAITING_DEPOSIT" &&
            !gb.depositPaid &&
            !!gb.depositDueAt &&
            new Date(gb.depositDueAt).getTime() < now.getTime(),
        },
      };
    });

    return res.json({
      items: groupStaysWithValidity,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (error: any) {
    console.error("GET /customer/group-stays error:", error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: "Failed to fetch group stays", message: error?.message || 'Unknown error' });
  }
});

/**
 * GET /api/customer/group-stays/:id/auction-offers
 * Returns the 3 admin-selected auction offers (from owner claims).
 */
router.get("/:id/auction-offers", async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    const userId = (req as AuthedRequest).user!.id;
    const bookingId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ error: "Invalid booking id" });
    }

    const booking = await prisma.groupBooking.findFirst({
      where: { id: bookingId, userId },
      select: {
        id: true,
        status: true,
        isOpenForClaims: true,
        recommendedPropertyIds: true,
        confirmedPropertyId: true,
        roomsNeeded: true,
        checkIn: true,
        checkOut: true,
      },
    });

    if (!booking) {
      return res.status(404).json({ error: "Group booking not found or access denied" });
    }

    const recommendedIds = coerceIdArray((booking as any).recommendedPropertyIds);
    if (recommendedIds.length === 0) {
      return res.json({
        bookingId,
        confirmedPropertyId: booking.confirmedPropertyId ?? null,
        offers: [],
      });
    }

    const claims = await (prisma as any).groupBookingClaim.findMany({
      where: {
        groupBookingId: bookingId,
        propertyId: { in: recommendedIds },
        status: { not: "WITHDRAWN" },
      },
      include: {
        property: {
          select: {
            id: true,
            title: true,
            type: true,
            regionName: true,
            district: true,
            ward: true,
            city: true,
            services: true,
            images: {
              select: {
                url: true,
                thumbnailUrl: true,
                status: true,
              },
              orderBy: { createdAt: "asc" },
              take: 3,
            },
          },
        },
      },
      orderBy: { totalAmount: "asc" },
    });

    const roomsNeeded = Math.max(1, Number((booking as any).roomsNeeded || 1));
    const checkIn = (booking as any).checkIn ? new Date((booking as any).checkIn) : null;
    const checkOut = (booking as any).checkOut ? new Date((booking as any).checkOut) : null;
    const nights = checkIn && checkOut
      ? Math.max(1, Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)))
      : 1;

    const offers = (await Promise.all((claims as any[]).map(async (c: any) => {
      const ownerBasePricePerNight = roundMoney(Number(c.offeredPricePerNight || 0));
      const discountPercent = Number(c.discountPercent || 0);
      const ownerDiscountedPricePerNight = roundMoney(Math.max(0, ownerBasePricePerNight * (1 - Math.max(0, Math.min(100, discountPercent)) / 100)));
      const ownerTotalAmount = roundMoney(Number(c.totalAmount || (ownerDiscountedPricePerNight * nights * roomsNeeded)));
      const commissionPercent = await getEffectiveCommissionPercent(c.property?.services);
      const multiplier = 1 + commissionPercent / 100;
      const customerOriginalPricePerNight = roundMoney(ownerBasePricePerNight * multiplier);
      const customerPricePerNight = roundMoney(ownerDiscountedPricePerNight * multiplier);
      const customerTotalAmount = roundMoney(ownerTotalAmount * multiplier);
      const customerOriginalTotalAmount = roundMoney(customerOriginalPricePerNight * nights * roomsNeeded);
      const customerSavingsAmount = roundMoney(Math.max(0, customerOriginalTotalAmount - customerTotalAmount));

      return {
        claimId: c.id,
        property: {
          id: c.property?.id,
          title: c.property?.title,
          type: c.property?.type,
          regionName: c.property?.regionName,
          district: c.property?.district,
          ward: c.property?.ward,
          city: c.property?.city,
          imageUrl:
            c.property?.images?.find((img: any) => img?.status === "READY")?.thumbnailUrl ||
            c.property?.images?.find((img: any) => img?.status === "READY")?.url ||
            c.property?.images?.[0]?.thumbnailUrl ||
            c.property?.images?.[0]?.url ||
            null,
        },
        offer: {
          offeredPricePerNight: c.offeredPricePerNight,
          discountPercent: c.discountPercent,
          totalAmount: c.totalAmount,
          customerPricePerNight,
          customerOriginalPricePerNight,
          customerTotalAmount,
          customerOriginalTotalAmount,
          customerSavingsAmount,
          currency: c.currency,
          specialOffers: c.specialOffers,
          notes: c.notes,
        },
      };
    })))
      // preserve admin ordering, but always keep only the recommended set
      .sort((a: any, b: any) => recommendedIds.indexOf(a.property.id) - recommendedIds.indexOf(b.property.id));

    return res.json({
      bookingId,
      confirmedPropertyId: booking.confirmedPropertyId ?? null,
      offers,
    });
  } catch (error: any) {
    console.error("GET /customer/group-stays/:id/auction-offers error:", error);
    return res.status(500).json({ error: "Failed to fetch auction offers" });
  }
});

/**
 * POST /api/customer/group-stays/:id/auction-confirm
 * Customer selects one of the admin-shortlisted offers.
 */
router.post("/:id/auction-confirm", async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    const userId = (req as AuthedRequest).user!.id;
    const bookingId = parseInt(String(req.params.id), 10);
    const propertyId = Number((req as any).body?.propertyId);

    if (!Number.isFinite(bookingId) || !Number.isFinite(propertyId)) {
      return res.status(400).json({ error: "Invalid bookingId or propertyId" });
    }

    const booking = await prisma.groupBooking.findFirst({
      where: { id: bookingId, userId },
      select: {
        id: true,
        status: true,
        recommendedPropertyIds: true,
        confirmedPropertyId: true,
        checkIn: true,
        checkOut: true,
        roomsNeeded: true,
        toRegion: true,
        toDistrict: true,
      },
    });

    if (!booking) {
      return res.status(404).json({ error: "Group booking not found or access denied" });
    }
    if (booking.confirmedPropertyId) {
      return res.status(409).json({ error: "A property has already been confirmed" });
    }

    const recommendedIds = coerceIdArray((booking as any).recommendedPropertyIds);
    if (!recommendedIds.includes(propertyId)) {
      return res.status(400).json({ error: "Selected property is not part of the shortlisted offers" });
    }

    const claim = await (prisma as any).groupBookingClaim.findFirst({
      where: {
        groupBookingId: bookingId,
        propertyId,
        status: { not: "WITHDRAWN" },
      },
      select: {
        id: true,
        ownerId: true,
        totalAmount: true,
        currency: true,
        property: { select: { services: true } },
      },
    });

    if (!claim) {
      return res.status(400).json({ error: "Offer not found for the selected property" });
    }

    const now = new Date();
    const ownerAmount = roundMoney(Number(claim.totalAmount ?? 0));
    const commissionPercent = await getEffectiveCommissionPercent(claim.property?.services);
    const commissionAmount = roundMoney(ownerAmount * (commissionPercent / 100));
    const totalAmount = roundMoney(ownerAmount + commissionAmount);
    const depositAmount = commissionAmount;
    const depositDueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    await (prisma as any).groupBooking.update({
      where: { id: bookingId },
      data: {
        confirmedPropertyId: propertyId,
        propertyConfirmedAt: now,
        status: "AWAITING_DEPOSIT",
        confirmedAt: null,
        assignedOwnerId: claim.ownerId,
        ownerAssignedAt: now,
        isOpenForClaims: false,
        totalAmount,
        ownerAmount,
        commissionPercent,
        currency: claim.currency,
        depositAmount,
        depositPaid: false,
        depositPaidAt: null,
        depositDueAt,
      },
    });

    // Keep the chosen claim in REVIEWING (NOT accepted yet) and reject the other
    // shortlisted offers. The winning claim only becomes ACCEPTED once the customer
    // actually pays the deposit (see markGroupBookingDepositPaid) — until then the
    // owner must not see their offer as "100% accepted".
    let rejectedOwnerIds: number[] = [];
    try {
      await (prisma as any).groupBookingClaim.update({
        where: { id: claim.id },
        data: { status: "REVIEWING", reviewedAt: now },
      });

      // Capture the owners we're about to turn down so we can notify them kindly.
      const losingClaims = await (prisma as any).groupBookingClaim.findMany({
        where: {
          groupBookingId: bookingId,
          propertyId: { in: recommendedIds.filter((id) => id !== propertyId) },
          status: "PENDING",
        },
        select: { ownerId: true },
      });
      rejectedOwnerIds = Array.from(
        new Set(
          losingClaims
            .map((c: any) => Number(c.ownerId))
            .filter((v: number) => Number.isFinite(v))
        )
      );

      await (prisma as any).groupBookingClaim.updateMany({
        where: {
          groupBookingId: bookingId,
          propertyId: { in: recommendedIds.filter((id) => id !== propertyId) },
          status: "PENDING",
        },
        data: { status: "REJECTED", reviewedAt: now },
      });
    } catch {
      // claim status updates are best-effort
    }

    // Let the owners who weren't selected down gently — a respectful note rather
    // than leaving them to discover a bare "Rejected" badge on their own.
    if (rejectedOwnerIds.length > 0) {
      const destination = [booking.toDistrict, booking.toRegion].filter(Boolean).join(", ");
      await Promise.all(
        rejectedOwnerIds.map((ownerId) =>
          notifyUser(ownerId, "group_stay_update", {
            title: "Thank you for your group stay offer",
            body:
              `Thank you for your offer on group stay #${bookingId}` +
              `${destination ? ` to ${destination}` : ""}. ` +
              `The guest has chosen another property this time, so your offer wasn't taken forward. ` +
              `We really appreciate you taking part. More group stay requests come in regularly, ` +
              `and we'd love to see your next offer.`,
            groupBookingId: bookingId,
          }).catch(() => {
            /* notifications are best-effort */
          })
        )
      );
    }

    try {
      await (prisma as any).groupBookingAudit.create({
        data: {
          groupBookingId: bookingId,
          adminId: userId,
          action: "CUSTOMER_CONFIRMED_AUCTION_PROPERTY",
          description: `Customer confirmed auction propertyId=${propertyId}`,
          metadata: {
            propertyId,
            ownerAmount,
            commissionPercent,
            totalAmount,
            depositAmount,
            depositDueAt,
          },
          createdAt: now,
        },
      });
    } catch {
      // audit is best-effort
    }

    return res.json({ ok: true, bookingId, propertyId, ownerAmount, commissionPercent, totalAmount, depositAmount, depositDueAt, status: "AWAITING_DEPOSIT" });
  } catch (error: any) {
    console.error("POST /customer/group-stays/:id/auction-confirm error:", error);
    return res.status(500).json({ error: "Failed to confirm auction offer" });
  }
});

/**
 * GET /api/customer/group-stays/:id/deposit-status
 * Poll the deposit payment status for a group booking
 */
router.get("/:id/deposit-status", async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    const userId = (req as AuthedRequest).user!.id;
    const bookingId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ ok: false, error: "Invalid booking id" });
    }

    const booking = await prisma.groupBooking.findFirst({
      where: { id: bookingId, userId },
      select: {
        status: true,
        totalAmount: true,
        ownerAmount: true,
        commissionPercent: true,
        currency: true,
        depositAmount: true,
        depositPaid: true,
        depositPaidAt: true,
        depositDueAt: true,
      },
    });

    if (!booking) {
      return res.status(404).json({ ok: false, error: "Group booking not found or access denied" });
    }

    return res.json({
      ok: true,
      status: booking.status,
      totalAmount: booking.totalAmount != null ? Number(booking.totalAmount) : null,
      ownerAmount: booking.ownerAmount != null ? Number(booking.ownerAmount) : null,
      commissionPercent: booking.commissionPercent != null ? Number(booking.commissionPercent) : null,
      currency: booking.currency,
      depositAmount: booking.depositAmount != null ? Number(booking.depositAmount) : null,
      depositPaid: booking.depositPaid,
      depositPaidAt: booking.depositPaidAt,
      depositDueAt: (booking as any).depositDueAt ?? null,
    });
  } catch (error: any) {
    console.error("GET /customer/group-stays/:id/deposit-status error:", error);
    return res.status(500).json({ ok: false, error: "Failed to load deposit status" });
  }
});

/**
 * GET /api/customer/group-stays/:id/deposit-receipt
 * Download a PDF receipt for a paid group stay deposit.
 */
router.get("/:id/deposit-receipt", async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user!.id;
    const bookingId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ ok: false, error: "Invalid booking id" });
    }

    const result = await loadGroupStayDepositReceipt(bookingId, userId);
    if (!result.ok) {
      return res.status(result.status).json({ ok: false, error: result.error, message: result.message });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
    res.setHeader("Content-Length", String(result.buffer.length));
    return res.send(result.buffer);
  } catch (error: any) {
    console.error("GET /customer/group-stays/:id/deposit-receipt error:", error);
    return res.status(500).json({ ok: false, error: "Failed to generate deposit receipt" });
  }
});

router.get("/:id/deposit-receipt-data", async (req, res) => {
  const userId = (req as AuthedRequest).user!.id;
  const bookingId = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(bookingId)) return res.status(400).json({ ok: false, error: "Invalid booking id" });
  const result = await loadGroupStayDepositReceiptData(bookingId, userId);
  if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error, message: result.message });
  return res.json({ ok: true, receipt: result.receipt });
});

/**
 * GET /api/customer/group-stays/:id/deposit-receipt-token
 * Issue a short-lived token the mobile app can use to open the receipt PDF
 * in the device browser/viewer (which cannot send an Authorization header).
 */
router.get("/:id/deposit-receipt-token", async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user!.id;
    const bookingId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ ok: false, error: "Invalid booking id" });
    }

    const booking = await prisma.groupBooking.findFirst({
      where: { id: bookingId, userId },
      select: { id: true, depositPaid: true },
    });
    if (!booking) {
      return res.status(404).json({ ok: false, error: "Group booking not found or access denied" });
    }
    if (!booking.depositPaid) {
      return res.status(400).json({ ok: false, error: "deposit_not_paid", message: "No deposit payment has been recorded for this booking yet." });
    }

    const token = signGroupStayReceiptToken(booking.id, userId);
    return res.json({ ok: true, token });
  } catch (error: any) {
    console.error("GET /customer/group-stays/:id/deposit-receipt-token error:", error);
    return res.status(500).json({ ok: false, error: "Failed to issue receipt token" });
  }
});

const initiateMnoSchema = z.object({
  phoneNumber: z.string().min(9).max(15),
  provider: z.enum(["Airtel", "Tigo", "Mpesa", "Halopesa", "Azampesa"]).default("Airtel"),
});

const initiateBankSchema = z.object({
  bankCode: z.enum(["CRDB", "NMB"]),
  accountNumber: z.string().min(1).max(30).regex(/^[\w-]+$/),
  merchantMobileNumber: z.string().min(9).max(15).regex(/^[\d+]+$/),
  otp: z.string().min(1).max(50),
});

async function loadAwaitingDepositBooking(bookingId: number, userId: number) {
  const booking = await prisma.groupBooking.findFirst({
    where: { id: bookingId, userId },
    select: {
      id: true,
      status: true,
      depositAmount: true,
      depositPaid: true,
      currency: true,
      paymentRef: true,
      depositDueAt: true,
    },
  });

  if (!booking) {
    return { ok: false, error: { status: 404, body: { ok: false, error: "not_found", message: "Group booking not found or access denied" } } } as const;
  }
  if (booking.status.toUpperCase() !== "AWAITING_DEPOSIT" || booking.depositPaid) {
    return { ok: false, error: { status: 400, body: { ok: false, error: "not_awaiting_deposit", message: "This booking is not awaiting a deposit payment." } } } as const;
  }
  if ((booking as any).depositDueAt && new Date((booking as any).depositDueAt).getTime() < Date.now()) {
    return { ok: false, error: { status: 400, body: { ok: false, error: "deposit_expired", message: "The deposit window for this offer has expired. Please request a new group stay offer." } } } as const;
  }
  const depositAmount = Math.round(Number(booking.depositAmount || 0));
  if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
    return { ok: false, error: { status: 400, body: { ok: false, error: "invalid_amount", message: "This booking has no payable deposit amount." } } } as const;
  }
  const currency = booking.currency || "TZS";
  if (currency !== "TZS") {
    return { ok: false, error: { status: 400, body: { ok: false, error: "currency_not_supported", message: "Deposit payments are only available for TZS bookings." } } } as const;
  }

  return { ok: true, booking, depositAmount, currency } as const;
}

/**
 * POST /api/customer/group-stays/:id/deposit/initiate-mno
 * Start a mobile-money (AzamPay PostCheckout) deposit payment
 */
router.post("/:id/deposit/initiate-mno", depositPaymentLimiter, async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    const userId = (req as AuthedRequest).user!.id;
    const bookingId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const parsed = initiateMnoSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "validation_error", details: parsed.error.flatten() });
    }
    const { phoneNumber, provider } = parsed.data;

    const providerGate = await getPaymentMethodAvailability(provider);
    if (!providerGate.enabled) {
      return res.status(400).json({ ok: false, error: "payment_method_unavailable", message: providerGate.reason });
    }

    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone) {
      return res.status(400).json({
        ok: false,
        error: "invalid_phone",
        message: "Please enter a valid Tanzanian phone number (e.g. +255712345678 or 0712345678).",
      });
    }

    const result = await loadAwaitingDepositBooking(bookingId, userId);
    if (!result.ok) {
      return res.status(result.error.status).json(result.error.body);
    }
    const { booking, depositAmount, currency } = result;

    const walletPreflight = await verifyMnoWalletForCheckout({ phoneNumber: normalizedPhone, provider });
    if (!walletPreflight.ok) {
      return res.status(walletPreflight.status).json({
        ok: false,
        error: walletPreflight.code,
        message: walletPreflight.message,
      });
    }

    const paymentRef = booking.paymentRef ?? `GBDEP-${booking.id}-${Date.now()}`;

    const azampayBody = {
      accountNumber: normalizedPhone,
      amount: depositAmount.toString(),
      currency,
      externalId: paymentRef,
      language: "SW",
      provider,
      additionalProperties: {
        groupBookingId: booking.id.toString(),
        kind: "GROUP_STAY_DEPOSIT",
      },
    };

    let token: string;
    try {
      token = await getAzamPayToken();
    } catch {
      return res.status(503).json({ ok: false, error: "payment_unavailable", message: "Payment service temporarily unavailable." });
    }

    let apiRes = await azampayPost("/api/v1/Partner/PostCheckout", azampayBody, token);
    if (apiRes.status === 401) {
      await invalidateAzamPayToken();
      try { token = await getAzamPayToken(); } catch { /* handled below */ }
      apiRes = await azampayPost("/api/v1/Partner/PostCheckout", azampayBody, token!);
    }

    if (!apiRes.ok) {
      console.error(`[GroupStayDeposit/MNO] Checkout HTTP ${apiRes.status} — body: ${apiRes.body.slice(0, 500)}`);
      return res.status(502).json({ ok: false, error: "payment_failed", message: "Payment could not be initiated. Please try again." });
    }

    const responseSummary = describeAzamPayResponseBody(apiRes.body);
    let azampayData: any = { transactionId: responseSummary.transactionId };
    {
      const trimmed = apiRes.body.trim();
      if (!trimmed || trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
        // Empty 200 (push ack) OR sandbox debug URL — both mean "push sent"
      } else {
        try {
          const parsed = JSON.parse(trimmed);
          azampayData = { transactionId: parsed.transactionId ?? null };
        } catch {
          console.error(`[GroupStayDeposit/MNO] Non-JSON response HTTP ${apiRes.status} — body: ${trimmed.slice(0, 500)}`);
          return res.status(502).json({ ok: false, error: "payment_failed", message: "Unexpected response from payment provider." });
        }
      }
    }

    await prisma.groupBooking.update({
      where: { id: booking.id },
      data: {
        paymentRef: booking.paymentRef ?? paymentRef,
        payerPhone: normalizedPhone,
        paymentProvider: "AZAMPAY",
        checkoutSessionId: azampayData.transactionId ?? null,
      },
    });

    try {
      await prisma.paymentEvent.create({
        data: {
          provider: "AZAMPAY",
          eventId: azampayData.transactionId ?? `${paymentRef}-${Date.now()}`,
          groupBookingId: booking.id,
          amount: depositAmount,
          currency,
          status: "PENDING",
          paymentChannel: "MNO",
          phone: normalizedPhone,
          payload: {
            transactionId: azampayData.transactionId ?? null,
            paymentRef,
            phoneNumber: normalizedPhone,
            provider,
            azampayResponse: responseSummary,
          },
        },
      });
    } catch (dbErr: any) {
      console.warn("[GroupStayDeposit/MNO] Failed to create PaymentEvent:", dbErr?.message ?? dbErr);
    }

    return res.json({
      ok: true,
      transactionId: azampayData.transactionId ?? paymentRef,
      paymentRef,
      status: "PENDING",
    });
  } catch (error: any) {
    console.error("POST /customer/group-stays/:id/deposit/initiate-mno error:", error);
    return res.status(500).json({ ok: false, error: "Failed to initiate deposit payment" });
  }
});

/**
 * POST /api/customer/group-stays/:id/deposit/initiate-bank
 * Start a bank-transfer (AzamPay BankCheckout) deposit payment
 */
router.post("/:id/deposit/initiate-bank", depositPaymentLimiter, async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    const userId = (req as AuthedRequest).user!.id;
    const bookingId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const parsed = initiateBankSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "validation_error", details: parsed.error.flatten() });
    }
    const { bankCode, accountNumber, merchantMobileNumber, otp } = parsed.data;
    const bankGate = await getPaymentMethodAvailability(`BANK_${bankCode}`);
    if (!bankGate.enabled) {
      return res.status(400).json({ ok: false, error: "payment_method_unavailable", message: bankGate.reason });
    }
    const normalizedBankMobile = normalizePhone(merchantMobileNumber);
    if (!normalizedBankMobile) {
      return res.status(400).json({
        ok: false,
        error: "invalid_phone",
        message: "Please enter a valid mobile number registered with your bank account.",
      });
    }
    const azamBankMobileNumber = normalizedBankMobile.replace(/^\+/, "");

    const result = await loadAwaitingDepositBooking(bookingId, userId);
    if (!result.ok) {
      return res.status(result.error.status).json(result.error.body);
    }
    const { booking, depositAmount, currency } = result;

    const paymentRef = booking.paymentRef ?? `GBDEP-BANK-${booking.id}-${Date.now()}`;

    const azampayBody = {
      amount: depositAmount.toString(),
      currencyCode: currency,
      merchantAccountNumber: accountNumber,
      merchantMobileNumber: azamBankMobileNumber,
      merchantName: process.env.AZAMPAY_APP_NAME || "NoLSAF",
      otp,
      provider: bankCode,
      referenceId: paymentRef,
      additionalProperties: {
        groupBookingId: booking.id.toString(),
        kind: "GROUP_STAY_DEPOSIT",
      },
    };

    let token: string;
    try {
      token = await getAzamPayToken();
    } catch {
      return res.status(503).json({ ok: false, error: "payment_unavailable", message: "Payment service temporarily unavailable." });
    }

    let apiRes = await azampayPost("/api/v1/Partner/BankCheckout", azampayBody, token);
    if (apiRes.status === 401) {
      await invalidateAzamPayToken();
      try { token = await getAzamPayToken(); } catch { /* handled below */ }
      apiRes = await azampayPost("/api/v1/Partner/BankCheckout", azampayBody, token!);
    }
    if (!apiRes.ok) {
      console.error(`[GroupStayDeposit/Bank] Checkout HTTP ${apiRes.status} — body: ${apiRes.body.slice(0, 500)}`);
      return res.status(502).json({ ok: false, error: "payment_failed", message: "Bank payment could not be initiated." });
    }

    let azampayData: any;
    try {
      azampayData = JSON.parse(apiRes.body);
    } catch {
      console.error(`[GroupStayDeposit/Bank] Non-JSON response HTTP ${apiRes.status} — body: ${apiRes.body.slice(0, 500) || "(empty)"}`);
      return res.status(502).json({ ok: false, error: "payment_failed", message: "Unexpected response from payment provider." });
    }

    await prisma.groupBooking.update({
      where: { id: booking.id },
      data: {
        paymentRef: booking.paymentRef ?? paymentRef,
        paymentProvider: "AZAMPAY",
        checkoutSessionId: azampayData.transactionId ?? null,
      },
    });

    try {
      await prisma.paymentEvent.create({
        data: {
          provider: "AZAMPAY",
          eventId: azampayData.transactionId ?? `${paymentRef}-${Date.now()}`,
          groupBookingId: booking.id,
          amount: depositAmount,
          currency,
          status: "PENDING",
          paymentChannel: "BANK",
          payload: { transactionId: azampayData.transactionId ?? null, paymentRef, bankCode, merchantMobileNumber: normalizedBankMobile },
        },
      });
    } catch (dbErr: any) {
      console.warn("[GroupStayDeposit/Bank] Failed to create PaymentEvent:", dbErr?.message ?? dbErr);
    }

    return res.json({
      ok: true,
      transactionId: azampayData.transactionId ?? paymentRef,
      paymentRef,
      status: "PENDING",
    });
  } catch (error: any) {
    console.error("POST /customer/group-stays/:id/deposit/initiate-bank error:", error);
    return res.status(500).json({ ok: false, error: "Failed to initiate deposit payment" });
  }
});

// ── CoralCommerce config helpers (per-route, mirrors public.tourBookings.ts) ──
function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function resolveCoralCurrency(value: string): "TZS" | "USD" {
  const currency = String(value || "").trim().toUpperCase();
  if (currency === "TZS" || currency === "USD") return currency;
  const fallback = String(process.env.CORAL_UCF_CURRENCY || "").trim().toUpperCase();
  if (fallback === "TZS" || fallback === "USD") return fallback;
  return "TZS";
}

function requiredCoralConfig(): { username: string; password: string; alias: string; callbackUrl: string; successUrl: string; failureUrl: string } | null {
  const username = process.env.CORAL_UCF_USERNAME;
  const password = process.env.CORAL_UCF_PASSWORD;
  const alias = process.env.CORAL_UCF_ALIAS;
  const callbackUrl = process.env.CORAL_UCF_CALLBACK_URL;
  const successUrl = process.env.CORAL_UCF_POSTBACK_SUCCESS_URL;
  const failureUrl = process.env.CORAL_UCF_POSTBACK_FAILURE_URL || successUrl;
  const missing = [
    !username && "CORAL_UCF_USERNAME",
    !password && "CORAL_UCF_PASSWORD",
    !alias && "CORAL_UCF_ALIAS",
    !callbackUrl && "CORAL_UCF_CALLBACK_URL",
    !successUrl && "CORAL_UCF_POSTBACK_SUCCESS_URL",
  ].filter(Boolean);

  if (missing.length) {
    console.error(`[GroupStayDeposit/Card] CoralCommerce not configured; missing ${missing.join(", ")}`);
    return null;
  }

  return { username: username!, password: password!, alias: alias!, callbackUrl: callbackUrl!, successUrl: successUrl!, failureUrl: failureUrl! };
}

/**
 * POST /api/customer/group-stays/:id/deposit/initiate-card
 * Start a CoralCommerce card checkout for the deposit payment
 */
router.post("/:id/deposit/initiate-card", depositPaymentLimiter, async (req, res) => {
  try {
    res.setHeader("Content-Type", "application/json");
    const userId = (req as AuthedRequest).user!.id;
    const bookingId = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(bookingId)) {
      return res.status(400).json({ ok: false, error: "invalid_id" });
    }

    const cardGate = await getPaymentMethodAvailability("CARD");
    if (!cardGate.enabled) {
      return res.status(400).json({ ok: false, error: "payment_method_unavailable", message: cardGate.reason });
    }

    const coralConfig = requiredCoralConfig();
    if (!coralConfig) {
      return res.status(503).json({ ok: false, error: "payment_unavailable", message: "Card payments are not configured." });
    }

    const result = await loadAwaitingDepositBooking(bookingId, userId);
    if (!result.ok) {
      return res.status(result.error.status).json(result.error.body);
    }
    const { booking, depositAmount, currency } = result;

    const paymentRef = booking.paymentRef ?? `GBDEP-CARD-${booking.id}-${Date.now()}`;
    const coralCurrency = resolveCoralCurrency(currency);

    // The web deposit page sends client:"web"; the app sends "app". Unknown
    // defaults to "app" on purpose: shipped app builds predating the flag send an
    // empty body, and they must keep returning to nolsaf://group-stay-card-return.
    const client = String((req.body as any)?.client || "") === "web" ? "web" : "app";

    const postbackParams = new URLSearchParams({
      kind: "group_stay_deposit",
      groupBookingId: String(booking.id),
      client,
    });
    const successUrl = `${coralConfig.successUrl}${coralConfig.successUrl.includes("?") ? "&" : "?"}${postbackParams.toString()}`;
    const failureUrl = `${coralConfig.failureUrl}${coralConfig.failureUrl.includes("?") ? "&" : "?"}${postbackParams.toString()}`;

    const coralBody = {
      Transaction: {
        Version: "3.16",
        Username: coralConfig.username,
        Password: coralConfig.password,
        Destination: "ucfurl",
        Submission: { Number: 1, Stamp: truncate(paymentRef, 40) },
        Identifier: paymentRef,
        Alias: coralConfig.alias,
        Currency: coralCurrency,
        Order: {
          Products: [
            {
              ID: 1,
              Code: "GROUPSTAY",
              Description: truncate(`NoLSAF group stay deposit #${booking.id}`, 100),
              Price: depositAmount,
              Quantity: 1,
              VAT: 0,
              SubTotal: depositAmount,
            },
          ],
          Delivery: { Auto: true },
          ProductTotal: depositAmount,
        },
        UCF: {
          CustomerFullName: "NoLSAF Guest",
          CustomerEmail: "",
          CustomerMobile: "",
          CallbackUrl: coralConfig.callbackUrl,
          CallbackFormat: "json",
          CallbackMethod: "post",
          CallbackVar: "UCFCallback",
          TransactionType: "03",
          PostBackSuccessUrl: successUrl,
          PostBackFailureUrl: failureUrl,
          DisplayOrderSummary: "true",
        },
      },
    };

    let apiRes;
    try {
      apiRes = await coralPostJson64(coralBody);
    } catch (err: any) {
      console.error("[GroupStayDeposit/Card] CoralCommerce request failed:", err?.message ?? "unknown");
      return res.status(503).json({ ok: false, error: "payment_unavailable", message: "Payment service temporarily unavailable." });
    }
    if (!apiRes.ok) {
      console.error(`[GroupStayDeposit/Card] CoralCommerce HTTP ${apiRes.status} via ${CORAL_UCF_API_URL} - body: ${apiRes.body.slice(0, 500)}`);
      return res.status(502).json({ ok: false, error: "payment_failed", message: "Card payment could not be initiated." });
    }

    let coralResult;
    try { coralResult = parseCoralInitiateResponse(apiRes.body); }
    catch {
      console.error(`[GroupStayDeposit/Card] CoralCommerce non-JSON response HTTP ${apiRes.status} - body: ${apiRes.body.slice(0, 500) || "(empty)"}`);
      return res.status(502).json({ ok: false, error: "payment_failed", message: "Unexpected response from payment provider." });
    }

    const checkoutUrl = coralResult.redirectUrl;
    if (coralResult.code !== "000" || !checkoutUrl) {
      console.error("[GroupStayDeposit/Card] CoralCommerce initiation rejected", JSON.stringify({
        groupBookingId: booking.id,
        paymentRef,
        code: coralResult.code,
        message: coralResult.message,
        zone: coralResult.zone,
      }));
      return res.status(502).json({ ok: false, error: "payment_failed", message: coralResult.message || "Card payment could not be initiated." });
    }

    await prisma.groupBooking.update({
      where: { id: booking.id },
      data: {
        paymentRef: booking.paymentRef ?? paymentRef,
        paymentProvider: "CORALCOMMERCE",
        checkoutSessionId: truncate(paymentRef, 120),
      },
    });

    try {
      await prisma.paymentEvent.upsert({
        where: { eventId: `CORAL-GBDEP-${paymentRef}` },
        update: {
          status: "PENDING",
          checkoutUrl: checkoutUrl.slice(0, 2048),
          rawStatus: null,
          // `client` is read back by the Coral /postback handler so app payers
          // return to the app even if Coral drops our postback query string.
          payload: { paymentRef, apiUrl: CORAL_UCF_API_URL, client },
        },
        create: {
          provider: "CORALCOMMERCE",
          eventId: `CORAL-GBDEP-${paymentRef}`,
          groupBookingId: booking.id,
          amount: depositAmount,
          currency: coralCurrency,
          status: "PENDING",
          paymentChannel: "CARD",
          checkoutUrl: checkoutUrl.slice(0, 2048),
          rawStatus: null,
          // `client` is read back by the Coral /postback handler so app payers
          // return to the app even if Coral drops our postback query string.
          payload: { paymentRef, apiUrl: CORAL_UCF_API_URL, client },
        },
      });
    } catch (dbErr: any) {
      console.warn("[GroupStayDeposit/Card] Failed to create PaymentEvent:", dbErr?.message ?? dbErr);
    }

    return res.json({ ok: true, transactionId: paymentRef, paymentRef, checkoutUrl, status: "PENDING" });
  } catch (error: any) {
    console.error("POST /customer/group-stays/:id/deposit/initiate-card error:", error);
    return res.status(500).json({ ok: false, error: "Failed to initiate deposit payment" });
  }
});

/**
 * POST /api/customer/group-stays/:id/message
 * Send a follow-up message for a group booking
 * Uses new GroupBookingMessage model for proper conversation storage
 */
router.post("/:id/message", limitPlanRequestMessages, (async (req: AuthedRequest, res) => {
  try {
    // Explicitly set Content-Type to JSON
    res.setHeader('Content-Type', 'application/json');

    const authed = req.user;
    if (!authed || typeof authed.id !== "number" || !Number.isFinite(authed.id) || authed.id <= 0) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(401).json({ error: "Unauthorized" });
    }
    const userId = authed.id;
    const bookingId = parseInt(String(req.params.id), 10);
    const { messageType, message } = req.body || {};

    if (!message || typeof message !== 'string' || !message.trim()) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(400).json({ error: "Message is required" });
    }

    // Get user info for verification and display
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true },
    });

    if (!user) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(404).json({ error: "User not found" });
    }

    // Verify the group booking belongs to this user
    const groupBooking = await (prisma as any).groupBooking.findFirst({
      where: {
        id: bookingId,
        userId: userId,
      },
    });

    if (!groupBooking) {
      return res.status(404).json({ error: "Group booking not found or access denied" });
    }

    // Sanitize message content to prevent XSS
    const sanitizedMessage = sanitizeText(message);
    const sanitizedMessageType = messageType ? sanitizeText(messageType) : "General";

    // Create message record in GroupBookingMessage table
    await (prisma as any).groupBookingMessage.create({
      data: {
        groupBookingId: bookingId,
        senderId: userId,
        senderRole: "USER",
        senderName: user.name || user.email || "User",
        messageType: sanitizedMessageType,
        body: sanitizedMessage,
        isInternal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Also update the group booking's updatedAt timestamp
    await (prisma as any).groupBooking.update({
      where: { id: bookingId },
      data: {
        updatedAt: new Date(),
      },
    });

    // Notify admins so they can follow up on the customer's question
    void notifyAdmins("group_stay_message", {
      groupBookingId: bookingId,
      customerName: user.name || user.email || "A customer",
      messageType: sanitizedMessageType,
      message: sanitizedMessage,
    });

    // Create audit log entry
    try {
      await (prisma as any).groupBookingAudit.create({
        data: {
          groupBookingId: bookingId,
          adminId: userId, // User is acting as the sender
          action: "CUSTOMER_MESSAGE_SENT",
          description: `Customer sent a message: ${sanitizedMessageType}`,
          metadata: {
            messageType: sanitizedMessageType,
            messageLength: sanitizedMessage.length,
          },
          createdAt: new Date(),
        },
      });
    } catch (auditError) {
      console.error("Failed to create audit log for customer message:", auditError);
      // Don't fail the request if audit logging fails
    }

    // Emit real-time update via Socket.IO (non-blocking)
    try {
      const io = (req.app as any)?.get?.("io") || (global as any).io;
      if (io && typeof io.emit === 'function') {
        // Emit new message event to user room
        io.to(`user:${userId}`).emit('group-booking:message:new', {
          groupBookingId: bookingId,
          senderRole: 'USER',
          message: sanitizedMessage,
          messageType: sanitizedMessageType,
          createdAt: new Date().toISOString(),
        });
        
        // Emit to admin room so admins see new messages
        io.to('admin').emit('group-booking:message:new', {
          groupBookingId: bookingId,
          senderRole: 'USER',
          message: sanitizedMessage,
          messageType: sanitizedMessageType,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (socketError: any) {
      console.error("Failed to emit Socket.IO message update:", socketError);
      // Don't fail the request if socket fails
    }

    console.log(`Follow-up message sent for group booking ${bookingId} by user ${userId}`);

    return res.json({
      success: true,
      message: "Message sent successfully",
    });
  } catch (error: any) {
    console.error("POST /customer/group-stays/:id/message error:", error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: "Failed to send message", message: error?.message || 'Unknown error' });
  }
}) as RequestHandler);

/**
 * GET /api/customer/group-stays/:id/messages
 * Get conversation messages for a group booking (for authenticated customer)
 */
router.get("/:id/messages", (async (req: AuthedRequest, res) => {
  try {
    // Explicitly set Content-Type to JSON
    res.setHeader('Content-Type', 'application/json');
    
    const userId = req.user!.id;
    const bookingId = parseInt(String(req.params.id), 10);

    // Verify the group booking belongs to this user
    const groupBooking = await (prisma as any).groupBooking.findFirst({
      where: {
        id: bookingId,
        userId: userId,
      },
    });

    if (!groupBooking) {
      return res.status(404).json({ error: "Group booking not found or access denied" });
    }

    // Get all messages for this booking (excluding internal admin notes)
    const messages = await (prisma as any).groupBookingMessage.findMany({
      where: {
        groupBookingId: bookingId,
        isInternal: false, // Only show messages visible to customers
      },
      include: {
        sender: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Format messages for frontend
    const formattedMessages = messages.map((m: any) => ({
      id: m.id,
      messageType: m.messageType || 'General',
      message: m.body,
      senderRole: m.senderRole,
      senderName: m.senderName || m.sender?.name || 'Unknown',
      createdAt: m.createdAt,
      formattedDate: new Date(m.createdAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));

    return res.json({
      success: true,
      messages: formattedMessages,
    });
  } catch (error: any) {
    console.error("GET /customer/group-stays/:id/messages error:", error);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: "Failed to load messages", message: error?.message || 'Unknown error' });
  }
}) as RequestHandler);

export default router;

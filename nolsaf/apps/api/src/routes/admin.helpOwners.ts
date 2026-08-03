import { Router } from "express";
import type { RequestHandler } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "@nolsaf/prisma";
import { getBookingValidationWindowStatus } from "../lib/bookingValidationWindow.js";
import { updateNoLsafBookingStatus } from "../lib/nolsafMarketplaceNrms.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

function differenceInCalendarDays(end: Date | string, start: Date | string) {
  const e = typeof end === "string" ? new Date(end) : end;
  const s = typeof start === "string" ? new Date(start) : start;
  return Math.ceil((e.getTime() - s.getTime()) / 86400000);
}

/**
 * POST /admin/help-owners/validate
 * Preview booking details by code — returns rich details for ALL code states.
 * Always returns 200 when the code exists (use `codeStatus` / `windowStatus` to branch UI).
 * Returns 404 only when the code is not found at all.
 */
router.post("/validate", async (req, res) => {
  const { code } = req.body as { code: string };
  if (!code) return res.status(400).json({ error: "Code is required" });

  try {
    const checkinCode = await prisma.checkinCode.findFirst({
      where: {
        OR: [
          { codeVisible: code.trim().toUpperCase() },
          { code: code.trim().toUpperCase() },
        ],
      },
      include: {
        booking: {
          include: {
            cancellationRequests: {
              select: {
                id: true, status: true, reason: true, createdAt: true,
                policyEligible: true, policyRefundPercent: true, policyRule: true,
                reviewedAt: true, decisionNote: true,
                user: { select: { id: true, name: true, email: true, phone: true } },
              },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
            property: {
              include: {
                owner: {
                  select: { id: true, name: true, email: true, phone: true },
                },
              },
            },
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
      },
    });

    if (!checkinCode) {
      return res.status(404).json({ error: "Code not found. Please check the code and try again." });
    }

    const booking = checkinCode.booking;
    const nights = differenceInCalendarDays(booking.checkOut, booking.checkIn);
    const latestCancellation = (booking as any).cancellationRequests?.[0] ?? null;

    // Shared booking details block — returned for all states
    const details = {
      bookingId: booking.id,
      codeId: checkinCode.id,
      codeStatus: checkinCode.status,
      // Code lifecycle timestamps
      generatedAt: checkinCode.generatedAt,
      usedAt: checkinCode.usedAt ?? null,
      voidedAt: checkinCode.voidedAt ?? null,
      voidReason: checkinCode.voidReason ?? null,
      // Who validated (for USED codes) — derive from property owner (only owner can validate)
      usedBy: (checkinCode.usedByOwner && booking.property?.owner) ? {
        id: booking.property.owner.id,
        name: booking.property.owner.name,
        email: booking.property.owner.email,
        phone: booking.property.owner.phone,
      } : null,
      property: {
        id: booking.propertyId,
        title: booking.property?.title ?? "-",
        type: booking.property?.type ?? "-",
        owner: booking.property?.owner ? {
          id: booking.property.owner.id,
          name: booking.property.owner.name,
          email: booking.property.owner.email,
          phone: booking.property.owner.phone,
        } : null,
      },
      customer: booking.user ? {
        id: booking.user.id,
        name: booking.user.name,
        email: booking.user.email,
        phone: booking.user.phone,
      } : null,
      guest: {
        fullName: (booking as any).guestName ?? "-",
        phone: (booking as any).guestPhone ?? "-",
        nationality: (booking as any).nationality ?? "-",
        sex: (booking as any).sex ?? "-",
        ageGroup: (booking as any).ageGroup ?? "-",
      },
      booking: {
        roomCode: (booking as any).roomCode ?? "-",
        nights,
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        status: booking.status,
        totalAmount: booking.totalAmount,
        currency: (booking as any).currency ?? "TZS",
      },
      // Cancellation details (present when code is VOID due to cancellation)
      cancellation: latestCancellation ? {
        id: latestCancellation.id,
        status: latestCancellation.status,
        reason: latestCancellation.reason ?? null,
        createdAt: latestCancellation.createdAt,
        policyEligible: latestCancellation.policyEligible,
        policyRefundPercent: latestCancellation.policyRefundPercent ?? null,
        policyRule: latestCancellation.policyRule ?? null,
        reviewedAt: latestCancellation.reviewedAt ?? null,
        decisionNote: latestCancellation.decisionNote ?? null,
        requestedBy: latestCancellation.user ? {
          id: latestCancellation.user.id,
          name: latestCancellation.user.name,
          email: latestCancellation.user.email,
        } : null,
      } : null,
    };

    // USED — code already validated
    if (checkinCode.status === "USED") {
      return res.json({ ok: true, codeStatus: "USED", details });
    }

    // VOID — cancelled or admin-voided
    if (checkinCode.status === "VOID") {
      return res.json({ ok: true, codeStatus: "VOID", details });
    }

    // ACTIVE — check the validation window (can only validate on/after check-in date)
    const windowStatus = getBookingValidationWindowStatus(
      new Date(booking.checkIn),
      new Date(booking.checkOut),
      new Date()
    );

    return res.json({
      ok: true,
      codeStatus: "ACTIVE",
      windowStatus: windowStatus.status,          // IN_WINDOW | BEFORE_CHECKIN | AFTER_CHECKOUT
      canValidate: windowStatus.canValidate,
      windowReason: windowStatus.canValidate ? null : (windowStatus as any).reason,
      details,
    });

  } catch (err) {
    console.error("admin.helpOwners.validate error", err);
    res.status(500).json({ error: "Failed to validate code" });
  }
});

/**
 * POST /admin/help-owners/confirm-checkin
 * Confirm check-in on behalf of owner
 */
router.post("/confirm-checkin", async (req, res) => {
  const { bookingId } = req.body as { bookingId: number };
  if (!bookingId) return res.status(400).json({ error: "bookingId is required" });

  try {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { code: true, property: true },
    });

    if (!booking) {
      return res.status(404).json({ error: "Booking not found" });
    }

    if (booking.status === "CHECKED_IN") {
      return res.status(400).json({ error: "Booking already checked in" });
    }

    if (!booking.code || booking.code.status !== "ACTIVE") {
      return res.status(400).json({ error: "Check-in code is not active" });
    }

    // Update booking status and mark code as used
    const updated = await prisma.$transaction(async (tx) => {
      // Mark code as used
      await tx.checkinCode.update({
        where: { id: booking.code!.id },
        data: {
          status: "USED",
          usedAt: new Date(),
          usedByOwner: true, // Mark as validated by owner
        },
      });

      // Update booking status
      const updatedBooking = await updateNoLsafBookingStatus(tx, bookingId, "CHECKED_IN");

      return updatedBooking;
    });

    // Emit socket event for real-time updates
    try {
      req.app.get("io")?.emit?.("admin:booking:checked-in", { bookingId: updated.id });
    } catch {}

    return res.json({ 
      ok: true, 
      bookingId: updated.id, 
      status: updated.status,
      message: "Check-in confirmed successfully",
    });
  } catch (err) {
    console.error("admin.helpOwners.confirm-checkin error", err);
    res.status(500).json({ error: "Failed to confirm check-in" });
  }
});

export default router;


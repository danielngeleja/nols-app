import { Router } from "express";
import type { RequestHandler } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "@nolsaf/prisma";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { getBookingValidationWindowStatus } from "../lib/bookingValidationWindow.js";
import { updateNoLsafBookingStatus } from "../lib/nolsafMarketplaceNrms.js";
import { adminBookingReference } from "../lib/adminBookingReference.js";
import { deliverOwnerNotice } from "../lib/ownerNotice.js";

/**
 * Admin help for owners: look up a guest's check-in code and confirm the
 * check-in on the owner's behalf.
 *
 * Safeguards:
 * - ADMIN only, rate limited per admin (codes are short; lookups must not be
 *   usable to sweep them).
 * - Confirmation goes by the code, not a bare booking id, re-checks the code,
 *   the booking status and the stay window on the server, and claims the code
 *   atomically so two admins cannot both confirm it.
 * - Every confirmation is written to the admin audit log in the same
 *   transaction, which is also where "validated by" is read back from: the
 *   code row has no column for it, and usedByOwner must stay true because the
 *   payout checks read it as "check-in validated".
 * - The owner gets a real inbox notice, and the response says whether it was
 *   delivered.
 */
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

const keyByAdmin = (prefix: string) => (req: any) => (req?.user?.id ? `${prefix}:${String(req.user.id)}` : req.ip || "unknown");
const lookupLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByAdmin("help-owners-lookup"),
  message: { error: "Too many code lookups. Please wait a minute and try again." },
});
const confirmLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByAdmin("help-owners-confirm"),
  message: { error: "Too many confirmations. Please wait a minute and try again." },
});

const CHECKIN_AUDIT_ACTION = "BOOKING_CHECKIN_ON_BEHALF";
/** Booking states a guest can be checked in from. */
const CHECKIN_READY = new Set(["CONFIRMED", "PENDING_CHECKIN"]);
const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

/** Codes are short uppercase letters and digits; spaces and dashes from copy-paste are ignored. */
function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return /^[A-Z0-9]{4,32}$/.test(code) ? code : null;
}

function nightsBetween(checkIn: Date, checkOut: Date) {
  return Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 86_400_000));
}

async function findCode(code: string) {
  return prisma.checkinCode.findFirst({
    where: { OR: [{ codeVisible: code }, { code }] },
    include: {
      booking: {
        include: {
          cancellationRequests: {
            select: { id: true, status: true, reason: true, createdAt: true, policyRefundPercent: true, policyRule: true, decisionNote: true },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          property: { select: { id: true, title: true, type: true, regionName: true, district: true, owner: { select: { id: true, name: true, email: true, phone: true, deletedAt: true } } } },
          user: { select: { name: true, phone: true } },
        },
      },
    },
  });
}

/** Who validated a used code: the admin from the audit log, else the owner. */
async function validatedBy(bookingId: number, ownerId: number | null, usedByOwner: boolean | null) {
  const rows = await prisma.adminAudit.findMany({
    where: { action: CHECKIN_AUDIT_ACTION, ...(ownerId ? { targetUserId: ownerId } : {}) },
    select: { createdAt: true, details: true, admin: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const match = rows.find((row) => Number((row.details as any)?.bookingId) === bookingId);
  if (match) return { kind: "ADMIN" as const, name: match.admin?.name || "NoLSAF admin" };
  return usedByOwner ? { kind: "OWNER" as const, name: null } : null;
}

/**
 * POST /admin/help-owners/validate { code }
 * Booking details behind a code, for every code state. 404 only when the code
 * does not exist. Read only.
 */
router.post("/validate", lookupLimiter, async (req, res) => {
  const code = normalizeCode((req.body as any)?.code);
  if (!code) return res.status(400).json({ error: "Enter the booking code exactly as the guest has it (letters and numbers)." });

  try {
    const checkinCode = await findCode(code);
    if (!checkinCode) return res.status(404).json({ error: "No booking uses this code. Check it with the guest and try again." });

    const booking = checkinCode.booking;
    const owner = booking.property?.owner ?? null;
    const cancellation = booking.cancellationRequests?.[0] ?? null;
    const window = getBookingValidationWindowStatus(new Date(booking.checkIn), new Date(booking.checkOut), new Date());
    const bookingReady = CHECKIN_READY.has(String(booking.status).toUpperCase());
    const codeStatus = String(checkinCode.status).toUpperCase();

    const details = {
      bookingReference: adminBookingReference(booking.id),
      code: checkinCode.codeVisible || checkinCode.code,
      generatedAt: checkinCode.generatedAt,
      usedAt: checkinCode.usedAt ?? null,
      voidedAt: checkinCode.voidedAt ?? null,
      voidReason: checkinCode.voidReason ?? null,
      validatedBy: codeStatus === "USED" ? await validatedBy(booking.id, owner?.id ?? null, checkinCode.usedByOwner ?? null) : null,
      property: {
        title: booking.property?.title ?? null,
        type: booking.property?.type ?? null,
        location: [booking.property?.district, booking.property?.regionName].filter(Boolean).join(", ") || null,
      },
      owner: owner
        ? { id: owner.id, name: owner.name, email: owner.deletedAt ? null : owner.email, phone: owner.deletedAt ? null : owner.phone, removed: Boolean(owner.deletedAt) }
        : null,
      guest: {
        name: (booking as any).guestName || booking.user?.name || null,
        phone: (booking as any).guestPhone || booking.user?.phone || null,
      },
      booking: {
        status: booking.status,
        roomCode: (booking as any).roomCode ?? null,
        nights: nightsBetween(new Date(booking.checkIn), new Date(booking.checkOut)),
        checkIn: booking.checkIn,
        checkOut: booking.checkOut,
        totalAmount: Number(booking.totalAmount ?? 0),
        currency: (booking as any).currency ?? "TZS",
      },
      cancellation: cancellation
        ? {
            status: cancellation.status,
            reason: cancellation.reason ?? null,
            createdAt: cancellation.createdAt,
            policyRefundPercent: cancellation.policyRefundPercent ?? null,
            policyRule: cancellation.policyRule ?? null,
            decisionNote: cancellation.decisionNote ?? null,
          }
        : null,
    };

    if (codeStatus === "USED" || codeStatus === "VOID") {
      return res.json({ ok: true, codeStatus, canValidate: false, details });
    }

    return res.json({
      ok: true,
      codeStatus: "ACTIVE",
      windowStatus: window.status,
      // The server rechecks all of this on confirm; this only drives the screen.
      canValidate: window.canValidate && bookingReady,
      windowReason: !bookingReady
        ? `The booking is ${String(booking.status).toLowerCase().replace(/_/g, " ")}, so it cannot be checked in.`
        : window.canValidate
          ? null
          : (window as any).reason,
      details,
    });
  } catch (err) {
    console.error("admin.helpOwners.validate error", err);
    res.status(500).json({ error: "Could not look up the code. Please try again." });
  }
});

/**
 * POST /admin/help-owners/confirm-checkin { code }
 * Confirms the guest's check-in on the owner's behalf.
 */
router.post("/confirm-checkin", confirmLimiter, async (req, res) => {
  const code = normalizeCode((req.body as any)?.code);
  if (!code) return res.status(400).json({ error: "The booking code is required." });
  const adminId = Number((req as any).user?.id);

  try {
    const checkinCode = await findCode(code);
    if (!checkinCode) return res.status(404).json({ error: "No booking uses this code." });
    const booking = checkinCode.booking;
    const owner = booking.property?.owner ?? null;

    if (String(checkinCode.status).toUpperCase() !== "ACTIVE") {
      return res.status(409).json({ error: checkinCode.status === "USED" ? "This code has already been validated." : "This code has been voided." });
    }
    if (!CHECKIN_READY.has(String(booking.status).toUpperCase())) {
      return res.status(409).json({ error: `The booking is ${String(booking.status).toLowerCase().replace(/_/g, " ")}, so it cannot be checked in.` });
    }
    const window = getBookingValidationWindowStatus(new Date(booking.checkIn), new Date(booking.checkOut), new Date());
    if (!window.canValidate) {
      return res.status(409).json({ error: (window as any).reason || "This booking is outside its check-in window." });
    }

    const confirmedAt = new Date();
    await prisma.$transaction(async (tx) => {
      // Atomic claim: only one confirmation can move the code out of ACTIVE.
      const claimed = await tx.checkinCode.updateMany({
        where: { id: checkinCode.id, status: "ACTIVE" },
        // usedByOwner stays true: payout eligibility reads it as "check-in validated".
        data: { status: "USED", usedAt: confirmedAt, usedByOwner: true },
      });
      if (claimed.count !== 1) throw Object.assign(new Error("ALREADY_USED"), { code: "ALREADY_USED" });
      await updateNoLsafBookingStatus(tx, booking.id, "CHECKED_IN");
      await tx.adminAudit.create({
        data: {
          adminId: Number.isInteger(adminId) ? adminId : null,
          targetUserId: owner?.id ?? null,
          action: CHECKIN_AUDIT_ACTION,
          details: { bookingId: booking.id, propertyId: booking.propertyId, codeId: checkinCode.id, confirmedAt: confirmedAt.toISOString() },
        },
      });
    }, TX_OPTIONS);

    let ownerNotified = false;
    if (owner && !owner.deletedAt) {
      ownerNotified = await deliverOwnerNotice(owner.id, {
        title: "Guest checked in by NoLSAF",
        body: `NoLSAF confirmed the guest check-in for "${booking.property?.title || "your property"}" on your behalf (code ${checkinCode.codeVisible || checkinCode.code}). The booking is now marked as checked in.`,
        type: "booking",
        meta: { notificationKind: "booking_checked_in_by_admin", bookingId: booking.id },
      });
    }

    try {
      req.app.get("io")?.to?.("admin")?.emit?.("admin:booking:checked-in", { bookingReference: adminBookingReference(booking.id) });
    } catch {
      // Realtime refresh is best effort.
    }

    return res.json({ ok: true, status: "CHECKED_IN", confirmedAt, ownerNotified, bookingReference: adminBookingReference(booking.id) });
  } catch (err: any) {
    if (err?.code === "ALREADY_USED") return res.status(409).json({ error: "This code was just validated by someone else." });
    console.error("admin.helpOwners.confirm-checkin error", err);
    res.status(500).json({ error: "Could not confirm the check-in. Nothing was changed; please try again." });
  }
});

export default router;

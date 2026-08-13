import { Router } from "express";
import type { RequestHandler } from "express";
import crypto from "crypto";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { notifyAdmins } from "../lib/notifications.js";
import { limitCancellationLookup, limitCancellationSubmit, limitCancellationMessages } from "../middleware/rateLimit.js";
import { evaluateRefundWindow } from "../lib/refundWindowPolicy.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

function isMissingTableError(err: any): boolean {
  // Prisma: P2021 = table does not exist
  if (err?.code === "P2021") return true;
  const msg = String(err?.message || "");
  return /does not exist/i.test(msg) || /unknown table/i.test(msg);
}

function normalizeCode(input: unknown): string {
  return String(input || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

function computeEligibility(args: {
  bookingStatus: string;
  codeStatus: string | null;
  createdAt: Date;
  checkIn: Date;
  checkOut: Date;
  now: Date;
}): {
  eligible: boolean;
  reason?: string;
  refundPercent?: number; // 0, 50, 100
  rule?: "FREE_24H_72H" | "PARTIAL_50_96H" | "NON_REFUNDABLE" | "AFTER_CHECKIN" | "NOT_ELIGIBLE";
  nextStep?: "PLATFORM" | "EMAIL";
} {
  const { bookingStatus, codeStatus, createdAt, checkIn, now } = args;

  if (bookingStatus === "CANCELED") return { eligible: false, reason: "This booking is already canceled." };
  if (!codeStatus) return { eligible: false, reason: "Booking code is missing." };
  if (codeStatus !== "ACTIVE") return { eligible: false, reason: "This booking code is not active." };
  if (now >= checkIn) {
    return {
      eligible: false,
      rule: "AFTER_CHECKIN",
      nextStep: "EMAIL",
      reason:
        "Cancellations after check-in are generally not eligible for refunds. For exceptional circumstances, please contact cancellation@nolsaf.com.",
    };
  }

  // Before check-in policy windows (shared with tours — see lib/refundWindowPolicy.ts)
  const window = evaluateRefundWindow({ bookedAt: createdAt, startsAt: checkIn, requestedAt: now });

  if (window.tier === "FULL_100") {
    return { eligible: true, refundPercent: window.refundPercent, rule: "FREE_24H_72H", nextStep: "PLATFORM" };
  }

  if (window.tier === "PARTIAL_50") {
    return { eligible: true, refundPercent: window.refundPercent, rule: "PARTIAL_50_96H", nextStep: "PLATFORM" };
  }

  // Otherwise: not eligible through platform (direct communication required)
  return {
    eligible: false,
    refundPercent: 0,
    rule: "NOT_ELIGIBLE",
    nextStep: "EMAIL",
    reason:
      "This booking does not qualify for platform cancellation under our policy.",
  };
}

/**
 * GET /api/customer/cancellations/lookup?code=XXXX
 * Validate booking code (must belong to authenticated user) and return booking info for cancellation flow.
 */
router.get("/lookup", limitCancellationLookup, (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const code = normalizeCode((req.query as any).code);
    if (!code) return res.status(400).json({ error: "Booking code is required" });

    const codeHash = hashCode(code);
    const checkinCode = await prisma.checkinCode.findFirst({
      where: {
        OR: [{ code }, { codeHash }],
      },
      include: {
        booking: {
          select: {
            id: true,
            userId: true,
            status: true,
            createdAt: true,
            checkIn: true,
            checkOut: true,
            totalAmount: true,
            property: {
              select: {
                id: true,
                title: true,
                type: true,
                regionName: true,
                district: true,
                city: true,
                country: true,
              },
            },
          },
        },
      },
    });

    if (!checkinCode?.booking) {
      return res.status(404).json({ error: "Booking not found for this code" });
    }

    // Security: code must belong to the signed-in user.
    if (checkinCode.booking.userId !== userId) {
      return res.status(404).json({ error: "Booking not found for this code" });
    }

    const now = new Date();
    const eligibility = computeEligibility({
      bookingStatus: checkinCode.booking.status,
      codeStatus: checkinCode.status,
      createdAt: new Date(checkinCode.booking.createdAt),
      checkIn: new Date(checkinCode.booking.checkIn),
      checkOut: new Date(checkinCode.booking.checkOut),
      now,
    });

    let existingPending: { id: number; status: string; createdAt: Date } | null = null;
    try {
      existingPending = await prisma.cancellationRequest.findFirst({
        where: {
          bookingId: checkinCode.booking.id,
          userId,
          status: { in: ["SUBMITTED", "REVIEWING", "NEED_INFO", "APPROVED", "REFUND_PENDING"] },
        },
        select: { id: true, status: true, createdAt: true },
      });
    } catch (err: any) {
      if (!isMissingTableError(err)) throw err;
      // If DB migration hasn't been applied yet, we can still show booking info,
      // but can't check/create requests.
      existingPending = null;
    }

    return res.json({
      booking: {
        id: checkinCode.booking.id,
        status: checkinCode.booking.status,
        createdAt: checkinCode.booking.createdAt,
        checkIn: checkinCode.booking.checkIn,
        checkOut: checkinCode.booking.checkOut,
        totalAmount: checkinCode.booking.totalAmount,
        bookingCode: checkinCode.code,
        codeStatus: checkinCode.status,
        property: checkinCode.booking.property,
      },
      eligibility,
      existingRequest: existingPending || null,
    });
  } catch (error: any) {
    console.error("GET /customer/cancellations/lookup error:", error);
    return res.status(500).json({ error: "Failed to validate booking code" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/cancellations/request
 * Body: { code: string, reason?: string, confirmPolicy?: boolean }
 */
router.post("/request", limitCancellationSubmit, (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { code: rawCode, reason, confirmPolicy } = req.body || {};
    const code = normalizeCode(rawCode);

    if (!code) return res.status(400).json({ error: "Booking code is required" });
    if (!confirmPolicy) return res.status(400).json({ error: "Please confirm the cancellation policy to proceed." });

    const codeHash = hashCode(code);
    const checkinCode = await prisma.checkinCode.findFirst({
      where: { OR: [{ code }, { codeHash }] },
      include: {
        booking: { select: { id: true, userId: true, status: true, createdAt: true, checkIn: true, checkOut: true } },
      },
    });

    if (!checkinCode?.booking) return res.status(404).json({ error: "Booking not found for this code" });
    if (checkinCode.booking.userId !== userId) return res.status(404).json({ error: "Booking not found for this code" });

    const now = new Date();
    const eligibility = computeEligibility({
      bookingStatus: checkinCode.booking.status,
      codeStatus: checkinCode.status,
      createdAt: new Date(checkinCode.booking.createdAt),
      checkIn: new Date(checkinCode.booking.checkIn),
      checkOut: new Date(checkinCode.booking.checkOut),
      now,
    });
    
    // Only allow submission if eligible per policy - this screens valid claims for admin review
    if (!eligibility.eligible) {
      return res.status(400).json({
        error: eligibility.reason || "This booking does not qualify for platform cancellation under our policy.",
        eligibility,
        contactEmail: "cancellation@nolsaf.com",
        contactMessage: "Please contact us directly via email or phone for assistance with cancellations that don't meet our automated policy requirements.",
      });
    }

    try {
      const existingPending = await prisma.cancellationRequest.findFirst({
        where: { bookingId: checkinCode.booking.id, userId, status: { in: ["SUBMITTED", "REVIEWING", "NEED_INFO", "APPROVED", "REFUND_PENDING"] } },
        select: { id: true },
      });
      if (existingPending) {
        return res.status(409).json({ error: "A cancellation request is already pending for this booking." });
      }

      const created = await prisma.cancellationRequest.create({
        data: {
          bookingId: checkinCode.booking.id,
          userId,
          bookingCode: checkinCode.code,
          status: "SUBMITTED",
          reason: reason ? String(reason).trim().slice(0, 2000) : null,
          policyEligible: Boolean(eligibility.eligible),
          policyRefundPercent: eligibility.refundPercent ?? null,
          policyRule: eligibility.rule ?? null,
        },
        select: { id: true, status: true, createdAt: true, policyEligible: true, policyRefundPercent: true, policyRule: true },
      });

      // Notify admins of a new cancellation request (best-effort)
      void notifyAdmins("cancellation_submitted" as any, {
        requestId: created.id,
        bookingId: checkinCode.booking.id,
        bookingCode: checkinCode.code,
        userId,
        policyEligible: created.policyEligible,
        policyRefundPercent: created.policyRefundPercent,
        policyRule: created.policyRule,
      });

      return res.status(201).json({
        request: created,
        eligibility,
        message: "Cancellation request submitted. Our team will review it according to the cancellation policy.",
      });
    } catch (err: any) {
      if (isMissingTableError(err)) {
        return res.status(503).json({
          error:
            "Cancellation requests are not available yet (database migration pending). Please apply the latest Prisma migration and try again.",
        });
      }
      throw err;
    }

  } catch (error: any) {
    console.error("POST /customer/cancellations/request error:", error);
    return res.status(500).json({ error: "Failed to submit cancellation request" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/cancellations
 * List cancellation requests for the authenticated customer.
 */
router.get("/", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const items = await prisma.cancellationRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        bookingId: true,
        bookingCode: true,
        reason: true,
        policyEligible: true,
        policyRefundPercent: true,
        policyRule: true,
        refundAmount: true,
        refundProvider: true,
        refundReference: true,
        refundInitiatedAt: true,
        refundedAt: true,
        createdAt: true,
        updatedAt: true,
        booking: {
          select: {
            checkIn: true,
            checkOut: true,
            status: true,
            property: { select: { title: true, regionName: true, city: true, district: true } },
          },
        },
      },
    });
    return res.json({ items });
  } catch (error: any) {
    console.error("GET /customer/cancellations error:", error);
    return res.status(500).json({ error: "Failed to fetch cancellation requests" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/cancellations/:id
 * Get a cancellation request with messages.
 */
router.get("/:id", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = Number(req.params.id);
    const item = await prisma.cancellationRequest.findFirst({
      where: { id, userId },
      select: {
        id: true,
        status: true,
        bookingId: true,
        bookingCode: true,
        reason: true,
        decisionNote: true,
        policyEligible: true,
        policyRefundPercent: true,
        policyRule: true,
        createdAt: true,
        updatedAt: true,
        booking: {
          select: {
            checkIn: true,
            checkOut: true,
            totalAmount: true,
            status: true,
            property: { select: { title: true, regionName: true, city: true, district: true } },
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, senderId: true, senderRole: true, body: true, createdAt: true },
        },
      },
    });
    if (!item) return res.status(404).json({ error: "Cancellation request not found" });
    return res.json({ item });
  } catch (error: any) {
    console.error("GET /customer/cancellations/:id error:", error);
    return res.status(500).json({ error: "Failed to fetch cancellation request" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/cancellations/:id/messages
 * Body: { body: string }
 */
router.post("/:id/messages", limitCancellationMessages, (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const id = Number(req.params.id);
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Message body is required" });

    const request = await prisma.cancellationRequest.findFirst({
      where: { id, userId },
      select: { id: true, status: true, bookingId: true, bookingCode: true },
    });
    if (!request) return res.status(404).json({ error: "Cancellation request not found" });
    if (["REFUNDED", "REJECTED"].includes(request.status)) {
      return res.status(409).json({ error: "Messages are locked because this cancellation is final" });
    }

    const created = await prisma.cancellationMessage.create({
      data: {
        cancellationRequestId: request.id,
        senderId: userId,
        senderRole: "USER",
        body: body.slice(0, 4000),
      },
      select: { id: true, senderId: true, senderRole: true, body: true, createdAt: true },
    });

    void notifyAdmins("cancellation_message" as any, {
      requestId: request.id,
      bookingId: request.bookingId,
      bookingCode: request.bookingCode,
      userId,
    });

    return res.status(201).json({ message: created });
  } catch (error: any) {
    console.error("POST /customer/cancellations/:id/messages error:", error);
    return res.status(500).json({ error: "Failed to send message" });
  }
}) as RequestHandler);

export default router;



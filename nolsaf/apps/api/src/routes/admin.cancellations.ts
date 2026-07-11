import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { notifyUser, notifyOwner } from "../lib/notifications.js";
import { limitCancellationMessages } from "../middleware/rateLimit.js";
import adminTourCasesRouter from "./admin.tourCases.js";
import {
  accommodationCancellationMessage,
  normalizeAccommodationCancellationStatus,
  validateAccommodationCancellationTransition,
  validateAccommodationCancellationRequirements,
  type AccommodationCancellationStatus,
} from "../lib/accommodationCancellationWorkflow.js";
import { calculateRefundChannelCharges, inferRefundChannel, REFUND_CHANNEL_POLICY_VERSION } from "../lib/refundChannelCharges.js";

export const router = Router();
router.use(requireAuth as RequestHandler);
router.use(requireRole("ADMIN") as RequestHandler);

// Keep every cancellation workflow under the established admin cancellation
// namespace while retaining the tour-specific policy and finance controls.
router.use("/tours", adminTourCasesRouter as RequestHandler);

const normalizeStatus = normalizeAccommodationCancellationStatus;

/**
 * GET /api/admin/cancellations?status=&q=
 * q can match bookingCode or request id
 */
router.get("/", (async (req: AuthedRequest, res) => {
  try {
    const { status, q } = req.query as any;
    const st = status ? normalizeStatus(status) : null;
    const query = String(q || "").trim();

    const where: any = {};
    if (st) where.status = st;
    if (query) {
      const asId = Number(query);
      where.OR = [
        { bookingCode: { contains: query.toUpperCase() } },
        ...(Number.isFinite(asId) ? [{ id: asId }] : []),
      ];
    }

    const items = await prisma.cancellationRequest.findMany({
      where,
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
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        booking: {
          select: {
            checkIn: true,
            checkOut: true,
            totalAmount: true,
            status: true,
            property: { select: { title: true, regionName: true, city: true, district: true } },
          },
        },
      },
    });

    return res.json({ items });
  } catch (error: any) {
    console.error("GET /admin/cancellations error:", error);
    return res.status(500).json({ error: "Failed to fetch cancellation requests" });
  }
}) as RequestHandler);

/**
 * GET /api/admin/cancellations/:id
 */
router.get("/:id", (async (req: AuthedRequest, res) => {
  try {
    const id = Number(req.params.id);
    const item = await prisma.cancellationRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        bookingId: true,
        bookingCode: true,
        reason: true,
        decisionNote: true,
        reviewedAt: true,
        reviewedBy: true,
        approvedAt: true,
        approvedByAdminId: true,
        refundAmount: true,
        refundProvider: true,
        refundReference: true,
        refundInitiatedAt: true,
        refundedAt: true,
        refundChargesJson: true,
        policyEligible: true,
        policyRefundPercent: true,
        policyRule: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true, phone: true } },
        booking: {
          select: {
            id: true,
            checkIn: true,
            checkOut: true,
            totalAmount: true,
            status: true,
            guestName: true,
            guestPhone: true,
            createdAt: true,
            property: { 
              select: { 
                id: true,
                title: true, 
                regionName: true, 
                city: true, 
                district: true,
                type: true,
              } 
            },
            code: {
              select: {
                id: true,
                code: true,
                codeVisible: true,
                status: true,
                generatedAt: true,
                usedAt: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, senderId: true, senderRole: true, body: true, createdAt: true },
        },
      },
    });
    if (!item) return res.status(404).json({ error: "Cancellation request not found" });

    // Fetch payment information (invoice and payment events)
    let paymentInfo: { invoice: any; paymentEvents: any[]; hasTransactionId: boolean; paymentConfirmed: boolean } | null = null;
    try {
      const invoice = await prisma.invoice.findFirst({
        where: { bookingId: item.bookingId },
        select: {
          id: true,
          invoiceNumber: true,
          receiptNumber: true,
          total: true,
          status: true,
          paymentMethod: true,
          paymentRef: true,
          createdAt: true,
        },
      });

      if (invoice) {
        const paymentEvents = await prisma.paymentEvent.findMany({
          where: { invoiceId: invoice.id },
          select: {
            id: true,
            eventId: true,
            provider: true,
            amount: true,
            currency: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
        });

        paymentInfo = {
          invoice,
          paymentEvents,
          hasTransactionId: !!invoice.paymentRef || paymentEvents.some((e) => !!e.eventId),
          paymentConfirmed: ["PAID", "CUSTOMER_PAID"].includes(String(invoice.status).toUpperCase()) || paymentEvents.some((e) => ["SUCCESS", "COMPLETED", "PAID"].includes(String(e.status).toUpperCase())),
        };
      }
    } catch (err) {
      console.warn("Failed to fetch payment info for cancellation request:", err);
      // Continue without payment info
    }

    return res.json({ item, paymentInfo });
  } catch (error: any) {
    console.error("GET /admin/cancellations/:id error:", error);
    return res.status(500).json({ error: "Failed to fetch cancellation request" });
  }
}) as RequestHandler);

/**
 * Determine which owner notification template to send and whether to
 * void the check-in code / cancel the booking for a given status transition.
 *
 * Progressive stages:
 *  REVIEWING  → notify owner the request is under review; no booking changes
 *  APPROVED   → notify owner it is approved; void code + cancel booking
 *  REFUNDED   → notify owner after provider-confirmed refund evidence is stored
 *  REJECTED   → notify owner request was denied; booking stays active
 */
function getOwnerSideEffects(nextStatus: AccommodationCancellationStatus | null, prevStatus: AccommodationCancellationStatus): {
  ownerTemplate: string | null;
  shouldVoidAndCancel: boolean;
} {
  if (!nextStatus || nextStatus === prevStatus) return { ownerTemplate: null, shouldVoidAndCancel: false };

  switch (nextStatus) {
    case "REVIEWING":
      return { ownerTemplate: "cancellation_reviewing", shouldVoidAndCancel: false };

    case "APPROVED":
      // Approval is the moment the owner loses the booking and check-in access.
      return { ownerTemplate: "cancellation_processing", shouldVoidAndCancel: true };

    case "REFUNDED":
      return { ownerTemplate: "cancellation_refunded", shouldVoidAndCancel: false };

    case "REJECTED":
      return { ownerTemplate: "cancellation_rejected", shouldVoidAndCancel: false };

    default:
      // SUBMITTED, NEED_INFO — no owner action required
      return { ownerTemplate: null, shouldVoidAndCancel: false };
  }
}

/**
 * PATCH /api/admin/cancellations/:id
 * Body: { status?: string, decisionNote?: string }
 *
 * Progressive side-effects by status:
 *  REVIEWING  → owner notified: "request is under review"
 *  APPROVED   → booking → CANCELED, code → VOID, owner notified: "approved"
 *  REFUND_PENDING → refund initiation is recorded
 *  REFUNDED   → provider reference is stored, owner notified: "refund complete"
 *  REJECTED   → owner notified: "request rejected, booking stays active"
 */
router.patch("/:id", (async (req: AuthedRequest, res) => {
  try {
    const adminId = req.user!.id;
    const id = Number(req.params.id);
    const nextStatus = req.body?.status ? normalizeStatus(req.body.status) : null;
    const decisionNote = req.body?.decisionNote != null ? String(req.body.decisionNote).trim().slice(0, 4000) : undefined;

    if (req.body?.status && !nextStatus) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Always fetch current state — we need it for side-effect logic and owner notify.
    const current = await prisma.cancellationRequest.findUnique({
      where: { id },
      select: {
        status: true,
        bookingId: true,
        userId: true,
        bookingCode: true,
        policyEligible: true,
        policyRefundPercent: true,
        policyRule: true,
        refundAmount: true,
        booking: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            createdAt: true,
            property: { select: { ownerId: true, title: true } },
            code: { select: { id: true, status: true, codeVisible: true } },
          },
        },
      },
    });
    if (!current) return res.status(404).json({ error: "Cancellation request not found" });

    if (!nextStatus) return res.status(400).json({ error: "A new status is required" });
    const transition = validateAccommodationCancellationTransition(current.status, nextStatus);
    if (!transition.valid) return res.status(409).json({ error: transition.error });

    const invoice = await prisma.invoice.findFirst({
      where: { bookingId: current.bookingId },
      select: { total: true, status: true, paymentMethod: true, paymentRef: true },
      orderBy: { createdAt: "desc" },
    });
    const paymentEvent = await prisma.paymentEvent.findFirst({
      where: { invoice: { bookingId: current.bookingId }, eventId: { not: "" }, status: { in: ["SUCCESS", "COMPLETED", "PAID"] } },
      select: { eventId: true, provider: true, status: true },
      orderBy: { createdAt: "desc" },
    });
    const invoiceConfirmed = ["PAID", "CUSTOMER_PAID"].includes(String(invoice?.status || "").toUpperCase());
    const hasPaymentProof = Boolean((invoiceConfirmed && invoice?.paymentRef) || paymentEvent?.eventId);
    const refundProvider = String(req.body?.refundProvider || invoice?.paymentMethod || paymentEvent?.provider || "").trim().slice(0, 80);
    const refundReference = String(req.body?.refundReference || "").trim().slice(0, 160);
    const policyPercent = Math.max(0, Math.min(100, Number(current.policyRefundPercent || 0)));
    const paidAmount = Number(invoice?.total ?? current.booking?.totalAmount ?? 0);
    const approvedRefundAmount = Math.round((paidAmount * policyPercent / 100) * 100) / 100;
    const requirements = validateAccommodationCancellationRequirements({
      to: nextStatus,
      decisionNote,
      policyEligible: current.policyEligible,
      hasPaymentProof,
      refundProvider,
      refundReference,
      approvedRefundAmount: nextStatus === "APPROVED" ? approvedRefundAmount : Number(current.refundAmount || 0),
    });
    if (!requirements.valid) return res.status(409).json({ error: requirements.error });

    // Policy section 8.4: method-specific refund charges, computed once when
    // the refund joins the payment queue. Policy 10.2 keeps bookings made
    // before the charges policy exempt; the free-cancellation window stays a
    // true 100 percent refund.
    const refundCharges = nextStatus === "REFUND_PENDING" ? calculateRefundChannelCharges({
      grossRefundAmount: Number(current.refundAmount || 0),
      channel: inferRefundChannel(refundProvider),
      eligibilityCode: current.policyRule,
      actualBankCharges: Number(req.body?.actualBankCharges) > 0 ? Number(req.body.actualBankCharges) : 0,
      chargesAcceptedAtBooking: current.booking
        ? current.booking.createdAt.toISOString().slice(0, 10) >= REFUND_CHANNEL_POLICY_VERSION
        : false,
    }) : null;
    const chargesNote = refundCharges
      ? (refundCharges.exempt
        ? " No payment-channel or administrative charges apply to this refund."
        : ` Charges applied per the refund policy: card surcharge TZS ${refundCharges.cardSurcharge.toLocaleString()}, bank charges TZS ${refundCharges.bankCharges.toLocaleString()}, administrative charge TZS ${refundCharges.adminCharge.toLocaleString()}. Net refund payable: TZS ${refundCharges.netRefundAmount.toLocaleString()}.`)
      : "";

    const { ownerTemplate, shouldVoidAndCancel } = getOwnerSideEffects(
      nextStatus,
      current.status as AccommodationCancellationStatus,
    );

    // Run all DB mutations atomically.
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.cancellationRequest.updateMany({
        where: { id, status: current.status },
        data: {
          ...(nextStatus ? { status: nextStatus, reviewedBy: adminId, reviewedAt: new Date() } : {}),
          ...(["NEED_INFO", "APPROVED", "REJECTED"].includes(nextStatus) ? { decisionNote } : {}),
          ...(nextStatus === "APPROVED" ? { approvedAt: new Date(), approvedByAdminId: adminId, refundAmount: approvedRefundAmount } : {}),
          ...(nextStatus === "REFUND_PENDING" ? { refundProvider, refundInitiatedAt: new Date(), refundChargesJson: refundCharges as any } : {}),
          ...(nextStatus === "REFUNDED" ? { refundReference, refundedAt: new Date() } : {}),
        },
      });
      if (changed.count !== 1) throw new Error("CANCELLATION_STATE_CHANGED");
      const request = await tx.cancellationRequest.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          status: true,
          decisionNote: true,
          reviewedAt: true,
          reviewedBy: true,
          approvedAt: true,
          refundAmount: true,
          refundProvider: true,
          refundReference: true,
          refundInitiatedAt: true,
          refundedAt: true,
          refundChargesJson: true,
          userId: true,
          bookingCode: true,
        },
      });

      await tx.cancellationMessage.create({
        data: {
          cancellationRequestId: id,
          senderId: adminId,
          senderRole: "ADMIN",
          body: `${accommodationCancellationMessage(nextStatus, decisionNote)}${chargesNote}`.slice(0, 4000),
        },
      });

      if (shouldVoidAndCancel && current.booking) {
        // Cancel the booking so it no longer appears as active.
        if (current.booking.status !== "CANCELED") {
          await tx.booking.update({
            where: { id: current.booking.id },
            data: { status: "CANCELED" },
          });
        }
        // Void the check-in code so the owner cannot use it.
        if (current.booking.code && current.booking.code.status === "ACTIVE") {
          await tx.checkinCode.update({
            where: { id: current.booking.code.id },
            data: {
              status: "VOID",
              voidReason: `Booking cancelled — cancellation request moved to ${nextStatus} by admin`,
              voidedAt: new Date(),
            },
          });
        }
      }

      return request;
    }, {
      // This workflow contains only atomic database writes. Fifteen seconds
      // tolerates short database/commit stalls without masking sustained
      // contention behind an excessively long request.
      maxWait: 5_000,
      timeout: 15_000,
    });

    // Post-transaction side-effects: notify owner + real-time events.
    if (ownerTemplate && current.booking) {
      const ownerId = current.booking.property?.ownerId;
      const propertyTitle = current.booking.property?.title;
      const code = current.booking.code;

      if (ownerId) {
        try {
          await notifyOwner(ownerId, ownerTemplate, {
            bookingId: current.bookingId,
            bookingCode: current.bookingCode,
            propertyTitle,
            requestId: id,
            newStatus: nextStatus,
            decisionNote: updated.decisionNote,
          });
        } catch {
          // ignore — notification failure must never block the response
        }
      }

      const io = req.app.get("io");
      if (io) {
        if (shouldVoidAndCancel && code) {
          io.emit("admin:code:voided", { bookingId: current.bookingId, code: code.codeVisible });
        }
        if (ownerId) {
          io.to(`owner:${ownerId}`).emit("booking:cancellation_update", {
            bookingId: current.bookingId,
            bookingCode: current.bookingCode,
            status: nextStatus,
            cancelled: shouldVoidAndCancel,
          });
        }
      }
    }

    // Notify the customer of the status change (best-effort).
    try {
      await notifyUser(updated.userId, "cancellation_status_update" as any, {
        requestId: updated.id,
        bookingCode: updated.bookingCode,
        status: updated.status,
        decisionNote: updated.decisionNote,
      });
    } catch {
      // ignore
    }

    return res.json({ item: updated });
  } catch (error: any) {
    if (error?.message === "CANCELLATION_STATE_CHANGED") {
      return res.status(409).json({ error: "This cancellation changed while you were reviewing it. Reload and try again." });
    }
    if (error?.code === "P2028") {
      return res.status(503).json({ error: "The database was temporarily busy. No cancellation change was completed; please retry." });
    }
    console.error("PATCH /admin/cancellations/:id error:", error);
    return res.status(500).json({ error: "Failed to update cancellation request" });
  }
}) as RequestHandler);

/**
 * POST /api/admin/cancellations/:id/messages
 * Body: { body: string, setStatus?: string }
 *
 * Messages are communication only. Status changes must use PATCH so the
 * authoritative transition checks and financial requirements cannot be bypassed.
 */
router.post("/:id/messages", limitCancellationMessages, (async (req: AuthedRequest, res) => {
  try {
    const adminUser = req.user;
    const adminRole = String((adminUser as any)?.role ?? "").toUpperCase();
    if (!adminUser || typeof adminUser.id !== "number" || !Number.isFinite(adminUser.id) || adminUser.id <= 0 || adminRole !== "ADMIN") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const adminId = adminUser.id;
    const id = Number(req.params.id);
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Message body is required" });

    if (req.body?.setStatus) {
      return res.status(400).json({ error: "Status changes must use the enforced cancellation workflow" });
    }
    const current = await prisma.cancellationRequest.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true, bookingCode: true },
    });
    if (!current) return res.status(404).json({ error: "Cancellation request not found" });
    if (["REFUNDED", "REJECTED"].includes(current.status)) {
      return res.status(409).json({ error: "Messages are locked because this cancellation is final" });
    }

    const created = await prisma.cancellationMessage.create({
      data: {
        cancellationRequestId: id,
        senderId: adminId,
        senderRole: "ADMIN",
        body: body.slice(0, 4000),
      },
      select: { id: true, senderId: true, senderRole: true, body: true, createdAt: true },
    });

    // Notify customer (best-effort).
    try {
      await notifyUser(current.userId, "cancellation_message" as any, {
        requestId: current.id,
        bookingCode: current.bookingCode,
        status: current.status,
      });
    } catch {
      // ignore
    }

    return res.status(201).json({ message: created, status: current.status });
  } catch (error: any) {
    console.error("POST /admin/cancellations/:id/messages error:", error);
    return res.status(500).json({ error: "Failed to send message" });
  }
}) as RequestHandler);

export default router;



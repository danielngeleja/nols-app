import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { calculateFinalTourRefund } from "../lib/tourCancellationPolicy.js";
import { notifyUser } from "../lib/notifications.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler);
router.use(requireRole("ADMIN") as unknown as RequestHandler);

/** Evidence must be a NoLSAF-hosted upload; arbitrary links are rejected so admins never open attacker-controlled URLs. */
function isTrustedEvidenceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

const deductionSchema = z.object({
  kind: z.enum(["NON_REFUNDABLE_COMPONENT", "CONSUMED_SERVICE", "RECOVERY_COST"]),
  description: z.string().min(2).max(300),
  amount: z.number().positive(),
  evidenceUrl: z.string().url().max(1200).refine(isTrustedEvidenceUrl, "Deduction evidence must be a document uploaded through NoLSAF"),
  disclosedBeforePayment: z.boolean().optional(),
});

const actionSchema = z.object({
  action: z.enum(["REQUEST_EVIDENCE", "APPROVE_CANCELLATION", "REJECT", "RECORD_REFUND"]),
  reason: z.string().min(2).max(4000),
  refundPercent: z.number().min(0).max(100).optional(),
  deductions: z.array(deductionSchema).max(50).optional().default([]),
  operatorCaused: z.boolean().optional().default(false),
  refundReference: z.string().min(3).max(160).optional(),
});

router.get("/", async (req, res) => {
  const status = String(req.query.status || "").trim().toUpperCase();
  const type = String(req.query.type || "").trim().toUpperCase();
  const cases = await prisma.tourCase.findMany({
    where: { ...(status ? { status } : {}), ...(type ? { type } : {}) },
    include: {
      booking: {
        select: {
          id: true, bookingCode: true, title: true, status: true, paymentStatus: true, grossAmount: true, currency: true, customerId: true, operatorAgentId: true, startDate: true,
          guestName: true, guestEmail: true,
          customer: { select: { name: true, email: true } },
        },
      },
      events: { orderBy: { createdAt: "asc" } },
    },
    orderBy: [{ severity: "desc" }, { createdAt: "asc" }],
    take: 250,
  });
  return res.json({ ok: true, cases });
});

router.get("/:id", async (req, res) => {
  const item = await prisma.tourCase.findUnique({
    where: { id: Number(req.params.id) },
    include: {
      booking: {
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          paymentEvents: { select: { id: true, eventId: true, provider: true, amount: true, currency: true, status: true, createdAt: true }, orderBy: { createdAt: "desc" } },
          financialTransactions: { orderBy: { createdAt: "desc" } },
        },
      },
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!item) return res.status(404).json({ error: "Tour case not found" });
  return res.json({ ok: true, case: item });
});

router.post("/:id/action", async (req: any, res) => {
  const parsed = actionSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid action", details: parsed.error.flatten() });
  const caseId = Number(req.params.id);
  const item = await prisma.tourCase.findUnique({ where: { id: caseId }, include: { booking: true } });
  if (!item) return res.status(404).json({ error: "Tour case not found" });
  if (["WITHDRAWN", "CLOSED", "RESOLVED", "REJECTED"].includes(item.status)) return res.status(409).json({ error: "Tour case is already closed" });
  const { action, reason, deductions, operatorCaused, refundReference } = parsed.data;
  const adminId = Number(req.user.id);

  if (action === "REQUEST_EVIDENCE") {
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "UNDER_REVIEW", assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_cancellation_evidence_requested", { tourBookingId: item.booking.id, caseId, reason });
    return res.json({ ok: true, case: updated });
  }

  if (action === "REJECT") {
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "REJECTED", resolution: reason, closedAt: new Date(), assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_cancellation_rejected", { tourBookingId: item.booking.id, caseId, reason });
    return res.json({ ok: true, case: updated });
  }

  if (action === "APPROVE_CANCELLATION") {
    if (item.type !== "CANCELLATION") return res.status(409).json({ error: "This action requires a cancellation case" });
    if (item.booking.payoutStatus === "DISBURSED") return res.status(409).json({ error: "Operator payout is already disbursed; finance recovery is required before cancellation" });
    if (["CANCELED", "REFUNDED"].includes(String(item.booking.status).toUpperCase())) return res.status(409).json({ error: "This booking is already canceled or refunded" });
    if (String(item.booking.paymentStatus || "").toUpperCase() !== "PAID") return res.status(409).json({ error: "The original payment is not confirmed as PAID, so no refund can be approved for this booking" });
    const existingRefund = await prisma.tourFinancialTransaction.findFirst({ where: { tourBookingId: item.booking.id, kind: "REFUND", status: { in: ["APPROVED", "REFUNDED"] } }, select: { id: true } });
    if (existingRefund) return res.status(409).json({ error: "An approved or completed refund already exists for this booking" });
    const eligibilityEvent = await prisma.tourCaseEvent.findFirst({ where: { tourCaseId: caseId, type: "ELIGIBILITY_CALCULATED" }, orderBy: { createdAt: "desc" } });
    const calculatedPercent = Number((eligibilityEvent?.data as any)?.refundPercent ?? 0);
    const refundPercent = operatorCaused ? 100 : (parsed.data.refundPercent ?? calculatedPercent);
    const breakdown = calculateFinalTourRefund(Number(item.booking.grossAmount), refundPercent, deductions, operatorCaused);
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "APPROVED", resolution: reason, resolutionAmount: breakdown.finalRefundAmount, assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason, data: { ...breakdown, policyPercent: calculatedPercent, percentOverridden: !operatorCaused && refundPercent !== calculatedPercent } as any } });
      await tx.tourBooking.update({ where: { id: item.booking.id }, data: { status: "CANCELED", canceledAt: new Date(), payoutStatus: "HELD" } });
      if (breakdown.finalRefundAmount > 0) await tx.tourFinancialTransaction.create({ data: {
        tourBookingId: item.booking.id, kind: "REFUND", status: "APPROVED", currency: item.booking.currency,
        amount: breakdown.finalRefundAmount, idempotencyKey: `tour-refund-case:${caseId}`, metadata: { caseId, breakdown, approvedBy: adminId } as any,
      } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_cancellation_approved", { tourBookingId: item.booking.id, caseId, refundAmount: breakdown.finalRefundAmount, currency: item.booking.currency });
    return res.json({ ok: true, case: updated, refund: breakdown });
  }

  if (action === "RECORD_REFUND") {
    if (!refundReference) return res.status(400).json({ error: "Refund reference is required" });
    const approvedRefund = await prisma.tourFinancialTransaction.findFirst({ where: { tourBookingId: item.booking.id, kind: "REFUND", status: "APPROVED" }, orderBy: { createdAt: "desc" } });
    if (!approvedRefund) return res.status(409).json({ error: "No approved refund exists for this booking" });
    const updated = await prisma.$transaction(async (tx) => {
      await tx.tourFinancialTransaction.update({ where: { id: approvedRefund.id }, data: { status: "REFUNDED", reference: refundReference, provider: item.booking.paymentProvider || "MANUAL", metadata: { ...(approvedRefund.metadata as any || {}), recordedBy: adminId, recordedAt: new Date().toISOString() } } });
      await tx.tourBooking.update({ where: { id: item.booking.id }, data: { status: "REFUNDED", paymentStatus: "REFUNDED" } });
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "RESOLVED", resolution: reason, closedAt: new Date(), assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason, data: { refundReference, amount: Number(approvedRefund.amount) } } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_refund_completed", { tourBookingId: item.booking.id, caseId, refundReference, amount: Number(approvedRefund.amount), currency: item.booking.currency });
    return res.json({ ok: true, case: updated, refundReference });
  }

  return res.status(400).json({ error: "Unsupported action" });
});

export default router;

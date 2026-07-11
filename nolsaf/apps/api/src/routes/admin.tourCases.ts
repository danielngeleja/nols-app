import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { calculateFinalTourRefund } from "../lib/tourCancellationPolicy.js";
import { notifyUser } from "../lib/notifications.js";
import { notifyTourOperatorCase } from "../lib/tourCaseNotifications.js";
import { validateTourCancellationDecision } from "../lib/tourCancellationConsistency.js";

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
  action: z.enum(["DELIVER_TO_OPERATOR", "REQUEST_EVIDENCE", "APPROVE_CANCELLATION", "REJECT", "RECORD_REFUND"]),
  reason: z.string().min(2).max(4000),
  refundPercent: z.number().min(0).max(100).optional(),
  deductions: z.array(deductionSchema).max(50).optional().default([]),
  operatorCaused: z.boolean().optional().default(false),
  overrideOperatorResponse: z.boolean().optional().default(false),
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
  const { action, reason, deductions, operatorCaused, overrideOperatorResponse, refundReference } = parsed.data;
  const adminId = Number(req.user.id);

  if (action === "DELIVER_TO_OPERATOR") {
    if (String(item.booking.paymentStatus || "").toUpperCase() !== "PAID") return res.status(409).json({ error: "Operator responsibility begins only after the booking payment is confirmed as PAID", code: "BOOKING_NOT_OPERATIONAL" });
    const alreadyDelivered = await prisma.tourCaseEvent.findFirst({ where: { tourCaseId: caseId, type: "OPERATOR_NOTIFIED" }, select: { id: true } });
    if (alreadyDelivered) return res.status(409).json({ error: "This case has already been delivered to the assigned operator", code: "OPERATOR_ALREADY_NOTIFIED" });
    const delivered = await notifyTourOperatorCase({ kind: "SUBMITTED", operatorAgentId: item.booking.operatorAgentId, bookingId: item.booking.id, bookingCode: item.booking.bookingCode, caseId, tourTitle: item.booking.title, startDate: item.booking.startDate, reason, currency: item.booking.currency });
    if (!delivered) return res.status(503).json({ error: "The operator notification could not be recorded. Retry delivery before assigning responsibility.", code: "OPERATOR_DELIVERY_FAILED" });
    const updated = await prisma.tourCase.update({ where: { id: caseId }, data: { assignedToUserId: adminId } });
    return res.json({ ok: true, case: updated, operatorReceiptStatus: "AWAITING_RECEIPT" });
  }

  if (action === "REQUEST_EVIDENCE") {
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "UNDER_REVIEW", assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_cancellation_evidence_requested", { tourBookingId: item.booking.id, caseId, reason });
    await notifyTourOperatorCase({ kind: "EVIDENCE_REQUESTED", operatorAgentId: item.booking.operatorAgentId, bookingId: item.booking.id, bookingCode: item.booking.bookingCode, caseId, tourTitle: item.booking.title, startDate: item.booking.startDate, reason, currency: item.booking.currency });
    return res.json({ ok: true, case: updated });
  }

  const finalDecision = action === "APPROVE_CANCELLATION" || action === "REJECT";
  const existingDecisionRefund = finalDecision
    ? await prisma.tourFinancialTransaction.findFirst({ where: { tourBookingId: item.booking.id, kind: "REFUND", status: { in: ["APPROVED", "REFUNDED"] } }, select: { id: true } })
    : null;
  const consistency = finalDecision ? validateTourCancellationDecision({
    action,
    caseStatus: item.status,
    bookingStatus: item.booking.status,
    payoutStatus: item.booking.payoutStatus,
    hasApprovedRefund: Boolean(existingDecisionRefund),
  }) : null;
  if (consistency && !consistency.valid) return res.status(409).json({ error: consistency.message, code: consistency.code, reconciliationRequired: true });
  const eligibilityEvent = finalDecision
    ? await prisma.tourCaseEvent.findFirst({ where: { tourCaseId: caseId, type: "ELIGIBILITY_CALCULATED" }, orderBy: { createdAt: "desc" } })
    : null;
  const responseDueAtValue = (eligibilityEvent?.data as any)?.operatorResponseDueAt;
  const responseDueAt = responseDueAtValue ? new Date(String(responseDueAtValue)) : null;
  const operatorParticipationRequired = Boolean((eligibilityEvent?.data as any)?.operatorParticipationRequired ?? responseDueAtValue);
  const operatorDelivery = finalDecision ? await prisma.tourCaseEvent.findFirst({
    where: { tourCaseId: caseId, type: "OPERATOR_NOTIFIED" },
    select: { id: true },
  }) : null;
  const operatorResponded = finalDecision && Boolean(await prisma.tourCaseEvent.findFirst({
    where: { tourCaseId: caseId, type: { in: ["OPERATOR_RECEIVED", "ACKNOWLEDGE", "ESCALATE", "OPERATOR_COST_EVIDENCE"] } },
    select: { id: true },
  }));
  if (finalDecision && operatorParticipationRequired && !operatorDelivery && !overrideOperatorResponse) {
    return res.status(409).json({ error: "This paid case has not been delivered to the operator. Deliver it first or use the audited urgent-decision override.", code: "OPERATOR_NOT_NOTIFIED" });
  }
  if (finalDecision && operatorParticipationRequired && !operatorDelivery && overrideOperatorResponse && reason.trim().length < 20) {
    return res.status(400).json({ error: "Explain the urgent reason for deciding without confirmed operator delivery (at least 20 characters)." });
  }
  const responseWindowOpen = Boolean(finalDecision && operatorDelivery && item.booking.operatorAgentId && !operatorResponded && responseDueAt && responseDueAt.getTime() > Date.now());
  if (responseWindowOpen && !overrideOperatorResponse) {
    return res.status(409).json({
      error: `The operator response window remains open until ${responseDueAt!.toISOString()}. Wait for a response or use the audited urgent-decision override.`,
      code: "OPERATOR_RESPONSE_PENDING",
      operatorResponseDueAt: responseDueAt!.toISOString(),
    });
  }
  if (responseWindowOpen && overrideOperatorResponse && reason.trim().length < 20) {
    return res.status(400).json({ error: "Explain the urgent reason for deciding before the operator response deadline (at least 20 characters)." });
  }
  const operatorResponseOverrideUsed = Boolean(finalDecision && overrideOperatorResponse && operatorParticipationRequired && (!operatorDelivery || responseWindowOpen));

  if (action === "REJECT") {
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "REJECTED", resolution: reason, closedAt: new Date(), assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason, data: { operatorDeliveryConfirmed: Boolean(operatorDelivery), operatorResponded, operatorResponseDueAt: responseDueAt?.toISOString() || null, operatorResponseOverrideUsed } } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_cancellation_rejected", { tourBookingId: item.booking.id, caseId, reason });
    await notifyTourOperatorCase({ kind: "REJECTED", operatorAgentId: item.booking.operatorAgentId, bookingId: item.booking.id, bookingCode: item.booking.bookingCode, caseId, tourTitle: item.booking.title, startDate: item.booking.startDate, reason, currency: item.booking.currency });
    return res.json({ ok: true, case: updated });
  }

  if (action === "APPROVE_CANCELLATION") {
    if (item.type !== "CANCELLATION") return res.status(409).json({ error: "This action requires a cancellation case" });
    if (String(item.booking.paymentStatus || "").toUpperCase() !== "PAID") return res.status(409).json({ error: "The original payment is not confirmed as PAID, so no refund can be approved for this booking" });
    const calculatedPercent = Number((eligibilityEvent?.data as any)?.refundPercent ?? 0);
    const refundPercent = operatorCaused ? 100 : (parsed.data.refundPercent ?? calculatedPercent);
    const breakdown = calculateFinalTourRefund(Number(item.booking.grossAmount), refundPercent, deductions, operatorCaused);
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "APPROVED", resolution: reason, resolutionAmount: breakdown.finalRefundAmount, assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason, data: { ...breakdown, policyPercent: calculatedPercent, percentOverridden: !operatorCaused && refundPercent !== calculatedPercent, operatorDeliveryConfirmed: Boolean(operatorDelivery), operatorResponded, operatorResponseDueAt: responseDueAt?.toISOString() || null, operatorResponseOverrideUsed } as any } });
      await tx.tourBooking.update({ where: { id: item.booking.id }, data: { status: "CANCELED", canceledAt: new Date(), payoutStatus: "HELD" } });
      if (breakdown.finalRefundAmount > 0) await tx.tourFinancialTransaction.create({ data: {
        tourBookingId: item.booking.id, kind: "REFUND", status: "APPROVED", currency: item.booking.currency,
        amount: breakdown.finalRefundAmount, idempotencyKey: `tour-refund-case:${caseId}`, metadata: { caseId, breakdown, approvedBy: adminId } as any,
      } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_cancellation_approved", { tourBookingId: item.booking.id, caseId, refundAmount: breakdown.finalRefundAmount, currency: item.booking.currency });
    await notifyTourOperatorCase({ kind: "APPROVED", operatorAgentId: item.booking.operatorAgentId, bookingId: item.booking.id, bookingCode: item.booking.bookingCode, caseId, tourTitle: item.booking.title, startDate: item.booking.startDate, reason, refundAmount: breakdown.finalRefundAmount, currency: item.booking.currency });
    return res.json({ ok: true, case: updated, refund: breakdown });
  }

  if (action === "RECORD_REFUND") {
    if (!refundReference) return res.status(400).json({ error: "Refund reference is required" });
    const approvedRefund = await prisma.tourFinancialTransaction.findFirst({ where: { tourBookingId: item.booking.id, kind: "REFUND", status: "APPROVED" }, orderBy: { createdAt: "desc" } });
    const refundConsistency = validateTourCancellationDecision({
      action,
      caseStatus: item.status,
      bookingStatus: item.booking.status,
      payoutStatus: item.booking.payoutStatus,
      hasApprovedRefund: Boolean(approvedRefund),
    });
    if (!refundConsistency.valid) return res.status(409).json({ error: refundConsistency.message, code: refundConsistency.code, reconciliationRequired: true });
    const updated = await prisma.$transaction(async (tx) => {
      await tx.tourFinancialTransaction.update({ where: { id: approvedRefund.id }, data: { status: "REFUNDED", reference: refundReference, provider: item.booking.paymentProvider || "MANUAL", metadata: { ...(approvedRefund.metadata as any || {}), recordedBy: adminId, recordedAt: new Date().toISOString() } } });
      await tx.tourBooking.update({ where: { id: item.booking.id }, data: { status: "REFUNDED", paymentStatus: "REFUNDED" } });
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "RESOLVED", resolution: reason, closedAt: new Date(), assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason, data: { refundReference, amount: Number(approvedRefund.amount) } } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_refund_completed", { tourBookingId: item.booking.id, caseId, refundReference, amount: Number(approvedRefund.amount), currency: item.booking.currency });
    await notifyTourOperatorCase({ kind: "REFUNDED", operatorAgentId: item.booking.operatorAgentId, bookingId: item.booking.id, bookingCode: item.booking.bookingCode, caseId, tourTitle: item.booking.title, startDate: item.booking.startDate, reason, refundAmount: Number(approvedRefund.amount), currency: item.booking.currency });
    return res.json({ ok: true, case: updated, refundReference });
  }

  return res.status(400).json({ error: "Unsupported action" });
});

export default router;

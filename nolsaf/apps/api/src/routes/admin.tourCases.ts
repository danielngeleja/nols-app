import { Router } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { calculateFinalTourRefund, calculatePayoutRecovery } from "../lib/tourCancellationPolicy.js";
import { notifyUser } from "../lib/notifications.js";
import { notifyTourOperatorCase } from "../lib/tourCaseNotifications.js";
import { validateTourCancellationDecision } from "../lib/tourCancellationConsistency.js";
import { calculateRefundChannelCharges, inferRefundChannel, REFUND_CHANNEL_POLICY_VERSION } from "../lib/refundChannelCharges.js";

/** Policy 10.2: the terms accepted at booking time govern; bookings made before the charges policy pay no channel charges. */
function chargesAcceptedAtBooking(bookingMetadata: unknown): boolean {
  const version = String((bookingMetadata as any)?.tourCancellationPolicy?.version || "");
  return version >= REFUND_CHANNEL_POLICY_VERSION;
}

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
  kind: z.enum(["NON_REFUNDABLE_COMPONENT", "CONSUMED_SERVICE", "RECOVERY_COST", "SUPPLIER_COMMITTED"]),
  description: z.string().min(2).max(300),
  amount: z.number().positive(),
  evidenceUrl: z.string().url().max(1200).refine(isTrustedEvidenceUrl, "Deduction evidence must be a document uploaded through NoLSAF"),
  disclosedBeforePayment: z.boolean().optional(),
});

const actionSchema = z.object({
  action: z.enum(["DELIVER_TO_OPERATOR", "REQUEST_EVIDENCE", "APPROVE_CANCELLATION", "REJECT", "RECORD_REFUND", "RECORD_RECOVERY"]),
  reason: z.string().min(2).max(4000),
  refundPercent: z.number().min(0).max(100).optional(),
  deductions: z.array(deductionSchema).max(50).optional().default([]),
  operatorCaused: z.boolean().optional().default(false),
  overrideOperatorResponse: z.boolean().optional().default(false),
  refundReference: z.string().min(3).max(160).optional(),
  recoveryReference: z.string().min(3).max(160).optional(),
  actualBankCharges: z.number().min(0).optional(),
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
  const { action, reason, deductions, operatorCaused, overrideOperatorResponse, refundReference, recoveryReference, actualBankCharges } = parsed.data;
  // RECORD_RECOVERY stays available after the case closes: the traveller refund
  // resolves the case while the operator's recovery debt may still be open.
  if (action !== "RECORD_RECOVERY" && ["WITHDRAWN", "CLOSED", "RESOLVED", "REJECTED"].includes(item.status)) return res.status(409).json({ error: "Tour case is already closed" });
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
    // Scenario B: a front payment already left NoLSAF, so approval creates an
    // operator recovery debt instead of a payout hold.
    const payoutReleased = Boolean(consistency && consistency.valid && consistency.requiresRecovery);
    let recovery: ReturnType<typeof calculatePayoutRecovery> | null = null;
    if (payoutReleased) {
      const disbursedPayouts = await prisma.tourFinancialTransaction.findMany({
        where: { tourBookingId: item.booking.id, kind: "PAYOUT", status: { in: ["DISBURSED", "PAID"] } },
        select: { amount: true },
      });
      const disbursedTotal = disbursedPayouts.length
        ? disbursedPayouts.reduce((sum, entry) => sum + Number(entry.amount), 0)
        : Number(item.booking.operatorPayoutAmount || 0);
      recovery = calculatePayoutRecovery(disbursedTotal, breakdown.finalRefundAmount, operatorCaused);
    }
    const recoveryRequired = Boolean(recovery && recovery.recoveryAmount > 0);
    // Funds the operator already deployed to suppliers stay with the operator:
    // accepted SUPPLIER_COMMITTED evidence lowered the refund, and the recovery
    // debt is capped at that refund.
    const supplierCommittedTotal = breakdown.acceptedDeductions
      .filter((entry) => entry.kind === "SUPPLIER_COMMITTED")
      .reduce((sum, entry) => sum + entry.amount, 0);
    const channelChargeEstimate = calculateRefundChannelCharges({
      grossRefundAmount: breakdown.finalRefundAmount,
      channel: inferRefundChannel(item.booking.paymentProvider, item.booking.payerPhone),
      eligibilityCode: (eligibilityEvent?.data as any)?.eligibilityCode,
      operatorCaused,
      chargesAcceptedAtBooking: chargesAcceptedAtBooking(item.booking.metadata),
    });
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "APPROVED", resolution: reason, resolutionAmount: breakdown.finalRefundAmount, assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason, data: { ...breakdown, policyPercent: calculatedPercent, percentOverridden: !operatorCaused && refundPercent !== calculatedPercent, operatorDeliveryConfirmed: Boolean(operatorDelivery), operatorResponded, operatorResponseDueAt: responseDueAt?.toISOString() || null, operatorResponseOverrideUsed, payoutReleasedAtApproval: payoutReleased, recovery, supplierCommittedTotal, channelChargeEstimate } as any } });
      await tx.tourBooking.update({ where: { id: item.booking.id }, data: {
        status: "CANCELED", canceledAt: new Date(),
        // No debt to recover (e.g. zero refund) leaves the released payout untouched.
        payoutStatus: payoutReleased ? (recoveryRequired ? "RECOVERY_PENDING" : undefined) : "HELD",
      } });
      if (breakdown.finalRefundAmount > 0) await tx.tourFinancialTransaction.create({ data: {
        tourBookingId: item.booking.id, kind: "REFUND", status: "APPROVED", currency: item.booking.currency,
        amount: breakdown.finalRefundAmount, idempotencyKey: `tour-refund-case:${caseId}`, metadata: { caseId, breakdown, approvedBy: adminId } as any,
      } });
      if (recoveryRequired) await tx.tourFinancialTransaction.create({ data: {
        tourBookingId: item.booking.id, kind: "PAYOUT_RECOVERY", status: "PENDING", currency: item.booking.currency,
        amount: recovery!.recoveryAmount, idempotencyKey: `tour-recovery-case:${caseId}`,
        metadata: { caseId, ...recovery, operatorCaused, approvedBy: adminId, acceptedDeductionTotal: breakdown.deductionTotal, supplierCommittedTotal } as any,
      } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_cancellation_approved", { tourBookingId: item.booking.id, caseId, refundAmount: breakdown.finalRefundAmount, currency: item.booking.currency });
    await notifyTourOperatorCase({ kind: "APPROVED", operatorAgentId: item.booking.operatorAgentId, bookingId: item.booking.id, bookingCode: item.booking.bookingCode, caseId, tourTitle: item.booking.title, startDate: item.booking.startDate, reason, refundAmount: breakdown.finalRefundAmount, currency: item.booking.currency });
    if (recoveryRequired) await notifyTourOperatorCase({ kind: "RECOVERY_REQUIRED", operatorAgentId: item.booking.operatorAgentId, bookingId: item.booking.id, bookingCode: item.booking.bookingCode, caseId, tourTitle: item.booking.title, startDate: item.booking.startDate, reason, recoveryAmount: recovery!.recoveryAmount, currency: item.booking.currency });
    return res.json({ ok: true, case: updated, refund: breakdown, recovery, channelChargeEstimate });
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
    // Method-specific refund costs (Mavros concept): card surcharge, actual
    // bank charges entered by the admin, and the flat admin charge. FULL_GRACE
    // cooling-off refunds are exempt.
    const refundEligibilityEvent = await prisma.tourCaseEvent.findFirst({ where: { tourCaseId: caseId, type: "ELIGIBILITY_CALCULATED" }, orderBy: { createdAt: "desc" } });
    const channelCharges = calculateRefundChannelCharges({
      grossRefundAmount: Number(approvedRefund.amount),
      channel: inferRefundChannel(item.booking.paymentProvider, item.booking.payerPhone),
      eligibilityCode: (refundEligibilityEvent?.data as any)?.eligibilityCode,
      actualBankCharges,
      operatorCaused: Boolean((approvedRefund.metadata as any)?.breakdown?.operatorCaused),
      chargesAcceptedAtBooking: chargesAcceptedAtBooking(item.booking.metadata),
    });
    const updated = await prisma.$transaction(async (tx) => {
      await tx.tourFinancialTransaction.update({ where: { id: approvedRefund.id }, data: { status: "REFUNDED", reference: refundReference, provider: item.booking.paymentProvider || "MANUAL", metadata: { ...(approvedRefund.metadata as any || {}), recordedBy: adminId, recordedAt: new Date().toISOString(), channelCharges } as any } });
      await tx.tourBooking.update({ where: { id: item.booking.id }, data: { status: "REFUNDED", paymentStatus: "REFUNDED" } });
      const value = await tx.tourCase.update({ where: { id: caseId }, data: { status: "RESOLVED", resolution: reason, closedAt: new Date(), assignedToUserId: adminId } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason, data: { refundReference, amount: Number(approvedRefund.amount), channelCharges } as any } });
      return value;
    });
    if (item.booking.customerId) await notifyUser(item.booking.customerId, "tour_refund_completed", { tourBookingId: item.booking.id, caseId, refundReference, amount: channelCharges.netRefundAmount, grossAmount: Number(approvedRefund.amount), charges: channelCharges.totalCharges, currency: item.booking.currency });
    await notifyTourOperatorCase({ kind: "REFUNDED", operatorAgentId: item.booking.operatorAgentId, bookingId: item.booking.id, bookingCode: item.booking.bookingCode, caseId, tourTitle: item.booking.title, startDate: item.booking.startDate, reason, refundAmount: Number(approvedRefund.amount), currency: item.booking.currency });
    return res.json({ ok: true, case: updated, refundReference, channelCharges });
  }

  if (action === "RECORD_RECOVERY") {
    if (!recoveryReference) return res.status(400).json({ error: "Recovery reference is required (repayment receipt or payout-offset reference)" });
    const pendingRecovery = await prisma.tourFinancialTransaction.findFirst({ where: { tourBookingId: item.booking.id, kind: "PAYOUT_RECOVERY", status: "PENDING" }, orderBy: { createdAt: "desc" } });
    const recoveryConsistency = validateTourCancellationDecision({
      action,
      caseStatus: item.status,
      bookingStatus: item.booking.status,
      payoutStatus: item.booking.payoutStatus,
      hasApprovedRefund: false,
    });
    if (!recoveryConsistency.valid) return res.status(409).json({ error: recoveryConsistency.message, code: recoveryConsistency.code, reconciliationRequired: true });
    if (!pendingRecovery) return res.status(409).json({ error: "No pending operator recovery record exists for this booking", code: "NO_RECOVERY_PENDING" });
    await prisma.$transaction(async (tx) => {
      await tx.tourFinancialTransaction.update({ where: { id: pendingRecovery.id }, data: { status: "RECOVERED", reference: recoveryReference, metadata: { ...(pendingRecovery.metadata as any || {}), recordedBy: adminId, recordedAt: new Date().toISOString() } } });
      await tx.tourBooking.update({ where: { id: item.booking.id }, data: { payoutStatus: "RECOVERED" } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: adminId, type: action, message: reason, data: { recoveryReference, amount: Number(pendingRecovery.amount) } } });
    });
    await notifyTourOperatorCase({ kind: "RECOVERY_RECORDED", operatorAgentId: item.booking.operatorAgentId, bookingId: item.booking.id, bookingCode: item.booking.bookingCode, caseId, tourTitle: item.booking.title, startDate: item.booking.startDate, reason, recoveryAmount: Number(pendingRecovery.amount), currency: item.booking.currency });
    return res.json({ ok: true, case: item, recoveryReference });
  }

  return res.status(400).json({ error: "Unsupported action" });
});

export default router;

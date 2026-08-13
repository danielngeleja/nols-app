import { evaluateRefundWindow } from "./refundWindowPolicy.js";

export const TOUR_CANCELLATION_POLICY_VERSION = "2026-07-12";

export type TourCancellationInput = {
  bookedAt: Date;
  startDate: Date | null;
  requestedAt: Date;
  amountPaid: number;
  status: string;
  pickupValidated?: boolean;
  nonRefundable?: boolean;
};

export type TourCancellationDecision = {
  policyVersion: string;
  eligibilityCode: "FULL_GRACE" | "PARTIAL_50" | "NON_REFUNDABLE" | "LATE_EXCEPTION_ONLY" | "STARTED_EXCEPTION_ONLY" | "MANUAL_REVIEW";
  eligible: boolean;
  requiresReview: boolean;
  refundPercent: number;
  estimatedRefundAmount: number;
  hoursBeforeStart: number | null;
  reason: string;
};

export function evaluateTourCancellation(input: TourCancellationInput): TourCancellationDecision {
  const status = String(input.status || "").toUpperCase();
  const started = Boolean(input.pickupValidated) || ["IN_PROGRESS", "OPERATOR_COMPLETED", "COMPLETED"].includes(status);
  const window = input.startDate ? evaluateRefundWindow({ bookedAt: input.bookedAt, startsAt: input.startDate, requestedAt: input.requestedAt }) : null;
  const hoursBeforeStart = window ? window.hoursBeforeStart : null;
  const amount = Math.max(0, Number(input.amountPaid) || 0);
  const result = (eligibilityCode: TourCancellationDecision["eligibilityCode"], eligible: boolean, requiresReview: boolean, refundPercent: number, reason: string): TourCancellationDecision => ({
    policyVersion: TOUR_CANCELLATION_POLICY_VERSION,
    eligibilityCode, eligible, requiresReview, refundPercent,
    estimatedRefundAmount: Math.round(amount * refundPercent) / 100,
    hoursBeforeStart: hoursBeforeStart == null ? null : Math.round(hoursBeforeStart * 10) / 10,
    reason,
  });

  if (started) return result("STARTED_EXCEPTION_ONLY", false, true, 0, "The tour has commenced. Only verified exceptional circumstances or operator failure may qualify for a prorated refund.");
  if (input.nonRefundable) return result("NON_REFUNDABLE", false, true, 0, "This package was disclosed as non-refundable. Exceptional circumstances still require NoLSAF review.");
  if (!window) return result("MANUAL_REVIEW", false, true, 0, "The tour start date is unavailable, so NoLSAF must review eligibility manually.");
  if (window.tier === "FULL_100") return result("FULL_GRACE", true, true, window.refundPercent, "Cancellation is within 24 hours of booking and at least 72 hours before tour commencement.");
  if (window.tier === "PARTIAL_50") return result("PARTIAL_50", true, true, window.refundPercent, "Cancellation is at least 96 hours before commencement and is provisionally eligible for 50%, less documented non-recoverable costs verified by NoLSAF.");
  return result("LATE_EXCEPTION_ONLY", false, true, 0, "Cancellation is less than 96 hours before commencement. Only verified exceptional circumstances or operator failure may qualify.");
}

export function packageIsNonRefundable(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
  const value = snapshot as Record<string, any>;
  return value.nonRefundable === true || ["NON_REFUNDABLE", "NONE"].includes(String(value.refundability || value.cancellationPolicy || "").toUpperCase());
}

export type TourRefundDeduction = {
  /**
   * SUPPLIER_COMMITTED: funds the operator already deployed to downstream
   * providers (lodges, hotels, vehicles) and cannot recover. Requires supplier
   * evidence; the amount must be the non-recoverable portion only. Accepting it
   * reduces the traveller refund, which in turn reduces any operator recovery
   * debt, so the operator keeps exactly the documented deployed portion.
   */
  kind: "NON_REFUNDABLE_COMPONENT" | "CONSUMED_SERVICE" | "RECOVERY_COST" | "SUPPLIER_COMMITTED";
  description: string;
  amount: number;
  evidenceUrl: string;
  disclosedBeforePayment?: boolean;
};

/**
 * Scenario B: the operator already received a disbursed front payment when the
 * cancellation is approved. The traveller refund proceeds first; the operator
 * owes NoLSAF a recovery debt settled by repayment or payout offset.
 * Traveller-caused: capped at min(disbursed, final refund).
 * Operator-caused: the full disbursed amount comes back.
 */
export function calculatePayoutRecovery(disbursedAmount: number, finalRefundAmount: number, operatorCaused = false) {
  const disbursed = Math.round(Math.max(0, Number(disbursedAmount) || 0) * 100) / 100;
  const refund = Math.max(0, Number(finalRefundAmount) || 0);
  const recoveryAmount = Math.round((operatorCaused ? disbursed : Math.min(disbursed, refund)) * 100) / 100;
  return { disbursedAmount: disbursed, recoveryAmount, basis: operatorCaused ? "FULL_DISBURSEMENT" : "CAPPED_AT_REFUND" as const };
}

export function calculateFinalTourRefund(amountPaid: number, refundPercent: number, deductions: TourRefundDeduction[], operatorCaused = false) {
  const baseRefund = Math.round(Math.max(0, amountPaid) * Math.max(0, Math.min(100, refundPercent))) / 100;
  const acceptedDeductions = operatorCaused ? [] : deductions.filter((item) => {
    if (!(item.amount > 0) || !item.description.trim() || !/^https?:\/\//i.test(item.evidenceUrl)) return false;
    return item.kind === "CONSUMED_SERVICE" || item.kind === "RECOVERY_COST" || item.kind === "SUPPLIER_COMMITTED" || item.disclosedBeforePayment === true;
  });
  const deductionTotal = Math.round(acceptedDeductions.reduce((sum, item) => sum + item.amount, 0) * 100) / 100;
  return {
    amountPaid,
    refundPercent,
    baseRefund,
    acceptedDeductions,
    rejectedDeductionCount: Math.max(0, deductions.length - acceptedDeductions.length),
    deductionTotal,
    finalRefundAmount: Math.max(0, Math.round((baseRefund - deductionTotal) * 100) / 100),
    operatorCaused,
  };
}

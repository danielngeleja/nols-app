export type TourCancellationDecisionAction = "REJECT" | "APPROVE_CANCELLATION" | "RECORD_REFUND" | "RECORD_RECOVERY";

export type TourCancellationConsistencyInput = {
  action: TourCancellationDecisionAction;
  caseStatus: string | null | undefined;
  bookingStatus: string | null | undefined;
  payoutStatus: string | null | undefined;
  hasApprovedRefund: boolean;
};

export type TourCancellationConsistencyResult =
  | { valid: true; requiresRecovery?: boolean }
  | { valid: false; code: string; message: string };

const upper = (value: unknown) => String(value || "").trim().toUpperCase();

/**
 * Protects the relationship between a tour cancellation case, its booking,
 * payout, and refund record. This validates transitions before any write so
 * contradictory combinations cannot be created by the admin workflow.
 *
 * Payout lifecycle in a cancellation:
 *  - Scenario A (payout not yet released): approval moves the payout to HELD.
 *  - Scenario B (front payment already DISBURSED/PAID): approval is allowed
 *    but flagged requiresRecovery; the payout moves to RECOVERY_PENDING and a
 *    PAYOUT_RECOVERY debt is created. The traveller refund proceeds first;
 *    RECORD_RECOVERY settles the operator debt afterwards.
 */
export function validateTourCancellationDecision(input: TourCancellationConsistencyInput): TourCancellationConsistencyResult {
  const caseStatus = upper(input.caseStatus);
  const bookingStatus = upper(input.bookingStatus);
  const payoutStatus = upper(input.payoutStatus);
  const bookingIsCancelled = ["CANCELED", "CANCELLED", "REFUNDED"].includes(bookingStatus);
  const payoutIsReleased = ["DISBURSED", "PAID"].includes(payoutStatus);
  const payoutIsFrozenForCase = ["HELD", "RECOVERY_PENDING"].includes(payoutStatus);

  if (input.action === "REJECT") {
    if (bookingIsCancelled) return { valid: false, code: "BOOKING_ALREADY_CANCELLED", message: "This cancellation request cannot be rejected because the booking is already cancelled or refunded. Reconcile the booking record first." };
    if (payoutIsFrozenForCase) return { valid: false, code: "PAYOUT_HOLD_CONFLICT", message: "This cancellation request cannot be rejected while the operator payout is held or pending recovery. Resolve or document the payout state first." };
    if (input.hasApprovedRefund) return { valid: false, code: "REFUND_ALREADY_APPROVED", message: "This cancellation request cannot be rejected because an approved or completed refund already exists." };
    return { valid: true };
  }

  if (input.action === "APPROVE_CANCELLATION") {
    if (bookingIsCancelled) return { valid: false, code: "BOOKING_ALREADY_CANCELLED", message: "This booking is already cancelled or refunded." };
    if (input.hasApprovedRefund) return { valid: false, code: "REFUND_ALREADY_APPROVED", message: "An approved or completed refund already exists for this booking." };
    if (payoutIsReleased) return { valid: true, requiresRecovery: true };
    return { valid: true };
  }

  if (input.action === "RECORD_RECOVERY") {
    if (!["APPROVED", "RESOLVED"].includes(caseStatus)) return { valid: false, code: "CASE_NOT_APPROVED", message: "Operator recovery can only be recorded on an approved or resolved cancellation case." };
    if (!bookingIsCancelled) return { valid: false, code: "BOOKING_NOT_CANCELLED", message: "The booking must be cancelled before recording an operator recovery." };
    if (payoutStatus !== "RECOVERY_PENDING") return { valid: false, code: "NO_RECOVERY_PENDING", message: "The operator payout is not pending recovery for this booking." };
    return { valid: true };
  }

  if (caseStatus !== "APPROVED") return { valid: false, code: "CASE_NOT_APPROVED", message: "The cancellation case must be approved before recording a completed refund." };
  if (!["CANCELED", "CANCELLED"].includes(bookingStatus)) return { valid: false, code: "BOOKING_NOT_CANCELLED", message: "The booking must be cancelled before recording a completed refund." };
  if (!["HELD", "RECOVERY_PENDING", "RECOVERED"].includes(payoutStatus)) return { valid: false, code: "PAYOUT_NOT_HELD", message: "The operator payout must be held, pending recovery, or recovered before recording a completed refund." };
  if (!input.hasApprovedRefund) return { valid: false, code: "REFUND_NOT_APPROVED", message: "No approved refund record exists for this booking." };
  return { valid: true };
}

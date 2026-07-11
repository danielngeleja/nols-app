export type TourCancellationDecisionAction = "REJECT" | "APPROVE_CANCELLATION" | "RECORD_REFUND";

export type TourCancellationConsistencyInput = {
  action: TourCancellationDecisionAction;
  caseStatus: string | null | undefined;
  bookingStatus: string | null | undefined;
  payoutStatus: string | null | undefined;
  hasApprovedRefund: boolean;
};

export type TourCancellationConsistencyResult =
  | { valid: true }
  | { valid: false; code: string; message: string };

const upper = (value: unknown) => String(value || "").trim().toUpperCase();

/**
 * Protects the relationship between a tour cancellation case, its booking,
 * payout, and refund record. This validates transitions before any write so
 * contradictory combinations cannot be created by the admin workflow.
 */
export function validateTourCancellationDecision(input: TourCancellationConsistencyInput): TourCancellationConsistencyResult {
  const caseStatus = upper(input.caseStatus);
  const bookingStatus = upper(input.bookingStatus);
  const payoutStatus = upper(input.payoutStatus);
  const bookingIsCancelled = ["CANCELED", "CANCELLED", "REFUNDED"].includes(bookingStatus);
  const payoutIsReleased = ["DISBURSED", "PAID"].includes(payoutStatus);

  if (input.action === "REJECT") {
    if (bookingIsCancelled) return { valid: false, code: "BOOKING_ALREADY_CANCELLED", message: "This cancellation request cannot be rejected because the booking is already cancelled or refunded. Reconcile the booking record first." };
    if (payoutStatus === "HELD") return { valid: false, code: "PAYOUT_HOLD_CONFLICT", message: "This cancellation request cannot be rejected while the operator payout is held. Resolve or document the payout hold first." };
    if (input.hasApprovedRefund) return { valid: false, code: "REFUND_ALREADY_APPROVED", message: "This cancellation request cannot be rejected because an approved or completed refund already exists." };
    return { valid: true };
  }

  if (input.action === "APPROVE_CANCELLATION") {
    if (bookingIsCancelled) return { valid: false, code: "BOOKING_ALREADY_CANCELLED", message: "This booking is already cancelled or refunded." };
    if (payoutIsReleased) return { valid: false, code: "PAYOUT_ALREADY_RELEASED", message: "The operator payout is already released. Finance recovery is required before approving cancellation." };
    if (input.hasApprovedRefund) return { valid: false, code: "REFUND_ALREADY_APPROVED", message: "An approved or completed refund already exists for this booking." };
    return { valid: true };
  }

  if (caseStatus !== "APPROVED") return { valid: false, code: "CASE_NOT_APPROVED", message: "The cancellation case must be approved before recording a completed refund." };
  if (!["CANCELED", "CANCELLED"].includes(bookingStatus)) return { valid: false, code: "BOOKING_NOT_CANCELLED", message: "The booking must be cancelled before recording a completed refund." };
  if (payoutStatus !== "HELD") return { valid: false, code: "PAYOUT_NOT_HELD", message: "The operator payout must be held before recording a completed refund." };
  if (!input.hasApprovedRefund) return { valid: false, code: "REFUND_NOT_APPROVED", message: "No approved refund record exists for this booking." };
  return { valid: true };
}

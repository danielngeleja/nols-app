export const ACCOMMODATION_CANCELLATION_STATUSES = [
  "SUBMITTED",
  "REVIEWING",
  "NEED_INFO",
  "APPROVED",
  "REFUND_PENDING",
  "REFUNDED",
  "REJECTED",
] as const;

export type AccommodationCancellationStatus = (typeof ACCOMMODATION_CANCELLATION_STATUSES)[number];

export const ACCOMMODATION_CANCELLATION_TRANSITIONS: Record<AccommodationCancellationStatus, readonly AccommodationCancellationStatus[]> = {
  SUBMITTED: ["REVIEWING"],
  REVIEWING: ["NEED_INFO", "APPROVED", "REJECTED"],
  NEED_INFO: ["REVIEWING"],
  APPROVED: ["REFUND_PENDING"],
  REFUND_PENDING: ["REFUNDED"],
  REFUNDED: [],
  REJECTED: [],
};

export function normalizeAccommodationCancellationStatus(input: unknown): AccommodationCancellationStatus | null {
  const value = String(input || "").trim().toUpperCase();
  return (ACCOMMODATION_CANCELLATION_STATUSES as readonly string[]).includes(value)
    ? value as AccommodationCancellationStatus
    : null;
}

export function validateAccommodationCancellationTransition(fromInput: unknown, toInput: unknown) {
  const from = normalizeAccommodationCancellationStatus(fromInput);
  const to = normalizeAccommodationCancellationStatus(toInput);
  if (!from || !to) return { valid: false as const, error: "Invalid cancellation status" };
  if (from === to) return { valid: false as const, error: `Cancellation is already ${to.toLowerCase().replace(/_/g, " ")}` };
  if (!ACCOMMODATION_CANCELLATION_TRANSITIONS[from].includes(to)) {
    const allowed = ACCOMMODATION_CANCELLATION_TRANSITIONS[from];
    return {
      valid: false as const,
      error: allowed.length > 0
        ? `Cannot move cancellation from ${from} to ${to}. Next allowed: ${allowed.join(", ")}`
        : `${from} is a final cancellation status`,
    };
  }
  return { valid: true as const, from, to };
}

export function accommodationCancellationMessage(status: AccommodationCancellationStatus, decisionNote?: string | null) {
  const note = String(decisionNote || "").trim();
  const messages: Record<AccommodationCancellationStatus, string> = {
    SUBMITTED: "Your accommodation cancellation request has been submitted.",
    REVIEWING: "We are reviewing your accommodation cancellation request and its payment details.",
    NEED_INFO: note || "We need additional information before we can decide your accommodation cancellation request.",
    APPROVED: `Your accommodation cancellation has been approved.${note ? ` ${note}` : ""}`,
    REFUND_PENDING: "Your accommodation refund has been added to the payment queue and is awaiting provider completion.",
    REFUNDED: "Your accommodation refund has been confirmed. The refund reference is available in your cancellation details.",
    REJECTED: `Your accommodation cancellation request was rejected after verification.${note ? ` ${note}` : ""}`,
  };
  return messages[status];
}

export function validateAccommodationCancellationRequirements(input: {
  to: AccommodationCancellationStatus;
  decisionNote?: string | null;
  policyEligible: boolean;
  hasPaymentProof: boolean;
  refundProvider?: string | null;
  refundReference?: string | null;
  approvedRefundAmount?: number | null;
}) {
  const note = String(input.decisionNote || "").trim();
  if (["NEED_INFO", "APPROVED", "REJECTED"].includes(input.to) && !note) {
    return { valid: false as const, error: `${input.to.replace(/_/g, " ")} requires an administrative reason` };
  }
  if (input.to === "APPROVED" && !input.policyEligible) {
    return { valid: false as const, error: "This request is not policy eligible and cannot be approved through the automated workflow" };
  }
  if (input.to === "APPROVED" && !input.hasPaymentProof) {
    return { valid: false as const, error: "Confirmed payment transaction proof is required before approval" };
  }
  if (input.to === "APPROVED" && Number(input.approvedRefundAmount || 0) <= 0) {
    return { valid: false as const, error: "The policy calculation must produce a positive refund amount before approval" };
  }
  if (input.to === "REFUND_PENDING" && !String(input.refundProvider || "").trim()) {
    return { valid: false as const, error: "Refund provider is required before adding the refund to the payment queue" };
  }
  if (input.to === "REFUNDED" && String(input.refundReference || "").trim().length < 3) {
    return { valid: false as const, error: "A valid provider refund reference is required before confirming the refund" };
  }
  if (input.to === "REFUNDED" && Number(input.approvedRefundAmount || 0) <= 0) {
    return { valid: false as const, error: "A positive approved refund amount is required before confirming the refund" };
  }
  return { valid: true as const };
}

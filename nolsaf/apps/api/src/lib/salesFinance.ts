const PAYOUT_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED"],
  APPROVED: ["PROCESSING"],
  PROCESSING: ["PAID"],
  PAID: [],
  REJECTED: [],
  CANCELLED: [],
};

export function canApproveCommission(status: string): boolean {
  return status === "ELIGIBLE";
}

export function canReverseCommission(status: string, lockedPayoutStatus?: string | null): boolean {
  if (status === "REVERSED" || status === "CANCELLED") return false;
  return !lockedPayoutStatus || lockedPayoutStatus === "PAID";
}

export function canTransitionSalesPayout(from: string, to: string): boolean {
  return PAYOUT_TRANSITIONS[from]?.includes(to) ?? false;
}

export function calculateSalesPayoutApproval(requestedAmount: number, deductionAmount: number) {
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new RangeError("Requested amount must be positive");
  }
  if (!Number.isFinite(deductionAmount) || deductionAmount < 0 || deductionAmount >= requestedAmount) {
    throw new RangeError("Deduction must be less than requested amount");
  }
  return {
    approvedAmount: requestedAmount,
    deductionAmount,
    netPaidAmount: requestedAmount - deductionAmount,
  };
}

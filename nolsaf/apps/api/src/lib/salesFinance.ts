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

/**
 * Withholding tax rate for sales partner payouts, in percent. Read from
 * SALES_WHT_RATE_PERCENT and deliberately 0 (off) when unset: switching tax on
 * changes what partners receive, so it is a finance decision made in config,
 * not a side effect of deploying code. The confirmed statutory rate is set there.
 */
export function salesWithholdingTaxRate(): number {
  const raw = Number(process.env.SALES_WHT_RATE_PERCENT ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(raw, 50);
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function calculateSalesPayoutApproval(requestedAmount: number, deductionAmount: number, withholdingTaxRate = 0) {
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new RangeError("Requested amount must be positive");
  }
  if (!Number.isFinite(deductionAmount) || deductionAmount < 0 || deductionAmount >= requestedAmount) {
    throw new RangeError("Deduction must be less than requested amount");
  }
  if (!Number.isFinite(withholdingTaxRate) || withholdingTaxRate < 0 || withholdingTaxRate >= 100) {
    throw new RangeError("Withholding tax rate must be between 0 and 100");
  }
  // Tax is withheld on what the partner is actually owed after recoveries.
  const taxable = requestedAmount - deductionAmount;
  const withholdingTaxAmount = round2(taxable * (withholdingTaxRate / 100));
  return {
    approvedAmount: requestedAmount,
    deductionAmount,
    withholdingTaxRate,
    withholdingTaxAmount,
    netPaidAmount: round2(taxable - withholdingTaxAmount),
  };
}

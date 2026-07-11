export const REFUND_WINDOW_POLICY = {
  fullGraceMaxHoursSinceBooking: 24,
  fullGraceMinHoursBeforeStart: 72,
  partialMinHoursBeforeStart: 96,
  partialRefundPercent: 50,
} as const;

export type RefundWindowTier = "FULL_100" | "PARTIAL_50" | "NONE";

export type RefundWindowResult = {
  tier: RefundWindowTier;
  refundPercent: number;
  hoursSinceBooking: number;
  hoursBeforeStart: number;
};

/**
 * Shared NoLSAF refund windows used by both accommodation and tour cancellations:
 *  - FULL_100: requested within 24h of booking AND at least 72h before start/check-in
 *  - PARTIAL_50: requested at least 96h before start/check-in
 *  - NONE: everything later (exception/manual paths are domain-specific)
 */
export function evaluateRefundWindow(input: { bookedAt: Date; startsAt: Date; requestedAt: Date }): RefundWindowResult {
  const hoursSinceBooking = (input.requestedAt.getTime() - input.bookedAt.getTime()) / 3_600_000;
  const hoursBeforeStart = (input.startsAt.getTime() - input.requestedAt.getTime()) / 3_600_000;
  const p = REFUND_WINDOW_POLICY;
  const tier: RefundWindowTier =
    hoursSinceBooking <= p.fullGraceMaxHoursSinceBooking && hoursBeforeStart >= p.fullGraceMinHoursBeforeStart ? "FULL_100"
    : hoursBeforeStart >= p.partialMinHoursBeforeStart ? "PARTIAL_50"
    : "NONE";
  return {
    tier,
    refundPercent: tier === "FULL_100" ? 100 : tier === "PARTIAL_50" ? p.partialRefundPercent : 0,
    hoursSinceBooking,
    hoursBeforeStart,
  };
}

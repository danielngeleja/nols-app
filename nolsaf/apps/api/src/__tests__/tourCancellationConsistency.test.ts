import { describe, expect, it } from "vitest";
import { validateTourCancellationDecision } from "../lib/tourCancellationConsistency";

const base = { caseStatus: "UNDER_REVIEW", bookingStatus: "CONFIRMED", payoutStatus: "NOT_READY", hasApprovedRefund: false };

describe("tour cancellation consistency guard", () => {
  it("allows rejecting a request while the booking remains active", () => {
    expect(validateTourCancellationDecision({ ...base, action: "REJECT" })).toEqual({ valid: true });
  });

  it("blocks rejected case plus cancelled booking", () => {
    const result = validateTourCancellationDecision({ ...base, action: "REJECT", bookingStatus: "CANCELED" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("BOOKING_ALREADY_CANCELLED");
  });

  it("blocks rejected case plus held payout", () => {
    const result = validateTourCancellationDecision({ ...base, action: "REJECT", payoutStatus: "HELD" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("PAYOUT_HOLD_CONFLICT");
  });

  it("blocks approval after payout release", () => {
    const result = validateTourCancellationDecision({ ...base, action: "APPROVE_CANCELLATION", payoutStatus: "DISBURSED" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe("PAYOUT_ALREADY_RELEASED");
  });

  it("requires approved case, cancelled booking, held payout, and approved refund before completion", () => {
    expect(validateTourCancellationDecision({ action: "RECORD_REFUND", caseStatus: "APPROVED", bookingStatus: "CANCELED", payoutStatus: "HELD", hasApprovedRefund: true })).toEqual({ valid: true });
    expect(validateTourCancellationDecision({ action: "RECORD_REFUND", caseStatus: "APPROVED", bookingStatus: "CONFIRMED", payoutStatus: "HELD", hasApprovedRefund: true }).valid).toBe(false);
  });
});

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

  it("blocks rejected case plus held or recovery-pending payout", () => {
    for (const payoutStatus of ["HELD", "RECOVERY_PENDING"]) {
      const result = validateTourCancellationDecision({ ...base, action: "REJECT", payoutStatus });
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.code).toBe("PAYOUT_HOLD_CONFLICT");
    }
  });

  it("allows approval after payout release but flags the recovery obligation", () => {
    const result = validateTourCancellationDecision({ ...base, action: "APPROVE_CANCELLATION", payoutStatus: "DISBURSED" });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.requiresRecovery).toBe(true);
  });

  it("approves without recovery when the payout was never released", () => {
    const result = validateTourCancellationDecision({ ...base, action: "APPROVE_CANCELLATION" });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.requiresRecovery).toBeUndefined();
  });

  it("requires approved case, cancelled booking, frozen payout, and approved refund before completion", () => {
    expect(validateTourCancellationDecision({ action: "RECORD_REFUND", caseStatus: "APPROVED", bookingStatus: "CANCELED", payoutStatus: "HELD", hasApprovedRefund: true })).toEqual({ valid: true });
    expect(validateTourCancellationDecision({ action: "RECORD_REFUND", caseStatus: "APPROVED", bookingStatus: "CONFIRMED", payoutStatus: "HELD", hasApprovedRefund: true }).valid).toBe(false);
  });

  it("lets the traveller refund proceed while operator recovery is still pending", () => {
    for (const payoutStatus of ["RECOVERY_PENDING", "RECOVERED"]) {
      expect(validateTourCancellationDecision({ action: "RECORD_REFUND", caseStatus: "APPROVED", bookingStatus: "CANCELED", payoutStatus, hasApprovedRefund: true })).toEqual({ valid: true });
    }
  });

  it("records recovery only on an approved or resolved case with a cancelled booking and pending recovery", () => {
    expect(validateTourCancellationDecision({ action: "RECORD_RECOVERY", caseStatus: "APPROVED", bookingStatus: "CANCELED", payoutStatus: "RECOVERY_PENDING", hasApprovedRefund: true })).toEqual({ valid: true });
    expect(validateTourCancellationDecision({ action: "RECORD_RECOVERY", caseStatus: "RESOLVED", bookingStatus: "REFUNDED", payoutStatus: "RECOVERY_PENDING", hasApprovedRefund: true })).toEqual({ valid: true });
    const wrongPayout = validateTourCancellationDecision({ action: "RECORD_RECOVERY", caseStatus: "APPROVED", bookingStatus: "CANCELED", payoutStatus: "HELD", hasApprovedRefund: true });
    expect(wrongPayout.valid).toBe(false);
    if (!wrongPayout.valid) expect(wrongPayout.code).toBe("NO_RECOVERY_PENDING");
    const activeBooking = validateTourCancellationDecision({ action: "RECORD_RECOVERY", caseStatus: "APPROVED", bookingStatus: "CONFIRMED", payoutStatus: "RECOVERY_PENDING", hasApprovedRefund: true });
    expect(activeBooking.valid).toBe(false);
    if (!activeBooking.valid) expect(activeBooking.code).toBe("BOOKING_NOT_CANCELLED");
  });
});

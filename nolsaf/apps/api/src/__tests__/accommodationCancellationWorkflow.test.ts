import { describe, expect, it } from "vitest";
import {
  ACCOMMODATION_CANCELLATION_TRANSITIONS,
  validateAccommodationCancellationRequirements,
  validateAccommodationCancellationTransition,
} from "../lib/accommodationCancellationWorkflow";

describe("accommodation cancellation workflow", () => {
  it("requires review immediately after submission", () => {
    expect(ACCOMMODATION_CANCELLATION_TRANSITIONS.SUBMITTED).toEqual(["REVIEWING"]);
    expect(validateAccommodationCancellationTransition("SUBMITTED", "APPROVED").valid).toBe(false);
  });

  it("supports an information loop without skipping review", () => {
    expect(validateAccommodationCancellationTransition("REVIEWING", "NEED_INFO").valid).toBe(true);
    expect(validateAccommodationCancellationTransition("NEED_INFO", "REVIEWING").valid).toBe(true);
    expect(validateAccommodationCancellationTransition("NEED_INFO", "APPROVED").valid).toBe(false);
  });

  it("separates approval, refund initiation, and refund confirmation", () => {
    expect(validateAccommodationCancellationTransition("REVIEWING", "APPROVED").valid).toBe(true);
    expect(validateAccommodationCancellationTransition("APPROVED", "REFUND_PENDING").valid).toBe(true);
    expect(validateAccommodationCancellationTransition("REFUND_PENDING", "REFUNDED").valid).toBe(true);
    expect(validateAccommodationCancellationTransition("APPROVED", "REFUNDED").valid).toBe(false);
  });

  it("makes refunded and rejected terminal", () => {
    expect(validateAccommodationCancellationTransition("REFUNDED", "REJECTED").valid).toBe(false);
    expect(validateAccommodationCancellationTransition("REJECTED", "REVIEWING").valid).toBe(false);
  });

  it("blocks approval until the reason, policy, and successful payment proof agree", () => {
    expect(validateAccommodationCancellationRequirements({ to: "APPROVED", decisionNote: "Verified", policyEligible: true, hasPaymentProof: false, approvedRefundAmount: 500000 }).valid).toBe(false);
    expect(validateAccommodationCancellationRequirements({ to: "APPROVED", decisionNote: "Verified", policyEligible: true, hasPaymentProof: true, approvedRefundAmount: 500000 }).valid).toBe(true);
  });

  it("requires a provider for the refund queue and a reference for completion", () => {
    expect(validateAccommodationCancellationRequirements({ to: "REFUND_PENDING", policyEligible: true, hasPaymentProof: true, refundProvider: "" }).valid).toBe(false);
    expect(validateAccommodationCancellationRequirements({ to: "REFUND_PENDING", policyEligible: true, hasPaymentProof: true, refundProvider: "AzamPay" }).valid).toBe(true);
    expect(validateAccommodationCancellationRequirements({ to: "REFUNDED", policyEligible: true, hasPaymentProof: true, approvedRefundAmount: 500000, refundReference: "" }).valid).toBe(false);
    expect(validateAccommodationCancellationRequirements({ to: "REFUNDED", policyEligible: true, hasPaymentProof: true, approvedRefundAmount: 500000, refundReference: "REF-123" }).valid).toBe(true);
  });
});

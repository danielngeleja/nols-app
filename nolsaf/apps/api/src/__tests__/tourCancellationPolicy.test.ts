import { describe, expect, it } from "vitest";
import { calculateFinalTourRefund, evaluateTourCancellation } from "../lib/tourCancellationPolicy";

const requestedAt = new Date("2026-07-11T12:00:00Z");
const base = { requestedAt, amountPaid: 1_000_000, status: "CONFIRMED" };

describe("tour cancellation policy", () => {
  it("grants full provisional refund in the cooling-off window", () => {
    const result = evaluateTourCancellation({ ...base, bookedAt: new Date("2026-07-11T00:00:00Z"), startDate: new Date("2026-07-20T12:00:00Z") });
    expect(result.eligibilityCode).toBe("FULL_GRACE");
    expect(result.estimatedRefundAmount).toBe(1_000_000);
  });
  it("grants 50 percent after cooling-off when at least 96 hours remain", () => {
    const result = evaluateTourCancellation({ ...base, bookedAt: new Date("2026-07-01T00:00:00Z"), startDate: new Date("2026-07-20T12:00:00Z") });
    expect(result.eligibilityCode).toBe("PARTIAL_50");
    expect(result.estimatedRefundAmount).toBe(500_000);
  });
  it("requires exceptional review after commencement", () => {
    const result = evaluateTourCancellation({ ...base, bookedAt: new Date("2026-07-01T00:00:00Z"), startDate: new Date("2026-07-10T12:00:00Z"), pickupValidated: true });
    expect(result.eligibilityCode).toBe("STARTED_EXCEPTION_ONLY");
    expect(result.eligible).toBe(false);
  });
  it("deducts only evidenced and policy-valid tour costs", () => {
    const result = calculateFinalTourRefund(2_000_000, 50, [
      { kind: "NON_REFUNDABLE_COMPONENT", description: "Park permit", amount: 200_000, evidenceUrl: "https://files.example/permit", disclosedBeforePayment: true },
      { kind: "NON_REFUNDABLE_COMPONENT", description: "Unproven preparation", amount: 300_000, evidenceUrl: "", disclosedBeforePayment: false },
    ]);
    expect(result.finalRefundAmount).toBe(800_000);
    expect(result.rejectedDeductionCount).toBe(1);
  });
  it("does not deduct operator costs from an operator-caused refund", () => {
    const result = calculateFinalTourRefund(2_000_000, 100, [
      { kind: "NON_REFUNDABLE_COMPONENT", description: "Permit", amount: 200_000, evidenceUrl: "https://files.example/permit", disclosedBeforePayment: true },
    ], true);
    expect(result.finalRefundAmount).toBe(2_000_000);
  });
});

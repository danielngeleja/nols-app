import { describe, expect, it } from "vitest";
import { assertTourStatusTransition, canClaimFinalTourPayout, canFinalizeTour, disputeWindowEndsAt } from "../lib/tourLifecycle";

describe("tour lifecycle financial controls", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");

  it("does not release final payout merely because the customer paid", () => {
    expect(canClaimFinalTourPayout({ status: "CONFIRMED", paymentStatus: "PAID", openCaseCount: 0 }, now)).toEqual({ ok: false, reason: "tour_not_completed" });
  });

  it("blocks payout while an operational case is open", () => {
    expect(canClaimFinalTourPayout({ status: "COMPLETED", paymentStatus: "PAID", customerConfirmedAt: now, openCaseCount: 1 }, now)).toEqual({ ok: false, reason: "open_case" });
  });

  it("allows payout after customer confirmation", () => {
    expect(canClaimFinalTourPayout({ status: "COMPLETED", paymentStatus: "PAID", customerConfirmedAt: now, openCaseCount: 0 }, now)).toEqual({ ok: true });
  });

  it("auto-finalizes only after the dispute window and with no open case", () => {
    const completed = new Date("2026-07-08T12:00:00.000Z");
    expect(canFinalizeTour({ status: "OPERATOR_COMPLETED", disputeWindowEndsAt: disputeWindowEndsAt(completed), openCaseCount: 0 }, now)).toBe(true);
    expect(canFinalizeTour({ status: "OPERATOR_COMPLETED", disputeWindowEndsAt: disputeWindowEndsAt(completed), openCaseCount: 1 }, now)).toBe(false);
  });

  it("allows only explicit lifecycle transitions", () => {
    expect(assertTourStatusTransition("IN_PROGRESS", "OPERATOR_COMPLETED")).toBe(true);
    expect(assertTourStatusTransition("CONFIRMED", "COMPLETED")).toBe(false);
  });
});

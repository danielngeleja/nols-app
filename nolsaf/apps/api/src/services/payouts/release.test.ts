import { describe, expect, it } from "vitest";
import { computeReleaseAt, decideRelease, ownerPayoutStage, startOfEatDay, type ReleaseContext } from "./release.js";

const iso = (value: string) => new Date(value);

describe("startOfEatDay", () => {
  it("returns EAT midnight as a UTC instant", () => {
    // 07/10 14:00 EAT is 11:00Z; EAT midnight that day is 06/10 21:00Z.
    expect(startOfEatDay(iso("2026-10-07T11:00:00Z")).toISOString()).toBe("2026-10-06T21:00:00.000Z");
  });

  it("treats 00:30 EAT as the new day, not the previous UTC day", () => {
    // 08/10 00:30 EAT is 07/10 21:30Z.
    expect(startOfEatDay(iso("2026-10-07T21:30:00Z")).toISOString()).toBe("2026-10-07T21:00:00.000Z");
  });
});

describe("computeReleaseAt", () => {
  const checkIn = iso("2026-10-07T00:00:00Z");
  const checkOut = iso("2026-10-09T00:00:00Z");

  it("mobile money: eligible at validated check-in", () => {
    const result = computeReleaseAt({
      codeUsedAt: iso("2026-10-07T11:00:00Z"), // 07/10 14:00 EAT
      checkIn,
      checkOut,
      paymentChannels: ["MNO"],
    });
    expect(result.rule).toBe("CHECKIN_CONFIRMED");
    expect(result.releaseAt.toISOString()).toBe("2026-10-07T11:00:00.000Z");
  });

  it("uses the recorded code validation instant", () => {
    const result = computeReleaseAt({
      codeUsedAt: iso("2026-10-06T17:00:00Z"), // 06/10 20:00 EAT, the day before
      checkIn,
      checkOut,
      paymentChannels: ["MNO"],
    });
    expect(result.releaseAt.toISOString()).toBe("2026-10-06T17:00:00.000Z");
  });

  it("bank transfers follow the mobile money rule", () => {
    expect(
      computeReleaseAt({ codeUsedAt: iso("2026-10-07T11:00:00Z"), checkIn, checkOut, paymentChannels: ["BANK", "MNO"] }).rule
    ).toBe("CHECKIN_CONFIRMED");
  });

  it("card: the same check-in eligibility time", () => {
    const result = computeReleaseAt({ codeUsedAt: iso("2026-10-07T11:00:00Z"), checkIn, checkOut, paymentChannels: ["CARD"] });
    expect(result.rule).toBe("CHECKIN_CONFIRMED");
    expect(result.releaseAt.toISOString()).toBe("2026-10-07T11:00:00.000Z");
  });

  it("mixed mobile money and card uses the same rule", () => {
    expect(
      computeReleaseAt({ codeUsedAt: iso("2026-10-07T11:00:00Z"), checkIn, checkOut, paymentChannels: ["MNO", "card"] }).rule
    ).toBe("CHECKIN_CONFIRMED");
  });

  it("an unrecorded channel does not add a time hold", () => {
    expect(
      computeReleaseAt({ codeUsedAt: iso("2026-10-07T11:00:00Z"), checkIn, checkOut, paymentChannels: ["MNO", null] }).rule
    ).toBe("CHECKIN_CONFIRMED");
  });

  it("no successful payment is blocked by the payment gate, not the time rule", () => {
    expect(computeReleaseAt({ codeUsedAt: iso("2026-10-07T11:00:00Z"), checkIn, checkOut, paymentChannels: [] }).rule).toBe(
      "CHECKIN_CONFIRMED"
    );
  });
});

describe("decideRelease", () => {
  const base: ReleaseContext = {
    now: iso("2026-10-08T12:00:00Z"),
    releaseAt: iso("2026-10-08T11:00:00Z"),
    bookingStatus: "CHECKED_IN",
    claimStatus: "DRAFT",
    hasActiveDisbursement: false,
    openCancellationStatus: null,
    refunded: false,
    guestIsOwner: false,
    currencyMismatch: false,
    guestAlertAccepted: true,
    collectedEnough: true,
    payoutAccountProblem: null,
  };

  it("unlocks when the time has passed and every gate is clear", () => {
    expect(decideRelease(base)).toEqual({ next: "AVAILABLE", reason: null });
  });

  it("stays locked before the unlock time", () => {
    expect(decideRelease({ ...base, now: iso("2026-10-08T10:59:00Z") })).toEqual({ next: "LOCKED", reason: null });
  });

  it("holds on an open cancellation request even before the unlock time", () => {
    const decision = decideRelease({ ...base, now: iso("2026-10-07T20:00:00Z"), openCancellationStatus: "SUBMITTED" });
    expect(decision.next).toBe("HELD");
  });

  it("holds when a refund was paid", () => {
    expect(decideRelease({ ...base, refunded: true }).next).toBe("HELD");
  });

  it("holds when the guest matches the owner", () => {
    expect(decideRelease({ ...base, guestIsOwner: true }).next).toBe("HELD");
  });

  it("holds on a payment currency mismatch", () => {
    expect(decideRelease({ ...base, currencyMismatch: true }).next).toBe("HELD");
  });

  it("holds when the booking is no longer in a started stay", () => {
    expect(decideRelease({ ...base, bookingStatus: "CONFIRMED" }).next).toBe("HELD");
  });

  it("cancels when the booking was cancelled", () => {
    expect(decideRelease({ ...base, bookingStatus: "CANCELED" }).next).toBe("CANCELLED");
  });

  it("cancels when the claim was rejected or is gone", () => {
    expect(decideRelease({ ...base, claimStatus: "REJECTED" }).next).toBe("CANCELLED");
    expect(decideRelease({ ...base, claimStatus: null }).next).toBe("CANCELLED");
  });

  it("marks RELEASED when the manual flow already paid the claim", () => {
    expect(decideRelease({ ...base, claimStatus: "APPROVED" }).next).toBe("RELEASED");
    expect(decideRelease({ ...base, hasActiveDisbursement: true }).next).toBe("RELEASED");
  });

  it("waits, without a hold, for the payment to be confirmed", () => {
    expect(decideRelease({ ...base, collectedEnough: false })).toEqual({
      next: "LOCKED",
      reason: "Waiting for the guest payment to be confirmed",
    });
  });

  it("waits for an accepted guest alert", () => {
    expect(decideRelease({ ...base, guestAlertAccepted: false })).toEqual({
      next: "LOCKED", reason: "Waiting for the guest check-in alert to be accepted by SMS or email",
    });
  });

  it("waits, without a hold, for a usable payout account", () => {
    const decision = decideRelease({ ...base, payoutAccountProblem: "Add and verify a mobile money payout account" });
    expect(decision).toEqual({ next: "LOCKED", reason: "Add and verify a mobile money payout account" });
  });

  it("a hold outranks the clock and the soft gates", () => {
    const decision = decideRelease({ ...base, collectedEnough: false, openCancellationStatus: "REVIEWING" });
    expect(decision.next).toBe("HELD");
  });
});

describe("ownerPayoutStage", () => {
  const stage = (status: string, lane: string | null = null, holdReason: string | null = null, claimStatus: string | null = "DRAFT") =>
    ownerPayoutStage({ status, lane, holdReason, claimStatus });

  it("names the waiting states", () => {
    expect(stage("LOCKED")).toBe("UNLOCKING");
    expect(stage("LOCKED", null, "Add and verify a mobile money payout account")).toBe("WAITING");
    expect(stage("HELD", null, "open cancellation")).toBe("ON_HOLD");
    expect(stage("AVAILABLE")).toBe("READY");
    expect(stage("WITHDRAWING")).toBe("SENDING");
  });

  it("follows the claim after release", () => {
    expect(stage("RELEASED", "AUTO", null, "APPROVED")).toBe("SENDING");
    expect(stage("RELEASED", "MANUAL", "First payout", "REQUESTED")).toBe("UNDER_REVIEW");
    expect(stage("RELEASED", "AUTO", null, "PAID")).toBe("PAID");
    expect(stage("RELEASED", "MANUAL", null, "PAID")).toBe("PAID");
    expect(stage("RELEASED", "OFFSET", null, "PAID")).toBe("SETTLED");
    expect(stage("RELEASED", "MANUAL", null, "REJECTED")).toBe("CANCELLED");
    expect(stage("CANCELLED")).toBe("CANCELLED");
  });
});

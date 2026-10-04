import { describe, expect, it } from "vitest";
import {
  balanceAfterAdvances,
  balanceDisputeDeadline,
  computeAdvanceOffer,
  maxAdvanceRequest,
  type AdvanceBookingSnapshot,
  type OperatorStanding,
} from "../lib/tourPayoutPolicy";

const HOUR = 60 * 60 * 1000;
const start = new Date("2026-10-20T06:00:00.000Z");
const at = (hoursBeforeStart: number) => new Date(start.getTime() - hoursBeforeStart * HOUR);

const good: OperatorStanding = { tier: "SILVER", hasVerifiedPayoutDestination: true, pendingRecoveryAmount: 0 };
const booking = (over: Partial<AdvanceBookingSnapshot> = {}): AdvanceBookingSnapshot => ({
  status: "CONFIRMED",
  paymentStatus: "PAID",
  paidAt: new Date("2026-09-01T10:00:00.000Z"),
  startDate: start,
  operatorNet: 13_000,
  advanceCommitted: 0,
  openCaseCount: 0,
  ...over,
});

describe("tour operator advance", () => {
  it("is closed more than 7 days before departure and says when it opens", () => {
    const offer = computeAdvanceOffer(booking(), good, at(8 * 24));
    expect(offer).toMatchObject({ ok: false, reason: "too_early" });
    expect(offer.opensAt).toBe(at(7 * 24).toISOString());
  });

  it("pays 30% without receipts between 7 days and 96 hours out", () => {
    const offer = computeAdvanceOffer(booking(), good, at(5 * 24));
    expect(offer).toMatchObject({ ok: true, inFullWindow: false, percentWithoutEvidence: 30, availableWithoutEvidence: 3_900, availableWithEvidence: 9_100 });
  });

  it("lets supplier receipts raise the claim, never past 70%", () => {
    const offer = computeAdvanceOffer(booking(), good, at(5 * 24));
    expect(maxAdvanceRequest(offer, 2_000)).toBe(5_900);
    expect(maxAdvanceRequest(offer, 50_000)).toBe(9_100);
  });

  it("pays 70% without receipts inside the 96-hour non-refundable window", () => {
    const offer = computeAdvanceOffer(booking(), good, at(72));
    expect(offer).toMatchObject({ ok: true, inFullWindow: true, percentWithoutEvidence: 70, availableWithoutEvidence: 9_100 });
  });

  it("subtracts advances already committed", () => {
    const offer = computeAdvanceOffer(booking({ advanceCommitted: 3_900 }), good, at(72));
    expect(offer.availableWithoutEvidence).toBe(5_200);
    const full = computeAdvanceOffer(booking({ advanceCommitted: 9_100 }), good, at(72));
    expect(full).toMatchObject({ ok: false, reason: "fully_advanced" });
  });

  it("never opens inside the traveller's 24-hour cooling-off", () => {
    const paidAt = at(3 * 24);
    const offer = computeAdvanceOffer(booking({ paidAt }), good, at(3 * 24 - 2));
    expect(offer).toMatchObject({ ok: false, reason: "cooling_off" });
    expect(offer.opensAt).toBe(new Date(paidAt.getTime() + 24 * HOUR).toISOString());
  });

  it("requires good standing", () => {
    const when = at(72);
    expect(computeAdvanceOffer(booking(), { ...good, tier: "BRONZE" }, when).reason).toBe("tier_too_low");
    expect(computeAdvanceOffer(booking(), { ...good, hasVerifiedPayoutDestination: false }, when).reason).toBe("no_payout_destination");
    expect(computeAdvanceOffer(booking(), { ...good, pendingRecoveryAmount: 10 }, when).reason).toBe("recovery_debt");
  });

  it("is held by an open case and closed once the trip is finished or cancelled", () => {
    const when = at(72);
    expect(computeAdvanceOffer(booking({ openCaseCount: 1 }), good, when).reason).toBe("open_case");
    expect(computeAdvanceOffer(booking({ status: "OPERATOR_COMPLETED" }), good, when).reason).toBe("booking_closed");
    expect(computeAdvanceOffer(booking({ status: "CANCELED" }), good, when).reason).toBe("booking_closed");
    expect(computeAdvanceOffer(booking({ paymentStatus: "PENDING", paidAt: null }), good, when).reason).toBe("payment_not_confirmed");
  });
});

describe("tour operator balance", () => {
  it("is the net share minus advances paid", () => {
    expect(balanceAfterAdvances(13_000, 9_100)).toBe(3_900);
    expect(balanceAfterAdvances(13_000, 20_000)).toBe(0);
  });

  it("anchors the dispute window to the later of timetable completion and trip end", () => {
    const tickedEarly = new Date("2026-11-20T08:00:00.000Z");
    const tripEnd = new Date("2026-11-24T00:00:00.000Z");
    // Trip's last day ends 24h after its date, then 48h more.
    expect(balanceDisputeDeadline(tickedEarly, tripEnd).toISOString()).toBe("2026-11-27T00:00:00.000Z");
    const tickedLate = new Date("2026-11-26T00:00:00.000Z");
    expect(balanceDisputeDeadline(tickedLate, tripEnd).toISOString()).toBe("2026-11-28T00:00:00.000Z");
    expect(balanceDisputeDeadline(tickedLate, null).toISOString()).toBe("2026-11-28T00:00:00.000Z");
  });

  it("keeps the old 48h-after-timetable window until the 30-day notice period ends", () => {
    const tickedEarly = new Date("2026-10-01T08:00:00.000Z");
    const tripEnd = new Date("2026-10-05T00:00:00.000Z");
    expect(balanceDisputeDeadline(tickedEarly, tripEnd).toISOString()).toBe("2026-10-03T08:00:00.000Z");
  });
});

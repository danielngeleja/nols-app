import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import { operatorBehaviour, type BehaviourBooking } from "./operatorStatement.js";

const t = (iso: string) => new Date(iso);
const booking = (overrides: Partial<BehaviourBooking>): BehaviourBooking => ({
  status: "CONFIRMED", paymentStatus: "PAID", paidAt: t("2026-10-01T08:00:00Z"), confirmedAt: null,
  endDate: null, operatorCompletedAt: null, customerConfirmedAt: null, metadata: null, ...overrides,
});

describe("operator delivery behaviour", () => {
  it("measures pickup checks, traveller confirmation, cancellations and response times", () => {
    const result = operatorBehaviour({
      bookings: [
        booking({ status: "COMPLETED", confirmedAt: t("2026-10-01T10:00:00Z"), endDate: t("2026-10-05T00:00:00Z"), operatorCompletedAt: t("2026-10-05T12:00:00Z"), customerConfirmedAt: t("2026-10-06T00:00:00Z"), metadata: { pickupValidation: { validated: true } } }),
        booking({ status: "COMPLETED", confirmedAt: t("2026-10-01T14:00:00Z"), endDate: t("2026-10-08T00:00:00Z"), operatorCompletedAt: t("2026-10-09T00:00:00Z"), metadata: {} }),
        booking({ status: "IN_PROGRESS", metadata: { pickupValidation: { validated: true } } }),
        booking({ status: "CANCELED" }),
        booking({ status: "PENDING_PAYMENT", paymentStatus: "UNPAID", paidAt: null }),
      ],
      caseStatuses: ["OPEN", "CLOSED"],
      payoutStatuses: ["PAID", "REJECTED", "CLAIMED"],
      ratings: [5, 4],
    });

    expect(result.bookings).toBe(5);
    expect(result.paidBookings).toBe(4);
    expect(result.tripsStarted).toBe(3);
    expect(result.pickupValidated).toBe(2);
    expect(result.pickupValidatedRate).toBe(66.7);
    expect(result.completed).toBe(2);
    expect(result.travellerConfirmed).toBe(1);
    expect(result.autoCompleted).toBe(1);
    expect(result.travellerConfirmedRate).toBe(50);
    expect(result.cancelledAfterPayment).toBe(1);
    expect(result.cancellationRate).toBe(25);
    expect(result.cases).toBe(2);
    expect(result.openCases).toBe(1);
    expect(result.casesPer100Paid).toBe(50);
    expect(result.payoutClaimsRejected).toBe(1);
    expect(result.medianHoursToConfirm).toBe(4);
    expect(result.medianHoursToFinish).toBe(18);
    expect(result.averageRating).toBe(4.5);
  });

  it("reports no data rather than zero when there is nothing to measure", () => {
    const result = operatorBehaviour({ bookings: [], caseStatuses: [], payoutStatuses: [], ratings: [] });
    expect(result.pickupValidatedRate).toBeNull();
    expect(result.cancellationRate).toBeNull();
    expect(result.casesPer100Paid).toBeNull();
    expect(result.medianHoursToConfirm).toBeNull();
    expect(result.averageRating).toBeNull();
  });
});

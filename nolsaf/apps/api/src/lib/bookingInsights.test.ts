import { describe, expect, it } from "vitest";
import { eatDayKey, summarizeBookingInsights, type InsightBooking } from "./bookingInsights.js";

const NOW = new Date("2026-11-09T09:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
let nextId = 1;
function booking(partial: Partial<InsightBooking> & { createdAt: Date }): InsightBooking {
  return {
    id: nextId++, propertyId: 1, status: "NEW",
    checkIn: new Date("2026-12-01T12:00:00Z"), checkOut: new Date("2026-12-03T10:00:00Z"),
    totalAmount: 200_000, invoices: [], ...partial,
  };
}

describe("summarizeBookingInsights", () => {
  it("splits tried bookings into received, still paying, did not pay and cancelled", () => {
    const rows = [
      booking({ createdAt: hoursAgo(30), status: "CONFIRMED", invoices: [{ status: "PAID", commissionAmount: 20_000, paymentMethod: "MPESA" }] }),
      booking({ createdAt: hoursAgo(2), invoices: [{ status: "PROCESSING" }] }), // still paying
      booking({ createdAt: hoursAgo(40), invoices: [{ status: "REQUESTED", paymentEvents: [{ status: "FAILED" }] }] }), // expired, failed
      booking({ createdAt: hoursAgo(50) }), // abandoned before payment
      booking({ createdAt: hoursAgo(60), status: "CANCELED" }),
    ];
    const s = summarizeBookingInsights(rows, { now: NOW, days: 30 });
    expect(s.totals).toMatchObject({
      tried: 5, reachedPayment: 3, received: 1, paying: 1, notPaid: 2, cancelled: 1,
      paymentFailed: 1, receivedValue: 200_000, commission: 20_000, avgNights: 2,
    });
    expect(s.totals.conversion).toBeCloseTo(0.2);
    expect(s.channels).toEqual([{ channel: "MNO", count: 1 }]);
  });

  it("puts bookings from the window before into the comparison, not the totals", () => {
    const rows = [
      booking({ createdAt: hoursAgo(24 * 10), status: "CONFIRMED" }),
      booking({ createdAt: hoursAgo(24 * 40), status: "CONFIRMED" }),
      booking({ createdAt: hoursAgo(24 * 45) }),
      booking({ createdAt: hoursAgo(24 * 70), status: "CONFIRMED" }), // outside both windows
    ];
    const s = summarizeBookingInsights(rows, { now: NOW, days: 30 });
    expect(s.totals.tried).toBe(1);
    expect(s.previous).toEqual({ tried: 2, received: 1 });
  });

  it("returns one column per EAT day, including empty days", () => {
    const late = new Date("2026-11-08T22:30:00Z"); // 01:30 on 9 Nov in Dar es Salaam
    const s = summarizeBookingInsights([booking({ createdAt: late, status: "CONFIRMED" })], { now: NOW, days: 7 });
    expect(s.daily).toHaveLength(7);
    expect(s.daily.at(-1)).toMatchObject({ day: "2026-11-09", received: 1 });
    expect(eatDayKey(late)).toBe("2026-11-09");
  });

  it("flags a paid signal on an unconfirmed booking for review", () => {
    const rows = [booking({ createdAt: hoursAgo(3), invoices: [{ status: "PROCESSING", paymentEvents: [{ status: "SUCCESS" }] }] })];
    const s = summarizeBookingInsights(rows, { now: NOW, days: 30 });
    expect(s.totals).toMatchObject({ paying: 1, needsReview: 1, received: 0 });
  });
});

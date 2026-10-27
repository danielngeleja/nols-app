import { describe, expect, it } from "vitest";
import { classifyBookingAttempt } from "../lib/bookingAttemptState.js";

const createdAt = new Date("2026-10-27T00:00:00.000Z");
const withinWindow = new Date("2026-10-27T11:59:59.000Z");
const afterWindow = new Date("2026-10-27T12:00:00.000Z");

describe("admin payment-attempt classification", () => {
  it("does not classify a confirmed stay as a payment attempt", () => {
    expect(classifyBookingAttempt({ status: "CONFIRMED", createdAt, invoices: [{ status: "PAID" }] })).toBeNull();
  });

  it("distinguishes a checkout with no invoice from an unpaid invoice", () => {
    expect(classifyBookingAttempt({ status: "NEW", createdAt, invoices: [] }, withinWindow)?.state).toBe("ABANDONED");
    expect(classifyBookingAttempt({ status: "NEW", createdAt, invoices: [{ status: "PENDING" }] }, withinWindow)?.state).toBe("AWAITING_PAYMENT");
    expect(classifyBookingAttempt({ status: "NEW", createdAt, invoices: [{ status: "PENDING" }] }, afterWindow)?.state).toBe("EXPIRED_UNPAID");
  });

  it("protects processing payments and flags them only after the payable window", () => {
    const booking = { status: "NEW", createdAt, invoices: [{ status: "PROCESSING" }] };
    expect(classifyBookingAttempt(booking, withinWindow)).toMatchObject({ state: "PAYMENT_PROCESSING", needsReview: false });
    expect(classifyBookingAttempt(booking, afterWindow)).toMatchObject({ state: "PAYMENT_PROCESSING", needsReview: true });
  });

  it("always sends a payment signal on a still-new booking for review", () => {
    const booking = { status: "NEW", createdAt, invoices: [{ status: "PROCESSING" }, { status: "CUSTOMER_PAID" }] };
    expect(classifyBookingAttempt(booking, withinWindow)).toMatchObject({ state: "PAYMENT_REVIEW", needsReview: true });
    expect(classifyBookingAttempt({ status: "NEW", createdAt, invoices: [{ status: "PENDING", paymentEvents: [{ status: "SUCCESS" }] }] }, afterWindow)).toMatchObject({ state: "PAYMENT_REVIEW", needsReview: true });
  });
});

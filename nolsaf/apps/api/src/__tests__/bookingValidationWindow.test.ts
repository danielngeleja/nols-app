import { describe, it, expect } from "vitest";
import { getBookingValidationWindowStatus } from "../lib/bookingValidationWindow.js";

describe("getBookingValidationWindowStatus", () => {
  it("blocks validation before check-in date", () => {
    const checkIn = new Date("2026-02-22T00:00:00.000Z");
    const checkOut = new Date("2026-02-23T00:00:00.000Z");
    const now = new Date("2026-02-21T12:00:00.000Z");

    const r = getBookingValidationWindowStatus(checkIn, checkOut, now);
    expect(r.canValidate).toBe(false);
    expect(r.status).toBe("BEFORE_CHECKIN");
  });

  it("allows validation during the window (inclusive)", () => {
    const checkIn = new Date("2026-02-20T00:00:00.000Z");
    const checkOut = new Date("2026-02-23T00:00:00.000Z");

    expect(getBookingValidationWindowStatus(checkIn, checkOut, new Date("2026-02-19T21:00:00.000Z")).canValidate).toBe(true);
    expect(getBookingValidationWindowStatus(checkIn, checkOut, new Date("2026-02-23T20:59:59.000Z")).canValidate).toBe(true);
  });

  it("blocks validation after check-out date", () => {
    const checkIn = new Date("2026-02-20T00:00:00.000Z");
    const checkOut = new Date("2026-02-23T00:00:00.000Z");
    const now = new Date("2026-02-23T21:00:00.000Z");

    const r = getBookingValidationWindowStatus(checkIn, checkOut, now);
    expect(r.canValidate).toBe(false);
    expect(r.status).toBe("AFTER_CHECKOUT");
  });

  it("uses the EAT day even when the API host runs in UTC", () => {
    const checkIn = new Date("2026-09-20T00:00:00.000Z");
    const checkOut = new Date("2026-09-23T00:00:00.000Z");

    const beforeEatMidnight = getBookingValidationWindowStatus(
      checkIn,
      checkOut,
      new Date("2026-09-19T20:59:59.000Z"),
    );
    const atEatMidnight = getBookingValidationWindowStatus(
      checkIn,
      checkOut,
      new Date("2026-09-19T21:00:00.000Z"),
    );

    expect(beforeEatMidnight.status).toBe("BEFORE_CHECKIN");
    expect(atEatMidnight).toEqual({ canValidate: true, status: "IN_WINDOW" });
  });
});

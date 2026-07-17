import { describe, expect, it } from "vitest";
import { allocateStayValue, overlappingNights } from "./nrmsReporting.js";

describe("NRMS reporting period allocation", () => {
  it("allocates a cross-period stay only to nights inside the selected period", () => {
    const value = allocateStayValue(
      300_000,
      new Date("2026-07-30T00:00:00+03:00"),
      new Date("2026-08-02T00:00:00+03:00"),
      new Date("2026-08-01T00:00:00+03:00"),
      new Date("2026-09-01T00:00:00+03:00"),
    );

    expect(value).toBe(100_000);
  });

  it("keeps the full value when every occupied night is in the report period", () => {
    const value = allocateStayValue(
      240_000,
      new Date("2026-07-14T00:00:00+03:00"),
      new Date("2026-07-16T00:00:00+03:00"),
      new Date("2026-07-01T00:00:00+03:00"),
      new Date("2026-08-01T00:00:00+03:00"),
    );

    expect(value).toBe(240_000);
  });

  it("returns zero outside the reporting period and for invalid stays", () => {
    const checkIn = new Date("2026-07-14T00:00:00+03:00");
    const checkOut = new Date("2026-07-16T00:00:00+03:00");
    expect(overlappingNights(checkIn, checkOut, new Date("2026-08-01T00:00:00+03:00"), new Date("2026-09-01T00:00:00+03:00"))).toBe(0);
    expect(allocateStayValue(100_000, checkIn, checkIn, checkIn, checkOut)).toBe(0);
  });
});


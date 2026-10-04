import { describe, expect, it } from "vitest";
import { nrmsCheckInDateConflict } from "./nrmsCheckInDate.js";

describe("nrmsCheckInDateConflict", () => {
  it("blocks a future arrival", () => {
    expect(nrmsCheckInDateConflict(new Date("2026-10-02T00:00:00.000Z"), "2026-09-12")).toMatchObject({
      code: "CHECKIN_BEFORE_ARRIVAL",
      arrivalDate: "2026-10-02",
      businessDate: "2026-09-12",
    });
  });

  it("allows today's and late arrivals", () => {
    expect(nrmsCheckInDateConflict(new Date("2026-09-12T00:00:00.000Z"), "2026-09-12")).toBeNull();
    expect(nrmsCheckInDateConflict(new Date("2026-09-11T00:00:00.000Z"), "2026-09-12")).toBeNull();
  });
});

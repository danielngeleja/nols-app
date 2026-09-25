import { describe, expect, it } from "vitest";
import { buildNrmsUsageRows, checkoutDepartureFacts } from "./nrmsBilling.js";

const base = {
  accountId: 1, propertyId: 2, reservationId: 3, policyId: 4,
  trialEndsAt: new Date("2020-01-01"), currency: "TZS", roomNightPrice: 1500,
  allocations: [{ id: 10, startDate: new Date("2026-09-01T00:00:00Z"), endDate: new Date("2026-09-03T00:00:00Z") }],
};

describe("buildNrmsUsageRows classification", () => {
  it("labels agent-portal nights BILLABLE_AGENT and bills them at the room-night price", () => {
    const rows = buildNrmsUsageRows({ ...base, source: "AGENT" });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.classification === "BILLABLE_AGENT")).toBe(true);
    expect(rows.every((r) => Number(r.amount) === 1500)).toBe(true);
  });

  it("still labels other external channels BILLABLE_EXTERNAL", () => {
    const rows = buildNrmsUsageRows({ ...base, source: "WALK_IN" });
    expect(rows.every((r) => r.classification === "BILLABLE_EXTERNAL")).toBe(true);
  });

  it("keeps marketplace stays COMMISSION_ONLY at zero even from an agent source", () => {
    const rows = buildNrmsUsageRows({ ...base, source: "AGENT", bookingId: 99 });
    expect(rows.every((r) => r.classification === "COMMISSION_ONLY")).toBe(true);
    expect(rows.every((r) => Number(r.amount) === 0)).toBe(true);
  });
});

describe("checkout departure billing", () => {
  it("recognises an early departure when today is before the planned checkout", () => {
    const departure = checkoutDepartureFacts(new Date("2026-09-30T00:00:00.000Z"), "2026-09-03", new Date("2026-09-03T09:00:00.000Z"));
    expect(departure).toEqual({ actualDepartureDate: new Date("2026-09-03T00:00:00.000Z"), departureDateKey: "2026-09-03", businessDayBehind: false, earlyDeparture: true });
  });

  it("never calls a departure early because Night Audit left the business day behind", () => {
    // Planned 23 Sept, business day stuck at 22 Sept, guest leaves on 25 Sept.
    const departure = checkoutDepartureFacts(new Date("2026-09-23T00:00:00.000Z"), "2026-09-22", new Date("2026-09-25T09:00:00.000Z"));
    expect(departure).toEqual({ actualDepartureDate: new Date("2026-09-25T00:00:00.000Z"), departureDateKey: "2026-09-25", businessDayBehind: true, earlyDeparture: false });
  });

  it("uses the EAT calendar date, so 00:30 EAT counts as the new day", () => {
    const departure = checkoutDepartureFacts(new Date("2026-09-24T00:00:00.000Z"), "2026-09-23", new Date("2026-09-23T21:30:00.000Z"));
    expect(departure.departureDateKey).toBe("2026-09-24");
    expect(departure.earlyDeparture).toBe(false);
  });

  it("bills through the real departure date when the business day is behind", () => {
    const departure = checkoutDepartureFacts(new Date("2026-09-03T00:00:00.000Z"), "2026-09-01", new Date("2026-09-03T08:00:00.000Z"));
    const rows = buildNrmsUsageRows({ ...base, source: "WALK_IN", postThroughDate: departure.actualDepartureDate });
    expect(rows.map((row) => row.serviceDate.toISOString().slice(0, 10))).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("posts only elapsed nights through the actual departure date", () => {
    const rows = buildNrmsUsageRows({ ...base, source: "WALK_IN", allocations: [{ ...base.allocations[0], endDate: new Date("2026-09-30T00:00:00.000Z") }], postThroughDate: new Date("2026-09-03T00:00:00.000Z") });
    expect(rows.map((row) => row.serviceDate.toISOString().slice(0, 10))).toEqual(["2026-09-01", "2026-09-02"]);
  });
});

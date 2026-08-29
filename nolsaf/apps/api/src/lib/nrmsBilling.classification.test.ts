import { describe, expect, it } from "vitest";
import { buildNrmsUsageRows } from "./nrmsBilling.js";

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

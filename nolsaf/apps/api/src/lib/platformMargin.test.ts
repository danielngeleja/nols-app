import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import { marginSummary, unrecordedCosts } from "./platformMargin.js";

describe("marginSummary", () => {
  it("reports take rate, contribution and contribution margin", () => {
    const m = marginSummary({ gmv: 1_000_000, revenue: 120_000, salesCommissions: 18_000, referralEarnings: 2_000 });
    expect(m.takeRatePercent).toBe(12);
    expect(m.recordedCosts).toBe(20_000);
    expect(m.contribution).toBe(100_000);
    expect(m.contributionMarginPercent).toBe(83.3);
  });

  it("counts gateway fees and bonuses as costs of revenue, running costs only in net", () => {
    const m = marginSummary({
      gmv: 1_000_000,
      revenue: 100_000,
      salesCommissions: 10_000,
      referralEarnings: 0,
      gatewayFees: 25_000,
      partnerBonuses: 5_000,
      operatingCosts: 40_000,
    });
    expect(m.recordedCosts).toBe(40_000);
    expect(m.contribution).toBe(60_000);
    expect(m.contributionMarginPercent).toBe(60);
    expect(m.net).toBe(20_000);
    expect(m.netMarginPercent).toBe(20);
  });

  it("returns null percentages instead of dividing by zero", () => {
    const m = marginSummary({ gmv: 0, revenue: 0, salesCommissions: 0, referralEarnings: 0 });
    expect(m.takeRatePercent).toBeNull();
    expect(m.contributionMarginPercent).toBeNull();
    expect(m.netMarginPercent).toBeNull();
  });

  it("lets costs exceed revenue so a loss shows as a negative margin", () => {
    const m = marginSummary({ gmv: 100_000, revenue: 10_000, salesCommissions: 12_000, referralEarnings: 0 });
    expect(m.contribution).toBe(-2_000);
    expect(m.contributionMarginPercent).toBe(-20);
  });
});

describe("unrecordedCosts", () => {
  it("lists only what is still missing", () => {
    expect(unrecordedCosts({ gatewayFeesKnown: false, runningCostsRecorded: false }).map((c) => c.key)).toEqual(["gatewayFees", "operating"]);
    expect(unrecordedCosts({ gatewayFeesKnown: true, runningCostsRecorded: true })).toEqual([]);
  });
});

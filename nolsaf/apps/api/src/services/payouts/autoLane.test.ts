import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  settings: vi.fn(),
  paidCount: vi.fn(),
  assess: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: m.settings },
    disbursement: { count: m.paidCount },
  },
}));
vi.mock("./riskScoring.js", async (original) => ({
  ...(await original<any>()),
  assessDisbursementRisk: m.assess,
  loadPayoutSafeguards: vi.fn().mockResolvedValue({ reviewThresholdTzs: null, dailyCapPerPayeeTzs: null, recentChangeHours: 72 }),
}));
vi.mock("./ledger.js", () => ({ approveDisbursementAutomatically: vi.fn(), requestDisbursement: vi.fn() }));

import { decideOwnerPayoutLane } from "./autoLane.js";
import { isAutoLaneRisk } from "./riskScoring.js";

const ACCOUNT = { id: 7, userId: 3, accountNumber: "255754123456", provider: "Vodacom", destinationChangedAt: null, createdAt: new Date("2026-01-01") };
const input = { ownerId: 3, invoiceId: 101, amount: 180000, account: ACCOUNT, now: new Date("2026-10-08T12:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({ autoPayoutEnabled: true, autoPayoutDailyCapTzs: 2_000_000, payoutUnclaimedAutoDays: 14 });
  m.paidCount.mockResolvedValue(4);
  m.assess.mockResolvedValue({ level: "LOW", flags: [] });
});

describe("isAutoLaneRisk", () => {
  it("allows LOW and MEDIUM with only harmless flags", () => {
    expect(isAutoLaneRisk({ level: "LOW", flags: [] })).toBe(true);
    expect(isAutoLaneRisk({ level: "MEDIUM", flags: ["AFTER_HOURS_APPROVAL"] })).toBe(true);
    expect(isAutoLaneRisk({ level: "MEDIUM", flags: ["FIRST_PAYOUT_TO_BENEFICIARY", "AFTER_HOURS_APPROVAL"] })).toBe(true);
  });

  it("refuses MEDIUM with any other flag, and HIGH or CRITICAL", () => {
    expect(isAutoLaneRisk({ level: "MEDIUM", flags: ["RECENT_ACCOUNT_CHANGE", "FIRST_PAYOUT_TO_BENEFICIARY"] })).toBe(false);
    expect(isAutoLaneRisk({ level: "MEDIUM", flags: ["AMOUNT_ABOVE_NORMAL_RANGE"] })).toBe(false);
    expect(isAutoLaneRisk({ level: "HIGH", flags: [] })).toBe(false);
    expect(isAutoLaneRisk({ level: "CRITICAL", flags: [] })).toBe(false);
  });
});

describe("decideOwnerPayoutLane", () => {
  it("AUTO for a returning owner with a clean score", async () => {
    expect(await decideOwnerPayoutLane(input)).toEqual({ lane: "AUTO", reason: null });
  });

  it("MANUAL while the kill switch is off", async () => {
    m.settings.mockResolvedValue({ autoPayoutEnabled: false, autoPayoutDailyCapTzs: 2_000_000 });
    expect((await decideOwnerPayoutLane(input)).lane).toBe("MANUAL");
  });

  it("MANUAL when no daily cap is set", async () => {
    m.settings.mockResolvedValue({ autoPayoutEnabled: true, autoPayoutDailyCapTzs: null });
    expect((await decideOwnerPayoutLane(input)).lane).toBe("MANUAL");
  });

  it("MANUAL for a payout larger than the whole daily cap", async () => {
    expect((await decideOwnerPayoutLane({ ...input, amount: 2_500_000 })).lane).toBe("MANUAL");
  });

  it("MANUAL for the owner's first payout ever", async () => {
    m.paidCount.mockResolvedValue(0);
    expect(await decideOwnerPayoutLane(input)).toEqual({ lane: "MANUAL", reason: "First payout to this owner is checked by our team" });
    expect(m.assess).not.toHaveBeenCalled();
  });

  it("MANUAL when the score needs a person", async () => {
    m.assess.mockResolvedValue({ level: "MEDIUM", flags: ["RECENT_ACCOUNT_CHANGE"] });
    const decision = await decideOwnerPayoutLane(input);
    expect(decision.lane).toBe("MANUAL");
    expect(decision.reason).toContain("RECENT_ACCOUNT_CHANGE");
  });
});

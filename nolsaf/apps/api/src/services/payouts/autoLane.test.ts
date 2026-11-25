import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  settings: vi.fn(),
  paidCount: vi.fn(),
  assess: vi.fn(),
  user: vi.fn(),
  control: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: m.settings },
    disbursement: { count: m.paidCount },
    user: { findUnique: m.user },
  },
}));
vi.mock("./riskScoring.js", async (original) => ({
  ...(await original<any>()),
  assessDisbursementRisk: m.assess,
  loadPayoutSafeguards: vi.fn().mockResolvedValue({ reviewThresholdTzs: null, dailyCapPerPayeeTzs: null, recentChangeHours: 72 }),
}));
vi.mock("./ledger.js", () => ({ approveDisbursementAutomatically: vi.fn(), requestDisbursement: vi.fn() }));
vi.mock("./ownerPayoutControl.js", () => ({ loadOwnerPayoutControl: m.control }));

import { decideOwnerPayoutLane, loadOwnerPayoutPolicy, walletNameMatchesOwner } from "./autoLane.js";
import { isAutoLaneRisk } from "./riskScoring.js";

const ACCOUNT = { id: 7, userId: 3, accountNumber: "255754123456", provider: "Vodacom", destinationChangedAt: null, createdAt: new Date("2026-01-01") };
const input = { ownerId: 3, invoiceId: 101, amount: 180000, account: ACCOUNT, now: new Date("2026-10-08T12:00:00Z") };

beforeEach(() => {
  vi.clearAllMocks();
  m.settings.mockResolvedValue({ autoPayoutEnabled: true, autoPayoutDailyCapTzs: 2_000_000, payoutUnclaimedAutoDays: 14 });
  m.paidCount.mockResolvedValue(4);
  m.assess.mockResolvedValue({ level: "LOW", flags: [] });
  m.control.mockResolvedValue({ available: true, hold: null, alwaysReview: null });
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

  it("MANUAL for an owner an admin paused, before any other rule", async () => {
    m.control.mockResolvedValue({ available: true, hold: { at: new Date(), reason: "x", byId: 1 }, alwaysReview: null });
    expect(await decideOwnerPayoutLane(input)).toEqual({ lane: "MANUAL", reason: "Payouts are paused for this owner by an admin" });
    expect(m.assess).not.toHaveBeenCalled();
  });

  it("MANUAL for an owner set to always be checked, even with a clean score", async () => {
    m.control.mockResolvedValue({ available: true, hold: null, alwaysReview: { reason: "x", byId: 1 } });
    expect(await decideOwnerPayoutLane(input)).toEqual({ lane: "MANUAL", reason: "An admin set this owner's payouts to always be checked" });
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

  describe("admin first-payout limit", () => {
    const first = { ...input, amount: 1_500_000, account: { ...ACCOUNT, accountName: "ASHA MTUMWA" } };
    const withLimit = (max: number | null) => m.settings.mockResolvedValue({
      autoPayoutEnabled: true, autoPayoutDailyCapTzs: 5_000_000, ownerFirstPayoutAutoMaxTzs: max, ownerWithdrawalReviewAlertHours: 4,
    });
    beforeEach(() => {
      m.paidCount.mockResolvedValue(0);
      m.user.mockResolvedValue({ name: "Asha", fullName: "Asha Mtumwa Juma" });
      m.assess.mockResolvedValue({ level: "MEDIUM", flags: ["FIRST_PAYOUT_TO_BENEFICIARY"] });
    });

    it("sends a first payout within the limit when the wallet is in the owner's name", async () => {
      withLimit(2_000_000);
      expect(await decideOwnerPayoutLane(first)).toEqual({ lane: "AUTO", reason: null });
    });

    it("still checks the risk score on top", async () => {
      withLimit(2_000_000);
      m.assess.mockResolvedValue({ level: "MEDIUM", flags: ["FIRST_PAYOUT_TO_BENEFICIARY", "RECENT_ACCOUNT_CHANGE"] });
      expect((await decideOwnerPayoutLane(first)).lane).toBe("MANUAL");
    });

    it("sends it to a person above the limit", async () => {
      withLimit(1_000_000);
      expect(await decideOwnerPayoutLane(first)).toEqual({
        lane: "MANUAL", reason: "First payout above the automatic first-payout limit is checked by our team",
      });
      expect(m.assess).not.toHaveBeenCalled();
    });

    it("sends it to a person when the wallet is in someone else's name", async () => {
      withLimit(2_000_000);
      const decision = await decideOwnerPayoutLane({ ...first, account: { ...ACCOUNT, accountName: "PETER JOHN" } });
      expect(decision).toEqual({ lane: "MANUAL", reason: "First payout: the wallet name does not match the owner's name" });
    });

    it("sends it to a person when no limit is set", async () => {
      withLimit(null);
      expect((await decideOwnerPayoutLane(first)).reason).toBe("First payout to this owner is checked by our team");
    });

    it("never goes past the code ceiling, whatever is stored", async () => {
      withLimit(50_000_000);
      expect((await loadOwnerPayoutPolicy()).firstPayoutAutoMaxTzs).toBe(2_000_000);
      expect((await decideOwnerPayoutLane({ ...first, amount: 3_000_000 })).lane).toBe("MANUAL");
    });

    it("falls back to every first payout checked when the settings cannot be read", async () => {
      m.settings.mockImplementation(async (args: any) => {
        if (args?.select?.ownerFirstPayoutAutoMaxTzs) throw Object.assign(new Error("Unknown field"), { code: "P2022" });
        return { autoPayoutEnabled: true, autoPayoutDailyCapTzs: 5_000_000 };
      });
      expect(await loadOwnerPayoutPolicy()).toEqual({ firstPayoutAutoMaxTzs: null, reviewAlertHours: 4 });
      expect((await decideOwnerPayoutLane(first)).lane).toBe("MANUAL");
    });
  });

  it("MANUAL when the score needs a person", async () => {
    m.assess.mockResolvedValue({ level: "MEDIUM", flags: ["RECENT_ACCOUNT_CHANGE"] });
    const decision = await decideOwnerPayoutLane(input);
    expect(decision.lane).toBe("MANUAL");
    expect(decision.reason).toContain("RECENT_ACCOUNT_CHANGE");
  });
});

describe("walletNameMatchesOwner", () => {
  it("matches the owner's names in any order and case", () => {
    expect(walletNameMatchesOwner("MTUMWA ASHA", ["Asha Mtumwa Juma"])).toBe(true);
    expect(walletNameMatchesOwner("ASHA J. MTUMWA", ["asha mtumwa"])).toBe(true);
  });

  it("needs two shared names when both sides have two or more", () => {
    expect(walletNameMatchesOwner("ASHA PETER", ["Asha Mtumwa"])).toBe(false);
    expect(walletNameMatchesOwner("PETER JOHN", ["Asha Mtumwa"])).toBe(false);
  });

  it("accepts one shared name only when one side has a single name", () => {
    expect(walletNameMatchesOwner("ASHA MTUMWA", ["Asha"])).toBe(true);
  });

  it("checks the other owner name when the first is empty", () => {
    expect(walletNameMatchesOwner("ASHA MTUMWA", [null, "Asha Mtumwa"])).toBe(true);
  });

  it("never matches an empty wallet or owner name", () => {
    expect(walletNameMatchesOwner("", ["Asha Mtumwa"])).toBe(false);
    expect(walletNameMatchesOwner("ASHA MTUMWA", [null, ""])).toBe(false);
  });
});

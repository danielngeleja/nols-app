/**
 * Admin controls on tour operator payouts (lib/tourPayoutControls.ts): the
 * per-tier limit on advance money one operator holds across unfinished trips,
 * and the defaults that apply when the settings columns are not there yet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  listTx: vi.fn(),
  fx: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: mocks.settings },
    tourFinancialTransaction: { findMany: mocks.listTx },
  },
}));
vi.mock("../lib/fx.js", () => ({ getFxRates: mocks.fx }));

import {
  DEFAULT_ADVANCE_EXPOSURE_LIMITS_TZS,
  checkAdvanceExposure,
  loadTourPayoutControls,
  normalizeExposureLimits,
} from "../lib/tourPayoutControls";

const advance = (amount: number, currency = "TZS") => ({ amount: new Prisma.Decimal(amount), currency, metadata: { tranche: "ADVANCE" } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ tourAdvanceExposureLimits: null, tourPayoutSeparateApprover: true });
  mocks.listTx.mockResolvedValue([]);
  mocks.fx.mockResolvedValue({ tzsPerUnit: { USD: 2500 } });
});

describe("settings", () => {
  it("falls back to the built-in limits and a separate approver when the columns are missing", async () => {
    mocks.settings.mockRejectedValue(Object.assign(new Error("Unknown field"), { code: "P2022" }));
    const controls = await loadTourPayoutControls();
    expect(controls).toEqual({ advanceExposureLimitsTzs: DEFAULT_ADVANCE_EXPOSURE_LIMITS_TZS, separateApprover: true });
  });

  it("keeps an explicit no-limit tier and defaults the rest", () => {
    expect(normalizeExposureLimits({ GOLD: null, PLATINUM: 300_000_000 })).toEqual({
      SILVER: DEFAULT_ADVANCE_EXPOSURE_LIMITS_TZS.SILVER,
      GOLD: null,
      PLATINUM: 300_000_000,
    });
  });
});

describe("advance exposure", () => {
  // Judge the rule after policy version 2026-12-19 takes effect.
  const after = new Date("2027-01-01T00:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(after);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not apply before the policy version that publishes it takes effect", async () => {
    mocks.listTx.mockResolvedValue([advance(900_000_000)]);
    const check = await checkAdvanceExposure({ operatorAgentId: 7, tier: "SILVER", addAmount: 1_000_000, currency: "TZS", at: new Date("2026-12-01T00:00:00Z") });
    expect(check).toMatchObject({ ok: true, limitTzs: null });
    expect(mocks.listTx).not.toHaveBeenCalled();
  });

  it("allows an advance that stays inside the tier limit", async () => {
    mocks.listTx.mockResolvedValue([advance(1_000, "USD"), advance(4_000_000)]);
    const check = await checkAdvanceExposure({ operatorAgentId: 7, tier: "SILVER", addAmount: 2_000, currency: "USD" });
    // 1,000 USD at 2,500 + TZS 4,000,000 open, plus 2,000 USD = TZS 11,500,000.
    expect(check).toMatchObject({ ok: true, exposureTzs: 6_500_000, afterTzs: 11_500_000 });
  });

  it("refuses an advance that would pass the tier limit across trips", async () => {
    mocks.listTx.mockResolvedValue([advance(20_000_000)]);
    const check = await checkAdvanceExposure({ operatorAgentId: 7, tier: "SILVER", addAmount: 3_000, currency: "USD" });
    expect(check).toMatchObject({ ok: false, reason: "over_limit", afterTzs: 27_500_000 });
  });

  it("does not count an approved advance twice when it is being paid", async () => {
    mocks.listTx.mockResolvedValue([advance(25_000_000)]);
    const check = await checkAdvanceExposure({ operatorAgentId: 7, tier: "SILVER", addAmount: 25_000_000, currency: "TZS", alreadyCounted: true });
    expect(check.ok).toBe(true);
  });

  it("ignores balance payouts and only looks at unfinished trips", async () => {
    mocks.listTx.mockResolvedValue([{ amount: new Prisma.Decimal(90_000_000), currency: "TZS", metadata: {} }]);
    const check = await checkAdvanceExposure({ operatorAgentId: 7, tier: "SILVER", addAmount: 1_000_000, currency: "TZS" });
    expect(check.ok).toBe(true);
    const where = mocks.listTx.mock.calls[0][0].where;
    expect(where.booking).toEqual({ operatorAgentId: 7, status: { notIn: ["COMPLETED", "CANCELED", "CANCELLED", "REFUNDED"] } });
  });

  it("fails closed when a currency has no exchange rate", async () => {
    mocks.listTx.mockResolvedValue([advance(100, "EUR")]);
    const check = await checkAdvanceExposure({ operatorAgentId: 7, tier: "SILVER", addAmount: 100, currency: "TZS" });
    expect(check).toMatchObject({ ok: false, reason: "fx_unavailable" });
  });

  it("has no limit for a tier an admin set to blank", async () => {
    mocks.settings.mockResolvedValue({ tourAdvanceExposureLimits: { PLATINUM: null }, tourPayoutSeparateApprover: true });
    mocks.listTx.mockResolvedValue([advance(900_000_000)]);
    const check = await checkAdvanceExposure({ operatorAgentId: 7, tier: "PLATINUM", addAmount: 1_000_000, currency: "TZS" });
    expect(check).toMatchObject({ ok: true, limitTzs: null });
  });
});

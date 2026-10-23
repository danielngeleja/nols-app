import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  setting: vi.fn(),
  confirmed: vi.fn(),
  unclaimed: vi.fn(),
}));
vi.mock("@nolsaf/prisma", () => ({ prisma: {
  systemSetting: { findUnique: m.setting },
  payoutWithdrawalChallenge: { aggregate: m.confirmed },
  payoutWithdrawalJob: { findMany: m.unclaimed },
} }));

import {
  assertOwnerWithdrawalAmount,
  ownerWithdrawalAllowance,
  ownerWithdrawalDay,
  ownerWithdrawalLimit,
} from "./ownerWithdrawalLimit.js";

beforeEach(() => {
  vi.clearAllMocks();
  m.setting.mockResolvedValue({ ownerWithdrawalDailyLimitTzs: 10_000_000 });
  m.confirmed.mockResolvedValue({ _sum: { totalAmount: 6_000_000 } });
  m.unclaimed.mockResolvedValue([{ grossAmount: 2_000_000, plannedDeduction: 500_000 }]);
});

describe("hard owner withdrawal limit", () => {
  it("uses Tanzania calendar days across UTC midnight", () => {
    expect(ownerWithdrawalDay(new Date("2026-10-23T20:59:59Z"))).toMatchObject({
      day: "2026-10-23", start: new Date("2026-10-22T21:00:00Z"), end: new Date("2026-10-23T21:00:00Z"),
    });
    expect(ownerWithdrawalDay(new Date("2026-10-23T21:00:00Z")).day).toBe("2026-10-24");
  });

  it("counts confirmed codes and unclaimed requests, then rejects an excess", async () => {
    const at = new Date("2026-10-23T21:00:00Z");
    const allowance = await ownerWithdrawalAllowance(5, at);
    expect(allowance).toMatchObject({ limit: 10_000_000, used: 7_500_000, remaining: 2_500_000 });
    expect(m.confirmed).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 5, usedAt: { gte: new Date("2026-10-23T21:00:00Z"), lt: new Date("2026-10-24T21:00:00Z") },
        NOT: { planVersion: 2, handoffStatus: "CANCELLED" } },
    }));
    expect(() => assertOwnerWithdrawalAmount(2_500_001, allowance)).toThrow(/2,500,000/);
    expect(() => assertOwnerWithdrawalAmount(2_500_000, allowance)).not.toThrow();
  });

  it("fails closed when an admin limit is missing", async () => {
    m.setting.mockResolvedValue(null);
    await expect(ownerWithdrawalLimit()).rejects.toMatchObject({ code: "LIMIT_UNAVAILABLE" });
    m.setting.mockResolvedValue({ ownerWithdrawalDailyLimitTzs: null });
    await expect(ownerWithdrawalLimit()).rejects.toMatchObject({ code: "LIMIT_UNAVAILABLE" });
  });

  it("refuses zero, negative, and over-precision withdrawal amounts", () => {
    for (const amount of [0, -1, 100.501]) {
      expect(() => assertOwnerWithdrawalAmount(amount, { remaining: 1_000 })).toThrow();
    }
  });
});

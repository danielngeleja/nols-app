import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/salesLeaderboard.js", () => ({
  computeBoard: vi.fn().mockResolvedValue([]),
  DEFAULT_MONTHLY_TARGET: 5,
  TARGET_MIN: 1,
  TARGET_MAX: 50,
  monthKey: (at = new Date()) => {
    const eat = new Date(at.getTime() + 3 * 3600_000);
    return `${eat.getUTCFullYear()}-${String(eat.getUTCMonth() + 1).padStart(2, "0")}`;
  },
  shiftMonth: (key: string, delta: number) => {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  },
}));

import { adminTargetFor, assertNoLateRaise, assertWithinLeadRange, presetValue, suggestTargets } from "../lib/salesTargets.js";

describe("suggestTargets", () => {
  it("suggests the 3-month average plus 20%, never below the average", () => {
    expect(suggestTargets([2, 4, 3], 5)).toMatchObject({ average: 3, suggested: 4, keep: 5, stretch: 6 });
    expect(suggestTargets([1, 1, 1], 5).suggested).toBe(1);
    expect(suggestTargets([10, 12, 11], 5).suggested).toBe(13);
  });
  it("starts a partner with no history at 3 and caps at 50", () => {
    expect(suggestTargets([0, 0, 0], 5).suggested).toBe(3);
    expect(suggestTargets([60, 60, 60], 5)).toMatchObject({ suggested: 50, stretch: 50 });
  });
  it("maps a preset choice to its number", () => {
    const s = suggestTargets([2, 4, 3], 5);
    expect(presetValue("SUGGESTED", s)).toBe(4);
    expect(presetValue("KEEP", s)).toBe(5);
    expect(presetValue("STRETCH", s)).toBe(6);
    expect(presetValue("CUSTOM", s)).toBeNull();
  });
});

describe("fairness rules", () => {
  const day = (d: number) => new Date(Date.UTC(2026, 10, d, 9));
  it("blocks raising this month after the 10th, but allows lowering and next month", () => {
    expect(() => assertNoLateRaise({ month: "2026-11", current: 5, next: 7, now: day(9) })).not.toThrow();
    expect(() => assertNoLateRaise({ month: "2026-11", current: 5, next: 7, now: day(15) })).toThrow(/next month/);
    expect(() => assertNoLateRaise({ month: "2026-11", current: 5, next: 3, now: day(15) })).not.toThrow();
    expect(() => assertNoLateRaise({ month: "2026-12", current: 5, next: 9, now: day(15) })).not.toThrow();
  });
  it("lets a team lead move an admin target by at most 2", () => {
    expect(() => assertWithinLeadRange(6, 8)).not.toThrow();
    expect(() => assertWithinLeadRange(6, 9)).toThrow(/between 4 and 8/);
    expect(() => assertWithinLeadRange(null, 20)).not.toThrow();
  });
  it("finds the admin's latest target for that month in the audit log", async () => {
    const db = { auditLog: { findMany: vi.fn().mockResolvedValue([
      { afterJson: { month: "2026-12", target: 9 } },
      { afterJson: { month: "2026-11", target: 6 } },
      { afterJson: { month: "2026-11", target: 4 } },
    ]) } };
    expect(await adminTargetFor(db, 7, "2026-11")).toBe(6);
    expect(await adminTargetFor(db, 7, "2027-01")).toBeNull();
  });
});

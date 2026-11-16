import { describe, expect, it } from "vitest";
import { changePercent, checkPriceChange } from "./priceGuardrails.js";

const now = new Date("2026-11-15T10:00:00Z");

describe("price guardrails", () => {
  it("lets ordinary changes through without asking", () => {
    const v = checkPriceChange({ before: 56_000, after: 60_000, discountBefore: null, discountAfter: null, now });
    expect(v).toMatchObject({ ok: true, large: false, flagged: false });
    expect(changePercent(56_000, 60_000)).toBe(7.14);
  });

  it("refuses an obvious missing or extra zero", () => {
    expect(checkPriceChange({ before: 56_000, after: 5_600 - 1, discountBefore: null, discountAfter: null, now })).toMatchObject({ ok: false, code: "TYPO" });
    expect(checkPriceChange({ before: 56_000, after: 560_001, discountBefore: null, discountAfter: null, now })).toMatchObject({ ok: false, code: "TYPO" });
  });

  it("asks to confirm a large change with a reason", () => {
    const ask = checkPriceChange({ before: 56_000, after: 90_000, discountBefore: null, discountAfter: null, now });
    expect(ask).toMatchObject({ ok: false, code: "CONFIRM_REQUIRED" });
    const noReason = checkPriceChange({ before: 56_000, after: 90_000, discountBefore: null, discountAfter: null, confirmLargeChange: true, reason: "x", now });
    expect(noReason).toMatchObject({ ok: false, code: "CONFIRM_REQUIRED" });
    const ok = checkPriceChange({ before: 56_000, after: 90_000, discountBefore: null, discountAfter: null, confirmLargeChange: true, reason: "December high season", now });
    expect(ok).toMatchObject({ ok: true, large: true, flagged: true });
  });

  it("raises the third large swing in a day to price watch", () => {
    const v = checkPriceChange({ before: 56_000, after: 30_000, discountBefore: null, discountAfter: null, confirmLargeChange: true, reason: "Low season", recentLargeChanges: 2, now });
    expect(v).toMatchObject({ ok: true, flagged: true });
    if (v.ok) expect(v.flagReason).toContain("3 large price changes");
  });

  it("blocks a discount soon after a price rise, allows it later", () => {
    const raised = new Date("2026-11-10T10:00:00Z");
    const soon = checkPriceChange({ before: 80_000, after: 80_000, discountBefore: null, discountAfter: 20, lastRaisedAt: raised, now });
    expect(soon).toMatchObject({ ok: false, code: "DISCOUNT_COOLDOWN" });
    const later = checkPriceChange({ before: 80_000, after: 80_000, discountBefore: null, discountAfter: 20, lastRaisedAt: raised, now: new Date("2026-11-25T10:00:00Z") });
    expect(later).toMatchObject({ ok: true });
  });

  it("treats a first price (no previous) as ordinary", () => {
    expect(checkPriceChange({ before: null, after: 70_000, discountBefore: null, discountAfter: null, now })).toMatchObject({ ok: true, changePercent: null });
  });
});

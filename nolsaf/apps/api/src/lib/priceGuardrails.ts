/**
 * Guardrails around an owner's room price change (pricing control, phase 1).
 *
 * The owner sets the price; these rules only catch mistakes and abuse:
 * - a large change must be confirmed with a reason;
 * - a change that is almost certainly a typo is refused;
 * - a discount cannot follow a price rise too closely (no fake "was" prices);
 * - repeated large swings are raised to admin price watch.
 *
 * Pure functions, so the route and the tests share one definition.
 * Thresholds are the defaults in docs/PRICING_CONTROL_STRATEGY.md.
 */

/** A change bigger than this (either way) needs confirmation and a reason. */
export const LARGE_CHANGE_PERCENT = 40;
/** Below this share of the current price, or above this multiple, is refused as a typo. */
export const TYPO_FLOOR_RATIO = 0.1;
export const TYPO_CEILING_RATIO = 10;
/** A change this large is always shown to admin price watch. */
export const WATCH_CHANGE_PERCENT = 60;
/** This many large changes on one property within a day is shown to admin. */
export const LARGE_CHANGES_PER_DAY = 3;
/** No discount within this many days of raising the same room's price. */
export const DISCOUNT_COOLDOWN_DAYS = 14;

export type PriceChangeInput = {
  before: number | null;
  after: number;
  discountBefore: number | null;
  discountAfter: number | null;
  confirmLargeChange?: boolean;
  reason?: string | null;
  /** Large changes already made on this property in the last 24 hours. */
  recentLargeChanges?: number;
  /** When this room's price was last raised, if known. */
  lastRaisedAt?: Date | null;
  now?: Date;
};

export type PriceChangeVerdict =
  | { ok: true; changePercent: number | null; large: boolean; flagged: boolean; flagReason: string | null }
  | { ok: false; code: "TYPO" | "CONFIRM_REQUIRED" | "DISCOUNT_COOLDOWN"; error: string; changePercent: number | null; allowDiscountFrom?: Date };

export function changePercent(before: number | null, after: number): number | null {
  if (before == null || !Number.isFinite(before) || before <= 0) return null;
  return Math.round(((after - before) / before) * 10_000) / 100;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function checkPriceChange(input: PriceChangeInput): PriceChangeVerdict {
  const now = input.now ?? new Date();
  const pct = changePercent(input.before, input.after);
  const before = input.before;

  // 1. Almost certainly a typo: refuse, the owner can change in steps.
  if (before != null && before > 0) {
    if (input.after < before * TYPO_FLOOR_RATIO) {
      return {
        ok: false,
        code: "TYPO",
        changePercent: pct,
        error: `${fmt(input.after)} is less than a tenth of the current ${fmt(before)}. Check for a missing zero, or lower the price in steps.`,
      };
    }
    if (input.after > before * TYPO_CEILING_RATIO) {
      return {
        ok: false,
        code: "TYPO",
        changePercent: pct,
        error: `${fmt(input.after)} is more than ten times the current ${fmt(before)}. Check for an extra zero, or raise the price in steps.`,
      };
    }
  }

  // 2. A discount right after a price rise reads as a fake "was" price.
  const addsDiscount = (input.discountAfter ?? 0) > 0 && (input.discountAfter ?? 0) > (input.discountBefore ?? 0);
  if (addsDiscount && input.lastRaisedAt) {
    const allowFrom = new Date(input.lastRaisedAt.getTime() + DISCOUNT_COOLDOWN_DAYS * 86_400_000);
    if (allowFrom.getTime() > now.getTime()) {
      return {
        ok: false,
        code: "DISCOUNT_COOLDOWN",
        changePercent: pct,
        allowDiscountFrom: allowFrom,
        error: `This room's price was raised recently, so a discount can be added from ${allowFrom.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })}. Lower the price instead if you want to charge less now.`,
      };
    }
  }

  // 3. A large change needs the owner to confirm it and say why.
  const large = pct != null && Math.abs(pct) > LARGE_CHANGE_PERCENT;
  if (large && (!input.confirmLargeChange || String(input.reason || "").trim().length < 5)) {
    return {
      ok: false,
      code: "CONFIRM_REQUIRED",
      changePercent: pct,
      error: `This changes the price by ${pct! > 0 ? "+" : ""}${pct}%. Confirm it and give a short reason.`,
    };
  }

  // 4. Raise to admin price watch: very large, or the third large swing in a day.
  let flagReason: string | null = null;
  if (pct != null && Math.abs(pct) >= WATCH_CHANGE_PERCENT) flagReason = `Price changed by ${pct > 0 ? "+" : ""}${pct}%`;
  else if (large && (input.recentLargeChanges ?? 0) + 1 >= LARGE_CHANGES_PER_DAY) flagReason = `${(input.recentLargeChanges ?? 0) + 1} large price changes in 24 hours`;

  return { ok: true, changePercent: pct, large, flagged: !!flagReason, flagReason };
}

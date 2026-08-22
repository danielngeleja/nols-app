/**
 * NRMS nightly-rate math — the single source of truth for turning a room
 * type's base rate + a rate plan + its seasons into a per-night price.
 *
 * Extracted from the public direct-quote path so every channel (direct guest,
 * agent portal, …) prices a stay identically. A rate control must never mean
 * one thing on the direct page and another elsewhere.
 */

export type RateAdjustmentType = "BASE" | "FIXED" | "OFFSET" | "PERCENT" | string;

export type RateSeasonLike = {
  adjustmentType: RateAdjustmentType;
  adjustment: unknown; // Prisma Decimal | number
  startDate: Date;
  endDate: Date;
  daysOfWeek?: unknown; // JSON array of weekday numbers, or null/empty = every day
};

export type RatePlanLike = {
  adjustmentType?: RateAdjustmentType | null;
  adjustment?: unknown; // Prisma Decimal | number
  seasons?: RateSeasonLike[];
} | null;

/** Apply one BASE/FIXED/OFFSET/PERCENT adjustment to a base amount. */
export const adjustRate = (base: number, type: RateAdjustmentType, value: number): number =>
  type === "FIXED" ? value : type === "OFFSET" ? base + value : type === "PERCENT" ? base * (1 + value / 100) : base;

/** Clamp to >= 0 and round to 2 decimals. */
export const money = (value: number): number => Math.max(0, Number(value.toFixed(2)));

/** A season with an empty/absent daysOfWeek applies every day; otherwise only on listed weekdays (UTC). */
export const seasonAppliesOn = (daysOfWeek: unknown, date: Date): boolean =>
  !Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || daysOfWeek.map(Number).includes(date.getUTCDay());

/** Whole nights between two UTC-midnight dates (ceil, matching the booking paths). */
export const nightsBetween = (start: Date, end: Date): number =>
  Math.ceil((end.getTime() - start.getTime()) / 86_400_000);

/** UTC-midnight dates, one per night of the stay. */
export const stayDates = (checkIn: Date, stayNights: number): Date[] =>
  Array.from({ length: Math.max(0, stayNights) }, (_, offset) => new Date(checkIn.getTime() + offset * 86_400_000));

/** Highest-priority season covering a given night, or undefined. Seasons must be pre-sorted priority desc. */
export const seasonForNight = (seasons: RateSeasonLike[] | undefined, night: Date): RateSeasonLike | undefined =>
  seasons?.find((s) => s.startDate <= night && s.endDate >= night && seasonAppliesOn(s.daysOfWeek, night));

/**
 * Resolve the nightly price for each night of a stay from a room base rate and
 * an (optional) rate plan with seasons. Returns per-night rates and their sum.
 * This is the exact computation the direct-guest quote uses.
 */
export function computeNightlyRates(
  baseRate: number,
  plan: RatePlanLike,
  nights: Date[],
): { nightly: Array<{ date: string; rate: number }>; subtotal: number } {
  const planBase = adjustRate(baseRate, plan?.adjustmentType ?? "BASE", Number(plan?.adjustment ?? 0));
  let subtotal = 0;
  const nightly: Array<{ date: string; rate: number }> = [];
  for (const night of nights) {
    let rate = planBase;
    const season = seasonForNight(plan?.seasons, night);
    if (season) rate = adjustRate(rate, season.adjustmentType, Number(season.adjustment));
    rate = money(rate);
    subtotal += rate;
    nightly.push({ date: night.toISOString().slice(0, 10), rate });
  }
  return { nightly, subtotal: money(subtotal) };
}

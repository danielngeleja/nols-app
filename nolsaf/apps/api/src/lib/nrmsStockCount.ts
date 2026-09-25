// Stock counts and variance (docs/NRMS_STOCK_AND_PURCHASING.md, milestone 3).
//
// A count freezes, per good, what the shelf held at the moment it was
// counted. The book's expected quantity is taken as of that same moment, so a
// bar that keeps serving during a 40-minute count is never charged for the
// drinks it sold while counting. The difference is the variance; approving
// the count posts it as a COUNT_ADJUSTMENT so the book matches the shelf.

import { perUnitConsumption, roundCost, roundMoney, roundQty } from "./nrmsInventory.js";

/** Normal loss treated as noise, percent of expected, by stock category. */
export const DEFAULT_VARIANCE_TOLERANCES: Record<string, number> = {
  BEER: 1,
  SPIRITS: 1,
  WINE: 1,
  SOFT_DRINKS: 2,
  WATER: 2,
  MEAT: 3,
  POULTRY: 3,
  FISH_SEAFOOD: 3,
  PRODUCE: 5,
  DAIRY_EGGS: 3,
  DRY_GOODS: 2,
  OTHER: 2,
};

export function toleranceFor(category: string, overrides: unknown): number {
  const value = overrides && typeof overrides === "object" ? Number((overrides as Record<string, unknown>)[category]) : NaN;
  if (Number.isFinite(value) && value >= 0) return value;
  return DEFAULT_VARIANCE_TOLERANCES[category] ?? DEFAULT_VARIANCE_TOLERANCES.OTHER;
}

/**
 * Whether a variance is within normal loss. A tolerance never forgives a
 * whole missing bottle when only a handful were expected: for WHOLE goods the
 * allowance is rounded down to whole units.
 */
export function withinTolerance(input: { expected: number; variance: number; tolerancePercent: number; countStyle: string }): boolean {
  if (input.variance === 0) return true;
  let allowance = (Math.abs(input.expected) * Math.max(0, input.tolerancePercent)) / 100;
  if (input.countStyle === "WHOLE") allowance = Math.floor(allowance);
  return Math.abs(input.variance) <= allowance + 1e-9;
}

export function lineVariance(input: { counted: number; expected: number; unitCost: number; unitSellPrice: number | null }) {
  const varianceQuantity = roundQty(input.counted - input.expected);
  return {
    varianceQuantity,
    varianceCost: roundMoney(varianceQuantity * input.unitCost),
    varianceSales: input.unitSellPrice != null ? roundMoney(varianceQuantity * input.unitSellPrice) : null,
  };
}

export type PeriodBreakdown = {
  opening: number;
  received: number;
  transferredIn: number;
  transferredOut: number;
  sold: number;
  writtenOff: number;
  expected: number;
};

/**
 * Split the movements between two counts into what an owner recognises.
 * `opening` is what the previous approved count found (or zero before the
 * first count, when the opening balance shows up as received). Count
 * adjustments are left out: the previous one is already inside `opening`.
 * Outflows are returned as positive numbers.
 */
export function summarisePeriod(opening: number, movements: Array<{ type: string; quantity: number }>): PeriodBreakdown {
  const result = { opening: roundQty(opening), received: 0, transferredIn: 0, transferredOut: 0, sold: 0, writtenOff: 0, expected: 0 };
  for (const movement of movements) {
    const quantity = Number(movement.quantity) || 0;
    switch (movement.type) {
      case "OPENING_BALANCE":
      case "RECEIPT":
      case "RECEIPT_REVERSAL":
        result.received += quantity;
        break;
      case "TRANSFER_IN":
      case "TRANSFER_RETURN":
        result.transferredIn += quantity;
        break;
      case "TRANSFER_OUT":
        result.transferredOut -= quantity;
        break;
      case "SALE":
      case "SALE_REVERSAL":
        result.sold -= quantity;
        break;
      case "WASTAGE":
      case "STAFF_MEAL":
      case "COMPLIMENTARY":
        result.writtenOff -= quantity;
        break;
      default:
        break;
    }
  }
  result.received = roundQty(result.received);
  result.transferredIn = roundQty(result.transferredIn);
  result.transferredOut = roundQty(result.transferredOut);
  result.sold = roundQty(result.sold);
  result.writtenOff = roundQty(result.writtenOff);
  result.expected = roundQty(result.opening + result.received + result.transferredIn - result.transferredOut - result.sold - result.writtenOff);
  return result;
}

/** "Stock fell by": what left the shelf by any route, counted against what the till says was sold. */
export function stockFell(breakdown: PeriodBreakdown, counted: number): number {
  return roundQty(breakdown.opening + breakdown.received + breakdown.transferredIn - breakdown.transferredOut - counted);
}

type Db = any;

/** The book quantity of one good at one location as of a moment: today's balance minus everything after it. */
export async function expectedAt(db: Db, input: { locationId: number; stockItemId: number; at: Date }): Promise<number> {
  const [balance, after] = await Promise.all([
    db.nrmsStockBalance.findUnique({ where: { locationId_stockItemId: { locationId: input.locationId, stockItemId: input.stockItemId } }, select: { quantity: true } }),
    db.nrmsStockMovement.aggregate({ where: { locationId: input.locationId, stockItemId: input.stockItemId, occurredAt: { gt: input.at } }, _sum: { quantity: true } }),
  ]);
  return roundQty(Number(balance?.quantity ?? 0) - Number(after?._sum?.quantity ?? 0));
}

/**
 * Selling value of one base unit, from the menu. Only menu items whose recipe
 * is this single good count (a Kilimanjaro at 5,000 is 5,000 per bottle; a
 * cocktail's price cannot be split between its ingredients honestly). The
 * outlet's own menu wins; otherwise the highest price anywhere on the property.
 */
export async function unitSellPrices(db: Db, input: { propertyId: number; stockItemIds: number[]; outletId: number | null }): Promise<Map<number, number>> {
  if (input.stockItemIds.length === 0) return new Map();
  const lines = await db.nrmsMenuRecipeLine.findMany({
    where: { stockItemId: { in: input.stockItemIds }, menuItem: { status: "ACTIVE", outlet: { propertyId: input.propertyId } } },
    select: { stockItemId: true, quantity: true, yieldPercent: true, menuItem: { select: { id: true, price: true, outletId: true, _count: { select: { recipeLines: true } } } } },
  });
  const best = new Map<number, { price: number; ownOutlet: boolean }>();
  for (const line of lines) {
    if (Number(line.menuItem._count?.recipeLines ?? 0) !== 1) continue;
    const perUnit = perUnitConsumption({ quantity: Number(line.quantity), yieldPercent: line.yieldPercent });
    if (perUnit <= 0) continue;
    const price = roundCost(Number(line.menuItem.price) / perUnit);
    const ownOutlet = input.outletId != null && line.menuItem.outletId === input.outletId;
    const current = best.get(line.stockItemId);
    if (!current || (ownOutlet && !current.ownOutlet) || (ownOutlet === current.ownOutlet && price > current.price)) {
      best.set(line.stockItemId, { price, ownOutlet });
    }
  }
  return new Map([...best.entries()].map(([id, value]) => [id, value.price]));
}

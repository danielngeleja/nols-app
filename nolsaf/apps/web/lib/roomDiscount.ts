/**
 * A room's discount is real money: the guest pays the discounted rate.
 *
 * The owner's discount comes off the owner's own nightly rate (their net), and
 * NoLSAF's commission is then added on top of that lower net. Extra-guest fees
 * are not discounted.
 *
 * Mirror of apps/api/src/lib/roomDiscount.ts, which prices the booking on the
 * server. Keep the two identical so the price shown is the price charged.
 */

/** Discounts outside 0 < d <= 90 are ignored (the owner editor allows up to 90%). */
export function roomDiscountPercent(room: unknown): number | null {
  const d = Number((room as any)?.discountPercent);
  return Number.isFinite(d) && d > 0 && d <= 90 ? d : null;
}

/** The owner's nightly net after their discount, rounded to cents. */
export function discountedNightlyNet(price: number, discountPercent: number | null): number {
  if (!Number.isFinite(price) || price <= 0) return price;
  if (!discountPercent) return price;
  return Math.round(price * (1 - discountPercent / 100) * 100) / 100;
}

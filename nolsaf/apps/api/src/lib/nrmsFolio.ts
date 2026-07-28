// apps/api/src/lib/nrmsFolio.ts
// Guest folio money math for NRMS reservations. Extra charges sit on top of
// the room-stay totalAmount: balance = totalAmount + chargesTotal - amountPaid.
// Pure helpers so the arithmetic is unit-testable without a DB.

// Inlined from @nolsaf/shared (constants/nrmsChargeCategories) to avoid a
// workspace dependency on EB; keep both lists in sync.
export const CHARGE_CATEGORIES = [
  "RESTAURANT",
  "BAR",
  "LAUNDRY",
  "MINIBAR",
  "ROOM_SERVICE",
  "TRANSPORT",
  "DAMAGE",
  "OTHER",
] as const;

export type ChargeCategory = (typeof CHARGE_CATEGORIES)[number];

/** Prisma Decimal | string | number | null -> finite number (null/invalid -> 0). */
function toAmount(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Guest balance = room total + extra charges - payments, rounded to 2dp. */
export function computeGuestBalance(totalAmount: unknown, chargesTotal: unknown, amountPaid: unknown): number {
  return Number((toAmount(totalAmount) + toAmount(chargesTotal) - toAmount(amountPaid)).toFixed(2));
}

/** Amount still collectable from the guest; never negative. */
export function computeOutstanding(totalAmount: unknown, chargesTotal: unknown, amountPaid: unknown): number {
  return Math.max(0, computeGuestBalance(totalAmount, chargesTotal, amountPaid));
}

export type CheckoutSettlement = {
  settled: boolean;
  balance: number;
  code: "GUEST_BALANCE_DUE" | "GUEST_CREDIT_REMAINS" | null;
};

/** Checkout requires an exactly settled folio, including guest credits. */
export function getCheckoutSettlement(totalAmount: unknown, chargesTotal: unknown, amountPaid: unknown): CheckoutSettlement {
  const balance = computeGuestBalance(totalAmount, chargesTotal, amountPaid);
  if (balance > 0.005) return { settled: false, balance, code: "GUEST_BALANCE_DUE" };
  if (balance < -0.005) return { settled: false, balance, code: "GUEST_CREDIT_REMAINS" };
  return { settled: true, balance: 0, code: null };
}

/** Sum of non-voided charge rows, rounded to 2dp. */
export function sumNonVoidedCharges(charges: Array<{ amount: unknown; voidedAt: Date | string | null }>): number {
  const sum = charges.reduce((acc, charge) => (charge.voidedAt ? acc : acc + toAmount(charge.amount)), 0);
  return Number(sum.toFixed(2));
}

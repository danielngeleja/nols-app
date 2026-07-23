// Cashier shift math, shared by the owner finance routes and the staff
// operations routes so a shift's expected cash is computed one way only.
// Two implementations would eventually drift, and a drift here is a cash
// discrepancy blamed on the wrong person.

export const SHIFT_ZONE = "Africa/Dar_es_Salaam";

export function shiftMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

export function shiftDateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** Business date in the property's timezone, so a late-night shift books to the right day. */
export function shiftDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SHIFT_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function ensureBusinessDay(tx: any, propertyId: number, key: string, userId: number) {
  const date = shiftDateOnly(key);
  return tx.nrmsBusinessDay.upsert({
    where: { propertyId_businessDate: { propertyId, businessDate: date } },
    create: { propertyId, businessDate: date, openedById: userId },
    update: {},
  });
}

/**
 * Cash the cashier should be holding: opening float, plus cash reservation
 * payments they recorded, plus cash outlet sales they settled, during the shift.
 * Only this cashier's own takings count toward their own drawer.
 */
export async function expectedCashForShift(db: any, shift: any, until = new Date()): Promise<number> {
  const [payments, outletOrders] = await Promise.all([
    db.externalPaymentRecord.aggregate({
      where: { recordedById: shift.userId, method: "CASH", voidedAt: null, reservation: { propertyId: shift.propertyId }, createdAt: { gte: shift.openedAt, lte: until } },
      _sum: { amount: true },
    }),
    db.nrmsOutletOrder.aggregate({
      where: { propertyId: shift.propertyId, settledById: shift.userId, settlementMode: "OUTLET_PAYMENT", settlementMethod: "CASH", status: "SETTLED", voidedAt: null, settledAt: { gte: shift.openedAt, lte: until } },
      _sum: { total: true },
    }),
  ]);
  return shiftMoney(shiftMoney(shift.openingFloat) + shiftMoney(payments._sum.amount) + shiftMoney(outletOrders._sum.total));
}

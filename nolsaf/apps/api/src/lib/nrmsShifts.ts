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

/** Local midnight of a business-day key. SHIFT_ZONE is fixed UTC+3, no DST. */
export function shiftDayStart(key: string): Date {
  return new Date(`${key}T00:00:00.000+03:00`);
}

/**
 * Classified picture the attendee reviews before handing over, computed from
 * recorded transactions only (nothing client-supplied): their own settled sales
 * by tender, folio payments they recorded, property-wide folio postings, still
 * unpaid orders, and the whole property's sales for the business day. The same
 * object is frozen into closeSummary at close, so the attendee and the manager
 * are always looking at the identical figures.
 */
export async function shiftHandoverSummary(db: any, shift: any, until = new Date()) {
  const window = { gte: shift.openedAt, lte: until };
  const dayStart = shiftDayStart(shiftDayKey(until));
  const unpaidWhere = { propertyId: shift.propertyId, status: { in: ["PLACED", "CONFIRMED", "PREPARING", "SERVING"] }, voidedAt: null };
  const [myTenders, myFolioPayments, folioPosted, unpaidTotal, unpaidOrders, daySettled, dayPosted] = await Promise.all([
    db.nrmsOutletOrder.groupBy({
      by: ["settlementMethod"],
      where: { propertyId: shift.propertyId, settledById: shift.userId, settlementMode: "OUTLET_PAYMENT", status: "SETTLED", voidedAt: null, settledAt: window },
      _sum: { total: true }, _count: { _all: true },
    }),
    db.externalPaymentRecord.groupBy({
      by: ["method"],
      where: { recordedById: shift.userId, voidedAt: null, reservation: { propertyId: shift.propertyId }, createdAt: window },
      _sum: { amount: true }, _count: { _all: true },
    }),
    db.nrmsOutletOrder.aggregate({
      where: { propertyId: shift.propertyId, status: "POSTED_TO_FOLIO", voidedAt: null, postedAt: window },
      _sum: { total: true }, _count: { _all: true },
    }),
    db.nrmsOutletOrder.aggregate({ where: unpaidWhere, _sum: { total: true }, _count: { _all: true } }),
    db.nrmsOutletOrder.findMany({
      where: unpaidWhere,
      select: { id: true, orderNumber: true, customerLabel: true, total: true, status: true, settlementMode: true, createdAt: true, outlet: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 30,
    }),
    db.nrmsOutletOrder.aggregate({
      where: { propertyId: shift.propertyId, settlementMode: "OUTLET_PAYMENT", status: "SETTLED", voidedAt: null, settledAt: { gte: dayStart, lte: until } },
      _sum: { total: true }, _count: { _all: true },
    }),
    db.nrmsOutletOrder.aggregate({
      where: { propertyId: shift.propertyId, status: "POSTED_TO_FOLIO", voidedAt: null, postedAt: { gte: dayStart, lte: until } },
      _sum: { total: true }, _count: { _all: true },
    }),
  ]);
  const tenderRows = myTenders.map((row: any) => ({ method: row.settlementMethod ?? "UNCLASSIFIED", count: row._count._all, amount: shiftMoney(row._sum.total) }));
  const folioPaymentRows = myFolioPayments.map((row: any) => ({ method: row.method ?? "UNCLASSIFIED", count: row._count._all, amount: shiftMoney(row._sum.amount) }));
  return {
    computedAt: until.toISOString(),
    currency: shift.currency,
    mySales: {
      count: tenderRows.reduce((sum: number, row: any) => sum + row.count, 0),
      amount: shiftMoney(tenderRows.reduce((sum: number, row: any) => sum + row.amount, 0)),
      byMethod: tenderRows,
    },
    myFolioPayments: {
      count: folioPaymentRows.reduce((sum: number, row: any) => sum + row.count, 0),
      amount: shiftMoney(folioPaymentRows.reduce((sum: number, row: any) => sum + row.amount, 0)),
      byMethod: folioPaymentRows,
    },
    folioPosted: { count: folioPosted._count._all, amount: shiftMoney(folioPosted._sum.total) },
    unpaid: {
      count: unpaidTotal._count._all,
      amount: shiftMoney(unpaidTotal._sum.total),
      orders: unpaidOrders.map((order: any) => ({
        id: order.id, orderNumber: order.orderNumber, customerLabel: order.customerLabel || (order.settlementMode === "ROOM_FOLIO" ? "In-room guest" : "Walk-in"),
        outletName: order.outlet?.name ?? "", status: order.status, amount: shiftMoney(order.total), createdAt: order.createdAt,
      })),
    },
    daySales: {
      settled: { count: daySettled._count._all, amount: shiftMoney(daySettled._sum.total) },
      postedToFolio: { count: dayPosted._count._all, amount: shiftMoney(dayPosted._sum.total) },
      amount: shiftMoney(shiftMoney(daySettled._sum.total) + shiftMoney(dayPosted._sum.total)),
    },
  };
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

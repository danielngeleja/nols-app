// Cashier shift math, shared by the owner finance routes and the staff
// operations routes so a shift's expected cash is computed one way only.
// Two implementations would eventually drift, and a drift here is a cash
// discrepancy blamed on the wrong person.

export const SHIFT_ZONE = "Africa/Dar_es_Salaam";
export const NRMS_BUSINESS_DAY_LOCKED = "NRMS_BUSINESS_DAY_LOCKED";
export const DEFAULT_NIGHT_AUDIT_CLOSE_TIME = "20:00";

export function shiftMoney(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

export function shiftDateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** The next sequential hotel business date, independent of server locale. */
export function nextShiftDayKey(key: string): string {
  const date = shiftDateOnly(key);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function localClock(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: SHIFT_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const timeParts = new Intl.DateTimeFormat("en-GB", { timeZone: SHIFT_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
  const getTime = (type: Intl.DateTimeFormatPartTypes) => timeParts.find((part) => part.type === type)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(getTime("hour")) * 60 + Number(getTime("minute")) };
}

/** The physical calendar date in Tanzania, without the Night Audit cutoff. */
export function hotelCalendarDayKey(date: Date): string {
  return localClock(date).day;
}

function closeMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 1200;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 ? hours * 60 + minutes : 1200;
}

export function previousShiftDayKey(key: string): string {
  const date = shiftDateOnly(key);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Which calendar day a Night Audit time closes. An evening time (12:00 or
 * later, the 20:00 default) closes business date D on D itself. An early
 * morning time (02:00) closes D after midnight, on D + 1.
 */
function closesOnSameDay(closeTime: string): boolean {
  return closeMinutes(closeTime) >= 12 * 60;
}

/**
 * Hotel business date at a property-selected boundary.
 * - Evening close (20:00): the working day is the calendar day. 10:00 on
 *   8 October trades as 8 October, and from 20:00 that date may be audited.
 * - Early-morning close (02:00): after-midnight activity stays on the prior
 *   date until the boundary, so 01:30 on 9 October still trades as 8 October.
 * The old rule applied the early-morning logic to evening times too, which
 * filed a whole working day under yesterday's date.
 */
export function shiftDayKey(date: Date, closeTime = DEFAULT_NIGHT_AUDIT_CLOSE_TIME): string {
  const local = localClock(date);
  if (closesOnSameDay(closeTime)) return local.day;
  return local.minutes < closeMinutes(closeTime) ? previousShiftDayKey(local.day) : local.day;
}

export function nightAuditSchedule(date = new Date(), closeTime = DEFAULT_NIGHT_AUDIT_CLOSE_TIME) {
  const local = localClock(date);
  const beforeClose = local.minutes < closeMinutes(closeTime);
  const activeBusinessDate = shiftDayKey(date, closeTime);
  // Evening: today becomes closable at the boundary. Early morning: the
  // boundary on day X closes X - 1.
  const latestClosableDate = closesOnSameDay(closeTime)
    ? (beforeClose ? previousShiftDayKey(local.day) : local.day)
    : previousShiftDayKey(activeBusinessDate);
  const nextCloseDay = beforeClose ? local.day : nextShiftDayKey(local.day);
  return {
    closeTime,
    timezone: SHIFT_ZONE,
    activeBusinessDate,
    latestClosableDate,
    nextCloseAt: new Date(`${nextCloseDay}T${closeTime}:00+03:00`),
  };
}

export async function ensureBusinessDay(tx: any, propertyId: number, key: string, userId: number | null) {
  const date = shiftDateOnly(key);
  return tx.nrmsBusinessDay.upsert({
    where: { propertyId_businessDate: { propertyId, businessDate: date } },
    create: { propertyId, businessDate: date, openedById: userId },
    update: {},
  });
}

/**
 * Financial writers call this while holding the property's inventory row lock.
 * Night Audit takes the same lock before moving a day to CLOSING, so a writer
 * either completes before the audit snapshot or observes the sealed day and
 * fails.
 */
export async function assertNrmsBusinessDayWritable(tx: any, propertyId: number, at?: Date, closeTime = DEFAULT_NIGHT_AUDIT_CLOSE_TIME): Promise<string> {
  const key = shiftDayKey(at ?? new Date(), closeTime);
  const businessDay = await tx.nrmsBusinessDay.findUnique({
    where: { propertyId_businessDate: { propertyId, businessDate: shiftDateOnly(key) } },
    select: { businessDate: true, status: true },
  });

  // An explicitly dated correction must respect that exact day's seal. New
  // operational work, however, belongs to the active OPEN business day.
  if (at) {
    if (businessDay && ["CLOSING", "CLOSED"].includes(businessDay.status)) throw new Error(NRMS_BUSINESS_DAY_LOCKED);
    return key;
  }

  const latest = await tx.nrmsBusinessDay.findFirst({
    where: { propertyId },
    orderBy: { businessDate: "desc" },
    select: { businessDate: true, status: true },
  });
  const latestKey = latest?.businessDate ? new Date(latest.businessDate).toISOString().slice(0, 10) : null;
  if (latest?.status === "OPEN" && latestKey) return latestKey;
  if (latest?.status === "CLOSING") {
    throw new Error(NRMS_BUSINESS_DAY_LOCKED);
  }
  const openKey = latest?.status === "CLOSED" && latestKey ? nextShiftDayKey(latestKey) : key;
  const opened = await ensureBusinessDay(tx, propertyId, openKey, null);
  if (opened.status !== "OPEN") throw new Error(NRMS_BUSINESS_DAY_LOCKED);
  return openKey;
}

/**
 * When business date `key` starts. SHIFT_ZONE is fixed UTC+3, no DST.
 * Evening close: it starts at the previous evening's boundary (20:00 on
 * key - 1). Early-morning close: at the boundary on key itself.
 */
export function shiftDayStart(key: string, closeTime = DEFAULT_NIGHT_AUDIT_CLOSE_TIME): Date {
  const startDay = closesOnSameDay(closeTime) ? previousShiftDayKey(key) : key;
  return new Date(`${startDay}T${closeTime}:00.000+03:00`);
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

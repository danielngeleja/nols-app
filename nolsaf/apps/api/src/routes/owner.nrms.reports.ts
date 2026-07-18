import { Router, type Response } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { loadOwnedActiveNrmsProperty, requireNrms } from "../lib/nrms.js";
import { allocateStayValue } from "../lib/nrmsReporting.js";

export const router = Router();

router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, requireNrms as RequestHandler);

const ACTIVE_REVENUE_STATUSES = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
const OPEN_ORDER_STATUSES = ["CONFIRMED", "PREPARING", "SERVING"];
const RESERVATION_SOURCE_ORDER = ["NOLSAF", "BOOKING_COM", "AIRBNB", "EXPEDIA", "WALK_IN", "DIRECT", "PHONE", "OTHER"];
const NRMS_TIME_ZONE = "Africa/Dar_es_Salaam";

function decimal(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function dateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: NRMS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function parseDay(value: unknown): Date | null {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function overlapDays(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): number {
  const overlapStart = Math.max(start.getTime(), rangeStart.getTime());
  const overlapEnd = Math.min(end.getTime(), rangeEnd.getTime());
  return Math.max(0, Math.ceil((overlapEnd - overlapStart) / 86_400_000));
}

/**
 * Allocates a stay's accommodation value to the occupied nights that fall
 * inside the report period. Reservation.totalAmount is a stay-level snapshot,
 * so proportional allocation is the most reliable service-date basis until
 * nightly rate postings are stored as individual ledger rows.
 */
function recognizedStayValue(reservation: any, rangeStart: Date, rangeEnd: Date): number {
  return allocateStayValue(decimal(reservation.totalAmount), reservation.checkIn, reservation.checkOut, rangeStart, rangeEnd);
}

function userLabel(user: any): string {
  return user?.fullName || user?.name || user?.email || "System";
}

function roomLabel(allocations: any[]): string {
  const rooms = allocations
    .filter((allocation) => allocation.status === "ACTIVE")
    .map((allocation) => allocation.roomUnit?.code || allocation.roomType?.name)
    .filter(Boolean);
  return rooms.length ? rooms.join(", ") : "Unassigned";
}

function inRange(value: Date | string | null | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= start.getTime() && time < end.getTime();
}

router.get("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;

    const today = dateKey(new Date());
    const defaultFrom = `${today.slice(0, 8)}01`;
    const fromKey = String(req.query.from ?? defaultFrom);
    const toKey = String(req.query.to ?? today);
    const rangeStart = parseDay(fromKey);
    const inclusiveTo = parseDay(toKey);
    if (!rangeStart || !inclusiveTo || inclusiveTo < rangeStart) {
      return res.status(400).json({ error: "Choose a valid report date range" });
    }
    const rangeEnd = addDays(inclusiveTo, 1);
    const rangeDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000);
    if (rangeDays > 366) return res.status(400).json({ error: "Report ranges cannot exceed 366 days" });

    const propertyId = active.property.id as number;
    const db = prisma as any;
    const dateWindow = { gte: rangeStart, lt: rangeEnd };

    const [reservations, payments, charges, orders, events, roomTypes, allocations, blocks] = await Promise.all([
      db.reservation.findMany({
        where: {
          propertyId,
          OR: [
            { checkIn: { lt: rangeEnd }, checkOut: { gt: rangeStart } },
            { createdAt: dateWindow },
            { cancelledAt: dateWindow },
            { noShowAt: dateWindow },
          ],
        },
        select: {
          id: true,
          receiptNumber: true,
          source: true,
          status: true,
          checkIn: true,
          checkOut: true,
          checkedInAt: true,
          checkedOutAt: true,
          cancelledAt: true,
          noShowAt: true,
          currency: true,
          totalAmount: true,
          chargesTotal: true,
          amountPaid: true,
          depositAmount: true,
          guestProfile: { select: { fullName: true, phone: true } },
          allocations: {
            select: {
              status: true,
              roomType: { select: { name: true } },
              roomUnit: { select: { code: true } },
            },
          },
          outletOrders: {
            where: { status: "SETTLED", settlementMode: "OUTLET_PAYMENT", voidedAt: null },
            select: { total: true, currency: true },
          },
        },
        orderBy: [{ checkIn: "desc" }, { id: "desc" }],
      }),
      db.externalPaymentRecord.findMany({
        where: { reservation: { propertyId }, OR: [{ createdAt: dateWindow }, { voidedAt: dateWindow }] },
        select: {
          id: true,
          amount: true,
          currency: true,
          method: true,
          reference: true,
          note: true,
          createdAt: true,
          voidedAt: true,
          voidReason: true,
          recordedBy: { select: { fullName: true, name: true, email: true } },
          reservation: {
            select: {
              id: true,
              receiptNumber: true,
              checkIn: true,
              checkOut: true,
              guestProfile: { select: { fullName: true } },
              allocations: { where: { status: "ACTIVE" }, select: { roomUnit: { select: { code: true } } } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      db.reservationCharge.findMany({
        where: { reservation: { propertyId }, OR: [{ createdAt: dateWindow }, { voidedAt: dateWindow }] },
        select: {
          id: true,
          category: true,
          description: true,
          amount: true,
          currency: true,
          createdAt: true,
          voidedAt: true,
          voidReason: true,
          postedBy: { select: { fullName: true, name: true, email: true } },
          reservation: { select: { id: true, receiptNumber: true, guestProfile: { select: { fullName: true } } } },
          outletOrder: { select: { orderNumber: true, outlet: { select: { name: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      db.nrmsOutletOrder.findMany({
        where: {
          propertyId,
          OR: [
            { status: { in: OPEN_ORDER_STATUSES } },
            { createdAt: dateWindow },
            { postedAt: dateWindow },
            { settledAt: dateWindow },
            { cancelledAt: dateWindow },
            { voidedAt: dateWindow },
          ],
        },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          settlementMode: true,
          settlementMethod: true,
          customerLabel: true,
          currency: true,
          total: true,
          createdAt: true,
          confirmedAt: true,
          servedAt: true,
          postedAt: true,
          settledAt: true,
          cancelledAt: true,
          voidedAt: true,
          voidReason: true,
          outlet: { select: { name: true, type: true } },
          createdBy: { select: { fullName: true, name: true, email: true } },
          settledBy: { select: { fullName: true, name: true, email: true } },
          reservation: {
            select: {
              id: true,
              receiptNumber: true,
              guestProfile: { select: { fullName: true } },
              allocations: { where: { status: "ACTIVE" }, select: { roomUnit: { select: { code: true } }, roomType: { select: { name: true } } } },
            },
          },
          items: { select: { nameSnapshot: true, quantity: true, unitPrice: true, lineTotal: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      db.reservationEvent.findMany({
        where: { reservation: { propertyId }, createdAt: dateWindow },
        select: {
          id: true,
          type: true,
          data: true,
          createdAt: true,
          actor: { select: { fullName: true, name: true, email: true } },
          reservation: {
            select: {
              id: true,
              receiptNumber: true,
              guestProfile: { select: { fullName: true } },
              allocations: { where: { status: "ACTIVE" }, select: { roomUnit: { select: { code: true } }, roomType: { select: { name: true } } } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 1000,
      }),
      db.roomType.findMany({
        where: { propertyId },
        select: { id: true, name: true, currency: true, units: { select: { id: true, status: true } } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      }),
      db.reservationRoomAllocation.findMany({
        where: {
          roomType: { propertyId },
          status: "ACTIVE",
          startDate: { lt: rangeEnd },
          endDate: { gt: rangeStart },
          reservation: { status: { in: ACTIVE_REVENUE_STATUSES } },
        },
        select: {
          roomTypeId: true,
          startDate: true,
          endDate: true,
          reservation: { select: { id: true, currency: true, totalAmount: true, checkIn: true, checkOut: true } },
        },
      }),
      db.propertyAvailabilityBlock.findMany({
        where: {
          propertyId,
          migratedReservationId: null,
          kind: "OPERATIONAL",
          startDate: { lt: rangeEnd },
          endDate: { gt: rangeStart },
        },
        select: { startDate: true, endDate: true, roomUnitId: true, bedsBlocked: true },
      }),
    ]);

    const balanceReservations = reservations.filter((reservation: any) => ACTIVE_REVENUE_STATUSES.includes(reservation.status));
    const activeCharges = charges.filter((charge: any) => !charge.voidedAt && inRange(charge.createdAt, rangeStart, rangeEnd));
    const activePayments = payments.filter((payment: any) => !payment.voidedAt && inRange(payment.createdAt, rangeStart, rangeEnd));
    const settledOutletOrders = orders.filter((order: any) => order.status === "SETTLED" && order.settlementMode === "OUTLET_PAYMENT" && !order.voidedAt && inRange(order.settledAt, rangeStart, rangeEnd));
    const stayRevenueReservations = reservations.filter((reservation: any) =>
      ACTIVE_REVENUE_STATUSES.includes(reservation.status)
      && new Date(reservation.checkIn).getTime() < rangeEnd.getTime()
      && new Date(reservation.checkOut).getTime() > rangeStart.getTime(),
    );
    const arrivalReservations = stayRevenueReservations.filter((reservation: any) => inRange(reservation.checkIn, rangeStart, rangeEnd));

    const currencies = new Set<string>();
    for (const reservation of stayRevenueReservations) currencies.add(reservation.currency || "TZS");
    for (const charge of activeCharges) currencies.add(charge.currency || "TZS");
    for (const payment of activePayments) currencies.add(payment.currency || "TZS");
    for (const order of settledOutletOrders) currencies.add(order.currency || "TZS");
    if (!currencies.size) currencies.add(roomTypes[0]?.currency || "TZS");

    const guestBalances = balanceReservations.map((reservation: any) => {
      const room = decimal(reservation.totalAmount);
      const extras = decimal(reservation.chargesTotal);
      const folioPaid = decimal(reservation.amountPaid);
      const outletPaid = reservation.outletOrders.reduce((sum: number, order: any) => sum + decimal(order.total), 0);
      const due = Math.max(0, room + extras - folioPaid);
      const settlementStatus = due <= 0.005 ? "PAID" : folioPaid > 0 ? "PARTIAL" : "UNPAID";
      return {
        reservationId: reservation.id,
        receiptNumber: reservation.receiptNumber,
        guest: reservation.guestProfile?.fullName || "Guest",
        phone: reservation.guestProfile?.phone || null,
        room: roomLabel(reservation.allocations),
        status: reservation.status,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        currency: reservation.currency,
        roomAmount: round(room),
        folioExtras: round(extras),
        outletPaid: round(outletPaid),
        totalSpend: round(room + extras + outletPaid),
        folioPaid: round(folioPaid),
        totalCollected: round(folioPaid + outletPaid),
        amountDue: round(due),
        settlementStatus,
      };
    }).sort((a: any, b: any) => b.amountDue - a.amountDue || a.guest.localeCompare(b.guest));

    const currencyReports = [...currencies].sort().map((currency) => {
      const currencyStayReservations = stayRevenueReservations.filter((item: any) => (item.currency || "TZS") === currency);
      const roomRevenue = currencyStayReservations.reduce((sum: number, item: any) => sum + recognizedStayValue(item, rangeStart, rangeEnd), 0);
      const currencyCharges = activeCharges.filter((item: any) => (item.currency || "TZS") === currency);
      const folioExtras = currencyCharges.reduce((sum: number, item: any) => sum + decimal(item.amount), 0);
      const currencyOutlet = settledOutletOrders.filter((item: any) => (item.currency || "TZS") === currency);
      const outletPaidRevenue = currencyOutlet.reduce((sum: number, item: any) => sum + decimal(item.total), 0);
      const currencyPayments = activePayments.filter((item: any) => (item.currency || "TZS") === currency);
      const folioPayments = currencyPayments.reduce((sum: number, item: any) => sum + decimal(item.amount), 0);
      const amountDue = guestBalances.filter((item: any) => item.currency === currency).reduce((sum: number, item: any) => sum + item.amountDue, 0);
      const currentStayCollections = currencyPayments
        .filter((item: any) => inRange(item.reservation?.checkIn, rangeStart, rangeEnd))
        .reduce((sum: number, item: any) => sum + decimal(item.amount), 0);
      const priorStayCollections = currencyPayments
        .filter((item: any) => item.reservation?.checkIn && new Date(item.reservation.checkIn).getTime() < rangeStart.getTime())
        .reduce((sum: number, item: any) => sum + decimal(item.amount), 0);
      const advanceDeposits = currencyPayments
        .filter((item: any) => item.reservation?.checkIn && new Date(item.reservation.checkIn).getTime() >= rangeEnd.getTime())
        .reduce((sum: number, item: any) => sum + decimal(item.amount), 0);
      const classifiedFolioPayments = currentStayCollections + priorStayCollections + advanceDeposits;
      const unclassifiedCollections = Math.max(0, folioPayments - classifiedFolioPayments);
      const currentPeriodCollections = currentStayCollections + outletPaidRevenue;
      const totalRevenue = roomRevenue + folioExtras + outletPaidRevenue;
      const totalCollected = folioPayments + outletPaidRevenue;

      const departmentMap = new Map<string, { department: string; transactions: number; amount: number }>();
      const addDepartment = (department: string, amount: number) => {
        const row = departmentMap.get(department) ?? { department, transactions: 0, amount: 0 };
        row.transactions += 1;
        row.amount += amount;
        departmentMap.set(department, row);
      };
      for (const reservation of currencyStayReservations) addDepartment("ROOMS", recognizedStayValue(reservation, rangeStart, rangeEnd));
      for (const charge of currencyCharges) addDepartment(charge.category || "OTHER", decimal(charge.amount));
      for (const order of currencyOutlet) addDepartment(order.outlet.type === "BAR" ? "BAR" : order.outlet.type === "RESTAURANT" ? "RESTAURANT" : "OTHER", decimal(order.total));

      const paymentMethodMap = new Map<string, { method: string; transactions: number; amount: number }>();
      const addMethod = (method: string, amount: number) => {
        const row = paymentMethodMap.get(method) ?? { method, transactions: 0, amount: 0 };
        row.transactions += 1;
        row.amount += amount;
        paymentMethodMap.set(method, row);
      };
      for (const payment of currencyPayments) addMethod(payment.method, decimal(payment.amount));
      for (const order of currencyOutlet) addMethod(order.settlementMethod || "UNCLASSIFIED_OUTLET_PAYMENT", decimal(order.total));

      return {
        currency,
        summary: {
          roomRevenue: round(roomRevenue),
          folioExtras: round(folioExtras),
          outletPaidRevenue: round(outletPaidRevenue),
          totalRevenue: round(totalRevenue),
          folioPayments: round(folioPayments),
          outletPayments: round(outletPaidRevenue),
          totalCollected: round(totalCollected),
          amountDue: round(amountDue),
        },
        collectionTiming: {
          currentStayCollections: round(currentStayCollections),
          currentOutletCollections: round(outletPaidRevenue),
          currentPeriodCollections: round(currentPeriodCollections),
          priorStayCollections: round(priorStayCollections),
          advanceDeposits: round(advanceDeposits),
          unclassifiedCollections: round(unclassifiedCollections),
          totalCollected: round(totalCollected),
          revenueToCollectionDifference: round(totalCollected - totalRevenue),
          currentPeriodCollectionGap: round(currentPeriodCollections - totalRevenue),
        },
        departments: [...departmentMap.values()].map((item) => ({ ...item, amount: round(item.amount) })).sort((a, b) => b.amount - a.amount),
        paymentMethods: [...paymentMethodMap.values()].map((item) => ({ ...item, amount: round(item.amount) })).sort((a, b) => b.amount - a.amount),
      };
    });

    const recordedSources = new Set<string>(RESERVATION_SOURCE_ORDER);
    for (const reservation of reservations) recordedSources.add(String(reservation.source || "OTHER").toUpperCase());
    const orderedSources = [...recordedSources].sort((left, right) => {
      const leftIndex = RESERVATION_SOURCE_ORDER.indexOf(left);
      const rightIndex = RESERVATION_SOURCE_ORDER.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) return (leftIndex >= 0 ? leftIndex : Number.MAX_SAFE_INTEGER) - (rightIndex >= 0 ? rightIndex : Number.MAX_SAFE_INTEGER);
      return left.localeCompare(right);
    });
    const reservationSources = [...currencies].sort().flatMap((currency) => {
      const currencyReservations = arrivalReservations.filter((reservation: any) => (reservation.currency || "TZS") === currency);
      const totalReservations = currencyReservations.length;
      const totalRoomRevenue = currencyReservations.reduce((sum: number, reservation: any) => sum + decimal(reservation.totalAmount), 0);
      return orderedSources.map((source) => {
        const sourceReservations = currencyReservations.filter((reservation: any) => String(reservation.source || "OTHER").toUpperCase() === source);
        const roomRevenue = sourceReservations.reduce((sum: number, reservation: any) => sum + decimal(reservation.totalAmount), 0);
        const collected = sourceReservations.reduce((sum: number, reservation: any) => sum + decimal(reservation.amountPaid), 0);
        const roomNights = sourceReservations.reduce((sum: number, reservation: any) => sum + overlapDays(reservation.checkIn, reservation.checkOut, rangeStart, rangeEnd), 0);
        const cancellations = reservations.filter((reservation: any) => (reservation.currency || "TZS") === currency && String(reservation.source || "OTHER").toUpperCase() === source && inRange(reservation.cancelledAt, rangeStart, rangeEnd)).length;
        const noShows = reservations.filter((reservation: any) => (reservation.currency || "TZS") === currency && String(reservation.source || "OTHER").toUpperCase() === source && inRange(reservation.noShowAt, rangeStart, rangeEnd)).length;
        return {
          source,
          currency,
          reservations: sourceReservations.length,
          reservationShare: totalReservations > 0 ? round((sourceReservations.length / totalReservations) * 100) : 0,
          roomNights,
          roomRevenue: round(roomRevenue),
          revenueShare: totalRoomRevenue > 0 ? round((roomRevenue / totalRoomRevenue) * 100) : 0,
          folioCollected: round(collected),
          averageReservationValue: sourceReservations.length > 0 ? round(roomRevenue / sourceReservations.length) : 0,
          cancellations,
          noShows,
        };
      });
    });

    const activeUnits = roomTypes.reduce((sum: number, roomType: any) => sum + roomType.units.filter((unit: any) => unit.status === "ACTIVE").length, 0);
    const outOfServiceUnits = roomTypes.reduce((sum: number, roomType: any) => sum + roomType.units.filter((unit: any) => unit.status !== "ACTIVE").length, 0);
    const soldRoomNights = allocations.reduce((sum: number, allocation: any) => sum + overlapDays(allocation.startDate, allocation.endDate, rangeStart, rangeEnd), 0);
    const blockedRoomNights = blocks.reduce((sum: number, block: any) => sum + overlapDays(block.startDate, block.endDate, rangeStart, rangeEnd) * Math.max(1, block.roomUnitId ? 1 : Number(block.bedsBlocked || 1)), 0);
    const availableRoomNights = Math.max(0, activeUnits * rangeDays - blockedRoomNights);
    const occupancyCurrency = roomTypes[0]?.currency || [...currencies][0] || "TZS";
    const occupancyRoomRevenue = stayRevenueReservations
      .filter((reservation: any) => (reservation.currency || "TZS") === occupancyCurrency)
      .reduce((sum: number, reservation: any) => sum + recognizedStayValue(reservation, rangeStart, rangeEnd), 0);

    const occupancyByRoomType = roomTypes.map((roomType: any) => {
      const units = roomType.units.filter((unit: any) => unit.status === "ACTIVE").length;
      const sold = allocations.filter((allocation: any) => allocation.roomTypeId === roomType.id).reduce((sum: number, allocation: any) => sum + overlapDays(allocation.startDate, allocation.endDate, rangeStart, rangeEnd), 0);
      const available = units * rangeDays;
      return {
        roomTypeId: roomType.id,
        roomType: roomType.name,
        units,
        roomNightsAvailable: available,
        roomNightsSold: sold,
        occupancyRate: available > 0 ? round((sold / available) * 100) : 0,
      };
    });

    const currentTime = new Date();
    const occupiedNow = reservations.filter((reservation: any) => reservation.status === "CHECKED_IN").length;
    const currentBlocks = blocks.reduce((sum: number, block: any) => sum + (inRange(currentTime, block.startDate, block.endDate) ? Math.max(1, block.roomUnitId ? 1 : Number(block.bedsBlocked || 1)) : 0), 0);

    const paymentRows = [
      ...payments.map((payment: any) => ({
        id: `payment-${payment.id}`,
        type: "FOLIO_PAYMENT",
        occurredAt: payment.createdAt,
        reservationId: payment.reservation.id,
        referenceNumber: payment.reservation.receiptNumber,
        guest: payment.reservation.guestProfile?.fullName || "Guest",
        room: roomLabel(payment.reservation.allocations),
        method: payment.method,
        reference: payment.reference,
        currency: payment.currency,
        amount: round(decimal(payment.amount)),
        recordedBy: userLabel(payment.recordedBy),
        voidedAt: payment.voidedAt,
        voidReason: payment.voidReason,
      })),
      ...settledOutletOrders.map((order: any) => ({
        id: `order-${order.id}`,
        type: "OUTLET_PAYMENT",
        occurredAt: order.settledAt,
        reservationId: order.reservation?.id ?? null,
        referenceNumber: order.orderNumber,
        guest: order.reservation?.guestProfile?.fullName || order.customerLabel || "Walk-in",
        room: order.reservation ? roomLabel(order.reservation.allocations) : "Walk-in",
        method: order.settlementMethod || "UNCLASSIFIED_OUTLET_PAYMENT",
        reference: order.outlet.name,
        currency: order.currency,
        amount: round(decimal(order.total)),
        recordedBy: userLabel(order.settledBy || order.createdBy),
        voidedAt: null,
        voidReason: null,
      })),
    ].sort((a: any, b: any) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

    const outletRows = orders
      .filter((order: any) => inRange(order.createdAt, rangeStart, rangeEnd) || inRange(order.postedAt, rangeStart, rangeEnd) || inRange(order.settledAt, rangeStart, rangeEnd) || OPEN_ORDER_STATUSES.includes(order.status))
      .map((order: any) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        outlet: order.outlet.name,
        outletType: order.outlet.type,
        guest: order.reservation?.guestProfile?.fullName || order.customerLabel || "Walk-in",
        room: order.reservation ? roomLabel(order.reservation.allocations) : "Walk-in",
        reservationId: order.reservation?.id ?? null,
        customerType: order.reservation ? "RESIDENT" : "NON_RESIDENT",
        status: order.status,
        settlementMode: order.settlementMode,
        settlementMethod: order.settlementMethod,
        items: order.items.map((item: any) => `${item.quantity}× ${item.nameSnapshot}`).join(", "),
        itemCount: order.items.reduce((sum: number, item: any) => sum + item.quantity, 0),
        currency: order.currency,
        total: round(decimal(order.total)),
        orderedAt: order.createdAt,
        servedAt: order.servedAt,
        completedAt: order.settledAt || order.postedAt,
        createdBy: userLabel(order.createdBy),
        voidReason: order.voidReason,
      }));

    // Resident vs walk-in outlet production per currency (doc NRMS_QR_ORDERING.md m1).
    const outletCustomerSplit = Object.values(outletRows
      .filter((row: any) => ["SETTLED", "POSTED_TO_FOLIO"].includes(row.status))
      .reduce((groups: Record<string, any>, row: any) => {
        const key = row.currency || "TZS";
        const group = groups[key] ?? (groups[key] = { currency: key, residentOrders: 0, residentRevenue: 0, nonResidentOrders: 0, nonResidentRevenue: 0 });
        if (row.customerType === "RESIDENT") { group.residentOrders += 1; group.residentRevenue = round(group.residentRevenue + row.total); }
        else { group.nonResidentOrders += 1; group.nonResidentRevenue = round(group.nonResidentRevenue + row.total); }
        return groups;
      }, {}));

    const auditRows = events.map((event: any) => ({
      id: event.id,
      type: event.type,
      occurredAt: event.createdAt,
      reservationId: event.reservation.id,
      referenceNumber: event.reservation.receiptNumber,
      guest: event.reservation.guestProfile?.fullName || "Guest",
      room: roomLabel(event.reservation.allocations),
      actor: userLabel(event.actor),
      reason: typeof event.data?.reason === "string" ? event.data.reason : null,
      details: event.data ?? null,
    }));

    const financialChecks = currencyReports.flatMap((report: any) => {
      const revenueDifference = round(report.summary.totalRevenue - (
        report.summary.roomRevenue + report.summary.folioExtras + report.summary.outletPaidRevenue
      ));
      const collectionDifference = round(report.summary.totalCollected - (
        report.summary.folioPayments + report.summary.outletPayments
      ));
      const timingDifference = round(report.summary.folioPayments - (
        report.collectionTiming.currentStayCollections
        + report.collectionTiming.priorStayCollections
        + report.collectionTiming.advanceDeposits
        + report.collectionTiming.unclassifiedCollections
      ));
      return [
        { key: "REVENUE_COMPONENTS", currency: report.currency, label: "Revenue components reconcile", difference: revenueDifference, passed: Math.abs(revenueDifference) <= 0.01 },
        { key: "COLLECTION_COMPONENTS", currency: report.currency, label: "Collection components reconcile", difference: collectionDifference, passed: Math.abs(collectionDifference) <= 0.01 },
        { key: "COLLECTION_TIMING", currency: report.currency, label: "Collection timing bridge reconciles", difference: timingDifference, passed: Math.abs(timingDifference) <= 0.01 },
      ];
    });

    const warnings: Array<{ key: string; label: string; count: number }> = [];
    const missingReceiptNumbers = balanceReservations.filter((reservation: any) => !reservation.receiptNumber).length;
    if (missingReceiptNumbers) warnings.push({ key: "MISSING_RECEIPT_NUMBER", label: "Active folios without a receipt number", count: missingReceiptNumbers });
    const unassignedStays = stayRevenueReservations.filter((reservation: any) => roomLabel(reservation.allocations) === "Unassigned").length;
    if (unassignedStays) warnings.push({ key: "UNASSIGNED_STAY", label: "Revenue-bearing stays without an active room allocation", count: unassignedStays });
    const missingVoidReasons = [
      ...payments.filter((item: any) => item.voidedAt && !String(item.voidReason || "").trim()),
      ...charges.filter((item: any) => item.voidedAt && !String(item.voidReason || "").trim()),
      ...orders.filter((item: any) => item.voidedAt && !String(item.voidReason || "").trim()),
    ].length;
    if (missingVoidReasons) warnings.push({ key: "VOID_REASON_MISSING", label: "Voided transactions without a recorded reason", count: missingVoidReasons });
    const unclassifiedCollectionCurrencies = currencyReports.filter((report: any) => report.collectionTiming.unclassifiedCollections > 0.01).length;
    if (unclassifiedCollectionCurrencies) warnings.push({ key: "UNCLASSIFIED_COLLECTION_TIMING", label: "Currencies containing collections without a stay-timing classification", count: unclassifiedCollectionCurrencies });
    if (payments.length >= 1000) warnings.push({ key: "PAYMENT_ROW_LIMIT", label: "Payment register reached the 1,000-row report limit", count: payments.length });
    if (charges.length >= 1000) warnings.push({ key: "CHARGE_ROW_LIMIT", label: "Folio charge register reached the 1,000-row report limit", count: charges.length });
    if (orders.length >= 1000) warnings.push({ key: "OUTLET_ROW_LIMIT", label: "Outlet order register reached the 1,000-row report limit", count: orders.length });
    if (events.length >= 1000) warnings.push({ key: "AUDIT_ROW_LIMIT", label: "Audit register reached the 1,000-row report limit", count: events.length });

    // Housekeeping snapshot (live state) plus work completed in the range.
    const [hkUnits, hkOpenTaskCount, hkDoneTasks] = await Promise.all([
      db.roomUnit.findMany({ where: { propertyId }, select: { status: true, housekeepingStatus: true } }),
      db.nrmsHousekeepingTask.count({ where: { propertyId, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
      db.nrmsHousekeepingTask.findMany({ where: { propertyId, status: "DONE", completedAt: dateWindow }, select: { type: true } }),
    ]);
    const hkRoomCounts: Record<string, number> = { CLEAN: 0, DIRTY: 0, IN_PROGRESS: 0, INSPECTED: 0 };
    for (const unit of hkUnits) {
      if (unit.status !== "ACTIVE") continue;
      hkRoomCounts[unit.housekeepingStatus] = (hkRoomCounts[unit.housekeepingStatus] ?? 0) + 1;
    }
    const hkCompletedByType: Record<string, number> = {};
    for (const task of hkDoneTasks) hkCompletedByType[task.type] = (hkCompletedByType[task.type] ?? 0) + 1;
    if (hkRoomCounts.DIRTY > 0) warnings.push({ key: "ROOMS_DIRTY", label: "Rooms waiting for housekeeping", count: hkRoomCounts.DIRTY });

    const failedFinancialChecks = financialChecks.filter((check: any) => !check.passed).length;
    const controlStatus = failedFinancialChecks > 0 ? "FAILED" : warnings.length > 0 ? "REVIEW" : "BALANCED";

    res.json({
      property: { id: propertyId, title: active.property.title },
      range: { from: fromKey, to: toKey, days: rangeDays },
      generatedAt: new Date().toISOString(),
      control: {
        status: controlStatus,
        financialChecks,
        warnings,
        basis: {
          roomRevenue: "STAY_NIGHT_ALLOCATION",
          folioExtras: "POSTED_AT",
          outletRevenue: "SETTLED_AT",
          collections: "RECORDED_AT",
          channelProduction: "ARRIVAL_DATE",
          timeZone: NRMS_TIME_ZONE,
        },
        recordCounts: {
          reservations: reservations.length,
          stayRevenueReservations: stayRevenueReservations.length,
          folioCharges: activeCharges.length,
          payments: activePayments.length,
          outletOrders: outletRows.length,
          auditEvents: auditRows.length,
        },
      },
      manager: {
        arrivals: reservations.filter((reservation: any) => ACTIVE_REVENUE_STATUSES.includes(reservation.status) && inRange(reservation.checkIn, rangeStart, rangeEnd)).length,
        departures: reservations.filter((reservation: any) => ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(reservation.status) && inRange(reservation.checkOut, rangeStart, rangeEnd)).length,
        inHouse: reservations.filter((reservation: any) => reservation.status === "CHECKED_IN").length,
        cancellations: reservations.filter((reservation: any) => inRange(reservation.cancelledAt, rangeStart, rangeEnd)).length,
        noShows: reservations.filter((reservation: any) => inRange(reservation.noShowAt, rangeStart, rangeEnd)).length,
        openOrders: orders.filter((order: any) => OPEN_ORDER_STATUSES.includes(order.status)).length,
        rooms: {
          total: roomTypes.reduce((sum: number, roomType: any) => sum + roomType.units.length, 0),
          active: activeUnits,
          occupiedNow,
          availableNow: Math.max(0, activeUnits - occupiedNow - currentBlocks),
          outOfService: outOfServiceUnits,
        },
      },
      currencies: currencyReports,
      reservationSources,
      guestBalances,
      occupancy: {
        currency: occupancyCurrency,
        rangeDays,
        activeRooms: activeUnits,
        blockedRoomNights,
        roomNightsAvailable: availableRoomNights,
        roomNightsSold: soldRoomNights,
        occupancyRate: availableRoomNights > 0 ? round((soldRoomNights / availableRoomNights) * 100) : 0,
        roomRevenue: round(occupancyRoomRevenue),
        adr: soldRoomNights > 0 ? round(occupancyRoomRevenue / soldRoomNights) : 0,
        revPar: availableRoomNights > 0 ? round(occupancyRoomRevenue / availableRoomNights) : 0,
        byRoomType: occupancyByRoomType,
      },
      housekeeping: {
        rooms: { ...hkRoomCounts, outOfService: outOfServiceUnits },
        openTasks: hkOpenTaskCount,
        completedInRange: hkDoneTasks.length,
        completedByType: hkCompletedByType,
      },
      payments: { rows: paymentRows, cashVarianceAvailable: false },
      outlets: { rows: outletRows, customerSplit: outletCustomerSplit },
      audit: { rows: auditRows },
    });
  } catch (error) {
    console.error("[owner.nrms.reports] report failed", error);
    res.status(500).json({ error: "Failed to generate NRMS reports" });
  }
}) as RequestHandler);

export default router;

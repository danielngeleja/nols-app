import crypto from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth } from "../middleware/auth.js";
import { createNightAuditLedgerTransaction } from "../lib/nrmsNightAuditLedger.js";
import { allocateStayValue } from "../lib/nrmsReporting.js";
import { ensureBusinessDay, expectedCashForShift, shiftHandoverSummary } from "../lib/nrmsShifts.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const db = prisma as any;
const ZONE = "Africa/Dar_es_Salaam";
const PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"] as const;
const activeRevenueStatuses = ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];

type FinanceAccess = { property: { id: number; ownerId: number; title: string; currency: string | null }; role: "OWNER" | "MANAGER" | "FRONT_DESK" };

async function loadFinanceAccess(req: AuthedRequest, res: Response, propertyId: number): Promise<FinanceAccess | null> {
  if (!Number.isInteger(propertyId) || propertyId <= 0) { res.status(400).json({ error: "Invalid property id" }); return null; }
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { id: true, ownerId: true, title: true, currency: true, nrmsActivatedAt: true } });
  if (!property?.nrmsActivatedAt) { res.status(404).json({ error: "Active NRMS property not found" }); return null; }
  if (property.ownerId === req.user!.id) return { property, role: "OWNER" };
  const membership = await db.nrmsStaffMembership.findFirst({ where: { propertyId, userId: req.user!.id, status: "ACTIVE", role: { in: ["MANAGER", "FRONT_DESK"] } }, select: { role: true } });
  if (!membership) { res.status(403).json({ error: "You do not have access to this property's financial controls" }); return null; }
  return { property, role: membership.role };
}

function requireManager(access: FinanceAccess, res: Response): boolean {
  if (access.role === "OWNER" || access.role === "MANAGER") return true;
  res.status(403).json({ error: "A property owner or manager must perform this control action" });
  return false;
}

const openShiftSchema = z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), openingFloat: z.number().min(0) });
const closeShiftSchema = z.object({ declaredCash: z.number().min(0), closeNote: z.string().trim().max(300).optional().nullable() });
const closeDaySchema = z.object({ businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });
const classifyTenderSchema = z.object({ method: z.enum(PAYMENT_METHODS) });

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function dayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayRange(key: string): { start: Date; end: Date } {
  const start = new Date(`${key}T00:00:00+03:00`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function dateOnly(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

function monthRange(key: string): { start: Date; end: Date; days: number } {
  if (!/^\d{4}-\d{2}$/.test(key)) throw new Error("INVALID_MONTH");
  const start = new Date(`${key}-01T00:00:00+03:00`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end, days: Math.round((end.getTime() - start.getTime()) / 86_400_000) };
}

function accountForPayment(method: string) {
  if (method === "CASH") return { code: "1000", name: "Cash on hand" };
  if (method === "MOBILE_MONEY") return { code: "1010", name: "Mobile money clearing" };
  if (method === "CARD") return { code: "1020", name: "Card clearing" };
  if (method === "BANK") return { code: "1030", name: "Bank" };
  return { code: "1090", name: "Other settlement clearing" };
}

function accountForCharge(category: string) {
  if (category === "RESTAURANT") return { code: "4200", name: "Restaurant revenue" };
  if (category === "BAR") return { code: "4210", name: "Bar revenue" };
  if (category === "ROOM_SERVICE") return { code: "4220", name: "Room service revenue" };
  if (category === "LAUNDRY") return { code: "4230", name: "Laundry revenue" };
  return { code: "4290", name: "Other service revenue" };
}

function personName(user: any): string {
  return user?.fullName || user?.name || user?.email || "System";
}


async function controlIssues(propertyId: number, key: string) {
  const { end, start } = dayRange(key);
  const [openShifts, openOrders, dueOut, unclassified, missingVoidReasons] = await Promise.all([
    db.nrmsCashierShift.count({ where: { propertyId, status: "OPEN", businessDate: dateOnly(key) } }),
    db.nrmsOutletOrder.count({ where: { propertyId, status: { in: ["CONFIRMED", "PREPARING", "SERVING"] } } }),
    db.reservation.count({ where: { propertyId, status: "CHECKED_IN", checkOut: { lte: end } } }),
    db.nrmsOutletOrder.count({ where: { propertyId, status: "SETTLED", settlementMode: "OUTLET_PAYMENT", settlementMethod: null, settledAt: { gte: start, lt: end } } }),
    db.nrmsOutletOrder.count({ where: { propertyId, status: { in: ["VOIDED", "CANCELLED"] }, voidReason: null, updatedAt: { gte: start, lt: end } } }),
  ]);
  const blockers = [
    openShifts ? { code: "OPEN_CASHIER_SHIFTS", count: openShifts, message: `${openShifts} cashier shift${openShifts === 1 ? " is" : "s are"} still open.` } : null,
    openOrders ? { code: "OPEN_OUTLET_ORDERS", count: openOrders, message: `${openOrders} restaurant or bar order${openOrders === 1 ? " is" : "s are"} not completed.` } : null,
    dueOut ? { code: "DUE_OUT_GUESTS", count: dueOut, message: `${dueOut} due-out guest${dueOut === 1 ? " is" : "s are"} still checked in.` } : null,
    unclassified ? { code: "UNCLASSIFIED_TENDERS", count: unclassified, message: `${unclassified} outlet settlement${unclassified === 1 ? " needs" : "s need"} a payment method.` } : null,
    missingVoidReasons ? { code: "MISSING_VOID_REASONS", count: missingVoidReasons, message: `${missingVoidReasons} void or cancellation record${missingVoidReasons === 1 ? " has" : "s have"} no reason.` } : null,
  ].filter(Boolean);
  return { blockers, warnings: [] as any[] };
}

type Posting = {
  sourceKey: string; sourceType: string; sourceId: number; description: string; currency: string; occurredAt: Date;
  entries: Array<{ accountCode: string; accountName: string; accountType: string; debit: number; credit: number }>;
};

async function buildPostings(propertyId: number, key: string): Promise<Posting[]> {
  const { start, end } = dayRange(key);
  const [reservations, payments, charges, outlets] = await Promise.all([
    db.reservation.findMany({
      where: { propertyId, status: { in: activeRevenueStatuses }, checkIn: { lt: end }, checkOut: { gt: start } },
      select: { id: true, receiptNumber: true, checkIn: true, checkOut: true, totalAmount: true, taxAmount: true, currency: true },
    }),
    db.externalPaymentRecord.findMany({ where: { reservation: { propertyId }, OR: [{ createdAt: { gte: start, lt: end } }, { voidedAt: { gte: start, lt: end } }] } }),
    db.reservationCharge.findMany({ where: { reservation: { propertyId }, OR: [{ createdAt: { gte: start, lt: end } }, { voidedAt: { gte: start, lt: end } }] } }),
    db.nrmsOutletOrder.findMany({ where: { propertyId, status: "SETTLED", settlementMode: "OUTLET_PAYMENT", voidedAt: null, settledAt: { gte: start, lt: end } }, include: { outlet: { select: { type: true } } } }),
  ]);
  const postings: Posting[] = [];
  for (const stay of reservations) {
    const gross = money(allocateStayValue(money(stay.totalAmount), stay.checkIn, stay.checkOut, start, end));
    const tax = Math.min(gross, money(allocateStayValue(money(stay.taxAmount), stay.checkIn, stay.checkOut, start, end)));
    const net = money(gross - tax);
    if (gross <= 0) continue;
    postings.push({ sourceKey: `ROOM:${propertyId}:${stay.id}:${key}`, sourceType: "ROOM_NIGHT", sourceId: stay.id, description: `Room revenue ${stay.receiptNumber || `reservation ${stay.id}`}`, currency: stay.currency, occurredAt: start, entries: [
      { accountCode: "1100", accountName: "Guest ledger receivable", accountType: "ASSET", debit: gross, credit: 0 },
      { accountCode: "4000", accountName: "Room revenue", accountType: "REVENUE", debit: 0, credit: net },
      ...(tax > 0 ? [{ accountCode: "2200", accountName: "Tax payable", accountType: "LIABILITY", debit: 0, credit: tax }] : []),
    ] });
  }
  for (const charge of charges) {
    const revenue = accountForCharge(charge.category);
    const amount = money(charge.amount);
    if (new Date(charge.createdAt) >= start && new Date(charge.createdAt) < end) postings.push({ sourceKey: `CHARGE:${propertyId}:${charge.id}`, sourceType: "FOLIO_CHARGE", sourceId: charge.id, description: charge.description || `${charge.category} folio charge`, currency: charge.currency, occurredAt: charge.createdAt, entries: [
      { accountCode: "1100", accountName: "Guest ledger receivable", accountType: "ASSET", debit: amount, credit: 0 },
      { accountCode: revenue.code, accountName: revenue.name, accountType: "REVENUE", debit: 0, credit: amount },
    ] });
    if (charge.voidedAt && new Date(charge.voidedAt) >= start && new Date(charge.voidedAt) < end) postings.push({ sourceKey: `CHARGE_VOID:${propertyId}:${charge.id}`, sourceType: "CHARGE_REVERSAL", sourceId: charge.id, description: `Reversal: ${charge.description || `${charge.category} folio charge`}`, currency: charge.currency, occurredAt: charge.voidedAt, entries: [
      { accountCode: revenue.code, accountName: revenue.name, accountType: "REVENUE", debit: amount, credit: 0 },
      { accountCode: "1100", accountName: "Guest ledger receivable", accountType: "ASSET", debit: 0, credit: amount },
    ] });
  }
  for (const payment of payments) {
    const tender = accountForPayment(payment.method);
    const amount = money(payment.amount);
    if (new Date(payment.createdAt) >= start && new Date(payment.createdAt) < end) postings.push({ sourceKey: `PAYMENT:${propertyId}:${payment.id}`, sourceType: "FOLIO_PAYMENT", sourceId: payment.id, description: `${payment.method.replace(/_/g, " ")} guest payment`, currency: payment.currency, occurredAt: payment.createdAt, entries: [
      { accountCode: tender.code, accountName: tender.name, accountType: "ASSET", debit: amount, credit: 0 },
      { accountCode: "1100", accountName: "Guest ledger receivable", accountType: "ASSET", debit: 0, credit: amount },
    ] });
    if (payment.voidedAt && new Date(payment.voidedAt) >= start && new Date(payment.voidedAt) < end) postings.push({ sourceKey: `PAYMENT_VOID:${propertyId}:${payment.id}`, sourceType: "PAYMENT_REVERSAL", sourceId: payment.id, description: `Reversal: ${payment.method.replace(/_/g, " ")} guest payment`, currency: payment.currency, occurredAt: payment.voidedAt, entries: [
      { accountCode: "1100", accountName: "Guest ledger receivable", accountType: "ASSET", debit: amount, credit: 0 },
      { accountCode: tender.code, accountName: tender.name, accountType: "ASSET", debit: 0, credit: amount },
    ] });
  }
  for (const order of outlets) {
    const tender = accountForPayment(order.settlementMethod || "OTHER");
    const revenue = accountForCharge(order.outlet.type);
    const amount = money(order.total);
    postings.push({ sourceKey: `OUTLET:${propertyId}:${order.id}`, sourceType: "OUTLET_SALE", sourceId: order.id, description: `Outlet sale ${order.orderNumber}`, currency: order.currency, occurredAt: order.settledAt, entries: [
      { accountCode: tender.code, accountName: tender.name, accountType: "ASSET", debit: amount, credit: 0 },
      { accountCode: revenue.code, accountName: revenue.name, accountType: "REVENUE", debit: 0, credit: amount },
    ] });
  }
  return postings;
}

function isTanzanian(value: string | null | undefined): boolean {
  const nationality = String(value ?? "").trim().toUpperCase();
  return ["TZ", "TZA", "TANZANIA", "TANZANIAN", "UNITED REPUBLIC OF TANZANIA"].includes(nationality);
}

async function nbsStatistics(propertyId: number, month: string) {
  const range = monthRange(month);
  const [units, reservations] = await Promise.all([
    db.roomUnit.findMany({ where: { propertyId, status: "ACTIVE" }, select: { id: true, bedCount: true } }),
    db.reservation.findMany({
      where: { propertyId, status: { in: activeRevenueStatuses }, checkIn: { lt: range.end }, checkOut: { gt: range.start } },
      select: { id: true, checkIn: true, checkOut: true, adults: true, children: true, guestProfile: { select: { nationality: true } }, allocations: { where: { startDate: { lt: range.end }, endDate: { gt: range.start } }, select: { startDate: true, endDate: true, roomUnit: { select: { bedCount: true } } } } },
    }),
  ]);
  const bedsAvailable = units.reduce((sum: number, unit: any) => sum + Math.max(1, Number(unit.bedCount || 1)), 0);
  let bedNightsOccupied = 0;
  let internationalBedNights = 0;
  let domesticBedNights = 0;
  let roomNightsOccupied = 0;
  let missingNationality = 0;
  for (const reservation of reservations) {
    const overlapStart = Math.max(new Date(reservation.checkIn).getTime(), range.start.getTime());
    const overlapEnd = Math.min(new Date(reservation.checkOut).getTime(), range.end.getTime());
    const nights = Math.max(0, Math.ceil((overlapEnd - overlapStart) / 86_400_000));
    const guests = Math.max(1, Number(reservation.adults || 0) + Number(reservation.children || 0));
    const allocatedBedNights = reservation.allocations.reduce((sum: number, allocation: any) => {
      const allocationStart = Math.max(new Date(allocation.startDate).getTime(), range.start.getTime());
      const allocationEnd = Math.min(new Date(allocation.endDate).getTime(), range.end.getTime());
      const allocationNights = Math.max(0, Math.ceil((allocationEnd - allocationStart) / 86_400_000));
      roomNightsOccupied += allocationNights;
      return sum + allocationNights * Math.max(1, Number(allocation.roomUnit?.bedCount || 1));
    }, 0);
    const occupied = allocatedBedNights > 0 ? Math.min(nights * guests, allocatedBedNights) : nights * guests;
    bedNightsOccupied += occupied;
    if (!reservation.guestProfile?.nationality) missingNationality += occupied;
    else if (isTanzanian(reservation.guestProfile.nationality)) domesticBedNights += occupied;
    else internationalBedNights += occupied;
  }
  const bedNightsAvailable = bedsAvailable * range.days;
  return {
    month, reportingDays: range.days, bedsAvailable, bedNightsAvailable, bedNightsOccupied, domesticBedNights, internationalBedNights,
    roomNightsOccupied, bedOccupancyRate: bedNightsAvailable ? money((bedNightsOccupied / bedNightsAvailable) * 100) : 0,
    missingNationalityBedNights: missingNationality,
    methodology: "Occupied bed-nights use registered guests, capped by the physical bed count of allocated rooms. Nationality follows the lead guest profile.",
  };
}

router.get("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadFinanceAccess(req, res, Number(req.params.propertyId));
    if (!active) return;
    const propertyId = active.property.id;
    const businessDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.businessDate ?? "")) ? String(req.query.businessDate) : dayKey(new Date());
    const month = /^\d{4}-\d{2}$/.test(String(req.query.month ?? "")) ? String(req.query.month) : businessDate.slice(0, 7);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from ?? "")) ? String(req.query.from) : businessDate;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to ?? "")) ? String(req.query.to) : businessDate;
    if (to < from) return res.status(400).json({ error: "Choose a valid financial control date range" });
    const start = dateOnly(businessDate);
    const selectedDayRange = dayRange(businessDate);
    const [day, shifts, issues, nbs, nightAudits, unclassifiedTenders] = await Promise.all([
      db.nrmsBusinessDay.findUnique({ where: { propertyId_businessDate: { propertyId, businessDate: start } }, include: { nightAudits: { orderBy: { startedAt: "desc" }, take: 5 } } }),
      db.nrmsCashierShift.findMany({ where: { propertyId, businessDate: { gte: dateOnly(from), lte: dateOnly(to) } }, include: { user: { select: { fullName: true, name: true, email: true } }, approvedBy: { select: { fullName: true, name: true, email: true } }, ownerSignedOffBy: { select: { fullName: true, name: true, email: true } }, handoverFrom: { select: { user: { select: { fullName: true, name: true, email: true } } } } }, orderBy: { openedAt: "desc" } }),
      controlIssues(propertyId, businessDate),
      nbsStatistics(propertyId, month),
      db.nrmsNightAuditRun.findMany({ where: { propertyId, businessDay: { businessDate: { gte: dateOnly(from), lte: dateOnly(to) } } }, include: { businessDay: { select: { businessDate: true } } }, orderBy: { startedAt: "desc" } }),
      db.nrmsOutletOrder.findMany({
        where: { propertyId, status: "SETTLED", settlementMode: "OUTLET_PAYMENT", settlementMethod: null, settledAt: { gte: selectedDayRange.start, lt: selectedDayRange.end } },
        select: { id: true, orderNumber: true, customerLabel: true, currency: true, total: true, settledAt: true, outlet: { select: { name: true, type: true } }, reservation: { select: { guestProfile: { select: { fullName: true } }, allocations: { where: { status: "ACTIVE" }, select: { roomUnit: { select: { code: true } } } } } } },
        orderBy: { settledAt: "asc" },
      }),
    ]);
    // Cashier rows are per-user, not per-outlet, so we separately join each
    // shift's user against their outlet/role assignment for display only.
    const shiftUserIds = [...new Set(shifts.map((shift: any) => shift.userId))];
    const assignments = shiftUserIds.length
      ? await db.nrmsStaffMembership.findMany({ where: { propertyId, userId: { in: shiftUserIds }, status: "ACTIVE" }, select: { userId: true, role: true, outlet: { select: { name: true } } } })
      : [];
    const assignmentByUserId = new Map(assignments.map((row: any) => [row.userId, { role: row.role, outletName: row.outlet?.name ?? null }]));
    const enrichedShifts = await Promise.all(shifts.map(async (shift: any) => ({
      ...shift,
      cashierName: personName(shift.user),
      assignment: shift.userId === active.property.ownerId ? { role: "OWNER", outletName: null } : assignmentByUserId.get(shift.userId) ?? null,
      approvedByName: shift.approvedBy ? personName(shift.approvedBy) : null,
      ownerSignedOffByName: shift.ownerSignedOffBy ? personName(shift.ownerSignedOffBy) : null,
      handoverFromName: shift.handoverFrom ? personName(shift.handoverFrom.user) : null,
      liveExpectedCash: shift.status === "OPEN" ? await expectedCashForShift(db, shift) : money(shift.expectedCash),
    })));
    const reportWindow = { gte: dayRange(from).start, lt: dayRange(to).end };
    const transactions = await db.nrmsLedgerTransaction.findMany({ where: { propertyId, occurredAt: reportWindow }, include: { entries: true }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    const accountMap = new Map<string, any>();
    for (const transaction of transactions) for (const entry of transaction.entries) {
      const key = `${entry.accountCode}:${transaction.currency}`;
      const row = accountMap.get(key) ?? { accountCode: entry.accountCode, accountName: entry.accountName, accountType: entry.accountType, currency: transaction.currency, debit: 0, credit: 0, balance: 0 };
      row.debit = money(row.debit + money(entry.debit)); row.credit = money(row.credit + money(entry.credit)); row.balance = money(row.debit - row.credit); accountMap.set(key, row);
    }
    const taxRows = transactions.flatMap((transaction: any) => transaction.entries.filter((entry: any) => entry.accountCode === "2200").map((entry: any) => ({ transactionNumber: transaction.transactionNumber, occurredAt: transaction.occurredAt, description: transaction.description, currency: transaction.currency, tax: money(entry.credit) - money(entry.debit) })));
    res.json({
      property: { id: propertyId, title: active.property.title, currency: active.property.currency }, accessRole: active.role, businessDate, month, range: { from, to },
      businessDay: day ? { id: day.id, status: day.status, openedAt: day.openedAt, closedAt: day.closedAt, audits: day.nightAudits } : { id: null, status: "NOT_OPENED", audits: [] },
      blockers: issues.blockers, warnings: issues.warnings, shifts: enrichedShifts,
      unclassifiedTenders: unclassifiedTenders.map((order: any) => ({ id: order.id, orderNumber: order.orderNumber, currency: order.currency, total: money(order.total), settledAt: order.settledAt, outlet: order.outlet, guest: order.reservation?.guestProfile?.fullName || order.customerLabel || "Walk-in", room: order.reservation ? (order.reservation.allocations.map((allocation: any) => allocation.roomUnit?.code).filter(Boolean).join(", ") || "No room") : "Walk-in" })),
      ledger: { accounts: [...accountMap.values()], transactions, balanced: transactions.every((transaction: any) => money(transaction.entries.reduce((sum: number, entry: any) => sum + money(entry.debit) - money(entry.credit), 0)) === 0) },
      tax: { rows: taxRows, total: money(taxRows.reduce((sum: number, row: any) => sum + row.tax, 0)), note: "Tax register includes only tax separately captured on reservations. Folio and outlet prices are treated as tax-inclusive only when a future tax rule explicitly splits them." },
      nightAudits,
      nbs,
    });
  } catch (error) {
    console.error("Failed to load NRMS financial control", error);
    res.status(500).json({ error: "Unable to load financial control records" });
  }
}) as RequestHandler);

router.post("/property/:propertyId/shifts/open", (async (req: AuthedRequest, res: Response) => {
  const active = await loadFinanceAccess(req, res, Number(req.params.propertyId));
  if (!active) return;
  const parsed = openShiftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter a valid business date and opening float" });
  const currency = active.property.currency?.toUpperCase();
  if (!currency) return res.status(409).json({ error: "Set the property currency before opening a cashier shift" });
  try {
    const shift = await db.$transaction(async (tx: any) => {
      const existing = await tx.nrmsCashierShift.findFirst({ where: { propertyId: active.property.id, userId: req.user!.id, status: "OPEN" } });
      if (existing) throw new Error("SHIFT_ALREADY_OPEN");
      const day = await ensureBusinessDay(tx, active.property.id, parsed.data.businessDate, req.user!.id);
      if (day.status === "CLOSED") throw new Error("BUSINESS_DAY_CLOSED");
      return tx.nrmsCashierShift.create({ data: { propertyId: active.property.id, businessDayId: day.id, userId: req.user!.id, businessDate: day.businessDate, currency, openingFloat: parsed.data.openingFloat } });
    });
    res.status(201).json({ shift });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "SHIFT_ALREADY_OPEN") return res.status(409).json({ error: "Close your current cashier shift before opening another." });
    if (code === "BUSINESS_DAY_CLOSED") return res.status(409).json({ error: "This business date is already closed and cannot accept a new shift." });
    throw error;
  }
}) as RequestHandler);

router.post("/property/:propertyId/shifts/:shiftId/close", (async (req: AuthedRequest, res: Response) => {
  const active = await loadFinanceAccess(req, res, Number(req.params.propertyId));
  if (!active) return;
  const parsed = closeShiftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the cash physically counted at shift close" });
  const shift = await db.nrmsCashierShift.findFirst({ where: { id: Number(req.params.shiftId), propertyId: active.property.id, status: "OPEN" } });
  if (!shift) return res.status(404).json({ error: "Open cashier shift not found" });
  const until = new Date();
  const [expected, summary] = await Promise.all([expectedCashForShift(db, shift, until), shiftHandoverSummary(db, shift, until)]);
  const variance = money(parsed.data.declaredCash - expected);
  if (variance !== 0 && !parsed.data.closeNote) return res.status(400).json({ error: "Explain the overage or shortage before closing this shift." });
  const closed = await db.nrmsCashierShift.update({ where: { id: shift.id }, data: { status: "CLOSED", expectedCash: expected, declaredCash: parsed.data.declaredCash, variance, closeNote: parsed.data.closeNote || null, closeSummary: summary, approvedById: req.user!.id, closedAt: until } });
  res.json({ shift: closed });
}) as RequestHandler);

/**
 * POST /property/:propertyId/shifts/:shiftId/sign-off - owner/manager
 * acknowledgment that a closed shift's sales are authentic. Distinct from the
 * close itself (often done by the attendant); recorded once and not reversible
 * from here, matching the "sealed" handling of the rest of the shift record.
 */
router.post("/property/:propertyId/shifts/:shiftId/sign-off", (async (req: AuthedRequest, res: Response) => {
  const active = await loadFinanceAccess(req, res, Number(req.params.propertyId));
  if (!active) return;
  if (!requireManager(active, res)) return;
  const shift = await db.nrmsCashierShift.findFirst({ where: { id: Number(req.params.shiftId), propertyId: active.property.id, status: "CLOSED" } });
  if (!shift) return res.status(404).json({ error: "Closed cashier shift not found" });
  if (shift.ownerSignedOffAt) return res.status(409).json({ error: "This shift is already signed off" });
  const signed = await db.nrmsCashierShift.update({ where: { id: shift.id }, data: { ownerSignedOffAt: new Date(), ownerSignedOffById: req.user!.id } });
  res.json({ shift: signed });
}) as RequestHandler);

router.post("/property/:propertyId/outlet-orders/:orderId/classify", (async (req: AuthedRequest, res: Response) => {
  const active = await loadFinanceAccess(req, res, Number(req.params.propertyId));
  if (!active) return;
  if (!requireManager(active, res)) return;
  const parsed = classifyTenderSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a supported payment method" });
  const order = await db.nrmsOutletOrder.findFirst({ where: { id: Number(req.params.orderId), propertyId: active.property.id, status: "SETTLED", settlementMode: "OUTLET_PAYMENT" } });
  if (!order) return res.status(404).json({ error: "Settled outlet order not found" });
  const businessDate = dayKey(order.settledAt || order.updatedAt);
  const closedDay = await db.nrmsBusinessDay.findUnique({ where: { propertyId_businessDate: { propertyId: active.property.id, businessDate: dateOnly(businessDate) } } });
  if (closedDay?.status === "CLOSED") return res.status(409).json({ error: "The related business date is closed. Post a controlled correction instead of changing its tender." });
  const updated = await db.nrmsOutletOrder.update({ where: { id: order.id }, data: { settlementMethod: parsed.data.method, settledById: order.settledById || req.user!.id } });
  res.json({ order: updated });
}) as RequestHandler);

router.post("/property/:propertyId/night-audit/close", (async (req: AuthedRequest, res: Response) => {
  const active = await loadFinanceAccess(req, res, Number(req.params.propertyId));
  if (!active) return;
  if (!requireManager(active, res)) return;
  const parsed = closeDaySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid business date" });
  const issues = await controlIssues(active.property.id, parsed.data.businessDate);
  const reportNumber = `NA-${active.property.id}-${parsed.data.businessDate.replace(/-/g, "")}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const day = await db.$transaction((tx: any) => ensureBusinessDay(tx, active.property.id, parsed.data.businessDate, req.user!.id));
  if (day.status === "CLOSED") return res.status(409).json({ error: "This business date is already closed." });
  if (issues.blockers.length) {
    const audit = await db.nrmsNightAuditRun.create({ data: { propertyId: active.property.id, businessDayId: day.id, status: "BLOCKED", reportNumber, blockers: issues.blockers, warnings: issues.warnings, startedById: req.user!.id, completedAt: new Date() } });
    return res.status(409).json({ error: "Night Audit is blocked. Clear every control issue before closing the business date.", blockers: issues.blockers, audit });
  }
  const postings = await buildPostings(active.property.id, parsed.data.businessDate);
  for (const posting of postings) {
    const debit = money(posting.entries.reduce((sum, entry) => sum + entry.debit, 0));
    const credit = money(posting.entries.reduce((sum, entry) => sum + entry.credit, 0));
    if (debit !== credit) return res.status(500).json({ error: `Unbalanced accounting event: ${posting.description}` });
  }
  const result = await db.$transaction(async (tx: any) => {
    const current = await tx.nrmsBusinessDay.findUnique({ where: { id: day.id } });
    if (!current || current.status === "CLOSED") throw new Error("BUSINESS_DAY_CLOSED");
    await tx.nrmsBusinessDay.update({ where: { id: day.id }, data: { status: "CLOSING" } });
    const audit = await tx.nrmsNightAuditRun.create({ data: { propertyId: active.property.id, businessDayId: day.id, status: "DRAFT", reportNumber, blockers: [], warnings: issues.warnings, startedById: req.user!.id } });
    let debitTotal = 0;
    for (const [index, posting] of postings.entries()) {
      debitTotal += posting.entries.reduce((sum, entry) => sum + entry.debit, 0);
      await createNightAuditLedgerTransaction(tx, {
        propertyId: active.property.id,
        businessDayId: day.id,
        nightAuditRunId: audit.id,
        transactionNumber: `GL-${parsed.data.businessDate.replace(/-/g, "")}-${String(index + 1).padStart(4, "0")}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`,
        sourceKey: posting.sourceKey,
        sourceType: posting.sourceType,
        sourceId: posting.sourceId,
        description: posting.description,
        currency: posting.currency,
        occurredAt: posting.occurredAt,
        entries: { create: posting.entries },
      });
    }
    const summary = { transactionCount: postings.length, debitTotal: money(debitTotal), creditTotal: money(debitTotal) };
    await tx.nrmsNightAuditRun.update({ where: { id: audit.id }, data: { status: "CLOSED", closedById: req.user!.id, completedAt: new Date(), summary } });
    const closed = await tx.nrmsBusinessDay.update({ where: { id: day.id }, data: { status: "CLOSED", closedById: req.user!.id, closedAt: new Date() } });
    return { businessDay: closed, audit: { ...audit, status: "CLOSED", summary } };
  }, { maxWait: 10_000, timeout: 30_000 });
  res.json(result);
}) as RequestHandler);

export default router;

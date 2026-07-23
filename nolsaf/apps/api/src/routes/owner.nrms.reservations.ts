// apps/api/src/routes/owner.nrms.reservations.ts
// NRMS external reservation lifecycle + front desk (doc 6.3, 6.4, 7.3, 7.4).
// External/direct/walk-in stays only: marketplace bookings keep their own
// validated check-in flow and never pass through here (doc 6.5).
// Every state change writes a ReservationEvent audit row (doc 14).
// PAYG usage events at checkout arrive with Phase 3.
import { Router, type Response } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { requireNrms, loadOwnedActiveNrmsProperty, NRMS_BILLING_BLOCKING_STATUSES, nrmsBillingBlockPayload } from "../lib/nrms.js";
import { findUnitConflicts, getRoomTypeAvailability, lockPropertyInventory } from "../lib/nrmsAvailability.js";
import { sanitizeText } from "../lib/sanitize.js";
import { finalizeNrmsCheckout } from "../lib/nrmsBilling.js";
import { CHARGE_CATEGORIES, computeGuestBalance, computeOutstanding, getCheckoutSettlement } from "../lib/nrmsFolio.js";
import { buildNrmsDocumentNumber, generateNrmsInvoicePdf, generateNrmsRandomCode } from "../lib/pdfDocuments.js";

export const router = Router();

// Availability/conflict checks (findUnitConflicts, getRoomTypeAvailability) and checkout
// finalization (settlement verification, usage billing, dunning, statement generation)
// inside these transactions can run long under real load; Prisma's 5s interactive-transaction
// default was tripping with P2028 in production. 15s gives real headroom without holding the
// property's inventory lock indefinitely.
const EXTENDED_TX_OPTIONS = { maxWait: 5000, timeout: 15000 };

router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, requireNrms as RequestHandler);

const RESERVATION_SOURCES = ["WALK_IN", "PHONE", "DIRECT", "AIRBNB", "BOOKING_COM", "EXPEDIA", "OTHER"] as const;
const PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"] as const;
const RESERVATION_SORT_FIELDS = ["guest", "phone", "nationality", "checkIn", "source", "adults", "amountPaid", "balance", "status"] as const;

const dayString = z.string().min(1).refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Invalid date" });
const NRMS_TIME_ZONE = "Africa/Dar_es_Salaam";

function dateKeyInNrmsTimeZone(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NRMS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function reservationDateKey(value: string): string {
  const dateOnly = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return dateOnly ?? dateKeyInNrmsTimeZone(new Date(value));
}

const guestInput = z.object({
  guestProfileId: z.number().int().positive().optional(),
  fullName: z.string().trim().min(1).max(160).optional(),
  phone: z.string().trim().min(7, "Guest phone number is required").max(40),
  email: z.string().trim().email().max(160).optional().nullable(),
  nationality: z.string().trim().min(1, "Guest nationality is required").max(80),
});

const createReservationSchema = z.object({
  source: z.enum(RESERVATION_SOURCES),
  status: z.enum(["HELD", "CONFIRMED"]).default("CONFIRMED"),
  holdExpiresAt: dayString.optional(),
  checkIn: dayString,
  checkOut: dayString,
  adults: z.number().int().min(1).max(50).default(1),
  children: z.number().int().min(0).max(50).default(0),
  guest: guestInput,
  rooms: z
    .array(z.object({ roomTypeId: z.number().int().positive(), roomUnitId: z.number().int().positive().optional().nullable() }))
    .min(1)
    .max(10),
  currency: z.string().trim().length(3).optional(),
  roomRate: z.number().nonnegative().optional().nullable(),
  discountAmount: z.number().nonnegative().optional(),
  taxAmount: z.number().nonnegative().optional(),
  totalAmount: z.number().nonnegative(),
  depositAmount: z.number().nonnegative().optional(),
  externalRef: z.string().trim().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const editReservationSchema = z.object({
  checkIn: dayString.optional(),
  checkOut: dayString.optional(),
  adults: z.number().int().min(1).max(50).optional(),
  children: z.number().int().min(0).max(50).optional(),
  roomRate: z.number().nonnegative().optional().nullable(),
  discountAmount: z.number().nonnegative().optional(),
  taxAmount: z.number().nonnegative().optional(),
  totalAmount: z.number().nonnegative().optional(),
  depositAmount: z.number().nonnegative().optional(),
  externalRef: z.string().trim().max(120).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

const reasonSchema = z.object({ reason: z.string().trim().max(300).optional().nullable() });
const checkoutVerificationSchema = z.object({
  verifiedChargeIds: z.array(z.number().int().positive()).max(500).default([]),
});
const createGroupSchema = z.object({
  name: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(2000).optional().nullable(),
  reservationIds: z.array(z.number().int().positive()).min(2).max(100),
});
const groupActionSchema = z.object({
  overrideRoomReadiness: z.boolean().optional().default(false),
  verifyCharges: z.boolean().optional().default(false),
});

const paymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

const chargeSchema = z.object({
  category: z.enum(CHARGE_CATEGORIES),
  description: z.string().trim().max(300).optional().nullable(),
  amount: z.number().positive(),
});

const moveRoomSchema = z.object({
  allocationId: z.number().int().positive(),
  roomUnitId: z.number().int().positive(),
  reason: z.string().trim().max(300).optional().nullable(),
});

const EDITABLE_STATUSES = ["DRAFT", "HELD", "CONFIRMED"];

function decimal(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatReservation(r: any) {
  return {
    id: r.id,
    propertyId: r.propertyId,
    bookingId: r.bookingId,
    source: r.source,
    attribution: r.attribution,
    externalRef: r.externalRef,
    status: r.status,
    holdExpiresAt: r.holdExpiresAt,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    adults: r.adults,
    children: r.children,
    currency: r.currency,
    roomRate: decimal(r.roomRate),
    discountAmount: decimal(r.discountAmount),
    taxAmount: decimal(r.taxAmount),
    totalAmount: decimal(r.totalAmount),
    depositAmount: decimal(r.depositAmount),
    amountPaid: decimal(r.amountPaid),
    chargesTotal: decimal(r.chargesTotal),
    openOutletOrderCount: Array.isArray(r.outletOrders)
      ? r.outletOrders.filter((order: any) => !order.status || ["CONFIRMED", "PREPARING", "SERVING"].includes(order.status)).length
      : undefined,
    balance:
      decimal(r.totalAmount) != null && decimal(r.amountPaid) != null
        ? computeGuestBalance(r.totalAmount, r.chargesTotal, r.amountPaid)
        : null,
    confirmedAt: r.confirmedAt,
    checkedInAt: r.checkedInAt,
    checkedOutAt: r.checkedOutAt,
    cancelledAt: r.cancelledAt,
    cancelReason: r.cancelReason,
    noShowAt: r.noShowAt,
    notes: r.notes,
    group: r.group
      ? { id: r.group.id, reference: r.group.reference, name: r.group.name, status: r.group.status }
      : null,
    guestProfile: r.guestProfile
      ? {
          id: r.guestProfile.id,
          fullName: r.guestProfile.fullName,
          phone: r.guestProfile.phone,
          email: r.guestProfile.email,
          nationality: r.guestProfile.nationality,
        }
      : null,
    allocations: Array.isArray(r.allocations)
      ? r.allocations.map((a: any) => ({
          id: a.id,
          roomTypeId: a.roomTypeId,
          roomTypeName: a.roomType?.name,
          roomUnitId: a.roomUnitId,
          roomUnitCode: a.roomUnit?.code ?? null,
          startDate: a.startDate,
          endDate: a.endDate,
          status: a.status,
        }))
      : undefined,
    payments: Array.isArray(r.payments)
      ? r.payments.map((p: any) => ({
          id: p.id,
          amount: decimal(p.amount),
          currency: p.currency,
          method: p.method,
          reference: p.reference,
          note: p.note,
          voidedAt: p.voidedAt,
          voidReason: p.voidReason,
          createdAt: p.createdAt,
        }))
      : undefined,
    charges: Array.isArray(r.charges)
      ? r.charges.map((c: any) => ({
          id: c.id,
          category: c.category,
          description: c.description,
          amount: decimal(c.amount),
          currency: c.currency,
          voidedAt: c.voidedAt,
          voidReason: c.voidReason,
          createdAt: c.createdAt,
          outletOrder: c.outletOrder
            ? {
                id: c.outletOrder.id,
                orderNumber: c.outletOrder.orderNumber,
                status: c.outletOrder.status,
                settlementMode: c.outletOrder.settlementMode,
                outlet: c.outletOrder.outlet,
                items: c.outletOrder.items.map((item: any) => ({
                  id: item.id,
                  name: item.nameSnapshot,
                  quantity: item.quantity,
                  lineTotal: decimal(item.lineTotal),
                })),
              }
            : null,
        }))
      : undefined,
    outletOrders:
      Array.isArray(r.outletOrders) && r.outletOrders.some((order: any) => order.orderNumber)
        ? r.outletOrders.map((order: any) => ({
            id: order.id,
            orderNumber: order.orderNumber,
            status: order.status,
            settlementMode: order.settlementMode,
            settlementMethod: order.settlementMethod,
            currency: order.currency,
            total: decimal(order.total),
            note: order.note,
            confirmedAt: order.confirmedAt,
            servedAt: order.servedAt,
            settledAt: order.settledAt,
            cancelledAt: order.cancelledAt,
            voidedAt: order.voidedAt,
            voidReason: order.voidReason,
            createdAt: order.createdAt,
            outlet: order.outlet,
            settledBy: order.settledBy,
            items: (order.items ?? []).map((item: any) => ({
              id: item.id,
              name: item.nameSnapshot,
              quantity: item.quantity,
              lineTotal: decimal(item.lineTotal),
            })),
          }))
        : undefined,
    events: Array.isArray(r.events)
      ? r.events.map((e: any) => ({ id: e.id, type: e.type, data: e.data, actorId: e.actorId, createdAt: e.createdAt }))
      : undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

const detailInclude = {
  guestProfile: true,
  group: { select: { id: true, reference: true, name: true, status: true } },
  allocations: { include: { roomType: { select: { name: true } }, roomUnit: { select: { code: true } } } },
  payments: { orderBy: { createdAt: "asc" as const } },
  charges: {
    orderBy: { createdAt: "asc" as const },
    include: {
      outletOrder: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          settlementMode: true,
          outlet: { select: { id: true, name: true, type: true } },
          items: { select: { id: true, nameSnapshot: true, quantity: true, lineTotal: true }, orderBy: { id: "asc" as const } },
        },
      },
    },
  },
  outletOrders: {
    orderBy: { createdAt: "asc" as const },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      settlementMode: true,
      settlementMethod: true,
      currency: true,
      total: true,
      note: true,
      confirmedAt: true,
      servedAt: true,
      settledAt: true,
      cancelledAt: true,
      voidedAt: true,
      voidReason: true,
      createdAt: true,
      outlet: { select: { id: true, name: true, type: true } },
      settledBy: { select: { fullName: true, name: true, email: true } },
      items: { select: { id: true, nameSnapshot: true, quantity: true, lineTotal: true }, orderBy: { id: "asc" as const } },
    },
  },
  events: { orderBy: { createdAt: "asc" as const } },
};

async function loadOwnedReservation(res: Response, ownerId: number, id: number) {
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid reservation id" });
    return null;
  }
  const reservation = await prisma.reservation.findFirst({ where: { id, ownerId }, include: detailInclude });
  if (!reservation) {
    res.status(404).json({ error: "Reservation not found" });
    return null;
  }
  if (reservation.bookingId != null) {
    // Marketplace stays keep the existing booking-code check-in flow (doc 6.5).
    res.status(409).json({ error: "NoLSAF bookings are managed through the marketplace booking flow", code: "MARKETPLACE_BOOKING" });
    return null;
  }
  return reservation;
}

/** Sum of non-voided payments, used to keep Reservation.amountPaid honest. */
async function recomputeAmountPaid(tx: any, reservationId: number) {
  const agg = await tx.externalPaymentRecord.aggregate({
    where: { reservationId, voidedAt: null },
    _sum: { amount: true },
  });
  const amountPaid = agg._sum.amount ?? 0;
  await tx.reservation.update({ where: { id: reservationId }, data: { amountPaid } });
  return amountPaid;
}

/** Sum of non-voided charges, used to keep Reservation.chargesTotal honest. */
async function recomputeChargesTotal(tx: any, reservationId: number) {
  const agg = await tx.reservationCharge.aggregate({
    where: { reservationId, voidedAt: null },
    _sum: { amount: true },
  });
  const chargesTotal = agg._sum.amount ?? 0;
  await tx.reservation.update({ where: { id: reservationId }, data: { chargesTotal } });
}

/**
 * GET /api/owner/nrms/reservations/property/:propertyId
 * Query: status?, source?, from?, to?, q? (guest name/phone), limit?, offset?, sortBy?, sortOrder?
 */
router.get("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const property = active.property;

    const { status, source, from, to, q } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const requestedSort = String(req.query.sortBy ?? "checkIn");
    const sortBy = RESERVATION_SORT_FIELDS.includes(requestedSort as (typeof RESERVATION_SORT_FIELDS)[number])
      ? (requestedSort as (typeof RESERVATION_SORT_FIELDS)[number])
      : "checkIn";
    const sortOrder: "asc" | "desc" = req.query.sortOrder === "asc" ? "asc" : "desc";
    const orderBy: any[] =
      sortBy === "guest"
        ? [{ guestProfile: { fullName: sortOrder } }, { id: "desc" }]
        : sortBy === "phone"
          ? [{ guestProfile: { phone: sortOrder } }, { id: "desc" }]
          : sortBy === "nationality"
            ? [{ guestProfile: { nationality: sortOrder } }, { id: "desc" }]
          : [{ [sortBy]: sortOrder }, { id: "desc" }];

    const where: any = { propertyId: property.id as number, bookingId: null };
    if (status) where.status = String(status);
    if (source) where.source = String(source);
    if (from) where.checkOut = { gt: new Date(String(from)) };
    if (to) where.checkIn = { lt: new Date(String(to)) };
    if (q) {
      const term = String(q).trim();
      where.guestProfile = {
        OR: [{ fullName: { contains: term } }, { phone: { contains: term } }],
      };
    }

    const [total, reservations] = await Promise.all([
      prisma.reservation.count({ where }),
      prisma.reservation.findMany({
        where,
        include: {
          guestProfile: true,
          group: { select: { id: true, reference: true, name: true, status: true } },
          allocations: {
            where: { status: "ACTIVE" },
            include: { roomType: { select: { name: true } }, roomUnit: { select: { code: true } } },
          },
          payments: { orderBy: { createdAt: "asc" } },
          charges: detailInclude.charges,
          outletOrders: {
            where: { status: { in: ["CONFIRMED", "PREPARING", "SERVING"] } },
            select: { id: true },
          },
        },
        orderBy,
        take: limit,
        skip: offset,
      }),
    ]);

    res.json({ total, limit, offset, sortBy, sortOrder, reservations: reservations.map(formatReservation) });
  } catch (err) {
    console.error("[owner.nrms.reservations] list failed", err);
    res.status(500).json({ error: "Failed to load reservations" });
  }
}) as RequestHandler);

const groupMemberInclude = {
  guestProfile: { select: { id: true, fullName: true, phone: true } },
  allocations: {
    where: { status: "ACTIVE" },
    include: { roomType: { select: { name: true } }, roomUnit: { select: { id: true, code: true, housekeepingStatus: true } } },
  },
  payments: { where: { voidedAt: null }, select: { amount: true } },
  charges: {
    where: { voidedAt: null },
    select: { id: true, amount: true, outletOrder: { select: { status: true, settlementMode: true } } },
  },
  outletOrders: {
    where: { voidedAt: null },
    select: { id: true, status: true, settlementMode: true, settlementMethod: true },
  },
};

function deriveGroupStatus(statuses: string[]): string {
  if (statuses.length > 0 && statuses.every((status) => status === "CHECKED_OUT")) return "CHECKED_OUT";
  if (statuses.some((status) => status === "CHECKED_OUT")) return "PARTIALLY_CHECKED_OUT";
  if (statuses.length > 0 && statuses.every((status) => status === "CHECKED_IN")) return "CHECKED_IN";
  if (statuses.some((status) => status === "CHECKED_IN")) return "PARTIALLY_CHECKED_IN";
  return "ACTIVE";
}

async function refreshGroupStatus(db: any, groupId: number): Promise<string> {
  const members = await db.reservation.findMany({ where: { groupId }, select: { status: true } });
  const status = deriveGroupStatus(members.map((member: any) => member.status));
  await db.nrmsReservationGroup.update({ where: { id: groupId }, data: { status } });
  return status;
}

function groupMemberSummary(member: any) {
  return {
    id: member.id,
    status: member.status,
    checkIn: member.checkIn,
    checkOut: member.checkOut,
    currency: member.currency,
    totalAmount: decimal(member.totalAmount),
    amountPaid: decimal(member.amountPaid),
    guestProfile: member.guestProfile,
    rooms: (member.allocations ?? []).map((allocation: any) => ({
      id: allocation.id,
      roomTypeName: allocation.roomType?.name ?? null,
      roomUnitId: allocation.roomUnitId,
      roomUnitCode: allocation.roomUnit?.code ?? null,
    })),
  };
}

function formatGroup(group: any) {
  return {
    id: group.id,
    reference: group.reference,
    name: group.name,
    notes: group.notes,
    status: group.status,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
    memberCount: group._count?.reservations ?? group.reservations?.length ?? 0,
    members: Array.isArray(group.reservations) ? group.reservations.map(groupMemberSummary) : undefined,
  };
}

type GroupBlocker = { code: string; message: string };

function inspectGroupMember(
  member: any,
  action: "CHECK_IN" | "CHECK_OUT",
  options: { overrideRoomReadiness: boolean; verifyCharges: boolean },
) {
  const blockers: GroupBlocker[] = [];
  const requiredChargeIds: number[] = [];
  if (action === "CHECK_IN") {
    if (member.status !== "CONFIRMED") {
      blockers.push({ code: "INVALID_TRANSITION", message: "Only confirmed reservations can be checked in." });
    }
    if (!member.allocations?.length || member.allocations.some((allocation: any) => allocation.roomUnitId == null)) {
      blockers.push({ code: "ROOM_ASSIGNMENT_REQUIRED", message: "Assign a specific room before check-in." });
    }
    if (!options.overrideRoomReadiness) {
      const notReady = (member.allocations ?? []).filter(
        (allocation: any) => allocation.roomUnit && !["CLEAN", "INSPECTED"].includes(allocation.roomUnit.housekeepingStatus),
      );
      if (notReady.length) {
        blockers.push({
          code: "ROOM_NOT_READY",
          message: `${notReady.map((allocation: any) => allocation.roomUnit.code).join(", ")} ${notReady.length === 1 ? "is" : "are"} not ready.`,
        });
      }
    }
  } else {
    if (member.status !== "CHECKED_IN") {
      blockers.push({ code: "INVALID_TRANSITION", message: "Only checked-in stays can be checked out." });
    }
    const openOrders = (member.outletOrders ?? []).filter((order: any) => ["CONFIRMED", "PREPARING", "SERVING"].includes(order.status));
    if (openOrders.length) blockers.push({ code: "OPEN_OUTLET_ORDERS", message: `${openOrders.length} restaurant or bar order(s) remain open.` });
    const unclassified = (member.outletOrders ?? []).filter(
      (order: any) => order.status === "SETTLED" && order.settlementMode === "OUTLET_PAYMENT" && !order.settlementMethod,
    );
    if (unclassified.length) blockers.push({ code: "UNCLASSIFIED_OUTLET_PAYMENTS", message: `${unclassified.length} outlet payment(s) need a payment method.` });
    const amountPaid = (member.payments ?? []).reduce((sum: number, payment: any) => sum + Number(payment.amount ?? 0), 0);
    const chargesTotal = (member.charges ?? []).reduce((sum: number, charge: any) => sum + Number(charge.amount ?? 0), 0);
    const settlement = getCheckoutSettlement(member.totalAmount, chargesTotal, amountPaid);
    if (!settlement.settled) {
      blockers.push({
        code: settlement.code ?? "FOLIO_NOT_SETTLED",
        message: settlement.balance > 0
          ? `Record the remaining payment of ${settlement.balance.toLocaleString()}.`
          : `Resolve the guest credit of ${Math.abs(settlement.balance).toLocaleString()}.`,
      });
    }
    for (const charge of member.charges ?? []) {
      const systemVerified = charge.outletOrder?.status === "POSTED_TO_FOLIO" && charge.outletOrder?.settlementMode === "ROOM_FOLIO";
      if (!systemVerified) requiredChargeIds.push(charge.id);
    }
    if (requiredChargeIds.length && !options.verifyCharges) {
      blockers.push({ code: "CHARGES_NOT_VERIFIED", message: `Verify ${requiredChargeIds.length} active extra charge(s).` });
    }
  }
  return { eligible: blockers.length === 0, blockers, requiredChargeIds };
}

async function loadOwnedGroup(res: Response, ownerId: number, groupId: number) {
  if (!Number.isInteger(groupId) || groupId <= 0) {
    res.status(400).json({ error: "Invalid reservation group id" });
    return null;
  }
  const group = await prisma.nrmsReservationGroup.findFirst({
    where: { id: groupId, ownerId },
    include: { reservations: { include: groupMemberInclude, orderBy: [{ checkIn: "asc" }, { id: "asc" }] }, _count: { select: { reservations: true } } },
  });
  if (!group) {
    res.status(404).json({ error: "Reservation group not found" });
    return null;
  }
  const active = await loadOwnedActiveNrmsProperty(res, ownerId, group.propertyId);
  if (!active) return null;
  return group;
}

/** List operational reservation groups for one property. */
router.get("/property/:propertyId/groups", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const groups = await prisma.nrmsReservationGroup.findMany({
      where: { propertyId: active.property.id as number, ownerId },
      include: { reservations: { include: groupMemberInclude, orderBy: [{ checkIn: "asc" }, { id: "asc" }] }, _count: { select: { reservations: true } } },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 100,
    });
    res.json({ groups: groups.map(formatGroup) });
  } catch (err) {
    console.error("[owner.nrms.reservations] group list failed", err);
    res.status(500).json({ error: "Failed to load reservation groups" });
  }
}) as RequestHandler);

/** Create a group from existing property reservations. */
router.post("/property/:propertyId/groups", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = createGroupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Enter a group name and select at least two reservations", details: parsed.error.flatten() });
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const propertyId = active.property.id as number;
    const reservationIds = [...new Set(parsed.data.reservationIds)];
    if (reservationIds.length < 2) return res.status(400).json({ error: "Select at least two different reservations" });
    const reference = `GRP-${Date.now().toString(36).toUpperCase()}-${generateNrmsRandomCode()}`.slice(0, 32);
    const created = await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, propertyId);
      const members = await tx.reservation.findMany({
        where: { id: { in: reservationIds }, propertyId, ownerId, bookingId: null },
        select: { id: true, status: true, groupId: true },
      });
      if (members.length !== reservationIds.length) throw new Error("NRMS_GROUP_MEMBER_NOT_FOUND");
      if (members.some((member: any) => member.groupId != null)) throw new Error("NRMS_GROUP_MEMBER_ALREADY_ASSIGNED");
      if (members.some((member: any) => ["CANCELLED", "NO_SHOW", "EXPIRED"].includes(member.status))) throw new Error("NRMS_GROUP_MEMBER_TERMINAL");
      const group = await tx.nrmsReservationGroup.create({
        data: {
          propertyId,
          ownerId,
          reference,
          name: sanitizeText(parsed.data.name),
          notes: parsed.data.notes ? sanitizeText(parsed.data.notes) : null,
          status: deriveGroupStatus(members.map((member: any) => member.status)),
          createdById: ownerId,
        },
      });
      const assigned = await tx.reservation.updateMany({ where: { id: { in: reservationIds }, propertyId, ownerId, groupId: null }, data: { groupId: group.id } });
      if (assigned.count !== reservationIds.length) throw new Error("NRMS_GROUP_ASSIGNMENT_RACE");
      await tx.reservationEvent.createMany({
        data: reservationIds.map((reservationId) => ({ reservationId, type: "GROUP_ASSIGNED", actorId: ownerId, data: { groupId: group.id, groupReference: reference, groupName: parsed.data.name } })),
      });
      return group.id;
    }, EXTENDED_TX_OPTIONS);
    const group = await prisma.nrmsReservationGroup.findUnique({
      where: { id: created },
      include: { reservations: { include: groupMemberInclude, orderBy: [{ checkIn: "asc" }, { id: "asc" }] }, _count: { select: { reservations: true } } },
    });
    res.status(201).json({ group: formatGroup(group) });
  } catch (err) {
    if (err instanceof Error && err.message === "NRMS_GROUP_MEMBER_NOT_FOUND") return res.status(400).json({ error: "Every group member must be an NRMS reservation for this property" });
    if (err instanceof Error && err.message === "NRMS_GROUP_MEMBER_ALREADY_ASSIGNED") return res.status(409).json({ error: "One or more selected reservations already belong to a group", code: "GROUP_ALREADY_ASSIGNED" });
    if (err instanceof Error && err.message === "NRMS_GROUP_MEMBER_TERMINAL") return res.status(409).json({ error: "Cancelled, expired or no-show reservations cannot be added to a group" });
    if (err instanceof Error && err.message === "NRMS_GROUP_ASSIGNMENT_RACE") return res.status(409).json({ error: "A selected reservation changed while the group was being created" });
    console.error("[owner.nrms.reservations] group create failed", err);
    res.status(500).json({ error: "Failed to create reservation group" });
  }
}) as RequestHandler);

router.get("/groups/:groupId", (async (req: AuthedRequest, res: Response) => {
  try {
    const group = await loadOwnedGroup(res, req.user!.id, Number(req.params.groupId));
    if (!group) return;
    res.json({ group: formatGroup(group) });
  } catch (err) {
    console.error("[owner.nrms.reservations] group detail failed", err);
    res.status(500).json({ error: "Failed to load reservation group" });
  }
}) as RequestHandler);

router.post("/groups/:groupId/preview", (async (req: AuthedRequest, res: Response) => {
  try {
    const action = req.body?.action === "CHECK_OUT" ? "CHECK_OUT" : req.body?.action === "CHECK_IN" ? "CHECK_IN" : null;
    if (!action) return res.status(400).json({ error: "Choose CHECK_IN or CHECK_OUT" });
    const parsed = groupActionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid group action options" });
    const group = await loadOwnedGroup(res, req.user!.id, Number(req.params.groupId));
    if (!group) return;
    const members = group.reservations.map((member: any) => ({
      reservation: groupMemberSummary(member),
      ...inspectGroupMember(member, action, parsed.data),
    }));
    res.json({ group: formatGroup(group), action, eligibleCount: members.filter((member: any) => member.eligible).length, blockedCount: members.filter((member: any) => !member.eligible).length, members });
  } catch (err) {
    console.error("[owner.nrms.reservations] group preview failed", err);
    res.status(500).json({ error: "Failed to review the group action" });
  }
}) as RequestHandler);

function groupActionFailure(err: unknown): GroupBlocker {
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("NRMS_GUEST_BALANCE_DUE:")) return { code: "GUEST_BALANCE_DUE", message: "The guest folio still has an amount due." };
  if (message.startsWith("NRMS_GUEST_CREDIT_REMAINS:")) return { code: "GUEST_CREDIT_REMAINS", message: "The guest folio has an unresolved credit." };
  if (message.startsWith("NRMS_OPEN_OUTLET_ORDERS:")) return { code: "OPEN_OUTLET_ORDERS", message: "Restaurant or bar orders remain open." };
  if (message.startsWith("NRMS_UNCLASSIFIED_OUTLET_PAYMENTS:")) return { code: "UNCLASSIFIED_OUTLET_PAYMENTS", message: "An outlet payment still needs a payment method." };
  if (message.startsWith("NRMS_CHARGES_NOT_VERIFIED:")) return { code: "CHARGES_NOT_VERIFIED", message: "Active extra charges were not verified." };
  return { code: "ACTION_FAILED", message: "The reservation changed before the operation completed." };
}

function executeGroupAction(action: "CHECK_IN" | "CHECK_OUT") {
  return (async (req: AuthedRequest, res: Response) => {
    try {
      const parsed = groupActionSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "Invalid group action options" });
      const ownerId = req.user!.id;
      const group = await loadOwnedGroup(res, ownerId, Number(req.params.groupId));
      if (!group) return;
      const results: any[] = [];
      for (const existing of group.reservations) {
        try {
          const outcome = await prisma.$transaction(async (tx: any) => {
            await lockPropertyInventory(tx, group.propertyId);
            const member = await tx.reservation.findFirst({
              where: { id: existing.id, groupId: group.id, propertyId: group.propertyId, ownerId, bookingId: null },
              include: groupMemberInclude,
            });
            if (!member) return { changed: false, blockers: [{ code: "MEMBER_NOT_FOUND", message: "Reservation is no longer in this group." }] };
            const inspection = inspectGroupMember(member, action, parsed.data);
            if (!inspection.eligible) return { changed: false, blockers: inspection.blockers };
            if (action === "CHECK_IN") {
              const changed = await tx.reservation.updateMany({
                where: { id: member.id, ownerId, groupId: group.id, status: "CONFIRMED" },
                data: { status: "CHECKED_IN", checkedInAt: new Date() },
              });
              if (changed.count !== 1) throw new Error("NRMS_INVALID_TRANSITION_RACE");
              await tx.reservationEvent.create({
                data: { reservationId: member.id, type: "CHECKED_IN", actorId: ownerId, data: { groupId: group.id, groupReference: group.reference, ...(parsed.data.overrideRoomReadiness ? { overrideRoomReadiness: true } : {}) } },
              });
              return { changed: true };
            }
            const billing = await finalizeNrmsCheckout(tx, member, ownerId, inspection.requiredChargeIds);
            return { changed: true, billing };
          }, EXTENDED_TX_OPTIONS);
          results.push({ reservationId: existing.id, guestName: existing.guestProfile?.fullName ?? "Guest", ...outcome });
        } catch (err) {
          results.push({ reservationId: existing.id, guestName: existing.guestProfile?.fullName ?? "Guest", changed: false, blockers: [groupActionFailure(err)] });
        }
      }
      const status = await refreshGroupStatus(prisma, group.id);
      res.json({ action, groupId: group.id, groupStatus: status, changedCount: results.filter((result) => result.changed).length, blockedCount: results.filter((result) => !result.changed).length, results });
    } catch (err) {
      console.error(`[owner.nrms.reservations] group ${action.toLowerCase()} failed`, err);
      res.status(500).json({ error: `Failed to run group ${action === "CHECK_IN" ? "check-in" : "checkout"}` });
    }
  }) as RequestHandler;
}

router.post("/groups/:groupId/check-in", executeGroupAction("CHECK_IN"));
router.post("/groups/:groupId/check-out", executeGroupAction("CHECK_OUT"));

/**
 * GET /api/owner/nrms/reservations/property/:propertyId/analytics
 * Revenue KPIs for confirmed and completed NRMS stays. Cancelled, draft,
 * held, expired and no-show reservations never contribute to revenue.
 */
router.get("/property/:propertyId/analytics", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;

    const from = req.query.from ? new Date(String(req.query.from)) : null;
    const to = req.query.to ? new Date(String(req.query.to)) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      return res.status(400).json({ error: "Invalid analytics date range" });
    }

    const checkIn = {
      ...(from ? { gte: from } : {}),
      ...(to ? { lt: to } : {}),
    };
    const [reservations, outletPaidOrders] = await Promise.all([prisma.reservation.findMany({
      where: {
        propertyId: active.property.id as number,
        bookingId: null,
        status: { in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] },
        ...(from || to ? { checkIn } : {}),
      },
      select: {
        id: true,
        currency: true,
        totalAmount: true,
        chargesTotal: true,
        amountPaid: true,
        source: true,
        checkIn: true,
        payments: {
          where: { voidedAt: null },
          select: { amount: true, currency: true, method: true },
        },
        charges: {
          where: { voidedAt: null },
          select: { category: true, amount: true },
        },
      },
      orderBy: { checkIn: "asc" },
    }), (prisma as any).nrmsOutletOrder.findMany({
      where: {
        propertyId: active.property.id as number,
        status: "SETTLED",
        settlementMode: "OUTLET_PAYMENT",
        voidedAt: null,
        ...(from || to ? { settledAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      },
      select: { id: true, currency: true, total: true, settledAt: true, settlementMethod: true, outlet: { select: { type: true } } },
      orderBy: { settledAt: "asc" },
    })]);

    type CurrencyAnalytics = {
      currency: string;
      confirmedRevenue: number;
      roomRevenue: number;
      extraChargeRevenue: number;
      extraChargeCount: number;
      collectedRevenue: number;
      amountDue: number;
      reservationCount: number;
      fullyPaidCount: number;
      partiallyPaidCount: number;
      unpaidCount: number;
      monthly: Map<string, { month: string; confirmed: number; collected: number }>;
      sources: Map<string, { source: string; count: number; confirmed: number; collected: number }>;
      paymentMethods: Map<string, { method: string; count: number; amount: number }>;
      chargesByCategory: Map<string, { category: string; count: number; amount: number }>;
    };
    const byCurrency = new Map<string, CurrencyAnalytics>();
    const currencyBucket = (currency: string) => {
      let bucket = byCurrency.get(currency);
      if (!bucket) {
        bucket = {
          currency,
          confirmedRevenue: 0,
          roomRevenue: 0,
          extraChargeRevenue: 0,
          extraChargeCount: 0,
          collectedRevenue: 0,
          amountDue: 0,
          reservationCount: 0,
          fullyPaidCount: 0,
          partiallyPaidCount: 0,
          unpaidCount: 0,
          monthly: new Map(),
          sources: new Map(),
          paymentMethods: new Map(),
          chargesByCategory: new Map(),
        };
        byCurrency.set(currency, bucket);
      }
      return bucket;
    };

    for (const reservation of reservations) {
      const currency = reservation.currency;
      const bucket = currencyBucket(currency);
      const roomRevenue = decimal(reservation.totalAmount) ?? 0;
      const extraChargeRevenue = reservation.charges.reduce((sum, charge) => sum + (decimal(charge.amount) ?? 0), 0);
      const confirmed = roomRevenue + extraChargeRevenue;
      const collected = decimal(reservation.amountPaid) ?? 0;
      const due = Math.max(0, confirmed - collected);
      bucket.confirmedRevenue += confirmed;
      bucket.roomRevenue += roomRevenue;
      bucket.extraChargeRevenue += extraChargeRevenue;
      bucket.extraChargeCount += reservation.charges.length;
      bucket.collectedRevenue += collected;
      bucket.amountDue += due;
      bucket.reservationCount += 1;
      if (confirmed > 0 && due <= 0.005) bucket.fullyPaidCount += 1;
      else if (collected > 0) bucket.partiallyPaidCount += 1;
      else bucket.unpaidCount += 1;

      const month = reservation.checkIn.toISOString().slice(0, 7);
      const monthBucket = bucket.monthly.get(month) ?? { month, confirmed: 0, collected: 0 };
      monthBucket.confirmed += confirmed;
      monthBucket.collected += collected;
      bucket.monthly.set(month, monthBucket);

      const sourceBucket = bucket.sources.get(reservation.source) ?? { source: reservation.source, count: 0, confirmed: 0, collected: 0 };
      sourceBucket.count += 1;
      sourceBucket.confirmed += confirmed;
      sourceBucket.collected += collected;
      bucket.sources.set(reservation.source, sourceBucket);

      for (const payment of reservation.payments) {
        const paymentCurrency = payment.currency;
        const paymentBucket = currencyBucket(paymentCurrency);
        const methodBucket = paymentBucket.paymentMethods.get(payment.method) ?? { method: payment.method, count: 0, amount: 0 };
        methodBucket.count += 1;
        methodBucket.amount += decimal(payment.amount) ?? 0;
        paymentBucket.paymentMethods.set(payment.method, methodBucket);
      }

      for (const charge of reservation.charges) {
        const categoryBucket = bucket.chargesByCategory.get(charge.category) ?? { category: charge.category, count: 0, amount: 0 };
        categoryBucket.count += 1;
        categoryBucket.amount += decimal(charge.amount) ?? 0;
        bucket.chargesByCategory.set(charge.category, categoryBucket);
      }
    }

    for (const order of outletPaidOrders) {
      const currency = order.currency;
      const bucket = currencyBucket(currency);
      const amount = decimal(order.total) ?? 0;
      const category = order.outlet.type === "BAR" ? "BAR" : order.outlet.type === "RESTAURANT" ? "RESTAURANT" : "OTHER";
      bucket.confirmedRevenue += amount;
      bucket.extraChargeRevenue += amount;
      bucket.extraChargeCount += 1;
      bucket.collectedRevenue += amount;

      const categoryBucket = bucket.chargesByCategory.get(category) ?? { category, count: 0, amount: 0 };
      categoryBucket.count += 1;
      categoryBucket.amount += amount;
      bucket.chargesByCategory.set(category, categoryBucket);

      const method = order.settlementMethod || "UNCLASSIFIED_OUTLET_PAYMENT";
      const methodBucket = bucket.paymentMethods.get(method) ?? { method, count: 0, amount: 0 };
      methodBucket.count += 1;
      methodBucket.amount += amount;
      bucket.paymentMethods.set(method, methodBucket);

      const settledAt = order.settledAt ? new Date(order.settledAt) : new Date();
      const month = settledAt.toISOString().slice(0, 7);
      const monthBucket = bucket.monthly.get(month) ?? { month, confirmed: 0, collected: 0 };
      monthBucket.confirmed += amount;
      monthBucket.collected += amount;
      bucket.monthly.set(month, monthBucket);
    }

    const currencies = [...byCurrency.values()].map((bucket) => ({
      currency: bucket.currency,
      confirmedRevenue: Number(bucket.confirmedRevenue.toFixed(2)),
      roomRevenue: Number(bucket.roomRevenue.toFixed(2)),
      extraChargeRevenue: Number(bucket.extraChargeRevenue.toFixed(2)),
      extraChargeCount: bucket.extraChargeCount,
      collectedRevenue: Number(bucket.collectedRevenue.toFixed(2)),
      amountDue: Number(bucket.amountDue.toFixed(2)),
      collectionRate: bucket.confirmedRevenue > 0 ? Number(((bucket.collectedRevenue / bucket.confirmedRevenue) * 100).toFixed(1)) : 0,
      averageReservationValue: bucket.reservationCount > 0 ? Number((bucket.confirmedRevenue / bucket.reservationCount).toFixed(2)) : 0,
      reservationCount: bucket.reservationCount,
      fullyPaidCount: bucket.fullyPaidCount,
      partiallyPaidCount: bucket.partiallyPaidCount,
      unpaidCount: bucket.unpaidCount,
      monthly: [...bucket.monthly.values()].map((entry) => ({ ...entry, confirmed: Number(entry.confirmed.toFixed(2)), collected: Number(entry.collected.toFixed(2)) })),
      sources: [...bucket.sources.values()]
        .map((entry) => ({ ...entry, confirmed: Number(entry.confirmed.toFixed(2)), collected: Number(entry.collected.toFixed(2)) }))
        .sort((a, b) => b.confirmed - a.confirmed),
      paymentMethods: [...bucket.paymentMethods.values()]
        .map((entry) => ({ ...entry, amount: Number(entry.amount.toFixed(2)) }))
        .sort((a, b) => b.amount - a.amount),
      chargesByCategory: [...bucket.chargesByCategory.values()]
        .map((entry) => ({ ...entry, amount: Number(entry.amount.toFixed(2)) }))
        .sort((a, b) => b.amount - a.amount),
    }));

    res.json({
      range: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null },
      reservationCount: reservations.length,
      outletPaidOrderCount: outletPaidOrders.length,
      currencies,
    });
  } catch (err) {
    console.error("[owner.nrms.reservations] analytics failed", err);
    res.status(500).json({ error: "Failed to load revenue analytics" });
  }
}) as RequestHandler);

/**
 * GET /api/owner/nrms/reservations/:id
 */
router.get("/:id", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
    if (!reservation) return;
    res.json({ reservation: formatReservation(reservation) });
  } catch (err) {
    console.error("[owner.nrms.reservations] detail failed", err);
    res.status(500).json({ error: "Failed to load reservation" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/nrms/reservations/property/:propertyId
 * Creates an external reservation: validates capacity, allocates rooms,
 * immediately affects shared availability (doc 6.3 requirements 1-4).
 */
router.post("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const activeProperty = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!activeProperty) return;
    if (NRMS_BILLING_BLOCKING_STATUSES.includes(activeProperty.account.status)) {
      return res.status(402).json(await nrmsBillingBlockPayload(activeProperty.account));
    }
    const property = activeProperty.property;
    const propertyId = property.id as number;

    const parsed = createReservationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid reservation", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    const checkIn = new Date(data.checkIn);
    const checkOut = new Date(data.checkOut);
    if (reservationDateKey(data.checkIn) < dateKeyInNrmsTimeZone(new Date())) {
      return res.status(400).json({ error: "Past check-in dates are not allowed" });
    }
    if (checkOut.getTime() <= checkIn.getTime()) {
      return res.status(400).json({ error: "checkOut must be after checkIn" });
    }
    if (data.status === "HELD" && !data.holdExpiresAt) {
      return res.status(400).json({ error: "A held reservation needs holdExpiresAt" });
    }

    // Guest: reuse an existing property-scoped profile or create one (doc 7.3).
    let guestProfileId = data.guest.guestProfileId ?? null;
    if (guestProfileId) {
      const guest = await prisma.guestProfile.findFirst({ where: { id: guestProfileId, propertyId, ownerId } });
      if (!guest) return res.status(400).json({ error: "Guest profile not found for this property" });
    } else {
      if (!data.guest.fullName) return res.status(400).json({ error: "Guest name is required" });
      const phone = sanitizeText(data.guest.phone);
      const existing = await prisma.guestProfile.findFirst({ where: { propertyId, phone } });
      const guest =
        existing
          ? await prisma.guestProfile.update({
              where: { id: existing.id },
              data: {
                fullName: sanitizeText(data.guest.fullName),
                nationality: data.guest.nationality
                  ? sanitizeText(data.guest.nationality)
                  : existing.nationality,
              },
            })
          : await prisma.guestProfile.create({
              data: {
                propertyId,
                ownerId,
                fullName: sanitizeText(data.guest.fullName),
                phone,
                email: data.guest.email ? sanitizeText(data.guest.email) : null,
                nationality: data.guest.nationality ? sanitizeText(data.guest.nationality) : null,
              },
            });
      guestProfileId = guest.id;
    }

    // Validate rooms belong to this property.
    const typeIds = [...new Set(data.rooms.map((room) => room.roomTypeId))];
    const types = await prisma.roomType.findMany({ where: { id: { in: typeIds }, propertyId }, select: { id: true, currency: true } });
    if (types.length !== typeIds.length) {
      return res.status(400).json({ error: "One or more room types do not belong to this property" });
    }
    const roomCurrencies = [...new Set(types.map((type) => type.currency.trim().toUpperCase()))];
    if (roomCurrencies.length !== 1) {
      return res.status(409).json({ error: "All rooms in one reservation must use the same configured currency" });
    }
    const reservationCurrency = roomCurrencies[0]!;
    if (data.currency && data.currency.toUpperCase() !== reservationCurrency) {
      return res.status(409).json({ error: "Reservation currency must match the selected room type currency" });
    }
    const unitIds = data.rooms.map((room) => room.roomUnitId).filter((id): id is number => id != null);
    if (new Set(unitIds).size !== unitIds.length) {
      return res.status(400).json({ error: "The same physical room cannot be allocated more than once" });
    }
    if (unitIds.length > 0) {
      const units = await prisma.roomUnit.findMany({
        where: { id: { in: unitIds }, propertyId, status: "ACTIVE" },
        select: { id: true, roomTypeId: true },
      });
      const byId = new Map<number, (typeof units)[number]>(units.map((u) => [u.id, u]));
      for (const room of data.rooms) {
        if (room.roomUnitId == null) continue;
        const unit = byId.get(room.roomUnitId);
        if (!unit) return res.status(400).json({ error: `Room unit ${room.roomUnitId} is not an active room of this property` });
        if (unit.roomTypeId !== room.roomTypeId) {
          return res.status(400).json({ error: `Room unit ${room.roomUnitId} does not belong to the selected room type` });
        }
      }
    }

    const attribution = data.source === "DIRECT" ? "OWNER_DIRECT" : "EXTERNAL_RECORDED";

    const result = await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, propertyId);
      const requestedByType = new Map<number, number>();
      for (const room of data.rooms) requestedByType.set(room.roomTypeId, (requestedByType.get(room.roomTypeId) ?? 0) + 1);
      for (const [roomTypeId, requested] of requestedByType) {
        const capacity = await getRoomTypeAvailability(tx, propertyId, roomTypeId, checkIn, checkOut);
        if (capacity.available < requested) {
          return { capacityConflict: { roomTypeId, requested, ...capacity } };
        }
      }
      for (const room of data.rooms) {
        if (room.roomUnitId == null) continue;
        const conflicts = await findUnitConflicts(room.roomUnitId, checkIn, checkOut, { db: tx });
        if (conflicts.length > 0) {
          return { conflict: { roomUnitId: room.roomUnitId, conflicts } };
        }
      }

      const reservation = await tx.reservation.create({
        data: {
          propertyId,
          ownerId,
          guestProfileId,
          source: data.source,
          attribution,
          externalRef: data.externalRef ? sanitizeText(data.externalRef) : null,
          status: data.status,
          holdExpiresAt: data.status === "HELD" ? new Date(data.holdExpiresAt!) : null,
          checkIn,
          checkOut,
          adults: data.adults,
          children: data.children,
          currency: reservationCurrency,
          roomRate: data.roomRate ?? null,
          discountAmount: data.discountAmount ?? 0,
          taxAmount: data.taxAmount ?? 0,
          totalAmount: data.totalAmount ?? 0,
          depositAmount: data.depositAmount ?? 0,
          confirmedAt: data.status === "CONFIRMED" ? new Date() : null,
          notes: data.notes ? sanitizeText(data.notes) : null,
          createdById: ownerId,
        },
      });

      await tx.reservationRoomAllocation.createMany({
        data: data.rooms.map((room) => ({
          reservationId: reservation.id,
          roomTypeId: room.roomTypeId,
          roomUnitId: room.roomUnitId ?? null,
          startDate: checkIn,
          endDate: checkOut,
        })),
      });

      await tx.reservationEvent.create({
        data: {
          reservationId: reservation.id,
          type: "CREATED",
          actorId: ownerId,
          data: { source: data.source, status: data.status, rooms: data.rooms },
        },
      });

      return { reservationId: reservation.id };
    }, EXTENDED_TX_OPTIONS);

    if ("conflict" in result && result.conflict) {
      return res.status(409).json({
        error: "The selected room is not available for these dates",
        code: "ROOM_CONFLICT",
        conflict: result.conflict,
      });
    }
    if ("capacityConflict" in result && result.capacityConflict) {
      return res.status(409).json({
        error: "The selected room type has insufficient availability for these dates",
        code: "ROOM_TYPE_CAPACITY_CONFLICT",
        conflict: result.capacityConflict,
      });
    }

    const created = await prisma.reservation.findUnique({ where: { id: (result as any).reservationId }, include: detailInclude });
    res.status(201).json({ reservation: formatReservation(created) });
  } catch (err) {
    console.error("[owner.nrms.reservations] create failed", err);
    res.status(500).json({ error: "Failed to create reservation" });
  }
}) as RequestHandler);

/**
 * PATCH /api/owner/nrms/reservations/:id
 * Edits dates/pricing/notes before check-in, with an audit trail (doc 7.3).
 * Date changes re-validate every active room allocation.
 */
router.patch("/:id", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
    if (!reservation) return;
    if (!EDITABLE_STATUSES.includes(reservation.status)) {
      return res.status(409).json({ error: `A ${reservation.status.toLowerCase()} reservation cannot be edited` });
    }
    const parsed = editReservationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid update", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    if (data.checkIn && reservationDateKey(data.checkIn) < dateKeyInNrmsTimeZone(new Date())) {
      return res.status(400).json({ error: "Past check-in dates are not allowed" });
    }
    const checkIn = data.checkIn ? new Date(data.checkIn) : reservation.checkIn;
    const checkOut = data.checkOut ? new Date(data.checkOut) : reservation.checkOut;
    if (checkOut.getTime() <= checkIn.getTime()) {
      return res.status(400).json({ error: "checkOut must be after checkIn" });
    }
    const datesChanged = checkIn.getTime() !== reservation.checkIn.getTime() || checkOut.getTime() !== reservation.checkOut.getTime();

    const result = await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, reservation.propertyId);
      if (datesChanged) {
        const active = reservation.allocations.filter((a: any) => a.status === "ACTIVE");
        const requestedByType = new Map<number, number>();
        for (const allocation of active) requestedByType.set(allocation.roomTypeId, (requestedByType.get(allocation.roomTypeId) ?? 0) + 1);
        for (const [roomTypeId, requested] of requestedByType) {
          const capacity = await getRoomTypeAvailability(tx, reservation.propertyId, roomTypeId, checkIn, checkOut, {
            excludeReservationId: reservation.id,
          });
          if (capacity.available < requested) return { capacityConflict: { roomTypeId, requested, ...capacity } };
        }
        for (const allocation of reservation.allocations.filter((a: any) => a.status === "ACTIVE" && a.roomUnitId != null)) {
          const conflicts = await findUnitConflicts(allocation.roomUnitId, checkIn, checkOut, {
            excludeReservationId: reservation.id,
            db: tx,
          });
          if (conflicts.length > 0) return { conflict: { roomUnitId: allocation.roomUnitId, conflicts } };
        }
        await tx.reservationRoomAllocation.updateMany({
          where: { reservationId: reservation.id, status: "ACTIVE" },
          data: { startDate: checkIn, endDate: checkOut },
        });
      }
      await tx.reservation.update({
        where: { id: reservation.id },
        data: {
          checkIn,
          checkOut,
          ...(data.adults !== undefined ? { adults: data.adults } : {}),
          ...(data.children !== undefined ? { children: data.children } : {}),
          ...(data.roomRate !== undefined ? { roomRate: data.roomRate } : {}),
          ...(data.discountAmount !== undefined ? { discountAmount: data.discountAmount } : {}),
          ...(data.taxAmount !== undefined ? { taxAmount: data.taxAmount } : {}),
          ...(data.totalAmount !== undefined ? { totalAmount: data.totalAmount } : {}),
          ...(data.depositAmount !== undefined ? { depositAmount: data.depositAmount } : {}),
          ...(data.externalRef !== undefined ? { externalRef: data.externalRef ? sanitizeText(data.externalRef) : null } : {}),
          ...(data.notes !== undefined ? { notes: data.notes ? sanitizeText(data.notes) : null } : {}),
        },
      });
      await tx.reservationEvent.create({
        data: { reservationId: reservation.id, type: "EDITED", actorId: ownerId, data: parsed.data as object },
      });
      return {};
    }, EXTENDED_TX_OPTIONS);

    if ("conflict" in result && result.conflict) {
      return res.status(409).json({ error: "The new dates conflict with another stay", code: "ROOM_CONFLICT", conflict: result.conflict });
    }
    if ("capacityConflict" in result && result.capacityConflict) {
      return res.status(409).json({ error: "The selected room type has insufficient availability", code: "ROOM_TYPE_CAPACITY_CONFLICT", conflict: result.capacityConflict });
    }
    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: detailInclude });
    res.json({ reservation: formatReservation(updated) });
  } catch (err) {
    console.error("[owner.nrms.reservations] edit failed", err);
    res.status(500).json({ error: "Failed to update reservation" });
  }
}) as RequestHandler);

/** Shared transition helper: guards allowed source statuses and writes the audit event. */
function transition(
  eventType: string,
  allowedFrom: string[],
  buildData: (reason: string | null) => Record<string, unknown>,
  opts?: { releaseAllocations?: boolean; requireAssignedRooms?: boolean; requireRoomsReady?: boolean },
) {
  return (async (req: AuthedRequest, res: Response) => {
    try {
      const ownerId = req.user!.id;
      const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
      if (!reservation) return;
      if (!allowedFrom.includes(reservation.status)) {
        return res.status(409).json({
          error: `Cannot ${eventType.toLowerCase().replace(/_/g, " ")} a ${reservation.status.toLowerCase()} reservation`,
          code: "INVALID_TRANSITION",
          from: reservation.status,
        });
      }
      if (opts?.requireAssignedRooms) {
        const activeAllocations = reservation.allocations.filter((allocation: any) => allocation.status === "ACTIVE");
        if (activeAllocations.length === 0 || activeAllocations.some((allocation: any) => allocation.roomUnitId == null)) {
          return res.status(409).json({
            error: "Assign a specific room to every active allocation before check-in",
            code: "ROOM_ASSIGNMENT_REQUIRED",
          });
        }
      }
      // Housekeeping gate: a guest must not move into a room that is not
      // clean. The front desk can override knowingly (overrideRoomReadiness).
      if (opts?.requireRoomsReady && req.body?.overrideRoomReadiness !== true) {
        const unitIds = reservation.allocations
          .filter((allocation: any) => allocation.status === "ACTIVE" && allocation.roomUnitId != null)
          .map((allocation: any) => allocation.roomUnitId);
        if (unitIds.length) {
          const notReady = await prisma.roomUnit.findMany({
            where: { id: { in: unitIds }, housekeepingStatus: { notIn: ["CLEAN", "INSPECTED"] } },
            select: { id: true, code: true, housekeepingStatus: true },
          });
          if (notReady.length) {
            const codes = notReady.map((unit) => unit.code).join(", ");
            return res.status(409).json({
              error: notReady.length === 1
                ? `Room ${codes} has not been cleaned yet. Ask housekeeping to finish it or confirm the override to check the guest in anyway.`
                : `Rooms ${codes} have not been cleaned yet. Ask housekeeping to finish them or confirm the override to check the guest in anyway.`,
              code: "ROOM_NOT_READY",
              rooms: notReady,
            });
          }
        }
      }
      const parsed = reasonSchema.safeParse(req.body ?? {});
      const reason = parsed.success && parsed.data.reason ? sanitizeText(parsed.data.reason) : null;

      await prisma.$transaction(async (tx: any) => {
        await lockPropertyInventory(tx, reservation.propertyId);
        if (opts?.requireAssignedRooms) {
          const activeAllocations = await tx.reservationRoomAllocation.findMany({
            where: { reservationId: reservation.id, status: "ACTIVE" },
            select: { roomUnitId: true },
          });
          if (activeAllocations.length === 0 || activeAllocations.some((allocation: any) => allocation.roomUnitId == null)) {
            throw new Error("NRMS_ROOM_ASSIGNMENT_REQUIRED");
          }
        }
        const changed = await tx.reservation.updateMany({
          where: { id: reservation.id, ownerId, status: { in: allowedFrom } },
          data: buildData(reason),
        });
        if (changed.count !== 1) throw new Error("NRMS_INVALID_TRANSITION_RACE");
        if (opts?.releaseAllocations) {
          await tx.reservationRoomAllocation.updateMany({
            where: { reservationId: reservation.id, status: "ACTIVE" },
            data: { status: "RELEASED" },
          });
        }
        const eventData = {
          ...(reason ? { reason } : {}),
          ...(eventType === "CHECKED_IN" && req.body?.overrideRoomReadiness === true ? { overrideRoomReadiness: true } : {}),
        };
        await tx.reservationEvent.create({
          data: { reservationId: reservation.id, type: eventType, actorId: ownerId, data: Object.keys(eventData).length ? eventData : undefined },
        });
      });

      const updated = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: detailInclude });
      res.json({ reservation: formatReservation(updated) });
    } catch (err) {
      if (err instanceof Error && err.message === "NRMS_ROOM_ASSIGNMENT_REQUIRED") {
        return res.status(409).json({
          error: "Assign a specific room to every active allocation before check-in",
          code: "ROOM_ASSIGNMENT_REQUIRED",
        });
      }
      console.error(`[owner.nrms.reservations] ${eventType} failed`, err);
      res.status(500).json({ error: "Failed to update reservation" });
    }
  }) as RequestHandler;
}

/** POST /:id/confirm - HELD/DRAFT -> CONFIRMED */
router.post("/:id/confirm", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
    if (!reservation) return;
    if (!["DRAFT", "HELD"].includes(reservation.status)) return res.status(409).json({ error: "Reservation cannot be confirmed", code: "INVALID_TRANSITION" });
    const result = await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, reservation.propertyId);
      const active = reservation.allocations.filter((a: any) => a.status === "ACTIVE");
      const byType = new Map<number, number>();
      for (const allocation of active) byType.set(allocation.roomTypeId, (byType.get(allocation.roomTypeId) ?? 0) + 1);
      for (const [roomTypeId, requested] of byType) {
        const capacity = await getRoomTypeAvailability(tx, reservation.propertyId, roomTypeId, reservation.checkIn, reservation.checkOut, { excludeReservationId: reservation.id });
        if (capacity.available < requested) return { conflict: { roomTypeId, requested, ...capacity } };
      }
      for (const allocation of active.filter((a: any) => a.roomUnitId != null)) {
        const conflicts = await findUnitConflicts(allocation.roomUnitId, reservation.checkIn, reservation.checkOut, { excludeReservationId: reservation.id, db: tx });
        if (conflicts.length) return { conflict: { roomUnitId: allocation.roomUnitId, conflicts } };
      }
      const changed = await tx.reservation.updateMany({ where: { id: reservation.id, status: { in: ["DRAFT", "HELD"] } }, data: { status: "CONFIRMED", confirmedAt: new Date(), holdExpiresAt: null } });
      if (changed.count !== 1) return { stale: true };
      await tx.reservationEvent.create({ data: { reservationId: reservation.id, type: "CONFIRMED", actorId: ownerId } });
      return { ok: true };
    }, EXTENDED_TX_OPTIONS);
    if ("conflict" in result) return res.status(409).json({ error: "Reservation inventory is no longer available", code: "ROOM_CONFLICT", conflict: result.conflict });
    if ("stale" in result) return res.status(409).json({ error: "Reservation changed before confirmation", code: "INVALID_TRANSITION" });
    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: detailInclude });
    res.json({ reservation: formatReservation(updated) });
  } catch (err) {
    console.error("[owner.nrms.reservations] confirm failed", err);
    res.status(500).json({ error: "Failed to confirm reservation" });
  }
}) as RequestHandler);

/** POST /:id/check-in - CONFIRMED -> CHECKED_IN (owner-authorized, doc 7.4) */
router.post(
  "/:id/check-in",
  transition("CHECKED_IN", ["CONFIRMED"], () => ({ status: "CHECKED_IN", checkedInAt: new Date() }), { requireAssignedRooms: true, requireRoomsReady: true }),
);

/**
 * POST /:id/check-out - CHECKED_IN -> CHECKED_OUT. Closes the stay (doc 7.4).
 * Phase 3 will emit the billable usage event exactly here (doc 8.3).
 */
router.post("/:id/check-out", (async (req: AuthedRequest, res: Response) => {
  try {
    const verification = checkoutVerificationSchema.safeParse(req.body ?? {});
    if (!verification.success) return res.status(400).json({ error: "Invalid charge verification list" });
    const ownerId = req.user!.id;
    const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
    if (!reservation) return;
    if (reservation.status !== "CHECKED_IN") return res.status(409).json({ error: "Only checked-in stays can be checked out", code: "INVALID_TRANSITION" });
    const billing = await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, reservation.propertyId);
      return finalizeNrmsCheckout(tx, reservation, ownerId, verification.data.verifiedChargeIds);
    }, EXTENDED_TX_OPTIONS);
    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: detailInclude });
    res.json({ reservation: formatReservation(updated), billing });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NRMS_GUEST_BALANCE_DUE:")) {
      const balanceDue = Number(err.message.split(":")[1] ?? 0);
      return res.status(409).json({
        error: `Checkout blocked. Record the remaining guest payment of ${balanceDue.toLocaleString()} before checkout.`,
        code: "GUEST_BALANCE_DUE",
        balanceDue,
      });
    }
    if (err instanceof Error && err.message.startsWith("NRMS_GUEST_CREDIT_REMAINS:")) {
      const guestCredit = Math.abs(Number(err.message.split(":")[1] ?? 0));
      return res.status(409).json({
        error: `Checkout blocked. Resolve the guest credit of ${guestCredit.toLocaleString()} before checkout.`,
        code: "GUEST_CREDIT_REMAINS",
        guestCredit,
      });
    }
    if (err instanceof Error && err.message.startsWith("NRMS_OPEN_OUTLET_ORDERS:")) {
      const openOrderCount = Number(err.message.split(":")[1] ?? 0);
      return res.status(409).json({
        error: `Checkout blocked. ${openOrderCount} restaurant or bar ${openOrderCount === 1 ? "order is" : "orders are"} still open. Complete or cancel every order before checkout.`,
        code: "OPEN_OUTLET_ORDERS",
        openOrderCount,
      });
    }
    if (err instanceof Error && err.message.startsWith("NRMS_UNCLASSIFIED_OUTLET_PAYMENTS:")) {
      const unclassifiedPaymentCount = Number(err.message.split(":")[1] ?? 0);
      return res.status(409).json({
        error: `Checkout blocked. Classify the payment method for ${unclassifiedPaymentCount} settled outlet ${unclassifiedPaymentCount === 1 ? "order" : "orders"} before checkout.`,
        code: "UNCLASSIFIED_OUTLET_PAYMENTS",
        unclassifiedPaymentCount,
      });
    }
    if (err instanceof Error && err.message.startsWith("NRMS_CHARGES_NOT_VERIFIED:")) {
      const missingChargeIds = err.message.split(":")[1]?.split(",").map(Number).filter(Number.isInteger) ?? [];
      return res.status(409).json({
        error: `Checkout blocked. Verify every active extra charge individually. ${missingChargeIds.length} ${missingChargeIds.length === 1 ? "charge remains" : "charges remain"} unchecked.`,
        code: "CHARGES_NOT_VERIFIED",
        missingChargeIds,
      });
    }
    if (err instanceof Error && err.message === "NRMS_INVALID_TRANSITION_RACE") {
      return res.status(409).json({ error: "Reservation changed before checkout confirmation", code: "INVALID_TRANSITION" });
    }
    console.error("[owner.nrms.reservations] checkout failed", err);
    res.status(500).json({ error: "Failed to check out reservation" });
  }
}) as RequestHandler);

/** POST /:id/cancel - releases inventory; cancelled stays never bill (doc 8.2) */
router.post(
  "/:id/cancel",
  transition("CANCELLED", ["DRAFT", "HELD", "CONFIRMED"], (reason) => ({
    status: "CANCELLED",
    cancelledAt: new Date(),
    cancelReason: reason,
  }), { releaseAllocations: true }),
);

/** POST /:id/no-show - CONFIRMED -> NO_SHOW; releases inventory, never bills */
router.post(
  "/:id/no-show",
  transition("NO_SHOW", ["CONFIRMED"], () => ({ status: "NO_SHOW", noShowAt: new Date() }), { releaseAllocations: true }),
);

/**
 * POST /:id/move-room
 * Releases the old allocation and creates a new one so history is preserved
 * (doc 7.4: record room assignment changes).
 */
router.post("/:id/move-room", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
    if (!reservation) return;
    if (!["CONFIRMED", "CHECKED_IN", "HELD"].includes(reservation.status)) {
      return res.status(409).json({ error: `Cannot move rooms on a ${reservation.status.toLowerCase()} reservation` });
    }
    const parsed = moveRoomSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid room move", details: parsed.error.flatten() });
    }
    const { allocationId, roomUnitId, reason } = parsed.data;

    const allocation = reservation.allocations.find((a: any) => a.id === allocationId && a.status === "ACTIVE");
    if (!allocation) return res.status(404).json({ error: "Active allocation not found on this reservation" });

    const unit = await prisma.roomUnit.findFirst({
      where: { id: roomUnitId, propertyId: reservation.propertyId, status: "ACTIVE" },
      select: { id: true, roomTypeId: true, code: true },
    });
    if (!unit) return res.status(400).json({ error: "Target room is not an active room of this property" });

    const result = await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, reservation.propertyId);
      const conflicts = await findUnitConflicts(roomUnitId, allocation.startDate, allocation.endDate, {
        excludeReservationId: reservation.id,
        db: tx,
      });
      if (conflicts.length > 0) return { conflict: { roomUnitId, conflicts } };

      await tx.reservationRoomAllocation.update({ where: { id: allocation.id }, data: { status: "RELEASED" } });
      const next = await tx.reservationRoomAllocation.create({
        data: {
          reservationId: reservation.id,
          roomTypeId: unit.roomTypeId,
          roomUnitId: unit.id,
          startDate: allocation.startDate,
          endDate: allocation.endDate,
        },
      });
      await tx.reservationEvent.create({
        data: {
          reservationId: reservation.id,
          type: "ROOM_MOVED",
          actorId: ownerId,
          data: {
            fromAllocationId: allocation.id,
            fromRoomUnitId: allocation.roomUnitId,
            toRoomUnitId: unit.id,
            toRoomCode: unit.code,
            ...(reason ? { reason: sanitizeText(reason) } : {}),
          },
        },
      });
      return { allocationId: next.id };
    }, EXTENDED_TX_OPTIONS);

    if ("conflict" in result && result.conflict) {
      return res.status(409).json({ error: "The target room is not available for these dates", code: "ROOM_CONFLICT", conflict: result.conflict });
    }
    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: detailInclude });
    res.json({ reservation: formatReservation(updated) });
  } catch (err) {
    console.error("[owner.nrms.reservations] move-room failed", err);
    res.status(500).json({ error: "Failed to move room" });
  }
}) as RequestHandler);

/**
 * POST /:id/payments
 * Records an external payment (doc 7.7: NRMS records, it does not collect).
 */
router.post("/:id/payments", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
    if (!reservation) return;
    if (["CANCELLED", "EXPIRED"].includes(reservation.status)) {
      return res.status(409).json({ error: `Cannot record a payment on a ${reservation.status.toLowerCase()} reservation` });
    }
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payment", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const outstanding = computeOutstanding(reservation.totalAmount, reservation.chargesTotal, reservation.amountPaid);
    if (outstanding <= 0) {
      return res.status(409).json({ error: "This reservation is already paid in full", code: "PAYMENT_COMPLETE" });
    }
    if (data.amount > outstanding) {
      return res.status(400).json({ error: `Payment cannot exceed the outstanding balance of ${reservation.currency} ${outstanding.toLocaleString()}`, code: "PAYMENT_EXCEEDS_BALANCE" });
    }

    await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, reservation.propertyId);
      const current = await tx.reservation.findUnique({
        where: { id: reservation.id },
        select: { totalAmount: true, chargesTotal: true, amountPaid: true },
      });
      const currentOutstanding = current ? computeOutstanding(current.totalAmount, current.chargesTotal, current.amountPaid) : 0;
      if (currentOutstanding <= 0) throw new Error("NRMS_PAYMENT_COMPLETE");
      if (data.amount > currentOutstanding) throw new Error(`NRMS_PAYMENT_EXCEEDS_BALANCE:${currentOutstanding}`);
      await tx.externalPaymentRecord.create({
        data: {
          reservationId: reservation.id,
          amount: data.amount,
          currency: reservation.currency,
          method: data.method,
          reference: data.reference ? sanitizeText(data.reference) : null,
          note: data.note ? sanitizeText(data.note) : null,
          recordedById: ownerId,
        },
      });
      const amountPaid = await recomputeAmountPaid(tx, reservation.id);
      const pendingRequests = await tx.nrmsGuestPaymentRequest.findMany({ where: { reservationId: reservation.id, status: "PENDING" } });
      let directDepositSettled = false;
      for (const request of pendingRequests) {
        if (Number(amountPaid) >= Number(request.amount)) {
          await tx.nrmsGuestPaymentRequest.update({ where: { id: request.id }, data: { status: "SETTLED", settledAt: new Date() } });
          if (request.kind === "DEPOSIT") directDepositSettled = true;
        }
      }
      if (directDepositSettled && reservation.status === "HELD") {
        await tx.reservation.update({ where: { id: reservation.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), holdExpiresAt: null } });
        await tx.reservationEvent.create({ data: { reservationId: reservation.id, type: "CONFIRMED", actorId: ownerId, data: { reason: "DIRECT_DEPOSIT_RECORDED" } } });
      }
      await tx.reservationEvent.create({
        data: {
          reservationId: reservation.id,
          type: "PAYMENT_RECORDED",
          actorId: ownerId,
          data: { amount: data.amount, method: data.method },
        },
      });
    });

    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: detailInclude });
    res.status(201).json({ reservation: formatReservation(updated) });
  } catch (err) {
    if (err instanceof Error && err.message === "NRMS_PAYMENT_COMPLETE") {
      return res.status(409).json({ error: "This reservation is already paid in full", code: "PAYMENT_COMPLETE" });
    }
    if (err instanceof Error && err.message.startsWith("NRMS_PAYMENT_EXCEEDS_BALANCE:")) {
      const outstanding = Number(err.message.split(":")[1]);
      return res.status(400).json({ error: `Payment cannot exceed the outstanding balance of ${outstanding.toLocaleString()}`, code: "PAYMENT_EXCEEDS_BALANCE" });
    }
    console.error("[owner.nrms.reservations] payment failed", err);
    res.status(500).json({ error: "Failed to record payment" });
  }
}) as RequestHandler);

/**
 * POST /:id/payments/:paymentId/void
 * Payments are immutable: corrections void the row and keep it (doc 7.7).
 */
router.post("/:id/payments/:paymentId/void", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
    if (!reservation) return;
    const paymentId = Number(req.params.paymentId);
    const payment = reservation.payments.find((p: any) => p.id === paymentId);
    if (!payment) return res.status(404).json({ error: "Payment not found on this reservation" });
    if (payment.voidedAt) return res.status(409).json({ error: "Payment is already voided" });
    const parsed = reasonSchema.safeParse(req.body ?? {});
    const reason = parsed.success && parsed.data.reason ? sanitizeText(parsed.data.reason) : null;

    await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, reservation.propertyId);
      await tx.externalPaymentRecord.update({
        where: { id: paymentId },
        data: { voidedAt: new Date(), voidReason: reason },
      });
      const amountPaid = await recomputeAmountPaid(tx, reservation.id);
      const settledRequests = await tx.nrmsGuestPaymentRequest.findMany({ where: { reservationId: reservation.id, status: "SETTLED" } });
      for (const request of settledRequests) {
        if (Number(amountPaid) < Number(request.amount)) await tx.nrmsGuestPaymentRequest.update({ where: { id: request.id }, data: { status: "PENDING", settledAt: null } });
      }
      await tx.reservationEvent.create({
        data: {
          reservationId: reservation.id,
          type: "PAYMENT_VOIDED",
          actorId: ownerId,
          data: { paymentId, ...(reason ? { reason } : {}) },
        },
      });
    });

    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: detailInclude });
    res.json({ reservation: formatReservation(updated) });
  } catch (err) {
    console.error("[owner.nrms.reservations] void payment failed", err);
    res.status(500).json({ error: "Failed to void payment" });
  }
}) as RequestHandler);

/**
 * POST /:id/charges
 * Posts an extra guest charge to the folio (restaurant, laundry, minibar...).
 * Charges are in-stay consumption, so only CONFIRMED and CHECKED_IN stays
 * accept them; payments stay recordable post-checkout to settle the balance.
 */
router.post("/:id/charges", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
    if (!reservation) return;
    if (!["CONFIRMED", "CHECKED_IN"].includes(reservation.status)) {
      return res.status(409).json({ error: `Cannot post a charge on a ${reservation.status.toLowerCase().replace(/_/g, " ")} reservation`, code: "CHARGE_INVALID_STATUS" });
    }
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid charge", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, reservation.propertyId);
      const current = await tx.reservation.findUnique({ where: { id: reservation.id }, select: { status: true } });
      if (!current || !["CONFIRMED", "CHECKED_IN"].includes(current.status)) throw new Error("NRMS_CHARGE_INVALID_STATUS");
      const charge = await tx.reservationCharge.create({
        data: {
          reservationId: reservation.id,
          category: data.category,
          description: data.description ? sanitizeText(data.description) : null,
          amount: data.amount,
          currency: reservation.currency,
          postedById: ownerId,
        },
      });
      await recomputeChargesTotal(tx, reservation.id);
      await tx.reservationEvent.create({
        data: {
          reservationId: reservation.id,
          type: "CHARGE_POSTED",
          actorId: ownerId,
          data: { chargeId: charge.id, category: data.category, amount: data.amount },
        },
      });
    });

    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: detailInclude });
    res.status(201).json({ reservation: formatReservation(updated) });
  } catch (err) {
    if (err instanceof Error && err.message === "NRMS_CHARGE_INVALID_STATUS") {
      return res.status(409).json({ error: "Charges can only be posted on confirmed or checked-in reservations", code: "CHARGE_INVALID_STATUS" });
    }
    console.error("[owner.nrms.reservations] post charge failed", err);
    res.status(500).json({ error: "Failed to post charge" });
  }
}) as RequestHandler);

/**
 * POST /:id/charges/:chargeId/void
 * Charges are immutable: corrections void the row and keep it, mirroring
 * payment voids. No status restriction: a mispost must be correctable even
 * after checkout, and voiding only ever reduces the balance.
 */
router.post("/:id/charges/:chargeId/void", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const reservation = await loadOwnedReservation(res, ownerId, Number(req.params.id));
    if (!reservation) return;
    const chargeId = Number(req.params.chargeId);
    const charge = (reservation as any).charges.find((c: any) => c.id === chargeId);
    if (!charge) return res.status(404).json({ error: "Charge not found on this reservation" });
    if (charge.voidedAt) return res.status(409).json({ error: "Charge is already voided" });
    const parsed = reasonSchema.safeParse(req.body ?? {});
    const reason = parsed.success && parsed.data.reason ? sanitizeText(parsed.data.reason) : null;

    await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, reservation.propertyId);
      await tx.reservationCharge.update({
        where: { id: chargeId },
        data: { voidedAt: new Date(), voidReason: reason },
      });
      await recomputeChargesTotal(tx, reservation.id);
      await tx.reservationEvent.create({
        data: {
          reservationId: reservation.id,
          type: "CHARGE_VOIDED",
          actorId: ownerId,
          data: { chargeId, ...(reason ? { reason } : {}) },
        },
      });
    });

    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id }, include: detailInclude });
    res.json({ reservation: formatReservation(updated) });
  } catch (err) {
    console.error("[owner.nrms.reservations] void charge failed", err);
    res.status(500).json({ error: "Failed to void charge" });
  }
}) as RequestHandler);

/**
 * GET /:id/invoice.pdf
 * On-demand guest invoice: room stay, extra charges, payments, balance due.
 * Nothing is persisted; the number is derived from the reservation id.
 */
router.get("/:id/invoice.pdf", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid reservation id" });
    const reservation = await prisma.reservation.findFirst({
      where: { id, ownerId },
      include: {
        ...detailInclude,
        property: { select: { title: true, regionName: true, district: true, city: true } },
      },
    });
    if (!reservation) return res.status(404).json({ error: "Reservation not found" });
    if (reservation.bookingId != null) {
      return res.status(409).json({ error: "NoLSAF bookings are managed through the marketplace booking flow", code: "MARKETPLACE_BOOKING" });
    }
    if (!["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(reservation.status)) {
      return res.status(409).json({ error: "An invoice is only available for confirmed, checked-in or checked-out stays", code: "INVOICE_INVALID_STATUS" });
    }

    const location = [reservation.property.city, reservation.property.district, reservation.property.regionName]
      .filter(Boolean)
      .join(", ");
    const activeAllocations = reservation.allocations.filter((a: any) => a.status === "ACTIVE");
    const amountPaid = decimal(reservation.amountPaid) ?? 0;
    const balanceDue = computeGuestBalance(reservation.totalAmount, reservation.chargesTotal, reservation.amountPaid);
    const validPayments = reservation.payments.filter((payment) => !payment.voidedAt);
    const validOutletPayments = reservation.outletOrders.filter((order: any) =>
      order.settlementMode === "OUTLET_PAYMENT" && order.status === "SETTLED" && !order.voidedAt,
    );
    const outletPaidTotal = validOutletPayments.reduce((sum: number, order: any) => sum + (decimal(order.total) ?? 0), 0);
    const settled = balanceDue <= 0 && Number(amountPaid) + outletPaidTotal > 0;
    const settlementDates = [
      ...validPayments.map((payment) => payment.createdAt),
      ...validOutletPayments.map((order: any) => order.settledAt || order.createdAt),
    ];
    const issuedAt = settled && settlementDates.length
      ? settlementDates.reduce((latest, date) => date > latest ? date : latest, settlementDates[0])
      : reservation.createdAt;
    let documentNumber = reservation.receiptNumber;
    if (!documentNumber) {
      const primaryRoom = activeAllocations[0];
      const candidate = buildNrmsDocumentNumber(
        reservation.id,
        new Date(),
        primaryRoom?.roomType?.name ?? "Room",
        primaryRoom?.roomUnit?.code ?? "00",
        generateNrmsRandomCode(),
      );
      const assigned = await prisma.reservation.updateMany({
        where: { id: reservation.id, ownerId, receiptNumber: null },
        data: { receiptNumber: candidate },
      });
      if (assigned.count) {
        documentNumber = candidate;
      } else {
        const persisted = await prisma.reservation.findUnique({
          where: { id: reservation.id },
          select: { receiptNumber: true },
        });
        documentNumber = persisted?.receiptNumber ?? null;
      }
    }
    if (!documentNumber) throw new Error("Failed to assign the NRMS receipt number");
    const pdf = await generateNrmsInvoicePdf({
      invoiceNumber: documentNumber,
      issuedAt,
      reservationId: reservation.id,
      status: reservation.status,
      propertyName: reservation.property.title,
      propertyLocation: location || null,
      guestName: reservation.guestProfile?.fullName ?? "Guest",
      guestPhone: reservation.guestProfile?.phone ?? null,
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      rooms: activeAllocations.map((a: any) => ({ label: a.roomUnit?.code ?? a.roomType?.name ?? "Room" })),
      currency: reservation.currency,
      roomTotal: decimal(reservation.totalAmount) ?? 0,
      charges: (reservation as any).charges
        .filter((c: any) => !c.voidedAt)
        .map((c: any) => ({ date: c.createdAt, category: c.category, description: c.description, amount: decimal(c.amount) ?? 0 })),
      payments: reservation.payments
        .filter((p: any) => !p.voidedAt)
        .map((p: any) => ({ date: p.createdAt, method: p.method, reference: p.reference, amount: decimal(p.amount) ?? 0 })),
      outletPayments: validOutletPayments.map((order: any) => ({
        date: order.settledAt || order.createdAt,
        orderNumber: order.orderNumber,
        outlet: order.outlet.name,
        method: order.settlementMethod,
        items: order.items.map((item: any) => `${item.quantity}× ${item.nameSnapshot}`).join(", "),
        amount: decimal(order.total) ?? 0,
      })),
      chargesTotal: decimal(reservation.chargesTotal) ?? 0,
      amountPaid,
      balanceDue,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${documentNumber}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("[owner.nrms.reservations] invoice pdf failed", err);
    res.status(500).json({ error: "Failed to generate invoice" });
  }
}) as RequestHandler);

export default router;

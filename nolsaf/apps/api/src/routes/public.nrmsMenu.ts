// apps/api/src/routes/public.nrmsMenu.ts
//
// Token-scoped guest surface for QR self-ordering (NRMS_QR_ORDERING.md m4).
// No authentication: the order-point token IS the capability. Everything here
// is rate-limited, size-capped and sanitized; no guest personal data is ever
// returned. Orders enter as PLACED and cost the kitchen nothing until staff
// accept them (unless the outlet opted into auto-accept).

import crypto from "node:crypto";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { sanitizeText } from "../lib/sanitize.js";
import { nrmsOrderPlacementSettlement } from "../lib/nrmsOrders.js";
import { StockError, reserveMenuStock } from "../lib/nrmsStock.js";
import { readStayOrderingToken } from "../lib/nrmsStayToken.js";
import {
  limitPublicQrMenu,
  limitPublicQrOrderCreate,
  limitPublicQrOrderFeedback,
  limitPublicQrOrderStatus,
} from "../middleware/rateLimit.js";

export const router = Router();
const db = prisma as any;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,48}$/;
const PUBLIC_CODE_PATTERN = /^[A-Za-z0-9_-]{12,40}$/;
const MAX_OPEN_ORDERS_PER_POINT = 5;
const PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"] as const;

const publicOrderSchema = z.object({
  outletId: z.number().int().positive(),
  note: z.string().trim().max(200).optional().nullable(),
  /// m5: charge to the room's folio instead of paying at the counter.
  chargeToRoom: z.boolean().optional(),
  /// Guest intent only. Staff separately confirm the tender actually received.
  paymentMethod: z.enum(PAYMENT_METHODS).optional().nullable(),
  items: z
    .array(z.object({ menuItemId: z.number().int().positive(), quantity: z.number().int().min(1).max(20) }))
    .min(1)
    .max(20),
});

const publicOrderFeedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(500).optional().nullable(),
  tipIntent: z.enum(["NONE", "INTERESTED"]).optional().nullable(),
  tipAmount: z.number().finite().nonnegative().optional().nullable(),
}).superRefine((value, context) => {
  if (value.tipIntent === "INTERESTED" && (!value.tipAmount || value.tipAmount <= 0)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["tipAmount"], message: "Choose a tip amount" });
  }
  if (value.tipIntent !== "INTERESTED" && value.tipAmount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["tipAmount"], message: "Tip amount requires tip interest" });
  }
});

/**
 * The checked-in stay occupying the point's room, if any. Used both to
 * advertise "charge to my room" on the menu and to verify it at order time.
 */
async function findStayForPoint(point: {
  type: string;
  roomUnitId: number | null;
  propertyId: number;
  /**
   * Set only when the guest arrived on a per-stay token (m7). The printed room
   * QR resolves to whoever occupies the room right now, which is what a code on
   * the wall should do. A stay link instead names the reservation it was issued
   * for, so it can never reach the folio of a later guest in the same room.
   */
  boundReservationId?: number | null;
}) {
  if (point.type !== "ROOM" || point.roomUnitId == null) return null;
  const allocation = await db.reservationRoomAllocation.findFirst({
    where: {
      roomUnitId: point.roomUnitId,
      status: "ACTIVE",
      reservation: {
        propertyId: point.propertyId,
        status: "CHECKED_IN",
        ...(point.boundReservationId ? { id: point.boundReservationId } : {}),
      },
    },
    select: {
      reservation: {
        select: { id: true, currency: true, guestProfile: { select: { fullName: true } } },
      },
    },
  });
  return allocation?.reservation ?? null;
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function pointCustomerLabel(point: { type: string; label: string }): string {
  const kind = point.type === "ROOM" ? "Room" : "Table";
  return `${kind} ${point.label} (QR)`.slice(0, 120);
}

/**
 * Resolves a per-stay token (m7) to the room order point it belongs to, bound
 * to its own reservation. Returns null when the value is not a stay token, so
 * the caller falls through to the printed order-point lookup.
 *
 * A stay token stops working the moment its reservation leaves CHECKED_IN.
 * That is what lets the printed QR stay permanent: the link we put in an SMS,
 * which lives in the guest's phone forever, is not the same capability as the
 * code on the wall.
 */
async function loadPointForStayToken(reservationId: number) {
  const reservation = await db.reservation.findFirst({
    where: { id: reservationId, status: "CHECKED_IN" },
    select: {
      id: true,
      propertyId: true,
      allocations: {
        where: { status: "ACTIVE", roomUnitId: { not: null } },
        select: { roomUnitId: true },
        orderBy: { id: "asc" },
      },
    },
  });
  if (!reservation) return null;

  const roomUnitIds = reservation.allocations
    .map((allocation: { roomUnitId: number | null }) => allocation.roomUnitId)
    .filter((id: number | null): id is number => id != null);
  if (!roomUnitIds.length) return null;

  const point = await db.nrmsOrderPoint.findFirst({
    where: {
      propertyId: reservation.propertyId,
      type: "ROOM",
      roomUnitId: { in: roomUnitIds },
      active: true,
      orderingEnabled: true,
    },
    include: { property: { select: { id: true, title: true, nrmsActivatedAt: true, nrmsQrOrderingFrozenAt: true } } },
    orderBy: { id: "asc" },
  });
  if (!point) return null;

  return { ...point, boundReservationId: reservation.id };
}

/** Resolves an active order point + NRMS-active property, or replies and returns null. */
async function loadActivePoint(req: Request, res: Response) {
  const token = String(req.params.token || "");
  if (!TOKEN_PATTERN.test(token)) {
    res.status(404).json({ error: "This QR code is not valid" });
    return null;
  }
  const systemSetting = await db.systemSetting.findUnique({ where: { id: 1 }, select: { nrmsQrOrderingEnabled: true } });
  if (systemSetting?.nrmsQrOrderingEnabled === false) {
    res.status(503).json({ error: "Online ordering is temporarily unavailable. Please order with a staff member." });
    return null;
  }

  // Only a cryptographically valid stay token owns the stay-token namespace.
  // Printed point tokens are random and may coincidentally look like
  // `s<digits>_<suffix>`; an invalid HMAC must still fall through to their
  // normal database lookup instead of shadowing a permanent room QR.
  const stayReservationId = readStayOrderingToken(token);
  const stayPoint = stayReservationId ? await loadPointForStayToken(stayReservationId) : null;
  if (stayReservationId && !stayPoint) {
    res.status(404).json({
      error: "This ordering link has ended because the stay is closed. Scan the QR code in the room to order.",
      code: "STAY_LINK_CLOSED",
    });
    return null;
  }

  const point =
    stayPoint ??
    (await db.nrmsOrderPoint.findUnique({
      where: { token },
      include: { property: { select: { id: true, title: true, nrmsActivatedAt: true, nrmsQrOrderingFrozenAt: true } } },
    }));
  if (!point || !point.active || !point.property?.nrmsActivatedAt) {
    res.status(404).json({ error: "This QR code is no longer active. Please ask a staff member for help." });
    return null;
  }
  // Admin enforcement freeze: the surface is temporarily off for this property.
  if (point.property.nrmsQrOrderingFrozenAt) {
    res.status(503).json({ error: "Online ordering is temporarily unavailable for this property. Please order with a staff member." });
    return null;
  }
  return point;
}

/** Hotel-direct payment channels (Lipa Namba, bank, card at counter) set by the owner. */
function sanitizePayInstructions(raw: unknown): Array<{ label: string; value: string; name: string | null }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 6)
    .map((row: any) => ({
      label: String(row?.label ?? "").slice(0, 40),
      value: String(row?.value ?? "").slice(0, 80),
      name: row?.name ? String(row.name).slice(0, 60) : null,
    }))
    .filter((row) => row.label && row.value);
}

function publicOrderView(order: any) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    settlementMode: order.settlementMode,
    settlementMethod: order.settlementMethod,
    guestPaymentMethod: order.guestPaymentMethod,
    total: number(order.total),
    currency: order.currency,
    note: order.note,
    outlet: order.outlet ? { name: order.outlet.name, type: order.outlet.type } : null,
    point: order.orderPoint ? { type: order.orderPoint.type, label: order.orderPoint.label } : null,
    items: (order.items ?? []).map((item: any) => ({
      name: item.nameSnapshot,
      quantity: item.quantity,
      lineTotal: number(item.lineTotal),
    })),
    placedAt: order.placedAt,
    confirmedAt: order.confirmedAt,
    preparingAt: order.preparingAt,
    servingAt: order.servingAt,
    servedAt: order.servedAt,
    postedAt: order.postedAt,
    settledAt: order.settledAt,
    cancelledAt: order.cancelledAt,
    guestRating: order.guestRating,
    guestFeedback: order.guestFeedback,
    tipIntent: order.tipIntent,
    tipSuggestedAmount: order.tipSuggestedAmount == null ? null : number(order.tipSuggestedAmount),
    feedbackAt: order.feedbackAt,
  };
}

/** GET /orders/:publicCode - guest status poll. Declared before /:token routes. */
router.get("/orders/:publicCode", limitPublicQrOrderStatus as RequestHandler, (async (req: Request, res: Response) => {
  const code = String(req.params.publicCode || "");
  if (!PUBLIC_CODE_PATTERN.test(code)) return res.status(404).json({ error: "Order not found" });
  const order = await db.nrmsOutletOrder.findUnique({
    where: { publicCode: code },
    include: {
      outlet: { select: { name: true, type: true } },
      orderPoint: { select: { type: true, label: true } },
      property: { select: { nrmsGuestPayInstructions: true } },
      items: { orderBy: { id: "asc" } },
    },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.setHeader("Cache-Control", "no-store");
  res.json({
    order: publicOrderView(order),
    // Where the guest can send money directly to the property (their own
    // Lipa Namba, bank and so on). Only relevant for counter-settled orders.
    payInstructions: order.settlementMode === "OUTLET_PAYMENT"
      ? sanitizePayInstructions(order.property?.nrmsGuestPayInstructions)
      : [],
  });
}) as RequestHandler);

/** POST /orders/:publicCode/feedback - one post-service rating and optional tip preference. */
router.post("/orders/:publicCode/feedback", limitPublicQrOrderFeedback as RequestHandler, (async (req: Request, res: Response) => {
  const code = String(req.params.publicCode || "");
  if (!PUBLIC_CODE_PATTERN.test(code)) return res.status(404).json({ error: "Order not found" });
  const parsed = publicOrderFeedbackSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Please check your feedback", details: parsed.error.flatten() });

  const existing = await db.nrmsOutletOrder.findUnique({ where: { publicCode: code } });
  if (!existing) return res.status(404).json({ error: "Order not found" });
  if (!["SETTLED", "POSTED_TO_FOLIO"].includes(existing.status) || !existing.servedAt) {
    return res.status(409).json({ error: "Feedback becomes available after service is completed." });
  }
  if (existing.feedbackAt) return res.status(409).json({ error: "Thank you — feedback was already received for this order." });
  if (parsed.data.tipAmount && parsed.data.tipAmount > number(existing.total)) {
    return res.status(400).json({ error: "The selected tip cannot be greater than the order total." });
  }

  const updated = await db.nrmsOutletOrder.update({
    where: { id: existing.id },
    data: {
      guestRating: parsed.data.rating,
      guestFeedback: parsed.data.comment ? sanitizeText(parsed.data.comment) : null,
      tipIntent: parsed.data.tipIntent ?? null,
      tipSuggestedAmount: parsed.data.tipIntent === "INTERESTED" ? parsed.data.tipAmount : null,
      feedbackAt: new Date(),
    },
    include: {
      outlet: { select: { name: true, type: true } },
      orderPoint: { select: { type: true, label: true } },
      items: { orderBy: { id: "asc" } },
    },
  });
  res.setHeader("Cache-Control", "no-store");
  res.json({ order: publicOrderView(updated) });
}) as RequestHandler);

/** GET /menu/:token - live menu for the scanned room/table. */
router.get("/menu/:token", limitPublicQrMenu as RequestHandler, (async (req: Request, res: Response) => {
  const point = await loadActivePoint(req, res);
  if (!point) return;
  const outlets = await db.nrmsOutlet.findMany({
    where: { propertyId: point.propertyId, status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      type: true,
      currency: true,
      categoryOrder: true,
      autoAcceptQrOrders: true,
      menuItems: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
          name: true,
          category: true,
          price: true,
          description: true,
          imageUrl: true,
          inStock: true,
          sortOrder: true,
        },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      },
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  const stay = await findStayForPoint(point);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    property: { title: point.property.title },
    point: { type: point.type, label: point.label },
    // False only for the PREVIEW point linked from a public listing page:
    // browsing is open to anyone, ordering still requires an actual room or
    // table QR. The page uses this to hide the basket rather than showing it
    // and failing at checkout.
    orderingEnabled: Boolean(point.orderingEnabled),
    // Only the capability is advertised; the guest's identity never leaves the server.
    roomChargeAvailable: Boolean(stay),
    outlets: outlets.map((outlet: any) => ({
      ...outlet,
      autoAcceptQrOrders: undefined,
      menuItems: outlet.menuItems.map((item: any) => ({ ...item, price: number(item.price) })),
    })),
  });
}) as RequestHandler);

/** POST /menu/:token/orders - place a guest order from the scanned point. */
router.post("/menu/:token/orders", limitPublicQrOrderCreate as RequestHandler, (async (req: Request, res: Response) => {
  const point = await loadActivePoint(req, res);
  if (!point) return;
  // Server-side, not just a hidden button: a preview link is for browsing a
  // property's menu before booking, never a checkout path.
  if (!point.orderingEnabled) {
    return res.status(403).json({ error: "This is a preview menu. Scan the QR code at your table or in your room to order.", code: "ORDERING_DISABLED" });
  }
  const parsed = publicOrderSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Invalid order", details: parsed.error.flatten() });
  if (!parsed.data.chargeToRoom && !parsed.data.paymentMethod) {
    return res.status(400).json({ error: "Choose how you intend to pay before sending the order.", code: "PAYMENT_METHOD_REQUIRED" });
  }

  const outlet = await db.nrmsOutlet.findFirst({
    where: { id: parsed.data.outletId, propertyId: point.propertyId, status: "ACTIVE" },
  });
  if (!outlet) return res.status(400).json({ error: "This outlet is not taking orders right now" });

  // Resolve the room occupant for both payment paths. Pay-at-outlet orders
  // retain this link for guest/room attribution but do not become folio
  // charges. Charging the room still requires an active checked-in stay.
  const found = await findStayForPoint(point);
  const stay = found ? { id: found.id, currency: found.currency } : null;
  if (parsed.data.chargeToRoom && !stay) {
    return res.status(409).json({
      error: "Adding to the room bill is not available for this room right now. You can pay now instead.",
      code: "ROOM_CHARGE_UNAVAILABLE",
    });
  }
  const settlement = nrmsOrderPlacementSettlement({
    chargeToRoom: Boolean(parsed.data.chargeToRoom),
    paymentMethod: parsed.data.paymentMethod ?? null,
    stay,
    outletCurrency: outlet.currency,
  });

  // Abuse cap: a point can only hold a handful of unfinished orders at once.
  const openOrders = await db.nrmsOutletOrder.count({
    where: { orderPointId: point.id, status: { in: ["PLACED", "CONFIRMED", "PREPARING", "SERVING"] } },
  });
  if (openOrders >= MAX_OPEN_ORDERS_PER_POINT) {
    return res.status(409).json({
      error: "There are already several open orders for this spot. Please wait for them to be served or ask a staff member.",
    });
  }

  const requested = new Map<number, number>();
  for (const item of parsed.data.items) requested.set(item.menuItemId, (requested.get(item.menuItemId) ?? 0) + item.quantity);
  const menuItems = await db.nrmsMenuItem.findMany({
    where: { id: { in: [...requested.keys()] }, outletId: outlet.id, status: "ACTIVE", inStock: true },
  });
  if (menuItems.length !== requested.size) {
    return res.status(400).json({ error: "One or more selected items are not available right now. Please refresh the menu." });
  }
  const lines = menuItems.map((item: any) => {
    const quantity = requested.get(item.id)!;
    const unitPrice = number(item.price);
    return { menuItemId: item.id, nameSnapshot: item.name, quantity, unitPrice, lineTotal: Number((unitPrice * quantity).toFixed(2)) };
  });
  const total = Number(lines.reduce((sum: number, line: any) => sum + line.lineTotal, 0).toFixed(2));

  const prefix = outlet.type === "RESTAURANT" ? "RST" : outlet.type === "BAR" ? "BAR" : "SVC";
  const day = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const orderNumber = `${prefix}-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const publicCode = crypto.randomBytes(12).toString("base64url");
  const now = new Date();
  const autoAccept = Boolean(outlet.autoAcceptQrOrders);

  let order;
  try {
    // Tracked stock is reserved at placement, in the same transaction as the
    // order, so a pending guest order holds its quantity and cannot oversell.
    // Staff declining the order gives the quantity back (cancel route).
    order = await db.$transaction(async (tx: any) => {
      await reserveMenuStock(tx, menuItems, requested);
      return tx.nrmsOutletOrder.create({
        data: {
          propertyId: point.propertyId,
          outletId: outlet.id,
          reservationId: settlement.reservationId,
          customerLabel: pointCustomerLabel(point),
          orderPointId: point.id,
          publicCode,
          orderNumber,
          status: autoAccept ? "CONFIRMED" : "PLACED",
          settlementMode: settlement.settlementMode,
          guestPaymentMethod: settlement.guestPaymentMethod,
          currency: settlement.currency,
          subtotal: total,
          total,
          note: parsed.data.note ? sanitizeText(parsed.data.note) : null,
          placedAt: now,
          ...(autoAccept ? { confirmedAt: now } : {}),
          items: { create: lines },
        },
        include: {
          outlet: { select: { name: true, type: true } },
          orderPoint: { select: { type: true, label: true } },
          items: { orderBy: { id: "asc" } },
        },
      });
    });
  } catch (error) {
    if (error instanceof StockError) {
      return res.status(409).json({ error: `"${error.itemName}" has just run out. Please refresh the menu and adjust your order.` });
    }
    console.error("[public.nrmsMenu] order create failed", error);
    return res.status(500).json({ error: "Unable to place the order right now. Please try again." });
  }

  res.status(201).json({ order: publicOrderView(order), publicCode });
}) as RequestHandler);

export default router;

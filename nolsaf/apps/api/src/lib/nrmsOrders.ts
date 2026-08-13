import { routeChargeToMasterFolio } from "./nrmsMasterFolio.js";

function amount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

type OrderStay = { id: number; currency: string | null } | null;

/**
 * Keeps guest attribution separate from payment handling. A room-QR order can
 * belong to an in-house guest while still being paid directly at the outlet;
 * only ROOM_FOLIO orders become reservation charges.
 */
export function nrmsOrderPlacementSettlement(input: {
  chargeToRoom: boolean;
  paymentMethod: string | null;
  stay: OrderStay;
  outletCurrency: string;
}) {
  if (input.chargeToRoom && !input.stay) throw new Error("NRMS_ROOM_CHARGE_UNAVAILABLE");
  return {
    reservationId: input.stay?.id ?? null,
    settlementMode: input.chargeToRoom ? "ROOM_FOLIO" as const : "OUTLET_PAYMENT" as const,
    guestPaymentMethod: input.chargeToRoom ? null : input.paymentMethod,
    currency: input.chargeToRoom ? (input.stay?.currency ?? input.outletCurrency) : input.outletCurrency,
  };
}

export function nrmsOrderChargeCategory(outletType: string): "RESTAURANT" | "BAR" | "OTHER" {
  if (outletType === "BAR") return "BAR";
  if (outletType === "RESTAURANT") return "RESTAURANT";
  return "OTHER";
}

export function nrmsOrderDescription(order: { orderNumber: string; items: Array<{ quantity: number; nameSnapshot: string }> }): string {
  return `Order ${order.orderNumber} - ${order.items.map((item) => `${item.quantity}x ${item.nameSnapshot}`).join(", ")}`.slice(0, 300);
}

/**
 * Advances one outlet order under the caller's property row lock.
 * Repeated serve/post requests are idempotent once folioChargeId exists.
 */
export async function advanceNrmsOutletOrder(tx: any, input: { orderId: number; actorId: number; settlementMethod?: string | null }) {
  const order = await tx.nrmsOutletOrder.findUnique({
    where: { id: input.orderId },
    include: { outlet: true, items: true, reservation: true },
  });
  if (!order) throw new Error("NRMS_ORDER_NOT_FOUND");
  if (order.status === "POSTED_TO_FOLIO" && order.folioChargeId) return { status: order.status, folioChargeId: order.folioChargeId };
  if (order.status === "SETTLED") return { status: order.status, folioChargeId: null };
  // Guest QR orders arrive as PLACED and cost the kitchen nothing until a
  // staff member accepts them into the confirmed queue.
  if (order.status === "PLACED") {
    await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "CONFIRMED", confirmedAt: new Date(), confirmedById: input.actorId } });
    return { status: "CONFIRMED", folioChargeId: null };
  }
  if (order.status === "CONFIRMED") {
    await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "PREPARING", preparingAt: new Date() } });
    return { status: "PREPARING", folioChargeId: null };
  }
  // Preparation completion starts physical service/delivery only. It must not
  // settle revenue or post a folio charge before the guest receives the order.
  if (order.status === "PREPARING") {
    await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "SERVING", servingAt: new Date() } });
    return { status: "SERVING", folioChargeId: null };
  }
  if (order.status !== "SERVING") throw new Error("NRMS_ORDER_INVALID_TRANSITION");
  // Only folio posting requires an active in-house stay. Outlet-paid orders
  // may retain the reservation link for guest attribution and reporting, but
  // that link must never turn a cash/card sale into a folio dependency.
  if (order.settlementMode === "ROOM_FOLIO" && order.reservationId != null && order.reservation?.status !== "CHECKED_IN") {
    throw new Error("NRMS_ORDER_GUEST_NOT_IN_HOUSE");
  }

  const now = new Date();
  if (order.settlementMode === "OUTLET_PAYMENT") {
    if (!input.settlementMethod) throw new Error("NRMS_ORDER_TENDER_REQUIRED");
    await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "SETTLED", servedAt: now, settledAt: now, settlementMethod: input.settlementMethod, settledById: input.actorId } });
    return { status: "SETTLED", folioChargeId: null };
  }

  // A folio posting is impossible without a stay to post to.
  if (order.reservationId == null) throw new Error("NRMS_ORDER_INVALID_TRANSITION");

  // Create the folio charge and set the order's folioChargeId in ONE nested
  // write, so the database links them atomically. The previous version created
  // the charge, trusted the driver's returned insert id, then wrote it back in a
  // second update; under the MariaDB adapter that round-tripped id could point at
  // no row and fail the foreign key (P2003). A nested create removes the id
  // round-trip entirely — the FK is set by the same statement that inserts.
  const posted = await tx.nrmsOutletOrder.update({
    where: { id: order.id },
    data: {
      status: "POSTED_TO_FOLIO",
      servedAt: now,
      postedAt: now,
      folioCharge: {
        create: {
          reservationId: order.reservationId,
          category: nrmsOrderChargeCategory(order.outlet.type),
          description: nrmsOrderDescription(order),
          amount: order.total,
          currency: order.currency,
          postedById: input.actorId,
        },
      },
    },
    include: { folioCharge: { select: { id: true, reservationId: true, category: true, description: true, amount: true, currency: true } } },
  });
  const chargeId = posted.folioCharge!.id;
  await routeChargeToMasterFolio(tx, posted.folioCharge!);
  // Aggregate after the charge exists so the new posting is included.
  const aggregate = await tx.reservationCharge.aggregate({ where: { reservationId: order.reservationId, voidedAt: null }, _sum: { amount: true } });
  await tx.reservation.update({ where: { id: order.reservationId }, data: { chargesTotal: aggregate._sum.amount ?? 0 } });
  await tx.reservationEvent.create({
    data: {
      reservationId: order.reservationId,
      type: "CHARGE_POSTED",
      actorId: input.actorId,
      data: { chargeId, orderId: order.id, orderNumber: order.orderNumber, amount: amount(order.total) },
    },
  });
  return { status: "POSTED_TO_FOLIO", folioChargeId: chargeId };
}

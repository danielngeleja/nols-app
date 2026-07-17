function amount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  if (order.status === "CONFIRMED") {
    await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "PREPARING", preparingAt: new Date() } });
    return { status: "PREPARING", folioChargeId: null };
  }
  if (order.status !== "PREPARING") throw new Error("NRMS_ORDER_INVALID_TRANSITION");
  if (order.reservation.status !== "CHECKED_IN") throw new Error("NRMS_ORDER_GUEST_NOT_IN_HOUSE");

  const now = new Date();
  if (order.settlementMode === "OUTLET_PAYMENT") {
    if (!input.settlementMethod) throw new Error("NRMS_ORDER_TENDER_REQUIRED");
    await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "SETTLED", servedAt: now, settledAt: now, settlementMethod: input.settlementMethod, settledById: input.actorId } });
    return { status: "SETTLED", folioChargeId: null };
  }

  const charge = await tx.reservationCharge.create({
    data: {
      reservationId: order.reservationId,
      category: nrmsOrderChargeCategory(order.outlet.type),
      description: nrmsOrderDescription(order),
      amount: order.total,
      currency: order.currency,
      postedById: input.actorId,
    },
  });
  const aggregate = await tx.reservationCharge.aggregate({ where: { reservationId: order.reservationId, voidedAt: null }, _sum: { amount: true } });
  await tx.reservation.update({ where: { id: order.reservationId }, data: { chargesTotal: aggregate._sum.amount ?? 0 } });
  await tx.nrmsOutletOrder.update({ where: { id: order.id }, data: { status: "POSTED_TO_FOLIO", servedAt: now, postedAt: now, folioChargeId: charge.id } });
  await tx.reservationEvent.create({
    data: {
      reservationId: order.reservationId,
      type: "CHARGE_POSTED",
      actorId: input.actorId,
      data: { chargeId: charge.id, orderId: order.id, orderNumber: order.orderNumber, amount: amount(order.total) },
    },
  });
  return { status: "POSTED_TO_FOLIO", folioChargeId: charge.id };
}

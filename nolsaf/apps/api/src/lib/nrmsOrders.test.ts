import { describe, expect, it, vi } from "vitest";
import { advanceNrmsOutletOrder, nrmsOrderDescription } from "./nrmsOrders.js";

function preparingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    status: "PREPARING",
    folioChargeId: null,
    settlementMode: "ROOM_FOLIO",
    reservationId: 9,
    currency: "TZS",
    total: 25_000,
    orderNumber: "RST-260715-ABC123",
    outlet: { type: "RESTAURANT" },
    reservation: { status: "CHECKED_IN" },
    items: [{ quantity: 2, nameSnapshot: "Pilau" }],
    ...overrides,
  };
}

describe("NRMS outlet order folio transition", () => {
  it("posts one itemised charge and refreshes the reservation folio", async () => {
    const tx = {
      nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(preparingOrder()), update: vi.fn().mockResolvedValue({}) },
      reservationCharge: { create: vi.fn().mockResolvedValue({ id: 44 }), aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 25_000 } }) },
      reservation: { update: vi.fn().mockResolvedValue({}) },
      reservationEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const result = await advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 });
    expect(result).toEqual({ status: "POSTED_TO_FOLIO", folioChargeId: 44 });
    expect(tx.reservationCharge.create).toHaveBeenCalledTimes(1);
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { chargesTotal: 25_000 } });
  });

  it("is idempotent after the order already owns a folio charge", async () => {
    const create = vi.fn();
    const tx = {
      nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(preparingOrder({ status: "POSTED_TO_FOLIO", folioChargeId: 44 })) },
      reservationCharge: { create },
    };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 })).resolves.toEqual({ status: "POSTED_TO_FOLIO", folioChargeId: 44 });
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses to post when the guest is no longer checked in", async () => {
    const create = vi.fn();
    const tx = {
      nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(preparingOrder({ reservation: { status: "CHECKED_OUT" } })) },
      reservationCharge: { create },
    };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 })).rejects.toThrow("NRMS_ORDER_GUEST_NOT_IN_HOUSE");
    expect(create).not.toHaveBeenCalled();
  });

  it("requires a tender before an outlet-paid order can settle", async () => {
    const tx = { nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(preparingOrder({ settlementMode: "OUTLET_PAYMENT" })), update: vi.fn() } };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 })).rejects.toThrow("NRMS_ORDER_TENDER_REQUIRED");
    expect(tx.nrmsOutletOrder.update).not.toHaveBeenCalled();
  });

  it("records the payment method and settling operator for cashier control", async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = { nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(preparingOrder({ settlementMode: "OUTLET_PAYMENT" })), update } };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12, settlementMethod: "CASH" })).resolves.toEqual({ status: "SETTLED", folioChargeId: null });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ status: "SETTLED", settlementMethod: "CASH", settledById: 12 }) }));
  });

  it("keeps the printed folio description compact", () => {
    expect(nrmsOrderDescription(preparingOrder())).toBe("Order RST-260715-ABC123 - 2x Pilau");
  });
});

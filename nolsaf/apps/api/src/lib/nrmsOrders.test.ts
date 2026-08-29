import { describe, expect, it, vi } from "vitest";

const assertBusinessDayWritable = vi.hoisted(() => vi.fn());
vi.mock("./nrmsShifts.js", () => ({ assertNrmsBusinessDayWritable: assertBusinessDayWritable }));
// Fiscal receipting is a no-op for every property that has not switched it on,
// which is what these fakes represent; its own behaviour is covered in
// nrmsFiscal.test.ts. Stubbed here so the tx fakes stay about orders.
const fiscalise = vi.hoisted(() => vi.fn().mockResolvedValue(null));
vi.mock("./nrmsFiscal.js", () => ({ fiscaliseSettlement: fiscalise }));

import { advanceNrmsOutletOrder, nrmsOrderDescription, nrmsOrderPlacementSettlement } from "./nrmsOrders.js";

function preparingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    propertyId: 3,
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

function servingOrder(overrides: Record<string, unknown> = {}) {
  return preparingOrder({ status: "SERVING", ...overrides });
}

describe("NRMS physical service transition", () => {
  it("starts delivery without settling revenue or posting a folio charge", async () => {
    const update = vi.fn().mockResolvedValue({});
    const chargeCreate = vi.fn();
    const tx = {
      nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(preparingOrder({ settlementMode: "OUTLET_PAYMENT" })), update },
      reservationCharge: { create: chargeCreate },
    };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12, settlementMethod: "CASH" })).resolves.toEqual({ status: "SERVING", folioChargeId: null });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SERVING" }) }));
    expect(update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SETTLED" }) }));
    expect(chargeCreate).not.toHaveBeenCalled();
  });
});

describe("NRMS outlet order folio transition", () => {
  it("posts the charge and links the folio in one atomic nested write", async () => {
    const orderUpdate = vi.fn().mockResolvedValue({ folioCharge: { id: 44, reservationId: 9, category: "RESTAURANT", description: "Order", amount: 25_000, currency: "TZS" } });
    const tx = {
      nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(servingOrder()), update: orderUpdate },
      reservationCharge: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 25_000 } }) },
      reservation: { findUnique: vi.fn().mockResolvedValue({ id: 9, groupId: null }), update: vi.fn().mockResolvedValue({}) },
      reservationEvent: { create: vi.fn().mockResolvedValue({}) },
    };
    const result = await advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 });
    expect(result).toEqual({ status: "POSTED_TO_FOLIO", folioChargeId: 44 });
    // The charge is created via the order update's nested write, not a separate
    // create-then-link, so there is no round-tripped id that could fail the FK.
    expect(orderUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 5 },
      data: expect.objectContaining({
        status: "POSTED_TO_FOLIO",
        folioCharge: { create: expect.objectContaining({ reservationId: 9, postedById: 12, amount: 25_000 }) },
      }),
      include: { folioCharge: { select: { id: true, reservationId: true, category: true, description: true, amount: true, currency: true } } },
    }));
    expect(tx.reservation.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { chargesTotal: 25_000 } });
    expect(assertBusinessDayWritable).toHaveBeenCalledWith(tx, 3);
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
      nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(servingOrder({ reservation: { status: "CHECKED_OUT" } })) },
      reservationCharge: { create },
    };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 })).rejects.toThrow("NRMS_ORDER_GUEST_NOT_IN_HOUSE");
    expect(create).not.toHaveBeenCalled();
  });

  it("requires a tender before an outlet-paid order can settle", async () => {
    const tx = { nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(servingOrder({ settlementMode: "OUTLET_PAYMENT" })), update: vi.fn() } };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 })).rejects.toThrow("NRMS_ORDER_TENDER_REQUIRED");
    expect(tx.nrmsOutletOrder.update).not.toHaveBeenCalled();
  });

  it("records the payment method and settling operator for cashier control", async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = { nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(servingOrder({ settlementMode: "OUTLET_PAYMENT" })), update } };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12, settlementMethod: "CASH" })).resolves.toEqual({ status: "SETTLED", folioChargeId: null });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ status: "SETTLED", settlementMethod: "CASH", settledById: 12 }) }));
  });

  it("settles a guest-attributed outlet payment without posting to the folio after checkout", async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      nrmsOutletOrder: {
        findUnique: vi.fn().mockResolvedValue(servingOrder({
          settlementMode: "OUTLET_PAYMENT",
          reservationId: 9,
          reservation: { status: "CHECKED_OUT" },
        })),
        update,
      },
      reservationCharge: { create: vi.fn() },
    };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12, settlementMethod: "CASH" }))
      .resolves.toEqual({ status: "SETTLED", folioChargeId: null });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SETTLED" }) }));
    expect(tx.reservationCharge.create).not.toHaveBeenCalled();
  });

  it("keeps the printed folio description compact", () => {
    expect(nrmsOrderDescription(preparingOrder())).toBe("Order RST-260715-ABC123 - 2x Pilau");
  });
});

describe("NRMS room-QR order placement", () => {
  const stay = { id: 91, currency: "TZS" };

  it("keeps the guest link on an outlet-paid order without routing it to the folio", () => {
    expect(nrmsOrderPlacementSettlement({
      chargeToRoom: false,
      paymentMethod: "CASH",
      stay,
      outletCurrency: "TZS",
    })).toEqual({
      reservationId: 91,
      settlementMode: "OUTLET_PAYMENT",
      guestPaymentMethod: "CASH",
      currency: "TZS",
    });
  });

  it("routes only add-to-room-bill orders to the folio", () => {
    expect(nrmsOrderPlacementSettlement({
      chargeToRoom: true,
      paymentMethod: null,
      stay,
      outletCurrency: "USD",
    })).toEqual({
      reservationId: 91,
      settlementMode: "ROOM_FOLIO",
      guestPaymentMethod: null,
      currency: "TZS",
    });
  });

  it("allows a true walk-in outlet payment without a reservation", () => {
    expect(nrmsOrderPlacementSettlement({
      chargeToRoom: false,
      paymentMethod: "CARD",
      stay: null,
      outletCurrency: "TZS",
    })).toEqual({
      reservationId: null,
      settlementMode: "OUTLET_PAYMENT",
      guestPaymentMethod: "CARD",
      currency: "TZS",
    });
  });
});

describe("walk-in outlet orders (no reservation)", () => {
  function walkInOrder(overrides: Record<string, unknown> = {}) {
    return servingOrder({ reservationId: null, reservation: null, customerLabel: "Table 4", settlementMode: "OUTLET_PAYMENT", ...overrides });
  }

  it("settles a walk-in sale without any in-house guest requirement", async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = { nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(walkInOrder()), update } };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12, settlementMethod: "MOBILE_MONEY" })).resolves.toEqual({ status: "SETTLED", folioChargeId: null });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SETTLED", settlementMethod: "MOBILE_MONEY" }) }));
  });

  it("still requires a tender for a walk-in settlement", async () => {
    const tx = { nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(walkInOrder()), update: vi.fn() } };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 })).rejects.toThrow("NRMS_ORDER_TENDER_REQUIRED");
  });

  it("refuses to post a walk-in order to a room folio", async () => {
    const create = vi.fn();
    const tx = {
      nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(walkInOrder({ settlementMode: "ROOM_FOLIO" })), update: vi.fn() },
      reservationCharge: { create },
    };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 })).rejects.toThrow("NRMS_ORDER_INVALID_TRANSITION");
    expect(create).not.toHaveBeenCalled();
  });
});

describe("guest QR orders (PLACED status)", () => {
  it("accepting a PLACED order confirms it and records the accepting operator", async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      nrmsOutletOrder: {
        findUnique: vi.fn().mockResolvedValue(preparingOrder({ status: "PLACED", reservationId: null, reservation: null, settlementMode: "OUTLET_PAYMENT" })),
        update,
      },
    };
    await expect(advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 31 })).resolves.toEqual({ status: "CONFIRMED", folioChargeId: null });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 5 },
      data: expect.objectContaining({ status: "CONFIRMED", confirmedById: 31 }),
    }));
  });

  it("acceptance does not settle or post anything", async () => {
    const chargeCreate = vi.fn();
    const tx = {
      nrmsOutletOrder: {
        findUnique: vi.fn().mockResolvedValue(preparingOrder({ status: "PLACED", reservationId: null, reservation: null, settlementMode: "OUTLET_PAYMENT" })),
        update: vi.fn().mockResolvedValue({}),
      },
      reservationCharge: { create: chargeCreate },
    };
    await advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 31 });
    expect(chargeCreate).not.toHaveBeenCalled();
  });
});

describe("fiscal receipting hook", () => {
  it("queues a fiscal document when an outlet payment settles", async () => {
    fiscalise.mockClear();
    const tx = {
      nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(servingOrder({ settlementMode: "OUTLET_PAYMENT" })), update: vi.fn().mockResolvedValue({}) },
    };
    await advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12, settlementMethod: "CASH" });
    expect(fiscalise).toHaveBeenCalledWith(tx, expect.objectContaining({
      propertyId: 3,
      sourceType: "OUTLET_SALE",
      sourceId: 5,
      currency: "TZS",
      grossAmount: 25_000,
    }));
  });

  it("does not fiscalise a charge posted to a room folio", async () => {
    // The guest paying that folio at checkout is the taxable event, not the
    // bar order landing on it, so this path must stay silent.
    fiscalise.mockClear();
    const tx = {
      nrmsOutletOrder: {
        findUnique: vi.fn().mockResolvedValue(servingOrder()),
        update: vi.fn().mockResolvedValue({ folioCharge: { id: 44, reservationId: 9, category: "RESTAURANT", description: "Order", amount: 25_000, currency: "TZS" } }),
      },
      reservationCharge: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 25_000 } }) },
      reservation: { findUnique: vi.fn().mockResolvedValue({ id: 9, groupId: null }), update: vi.fn().mockResolvedValue({}) },
      reservationEvent: { create: vi.fn().mockResolvedValue({}) },
      nrmsMasterFolioItem: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12 });
    expect(fiscalise).not.toHaveBeenCalled();
  });

  it("does not fiscalise an order that is merely accepted or prepared", async () => {
    fiscalise.mockClear();
    const tx = {
      nrmsOutletOrder: { findUnique: vi.fn().mockResolvedValue(preparingOrder({ settlementMode: "OUTLET_PAYMENT" })), update: vi.fn().mockResolvedValue({}) },
    };
    await advanceNrmsOutletOrder(tx, { orderId: 5, actorId: 12, settlementMethod: "CASH" });
    expect(fiscalise).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { AGENT_PREPAY_DEFAULT_MINUTES, AGENT_PREPAY_TTL_MS, ensureAgentPrepayRequest, expireUnpaidAgentBookings } from "./nrmsAgentPayment.js";

function makeDb(existing: any = null) {
  return {
    nrmsGuestPaymentRequest: {
      findFirst: vi.fn(async (_a: any) => existing),
      create: vi.fn(async (_a: any) => ({ id: 500, publicToken: "TOK" })),
      update: vi.fn(async (_a: any) => ({})),
    },
  };
}

describe("ensureAgentPrepayRequest", () => {
  it("uses a B2B-safe 24-hour default window", () => {
    expect(AGENT_PREPAY_DEFAULT_MINUTES).toBe(24 * 60);
  });

  it("creates a prepay request when none is open", async () => {
    const before = Date.now();
    const db = makeDb(null);
    const res = await ensureAgentPrepayRequest(db, { reservationId: 5, amount: 180000, currency: "TZS" });
    expect(res).toEqual({ id: 500, publicToken: "TOK" });
    const data = db.nrmsGuestPaymentRequest.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ reservationId: 5, kind: "AGENT_PREPAY", amount: 180000, currency: "TZS" });
    expect(typeof data.publicToken).toBe("string");
    expect(data.dueAt).toBeInstanceOf(Date);
    expect(data.dueAt.getTime()).toBeGreaterThanOrEqual(before + AGENT_PREPAY_TTL_MS);
    expect(data.dueAt.getTime()).toBeLessThanOrEqual(Date.now() + AGENT_PREPAY_TTL_MS);
  });

  it("is idempotent — returns the existing open request instead of duplicating", async () => {
    const db = makeDb({ id: 9, publicToken: "EXISTING" });
    const res = await ensureAgentPrepayRequest(db, { reservationId: 5, amount: 180000, currency: "TZS" });
    expect(res).toEqual({ id: 9, publicToken: "EXISTING" });
    expect(db.nrmsGuestPaymentRequest.create).not.toHaveBeenCalled();
    expect(db.nrmsGuestPaymentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 9 }, data: { dueAt: expect.any(Date) } }));
  });
});

describe("expireUnpaidAgentBookings", () => {
  function expiryDb(amountPaid = 0, masterFolio: any = null) {
    const dueAt = new Date(Date.now() - 60_000);
    const tx: any = {
      $executeRawUnsafe: vi.fn(),
      nrmsGuestPaymentRequest: { findUnique: vi.fn(async () => ({ id: 9, status: "PENDING", dueAt, cancelledAt: null, amount: 100, reservationId: 5, reservation: { id: 5, status: "CONFIRMED", amountPaid, agentBookingRequest: { id: 12, status: "CONFIRMED", masterFolio } } })), updateMany: vi.fn(async () => ({ count: 1 })) },
      reservation: { updateMany: vi.fn(async () => ({ count: 1 })) },
      reservationRoomAllocation: { updateMany: vi.fn(async () => ({ count: 1 })) },
      reservationEvent: { create: vi.fn(async () => ({})) },
      nrmsAgentBookingRequest: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const client: any = {
      nrmsGuestPaymentRequest: { findMany: vi.fn(async () => [{ id: 9, reservationId: 5, reservation: { propertyId: 2 } }]) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    return { client, tx };
  }

  it("releases confirmed inventory after the prepaid deadline", async () => {
    const { client, tx } = expiryDb(0);
    expect(await expireUnpaidAgentBookings(client)).toBe(1);
    expect(tx.reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5, status: "CONFIRMED" }, data: expect.objectContaining({ status: "CANCELLED" }) }));
    expect(tx.reservationRoomAllocation.updateMany).toHaveBeenCalledWith({ where: { reservationId: 5, status: "ACTIVE" }, data: { status: "RELEASED" } });
    expect(tx.nrmsAgentBookingRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "EXPIRED" }) }));
  });

  it("does not expire a booking that settled while the worker was waiting", async () => {
    const { client, tx } = expiryDb(100);
    expect(await expireUnpaidAgentBookings(client)).toBe(0);
    expect(tx.nrmsGuestPaymentRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SETTLED" }) }));
    expect(tx.reservation.updateMany).not.toHaveBeenCalled();
  });

  it("reconciles a legacy request from the paid master folio", async () => {
    const { client, tx } = expiryDb(0, { status: "SETTLED", payments: [{ amount: 100 }], refunds: [] });
    expect(await expireUnpaidAgentBookings(client)).toBe(0);
    expect(tx.nrmsGuestPaymentRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SETTLED" }) }));
    expect(tx.reservation.updateMany).not.toHaveBeenCalled();
  });
});

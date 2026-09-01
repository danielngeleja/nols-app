import { beforeEach, describe, expect, it, vi } from "vitest";

const avail = vi.hoisted(() => ({ getRoomTypeAvailability: vi.fn(), lockPropertyInventory: vi.fn() }));
const restrict = vi.hoisted(() => ({ findRestrictionBlocks: vi.fn() }));
vi.mock("./nrmsAvailability.js", () => avail);
vi.mock("./nrmsRestrictions.js", () => restrict);

import { approveAgentHold, createAgentHold, expireAgentHolds, releaseAgentHold } from "./nrmsAgentInventory.js";

const link = { id: 7, propertyId: 2, ownerId: 3, bookingMode: "REQUEST" };
const quote = { currency: "TZS", nightly: [{ date: "2026-09-01", rate: 90000 }, { date: "2026-09-02", rate: 90000 }], subtotal: 180000, tax: 0, fees: 0, total: 180000 };
const baseInput = () => ({ link: { ...link }, clientMutationId: "booking-attempt-123456", roomTypeId: 10, ratePlanId: 5, checkIn: new Date("2026-09-01T00:00:00Z"), checkOut: new Date("2026-09-03T00:00:00Z"), adults: 2, children: 0, roomsRequested: 1, incidentalBilling: "INDIVIDUAL_GUEST" as const, quote, createdByUserId: 99 });

/** Fake interactive-transaction client capturing writes. */
function makeTx(overrides: Record<string, any> = {}) {
  return {
    reservation: { create: vi.fn(async (_d: any) => ({ id: 500 })), updateMany: vi.fn(async (_d: any) => ({ count: 1 })) },
    reservationRoomAllocation: { updateMany: vi.fn(async (_d: any) => ({ count: 1 })) },
    reservationEvent: { create: vi.fn(async (_d: any) => ({})) },
    nrmsAgentBookingRequest: { create: vi.fn(async (_d: any) => ({ id: 800 })), findUnique: vi.fn(), update: vi.fn(async (_d: any) => ({})), updateMany: vi.fn(async (_d: any) => ({ count: 1 })) },
    $executeRawUnsafe: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  avail.getRoomTypeAvailability.mockReset();
  avail.lockPropertyInventory.mockReset();
  restrict.findRestrictionBlocks.mockReset();
  restrict.findRestrictionBlocks.mockResolvedValue([]);
});

describe("createAgentHold", () => {
  it("rejects when there is not enough availability", async () => {
    avail.getRoomTypeAvailability.mockResolvedValue({ capacity: 3, consumed: 3, available: 0 });
    const tx = makeTx();
    const result = await createAgentHold(tx, baseInput());
    expect(result).toMatchObject({ ok: false, reason: "NO_AVAILABILITY" });
    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(avail.lockPropertyInventory).toHaveBeenCalledWith(tx, 2);
  });

  it("rejects when a restriction blocks the stay", async () => {
    avail.getRoomTypeAvailability.mockResolvedValue({ capacity: 3, consumed: 0, available: 3 });
    restrict.findRestrictionBlocks.mockResolvedValue([{ message: "Stop sell" }]);
    const tx = makeTx();
    const result = await createAgentHold(tx, baseInput());
    expect(result).toMatchObject({ ok: false, reason: "RESTRICTED", message: "Stop sell" });
    expect(tx.reservation.create).not.toHaveBeenCalled();
  });

  it("creates a HELD reservation + PENDING request in REQUEST mode", async () => {
    avail.getRoomTypeAvailability.mockResolvedValue({ capacity: 3, consumed: 0, available: 3 });
    const tx = makeTx();
    const result = await createAgentHold(tx, baseInput());
    expect(result).toMatchObject({ ok: true, reservationId: 500, requestId: 800, status: "HELD" });
    expect((result as any).holdExpiresAt).toBeInstanceOf(Date);
    const resData = tx.reservation.create.mock.calls[0]![0].data;
    expect(resData).toMatchObject({ status: "HELD", source: "AGENT", agentPropertyLinkId: 7 });
    expect(resData.holdExpiresAt).toBeInstanceOf(Date);
    expect(resData.allocations.create).toHaveLength(1);
    const reqData = tx.nrmsAgentBookingRequest.create.mock.calls[0]![0].data;
    expect(reqData).toMatchObject({ status: "PENDING", linkId: 7, clientMutationId: "booking-attempt-123456", reservationId: 500, roomsRequested: 1 });
  });

  it("creates a CONFIRMED reservation with no hold in INSTANT mode", async () => {
    avail.getRoomTypeAvailability.mockResolvedValue({ capacity: 3, consumed: 0, available: 3 });
    const tx = makeTx();
    const result = await createAgentHold(tx, { ...baseInput(), link: { ...link, bookingMode: "INSTANT" } });
    expect(result).toMatchObject({ ok: true, status: "CONFIRMED", holdExpiresAt: null });
    const resData = tx.reservation.create.mock.calls[0]![0].data;
    expect(resData).toMatchObject({ status: "CONFIRMED", holdExpiresAt: null });
    expect(resData.confirmedAt).toBeInstanceOf(Date);
    const reqData = tx.nrmsAgentBookingRequest.create.mock.calls[0]![0].data;
    expect(reqData.status).toBe("CONFIRMED");
  });

  it("creates one allocation per requested room", async () => {
    avail.getRoomTypeAvailability.mockResolvedValue({ capacity: 5, consumed: 0, available: 5 });
    const tx = makeTx();
    await createAgentHold(tx, { ...baseInput(), roomsRequested: 3 });
    expect(tx.reservation.create.mock.calls[0]![0].data.allocations.create).toHaveLength(3);
  });
});

describe("approveAgentHold", () => {
  it("confirms a pending, still-held request", async () => {
    const tx = makeTx();
    tx.nrmsAgentBookingRequest.findUnique.mockResolvedValue({ id: 800, status: "PENDING", reservationId: 500, propertyId: 2, reservation: { id: 500, status: "HELD", holdExpiresAt: new Date(Date.now() + 3600_000) } });
    const result = await approveAgentHold(tx, 800, 42);
    expect(result).toMatchObject({ ok: true, reservationId: 500 });
    expect(tx.reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 500, status: "HELD" } }));
    expect(tx.nrmsAgentBookingRequest.updateMany.mock.calls[0]![0].data).toMatchObject({ status: "CONFIRMED", decidedByUserId: 42 });
  });

  it("refuses a request that is no longer pending", async () => {
    const tx = makeTx();
    tx.nrmsAgentBookingRequest.findUnique.mockResolvedValue({ id: 800, status: "CONFIRMED", reservationId: 500, reservation: { id: 500, status: "CONFIRMED", holdExpiresAt: null } });
    expect(await approveAgentHold(tx, 800, 42)).toMatchObject({ ok: false, reason: "NOT_PENDING" });
    expect(tx.reservation.updateMany).not.toHaveBeenCalled();
  });

  it("refuses when the hold has already expired", async () => {
    const tx = makeTx();
    tx.nrmsAgentBookingRequest.findUnique.mockResolvedValue({ id: 800, status: "PENDING", reservationId: 500, reservation: { id: 500, status: "HELD", holdExpiresAt: new Date(Date.now() - 1000) } });
    expect(await approveAgentHold(tx, 800, 42)).toMatchObject({ ok: false, reason: "HOLD_EXPIRED" });
    expect(tx.reservation.updateMany).not.toHaveBeenCalled();
  });
});

describe("releaseAgentHold", () => {
  it("declines a pending request and releases its rooms", async () => {
    const tx = makeTx();
    tx.nrmsAgentBookingRequest.findUnique.mockResolvedValue({ id: 800, status: "PENDING", reservation: { id: 500, status: "HELD" } });
    const result = await releaseAgentHold(tx, 800, { status: "DECLINED", decidedByUserId: 42, reason: "Overbooked" });
    expect(result).toMatchObject({ ok: true, reservationId: 500 });
    expect(tx.reservation.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 500, status: "HELD" } }));
    expect(tx.reservationRoomAllocation.updateMany).toHaveBeenCalledWith({ where: { reservationId: 500, status: "ACTIVE" }, data: { status: "RELEASED" } });
    expect(tx.nrmsAgentBookingRequest.updateMany.mock.calls[0]![0].data).toMatchObject({ status: "DECLINED" });
  });
});

describe("expireAgentHolds", () => {
  it("expires each stale pending hold in its own transaction", async () => {
    const tx = makeTx();
    tx.nrmsAgentBookingRequest.findUnique.mockResolvedValue({ propertyId: 2, status: "PENDING", holdExpiresAt: new Date(Date.now() - 60_000), reservationId: 500 });
    const client = {
      nrmsAgentBookingRequest: { findMany: vi.fn(async () => [{ id: 800, reservationId: 500 }, { id: 801, reservationId: 501 }]) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    const count = await expireAgentHolds(client);
    expect(count).toBe(2);
    expect(tx.reservation.updateMany).toHaveBeenCalledTimes(2);
  });

  it("skips a hold that stopped being pending between scan and update", async () => {
    const tx = makeTx();
    tx.nrmsAgentBookingRequest.findUnique.mockResolvedValue({ propertyId: 2, status: "CONFIRMED", holdExpiresAt: new Date(Date.now() - 60_000), reservationId: 500 });
    const client = {
      nrmsAgentBookingRequest: { findMany: vi.fn(async () => [{ id: 800, reservationId: 500 }]) },
      $transaction: vi.fn(async (fn: any) => fn(tx)),
    };
    expect(await expireAgentHolds(client)).toBe(0);
    expect(tx.reservation.updateMany).not.toHaveBeenCalled();
  });
});

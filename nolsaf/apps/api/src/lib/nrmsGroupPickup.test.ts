import { beforeEach, describe, expect, it, vi } from "vitest";
import { PICKUP_RACE, PICKUP_TX_OPTIONS, pickUpBlockRoom, runBlockPickupForGuest } from "./nrmsGroupPickup.js";

const availability = vi.hoisted(() => ({ getRoomTypesAvailability: vi.fn(), lockPropertyInventory: vi.fn(), findUnitConflicts: vi.fn() }));
const prismaClient = vi.hoisted(() => ({ $transaction: vi.fn() }));

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: prismaClient, prisma: prismaClient }));
vi.mock("./nrmsAvailability.js", () => availability);
vi.mock("./pdfDocuments.js", () => ({ generateNrmsRandomCode: () => "ABC123" }));

type FakeOptions = {
  block?: Record<string, unknown>;
  line?: Record<string, unknown>;
  row?: Record<string, unknown> | null;
  claimCount?: number;
  linkCount?: number;
  /** externalRefs already issued against this block, as the DB would return them. */
  issuedRefs?: string[];
};

function fakeTx(options: FakeOptions = {}) {
  const block = {
    id: 7,
    propertyId: 3,
    ownerId: 11,
    groupId: null,
    reference: "BLK-1",
    name: "Kilimanjaro Tour",
    agencyName: "Serengeti Adventures",
    status: "HELD",
    currency: "TZS",
    checkIn: new Date("2026-09-01T00:00:00.000Z"),
    checkOut: new Date("2026-09-04T00:00:00.000Z"),
    cutOffAt: new Date("2026-08-25T00:00:00.000Z"),
    ...options.block,
  };
  const line = { id: 21, blockId: 7, roomTypeId: 5, ratePlanId: null, quantity: 4, pickedUp: 1, nightlyRate: 100, mealPlan: "BB", ...options.line };

  return {
    block,
    line,
    nrmsGroupBlock: {
      findFirst: vi.fn().mockResolvedValue(block),
      update: vi.fn().mockResolvedValue(block),
    },
    nrmsGroupBlockRoom: {
      findFirst: vi.fn().mockResolvedValue(line),
      findMany: vi.fn().mockResolvedValue([{ quantity: line.quantity, pickedUp: line.pickedUp + 1 }]),
      updateMany: vi.fn().mockResolvedValue({ count: options.claimCount ?? 1 }),
    },
    nrmsRoomingListRow: {
      findFirst: vi.fn().mockResolvedValue(options.row === undefined ? { id: 90, status: "ACCEPTED", reservationId: null } : options.row),
      updateMany: vi.fn().mockResolvedValue({ count: options.linkCount ?? 1 }),
    },
    nrmsReservationGroup: { create: vi.fn().mockResolvedValue({ id: 55 }) },
    guestProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 200 }),
    },
    reservation: {
      create: vi.fn().mockResolvedValue({ id: 400, externalRef: "BLK-1-01", totalAmount: 300, currency: "TZS" }),
      findMany: vi.fn().mockResolvedValue((options.issuedRefs ?? []).map((externalRef) => ({ externalRef }))),
    },
    nrmsMasterFolio: {
      upsert: vi.fn().mockResolvedValue({ id: 88 }),
      update: vi.fn().mockResolvedValue({ id: 88 }),
    },
    nrmsMasterFolioItem: {
      upsert: vi.fn().mockResolvedValue({ id: 89 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 300 } }),
    },
    nrmsMasterFolioPayment: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: null } }) },
    reservationRoomAllocation: { create: vi.fn().mockResolvedValue({ id: 1 }) },
    reservationEvent: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
  };
}

const args = { blockId: 7, ownerId: 11, blockRoomId: 21, guestProfileId: 200, adults: 2, children: 0, actorId: 11 };

beforeEach(() => {
  vi.clearAllMocks();
  availability.findUnitConflicts.mockResolvedValue([]);
});

describe("pickup transaction", () => {
  it("uses 30 seconds of headroom and resolves a new guest before taking the inventory lock", async () => {
    vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
    const tx = fakeTx();
    prismaClient.$transaction.mockImplementation(async (work: (db: unknown) => unknown) => work(tx));

    const outcome = await runBlockPickupForGuest({
      blockId: 7,
      propertyId: 3,
      ownerId: 11,
      blockRoomId: 21,
      adults: 2,
      children: 0,
      actorId: 11,
      roomingListRowId: 90,
    }, {
      fullName: "Amina Juma",
      phone: null,
    });

    expect(PICKUP_TX_OPTIONS).toEqual({ maxWait: 5000, timeout: 30000 });
    expect(prismaClient.$transaction).toHaveBeenCalledWith(expect.any(Function), PICKUP_TX_OPTIONS);
    expect(tx.guestProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ propertyId: 3, ownerId: 11, fullName: "Amina Juma" }),
    });
    expect(tx.guestProfile.create.mock.invocationCallOrder[0]).toBeLessThan(availability.lockPropertyInventory.mock.invocationCallOrder[0]);
    expect(outcome).toMatchObject({ reservationId: 400, groupId: 55 });
    vi.useRealTimers();
  });
});

describe("block pickup", () => {
  it("does not check availability before cut-off, because the block already holds the room", async () => {
    vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
    const tx = fakeTx();

    const outcome = await pickUpBlockRoom(tx as any, args);

    expect(availability.getRoomTypesAvailability).not.toHaveBeenCalled();
    expect(availability.lockPropertyInventory).toHaveBeenCalledWith(tx, 3);
    expect(outcome).toMatchObject({ reservationId: 400, groupId: 55 });
    // Three nights at the agreed rate, not the public rate.
    expect(tx.reservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roomRate: 100, totalAmount: 300, status: "CONFIRMED" }) }));
    vi.useRealTimers();
  });

  it("checks real availability once the cut-off has passed and refuses a sold room", async () => {
    vi.setSystemTime(new Date("2026-08-28T09:00:00.000Z"));
    availability.getRoomTypesAvailability.mockResolvedValue(new Map([[5, { capacity: 4, consumed: 4, available: 0 }]]));
    const tx = fakeTx();

    const outcome = await pickUpBlockRoom(tx as any, args);

    expect(outcome).toEqual({ error: "NO_LONGER_AVAILABLE" });
    expect(tx.reservation.create).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("numbers each room out of a block so two pickups never share a reference", async () => {
    vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
    const first = fakeTx();

    await pickUpBlockRoom(first as any, args);
    expect(first.reservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalRef: "BLK-1-01" }) }));

    const second = fakeTx({ issuedRefs: ["BLK-1-01"] });
    await pickUpBlockRoom(second as any, args);
    expect(second.reservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalRef: "BLK-1-02" }) }));
    vi.useRealTimers();
  });

  it("numbers from the highest reference issued, so a removed stay cannot hand its number on", async () => {
    vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
    // 02 is gone; reusing it would collide with the 03 that still exists.
    const tx = fakeTx({ issuedRefs: ["BLK-1-01", "BLK-1-03"] });

    await pickUpBlockRoom(tx as any, args);

    expect(tx.reservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ externalRef: "BLK-1-04" }) }));
    vi.useRealTimers();
  });

  it("creates the operational group only on the first pickup", async () => {
    vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
    const tx = fakeTx({ block: { groupId: 61 } });

    const outcome = await pickUpBlockRoom(tx as any, args);

    expect(tx.nrmsReservationGroup.create).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ groupId: 61 });
    vi.useRealTimers();
  });

  it("routes one SPLIT room amount to the agency master folio", async () => {
    vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
    const tx = fakeTx({ block: { billingMode: "SPLIT" } });

    await pickUpBlockRoom(tx as any, args);

    expect(tx.nrmsMasterFolio.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { blockId: 7 },
      create: expect.objectContaining({ billingMode: "SPLIT", billToName: "Serengeti Adventures" }),
    }));
    expect(tx.nrmsMasterFolioItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceKey: "ROOM:400" },
      create: expect.objectContaining({ masterFolioId: 88, reservationId: 400, amount: 300, kind: "ROOM" }),
    }));
    vi.useRealTimers();
  });

  it("refuses a line whose rooms are all named", async () => {
    const tx = fakeTx({ line: { quantity: 2, pickedUp: 2 } });
    await expect(pickUpBlockRoom(tx as any, args)).resolves.toEqual({ error: "LINE_EXHAUSTED" });
  });

  it("refuses a block that stopped holding rooms", async () => {
    const tx = fakeTx({ block: { status: "RELEASED" } });
    await expect(pickUpBlockRoom(tx as any, args)).resolves.toEqual({ error: "BLOCK_NOT_LIVE" });
  });

  it("links the rooming list row to the stay it created", async () => {
    vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
    const tx = fakeTx();

    await pickUpBlockRoom(tx as any, { ...args, roomingListRowId: 90 });

    expect(tx.nrmsRoomingListRow.updateMany).toHaveBeenCalledWith({ where: { id: 90, reservationId: null }, data: { reservationId: 400 } });
    vi.useRealTimers();
  });

  it("refuses a rooming list row that was never accepted", async () => {
    const tx = fakeTx({ row: { id: 90, status: "PENDING", reservationId: null } });
    await expect(pickUpBlockRoom(tx as any, { ...args, roomingListRowId: 90 })).resolves.toEqual({ error: "ROW_NOT_PICKABLE" });
  });

  it("fails loudly when another writer claimed the same row first", async () => {
    vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
    const tx = fakeTx({ linkCount: 0 });
    await expect(pickUpBlockRoom(tx as any, { ...args, roomingListRowId: 90 })).rejects.toThrow(PICKUP_RACE);
    vi.useRealTimers();
  });

  it("fails loudly when another writer took the last room of the line first", async () => {
    vi.setSystemTime(new Date("2026-08-20T09:00:00.000Z"));
    const tx = fakeTx({ claimCount: 0 });
    await expect(pickUpBlockRoom(tx as any, args)).rejects.toThrow(PICKUP_RACE);
    vi.useRealTimers();
  });
});

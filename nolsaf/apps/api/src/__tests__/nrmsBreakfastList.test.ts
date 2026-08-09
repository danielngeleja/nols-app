import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@nolsaf/prisma", async (importOriginal) => {
  const original = await importOriginal<any>();
  return { ...original, prisma: { reservationRoomAllocation: { findMany: mocks.findMany } } };
});

import { buildBreakfastList } from "../lib/nrmsBreakfastList";

function allocation(overrides: Record<string, any> = {}): any {
  const reservation = {
    id: 501,
    status: "CHECKED_IN",
    adults: 2,
    children: 1,
    checkOut: new Date("2026-08-05T00:00:00.000Z"),
    guestProfile: { fullName: "Asha Mtumwa" },
    group: null,
    ...(overrides.reservation ?? {}),
  };
  return {
    id: 9001,
    mealPlan: "BREAKFAST",
    endDate: new Date("2026-08-05T00:00:00.000Z"),
    roomType: { name: "Deluxe Double" },
    roomUnit: { code: "R102", floor: 1 },
    ...overrides,
    reservation,
  };
}

const service = { propertyId: 7, propertyTitle: "Kilimanjaro Lodge", serviceDate: "2026-08-03" };

describe("breakfast list stay window", () => {
  afterEach(() => vi.clearAllMocks());

  it("asks for stays that slept the night before, not stays arriving that day", async () => {
    mocks.findMany.mockResolvedValue([]);
    await buildBreakfastList(service);

    const where = mocks.findMany.mock.calls[0][0].where;
    // Started before the service morning and had not ended before it: the
    // departure morning is in, the arrival morning is out.
    expect(where.startDate).toEqual({ lt: new Date("2026-08-03T00:00:00.000Z") });
    expect(where.endDate).toEqual({ gte: new Date("2026-08-03T00:00:00.000Z") });
    expect(where.status).toBe("ACTIVE");
    expect(where.reservation.status).toEqual({ in: ["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"] });
  });

  it("reports the night the service covers", async () => {
    mocks.findMany.mockResolvedValue([]);
    const list = await buildBreakfastList(service);
    expect(list.nightOf).toBe("2026-08-02");
  });
});

describe("breakfast list rows", () => {
  afterEach(() => vi.clearAllMocks());

  it("orders by room number so the floor can be worked in sequence", async () => {
    mocks.findMany.mockResolvedValue([
      allocation({ id: 2, roomUnit: { code: "R11", floor: 1 }, reservation: { id: 2 } }),
      allocation({ id: 1, roomUnit: { code: "R2", floor: 1 }, reservation: { id: 1 } }),
      allocation({ id: 3, roomUnit: null, reservation: { id: 3 } }),
    ]);
    const list = await buildBreakfastList(service);
    // Natural numeric order, and unassigned rooms last: they need the desk
    // before they need the kitchen.
    expect(list.rows.map((row) => row.roomNo)).toEqual(["R2", "R11", ""]);
    expect(list.rows[2].remark).toContain("room not assigned");
  });

  it("counts a party once however many rooms it holds", async () => {
    mocks.findMany.mockResolvedValue([
      allocation({ id: 1, roomUnit: { code: "R1", floor: 1 } }),
      allocation({ id: 2, roomUnit: { code: "R2", floor: 1 } }),
    ]);
    const list = await buildBreakfastList(service);

    expect(list.rows).toHaveLength(2);
    expect(list.totals.rooms).toBe(2);
    expect(list.totals.parties).toBe(1);
    // 2 adults + 1 child counted once, not doubled across the two rooms.
    expect(list.totals.covers).toBe(3);
    expect(list.rows[0].remark).toContain("party over 2 rooms");
  });

  it("flags the departure morning, which is served and leaving in the same hour", async () => {
    mocks.findMany.mockResolvedValue([
      allocation({ reservation: { checkOut: new Date("2026-08-03T00:00:00.000Z") } }),
    ]);
    const list = await buildBreakfastList(service);
    expect(list.rows[0].remark).toContain("departing today");
  });

  it("lists a room with no meal plan as Verify instead of dropping it", async () => {
    mocks.findMany.mockResolvedValue([allocation({ mealPlan: null })]);
    const list = await buildBreakfastList(service);

    expect(list.rows[0].mealPlanLabel).toBe("Verify");
    expect(list.rows[0].entitled).toBe(false);
    expect(list.totals.unverified).toBe(1);
    expect(list.totals.rooms).toBe(1);
  });

  it("treats half and full board as entitled, room only as not", async () => {
    mocks.findMany.mockResolvedValue([
      allocation({ id: 1, mealPlan: "HALF_BOARD", roomUnit: { code: "R1", floor: 1 }, reservation: { id: 1 } }),
      allocation({ id: 2, mealPlan: "FULL_BOARD", roomUnit: { code: "R2", floor: 1 }, reservation: { id: 2 } }),
      allocation({ id: 3, mealPlan: "ROOM_ONLY", roomUnit: { code: "R3", floor: 1 }, reservation: { id: 3 } }),
    ]);
    const list = await buildBreakfastList(service);

    expect(list.rows.map((row) => row.entitled)).toEqual([true, true, false]);
    expect(list.totals.entitledRooms).toBe(2);
    expect(list.totals.entitledCovers).toBe(6);
    // Covers still count everyone in the house, entitled or not.
    expect(list.totals.covers).toBe(9);
  });

  it("drops unentitled rooms only when the caller asks for entitled only", async () => {
    mocks.findMany.mockResolvedValue([
      allocation({ id: 1, mealPlan: "BREAKFAST", roomUnit: { code: "R1", floor: 1 }, reservation: { id: 1 } }),
      allocation({ id: 2, mealPlan: "ROOM_ONLY", roomUnit: { code: "R2", floor: 1 }, reservation: { id: 2 } }),
    ]);
    const list = await buildBreakfastList({ ...service, entitledOnly: true });

    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].roomNo).toBe("R1");
    expect(list.totals.covers).toBe(3);
  });

  it("marks a stay that never checked in, so the desk can chase it before service", async () => {
    mocks.findMany.mockResolvedValue([allocation({ reservation: { status: "CONFIRMED" } })]);
    const list = await buildBreakfastList(service);
    expect(list.rows[0].remark).toContain("not checked in");
  });

  it("numbers rows from one in display order", async () => {
    mocks.findMany.mockResolvedValue([
      allocation({ id: 1, roomUnit: { code: "R9", floor: 1 }, reservation: { id: 1 } }),
      allocation({ id: 2, roomUnit: { code: "R1", floor: 1 }, reservation: { id: 2 } }),
    ]);
    const list = await buildBreakfastList(service);
    expect(list.rows.map((row) => row.sn)).toEqual([1, 2]);
    expect(list.rows[0].roomNo).toBe("R1");
  });
});

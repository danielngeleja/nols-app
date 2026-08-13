import { beforeEach, describe, expect, it, vi } from "vitest";
import { assignGroupRooms } from "./nrmsRoomAssignment.js";

const availability = vi.hoisted(() => ({ findUnitConflicts: vi.fn() }));

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: {}, prisma: {} }));
vi.mock("./nrmsAvailability.js", () => availability);

const START = new Date("2026-09-01T00:00:00.000Z");
const END = new Date("2026-09-04T00:00:00.000Z");

type MemberSpec = { id: number; name: string; allocationId: number; roomTypeId: number; roomUnitId?: number | null };
type UnitSpec = { id: number; code: string; roomTypeId: number; housekeepingStatus?: string };

function fakeTx(members: MemberSpec[], units: UnitSpec[]) {
  return {
    updates: [] as Array<{ id: number; roomUnitId: number }>,
    reservation: {
      findMany: vi.fn().mockResolvedValue(
        members.map((member) => ({
          id: member.id,
          guestProfile: { fullName: member.name },
          allocations: [{ id: member.allocationId, roomTypeId: member.roomTypeId, roomUnitId: member.roomUnitId ?? null, startDate: START, endDate: END }],
        })),
      ),
    },
    roomUnit: {
      findMany: vi.fn().mockResolvedValue(units.map((unit) => ({ housekeepingStatus: "CLEAN", ...unit }))),
    },
    reservationRoomAllocation: {
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        tx.updates.push({ id: where.id, roomUnitId: data.roomUnitId });
        return { id: where.id };
      }),
    },
  } as any;
}

let tx: any;
const args = { groupId: 5, propertyId: 1, ownerId: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  availability.findUnitConflicts.mockResolvedValue([]);
});

describe("group room assignment", () => {
  it("fills every unassigned stay in one pass", async () => {
    tx = fakeTx(
      [
        { id: 10, name: "Amina Juma", allocationId: 100, roomTypeId: 7 },
        { id: 11, name: "John Moshi", allocationId: 101, roomTypeId: 7 },
      ],
      [
        { id: 900, code: "R101", roomTypeId: 7 },
        { id: 901, code: "R102", roomTypeId: 7 },
      ],
    );

    const result = await assignGroupRooms(tx, { ...args, autoAssignRemaining: true });

    expect(result.failed).toEqual([]);
    expect(result.assigned.map((row) => row.roomUnitCode)).toEqual(["R101", "R102"]);
    expect(tx.updates).toEqual([{ id: 100, roomUnitId: 900 }, { id: 101, roomUnitId: 901 }]);
  });

  it("hands out ready rooms before rooms housekeeping has not finished", async () => {
    tx = fakeTx(
      [{ id: 10, name: "Amina Juma", allocationId: 100, roomTypeId: 7 }],
      [
        { id: 900, code: "R101", roomTypeId: 7, housekeepingStatus: "DIRTY" },
        { id: 901, code: "R102", roomTypeId: 7, housekeepingStatus: "INSPECTED" },
      ],
    );

    const result = await assignGroupRooms(tx, { ...args, autoAssignRemaining: true });

    expect(result.assigned[0]?.roomUnitCode).toBe("R102");
  });

  it("never gives the same room to two guests in one batch", async () => {
    tx = fakeTx(
      [
        { id: 10, name: "Amina Juma", allocationId: 100, roomTypeId: 7 },
        { id: 11, name: "John Moshi", allocationId: 101, roomTypeId: 7 },
      ],
      [{ id: 900, code: "R101", roomTypeId: 7 }],
    );

    const result = await assignGroupRooms(tx, { ...args, autoAssignRemaining: true });

    expect(result.assigned).toHaveLength(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ reservationId: 11, guestName: "John Moshi", code: "NO_ROOM_FREE" }),
    ]);
  });

  it("skips a room that is already booked for these dates", async () => {
    tx = fakeTx(
      [{ id: 10, name: "Amina Juma", allocationId: 100, roomTypeId: 7 }],
      [
        { id: 900, code: "R101", roomTypeId: 7 },
        { id: 901, code: "R102", roomTypeId: 7 },
      ],
    );
    availability.findUnitConflicts.mockImplementation(async (roomUnitId: number) => (roomUnitId === 900 ? [{ id: 1 }] : []));

    const result = await assignGroupRooms(tx, { ...args, autoAssignRemaining: true });

    expect(result.assigned[0]?.roomUnitCode).toBe("R102");
  });

  it("leaves a stay that already has its room alone", async () => {
    tx = fakeTx(
      [{ id: 10, name: "Amina Juma", allocationId: 100, roomTypeId: 7, roomUnitId: 900 }],
      [
        { id: 900, code: "R101", roomTypeId: 7 },
        { id: 901, code: "R102", roomTypeId: 7 },
      ],
    );

    const result = await assignGroupRooms(tx, { ...args, autoAssignRemaining: true });

    expect(result.assigned).toEqual([]);
    expect(tx.updates).toEqual([]);
  });

  it("refuses a room of the wrong type", async () => {
    tx = fakeTx(
      [{ id: 10, name: "Amina Juma", allocationId: 100, roomTypeId: 7 }],
      [{ id: 950, code: "S1", roomTypeId: 8 }],
    );

    const result = await assignGroupRooms(tx, { ...args, requested: [{ allocationId: 100, roomUnitId: 950 }] });

    expect(result.failed).toEqual([expect.objectContaining({ code: "ROOM_TYPE_MISMATCH" })]);
    expect(tx.updates).toEqual([]);
  });

  it("refuses a room the desk already gave to someone else in the same batch", async () => {
    tx = fakeTx(
      [
        { id: 10, name: "Amina Juma", allocationId: 100, roomTypeId: 7 },
        { id: 11, name: "John Moshi", allocationId: 101, roomTypeId: 7 },
      ],
      [{ id: 900, code: "R101", roomTypeId: 7 }],
    );

    const result = await assignGroupRooms(tx, {
      ...args,
      requested: [{ allocationId: 100, roomUnitId: 900 }, { allocationId: 101, roomUnitId: 900 }],
    });

    expect(result.assigned).toHaveLength(1);
    expect(result.failed).toEqual([expect.objectContaining({ guestName: "John Moshi", code: "ROOM_TAKEN_IN_BATCH" })]);
  });

  it("lets one guest take the room another guest is moved out of", async () => {
    tx = fakeTx(
      [
        { id: 10, name: "Amina Juma", allocationId: 100, roomTypeId: 7, roomUnitId: 900 },
        { id: 11, name: "John Moshi", allocationId: 101, roomTypeId: 7 },
      ],
      [
        { id: 900, code: "R101", roomTypeId: 7 },
        { id: 901, code: "R102", roomTypeId: 7 },
      ],
    );

    const result = await assignGroupRooms(tx, {
      ...args,
      requested: [{ allocationId: 100, roomUnitId: 901 }, { allocationId: 101, roomUnitId: 900 }],
    });

    expect(result.failed).toEqual([]);
    expect(tx.updates).toEqual([{ id: 100, roomUnitId: 901 }, { id: 101, roomUnitId: 900 }]);
  });

  it("reports a stay that is not in the group instead of assigning it", async () => {
    tx = fakeTx([{ id: 10, name: "Amina Juma", allocationId: 100, roomTypeId: 7 }], [{ id: 900, code: "R101", roomTypeId: 7 }]);

    const result = await assignGroupRooms(tx, { ...args, requested: [{ allocationId: 555, roomUnitId: 900 }] });

    expect(result.failed).toEqual([expect.objectContaining({ code: "ALLOCATION_NOT_FOUND" })]);
  });
});

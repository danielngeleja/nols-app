import { describe, expect, it, vi } from "vitest";
import {
  dailyHousekeepingWindow,
  ensureDailyOccupiedCleaning,
  markRoomsDirtyOnCheckout,
  roleCanHousekeep,
  roleCanManageHousekeeping,
  roomReadyForCheckIn,
  setRoomHousekeepingStatus,
  taskActionAllowed,
} from "./nrmsHousekeeping.js";

describe("housekeeping roles and readiness", () => {
  it("lets housekeeping-capable roles work the board and keeps outlet staff out", () => {
    expect(roleCanHousekeep("HOUSEKEEPER")).toBe(true);
    expect(roleCanHousekeep("FRONT_DESK")).toBe(true);
    expect(roleCanHousekeep("BAR")).toBe(false);
    expect(roleCanHousekeep("RESTAURANT")).toBe(false);
  });

  it("reserves task management for the front desk and managers", () => {
    expect(roleCanManageHousekeeping("MANAGER")).toBe(true);
    expect(roleCanManageHousekeeping("HOUSEKEEPER")).toBe(false);
  });

  it("only clean or inspected rooms are ready for check-in", () => {
    expect(roomReadyForCheckIn("CLEAN")).toBe(true);
    expect(roomReadyForCheckIn("INSPECTED")).toBe(true);
    expect(roomReadyForCheckIn("DIRTY")).toBe(false);
    expect(roomReadyForCheckIn("IN_PROGRESS")).toBe(false);
  });

  it("enforces the task lifecycle", () => {
    expect(taskActionAllowed("OPEN", "START")).toBe(true);
    expect(taskActionAllowed("IN_PROGRESS", "START")).toBe(false);
    expect(taskActionAllowed("IN_PROGRESS", "COMPLETE")).toBe(true);
    expect(taskActionAllowed("DONE", "COMPLETE")).toBe(false);
    expect(taskActionAllowed("CANCELLED", "CANCEL")).toBe(false);
  });
});

describe("daily occupied-room housekeeping", () => {
  it("calculates the configured service time in East Africa time", () => {
    const window = dailyHousekeepingWindow(new Date("2026-07-17T06:00:00.000Z"), "11:00");
    expect(window.serviceDate.toISOString()).toBe("2026-07-16T21:00:00.000Z");
    expect(window.serviceAt.toISOString()).toBe("2026-07-17T08:00:00.000Z");
  });

  it("queues one daily clean for each clean occupied room after service time", async () => {
    const tx = {
      property: {
        findUnique: vi.fn().mockResolvedValue({ housekeepingDailyServiceEnabled: true, housekeepingDailyServiceTime: "11:00", housekeepingLastDailyServiceDate: null }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      reservationRoomAllocation: {
        findMany: vi.fn().mockResolvedValue([
          { roomUnitId: 4, reservationId: 90, roomUnit: { status: "ACTIVE", housekeepingStatus: "CLEAN" } },
          { roomUnitId: 6, reservationId: 91, roomUnit: { status: "ACTIVE", housekeepingStatus: "DIRTY" } },
        ]),
      },
      nrmsHousekeepingTask: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      roomUnit: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const client = { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const result = await ensureDailyOccupiedCleaning(client, 1, new Date("2026-07-17T08:05:00.000Z"));
    expect(result).toMatchObject({ due: true, processed: true, occupiedRooms: 2, scheduledRooms: 1 });
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 30_000 });
    expect(tx.nrmsHousekeepingTask.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ roomUnitId: 4, reservationId: 90, type: "DAILY_CLEAN", status: "OPEN" })],
      skipDuplicates: true,
    }));
    expect(tx.roomUnit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: [4] }, housekeepingStatus: { in: ["CLEAN", "INSPECTED"] } }),
      data: expect.objectContaining({ housekeepingStatus: "DIRTY" }),
    }));
  });

  it("does not run twice for the same service day", async () => {
    const serviceDate = new Date("2026-07-16T21:00:00.000Z");
    const tx = {
      property: {
        findUnique: vi.fn().mockResolvedValue({ housekeepingDailyServiceEnabled: true, housekeepingDailyServiceTime: "11:00", housekeepingLastDailyServiceDate: serviceDate }),
        updateMany: vi.fn(),
      },
      reservationRoomAllocation: { findMany: vi.fn() },
      nrmsHousekeepingTask: { createMany: vi.fn() },
      roomUnit: { updateMany: vi.fn() },
    };
    const client = { $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) };
    const result = await ensureDailyOccupiedCleaning(client, 1, new Date("2026-07-17T09:00:00.000Z"));
    expect(result).toMatchObject({ due: true, processed: false, scheduledRooms: 0 });
    expect(tx.property.updateMany).not.toHaveBeenCalled();
    expect(tx.reservationRoomAllocation.findMany).not.toHaveBeenCalled();
  });
});

describe("manual room status changes", () => {
  it("marking a room clean closes its open cleaning tasks", async () => {
    const tx = {
      roomUnit: { update: vi.fn().mockResolvedValue({}) },
      nrmsHousekeepingTask: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    await setRoomHousekeepingStatus(tx, 7, "CLEAN", 3);
    expect(tx.roomUnit.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 }, data: expect.objectContaining({ housekeepingStatus: "CLEAN" }) }));
    expect(tx.nrmsHousekeepingTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ roomUnitId: 7, type: { in: ["TURNOVER", "DAILY_CLEAN", "DEEP_CLEAN"] } }),
      data: expect.objectContaining({ status: "DONE", completedById: 3 }),
    }));
  });

  it("marking a room dirty leaves existing tasks untouched", async () => {
    const tx = {
      roomUnit: { update: vi.fn().mockResolvedValue({}) },
      nrmsHousekeepingTask: { updateMany: vi.fn() },
    };
    await setRoomHousekeepingStatus(tx, 7, "DIRTY", 3);
    expect(tx.nrmsHousekeepingTask.updateMany).not.toHaveBeenCalled();
  });
});

describe("checkout housekeeping hook", () => {
  it("marks occupied units dirty and queues one turnover task each", async () => {
    const tx = {
      roomUnit: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      nrmsHousekeepingTask: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    };
    await markRoomsDirtyOnCheckout(tx, { propertyId: 1, reservationId: 9, roomUnitIds: [4, 6, 6], actorId: 2 });
    expect(tx.roomUnit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: [4, 6] }, propertyId: 1 },
      data: expect.objectContaining({ housekeepingStatus: "DIRTY" }),
    }));
    const created = tx.nrmsHousekeepingTask.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ propertyId: 1, reservationId: 9, roomUnitId: 4, type: "TURNOVER", status: "OPEN" });
  });

  it("never duplicates a turnover when the room already has open cleaning work", async () => {
    const tx = {
      roomUnit: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      nrmsHousekeepingTask: {
        findMany: vi.fn().mockResolvedValue([{ roomUnitId: 4 }]),
        createMany: vi.fn(),
      },
    };
    await markRoomsDirtyOnCheckout(tx, { propertyId: 1, reservationId: 9, roomUnitIds: [4], actorId: 2 });
    expect(tx.nrmsHousekeepingTask.createMany).not.toHaveBeenCalled();
  });

  it("does nothing for stays without unit-level allocations", async () => {
    const tx = {
      roomUnit: { updateMany: vi.fn() },
      nrmsHousekeepingTask: { findMany: vi.fn(), createMany: vi.fn() },
    };
    await markRoomsDirtyOnCheckout(tx, { propertyId: 1, reservationId: 9, roomUnitIds: [], actorId: 2 });
    expect(tx.roomUnit.updateMany).not.toHaveBeenCalled();
  });
});

// apps/api/src/lib/nrmsHousekeeping.ts
// Housekeeping rules: room cleanliness cycle, task lifecycle and the
// checkout hook. RoomUnit.housekeepingStatus is the live state; tasks are the
// audit of who cleaned what and when.

export const HOUSEKEEPING_STATUSES = ["CLEAN", "DIRTY", "IN_PROGRESS", "INSPECTED"] as const;
export const HOUSEKEEPING_TASK_TYPES = ["TURNOVER", "DAILY_CLEAN", "DEEP_CLEAN", "MAINTENANCE"] as const;
export const HOUSEKEEPING_TASK_PRIORITIES = ["NORMAL", "HIGH"] as const;

export type HousekeepingStatus = (typeof HOUSEKEEPING_STATUSES)[number];
export type HousekeepingTaskType = (typeof HOUSEKEEPING_TASK_TYPES)[number];

/** Task types whose completion means the room is clean again. */
const CLEANING_TASK_TYPES = ["TURNOVER", "DAILY_CLEAN", "DEEP_CLEAN"];
const OPEN_TASK_STATUSES = ["OPEN", "IN_PROGRESS"];
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DEFAULT_DAILY_SERVICE_TIME = "11:00";
const DAILY_HOUSEKEEPING_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

export type DailyHousekeepingResult = {
  due: boolean;
  processed: boolean;
  occupiedRooms: number;
  scheduledRooms: number;
  serviceDate: Date;
  serviceAt: Date;
};

function dailyServiceMinutes(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return 11 * 60;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59
    ? hours * 60 + minutes
    : 11 * 60;
}

/** Convert an instant into the current East Africa service day and configured run time. */
export function dailyHousekeepingWindow(now: Date, serviceTime = DEFAULT_DAILY_SERVICE_TIME) {
  const local = new Date(now.getTime() + EAT_OFFSET_MS);
  const serviceDate = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - EAT_OFFSET_MS);
  const serviceAt = new Date(serviceDate.getTime() + dailyServiceMinutes(serviceTime) * 60 * 1000);
  return { serviceDate, serviceAt, nextServiceAt: now < serviceAt ? serviceAt : new Date(serviceAt.getTime() + 24 * 60 * 60 * 1000) };
}

/**
 * Once the configured service time is reached, clean/inspected rooms belonging
 * to checked-in stays enter one DAILY_CLEAN cycle. A property-level atomic
 * claim prevents duplicate work across API requests and worker instances.
 */
export async function ensureDailyOccupiedCleaning(
  client: any,
  propertyId: number,
  now = new Date(),
): Promise<DailyHousekeepingResult> {
  return client.$transaction(async (tx: any) => {
    const property = await tx.property.findUnique({
      where: { id: propertyId },
      select: {
        housekeepingDailyServiceEnabled: true,
        housekeepingDailyServiceTime: true,
        housekeepingLastDailyServiceDate: true,
      },
    });
    const window = dailyHousekeepingWindow(now, property?.housekeepingDailyServiceTime);
    const empty = { due: false, processed: false, occupiedRooms: 0, scheduledRooms: 0, serviceDate: window.serviceDate, serviceAt: window.serviceAt };
    if (!property?.housekeepingDailyServiceEnabled || now < window.serviceAt) return empty;
    if (property.housekeepingLastDailyServiceDate && property.housekeepingLastDailyServiceDate >= window.serviceDate) {
      return { ...empty, due: true };
    }

    const claimed = await tx.property.updateMany({
      where: {
        id: propertyId,
        OR: [
          { housekeepingLastDailyServiceDate: null },
          { housekeepingLastDailyServiceDate: { lt: window.serviceDate } },
        ],
      },
      data: { housekeepingLastDailyServiceDate: window.serviceDate },
    });
    if (claimed.count !== 1) return { ...empty, due: true };

    const allocations = await tx.reservationRoomAllocation.findMany({
      where: {
        status: "ACTIVE",
        roomUnitId: { not: null },
        reservation: { propertyId, status: "CHECKED_IN" },
      },
      select: {
        roomUnitId: true,
        reservationId: true,
        roomUnit: { select: { status: true, housekeepingStatus: true } },
      },
    });
    const occupiedByRoom = new Map<number, number>();
    for (const allocation of allocations) {
      if (allocation.roomUnitId != null) occupiedByRoom.set(allocation.roomUnitId, allocation.reservationId);
    }
    const candidates = allocations.filter((allocation: any) =>
      allocation.roomUnitId != null
      && allocation.roomUnit?.status === "ACTIVE"
      && ["CLEAN", "INSPECTED"].includes(allocation.roomUnit?.housekeepingStatus),
    );
    const candidateByRoom = new Map<number, number>();
    for (const allocation of candidates) candidateByRoom.set(allocation.roomUnitId, allocation.reservationId);
    const roomUnitIds = [...candidateByRoom.keys()];

    if (roomUnitIds.length) {
      await tx.nrmsHousekeepingTask.createMany({
        data: roomUnitIds.map((roomUnitId) => ({
          propertyId,
          roomUnitId,
          reservationId: candidateByRoom.get(roomUnitId),
          type: "DAILY_CLEAN",
          status: "OPEN",
          priority: "NORMAL",
          serviceDate: window.serviceDate,
        })),
        skipDuplicates: true,
      });
      await tx.roomUnit.updateMany({
        where: { id: { in: roomUnitIds }, propertyId, status: "ACTIVE", housekeepingStatus: { in: ["CLEAN", "INSPECTED"] } },
        data: { housekeepingStatus: "DIRTY", housekeepingUpdatedAt: now },
      });
    }

    return {
      due: true,
      processed: true,
      occupiedRooms: occupiedByRoom.size,
      scheduledRooms: roomUnitIds.length,
      serviceDate: window.serviceDate,
      serviceAt: window.serviceAt,
    };
  }, DAILY_HOUSEKEEPING_TX_OPTIONS);
}

/** Roles allowed to work the housekeeping board. */
export function roleCanHousekeep(role: string): boolean {
  return ["OWNER", "MANAGER", "FRONT_DESK", "HOUSEKEEPER"].includes(role);
}

/** Roles allowed to create, assign and cancel tasks (housekeepers only work them). */
export function roleCanManageHousekeeping(role: string): boolean {
  return ["OWNER", "MANAGER", "FRONT_DESK"].includes(role);
}

/** A guest can move into the room without a warning. */
export function roomReadyForCheckIn(housekeepingStatus: string): boolean {
  return housekeepingStatus === "CLEAN" || housekeepingStatus === "INSPECTED";
}

export function isCleaningTaskType(type: string): boolean {
  return CLEANING_TASK_TYPES.includes(type);
}

export function taskActionAllowed(currentStatus: string, action: "START" | "COMPLETE" | "CANCEL"): boolean {
  if (action === "START") return currentStatus === "OPEN";
  if (action === "COMPLETE") return OPEN_TASK_STATUSES.includes(currentStatus);
  return OPEN_TASK_STATUSES.includes(currentStatus);
}

/**
 * Set a room's cleanliness state. Marking a room CLEAN or INSPECTED by hand
 * also closes its open cleaning tasks so the board never shows stale work;
 * MAINTENANCE tasks stay open because cleanliness does not fix a fault.
 */
export async function setRoomHousekeepingStatus(
  tx: any,
  roomUnitId: number,
  status: HousekeepingStatus,
  actorId: number,
): Promise<void> {
  await tx.roomUnit.update({
    where: { id: roomUnitId },
    data: { housekeepingStatus: status, housekeepingUpdatedAt: new Date() },
  });
  if (status === "CLEAN" || status === "INSPECTED") {
    await tx.nrmsHousekeepingTask.updateMany({
      where: { roomUnitId, status: { in: OPEN_TASK_STATUSES }, type: { in: CLEANING_TASK_TYPES } },
      data: { status: "DONE", completedById: actorId, completedAt: new Date() },
    });
  }
}

/**
 * Checkout hook: every unit the stay occupied becomes DIRTY and gets one
 * TURNOVER task (skipped when the room already has an open cleaning task, so
 * repeated checkouts of neighbouring stays never pile up duplicate work).
 */
export async function markRoomsDirtyOnCheckout(
  tx: any,
  input: { propertyId: number; reservationId: number; roomUnitIds: number[]; actorId: number },
): Promise<void> {
  const roomUnitIds = [...new Set(input.roomUnitIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (!roomUnitIds.length) return;
  await tx.roomUnit.updateMany({
    where: { id: { in: roomUnitIds }, propertyId: input.propertyId },
    data: { housekeepingStatus: "DIRTY", housekeepingUpdatedAt: new Date() },
  });
  const openCleaning = await tx.nrmsHousekeepingTask.findMany({
    where: { roomUnitId: { in: roomUnitIds }, status: { in: OPEN_TASK_STATUSES }, type: { in: CLEANING_TASK_TYPES } },
    select: { roomUnitId: true },
  });
  const alreadyQueued = new Set(openCleaning.map((task: { roomUnitId: number }) => task.roomUnitId));
  const data = roomUnitIds
    .filter((roomUnitId) => !alreadyQueued.has(roomUnitId))
    .map((roomUnitId) => ({
      propertyId: input.propertyId,
      roomUnitId,
      reservationId: input.reservationId,
      type: "TURNOVER",
      status: "OPEN",
      priority: "NORMAL",
      createdById: input.actorId,
    }));
  if (data.length) await tx.nrmsHousekeepingTask.createMany({ data });
}

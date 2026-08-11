// apps/api/src/lib/nrmsRoomAssignment.ts
//
// Giving a whole party its rooms in one pass.
//
// A rooming list confirms into reservations that carry a room type but no room
// number, because at agreement time nobody knows which door each guest walks
// through. Check-in then refuses any stay whose allocation has no unit, so a
// twenty-name group would otherwise have to be opened twenty times, one
// reservation at a time, before the bus could be checked in.
//
// Assignment is an inventory decision, so every caller must hold the property
// inventory lock: two clerks assigning the last twin room at the same moment
// must not both succeed.
import { findUnitConflicts } from "./nrmsAvailability.js";

/** Only a stay that has not started can be given a different room this way. */
export const ASSIGNABLE_STATUSES = ["CONFIRMED"];

/** A room the desk can hand over without housekeeping getting in the way. */
const READY_HOUSEKEEPING = ["CLEAN", "INSPECTED"];

export type AssignmentRequest = { allocationId: number; roomUnitId: number };

export type AssignmentOutcome = {
  allocationId: number;
  reservationId: number;
  guestName: string;
  roomUnitId?: number;
  roomUnitCode?: string;
  error?: string;
  code?: string;
};

export type AssignGroupRoomsArgs = {
  groupId: number;
  propertyId: number;
  ownerId: number;
  /** Explicit choices from the desk. Applied before anything is auto-filled. */
  requested?: AssignmentRequest[];
  /** Fill every allocation still without a room, cleanest ready room first. */
  autoAssignRemaining?: boolean;
};

type MemberAllocation = {
  allocationId: number;
  reservationId: number;
  guestName: string;
  roomTypeId: number;
  roomUnitId: number | null;
  startDate: Date;
  endDate: Date;
};

type Candidate = { id: number; code: string; roomTypeId: number; housekeepingStatus: string };

/**
 * Ready rooms first so the desk is not handed a group that check-in will then
 * refuse on housekeeping grounds, and a stable order after that so repeating
 * the same auto-assign produces the same rooms.
 */
function preferenceOrder(a: Candidate, b: Candidate): number {
  const aReady = READY_HOUSEKEEPING.includes(a.housekeepingStatus) ? 0 : 1;
  const bReady = READY_HOUSEKEEPING.includes(b.housekeepingStatus) ? 0 : 1;
  return aReady - bReady || a.id - b.id;
}

async function loadGroupAllocations(tx: any, groupId: number, propertyId: number, ownerId: number): Promise<MemberAllocation[]> {
  const members = await tx.reservation.findMany({
    where: { groupId, propertyId, ownerId, status: { in: ASSIGNABLE_STATUSES } },
    select: {
      id: true,
      guestProfile: { select: { fullName: true } },
      allocations: {
        where: { status: "ACTIVE" },
        select: { id: true, roomTypeId: true, roomUnitId: true, startDate: true, endDate: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: [{ checkIn: "asc" }, { id: "asc" }],
  });
  return members.flatMap((member: any) =>
    (member.allocations ?? []).map((allocation: any) => ({
      allocationId: allocation.id,
      reservationId: member.id,
      guestName: member.guestProfile?.fullName ?? "Guest",
      roomTypeId: allocation.roomTypeId,
      roomUnitId: allocation.roomUnitId,
      startDate: allocation.startDate,
      endDate: allocation.endDate,
    })),
  );
}

/**
 * Assigns rooms across one group. Explicit choices are honoured first so a desk
 * that already promised room 204 to a named guest keeps it, then anything still
 * unassigned is filled automatically when asked for.
 *
 * Every failure is reported against its own guest rather than thrown, because a
 * party of twenty should not lose nineteen good assignments to one clash.
 */
export async function assignGroupRooms(tx: any, args: AssignGroupRoomsArgs): Promise<{ assigned: AssignmentOutcome[]; failed: AssignmentOutcome[] }> {
  const allocations = await loadGroupAllocations(tx, args.groupId, args.propertyId, args.ownerId);
  const byAllocationId = new Map(allocations.map((allocation) => [allocation.allocationId, allocation]));

  const assigned: AssignmentOutcome[] = [];
  const failed: AssignmentOutcome[] = [];
  // Rooms handed out inside this batch. findUnitConflicts cannot see them,
  // because nothing is written until each assignment is applied.
  const taken = new Set<number>(allocations.map((allocation) => allocation.roomUnitId).filter((id): id is number => id != null));

  const roomTypeIds = Array.from(new Set(allocations.map((allocation) => allocation.roomTypeId)));
  const candidates: Candidate[] = roomTypeIds.length
    ? await tx.roomUnit.findMany({
        where: { propertyId: args.propertyId, roomTypeId: { in: roomTypeIds }, status: "ACTIVE" },
        select: { id: true, code: true, roomTypeId: true, housekeepingStatus: true },
      })
    : [];
  const candidatesByType = new Map<number, Candidate[]>();
  for (const candidate of candidates) {
    const list = candidatesByType.get(candidate.roomTypeId) ?? [];
    list.push(candidate);
    candidatesByType.set(candidate.roomTypeId, list);
  }
  for (const list of candidatesByType.values()) list.sort(preferenceOrder);

  const apply = async (allocation: MemberAllocation, unit: Candidate) => {
    await tx.reservationRoomAllocation.update({ where: { id: allocation.allocationId }, data: { roomUnitId: unit.id } });
    // Freeing the room this guest used to hold keeps a swap inside one batch
    // honest: room 204 released here can be taken by the next guest below.
    if (allocation.roomUnitId != null && allocation.roomUnitId !== unit.id) taken.delete(allocation.roomUnitId);
    taken.add(unit.id);
    allocation.roomUnitId = unit.id;
    assigned.push({
      allocationId: allocation.allocationId,
      reservationId: allocation.reservationId,
      guestName: allocation.guestName,
      roomUnitId: unit.id,
      roomUnitCode: unit.code,
    });
  };

  for (const request of args.requested ?? []) {
    const allocation = byAllocationId.get(request.allocationId);
    if (!allocation) {
      failed.push({ allocationId: request.allocationId, reservationId: 0, guestName: "Guest", error: "That stay is not in this group, or it has already started", code: "ALLOCATION_NOT_FOUND" });
      continue;
    }
    const unit = candidates.find((candidate) => candidate.id === request.roomUnitId);
    if (!unit || unit.roomTypeId !== allocation.roomTypeId) {
      failed.push({ ...outcomeBase(allocation), error: "That room is not an active room of the type this guest booked", code: "ROOM_TYPE_MISMATCH" });
      continue;
    }
    if (allocation.roomUnitId === unit.id) {
      assigned.push({ ...outcomeBase(allocation), roomUnitId: unit.id, roomUnitCode: unit.code });
      continue;
    }
    if (taken.has(unit.id)) {
      failed.push({ ...outcomeBase(allocation), error: `Room ${unit.code} is already going to someone else in this group`, code: "ROOM_TAKEN_IN_BATCH" });
      continue;
    }
    const conflicts = await findUnitConflicts(unit.id, allocation.startDate, allocation.endDate, { excludeReservationId: allocation.reservationId, db: tx });
    if (conflicts.length > 0) {
      failed.push({ ...outcomeBase(allocation), error: `Room ${unit.code} is already taken for these dates`, code: "ROOM_CONFLICT" });
      continue;
    }
    await apply(allocation, unit);
  }

  if (args.autoAssignRemaining) {
    const handled = new Set([...assigned, ...failed].map((outcome) => outcome.allocationId));
    for (const allocation of allocations) {
      if (handled.has(allocation.allocationId) || allocation.roomUnitId != null) continue;
      let placed = false;
      for (const unit of candidatesByType.get(allocation.roomTypeId) ?? []) {
        if (taken.has(unit.id)) continue;
        const conflicts = await findUnitConflicts(unit.id, allocation.startDate, allocation.endDate, { excludeReservationId: allocation.reservationId, db: tx });
        if (conflicts.length > 0) continue;
        await apply(allocation, unit);
        placed = true;
        break;
      }
      if (!placed) {
        failed.push({ ...outcomeBase(allocation), error: "No room of this type is free for these dates", code: "NO_ROOM_FREE" });
      }
    }
  }

  return { assigned, failed };
}

function outcomeBase(allocation: MemberAllocation) {
  return { allocationId: allocation.allocationId, reservationId: allocation.reservationId, guestName: allocation.guestName };
}

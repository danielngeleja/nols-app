import { findUnitConflicts, lockPropertyInventory } from "./nrmsAvailability.js";
import { sanitizeText } from "./sanitize.js";
/** Called inside the assignment transaction; re-read allocation after locking. */
export async function moveRoomAllocation(tx: any, { reservation, unit, allocationId, roomUnitId, ownerId, reason }: {
    reservation: {
        id: number;
        propertyId: number;
        bookingId?: number | null;
    };
    unit: {
        id: number;
        roomTypeId: number;
        code: string;
    };
    allocationId: number;
    roomUnitId: number;
    ownerId: number;
    reason?: string | null;
}) {
    await lockPropertyInventory(tx, reservation.propertyId);
    const current = await tx.reservationRoomAllocation.findFirst({
        where: { id: allocationId, reservationId: reservation.id, status: "ACTIVE", reservation: { status: { in: ["CONFIRMED", "CHECKED_IN"] } } },
    });
    if (!current)
        return { stale: true };
    const freshUnit = await tx.roomUnit.findFirst({ where: { id: roomUnitId, propertyId: reservation.propertyId, status: "ACTIVE" }, select: { id: true, roomTypeId: true, code: true } });
    if (!freshUnit || freshUnit.roomTypeId !== unit.roomTypeId)
        return { stale: true };
    const conflicts = await findUnitConflicts(roomUnitId, current.startDate, current.endDate, {
        excludeAllocationId: current.id,
        excludeBookingId: reservation.bookingId ?? undefined,
        db: tx,
    });
    if (conflicts.length > 0)
        return { conflict: { roomUnitId, conflicts } };
    await tx.reservationRoomAllocation.update({ where: { id: current.id }, data: { status: "RELEASED" } });
    const next = await tx.reservationRoomAllocation.create({
        data: {
            reservationId: reservation.id,
            roomTypeId: unit.roomTypeId,
            roomUnitId: unit.id,
            startDate: current.startDate,
            endDate: current.endDate,
            ratePlanId: current.ratePlanId,
            mealPlan: current.mealPlan,
        },
    });
    await tx.reservationEvent.create({
        data: {
            reservationId: reservation.id,
            type: "ROOM_MOVED",
            actorId: ownerId,
            data: {
                fromAllocationId: current.id,
                fromRoomUnitId: current.roomUnitId,
                toRoomUnitId: unit.id,
                toRoomCode: unit.code,
                ...(reason ? { reason: sanitizeText(reason) } : {}),
            },
        },
    });
    return { allocationId: next.id };
}

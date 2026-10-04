import { beforeEach, describe, expect, it, vi } from "vitest";
import { moveRoomAllocation } from "./nrmsMoveRoom.js";
const availability = vi.hoisted(() => ({ findUnitConflicts: vi.fn(), lockPropertyInventory: vi.fn() }));
vi.mock("./nrmsAvailability.js", () => availability);
const unit = { id: 7, roomTypeId: 3, code: "R7" };
const args = { reservation: { id: 1, propertyId: 2, bookingId: 10 }, unit, allocationId: 5, roomUnitId: 7, ownerId: 8 };
function fixture() {
    return {
        roomUnit: { findFirst: vi.fn().mockResolvedValue(unit) },
        reservationRoomAllocation: {
            findFirst: vi.fn().mockResolvedValue({ id: 5, roomUnitId: null, startDate: new Date('2026-09-20'), endDate: new Date('2026-09-22'), ratePlanId: 12, mealPlan: 'BREAKFAST' }),
            update: vi.fn(), create: vi.fn().mockResolvedValue({ id: 6 }),
        },
        reservationEvent: { create: vi.fn() },
    };
}
beforeEach(() => { vi.clearAllMocks(); availability.findUnitConflicts.mockResolvedValue([]); });
describe('room assignment transaction', () => {
    it('retains the sold rate and meal entitlement', async () => {
        const tx = fixture();
        await moveRoomAllocation(tx, args);
        expect(tx.reservationRoomAllocation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ratePlanId: 12, mealPlan: 'BREAKFAST' }) });
        expect(availability.lockPropertyInventory.mock.invocationCallOrder[0]).toBeLessThan(tx.reservationRoomAllocation.findFirst.mock.invocationCallOrder[0]);
    });
    it('refuses an allocation replaced by another clerk', async () => {
        const tx = fixture();
        tx.reservationRoomAllocation.findFirst.mockResolvedValue(null);
        expect(await moveRoomAllocation(tx, args)).toEqual({ stale: true });
        expect(tx.reservationRoomAllocation.create).not.toHaveBeenCalled();
    });
    it('checks sibling allocations while excluding the linked marketplace booking', async () => {
        const tx = fixture();
        availability.findUnitConflicts.mockResolvedValue([{ entryId: 1 }]);
        const result = await moveRoomAllocation(tx, args);
        expect(result).toHaveProperty('conflict');
        const options = availability.findUnitConflicts.mock.calls[0][3];
        expect(options).toMatchObject({ excludeAllocationId: 5, excludeBookingId: 10 });
        expect(options).not.toHaveProperty('excludeReservationId');
        expect(tx.reservationRoomAllocation.update).not.toHaveBeenCalled();
    });
    it('refuses a room disabled while the assignment was waiting', async () => {
        const tx = fixture();
        tx.roomUnit.findFirst.mockResolvedValue(null);
        expect(await moveRoomAllocation(tx, args)).toEqual({ stale: true });
        expect(tx.reservationRoomAllocation.create).not.toHaveBeenCalled();
    });
});

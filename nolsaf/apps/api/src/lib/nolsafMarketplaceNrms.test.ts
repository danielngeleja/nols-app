import { beforeEach, describe, expect, it, vi } from "vitest";

const computeDraftBookingAvailability = vi.hoisted(() => vi.fn());
const lockPropertyInventory = vi.hoisted(() => vi.fn());

vi.mock("./draftBookingAvailability.js", () => ({ computeDraftBookingAvailability }));
vi.mock("./nrmsAvailability.js", () => ({ lockPropertyInventory }));

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    propertyId: 7,
    status: "CONFIRMED",
    checkIn: new Date("2026-08-10T00:00:00.000Z"),
    checkOut: new Date("2026-08-12T00:00:00.000Z"),
    roomCode: "Suite-1",
    roomsQty: 1,
    guestName: "Amina Hassan",
    guestPhone: "+255700000001",
    nationality: "Tanzanian",
    cancelReason: null,
    property: { ownerId: 9, nrmsActivatedAt: new Date("2026-08-01T00:00:00.000Z") },
    user: { name: "Amina", fullName: "Amina Hassan", email: "amina@example.com", phone: "+255700000001", nationality: "Tanzanian" },
    nrmsReservation: null,
    ...overrides,
  };
}

function dbFor(value: any) {
  return {
    booking: { findUnique: vi.fn().mockResolvedValue(value), update: vi.fn() },
    reservation: { upsert: vi.fn().mockResolvedValue({ id: 100 }) },
    reservationEvent: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 200 }),
    },
    reservationRoomAllocation: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 1 }), updateMany: vi.fn() },
    roomUnit: { findFirst: vi.fn().mockResolvedValue({ id: 15, roomTypeId: 5 }) },
    roomType: { findFirst: vi.fn() },
    // Allocations now snapshot the meal plan they were sold on, resolved
    // through the property default when the booking names no plan.
    nrmsRatePlan: { findFirst: vi.fn().mockResolvedValue({ id: 21, mealPlan: "BREAKFAST" }) },
    guestProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 80 }),
      update: vi.fn(),
    },
  };
}

describe("NoLSAF marketplace to NRMS connection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not treat an unpaid NEW booking as an NRMS reservation", async () => {
    const db = dbFor(booking({ status: "NEW" }));
    const { syncNoLsafBookingToNrms } = await import("./nolsafMarketplaceNrms.js");

    await expect(syncNoLsafBookingToNrms(db, 42)).resolves.toBeNull();
    expect(db.reservation.upsert).not.toHaveBeenCalled();
    expect(db.reservationRoomAllocation.createMany).not.toHaveBeenCalled();
  });

  it("connects a confirmed booking once and assigns the matching physical room", async () => {
    const db = dbFor(booking());
    const { syncNoLsafBookingToNrms } = await import("./nolsafMarketplaceNrms.js");

    await syncNoLsafBookingToNrms(db, 42);

    expect(db.reservation.upsert).toHaveBeenCalledWith({
      where: { bookingId: 42 },
      update: expect.objectContaining({ source: "NOLSAF", status: "CONFIRMED", guestProfileId: 80 }),
      create: expect.objectContaining({
        bookingId: 42,
        propertyId: 7,
        ownerId: 9,
        source: "NOLSAF",
        attribution: "NOLSAF_MARKETPLACE",
        status: "CONFIRMED",
        guestProfileId: 80,
      }),
    });
    expect(db.reservation.upsert.mock.calls[0][0].create).not.toHaveProperty("events");
    expect(db.reservationEvent.create).toHaveBeenCalledWith({
      data: {
        reservationId: 100,
        type: "MARKETPLACE_CONNECTED",
        data: { bookingId: 42, source: "NOLSAF", status: "CONFIRMED" },
      },
    });
    expect(db.reservation.upsert.mock.invocationCallOrder[0]).toBeLessThan(db.reservationEvent.create.mock.invocationCallOrder[0]);
    expect(db.guestProfile.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        propertyId: 7,
        ownerId: 9,
        fullName: "Amina Hassan",
        phone: "+255700000001",
        email: "amina@example.com",
        nationality: "Tanzanian",
      }),
    });
    expect(db.reservationRoomAllocation.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ reservationId: 100, roomTypeId: 5, roomUnitId: 15, status: "ACTIVE" })],
    });
  });

  it("reuses a matching property guest profile and refreshes available identity fields", async () => {
    const db = dbFor(booking());
    db.guestProfile.findFirst.mockResolvedValue({ id: 81 });
    db.guestProfile.update.mockResolvedValue({ id: 81 });
    const { syncNoLsafBookingToNrms } = await import("./nolsafMarketplaceNrms.js");

    await syncNoLsafBookingToNrms(db, 42);

    expect(db.guestProfile.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ propertyId: 7, ownerId: 9 }),
    }));
    expect(db.guestProfile.update).toHaveBeenCalledWith({
      where: { id: 81 },
      data: expect.objectContaining({ fullName: "Amina Hassan", email: "amina@example.com" }),
    });
    expect(db.reservation.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ guestProfileId: 81 }),
    }));
  });

  it("does not duplicate the marketplace connection event during a retry", async () => {
    const db = dbFor(booking());
    db.reservationEvent.findFirst.mockResolvedValue({ id: 201 });
    const { syncNoLsafBookingToNrms } = await import("./nolsafMarketplaceNrms.js");

    await syncNoLsafBookingToNrms(db, 42);

    expect(db.reservationEvent.findFirst).toHaveBeenCalledWith({
      where: { reservationId: 100, type: "MARKETPLACE_CONNECTED" },
      select: { id: true },
    });
    expect(db.reservationEvent.create).not.toHaveBeenCalled();
  });

  it("releases the linked allocation when NoLSAF cancels", async () => {
    const existing = { id: 100, status: "CONFIRMED", checkIn: new Date(), checkOut: new Date(), allocations: [{ id: 1 }] };
    const db = dbFor(booking({ status: "CANCELED", cancelReason: "Traveller cancelled", nrmsReservation: existing }));
    const { syncNoLsafBookingToNrms } = await import("./nolsafMarketplaceNrms.js");

    await syncNoLsafBookingToNrms(db, 42);

    expect(db.reservation.upsert).toHaveBeenCalledWith({
      where: { bookingId: 42 },
      update: expect.objectContaining({ status: "CANCELLED", cancelReason: "Traveller cancelled" }),
      create: expect.objectContaining({ status: "CANCELLED", cancelReason: "Traveller cancelled" }),
    });
    expect(db.reservationRoomAllocation.updateMany).toHaveBeenCalledWith({
      where: { reservationId: 100, status: "ACTIVE" },
      data: { status: "RELEASED" },
    });
  });

  it("refuses NEW -> CONFIRMED when the locked final check finds a duplicate", async () => {
    const seed = { id: 42, propertyId: 7, status: "NEW" };
    const draft = booking({ status: "NEW", property: { id: 7, status: "APPROVED", roomsSpec: [], totalBedrooms: 1 } });
    const db = dbFor(null);
    db.booking.findUnique.mockResolvedValueOnce(seed).mockResolvedValueOnce(draft);
    computeDraftBookingAvailability.mockResolvedValue({ available: false, message: "Already occupied", status: "UNAVAILABLE" });
    const { confirmNoLsafBooking, NoLsafInventoryConflictError } = await import("./nolsafMarketplaceNrms.js");

    await expect(confirmNoLsafBooking(db, 42)).rejects.toBeInstanceOf(NoLsafInventoryConflictError);
    expect(lockPropertyInventory).toHaveBeenCalledWith(db, 7);
    expect(db.booking.update).not.toHaveBeenCalled();
    expect(db.reservation.upsert).not.toHaveBeenCalled();
  });
});

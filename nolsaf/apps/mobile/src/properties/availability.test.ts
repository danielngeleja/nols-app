import { describe, expect, it } from "vitest";

import { buildAvailabilityRangePath, resolveBookingAvailability } from "./availability";

describe("buildAvailabilityRangePath", () => {
  it("sends a stable room identity as roomCode, never roomType", () => {
    const path = buildAvailabilityRangePath(42, "2026-09-10", "2026-09-17", {
      roomCode: "Double-2",
      roomType: "Double"
    });

    expect(path).toContain("roomCode=Double-2");
    expect(path).not.toContain("roomType=");
  });

  it("keeps legacy room-type availability compatible", () => {
    const path = buildAvailabilityRangePath(42, "2026-09-10", "2026-09-17", { roomType: "Double room" });

    expect(path).toContain("roomType=Double+room");
    expect(path).not.toContain("roomCode=");
  });
});

describe("resolveBookingAvailability", () => {
  const base = {
    hasValidDates: true,
    requiresRoomSelection: true,
    roomSelected: true,
    loading: false,
    requestedRooms: 1
  };

  it("does not show a payable total for the sold-out screenshot state", () => {
    expect(resolveBookingAvailability({ ...base, availableRooms: 0 })).toEqual({
      status: "sold_out",
      canBook: false,
      showTotal: false
    });
  });

  it("fails closed when availability cannot be confirmed", () => {
    expect(resolveBookingAvailability({ ...base, availableRooms: null })).toMatchObject({
      status: "unknown",
      canBook: false,
      showTotal: false
    });
  });

  it("blocks requests larger than the confirmed inventory", () => {
    expect(resolveBookingAvailability({ ...base, availableRooms: 1, requestedRooms: 2 })).toMatchObject({
      status: "insufficient",
      canBook: false,
      showTotal: false
    });
  });

  it("shows the total only after the selected capacity is confirmed", () => {
    expect(resolveBookingAvailability({ ...base, availableRooms: 2 })).toEqual({
      status: "available",
      canBook: true,
      showTotal: true
    });
  });
});

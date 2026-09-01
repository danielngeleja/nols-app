import { describe, expect, it } from "vitest";

import { availabilitySummaryOccupancy, extractRoomTypes } from "./availabilityCalculator.js";

const roomsSpec = [
  { roomType: "Double", code: "Double 1 Full", roomsCount: 2 },
  { roomType: "Double", code: "Double 1 Queen", roomsCount: 1 },
];

const layout = {
  floors: [
    {
      rooms: [
        { code: "Double-1" },
        { code: "Double-2" },
        { code: "Double-3" },
      ],
    },
  ],
};

describe("extractRoomTypes stable selection", () => {
  it("uses roomsSpec capacity when the caller supplies an exact stable option code", () => {
    expect(extractRoomTypes(roomsSpec, layout, "Double 1 Full")).toEqual([
      { type: "Double", count: 2, codes: ["Double 1 Full", "Double 1 Full"] },
    ]);
  });

  it("keeps physical-unit lookups on the detailed layout", () => {
    expect(extractRoomTypes(roomsSpec, layout, "Double-2")).toEqual([
      { type: "Double", count: 1, codes: ["Double-2"] },
    ]);
  });
});

describe("availabilitySummaryOccupancy", () => {
  it("does not subtract unrelated bookings from a narrowed room selection", () => {
    expect(
      availabilitySummaryOccupancy(
        { Double: { bookedRooms: 1, blockedRooms: 0 } },
        4,
        [{ bedsBlocked: 2 }, { bedsBlocked: 1 }],
        true,
      ),
    ).toEqual({ totalBookedRooms: 1, totalBlockedRooms: 0 });
  });

  it("keeps property-wide summaries transparent about every booking and block", () => {
    expect(
      availabilitySummaryOccupancy(
        { Double: { bookedRooms: 1, blockedRooms: 0 } },
        4,
        [{ bedsBlocked: 2 }, {}],
        false,
      ),
    ).toEqual({ totalBookedRooms: 4, totalBlockedRooms: 3 });
  });
});

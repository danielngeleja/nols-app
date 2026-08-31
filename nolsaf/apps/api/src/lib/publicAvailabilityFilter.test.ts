import { describe, expect, it } from "vitest";

import { publicAvailabilityRoomFilter } from "./publicAvailabilityFilter.js";

describe("publicAvailabilityRoomFilter", () => {
  it("routes stable room codes to the exact calculator argument", () => {
    expect(publicAvailabilityRoomFilter({ roomCode: " Double 1 Full ", roomType: "Double" })).toEqual({
      roomCode: "Double 1 Full",
      roomType: undefined,
    });
  });

  it("preserves legacy roomType requests when no code is supplied", () => {
    expect(publicAvailabilityRoomFilter({ roomType: " Double " })).toEqual({
      roomCode: null,
      roomType: "Double",
    });
  });
});

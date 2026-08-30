import { describe, expect, it } from "vitest";

import { ensureRoomsSpecCodes, roomSelectionCodeFor } from "./roomSelectionCode.js";

type SpecEntry = Record<string, unknown>;

describe("ensureRoomsSpecCodes", () => {
  it("separates options that share a room type but differ in beds", () => {
    const spec = ensureRoomsSpecCodes<SpecEntry[]>([
      { roomType: "Single", beds: { queen: 1 }, roomsCount: 3, pricePerNight: 120_000 },
      { roomType: "Single", beds: { king: 1 }, roomsCount: 2, pricePerNight: 160_000 },
    ]);

    expect(spec[0].code).toBe("Single 1 Queen");
    expect(spec[1].code).toBe("Single 1 King");
    expect(spec[0].code).not.toBe(spec[1].code);
  });

  it("leaves a property alone when every room type is already unambiguous", () => {
    // Coding these would change the bucket key they are counted under, and
    // bookings already sold carry the room type as their roomCode.
    const spec = ensureRoomsSpecCodes<SpecEntry[]>([
      { roomType: "Single", beds: { queen: 1 } },
      { roomType: "Double", beds: { king: 1 } },
    ]);

    expect(spec[0].code).toBeUndefined();
    expect(spec[1].code).toBeUndefined();
  });

  it("keeps a code the owner or an NRMS import already set", () => {
    const spec = ensureRoomsSpecCodes<SpecEntry[]>([{ roomType: "Suite", beds: { king: 1 }, code: "STE-KING" }]);

    expect(spec[0].code).toBe("STE-KING");
  });

  it("disambiguates entries that are otherwise identical", () => {
    const spec = ensureRoomsSpecCodes<SpecEntry[]>([
      { roomType: "Double", beds: { full: 1 } },
      { roomType: "Double", beds: { full: 1 } },
    ]);

    expect(spec[0].code).toBe("Double 1 Full");
    expect(spec[1].code).toBe("Double 1 Full Option 2");
  });

  it("never produces a code that reads as a single physical room unit", () => {
    // A trailing "-<digits>" makes every reader treat the code as one unit and
    // collapse capacity to a single room.
    expect(roomSelectionCodeFor({ roomType: "Block-2" })).toBe("Block 2");
    expect(/-\d+$/.test(roomSelectionCodeFor({ roomType: "Block-2" }))).toBe(false);
  });

  it("stays within the length the booking API accepts", () => {
    const code = roomSelectionCodeFor({
      roomType: "Executive Presidential Garden View Suite With Balcony And Terrace",
      beds: { king: 1 },
    });

    expect(code.length).toBeLessThanOrEqual(60);
  });

  it("falls back to the room type when no beds are recorded", () => {
    expect(roomSelectionCodeFor({ roomType: "Family" })).toBe("Family");
  });

  it("leaves a non-array roomsSpec untouched", () => {
    expect(ensureRoomsSpecCodes(null)).toBeNull();
  });
});

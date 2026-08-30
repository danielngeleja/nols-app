import { describe, expect, it } from "vitest";

import { normalizeRoom, resolveRoomOptionIndex } from "./roomSpec";

describe("resolveRoomOptionIndex", () => {
  const rooms = [
    normalizeRoom({ roomType: "Suite", beds: { king: 1 }, pricePerNight: 160_000 }, 0, "TZS", null),
    normalizeRoom({ roomType: "Suite", beds: { queen: 1 }, pricePerNight: 120_000 }, 1, "TZS", null)
  ];

  it("selects only the exact duplicate room-type variant by roomsSpec index", () => {
    const selectedIndex = resolveRoomOptionIndex(rooms, "1");

    expect(selectedIndex).toBe(1);
    expect(rooms[selectedIndex!].bedsSummary).toBe("1 Queen");
    expect(rooms[selectedIndex!].pricePerNight).toBe(120_000);
  });

  it("keeps legacy room-type navigation working by selecting the first match", () => {
    expect(resolveRoomOptionIndex(rooms, "Suite")).toBe(0);
  });

  it("returns null for an invalid selection", () => {
    expect(resolveRoomOptionIndex(rooms, "9")).toBeNull();
    expect(resolveRoomOptionIndex(rooms, "Unknown")).toBeNull();
  });
});

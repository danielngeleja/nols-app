import { describe, expect, it } from "vitest";

import { UNASSIGNED_TYPE, summarizeRoomInventory } from "./adminRoomInventory.js";

const from = new Date("2026-10-01T00:00:00Z");
const to = new Date("2026-10-11T00:00:00Z"); // 10 nights

const booking = (propertyId: number, roomCode: string | null, checkIn: string, checkOut: string, roomsQty = 1) => ({
  propertyId,
  roomCode,
  roomsQty,
  checkIn: new Date(`${checkIn}T12:00:00Z`),
  checkOut: new Date(`${checkOut}T12:00:00Z`),
});

describe("summarizeRoomInventory", () => {
  const properties = [
    {
      id: 1,
      roomsSpec: [
        { code: "Double 1 Queen", roomType: "Double", beds: { queen: 1 }, roomsCount: 4 },
        { code: "Suite 1 King", roomType: "Suite", beds: { king: 1 }, roomsCount: 1 },
      ],
    },
    { id: 2, roomsSpec: { rooms: [{ roomType: "double", roomsCount: 6 }] } },
    { id: 3, roomsSpec: null },
  ];

  it("counts declared rooms by type across properties", () => {
    const report = summarizeRoomInventory(properties, [], from, to);
    const double = report.rows.find((r) => r.type === "Double");
    expect(double).toMatchObject({ roomsDeclared: 10, properties: 2 });
    expect(report.totals).toMatchObject({ roomTypes: 2, roomsDeclared: 11, propertiesWithRooms: 2, roomNights: 0 });
    expect(report.topSeller).toBeNull();
  });

  it("ranks types by room-nights inside the window and computes sell-through", () => {
    const report = summarizeRoomInventory(
      properties,
      [
        booking(1, "Suite 1 King", "2026-10-02", "2026-10-07"), // 5 nights
        booking(1, "Double 1 Queen", "2026-10-03", "2026-10-05", 2), // 2 rooms x 2 nights
        booking(2, null, "2026-09-28", "2026-10-03"), // single-type property, 2 nights inside the window
      ],
      from,
      to,
    );
    expect(report.rows.map((r) => [r.type, r.roomNights])).toEqual([
      ["Double", 6],
      ["Suite", 5],
    ]);
    expect(report.rows[1].sellThrough).toBe(50); // 5 of 1 room x 10 nights
    expect(report.topSeller).toBe("Double");
    expect(report.totals.bookings).toBe(3);
  });

  it("keeps bookings it cannot tie to one type in an Unassigned row, listed last", () => {
    const report = summarizeRoomInventory(
      properties,
      [booking(1, null, "2026-10-02", "2026-10-04"), booking(3, "Room", "2026-10-02", "2026-10-03")],
      from,
      to,
    );
    const last = report.rows[report.rows.length - 1];
    expect(last).toMatchObject({ type: UNASSIGNED_TYPE, bookings: 2, roomNights: 3, sellThrough: null });
    expect(report.totals.roomNights).toBe(3);
    expect(report.topSeller).toBeNull();
  });
});

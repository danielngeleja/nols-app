import { describe, expect, it } from "vitest";
import { getRoomTypeDailyAvailability } from "./nrmsAvailability.js";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * A stub standing in for the four inventory consumers the calculation reads.
 * Every list defaults to empty so each test only states what it is about.
 */
function stubDb(input: {
  units?: number;
  allocations?: Array<{ roomTypeId: number; startDate: string; endDate: string }>;
  bookings?: Array<{ roomCode: string; roomsQty?: number; checkIn: string; checkOut: string }>;
  blocks?: Array<{ roomCode?: string; roomTypeId?: number; bedsBlocked?: number; startDate: string; endDate: string }>;
  groupBlocks?: Array<{ checkIn: string; checkOut: string; quantity: number; pickedUp?: number }>;
}) {
  return {
    roomType: {
      findUnique: async () => ({ id: 5, name: "Garden Suite", propertyId: 1, _count: { units: input.units ?? 2 } }),
    },
    reservationRoomAllocation: {
      findMany: async () => (input.allocations ?? []).map((row, index) => ({
        id: index + 1,
        reservationId: index + 100,
        roomTypeId: row.roomTypeId,
        roomUnitId: null,
        startDate: day(row.startDate),
        endDate: day(row.endDate),
        roomType: { name: "Garden Suite" },
        roomUnit: null,
      })),
    },
    booking: {
      findMany: async () => (input.bookings ?? []).map((row) => ({ ...row, checkIn: day(row.checkIn), checkOut: day(row.checkOut) })),
    },
    propertyAvailabilityBlock: {
      findMany: async () => (input.blocks ?? []).map((row) => ({
        roomCode: row.roomCode ?? null,
        bedsBlocked: row.bedsBlocked ?? 1,
        startDate: day(row.startDate),
        endDate: day(row.endDate),
        roomUnit: row.roomTypeId ? { roomTypeId: row.roomTypeId } : null,
      })),
    },
    nrmsGroupBlock: {
      findMany: async () => (input.groupBlocks ?? []).map((row) => ({
        checkIn: day(row.checkIn),
        checkOut: day(row.checkOut),
        rooms: [{ roomTypeId: 5, quantity: row.quantity, pickedUp: row.pickedUp ?? 0 }],
      })),
    },
  };
}

const window = { from: day("2026-08-01"), to: day("2026-08-06") };

async function availability(db: any) {
  const days = await getRoomTypeDailyAvailability(db, 1, 5, window.from, window.to);
  return days.map((entry) => `${entry.day.toISOString().slice(8, 10)}:${entry.available}`);
}

describe("getRoomTypeDailyAvailability", () => {
  it("returns one row per night in the window", async () => {
    expect(await availability(stubDb({}))).toEqual(["01:2", "02:2", "03:2", "04:2", "05:2"]);
  });

  it("counts an NRMS allocation only on the nights it covers", async () => {
    const db = stubDb({ allocations: [{ roomTypeId: 5, startDate: "2026-08-02", endDate: "2026-08-04" }] });
    // Checkout day is not a night, so the 4th is free again.
    expect(await availability(db)).toEqual(["01:2", "02:1", "03:1", "04:2", "05:2"]);
  });

  it("ignores allocations belonging to another room type", async () => {
    const db = stubDb({ allocations: [{ roomTypeId: 9, startDate: "2026-08-02", endDate: "2026-08-04" }] });
    expect(await availability(db)).toEqual(["01:2", "02:2", "03:2", "04:2", "05:2"]);
  });

  it("counts marketplace bookings by room code and quantity", async () => {
    const db = stubDb({ bookings: [{ roomCode: "Garden Suite", roomsQty: 2, checkIn: "2026-08-03", checkOut: "2026-08-04" }] });
    expect(await availability(db)).toEqual(["01:2", "02:2", "03:0", "04:2", "05:2"]);
  });

  it("matches a suffixed room code to its type", async () => {
    const db = stubDb({ bookings: [{ roomCode: "Garden Suite-2", checkIn: "2026-08-01", checkOut: "2026-08-02" }] });
    expect(await availability(db)).toEqual(["01:1", "02:2", "03:2", "04:2", "05:2"]);
  });

  it("counts legacy availability blocks", async () => {
    const db = stubDb({ blocks: [{ roomTypeId: 5, bedsBlocked: 2, startDate: "2026-08-05", endDate: "2026-08-06" }] });
    expect(await availability(db)).toEqual(["01:2", "02:2", "03:2", "04:2", "05:0"]);
  });

  it("counts only the unpicked rooms of a group block", async () => {
    const db = stubDb({ groupBlocks: [{ checkIn: "2026-08-02", checkOut: "2026-08-03", quantity: 2, pickedUp: 1 }] });
    expect(await availability(db)).toEqual(["01:2", "02:1", "03:2", "04:2", "05:2"]);
  });

  it("stacks consumers from different sources on the same night", async () => {
    const db = stubDb({
      allocations: [{ roomTypeId: 5, startDate: "2026-08-02", endDate: "2026-08-03" }],
      bookings: [{ roomCode: "Garden Suite", checkIn: "2026-08-02", checkOut: "2026-08-03" }],
    });
    expect(await availability(db)).toEqual(["01:2", "02:0", "03:2", "04:2", "05:2"]);
  });

  it("never reports negative availability when oversold", async () => {
    const db = stubDb({ units: 1, bookings: [{ roomCode: "Garden Suite", roomsQty: 3, checkIn: "2026-08-01", checkOut: "2026-08-02" }] });
    const days = await getRoomTypeDailyAvailability(db as any, 1, 5, window.from, window.to);
    expect(days[0].available).toBe(0);
    expect(days[0].consumed).toBe(3);
  });

  it("clips a stay that starts before the window", async () => {
    const db = stubDb({ allocations: [{ roomTypeId: 5, startDate: "2026-07-28", endDate: "2026-08-03" }] });
    expect(await availability(db)).toEqual(["01:1", "02:1", "03:2", "04:2", "05:2"]);
  });

  it("returns nothing for an inverted window", async () => {
    expect(await getRoomTypeDailyAvailability(stubDb({}) as any, 1, 5, window.to, window.from)).toEqual([]);
  });

  it("returns nothing when the room type belongs to another property", async () => {
    const db = { ...stubDb({}), roomType: { findUnique: async () => ({ id: 5, name: "X", propertyId: 999, _count: { units: 3 } }) } };
    expect(await getRoomTypeDailyAvailability(db as any, 1, 5, window.from, window.to)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { buildBookingComAvailabilityXml } from "./bookingComAri.js";

describe("Booking.com ARI XML", () => {
  it("keeps room inventory separate from rate updates and includes restrictions", () => {
    const xml = buildBookingComAvailabilityXml({
      hotelId: 123,
      roomLevel: [{ roomId: "456", date: "2026-08-28", roomsToSell: 2 }],
      rateLevel: [{
        roomId: "456",
        rateId: "789",
        date: "2026-08-28",
        currency: "TZS",
        price: 135,
        policy: { minimumStay: 2, maximumStay: 14, closedOnDeparture: true },
      }],
    });

    expect(xml).toContain("<hotel_id>123</hotel_id>");
    expect(xml).toContain("<roomstosell>2</roomstosell>");
    expect(xml).toContain('<rate id="789" />');
    expect(xml).toContain("<price>135.00</price>");
    expect(xml).toContain("<minimumstay>2</minimumstay>");
    expect(xml).toContain("<maximumstay>14</maximumstay>");
    expect(xml).toContain("<closedondeparture>1</closedondeparture>");
  });

  it("rejects empty payloads", () => {
    expect(() => buildBookingComAvailabilityXml({ hotelId: 123, roomLevel: [], rateLevel: [] })).toThrow("no updates");
  });

  it("emits an explicit closed rate and zero room inventory for stop-sell", () => {
    const xml = buildBookingComAvailabilityXml({
      hotelId: 123,
      roomLevel: [{ roomId: "456", date: "2026-08-28", roomsToSell: 0 }],
      rateLevel: [{ roomId: "456", rateId: "789", date: "2026-08-28", currency: "TZS", price: 135, closed: true }],
    });
    expect(xml).toContain("<roomstosell>0</roomstosell>");
    expect(xml).toContain("<closed>1</closed>");
  });
});

import { describe, expect, it } from "vitest";
import { getStayBookingMode, occupancyPrice } from "./stayPresentation";
import { normalizeRoom } from "./roomSpec";

describe("traveller stay presentation", () => {
  it("uses the saved booking setup rather than guessing from the property type", () => {
    expect(getStayBookingMode({ type: "APARTMENT", roomsSpec: [{ bookingMode: "ROOM" }] })).toBe("ROOM");
    expect(getStayBookingMode({ type: "VILLA", roomsSpec: [{ bookingMode: "ENTIRE_UNIT" }] })).toBe("ENTIRE_UNIT");
    expect(getStayBookingMode({ type: "HOTEL", roomsSpec: [{ bookingMode: "ROOM" }] })).toBe("ROOM");
    expect(getStayBookingMode({ type: "VILLA", roomsSpec: [{ roomType: "Suite" }, { roomType: "Deluxe" }] })).toBe("ROOM");
  });

  it("prices additional guests against declared capacity and included guests", () => {
    const villa = normalizeRoom({
      roomType: "Villa",
      bookingMode: "ENTIRE_UNIT",
      maxGuestsPerUnit: 9,
      includedGuests: 4,
      extraGuestFee: 20000,
      bedrooms: [{ name: "Kilimanjaro", beds: { queen: 1 }, sleeps: 2 }]
    }, 0, "TZS", 150000);
    expect(villa.bedrooms).toEqual([{ name: "Kilimanjaro", bedsSummary: "1 Queen", sleeps: 2 }]);
    expect(occupancyPrice(villa, 6, 1, 10)).toEqual({
      maximumGuests: 9,
      includedGuests: 4,
      extraGuests: 2,
      grossExtraGuestFee: 22000
    });
  });

  it("multiplies room capacity and included guests when multiple rooms are booked", () => {
    const room = normalizeRoom({ roomType: "Suite", maxGuestsPerUnit: 3, includedGuests: 2, extraGuestFee: 10000 }, 0, "TZS", 80000);
    expect(occupancyPrice(room, 5, 2, 0)).toMatchObject({ maximumGuests: 6, extraGuests: 1 });
  });
});

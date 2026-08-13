import { describe, expect, it } from "vitest";
import { expediaEventPayload, parseExpediaReservation, parseExpediaReservationNotification } from "./expediaReservations.js";

describe("Expedia reservation normalization", () => {
  it("normalizes a modified reservation without persisting payment data", () => {
    const reservation = parseExpediaReservation({
      id: "987", propertyId: "123", status: "BOOKED", checkInDate: "2026-08-01", checkOutDate: "2026-08-03",
      adultCount: 2, childCount: 1, creationDateTime: "2026-07-01T10:00:00Z", lastUpdatedDateTime: "2026-07-02T10:00:00Z",
      unitIds: [{ id: "room-1", idSource: "EXPEDIA" }], rateIds: [{ id: "rate-1", idSource: "SUPPLIER" }],
      primaryGuest: { firstName: "Test", lastName: "Guest", emailAddress: "guest@example.test", phoneNumbers: [{ fullPhoneNumber: "+255700000000" }] },
      amounts: { summary: [{ type: "GUEST_PAYMENT", amount: { amount: "250.50", currencyCode: "USD" } }] },
      payment: { instrument: { token: "must-not-persist" } },
    });
    expect(reservation.action).toBe("MODIFY");
    expect(reservation.roomStays).toEqual([{ roomTypeExternalId: "room-1", rateExternalId: "rate-1", quantity: 1, checkIn: "2026-08-01", checkOut: "2026-08-03" }]);
    expect(JSON.stringify(expediaEventPayload(reservation))).not.toContain("must-not-persist");
    expect(JSON.stringify(expediaEventPayload(reservation))).not.toContain("guest@example.test");
  });

  it("reads Expedia's snake-case notification envelope", () => {
    expect(parseExpediaReservationNotification({ notification_id: "n-1", event_name: "ReservationUpdated", payload: { property_id: "123", reservation_id: "987", action_type: "MODIFIED", confirmation_token: "confirm" } })).toEqual({
      notificationId: "n-1", eventName: "ReservationUpdated", propertyId: "123", reservationId: "987", actionType: "MODIFIED", confirmationToken: "confirm",
    });
  });
});

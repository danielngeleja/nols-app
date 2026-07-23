import { describe, expect, it } from "vitest";
import { bookingComEventPayload, parseBookingReservationMessages, parseBookingResponseHasErrors } from "./bookingComReservations.js";

const reservationXml = `
<OTA_HotelResNotifRS>
  <HotelReservations>
    <HotelReservation ResStatus="Commit" HotelCode="12345">
      <UniqueID ID="987654" Type="18" />
      <RoomStays>
        <RoomStay>
          <RoomTypes><RoomType RoomTypeCode="room-1" /></RoomTypes>
          <RoomRates><RoomRate RoomTypeCode="room-1" RatePlanCode="rate-1" /></RoomRates>
          <TimeSpan Start="2026-08-01" End="2026-08-03" />
          <Total AmountAfterTax="250.00" CurrencyCode="TZS" />
        </RoomStay>
      </RoomStays>
      <ResGuests>
        <ResGuest>
          <Profiles><ProfileInfo><Profile><Customer>
            <PersonName><GivenName>Asha</GivenName><Surname>Juma</Surname></PersonName>
            <Telephone PhoneNumber="+255700000000" />
            <Email>asha@example.com</Email>
          </Customer></Profile></ProfileInfo></Profiles>
        </ResGuest>
      </ResGuests>
    </HotelReservation>
  </HotelReservations>
</OTA_HotelResNotifRS>`;

describe("Booking.com reservation parsing", () => {
  it("normalizes a new OTA reservation message", () => {
    const [message] = parseBookingReservationMessages(reservationXml);
    expect(message).toMatchObject({
      providerReservationId: "987654",
      hotelId: 12345,
      action: "CREATE",
      checkIn: "2026-08-01",
      checkOut: "2026-08-03",
      guestName: "Asha Juma",
      guestPhone: "+255700000000",
      guestEmail: "asha@example.com",
      currency: "TZS",
      totalAmount: 250,
      roomTypeExternalIds: ["room-1"],
      rateExternalIds: ["rate-1"],
    });
  });

  it("recognizes cancellation messages and provider errors", () => {
    const cancelled = reservationXml.replace("OTA_HotelResNotifRS", "OTA_HotelResModifyNotifRS").replace('ResStatus="Commit"', 'ResStatus="Cancel"');
    expect(parseBookingReservationMessages(cancelled)[0]?.action).toBe("CANCEL");
    expect(parseBookingResponseHasErrors('<OTA_HotelResNotifRS><Errors><Error ShortText="failed" /></Errors></OTA_HotelResNotifRS>')).toBe(true);
    expect(parseBookingResponseHasErrors(reservationXml)).toBe(false);
  });

  it("preserves room quantity while excluding raw payment and guest PII from the inbox payload", () => {
    const withMultipleRooms = reservationXml
      .replace('<RoomType RoomTypeCode="room-1" />', '<RoomType RoomTypeCode="room-1" NumberOfUnits="2" />')
      .replace("</Customer>", "<PaymentCard CardNumber=\"4111111111111111\" SeriesCode=\"123\" /></Customer>");
    const [message] = parseBookingReservationMessages(withMultipleRooms);

    expect(message.roomStays).toEqual([{
      roomTypeExternalId: "room-1",
      rateExternalId: "rate-1",
      quantity: 2,
      checkIn: "2026-08-01",
      checkOut: "2026-08-03",
    }]);
    const persisted = JSON.stringify(bookingComEventPayload(message));
    expect(persisted).not.toContain("4111111111111111");
    expect(persisted).not.toContain("asha@example.com");
    expect(persisted).not.toContain("PaymentCard");
  });
});

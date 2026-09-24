import { describe, expect, it } from "vitest";
import { activeStayReservationWhere } from "./nrmsActiveStay.js";

describe("activeStayReservationWhere", () => {
  it("requires every durable checkout signal to remain open", () => {
    expect(activeStayReservationWhere({ propertyId: 7, reservationId: 41 })).toEqual({
      propertyId: 7,
      id: 41,
      status: "CHECKED_IN",
      checkedOutAt: null,
      events: { none: { type: "CHECKED_OUT" } },
      OR: [
        { bookingId: null },
        { booking: { is: { status: "CHECKED_IN" } } },
      ],
    });
  });
});

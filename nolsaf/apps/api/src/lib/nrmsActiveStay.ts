/**
 * One defensive definition of a current in-house stay.
 *
 * Reservation is the operational record, while a linked NoLSAF Booking keeps
 * marketplace lifecycle authority. Historical projections can disagree, so a
 * former guest must not remain visible—or retain room-ordering access—when any
 * durable checkout signal says the stay is closed.
 */
export function activeStayReservationWhere(input: { propertyId?: number; reservationId?: number } = {}) {
  return {
    ...(input.propertyId ? { propertyId: input.propertyId } : {}),
    ...(input.reservationId ? { id: input.reservationId } : {}),
    status: "CHECKED_IN",
    checkedOutAt: null,
    events: { none: { type: "CHECKED_OUT" } },
    OR: [
      { bookingId: null },
      { booking: { is: { status: "CHECKED_IN" } } },
    ],
  };
}

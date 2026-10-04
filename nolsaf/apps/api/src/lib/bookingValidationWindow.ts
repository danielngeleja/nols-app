export type BookingValidationWindowStatus =
  | {
      canValidate: true;
      status: "IN_WINDOW";
      reason?: undefined;
    }
  | {
      canValidate: false;
      status: "BEFORE_CHECKIN" | "AFTER_CHECKOUT" | "INVALID_DATES";
      reason: string;
    };

const BOOKING_TIME_ZONE = "Africa/Dar_es_Salaam";

function calendarDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatBookingDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BOOKING_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

/**
 * Booking-code validation is only allowed within the East Africa calendar-date
 * window: check-in date <= today <= check-out date.
 */
export function getBookingValidationWindowStatus(
  checkIn: Date,
  checkOut: Date,
  now: Date = new Date()
): BookingValidationWindowStatus {
  if (
    !Number.isFinite(checkIn.getTime())
    || !Number.isFinite(checkOut.getTime())
    || !Number.isFinite(now.getTime())
  ) {
    return { canValidate: false, status: "INVALID_DATES", reason: "Invalid booking dates." };
  }

  const checkInDay = calendarDateKey(checkIn);
  const checkOutDay = calendarDateKey(checkOut);
  const today = calendarDateKey(now);

  if (checkOutDay < checkInDay) {
    return { canValidate: false, status: "INVALID_DATES", reason: "Invalid booking dates." };
  }

  if (today < checkInDay) {
    return {
      canValidate: false,
      status: "BEFORE_CHECKIN",
      reason: `Check-in is on ${formatBookingDate(checkIn)}. You can validate this booking code on the check-in date (East Africa Time).`,
    };
  }

  if (today > checkOutDay) {
    return {
      canValidate: false,
      status: "AFTER_CHECKOUT",
      reason: `Check-out was on ${formatBookingDate(checkOut)}. This booking code can no longer be validated after check-out (East Africa Time).`,
    };
  }

  return { canValidate: true, status: "IN_WINDOW" };
}

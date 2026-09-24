import { shiftDayKey } from "./nrmsShifts.js";

export type NrmsCheckInDateConflict = {
  code: "CHECKIN_BEFORE_ARRIVAL";
  arrivalDate: string;
  businessDate: string;
  message: string;
};

/**
 * Late arrivals remain valid, but a hotel must never put a future reservation
 * in house. Payment and room assignment do not advance the arrival date.
 */
export function nrmsCheckInDateConflict(checkIn: Date, businessDate: string): NrmsCheckInDateConflict | null {
  const arrivalDate = shiftDayKey(checkIn);
  if (arrivalDate <= businessDate) return null;
  return {
    code: "CHECKIN_BEFORE_ARRIVAL",
    arrivalDate,
    businessDate,
    message: `Check-in opens on the arrival business date, ${arrivalDate}.`,
  };
}

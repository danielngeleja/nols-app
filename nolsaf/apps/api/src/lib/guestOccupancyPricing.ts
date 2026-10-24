export function guestOccupancyPricing(
  room: { maxGuestsPerUnit?: unknown; includedGuests?: unknown; extraGuestFee?: unknown } | null | undefined,
  guests: number,
  units: number,
): { maximumGuests: number | null; extraGuests: number; extraGuestFee: number } {
  const unitCount = Math.max(1, Math.trunc(units));
  const capacity = Number(room?.maxGuestsPerUnit);
  const maximumGuests = Number.isInteger(capacity) && capacity > 0 ? capacity * unitCount : null;
  const included = Number(room?.includedGuests);
  const fee = Number(room?.extraGuestFee);
  const validRule = Number.isInteger(included) && included >= 1 && Number.isFinite(fee) && fee > 0 &&
    (maximumGuests === null || included * unitCount < maximumGuests);
  return {
    maximumGuests,
    extraGuests: validRule ? Math.max(0, Math.trunc(guests) - included * unitCount) : 0,
    extraGuestFee: validRule ? fee : 0,
  };
}

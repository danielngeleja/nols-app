export function overlappingNights(start: Date, end: Date, rangeStart: Date, rangeEnd: Date): number {
  const overlapStart = Math.max(start.getTime(), rangeStart.getTime());
  const overlapEnd = Math.min(end.getTime(), rangeEnd.getTime());
  return Math.max(0, Math.ceil((overlapEnd - overlapStart) / 86_400_000));
}

/**
 * Allocate a stay-level accommodation snapshot to the occupied nights inside
 * one reporting period. This prevents a cross-period stay from being counted
 * in full on its arrival date while NRMS transitions toward nightly postings.
 */
export function allocateStayValue(
  totalAmount: number,
  checkIn: Date,
  checkOut: Date,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  if (!Number.isFinite(totalAmount)) return 0;
  const stayNights = overlappingNights(checkIn, checkOut, checkIn, checkOut);
  const periodNights = overlappingNights(checkIn, checkOut, rangeStart, rangeEnd);
  if (stayNights <= 0 || periodNights <= 0) return 0;
  return totalAmount * (periodNights / stayNights);
}


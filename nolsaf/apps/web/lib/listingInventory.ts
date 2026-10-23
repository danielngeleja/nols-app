export type BedKey = "twin" | "full" | "queen" | "king";
export type BedroomLayout = { name: string; beds: Record<BedKey, number>; sleeps?: number };

export function firstIncompleteBedroomIndex(bedrooms: BedroomLayout[]): number {
  return bedrooms.findIndex((bedroom) =>
    !bedroom?.name?.trim() ||
    !(["twin", "full", "queen", "king"] as BedKey[]).some((key) => Number(bedroom?.beds?.[key]) > 0) ||
    !Number.isInteger(Number(bedroom?.sleeps)) || Number(bedroom?.sleeps) < 1 || Number(bedroom?.sleeps) > 99
  );
}

export function hasCompleteBedrooms(bedrooms: BedroomLayout[] | undefined): boolean {
  return Array.isArray(bedrooms) && bedrooms.length > 0 && firstIncompleteBedroomIndex(bedrooms) === -1;
}

export function aggregateBedroomBeds(bedrooms: BedroomLayout[]): Record<BedKey, number> {
  return bedrooms.reduce<Record<BedKey, number>>((total, bedroom) => {
    for (const key of ["twin", "full", "queen", "king"] as BedKey[]) {
      total[key] += Math.max(0, Number(bedroom.beds?.[key]) || 0);
    }
    return total;
  }, { twin: 0, full: 0, queen: 0, king: 0 });
}

export function countPropertyBedrooms(entries: Array<{ bookingMode?: string; roomsCount?: number; bedrooms?: BedroomLayout[] }>): number {
  return entries.reduce((sum, entry) => {
    const units = Math.max(0, Number(entry.roomsCount) || 0);
    return sum + units * (entry.bookingMode === "ENTIRE_UNIT" && Array.isArray(entry.bedrooms) ? entry.bedrooms.length : 1);
  }, 0);
}

export function sleepingCapacity(beds: Record<BedKey, number>): number {
  return (Number(beds.twin) || 0) + 2 * ((Number(beds.full) || 0) + (Number(beds.queen) || 0) + (Number(beds.king) || 0));
}

export function declaredGuestCapacity(bedrooms: BedroomLayout[]): number {
  return bedrooms.reduce((sum, bedroom) => sum + (Number.isInteger(Number(bedroom.sleeps)) && Number(bedroom.sleeps) >= 1 && Number(bedroom.sleeps) <= 99 ? Number(bedroom.sleeps) : 0), 0);
}

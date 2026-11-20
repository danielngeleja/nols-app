/**
 * How guests book a listing.
 *
 *  ROOM         guests book a room (hotels, lodges, guest houses, homestays)
 *  ENTIRE_UNIT  guests book the whole place, one unit
 *  UNITS        several self-contained units at one address (apartments in a
 *               block, cottages, bungalows); a booking takes one whole unit
 *               and the others stay available
 *
 * UNITS is a wizard mode, not a stored value of its own: each unit type is
 * saved as a roomsSpec entry with bookingMode "ENTIRE_UNIT", unitStyle "UNIT"
 * and roomsCount = how many identical units exist. Availability already sells
 * each entry by its count, so no booking change is needed to sell units.
 */
export type PropertyBookingMode = "ROOM" | "ENTIRE_UNIT" | "UNITS";

const WHOLE_PLACE_DEFAULTS = new Set(["Villa", "Apartment", "Condo", "Bungalow", "Cabin", "Townhouse", "House"]);
const ROOM_ONLY_TYPES = new Set(["Hotel", "Lodge", "Guest House"]);
/** Sold whole: the entire place or separate units, never by the bedroom. */
const NO_ROOMS_TYPES = new Set(["Apartment", "Condo"]);

export function defaultBookingModeForPropertyType(propertyType: string): "ROOM" | "ENTIRE_UNIT" {
  return WHOLE_PLACE_DEFAULTS.has(propertyType) ? "ENTIRE_UNIT" : "ROOM";
}

export function isRoomOnlyPropertyType(propertyType: string): boolean {
  return ROOM_ONLY_TYPES.has(propertyType);
}

/** The booking styles an owner may choose for this property type, in display order. */
export function bookingModesForPropertyType(propertyType: string): PropertyBookingMode[] {
  if (ROOM_ONLY_TYPES.has(propertyType)) return ["ROOM"];
  if (NO_ROOMS_TYPES.has(propertyType)) return ["ENTIRE_UNIT", "UNITS"];
  return ["ENTIRE_UNIT", "UNITS", "ROOM"];
}

/** A saved roomsSpec entry that is one type of separate unit. */
export function isSeparateUnitEntry(entry: { bookingMode?: string; unitStyle?: string } | null | undefined): boolean {
  return entry?.bookingMode === "ENTIRE_UNIT" && entry?.unitStyle === "UNIT";
}

/** The wizard mode a saved roomsSpec was made in. */
export function bookingModeOfEntries(entries: Array<{ bookingMode?: string; unitStyle?: string }>): PropertyBookingMode {
  if (entries.some(isSeparateUnitEntry)) return "UNITS";
  if (entries.some((entry) => entry?.bookingMode === "ENTIRE_UNIT")) return "ENTIRE_UNIT";
  return "ROOM";
}

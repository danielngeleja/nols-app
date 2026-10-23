export type PropertyBookingMode = "ROOM" | "ENTIRE_UNIT";

const WHOLE_PLACE_DEFAULTS = new Set(["Villa", "Apartment", "Condo", "Bungalow", "Cabin", "Townhouse", "House"]);
const ROOM_ONLY_TYPES = new Set(["Hotel", "Lodge", "Guest House"]);

export function defaultBookingModeForPropertyType(propertyType: string): PropertyBookingMode {
  return WHOLE_PLACE_DEFAULTS.has(propertyType) ? "ENTIRE_UNIT" : "ROOM";
}

export function isRoomOnlyPropertyType(propertyType: string): boolean {
  return ROOM_ONLY_TYPES.has(propertyType);
}

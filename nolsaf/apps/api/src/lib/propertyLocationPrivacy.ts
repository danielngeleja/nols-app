// apps/api/src/lib/propertyLocationPrivacy.ts
// Before booking, private homes show an approximate area instead of the exact
// spot (owner safety, and guests cannot bypass the platform at the door).
// Businesses whose address is public anyway keep the exact pin.
import { createHmac } from "node:crypto";

/** Property types whose location is public knowledge: always shown exactly. */
const EXACT_LOCATION_TYPES = new Set(["HOTEL", "LODGE", "GUEST_HOUSE", "RESORT", "HOSTEL", "MOTEL", "CAMP", "CAMPSITE"]);

/** Radius of the area circle drawn around an approximate location. */
export const APPROX_LOCATION_RADIUS_M = 500;

export function hasPublicExactLocation(type: unknown): boolean {
  return EXACT_LOCATION_TYPES.has(String(type ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_"));
}

function offsetSecret(): string {
  return (
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "nolsaf-location")
  );
}

/**
 * Moves a point 150 to 350 m in a direction derived from the property id and a
 * server secret. The shift is the same on every request, so repeated lookups
 * cannot be averaged back to the true spot, and the true spot always lies inside
 * the APPROX_LOCATION_RADIUS_M circle drawn around the returned point.
 */
export function approximateCoordinates(propertyId: number, latitude: number, longitude: number): { latitude: number; longitude: number } {
  const digest = createHmac("sha256", offsetSecret()).update(`property-location:${propertyId}`).digest();
  const bearing = (digest.readUInt16BE(0) / 0xffff) * 2 * Math.PI;
  const distanceM = 150 + (digest.readUInt16BE(2) / 0xffff) * 200;
  const dLat = (distanceM * Math.cos(bearing)) / 111_320;
  const dLng = (distanceM * Math.sin(bearing)) / (111_320 * Math.max(0.2, Math.cos((latitude * Math.PI) / 180)));
  return {
    latitude: Number((latitude + dLat).toFixed(4)),
    longitude: Number((longitude + dLng).toFixed(4)),
  };
}

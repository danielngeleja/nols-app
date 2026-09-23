import { describe, expect, it } from "vitest";
import { APPROX_LOCATION_RADIUS_M, approximateCoordinates, hasPublicExactLocation } from "./propertyLocationPrivacy.js";
import { toPublicDetail } from "./publicPropertyDto.js";

function metresBetween(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe("property location privacy", () => {
  it("keeps businesses exact and treats homes as private", () => {
    expect(hasPublicExactLocation("HOTEL")).toBe(true);
    expect(hasPublicExactLocation("Guest House")).toBe(true);
    expect(hasPublicExactLocation("LODGE")).toBe(true);
    expect(hasPublicExactLocation("APARTMENT")).toBe(false);
    expect(hasPublicExactLocation("VILLA")).toBe(false);
    expect(hasPublicExactLocation("OTHER")).toBe(false);
    expect(hasPublicExactLocation(null)).toBe(false);
  });

  it("shifts a home by a stable amount that stays inside the drawn circle", () => {
    const real = { latitude: -6.7938, longitude: 39.2103 };
    for (let id = 1; id <= 200; id++) {
      const shifted = approximateCoordinates(id, real.latitude, real.longitude);
      const d = metresBetween(real, shifted);
      expect(d).toBeGreaterThan(130); // 150 m minimum, less 4-decimal rounding
      expect(d).toBeLessThan(APPROX_LOCATION_RADIUS_M);
      expect(approximateCoordinates(id, real.latitude, real.longitude)).toEqual(shifted);
    }
  });

  it("withholds street and exact point for homes in the public detail", () => {
    const base = { id: 7, title: "Zion Apartment", nrmsBookingKey: "abc", latitude: -6.7938, longitude: 39.2103, street: "Mburahati Rd" };
    const home = toPublicDetail({ ...base, type: "APARTMENT" });
    expect(home.locationPrecision).toBe("APPROXIMATE");
    expect(home.street).toBeNull();
    expect(home.latitude).not.toBe(base.latitude);
    expect(home.locationRadiusMeters).toBe(APPROX_LOCATION_RADIUS_M);

    const hotel = toPublicDetail({ ...base, type: "HOTEL" });
    expect(hotel.locationPrecision).toBe("EXACT");
    expect(hotel.street).toBe("Mburahati Rd");
    expect(hotel.latitude).toBe(base.latitude);
    expect(hotel.longitude).toBe(base.longitude);
  });
});

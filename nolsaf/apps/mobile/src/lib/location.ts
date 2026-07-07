import * as Location from "expo-location";

export type DeviceLocation = {
  latitude: number;
  longitude: number;
  /** A human readable label, reverse geocoded when possible, else coordinates. */
  address: string;
};

/**
 * Ask for foreground location permission, read the current position, and try to
 * turn it into a readable address. Reverse geocoding is cosmetic, so a failure
 * there still returns valid coordinates with a coordinate label.
 */
export async function detectCurrentLocation(): Promise<DeviceLocation> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") {
    throw new Error("Location permission is off. Allow location, or choose a pickup point instead.");
  }

  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const latitude = pos.coords.latitude;
  const longitude = pos.coords.longitude;
  let address = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;

  try {
    const places = await Location.reverseGeocodeAsync({ latitude, longitude });
    const p = places?.[0];
    if (p) {
      const parts = [p.name, p.street, p.district, p.city, p.region].map((x) => (x ? String(x).trim() : "")).filter(Boolean);
      const label = Array.from(new Set(parts)).join(", ");
      if (label) address = label;
    }
  } catch {
    // keep the coordinate label
  }

  return { latitude, longitude, address };
}

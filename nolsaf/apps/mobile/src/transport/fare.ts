/**
 * Transport fare preview, ported from the NoLSAF web calculator
 * (apps/web/lib/transportFareCalculator.ts) so the mobile estimate matches.
 *
 * IMPORTANT: this is a CLIENT PREVIEW ONLY. The server recomputes the
 * authoritative fare from road distance + vehicle rates and never trusts a
 * client-supplied amount. Keep the rates here in sync with the web/api values.
 */

export type TransportVehicleType = "BODA" | "BAJAJI" | "CAR" | "XL" | "PREMIUM";

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

type VehiclePricingConfig = {
  baseFare: number;
  perKmRate: number;
  perMinuteRate: number;
  averageSpeedKmh: number;
};

const VEHICLE_PRICING: Record<TransportVehicleType, VehiclePricingConfig> = {
  BODA: { baseFare: 1500, perKmRate: 350, perMinuteRate: 35, averageSpeedKmh: 35 },
  BAJAJI: { baseFare: 1800, perKmRate: 420, perMinuteRate: 40, averageSpeedKmh: 28 },
  CAR: { baseFare: 2000, perKmRate: 500, perMinuteRate: 50, averageSpeedKmh: 30 },
  XL: { baseFare: 2500, perKmRate: 650, perMinuteRate: 60, averageSpeedKmh: 30 },
  PREMIUM: { baseFare: 5000, perKmRate: 1200, perMinuteRate: 80, averageSpeedKmh: 30 }
};

export const VEHICLE_OPTIONS: Array<{ type: TransportVehicleType; label: string; hint: string }> = [
  { type: "BODA", label: "Boda", hint: "1 rider, fastest in traffic" },
  { type: "BAJAJI", label: "Bajaji", hint: "Up to 3, short trips" },
  { type: "CAR", label: "Car", hint: "Up to 4, standard comfort" },
  { type: "XL", label: "XL", hint: "Up to 6, extra luggage" },
  { type: "PREMIUM", label: "Premium", hint: "Top comfort, arrivals" }
];

export function getVehicleTypeLabel(vehicleType: TransportVehicleType): string {
  return VEHICLE_OPTIONS.find((v) => v.type === vehicleType)?.label ?? "Car";
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/** Haversine distance in kilometers, rounded to 2 decimals. */
export function calculateDistanceKm(origin: GeoPoint, destination: GeoPoint): number {
  const R = 6371;
  const dLat = toRadians(destination.latitude - origin.latitude);
  const dLon = toRadians(destination.longitude - origin.longitude);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(origin.latitude)) *
      Math.cos(toRadians(destination.latitude)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
}

function estimateTravelTimeMinutes(distanceKm: number, vehicleType: TransportVehicleType): number {
  const speed = VEHICLE_PRICING[vehicleType]?.averageSpeedKmh || 30;
  return Math.max(5, Math.ceil((distanceKm / speed) * 60));
}

function surgeMultiplier(at: Date): number {
  const hour = at.getHours();
  const day = at.getDay();
  const isWeekday = day >= 1 && day <= 5;
  const isMorningRush = hour >= 7 && hour < 9;
  const isEveningRush = hour >= 17 && hour < 19;
  if (isWeekday && (isMorningRush || isEveningRush)) return 1.2;
  if (!isWeekday && hour >= 18 && hour < 22) return 1.15;
  return 1.0;
}

export type FarePreview = {
  /** Rounded ride fare before a peak-time adjustment. */
  subtotal: number;
  /** Time-based multiplier (1 means standard pricing). */
  surgeMultiplier: number;
  /** Exact amount added by the multiplier, so subtotal + surgeAmount = total. */
  surgeAmount: number;
  total: number;
  distanceKm: number;
  estimatedMinutes: number;
  currency: string;
  vehicleType: TransportVehicleType;
  /** True when destination coords are unknown, so only the base fare is shown. */
  approximate: boolean;
};

/**
 * Upfront fixed-fare preview. When the property has no registered coordinates
 * the web shows the minimum base rate and notes the driver will confirm, so we
 * mirror that with `approximate: true`.
 *
 * `applySurge` gates the peak-time adjustment: it should only be applied when
 * the traveller has actually picked a scheduled pickup time. For an instant /
 * unselected ride we never surge off the current clock, so the adjustment is
 * hidden unless their chosen time genuinely lands in a surge window.
 */
export function calculateFarePreview(
  origin: GeoPoint | null,
  destination: GeoPoint | null,
  vehicleType: TransportVehicleType,
  currency = "TZS",
  at: Date = new Date(),
  applySurge = true
): FarePreview {
  const cfg = VEHICLE_PRICING[vehicleType] || VEHICLE_PRICING.CAR;

  if (!origin || !destination) {
    return {
      subtotal: cfg.baseFare,
      surgeMultiplier: 1,
      surgeAmount: 0,
      total: cfg.baseFare,
      distanceKm: 0,
      estimatedMinutes: 0,
      currency,
      vehicleType,
      approximate: true
    };
  }

  const distanceKm = calculateDistanceKm(origin, destination);
  const estimatedMinutes = estimateTravelTimeMinutes(distanceKm, vehicleType);
  const rawSubtotal = cfg.baseFare + distanceKm * cfg.perKmRate + estimatedMinutes * cfg.perMinuteRate;
  const subtotal = Math.max(cfg.baseFare, Math.ceil(rawSubtotal));
  const multiplier = applySurge ? surgeMultiplier(at) : 1;
  const total = Math.max(cfg.baseFare, Math.ceil(rawSubtotal * multiplier));

  return {
    subtotal,
    surgeMultiplier: multiplier,
    surgeAmount: Math.max(0, total - subtotal),
    total,
    distanceKm,
    estimatedMinutes,
    currency,
    vehicleType,
    approximate: false
  };
}

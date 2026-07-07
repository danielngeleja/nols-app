/**
 * Pickup points for NoLSAF transport, ported from the web
 * (apps/web/lib/tanzania-locations.ts). Used as arrival/pickup origins.
 * Destination is always the customer's booked property, never a free ride.
 */

import { calculateDistanceKm, GeoPoint } from "./fare";

export type ArrivalType = "FLIGHT" | "BUS" | "TRAIN" | "FERRY" | "OTHER";
export type PickupCategory = "airport" | "bus_terminal" | "ferry_port" | "train_station";

export type PickupPoint = {
  id: string;
  label: string;
  shortLabel: string;
  city: string;
  lat: number;
  lng: number;
  category: PickupCategory;
  arrivalType: ArrivalType;
  iataCode?: string;
};

export const PICKUP_POINTS: PickupPoint[] = [
  // Airports
  { id: "JNIA", label: "Julius Nyerere International Airport (DAR)", shortLabel: "JNIA, Dar es Salaam", city: "Dar es Salaam", lat: -6.878111, lng: 39.202625, category: "airport", arrivalType: "FLIGHT", iataCode: "DAR" },
  { id: "ZNZ", label: "Abeid Amani Karume International Airport (ZNZ)", shortLabel: "Karume, Zanzibar", city: "Zanzibar (Unguja)", lat: -6.222025, lng: 39.224886, category: "airport", arrivalType: "FLIGHT", iataCode: "ZNZ" },
  { id: "JRO", label: "Kilimanjaro International Airport (JRO)", shortLabel: "KIA, Kilimanjaro", city: "Arusha and Moshi", lat: -3.42939, lng: 37.07454, category: "airport", arrivalType: "FLIGHT", iataCode: "JRO" },
  { id: "MWZ", label: "Mwanza Airport (MWZ)", shortLabel: "Mwanza Airport", city: "Mwanza", lat: -2.44453, lng: 32.93274, category: "airport", arrivalType: "FLIGHT", iataCode: "MWZ" },
  { id: "MBI", label: "Songwe Airport (MBI), Mbeya", shortLabel: "Songwe, Mbeya", city: "Mbeya", lat: -8.91918, lng: 33.27349, category: "airport", arrivalType: "FLIGHT", iataCode: "MBI" },
  { id: "DOD", label: "Dodoma Airport (DOD)", shortLabel: "Dodoma Airport", city: "Dodoma", lat: -6.17041, lng: 35.75265, category: "airport", arrivalType: "FLIGHT", iataCode: "DOD" },
  { id: "MYW", label: "Mtwara Airport (MYW)", shortLabel: "Mtwara Airport", city: "Mtwara", lat: -10.3391, lng: 40.18183, category: "airport", arrivalType: "FLIGHT", iataCode: "MYW" },
  { id: "TBO", label: "Tabora Airport (TBO)", shortLabel: "Tabora Airport", city: "Tabora", lat: -5.07643, lng: 32.8333, category: "airport", arrivalType: "FLIGHT", iataCode: "TBO" },
  { id: "TKQ", label: "Kigoma Airport (TKQ)", shortLabel: "Kigoma Airport", city: "Kigoma", lat: -4.8862, lng: 29.629, category: "airport", arrivalType: "FLIGHT", iataCode: "TKQ" },
  { id: "PMA", label: "Pemba Airport (PMA)", shortLabel: "Pemba Airport", city: "Pemba Island", lat: -5.2573, lng: 39.8114, category: "airport", arrivalType: "FLIGHT", iataCode: "PMA" },
  { id: "MFA", label: "Mafia Airport (MFA)", shortLabel: "Mafia Airport", city: "Mafia Island", lat: -7.917, lng: 39.6685, category: "airport", arrivalType: "FLIGHT", iataCode: "MFA" },
  { id: "TGT", label: "Tanga Airport (TGT)", shortLabel: "Tanga Airport", city: "Tanga", lat: -5.0924, lng: 39.0712, category: "airport", arrivalType: "FLIGHT", iataCode: "TGT" },
  { id: "LKY", label: "Lake Manyara Airport (LKY)", shortLabel: "Manyara Airport", city: "Manyara", lat: -3.3763, lng: 35.8182, category: "airport", arrivalType: "FLIGHT", iataCode: "LKY" },
  { id: "SHY", label: "Shinyanga Airport (SHY)", shortLabel: "Shinyanga Airport", city: "Shinyanga", lat: -3.6093, lng: 33.5003, category: "airport", arrivalType: "FLIGHT", iataCode: "SHY" },
  { id: "IRI", label: "Iringa Airport (IRI)", shortLabel: "Iringa Airport", city: "Iringa", lat: -7.6688, lng: 35.7523, category: "airport", arrivalType: "FLIGHT", iataCode: "IRI" },
  { id: "MUZ", label: "Musoma Airport (MUZ)", shortLabel: "Musoma Airport", city: "Musoma", lat: -1.503, lng: 33.8009, category: "airport", arrivalType: "FLIGHT", iataCode: "MUZ" },
  { id: "BKZ", label: "Bukoba Airport (BKZ)", shortLabel: "Bukoba Airport", city: "Bukoba", lat: -1.3322, lng: 31.8212, category: "airport", arrivalType: "FLIGHT", iataCode: "BKZ" },

  // Bus terminals
  { id: "BUS_UBUNGO", label: "Ubungo Bus Terminal", shortLabel: "Ubungo, Dar es Salaam", city: "Dar es Salaam", lat: -6.77239, lng: 39.21432, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_ARUSHA", label: "Arusha Central Bus Stand", shortLabel: "Arusha Bus Stand", city: "Arusha", lat: -3.3667, lng: 36.6833, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_MOSHI", label: "Moshi Bus Stand", shortLabel: "Moshi Bus Stand", city: "Moshi", lat: -3.35, lng: 37.3333, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_MWANZA", label: "Mwanza Bus Terminal (Buzuruga)", shortLabel: "Mwanza Bus Terminal", city: "Mwanza", lat: -2.5167, lng: 32.9, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_DODOMA", label: "Dodoma Bus Stand (Jamatini)", shortLabel: "Dodoma Bus Stand", city: "Dodoma", lat: -6.1731, lng: 35.7394, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_MOROGORO", label: "Morogoro Bus Stand", shortLabel: "Morogoro Bus Stand", city: "Morogoro", lat: -6.8203, lng: 37.6581, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_TANGA", label: "Tanga Bus Stand", shortLabel: "Tanga Bus Stand", city: "Tanga", lat: -5.0667, lng: 39.1, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_MBEYA", label: "Mbeya Bus Stand", shortLabel: "Mbeya Bus Stand", city: "Mbeya", lat: -8.9, lng: 33.45, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_IRINGA", label: "Iringa Bus Stand", shortLabel: "Iringa Bus Stand", city: "Iringa", lat: -7.7667, lng: 35.7, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_KIGOMA", label: "Kigoma Bus Stand", shortLabel: "Kigoma Bus Stand", city: "Kigoma", lat: -4.8833, lng: 29.6333, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_TABORA", label: "Tabora Bus Stand", shortLabel: "Tabora Bus Stand", city: "Tabora", lat: -5.0667, lng: 32.8, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_SONGEA", label: "Songea Bus Stand", shortLabel: "Songea Bus Stand", city: "Songea", lat: -10.6833, lng: 35.65, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_MTWARA", label: "Mtwara Bus Stand", shortLabel: "Mtwara Bus Stand", city: "Mtwara", lat: -10.2667, lng: 40.1833, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_LINDI", label: "Lindi Bus Stand", shortLabel: "Lindi Bus Stand", city: "Lindi", lat: -9.95, lng: 39.7167, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_MUSOMA", label: "Musoma Bus Stand", shortLabel: "Musoma Bus Stand", city: "Musoma", lat: -1.5, lng: 33.8, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_BUKOBA", label: "Bukoba Bus Stand", shortLabel: "Bukoba Bus Stand", city: "Bukoba", lat: -1.3333, lng: 31.8167, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_NJOMBE", label: "Njombe Bus Stand", shortLabel: "Njombe Bus Stand", city: "Njombe", lat: -9.3333, lng: 34.7667, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_SHINYANGA", label: "Shinyanga Bus Stand", shortLabel: "Shinyanga Bus Stand", city: "Shinyanga", lat: -3.66, lng: 33.43, category: "bus_terminal", arrivalType: "BUS" },
  { id: "BUS_MWANAKWEREKWE", label: "Mwanakwerekwe Bus Terminal", shortLabel: "Mwanakwerekwe, Zanzibar", city: "Zanzibar (Unguja)", lat: -6.1769, lng: 39.2275, category: "bus_terminal", arrivalType: "BUS" },

  // Train stations
  { id: "TRAIN_TAZARA_DAR", label: "TAZARA Railway Station (Dar es Salaam)", shortLabel: "TAZARA, Dar es Salaam", city: "Dar es Salaam", lat: -6.846408, lng: 39.245033, category: "train_station", arrivalType: "TRAIN" },
  { id: "TRAIN_DAR_CENTRAL", label: "Dar es Salaam Central Railway Station", shortLabel: "Central Station, Dar es Salaam", city: "Dar es Salaam", lat: -6.82488, lng: 39.283029, category: "train_station", arrivalType: "TRAIN" },
  { id: "TRAIN_MOROGORO", label: "Morogoro Railway Station", shortLabel: "Morogoro Station", city: "Morogoro", lat: -6.822352, lng: 37.672432, category: "train_station", arrivalType: "TRAIN" },

  // Ferry ports
  { id: "FERRY_KIVUKONI", label: "Kivukoni Ferry Terminal, Dar es Salaam", shortLabel: "Kivukoni, Dar es Salaam", city: "Dar es Salaam", lat: -6.8148, lng: 39.2918, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_STONETOWN", label: "Malindi Port (Stone Town), Zanzibar", shortLabel: "Stone Town Ferry, Zanzibar", city: "Zanzibar (Unguja)", lat: -6.1622, lng: 39.188, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_MKOANI", label: "Mkoani Jetty, Pemba Island", shortLabel: "Mkoani, Pemba", city: "Pemba Island", lat: -5.3167, lng: 39.7167, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_CHAKE_CHAKE", label: "Chake Chake Port, Pemba Island", shortLabel: "Chake Chake, Pemba", city: "Pemba Island", lat: -5.25, lng: 39.7667, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_MAFIA", label: "Mafia Island Jetty", shortLabel: "Mafia Jetty", city: "Mafia Island", lat: -7.9, lng: 39.65, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_TANGA", label: "Tanga Port", shortLabel: "Tanga Port", city: "Tanga", lat: -5.0667, lng: 39.1, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_MWANZA", label: "Mwanza Port, Lake Victoria", shortLabel: "Mwanza Port", city: "Mwanza", lat: -2.5167, lng: 32.9, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_BUKOBA", label: "Bukoba Port, Lake Victoria", shortLabel: "Bukoba Port", city: "Bukoba", lat: -1.3333, lng: 31.8167, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_MUSOMA", label: "Musoma Port, Lake Victoria", shortLabel: "Musoma Port", city: "Musoma", lat: -1.5, lng: 33.8, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_KIGOMA", label: "Kigoma Port, Lake Tanganyika", shortLabel: "Kigoma Port", city: "Kigoma", lat: -4.8833, lng: 29.6333, category: "ferry_port", arrivalType: "FERRY" },
  { id: "FERRY_ITUNGI", label: "Itungi Port (Kyela), Lake Nyasa", shortLabel: "Itungi, Kyela", city: "Kyela, Mbeya", lat: -9.5833, lng: 33.9833, category: "ferry_port", arrivalType: "FERRY" }
];

export const PICKUP_CATEGORY_LABELS: Record<PickupCategory, string> = {
  airport: "Airports",
  bus_terminal: "Bus terminals",
  ferry_port: "Ferry ports",
  train_station: "Train stations"
};

/** Pickup points whose city loosely matches the property location, used to
 *  suggest the nearest sensible origins for an instant pickup. */
export function suggestPickupPoints(propertyArea: string | null | undefined, limit = 6): PickupPoint[] {
  const area = String(propertyArea || "").toLowerCase();
  if (!area) return PICKUP_POINTS.slice(0, limit);

  const matches = PICKUP_POINTS.filter((p) => {
    const city = p.city.toLowerCase();
    return area.includes(city.split(" ")[0]) || city.includes(area.split(",")[0].trim());
  });

  return (matches.length > 0 ? matches : PICKUP_POINTS).slice(0, limit);
}

export type RankedPickupPoint = PickupPoint & { distanceKm: number };

/** Rank an arbitrary pickup list by straight line distance to the destination.
 *  Used with the admin-managed list fetched at runtime. */
export function rankNearest(points: PickupPoint[], destination: GeoPoint | null, limit = 4): RankedPickupPoint[] {
  if (!destination) return points.slice(0, limit).map((p) => ({ ...p, distanceKm: 0 }));
  return points
    .map((p) => ({ ...p, distanceKm: calculateDistanceKm(destination, { latitude: p.lat, longitude: p.lng }) }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/**
 * Rank pickup points by real straight line distance to the booked property and
 * return the closest few. This is the proximity signal behind the "nearby"
 * suggestions, far better than matching on the city name. When the property has
 * no coordinates we fall back to the name based suggestion (distance 0).
 */
export function nearestPickupPoints(
  destination: GeoPoint | null,
  propertyArea: string | null | undefined,
  limit = 4
): RankedPickupPoint[] {
  if (!destination) {
    return suggestPickupPoints(propertyArea, limit).map((p) => ({ ...p, distanceKm: 0 }));
  }
  return PICKUP_POINTS.map((p) => ({
    ...p,
    distanceKm: calculateDistanceKm(destination, { latitude: p.lat, longitude: p.lng })
  }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

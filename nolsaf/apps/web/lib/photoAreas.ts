/**
 * Photo areas: which part of the home a listing photo shows. Mirrors
 * apps/api/src/lib/photoAreas.ts (same keys, same order); the server is the
 * one that enforces the long-stay rule.
 */

export const PHOTO_AREAS = [
  { key: "OUTSIDE", label: "Outside" },
  { key: "ENTRANCE", label: "Entrance" },
  { key: "LIVING", label: "Living room" },
  { key: "KITCHEN", label: "Kitchen" },
  { key: "DINING", label: "Dining" },
  { key: "BEDROOM", label: "Bedroom" },
  { key: "BATHROOM", label: "Bathroom" },
  { key: "BALCONY", label: "Balcony or terrace" },
  { key: "GARDEN", label: "Garden or outdoors" },
  { key: "PARKING", label: "Parking" },
  { key: "LAUNDRY", label: "Laundry" },
  { key: "WORKSPACE", label: "Workspace" },
  { key: "OTHER", label: "Other" },
] as const;

export type PhotoArea = (typeof PHOTO_AREAS)[number]["key"];

const LABELS = new Map<string, string>(PHOTO_AREAS.map((a) => [a.key, a.label]));
const ORDER = new Map<string, number>(PHOTO_AREAS.map((a, i) => [a.key, i]));

export function isPhotoArea(value: unknown): value is PhotoArea {
  return typeof value === "string" && LABELS.has(value);
}

export function photoAreaLabel(area: string): string {
  return LABELS.get(area) ?? "Other";
}

export function photoAreaOrder(area: string): number {
  return ORDER.get(area) ?? PHOTO_AREAS.length;
}

/** Areas a monthly tenant must see before a long stay is submitted. */
export const LONG_STAY_REQUIRED_AREAS: PhotoArea[] = ["KITCHEN", "BEDROOM", "BATHROOM"];

/** Reads a stored map (object or JSON string), keeping only known areas. */
export function readPhotoAreas(value: unknown): Record<string, PhotoArea> {
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, PhotoArea> = {};
  for (const [url, area] of Object.entries(raw as Record<string, unknown>)) {
    if (url && isPhotoArea(area)) out[url] = area;
  }
  return out;
}

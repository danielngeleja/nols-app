/**
 * Photo areas: which part of the home a listing photo shows. Stored on
 * Property.photoAreas as { [photoUrl]: AREA_KEY } and used to group the public
 * photo tour. The web copy lives in apps/web/lib/photoAreas.ts; keep both lists
 * in the same order.
 */

export const PHOTO_AREAS = [
  "OUTSIDE",
  "ENTRANCE",
  "LIVING",
  "KITCHEN",
  "DINING",
  "BEDROOM",
  "BATHROOM",
  "BALCONY",
  "GARDEN",
  "PARKING",
  "LAUNDRY",
  "WORKSPACE",
  "EVENT_SPACE",
  "OTHER",
] as const;

export type PhotoArea = (typeof PHOTO_AREAS)[number];

export const PHOTO_AREA_LABELS: Record<PhotoArea, string> = {
  OUTSIDE: "Outside",
  ENTRANCE: "Entrance",
  LIVING: "Living room",
  KITCHEN: "Kitchen",
  DINING: "Dining",
  BEDROOM: "Bedroom",
  BATHROOM: "Bathroom",
  BALCONY: "Balcony or terrace",
  GARDEN: "Garden or outdoors",
  PARKING: "Parking",
  LAUNDRY: "Laundry",
  WORKSPACE: "Workspace",
  EVENT_SPACE: "Event space",
  OTHER: "Other",
};

/** Areas a monthly tenant must be able to see before a long stay is submitted. */
export const LONG_STAY_REQUIRED_AREAS: PhotoArea[] = ["KITCHEN", "BEDROOM", "BATHROOM"];

const AREA_SET = new Set<string>(PHOTO_AREAS);

export function isPhotoArea(value: unknown): value is PhotoArea {
  return typeof value === "string" && AREA_SET.has(value);
}

/** MariaDB can hand JSON columns back as strings. */
function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function photoUrlList(photos: unknown): string[] {
  photos = parseJsonish(photos);
  if (!Array.isArray(photos)) return [];
  return photos.map((p) => String(p ?? "").trim()).filter(Boolean);
}

/**
 * Keeps only known area keys for photos that are on the listing. Anything else
 * (unknown keys, photos that were removed, oversized input) is dropped, never
 * refused, so a stale browser draft can always be saved.
 */
export function sanitizePhotoAreas(input: unknown, photos: unknown): Record<string, PhotoArea> | null {
  input = parseJsonish(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const allowed = new Set(photoUrlList(photos));
  const out: Record<string, PhotoArea> = {};
  let n = 0;
  for (const [url, area] of Object.entries(input as Record<string, unknown>)) {
    if (n >= 200) break;
    const key = String(url).trim();
    if (!key || key.length > 2048 || !allowed.has(key) || !isPhotoArea(area)) continue;
    out[key] = area;
    n += 1;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Long stay submit rule: every photo has an area, and the kitchen, a bedroom
 * and a bathroom are shown. Returns a human message, or null when it passes.
 */
export function longStayPhotoAreaRefusal(photos: unknown, areas: unknown): string | null {
  const urls = photoUrlList(photos);
  const map = sanitizePhotoAreas(areas, urls) || {};
  const unlabelled = urls.filter((u) => !map[u]).length;
  if (unlabelled > 0) {
    return unlabelled === 1
      ? "One photo has no area yet. Choose the area for every photo before submitting a long stay."
      : `${unlabelled} photos have no area yet. Choose the area for every photo before submitting a long stay.`;
  }
  const shown = new Set(Object.values(map));
  const missing = LONG_STAY_REQUIRED_AREAS.filter((a) => !shown.has(a)).map((a) => PHOTO_AREA_LABELS[a].toLowerCase());
  if (missing.length) {
    const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
    return `Tenants need to see the ${list}. Add a photo of ${missing.length === 1 ? "it" : "each"} before submitting a long stay.`;
  }
  return null;
}

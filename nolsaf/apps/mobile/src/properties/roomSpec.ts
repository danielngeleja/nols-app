import { RoomSpec } from "./types";

/**
 * Room normalization ported from the web (apps/web/lib/propertyUtils.ts) so the
 * mobile Rooms section shows the same depth: bed summary and dimensions,
 * description, amenities, bathroom details, smoking, price, and discount.
 */

const BED_DIMENSIONS: Record<string, string> = {
  twin: '38" x 75" (96.5 x 190.5 cm)',
  full: '54" x 75" (137 x 190.5 cm)',
  queen: '60" x 80" (152.4 x 203.2 cm)',
  king: '76" x 80" (193 x 203.2 cm)'
};

const BED_KEYS: Array<{ key: string; label: string }> = [
  { key: "twin", label: "Twin" },
  { key: "full", label: "Full" },
  { key: "queen", label: "Queen" },
  { key: "king", label: "King" }
];

export function bedsToSummary(beds: unknown): string {
  if (!beds || typeof beds !== "object") return "";
  const obj = beds as Record<string, unknown>;
  const parts = BED_KEYS.map(({ key, label }) => {
    const n = Number(obj[key]);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `${n} ${label}`;
  }).filter(Boolean) as string[];
  return parts.join(", ");
}

export function getBedDimensions(bedsSummary: string): string | null {
  if (!bedsSummary) return null;
  const types = bedsSummary
    .split(",")
    .map((s) => {
      const m = s.trim().match(/\d+\s+(twin|full|queen|king)/i);
      return m ? m[1].toLowerCase() : null;
    })
    .filter(Boolean) as string[];
  const unique = Array.from(new Set(types));
  const dims = unique
    .map((t) => (BED_DIMENSIONS[t] ? `${t.charAt(0).toUpperCase() + t.slice(1)}: ${BED_DIMENSIONS[t]}` : null))
    .filter(Boolean) as string[];
  return dims.length ? dims.join(" · ") : null;
}

export type NormalizedRoom = {
  /** Explicit code from roomsSpec, when the owner supplied one. */
  sourceCode: string | null;
  roomType: string;
  roomsCount: number | null;
  bedsSummary: string;
  bedDimensions: string | null;
  description: string;
  amenities: string[];
  bathItems: string[];
  bathPrivate: string;
  smoking: string;
  pricePerNight: number | null;
  discountLabel: string | null;
  floors: number[];
};

/**
 * Reads the per floor count map (floorDistribution) on a room spec and returns
 * the sorted list of floors this room type sits on. 0 means ground floor.
 */
function roomFloors(raw: Record<string, unknown>): number[] {
  let dist = raw.floorDistribution as unknown;
  if (typeof dist === "string") {
    try {
      dist = JSON.parse(dist);
    } catch {
      dist = null;
    }
  }
  if (!dist || typeof dist !== "object" || Array.isArray(dist)) return [];
  const floors: number[] = [];
  for (const [k, v] of Object.entries(dist as Record<string, unknown>)) {
    const floor = Number(k);
    const count = Number(v) || 0;
    if (Number.isFinite(floor) && count > 0) floors.push(floor);
  }
  return Array.from(new Set(floors)).sort((a, b) => a - b);
}

export function normalizeRoom(
  r: RoomSpec,
  idx: number,
  currency: string | null,
  fallbackBasePrice: number | null
): NormalizedRoom {
  const raw = r as Record<string, unknown>;
  const sourceCode = String(r.code ?? raw.roomCode ?? "").trim() || null;
  const roomType = String(r.roomType || r.name || raw.label || `Room ${idx + 1}`).trim() || `Room ${idx + 1}`;
  const roomsCountRaw = raw.roomsCount ?? r.count ?? r.quantity ?? null;
  const roomsCount = roomsCountRaw == null ? null : Number.isFinite(Number(roomsCountRaw)) ? Number(roomsCountRaw) : null;

  const bedsSummary = bedsToSummary(raw.beds);
  const description = String(raw.roomDescription || r.description || "").trim();

  const amenities = Array.from(
    new Set(
      [
        ...(Array.isArray(raw.otherAmenities) ? (raw.otherAmenities as unknown[]) : []),
        ...(Array.isArray(raw.amenities) ? (raw.amenities as unknown[]) : [])
      ]
        .map((x) => String(x || "").trim())
        .filter(Boolean)
    )
  );

  const priceRaw = r.pricePerNight ?? r.price ?? null;
  const pricePerNight =
    Number.isFinite(Number(priceRaw)) && Number(priceRaw) > 0
      ? Number(priceRaw)
      : fallbackBasePrice != null
        ? Number(fallbackBasePrice)
        : null;

  const cur = currency || "TZS";
  const discountPercent = Number(raw.discountPercent);
  const discountAmount = Number(raw.discountAmount);
  const discountedPrice = Number(raw.discountedPrice);
  const discountLabel =
    Number.isFinite(discountPercent) && discountPercent > 0
      ? `${discountPercent}% off`
      : Number.isFinite(discountAmount) && discountAmount > 0
        ? `${discountAmount.toLocaleString()} ${cur} off`
        : Number.isFinite(discountedPrice) && discountedPrice > 0 && pricePerNight && discountedPrice < pricePerNight
          ? `Now ${discountedPrice.toLocaleString()} ${cur}`
          : null;

  const bathItems = Array.isArray(raw.bathItems)
    ? (raw.bathItems as unknown[]).map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  return {
    sourceCode,
    roomType,
    roomsCount,
    bedsSummary,
    bedDimensions: getBedDimensions(bedsSummary),
    description,
    amenities,
    bathItems,
    bathPrivate: String(raw.bathPrivate || "").toLowerCase(),
    smoking: String(raw.smoking || "").toLowerCase(),
    pricePerNight,
    discountLabel,
    floors: roomFloors(raw)
  };
}

/**
 * Resolve a booking-screen room choice to its exact roomsSpec entry.
 *
 * New mobile navigation stores the array index because owners may legitimately
 * publish multiple entries with the same room type but different beds/prices.
 * The code/type fallback keeps older navigation payloads working.
 */
export function resolveRoomOptionIndex(rooms: readonly NormalizedRoom[], selection: string | null | undefined): number | null {
  const value = String(selection ?? "").trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const index = Number(value);
    if (Number.isSafeInteger(index) && index >= 0 && index < rooms.length) return index;
  }

  const index = rooms.findIndex((room) => room.sourceCode === value || room.roomType === value);
  return index >= 0 ? index : null;
}

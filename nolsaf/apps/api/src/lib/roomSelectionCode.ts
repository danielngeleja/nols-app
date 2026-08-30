/**
 * Stable per-option identity for `Property.roomsSpec` entries.
 *
 * Owners are told to save rooms that differ in beds or price as separate
 * options, so one property legitimately holds several entries sharing a room
 * type: "3 Single rooms with 1 Queen", then "2 Single rooms with 1 King".
 * Those are separate sellable products with their own capacity and price, not
 * one type sold at two rates.
 *
 * Every reader of a stored `roomCode` resolves `code` ahead of the room type,
 * so giving each option its own code is enough to make availability, pricing,
 * payment, and NRMS treat the variants separately. No reader has to change.
 *
 * The code is derived from the option's own content and never from its array
 * position. A position silently repoints at a different room the moment an
 * owner reorders or removes an option, and it is persisted on every booking.
 */

/** The public booking API accepts `roomCode` up to 60 characters. */
const MAX_CODE_LENGTH = 60;

const BED_KEYS: Array<{ key: string; label: string }> = [
  { key: "twin", label: "Twin" },
  { key: "full", label: "Full" },
  { key: "queen", label: "Queen" },
  { key: "king", label: "King" },
];

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * A trailing "-<digits>" marks one physical room unit ("Suite-1"), which makes
 * capacity collapse to a single room. A generated type-level code must never
 * look like that, so the hyphen is dropped.
 */
function avoidUnitCodeShape(value: string): string {
  return value.replace(/-(\d+)$/, " $1");
}

/** "1 Queen", or "1 Queen 2 Twin" when a room really holds mixed beds. */
export function bedsToCodePart(beds: unknown): string {
  if (!beds || typeof beds !== "object") return "";
  const source = beds as Record<string, unknown>;
  const parts = BED_KEYS.map(({ key, label }) => {
    const count = Number(source[key]);
    if (!Number.isFinite(count) || count <= 0) return null;
    return `${count} ${label}`;
  }).filter((part): part is string => part != null);
  return parts.join(" ");
}

/** The code an owner or an NRMS import already put on the entry, if any. */
export function existingRoomCode(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") return null;
  const source = entry as Record<string, unknown>;
  const code = firstString(source.code, source.roomCode);
  return code || null;
}

/** Content-derived code for one roomsSpec entry, ignoring any existing code. */
export function roomSelectionCodeFor(entry: unknown): string {
  const source = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
  const base = firstString(source.roomType, source.type, source.name, source.label) || "Room";
  const bedPart = bedsToCodePart(source.beds);
  const combined = collapseSpaces(bedPart ? `${base} ${bedPart}` : base);
  return avoidUnitCodeShape(combined.slice(0, MAX_CODE_LENGTH).trim());
}

/** The room type an entry would bucket under today, with no code applied. */
function roomTypeKeyOf(entry: unknown): string {
  const source = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
  return firstString(source.roomType, source.type, source.name, source.label).toLowerCase();
}

/**
 * Assign a code to every roomsSpec entry that lacks one, keeping codes unique
 * within the property. Existing codes are preserved so this is safe to run on
 * every save and on already-coded properties.
 *
 * Codes are only assigned when the property actually publishes two or more
 * options under one room type, which is the only case the room type cannot
 * describe. Leaving unambiguous properties untouched matters: a code changes
 * the bucket key a room is counted under, and bookings already sold carry the
 * room type as their roomCode. Recoding those properties would stop their
 * existing bookings from matching any bucket and quietly free sold rooms.
 */
export function ensureRoomsSpecCodes<T>(roomsSpec: T): T {
  if (!Array.isArray(roomsSpec)) return roomsSpec;

  const seenTypes = new Map<string, number>();
  for (const entry of roomsSpec) {
    const key = roomTypeKeyOf(entry);
    if (key) seenTypes.set(key, (seenTypes.get(key) ?? 0) + 1);
  }
  const hasDuplicateType = Array.from(seenTypes.values()).some((count) => count > 1);
  if (!hasDuplicateType) return roomsSpec;

  const used = new Set<string>();
  for (const entry of roomsSpec) {
    const code = existingRoomCode(entry);
    if (code) used.add(code.toLowerCase());
  }

  const result = roomsSpec.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    if (existingRoomCode(entry)) return entry;

    const base = roomSelectionCodeFor(entry);
    let code = base;
    let attempt = 2;
    while (used.has(code.toLowerCase())) {
      const suffix = ` Option ${attempt}`;
      code = avoidUnitCodeShape(`${base.slice(0, MAX_CODE_LENGTH - suffix.length).trim()}${suffix}`);
      attempt += 1;
    }
    used.add(code.toLowerCase());

    return { ...(entry as Record<string, unknown>), code };
  });

  return result as unknown as T;
}

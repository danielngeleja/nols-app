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

function canonicalCode(value: unknown): string {
  return collapseSpaces(String(value ?? "")).toLowerCase();
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

/** The legacy/category name used before roomsSpec entries had stable codes. */
export function roomTypeNameFor(entry: unknown): string {
  const source = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
  return firstString(source.roomType, source.type, source.name, source.label);
}

/** Accept both roomsSpec shapes used by older property records. */
export function roomsSpecEntries(roomsSpec: unknown): unknown[] {
  if (Array.isArray(roomsSpec)) return roomsSpec;
  if (!roomsSpec || typeof roomsSpec !== "object") return [];
  const nested = (roomsSpec as Record<string, unknown>).rooms;
  return Array.isArray(nested) ? nested : [];
}

/** Content-derived code for one roomsSpec entry, ignoring any existing code. */
export function roomSelectionCodeFor(entry: unknown): string {
  const source = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
  const base = firstString(source.roomType, source.type, source.name, source.label) || "Room";
  const bedPart = bedsToCodePart(source.beds);
  const combined = collapseSpaces(bedPart ? `${base} ${bedPart}` : base);
  return avoidUnitCodeShape(combined.slice(0, MAX_CODE_LENGTH).trim());
}

/** The effective persisted identity for an entry, including legacy uncoded rows. */
export function effectiveRoomSelectionCode(entry: unknown): string {
  return existingRoomCode(entry) ?? roomSelectionCodeFor(entry);
}

/**
 * Resolve a stored booking/block roomCode to the current availability buckets.
 *
 * An exact stable code maps to one bucket. A legacy bare room type ("Single")
 * maps to every current variant of that type ("Single 1 Queen", "Single 1
 * King"). Counting an ambiguous legacy reference against every candidate is
 * deliberately conservative: it can temporarily reduce sellable inventory,
 * but it can never make a room that was already sold appear free. The backfill
 * resolves unambiguous references and reports ambiguous ones for an operator.
 */
export function matchingRoomSelectionCodes(
  storedRoomCode: string | null | undefined,
  bucketKeys: string[],
  roomsSpec: unknown,
): string[] {
  const raw = collapseSpaces(String(storedRoomCode ?? ""));
  if (!raw || bucketKeys.length === 0) return [];

  const keyByCanonical = new Map<string, string>();
  for (const key of bucketKeys) {
    const canonical = canonicalCode(key);
    if (canonical && !keyByCanonical.has(canonical)) keyByCanonical.set(canonical, key);
  }

  const exact = keyByCanonical.get(canonicalCode(raw));
  if (exact) return [exact];

  // Preserve support for physical unit codes such as "Suite-2" when the
  // availability bucket is still the bare type "Suite".
  const withoutUnitSuffix = raw.replace(/-\d+$/, "").trim();
  const unitParent = keyByCanonical.get(canonicalCode(withoutUnitSuffix));
  if (unitParent) return [unitParent];

  const legacyType = canonicalCode(withoutUnitSuffix);
  const matches: string[] = [];
  for (const entry of roomsSpecEntries(roomsSpec)) {
    if (canonicalCode(roomTypeNameFor(entry)) !== legacyType) continue;
    const currentCode = effectiveRoomSelectionCode(entry);
    const bucket = keyByCanonical.get(canonicalCode(currentCode));
    if (bucket && !matches.includes(bucket)) matches.push(bucket);
  }

  return matches;
}

/**
 * Assign a code to every roomsSpec entry that lacks one, keeping codes unique
 * within the property. Existing codes are preserved so this is safe to run on
 * every save and on already-coded properties.
 *
 * Every entry is coded, not only the ambiguous ones. Coding a room changes the
 * bucket key it is counted under, so a property that gains its first duplicate
 * room type later would otherwise be recoded at that moment and orphan rooms it
 * had already sold under the bare room type. Coding everything up front means
 * an identity is assigned once, before anything is sold against it.
 */
export function ensureRoomsSpecCodes<T>(roomsSpec: T): T {
  if (!Array.isArray(roomsSpec)) {
    if (roomsSpec && typeof roomsSpec === "object") {
      const source = roomsSpec as Record<string, unknown>;
      if (Array.isArray(source.rooms)) {
        return {
          ...source,
          rooms: ensureRoomsSpecCodes(source.rooms),
        } as T;
      }
    }
    return roomsSpec;
  }

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

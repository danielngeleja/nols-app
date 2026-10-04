// What a floor is used for besides guest rooms. Stored on the property as
// `services.floorUses`: { [floor]: FloorUseKey[] }, floor 0 being the ground floor.

export const FLOOR_USES = [
  { key: "reception", label: "Reception" },
  { key: "restaurant", label: "Restaurant" },
  { key: "bar", label: "Bar" },
  { key: "offices", label: "Offices" },
  { key: "conference", label: "Conference" },
  { key: "gym_spa", label: "Gym or spa" },
  { key: "shops", label: "Shops" },
  { key: "parking", label: "Parking" },
  { key: "rooftop", label: "Rooftop" },
  { key: "private", label: "Private" },
] as const;

export type FloorUseKey = (typeof FLOOR_USES)[number]["key"];
export type FloorUses = Record<number, FloorUseKey[]>;

const KEYS = new Set<string>(FLOOR_USES.map((u) => u.key));

export function floorUseLabel(key: string): string {
  return FLOOR_USES.find((u) => u.key === key)?.label ?? key;
}

/** Reads `floorUses` out of a property's services value (object or JSON string). */
export function parseFloorUses(services: unknown): FloorUses {
  let obj: any = services;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return {};
    }
  }
  const raw = obj && typeof obj === "object" && !Array.isArray(obj) ? obj.floorUses : null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FloorUses = {};
  for (const [k, v] of Object.entries(raw)) {
    const floor = Number(k);
    if (!Number.isInteger(floor) || floor < 0 || floor > 200 || !Array.isArray(v)) continue;
    const uses = Array.from(new Set(v.filter((x): x is FloorUseKey => typeof x === "string" && KEYS.has(x))));
    if (uses.length) out[floor] = uses;
  }
  return out;
}

/** Drops floors the building does not have and floors with nothing set. */
export function cleanFloorUses(uses: FloorUses, totalFloors: number): FloorUses {
  const out: FloorUses = {};
  if (!Number.isFinite(totalFloors) || totalFloors < 2) return out;
  for (const [k, v] of Object.entries(uses || {})) {
    const floor = Number(k);
    if (floor >= 0 && floor < totalFloors && Array.isArray(v) && v.length) out[floor] = v;
  }
  return out;
}

export function floorName(f: number): string {
  if (f === 0) return "Ground";
  const mod100 = f % 100;
  const mod10 = f % 10;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${f}${suffix}`;
}

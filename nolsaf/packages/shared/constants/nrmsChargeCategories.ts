// NRMS guest folio charge categories. The API keeps an inlined copy in
// apps/api/src/lib/nrmsFolio.ts (apps/api has no workspace deps for EB);
// keep both lists in sync.
export const NRMS_CHARGE_CATEGORIES = [
  "RESTAURANT",
  "BAR",
  "LAUNDRY",
  "MINIBAR",
  "ROOM_SERVICE",
  "TRANSPORT",
  "DAMAGE",
  "OTHER",
] as const;

export type NrmsChargeCategory = (typeof NRMS_CHARGE_CATEGORIES)[number];

export const NRMS_CHARGE_CATEGORY_LABELS: Record<NrmsChargeCategory, string> = {
  RESTAURANT: "Restaurant",
  BAR: "Bar",
  LAUNDRY: "Laundry",
  MINIBAR: "Minibar",
  ROOM_SERVICE: "Room service",
  TRANSPORT: "Transport",
  DAMAGE: "Damage",
  OTHER: "Other",
};

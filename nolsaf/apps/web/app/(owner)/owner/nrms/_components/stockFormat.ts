// Shared wording and number formatting for the goods-level stock screens
// (docs/NRMS_STOCK_AND_PURCHASING.md). Quantities arrive in base units.

export const STOCK_CATEGORY_LABELS: Record<string, string> = {
  BEER: "Beer",
  SPIRITS: "Spirits",
  WINE: "Wine",
  SOFT_DRINKS: "Soft drinks",
  WATER: "Water",
  MEAT: "Meat",
  FISH_SEAFOOD: "Fish and seafood",
  POULTRY: "Poultry",
  PRODUCE: "Fruit and vegetables",
  DAIRY_EGGS: "Dairy and eggs",
  DRY_GOODS: "Dry goods",
  OTHER: "Other",
};

/**
 * One colour per stock category, so drinks and kitchen goods separate at a
 * glance. Written out in full so Tailwind keeps every class.
 */
export type CategoryTone = { dot: string; border: string; tile: string; text: string; chip: string; picked: string; check: string };
const TONE = (dot: string, border: string, tile: string, text: string, chip: string, picked: string, check: string): CategoryTone => ({ dot, border, tile, text, chip, picked, check });
export const STOCK_CATEGORY_TONES: Record<string, CategoryTone> = {
  BEER: TONE("bg-amber-500", "border-amber-200", "bg-amber-50 text-amber-700", "text-amber-800", "border-amber-500 bg-amber-500 text-white", "border-amber-500 bg-amber-50", "border-amber-500 bg-amber-500"),
  SPIRITS: TONE("bg-violet-500", "border-violet-200", "bg-violet-50 text-violet-700", "text-violet-800", "border-violet-600 bg-violet-600 text-white", "border-violet-500 bg-violet-50", "border-violet-600 bg-violet-600"),
  WINE: TONE("bg-rose-500", "border-rose-200", "bg-rose-50 text-rose-700", "text-rose-800", "border-rose-600 bg-rose-600 text-white", "border-rose-500 bg-rose-50", "border-rose-600 bg-rose-600"),
  SOFT_DRINKS: TONE("bg-orange-500", "border-orange-200", "bg-orange-50 text-orange-700", "text-orange-800", "border-orange-500 bg-orange-500 text-white", "border-orange-500 bg-orange-50", "border-orange-500 bg-orange-500"),
  WATER: TONE("bg-sky-500", "border-sky-200", "bg-sky-50 text-sky-700", "text-sky-800", "border-sky-600 bg-sky-600 text-white", "border-sky-500 bg-sky-50", "border-sky-600 bg-sky-600"),
  MEAT: TONE("bg-red-500", "border-red-200", "bg-red-50 text-red-700", "text-red-800", "border-red-600 bg-red-600 text-white", "border-red-500 bg-red-50", "border-red-600 bg-red-600"),
  POULTRY: TONE("bg-yellow-500", "border-yellow-200", "bg-yellow-50 text-yellow-700", "text-yellow-800", "border-yellow-500 bg-yellow-500 text-white", "border-yellow-500 bg-yellow-50", "border-yellow-500 bg-yellow-500"),
  FISH_SEAFOOD: TONE("bg-cyan-500", "border-cyan-200", "bg-cyan-50 text-cyan-700", "text-cyan-800", "border-cyan-600 bg-cyan-600 text-white", "border-cyan-500 bg-cyan-50", "border-cyan-600 bg-cyan-600"),
  PRODUCE: TONE("bg-lime-500", "border-lime-200", "bg-lime-50 text-lime-700", "text-lime-800", "border-lime-600 bg-lime-600 text-white", "border-lime-500 bg-lime-50", "border-lime-600 bg-lime-600"),
  DAIRY_EGGS: TONE("bg-indigo-400", "border-indigo-200", "bg-indigo-50 text-indigo-700", "text-indigo-800", "border-indigo-500 bg-indigo-500 text-white", "border-indigo-400 bg-indigo-50", "border-indigo-500 bg-indigo-500"),
  DRY_GOODS: TONE("bg-stone-500", "border-stone-300", "bg-stone-100 text-stone-700", "text-stone-800", "border-stone-600 bg-stone-600 text-white", "border-stone-500 bg-stone-50", "border-stone-600 bg-stone-600"),
  OTHER: TONE("bg-neutral-400", "border-neutral-300", "bg-neutral-100 text-neutral-600", "text-neutral-800", "border-neutral-600 bg-neutral-600 text-white", "border-neutral-500 bg-neutral-50", "border-neutral-600 bg-neutral-600"),
};
export function categoryTone(category: string): CategoryTone {
  return STOCK_CATEGORY_TONES[category] ?? STOCK_CATEGORY_TONES.OTHER;
}

export const STOCK_BASE_UNIT_LABELS: Record<string, string> = {
  BOTTLE: "Bottles",
  CAN: "Cans",
  PIECE: "Pieces",
  ML: "Millilitres (ml)",
  G: "Grams (g)",
};

const SINGULAR: Record<string, string> = { BOTTLE: "bottle", CAN: "can", PIECE: "piece" };
const PLURAL: Record<string, string> = { BOTTLE: "bottles", CAN: "cans", PIECE: "pieces" };

function trim(value: number, digits = 3): string {
  return Number(value.toFixed(digits)).toLocaleString(undefined, { maximumFractionDigits: digits });
}

/** "21 bottles", "1.5 kg", "750 ml". Weights and volumes step up past 1000. */
export function formatStockQuantity(quantity: number, baseUnit: string): string {
  if (baseUnit === "G") return Math.abs(quantity) >= 1000 ? `${trim(quantity / 1000)} kg` : `${trim(quantity, 0)} g`;
  if (baseUnit === "ML") return Math.abs(quantity) >= 1000 ? `${trim(quantity / 1000)} l` : `${trim(quantity, 0)} ml`;
  const word = Math.abs(quantity) === 1 ? SINGULAR[baseUnit] : PLURAL[baseUnit];
  return `${trim(quantity)} ${word ?? baseUnit.toLowerCase()}`;
}

/** Short unit for input labels and per-unit prices. */
export function unitShort(baseUnit: string): string {
  if (baseUnit === "G") return "g";
  if (baseUnit === "ML") return "ml";
  return SINGULAR[baseUnit] ?? baseUnit.toLowerCase();
}

export function formatMoney(value: number, currency: string): string {
  return `${Math.round(value).toLocaleString()} ${currency}`;
}

/** Per-unit cost can be fractional (TZS 26.67 per ml of gin). */
export function formatUnitCost(value: number, currency: string): string {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: value < 100 ? 2 : 0 })} ${currency}`;
}

export const MOVEMENT_LABELS: Record<string, string> = {
  OPENING_BALANCE: "Opening count",
  RECEIPT: "Received",
  RECEIPT_REVERSAL: "Receipt reversed",
  SALE: "Sold",
  SALE_REVERSAL: "Order cancelled",
  BREAKFAST_SERVICE: "Breakfast served",
};

export function apiError(cause: any, fallback: string): string {
  return cause?.response?.data?.error || fallback;
}

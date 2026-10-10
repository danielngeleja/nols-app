import { z } from "zod";

/**
 * Karibu guest preferences (docs/KARIBU_BY_NOLSAF.md section 14). Everything is
 * optional and off by default. Birthday is day and month only. Preferences never
 * decide eligibility or budget.
 */
export const KARIBU_DRINK_LIKES = ["TEA_COFFEE", "FRESH_JUICE", "SOFT_DRINK", "WATER", "MOCKTAIL"] as const;
export const KARIBU_DIETARY_TAGS = ["NO_SUGAR", "LACTOSE_FREE", "NUT_ALLERGY", "VEGETARIAN"] as const;
export type KaribuDrinkLike = (typeof KARIBU_DRINK_LIKES)[number];
export type KaribuDietaryTag = (typeof KARIBU_DIETARY_TAGS)[number];

export type KaribuPreferences = {
  celebrateOptIn: boolean;
  birthday: { day: number; month: number } | null;
  drinkLikes: KaribuDrinkLike[];
  dietaryTags: KaribuDietaryTag[];
  dietaryNote: string | null;
  shareWithProperty: boolean;
  updatedAt: string | null;
};

export const EMPTY_KARIBU_PREFERENCES: KaribuPreferences = {
  celebrateOptIn: false, birthday: null, drinkLikes: [], dietaryTags: [], dietaryNote: null, shareWithProperty: false, updatedAt: null,
};

// 2024 is a leap year, so 29 February is accepted as a birthday.
const validDayMonth = (day: number, month: number) => {
  const date = new Date(Date.UTC(2024, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export const karibuPreferencesInput = z.object({
  celebrateOptIn: z.boolean(),
  birthday: z.object({ day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12) }).nullable(),
  /** The guest confirms the birthday is their own, not the booker's (doc section 6). */
  birthdayIsMine: z.boolean().optional(),
  drinkLikes: z.array(z.enum(KARIBU_DRINK_LIKES)).max(KARIBU_DRINK_LIKES.length),
  dietaryTags: z.array(z.enum(KARIBU_DIETARY_TAGS)).max(KARIBU_DIETARY_TAGS.length),
  dietaryNote: z.string().trim().max(200).nullable(),
  shareWithProperty: z.boolean(),
}).superRefine((value, ctx) => {
  if (value.birthday && !validDayMonth(value.birthday.day, value.birthday.month)) {
    ctx.addIssue({ code: "custom", path: ["birthday"], message: "That day does not exist in that month" });
  }
  if (value.celebrateOptIn && value.birthday && value.birthdayIsMine !== true) {
    ctx.addIssue({ code: "custom", path: ["birthdayIsMine"], message: "Confirm the birthday is your own" });
  }
});

const pick = <T extends string>(value: unknown, allowed: readonly T[]): T[] =>
  Array.isArray(value) ? allowed.filter((entry) => value.includes(entry)) : [];

/** A stored row as the guest-facing shape; unknown values in JSON columns are dropped. */
export function shapeKaribuPreferences(row: any): KaribuPreferences {
  if (!row) return { ...EMPTY_KARIBU_PREFERENCES };
  const hasBirthday = Number.isInteger(row.birthdayDay) && Number.isInteger(row.birthdayMonth);
  return {
    celebrateOptIn: row.celebrateOptIn === true,
    birthday: hasBirthday ? { day: row.birthdayDay, month: row.birthdayMonth } : null,
    drinkLikes: pick(row.drinkLikes, KARIBU_DRINK_LIKES),
    dietaryTags: pick(row.dietaryTags, KARIBU_DIETARY_TAGS),
    dietaryNote: row.dietaryNote || null,
    shareWithProperty: row.shareWithProperty === true,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

/** Columns to write. The birthday is kept only while the guest wants special days celebrated. */
export function karibuPreferenceColumns(input: z.infer<typeof karibuPreferencesInput>, cleanNote: (text: string) => string) {
  const keepBirthday = input.celebrateOptIn && input.birthday;
  return {
    celebrateOptIn: input.celebrateOptIn,
    birthdayDay: keepBirthday ? input.birthday!.day : null,
    birthdayMonth: keepBirthday ? input.birthday!.month : null,
    drinkLikes: [...new Set(input.drinkLikes)],
    dietaryTags: [...new Set(input.dietaryTags)],
    dietaryNote: input.dietaryNote ? cleanNote(input.dietaryNote).slice(0, 200) || null : null,
    shareWithProperty: input.shareWithProperty,
  };
}

/**
 * Preferences are not usable yet: the table is not migrated (Prisma P2021), or the
 * running Prisma client was generated before the model existed (no delegate).
 */
export const isMissingTable = (error: unknown) => (error as any)?.code === "P2021" || (error as any)?.code === "KARIBU_PREFERENCES_UNAVAILABLE";

/** The preference delegate, or a thrown "unavailable" error when the client predates the model. */
export function preferenceStore(db: any) {
  const store = db?.karibuGuestPreference;
  if (!store) throw Object.assign(new Error("Prisma client has no karibuGuestPreference model; run prisma generate"), { code: "KARIBU_PREFERENCES_UNAVAILABLE" });
  return store;
}

const DIETARY_LABEL: Record<KaribuDietaryTag, string> = { NO_SUGAR: "No sugar", LACTOSE_FREE: "Lactose-free", NUT_ALLERGY: "Nut allergy", VEGETARIAN: "Vegetarian" };
const HAS_DAIRY = /\b(milk|milky|latte|cappuccino|macchiato|mocha|flat white|milkshake|shake|smoothie|yogh?urt|lassi|cream|chai latte)\b/i;
const HAS_NUTS = /\b(nut|nuts|peanut|almond|hazelnut|cashew|walnut|pistachio|macadamia|pecan|praline|nutella)\b/i;
const SUGAR_FREE = /\b(diet|zero|sugar[- ]?free|no sugar|unsweetened|light)\b/i;

/**
 * Why a drink must not be offered to this guest, or null. Clear cases only, judged
 * from the menu name and category: dairy for lactose-free, nuts for a nut allergy,
 * sweetened soft drinks for no sugar. Vegetarian never blocks a drink.
 */
export function drinkConflict(item: { name: string; category?: string | null }, dietaryTags: KaribuDietaryTag[]): string | null {
  const text = `${item.category || ""} ${item.name}`;
  if (dietaryTags.includes("NUT_ALLERGY") && HAS_NUTS.test(text)) return `${DIETARY_LABEL.NUT_ALLERGY}: may contain nuts`;
  if (dietaryTags.includes("LACTOSE_FREE") && HAS_DAIRY.test(text) && !/\b(oat|soy|almond|coconut) milk\b|lactose[- ]?free/i.test(text)) return `${DIETARY_LABEL.LACTOSE_FREE}: contains milk`;
  if (dietaryTags.includes("NO_SUGAR") && drinkLikeOfCategory(item.category) === "SOFT_DRINK" && !SUGAR_FREE.test(item.name)) return `${DIETARY_LABEL.NO_SUGAR}: sweetened soft drink`;
  return null;
}

/** True when the guest opted in and their birthday (day and month) falls on a night of this stay, in EAT. */
export function birthdayInStay(prefs: KaribuPreferences, checkIn: Date | string, checkOut: Date | string): boolean {
  if (!prefs.celebrateOptIn || !prefs.birthday) return false;
  const EAT_MS = 3 * 60 * 60 * 1000;
  const start = new Date(new Date(checkIn).getTime() + EAT_MS);
  const end = new Date(new Date(checkOut).getTime() + EAT_MS);
  for (let day = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())); day <= end; day = new Date(day.getTime() + 86_400_000)) {
    if (day.getUTCDate() === prefs.birthday.day && day.getUTCMonth() + 1 === prefs.birthday.month) return true;
  }
  return false;
}

const DRINK_LABEL: Record<KaribuDrinkLike, string> = { TEA_COFFEE: "tea or coffee", FRESH_JUICE: "fresh juice", SOFT_DRINK: "soft drinks", WATER: "water", MOCKTAIL: "mocktails" };

/**
 * The short line property staff see, e.g. "Likes fresh juice · Nut allergy · no ice".
 * Null unless the guest switched sharing on and gave something worth sharing.
 * Birthday is never included: celebrating is NoLSAF's to arrange.
 */
export function staffPreferenceNote(prefs: KaribuPreferences): string | null {
  if (!prefs.shareWithProperty) return null;
  const parts: string[] = [];
  if (prefs.drinkLikes.length) parts.push(`Likes ${prefs.drinkLikes.map((d) => DRINK_LABEL[d]).join(", ")}`);
  for (const tag of prefs.dietaryTags) parts.push(DIETARY_LABEL[tag]);
  if (prefs.dietaryNote) parts.push(prefs.dietaryNote);
  return parts.length ? parts.join(" · ") : null;
}

/** Staff notes for many guests at once, keyed by user id. Missing table or client model means no notes. */
export async function staffPreferenceNotesFor(db: any, userIds: number[]): Promise<Map<number, string>> {
  const notes = new Map<number, string>();
  const ids = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length || !db?.karibuGuestPreference) return notes;
  try {
    const rows = await db.karibuGuestPreference.findMany({ where: { userId: { in: ids }, shareWithProperty: true } });
    for (const row of rows) {
      const note = staffPreferenceNote(shapeKaribuPreferences(row));
      if (note) notes.set(row.userId, note);
    }
  } catch (error) {
    if (!isMissingTable(error)) throw error;
  }
  return notes;
}

/** Map a menu item's category to the drink-like it satisfies, so liked drinks can be listed first. */
export function drinkLikeOfCategory(category: string | null | undefined): KaribuDrinkLike | null {
  const value = String(category || "").trim().toLowerCase();
  if (value === "tea and coffee") return "TEA_COFFEE";
  if (value === "fresh juices") return "FRESH_JUICE";
  if (value === "soft drinks" || value === "soft drinks and mixers") return "SOFT_DRINK";
  if (value === "water") return "WATER";
  if (value === "mocktails") return "MOCKTAIL";
  return null;
}

/** Karibu NoLSAF (docs/KARIBU_BY_NOLSAF.md on staging). Mirrors /api/customer/karibu. */

export type KaribuFeedback = { received: boolean; rating: number | null; note: string | null; at: string };

export type KaribuMoment = {
  id: number;
  bookingReference: string;
  property: string;
  checkIn: string;
  drink: string;
  status: "ORDERED" | "SERVED";
  issuedAt: string;
  servedAt: string | null;
  feedback: KaribuFeedback | null;
};

export type KaribuStay = {
  bookingReference: string;
  property: string;
  city: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  welcomed: boolean;
};

export type KaribuJourney = {
  completedStayCount: number;
  totals?: { nights: number; places: number };
  upcoming?: { bookingReference: string; property: string; city: string | null; checkIn: string; checkOut: string; inHouse: boolean } | null;
  recentStays?: KaribuStay[];
  firstStay: { bookingReference: string; property: string; completedAt: string } | null;
  moments: KaribuMoment[];
};

export const KARIBU_DRINKS = [
  ["TEA_COFFEE", "Tea or coffee"],
  ["FRESH_JUICE", "Fresh juice"],
  ["SOFT_DRINK", "Soft drink"],
  ["WATER", "Water"],
  ["MOCKTAIL", "Mocktail"]
] as const;

export const KARIBU_DIETARY = [
  ["NO_SUGAR", "No sugar"],
  ["LACTOSE_FREE", "Lactose-free"],
  ["NUT_ALLERGY", "Nut allergy"],
  ["VEGETARIAN", "Vegetarian"]
] as const;

export type KaribuPreferences = {
  celebrateOptIn: boolean;
  /** Day and month only; the year is never asked. */
  birthday: { day: number; month: number } | null;
  drinkLikes: string[];
  dietaryTags: string[];
  dietaryNote: string | null;
  shareWithProperty: boolean;
  updatedAt: string | null;
};

/** `available` is false until the karibu_guest_preference table is migrated; the card stays hidden then. */
export type KaribuPreferencesResponse = { available: boolean; preferences: KaribuPreferences };

export type KaribuPreferencesInput = Omit<KaribuPreferences, "updatedAt"> & { birthdayIsMine: boolean };

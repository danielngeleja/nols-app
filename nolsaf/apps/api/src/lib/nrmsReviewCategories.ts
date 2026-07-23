/**
 * Verified-stay review categories.
 *
 * Keys intentionally match the marketplace `PropertyReview.categoryRatings` JSON
 * shape (customerCare, security, reality, comfort) so a property's NRMS
 * verified-stay scores and its public review scores can be compared and, later,
 * merged into one reputation figure. New keys are additive only.
 *
 * A property never gets the whole list. The owner picks which categories apply
 * in NRMS settings, because asking a guesthouse with no kitchen to rate the
 * restaurant makes the survey read as machine-generated and costs completions.
 */
export const NRMS_REVIEW_CATEGORIES = [
  { key: "cleanliness", label: "Cleanliness" },
  { key: "customerCare", label: "Customer care" },
  { key: "security", label: "Security and safety" },
  { key: "comfort", label: "Comfort and quietness" },
  { key: "reality", label: "Matched the photos" },
  { key: "value", label: "Value for money" },
  { key: "restaurant", label: "Food and restaurant" },
] as const;

export type NrmsReviewCategoryKey = (typeof NRMS_REVIEW_CATEGORIES)[number]["key"];

export const NRMS_REVIEW_CATEGORY_KEYS = NRMS_REVIEW_CATEGORIES.map((item) => item.key) as NrmsReviewCategoryKey[];

/** Applied when an owner has never opened the settings. Safe for any property. */
export const DEFAULT_NRMS_REVIEW_CATEGORIES: NrmsReviewCategoryKey[] = ["cleanliness", "customerCare", "security", "comfort"];

const isKey = (value: unknown): value is NrmsReviewCategoryKey =>
  typeof value === "string" && (NRMS_REVIEW_CATEGORY_KEYS as string[]).includes(value);

/** Normalise whatever is stored on Property.nrmsReviewCategories into a clean, ordered key list. */
export function resolveReviewCategories(stored: unknown): NrmsReviewCategoryKey[] {
  if (!Array.isArray(stored)) return DEFAULT_NRMS_REVIEW_CATEGORIES;
  const chosen = new Set(stored.filter(isKey));
  if (!chosen.size) return [];
  return NRMS_REVIEW_CATEGORY_KEYS.filter((key) => chosen.has(key));
}

/** Category list with labels, ready for the guest page. */
export function reviewCategoryOptions(stored: unknown): Array<{ key: NrmsReviewCategoryKey; label: string }> {
  const keys = new Set(resolveReviewCategories(stored));
  return NRMS_REVIEW_CATEGORIES.filter((item) => keys.has(item.key)).map((item) => ({ key: item.key, label: item.label }));
}

/**
 * Keep only categories the property actually asked about, with a valid 1-5 score.
 * A guest can skip any category, so partial objects are expected and fine.
 */
export function sanitiseCategoryRatings(input: unknown, allowed: NrmsReviewCategoryKey[]): Record<string, number> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const permitted = new Set(allowed);
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isKey(key) || !permitted.has(key)) continue;
    const score = Number(value);
    if (!Number.isInteger(score) || score < 1 || score > 5) continue;
    out[key] = score;
  }
  return Object.keys(out).length ? out : null;
}

/** Per-category averages across a set of responses, for the owner dashboard. */
export function averageCategoryRatings(rows: Array<{ categoryRatings: unknown }>): Array<{ key: string; label: string; average: number; responses: number }> {
  const totals = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const ratings = row.categoryRatings;
    if (!ratings || typeof ratings !== "object" || Array.isArray(ratings)) continue;
    for (const [key, value] of Object.entries(ratings as Record<string, unknown>)) {
      const score = Number(value);
      if (!isKey(key) || !Number.isFinite(score)) continue;
      const bucket = totals.get(key) ?? { sum: 0, count: 0 };
      bucket.sum += score; bucket.count += 1; totals.set(key, bucket);
    }
  }
  return NRMS_REVIEW_CATEGORIES.filter((item) => totals.has(item.key)).map((item) => {
    const bucket = totals.get(item.key)!;
    return { key: item.key, label: item.label, average: Number((bucket.sum / bucket.count).toFixed(2)), responses: bucket.count };
  });
}

/** Ratings at or below this get the private recovery path instead of a share prompt. */
export const REVIEW_RECOVERY_THRESHOLD = 3;

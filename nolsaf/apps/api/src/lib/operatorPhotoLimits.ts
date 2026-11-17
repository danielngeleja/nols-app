/**
 * Photo policy for tour operator profiles: a few strong photos per group,
 * never a dump of a hundred. Enforced on save, so no client can get around it.
 *
 * - logo: 1
 * - proof: 8, because NoLSAF attaches the operator's verified documents
 *   (BRELA, TIN, licences, ID: up to 5) to this group, plus up to 3 photos
 * - every other group: 3
 *
 * A profile saved before this rule may already hold more. It is not broken:
 * it can be saved as it is or with fewer photos, but never gain one while it
 * is over the limit.
 */
export const OPERATOR_PHOTO_LIMIT_DEFAULT = 3;
export const OPERATOR_PHOTO_LIMITS: Record<string, number> = { logo: 1, proof: 8 };

export function operatorPhotoLimit(category: string): number {
  return OPERATOR_PHOTO_LIMITS[category] ?? OPERATOR_PHOTO_LIMIT_DEFAULT;
}

type PhotoMap = Record<string, unknown> | null | undefined;

function urls(map: PhotoMap, key: string): string[] {
  const list = map && typeof map === "object" ? (map as Record<string, unknown>)[key] : undefined;
  return Array.isArray(list) ? list.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
}

export type PhotoLimitBreach = { category: string; limit: number; count: number };

/** Groups that break the policy in `next`, compared with what was saved before. */
export function photoLimitBreaches(next: PhotoMap, previous: PhotoMap): PhotoLimitBreach[] {
  const keys = new Set([
    ...Object.keys(next && typeof next === "object" ? next : {}),
  ]);
  const breaches: PhotoLimitBreach[] = [];
  for (const category of keys) {
    const now = Array.from(new Set(urls(next, category)));
    const limit = operatorPhotoLimit(category);
    if (now.length <= limit) continue;
    // Over the limit is tolerated only for an older profile that is not growing.
    const before = new Set(urls(previous, category));
    const added = now.filter((url) => !before.has(url));
    if (added.length === 0 && now.length <= before.size) continue;
    breaches.push({ category, limit, count: now.length });
  }
  return breaches;
}

export function photoLimitMessage(breaches: PhotoLimitBreach[]): string {
  const parts = breaches.map((b) => `${b.category}: ${b.count} of ${b.limit} allowed`);
  return `Too many photos in one group. Keep at most 3 per group (1 for the logo). ${parts.join("; ")}.`;
}

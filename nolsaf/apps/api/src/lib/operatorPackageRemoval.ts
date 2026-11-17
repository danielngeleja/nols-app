// =============================================================================
// Removing a tour package safely.
//
//  - An ordinary profile save can never delete a package. Packages leave only
//    through the remove action, which the operator confirms by typing the name.
//  - A package with a booking that is not finished (awaiting payment, paid or
//    confirmed) cannot be removed: travellers are relying on it.
//  - A removed package is kept for RESTORE_WINDOW_DAYS and can be restored.
// =============================================================================

export const REMOVED_PACKAGES_KEY = "removedPackages";
export const RESTORE_WINDOW_DAYS = 30;
const MAX_REMOVED_KEPT = 50;

/** Booking states that still depend on the package. */
export const PACKAGE_BLOCKING_BOOKING_STATUSES = ["PENDING_PAYMENT", "PAID", "CONFIRMED"];

export type RemovedPackage = {
  item: Record<string, any>;
  removedAt: string;
  removedByUserId: number | null;
  /** The approved (live) copy at removal, put back on restore without a new review. */
  liveItem?: Record<string, any> | null;
};

/** Takes a package out of the approved copy travellers see, returning the copy and what was removed. */
export function withoutLivePackage(profile: Record<string, any>, packageId: string): {
  approvedSnapshot: Record<string, any> | undefined;
  liveItem: Record<string, any> | null;
} {
  const snap = profile.approvedSnapshot;
  if (!snap || typeof snap !== "object" || !Array.isArray(snap.packageItems)) {
    return { approvedSnapshot: snap, liveItem: null };
  }
  const liveItem = snap.packageItems.find((p: unknown) => packageIdOf(p) === packageId) ?? null;
  if (!liveItem) return { approvedSnapshot: snap, liveItem: null };
  return {
    approvedSnapshot: { ...snap, packageItems: snap.packageItems.filter((p: unknown) => packageIdOf(p) !== packageId) },
    liveItem,
  };
}

export const packageIdOf = (item: unknown): string =>
  item && typeof item === "object" ? String((item as any).id || "").trim() : "";

export function readRemovedPackages(profile: unknown): RemovedPackage[] {
  const raw = profile && typeof profile === "object" ? (profile as any)[REMOVED_PACKAGES_KEY] : null;
  if (!Array.isArray(raw)) return [];
  return raw.filter((r) => r && typeof r === "object" && r.item && typeof r.item === "object" && typeof r.removedAt === "string");
}

export function isRestorable(entry: RemovedPackage, now = Date.now()): boolean {
  const at = new Date(entry.removedAt).getTime();
  return Number.isFinite(at) && now - at <= RESTORE_WINDOW_DAYS * 86_400_000;
}

/** Restorable entries only, newest first; older ones are dropped. */
export function pruneRemovedPackages(entries: RemovedPackage[], now = Date.now()): RemovedPackage[] {
  return entries
    .filter((e) => isRestorable(e, now))
    .sort((a, b) => b.removedAt.localeCompare(a.removedAt))
    .slice(0, MAX_REMOVED_KEPT);
}

const normaliseName = (v: unknown) => String(v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/** The operator typed the package name (an unnamed package needs no typing). */
export function removalNameConfirmed(item: Record<string, any>, typed: unknown): boolean {
  const name = normaliseName(item?.name || item?.title);
  if (!name) return true;
  return normaliseName(typed) === name;
}

/**
 * Applies the rule that a profile save never deletes packages:
 *  - a package the operator had before but the save left out is kept;
 *  - a package that was removed through the remove action is not brought back
 *    by an older copy of the page.
 */
export function guardPackageItems(previous: unknown, incoming: unknown, removed: RemovedPackage[]): {
  items: any[];
  keptIds: string[];
  droppedIds: string[];
} {
  const prev = Array.isArray(previous) ? previous : [];
  const next = Array.isArray(incoming) ? incoming : [];
  const removedIds = new Set(removed.map((r) => packageIdOf(r.item)).filter(Boolean));

  const droppedIds: string[] = [];
  const items = next.filter((item) => {
    const id = packageIdOf(item);
    if (id && removedIds.has(id)) {
      droppedIds.push(id);
      return false;
    }
    return true;
  });

  const present = new Set(items.map(packageIdOf).filter(Boolean));
  const keptIds: string[] = [];
  for (const item of prev) {
    const id = packageIdOf(item);
    if (!id || present.has(id) || removedIds.has(id)) continue;
    items.push(item);
    keptIds.push(id);
  }
  return { items, keptIds, droppedIds };
}

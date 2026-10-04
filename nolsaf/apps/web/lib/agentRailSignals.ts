// Shared channel for the workload signals shown on the agent workspace sidebar.
// Each page already groups its own records, so it publishes that tally rather
// than the rail fetching the same lists again. Follows the existing agent:*
// CustomEvent convention used for the notification badge.
//
// The rail renders presence, not volume: a non-zero count becomes a dot. Counts
// are still carried so screen readers get the real number, and they are cached
// per tab so the rail is not blank when a group is opened from another page.

export const RAIL_SIGNAL_GROUPS = ["bookings", "cases", "revenues"] as const;

export type RailSignalGroup = (typeof RAIL_SIGNAL_GROUPS)[number];

/** Counts keyed by the nav child they belong to, e.g. { new: 3, confirmed: 0 }. */
export type RailCounts = Record<string, number>;

export const RAIL_COUNTS_EVENT = "agent:rail:counts";

const storageKey = (group: RailSignalGroup) => `nolsaf:agentRail:counts:${group}`;

function sanitize(input: unknown): RailCounts | null {
  if (!input || typeof input !== "object") return null;
  const counts: RailCounts = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const value = Number(raw);
    counts[key] = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }
  return counts;
}

export function publishRailCounts(group: RailSignalGroup, counts: RailCounts) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(group), JSON.stringify(counts));
  } catch {
    // private mode or blocked storage: the live event still updates the rail
  }
  window.dispatchEvent(new CustomEvent(RAIL_COUNTS_EVENT, { detail: { group, counts } }));
}

export function readCachedRailCounts(group: RailSignalGroup): RailCounts | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey(group));
    return raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function parseRailCountsDetail(
  detail: unknown
): { group: RailSignalGroup; counts: RailCounts } | null {
  if (!detail || typeof detail !== "object") return null;
  const { group, counts } = detail as { group?: unknown; counts?: unknown };
  if (!RAIL_SIGNAL_GROUPS.includes(group as RailSignalGroup)) return null;
  const parsed = sanitize(counts);
  return parsed ? { group: group as RailSignalGroup, counts: parsed } : null;
}

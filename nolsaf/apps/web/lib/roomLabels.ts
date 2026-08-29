/**
 * Room labels for a reservation, counted instead of repeated.
 *
 * A ten-room agency booking holds ten allocations of the same room type, which
 * reads as "Any Double, Any Double, Any Double, …" once listed one by one. Once
 * real rooms are assigned the codes differ and every entry stands on its own,
 * so only identical labels collapse.
 */
export function tallyRoomLabels(labels: Array<string | null | undefined>, fallback = ""): string {
  const tally = new Map<string, number>();
  for (const label of labels) {
    const text = String(label ?? "").trim();
    if (!text) continue;
    tally.set(text, (tally.get(text) ?? 0) + 1);
  }
  if (tally.size === 0) return fallback;
  return [...tally.entries()].map(([label, count]) => (count > 1 ? `${count} × ${label}` : label)).join(", ");
}

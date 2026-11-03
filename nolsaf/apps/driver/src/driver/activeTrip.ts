import type { TripListItem } from "./types";

const DISPATCH_LOOKAHEAD_MS = 20 * 60 * 1000;

/** A confirmed future assignment does not start sharing location months early. */
export function selectTrackableTrip(trips: TripListItem[], now = Date.now()): TripListItem | null {
  const inProgress = trips.find((trip) => trip.status === "IN_PROGRESS");
  if (inProgress) return inProgress;

  return trips
    .filter((trip) => {
      if (trip.status !== "CONFIRMED") return false;
      if (!trip.scheduledDate) return true;
      const scheduledAt = Date.parse(trip.scheduledDate);
      return Number.isFinite(scheduledAt) && scheduledAt <= now + DISPATCH_LOOKAHEAD_MS;
    })
    .sort((a, b) => (a.scheduledDate ? Date.parse(a.scheduledDate) : now) - (b.scheduledDate ? Date.parse(b.scheduledDate) : now))[0] ?? null;
}

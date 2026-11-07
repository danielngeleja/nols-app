/**
 * Visit mode: rules for a sales partner's on-site check-in.
 *
 * A check-in is evidence, so every rule here asks "could this have been
 * produced without being at the property, at that time?". Each warning sign
 * becomes a flag on the visit; any flag marks it FLAGGED for an administrator.
 * The rules are pure so they can be tested without a database.
 */

const EARTH_RADIUS_M = 6_371_000;
const MINUTE_MS = 60_000;

/** A check-in saved offline may arrive late, but not days later. */
export const MAX_OFFLINE_DELAY_MS = 48 * 60 * MINUTE_MS;
/** Device clocks drift a little; a capture time further ahead is refused. */
export const MAX_CLOCK_AHEAD_MS = 2 * MINUTE_MS;

export const VISIT_RULES = {
  /** Distance from the property (beyond the GPS accuracy) that is not "at the property". */
  farFromPropertyMeters: 500,
  /** GPS fixes worse than this cannot place someone at a building. */
  lowAccuracyMeters: 150,
  /** Phones never report sub-metre accuracy; mock-location apps often do. */
  suspiciousAccuracyMeters: 1,
  /** A GPS fix this much older than the tap is a cached position, not a live one. */
  stalePositionMs: 5 * MINUTE_MS,
  /** Sent this long after the tap: saved offline. Allowed, but shown. */
  delayedUploadMs: 30 * MINUTE_MS,
  /** Faster than this between two check-ins is not possible by road. */
  maxTravelKmh: 120,
  /** Short hops are ignored for the travel rule (GPS jitter between neighbours). */
  minTravelCheckMeters: 2_000,
  /** This many check-ins in the window before this one is a burst. */
  burstCount: 6,
  burstWindowMs: 120 * MINUTE_MS,
} as const;

export const VISIT_FLAGS = [
  "FAR_FROM_PROPERTY",
  "LOW_ACCURACY",
  "SUSPICIOUS_ACCURACY",
  "STALE_POSITION",
  "DELAYED_UPLOAD",
  "IMPOSSIBLE_TRAVEL",
  "REUSED_PHOTO",
  "BURST",
] as const;
export type VisitFlag = (typeof VISIT_FLAGS)[number];

/** Plain-language explanation of each flag, for admin and partner screens. */
export const VISIT_FLAG_TEXT: Record<VisitFlag, string> = {
  FAR_FROM_PROPERTY: "Checked in far from the property",
  LOW_ACCURACY: "GPS was too imprecise to place them at the building",
  SUSPICIOUS_ACCURACY: "GPS accuracy looks artificial (possible fake location)",
  STALE_POSITION: "Used an old GPS position instead of a live one",
  DELAYED_UPLOAD: "Sent long after the check-in (saved offline)",
  IMPOSSIBLE_TRAVEL: "Too far from their previous check-in for the time between them",
  REUSED_PHOTO: "The same photo was used on another visit",
  BURST: "Unusually many check-ins in a short time",
};

export const MET_WITH = ["OWNER", "MANAGER", "STAFF", "NOBODY"] as const;
export type MetWith = (typeof MET_WITH)[number];

export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

export type VisitTimingError = "CAPTURED_IN_FUTURE" | "TOO_OLD";

/** Refuse capture times that cannot be honest; the server clock is the authority. */
export function visitTimingError(capturedAt: Date, receivedAt: Date): VisitTimingError | null {
  const gap = receivedAt.getTime() - capturedAt.getTime();
  if (gap < -MAX_CLOCK_AHEAD_MS) return "CAPTURED_IN_FUTURE";
  if (gap > MAX_OFFLINE_DELAY_MS) return "TOO_OLD";
  return null;
}

export type VisitEvidence = {
  position: { lat: number; lng: number };
  accuracyMeters: number;
  positionAt: Date | null;
  capturedAt: Date;
  receivedAt: Date;
  /** Where the property is: its own pin, or the lead's first check-in. */
  reference: { lat: number; lng: number } | null;
  /** The partner's previous check-in on any lead. */
  previousVisit: { lat: number; lng: number; capturedAt: Date } | null;
  /** The photo's hash already appears on another visit. */
  photoSeenBefore: boolean;
  /** The partner's check-ins in the burst window before this one. */
  recentVisitCount: number;
};

export function evaluateVisit(evidence: VisitEvidence): {
  flags: VisitFlag[];
  status: "VERIFIED" | "FLAGGED";
  distanceMeters: number | null;
} {
  const flags: VisitFlag[] = [];
  const accuracy = Math.max(0, evidence.accuracyMeters);

  const distanceMeters = evidence.reference ? haversineMeters(evidence.position, evidence.reference) : null;
  if (distanceMeters != null && distanceMeters - accuracy > VISIT_RULES.farFromPropertyMeters) flags.push("FAR_FROM_PROPERTY");

  if (accuracy > VISIT_RULES.lowAccuracyMeters) flags.push("LOW_ACCURACY");
  if (accuracy <= VISIT_RULES.suspiciousAccuracyMeters) flags.push("SUSPICIOUS_ACCURACY");

  if (evidence.positionAt && evidence.capturedAt.getTime() - evidence.positionAt.getTime() > VISIT_RULES.stalePositionMs) {
    flags.push("STALE_POSITION");
  }
  if (evidence.receivedAt.getTime() - evidence.capturedAt.getTime() > VISIT_RULES.delayedUploadMs) flags.push("DELAYED_UPLOAD");

  if (evidence.previousVisit) {
    const meters = haversineMeters(evidence.position, evidence.previousVisit);
    const hours = Math.max((evidence.capturedAt.getTime() - evidence.previousVisit.capturedAt.getTime()) / 3_600_000, 1 / 60);
    if (meters > VISIT_RULES.minTravelCheckMeters && meters / 1000 / hours > VISIT_RULES.maxTravelKmh) flags.push("IMPOSSIBLE_TRAVEL");
  }

  if (evidence.photoSeenBefore) flags.push("REUSED_PHOTO");
  if (evidence.recentVisitCount >= VISIT_RULES.burstCount) flags.push("BURST");

  return { flags, status: flags.length ? "FLAGGED" : "VERIFIED", distanceMeters };
}

/** Short line for the lead timeline, e.g. "Verified visit, 120 m from the property. Met the owner." */
export function visitActivityText(input: { status: string; distanceMeters: number | null; referenceSource: string; metWith: string; note?: string | null }): string {
  const where =
    input.referenceSource === "NONE" || input.distanceMeters == null
      ? "first check-in, sets the property location"
      : `${input.distanceMeters.toLocaleString("en-US")} m from ${input.referenceSource === "PROPERTY" ? "the property" : "the first check-in"}`;
  const met: Record<string, string> = { OWNER: "Met the owner.", MANAGER: "Met the manager.", STAFF: "Met staff.", NOBODY: "Met nobody." };
  const head = input.status === "VERIFIED" ? "Verified visit" : "Visit needs review";
  return `${head}, ${where}. ${met[input.metWith] ?? ""}${input.note ? ` ${input.note}` : ""}`.trim();
}

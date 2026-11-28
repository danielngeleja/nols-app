/**
 * Public, signed-out view of a venue's event hire.
 *
 * A venue is publicly hireable only when its event hire is APPROVED, the terms
 * are still exactly the approved ones (fingerprints match), and the space is
 * not the whole house (whole-house events share inventory with stays and are
 * not sold through this workflow yet). The same rule backs the signed-in
 * request form (GET /api/customer/event-requests/venues/approved).
 *
 * Only fields a client needs to decide are exposed: no owner details, no
 * consent or review data, no permit notes, no location (the property page
 * handles location under the private-home rule). Prices are what the client
 * pays: the owner price plus the client service fee. Multi-day hire is left
 * out on purpose: it is not sold through the request workflow yet.
 */
import { EVENT_MAX_PHOTOS, depositFor, eventMoney, listingPhotos, multiDayPrice, readExtraPhotos, sanitizeEventTerms, type EventTerms } from "./eventHire.js";

type Row = { status: string; terms: unknown; termsFingerprint: string; approvedFingerprint: string | null; extraPhotos?: unknown } | null | undefined;

export function isPubliclyHireable(row: Row): boolean {
  if (!row || row.status !== "APPROVED" || !row.approvedFingerprint || row.approvedFingerprint !== row.termsFingerprint) return false;
  return sanitizeEventTerms(row.terms).spaceType !== "WHOLE_HOUSE";
}

export type PublicEventPackage = { key: "HALF_DAY" | "FULL_DAY" | "EVENING"; clientPrice: number; deposit: number | null };
export type PublicEventHire = {
  spaceType: EventTerms["spaceType"];
  eventTypes: EventTerms["eventTypes"];
  description: string | null;
  capacitySeated: number | null;
  capacityStanding: number | null;
  earliestStart: string | null;
  latestEnd: string | null;
  noiseCutoff: string | null;
  packages: PublicEventPackage[];
  fromPrice: number | null;
  cleaningFee: number | null;
  allowed: EventTerms["allowed"];
  provided: EventTerms["provided"];
  photos: string[];
  currency: "TZS";
  /** Clients can send a date request right now (EVENT_HIRE_REQUESTS_ENABLED). */
  requestsOpen: boolean;
};

export function publicEventHireView(row: Row, listing: { photos: unknown; photoAreas: unknown }): PublicEventHire | null {
  if (!row || !isPubliclyHireable(row)) return null;
  const t = sanitizeEventTerms(row.terms);
  const packages: PublicEventPackage[] = [];
  for (const [key, price] of [["HALF_DAY", t.halfDayPrice], ["FULL_DAY", t.fullDayPrice], ["EVENING", t.eveningPrice]] as const) {
    if (price) packages.push({ key, clientPrice: eventMoney(price).clientPays, deposit: depositFor(t, price) });
  }
  const photos = [
    ...readExtraPhotos(row.extraPhotos),
    ...listingPhotos(listing.photos, listing.photoAreas).filter(p => p.area === "EVENT_SPACE").map(p => p.url),
  ].filter((url, i, all) => all.indexOf(url) === i).slice(0, EVENT_MAX_PHOTOS);
  return {
    spaceType: t.spaceType,
    eventTypes: t.eventTypes,
    description: t.description,
    capacitySeated: t.capacitySeated,
    capacityStanding: t.capacityStanding,
    earliestStart: t.earliestStart,
    latestEnd: t.latestEnd,
    noiseCutoff: t.noiseCutoff,
    packages,
    fromPrice: packages.length ? Math.min(...packages.map(p => p.clientPrice)) : null,
    cleaningFee: t.cleaningFee,
    allowed: t.allowed,
    provided: t.provided,
    photos,
    currency: "TZS",
    requestsOpen: process.env.EVENT_HIRE_REQUESTS_ENABLED === "true",
  };
}

/** Budget figures only. Multi-day reservations still require separate coordination. */
export function publicEventMultiDayEstimates(row: Row) {
  if (!row || !isPubliclyHireable(row)) return [];
  const terms = sanitizeEventTerms(row.terms);
  if (!terms.multiDay.enabled || terms.multiDay.maxDays == null) return [];

  return Array.from({ length: terms.multiDay.maxDays - 1 }, (_, index) => index + 2).flatMap(days => {
    const price = multiDayPrice(terms, days);
    return price ? [{
      days,
      clientPrice: eventMoney(price.total).clientPays,
      undiscountedClientPrice: eventMoney(price.gross).clientPays,
      deposit: depositFor(terms, price.total),
      discountPercent: price.percent,
    }] : [];
  });
}

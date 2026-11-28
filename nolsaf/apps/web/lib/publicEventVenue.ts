import { EVENT_TYPES } from "@/components/events/eventHireTypes";

const eventBrowsePath = "/public/properties";

export type EventVenueSort = "match" | "price" | "guests";
export type EventVenueFilters = {
  kind: string;
  guests: number;
  seating: "SEATED" | "STANDING";
  region: string;
};

export function parseEventGuestCount(value: string | null) {
  return Math.min(3000, Math.max(0, Math.trunc(Number(value) || 0)));
}

export function readEventVenueSearch(params: URLSearchParams): { filters: EventVenueFilters; sort: EventVenueSort } {
  const kind = params.get("eventOccasion");
  const sort = params.get("eventSort");
  return {
    filters: {
      kind: EVENT_TYPES.find(event => event.key === kind)?.key ?? "",
      guests: parseEventGuestCount(params.get("eventGuests")),
      seating: params.get("eventSeating") === "standing" ? "STANDING" : "SEATED",
      region: params.get("eventRegion") ?? "",
    },
    sort: sort === "price" || sort === "guests" ? sort : "match",
  };
}

export type PublicEventHire = {
  spaceType: string | null;
  eventTypes: string[];
  description: string | null;
  capacitySeated: number | null;
  capacityStanding: number | null;
  earliestStart: string | null;
  latestEnd: string | null;
  noiseCutoff: string | null;
  packages: Array<{ key: "HALF_DAY" | "FULL_DAY" | "EVENING"; clientPrice: number; deposit: number | null }>;
  fromPrice: number | null;
  cleaningFee: number | null;
  allowed: Record<string, boolean>;
  provided: { chairs: number | null; tables: number | null; parkingSpaces: number | null; toilets: number | null; powerBackup: boolean; water: boolean };
  photos: string[];
  currency: "TZS";
  requestsOpen: boolean;
};

export type PublicEventVenue = {
  slug: string;
  title: string;
  location: string;
  offer: PublicEventHire;
  multiDayEstimates?: EventVenueMultiDayEstimate[];
};

export type EventVenueMultiDayEstimate = {
  days: number;
  clientPrice: number;
  undiscountedClientPrice?: number;
  deposit: number | null;
  discountPercent: number;
};

export function eventVenueCheckoutTotal(clientPrice: number, cleaning: number, deposit: number | null) {
  return deposit == null ? null : clientPrice + cleaning + deposit;
}

export function eventVenueDetailHref(slug: string, resultsHref?: string) {
  const path = `/public/event-venues/${encodeURIComponent(slug)}`;
  return resultsHref ? `${path}?${new URLSearchParams({ returnTo: resultsHref })}` : path;
}

export function eventVenueBrowseContext(returnTo: string | string[] | undefined) {
  let params = typeof returnTo === "string" && returnTo.startsWith(`${eventBrowsePath}?`)
    ? new URLSearchParams(returnTo.slice(eventBrowsePath.length + 1))
    : new URLSearchParams();
  if (params.get("rental") !== "events") params = new URLSearchParams({ rental: "events" });
  return { href: `${eventBrowsePath}?${params}`, filters: readEventVenueSearch(params).filters };
}

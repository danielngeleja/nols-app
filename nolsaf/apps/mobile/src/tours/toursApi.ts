import { apiRequest, apiUploadFile } from "../lib/apiClient";
import {
  DiscoveryVehicle,
  CustomerTourBookingDetail,
  CustomerTourBookingsResponse,
  DiscoveryOperator,
  DiscoveryPackage,
  FeaturedTourOperator,
  FeaturedTourPackage,
  PublicTourAgent,
  PublicTourAgentsResponse,
  PublicTourPackageItem,
  PublicTourOperatorProfile,
  TourGroupMember,
  TourGroupMembersResponse,
  TourismSite,
  TourReceiptPayload,
  TourVoucherPayload
} from "./types";

export const DEFAULT_TOUR_CATEGORIES = [
  "Safari Tours",
  "Beach Holidays",
  "Cultural Tours",
  "Mountain Trekking",
  "City Tours",
  "Family Travel"
];

export type TourSortKey = "recommended" | "rating" | "price-asc" | "price-desc";

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isApprovedPackage(pkg: PublicTourPackageItem) {
  const status = String(pkg.status || "APPROVED").toUpperCase();
  return ["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"].includes(status);
}

function profilePhotos(profile: PublicTourOperatorProfile) {
  const classified = profile.classifiedPhotos || {};
  return [
    ...(classified.attractions || []),
    ...(classified.proof || []),
    ...(classified.office || []),
    ...(classified.vehicles || []),
    ...(profile.gallery || []),
    profile.companyLogoUrl
  ]
    .filter((item): item is string => Boolean(item))
    .filter((item, index, arr) => arr.indexOf(item) === index);
}

function profileServices(profile: PublicTourOperatorProfile) {
  return [
    ...(profile.services || []),
    ...(profile.addOns || []),
    ...(profile.tourismTypes || []),
    ...(profile.specializations || [])
  ]
    .map((item) => String(item || "").trim())
    .filter((item, index, arr) => Boolean(item) && arr.indexOf(item) === index);
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value.map((item) => {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          return String(obj.label || obj.name || obj.title || obj.value || obj.description || "").trim();
        }
        return String(item || "").trim();
      })
    : typeof value === "string"
      ? value.split(/[\n,;|]+/).map((item) => item.trim())
      : [];
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeFleet(value: unknown): DiscoveryVehicle[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const v = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const type = String(v.type || v.vehicleType || v.name || "").trim();
      if (!type) return null;
      const count = toFiniteNumber(v.count);
      const capacity = toFiniteNumber(v.capacity || v.seats || v.seatCount);
      return {
        type,
        ownership: String(v.ownership || "").trim() || null,
        count: count != null ? Math.max(1, Math.round(count)) : null,
        capacity: capacity != null ? Math.max(1, Math.round(capacity)) : null,
        condition: String(v.condition || "").trim() || null,
        serviceMode: String(v.serviceMode || v.mode || "").trim() || null
      };
    })
    .filter((item): item is DiscoveryVehicle => Boolean(item));
}

function packageTitle(pkg: PublicTourPackageItem) {
  return String(pkg.title || pkg.name || "Approved tour package").trim();
}

function packagePrice(pkg: PublicTourPackageItem, profile: PublicTourOperatorProfile, systemCommission: number) {
  const basePrice = toFiniteNumber(pkg.pricePerPerson || pkg.price);
  if (!basePrice || basePrice <= 0) return null;
  const commissionPercent = Math.max(0, toFiniteNumber(profile.commissionPercent) ?? systemCommission);
  return Math.round(basePrice * (1 + commissionPercent / 100));
}

function flattenFeaturedPackages(agent: PublicTourAgent, systemCommission: number): FeaturedTourPackage[] {
  const agentId = Number(agent.id);
  if (!Number.isFinite(agentId) || agentId <= 0) return [];

  const profile = agent.profile || {};
  const approvedPackages = (profile.packageItems || []).filter(isApprovedPackage);
  if (approvedPackages.length === 0) return [];

  const photos = profilePhotos(profile);
  const classified = profile.classifiedPhotos || {};
  const services = profileServices(profile);
  const operatorName = profile.companyName || "Approved Tour Operator";
  const location = profile.physicalLocation || profile.businessAddress || profile.operatingRegions?.[0] || "Location not set";
  const confidenceScore = toFiniteNumber(profile.tripConfidence?.score);
  const averageRating = toFiniteNumber(profile.tripConfidence?.averageRating);
  const totalRatings = Math.max(0, Math.round(toFiniteNumber(profile.tripConfidence?.totalRatings) ?? 0));

  return approvedPackages.map((pkg, index) => ({
    key: `${agentId}-${String(pkg.id ?? index)}-${packageTitle(pkg)}`,
    packageId: pkg.id,
    agentId,
    title: packageTitle(pkg),
    operatorName,
    destination: String(pkg.destination || location || "East Africa").trim(),
    category: String(pkg.category || "Tour package").trim(),
    currency: String(pkg.currency || "USD").toUpperCase(),
    pricePerPerson: packagePrice(pkg, profile, systemCommission),
    image: photos[index % Math.max(photos.length, 1)] || null,
    location,
    confidenceScore: confidenceScore && confidenceScore > 0 ? confidenceScore : null,
    averageRating: averageRating && averageRating > 0 ? averageRating : null,
    totalRatings,
    topFeeling: profile.tripConfidence?.topFeeling || null,
    services,
    packageCount: approvedPackages.length
  }));
}

function buildFeaturedOperator(agent: PublicTourAgent, systemCommission: number): FeaturedTourOperator | null {
  const agentId = Number(agent.id);
  if (!Number.isFinite(agentId) || agentId <= 0) return null;

  const profile = agent.profile || {};
  const approvedPackages = (profile.packageItems || []).filter(isApprovedPackage);
  if (approvedPackages.length === 0) return null;

  const photos = profilePhotos(profile);
  const services = profileServices(profile);
  const operatorName = profile.companyName || "Approved Tour Operator";
  const location = profile.physicalLocation || profile.businessAddress || profile.operatingRegions?.[0] || "Location not set";
  const confidenceScore = toFiniteNumber(profile.tripConfidence?.score);
  const averageRating = toFiniteNumber(profile.tripConfidence?.averageRating);
  const totalRatings = Math.max(0, Math.round(toFiniteNumber(profile.tripConfidence?.totalRatings) ?? 0));
  const pricedPackages = approvedPackages
    .map((pkg) => ({
      pkg,
      price: packagePrice(pkg, profile, systemCommission)
    }))
    .filter((entry): entry is { pkg: PublicTourPackageItem; price: number } => Boolean(entry.price && entry.price > 0))
    .sort((a, b) => a.price - b.price);
  const packageTitles = approvedPackages
    .map(packageTitle)
    .filter((title, index, arr) => Boolean(title) && arr.indexOf(title) === index)
    .slice(0, 3);
  const lowestPackage = pricedPackages[0]?.pkg || approvedPackages[0];

  return {
    key: `operator-${agentId}`,
    agentId,
    operatorName,
    location,
    currency: String(lowestPackage?.currency || "USD").toUpperCase(),
    lowestPricePerPerson: pricedPackages[0]?.price ?? null,
    image: photos[0] || null,
    images: photos,
    services,
    confidenceScore: confidenceScore && confidenceScore > 0 ? confidenceScore : null,
    averageRating: averageRating && averageRating > 0 ? averageRating : null,
    totalRatings,
    topFeeling: profile.tripConfidence?.topFeeling || null,
    packageCount: approvedPackages.length,
    packageTitles,
    completedTrips: Math.max(0, Math.round(toFiniteNumber(agent.totalCompletedTrips) ?? 0)),
    searchBag: [
      profile.companyName,
      profile.physicalLocation,
      profile.businessAddress,
      ...(profile.operatingRegions || []),
      ...(profile.services || []),
      ...(profile.addOns || []),
      ...(profile.tourismTypes || []),
      ...(profile.specializations || []),
      ...approvedPackages.flatMap((pkg) => [pkg.name, pkg.title, pkg.destination, pkg.category])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
  };
}

export async function fetchTourSystemCommission() {
  try {
    const settings = await apiRequest<{ agentCommissionPercent?: number; commissionPercent?: number }>("/api/public/support/system-settings");
    const loaded = toFiniteNumber(settings.agentCommissionPercent ?? settings.commissionPercent);
    return loaded && loaded >= 0 ? loaded : 15;
  } catch {
    return 15;
  }
}

export async function fetchFeaturedTourPackages(limit = 10) {
  const query = new URLSearchParams({
    page: "1",
    pageSize: "50"
  });
  const [response, systemCommission] = await Promise.all([
    apiRequest<PublicTourAgentsResponse>(`/api/public/agents?${query.toString()}`),
    fetchTourSystemCommission()
  ]);

  return (response.items || [])
    .flatMap((agent) => flattenFeaturedPackages(agent, systemCommission))
    .sort((a, b) => {
      const confidenceDelta = Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return Number(b.pricePerPerson || 0) - Number(a.pricePerPerson || 0);
    })
    .slice(0, limit);
}

function packageDestination(pkg: PublicTourPackageItem, fallback: string) {
  return String(pkg.destination || fallback || "East Africa").trim();
}

type RawEvent = { start: string; end: string; activity: string; vibe: string };

/** Parse a day's fallback `timeline` (a string of lines, or an array of entries)
 *  into timetable events, mirroring the web normalizer. */
function parseTimelineToEvents(input: unknown): RawEvent[] {
  const parseLine = (line: string): RawEvent | null => {
    const t = String(line || "").trim();
    if (!t) return null;
    const range = t.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*-\s*(.+)$/);
    if (range) return { start: range[1], end: range[2], activity: range[3].trim(), vibe: "" };
    const start = t.match(/^(\d{1,2}:\d{2})\s*-\s*(.+)$/);
    if (start) return { start: start[1], end: "", activity: start[2].trim(), vibe: "" };
    return { start: "", end: "", activity: t, vibe: "" };
  };

  if (Array.isArray(input)) {
    return input
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const e = entry as Record<string, unknown>;
          const rawTime = String(e.time || "").trim();
          const parts = rawTime.split(/\s*-\s*/).map((x) => x.trim()).filter(Boolean);
          const start = String(e.startTime || parts[0] || "").trim();
          const end = String(e.endTime || parts[1] || "").trim();
          const activity = String(e.label || "").trim() || String(e.activity || "").trim() || String(e.description || "").trim();
          const vibe = String(e.difficulty || e.vibe || "").trim();
          if (!start && !end && !activity) return null;
          return { start, end, activity, vibe };
        }
        return parseLine(String(entry || ""));
      })
      .filter((x): x is RawEvent => !!x && (!!x.activity || !!x.start || !!x.end));
  }

  return String(input || "")
    .split(/\n+/)
    .map(parseLine)
    .filter((x): x is RawEvent => !!x && (!!x.activity || !!x.start || !!x.end));
}

/** Build the full discovery view of one operator, with its approved packages and the
 *  lowercased search bag the discovery filters match against. */
function buildDiscoveryOperator(agent: PublicTourAgent, systemCommission: number): DiscoveryOperator | null {
  const agentId = Number(agent.id);
  if (!Number.isFinite(agentId) || agentId <= 0) return null;

  const profile = agent.profile || {};
  const approved = (profile.packageItems || []).filter(isApprovedPackage);
  if (approved.length === 0) return null;

  const classified = profile.classifiedPhotos || {};
  const photos = profilePhotos(profile);
  const services = profileServices(profile);
  const operatorName = profile.companyName || "Approved Tour Operator";
  const location = profile.physicalLocation || profile.businessAddress || profile.operatingRegions?.[0] || "Location not set";
  const confidenceScore = toFiniteNumber(profile.tripConfidence?.score);
  const averageRating = toFiniteNumber(profile.tripConfidence?.averageRating);
  const totalRatings = Math.max(0, Math.round(toFiniteNumber(profile.tripConfidence?.totalRatings) ?? 0));

  const packages: DiscoveryPackage[] = approved.map((pkg, index) => {
    const durationRaw = pkg.duration != null ? String(pkg.duration).trim() : "";
    const duration = durationRaw ? (/^\d+$/.test(durationRaw) ? `${durationRaw} days` : durationRaw) : null;
    const minPax = pkg.minPax != null ? String(pkg.minPax).trim() : "";
    const maxPax = pkg.maxPax != null ? String(pkg.maxPax).trim() : "";
    const groupSize =
      minPax && maxPax ? `${minPax} to ${maxPax} guests` : minPax ? `Min ${minPax} guests` : maxPax ? `Max ${maxPax} guests` : null;
    const itinerary = (pkg.itinerary || [])
      .map((d, i) => ({
        day: Number(d.day ?? i + 1) || i + 1,
        title: String(d.title || "").trim(),
        description: String(d.description || "").trim(),
        events: (() => {
          const mapped = (d.events || [])
            .map((e) => ({
              start: String(e.startTime || "").trim(),
              end: String(e.endTime || "").trim(),
              activity: String(e.activity || "").trim(),
              vibe: String(e.difficulty || "").trim()
            }))
            .filter((e) => e.activity || e.start || e.end);
          return mapped.length ? mapped : parseTimelineToEvents(d.timeline);
        })()
      }))
      .filter((d) => d.title || d.description || d.events.length);

    return {
      id: pkg.id ?? null,
      title: packageTitle(pkg),
      destination: packageDestination(pkg, location),
      category: String(pkg.category || "Tour package").trim(),
      currency: String(pkg.currency || "USD").toUpperCase(),
      pricePerPerson: packagePrice(pkg, profile, systemCommission),
      image: photos[index % Math.max(photos.length, 1)] || null,
      description: pkg.description?.trim() ? pkg.description.trim() : null,
      notes: pkg.notes?.trim() ? pkg.notes.trim() : null,
      difficulty: pkg.difficulty?.trim() ? pkg.difficulty.trim() : null,
      duration,
      mode: pkg.mode?.trim() ? pkg.mode.trim() : null,
      groupSize,
      minPax: toFiniteNumber(pkg.minPax),
      maxPax: toFiniteNumber(pkg.maxPax),
      accommodation: pkg.accommodation?.trim() ? pkg.accommodation.trim() : null,
      mealPlan: pkg.mealPlan?.trim() ? pkg.mealPlan.trim() : null,
      meetingPoint: stringList((pkg as any).meetingPoints || (pkg as any).meetingPoint || (pkg as any).departurePoints || (pkg as any).departurePoint || (pkg as any).pickupPoints || (pkg as any).pickupPoint)[0] || null,
      included: stringList((pkg as any).included || (pkg as any).inclusions || (pkg as any).includes || (pkg as any).includedItems || (pkg as any).includedInPackage),
      excluded: stringList((pkg as any).excluded || (pkg as any).exclusions || (pkg as any).excludes || (pkg as any).notIncluded || (pkg as any).excludedItems || (pkg as any).excludedFromPackage),
      itinerary
    };
  });

  const prices = packages.map((p) => p.pricePerPerson).filter((p): p is number => Boolean(p && p > 0));
  const lowestPricePerPerson = prices.length ? Math.min(...prices) : null;

  const searchBag = [
    profile.companyName,
    profile.physicalLocation,
    profile.businessAddress,
    ...(profile.operatingRegions || []),
    ...(profile.services || []),
    ...(profile.addOns || []),
    ...(profile.tourismTypes || []),
    ...(profile.specializations || []),
    ...packages.flatMap((pkg) => [pkg.title, pkg.destination, pkg.category])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const yearsInOperation = toFiniteNumber(profile.yearsInOperation);
  const teamSize = toFiniteNumber(profile.teamSize);

  return {
    agentId,
    operatorName,
    description: profile.description?.trim() ? profile.description.trim() : null,
    location,
    image: photos[0] || null,
    images: photos,
    logoUrl: profile.companyLogoUrl || null,
    services,
    tourismTypes: (profile.tourismTypes || []).map((t) => String(t || "").trim()).filter(Boolean),
    confidenceScore: confidenceScore && confidenceScore > 0 ? confidenceScore : null,
    averageRating: averageRating && averageRating > 0 ? averageRating : null,
    totalRatings,
    topFeeling: profile.tripConfidence?.topFeeling || null,
    completedTrips: Math.max(0, Math.round(toFiniteNumber(agent.totalCompletedTrips) ?? 0)),
    currency: String(packages[0]?.currency || "USD").toUpperCase(),
    lowestPricePerPerson,
    packageCount: packages.length,
    packages,
    contactPhone: profile.contactPhone || null,
    contactEmail: profile.contactEmail || null,
    operatingRegions: (profile.operatingRegions || []).filter(Boolean),
    registeredParks: stringList(profile.registeredParks),
    vehiclePhotos: stringList(classified.vehicles),
    fleet: normalizeFleet(profile.vehicles),
    tools: stringList(profile.toolsAndAssets || profile.tools),
    specializations: stringList(profile.specializations),
    yearsInOperation: yearsInOperation != null && yearsInOperation >= 0 ? yearsInOperation : null,
    teamSize: teamSize != null && teamSize >= 0 ? teamSize : null,
    languages: profile.languages?.trim() ? profile.languages.trim() : null,
    vehicleCount: Array.isArray(profile.vehicles) ? profile.vehicles.length : 0,
    toolCount: Array.isArray(profile.tools) ? profile.tools.length : 0,
    searchBag
  };
}

/** The categories used by the discovery filter. Falls back to the static list. */
export async function fetchTourCategories(): Promise<string[]> {
  try {
    const res = await apiRequest<{ items?: Array<{ name?: string } | string> }>("/api/public/agents/categories");
    const items = (res.items || [])
      .map((item) => (typeof item === "string" ? item : item?.name))
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    if (items.length === 0) return DEFAULT_TOUR_CATEGORIES;
    return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
  } catch {
    return DEFAULT_TOUR_CATEGORIES;
  }
}

/** The parks and tourism sites used by the discovery filter. */
export async function fetchTourismSites(): Promise<TourismSite[]> {
  try {
    const res = await apiRequest<{ items?: TourismSite[] }>("/api/public/tourism-sites?country=all");
    return (res.items || []).filter((item) => item?.name);
  } catch {
    return [];
  }
}

/** The full discovery list of approved operators, sorted recommended first. */
export async function fetchTourOperators(): Promise<DiscoveryOperator[]> {
  const query = new URLSearchParams({ page: "1", pageSize: "50" });
  const [response, systemCommission] = await Promise.all([
    apiRequest<PublicTourAgentsResponse>(`/api/public/agents?${query.toString()}`),
    fetchTourSystemCommission()
  ]);
  return (response.items || [])
    .map((agent) => buildDiscoveryOperator(agent, systemCommission))
    .filter((item): item is DiscoveryOperator => Boolean(item))
    .sort((a, b) => b.completedTrips - a.completedTrips);
}

/** One operator profile with its approved packages, for the operator screen. */
export async function fetchTourOperator(agentId: number): Promise<DiscoveryOperator | null> {
  const [agent, systemCommission] = await Promise.all([
    apiRequest<PublicTourAgent>(`/api/public/agents/${agentId}`),
    fetchTourSystemCommission()
  ]);
  return buildDiscoveryOperator(agent, systemCommission);
}

/** Apply the discovery search, category, site, and sort, all on the client. */
export function applyTourFilters(
  operators: DiscoveryOperator[],
  opts: { search?: string; category?: string; site?: string; sort?: TourSortKey }
): DiscoveryOperator[] {
  const q = (opts.search || "").trim().toLowerCase();
  const category = opts.category && opts.category !== "All" ? opts.category.toLowerCase() : "";
  const site = opts.site && opts.site !== "All" ? opts.site.toLowerCase() : "";
  const sort = opts.sort || "recommended";

  const filtered = operators.filter((op) => {
    if (q && !op.searchBag.includes(q)) return false;
    if (category && !op.searchBag.includes(category)) return false;
    if (site && !op.searchBag.includes(site)) return false;
    return true;
  });

  const lowest = (op: DiscoveryOperator) => op.lowestPricePerPerson ?? Number.POSITIVE_INFINITY;
  return [...filtered].sort((a, b) => {
    if (sort === "price-asc") return lowest(a) - lowest(b);
    if (sort === "price-desc") return lowest(b) - lowest(a);
    if (sort === "rating") {
      const delta = Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
      if (delta !== 0) return delta;
      return b.completedTrips - a.completedTrips;
    }
    return b.completedTrips - a.completedTrips;
  });
}

export async function fetchFeaturedTourOperators(limit = 10) {
  const query = new URLSearchParams({
    page: "1",
    pageSize: "50"
  });
  const [response, systemCommission] = await Promise.all([
    apiRequest<PublicTourAgentsResponse>(`/api/public/agents?${query.toString()}`),
    fetchTourSystemCommission()
  ]);

  return (response.items || [])
    .map((agent) => buildFeaturedOperator(agent, systemCommission))
    .filter((item): item is FeaturedTourOperator => Boolean(item))
    .sort((a, b) => {
      const completedTripsDelta = b.completedTrips - a.completedTrips;
      if (completedTripsDelta !== 0) return completedTripsDelta;
      const confidenceDelta = Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return b.packageCount - a.packageCount;
    })
    .slice(0, limit);
}

/** The full discovery list rendered as the home page featured operator cards. */
export async function fetchAllFeaturedTourOperators(): Promise<FeaturedTourOperator[]> {
  const query = new URLSearchParams({ page: "1", pageSize: "50" });
  const [response, systemCommission] = await Promise.all([
    apiRequest<PublicTourAgentsResponse>(`/api/public/agents?${query.toString()}`),
    fetchTourSystemCommission()
  ]);
  return (response.items || [])
    .map((agent) => buildFeaturedOperator(agent, systemCommission))
    .filter((item): item is FeaturedTourOperator => Boolean(item))
    .sort((a, b) => b.completedTrips - a.completedTrips);
}

/** Apply the discovery search, category, site, and sort to featured operators. */
export function applyFeaturedTourFilters(
  operators: FeaturedTourOperator[],
  opts: { search?: string; category?: string; site?: string; sort?: TourSortKey }
): FeaturedTourOperator[] {
  const q = (opts.search || "").trim().toLowerCase();
  const category = opts.category && opts.category !== "All" ? opts.category.toLowerCase() : "";
  const site = opts.site && opts.site !== "All" ? opts.site.toLowerCase() : "";
  const sort = opts.sort || "recommended";

  const filtered = operators.filter((op) => {
    if (q && !op.searchBag.includes(q)) return false;
    if (category && !op.searchBag.includes(category)) return false;
    if (site && !op.searchBag.includes(site)) return false;
    return true;
  });

  const lowest = (op: FeaturedTourOperator) => op.lowestPricePerPerson ?? Number.POSITIVE_INFINITY;
  return [...filtered].sort((a, b) => {
    if (sort === "price-asc") return lowest(a) - lowest(b);
    if (sort === "price-desc") return lowest(b) - lowest(a);
    if (sort === "rating") {
      const delta = Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0);
      if (delta !== 0) return delta;
      return b.completedTrips - a.completedTrips;
    }
    return b.completedTrips - a.completedTrips;
  });
}

export type CreateTourBookingInput = {
  operatorAgentId: number;
  packageId: string | number;
  travelerCount: number;
  startDate: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string;
  nationality: string;
  notes?: string;
  metadata?: Record<string, unknown>;
};

export type CreateTourBookingResult = {
  booking?: { id?: number | string; code?: string | null };
  accessToken?: string;
  bookingId?: number | string;
  tourBookingId?: number | string;
};

export async function createTourBooking(token: string | null, input: CreateTourBookingInput) {
  return apiRequest<CreateTourBookingResult>("/api/public/tour-bookings", {
    method: "POST",
    token,
    body: input
  });
}

export type TourPaymentBooking = {
  id: number;
  bookingCode?: string | null;
  title?: string | null;
  destination?: string | null;
  category?: string | null;
  startDate?: string | null;
  travelerCount?: number | null;
  status?: string | null;
  paymentStatus?: string | null;
  currency?: string | null;
  grossAmount?: number | null;
  unitPrice?: number | null;
  commissionPercent?: number | null;
  commissionAmount?: number | null;
  guestName?: string | null;
  guestPhone?: string | null;
  payerPhone?: string | null;
  paidAt?: string | null;
  operatorSnapshot?: { companyName?: string | null } | null;
};

export type TourPaymentStatusResult = {
  ok?: boolean;
  booking: TourPaymentBooking;
};

export type TourPaymentInitiateResult = {
  ok?: boolean;
  transactionId?: string | null;
  paymentRef?: string | null;
  status?: string | null;
  checkoutUrl?: string | null;
};

export async function fetchTourPaymentStatus(bookingId: number, accessToken: string) {
  const query = new URLSearchParams({ accessToken });
  return apiRequest<TourPaymentStatusResult>(`/api/public/tour-bookings/${bookingId}/payment-status?${query.toString()}`);
}

export async function initiateTourMnoPayment(params: {
  bookingId: number;
  accessToken: string;
  phoneNumber: string;
  provider: "Airtel" | "Mixx" | "MPESA" | "Halopesa";
}) {
  return apiRequest<TourPaymentInitiateResult>(`/api/public/tour-bookings/${params.bookingId}/initiate-payment`, {
    method: "POST",
    body: {
      accessToken: params.accessToken,
      phoneNumber: params.phoneNumber,
      provider: params.provider
    }
  });
}

export async function initiateTourBankPayment(params: {
  bookingId: number;
  accessToken: string;
  bankCode: string;
  accountNumber: string;
  merchantMobileNumber: string;
  otp: string;
}) {
  return apiRequest<TourPaymentInitiateResult>(`/api/public/tour-bookings/${params.bookingId}/initiate-bank-payment`, {
    method: "POST",
    body: {
      accessToken: params.accessToken,
      bankCode: params.bankCode,
      accountNumber: params.accountNumber,
      merchantMobileNumber: params.merchantMobileNumber,
      otp: params.otp
    }
  });
}

export async function initiateTourCardPayment(params: { bookingId: number; accessToken: string }) {
  return apiRequest<TourPaymentInitiateResult>(`/api/public/tour-bookings/${params.bookingId}/initiate-card-payment`, {
    method: "POST",
    body: { accessToken: params.accessToken }
  });
}

export async function fetchCustomerTourBookings(token: string, params: { page?: number; pageSize?: number; bucket?: string } = {}) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    pageSize: String(params.pageSize ?? 20)
  });
  if (params.bucket && params.bucket !== "ALL") query.set("bucket", params.bucket);
  return apiRequest<CustomerTourBookingsResponse>(`/api/customer/tour-bookings?${query.toString()}`, { token });
}

export async function fetchCustomerTourBooking(token: string, id: number) {
  return apiRequest<CustomerTourBookingDetail>(`/api/customer/tour-bookings/${id}`, { token });
}

export async function fetchCustomerTourVoucher(token: string, id: number) {
  return apiRequest<TourVoucherPayload>(`/api/customer/tour-bookings/${id}/voucher`, { token });
}

export async function fetchCustomerTourReceipt(token: string, id: number) {
  return apiRequest<TourReceiptPayload>(`/api/customer/tour-bookings/${id}/receipt`, { token });
}

export async function uploadTravellerDocumentFile(
  token: string,
  file: { uri: string; name: string; type?: string | null; file?: Blob | File | null }
) {
  return apiUploadFile<{ secure_url?: string; url?: string }>("/api/uploads/cloudinary/upload", {
    token,
    file,
    fields: { folder: "uploads" }
  });
}

export async function saveTravellerDocument(
  token: string,
  input: { type: string; url: string; metadata?: Record<string, unknown> }
) {
  return apiRequest<{ doc?: Record<string, unknown>; type?: string; url?: string; status?: string }>("/api/account/documents", {
    method: "PUT",
    token,
    body: input
  });
}

export async function saveTourBookingDocument(
  token: string,
  bookingId: number,
  input: { type: string; label: string; url: string; fileName?: string | null }
) {
  return apiRequest<{ ok?: boolean; document?: Record<string, unknown> }>(`/api/customer/tour-bookings/${bookingId}/documents`, {
    method: "PUT",
    token,
    body: input
  });
}

export async function startTourPickupCheckIn(token: string, id: number) {
  return apiRequest<{ ok?: boolean; message?: string; bookingCodeSuffix?: string; pickupCheckIn?: Record<string, unknown> }>(
    `/api/customer/tour-bookings/${id}/start-pickup-checkin`,
    { method: "POST", token, body: {} }
  );
}

export async function validateTourPickup(token: string, id: number, codeSuffix?: string | null) {
  return apiRequest<{
    ok?: boolean;
    message?: string;
    bookingCodeSuffix?: string;
    pickupValidation?: Record<string, unknown> | null;
    pickupValidationCustomer?: Record<string, unknown> | null;
    pickupTimeline?: Record<string, unknown>;
  }>(
    `/api/customer/tour-bookings/${id}/validate-pickup`,
    {
      method: "POST",
      token,
      body: {
        policyAgreed: true,
        codeSuffix: codeSuffix || undefined
      }
    }
  );
}

export async function createTourTimelineInvite(token: string, id: number) {
  return apiRequest<{ ok?: boolean; reused?: boolean; inviteUrl?: string | null; invitePath?: string | null; invite?: Record<string, unknown> }>(
    `/api/customer/tour-bookings/${id}/timeline-invite`,
    { method: "POST", token, body: {} }
  );
}

export async function submitTourChangeRequest(
  token: string,
  id: number,
  input: { title: string; message: string; changeType?: string }
) {
  return apiRequest<{ ok?: boolean; request?: Record<string, unknown> }>(`/api/customer/tour-bookings/${id}/request-change`, {
    method: "POST",
    token,
    body: {
      title: input.title,
      message: input.message,
      changeType: input.changeType || "GENERAL"
    }
  });
}

export async function submitTourIssueReport(
  token: string,
  id: number,
  input: { title: string; message: string; issueType?: string; severity?: "LOW" | "MEDIUM" | "HIGH" }
) {
  return apiRequest<{ ok?: boolean; issue?: Record<string, unknown> }>(`/api/customer/tour-bookings/${id}/report-issue`, {
    method: "POST",
    token,
    body: {
      title: input.title,
      message: input.message,
      issueType: input.issueType || "GENERAL",
      severity: input.severity || "MEDIUM"
    }
  });
}

export async function fetchTourGroupMembers(token: string, id: number) {
  return apiRequest<TourGroupMembersResponse>(`/api/customer/tour-bookings/${id}/group-members`, {
    method: "GET",
    token
  });
}

export type TourGroupMemberInput = {
  fullName: string;
  documentType?: string;
  documentNumber?: string;
  nationality?: string;
  phone?: string;
  relation?: string;
  notes?: string;
  photoUrl?: string;
  documentUrl?: string;
  documentFileName?: string;
};

export async function addTourGroupMember(token: string, id: number, input: TourGroupMemberInput) {
  return apiRequest<{ ok?: boolean; member?: TourGroupMember; members?: TourGroupMember[] }>(
    `/api/customer/tour-bookings/${id}/group-members`,
    {
      method: "POST",
      token,
      body: input
    }
  );
}

export async function updateTourGroupMember(token: string, id: number, memberId: string, input: TourGroupMemberInput) {
  return apiRequest<{ ok?: boolean; member?: TourGroupMember; members?: TourGroupMember[] }>(
    `/api/customer/tour-bookings/${id}/group-members/${encodeURIComponent(memberId)}`,
    {
      method: "PATCH",
      token,
      body: input
    }
  );
}

export async function deleteTourGroupMember(token: string, id: number, memberId: string) {
  return apiRequest<{ ok?: boolean; members?: TourGroupMember[] }>(
    `/api/customer/tour-bookings/${id}/group-members/${encodeURIComponent(memberId)}`,
    {
      method: "DELETE",
      token
    }
  );
}

export async function uploadTourGroupMemberFile(
  token: string,
  file: { uri: string; name: string; type?: string | null; file?: Blob | File | null }
) {
  return apiUploadFile<{ secure_url?: string; url?: string }>("/api/uploads/cloudinary/upload", {
    token,
    file,
    fields: { folder: "uploads" }
  });
}

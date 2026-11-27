/**
 * Agency Desk quote and pay request, step 1 (docs/SALES_AGENCY_QUOTES_STRATEGY.md).
 *
 *  - searchByNeed: a client's need (people, features, whole place, area, dates,
 *    budget) -> approved listings ready to quote, close matches, and the
 *    partner's OWN matching leads. Day use, or nothing ready, saves a demand
 *    signal (no client contact details).
 *  - quoteOption / createQuote: 1 to 3 options priced by lib/stayPrice.ts (the
 *    same calculation the booking route charges) on live availability.
 *  - The client pays through the normal public booking route with the quote
 *    token; checkQuoteForBooking / attachQuoteBooking tie that booking to the
 *    quote and credit the partner (channel AGENCY_QUOTE).
 *
 * Rules: the partner never sets a price, never sees another partner's leads,
 * and a quote holds no room (availability is re-checked when the client pays).
 */
import crypto from "node:crypto";
import { calculateAvailability } from "./availabilityCalculator.js";
import { accommodationTotals, effectiveCommissionPercent, nightlyNetFor } from "./stayPrice.js";
import { effectiveRoomSelectionCode, roomTypeNameFor, roomsSpecEntries } from "./roomSelectionCode.js";
import { leadRef, propertyRef, resolveAmong } from "./salesReference.js";
import { loadPartnerIdentity, partnerBookedStayReason, partnerOwnsPropertyReason, phoneKey } from "./salesSelfDealing.js";
import { agencyGateFailure, isAgencyDeskEnabled, loadAgencyGateInput } from "./salesAgency.js";
import { buildPropertySlug, toPublicCard } from "./publicPropertyDto.js";

// ---------------------------------------------------------------------------
// Limits (docs section 8 and 13; defaults chosen 2026-11-27)
// ---------------------------------------------------------------------------

export const QUOTE_DEFAULT_HOURS = 24;
export const QUOTE_MAX_HOURS = 72;
export const QUOTE_MAX_OPTIONS = 3;
export const QUOTE_MAX_OPEN_PER_PARTNER = 30;
export const QUOTE_MAX_PER_PHONE_PER_DAY = 3;
export const SEARCH_MAX_CANDIDATES = 25;
/** The public booking route accepts at most this many rooms and adults in one booking. */
export const BOOKING_MAX_ROOMS = 20;
export const BOOKING_MAX_ADULTS = 100;

/** What a client can ask for, and how a listing proves it. */
export const NEED_FEATURES = {
  eventSpace: "Event hall or open space",
  parking: "Parking",
  kitchen: "Kitchen",
  pool: "Pool",
  wifi: "Wi-Fi",
  generator: "Backup power",
  garden: "Garden or outdoor space",
  breakfast: "Breakfast",
} as const;
export type NeedFeature = keyof typeof NEED_FEATURES;

export class QuoteError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PAID_BOOKING_STATUSES = ["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN", "CHECKED_OUT"];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function parseJson(value: unknown): any {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

/** YYYY-MM-DD -> local midnight, exactly as the booking route parses it (parseBookingDate). */
export function dayOf(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!m) throw new QuoteError("Use dates as YYYY-MM-DD.");
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3])) throw new QuoteError("That date does not exist.");
  return d;
}

/** The calendar day of a stored date, read the same way it was made (local). */
export function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);
}

/** Today's calendar day in EAT, as a local-midnight date comparable with dayOf(). */
function todayEat(now = new Date()): Date {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return new Date(eat.getUTCFullYear(), eat.getUTCMonth(), eat.getUTCDate());
}

/** Does a listing offer this feature? Read from the owner's own answers. */
export function hasFeature(services: unknown, feature: NeedFeature): boolean {
  const s = parseJson(services) || {};
  const text = JSON.stringify(s).toLowerCase();
  switch (feature) {
    case "eventSpace": return s.socialHall === true || /event hall|conference|open space|social hall/.test(text);
    case "parking": return Boolean(s.parking) && !["no", "none", "false"].includes(String(s.parking).toLowerCase());
    case "kitchen": return /kitchen|cooking allowed/.test(text);
    case "pool": return s.pool === true || /swimming pool|\bpool\b/.test(text);
    case "wifi": return s.wifi === true || /wi-?fi|internet/.test(text);
    case "generator": return /generator|backup power|solar/.test(text);
    case "garden": return /garden|outdoor|lawn|terrace/.test(text);
    case "breakfast": return s.breakfastIncluded === true || s.breakfastAvailable === true || /breakfast/.test(text);
  }
}

// ---------------------------------------------------------------------------
// Pricing one selection, the way the booking route will charge it
// ---------------------------------------------------------------------------

export type PricedSelection = {
  roomCode: string | null;
  roomLabel: string;
  rooms: number;
  perRoomGuests: number;
  sellableRooms: number;
  nights: number;
  nightlyNet: number;
  commissionPercent: number;
  total: number;
  currency: string;
  overCapacity: boolean;
};

async function priceSelection(property: any, entry: any | null, roomCode: string | null, rooms: number, guests: number, checkIn: Date, checkOut: Date, commissionPercent: number, sellableRooms: number): Promise<PricedSelection> {
  const nights = nightsBetween(checkIn, checkOut);
  const { pricePerNight, room } = nightlyNetFor({ basePrice: property.basePrice, roomsSpec: property.roomsSpec, roomCode });
  const totals = accommodationTotals({ pricePerNight, room, roomsQty: rooms, guestCount: guests, nights, commissionPercent });
  return {
    roomCode,
    roomLabel: entry ? roomTypeNameFor(entry) || "Room" : "Whole place",
    rooms,
    perRoomGuests: Math.max(1, Number((entry as any)?.maxGuestsPerUnit) || 2),
    sellableRooms,
    nights,
    nightlyNet: pricePerNight,
    commissionPercent,
    total: Math.round(totals.accommodationGross),
    currency: String(property.currency || "TZS"),
    overCapacity: totals.overCapacity,
  };
}

/**
 * The cheapest way this listing can take `people` on these dates (one room type,
 * enough rooms), or the largest group it could take when it cannot.
 */
async function bestSelection(property: any, people: number, checkIn: Date, checkOut: Date, wholePlace: boolean) {
  const commissionPercent = await effectiveCommissionPercent(property.services);
  const entries = roomsSpecEntries(parseJson(property.roomsSpec));
  let best: PricedSelection | null = null;
  let maxCover = 0;
  for (const entry of entries) {
    const mode = String((entry as any)?.bookingMode || "").toUpperCase();
    if (wholePlace && mode && mode !== "ENTIRE_UNIT") continue;
    const code = effectiveRoomSelectionCode(entry);
    let sellable = 0;
    try {
      const availability = await calculateAvailability(property.id, checkIn, checkOut, code);
      sellable = Math.max(0, Number(availability.summary.totalSellableRooms) || 0);
    } catch {
      sellable = 0;
    }
    const perRoom = Math.max(1, Number((entry as any)?.maxGuestsPerUnit) || 2);
    maxCover = Math.max(maxCover, sellable * perRoom);
    const roomsNeeded = Math.ceil(people / perRoom);
    if (sellable < 1 || roomsNeeded > sellable || roomsNeeded > BOOKING_MAX_ROOMS) continue;
    const priced = await priceSelection(property, entry, code, roomsNeeded, people, checkIn, checkOut, commissionPercent, sellable);
    if (priced.overCapacity) continue;
    if (!best || priced.total < best.total) best = priced;
  }
  return { best, maxCover };
}

// ---------------------------------------------------------------------------
// Search by need
// ---------------------------------------------------------------------------

export type NeedInput = {
  people: number;
  checkIn?: string | null;
  checkOut?: string | null;
  dayUse?: boolean;
  wholePlace?: boolean;
  features?: NeedFeature[];
  area?: string | null;
  budgetTzs?: number | null;
};

function listingCard(property: any) {
  const card = toPublicCard(property);
  return {
    ref: propertyRef(property.id),
    title: property.title,
    slug: buildPropertySlug(String(property.title || ""), String(property.nrmsBookingKey || "")),
    type: property.type,
    location: card.location,
    photo: card.primaryImage,
    maxGuests: property.maxGuests ?? null,
  };
}

export async function searchByNeed(db: any, salesPartnerId: number, need: NeedInput, now = new Date()) {
  const people = Math.round(Number(need.people));
  if (!Number.isFinite(people) || people < 1 || people > 500) throw new QuoteError("Enter how many people, 1 to 500.");
  const features = (need.features ?? []).filter((f): f is NeedFeature => f in NEED_FEATURES);
  const area = String(need.area || "").trim().slice(0, 120);
  const budget = need.budgetTzs && Number(need.budgetTzs) > 0 ? Math.round(Number(need.budgetTzs)) : null;

  // Day use (a one-day event) is not a nightly stay: record the demand only.
  if (need.dayUse) {
    await recordDemand(db, salesPartnerId, { people, area, features, wholePlace: Boolean(need.wholePlace), dayUse: true, budget, checkIn: null, checkOut: null, matches: 0 });
    return { dayUse: true as const, ready: [], close: [], leads: [], demandRecorded: true };
  }

  if (!need.checkIn || !need.checkOut) throw new QuoteError("Choose the check-in and check-out dates.");
  const checkIn = dayOf(need.checkIn);
  const checkOut = dayOf(need.checkOut);
  if (checkOut <= checkIn) throw new QuoteError("Check-out must be after check-in.");
  if (checkIn < todayEat(now)) throw new QuoteError("Check-in cannot be in the past.");
  if (nightsBetween(checkIn, checkOut) > 60) throw new QuoteError("Quotes cover up to 60 nights.");

  const where: any = { status: "APPROVED", rentalMode: "NIGHTLY" };
  if (area) {
    where.OR = ["regionName", "district", "ward", "city", "street", "title"].map((field) => ({ [field]: { contains: area } }));
  }
  const candidates = await db.property.findMany({
    where,
    orderBy: { id: "desc" },
    take: 120,
    select: {
      id: true, title: true, type: true, nrmsBookingKey: true, regionName: true, district: true, ward: true, city: true, country: true,
      basePrice: true, currency: true, roomsSpec: true, services: true, maxGuests: true, totalBedrooms: true, totalBathrooms: true,
      images: { select: { url: true, thumbnailUrl: true, status: true }, orderBy: { createdAt: "asc" }, take: 3 },
    },
  });

  const featureFit = candidates
    .map((p: any) => ({ p, missing: features.filter((f) => !hasFeature(p.services, f)) }))
    .filter((c: any) => c.missing.length <= 1)
    .sort((a: any, b: any) => a.missing.length - b.missing.length)
    .slice(0, SEARCH_MAX_CANDIDATES);

  const ready: any[] = [];
  const close: any[] = [];
  for (const { p, missing } of featureFit) {
    const { best, maxCover } = await bestSelection(p, people, checkIn, checkOut, Boolean(need.wholePlace));
    const reasons: string[] = missing.map((f: NeedFeature) => `No ${NEED_FEATURES[f].toLowerCase()} listed`);
    if (!best) {
      if (maxCover >= Math.ceil(people * 0.6)) reasons.unshift(`Sleeps up to ${maxCover} of ${people} on these dates`);
      else continue;
    } else if (budget && best.total > budget) {
      reasons.push(`Over budget by ${best.currency} ${(best.total - budget).toLocaleString("en-US")}`);
    }
    if (best && people > BOOKING_MAX_ADULTS) reasons.push(`One booking takes up to ${BOOKING_MAX_ADULTS} people`);
    const row = { ...listingCard(p), option: best, features: (Object.keys(NEED_FEATURES) as NeedFeature[]).filter((f) => hasFeature(p.services, f)), reasons };
    (best && reasons.length === 0 ? ready : close).push(row);
  }
  ready.sort((a, b) => a.option.total - b.option.total);
  close.sort((a, b) => a.reasons.length - b.reasons.length);

  // The partner's OWN leads in that area that could be big enough. Never another partner's.
  const leadWhere: any = { salesPartnerId, status: { notIn: ["CONVERTED", "LOST", "CANCELLED"] } };
  if (area) leadWhere.OR = ["region", "district", "ward", "location", "propertyName"].map((field) => ({ [field]: { contains: area } }));
  const ownLeads = await db.salesLead.findMany({
    where: leadWhere,
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: { id: true, propertyName: true, propertyType: true, location: true, region: true, district: true, estimatedRooms: true, status: true },
  });
  const leads = ownLeads
    .filter((l: any) => l.estimatedRooms == null || Number(l.estimatedRooms) * 2 >= Math.min(people, 40))
    .slice(0, 5)
    .map((l: any) => ({ ref: leadRef(l.id), propertyName: l.propertyName, type: l.propertyType, area: [l.district, l.region].filter(Boolean).join(", ") || l.location, estimatedRooms: l.estimatedRooms, status: l.status }));

  let demandRecorded = false;
  if (ready.length === 0) {
    await recordDemand(db, salesPartnerId, { people, area, features, wholePlace: Boolean(need.wholePlace), dayUse: false, budget, checkIn, checkOut, matches: close.length });
    demandRecorded = true;
  }
  return { dayUse: false as const, nights: nightsBetween(checkIn, checkOut), ready: ready.slice(0, 12), close: close.slice(0, 8), leads, demandRecorded };
}

async function recordDemand(db: any, salesPartnerId: number, d: { people: number; area: string; features: NeedFeature[]; wholePlace: boolean; dayUse: boolean; budget: number | null; checkIn: Date | null; checkOut: Date | null; matches: number }) {
  try {
    const partner = await db.salesPartnerProfile.findUnique({ where: { id: salesPartnerId }, select: { regionId: true } }).catch(() => null);
    await db.salesDemandSignal.create({
      data: {
        salesPartnerId, regionId: partner?.regionId ?? null, area: d.area || null, people: d.people,
        dayUse: d.dayUse, features: d.features.length ? d.features : undefined, wholePlace: d.wholePlace,
        checkIn: d.checkIn, checkOut: d.checkOut, budgetTzs: d.budget, matches: d.matches,
      },
    });
  } catch (error: any) {
    // Demand data is a hint; a missing table (not migrated yet) never breaks the search.
    if (error?.code !== "P2021") console.warn("[agency-quotes] demand signal not saved:", error?.message || error);
  }
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

export function newQuoteToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(24).toString("base64url");
  return { raw, hash: hashQuoteToken(raw) };
}
export function hashQuoteToken(raw: string): string {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}
export function isQuoteToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{32}$/.test(raw);
}
function newQuoteRef(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  return "qt_" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export type QuoteOptionInput = { propertyRef: string; roomCode: string | null; rooms: number; checkIn: string; checkOut: string; adults: number; children?: number };

/** Re-prices one option on the server from live data. Throws when it cannot be sold as asked. */
export async function quoteOption(db: any, input: QuoteOptionInput, now = new Date()) {
  const ids = await db.property.findMany({ where: { status: "APPROVED", rentalMode: "NIGHTLY" }, select: { id: true } });
  const propertyId = resolveAmong("property", input.propertyRef, ids.map((r: any) => r.id));
  if (!propertyId) throw new QuoteError("That property is not available for quotes.");
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { id: true, title: true, type: true, nrmsBookingKey: true, basePrice: true, currency: true, roomsSpec: true, services: true, regionName: true, district: true, ward: true, city: true, country: true, maxGuests: true, totalBedrooms: true, totalBathrooms: true, images: { select: { url: true, thumbnailUrl: true, status: true }, orderBy: { createdAt: "asc" }, take: 3 } },
  });
  const checkIn = dayOf(input.checkIn);
  const checkOut = dayOf(input.checkOut);
  if (checkOut <= checkIn) throw new QuoteError("Check-out must be after check-in.");
  if (checkIn < todayEat(now)) throw new QuoteError("Check-in cannot be in the past.");
  const rooms = Math.round(Number(input.rooms));
  const adults = Math.round(Number(input.adults));
  const children = Math.max(0, Math.round(Number(input.children || 0)));
  if (!(rooms >= 1 && rooms <= BOOKING_MAX_ROOMS)) throw new QuoteError(`Rooms must be 1 to ${BOOKING_MAX_ROOMS}.`);
  if (!(adults >= 1 && adults <= BOOKING_MAX_ADULTS)) throw new QuoteError(`Adults must be 1 to ${BOOKING_MAX_ADULTS}.`);

  const entries = roomsSpecEntries(parseJson(property.roomsSpec));
  const entry = input.roomCode ? entries.find((e) => effectiveRoomSelectionCode(e) === input.roomCode) ?? null : entries.length === 1 ? entries[0] : null;
  if (entries.length && !entry) throw new QuoteError("Choose one of the property's room types.");
  const roomCode = entry ? effectiveRoomSelectionCode(entry) : null;
  let sellable = 0;
  try {
    sellable = Number((await calculateAvailability(property.id, checkIn, checkOut, roomCode)).summary.totalSellableRooms) || 0;
  } catch {
    sellable = 0;
  }
  if (sellable < rooms) throw new QuoteError(`Only ${sellable} of these rooms are free on those dates.`, 409);
  const commissionPercent = await effectiveCommissionPercent(property.services);
  const priced = await priceSelection(property, entry, roomCode, rooms, adults + children, checkIn, checkOut, commissionPercent, sellable);
  if (priced.overCapacity) throw new QuoteError("Too many guests for those rooms. Add rooms.");
  return { property, checkIn, checkOut, rooms, adults, children, priced };
}

/** Status a reader should see: payment and expiry are derived, so no worker is needed. */
export function effectiveQuoteStatus(quote: { status: string; expiresAt: Date | string; cancelledAt?: Date | string | null }, bookingStatus: string | null, now = new Date()): string {
  if (bookingStatus && PAID_BOOKING_STATUSES.includes(String(bookingStatus).toUpperCase())) return "PAID";
  if (quote.status === "CANCELLED" || quote.cancelledAt) return "CANCELLED";
  if (new Date(quote.expiresAt).getTime() <= now.getTime()) return "EXPIRED";
  if (bookingStatus && String(bookingStatus).toUpperCase() === "NEW") return "PAYING";
  return quote.status === "PAYING" ? "VIEWED" : quote.status;
}

export async function assertCanQuote(db: any, salesPartnerId: number, clientPhone: string, now = new Date()) {
  const open = await db.salesQuote.count({ where: { salesPartnerId, status: { in: ["SENT", "VIEWED", "PAYING"] }, expiresAt: { gt: now } } });
  if (open >= QUOTE_MAX_OPEN_PER_PARTNER) throw new QuoteError(`You have ${open} open quotes. Cancel some, or wait for them to expire.`, 409);
  const key = phoneKey(clientPhone);
  if (!key) throw new QuoteError("Enter the client's mobile number.");
  const today = await db.salesQuote.count({ where: { clientPhoneNormalized: key, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } });
  if (today >= QUOTE_MAX_PER_PHONE_PER_DAY) throw new QuoteError("This client already has 3 quotes today.", 429);
  const identity = await loadPartnerIdentity(db, salesPartnerId);
  if (identity?.phones.has(key)) throw new QuoteError("A quote goes to a client, not to your own number.", 409);
  return key;
}

// ---------------------------------------------------------------------------
// The client pays through the public booking route
// ---------------------------------------------------------------------------

export type QuoteBookingCheck = { quoteId: number; optionId: number; salesPartnerId: number };

/**
 * Called by POST /api/public/bookings when the request carries a quote token:
 * the booking must be exactly the chosen option, and the quote must still be
 * open. Returns null (and a reason) when it is not.
 */
export async function checkQuoteForBooking(db: any, token: unknown, position: unknown, booking: { propertyId: number; roomCode?: string | null; rooms?: number; checkIn: string; checkOut: string; adults?: number; children?: number }, now = new Date()): Promise<{ ok: true; check: QuoteBookingCheck } | { ok: false; reason: string }> {
  if (!isAgencyDeskEnabled()) return { ok: false, reason: "This quote can no longer be used." };
  if (!isQuoteToken(token)) return { ok: false, reason: "This quote link is not valid." };
  const quote = await db.salesQuote.findUnique({ where: { tokenHash: hashQuoteToken(token) }, include: { options: true } });
  if (!quote) return { ok: false, reason: "This quote link is not valid." };
  let bookingStatus: string | null = null;
  if (quote.bookingId) bookingStatus = (await db.booking.findUnique({ where: { id: quote.bookingId }, select: { status: true } }))?.status ?? null;
  const status = effectiveQuoteStatus(quote, bookingStatus, now);
  if (status === "PAID") return { ok: false, reason: "This quote is already paid." };
  if (status === "CANCELLED" || status === "EXPIRED") return { ok: false, reason: "This quote has expired. Ask your sales partner for a new one." };
  const gate = await loadAgencyGateInput(db, quote.salesPartnerId, now);
  if (agencyGateFailure(gate, { at: now })) return { ok: false, reason: "This quote can no longer be used. Contact NoLSAF support." };
  const option = quote.options.find((o: any) => o.position === Number(position));
  if (!option) return { ok: false, reason: "Choose one of the quoted options." };
  const same =
    option.propertyId === booking.propertyId &&
    String(option.roomCode ?? "") === String(booking.roomCode ?? "") &&
    option.rooms === Number(booking.rooms ?? 1) &&
    isoDay(new Date(option.checkIn)) === String(booking.checkIn).trim().slice(0, 10) &&
    isoDay(new Date(option.checkOut)) === String(booking.checkOut).trim().slice(0, 10) &&
    option.adults === Number(booking.adults ?? 1) &&
    option.children === Number(booking.children ?? 0);
  if (!same) return { ok: false, reason: "The booking does not match the quoted option." };
  return { ok: true, check: { quoteId: quote.id, optionId: option.id, salesPartnerId: quote.salesPartnerId } };
}

/**
 * After the booking exists: tie it to the quote and credit the partner
 * (AGENCY_QUOTE). A self-booking is recorded BLOCKED and earns nothing.
 * Never throws to the booking route.
 */
export async function attachQuoteBooking(db: any, check: QuoteBookingCheck, bookingId: number, now = new Date()) {
  try {
    const booking = await db.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, propertyId: true, userId: true, guestPhone: true, user: { select: { email: true, phone: true } } },
    });
    if (!booking) return;
    const identity = await loadPartnerIdentity(db, check.salesPartnerId);
    const blockedReason =
      (identity ? partnerBookedStayReason(identity, booking) : null) ??
      (identity ? await partnerOwnsPropertyReason(db, identity, booking.propertyId) : null);
    await db.$transaction(async (tx: any) => {
      // A retry after a failed payment moves the quote to the new booking.
      await tx.salesQuote.update({
        where: { id: check.quoteId },
        data: { bookingId: booking.id, chosenOptionId: check.optionId, status: "PAYING", payingAt: now },
      });
      await tx.bookingChannelAttribution.create({
        data: {
          bookingId: booking.id,
          salesPartnerId: check.salesPartnerId,
          linkId: null,
          channel: "AGENCY_QUOTE",
          status: blockedReason ? "BLOCKED" : "ACTIVE",
          blockedReason: blockedReason ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: "SYSTEM",
          action: blockedReason ? "SALES_AGENCY_QUOTE_ATTRIBUTION_BLOCKED" : "SALES_AGENCY_QUOTE_ATTRIBUTION",
          entity: "BOOKING",
          entityId: booking.id,
          beforeJson: null,
          afterJson: { salesPartnerId: check.salesPartnerId, quoteId: check.quoteId, ...(blockedReason ? { blockedReason } : {}) },
        },
      });
    });
  } catch (error: any) {
    console.warn("[agency-quotes] attach skipped:", error?.message || String(error));
  }
}

export { PAID_BOOKING_STATUSES, newQuoteRef };

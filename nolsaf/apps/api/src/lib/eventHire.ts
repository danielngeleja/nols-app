/**
 * "Hire for events" add-on, phase E1 (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 4).
 *
 * The owner, or the sales partner who lists for them, declares the event space:
 * capacity, hours, prices, deposit, what is allowed and provided. The owner
 * always gives the consent ("parties are allowed here") themselves, in the app
 * or on an SMS link, against a fingerprint of exactly the terms shown. Admin
 * then approves or returns it. Nothing is sold in E1; event booking is E2.
 *
 * Status: DRAFT -> (partner) AWAITING_OWNER -> PENDING -> APPROVED | RETURNED; APPROVED <-> PAUSED.
 * Any change to the terms after approval puts the add-on back to DRAFT.
 */
import crypto from "node:crypto";
import { sanitizeText } from "./sanitize.js";
import { sanitizePhotoAreas } from "./photoAreas.js";

export const EVENT_SPACE_TYPES = ["GARDEN", "HALL", "ROOFTOP", "WHOLE_HOUSE", "POOL_AREA", "OTHER"] as const;
export type EventSpaceType = (typeof EVENT_SPACE_TYPES)[number];
/** What events the owner says the space suits; partners match client requests on it. */
export const EVENT_TYPES = [
  "WEDDING", "SEND_OFF", "KITCHEN_PARTY", "BIRTHDAY", "HOUSE_PARTY", "GRADUATION",
  "MEETING", "WORKSHOP", "CHURCH", "PHOTO_SHOOT",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_ALLOWED_KEYS =["music", "decorations", "outsideCatering", "cooking", "alcohol", "overnightGuests"] as const;
export const EVENT_STATUSES = ["DRAFT", "AWAITING_OWNER", "PENDING", "APPROVED", "RETURNED", "PAUSED"] as const;

export const EVENT_MAX_CAPACITY = 3000;
export const EVENT_MAX_PRICE = 500_000_000;
export const EVENT_MAX_SPAN_MINUTES = 18 * 60;
export const EVENT_DEFAULT_DEPOSIT_PERCENT = 25;
export const EVENT_MAX_DAYS = 14;
/**
 * NoLSAF's fee on event hire: 16% shared by both sides (decided 2026-11-27,
 * docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 6.1).
 *  - Owner: 10% of the owner's price, kept from the owner's payout.
 *  - Client: 6% of the owner's price, added as a service fee.
 * Payment fees come out of NoLSAF's share. The deposit and cleaning fee carry no fee.
 */
export const EVENT_OWNER_FEE_PERCENT = 10;
export const EVENT_CLIENT_FEE_PERCENT = 6;

/** The money for one owner price (a slot, or a several-day total). */
export function eventMoney(ownerPrice: number, ownerFee = EVENT_OWNER_FEE_PERCENT, clientFee = EVENT_CLIENT_FEE_PERCENT) {
  const ownerFeeAmount = Math.round((ownerPrice * ownerFee) / 100);
  const clientFeeAmount = Math.round((ownerPrice * clientFee) / 100);
  return {
    ownerPrice,
    ownerFee: ownerFeeAmount,
    ownerReceives: ownerPrice - ownerFeeAmount,
    clientFee: clientFeeAmount,
    clientPays: ownerPrice + clientFeeAmount,
    nolsafFee: ownerFeeAmount + clientFeeAmount,
  };
}
export const EVENT_MAX_DAY_DISCOUNT = 50;
export const EVENT_MAX_DEPOSIT_PERCENT = 100;
/** The owner's SMS confirmation link stays valid this long; after that the partner sends a new one. */
export const EVENT_CONFIRM_LINK_DAYS = 14;

export type EventTerms = {
  spaceType: EventSpaceType | null;
  /** Events the space suits, in the list's order. */
  eventTypes: EventType[];
  description: string | null;
  capacitySeated: number | null;
  capacityStanding: number | null;
  earliestStart: string | null; // HH:MM
  latestEnd: string | null; // HH:MM, earlier than the start means after midnight
  noiseCutoff: string | null; // HH:MM, inside the window
  halfDayPrice: number | null;
  fullDayPrice: number | null;
  eveningPrice: number | null;
  /**
   * Events over several days in a row (a 3-day conference, a wedding weekend).
   * Each day is priced at the full-day price; the whole booking gets the
   * highest discount it qualifies for (from 2, 3 or 5 days).
   */
  multiDay: { enabled: boolean; maxDays: number | null; off2: number; off3: number; off5: number };
  /** PERCENT: the deposit is depositPercent of whichever price the client books. FIXED: one amount for every booking. */
  depositMode: "PERCENT" | "FIXED";
  depositPercent: number | null;
  deposit: number | null;
  cleaningFee: number | null;
  currency: "TZS";
  allowed: Record<(typeof EVENT_ALLOWED_KEYS)[number], boolean>;
  provided: { chairs: number | null; tables: number | null; parkingSpaces: number | null; toilets: number | null; powerBackup: boolean; water: boolean };
  permitNote: string | null;
};

export class EventHireError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); }
}

/**
 * After the owner sends it for review nothing can be changed: not by the owner,
 * not by a partner. It opens again only when NoLSAF returns it.
 */
export const EVENT_LOCKED_STATUSES = ["PENDING", "APPROVED", "PAUSED"] as const;
export function isLocked(status: unknown): boolean {
  return (EVENT_LOCKED_STATUSES as readonly string[]).includes(String(status));
}
function lockedError(status: string): EventHireError {
  return new EventHireError(
    status === "PENDING"
      ? "This is with NoLSAF for review and cannot be changed now. If something needs changing, NoLSAF returns it to you."
      : "Approved event hire cannot be changed here. Call NoLSAF support to change it.",
    409,
    "LOCKED",
  );
}

// ---------------------------------------------------------------------------
// Terms: clean, check, fingerprint (pure)
// ---------------------------------------------------------------------------

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function int(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(String(value).replace(/,/g, "")));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const clean = sanitizeText(value).replace(/\s+/g, " ").trim().slice(0, max);
  return clean || null;
}

function clock(value: unknown): string | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value ?? "").trim());
  return m ? `${m[1]}:${m[2]}` : null;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutes from the start to `at`, wrapping past midnight. */
function offset(start: string, at: string): number {
  const d = minutes(at) - minutes(start);
  return d <= 0 ? d + 24 * 60 : d;
}

/** Keeps only known fields with sane values; never throws, so a draft can always be saved. */
export function sanitizeEventTerms(input: unknown): EventTerms {
  const raw = (parseJsonish(input) || {}) as Record<string, any>;
  const allowedIn = (raw.allowed && typeof raw.allowed === "object" ? raw.allowed : {}) as Record<string, unknown>;
  const providedIn = (raw.provided && typeof raw.provided === "object" ? raw.provided : {}) as Record<string, unknown>;
  const allowed = Object.fromEntries(EVENT_ALLOWED_KEYS.map((k) => [k, allowedIn[k] === true])) as EventTerms["allowed"];
  // An older draft with only an amount is a fixed deposit; otherwise a percent of the price.
  const depositMode: EventTerms["depositMode"] =
    raw.depositMode === "FIXED" || (raw.depositMode !== "PERCENT" && raw.deposit != null && raw.deposit !== "") ? "FIXED" : "PERCENT";
  return {
    spaceType: (EVENT_SPACE_TYPES as readonly string[]).includes(raw.spaceType) ? raw.spaceType : null,
    eventTypes: EVENT_TYPES.filter((t) => Array.isArray(raw.eventTypes) && raw.eventTypes.includes(t)),
    description: text(raw.description, 600),
    capacitySeated: int(raw.capacitySeated, 1, EVENT_MAX_CAPACITY),
    capacityStanding: int(raw.capacityStanding, 1, EVENT_MAX_CAPACITY),
    earliestStart: clock(raw.earliestStart),
    latestEnd: clock(raw.latestEnd),
    noiseCutoff: clock(raw.noiseCutoff),
    halfDayPrice: int(raw.halfDayPrice, 1, EVENT_MAX_PRICE),
    fullDayPrice: int(raw.fullDayPrice, 1, EVENT_MAX_PRICE),
    eveningPrice: int(raw.eveningPrice, 1, EVENT_MAX_PRICE),
    multiDay: (() => {
      const m = (raw.multiDay && typeof raw.multiDay === "object" ? raw.multiDay : {}) as Record<string, unknown>;
      const off = (v: unknown) => int(v, 0, EVENT_MAX_DAY_DISCOUNT) ?? 0;
      return { enabled: m.enabled === true, maxDays: int(m.maxDays, 2, EVENT_MAX_DAYS), off2: off(m.off2), off3: off(m.off3), off5: off(m.off5) };
    })(),
    depositMode,
    // Not chosen yet: the default percent, so the deposit works out by itself.
    depositPercent: raw.depositPercent === undefined && depositMode === "PERCENT" ? EVENT_DEFAULT_DEPOSIT_PERCENT : int(raw.depositPercent, 0, EVENT_MAX_DEPOSIT_PERCENT),
    deposit: int(raw.deposit, 0, EVENT_MAX_PRICE),
    cleaningFee: int(raw.cleaningFee, 1, EVENT_MAX_PRICE),
    currency: "TZS",
    allowed,
    provided: {
      chairs: int(providedIn.chairs, 0, 10_000),
      tables: int(providedIn.tables, 0, 2_000),
      parkingSpaces: int(providedIn.parkingSpaces, 0, 2_000),
      toilets: int(providedIn.toilets, 0, 500),
      powerBackup: providedIn.powerBackup === true,
      water: providedIn.water === true,
    },
    permitNote: text(raw.permitNote, 300),
  };
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value as object).sort().map((k) => [k, stable((value as any)[k])]));
  }
  return value;
}

export function eventTermsFingerprint(terms: EventTerms): string {
  return crypto.createHash("sha256").update(JSON.stringify(stable(terms))).digest("hex");
}

/** Event space photos on the listing (photo area EVENT_SPACE). */
export function eventSpacePhotoCount(photos: unknown, photoAreas: unknown): number {
  const list = parseJsonish(photos);
  const urls = Array.isArray(list) ? list.map((p) => String(p ?? "").trim()).filter(Boolean) : [];
  const map = sanitizePhotoAreas(photoAreas, urls) || {};
  return Object.values(map).filter((a) => a === "EVENT_SPACE").length;
}

/** Photos of the event space, listing photos tagged plus photos uploaded here: 7 to 12 in all. */
export const EVENT_MIN_PHOTOS = 7;
export const EVENT_MAX_PHOTOS = 12;
export const EVENT_MAX_EXTRA_PHOTOS = EVENT_MAX_PHOTOS;
const TOO_MANY_PHOTOS = `Up to ${EVENT_MAX_PHOTOS} photos of the event space. Remove one first.`;

/**
 * Only photos NoLSAF itself stored: our Cloudinary account, property folders.
 * Stops anyone saving an arbitrary link as an event photo.
 */
export function isOurEventPhotoUrl(value: unknown, cloudName = process.env.CLOUDINARY_CLOUD_NAME || ""): value is string {
  if (typeof value !== "string" || value.length > 2048 || !cloudName) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" && url.pathname.startsWith(`/${cloudName}/image/upload/`) && url.pathname.includes("/properties/");
  } catch {
    return false;
  }
}

/** Event photos uploaded on the add-on, cleaned (known URLs only, no repeats, capped). */
export function readExtraPhotos(value: unknown, cloudName?: string): string[] {
  const list = parseJsonish(value);
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list.filter((u): u is string => isOurEventPhotoUrl(u, cloudName)))).slice(0, EVENT_MAX_EXTRA_PHOTOS);
}

/**
 * Replaces the uploaded event photos. Changing photos of an approved add-on
 * sends it back to DRAFT, like a change of terms: NoLSAF has not seen them.
 */
export async function setExtraEventPhotos(db: any, input: { propertyId: number; userId: number; by: "OWNER" | "SALES_PARTNER"; salesPartnerId?: number | null; urls: unknown }) {
  const property = await loadPropertyForEvents(db, input.propertyId);
  const raw = Array.isArray(input.urls) ? input.urls : [];
  if (raw.some((u) => !isOurEventPhotoUrl(u))) throw new EventHireError("Upload the photos here; links from elsewhere are not accepted.");
  const urls = readExtraPhotos(raw);
  // The cap counts listing photos already tagged Event space too.
  if (raw.length + eventSpacePhotoCount(property.photos, property.photoAreas) > EVENT_MAX_PHOTOS) throw new EventHireError(TOO_MANY_PHOTOS);
  const existing = await loadEventHire(db, input.propertyId);
  if (input.by === "SALES_PARTNER" && existing && !["DRAFT", "AWAITING_OWNER", "RETURNED"].includes(existing.status)) {
    throw new EventHireError("The owner already confirmed this. Ask them to change it from their account.", 409, "OWNER_HAS_IT");
  }
  const extraPhotos = urls.length ? urls : null;
  let row;
  if (existing) {
    const changed = JSON.stringify(readExtraPhotos(existing.extraPhotos)) !== JSON.stringify(urls);
    if (isLocked(existing.status)) {
      if (!changed) return { row: existing, property };
      throw lockedError(existing.status);
    }
    row = await db.propertyEventHire.update({ where: { id: existing.id }, data: { extraPhotos } });
  } else {
    const terms = sanitizeEventTerms({});
    row = await db.propertyEventHire.create({
      data: {
        propertyId: input.propertyId, terms, termsFingerprint: eventTermsFingerprint(terms), status: "DRAFT", extraPhotos,
        filledBy: input.by, filledByUserId: input.userId, salesPartnerId: input.by === "SALES_PARTNER" ? input.salesPartnerId ?? null : null,
      },
    });
  }
  return { row, property };
}

/** The listing's photos with their area, for picking Event space photos in the form. */
export function listingPhotos(photos: unknown, photoAreas: unknown): Array<{ url: string; area: string | null }> {
  const list = parseJsonish(photos);
  const urls = Array.isArray(list) ? list.map((p) => String(p ?? "").trim()).filter(Boolean) : [];
  const map = sanitizePhotoAreas(photoAreas, urls) || {};
  return urls.slice(0, 60).map((url) => ({ url, area: map[url] ?? null }));
}

/**
 * Marks exactly `urls` as Event space on the listing. Photos no longer chosen
 * lose the Event space label; other areas (Kitchen, Garden...) are left alone,
 * except that a chosen photo becomes Event space. Only labels change, never the photos.
 */
export async function setEventSpacePhotos(db: any, propertyId: number, urls: unknown) {
  const property = await loadPropertyForEvents(db, propertyId);
  const current = await loadEventHire(db, propertyId);
  if (current && isLocked(current.status)) throw lockedError(current.status);
  const list = parseJsonish(property.photos);
  const all = Array.isArray(list) ? list.map((p) => String(p ?? "").trim()).filter(Boolean) : [];
  const chosen = new Set((Array.isArray(urls) ? urls : []).map((u) => String(u ?? "").trim()).filter((u) => all.includes(u)));
  const uploaded = readExtraPhotos((await loadEventHire(db, propertyId))?.extraPhotos).length;
  if (chosen.size + uploaded > EVENT_MAX_PHOTOS) throw new EventHireError(TOO_MANY_PHOTOS);
  const areas: Record<string, string> = { ...(sanitizePhotoAreas(property.photoAreas, all) || {}) };
  for (const url of all) {
    if (chosen.has(url)) areas[url] = "EVENT_SPACE";
    else if (areas[url] === "EVENT_SPACE") delete areas[url];
  }
  const photoAreas = Object.keys(areas).length ? areas : null;
  await db.property.update({ where: { id: propertyId }, data: { photoAreas } });
  return { ...property, photoAreas };
}

/** Required details only (photos are checked when sending). Empty means the details can be saved. */
export function requiredTermsProblems(terms: EventTerms): string[] {
  return eventTermsProblems(terms, EVENT_MIN_PHOTOS);
}

/** What still stops the terms being sent for review. Empty means complete. */
export function eventTermsProblems(terms: EventTerms, eventPhotos: number): string[] {
  const out: string[] = [];
  if (!terms.spaceType) out.push("Choose what kind of space it is.");
  if (!terms.eventTypes.length) out.push("Choose at least one kind of event the space suits.");
  if (!terms.capacitySeated || !terms.capacityStanding) out.push("Enter how many guests fit, seated and standing.");
  else if (terms.capacityStanding < terms.capacitySeated) out.push("Standing guests cannot be fewer than seated guests.");
  if (!terms.earliestStart || !terms.latestEnd) out.push("Enter the earliest start and the latest end.");
  else {
    const span = offset(terms.earliestStart, terms.latestEnd);
    if (span < 60) out.push("Allow at least one hour between the start and the end.");
    if (span > EVENT_MAX_SPAN_MINUTES) out.push("Events can run up to 18 hours a day.");
    if (terms.noiseCutoff && offset(terms.earliestStart, terms.noiseCutoff) > span) out.push("The quiet time must fall between the start and the end.");
  }
  if (!terms.halfDayPrice && !terms.fullDayPrice) out.push("Enter a half-day or a full-day price.");
  if (terms.halfDayPrice && terms.fullDayPrice && terms.halfDayPrice > terms.fullDayPrice) out.push("The half-day price cannot be more than the full-day price.");
  if (terms.multiDay.enabled) {
    if (!terms.fullDayPrice) out.push("Events over several days are priced from the full-day price. Enter it.");
    if (!terms.multiDay.maxDays) out.push("Choose the most days in a row an event can take.");
    const { off2, off3, off5 } = terms.multiDay;
    if (off3 < off2 || off5 < off3) out.push("Longer events should get the same or a bigger discount, not a smaller one.");
  }
  if (terms.depositMode === "PERCENT" && terms.depositPercent === null) out.push("Choose the deposit as a percent of the price (it can be 0%).");
  if (terms.depositMode === "FIXED" && terms.deposit === null) out.push("Enter the refundable deposit (it can be 0).");
  if (eventPhotos < EVENT_MIN_PHOTOS) {
    out.push(`Add at least ${EVENT_MIN_PHOTOS} photos of the event space (${eventPhotos} so far).`);
  } else if (eventPhotos > EVENT_MAX_PHOTOS) {
    out.push(`Keep at most ${EVENT_MAX_PHOTOS} photos of the event space (${eventPhotos} now).`);
  }
  return out;
}

/**
 * The refundable deposit for one booked price (half day, full day or evening).
 * Percent deposits round to the nearest TSh 1,000. Null when the price or rule is missing.
 */
export function depositFor(terms: Pick<EventTerms, "depositMode" | "depositPercent" | "deposit">, price: number | null): number | null {
  if (terms.depositMode === "FIXED") return terms.deposit;
  if (terms.depositPercent === null || !price) return null;
  return Math.round((price * terms.depositPercent) / 100 / 1_000) * 1_000;
}

/**
 * The owner's price for an event over `days` days in a row: full-day price x
 * days, less the discount that length qualifies for. Null when not offered.
 */
export function multiDayPrice(terms: Pick<EventTerms, "fullDayPrice" | "multiDay">, days: number) {
  const d = Math.round(Number(days));
  if (!terms.multiDay.enabled || !terms.fullDayPrice || !(d >= 2) || d > (terms.multiDay.maxDays ?? 0)) return null;
  const percent = d >= 5 ? terms.multiDay.off5 : d >= 3 ? terms.multiDay.off3 : terms.multiDay.off2;
  const gross = terms.fullDayPrice * d;
  const total = Math.round(gross * (1 - percent / 100));
  return { days: d, gross, percent, total, saving: gross - total };
}

/** Suggested fixed deposit: 25% of the full-day price, rounded to TSh 5,000. */
export function suggestedDeposit(terms: Pick<EventTerms, "fullDayPrice" | "halfDayPrice">): number | null {
  const base = terms.fullDayPrice || (terms.halfDayPrice ? terms.halfDayPrice * 2 : null);
  return base ? Math.max(5_000, Math.round((base * 0.25) / 5_000) * 5_000) : null;
}

// ---------------------------------------------------------------------------
// Tokens for the owner's SMS link
// ---------------------------------------------------------------------------

export function newEventConfirmToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(24).toString("base64url");
  return { raw, hash: hashEventConfirmToken(raw) };
}
export function hashEventConfirmToken(raw: string): string {
  return crypto.createHash("sha256").update(`event-hire:${raw}`).digest("hex");
}
export function isEventConfirmToken(raw: unknown): raw is string {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{32}$/.test(raw);
}

// ---------------------------------------------------------------------------
// State changes (db passed in, so routes and tests share one implementation)
// ---------------------------------------------------------------------------

const propertySelect = { id: true, title: true, status: true, rentalMode: true, ownerId: true, photos: true, photoAreas: true };

export async function loadEventHire(db: any, propertyId: number) {
  return db.propertyEventHire.findUnique({ where: { propertyId } });
}

/** One view for the owner, the partner and admin (no tokens, no hashes). */
export function eventHireView(row: any, property: any) {
  const terms = row ? sanitizeEventTerms(row.terms) : sanitizeEventTerms({});
  const extraPhotos = readExtraPhotos(row?.extraPhotos);
  const photos = eventSpacePhotoCount(property?.photos, property?.photoAreas) + extraPhotos.length;
  return {
    status: row?.status ?? "NONE",
    // Nothing can be edited (terms or photos) while true.
    locked: isLocked(row?.status),
    // Shown to the owner so they know exactly what NoLSAF keeps and adds.
    ownerFeePercent: EVENT_OWNER_FEE_PERCENT,
    clientFeePercent: EVENT_CLIENT_FEE_PERCENT,
    terms,
    // The fingerprint stored when the terms were saved: consent and approval are
    // checked against it, so adding a field later never breaks an add-on in review.
    version: row?.termsFingerprint ?? eventTermsFingerprint(terms),
    problems: eventTermsProblems(terms, photos),
    eventSpacePhotos: photos,
    photos: listingPhotos(property?.photos, property?.photoAreas),
    extraPhotos,
    suggestedDeposit: suggestedDeposit(terms),
    // The deposit for each price, worked out on the server (what a client will be asked for).
    deposits: {
      halfDay: terms.halfDayPrice ? depositFor(terms, terms.halfDayPrice) : null,
      fullDay: terms.fullDayPrice ? depositFor(terms, terms.fullDayPrice) : null,
      evening: terms.eveningPrice ? depositFor(terms, terms.eveningPrice) : null,
    },
    filledBy: row?.filledBy ?? null,
    ownerConsentAt: row?.ownerConsentAt ?? null,
    ownerConsentVia: row?.ownerConsentVia ?? null,
    consentCurrent: Boolean(row?.ownerConsentFingerprint && row.ownerConsentFingerprint === row.termsFingerprint),
    confirmSentAt: row?.confirmSentAt ?? null,
    confirmOpenedAt: row?.confirmOpenedAt ?? null,
    ownerObjectionNote: row?.ownerObjectionNote ?? null,
    ownerObjectedAt: row?.ownerObjectedAt ?? null,
    submittedAt: row?.submittedAt ?? null,
    reviewedAt: row?.reviewedAt ?? null,
    returnReason: row?.returnReason ?? null,
    pausedAt: row?.pausedAt ?? null,
    pauseReason: row?.pauseReason ?? null,
    propertyTitle: property?.title ?? null,
    propertyStatus: property?.status ?? null,
  };
}

export async function loadPropertyForEvents(db: any, propertyId: number) {
  const property = await db.property.findUnique({ where: { id: propertyId }, select: propertySelect });
  if (!property) throw new EventHireError("Property not found", 404);
  if (String(property.rentalMode || "NIGHTLY").toUpperCase() === "LONG_STAY") {
    throw new EventHireError("Event hire is for short-stay listings, not long-stay homes.", 409, "LONG_STAY");
  }
  return property;
}

/**
 * Save terms. `by` says who saved: an owner save clears a pending SMS link;
 * a partner may only edit before the owner has confirmed.
 */
export async function saveEventTerms(db: any, input: { propertyId: number; userId: number; by: "OWNER" | "SALES_PARTNER"; salesPartnerId?: number | null; terms: unknown }) {
  const property = await loadPropertyForEvents(db, input.propertyId);
  const terms = sanitizeEventTerms(input.terms);
  const fingerprint = eventTermsFingerprint(terms);
  // Required details must all be there to save (photos are saved on their own, so not counted here).
  const missing = requiredTermsProblems(terms);
  if (missing.length) throw new EventHireError(missing[0], 400, "REQUIRED");
  const existing = await loadEventHire(db, input.propertyId);
  if (input.by === "SALES_PARTNER" && existing && !["DRAFT", "AWAITING_OWNER", "RETURNED"].includes(existing.status)) {
    throw new EventHireError("The owner already confirmed this. Ask them to change it from their account.", 409, "OWNER_HAS_IT");
  }
  // Once sent for review it is locked: an unchanged save is a no-op, any change is refused.
  if (existing && isLocked(existing.status)) {
    if (existing.termsFingerprint === fingerprint) return { row: existing, property };
    throw lockedError(existing.status);
  }
  const status = "DRAFT";
  const data = {
    terms,
    termsFingerprint: fingerprint,
    status,
    filledBy: input.by,
    filledByUserId: input.userId,
    salesPartnerId: input.by === "SALES_PARTNER" ? input.salesPartnerId ?? null : existing?.salesPartnerId ?? null,
    // A pending SMS link showed the old terms: it stops working.
    confirmTokenHash: null,
  };
  const row = existing
    ? await db.propertyEventHire.update({ where: { id: existing.id }, data })
    : await db.propertyEventHire.create({ data: { propertyId: input.propertyId, ...data } });
  return { row, property };
}

/** Owner, signed in: consents to exactly `version` and sends it for review. */
export async function submitByOwner(db: any, input: { propertyId: number; version: string; consent: boolean }, now = new Date()) {
  const property = await loadPropertyForEvents(db, input.propertyId);
  const row = await loadEventHire(db, input.propertyId);
  if (!row) throw new EventHireError("Save the event details first.");
  return submit(db, row, property, input.version, input.consent, "APP", now);
}

async function submit(db: any, row: any, property: any, version: string, consent: boolean, via: "APP" | "SMS_LINK", now: Date) {
  if (!consent) throw new EventHireError("Confirm that you control this space and that events are allowed there.");
  if (row.termsFingerprint !== version) throw new EventHireError("The details changed since you opened this page. Check them and confirm again.", 409, "CHANGED");
  // Already with NoLSAF (in review, approved or paused): sending again changes nothing.
  if (isLocked(row.status)) return { row, changed: false };
  const problems = eventTermsProblems(sanitizeEventTerms(row.terms), eventSpacePhotoCount(property.photos, property.photoAreas) + readExtraPhotos(row.extraPhotos).length);
  if (problems.length) throw new EventHireError(problems[0], 400, "INCOMPLETE");
  const updated = await db.propertyEventHire.update({
    where: { id: row.id },
    data: {
      status: "PENDING",
      ownerConsentFingerprint: version,
      ownerConsentAt: now,
      ownerConsentVia: via,
      ownerObjectionNote: null,
      ownerObjectedAt: null,
      submittedAt: now,
      returnReason: null,
    },
  });
  return { row: updated, changed: true };
}

/** Partner: complete terms go to the owner by SMS for their consent. Returns the raw token once. */
export async function sendToOwner(db: any, input: { propertyId: number }, now = new Date()) {
  const property = await loadPropertyForEvents(db, input.propertyId);
  const row = await loadEventHire(db, input.propertyId);
  if (!row) throw new EventHireError("Save the event details first.");
  if (!["DRAFT", "AWAITING_OWNER", "RETURNED"].includes(row.status)) throw new EventHireError("The owner already confirmed this.", 409);
  const problems = eventTermsProblems(sanitizeEventTerms(row.terms), eventSpacePhotoCount(property.photos, property.photoAreas) + readExtraPhotos(row.extraPhotos).length);
  if (problems.length) throw new EventHireError(problems[0], 400, "INCOMPLETE");
  const token = newEventConfirmToken();
  const updated = await db.propertyEventHire.update({
    where: { id: row.id },
    data: { status: "AWAITING_OWNER", confirmTokenHash: token.hash, confirmSentAt: now, confirmOpenedAt: null, ownerObjectionNote: null, ownerObjectedAt: null },
  });
  return { row: updated, property, token: token.raw };
}

function linkLive(row: any, now: Date): boolean {
  return Boolean(row?.confirmSentAt) && now.getTime() - new Date(row.confirmSentAt).getTime() < EVENT_CONFIRM_LINK_DAYS * 86_400_000;
}

/** The owner's SMS link: the row it points at, or null when unknown or stale. */
export async function findByConfirmToken(db: any, token: string, now = new Date()) {
  if (!isEventConfirmToken(token)) return null;
  const row = await db.propertyEventHire.findUnique({ where: { confirmTokenHash: hashEventConfirmToken(token) } });
  if (!row || !linkLive(row, now)) return null;
  return row;
}

export async function confirmByToken(db: any, token: string, version: string, consent: boolean, now = new Date()) {
  const row = await findByConfirmToken(db, token, now);
  if (!row) throw new EventHireError("This link is not valid any more. Ask your sales partner to send it again.", 404);
  if (row.status !== "AWAITING_OWNER") {
    if (row.status === "PENDING" || row.status === "APPROVED") return { row, changed: false };
    throw new EventHireError("This was changed after the SMS was sent. Ask your sales partner to send it again.", 409);
  }
  const property = await loadPropertyForEvents(db, row.propertyId);
  return submit(db, row, property, version, consent, "SMS_LINK", now);
}

export async function objectByToken(db: any, token: string, note: string, now = new Date()) {
  const row = await findByConfirmToken(db, token, now);
  if (!row) throw new EventHireError("This link is not valid any more. If something is wrong, call NoLSAF support.", 404);
  if (row.status !== "AWAITING_OWNER") throw new EventHireError("This was already decided. Call NoLSAF support if something is wrong.", 409);
  const clean = text(note, 500);
  if (!clean || clean.length < 3) throw new EventHireError("Tell us what is wrong (under 500 characters).");
  return db.propertyEventHire.update({
    where: { id: row.id },
    data: { status: "DRAFT", ownerObjectionNote: clean, ownerObjectedAt: now, confirmTokenHash: null },
  });
}

export async function markLinkOpened(db: any, row: any, now = new Date()) {
  if (row.confirmOpenedAt) return;
  await db.propertyEventHire.updateMany({ where: { id: row.id, confirmOpenedAt: null }, data: { confirmOpenedAt: now } }).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Admin decisions
// ---------------------------------------------------------------------------

export async function adminDecide(db: any, input: { propertyId: number; adminId: number; action: "APPROVE" | "RETURN" | "PAUSE" | "RESUME"; version?: string; reason?: string }, now = new Date()) {
  const row = await loadEventHire(db, input.propertyId);
  if (!row) throw new EventHireError("No event hire on this property.", 404);
  const reason = input.reason ? text(input.reason, 500) : null;
  switch (input.action) {
    case "APPROVE":
      if (row.status !== "PENDING") throw new EventHireError("Only an event hire waiting for review can be approved.", 409);
      if (input.version !== row.termsFingerprint) throw new EventHireError("The terms changed while you were reviewing. Reload and check again.", 409, "CHANGED");
      if (row.ownerConsentFingerprint !== row.termsFingerprint) throw new EventHireError("The owner has not confirmed these terms.", 409);
      {
        // Never approve something with required details or photos missing: return it instead.
        const property = await loadPropertyForEvents(db, input.propertyId);
        const missing = eventTermsProblems(sanitizeEventTerms(row.terms), eventSpacePhotoCount(property.photos, property.photoAreas) + readExtraPhotos(row.extraPhotos).length);
        if (missing.length) throw new EventHireError(`Required details are missing, so it cannot be approved. Return it to the owner. ${missing[0]}`, 409, "INCOMPLETE");
      }
      return db.propertyEventHire.update({ where: { id: row.id }, data: { status: "APPROVED", approvedFingerprint: row.termsFingerprint, reviewedAt: now, reviewedById: input.adminId, returnReason: null, pausedAt: null, pauseReason: null } });
    case "RETURN":
      if (row.status !== "PENDING") throw new EventHireError("Only an event hire waiting for review can be returned.", 409);
      if (!reason || reason.length < 5) throw new EventHireError("Say what the owner should change.");
      return db.propertyEventHire.update({ where: { id: row.id }, data: { status: "RETURNED", returnReason: reason, reviewedAt: now, reviewedById: input.adminId } });
    case "PAUSE":
      if (row.status !== "APPROVED") throw new EventHireError("Only an approved event hire can be paused.", 409);
      if (!reason || reason.length < 5) throw new EventHireError("Say why it is paused.");
      return db.propertyEventHire.update({ where: { id: row.id }, data: { status: "PAUSED", pausedAt: now, pauseReason: reason, reviewedById: input.adminId } });
    case "RESUME": {
      if (row.status !== "PAUSED") throw new EventHireError("Only a paused event hire can be resumed.", 409);
      const backTo = row.approvedFingerprint && row.approvedFingerprint === row.termsFingerprint ? "APPROVED" : "PENDING";
      return db.propertyEventHire.update({ where: { id: row.id }, data: { status: backTo, pausedAt: null, pauseReason: null, reviewedById: input.adminId } });
    }
  }
}

/**
 * Long-stay listing rules (docs/LONG_STAY_RENTALS.md sections 3.1 and 12,
 * decisions 7 to 9). Shared by the owner listing save/submit handlers, the
 * owner long-stay routes and admin approval, so the rules live in one place:
 *
 *  - only a landlord an admin switched on (and not paused) may use LONG_STAY;
 *  - only home types may rent long stay;
 *  - the monthly terms are validated here and nowhere else;
 *  - a listing cannot leave long stay while a tenancy on it is still open.
 */
import { AVAILABILITY_BLOCKING_BOOKING_STATUSES } from "../bookingStatus.js";
import { z } from "zod";
import {
  computeLongStayQuote,
  isLongStayPropertyType,
  LONG_STAY_CURRENCIES,
  LONG_STAY_MAX_TERM_MONTHS,
  LONG_STAY_TERM_MONTHS,
  LongStayQuoteError,
  normalizeLongStayRates,
} from "./fees.js";
import { isTerminalTenancyStatus, isTenancyStatus, RESERVATION_HOLD_STATUSES, TENANCY_DATE_HOLD_STATUSES } from "./tenancyState.js";

export const RENTAL_MODES = ["NIGHTLY", "LONG_STAY"] as const;
export type RentalMode = (typeof RENTAL_MODES)[number];

export class LongStayListingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "LongStayListingError";
  }
}

/** Today's default rates from SystemSetting (a tenancy snapshots its own). */
export async function currentLongStayRates(db: any) {
  const row = await db.systemSetting.findUnique({
    where: { id: 1 },
    select: { longStayLandlordPercent: true, longStayTenantPercent: true, longStayLandlordCapMonths: true, longStayTenantCapMonths: true },
  }).catch(() => null);
  return normalizeLongStayRates({
    landlordPercent: row?.longStayLandlordPercent,
    tenantPercent: row?.longStayTenantPercent,
    landlordCapMonths: row?.longStayLandlordCapMonths,
    tenantCapMonths: row?.longStayTenantCapMonths,
  });
}

// ---------- Landlord switch ----------

export type LandlordGate = { granted: boolean; paused: boolean; pauseReason: string | null; enabledAt: Date | null };

export async function landlordGate(db: any, userId: number): Promise<LandlordGate> {
  const row = await db.longStayLandlordGrant.findUnique({
    where: { userId },
    select: { enabledAt: true, pausedAt: true, pauseReason: true },
  });
  return {
    granted: Boolean(row),
    paused: Boolean(row?.pausedAt),
    pauseReason: row?.pauseReason ?? null,
    enabledAt: row?.enabledAt ?? null,
  };
}

export function landlordGateRefusal(gate: LandlordGate): string | null {
  if (!gate.granted) return "Long stays are not switched on for your account. Ask NoLSAF to switch them on.";
  if (gate.paused) return `Long stays are paused for your account${gate.pauseReason ? `: ${gate.pauseReason}` : ""}. Contact NoLSAF.`;
  return null;
}

// ---------- Terms ----------

const UTILITY = z.enum(["INCLUDED", "TENANT"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Dar es Salaam as YYYY-MM-DD (API hosts run UTC). */
export function todayInEat(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DISCOUNT = z.coerce.number().int().min(1).max(30);
const BILL = z.coerce.number().min(0).max(100_000_000);

export const longStayTermsSchema = z.object({
  monthlyRent: z.coerce.number().positive(),
  currency: z.enum(LONG_STAY_CURRENCIES),
  minTermMonths: z.coerce.number().int().refine((n) => (LONG_STAY_TERM_MONTHS as readonly number[]).includes(n), "Minimum term must be 3, 6 or 12 months."),
  maxTermMonths: z.coerce.number().int().max(LONG_STAY_MAX_TERM_MONTHS).nullable().optional(),
  upfrontMonths: z.coerce.number().int().min(1),
  furnished: z.enum(["FURNISHED", "SEMI", "UNFURNISHED"]),
  utilities: z.object({
    water: UTILITY,
    electricity: UTILITY,
    internet: UTILITY,
    security: UTILITY,
    serviceCharge: UTILITY,
  }).strict(),
  securityDepositMonths: z.coerce.number().int().min(0).max(2),
  noticePeriodDays: z.coerce.number().int().min(14).max(90),
  balanceMethods: z.array(z.enum(["BANK", "MOBILE_MONEY"])).min(1).max(2),
  residencyRules: z.object({
    petsAllowed: z.boolean(),
    maxOccupants: z.coerce.number().int().min(1).max(30),
  }).strict().nullable().optional(),
  availableFrom: z.string().regex(ISO_DAY, "Use a date like 2027-01-01."),
  /** Percent off the monthly rent for leases of 6+ and 12+ months (1 to 30). */
  discounts: z.object({ m6: DISCOUNT.nullable().optional(), m12: DISCOUNT.nullable().optional() }).strict().nullable().optional(),
  /** What the tenant should expect to pay a month for each bill they pay themselves (a guide, never charged). */
  billEstimates: z.object({
    water: BILL.nullable().optional(),
    electricity: BILL.nullable().optional(),
    internet: BILL.nullable().optional(),
    security: BILL.nullable().optional(),
    serviceCharge: BILL.nullable().optional(),
  }).strict().nullable().optional(),
}).strict().superRefine((t, ctx) => {
  if (t.discounts?.m6 && t.discounts?.m12 && t.discounts.m12 < t.discounts.m6) {
    ctx.addIssue({ code: "custom", path: ["discounts"], message: "The 12-month discount cannot be smaller than the 6-month one." });
  }
  if (t.maxTermMonths != null && t.maxTermMonths < t.minTermMonths) {
    ctx.addIssue({ code: "custom", path: ["maxTermMonths"], message: "The longest term cannot be shorter than the minimum term." });
  }
  if (t.upfrontMonths > t.minTermMonths) {
    ctx.addIssue({ code: "custom", path: ["upfrontMonths"], message: "Months paid up front cannot be more than the minimum term." });
  }
  // Rent format and size follow the same rules a tenancy quote uses.
  try {
    computeLongStayQuote({ monthlyRent: t.monthlyRent, termMonths: t.minTermMonths, upfrontMonths: Math.min(t.upfrontMonths, t.minTermMonths), currency: t.currency });
  } catch (error) {
    if (error instanceof LongStayQuoteError) ctx.addIssue({ code: "custom", path: ["monthlyRent"], message: error.message });
    else throw error;
  }
});

export type LongStayTerms = z.infer<typeof longStayTermsSchema>;

/** Parses terms and checks the move-in window against today. */
export function parseLongStayTerms(input: unknown, today = todayInEat()): LongStayTerms {
  const parsed = longStayTermsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new LongStayListingError(issue?.message || "The long-stay terms are not valid.");
  }
  const data = parsed.data;
  // Estimates only make sense for bills the tenant pays; drop the rest and empty values.
  const estimates = Object.fromEntries(Object.entries(data.billEstimates ?? {}).filter(([key, v]) => v != null && v > 0 && (data.utilities as any)[key] === "TENANT"));
  const discounts = { m6: data.discounts?.m6 ?? null, m12: data.discounts?.m12 ?? null };
  const terms = {
    ...data,
    balanceMethods: Array.from(new Set(data.balanceMethods)),
    discounts: discounts.m6 || discounts.m12 ? discounts : null,
    billEstimates: Object.keys(estimates).length ? estimates : null,
  };
  if (terms.availableFrom < today) throw new LongStayListingError("Available from cannot be in the past.");
  if (terms.availableFrom > addDays(today, 365)) throw new LongStayListingError("Available from must be within the next 12 months.");
  return terms;
}

/** Shape stored in long_stay_listing, ready for create/update. */
export function termsToRow(terms: LongStayTerms) {
  return {
    monthlyRent: terms.monthlyRent,
    currency: terms.currency,
    minTermMonths: terms.minTermMonths,
    maxTermMonths: terms.maxTermMonths ?? null,
    upfrontMonths: terms.upfrontMonths,
    furnished: terms.furnished,
    utilities: terms.utilities,
    securityDepositMonths: terms.securityDepositMonths,
    noticePeriodDays: terms.noticePeriodDays,
    balanceMethods: terms.balanceMethods,
    residencyRules: terms.residencyRules ?? null,
    availableFrom: new Date(`${terms.availableFrom}T00:00:00Z`),
    discounts: terms.discounts ?? null,
    billEstimates: terms.billEstimates ?? null,
  };
}

/** The long-stay discount, in percent, a lease of this many months gets (or 0). */
export function discountForTerm(terms: Pick<LongStayTerms, "discounts">, termMonths: number): number {
  const d = terms.discounts;
  if (!d) return 0;
  if (termMonths >= 12) return d.m12 ?? d.m6 ?? 0;
  if (termMonths >= 6) return d.m6 ?? 0;
  return 0;
}

/**
 * The monthly rent a lease of this length pays: the listed rent less its
 * discount, rounded to the currency (TZS whole shillings, USD cents).
 */
export function rentForTerm(terms: Pick<LongStayTerms, "monthlyRent" | "currency" | "discounts">, termMonths: number): number {
  return applyDiscount(terms.monthlyRent, terms.currency, discountForTerm(terms, termMonths));
}

/** A rent less a percent, rounded to the currency's smallest unit. */
export function applyDiscount(monthlyRent: number, currency: string, percent: number): number {
  const scale = String(currency).toUpperCase() === "TZS" ? 1 : 100;
  const minor = Math.round(monthlyRent * scale);
  return Math.round((minor * (100 - Math.max(0, Math.min(30, percent || 0)))) / 100) / scale;
}

/** Public/owner view of a stored row (dates as YYYY-MM-DD, decimals as numbers). */
export function rowToTerms(row: any): LongStayTerms | null {
  if (!row) return null;
  return {
    monthlyRent: Number(row.monthlyRent),
    currency: row.currency,
    minTermMonths: row.minTermMonths,
    maxTermMonths: row.maxTermMonths ?? null,
    upfrontMonths: row.upfrontMonths,
    furnished: row.furnished,
    utilities: row.utilities,
    securityDepositMonths: row.securityDepositMonths,
    noticePeriodDays: row.noticePeriodDays,
    balanceMethods: row.balanceMethods,
    residencyRules: row.residencyRules ?? null,
    availableFrom: new Date(row.availableFrom).toISOString().slice(0, 10),
    discounts: row.discounts ?? null,
    billEstimates: row.billEstimates ?? null,
  } as LongStayTerms;
}

/**
 * What a visitor sees of a long-stay home: the terms and the earliest move-in.
 * Balance methods stay private until a lease is offered.
 */
export function publicLongStayView(row: any, tenancies: Array<{ status: string; endDate: Date | null }>, today = todayInEat()) {
  const terms = rowToTerms(row);
  if (!terms) return null;
  // A reserved or let home is free again the day its tenancy ends.
  const busyUntil = tenancies
    .filter((t) => TENANCY_DATE_HOLD_STATUSES.includes(t.status))
    .map((t) => (t.endDate ? new Date(t.endDate).toISOString().slice(0, 10) : "9999-12-31"))
    .sort()
    .pop();
  const earliest = [terms.availableFrom, today, busyUntil].filter(Boolean).sort().pop() as string;
  const reserved = tenancies.some((t) => RESERVATION_HOLD_STATUSES.includes(t.status));
  return {
    monthlyRent: terms.monthlyRent,
    currency: terms.currency,
    minTermMonths: terms.minTermMonths,
    maxTermMonths: terms.maxTermMonths ?? null,
    upfrontMonths: terms.upfrontMonths,
    furnished: terms.furnished,
    utilities: terms.utilities,
    securityDepositMonths: terms.securityDepositMonths,
    noticePeriodDays: terms.noticePeriodDays,
    residencyRules: terms.residencyRules ?? null,
    discounts: terms.discounts ?? null,
    billEstimates: terms.billEstimates ?? null,
    depositAmount: terms.securityDepositMonths ? rentForTerm(terms, terms.minTermMonths) * terms.securityDepositMonths : 0,
    availableFrom: earliest === "9999-12-31" ? null : earliest,
    availableNow: !reserved && earliest === today,
    reserved,
  };
}

// ---------- Applying a rental mode to a listing ----------

/** Nightly bookings on this home that hold dates from today on (unpaid, confirmed or in house). */
export async function upcomingNightlyBookings(db: any, propertyId: number, now = new Date()): Promise<number> {
  return db.booking.count({ where: { propertyId, status: { in: ["NEW", ...AVAILABILITY_BLOCKING_BOOKING_STATUSES] }, checkOut: { gt: now } } });
}

/** A monthly listing is one whole home: no per-room or multi-unit set-up. */
export function wholeHomeRefusal(roomsSpec: unknown): string | null {
  const rooms = Array.isArray(roomsSpec) ? roomsSpec : [];
  const split = rooms.some((r: any) => String(r?.bookingMode || "").toUpperCase() !== "ENTIRE_UNIT" || String(r?.unitStyle || "").toUpperCase() === "UNIT");
  return split ? "A monthly listing rents the whole home. Replace the room types or units with one whole-home set-up." : null;
}

async function hasOpenTenancy(db: any, propertyId: number): Promise<boolean> {
  const rows: Array<{ status: string }> = await db.tenancy.findMany({ where: { propertyId }, select: { status: true }, take: 200 });
  return rows.some((row) => isTenancyStatus(row.status) && !isTerminalTenancyStatus(row.status));
}

export type RentalModeChange = { rentalMode: RentalMode; terms: LongStayTerms | null };

const HOME_TYPES_ONLY = "Long stays are for houses, apartments, condos, villas, townhouses and bungalows.";

/**
 * Checks a requested rental mode before anything is written, so a refusal
 * leaves the listing untouched. `propertyId` is null on create.
 *
 * `assisted` is true when a sales partner edits on the owner's behalf: long
 * stay is not offered there in v1.
 */
export async function validateRentalMode(db: any, input: {
  propertyId: number | null;
  ownerId: number;
  propertyType: string;
  rentalMode: RentalMode;
  terms: unknown;
  assisted: boolean;
}): Promise<RentalModeChange> {
  if (input.rentalMode === "LONG_STAY") {
    if (input.assisted) throw new LongStayListingError("Long stays cannot be set up on an assisted listing.", 403);
    const refusal = landlordGateRefusal(await landlordGate(db, input.ownerId));
    if (refusal) throw new LongStayListingError(refusal, 403);
    if (!isLongStayPropertyType(input.propertyType)) throw new LongStayListingError(HOME_TYPES_ONLY);
    // An existing nightly home keeps its guests: it can turn monthly only once no nightly stay is still to come.
    if (input.propertyId != null) {
      const upcoming = await upcomingNightlyBookings(db, input.propertyId);
      if (upcoming > 0) {
        throw new LongStayListingError(`This home has ${upcoming} nightly ${upcoming === 1 ? "booking" : "bookings"} still to come. It can turn monthly once ${upcoming === 1 ? "that guest has" : "those guests have"} checked out.`, 409);
      }
    }
    // The landlord may choose monthly before the terms are finished; submit still requires them.
    if (input.terms == null) return { rentalMode: "LONG_STAY", terms: null };
    return { rentalMode: "LONG_STAY", terms: parseLongStayTerms(input.terms) };
  }
  if (input.propertyId != null && (await hasOpenTenancy(db, input.propertyId))) {
    throw new LongStayListingError("This home has an open tenancy, so it stays a long-stay listing until that ends.", 409);
  }
  return { rentalMode: "NIGHTLY", terms: null };
}

/** Writes a change that validateRentalMode accepted. */
export async function writeRentalMode(db: any, propertyId: number, change: RentalModeChange): Promise<void> {
  if (change.rentalMode === "LONG_STAY" && change.terms) {
    const row = termsToRow(change.terms);
    await db.longStayListing.upsert({ where: { propertyId }, create: { propertyId, ...row }, update: row });
  } else if (change.rentalMode === "NIGHTLY") {
    await db.longStayListing.deleteMany({ where: { propertyId } });
  }
  // LONG_STAY without terms: keep any terms already saved, only the mode is set.
  await db.property.update({ where: { id: propertyId }, data: { rentalMode: change.rentalMode } });
}

/** A listing already on long stay may not change to a type that cannot rent long stay. */
export function longStayTypeRefusal(currentMode: string | null | undefined, nextType: string): string | null {
  return currentMode === "LONG_STAY" && !isLongStayPropertyType(nextType) ? HOME_TYPES_ONLY : null;
}

/**
 * Why a LONG_STAY listing cannot be submitted or approved, or null when it
 * can. Re-checks everything: the switch may have been paused since saving.
 */
export async function longStaySubmitRefusal(db: any, property: { id: number; ownerId: number; type: string; rentalMode?: string | null }): Promise<string | null> {
  if (property.rentalMode !== "LONG_STAY") return null;
  const refusal = landlordGateRefusal(await landlordGate(db, property.ownerId));
  if (refusal) return refusal;
  if (!isLongStayPropertyType(property.type)) return HOME_TYPES_ONLY;
  const [row, rooms] = await Promise.all([
    db.longStayListing.findUnique({ where: { propertyId: property.id } }),
    db.property.findUnique({ where: { id: property.id }, select: { roomsSpec: true } }),
  ]);
  if (!row) return "Add the monthly rent and terms before submitting.";
  const split = wholeHomeRefusal(rooms?.roomsSpec);
  if (split) return split;
  try {
    longStayTermsSchema.parse(rowToTerms(row));
  } catch {
    return "The monthly terms are incomplete. Open them and save again.";
  }
  return null;
}

/**
 * Reservation and lease (docs/LONG_STAY_RENTALS.md section 3.3).
 *
 *  - The tenant reserves at the listed terms: a move-in date and a term the
 *    listing allows. No viewing, no haggling: the home was inspected by NoLSAF
 *    and its terms are public. The home must have a current inspection.
 *  - The landlord confirms within 24 hours, or it lapses. Confirming freezes
 *    the money once, on the server, from
 *    the listing and today's rates, and frozen on the tenancy together with
 *    the lease text's inputs and its SHA-256.
 *  - Each side accepts the lease by sending the hash of the text they read.
 *    The tenant must have a verified ID by then. When both have accepted, the
 *    tenant has 48 hours to pay (milestone 6).
 */
import { z } from "zod";
import { computeLongStayQuote, LONG_STAY_MAX_TERM_MONTHS, LongStayQuoteError, longStayOpen } from "./fees.js";
import { buildLease, addMonths, leaseHash, leaseRulesFrom, LEASE_VERSION, type LeaseInput } from "./lease.js";
import { currentLongStayRates, discountForTerm, landlordGate, landlordGateRefusal, rentForTerm, rowToTerms, todayInEat } from "./listing.js";
import { tenantPaymentRefusal } from "./tenantIdentity.js";
import { CONFIRM_WITHIN_HOURS, logEvent, MAX_OPEN_REQUESTS_PER_TENANT, moveTenancy, newTenancyRef, TenancyError } from "./tenancyService.js";
import { isTenancyStatus } from "./tenancyState.js";
import { isLongStayPropertyType } from "./fees.js";
import { inspectionRefusal } from "./inspection.js";

/** Payment is allowed up to 60 days before move-in, so an offer cannot reach further out. */
export const MAX_DAYS_TO_MOVE_IN = 60;
export const PAYMENT_WINDOW_HOURS = 48;
/** Statuses that hold the home for their dates. */
const HOLDS_DATES = ["ACCEPTED", "AWAITING_PAYMENT", "RESERVED", "MOVE_IN", "ACTIVE", "ENDING", "OVERDUE", "DISPUTED"];

export const offerSchema = z.object({
  moveInDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  termMonths: z.coerce.number().int().min(1).max(LONG_STAY_MAX_TERM_MONTHS),
}).strict();
export const leaseAcceptSchema = z.object({ leaseHash: z.string().regex(/^[0-9a-f]{64}$/) }).strict();

function addDays(isoDay: string, days: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const isoDay = (value: Date | string | null | undefined) => (value ? new Date(value).toISOString().slice(0, 10) : null);

async function loadListing(db: any, propertyId: number) {
  const property = await db.property.findUnique({
    where: { id: propertyId },
    select: { id: true, ownerId: true, status: true, rentalMode: true, title: true, district: true, regionName: true, longStayListing: true, services: true },
  });
  const terms = rowToTerms(property?.longStayListing);
  if (!property || property.status !== "APPROVED" || property.rentalMode !== "LONG_STAY" || !terms) {
    throw new TenancyError("This home is no longer offered for long stays.", 409);
  }
  return { property, terms };
}

/** Checks an offer's dates and term against the listing; returns the end date. */
export function checkOfferTerms(terms: { minTermMonths: number; maxTermMonths?: number | null; availableFrom: string }, offer: { moveInDate: string; termMonths: number }, today = todayInEat()) {
  const max = terms.maxTermMonths ?? LONG_STAY_MAX_TERM_MONTHS;
  if (offer.termMonths < terms.minTermMonths) throw new TenancyError(`The minimum stay is ${terms.minTermMonths} months.`);
  if (offer.termMonths > max) throw new TenancyError(`The longest stay offered is ${max} months.`);
  const earliest = [terms.availableFrom, addDays(today, 2)].sort().pop() as string;
  if (offer.moveInDate < earliest) throw new TenancyError(`Choose a move-in date from ${earliest}.`);
  if (offer.moveInDate > addDays(today, MAX_DAYS_TO_MOVE_IN)) throw new TenancyError(`Choose a move-in date within the next ${MAX_DAYS_TO_MOVE_IN} days.`);
  return addMonths(offer.moveInDate, offer.termMonths);
}

async function assertDatesFree(db: any, tenancy: { id: number; propertyId: number }, moveIn: string, end: string) {
  const others = await db.tenancy.findMany({
    where: { propertyId: tenancy.propertyId, id: { not: tenancy.id }, status: { in: HOLDS_DATES } },
    select: { moveInDate: true, endDate: true },
  });
  const clash = others.some((t: any) => {
    const a = isoDay(t.moveInDate);
    const b = isoDay(t.endDate);
    return a && b && a < end && moveIn < b;
  });
  if (clash) throw new TenancyError("These dates overlap another tenancy on this home. Choose a later move-in.", 409);
}

/** What a term of a home would cost, from the listing and today's rates (before reserving). */
export async function quoteForHome(db: any, propertyKey: string, termMonths: number) {
  const property = await db.property.findFirst({ where: { nrmsBookingKey: propertyKey, status: "APPROVED", rentalMode: "LONG_STAY" }, select: { id: true } });
  if (!property) throw new TenancyError("This home is not available for long stays.", 404);
  const { terms } = await loadListing(db, property.id);
  const max = terms.maxTermMonths ?? LONG_STAY_MAX_TERM_MONTHS;
  if (termMonths < terms.minTermMonths || termMonths > max) throw new TenancyError(`Choose a term from ${terms.minTermMonths} to ${max} months.`);
  try {
    const quote = computeLongStayQuote({ monthlyRent: rentForTerm(terms, termMonths), termMonths, upfrontMonths: Math.min(terms.upfrontMonths, termMonths), currency: terms.currency, rates: await currentLongStayRates(db) });
    return { ...quote, listedRent: terms.monthlyRent, discountPercent: discountForTerm(terms, termMonths) };
  } catch (error) {
    if (error instanceof LongStayQuoteError) throw new TenancyError(error.message);
    throw error;
  }
}

/**
 * After a landlord confirms one reservation, others on the same home whose
 * dates now clash are closed. Returns their tenants, to tell them.
 */
export async function cancelClashingReservations(db: any, confirmed: { id: number; propertyId: number; moveInDate: Date | string; endDate: Date | string | null }): Promise<number[]> {
  const a = isoDay(confirmed.moveInDate);
  const b = isoDay(confirmed.endDate);
  if (!a || !b) return [];
  const pending = await db.tenancy.findMany({ where: { propertyId: confirmed.propertyId, id: { not: confirmed.id }, status: "OFFERED" } });
  const closed: number[] = [];
  for (const t of pending) {
    const x = isoDay(t.moveInDate);
    const y = isoDay(t.endDate);
    if (!x || !y || !(x < b && a < y)) continue;
    try {
      await moveTenancy(db, t, "CANCELLED", "SYSTEM", null, { cancelledAt: new Date(), cancelledBy: "SYSTEM", cancelReason: "Another tenant was confirmed for these dates." }, { reason: "DATES_TAKEN" });
      closed.push(t.tenantId);
    } catch {
      // Moved by someone else meanwhile; nothing to do.
    }
  }
  return closed;
}

/** Reservations the landlord did not answer within 24 hours lapse. */
export async function lapseUnansweredReservations(db: any, now = new Date()): Promise<Array<{ tenantId: number; landlordId: number; propertyId: number }>> {
  const cutoff = new Date(now.getTime() - CONFIRM_WITHIN_HOURS * 3_600_000);
  const rows = await db.tenancy.findMany({ where: { status: "OFFERED", offeredAt: { lt: cutoff } }, take: 200 });
  const lapsed: Array<{ tenantId: number; landlordId: number; propertyId: number }> = [];
  for (const t of rows) {
    try {
      await moveTenancy(db, t, "CANCELLED", "SYSTEM", null, { cancelledAt: now, cancelledBy: "SYSTEM", cancelReason: "The landlord did not confirm within 24 hours." }, { reason: "NOT_CONFIRMED" });
      lapsed.push({ tenantId: t.tenantId, landlordId: t.landlordId, propertyId: t.propertyId });
    } catch {
      // Confirmed or closed at the same moment.
    }
  }
  return lapsed;
}

/** The living rules saved on a listing (services.houseRules), as lease sentences. */
export function houseRulesOf(services: unknown): string[] {
  let value: any = services;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return leaseRulesFrom(value && typeof value === "object" ? value.houseRules : null);
}

/** Whether a reservation is past the landlord's 24 hours to confirm. */
export function reservationLapsed(tenancy: { status: string; offeredAt?: Date | string | null }, now = new Date()): boolean {
  return tenancy.status === "OFFERED" && Boolean(tenancy.offeredAt) && now.getTime() - new Date(tenancy.offeredAt!).getTime() > CONFIRM_WITHIN_HOURS * 3_600_000;
}

/**
 * The tenant reserves a home at its listed terms. Creates an OFFERED tenancy
 * for the landlord to confirm within 24 hours. The property is found by its
 * public key only (never a row id), must be an approved long-stay home with a
 * current NoLSAF inspection, and the tenant cannot be its landlord.
 */
export async function createReservation(db: any, input: { tenantId: number; propertyKey: string; moveInDate: string; termMonths: number }, today = todayInEat(), now = new Date()) {
  if (!longStayOpen()) throw new TenancyError("Long stays are not open yet.", 403);
  const property = await db.property.findFirst({
    where: { nrmsBookingKey: input.propertyKey, status: "APPROVED", rentalMode: "LONG_STAY" },
    select: { id: true, ownerId: true, type: true, title: true, longStayListing: true },
  });
  const terms = rowToTerms(property?.longStayListing);
  if (!property || !terms || !isLongStayPropertyType(property.type)) throw new TenancyError("This home is not available for long stays.", 404);
  if (property.ownerId === input.tenantId) throw new TenancyError("You cannot reserve your own home.", 403);
  if (landlordGateRefusal(await landlordGate(db, property.ownerId))) throw new TenancyError("This home is not taking reservations right now.", 409);
  const inspection = await inspectionRefusal(db, property.id, today);
  if (inspection) throw new TenancyError("This home is waiting for its NoLSAF inspection. Try again soon.", 409);

  const end = checkOfferTerms(terms, input, today);
  const [mine, openCount] = await Promise.all([
    db.tenancy.findFirst({ where: { propertyId: property.id, tenantId: input.tenantId, status: { in: ["OFFERED", "ACCEPTED", "AWAITING_PAYMENT"] } }, select: { publicRef: true } }),
    db.tenancy.count({ where: { tenantId: input.tenantId, status: { in: ["OFFERED", "ACCEPTED", "AWAITING_PAYMENT"] } } }),
  ]);
  if (mine) throw new TenancyError("You already reserved this home. Open it in your long stays.", 409);
  if (openCount >= MAX_OPEN_REQUESTS_PER_TENANT) throw new TenancyError(`You can hold ${MAX_OPEN_REQUESTS_PER_TENANT} reservations at a time. Close one first.`, 429);
  await assertDatesFree(db, { id: 0, propertyId: property.id }, input.moveInDate, end);

  const tenancy = await db.tenancy.create({
    data: {
      publicRef: newTenancyRef(),
      propertyId: property.id,
      landlordId: property.ownerId,
      tenantId: input.tenantId,
      status: "OFFERED",
      currency: terms.currency,
      moveInDate: new Date(`${input.moveInDate}T00:00:00Z`),
      termMonths: input.termMonths,
      endDate: new Date(`${end}T00:00:00Z`),
      offeredAt: now,
    },
  });
  await logEvent(db, tenancy.id, input.tenantId, "TENANT", "RESERVATION_REQUESTED", { toStatus: "OFFERED", data: { moveInDate: input.moveInDate, termMonths: input.termMonths } });
  return { tenancy, property };
}

/**
 * Landlord accepts: freeze the money and the lease. Everything is checked
 * again because the listing, the landlord's switch and other tenancies may
 * have changed since the offer.
 */
export async function acceptOffer(db: any, tenancy: any, landlordId: number, today = todayInEat()) {
  if (!longStayOpen()) throw new TenancyError("Long stays are not open yet.", 403);
  if (tenancy.status !== "OFFERED" || !tenancy.moveInDate || !tenancy.termMonths) throw new TenancyError("There is no reservation to confirm.", 409);
  if (reservationLapsed(tenancy)) throw new TenancyError("The 24 hours to confirm this reservation have passed.", 409);
  const refusal = landlordGateRefusal(await landlordGate(db, landlordId));
  if (refusal) throw new TenancyError(refusal, 403);
  const { property, terms } = await loadListing(db, tenancy.propertyId);
  const inspection = await inspectionRefusal(db, tenancy.propertyId, today);
  if (inspection) throw new TenancyError(inspection, 409);
  const moveIn = isoDay(tenancy.moveInDate)!;
  const end = checkOfferTerms(terms, { moveInDate: moveIn, termMonths: tenancy.termMonths }, today);
  await assertDatesFree(db, tenancy, moveIn, end);

  const rates = await currentLongStayRates(db);
  const upfront = Math.min(terms.upfrontMonths, tenancy.termMonths);
  let quote;
  try {
    // A longer lease gets the listing's discount, frozen into the money and the lease here.
    quote = computeLongStayQuote({ monthlyRent: rentForTerm(terms, tenancy.termMonths), termMonths: tenancy.termMonths, upfrontMonths: upfront, currency: terms.currency, rates });
  } catch (error) {
    if (error instanceof LongStayQuoteError) throw new TenancyError(error.message);
    throw error;
  }

  const [tenant, landlord] = await Promise.all([
    db.user.findUnique({ where: { id: tenancy.tenantId }, select: { fullName: true, name: true } }),
    db.user.findUnique({ where: { id: landlordId }, select: { fullName: true, name: true } }),
  ]);
  const leaseInput: LeaseInput = {
    tenancyRef: tenancy.publicRef,
    tenantName: tenant?.fullName || tenant?.name || "The Tenant",
    landlordName: landlord?.fullName || landlord?.name || "The Landlord",
    homeTitle: property.title,
    homeArea: [property.district, property.regionName].filter(Boolean).join(", "),
    moveInDate: moveIn,
    endDate: end,
    termMonths: tenancy.termMonths,
    upfrontMonths: upfront,
    currency: quote.currency,
    monthlyRent: quote.monthlyRent,
    firstMonthViaNolsaf: quote.monthlyRent,
    tenantFee: quote.tenantFee,
    balanceDue: quote.balanceDue,
    securityDepositMonths: terms.securityDepositMonths,
    noticePeriodDays: terms.noticePeriodDays,
    furnished: terms.furnished,
    utilities: terms.utilities,
    balanceMethods: terms.balanceMethods,
    petsAllowed: terms.residencyRules?.petsAllowed ?? null,
    maxOccupants: terms.residencyRules?.maxOccupants ?? null,
    ...(discountForTerm(terms, tenancy.termMonths) ? { listedRent: terms.monthlyRent, discountPercent: discountForTerm(terms, tenancy.termMonths) } : {}),
    ...(houseRulesOf(property.services).length ? { houseRules: houseRulesOf(property.services) } : {}),
  };
  const text = buildLease(leaseInput);

  await moveTenancy(db, tenancy, "ACCEPTED", "LANDLORD", landlordId, {
    offerAcceptedAt: new Date(),
    endDate: new Date(`${end}T00:00:00Z`),
    currency: quote.currency,
    monthlyRent: quote.monthlyRent,
    upfrontMonths: upfront,
    landlordPercent: rates.landlordPercent,
    tenantPercent: rates.tenantPercent,
    landlordCapMonths: rates.landlordCapMonths,
    tenantCapMonths: rates.tenantCapMonths,
    tenantFee: quote.tenantFee,
    landlordCommission: quote.landlordCommission,
    bookingAmount: quote.bookingAmount,
    balanceDue: quote.balanceDue,
    termsSnapshot: { listing: terms, lease: leaseInput, landlordPayout: quote.landlordPayout },
    leaseVersion: LEASE_VERSION,
    leaseHash: leaseHash(text),
    tenantLeaseAcceptedAt: null,
    landlordLeaseAcceptedAt: null,
  }, { leaseVersion: LEASE_VERSION });
  return { leaseHash: leaseHash(text) };
}

/** The lease text of an accepted offer, rebuilt from its frozen inputs and checked against the stored hash. */
export function leaseTextOf(tenancy: any): string | null {
  const input = (tenancy?.termsSnapshot as any)?.lease as LeaseInput | undefined;
  if (!input || !tenancy.leaseHash) return null;
  const text = buildLease(input);
  // A wording change in code must never silently change a lease someone accepted.
  if (leaseHash(text) !== tenancy.leaseHash) return null;
  return text;
}

/**
 * One side accepts the exact lease text (by hash). When both have, the tenant
 * gets 48 hours to pay. Compare-and-set on status, version and hash.
 */
export async function acceptLease(db: any, tenancy: any, side: "TENANT" | "LANDLORD", userId: number, hash: string, now = new Date()) {
  if (tenancy.status !== "ACCEPTED") throw new TenancyError("There is no lease waiting to be accepted.", 409);
  if (!tenancy.leaseHash || hash !== tenancy.leaseHash || !leaseTextOf(tenancy)) {
    throw new TenancyError("The lease changed. Reload it, read it again, then accept.", 409);
  }
  if (side === "TENANT") {
    const profile = await db.longStayTenantProfile.findUnique({ where: { userId } });
    const refusal = tenantPaymentRefusal(profile, tenancy.endDate, now);
    if (refusal) throw new TenancyError(`${refusal} You can accept the lease once your ID is in order.`, 409);
  } else {
    const refusal = landlordGateRefusal(await landlordGate(db, userId));
    if (refusal) throw new TenancyError(refusal, 403);
  }
  const field = side === "TENANT" ? "tenantLeaseAcceptedAt" : "landlordLeaseAcceptedAt";
  if (tenancy[field]) throw new TenancyError("You already accepted this lease.", 409);

  const result = await db.tenancy.updateMany({
    where: { id: tenancy.id, status: "ACCEPTED", version: tenancy.version, leaseHash: hash },
    data: { [field]: now, version: { increment: 1 } },
  });
  if (result.count !== 1) throw new TenancyError("This lease changed a moment ago. Refresh and try again.", 409);
  await db.tenancyEvent.create({ data: { tenancyId: tenancy.id, actorId: userId, actorRole: side, type: "LEASE_ACCEPTED", data: { leaseHash: hash, leaseVersion: tenancy.leaseVersion } } });

  const fresh = await db.tenancy.findUnique({ where: { id: tenancy.id } });
  if (fresh && isTenancyStatus(fresh.status) && fresh.status === "ACCEPTED" && fresh.tenantLeaseAcceptedAt && fresh.landlordLeaseAcceptedAt) {
    await moveTenancy(db, fresh, "AWAITING_PAYMENT", "SYSTEM", null, { paymentDueAt: new Date(now.getTime() + PAYMENT_WINDOW_HOURS * 3_600_000) });
    return { bothAccepted: true };
  }
  return { bothAccepted: false };
}

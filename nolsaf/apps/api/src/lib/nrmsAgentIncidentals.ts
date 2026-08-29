// One reading of the agency's incidental declaration, shared by the agent
// portal, the hotel's review screen and the front desk. Three surfaces writing
// their own sentence is how a hotel ends up honouring a cover the agency never
// agreed to.

import { CHARGE_CATEGORIES, type ChargeCategory } from "./nrmsFolio.js";

export const INCIDENTAL_CAP_BASIS_LABELS: Record<string, string> = {
  PER_TRAVELLER_PER_NIGHT: "per traveller per night",
  PER_TRAVELLER_STAY: "per traveller for the stay",
  BOOKING_TOTAL: "for the whole booking",
};

const CATEGORY_LABELS: Record<ChargeCategory, string> = {
  RESTAURANT: "Restaurant",
  BAR: "Bar",
  LAUNDRY: "Laundry",
  MINIBAR: "Minibar",
  ROOM_SERVICE: "Room service",
  TRANSPORT: "Transport",
  DAMAGE: "Damage",
  OTHER: "Other",
};

/** Nights between two dates, floored at one. */
function nightsBetween(checkIn: Date | string, checkOut: Date | string): number {
  const start = new Date(checkIn).getTime();
  const end = new Date(checkOut).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

/**
 * Does the agency's declaration actually cover this charge?
 *
 * A block that came from an agent booking carries the agency's own terms:
 * which categories it absorbs, and how much. Routing every extra onto the
 * agency bill because the billing mode says MASTER would hand the agency a bill
 * it never agreed to, so this is the gate in front of that routing.
 *
 * A charge outside the cover is not rejected. It simply stays on the
 * traveller's folio, which is where an uncovered extra belongs.
 */
export async function agentCoverDecision(
  tx: any,
  folioId: number,
  charge: { reservationId?: number | null; category?: string | null; amount: unknown },
): Promise<{ route: boolean; reason: string }> {
  const folio = await tx.nrmsMasterFolio.findUnique({
    where: { id: folioId },
    select: { id: true, agentBookingRequestId: true },
  });
  // An ordinary group block has no agency declaration to honour: its billing
  // mode is the whole rule, exactly as before.
  if (!folio?.agentBookingRequestId) return { route: true, reason: "GROUP_BILLING_MODE" };

  const request = await tx.nrmsAgentBookingRequest.findUnique({
    where: { id: folio.agentBookingRequestId },
    select: {
      incidentalBilling: true, incidentalScope: true, incidentalCategories: true,
      incidentalCapAmount: true, incidentalCapBasis: true,
      adults: true, children: true, checkIn: true, checkOut: true,
    },
  });
  if (!request) return { route: true, reason: "REQUEST_MISSING" };
  if (request.incidentalBilling !== "AGENCY") return { route: false, reason: "GUESTS_SETTLE_EXTRAS" };

  const cover = describeIncidentalCover(request);
  if (cover.scope === "SELECTED") {
    const category = String(charge.category || "").trim().toUpperCase();
    if (!cover.categories.includes(category as ChargeCategory)) return { route: false, reason: "CATEGORY_NOT_COVERED" };
  }

  if (cover.capAmount == null) return { route: true, reason: "COVERED" };

  const perStayBasis = cover.capBasis === "PER_TRAVELLER_PER_NIGHT" || cover.capBasis === "PER_TRAVELLER_STAY";
  if (perStayBasis && !charge.reservationId) return { route: false, reason: "STAY_REQUIRED_FOR_COVER_LIMIT" };
  const stay = perStayBasis
    ? await tx.reservation.findUnique({
        where: { id: charge.reservationId },
        select: { adults: true, children: true },
      })
    : null;
  const travellers = perStayBasis
    ? Math.max(1, Number(stay?.adults ?? 0) + Number(stay?.children ?? 0))
    : Math.max(1, Number(request.adults ?? 0) + Number(request.children ?? 0));
  const nights = nightsBetween(request.checkIn, request.checkOut);
  const ceiling = cover.capBasis === "PER_TRAVELLER_PER_NIGHT"
    ? cover.capAmount * travellers * nights
    : cover.capBasis === "PER_TRAVELLER_STAY"
      ? cover.capAmount * travellers
      : cover.capAmount;

  // Only extras count against the cover. The room was invoiced separately and
  // is not what the agency capped.
  const routed = await tx.nrmsMasterFolioItem.findMany({
    where: {
      masterFolioId: folio.id,
      kind: "EXTRA",
      voidedAt: null,
      ...(perStayBasis ? { reservationId: charge.reservationId } : {}),
    },
    select: { amount: true },
  });
  const already = routed.reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0);
  const amount = Number(charge.amount ?? 0);
  // A charge is never split down the middle: the part over the ceiling would be
  // an invented line item on somebody's bill. The whole charge stays with the
  // traveller once the cover is used up.
  if (already + amount > ceiling + 0.005) return { route: false, reason: "COVER_LIMIT_REACHED" };
  return { route: true, reason: "COVERED" };
}

export type IncidentalCover = {
  billing: "AGENCY" | "INDIVIDUAL_GUEST" | null;
  scope: "ALL" | "SELECTED" | null;
  categories: ChargeCategory[];
  capAmount: number | null;
  capBasis: string | null;
  /** Short line for a tile or a table cell. */
  headline: string;
  /** The full declaration in one sentence, for the desk to act on. */
  detail: string;
};

function readCategories(value: unknown): ChargeCategory[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(CHARGE_CATEGORIES);
  return value
    .map((entry) => String(entry ?? "").trim().toUpperCase())
    .filter((entry): entry is ChargeCategory => allowed.has(entry));
}

/**
 * Reads the declaration off an agent booking request. A row written before the
 * cover columns existed carries an AGENCY billing with no scope, which has
 * always meant every extra, so it is reported that way rather than as unknown.
 */
export function describeIncidentalCover(request: any): IncidentalCover {
  const billing = request?.incidentalBilling === "AGENCY" || request?.incidentalBilling === "INDIVIDUAL_GUEST"
    ? request.incidentalBilling
    : null;
  const categories = readCategories(request?.incidentalCategories);
  const capAmountRaw = request?.incidentalCapAmount;
  const capAmount = capAmountRaw == null ? null : Number(capAmountRaw);
  const capBasis = capAmount == null ? null : (request?.incidentalCapBasis ?? null);

  if (billing !== "AGENCY") {
    return {
      billing,
      scope: null,
      categories: [],
      capAmount: null,
      capBasis: null,
      headline: "Guests settle individually",
      detail: "Each traveller settles their own food, drinks and hotel services directly.",
    };
  }

  const scope: "ALL" | "SELECTED" = request?.incidentalScope === "SELECTED" ? "SELECTED" : "ALL";
  const covered = scope === "SELECTED"
    ? categories.map((category) => CATEGORY_LABELS[category]).join(", ")
    : "every extra the hotel sells";
  const limit = capAmount != null && Number.isFinite(capAmount)
    ? `, up to ${Math.round(capAmount).toLocaleString()} ${INCIDENTAL_CAP_BASIS_LABELS[String(capBasis)] ?? "per booking"}`
    : "";

  return {
    billing,
    scope,
    categories: scope === "SELECTED" ? categories : [],
    capAmount: capAmount != null && Number.isFinite(capAmount) ? capAmount : null,
    capBasis,
    headline: scope === "ALL" && capAmount == null ? "Agency covers everything" : "Agency covers part",
    detail: scope === "SELECTED" && categories.length === 0
      ? "The agency covers extras, but named no category. Treat extras as the traveller's own bill until the agency confirms."
      : `The agency settles ${covered}${limit}. Anything outside that is the traveller's own bill.`,
  };
}

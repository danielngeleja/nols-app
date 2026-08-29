/**
 * NRMS Agent B2B — rate resolution.
 *
 * Resolves, for one NrmsAgentPropertyLink (an agency's approved relationship
 * with ONE hotel), which rate plans + room types that agent may sell and what
 * the negotiated nightly price is. Prices ride the shared nrmsRateMath so an
 * agent quote matches the hotel's own rate plans exactly.
 *
 * Scope rule: everything here is keyed by linkId. A link belongs to exactly one
 * (agency x property), so resolving by linkId can never leak hotel Y's rates to
 * an agency's hotel X context. Callers must pass a link the requester owns.
 */

import { computeNightlyRates, money, nightsBetween, stayDates } from "./nrmsRateMath.js";

/** Minimal Prisma surface — real client or a test double. */
type Db = {
  nrmsAgentRateAccess: { findMany: (args: any) => Promise<any[]> };
  roomType: { findMany: (args: any) => Promise<any[]> };
  nrmsRatePlan: { findMany: (args: any) => Promise<any[]> };
};

/**
 * Currencies that have at least one active, priced room type and one active
 * rate plan that can actually apply to that room. This is deliberately stricter
 * than taking the union of the two tables: a USD plan scoped to a TZS room does
 * not make USD sellable.
 */
export async function getPropertyAgentCurrencies(db: Db, propertyId: number): Promise<string[]> {
  const [roomTypes, plans] = await Promise.all([
    db.roomType.findMany({
      where: { propertyId, status: "ACTIVE", baseRate: { not: null } },
      select: { id: true, currency: true },
    }),
    db.nrmsRatePlan.findMany({
      where: { propertyId, status: "ACTIVE" },
      select: { roomTypeId: true, currency: true },
    }),
  ]);

  const supported = new Set<string>();
  for (const roomType of roomTypes) {
    const roomCurrency = String(roomType.currency || "").toUpperCase();
    if (!roomCurrency) continue;
    const hasCompatiblePlan = plans.some((plan) =>
      String(plan.currency || "").toUpperCase() === roomCurrency &&
      (plan.roomTypeId == null || plan.roomTypeId === roomType.id),
    );
    if (hasCompatiblePlan) supported.add(roomCurrency);
  }
  return Array.from(supported).sort();
}

export type AgentRoomQuote = {
  roomType: { id: number; name: string; capacityAdults: number; capacityChildren: number };
  ratePlan: { id: number; name: string; refundable: boolean; mealPlan: string };
  currency: string;
  nightly: Array<{ date: string; rate: number }>;
  subtotal: number;
  tax: number;
  fees: number;
  total: number;
};

export type AgentRateQuoteInput = {
  linkId: number;
  propertyId: number;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  /** Commercial currency frozen on the agency x hotel link. No FX conversion is implicit. */
  currency?: string;
  /** Optional: restrict to a single room type (e.g. the one the agent is booking). */
  roomTypeId?: number;
};

const jsonObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : {};

/**
 * The (ratePlanId, roomTypeId?) pairs this agent may sell at this hotel.
 * A roomTypeId of null means the grant applies to every room type the plan covers.
 */
export async function getAgentRateAccess(db: Db, linkId: number): Promise<Array<{ ratePlanId: number; roomTypeId: number | null }>> {
  const rows = await db.nrmsAgentRateAccess.findMany({
    where: { linkId },
    select: { ratePlanId: true, roomTypeId: true },
  });
  return rows.map((r) => ({ ratePlanId: r.ratePlanId, roomTypeId: r.roomTypeId ?? null }));
}

/** Is this (ratePlanId, roomTypeId) sellable by the agent given its access grants? */
function accessAllows(
  access: Array<{ ratePlanId: number; roomTypeId: number | null }>,
  ratePlanId: number,
  roomTypeId: number,
): boolean {
  return access.some((a) => a.ratePlanId === ratePlanId && (a.roomTypeId == null || a.roomTypeId === roomTypeId));
}

/**
 * Build negotiated quotes for every room type the agent may sell over the given
 * dates. Pricing only — availability, restrictions and holds are enforced by the
 * booking path, not here. Returns an empty list when the agent has no rate access.
 */
export async function quoteAgentRates(db: Db, input: AgentRateQuoteInput): Promise<AgentRoomQuote[]> {
  const stayNights = nightsBetween(input.checkIn, input.checkOut);
  if (stayNights < 1 || stayNights > 365) return [];

  const access = await getAgentRateAccess(db, input.linkId);
  if (access.length === 0) return [];

  const allowedRatePlanIds = Array.from(new Set(access.map((a) => a.ratePlanId)));
  const nights = stayDates(input.checkIn, stayNights);

  const roomTypes = await db.roomType.findMany({
    where: {
      propertyId: input.propertyId,
      status: "ACTIVE",
      baseRate: { not: null },
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.roomTypeId ? { id: input.roomTypeId } : {}),
    },
    orderBy: { sortOrder: "asc" },
  });
  if (roomTypes.length === 0) return [];

  // Only the plans the agent has been granted, with seasons pre-filtered to the
  // stay window and sorted so the highest-priority season wins per night.
  const plans = await db.nrmsRatePlan.findMany({
    where: {
      id: { in: allowedRatePlanIds },
      propertyId: input.propertyId,
      status: "ACTIVE",
      ...(input.currency ? { currency: input.currency } : {}),
    },
    include: {
      seasons: {
        where: { status: "ACTIVE", startDate: { lte: input.checkOut }, endDate: { gte: input.checkIn } },
        orderBy: { priority: "desc" },
      },
    },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });

  const quotes: AgentRoomQuote[] = [];
  for (const roomType of roomTypes) {
    if (input.adults > roomType.capacityAdults || input.children > roomType.capacityChildren) continue;

    // A plan applies to this room type when it is either room-type-scoped to it
    // or global (roomTypeId null), AND the agent's access grant permits the pair.
    const plan = plans.find(
      (p) => (p.roomTypeId == null || p.roomTypeId === roomType.id) && accessAllows(access, p.id, roomType.id),
    );
    if (!plan) continue;

    // Advance-window / stay-length gates the hotel set on the plan still apply.
    if (
      stayNights < (plan.defaultMinStay ?? 1) ||
      (plan.defaultMaxStay != null && stayNights > plan.defaultMaxStay)
    ) {
      continue;
    }

    const today = new Date();
    const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const advanceDays = Math.floor((Date.UTC(input.checkIn.getUTCFullYear(), input.checkIn.getUTCMonth(), input.checkIn.getUTCDate()) - utcToday) / 86_400_000);
    if (
      (plan.minAdvanceDays != null && advanceDays < plan.minAdvanceDays) ||
      (plan.maxAdvanceDays != null && advanceDays > plan.maxAdvanceDays)
    ) {
      continue;
    }

    const { nightly, subtotal } = computeNightlyRates(Number(roomType.baseRate), plan, nights);

    const taxPolicy = jsonObject(plan.taxPolicy);
    const feePolicy = jsonObject(plan.feePolicy);
    const tax = money((subtotal * Math.max(0, Number(taxPolicy.percent || 0))) / 100);
    const fees = money(Number(feePolicy.fixed || 0));
    const total = money(subtotal + tax + fees);

    quotes.push({
      roomType: {
        id: roomType.id,
        name: roomType.name,
        capacityAdults: roomType.capacityAdults,
        capacityChildren: roomType.capacityChildren,
      },
      ratePlan: { id: plan.id, name: plan.name, refundable: plan.refundable, mealPlan: plan.mealPlan },
      currency: input.currency || plan.currency || roomType.currency,
      nightly,
      subtotal,
      tax,
      fees,
      total,
    });
  }
  return quotes;
}

/**
 * Resolve the negotiated quote for a single room type the agent is booking.
 * Returns null when the agent may not sell that room type (no matching grant),
 * which the booking path should treat as a hard stop.
 */
export async function quoteAgentRoom(
  db: Db,
  input: AgentRateQuoteInput & { roomTypeId: number },
): Promise<AgentRoomQuote | null> {
  const quotes = await quoteAgentRates(db, input);
  return quotes.find((q) => q.roomType.id === input.roomTypeId) ?? null;
}

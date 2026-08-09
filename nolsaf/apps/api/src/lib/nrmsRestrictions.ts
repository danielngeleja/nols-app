/**
 * Rate restriction evaluation, shared by every path that can sell a room.
 *
 * A restriction used to be read in exactly one place, the property's own
 * direct booking engine, which meant a stop sell set in Hotel controls closed
 * the direct page while the same room stayed on sale on the NoLSAF
 * marketplace. An owner ticking "stop sell" means stop selling, so the rule is
 * evaluated here once and applied by both.
 *
 * Scope rules, unchanged from the direct engine:
 *   - roomTypeId NULL means the whole property, otherwise that one room type
 *   - ratePlanId NULL means every plan, otherwise that one plan
 *   - a rule bites when ANY night of the stay falls inside [startDate, endDate]
 *     and that weekday is in daysOfWeek (empty means every day)
 *   - channelCode NULL means every channel, otherwise only that one
 *
 * Nights are checkIn .. checkOut-1: the departure day is not a night, so a
 * rule starting on the checkout date does not block the stay.
 */

import { prisma } from "@nolsaf/prisma";

type DbLike = typeof prisma | any;

export type RestrictionBlockCode =
  | "STOP_SELL"
  | "CLOSED_TO_ARRIVAL"
  | "CLOSED_TO_DEPARTURE"
  | "MIN_STAY"
  | "MAX_STAY"
  | "MIN_ADVANCE"
  | "MAX_ADVANCE";

export interface RestrictionBlock {
  restrictionId: number;
  name: string;
  code: RestrictionBlockCode;
  /** Guest-facing. Says what is closed and never why the owner closed it. */
  message: string;
}

export interface RestrictionQuery {
  propertyId: number;
  /** NULL evaluates property-wide rules only, which is the safe answer when a room code cannot be mapped. */
  roomTypeId?: number | null;
  ratePlanId?: number | null;
  checkIn: Date;
  checkOut: Date;
  /** DIRECT for the property's own page, NOLSAF for the marketplace. Rules with no channel apply to both. */
  channelCode?: string | null;
}

/** Empty or missing daysOfWeek means every day. Days are UTC, matching how the dates are stored. */
export function appliesOnDay(daysOfWeek: unknown, date: Date): boolean {
  return !Array.isArray(daysOfWeek) || daysOfWeek.length === 0 || daysOfWeek.map(Number).includes(date.getUTCDay());
}

function nightsBetween(checkIn: Date, checkOut: Date): Date[] {
  const count = Math.max(0, Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000));
  return Array.from({ length: count }, (_, offset) => new Date(checkIn.getTime() + offset * 86400000));
}

/**
 * Marketplace bookings carry a roomCode string rather than a room type id, so
 * the code is resolved back to a room type before room-type rules can apply.
 * A code that resolves to nothing returns null, and the caller then evaluates
 * property-wide rules only rather than silently skipping every rule.
 */
export async function resolveRoomTypeIdForCode(db: DbLike, propertyId: number, roomCode: string | null | undefined): Promise<number | null> {
  const code = String(roomCode ?? "").trim();
  if (!code) return null;

  const unit = await db.roomUnit.findFirst({ where: { propertyId, code }, select: { roomTypeId: true } });
  if (unit) return unit.roomTypeId;

  // "Deluxe-2" is unit 2 of the Deluxe type: strip the trailing index.
  const typeKey = code.replace(/-\d+$/, "") || code;
  const type = await db.roomType.findFirst({
    where: { propertyId, OR: [{ name: typeKey }, { sourceSpecKey: typeKey }] },
    select: { id: true },
  });
  return type?.id ?? null;
}

function blockMessage(code: RestrictionBlockCode, rule: any): string {
  switch (code) {
    case "STOP_SELL":
      return "These dates are closed for this room. Please choose different dates or another room.";
    case "CLOSED_TO_ARRIVAL":
      return "Arrivals are not accepted on this date. Please choose a different check-in date.";
    case "CLOSED_TO_DEPARTURE":
      return "Departures are not accepted on this date. Please choose a different check-out date.";
    case "MIN_STAY":
      return `These dates require a minimum stay of ${rule.minStay} night(s).`;
    case "MAX_STAY":
      return `These dates allow a maximum stay of ${rule.maxStay} night(s).`;
    case "MIN_ADVANCE":
      return `This room must be booked at least ${rule.minAdvanceDays} day(s) in advance.`;
    default:
      return `This room cannot be booked more than ${rule.maxAdvanceDays} day(s) in advance.`;
  }
}

/**
 * Every restriction blocking this stay, strongest first. An empty array means
 * nothing stands in the way. Returns all of them rather than the first, so a
 * caller can log the full picture even while showing only the first message.
 */
export async function findRestrictionBlocks(db: DbLike, query: RestrictionQuery): Promise<RestrictionBlock[]> {
  const rules = await db.nrmsRateRestriction.findMany({
    where: {
      propertyId: query.propertyId,
      status: "ACTIVE",
      startDate: { lte: query.checkOut },
      endDate: { gte: query.checkIn },
      AND: [
        { OR: [{ roomTypeId: null }, ...(query.roomTypeId ? [{ roomTypeId: query.roomTypeId }] : [])] },
        { OR: [{ ratePlanId: null }, ...(query.ratePlanId ? [{ ratePlanId: query.ratePlanId }] : [])] },
        { OR: [{ channelCode: null }, ...(query.channelCode ? [{ channelCode: query.channelCode }] : [])] },
      ],
    },
  });
  return evaluateRestrictionRules(rules, query);
}

/**
 * The same evaluation over rules already in hand. The direct booking engine
 * loads every rule for the property once and then quotes several room types
 * against it, so it calls this rather than paying for one query per room type.
 * Rules are re-filtered by scope here, because a caller's set is usually wider
 * than any single room type it is being applied to.
 */
export function evaluateRestrictionRules(rules: any[], query: RestrictionQuery): RestrictionBlock[] {
  const nights = nightsBetween(query.checkIn, query.checkOut);
  if (nights.length === 0) return [];

  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  const advanceDays = Math.floor((query.checkIn.getTime() - today.getTime()) / 86400000);

  const blocks: RestrictionBlock[] = [];
  for (const rule of rules) {
    if (rule.roomTypeId != null && rule.roomTypeId !== query.roomTypeId) continue;
    if (rule.ratePlanId != null && rule.ratePlanId !== query.ratePlanId) continue;
    if (rule.channelCode != null && query.channelCode != null && rule.channelCode !== query.channelCode) continue;
    const bites = nights.some((night) => night >= rule.startDate && night <= rule.endDate && appliesOnDay(rule.daysOfWeek, night));
    if (!bites) continue;

    const push = (code: RestrictionBlockCode) =>
      blocks.push({ restrictionId: rule.id, name: rule.name, code, message: blockMessage(code, rule) });

    if (rule.stopSell) push("STOP_SELL");
    if (rule.closedToArrival && query.checkIn >= rule.startDate && query.checkIn <= rule.endDate && appliesOnDay(rule.daysOfWeek, query.checkIn)) {
      push("CLOSED_TO_ARRIVAL");
    }
    if (rule.closedToDeparture && query.checkOut >= rule.startDate && query.checkOut <= rule.endDate && appliesOnDay(rule.daysOfWeek, query.checkOut)) {
      push("CLOSED_TO_DEPARTURE");
    }
    if (rule.minStay && nights.length < rule.minStay) push("MIN_STAY");
    if (rule.maxStay && nights.length > rule.maxStay) push("MAX_STAY");
    if (rule.minAdvanceDays != null && advanceDays < rule.minAdvanceDays) push("MIN_ADVANCE");
    if (rule.maxAdvanceDays != null && advanceDays > rule.maxAdvanceDays) push("MAX_ADVANCE");
  }

  // Stop sell first: it is the hardest close and the one worth reporting.
  return blocks.sort((a, b) => (a.code === "STOP_SELL" ? -1 : b.code === "STOP_SELL" ? 1 : 0));
}

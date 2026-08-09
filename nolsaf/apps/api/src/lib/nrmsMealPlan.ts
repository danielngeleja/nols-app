/**
 * Meal plan resolution for room allocations.
 *
 * Breakfast is a rate-plan inclusion, so the plan a room was sold on is what
 * decides whether its guest eats. Every path that creates a
 * ReservationRoomAllocation resolves it through here, so front desk, the
 * NoLSAF marketplace and each OTA sync all record entitlement the same way.
 *
 * The meal plan is copied onto the allocation as a snapshot rather than read
 * back through the rate plan at report time. Editing a plan in March must not
 * rewrite what a January guest was entitled to, which is the same rule
 * Reservation already applies to its price fields.
 */

import { prisma } from "@nolsaf/prisma";
import type { Prisma } from "@prisma/client";

export const MEAL_PLANS = ["ROOM_ONLY", "BREAKFAST", "HALF_BOARD", "FULL_BOARD", "ALL_INCLUSIVE"] as const;
export type MealPlan = (typeof MEAL_PLANS)[number];

/** Plans whose guests are entitled to breakfast. Half and full board include it. */
const BREAKFAST_PLANS = new Set<string>(["BREAKFAST", "HALF_BOARD", "FULL_BOARD", "ALL_INCLUSIVE"]);

export function includesBreakfast(mealPlan: string | null | undefined): boolean {
  return !!mealPlan && BREAKFAST_PLANS.has(mealPlan);
}

export function mealPlanLabel(mealPlan: string | null | undefined): string {
  switch (mealPlan) {
    case "ROOM_ONLY": return "Room only";
    case "BREAKFAST": return "Bed & breakfast";
    case "HALF_BOARD": return "Half board";
    case "FULL_BOARD": return "Full board";
    case "ALL_INCLUSIVE": return "All inclusive";
    // Not "no breakfast": an unknown plan is a question for the desk, not a
    // refusal at the buffet.
    default: return "Verify";
  }
}

export interface ResolvedMealPlan {
  ratePlanId: number | null;
  mealPlan: string | null;
}

/**
 * The plan to record against one allocated room.
 *
 * Resolution order, which is what a PMS does when a booking arrives without a
 * usable rate code:
 *   1. the plan explicitly chosen at booking, when it belongs to this property
 *   2. the property's default active plan for that room type
 *   3. the property's default active plan covering all room types
 *
 * Returns nulls rather than guessing when none of those exist. A NULL prints
 * as "verify" on the breakfast list, which is a question staff can answer,
 * unlike a wrong plan asserted silently.
 */
export async function resolveAllocationMealPlan(
  client: Prisma.TransactionClient | typeof prisma,
  params: { propertyId: number; roomTypeId: number; ratePlanId?: number | null }
): Promise<ResolvedMealPlan> {
  const db = client as Prisma.TransactionClient;

  if (params.ratePlanId) {
    const chosen = await db.nrmsRatePlan.findFirst({
      where: { id: params.ratePlanId, propertyId: params.propertyId },
      select: { id: true, mealPlan: true },
    });
    if (chosen) return { ratePlanId: chosen.id, mealPlan: chosen.mealPlan };
  }

  const fallback = await db.nrmsRatePlan.findFirst({
    where: {
      propertyId: params.propertyId,
      status: "ACTIVE",
      isDefault: true,
      // A plan scoped to this room type, or the property-wide one.
      OR: [{ roomTypeId: params.roomTypeId }, { roomTypeId: null }],
    },
    // Room-type specific wins over the property-wide default: MySQL sorts
    // NULLs last on a descending order, which puts the scoped plan first.
    orderBy: [{ roomTypeId: "desc" }, { id: "asc" }],
    select: { id: true, mealPlan: true },
  });
  if (!fallback) return { ratePlanId: null, mealPlan: null };

  // ratePlanId stays NULL even though a plan was found: the entitlement was
  // inferred from a default, not sold. Keeping the link empty is what makes an
  // inferred meal plan readable later instead of looking like a deliberate
  // choice someone made at the desk.
  return { ratePlanId: null, mealPlan: fallback.mealPlan };
}

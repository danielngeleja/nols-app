/**
 * Move-in day (docs/LONG_STAY_RENTALS.md section 3.3 steps 6 and 7, milestone 7).
 *
 *  - Each side confirms once: the landlord the balance received (amount,
 *    method); the tenant the balance paid, keys received, home as listed.
 *    A tenant who did not get the keys or found the home not as listed opens
 *    a dispute instead, which freezes everything for an admin.
 *  - Both confirmed, or one confirmed and the other silent for 72 hours: the
 *    tenancy is let (ACTIVE). If any confirmed balance differs from the lease,
 *    the landlord's payout is held for review.
 *  - Condition photos are attached by either side as evidence.
 */
import { z } from "zod";
import { moveTenancy, TenancyError, type TenancySide } from "./tenancyService.js";
import { isTerminalTenancyStatus, isTenancyStatus } from "./tenancyState.js";
import { syncLongStayRevenue } from "../revenueRecognition.js";

export const AUTO_CONFIRM_HOURS = 72;
/** No confirmation at all this long after move-in day: a human should call. */
export const SILENT_MOVE_IN_DAYS = 7;

export const landlordConfirmSchema = z.object({
  balanceAmount: z.coerce.number().min(0),
  method: z.enum(["BANK", "MOBILE_MONEY"]),
}).strict();

export const tenantConfirmSchema = z.object({
  balanceAmount: z.coerce.number().min(0),
  method: z.enum(["BANK", "MOBILE_MONEY"]),
  keysReceived: z.literal(true),
  matchesListing: z.literal(true),
}).strict();

export const disputeSchema = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();
export const photosSchema = z.object({ urls: z.array(z.string().url().max(2048)).min(1).max(12) }).strict();

function scaleOf(currency: string) {
  return String(currency).toUpperCase() === "TZS" ? 1 : 100;
}
function sameMoney(a: unknown, b: unknown, currency: string) {
  const s = scaleOf(currency);
  return Math.round(Number(a) * s) === Math.round(Number(b) * s);
}
function wellFormedAmount(value: number, currency: string) {
  const s = scaleOf(currency);
  return Number.isFinite(value) && value >= 0 && Math.abs(Math.round(value * s) - value * s) < 1e-6;
}

/** A reserved tenancy whose move-in day has come opens its confirmations now, not at the next worker run. */
export async function ensureMoveInDay(db: any, tenancy: any, todayEat: string) {
  if (tenancy.status !== "RESERVED" || !tenancy.moveInDate) return tenancy;
  if (new Date(tenancy.moveInDate).toISOString().slice(0, 10) > todayEat) return tenancy;
  try {
    await moveTenancy(db, tenancy, "MOVE_IN", "SYSTEM", null);
  } catch {
    // Someone else moved it.
  }
  return db.tenancy.findUnique({ where: { id: tenancy.id } });
}

/** Whether every balance someone confirmed equals the lease's balance. */
export function balanceMismatch(tenancy: any): boolean {
  const due = tenancy.balanceDue;
  const confirmed = [tenancy.landlordBalanceAmount, tenancy.tenantBalanceAmount].filter((v) => v != null);
  return confirmed.some((v) => !sameMoney(v, due, tenancy.currency));
}

/** MOVE_IN -> ACTIVE, deciding whether the landlord's payout is ready or held. */
export async function finishMoveIn(db: any, tenancy: any, by: "BOTH" | "AUTO_LANDLORD" | "AUTO_TENANT" | "ADMIN", actorId: number | null, now = new Date()) {
  const mismatch = balanceMismatch(tenancy);
  await moveTenancy(db, tenancy, "ACTIVE", by === "ADMIN" ? "ADMIN" : "SYSTEM", actorId, {
    moveInConfirmedAt: now,
    moveInConfirmedBy: by,
    balanceMismatch: mismatch,
    // Every long-stay payout is approved by an admin during the pilot; a
    // mismatch is marked so the reviewer sees why it needs a closer look.
    payoutStatus: mismatch ? "REVIEW" : "READY",
  }, { by, balanceMismatch: mismatch });
  // Both fees are earned at move-in (docs/LONG_STAY_RENTALS.md 5.5). The
  // ledger write never blocks the move; a miss is replayed by syncLongStayRevenue.
  await syncLongStayRevenue(db, tenancy.id).catch((error) => console.error(`[longStay] revenue recognition failed for tenancy ${tenancy.id}:`, error?.message ?? error));
  return { mismatch };
}

export async function confirmMoveIn(db: any, tenancy: any, side: TenancySide, userId: number, input: any, now = new Date()) {
  if (tenancy.status !== "MOVE_IN") throw new TenancyError(tenancy.status === "RESERVED" ? "You can confirm on move-in day." : "Move-in cannot be confirmed now.", 409);
  const already = side === "LANDLORD" ? tenancy.landlordConfirmedAt : tenancy.tenantConfirmedAt;
  if (already) throw new TenancyError("You already confirmed move-in.", 409);
  const amount = Number(input.balanceAmount);
  if (!wellFormedAmount(amount, tenancy.currency)) throw new TenancyError("Enter the amount as it was paid.");
  if (amount > Number(tenancy.balanceDue) * 2 + 1) throw new TenancyError("That amount is far above the lease balance. Check it and try again.");

  const data = side === "LANDLORD"
    ? { landlordBalanceAmount: amount, landlordBalanceMethod: input.method, landlordConfirmedAt: now }
    : { tenantBalanceAmount: amount, tenantBalanceMethod: input.method, tenantKeysReceived: true, tenantMatchesListing: true, tenantConfirmedAt: now };
  const result = await db.tenancy.updateMany({
    where: { id: tenancy.id, status: "MOVE_IN", version: tenancy.version, ...(side === "LANDLORD" ? { landlordConfirmedAt: null } : { tenantConfirmedAt: null }) },
    data: { ...data, version: { increment: 1 } },
  });
  if (result.count !== 1) throw new TenancyError("This changed a moment ago. Refresh and try again.", 409);
  await db.tenancyEvent.create({ data: { tenancyId: tenancy.id, actorId: userId, actorRole: side, type: "MOVE_IN_CONFIRMED", data: { balanceAmount: amount, method: input.method } } });

  const fresh = await db.tenancy.findUnique({ where: { id: tenancy.id } });
  if (fresh?.status === "MOVE_IN" && fresh.landlordConfirmedAt && fresh.tenantConfirmedAt) {
    const { mismatch } = await finishMoveIn(db, fresh, "BOTH", null, now);
    return { let: true, mismatch };
  }
  return { let: false, mismatch: false };
}

/** Either side stops the clock; an admin decides. */
export async function openDispute(db: any, tenancy: any, side: TenancySide, userId: number, reason: string, now = new Date()) {
  if (!["RESERVED", "MOVE_IN", "ACTIVE", "ENDING", "OVERDUE"].includes(tenancy.status)) throw new TenancyError("This cannot be disputed now.", 409);
  const holdPayout = ["HELD", "READY"].includes(tenancy.payoutStatus);
  await moveTenancy(db, tenancy, "DISPUTED", side, userId, {
    disputedAt: now,
    ...(holdPayout ? { payoutStatus: "REVIEW" } : {}),
  }, { reason, side, statusBefore: tenancy.status });
}

export async function addConditionPhotos(db: any, tenancy: any, side: TenancySide, userId: number, urls: string[], trusted: (url: string) => boolean) {
  if (!isTenancyStatus(tenancy.status) || !["MOVE_IN", "ACTIVE", "ENDING", "DISPUTED"].includes(tenancy.status)) {
    throw new TenancyError("Condition photos are added from move-in day.", 409);
  }
  const clean = Array.from(new Set(urls)).filter(trusted);
  if (!clean.length || clean.length !== Array.from(new Set(urls)).length) throw new TenancyError("Upload the photos again.");
  const count = await db.tenancyEvent.count({ where: { tenancyId: tenancy.id, type: "CONDITION_PHOTOS" } });
  if (count >= 20) throw new TenancyError("This tenancy has the most photo sets allowed. Contact NoLSAF support.", 409);
  await db.tenancyEvent.create({ data: { tenancyId: tenancy.id, actorId: userId, actorRole: side, type: "CONDITION_PHOTOS", data: { urls: clean, stage: tenancy.status === "MOVE_IN" ? "MOVE_IN" : "DURING" } } });
  return { added: clean.length };
}

/**
 * Worker step: one side confirmed and the other was silent for 72 hours ->
 * let the home on that confirmation. Nobody confirmed a week after move-in ->
 * tell admins once.
 */
export async function autoConfirmMoveIns(db: any, now = new Date(), alert?: (tenancy: any) => Promise<unknown>) {
  const rows = await db.tenancy.findMany({ where: { status: "MOVE_IN" }, take: 200 });
  let auto = 0;
  let silent = 0;
  for (const t of rows) {
    if (isTerminalTenancyStatus(t.status)) continue;
    const one = t.landlordConfirmedAt && !t.tenantConfirmedAt ? "AUTO_LANDLORD" : !t.landlordConfirmedAt && t.tenantConfirmedAt ? "AUTO_TENANT" : null;
    const first = t.landlordConfirmedAt || t.tenantConfirmedAt;
    if (one && first && now.getTime() - new Date(first).getTime() >= AUTO_CONFIRM_HOURS * 3_600_000) {
      try {
        await finishMoveIn(db, t, one, null, now);
        auto += 1;
      } catch {
        // moved meanwhile
      }
      continue;
    }
    if (!first && t.moveInDate && now.getTime() - new Date(t.moveInDate).getTime() >= SILENT_MOVE_IN_DAYS * 86_400_000) {
      const flagged = await db.tenancyEvent.count({ where: { tenancyId: t.id, type: "MOVE_IN_SILENT_ALERT" } });
      if (!flagged) {
        await db.tenancyEvent.create({ data: { tenancyId: t.id, actorRole: "SYSTEM", type: "MOVE_IN_SILENT_ALERT", data: {} } });
        if (alert) await alert(t).catch(() => undefined);
        silent += 1;
      }
    }
  }
  return { auto, silent };
}

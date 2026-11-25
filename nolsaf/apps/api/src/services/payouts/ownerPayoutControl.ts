/**
 * Admin payout controls for one owner (migration 20261125110000).
 *
 *   hold          pauses every withdrawal, keeps the owner out of the AUTO lane
 *                 and out of unclaimed sends. For an owner under investigation.
 *   alwaysReview  every payout goes to a person, nothing automatic.
 *
 * Placing a control is immediate (an admin who sees fraud must be able to act
 * at once); lifting one needs the finance code (checked by the route). Both
 * are written to the audit log against the owner, so they show in the owner's
 * activity timeline.
 *
 * Read with `as any` on purpose: the Prisma client is generated together with
 * the migration, and before that the table does not exist. A missing table
 * means no control can exist, so it reads as "no controls"; any other read
 * error is thrown, so a payout path fails closed instead of skipping a hold.
 */
import { prisma } from "@nolsaf/prisma";
import { retentionFields } from "../../lib/auditRetention.js";

export type OwnerPayoutControlState = {
  available: boolean;
  hold: { at: Date; reason: string | null; byId: number | null } | null;
  alwaysReview: { reason: string | null; byId: number | null } | null;
};

export const HOLD_OWNER_MESSAGE = "Withdrawals are paused while NoLSAF reviews your account. Your balance is safe. Contact support if you need help.";

function missingTable(err: any): boolean {
  const message = String(err?.message ?? "");
  return err?.code === "P2021" || err?.code === "P2022" || message.includes("does not exist") ||
    message.includes("Cannot read properties of undefined");
}

const model = () => (prisma as any).ownerPayoutControl;

export async function loadOwnerPayoutControl(ownerId: number): Promise<OwnerPayoutControlState> {
  try {
    if (!model()) return { available: false, hold: null, alwaysReview: null };
    const row = await model().findUnique({ where: { ownerId } });
    return {
      available: true,
      hold: row?.holdAt ? { at: row.holdAt, reason: row.holdReason ?? null, byId: row.holdById ?? null } : null,
      alwaysReview: row?.alwaysReview ? { reason: row.alwaysReviewReason ?? null, byId: row.alwaysReviewById ?? null } : null,
    };
  } catch (err: any) {
    if (missingTable(err)) return { available: false, hold: null, alwaysReview: null };
    throw err;
  }
}

/** Owners currently on hold, for the batch jobs (unclaimed sends). */
export async function heldOwnerIds(ownerIds: number[]): Promise<Set<number>> {
  if (!ownerIds.length) return new Set();
  try {
    if (!model()) return new Set();
    const rows = await model().findMany({ where: { ownerId: { in: ownerIds }, holdAt: { not: null } }, select: { ownerId: true } });
    return new Set(rows.map((r: { ownerId: number }) => r.ownerId));
  } catch (err: any) {
    if (missingTable(err)) return new Set();
    throw err;
  }
}

export type OwnerPayoutControlAction = "HOLD" | "RELEASE" | "ALWAYS_REVIEW_ON" | "ALWAYS_REVIEW_OFF";

/** Lifting a control lets money move again, so it needs the finance code. */
export function controlActionLoosens(action: OwnerPayoutControlAction): boolean {
  return action === "RELEASE" || action === "ALWAYS_REVIEW_OFF";
}

export class OwnerPayoutControlError extends Error {
  constructor(readonly code: "NOT_AVAILABLE" | "NO_CHANGE", message: string) {
    super(message);
  }
}

const AUDIT_ACTION: Record<OwnerPayoutControlAction, string> = {
  HOLD: "OWNER_PAYOUT_HOLD_PLACED",
  RELEASE: "OWNER_PAYOUT_HOLD_RELEASED",
  ALWAYS_REVIEW_ON: "OWNER_PAYOUT_ALWAYS_REVIEW_ON",
  ALWAYS_REVIEW_OFF: "OWNER_PAYOUT_ALWAYS_REVIEW_OFF",
};

export async function applyOwnerPayoutControl(input: {
  ownerId: number; action: OwnerPayoutControlAction; reason: string; adminId: number;
  ip?: string | null; ua?: string | null; now?: Date;
}): Promise<OwnerPayoutControlState> {
  const now = input.now ?? new Date();
  const before = await loadOwnerPayoutControl(input.ownerId);
  if (!before.available) throw new OwnerPayoutControlError("NOT_AVAILABLE", "Apply the owner payout controls database update first.");
  const reason = input.reason.trim().slice(0, 300);
  let data: Record<string, unknown>;
  switch (input.action) {
    case "HOLD":
      if (before.hold) throw new OwnerPayoutControlError("NO_CHANGE", "This owner's payouts are already paused.");
      data = { holdAt: now, holdReason: reason, holdById: input.adminId };
      break;
    case "RELEASE":
      if (!before.hold) throw new OwnerPayoutControlError("NO_CHANGE", "This owner's payouts are not paused.");
      data = { holdAt: null, holdReason: null, holdById: null };
      break;
    case "ALWAYS_REVIEW_ON":
      if (before.alwaysReview) throw new OwnerPayoutControlError("NO_CHANGE", "This owner's payouts are already always checked.");
      data = { alwaysReview: true, alwaysReviewReason: reason, alwaysReviewById: input.adminId };
      break;
    case "ALWAYS_REVIEW_OFF":
      if (!before.alwaysReview) throw new OwnerPayoutControlError("NO_CHANGE", "This owner's payouts are not set to always be checked.");
      data = { alwaysReview: false, alwaysReviewReason: null, alwaysReviewById: null };
      break;
  }
  await prisma.$transaction(async (tx) => {
    await (tx as any).ownerPayoutControl.upsert({
      where: { ownerId: input.ownerId },
      create: { ownerId: input.ownerId, ...data },
      update: data,
    });
    // Strict: a control without its audit record must not stand.
    await tx.auditLog.create({
      data: {
        actorId: input.adminId, actorRole: "ADMIN", action: AUDIT_ACTION[input.action],
        entity: `user:${input.ownerId}`, entityId: input.ownerId,
        ip: input.ip ?? null, ua: input.ua ? input.ua.slice(0, 255) : null,
        afterJson: { reason },
        ...retentionFields("FINANCIAL", now),
      },
    });
  });
  return loadOwnerPayoutControl(input.ownerId);
}

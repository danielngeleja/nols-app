/**
 * The tenancy state machine (docs/LONG_STAY_RENTALS.md section 3.3).
 *
 * Every status change goes through here. Each move names who may make it, so
 * a route cannot skip a step or act for the other side, and only the system
 * (a verified payment callback, a timed job) can mark a tenancy paid or let.
 * Writes are compare-and-set on (status, version): two racing requests can
 * never both move the same tenancy.
 */

export const TENANCY_STATUSES = [
  "OFFERED", // tenant reserved at the listed terms; landlord has 24h to confirm
  "ACCEPTED", // landlord accepted; money snapshotted; lease awaiting both sides
  "AWAITING_PAYMENT", // both accepted the lease; 48h to pay first month + fee
  "RESERVED", // booking payment verified; waiting for move-in day
  "MOVE_IN", // move-in day reached; balance and keys confirmations open
  "ACTIVE", // move-in confirmed; the lease governs
  "ENDING", // notice given; runs to the end of the notice or prepaid period
  "ENDED",
  "CANCELLED",
  "DISPUTED", // frozen for admin review
  "OVERDUE", // past the prepaid period without renewal
] as const;
export type TenancyStatus = (typeof TENANCY_STATUSES)[number];

/** The landlord has committed the home and the tenant has yet to finish moving in. */
export const RESERVATION_HOLD_STATUSES: readonly string[] = ["ACCEPTED", "AWAITING_PAYMENT", "RESERVED", "MOVE_IN"];
export const TENANCY_DATE_HOLD_STATUSES = [...RESERVATION_HOLD_STATUSES, "ACTIVE", "ENDING", "OVERDUE", "DISPUTED"];

export type TenancyActor = "TENANT" | "LANDLORD" | "ADMIN" | "SYSTEM";

const ANY: TenancyActor[] = ["TENANT", "LANDLORD", "ADMIN", "SYSTEM"];
const PARTIES_OR_ADMIN: TenancyActor[] = ["TENANT", "LANDLORD", "ADMIN"];

/** from -> to -> who may make that move. Anything not listed is refused. */
const TRANSITIONS: Record<TenancyStatus, Partial<Record<TenancyStatus, TenancyActor[]>>> = {
  // Declined, withdrawn or unanswered within 24h (system): cancelled.
  OFFERED: { ACCEPTED: ["LANDLORD"], CANCELLED: ANY },
  // Moves on only when both leases are accepted, decided by the server.
  ACCEPTED: { AWAITING_PAYMENT: ["SYSTEM"], CANCELLED: ANY },
  // Paid only from a verified payment callback. Unpaid after 48h: system cancels.
  AWAITING_PAYMENT: { RESERVED: ["SYSTEM"], CANCELLED: ANY },
  RESERVED: { MOVE_IN: ["SYSTEM"], CANCELLED: PARTIES_OR_ADMIN, DISPUTED: PARTIES_OR_ADMIN },
  // Let after both confirmations or the 72h silence rule (system), or by admin.
  MOVE_IN: { ACTIVE: ["SYSTEM", "ADMIN"], DISPUTED: PARTIES_OR_ADMIN, CANCELLED: ["ADMIN", "SYSTEM"] },
  // The landlord confirms move-out from the end date (lifecycle.confirmMoveOut checks the date).
  ACTIVE: { ENDING: ["TENANT", "LANDLORD"], ENDED: ["SYSTEM", "ADMIN", "LANDLORD"], OVERDUE: ["SYSTEM"], DISPUTED: PARTIES_OR_ADMIN },
  ENDING: { ENDED: ["SYSTEM", "ADMIN", "LANDLORD"], OVERDUE: ["SYSTEM"], DISPUTED: PARTIES_OR_ADMIN },
  OVERDUE: { ENDED: ["ADMIN", "LANDLORD"], DISPUTED: PARTIES_OR_ADMIN },
  // Only an admin resolves a dispute, back to where it belongs or to an end.
  DISPUTED: { RESERVED: ["ADMIN"], MOVE_IN: ["ADMIN"], ACTIVE: ["ADMIN"], CANCELLED: ["ADMIN"], ENDED: ["ADMIN"] },
  ENDED: {},
  CANCELLED: {},
};

export class TenancyTransitionError extends Error {
  readonly status = 409;
  constructor(message: string) {
    super(message);
    this.name = "TenancyTransitionError";
  }
}

export function isTenancyStatus(value: unknown): value is TenancyStatus {
  return typeof value === "string" && (TENANCY_STATUSES as readonly string[]).includes(value);
}

export function isTerminalTenancyStatus(status: TenancyStatus): boolean {
  return status === "ENDED" || status === "CANCELLED";
}

export function canTransition(from: string, to: string, actor: TenancyActor): boolean {
  if (!isTenancyStatus(from) || !isTenancyStatus(to)) return false;
  return Boolean(TRANSITIONS[from][to]?.includes(actor));
}

export function assertTransition(from: string, to: string, actor: TenancyActor): void {
  if (!canTransition(from, to, actor)) {
    throw new TenancyTransitionError(`This tenancy cannot move from ${from} to ${to}.`);
  }
}

/** Statuses in which NoLSAF holds the tenant's booking payment. */
export function holdsBookingPayment(status: TenancyStatus): boolean {
  return status === "RESERVED" || status === "MOVE_IN" || status === "DISPUTED";
}

/** Statuses that occupy the home for availability (reserved or let). */
export function occupiesHome(status: TenancyStatus): boolean {
  return ["AWAITING_PAYMENT", "RESERVED", "MOVE_IN", "ACTIVE", "ENDING", "OVERDUE", "DISPUTED"].includes(status);
}

/**
 * The guarded update for a move: use with updateMany and check count === 1.
 * A count of 0 means someone else moved it first; reload and retry or refuse.
 */
export function tenancyTransitionUpdate(
  tenancy: { id: number; status: string; version: number },
  to: TenancyStatus,
  actor: TenancyActor,
  data: Record<string, unknown> = {},
) {
  assertTransition(tenancy.status, to, actor);
  return {
    where: { id: tenancy.id, status: tenancy.status, version: tenancy.version },
    data: { ...data, status: to, version: { increment: 1 } },
  };
}

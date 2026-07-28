export const TOUR_DISPUTE_WINDOW_HOURS = 48;

export type TourLifecycleSnapshot = {
  status?: string | null;
  paymentStatus?: string | null;
  paidAt?: Date | string | null;
  operatorCompletedAt?: Date | string | null;
  customerConfirmedAt?: Date | string | null;
  disputeWindowEndsAt?: Date | string | null;
  payoutStatus?: string | null;
  openCaseCount?: number;
};

const upper = (value: unknown) => String(value || "").trim().toUpperCase();
const time = (value: Date | string | null | undefined) => value ? new Date(value).getTime() : NaN;

export function disputeWindowEndsAt(completedAt: Date, hours = TOUR_DISPUTE_WINDOW_HOURS): Date {
  return new Date(completedAt.getTime() + hours * 60 * 60 * 1000);
}

export function canFinalizeTour(snapshot: TourLifecycleSnapshot, now = new Date()): boolean {
  if (upper(snapshot.status) !== "OPERATOR_COMPLETED") return false;
  if ((snapshot.openCaseCount || 0) > 0) return false;
  if (snapshot.customerConfirmedAt) return true;
  const deadline = time(snapshot.disputeWindowEndsAt);
  return Number.isFinite(deadline) && deadline <= now.getTime();
}

export function canClaimFinalTourPayout(snapshot: TourLifecycleSnapshot, now = new Date()): { ok: boolean; reason?: string } {
  if (upper(snapshot.paymentStatus) !== "PAID" && !snapshot.paidAt) return { ok: false, reason: "payment_not_confirmed" };
  if (upper(snapshot.status) !== "COMPLETED") return { ok: false, reason: "tour_not_completed" };
  if ((snapshot.openCaseCount || 0) > 0) return { ok: false, reason: "open_case" };
  if (!snapshot.customerConfirmedAt) {
    const deadline = time(snapshot.disputeWindowEndsAt);
    if (!Number.isFinite(deadline) || deadline > now.getTime()) return { ok: false, reason: "dispute_window_open" };
  }
  const payout = upper(snapshot.payoutStatus);
  if (["CLAIMED", "VERIFIED", "APPROVED", "DISBURSED", "PAID"].includes(payout)) return { ok: false, reason: "already_claimed" };
  return { ok: true };
}

export function assertTourStatusTransition(fromValue: unknown, toValue: unknown): boolean {
  const from = upper(fromValue);
  const to = upper(toValue);
  const allowed: Record<string, string[]> = {
    PENDING_PAYMENT: ["CONFIRMED", "CANCELED"],
    CONFIRMED: ["IN_PROGRESS", "CANCELED"],
    IN_PROGRESS: ["OPERATOR_COMPLETED", "CANCELED"],
    OPERATOR_COMPLETED: ["COMPLETED", "IN_PROGRESS", "CANCELED"],
    COMPLETED: [],
    CANCELED: ["REFUNDED"],
    REFUNDED: [],
  };
  return Boolean(allowed[from]?.includes(to));
}

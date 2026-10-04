// =============================================================================
// Tour Operator Disbursement Policy: SINGLE SOURCE OF TRUTH for when and how
// much operator money may leave NoLSAF for a tour booking.
//
// Two tranches per booking, both paid through the shared disbursement ledger:
//
//  1. ADVANCE (before the trip), paid as source TOUR_ADVANCE.
//     - Opens 7 days before departure, never inside the first 24 hours after
//       payment (the traveller's full-refund cooling-off).
//     - Until 96 hours before departure: 30% of the operator's net share, up to
//       70% when supplier receipts cover the difference. 96 hours is where the
//       cancellation policy stops refunding the traveller, so from there on 70%
//       is safe against a traveller cancellation and needs no paperwork.
//     - Only for operators in good standing: tier SILVER or above, a verified
//       payout destination, and no unpaid recovery debt.
//
//  2. BALANCE (after the trip), paid as source TOUR_BOOKING.
//     - Net share minus every advance already paid.
//     - Claimable when the traveller confirms completion, or automatically once
//       the dispute window closes: 48 hours after the LATER of the operator
//       finishing the timetable and the end of the trip's last day. Anchoring to
//       the trip end stops a timetable ticked early from shortening the window.
//
// Any open case holds new money; an advance already paid is recovered only
// through the cancellation recovery flow (tourCancellationPolicy.ts).
//
// The public policy page (tourOperatorDisbursementPolicyContent.tsx) must be
// kept in step with the numbers here.
// =============================================================================

import type { AgentTier } from "./agentLevel.js";

export const TOUR_PAYOUT_POLICY_VERSION = "2026-09-26";

export const ADVANCE_OPENS_DAYS_BEFORE = 7;
export const ADVANCE_FULL_WINDOW_HOURS = 96;
export const ADVANCE_BASE_PERCENT = 30;
export const ADVANCE_MAX_PERCENT = 70;
export const ADVANCE_COOLING_OFF_HOURS = 24;
export const ADVANCE_MIN_TIER: AgentTier = "SILVER";
export const BALANCE_DISPUTE_WINDOW_HOURS = 48;
/**
 * Anchoring the dispute window to the trip's end can make an operator wait
 * longer than the old "48h after the timetable is finished" rule, so under the
 * operator agreement (section 19.7.1, 30 days' written notice before a
 * material payout change) it applies only to trips finished from this date.
 * Everything else in this policy pays earlier or fixes a defect.
 */
export const DISPUTE_WINDOW_TRIP_END_ANCHOR_FROM = new Date("2026-10-26T00:00:00+03:00");

/** Advance-tranche rows are TourFinancialTransaction kind PAYOUT with metadata.tranche = ADVANCE. */
export const ADVANCE_TRANCHE = "ADVANCE";
/** Advance statuses that count against the cap: anything not rejected or failed. */
export const ADVANCE_LIVE_STATUSES = ["CLAIMED", "VERIFIED", "APPROVED", "DISBURSED", "PAID"] as const;
/** Advance statuses still moving through NoLSAF finance. */
export const ADVANCE_IN_FLIGHT_STATUSES = ["CLAIMED", "VERIFIED", "APPROVED"] as const;
export const ADVANCE_PAID_STATUSES = ["DISBURSED", "PAID"] as const;

const TIER_RANK: Record<AgentTier, number> = { BRONZE: 0, SILVER: 1, GOLD: 2, PLATINUM: 3 };
const HOUR = 60 * 60 * 1000;

const upper = (value: unknown) => String(value ?? "").trim().toUpperCase();
const toTime = (value: Date | string | null | undefined) => (value ? new Date(value).getTime() : NaN);
const money = (value: number) => Math.max(0, Math.round(value * 100) / 100);

export type OperatorStanding = {
  tier: AgentTier;
  hasVerifiedPayoutDestination: boolean;
  pendingRecoveryAmount: number;
};

export type AdvanceBookingSnapshot = {
  status: string | null | undefined;
  paymentStatus: string | null | undefined;
  paidAt: Date | string | null | undefined;
  startDate: Date | string | null | undefined;
  operatorNet: number;
  /** Sum of advance rows that are not rejected or failed. */
  advanceCommitted: number;
  openCaseCount: number;
};

export type AdvanceReason =
  | "payment_not_confirmed"
  | "booking_closed"
  | "no_start_date"
  | "cooling_off"
  | "too_early"
  | "open_case"
  | "tier_too_low"
  | "no_payout_destination"
  | "recovery_debt"
  | "fully_advanced";

export type AdvanceOffer = {
  ok: boolean;
  reason: AdvanceReason | null;
  /** When the advance becomes claimable, for time-based refusals. */
  opensAt: string | null;
  /** When the no-paperwork 70% window opens (96 hours before departure). */
  fullWindowAt: string | null;
  /** True inside the 96-hour window: 70% with no receipts. */
  inFullWindow: boolean;
  /** Percent of the net share claimable now without receipts. */
  percentWithoutEvidence: number;
  /** Amount claimable now without receipts, after earlier advances. */
  availableWithoutEvidence: number;
  /** Amount claimable now with enough supplier receipts, after earlier advances. */
  availableWithEvidence: number;
  alreadyAdvanced: number;
};

function empty(reason: AdvanceReason, alreadyAdvanced: number, extra: Partial<AdvanceOffer> = {}): AdvanceOffer {
  return {
    ok: false,
    reason,
    opensAt: null,
    fullWindowAt: null,
    inFullWindow: false,
    percentWithoutEvidence: 0,
    availableWithoutEvidence: 0,
    availableWithEvidence: 0,
    alreadyAdvanced,
    ...extra,
  };
}

/**
 * What a pre-trip advance can pay right now. Pure: the caller supplies the
 * booking snapshot and the operator's standing.
 */
export function computeAdvanceOffer(
  booking: AdvanceBookingSnapshot,
  standing: OperatorStanding,
  now: Date = new Date()
): AdvanceOffer {
  const already = money(booking.advanceCommitted || 0);
  const status = upper(booking.status);
  const paid = upper(booking.paymentStatus) === "PAID" || Boolean(booking.paidAt);

  if (!paid) return empty("payment_not_confirmed", already);
  if (["CANCELED", "CANCELLED", "REFUNDED", "COMPLETED", "OPERATOR_COMPLETED"].includes(status)) return empty("booking_closed", already);

  const start = toTime(booking.startDate);
  if (!Number.isFinite(start)) return empty("no_start_date", already);

  const fullWindowAt = new Date(start - ADVANCE_FULL_WINDOW_HOURS * HOUR);
  const opensByDate = start - ADVANCE_OPENS_DAYS_BEFORE * 24 * HOUR;
  const paidAtMs = toTime(booking.paidAt);
  const opensByCoolingOff = Number.isFinite(paidAtMs) ? paidAtMs + ADVANCE_COOLING_OFF_HOURS * HOUR : -Infinity;
  const opensAt = Math.max(opensByDate, opensByCoolingOff);
  const timing = { fullWindowAt: fullWindowAt.toISOString() };

  if (now.getTime() < opensByCoolingOff) return empty("cooling_off", already, { ...timing, opensAt: new Date(opensAt).toISOString() });
  if (now.getTime() < opensByDate) return empty("too_early", already, { ...timing, opensAt: new Date(opensAt).toISOString() });
  if ((booking.openCaseCount || 0) > 0) return empty("open_case", already, timing);
  if (TIER_RANK[standing.tier] < TIER_RANK[ADVANCE_MIN_TIER]) return empty("tier_too_low", already, timing);
  if (!standing.hasVerifiedPayoutDestination) return empty("no_payout_destination", already, timing);
  if ((standing.pendingRecoveryAmount || 0) > 0) return empty("recovery_debt", already, timing);

  const net = Math.max(0, Number(booking.operatorNet) || 0);
  const inFullWindow = now.getTime() >= fullWindowAt.getTime();
  const percentWithoutEvidence = inFullWindow ? ADVANCE_MAX_PERCENT : ADVANCE_BASE_PERCENT;
  const availableWithoutEvidence = money((net * percentWithoutEvidence) / 100 - already);
  const availableWithEvidence = money((net * ADVANCE_MAX_PERCENT) / 100 - already);

  if (availableWithEvidence <= 0) {
    return empty("fully_advanced", already, { ...timing, inFullWindow, percentWithoutEvidence });
  }

  return {
    ok: true,
    reason: null,
    opensAt: null,
    fullWindowAt: timing.fullWindowAt,
    inFullWindow,
    percentWithoutEvidence,
    availableWithoutEvidence,
    availableWithEvidence,
    alreadyAdvanced: already,
  };
}

/**
 * The most an operator may request in one advance claim. Outside the 96-hour
 * window, anything above the no-paperwork share must be covered by supplier
 * receipts, and never above the 70% cap.
 */
export function maxAdvanceRequest(offer: AdvanceOffer, evidenceTotal: number): number {
  if (!offer.ok) return 0;
  const covered = offer.availableWithoutEvidence + Math.max(0, Number(evidenceTotal) || 0);
  return money(Math.min(offer.availableWithEvidence, covered));
}

/** The balance still owed after the trip: net share minus every advance already paid. */
export function balanceAfterAdvances(operatorNet: number, advancesPaid: number): number {
  return money((Number(operatorNet) || 0) - (Number(advancesPaid) || 0));
}

/**
 * The dispute window closes 48 hours after the LATER of the operator finishing
 * the timetable and the end of the trip's last day. `endDate` is a date; its
 * day is taken to end 24 hours after it.
 */
export function balanceDisputeDeadline(
  operatorCompletedAt: Date,
  endDate?: Date | string | null,
  hours = BALANCE_DISPUTE_WINDOW_HOURS
): Date {
  if (operatorCompletedAt.getTime() < DISPUTE_WINDOW_TRIP_END_ANCHOR_FROM.getTime()) {
    return new Date(operatorCompletedAt.getTime() + hours * HOUR);
  }
  const endOfTrip = toTime(endDate ?? null);
  const anchor = Number.isFinite(endOfTrip) ? Math.max(operatorCompletedAt.getTime(), endOfTrip + 24 * HOUR) : operatorCompletedAt.getTime();
  return new Date(anchor + hours * HOUR);
}

export function tierRank(tier: AgentTier): number {
  return TIER_RANK[tier];
}

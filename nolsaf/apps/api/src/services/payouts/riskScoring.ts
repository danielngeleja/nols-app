/**
 * Payout Risk Scoring — visibility before a payout enters a batch
 *
 * Runs once, right before batch formation (batching.ts), against a payout
 * that is already APPROVED and already fingerprint-locked. Never blocks
 * approval itself — eligibility.ts and the source's own flow already
 * decided this payout is owed. This only decides whether it may proceed
 * straight into a batch or must wait for senior review first, per
 * docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md "Risk scoring before approval".
 *
 * LOW -> normal batching. MEDIUM -> batched but flagged for the batch
 * authorizer to see. HIGH/CRITICAL -> excluded from the batch entirely and
 * routed to SECURITY_REVIEW.
 *
 * Design rule: this scorer must separate ACCOUNT TAKEOVER from ONBOARDING.
 * An earlier version scored "account is new" plus "first payout to this
 * beneficiary" as CRITICAL, which describes every legitimate new partner as
 * precisely as it describes an attacker, and made SECURITY_REVIEW the normal
 * path for onboarding. A queue that fires on everything gets cleared
 * reflexively, and a control that gets cleared reflexively is not a control.
 * The discriminator is PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE: a payee who has
 * already been paid somewhere else and is now being paid to a freshly
 * changed destination is the compromised-account pattern. A payee with no
 * payout history at all is just new.
 */

import { prisma } from "@nolsaf/prisma";
import type { Disbursement, PayoutAccount } from "@prisma/client";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskFlag =
  | "RECENT_ACCOUNT_CHANGE"
  | "PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE"
  | "FIRST_PAYOUT_TO_BENEFICIARY"
  | "AMOUNT_ABOVE_NORMAL_RANGE"
  | "ACCOUNT_SHARED_ACROSS_PARTNERS"
  | "AFTER_HOURS_APPROVAL"
  | "REPEATED_RECENT_FAILURES";

export interface RiskAssessment {
  level: RiskLevel;
  flags: RiskFlag[];
}

/** A payout account whose destination changed within this window of the payout being approved is treated as "just changed." */
const RECENT_ACCOUNT_CHANGE_HOURS = 72;
/** A payout more than this multiple of the payee's own trailing average is flagged as an outlier. */
const AMOUNT_OUTLIER_MULTIPLIER = 3;
const AFTER_HOURS_START_HOUR = 22; // 22:00
const AFTER_HOURS_END_HOUR = 6; // 06:00
const REPEATED_FAILURE_LOOKBACK_DAYS = 14;
const REPEATED_FAILURE_THRESHOLD = 2;

/**
 * Business hours are Tanzanian, not the host's. Reading getHours() off a UTC
 * container flagged the Dar es Salaam morning shift as "after hours" and let
 * the actual night window through unflagged.
 */
function businessTimeZone(): string {
  return process.env.PAYOUT_RISK_TIMEZONE || "Africa/Dar_es_Salaam";
}

function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60);
}

export function isAfterHours(date: Date, timeZone = businessTimeZone()): boolean {
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone }).format(date)
    );
  } catch {
    // Unknown zone in this runtime's ICU data — fall back to UTC rather than
    // to the host's local time, so the window is at least deterministic.
    hour = date.getUTCHours();
  }
  if (!Number.isFinite(hour)) return false;
  return hour >= AFTER_HOURS_START_HOUR || hour < AFTER_HOURS_END_HOUR;
}

/**
 * Assesses one already-approved disbursement. Reads only — never mutates.
 * Callers persist `riskLevel`/`riskFlags` themselves at batch-formation time.
 */
export async function assessDisbursementRisk(
  disbursement: Pick<Disbursement, "id" | "sourceType" | "sourceId" | "amount" | "payoutAccountId" | "approvedAt" | "createdAt">,
  payoutAccount: Pick<PayoutAccount, "id" | "userId" | "accountNumber" | "provider" | "destinationChangedAt" | "createdAt">
): Promise<RiskAssessment> {
  const flags: RiskFlag[] = [];
  const decisionTime = disbursement.approvedAt ?? disbursement.createdAt;

  // Recent destination change: the account's money-carrying fields were set
  // or edited shortly before this payout was approved. Anchored on
  // destinationChangedAt, which only moves when the number/name/provider
  // actually changes — never on verifiedAt, which routine re-verification
  // overwrites and which therefore says nothing about the destination.
  const accountAnchor = payoutAccount.destinationChangedAt ?? payoutAccount.createdAt;
  if (accountAnchor && hoursBetween(decisionTime, accountAnchor) <= RECENT_ACCOUNT_CHANGE_HOURS) {
    flags.push("RECENT_ACCOUNT_CHANGE");
  }

  // Has this payee ever been paid to a DIFFERENT destination? This is the
  // discriminator between a compromised account (established payee, money
  // suddenly redirected) and a new partner (no history to redirect).
  const priorPaidElsewhere = await prisma.disbursement.count({
    where: {
      status: "PAID",
      id: { not: disbursement.id },
      payoutAccountId: { not: disbursement.payoutAccountId },
      payoutAccount: { is: { userId: payoutAccount.userId } },
    },
  });
  if (priorPaidElsewhere > 0) flags.push("PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE");

  // First payout ever paid to this exact destination. On its own this is
  // just onboarding; it earns its weight only alongside the flag above.
  const priorPaid = await prisma.disbursement.count({
    where: { payoutAccountId: disbursement.payoutAccountId, status: "PAID", id: { not: disbursement.id } },
  });
  if (priorPaid === 0) flags.push("FIRST_PAYOUT_TO_BENEFICIARY");

  // Amount well above this payee's own trailing average for the same source
  // flow — a stolen/compromised claim is often inflated relative to the
  // payee's normal payout size.
  const history = await prisma.disbursement.aggregate({
    where: { sourceType: disbursement.sourceType, payoutAccountId: disbursement.payoutAccountId, status: "PAID", id: { not: disbursement.id } },
    _avg: { amount: true },
    _count: true,
  });
  const avg = history._avg.amount ? Number(history._avg.amount) : null;
  if (avg && history._count >= 3 && Number(disbursement.amount) > avg * AMOUNT_OUTLIER_MULTIPLIER) {
    flags.push("AMOUNT_ABOVE_NORMAL_RANGE");
  }

  // Same account number/provider reused by a PayoutAccount belonging to a
  // different user — legitimate for e.g. shared agency accounts, but worth
  // surfacing since it's also how mule accounts collect from multiple
  // unrelated claims.
  const sharedAccount = await prisma.payoutAccount.count({
    where: { accountNumber: payoutAccount.accountNumber, provider: payoutAccount.provider, userId: { not: payoutAccount.userId } },
  });
  if (sharedAccount > 0) flags.push("ACCOUNT_SHARED_ACROSS_PARTNERS");

  // Approved outside normal business hours — approvals rushed through
  // late at night/early morning warrant a second look.
  if (isAfterHours(decisionTime)) flags.push("AFTER_HOURS_APPROVAL");

  // Repeated recent FAILED attempts for this payee suggest either a broken
  // payout destination or probing behavior.
  const recentFailures = await prisma.disbursement.count({
    where: {
      payoutAccountId: disbursement.payoutAccountId,
      status: "FAILED",
      id: { not: disbursement.id },
      createdAt: { gte: new Date(Date.now() - REPEATED_FAILURE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) },
    },
  });
  if (recentFailures >= REPEATED_FAILURE_THRESHOLD) flags.push("REPEATED_RECENT_FAILURES");

  const level = scoreLevel(flags);
  return { level, flags };
}

/**
 * Weights, not flag counts. Counting flags made "new partner approved in the
 * evening" (three weak signals) score the same as a genuine takeover, which
 * is the failure mode that fills the security queue with noise.
 */
const FLAG_WEIGHTS: Record<RiskFlag, number> = {
  ACCOUNT_SHARED_ACROSS_PARTNERS: 3,
  REPEATED_RECENT_FAILURES: 3,
  RECENT_ACCOUNT_CHANGE: 2,
  AMOUNT_ABOVE_NORMAL_RANGE: 2,
  PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE: 1,
  FIRST_PAYOUT_TO_BENEFICIARY: 1,
  AFTER_HOURS_APPROVAL: 1,
};

/** At or above this weight a payout is excluded from batching and held for review. */
const HIGH_WEIGHT_THRESHOLD = 6;

export function scoreLevel(flags: RiskFlag[]): RiskLevel {
  const has = (flag: RiskFlag) => flags.includes(flag);

  // The compromised-account withdrawal pattern: an established payee, already
  // paid somewhere else, whose destination changed just before this payout.
  // Never let this into a batch.
  if (has("RECENT_ACCOUNT_CHANGE") && has("PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE")) return "CRITICAL";
  // A destination shared with another partner AND freshly changed is the
  // mule-collection shape.
  if (has("RECENT_ACCOUNT_CHANGE") && has("ACCOUNT_SHARED_ACROSS_PARTNERS")) return "CRITICAL";

  // Blocking, but explainable by something other than takeover.
  if (has("REPEATED_RECENT_FAILURES")) return "HIGH";
  if (has("ACCOUNT_SHARED_ACROSS_PARTNERS")) return "HIGH";
  if (has("RECENT_ACCOUNT_CHANGE") && has("AMOUNT_ABOVE_NORMAL_RANGE")) return "HIGH";

  const weight = flags.reduce((sum, flag) => sum + (FLAG_WEIGHTS[flag] ?? 1), 0);
  if (weight >= HIGH_WEIGHT_THRESHOLD) return "HIGH";

  // Visible to the batch authorizer, but not blocking. A brand-new partner's
  // first payout lands here (RECENT_ACCOUNT_CHANGE + FIRST_PAYOUT_TO_BENEFICIARY,
  // weight 3) rather than in the security queue.
  if (weight > 0) return "MEDIUM";
  return "LOW";
}

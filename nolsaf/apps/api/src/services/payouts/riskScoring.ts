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
import { getFxRates } from "../../lib/fx.js";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RiskFlag =
  | "RECENT_ACCOUNT_CHANGE"
  | "PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE"
  | "FIRST_PAYOUT_TO_BENEFICIARY"
  | "AMOUNT_ABOVE_NORMAL_RANGE"
  | "ACCOUNT_SHARED_ACROSS_PARTNERS"
  | "AFTER_HOURS_APPROVAL"
  | "REPEATED_RECENT_FAILURES"
  | "AMOUNT_AT_REVIEW_THRESHOLD"
  | "PAYEE_DAILY_CAP_EXCEEDED";

export interface RiskAssessment {
  level: RiskLevel;
  flags: RiskFlag[];
}

/** Default window, in hours, in which a freshly created or changed destination counts as "just changed". Admin-tunable via SystemSetting.payoutRecentChangeHours. */
const RECENT_ACCOUNT_CHANGE_HOURS = 72;
/** Bounds on the admin-tunable window: shorter than a day defeats the point, longer than two weeks just queues onboarding. */
const RECENT_CHANGE_HOURS_MIN = 24;
const RECENT_CHANGE_HOURS_MAX = 336;
/** Statuses that count toward a payee's rolling 24h total: money already sent or committed to go. */
const DAILY_CAP_STATUSES = ["BATCHED", "AUTHORIZED", "SUBMITTED", "PROCESSING", "PAID"];
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

/**
 * Admin-set payout safeguards from SystemSetting. Read per assessment so a
 * change in Settings applies to the next batch formation without a restart.
 * Fails to the built-in behaviour (no threshold, no cap, 72h window) when the
 * row or the columns are unavailable, e.g. before the migration is applied.
 */
export interface PayoutSafeguards {
  reviewThresholdTzs: number | null;
  dailyCapPerPayeeTzs: number | null;
  recentChangeHours: number;
}

function positiveOrNull(value: unknown): number | null {
  const n = Number(value);
  return value !== null && value !== undefined && Number.isFinite(n) && n > 0 ? n : null;
}

export function clampRecentChangeHours(value: unknown): number {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n)) return RECENT_ACCOUNT_CHANGE_HOURS;
  return Math.min(RECENT_CHANGE_HOURS_MAX, Math.max(RECENT_CHANGE_HOURS_MIN, Math.round(n)));
}

export async function loadPayoutSafeguards(): Promise<PayoutSafeguards> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { payoutReviewThresholdTzs: true, payoutDailyCapPerPayeeTzs: true, payoutRecentChangeHours: true },
    });
    return {
      reviewThresholdTzs: positiveOrNull(row?.payoutReviewThresholdTzs),
      dailyCapPerPayeeTzs: positiveOrNull(row?.payoutDailyCapPerPayeeTzs),
      recentChangeHours: clampRecentChangeHours(row?.payoutRecentChangeHours),
    };
  } catch (err: any) {
    console.error("[riskScoring] payout safeguards unavailable, using built-in defaults:", err?.code || err?.message || err);
    return { reviewThresholdTzs: null, dailyCapPerPayeeTzs: null, recentChangeHours: RECENT_ACCOUNT_CHANGE_HOURS };
  }
}

/**
 * Converts an amount to TZS for the absolute safeguards. Returns null when no
 * rate is known, which the callers treat as "cannot prove it is under the
 * limit" and hold the payout: a control must fail closed.
 */
async function toTzs(amount: number, currency: string | null | undefined): Promise<number | null> {
  const code = String(currency || "TZS").toUpperCase();
  if (code === "TZS") return amount;
  const rate = Number((await getFxRates()).tzsPerUnit?.[code]);
  return Number.isFinite(rate) && rate > 0 ? amount * rate : null;
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
  disbursement: Pick<Disbursement, "id" | "sourceType" | "sourceId" | "amount" | "currency" | "payoutAccountId" | "approvedAt" | "createdAt">,
  payoutAccount: Pick<PayoutAccount, "id" | "userId" | "accountNumber" | "provider" | "destinationChangedAt" | "createdAt">,
  safeguards?: PayoutSafeguards
): Promise<RiskAssessment> {
  const flags: RiskFlag[] = [];
  const decisionTime = disbursement.approvedAt ?? disbursement.createdAt;
  const limits = safeguards ?? (await loadPayoutSafeguards());

  // Recent destination change: the account's money-carrying fields were set
  // or edited shortly before this payout was approved. Anchored on
  // destinationChangedAt, which only moves when the number/name/provider
  // actually changes — never on verifiedAt, which routine re-verification
  // overwrites and which therefore says nothing about the destination.
  const accountAnchor = payoutAccount.destinationChangedAt ?? payoutAccount.createdAt;
  if (accountAnchor && hoursBetween(decisionTime, accountAnchor) <= limits.recentChangeHours) {
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

  // Absolute size, independent of the payee's history. The relative outlier
  // check above needs three prior payouts, so a new or barely-used payee
  // could otherwise receive any amount with nothing stronger than MEDIUM.
  const amountTzs = await toTzs(Number(disbursement.amount), disbursement.currency);
  if (limits.reviewThresholdTzs !== null && (amountTzs === null || amountTzs >= limits.reviewThresholdTzs)) {
    flags.push("AMOUNT_AT_REVIEW_THRESHOLD");
  }

  // Rolling 24h total to this payee across every destination they own:
  // in-flight and paid payouts, plus this one. Stops a takeover from draining
  // an account through many payouts that are each individually unremarkable.
  if (limits.dailyCapPerPayeeTzs !== null) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.disbursement.findMany({
      where: {
        id: { not: disbursement.id },
        payoutAccount: { is: { userId: payoutAccount.userId } },
        OR: [
          { status: "PAID", paidAt: { gte: since } },
          { status: { in: DAILY_CAP_STATUSES.filter((st) => st !== "PAID") } },
        ],
      },
      select: { amount: true, currency: true },
    });
    let total: number | null = amountTzs;
    for (const row of recent) {
      const inTzs = await toTzs(Number(row.amount), row.currency);
      total = total === null || inTzs === null ? null : total + inTzs;
    }
    if (total === null || total > limits.dailyCapPerPayeeTzs) flags.push("PAYEE_DAILY_CAP_EXCEEDED");
  }

  const level = scoreLevel(flags);
  return { level, flags };
}

/**
 * Flags that, on their own, never need a person in the AUTO payout lane
 * (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md): a payee's first payout to a
 * destination they have used before is excluded elsewhere, and the hour a
 * system approval happens says nothing about takeover.
 */
const AUTO_LANE_HARMLESS_FLAGS: ReadonlySet<RiskFlag> = new Set(["FIRST_PAYOUT_TO_BENEFICIARY", "AFTER_HOURS_APPROVAL"]);

/** LOW, or MEDIUM where every flag is harmless. Anything else needs a person. */
export function isAutoLaneRisk(assessment: RiskAssessment): boolean {
  if (assessment.level === "LOW") return true;
  if (assessment.level !== "MEDIUM") return false;
  return assessment.flags.every((flag) => AUTO_LANE_HARMLESS_FLAGS.has(flag));
}

/**
 * Weights, not flag counts. Counting flags made "new partner approved in the
 * evening" (three weak signals) score the same as a genuine takeover, which
 * is the failure mode that fills the security queue with noise.
 */
const FLAG_WEIGHTS: Record<RiskFlag, number> = {
  ACCOUNT_SHARED_ACROSS_PARTNERS: 3,
  REPEATED_RECENT_FAILURES: 3,
  AMOUNT_AT_REVIEW_THRESHOLD: 6,
  PAYEE_DAILY_CAP_EXCEEDED: 6,
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
  // The admin-set limits are hard rules: a payout past either one always
  // needs a person to look at it, whatever else is or is not true.
  if (has("AMOUNT_AT_REVIEW_THRESHOLD")) return "HIGH";
  if (has("PAYEE_DAILY_CAP_EXCEEDED")) return "HIGH";
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

/**
 * AUTO payout lane: which lane an owner withdrawal takes, and starting an
 * automatic payout (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md, Phase 3, section 6).
 *
 * The AUTO lane only replaces the admin clicks between an OTP-confirmed
 * withdrawal and a batch: the claim is approved by the system, the
 * disbursement is created and approved with releaseLane AUTO, and the release
 * worker forms and authorizes a system batch under the daily cap. Everything
 * the human lane checks still runs (eligibility, name-lookup re-verification,
 * fingerprints, risk scoring), and anything unusual goes to a person.
 */

import { prisma } from "@nolsaf/prisma";
import { Prisma, type PayoutAccount } from "@prisma/client";
import { assessDisbursementRisk, isAutoLaneRisk, loadPayoutSafeguards } from "./riskScoring.js";
import { approveDisbursementAutomatically, requestDisbursement } from "./ledger.js";
import { loadOwnerPayoutControl } from "./ownerPayoutControl.js";

export type PayoutLane = "AUTO" | "MANUAL";

export async function loadAutoLaneSettings() {
  const row = await prisma.systemSetting.findUnique({
    where: { id: 1 },
    select: { autoPayoutEnabled: true, autoPayoutDailyCapTzs: true, payoutUnclaimedAutoDays: true },
  });
  const cap = Number(row?.autoPayoutDailyCapTzs ?? 0);
  const days = Number(row?.payoutUnclaimedAutoDays ?? 0);
  return {
    enabled: Boolean(row?.autoPayoutEnabled),
    dailyCapTzs: cap > 0 ? cap : null,
    unclaimedAutoDays: days > 0 ? days : null,
  };
}

/** Hard ceiling on the admin's first-payout setting: no setting can send more without a person. */
export const OWNER_FIRST_PAYOUT_AUTO_CEILING_TZS = 2_000_000;
export const OWNER_WITHDRAWAL_REVIEW_ALERT_DEFAULT_HOURS = 4;
export const OWNER_WITHDRAWAL_REVIEW_ALERT_MIN_HOURS = 1;
export const OWNER_WITHDRAWAL_REVIEW_ALERT_MAX_HOURS = 24;

/**
 * Admin-set owner payout policy. Fails to the safe built-in behaviour (every
 * first payout to a person, alert after 4 hours) when the columns are missing,
 * e.g. before migration 20261125100000 is applied, or hold a bad value.
 */
export async function loadOwnerPayoutPolicy(): Promise<{ firstPayoutAutoMaxTzs: number | null; reviewAlertHours: number }> {
  try {
    const row: any = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { ownerFirstPayoutAutoMaxTzs: true, ownerWithdrawalReviewAlertHours: true } as any,
    });
    const max = Number(row?.ownerFirstPayoutAutoMaxTzs);
    const hours = Number(row?.ownerWithdrawalReviewAlertHours);
    return {
      firstPayoutAutoMaxTzs: Number.isSafeInteger(max) && max > 0 ? Math.min(max, OWNER_FIRST_PAYOUT_AUTO_CEILING_TZS) : null,
      reviewAlertHours: Number.isFinite(hours) && hours > 0
        ? Math.min(OWNER_WITHDRAWAL_REVIEW_ALERT_MAX_HOURS, Math.max(OWNER_WITHDRAWAL_REVIEW_ALERT_MIN_HOURS, Math.round(hours)))
        : OWNER_WITHDRAWAL_REVIEW_ALERT_DEFAULT_HOURS,
    };
  } catch {
    return { firstPayoutAutoMaxTzs: null, reviewAlertHours: OWNER_WITHDRAWAL_REVIEW_ALERT_DEFAULT_HOURS };
  }
}

function nameTokens(value: unknown): string[] {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * Does the wallet holder name (from AzamPay Name Lookup) belong to the owner?
 * Two shared names, or one when either side has only one. Order-free, so
 * "MTUMWA ASHA" matches "Asha Mtumwa Juma". A wallet in someone else's name
 * is the takeover shape and always goes to a person.
 */
export function walletNameMatchesOwner(walletName: unknown, ownerNames: unknown[]): boolean {
  const wallet = new Set(nameTokens(walletName));
  if (!wallet.size) return false;
  return ownerNames.some((ownerName) => {
    const owner = new Set(nameTokens(ownerName));
    if (!owner.size) return false;
    const shared = [...owner].filter((t) => wallet.has(t)).length;
    const needed = Math.min(2, owner.size, wallet.size);
    return shared >= needed;
  });
}

/**
 * Section 6 of the plan, in order. Everything that is not clearly fine goes
 * MANUAL with a reason an admin (and the owner) can read.
 */
export async function decideOwnerPayoutLane(input: {
  ownerId: number;
  invoiceId: number;
  amount: number;
  account: Pick<PayoutAccount, "id" | "userId" | "accountNumber" | "provider" | "destinationChangedAt" | "createdAt"> & { accountName?: string | null };
  now?: Date;
  /**
   * What is being paid, when it is not a single owner invoice. An amount
   * withdrawal is scored as its own OWNER_WITHDRAWAL row (already created, so
   * its id keeps it out of its own history queries).
   */
  source?: { type: "OWNER_WITHDRAWAL"; id: number; disbursementId: number };
}): Promise<{ lane: PayoutLane; reason: string | null }> {
  const now = input.now ?? new Date();
  // Admin controls on this owner come first: a paused or always-checked owner
  // never takes the automatic lane, whatever else is true.
  const control = await loadOwnerPayoutControl(input.ownerId);
  if (control.hold) return { lane: "MANUAL", reason: "Payouts are paused for this owner by an admin" };
  if (control.alwaysReview) return { lane: "MANUAL", reason: "An admin set this owner's payouts to always be checked" };
  const settings = await loadAutoLaneSettings();
  if (!settings.enabled) return { lane: "MANUAL", reason: "Automatic payouts are switched off" };
  if (settings.dailyCapTzs === null) return { lane: "MANUAL", reason: "No daily limit is set for automatic payouts" };
  if (input.amount > settings.dailyCapTzs) return { lane: "MANUAL", reason: "Larger than the daily automatic limit" };

  const paidBefore = await prisma.disbursement.count({
    where: { status: "PAID", payoutAccount: { is: { userId: input.ownerId } } },
  });
  if (paidBefore === 0) {
    // A new owner's first payout goes to a person unless the admin set a
    // first-payout limit, the amount is within it, and the wallet is in the
    // owner's own name. The risk checks below still apply on top.
    const policy = await loadOwnerPayoutPolicy();
    if (policy.firstPayoutAutoMaxTzs === null) return { lane: "MANUAL", reason: "First payout to this owner is checked by our team" };
    if (input.amount > policy.firstPayoutAutoMaxTzs) {
      return { lane: "MANUAL", reason: "First payout above the automatic first-payout limit is checked by our team" };
    }
    const owner = await prisma.user.findUnique({ where: { id: input.ownerId }, select: { name: true, fullName: true } });
    if (!walletNameMatchesOwner(input.account.accountName, [owner?.fullName, owner?.name])) {
      return { lane: "MANUAL", reason: "First payout: the wallet name does not match the owner's name" };
    }
  }

  // Scored as it would be at batching, before any row exists (id 0 matches
  // nothing in the history queries).
  const risk = await assessDisbursementRisk(
    {
      id: input.source?.disbursementId ?? 0,
      sourceType: input.source?.type ?? "OWNER_INVOICE",
      sourceId: input.source?.id ?? input.invoiceId,
      amount: new Prisma.Decimal(input.amount),
      currency: "TZS",
      payoutAccountId: input.account.id,
      approvedAt: now,
      createdAt: now,
    },
    input.account,
    await loadPayoutSafeguards()
  );
  if (!isAutoLaneRisk(risk)) {
    return { lane: "MANUAL", reason: `Needs a review (${risk.level}: ${risk.flags.join(", ") || "no specific flag"})` };
  }
  return { lane: "AUTO", reason: null };
}

/**
 * Approves the owner's claim as the system, then creates and system-approves
 * its disbursement. Returns the disbursement id, or a reason when any step
 * refused; the caller then hands the claim to admins instead. Never sends
 * money itself: the release worker batches and authorizes under the cap.
 */
export async function startAutoPayout(input: {
  ownerId: number;
  invoiceId: number;
  payoutAccountId: number;
  now?: Date;
}): Promise<{ ok: true; disbursementId: number } | { ok: false; reason: string }> {
  const now = input.now ?? new Date();
  try {
    const approved = await prisma.invoice.updateMany({
      where: { id: input.invoiceId, ownerId: input.ownerId, status: { in: ["DRAFT", "REQUESTED", "VERIFIED"] } },
      data: { status: "APPROVED", approvedAt: now },
    });
    if (approved.count !== 1) {
      const current = await prisma.invoice.findUnique({ where: { id: input.invoiceId }, select: { status: true } });
      if (current?.status !== "APPROVED") return { ok: false, reason: `Claim is ${current?.status ?? "missing"}` };
    }
    await prisma.auditLog
      .create({
        data: {
          actorId: null,
          actorRole: "SYSTEM",
          action: "OWNER_INVOICE_APPROVED_AUTO",
          entity: "Invoice",
          entityId: input.invoiceId,
          afterJson: { status: "APPROVED", reason: "OWNER_WITHDRAWAL_OTP" },
        },
      })
      .catch(() => {});

    const requested = await requestDisbursement({
      sourceType: "OWNER_INVOICE",
      sourceId: input.invoiceId,
      payoutAccountId: input.payoutAccountId,
      requestedById: input.ownerId,
      remarks: "Owner withdrawal (automatic)",
    });
    const disbursement = await approveDisbursementAutomatically(requested.id);
    return { ok: true, disbursementId: disbursement.id };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message || "Automatic payout could not start").slice(0, 250) };
  }
}

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

/**
 * Section 6 of the plan, in order. Everything that is not clearly fine goes
 * MANUAL with a reason an admin (and the owner) can read.
 */
export async function decideOwnerPayoutLane(input: {
  ownerId: number;
  invoiceId: number;
  amount: number;
  account: Pick<PayoutAccount, "id" | "userId" | "accountNumber" | "provider" | "destinationChangedAt" | "createdAt">;
  now?: Date;
}): Promise<{ lane: PayoutLane; reason: string | null }> {
  const now = input.now ?? new Date();
  const settings = await loadAutoLaneSettings();
  if (!settings.enabled) return { lane: "MANUAL", reason: "Automatic payouts are switched off" };
  if (settings.dailyCapTzs === null) return { lane: "MANUAL", reason: "No daily limit is set for automatic payouts" };
  if (input.amount > settings.dailyCapTzs) return { lane: "MANUAL", reason: "Larger than the daily automatic limit" };

  const paidBefore = await prisma.disbursement.count({
    where: { status: "PAID", payoutAccount: { is: { userId: input.ownerId } } },
  });
  if (paidBefore === 0) return { lane: "MANUAL", reason: "First payout to this owner is checked by our team" };

  // Scored as it would be at batching, before any row exists (id 0 matches
  // nothing in the history queries).
  const risk = await assessDisbursementRisk(
    {
      id: 0,
      sourceType: "OWNER_INVOICE",
      sourceId: input.invoiceId,
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

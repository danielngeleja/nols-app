/** Amount-based owner withdrawals. Every confirmed code reserves exact parts
 * of booking claims before a disbursement can be created. */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { generate6, hashCode } from "../../lib/otp.js";
import { decideRelease, loadReleaseContext, payoutReleaseEnabled, verifiedPayoutAccounts } from "./release.js";
import { loadPayoutSafeguards } from "./riskScoring.js";
import { openRecoveryTotal, recoveredFromClaim } from "./recovery.js";
import { disbursementSendingEnabled } from "./senderSwitch.js";
import { requestDisbursement } from "./ledger.js";
import { ensureRecoveryDeduction } from "./recovery.js";
import { notifyAdmins, notifyOwner } from "../../lib/notifications.js";
import { retentionFields } from "../../lib/auditRetention.js";
import {
  assertWithdrawalOtpUnlocked, codeMatches, deliverCode, loadOwnerContact,
  maskDestination, recordWrongWithdrawalCode, withdrawalAccountFingerprint,
  WithdrawalError,
} from "./withdrawal.js";
import { assertOwnerWithdrawalAmount, lockOwnerWithdrawalDay, ownerWithdrawalAllowance } from "./ownerWithdrawalLimit.js";

const TTL_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;
const CENT = 0.005;
const round2 = (value: number) => Math.round(value * 100) / 100;

export type WithdrawalAllocationPlan = {
  releaseId: number;
  invoiceId: number;
  grossAmount: number;
  recoveryDeduction: number;
  recoveryTarget: number;
};

function validPlan(value: unknown): value is WithdrawalAllocationPlan[] {
  return Array.isArray(value) && value.length > 0 && value.every((row) =>
    row && typeof row === "object" && Number.isSafeInteger(row.releaseId) && row.releaseId > 0 &&
    Number.isSafeInteger(row.invoiceId) && row.invoiceId > 0 &&
    Number.isFinite(row.grossAmount) && row.grossAmount > 0 &&
    Number.isFinite(row.recoveryDeduction) && row.recoveryDeduction >= 0 && row.recoveryDeduction <= row.grossAmount &&
    Number.isFinite(row.recoveryTarget) && row.recoveryTarget >= 0,
  );
}

export function amountWithdrawalFingerprint(input: {
  ownerId: number; amount: number; plan: WithdrawalAllocationPlan[]; openDebt: number; accountFingerprint: string;
}): string {
  return createHash("sha256").update(JSON.stringify({
    version: 2, ownerId: input.ownerId, currency: "TZS", amount: round2(input.amount),
    plan: input.plan.map((row) => [row.releaseId, row.invoiceId, round2(row.grossAmount), round2(row.recoveryDeduction), round2(row.recoveryTarget)]),
    openDebt: round2(input.openDebt), account: input.accountFingerprint,
  })).digest("hex");
}

async function readyBalances(ownerId: number, now: Date) {
  const releases = await prisma.payoutRelease.findMany({
    where: { ownerId, status: "AVAILABLE" },
    select: { id: true, status: true, sourceId: true, bookingId: true, ownerId: true, releaseAt: true },
    orderBy: [{ releaseAt: "asc" }, { id: "asc" }],
  });
  if (!releases.length) return [];
  const reserved = await prisma.payoutWithdrawalAllocation.groupBy({
    by: ["releaseId"], where: { releaseId: { in: releases.map((row) => row.id) }, cancelledAt: null }, _sum: { grossAmount: true },
  });
  const reservedByRelease = new Map<number, number>(reserved.map((row) => [row.releaseId, Number(row._sum.grossAmount ?? 0)]));
  const balances: Array<{ releaseId: number; invoiceId: number; remaining: number; alreadyRecovered: number }> = [];
  for (const release of releases) {
    if (decideRelease(await loadReleaseContext(release, now)).next !== "AVAILABLE") continue;
    const invoice = await prisma.invoice.findUnique({
      where: { id: release.sourceId }, select: { ownerId: true, netPayable: true, status: true },
    });
    if (!invoice || invoice.ownerId !== ownerId || invoice.netPayable == null ||
      !["DRAFT", "REQUESTED", "VERIFIED", "APPROVED"].includes(invoice.status)) continue;
    const remaining = round2(Number(invoice.netPayable) - (reservedByRelease.get(release.id) ?? 0));
    if (remaining > CENT) balances.push({ releaseId: release.id, invoiceId: release.sourceId, remaining, alreadyRecovered: await recoveredFromClaim(release.sourceId) });
  }
  return balances;
}

export function allocateWithdrawal(
  balances: Array<{ releaseId: number; invoiceId: number; remaining: number; alreadyRecovered: number }>,
  amount: number,
  openDebt: number,
): WithdrawalAllocationPlan[] {
  let grossNeeded = round2(amount + openDebt);
  let debtRemaining = openDebt;
  const plan: WithdrawalAllocationPlan[] = [];
  for (const row of balances) {
    if (grossNeeded <= CENT) break;
    const grossAmount = round2(Math.min(grossNeeded, row.remaining));
    const deduction = round2(Math.min(debtRemaining, grossAmount));
    plan.push({ releaseId: row.releaseId, invoiceId: row.invoiceId, grossAmount,
      recoveryDeduction: deduction, recoveryTarget: round2(row.alreadyRecovered + deduction) });
    grossNeeded = round2(grossNeeded - grossAmount);
    debtRemaining = round2(debtRemaining - deduction);
  }
  if (grossNeeded > CENT || debtRemaining > CENT || !plan.length) {
    throw new WithdrawalError("CHANGED", "The ready booking balance changed. Refresh and try again.");
  }
  return plan;
}

async function planWithdrawal(ownerId: number, amount: number, now: Date) {
  const [balances, openDebt, allowance] = await Promise.all([
    readyBalances(ownerId, now), openRecoveryTotal(ownerId), ownerWithdrawalAllowance(ownerId, now),
  ]);
  assertOwnerWithdrawalAmount(amount, allowance);
  const grossAvailable = round2(balances.reduce((sum, row) => sum + row.remaining, 0));
  if (grossAvailable <= CENT) throw new WithdrawalError("NOTHING_AVAILABLE", "There is nothing ready to withdraw right now.");
  if (amount > round2(grossAvailable - openDebt) + CENT) {
    throw new WithdrawalError("CHANGED", "This amount exceeds your ready balance after an earlier refund is recovered.");
  }

  const plan = allocateWithdrawal(balances, amount, openDebt);
  return { plan, openDebt, allowance, grossTotal: round2(amount + openDebt) };
}

export async function startAmountWithdrawal(ownerId: number, amount: number, now = new Date()) {
  if (!payoutReleaseEnabled()) throw new WithdrawalError("FEATURE_OFF", "Withdrawals are not available yet.", 404);
  if (!disbursementSendingEnabled()) throw new WithdrawalError("SENDING_PAUSED", "Withdrawals are temporarily paused.", 503);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new WithdrawalError("CHANGED", "Enter a whole TZS withdrawal amount greater than zero.", 400);
  }
  await assertWithdrawalOtpUnlocked(ownerId);
  const owner = await loadOwnerContact(ownerId);
  if (!owner) throw new WithdrawalError("NOT_FOUND", "Account not found.", 404);
  if (!(owner.phone && owner.phoneVerifiedAt) && !(owner.email && owner.emailVerifiedAt)) {
    throw new WithdrawalError("NO_VERIFIED_CONTACT", "Verify your phone number or email before withdrawing.");
  }
  const { recentChangeHours } = await loadPayoutSafeguards();
  const changedAt = [owner.phoneChangedAt, owner.emailChangedAt]
    .filter((date): date is Date => !!date).sort((a, b) => b.getTime() - a.getTime())[0];
  if (changedAt && now.getTime() < changedAt.getTime() + recentChangeHours * HOUR_MS) {
    throw new WithdrawalError("CONTACT_RECENTLY_CHANGED", "Withdrawals are paused after a phone or email change.", 409, {
      availableAfter: new Date(changedAt.getTime() + recentChangeHours * HOUR_MS).toISOString(),
    });
  }
  if (await prisma.payoutWithdrawalChallenge.count({
    where: { userId: ownerId, createdAt: { gte: new Date(now.getTime() - 15 * 60_000) } },
  }) >= 3) throw new WithdrawalError("TOO_MANY_REQUESTS", "Too many codes requested. Try again in 15 minutes.", 429);
  if (await prisma.payoutWithdrawalChallenge.count({
    where: { userId: ownerId, planVersion: 2, usedAt: { not: null }, handoffStatus: { in: ["PENDING", "PROCESSING", "REVIEW_REQUIRED"] } },
  })) throw new WithdrawalError("CHANGED", "Your previous withdrawal is still being prepared. Try again once it is queued.");

  const account = (await verifiedPayoutAccounts(ownerId))[0];
  if (!account) throw new WithdrawalError("NO_PAYOUT_ACCOUNT", "Add and verify a mobile money payout account first.");
  const { plan, openDebt, allowance, grossTotal } = await planWithdrawal(ownerId, amount, now);
  const accountFingerprint = withdrawalAccountFingerprint(account);
  const code = generate6();
  const challenge = await prisma.payoutWithdrawalChallenge.create({ data: {
    reference: `wd_${randomBytes(18).toString("base64url")}`,
    userId: ownerId,
    releaseIds: plan.map((row) => row.releaseId),
    totalAmount: new Prisma.Decimal(amount),
    currency: "TZS",
    fingerprint: amountWithdrawalFingerprint({ ownerId, amount, plan, openDebt, accountFingerprint }),
    planVersion: 2,
    allocationPlan: plan as unknown as Prisma.InputJsonValue,
    payoutAccountId: account.id,
    accountFingerprint,
    codeHash: hashCode(code), channel: "SMS",
    destinationMasked: maskDestination(account.provider, account.accountNumber),
    expiresAt: new Date(now.getTime() + TTL_MS),
  } });
  try {
    await assertWithdrawalOtpUnlocked(ownerId);
    const delivered = await deliverCode(owner, code, amount, challenge.destinationMasked, plan.length);
    if (delivered.channel !== "SMS") await prisma.payoutWithdrawalChallenge.update({
      where: { id: challenge.id }, data: { channel: delivered.channel },
    });
    await prisma.payoutWithdrawalChallenge.updateMany({
      where: { userId: ownerId, id: { not: challenge.id }, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    return {
      challengeRef: challenge.reference, channel: delivered.channel, sentTo: delivered.sentTo,
      expiresAt: challenge.expiresAt, total: amount, grossTotal,
      recoveryDeduction: openDebt, currency: "TZS", destination: challenge.destinationMasked,
      count: plan.length, dailyLimit: allowance.limit, dailyRemaining: allowance.remaining,
    };
  } catch (error) {
    await prisma.payoutWithdrawalChallenge.update({ where: { id: challenge.id }, data: { expiresAt: now } });
    throw error;
  }
}

export async function confirmAmountWithdrawal(ownerId: number, challengeRef: string, code: string, now = new Date()) {
  if (!payoutReleaseEnabled()) throw new WithdrawalError("FEATURE_OFF", "Withdrawals are not available yet.", 404);
  if (!disbursementSendingEnabled()) throw new WithdrawalError("SENDING_PAUSED", "Withdrawals are temporarily paused.", 503);
  await assertWithdrawalOtpUnlocked(ownerId);
  const challenge = await prisma.payoutWithdrawalChallenge.findUnique({ where: { reference: challengeRef } });
  if (!challenge || challenge.userId !== ownerId || challenge.planVersion !== 2) {
    throw new WithdrawalError("NOT_FOUND", "This withdrawal request was not found. Start again.", 404);
  }
  if (challenge.usedAt) throw new WithdrawalError("ALREADY_USED", "This code was already used. Start again.");
  if (challenge.expiresAt <= now) throw new WithdrawalError("EXPIRED", "This code has expired. Start again.");
  if (challenge.attempts >= 3) throw new WithdrawalError("TOO_MANY_ATTEMPTS", "Too many wrong codes. Start again.");
  if (!codeMatches(code, challenge.codeHash)) {
    const failures = await recordWrongWithdrawalCode(ownerId, challenge.id, now);
    if (failures >= 3) throw new WithdrawalError("OTP_LOCKED", "Withdrawal verification is locked. Contact NoLSAF support.", 423);
    throw new WithdrawalError("INVALID_CODE", "That code is not correct.", 400, { attemptsRemaining: 3 - failures });
  }
  const amount = Number(challenge.totalAmount);
  const storedPlan = challenge.allocationPlan;
  if (!validPlan(storedPlan) || !challenge.accountFingerprint || !challenge.payoutAccountId) {
    throw new WithdrawalError("CHANGED", "The withdrawal plan is incomplete. Start again.");
  }
  const account = (await verifiedPayoutAccounts(ownerId)).find((row) => row.id === challenge.payoutAccountId);
  if (!account || withdrawalAccountFingerprint(account) !== challenge.accountFingerprint) {
    throw new WithdrawalError("CHANGED", "The payout account changed. Start again.");
  }
  const live = await planWithdrawal(ownerId, amount, now);
  const fingerprint = amountWithdrawalFingerprint({
    ownerId, amount, plan: live.plan, openDebt: live.openDebt, accountFingerprint: challenge.accountFingerprint,
  });
  if (fingerprint !== challenge.fingerprint || JSON.stringify(live.plan) !== JSON.stringify(storedPlan)) {
    throw new WithdrawalError("CHANGED", "The ready balance changed. Refresh and request a new code.");
  }

  await prisma.$transaction(async (tx) => {
    await lockOwnerWithdrawalDay(tx, ownerId);
    if (await tx.payoutWithdrawalChallenge.count({
      where: { userId: ownerId, planVersion: 2, usedAt: { not: null }, handoffStatus: { in: ["PENDING", "PROCESSING", "REVIEW_REQUIRED"] } },
    })) throw new WithdrawalError("CHANGED", "Your previous withdrawal is still being prepared. Start again once it is queued.");
    assertOwnerWithdrawalAmount(amount, await ownerWithdrawalAllowance(ownerId, now, tx));
    const liveAccount = await tx.payoutAccount.findUnique({ where: { id: account.id }, select: {
      id: true, userId: true, provider: true, accountNumber: true, destinationChangedAt: true, isActive: true, isVerified: true,
    } });
    if (!liveAccount || liveAccount.userId !== ownerId || !liveAccount.isActive || !liveAccount.isVerified ||
      withdrawalAccountFingerprint(liveAccount) !== challenge.accountFingerprint) {
      throw new WithdrawalError("CHANGED", "The payout account changed. Start again.");
    }
    const debtRows = await tx.ownerPayoutRecovery.findMany({
      where: { ownerId, status: "OPEN" }, select: { amount: true, recoveredAmount: true },
    });
    const currentDebt = round2(debtRows.reduce((sum, row) => sum + Number(row.amount) - Number(row.recoveredAmount), 0));
    if (Math.abs(currentDebt - live.openDebt) > CENT) throw new WithdrawalError("CHANGED", "The recovery balance changed. Start again.");
    for (const row of storedPlan) {
      const release = await tx.payoutRelease.findUnique({ where: { id: row.releaseId }, select: {
        status: true, ownerId: true, sourceId: true,
      } });
      const invoice = await tx.invoice.findUnique({ where: { id: row.invoiceId }, select: {
        ownerId: true, netPayable: true, status: true,
      } });
      if (!release || release.status !== "AVAILABLE" || release.ownerId !== ownerId || release.sourceId !== row.invoiceId ||
        !invoice || invoice.ownerId !== ownerId || invoice.netPayable == null ||
        !["DRAFT", "REQUESTED", "VERIFIED", "APPROVED"].includes(invoice.status)) {
        throw new WithdrawalError("CHANGED", "A booking is no longer ready. Start again.");
      }
      const prior = await tx.payoutWithdrawalAllocation.aggregate({ where: { releaseId: row.releaseId, cancelledAt: null }, _sum: { grossAmount: true } });
      if (Number(prior._sum.grossAmount ?? 0) + row.grossAmount > Number(invoice.netPayable) + CENT) {
        throw new WithdrawalError("CHANGED", "A booking's remaining balance changed. Start again.");
      }
      const legacy = await tx.disbursement.findFirst({
        where: { sourceType: "OWNER_INVOICE", sourceId: row.invoiceId, status: { not: "FAILED" } }, select: { id: true },
      });
      if (legacy) throw new WithdrawalError("CHANGED", "This booking already has a payout in progress. Start again.");
    }
    const spent = await tx.payoutWithdrawalChallenge.updateMany({
      where: { id: challenge.id, userId: ownerId, usedAt: null, expiresAt: { gt: now }, attempts: { lt: 3 } },
      data: { usedAt: now, handoffStatus: "PENDING", handoffNextAttemptAt: now },
    });
    if (spent.count !== 1) throw new WithdrawalError("ALREADY_USED", "This code was already used. Start again.");
    await tx.payoutWithdrawalAllocation.createMany({ data: storedPlan.map((row) => ({
      challengeId: challenge.id, releaseId: row.releaseId, invoiceId: row.invoiceId,
      grossAmount: new Prisma.Decimal(row.grossAmount), recoveryDeduction: new Prisma.Decimal(row.recoveryDeduction),
      recoveryTarget: new Prisma.Decimal(row.recoveryTarget),
    })) });
    await tx.payoutWithdrawalChallenge.updateMany({
      where: { userId: ownerId, id: { not: challenge.id }, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
  });
  return {
    count: storedPlan.length, total: amount, recoveryDeduction: live.openDebt,
    currency: "TZS", destination: challenge.destinationMasked,
    queuedCount: 1, status: "PROCESSING" as const,
  };
}

/** Durable bridge from a confirmed amount to one finance-controlled transfer.
 * A crash after requestDisbursement is idempotently recovered by finding the
 * active source; a failed source requires finance reconciliation. */
export async function processAmountWithdrawalHandoffs(now = new Date(), limit = 20) {
  const result = { done: 0, retried: 0, review: 0 };
  if (!payoutReleaseEnabled() || !disbursementSendingEnabled()) return result;
  const pending = await prisma.payoutWithdrawalChallenge.findMany({
    where: {
      planVersion: 2, usedAt: { not: null },
      OR: [
        { handoffStatus: "PENDING", handoffNextAttemptAt: { lte: now } },
        { handoffStatus: "PROCESSING", handoffLeaseUntil: { lte: now } },
      ],
    }, orderBy: { id: "asc" }, take: limit,
  });
  for (const challenge of pending) {
    const claimed = await prisma.payoutWithdrawalChallenge.updateMany({
      where: { id: challenge.id, OR: [
        { handoffStatus: "PENDING", handoffNextAttemptAt: { lte: now } },
        { handoffStatus: "PROCESSING", handoffLeaseUntil: { lte: now } },
      ] },
      data: { handoffStatus: "PROCESSING", handoffAttempts: { increment: 1 }, handoffLeaseUntil: new Date(now.getTime() + 10 * 60_000) },
    });
    if (claimed.count !== 1) continue;
    try {
      const account = (await verifiedPayoutAccounts(challenge.userId)).find((row) => row.id === challenge.payoutAccountId);
      if (!account || !challenge.accountFingerprint || withdrawalAccountFingerprint(account) !== challenge.accountFingerprint) {
        throw new Error("The confirmed payout account changed or is no longer verified");
      }
      const allocations = await prisma.payoutWithdrawalAllocation.findMany({
        where: { challengeId: challenge.id, cancelledAt: null }, orderBy: { id: "asc" },
      });
      if (!allocations.length || allocations.length !== (Array.isArray(challenge.releaseIds) ? challenge.releaseIds.length : -1)) {
        throw new Error("The confirmed booking allocation is incomplete");
      }
      for (const allocation of allocations) {
        const applied = await ensureRecoveryDeduction(
          challenge.userId, allocation.invoiceId, Number(allocation.recoveryTarget), now,
        );
        if (Math.abs(applied - Number(allocation.recoveryTarget)) > CENT) {
          throw new Error(`Recovery amount for invoice ${allocation.invoiceId} changed`);
        }
      }
      const existing = await prisma.disbursement.findFirst({
        where: { sourceType: "OWNER_WITHDRAWAL", sourceId: challenge.id, status: { not: "FAILED" } },
        select: { id: true, amount: true, payoutAccountId: true },
      });
      if (existing && (existing.payoutAccountId !== account.id || Math.abs(Number(existing.amount) - Number(challenge.totalAmount)) > CENT)) {
        throw new Error("An existing transfer has a different amount or destination");
      }
      if (!existing) {
        const failed = await prisma.disbursement.findFirst({
          where: { sourceType: "OWNER_WITHDRAWAL", sourceId: challenge.id, status: "FAILED" }, select: { id: true },
        });
        if (failed) throw new Error("A failed transfer needs finance reconciliation before retrying");
        await requestDisbursement({
          sourceType: "OWNER_WITHDRAWAL", sourceId: challenge.id,
          payoutAccountId: account.id, requestedById: challenge.userId,
          remarks: "Owner amount withdrawal (OTP confirmed)",
        });
      }
      await prisma.payoutWithdrawalChallenge.update({
        where: { id: challenge.id }, data: { handoffStatus: "DONE", handoffLeaseUntil: null },
      });
      result.done++;
    } catch (error: any) {
      const attempts = challenge.handoffAttempts + 1;
      const review = attempts >= 5 || /changed|incomplete|reconciliation|different/i.test(String(error?.message ?? ""));
      await prisma.payoutWithdrawalChallenge.update({ where: { id: challenge.id }, data: {
        handoffStatus: review ? "REVIEW_REQUIRED" : "PENDING",
        handoffLeaseUntil: null, handoffNextAttemptAt: new Date(now.getTime() + 60_000),
      } });
      if (review) {
        result.review++;
        await notifyAdmins("owner_payout_withdrawal_review", {
          challengeId: challenge.id, ownerId: challenge.userId, reason: String(error?.message ?? error).slice(0, 300),
        }).catch(() => {});
        await notifyOwner(challenge.userId, "owner_payout_withdrawal_review", { challengeId: challenge.id }).catch(() => {});
      } else result.retried++;
    }
  }
  return result;
}

/** Finance-only recovery for a reviewed amount handoff. RESET releases the
 * booking portions only when no disbursement or recovery step ran. */
export async function resolveAmountWithdrawalHandoff(input: {
  challengeId: number; action: "RETRY" | "RESET"; adminId: number; note: string; now?: Date;
}) {
  const now = input.now ?? new Date();
  const ownerId = await prisma.$transaction(async (tx) => {
    const challenge = await tx.payoutWithdrawalChallenge.findUnique({
      where: { id: input.challengeId }, select: { id: true, userId: true, planVersion: true, handoffStatus: true },
    });
    if (!challenge || challenge.planVersion !== 2 || challenge.handoffStatus !== "REVIEW_REQUIRED") {
      throw new WithdrawalError("CHANGED", "This amount withdrawal no longer needs handoff review.");
    }
    await lockOwnerWithdrawalDay(tx, challenge.userId);
    if (input.action === "RESET") {
      const transfer = await tx.disbursement.findFirst({
        where: { sourceType: "OWNER_WITHDRAWAL", sourceId: challenge.id }, select: { id: true },
      });
      if (transfer) throw new WithdrawalError("CHANGED", "A transfer record exists. Reconcile it before releasing these booking balances.");
      const allocations = await tx.payoutWithdrawalAllocation.findMany({
        where: { challengeId: challenge.id, cancelledAt: null },
        select: { invoiceId: true, recoveryDeduction: true, recoveryTarget: true },
      });
      if (!allocations.length) throw new WithdrawalError("CHANGED", "The booking allocations are missing.");
      for (const allocation of allocations) {
        const current = await tx.ownerPayoutRecoveryApplication.aggregate({
          where: { invoiceId: allocation.invoiceId }, _sum: { amount: true },
        });
        const before = Number(allocation.recoveryTarget) - Number(allocation.recoveryDeduction);
        if (Math.abs(Number(current._sum.amount ?? 0) - before) > CENT) {
          throw new WithdrawalError("CHANGED", "A recovery was applied. Finance must reconcile it before releasing the balance.");
        }
      }
      await tx.payoutWithdrawalAllocation.updateMany({
        where: { challengeId: challenge.id, cancelledAt: null }, data: { cancelledAt: now },
      });
    }
    await tx.payoutWithdrawalChallenge.update({ where: { id: challenge.id }, data: {
      handoffStatus: input.action === "RETRY" ? "PENDING" : "CANCELLED",
      handoffAttempts: input.action === "RETRY" ? 0 : undefined,
      handoffLeaseUntil: null,
      handoffNextAttemptAt: input.action === "RETRY" ? now : null,
    } });
    await tx.auditLog.create({ data: {
      actorId: input.adminId, actorRole: "ADMIN", action: `OWNER_AMOUNT_WITHDRAWAL_HANDOFF_${input.action}`,
      entity: "PayoutWithdrawalChallenge", entityId: challenge.id,
      afterJson: { ownerId: challenge.userId, note: input.note }, ...retentionFields("FINANCIAL", now),
    } });
    return challenge.userId;
  });
  if (input.action === "RESET") await notifyOwner(ownerId, "owner_payout_withdrawal_reset", { challengeId: input.challengeId }).catch(() => {});
  return input.action;
}

/**
 * Owner Withdrawal — OTP-confirmed request for every AVAILABLE payout
 * (docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md, Phase 2, decision D1)
 *
 * The OTP fires when the owner taps Withdraw, never when money becomes
 * available. The code is bound to the exact releases, total and live payout
 * destination (fingerprint), so it cannot confirm a different withdrawal and
 * any change in between invalidates it. Single use, 5 minutes, 3 attempts.
 *
 * A confirmed withdrawal takes one of two lanes per payout (autoLane.ts):
 * AUTO, where the system approves and the release worker sends it under the
 * daily cap, or MANUAL, where the claim is submitted (DRAFT -> REQUESTED) and
 * admins pay it through the existing flow.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { generate6, hashCode } from "../../lib/otp.js";
import { sendSms } from "../../lib/sms.js";
import { sendMail, SECURITY_EMAIL_FROM } from "../../lib/mailer.js";
import { proEmail, proNoteCard, proReferenceCard } from "../../lib/emailBase.js";
import { notifyAdmins, notifyOwner } from "../../lib/notifications.js";
import { retentionFields } from "../../lib/auditRetention.js";
import {
  applyReleaseDecision,
  decideRelease,
  loadReleaseContext,
  payoutReleaseEnabled,
  verifiedPayoutAccounts,
} from "./release.js";
import { loadPayoutSafeguards } from "./riskScoring.js";
import { decideOwnerPayoutLane, loadAutoLaneSettings, startAutoPayout, type PayoutLane } from "./autoLane.js";
import { ensureRecoveryDeduction, openRecoveryTotal } from "./recovery.js";
import { approveDisbursementAutomatically } from "./ledger.js";
import { disbursementSendingEnabled } from "./senderSwitch.js";
import { assertOwnerWithdrawalAmount, lockOwnerWithdrawalDay, ownerWithdrawalAllowance } from "./ownerWithdrawalLimit.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const CHALLENGES_PER_WINDOW = 3;
const CHALLENGE_WINDOW_MS = 15 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export class WithdrawalError extends Error {
  constructor(
    readonly code:
      | "FEATURE_OFF"
      | "SENDING_PAUSED"
      | "NOTHING_AVAILABLE"
      | "NO_PAYOUT_ACCOUNT"
      | "NO_VERIFIED_CONTACT"
      | "CONTACT_RECENTLY_CHANGED"
      | "TOO_MANY_REQUESTS"
      | "DELIVERY_FAILED"
      | "NOT_FOUND"
      | "EXPIRED"
      | "ALREADY_USED"
      | "TOO_MANY_ATTEMPTS"
      | "OTP_LOCKED"
      | "INVALID_CODE"
      | "CHANGED",
    message: string,
    readonly httpStatus = 409,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "WithdrawalError";
  }
}

const OTP_LOCK_MESSAGE = "Withdrawal verification is locked after three wrong codes. Contact NoLSAF support to verify your identity and restore withdrawals.";

export async function assertWithdrawalOtpUnlocked(ownerId: number) {
  const guard = await prisma.payoutWithdrawalOtpGuard.upsert({
    where: { ownerId }, create: { ownerId }, update: {},
  });
  if (guard.lockedAt || guard.failedAttempts >= MAX_ATTEMPTS) {
    throw new WithdrawalError("OTP_LOCKED", OTP_LOCK_MESSAGE, 423);
  }
  return guard;
}

/** Count a wrong code across every challenge for this owner. Database updates
 * serialize concurrent attempts and make the third failure a support lock. */
export async function recordWrongWithdrawalCode(ownerId: number, challengeId: number, now: Date): Promise<number> {
  const failures = await prisma.$transaction(async (tx) => {
    const guard = await tx.payoutWithdrawalOtpGuard.updateMany({
      where: { ownerId, lockedAt: null, failedAttempts: { lt: MAX_ATTEMPTS } },
      data: { failedAttempts: { increment: 1 } },
    });
    if (guard.count !== 1) throw new WithdrawalError("OTP_LOCKED", OTP_LOCK_MESSAGE, 423);
    const attempt = await tx.payoutWithdrawalChallenge.updateMany({
      where: { id: challengeId, userId: ownerId, usedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count !== 1) throw new WithdrawalError("TOO_MANY_ATTEMPTS", "This withdrawal code can no longer be used. Contact NoLSAF support.");
    const updated = await tx.payoutWithdrawalOtpGuard.findUniqueOrThrow({ where: { ownerId } });
    if (updated.failedAttempts >= MAX_ATTEMPTS) {
      await tx.payoutWithdrawalOtpGuard.update({ where: { ownerId }, data: { lockedAt: now } });
      await tx.payoutWithdrawalChallenge.updateMany({
        where: { userId: ownerId, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });
    }
    return updated.failedAttempts;
  });
  // Audit storage must not roll back a security lock or restore a spent guess.
  for (const action of failures >= MAX_ATTEMPTS
    ? ["OWNER_WITHDRAWAL_OTP_FAILED", "OWNER_WITHDRAWAL_OTP_LOCKED"]
    : ["OWNER_WITHDRAWAL_OTP_FAILED"]) {
    try {
      await prisma.auditLog.create({ data: {
        actorId: ownerId, actorRole: "OWNER", action, entity: "OWNER", entityId: ownerId,
        afterJson: { failedAttempts: failures, challengeId }, ...retentionFields("FINANCIAL"),
      } });
    } catch (error) {
      console.error("[owner-withdrawal] Could not record OTP security audit", { ownerId, action, error: String(error) });
    }
  }
  return failures;
}

function formatTzs(amount: number): string {
  return `TZS ${Math.round(amount).toLocaleString("en-US")}`;
}

/** "Vodacom ***456": enough for the owner to recognise it, never the full number. */
export function maskDestination(provider: string, accountNumber: string): string {
  const digits = String(accountNumber).replace(/\D/g, "");
  return `${provider} ***${digits.slice(-3)}`;
}

/** Locks a queued withdrawal to the account details the owner confirmed. */
export function withdrawalAccountFingerprint(account: {
  id: number; provider: string; accountNumber: string; destinationChangedAt: Date | null;
}): string {
  return createHash("sha256").update([
    account.id, account.provider, account.accountNumber,
    account.destinationChangedAt?.toISOString() ?? "-",
  ].join("|")).digest("hex");
}

/**
 * sha256 over the sorted release ids, the total, the currency and the live
 * destination. destinationChangedAt is part of it so re-saving the same
 * number through a change flow still breaks the binding.
 */
export function withdrawalFingerprint(input: {
  releaseIds: number[];
  total: number;
  currency: string;
  account: { id: number; provider: string; accountNumber: string; destinationChangedAt: Date | null };
  /** Open recovery debt when the code was issued: a new debt changes what is sent, so it breaks the code. */
  openDebt?: number;
}): string {
  const ids = [...input.releaseIds].sort((a, b) => a - b).join(",");
  const line = [
    ids,
    input.total.toFixed(2),
    input.currency,
    withdrawalAccountFingerprint(input.account),
    (input.openDebt ?? 0).toFixed(2),
  ].join("|");
  return createHash("sha256").update(line).digest("hex");
}

/**
 * Re-checks every AVAILABLE release now, not when the page loaded, and
 * persists any change (a new hold, a payout account change). Returns the
 * releases that are still withdrawable, with their claim amounts.
 */
async function withdrawableReleases(ownerId: number, now: Date) {
  const rows = await prisma.payoutRelease.findMany({
    where: { ownerId, status: "AVAILABLE" },
    select: { id: true, status: true, holdReason: true, sourceId: true, bookingId: true, ownerId: true, releaseAt: true },
    orderBy: { id: "asc" },
  });
  const ready: Array<{ id: number; sourceId: number; bookingId: number; amount: number }> = [];
  for (const row of rows) {
    // Amount-based withdrawals reserve slices of this invoice. The legacy
    // whole-invoice handoff must never claim it again, even if a slice remains.
    if (await prisma.payoutWithdrawalAllocation.findFirst({ where: { releaseId: row.id, cancelledAt: null }, select: { id: true } })) continue;
    const decision = decideRelease(await loadReleaseContext(row, now));
    if (decision.next !== "AVAILABLE") {
      await applyReleaseDecision(row, decision, now);
      continue;
    }
    const claim = await prisma.invoice.findUnique({ where: { id: row.sourceId }, select: { netPayable: true } });
    const amount = Number(claim?.netPayable ?? 0);
    if (amount > 0) ready.push({ id: row.id, sourceId: row.sourceId, bookingId: row.bookingId, amount });
  }
  return ready;
}

export async function loadOwnerContact(ownerId: number) {
  return prisma.user.findUnique({
    where: { id: ownerId },
    select: {
      name: true,
      fullName: true,
      email: true,
      phone: true,
      emailVerifiedAt: true,
      phoneVerifiedAt: true,
      emailChangedAt: true,
      phoneChangedAt: true,
    },
  });
}

function buildEmail(code: string, total: number, destination: string, count: number) {
  const body = `
    <p style="margin:0 0 16px;color:#374151;line-height:1.7;">
      You asked to withdraw your NoLSAF earnings. Check the amount and destination below before entering this code.
      If this was not you, do not enter it, and change your password immediately.
    </p>
    ${proReferenceCard("Withdrawal code", code, `This code expires in ${Math.ceil(CHALLENGE_TTL_MS / 60_000)} minutes.`, "#02665e", "#eaf7f4")}
    <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
    ${proNoteCard(
      "#92400e",
      `Withdrawing ${formatTzs(total)} to ${destination}`,
      `${count} payout(s). Never share this code. NoLSAF staff will never ask you for it.`,
      "#fffbeb"
    )}
  `;
  return { subject: `Your NoLSAF withdrawal code (${formatTzs(total)})`, html: proEmail("Confirm your withdrawal", body) };
}

/** Sends the code by SMS to the verified phone, falling back to verified email (decision D4). */
export async function deliverCode(
  owner: NonNullable<Awaited<ReturnType<typeof loadOwnerContact>>>,
  code: string,
  total: number,
  destination: string,
  count: number
): Promise<{ channel: "SMS" | "EMAIL"; sentTo: string }> {
  if (owner.phone && owner.phoneVerifiedAt) {
    const text =
      `NoLSAF code ${code} to withdraw ${formatTzs(total)} to ${destination}. ` +
      `Expires in ${Math.ceil(CHALLENGE_TTL_MS / 60_000)} min. Never share this code.`;
    try {
      const result = await sendSms(owner.phone, text, { bypassEligibilityCheck: true, sensitiveContent: true });
      if (result.success && result.provider && !["suppressed", "console"].includes(result.provider)) {
        return { channel: "SMS", sentTo: `***${owner.phone.replace(/\D/g, "").slice(-3)}` };
      }
    } catch (error) {
      console.warn("[owner-withdrawal] SMS OTP delivery failed; trying verified email", { error: String(error) });
    }
  }
  if (owner.email && owner.emailVerifiedAt) {
    const email = buildEmail(code, total, destination, count);
    const result = await sendMail(owner.email, email.subject, email.html, undefined, {
      bypassEligibilityCheck: true,
      from: SECURITY_EMAIL_FROM,
      replyTo: "support@nolsaf.com",
      sensitiveContent: true,
    });
    if (!result.success || ["suppressed", "console"].includes(result.provider)) {
      throw new WithdrawalError("DELIVERY_FAILED", "We could not send your withdrawal code. Check your verified phone or email.", 502);
    }
    const [local, domain] = owner.email.split("@");
    return { channel: "EMAIL", sentTo: `${local.slice(0, 2)}***@${domain}` };
  }
  throw new WithdrawalError("DELIVERY_FAILED", "We could not send your withdrawal code. Check your verified phone or email.", 502);
}

/** Step 1: the owner tapped Withdraw. Sends the code for every withdrawable payout. */
export async function startWithdrawal(ownerId: number, now = new Date()) {
  if (!payoutReleaseEnabled()) throw new WithdrawalError("FEATURE_OFF", "Withdrawals are not available yet.", 404);
  if (!disbursementSendingEnabled()) throw new WithdrawalError("SENDING_PAUSED", "Withdrawals are temporarily paused. No payout has been sent.", 503);

  const owner = await loadOwnerContact(ownerId);
  if (!owner) throw new WithdrawalError("NOT_FOUND", "Account not found.", 404);
  await assertWithdrawalOtpUnlocked(ownerId);
  if (!(owner.phone && owner.phoneVerifiedAt) && !(owner.email && owner.emailVerifiedAt)) {
    throw new WithdrawalError("NO_VERIFIED_CONTACT", "Verify your phone number or email before withdrawing.");
  }

  // A takeover usually starts by changing the contact the code goes to.
  const { recentChangeHours } = await loadPayoutSafeguards();
  const contactChangedAt = [owner.phoneChangedAt, owner.emailChangedAt]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (contactChangedAt && now.getTime() < contactChangedAt.getTime() + recentChangeHours * HOUR_MS) {
    throw new WithdrawalError("CONTACT_RECENTLY_CHANGED", "Withdrawals are paused for a short time after a phone or email change.", 409, {
      availableAfter: new Date(contactChangedAt.getTime() + recentChangeHours * HOUR_MS).toISOString(),
    });
  }

  const recent = await prisma.payoutWithdrawalChallenge.count({
    where: { userId: ownerId, createdAt: { gte: new Date(now.getTime() - CHALLENGE_WINDOW_MS) } },
  });
  if (recent >= CHALLENGES_PER_WINDOW) {
    throw new WithdrawalError("TOO_MANY_REQUESTS", "Too many codes requested. Try again in 15 minutes.", 429);
  }

  const releases = await withdrawableReleases(ownerId, now);
  if (releases.length === 0) throw new WithdrawalError("NOTHING_AVAILABLE", "There is nothing ready to withdraw right now.");

  const account = (await verifiedPayoutAccounts(ownerId))[0];
  if (!account) throw new WithdrawalError("NO_PAYOUT_ACCOUNT", "Add and verify a mobile money payout account first.");

  const total = Math.round(releases.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
  // Debts from earlier refunds are taken first (policy 6.3.3); the owner is
  // told the amount that will actually be sent.
  const openDebt = await openRecoveryTotal(ownerId);
  const recoveryDeduction = Math.min(openDebt, total);
  const sendTotal = Math.round((total - recoveryDeduction) * 100) / 100;
  const allowance = await ownerWithdrawalAllowance(ownerId, now);
  if (sendTotal > 0) assertOwnerWithdrawalAmount(sendTotal, allowance);
  const currency = "TZS";
  const destination = maskDestination(account.provider, account.accountNumber);
  const code = generate6();

  const challenge = await prisma.payoutWithdrawalChallenge.create({
    data: {
      reference: `wd_${randomBytes(18).toString("base64url")}`,
      userId: ownerId,
      releaseIds: releases.map((r) => r.id),
      totalAmount: new Prisma.Decimal(sendTotal),
      currency,
      fingerprint: withdrawalFingerprint({ releaseIds: releases.map((r) => r.id), total, currency, account, openDebt }),
      codeHash: hashCode(code),
      channel: "SMS",
      destinationMasked: destination,
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    },
  });

  try {
    await assertWithdrawalOtpUnlocked(ownerId);
    const delivered = await deliverCode(owner, code, sendTotal, destination, releases.length);
    if (delivered.channel !== "SMS") {
      await prisma.payoutWithdrawalChallenge.update({ where: { id: challenge.id }, data: { channel: delivered.channel } });
    }
    await prisma.payoutWithdrawalChallenge.updateMany({
      where: { userId: ownerId, id: { not: challenge.id }, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    return {
      challengeRef: challenge.reference,
      channel: delivered.channel,
      sentTo: delivered.sentTo,
      expiresAt: challenge.expiresAt,
      total: sendTotal,
      grossTotal: total,
      recoveryDeduction,
      currency,
      destination,
      count: releases.length,
      dailyLimit: allowance.limit,
      dailyRemaining: allowance.remaining,
    };
  } catch (err) {
    // An undeliverable code must not stay spendable.
    await prisma.payoutWithdrawalChallenge.update({ where: { id: challenge.id }, data: { expiresAt: now } });
    throw err;
  }
}

export function codeMatches(code: string, codeHash: string): boolean {
  const a = Buffer.from(hashCode(String(code).trim()), "hex");
  const b = Buffer.from(codeHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Step 2: the owner entered the code. Submits every bound claim to the payout queue. */
export async function confirmWithdrawal(ownerId: number, challengeRef: string, code: string, now = new Date()) {
  if (!payoutReleaseEnabled()) throw new WithdrawalError("FEATURE_OFF", "Withdrawals are not available yet.", 404);
  if (!disbursementSendingEnabled()) throw new WithdrawalError("SENDING_PAUSED", "Withdrawals are temporarily paused. No payout has been sent.", 503);
  await assertWithdrawalOtpUnlocked(ownerId);

  const challenge = await prisma.payoutWithdrawalChallenge.findUnique({ where: { reference: String(challengeRef) } });
  if (!challenge || challenge.userId !== ownerId) throw new WithdrawalError("NOT_FOUND", "This withdrawal request was not found. Start again.", 404);
  if (challenge.usedAt) throw new WithdrawalError("ALREADY_USED", "This code was already used. Start again.");
  if (challenge.expiresAt.getTime() <= now.getTime()) throw new WithdrawalError("EXPIRED", "This code has expired. Start again.");
  if (challenge.attempts >= MAX_ATTEMPTS) throw new WithdrawalError("TOO_MANY_ATTEMPTS", "Too many wrong codes. Start again.");

  if (!codeMatches(code, challenge.codeHash)) {
    const failures = await recordWrongWithdrawalCode(ownerId, challenge.id, now);
    if (failures >= MAX_ATTEMPTS) throw new WithdrawalError("OTP_LOCKED", OTP_LOCK_MESSAGE, 423);
    const remaining = Math.max(0, MAX_ATTEMPTS - failures);
    throw new WithdrawalError("INVALID_CODE", "That code is not correct.", 400, { attemptsRemaining: remaining });
  }

  // Re-check the live state against what the code was issued for.
  const releaseIds = (Array.isArray(challenge.releaseIds) ? challenge.releaseIds : []).map(Number).filter(Number.isInteger);
  const ready = await withdrawableReleases(ownerId, now);
  const readyById = new Map(ready.map((r) => [r.id, r]));
  const bound = releaseIds.map((id) => readyById.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  const account = (await verifiedPayoutAccounts(ownerId))[0];
  const total = Math.round(bound.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
  const openDebt = await openRecoveryTotal(ownerId);
  const stillSame =
    bound.length === releaseIds.length &&
    !!account &&
    withdrawalFingerprint({ releaseIds, total, currency: challenge.currency, account, openDebt }) === challenge.fingerprint;
  if (!stillSame) {
    await prisma.payoutWithdrawalChallenge.updateMany({ where: { id: challenge.id, usedAt: null }, data: { usedAt: now } });
    throw new WithdrawalError("CHANGED", "Something changed since the code was sent. Check your payouts and start again.");
  }

  const planned = new Map<number, number>();
  let debtRemaining = Math.min(openDebt, total);
  for (const release of bound) {
    const deduction = Math.round(Math.min(debtRemaining, release.amount) * 100) / 100;
    planned.set(release.id, deduction);
    debtRemaining = Math.round((debtRemaining - deduction) * 100) / 100;
  }
  const expectedSend = Math.round((total - Math.min(openDebt, total)) * 100) / 100;
  if (Math.abs(Number(challenge.totalAmount) - expectedSend) > 0.01) {
    throw new WithdrawalError("CHANGED", "The withdrawal amount changed. Check your payouts and start again.");
  }

  // Spend the code, claim the releases and persist every handoff in one
  // transaction. The worker resumes these jobs after a crash or timeout.
  await prisma.$transaction(async (tx) => {
    await lockOwnerWithdrawalDay(tx, ownerId);
    const allowance = await ownerWithdrawalAllowance(ownerId, now, tx);
    if (expectedSend > 0) assertOwnerWithdrawalAmount(expectedSend, allowance);
    const stillUnlocked = await tx.payoutWithdrawalOtpGuard.updateMany({
      where: { ownerId, lockedAt: null, failedAttempts: { lt: MAX_ATTEMPTS } },
      data: { failedAttempts: 0 },
    });
    if (stillUnlocked.count !== 1) throw new WithdrawalError("OTP_LOCKED", OTP_LOCK_MESSAGE, 423);
    const spent = await tx.payoutWithdrawalChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS } },
      data: { usedAt: now },
    });
    if (spent.count !== 1) throw new WithdrawalError("ALREADY_USED", "This code was already used. Start again.");
    const claimed = await tx.payoutRelease.updateMany({
      where: { id: { in: releaseIds }, ownerId, status: "AVAILABLE" },
      data: { status: "WITHDRAWING" },
    });
    if (claimed.count !== releaseIds.length) {
      throw new WithdrawalError("CHANGED", "Something changed since the code was sent. Check your payouts and start again.");
    }
    for (const release of bound) {
      await tx.payoutWithdrawalJob.create({ data: {
        releaseId: release.id,
        ownerId,
        invoiceId: release.sourceId,
        bookingId: release.bookingId,
        challengeId: challenge.id,
        payoutAccountId: account!.id,
        accountFingerprint: withdrawalAccountFingerprint(account!),
        grossAmount: new Prisma.Decimal(release.amount),
        plannedDeduction: new Prisma.Decimal(planned.get(release.id) ?? 0),
        status: "PENDING",
        nextAttemptAt: now,
      } });
    }
    await tx.payoutWithdrawalChallenge.updateMany({
      where: { userId: ownerId, id: { not: challenge.id }, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
  });

  return {
    count: bound.length,
    total: expectedSend,
    recoveryDeduction: Math.round(Math.min(openDebt, total) * 100) / 100,
    currency: challenge.currency,
    destination: challenge.destinationMasked,
    queuedCount: bound.length,
    status: "PROCESSING" as const,
  };
}

/**
 * Hands one WITHDRAWING release to the right lane. AUTO: the system approves
 * and the release worker sends it under the daily cap. MANUAL (or AUTO that
 * could not start): the claim is submitted to admins exactly as the owner's
 * old "send invoice" did.
 */
class WithdrawalReviewRequired extends Error {}

async function submitRelease(input: {
  release: { id: number; sourceId: number; bookingId: number; amount: number };
  ownerId: number;
  account: Awaited<ReturnType<typeof verifiedPayoutAccounts>>[number];
  owner: Awaited<ReturnType<typeof loadOwnerContact>>;
  now: Date;
  plannedDeduction: number;
  audit: { via: "OTP" | "UNCLAIMED"; challengeId?: number };
}): Promise<{ lane: PayoutLane | "OFFSET"; payable: number; deducted: number }> {
  const { release, ownerId, account, owner, now } = input;

  // Existing applications are a durable checkpoint. Resume an incomplete
  // deduction without charging the same debt twice.
  const deducted = await ensureRecoveryDeduction(ownerId, release.sourceId, input.plannedDeduction, now);
  if (Math.abs(deducted - input.plannedDeduction) > 0.01) {
    throw new WithdrawalReviewRequired("The confirmed recovery deduction could not be applied in full");
  }
  const payable = Math.round((release.amount - deducted) * 100) / 100;

  const existing = await prisma.disbursement.findFirst({
    where: { sourceType: "OWNER_INVOICE", sourceId: release.sourceId, status: { not: "FAILED" } },
    orderBy: { id: "desc" },
    select: { id: true, status: true, releaseLane: true, payoutAccountId: true, amount: true, remarks: true },
  });
  if (existing && (existing.payoutAccountId !== account.id || Math.abs(Number(existing.amount) - payable) > 0.01)) {
    throw new WithdrawalReviewRequired("An existing disbursement has different destination or amount");
  }
  if (!existing) {
    const failed = await prisma.disbursement.findFirst({
      where: { sourceType: "OWNER_INVOICE", sourceId: release.sourceId, status: "FAILED" }, select: { id: true },
    });
    if (failed) throw new WithdrawalReviewRequired("A failed disbursement needs reconciliation before any new attempt");
  }

  if (payable <= 0.005) {
    if (existing) throw new WithdrawalReviewRequired("An existing disbursement conflicts with a fully recovered claim");
    // The whole claim settled the debt: nothing to send, nothing for admins.
    const settled = await prisma.invoice.updateMany({
      where: { id: release.sourceId, ownerId, status: { in: ["DRAFT", "REQUESTED", "VERIFIED", "APPROVED"] } },
      data: { status: "PAID", paidAt: now, notes: "Settled in full against a recovery from an earlier refund or chargeback (policy 6.3.3)." },
    });
    if (settled.count !== 1) {
      const current = await prisma.invoice.findUnique({ where: { id: release.sourceId }, select: { status: true, notes: true } });
      if (current?.status !== "PAID" || !current.notes?.startsWith("Settled in full against a recovery")) {
        throw new WithdrawalReviewRequired("The invoice cannot be settled against the recovery automatically");
      }
    }
    await prisma.payoutRelease.updateMany({
      where: { id: release.id, status: "WITHDRAWING" },
      data: { status: "RELEASED", lane: "OFFSET", releasedAt: now, holdReason: "Used to recover an earlier refund" },
    });
    await prisma.auditLog
      .create({
        data: {
          actorId: input.audit.via === "OTP" ? ownerId : null,
          actorRole: input.audit.via === "OTP" ? "OWNER" : "SYSTEM",
          action: "OWNER_PAYOUT_SETTLED_BY_RECOVERY",
          entity: "PayoutRelease",
          entityId: release.id,
          afterJson: { invoiceId: release.sourceId, amount: release.amount, deducted },
          ...retentionFields("FINANCIAL", now),
        },
      })
      .catch(() => {});
    return { lane: "OFFSET", payable: 0, deducted };
  }

  const invoice = await prisma.invoice.findUnique({ where: { id: release.sourceId }, select: { status: true } });
  if (!invoice) throw new WithdrawalReviewRequired("The payout invoice is missing");
  if (invoice.status === "PAID" && !existing) throw new WithdrawalReviewRequired("The invoice is paid without a matching disbursement");
  const decision = !existing && invoice.status !== "REQUESTED"
    ? await decideOwnerPayoutLane({ ownerId, invoiceId: release.sourceId, amount: payable, account, now })
    : { lane: (existing ? "AUTO" : "MANUAL") as PayoutLane, reason: null };
  let lane: PayoutLane = decision.lane;
  let note = decision.reason;
  // While any debt is still open, a person looks at this owner's payouts.
  if (lane === "AUTO" && (await openRecoveryTotal(ownerId)) > 0) {
    lane = "MANUAL";
    note = "A recovery from an earlier refund is still open";
  }
  let disbursementId: number | null = null;
  if (existing) {
    if (existing.status === "REQUESTED" && existing.remarks === "Owner withdrawal (automatic)") {
      const freshDecision = await decideOwnerPayoutLane({ ownerId, invoiceId: release.sourceId, amount: payable, account, now });
      if (freshDecision.lane !== "AUTO") throw new WithdrawalReviewRequired("Automatic approval needs a fresh finance review");
      await approveDisbursementAutomatically(existing.id);
    } else if (existing.releaseLane !== "AUTO") {
      throw new WithdrawalReviewRequired("An existing disbursement needs finance review before handoff can finish");
    }
    lane = "AUTO";
    disbursementId = existing.id;
  } else if (lane === "AUTO") {
    const started = await startAutoPayout({ ownerId, invoiceId: release.sourceId, payoutAccountId: account.id, now });
    if (started.ok) disbursementId = started.disbursementId;
    else {
      const partial = await prisma.disbursement.findFirst({
        where: { sourceType: "OWNER_INVOICE", sourceId: release.sourceId, status: { not: "FAILED" } },
        select: { id: true },
      });
      if (partial) throw new Error(`Automatic disbursement ${partial.id} requires reconciliation`);
      lane = "MANUAL";
      note = `Automatic payout could not start: ${started.reason}`;
    }
  }

  let submittedToAdmins = false;
  if (lane === "MANUAL") {
    const submitted = await prisma.invoice.updateMany({
      where: { id: release.sourceId, ownerId, status: "DRAFT" },
      data: { status: "REQUESTED" },
    });
    if (submitted.count !== 1 && invoice.status !== "REQUESTED") {
      throw new WithdrawalReviewRequired(`Manual claim is ${invoice.status}, expected DRAFT or REQUESTED`);
    }
    submittedToAdmins = submitted.count === 1;
  }

  const moved = await prisma.payoutRelease.updateMany({
    where: { id: release.id, status: "WITHDRAWING" },
    data: { status: "RELEASED", lane, releasedAt: now, holdReason: lane === "MANUAL" ? note : null, disbursementId },
  });
  if (moved.count !== 1) throw new Error(`Payout release ${release.id} changed during handoff`);
  await prisma.auditLog
    .create({
      data: {
        actorId: input.audit.via === "OTP" ? ownerId : null,
        actorRole: input.audit.via === "OTP" ? "OWNER" : "SYSTEM",
        action: input.audit.via === "OTP" ? "OWNER_PAYOUT_WITHDRAWAL_CONFIRMED" : "OWNER_PAYOUT_UNCLAIMED_AUTO_WITHDRAWAL",
        entity: "PayoutRelease",
        entityId: release.id,
        afterJson: {
          invoiceId: release.sourceId,
          amount: release.amount,
          recoveryDeducted: deducted,
          payable,
          lane,
          laneReason: note,
          disbursementId,
          challengeId: input.audit.challengeId ?? null,
        },
        ...retentionFields("FINANCIAL", now),
      },
    })
    .catch((err) => console.warn("[withdrawal] audit write failed", { releaseId: release.id, message: err?.message }));

  if (submittedToAdmins) {
    const invoice = await prisma.invoice.findUnique({
      where: { id: release.sourceId },
      select: { invoiceNumber: true, booking: { select: { property: { select: { id: true, title: true } } } } },
    });
    void notifyAdmins("owner_payout_claim_submitted", {
      ownerId,
      ownerName: owner?.name || owner?.fullName || owner?.email || null,
      invoiceId: release.sourceId,
      invoiceNumber: invoice?.invoiceNumber ?? null,
      bookingId: release.bookingId,
      propertyId: invoice?.booking?.property?.id ?? null,
      propertyTitle: invoice?.booking?.property?.title ?? null,
      amount: payable,
    }).catch(() => {});
  }
  return { lane, payable, deducted };
}

const HANDOFF_LEASE_MS = 10 * 60 * 1000;
const HANDOFF_RETRY_MS = 60 * 1000;
const HANDOFF_MAX_ATTEMPTS = 5;

async function notifyWithdrawalReview(releaseId: number, ownerId: number, invoiceId: number, reason: string) {
  const kind = "owner_payout_withdrawal_review";
  let alreadySent = false;
  try {
    alreadySent = !!(await prisma.notification.findFirst({
      where: {
        userId: null, ownerId: null,
        AND: [
          { meta: { path: "$.releaseId", equals: releaseId } as any },
          { meta: { path: "$.notificationKind", equals: kind } as any },
        ],
      } as any,
      select: { id: true },
    }));
  } catch {
    // Prefer a duplicate alert to a withdrawal silently awaiting review.
  }
  if (alreadySent) return;
  await notifyAdmins(kind, { releaseId, ownerId, invoiceId, reason });
  await notifyOwner(ownerId, "owner_payout_withdrawal_review", { releaseId }).catch(() => {});
}

/** Resume durable owner handoffs. The worker never submits money to AzamPay. */
export async function processWithdrawalJobs(now = new Date(), limit = 20): Promise<{ done: number; retried: number; review: number }> {
  const result = { done: 0, retried: 0, review: 0 };
  if (!payoutReleaseEnabled() || !disbursementSendingEnabled()) return result;
  const jobs = await prisma.payoutWithdrawalJob.findMany({
    where: { OR: [
      { status: "PENDING", nextAttemptAt: { lte: now } },
      { status: "PROCESSING", leaseUntil: { lte: now } },
    ] },
    orderBy: { id: "asc" },
    take: limit,
  });
  for (const job of jobs) {
    // Deductions were planned in release order. Do not let a later payout
    // overtake an earlier one that still owns the recovery debt.
    const earlier = await prisma.payoutWithdrawalJob.findFirst({
      where: { ownerId: job.ownerId, id: { lt: job.id }, status: { notIn: ["DONE", "CANCELLED"] } },
      select: { id: true, status: true },
    });
    if (earlier) {
      if (earlier.status === "REVIEW_REQUIRED") {
        const reason = `Earlier withdrawal job ${earlier.id} needs finance review`;
        const held = await prisma.payoutWithdrawalJob.updateMany({
          where: { id: job.id, status: { in: ["PENDING", "PROCESSING"] } },
          data: { status: "REVIEW_REQUIRED", leaseUntil: null, lastError: reason },
        });
        if (held.count === 1) result.review++;
      }
      continue;
    }
    const claimed = await prisma.payoutWithdrawalJob.updateMany({
      where: { id: job.id, OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        { status: "PROCESSING", leaseUntil: { lte: now } },
      ] },
      data: { status: "PROCESSING", leaseUntil: new Date(now.getTime() + HANDOFF_LEASE_MS), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    try {
      const release = await prisma.payoutRelease.findUnique({ where: { id: job.releaseId }, select: {
        id: true, ownerId: true, sourceId: true, bookingId: true, status: true,
      } });
      if (!release || release.ownerId !== job.ownerId || release.sourceId !== job.invoiceId) {
        throw new WithdrawalReviewRequired("Withdrawal release does not match its durable job");
      }
      if (release.status === "RELEASED") {
        await prisma.payoutWithdrawalJob.update({ where: { id: job.id }, data: { status: "DONE", leaseUntil: null, lastError: null } });
        result.done++;
        continue;
      }
      if (release.status !== "WITHDRAWING") throw new WithdrawalReviewRequired(`Withdrawal release is ${release.status}`);
      const account = (await verifiedPayoutAccounts(job.ownerId)).find((a) => a.id === job.payoutAccountId);
      if (!account || withdrawalAccountFingerprint(account) !== job.accountFingerprint) {
        throw new WithdrawalReviewRequired("The confirmed payout account changed or is no longer verified");
      }
      const invoice = await prisma.invoice.findUnique({ where: { id: job.invoiceId }, select: { netPayable: true } });
      if (!invoice || Math.abs(Number(invoice.netPayable) - Number(job.grossAmount)) > 0.01) {
        throw new WithdrawalReviewRequired("The claim amount changed after withdrawal confirmation");
      }
      await submitRelease({
        release: { id: job.releaseId, sourceId: job.invoiceId, bookingId: job.bookingId, amount: Number(job.grossAmount) },
        ownerId: job.ownerId,
        account,
        owner: await loadOwnerContact(job.ownerId),
        now,
        plannedDeduction: Number(job.plannedDeduction),
        audit: { via: job.challengeId === null ? "UNCLAIMED" : "OTP", challengeId: job.challengeId ?? undefined },
      });
      await prisma.payoutWithdrawalJob.update({ where: { id: job.id }, data: { status: "DONE", leaseUntil: null, lastError: null } });
      result.done++;
    } catch (error: any) {
      const reason = String(error?.message || error).slice(0, 500);
      const review = error instanceof WithdrawalReviewRequired || job.attempts + 1 >= HANDOFF_MAX_ATTEMPTS;
      await prisma.payoutWithdrawalJob.update({ where: { id: job.id }, data: {
        status: review ? "REVIEW_REQUIRED" : "PENDING",
        leaseUntil: null,
        nextAttemptAt: new Date(now.getTime() + HANDOFF_RETRY_MS),
        lastError: reason,
      } });
      if (review) {
        result.review++;
        await notifyWithdrawalReview(job.releaseId, job.ownerId, job.invoiceId, reason).catch((alertError) => {
          console.error("[withdrawal] review alert failed", { releaseId: job.releaseId, error: String(alertError) });
        });
      } else {
        result.retried++;
        console.warn("[withdrawal] handoff will retry", { releaseId: job.releaseId, attempt: job.attempts + 1, reason });
      }
    }
  }
  let afterReviewId = 0;
  for (;;) {
    const needingReview = await prisma.payoutWithdrawalJob.findMany({
      where: { status: "REVIEW_REQUIRED", id: { gt: afterReviewId } },
      select: { id: true, releaseId: true, ownerId: true, invoiceId: true, lastError: true },
      orderBy: { id: "asc" }, take: 100,
    });
    for (const job of needingReview) {
      await notifyWithdrawalReview(job.releaseId, job.ownerId, job.invoiceId, job.lastError ?? "Withdrawal needs finance review");
    }
    if (needingReview.length < 100) break;
    afterReviewId = needingReview[needingReview.length - 1].id;
  }
  // Pre-migration withdrawals have no account snapshot, so they cannot be
  // replayed safely. Surface them to finance instead of silently stranding them.
  let afterLegacyId = 0;
  for (;;) {
    const legacy = await prisma.payoutRelease.findMany({
      where: { status: "WITHDRAWING", id: { gt: afterLegacyId }, updatedAt: { lte: new Date(now.getTime() - HANDOFF_LEASE_MS) }, withdrawalJobs: { none: { status: { in: ["PENDING", "PROCESSING", "REVIEW_REQUIRED"] } } } },
      select: { id: true, ownerId: true, sourceId: true }, orderBy: { id: "asc" }, take: 100,
    });
    for (const release of legacy) {
      await notifyWithdrawalReview(release.id, release.ownerId, release.sourceId, "Legacy withdrawal has no durable handoff record");
    }
    if (legacy.length < 100) break;
    afterLegacyId = legacy[legacy.length - 1].id;
  }
  return result;
}

/** Finance may requeue a reviewed job, or reset it only when no money step ran. */
export async function resolveWithdrawalHandoff(input: {
  releaseId: number; action: "RETRY" | "RESET"; adminId: number; note: string; now?: Date;
}): Promise<"RETRY" | "RESET"> {
  const now = input.now ?? new Date();
  const resolved = await prisma.$transaction(async (tx) => {
    const release = await tx.payoutRelease.findUnique({ where: { id: input.releaseId }, select: {
      id: true, ownerId: true, sourceId: true, status: true,
    } });
    const job = await tx.payoutWithdrawalJob.findFirst({
      where: { releaseId: input.releaseId }, orderBy: { id: "desc" },
    });
    if (!release || release.status !== "WITHDRAWING" ||
      (job && (job.status !== "REVIEW_REQUIRED" || job.ownerId !== release.ownerId || job.invoiceId !== release.sourceId))) {
      throw new WithdrawalError("CHANGED", "This withdrawal is no longer awaiting finance review.", 409);
    }
    if (input.action === "RETRY" && !job) {
      throw new WithdrawalError("CHANGED", "This older withdrawal has no saved account snapshot. Reset it only if no money step exists.", 409);
    }
    if (input.action === "RESET") {
      const [application, disbursement, invoice] = await Promise.all([
        tx.ownerPayoutRecoveryApplication.findFirst({ where: { invoiceId: release.sourceId }, select: { id: true } }),
        tx.disbursement.findFirst({ where: { sourceType: "OWNER_INVOICE", sourceId: release.sourceId }, select: { id: true } }),
        tx.invoice.findUnique({ where: { id: release.sourceId }, select: { status: true } }),
      ]);
      if (application || disbursement || invoice?.status !== "DRAFT") {
        throw new WithdrawalError("CHANGED", "A money or claim step already exists. Reconcile it before resetting this withdrawal.", 409);
      }
      const returned = await tx.payoutRelease.updateMany({
        where: { id: release.id, status: "WITHDRAWING" },
        data: { status: "AVAILABLE", ...(job?.challengeId === null ? { availableAt: now } : {}) },
      });
      if (returned.count !== 1) throw new WithdrawalError("CHANGED", "The withdrawal changed during review.", 409);
      if (job) await tx.payoutWithdrawalJob.update({ where: { id: job.id }, data: { status: "CANCELLED", leaseUntil: null, lastError: input.note } });
    } else {
      await tx.payoutWithdrawalJob.update({ where: { id: job!.id }, data: {
        status: "PENDING", attempts: 0, nextAttemptAt: now, leaseUntil: null, lastError: null,
      } });
    }
    await tx.auditLog.create({ data: {
      actorId: input.adminId, actorRole: "ADMIN", action: `OWNER_WITHDRAWAL_HANDOFF_${input.action}`,
      entity: "PayoutRelease", entityId: release.id,
      afterJson: { jobId: job?.id ?? null, ownerId: release.ownerId, invoiceId: release.sourceId, note: input.note },
      ...retentionFields("FINANCIAL", now),
    } });
    return { ownerId: release.ownerId };
  });
  if (input.action === "RESET") {
    await notifyOwner(resolved.ownerId, "owner_payout_withdrawal_reset", { releaseId: input.releaseId }).catch(() => {});
  }
  return input.action;
}

/** Owner policy 5.2.2: the owner is told before an unclaimed payout is sent. At least this long before. */
export const UNCLAIMED_REMINDER_LEAD_MS = 48 * HOUR_MS;
const REMINDER_ACTION = "OWNER_PAYOUT_UNCLAIMED_REMINDER";

function formatEat(date: Date): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)} EAT`;
}

/** Release ids that already have a reminder sent at or before `sentBy`. */
async function remindedReleaseIds(releaseIds: number[], sentBy?: Date): Promise<Set<number>> {
  if (releaseIds.length === 0) return new Set();
  const [rows, resets] = await Promise.all([
    prisma.auditLog.findMany({
    where: {
      action: REMINDER_ACTION,
      entity: "PayoutRelease",
      entityId: { in: releaseIds },
      ...(sentBy ? { createdAt: { lte: sentBy } } : {}),
    },
    select: { entityId: true, createdAt: true },
  }),
    prisma.auditLog.findMany({
      where: { action: "OWNER_WITHDRAWAL_HANDOFF_RESET", entity: "PayoutRelease", entityId: { in: releaseIds } },
      select: { entityId: true, createdAt: true },
    }),
  ]);
  const resetAt = new Map<number, number>();
  for (const row of resets) resetAt.set(Number(row.entityId), Math.max(resetAt.get(Number(row.entityId)) ?? 0, row.createdAt.getTime()));
  return new Set(rows.filter((row) => !resetAt.has(Number(row.entityId)) || row.createdAt?.getTime() >= resetAt.get(Number(row.entityId))!).map((row) => Number(row.entityId)));
}

export function unclaimedReminderText(input: { total: number; destination: string; sendOn: Date }): string {
  return (
    `NoLSAF: ${formatTzs(input.total)} is ready in My Payouts. If you do not withdraw it, ` +
    `we will send it to ${input.destination} on ${formatEat(input.sendOn)}.`
  );
}

/**
 * Tells each owner, once per payout, that a ready payout will be sent
 * automatically. Fires UNCLAIMED_REMINDER_LEAD_MS before the unclaimed
 * deadline. The reminder is recorded in the audit log, and withdrawUnclaimed
 * refuses any payout without a reminder at least that old, so "notified
 * before" holds even if this worker was down. No code is ever sent here.
 * Returns the number of owners reminded.
 */
export async function remindUnclaimed(now = new Date(), limit = 50): Promise<number> {
  if (!disbursementSendingEnabled()) return 0;
  const settings = await loadAutoLaneSettings();
  if (!payoutReleaseEnabled() || settings.unclaimedAutoDays === null) return 0;
  const dueBy = new Date(now.getTime() - settings.unclaimedAutoDays * 24 * HOUR_MS + UNCLAIMED_REMINDER_LEAD_MS);
  const due = await prisma.payoutRelease.findMany({
    where: { status: "AVAILABLE", availableAt: { lte: dueBy } },
    select: { id: true, ownerId: true, sourceId: true, availableAt: true },
    take: 500,
  });
  const already = await remindedReleaseIds(due.map((r) => r.id));
  const partiallyWithdrawn = await prisma.payoutWithdrawalAllocation.findMany({
    where: { releaseId: { in: due.map((r) => r.id) }, cancelledAt: null }, select: { releaseId: true },
  });
  const partiallyWithdrawnIds = new Set(partiallyWithdrawn.map((row) => row.releaseId));
  const byOwner = new Map<number, typeof due>();
  for (const r of due) {
    if (already.has(r.id) || partiallyWithdrawnIds.has(r.id)) continue;
    byOwner.set(r.ownerId, [...(byOwner.get(r.ownerId) ?? []), r]);
  }

  let reminded = 0;
  for (const [ownerId, releases] of [...byOwner].slice(0, limit)) {
    const account = (await verifiedPayoutAccounts(ownerId))[0];
    if (!account) continue; // without a usable account nothing can be sent anyway
    const claims = await prisma.invoice.findMany({
      where: { id: { in: releases.map((r) => r.sourceId) }, ownerId },
      select: { netPayable: true },
    });
    const total = claims.reduce((sum, c) => sum + Number(c.netPayable ?? 0), 0);
    const latestDeadline = Math.max(
      ...releases.map((r) => (r.availableAt?.getTime() ?? now.getTime()) + settings.unclaimedAutoDays! * 24 * HOUR_MS)
    );
    const sendOn = new Date(Math.max(latestDeadline, now.getTime() + UNCLAIMED_REMINDER_LEAD_MS));
    const destination = maskDestination(account.provider, account.accountNumber);

    const owner = await loadOwnerContact(ownerId);
    await notifyOwner(ownerId, "owner_payout_unclaimed_reminder", {
      amountText: formatTzs(total),
      destination,
      sendOnText: formatEat(sendOn),
    }).catch(() => {});
    if (owner?.phone && owner.phoneVerifiedAt) {
      await sendSms(owner.phone, unclaimedReminderText({ total, destination, sendOn })).catch(() => null);
    }
    await prisma.auditLog.createMany({
      data: releases.map((r) => ({
        actorId: null,
        actorRole: "SYSTEM",
        action: REMINDER_ACTION,
        entity: "PayoutRelease",
        entityId: r.id,
        afterJson: { sendOn: sendOn.toISOString(), destination, total },
        ...retentionFields("FINANCIAL", now),
      })),
    });
    reminded++;
  }
  return reminded;
}

/**
 * Decision D2: an AVAILABLE payout the owner has not withdrawn within
 * payoutUnclaimedAutoDays is submitted without an OTP. Safe because the
 * destination is the verified account, unchanged for the recent-change
 * window (a changed account keeps the release LOCKED), so nobody can redirect
 * it; the OTP protects WHERE money goes, and here that cannot change.
 * Returns the number of releases submitted.
 */
export async function withdrawUnclaimed(now = new Date(), limit = 50): Promise<number> {
  if (!disbursementSendingEnabled()) return 0;
  const settings = await loadAutoLaneSettings();
  if (!payoutReleaseEnabled() || settings.unclaimedAutoDays === null) return 0;
  const cutoff = new Date(now.getTime() - settings.unclaimedAutoDays * 24 * HOUR_MS);
  const stale = await prisma.payoutRelease.findMany({
    where: { status: "AVAILABLE", availableAt: { lte: cutoff } },
    select: { ownerId: true },
    distinct: ["ownerId"],
    take: limit,
  });

  let submitted = 0;
  for (const { ownerId } of stale) {
    const otpGuard = await prisma.payoutWithdrawalOtpGuard.findUnique({ where: { ownerId }, select: { lockedAt: true, failedAttempts: true } });
    if (otpGuard?.lockedAt || (otpGuard?.failedAttempts ?? 0) >= MAX_ATTEMPTS) continue;
    const ready = await withdrawableReleases(ownerId, now);
    const account = (await verifiedPayoutAccounts(ownerId))[0];
    if (!account || ready.length === 0) continue;
    const staleRows = await prisma.payoutRelease.findMany({
      where: { ownerId, status: "AVAILABLE", availableAt: { lte: cutoff } },
      select: { id: true },
    });
    // Only payouts the owner was reminded about at least the lead time ago.
    const remindedInTime = await remindedReleaseIds(
      staleRows.map((r) => r.id),
      new Date(now.getTime() - UNCLAIMED_REMINDER_LEAD_MS)
    );
    const staleIds = new Set(staleRows.map((r) => r.id).filter((id) => remindedInTime.has(id)));
    if (staleIds.size === 0) continue;
    let debtRemaining = await openRecoveryTotal(ownerId);
    for (const release of ready.filter((r) => staleIds.has(r.id))) {
      const plannedDeduction = Math.round(Math.min(debtRemaining, release.amount) * 100) / 100;
      const claimed = await prisma.$transaction(async (tx) => {
        await lockOwnerWithdrawalDay(tx, ownerId);
        const portion = await tx.payoutWithdrawalAllocation.findFirst({
          where: { releaseId: release.id, cancelledAt: null }, select: { id: true },
        });
        if (portion) return false;
        const sendAmount = Math.round((release.amount - plannedDeduction) * 100) / 100;
        const allowance = await ownerWithdrawalAllowance(ownerId, now, tx);
        if (sendAmount > allowance.remaining) return false;
        const moved = await tx.payoutRelease.updateMany({
          where: { id: release.id, ownerId, status: "AVAILABLE" },
          data: { status: "WITHDRAWING" },
        });
        if (moved.count !== 1) return false;
        await tx.payoutWithdrawalJob.create({ data: {
          releaseId: release.id,
          ownerId,
          invoiceId: release.sourceId,
          bookingId: release.bookingId,
          challengeId: null,
          payoutAccountId: account.id,
          accountFingerprint: withdrawalAccountFingerprint(account),
          grossAmount: new Prisma.Decimal(release.amount),
          plannedDeduction: new Prisma.Decimal(plannedDeduction),
          status: "PENDING",
          nextAttemptAt: now,
        } });
        return true;
      });
      if (!claimed) continue;
      debtRemaining = Math.round((debtRemaining - plannedDeduction) * 100) / 100;
      submitted++;
    }
  }
  return submitted;
}

/**
 * Sales partner withdrawals (docs/SALES_PAYOUT_WITHDRAWAL_POLICY.md).
 *
 * The partner taps Withdraw and gets a one-time code bound to the exact
 * earnings, the total and their verified payout account. Entering it creates
 * the payout request and runs every withdrawal rule at that moment:
 *
 * - every rule passes: the system approves it (withholding tax applies) and
 *   hands it to the shared AUTO lane, which sends it under the same kill
 *   switch, daily cap, account re-check and fingerprints as owner payouts;
 * - any rule fails: the payout waits for a person, with the reasons recorded.
 *   A fraud signal also freezes the partner's withdrawals until an admin
 *   clears them with a reason (decided by Daniel, 2026-11-08).
 *
 * Money never moves here. This module only approves and queues; the batch
 * worker sends.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import { generate6, hashCode } from "../../lib/otp.js";
import { notifyAdmins, notifyUser } from "../../lib/notifications.js";
import { retentionFields } from "../../lib/auditRetention.js";
import { MIN_PAYOUT_AMOUNT } from "../../lib/salesPartner.js";
import { calculateSalesPayoutApproval, salesWithholdingTaxRate } from "../../lib/salesFinance.js";
import { CANCELLED_BOOKING_STATUSES, SETTLED_CANCELLATION_STATUSES } from "../../lib/salesCommission.js";
import {
  loadPartnerIdentity,
  partnerBookedStayReason,
  partnerOwnsPropertyReason,
  payoutAccountKey,
} from "../../lib/salesSelfDealing.js";
import { monthKey } from "../../lib/salesLeaderboard.js";
import { codeMatches, deliverCode, loadOwnerContact, maskDestination } from "./withdrawal.js";
import { assessDisbursementRisk, isAutoLaneRisk, loadPayoutSafeguards } from "./riskScoring.js";
import { loadAutoLaneSettings } from "./autoLane.js";
import { approveDisbursementAutomatically, requestDisbursement } from "./ledger.js";
import { disbursementSendingEnabled } from "./senderSwitch.js";

const db = prisma as any;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const CODES_PER_WINDOW = 3;
const CODE_WINDOW_MS = 15 * 60 * 1000;

/** Rule thresholds. Kept here, in one place, so the policy page can quote them. */
export const SALES_WITHDRAWAL_RULES = {
  ownerDenialLookbackDays: 90,
  frequentWindowDays: 7,
  frequentMax: 3,
  spikeMultiplier: 3,
  spikeMinHistory: 3,
  handoffMaxAttempts: 3,
  handoffResumeAfterMs: 2 * 60 * 1000,
} as const;

/** Statuses of a payout that is still on its way: only one at a time per partner. */
const OPEN_PAYOUT_STATUSES = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "PROCESSING"];
const MANUAL_CREDIT_TYPES = ["MANUAL_ADJUSTMENT", "PERFORMANCE_BONUS"];

export type FlagSeverity = "SUSPICIOUS" | "REVIEW" | "INFO";
export type PolicyFlag = { code: string; severity: FlagSeverity; message: string };

export class SalesWithdrawalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus = 409,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "SalesWithdrawalError";
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function formatTzs(amount: number): string {
  return `TSh ${Math.round(amount).toLocaleString("en-US")}`;
}

export async function loadSalesAutoSettings() {
  const [row, shared] = await Promise.all([
    db.systemSetting.findUnique({ where: { id: 1 }, select: { salesAutoPayoutEnabled: true, salesAutoPayoutMaxTzs: true } }),
    loadAutoLaneSettings(),
  ]);
  const max = Number(row?.salesAutoPayoutMaxTzs ?? 500_000);
  return {
    salesEnabled: Boolean(row?.salesAutoPayoutEnabled),
    maxTzs: Number.isFinite(max) && max > 0 ? max : 500_000,
    sharedEnabled: shared.enabled,
    sharedDailyCapTzs: shared.dailyCapTzs,
  };
}

async function verifiedAccount(userId: number) {
  return db.payoutAccount.findFirst({
    where: { userId, isActive: true, isVerified: true, type: "MOBILE_MONEY" },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    select: {
      id: true, userId: true, provider: true, accountNumber: true, accountName: true,
      destinationChangedAt: true, createdAt: true,
    },
  });
}

type Account = NonNullable<Awaited<ReturnType<typeof verifiedAccount>>>;

function accountFingerprint(account: Pick<Account, "id" | "provider" | "accountNumber" | "destinationChangedAt">): string {
  return createHash("sha256")
    .update([account.id, account.provider, account.accountNumber, account.destinationChangedAt?.toISOString() ?? "-"].join("|"))
    .digest("hex");
}

/** sha256 over the sorted earnings, the total, the currency and the live account. */
export function salesWithdrawalFingerprint(input: {
  commissionIds: number[];
  total: number;
  currency: string;
  account: Pick<Account, "id" | "provider" | "accountNumber" | "destinationChangedAt">;
}): string {
  const ids = [...input.commissionIds].sort((a, b) => a - b).join(",");
  return createHash("sha256")
    .update([ids, input.total.toFixed(2), input.currency, accountFingerprint(input.account)].join("|"))
    .digest("hex");
}

async function withdrawableCommissions(partnerId: number) {
  const rows = await db.salesCommission.findMany({
    where: { salesPartnerId: partnerId, status: "AVAILABLE", payoutItem: null, currency: "TZS" },
    orderBy: [{ availableAt: "asc" }, { id: "asc" }],
    take: 500,
    select: { id: true, type: true, commissionAmount: true, propertyId: true, sourceBookingId: true },
  });
  const total = round2(rows.reduce((sum: number, row: any) => sum + Number(row.commissionAmount || 0), 0));
  return { rows, total };
}

async function loadPartner(partnerId: number) {
  return db.salesPartnerProfile.findUnique({
    where: { id: partnerId },
    select: {
      id: true, userId: true, status: true, agentCode: true,
      payoutHoldAt: true, payoutHoldReason: true,
      withdrawalOtpFailures: true, withdrawalOtpLockedAt: true,
    },
  });
}

const HOLD_MESSAGE = "Withdrawals are paused while NoLSAF reviews your account. Contact support if you need help.";
const LOCK_MESSAGE = "Withdrawals are locked after three wrong codes. Contact NoLSAF support to verify your identity.";

/**
 * Everything that stops a withdrawal from even starting. Returns the first
 * blocker, or null when a code may be sent. Reads only.
 */
async function firstBlocker(partner: NonNullable<Awaited<ReturnType<typeof loadPartner>>>, now: Date) {
  if (partner.status !== "ACTIVE") return { code: "PARTNER_INACTIVE", message: "Your sales partner account is not active." };
  if (partner.withdrawalOtpLockedAt) return { code: "OTP_LOCKED", message: LOCK_MESSAGE };
  if (partner.payoutHoldAt) return { code: "ON_HOLD", message: HOLD_MESSAGE };

  const contact = await loadOwnerContact(partner.userId);
  if (!contact || (!(contact.phone && contact.phoneVerifiedAt) && !(contact.email && contact.emailVerifiedAt))) {
    return { code: "NO_VERIFIED_CONTACT", message: "Verify your phone number or email before withdrawing." };
  }
  const { recentChangeHours } = await loadPayoutSafeguards();
  const contactChangedAt = [contact.phoneChangedAt, contact.emailChangedAt]
    .filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  if (contactChangedAt && now.getTime() < contactChangedAt.getTime() + recentChangeHours * HOUR_MS) {
    return {
      code: "CONTACT_RECENTLY_CHANGED",
      message: "Withdrawals are paused for a short time after a phone or email change.",
      availableAfter: new Date(contactChangedAt.getTime() + recentChangeHours * HOUR_MS).toISOString(),
    };
  }

  const account = await verifiedAccount(partner.userId);
  if (!account) return { code: "NO_PAYOUT_ACCOUNT", message: "Add and verify a mobile money payout account first." };
  const changedAt = account.destinationChangedAt ?? account.createdAt;
  if (now.getTime() < changedAt.getTime() + recentChangeHours * HOUR_MS) {
    return {
      code: "ACCOUNT_RECENTLY_CHANGED",
      message: "Your payout account changed recently. Withdrawals open again after a short safety wait.",
      availableAfter: new Date(changedAt.getTime() + recentChangeHours * HOUR_MS).toISOString(),
    };
  }

  const open = await db.salesPayoutRequest.findFirst({
    where: { salesPartnerId: partner.id, status: { in: OPEN_PAYOUT_STATUSES } },
    select: { referenceNumber: true },
  });
  if (open) {
    return { code: "OPEN_WITHDRAWAL", message: `Withdrawal ${open.referenceNumber} is still on its way. You can withdraw again once it is paid or closed.` };
  }
  return null;
}

/** What the Withdraw panel shows before the partner taps it. Reads only. */
export async function salesWithdrawalStatus(partnerId: number, now = new Date()) {
  const partner = await loadPartner(partnerId);
  if (!partner) throw new SalesWithdrawalError("NOT_FOUND", "Sales partner not found.", 404);
  const [{ rows, total }, account, blocker, auto] = await Promise.all([
    withdrawableCommissions(partnerId),
    verifiedAccount(partner.userId),
    firstBlocker(partner, now),
    loadSalesAutoSettings(),
  ]);
  let blocked = blocker;
  if (!blocked && rows.length === 0) blocked = { code: "NOTHING_AVAILABLE", message: "There is nothing ready to withdraw right now." };
  if (!blocked && total < MIN_PAYOUT_AMOUNT) {
    blocked = { code: "BELOW_MINIMUM", message: `The minimum withdrawal is ${formatTzs(MIN_PAYOUT_AMOUNT)}.` };
  }
  return {
    available: total,
    count: rows.length,
    currency: "TZS",
    minimum: MIN_PAYOUT_AMOUNT,
    withholdingTaxRate: salesWithholdingTaxRate(),
    destination: account ? maskDestination(account.provider, account.accountNumber) : null,
    // So the page can say what is sent without a person. Thresholds of the
    // fraud rules are never shared.
    automatic: {
      enabled: auto.salesEnabled && auto.sharedEnabled && auto.sharedDailyCapTzs !== null,
      limit: auto.maxTzs,
    },
    blocked,
  };
}

/** Step 1: the partner tapped Withdraw. Sends a code for everything withdrawable now. */
export async function startSalesWithdrawal(partnerId: number, now = new Date()) {
  if (!disbursementSendingEnabled()) {
    throw new SalesWithdrawalError("SENDING_PAUSED", "Withdrawals are temporarily paused. Nothing has been sent.", 503);
  }
  const status = await salesWithdrawalStatus(partnerId, now);
  if (status.blocked) {
    const { code, message, ...extra } = status.blocked as any;
    throw new SalesWithdrawalError(code, message, code === "OTP_LOCKED" ? 423 : 409, extra);
  }
  const partner = (await loadPartner(partnerId))!;
  const recent = await db.salesPayoutChallenge.count({
    where: { salesPartnerId: partnerId, createdAt: { gte: new Date(now.getTime() - CODE_WINDOW_MS) } },
  });
  if (recent >= CODES_PER_WINDOW) {
    throw new SalesWithdrawalError("TOO_MANY_REQUESTS", "Too many codes requested. Try again in 15 minutes.", 429);
  }

  const { rows, total } = await withdrawableCommissions(partnerId);
  const account = (await verifiedAccount(partner.userId))!;
  const contact = (await loadOwnerContact(partner.userId))!;
  const destination = maskDestination(account.provider, account.accountNumber);
  const commissionIds = rows.map((row: any) => row.id);
  const code = generate6();

  const challenge = await db.salesPayoutChallenge.create({
    data: {
      reference: `sw_${randomBytes(18).toString("base64url")}`,
      salesPartnerId: partnerId,
      userId: partner.userId,
      commissionIds,
      totalAmount: new Prisma.Decimal(total),
      currency: "TZS",
      payoutAccountId: account.id,
      fingerprint: salesWithdrawalFingerprint({ commissionIds, total, currency: "TZS", account }),
      codeHash: hashCode(code),
      channel: "SMS",
      destinationMasked: destination,
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    },
  });
  try {
    const delivered = await deliverCode(contact, code, total, destination, rows.length);
    if (delivered.channel !== "SMS") {
      await db.salesPayoutChallenge.update({ where: { id: challenge.id }, data: { channel: delivered.channel } });
    }
    // Only the newest code can be used.
    await db.salesPayoutChallenge.updateMany({
      where: { salesPartnerId: partnerId, id: { not: challenge.id }, usedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    return {
      challengeRef: challenge.reference,
      channel: delivered.channel,
      sentTo: delivered.sentTo,
      expiresAt: challenge.expiresAt,
      total,
      count: rows.length,
      currency: "TZS",
      destination,
      withholdingTaxRate: status.withholdingTaxRate,
    };
  } catch (error) {
    // An undeliverable code must not stay spendable.
    await db.salesPayoutChallenge.update({ where: { id: challenge.id }, data: { expiresAt: now } });
    throw error;
  }
}

/** Letters-only name parts of three or more characters, upper case. */
function nameTokens(...names: Array<string | null | undefined>): Set<string> {
  const tokens = new Set<string>();
  for (const name of names) {
    for (const part of String(name ?? "").toUpperCase().normalize("NFKD").replace(/[^A-Z\s]/g, " ").split(/\s+/)) {
      if (part.length >= 3) tokens.add(part);
    }
  }
  return tokens;
}

/**
 * Every withdrawal rule, checked now. Returns all the rules this withdrawal
 * breaks (empty when it may go automatically). Reads only.
 */
export async function evaluateSalesWithdrawalPolicy(input: {
  partnerId: number;
  userId: number;
  commissions: Array<{ id: number; type: string; commissionAmount: unknown; propertyId: number | null; sourceBookingId: number | null }>;
  total: number;
  account: Account;
  now?: Date;
}): Promise<PolicyFlag[]> {
  const now = input.now ?? new Date();
  const flags: PolicyFlag[] = [];
  const add = (code: string, severity: FlagSeverity, message: string) => flags.push({ code, severity, message });
  const R = SALES_WITHDRAWAL_RULES;

  // ---- Fraud signals: these also freeze the partner's withdrawals ----
  const identity = await loadPartnerIdentity(db, input.partnerId);
  if (identity) {
    const key = payoutAccountKey(input.account.accountNumber);
    if (key) identity.payoutKeys.add(key);
    const propertyIds = [...new Set(input.commissions.map((c) => c.propertyId).filter((id): id is number => !!id))];
    for (const propertyId of propertyIds) {
      const reason = await partnerOwnsPropertyReason(db, identity, propertyId);
      if (reason) {
        add("SELF_DEALING", "SUSPICIOUS", `Earnings from a property the partner is tied to: ${reason}`);
        break;
      }
    }
    const bookingIds = [...new Set(input.commissions.map((c) => c.sourceBookingId).filter((id): id is number => !!id))];
    if (bookingIds.length) {
      const bookings = await db.booking.findMany({
        where: { id: { in: bookingIds } },
        select: { id: true, userId: true, guestPhone: true, user: { select: { email: true, phone: true } } },
      });
      const own = bookings.map((b: any) => partnerBookedStayReason(identity, b)).find(Boolean);
      if (own) add("SELF_BOOKED_STAY", "SUSPICIOUS", own);
    }
  }

  const sharedWith = await db.payoutAccount.count({
    where: { accountNumber: input.account.accountNumber, provider: input.account.provider, userId: { not: input.userId } },
  });
  if (sharedWith > 0) add("ACCOUNT_SHARED", "SUSPICIOUS", "The payout account is also registered by another NoLSAF user.");

  const user = await db.user.findUnique({ where: { id: input.userId }, select: { name: true, fullName: true } });
  const partnerNames = nameTokens(user?.name, user?.fullName);
  const accountNames = nameTokens(input.account.accountName);
  if (partnerNames.size && accountNames.size && ![...accountNames].some((t) => partnerNames.has(t))) {
    add("NAME_MISMATCH", "SUSPICIOUS", `The payout account is registered to "${input.account.accountName}", which does not match the partner's name.`);
  }

  const denial = await db.salesOwnerConfirmation.findFirst({
    where: {
      salesPartnerId: input.partnerId,
      status: { in: ["DENIED", "UNKNOWN_PARTNER"] },
      respondedAt: { gte: new Date(now.getTime() - R.ownerDenialLookbackDays * DAY_MS) },
    },
    select: { id: true },
  });
  if (denial) add("OWNER_DENIAL", "SUSPICIOUS", `A property owner denied knowing this partner in the last ${R.ownerDenialLookbackDays} days.`);

  const flaggedVisits = await db.salesLeadVisit.count({
    where: { salesPartnerId: input.partnerId, status: "FLAGGED", reviewedAt: null },
  });
  if (flaggedVisits > 0) add("FLAGGED_VISITS", "SUSPICIOUS", `${flaggedVisits} flagged visit${flaggedVisits === 1 ? "" : "s"} still waiting for review.`);

  const month = await db.salesPartnerMonth.findUnique({
    where: { salesPartnerId_month: { salesPartnerId: input.partnerId, month: monthKey(now) } },
    select: { excludedAt: true, excludedReason: true },
  });
  if (month?.excludedAt) add("LEADERBOARD_EXCLUDED", "SUSPICIOUS", `Excluded from this month's leaderboard${month.excludedReason ? `: ${month.excludedReason}` : "."}`);

  // ---- Checks: only this withdrawal waits for a person ----
  const paidBefore = await db.salesPayoutRequest.count({ where: { salesPartnerId: input.partnerId, status: "PAID" } });
  if (paidBefore === 0) add("FIRST_WITHDRAWAL", "REVIEW", "First withdrawal: checked by our team.");

  const settings = await loadSalesAutoSettings();
  if (input.total > settings.maxTzs) {
    add("OVER_AUTO_LIMIT", "REVIEW", `Above the automatic limit of ${formatTzs(settings.maxTzs)}.`);
  }

  const recentCount = await db.salesPayoutRequest.count({
    where: {
      salesPartnerId: input.partnerId,
      status: { not: "CANCELLED" },
      requestedAt: { gte: new Date(now.getTime() - R.frequentWindowDays * DAY_MS) },
    },
  });
  if (recentCount >= R.frequentMax) {
    add("FREQUENT_WITHDRAWALS", "REVIEW", `${recentCount} withdrawals in the last ${R.frequentWindowDays} days.`);
  }

  const history = await db.salesPayoutRequest.findMany({
    where: { salesPartnerId: input.partnerId, status: "PAID" },
    orderBy: { paidAt: "desc" },
    take: 5,
    select: { netPaidAmount: true, requestedAmount: true },
  });
  if (history.length >= R.spikeMinHistory) {
    const avg = history.reduce((s: number, h: any) => s + Number(h.netPaidAmount ?? h.requestedAmount ?? 0), 0) / history.length;
    if (avg > 0 && input.total > avg * R.spikeMultiplier) {
      add("AMOUNT_SPIKE", "REVIEW", `More than ${R.spikeMultiplier} times the partner's usual payout of ${formatTzs(avg)}.`);
    }
  }

  if (input.commissions.some((c) => MANUAL_CREDIT_TYPES.includes(c.type) && Number(c.commissionAmount) > 0)) {
    add("MANUAL_CREDIT", "REVIEW", "Includes a credit added by an admin.");
  }

  const bookingIds = input.commissions.filter((c) => c.type === "MARKETPLACE_BOOKING" && c.sourceBookingId).map((c) => c.sourceBookingId!);
  if (bookingIds.length) {
    const cancelled = await db.booking.findFirst({
      where: {
        id: { in: bookingIds },
        OR: [
          { status: { in: CANCELLED_BOOKING_STATUSES } },
          { cancellationRequests: { some: { status: { in: SETTLED_CANCELLATION_STATUSES } } } },
        ],
      },
      select: { id: true },
    });
    if (cancelled) add("CANCELLED_BOOKING", "REVIEW", "Includes earnings from a stay that was cancelled or refunded.");
  }

  // The same risk scorer every payout passes before batching, run now.
  const risk = await assessDisbursementRisk(
    {
      id: 0,
      sourceType: "SALES_PAYOUT",
      sourceId: 0,
      amount: new Prisma.Decimal(input.total),
      currency: "TZS",
      payoutAccountId: input.account.id,
      approvedAt: now,
      createdAt: now,
    },
    input.account,
    await loadPayoutSafeguards(),
  );
  if (risk.level === "CRITICAL") {
    add("RISK_CRITICAL", "SUSPICIOUS", `Payout risk check: CRITICAL (${risk.flags.join(", ")}).`);
  } else if (!isAutoLaneRisk(risk)) {
    add("RISK_REVIEW", "REVIEW", `Payout risk check: ${risk.level} (${risk.flags.join(", ") || "no specific flag"}).`);
  }

  // ---- Switches: not a violation, but nothing goes automatically ----
  if (!settings.salesEnabled || !settings.sharedEnabled || settings.sharedDailyCapTzs === null) {
    add("AUTO_OFF", "INFO", "Automatic sales payouts are switched off.");
  }
  return flags;
}

export const isSuspicious = (flags: PolicyFlag[]) => flags.some((f) => f.severity === "SUSPICIOUS");

/** What the partner is told. Never names the fraud signal that froze them. */
export function partnerMessage(lane: "AUTO" | "REVIEW", flags: PolicyFlag[]): string {
  if (lane === "AUTO") return "Approved. Your money is on its way to your payout account.";
  if (isSuspicious(flags)) return "Your withdrawal is with our team for a check. Withdrawals are paused until it is complete.";
  if (flags.some((f) => f.code === "FIRST_WITHDRAWAL")) return "Your first withdrawal is checked by our team. Later withdrawals can be automatic.";
  return "Your withdrawal is with our team for a quick check. We will notify you when it is sent.";
}

function referenceNumber(partnerId: number) {
  return `SP-${new Date().getUTCFullYear()}-${partnerId}-${randomBytes(5).toString("hex").toUpperCase()}`;
}

async function audit(action: string, entity: string, entityId: number, afterJson: unknown, actor: { id: number | null; role: string }, now: Date, tx: any = db) {
  await tx.auditLog.create({
    data: { actorId: actor.id, actorRole: actor.role, action, entity, entityId, afterJson, ...retentionFields("FINANCIAL", now) },
  });
}

/** Counts a wrong code. The third in a row locks withdrawals and freezes the partner. */
async function recordWrongCode(partnerId: number, userId: number, challengeId: number, now: Date): Promise<number> {
  const failures = await db.$transaction(async (tx: any) => {
    await tx.salesPayoutChallenge.updateMany({ where: { id: challengeId }, data: { attempts: { increment: 1 } } });
    const bumped = await tx.salesPartnerProfile.updateMany({
      where: { id: partnerId, withdrawalOtpLockedAt: null },
      data: { withdrawalOtpFailures: { increment: 1 } },
    });
    if (bumped.count !== 1) return MAX_ATTEMPTS;
    const row = await tx.salesPartnerProfile.findUnique({ where: { id: partnerId }, select: { withdrawalOtpFailures: true } });
    if (row.withdrawalOtpFailures >= MAX_ATTEMPTS) {
      const flags: PolicyFlag[] = [{ code: "OTP_LOCKED", severity: "SUSPICIOUS", message: "Three wrong withdrawal codes in a row." }];
      await tx.salesPartnerProfile.update({
        where: { id: partnerId },
        data: { withdrawalOtpLockedAt: now, payoutHoldAt: now, payoutHoldReason: "Three wrong withdrawal codes in a row", payoutHoldFlags: flags },
      });
      await tx.salesPayoutChallenge.updateMany({
        where: { salesPartnerId: partnerId, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      });
    }
    return row.withdrawalOtpFailures;
  });
  try {
    await audit("SALES_WITHDRAWAL_CODE_WRONG", "SALES_PARTNER_PROFILE", partnerId, { failures, challengeId }, { id: userId, role: "USER" }, now);
    if (failures >= MAX_ATTEMPTS) {
      await audit("SALES_WITHDRAWAL_LOCKED", "SALES_PARTNER_PROFILE", partnerId, { failures }, { id: null, role: "SYSTEM" }, now);
      void notifyAdmins("sales_partner_payout_hold", { salesPartnerId: partnerId, reason: "Three wrong withdrawal codes in a row" }).catch(() => {});
    }
  } catch (error) {
    console.error("[sales-withdrawal] could not record wrong-code audit", { partnerId, error: String(error) });
  }
  return failures;
}

/** Step 2: the partner entered the code. Creates the payout and decides its lane. */
export async function confirmSalesWithdrawal(partnerId: number, challengeRef: string, code: string, now = new Date()) {
  if (!disbursementSendingEnabled()) {
    throw new SalesWithdrawalError("SENDING_PAUSED", "Withdrawals are temporarily paused. Nothing has been sent.", 503);
  }
  const partner = await loadPartner(partnerId);
  if (!partner) throw new SalesWithdrawalError("NOT_FOUND", "Sales partner not found.", 404);
  if (partner.withdrawalOtpLockedAt) throw new SalesWithdrawalError("OTP_LOCKED", LOCK_MESSAGE, 423);
  if (partner.payoutHoldAt) throw new SalesWithdrawalError("ON_HOLD", HOLD_MESSAGE);
  if (partner.status !== "ACTIVE") throw new SalesWithdrawalError("PARTNER_INACTIVE", "Your sales partner account is not active.");

  const challenge = await db.salesPayoutChallenge.findUnique({ where: { reference: String(challengeRef) } });
  if (!challenge || challenge.salesPartnerId !== partnerId) throw new SalesWithdrawalError("NOT_FOUND", "This withdrawal was not found. Start again.", 404);
  if (challenge.usedAt) throw new SalesWithdrawalError("ALREADY_USED", "This code was already used. Start again.");
  if (challenge.expiresAt.getTime() <= now.getTime()) throw new SalesWithdrawalError("EXPIRED", "This code has expired. Start again.");
  if (challenge.attempts >= MAX_ATTEMPTS) throw new SalesWithdrawalError("TOO_MANY_ATTEMPTS", "Too many wrong codes. Start again.");

  if (!codeMatches(code, challenge.codeHash)) {
    const failures = await recordWrongCode(partnerId, partner.userId, challenge.id, now);
    if (failures >= MAX_ATTEMPTS) throw new SalesWithdrawalError("OTP_LOCKED", LOCK_MESSAGE, 423);
    throw new SalesWithdrawalError("INVALID_CODE", "That code is not correct.", 400, { attemptsRemaining: Math.max(0, MAX_ATTEMPTS - failures) });
  }

  // Re-check the live state against what the code was issued for.
  const commissionIds = (Array.isArray(challenge.commissionIds) ? challenge.commissionIds : []).map(Number).filter(Number.isInteger);
  const { rows } = await withdrawableCommissions(partnerId);
  const byId = new Map<number, any>(rows.map((row: any) => [row.id, row]));
  const bound = commissionIds.map((id: number) => byId.get(id)).filter(Boolean);
  const total = round2(bound.reduce((sum: number, row: any) => sum + Number(row.commissionAmount || 0), 0));
  const account = await verifiedAccount(partner.userId);
  const same =
    bound.length === commissionIds.length &&
    !!account &&
    account.id === challenge.payoutAccountId &&
    salesWithdrawalFingerprint({ commissionIds, total, currency: challenge.currency, account }) === challenge.fingerprint;
  if (!same) {
    await db.salesPayoutChallenge.updateMany({ where: { id: challenge.id, usedAt: null }, data: { usedAt: now } });
    throw new SalesWithdrawalError("CHANGED", "Something changed since the code was sent. Check your earnings and start again.");
  }

  const flags = await evaluateSalesWithdrawalPolicy({ partnerId, userId: partner.userId, commissions: bound, total, account: account!, now });
  const lane: "AUTO" | "REVIEW" = flags.length === 0 ? "AUTO" : "REVIEW";
  const suspicious = isSuspicious(flags);
  const contactSnapshot = await db.salesPartnerProfile.findUnique({ where: { id: partnerId }, select: { payoutName: true, payoutMethod: true } });

  const payout = await db.$transaction(async (tx: any) => {
    const spent = await tx.salesPayoutChallenge.updateMany({
      where: { id: challenge.id, usedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS } },
      data: { usedAt: now },
    });
    if (spent.count !== 1) throw new SalesWithdrawalError("ALREADY_USED", "This code was already used. Start again.");
    const unlocked = await tx.salesPartnerProfile.updateMany({
      where: { id: partnerId, withdrawalOtpLockedAt: null, payoutHoldAt: null },
      data: { withdrawalOtpFailures: 0 },
    });
    if (unlocked.count !== 1) throw new SalesWithdrawalError("ON_HOLD", HOLD_MESSAGE);
    const open = await tx.salesPayoutRequest.findFirst({
      where: { salesPartnerId: partnerId, status: { in: OPEN_PAYOUT_STATUSES } },
      select: { id: true },
    });
    if (open) throw new SalesWithdrawalError("OPEN_WITHDRAWAL", "Another withdrawal is still on its way.");

    const created = await tx.salesPayoutRequest.create({
      data: {
        salesPartnerId: partnerId,
        referenceNumber: referenceNumber(partnerId),
        requestedAmount: total,
        currency: "TZS",
        status: lane === "AUTO" ? "REQUESTED" : "UNDER_REVIEW",
        payoutMethod: contactSnapshot?.payoutMethod || account!.provider,
        payoutName: contactSnapshot?.payoutName || account!.accountName,
        payoutAccount: account!.accountNumber,
        lane,
        reviewFlags: flags,
        payoutAccountId: account!.id,
        challengeId: challenge.id,
      },
      select: { id: true, referenceNumber: true, requestedAmount: true, status: true },
    });
    await tx.salesPayoutItem.createMany({
      data: bound.map((row: any) => ({ payoutId: created.id, commissionId: row.id, amount: row.commissionAmount })),
    });
    if (suspicious) {
      await tx.salesPartnerProfile.update({
        where: { id: partnerId },
        data: {
          payoutHoldAt: now,
          payoutHoldReason: flags.filter((f) => f.severity === "SUSPICIOUS").map((f) => f.code).join(", ").slice(0, 300),
          payoutHoldFlags: flags.filter((f) => f.severity === "SUSPICIOUS"),
        },
      });
    }
    await audit("SALES_WITHDRAWAL_CONFIRMED", "SALES_PAYOUT_REQUEST", created.id, {
      referenceNumber: created.referenceNumber,
      total,
      commissionIds,
      lane,
      flags,
      payoutAccountId: account!.id,
      destination: challenge.destinationMasked,
      challengeId: challenge.id,
    }, { id: partner.userId, role: "USER" }, now, tx);
    if (suspicious) {
      await audit("SALES_PAYOUT_HOLD_PLACED", "SALES_PARTNER_PROFILE", partnerId, { by: "POLICY", flags }, { id: null, role: "SYSTEM" }, now, tx);
    }
    return created;
  }).catch((error: any) => {
    if (error?.code === "P2002") throw new SalesWithdrawalError("CHANGED", "An earning was claimed by another payout. Reload and try again.");
    throw error;
  });

  if (lane === "AUTO") {
    // Best effort now; the lifecycle worker resumes anything left halfway.
    await startSalesAutoPayout(payout.id, now).catch((error) => {
      console.error("[sales-withdrawal] automatic handoff will be retried", { payoutId: payout.id, error: String(error) });
    });
  } else {
    void notifyAdmins("sales_partner_payout_review", {
      referenceNumber: payout.referenceNumber,
      amount: total,
      currency: "TZS",
      agentCode: partner.agentCode,
      reasons: flags.map((f) => f.message).join(" "),
    }).catch(() => {});
    if (suspicious) {
      void notifyAdmins("sales_partner_payout_hold", { salesPartnerId: partnerId, agentCode: partner.agentCode, reason: flags.filter((f) => f.severity === "SUSPICIOUS").map((f) => f.message).join(" ") }).catch(() => {});
    }
  }
  void notifyUser(partner.userId, lane === "AUTO" ? "sales_partner_payout_auto" : "sales_partner_payout_review", {
    referenceNumber: payout.referenceNumber,
    amount: total,
    currency: "TSh",
    message: partnerMessage(lane, flags),
  }).catch(() => {});

  return {
    referenceNumber: payout.referenceNumber,
    lane,
    status: lane === "AUTO" ? "PROCESSING" : "UNDER_REVIEW",
    total,
    currency: "TZS",
    destination: challenge.destinationMasked,
    message: partnerMessage(lane, flags),
  };
}

class HandoffNeedsReview extends Error {}

async function sendToReview(payoutId: number, reason: string, now: Date) {
  const row = await db.salesPayoutRequest.findUnique({
    where: { id: payoutId },
    select: { status: true, referenceNumber: true, requestedAmount: true, reviewFlags: true, salesPartner: { select: { agentCode: true } } },
  });
  if (!row) return;
  const flags = [...(Array.isArray(row.reviewFlags) ? row.reviewFlags : []), { code: "AUTO_HANDOFF_FAILED", severity: "REVIEW", message: reason }];
  await db.salesPayoutRequest.updateMany({
    where: { id: payoutId, lane: "AUTO" },
    data: {
      lane: "REVIEW",
      reviewFlags: flags,
      handoffError: reason.slice(0, 500),
      // An approved row stays APPROVED: finance sends it from Disbursements.
      ...(row.status === "REQUESTED" ? { status: "UNDER_REVIEW" } : {}),
    },
  });
  await audit("SALES_PAYOUT_AUTO_TO_REVIEW", "SALES_PAYOUT_REQUEST", payoutId, { reason }, { id: null, role: "SYSTEM" }, now).catch(() => {});
  void notifyAdmins("sales_partner_payout_review", {
    referenceNumber: row.referenceNumber,
    amount: Number(row.requestedAmount),
    currency: "TZS",
    agentCode: row.salesPartner?.agentCode,
    reasons: reason,
  }).catch(() => {});
}

/**
 * AUTO lane: approve as the system, then create and system-approve the
 * disbursement. Idempotent: safe to call again after a crash at any step.
 */
export async function startSalesAutoPayout(payoutId: number, now = new Date()): Promise<"QUEUED" | "REVIEW" | "SKIPPED"> {
  const payout = await db.salesPayoutRequest.findUnique({
    where: { id: payoutId },
    select: {
      id: true, status: true, lane: true, requestedAmount: true, requestedAt: true, payoutAccountId: true,
      handoffAttempts: true, referenceNumber: true,
      salesPartner: { select: { id: true, userId: true, payoutHoldAt: true, status: true } },
    },
  });
  if (!payout || payout.lane !== "AUTO" || !["REQUESTED", "APPROVED"].includes(payout.status)) return "SKIPPED";
  try {
    if (payout.salesPartner.payoutHoldAt || payout.salesPartner.status !== "ACTIVE") {
      throw new HandoffNeedsReview("The partner's withdrawals were frozen before the payout was sent");
    }
    const account = await db.payoutAccount.findUnique({ where: { id: payout.payoutAccountId ?? 0 } });
    if (!account || account.userId !== payout.salesPartner.userId || !account.isVerified || !account.isActive) {
      throw new HandoffNeedsReview("The confirmed payout account is no longer verified");
    }
    if (account.destinationChangedAt && account.destinationChangedAt.getTime() > payout.requestedAt.getTime()) {
      throw new HandoffNeedsReview("The payout account changed after the partner confirmed the withdrawal");
    }

    if (payout.status === "REQUESTED") {
      const amounts = calculateSalesPayoutApproval(Number(payout.requestedAmount), 0, salesWithholdingTaxRate());
      const approved = await db.salesPayoutRequest.updateMany({
        where: { id: payout.id, status: "REQUESTED", lane: "AUTO" },
        data: {
          status: "APPROVED",
          reviewedAt: now,
          approvedAt: now,
          reviewedById: null,
          approvedAmount: amounts.approvedAmount,
          deductionAmount: 0,
          withholdingTaxRate: amounts.withholdingTaxRate > 0 ? amounts.withholdingTaxRate : null,
          withholdingTaxAmount: amounts.withholdingTaxAmount,
          netPaidAmount: amounts.netPaidAmount,
          adminNotes: "Approved automatically: the partner confirmed with their code and every withdrawal rule passed.",
        },
      });
      if (approved.count !== 1) return "SKIPPED";
      await audit("SALES_PAYOUT_APPROVED_AUTO", "SALES_PAYOUT_REQUEST", payout.id, amounts, { id: null, role: "SYSTEM" }, now).catch(() => {});
    }

    const existing = await db.disbursement.findFirst({
      where: { sourceType: "SALES_PAYOUT", sourceId: payout.id, status: { not: "FAILED" } },
      orderBy: { id: "desc" },
      select: { id: true, status: true, releaseLane: true, payoutAccountId: true },
    });
    if (existing) {
      if (existing.payoutAccountId !== account.id) throw new HandoffNeedsReview("An existing disbursement points to a different account");
      if (existing.status === "REQUESTED") await approveDisbursementAutomatically(existing.id);
      else if (existing.releaseLane !== "AUTO") throw new HandoffNeedsReview("An existing disbursement is in the manual lane");
    } else {
      const failed = await db.disbursement.findFirst({ where: { sourceType: "SALES_PAYOUT", sourceId: payout.id, status: "FAILED" }, select: { id: true } });
      if (failed) throw new HandoffNeedsReview("A failed disbursement needs reconciliation before another attempt");
      const requested = await requestDisbursement({
        sourceType: "SALES_PAYOUT",
        sourceId: payout.id,
        payoutAccountId: account.id,
        requestedById: payout.salesPartner.userId,
        remarks: "Sales withdrawal (automatic)",
      });
      await approveDisbursementAutomatically(requested.id);
    }
    await db.salesPayoutRequest.updateMany({ where: { id: payout.id }, data: { handoffError: null } });
    return "QUEUED";
  } catch (error: any) {
    const reason = String(error?.message || error).slice(0, 500);
    const attempts = payout.handoffAttempts + 1;
    if (error instanceof HandoffNeedsReview || attempts >= SALES_WITHDRAWAL_RULES.handoffMaxAttempts) {
      await sendToReview(payout.id, reason, now);
      return "REVIEW";
    }
    await db.salesPayoutRequest.updateMany({ where: { id: payout.id }, data: { handoffAttempts: attempts, handoffError: reason } });
    throw error;
  }
}

/** Worker: resume AUTO payouts left halfway (crash, timeout, provider hiccup). */
export async function resumeSalesAutoPayouts(now = new Date(), limit = 20): Promise<{ queued: number; review: number }> {
  const result = { queued: 0, review: 0 };
  if (!disbursementSendingEnabled()) return result;
  const rows = await db.salesPayoutRequest.findMany({
    where: {
      lane: "AUTO",
      status: { in: ["REQUESTED", "APPROVED"] },
      updatedAt: { lte: new Date(now.getTime() - SALES_WITHDRAWAL_RULES.handoffResumeAfterMs) },
    },
    orderBy: { id: "asc" },
    take: limit * 3,
    select: { id: true, status: true },
  });
  for (const row of rows.slice(0, limit * 3)) {
    if (result.queued + result.review >= limit) break;
    if (row.status === "APPROVED") {
      const done = await db.disbursement.findFirst({
        where: { sourceType: "SALES_PAYOUT", sourceId: row.id, status: { notIn: ["FAILED", "REQUESTED"] }, releaseLane: "AUTO" },
        select: { id: true },
      });
      if (done) continue;
    }
    try {
      const outcome = await startSalesAutoPayout(row.id, now);
      if (outcome === "QUEUED") result.queued++;
      if (outcome === "REVIEW") result.review++;
    } catch {
      // Counted on the row; retried next pass.
    }
  }
  return result;
}

/** Admin: lift a withdrawal freeze (and a wrong-code lock) with a reason. */
export async function clearSalesPayoutHold(partnerId: number, adminId: number, reason: string, now = new Date()) {
  const before = await db.salesPartnerProfile.findUnique({
    where: { id: partnerId },
    select: { userId: true, payoutHoldAt: true, payoutHoldReason: true, payoutHoldFlags: true, withdrawalOtpLockedAt: true },
  });
  if (!before) throw new SalesWithdrawalError("NOT_FOUND", "Sales partner not found.", 404);
  if (!before.payoutHoldAt && !before.withdrawalOtpLockedAt) throw new SalesWithdrawalError("NOT_ON_HOLD", "This partner's withdrawals are not paused.");
  await db.$transaction(async (tx: any) => {
    await tx.salesPartnerProfile.update({
      where: { id: partnerId },
      data: { payoutHoldAt: null, payoutHoldReason: null, payoutHoldFlags: null, withdrawalOtpLockedAt: null, withdrawalOtpFailures: 0 },
    });
    await audit("SALES_PAYOUT_HOLD_CLEARED", "SALES_PARTNER_PROFILE", partnerId, {
      reason,
      previous: { at: before.payoutHoldAt, reason: before.payoutHoldReason, flags: before.payoutHoldFlags, otpLockedAt: before.withdrawalOtpLockedAt },
    }, { id: adminId, role: "ADMIN" }, now, tx);
  });
  void notifyUser(before.userId, "sales_partner_payout_hold_cleared", {}).catch(() => {});
}

/** Admin: freeze a partner's withdrawals by hand. */
export async function placeSalesPayoutHold(partnerId: number, adminId: number, reason: string, now = new Date()) {
  const flags: PolicyFlag[] = [{ code: "ADMIN_HOLD", severity: "SUSPICIOUS", message: reason }];
  const changed = await db.salesPartnerProfile.updateMany({
    where: { id: partnerId, payoutHoldAt: null },
    data: { payoutHoldAt: now, payoutHoldReason: reason.slice(0, 300), payoutHoldFlags: flags },
  });
  if (changed.count !== 1) throw new SalesWithdrawalError("ALREADY_ON_HOLD", "This partner's withdrawals are already paused.");
  await audit("SALES_PAYOUT_HOLD_PLACED", "SALES_PARTNER_PROFILE", partnerId, { by: "ADMIN", reason }, { id: adminId, role: "ADMIN" }, now);
}

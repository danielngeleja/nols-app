/**
 * One owner's payout picture, shared by the admin Payouts panel and the
 * exported payout record PDF, so the screen and the paper can never disagree.
 * Reads only.
 */
import { prisma } from "@nolsaf/prisma";
import type { Prisma } from "@prisma/client";
import { verifiedPayoutAccounts } from "./release.js";
import { destinationChangeAnchor, loadPayoutSafeguards } from "./riskScoring.js";
import { decideOwnerPayoutLane, walletNameMatchesOwner } from "./autoLane.js";
import { openRecoveryTotal } from "./recovery.js";
import { readyBalances } from "./partialWithdrawal.js";
import { loadOwnerPayoutControl } from "./ownerPayoutControl.js";
import { payoutAccountEnding } from "../../lib/ownerAccountActivity.js";

export type OwnerPayoutOverview = Awaited<ReturnType<typeof buildOwnerPayoutOverview>>;

/** Null when the id is not an owner. */
export async function buildOwnerPayoutOverview(id: number, now = new Date()) {
  const owner = await prisma.user.findFirst({
    where: { id, role: "OWNER" },
    select: { id: true, name: true, fullName: true, phoneChangedAt: true, emailChangedAt: true },
  });
  if (!owner) return null;
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const since14 = new Date(now.getTime() - 14 * 86_400_000);
  const ownerPayouts = { payoutAccount: { is: { userId: id } } } satisfies Prisma.DisbursementWhereInput;

  const [account, control, safeguards, otpGuard, paidCount, paid30, failed14, waiting, recoveryDue, releases, recent] = await Promise.all([
    verifiedPayoutAccounts(id).then((rows) => rows[0] ?? null),
    loadOwnerPayoutControl(id),
    loadPayoutSafeguards(),
    prisma.payoutWithdrawalOtpGuard.findUnique({ where: { ownerId: id }, select: { lockedAt: true, failedAttempts: true } }),
    prisma.disbursement.count({ where: { ...ownerPayouts, status: "PAID" } }),
    prisma.disbursement.aggregate({ where: { ...ownerPayouts, status: "PAID", paidAt: { gte: since30 } }, _sum: { amount: true } }),
    prisma.disbursement.count({ where: { ...ownerPayouts, status: "FAILED", createdAt: { gte: since14 } } }),
    prisma.disbursement.findMany({
      where: { ...ownerPayouts, status: "REQUESTED", sourceType: { in: ["OWNER_WITHDRAWAL", "OWNER_INVOICE"] } },
      select: { amount: true, createdAt: true }, orderBy: { createdAt: "asc" },
    }),
    openRecoveryTotal(id),
    prisma.payoutRelease.groupBy({ by: ["status"], where: { ownerId: id, status: { in: ["LOCKED", "HELD", "AVAILABLE"] } }, _count: { _all: true } }),
    prisma.disbursement.findMany({
      where: { ...ownerPayouts, sourceType: { in: ["OWNER_WITHDRAWAL", "OWNER_INVOICE"] } },
      select: { externalReferenceId: true, amount: true, status: true, releaseLane: true, approvedById: true, createdAt: true, paidAt: true, securityReviewReason: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const ready = (await readyBalances(id, now)).reduce((sum, row) => sum + row.remaining, 0);
  const hours = safeguards.recentChangeHours * 3_600_000;
  const anchor = account ? await destinationChangeAnchor(account) : null;
  const walletWaitUntil = anchor && anchor.getTime() + hours > now.getTime() ? new Date(anchor.getTime() + hours) : null;
  const contactChangedAt = [owner.phoneChangedAt, owner.emailChangedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  const contactWaitUntil = contactChangedAt && contactChangedAt.getTime() + hours > now.getTime() ? new Date(contactChangedAt.getTime() + hours) : null;

  // The route a withdrawal of today's ready balance would take, with the same
  // rules the real handoff uses (including an open refund recovery).
  let nextRoute: { lane: "AUTO" | "MANUAL"; reason: string | null; amount: number } | null = null;
  if (account && ready > 0) {
    const decision = await decideOwnerPayoutLane({ ownerId: id, invoiceId: 0, amount: ready, account, now });
    nextRoute = decision.lane === "AUTO" && recoveryDue > 0
      ? { lane: "MANUAL", reason: "A recovery from an earlier refund is still open", amount: ready }
      : { ...decision, amount: ready };
  }
  const count = (status: string) => releases.find((r) => r.status === status)?._count._all ?? 0;

  return {
    owner: { name: owner.fullName || owner.name || null },
    money: {
      firstPayoutDone: paidCount > 0,
      paidCount,
      paidLast30Days: Number(paid30._sum.amount ?? 0),
      readyToWithdraw: Math.round(ready * 100) / 100,
      unlockingCount: count("LOCKED"),
      onHoldCount: count("HELD"),
      readyCount: count("AVAILABLE"),
      waitingApproval: {
        count: waiting.length,
        total: waiting.reduce((sum, row) => sum + Number(row.amount), 0),
        oldestAt: waiting[0]?.createdAt ?? null,
      },
      recoveryDue,
    },
    nextRoute,
    safety: {
      wallet: account ? {
        provider: account.provider,
        ending: payoutAccountEnding(account.accountNumber),
        holderName: account.accountName ?? null,
        nameMatchesOwner: walletNameMatchesOwner(account.accountName, [owner.fullName, owner.name]),
      } : null,
      walletWaitUntil,
      contactWaitUntil,
      codeLocked: Boolean(otpGuard?.lockedAt) || (otpGuard?.failedAttempts ?? 0) >= 3,
      wrongCodes: otpGuard?.failedAttempts ?? 0,
      failedLast14Days: failed14,
    },
    controls: {
      available: control.available,
      hold: control.hold ? { at: control.hold.at, reason: control.hold.reason } : null,
      alwaysReview: control.alwaysReview ? { reason: control.alwaysReview.reason } : null,
    },
    recent: recent.map((row) => ({
      reference: row.externalReferenceId,
      amount: Number(row.amount),
      status: row.status,
      route: row.releaseLane === "AUTO" ? "AUTO" as const : "MANUAL" as const,
      approvedAutomatically: row.releaseLane === "AUTO" && row.approvedById == null,
      createdAt: row.createdAt,
      paidAt: row.paidAt,
      note: row.securityReviewReason ?? null,
    })),
  };
}

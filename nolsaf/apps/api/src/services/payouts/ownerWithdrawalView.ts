/**
 * What an owner sees for each amount withdrawal they confirmed: one plain
 * state on a fixed track (Requested, Checked, Sending, Paid), plus the
 * returned case. Internal reasons (security notes, provider wording about our
 * own wallet) are never part of it.
 */
import { prisma } from "@nolsaf/prisma";

export type OwnerWithdrawalState =
  | "PREPARING" // code confirmed, the transfer is being created
  | "CHECKING" // a person or a safety check is looking at it
  | "SENDING" // approved and on its way to the provider
  | "PAID"
  | "RETURNED"; // could not be sent; the money is back in Ready

export type OwnerWithdrawalView = {
  reference: string;
  amount: number;
  currency: string;
  destination: string;
  state: OwnerWithdrawalState;
  requestedAt: Date | null;
  checkedAt: Date | null;
  sendingAt: Date | null;
  paidAt: Date | null;
  returnedAt: Date | null;
};

type ChallengeRow = {
  id: number; reference: string; totalAmount: unknown; currency: string;
  destinationMasked: string; usedAt: Date | null; handoffStatus: string | null;
};
type TransferRow = {
  sourceId: number; status: string; approvedAt: Date | null; submittedAt: Date | null;
  paidAt: Date | null; failedAt: Date | null;
};

const SENDING = new Set(["APPROVED", "BATCHED", "AUTHORIZED", "SUBMITTED", "PROCESSING"]);

export function ownerWithdrawalState(handoffStatus: string | null, transfer: TransferRow | null): OwnerWithdrawalState {
  if (!transfer) {
    if (handoffStatus === "CANCELLED") return "RETURNED";
    return handoffStatus === "REVIEW_REQUIRED" ? "CHECKING" : "PREPARING";
  }
  if (transfer.status === "PAID") return "PAID";
  // A failure only counts as returned once the balance was actually released.
  if (transfer.status === "FAILED") return handoffStatus === "CANCELLED" ? "RETURNED" : "CHECKING";
  if (SENDING.has(transfer.status)) return "SENDING";
  return "CHECKING"; // REQUESTED, SECURITY_REVIEW
}

export function toOwnerWithdrawalView(challenge: ChallengeRow, transfer: TransferRow | null): OwnerWithdrawalView {
  const state = ownerWithdrawalState(challenge.handoffStatus, transfer);
  return {
    reference: challenge.reference,
    amount: Number(challenge.totalAmount),
    currency: challenge.currency,
    destination: challenge.destinationMasked,
    state,
    requestedAt: challenge.usedAt,
    checkedAt: transfer?.approvedAt ?? null,
    sendingAt: transfer?.submittedAt ?? null,
    paidAt: state === "PAID" ? transfer?.paidAt ?? null : null,
    returnedAt: state === "RETURNED" ? transfer?.failedAt ?? null : null,
  };
}

/** The owner's most recent confirmed amount withdrawals, newest first. */
export async function recentOwnerWithdrawals(ownerId: number, take = 5): Promise<OwnerWithdrawalView[]> {
  const challenges: ChallengeRow[] = await prisma.payoutWithdrawalChallenge.findMany({
    where: { userId: ownerId, planVersion: 2, usedAt: { not: null } },
    orderBy: { usedAt: "desc" },
    take,
    select: { id: true, reference: true, totalAmount: true, currency: true, destinationMasked: true, usedAt: true, handoffStatus: true },
  });
  if (!challenges.length) return [];
  const transfers: TransferRow[] = await prisma.disbursement.findMany({
    where: { sourceType: "OWNER_WITHDRAWAL", sourceId: { in: challenges.map((row) => row.id) } },
    orderBy: { id: "desc" },
    select: { sourceId: true, status: true, approvedAt: true, submittedAt: true, paidAt: true, failedAt: true },
  });
  // Newest transfer per withdrawal (ordered by id desc, first one wins).
  const latest = new Map<number, TransferRow>();
  for (const row of transfers) if (!latest.has(row.sourceId)) latest.set(row.sourceId, row);
  return challenges.map((row) => toOwnerWithdrawalView(row, latest.get(row.id) ?? null));
}

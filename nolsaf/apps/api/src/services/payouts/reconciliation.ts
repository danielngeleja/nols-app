/**
 * Payout Reconciliation — fallback for delayed or missed callbacks
 *
 * See "Transaction Status: fallback and reconciliation" in
 * docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md. Polls AzamPay for any
 * Disbursement stuck in SUBMITTED/PROCESSING past a threshold and applies
 * the result through the same idempotent path a real callback uses
 * (ledger.applyProviderEvent), so there is exactly one place that ever
 * writes a PAID/FAILED transition.
 */

import { prisma } from "@nolsaf/prisma";
import type { Disbursement } from "@prisma/client";
import { azamPayTransactionStatus } from "../azampay/disbursement/client.js";
import { normalizeAzamPayFinalStatus } from "../azampay/disbursement/contract.js";
import { applyProviderEvent, recordAmountMismatch } from "./ledger.js";

/** AzamPay reported a figure that does not match what this payout is for. Never applied automatically, either way. */
export class AmountMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountMismatchError";
  }
}

const DEFAULT_STALE_THRESHOLD_MINUTES = 30;

export interface ReconciliationResult {
  checked: number;
  resolved: number;
  stillPending: number;
  errors: number;
  /** Payouts where AzamPay reported a different amount. Held, never applied. */
  mismatched: number;
}

/**
 * Polls AzamPay for one disbursement and applies the result through the
 * same idempotent path a callback uses. Shared by the cron worker below
 * and by an admin's manual "check status" action — there is exactly one
 * implementation of "ask AzamPay and apply the answer".
 */
export async function checkDisbursementStatus(disbursementId: number): Promise<Disbursement> {
  const disbursement = await prisma.disbursement.findUnique({
    where: { id: disbursementId },
    select: { id: true, pgReferenceId: true, bankName: true, status: true, amount: true },
  });
  if (!disbursement) throw new Error(`Disbursement ${disbursementId} not found`);
  if (!disbursement.pgReferenceId) {
    throw new Error(`Disbursement ${disbursementId} has no pgReferenceId yet (not submitted to AzamPay)`);
  }

  const status = await azamPayTransactionStatus({
    pgReferenceId: disbursement.pgReferenceId,
    bankName: disbursement.bankName,
  });

  const normalizedStatus = normalizeAzamPayFinalStatus(status);
  if (!normalizedStatus) {
    return prisma.disbursement.findUniqueOrThrow({ where: { id: disbursementId } });
  }

  // The callback route amount-checks before applying; this path did not, so a
  // mismatch the callback refused was accepted 30 minutes later by the poller.
  // Both entry points into applyProviderEvent must agree on the same rule.
  const reportedAmount = Number((status as any).amount);
  if (Number.isFinite(reportedAmount) && Math.abs(reportedAmount - Number(disbursement.amount)) > 0.01) {
    await recordAmountMismatch(disbursementId, {
      expected: disbursement.amount.toString(),
      received: String((status as any).amount),
      source: "STATUS_POLL",
      payload: status,
    });
    throw new AmountMismatchError(
      `Disbursement ${disbursementId}: AzamPay reports ${(status as any).amount} for a payout of ${disbursement.amount}. ` +
        `Status not applied; resolve the discrepancy with AzamPay before this payout is settled either way.`
    );
  }

  return applyProviderEvent(disbursementId, {
    eventType: "STATUS_POLL",
    callback: {
      initiatorReferenceId: "", // not used by applyProviderEvent, disbursementId already resolved
      fspReferenceId: String((status as any).fspReferenceId ?? ""),
      pgReferenceId: status.pgReferenceId,
      amount: String((status as any).amount ?? ""),
      status: normalizedStatus,
      message: status.message ?? "",
      operator: String((status as any).operator ?? ""),
    },
  });
}

export async function reconcileStalePayouts(
  staleThresholdMinutes = DEFAULT_STALE_THRESHOLD_MINUTES
): Promise<ReconciliationResult> {
  const cutoff = new Date(Date.now() - staleThresholdMinutes * 60 * 1000);

  const stale = await prisma.disbursement.findMany({
    where: {
      status: { in: ["SUBMITTED", "PROCESSING"] },
      submittedAt: { lt: cutoff },
      pgReferenceId: { not: null },
    },
    select: { id: true },
  });

  const result: ReconciliationResult = { checked: stale.length, resolved: 0, stillPending: 0, errors: 0, mismatched: 0 };

  for (const disbursement of stale) {
    try {
      const updated = await checkDisbursementStatus(disbursement.id);
      if (updated.status === "PAID" || updated.status === "FAILED") result.resolved += 1;
      else result.stillPending += 1;
    } catch (err) {
      if (err instanceof AmountMismatchError) {
        // Already persisted as a DisbursementEvent by checkDisbursementStatus.
        // Counted separately so it does not hide among transport errors.
        result.mismatched += 1;
        console.error(`[payout-reconciliation] ${err.message}`);
        continue;
      }
      result.errors += 1;
      console.error(`[payout-reconciliation] failed to check disbursement ${disbursement.id}:`, err);
    }
  }

  return result;
}

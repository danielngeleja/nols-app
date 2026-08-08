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
import { applyProviderEvent } from "./ledger.js";

const DEFAULT_STALE_THRESHOLD_MINUTES = 30;

export interface ReconciliationResult {
  checked: number;
  resolved: number;
  stillPending: number;
  errors: number;
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
    select: { id: true, pgReferenceId: true, bankName: true, status: true },
  });
  if (!disbursement) throw new Error(`Disbursement ${disbursementId} not found`);
  if (!disbursement.pgReferenceId) {
    throw new Error(`Disbursement ${disbursementId} has no pgReferenceId yet (not submitted to AzamPay)`);
  }

  const status = await azamPayTransactionStatus({
    pgReferenceId: disbursement.pgReferenceId,
    bankName: disbursement.bankName,
  });

  const normalizedStatus = String(status.status || "").toLowerCase();
  if (normalizedStatus !== "success" && normalizedStatus !== "failure") {
    return prisma.disbursement.findUniqueOrThrow({ where: { id: disbursementId } });
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

  const result: ReconciliationResult = { checked: stale.length, resolved: 0, stillPending: 0, errors: 0 };

  for (const disbursement of stale) {
    try {
      const updated = await checkDisbursementStatus(disbursement.id);
      if (updated.status === "PAID" || updated.status === "FAILED") result.resolved += 1;
      else result.stillPending += 1;
    } catch (err) {
      result.errors += 1;
      console.error(`[payout-reconciliation] failed to check disbursement ${disbursement.id}:`, err);
    }
  }

  return result;
}

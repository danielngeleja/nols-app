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

/** Keys whose values may be logged: status-like words only. */
const LOGGABLE_KEY = /(status|state|result|success|code|message|desc|reason|error)/i;
/** Anything that could identify a person or an account is never logged, whatever else the key says. */
const PRIVATE_KEY = /(account|msisdn|phone|mobile|name|number|token|key|secret|checksum|email|reference)/i;

/**
 * Field paths of an AzamPay status reply, plus the values of status-like
 * fields only. Values are short scalars; anything private or nested deeper
 * than two levels is reduced to its path.
 */
export function describeStatusReply(reply: unknown): { fields: string[]; values: Record<string, string | number | boolean | null> } {
  const fields: string[] = [];
  const values: Record<string, string | number | boolean | null> = {};
  const walk = (node: unknown, prefix: string, depth: number) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      fields.push(path);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (depth < 2) walk(value, path, depth + 1);
        continue;
      }
      if (PRIVATE_KEY.test(key) || !LOGGABLE_KEY.test(key)) continue;
      if (value === null || typeof value === "number" || typeof value === "boolean") values[path] = value;
      // A free-text message can quote a phone or account number; mask long digit runs.
      else if (typeof value === "string") values[path] = value.slice(0, 80).replace(/\d{6,}/g, "[digits]");
    }
  };
  walk(reply, "", 0);
  return { fields: fields.slice(0, 40), values };
}

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
    // AzamPay does not document which field carries the final result, so an
    // unread reply used to vanish silently. Log its shape (never account data)
    // so the real field can be mapped from evidence, not guessed.
    console.warn(
      `[payout-reconciliation] unrecognised status reply for disbursement ${disbursementId}: ` +
        JSON.stringify(describeStatusReply(status))
    );
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

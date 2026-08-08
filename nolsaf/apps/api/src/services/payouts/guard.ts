/**
 * Legacy Payout Guard
 *
 * Owners, Tours, Drivers and Sales each still have their own pre-existing
 * "mark paid" action (admin.owners.ts, admin.tourRevenue.ts,
 * admin.drivers.ts, admin.sales.finance.ts) that writes straight to the
 * source record's own status field, with no knowledge that the shared
 * Disbursement ledger exists. Left alone, an admin could approve a claim,
 * push it through the real AzamPay Disbursement flow, and then also click
 * the old domain's manual "disburse"/"pay" button — two payments for one
 * claim, with the second one backed by nothing but a hand-typed reference.
 *
 * This module is the single check every legacy pay action must call first.
 * It does not touch AzamPay or the ledger state machine — it only answers
 * "does this source already have a disbursement in flight or paid."
 */

import { prisma } from "@nolsaf/prisma";
import type { PayoutSourceType } from "./eligibility.js";

export class ActiveDisbursementExistsError extends Error {
  constructor(
    readonly sourceType: PayoutSourceType,
    readonly sourceId: number,
    readonly disbursementId: number,
    readonly disbursementStatus: string
  ) {
    super(
      `${sourceType}:${sourceId} already has disbursement #${disbursementId} (${disbursementStatus}). ` +
        `Use the Disbursements queue instead of the legacy manual payout action.`
    );
    this.name = "ActiveDisbursementExistsError";
  }
}

/**
 * Throws if this source already has a disbursement that is not FAILED
 * (i.e. REQUESTED, APPROVED, SUBMITTED, PROCESSING, or PAID). FAILED is
 * excluded deliberately — a failed attempt does not block a fresh one,
 * matching ledger.requestDisbursement's own re-request rule.
 */
export async function assertNoActiveDisbursement(sourceType: PayoutSourceType, sourceId: number): Promise<void> {
  const existing = await prisma.disbursement.findFirst({
    where: { sourceType, sourceId, status: { not: "FAILED" } },
    select: { id: true, status: true },
  });
  if (existing) {
    throw new ActiveDisbursementExistsError(sourceType, sourceId, existing.id, existing.status);
  }
}

/**
 * Bulk variant for endpoints that pay many sources in one call (e.g. the
 * owner invoice bulk payout). Returns the subset of sourceIds that already
 * have an active disbursement, so the caller can exclude them rather than
 * failing the whole batch.
 */
export async function findSourceIdsWithActiveDisbursement(
  sourceType: PayoutSourceType,
  sourceIds: number[]
): Promise<Set<number>> {
  if (sourceIds.length === 0) return new Set();
  const rows = await prisma.disbursement.findMany({
    where: { sourceType, sourceId: { in: sourceIds }, status: { not: "FAILED" } },
    select: { sourceId: true },
  });
  return new Set(rows.map((r) => r.sourceId));
}

/**
 * Disbursement Batching — what happens after APPROVED
 *
 * Per docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md "Batch security architecture":
 * APPROVED -> BATCHED -> AUTHORIZED -> PROCESSING -> PAID/FAILED, with a
 * SECURITY_REVIEW off-ramp at batch formation and at authorize time. There is
 * no individual "send to AzamPay" path: ledger.submitToAzamPay accepts only
 * AUTHORIZED, so the only way money reaches AzamPay is through a batch that
 * someone other than the approver released.
 *
 * formBatch(): the automatic step. Pulls every APPROVED, not-yet-batched
 *   disbursement, bulk re-verifies its payout account with AzamPay Name
 *   Lookup (closes the staleness window between approve-time verification
 *   and batch-time release), re-checks the approval fingerprint, and
 *   risk-scores it. Anything that fails re-verification, fails its
 *   fingerprint check, or scores HIGH/CRITICAL is excluded and flagged
 *   SECURITY_REVIEW instead of entering the batch. Runs under a database
 *   advisory lock and forms one batch per currency.
 *
 * authorizeBatch(): the deliberate human step (OTP-gated at the route layer,
 *   and refused when the authorizer formed the batch or approved any member).
 *   Recomputes the batch fingerprint from current member state against the
 *   LIVE payout accounts; a mismatch freezes the whole batch to
 *   SECURITY_REVIEW rather than releasing a batch that changed since
 *   formation.
 *
 * processBatch(): worker step, driven by workers/processAuthorizedBatches.ts.
 *   Never runs inside an HTTP request: a request that times out mid-loop used
 *   to strand the batch in PROCESSING with the remaining items AUTHORIZED and
 *   no way back in. Submits each AUTHORIZED member to AzamPay one at a time
 *   via submitToAzamPay() — batching is internal to NoLSAF; AzamPay's own
 *   /disburse endpoint is still called once per payout.
 */

import { randomBytes } from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { Prisma, type Disbursement, type PayoutAccount } from "@prisma/client";
import { computeApprovalFingerprint, computeBatchFingerprint, toBatchFingerprintMember } from "./fingerprint.js";
import { assessDisbursementRisk } from "./riskScoring.js";
import { azamPayNameLookup } from "../azampay/disbursement/client.js";
import { AzamPayDisburseError } from "../azampay/disbursement/errors.js";
import type { AzamPayDisburseBankName } from "../azampay/disbursement/types.js";
import { PayoutStateError, submitToAzamPay, truncateReason } from "./ledger.js";
import { twoPersonReleaseRequired } from "./releaseChallenge.js";

export class BatchStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BatchStateError";
  }
}

/** Raised when the same person is trying to perform two steps that must be performed by different people. */
export class SeparationOfDutiesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeparationOfDutiesError";
  }
}

const REFERENCE_RANDOM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function randomSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += REFERENCE_RANDOM_CHARS[bytes[i] % REFERENCE_RANDOM_CHARS.length];
  return out;
}
function generateBatchReference(): string {
  const datePart = new Date().toISOString().replace(/[-T:]/g, "").slice(2, 12);
  return `BATCH-${datePart}-${randomSuffix(5)}`;
}

// ---------------------------------------------------------------------------
// Operator-configurable limits
// ---------------------------------------------------------------------------

/**
 * Ceiling on the total value a single batch may carry, in the batch currency's
 * major unit. AZAMPAY_DISBURSE_MAX_AMOUNT caps one payout; this caps what one
 * authorization click can release. Unset/invalid/<=0 disables the cap, but
 * production should always set it: without it, formBatch sweeps every approved
 * payout in the system into one batch and a single click sends the lot.
 */
function batchTotalCeiling(): number | null {
  const raw = Number(process.env.AZAMPAY_DISBURSE_MAX_BATCH_TOTAL);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** Hard cap on members per batch. Keeps one authorization reviewable by a human and one worker pass bounded. Defaults to 250, clamped to [1, 1000]. */
function batchItemCap(): number {
  const raw = Number(process.env.AZAMPAY_DISBURSE_MAX_BATCH_ITEMS);
  if (!Number.isFinite(raw) || raw < 1) return 250;
  return Math.min(Math.floor(raw), 1000);
}

// ---------------------------------------------------------------------------
// Mutual exclusion
// ---------------------------------------------------------------------------

/**
 * Two admins clicking "form batch" at the same moment used to both read the
 * same APPROVED set, both create a batch, and the second updateMany would
 * silently reassign the first batch's members — leaving batch one holding a
 * fingerprint over rows it no longer owned, so authorizing it froze innocent
 * payouts to SECURITY_REVIEW.
 *
 * The fix is not a lock, it is a conditional claim: formBatch's updateMany
 * re-asserts `status: APPROVED, batchId: null` and rolls the whole
 * transaction back unless it claims exactly the rows it fingerprinted. The
 * database decides the winner atomically, so the loser creates no batch at
 * all and simply reports the race.
 *
 * A MySQL GET_LOCK was considered and rejected: it is connection-scoped, and
 * Prisma's pool gives no guarantee that the release runs on the connection
 * that acquired it. A cross-connection RELEASE_LOCK fails silently, which
 * would wedge the lock until that pooled connection was recycled.
 *
 * The in-process guard below only avoids duplicate AzamPay work (and, for
 * processing, overlapping submissions within this process). It is deliberately
 * not load-bearing for correctness: batch processing runs on the single worker
 * leader (workers/leaderLock.ts), and every submission is additionally gated
 * on the item still being AUTHORIZED.
 */
const inFlight = new Set<string>();

async function withLocalGuard<T>(key: string, busyMessage: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight.has(key)) throw new BatchStateError(busyMessage);
  inFlight.add(key);
  try {
    return await fn();
  } finally {
    inFlight.delete(key);
  }
}

async function writeAudit(
  tx: Prisma.TransactionClient,
  params: { actorId: number | null; action: string; entity: "DISBURSEMENT" | "DISBURSEMENT_BATCH"; entityId: number; beforeJson?: unknown; afterJson?: unknown }
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        actorRole: "ADMIN",
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        beforeJson: (params.beforeJson ?? null) as Prisma.InputJsonValue,
        afterJson: (params.afterJson ?? null) as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Audit logging must never fail the underlying action.
  }
}

/**
 * Marks a disbursement as excluded from batching and routes it to
 * SECURITY_REVIEW, outside any transaction so one bad item never blocks the
 * rest of formation. Writes both the row state and an append-only event, so
 * "why was this held" survives a later clear.
 */
async function flagSecurityReview(
  disbursementId: number,
  reason: string,
  actorId: number | null,
  riskLevel?: string,
  riskFlags?: string[]
): Promise<void> {
  const message = truncateReason(reason);
  await prisma.$transaction(async (tx) => {
    await tx.disbursement.update({
      where: { id: disbursementId },
      data: {
        status: "SECURITY_REVIEW",
        securityReviewReason: message,
        ...(riskLevel ? { riskLevel } : {}),
        ...(riskFlags ? { riskFlags: riskFlags as unknown as Prisma.InputJsonValue } : {}),
      },
    });
    await tx.disbursementEvent.create({
      data: {
        disbursementId,
        eventType: "SECURITY_REVIEW",
        eventHash: `sr-${disbursementId}-${Date.now()}-${randomSuffix(8)}`,
        status: "SECURITY_REVIEW",
        message,
      },
    });
    await writeAudit(tx, {
      actorId,
      action: "DISBURSEMENT_SECURITY_REVIEW_FLAGGED",
      entity: "DISBURSEMENT",
      entityId: disbursementId,
      afterJson: { reason: message, riskLevel: riskLevel ?? null, riskFlags: riskFlags ?? null },
    });
  });
}

/**
 * Re-runs AzamPay Name Lookup for one payout account and reports whether it
 * still resolves to the account name already on file (the name the approval
 * fingerprint was locked against). Never throws — a lookup failure is
 * reported, not raised, so the caller can flag-and-continue.
 *
 * Fails closed on a missing name: a lookup that returns success with no name
 * proves nothing about the destination, and used to be accepted silently.
 * Records the check against lastVerifiedAt, never verifiedAt, which is the
 * provenance anchor riskScoring reads.
 */
async function reverifyAccount(account: PayoutAccount): Promise<{ ok: boolean; reason?: string }> {
  try {
    const lookup = await azamPayNameLookup({ bankName: account.provider as AzamPayDisburseBankName, accountNumber: account.accountNumber });
    if (!lookup.status) return { ok: false, reason: "AzamPay Name Lookup declined this account on re-verification" };
    const returnedName = String(lookup.name ?? "").trim();
    if (!returnedName) {
      return { ok: false, reason: "AzamPay Name Lookup returned no account name on re-verification — cannot confirm the destination" };
    }
    if (returnedName.toLowerCase() !== account.accountName.trim().toLowerCase()) {
      return { ok: false, reason: `Re-verification returned a different account name ("${returnedName}" vs locked "${account.accountName}")` };
    }
    await prisma.payoutAccount.update({ where: { id: account.id }, data: { isVerified: true, lastVerifiedAt: new Date() } });
    return { ok: true };
  } catch (err) {
    const message = err instanceof AzamPayDisburseError ? (err.providerMessage ?? err.message) : err instanceof Error ? err.message : "unknown error";
    return { ok: false, reason: `Re-verification call failed: ${message}` };
  }
}

export interface FormedBatchSummary {
  id: number;
  batchReference: string;
  itemCount: number;
  totalAmount: string;
  currency: string;
}

export interface FormBatchResult {
  /** One batch per currency. Empty when nothing passed the checks. */
  batches: FormedBatchSummary[];
  included: number[];
  excluded: Array<{ disbursementId: number; reason: string }>;
  /** Approved items left unbatched because a cap was reached. They stay APPROVED and are picked up by the next formation. */
  deferred: number[];
}

/**
 * Pulls every APPROVED, unbatched disbursement, bulk re-verifies + risk
 * scores each, and groups the ones that pass into one DRAFT batch PER
 * CURRENCY.
 *
 * Currencies are never mixed. A mixed batch's totalAmount is a sum across
 * different currencies presented to the authorizer as a single figure, which
 * is exactly the number a human is being asked to sign off on.
 */
export async function formBatch(actorId: number): Promise<FormBatchResult> {
  return withLocalGuard(
    "form-batch",
    "A batch is already being formed. Wait for it to finish and try again.",
    () => formBatchLocked(actorId)
  );
}

async function formBatchLocked(actorId: number): Promise<FormBatchResult> {
  const itemCap = batchItemCap();
  const totalCeiling = batchTotalCeiling();

  const candidates = await prisma.disbursement.findMany({
    where: { status: "APPROVED", batchId: null },
    include: { payoutAccount: true },
    orderBy: { approvedAt: "asc" },
  });

  const included: Array<Disbursement & { payoutAccount: PayoutAccount }> = [];
  const excluded: Array<{ disbursementId: number; reason: string }> = [];
  const deferred: number[] = [];

  for (const item of candidates) {
    // 1. Bulk re-verification — closes the approve-to-batch staleness window.
    const reverify = await reverifyAccount(item.payoutAccount);
    if (!reverify.ok) {
      const reason = reverify.reason ?? "Account re-verification failed";
      await flagSecurityReview(item.id, reason, actorId);
      excluded.push({ disbursementId: item.id, reason: truncateReason(reason) });
      continue;
    }

    // 2. Approval fingerprint re-check. A missing fingerprint fails CLOSED:
    //    "not locked" must never be read as "nothing changed".
    if (!item.approvalFingerprint) {
      const reason = "No approval fingerprint on file — approved before approval locking existed, must be re-approved";
      await flagSecurityReview(item.id, reason, actorId);
      excluded.push({ disbursementId: item.id, reason });
      continue;
    }
    const currentFingerprint = computeApprovalFingerprint(item, item.payoutAccount);
    if (item.approvalFingerprint !== currentFingerprint) {
      const reason = "Approval fingerprint mismatch — a financial field or the destination account changed after approval";
      await flagSecurityReview(item.id, reason, actorId);
      excluded.push({ disbursementId: item.id, reason });
      continue;
    }

    // 3. Risk scoring — HIGH/CRITICAL never enters a batch automatically.
    const risk = await assessDisbursementRisk(item, item.payoutAccount);
    if (risk.level === "HIGH" || risk.level === "CRITICAL") {
      const reason = `Risk score ${risk.level}: ${risk.flags.join(", ") || "no specific flag"}`;
      await flagSecurityReview(item.id, reason, actorId, risk.level, risk.flags);
      excluded.push({ disbursementId: item.id, reason });
      continue;
    }

    // Persist risk visibility even for items that do proceed (LOW/MEDIUM),
    // so the batch authorizer can see MEDIUM items before releasing money.
    await prisma.disbursement.update({
      where: { id: item.id },
      data: { riskLevel: risk.level, riskFlags: risk.flags as unknown as Prisma.InputJsonValue },
    });
    included.push(item);
  }

  // Group by currency, then apply the caps within each group.
  const byCurrency = new Map<string, Array<Disbursement & { payoutAccount: PayoutAccount }>>();
  for (const item of included) {
    const bucket = byCurrency.get(item.currency);
    if (bucket) bucket.push(item);
    else byCurrency.set(item.currency, [item]);
  }

  const batches: FormedBatchSummary[] = [];
  const batchedIds: number[] = [];

  for (const [currency, group] of byCurrency) {
    const members: Array<Disbursement & { payoutAccount: PayoutAccount }> = [];
    let runningTotal = new Prisma.Decimal(0);

    for (const item of group) {
      if (members.length >= itemCap) {
        deferred.push(item.id);
        continue;
      }
      const next = runningTotal.plus(item.amount);
      if (totalCeiling !== null && next.greaterThan(totalCeiling)) {
        // Leave it APPROVED and unbatched; the next formation picks it up
        // once this batch has been released.
        deferred.push(item.id);
        continue;
      }
      members.push(item);
      runningTotal = next;
    }

    if (members.length === 0) continue;

    const batchFingerprint = computeBatchFingerprint(
      members.map((i) => toBatchFingerprintMember(i, i.payoutAccount))
    );

    const created = await prisma.$transaction(async (tx) => {
      const batch = await tx.disbursementBatch.create({
        data: {
          batchReference: generateBatchReference(),
          status: "DRAFT",
          totalAmount: runningTotal,
          currency,
          itemCount: members.length,
          batchFingerprint,
          formedById: actorId,
        },
      });

      // Re-assert the state we selected on. Under the advisory lock nothing
      // else should have moved these, but the guard turns a surprise into a
      // refusal rather than into a batch whose fingerprint covers rows that
      // have since changed hands.
      const claimed = await tx.disbursement.updateMany({
        where: { id: { in: members.map((i) => i.id) }, status: "APPROVED", batchId: null },
        data: { status: "BATCHED", batchId: batch.id },
      });
      if (claimed.count !== members.length) {
        throw new BatchStateError(
          `Batch formation raced: expected to claim ${members.length} approved payouts, claimed ${claimed.count}. No batch was created.`
        );
      }

      await writeAudit(tx, {
        actorId,
        action: "DISBURSEMENT_BATCH_FORMED",
        entity: "DISBURSEMENT_BATCH",
        entityId: batch.id,
        afterJson: {
          itemCount: members.length,
          totalAmount: batch.totalAmount.toString(),
          currency,
          excludedCount: excluded.length,
          deferredCount: deferred.length,
        },
      });
      return batch;
    });

    batches.push({
      id: created.id,
      batchReference: created.batchReference,
      itemCount: created.itemCount,
      totalAmount: created.totalAmount.toString(),
      currency: created.currency,
    });
    batchedIds.push(...members.map((i) => i.id));
  }

  return { batches, included: batchedIds, excluded, deferred };
}

/** Whether the caller is releasing a batch they themselves formed or approved into. */
export function describeSelfRelease(
  batch: { id: number; formedById: number | null; items: Array<{ id: number; approvedById: number | null }> },
  actorId: number
): { isSelfRelease: boolean; formedByActor: boolean; approvedByActor: number[] } {
  const approvedByActor = batch.items.filter((item) => item.approvedById === actorId).map((item) => item.id);
  const formedByActor = batch.formedById === actorId;
  return { isSelfRelease: formedByActor || approvedByActor.length > 0, formedByActor, approvedByActor };
}

export interface AuthorizeBatchOptions {
  /**
   * Proof that a batch-bound, single-use release code was answered for THIS
   * batch. Required for a self-release; ignored otherwise. The route consumes
   * the challenge and passes the result, so this service never has to know
   * how the challenge was delivered.
   */
  releaseChallengePassed?: boolean;
}

/**
 * The deliberate human release step. Recomputes the batch fingerprint from
 * the batch's current member state, against the live payout accounts, before
 * authorizing — any drift since formation freezes the batch to
 * SECURITY_REVIEW instead.
 *
 * Release authority, in order of strength:
 *
 *  1. TWO-PERSON (strongest). A different admin from the one who formed the
 *     batch and approved its members. Always allowed, needs no extra step.
 *  2. SELF-RELEASE WITH A BATCH-BOUND CHALLENGE. NoLSAF runs with a single
 *     finance admin today, so requiring (1) would make release impossible
 *     rather than safe. That admin may release their own batch by answering a
 *     fresh, single-use code tied to this batch's id and fingerprint and
 *     delivered out of band with the amount and item count in the message
 *     (services/payouts/releaseChallenge.ts). This is deliberately NOT the
 *     ambient finance grant, which is a session-wide 15-minute flag covering
 *     every money action in that window and proving nothing about any one of
 *     them.
 *  3. Setting DISBURSEMENT_REQUIRE_TWO_PERSON=true retires (2) entirely, once
 *     a second finance admin exists.
 *
 * A self-release without a passed challenge is refused, so the compensating
 * control cannot be skipped by calling the service directly.
 */
export async function authorizeBatch(
  batchId: number,
  authorizedById: number,
  options: AuthorizeBatchOptions = {}
) {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.disbursementBatch.findUnique({
      where: { id: batchId },
      include: { items: { include: { payoutAccount: true } } },
    });
    if (!batch) throw new BatchStateError(`Batch ${batchId} not found`);
    if (batch.status !== "DRAFT") throw new BatchStateError(`Batch ${batchId} is ${batch.status}, expected DRAFT`);

    const self = describeSelfRelease(batch, authorizedById);
    if (self.isSelfRelease) {
      const reason = self.formedByActor
        ? `Batch ${batchId} was formed by you`
        : `You approved ${self.approvedByActor.length} payout(s) in batch ${batchId} ` +
          `(#${self.approvedByActor.slice(0, 5).join(", ")}${self.approvedByActor.length > 5 ? ", …" : ""})`;

      if (twoPersonReleaseRequired()) {
        throw new SeparationOfDutiesError(
          `${reason}. Authorization must be performed by a different admin.`
        );
      }
      if (!options.releaseChallengePassed) {
        throw new SeparationOfDutiesError(
          `${reason}. Releasing your own batch requires a release code sent to your registered email or phone. ` +
            `Request one for this batch, then authorize again with the code.`
        );
      }
    }

    const currentFingerprint = computeBatchFingerprint(
      batch.items.map((i) => toBatchFingerprintMember(i, i.payoutAccount))
    );

    if (currentFingerprint !== batch.batchFingerprint) {
      await tx.disbursementBatch.update({ where: { id: batchId }, data: { status: "SECURITY_REVIEW" } });
      await tx.disbursement.updateMany({
        where: { batchId },
        data: { status: "SECURITY_REVIEW", securityReviewReason: "Batch fingerprint mismatch at authorization time" },
      });
      await writeAudit(tx, { actorId: authorizedById, action: "DISBURSEMENT_BATCH_FINGERPRINT_MISMATCH", entity: "DISBURSEMENT_BATCH", entityId: batchId });
      throw new BatchStateError(`Batch ${batchId} fingerprint mismatch — batch and its items were moved to SECURITY_REVIEW`);
    }

    const updated = await tx.disbursementBatch.update({
      where: { id: batchId },
      data: { status: "AUTHORIZED", authorizedById, authorizedAt: new Date() },
    });
    await tx.disbursement.updateMany({ where: { batchId, status: "BATCHED" }, data: { status: "AUTHORIZED" } });
    await writeAudit(tx, {
      actorId: authorizedById,
      action: "DISBURSEMENT_BATCH_AUTHORIZED",
      entity: "DISBURSEMENT_BATCH",
      entityId: batchId,
      afterJson: {
        itemCount: batch.itemCount,
        totalAmount: batch.totalAmount.toString(),
        currency: batch.currency,
        formedById: batch.formedById,
        // How this release was authorised is the single most important thing
        // to be able to reconstruct later, so it is recorded explicitly
        // rather than inferred from comparing ids after the fact.
        releaseAuthority: self.isSelfRelease ? "SELF_RELEASE_WITH_CHALLENGE" : "TWO_PERSON",
      },
    });
    return updated;
  });
}

export interface ProcessBatchResult {
  batchId: number;
  submitted: number[];
  failed: Array<{ disbursementId: number; error: string }>;
  /** True when every member has reached a terminal state and the batch was closed. */
  completed: boolean;
}

/**
 * How many /disburse calls processBatch fires at once. Defaults to 1
 * (today's exact sequential behavior — nothing changes until this is
 * deliberately raised). Do not raise this above 1 until AzamPay has
 * confirmed an actual concurrency/rate limit in writing — see "Questions
 * NoLSAF must send AzamPay before production" in the dev guide. Clamped to
 * [1, 50] so a misconfigured value can't fire an unbounded burst.
 */
function resolveDisburseConcurrency(): number {
  const raw = Number(process.env.AZAMPAY_DISBURSE_CONCURRENCY);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(Math.floor(raw), 50);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Worker step: submits every AUTHORIZED member of a batch to AzamPay via the
 * per-item submitToAzamPay(). Accepts a batch in AUTHORIZED (first pass) or
 * PROCESSING (resuming an interrupted pass) — resumability is the whole
 * reason this is a worker and not part of the authorize request.
 *
 * Processes in chunks of AZAMPAY_DISBURSE_CONCURRENCY (default 1, i.e. one at
 * a time). One item's failure never blocks the rest: each is caught,
 * persisted as a DisbursementEvent, and left AUTHORIZED so the next worker
 * pass retries it. Retrying is safe because externalReferenceId is allocated
 * before the first call and never changes, so a duplicate submission is
 * rejected provider-side rather than paid twice.
 */
export async function processBatch(batchId: number): Promise<ProcessBatchResult> {
  return withLocalGuard(
    `process-batch:${batchId}`,
    `Batch ${batchId} is already being processed.`,
    () => processBatchLocked(batchId)
  );
}

async function processBatchLocked(batchId: number): Promise<ProcessBatchResult> {
  const batch = await prisma.disbursementBatch.findUnique({ where: { id: batchId }, include: { items: true } });
  if (!batch) throw new BatchStateError(`Batch ${batchId} not found`);
  if (batch.status !== "AUTHORIZED" && batch.status !== "PROCESSING") {
    throw new BatchStateError(`Batch ${batchId} is ${batch.status}, expected AUTHORIZED or PROCESSING`);
  }

  if (batch.status === "AUTHORIZED") {
    await prisma.disbursementBatch.update({
      where: { id: batchId },
      data: { status: "PROCESSING", processingStartedAt: new Date() },
    });
  }

  const submitted: number[] = [];
  const failed: Array<{ disbursementId: number; error: string }> = [];
  const concurrency = resolveDisburseConcurrency();
  const authorizedItems = batch.items.filter((i) => i.status === "AUTHORIZED");

  for (const group of chunk<Disbursement>(authorizedItems, concurrency)) {
    const results = await Promise.allSettled(group.map((item) => submitToAzamPay(item.id)));
    for (const [index, result] of results.entries()) {
      const item = group[index];
      if (result.status === "fulfilled") {
        submitted.push(item.id);
        continue;
      }
      const err = result.reason;
      const message =
        err instanceof AzamPayDisburseError
          ? (err.providerMessage ?? err.message)
          : err instanceof PayoutStateError
            ? err.message
            : err instanceof Error
              ? err.message
              : "unknown error";
      failed.push({ disbursementId: item.id, error: message });
      // Persist the failure. It used to live only in the HTTP response, so an
      // item that never reached AzamPay left no trace anywhere and no worker
      // could find it again.
      await recordSubmitFailure(item.id, message);
    }
  }

  const completed = await finalizeBatchIfSettled(batchId);
  return { batchId, submitted, failed, completed };
}

/** Append-only record of a submission attempt that never reached AzamPay. The item stays AUTHORIZED so the next worker pass retries it. */
async function recordSubmitFailure(disbursementId: number, message: string): Promise<void> {
  try {
    await prisma.disbursementEvent.create({
      data: {
        disbursementId,
        eventType: "SUBMIT_RESPONSE",
        eventHash: `sf-${disbursementId}-${Date.now()}-${randomSuffix(8)}`,
        status: "ERROR",
        message: truncateReason(message).slice(0, 300),
      },
    });
  } catch (err) {
    console.error(`[disbursement-batch] could not record submit failure for disbursement ${disbursementId}`, err);
  }
}

const TERMINAL_ITEM_STATUSES = ["PAID", "FAILED", "SECURITY_REVIEW", "RECOVERED"] as const;

/**
 * Closes a batch once every member has reached a terminal state. Without this
 * a batch sat in PROCESSING forever, so nothing could distinguish "still
 * going" from "half of it failed three days ago".
 */
export async function finalizeBatchIfSettled(batchId: number): Promise<boolean> {
  const outstanding = await prisma.disbursement.count({
    where: { batchId, status: { notIn: [...TERMINAL_ITEM_STATUSES] } },
  });
  if (outstanding > 0) return false;

  const result = await prisma.disbursementBatch.updateMany({
    where: { id: batchId, status: "PROCESSING" },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Batches the worker should pick up: anything AUTHORIZED (never started) plus
 * anything left PROCESSING (a previous pass died, items failed and are due a
 * retry, or every item is submitted and the batch is waiting to be closed).
 *
 * AUTHORIZED is queried first and separately. A single ordered query would let
 * a handful of PROCESSING batches sitting on unanswered callbacks fill the
 * per-pass limit and starve a batch a human just released.
 */
export async function findBatchesNeedingProcessing(limit = 5): Promise<number[]> {
  const authorized = await prisma.disbursementBatch.findMany({
    where: { status: "AUTHORIZED" },
    select: { id: true },
    orderBy: { authorizedAt: "asc" },
    take: limit,
  });
  if (authorized.length >= limit) return authorized.map((b) => b.id);

  const processing = await prisma.disbursementBatch.findMany({
    where: { status: "PROCESSING" },
    select: { id: true },
    orderBy: { processingStartedAt: "asc" },
    take: limit - authorized.length,
  });
  return [...authorized, ...processing].map((b) => b.id);
}

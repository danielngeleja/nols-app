/**
 * Payout Ledger — the shared Disbursement state machine
 *
 * REQUESTED -> APPROVED -> SUBMITTED -> PROCESSING -> PAID / FAILED
 * (see "Reference IDs and lifecycle" and "Response handling: accepted is
 * not paid" in docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md).
 *
 * Rules enforced here, not left to callers:
 *  - A Disbursement can only be created from a source that eligibility.ts
 *    confirms is approved-but-unpaid in its own flow, and only against a
 *    PayoutAccount that belongs to that source's payee and is verified.
 *  - submitToAzamPay() never marks a payout PAID. A 200/success response
 *    only means AzamPay accepted it for processing.
 *  - applyProviderEvent() is the only path to PAID/FAILED, is idempotent
 *    on eventHash, and runs inside a transaction so the event log and the
 *    status transition can never desync.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import type { Disbursement, Prisma } from "@prisma/client";
import { loadEligiblePayoutSource, type PayoutSourceType } from "./eligibility.js";
import { computeApprovalFingerprint } from "./fingerprint.js";
import { azamPayDisburse } from "../azampay/disbursement/client.js";
import { loadAzamPayDisbursementRequestConfig } from "../azampay/disbursement/config.js";
import { AzamPayDisburseError } from "../azampay/disbursement/errors.js";
import type { AzamPayDisburseCallback } from "../azampay/disbursement/types.js";
import { notifyUser } from "../../lib/notifications.js";
import { sendMail } from "../../lib/mailer.js";
import { getOwnerDisbursementEmail } from "../../lib/bookingEmailTemplates.js";
import { generateOwnerDisbursementPdf } from "../../lib/pdfDocuments.js";

export class PayoutStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayoutStateError";
  }
}

/**
 * Optional hard ceiling on a single disbursement, in the payout currency's
 * major unit (e.g. TZS). Set AZAMPAY_DISBURSE_MAX_AMOUNT to a positive number
 * to cap every submission; unset/invalid/<=0 disables the cap. Enforced at the
 * money-out boundary (submitToAzamPay) so no single request can send more than
 * the operator has authorized, regardless of what the source record claims.
 */
function assertWithinAmountCeiling(amount: Prisma.Decimal): void {
  const raw = Number(process.env.AZAMPAY_DISBURSE_MAX_AMOUNT);
  if (!Number.isFinite(raw) || raw <= 0) return;
  if (Number(amount) > raw) {
    throw new PayoutStateError(
      `Disbursement amount ${amount.toString()} exceeds the configured ceiling AZAMPAY_DISBURSE_MAX_AMOUNT=${raw}. ` +
        `Raise the limit deliberately or split the payout.`
    );
  }
}

const SOURCE_REF_CODE: Record<PayoutSourceType, string> = {
  OWNER_INVOICE: "O",
  TOUR_BOOKING: "T",
  DRIVER_TRIP: "D",
  SALES_PAYOUT: "S",
};

// Alphanumeric only (no ambiguous chars excluded — collisions are guarded by
// the DB unique constraint and the retry in requestDisbursement, not by the
// character set), matching the shape AzamPay's own examples use.
const REFERENCE_RANDOM_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function randomReferenceSuffix(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += REFERENCE_RANDOM_CHARS[bytes[i] % REFERENCE_RANDOM_CHARS.length];
  }
  return out;
}

/**
 * e.g. "NoLSAF-T-2608081645-D51QVX" — 26 chars, under AzamPay's 30-char
 * externalReferenceId limit. Minute-precision timestamp (YYMMDDHHmm) plus 6
 * random alphanumeric chars keeps collisions astronomically unlikely even
 * within the same minute; the DB unique constraint plus the retry in
 * requestDisbursement is the real guarantee, not the randomness.
 */
function generateExternalReferenceId(sourceType: PayoutSourceType): string {
  const datePart = new Date().toISOString().replace(/[-T:]/g, "").slice(2, 12);
  const randomPart = randomReferenceSuffix(6);
  return `NoLSAF-${SOURCE_REF_CODE[sourceType]}-${datePart}-${randomPart}`;
}

/** securityReviewReason is VarChar(300) and some of what lands in it is provider-supplied text. Truncate rather than let an overlong provider message throw mid-flag. */
export const SECURITY_REVIEW_REASON_MAX = 300;
export function truncateReason(reason: string): string {
  const clean = reason.replace(/\s+/g, " ").trim();
  return clean.length <= SECURITY_REVIEW_REASON_MAX ? clean : `${clean.slice(0, SECURITY_REVIEW_REASON_MAX - 1)}…`;
}

/**
 * Stable receipt number for an owner invoice settled through the shared
 * disbursement ledger. The invoice id is the uniqueness anchor; the payment
 * month keeps the format aligned with the existing admin revenue receipts.
 */
export function ownerDisbursementReceiptNumber(invoiceId: number, paidAt: Date): string {
  const ym = `${paidAt.getFullYear()}${String(paidAt.getMonth() + 1).padStart(2, "0")}`;
  return `RCPT-${ym}-${String(invoiceId).padStart(7, "0")}`;
}

/**
 * Moves a payout out of the money pipeline and into the security queue, and
 * records why in the append-only event log as well as on the row. Used by
 * every integrity check that can fire after approval. Deliberately does not
 * clear activeSourceKey: the payout is still live (just held), and the source
 * must stay blocked from spawning a second one.
 */
export async function divertToSecurityReview(disbursementId: number, reason: string): Promise<void> {
  const message = truncateReason(reason);
  await prisma.$transaction(async (tx) => {
    await tx.disbursement.update({
      where: { id: disbursementId },
      data: { status: "SECURITY_REVIEW", securityReviewReason: message },
    });
    await tx.disbursementEvent.create({
      data: {
        disbursementId,
        eventType: "SECURITY_REVIEW",
        eventHash: eventHashFor(disbursementId, "SECURITY_REVIEW", { reason: message, at: new Date().toISOString() }),
        status: "SECURITY_REVIEW",
        message,
      },
    });
  });
}

/**
 * Records a provider-reported amount that does not match what NoLSAF is owed,
 * from a callback or a status poll. Persisted rather than logged: a mismatch
 * used to exist only as a line in stdout, so nothing in the product could tell
 * an operator that a payout had reported the wrong figure.
 *
 * The status is deliberately left alone. The payout stays PROCESSING so the
 * reconciliation worker keeps chasing the real outcome; what changes is that
 * the discrepancy is now on the record and surfaced on the detail view.
 */
export async function recordAmountMismatch(
  disbursementId: number,
  details: { expected: string; received: string; source: "CALLBACK" | "STATUS_POLL"; payload?: unknown }
): Promise<void> {
  const message = truncateReason(
    `Provider reported ${details.received} for a payout of ${details.expected} (${details.source.toLowerCase()})`
  );
  try {
    await prisma.disbursementEvent.create({
      data: {
        disbursementId,
        eventType: "AMOUNT_MISMATCH",
        eventHash: eventHashFor(disbursementId, "AMOUNT_MISMATCH", {
          expected: details.expected,
          received: details.received,
          source: details.source,
        }),
        status: "AMOUNT_MISMATCH",
        message,
        payload: (details.payload ?? null) as Prisma.InputJsonValue,
      },
    });
  } catch (err: any) {
    // P2002 means this exact mismatch is already recorded — nothing to add.
    if (err?.code !== "P2002") {
      console.error(`[payout-ledger] could not record amount mismatch for disbursement ${disbursementId}`, err);
    }
  }
  try {
    await prisma.disbursement.update({
      where: { id: disbursementId },
      data: { securityReviewReason: message },
    });
  } catch (err) {
    console.error(`[payout-ledger] could not flag amount mismatch on disbursement ${disbursementId}`, err);
  }
}

/** Persists a callback identifier/provider mismatch without settling or stopping reconciliation. */
export async function recordProviderCorrelationMismatch(
  disbursementId: number,
  details: {
    code: "initiator_reference_mismatch" | "pg_reference_mismatch" | "operator_mismatch";
    expected: string;
    received: string;
    payload?: unknown;
  }
): Promise<void> {
  const message = truncateReason(
    `Provider callback ${details.code.replace(/_/g, " ")}: expected ${details.expected}, received ${details.received}`
  );
  try {
    await prisma.disbursementEvent.create({
      data: {
        disbursementId,
        eventType: "PROVIDER_CORRELATION_MISMATCH",
        eventHash: eventHashFor(disbursementId, "PROVIDER_CORRELATION_MISMATCH", {
          code: details.code,
          expected: details.expected,
          received: details.received,
        }),
        status: "CORRELATION_MISMATCH",
        message,
        payload: (details.payload ?? null) as Prisma.InputJsonValue,
      },
    });
  } catch (err: any) {
    if (err?.code !== "P2002") {
      console.error(
        `[payout-ledger] could not record provider correlation mismatch for disbursement ${disbursementId}`,
        err
      );
    }
  }
  try {
    await prisma.disbursement.update({
      where: { id: disbursementId },
      data: { securityReviewReason: message },
    });
  } catch (err) {
    console.error(
      `[payout-ledger] could not flag provider correlation mismatch on disbursement ${disbursementId}`,
      err
    );
  }
}

/**
 * The value held in Disbursement.activeSourceKey while a payout is live. The
 * column is uniquely indexed, so this is what makes "one live payout per
 * source" a database guarantee: FAILED releases the key (set to NULL) so a
 * fresh attempt is allowed, every other state holds it.
 */
export function activeSourceKeyFor(sourceType: PayoutSourceType, sourceId: number): string {
  return `${sourceType}:${sourceId}`;
}

/** Best-effort audit trail, mirroring the pattern already used for driver/sales payouts. Never blocks the payout action itself. */
async function writeAudit(
  tx: Prisma.TransactionClient,
  params: { actorId: number | null; action: string; disbursementId: number; beforeJson?: unknown; afterJson?: unknown }
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        actorId: params.actorId,
        actorRole: "ADMIN",
        action: params.action,
        entity: "DISBURSEMENT",
        entityId: params.disbursementId,
        beforeJson: (params.beforeJson ?? null) as Prisma.InputJsonValue,
        afterJson: (params.afterJson ?? null) as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Audit logging must never fail the underlying payout action.
  }
}

function eventHashFor(disbursementId: number, eventType: string, payload: Record<string, unknown>): string {
  // Deterministic on content, not wall-clock time, so a replayed callback with
  // identical content always hashes to the same key and is a no-op on retry.
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return createHash("sha256").update(`${disbursementId}:${eventType}:${stable}`).digest("hex").slice(0, 64);
}

/**
 * Creates a REQUESTED disbursement from an already-approved source. Retries
 * once on a reference-id collision (astronomically unlikely, but the unique
 * constraint is the real guarantee, not the randomness).
 */
export async function requestDisbursement(params: {
  sourceType: PayoutSourceType;
  sourceId: number;
  payoutAccountId: number;
  requestedById: number;
  remarks?: string;
}): Promise<Disbursement> {
  const source = await loadEligiblePayoutSource(params.sourceType, params.sourceId);

  const payoutAccount = await prisma.payoutAccount.findUnique({ where: { id: params.payoutAccountId } });
  if (!payoutAccount) throw new PayoutStateError(`PayoutAccount ${params.payoutAccountId} not found`);
  if (payoutAccount.userId !== source.payeeUserId) {
    throw new PayoutStateError(
      `PayoutAccount ${params.payoutAccountId} belongs to user ${payoutAccount.userId}, not payee ${source.payeeUserId}`
    );
  }
  if (!payoutAccount.isVerified) {
    throw new PayoutStateError(`PayoutAccount ${params.payoutAccountId} is not verified (Name Lookup required first)`);
  }
  if (!payoutAccount.isActive) {
    throw new PayoutStateError(`PayoutAccount ${params.payoutAccountId} is not active`);
  }

  // Fast, friendly pre-check. It is NOT the guarantee — two concurrent
  // requests for the same source can both pass it. The guarantee is the
  // unique constraint on activeSourceKey below, whose violation is caught and
  // reported as the same conflict.
  const existing = await prisma.disbursement.findFirst({
    where: { sourceType: params.sourceType, sourceId: params.sourceId, status: { notIn: ["FAILED"] } },
  });
  if (existing) {
    throw new PayoutStateError(
      `Source ${params.sourceType}:${params.sourceId} already has a non-failed disbursement (id ${existing.id}, status ${existing.status})`
    );
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const created = await tx.disbursement.create({
          data: {
            externalReferenceId: generateExternalReferenceId(params.sourceType),
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            activeSourceKey: activeSourceKeyFor(params.sourceType, params.sourceId),
            payoutAccountId: params.payoutAccountId,
            amount: source.amount,
            currency: source.currency,
            status: "REQUESTED",
            bankName: payoutAccount.provider,
            remarks: params.remarks,
          },
        });
        await writeAudit(tx, {
          actorId: params.requestedById,
          action: "DISBURSEMENT_REQUESTED",
          disbursementId: created.id,
          afterJson: { sourceType: created.sourceType, sourceId: created.sourceId, amount: created.amount.toString() },
        });
        return created;
      });
    } catch (err: any) {
      const target = String(err?.meta?.target ?? "");
      if (err?.code === "P2002" && target.includes("activeSourceKey")) {
        // Lost the race against a concurrent request for the same source.
        // Surfaced as the same conflict the pre-check reports, so the caller
        // and the operator see one consistent message either way.
        throw new PayoutStateError(
          `Source ${params.sourceType}:${params.sourceId} already has a non-failed disbursement ` +
            `(a concurrent request created it first)`
        );
      }
      const isRefCollision = err?.code === "P2002" && target.includes("externalReferenceId");
      if (isRefCollision && attempt === 0) continue;
      throw err;
    }
  }
  throw new PayoutStateError("Could not allocate a unique externalReferenceId after retry");
}

/**
 * REQUESTED -> APPROVED. Separate step from creation so approval is a
 * deliberate, auditable action. Also freezes the approval fingerprint —
 * a snapshot hash of every financial field (amount, currency, account) at
 * this exact moment. batching.ts recomputes and compares it right before
 * this payout enters a batch; a mismatch means something changed after
 * approval and routes the payout to SECURITY_REVIEW instead of paying it.
 */
export async function approveDisbursement(disbursementId: number, approvedById: number): Promise<Disbursement> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.disbursement.findUnique({ where: { id: disbursementId }, include: { payoutAccount: true } });
    if (!current) throw new PayoutStateError(`Disbursement ${disbursementId} not found`);
    if (current.status !== "REQUESTED") {
      throw new PayoutStateError(`Disbursement ${disbursementId} is ${current.status}, expected REQUESTED`);
    }
    const approvalFingerprint = computeApprovalFingerprint(current, current.payoutAccount);
    const updated = await tx.disbursement.update({
      where: { id: disbursementId },
      data: { status: "APPROVED", approvedById, approvedAt: new Date(), approvalFingerprint },
    });
    await writeAudit(tx, {
      actorId: approvedById,
      action: "DISBURSEMENT_APPROVED",
      disbursementId,
      beforeJson: { status: current.status },
      afterJson: { status: updated.status },
    });
    return updated;
  });
}

/**
 * AUTHORIZED -> PROCESSING. Calls AzamPay. A successful response is NOT a
 * paid state — only applyProviderEvent() can move this to PAID.
 *
 * AUTHORIZED is the ONLY accepted entry state. It used to also accept
 * APPROVED, which made the entire batch architecture optional: a single
 * admin could approve an item and immediately submit it, skipping bulk
 * re-verification, risk scoring, the batch fingerprint and the second
 * authorizer. There is now no path to AzamPay that does not go through a
 * batch someone other than the approver released.
 *
 * The approval fingerprint is re-checked here, immediately before the
 * money-out call, against the live payout account. Batch formation checks it
 * too, but that check is minutes-to-hours old by the time a batch is
 * released; this one closes the window entirely. A payout whose destination
 * changed after approval is diverted to SECURITY_REVIEW rather than paid.
 */
export async function submitToAzamPay(disbursementId: number): Promise<Disbursement> {
  const disbursement = await prisma.disbursement.findUnique({
    where: { id: disbursementId },
    include: { payoutAccount: true },
  });
  if (!disbursement) throw new PayoutStateError(`Disbursement ${disbursementId} not found`);
  if (disbursement.status !== "AUTHORIZED") {
    throw new PayoutStateError(`Disbursement ${disbursementId} is ${disbursement.status}, expected AUTHORIZED`);
  }

  // Fail closed on a missing fingerprint: "not locked" must never read as
  // "nothing changed". Only rows approved before the column existed can be
  // NULL, and those must be re-approved rather than silently paid.
  if (!disbursement.approvalFingerprint) {
    await divertToSecurityReview(
      disbursementId,
      "No approval fingerprint on file — payout was approved before approval locking existed and must be re-approved"
    );
    throw new PayoutStateError(
      `Disbursement ${disbursementId} has no approval fingerprint; diverted to SECURITY_REVIEW instead of being submitted`
    );
  }

  const liveFingerprint = computeApprovalFingerprint(disbursement, disbursement.payoutAccount);
  if (liveFingerprint !== disbursement.approvalFingerprint) {
    await divertToSecurityReview(
      disbursementId,
      "Approval fingerprint mismatch at submission time — a financial field or the destination account changed after approval"
    );
    throw new PayoutStateError(
      `Disbursement ${disbursementId} failed its approval fingerprint check at submission; diverted to SECURITY_REVIEW`
    );
  }

  assertWithinAmountCeiling(disbursement.amount);

  const amount = Number(disbursement.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new PayoutStateError(`Disbursement ${disbursementId} has an invalid amount`);
  }
  if (!String(disbursement.currency || "").trim()) {
    throw new PayoutStateError(`Disbursement ${disbursementId} has no currency`);
  }
  if (
    !String(disbursement.externalReferenceId || "").trim() ||
    disbursement.externalReferenceId.length > 30
  ) {
    throw new PayoutStateError(
      `Disbursement ${disbursementId} has an invalid externalReferenceId (required, maximum 30 characters)`
    );
  }
  if (
    !String(disbursement.payoutAccount.accountNumber || "").trim() ||
    !String(disbursement.payoutAccount.accountName || "").trim()
  ) {
    throw new PayoutStateError(
      `Disbursement ${disbursementId} has an incomplete destination account`
    );
  }
  const requestConfig = loadAzamPayDisbursementRequestConfig(
    disbursement.payoutAccount.provider
  );

  const sourceAccount = {
    countryCode: "TZ",
    fullName: requestConfig.sourceName,
    bankName: requestConfig.sourceProvider,
    accountNumber: requestConfig.sourceAccount,
    currency: disbursement.currency,
  };

  // Cross-process submission claim. Without this, two workers (or a worker
  // racing the admin retry route) can both read AUTHORIZED and both call the
  // money-out API before either stores the provider response.
  const submissionClaim = await prisma.disbursement.updateMany({
    where: { id: disbursementId, status: "AUTHORIZED", pgReferenceId: null },
    data: { status: "SUBMITTED", submittedAt: new Date(), securityReviewReason: null },
  });
  if (submissionClaim.count !== 1) {
    throw new PayoutStateError(
      `Disbursement ${disbursementId} changed state before submission; provider call was not made`
    );
  }

  let response: Awaited<ReturnType<typeof azamPayDisburse>>;
  try {
    response = await azamPayDisburse({
      source: sourceAccount,
      destination: {
        countryCode: "TZ",
        fullName: disbursement.payoutAccount.accountName,
        bankName: requestConfig.destinationProvider,
        accountNumber: disbursement.payoutAccount.accountNumber,
        currency: disbursement.currency,
      },
      transferDetails: {
        type: requestConfig.transferType,
        amount,
        dateInEpoch: Math.floor(Date.now() / 1000),
      },
      externalReferenceId: disbursement.externalReferenceId,
      additionalProperties: { sourceType: disbursement.sourceType, sourceId: disbursement.sourceId },
      remarks: disbursement.remarks ?? undefined,
    });
  } catch (err) {
    if (err instanceof AzamPayDisburseError) {
      await prisma.disbursementEvent.create({
        data: {
          disbursementId,
          eventType: "SUBMIT_RESPONSE",
          eventHash: eventHashFor(disbursementId, "SUBMIT_ERROR", { message: err.providerMessage, status: err.httpStatus }),
          status: "ERROR",
          message: err.providerMessage ?? err.message,
          payload: (err.rawBody ?? null) as Prisma.InputJsonValue,
        },
      });
      // Retry policy follows the provider error classifier.
      if (err.retryClass === "AUTH_RETRY" || err.retryClass === "VALIDATION" || err.retryClass === "FRESHNESS") {
        // These documented failures prove the provider refused the request,
        // so releasing the claim for a corrected/safely rebuilt retry is valid.
        await prisma.disbursement.updateMany({
          where: { id: disbursementId, status: "SUBMITTED", pgReferenceId: null },
          data: { status: "AUTHORIZED", submittedAt: null },
        });
      } else {
        // Duplicate reference, network failure, or another unknown outcome may
        // mean the provider accepted the payout. Keep it claimed and visible;
        // an automatic retry here is a potential duplicate payment.
        await prisma.disbursement.updateMany({
          where: { id: disbursementId, status: "SUBMITTED", pgReferenceId: null },
          data: {
            securityReviewReason: truncateReason(
              `AzamPay submission outcome is unknown; reconcile before retrying: ${err.providerMessage ?? err.message}`
            ),
          },
        });
      }
    } else {
      // Token/configuration/checksum/crypto failures occur before the
      // disbursement HTTP request is sent, so the submission claim can be
      // released safely. Provider-response persistence happens below, outside
      // this catch, and therefore can never trigger an unsafe retry.
      await prisma.disbursement.updateMany({
        where: { id: disbursementId, status: "SUBMITTED", pgReferenceId: null },
        data: { status: "AUTHORIZED", submittedAt: null },
      });
    }
    throw err;
  }

  // Keep provider acceptance persistence outside the pre-transport catch.
  // If this transaction fails after AzamPay accepted the payout, the row
  // remains SUBMITTED and automatic retry stays blocked.
  return prisma.$transaction(async (tx) => {
    await tx.disbursementEvent.create({
      data: {
        disbursementId,
        eventType: "SUBMIT_RESPONSE",
        eventHash: eventHashFor(disbursementId, "SUBMIT_RESPONSE", { pgReferenceId: response.pgReferenceId }),
        status: "PROCESSING",
        message: response.message,
        pgReferenceId: response.pgReferenceId,
        payload: response as unknown as Prisma.InputJsonValue,
      },
    });
    const moved = await tx.disbursement.updateMany({
      where: { id: disbursementId, status: "SUBMITTED", pgReferenceId: null },
      data: {
        status: "PROCESSING",
        pgReferenceId: response.pgReferenceId,
        submittedAt: new Date(),
        providerMessage: response.message,
        rawResponse: response as unknown as Prisma.InputJsonValue,
      },
    });
    if (moved.count !== 1) {
      throw new PayoutStateError(
        `Disbursement ${disbursementId} changed state while its AzamPay acceptance response was being stored`
      );
    }
    const processing = await tx.disbursement.findUnique({ where: { id: disbursementId } });
    if (!processing) throw new PayoutStateError(`Disbursement ${disbursementId} disappeared after submission`);
    await writeBackSourceProcessing(tx, processing);
    return processing;
  });
}

/**
 * Mirrors provider acceptance onto the legacy owner invoice so the owner sees
 * APPROVED -> PROCESSING while AzamPay is settling the transfer. This is a
 * projection only: the Disbursement remains authoritative. The conditional
 * update cannot reverse a terminal or independently rejected invoice.
 */
async function writeBackSourceProcessing(
  tx: Prisma.TransactionClient,
  disbursement: Disbursement
): Promise<void> {
  if (disbursement.sourceType !== "OWNER_INVOICE") return;

  try {
    await tx.invoice.updateMany({
      where: { id: disbursement.sourceId, status: "APPROVED" },
      data: { status: "PROCESSING" },
    });
  } catch (err) {
    // A projection failure must not discard a successful AzamPay acceptance.
    // Reconciliation still settles from the authoritative Disbursement row.
    console.error(
      `[payout-ledger] write-back to OWNER_INVOICE:${disbursement.sourceId} failed after disbursement ${disbursement.id} entered PROCESSING`,
      err
    );
  }
}

/** Return a failed owner payout to the approved queue so a new disbursement
 * can be requested after the failed row releases its activeSourceKey. */
async function writeBackSourceFailed(
  tx: Prisma.TransactionClient,
  disbursement: Disbursement
): Promise<void> {
  if (disbursement.sourceType !== "OWNER_INVOICE") return;

  try {
    await tx.invoice.updateMany({
      where: { id: disbursement.sourceId, status: "PROCESSING" },
      data: { status: "APPROVED" },
    });
  } catch (err) {
    console.error(
      `[payout-ledger] write-back to OWNER_INVOICE:${disbursement.sourceId} failed after disbursement ${disbursement.id} entered FAILED`,
      err
    );
  }
}

/**
 * Mirrors the terminal PAID state back onto the record each legacy
 * dashboard (Owners, Tours, Drivers, Sales) actually reads. Without this,
 * a payout that went out through AzamPay still shows as "APPROVED,
 * awaiting payout" in its own dashboard — which is what let someone click
 * the old manual pay button a second time. This is best-effort: a failure
 * here must never undo the Disbursement's own PAID status, which is the
 * authoritative record, so every branch is caught and logged rather than
 * thrown.
 */
async function writeBackSourcePaid(
  tx: Prisma.TransactionClient,
  disbursement: Disbursement
): Promise<void> {
  const { sourceType, sourceId, externalReferenceId, amount, currency } = disbursement;
  const now = new Date();

  try {
    if (sourceType === "OWNER_INVOICE") {
      const invoice = await tx.invoice.findUnique({
        where: { id: sourceId },
        select: { paymentRef: true, receiptNumber: true },
      });
      await tx.invoice.update({
        where: { id: sourceId },
        data: {
          status: "PAID",
          paidAt: now,
          paymentRef: invoice?.paymentRef ?? externalReferenceId,
          receiptNumber: invoice?.receiptNumber ?? ownerDisbursementReceiptNumber(sourceId, now),
        },
      });
      return;
    }

    if (sourceType === "TOUR_BOOKING") {
      const booking = await tx.tourBooking.update({
        where: { id: sourceId },
        data: { payoutStatus: "DISBURSED", operatorPayoutRef: externalReferenceId, payoutPaidAt: now },
        select: { id: true, operatorAgentId: true, bookingCode: true },
      });
      await tx.tourFinancialTransaction.upsert({
        where: { reference: externalReferenceId },
        create: {
          tourBookingId: sourceId,
          kind: "PAYOUT",
          status: "DISBURSED",
          reference: externalReferenceId,
          currency,
          amount,
          metadata: { via: "azampay_disbursement", disbursementId: disbursement.id },
        },
        update: { status: "DISBURSED" },
      });
      const operatorAgent = await tx.agent.findUnique({ where: { id: booking.operatorAgentId }, select: { userId: true } });
      if (operatorAgent?.userId) {
        void notifyUser(operatorAgent.userId, "agent_payout_disbursed", {
          tourBookingId: booking.id,
          bookingCode: booking.bookingCode,
          paymentRef: externalReferenceId,
        }).catch(() => {});
      }
      return;
    }

    if (sourceType === "DRIVER_TRIP") {
      await tx.transportPayout.update({
        where: { id: sourceId },
        data: { status: "PAID", paidAt: now, paymentRef: externalReferenceId },
      });
      return;
    }

    if (sourceType === "SALES_PAYOUT") {
      const request = await tx.salesPayoutRequest.update({
        where: { id: sourceId },
        data: {
          status: "PAID",
          paidAt: now,
          paymentReference: externalReferenceId,
          receiptUrl: `/api/sales/payouts/${sourceId}/receipt`,
        },
        include: { items: { select: { commissionId: true } } },
      });
      const commissionIds = request.items.map((item) => item.commissionId);
      if (commissionIds.length) {
        await tx.salesCommission.updateMany({
          where: { id: { in: commissionIds }, status: "AVAILABLE" },
          data: { status: "PAID", paidAt: now },
        });
      }
      return;
    }
  } catch (err) {
    console.error(
      `[payout-ledger] write-back to ${sourceType}:${sourceId} failed after disbursement ${disbursement.id} was marked PAID`,
      err
    );
  }
}

/**
 * Applies a callback or status-poll result. Idempotent on eventHash — a
 * replayed callback with identical content is a no-op, never a duplicate
 * PAID transition. Only this function can move a Disbursement to
 * PAID/FAILED.
 */
async function notifyOwnerDisbursementPaid(disbursement: Disbursement): Promise<void> {
  if (disbursement.sourceType !== "OWNER_INVOICE") return;

  const invoice = await prisma.invoice.findUnique({
    where: { id: disbursement.sourceId },
    select: {
      id: true,
      status: true,
      invoiceNumber: true,
      receiptNumber: true,
      total: true,
      commissionPercent: true,
      commissionAmount: true,
      netPayable: true,
      paymentRef: true,
      paidAt: true,
      owner: { select: { id: true, email: true, name: true, fullName: true } },
      booking: {
        select: {
          id: true,
          codeVisible: true,
          checkIn: true,
          checkOut: true,
          property: { select: { title: true } },
        },
      },
    },
  });

  if (!invoice || invoice.status !== "PAID" || !invoice.receiptNumber || !invoice.paidAt) return;

  const ownerName = invoice.owner.fullName || invoice.owner.name || `Owner #${invoice.owner.id}`;
  const propertyName = invoice.booking.property?.title || "your property";
  const invoiceNumber = invoice.invoiceNumber || `INV-${invoice.id}`;
  const paymentReference = disbursement.externalReferenceId || invoice.paymentRef;
  const amount = Number(invoice.netPayable ?? disbursement.amount);
  const title = "Payout disbursed";
  const body =
    `Your payout of ${amount.toLocaleString("en-US")} ${disbursement.currency} for booking #${invoice.booking.id} has been sent.` +
    ` Receipt: ${invoice.receiptNumber}. Reference: ${paymentReference}.`;

  let notificationId: number | null = null;
  try {
    const notification = await prisma.notification.create({
      data: {
        ownerId: invoice.owner.id,
        userId: invoice.owner.id,
        title,
        body,
        type: "invoice",
        meta: {
          kind: "owner_payout_disbursed",
          invoiceId: invoice.id,
          bookingId: invoice.booking.id,
          disbursementId: disbursement.id,
          receiptNumber: invoice.receiptNumber,
          paymentReference,
          actionUrl: `/owner/revenue/receipts/${invoice.id}`,
        },
      },
      select: { id: true },
    });
    notificationId = notification.id;
  } catch (err) {
    console.warn(`[payout-ledger] could not create owner payout notification for disbursement ${disbursement.id}`, err);
  }

  try {
    const io = (global as any).io;
    io?.to?.(`owner:${invoice.owner.id}`)?.emit?.("notification:new", { id: notificationId, title, type: "invoice" });
    io?.to?.(`owner:${invoice.owner.id}`)?.emit?.("owner:bookings:updated", {
      bookingId: invoice.booking.id,
      invoiceId: invoice.id,
    });
  } catch {
    // Realtime delivery is optional; the saved notification and email remain.
  }

  if (!invoice.owner.email) {
    console.warn(`[payout-ledger] owner ${invoice.owner.id} has no email; disbursement ${disbursement.id} notice not sent`);
    return;
  }

  const email = getOwnerDisbursementEmail({
    ownerName,
    propertyName,
    bookingId: invoice.booking.id,
    invoiceNumber,
    receiptNumber: invoice.receiptNumber,
    checkIn: invoice.booking.checkIn,
    checkOut: invoice.booking.checkOut,
    netPayable: amount,
    paymentMethod: disbursement.bankName,
    paidAt: invoice.paidAt,
  });

  let attachments: Array<{ filename: string; content: Buffer }> | undefined;
  try {
    const pdf = await generateOwnerDisbursementPdf({
      ownerName,
      ownerEmail: invoice.owner.email,
      receiptNumber: invoice.receiptNumber,
      invoiceNumber,
      bookingId: invoice.booking.id,
      bookingCode: invoice.booking.codeVisible,
      propertyName,
      checkIn: invoice.booking.checkIn,
      checkOut: invoice.booking.checkOut,
      totalRevenue: Number(invoice.total),
      commissionPercent: invoice.commissionPercent ? Number(invoice.commissionPercent) : null,
      commissionAmount: invoice.commissionAmount ? Number(invoice.commissionAmount) : null,
      netPayable: amount,
      paymentMethod: disbursement.bankName,
      paymentRef: paymentReference,
      paidAt: invoice.paidAt,
      currency: disbursement.currency,
      qrPng: null,
    });
    attachments = [{ filename: `Disbursement-${invoice.receiptNumber}.pdf`, content: pdf }];
  } catch (err) {
    console.warn(`[payout-ledger] owner payout PDF failed for disbursement ${disbursement.id}`, err);
  }

  await sendMail(invoice.owner.email, email.subject, email.html, attachments, { replyTo: "support@nolsaf.com" });
}

export async function applyProviderEvent(
  disbursementId: number,
  event: { eventType: "CALLBACK" | "STATUS_POLL"; callback: AzamPayDisburseCallback }
): Promise<Disbursement> {
  const result = await prisma.$transaction(
    async (tx): Promise<{ disbursement: Disbursement; transitionedToPaid: boolean }> => {
    const disbursement = await tx.disbursement.findUnique({ where: { id: disbursementId } });
    if (!disbursement) throw new PayoutStateError(`Disbursement ${disbursementId} not found`);

    const hash = eventHashFor(disbursementId, event.eventType, {
      initiatorReferenceId: event.callback.initiatorReferenceId,
      pgReferenceId: event.callback.pgReferenceId,
      fspReferenceId: event.callback.fspReferenceId,
      status: event.callback.status,
      amount: event.callback.amount,
      operator: event.callback.operator,
      message: event.callback.message,
    });

    // Use the database's atomic insert-if-absent behavior instead of an
    // exception-driven read/insert sequence. The unique eventHash plus
    // skipDuplicates makes concurrent callback replays a genuine no-op on
    // this project's MySQL/MariaDB datastore.
    const inserted = await tx.disbursementEvent.createMany({
      data: [{
        disbursementId,
        eventType: event.eventType,
        eventHash: hash,
        status: event.callback.status,
        message: event.callback.message,
        pgReferenceId: event.callback.pgReferenceId,
        fspReferenceId: event.callback.fspReferenceId,
        amount: event.callback.amount ? Number(event.callback.amount) : null,
        operator: event.callback.operator,
        payload: event.callback as unknown as Prisma.InputJsonValue,
      }],
      skipDuplicates: true,
    });
    if (inserted.count === 0) {
      // Same event already recorded and applied; leave state untouched.
      return { disbursement, transitionedToPaid: false };
    }

    // Never reverse a terminal state on a conflicting later event — freeze
    // for manual review instead, per "Transaction Status: fallback and
    // reconciliation" in the dev guide.
    const correlationFailures: string[] = [];
    if (!disbursement.pgReferenceId || event.callback.pgReferenceId !== disbursement.pgReferenceId) {
      correlationFailures.push("pgReferenceId does not match the submitted payout");
    }
    if (
      event.callback.initiatorReferenceId &&
      event.callback.initiatorReferenceId !== disbursement.externalReferenceId
    ) {
      correlationFailures.push("initiatorReferenceId does not match the payout");
    }
    if (event.callback.amount) {
      const reportedAmount = Number(event.callback.amount);
      if (!Number.isFinite(reportedAmount) || Math.abs(reportedAmount - Number(disbursement.amount)) > 0.01) {
        correlationFailures.push("reported amount does not match the payout");
      }
    }
    if (
      event.callback.operator &&
      event.callback.operator.trim().toLowerCase() !== disbursement.bankName.trim().toLowerCase()
    ) {
      correlationFailures.push("operator does not match the payout destination");
    }
    if (correlationFailures.length > 0) {
      const reason = truncateReason(`Provider event correlation failure: ${correlationFailures.join("; ")}`);
      const flagged = await tx.disbursement.update({
        where: { id: disbursementId },
        data: { securityReviewReason: reason },
      });
      return { disbursement: flagged, transitionedToPaid: false };
    }

    const isFinalEvent = event.callback.status === "success" || event.callback.status === "failure";

    if (disbursement.status === "PAID" || disbursement.status === "FAILED") {
      const expectedTerminal =
        event.callback.status === "success"
          ? "PAID"
          : event.callback.status === "failure"
            ? "FAILED"
            : null;
      if (expectedTerminal && expectedTerminal !== disbursement.status) {
        const conflicted = await tx.disbursement.update({
          where: { id: disbursementId },
          data: {
            securityReviewReason: truncateReason(
              `Conflicting provider event attempted ${expectedTerminal} after payout was already ${disbursement.status}`
            ),
          },
        });
        return { disbursement: conflicted, transitionedToPaid: false };
      }
      return { disbursement, transitionedToPaid: false };
    }

    if (isFinalEvent && disbursement.status !== "PROCESSING") {
      const flagged = await tx.disbursement.update({
        where: { id: disbursementId },
        data: {
          securityReviewReason: truncateReason(
            `Provider final status ${event.callback.status} received while payout was ${disbursement.status}, expected PROCESSING`
          ),
        },
      });
      return { disbursement: flagged, transitionedToPaid: false };
    }

    if (event.callback.status === "success") {
      // A callback and a status poll can report success concurrently. Claiming
      // the terminal transition atomically gives notification delivery one owner.
      const claimed = await tx.disbursement.updateMany({
        where: { id: disbursementId, status: "PROCESSING" },
        data: {
          status: "PAID",
          paidAt: new Date(),
          fspReferenceId: event.callback.fspReferenceId,
          operator: event.callback.operator,
          providerMessage: event.callback.message,
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.disbursement.findUnique({ where: { id: disbursementId } });
        if (!current) throw new PayoutStateError(`Disbursement ${disbursementId} disappeared during settlement`);
        return { disbursement: current, transitionedToPaid: false };
      }
      const paid = await tx.disbursement.findUnique({ where: { id: disbursementId } });
      if (!paid) throw new PayoutStateError(`Disbursement ${disbursementId} disappeared during settlement`);
      await writeBackSourcePaid(tx, paid);
      return { disbursement: paid, transitionedToPaid: true };
    }
    if (event.callback.status === "failure") {
      const claimed = await tx.disbursement.updateMany({
        where: { id: disbursementId, status: "PROCESSING" },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          providerMessage: event.callback.message,
          // Release the source so a fresh payout can be requested for it.
          // FAILED is the only state that gives the key back; every other
          // state (including SECURITY_REVIEW) keeps the source blocked.
          activeSourceKey: null,
        },
      });
      if (claimed.count !== 1) {
        const current = await tx.disbursement.findUnique({ where: { id: disbursementId } });
        if (!current) throw new PayoutStateError(`Disbursement ${disbursementId} disappeared during settlement`);
        return { disbursement: current, transitionedToPaid: false };
      }
      const failed = await tx.disbursement.findUnique({ where: { id: disbursementId } });
      if (!failed) throw new PayoutStateError(`Disbursement ${disbursementId} disappeared during settlement`);
      await writeBackSourceFailed(tx, failed);
      return { disbursement: failed, transitionedToPaid: false };
    }
    // Any other status: leave as-is (still PROCESSING), the event is recorded for audit.
    return { disbursement, transitionedToPaid: false };
  });

  if (result.transitionedToPaid && result.disbursement.sourceType === "OWNER_INVOICE") {
    try {
      await notifyOwnerDisbursementPaid(result.disbursement);
    } catch (err) {
      // Settlement is already committed. Notification failure must never
      // reverse or fail a confirmed payout.
      console.error(`[payout-ledger] owner payout notification failed for disbursement ${disbursementId}`, err);
    }
  }

  return result.disbursement;
}

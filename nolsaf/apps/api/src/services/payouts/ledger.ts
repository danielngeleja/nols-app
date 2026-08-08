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
import { azamPayDisburse } from "../azampay/disbursement/client.js";
import { AzamPayDisburseError } from "../azampay/disbursement/errors.js";
import type { AzamPayDisburseBankName, AzamPayDisburseCallback } from "../azampay/disbursement/types.js";
import { notifyUser } from "../../lib/notifications.js";

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

/** e.g. "NLS-T-260807-9381" — well under AzamPay's 30-char externalReferenceId limit. */
function generateExternalReferenceId(sourceType: PayoutSourceType): string {
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const randomPart = randomBytes(2).toString("hex");
  return `NLS-${SOURCE_REF_CODE[sourceType]}-${datePart}-${randomPart}`;
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
      const isRefCollision = err?.code === "P2002" && err?.meta?.target?.includes?.("externalReferenceId");
      if (isRefCollision && attempt === 0) continue;
      throw err;
    }
  }
  throw new PayoutStateError("Could not allocate a unique externalReferenceId after retry");
}

/** REQUESTED -> APPROVED. Separate step from creation so approval is a deliberate, auditable action. */
export async function approveDisbursement(disbursementId: number, approvedById: number): Promise<Disbursement> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.disbursement.findUnique({ where: { id: disbursementId } });
    if (!current) throw new PayoutStateError(`Disbursement ${disbursementId} not found`);
    if (current.status !== "REQUESTED") {
      throw new PayoutStateError(`Disbursement ${disbursementId} is ${current.status}, expected REQUESTED`);
    }
    const updated = await tx.disbursement.update({
      where: { id: disbursementId },
      data: { status: "APPROVED", approvedById, approvedAt: new Date() },
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
 * APPROVED -> SUBMITTED/PROCESSING. Calls AzamPay. A successful response is
 * NOT a paid state — only applyProviderEvent() can move this to PAID.
 */
export async function submitToAzamPay(disbursementId: number): Promise<Disbursement> {
  const disbursement = await prisma.disbursement.findUnique({
    where: { id: disbursementId },
    include: { payoutAccount: true },
  });
  if (!disbursement) throw new PayoutStateError(`Disbursement ${disbursementId} not found`);
  if (disbursement.status !== "APPROVED") {
    throw new PayoutStateError(`Disbursement ${disbursementId} is ${disbursement.status}, expected APPROVED`);
  }

  assertWithinAmountCeiling(disbursement.amount);

  const sourceAccount = {
    countryCode: "TZ",
    fullName: process.env.AZAMPAY_DISBURSE_SOURCE_NAME || "NoLS AFRICA COMPANY LIMITED",
    bankName: (process.env.AZAMPAY_DISBURSE_SOURCE_PROVIDER || "azampesa") as AzamPayDisburseBankName,
    accountNumber: process.env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT || "",
    currency: disbursement.currency,
  };

  try {
    const response = await azamPayDisburse({
      source: sourceAccount,
      destination: {
        countryCode: "TZ",
        fullName: disbursement.payoutAccount.accountName,
        bankName: disbursement.payoutAccount.provider as AzamPayDisburseBankName,
        accountNumber: disbursement.payoutAccount.accountNumber,
        currency: disbursement.currency,
      },
      transferDetails: {
        type: process.env.AZAMPAY_DISBURSE_TRANSFER_TYPE || "",
        amount: Number(disbursement.amount),
        dateInEpoch: Math.floor(Date.now() / 1000),
      },
      externalReferenceId: disbursement.externalReferenceId,
      additionalProperties: { sourceType: disbursement.sourceType, sourceId: disbursement.sourceId },
      remarks: disbursement.remarks ?? undefined,
    });

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
      return tx.disbursement.update({
        where: { id: disbursementId },
        data: {
          status: "PROCESSING",
          pgReferenceId: response.pgReferenceId,
          submittedAt: new Date(),
          providerMessage: response.message,
          rawResponse: response as unknown as Prisma.InputJsonValue,
        },
      });
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
      // Deliberately does not change disbursement.status: retry policy (auth/validation/
      // freshness/reconcile-first) is the caller's call, per the dev guide's error table.
    }
    throw err;
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
      const invoice = await tx.invoice.findUnique({ where: { id: sourceId }, select: { paymentRef: true } });
      await tx.invoice.update({
        where: { id: sourceId },
        data: { status: "PAID", paidAt: now, paymentRef: invoice?.paymentRef ?? externalReferenceId },
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
export async function applyProviderEvent(
  disbursementId: number,
  event: { eventType: "CALLBACK" | "STATUS_POLL"; callback: AzamPayDisburseCallback }
): Promise<Disbursement> {
  return prisma.$transaction(async (tx) => {
    const disbursement = await tx.disbursement.findUnique({ where: { id: disbursementId } });
    if (!disbursement) throw new PayoutStateError(`Disbursement ${disbursementId} not found`);

    const hash = eventHashFor(disbursementId, event.eventType, {
      pgReferenceId: event.callback.pgReferenceId,
      status: event.callback.status,
      amount: event.callback.amount,
    });

    try {
      await tx.disbursementEvent.create({
        data: {
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
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        // Same event already recorded — already-applied, return current state untouched.
        return disbursement;
      }
      throw err;
    }

    // Never reverse a terminal state on a conflicting later event — freeze
    // for manual review instead, per "Transaction Status: fallback and
    // reconciliation" in the dev guide.
    if (disbursement.status === "PAID" || disbursement.status === "FAILED") {
      return disbursement;
    }

    if (event.callback.status === "success") {
      const paid = await tx.disbursement.update({
        where: { id: disbursementId },
        data: {
          status: "PAID",
          paidAt: new Date(),
          fspReferenceId: event.callback.fspReferenceId,
          operator: event.callback.operator,
          providerMessage: event.callback.message,
        },
      });
      await writeBackSourcePaid(tx, paid);
      return paid;
    }
    if (event.callback.status === "failure") {
      return tx.disbursement.update({
        where: { id: disbursementId },
        data: { status: "FAILED", failedAt: new Date(), providerMessage: event.callback.message },
      });
    }
    // Any other status: leave as-is (still PROCESSING), the event is recorded for audit.
    return disbursement;
  });
}

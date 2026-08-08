/**
 * Payout Fingerprints — approval locking and batch integrity
 *
 * Two SHA256 fingerprints, per docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md
 * "Batch security architecture":
 *
 *  - Approval fingerprint: frozen on a single Disbursement the moment it is
 *    APPROVED. Recomputing it later and comparing detects whether any
 *    financial field (amount, currency, provider, account) changed after a
 *    human approved this exact payout.
 *  - Batch fingerprint: frozen on a DisbursementBatch the moment it is
 *    formed from a set of already-approved, already-locked disbursements.
 *    Recomputing it at authorize time detects whether the batch's exact
 *    membership or any member's locked fields changed since formation.
 *
 * Neither fingerprint is secret — they are integrity checks, not auth
 * tokens. Never used as the sole gate; always paired with a real state
 * check (status === "APPROVED", etc.) by the caller.
 */

import { createHash } from "node:crypto";
import type { Disbursement, PayoutAccount } from "@prisma/client";

/** The exact field set covered by the approval fingerprint — anything not listed here can change post-approval without tripping the lock. */
export function computeApprovalFingerprint(
  disbursement: Pick<Disbursement, "id" | "externalReferenceId" | "amount" | "currency" | "sourceType" | "sourceId">,
  payoutAccount: Pick<PayoutAccount, "provider" | "accountNumber" | "accountName">
): string {
  const parts = [
    disbursement.id,
    disbursement.externalReferenceId,
    disbursement.amount.toString(),
    disbursement.currency,
    payoutAccount.provider,
    payoutAccount.accountNumber,
    payoutAccount.accountName,
    disbursement.sourceType,
    disbursement.sourceId,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export interface BatchFingerprintMember {
  externalReferenceId: string;
  amount: string;
  currency: string;
  provider: string;
  accountNumber: string;
  accountName: string;
}

/**
 * Sorted by the rendered line so membership order never affects the hash —
 * only the set itself does.
 *
 * The member fields must be read from the LIVE PayoutAccount, never from the
 * Disbursement's own denormalised copies and never from payoutAccountId. The
 * whole point of re-checking this at authorize time is to catch a destination
 * that was swapped after formation; hashing the foreign key instead of the
 * account number would leave exactly that change invisible, since
 * ledger.submitToAzamPay reads the live account when it builds the payout.
 */
export function computeBatchFingerprint(members: BatchFingerprintMember[]): string {
  const lines = members
    .map((m) => `${m.externalReferenceId}|${m.amount}|${m.currency}|${m.provider}|${m.accountNumber}|${m.accountName}`)
    .sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** Builds a fingerprint member from a disbursement joined to its live payout account. */
export function toBatchFingerprintMember(
  disbursement: Pick<Disbursement, "externalReferenceId" | "amount" | "currency">,
  payoutAccount: Pick<PayoutAccount, "provider" | "accountNumber" | "accountName">
): BatchFingerprintMember {
  return {
    externalReferenceId: disbursement.externalReferenceId,
    amount: disbursement.amount.toString(),
    currency: disbursement.currency,
    provider: payoutAccount.provider,
    accountNumber: payoutAccount.accountNumber,
    accountName: payoutAccount.accountName,
  };
}

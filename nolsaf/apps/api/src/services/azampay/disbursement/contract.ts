import type {
  AzamPayDisburseCallback,
  AzamPayTransactionStatusResponse,
} from "./types.js";
import { azamPayProvidersMatch, canonicalAzamPayProvider, toAzamPayWireBankName } from "./providers.js";

/**
 * Whether the operator AzamPay reports fits this payout. Normally that is the
 * destination network. A transfer that fails inside our own funding wallet
 * (for example "Balance can not be negative") never reaches the destination,
 * and AzamPay then reports our source rail instead (Azampesa, first seen on the
 * first production payout, 2026-11-25). That is accepted for a failure only: a
 * success must always name the destination.
 */
export function azamPayOperatorMatchesPayout(reported: string, destination: string, status: string): boolean {
  if (azamPayProvidersMatch(destination, reported)) return true;
  if (String(status || "").trim().toLowerCase() !== "failure") return false;
  const source = canonicalAzamPayProvider(process.env.AZAMPAY_DISBURSE_SOURCE_PROVIDER || "azampesa");
  return Boolean(source && canonicalAzamPayProvider(reported) === source);
}

export type AzamPayFinalStatus = "success" | "failure";

/**
 * A successful status-query envelope is not a successful payout. The public
 * schema documents `success`, `statusCode`, `message`, and `pgReferenceId`,
 * but does not document the field that carries the final transaction state.
 * Only an explicit success/failure status may settle the ledger.
 */
export function normalizeAzamPayFinalStatus(
  response: AzamPayTransactionStatusResponse
): AzamPayFinalStatus | null {
  const status = typeof response.status === "string" ? response.status.trim().toLowerCase() : "";
  return status === "success" || status === "failure" ? status : null;
}

export type CallbackCorrelationCode =
  | "initiator_reference_mismatch"
  | "pg_reference_mismatch"
  | "amount_mismatch"
  | "operator_mismatch";

export interface CallbackCorrelationMismatch {
  code: CallbackCorrelationCode;
  expected: string;
  received: string;
}

export interface StoredDisbursementCorrelation {
  externalReferenceId: string;
  pgReferenceId: string | null;
  amount: unknown;
  bankName: string;
}

/** Verifies every provider identifier that can bind a callback to one payout. */
export function validateDisbursementCallbackCorrelation(
  stored: StoredDisbursementCorrelation,
  callback: AzamPayDisburseCallback
): CallbackCorrelationMismatch | null {
  if (callback.initiatorReferenceId !== stored.externalReferenceId) {
    return {
      code: "initiator_reference_mismatch",
      expected: stored.externalReferenceId,
      received: callback.initiatorReferenceId,
    };
  }

  const storedPgReferenceId = String(stored.pgReferenceId || "").trim();
  const callbackPgReferenceId = String(callback.pgReferenceId || "").trim();
  if (!storedPgReferenceId || callbackPgReferenceId !== storedPgReferenceId) {
    return {
      code: "pg_reference_mismatch",
      expected: storedPgReferenceId || "<missing stored pgReferenceId>",
      received: callbackPgReferenceId || "<missing callback pgReferenceId>",
    };
  }

  const expectedAmount = Number(stored.amount);
  const receivedAmount = Number(callback.amount);
  if (
    !Number.isFinite(expectedAmount) ||
    !Number.isFinite(receivedAmount) ||
    Math.abs(receivedAmount - expectedAmount) > 0.01
  ) {
    return {
      code: "amount_mismatch",
      expected: String(stored.amount),
      received: String(callback.amount),
    };
  }

  const expectedOperator = String(stored.bankName || "").trim();
  const receivedOperator = String(callback.operator || "").trim();
  if (!expectedOperator || !receivedOperator || !azamPayOperatorMatchesPayout(receivedOperator, expectedOperator, callback.status)) {
    return {
      code: "operator_mismatch",
      expected: expectedOperator ? toAzamPayWireBankName(expectedOperator) : "<missing stored operator>",
      received: receivedOperator || "<missing callback operator>",
    };
  }

  return null;
}

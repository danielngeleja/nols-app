/**
 * AzamPay Disbursement — Error Classification
 *
 * Maps provider HTTP status / message into a retry class so callers never
 * have to guess whether an error is safe to retry. See the "Error handling
 * and safe retry policy" table in docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md.
 *
 * Golden rule (from that doc): if there is any chance AzamPay accepted the
 * original payout, never generate a new externalReferenceId and retry blind.
 * DUPLICATE and UNKNOWN both resolve to RECONCILE_FIRST for that reason.
 */

export type AzamPayRetryClass =
  | "AUTH_RETRY"        // token expired/invalid — refresh token once, retry same reference
  | "VALIDATION"        // malformed/unsupported request — fix data, do not retry as-is
  | "FRESHNESS"         // request/epoch/checksum went stale — rebuild and retry same reference
  | "RECONCILE_FIRST";  // duplicate reference or unknown outcome — never blind-retry

export class AzamPayDisburseError extends Error {
  readonly httpStatus: number | null;
  readonly providerMessage: string | null;
  readonly retryClass: AzamPayRetryClass;
  /** Raw response body, kept for audit persistence — callers decide what to redact before logging. */
  readonly rawBody: unknown;

  constructor(params: {
    httpStatus: number | null;
    providerMessage: string | null;
    retryClass: AzamPayRetryClass;
    rawBody: unknown;
  }) {
    super(
      `AzamPay disbursement error (${params.httpStatus ?? "network"}): ${
        params.providerMessage ?? "no message"
      }`
    );
    this.name = "AzamPayDisburseError";
    this.httpStatus = params.httpStatus;
    this.providerMessage = params.providerMessage;
    this.retryClass = params.retryClass;
    this.rawBody = params.rawBody;
  }
}

/**
 * Classifies a non-success AzamPay response. This table is built from the
 * documented examples only — extend it as real provider responses are
 * observed in sandbox, never by guessing undocumented codes.
 */
export function classifyAzamPayError(
  httpStatus: number,
  providerMessage: string | null
): AzamPayRetryClass {
  const msg = (providerMessage || "").toLowerCase();

  if (httpStatus === 401 || msg.includes("valid authorization")) {
    return "AUTH_RETRY";
  }
  if (httpStatus === 402 || msg.includes("request expired")) {
    return "FRESHNESS";
  }
  if (httpStatus === 403 || msg.includes("duplicate external reference")) {
    return "RECONCILE_FIRST";
  }
  if (msg.includes("transaction not found")) {
    return "RECONCILE_FIRST";
  }
  if (httpStatus === 400) {
    return "VALIDATION";
  }
  // Unknown provider error: never assume it is safe to retry blindly.
  return "RECONCILE_FIRST";
}

export function mapAzamPayError(
  httpStatus: number | null,
  body: { message?: string; success?: boolean } | null
): AzamPayDisburseError {
  const providerMessage = body?.message ?? null;
  const retryClass =
    httpStatus === null
      ? "RECONCILE_FIRST" // network failure: outcome unknown, treat as unknown
      : classifyAzamPayError(httpStatus, providerMessage);

  return new AzamPayDisburseError({
    httpStatus,
    providerMessage,
    retryClass,
    rawBody: body,
  });
}

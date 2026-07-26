const CAPABILITY_PATH_SEGMENT =
  /(\/(?:payment-requests|reviews|menu|guest\/payment|guest\/review)\/)[^/?#\s]+/gi;
const SENSITIVE_QUERY_VALUE =
  /([?&](?:token|access_token|resetToken|paymentToken|reviewToken|publicToken)=)[^&#\s]*/gi;

/**
 * Redact bearer credentials embedded in URLs before an access logger, APM
 * agent, or error reporter sees them. Keep route shape for diagnostics while
 * ensuring the credential itself never reaches logs.
 */
export function redactSensitiveUrl(rawUrl: string | undefined): string {
  const value = String(rawUrl || "");
  return value
    .replace(CAPABILITY_PATH_SEGMENT, "$1[REDACTED]")
    .replace(SENSITIVE_QUERY_VALUE, "$1[REDACTED]");
}

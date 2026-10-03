import crypto from "crypto";

export const CORAL_MAX_PAYMENT_REFERENCE_LENGTH = 40;

/**
 * Coral uses this value as Submission.Stamp. Keep it provider-safe and
 * distinct for every checkout attempt; the NRMS payment token is sent as the
 * stable Identifier and remains the internal settlement key.
 */
export function createNrmsCoralPaymentReference(): string {
  const reference = `NRMS-C-${crypto.randomBytes(16).toString("hex").toUpperCase()}`;
  if (reference.length > CORAL_MAX_PAYMENT_REFERENCE_LENGTH) {
    throw new Error("nrms_coral_payment_reference_too_long");
  }
  return reference;
}

export function createNrmsCoralReferenceFields(nrmsToken: string) {
  if (!/^NRMS-/i.test(nrmsToken) || nrmsToken.length > 255) {
    throw new Error("invalid_nrms_coral_identifier");
  }
  const paymentRef = createNrmsCoralPaymentReference();
  return {
    paymentRef,
    Submission: { Number: 1, Stamp: paymentRef },
    // Coral defines Identifier as the stable merchant order reference and
    // Stamp as the unique max-40-character submission reference.
    Identifier: nrmsToken,
  } as const;
}

/** Only trust a persisted initiation mapping when it matches this callback. */
export function nrmsTokenFromCoralInitiationPayload(payload: unknown, paymentRef: string): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (value.paymentRef !== paymentRef) return null;
  if (typeof value.nrmsToken !== "string" || !/^NRMS-/i.test(value.nrmsToken)) return null;
  return value.nrmsToken;
}

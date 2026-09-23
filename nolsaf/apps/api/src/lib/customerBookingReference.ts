import { createHmac, timingSafeEqual } from "node:crypto";
import { publicLinkSecrets, publicLinkSigningSecret } from "./publicLinkSecrets.js";

export type CustomerRecordKind = "booking" | "ride" | "tour" | "group-stay" | "owner-invoice" | "nrms-reservation" | "nrms-agent-request" | "agent-account";

const PREFIX_BY_KIND: Record<CustomerRecordKind, string> = {
  booking: "bk",
  ride: "rd",
  tour: "tr",
  "group-stay": "gs",
  "owner-invoice": "iv",
  "nrms-reservation": "rs",
  "nrms-agent-request": "ar",
  "agent-account": "ag",
};
const REFERENCE_PATTERN = /^(bk|rd|tr|gs|iv|rs|ar)_[A-Za-z0-9_-]{22}$/;
const LEGACY_REFERENCE_PATTERN = /^BKG-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})$/i;

function digest(kind: CustomerRecordKind, recordId: number, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(`customer-${kind}:${recordId}`)
    .digest()
    .subarray(0, 16);
}

export function customerRecordReference(kind: CustomerRecordKind, recordId: number): string {
  if (!Number.isInteger(recordId) || recordId <= 0) {
    throw new Error("invalid_customer_record_id");
  }
  return `${PREFIX_BY_KIND[kind]}_${digest(kind, recordId, publicLinkSigningSecret("customer_record_reference_secret_missing")).toString("base64url")}`;
}

export function matchesCustomerRecordReference(reference: string, kind: CustomerRecordKind, recordId: number): boolean {
  const normalized = String(reference || "").trim();
  if (!Number.isInteger(recordId) || recordId <= 0) return false;

  return publicLinkSecrets().some((secret) => {
    const fullDigest = digest(kind, recordId, secret);
    const isCurrentReference = REFERENCE_PATTERN.test(normalized);
    const expected = isCurrentReference
      ? Buffer.from(`${PREFIX_BY_KIND[kind]}_${fullDigest.toString("base64url")}`, "utf8")
      : Buffer.from(`BKG-${fullDigest.toString("hex").slice(0, 4)}-${fullDigest.toString("hex").slice(4, 8)}-${fullDigest.toString("hex").slice(8, 12)}`.toUpperCase(), "utf8");
    const supplied = Buffer.from(isCurrentReference ? normalized : normalized.toUpperCase(), "utf8");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

export function isCustomerRecordReference(value: string, kind: CustomerRecordKind): boolean {
  const normalized = String(value || "").trim();
  return normalized.startsWith(`${PREFIX_BY_KIND[kind]}_`) && REFERENCE_PATTERN.test(normalized);
}

export function isCustomerBookingReference(value: string): boolean {
  const normalized = String(value || "").trim();
  return isCustomerRecordReference(normalized, "booking") || LEGACY_REFERENCE_PATTERN.test(normalized);
}

export function customerBookingReference(bookingId: number): string {
  return customerRecordReference("booking", bookingId);
}

export function matchesCustomerBookingReference(reference: string, bookingId: number): boolean {
  return matchesCustomerRecordReference(reference, "booking", bookingId);
}

export function ownerInvoiceReference(invoiceId: number): string {
  return customerRecordReference("owner-invoice", invoiceId);
}

export function isOwnerInvoiceReference(value: string): boolean {
  return isCustomerRecordReference(value, "owner-invoice");
}

export function matchesOwnerInvoiceReference(reference: string, invoiceId: number): boolean {
  return matchesCustomerRecordReference(reference, "owner-invoice", invoiceId);
}

/** Opaque NRMS reservation reference for URLs, so page links never carry the row id. */
export function nrmsReservationReference(reservationId: number): string {
  return customerRecordReference("nrms-reservation", reservationId);
}

export function isNrmsReservationReference(value: string): boolean {
  return isCustomerRecordReference(value, "nrms-reservation");
}

export function matchesNrmsReservationReference(reference: string, reservationId: number): boolean {
  return matchesCustomerRecordReference(reference, "nrms-reservation", reservationId);
}

// Crockford base32: no I, L, O or U, so a code read aloud or typed back is unambiguous.
const DISPLAY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Human-facing agency code, e.g. AGT-7K3M-Q9XD. Replaces AGT-000123, which was
 * the account id zero-padded and so revealed how many agencies exist. Derived
 * from the same HMAC as the other record references, so it is stable for an
 * account and cannot be turned back into the id. Display only: nothing looks
 * an agency up by this code.
 */
export function agentAccountReference(accountId: number): string {
  if (!Number.isInteger(accountId) || accountId <= 0) {
    throw new Error("invalid_agent_account_id");
  }
  const bytes = digest("agent-account", accountId, publicLinkSigningSecret("customer_record_reference_secret_missing"));
  let bits = 0n;
  for (const byte of bytes.subarray(0, 5)) bits = (bits << 8n) | BigInt(byte);
  let code = "";
  for (let shift = 35n; shift >= 0n; shift -= 5n) code += DISPLAY_ALPHABET[Number((bits >> shift) & 31n)];
  return `AGT-${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Opaque agency booking request reference for URLs, so page links never carry the row id. */
export function nrmsAgentRequestReference(requestId: number): string {
  return customerRecordReference("nrms-agent-request", requestId);
}

export function isNrmsAgentRequestReference(value: string): boolean {
  return isCustomerRecordReference(value, "nrms-agent-request");
}

export function matchesNrmsAgentRequestReference(reference: string, requestId: number): boolean {
  return matchesCustomerRecordReference(reference, "nrms-agent-request", requestId);
}

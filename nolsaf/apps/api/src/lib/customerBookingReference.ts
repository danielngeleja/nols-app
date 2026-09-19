import { createHmac, timingSafeEqual } from "node:crypto";
import { publicLinkSecrets, publicLinkSigningSecret } from "./publicLinkSecrets.js";

const REFERENCE_PATTERN = /^bk_[A-Za-z0-9_-]{22}$/;
const LEGACY_REFERENCE_PATTERN = /^BKG-([A-F0-9]{4})-([A-F0-9]{4})-([A-F0-9]{4})$/i;

function digest(bookingId: number, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update(`customer-booking:${bookingId}`)
    .digest()
    .subarray(0, 16);
}

export function customerBookingReference(bookingId: number): string {
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    throw new Error("invalid_customer_booking_id");
  }
  return `bk_${digest(bookingId, publicLinkSigningSecret("customer_booking_reference_secret_missing")).toString("base64url")}`;
}

export function matchesCustomerBookingReference(reference: string, bookingId: number): boolean {
  const normalized = String(reference || "").trim();
  if (!Number.isInteger(bookingId) || bookingId <= 0) return false;

  return publicLinkSecrets().some((secret) => {
    const fullDigest = digest(bookingId, secret);
    const isCurrentReference = REFERENCE_PATTERN.test(normalized);
    const expected = isCurrentReference
      ? Buffer.from(`bk_${fullDigest.toString("base64url")}`, "utf8")
      : Buffer.from(`BKG-${fullDigest.toString("hex").slice(0, 4)}-${fullDigest.toString("hex").slice(4, 8)}-${fullDigest.toString("hex").slice(8, 12)}`.toUpperCase(), "utf8");
    const supplied = Buffer.from(isCurrentReference ? normalized : normalized.toUpperCase(), "utf8");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

export function isCustomerBookingReference(value: string): boolean {
  const normalized = String(value || "").trim();
  return REFERENCE_PATTERN.test(normalized) || LEGACY_REFERENCE_PATTERN.test(normalized);
}

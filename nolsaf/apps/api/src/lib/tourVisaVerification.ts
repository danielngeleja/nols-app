import { createHmac, timingSafeEqual } from "node:crypto";
import { publicLinkSecrets, publicLinkSigningSecret } from "./publicLinkSecrets.js";

function signature(bookingId: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`tour-visa-itinerary:${bookingId}`)
    .digest()
    .subarray(0, 18)
    .toString("base64url");
}

export function tourVisaVerificationToken(bookingId: number): string {
  if (!Number.isInteger(bookingId) || bookingId <= 0) throw new Error("INVALID_TOUR_BOOKING_ID");
  return `${bookingId}.${signature(bookingId, publicLinkSigningSecret("tour_visa_verification_secret_missing"))}`;
}

export function parseTourVisaVerificationToken(value: unknown): number | null {
  const match = String(value || "").trim().match(/^(\d+)\.([A-Za-z0-9_-]{24})$/);
  if (!match) return null;
  const bookingId = Number(match[1]);
  if (!Number.isInteger(bookingId) || bookingId <= 0) return null;
  const supplied = Buffer.from(match[2], "utf8");
  const valid = publicLinkSecrets().some((secret) => {
    const expected = Buffer.from(signature(bookingId, secret), "utf8");
    return expected.length === supplied.length && timingSafeEqual(expected, supplied);
  });
  return valid ? bookingId : null;
}

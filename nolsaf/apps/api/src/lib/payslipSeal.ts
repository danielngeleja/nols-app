import { createHmac, timingSafeEqual } from "node:crypto";
import { publicLinkSecrets, publicLinkSigningSecret } from "./publicLinkSecrets.js";

/**
 * Payslip verification tokens for the QR code printed on each payslip:
 * "<payslip number>.<signature>". The payslip number is printed on the slip
 * anyway; the signature is what stops anyone from guessing the next one. The
 * public check looks the payslip up and reports NoLSAF's own figures, so an
 * edited net pay on a printout shows as a mismatch.
 */

const NUMBER = /^PS-[A-Z0-9-]{4,40}$/;

function signature(payslipNumber: string, secret: string) {
  return createHmac("sha256", secret).update(`payslip-verify:${payslipNumber}`).digest().subarray(0, 16).toString("base64url");
}

export function payslipVerificationToken(payslipNumber: string): string {
  return `${payslipNumber}.${signature(payslipNumber, publicLinkSigningSecret("payslip_verification_secret_missing"))}`;
}

/** The payslip number a token vouches for, or null when it was altered. */
export function payslipNumberFromToken(token: string): string | null {
  const value = String(token || "").trim();
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payslipNumber = value.slice(0, dot);
  const supplied = Buffer.from(value.slice(dot + 1), "utf8");
  if (!NUMBER.test(payslipNumber)) return null;
  const ok = publicLinkSecrets().some((secret) => {
    const expected = Buffer.from(signature(payslipNumber, secret), "utf8");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
  return ok ? payslipNumber : null;
}

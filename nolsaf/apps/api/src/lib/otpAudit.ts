// apps/api/src/lib/otpAudit.ts
//
// Audit fields for one-time codes (the No4P OTP log).
//
// A 6-digit code has only a million values, so a bare SHA-256 of it is
// reversed instantly, and its last two digits shrink that to ten thousand.
// Rows written here therefore never carry the code, any part of it, or a
// plain hash of it, and never carry the full phone number or email. SENT and
// USED rows are correlated through a keyed HMAC that cannot be reversed
// without the server secret, which is not in the database.

import crypto from "crypto";
import { normalizeEmailForAuth, normalizePhoneForAuth } from "./authDestination.js";

export type OtpAuditDestinationType = "PHONE" | "EMAIL" | "INTERNAL";

let cachedKey: Buffer | null = null;

function auditKey(): Buffer {
  if (cachedKey) return cachedKey;
  const secret =
    process.env.OTP_AUDIT_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? (process.env.DEV_JWT_SECRET || "dev_jwt_secret") : "");
  if (!secret) throw new Error("OTP_AUDIT_SECRET or JWT_SECRET must be set");
  // Derive a separate key so this HMAC never doubles as a JWT signature.
  cachedKey = crypto.createHash("sha256").update(`nolsaf:otp-audit:v1|${secret}`).digest();
  return cachedKey;
}

function hmac(value: string): string {
  return crypto.createHmac("sha256", auditKey()).update(value).digest("hex").slice(0, 32);
}

function canonicalDestination(type: OtpAuditDestinationType, destination: string): string {
  const raw = String(destination || "").trim();
  if (type === "EMAIL") return raw.toLowerCase();
  if (type === "PHONE") return normalizePhoneForAuth(raw) || raw;
  return raw;
}

/** Stable, non-reversible reference to a destination, for search and correlation. */
export function otpDestinationRef(type: OtpAuditDestinationType, destination: string): string {
  return hmac(`dest|${type}|${canonicalDestination(type, destination)}`);
}

/**
 * AuditLog.entity for an OTP event. The same destination and code give the
 * same entity, so a NO4P_OTP_USED row still matches its NO4P_OTP_SENT row.
 */
export function otpAuditEntity(type: OtpAuditDestinationType, destination: string, code: string): string {
  const dest = canonicalDestination(type, destination);
  return `OTP:${type}:${otpDestinationRef(type, dest)}:${hmac(`code|${type}|${dest}|${String(code ?? "").trim()}`)}`;
}

export function maskOtpDestination(type: OtpAuditDestinationType, destination: string): string {
  const value = String(destination || "").trim();
  if (type === "EMAIL") {
    const [local, domain] = value.split("@");
    if (!domain) return "******";
    return `${local.slice(0, 2)}****@${domain}`;
  }
  if (type === "PHONE") {
    if (value.length <= 4) return "******";
    return `******${value.slice(-4)}`;
  }
  return value ? "internal" : "******";
}

/**
 * Destination fields for an OTP audit row. `destination` holds the masked value
 * so existing admin views keep a readable column without the real number.
 */
export function otpAuditDestinationFields(type: OtpAuditDestinationType, destination: string) {
  const masked = maskOtpDestination(type, destination);
  return {
    destinationType: type,
    destination: masked,
    destinationMasked: masked,
    destinationRef: otpDestinationRef(type, destination),
  };
}

/** Entity search terms an admin query could mean (a phone, an email, or a raw fragment). */
export function otpAuditSearchRefs(query: string): string[] {
  const q = String(query || "").trim();
  if (!q) return [];
  const refs = new Set<string>();
  const email = normalizeEmailForAuth(q);
  if (email) refs.add(`OTP:EMAIL:${otpDestinationRef("EMAIL", email)}:`);
  if (/\d{6,}/.test(q.replace(/[^\d]/g, ""))) {
    refs.add(`OTP:PHONE:${otpDestinationRef("PHONE", q)}:`);
  }
  return [...refs];
}

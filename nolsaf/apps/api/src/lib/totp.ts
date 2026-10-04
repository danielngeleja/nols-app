import crypto from "node:crypto";
import { authenticator } from "otplib";

/*
 * One authenticator (TOTP) verifier for every sign-in and settings path.
 *
 * otplib's default window is 0: a code is accepted only inside its own
 * 30-second step. Any phone whose clock is a few seconds off, or anyone typing
 * a code as it rolls over, was told "invalid". RFC 6238 recommends allowing one
 * step either side for exactly this; replay is still blocked separately by the
 * one-time claim in auth.accountMfa.ts, whose 120-second hold covers the widened
 * validity.
 */

const verifier = authenticator.clone({ window: 1 });

export function verifyTotp(code: unknown, secret: string | null | undefined): boolean {
  if (typeof code !== "string" || !secret) return false;
  const token = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  try {
    return verifier.verify({ token, secret });
  } catch {
    return false;
  }
}

export const BACKUP_CODE_COUNT = 10;

/** Crockford-style alphabet: no 0/O or 1/I/L, so codes survive being written down. */
const BACKUP_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * Backup codes in XXXX-XXXX form from a cryptographically secure source.
 * The previous generator used Math.random, which is predictable.
 */
export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = crypto.randomBytes(8);
    let raw = "";
    for (let i = 0; i < 8; i++) raw += BACKUP_ALPHABET[bytes[i] % BACKUP_ALPHABET.length];
    codes.add(`${raw.slice(0, 4)}-${raw.slice(4)}`);
  }
  return Array.from(codes);
}

/** Backup codes are typed by hand: accept any case and stray spaces. */
export function normaliseBackupCode(code: unknown): string {
  return typeof code === "string" ? code.trim().replace(/\s+/g, "").toUpperCase() : "";
}

/**
 * The spellings to try against stored hashes: exactly as typed first, so a code
 * issued in another format still matches, then the tidied upper-case form.
 */
export function backupCodeCandidates(code: unknown): string[] {
  const typed = typeof code === "string" ? code.trim() : "";
  return Array.from(new Set([typed, normaliseBackupCode(code)].filter(Boolean)));
}

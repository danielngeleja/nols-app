// apps/api/src/lib/driverVerificationCode.ts
//
// The identifier printed on a NoLSAF driver ID card.
//
// A passenger scans or types this before getting into a vehicle, and the public
// check returns the driver's name, photo, plate, and active status. That makes
// the identifier itself the credential: whoever holds it can pull a driver's
// details without logging in.
//
// The previous format was `NLS-<user id>-<year>`, which is to say it was the
// primary key with decoration. Anyone could count upwards and walk the whole
// driver roster out of the public endpoint. The identifier now carries an
// HMAC-derived check segment, so a code cannot be constructed from a guessed id
// without the server secret.
//
// The user id stays visible in the code on purpose: support needs to be able to
// read a card over the phone and find the account, and hiding it would buy
// nothing once the check segment is doing the real work.

import { createHmac, timingSafeEqual } from "crypto";
import { publicLinkSigningSecret } from "./publicLinkSecrets.js";

// Crockford-style alphabet: no I, L, O, or U, so a code read aloud or copied
// off a printed card does not turn into a different valid code.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECK_LENGTH = 8; // 8 × 5 bits = 40 bits of check material.
const VERSION = "v1";

function secret(): string {
  return publicLinkSigningSecret("driver_verification_secret_missing");
}

/** 40 bits of HMAC output rendered in the display alphabet. */
function checkSegment(userId: number, signingSecret: string): string {
  const digest = createHmac("sha256", signingSecret)
    .update(`driver-verification:${VERSION}:${userId}`)
    .digest();

  let out = "";
  for (let i = 0; i < CHECK_LENGTH; i += 1) {
    // One alphabet symbol per byte. Taking the low 5 bits keeps the mapping
    // uniform across the 32-symbol alphabet.
    out += ALPHABET[digest[i] & 0x1f];
  }
  return out;
}

/** The canonical printed form, e.g. `NLS-D-42-K7P2M9QX`. */
export function buildDriverVerificationCode(userId: number): string | null {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return `NLS-D-${userId}-${checkSegment(userId, secret())}`;
}

/**
 * Resolve a submitted code back to a user id, or null.
 *
 * Tolerant about how the code was typed (case, spacing, `/` or `-` separators)
 * because it gets read off a physical card, but strict about the check segment,
 * which is compared in constant time.
 */
export function resolveDriverVerificationCode(raw: string): number | null {
  const text = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[\s/]+/g, "-")
    .replace(/-+/g, "-");

  const match = text.match(/^NLS-D-(\d{1,15})-([0-9A-Z]{8})$/);
  if (!match) return null;

  const userId = Number(match[1]);
  if (!Number.isInteger(userId) || userId <= 0) return null;

  let expected: string;
  try {
    expected = checkSegment(userId, secret());
  } catch {
    return null;
  }

  const submitted = Buffer.from(match[2], "utf8");
  const reference = Buffer.from(expected, "utf8");
  if (submitted.length !== reference.length) return null;
  if (!timingSafeEqual(submitted, reference)) return null;

  return userId;
}

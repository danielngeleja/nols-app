// apps/api/src/lib/referralCode.ts
//
// Referral codes that do not expose database ids.
//
// Codes used to be `CUSTOMER-<id>` / `DRIVER-<id>`. Anyone holding a link could
// read our user count and walk every other account's code by changing a digit.
//
// A code is now a role letter plus the user id run through a keyed 32-bit
// permutation (a four-round Feistel network over HMAC-SHA256) and written in
// Crockford base32, e.g. `C7K2M-9QXA`:
//
//   - Opaque: without the secret the code says nothing about the id, and
//     neighbouring ids produce unrelated codes.
//   - Reversible: registration recovers the id with no lookup table, so there
//     is no migration and every existing account already has a code.
//   - Stable: the same user always gets the same code, so shared links keep
//     working.
//
// Key handling mirrors publicLinkSecrets: an ordered list, newest first. The
// first entry encodes; every entry decodes. Rotating means prepending a new
// secret and keeping the old one for as long as old links should still credit.
//
//   REFERRAL_CODE_SECRET="new-secret,previous-secret"
//
// Legacy `CUSTOMER-<id>` / `DRIVER-<id>` codes are still ACCEPTED at sign-up so
// links already sitting in WhatsApp chats keep crediting, but they are never
// generated again.

import { createHmac } from "node:crypto";

export type ReferralKind = "CUSTOMER" | "DRIVER";
export type ReferralCandidate = { kind: ReferralKind; id: number; legacy: boolean };

/** Crockford base32: no I, L, O or U, so codes survive being read aloud or retyped. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_LENGTH = 7; // 35 bits, enough for any unsigned 32-bit id
const ROUNDS = 4;
const MAX_ID = 0xffffffff;

function referralSecrets(): string[] {
  const configured =
    process.env.REFERRAL_CODE_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "");
  const secrets = String(configured || "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);
  return Array.from(new Set(secrets));
}

function roundFn(secret: string, round: number, half: number): number {
  const digest = createHmac("sha256", secret).update(`nolsaf-referral:${round}:${half}`).digest();
  return digest.readUInt16BE(0);
}

function permute(value: number, secret: string): number {
  let left = (value >>> 16) & 0xffff;
  let right = value & 0xffff;
  for (let round = 0; round < ROUNDS; round++) {
    const next = (left ^ roundFn(secret, round, right)) & 0xffff;
    left = right;
    right = next;
  }
  return ((left << 16) | right) >>> 0;
}

function unpermute(value: number, secret: string): number {
  let left = (value >>> 16) & 0xffff;
  let right = value & 0xffff;
  for (let round = ROUNDS - 1; round >= 0; round--) {
    const previous = (right ^ roundFn(secret, round, left)) & 0xffff;
    right = left;
    left = previous;
  }
  return ((left << 16) | right) >>> 0;
}

function toBase32(value: number): string {
  let out = "";
  let rest = value;
  for (let i = 0; i < BODY_LENGTH; i++) {
    out = ALPHABET[rest % 32] + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function fromBase32(body: string): number | null {
  let value = 0;
  for (const char of body) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) return null;
    value = value * 32 + digit;
  }
  return value;
}

/** Normalise what a person might type: case, spaces, dashes, and Crockford look-alikes. */
function normalise(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** The shareable code for a user. Throws only when no secret is configured in production. */
export function referralCodeFor(kind: ReferralKind, userId: number): string {
  const [secret] = referralSecrets();
  if (!secret) throw new Error("REFERRAL_CODE_SECRET_MISSING");
  if (!Number.isInteger(userId) || userId < 1 || userId > MAX_ID) throw new Error("REFERRAL_CODE_INVALID_ID");
  const body = toBase32(permute(userId, secret));
  return `${kind === "DRIVER" ? "D" : "C"}${body.slice(0, 4)}-${body.slice(4)}`;
}

export function referralKindForRole(role: string | null | undefined): ReferralKind {
  return String(role || "").toUpperCase() === "DRIVER" ? "DRIVER" : "CUSTOMER";
}

/**
 * Every user a code could belong to, most likely first.
 *
 * More than one candidate only exists while an old secret is still configured
 * for rotation; the caller checks each against the database and keeps the first
 * real account.
 */
export function referralCandidates(code: string | null | undefined): ReferralCandidate[] {
  const raw = String(code || "").trim();
  if (!raw) return [];

  const legacy = raw.match(/^(DRIVER|CUSTOMER)-(\d{1,10})$/i);
  if (legacy) {
    const id = Number(legacy[2]);
    return id >= 1 && id <= MAX_ID ? [{ kind: legacy[1].toUpperCase() as ReferralKind, id, legacy: true }] : [];
  }

  const compact = normalise(raw);
  if (compact.length !== BODY_LENGTH + 1) return [];
  const kind: ReferralKind | null = compact[0] === "D" ? "DRIVER" : compact[0] === "C" ? "CUSTOMER" : null;
  if (!kind) return [];
  const value = fromBase32(compact.slice(1));
  if (value === null || value > MAX_ID) return [];

  const seen = new Set<number>();
  const candidates: ReferralCandidate[] = [];
  for (const secret of referralSecrets()) {
    const id = unpermute(value, secret);
    if (id >= 1 && !seen.has(id)) {
      seen.add(id);
      candidates.push({ kind, id, legacy: false });
    }
  }
  return candidates;
}

/** Every code string a user's referrals may have been stored under (new and legacy). */
export function storedReferralCodesFor(kind: ReferralKind, userId: number): string[] {
  return [referralCodeFor(kind, userId), `${kind}-${userId}`];
}

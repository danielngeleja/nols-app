/**
 * Sales partner ID cards.
 *
 * A partner shows the card (or sends it) to a property owner, who scans the QR
 * code or types the card code, and NoLSAF answers live: is this a current
 * NoLSAF sales partner, and is this their photo and name?
 *
 * Security model
 * - The QR link token is HMAC(server secret, card id + per-card salt). The
 *   database alone cannot produce it, and only its SHA-256 hash is stored, so a
 *   leaked table cannot be turned into working links.
 * - The typed code is the card number plus an 8-character HMAC check segment
 *   (same alphabet as driver cards: no I, L, O or U, so it reads aloud safely).
 * - Validity is decided at every check, never printed: card ACTIVE and not
 *   expired, partner ACTIVE, contract current. Revoking or replacing a card
 *   kills its link at once.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { publicLinkSigningSecret } from "./publicLinkSecrets.js";
import { CONTRACT_EARNING_STATUSES } from "./salesPartner.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CHECK_LENGTH = 8;
const VERSION = "v1";
/** A card lasts as long as the contract, and never more than a year. */
export const MAX_CARD_DAYS = 365;

function secret(): string {
  return publicLinkSigningSecret("sales_card_secret_missing");
}

export function newCardSalt(): string {
  return randomBytes(16).toString("hex");
}

/** The token inside the QR link. Recomputed when needed, never stored. */
export function cardToken(card: { id: number; salt: string }): string {
  return createHmac("sha256", secret()).update(`sales-card:${VERSION}:${card.id}:${card.salt}`).digest("base64url");
}

export function hashCardToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}

function checkSegment(card: { id: number; salt: string }): string {
  const digest = createHmac("sha256", secret()).update(`sales-card-code:${VERSION}:${card.id}:${card.salt}`).digest();
  let out = "";
  for (let i = 0; i < CHECK_LENGTH; i += 1) out += ALPHABET[digest[i] & 0x1f];
  return out;
}

/** What an owner can type: e.g. "NSA-DAR-0001-C1-K7P2M9QX". */
export function cardCode(card: { id: number; salt: string; cardNumber: string }): string {
  return `${card.cardNumber}-${checkSegment(card)}`;
}

/** Split a typed code into card number and check segment; tolerant of case and spacing. */
export function parseCardCode(raw: string): { cardNumber: string; check: string } | null {
  const text = String(raw || "").trim().toUpperCase().replace(/[\s/]+/g, "-").replace(/-+/g, "-");
  const match = text.match(/^([A-Z0-9-]{3,40})-([0-9A-Z]{8})$/);
  return match ? { cardNumber: match[1], check: match[2] } : null;
}

export function checkSegmentMatches(card: { id: number; salt: string }, submitted: string): boolean {
  let expected: string;
  try {
    expected = checkSegment(card);
  } catch {
    return false;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(String(submitted || "").toUpperCase());
  return a.length === b.length && timingSafeEqual(a, b);
}

export function webOrigin(): string {
  const candidate = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.APP_URL || "https://www.nolsaf.com";
  try {
    return new URL(candidate).origin;
  } catch {
    return "https://www.nolsaf.com";
  }
}

export function cardVerifyUrl(token: string): string {
  return `${webOrigin()}/verify/sales/${encodeURIComponent(token)}`;
}

/**
 * Photo review: a new card (first card, or a replacement with a new photo)
 * starts as PENDING_REVIEW and only becomes ACTIVE once an admin confirms the
 * photo is a clear face of this person. A replacement leaves the current
 * ACTIVE card working until then. A rejected photo ends as PHOTO_REJECTED.
 */
export const CARD_PENDING_REVIEW = "PENDING_REVIEW";
export const CARD_PHOTO_REJECTED = "PHOTO_REJECTED";

export type CardValidity = "VALID" | "REVOKED" | "REPLACED" | "EXPIRED" | "PARTNER_INACTIVE" | "NO_CONTRACT" | "PHOTO_REVIEW" | "PHOTO_REJECTED";

export const CARD_VALIDITY_TEXT: Record<CardValidity, string> = {
  VALID: "This person is an authorised NoLSAF sales representative.",
  PHOTO_REVIEW: "This card is waiting for NoLSAF to check the photo. It is not active yet, so do not rely on it.",
  PHOTO_REJECTED: "NoLSAF did not approve this card. Do not deal with this person on NoLSAF's behalf.",
  REVOKED: "This card was cancelled by NoLSAF. Do not deal with this person on NoLSAF's behalf.",
  REPLACED: "This card was replaced by a newer one. Ask the representative for their current card.",
  EXPIRED: "This card has expired.",
  PARTNER_INACTIVE: "This person is not an active NoLSAF representative.",
  NO_CONTRACT: "This person has no current agreement with NoLSAF.",
};

/** Decided live at every check. */
export function cardValidity(input: {
  card: { status: string; expiresAt: Date };
  partnerStatus: string;
  contracts: Array<{ status: string; startsAt: Date; expiresAt: Date }>;
  now?: Date;
}): CardValidity {
  const now = input.now ?? new Date();
  if (input.card.status === "REVOKED") return "REVOKED";
  if (input.card.status === "REPLACED") return "REPLACED";
  if (input.card.status === CARD_PENDING_REVIEW) return "PHOTO_REVIEW";
  if (input.card.status === CARD_PHOTO_REJECTED) return "PHOTO_REJECTED";
  if (input.card.status !== "ACTIVE") return "REVOKED";
  if (input.card.expiresAt <= now) return "EXPIRED";
  if (input.partnerStatus !== "ACTIVE") return "PARTNER_INACTIVE";
  const current = input.contracts.some(
    (c) => (CONTRACT_EARNING_STATUSES as readonly string[]).includes(c.status) && c.startsAt <= now && c.expiresAt > now,
  );
  return current ? "VALID" : "NO_CONTRACT";
}

/** The earliest of the contract end and one year from now. */
export function cardExpiry(contractExpiresAt: Date, now = new Date()): Date {
  const cap = new Date(now.getTime() + MAX_CARD_DAYS * 24 * 60 * 60 * 1000);
  return contractExpiresAt < cap ? contractExpiresAt : cap;
}

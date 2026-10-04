// apps/api/src/lib/newsletter.ts
//
// Pure helpers for the footer newsletter (double opt-in). Kept free of Express
// and Prisma so the rules are easy to test.

import { createHash, randomBytes } from "node:crypto";

export const NEWSLETTER_STATUS = {
  PENDING: "PENDING",
  SUBSCRIBED: "SUBSCRIBED",
  UNSUBSCRIBED: "UNSUBSCRIBED",
} as const;

/** How long a confirmation link stays valid. */
export const CONFIRM_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

/** Minimum gap between confirmation emails to the same address. */
export const CONFIRMATION_RESEND_GAP_MS = 10 * 60 * 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Lower-cased, trimmed address, or null when it is not a plausible email. */
export function normaliseNewsletterEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  return EMAIL_RE.test(email) ? email : null;
}

export function newToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A 64-hex-character token, the only shape we ever issue. */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
}

/**
 * Whether a new confirmation email may go out now.
 * Already-subscribed addresses never get one (the response stays identical,
 * so the endpoint does not reveal who is on the list).
 */
export function shouldSendConfirmation(input: {
  status: string | null | undefined;
  lastConfirmationSentAt: Date | null | undefined;
  now?: Date;
}): boolean {
  if (input.status === NEWSLETTER_STATUS.SUBSCRIBED) return false;
  if (!input.lastConfirmationSentAt) return true;
  const now = input.now ?? new Date();
  return now.getTime() - input.lastConfirmationSentAt.getTime() >= CONFIRMATION_RESEND_GAP_MS;
}

/** RFC 4180 CSV cell: quote everything, double inner quotes, neutralise spreadsheet formulas. */
export function csvCell(value: unknown): string {
  let text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

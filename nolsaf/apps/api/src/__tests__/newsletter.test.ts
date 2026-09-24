import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_RESEND_GAP_MS,
  NEWSLETTER_STATUS,
  csvCell,
  hashToken,
  isWellFormedToken,
  newToken,
  normaliseNewsletterEmail,
  shouldSendConfirmation,
} from "../lib/newsletter.js";

describe("newsletter helpers", () => {
  it("normalises and validates emails", () => {
    expect(normaliseNewsletterEmail("  Daniel@NoLSAF.com ")).toBe("daniel@nolsaf.com");
    for (const bad of ["", "no-at-sign", "a@b", "a b@c.com", 42, null, `${"x".repeat(250)}@a.com`]) {
      expect(normaliseNewsletterEmail(bad)).toBeNull();
    }
  });

  it("issues 64-hex tokens and hashes them one-way", () => {
    const token = newToken();
    expect(isWellFormedToken(token)).toBe(true);
    expect(hashToken(token)).toHaveLength(64);
    expect(hashToken(token)).not.toBe(token);
    expect(isWellFormedToken("../../etc")).toBe(false);
    expect(isWellFormedToken(undefined)).toBe(false);
  });

  it("never resends to confirmed subscribers and throttles repeats", () => {
    const now = new Date("2026-09-17T10:00:00Z");
    expect(shouldSendConfirmation({ status: NEWSLETTER_STATUS.SUBSCRIBED, lastConfirmationSentAt: null, now })).toBe(false);
    expect(shouldSendConfirmation({ status: undefined, lastConfirmationSentAt: undefined, now })).toBe(true);
    const justSent = new Date(now.getTime() - 60_000);
    expect(shouldSendConfirmation({ status: NEWSLETTER_STATUS.PENDING, lastConfirmationSentAt: justSent, now })).toBe(false);
    const longAgo = new Date(now.getTime() - CONFIRMATION_RESEND_GAP_MS);
    expect(shouldSendConfirmation({ status: NEWSLETTER_STATUS.PENDING, lastConfirmationSentAt: longAgo, now })).toBe(true);
    expect(shouldSendConfirmation({ status: NEWSLETTER_STATUS.UNSUBSCRIBED, lastConfirmationSentAt: longAgo, now })).toBe(true);
  });

  it("writes CSV cells that are quoted and formula-safe", () => {
    expect(csvCell('a"b')).toBe('"a""b"');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell(new Date("2026-09-17T00:00:00Z"))).toBe('"2026-09-17T00:00:00.000Z"');
  });
});

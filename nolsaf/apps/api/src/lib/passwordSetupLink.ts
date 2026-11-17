// =============================================================================
// Password setup and reset links: one place for how they are made and checked.
//
//  - The link carries only a random 192-bit token. Never the user's row id and
//    never their email or phone: links end up in mail logs, browser history
//    and referrer headers.
//  - Only the SHA-256 of the token is stored (User.resetPasswordToken), with an
//    expiry. Using it clears it, so a link works once.
//  - Links sent before this change also carried &id=; the reset endpoint still
//    accepts that form so nobody's pending link breaks.
// =============================================================================

import crypto from "node:crypto";
import { prisma } from "@nolsaf/prisma";

export const ONBOARDING_SETUP_HOURS = 72;

export function hashResetToken(raw: string): string {
  return crypto.createHash("sha256").update(String(raw)).digest("hex");
}

/** Constant-time comparison of two stored token hashes. */
export function sameTokenHash(a: string, b: string): boolean {
  const left = Buffer.from(String(a || ""), "utf8");
  const right = Buffer.from(String(b || ""), "utf8");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

/** Creates a fresh token for a user, replacing any earlier one, and returns the raw value. */
export async function issuePasswordSetupToken(userId: number, hours: number): Promise<{ raw: string; expiresAt: Date }> {
  const raw = crypto.randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  await prisma.user.update({
    where: { id: userId },
    data: { resetPasswordToken: hashResetToken(raw), resetPasswordExpires: expiresAt } as any,
    select: { id: true },
  });
  return { raw, expiresAt };
}

/** The link the user opens. Only the token; `onboarding` changes the page's wording. */
export function passwordSetupLink(origin: string, raw: string, opts: { onboarding?: boolean; next?: string } = {}): string {
  const params = new URLSearchParams({ token: raw });
  if (opts.onboarding) params.set("reason", "onboarding");
  if (opts.next && opts.next.startsWith("/") && !opts.next.startsWith("//")) params.set("next", opts.next);
  return `${String(origin).replace(/\/+$/, "")}/account/reset-password?${params.toString()}`;
}

/** The user a token belongs to, found by its hash. */
export async function findUserByResetToken(raw: string) {
  const hashed = hashResetToken(raw);
  if (!/^[a-f0-9]{48}$/i.test(String(raw || ""))) return null;
  return prisma.user.findFirst({ where: { resetPasswordToken: hashed } as any });
}

/** Shows enough of an email or phone for the owner to recognise it, without giving it away. */
export function maskLogin(value: string | null | undefined): string {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.includes("@")) {
    const [name, domain] = v.split("@");
    return `${name.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, name.length - 2)))}@${domain}`;
  }
  return v.length > 4 ? `${"•".repeat(v.length - 4)}${v.slice(-4)}` : v;
}

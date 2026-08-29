// apps/api/src/lib/publicLinkSecrets.ts
//
// Signing material for public, no-login verification links.
//
// Every printed artefact NoLSAF issues (report seals, payout receipts, property
// and operator certificates, driver ID cards) is checked by signature alone,
// often long after it was printed. That makes rotation the hard problem: with a
// single secret, changing it invalidates every document ever issued, all at
// once, and there is no way to retire a possibly-leaked key without doing that.
//
// So the secret is read as an ordered list. The first entry signs; every entry
// verifies. To rotate: prepend the new secret, deploy, and drop the old entry
// once documents signed with it have aged out.
//
//   PUBLIC_LINK_TOKEN_SECRET="new-secret,previous-secret"
//
// A single value behaves exactly as it did before this file existed, so nothing
// needs to change at deploy time to keep working.

import jwt, { type Algorithm, type VerifyOptions } from "jsonwebtoken";

/**
 * Ordered signing material, newest first.
 *
 * The JWT_SECRET fallback is kept for continuity with tokens already in the
 * wild, but it is worth moving off: sharing key material between session auth
 * and a public signing surface means one compromise costs both.
 */
export function publicLinkSecrets(): string[] {
  const configured =
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "");

  const secrets = String(configured || "")
    .split(",")
    .map((secret) => secret.trim())
    .filter(Boolean);

  return Array.from(new Set(secrets));
}

/** The secret new tokens are signed with. Always the first configured entry. */
export function publicLinkSigningSecret(missingErrorCode: string): string {
  const [secret] = publicLinkSecrets();
  if (!secret) throw new Error(missingErrorCode);
  return secret;
}

/**
 * Verify against every configured secret, newest first.
 *
 * Returns null rather than throwing so callers keep their "render a clean
 * could-not-verify state" behaviour instead of leaking a 500 to the public.
 */
export function verifyWithAnyPublicLinkSecret<T>(
  token: string,
  options: VerifyOptions & { algorithms: Algorithm[] },
): T | null {
  for (const secret of publicLinkSecrets()) {
    try {
      return jwt.verify(token, secret, options) as T;
    } catch {
      // Try the next secret. A token signed with a retired key is still valid
      // during its overlap window.
    }
  }
  return null;
}

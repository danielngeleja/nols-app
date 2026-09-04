/**
 * The merchant payment policy an owner must accept before onboarding.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * The design record requires acceptance evidence tied to the exact terms the
 * owner saw, including an immutable content hash, because a stored boolean
 * cannot prove WHICH version was accepted and that is the only thing that
 * matters if the commercial terms are ever disputed.
 *
 * So the hash is computed from the policy file at runtime rather than being a
 * value someone typed. A hash that is written by hand is not evidence: it
 * proves only that somebody wrote it, and it silently stops matching the
 * document the moment the document is edited.
 *
 * Everything here fails closed. If the policy is not configured, or the file
 * is unreadable, no acceptance can be recorded and therefore no application
 * can be submitted. That is the correct outcome: an owner cannot consent to
 * terms the system is unable to show them.
 */

import { readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";

export type MerchantPolicy = {
  policyId: string;
  policyVersion: string;
  contentHash: string;
  content: string;
};

export type PolicyResult =
  | { ok: true; policy: MerchantPolicy }
  | { ok: false; code: "policy_not_configured" | "policy_unreadable"; message: string };

type CacheEntry = { mtimeMs: number; size: number; policy: MerchantPolicy };

const cache = new Map<string, CacheEntry>();

/**
 * Loads the active policy.
 *
 * Cached against the file's mtime and size, so editing the document during
 * development produces a new hash on the next request without a restart, while
 * a steady-state request does not re-read the file every time.
 */
export function loadMerchantPolicy(env: NodeJS.ProcessEnv = process.env): PolicyResult {
  const path = env.PAYMENTS_MERCHANT_POLICY_PATH;
  const policyId = env.PAYMENTS_MERCHANT_POLICY_ID;
  const policyVersion = env.PAYMENTS_MERCHANT_POLICY_VERSION;

  if (!path || !policyId || !policyVersion) {
    return {
      ok: false,
      code: "policy_not_configured",
      message: "The merchant payment policy is not available.",
    };
  }

  try {
    const stat = statSync(path);
    const cacheKey = `${path}:${policyId}:${policyVersion}`;
    const cached = cache.get(cacheKey);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return { ok: true, policy: cached.policy };
    }

    const content = readFileSync(path, "utf8");
    const policy: MerchantPolicy = {
      policyId,
      policyVersion,
      // Bound to the version string as well as the bytes, so republishing
      // identical text under a new version is still a distinct acceptance.
      contentHash: createHash("sha256")
        .update(`${policyId}\n${policyVersion}\n${content}`, "utf8")
        .digest("hex"),
      content,
    };

    cache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size, policy });
    return { ok: true, policy };
  } catch {
    return {
      ok: false,
      code: "policy_unreadable",
      message: "The merchant payment policy is not available.",
    };
  }
}

/**
 * Confirms the version the client says it displayed is still the current one.
 *
 * The client never supplies the hash. It states which version it showed the
 * owner, and the server decides whether that is still current, so an owner
 * cannot be recorded as accepting terms that were superseded while the page
 * sat open.
 */
export function checkAcceptedVersion(
  policy: MerchantPolicy,
  acceptedVersion: string
): { ok: true } | { ok: false; code: "policy_version_stale"; message: string } {
  if (acceptedVersion !== policy.policyVersion) {
    return {
      ok: false,
      code: "policy_version_stale",
      message: "The payment policy has been updated. Review the new version and accept it again.",
    };
  }
  return { ok: true };
}

/** Test seam. Clears the mtime cache. */
export function resetPolicyCache(): void {
  cache.clear();
}

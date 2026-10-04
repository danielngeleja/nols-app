import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { checkAcceptedVersion, loadMerchantPolicy, resetPolicyCache } from "./policy.js";

const dir = mkdtempSync(join(tmpdir(), "nolsaf-policy-"));
const policyPath = join(dir, "merchant-policy.md");

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    PAYMENTS_MERCHANT_POLICY_PATH: policyPath,
    PAYMENTS_MERCHANT_POLICY_ID: "merchant-payments",
    PAYMENTS_MERCHANT_POLICY_VERSION: "1.0",
    ...overrides,
  } as NodeJS.ProcessEnv;
}

beforeEach(() => {
  resetPolicyCache();
  writeFileSync(policyPath, "Original terms.\n", "utf8");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("policy loading fails closed", () => {
  it("refuses when the path is not configured", () => {
    expect(loadMerchantPolicy(env({ PAYMENTS_MERCHANT_POLICY_PATH: undefined }))).toMatchObject({
      ok: false,
      code: "policy_not_configured",
    });
  });

  it("refuses when the version is not configured", () => {
    expect(loadMerchantPolicy(env({ PAYMENTS_MERCHANT_POLICY_VERSION: undefined }))).toMatchObject({
      ok: false,
      code: "policy_not_configured",
    });
  });

  it("refuses when the file does not exist", () => {
    expect(
      loadMerchantPolicy(env({ PAYMENTS_MERCHANT_POLICY_PATH: join(dir, "absent.md") }))
    ).toMatchObject({ ok: false, code: "policy_unreadable" });
  });

  it("never leaks the configured path in the message", () => {
    const result = loadMerchantPolicy(env({ PAYMENTS_MERCHANT_POLICY_PATH: undefined }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain(dir);
  });
});

describe("the hash is derived, never declared", () => {
  it("changes when the document text changes", () => {
    const before = loadMerchantPolicy(env());
    expect(before.ok).toBe(true);

    resetPolicyCache();
    writeFileSync(policyPath, "Amended terms.\n", "utf8");
    const after = loadMerchantPolicy(env());

    expect(after.ok).toBe(true);
    if (before.ok && after.ok) {
      expect(after.policy.contentHash).not.toBe(before.policy.contentHash);
    }
  });

  it("changes when only the version changes, for identical text", () => {
    // Republishing the same words under a new version must still be a
    // distinct acceptance.
    const v1 = loadMerchantPolicy(env({ PAYMENTS_MERCHANT_POLICY_VERSION: "1.0" }));
    const v2 = loadMerchantPolicy(env({ PAYMENTS_MERCHANT_POLICY_VERSION: "2.0" }));
    expect(v1.ok && v2.ok).toBe(true);
    if (v1.ok && v2.ok) expect(v1.policy.contentHash).not.toBe(v2.policy.contentHash);
  });

  it("is stable for unchanged content", () => {
    const first = loadMerchantPolicy(env());
    resetPolicyCache();
    const second = loadMerchantPolicy(env());
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.policy.contentHash).toBe(second.policy.contentHash);
    }
  });
});

describe("accepted version check", () => {
  it("rejects acceptance of a superseded version", () => {
    const policy = loadMerchantPolicy(env());
    expect(policy.ok).toBe(true);
    if (!policy.ok) return;

    // The page sat open while the terms changed.
    expect(checkAcceptedVersion(policy.policy, "0.9")).toMatchObject({
      ok: false,
      code: "policy_version_stale",
    });
    expect(checkAcceptedVersion(policy.policy, "1.0")).toEqual({ ok: true });
  });
});

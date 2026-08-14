import { describe, expect, it } from "vitest";
import { computeBatchFingerprint, type BatchFingerprintMember } from "../services/payouts/fingerprint";
import { isAfterHours, scoreLevel, type RiskFlag } from "../services/payouts/riskScoring";
import { isWebhookIpAllowed } from "../routes/webhooks.payments";
import { describeSelfRelease } from "../services/payouts/batching";
import { releaseChallengePurpose } from "../services/payouts/releaseChallenge";

function member(overrides: Partial<BatchFingerprintMember> = {}): BatchFingerprintMember {
  return {
    externalReferenceId: "NoLSAF-O-2608081645-D51QVX",
    amount: "150000.00",
    currency: "TZS",
    provider: "azampesa",
    accountNumber: "255700000001",
    accountName: "ASHA MTUMWA",
    ...overrides,
  };
}

describe("batch fingerprint", () => {
  it("detects a swapped destination account number", () => {
    // The regression this exists for: the fingerprint used to hash
    // payoutAccountId instead of the account number, so redirecting the money
    // between batch formation and release left the hash unchanged while
    // submitToAzamPay read the new destination from the live account.
    const before = computeBatchFingerprint([member()]);
    const after = computeBatchFingerprint([member({ accountNumber: "255700000999" })]);
    expect(after).not.toBe(before);
  });

  it("detects a swapped account name and a changed amount", () => {
    const before = computeBatchFingerprint([member()]);
    expect(computeBatchFingerprint([member({ accountName: "SOMEONE ELSE" })])).not.toBe(before);
    expect(computeBatchFingerprint([member({ amount: "150000.01" })])).not.toBe(before);
  });

  it("is stable across member ordering but not across membership", () => {
    const a = member();
    const b = member({ externalReferenceId: "NoLSAF-T-2608081645-AAAAAA", accountNumber: "255700000002" });
    expect(computeBatchFingerprint([a, b])).toBe(computeBatchFingerprint([b, a]));
    expect(computeBatchFingerprint([a])).not.toBe(computeBatchFingerprint([a, b]));
  });
});

describe("payout risk scoring", () => {
  const flags = (...list: RiskFlag[]) => list;

  it("treats a first payout to a genuinely new partner as reviewable, not blocking", () => {
    // A brand-new payout account is always "recently changed" and always the
    // first payout to that beneficiary. Scoring that CRITICAL made the
    // security queue the normal onboarding path, which trains staff to clear
    // it reflexively.
    expect(scoreLevel(flags("RECENT_ACCOUNT_CHANGE", "FIRST_PAYOUT_TO_BENEFICIARY"))).toBe("MEDIUM");
    expect(scoreLevel(flags("RECENT_ACCOUNT_CHANGE", "FIRST_PAYOUT_TO_BENEFICIARY", "AFTER_HOURS_APPROVAL"))).toBe("MEDIUM");
  });

  it("blocks the account-takeover pattern", () => {
    // Established payee, already paid elsewhere, destination just changed.
    expect(scoreLevel(flags("RECENT_ACCOUNT_CHANGE", "PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE"))).toBe("CRITICAL");
    expect(scoreLevel(flags("RECENT_ACCOUNT_CHANGE", "ACCOUNT_SHARED_ACROSS_PARTNERS"))).toBe("CRITICAL");
  });

  it("blocks mule and probing shapes on their own", () => {
    expect(scoreLevel(flags("ACCOUNT_SHARED_ACROSS_PARTNERS"))).toBe("HIGH");
    expect(scoreLevel(flags("REPEATED_RECENT_FAILURES"))).toBe("HIGH");
    expect(scoreLevel(flags("RECENT_ACCOUNT_CHANGE", "AMOUNT_ABOVE_NORMAL_RANGE"))).toBe("HIGH");
  });

  it("scores a clean payout LOW", () => {
    expect(scoreLevel([])).toBe("LOW");
  });

  it("reads business hours in the payout timezone, not the host's", () => {
    // 23:30 UTC is 02:30 in Dar es Salaam: after hours either way.
    expect(isAfterHours(new Date("2026-08-08T23:30:00.000Z"), "Africa/Dar_es_Salaam")).toBe(true);
    // 04:00 UTC is 07:00 EAT: the start of a normal working day, and exactly
    // the window a UTC-based check used to flag.
    expect(isAfterHours(new Date("2026-08-08T04:00:00.000Z"), "Africa/Dar_es_Salaam")).toBe(false);
    // 20:00 UTC is 23:00 EAT: genuinely after hours, and exactly the window a
    // UTC-based check used to miss.
    expect(isAfterHours(new Date("2026-08-08T20:00:00.000Z"), "Africa/Dar_es_Salaam")).toBe(true);
  });
});

describe("batch release authority", () => {
  const batch = (formedById: number | null, approvers: Array<number | null>) => ({
    id: 7,
    formedById,
    items: approvers.map((approvedById, index) => ({ id: index + 1, approvedById })),
  });

  it("treats a genuinely independent authorizer as two-person release", () => {
    const result = describeSelfRelease(batch(2, [3, 3]), 9);
    expect(result.isSelfRelease).toBe(false);
    expect(result.approvedByActor).toEqual([]);
  });

  it("flags the authorizer who formed the batch", () => {
    expect(describeSelfRelease(batch(9, [3]), 9).formedByActor).toBe(true);
    expect(describeSelfRelease(batch(9, [3]), 9).isSelfRelease).toBe(true);
  });

  it("flags the authorizer who approved any member, naming which", () => {
    const result = describeSelfRelease(batch(2, [3, 9, 9]), 9);
    expect(result.formedByActor).toBe(false);
    expect(result.isSelfRelease).toBe(true);
    expect(result.approvedByActor).toEqual([2, 3]);
  });
});

describe("release challenge binding", () => {
  const fingerprint = "a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4e5f67890";

  it("binds a code to one batch, so a code cannot be spent on another", () => {
    expect(releaseChallengePurpose(7, fingerprint)).not.toBe(releaseChallengePurpose(8, fingerprint));
  });

  it("invalidates outstanding codes when the batch contents change", () => {
    // The fingerprint covers every member's amount and destination, so a code
    // harvested against a small batch cannot be spent on a larger one.
    const changed = `ffffffffffff${fingerprint.slice(12)}`;
    expect(releaseChallengePurpose(7, changed)).not.toBe(releaseChallengePurpose(7, fingerprint));
  });

  it("stays inside the AdminOtp.purpose column width", () => {
    expect(releaseChallengePurpose(2147483647, fingerprint).length).toBeLessThanOrEqual(60);
  });
});

describe("webhook ip allowlist", () => {
  it("still matches exact addresses", () => {
    expect(isWebhookIpAllowed("196.192.10.4", ["196.192.10.4"])).toBe(true);
    expect(isWebhookIpAllowed("196.192.10.5", ["196.192.10.4"])).toBe(false);
  });

  it("strips the IPv4-mapped IPv6 prefix", () => {
    expect(isWebhookIpAllowed("::ffff:196.192.10.4", ["196.192.10.4"])).toBe(true);
  });

  it("matches CIDR ranges so operators are not pushed into disabling the list", () => {
    expect(isWebhookIpAllowed("196.192.10.4", ["196.192.0.0/16"])).toBe(true);
    expect(isWebhookIpAllowed("196.193.10.4", ["196.192.0.0/16"])).toBe(false);
    expect(isWebhookIpAllowed("10.0.0.7", ["10.0.0.0/24"])).toBe(true);
    expect(isWebhookIpAllowed("10.0.1.7", ["10.0.0.0/24"])).toBe(false);
  });

  it("rejects malformed entries and addresses rather than matching loosely", () => {
    expect(isWebhookIpAllowed("196.192.10.4", ["196.192.0.0/33"])).toBe(false);
    expect(isWebhookIpAllowed("196.192.10.4", ["not-an-ip/16"])).toBe(false);
    expect(isWebhookIpAllowed("999.1.1.1", ["999.0.0.0/8"])).toBe(false);
  });
});

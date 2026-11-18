import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { disbursementFindFirst, userFindUnique, passkeyCount } = vi.hoisted(() => ({
  disbursementFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  passkeyCount: vi.fn(),
}));
vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    disbursement: { findFirst: disbursementFindFirst },
    user: { findUnique: userFindUnique },
    passkey: { count: passkeyCount },
  },
}));

import {
  OwnerMfaRequiredError,
  assertOwnerStrongSession,
  ownerMfaState,
  ownerWeakSignInOutcome,
} from "./ownerMfaPolicy.js";
import { ownerMfaSetupAllows } from "../middleware/auth.js";

const owner = { id: 5, role: "OWNER" as const };
const now = new Date("2026-12-20T09:00:00Z");
const NO_TOTP = { twoFactorEnabled: false, twoFactorMethod: null, totpSecretEnc: null };
const TOTP = { twoFactorEnabled: true, twoFactorMethod: "TOTP", totpSecretEnc: "enc" };

function given(opts: { paidAt?: Date | null; totp?: boolean; passkeys?: number }) {
  disbursementFindFirst.mockResolvedValue(opts.paidAt === null ? null : { paidAt: opts.paidAt ?? new Date("2026-10-01T00:00:00Z"), updatedAt: new Date() });
  userFindUnique.mockResolvedValue(opts.totp ? TOTP : NO_TOTP);
  passkeyCount.mockResolvedValue(opts.passkeys ?? 0);
}

describe("owner MFA policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OWNER_MFA_POLICY_START = "2026-12-01T00:00:00+03:00";
  });
  afterEach(() => { delete process.env.OWNER_MFA_POLICY_START; });

  it("is off when the start date is unset, for non-owners, and for unpaid owners", async () => {
    delete process.env.OWNER_MFA_POLICY_START;
    given({});
    expect((await ownerMfaState(owner, now)).required).toBe(false);

    process.env.OWNER_MFA_POLICY_START = "2026-12-01T00:00:00+03:00";
    expect((await ownerMfaState({ id: 5, role: "CUSTOMER" }, now)).required).toBe(false);

    given({ paidAt: null });
    expect((await ownerMfaState(owner, now)).required).toBe(false);
  });

  it("runs 14 days of grace from the later of the start date and the first payout", async () => {
    given({ paidAt: new Date("2026-10-01T00:00:00Z") });
    const early = await ownerMfaState(owner, new Date("2026-12-10T00:00:00Z"));
    expect(early.required).toBe(true);
    expect(early.graceEndsAt?.toISOString()).toBe("2026-12-14T21:00:00.000Z");
    expect(early.signInEnforced).toBe(false);

    given({ paidAt: new Date("2026-12-18T00:00:00Z") });
    const late = await ownerMfaState(owner, now);
    expect(late.graceEndsAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(late.signInEnforced).toBe(false);
  });

  it("decides weak sign-ins after grace: passkey owners use it, others get setup only", async () => {
    given({ passkeys: 0 });
    expect(await ownerWeakSignInOutcome(owner, now)).toBe("SETUP_ONLY");
    given({ passkeys: 2 });
    expect(await ownerWeakSignInOutcome(owner, now)).toBe("PASSKEY_REQUIRED");
    given({ totp: true });
    expect(await ownerWeakSignInOutcome(owner, now)).toBe("FULL");
    given({ passkeys: 0 });
    expect(await ownerWeakSignInOutcome(owner, new Date("2026-12-05T00:00:00Z"))).toBe("FULL");
  });

  it("needs a strong session for money actions from day one, even inside grace", async () => {
    const inGrace = new Date("2026-12-05T00:00:00Z");
    given({ passkeys: 0 });
    await expect(assertOwnerStrongSession({ ...owner, strongAuth: false }, inGrace)).rejects.toMatchObject({ code: "OWNER_MFA_SETUP_REQUIRED" });
    given({ passkeys: 1 });
    await expect(assertOwnerStrongSession({ ...owner, strongAuth: false }, inGrace)).rejects.toBeInstanceOf(OwnerMfaRequiredError);
    await expect(assertOwnerStrongSession({ ...owner, strongAuth: true }, inGrace)).resolves.toBeUndefined();
    given({ paidAt: null });
    await expect(assertOwnerStrongSession({ ...owner, strongAuth: false }, inGrace)).resolves.toBeUndefined();
  });
});

describe("setup-only session allowlist", () => {
  it("allows only adding a passkey or authenticator, the status check and sign-out", () => {
    expect(ownerMfaSetupAllows("POST", "/api/account/security/passkeys")).toBe(true);
    expect(ownerMfaSetupAllows("POST", "/api/account/security/passkeys/verify/")).toBe(true);
    expect(ownerMfaSetupAllows("POST", "/api/account/2fa/totp/verify")).toBe(true);
    expect(ownerMfaSetupAllows("GET", "/api/auth/owner-mfa/status")).toBe(true);
    expect(ownerMfaSetupAllows("GET", "/api/owner/bookings")).toBe(false);
    expect(ownerMfaSetupAllows("POST", "/api/account/2fa/sms/send")).toBe(false);
    expect(ownerMfaSetupAllows("DELETE", "/api/account/security/passkeys/abc")).toBe(false);
    expect(ownerMfaSetupAllows("POST", "/api/owner/payouts/withdraw/challenge")).toBe(false);
  });
});

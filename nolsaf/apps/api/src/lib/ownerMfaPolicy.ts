/**
 * Owner MFA policy (decided 2026-11-18).
 *
 * Once an owner has received a first payout, an SMS code or password alone is
 * no longer enough: SIM-swap fraud is common, and a paid owner's account holds
 * money and guest data. Only a passkey or an authenticator app counts, because
 * neither can be taken over with a SIM swap. SMS two-step does not count.
 *
 *  - Money actions (withdrawals, payout destination changes) need a session
 *    that was itself signed in with a passkey or authenticator, from the day
 *    the policy starts.
 *  - Sign-in: for 14 days the owner keeps signing in as before, with a banner.
 *    After that, an SMS-code or password sign-in by an owner with no passkey
 *    or authenticator only reaches the setup screen (a "setup-only" session),
 *    and an owner who has a passkey must sign in with it.
 *
 * Switched on by OWNER_MFA_POLICY_START (an ISO date, EAT midnight is fine).
 * Unset or invalid means the policy is off everywhere. Grace runs 14 days from
 * the later of that date and the owner's first payout.
 *
 * "First payout" is the owner's first Disbursement marked PAID, the same test
 * the automatic payout lane uses (services/payouts/autoLane.ts).
 */
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import type { AuthedUser } from "../middleware/auth.js";

export const OWNER_MFA_GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Lifetime of a setup-only session. */
export const OWNER_MFA_SETUP_SESSION_SECONDS = 30 * 60;
export const OWNER_MFA_SETUP_PATH = "/account/secure-your-account";

export function ownerMfaPolicyStart(): Date | null {
  const raw = String(process.env.OWNER_MFA_POLICY_START || "").trim();
  if (!raw) return null;
  const start = new Date(raw);
  return Number.isFinite(start.getTime()) ? start : null;
}

export type OwnerMfaState = {
  /** Policy switched on and this is an owner who has been paid at least once. */
  required: boolean;
  hasPasskey: boolean;
  hasAuthenticator: boolean;
  /** Has at least one factor that counts. */
  satisfied: boolean;
  firstPayoutAt: Date | null;
  graceEndsAt: Date | null;
  /** Grace is over: weak sign-ins no longer reach the workspace. */
  signInEnforced: boolean;
};

const NOT_REQUIRED: OwnerMfaState = {
  required: false, hasPasskey: false, hasAuthenticator: false, satisfied: false,
  firstPayoutAt: null, graceEndsAt: null, signInEnforced: false,
};

export async function ownerMfaState(
  user: { id: number; role?: string | null },
  now = new Date(),
): Promise<OwnerMfaState> {
  const start = ownerMfaPolicyStart();
  if (!start || String(user.role || "").toUpperCase() !== "OWNER" || start.getTime() > now.getTime()) return NOT_REQUIRED;

  const [firstPaid, account, passkeys] = await Promise.all([
    prisma.disbursement.findFirst({
      where: { status: "PAID", payoutAccount: { is: { userId: user.id } } },
      orderBy: { paidAt: "asc" },
      select: { paidAt: true, updatedAt: true },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { twoFactorEnabled: true, twoFactorMethod: true, totpSecretEnc: true },
    }),
    prisma.passkey.count({ where: { userId: user.id } }),
  ]);
  if (!firstPaid) return NOT_REQUIRED;

  const firstPayoutAt = firstPaid.paidAt ?? firstPaid.updatedAt ?? now;
  const hasAuthenticator = Boolean(account?.twoFactorEnabled
    && String(account.twoFactorMethod || "").toUpperCase() === "TOTP"
    && account.totpSecretEnc);
  const hasPasskey = passkeys > 0;
  const graceEndsAt = new Date(Math.max(start.getTime(), firstPayoutAt.getTime()) + OWNER_MFA_GRACE_DAYS * DAY_MS);
  return {
    required: true,
    hasPasskey,
    hasAuthenticator,
    satisfied: hasPasskey || hasAuthenticator,
    firstPayoutAt,
    graceEndsAt,
    signInEnforced: now.getTime() >= graceEndsAt.getTime(),
  };
}

/**
 * Decide what a weak (SMS code or password) owner sign-in may become.
 * Authenticator users never reach this: their sign-in already asks for the
 * app code first (accountMfaPolicy.requiresAccountTotp).
 */
export async function ownerWeakSignInOutcome(
  user: { id: number; role?: string | null },
  now = new Date(),
): Promise<"FULL" | "PASSKEY_REQUIRED" | "SETUP_ONLY"> {
  const state = await ownerMfaState(user, now).catch(() => NOT_REQUIRED);
  if (!state.required || !state.signInEnforced) return "FULL";
  if (state.hasAuthenticator) return "FULL"; // challenged for the code before this point
  if (state.hasPasskey) return "PASSKEY_REQUIRED";
  return "SETUP_ONLY";
}

export class OwnerMfaRequiredError extends Error {
  constructor(public code: "OWNER_MFA_SETUP_REQUIRED" | "OWNER_MFA_SIGNIN_REQUIRED", message: string) {
    super(message);
  }
}

/**
 * Money actions for a paid owner need a session signed in with a passkey or
 * authenticator. Throws OwnerMfaRequiredError; returns quietly otherwise.
 */
export async function assertOwnerStrongSession(user: AuthedUser | undefined, now = new Date()): Promise<void> {
  if (!user || String(user.role || "").toUpperCase() !== "OWNER") return;
  const state = await ownerMfaState(user, now);
  if (!state.required || user.strongAuth) return;
  if (!state.satisfied) {
    throw new OwnerMfaRequiredError(
      "OWNER_MFA_SETUP_REQUIRED",
      "To protect your payouts, add a passkey or an authenticator app before withdrawing or changing where you are paid.",
    );
  }
  throw new OwnerMfaRequiredError(
    "OWNER_MFA_SIGNIN_REQUIRED",
    state.hasPasskey
      ? "To protect your payouts, sign in again with your passkey, then try this again."
      : "To protect your payouts, sign in again with your authenticator app, then try this again.",
  );
}

/** Route guard for owner money actions; non-owners pass straight through. */
export const requireOwnerStrongSession: RequestHandler = async (req, res, next) => {
  try {
    await assertOwnerStrongSession((req as any).user as AuthedUser | undefined);
    return next();
  } catch (err) {
    if (err instanceof OwnerMfaRequiredError) {
      return res.status(403).json({
        ok: false,
        code: err.code,
        error: err.message,
        ...(err.code === "OWNER_MFA_SETUP_REQUIRED" ? { redirectTo: "/owner/settings/passkeys" } : {}),
      });
    }
    // The policy could not be evaluated: refuse the money action rather than guess.
    return res.status(503).json({ ok: false, code: "OWNER_MFA_UNAVAILABLE", error: "We could not check your account security. Please try again." });
  }
};

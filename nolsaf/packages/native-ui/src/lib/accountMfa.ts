import { apiRequest } from "./apiClient";

export type AccountMfaChallenge = {
  ok: false;
  mfaRequired: true;
  code: "MFA_REQUIRED";
  method: "TOTP";
  challengeId: string;
  expiresInSeconds?: number;
};

export type AccountMfaVerificationResponse<TUser = unknown> = {
  ok?: boolean;
  token?: string;
  user?: TUser;
  message?: string;
  error?: string;
};

export function isAccountMfaChallenge(value: unknown): value is AccountMfaChallenge {
  const candidate = value as Partial<AccountMfaChallenge> | null | undefined;
  return candidate?.mfaRequired === true && candidate.code === "MFA_REQUIRED" && typeof candidate.challengeId === "string";
}

/** Shared second-step verifier used by every native NoLSAF app. */
export async function verifyAccountMfaChallenge<TUser = unknown>(challengeId: string, code: string, useBackupCode = false) {
  return apiRequest<AccountMfaVerificationResponse<TUser>>("/api/auth/mfa/verify", {
    method: "POST",
    body: { challengeId, code, useBackupCode }
  });
}

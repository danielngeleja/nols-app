import { createHash } from "node:crypto";

export function requiresAccountTotp(user: any): boolean {
  return String(user?.role || "").toUpperCase() !== "ADMIN"
    && user?.twoFactorEnabled === true
    && String(user?.twoFactorMethod || "").toUpperCase() === "TOTP";
}

export function accountMfaBinding(user: any): string {
  return createHash("sha256").update(String(user?.totpSecretEnc || "")).digest("hex");
}

export function accountMfaSessionAllowed(user: any, claims: any): boolean {
  // Support impersonation is separately authorized and cannot change credentials.
  if (!requiresAccountTotp(user) || claims?.imp === true) return true;
  return Boolean(user.totpSecretEnc)
    && (claims?.mfa === "totp" || claims?.mfa === "backup_code")
    && claims?.mfaBinding === accountMfaBinding(user);
}

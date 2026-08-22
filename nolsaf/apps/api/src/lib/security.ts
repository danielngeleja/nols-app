// apps/api/src/lib/security.ts
// Reusable security helpers (password hashing, TOTP provisioning helpers,
// WebAuthn/passkeys helpers). Designed to be imported by route handlers
// across Admin/Owner/User areas.

import argon2 from "argon2";
import { authenticator } from "otplib";
import { makeQR } from "./qr";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { prisma } from "@nolsaf/prisma";
import * as passkeysDb from "./passkeysDb";
import { getWebAuthnRp } from "./webauthnRp.js";

// In-memory fallbacks so this module works even when Prisma models are not
// present (useful for demo/dev environments). Prefer DB-backed storage if
// available.
export const passkeyChallenges = new Map<string, string>();
export const passkeyStore = new Map<string, any>();

// ----- Password helpers -----
export async function hashPassword(password: string) {
  return argon2.hash(password);
}

export async function verifyPassword(hash: string | null | undefined, password: string) {
  if (!hash) return false;
  try {
    return await argon2.verify(hash, password);
  } catch (e) {
    return false;
  }
}

// Validate password strength. Returns { valid, reasons[] } where reasons
// contains human-friendly messages explaining why the password is weak.
export const PASSWORD_MIN_LENGTH_FLOOR = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_SPECIAL_CHARACTERS = "!@#$%^&*()-_=+[]{};:'\"\\|,<.>/?`~";

export type PasswordValidationOptions = {
  minLength?: number;
  maxLength?: number;
  requireUpper?: boolean;
  requireLower?: boolean;
  requireNumber?: boolean;
  requireSpecial?: boolean;
  noSpaces?: boolean;
  role?: string;
};

export function validatePasswordStrength(password: string, options?: PasswordValidationOptions) {
  const opts = {
    minLength: PASSWORD_MIN_LENGTH_FLOOR,
    maxLength: PASSWORD_MAX_LENGTH,
    requireUpper: true,
    requireLower: true,
    requireNumber: true,
    requireSpecial: true,
    noSpaces: true,
    ...(options || {}),
  } as Required<typeof options> & { minLength: number };

  // minLength is controlled entirely by SystemSetting.minPasswordLength (passed in via options).
  // No role-based override — the DB policy applies uniformly to all roles.

  const reasons: string[] = [];
  if (typeof password !== 'string') {
    reasons.push('Password must be a string');
    return { valid: false, reasons };
  }
  if (opts.noSpaces && /\s/.test(password)) reasons.push('Password must not contain spaces');
  if (password.length < opts.minLength) reasons.push(`Password must be at least ${opts.minLength} characters long`);
  if (password.length > opts.maxLength) reasons.push(`Password must not exceed ${opts.maxLength} characters`);
  if (opts.requireUpper && !/[A-Z]/.test(password)) reasons.push('Password must include at least one uppercase letter');
  if (opts.requireLower && !/[a-z]/.test(password)) reasons.push('Password must include at least one lowercase letter');
  if (opts.requireNumber && !/[0-9]/.test(password)) reasons.push('Password must include at least one digit');
  if (opts.requireSpecial && !Array.from(password).some((char) => PASSWORD_SPECIAL_CHARACTERS.includes(char))) {
    reasons.push('Password must include at least one special character (e.g. !@#$%)');
  }

  return { valid: reasons.length === 0, reasons };
}

// ----- TOTP helpers -----
export function generateTOTPSecret() {
  return authenticator.generateSecret();
}

export function generateTOTPURI(secret: string, label: string, issuer = "nolsaf") {
  return authenticator.keyuri(label, issuer, secret);
}

export async function makeTOTPQRCode(secret: string, label: string, issuer = "nolsaf") {
  const uri = generateTOTPURI(secret, label, issuer);
  return makeQR(uri);
}

// ----- WebAuthn / Passkeys helpers -----
function getWebAuthnConfig() {
  const rpName = process.env.WEB_AUTHN_RP_NAME || "nolsaf";
  const { rpID, expectedOrigins } = getWebAuthnRp();
  return { rpName, rpID, expectedOrigins };
}

export function generatePasskeyRegistrationOptions(user: { id: string | number; name?: string; displayName?: string }, existingCreds: Array<any> = []) {
  const { rpName, rpID } = getWebAuthnConfig();
  const excludeCredentials = existingCreds.map((c) => ({ id: c.credentialId, type: "public-key" }));

  const opts = generateRegistrationOptions({
    rpName,
    rpID,
    user: {
      id: String(user.id),
      name: user.name || String(user.id),
      displayName: user.displayName || user.name || String(user.id),
    },
    attestationType: "none",
    authenticatorSelection: {
      userVerification: "preferred",
      // discoverable credential so username-less passkey login works
      residentKey: "preferred",
    },
    excludeCredentials,
    // keep a short timeout for UX
    timeout: 60_000,
  } as any);

  return opts as any;
}

export async function verifyPasskeyRegistration(response: any, expectedChallenge: string) {
  const { rpID, expectedOrigins } = getWebAuthnConfig();
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigins,
    expectedRPID: rpID,
  } as any).catch((e) => ({ verified: false, error: (e as Error).message }));

  return verification as any;
}

export function generatePasskeyAuthenticationOptions(allowCredentials: Array<any> = []) {
  const { rpID } = getWebAuthnConfig();
  const allow = allowCredentials.map((c) => ({ id: c.credentialId, type: "public-key" }));
  const opts = generateAuthenticationOptions({
    timeout: 60_000,
    allowCredentials: allow,
    userVerification: "preferred",
    rpID,
  } as any);
  return opts as any;
}

export async function verifyPasskeyAuthentication(response: any, expectedChallenge: string, credential: any) {
  const { rpID, expectedOrigins } = getWebAuthnConfig();
  // credential should include publicKey and previous signCount
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: expectedOrigins,
    expectedRPID: rpID,
    authenticator: {
      credentialID: credential?.credentialId,
      counter: credential?.signCount || 0,
      credentialPublicKey: credential?.publicKey,
    } as any,
  } as any).catch((e) => ({ verified: false, error: (e as Error).message }));

  return verification as any;
}

// ----- Persistence helpers (best-effort using Prisma) -----
export async function persistPasskey(userId: string | number, credential: any) {
  try {
    // Prefer DB persistence via passkeysDb helper. If it fails (missing model), fall back to memory.
    return await passkeysDb.createPasskey({
      userId: String(userId),
      credentialId: credential.credentialId,
      publicKey: credential.publicKey,
      transports: credential.transports || [],
      signCount: credential.signCount || 0,
    } as any);
  } catch (e) {
    // fallback to existing in-memory behavior
  }

  passkeyStore.set(String(credential.credentialId), { ...credential, userId: String(userId) });
  return { inMemory: true };
}

export async function updatePasskeySignCount(credentialId: string, signCount: number) {
  try {
    return await passkeysDb.updatePasskeySignCount(credentialId, signCount as number);
  } catch (e) {
    // fallback to memory
  }
  const cur = passkeyStore.get(credentialId) || {};
  cur.signCount = signCount;
  passkeyStore.set(credentialId, cur);
  return cur;
}

export async function listPasskeysForUser(userId: string | number) {
  try {
    return await passkeysDb.listPasskeysForUser(String(userId));
  } catch (e) {
    // fallback to memory
  }
  const out: any[] = [];
  for (const v of passkeyStore.values()) {
    if (String(v.userId) === String(userId)) out.push(v);
  }
  return out;
}

// ----- Password history (reuse prevention) -----
// Keep a small in-memory history when DB persistence isn't available.
const passwordHistoryStore = new Map<string, string[]>();

export async function isPasswordReused(userId: string | number, candidatePassword: string, limit = 5) {
  const id = String(userId);
  try {
    if ((prisma as any).user) {
      const u = await prisma.user.findUnique({
        where: { id: userId as any },
        select: { previousPasswordHashes: true },
      });
      const arr: string[] = Array.isArray((u as any)?.previousPasswordHashes) ? (u as any).previousPasswordHashes : [];
      if (Array.isArray(arr) && arr.length) {
        for (const h of arr.slice(-limit)) {
          try { if (await argon2.verify(h, candidatePassword)) return true; } catch (e) { /* ignore */ }
        }
      }
    }
  } catch (e) {
    // ignore DB errors and fall back to memory
  }

  // Fallback: check in-memory history
  const mem = passwordHistoryStore.get(id) || [];
  for (const h of mem.slice(-limit)) {
    try { if (await argon2.verify(h, candidatePassword)) return true; } catch (e) { /* ignore */ }
  }
  return false;
}

export async function addPasswordToHistory(userId: string | number, newHash: string, limit = 5) {
  const id = String(userId);
  try {
    if ((prisma as any).user) {
      const current = await prisma.user.findUnique({
        where: { id: userId as any },
        select: { previousPasswordHashes: true },
      });
      const existing = Array.isArray((current as any)?.previousPasswordHashes)
        ? (current as any).previousPasswordHashes.filter((value: unknown): value is string => typeof value === 'string')
        : [];
      const next = [...existing, newHash].slice(-limit);
      await prisma.user.update({
        where: { id: userId as any },
        data: { previousPasswordHashes: next } as any,
      });
      return { persisted: true };
    }
  } catch (e) {
    console.warn('Password history persistence failed; using process-local fallback', e);
  }

  // Fallback: in-memory
  const arr = passwordHistoryStore.get(id) || [];
  arr.push(newHash);
  // keep only last `limit` entries
  if (arr.length > limit) arr.splice(0, arr.length - limit);
  passwordHistoryStore.set(id, arr);
  return { persisted: false };
}

// ----- Password change cooldown (shared across /account/password/change and OTP-based reset) -----
// Prevents a user from changing/resetting their password again too soon, regardless of which
// flow (authenticated change vs. forgot-password OTP) they use.
const PASSWORD_CHANGE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
const passwordChangeSuccess = new Map<string, number>();

/** Returns the remaining cooldown in ms (0 if none) since the user last changed their password. */
export function getPasswordChangeCooldownRemaining(userId: string | number): number {
  const last = passwordChangeSuccess.get(String(userId));
  if (!last) return 0;
  const remaining = PASSWORD_CHANGE_COOLDOWN_MS - (Date.now() - last);
  return remaining > 0 ? remaining : 0;
}

/** Records a successful password change/reset, starting the cooldown window. */
export function recordPasswordChangeSuccess(userId: string | number) {
  passwordChangeSuccess.set(String(userId), Date.now());
}

export default {
  hashPassword,
  verifyPassword,
  generateTOTPSecret,
  generateTOTPURI,
  makeTOTPQRCode,
  generatePasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication,
  persistPasskey,
  updatePasskeySignCount,
  listPasskeysForUser,
  passkeyChallenges,
  passkeyStore,
};

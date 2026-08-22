import { Router } from 'express';
import multer from 'multer';
import { prisma } from '@nolsaf/prisma';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { sendMail, SECURITY_EMAIL_FROM } from '../lib/mailer.js';
import { getPasswordResetEmail, getLoginAlertEmail, getPasswordChangedConfirmationEmail, getVerificationCodeEmail } from '../lib/authEmailTemplates.js';
import { sendSms } from '../lib/sms.js';
import { addPasswordToHistory, getPasswordChangeCooldownRemaining, isPasswordReused, recordPasswordChangeSuccess } from '../lib/security.js';
import { getPublicPasswordPolicy, validatePasswordWithSettings } from '../lib/securitySettings.js';
import { getRoleSessionMaxMinutes } from '../lib/securitySettings.js';
import { signUserJwt, setAuthCookie, clearAuthCookie } from '../lib/sessionManager.js';
import { getWebAuthnRp } from '../lib/webauthnRp.js';
import { verifyOwnerReportPrintHandoff } from '../lib/ownerReportPrintHandoff.js';
import { audit } from '../lib/audit.js';
import { hashCode } from '../lib/otp.js';
import { maybeAuth, requireAuth } from '../middleware/auth.js';
import { invalidateAuthSessionCacheForUser } from '../lib/authSessionCache.js';
import { limitAccountCheck, limitOtpSend, limitOtpVerify, limitLoginAttempts, limitRegisterAttempts } from '../middleware/rateLimit.js';
import { isEmailLocked, recordFailedAttempt, clearFailedAttempts } from '../lib/loginAttemptTracker.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { buildDriverCaseRef } from '../lib/driverCaseRef.js';
import { getRedis } from '../lib/redis.js';
import { invalidateAuthSessionCacheForToken } from '../lib/authSessionCache.js';
import { getLoginAppRoleError, normalizeAccountRole } from '../lib/loginAppRolePolicy.js';
import { beginAdminMfaChallenge } from './auth.adminMfa.js';
import { resolveRegistrationSource } from '../lib/registrationLifecycle.js';

const router = Router();

router.get('/password-policy', async (_req, res) => {
  const policy = await getPublicPasswordPolicy();
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ policy });
});

// Onboarding profile accepts multipart form fields but not binary files.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 0,
    fields: 50,
    fieldSize: 64 * 1024,
    parts: 50,
  },
});

// OTP TTL: 3 minutes, shared by signup, login, and reset verification.
const OTP_TTL_SEC = 3 * 60;
const OTP_TTL_MS  = OTP_TTL_SEC * 1000;

// Redis key prefixes for OTP store — one namespace per delivery channel.
type OtpChannel = 'PHONE' | 'EMAIL';

function otpStoreKey(channel: OtpChannel, destination: string): string {
  return channel === 'EMAIL' ? `otp:email:${destination}` : `otp:phone:${destination}`;
}

// ── In-memory OTP fallback (used when Redis is unavailable) ──────────────────
// Stores ONLY the SHA-256 hash of the code, never the plain text.
const otpStoreFallback: Record<string, { codeHash: string; expiresAt: number; role?: string }> = {};

// In-memory reset token store (hashedToken -> { userId, expiresAt })
const resetTokenStore: Record<string, { userId: string; expiresAt: number }> = {};

// ── OTP store helpers ─────────────────────────────────────────────────────────

async function storeOtp(channel: OtpChannel, destination: string, code: string, role: string | null | undefined): Promise<void> {
  const codeHash = hashCode(code); // SHA-256 hash — never store plain text
  const payload = JSON.stringify({ codeHash, role: role ?? null });
  const key = otpStoreKey(channel, destination);
  try {
    const r = getRedis();
    if (r) {
      await r.set(key, payload, 'EX', OTP_TTL_SEC);
      return;
    }
  } catch (err) {
    console.error('[storeOtp] Redis error, using fallback:', err);
  }
  otpStoreFallback[key] = { codeHash, expiresAt: Date.now() + OTP_TTL_MS, role: role ?? undefined };
}

async function getOtpEntry(channel: OtpChannel, destination: string): Promise<{ codeHash: string; role?: string | null } | null> {
  const key = otpStoreKey(channel, destination);
  try {
    const r = getRedis();
    if (r) {
      const raw = await r.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as { codeHash: string; role?: string | null };
    }
  } catch (err) {
    console.error('[getOtpEntry] Redis error, using fallback:', err);
  }
  const entry = otpStoreFallback[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { delete otpStoreFallback[key]; return null; }
  return { codeHash: entry.codeHash, role: entry.role };
}

async function deleteOtp(channel: OtpChannel, destination: string): Promise<void> {
  const key = otpStoreKey(channel, destination);
  try {
    const r = getRedis();
    if (r) { await r.del(key); return; }
  } catch (err) {
    console.error('[deleteOtp] Redis error:', err);
  }
  delete otpStoreFallback[key];
}

function verifyOtpCode(code: string, codeHash: string): boolean {
  const inputHash = Buffer.from(hashCode(String(code)), 'hex');
  const storedHash = Buffer.from(codeHash, 'hex');
  if (inputHash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(inputHash, storedHash);
}

function generateOtp() {
  return crypto.randomInt(100000, 1000000).toString(); // 6-digit, CSPRNG
}

function maskOtp(code: string): string {
  const s = String(code || "");
  if (s.length <= 2) return "••••••";
  return `••••${s.slice(-2)}`;
}

function maskPhoneForAudit(phone: string): string {
  const value = String(phone || "");
  if (value.length <= 4) return "******";
  return `******${value.slice(-4)}`;
}

function getAuthTokenFromRequest(req: any): string | null {
  const authHeader = String(req.headers?.authorization || "");
  if (authHeader.startsWith("Bearer ")) return authHeader.slice(7);
  const rawCookie = String(req.headers?.cookie || "");
  for (const part of rawCookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "nolsaf_token" || name === "__Host-nolsaf_token" || name === "token" || name === "__Host-token") {
      const value = rest.join("=");
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

async function revokeCurrentSession(req: any): Promise<void> {
  const userId = Number(req?.user?.id);
  const sessionId = String(req?.sessionId || req?.user?.sessionId || "").trim();
  if (!Number.isInteger(userId) || userId <= 0 || !sessionId) return;
  await prisma.session.updateMany({
    where: { id: sessionId, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

function authOtpUse(normalizedRole: string | null): "AUTH_LOGIN" | "AUTH_RESET" | "AUTH_SIGNUP" {
  return normalizedRole === "RESET" ? "AUTH_RESET" : normalizedRole ? "AUTH_SIGNUP" : "AUTH_LOGIN";
}

function formatBlockedReason(note: string | null | undefined): string {
  const raw = String(note ?? '').trim();
  if (!raw) return 'Your NoLSAF driver access is currently inactive.';
  return raw
    .replace(/^Rejection reason:\s*/i, '')
    .replace(/^Revocation reason:\s*/i, '')
    .trim();
}

function buildBlockedAccountPayload(user: any) {
  const caseRef = buildDriverCaseRef(user?.id, user?.suspendedAt);
  return {
    name: String(user?.name ?? 'Driver').trim() || 'Driver',
    email: user?.email ?? null,
    caseRef,
    reason: formatBlockedReason(user?.kycNote),
    nextSteps: 'If you believe this action was taken in error, contact NoLSAF support and include your registered account details for review.',
    payoutMessage: 'Any active and unpaid payout recorded before the revocation date will still be reviewed and processed under NoLSAF payout policy.',
  };
}

function otpEntityKey(destinationType: "PHONE" | "EMAIL", destination: string, codeHash: string): string {
  // Encode enough to support string filtering in admin dashboards without JSON queries.
  return `OTP:${destinationType}:${destination}:${codeHash}`;
}

const PHONE_RULES: Record<string, { min: number; max: number }> = {
  '+255': { min: 9, max: 9 },
  '+254': { min: 9, max: 9 },
  '+256': { min: 9, max: 9 },
  '+250': { min: 9, max: 9 },
  '+251': { min: 9, max: 9 },
  '+257': { min: 8, max: 8 },
  '+243': { min: 9, max: 9 },
  '+252': { min: 8, max: 9 },
  '+211': { min: 9, max: 9 },
  '+265': { min: 9, max: 9 },
  '+258': { min: 9, max: 9 },
  '+260': { min: 9, max: 9 },
  '+263': { min: 9, max: 9 },
  '+27': { min: 9, max: 9 },
  '+234': { min: 10, max: 10 },
  '+233': { min: 9, max: 9 },
  '+212': { min: 9, max: 9 },
  '+20': { min: 10, max: 10 },
  '+269': { min: 7, max: 7 },
  '+248': { min: 7, max: 7 },
  '+230': { min: 8, max: 8 },
  '+267': { min: 8, max: 8 },
  '+264': { min: 9, max: 9 },
  '+244': { min: 9, max: 9 },
  '+221': { min: 9, max: 9 },
  '+237': { min: 9, max: 9 },
  '+225': { min: 10, max: 10 },
  '+249': { min: 9, max: 9 },
  '+213': { min: 9, max: 9 },
  '+216': { min: 8, max: 8 },
  '+44': { min: 10, max: 10 },
  '+49': { min: 10, max: 11 },
  '+33': { min: 9, max: 9 },
  '+39': { min: 9, max: 10 },
  '+31': { min: 9, max: 9 },
  '+34': { min: 9, max: 9 },
  '+351': { min: 9, max: 9 },
  '+32': { min: 8, max: 9 },
  '+41': { min: 9, max: 9 },
  '+43': { min: 10, max: 11 },
  '+48': { min: 9, max: 9 },
  '+420': { min: 9, max: 9 },
  '+353': { min: 9, max: 9 },
  '+46': { min: 9, max: 9 },
  '+47': { min: 8, max: 8 },
  '+45': { min: 8, max: 8 },
  '+7': { min: 10, max: 10 },
  '+380': { min: 9, max: 9 },
  '+90': { min: 10, max: 10 },
  '+971': { min: 9, max: 9 },
  '+972': { min: 9, max: 9 },
  '+966': { min: 9, max: 9 },
  '+974': { min: 8, max: 8 },
  '+968': { min: 8, max: 8 },
  '+965': { min: 8, max: 8 },
  '+91': { min: 10, max: 10 },
  '+86': { min: 11, max: 11 },
  '+81': { min: 10, max: 10 },
  '+82': { min: 9, max: 10 },
  '+65': { min: 8, max: 8 },
  '+60': { min: 9, max: 10 },
  '+62': { min: 9, max: 12 },
  '+66': { min: 9, max: 9 },
  '+63': { min: 10, max: 10 },
  '+92': { min: 10, max: 10 },
  '+61': { min: 9, max: 9 },
  '+64': { min: 8, max: 10 },
  '+1': { min: 10, max: 10 },
  '+52': { min: 10, max: 10 },
  '+55': { min: 10, max: 11 },
  '+54': { min: 10, max: 11 },
};

function normalizePhoneForAuth(input: string): string {
  let cleaned = String(input || '').trim();
  if (!cleaned) return '';
  cleaned = cleaned.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
  if (cleaned.startsWith('+')) return cleaned;

  const defaultCallingCode = String(process.env.DEFAULT_COUNTRY_CALLING_CODE || '255').replace(/\D/g, '') || '255';
  if (cleaned.startsWith(defaultCallingCode)) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+${defaultCallingCode}${cleaned.slice(1)}`;
  return `+${defaultCallingCode}${cleaned}`;
}

function buildAuthPhoneVariants(input: string): string[] {
  const raw = String(input || '').trim();
  if (!raw) return [];
  const compact = raw.replace(/[\s()-]/g, '');
  const normalized = normalizePhoneForAuth(compact);
  const digitsOnly = normalized.replace(/\D/g, '');
  const variants = new Set<string>([
    raw,
    compact,
    normalized,
    normalized.replace(/^\+/, ''),
  ]);

  if (digitsOnly.startsWith('255') && digitsOnly.length === 12) {
    const subscriber = digitsOnly.slice(3);
    variants.add(subscriber);
    variants.add(`0${subscriber}`);
    variants.add(digitsOnly);
    variants.add(`+${digitsOnly}`);
  }

  return [...variants].filter(Boolean);
}

function getPhoneRuleForNumber(phone: string): { code: string | null; min: number; max: number } {
  const supportedCodes = Object.keys(PHONE_RULES).sort((a, b) => b.length - a.length);
  const matchedCode = supportedCodes.find((code) => phone.startsWith(code)) || null;
  if (!matchedCode) return { code: null, min: 6, max: 12 };
  const rule = PHONE_RULES[matchedCode];
  return { code: matchedCode, min: rule.min, max: rule.max };
}

function isPhoneValidForAuth(phone: string): boolean {
  const normalized = normalizePhoneForAuth(phone);
  if (!normalized) return false;
  const { code, min, max } = getPhoneRuleForNumber(normalized);
  const nationalDigits = (code ? normalized.slice(code.length) : normalized).replace(/\D/g, '');
  return nationalDigits.length >= min && nationalDigits.length <= max;
}

function getPhoneValidationMessage(phone: string): string {
  const normalized = normalizePhoneForAuth(phone);
  const { min, max } = getPhoneRuleForNumber(normalized);
  return min === max ? `Phone number must be exactly ${min} digits for that country code.` : `Phone number must be ${min}-${max} digits for that country code.`;
}

function normalizeEmailForAuth(input: any): string | null {
  const v = String(input ?? '').trim().toLowerCase();
  if (!v || v.length > 190) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return null;
  return v;
}

function maskEmailForAudit(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '******';
  return `${local.slice(0, 2)}****@${domain}`;
}

function normalizeSignupRole(input: any): 'CUSTOMER' | 'OWNER' | 'DRIVER' | 'RESET' | null {
  const v = String(input ?? '').trim().toUpperCase();
  if (!v) return null;
  if (v === 'RESET') return 'RESET';
  if (v === 'OWNER') return 'OWNER';
  if (v === 'DRIVER') return 'DRIVER';
  if (v === 'TRAVELLER' || v === 'TRAVELER' || v === 'USER' || v === 'CUSTOMER') return 'CUSTOMER';
  return null;
}

type ResetAppContext = 'DRIVER' | 'PARTNERS' | 'CUSTOMER' | null;

function normalizeResetAppContext(input: any): ResetAppContext {
  const v = String(input ?? '').trim().toUpperCase();
  if (v === 'DRIVER' || v === 'DRIVER_APP') return 'DRIVER';
  if (v === 'PARTNER' || v === 'PARTNERS' || v === 'PARTNERS_APP' || v === 'OWNER' || v === 'AGENT') return 'PARTNERS';
  if (v === 'CUSTOMER' || v === 'CUSTOMER_APP' || v === 'WEB') return 'CUSTOMER';
  return null;
}

function getResetAppRoleError(accountRoleInput: any, resetAppInput: any): { error: string; message: string; action: string } | null {
  const resetApp = normalizeResetAppContext(resetAppInput);
  if (!resetApp) return null;

  const accountRole = normalizeAccountRole(accountRoleInput);
  const allowed =
    resetApp === 'DRIVER' ? accountRole === 'DRIVER' :
    resetApp === 'PARTNERS' ? accountRole === 'OWNER' || accountRole === 'AGENT' :
    accountRole === 'CUSTOMER';

  if (allowed) return null;

  if (accountRole === 'ADMIN') {
    return {
      error: 'admin_reset_restricted',
      message: 'Admin password resets require NoLSAF security approval. Please contact another active admin or NoLSAF security support.',
      action: 'contact_security',
    };
  }

  if (accountRole === 'DRIVER') {
    return {
      error: 'wrong_reset_app',
      message: 'This account is registered as a driver. Please reset your password in the NoLSAF Driver app.',
      action: 'use_driver_app',
    };
  }

  if (accountRole === 'OWNER' || accountRole === 'AGENT') {
    return {
      error: 'wrong_reset_app',
      message: 'This account is registered for NoLSAF Partners. Please reset your password in the NoLSAF Partners app.',
      action: 'use_partners_app',
    };
  }

  return {
    error: 'wrong_reset_app',
    message: 'This account is registered as a traveller. Please reset your password from the main NoLSAF account sign-in.',
    action: 'use_customer_account',
  };
}

function getResetRolePolicyError(accountRoleInput: any): { error: string; message: string; action: string } | null {
  const accountRole = normalizeAccountRole(accountRoleInput);
  if (accountRole !== 'ADMIN') return null;
  return {
    error: 'admin_reset_restricted',
    message: 'Admin password resets require NoLSAF security approval. Please contact another active admin or NoLSAF security support.',
    action: 'contact_security',
  };
}

function getJwtSecret(): string {
  return (
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== 'production' ? (process.env.DEV_JWT_SECRET || 'dev_jwt_secret') : '')
  );
}

function getTokenFromReq(req: any): string | null {
  const authHeader = req?.headers?.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) return authHeader.slice(7);
  const cookieHeader = req?.headers?.cookie;
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const value = part.slice(idx + 1).trim();
    if (key === 'nolsaf_token' || key === '__Host-nolsaf_token' || key === 'token' || key === '__Host-token') {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

// GET /api/auth/session
// Returns countdown metadata for the current session.
router.get(
  '/session',
  requireAuth,
  asyncHandler(async (req: any, res) => {
    const token = getTokenFromReq(req);
    if (!token) return res.status(401).json({ error: 'Unauthorized' });

    const decoded = jwt.decode(token) as any;
    const issuedAtSec = typeof decoded?.iat === 'number' ? decoded.iat : Number(decoded?.iat);
    const expSec = typeof decoded?.exp === 'number' ? decoded.exp : Number(decoded?.exp);
    if (!Number.isFinite(issuedAtSec) || issuedAtSec <= 0) {
      return res.status(200).json({ ok: true, nowSec: Math.floor(Date.now() / 1000), expiresAt: null, remainingSec: null });
    }

    const role = String(req?.user?.role || '').toUpperCase();
    const roleMaxMinutes = await getRoleSessionMaxMinutes(role || null);
    const dynamicExpSec = issuedAtSec + roleMaxMinutes * 60;
    const effectiveExpSec = Number.isFinite(expSec) && expSec > 0 ? Math.min(expSec, dynamicExpSec) : dynamicExpSec;

    const nowSec = Math.floor(Date.now() / 1000);
    const remainingSec = Math.max(0, Math.floor(effectiveExpSec - nowSec));
    return res.json({
      ok: true,
      nowSec,
      expiresAt: new Date(effectiveExpSec * 1000).toISOString(),
      remainingSec,
      roleMaxMinutes,
    });
  })
);

// Resolves the OTP destination from a request body that carries either
// `phone` or `email`. Phone keeps priority for backward compatibility.
function resolveOtpDestination(body: any):
  | { channel: OtpChannel; destination: string }
  | { error: string } {
  const rawPhone = body?.phone;
  const rawEmail = body?.email;
  if (rawPhone) {
    const normalizedPhone = normalizePhoneForAuth(String(rawPhone));
    if (!normalizedPhone) return { error: 'phone required' };
    if (!isPhoneValidForAuth(normalizedPhone)) return { error: getPhoneValidationMessage(normalizedPhone) };
    return { channel: 'PHONE', destination: normalizedPhone };
  }
  if (rawEmail) {
    const normalizedEmail = normalizeEmailForAuth(rawEmail);
    if (!normalizedEmail) return { error: 'A valid email address is required.' };
    return { channel: 'EMAIL', destination: normalizedEmail };
  }
  return { error: 'phone or email required' };
}

// POST /api/auth/reset-account-check
// Pre-flight for the forgot-password flow: reports whether the phone or email
// holds an account, so clients never show a "code sent" screen for a
// destination that can never receive one. Existence is already disclosed by
// the signup 409 path, so this adds no new exposure; the per-IP rate limit
// keeps bulk enumeration slow.
router.post('/reset-account-check', limitAccountCheck, async (req, res) => {
  const resolved = resolveOtpDestination(req.body);
  if ('error' in resolved) return res.status(400).json({ message: resolved.error });
  const { channel, destination } = resolved;
  const destinationWhere = channel === 'PHONE' ? { phone: destination } : { email: destination };
  try {
    const existing = await prisma.user.findFirst({ where: destinationWhere, select: { id: true } });
    return res.json({ ok: true, exists: Boolean(existing) });
  } catch {
    return res.status(503).json({
      error: 'database_unavailable',
      message: 'Unable to check this account right now. Please try again.',
    });
  }
});

// POST /api/auth/onboarding-contact-check
// Authenticated onboarding preflight. A profile may advance only when neither
// contact identifier belongs to another account.
router.post(
  '/onboarding-contact-check',
  limitAccountCheck,
  requireAuth,
  asyncHandler(async (req: any, res) => {
    const userId = Number(req?.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const normalizedPhone = normalizePhoneForAuth(String(req.body?.phone || ''));
    const normalizedEmail = normalizeEmailForAuth(req.body?.email);
    if (!normalizedPhone || !isPhoneValidForAuth(normalizedPhone)) {
      return res.status(400).json({
        error: 'invalid_phone',
        message: normalizedPhone
          ? getPhoneValidationMessage(normalizedPhone)
          : 'A valid phone number is required.',
      });
    }
    if (!normalizedEmail) {
      return res.status(400).json({
        error: 'invalid_email',
        message: 'A valid email address is required.',
      });
    }

    const phoneVariants = buildAuthPhoneVariants(normalizedPhone);
    const [existingPhone, existingEmail] = await Promise.all([
      prisma.user.findFirst({
        where: {
          id: { not: userId },
          phone: { in: phoneVariants },
        },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: {
          id: { not: userId },
          email: normalizedEmail,
        },
        select: { id: true },
      }),
    ]);

    if (existingPhone) {
      return res.status(409).json({
        ok: false,
        available: false,
        error: 'phone_already_registered',
        message: 'This phone number already has an account. Please login or use forgot password to access it.',
        action: 'login_or_forgot_password',
      });
    }
    if (existingEmail) {
      return res.status(409).json({
        ok: false,
        available: false,
        error: 'email_already_registered',
        message: 'This email address already has an account. Please login or use forgot password to access it.',
        action: 'login_or_forgot_password',
      });
    }

    return res.json({
      ok: true,
      available: true,
      normalizedPhone,
      normalizedEmail,
    });
  }),
);

// POST /api/auth/send-otp
// Accepts { phone } OR { email } as the OTP destination, plus optional { role }.
// Rate limited: 3 requests per destination per 15 minutes
router.post('/send-otp', limitOtpSend, async (req, res) => {
  const { role, resetApp } = req.body || {};
  const resolved = resolveOtpDestination(req.body);
  if ('error' in resolved) return res.status(400).json({ message: resolved.error });
  const { channel, destination } = resolved;
  const destinationWhere = channel === 'PHONE' ? { phone: destination } : { email: destination };
  const destinationLabel = channel === 'PHONE' ? 'phone number' : 'email address';
  const genericOtpResponse = { ok: true, message: 'If this destination can receive a code, one has been sent.', channel };

  const normalizedRole = normalizeSignupRole(role);
  let resumeRegistration = false;

  // If no role is provided, treat this as a LOGIN OTP request.
  // In this flow, the destination must already belong to an existing account.
  if (!normalizedRole) {
    try {
      const existing = await prisma.user.findFirst({
        where: destinationWhere,
        select: { id: true },
      });
      if (!existing) {
        return res.json(genericOtpResponse);
      }
    } catch {
      return res.status(503).json({
        error: 'database_unavailable',
        message: 'Unable to send OTP right now. Please try again.',
      });
    }
  }

  // Completed accounts cannot register again. Passwordless OTP-created accounts
  // may receive a fresh code to resume the same role's onboarding.
  if (normalizedRole && normalizedRole !== 'RESET') {
    try {
      const existing = await prisma.user.findFirst({
        where: destinationWhere,
        select: { id: true, role: true, passwordHash: true },
      });
      if (existing) {
        const existingRole = normalizeSignupRole(existing.role);
        const canResumeRegistration = !existing.passwordHash && existingRole === normalizedRole;
        if (canResumeRegistration) {
          // The destination owner proved control once but did not finish profile/password
          // setup. Send a fresh code so the same account can resume safely.
          resumeRegistration = true;
        } else if (!existing.passwordHash && existingRole !== normalizedRole) {
          return res.status(409).json({
            error: 'registration_role_mismatch',
            message: `This ${destinationLabel} already started registration with another account type. Continue with that account type or contact support.`,
            action: 'resume_original_registration',
          });
        } else {
          return res.status(409).json({
            error: channel === 'PHONE' ? 'phone_already_registered' : 'email_already_registered',
            message: `This ${destinationLabel} already has an account. Please login or use forgot password to access it.`,
            action: 'login_or_forgot_password',
          });
        }
      }
    } catch {
      // If the DB is temporarily unavailable, continue with OTP send.
    }
  }

  // RESET flow: only send a reset OTP if an account actually exists for this destination.
  // Tell the user clearly so they aren't left staring at a "code sent" screen that can
  // never be verified.
  if (normalizedRole === 'RESET') {
    try {
      const existing = await prisma.user.findFirst({
        where: destinationWhere,
        select: { id: true, role: true },
      });
      if (!existing) {
        return res.status(404).json({
          error: 'account_not_found',
          message: `No account found for this ${destinationLabel}. Please check the details or register first.`,
          action: 'register',
        });
      }
      const rolePolicyError = getResetRolePolicyError(existing.role);
      if (rolePolicyError) {
        return res.status(403).json(rolePolicyError);
      }
      const appRoleError = getResetAppRoleError(existing.role, resetApp);
      if (appRoleError) {
        return res.status(409).json(appRoleError);
      }
    } catch {
      return res.status(503).json({
        error: 'database_unavailable',
        message: 'Unable to check this account right now. Please try again.',
      });
    }
  }

  const otp = generateOtp();
  await storeOtp(channel, destination, otp, normalizedRole);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);
  const codeHash = hashCode(String(otp));
  const entity = otpEntityKey(channel, destination, codeHash);
  const destinationMasked = channel === 'PHONE' ? maskPhoneForAudit(destination) : maskEmailForAudit(destination);

  // The OTP serves three distinct flows — make every message say which one,
  // so a signup code is never mistaken for a sign-in or reset code.
  const otpUse = authOtpUse(normalizedRole); // AUTH_SIGNUP | AUTH_LOGIN | AUTH_RESET
  const otpPurpose: "signup" | "login" | "reset" =
    otpUse === "AUTH_SIGNUP" ? "signup" : otpUse === "AUTH_RESET" ? "reset" : "login";
  const otpExpiryMinutes = Math.max(1, Math.round(OTP_TTL_SEC / 60));
  const smsLabel =
    otpPurpose === "signup" ? "account verification code" :
    otpPurpose === "reset"  ? "password reset code" :
    "sign-in code";

  let provider: string | null = null;
  let sendFailureReason: string | null = null;
  if (channel === 'PHONE') {
    const smsResult = await sendSms(
      destination,
      `Your NoLSAF ${smsLabel} is ${otp}. It expires in ${otpExpiryMinutes} minutes. Do not share it.`
    );
    provider = smsResult?.provider ?? null;
    if (!smsResult?.success) sendFailureReason = smsResult?.error ?? 'sms_failed';
  } else {
    try {
      // OTP emails are transactional auth messages — always deliverable.
      const { subject: otpSubject, html: otpHtml } = getVerificationCodeEmail(otp, {
        purpose: otpPurpose,
        expiryMinutes: otpExpiryMinutes,
      });
      await sendMail(destination, otpSubject, otpHtml, undefined, {
        bypassEligibilityCheck: true,
        from: SECURITY_EMAIL_FROM,
        replyTo: "support@nolsaf.com",
      });
      provider = 'email';
    } catch (e: any) {
      sendFailureReason = e?.message ?? 'email_failed';
    }
  }

  if (process.env.NODE_ENV === 'production' && sendFailureReason) {
    try {
      await audit(req, "NO4P_OTP_SEND_FAILED", `OTP:${channel}:${hashCode(destination)}:${codeHash}`, null, {
        destinationType: channel,
        destinationMasked,
        destinationHash: hashCode(destination),
        codeHash,
        usedFor: authOtpUse(normalizedRole),
        provider,
        reason: sendFailureReason,
        requestId: String((req as any).requestId || ""),
        policyCompliant: true,
      });
    } catch {
      // Never let failure auditing block the user-facing response.
    }
    return res.status(502).json({
      error: channel === 'PHONE' ? 'sms_failed' : 'email_failed',
      message: 'Failed to send OTP. Please try again.',
    });
  }

  // Audit for Management/No4P OTP tracking.
  // Never store raw OTP codes in audit logs.
  try {
    let userName: string | null = null;
    let userRole: string | null = null;
    try {
      const existing = await prisma.user.findFirst({
        where: destinationWhere,
        select: { name: true, role: true },
      });
      userName = existing?.name ?? null;
      userRole = (existing?.role as any) ?? null;
    } catch {
      // ignore lookup failures
    }
    await audit(req, "NO4P_OTP_SENT", entity, null, {
      destinationType: channel,
      destination,
      codeHash,
      codeMasked: maskOtp(otp),
      expiresAt: expiresAt.toISOString(),
      usedFor: authOtpUse(normalizedRole),
      provider,
      userRole,
      userName,
      policyCompliant: true,
    });
  } catch {
    // swallow
  }

  return res.json({
    ok: true,
    message: resumeRegistration ? 'OTP sent to continue registration' : 'OTP sent',
    channel,
    resumeRegistration,
    otpExpiresInSeconds: OTP_TTL_SEC,
  });
});

// POST /api/auth/verify-otp
// Accepts { phone } OR { email } as the OTP destination, plus { otp } and optional { role }.
// Rate limited: 10 verification attempts per destination per 15 minutes
router.post('/verify-otp', limitOtpVerify, async (req, res) => {
  const { otp, role, loginApp } = req.body || {};
  const registrationSource = resolveRegistrationSource({
    bodySource: req.body?.registrationSource,
    headerSource: req.headers['x-nolsaf-client'],
  });
  if (!otp) return res.status(400).json({ message: 'otp required' });

  const resolved = resolveOtpDestination(req.body);
  if ('error' in resolved) return res.status(400).json({ message: resolved.error });
  const { channel, destination } = resolved;
  const destinationWhere = channel === 'PHONE' ? { phone: destination } : { email: destination };
  const destinationLabel = channel === 'PHONE' ? 'phone number' : 'email address';
  const verifiedAtField = channel === 'PHONE' ? 'phoneVerifiedAt' : 'emailVerifiedAt';

  const requestedRole = normalizeSignupRole(role);

  const entry = await getOtpEntry(channel, destination);
  if (!entry) {
    try {
      const codeHash = hashCode(String(otp));
      const entity = otpEntityKey(channel, destination, codeHash);
      await audit(req, "NO4P_OTP_VERIFY_FAILED", entity, null, {
        destinationType: channel,
        destination,
        codeHash,
        usedFor: requestedRole === "RESET" ? "AUTH_RESET" : requestedRole ? "AUTH_SIGNUP" : "AUTH_LOGIN",
        reason: "no_otp",
      });
    } catch {
      // swallow
    }
    return res.status(400).json({ message: `no OTP found for this ${destinationLabel}` });
  }
  // OTP expiry is enforced by Redis TTL / fallback expiresAt — entry being present means it's valid.
  if (!verifyOtpCode(String(otp), entry.codeHash)) {
    try {
      const codeHash = hashCode(String(otp));
      const entity = otpEntityKey(channel, destination, codeHash);
      await audit(req, "NO4P_OTP_VERIFY_FAILED", entity, null, {
        destinationType: channel,
        destination,
        codeHash,
        usedFor: requestedRole === "RESET" ? "AUTH_RESET" : requestedRole ? "AUTH_SIGNUP" : "AUTH_LOGIN",
        reason: "invalid",
      });
    } catch {
      // swallow
    }
    return res.status(400).json({ message: 'invalid OTP' });
  }

  const storedRole = normalizeSignupRole(entry.role);
  if (requestedRole && storedRole && requestedRole !== storedRole) {
    return res.status(400).json({ message: 'role mismatch' });
  }

  // success — delete OTP immediately (single-use)
  await deleteOtp(channel, destination);

  const effectiveRole = storedRole || requestedRole;

  // LOGIN OTP flow: no role was provided/stored, so this must authenticate an existing account.
  // Do NOT create users in the login flow.
  if (!effectiveRole) {
    try {
      const existing = await prisma.user.findFirst({
        where: destinationWhere,
        select: { id: true, role: true, email: true, phone: true, name: true, suspendedAt: true, isDisabled: true, kycStatus: true, kycNote: true },
      });
      if (!existing) {
        return res.status(404).json({
          error: 'account_not_found',
          message: `No account found for this ${destinationLabel}. Please register first.`,
          action: 'register',
        });
      }

      if ((existing as any).suspendedAt || (existing as any).isDisabled) {
        return res.status(403).json({
          error: 'account_suspended',
          code: 'ACCOUNT_SUSPENDED',
          message: 'This account cannot access NoLSAF at the moment.',
          blockedAccount: buildBlockedAccountPayload(existing),
        });
      }

      const loginAppRoleError = getLoginAppRoleError(existing.role, loginApp);
      if (loginAppRoleError) {
        return res.status(403).json(loginAppRoleError);
      }

      // SMS/email OTP is not an administrator login method. It is reserved for
      // controlled bootstrap inside the password-verified admin MFA flow.
      if (String(existing.role || '').toUpperCase() === 'ADMIN') {
        return res.status(403).json({
          error: 'Administrator passkey verification is required.',
          code: 'ADMIN_PASSKEY_REQUIRED',
          action: 'use_admin_portal',
        });
      }

      // Mark the destination as verified on successful login OTP.
      try {
        await prisma.user.update({
          where: { id: existing.id },
          data: { [verifiedAtField]: new Date() },
        });
      } catch {
        // ignore update failures; login can still proceed
      }

      const token = await signUserJwt({ id: existing.id, role: existing.role as any, email: existing.email });
      await setAuthCookie(res, token, existing.role as any);
      return res.json({
        ok: true,
        message: 'verified',
        token,
        user: { id: existing.id, phone: existing.phone, email: existing.email, role: existing.role },
      });
    } catch (e) {
      console.error('verify-otp login flow failed', e);
      return res.status(503).json({ error: 'database_unavailable', message: 'Unable to login right now.' });
    }
  }

  try {
    const codeHash = hashCode(String(otp));
    const entity = otpEntityKey(channel, destination, codeHash);
    await audit(req, "NO4P_OTP_USED", entity, null, {
      destinationType: channel,
      destination,
      codeHash,
      usedAt: new Date().toISOString(),
      usedFor: effectiveRole === "RESET" ? "AUTH_RESET" : "AUTH_SIGNUP",
      policyCompliant: true,
    });
  } catch {
    // swallow
  }

  // If this OTP was requested for reset flow, issue a reset token and return it
  if (effectiveRole === 'RESET') {
    try {
      const user = await prisma.user.findFirst({ where: destinationWhere });
      if (!user) {
        return res.status(400).json({ message: 'Unable to reset password with this verification code.' });
      }
      const rolePolicyError = getResetRolePolicyError((user as any).role);
      if (rolePolicyError) {
        return res.status(403).json(rolePolicyError);
      }
      const raw = crypto.randomBytes(24).toString('hex');
      const hashed = crypto.createHash('sha256').update(raw).digest('hex');
      const expiresAt = Date.now() + 1000 * 60 * 60; // 1 hour
      try {
        await prisma.user.update({ where: { id: user.id }, data: { resetPasswordToken: hashed as any, resetPasswordExpires: new Date(expiresAt) as any } as any });
      } catch (e) {
        resetTokenStore[hashed] = { userId: String(user.id), expiresAt };
      }
      const origin = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || 'http://localhost:3000';
      const resetLink = `${origin}/account/reset-password?token=${raw}&id=${user.id}`;
      const out: any = { ok: true, message: 'verified', resetToken: raw, link: resetLink, user: { id: user.id, phone: user.phone, email: user.email } };
      return res.json(out);
    } catch (e) {
      console.error('failed to create reset token after otp verify', e);
      return res.status(500).json({ message: 'failed' });
    }
  }

  // Normal auth flow (signup): a phone/email already tied to any account (verified or not)
  // cannot be used to create a new account — reject instead of silently attaching to it.
  try {
    const existing = await prisma.user.findFirst({
      where: destinationWhere,
      select: { id: true, role: true, email: true, phone: true, passwordHash: true, registrationSource: true },
    });
    if (existing) {
      const existingRole = normalizeSignupRole(existing.role);
      const canResumeRegistration = !existing.passwordHash && existingRole === effectiveRole;
      if (canResumeRegistration) {
        const resumedUser = await prisma.user.update({
          where: { id: existing.id },
          data: {
            [verifiedAtField]: new Date(),
            ...(existing.registrationSource === 'UNKNOWN' && registrationSource !== 'UNKNOWN'
              ? { registrationSource }
              : {}),
          },
          select: { id: true, role: true, email: true, phone: true, registrationStatus: true, registrationSource: true },
        });
        const token = await signUserJwt({
          id: resumedUser.id,
          role: resumedUser.role,
          email: resumedUser.email,
        });
        await setAuthCookie(res, token, resumedUser.role);
        return res.json({
          ok: true,
          message: 'Registration resumed',
          resumeRegistration: true,
          token,
          user: {
            id: resumedUser.id,
            phone: resumedUser.phone,
            email: resumedUser.email,
            role: resumedUser.role,
            registrationStatus: resumedUser.registrationStatus,
            registrationSource: resumedUser.registrationSource,
          },
        });
      }
      if (!existing.passwordHash && existingRole !== effectiveRole) {
        return res.status(409).json({
          error: 'registration_role_mismatch',
          message: `This ${destinationLabel} already started registration with another account type. Continue with that account type or contact support.`,
          action: 'resume_original_registration',
        });
      }
      return res.status(409).json({
        error: channel === 'PHONE' ? 'phone_already_registered' : 'email_already_registered',
        message: `This ${destinationLabel} already has an account. Please login or use forgot password to access it.`,
        action: 'login_or_forgot_password',
      });
    }
  } catch {
    return res.status(503).json({
      error: 'database_unavailable',
      message: 'Unable to resume registration right now. Please try again.',
    });
  }

  // Verify OTP and issue JWT + httpOnly cookie.
  try {
    const safeRole = (effectiveRole || 'CUSTOMER') as 'CUSTOMER' | 'OWNER' | 'DRIVER';
    const user = await prisma.user.upsert({
      where: destinationWhere as any,
      update: { [verifiedAtField]: new Date() },
      create: {
        ...destinationWhere,
        role: safeRole,
        [verifiedAtField]: new Date(),
        registrationStatus: 'INCOMPLETE',
        registrationSource,
      } as any,
      select: { id: true, role: true, email: true, phone: true, registrationStatus: true, registrationSource: true },
    });
    const token = await signUserJwt({ id: user.id, role: user.role, email: user.email });
    await setAuthCookie(res, token, user.role);
    return res.json({
      ok: true,
      message: "verified",
      token,
      user: {
        id: user.id,
        phone: user.phone,
        email: user.email,
        role: user.role,
        registrationStatus: user.registrationStatus,
        registrationSource: user.registrationSource,
      },
    });
  } catch (e: any) {
    if (e?.code === 'P2002') {
      const target = Array.isArray(e?.meta?.target) ? e.meta.target.map(String) : [String(e?.meta?.target || '')];
      const phoneConflict = target.some((field: string) => field.toLowerCase().includes('phone'));
      return res.status(409).json({
        error: phoneConflict ? 'phone_already_registered' : 'email_already_registered',
        message: phoneConflict
          ? 'This phone number already has an account. Please login or use forgot password to access it.'
          : 'This email already has an account. Please login or use forgot password to access it.',
        action: 'login_or_forgot_password',
      });
    }
    console.error("verify-otp failed to issue JWT", e);
    return res.status(503).json({ error: 'database_unavailable', message: "Unable to create account right now." });
  }
});

router.post('/login', (req, res) => {
  return res.status(400).json({ error: "Use POST /api/auth/login-password for email/password login." });
});

// ─── Known-device fingerprint store ──────────────────────────────────────────
// Tracks SHA-256 fingerprints (UA + IP prefix) per userId so login-alert emails
// are only sent when a truly new device/browser is seen.
// Resets on server restart — first login after a deploy will alert once per user.
const knownDeviceStore = new Map<number, Set<string>>();
const MAX_KNOWN_DEVICES = 20; // cap per user to avoid unbounded growth

function getDeviceFingerprint(ua: string, ip: string): string {
  // Use first two octets of IPv4 / first segment of IPv6 so minor IP changes
  // on the same network don't trigger spurious alerts.
  const ipPrefix = ip.split('.').slice(0, 2).join('.') || ip.split(':')[0] || ip;
  return crypto.createHash('sha256').update(`${ua}::${ipPrefix}`).digest('hex').slice(0, 16);
}

function isNewDevice(userId: number, fingerprint: string): boolean {
  const known = knownDeviceStore.get(userId);
  if (!known) return true; // first-ever login for this user in this server process
  return !known.has(fingerprint);
}

function recordDevice(userId: number, fingerprint: string): void {
  let known = knownDeviceStore.get(userId);
  if (!known) { known = new Set(); knownDeviceStore.set(userId, known); }
  if (known.size >= MAX_KNOWN_DEVICES) {
    // Evict oldest entry to stay bounded
    const oldest = known.values().next().value;
    if (oldest) known.delete(oldest);
  }
  known.add(fingerprint);
}

// POST /api/auth/login-password
// Body: { email, password }
// Rate limited: 10 login attempts per IP per 15 minutes
const MAX_LOGIN_IDENTIFIER_LENGTH = 320;
const MAX_LOGIN_PASSWORD_LENGTH = 1024;

// Register the route with rate limiting and async error handling
router.post("/login-password", limitLoginAttempts, asyncHandler(async (req, res, next) => {
    // Ensure we always return JSON, even on errors
    res.setHeader('Content-Type', 'application/json');
  
  try {
    const { email, password, loginApp } = req.body || {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({
        error: "invalid_login_input",
        message: "Email and password must be text values.",
      });
    }

    const identifier = email.trim();
    if (!identifier || !password) {
      return res.status(400).json({ error: "email and password required" });
    }
    if (
      identifier.length > MAX_LOGIN_IDENTIFIER_LENGTH ||
      password.length > MAX_LOGIN_PASSWORD_LENGTH
    ) {
      return res.status(400).json({
        error: "invalid_login_input",
        message: "Email or password exceeds the allowed length.",
      });
    }
    
    // Check if account is locked
    let lockoutStatus;
    try {
      lockoutStatus = await isEmailLocked(identifier);
    } catch (lockoutError: any) {
      console.error('[LOGIN] Error checking lockout status:', lockoutError);
      // Default to not locked on error
      lockoutStatus = { locked: false, lockedUntil: null };
    }
    if (lockoutStatus.locked) {
      const timeRemaining = Math.ceil((lockoutStatus.lockedUntil! - Date.now()) / 1000 / 60); // minutes
      return res.status(423).json({ 
        error: "account_locked",
        message: `Too many failed attempts. Please try again in ${timeRemaining} minute${timeRemaining !== 1 ? 's' : ''}.`,
        code: "ACCOUNT_LOCKED",
        lockedUntil: lockoutStatus.lockedUntil
      });
    }
    
    // Get client IP for tracking
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    
    let user;
    try {
      const phoneCandidates = (() => {
        const v = identifier;
        const out: string[] = [];
        out.push(v);
        if (/^\d+$/.test(v) && v.length <= 12) out.push(`+255${v}`);
        if (v.startsWith('0') && /^\d+$/.test(v.slice(1))) out.push(`+255${v.slice(1)}`);
        return Array.from(new Set(out));
      })();

      user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: identifier },
            { name: identifier },
            ...phoneCandidates.map((p) => ({ phone: p } as any)),
          ] as any,
        } as any,
        select: {
          id: true,
          role: true,
          email: true,
          passwordHash: true,
          name: true,
          phone: true,
          phoneVerifiedAt: true,
          twoFactorEnabled: true,
          twoFactorMethod: true,
          totpSecretEnc: true,
          suspendedAt: true,
          isDisabled: true,
          kycStatus: true,
          kycNote: true,
        },
      });
    } catch (dbError: any) {
      console.error('[LOGIN] Database query error:', dbError);
      // Check if it's a database connection error
      const isConnectionError = 
        dbError?.code === 'P1001' || // Can't reach database server
        dbError?.code === 'P1017' || // Server has closed the connection
        dbError?.message?.includes("Can't reach database server") ||
        dbError?.message?.includes("connect ECONNREFUSED") ||
        dbError?.message?.includes("Connection refused");
      
      if (isConnectionError) {
        return res.status(503).json({ 
          error: "database_unavailable",
          message: "Service temporarily unavailable. Please try again in a moment.",
          code: "DATABASE_UNAVAILABLE"
        });
      }
      
      // Re-throw if it's not a connection error
      throw dbError;
    }
    
    if (!user || !user.passwordHash) {
      // Record failed attempt even if user doesn't exist (prevents email enumeration)
      try {
        await recordFailedAttempt(identifier, clientIp);
      } catch (err) {
        console.error('[LOGIN] Failed to record failed attempt:', err);
      }
      return res.status(401).json({ 
        error: "invalid_credentials",
        message: "Incorrect email or password."
      });
    }
    
    // Verify password with error handling
    let ok = false;
    try {
      ok = await verifyPassword(String(user.passwordHash), String(password));
    } catch (verifyError: any) {
      console.error("Password verification error:", verifyError);
      try {
        await recordFailedAttempt(identifier, clientIp);
      } catch (err) {
        console.error('[LOGIN] Failed to record failed attempt:', err);
      }

      // Audit failed login attempt for known user (best-effort)
      try {
        ;(req as any).user = user
        await audit(req, "USER_LOGIN", `user:${user.id}`, null, {
          role: user.role,
          email: user.email,
          loginMethod: "password",
          event: "login",
          success: false,
          error: "verify_error",
        })
      } catch {
        /* ignore */
      }

      return res.status(401).json({ 
        error: "invalid_credentials",
        message: "Incorrect email or password."
      });
    }
    
    if (!ok) {
      // Record failed attempt
      try {
        await recordFailedAttempt(identifier, clientIp);
      } catch (err) {
        console.error('[LOGIN] Failed to record failed attempt:', err);
      }

      // Audit failed login attempt for known user (best-effort)
      try {
        ;(req as any).user = user
        await audit(req, "USER_LOGIN", `user:${user.id}`, null, {
          role: user.role,
          email: user.email,
          loginMethod: "password",
          event: "login",
          success: false,
          error: "invalid_credentials",
        })
      } catch {
        /* ignore */
      }

      // Check if account is now locked
      let newLockoutStatus;
      try {
        newLockoutStatus = await isEmailLocked(identifier);
      } catch (err) {
        console.error('[LOGIN] Failed to check lockout status:', err);
        newLockoutStatus = { locked: false, lockedUntil: null };
      }
      if (newLockoutStatus.locked) {
        const timeRemaining = Math.ceil((newLockoutStatus.lockedUntil! - Date.now()) / 1000 / 60);
        return res.status(423).json({ 
          error: "account_locked",
          message: `Too many failed attempts. Please try again in ${timeRemaining} minute${timeRemaining !== 1 ? 's' : ''}.`,
          code: "ACCOUNT_LOCKED",
          lockedUntil: newLockoutStatus.lockedUntil
        });
      }
      
      return res.status(401).json({ 
        error: "invalid_credentials",
        message: "Incorrect email or password."
      });
    }

    if ((user as any).suspendedAt || (user as any).isDisabled) {
      return res.status(403).json({
        error: 'account_suspended',
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account cannot access NoLSAF at the moment.',
        blockedAccount: buildBlockedAccountPayload(user),
      });
    }

    const loginAppRoleError = getLoginAppRoleError(user.role, loginApp);
    if (loginAppRoleError) {
      return res.status(403).json(loginAppRoleError);
    }

    // Successful login - clear failed attempts
    try {
      await clearFailedAttempts(identifier);
    } catch (err) {
      console.error('[LOGIN] Failed to clear failed attempts:', err);
      // Continue - don't block successful login
    }

    // Administrators never receive a normal session from a password alone.
    // The opaque, short-lived challenge cookie can only call the dedicated MFA
    // endpoints; a full revocable ADMIN session is issued after passkey/TOTP.
    if (String(user.role || '').toUpperCase() === 'ADMIN') {
      return await beginAdminMfaChallenge(req, res, user as any);
    }

    // Generate JWT token with error handling
    let token: string;
    try {
      token = await signUserJwt({ id: user.id, role: user.role, email: user.email });
    } catch (tokenError: any) {
      console.error("JWT token generation error:", tokenError);
      return res.status(500).json({ error: "Failed to generate authentication token" });
    }

    // Set auth cookie with error handling
    try {
      await setAuthCookie(res, token, user.role);
    } catch (cookieError: any) {
      console.error("Cookie setting error:", cookieError);
      // Token was generated, so we can still return success even if cookie fails
      // The token is in the response body
    }

    // Audit successful login
    try {
      // `audit()` derives actorId/actorRole from `req.user`. During login, middleware
      // has not attached a user yet, so explicitly attach for attribution.
      ;(req as any).user = user
      await audit(req, "USER_LOGIN", `user:${user.id}`, null, { 
        role: user.role,
        email: user.email,
        loginMethod: 'password',
        event: 'login',
        success: true,
      });
    } catch (auditError) {
      // Don't block login if audit fails
      console.warn("Failed to audit login:", auditError);
    }

    // Send new sign-in alert email — only when the device/browser is new
    if (user.email) {
      try {
        const ua = String(req.headers['user-agent'] || '');
        const device = (() => {
          if (/mobile|android|iphone|ipad/i.test(ua)) {
            if (/iphone/i.test(ua)) return 'iPhone (Mobile)';
            if (/ipad/i.test(ua)) return 'iPad (Tablet)';
            if (/android/i.test(ua)) return 'Android (Mobile)';
            return 'Mobile Device';
          }
          if (/windows/i.test(ua)) return 'Windows (Desktop)';
          if (/macintosh|mac os/i.test(ua)) return 'Mac (Desktop)';
          if (/linux/i.test(ua)) return 'Linux (Desktop)';
          return ua.slice(0, 80) || 'Unknown';
        })();
        // Country from Cloudflare header (when behind CF CDN) or fallback headers
        const country = String(
          req.headers['cf-ipcountry'] ||
          req.headers['x-country-code'] ||
          req.headers['x-vercel-ip-country'] ||
          ''
        ) || undefined;
        const appUrl = process.env.APP_URL || process.env.WEB_ORIGIN || 'http://localhost:3000';

        // Fingerprint: hash of UA + IP prefix
        const fingerprint = getDeviceFingerprint(ua, clientIp);
        const newDevice = isNewDevice(user.id, fingerprint);
        // Always record so subsequent logins from same device are silent
        recordDevice(user.id, fingerprint);

        if (newDevice) {
          const { subject, html } = getLoginAlertEmail({
            name: user.email,
            loginAt: new Date(),
            ipAddress: clientIp !== 'unknown' ? clientIp : undefined,
            device,
            country,
            resetPasswordUrl: `${appUrl}/account/forgot-password`,
          });
          await sendMail(user.email, subject, html, undefined, { from: SECURITY_EMAIL_FROM, replyTo: "support@nolsaf.com" });
        }
      } catch (e) {
        console.warn('[LOGIN] Sign-in alert email failed:', e);
      }
    }

    return res.status(200).json({ ok: true, token, user: { id: user.id, role: user.role, email: user.email } });
  } catch (e: any) {
    console.error("[LOGIN] login-password failed", e);
    
    // Ensure JSON response header is set
    res.setHeader('Content-Type', 'application/json');
    
    // Check for database connection errors in the outer catch as well
    const isConnectionError = 
      e?.code === 'P1001' ||
      e?.code === 'P1017' ||
      e?.message?.includes("Can't reach database server") ||
      e?.message?.includes("connect ECONNREFUSED") ||
      e?.message?.includes("Connection refused");
    
    if (isConnectionError) {
      return res.status(503).json({ 
        error: "database_unavailable",
        message: "Service temporarily unavailable. Please try again in a moment.",
        code: "DATABASE_UNAVAILABLE"
      });
    }
    
    // Return detailed error in development
    const errorResponse: any = {
      error: "service_error",
      message: process.env.NODE_ENV === 'production'
        ? "Login failed. Please try again."
        : (e?.message || String(e) || "Login failed"),
      code: "SERVICE_ERROR",
    };
    if (process.env.NODE_ENV !== 'production') {
      errorResponse.details = {
        message: e?.message,
        name: e?.name,
        code: e?.code,
      };
    }
    
    // Check if response already sent
    if (res.headersSent) {
      return;
    }
    
    try {
    return res.status(500).json(errorResponse);
    } catch (sendError: any) {
      console.error("[LOGIN] Failed to send error response:", sendError);
      // If we can't send response, pass to Express error handler
      next(e);
    }
  }
}));

// POST /api/auth/logout
// Use maybeAuth to optionally extract user for audit logging
function safeNextPath(raw: any): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return "/account/login";
  // Only allow same-site relative paths (avoid open redirects)
  if (!v.startsWith("/") || v.startsWith("//")) return "/account/login";
  return v;
}

function safeOwnerReportPrintNext(raw: any): string {
  const fallback = "/owner/reports/stays";
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v || !v.startsWith("/") || v.startsWith("//")) return fallback;
  if (!v.startsWith("/owner/reports/stays")) return fallback;
  return v;
}

router.get("/owner-report-print-handoff", asyncHandler(async (req, res) => {
  const rawToken = String((req as any).query?.token || "").trim();
  if (!rawToken) return res.status(400).send("Missing print handoff token.");

  const handoff = verifyOwnerReportPrintHandoff(rawToken);
  if (!handoff) return res.status(401).send("Invalid or expired print handoff token.");

  const user = await prisma.user.findUnique({
    where: { id: handoff.userId },
    select: { id: true, role: true, email: true, suspendedAt: true },
  });
  if (!user || user.suspendedAt || String(user.role || "").toUpperCase() !== "OWNER") {
    return res.status(403).send("Owner account is not allowed to print this report.");
  }

  const sessionToken = await signUserJwt({ id: user.id, role: user.role, email: user.email });
  await setAuthCookie(res, sessionToken, user.role);
  return res.redirect(302, safeOwnerReportPrintNext((req as any).query?.next));
}));

// GET /api/auth/logout?next=/account/login
// Useful for reliable cookie clearing via top-level navigation.
router.get("/logout", maybeAuth, async (req, res) => {
  const token = getAuthTokenFromRequest(req);
  try {
    const userId = (req as any).user?.id;
    if (userId) {
      const u = (req as any).user
      await audit(req, "USER_LOGOUT", `user:${userId}`, null, {
        role: u?.role ?? null,
        email: u?.email ?? null,
        event: "logout",
        success: true,
        logoutMethod: "manual",
        via: "GET",
      });
    }
  } catch (auditError) {
    console.warn("Failed to audit logout:", auditError);
  }

  await revokeCurrentSession(req).catch(() => {});
  if (token) await invalidateAuthSessionCacheForToken(token).catch(() => {});
  clearAuthCookie(res);
  const next = safeNextPath((req as any)?.query?.next);
  return res.redirect(302, next);
});

router.post("/logout", maybeAuth, async (req, res) => {
  const token = getAuthTokenFromRequest(req);
  // Audit logout if user is authenticated
  try {
    const userId = (req as any).user?.id;
    if (userId) {
      const u = (req as any).user
      await audit(req, "USER_LOGOUT", `user:${userId}`, null, { 
        role: u?.role ?? null,
        email: u?.email ?? null,
        event: "logout",
        success: true,
        logoutMethod: 'manual'
      });
    }
  } catch (auditError) {
    // Don't block logout if audit fails
    console.warn("Failed to audit logout:", auditError);
  }
  
  await revokeCurrentSession(req).catch(() => {});
  if (token) await invalidateAuthSessionCacheForToken(token).catch(() => {});
  clearAuthCookie(res);
  return res.json({ ok: true });
});

/**
 * POST /api/auth/register
 * Body: { email, name, phone, password, role?: 'CUSTOMER'|'OWNER'|'DRIVER'|'USER'|'TRAVELLER' }
 * NOTE: ADMIN creation is explicitly forbidden here. Registration must be DB-backed (no stub fallback).
 */
router.post('/register', limitRegisterAttempts, async (req, res) => {
  const { email, name, phone, password, role, referralCode, tin, address, vehicleMake, vehiclePlate, licenseNumber } = req.body as any;

  const cleanEmail = String(email || '').trim().toLowerCase();
  const cleanName = String(name || '').trim();
  if (!cleanEmail || !cleanEmail.includes('@')) return res.status(400).json({ error: 'invalid email' });
  if (!cleanName) return res.status(400).json({ error: 'name_required', message: 'Full name is required.' });
  if (!password || String(password).length < 1) return res.status(400).json({ error: 'password required' });

  const desiredRole = normalizeSignupRole(role) || 'CUSTOMER';
  if (desiredRole === 'RESET') return res.status(400).json({ error: 'invalid role' });

  const normalizedPhone = phone ? normalizePhoneForAuth(String(phone)) : null;
  if (!normalizedPhone || !isPhoneValidForAuth(normalizedPhone)) {
    return res.status(400).json({
      error: phone ? 'invalid_phone' : 'phone_required',
      message: phone && normalizedPhone ? getPhoneValidationMessage(normalizedPhone) : 'A valid phone number is required.',
    });
  }
  const registrationSource = resolveRegistrationSource({
    bodySource: req.body?.registrationSource,
    headerSource: req.headers['x-nolsaf-client'],
  });

  // Get Socket.IO instance from app
  const io: any = (req as any).app?.get?.('io');

  try {
    // Policy: once an email is verified (or already in use), do not allow a new registration.
    // Users must login or use forgot-password.
    const existingByEmail = await prisma.user.findFirst({
      where: { email: cleanEmail },
      select: { id: true, emailVerifiedAt: true },
    });
    if (existingByEmail?.emailVerifiedAt) {
      return res.status(409).json({
        error: 'email_already_registered',
        message: 'This email already has an account. Please login or use forgot password to access it.',
        action: 'login_or_forgot_password',
      });
    }
    if (existingByEmail) {
      return res.status(409).json({
        error: 'email_already_in_use',
        message: 'This email is already linked to an account. Please login or use forgot password.',
        action: 'login_or_forgot_password',
      });
    }

    // Check for referral code and find referring driver or customer
    let referredBy: string | number | null = null;
    let referrerKind: 'DRIVER' | 'CUSTOMER' | null = null;
    if (referralCode) {
      try {
        // Driver referral code format: DRIVER-XXXXXX
        const driverMatch = String(referralCode).match(/^DRIVER-(\d+)$/i);
        // Customer (invite friends) referral code format: CUSTOMER-XXXXXX
        const customerMatch = String(referralCode).match(/^CUSTOMER-(\d+)$/i);
        if (driverMatch) {
          const candidateId = parseInt(driverMatch[1], 10);
          const driver = await prisma.user.findUnique({ where: { id: candidateId, role: 'DRIVER' } as any });
          if (driver) {
            referredBy = candidateId;
            referrerKind = 'DRIVER';
          }
        } else if (customerMatch) {
          const candidateId = parseInt(customerMatch[1], 10);
          const referrer = await prisma.user.findUnique({ where: { id: candidateId }, select: { id: true } });
          if (referrer) {
            referredBy = candidateId;
            referrerKind = 'CUSTOMER';
          }
        }
      } catch (e) {
        console.warn('Failed to process referral code', referralCode, e);
      }
    }

    const strength = await validatePasswordWithSettings(String(password), desiredRole);
    if (!strength.valid) return res.status(400).json({ error: 'weak_password', reasons: strength.reasons });

    // Policy: disallow registering a second account with an already-verified phone.
    if (normalizedPhone) {
      const existingByPhone = await prisma.user.findFirst({
        where: { phone: normalizedPhone },
        select: { id: true, phoneVerifiedAt: true },
      });
      if (existingByPhone?.phoneVerifiedAt) {
        return res.status(409).json({
          error: 'phone_already_registered',
          message: 'This phone number already has an account. Please login or use forgot password to access it.',
          action: 'login_or_forgot_password',
        });
      }
      // Even if not verified, the unique constraint will block duplicates; return a clearer message.
      if (existingByPhone) {
        return res.status(409).json({
          error: 'phone_already_in_use',
          message: 'This phone number is already linked to an account. Please login or use forgot password.',
          action: 'login_or_forgot_password',
        });
      }
    }

    const pwHash = await hashPassword(String(password));
    const created = await prisma.user.create({
      data: {
        email: cleanEmail,
        name: cleanName,
        phone: normalizedPhone,
        role: desiredRole,
        passwordHash: pwHash,
        registrationStatus: 'COMPLETE',
        registrationSource,
        profileCompletedAt: new Date(),
        ...(desiredRole === 'OWNER'
          ? {
              tin: typeof tin === 'string' ? tin : null,
              address: typeof address === 'string' ? address : null,
            }
          : {}),
        ...(desiredRole === 'DRIVER'
          ? {
              vehicleMake: typeof vehicleMake === 'string' ? vehicleMake : null,
              vehiclePlate: typeof vehiclePlate === 'string' ? vehiclePlate : null,
              plateNumber: typeof vehiclePlate === 'string' ? vehiclePlate : null,
              licenseNumber: typeof licenseNumber === 'string' ? licenseNumber : null,
            }
          : {}),
        referredBy: referredBy as any,
        referralCode: referralCode || null,
      } as any,
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        role: true,
        registrationStatus: true,
        registrationSource: true,
        profileCompletedAt: true,
      }
    });

    try {
      await addPasswordToHistory(created.id, pwHash);
    } catch {
      // ignore
    }

    // Emit Socket.IO notification to referring driver if applicable
    if (referredBy && referrerKind === 'DRIVER' && io) {
      try {
        // Emit notification to driver immediately
        io.to(`driver:${referredBy}`).emit('referral-notification', {
          type: 'new_referral',
          message: `${created.name || created.email || 'Someone'} just registered using your referral link!`,
          referralData: {
            userId: created.id,
            name: created.name,
            email: created.email,
            role: desiredRole,
            registeredAt: new Date().toISOString(),
          }
        });

        // Emit full referral update (will trigger frontend to refresh data)
        io.to(`driver:${referredBy}`).emit('referral-update', {
          driverId: referredBy,
          timestamp: Date.now(),
          action: 'new_referral',
        });
      } catch (e) {
        console.warn('Failed to emit referral notification', e);
      }
    }

    // Notify the referring traveller that their invite link was used
    if (referredBy && referrerKind === 'CUSTOMER') {
      try {
        await prisma.notification.create({
          data: {
            userId: referredBy,
            title: 'Your friend joined NoLSAF!',
            body: `${created.name || created.email || 'A friend'} signed up using your invite link.`,
            type: 'referral',
          },
        });
      } catch (e) {
        console.warn('Failed to create referral notification', e);
      }
    }

    return res.status(201).json({
      ok: true,
      id: created.id,
      email: created.email,
      role: created.role,
      registrationStatus: created.registrationStatus,
      registrationSource: created.registrationSource,
      profileCompletedAt: created.profileCompletedAt,
    });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      const target = (err?.meta?.target || []) as any;
      const targetArr = Array.isArray(target) ? target.map(String) : [String(target)];
      if (targetArr.some((t) => t.toLowerCase().includes('phone'))) {
        return res.status(409).json({
          error: 'phone_already_registered',
          message: 'This phone number already has an account. Please login or use forgot password to access it.',
          action: 'login_or_forgot_password',
        });
      }
      if (targetArr.some((t) => t.toLowerCase().includes('email'))) {
        return res.status(409).json({
          error: 'email_already_registered',
          message: 'This email already has an account. Please login or use forgot password to access it.',
          action: 'login_or_forgot_password',
        });
      }
      return res.status(409).json({ error: 'email_or_phone_already_in_use' });
    }
    console.error('Prisma create failed in /api/auth/register:', err);
    return res.status(503).json({ error: 'database_unavailable', message: 'Unable to register right now.' });
  }
});

/**
 * POST /api/auth/profile
 * Creates or updates user profile after OTP verification and onboarding
 * Body: FormData with role, name, email, and optional referralCode
 */
router.post('/profile', upload.none(), async (req, res) => {
  try {
    // Parse form data (multer handles multipart/form-data)
    const body = req.body;
    const registrationSource = resolveRegistrationSource({
      bodySource: body?.registrationSource,
      headerSource: req.headers['x-nolsaf-client'],
    });
    const {
      role,
      name,
      email,
      phone,
      password,
      referralCode,
      tin,
      address,
      gender,
      nationality,
      dateOfBirth,
      nin,
      licenseNumber,
      plateNumber,
      vehicleType,
      operationArea,
      region,
      district,
      paymentPhone,
      paymentVerified,
      isVipDriver,
    } = body;
    const parseOptionalDate = (value: unknown): Date | null | undefined => {
      if (typeof value === 'undefined') return undefined;
      const raw = String(value ?? '').trim();
      if (!raw) return null;
      const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00.000Z` : raw;
      const parsed = new Date(iso);
      return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    };
    
    // Get user from token (Authorization: Bearer OR httpOnly cookie)
    const token =
      req.headers.authorization?.replace('Bearer ', '') ||
      (() => {
        const raw = req.headers.cookie || "";
        const part = raw.split(";").map((s) => s.trim()).find((s) => s.startsWith("nolsaf_token="));
        if (!part) return "";
        return decodeURIComponent(part.slice("nolsaf_token=".length));
      })();
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const secret = getJwtSecret();
    if (!secret) return res.status(500).json({ error: 'server_misconfigured' });

    let userId: number | null = null;
    try {
      const decoded = jwt.verify(token, secret) as any;
      userId = decoded?.sub ? Number(decoded.sub) : null;
    } catch {
      userId = null;
    }
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Enforce that the role in the request (if any) matches the user's role (prevents role hopping)
    let dbRole: string | null = null;
    let hasPasswordAlready = false;
    let currentKycStatus: string | null = null;
    let currentEmail: string | null = null;
    let currentPhone: string | null = null;
    let currentEmailVerifiedAt: Date | null = null;
    let currentPhoneVerifiedAt: Date | null = null;
    let currentName: string | null = null;
    let currentRegistrationSource = 'UNKNOWN';
    let currentProfileCompletedAt: Date | null = null;
    try {
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          email: true,
          phone: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          name: true,
          fullName: true,
          registrationSource: true,
          profileCompletedAt: true,
          passwordHash: true,
          kycStatus: true,
        } as any,
      });
      if (!dbUser) return res.status(401).json({ error: 'Unauthorized' });
      currentKycStatus = (dbUser as any)?.kycStatus ?? null;
      currentEmail = (dbUser as any)?.email ?? null;
      currentPhone = (dbUser as any)?.phone ?? null;
      currentEmailVerifiedAt = (dbUser as any)?.emailVerifiedAt ?? null;
      currentPhoneVerifiedAt = (dbUser as any)?.phoneVerifiedAt ?? null;
      currentName = String((dbUser as any)?.name || (dbUser as any)?.fullName || '').trim() || null;
      currentRegistrationSource = String((dbUser as any)?.registrationSource || 'UNKNOWN');
      currentProfileCompletedAt = (dbUser as any)?.profileCompletedAt ?? null;
      const requested = normalizeSignupRole(role);
      // Normalize DB roles too (e.g. USER/TRAVELLER should be treated as CUSTOMER)
      dbRole = normalizeSignupRole(dbUser.role) || String(dbUser.role || '').trim().toUpperCase();
      if (requested && requested !== 'RESET' && dbRole !== requested) {
        return res.status(400).json({
          error: 'role_mismatch',
          message: `Role mismatch: account role is ${dbRole || 'UNKNOWN'} but request role is ${requested}.`,
        });
      }
      hasPasswordAlready = Boolean((dbUser as any)?.passwordHash);
    } catch (e) {
      return res.status(503).json({ error: 'database_unavailable', message: 'Unable to save profile right now.' });
    }

    // Get Socket.IO instance from app
    const io: any = (req as any).app?.get?.('io');

    // Check for referral code and find referring driver or customer
    let referredBy: string | number | null = null;
    let referrerKind: 'DRIVER' | 'CUSTOMER' | null = null;
    if (referralCode) {
      try {
        // Driver referral code format: DRIVER-XXXXXX
        const driverMatch = String(referralCode).match(/^DRIVER-(\d+)$/i);
        // Customer (invite friends) referral code format: CUSTOMER-XXXXXX
        const customerMatch = String(referralCode).match(/^CUSTOMER-(\d+)$/i);
        if (driverMatch) {
          const candidateId = parseInt(driverMatch[1], 10);
          const driver = await prisma.user.findUnique({ where: { id: candidateId, role: 'DRIVER' } as any });
          if (driver) {
            referredBy = candidateId;
            referrerKind = 'DRIVER';
          }
        } else if (customerMatch) {
          const candidateId = parseInt(customerMatch[1], 10);
          const referrer = await prisma.user.findUnique({ where: { id: candidateId }, select: { id: true } });
          if (referrer) {
            referredBy = candidateId;
            referrerKind = 'CUSTOMER';
          }
        }
      } catch (e) {
        console.warn('Failed to process referral code', referralCode, e);
      }
    }

    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanPhone = phone ? normalizePhoneForAuth(String(phone)) : null;
    const cleanName = name ? String(name).trim() : null;
    if (!currentName && !cleanName) {
      return res.status(400).json({ error: 'name_required', message: 'Full name is required.' });
    }
    if (!currentEmail && !cleanEmail) {
      return res.status(400).json({ error: 'email_required', message: 'Email address is required.' });
    }
    if (
      currentEmailVerifiedAt &&
      cleanEmail &&
      String(currentEmail || '').trim().toLowerCase() !== cleanEmail
    ) {
      return res.status(409).json({
        error: 'email_change_requires_verification',
        message: 'This verified email cannot be changed during onboarding. Use Account Security after registration.',
      });
    }
    if (phone && (!cleanPhone || !isPhoneValidForAuth(cleanPhone))) {
      return res.status(400).json({
        error: 'invalid_phone',
        message: cleanPhone ? getPhoneValidationMessage(cleanPhone) : 'A valid phone number is required.',
      });
    }
    if (!currentPhone && !cleanPhone) {
      return res.status(400).json({ error: 'phone_required', message: 'Phone number is required.' });
    }
    if (
      currentPhoneVerifiedAt &&
      currentPhone &&
      cleanPhone &&
      normalizePhoneForAuth(currentPhone) !== cleanPhone
    ) {
      return res.status(409).json({
        error: 'phone_change_requires_verification',
        message: 'This verified phone cannot be changed during onboarding. Use Account Security after registration.',
      });
    }
    if (cleanPhone) {
      try {
        const phoneVariants = buildAuthPhoneVariants(cleanPhone);
        const existingPhone = await prisma.user.findFirst({
          where: { phone: { in: phoneVariants }, id: { not: userId } },
          select: { id: true },
        });
        if (existingPhone) {
          return res.status(409).json({
            error: 'phone_already_registered',
            message: 'This phone number already has an account. Please login or use forgot password to access it.',
            action: 'login_or_forgot_password',
          });
        }
      } catch {
        return res.status(503).json({
          error: 'database_unavailable',
          message: 'Unable to check this phone number right now. Please try again.',
        });
      }
    }
    if (cleanEmail) {
      try {
        const existingEmail = await prisma.user.findFirst({
          where: { email: cleanEmail, id: { not: userId } },
          select: { id: true },
        });
        if (existingEmail) {
          return res.status(409).json({
            error: 'email_already_registered',
            message: 'This email address already has an account. Please login or use forgot password to access it.',
            action: 'login_or_forgot_password',
          });
        }
      } catch {
        return res.status(503).json({
          error: 'database_unavailable',
          message: 'Unable to check this email address right now. Please try again.',
        });
      }
    }
    let updatedUser: any = null;
    let newPasswordHash: string | null = null;
    const extractUnknownArg = (err: any): string | null => {
      const msg = String(err?.message ?? '');
      const m = msg.match(/Unknown argument `([^`]+)`/);
      return m?.[1] ?? null;
    };
    try {
      // Some environments may run with an older generated Prisma Client that doesn't
      // include newer columns yet (e.g., gender/nationality/tin/address/etc).
      // Avoid passing unknown fields (Prisma validates args before hitting the DB).
      const meta = (prisma as any).user?._meta ?? {};
      // When _meta is unavailable (empty object), default hasField to true so that all schema
      // fields are attempted; the P2022 error-retry below strips any truly unknown column.
      const metaHasEntries = Object.keys(meta).length > 0;
      const hasField = (field: string) => !metaHasEntries || Object.prototype.hasOwnProperty.call(meta, field);

      const dataToUpdate: any = {
        name: cleanName || undefined,
        email: cleanEmail || undefined,
        phone:
          cleanPhone &&
          (!currentPhone || (!currentPhoneVerifiedAt && normalizePhoneForAuth(currentPhone) !== cleanPhone))
            ? cleanPhone
            : undefined,
        registrationStatus: 'COMPLETE',
        profileCompletedAt: currentProfileCompletedAt || new Date(),
        ...(currentRegistrationSource === 'UNKNOWN' && registrationSource !== 'UNKNOWN'
          ? { registrationSource }
          : {}),
      };

      // Allow setting a password during onboarding so users can login with email/password.
      // For safety: only set if the account does not already have a password.
      if (!hasPasswordAlready && typeof password === 'string' && password.trim().length > 0) {
        const strength = await validatePasswordWithSettings(String(password), dbRole);
        if (!strength.valid) return res.status(400).json({ error: 'weak_password', reasons: strength.reasons });
        newPasswordHash = await hashPassword(String(password));
        dataToUpdate.passwordHash = newPasswordHash;
      }

      // Owner fields
      if (hasField('tin') && typeof tin === 'string') dataToUpdate.tin = tin;
      if (hasField('address') && typeof address === 'string') dataToUpdate.address = address;

      // Driver fields
      if (hasField('gender') && typeof gender === 'string') dataToUpdate.gender = gender;
      if (hasField('nationality') && typeof nationality === 'string') dataToUpdate.nationality = nationality;
      if (hasField('dateOfBirth') && typeof dateOfBirth !== 'undefined') {
        const parsedDateOfBirth = parseOptionalDate(dateOfBirth);
        if (typeof parsedDateOfBirth !== 'undefined') dataToUpdate.dateOfBirth = parsedDateOfBirth;
      }
      if (hasField('nin') && typeof nin === 'string') dataToUpdate.nin = nin;
      if (hasField('licenseNumber') && typeof licenseNumber === 'string') dataToUpdate.licenseNumber = licenseNumber;
      if (hasField('plateNumber') && typeof plateNumber === 'string') {
        dataToUpdate.plateNumber = plateNumber;
        dataToUpdate.vehiclePlate = plateNumber; // keep fields in sync
      }
      if (hasField('vehicleType') && typeof vehicleType === 'string') dataToUpdate.vehicleType = vehicleType;
      if (hasField('operationArea') && typeof operationArea === 'string') dataToUpdate.operationArea = operationArea;
      if (hasField('region') && typeof region === 'string') dataToUpdate.region = region;
      if (hasField('district') && typeof district === 'string') dataToUpdate.district = district;
      if (hasField('paymentPhone') && typeof paymentPhone === 'string') dataToUpdate.paymentPhone = paymentPhone;
      if (hasField('paymentVerified') && typeof paymentVerified !== 'undefined') {
        dataToUpdate.paymentVerified =
          String(paymentVerified) === '1' || String(paymentVerified).toLowerCase() === 'true';
      }
      if (hasField('isVipDriver') && typeof isVipDriver !== 'undefined') {
        dataToUpdate.isVipDriver =
          String(isVipDriver) === 'true' || String(isVipDriver) === '1';
      }

      // Only move driver to PENDING_KYC when they explicitly submit for review.
      const submitForReview = String(body?.submitForReview ?? '') === 'true';
      if ((dbRole === 'DRIVER') && submitForReview) {
        const missingProfileFields: string[] = [];
        if (!(typeof dateOfBirth === 'string' && dateOfBirth.trim())) missingProfileFields.push('date of birth');
        if (!(typeof licenseNumber === 'string' && licenseNumber.trim())) missingProfileFields.push('license number');
        if (!(typeof vehicleType === 'string' && vehicleType.trim())) missingProfileFields.push('vehicle type');
        if (!(typeof plateNumber === 'string' && plateNumber.trim())) missingProfileFields.push('plate number');
        if (!(typeof region === 'string' && region.trim())) missingProfileFields.push('region');
        if (!(typeof district === 'string' && district.trim())) missingProfileFields.push('district');
        if (!(typeof operationArea === 'string' && operationArea.trim())) missingProfileFields.push('operation area');
        if (!(typeof paymentPhone === 'string' && paymentPhone.trim())) missingProfileFields.push('payment phone');

        const paymentIsVerified =
          String(paymentVerified) === '1' || String(paymentVerified).toLowerCase() === 'true';
        if (!paymentIsVerified) missingProfileFields.push('verified payment phone');

        if (missingProfileFields.length > 0) {
          return res.status(400).json({
            error: 'incomplete_driver_onboarding',
            message: `Complete all required driver details before submission. Missing: ${missingProfileFields.join(', ')}.`,
          });
        }

        if (!(prisma as any).userDocument) {
          return res.status(503).json({
            error: 'driver_documents_unavailable',
            message: 'Driver document storage is unavailable. Please upload documents again when the service is restored.',
          });
        }

        const requiredDocumentGroups = [
          { label: 'driving licence', types: ['DRIVER_LICENSE', 'DRIVING_LICENSE', 'DRIVER_LICENCE', 'DRIVING_LICENCE', 'LICENSE'] },
          { label: 'National ID', types: ['NATIONAL_ID', 'ID', 'PASSPORT'] },
          { label: 'vehicle registration', types: ['VEHICLE_REGISTRATION', 'LATRA', 'VEHICLE_REG'] },
          { label: 'insurance certificate', types: ['INSURANCE'] },
        ];

        const docs = await prisma.userDocument.findMany({
          where: { userId, url: { not: null } } as any,
          select: { type: true, url: true } as any,
        });
        const presentTypes = new Set((docs as any[]).map((doc) => String(doc?.type ?? '').toUpperCase()));
        const missingDocuments = requiredDocumentGroups
          .filter((group) => !group.types.some((type) => presentTypes.has(type)))
          .map((group) => group.label);

        if (missingDocuments.length > 0) {
          return res.status(400).json({
            error: 'missing_driver_documents',
            message: `Upload all required driver documents before submission. Missing: ${missingDocuments.join(', ')}.`,
          });
        }
      }
      if (
        (dbRole === 'DRIVER') && submitForReview &&
        typeof licenseNumber === 'string' && licenseNumber.trim() &&
        typeof vehicleType === 'string' && vehicleType.trim() &&
        typeof plateNumber === 'string' && plateNumber.trim()
      ) {
        if (!currentKycStatus || currentKycStatus === 'PENDING_KYC') {
          dataToUpdate.kycStatus = 'PENDING_KYC';
        }
        // Clear admin note so driver sees "Under Review" instead of "Action Required"
        (dataToUpdate as any).kycNote = null;
      }

      // Referral fields
      if (hasField('referredBy')) dataToUpdate.referredBy = referredBy as any;
      if (hasField('referralCode')) dataToUpdate.referralCode = referralCode || null;

      updatedUser = await prisma.user.update({
        where: { id: userId },
        data: dataToUpdate,
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          role: true,
          registrationStatus: true,
          registrationSource: true,
          profileCompletedAt: true,
        }
      });

      // After a successful resubmit, write an audit log entry so admin can see it
      if ((dbRole === 'DRIVER') && submitForReview) {
        try {
          await (prisma as any).kycAuditLog.create({
            data: {
              driverId: userId,
              adminId: null,
              action: 'resubmitted',
              note: 'Driver resubmitted application for review.',
              fieldApprovals: null,
            },
          });
        } catch {
          // non-fatal — audit log table may not exist on older DBs
        }
      }
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const target = Array.isArray(e?.meta?.target) ? e.meta.target.map(String) : [String(e?.meta?.target || '')];
        const phoneConflict = target.some((field: string) => field.toLowerCase().includes('phone'));
        return res.status(409).json({
          error: phoneConflict ? 'phone_already_registered' : 'email_already_registered',
          message: phoneConflict
            ? 'This phone number already has an account. Please login or use forgot password to access it.'
            : 'This email already has an account. Please login or use forgot password to access it.',
          action: 'login_or_forgot_password',
        });
      }

      // Last line of defense: retry once by dropping the unknown field Prisma complains about.
      const badField = (typeof (prisma as any).user?._meta === 'undefined') ? null : extractUnknownArg(e);
      if (badField) {
        try {
          const retryData: any = {
            name: cleanName || undefined,
            email: cleanEmail || undefined,
            phone:
              cleanPhone &&
              (!currentPhone || (!currentPhoneVerifiedAt && normalizePhoneForAuth(currentPhone) !== cleanPhone))
                ? cleanPhone
                : undefined,
            // Best-effort include common fields; we'll drop the bad one below.
            tin: typeof tin === 'string' ? tin : undefined,
            address: typeof address === 'string' ? address : undefined,
            gender: typeof gender === 'string' ? gender : undefined,
            nationality: typeof nationality === 'string' ? nationality : undefined,
            dateOfBirth: typeof dateOfBirth !== 'undefined' ? parseOptionalDate(dateOfBirth) : undefined,
            nin: typeof nin === 'string' ? nin : undefined,
            licenseNumber: typeof licenseNumber === 'string' ? licenseNumber : undefined,
            plateNumber: typeof plateNumber === 'string' ? plateNumber : undefined,
            vehicleType: typeof vehicleType === 'string' ? vehicleType : undefined,
            operationArea: typeof operationArea === 'string' ? operationArea : undefined,
            region: typeof region === 'string' ? region : undefined,
            district: typeof district === 'string' ? district : undefined,
            paymentPhone: typeof paymentPhone === 'string' ? paymentPhone : undefined,
            paymentVerified:
              typeof paymentVerified !== 'undefined'
                ? (String(paymentVerified) === '1' || String(paymentVerified).toLowerCase() === 'true')
                : undefined,
            isVipDriver:
              typeof isVipDriver !== 'undefined'
                ? (String(isVipDriver) === 'true' || String(isVipDriver) === '1')
                : undefined,
            referredBy: referredBy as any,
            referralCode: referralCode || null,
            registrationStatus: 'COMPLETE',
            profileCompletedAt: currentProfileCompletedAt || new Date(),
            ...(currentRegistrationSource === 'UNKNOWN' && registrationSource !== 'UNKNOWN'
              ? { registrationSource }
              : {}),
          };
          delete retryData[badField];
          updatedUser = await prisma.user.update({
            where: { id: userId },
            data: retryData as any,
            select: {
              id: true,
              email: true,
              phone: true,
              name: true,
              role: true,
              registrationStatus: true,
              registrationSource: true,
              profileCompletedAt: true,
            },
          });
        } catch (e2: any) {
          throw e2;
        }
      } else {
        throw e;
      }
    }

    if (newPasswordHash) {
      try {
        await addPasswordToHistory(userId, newPasswordHash);
      } catch {
        // ignore
      }
    }

    // Emit Socket.IO notification to referring driver if applicable
    if (referredBy && referrerKind === 'DRIVER' && io && updatedUser) {
      try {
        // Emit notification to driver immediately
        io.to(`driver:${referredBy}`).emit('referral-notification', {
          type: 'new_referral',
          message: `${updatedUser.name || updatedUser.email || 'Someone'} just registered using your referral link!`,
          referralData: {
            userId: updatedUser.id,
            name: updatedUser.name,
            email: updatedUser.email,
            role: updatedUser.role,
            registeredAt: new Date().toISOString(),
          }
        });

        // Emit full referral update (will trigger frontend to refresh data)
        io.to(`driver:${referredBy}`).emit('referral-update', {
          driverId: referredBy,
          timestamp: Date.now(),
          action: 'new_referral',
        });
      } catch (e) {
        console.warn('Failed to emit referral notification', e);
      }
    }

    // Notify the referring traveller that their invite link was used
    if (referredBy && referrerKind === 'CUSTOMER' && updatedUser) {
      try {
        await prisma.notification.create({
          data: {
            userId: referredBy,
            title: 'Your friend joined NoLSAF!',
            body: `${updatedUser.name || updatedUser.email || 'A friend'} signed up using your invite link.`,
            type: 'referral',
          },
        });
      } catch (e) {
        console.warn('Failed to create referral notification', e);
      }
    }

    return res.json({ ok: true, user: updatedUser });
  } catch (err: any) {
    console.error('Failed to save profile', err);
    return res.status(500).json({ error: 'Failed to save profile', message: err.message });
  }
});

// ─── Passkey sign-in (unauthenticated) ──────────────────

const passkeyLoginChallenges = new Map<string, { challenge: string; expiresAt: number }>();
const PASSKEY_LOGIN_CHALLENGE_TTL_SEC = 2 * 60;
const REDIS_PASSKEY_LOGIN_CHALLENGE_PREFIX = 'auth:passkey:login:';

async function storePasskeyLoginChallenge(sessionId: string, challenge: string): Promise<void> {
  const expiresAt = Date.now() + PASSKEY_LOGIN_CHALLENGE_TTL_SEC * 1000;
  const payload = JSON.stringify({ challenge, expiresAt });
  try {
    const r = getRedis();
    if (r) {
      await r.set(`${REDIS_PASSKEY_LOGIN_CHALLENGE_PREFIX}${sessionId}`, payload, 'EX', PASSKEY_LOGIN_CHALLENGE_TTL_SEC);
      return;
    }
  } catch {
    // Ignore and fall back to in-memory challenge store.
  }
  passkeyLoginChallenges.set(sessionId, { challenge, expiresAt });
}

async function getPasskeyLoginChallenge(sessionId: string): Promise<{ challenge: string; expiresAt: number } | null> {
  try {
    const r = getRedis();
    if (r) {
      const raw = await r.get(`${REDIS_PASSKEY_LOGIN_CHALLENGE_PREFIX}${sessionId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { challenge?: string; expiresAt?: number };
      if (!parsed?.challenge || typeof parsed?.expiresAt !== 'number') return null;
      return { challenge: parsed.challenge, expiresAt: parsed.expiresAt };
    }
  } catch {
    // Ignore and fall back to in-memory challenge store.
  }

  const fallback = passkeyLoginChallenges.get(sessionId) || null;
  if (!fallback) return null;
  if (fallback.expiresAt < Date.now()) {
    passkeyLoginChallenges.delete(sessionId);
    return null;
  }
  return fallback;
}

async function deletePasskeyLoginChallenge(sessionId: string): Promise<void> {
  try {
    const r = getRedis();
    if (r) {
      await r.del(`${REDIS_PASSKEY_LOGIN_CHALLENGE_PREFIX}${sessionId}`);
    }
  } catch {
    // Ignore delete errors; in-memory entry is still cleared below.
  }
  passkeyLoginChallenges.delete(sessionId);
}

function fromBase64UrlToBuffer(s: string): Buffer {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

function toBase64UrlFromBuffer(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeBase64Url(input: unknown): string {
  return String(input ?? '').trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** POST /api/auth/passkeys/options — returns WebAuthn authentication options (discoverable) */
router.post('/passkeys/options', async (req, res) => {
  try {
    const { rpID } = getWebAuthnRp();

    const options = await generateAuthenticationOptions({
      timeout: 60000,
      rpID,
      userVerification: 'required',
      allowCredentials: [], // empty = discoverable credentials (no username required)
    });

    const sessionId = crypto.randomBytes(16).toString('hex');
    await storePasskeyLoginChallenge(sessionId, (options as any).challenge as string);

    return res.json({ sessionId, publicKey: options });
  } catch {
    return res.status(500).json({ error: 'failed' });
  }
});

/** POST /api/auth/passkeys/verify — verifies assertion and issues session cookie */
router.post('/passkeys/verify', async (req, res) => {
  try {
    const { sessionId, response, loginApp } = (req.body ?? {}) as any;
    if (!sessionId || !response) return res.status(400).json({ error: 'invalid payload' });

    const entry = await getPasskeyLoginChallenge(String(sessionId));
    if (!entry) return res.status(400).json({ error: 'session expired or not found' });
    if (entry.expiresAt < Date.now()) {
      await deletePasskeyLoginChallenge(String(sessionId));
      return res.status(400).json({ error: 'challenge expired' });
    }

    const credId = normalizeBase64Url(response.id || response.rawId);
    if (!credId) return res.status(400).json({ error: 'missing credential id' });

    const candidateCredentialIds = new Set<string>();
    if (credId) candidateCredentialIds.add(credId);

    const rawIdNorm = normalizeBase64Url(response.rawId);
    if (rawIdNorm) {
      candidateCredentialIds.add(rawIdNorm);
      try {
        const rawBuf = fromBase64UrlToBuffer(rawIdNorm);
        candidateCredentialIds.add(toBase64UrlFromBuffer(rawBuf));
      } catch {
        // ignore malformed rawId conversions
      }
    }

    // Look up passkey by credentialId
    let stored: any = null;
    try {
      if ((prisma as any).passkey) {
        stored = await (prisma as any).passkey.findFirst({
          where: { credentialId: { in: Array.from(candidateCredentialIds) } },
        });
      }
    } catch { /* ignore */ }
    if (!stored) {
      return res.status(400).json({
        error: 'You dont have the Passkey try signing with another option and add passkey after login',
      });
    }

    const { rpID, expectedOrigins } = getWebAuthnRp();

    let verification: any = null;
    try {
      verification = await (verifyAuthenticationResponse as any)({
        response, // the full assertion object
        expectedChallenge: entry.challenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        authenticator: {
          credentialID: stored.credentialId,
          credentialPublicKey: fromBase64UrlToBuffer(stored.publicKey),
          counter: typeof stored.signCount === 'number' ? stored.signCount : 0,
        },
        requireUserVerification: true,
      } as any);
    } catch (e) {
      const details = String((e as any)?.message ?? e);
      return res.status(400).json({ error: 'verification failed', details: process.env.NODE_ENV !== 'production' ? details : undefined });
    }

    if (!verification?.verified) return res.status(400).json({ error: 'verification failed' });

    await deletePasskeyLoginChallenge(String(sessionId));

    // Update sign count
    const newCounter = verification.authenticationInfo?.newCounter ?? verification.authenticationInfo?.counter;
    if (typeof newCounter === 'number') {
      try {
        await (prisma as any).passkey.update({ where: { credentialId: stored.credentialId }, data: { signCount: newCounter } });
      } catch { /* ignore */ }
    }

    // Find user and issue session
    const user = await prisma.user.findUnique({ where: { id: stored.userId } } as any);
    if (!user) return res.status(400).json({ error: 'user not found' });

    if ((user as any).suspendedAt || (user as any).isDisabled) {
      return res.status(403).json({
        error: 'account_suspended',
        code: 'ACCOUNT_SUSPENDED',
        message: 'This account cannot access NoLSAF at the moment.',
        blockedAccount: buildBlockedAccountPayload(user),
      });
    }

    const loginAppRoleError = getLoginAppRoleError((user as any).role, loginApp);
    if (loginAppRoleError) {
      return res.status(403).json(loginAppRoleError);
    }

    const isAdmin = String((user as any).role || '').toUpperCase() === 'ADMIN';
    const token = await signUserJwt(
      { id: (user as any).id, role: (user as any).role, email: (user as any).email },
      isAdmin ? { adminMfa: 'passkey' } : undefined,
    );
    await setAuthCookie(res, token, (user as any).role);

    // Native apps cannot read the httpOnly cookie; they consume the token from
    // the body (same contract as the OTP login response).
    return res.json({ ok: true, token, user: { id: (user as any).id, role: (user as any).role } });
  } catch {
    return res.status(500).json({ error: 'failed' });
  }
});

export default router;

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email, phone, resetApp } = req.body || {};
  if (!email && !phone) return res.status(400).json({ message: 'email or phone required' });

  const normalizedPhone = phone ? normalizePhoneForAuth(String(phone)) : null;

  try {
    // try to find user by email or phone
    const user = await prisma.user.findFirst({
      where: email ? { email: String(email).trim().toLowerCase() } : { phone: normalizedPhone || String(phone) },
    });
    
    if (!user) {
      return res.status(404).json({
        error: 'account_not_found',
        message: `No account found for this ${email ? 'email address' : 'phone number'}. Please check the details or register first.`,
        action: 'register',
      });
    }

    const rolePolicyError = getResetRolePolicyError((user as any).role);
    if (rolePolicyError) {
      return res.status(403).json(rolePolicyError);
    }
    const appRoleError = getResetAppRoleError((user as any).role, resetApp);
    if (appRoleError) {
      return res.status(409).json(appRoleError);
    }

    // generate raw token and a hashed token for storage
    const raw = crypto.randomBytes(24).toString('hex');
    const hashed = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = Date.now() + 1000 * 60 * 60; // 1 hour

    // Try to persist hashed token to user record if schema allows
    try {
      await prisma.user.update({ where: { id: user.id }, data: { resetPasswordToken: hashed as any, resetPasswordExpires: new Date(expiresAt) as any } as any });
    } catch (e) {
      // fallback to in-memory store
      resetTokenStore[hashed] = { userId: String(user.id), expiresAt };
    }

    // Build reset link
    const origin = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || 'http://localhost:3000';
    const resetLink = `${origin}/account/reset-password?token=${raw}&id=${user.id}`;

    // Send via email if available, otherwise via SMS
    if (user.email) {
      try {
        const { subject: resetSubject, html: resetHtml } = getPasswordResetEmail(user.name || user.email || 'there', resetLink);
        await sendMail(user.email, resetSubject, resetHtml, undefined, { from: SECURITY_EMAIL_FROM, replyTo: "support@nolsaf.com" });
      } catch (e) {
        console.warn('Failed to send reset email:', e);
      }
    } else if (user.phone) {
      try {
        await sendSms(String(user.phone), `Reset your password: ${resetLink}`);
      } catch (e) {
        console.warn('Failed to send reset SMS:', e);
      }
    }

    return res.json({ ok: true, message: 'Password reset instructions sent. Please check your email or phone.' });
  } catch (err) {
    console.error('forgot-password error', err);
    return res.status(500).json({ message: 'failed' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, userId, id, password } = req.body || {};
  const rawUserId = typeof userId !== 'undefined' ? userId : id;
  if (!token || !rawUserId || !password) return res.status(400).json({ message: 'token, userId and password required' });

  const userIdStr = String(rawUserId);
  const normalizedUserId: any = /^\d+$/.test(userIdStr) ? Number(userIdStr) : rawUserId;

  const hashed = crypto.createHash('sha256').update(String(token)).digest('hex');

  try {
    // Check DB first
    let user: any = null;
    try {
      user = await prisma.user.findUnique({ where: { id: normalizedUserId as any } });
      if (user && user.resetPasswordToken) {
        const dbToken = String(user.resetPasswordToken);
        const expires = user.resetPasswordExpires ? new Date(user.resetPasswordExpires).getTime() : 0;
        if (dbToken !== hashed) return res.status(400).json({ message: 'invalid token' });
        if (Date.now() > expires) return res.status(400).json({ message: 'token expired' });
      } else if (user && !user.resetPasswordToken) {
        // Token was already consumed — password was already set
        return res.status(400).json({ message: 'password_already_set' });
      } else {
        user = null; // fall back to memory
      }
    } catch (e) {
      user = null;
    }

    // If not persisted, check in-memory store
    if (!user) {
      const rec = resetTokenStore[hashed];
      if (!rec || String(rec.userId) !== userIdStr) return res.status(400).json({ message: 'invalid token' });
      if (Date.now() > rec.expiresAt) { delete resetTokenStore[hashed]; return res.status(400).json({ message: 'token expired' }); }
      // fetch user record to update password
      try { user = await prisma.user.findUnique({ where: { id: normalizedUserId as any } }); } catch (e) { user = null; }
    }

    if (!user) {
      // no user found, still return generic
      return res.status(400).json({ message: 'invalid token or user' });
    }

    const rolePolicyError = getResetRolePolicyError(user.role);
    if (rolePolicyError) {
      return res.status(403).json(rolePolicyError);
    }

    // DoS protection: shared with /account/password/change so the cooldown can't be
    // bypassed by switching between the authenticated and forgot-password flows.
    const cooldownRemaining = getPasswordChangeCooldownRemaining(user.id);
    if (cooldownRemaining > 0) {
      const remaining = Math.ceil(cooldownRemaining / 60000);
      return res.status(429).json({
        message: `Password was recently changed. Please wait ${remaining} minute(s) before changing it again.`,
        reasons: [`Password change cooldown active. Try again in ${remaining} minute(s).`],
        cooldownUntil: Date.now() + cooldownRemaining,
      });
    }

    // Validate password strength using SystemSetting configuration
    const strength = await validatePasswordWithSettings(String(password), user?.role);
    if (!strength.valid) return res.status(400).json({ message: 'weak_password', reasons: strength.reasons });

    // Enforce policy: prevent resetting to the current active password
    if (await verifyPassword(user.passwordHash, String(password))) {
      return res.status(400).json({ message: 'password_reused', reasons: ['The new password must be different from your current password. Please choose a different password.'] });
    }

    // Prevent reuse of recent passwords
    try {
      const reused = await isPasswordReused(normalizedUserId, String(password));
      if (reused) return res.status(400).json({ message: 'password_reused', reasons: ['You cannot reuse a recent password. Please choose a different one.'] });
    } catch (e) { /* ignore history check errors — don't block reset */ }

    // Hash and update password
    const pwHash = await hashPassword(String(password));
    try {
      // Bump tokensValidAfter so every JWT issued before now is rejected — this
      // is the account-recovery path, so any token an attacker still holds must
      // stop working the moment the rightful owner resets the password.
      await prisma.user.update({ where: { id: normalizedUserId as any }, data: { passwordHash: pwHash as any, resetPasswordToken: null as any, resetPasswordExpires: null as any, tokensValidAfter: new Date() as any } as any });
      await invalidateAuthSessionCacheForUser(Number(user.id)).catch(() => {});
    } catch (e) {
      console.error('[reset-password] Failed to persist new password', e);
      return res.status(503).json({
        code: 'password_update_failed',
        message: 'Your password could not be saved. Nothing was changed; please try again.',
      });
    }

    // Update in-memory history if applicable and start the change cooldown
    try { await addPasswordToHistory(normalizedUserId, pwHash); } catch (e) { /* ignore */ }
    recordPasswordChangeSuccess(user.id);

    // Remove in-memory token
    if (resetTokenStore[hashed]) delete resetTokenStore[hashed];

    // Send password-changed confirmation email (non-blocking)
    try {
      const recipientEmail = user.email || user.phone;
      if (recipientEmail && recipientEmail.includes('@')) {
        const appUrl = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.CORS_ORIGIN?.split(',')[0]?.trim() || 'https://nolsaf.com';
        const { subject: cSubject, html: cHtml } = getPasswordChangedConfirmationEmail({
          name: user.name || user.email || 'User',
          email: user.email,
          changedAt: new Date(),
          ipAddress: req.ip || req.socket?.remoteAddress,
          device: String(req.headers['user-agent'] || '').slice(0, 120) || undefined,
          securityUrl: `${appUrl}/account/forgot-password`,
        });
        await sendMail(recipientEmail, cSubject, cHtml, undefined, { from: SECURITY_EMAIL_FROM, replyTo: "support@nolsaf.com" });
      }
    } catch (emailErr) {
      console.warn('[reset-password] Failed to send confirmation email:', emailErr);
    }

    return res.json({ ok: true, message: 'password reset' });
  } catch (err) {
    console.error('reset-password error', err);
    return res.status(500).json({ message: 'failed' });
  }
});

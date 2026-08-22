import { Router } from "express";
import type { RequestHandler, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, blockImpersonated } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { hashPassword, verifyPassword, encrypt, decrypt, hashCode, verifyCode } from "../lib/crypto.js";
import { hashCode as hashOtpCode } from "../lib/otp.js";
import { PASSWORD_MAX_LENGTH, validatePasswordStrength, isPasswordReused, addPasswordToHistory, getPasswordChangeCooldownRemaining, recordPasswordChangeSuccess } from "../lib/security.js";
import { validatePasswordWithSettings } from "../lib/securitySettings.js";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { limitContactChangeOtp, limitContactChangeConfirm } from "../middleware/rateLimit.js";
import { sendSms } from "../lib/sms.js";
import { sendMail, SECURITY_EMAIL_FROM } from "../lib/mailer.js";
import { getVerificationCodeEmail } from "../lib/authEmailTemplates.js";
import {
  generateOtp as generateContactChangeOtp,
  storeContactChangeChallenge,
  consumeContactChangeCode,
  deleteContactChangeChallenge,
  codeHash as hashContactChangeCode,
  type ContactField,
} from "../lib/contactChangeOtp.js";
import { isAllowedDocumentTypeForRole, isTrustedUserDocumentUrl, sanitizeUserDocument } from "../lib/userDocumentSecurity.js";
import { getRedis } from "../lib/redis.js";
import { invalidateAuthSessionCacheForUser } from "../lib/authSessionCache.js";
import { getWebAuthnRp } from "../lib/webauthnRp.js";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { azamPayNameLookup } from "../services/azampay/disbursement/client.js";
import { AzamPayDisburseConfigurationError, AzamPayDisburseError } from "../services/azampay/disbursement/errors.js";
import { azamPayProvidersMatch, canonicalAzamPayProvider } from "../services/azampay/disbursement/providers.js";
import { getRegistrationStatus } from "../lib/registrationLifecycle.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler);

function maskOtp(code: string): string {
  const s = String(code || "");
  if (s.length <= 2) return "••••••";
  return `••••${s.slice(-2)}`;
}

function otpEntityKey(destinationType: "PHONE" | "EMAIL", destination: string, codeHash: string): string {
  return `OTP:${destinationType}:${destination}:${codeHash}`;
}

// Constants
const BACKUP_CODES_COUNT = 10;
const PAYMENT_METHODS_LIMIT = 20;
const DEFAULT_SESSIONS_PAGE_SIZE = 20;
const SENSITIVE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const SENSITIVE_RATE_LIMIT_MAX = 50;

// Rate limiter for sensitive endpoints
const sensitiveLimit = rateLimit({
  windowMs: SENSITIVE_RATE_LIMIT_WINDOW_MS,
  limit: SENSITIVE_RATE_LIMIT_MAX
});

// Sensitive account changes (credentials, 2FA, passkeys, sessions, deletion)
// are refused during admin impersonation sessions, then rate limited.
const sensitive: RequestHandler = (req, res, next) =>
  blockImpersonated(req, res, () => sensitiveLimit(req, res, next));

// Rate limiter for payout updates (more restrictive - prevent unnecessary edits)
const payoutUpdateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5, // Max 5 payout updates per hour
  message: { error: "Too many payout updates. Please wait before making changes. This helps protect your account information." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Name lookups are separate from confirmed destination changes. Keeping a
// dedicated limit avoids charging a successful two-step verification twice.
const payoutLookupLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  message: { error: "Too many payout verification attempts. Please wait before trying again." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper: Standardized error response
function sendError(res: Response, status: number, message: string, details?: any) {
  res.status(status).json({ 
    error: message, 
    ...(details && { details }) 
  });
}

// Helper: Standardized success response
function sendSuccess(res: Response, data?: any, message?: string) {
  res.json({ 
    ok: true, 
    ...(message && { message }),
    ...(data && { data })
  });
}

function cleanOrigin(value: unknown): string | null {
  const raw = String(value || "").split(",")[0]?.trim() || "";
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function publicWebOrigin() {
  return (
    cleanOrigin(process.env.FRONTEND_URL) ||
    cleanOrigin(process.env.WEB_ORIGIN) ||
    cleanOrigin(process.env.APP_ORIGIN) ||
    cleanOrigin(process.env.APP_URL) ||
    cleanOrigin(process.env.CORS_ORIGIN) ||
    "https://www.nolsaf.com"
  );
}

// Helper: Get authenticated user ID
function getUserId(req: AuthedRequest): number {
  return req.user!.id;
}

// Zod Validation Schemas
// NOTE: `phone` and `email` are intentionally NOT part of this schema. Changing either
// requires verifying ownership of the new destination via /account/contact/* below —
// see requestContactChange / confirmContactChange.
const updateProfileSchema = z.object({
  fullName: z.string().min(1).max(160).optional(),
  name: z.string().min(1).max(160).optional(),
  avatarUrl: z.string().url().max(500).optional(),
  tin: z.string().max(50).optional(),
  address: z.string().trim().max(500).optional(),
  // Optional for ordinary accounts; promotion requires it before an agreement
  // can be generated.
  nin: z.string().trim().max(50).optional(),
  gender: z.string().max(20).optional(),
  nationality: z.string().max(80).optional(),
}).strict();

const requestContactChangeSchema = z.object({
  field: z.enum(["phone", "email"]),
  value: z.string().min(1).max(190),
  currentPassword: z.string().min(1).max(200).optional(),
  totpCode: z.string().trim().regex(/^\d{6}$/).optional(),
}).strict();

const authorizeContactChangeSchema = z.object({
  field: z.enum(["phone", "email"]),
  otp: z.string().trim().regex(/^\d{6}$/),
}).strict();

const confirmContactChangeSchema = z.object({
  field: z.enum(["phone", "email"]),
  otp: z.string().trim().regex(/^\d{6}$/),
}).strict();

const PAYOUT_BANK_CODES = ["CRDB", "NBC", "NMB"] as const;

function canonicalPayoutBank(value: unknown): (typeof PAYOUT_BANK_CODES)[number] | null {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  return PAYOUT_BANK_CODES.find((bank) => normalized === bank || normalized === `${bank}BANK`) ?? null;
}

const payoutBankSchema = z.preprocess(
  (value) => canonicalPayoutBank(value) ?? value,
  z.enum(["CRDB", "NBC", "NMB"], { message: "Select CRDB, NBC, or NMB" })
);

const payoutMobileProviderSchema = z.preprocess(
  (value) => canonicalAzamPayProvider(String(value ?? "")) ?? value,
  z.enum(["yas", "vodacom", "airtel", "halotel", "azampesa"], {
    message: "Select Yas, Vodacom, Airtel, Halotel, or Azampesa",
  })
);

const updatePayoutsSchema = z.discriminatedUnion("payoutPreferred", [
  z
    .object({
      payoutPreferred: z.literal("BANK"),
      bankAccountName: z.string().trim().min(2).max(160),
      bankName: payoutBankSchema,
      bankAccountNumber: z.string().trim().regex(/^[A-Za-z0-9]{4,40}$/, "Enter a valid bank account number"),
      bankBranch: z.string().trim().max(100).optional().default(""),
    })
    .strict(),
  z
    .object({
      payoutPreferred: z.literal("MOBILE_MONEY"),
      mobileMoneyProvider: payoutMobileProviderSchema,
      mobileMoneyNumber: z.string().trim().regex(/^\d{9,15}$/, "Enter a valid mobile wallet number"),
    })
    .strict(),
]);

const confirmPayoutSchema = z.object({
  challengeToken: z.string().trim().min(32).max(256),
}).strict();

type PayoutDestinationInput = z.infer<typeof updatePayoutsSchema>;
type PayoutVerificationChallenge = {
  userId: number;
  destination: PayoutDestinationInput;
  accountName: string;
  contactSecurityVersion: string;
  issuedAt: number;
  expiresAt: number;
};

const PAYOUT_VERIFICATION_TTL_SEC = 5 * 60;
const PAYOUT_VERIFICATION_PREFIX = "account:payout:verification:";
const payoutVerificationFallback = new Map<string, { encryptedPayload: string; expiresAt: number }>();

function payoutChallengeDigest(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function contactSecurityVersion(user: { emailChangedAt?: Date | null; phoneChangedAt?: Date | null }): string {
  return `${user.emailChangedAt?.toISOString() ?? "never"}|${user.phoneChangedAt?.toISOString() ?? "never"}`;
}

function recentContactChange(user: { emailChangedAt?: Date | null; phoneChangedAt?: Date | null }): Date | null {
  const values = [user.emailChangedAt, user.phoneChangedAt].filter((value): value is Date => value instanceof Date);
  if (values.length === 0) return null;
  const latest = values.reduce((current, value) => value.getTime() > current.getTime() ? value : current);
  return latest.getTime() > Date.now() - CONTACT_SECURITY_COOLDOWN_MS ? latest : null;
}

async function createPayoutVerificationChallenge(challenge: Omit<PayoutVerificationChallenge, "issuedAt" | "expiresAt">) {
  const token = randomBytes(32).toString("base64url");
  const digest = payoutChallengeDigest(token);
  const issuedAt = Date.now();
  const expiresAt = issuedAt + PAYOUT_VERIFICATION_TTL_SEC * 1000;
  const encryptedPayload = encrypt(JSON.stringify({ ...challenge, issuedAt, expiresAt }));

  let storedInRedis = false;
  try {
    const redis = getRedis();
    if (redis) {
      await redis.set(`${PAYOUT_VERIFICATION_PREFIX}${digest}`, encryptedPayload, "EX", PAYOUT_VERIFICATION_TTL_SEC);
      storedInRedis = true;
    }
  } catch {
    // The encrypted fallback below keeps single-instance development usable.
  }

  if (!storedInRedis) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Secure payout verification storage is unavailable");
    }
    // Never duplicate a Redis-backed token locally: doing so could permit a
    // consumed token to reappear after a temporary Redis outage. The fallback
    // is intentionally limited to single-instance development and tests.
    for (const [key, entry] of payoutVerificationFallback) {
      if (entry.expiresAt <= issuedAt) payoutVerificationFallback.delete(key);
    }
    payoutVerificationFallback.set(digest, { encryptedPayload, expiresAt });
  }

  return { token, expiresAt };
}

async function consumePayoutVerificationChallenge(token: string, userId: number): Promise<PayoutVerificationChallenge | null> {
  const digest = payoutChallengeDigest(token);
  let encryptedPayload: string | null = null;
  let redisWasAuthoritative = false;

  try {
    const redis = getRedis();
    if (redis) {
      redisWasAuthoritative = true;
      encryptedPayload = await redis.eval(
        "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
        1,
        `${PAYOUT_VERIFICATION_PREFIX}${digest}`
      ) as string | null;
      payoutVerificationFallback.delete(digest);
    }
  } catch {
    redisWasAuthoritative = false;
  }

  if (!redisWasAuthoritative) {
    const fallback = payoutVerificationFallback.get(digest);
    payoutVerificationFallback.delete(digest);
    if (fallback && fallback.expiresAt > Date.now()) encryptedPayload = fallback.encryptedPayload;
  }
  if (!encryptedPayload) return null;

  try {
    const challenge = JSON.parse(decrypt(encryptedPayload, { log: false })) as PayoutVerificationChallenge;
    if (challenge.userId !== userId || challenge.expiresAt <= Date.now()) return null;
    return challenge;
  } catch {
    return null;
  }
}

function maskSensitiveDestination(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "****";
  return `${"*".repeat(Math.max(4, Math.min(8, raw.length - 4)))}${raw.slice(-4)}`;
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(PASSWORD_MAX_LENGTH),
}).strict();

// DoS protection: Track password change attempts and cooldowns
interface PasswordChangeAttempt {
  failures: number;
  lastFailure: number;
  lockedUntil: number | null;
}

const passwordChangeAttempts = new Map<number, PasswordChangeAttempt>();

// Get or create attempt tracker for user
function getPasswordChangeAttempt(userId: number): PasswordChangeAttempt {
  if (!passwordChangeAttempts.has(userId)) {
    passwordChangeAttempts.set(userId, { failures: 0, lastFailure: 0, lockedUntil: null });
  }
  return passwordChangeAttempts.get(userId)!;
}

// Clean up old entries (older than 1 hour)
setInterval(() => {
  const now = Date.now();
  for (const [userId, attempt] of passwordChangeAttempts.entries()) {
    if (attempt.lockedUntil && now > attempt.lockedUntil) {
      attempt.failures = 0;
      attempt.lockedUntil = null;
    }
    // Remove entries with no recent activity (older than 1 hour)
    if (!attempt.lockedUntil && now - attempt.lastFailure > 3600000) {
      passwordChangeAttempts.delete(userId);
    }
  }
}, 60000); // Clean up every minute

const totpVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d+$/),
}).strict();

const totpDisableSchema = z.object({
  code: z.string().min(1).optional(),
}).strict();

const smsSendSchema = z.object({}).strict();

const smsVerifySchema = z.object({
  code: z.string().length(6).regex(/^\d+$/),
}).strict();

const security2faSchema = z
  .object({
    type: z.enum(["totp"]),
    action: z.enum(["enable", "disable"]),
    code: z.string().min(1),
    secret: z.string().min(1).optional(),
  })
  .strict();

const revokeSessionSchema = z.object({
  sessionId: z.string().min(1),
}).strict();

const documentMetadataValueSchema = z.union([
  z.string().max(1000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const upsertDocumentSchema = z.object({
  type: z.string().min(1).max(80),
  url: z.string().url().max(2000),
  metadata: z.record(z.string(), documentMetadataValueSchema).optional(),
}).strict();

const listSessionsSchema = z.object({
  page: z.string().regex(/^\d+$/).optional().transform(Number),
  pageSize: z.string().regex(/^\d+$/).optional().transform(Number),
}).strict();

/** GET /account/session */
const getSession: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const meta = (prisma as any).user?._meta ?? {};
    const metaHasEntries = Object.keys(meta).length > 0;
    const hasField = (field: string) => !metaHasEntries || Object.prototype.hasOwnProperty.call(meta, field);
    const select: any = {
      id: true,
      role: true,
      email: true,
      name: true,
    };

    if (hasField("fullName")) select.fullName = true;
    if (hasField("avatarUrl")) select.avatarUrl = true;
    if (hasField("suspendedAt")) select.suspendedAt = true;
    if (hasField("isDisabled")) select.isDisabled = true;
    if (hasField("registrationStatus")) select.registrationStatus = true;
    if (hasField("registrationSource")) select.registrationSource = true;
    if (hasField("profileCompletedAt")) select.profileCompletedAt = true;

    let user: any = null;
    try {
      user = await prisma.user.findUnique({ where: { id: userId }, select } as any);
    } catch (error: any) {
      if (error?.code !== "P2022" && !String(error?.message || "").includes("Unknown column")) {
        throw error;
      }

      user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          email: true,
          name: true,
        },
      });
    }

    if (!user) return sendError(res, 404, "User not found");

    const fullName = typeof user.fullName === "string" ? user.fullName : null;
    const name = typeof user.name === "string" ? user.name : null;
    const email = typeof user.email === "string" ? user.email : null;
    const avatarUrl = typeof user.avatarUrl === "string" ? user.avatarUrl : null;

    sendSuccess(res, {
      id: user.id,
      role: user.role,
      email,
      name,
      fullName,
      displayName: fullName || name || email || null,
      avatarUrl,
      profileImage: avatarUrl,
      isDisabled: Boolean(user.isDisabled),
      isSuspended: Boolean(user.suspendedAt),
      registrationStatus: user.registrationStatus ?? getRegistrationStatus(user),
      registrationSource: user.registrationSource ?? 'UNKNOWN',
      profileCompletedAt: user.profileCompletedAt ?? null,
      impersonated: Boolean((req as AuthedRequest).user?.imp),
    });
  } catch (error: any) {
    const isProd = process.env.NODE_ENV === "production";
    console.error("account.session failed", { error });
    sendError(
      res,
      500,
      "Failed to fetch session data",
      isProd
        ? undefined
        : {
            message: error?.message,
            name: error?.name,
            code: error?.code,
          },
    );
  }
};

router.get("/session", getSession as unknown as RequestHandler);

/** GET /account/me */
const getMe: RequestHandler = async (req, res) => {
  let stage = 'start';
  try {
    stage = 'get_user_id';
    const userId = getUserId(req as AuthedRequest);

    // Fail-soft: some local DBs may be missing newer columns that exist in Prisma schema.
    // Avoid `findUnique()` without `select` (Prisma will select all columns and can crash with P2022).
    let user: any = null;
    stage = 'user_select_full';
    const meta = (prisma as any).user?._meta ?? {};
    // When _meta is unavailable (empty object), default hasField to true so that all schema
    // fields are selected; the P2022 fallback below strips any truly unknown column.
    const metaHasEntries = Object.keys(meta).length > 0;
    const hasField = (field: string) => !metaHasEntries || Object.prototype.hasOwnProperty.call(meta, field);
    const select: any = {
      id: true,
      role: true,
      email: true,
      phone: true,
      name: true,
      createdAt: true,
      passwordHash: true,
    };
    // Common/profile fields
    if (hasField('fullName')) select.fullName = true;
    // Always try to include avatarUrl; fall back if missing in older DBs.
    select.avatarUrl = true;
    if (hasField('emailVerifiedAt')) select.emailVerifiedAt = true;
    if (hasField('phoneVerifiedAt')) select.phoneVerifiedAt = true;
    if (hasField('registrationStatus')) select.registrationStatus = true;
    if (hasField('registrationSource')) select.registrationSource = true;
    if (hasField('profileCompletedAt')) select.profileCompletedAt = true;
    if (hasField('twoFactorEnabled')) select.twoFactorEnabled = true;
    if (hasField('twoFactorMethod')) select.twoFactorMethod = true;
    if (hasField('suspendedAt')) select.suspendedAt = true;
    if (hasField('isDisabled')) select.isDisabled = true;
    if (hasField('timezone')) select.timezone = true;
    if (hasField('dateOfBirth')) select.dateOfBirth = true;
    if (hasField('region')) select.region = true;
    if (hasField('district')) select.district = true;
    if (hasField('gender')) select.gender = true;
    if (hasField('nationality')) select.nationality = true;
    // Always try to include payout (like tin and address)
    select.payout = true;

    // Owner fields - always try to include these fields
    select.tin = true;
    select.address = true;

    // Driver fields
    if (hasField('gender')) select.gender = true;
    if (hasField('nationality')) select.nationality = true;
    if (hasField('nin')) select.nin = true;
    if (hasField('licenseNumber')) select.licenseNumber = true;
    if (hasField('plateNumber')) select.plateNumber = true;
    if (hasField('vehicleType')) select.vehicleType = true;
    if (hasField('vehicleMake')) select.vehicleMake = true;
    if (hasField('vehiclePlate')) select.vehiclePlate = true;
    if (hasField('operationArea')) select.operationArea = true;
    if (hasField('paymentPhone')) select.paymentPhone = true;
    if (hasField('paymentVerified')) select.paymentVerified = true;
    if (hasField('isVipDriver')) select.isVipDriver = true;
    if (hasField('kycStatus')) select.kycStatus = true;
    if (hasField('kycNote')) select.kycNote = true;
    if (hasField('kycFieldApprovals')) select.kycFieldApprovals = true;
    if (hasField('languages')) select.languages = true;

    try {
      user = await prisma.user.findUnique({ where: { id: userId }, select } as any);
    } catch (e: any) {
      // If error is due to missing columns (P2022), try again without tin/address
      if (e?.code === 'P2022' || String(e?.message || '').includes('Unknown column') || String(e?.message || '').includes('Column')) {
        stage = 'user_select_without_tin_address';
        try {
          const selectWithoutTinAddress = { ...select };
          delete selectWithoutTinAddress.tin;
          delete selectWithoutTinAddress.address;
          // Ensure payout is still included (always try)
          selectWithoutTinAddress.payout = true;
          user = await prisma.user.findUnique({ where: { id: userId }, select: selectWithoutTinAddress } as any);
          if (user) {
            (user as any).tin = null;
            (user as any).address = null;
          }
        } catch (e2) {
          // Fall through to minimal select
          stage = 'user_select_minimal';
        }
      }
      
      // If still no user, try minimal select
      if (!user) {
        stage = 'user_select_minimal';
        try {
          const minimalSelect: any = {
            id: true,
            role: true,
            email: true,
            phone: true,
            name: true,
            createdAt: true,
            passwordHash: true,
          };
          // Always try to include payout, twoFactorEnabled, and twoFactorMethod even in minimal select
          minimalSelect.payout = true;
          // Always try to include avatarUrl
          minimalSelect.avatarUrl = true;
          if (hasField('twoFactorEnabled')) minimalSelect.twoFactorEnabled = true;
          if (hasField('twoFactorMethod')) minimalSelect.twoFactorMethod = true;
          
          user = await prisma.user.findUnique({
            where: { id: userId },
            select: minimalSelect,
          });
          if (user) {
            (user as any).fullName = (user as any).fullName ?? null;
            (user as any).avatarUrl = (user as any).avatarUrl ?? null;
            (user as any).emailVerifiedAt = null;
            (user as any).phoneVerifiedAt = null;
            (user as any).registrationStatus = getRegistrationStatus(user);
            (user as any).registrationSource = 'UNKNOWN';
            (user as any).profileCompletedAt = null;
            // Only set to false if not already set from database
            if (!hasField('twoFactorEnabled') || (user as any).twoFactorEnabled === undefined) {
              (user as any).twoFactorEnabled = false;
            }
            (user as any).suspendedAt = null;
            (user as any).isDisabled = null;
            (user as any).tin = null;
            (user as any).address = null;
            // Try to fetch payout separately if not included
            if (typeof (user as any).payout === "undefined") {
              try {
                const userWithPayout = await prisma.user.findUnique({
                  where: { id: userId },
                  select: { payout: true } as any,
                });
                if (userWithPayout) {
                  (user as any).payout = (userWithPayout as any).payout;
                }
              } catch (e4) {
                // Ignore - payout might not exist
              }
            }
          }
        } catch (e3) {
          // Last resort - ignore
        }
      }
    }
    
    // Final fallback: if user exists but payout is missing, try to fetch it separately
    if (user && typeof (user as any).payout === "undefined") {
      try {
        const userWithPayout = await prisma.user.findUnique({
          where: { id: userId },
          select: { payout: true } as any,
        });
        if (userWithPayout && (userWithPayout as any).payout) {
          (user as any).payout = (userWithPayout as any).payout;
        }
      } catch (e) {
        console.warn(`[account/me] Failed to fetch payout separately:`, e);
      }
    }
    
    // Ensure twoFactorEnabled and twoFactorMethod are always fetched, even if main query didn't include them
    // Check if they're missing (undefined/null) or if we need to verify them from database
    if (user && ((user as any).twoFactorEnabled === undefined || (user as any).twoFactorMethod === undefined)) {
      try {
        // Always try to fetch twoFactorEnabled and twoFactorMethod - they're critical fields
        const userWith2FA = await prisma.user.findUnique({
          where: { id: userId },
          select: { twoFactorEnabled: true, twoFactorMethod: true } as any,
        });
        if (userWith2FA) {
          if ((userWith2FA as any).twoFactorEnabled !== undefined) {
            (user as any).twoFactorEnabled = !!(userWith2FA as any).twoFactorEnabled;
          } else {
            (user as any).twoFactorEnabled = false;
          }
          if ((userWith2FA as any).twoFactorMethod !== undefined) {
            (user as any).twoFactorMethod = (userWith2FA as any).twoFactorMethod;
          }
        } else {
          (user as any).twoFactorEnabled = false;
        }
      } catch (e) {
        // If field doesn't exist in schema, default to false
        console.warn(`[account/me] Failed to fetch twoFactorEnabled/twoFactorMethod separately (field may not exist):`, e);
        (user as any).twoFactorEnabled = false;
      }
    }
    
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    // Attach safe derived fields, then remove sensitive material before responding.
    (user as any).hasPassword = Boolean((user as any).passwordHash);
    delete (user as any).passwordHash;
    
    // Ensure payout is always attempted to be loaded, even if main query didn't include it
    if (typeof (user as any).payout === "undefined") {
      try {
        const payoutOnly = await prisma.user.findUnique({
          where: { id: userId },
          select: { payout: true } as any,
        });
        if (payoutOnly && (payoutOnly as any).payout) {
          (user as any).payout = (payoutOnly as any).payout;
        }
      } catch (e) {
        console.warn(`[account/me] Failed to fetch payout directly:`, e);
      }
    }

    // Attach the authenticated account's document records. Previously this
    // was restricted to DRIVER, which meant owner uploads existed for admin
    // review but appeared as "Not uploaded" on the owner's own profile.
    try {
      const documentRole = String((user as any).role || "").toUpperCase();
      if (["DRIVER", "OWNER", "AGENT"].includes(documentRole) && (prisma as any).userDocument) {
        const docs = await prisma.userDocument.findMany({
          where: { userId },
          orderBy: { id: 'desc' },
          take: 50,
          select: { id: true, type: true, url: true, status: true, reason: true, metadata: true, createdAt: true } as any,
        });
        const safeDocs = (docs as any[]).map((doc) => sanitizeUserDocument(doc, documentRole));
        (user as any).documents = safeDocs;
        (user as any).documentsUnavailable = false;

        if (documentRole === "DRIVER") {
          const latestByType = new Map<string, any>();
          for (const d of safeDocs) {
            const t = String((d as any).type ?? '').toUpperCase();
            if (!t) continue;
            if (!latestByType.has(t)) latestByType.set(t, d);
          }
          const lic = latestByType.get('DRIVER_LICENSE') || latestByType.get('DRIVING_LICENSE') || latestByType.get('LICENSE');
          const nid = latestByType.get('NATIONAL_ID') || latestByType.get('ID') || latestByType.get('PASSPORT');
          const latra = latestByType.get('LATRA') || latestByType.get('VEHICLE_REGISTRATION') || latestByType.get('VEHICLE_REG');
          const ins = latestByType.get('INSURANCE');
          (user as any).drivingLicenseUrl = lic?.url ?? null;
          (user as any).licenseFileUrl = lic?.url ?? null;
          (user as any).nationalIdUrl = nid?.url ?? null;
          (user as any).idFileUrl = nid?.url ?? null;
          (user as any).latraUrl = latra?.url ?? null;
          (user as any).vehicleRegistrationUrl = latra?.url ?? null; // backward compat alias
          (user as any).vehicleRegFileUrl = latra?.url ?? null;
          (user as any).insuranceUrl = ins?.url ?? null;
          (user as any).insuranceFileUrl = ins?.url ?? null;
        }
      }
    } catch (e) {
      console.warn("[account/me] Failed to attach user documents", e);
      (user as any).documents = null;
      (user as any).documentsUnavailable = true;
    }

    // Best-effort: decrypt sensitive payout fields and attach extra profile fields
    try {
      let payout = (user as any).payout;
      
      // Handle case where payout might be a JSON string
      if (typeof payout === 'string') {
        try {
          payout = JSON.parse(payout);
        } catch (e) {
          console.warn(`[account/me] Failed to parse payout JSON string:`, e);
          payout = null;
        }
      }
      
      if (payout && typeof payout === 'object' && !Array.isArray(payout)) {
        // Decrypt sensitive fields before returning to client
        if (payout.bankAccountNumber && typeof payout.bankAccountNumber === 'string') {
          try {
              payout.bankAccountNumber = decrypt(payout.bankAccountNumber, { log: false });
          } catch (e) {
            // Decryption failed — null out rather than leaking ciphertext to the frontend.
            payout.bankAccountNumber = null;
          }
        }
        if (payout.mobileMoneyNumber && typeof payout.mobileMoneyNumber === 'string') {
          try {
            payout.mobileMoneyNumber = decrypt(payout.mobileMoneyNumber, { log: false });
          } catch (e) {
            // Decryption failed (wrong key or corrupted data) — null out rather than
            // leaking an encrypted ciphertext string to the frontend.
            payout.mobileMoneyNumber = null;
          }
        }
        
        // Attach payout fields directly to user object for easier access
        // Preserve values even if they're empty strings (frontend will handle display)
        (user as any).bankAccountName = payout.bankAccountName !== undefined && payout.bankAccountName !== null ? String(payout.bankAccountName) : null;
        (user as any).bankName = payout.bankName !== undefined && payout.bankName !== null ? String(payout.bankName) : null;
        (user as any).bankAccountNumber = payout.bankAccountNumber !== undefined && payout.bankAccountNumber !== null ? String(payout.bankAccountNumber) : null;
        (user as any).bankBranch = payout.bankBranch !== undefined && payout.bankBranch !== null ? String(payout.bankBranch) : null;
        (user as any).mobileMoneyProvider = payout.mobileMoneyProvider !== undefined && payout.mobileMoneyProvider !== null ? String(payout.mobileMoneyProvider) : null;
        (user as any).mobileMoneyNumber = payout.mobileMoneyNumber !== undefined && payout.mobileMoneyNumber !== null ? String(payout.mobileMoneyNumber) : null;
        (user as any).payoutPreferred = payout.payoutPreferred !== undefined && payout.payoutPreferred !== null ? String(payout.payoutPreferred) : null;
        
        // Attach extra profile fields stored in payout.profileExtras (used for environments without columns)
        const extras = (payout as any).profileExtras;
        if (extras && typeof extras === 'object') {
          if ((user as any).fullName == null && typeof (extras as any).fullName !== 'undefined') (user as any).fullName = (extras as any).fullName;
          if ((user as any).name == null && typeof (extras as any).name !== 'undefined') (user as any).name = (extras as any).name;
          if ((user as any).phone == null && typeof (extras as any).phone !== 'undefined') (user as any).phone = (extras as any).phone;
          if ((user as any).email == null && typeof (extras as any).email !== 'undefined') (user as any).email = (extras as any).email;
          if ((user as any).region == null && typeof (extras as any).region !== 'undefined') (user as any).region = (extras as any).region;
          if ((user as any).district == null && typeof (extras as any).district !== 'undefined') (user as any).district = (extras as any).district;
          if ((user as any).timezone == null && typeof (extras as any).timezone !== 'undefined') (user as any).timezone = (extras as any).timezone;
          if ((user as any).dateOfBirth == null && typeof (extras as any).dateOfBirth !== 'undefined') (user as any).dateOfBirth = (extras as any).dateOfBirth;
          if ((user as any).nationality == null && typeof (extras as any).nationality !== 'undefined') (user as any).nationality = (extras as any).nationality;
          if ((user as any).gender == null && typeof (extras as any).gender !== 'undefined') (user as any).gender = (extras as any).gender;
          if ((user as any).nin == null && typeof (extras as any).nin !== 'undefined') (user as any).nin = (extras as any).nin;
          if ((user as any).licenseNumber == null && typeof (extras as any).licenseNumber !== 'undefined') (user as any).licenseNumber = (extras as any).licenseNumber;
          if ((user as any).plateNumber == null && typeof (extras as any).plateNumber !== 'undefined') (user as any).plateNumber = (extras as any).plateNumber;
          if ((user as any).vehiclePlate == null && typeof (extras as any).vehiclePlate !== 'undefined') (user as any).vehiclePlate = (extras as any).vehiclePlate;
          if ((user as any).vehicleType == null && typeof (extras as any).vehicleType !== 'undefined') (user as any).vehicleType = (extras as any).vehicleType;
          if ((user as any).vehicleMake == null && typeof (extras as any).vehicleMake !== 'undefined') (user as any).vehicleMake = (extras as any).vehicleMake;
          if ((user as any).operationArea == null && typeof (extras as any).operationArea !== 'undefined') (user as any).operationArea = (extras as any).operationArea;
          if ((user as any).paymentPhone == null && typeof (extras as any).paymentPhone !== 'undefined') (user as any).paymentPhone = (extras as any).paymentPhone;
        }
      } else {
        // Ensure payout fields are set to null if no payout data exists
        (user as any).bankAccountName = null;
        (user as any).bankName = null;
        (user as any).bankAccountNumber = null;
        (user as any).bankBranch = null;
        (user as any).mobileMoneyProvider = null;
        (user as any).mobileMoneyNumber = null;
        (user as any).payoutPreferred = null;
      }
    } catch (e) {
      console.error(`[account/me] Error processing payout data:`, e);
      // Set defaults on error
      (user as any).bankAccountName = null;
      (user as any).bankName = null;
      (user as any).bankAccountNumber = null;
      (user as any).bankBranch = null;
      (user as any).mobileMoneyProvider = null;
      (user as any).mobileMoneyNumber = null;
      (user as any).payoutPreferred = null;
    }

    // `user` is already a safe select (no passwordHash/totpSecretEnc/etc)
    sendSuccess(res, user);
  } catch (error: any) {
    const isProd = process.env.NODE_ENV === 'production';
    console.error('account.me failed', { stage, error });
    sendError(
      res,
      500,
      "Failed to fetch user data",
      isProd
        ? undefined
        : {
            stage,
            message: error?.message,
            name: error?.name,
            code: error?.code,
          },
    );
  }
};
router.get("/me", getMe as unknown as RequestHandler);

/**
 * GET /account/referral
 * Returns the authenticated user's referral code and link.
 */
const getReferral: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, referralCode: true },
    });
    if (!user) return sendError(res, 404, "User not found");
    const code = user.referralCode || String(user.id);
    sendSuccess(res, { code, link: `${publicWebOrigin()}/account/register?ref=${encodeURIComponent(code)}` });
  } catch {
    sendError(res, 500, "Failed to fetch referral info");
  }
};
router.get("/referral", getReferral as unknown as RequestHandler);

/**
 * PUT /account/documents
 * Upserts a document record for the authenticated user.
 * Used by web portals to attach required onboarding/KYC files.
 */
const upsertMyDocument: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  const role = String((req as AuthedRequest).user?.role ?? "").trim().toUpperCase();

  const parsed = upsertDocumentSchema.safeParse(req.body);
  if (!parsed.success) {
    return sendError(res, 400, "Invalid input", parsed.error.issues);
  }

  const type = String(parsed.data.type).toUpperCase().trim();
  const url = parsed.data.url;
  const metadata = parsed.data.metadata;

  if (!isAllowedDocumentTypeForRole(role, type)) {
    return sendError(res, 400, "Unsupported document type for this account.");
  }

  if (!isTrustedUserDocumentUrl(url, role)) {
    return sendError(res, 400, "Document URL must point to approved NoLSAF-managed storage.");
  }

  if (!(prisma as any).userDocument) {
    return sendSuccess(res, { type, url, status: "PENDING" }, "Document saved");
  }

  const existing = await prisma.userDocument.findFirst({
    where: { userId, type },
    orderBy: { id: "desc" },
  });

  const doc = existing
    ? await prisma.userDocument.update({
        where: { id: existing.id },
        data: { url, status: "PENDING", reason: null, metadata } as any,
      })
    : await prisma.userDocument.create({
        data: { userId, type, url, status: "PENDING", metadata } as any,
      });

  try {
    await audit(req as AuthedRequest, "USER_DOCUMENT_UPSERT", `user:${userId}`, null, {
      type,
      url,
    });
  } catch {
    // ignore audit errors
  }

  return sendSuccess(res, { doc });
};
router.put("/documents", upsertMyDocument as unknown as RequestHandler);

/** PUT /account/profile - update authenticated user's profile */
const updateProfile: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    
    // Validate input
    const validationResult = updateProfileSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }

    const data = validationResult.data;
    
    // Get user to check role
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return sendError(res, 404, "User not found");
    }
    
    // Drivers should use /api/driver/profile
    if (user.role === 'DRIVER') {
      return sendError(res, 400, "Drivers should use /api/driver/profile");
    }

    // Get before state for audit
    const beforeSelect: any = { fullName: true, name: true, phone: true, email: true, avatarUrl: true };
    // Always try to include optional legal/business fields for audit comparison.
    try {
      beforeSelect.tin = true;
    } catch (e) {}
    try {
      beforeSelect.address = true;
    } catch (e) {}
    try {
      beforeSelect.nin = true;
    } catch (e) {}

    let before: any = null;
    try {
      before = await prisma.user.findUnique({ where: { id: userId }, select: beforeSelect });
    } catch (e) {
      // Best-effort audit - if tin/address cause issues, try without them
      try {
        before = await prisma.user.findUnique({ 
          where: { id: userId }, 
          select: { fullName: true, name: true, phone: true, email: true, avatarUrl: true } 
        });
      } catch (e2) {
        // Ignore audit failures
      }
    }

    // Build update data - always include tin and address if provided
    const updateData: any = {};
    if (data.fullName !== undefined) updateData.fullName = data.fullName;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.avatarUrl !== undefined) updateData.avatarUrl = data.avatarUrl;
    // Always try to save tin and address if provided
    if (data.tin !== undefined) {
      updateData.tin = data.tin;
    }
    if (data.address !== undefined) {
      updateData.address = data.address;
    }
    if (data.nin !== undefined) {
      updateData.nin = data.nin;
    }
    if (data.gender !== undefined) {
      updateData.gender = data.gender;
    }
    if (data.nationality !== undefined) {
      updateData.nationality = data.nationality;
    }

    const resultingIdentity = {
      name: data.name ?? before?.name ?? user.name,
      fullName: data.fullName ?? before?.fullName ?? (user as any).fullName,
      email: user.email,
      phone: user.phone,
    };
    const resultingRegistrationStatus = getRegistrationStatus(resultingIdentity);
    updateData.registrationStatus = resultingRegistrationStatus;
    if (resultingRegistrationStatus === 'COMPLETE' && !(user as any).profileCompletedAt) {
      updateData.profileCompletedAt = new Date();
    }

    const extractUnknownArg = (err: any): string | null => {
      const msg = String(err?.message ?? '');
      const m = msg.match(/Unknown argument `([^`]+)`/);
      return m?.[1] ?? null;
    };

    let updated: any;
    try {
      updated = await prisma.user.update({ where: { id: userId }, data: updateData } as any);
    } catch (err: any) {
      // Some environments may have an older generated Prisma Client that doesn't include
      // newer fields yet (e.g., `fullName`, `tin`, `address`, `nin`). Retry by dropping unsupported fields.
      const badField = extractUnknownArg(err);
      if (badField) {
        console.warn(`[account/profile] Field '${badField}' not available in schema, retrying without it`);
        // If `fullName` isn't supported, best-effort map it to `name`.
        if (badField === 'fullName' && updateData.fullName !== undefined && updateData.name === undefined) {
          updateData.name = updateData.fullName;
        }
        delete updateData[badField];
        try {
          updated = await prisma.user.update({ where: { id: userId }, data: updateData } as any);
        } catch (err2: any) {
          // If still failing, remove optional legal/business fields.
          if (badField === 'tin' || badField === 'address' || badField === 'nin') {
            const retryData = { ...updateData };
            delete retryData.tin;
            delete retryData.address;
            delete retryData.nin;
            updated = await prisma.user.update({ where: { id: userId }, data: retryData } as any);
            console.warn(`[account/profile] optional legal fields not available, saved other fields only`);
          } else {
            throw err2;
          }
        }
      } else {
        throw err;
      }
    }
    
    try {
      const auditAfter = {
        ...updateData,
        // Never duplicate the raw identity number into a general audit payload.
        ...(data.nin !== undefined ? { nin: data.nin ? "[UPDATED]" : "[CLEARED]" } : {}),
      };
      const auditBefore = before
        ? { ...before, ...(before.nin !== undefined ? { nin: before.nin ? "[SET]" : null } : {}) }
        : before;
      await audit(req as AuthedRequest, 'USER_PROFILE_UPDATE', `user:${updated.id}`, auditBefore, auditAfter);
    } catch (e) {
      // Best-effort audit
    }
    
    sendSuccess(res, null, "Profile updated successfully");
  } catch (error: any) {
    console.error('account.profile.update failed', error);
    sendError(res, 500, "Failed to update profile");
  }
};
router.put("/profile", updateProfile as unknown as RequestHandler);

const FIELD_REGEX: Record<"phone" | "email", RegExp> = {
  phone: /^\+?[1-9]\d{1,14}$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
};

const FIELD_LABEL: Record<"phone" | "email", string> = {
  phone: "phone number",
  email: "email address",
};

const CONTACT_SECURITY_COOLDOWN_MS = 72 * 60 * 60 * 1000;

function contactIsMature(changedAt: Date | null | undefined): boolean {
  return !changedAt || changedAt.getTime() <= Date.now() - CONTACT_SECURITY_COOLDOWN_MS;
}

function maskContact(field: ContactField, value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "unavailable";
  if (field === "email") {
    const [local, domain] = raw.split("@");
    if (!domain) return "***";
    return `${local.slice(0, 2)}***@${domain}`;
  }
  return `${"*".repeat(Math.max(5, raw.length - 4))}${raw.slice(-4)}`;
}

function escapeContactHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

async function deliverContactCode(field: ContactField, destination: string, code: string, purpose: "authorize" | "verify"): Promise<void> {
  const action = purpose === "authorize" ? "authorize a contact change" : `confirm your new ${FIELD_LABEL[field]}`;
  if (field === "phone") {
    const result = await sendSms(destination, `Your NoLSAF code to ${action} is ${code}. It expires in 5 minutes. Do not share it.`);
    if (!result?.success) throw new Error("SMS delivery failed");
    return;
  }
  const { subject, html } = getVerificationCodeEmail(code, { purpose: "contact", expiryMinutes: 5 });
  await sendMail(destination, subject, html, undefined, {
    bypassEligibilityCheck: true,
    from: SECURITY_EMAIL_FROM,
    replyTo: "support@nolsaf.com",
  });
}

async function sendContactChangedAlerts(
  before: { email: string | null; phone: string | null },
  field: ContactField,
  newValue: string,
): Promise<void> {
  const label = FIELD_LABEL[field];
  const maskedNewValue = maskContact(field, newValue);
  const tasks: Array<Promise<unknown>> = [];
  if (before.email) {
    tasks.push(sendMail(
      before.email,
      `Security alert: your NoLSAF ${label} changed`,
      `<p>Your NoLSAF ${escapeContactHtml(label)} was changed to <strong>${escapeContactHtml(maskedNewValue)}</strong>.</p><p>If you did not make this change, contact <a href="mailto:support@nolsaf.com">support@nolsaf.com</a> immediately.</p>`,
      undefined,
      { bypassEligibilityCheck: true, from: SECURITY_EMAIL_FROM, replyTo: "support@nolsaf.com" },
    ));
  }
  if (before.phone) {
    tasks.push(sendSms(before.phone, `NoLSAF security alert: your ${label} was changed to ${maskedNewValue}. If this was not you, contact support immediately.`));
  }
  await Promise.allSettled(tasks);
}

async function sendPayoutDestinationChangedAlerts(
  user: { email: string | null; phone: string | null },
  provider: string,
  accountNumber: string,
): Promise<void> {
  const maskedDestination = maskSensitiveDestination(accountNumber);
  const tasks: Array<Promise<unknown>> = [];
  if (user.email) {
    tasks.push(sendMail(
      user.email,
      "Security alert: payout destination changed",
      `<p>Your NoLSAF payout destination was changed to <strong>${escapeContactHtml(provider)}</strong> ending in <strong>${escapeContactHtml(maskedDestination.slice(-4))}</strong>.</p><p>If you did not make this change, contact <a href="mailto:support@nolsaf.com">support@nolsaf.com</a> immediately.</p>`,
      undefined,
      { bypassEligibilityCheck: true, from: SECURITY_EMAIL_FROM, replyTo: "support@nolsaf.com" },
    ));
  }
  if (user.phone) {
    tasks.push(sendSms(user.phone, `NoLSAF security alert: your payout destination changed to ${provider} ending ${maskedDestination.slice(-4)}. If this was not you, contact support immediately.`));
  }
  await Promise.allSettled(tasks);
}

function contactCodeError(res: Response, result: string, attempts = 0) {
  if (result === "LOCKED") {
    return res.status(429).json({ code: "CONTACT_CHANGE_LOCKED", error: "Too many incorrect codes. Start the contact change again." });
  }
  if (result === "INVALID") {
    return res.status(400).json({
      code: "CONTACT_CHANGE_CODE_INVALID",
      error: "Invalid verification code.",
      attemptsRemaining: Math.max(0, 5 - attempts),
    });
  }
  return res.status(400).json({ code: "CONTACT_CHANGE_EXPIRED", error: "No pending change was found, or the code expired. Start again." });
}

/**
 * POST /account/contact/request-change
 * Starts a protected contact change. An existing mature security channel must
 * authorize an actual replacement before the new destination receives a code.
 */
const requestContactChange: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const validationResult = requestContactChangeSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }
    const { field, currentPassword, totpCode } = validationResult.data;
    const value = field === "email" ? validationResult.data.value.trim().toLowerCase() : validationResult.data.value.trim();

    if (!FIELD_REGEX[field].test(value)) {
      return sendError(res, 400, `Please enter a valid ${FIELD_LABEL[field]}.`);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        phone: true,
        email: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        phoneChangedAt: true,
        emailChangedAt: true,
        passwordHash: true,
        twoFactorEnabled: true,
        twoFactorMethod: true,
        totpSecretEnc: true,
      },
    });
    if (!user) return sendError(res, 404, "User not found");

    const current = field === "email" ? (user as any).email : (user as any).phone;
    const currentVerifiedAt = field === "email" ? user.emailVerifiedAt : user.phoneVerifiedAt;
    const isReverifyingCurrent = typeof current === "string" && current.toLowerCase() === value.toLowerCase();
    if (isReverifyingCurrent && currentVerifiedAt) {
      return sendError(res, 400, `This is already your current ${FIELD_LABEL[field]} and it's verified.`);
    }

    // Reject if another account already owns this destination.
    const existing = await prisma.user.findFirst({
      where: { [field]: value, NOT: { id: userId } } as any,
      select: { id: true },
    });
    if (existing) {
      return sendError(res, 409, `This ${FIELD_LABEL[field]} is already associated with another account.`);
    }

    await deleteContactChangeChallenge(userId, field === "email" ? "phone" : "email");

    let stage: "AUTHORIZE_EXISTING" | "VERIFY_NEW" = "VERIFY_NEW";
    let deliveryField: ContactField = field;
    let deliveryDestination = value;
    let authorizationField: ContactField | undefined;
    let authorizationDestination: string | undefined;

    if (!isReverifyingCurrent) {
      const candidates: Array<{ field: ContactField; value: string | null; verifiedAt: Date | null; changedAt: Date | null }> = field === "email"
        ? [
            { field: "phone", value: user.phone, verifiedAt: user.phoneVerifiedAt, changedAt: user.phoneChangedAt },
            { field: "email", value: user.email, verifiedAt: user.emailVerifiedAt, changedAt: user.emailChangedAt },
          ]
        : [
            { field: "email", value: user.email, verifiedAt: user.emailVerifiedAt, changedAt: user.emailChangedAt },
            { field: "phone", value: user.phone, verifiedAt: user.phoneVerifiedAt, changedAt: user.phoneChangedAt },
          ];
      const trusted = candidates.find((candidate) => candidate.value && candidate.verifiedAt && contactIsMature(candidate.changedAt));
      if (trusted?.value) {
        stage = "AUTHORIZE_EXISTING";
        deliveryField = trusted.field;
        deliveryDestination = trusted.value;
        authorizationField = trusted.field;
        authorizationDestination = trusted.value;
      } else {
        const totpRequired = Boolean(user.twoFactorEnabled && user.twoFactorMethod === "TOTP" && user.totpSecretEnc);
        let stepUpValid = false;
        if (totpRequired && totpCode) {
          stepUpValid = authenticator.verify({ token: totpCode, secret: decrypt(user.totpSecretEnc) });
        } else if (!totpRequired && user.passwordHash && currentPassword) {
          stepUpValid = await verifyPassword(user.passwordHash, currentPassword);
        }
        if (!stepUpValid) {
          return res.status(403).json({
            code: "CONTACT_CHANGE_STEP_UP_REQUIRED",
            error: "No mature verified contact is available. Confirm your current password or authenticator code.",
            methods: {
              password: !totpRequired && Boolean(user.passwordHash),
              totp: totpRequired,
            },
          });
        }
      }
    }

    const otp = generateContactChangeOtp();
    await storeContactChangeChallenge(userId, {
      field,
      value,
      oldValue: current ?? null,
      stage,
      codeHash: hashContactChangeCode(otp),
      authorizationField,
      authorizationDestination,
    });
    try {
      await deliverContactCode(deliveryField, deliveryDestination, otp, stage === "AUTHORIZE_EXISTING" ? "authorize" : "verify");
    } catch {
      await deleteContactChangeChallenge(userId, field);
      return sendError(res, 502, "Failed to send the security code. No contact details were changed.");
    }

    try {
      await audit(req as AuthedRequest, "CONTACT_CHANGE_REQUESTED", `user:${userId}`, null, { field, value });
    } catch {
      // best-effort audit
    }

    return sendSuccess(res, {
      stage,
      sentTo: maskContact(deliveryField, deliveryDestination),
      authorizationField: stage === "AUTHORIZE_EXISTING" ? deliveryField : null,
    }, stage === "AUTHORIZE_EXISTING" ? "Authorize this change using your existing trusted contact." : "Confirm the new contact destination.");
  } catch (error) {
    console.error("account.contact.requestChange failed", error);
    sendError(res, 500, "Failed to send verification code");
  }
};
router.post("/contact/request-change", blockImpersonated as unknown as RequestHandler, limitContactChangeOtp as unknown as RequestHandler, requestContactChange as unknown as RequestHandler);

/** Verifies the existing trusted contact, then sends a fresh code to the new destination. */
const authorizeContactChange: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const parsed = authorizeContactChangeSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "Invalid input", parsed.error.issues);

    const consumed = await consumeContactChangeCode(userId, parsed.data.field, "AUTHORIZE_EXISTING", parsed.data.otp);
    if (consumed.result !== "VALID" || !consumed.entry) {
      return contactCodeError(res, consumed.result, consumed.entry?.attempts ?? 0);
    }

    const nextCode = generateContactChangeOtp();
    await storeContactChangeChallenge(userId, {
      field: consumed.entry.field,
      value: consumed.entry.value,
      oldValue: consumed.entry.oldValue,
      stage: "VERIFY_NEW",
      codeHash: hashContactChangeCode(nextCode),
      authorizationField: consumed.entry.authorizationField,
      authorizationDestination: consumed.entry.authorizationDestination,
    });
    try {
      await deliverContactCode(consumed.entry.field, consumed.entry.value, nextCode, "verify");
    } catch {
      await deleteContactChangeChallenge(userId, consumed.entry.field);
      return sendError(res, 502, "The new contact verification code could not be delivered. Start again.");
    }
    try {
      await audit(req as AuthedRequest, "CONTACT_CHANGE_AUTHORIZED", `user:${userId}`, null, {
        field: consumed.entry.field,
        authorizationField: consumed.entry.authorizationField,
      });
    } catch {
      // best-effort audit
    }
    return sendSuccess(res, {
      stage: "VERIFY_NEW",
      sentTo: maskContact(consumed.entry.field, consumed.entry.value),
    }, "Existing contact authorized. Verify the new destination.");
  } catch (error) {
    console.error("account.contact.authorizeChange failed", error);
    return sendError(res, 500, "Failed to authorize contact change");
  }
};
router.post("/contact/authorize-change", blockImpersonated as unknown as RequestHandler, limitContactChangeConfirm as unknown as RequestHandler, authorizeContactChange as unknown as RequestHandler);

/**
 * POST /account/contact/confirm-change
 * Verifies the OTP sent to the new phone/email and applies the change, marking the
 * new destination as verified.
 */
const confirmContactChange: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const validationResult = confirmContactChangeSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }
    const { field, otp } = validationResult.data;

    const consumed = await consumeContactChangeCode(userId, field, "VERIFY_NEW", otp);
    if (consumed.result !== "VALID" || !consumed.entry) {
      return contactCodeError(res, consumed.result, consumed.entry?.attempts ?? 0);
    }
    const entry = consumed.entry;

    // Re-check uniqueness in case another account claimed this destination meanwhile.
    const existing = await prisma.user.findFirst({
      where: { [field]: entry.value, NOT: { id: userId } } as any,
      select: { id: true },
    });
    if (existing) {
      return sendError(res, 409, `This ${FIELD_LABEL[field]} is already associated with another account.`);
    }

    const before = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, email: true, name: true, fullName: true, profileCompletedAt: true },
    });
    if (!before) return sendError(res, 404, "User not found");
    const verifiedAtField = field === "email" ? "emailVerifiedAt" : "phoneVerifiedAt";
    const changedAtField = field === "email" ? "emailChangedAt" : "phoneChangedAt";
    const oldValue = field === "email" ? before.email : before.phone;
    const actualChange = String(oldValue ?? "").toLowerCase() !== entry.value.toLowerCase();
    const changedAt = actualChange ? new Date() : null;
    const resultingIdentity = {
      name: before.name,
      fullName: before.fullName,
      email: field === 'email' ? entry.value : before.email,
      phone: field === 'phone' ? entry.value : before.phone,
    };
    const registrationStatus = getRegistrationStatus(resultingIdentity);
    const updated = await prisma.user.update({
      where: { id: userId },
      data: {
        [field]: entry.value,
        [verifiedAtField]: new Date(),
        ...(actualChange ? { [changedAtField]: changedAt } : {}),
        registrationStatus,
        ...(registrationStatus === 'COMPLETE' && !before.profileCompletedAt
          ? { profileCompletedAt: new Date() }
          : {}),
      } as any,
      select: {
        id: true,
        phone: true,
        email: true,
        phoneVerifiedAt: true,
        emailVerifiedAt: true,
        phoneChangedAt: true,
        emailChangedAt: true,
        registrationStatus: true,
        registrationSource: true,
        profileCompletedAt: true,
      },
    });

    await deleteContactChangeChallenge(userId, field === "email" ? "phone" : "email");

    if (actualChange) {
      const currentSessionId = (req as AuthedRequest).sessionId;
      await prisma.session.updateMany({
        where: { userId, revokedAt: null, ...(currentSessionId ? { NOT: { id: currentSessionId } } : {}) },
        data: { revokedAt: new Date() },
      });
      await invalidateAuthSessionCacheForUser(userId).catch(() => {});
      await sendContactChangedAlerts(before, field, entry.value);
    }

    try {
      await audit(req as AuthedRequest, "CONTACT_CHANGED", `user:${userId}`, before, {
        field,
        value: entry.value,
        actualChange,
        changedAt: changedAt?.toISOString() ?? null,
        otherSessionsRevoked: actualChange,
      });
    } catch {
      // best-effort audit
    }

    sendSuccess(res, {
      user: updated,
      securityCooldownUntil: actualChange ? new Date(Date.now() + CONTACT_SECURITY_COOLDOWN_MS).toISOString() : null,
    }, `Your ${FIELD_LABEL[field]} has been updated securely.`);
  } catch (error) {
    console.error("account.contact.confirmChange failed", error);
    sendError(res, 500, "Failed to confirm change");
  }
};
router.post("/contact/confirm-change", blockImpersonated as unknown as RequestHandler, limitContactChangeConfirm as unknown as RequestHandler, confirmContactChange as unknown as RequestHandler);

/** Shared provider failure classification for the no-write lookup endpoint. */
function sendPayoutProviderError(res: Response, error: unknown): boolean {
  if (error instanceof AzamPayDisburseConfigurationError) {
    console.error("account.payouts.configuration_unavailable", {
      operation: error.operation,
      missingKeys: error.missingKeys,
    });
    res.status(503).json({
      code: "PAYOUT_PROVIDER_NOT_CONFIGURED",
      error: "Payout verification is temporarily unavailable. No payout details were changed.",
      retryable: false,
    });
    return true;
  }
  if (error instanceof AzamPayDisburseError) {
    res.status(502).json({
      code: "PAYOUT_PROVIDER_UNAVAILABLE",
      error: error.providerMessage ?? "AzamPay verification is unavailable. No payout details were changed.",
      retryClass: error.retryClass,
    });
    return true;
  }
  return false;
}

/** Resolves the account holder through AzamPay without changing stored payout details. */
const verifyPayoutDestination: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const validationResult = updatePayoutsSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid payout destination", validationResult.error.issues);
    }

    const data = validationResult.data;
    const isBank = data.payoutPreferred === "BANK";
    const provider = isBank ? data.bankName : data.mobileMoneyProvider;
    const accountNumber = isBank ? data.bankAccountNumber : data.mobileMoneyNumber;
    const canonicalNumber = accountNumber.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, emailChangedAt: true, phoneChangedAt: true },
    });
    if (!currentUser) return sendError(res, 404, "User not found");
    const contactChangedAt = recentContactChange(currentUser);
    if (contactChangedAt) {
      const cooldownUntil = new Date(contactChangedAt.getTime() + CONTACT_SECURITY_COOLDOWN_MS);
      return res.status(409).json({
        code: "PAYOUT_CONTACT_COOLDOWN",
        error: "Payout destination changes are temporarily locked after a security contact change.",
        cooldownUntil: cooldownUntil.toISOString(),
        retryable: false,
      });
    }

    const lookup = await azamPayNameLookup({ bankName: provider, accountNumber });
    const resolvedName = String(lookup.name || "").trim();
    const returnedNumber = String(lookup.accountNumber || accountNumber).replace(/[^A-Za-z0-9]/g, "").toLowerCase();
    if (!lookup.status || !resolvedName) {
      return sendError(res, 409, "AzamPay could not verify the payout account holder");
    }
    const returnedProvider = String(lookup.bankName || "").trim();
    const providerMatches = isBank
      ? canonicalPayoutBank(returnedProvider) === provider
      : azamPayProvidersMatch(provider, returnedProvider);
    if (!providerMatches) {
      await audit(req as AuthedRequest, "USER_PAYOUT_LOOKUP_MISMATCH", `user:${userId}`, null, {
        mismatch: "PROVIDER",
        requestedProvider: provider,
        returnedProvider: returnedProvider || null,
        accountNumber: maskSensitiveDestination(accountNumber),
      });
      return sendError(
        res,
        409,
        isBank
          ? "The account does not match the selected bank. Check the bank and account number."
          : "The wallet number does not match the selected mobile money provider. Check the provider and number."
      );
    }
    if (returnedNumber !== canonicalNumber) {
      await audit(req as AuthedRequest, "USER_PAYOUT_LOOKUP_MISMATCH", `user:${userId}`, null, {
        provider,
        requested: maskSensitiveDestination(accountNumber),
        returned: maskSensitiveDestination(lookup.accountNumber),
      });
      return sendError(res, 409, "AzamPay returned a different account number. No payout details were changed.");
    }

    const challenge = await createPayoutVerificationChallenge({
      userId,
      destination: data,
      accountName: resolvedName,
      contactSecurityVersion: contactSecurityVersion(currentUser),
    });
    await audit(req as AuthedRequest, "USER_PAYOUT_DESTINATION_LOOKED_UP", `user:${userId}`, null, {
      payoutPreferred: data.payoutPreferred,
      provider,
      azamPayDisbursementEnabled: !isBank,
      accountName: resolvedName,
      accountNumber: maskSensitiveDestination(accountNumber),
      expiresAt: new Date(challenge.expiresAt).toISOString(),
    });

    return sendSuccess(
      res,
      {
        challengeToken: challenge.token,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
        destination: {
          type: data.payoutPreferred,
          provider,
          accountName: resolvedName,
          accountNumber: maskSensitiveDestination(accountNumber),
          currency: "TZS",
        },
        capabilities: {
          nameLookupVerified: true,
          azamPayDisbursementEnabled: !isBank,
        },
      },
      isBank
        ? "Bank account name verified. Automated AzamPay bank disbursement remains disabled."
        : "Payout destination verified. Confirm the account holder to save it."
    );
  } catch (error: unknown) {
    if (sendPayoutProviderError(res, error)) return;
    console.error("account.payouts.verify failed", error);
    sendError(res, 500, "Failed to verify payout information");
  }
};
router.post(
  "/payouts/verify",
  blockImpersonated as unknown as RequestHandler,
  payoutLookupLimit,
  verifyPayoutDestination as unknown as RequestHandler
);

const updatePayouts: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const validationResult = confirmPayoutSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "A valid payout verification confirmation is required", validationResult.error.issues);
    }

    const challenge = await consumePayoutVerificationChallenge(validationResult.data.challengeToken, userId);
    if (!challenge) {
      return res.status(410).json({
        code: "PAYOUT_VERIFICATION_EXPIRED",
        error: "Payout verification expired or was already used. Verify the destination again.",
        retryable: false,
      });
    }

    const data = challenge.destination;
    const resolvedName = challenge.accountName;
    const isBank = data.payoutPreferred === "BANK";
    const provider = isBank ? data.bankName : data.mobileMoneyProvider;
    const accountNumber = isBank ? data.bankAccountNumber : data.mobileMoneyNumber;

    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { payout: true, email: true, phone: true, emailChangedAt: true, phoneChangedAt: true },
    });
    if (!currentUser) return sendError(res, 404, "User not found");
    if (challenge.contactSecurityVersion !== contactSecurityVersion(currentUser) || recentContactChange(currentUser)) {
      return res.status(409).json({
        code: "PAYOUT_CONTACT_SECURITY_CHANGED",
        error: "Your security contacts changed during payout verification. Wait for the cooling period, then verify again.",
        retryable: false,
      });
    }
    const before = currentUser.payout || null;

    const now = new Date();
    const payoutData = isBank
      ? {
          payoutPreferred: "BANK",
          bankName: data.bankName,
          bankAccountName: resolvedName,
          bankAccountNumber: encrypt(data.bankAccountNumber),
          bankBranch: data.bankBranch || "",
        }
      : {
          payoutPreferred: "MOBILE_MONEY",
          mobileMoneyProvider: data.mobileMoneyProvider,
          mobileMoneyNumber: encrypt(data.mobileMoneyNumber),
          mobileMoneyAccountName: resolvedName,
        };

    const account = await prisma.$transaction(async (tx) => {
      const existing = await tx.payoutAccount.findUnique({
        where: { userId_provider_accountNumber: { userId, provider, accountNumber } },
      });
      const verified = existing
        ? await tx.payoutAccount.update({
            where: { id: existing.id },
            data: {
              type: isBank ? "BANK" : "MOBILE_MONEY",
              accountName: resolvedName,
              isVerified: true,
              verifiedAt: existing.verifiedAt ?? now,
              lastVerifiedAt: now,
              destinationChangedAt: now,
              isDefault: true,
              isActive: true,
            },
          })
        : await tx.payoutAccount.create({
            data: {
              userId,
              type: isBank ? "BANK" : "MOBILE_MONEY",
              provider,
              accountNumber,
              accountName: resolvedName,
              currency: "TZS",
              isVerified: true,
              verifiedAt: now,
              lastVerifiedAt: now,
              destinationChangedAt: now,
              isDefault: true,
              isActive: true,
            },
          });

      // Exactly one active/default destination is selectable for new payouts.
      // Existing disbursements keep their immutable account relation and will
      // still pass the approval-fingerprint check before any money moves.
      await tx.payoutAccount.updateMany({
        where: { userId, id: { not: verified.id } },
        data: { isDefault: false, isActive: false },
      });
      await tx.user.update({ where: { id: userId }, data: { payout: payoutData } });
      return verified;
    });

    await audit(req as AuthedRequest, "USER_PAYOUT_DESTINATION_VERIFIED", `user:${userId}`, before, {
      payoutPreferred: data.payoutPreferred,
      provider,
      accountName: resolvedName,
      accountNumber: maskSensitiveDestination(accountNumber),
      payoutAccountId: account.id,
      destinationChangedAt: account.destinationChangedAt,
    });
    await sendPayoutDestinationChangedAlerts(currentUser, provider, accountNumber);

    sendSuccess(
      res,
      {
        payoutAccount: {
          id: account.id,
          type: account.type,
          provider: account.provider,
          accountName: account.accountName,
          accountNumber: maskSensitiveDestination(account.accountNumber),
          isVerified: account.isVerified,
          verifiedAt: account.verifiedAt,
          lastVerifiedAt: account.lastVerifiedAt,
        },
      },
      "Payout destination verified and secured"
    );
  } catch (error: unknown) {
    console.error("account.payouts.update failed", error);
    sendError(res, 500, "Failed to update payout information");
  }
};
router.put("/payouts", blockImpersonated as unknown as RequestHandler, payoutUpdateLimit, updatePayouts as unknown as RequestHandler);

/** POST /account/password/change */
const changePassword: RequestHandler = async (req, res) => {
  try {
    // Validate input
    const validationResult = changePasswordSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }

    const { currentPassword, newPassword } = validationResult.data;
    const userId = getUserId(req as AuthedRequest);

    if (newPassword.length < 8 || newPassword.length > PASSWORD_MAX_LENGTH) {
      return sendError(res, 400, `Password must be between 8 and ${PASSWORD_MAX_LENGTH} characters`, {
        reasons: [`Password length must be between 8 and ${PASSWORD_MAX_LENGTH} characters`]
      });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return sendError(res, 404, "User not found");
    }
    
    if (!user.passwordHash) {
      return sendError(res, 400, "No password set for this account");
    }

    // DoS protection: Check for timeout/lockout
    const attempt = getPasswordChangeAttempt(userId);
    const now = Date.now();
    
    if (attempt.lockedUntil && now < attempt.lockedUntil) {
      const remaining = Math.ceil((attempt.lockedUntil - now) / 1000);
      return sendError(res, 429, `Too many failed attempts. Please wait ${remaining} seconds.`, {
        reasons: [`Account temporarily locked. Try again in ${remaining} seconds.`],
        lockedUntil: attempt.lockedUntil
      });
    }

    // DoS protection: Check 30-minute cooldown after successful password change, shared with
    // the OTP-based forgot-password reset flow so the cooldown can't be bypassed by switching flows.
    const cooldownRemaining = getPasswordChangeCooldownRemaining(user.id);
    if (cooldownRemaining > 0) {
      const remaining = Math.ceil(cooldownRemaining / 60000);
      return sendError(res, 429, `Password was recently changed. Please wait ${remaining} minute(s) before changing it again.`, {
        reasons: [`Password change cooldown active. Try again in ${remaining} minute(s).`],
        cooldownUntil: now + cooldownRemaining
      });
    }

    // Verify current password
    const isValid = await verifyPassword(user.passwordHash, currentPassword);
    if (!isValid) {
      // Track failure
      attempt.failures += 1;
      attempt.lastFailure = now;
      
      // Lock after 3 consecutive failures for 5 minutes
      if (attempt.failures >= 3) {
        attempt.lockedUntil = now + (5 * 60 * 1000); // 5 minutes
        attempt.failures = 0; // Reset counter after lockout
        return sendError(res, 429, "Too many failed attempts. Account locked for 5 minutes.", {
          reasons: ['Account temporarily locked due to multiple failed password change attempts.'],
          lockedUntil: attempt.lockedUntil
        });
      }
      
      return sendError(res, 400, "Current password incorrect", {
        reasons: [`Incorrect current password. ${3 - attempt.failures} attempt(s) remaining before lockout.`]
      });
    }

    // Reset failure counter on successful password verification
    attempt.failures = 0;
    attempt.lockedUntil = null;

    // Enforce policy: Prevent reusing the current/existing password
    const isCurrentPassword = await verifyPassword(user.passwordHash, newPassword);
    if (isCurrentPassword) {
      return sendError(res, 400, "Cannot reuse current password", { 
        reasons: ['The new password must be different from your current password. Please choose a different password.'] 
      });
    }

    // Validate against the active SystemSetting password policy.
    const { valid, reasons } = await validatePasswordWithSettings(newPassword, user.role || null);
    if (!valid) {
      return sendError(res, 400, "Password does not meet strength requirements", { reasons });
    }

    // Prevent reuse of recent passwords from history
    const reused = await isPasswordReused(user.id, newPassword);
    if (reused) {
      return sendError(res, 400, "Password was used recently", { 
        reasons: ['This password was used recently. Please choose a different password that has not been used before.'] 
      });
    }

    // Update password
    const newHash = await hashPassword(newPassword);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    
    // Record the new hash in password history (best-effort)
    try {
      await addPasswordToHistory(user.id, newHash);
    } catch (e) {
      // Best-effort
    }

    // Record successful password change and set cooldown
    attempt.failures = 0;
    attempt.lockedUntil = null;
    recordPasswordChangeSuccess(user.id);

    // Check if force logout on password change is enabled
    const { shouldForceLogout, clearAuthCookie } = await import('../lib/sessionManager.js');
    const forceLogout = await shouldForceLogout();
    
    if (forceLogout) {
      // Bump tokensValidAfter so every already-issued token (this device and all
      // others) is rejected, not just the current cookie cleared below.
      await prisma.user.update({ where: { id: user.id }, data: { tokensValidAfter: new Date() } }).catch(() => {});
      await invalidateAuthSessionCacheForUser(user.id).catch(() => {});
      clearAuthCookie(res);
    }

    await audit(req as AuthedRequest, "USER_PASSWORD_CHANGE", `user:${user.id}`);
    sendSuccess(res, { forceLogout, cooldownUntil: now + (30 * 60 * 1000) }, "Password changed successfully");
  } catch (error: any) {
    console.error('account.password.change failed', error);
    sendError(res, 500, "Failed to change password");
  }
};
router.post("/password/change", sensitive as unknown as RequestHandler, changePassword as unknown as RequestHandler);

/** 2FA: TOTP Setup — step 1: create secret + otpauth URL + QR */
const setupTotp: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    const issuer = process.env.TOTP_ISSUER || "NoLSAF";
    const secret = authenticator.generateSecret();
    const accountName = user.email || user.phone || `user-${user.id}`;
    const otpauth = authenticator.keyuri(accountName, issuer, secret);
    const qr = await QRCode.toDataURL(otpauth);

    // Temporarily store encrypted secret until verified
    await prisma.user.update({ 
      where: { id: user.id }, 
      data: { totpSecretEnc: encrypt(secret) } 
    });

    sendSuccess(res, {
      otpauthUrl: otpauth,
      qrDataUrl: qr,
      secretMasked: `${secret.slice(0, 4)}••••••${secret.slice(-2)}`
    });
  } catch (error: any) {
    console.error('account.2fa.totp.setup failed', error);
    sendError(res, 500, "Failed to setup TOTP");
  }
};
router.post("/2fa/totp/setup", sensitive as unknown as RequestHandler, setupTotp as unknown as RequestHandler);

/** 2FA: Verify and enable — step 2 */
const verifyTotp: RequestHandler = async (req, res) => {
  try {
    // Validate input
    const validationResult = totpVerifySchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }

    const { code } = validationResult.data;
    const userId = getUserId(req as AuthedRequest);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecretEnc) {
      return sendError(res, 400, "TOTP not initiated");
    }

    const secret = decrypt(user.totpSecretEnc);
    const isValid = authenticator.verify({ token: code, secret });
    if (!isValid) {
      return sendError(res, 400, "Invalid code");
    }

    // Generate backup codes
    const plainCodes: string[] = Array.from({ length: BACKUP_CODES_COUNT }, () => genBackupCode());
    const hashed = await Promise.all(plainCodes.map((c) => hashCode(c)));

    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true, twoFactorMethod: "TOTP", backupCodesHash: hashed },
    });
    
    await audit(req as AuthedRequest, "USER_2FA_ENABLED", `user:${user.id}`);

    // Return plaintext codes ONCE
    sendSuccess(res, { backupCodes: plainCodes }, "2FA enabled successfully");
  } catch (error: any) {
    console.error('account.2fa.totp.verify failed', error);
    sendError(res, 500, "Failed to verify TOTP");
  }
};
router.post("/2fa/totp/verify", sensitive as unknown as RequestHandler, verifyTotp as unknown as RequestHandler);

function genBackupCode(): string {
  // XXXX-XXXX format
  const n = Math.floor(Math.random() * 36 ** 8).toString(36).padStart(8, "0");
  return `${n.slice(0, 4)}-${n.slice(4)}`.toUpperCase();
}

// =========================================================
//  SECURITY (Hub) APIs — used by agent/account security UI
// =========================================================

/** GET /account/security/2fa */
const getSecurity2faStatus: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorEnabled: true, twoFactorMethod: true, phone: true },
    } as any);
    if (!user) return sendError(res, 404, "User not found");

    const enabled = !!(user as any).twoFactorEnabled;
    const method = ((user as any).twoFactorMethod as string | null) ?? null;
    return res.json({
      totpEnabled: enabled && method === "TOTP",
      smsEnabled: enabled && method === "SMS",
      phone: (user as any).phone ?? null,
    });
  } catch (e: any) {
    console.error("account.security.2fa.status failed", e);
    return res.status(500).json({ error: "failed" });
  }
};
router.get("/security/2fa", getSecurity2faStatus as unknown as RequestHandler);

/** GET /account/security/2fa/provision?type=totp */
const getSecurity2faProvision: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  const type = (req.query.type as string) || "totp";
  if (type !== "totp") return sendError(res, 400, "unsupported type");
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, phone: true } } as any);
    if (!user) return sendError(res, 404, "User not found");

    const issuer = process.env.TOTP_ISSUER || "NoLSAF";
    const secret = authenticator.generateSecret();
    const accountName = (user as any).email || (user as any).phone || `user-${(user as any).id}`;
    const otpauth = authenticator.keyuri(accountName, issuer, secret);
    let qr: string | null = null;
    try {
      qr = await QRCode.toDataURL(otpauth);
    } catch {
      qr = null;
    }

    // Store secret (encrypted) until verified
    try {
      await prisma.user.update({ where: { id: (user as any).id }, data: { totpSecretEnc: encrypt(secret) } } as any);
    } catch (e) {
      // Best-effort — verification will fail if not stored
    }

    return res.json({ qr, secret, otpauth });
  } catch (e: any) {
    console.error("account.security.2fa.provision failed", e);
    return res.status(500).json({ error: "failed" });
  }
};
router.get("/security/2fa/provision", sensitive as unknown as RequestHandler, getSecurity2faProvision as unknown as RequestHandler);

/** POST /account/security/2fa */
const postSecurity2fa: RequestHandler = async (req, res) => {
  try {
    const parsed = security2faSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "Invalid input", parsed.error.issues);

    const { action, code, secret } = parsed.data;
    const userId = getUserId(req as AuthedRequest);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return sendError(res, 404, "User not found");

    if (action === "disable") {
      // Mirror /account/2fa/disable behavior but accept the hub payload
      let isValid = false;
      if (code.includes("-")) {
        if ((user as any).backupCodesHash && Array.isArray((user as any).backupCodesHash)) {
          for (const hash of (user as any).backupCodesHash as string[]) {
            if (await verifyCode(hash, code)) {
              isValid = true;
              break;
            }
          }
        }
      } else if ((user as any).totpSecretEnc) {
        isValid = authenticator.verify({ token: code, secret: decrypt((user as any).totpSecretEnc) });
      }

      if (!isValid) return sendError(res, 400, "Invalid code");

      await prisma.user.update({
        where: { id: (user as any).id },
        data: { twoFactorEnabled: false, twoFactorMethod: null, backupCodesHash: [], totpSecretEnc: null },
      } as any);
      try {
        await audit(req as AuthedRequest, "USER_2FA_DISABLED", `user:${(user as any).id}`);
      } catch {
        // ignore
      }
      return res.json({ ok: true });
    }

    // enable
    // If secret was provided, persist it first (best-effort)
    if (secret && typeof secret === "string" && secret.trim()) {
      try {
        await prisma.user.update({ where: { id: (user as any).id }, data: { totpSecretEnc: encrypt(secret.trim()) } } as any);
      } catch {
        // ignore
      }
    }

    const fresh = await prisma.user.findUnique({ where: { id: (user as any).id } });
    if (!fresh || !(fresh as any).totpSecretEnc) return sendError(res, 400, "TOTP not initiated");

    const secretPlain = decrypt((fresh as any).totpSecretEnc);
    const isValid = authenticator.verify({ token: code, secret: secretPlain });
    if (!isValid) return sendError(res, 400, "Invalid code");

    const plainCodes: string[] = Array.from({ length: BACKUP_CODES_COUNT }, () => genBackupCode());
    const hashed = await Promise.all(plainCodes.map((c) => hashCode(c)));

    await prisma.user.update({
      where: { id: (fresh as any).id },
      data: { twoFactorEnabled: true, twoFactorMethod: "TOTP", backupCodesHash: hashed },
    } as any);

    try {
      await audit(req as AuthedRequest, "USER_2FA_ENABLED", `user:${(fresh as any).id}`);
    } catch {
      // ignore
    }

    return res.json({ ok: true, backupCodes: plainCodes });
  } catch (e: any) {
    console.error("account.security.2fa.post failed", e);
    return res.status(500).json({ error: "failed" });
  }
};
router.post("/security/2fa", sensitive as unknown as RequestHandler, postSecurity2fa as unknown as RequestHandler);

// Passkeys for account/agent portal (shared UI expects driver-like endpoints)
const accountPasskeyChallenges = new Map<string, { challenge: string; expiresAt: number }>(); // userId -> challenge fallback
const accountPasskeyStore = new Map<string, Array<any>>(); // userId -> [{ id, name, createdAt, publicKey, signCount }]
const ACCOUNT_PASSKEY_CHALLENGE_TTL_SEC = 5 * 60;
const ACCOUNT_PASSKEY_CHALLENGE_PREFIX = "account:passkey:challenge:";

async function setAccountPasskeyChallenge(userId: number, challenge: string): Promise<void> {
  const key = String(userId);
  const expiresAt = Date.now() + ACCOUNT_PASSKEY_CHALLENGE_TTL_SEC * 1000;
  try {
    const redis = getRedis();
    if (redis) {
      await redis.set(
        `${ACCOUNT_PASSKEY_CHALLENGE_PREFIX}${key}`,
        JSON.stringify({ challenge, expiresAt }),
        "EX",
        ACCOUNT_PASSKEY_CHALLENGE_TTL_SEC
      );
      return;
    }
  } catch {
    // Redis is preferred for multi-instance correctness; memory keeps single-instance dev working.
  }
  accountPasskeyChallenges.set(key, { challenge, expiresAt });
}

async function getAccountPasskeyChallenge(userId: number): Promise<string | null> {
  const key = String(userId);
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.get(`${ACCOUNT_PASSKEY_CHALLENGE_PREFIX}${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { challenge?: string; expiresAt?: number };
      if (!parsed.challenge || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= Date.now()) return null;
      return parsed.challenge;
    }
  } catch {
    // fall back below
  }

  const stored = accountPasskeyChallenges.get(key);
  if (!stored) return null;
  if (stored.expiresAt <= Date.now()) {
    accountPasskeyChallenges.delete(key);
    return null;
  }
  return stored.challenge;
}

async function deleteAccountPasskeyChallenge(userId: number): Promise<void> {
  const key = String(userId);
  try {
    const redis = getRedis();
    if (redis) await redis.del(`${ACCOUNT_PASSKEY_CHALLENGE_PREFIX}${key}`);
  } catch {
    // best effort
  }
  accountPasskeyChallenges.delete(key);
}

function toBase64Url(buf: Buffer | Uint8Array) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function fromBase64Url(s: string) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

/** GET /account/security/passkeys */
const getAccountPasskeys: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  try {
    if ((prisma as any).passkey) {
      try {
        const items = await (prisma as any).passkey.findMany({ where: { userId } });
        return res.json({
          items: (items || []).map((it: any) => ({
            id: it.credentialId ?? String(it.id),
            name: it.name ?? "passkey",
            createdAt: it.createdAt,
          })),
        });
      } catch {
        // fallthrough
      }
    }

    const items = accountPasskeyStore.get(String(userId)) || [];
    return res.json({ items });
  } catch (e: any) {
    console.error("account.security.passkeys.list failed", e);
    return res.status(500).json({ error: "failed" });
  }
};
router.get("/security/passkeys", getAccountPasskeys as unknown as RequestHandler);

/** POST /account/security/passkeys -> create registration options */
const postAccountPasskeysCreate: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  try {
    const { rpID } = getWebAuthnRp();

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } } as any);
    const userName = (user as any)?.email || `user-${userId}`;

    let excludeCredentials: Array<any> = [];
    try {
      if ((prisma as any).passkey) {
        const existing = await (prisma as any).passkey.findMany({ where: { userId } });
        excludeCredentials = (existing || []).map((c: any) => ({ id: c.credentialId, type: "public-key" }));
      } else {
        const existing = accountPasskeyStore.get(String(userId)) || [];
        excludeCredentials = existing.map((c: any) => ({ id: c.id, type: "public-key" }));
      }
    } catch {
      // ignore
    }

    const options = await generateRegistrationOptions({
      rpName: process.env.APP_NAME || "nolsaf",
      rpID,
      userID: String(userId),
      userName,
      timeout: 60000,
      attestationType: "direct",
      // residentKey makes the credential discoverable so it can be used for
      // username-less login (/api/auth/passkeys/options with no allowCredentials).
      authenticatorSelection: { userVerification: "preferred", residentKey: "preferred" },
      excludeCredentials,
    });

    await setAccountPasskeyChallenge(userId, options.challenge as string);
    return res.json({ publicKey: options });
  } catch {
    return res.status(500).json({ error: "failed" });
  }
};
router.post("/security/passkeys", sensitive as unknown as RequestHandler, postAccountPasskeysCreate as unknown as RequestHandler);

/** POST /account/security/passkeys/verify -> verify attestation and store credential */
const postAccountPasskeysVerify: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  try {
    const body = (req.body ?? {}) as any;
    const name = body?.name;

    const credential = (() => {
      if (body && typeof body === "object" && typeof body.id === "string" && body.response) return body;
      if (body && typeof body === "object" && body.response && typeof body.response.id === "string") return body.response;
      if (body && typeof body === "object" && typeof body.id === "string" && typeof body.rawId === "string" && body.response) {
        return {
          id: body.id,
          rawId: body.rawId,
          response: body.response,
          type: body.type ?? "public-key",
          clientExtensionResults: body.clientExtensionResults ?? {},
        };
      }
      return null;
    })();

    if (!credential) {
      return res.status(400).json({ error: "invalid payload" });
    }

    const storedChallenge = await getAccountPasskeyChallenge(userId);
    if (!storedChallenge) return res.status(400).json({ error: "no challenge found" });

    const { rpID, expectedOrigins } = getWebAuthnRp();

    let verification: any = null;
    try {
      verification = await (verifyRegistrationResponse as any)({
        response: credential,
        expectedChallenge: storedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        requireUserVerification: false,
      } as any);
    } catch (e) {
      const details = process.env.NODE_ENV !== "production" ? String((e as any)?.message ?? e) : undefined;
      return res.status(400).json({ error: "verification failed", ...(details ? { details } : {}) });
    }

    if (!verification || !verification.verified) return res.status(400).json({ error: "verification failed" });
    try {
      await deleteAccountPasskeyChallenge(userId);
    } catch {
      // ignore
    }

    const regInfo = verification.registrationInfo;
    if (!regInfo || !regInfo.credentialID || !regInfo.credentialPublicKey) {
      return res.status(500).json({ error: "missing registration info" });
    }

    const credentialId = toBase64Url(Buffer.from(regInfo.credentialID));
    const publicKey = toBase64Url(Buffer.from(regInfo.credentialPublicKey));
    const signCount = typeof regInfo.counter === "number" ? regInfo.counter : 0;

    if ((prisma as any).passkey) {
      try {
        const rec = await (prisma as any).passkey.create({
          data: {
            userId,
            credentialId,
            publicKey,
            signCount,
          },
        });
        return res.json({ ok: true, item: { id: credentialId, name: name ?? "passkey", createdAt: rec.createdAt } });
      } catch {
        // fallthrough to memory
      }
    }

    const item = { id: credentialId, name: name ?? "passkey", createdAt: new Date().toISOString(), publicKey, signCount };
    const list = accountPasskeyStore.get(String(userId)) || [];
    list.unshift(item);
    accountPasskeyStore.set(String(userId), list);
    return res.json({ ok: true, item });
  } catch {
    return res.status(500).json({ error: "failed" });
  }
};
router.post("/security/passkeys/verify", sensitive as unknown as RequestHandler, postAccountPasskeysVerify as unknown as RequestHandler);

/** DELETE /account/security/passkeys/:id */
const deleteAccountPasskey: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  try {
    const id = (req as any).params?.id;
    if (!id) return res.status(400).json({ error: "id required" });

    if ((prisma as any).passkey) {
      try {
        // credentialId is unique in schema
        await (prisma as any).passkey.delete({ where: { credentialId: id } });
        return res.json({ ok: true });
      } catch {
        // fallthrough
      }
    }

    const list = (accountPasskeyStore.get(String(userId)) || []).filter((k: any) => k.id !== id);
    accountPasskeyStore.set(String(userId), list);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "failed" });
  }
};
router.delete("/security/passkeys/:id", sensitive as unknown as RequestHandler, deleteAccountPasskey as unknown as RequestHandler);

/** POST /account/security/passkeys/authenticate -> options for navigator.credentials.get */
const postAccountPasskeysAuthenticate: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  try {
    const { rpID } = getWebAuthnRp();

    let allowCredentials: Array<any> = [];
    try {
      if ((prisma as any).passkey) {
        const existing = await (prisma as any).passkey.findMany({ where: { userId } });
        allowCredentials = (existing || []).map((c: any) => ({ id: c.credentialId, type: "public-key" }));
      } else {
        const existing = accountPasskeyStore.get(String(userId)) || [];
        allowCredentials = existing.map((c: any) => ({ id: c.id, type: "public-key" }));
      }
    } catch {
      // ignore
    }

    const options = await generateAuthenticationOptions({
      timeout: 60000,
      rpID,
      userVerification: "preferred",
      allowCredentials,
    });

    await setAccountPasskeyChallenge(userId, (options as any).challenge as string);
    return res.json({ publicKey: options });
  } catch {
    return res.status(500).json({ error: "failed" });
  }
};
router.post(
  "/security/passkeys/authenticate",
  sensitive as unknown as RequestHandler,
  postAccountPasskeysAuthenticate as unknown as RequestHandler
);

/** POST /account/security/passkeys/authenticate/verify */
const postAccountPasskeysAuthenticateVerify: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  try {
    const body = req.body ?? {};
    const { response } = body as any;
    if (!response) return res.status(400).json({ error: "invalid payload" });

    const storedChallenge = await getAccountPasskeyChallenge(userId);
    if (!storedChallenge) return res.status(400).json({ error: "no challenge found" });

    const credId = response.id || response.rawId;
    if (!credId) return res.status(400).json({ error: "missing credential id" });

    let stored: any = null;
    try {
      if ((prisma as any).passkey) {
        stored = await (prisma as any).passkey.findFirst({ where: { credentialId: credId } });
      } else {
        const list = accountPasskeyStore.get(String(userId)) || [];
        stored = list.find((c: any) => c.id === credId || c.credentialId === credId) || null;
      }
    } catch {
      // ignore
    }

    if (!stored) return res.status(400).json({ error: "credential not found" });

    const publicKey = stored.publicKey;
    const signCount = typeof stored.signCount === "number" ? stored.signCount : 0;

    const { rpID, expectedOrigins } = getWebAuthnRp();

    let verification: any = null;
    try {
      verification = await (verifyAuthenticationResponse as any)({
        response,
        expectedChallenge: storedChallenge,
        expectedOrigin: expectedOrigins,
        expectedRPID: rpID,
        authenticator: {
          credentialID: stored.credentialId || stored.credentialID || stored.id || credId,
          credentialPublicKey: fromBase64Url(publicKey),
          counter: signCount,
        },
        requireUserVerification: false,
      } as any);
    } catch {
      return res.status(400).json({ error: "verification failed" });
    }

    if (!verification || !verification.verified) return res.status(400).json({ error: "verification failed" });
    await deleteAccountPasskeyChallenge(userId);

    const newCounter =
      (verification.authenticationInfo && (verification.authenticationInfo.newCounter ?? verification.authenticationInfo.counter)) ?? null;
    if (typeof newCounter === "number") {
      try {
        if ((prisma as any).passkey) {
          await (prisma as any).passkey.update({ where: { credentialId: stored.credentialId || stored.credentialID || credId }, data: { signCount: newCounter } });
        } else {
          const list = accountPasskeyStore.get(String(userId)) || [];
          const idx = list.findIndex((c: any) => c.id === (stored.credentialId || stored.id || credId));
          if (idx >= 0) {
            list[idx].signCount = newCounter;
            accountPasskeyStore.set(String(userId), list);
          }
        }
      } catch {
        // ignore
      }
    }

    return res.json({ ok: true, verified: true });
  } catch {
    return res.status(500).json({ error: "failed" });
  }
};
router.post(
  "/security/passkeys/authenticate/verify",
  sensitive as unknown as RequestHandler,
  postAccountPasskeysAuthenticateVerify as unknown as RequestHandler
);

/** GET /account/security/logins */
const getAccountLoginHistory: RequestHandler = async (req, res) => {
  const userId = getUserId(req as AuthedRequest);
  try {
    // Prefer audit logs produced by auth flows (USER_LOGIN/USER_LOGOUT). These include IP + UA.
    if ((prisma as any).auditLog) {
      try {
        const audits = await (prisma as any).auditLog.findMany({
          where: { actorId: userId, action: { in: ["USER_LOGIN", "USER_LOGOUT"] } },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        const records = (audits || []).map((it: any) => {
          const ua = typeof it.ua === "string" ? it.ua : "";
          const after = it.afterJson as any;
          const method = after && typeof after.loginMethod === "string" ? after.loginMethod : null;
          const event = after && typeof after.event === "string" ? after.event : (it.action === "USER_LOGOUT" ? "logout" : "login");
          const ok = after && typeof after.success === "boolean" ? after.success : (it.action === "USER_LOGIN" ? true : true);
          const detailsParts = [
            event ? `Event: ${event}` : null,
            method ? `Method: ${method}` : null,
            ua ? `UA: ${ua}` : null,
          ].filter(Boolean);
          return {
            id: String(it.id),
            at: it.createdAt,
            ip: it.ip ?? null,
            username: after?.email ?? null,
            platform: inferPlatformFromUserAgent(ua),
            details: detailsParts.length ? detailsParts.join("\n") : null,
            timeUsed: null,
            success: ok,
          };
        });
        return res.json({ records });
      } catch {
        // ignore
      }
    }

    // Best-effort: derive from sessions if present
    if ((prisma as any).session) {
      try {
        const sessions = await (prisma as any).session.findMany({
          where: { userId },
          orderBy: { createdAt: "desc" },
          take: 50,
        });
        const records = (sessions || []).map((s: any) => ({
          id: s.id,
          at: s.createdAt,
          ip: null,
          username: null,
          platform: null,
          details: null,
          timeUsed: null,
          success: true,
        }));
        return res.json({ records });
      } catch {
        // ignore
      }
    }

    // Fallback/demo data
    const demo = [
      { id: "l1", at: new Date().toISOString(), ip: "127.0.0.1", username: "agent", platform: "Windows", details: "Browser: Chrome", timeUsed: 3600, success: true },
      { id: "l2", at: new Date(Date.now() - 3600 * 1000).toISOString(), ip: "127.0.0.2", username: "agent", platform: "iOS", details: "Browser: Safari", timeUsed: 45, success: false },
    ];
    return res.json({ records: demo });
  } catch (e: any) {
    console.error("account.security.logins failed", e);
    return res.status(500).json({ error: "failed" });
  }
};
router.get("/security/logins", getAccountLoginHistory as unknown as RequestHandler);

function inferPlatformFromUserAgent(ua: string) {
  const s = String(ua || "").toLowerCase();
  if (!s) return null;
  if (s.includes("windows")) return "Windows";
  if (s.includes("android")) return "Android";
  if (s.includes("iphone") || s.includes("ipad") || s.includes("ipod")) return "iOS";
  if (s.includes("mac os x") || s.includes("macintosh")) return "macOS";
  if (s.includes("linux")) return "Linux";
  return "Unknown";
}

/** 2FA: Disable (accepts TOTP code or backup code) */
const disable2FA: RequestHandler = async (req, res) => {
  try {
    // Validate input
    const validationResult = totpDisableSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }

    const { code } = validationResult.data;
    const userId = getUserId(req as AuthedRequest);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return sendError(res, 404, "User not found");
    }
    
    if (!user.twoFactorEnabled) {
      return sendError(res, 400, "2FA not enabled");
    }

    // Verify code if provided
    let isValid = false;
    if (code) {
      if (code.includes("-")) {
        // Backup code
        if (user.backupCodesHash && Array.isArray(user.backupCodesHash)) {
          for (const hash of user.backupCodesHash as string[]) {
            if (await verifyCode(hash, code)) {
              isValid = true;
              break;
            }
          }
        }
      } else if (user.totpSecretEnc) {
        // TOTP code
        isValid = authenticator.verify({ token: code, secret: decrypt(user.totpSecretEnc) });
      }
    }
    
    if (!isValid) {
      return sendError(res, 400, "Invalid code");
    }

    await prisma.user.update({ 
      where: { id: user.id }, 
      data: { 
        twoFactorEnabled: false, 
        twoFactorMethod: null, 
        backupCodesHash: [], 
        totpSecretEnc: null 
      } 
    });
    
    await audit(req as AuthedRequest, "USER_2FA_DISABLED", `user:${user.id}`);
    sendSuccess(res, null, "2FA disabled successfully");
  } catch (error: any) {
    console.error('account.2fa.disable failed', error);
    sendError(res, 500, "Failed to disable 2FA");
  }
};
router.post("/2fa/disable", sensitive as unknown as RequestHandler, disable2FA as unknown as RequestHandler);

/** 2FA: Regenerate backup codes */
const regenCodes: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user?.twoFactorEnabled) {
      return sendError(res, 400, "2FA not enabled");
    }

    const plainCodes: string[] = Array.from({ length: BACKUP_CODES_COUNT }, () => genBackupCode());
    const hashed = await Promise.all(plainCodes.map((c) => hashCode(c)));
    
    await prisma.user.update({ 
      where: { id: user.id }, 
      data: { backupCodesHash: hashed } 
    });
    
    await audit(req as AuthedRequest, "USER_2FA_CODES_REGEN", `user:${user.id}`);
    sendSuccess(res, { backupCodes: plainCodes }, "Backup codes regenerated successfully");
  } catch (error: any) {
    console.error('account.2fa.codes.regenerate failed', error);
    sendError(res, 500, "Failed to regenerate backup codes");
  }
};
router.post("/2fa/codes/regenerate", sensitive as unknown as RequestHandler, regenCodes as unknown as RequestHandler);

/** 2FA: SMS Send - Send OTP code via SMS */
const sendSms2FA: RequestHandler = async (req, res) => {
  try {
    const validationResult = smsSendSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }

    const userId = getUserId(req as AuthedRequest);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    if (!user.phone) {
      return sendError(res, 400, "Phone number is required for SMS 2FA. Please update your profile.");
    }

    // Generate 6-digit OTP code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await hashCode(code);
    const auditHash = hashOtpCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store OTP in phoneOtp table
    await prisma.phoneOtp.create({
      data: {
        userId: user.id,
        phone: user.phone,
        codeHash,
        expiresAt,
      },
    });

    // Send SMS
    const smsResult = await sendSms(user.phone, `NoLSAF 2FA verification code: ${code}`);

    try {
      const entity = otpEntityKey("PHONE", user.phone, auditHash);
      await audit(req as AuthedRequest, "NO4P_OTP_SENT", entity, null, {
        destinationType: "PHONE",
        destination: user.phone,
        codeHash: auditHash,
        codeMasked: maskOtp(code),
        expiresAt: expiresAt.toISOString(),
        usedFor: "USER_2FA_ENABLE",
        provider: (smsResult as any)?.provider ?? null,
        userRole: (user as any)?.role ?? null,
        userName: (user as any)?.name ?? null,
        policyCompliant: true,
      });
    } catch {
      // swallow
    }

    await audit(req as AuthedRequest, "USER_2FA_SMS_SENT", `user:${user.id}`);
    sendSuccess(res, { phoneMasked: maskPhone(user.phone) }, "SMS code sent successfully");
  } catch (error: any) {
    console.error('account.2fa.sms.send failed', error);
    sendError(res, 500, "Failed to send SMS code");
  }
};

function maskPhone(p: string | null): string {
  if (!p) return "•••••••••";
  const tail = p.slice(-3);
  return `••••••${tail}`;
}

router.post("/2fa/sms/send", sensitive as unknown as RequestHandler, sendSms2FA as unknown as RequestHandler);

/** 2FA: SMS Verify - Verify OTP code and enable SMS 2FA */
const verifySms2FA: RequestHandler = async (req, res) => {
  try {
    const validationResult = smsVerifySchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }

    const { code } = validationResult.data;
    const userId = getUserId(req as AuthedRequest);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    if (!user.phone) {
      return sendError(res, 400, "Phone number is required");
    }

    // Find active OTP
    const otp = await prisma.phoneOtp.findFirst({
      where: {
        userId: user.id,
        phone: user.phone,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { id: "desc" },
    });

    if (!otp) {
      return sendError(res, 400, "No active code found. Please request a new one.");
    }

    // Verify code
    const isValid = await verifyCode(otp.codeHash, code);
    if (!isValid) {
      try {
        const auditHash = hashOtpCode(code);
        const entity = otpEntityKey("PHONE", user.phone, auditHash);
        await audit(req as AuthedRequest, "NO4P_OTP_VERIFY_FAILED", entity, null, {
          destinationType: "PHONE",
          destination: user.phone,
          codeHash: auditHash,
          usedFor: "USER_2FA_ENABLE",
          reason: "invalid",
          userRole: (user as any)?.role ?? null,
          userName: (user as any)?.name ?? null,
        });
      } catch {
        // swallow
      }
      return sendError(res, 400, "Invalid code");
    }

    // Mark OTP as used and enable SMS 2FA
    await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.phoneOtp.update({
        where: { id: otp.id },
        data: { usedAt: new Date() },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: true,
          twoFactorMethod: "SMS",
        },
      });
    });

    try {
      const auditHash = hashOtpCode(code);
      const entity = otpEntityKey("PHONE", user.phone, auditHash);
      await audit(req as AuthedRequest, "NO4P_OTP_USED", entity, null, {
        destinationType: "PHONE",
        destination: user.phone,
        codeHash: auditHash,
        usedAt: new Date().toISOString(),
        usedFor: "USER_2FA_ENABLE",
        policyCompliant: true,
        userRole: (user as any)?.role ?? null,
        userName: (user as any)?.name ?? null,
      });
    } catch {
      // swallow
    }

    await audit(req as AuthedRequest, "USER_2FA_ENABLED", `user:${user.id}`, null, { method: "SMS" });
    sendSuccess(res, null, "SMS 2FA enabled successfully");
  } catch (error: any) {
    console.error('account.2fa.sms.verify failed', error);
    sendError(res, 500, "Failed to verify SMS code");
  }
};

router.post("/2fa/sms/verify", sensitive as unknown as RequestHandler, verifySms2FA as unknown as RequestHandler);

/** 2FA: SMS Disable - Disable SMS 2FA */
const disableSms2FA: RequestHandler = async (req, res) => {
  try {
    const validationResult = smsVerifySchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }

    const { code } = validationResult.data;
    const userId = getUserId(req as AuthedRequest);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return sendError(res, 404, "User not found");
    }

    if (!user.twoFactorEnabled || user.twoFactorMethod !== "SMS") {
      return sendError(res, 400, "SMS 2FA is not enabled");
    }

    if (!user.phone) {
      return sendError(res, 400, "Phone number not found");
    }

    // Find active OTP for verification
    const otp = await prisma.phoneOtp.findFirst({
      where: {
        userId: user.id,
        phone: user.phone,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { id: "desc" },
    });

    if (!otp) {
      // If no active OTP, send a new one
      const newCode = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = await hashCode(newCode);
      const auditHash = hashOtpCode(newCode);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.phoneOtp.create({
        data: {
          userId: user.id,
          phone: user.phone,
          codeHash,
          expiresAt,
        },
      });

      const smsResult = await sendSms(user.phone, `NoLSAF 2FA disable verification code: ${newCode}`);

      try {
        const entity = otpEntityKey("PHONE", user.phone, auditHash);
        await audit(req as AuthedRequest, "NO4P_OTP_SENT", entity, null, {
          destinationType: "PHONE",
          destination: user.phone,
          codeHash: auditHash,
          codeMasked: maskOtp(newCode),
          expiresAt: expiresAt.toISOString(),
          usedFor: "USER_2FA_DISABLE",
          provider: (smsResult as any)?.provider ?? null,
          userRole: (user as any)?.role ?? null,
          userName: (user as any)?.name ?? null,
          policyCompliant: true,
        });
      } catch {
        // swallow
      }

      return sendError(res, 400, "A new verification code has been sent to your phone. Please use it to disable 2FA.");
    }

    // Verify code
    const isValid = await verifyCode(otp.codeHash, code);
    if (!isValid) {
      try {
        const auditHash = hashOtpCode(code);
        const entity = otpEntityKey("PHONE", user.phone, auditHash);
        await audit(req as AuthedRequest, "NO4P_OTP_VERIFY_FAILED", entity, null, {
          destinationType: "PHONE",
          destination: user.phone,
          codeHash: auditHash,
          usedFor: "USER_2FA_DISABLE",
          reason: "invalid",
          userRole: (user as any)?.role ?? null,
          userName: (user as any)?.name ?? null,
        });
      } catch {
        // swallow
      }
      return sendError(res, 400, "Invalid code");
    }

    // Mark OTP as used and disable SMS 2FA
    await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.phoneOtp.update({
        where: { id: otp.id },
        data: { usedAt: new Date() },
      });

      await tx.user.update({
        where: { id: user.id },
        data: {
          twoFactorEnabled: false,
          twoFactorMethod: null,
        },
      });
    });

    try {
      const auditHash = hashOtpCode(code);
      const entity = otpEntityKey("PHONE", user.phone, auditHash);
      await audit(req as AuthedRequest, "NO4P_OTP_USED", entity, null, {
        destinationType: "PHONE",
        destination: user.phone,
        codeHash: auditHash,
        usedAt: new Date().toISOString(),
        usedFor: "USER_2FA_DISABLE",
        policyCompliant: true,
        userRole: (user as any)?.role ?? null,
        userName: (user as any)?.name ?? null,
      });
    } catch {
      // swallow
    }

    await audit(req as AuthedRequest, "USER_2FA_DISABLED", `user:${user.id}`, null, { method: "SMS" });
    sendSuccess(res, null, "SMS 2FA disabled successfully");
  } catch (error: any) {
    console.error('account.2fa.sms.disable failed', error);
    sendError(res, 500, "Failed to disable SMS 2FA");
  }
};

router.post("/2fa/sms/disable", sensitive as unknown as RequestHandler, disableSms2FA as unknown as RequestHandler);

/** DELETE /account - delete or soft-delete the current user account */
const deleteAccount: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);

    // ── 1. Block deletion if driver has a live trip ──────────────────────
    try {
      const liveCount: number = await (prisma as any).transportBooking.count({
        where: { driverId: userId, status: 'IN_PROGRESS' },
      });
      if (liveCount > 0) {
        return res.status(409).json({
          error: "You have an active trip in progress. Complete it before deleting your account.",
          code: "HAS_ACTIVE_TRIPS",
          count: liveCount,
        });
      }
    } catch { /* transportBooking model may not be present — skipped */ }

    // ── 2. Auto-unassign CONFIRMED trips → return them to PENDING pool ───
    const unassignedTripIds: number[] = [];
    try {
      const confirmedTrips: { id: number }[] = await (prisma as any).transportBooking.findMany({
        where: { driverId: userId, status: { in: ['CONFIRMED', 'ACCEPTED'] } },
        select: { id: true },
      });
      if (confirmedTrips.length > 0) {
        await (prisma as any).transportBooking.updateMany({
          where: { id: { in: confirmedTrips.map((t: any) => t.id) } },
          data: {
            driverId: null,
            status: 'PENDING',
            notes: `[DRIVER_DELETED] Driver account deleted on ${new Date().toISOString().slice(0, 10)}. Trip returned to pool for reassignment.`,
          },
        });
        unassignedTripIds.push(...confirmedTrips.map((t: any) => t.id));
      }
    } catch { /* best-effort */ }

    // ── 3. Revoke active sessions ────────────────────────────────────────
    try {
      await prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await invalidateAuthSessionCacheForUser(userId).catch(() => {});
    } catch { /* best-effort */ }

    // ── 4. Capture state for audit / notification ────────────────────────
    let before: any = null;
    try { before = await prisma.user.findUnique({ where: { id: userId } }); } catch {}
    const driverName: string = before?.name ?? 'Deleted Driver';

    // ── 5. Soft-delete with PII anonymisation ────────────────────────────
    // deletedAt is part of the canonical Prisma schema. Do not infer schema
    // support from the private delegate _meta property: it is not guaranteed
    // at runtime and previously made this endpoint fall back to a hard delete.
    await prisma.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        name: 'Deleted Driver',
        email: `deleted_${userId}_${Date.now()}@nolsaf.invalid`,
        phone: null,
      },
    });

    // ── 6. Alert admins in real-time if any trips returned to pool ───────
    try {
      const io = (req.app as any)?.get?.('io');
      if (io && unassignedTripIds.length > 0) {
        io.to('admin:all').emit('driver:account:deleted', {
          driverId: userId,
          driverName,
          unassignedTripIds,
          at: new Date().toISOString(),
        });
      }
    } catch { /* best-effort */ }

    // ── 7. Audit trail ───────────────────────────────────────────────────
    await audit(req as AuthedRequest, 'USER_ACCOUNT_DELETE', `user:${userId}`, before, { unassignedTripIds });
    sendSuccess(res, null, "Account deleted successfully");
  } catch (error: any) {
    console.error('account.delete failed', error);
    sendError(res, 500, "Failed to delete account");
  }
};
router.delete("/", sensitive as unknown as RequestHandler, deleteAccount as unknown as RequestHandler);

const DEFAULT_NOTIFICATION_PREFS = {
  bookings: true,
  promotions: true,
  referrals: true,
};

const notificationPrefsSchema = z.object({
  bookings: z.boolean().optional(),
  promotions: z.boolean().optional(),
  referrals: z.boolean().optional(),
}).strict();

/** GET /account/notification-preferences */
const getNotificationPreferences: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } as any });
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, ...((user as any)?.notificationPrefs as object | null) };
    sendSuccess(res, { preferences: prefs });
  } catch (error: any) {
    console.error('account.notificationPreferences.get failed', error);
    sendError(res, 500, "Failed to load notification preferences");
  }
};
router.get("/notification-preferences", getNotificationPreferences as unknown as RequestHandler);

/** PUT /account/notification-preferences */
const updateNotificationPreferences: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const parsed = notificationPrefsSchema.safeParse(req.body);
    if (!parsed.success) return sendError(res, 400, "Invalid notification preferences", parsed.error.flatten());

    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } as any });
    const current = { ...DEFAULT_NOTIFICATION_PREFS, ...((existing as any)?.notificationPrefs as object | null) };
    const next = { ...current, ...parsed.data };

    await prisma.user.update({ where: { id: userId }, data: { notificationPrefs: next } as any });
    sendSuccess(res, { preferences: next }, "Notification preferences updated");
  } catch (error: any) {
    console.error('account.notificationPreferences.update failed', error);
    sendError(res, 500, "Failed to update notification preferences");
  }
};
router.put("/notification-preferences", updateNotificationPreferences as unknown as RequestHandler);

/** GET /account/sessions - list user sessions with pagination */
const listSessions: RequestHandler = async (req, res) => {
  try {
    // Validate and parse query params
    const validationResult = listSessionsSchema.safeParse(req.query);
    const page = validationResult.success ? (validationResult.data.page || 1) : 1;
    const pageSize = validationResult.success ? (validationResult.data.pageSize || DEFAULT_SESSIONS_PAGE_SIZE) : DEFAULT_SESSIONS_PAGE_SIZE;
    
    const userId = getUserId(req as AuthedRequest);
    const skip = (page - 1) * pageSize;

    const [sessions, total] = await Promise.all([
      prisma.session.findMany({ 
        where: { userId, revokedAt: null }, 
        orderBy: { lastSeenAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.session.count({ 
        where: { userId, revokedAt: null } 
      }),
    ]);

    sendSuccess(res, {
      sessions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      }
    });
  } catch (error: any) {
    console.error('account.sessions.list failed', error);
    sendError(res, 500, "Failed to fetch sessions");
  }
};
router.get("/sessions", listSessions as unknown as RequestHandler);

/** POST /account/sessions/revoke - revoke a specific session */
const revokeSession: RequestHandler = async (req, res) => {
  try {
    // Validate input
    const validationResult = revokeSessionSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid input", validationResult.error.issues);
    }

    const { sessionId } = validationResult.data;
    const userId = getUserId(req as AuthedRequest);

    await prisma.session.updateMany({ 
      where: { id: sessionId, userId }, 
      data: { revokedAt: new Date() } 
    });
    await invalidateAuthSessionCacheForUser(userId).catch(() => {});
    
    await audit(req as AuthedRequest, "USER_SESSION_REVOKE", `session:${sessionId}`);
    sendSuccess(res, null, "Session revoked successfully");
  } catch (error: any) {
    console.error('account.sessions.revoke failed', error);
    sendError(res, 500, "Failed to revoke session");
  }
};
router.post("/sessions/revoke", sensitive as unknown as RequestHandler, revokeSession as unknown as RequestHandler);

/** POST /account/sessions/revoke-others - revoke all other sessions */
const revokeOtherSessions: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const currentId = (req as any).sessionId as string | undefined;
    
    await prisma.session.updateMany({
      where: {
        userId,
        ...(currentId ? { NOT: { id: currentId } } : {}),
        revokedAt: null
      },
      data: { revokedAt: new Date() },
    });

    // Exact server-side session binding makes the row revocations sufficient.
    // Keep this device's existing session instead of minting a duplicate.
    await invalidateAuthSessionCacheForUser(userId).catch(() => {});

    await audit(req as AuthedRequest, "USER_SESSION_REVOKE_OTHERS", `user:${userId}`);
    sendSuccess(res, null, "Other sessions revoked successfully");
  } catch (error: any) {
    console.error('account.sessions.revoke-others failed', error);
    sendError(res, 500, "Failed to revoke other sessions");
  }
};
router.post("/sessions/revoke-others", sensitive as unknown as RequestHandler, revokeOtherSessions as unknown as RequestHandler);

/** GET /account/payment-methods - returns user's payout details and recent payment methods */
const getPaymentMethods: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    
    // Get payout data and decrypt sensitive fields
    let payout: any = null;
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { payout: true },
      });
      if (user?.payout && typeof user.payout === 'object') {
        payout = { ...user.payout };
        // Decrypt sensitive fields
        if (payout.bankAccountNumber && typeof payout.bankAccountNumber === 'string') {
          try {
            payout.bankAccountNumber = decrypt(payout.bankAccountNumber);
          } catch (e) {
            // If decryption fails, might be plain text (migration scenario)
            // Keep as-is
          }
        }
        if (payout.mobileMoneyNumber && typeof payout.mobileMoneyNumber === 'string') {
          try {
            payout.mobileMoneyNumber = decrypt(payout.mobileMoneyNumber);
          } catch (e) {
            // If decryption fails, might be plain text (migration scenario)
            // Keep as-is
          }
        }
      } else {
        payout = user?.payout || null;
      }
    } catch (e) {
      // Best-effort
    }

    // Collect recent payment methods from invoices
    const methods: any[] = [];
    try {
      const invoices = await prisma.invoice.findMany({
        where: { paidBy: userId, status: 'PAID' },
        orderBy: { paidAt: 'desc' },
        take: PAYMENT_METHODS_LIMIT,
        select: { paymentMethod: true, paymentRef: true, paidAt: true } as any,
      });
      
      const seen = new Set<string>();
      for (const invoice of invoices) {
        const key = String(invoice.paymentMethod ?? invoice.paymentRef ?? '');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        methods.push({ 
          method: invoice.paymentMethod ?? null, 
          ref: invoice.paymentRef ?? null, 
          paidAt: invoice.paidAt ?? null 
        });
      }
    } catch (e) {
      // Best-effort
    }

    sendSuccess(res, { payout, methods });
  } catch (error: any) {
    console.error('account.payment-methods.get failed', error);
    sendError(res, 500, "Failed to fetch payment methods");
  }
};
router.get('/payment-methods', getPaymentMethods as unknown as RequestHandler);

/** GET /account/audit-history - Get audit logs for current user's profile/payout changes */
const getAuditHistory: RequestHandler = async (req, res) => {
  try {
    const userId = getUserId(req as AuthedRequest);
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const pageSize = Math.min(50, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10)));
    const skip = (page - 1) * pageSize;
    
    // Fetch audit logs related to this user's profile/payout changes
    let logs: any[] = [];
    let total = 0;
    
    try {
      // Define all account-related actions
      const accountActions = [
        'USER_PROFILE_UPDATE',
        'USER_PAYOUT_UPDATE',
        'USER_PASSWORD_CHANGE',
        'USER_LOGIN',
        'USER_LOGOUT',
        'USER_SESSION_REVOKE',
        'USER_SESSION_REVOKE_OTHERS',
      ];
      
      [logs, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: {
            OR: [
              { actorId: userId, action: { in: accountActions } },
              { entity: `user:${userId}`, action: { in: accountActions } },
            ],
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
          select: {
            id: true,
            action: true,
            entity: true,
            beforeJson: true,
            afterJson: true,
            createdAt: true,
            ip: true,
          },
        }),
        prisma.auditLog.count({
          where: {
            OR: [
              { actorId: userId, action: { in: accountActions } },
              { entity: `user:${userId}`, action: { in: accountActions } },
            ],
          },
        }),
      ]);
    } catch (dbError: any) {
      console.error('Database error fetching audit logs:', dbError);
      // Return empty result instead of failing
      logs = [];
      total = 0;
    }
    
    // Calculate impact score for each change
    const logsWithImpact = logs.map((log: any) => {
      try {
        // Handle BigInt id conversion
        const logId = typeof log.id === 'bigint' ? Number(log.id) : Number(log.id);
        
        // Safely parse JSON fields (they might already be objects or JSON strings)
        let before: any = {};
        let after: any = {};
        try {
          if (log.beforeJson) {
            before = typeof log.beforeJson === 'string' ? JSON.parse(log.beforeJson) : log.beforeJson;
          }
          if (log.afterJson) {
            after = typeof log.afterJson === 'string' ? JSON.parse(log.afterJson) : log.afterJson;
          }
        } catch (e) {
          // If parsing fails, use empty objects
          console.warn('Failed to parse audit log JSON fields', e);
        }
        
        let impactScore = 0;
        const changedFields: string[] = [];
        
        // Handle account actions that don't have before/after JSON
        const actionImpactScores: Record<string, number> = {
          'USER_PASSWORD_CHANGE': 15, // High impact - security critical
          'USER_LOGIN': 2, // Low impact - routine
          'USER_LOGOUT': 1, // Low impact - routine
          'USER_SESSION_REVOKE': 5, // Medium impact - security action
          'USER_SESSION_REVOKE_OTHERS': 8, // Medium-high impact - security action
          'USER_PROFILE_UPDATE': 3, // Low-medium impact
          'USER_PAYOUT_UPDATE': 5, // Medium impact
        };
        
        // If this is an account action without before/after data, use predefined impact
        if (actionImpactScores[log.action]) {
          impactScore = actionImpactScores[log.action];
        } else {
          // Count changed fields for profile/payout updates
          const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
          for (const key of allKeys) {
            const beforeVal = before?.[key];
            const afterVal = after?.[key];
            try {
              if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
                changedFields.push(key);
                // Sensitive fields have higher impact
                if (key === 'bankAccountNumber' || key === 'mobileMoneyNumber') {
                  impactScore += 10;
                } else if (key === 'bankName' || key === 'bankAccountName' || key === 'mobileMoneyProvider') {
                  impactScore += 5;
                } else {
                  impactScore += 1;
                }
              }
            } catch (e) {
              // Skip fields that can't be compared
              console.warn(`Failed to compare field ${key}`, e);
            }
          }
        }
        
        return {
          id: logId,
          action: log.action || 'UNKNOWN',
          entity: log.entity || 'UNKNOWN',
          changedFields,
          impactScore,
          impactLevel: impactScore >= 10 ? 'high' : impactScore >= 5 ? 'medium' : 'low',
          before: before || null,
          after: after || null,
          createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : (log.createdAt ? String(log.createdAt) : new Date().toISOString()),
          ip: log.ip || null,
        };
      } catch (e: any) {
        console.error('Error processing audit log entry', { error: e?.message, logId: log.id });
        // Return a safe fallback entry
        return {
          id: typeof log.id === 'bigint' ? Number(log.id) : Number(log.id),
          action: log.action || 'UNKNOWN',
          entity: log.entity || 'UNKNOWN',
          changedFields: [],
          impactScore: 0,
          impactLevel: 'low',
          before: null,
          after: null,
          createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : new Date().toISOString(),
          ip: log.ip || null,
        };
      }
    });
    
    sendSuccess(res, {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items: logsWithImpact,
    });
  } catch (error: any) {
    console.error('account.audit-history.get failed', {
      error: error?.message || String(error),
      stack: error?.stack,
      code: error?.code,
    });
    sendError(res, 500, "Failed to fetch audit history", { 
      message: error?.message || String(error) 
    });
  }
};
router.get("/audit-history", getAuditHistory as unknown as RequestHandler);

export default router;

// apps/api/src/routes/admin.2fa.ts
import { Router, RequestHandler, Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, AuthedRequest } from "../middleware/auth.js";
import { generate6, hashCode } from "../lib/otp.js";
import { audit } from "../lib/audit.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { sendMail, SECURITY_EMAIL_FROM } from "../lib/mailer.js";
import { sendSms } from "../lib/sms.js";
import { setFinanceGrant } from "../lib/financeGrantStore.js";
import { requireNrmsFinanceRole } from "../middleware/financeGrant.js";

// ============================================================
// Constants
// ============================================================
const OTP_COOLDOWN_MS = 30 * 1000; // 30 seconds between requests
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const FINANCE_GRANT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ACTIVE_OTPS = 3; // Maximum active OTPs per admin per purpose
const MAX_VERIFICATION_ATTEMPTS = 5; // Max failed verification attempts before lockout
const VERIFICATION_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes lockout after max attempts
const OTP_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Cleanup expired OTPs every hour

// ============================================================
// OTP Purpose Enum
// ============================================================
export const OTP_PURPOSE = {
  FINANCE_VIEW: "FINANCE_VIEW",
  // Add more purposes as needed
} as const;

export type OtpPurpose = typeof OTP_PURPOSE[keyof typeof OTP_PURPOSE];

// ============================================================
// TypeScript Interfaces
// ============================================================
interface OtpVerificationAttempt {
  count: number;
  lockedUntil: number | null;
  lastAttempt: number;
}

// ============================================================
// Brute Force Protection (In-Memory) Itakuja kuwekwa wakati wa deployments
// ============================================================
const verificationAttempts = new Map<string, OtpVerificationAttempt>();

// Cleanup old verification attempts every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, attempt] of verificationAttempts.entries()) {
    if (attempt.lockedUntil && attempt.lockedUntil < now) {
      verificationAttempts.delete(key);
    } else if (!attempt.lockedUntil && now - attempt.lastAttempt > VERIFICATION_LOCKOUT_MS) {
      verificationAttempts.delete(key);
    }
  }
}, 15 * 60 * 1000);

function getVerificationKey(adminId: number, purpose: string): string {
  return `otp-verify:${adminId}:${purpose}`;
}

function isVerificationLocked(adminId: number, purpose: string): { locked: boolean; lockedUntil: number | null } {
  const key = getVerificationKey(adminId, purpose);
  const attempt = verificationAttempts.get(key);
  if (!attempt) {
    return { locked: false, lockedUntil: null };
  }

  const now = Date.now();
  if (attempt.lockedUntil && attempt.lockedUntil > now) {
    return { locked: true, lockedUntil: attempt.lockedUntil };
  }

  if (attempt.lockedUntil && attempt.lockedUntil <= now) {
    verificationAttempts.delete(key);
    return { locked: false, lockedUntil: null };
  }

  return { locked: false, lockedUntil: null };
}

function recordFailedVerification(adminId: number, purpose: string): void {
  const key = getVerificationKey(adminId, purpose);
  const now = Date.now();
  const attempt = verificationAttempts.get(key) || { count: 0, lockedUntil: null, lastAttempt: now };
  
  attempt.count += 1;
  attempt.lastAttempt = now;

  if (attempt.count >= MAX_VERIFICATION_ATTEMPTS) {
    attempt.lockedUntil = now + VERIFICATION_LOCKOUT_MS;
    console.warn(`[SECURITY] OTP verification locked for admin ${adminId}, purpose ${purpose} after ${attempt.count} failed attempts`);
  }

  verificationAttempts.set(key, attempt);
}

function clearVerificationAttempts(adminId: number, purpose: string): void {
  const key = getVerificationKey(adminId, purpose);
  verificationAttempts.delete(key);
}

// ============================================================
// Expired OTP Cleanup Job
// ============================================================
async function cleanupExpiredOtps(): Promise<void> {
  try {
    const result = await prisma.adminOtp.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { usedAt: { not: null } },
        ],
      },
    });
    if (result.count > 0) {
      console.log(`[CLEANUP] Deleted ${result.count} expired/used OTPs`);
    }
  } catch (error) {
    console.error("[CLEANUP] Failed to cleanup expired OTPs:", error);
  }
}

// Run cleanup on startup and then every hour
cleanupExpiredOtps();
setInterval(cleanupExpiredOtps, OTP_CLEANUP_INTERVAL_MS);

// ============================================================
// Rate Limiters
// ============================================================
const limitOtpSend = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // 10 OTP requests per admin per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many OTP requests. Please wait before requesting another code." },
  keyGenerator: (req) => {
    const adminId = (req as AuthedRequest).user?.id;
    return adminId ? `admin-otp-send:${adminId}` : req.ip || req.socket.remoteAddress || "unknown";
  },
});

const limitOtpVerify = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10, // 10 verification attempts per admin per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Please wait before trying again." },
  keyGenerator: (req) => {
    const adminId = (req as AuthedRequest).user?.id;
    return adminId ? `admin-otp-verify:${adminId}` : req.ip || req.socket.remoteAddress || "unknown";
  },
});

// ============================================================
// Zod Validation Schemas
// ============================================================
const sendOtpSchema = z.object({
  purpose: z.enum([OTP_PURPOSE.FINANCE_VIEW]).optional().default(OTP_PURPOSE.FINANCE_VIEW),
}).strict();

const verifyOtpSchema = z.object({
  code: z.string().length(6).regex(/^\d+$/, "Code must be 6 digits"),
  purpose: z.enum([OTP_PURPOSE.FINANCE_VIEW]).optional().default(OTP_PURPOSE.FINANCE_VIEW),
}).strict();

// ============================================================
// Helper Functions
// ============================================================
function sendError(res: Response, status: number, message: string, details?: any): void {
  res.status(status).json({
    error: message,
    ...(details && { details }),
  });
}

function sendSuccess(res: Response, data?: any, message?: string): void {
  res.json({
    ok: true,
    ...(message && { message }),
    ...(data && { data }),
  });
}

function getAdminId(req: AuthedRequest): number {
  return req.user!.id;
}

function maskOtp(code: string): string {
  const s = String(code || "");
  if (s.length <= 2) return "••••••";
  return `••••${s.slice(-2)}`;
}

function otpEntityKey(destinationType: "PHONE" | "EMAIL" | "INTERNAL", destination: string, codeHash: string): string {
  return `OTP:${destinationType}:${destination}:${codeHash}`;
}

// Validation middleware helper
function validate<T extends z.ZodTypeAny>(schema: T) {
  return (req: any, res: Response, next: any) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return sendError(res, 400, "Invalid request", { errors: result.error.issues });
    }
    req.validatedBody = result.data;
    next();
  };
}

// Notification fallback with proper typing
async function deliverAdminOtp(adminUser: { email: string | null; phone: string | null }, code: string): Promise<{ provider: string }> {
  const expiryMinutes = Math.ceil(OTP_EXPIRY_MS / 60_000);
  if (adminUser.email) {
    await sendMail(
      adminUser.email,
      "NoLSAF finance verification code",
      `<p>Your NoLSAF finance verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in ${expiryMinutes} minutes. Do not share it.</p>`,
      undefined,
      { bypassEligibilityCheck: true, from: SECURITY_EMAIL_FROM, replyTo: "support@nolsaf.com" },
    );
    return { provider: "email" };
  }
  if (adminUser.phone) {
    const result = await sendSms(adminUser.phone, `Your NoLSAF finance verification code is ${code}. It expires in ${expiryMinutes} minutes. Do not share it.`, { bypassEligibilityCheck: true });
    if (!result.success) throw new Error(result.error || "SMS delivery failed");
    return { provider: result.provider || "sms" };
  }
  if (process.env.NODE_ENV !== "production") {
    console.warn(`[OTP:DEV] No admin email or phone configured; finance code is ${code}`);
    return { provider: "console" };
  }
  throw new Error("Admin has no email or phone configured for OTP delivery");
}

// ============================================================
// Router Setup
// ============================================================
export const router = Router();
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler);
const requireFinanceOperator = requireNrmsFinanceRole("OPERATOR") as RequestHandler;

// ============================================================
// POST /admin/2fa/otp/send
// ============================================================
router.post("/otp/send", requireFinanceOperator, limitOtpSend, validate(sendOtpSchema), async (req: any, res) => {
  try {
    const { purpose } = req.validatedBody;
    const adminId = getAdminId(req as AuthedRequest);

    // Check for recent OTP request (cooldown)
    const recent = await prisma.adminOtp.findFirst({
      where: {
        adminId,
        purpose,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
      orderBy: { id: "desc" },
    });

    if (recent && Date.now() - recent.createdAt.getTime() < OTP_COOLDOWN_MS) {
      const waitTime = Math.ceil((OTP_COOLDOWN_MS - (Date.now() - recent.createdAt.getTime())) / 1000);
      return sendError(res, 429, `Please wait ${waitTime} seconds before requesting another code.`);
    }

    // Count active OTPs (proper rate limiting)
    const activeCount = await prisma.adminOtp.count({
      where: {
        adminId,
        purpose,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    });

    if (activeCount >= MAX_ACTIVE_OTPS) {
      return sendError(res, 429, `Maximum ${MAX_ACTIVE_OTPS} active OTPs allowed. Please use an existing code or wait for expiration.`);
    }

    // Generate and store OTP in transaction
    const code = generate6();
    const auditHash = hashCode(code);
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

    const adminUser = await prisma.user.findUnique({
      where: { id: adminId },
      select: { email: true, phone: true, name: true, role: true },
    });
    const destinationType = adminUser?.email ? "EMAIL" : adminUser?.phone ? "PHONE" : "INTERNAL";
    const destination = (adminUser?.email || adminUser?.phone || `admin:${adminId}`) as string;
    const entity = otpEntityKey(destinationType as any, destination, auditHash);

    await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.adminOtp.create({
        data: {
          adminId,
          purpose,
          codeHash: hashCode(code),
          expiresAt,
        },
      });

    });

    let delivery: { provider: string };
    try {
      delivery = await deliverAdminOtp(adminUser ?? { email: null, phone: null }, code);
    } catch (deliveryError: any) {
      console.error("[OTP_SEND] Delivery failed:", deliveryError);
      return sendError(res, 502, "Failed to deliver OTP. Please try again later.");
    }

    // Audit log
    await audit(req as AuthedRequest, "ADMIN_OTP_SENT", `admin:${adminId}`, null, { purpose, expiresAt });

    // Audit for Management/No4P OTP tracking.
    await audit(req as AuthedRequest, "NO4P_OTP_SENT", entity, null, {
      destinationType,
      destination,
      codeHash: auditHash,
      codeMasked: maskOtp(code),
      expiresAt: expiresAt.toISOString(),
      usedFor: `ADMIN_${purpose}`,
      provider: "internal_notification",
      userRole: adminUser?.role ?? "ADMIN",
      userName: adminUser?.name ?? null,
      policyCompliant: true,
    });

    sendSuccess(res, { expiresAt, provider: delivery.provider }, "OTP sent successfully");
  } catch (error: any) {
    console.error("[OTP_SEND] Error:", error);
    sendError(res, 500, "Failed to send OTP. Please try again later.");
  }
});

// ============================================================
// POST /admin/2fa/otp/verify
// ============================================================
router.post("/otp/verify", requireFinanceOperator, limitOtpVerify, validate(verifyOtpSchema), async (req: any, res) => {
  try {
    const { code, purpose } = req.validatedBody;
    const adminId = getAdminId(req as AuthedRequest);

    const adminUser = await prisma.user.findUnique({
      where: { id: adminId },
      select: { email: true, phone: true, name: true, role: true },
    });
    const destinationType = adminUser?.email ? "EMAIL" : adminUser?.phone ? "PHONE" : "INTERNAL";
    const destination = (adminUser?.email || adminUser?.phone || `admin:${adminId}`) as string;

    // Check for brute-force lockout
    const lockoutStatus = isVerificationLocked(adminId, purpose);
    if (lockoutStatus.locked) {
      const waitTime = Math.ceil((lockoutStatus.lockedUntil! - Date.now()) / 1000 / 60);
      return sendError(res, 429, `Too many failed attempts. Please wait ${waitTime} minutes before trying again.`);
    }

    // Find active OTP
    const otp = await prisma.adminOtp.findFirst({
      where: {
        adminId,
        purpose,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
      orderBy: { id: "desc" },
    });

    if (!otp) {
      return sendError(res, 400, "No active code found. Please request a new one.");
    }

    // Verify code
    const codeHash = hashCode(code);
    if (otp.codeHash !== codeHash) {
      recordFailedVerification(adminId, purpose);
      await audit(req as AuthedRequest, "ADMIN_OTP_VERIFY_FAILED", `admin:${adminId}`, null, { purpose });

      try {
        const entity = otpEntityKey(destinationType as any, destination, codeHash);
        await audit(req as AuthedRequest, "NO4P_OTP_VERIFY_FAILED", entity, null, {
          destinationType,
          destination,
          codeHash,
          usedFor: `ADMIN_${purpose}`,
          reason: "invalid",
          userRole: adminUser?.role ?? "ADMIN",
          userName: adminUser?.name ?? null,
        });
      } catch {
        // swallow
      }
      return sendError(res, 400, "Invalid code. Please check and try again.");
    }

    // Mark OTP as used and grant finance access
    await prisma.$transaction(async (tx: typeof prisma) => {
      await tx.adminOtp.update({
        where: { id: otp.id },
        data: { usedAt: new Date() },
      });
    });

    // Clear failed verification attempts on success
    clearVerificationAttempts(adminId, purpose);

    // Bind the grant to this authenticated JWT. The web/API stack is JWT-based
    // and does not install express-session, so req.session is not reliable.
    const financeOkUntil = Date.now() + FINANCE_GRANT_DURATION_MS;
    await setFinanceGrant(req, financeOkUntil);

    // Audit log
    await audit(req as AuthedRequest, "ADMIN_OTP_VERIFIED", `admin:${adminId}`, null, { purpose, grantedUntil: financeOkUntil });

    try {
      const entity = otpEntityKey(destinationType as any, destination, codeHash);
      await audit(req as AuthedRequest, "NO4P_OTP_USED", entity, null, {
        destinationType,
        destination,
        codeHash,
        usedAt: new Date().toISOString(),
        usedFor: `ADMIN_${purpose}`,
        policyCompliant: true,
        userRole: adminUser?.role ?? "ADMIN",
        userName: adminUser?.name ?? null,
      });
    } catch {
      // swallow
    }

    sendSuccess(res, {
      until: financeOkUntil,
      message: "OTP verified successfully. Finance access granted.",
    });
  } catch (error: any) {
    console.error("[OTP_VERIFY] Error:", error);
    sendError(res, 500, "Failed to verify OTP. Please try again later.");
  }
});

export default router;

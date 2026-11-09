import { Router, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { hashCode, verifyCode } from "../lib/crypto.js";
import { generate6 } from "../lib/otp.js";
import { otpAuditDestinationFields, otpAuditEntity } from "../lib/otpAudit.js";
import { audit } from "../lib/audit.js";
import { sendSms } from "../lib/sms.js";
import { normalizePhoneForAuth } from "../lib/authDestination.js";
import { OTP_MAX_ATTEMPTS, registerOtpAttempt } from "../lib/otpAttempts.js";
import { limitOwnerPhoneOtpSendPerPhone, limitOwnerPhoneOtpSendPerUser, limitOwnerPhoneOtpVerify } from "../middleware/rateLimit.js";

export const router = Router();
router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler);

const gen6 = generate6;
const OTP_TTL_MS = 1000 * 60 * 10; // 10 minutes

/** Start phone verification (sends OTP) */
router.post("/start", limitOwnerPhoneOtpSendPerUser, limitOwnerPhoneOtpSendPerPhone, (async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.user!.id } });
  const rawPhone = (req.body?.phone || me?.phone)?.toString();
  if (!rawPhone) return res.status(400).json({ error: "phone required" });
  // Text only a well-formed number, in the same canonical form sign-in uses.
  const phone = normalizePhoneForAuth(rawPhone);
  if (!/^\+\d{9,15}$/.test(phone)) return res.status(400).json({ error: "Enter a valid phone number" });

  const code = gen6();
  const codeHash = await hashCode(code);
  const auditCode = code;
  const expires = new Date(Date.now() + OTP_TTL_MS);

  await prisma.phoneOtp.create({ data: { userId: me!.id, phone, codeHash, expiresAt: expires } });
  const smsResult = await sendSms(phone, `NoLSAF verification code: ${code}`);

  try {
    const entity = otpAuditEntity("PHONE", phone, auditCode);
    await audit(req as any, "NO4P_OTP_SENT", entity, null, {
      ...otpAuditDestinationFields("PHONE", phone),
      expiresAt: expires.toISOString(),
      usedFor: "OWNER_PHONE_VERIFY",
      provider: (smsResult as any)?.provider ?? null,
      userRole: (me as any)?.role ?? "OWNER",
      userName: (me as any)?.name ?? null,
      policyCompliant: true,
    });
  } catch {
    // swallow
  }

  res.json({ ok: true, phoneMasked: maskPhone(phone) });
}) as RequestHandler);

function maskPhone(p: string) {
  const tail = p.slice(-3);
  return `••••••${tail}`;
}

/** Verify OTP */
router.post("/verify", limitOwnerPhoneOtpVerify, (async (req: AuthedRequest, res) => {
  const { code } = req.body ?? {};
  if (!code) return res.status(400).json({ error: "code required" });

  const rec = await prisma.phoneOtp.findFirst({
    where: { userId: req.user!.id, usedAt: null },
    orderBy: { id: "desc" },
  });
  if (!rec || rec.expiresAt < new Date()) return res.status(400).json({ error: "Invalid/expired code" });

  // Count the guess before comparing; past the cap the code is spent.
  const attempt = await registerOtpAttempt(`owner-phone:${rec.id}`, Math.ceil((rec.expiresAt.getTime() - Date.now()) / 1000));
  if (attempt > OTP_MAX_ATTEMPTS) {
    await prisma.phoneOtp.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
    return res.status(400).json({ error: "Too many incorrect codes. Request a new code.", code: "OTP_ATTEMPTS_EXCEEDED" });
  }

  const ok = await verifyCode(rec.codeHash, String(code));
  if (!ok) {
    try {
      const entity = otpAuditEntity("PHONE", rec.phone, String(code));
      await audit(req as any, "NO4P_OTP_VERIFY_FAILED", entity, null, {
        ...otpAuditDestinationFields("PHONE", rec.phone),
        usedFor: "OWNER_PHONE_VERIFY",
        reason: "invalid",
      });
    } catch {
      // swallow
    }
    return res.status(400).json({ error: "Invalid code" });
  }

  await prisma.$transaction([
    prisma.phoneOtp.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
    prisma.user.update({ 
      where: { id: req.user!.id }, 
      data: { 
        phone: rec.phone,
        phoneVerifiedAt: new Date() 
      } as any 
    }),
  ]);

  try {
    const entity = otpAuditEntity("PHONE", rec.phone, String(code));
    await audit(req as any, "NO4P_OTP_USED", entity, null, {
      ...otpAuditDestinationFields("PHONE", rec.phone),
      usedAt: new Date().toISOString(),
      usedFor: "OWNER_PHONE_VERIFY",
      policyCompliant: true,
    });
  } catch {
    // swallow
  }

  res.json({ ok: true });
}) as RequestHandler);
/** GET /owner/phone/verify - get current status */
router.get("/", (async (req: AuthedRequest, res) => {
  const me = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!me) return res.status(404).json({ error: "User not found" });

  const rec = await prisma.phoneOtp.findFirst({
    where: { userId: me.id, usedAt: null },
    orderBy: { id: "desc" },
  });

  res.json({ ok: true, phoneMasked: maskPhone(me.phone), otpSent: !!rec });
}) as RequestHandler);
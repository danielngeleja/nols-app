/**
 * The one place every successful sign-in goes through (password, one-time
 * code, passkey, authenticator code, admin MFA). It records the USER_LOGIN
 * audit row with the device tag and, for a device this account has not used
 * before (lib/loginDevice.ts), alerts the person by email and in the app.
 *
 * Alert delivery never blocks or fails the sign-in.
 */
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { audit } from "./audit.js";
import { getLoginAlertEmail } from "./authEmailTemplates.js";
import { sendMail, SECURITY_EMAIL_FROM } from "./mailer.js";
import { notifyOwner, notifyUser } from "./notifications.js";
import {
  describeDevice,
  ensureLoginDeviceCookie,
  loginDeviceTag,
  shouldSendNewSignInAlert,
  signSignOutDeviceToken,
} from "./loginDevice.js";

type SignedInUser = { id: number; role?: string | null; email?: string | null };

function webOrigin(): string {
  return (process.env.APP_URL || process.env.WEB_ORIGIN || "http://localhost:3000").replace(/\/+$/, "");
}

function clientIp(req: Request): string | undefined {
  const ip = req.ip || req.socket?.remoteAddress || "";
  return ip && ip !== "unknown" ? ip : undefined;
}

function country(req: Request): string | undefined {
  const value = String(req.headers["cf-ipcountry"] || req.headers["x-country-code"] || req.headers["x-vercel-ip-country"] || "");
  return value || undefined;
}

/** Where the person reviews devices, by account type. */
function securityHref(role: string): string {
  if (role === "OWNER") return "/owner/settings/login-history";
  if (role === "AGENT") return "/account/agent/security/login-history";
  if (role === "DRIVER") return "/driver/security/login-history";
  if (role === "ADMIN") return "/admin/security";
  return "/account/security/login-history";
}

export async function recordSuccessfulSignIn(
  req: Request,
  res: Response,
  user: SignedInUser,
  options: { method: string; token: string; mfa?: boolean },
): Promise<void> {
  const role = String(user.role || "").toUpperCase();
  const userAgent = String(req.headers["user-agent"] || "");

  let deviceTag: string | null = null;
  try { deviceTag = loginDeviceTag(ensureLoginDeviceCookie(req, res)); } catch { deviceTag = null; }

  // Decide before this sign-in is recorded, so it never counts as its own history.
  const alert = await shouldSendNewSignInAlert({ userId: user.id, deviceTag, userAgent }).catch(() => false);

  try {
    (req as any).user = user;
    await audit(req, "USER_LOGIN", `user:${user.id}`, null, {
      role: user.role,
      email: user.email,
      loginMethod: options.method,
      event: "login",
      success: true,
      ...(options.mfa ? { mfa: true } : {}),
      ...(deviceTag ? { deviceTag } : {}),
    });
  } catch {
    // Audit delivery never turns a verified sign-in into an outage.
  }

  if (!alert) return;
  void deliverNewSignInAlert(req, user, role, deviceTag, options.token, userAgent).catch((e) => {
    console.warn("[LOGIN] New sign-in alert failed:", e?.message || e);
  });
}

async function deliverNewSignInAlert(
  req: Request,
  user: SignedInUser,
  role: string,
  deviceTag: string | null,
  token: string,
  userAgent: string,
): Promise<void> {
  const device = describeDevice(userAgent);
  const sessionId = String((jwt.decode(token) as jwt.JwtPayload | null)?.sid || "");
  const origin = webOrigin();
  const signOutUrl = sessionId
    ? `${origin}/account/sign-out-device?t=${encodeURIComponent(signSignOutDeviceToken({ userId: user.id, sessionId, deviceTag }))}`
    : undefined;
  const href = securityHref(role);

  // In-app first: it still reaches the person if someone else controls the inbox.
  const data = { device, href, at: new Date().toISOString() };
  if (role === "OWNER") await notifyOwner(user.id, "security_new_sign_in", data);
  else if (role === "AGENT") await notifyUser(user.id, "agent_new_sign_in", data);
  else await notifyUser(user.id, "security_new_sign_in", data);

  if (!user.email) return;
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, fullName: true } }).catch(() => null);
  const { subject, html } = getLoginAlertEmail({
    name: String(profile?.fullName || profile?.name || "").trim() || undefined,
    loginAt: new Date(),
    ipAddress: clientIp(req),
    device,
    country: country(req),
    resetPasswordUrl: `${origin}/account/forgot-password`,
    signOutDeviceUrl: signOutUrl,
    reviewDevicesUrl: `${origin}${href}`,
  });
  await sendMail(user.email, subject, html, undefined, { from: SECURITY_EMAIL_FROM, replyTo: "support@nolsaf.com" });
}

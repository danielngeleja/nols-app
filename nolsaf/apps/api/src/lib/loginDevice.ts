/**
 * New sign-in alert policy.
 *
 * An alert is sent only when a sign-in comes from a device this account has not
 * used before. "Known" must survive deploys and work across every API instance,
 * so it is never kept in memory:
 *
 *  1. Browser device cookie: a random, signed device id kept for 400 days. A
 *     sign-in is known when this account has signed in successfully before
 *     carrying the same device tag (recorded on the USER_LOGIN audit row).
 *  2. Same exact user agent as an earlier successful sign-in to this account in
 *     the last 90 days. Covers clients that do not keep cookies (native apps).
 *  3. The account's first ever successful sign-in never alerts (it is the
 *     person who just registered or was invited).
 *  4. A device the person removed from "Recognised devices" is a stranger
 *     again: history before that removal no longer counts.
 *
 * IP addresses are deliberately not part of the decision: mobile networks and
 * home routers change them constantly and that produced alerts on every login.
 * Failed password attempts are USER_LOGIN rows too and never count.
 */
import crypto from "node:crypto";
import { prisma } from "@nolsaf/prisma";

export const LOGIN_DEVICE_COOKIE = "nolsaf_device";
export const LOGIN_DEVICE_FORGOTTEN = "LOGIN_DEVICE_FORGOTTEN";
const DEVICE_COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;
const DEVICE_TAG_LOOKBACK_DAYS = 365;
const USER_AGENT_LOOKBACK_DAYS = 90;
const HISTORY_LIMIT = 300;
const SIGN_OUT_LINK_TTL_SECONDS = 14 * 24 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

function secret(label: string): string {
  const base = process.env.JWT_SECRET
    || (process.env.NODE_ENV !== "production" ? (process.env.DEV_JWT_SECRET || "dev_jwt_secret") : "");
  return `${label}:${base}`;
}

function hmac(label: string, value: string, length = 22): string {
  return crypto.createHmac("sha256", secret(label)).update(value).digest("base64url").slice(0, length);
}

function safeEqual(a: string, b: string): boolean {
  return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  for (const part of String(cookieHeader || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return part.slice(i + 1).trim(); }
  }
  return null;
}

/** The signed device id from the request, or null when absent or forged. */
export function readLoginDeviceId(cookieHeader: string | undefined): string | null {
  const raw = readCookie(cookieHeader, LOGIN_DEVICE_COOKIE);
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  if (!id || !sig || !/^[A-Za-z0-9_-]{22}$/.test(id)) return null;
  return safeEqual(sig, hmac("login-device:v1", id)) ? id : null;
}

/** Reuse the browser's device id, or mint one; always (re)sets the cookie. */
export function ensureLoginDeviceCookie(req: { headers: { cookie?: string } }, res: any): string {
  const id = readLoginDeviceId(req.headers.cookie) || crypto.randomBytes(16).toString("base64url");
  const isProd = process.env.NODE_ENV === "production";
  const cookieDomain = (process.env.COOKIE_DOMAIN || "").trim() || undefined;
  res.cookie(LOGIN_DEVICE_COOKIE, `${id}.${hmac("login-device:v1", id)}`, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
    ...(cookieDomain ? { domain: cookieDomain } : {}),
  });
  return id;
}

/** Stored on the USER_LOGIN audit row; a one-way tag, never the cookie value. */
export function loginDeviceTag(deviceId: string): string {
  return crypto.createHash("sha256").update(`tag:${deviceId}`).digest("hex").slice(0, 24);
}

/** The current browser's tag, if it carries a valid device cookie. */
export function currentLoginDeviceTag(cookieHeader: string | undefined): string | null {
  const id = readLoginDeviceId(cookieHeader);
  return id ? loginDeviceTag(id) : null;
}

/** Plain-language device name, e.g. "Chrome on Windows" or "NoLSAF app on Android". */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = String(userAgent || "");
  if (!ua) return "Unknown device";
  const os = /iphone/i.test(ua) ? "iPhone"
    : /ipad/i.test(ua) ? "iPad"
    : /android/i.test(ua) ? "Android"
    : /windows/i.test(ua) ? "Windows"
    : /macintosh|mac os/i.test(ua) ? "Mac"
    : /cros/i.test(ua) ? "ChromeOS"
    : /linux/i.test(ua) ? "Linux"
    : "";
  const app = /okhttp|expo|nolsaf/i.test(ua) && !/mozilla/i.test(ua) ? "NoLSAF app"
    : /edg\//i.test(ua) ? "Edge"
    : /opr\/|opera/i.test(ua) ? "Opera"
    : /samsungbrowser/i.test(ua) ? "Samsung Internet"
    : /firefox|fxios/i.test(ua) ? "Firefox"
    : /chrome|crios/i.test(ua) ? "Chrome"
    : /safari/i.test(ua) ? "Safari"
    : "";
  if (app && os) return `${app} on ${os}`;
  return app || os || ua.slice(0, 60);
}

type HistoryRow = { action?: string | null; ua: string | null; afterJson: unknown; createdAt: Date };

function after(row: HistoryRow): Record<string, unknown> | null {
  return row.afterJson && typeof row.afterJson === "object" ? row.afterJson as Record<string, unknown> : null;
}

/** Successful sign-ins that still count: not failed, and not before a "forget" of that device. */
function trustedSignIns(history: HistoryRow[]): HistoryRow[] {
  const forgottenTag = new Map<string, number>();
  const forgottenUa = new Map<string, number>();
  for (const row of history) {
    if (row.action !== LOGIN_DEVICE_FORGOTTEN) continue;
    const a = after(row);
    const at = row.createdAt.getTime();
    if (typeof a?.deviceTag === "string") forgottenTag.set(a.deviceTag, Math.max(at, forgottenTag.get(a.deviceTag) ?? 0));
    if (Array.isArray(a?.userAgents)) for (const ua of a.userAgents) if (typeof ua === "string") forgottenUa.set(ua, Math.max(at, forgottenUa.get(ua) ?? 0));
  }
  return history.filter((row) => {
    if (row.action && row.action !== "USER_LOGIN") return false;
    const a = after(row);
    if (a?.success === false) return false;
    const at = row.createdAt.getTime();
    const tag = typeof a?.deviceTag === "string" ? a.deviceTag : null;
    if (tag && (forgottenTag.get(tag) ?? -1) >= at) return false;
    if (row.ua && (forgottenUa.get(row.ua) ?? -1) >= at && !tag) return false;
    return true;
  });
}

async function loadHistory(userId: number, now: Date): Promise<HistoryRow[]> {
  return prisma.auditLog.findMany({
    where: {
      actorId: userId,
      action: { in: ["USER_LOGIN", LOGIN_DEVICE_FORGOTTEN] },
      createdAt: { gte: new Date(now.getTime() - DEVICE_TAG_LOOKBACK_DAYS * DAY_MS) },
    },
    select: { action: true, ua: true, afterJson: true, createdAt: true },
    orderBy: { id: "desc" },
    take: HISTORY_LIMIT,
  });
}

/**
 * Decide before the current sign-in is audited (so it never matches itself).
 * Fails to "no alert" only when history cannot be read, so a database hiccup
 * never floods inboxes.
 */
export async function shouldSendNewSignInAlert(params: {
  userId: number;
  deviceTag: string | null;
  userAgent: string;
  now?: Date;
}): Promise<boolean> {
  const now = params.now ?? new Date();
  let history: HistoryRow[];
  try {
    history = await loadHistory(params.userId, now);
  } catch {
    return false;
  }

  const trusted = trustedSignIns(history);
  const everSignedIn = history.some((row) => (!row.action || row.action === "USER_LOGIN") && after(row)?.success !== false);
  // First successful sign-in for this account: nothing to compare against.
  if (!everSignedIn) return false;

  if (params.deviceTag && trusted.some((row) => after(row)?.deviceTag === params.deviceTag)) return false;

  const ua = params.userAgent.slice(0, 255);
  const uaSince = now.getTime() - USER_AGENT_LOOKBACK_DAYS * DAY_MS;
  if (ua && trusted.some((row) => row.ua === ua && row.createdAt.getTime() >= uaSince)) return false;

  return true;
}

export type RecognisedDevice = {
  id: string;
  name: string;
  firstSignInAt: string;
  lastSignInAt: string;
  signIns: number;
  current: boolean;
};

/** Devices that will not trigger an alert, newest first. */
export async function listRecognisedDevices(userId: number, currentTag: string | null, now = new Date()): Promise<RecognisedDevice[]> {
  const byTag = new Map<string, RecognisedDevice & { last: number; first: number }>();
  for (const row of trustedSignIns(await loadHistory(userId, now))) {
    const tag = after(row)?.deviceTag;
    if (typeof tag !== "string") continue;
    const at = row.createdAt.getTime();
    const existing = byTag.get(tag);
    if (!existing) {
      byTag.set(tag, {
        id: tag, name: describeDevice(row.ua), signIns: 1, current: tag === currentTag,
        first: at, last: at, firstSignInAt: row.createdAt.toISOString(), lastSignInAt: row.createdAt.toISOString(),
      });
      continue;
    }
    existing.signIns += 1;
    if (at < existing.first) { existing.first = at; existing.firstSignInAt = row.createdAt.toISOString(); }
    if (at > existing.last) { existing.last = at; existing.lastSignInAt = row.createdAt.toISOString(); existing.name = describeDevice(row.ua); }
  }
  return [...byTag.values()]
    .sort((a, b) => b.last - a.last)
    .map(({ last, first, ...device }) => device);
}

/** The user agents a device used, so the user-agent fallback forgets them too. */
export async function userAgentsForDevice(userId: number, deviceTag: string, now = new Date()): Promise<string[]> {
  const uas = new Set<string>();
  for (const row of await loadHistory(userId, now)) {
    if (row.action === "USER_LOGIN" && after(row)?.deviceTag === deviceTag && row.ua) uas.add(row.ua);
  }
  return [...uas].slice(0, 20);
}

/**
 * "Sign out that device" link in the alert email: names one session of one
 * user, expires, and cannot be forged. Opening it only shows a confirm page.
 */
export function signSignOutDeviceToken(params: { userId: number; sessionId: string; deviceTag: string | null; nowSec?: number }): string {
  const exp = (params.nowSec ?? Math.floor(Date.now() / 1000)) + SIGN_OUT_LINK_TTL_SECONDS;
  const body = Buffer.from(JSON.stringify({ u: params.userId, s: params.sessionId, d: params.deviceTag, e: exp })).toString("base64url");
  return `${body}.${hmac("sign-in-alert-revoke:v1", body, 43)}`;
}

export function verifySignOutDeviceToken(token: string, nowSec = Math.floor(Date.now() / 1000)): { userId: number; sessionId: string; deviceTag: string | null } | null {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig || body.length > 600 || !safeEqual(sig, hmac("sign-in-alert-revoke:v1", body, 43))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const userId = Number(p?.u);
    if (!Number.isSafeInteger(userId) || userId <= 0 || typeof p?.s !== "string" || !p.s || !Number.isInteger(p?.e) || p.e < nowSec) return null;
    return { userId, sessionId: p.s, deviceTag: typeof p.d === "string" ? p.d : null };
  } catch {
    return null;
  }
}

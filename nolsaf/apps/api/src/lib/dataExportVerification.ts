import crypto from "node:crypto";
import { z } from "zod";
import { generate6, hashCode } from "./otp.js";
import { getRedis } from "./redis.js";

/**
 * A copy of personal data is released only after the person answers a few
 * questions and enters a code sent to a contact already verified on the
 * account. Same storage rules as contact changes: Redis, single use, locked
 * after five wrong codes, and fail closed in production when Redis is down.
 */

export const DATA_EXPORT_REASONS = ["KNOW_WHAT_WE_HOLD", "MOVE_TO_ANOTHER_SERVICE", "CLOSING_ACCOUNT", "SUPPORT_OR_DISPUTE", "LEGAL", "OTHER"] as const;
export const DATA_EXPORT_REASON_LABEL: Record<(typeof DATA_EXPORT_REASONS)[number], string> = {
  KNOW_WHAT_WE_HOLD: "Wants to know what NoLSAF holds about them",
  MOVE_TO_ANOTHER_SERVICE: "Moving their data to another service",
  CLOSING_ACCOUNT: "Plans to close their account",
  SUPPORT_OR_DISPUTE: "Needs it for a support or dispute matter",
  LEGAL: "Needs it for legal reasons",
  OTHER: "Other",
};

export const dataExportRequestInput = z.object({
  country: z.string().trim().min(2).max(80),
  reason: z.enum(DATA_EXPORT_REASONS).nullable().default(null),
  otherReason: z.string().trim().max(200).nullable().default(null),
  format: z.enum(["pdf", "json"]).default("pdf"),
});
export type DataExportRequest = z.infer<typeof dataExportRequestInput>;

type Challenge = DataExportRequest & { codeHash: string; attempts: number; sentVia: "email" | "phone"; sentTo: string; expiresAt: number };
type Grant = DataExportRequest & { userId: number; sentVia: "email" | "phone"; verifiedAt: string; expiresAt: number };

const CODE_TTL_SEC = 10 * 60;
const GRANT_TTL_SEC = 10 * 60;
// Three wrong codes lock data downloads on the account until an admin unlocks them.
export const DATA_EXPORT_MAX_ATTEMPTS = 3;
const memory = new Map<string, { value: string; expiresAt: number }>();
const challengeKey = (userId: number) => `data-export:challenge:${userId}`;
const grantKey = (token: string) => `data-export:grant:${crypto.createHash("sha256").update(token).digest("hex")}`;

async function put(key: string, value: unknown, ttlSec: number) {
  const raw = JSON.stringify(value);
  try {
    const redis = getRedis();
    if (redis) { await redis.set(key, raw, "EX", ttlSec); memory.delete(key); return; }
  } catch { /* fall through */ }
  if (process.env.NODE_ENV === "production") throw new Error("Secure verification storage is unavailable");
  memory.set(key, { value: raw, expiresAt: Date.now() + ttlSec * 1000 });
}

async function get<T>(key: string): Promise<T | null> {
  try {
    const redis = getRedis();
    if (redis) { const raw = await redis.get(key); return raw ? (JSON.parse(raw) as T) : null; }
  } catch {
    if (process.env.NODE_ENV === "production") return null;
  }
  const hit = memory.get(key);
  if (!hit || hit.expiresAt <= Date.now()) { memory.delete(key); return null; }
  return JSON.parse(hit.value) as T;
}

async function drop(key: string) {
  try { const redis = getRedis(); if (redis) await redis.del(key); } catch { /* best effort */ }
  memory.delete(key);
}

export async function startDataExportChallenge(userId: number, request: DataExportRequest, sentVia: "email" | "phone", sentTo: string) {
  const code = generate6();
  await put(challengeKey(userId), { ...request, codeHash: hashCode(code), attempts: 0, sentVia, sentTo, expiresAt: Date.now() + CODE_TTL_SEC * 1000 } satisfies Challenge, CODE_TTL_SEC);
  return { code, expiresInMinutes: CODE_TTL_SEC / 60 };
}

export async function cancelDataExportChallenge(userId: number) {
  await drop(challengeKey(userId));
}

/** Checks the code. A right code consumes the challenge and returns a short-lived download grant. */
export async function verifyDataExportCode(userId: number, code: string): Promise<
  | { result: "VALID"; grant: string; request: Grant }
  | { result: "INVALID"; attemptsLeft: number }
  | { result: "LOCKED"; request: DataExportRequest & { sentVia: "email" | "phone" } }
  | { result: "MISSING" }
> {
  const key = challengeKey(userId);
  const challenge = await get<Challenge>(key);
  if (!challenge || challenge.expiresAt <= Date.now()) return { result: "MISSING" };
  const given = Buffer.from(hashCode(String(code).trim()), "hex");
  const stored = Buffer.from(challenge.codeHash, "hex");
  const ok = given.length === stored.length && crypto.timingSafeEqual(given, stored);
  if (!ok) {
    const attempts = challenge.attempts + 1;
    if (attempts >= DATA_EXPORT_MAX_ATTEMPTS) {
      await drop(key);
      return { result: "LOCKED", request: { country: challenge.country, reason: challenge.reason, otherReason: challenge.otherReason, format: challenge.format, sentVia: challenge.sentVia } };
    }
    const ttl = Math.max(1, Math.ceil((challenge.expiresAt - Date.now()) / 1000));
    await put(key, { ...challenge, attempts }, ttl);
    return { result: "INVALID", attemptsLeft: DATA_EXPORT_MAX_ATTEMPTS - attempts };
  }
  await drop(key);
  const token = crypto.randomBytes(32).toString("base64url");
  const { codeHash: _codeHash, attempts: _attempts, sentTo: _sentTo, expiresAt: _expiresAt, ...answers } = challenge;
  const grant: Grant = { ...answers, userId, verifiedAt: new Date().toISOString(), expiresAt: Date.now() + GRANT_TTL_SEC * 1000 };
  await put(grantKey(token), grant, GRANT_TTL_SEC);
  return { result: "VALID", grant: token, request: grant };
}

/** The grant behind a download, only for the account it was issued to. Usable for 10 minutes. */
export async function readDataExportGrant(userId: number, token: string | undefined | null): Promise<Grant | null> {
  if (!token || token.length < 20) return null;
  const grant = await get<Grant>(grantKey(token));
  if (!grant || grant.userId !== userId || grant.expiresAt <= Date.now()) return null;
  return grant;
}

/** "da***@gmail.com" or "*******2370": enough for the person to recognise, not enough to read. */
export function maskDestination(via: "email" | "phone", value: string) {
  if (via === "email") {
    const [local, domain] = value.split("@");
    return domain ? `${local.slice(0, 2)}***@${domain}` : "***";
  }
  return `${"*".repeat(Math.max(5, value.length - 4))}${value.slice(-4)}`;
}

export const DATA_EXPORT_LOCKED_ACTION = "USER_DATA_EXPORT_LOCKED";
export const DATA_EXPORT_UNLOCKED_ACTION = "USER_DATA_EXPORT_UNLOCKED";

/**
 * Whether data downloads are locked on this account. The audit log is the
 * record: the latest lock or unlock entry for the account decides. Locks come
 * from three wrong codes; only an admin unlock lifts them.
 */
export async function dataExportLockState(db: any, userId: number): Promise<{ locked: boolean; since: Date | null; lastChangeBy: "customer" | "admin" | null; note: string | null }> {
  const latest = await db.auditLog.findFirst({
    where: { entity: `user:${userId}`, action: { in: [DATA_EXPORT_LOCKED_ACTION, DATA_EXPORT_UNLOCKED_ACTION] } },
    orderBy: { createdAt: "desc" },
    select: { action: true, createdAt: true, actorId: true, afterJson: true },
  });
  if (!latest) return { locked: false, since: null, lastChangeBy: null, note: null };
  const detail = latest.afterJson && typeof latest.afterJson === "object" ? (latest.afterJson as Record<string, unknown>) : {};
  return {
    locked: latest.action === DATA_EXPORT_LOCKED_ACTION,
    since: latest.createdAt,
    lastChangeBy: latest.actorId === userId ? "customer" : "admin",
    note: typeof detail.reason === "string" ? detail.reason : null,
  };
}

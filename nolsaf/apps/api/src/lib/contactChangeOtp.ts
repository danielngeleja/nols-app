import crypto from "node:crypto";
import { hashCode, generate6 } from "./otp.js";
import { getRedis } from "./redis.js";

export type ContactField = "phone" | "email";
export type ContactChangeStage = "AUTHORIZE_EXISTING" | "VERIFY_NEW";

export type ContactChangeEntry = {
  field: ContactField;
  value: string;
  oldValue: string | null;
  stage: ContactChangeStage;
  codeHash: string;
  attempts: number;
  authorizationField?: ContactField;
  authorizationDestination?: string;
  expiresAt: number;
};

export type ContactCodeResult = "VALID" | "INVALID" | "LOCKED" | "MISSING" | "WRONG_STAGE";

const OTP_TTL_SEC = 5 * 60;
const OTP_TTL_MS = OTP_TTL_SEC * 1000;
export const CONTACT_CHANGE_MAX_ATTEMPTS = 5;
const fallbackStore = new Map<string, ContactChangeEntry>();

function storeKey(userId: number | string, field: ContactField): string {
  return `contact-change:${userId}:${field}`;
}

export const generateOtp = generate6;

export async function storeContactChangeChallenge(
  userId: number | string,
  entry: Omit<ContactChangeEntry, "attempts" | "expiresAt">,
): Promise<ContactChangeEntry> {
  const stored: ContactChangeEntry = {
    ...entry,
    attempts: 0,
    expiresAt: Date.now() + OTP_TTL_MS,
  };
  const key = storeKey(userId, entry.field);
  try {
    const redis = getRedis();
    if (redis) {
      await redis.set(key, JSON.stringify(stored), "EX", OTP_TTL_SEC);
      fallbackStore.delete(key);
      return stored;
    }
  } catch {
    // Production fails closed below; local development can use memory.
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("Secure contact verification storage is unavailable");
  }
  fallbackStore.set(key, stored);
  return stored;
}

export async function getContactChangeEntry(
  userId: number | string,
  field: ContactField,
): Promise<ContactChangeEntry | null> {
  const key = storeKey(userId, field);
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as ContactChangeEntry;
    }
  } catch {
    // Production fails closed instead of trusting a divergent local copy.
    if (process.env.NODE_ENV === "production") return null;
  }
  const entry = fallbackStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    fallbackStore.delete(key);
    return null;
  }
  return entry;
}

/**
 * Atomically verifies and consumes a stage code. Invalid attempts are counted
 * server-side and the challenge is destroyed after five failures.
 */
export async function consumeContactChangeCode(
  userId: number | string,
  field: ContactField,
  expectedStage: ContactChangeStage,
  code: string,
): Promise<{ result: ContactCodeResult; entry: ContactChangeEntry | null }> {
  const key = storeKey(userId, field);
  const candidateHash = hashCode(String(code));
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.eval(
        `local raw = redis.call('GET', KEYS[1])
         if not raw then return nil end
         local item = cjson.decode(raw)
         if item.stage ~= ARGV[1] then return cjson.encode({ result = 'WRONG_STAGE', entry = item }) end
         if item.codeHash ~= ARGV[2] then
           item.attempts = (item.attempts or 0) + 1
           if item.attempts >= tonumber(ARGV[3]) then
             redis.call('DEL', KEYS[1])
             return cjson.encode({ result = 'LOCKED', entry = item })
           end
           redis.call('SET', KEYS[1], cjson.encode(item), 'KEEPTTL')
           return cjson.encode({ result = 'INVALID', entry = item })
         end
         redis.call('DEL', KEYS[1])
         return cjson.encode({ result = 'VALID', entry = item })`,
        1,
        key,
        expectedStage,
        candidateHash,
        String(CONTACT_CHANGE_MAX_ATTEMPTS),
      ) as string | null;
      fallbackStore.delete(key);
      if (!raw) return { result: "MISSING", entry: null };
      return JSON.parse(raw) as { result: ContactCodeResult; entry: ContactChangeEntry | null };
    }
  } catch {
    if (process.env.NODE_ENV === "production") return { result: "MISSING", entry: null };
  }

  const entry = fallbackStore.get(key);
  if (!entry || entry.expiresAt <= Date.now()) {
    fallbackStore.delete(key);
    return { result: "MISSING", entry: null };
  }
  if (entry.stage !== expectedStage) return { result: "WRONG_STAGE", entry };
  const input = Buffer.from(candidateHash, "hex");
  const stored = Buffer.from(entry.codeHash, "hex");
  const valid = input.length === stored.length && crypto.timingSafeEqual(input, stored);
  if (valid) {
    fallbackStore.delete(key);
    return { result: "VALID", entry };
  }
  entry.attempts += 1;
  if (entry.attempts >= CONTACT_CHANGE_MAX_ATTEMPTS) {
    fallbackStore.delete(key);
    return { result: "LOCKED", entry };
  }
  fallbackStore.set(key, entry);
  return { result: "INVALID", entry };
}

export async function deleteContactChangeChallenge(userId: number | string, field: ContactField): Promise<void> {
  const key = storeKey(userId, field);
  try {
    const redis = getRedis();
    if (redis) await redis.del(key);
  } catch {
    // best effort cleanup
  }
  fallbackStore.delete(key);
}

export function codeHash(code: string): string {
  return hashCode(code);
}

/**
 * AzamPay Shared Helpers
 *
 * Centralises constants, phone normalisation, outbound fetch wrapper,
 * idempotency cache, and rate-limiter builder so all AzamPay route files
 * (MNO, Bank, Card, tour-bookings) share one source of truth.
 *
 * SECURITY:
 *  - Every outbound call uses a hard 10-second AbortController timeout.
 *  - Env var VALUES are never written to logs.
 *  - Idempotency cache uses Redis → in-process LRU fallback.
 */

import { rateLimitWithRedis as rateLimit } from "./redisRateLimitStore.js";
import { getRedis } from "./redis.js";

// ── Constants ──────────────────────────────────────────────────────────────────

export const AZAMPAY_API_URL = (
  process.env.AZAMPAY_API_URL || "https://api.azampay.co.tz"
).replace(/\/$/, "");

// Card checkout lives at the production API even when MNO uses the sandbox.
// Set AZAMPAY_CARD_API_URL in .env.local to override (e.g. https://api.azampay.co.tz).
export const AZAMPAY_CARD_API_URL = (
  process.env.AZAMPAY_CARD_API_URL || AZAMPAY_API_URL
).replace(/\/$/, "");

// MNO direct push (USSD handset prompt) uses the checkout domain, not the API domain.
// This triggers immediate USSD prompt on customer phone, not a hosted checkout page.
// Set AZAMPAY_MNO_API_URL in .env.local to override.
export const AZAMPAY_MNO_API_URL = (
  process.env.AZAMPAY_MNO_API_URL || "https://checkout.azampay.co.tz"
).replace(/\/$/, "");

export const FETCH_TIMEOUT_MS = 10_000;
export const IDEM_TTL_SEC     = 10 * 60; // 10 minutes

/** Tanzania phone: +255 or 0, then network digit (6=Airtel, 7=Vodacom/Tigo/Halo, 2=TTCL), then 8 digits */
export const TZ_PHONE_RE = /^(\+255|0)(6|7|2)\d{8}$/;

// ── Supported bank codes ───────────────────────────────────────────────────────

export const BANK_PROVIDER_CATALOG = [
  { code: "CRDB", label: "CRDB Bank", checkoutEnabled: true },
  { code: "NMB", label: "NMB Bank", checkoutEnabled: true },
  { code: "NBC", label: "NBC Bank", checkoutEnabled: false },
  { code: "STANBIC", label: "Stanbic Bank Tanzania", checkoutEnabled: false },
  { code: "EQUITY", label: "Equity Bank Tanzania", checkoutEnabled: false },
  { code: "IM", label: "I&M Bank", checkoutEnabled: false },
  { code: "ABSA", label: "ABSA Bank Tanzania", checkoutEnabled: false },
  { code: "TCB", label: "Tanzania Commercial Bank", checkoutEnabled: false },
  { code: "BOA", label: "Bank of Africa Tanzania", checkoutEnabled: false },
  { code: "DTB", label: "Diamond Trust Bank", checkoutEnabled: false },
  { code: "UBA", label: "UBA Tanzania", checkoutEnabled: false },
  { code: "AZANIA", label: "Azania Bank", checkoutEnabled: false },
  { code: "KCB", label: "KCB Bank Tanzania", checkoutEnabled: false },
  { code: "NCBA", label: "NCBA Bank Tanzania", checkoutEnabled: false },
  { code: "YETU", label: "Yetu Microfinance Bank", checkoutEnabled: false },
] as const;

export type BankCode = (typeof BANK_PROVIDER_CATALOG)[number]["code"];

/** Every bank code understood by the provider integration. */
export const SUPPORTED_BANK_CODES = BANK_PROVIDER_CATALOG.map((bank) => bank.code) as [BankCode, ...BankCode[]];

/** Banks deliberately published in customer checkout today. */
export const CHECKOUT_BANK_CODES = ["CRDB", "NMB"] as const satisfies readonly BankCode[];

// ── Phone normalisation ────────────────────────────────────────────────────────

/**
 * Normalise a raw phone string to E.164 (+255XXXXXXXXX).
 * Accepts: +255XXXXXXXXX | 255XXXXXXXXX | 0XXXXXXXXX
 * Returns null if the result fails the Tanzania format check.
 */
export function normalizePhone(raw: string): string | null {
  // Strip whitespace, dashes, parens
  let n = raw.replace(/[\s\-()]/g, "");
  // Keep only the leading + (if any) then strip any other + signs
  const hasLeadingPlus = n.startsWith("+");
  n = (hasLeadingPlus ? "+" : "") + n.replace(/\+/g, "");

  if (n.startsWith("+255")) {
    // already E.164 — keep as-is
  } else if (n.startsWith("255") && n.length === 12) {
    n = `+${n}`;
  } else if (n.startsWith("0") && n.length === 10) {
    n = `+255${n.slice(1)}`;
  } else {
    return null;
  }

  if (!TZ_PHONE_RE.test(n)) return null;
  return n;
}

export function maskAzamPayPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const normalized = normalizePhone(phone) ?? phone;
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 4) return "***";
  return `${normalized.startsWith("+") ? "+" : ""}${digits.slice(0, 3)}***${digits.slice(-4)}`;
}

export function describeAzamPayResponseBody(body: string): {
  bodyKind: "empty" | "url" | "json" | "text";
  bodyLength: number;
  transactionId: string | null;
  jsonKeys: string[];
} {
  const trimmed = body.trim();
  if (!trimmed) {
    return { bodyKind: "empty", bodyLength: 0, transactionId: null, jsonKeys: [] };
  }

  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return { bodyKind: "url", bodyLength: trimmed.length, transactionId: null, jsonKeys: [] };
  }

  try {
    const parsed = JSON.parse(trimmed);
    const record = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    const transactionId = record.transactionId ?? record.TransactionId ?? record.transId ?? null;
    return {
      bodyKind: "json",
      bodyLength: trimmed.length,
      transactionId: transactionId == null ? null : String(transactionId),
      jsonKeys: Object.keys(record).slice(0, 20),
    };
  } catch {
    return { bodyKind: "text", bodyLength: trimmed.length, transactionId: null, jsonKeys: [] };
  }
}

// ── Outbound fetch wrapper ──────

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [400, 900]; // wait before attempt 2, then attempt 3

/** Lightweight response object — body is pre-read so we can retry on empty-200. */
export interface AzamPayResponse {
  ok: boolean;
  status: number;
  body: string;
}

/**
 * Internal: POST to a given AzamPay URL.
 *
 * Retries only on ECONNRESET (connection pool race / sandbox flap).
 *
 * HTTP 200 with an empty body is NOT a failure — for MNO PostCheckout it is the
 * normal "push notification sent to phone, awaiting webhook" acknowledgment.
 * Caller is responsible for interpreting an empty 200 according to channel.
 *
 * Body is read inside the loop. Never echoes the request body in errors.
 */
async function postWithRetries(
  url: string,
  body: object,
  token: string,
  tag: string,
): Promise<AzamPayResponse> {
  let lastErr: any;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body:   JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err: any) {
      clearTimeout(timer);
      lastErr = err;
      const cause = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? "unknown";
      if (cause === "ECONNRESET" && attempt < MAX_ATTEMPTS) {
        const delay = RETRY_DELAYS_MS[attempt - 1] ?? 500;
        console.warn(`[${tag}] ECONNRESET on attempt ${attempt}, retrying in ${delay}ms → ${url}`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      console.error(`[${tag}] fetch error → name=${err?.name} cause=${cause} url=${url} attempt=${attempt}`);
      throw new Error(`AzamPay request failed: ${err?.name ?? "NetworkError"} — ${cause}`);
    } finally {
      clearTimeout(timer);
    }

    let bodyText = "";
    try { bodyText = await res.text(); } catch { /* leave empty */ }

    return { ok: res.ok, status: res.status, body: bodyText };
  }

  const cause = lastErr?.cause?.code ?? lastErr?.cause?.message ?? lastErr?.message ?? "unknown";
  console.error(`[${tag}] fetch error (all ${MAX_ATTEMPTS} attempts failed) → cause=${cause} url=${url}`);
  throw new Error(`AzamPay request failed: ${lastErr?.name ?? "NetworkError"} — ${cause}`);
}

/**
 * POST to AzamPay (MNO/Bank). Returns the pre-read response body.
 * Retries on ECONNRESET and on HTTP 200 with empty body (sandbox quirks).
 */
export async function azampayPost(
  path: string,
  body: object,
  token: string
): Promise<AzamPayResponse> {
  return postWithRetries(`${AZAMPAY_API_URL}${path}`, body, token, "AzamPay");
}

/** Same as azampayPost but targets AZAMPAY_CARD_API_URL (card checkout endpoint). */
export async function azampayCardPost(
  path: string,
  body: object,
  token: string
): Promise<AzamPayResponse> {
  return postWithRetries(`${AZAMPAY_CARD_API_URL}${path}`, body, token, "AzamPay/Card");
}

/** Same as azampayPost but targets AZAMPAY_MNO_API_URL (direct MNO USSD push endpoint). */
export async function azampayMnoPost(
  path: string,
  body: object,
  token: string
): Promise<AzamPayResponse> {
  return postWithRetries(`${AZAMPAY_MNO_API_URL}${path}`, body, token, "AzamPay/MNO");
}

// ── Idempotency helpers (Redis → in-process LRU fallback) ─────────────────────

/** Module-level in-process LRU so all route files share the same cache */
export const localIdem = new Map<string, { result: object; exp: number }>();

export async function idemGet(key: string): Promise<object | null> {
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.get(`azp:idem:${key}`);
      if (raw) return JSON.parse(raw);
    }
  } catch { /* skip */ }
  const entry = localIdem.get(key);
  if (entry && entry.exp > Date.now()) return entry.result;
  return null;
}

export async function idemSet(key: string, result: object): Promise<void> {
  const exp = Date.now() + IDEM_TTL_SEC * 1000;
  try {
    const redis = getRedis();
    if (redis)
      await redis.set(`azp:idem:${key}`, JSON.stringify(result), "EX", IDEM_TTL_SEC);
  } catch { /* skip */ }
  localIdem.set(key, { result, exp });
  // Evict expired entries when cache grows large
  if (localIdem.size > 500) {
    const now = Date.now();
    for (const [k, v] of localIdem) {
      if (v.exp < now) localIdem.delete(k);
      if (localIdem.size <= 400) break;
    }
  }
}

// ── Rate-limiter builder ─────────

interface PaymentRateLimitOpts {
  windowMs: number;
  limit: number;
  keyFn: (req: any) => string;
}

export function makePaymentRateLimiter(opts: PaymentRateLimitOpts) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit:    opts.limit,
    standardHeaders: true,
    legacyHeaders:   false,
    keyGenerator:    opts.keyFn,
    handler: (req: any, res: any) => {
      const resetTime  = req.rateLimit?.resetTime;
      const retryAfter = resetTime instanceof Date
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(opts.windowMs / 1000);
      res.set("Retry-After", String(retryAfter));
      res.status(429).json({
        error:             "rate_limited",
        message:           `Too many payment requests. Please try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        retryAfterSeconds: retryAfter,
      });
    },
  });
}

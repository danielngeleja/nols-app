"use client";

/**
 * Client side handling of the `?s=<token>` property share parameter.
 *
 * Two jobs:
 *
 * 1. Ping the open endpoint once per browser session, so a recipient refreshing
 *    a listing does not inflate the sharer's open count.
 * 2. Remember the token for 30 days, so a recipient who browses now and
 *    registers next week is still attributed to the share that reached them.
 *    The window matches ATTRIBUTION_WINDOW_DAYS on the server, which is the
 *    side that actually enforces it.
 */
const STORAGE_KEY = "nolsaf.shareToken";
const WINDOW_DAYS = 30;
const TOKEN_PATTERN = /^[a-z2-9]{16}$/;

type StoredToken = { token: string; savedAt: number };

export function isShareToken(value: unknown): boolean {
  return TOKEN_PATTERN.test(String(value || ""));
}

/** Records the open once per session and remembers the token for later. */
export function captureShareToken(rawToken: unknown): void {
  if (typeof window === "undefined") return;
  const token = String(rawToken || "");
  if (!isShareToken(token)) return;

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ token, savedAt: Date.now() } satisfies StoredToken),
    );
  } catch {
    // Private browsing or a full quota must not break the page.
  }

  try {
    const seenKey = `${STORAGE_KEY}.seen.${token}`;
    if (window.sessionStorage.getItem(seenKey)) return;
    window.sessionStorage.setItem(seenKey, "1");

    // Fire and forget: attribution bookkeeping never blocks rendering.
    void fetch(`/api/public/property-shares/${encodeURIComponent(token)}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
  } catch {
    // sessionStorage unavailable: skip counting rather than double counting.
  }
}

/** Returns a still-valid stored token, or null. */
export function readShareToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!isShareToken(parsed?.token)) return null;
    const ageMs = Date.now() - Number(parsed.savedAt || 0);
    if (ageMs > WINDOW_DAYS * 24 * 60 * 60 * 1000) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

/**
 * Mints a tracked share link for a property.
 *
 * The token must be in the URL the recipient receives, so the link has to be
 * created before it is sent. Falls back to the plain listing URL when the
 * customer is signed out or the endpoint is unavailable: sharing must never
 * fail just because attribution could not be recorded.
 */
export async function createShareLink(
  propertyId: number,
  channel: "WHATSAPP" | "COPY_LINK" | "NATIVE" | "SMS" | "EMAIL" | "FACEBOOK" | "TWITTER",
  fallbackUrl: string,
): Promise<string> {
  try {
    const response = await fetch("/api/customer/property-shares", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId, channel }),
    });
    if (!response.ok) return fallbackUrl;
    const payload = await response.json();
    const url = payload?.data?.url;
    return typeof url === "string" && url.length > 0 ? url : fallbackUrl;
  } catch {
    return fallbackUrl;
  }
}

/** Called once a registration has been attributed, so it cannot be reused. */
export function clearShareToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

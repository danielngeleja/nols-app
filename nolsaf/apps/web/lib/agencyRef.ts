/**
 * Agency Desk link token (the `ag` query parameter on a partner's booking link).
 *
 * Kept only in this browser for a short time and sent with the booking request.
 * The server validates it completely; a missing, expired or tampered value just
 * means the booking is not credited to a partner. It never changes the price.
 */
const KEY = "nolsaf.agencyRef";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function captureAgencyRefFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const value = new URLSearchParams(window.location.search).get("ag");
    if (!value || !TOKEN_PATTERN.test(value)) return;
    window.localStorage.setItem(KEY, JSON.stringify({ value, at: Date.now() }));
  } catch {
    // Storage blocked (private mode): the booking simply is not credited.
  }
}

export function readAgencyRef(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value?: string; at?: number };
    if (!parsed?.value || !TOKEN_PATTERN.test(parsed.value) || !parsed.at || Date.now() - parsed.at > TTL_MS) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

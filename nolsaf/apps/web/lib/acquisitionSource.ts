/**
 * Where a visitor first came from (docs/CHANNEL_ATTRIBUTION.md).
 *
 * The first visit's source is worked out in the browser and held in this tab
 * only. It becomes a 30-day first-party cookie (`nolsaf_src`) once the visitor
 * allows Marketing cookies, and is discarded if they decline. The server reads
 * the cookie when a booking, tour or tenancy is created and validates every
 * field again. It never affects a price, a payment or a partner's commission.
 */
export const SOURCE_COOKIE = "nolsaf_src";
export const SOURCE_DAYS = 30;
const PENDING_KEY = "nolsaf.pendingSource";
const CONSENT_KEY = "nolsaf_cookie_consent";
export const CONSENT_EVENT = "nolsaf-consent-changed";

export type Channel = "SEARCH" | "SOCIAL" | "CAMPAIGN" | "QR" | "PARTNER_LINK" | "REFERRAL" | "DIRECT";
export type FirstTouch = {
  c: Channel;
  s?: string; // source
  m?: string; // medium
  n?: string; // campaign name
  d?: string; // detail
  p?: string; // landing path (shape only)
  t: number; // first seen, ms
};

const SEARCH_HOSTS = ["google.", "bing.com", "duckduckgo.com", "yahoo.", "yandex.", "ecosia.org", "baidu.com"];
const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "facebook", "fb.com": "facebook", "instagram.com": "instagram", "t.co": "x", "twitter.com": "x", "x.com": "x",
  "tiktok.com": "tiktok", "linkedin.com": "linkedin", "lnkd.in": "linkedin", "youtube.com": "youtube", "youtu.be": "youtube",
  "whatsapp.com": "whatsapp", "wa.me": "whatsapp", "pinterest.com": "pinterest", "reddit.com": "reddit", "threads.net": "threads",
};
const SOCIAL_MEDIA = /^(social|social-media|paid-social|socialmedia)$/i;
const QR_PATHS: Array<[RegExp, string]> = [
  [/^\/verify\/property/, "property-certificate"],
  [/^\/verify\/operator/, "operator-certificate"],
  [/^\/verify\/sales/, "sales-card"],
  [/^\/verify\/driver/, "driver-card"],
];

/** Only short, plain words survive: nothing that could carry personal data. */
export function cleanToken(value: unknown, max = 60): string | undefined {
  const text = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9 ._-]/g, "").slice(0, max);
  return text || undefined;
}

/** The landing path's shape, never its tokens: long or odd segments become ":x". */
export function pathShape(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean).slice(0, 3)
    .map((part) => (/^[a-z0-9-]{1,40}$/.test(part) && !/\d{4,}/.test(part) ? part : ":x"));
  return `/${parts.join("/")}`.slice(0, 120);
}

function hostOf(referrer: string): string | null {
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function classifyFirstTouch(input: { url: string; referrer: string; ownHost: string; now: number }): FirstTouch {
  const url = new URL(input.url);
  const q = url.searchParams;
  const base = { p: pathShape(url.pathname), t: input.now };

  if (q.get("ag")) return { c: "PARTNER_LINK", d: "agency-link", ...base };
  if (q.get("src") === "qr") return { c: "QR", d: cleanToken(q.get("qr")) ?? "qr", ...base };
  for (const [pattern, detail] of QR_PATHS) if (pattern.test(url.pathname)) return { c: "QR", d: detail, ...base };

  const utmSource = cleanToken(q.get("utm_source"));
  const utmMedium = cleanToken(q.get("utm_medium"));
  const utmCampaign = cleanToken(q.get("utm_campaign"), 80);
  if (q.get("gclid")) return { c: "CAMPAIGN", s: "google", m: "cpc", n: utmCampaign, ...base };
  if (q.get("fbclid") && !utmSource) return { c: "SOCIAL", s: "facebook", ...base };
  if (utmSource || utmMedium || utmCampaign) {
    return { c: utmMedium && SOCIAL_MEDIA.test(utmMedium) ? "SOCIAL" : "CAMPAIGN", s: utmSource, m: utmMedium, n: utmCampaign, ...base };
  }

  const host = hostOf(input.referrer);
  const own = input.ownHost.toLowerCase().replace(/^www\./, "");
  if (!host || host === own || host.endsWith(`.${own}`)) return { c: "DIRECT", ...base };
  const search = SEARCH_HOSTS.find((h) => host.includes(h));
  if (search) return { c: "SEARCH", s: search.replace(/\.(com|org)?$/, "").replace(/\.$/, ""), ...base };
  const social = Object.entries(SOCIAL_HOSTS).find(([h]) => host === h || host.endsWith(`.${h}`));
  if (social) return { c: "SOCIAL", s: social[1], ...base };
  return { c: "REFERRAL", s: cleanToken(host), ...base };
}

/** Marketing consent as the cookie banner stored it. */
export function marketingConsent(): boolean | null {
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    return Boolean((JSON.parse(raw) as { marketing?: boolean }).marketing);
  } catch {
    return null;
  }
}

function readCookie(): string | null {
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${SOURCE_COOKIE}=`));
  return match ? match.slice(SOURCE_COOKIE.length + 1) : null;
}

function writeCookie(touch: FirstTouch) {
  const value = encodeURIComponent(JSON.stringify(touch));
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${SOURCE_COOKIE}=${value}; Max-Age=${SOURCE_DAYS * 86_400}; Path=/; SameSite=Lax${secure}`;
}

function clearCookie() {
  document.cookie = `${SOURCE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** Runs once per page load: notes the first visit, then saves or drops it by consent. */
export function syncFirstTouch(): void {
  if (typeof window === "undefined") return;
  try {
    const consent = marketingConsent();
    if (consent === false) {
      window.sessionStorage.removeItem(PENDING_KEY);
      if (readCookie()) clearCookie();
      return;
    }
    // First touch wins for 30 days: an existing cookie is never replaced.
    if (readCookie()) return;
    let pending = window.sessionStorage.getItem(PENDING_KEY);
    if (!pending) {
      const touch = classifyFirstTouch({ url: window.location.href, referrer: document.referrer, ownHost: window.location.hostname, now: Date.now() });
      pending = JSON.stringify(touch);
      window.sessionStorage.setItem(PENDING_KEY, pending);
    }
    if (consent === true) {
      writeCookie(JSON.parse(pending) as FirstTouch);
      window.sessionStorage.removeItem(PENDING_KEY);
    }
  } catch {
    // Storage or cookies blocked: the visit is simply not attributed.
  }
}

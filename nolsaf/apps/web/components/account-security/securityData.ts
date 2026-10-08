/** Small helpers shared by the owner security pages. */

export const EAT = "Africa/Dar_es_Salaam"

export type LoginRecord = {
  id: string
  at: string
  ip?: string | null
  username?: string | null
  platform?: string | null
  details?: string | null
  success?: boolean | null
}

export type Passkey = { id: string; name: string; createdAt?: string }

/** Reads the event, sign-in method and browser out of the record's details text. */
export function parseLogin(record: LoginRecord) {
  const lines = String(record.details || "").split("\n")
  const pick = (key: string) => lines.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).trim() || ""
  const ua = pick("UA")
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /okhttp|Expo|ReactNative/i.test(ua) ? "NoLSAF app" : ua ? "Browser" : ""
  const event = pick("Event") || "login"
  const method = pick("Method")
  return {
    event: event.toLowerCase(),
    isLogout: event.toLowerCase() === "logout",
    method: method ? method.replace(/[_-]/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "",
    browser,
    device: [browser, record.platform].filter(Boolean).join(" on ") || "Unknown device",
  }
}

export function eatDateTime(iso: string) {
  const d = new Date(iso)
  return {
    day: d.toLocaleDateString("en-GB", { timeZone: EAT, weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    time: `${d.toLocaleTimeString("en-GB", { timeZone: EAT, hour: "2-digit", minute: "2-digit" })} EAT`,
  }
}

export function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.round(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? "" : "s"} ago`
}

/** /api/account/me answers as { ok, data } or as the user object itself. */
export function unwrapMe(payload: any) {
  return payload?.ok && payload?.data ? payload.data : payload?.data || payload
}

/** Where a security area lives and what it protects, so owners and guests share one set of pages. */
export type SecurityScope = {
  /** Route of the security overview, e.g. /owner/settings or /account/security. */
  base: string;
  /** Where the user adds a phone number. */
  profileHref: string;
  /** Finishes "Only a password protects ..." */
  protects: string;
  /** One line under the Overview title. */
  overviewBlurb: string;
};

export const OWNER_SECURITY: SecurityScope = {
  base: "/owner/settings",
  profileHref: "/owner/profile",
  protects: "your account and your payouts",
  overviewBlurb: "Your account controls your properties, bookings and payouts. Keep it locked to you.",
};

export const CUSTOMER_SECURITY: SecurityScope = {
  base: "/account/security",
  profileHref: "/account/profile",
  protects: "your account and your bookings",
  overviewBlurb: "Your account holds your bookings, payments and travel details. Keep it locked to you.",
};

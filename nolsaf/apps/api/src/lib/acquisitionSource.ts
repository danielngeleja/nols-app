/**
 * Marketing channel of a booking, tour booking or tenancy
 * (docs/CHANNEL_ATTRIBUTION.md). The browser sets the `nolsaf_src` cookie
 * only with Marketing consent (apps/web/lib/acquisitionSource.ts). The cookie
 * is visitor-controlled, so every field is validated again here and anything
 * odd is dropped. Reporting only: it never changes price, payment or any
 * partner's commission. Recording never blocks or fails the booking.
 */
export const SOURCE_COOKIE = "nolsaf_src";
export const SOURCE_DAYS = 30;
export const CHANNELS = ["SEARCH", "SOCIAL", "CAMPAIGN", "QR", "PARTNER_LINK", "REFERRAL", "DIRECT"] as const;
export type Channel = (typeof CHANNELS)[number];
export type TargetType = "BOOKING" | "TOUR_BOOKING" | "TENANCY";

export type FirstTouch = {
  channel: Channel;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  detail: string | null;
  landingPath: string | null;
  firstSeenAt: Date;
};

const WORD = /^[a-z0-9 ._-]{1,80}$/;
const PATH = /^\/(?:[a-z0-9:-]{1,40}(?:\/[a-z0-9:-]{1,40}){0,2})?$/;

function word(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  return text && text.length <= max && WORD.test(text) ? text : null;
}

/** Reads one cookie from a raw Cookie header, without a parser dependency. */
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header || header.length > 16_000) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

/** Validated first touch from the cookie, or null when it is missing, stale or malformed. */
export function parseFirstTouch(cookieHeader: string | undefined, now = new Date()): FirstTouch | null {
  const raw = readCookie(cookieHeader, SOURCE_COOKIE);
  if (!raw || raw.length > 1_200) return null;
  let data: any;
  try {
    data = JSON.parse(decodeURIComponent(raw));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  if (!(CHANNELS as readonly string[]).includes(data.c)) return null;
  const seen = Number(data.t);
  // Within the 30 days and not from the future (a little clock drift allowed).
  if (!Number.isFinite(seen) || seen > now.getTime() + 5 * 60_000 || now.getTime() - seen > SOURCE_DAYS * 86_400_000) return null;
  return {
    channel: data.c as Channel,
    source: word(data.s, 60),
    medium: word(data.m, 60),
    campaign: word(data.n, 80),
    detail: word(data.d, 60),
    landingPath: typeof data.p === "string" && data.p.length <= 120 && PATH.test(data.p) ? data.p : null,
    firstSeenAt: new Date(seen),
  };
}

/**
 * Records the channel for a new booking, tour booking or tenancy. Once per
 * target (unique index); a missing table, a duplicate or a bad cookie is
 * ignored. Never throws.
 */
export async function recordAcquisitionSource(
  db: any,
  target: { type: TargetType; id: number },
  cookieHeader: string | undefined,
  now = new Date(),
): Promise<boolean> {
  try {
    const touch = parseFirstTouch(cookieHeader, now);
    if (!touch || !Number.isSafeInteger(target.id) || target.id <= 0) return false;
    await db.acquisitionSource.create({ data: { targetType: target.type, targetId: target.id, ...touch } });
    return true;
  } catch (error: any) {
    // P2002 duplicate, P2021 table not created yet: both are fine to skip.
    if (error?.code !== "P2002" && error?.code !== "P2021") {
      console.warn("[acquisition] source not recorded:", error?.message || String(error));
    }
    return false;
  }
}

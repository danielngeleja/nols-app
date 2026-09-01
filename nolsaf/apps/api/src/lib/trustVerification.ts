import { prisma } from "@nolsaf/prisma";

/**
 * Trust and verification shared rules.
 *
 * The public /verify page is an anti-impersonation surface. Its whole value is
 * that everything printed on it is true and independently checkable, so the
 * rules that decide what may appear live here, server side, rather than being
 * re-implemented per route or trusted to admin discipline.
 */

export const VERIFICATION_STATUSES = [
  "DRAFT",
  "PENDING",
  "UNDER_REVIEW",
  "VERIFIED",
  "ACTIVE",
  "EXPIRED",
  "WITHDRAWN",
] as const;

export const VERIFICATION_CATEGORIES = ["IDENTITY", "REGISTRATION", "COMPLIANCE"] as const;

export const CHANNEL_TYPES = ["WEBSITE", "EMAIL", "PHONE", "ADDRESS", "SOCIAL"] as const;

export type PublicChannelType = (typeof CHANNEL_TYPES)[number];

/**
 * Canonical comparison keys for public channel lookups. Values are compared
 * only after normalisation; the approved display value is returned unchanged.
 * This lets `+255 765 012 370` match `0765012370` without turning the endpoint
 * into a fuzzy directory search.
 */
export function normalizePublicChannelValue(channelType: string, rawValue: string): string {
  const type = String(channelType || "").trim().toUpperCase();
  const raw = String(rawValue || "").trim();
  if (!raw) return "";

  if (type === "EMAIL") {
    return raw.replace(/^mailto:/i, "").trim().toLowerCase();
  }

  if (type === "PHONE") {
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    // Tanzania local mobile/landline notation. International numbers that are
    // already prefixed remain untouched.
    if (/^0\d{9}$/.test(digits)) digits = `255${digits.slice(1)}`;
    return digits;
  }

  if (type === "WEBSITE" || type === "SOCIAL") {
    const withoutScheme = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "");
    return withoutScheme.replace(/[?#].*$/, "").replace(/\/+$/, "").trim().toLowerCase();
  }

  return raw.replace(/\s+/g, " ").toLowerCase();
}

export async function findPublishedChannelMatch(channelType: string, rawValue: string) {
  const type = String(channelType || "").trim().toUpperCase() as PublicChannelType;
  if (!CHANNEL_TYPES.includes(type)) return null;
  const needle = normalizePublicChannelValue(type, rawValue);
  if (!needle) return null;

  const channels = await prisma.officialCompanyChannel.findMany({
    where: {
      channelType: type,
      visibility: "PUBLIC",
      archivedAt: null,
      publishedAt: { not: null },
      confirmedAt: { not: null },
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      channelType: true,
      label: true,
      value: true,
      href: true,
      notes: true,
      confirmedAt: true,
    },
  });

  return (
    channels.find((channel) => {
      const candidates = [channel.value, channel.href || ""]
        .map((value) => normalizePublicChannelValue(type, value))
        .filter(Boolean);
      return candidates.includes(needle);
    }) || null
  );
}

/** Only these ever reach the public page. PENDING and UNDER_REVIEW never do. */
const PUBLISHABLE_STATUSES = new Set(["VERIFIED", "ACTIVE"]);

/**
 * Wording guard.
 *
 * A D-U-N-S number being assigned is not a verification, and an issuing
 * authority is not an endorser. Admin-entered free text is checked against
 * these so a stronger claim cannot be typed into the page later.
 */
const FORBIDDEN_CLAIM_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bD&B\s+verified\b/i, reason: 'Use "D-U-N-S Number Assigned" rather than "D&B Verified".' },
  { pattern: /\bdun\s*&?\s*bradstreet\s+verified\b/i, reason: 'Use "D-U-N-S Number Assigned" rather than a verification claim.' },
  { pattern: /\b(endorsed|endorsement|accredited|certified)\s+by\b/i, reason: "Do not claim endorsement, accreditation, or certification by another organisation." },
  { pattern: /\bapproved\s+by\s+(brela|the\s+government|bank|apple|google)\b/i, reason: "Do not imply approval by a registrar, bank, government, or platform." },
  { pattern: /\bpartnered\s+with\s+(apple|google|visa|mastercard)\b/i, reason: "Do not claim a partnership without separate approved evidence." },
];

export function findForbiddenClaim(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    const text = String(value || "");
    if (!text) continue;
    for (const rule of FORBIDDEN_CLAIM_PATTERNS) {
      if (rule.pattern.test(text)) return rule.reason;
    }
  }
  return null;
}

/** Registration numbers are searched normalised but always shown as approved. */
export function normalizeRegistrationNumber(value: string | null | undefined): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.replace(/[^A-Za-z0-9]/g, "").toUpperCase() || null;
}

export type PublishGateFailure = { ok: false; reason: string };
export type PublishGateSuccess = { ok: true };

/**
 * The single gate that decides whether a record may go public.
 *
 * Deliberately strict: a claim without an approved evidence trail, or one that
 * has expired, is exactly the sort of thing an impersonator would point at.
 */
export function canPublishVerification(record: {
  status: string;
  evidenceApprovedAt: Date | null;
  evidenceApprovedById: number | null;
  expiresAt: Date | null;
  archivedAt: Date | null;
}): PublishGateSuccess | PublishGateFailure {
  if (record.archivedAt) return { ok: false, reason: "Archived records cannot be published." };
  if (!PUBLISHABLE_STATUSES.has(String(record.status).toUpperCase())) {
    return { ok: false, reason: "Only VERIFIED or ACTIVE records can be published." };
  }
  if (!record.evidenceApprovedAt || !record.evidenceApprovedById) {
    return { ok: false, reason: "Evidence must be approved by a named administrator before publishing." };
  }
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "This record has expired and cannot be published." };
  }
  return { ok: true };
}

/**
 * The public projection. Nothing here is optional politeness: every field
 * omitted is a field an impersonator cannot borrow, and a null value is
 * dropped entirely rather than rendered as "Not available", which invites the
 * reader to guess.
 */
export async function loadPublicVerificationPayload() {
  const now = new Date();

  /**
   * A read failure must not render as "NoLSAF claims nothing".
   *
   * The old `.catch(() => [])` made a database blip indistinguishable from an
   * empty trust page, which on an anti-impersonation surface reads as evidence
   * against us. The empty list is still returned so the page renders, but the
   * caller is told the data is degraded and can say so.
   */
  let degraded = false;
  const orEmpty = (error: unknown) => {
    console.error("loadPublicVerificationPayload query failed", error);
    degraded = true;
    return [] as any[];
  };

  const [records, channels] = await Promise.all([
    prisma.companyVerification.findMany({
      where: {
        visibility: "PUBLIC",
        archivedAt: null,
        publishedAt: { not: null },
        status: { in: ["VERIFIED", "ACTIVE"] },
        evidenceApprovedAt: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      select: {
        key: true,
        category: true,
        displayName: true,
        authorityName: true,
        authorityDomain: true,
        jurisdiction: true,
        registrationNumber: true,
        publicSummary: true,
        status: true,
        externalVerificationUrl: true,
        issuedAt: true,
        expiresAt: true,
        lastCheckedAt: true,
      },
    }).catch(orEmpty),
    prisma.officialCompanyChannel.findMany({
      where: {
        visibility: "PUBLIC",
        archivedAt: null,
        publishedAt: { not: null },
        confirmedAt: { not: null },
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { channelType: true, label: true, value: true, href: true, notes: true, confirmedAt: true },
    }).catch(orEmpty),
  ]);

  return {
    records,
    // Channel values are intentionally not returned as an open directory.
    // Visitors submit one exact value to /channel and receive only its match.
    channelTypes: Array.from(new Set(channels.map((channel) => String(channel.channelType).toUpperCase()))),
    primaryWebsite:
      channels.find((channel) => String(channel.channelType).toUpperCase() === "WEBSITE") || null,
    // The QR encodes this URL and nothing else: the page is the revocable
    // source of truth, so a printed card never carries stale corporate data.
    verifyUrl: `${(process.env.WEB_ORIGIN || process.env.FRONTEND_URL || process.env.APP_ORIGIN || "").replace(/\/$/, "")}/verify`,
    generatedAt: now.toISOString(),
    // True when a query failed. The page must say "we could not load this right
    // now" rather than presenting an empty list as a complete answer.
    degraded,
    disclaimer:
      "Verify communications claiming to represent NoLSAF through the authorised channels listed on this page. NoLSAF will not ask you to bypass official payment or verification procedures.",
  };
}

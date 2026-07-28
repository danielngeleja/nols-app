import { prisma } from "@nolsaf/prisma";
import { normalizeSmsPhone } from "./sms.js";

export const GUEST_SMS_ANNUAL_LIMIT = 3;
export const GUEST_SMS_MAX_AUDIENCE = 5_000;
const NRMS_TIME_ZONE = "Africa/Dar_es_Salaam";

export const guestSmsAudienceTypes = [
  "SELECTED",
  "ALL_ELIGIBLE",
  "INACTIVE_90",
  "INACTIVE_180",
  "INACTIVE_365",
  "REPEAT_GUESTS",
] as const;

export type GuestSmsAudienceType = (typeof guestSmsAudienceTypes)[number];

type GuestCandidate = {
  id: number;
  fullName: string;
  phone: string | null;
  reservationCount: number;
  lastStayAt: Date | null;
};

export type GuestSmsEligibility = {
  eligible: boolean;
  reason: "ELIGIBLE" | "NO_PHONE" | "NO_CONSENT" | "OPTED_OUT" | "ANNUAL_LIMIT";
  normalizedPhone: string | null;
  consentStatus: "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";
  usedCount: number;
  remainingCount: number;
};

export function currentGuestSmsQuotaYear(now = new Date()): number {
  const year = new Intl.DateTimeFormat("en", { timeZone: NRMS_TIME_ZONE, year: "numeric" }).format(now);
  return Number(year);
}

export function canonicalGuestPhone(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const normalized = normalizeSmsPhone(phone);
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

export function matchesGuestSmsAudience(
  guest: GuestCandidate,
  audienceType: GuestSmsAudienceType,
  now = new Date(),
): boolean {
  if (audienceType === "SELECTED" || audienceType === "ALL_ELIGIBLE") return true;
  if (audienceType === "REPEAT_GUESTS") return guest.reservationCount >= 2;
  const days = Number(audienceType.split("_")[1]);
  if (!Number.isFinite(days)) return false;
  if (!guest.lastStayAt) return false;
  return guest.lastStayAt.getTime() <= now.getTime() - days * 24 * 60 * 60 * 1000;
}

export async function loadGuestSmsEligibility(
  ownerId: number,
  phones: Array<string | null | undefined>,
  year = currentGuestSmsQuotaYear(),
): Promise<Map<string, GuestSmsEligibility>> {
  const normalizedPhones = [...new Set(phones.map(canonicalGuestPhone).filter((phone): phone is string => Boolean(phone)))];
  if (normalizedPhones.length === 0) return new Map();

  const [preferences, quotas] = await Promise.all([
    prisma.guestSmsPreference.findMany({
      where: { ownerId, normalizedPhone: { in: normalizedPhones } },
      select: { normalizedPhone: true, status: true },
    }),
    prisma.guestSmsAnnualQuota.findMany({
      where: { ownerId, year, normalizedPhone: { in: normalizedPhones } },
      select: { normalizedPhone: true, usedCount: true },
    }),
  ]);

  const preferencesByPhone = new Map<string, string>(preferences.map((item) => [item.normalizedPhone, item.status]));
  const quotasByPhone = new Map<string, number>(quotas.map((item) => [item.normalizedPhone, item.usedCount]));
  const result = new Map<string, GuestSmsEligibility>();

  for (const normalizedPhone of normalizedPhones) {
    const rawStatus = preferencesByPhone.get(normalizedPhone);
    const consentStatus = rawStatus === "OPTED_IN" || rawStatus === "OPTED_OUT" ? rawStatus : "UNKNOWN";
    const usedCount = Math.max(0, quotasByPhone.get(normalizedPhone) ?? 0);
    const eligible = consentStatus === "OPTED_IN" && usedCount < GUEST_SMS_ANNUAL_LIMIT;
    const reason = consentStatus === "OPTED_OUT"
      ? "OPTED_OUT"
      : consentStatus !== "OPTED_IN"
        ? "NO_CONSENT"
        : usedCount >= GUEST_SMS_ANNUAL_LIMIT
          ? "ANNUAL_LIMIT"
          : "ELIGIBLE";
    result.set(normalizedPhone, {
      eligible,
      reason,
      normalizedPhone,
      consentStatus,
      usedCount,
      remainingCount: Math.max(0, GUEST_SMS_ANNUAL_LIMIT - usedCount),
    });
  }
  return result;
}

export function noPhoneEligibility(): GuestSmsEligibility {
  return {
    eligible: false,
    reason: "NO_PHONE",
    normalizedPhone: null,
    consentStatus: "UNKNOWN",
    usedCount: 0,
    remainingCount: 0,
  };
}

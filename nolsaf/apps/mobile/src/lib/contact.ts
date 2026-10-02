import type { OtpChannel } from "../auth/types";
import { normalizeTzPhone } from "./phone";

/**
 * One "Phone or email" field instead of a Phone/Email choice (Hick's law). The
 * app reads what was typed. Shared by sign-in and sign-up so both follow the
 * same policy:
 *  - an @ makes it an email, which must be a valid address;
 *  - otherwise it is a phone and may hold only digits, spaces, dashes and one
 *    leading +. Letters are never stripped and accepted: they make it invalid;
 *  - a Tanzanian number in any local form (0712..., 712..., 255..., +255...)
 *    must be a real mobile: +255, then 6 or 7, then 8 digits;
 *  - another country needs its full +code (9 to 15 digits).
 */

export type DetectedContact = {
  channel: OtpChannel;
  destination: { phone: string } | { email: string };
  /** The normalised value, as sent to the API. */
  value: string;
  /** Readable form for "We will text a code to ..." lines. */
  shown: string;
};

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TZ_MOBILE = /^\+255[67]\d{8}$/;

export function looksLikePhone(value: string) {
  return !value.includes("@") && /^[+\d\s-]*$/.test(value);
}

/** While typing a phone: keep one leading +, digits only, capped to the length the prefix allows. */
export function shapePhoneInput(value: string) {
  const hasPlus = value.trim().startsWith("+");
  const digits = value.replace(/\D/g, "");
  const tz = digits.startsWith("255");
  const max = hasPlus ? (tz ? 12 : 15) : tz ? 12 : digits.startsWith("0") ? 10 : 9;
  return (hasPlus ? "+" : "") + digits.slice(0, max);
}

/** What onChangeText should store: phones are shaped as typed, anything else is left alone. */
export function shapeContactInput(value: string) {
  return looksLikePhone(value) && value.trim() ? shapePhoneInput(value) : value;
}

export function detectContact(raw: string): DetectedContact | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { channel: "EMAIL", destination: { email }, value: email, shown: email } : null;
  }
  if (!looksLikePhone(value)) return null;
  const compact = value.replace(/[\s-]/g, "");
  const tz = normalizeTzPhone(compact);
  const phone = tz ? (TZ_MOBILE.test(tz) ? tz : null) : /^\+(?!255)\d{9,15}$/.test(compact) ? compact : null;
  if (!phone) return null;
  const shown = phone.startsWith("+255") ? `+255 ${phone.slice(4, 7)} ${phone.slice(7, 10)} ${phone.slice(10)}` : phone;
  return { channel: "PHONE", destination: { phone }, value: phone, shown };
}

/** The message under the field once enough has been typed and it is still not valid. */
export function contactProblem(raw: string): string | null {
  if (detectContact(raw) || raw.trim().length < 6) return null;
  if (raw.includes("@")) return "Check the email address.";
  if (looksLikePhone(raw)) return "Enter a valid mobile number, like 0712 345 678.";
  return "Enter a phone number like 0712 345 678 or an email address.";
}

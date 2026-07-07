/**
 * Tanzania phone helpers, ported from the web booking flow.
 * The API expects +255XXXXXXXXX. We accept the common local forms and
 * normalize, returning null when the number can't be a valid TZ mobile.
 */

export function normalizeTzPhone(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, "").replace(/-/g, "");
  const digits = compact.replace(/^\+/, "").replace(/\D+/g, "");

  // 9 digits => local without the leading 0 (e.g. 7XXXXXXXX)
  if (digits.length === 9) return `+255${digits}`;
  // 0XXXXXXXXX
  if (digits.length === 10 && digits.startsWith("0")) return `+255${digits.slice(1)}`;
  // 255XXXXXXXXX or +255XXXXXXXXX
  if (digits.length === 12 && digits.startsWith("255")) return `+255${digits.slice(3)}`;

  return null;
}

/** Keep typing friendly: allow digits, spaces and a single leading +. */
export function sanitizePhoneInput(value: string): string {
  const keep = String(value ?? "").replace(/[^0-9+\s-]/g, "");
  const compact = keep.replace(/-/g, " ").replace(/\s+/g, " ");
  return compact.replace(/\+/g, (m, offset) => (offset === 0 ? m : ""));
}

/**
 * Phone entry policy: keep an optional leading +, digits only, and cap to the
 * exact length a valid Tanzania mobile needs for the prefix being typed, so a
 * user can never enter a runaway string of digits.
 *   +255 / 255 + 9 digits  -> 12 digits
 *   0 + 9 digits           -> 10 digits
 *   7 + 8 digits           -> 9 digits
 */
export function capTzPhoneInput(value: string): string {
  const raw = String(value ?? "").trim();
  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(/\D/g, "");

  let max = 9;
  if (hasPlus || digits.startsWith("255")) max = 12;
  else if (digits.startsWith("0")) max = 10;

  digits = digits.slice(0, max);
  return (hasPlus ? "+" : "") + digits;
}

/**
 * Calling-code picker options, mirrored from the web register/login pages so
 * the native app offers the same "flag + dial code" selector.
 */
export const PHONE_COUNTRY_CODES: Array<{ code: string; country: string; flag: string; label: string }> = [
  // East Africa — primary markets
  { code: "+255", country: "TZ", flag: "🇹🇿", label: "Tanzania" },
  { code: "+254", country: "KE", flag: "🇰🇪", label: "Kenya" },
  { code: "+256", country: "UG", flag: "🇺🇬", label: "Uganda" },
  { code: "+250", country: "RW", flag: "🇷🇼", label: "Rwanda" },
  // East & Central Africa — expansion
  { code: "+251", country: "ET", flag: "🇪🇹", label: "Ethiopia" },
  { code: "+257", country: "BI", flag: "🇧🇮", label: "Burundi" },
  { code: "+243", country: "CD", flag: "🇨🇩", label: "DR Congo" },
  { code: "+252", country: "SO", flag: "🇸🇴", label: "Somalia" },
  { code: "+211", country: "SS", flag: "🇸🇸", label: "South Sudan" },
  // Southern Africa
  { code: "+265", country: "MW", flag: "🇲🇼", label: "Malawi" },
  { code: "+258", country: "MZ", flag: "🇲🇿", label: "Mozambique" },
  { code: "+260", country: "ZM", flag: "🇿🇲", label: "Zambia" },
  { code: "+263", country: "ZW", flag: "🇿🇼", label: "Zimbabwe" },
  { code: "+27", country: "ZA", flag: "🇿🇦", label: "South Africa" },
  // Indian Ocean & safari circuit
  { code: "+269", country: "KM", flag: "🇰🇲", label: "Comoros" },
  { code: "+248", country: "SC", flag: "🇸🇨", label: "Seychelles" },
  { code: "+230", country: "MU", flag: "🇲🇺", label: "Mauritius" },
  { code: "+267", country: "BW", flag: "🇧🇼", label: "Botswana" },
  { code: "+264", country: "NA", flag: "🇳🇦", label: "Namibia" },
  { code: "+244", country: "AO", flag: "🇦🇴", label: "Angola" },
  // West & North Africa
  { code: "+234", country: "NG", flag: "🇳🇬", label: "Nigeria" },
  { code: "+233", country: "GH", flag: "🇬🇭", label: "Ghana" },
  { code: "+221", country: "SN", flag: "🇸🇳", label: "Senegal" },
  { code: "+237", country: "CM", flag: "🇨🇲", label: "Cameroon" },
  { code: "+225", country: "CI", flag: "🇨🇮", label: "Côte d'Ivoire" },
  { code: "+249", country: "SD", flag: "🇸🇩", label: "Sudan" },
  { code: "+212", country: "MA", flag: "🇲🇦", label: "Morocco" },
  { code: "+213", country: "DZ", flag: "🇩🇿", label: "Algeria" },
  { code: "+216", country: "TN", flag: "🇹🇳", label: "Tunisia" },
  { code: "+20", country: "EG", flag: "🇪🇬", label: "Egypt" },
  // Europe — top tourism sources for East Africa
  { code: "+44", country: "GB", flag: "🇬🇧", label: "United Kingdom" },
  { code: "+49", country: "DE", flag: "🇩🇪", label: "Germany" },
  { code: "+33", country: "FR", flag: "🇫🇷", label: "France" },
  { code: "+39", country: "IT", flag: "🇮🇹", label: "Italy" },
  { code: "+31", country: "NL", flag: "🇳🇱", label: "Netherlands" },
  { code: "+34", country: "ES", flag: "🇪🇸", label: "Spain" },
  { code: "+351", country: "PT", flag: "🇵🇹", label: "Portugal" },
  { code: "+32", country: "BE", flag: "🇧🇪", label: "Belgium" },
  { code: "+41", country: "CH", flag: "🇨🇭", label: "Switzerland" },
  { code: "+43", country: "AT", flag: "🇦🇹", label: "Austria" },
  { code: "+48", country: "PL", flag: "🇵🇱", label: "Poland" },
  { code: "+420", country: "CZ", flag: "🇨🇿", label: "Czechia" },
  { code: "+353", country: "IE", flag: "🇮🇪", label: "Ireland" },
  { code: "+46", country: "SE", flag: "🇸🇪", label: "Sweden" },
  { code: "+47", country: "NO", flag: "🇳🇴", label: "Norway" },
  { code: "+45", country: "DK", flag: "🇩🇰", label: "Denmark" },
  { code: "+7", country: "RU", flag: "🇷🇺", label: "Russia" },
  { code: "+380", country: "UA", flag: "🇺🇦", label: "Ukraine" },
  { code: "+90", country: "TR", flag: "🇹🇷", label: "Turkey" },
  // Middle East
  { code: "+971", country: "AE", flag: "🇦🇪", label: "UAE" },
  { code: "+972", country: "IL", flag: "🇮🇱", label: "Israel" },
  { code: "+966", country: "SA", flag: "🇸🇦", label: "Saudi Arabia" },
  { code: "+974", country: "QA", flag: "🇶🇦", label: "Qatar" },
  { code: "+968", country: "OM", flag: "🇴🇲", label: "Oman" },
  { code: "+965", country: "KW", flag: "🇰🇼", label: "Kuwait" },
  // Asia-Pacific
  { code: "+91", country: "IN", flag: "🇮🇳", label: "India" },
  { code: "+86", country: "CN", flag: "🇨🇳", label: "China" },
  { code: "+81", country: "JP", flag: "🇯🇵", label: "Japan" },
  { code: "+82", country: "KR", flag: "🇰🇷", label: "South Korea" },
  { code: "+65", country: "SG", flag: "🇸🇬", label: "Singapore" },
  { code: "+60", country: "MY", flag: "🇲🇾", label: "Malaysia" },
  { code: "+62", country: "ID", flag: "🇮🇩", label: "Indonesia" },
  { code: "+66", country: "TH", flag: "🇹🇭", label: "Thailand" },
  { code: "+63", country: "PH", flag: "🇵🇭", label: "Philippines" },
  { code: "+92", country: "PK", flag: "🇵🇰", label: "Pakistan" },
  { code: "+61", country: "AU", flag: "🇦🇺", label: "Australia" },
  { code: "+64", country: "NZ", flag: "🇳🇿", label: "New Zealand" },
  // Americas
  { code: "+1", country: "US", flag: "🇺🇸", label: "United States / Canada" },
  { code: "+52", country: "MX", flag: "🇲🇽", label: "Mexico" },
  { code: "+55", country: "BR", flag: "🇧🇷", label: "Brazil" },
  { code: "+54", country: "AR", flag: "🇦🇷", label: "Argentina" }
];

export const DEFAULT_PHONE_COUNTRY_CODE = "+255";

/** Per-country national number length + a typing example, mirrored from the API's PHONE_RULES. */
const PHONE_RULES: Record<string, { min: number; max: number; example: string }> = {
  "+255": { min: 9, max: 9, example: "712345678" },
  "+254": { min: 9, max: 9, example: "712345678" },
  "+256": { min: 9, max: 9, example: "712345678" },
  "+250": { min: 9, max: 9, example: "788123456" },
  "+251": { min: 9, max: 9, example: "911234567" },
  "+257": { min: 8, max: 8, example: "79123456" },
  "+243": { min: 9, max: 9, example: "991234567" },
  "+252": { min: 8, max: 9, example: "612345678" },
  "+211": { min: 9, max: 9, example: "912345678" },
  "+265": { min: 9, max: 9, example: "991234567" },
  "+258": { min: 9, max: 9, example: "841234567" },
  "+260": { min: 9, max: 9, example: "971234567" },
  "+263": { min: 9, max: 9, example: "771234567" },
  "+27": { min: 9, max: 9, example: "821234567" },
  "+234": { min: 10, max: 10, example: "8012345678" },
  "+233": { min: 9, max: 9, example: "241234567" },
  "+212": { min: 9, max: 9, example: "612345678" },
  "+20": { min: 10, max: 10, example: "1012345678" },
  "+269": { min: 7, max: 7, example: "3212345" },
  "+248": { min: 7, max: 7, example: "2510123" },
  "+230": { min: 8, max: 8, example: "52512345" },
  "+267": { min: 8, max: 8, example: "71123456" },
  "+264": { min: 9, max: 9, example: "811234567" },
  "+244": { min: 9, max: 9, example: "923123456" },
  "+221": { min: 9, max: 9, example: "701234567" },
  "+237": { min: 9, max: 9, example: "671234567" },
  "+225": { min: 10, max: 10, example: "0123456789" },
  "+249": { min: 9, max: 9, example: "911231234" },
  "+213": { min: 9, max: 9, example: "551234567" },
  "+216": { min: 8, max: 8, example: "20123456" },
  "+44": { min: 10, max: 10, example: "7400123456" },
  "+49": { min: 10, max: 11, example: "15123456789" },
  "+33": { min: 9, max: 9, example: "612345678" },
  "+39": { min: 9, max: 10, example: "3123456789" },
  "+31": { min: 9, max: 9, example: "612345678" },
  "+34": { min: 9, max: 9, example: "612345678" },
  "+351": { min: 9, max: 9, example: "912345678" },
  "+32": { min: 8, max: 9, example: "470123456" },
  "+41": { min: 9, max: 9, example: "781234567" },
  "+43": { min: 10, max: 11, example: "6641234567" },
  "+48": { min: 9, max: 9, example: "512345678" },
  "+420": { min: 9, max: 9, example: "601123456" },
  "+353": { min: 9, max: 9, example: "851234567" },
  "+46": { min: 9, max: 9, example: "701234567" },
  "+47": { min: 8, max: 8, example: "40612345" },
  "+45": { min: 8, max: 8, example: "20123456" },
  "+7": { min: 10, max: 10, example: "9123456789" },
  "+380": { min: 9, max: 9, example: "501234567" },
  "+90": { min: 10, max: 10, example: "5012345678" },
  "+971": { min: 9, max: 9, example: "501234567" },
  "+972": { min: 9, max: 9, example: "501234567" },
  "+966": { min: 9, max: 9, example: "512345678" },
  "+974": { min: 8, max: 8, example: "33123456" },
  "+968": { min: 8, max: 8, example: "92123456" },
  "+965": { min: 8, max: 8, example: "50012345" },
  "+91": { min: 10, max: 10, example: "9876543210" },
  "+86": { min: 11, max: 11, example: "13800138000" },
  "+81": { min: 10, max: 10, example: "9012345678" },
  "+82": { min: 9, max: 10, example: "1012345678" },
  "+65": { min: 8, max: 8, example: "81234567" },
  "+60": { min: 9, max: 10, example: "123456789" },
  "+62": { min: 9, max: 12, example: "81234567890" },
  "+66": { min: 9, max: 9, example: "812345678" },
  "+63": { min: 10, max: 10, example: "9171234567" },
  "+92": { min: 10, max: 10, example: "3001234567" },
  "+61": { min: 9, max: 9, example: "412345678" },
  "+64": { min: 8, max: 10, example: "211234567" },
  "+1": { min: 10, max: 10, example: "2015550123" },
  "+52": { min: 10, max: 10, example: "5512345678" },
  "+55": { min: 10, max: 11, example: "11912345678" },
  "+54": { min: 10, max: 11, example: "91123456789" }
};

const DEFAULT_PHONE_RULE = { min: 6, max: 12, example: "123456789" };

export function getPhoneRule(code: string): { min: number; max: number; example: string } {
  return PHONE_RULES[code] || DEFAULT_PHONE_RULE;
}

export function getPhoneMaxLength(code: string): number {
  return getPhoneRule(code).max;
}

export function getPhonePlaceholder(code: string): string {
  return getPhoneRule(code).example;
}

export function getCountryLabel(code: string): string {
  return PHONE_COUNTRY_CODES.find((c) => c.code === code)?.label || "selected country";
}

export function getCountryFlag(code: string): string {
  return PHONE_COUNTRY_CODES.find((c) => c.code === code)?.flag || "🌍";
}

/** Digits only, capped to the selected country's max national-number length. */
export function sanitizePhoneDigits(value: string, code: string): string {
  return String(value ?? "")
    .replace(/[^0-9]/g, "")
    .slice(0, getPhoneMaxLength(code));
}

export function isPhoneLengthValid(value: string, code: string): boolean {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  const { min, max } = getPhoneRule(code);
  return digits.length >= min && digits.length <= max;
}

export function getPhoneLengthHint(code: string): string {
  const { min, max } = getPhoneRule(code);
  const country = getCountryLabel(code);
  return min === max ? `Enter ${min} digits for ${country}` : `Enter ${min}-${max} digits for ${country}`;
}

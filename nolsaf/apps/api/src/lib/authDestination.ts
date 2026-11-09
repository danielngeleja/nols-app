// apps/api/src/lib/authDestination.ts
//
// Canonical forms of the phone/email a sign-in code is sent to. The OTP store
// and every OTP rate limiter must key on these SAME forms: when the limiter
// keyed on the raw input, "0712345678", "+255712345678" and "0712-345-678"
// shared one code but each got its own fresh limit.

export function normalizePhoneForAuth(input: string): string {
  let cleaned = String(input || '').trim();
  if (!cleaned) return '';
  cleaned = cleaned.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
  if (cleaned.startsWith('+')) return cleaned;

  const defaultCallingCode = String(process.env.DEFAULT_COUNTRY_CALLING_CODE || '255').replace(/\D/g, '') || '255';
  if (cleaned.startsWith(defaultCallingCode)) return `+${cleaned}`;
  if (cleaned.startsWith('0')) return `+${defaultCallingCode}${cleaned.slice(1)}`;
  return `+${defaultCallingCode}${cleaned}`;
}

export function normalizeEmailForAuth(input: any): string | null {
  const v = String(input ?? '').trim().toLowerCase();
  if (!v || v.length > 190) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return null;
  return v;
}

/**
 * Rate-limit key for the destination named in an auth request body, using the
 * same canonical form as the OTP store. `prefer` mirrors which field the route
 * itself reads first when both are present. Returns null when the body names no
 * usable destination, so the caller can fall back to an IP key.
 */
export function authDestinationRateKey(
  body: any,
  prefer: 'phone' | 'email' = 'phone',
): string | null {
  const rawPhone = body?.phone;
  const rawEmail = body?.email;
  const phoneKey = () => {
    if (!rawPhone) return null;
    const phone = normalizePhoneForAuth(String(rawPhone));
    // "+" alone or "+255" alone carries no subscriber digits.
    return phone && /\d{4,}/.test(phone) ? `phone:${phone}` : null;
  };
  const emailKey = () => {
    if (!rawEmail) return null;
    const email = normalizeEmailForAuth(rawEmail);
    return email ? `email:${email}` : null;
  };
  if (prefer === 'email') return rawEmail ? emailKey() : phoneKey();
  return rawPhone ? phoneKey() : emailKey();
}

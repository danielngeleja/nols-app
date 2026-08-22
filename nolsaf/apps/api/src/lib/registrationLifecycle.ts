export const REGISTRATION_STATUSES = ['INCOMPLETE', 'COMPLETE'] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const REGISTRATION_SOURCES = [
  'WEB',
  'TRAVELLER_APP',
  'DRIVER_APP',
  'PARTNERS_APP',
  'LEGACY',
  'UNKNOWN',
] as const;
export type RegistrationSource = (typeof REGISTRATION_SOURCES)[number];

type RegistrationIdentity = {
  name?: unknown;
  fullName?: unknown;
  email?: unknown;
  phone?: unknown;
};

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getMissingRegistrationFields(identity: RegistrationIdentity): Array<'name' | 'email' | 'phone'> {
  const missing: Array<'name' | 'email' | 'phone'> = [];
  if (!hasText(identity.name) && !hasText(identity.fullName)) missing.push('name');
  if (!hasText(identity.email)) missing.push('email');
  if (!hasText(identity.phone)) missing.push('phone');
  return missing;
}

export function getRegistrationStatus(identity: RegistrationIdentity): RegistrationStatus {
  return getMissingRegistrationFields(identity).length === 0 ? 'COMPLETE' : 'INCOMPLETE';
}

export function normalizeRegistrationSource(value: unknown): RegistrationSource {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (normalized === 'WEB' || normalized === 'WEBSITE') return 'WEB';
  if (['TRAVELLER_APP', 'TRAVELER_APP', 'MOBILE_APP', 'IOS', 'ANDROID'].includes(normalized)) {
    return 'TRAVELLER_APP';
  }
  if (['DRIVER_APP', 'DRIVER'].includes(normalized)) return 'DRIVER_APP';
  if (['PARTNERS_APP', 'PARTNER_APP', 'OWNER_APP'].includes(normalized)) return 'PARTNERS_APP';
  if (normalized === 'LEGACY') return 'LEGACY';
  return 'UNKNOWN';
}

export function resolveRegistrationSource(input: {
  bodySource?: unknown;
  headerSource?: unknown;
  fallback?: unknown;
}): RegistrationSource {
  const body = normalizeRegistrationSource(input.bodySource);
  if (body !== 'UNKNOWN') return body;
  const header = normalizeRegistrationSource(input.headerSource);
  if (header !== 'UNKNOWN') return header;
  return normalizeRegistrationSource(input.fallback);
}

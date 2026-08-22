import { describe, expect, it } from 'vitest';
import {
  getMissingRegistrationFields,
  getRegistrationStatus,
  normalizeRegistrationSource,
  resolveRegistrationSource,
} from './registrationLifecycle.js';

describe('registration lifecycle', () => {
  it('requires full name, email, and phone before completion', () => {
    expect(getRegistrationStatus({ name: 'Morenious Mushongi', email: 'guest@example.com' })).toBe('INCOMPLETE');
    expect(getMissingRegistrationFields({ name: 'Morenious Mushongi', email: 'guest@example.com' })).toEqual(['phone']);
    expect(getRegistrationStatus({ fullName: 'Morenious Mushongi', email: 'guest@example.com', phone: '+255700000000' })).toBe('COMPLETE');
  });

  it('normalizes known web and application sources without trusting arbitrary values', () => {
    expect(normalizeRegistrationSource('website')).toBe('WEB');
    expect(normalizeRegistrationSource('android')).toBe('TRAVELLER_APP');
    expect(normalizeRegistrationSource('driver-app')).toBe('DRIVER_APP');
    expect(normalizeRegistrationSource('made-up-client')).toBe('UNKNOWN');
  });

  it('prefers an explicit body source and then the client header', () => {
    expect(resolveRegistrationSource({ bodySource: 'web', headerSource: 'android' })).toBe('WEB');
    expect(resolveRegistrationSource({ headerSource: 'android' })).toBe('TRAVELLER_APP');
  });
});

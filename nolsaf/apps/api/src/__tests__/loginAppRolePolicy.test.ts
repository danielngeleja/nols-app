import { describe, expect, it } from 'vitest';
import {
  getLoginAppRoleError,
  normalizeLoginAppContext,
} from '../lib/loginAppRolePolicy.js';

describe('loginAppRolePolicy', () => {
  it.each(['CUSTOMER', 'OWNER', 'AGENT', 'NRMS_AGENT', 'DRIVER', 'ADMIN'])(
    'allows %s through the unified web gate when no native app context is sent',
    (role) => {
      expect(getLoginAppRoleError(role, undefined)).toBeNull();
      expect(getLoginAppRoleError(role, null)).toBeNull();
      expect(getLoginAppRoleError(role, 'WEB')).toBeNull();
    },
  );

  it.each([
    ['CUSTOMER_APP', 'CUSTOMER'],
    ['DRIVER_APP', 'DRIVER'],
    ['PARTNERS_APP', 'OWNER'],
    ['PARTNERS_APP', 'AGENT'],
    ['PARTNERS_APP', 'NRMS_AGENT'],
    ['ADMIN_APP', 'ADMIN'],
  ])('allows explicit %s access for the matching %s role', (loginApp, role) => {
    expect(getLoginAppRoleError(role, loginApp)).toBeNull();
  });

  it('keeps explicit native app contexts role-restricted', () => {
    expect(getLoginAppRoleError('CUSTOMER', 'DRIVER_APP')).toMatchObject({
      code: 'WRONG_LOGIN_APP',
      action: 'use_customer_account',
    });
    expect(getLoginAppRoleError('ADMIN', 'PARTNERS_APP')).toMatchObject({
      code: 'WRONG_LOGIN_APP',
      action: 'use_admin_portal',
    });
  });

  it('does not treat an unknown or web context as a native app gate', () => {
    expect(normalizeLoginAppContext('WEB')).toBeNull();
    expect(normalizeLoginAppContext('unknown')).toBeNull();
  });
});

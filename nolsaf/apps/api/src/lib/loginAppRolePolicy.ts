export type LoginAppContext = 'DRIVER' | 'PARTNERS' | 'CUSTOMER' | 'ADMIN' | null;

export type LoginAppRoleError = {
  error: string;
  code: string;
  message: string;
  action: string;
};

export function normalizeAccountRole(input: unknown): string {
  const value = String(input ?? '').trim().toUpperCase();
  if (value === 'TRAVELLER' || value === 'TRAVELER' || value === 'USER') return 'CUSTOMER';
  return value;
}

export function normalizeLoginAppContext(input: unknown): LoginAppContext {
  const value = String(input ?? '').trim().toUpperCase();

  // The website has one shared login gate for every account role. Native apps
  // pass an explicit app context; WEB must never become a customer-only gate.
  if (!value || value === 'WEB') return null;

  if (value === 'ADMIN' || value === 'ADMIN_APP') return 'ADMIN';
  if (value === 'DRIVER' || value === 'DRIVER_APP') return 'DRIVER';
  if (
    value === 'PARTNER' ||
    value === 'PARTNERS' ||
    value === 'PARTNERS_APP' ||
    value === 'OWNER' ||
    value === 'AGENT'
  ) {
    return 'PARTNERS';
  }
  if (value === 'CUSTOMER' || value === 'CUSTOMER_APP') return 'CUSTOMER';
  return null;
}

export function getLoginAppRoleError(
  accountRoleInput: unknown,
  loginAppInput: unknown,
): LoginAppRoleError | null {
  const loginApp = normalizeLoginAppContext(loginAppInput);
  if (!loginApp) return null;

  const accountRole = normalizeAccountRole(accountRoleInput);
  const allowed =
    loginApp === 'DRIVER' ? accountRole === 'DRIVER' :
    loginApp === 'PARTNERS' ? accountRole === 'OWNER' || accountRole === 'AGENT' :
    loginApp === 'ADMIN' ? accountRole === 'ADMIN' :
    accountRole === 'CUSTOMER';

  if (allowed) return null;

  if (accountRole === 'ADMIN') {
    return {
      error: 'wrong_login_app',
      code: 'WRONG_LOGIN_APP',
      message: 'This account is registered as an admin. Please sign in with the NoLSAF Admin portal.',
      action: 'use_admin_portal',
    };
  }

  if (accountRole === 'DRIVER') {
    return {
      error: 'wrong_login_app',
      code: 'WRONG_LOGIN_APP',
      message: 'This account is registered as a driver. Please sign in with the NoLSAF Driver app.',
      action: 'use_driver_app',
    };
  }

  if (accountRole === 'OWNER' || accountRole === 'AGENT') {
    return {
      error: 'wrong_login_app',
      code: 'WRONG_LOGIN_APP',
      message: 'This account is registered for NoLSAF Partners. Please sign in with the NoLSAF Partners app.',
      action: 'use_partners_app',
    };
  }

  return {
    error: 'wrong_login_app',
    code: 'WRONG_LOGIN_APP',
    message: 'This account is registered as a traveller. Please sign in from the main NoLSAF account app or website.',
    action: 'use_customer_account',
  };
}

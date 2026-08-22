import { apiRequest } from "../lib/apiClient";
import {
  AuthUser,
  CompleteOtpProfileInput,
  ConfirmContactChangeResponse,
  ContactField,
  LoginResponse,
  OtpDestination,
  RegisterCustomerInput,
  RequestContactChangeResponse,
  ResetPasswordResponse,
  SendOtpResponse,
  UpdateProfileInput,
  VerifyOtpResponse
} from "./types";

export async function loginWithPassword(email: string, password: string) {
  return apiRequest<LoginResponse>("/api/auth/login-password", {
    method: "POST",
    body: { email, password }
  });
}

/**
 * Sends a 6-digit OTP to the given phone or email.
 * Pass role "CUSTOMER" for registration, "RESET" for forgot-password, or omit for login OTP.
 */
export async function sendOtp(destination: OtpDestination, role?: "CUSTOMER" | "RESET") {
  return apiRequest<SendOtpResponse>("/api/auth/send-otp", {
    method: "POST",
    body: { ...destination, ...(role ? { role } : {}), ...(role === "CUSTOMER" ? { registrationSource: "TRAVELLER_APP" } : {}) }
  });
}

/** Verifies the OTP. On success returns a session token and the user. */
export async function verifyOtp(destination: OtpDestination, otp: string, role?: "CUSTOMER" | "RESET") {
  return apiRequest<VerifyOtpResponse>("/api/auth/verify-otp", {
    method: "POST",
    body: { ...destination, otp, ...(role ? { role } : {}), ...(role === "CUSTOMER" ? { registrationSource: "TRAVELLER_APP" } : {}) }
  });
}

/** Sets a new password using the reset token returned by verifyOtp(destination, otp, "RESET"). */
export async function resetPassword(userId: number, token: string, password: string) {
  return apiRequest<ResetPasswordResponse>("/api/auth/reset-password", {
    method: "POST",
    body: { userId, token, password }
  });
}

/** Completes the post-OTP registration profile (name, optional password/email). */
export async function completeOtpProfile(token: string, input: CompleteOtpProfileInput) {
  return apiRequest<{ ok?: boolean; message?: string; error?: string; user?: AuthUser }>("/api/auth/profile", {
    method: "POST",
    token,
    body: { role: "CUSTOMER", registrationSource: "TRAVELLER_APP", ...input }
  });
}

export async function registerCustomer(input: RegisterCustomerInput) {
  return apiRequest<{ ok: boolean; id: number; email: string; role: string; message?: string; error?: string }>("/api/auth/register", {
    method: "POST",
    body: {
      ...input,
      role: "CUSTOMER",
      registrationSource: "TRAVELLER_APP"
    }
  });
}

export async function getCurrentAccount(token: string) {
  // The endpoint wraps the account as { ok: true, data: {...} }. Unwrap it,
  // tolerating an unwrapped shape too, so the rest of the app gets a real user.
  const res = await apiRequest<{ data?: AuthUser } & Partial<AuthUser>>("/api/account/me", { token });
  return ((res && typeof res === "object" && "data" in res && res.data ? res.data : res) as AuthUser);
}

export async function updateAccountProfile(token: string, input: UpdateProfileInput) {
  return apiRequest<{ ok: boolean; message?: string }>("/api/account/profile", {
    method: "PUT",
    token,
    body: input
  });
}

/** Sends a verification code to a new phone/email before it can replace the current one. */
export async function requestContactChange(token: string, field: ContactField, value: string) {
  return apiRequest<RequestContactChangeResponse>("/api/account/contact/request-change", {
    method: "POST",
    token,
    body: { field, value }
  });
}

/** Confirms a pending phone/email change using the code sent by requestContactChange. */
export async function confirmContactChange(token: string, field: ContactField, otp: string) {
  return apiRequest<ConfirmContactChangeResponse>("/api/account/contact/confirm-change", {
    method: "POST",
    token,
    body: { field, otp }
  });
}

export async function logoutSession(token: string | null) {
  return apiRequest<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
    token
  });
}

export async function changeAccountPassword(token: string, input: { currentPassword: string; newPassword: string }) {
  return apiRequest<{ ok?: boolean; message?: string; data?: { forceLogout?: boolean; cooldownUntil?: number } }>("/api/account/password/change", {
    method: "POST",
    token,
    body: input
  });
}

export type Account2faStatus = {
  totpEnabled?: boolean;
  smsEnabled?: boolean;
  phone?: string | null;
};

export async function fetchAccount2faStatus(token: string) {
  return apiRequest<Account2faStatus>("/api/account/security/2fa", { token });
}

export async function provisionAccountTotp(token: string) {
  return apiRequest<{ qr?: string | null; secret?: string | null; otpauth?: string | null }>("/api/account/security/2fa/provision?type=totp", { token });
}

export async function updateAccount2fa(token: string, input: { action: "enable" | "disable"; code: string; secret?: string }) {
  return apiRequest<{ ok?: boolean; backupCodes?: string[] }>("/api/account/security/2fa", {
    method: "POST",
    token,
    body: { type: "totp", ...input }
  });
}

export type AccountPasskey = {
  id: string;
  name?: string | null;
  createdAt?: string | null;
};

export async function fetchAccountPasskeys(token: string) {
  return apiRequest<{ items?: AccountPasskey[] }>("/api/account/security/passkeys", { token });
}

export async function deleteAccountPasskey(token: string, id: string) {
  return apiRequest<{ ok?: boolean }>(`/api/account/security/passkeys/${encodeURIComponent(id)}`, {
    method: "DELETE",
    token
  });
}

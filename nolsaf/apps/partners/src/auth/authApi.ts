import { apiRequest } from "@nolsaf/native-ui";

import { AgentMe, AuthUser, LoginResponse } from "./types";

// Partners reuses the shared account auth: the same endpoints the customer and
// driver apps use. There is no separate partner login. The role on the returned
// account decides which dashboard the gate renders.

export async function loginWithPassword(email: string, password: string) {
  return apiRequest<LoginResponse>("/api/auth/login-password", {
    method: "POST",
    body: { email, password }
  });
}

export async function getCurrentAccount(token: string) {
  // /api/account/me wraps the account as { ok: true, data: {...} }. Unwrap it,
  // tolerating an already unwrapped shape.
  const res = await apiRequest<{ data?: AuthUser } & Partial<AuthUser>>("/api/account/me", { token });
  return ((res && typeof res === "object" && "data" in res && res.data ? res.data : res) as AuthUser);
}

// Operator only. Returns the agent context, or throws an ApiError whose
// payload.error is "AGENT_SUSPENDED" (status 403) when the operator is
// suspended, which the role gate turns into the suspended state.
export async function getAgentMe(token: string) {
  return apiRequest<AgentMe>("/api/agent/me", { token });
}

export async function logoutSession(token: string | null) {
  return apiRequest<{ ok: boolean }>("/api/auth/logout", {
    method: "POST",
    token
  });
}

export async function sendOwnerSignupOtp(phone: string) {
  return apiRequest<{ ok?: boolean; message?: string }>("/api/auth/send-otp", {
    method: "POST",
    body: { phone, role: "owner", registrationSource: "PARTNERS_APP" }
  });
}

export async function verifyOwnerSignupOtp(phone: string, otp: string) {
  return apiRequest<LoginResponse>("/api/auth/verify-otp", {
    method: "POST",
    body: { phone, otp, role: "owner", registrationSource: "PARTNERS_APP" }
  });
}

export async function completeOwnerSignupProfile(
  token: string,
  input: { name: string; email: string; phone: string; password?: string }
) {
  return apiRequest<{ ok?: boolean; message?: string; error?: string; user?: AuthUser }>("/api/auth/profile", {
    method: "POST",
    token,
    body: { role: "owner", registrationSource: "PARTNERS_APP", ...input }
  });
}

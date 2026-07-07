export type UserRole = "CUSTOMER" | "USER" | "TRAVELLER" | "OWNER" | "DRIVER" | "AGENT" | "ADMIN" | string;

export type AuthUser = {
  id: number;
  role: UserRole;
  email?: string | null;
  name?: string | null;
  fullName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  address?: string | null;
  tin?: string | null;
  gender?: string | null;
  nationality?: string | null;
  twoFactorEnabled?: boolean | null;
  emailVerifiedAt?: string | null;
  phoneVerifiedAt?: string | null;
  createdAt?: string | null;
};

export type LoginResponse = {
  ok: boolean;
  token?: string;
  user?: AuthUser;
  error?: string;
  message?: string;
};

export type RegisterCustomerInput = {
  name: string;
  email: string;
  phone?: string;
  password: string;
  referralCode?: string;
};

export type UpdateProfileInput = {
  fullName?: string;
  name?: string;
  avatarUrl?: string;
  address?: string;
  tin?: string;
  gender?: string;
  nationality?: string;
};

export type ContactField = "phone" | "email";

export type RequestContactChangeResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  /** Returned by the API in development builds only. */
  otp?: string;
};

export type ConfirmContactChangeResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  data?: { user?: AuthUser };
};

export type AuthState = {
  status: "loading" | "guest" | "authenticated";
  token: string | null;
  user: AuthUser | null;
  error: string | null;
};

export type OtpChannel = "PHONE" | "EMAIL";

/** Destination for an OTP request: exactly one of phone/email should be set. */
export type OtpDestination = {
  phone?: string;
  email?: string;
};

export type SendOtpResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  channel?: OtpChannel;
  /** Returned by the API in development builds only. */
  otp?: string;
};

export type VerifyOtpResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
  token?: string;
  user?: AuthUser;
  /** Returned when verifying with role "RESET" — pass to /api/auth/reset-password. */
  resetToken?: string;
};

export type ResetPasswordResponse = {
  ok?: boolean;
  message?: string;
  error?: string;
};

export type CompleteOtpProfileInput = {
  name: string;
  password?: string;
  email?: string;
  referralCode?: string;
};

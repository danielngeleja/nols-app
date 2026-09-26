import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { signInWithNativePasskey } from "@nolsaf/native-ui";

import { clearStoredToken, getStoredToken, storeToken } from "./secureSession";
import { getCurrentAccount, loginWithPassword, logoutSession, registerCustomer, updateAccountProfile } from "./authApi";
import { AccountMfaChallenge, AuthState, AuthUser, isAccountMfaChallenge, RegisterCustomerInput, UpdateProfileInput } from "./types";
import { ApiError, configureUnauthorizedHandler } from "../lib/apiClient";

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<AccountMfaChallenge | null>;
  signInWithPasskey: () => Promise<void>;
  signUpCustomer: (input: RegisterCustomerInput) => Promise<void>;
  /** Adopts a session token obtained from a successful OTP verification. */
  completeOtpSignIn: (token: string, fallbackUser?: AuthUser) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
const WRONG_APP_MESSAGE = "This app is for NoLSAF travellers. Please sign in with a traveller account.";

function isTravellerRole(role: unknown) {
  const normalized = String(role ?? "").trim().toUpperCase();
  return normalized === "CUSTOMER" || normalized === "USER" || normalized === "TRAVELLER" || normalized === "TRAVELER";
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    token: null,
    user: null,
    error: null
  });

  const applyAuthenticatedState = useCallback((token: string, user: AuthUser) => {
    setState({
      status: "authenticated",
      token,
      user,
      error: null
    });
  }, []);

  const becomeGuest = useCallback((error: string | null = null) => {
    setState({
      status: "guest",
      token: null,
      user: null,
      error
    });
  }, []);

  const forceSignOutForExpiredSession = useCallback(
    async (error: ApiError) => {
      await clearStoredToken();
      const payload = error.payload as { code?: unknown } | null | undefined;
      const code = typeof payload?.code === "string" ? payload.code : null;
      becomeGuest(code === "SESSION_REVOKED" ? "Your session was signed out. Please sign in again." : SESSION_EXPIRED_MESSAGE);
    },
    [becomeGuest]
  );

  useEffect(() => {
    configureUnauthorizedHandler(forceSignOutForExpiredSession);
    return () => configureUnauthorizedHandler(null);
  }, [forceSignOutForExpiredSession]);

  const bootstrap = useCallback(async () => {
    try {
      const token = await getStoredToken();
      if (!token) {
        becomeGuest(null);
        return;
      }

      const user = await getCurrentAccount(token);
      if (!isTravellerRole(user.role)) {
        await clearStoredToken();
        becomeGuest(WRONG_APP_MESSAGE);
        return;
      }
      applyAuthenticatedState(token, user);
    } catch {
      await clearStoredToken();
      becomeGuest(null);
    }
  }, [applyAuthenticatedState, becomeGuest]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setState((current) => ({ ...current, error: null }));
      const response = await loginWithPassword(email, password);
      if (isAccountMfaChallenge(response)) return response;
      const token = response.token;
      const loginUser = response.user;

      if (!response.ok || !token || !loginUser) {
        throw new Error(response.message || response.error || "Login failed.");
      }

      let profile = loginUser;
      try {
        profile = await getCurrentAccount(token);
      } catch {
        // Fall back to the login payload, then still enforce the app role.
      }
      if (!isTravellerRole(profile.role)) {
        await clearStoredToken();
        becomeGuest(WRONG_APP_MESSAGE);
        return null;
      }
      await storeToken(token);
      applyAuthenticatedState(token, profile);
      return null;
    },
    [applyAuthenticatedState, becomeGuest]
  );

  const signUpCustomer = useCallback(
    async (input: RegisterCustomerInput) => {
      const response = await registerCustomer(input);
      if (!response.ok) {
        throw new Error(response.message || response.error || "Registration failed.");
      }
      await signIn(input.email, input.password);
    },
    [signIn]
  );

  const completeOtpSignIn = useCallback(
    async (token: string, fallbackUser?: AuthUser) => {
      let profile = fallbackUser;
      try {
        profile = await getCurrentAccount(token);
      } catch (err) {
        if (!fallbackUser) throw err;
      }

      if (!profile || !isTravellerRole(profile.role)) {
        await clearStoredToken();
        becomeGuest(WRONG_APP_MESSAGE);
        return;
      }

      await storeToken(token);
      applyAuthenticatedState(token, profile);
    },
    [applyAuthenticatedState, becomeGuest]
  );

  const signInWithPasskey = useCallback(async () => {
    setState((current) => ({ ...current, error: null }));
    const response = await signInWithNativePasskey<AuthUser>("CUSTOMER");
    const token = response.token;
    const loginUser = response.user;

    if (!response.ok || !token || !loginUser) {
      throw new Error(response.message || response.error || "Passkey sign-in failed.");
    }

    let profile = loginUser;
    try {
      profile = await getCurrentAccount(token);
    } catch {
      // Fall back to the passkey payload, then still enforce the app role.
    }
    if (!isTravellerRole(profile.role)) {
      await clearStoredToken();
      becomeGuest(WRONG_APP_MESSAGE);
      return;
    }
    await storeToken(token);
    applyAuthenticatedState(token, profile);
  }, [applyAuthenticatedState, becomeGuest]);

  const signOut = useCallback(async () => {
    const token = state.token;
    try {
      await logoutSession(token);
    } catch {
      // Local secure storage still must be cleared even if the network request fails.
    }
    await clearStoredToken();
    becomeGuest(null);
  }, [becomeGuest, state.token]);

  const refreshProfile = useCallback(async () => {
    if (!state.token) return;
    const user = await getCurrentAccount(state.token);
    applyAuthenticatedState(state.token, user);
  }, [applyAuthenticatedState, state.token]);

  const updateProfile = useCallback(
    async (input: UpdateProfileInput) => {
      if (!state.token) {
        throw new Error("No active session.");
      }
      await updateAccountProfile(state.token, input);
      const user = await getCurrentAccount(state.token);
      applyAuthenticatedState(state.token, user);
    },
    [applyAuthenticatedState, state.token]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signInWithPasskey,
      signUpCustomer,
      completeOtpSignIn,
      signOut,
      refreshProfile,
      updateProfile
    }),
    [completeOtpSignIn, refreshProfile, signIn, signInWithPasskey, signOut, signUpCustomer, state, updateProfile]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}

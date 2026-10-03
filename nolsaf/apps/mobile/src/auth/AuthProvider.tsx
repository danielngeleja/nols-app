import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { signInWithNativePasskey } from "@nolsaf/native-ui";

import { clearStoredToken, getStoredToken, storeToken } from "./secureSession";
import { getCurrentAccount, loginWithPassword, logoutSession, registerCustomer, updateAccountProfile, verifyAccountMfa } from "./authApi";
import { AccountMfaChallenge, AuthState, AuthUser, RegisterCustomerInput, UpdateProfileInput } from "./types";
import { ApiError, setUnauthorizedHandler } from "../lib/apiClient";

/** A sign-in held at the authenticator step (the account has 2FA turned on). */
export type PendingMfa = { challengeId: string; expiresAt: number };

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signInWithPasskey: () => Promise<void>;
  signUpCustomer: (input: RegisterCustomerInput) => Promise<void>;
  /** Adopts a session token obtained from a successful OTP verification. */
  completeOtpSignIn: (token: string, fallbackUser?: AuthUser) => Promise<void>;
  /** Set when a sign-in needs an authenticator or backup code before it finishes. */
  pendingMfa: PendingMfa | null;
  /** Holds a sign-in at the authenticator step; true when the response asked for it. */
  beginMfaChallenge: (response: AccountMfaChallenge) => boolean;
  /** Finishes a held sign-in with a 6-digit authenticator code or a backup code. */
  verifyMfa: (code: string, useBackupCode: boolean) => Promise<void>;
  cancelMfa: () => void;
  /** Swaps in a fresh session the API issued (e.g. right after turning on the authenticator). */
  replaceSession: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (input: UpdateProfileInput) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

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

  const bootstrap = useCallback(async () => {
    try {
      const token = await getStoredToken();
      if (!token) {
        becomeGuest(null);
        return;
      }

      const user = await getCurrentAccount(token);
      applyAuthenticatedState(token, user);
    } catch {
      await clearStoredToken();
      becomeGuest(null);
    }
  }, [applyAuthenticatedState, becomeGuest]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const [pendingMfa, setPendingMfa] = useState<PendingMfa | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(async ({ code }) => {
      await clearStoredToken();
      becomeGuest(
        code === "MFA_REQUIRED"
          ? "Your account now uses an authenticator app. Sign in again and enter its code."
          : "Your session ended. Please sign in again."
      );
    });
    return () => setUnauthorizedHandler(null);
  }, [becomeGuest]);

  /** Stores a new session and loads the full profile, falling back to the sign-in user. */
  const adoptSession = useCallback(
    async (token: string, fallbackUser?: AuthUser) => {
      await storeToken(token);
      try {
        const profile = await getCurrentAccount(token);
        applyAuthenticatedState(token, profile);
      } catch (err) {
        if (fallbackUser) {
          applyAuthenticatedState(token, fallbackUser);
          return;
        }
        throw err;
      }
    },
    [applyAuthenticatedState]
  );

  const beginMfaChallenge = useCallback((response: AccountMfaChallenge) => {
    if (!response?.mfaRequired || !response.challengeId) return false;
    setPendingMfa({
      challengeId: response.challengeId,
      expiresAt: Date.now() + Math.max(30, Number(response.expiresInSeconds) || 300) * 1000
    });
    return true;
  }, []);

  const cancelMfa = useCallback(() => setPendingMfa(null), []);

  const verifyMfa = useCallback(
    async (code: string, useBackupCode: boolean) => {
      if (!pendingMfa) throw new Error("Sign in again to verify your account.");
      try {
        const response = await verifyAccountMfa(pendingMfa.challengeId, code.trim(), useBackupCode);
        if (!response.token) throw new Error(response.message || "Verification failed. Please try again.");
        await adoptSession(response.token, response.user);
        setPendingMfa(null);
      } catch (err) {
        // Expired, changed, or out of attempts: this challenge is spent, start the sign-in again.
        const reason = ((err as ApiError)?.payload as { code?: string } | undefined)?.code;
        if (reason === "MFA_EXPIRED" || reason === "MFA_ACCOUNT_CHANGED" || reason === "MFA_UNAVAILABLE") setPendingMfa(null);
        throw err;
      }
    },
    [adoptSession, pendingMfa]
  );

  const replaceSession = useCallback((token: string) => adoptSession(token), [adoptSession]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setState((current) => ({ ...current, error: null }));
      const response = await loginWithPassword(email, password);
      if (beginMfaChallenge(response)) return;
      const token = response.token;
      const loginUser = response.user;

      if (!response.ok || !token || !loginUser) {
        throw new Error(response.message || response.error || "Login failed.");
      }

      await adoptSession(token, loginUser);
    },
    [adoptSession, beginMfaChallenge]
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
    (token: string, fallbackUser?: AuthUser) => adoptSession(token, fallbackUser),
    [adoptSession]
  );

  const signInWithPasskey = useCallback(async () => {
    setState((current) => ({ ...current, error: null }));
    const response = await signInWithNativePasskey<AuthUser>();
    if (beginMfaChallenge(response as AccountMfaChallenge)) return;
    const token = response.token;
    const loginUser = response.user;

    if (!response.ok || !token || !loginUser) {
      throw new Error(response.message || response.error || "Passkey sign-in failed.");
    }

    await adoptSession(token, loginUser);
  }, [adoptSession, beginMfaChallenge]);

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
      pendingMfa,
      beginMfaChallenge,
      verifyMfa,
      cancelMfa,
      replaceSession,
      signOut,
      refreshProfile,
      updateProfile
    }),
    [
      beginMfaChallenge,
      cancelMfa,
      completeOtpSignIn,
      pendingMfa,
      refreshProfile,
      replaceSession,
      signIn,
      signInWithPasskey,
      signOut,
      signUpCustomer,
      state,
      updateProfile,
      verifyMfa
    ]
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

import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { signInWithNativePasskey } from "@nolsaf/native-ui";

import { clearStoredToken, getStoredToken, storeToken } from "./secureSession";
import { getCurrentAccount, loginWithPassword, logoutSession, registerCustomer, updateAccountProfile } from "./authApi";
import { AuthState, AuthUser, RegisterCustomerInput, UpdateProfileInput } from "./types";

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signInWithPasskey: () => Promise<void>;
  signUpCustomer: (input: RegisterCustomerInput) => Promise<void>;
  /** Adopts a session token obtained from a successful OTP verification. */
  completeOtpSignIn: (token: string, fallbackUser?: AuthUser) => Promise<void>;
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

  const signIn = useCallback(
    async (email: string, password: string) => {
      setState((current) => ({ ...current, error: null }));
      const response = await loginWithPassword(email, password);
      const token = response.token;
      const loginUser = response.user;

      if (!response.ok || !token || !loginUser) {
        throw new Error(response.message || response.error || "Login failed.");
      }

      await storeToken(token);

      try {
        const profile = await getCurrentAccount(token);
        applyAuthenticatedState(token, profile);
      } catch {
        applyAuthenticatedState(token, loginUser);
      }
    },
    [applyAuthenticatedState]
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

  const signInWithPasskey = useCallback(async () => {
    setState((current) => ({ ...current, error: null }));
    const response = await signInWithNativePasskey<AuthUser>();
    const token = response.token;
    const loginUser = response.user;

    if (!response.ok || !token || !loginUser) {
      throw new Error(response.message || response.error || "Passkey sign-in failed.");
    }

    await storeToken(token);
    try {
      const profile = await getCurrentAccount(token);
      applyAuthenticatedState(token, profile);
    } catch {
      applyAuthenticatedState(token, loginUser);
    }
  }, [applyAuthenticatedState]);

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

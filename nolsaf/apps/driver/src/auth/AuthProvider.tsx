import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { signInWithNativePasskey } from "@nolsaf/native-ui";

import { getCurrentAccount, loginWithPassword, logoutSession } from "./authApi";
import { clearStoredToken, getStoredToken, storeToken } from "./secureSession";
import { AuthState, AuthUser } from "./types";

const WRONG_APP_MESSAGE = "This app is for NoLSAF drivers. Use the NoLSAF customer app or website instead.";

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signInWithPasskey: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
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
      if (String(user.role).toUpperCase() !== "DRIVER") {
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
      const token = response.token;
      const loginUser = response.user;

      if (!response.ok || !token || !loginUser) {
        throw new Error(response.message || response.error || "Login failed.");
      }

      const profile = await getCurrentAccount(token).catch(() => loginUser);

      if (String(profile.role).toUpperCase() !== "DRIVER") {
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
    const response = await signInWithNativePasskey<AuthUser>();
    const token = response.token;
    const loginUser = response.user;

    if (!response.ok || !token || !loginUser) {
      throw new Error(response.message || response.error || "Passkey sign-in failed.");
    }

    const profile = await getCurrentAccount(token).catch(() => loginUser);
    if (String(profile.role).toUpperCase() !== "DRIVER") {
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

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signIn,
      signInWithPasskey,
      signOut,
      refreshProfile
    }),
    [refreshProfile, signIn, signInWithPasskey, signOut, state]
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

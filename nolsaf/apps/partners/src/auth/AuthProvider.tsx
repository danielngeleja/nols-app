import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { signInWithNativePasskey } from "@nolsaf/native-ui";

import { getCurrentAccount, loginWithPassword, logoutSession } from "./authApi";
import { clearStoredToken, getStoredToken, storeToken } from "./secureSession";
import { AuthState, AuthUser } from "./types";

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signInWithPasskey: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// Mirrors the customer app AuthProvider (bootstrap from secure storage, password
// login, logout), trimmed to what Partners needs. Registration and OTP are not
// part of Partners: owners and operators already hold accounts. The role gate
// (see RoleGateScreen) sits on top of the "authenticated" state.
export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({
    status: "loading",
    token: null,
    user: null,
    error: null
  });

  const applyAuthenticated = useCallback((token: string, user: AuthUser) => {
    setState({ status: "authenticated", token, user, error: null });
  }, []);

  const becomeGuest = useCallback((error: string | null = null) => {
    setState({ status: "guest", token: null, user: null, error });
  }, []);

  const bootstrap = useCallback(async () => {
    try {
      const token = await getStoredToken();
      if (!token) {
        becomeGuest(null);
        return;
      }
      const user = await getCurrentAccount(token);
      applyAuthenticated(token, user);
    } catch {
      await clearStoredToken();
      becomeGuest(null);
    }
  }, [applyAuthenticated, becomeGuest]);

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
        applyAuthenticated(token, profile);
      } catch {
        applyAuthenticated(token, loginUser);
      }
    },
    [applyAuthenticated]
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
      applyAuthenticated(token, profile);
    } catch {
      applyAuthenticated(token, loginUser);
    }
  }, [applyAuthenticated]);

  const signOut = useCallback(async () => {
    const token = state.token;
    try {
      await logoutSession(token);
    } catch {
      // Local secure storage must still be cleared even if the network fails.
    }
    await clearStoredToken();
    becomeGuest(null);
  }, [becomeGuest, state.token]);

  const refreshProfile = useCallback(async () => {
    if (!state.token) return;
    const user = await getCurrentAccount(state.token);
    applyAuthenticated(state.token, user);
  }, [applyAuthenticated, state.token]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signIn, signInWithPasskey, signOut, refreshProfile }),
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

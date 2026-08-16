import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";

import { useAuth } from "../auth";
import { authenticateLock, getLockCapability, isAppLockEnabled, setAppLockEnabledFlag } from "../lib/appLock";

/**
 * How long the app may sit in the background before it re-locks on return. Short
 * enough that handing over an unlocked phone re-triggers the gate, long enough
 * that a quick hop to another app (for example fetching a bank OTP) does not
 * demand a fresh unlock.
 */
const RELOCK_AFTER_MS = 30_000;

type AppLockValue = {
  /** App Lock is turned on and the device can enforce it. */
  enabled: boolean;
  /** The device can lock at all (biometric or passcode enrolled). */
  supported: boolean;
  /** A biometric (fingerprint / face) is available, not just a passcode. */
  biometric: boolean;
  /** Currently blocking the app pending an unlock. */
  locked: boolean;
  /** Initial capability/flag load has completed. */
  ready: boolean;
  /** Prompt the OS to unlock. Resolves true on success. */
  unlock: () => Promise<boolean>;
  /** Turn App Lock on (confirms with a biometric/passcode check). Resolves true on success. */
  enable: () => Promise<boolean>;
  /** Turn App Lock off (confirms with a biometric/passcode check first). */
  disable: () => Promise<void>;
};

const AppLockContext = createContext<AppLockValue | null>(null);

export function AppLockProvider({ children }: PropsWithChildren) {
  const { status } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);
  const [biometric, setBiometric] = useState(false);
  const [ready, setReady] = useState(false);
  // Assume locked until we learn otherwise. The gate only shows the lock screen
  // once the user is authenticated, so this never blocks the login screen.
  const [locked, setLocked] = useState(true);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [savedEnabled, capability] = await Promise.all([isAppLockEnabled(), getLockCapability()]);
      if (!active) return;
      const effective = savedEnabled && capability.supported;
      setSupported(capability.supported);
      setBiometric(capability.biometric);
      setEnabled(effective);
      // If a session is restored silently on cold start, require an unlock.
      setLocked(effective);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  // Nothing to protect while signed out: never trap the login screen behind a lock.
  useEffect(() => {
    if (status === "guest") setLocked(false);
  }, [status]);

  // Re-lock after a meaningful spell in the background.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (next === "background" || next === "inactive") {
        if (backgroundedAt.current == null) backgroundedAt.current = Date.now();
        return;
      }
      if (next === "active") {
        const since = backgroundedAt.current;
        backgroundedAt.current = null;
        if (enabled && since != null && Date.now() - since >= RELOCK_AFTER_MS) {
          setLocked(true);
        }
      }
    });
    return () => subscription.remove();
  }, [enabled]);

  const unlock = useCallback(async () => {
    const ok = await authenticateLock("Unlock NoLSAF");
    if (ok) setLocked(false);
    return ok;
  }, []);

  const enable = useCallback(async () => {
    const capability = await getLockCapability();
    if (!capability.supported) return false;
    const ok = await authenticateLock("Confirm to turn on App Lock");
    if (!ok) return false;
    await setAppLockEnabledFlag(true);
    setSupported(true);
    setBiometric(capability.biometric);
    setEnabled(true);
    setLocked(false);
    return true;
  }, []);

  const disable = useCallback(async () => {
    const ok = await authenticateLock("Confirm to turn off App Lock");
    if (!ok) return;
    await setAppLockEnabledFlag(false);
    setEnabled(false);
    setLocked(false);
  }, []);

  return (
    <AppLockContext.Provider value={{ enabled, supported, biometric, locked, ready, unlock, enable, disable }}>
      {children}
    </AppLockContext.Provider>
  );
}

export function useAppLock() {
  const value = useContext(AppLockContext);
  if (!value) {
    throw new Error("useAppLock must be used inside AppLockProvider.");
  }
  return value;
}

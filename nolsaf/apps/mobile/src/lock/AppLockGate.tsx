import { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { useAppLock } from "./AppLockProvider";
import { LockScreen } from "./LockScreen";

/**
 * Overlays the lock screen on top of the app whenever an authenticated session is
 * currently locked. The app tree underneath stays mounted, so unlocking returns
 * the user to exactly where they were (for example a half-completed booking) with
 * all in-progress screen state intact. Only authenticated sessions are ever
 * gated, so the login and onboarding flows are never blocked.
 */
export function AppLockGate({ children }: PropsWithChildren) {
  const { status } = useAuth();
  const { enabled, locked, ready } = useAppLock();
  const showLock = ready && status === "authenticated" && enabled && locked;

  return (
    <View style={styles.root}>
      {children}
      {showLock ? (
        // Opaque, full-screen, rendered last so it sits above and absorbs all
        // touches while locked. The app below remains mounted and preserved.
        <View style={styles.overlay} pointerEvents="auto">
          <LockScreen />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, elevation: 1000 }
});

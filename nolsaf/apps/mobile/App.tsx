import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from "@expo-google-fonts/inter";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { configureApiClient } from "@nolsaf/native-ui";

import { AuthProvider, useAuth } from "./src/auth/AuthProvider";
import { BootScreen, type BootStage } from "./src/components/BootScreen";
import { CurrencyProvider } from "./src/currency";
import { apiBaseUrl } from "./src/lib/apiClient";
import { initSslPinning } from "./src/lib/sslPinning";
import { AppLockGate, AppLockProvider } from "./src/lock";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { colors } from "./src/theme";

// The boot screen's first frame is the native splash picture, so the hand-off
// cannot be seen; it then plays the brand fill (see BootScreen). The minimum lets
// that fill read on fast devices; slow starts simply keep the loading ring going.
const MIN_SPLASH_MS = 900;
// Fonts get this long to load before the app shows anyway in the system font.
const FONT_WAIT_MS = 1500;

// Configure the shared API client before any screen or auth provider can use it.
configureApiClient({ apiUrl: apiBaseUrl() });

void SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash may already be hidden during fast refresh.
});

/** Mounts the app once the session is known, and tells the boot layer it can go. */
function AppContent({ onSessionReady }: { onSessionReady: () => void }) {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== "loading") onSessionReady();
  }, [onSessionReady, status]);
  // While the session restores, the boot layer above is still covering the screen.
  if (status === "loading") return <View style={styles.appRoot} />;
  return <AppNavigator />;
}

export default function App() {
  const [minimumSplashElapsed, setMinimumSplashElapsed] = useState(false);
  const [pinningReady, setPinningReady] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [bootGone, setBootGone] = useState(false);
  const markSessionReady = useCallback(() => setSessionReady(true), []);
  const removeBoot = useCallback(() => setBootGone(true), []);
  const splashHiddenRef = useRef(false);
  // The boot layer first draws the exact splash picture; hide the native splash then,
  // so the brand fill that follows plays in view instead of behind it.
  const hideNativeSplash = useCallback(() => {
    if (splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);
  // Brand fonts are waited for briefly so the first screen does not change typeface
  // under the user. The wait is capped (FONT_WAIT_MS): in release + New Architecture
  // builds the load can stall without resolving, and that must never trap the splash.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold
  });

  const [fontWaitOver, setFontWaitOver] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinimumSplashElapsed(true), MIN_SPLASH_MS);
    const fontTimer = setTimeout(() => setFontWaitOver(true), FONT_WAIT_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(fontTimer);
    };
  }, []);

  useEffect(() => {
    // Activate TLS certificate pinning before any authenticated screen mounts.
    // AuthProvider (below) is the first thing to hit the network, and it only
    // mounts once appReady flips true, so gating appReady on this guarantees no
    // request is ever made over an unpinned connection. initSslPinning always
    // resolves (it no-ops on web / dev / Expo Go), so it never traps the splash.
    let active = true;
    void initSslPinning().finally(() => {
      if (active) setPinningReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Boot is gated on the minimum splash time and on pinning being active, never
    // on fonts (see above).
    // Fonts are waited for only briefly, so a stalled load can never trap the splash.
    const fontsSettled = fontsLoaded || Boolean(fontError) || fontWaitOver;
    if (minimumSplashElapsed && pinningReady && fontsSettled) setAppReady(true);
  }, [minimumSplashElapsed, pinningReady, fontsLoaded, fontError, fontWaitOver]);

  useEffect(() => {
    // Safety net: the boot layer normally hides the native splash on its first
    // frame (hideNativeSplash). If that never fires, dismiss it here. Do NOT rely on
    // SafeAreaProvider's onLayout: onLayout fires once on mount while appReady is
    // still false (so it no-ops), and does not fire again when appReady flips to
    // true, which left the native splash covering the live app forever.
    if (appReady && !splashHiddenRef.current) {
      splashHiddenRef.current = true;
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [appReady]);

  // What the boot layer says, from real progress rather than a timer.
  const bootStage: BootStage = !pinningReady ? "secure" : appReady && sessionReady ? "done" : "prepare";

  return (
    <SafeAreaProvider style={styles.appRoot}>
      {bootGone ? <StatusBar style="dark" /> : null}
      {appReady ? (
        <AuthProvider>
          <AppLockProvider>
            <AppLockGate>
              <CurrencyProvider>
                <AppContent onSessionReady={markSessionReady} />
              </CurrencyProvider>
            </AppLockGate>
          </AppLockProvider>
        </AuthProvider>
      ) : null}
      {/* One boot layer for the whole start: never remounted, so it never restarts. */}
      {bootGone ? null : <BootScreen stage={bootStage} onShown={hideNativeSplash} onFinished={removeBoot} />}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: colors.white
  }
});

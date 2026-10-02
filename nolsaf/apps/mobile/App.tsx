import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from "@expo-google-fonts/inter";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { configureApiClient } from "@nolsaf/native-ui";

import { AuthProvider, useAuth } from "./src/auth/AuthProvider";
import { NolsafLogoMark } from "./src/components";
import { CurrencyProvider } from "./src/currency";
import { apiBaseUrl } from "./src/lib/apiClient";
import { initSslPinning } from "./src/lib/sslPinning";
import { AppLockGate, AppLockProvider } from "./src/lock";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { colors } from "./src/theme";

// The native splash and the boot screen below look identical (teal mark, white
// background), so the hand-off between them cannot be seen. The minimum only
// stops a one-frame flash on fast devices; nothing waits longer than needed.
const MIN_SPLASH_MS = 450;
// Fonts get this long to load before the app shows anyway in the system font.
const FONT_WAIT_MS = 1500;

// Configure the shared API client before any screen or auth provider can use it.
configureApiClient({ apiUrl: apiBaseUrl() });

void SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash may already be hidden during fast refresh.
});

/**
 * Same picture as the native splash, so it takes over without a jump. After a
 * moment, a quiet caption and a thin progress line fade in, telling the user
 * something is happening without a spinner.
 */
function BrandedBootScreen() {
  const reveal = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const revealAnim = Animated.timing(reveal, { toValue: 1, duration: 420, delay: 350, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    const sweepLoop = Animated.loop(Animated.timing(sweep, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: true }));
    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
      ])
    );
    revealAnim.start();
    sweepLoop.start();
    breatheLoop.start();
    return () => {
      revealAnim.stop();
      sweepLoop.stop();
      breatheLoop.stop();
    };
  }, [breathe, reveal, sweep]);

  const markScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
  const barX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-48, 112] });
  const rise = reveal.interpolate({ inputRange: [0, 1], outputRange: [6, 0] });

  return (
    <View style={styles.bootRoot}>
      <StatusBar style="dark" />
      <Animated.View style={{ transform: [{ scale: markScale }] }}>
        <NolsafLogoMark color={colors.primary} width={96} height={106} />
      </Animated.View>
      <Animated.View style={[styles.bootFooter, { opacity: reveal, transform: [{ translateY: rise }] }]}>
        <View style={styles.bootTrack}>
          <Animated.View style={[styles.bootBar, { transform: [{ translateX: barX }] }]} />
        </View>
        <Text style={styles.bootCaption}>Preparing your trip</Text>
      </Animated.View>
    </View>
  );
}

function AppContent() {
  const { status } = useAuth();
  if (status === "loading") return <BrandedBootScreen />;
  return <AppNavigator />;
}

export default function App() {
  const [minimumSplashElapsed, setMinimumSplashElapsed] = useState(false);
  const [pinningReady, setPinningReady] = useState(false);
  const [appReady, setAppReady] = useState(false);
  const splashHiddenRef = useRef(false);
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
    // Dismiss the native splash from an effect tied to appReady. Do NOT rely on
    // SafeAreaProvider's onLayout: onLayout fires once on mount while appReady is
    // still false (so it no-ops), and does not fire again when appReady flips to
    // true, which left the native splash covering the live app forever.
    if (appReady && !splashHiddenRef.current) {
      splashHiddenRef.current = true;
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [appReady]);

  return (
    <SafeAreaProvider style={styles.appRoot}>
      <StatusBar style="dark" />
      {appReady ? (
        <AuthProvider>
          <AppLockProvider>
            <AppLockGate>
              <CurrencyProvider>
                <AppContent />
              </CurrencyProvider>
            </AppLockGate>
          </AppLockProvider>
        </AuthProvider>
      ) : (
        <BrandedBootScreen />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: colors.white
  },
  bootRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white
  },
  bootFooter: {
    position: "absolute",
    bottom: 96,
    alignItems: "center",
    gap: 12
  },
  bootTrack: {
    width: 64,
    height: 3,
    borderRadius: 2,
    overflow: "hidden",
    backgroundColor: "rgba(2,102,94,0.12)"
  },
  bootBar: {
    width: 22,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary
  },
  bootCaption: {
    color: "rgba(1,42,38,0.55)",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600",
    letterSpacing: 0.3
  }
});

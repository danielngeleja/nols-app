import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from "@expo-google-fonts/inter";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "./src/auth/AuthProvider";
import { NolsafLogoMark } from "./src/components";
import { AppNavigator } from "./src/navigation/AppNavigator";
import { colors } from "./src/theme";

const MIN_SPLASH_MS = 2000;

void SplashScreen.preventAutoHideAsync().catch(() => {
  // The splash may already be hidden during fast refresh.
});

function BrandedBootScreen() {
  const spin = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spinLoop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1250,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true
      })
    );
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true
        })
      ])
    );

    spinLoop.start();
    pulseLoop.start();

    return () => {
      spinLoop.stop();
      pulseLoop.stop();
    };
  }, [pulse, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"]
  });

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08]
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.28, 0.08]
  });

  return (
    <View style={styles.bootRoot}>
      <StatusBar style="light" />
      <View pointerEvents="none" style={styles.bootDecorOne} />
      <View pointerEvents="none" style={styles.bootDecorTwo} />
      <View style={styles.bootCenter}>
        <Animated.View style={[styles.bootPulseRing, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
        <Animated.View style={[styles.bootLogoFrame, { transform: [{ rotate }] }]}>
          <NolsafLogoMark color={colors.white} width={58} height={58} />
        </Animated.View>
        <Text style={styles.bootBrand}>NoLSAF</Text>
        <Text style={styles.bootCaption}>Preparing trusted travel</Text>
      </View>
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
  const [appReady, setAppReady] = useState(false);
  const splashHiddenRef = useRef(false);
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold
  });

  useEffect(() => {
    const timer = setTimeout(() => setMinimumSplashElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (fontsLoaded && minimumSplashElapsed) setAppReady(true);
  }, [fontsLoaded, minimumSplashElapsed]);

  const hideSplashAfterLayout = useCallback(() => {
    if (!appReady || splashHiddenRef.current) return;
    splashHiddenRef.current = true;
    void SplashScreen.hideAsync().catch(() => undefined);
  }, [appReady]);

  return (
    <SafeAreaProvider style={styles.appRoot} onLayout={hideSplashAfterLayout}>
      <StatusBar style="dark" />
      {appReady ? (
        <AuthProvider>
          <AppContent />
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
    backgroundColor: colors.primaryDeep
  },
  bootRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.primaryDeep
  },
  bootDecorOne: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    right: -90,
    top: -70,
    backgroundColor: "rgba(118,194,183,0.14)"
  },
  bootDecorTwo: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    left: -72,
    bottom: 90,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)"
  },
  bootCenter: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10
  },
  bootPulseRing: {
    position: "absolute",
    width: 128,
    height: 128,
    borderRadius: 64,
    borderWidth: 1,
    borderColor: colors.brand[200]
  },
  bootLogoFrame: {
    width: 92,
    height: 92,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)"
  },
  bootBrand: {
    marginTop: 14,
    color: colors.white,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: "800",
    letterSpacing: 1.8
  },
  bootCaption: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600"
  }
});

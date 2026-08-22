import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold, useFonts } from "@expo-google-fonts/inter";
import { NolsafLogoMark, colors, configureApiClient } from "@nolsaf/native-ui";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "./src/auth";
import { env } from "./src/lib/env";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RoleGateScreen } from "./src/screens/RoleGateScreen";

// Point the shared API client at the configured base URL once at startup. The
// decoupled configureApiClient keeps @nolsaf/native-ui free of any single app's
// env module, per the Shared code contract.
configureApiClient({ apiUrl: env.apiUrl, client: "PARTNERS_APP" });

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

function BootScreen() {
  return (
    <View style={styles.boot}>
      <StatusBar style="light" />
      <View style={styles.bootLogo}>
        <NolsafLogoMark color={colors.white} width={48} height={48} />
      </View>
      <ActivityIndicator color={colors.brand[200]} />
    </View>
  );
}

function AppContent() {
  const { status } = useAuth();

  if (status === "loading") return <BootScreen />;
  if (status === "guest") return <LoginScreen />;
  return <RoleGateScreen />;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold
  });

  const onLayout = useCallback(() => {
    if (fontsLoaded) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded]);

  return (
    <SafeAreaProvider style={styles.root} onLayout={onLayout}>
      <StatusBar style="dark" />
      {fontsLoaded ? (
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      ) : (
        <BootScreen />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  boot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    backgroundColor: colors.primaryDeep
  },
  bootLogo: {
    width: 84,
    height: 84,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)"
  }
});

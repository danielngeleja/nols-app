import { CircleAlert, Fingerprint, KeyRound, LockKeyhole } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../auth";
import { NolsafLogoMark } from "../components";
import { useReducedMotion } from "../lib/useReducedMotion";
import { colors, radius, spacing } from "../theme";
import { useAppLock } from "./AppLockProvider";

export function LockScreen() {
  const { unlock, biometric } = useAppLock();
  const { signOut, user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const promptedRef = useRef(false);
  const reducedMotion = useReducedMotion();
  const biometricScale = useRef(new Animated.Value(1)).current;

  const attempt = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const ok = await unlock();
    if (!ok) setFailed(true);
    setBusy(false);
  }, [busy, unlock]);

  useEffect(() => {
    // Surface the OS prompt automatically the first time the lock appears.
    if (promptedRef.current) return;
    promptedRef.current = true;
    void attempt();
  }, [attempt]);

  useEffect(() => {
    biometricScale.stopAnimation();
    if (!busy || reducedMotion) {
      biometricScale.setValue(1);
      return;
    }

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(biometricScale, { toValue: 1.08, duration: 620, useNativeDriver: true }),
        Animated.timing(biometricScale, { toValue: 1, duration: 620, useNativeDriver: true })
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [biometricScale, busy, reducedMotion]);

  const displayName = user?.name || user?.fullName || null;
  const name = displayName ? displayName.trim().split(/\s+/)[0] : user?.email || null;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <View pointerEvents="none" style={styles.decorOne} />
      <View pointerEvents="none" style={styles.decorTwo} />

      <View style={styles.center}>
        <View style={styles.logoFrame}>
          <NolsafLogoMark color={colors.white} width={46} height={46} />
        </View>
        <View style={styles.lockBadge}>
          <LockKeyhole color={colors.white} size={14} />
          <Text style={styles.lockBadgeText}>Locked</Text>
        </View>
        <Text style={styles.brand}>NoLSAF is locked</Text>
        <Text style={styles.caption}>
          {name ? `Confirm it's you, ${name}, to continue.` : "Confirm it's you to continue."}
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={biometric ? "Unlock with biometrics" : "Unlock with device passcode"}
          onPress={attempt}
          disabled={busy}
          style={({ pressed }) => [styles.unlockButton, busy && styles.unlockButtonBusy, pressed && styles.unlockButtonPressed]}
        >
          <View style={styles.unlockIcon}>
            <Animated.View style={{ transform: [{ scale: biometricScale }] }}>
              {biometric ? (
                <Fingerprint color={colors.primary} size={28} strokeWidth={2.1} />
              ) : (
                <KeyRound color={colors.primary} size={27} strokeWidth={2.1} />
              )}
            </Animated.View>
          </View>
        </Pressable>

        {failed ? (
          <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.failedRow}>
            <CircleAlert color="#fbbf24" size={16} strokeWidth={2.3} />
            <Text style={styles.failed}>Not confirmed. Try again.</Text>
          </View>
        ) : null}
      </View>

      <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOut}>
        <Text style={styles.signOutText}>Sign out instead</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.primaryDeep,
    paddingHorizontal: spacing[6]
  },
  decorOne: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    right: -90,
    top: -70,
    backgroundColor: "rgba(118,194,183,0.14)"
  },
  decorTwo: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    left: -72,
    bottom: 90,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)"
  },
  center: { width: "100%", alignItems: "center", gap: 12 },
  logoFrame: {
    width: 88,
    height: 88,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)"
  },
  lockBadge: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)"
  },
  lockBadgeText: { color: colors.white, fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  brand: {
    marginTop: 6,
    color: colors.white,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    letterSpacing: 0.4,
    textAlign: "center"
  },
  caption: {
    color: "rgba(255,255,255,0.74)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center",
    maxWidth: 280
  },
  unlockButton: {
    marginTop: 18,
    alignItems: "center",
    justifyContent: "center",
    width: 72,
    height: 72,
    borderRadius: radius.xl
  },
  unlockIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white
  },
  unlockButtonPressed: { opacity: 0.86, transform: [{ scale: 0.97 }] },
  unlockButtonBusy: { opacity: 0.94 },
  failedRow: {
    marginTop: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2]
  },
  failed: { color: "rgba(255,255,255,0.82)", fontSize: 13, fontWeight: "600", textAlign: "center" },
  signOut: { position: "absolute", bottom: spacing[8], padding: spacing[3] },
  signOutText: { color: "rgba(255,255,255,0.7)", fontSize: 14, fontWeight: "700" }
});

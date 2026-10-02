import { Fingerprint, KeyRound, ScanFace } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";

import { useAuth } from "../auth";
import { NolsafLogoMark } from "../components";
import type { LockAttempt } from "../lib/appLock";
import { useReducedMotion } from "../lib/useReducedMotion";
import { colors, radius, spacing } from "../theme";
import { useAppLock } from "./AppLockProvider";

// Same geometry as the boot screen (components/BootScreen.tsx): the ring and the
// settled mark sit in the same place, so boot fades into the lock without a jump.
const RING = 150;
const RING_STROKE = 2.5;
const MARK_W = 56;
const MARK_H = 62;
const NUDGE = -4;
const AMBER = "#fbbf24";

type Phase = "idle" | "busy" | "failed" | "lockout";

/**
 * The App Lock screen. One job: get the owner back in.
 *  - The OS prompt opens by itself on arrival and when the app returns from the
 *    background, so most unlocks need no tap at all.
 *  - The ring is the status: it orbits while the prompt is up, and turns amber
 *    with a small shake when a check fails.
 *  - The words say what happened and what to do: a cancel is not an error, and
 *    a biometric lockout points to the phone passcode.
 *  - The method is named (Face ID, fingerprint, phone passcode).
 */
export function LockScreen() {
  const { unlock, biometric, biometricKind } = useAppLock();
  const { signOut, user } = useAuth();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("idle");
  const busyRef = useRef(false);
  const promptedRef = useRef(false);
  const spin = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  const method = !biometric
    ? { label: "Passcode", Icon: KeyRound }
    : biometricKind === "face"
      ? { label: "Face ID", Icon: ScanFace }
      : { label: "Fingerprint", Icon: Fingerprint };
  const usePasscode = phase === "lockout" || !biometric;
  const ActionIcon = usePasscode ? KeyRound : method.Icon;
  const actionLabel = usePasscode ? "Passcode" : method.label;

  const attempt = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("busy");
    const outcome: LockAttempt = await unlock();
    busyRef.current = false;
    if (outcome === "ok") return;
    setPhase(outcome === "lockout" ? "lockout" : outcome === "failed" ? "failed" : "idle");
    if (outcome === "failed" || outcome === "lockout") {
      shake.setValue(0);
      Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 1, duration: 60, useNativeDriver: true }),
        Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true })
      ]).start();
    }
  }, [shake, unlock]);

  // Open the OS prompt by itself the first time the lock appears.
  useEffect(() => {
    if (promptedRef.current) return;
    promptedRef.current = true;
    const t = setTimeout(() => void attempt(), 250);
    return () => clearTimeout(t);
  }, [attempt]);

  // And again whenever the app comes back from the background. Only a real
  // background counts: the OS prompt itself briefly makes the app "inactive",
  // and re-prompting on that would loop after a cancel.
  useEffect(() => {
    let wentBackground = false;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") wentBackground = true;
      if (next === "active" && wentBackground) {
        wentBackground = false;
        void attempt();
      }
    });
    return () => sub.remove();
  }, [attempt]);

  // The ring orbits while the prompt is up.
  useEffect(() => {
    if (phase !== "busy" || reducedMotion) {
      spin.stopAnimation();
      return;
    }
    spin.setValue(0);
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [phase, reducedMotion, spin]);

  const firstName = (user?.name || user?.fullName || "").trim().split(/\s+/)[0] || null;
  const title = firstName ? `Welcome back, ${firstName}` : "Welcome back";
  const status =
    phase === "busy"
      ? "Confirm on the prompt"
      : phase === "failed"
        ? "Not recognised, try again"
        : phase === "lockout"
          ? "Too many tries, use your passcode"
          : "Locked for your security";

  const warn = phase === "failed" || phase === "lockout";
  const circumference = Math.PI * (RING - RING_STROKE);
  // The ring only moves while the prompt is up; otherwise it stays a quiet frame.
  const arc = phase === "busy" ? circumference * 0.26 : 0;
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const shakeX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-8, 8] });

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Unlock with ${actionLabel}`}
        onPress={attempt}
        style={styles.centerHit}
      >
        <Animated.View style={[styles.center, { transform: [{ translateX: NUDGE }, { translateY: NUDGE }, { translateX: shakeX }] }]}>
          <Animated.View style={[styles.ring, { transform: [{ rotate }] }]}>
            <Svg width={RING} height={RING}>
              <Circle cx={RING / 2} cy={RING / 2} r={(RING - RING_STROKE) / 2} stroke="rgba(255,255,255,0.14)" strokeWidth={RING_STROKE} fill="none" />
              {arc > 0 ? (
                <Circle
                  cx={RING / 2}
                  cy={RING / 2}
                  r={(RING - RING_STROKE) / 2}
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={`${arc} ${circumference}`}
                  fill="none"
                />
              ) : null}
            </Svg>
          </Animated.View>
          <NolsafLogoMark color={colors.white} width={MARK_W} height={MARK_H} />
        </Animated.View>
      </Pressable>

      <View style={styles.words} accessibilityLiveRegion="polite">
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[styles.status, warn && styles.statusWarn]}>{status}</Text>
      </View>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, spacing[4]) + spacing[4] }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Unlock with ${actionLabel}`}
          onPress={attempt}
          disabled={phase === "busy"}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <ActionIcon color={colors.white} size={28} strokeWidth={1.8} />
        </Pressable>
        <Text style={styles.actionText}>{actionLabel}</Text>
        <View style={styles.links}>
          <Pressable accessibilityRole="button" onPress={() => void signOut()} hitSlop={8}>
            <Text style={styles.linkText}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryDeep
  },
  centerHit: {
    width: RING,
    height: RING,
    borderRadius: RING / 2
  },
  center: {
    width: RING,
    height: RING,
    alignItems: "center",
    justifyContent: "center"
  },
  ring: {
    position: "absolute",
    width: RING,
    height: RING
  },
  // Anchored to the ring, as on the boot screen, so it never overlaps on short screens.
  words: {
    position: "absolute",
    top: "50%",
    marginTop: RING / 2 + NUDGE + 28,
    left: spacing[6],
    right: spacing[6],
    alignItems: "center",
    gap: 6
  },
  title: {
    color: colors.white,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "700",
    letterSpacing: 0.2,
    textAlign: "center"
  },
  status: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "600",
    textAlign: "center"
  },
  statusWarn: {
    color: AMBER
  },
  bottom: {
    position: "absolute",
    left: spacing[6],
    right: spacing[6],
    bottom: 0,
    alignItems: "center",
    gap: spacing[2]
  },
  action: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.06)"
  },
  actionPressed: { backgroundColor: "rgba(255,255,255,0.14)", transform: [{ scale: 0.96 }] },
  actionText: {
    marginTop: -spacing[1],
    color: "rgba(255,255,255,0.85)",
    fontSize: 13,
    fontWeight: "600"
  },
  links: {
    marginTop: spacing[4],
    flexDirection: "row",
    gap: spacing[6]
  },
  linkText: { color: "rgba(255,255,255,0.55)", fontSize: 13, fontWeight: "600" }
});

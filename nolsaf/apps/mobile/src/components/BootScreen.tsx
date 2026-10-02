import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import Svg, { Circle } from "react-native-svg";

import { colors } from "../theme";
import { NolsafLogoMark } from "./NolsafLogoMark";

export type BootStage = "secure" | "prepare" | "done";

const CAPTION: Record<BootStage, string> = {
  secure: "Securing your connection",
  prepare: "Getting things ready",
  done: "Welcome"
};

// The mark as drawn by the native splash (assets/Splash.png at imageWidth 240):
// about 93 x 103 dp, sitting 4 dp above and left of centre. The first frame here
// matches it exactly, so the native splash hands over without a visible jump.
const MARK_W = 93;
const MARK_H = 103;
const MARK_NUDGE = -4;
const RING = 150;
const RING_STROKE = 2.5;
// Once the fill plays the mark settles smaller, so the ring circles it with clear
// space instead of crowding its edges.
const MARK_SETTLED_SCALE = 0.6;

/**
 * One continuous boot sequence, mounted once above the app for the whole start:
 *  1. the native splash picture (white, teal mark);
 *  2. a deep-green fill grows from behind the mark while the mark turns white,
 *     carrying the user from the white splash into the dark brand of the landing;
 *  3. a ring orbits the still mark and the caption follows real progress;
 *  4. when everything is ready the ring closes and the layer fades into the app.
 * `onShown` fires once the first frame is on screen, so the caller can hide the
 * native splash at that moment and the fill plays in view; `onFinished` fires
 * after the fade so the caller can unmount it.
 */
export function BootScreen({ stage, onShown, onFinished }: { stage: BootStage; onShown: () => void; onFinished: () => void }) {
  const { width, height } = useWindowDimensions();
  const fill = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const ringIn = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(0)).current;
  const [filled, setFilled] = useState(false);
  const finishing = useRef(false);
  const [shown, setShown] = useState(false);

  // Big enough to cover the screen from the centre in any orientation.
  const diameter = Math.ceil(Math.hypot(width, height)) * 1.1;

  // Starts once the first frame is up and the native splash is gone, so it is seen.
  useEffect(() => {
    if (!shown) return;
    const fillAnim = Animated.timing(fill, { toValue: 1, duration: 720, delay: 120, easing: Easing.bezier(0.65, 0, 0.35, 1), useNativeDriver: true });
    const ringAnim = Animated.timing(ringIn, { toValue: 1, duration: 360, delay: 640, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    const spinLoop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: true }));
    fillAnim.start(({ finished }) => finished && setFilled(true));
    ringAnim.start();
    spinLoop.start();
    return () => {
      fillAnim.stop();
      ringAnim.stop();
      spinLoop.stop();
    };
  }, [fill, ringIn, shown, spin]);

  // Leave only once the brand fill has played, so a fast start never cuts it short.
  useEffect(() => {
    if (stage !== "done" || !filled || finishing.current) return;
    finishing.current = true;
    Animated.timing(exit, { toValue: 1, duration: 380, delay: 220, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }).start(() => onFinished());
  }, [exit, filled, onFinished, stage]);

  const fillScale = fill.interpolate({ inputRange: [0, 1], outputRange: [0.02, 1] });
  const tealMark = fill.interpolate({ inputRange: [0, 0.45, 1], outputRange: [1, 0, 0] });
  const markScale = fill.interpolate({ inputRange: [0, 1], outputRange: [1, MARK_SETTLED_SCALE] });
  const whiteMark = fill.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 1, 1] });
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const ringScale = ringIn.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });
  const textRise = ringIn.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  const layerOpacity = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const lift = exit.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  const circumference = Math.PI * (RING - RING_STROKE);
  // While loading the ring is a quarter arc that orbits; at "done" it closes to a full circle.
  const arc = stage === "done" ? circumference : circumference * 0.26;

  return (
    <Animated.View
      pointerEvents={stage === "done" ? "none" : "auto"}
      onLayout={() => {
        if (shown) return;
        setShown(true);
        onShown();
      }}
      style={[StyleSheet.absoluteFill, styles.root, { opacity: layerOpacity }]}
    >
      <StatusBar style={filled ? "light" : "dark"} />
      <Animated.View
        style={[
          styles.fill,
          { width: diameter, height: diameter, borderRadius: diameter / 2, marginLeft: -diameter / 2, marginTop: -diameter / 2, transform: [{ scale: fillScale }] }
        ]}
      />

      <Animated.View style={[styles.center, { transform: [{ translateX: MARK_NUDGE }, { translateY: MARK_NUDGE }, { scale: lift }] }]}>
        <Animated.View style={[styles.ring, { opacity: ringIn, transform: [{ scale: ringScale }, { rotate }] }]}>
          <Svg width={RING} height={RING}>
            <Circle cx={RING / 2} cy={RING / 2} r={(RING - RING_STROKE) / 2} stroke="rgba(255,255,255,0.12)" strokeWidth={RING_STROKE} fill="none" />
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
          </Svg>
        </Animated.View>
        <Animated.View style={[styles.mark, { opacity: tealMark, transform: [{ scale: markScale }] }]}>
          <NolsafLogoMark color={colors.primary} width={MARK_W} height={MARK_H} />
        </Animated.View>
        <Animated.View style={[styles.mark, { opacity: whiteMark, transform: [{ scale: markScale }] }]}>
          <NolsafLogoMark color={colors.white} width={MARK_W} height={MARK_H} />
        </Animated.View>
      </Animated.View>

      <Animated.View style={[styles.words, { opacity: ringIn, transform: [{ translateY: textRise }] }]}>
        <Text style={styles.brand}>NoLSAF</Text>
        <Text style={styles.caption}>{CAPTION[stage]}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    zIndex: 100,
    elevation: 100,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white
  },
  fill: {
    position: "absolute",
    left: "50%",
    top: "50%",
    backgroundColor: colors.primaryDeep
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
  mark: {
    position: "absolute"
  },
  // Anchored to the ring, not the screen: always a clear gap below it on any height.
  words: {
    position: "absolute",
    top: "50%",
    marginTop: RING / 2 + MARK_NUDGE + 28,
    alignItems: "center",
    gap: 6
  },
  brand: {
    color: colors.white,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: "800",
    letterSpacing: 1.2
  },
  caption: {
    color: "rgba(255,255,255,0.68)",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600"
  }
});

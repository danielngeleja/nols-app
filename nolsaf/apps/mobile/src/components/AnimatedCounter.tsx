import { useEffect, useRef, useState } from "react";
import { Animated, Easing } from "react-native";

import { AppText, AppTextProps } from "./AppText";

type AnimatedCounterProps = AppTextProps & {
  /** Target value to count up to. */
  value: number;
  /** Animation length in milliseconds. */
  duration?: number;
  /** Optional text appended after the number, e.g. "+". */
  suffix?: string;
};

/**
 * Counts up from zero to `value` every time `value` changes, while fading and
 * rising into place for a clean transition. The count uses a non native driver
 * because it reads the interpolated number each frame; the fade and rise use
 * the native driver in parallel.
 */
export function AnimatedCounter({ value, duration = 1000, suffix = "", ...props }: AnimatedCounterProps) {
  const count = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const id = count.addListener(({ value: current }) => setDisplay(Math.round(current)));
    count.setValue(0);
    reveal.setValue(0);
    const animation = Animated.parallel([
      Animated.timing(count, {
        toValue: value,
        duration,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false
      }),
      Animated.timing(reveal, {
        toValue: 1,
        duration: Math.min(duration, 450),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true
      })
    ]);
    animation.start();
    return () => {
      animation.stop();
      count.removeListener(id);
    };
  }, [count, reveal, value, duration]);

  const translateY = reveal.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });

  return (
    <Animated.View style={{ opacity: reveal, transform: [{ translateY }] }}>
      <AppText {...props}>
        {display.toLocaleString()}
        {suffix}
      </AppText>
    </Animated.View>
  );
}

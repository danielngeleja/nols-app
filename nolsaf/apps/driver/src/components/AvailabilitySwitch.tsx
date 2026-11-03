import { AppCard, AppStack, AppText, colors, radius, spacing } from "@nolsaf/native-ui";
import { LinearGradient } from "expo-linear-gradient";
import { LoaderCircle, Power } from "lucide-react-native";
import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";

type AvailabilitySwitchProps = {
  available: boolean;
  loading?: boolean;
  onToggle: (next: boolean) => void;
};

export function AvailabilitySwitch({ available, loading, onToggle }: AvailabilitySwitchProps) {
  const pulse = useRef(new Animated.Value(0)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!available || loading) {
      pulse.setValue(0);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [available, loading, pulse]);

  useEffect(() => {
    if (!loading) {
      spin.setValue(0);
      return undefined;
    }

    const animation = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: true })
    );
    animation.start();
    return () => animation.stop();
  }, [loading, spin]);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });
  const spinRotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });

  return (
    <AppCard tone={available ? "brand" : "default"} style={styles.card}>
      <View style={styles.row}>
        <AppStack gap={1} style={styles.text}>
          <AppText variant="title" weight="bold" tone={available ? "inverse" : "default"}>
            {available ? "You're online" : "You're offline"}
          </AppText>
          <AppText variant="bodySmall" tone={available ? "inverse" : "muted"}>
            {available ? "Sharing your location for nearby trip requests." : "Go online to share your location and receive trips."}
          </AppText>
        </AppStack>

        <Pressable accessibilityRole="button" disabled={loading} onPress={() => onToggle(!available)} style={styles.buttonWrap}>
          {available && !loading ? (
            <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseScale }], opacity: pulseOpacity }]} />
          ) : null}

          {available ? (
            <LinearGradient colors={["#02665e", "#0b7a71", "#35a79c"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.toggleCircle}>
              {loading ? (
                <Animated.View style={{ transform: [{ rotate: spinRotate }] }}>
                  <LoaderCircle color={colors.white} size={20} />
                </Animated.View>
              ) : (
                <Power color={colors.white} size={20} />
              )}
            </LinearGradient>
          ) : (
            <View style={[styles.toggleCircle, styles.toggleCircleOff]}>
              {loading ? (
                <Animated.View style={{ transform: [{ rotate: spinRotate }] }}>
                  <LoaderCircle color={colors.primary} size={20} />
                </Animated.View>
              ) : (
                <Power color={colors.primary} size={20} />
              )}
            </View>
          )}
        </Pressable>
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%"
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  text: {
    flex: 1,
    minWidth: 0
  },
  buttonWrap: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center"
  },
  pulseRing: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: "rgba(52,211,153,0.45)"
  },
  toggleCircle: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#02665e",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4
  },
  toggleCircleOff: {
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    shadowOpacity: 0,
    elevation: 0
  }
});

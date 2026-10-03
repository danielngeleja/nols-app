import { useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { Landmark, MapPin } from "lucide-react-native";

import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";

export const PLACE_TILE_WIDTH = 148;

/** "Serengeti National Park" reads as "Serengeti" on a small tile. */
function shortPlaceName(name: string) {
  return name.replace(/\s+(National Park|Conservation Area|Game Reserve|Marine Park)$/i, "").trim() || name;
}

/**
 * One place (a city or a park) shown with a real photo from an approved stay
 * there and how many stays it has. Only places with stays are passed in, so
 * every tile leads somewhere bookable. Used by the landing screen's city and
 * park rows so both read the same.
 */
export function PlaceTile({ name, stays, image, kind = "city", width = PLACE_TILE_WIDTH, onPress }: { name: string; stays: number; image: string | null; kind?: "city" | "park"; width?: number; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const [failed, setFailed] = useState(false);
  const photo = image && !failed ? image : null;
  const label = shortPlaceName(name);
  const press = (to: number) => Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 30, bounciness: to < 1 ? 0 : 8 }).start();

  return (
    <Animated.View style={{ width, transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${stays} ${stays === 1 ? "stay" : "stays"}`}
        onPress={onPress}
        onPressIn={() => press(0.97)}
        onPressOut={() => press(1)}
        style={styles.tile}
      >
        <View style={styles.photo}>
          {photo ? (
            <Animated.Image
              source={{ uri: photo }}
              resizeMode="cover"
              onLoad={() => Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }).start()}
              onError={() => setFailed(true)}
              style={[StyleSheet.absoluteFill, { opacity: fade }]}
            />
          ) : (
            <View style={styles.placeholder}>
              {kind === "park" ? <Landmark color={colors.primary} size={22} /> : <MapPin color={colors.primary} size={22} />}
            </View>
          )}
        </View>
        <View style={styles.text}>
          <AppText variant="bodySmall" weight="bold" numberOfLines={1}>{label}</AppText>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {stays.toLocaleString()} {stays === 1 ? "stay" : "stays"}
          </AppText>
        </View>
      </Pressable>
    </Animated.View>
  );
}

/** Same footprint as a tile, for the moment before counts arrive. */
export function PlaceTileSkeleton({ width = PLACE_TILE_WIDTH }: { width?: number }) {
  return (
    <View style={[styles.tile, { width }]}>
      <View style={styles.photo} />
      <View style={styles.text}>
        <View style={styles.lineWide} />
        <View style={styles.line} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  photo: {
    height: 96,
    backgroundColor: colors.brand[50]
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  text: {
    gap: 4,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  lineWide: {
    height: 12,
    width: "70%",
    borderRadius: radius.full,
    backgroundColor: colors.border
  },
  line: {
    height: 10,
    width: "40%",
    borderRadius: radius.full,
    backgroundColor: colors.border
  }
});

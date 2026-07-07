import { ReactNode, useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, shadows, spacing } from "../theme";
import { AppText } from "./AppText";

export type AppBottomNavItem<Key extends string> = {
  key: Key;
  label: string;
  icon: (color: string) => ReactNode;
  onPress: () => void;
};

/** The raised circular action that floats in the middle of the bar (for example a QR scan). */
export type AppBottomNavCenterAction = {
  icon: (color: string) => ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
};

type AppBottomNavProps<Key extends string> = {
  activeKey: Key;
  items: Array<AppBottomNavItem<Key>>;
  /** When set, a floating button is rendered in the middle, splitting the tabs evenly around it. */
  centerAction?: AppBottomNavCenterAction;
};

export function AppBottomNav<Key extends string>({ activeKey, items, centerAction }: AppBottomNavProps<Key>) {
  const insets = useSafeAreaInsets();

  // Split the tabs around the floating centre button so they sit evenly on each side.
  const half = Math.ceil(items.length / 2);
  const left = centerAction ? items.slice(0, half) : items;
  const right = centerAction ? items.slice(half) : [];

  const renderItem = (item: AppBottomNavItem<Key>) => (
    <AppBottomNavButton key={item.key} active={item.key === activeKey} item={item} />
  );

  return (
    <View style={[styles.shell, { paddingBottom: Math.max(insets.bottom, spacing[2]) }]}>
      {centerAction ? (
        <View pointerEvents="box-none" style={styles.centerWrap}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={centerAction.accessibilityLabel}
            onPress={centerAction.onPress}
            style={({ pressed }) => [styles.centerButton, pressed && styles.centerButtonPressed]}
          >
            {centerAction.icon(colors.white)}
          </Pressable>
        </View>
      ) : null}

      <View style={styles.bar}>
        {left.map(renderItem)}
        {centerAction ? <View style={styles.centerSlot} /> : null}
        {right.map(renderItem)}
      </View>
    </View>
  );
}

function AppBottomNavButton<Key extends string>({
  item,
  active
}: {
  item: AppBottomNavItem<Key>;
  active: boolean;
}) {
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: 260,
      useNativeDriver: true
    }).start();
  }, [active, progress]);

  const activeOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1]
  });

  const activeScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 1]
  });

  const iconTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -3]
  });

  const iconScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.05]
  });

  const markerScale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 1]
  });

  return (
    <Pressable
      accessibilityRole="button"
      onPress={item.onPress}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.activeCapsule,
          {
            opacity: activeOpacity,
            transform: [{ scale: activeScale }]
          }
        ]}
      />
      <View style={styles.itemInner}>
        <Animated.View
          style={[
            styles.iconMotion,
            {
              transform: [{ translateY: iconTranslateY }, { scale: iconScale }]
            }
          ]}
        >
          <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
            {item.icon(active ? colors.white : colors.primary)}
          </View>
        </Animated.View>
        <AppText
          variant="caption"
          weight={active ? "bold" : "medium"}
          numberOfLines={2}
          style={[styles.label, { color: active ? colors.primary : colors.softText }]}
        >
          {item.label}
        </AppText>
        <Animated.View
          style={[
            styles.activeMarker,
            {
              opacity: activeOpacity,
              transform: [{ scaleX: markerScale }]
            }
          ]}
        />
      </View>
    </Pressable>
  );
}

const CENTER_SIZE = 58;

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2]
  },
  bar: {
    minWidth: 0,
    minHeight: 72,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: 5,
    gap: spacing[1],
    ...shadows.card
  },
  item: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    overflow: "hidden",
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
    paddingVertical: spacing[1]
  },
  itemPressed: {
    opacity: 0.76
  },
  activeCapsule: {
    position: "absolute",
    left: 2,
    right: 2,
    top: 2,
    bottom: 2,
    borderRadius: radius.lg,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  itemInner: {
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 2
  },
  iconMotion: {
    alignItems: "center",
    justifyContent: "center"
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  iconWrapActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  label: {
    textAlign: "center",
    maxWidth: 82,
    fontSize: 10.5,
    lineHeight: 12.5,
    letterSpacing: 0
  },
  activeMarker: {
    width: 18,
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    marginTop: 1
  },
  // Reserves the gap in the tab row that the floating button sits over.
  centerSlot: {
    width: CENTER_SIZE + spacing[3]
  },
  centerWrap: {
    position: "absolute",
    top: -CENTER_SIZE / 2,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 2
  },
  centerButton: {
    width: CENTER_SIZE,
    height: CENTER_SIZE,
    borderRadius: CENTER_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: colors.white,
    ...shadows.sheet
  },
  centerButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.94 }]
  }
});

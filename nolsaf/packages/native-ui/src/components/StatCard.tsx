import { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";
import { AppText } from "./AppText";
import { DeltaBadge, DeltaBadgeProps } from "./DeltaBadge";
import { Sparkline } from "./Sparkline";

export type StatCardProps = {
  label: string;
  value: string | number;
  icon?: ReactNode;
  iconBg?: string;
  caption?: string;
  delta?: DeltaBadgeProps;
  spark?: { values: number[]; color?: string };
  /** When set, the card becomes a button (used to drill into the detail screen). */
  onPress?: () => void;
};

// The white stat card shared by the Owner and Operator home screens: a tinted
// icon, label, large value, an optional trend delta pill, and an optional
// caption or sparkline. Server authoritative; it only renders the values it is
// given and never computes them. Pass onPress to make it a tappable button that
// drills into a detail screen. Follows the Overflow Prevention Policy
// (numberOfLines + minWidth 0 + flexShrink) from NATIVE_APP_SETUP.md.
export function StatCard({ label, value, icon, iconBg, caption, delta, spark, onPress }: StatCardProps) {
  const body = (
    <>
      <View style={styles.headerRow}>
        <View style={styles.left}>
          {icon ? <View style={[styles.iconWrap, iconBg ? { backgroundColor: iconBg } : null]}>{icon}</View> : null}
          <View style={styles.labelCol}>
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {label}
            </AppText>
            <AppText variant="title" weight="semiBold" numberOfLines={1}>
              {String(value)}
            </AppText>
          </View>
        </View>
        {delta ? <DeltaBadge {...delta} /> : null}
      </View>

      {caption ? (
        <AppText variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: spacing[2] }}>
          {caption}
        </AppText>
      ) : null}

      {spark ? (
        <View style={{ marginTop: spacing[3] }}>
          <Sparkline values={spark.values} color={spark.color} />
        </View>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${String(value)}`}
        onPress={onPress}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        {body}
      </Pressable>
    );
  }

  return <View style={styles.card}>{body}</View>;
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    padding: spacing[3],
    ...shadows.card
  },
  cardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }]
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minWidth: 0,
    flexShrink: 1
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  labelCol: {
    minWidth: 0,
    flexShrink: 1
  }
});

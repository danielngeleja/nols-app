import { PropsWithChildren } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { colors, radius, shadows, spacing } from "../theme";

type AppCardProps = PropsWithChildren<{
  tone?: "default" | "brand" | "success" | "warning";
  style?: StyleProp<ViewStyle>;
}>;

export function AppCard({ children, tone = "default", style }: AppCardProps) {
  return <View style={[styles.base, toneStyles[tone], style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    minWidth: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[4],
    backgroundColor: colors.card,
    ...shadows.card
  }
});

const toneStyles = StyleSheet.create({
  default: {},
  brand: {
    backgroundColor: colors.primaryDeep,
    borderColor: colors.primaryDark
  },
  success: {
    backgroundColor: colors.brand[50],
    borderColor: colors.brand[100]
  },
  warning: {
    backgroundColor: "#fff8e6",
    borderColor: "#fde68a"
  }
});

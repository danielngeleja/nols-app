import { ReactNode } from "react";
import { ActivityIndicator, Pressable, PressableProps, StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { colors, fonts, radius, spacing } from "../theme";
import { AppText } from "./AppText";

type AppButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type AppButtonProps = Omit<PressableProps, "children" | "style"> & {
  title: string;
  variant?: AppButtonVariant;
  loading?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function AppButton({ title, variant = "primary", loading = false, icon, disabled, style, ...props }: AppButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <View style={[styles.base, variantStyles[variant], isDisabled && styles.disabled, style]}>
      <Pressable
        accessibilityRole="button"
        disabled={isDisabled}
        android_ripple={isDisabled ? undefined : { color: rippleColors[variant], borderless: false }}
        style={({ pressed }) => [styles.inner, pressed && !isDisabled && styles.pressed]}
        {...props}
      >
        {loading ? (
          <ActivityIndicator color={variant === "primary" || variant === "danger" ? colors.white : colors.primary} />
        ) : (
          <View style={styles.content}>
            {icon}
            <AppText
              variant="bodySmall"
              weight="semiBold"
              tone={variant === "primary" || variant === "danger" ? "inverse" : "primary"}
              numberOfLines={2}
              style={styles.title}
            >
              {title}
            </AppText>
          </View>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden"
  },
  inner: {
    minHeight: 52,
    minWidth: 0,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    alignItems: "center",
    justifyContent: "center"
  },
  content: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2]
  },
  title: {
    textAlign: "center",
    fontFamily: fonts.semiBold
  },
  disabled: {
    opacity: 0.45
  },
  pressed: {
    transform: [{ scale: 0.98 }]
  }
});

const variantStyles = StyleSheet.create({
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  secondary: {
    backgroundColor: colors.brand[50],
    borderColor: colors.brand[100]
  },
  ghost: {
    backgroundColor: colors.white,
    borderColor: colors.border
  },
  danger: {
    backgroundColor: colors.danger,
    borderColor: colors.danger
  }
});

const rippleColors: Record<AppButtonVariant, string> = {
  primary: "rgba(255,255,255,0.25)",
  secondary: "rgba(15,118,110,0.18)",
  ghost: "rgba(15,118,110,0.12)",
  danger: "rgba(255,255,255,0.25)"
};

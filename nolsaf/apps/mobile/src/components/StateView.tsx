import { RefreshCcw } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AppButton } from "./AppButton";
import { AppText } from "./AppText";

type StateViewProps = {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function StateView({ title, message, actionLabel, onAction }: StateViewProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.mark}>
        <RefreshCcw color={colors.primary} size={22} />
      </View>
      <AppText variant="titleSm" weight="bold" style={styles.center}>
        {title}
      </AppText>
      {message ? (
        <AppText variant="bodySmall" tone="muted" style={styles.center}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <AppButton title={actionLabel} variant="secondary" onPress={() => onAction()} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 0,
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[5]
  },
  mark: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center"
  },
  center: {
    textAlign: "center"
  }
});

import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";

type Status = "requested" | "verified" | "approved" | "disbursed" | "pending" | "paid" | "failed" | "cancelled" | "completed" | "awaiting";

type StatusBadgeProps = {
  status: Status;
  label?: string;
};

const statusTone: Record<Status, { bg: string; text: string }> = {
  requested: { bg: colors.brand[50], text: colors.primary },
  verified: { bg: colors.brand[100], text: colors.primaryDark },
  approved: { bg: "#eaf5ff", text: "#0369a1" },
  disbursed: { bg: "#f1ecff", text: "#5b21b6" },
  pending: { bg: "#f8fafc", text: colors.mutedText },
  paid: { bg: colors.brand[50], text: colors.primary },
  failed: { bg: "#fee2e2", text: colors.danger },
  cancelled: { bg: "#f1f5f9", text: colors.mutedText },
  completed: { bg: colors.brand[50], text: colors.success },
  awaiting: { bg: "#fef3c7", text: "#b45309" }
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const tone = statusTone[status];

  return (
    <View style={[styles.base, { backgroundColor: tone.bg }]}>
      <AppText variant="caption" weight="bold" style={{ color: tone.text, textTransform: "uppercase" }}>
        {label || status}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  }
});

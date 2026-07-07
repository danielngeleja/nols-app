import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";
import { ResponsiveRow } from "./ResponsiveRow";

type InfoGridItem = {
  label: string;
  value: string;
};

type InfoGridProps = {
  items: InfoGridItem[];
};

export function InfoGrid({ items }: InfoGridProps) {
  return (
    <ResponsiveRow stackAt={430}>
      {items.map((item) => (
        <View key={item.label} style={styles.item}>
          <AppText variant="caption" weight="bold" tone="muted" style={styles.label}>
            {item.label}
          </AppText>
          <AppText variant="bodySmall" weight="semiBold" numberOfLines={2}>
            {item.value}
          </AppText>
        </View>
      ))}
    </ResponsiveRow>
  );
}

const styles = StyleSheet.create({
  item: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    padding: spacing[3],
    gap: spacing[1]
  },
  label: {
    textTransform: "uppercase",
    letterSpacing: 1.2
  }
});

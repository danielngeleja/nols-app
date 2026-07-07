import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";

type DeltaDirection = "up" | "down" | "steady";

const tone: Record<DeltaDirection, { bg: string; text: string; border: string; arrow: string }> = {
  up: { bg: "#eaf3de", text: "#27500a", border: "#c0dd97", arrow: "↑" },
  down: { bg: "#fcebeb", text: "#791f1f", border: "#f7c1c1", arrow: "↓" },
  steady: { bg: colors.surface, text: colors.mutedText, border: colors.border, arrow: "–" }
};

export type DeltaBadgeProps = {
  direction: DeltaDirection;
  label: string | number;
};

// Small trend pill used on stat cards. Mirrors the web delta badge (up = green,
// down = red, steady = neutral). The arrow is a glyph so native-ui stays icon
// library agnostic; consumers pass any number or short label.
export function DeltaBadge({ direction, label }: DeltaBadgeProps) {
  const t = tone[direction];

  return (
    <View style={[styles.base, { backgroundColor: t.bg, borderColor: t.border }]}>
      <AppText variant="caption" weight="bold" style={{ color: t.text }}>
        {t.arrow} {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  }
});

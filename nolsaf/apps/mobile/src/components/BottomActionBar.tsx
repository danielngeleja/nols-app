import { PropsWithChildren } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "../theme";

export function BottomActionBar({ children }: PropsWithChildren) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.base, { paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    gap: spacing[2]
  }
});

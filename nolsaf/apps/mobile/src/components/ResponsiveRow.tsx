import { PropsWithChildren } from "react";
import { StyleProp, StyleSheet, useWindowDimensions, View, ViewStyle } from "react-native";

import { spacing } from "../theme";

type ResponsiveRowProps = PropsWithChildren<{
  stackAt?: number;
  gap?: keyof typeof spacing;
  style?: StyleProp<ViewStyle>;
}>;

export function ResponsiveRow({ children, stackAt = 380, gap = 3, style }: ResponsiveRowProps) {
  const { width } = useWindowDimensions();
  const stacked = width < stackAt;

  return (
    <View
      style={[
        styles.base,
        {
          flexDirection: stacked ? "column" : "row",
          gap: spacing[gap]
        },
        style
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    width: "100%",
    minWidth: 0,
    alignItems: "stretch"
  }
});

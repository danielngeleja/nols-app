import { PropsWithChildren } from "react";
import { StyleProp, View, ViewStyle } from "react-native";

import { spacing } from "../theme";

type AppStackProps = PropsWithChildren<{
  gap?: keyof typeof spacing;
  style?: StyleProp<ViewStyle>;
}>;

export function AppStack({ children, gap = 4, style }: AppStackProps) {
  return <View style={[{ gap: spacing[gap], minWidth: 0 }, style]}>{children}</View>;
}

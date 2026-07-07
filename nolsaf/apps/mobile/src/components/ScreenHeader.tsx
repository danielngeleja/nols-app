import { ArrowLeft } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  action?: React.ReactNode;
  centered?: boolean;
};

export function ScreenHeader({ title, subtitle, onBack, action, centered }: ScreenHeaderProps) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.top, centered && styles.topCentered]}>
        {onBack ? (
          <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
            <ArrowLeft color={colors.ink} size={22} />
          </Pressable>
        ) : null}
        <View style={[styles.titleWrap, centered && styles.titleWrapCentered]}>
          <AppText
            variant="title"
            weight="bold"
            numberOfLines={2}
            style={centered ? styles.centeredText : undefined}
          >
            {title}
          </AppText>
          {subtitle ? (
            <AppText
              variant="bodySmall"
              tone="muted"
              numberOfLines={3}
              style={centered ? styles.centeredText : undefined}
            >
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {action}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    minWidth: 0
  },
  top: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  topCentered: {
    justifyContent: "center"
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1]
  },
  titleWrapCentered: {
    alignItems: "center"
  },
  centeredText: {
    textAlign: "center"
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  }
});

import { PropsWithChildren, Ref } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing } from "../theme";

type SafeScreenProps = PropsWithChildren<{
  scroll?: boolean;
  padded?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  /** The screen's ScrollView, so a screen can scroll to a section it was opened for. */
  scrollRef?: Ref<ScrollView>;
}>;

export function SafeScreen({ children, scroll = true, padded = true, contentStyle, scrollRef }: SafeScreenProps) {
  const content = (
    <View style={[styles.content, padded && styles.padded, contentStyle]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        {scroll ? (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {content}
          </ScrollView>
        ) : content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface
  },
  keyboard: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1
  },
  content: {
    flexGrow: 1,
    width: "100%",
    minWidth: 0
  },
  padded: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4]
  }
});

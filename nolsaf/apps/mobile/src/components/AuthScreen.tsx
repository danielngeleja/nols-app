import { ArrowLeft, Lock } from "lucide-react-native";
import { StatusBar } from "expo-status-bar";
import { PropsWithChildren, ReactNode, useEffect, useRef } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";
import { NolsafLogoMark } from "./NolsafLogoMark";

type AuthScreenProps = PropsWithChildren<{
  title: string;
  /** One short line at most. Leave it out when the title says enough. */
  subtitle?: string;
  onBack?: () => void;
  /** Kept so existing callers compile; the brand panel carries the logo instead. */
  icon?: ReactNode;
  footer?: ReactNode;
  progress?: {
    current: number;
    total: number;
    label: string;
  };
}>;

/**
 * Sign in, registration and recovery share this frame: a deep brand panel with
 * the NoLSAF mark on an app-icon tile, and a white sheet rising over it that
 * holds the form and fills the rest of the screen.
 */
export function AuthScreen({ children, title, subtitle, onBack, footer, progress }: AuthScreenProps) {
  const scrollRef = useRef<ScrollView>(null);
  const insets = useSafeAreaInsets();

  // When the keyboard opens, scroll the form up so the focused input rises above
  // the keyboard. KeyboardAvoidingView is a no-op on Android, so this is what
  // actually keeps the field visible there.
  useEffect(() => {
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  return (
    <View style={styles.root}>
      {/* Light icons on the green panel; the app's dark style returns when this screen leaves. */}
      <StatusBar style="light" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={[styles.panel, { paddingTop: insets.top + spacing[2] }]}>
            {/* Two soft shapes give the panel depth without a picture. */}
            <View pointerEvents="none" style={styles.shapeOne} />
            <View pointerEvents="none" style={styles.shapeTwo} />

            <View style={styles.panelTop}>
              {onBack ? (
                <Pressable
                  accessibilityLabel="Go back"
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={onBack}
                  style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                >
                  <ArrowLeft color={colors.white} size={20} />
                </Pressable>
              ) : (
                <View style={styles.backSpacer} />
              )}
            </View>

            <View style={styles.brand} accessibilityRole="header" accessibilityLabel="NoLSAF">
              <View style={styles.markTile}>
                <NolsafLogoMark color={colors.primary} width={32} height={36} />
              </View>
              <AppText variant="titleSm" weight="extraBold" tone="inverse" style={styles.wordmark}>
                NoLSAF
              </AppText>
            </View>
          </View>

          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing[4]) + spacing[2] }]}>
            {progress ? (
              <View style={styles.progressWrap} accessibilityLabel={`${progress.label}, step ${progress.current} of ${progress.total}`}>
                <View style={styles.progressTrack}>
                  {Array.from({ length: progress.total }).map((_, index) => (
                    <View key={index} style={[styles.progressSegment, index < progress.current && styles.progressSegmentActive]} />
                  ))}
                </View>
                <AppText variant="caption" weight="semiBold" tone="muted">
                  {progress.label} · {progress.current} of {progress.total}
                </AppText>
              </View>
            ) : null}

            <View style={styles.heading}>
              <AppText variant="title" weight="extraBold" style={styles.centerText}>
                {title}
              </AppText>
              {subtitle ? (
                <AppText variant="bodySmall" tone="muted" style={styles.centerText}>
                  {subtitle}
                </AppText>
              ) : null}
            </View>

            <View style={styles.content}>{children}</View>

            {footer ? <View style={styles.footer}>{footer}</View> : null}

            <View style={styles.trustLine}>
              <Lock color={colors.softText} size={13} />
              <AppText variant="caption" tone="muted">
                Encrypted sign-in
              </AppText>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const SHEET_OVERLAP = 28;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    // Same green as the panel, so pulling past the top never shows a white gap.
    backgroundColor: colors.primaryDeep
  },
  keyboard: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1
  },
  panel: {
    overflow: "hidden",
    backgroundColor: colors.primaryDeep,
    paddingHorizontal: spacing[5],
    paddingBottom: SHEET_OVERLAP + spacing[6]
  },
  shapeOne: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    right: -90,
    top: -70,
    backgroundColor: "rgba(255,255,255,0.05)"
  },
  shapeTwo: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    left: -70,
    bottom: -40,
    backgroundColor: "rgba(69,170,153,0.12)"
  },
  panelTop: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center"
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.08)"
  },
  backSpacer: {
    height: 40
  },
  brand: {
    alignItems: "center",
    gap: spacing[3],
    marginTop: spacing[2]
  },
  markTile: {
    width: 68,
    height: 68,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: colors.white,
    shadowColor: "#000000",
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6
  },
  wordmark: {
    letterSpacing: 0.4
  },
  sheet: {
    flexGrow: 1,
    marginTop: -SHEET_OVERLAP,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[6]
  },
  progressWrap: {
    gap: spacing[2],
    marginBottom: spacing[5]
  },
  progressTrack: {
    flexDirection: "row",
    gap: 6
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border
  },
  progressSegmentActive: {
    backgroundColor: colors.primary
  },
  heading: {
    alignItems: "center",
    gap: spacing[1],
    marginBottom: spacing[5]
  },
  centerText: {
    textAlign: "center"
  },
  content: {
    gap: spacing[4]
  },
  footer: {
    marginTop: spacing[6]
  },
  trustLine: {
    marginTop: "auto",
    paddingTop: spacing[8],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6
  },
  pressed: {
    opacity: 0.74
  }
});

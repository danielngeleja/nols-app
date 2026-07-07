import { ArrowLeft, ShieldCheck } from "lucide-react-native";
import { PropsWithChildren, ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";
import { NolsafLogoMark } from "./NolsafLogoMark";

type AuthScreenProps = PropsWithChildren<{
  title: string;
  subtitle: string;
  onBack?: () => void;
  icon?: ReactNode;
  footer?: ReactNode;
  progress?: {
    current: number;
    total: number;
    label: string;
  };
}>;

export function AuthScreen({ children, title, subtitle, onBack, icon, footer, progress }: AuthScreenProps) {
  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.heroBackground}>
        <Svg width="100%" height="100%" viewBox="0 0 390 360" preserveAspectRatio="xMidYMid slice">
          <Defs>
            <LinearGradient id="authGradient" x1="18" y1="18" x2="370" y2="342" gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor={colors.brand[900]} />
              <Stop offset="0.56" stopColor={colors.brand[700]} />
              <Stop offset="1" stopColor={colors.brand[500]} />
            </LinearGradient>
          </Defs>
          <Rect width="390" height="360" fill="url(#authGradient)" />
          <Path
            d="M-22 250C52 181 110 298 185 222C245 161 292 183 418 101"
            fill="none"
            opacity="0.14"
            stroke={colors.white}
            strokeDasharray="5 11"
            strokeLinecap="round"
            strokeWidth="2"
          />
          <Circle cx="42" cy="94" r="3" fill={colors.white} opacity="0.18" />
          <Circle cx="82" cy="58" r="2" fill={colors.white} opacity="0.14" />
          <Circle cx="330" cy="70" r="3" fill={colors.white} opacity="0.16" />
          <Circle cx="356" cy="128" r="2" fill={colors.white} opacity="0.2" />
          <Circle cx="285" cy="174" r="2.5" fill={colors.white} opacity="0.13" />
          <Circle cx="115" cy="196" r="2" fill={colors.white} opacity="0.16" />
        </Svg>
      </View>

      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.hero}>
              <View style={styles.topRow}>
                {onBack ? (
                  <Pressable
                    accessibilityLabel="Go back"
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={onBack}
                    style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                  >
                    <ArrowLeft color={colors.white} size={21} />
                  </Pressable>
                ) : (
                  <View style={styles.backPlaceholder} />
                )}

                <View style={styles.brandLockup}>
                  <NolsafLogoMark height={28} width={26} />
                  <AppText variant="bodySmall" tone="inverse" weight="extraBold" style={styles.brandName}>
                    NoLSAF
                  </AppText>
                </View>

                <View style={styles.secureBadge}>
                  <ShieldCheck color={colors.brand[100]} size={15} />
                  <AppText variant="caption" tone="inverse" weight="semiBold">
                    Secure
                  </AppText>
                </View>
              </View>

              <View style={styles.heroCopy}>
                <View style={styles.heroIcon}>{icon ?? <ShieldCheck color={colors.white} size={24} />}</View>
                <View style={styles.heroText}>
                  <AppText variant="headline" tone="inverse" weight="extraBold">
                    {title}
                  </AppText>
                  <AppText variant="bodySmall" tone="inverse" style={styles.subtitle}>
                    {subtitle}
                  </AppText>
                </View>
              </View>

              {progress ? (
                <View style={styles.progressWrap} accessibilityLabel={`${progress.label}, step ${progress.current} of ${progress.total}`}>
                  <View style={styles.progressHeader}>
                    <AppText variant="caption" tone="inverse" weight="semiBold">
                      {progress.label}
                    </AppText>
                    <AppText variant="caption" tone="inverse">
                      {progress.current}/{progress.total}
                    </AppText>
                  </View>
                  <View style={styles.progressTrack}>
                    {Array.from({ length: progress.total }).map((_, index) => (
                      <View key={index} style={[styles.progressSegment, index < progress.current && styles.progressSegmentActive]} />
                    ))}
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.content}>
              {children}
              {footer ? <View style={styles.footer}>{footer}</View> : null}
              <View style={styles.trustLine}>
                <ShieldCheck color={colors.primary} size={14} />
                <AppText variant="caption" tone="muted" style={styles.trustText}>
                  Your account is protected with encrypted verification.
                </AppText>
              </View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  heroBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 360
  },
  safeArea: {
    flex: 1
  },
  keyboard: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1
  },
  hero: {
    minHeight: 250,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[8]
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.08)"
  },
  backPlaceholder: {
    width: 42
  },
  brandLockup: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  brandName: {
    letterSpacing: 0.5
  },
  secureBadge: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(0,0,0,0.12)",
    paddingHorizontal: spacing[3]
  },
  heroCopy: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    marginTop: spacing[8]
  },
  heroIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)",
    backgroundColor: "rgba(255,255,255,0.12)"
  },
  heroText: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1]
  },
  subtitle: {
    color: colors.brand[100],
    opacity: 0.96
  },
  progressWrap: {
    gap: spacing[2],
    marginTop: spacing[5]
  },
  progressHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  progressTrack: {
    flexDirection: "row",
    gap: spacing[2]
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.2)"
  },
  progressSegmentActive: {
    backgroundColor: colors.white
  },
  content: {
    flexGrow: 1,
    marginTop: -spacing[5],
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: spacing[8]
  },
  footer: {
    marginTop: spacing[5]
  },
  trustLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    marginTop: spacing[6],
    paddingHorizontal: spacing[3]
  },
  trustText: {
    textAlign: "center"
  },
  pressed: {
    opacity: 0.74,
    transform: [{ scale: 0.97 }]
  }
});

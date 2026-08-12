import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppCard, AppText, colors, radius, spacing } from "@nolsaf/native-ui";
import { ArrowLeft, ChevronRight, Clock, Fingerprint, Lock, ShieldAlert, ShieldCheck } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { ReactElement } from "react";

import { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Security">;

const LINKS: Array<{
  key: "ChangePassword" | "Passkeys" | "TwoFactor" | "LoginHistory" | "Safety";
  label: string;
  description: string;
  icon: (color: string) => ReactElement;
}> = [
  { key: "ChangePassword", label: "Password", description: "Change your account password", icon: (c) => <Lock color={c} size={20} /> },
  { key: "Passkeys", label: "Passkeys", description: "Use fingerprint, Face ID, or device lock", icon: (c) => <Fingerprint color={c} size={20} /> },
  { key: "TwoFactor", label: "Two factor authentication", description: "Add an extra layer of security", icon: (c) => <ShieldCheck color={c} size={20} /> },
  { key: "LoginHistory", label: "Login history", description: "Review recent sign ins", icon: (c) => <Clock color={c} size={20} /> },
  { key: "Safety", label: "Safety", description: "Hard braking, speeding, and other flags", icon: (c) => <ShieldAlert color={c} size={20} /> }
];

export function SecurityScreen({ navigation }: Props) {
  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color={colors.ink} size={22} />
        </Pressable>
        <AppText variant="title" weight="bold">
          Security
        </AppText>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {LINKS.map((link) => (
          <Pressable key={link.key} accessibilityRole="button" onPress={() => navigation.navigate(link.key)}>
            <AppCard style={styles.linkCard}>
              <View style={styles.linkIcon}>{link.icon(colors.primary)}</View>
              <View style={styles.linkText}>
                <AppText variant="bodySmall" weight="bold">
                  {link.label}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {link.description}
                </AppText>
              </View>
              <ChevronRight color={colors.mutedText} size={18} />
            </AppCard>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4]
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
  },
  scrollContent: {
    gap: spacing[3],
    padding: spacing[4],
    paddingBottom: spacing[8]
  },
  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  linkIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  linkText: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1]
  }
});

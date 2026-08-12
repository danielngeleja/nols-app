import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppCard, AppText, colors, radius, spacing } from "@nolsaf/native-ui";
import { FileText, Gift, Trophy, Users, Wallet } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { ReactElement } from "react";

import { DriverBottomNav } from "../components/DriverBottomNav";
import { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Earnings">;

const QUICK_LINKS: Array<{
  key: "Payouts" | "Bonus" | "Level" | "Referral" | "Invoices";
  label: string;
  description: string;
  icon: (color: string) => ReactElement;
}> = [
  { key: "Payouts", label: "Payouts", description: "Your completed payouts", icon: (c) => <Wallet color={c} size={20} /> },
  { key: "Bonus", label: "Bonus", description: "Eligibility and history", icon: (c) => <Gift color={c} size={20} /> },
  { key: "Level", label: "Level", description: "Progress and benefits", icon: (c) => <Trophy color={c} size={20} /> },
  { key: "Referral", label: "Referral", description: "Invite drivers and earn", icon: (c) => <Users color={c} size={20} /> },
  { key: "Invoices", label: "Invoices", description: "Receipts and statements", icon: (c) => <FileText color={c} size={20} /> }
];

export function EarningsScreen({ navigation }: Props) {
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <AppText variant="title" weight="bold">
          Earnings
        </AppText>
        <AppText variant="bodySmall" tone="muted">
          Track your payouts, bonuses, level progress, referrals, and invoices.
        </AppText>

        <View style={styles.linksWrap}>
          {QUICK_LINKS.map((link) => (
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
              </AppCard>
            </Pressable>
          ))}
        </View>
      </ScrollView>
      <DriverBottomNav active="Earnings" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  scrollContent: {
    gap: spacing[4],
    padding: spacing[4],
    paddingBottom: spacing[8]
  },
  linksWrap: {
    gap: spacing[3]
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

import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppButton, AppCard, AppText, colors, radius, SafeScreen, spacing } from "@nolsaf/native-ui";
import { ChevronRight, FileText, HelpCircle, Settings, ShieldCheck, UserCircle } from "lucide-react-native";
import { useState, type ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { DriverBottomNav } from "../components/DriverBottomNav";
import { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Account">;

const LINKS: Array<{
  key: "Profile" | "Management" | "Security" | "Policies" | "Support";
  label: string;
  description: string;
  icon: (color: string) => ReactElement;
}> = [
  { key: "Profile", label: "Profile", description: "Personal, vehicle, and payout details", icon: (c) => <UserCircle color={c} size={20} /> },
  { key: "Management", label: "Management", description: "License, insurance, and contract", icon: (c) => <FileText color={c} size={20} /> },
  { key: "Security", label: "Security", description: "Password, two factor, and login history", icon: (c) => <ShieldCheck color={c} size={20} /> },
  { key: "Policies", label: "Policies", description: "Terms, privacy, and other policies", icon: (c) => <Settings color={c} size={20} /> },
  { key: "Support", label: "Support", description: "Frequently asked questions and contact", icon: (c) => <HelpCircle color={c} size={20} /> }
];

export function AccountScreen({ navigation }: Props) {
  const { user, signOut } = useAuth();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await signOut();
    } finally {
      setLoggingOut(false);
    }
  }

  const name = user?.fullName || user?.name || "Driver";

  return (
    <SafeScreen contentStyle={styles.content}>
      <AppText variant="headline" weight="extraBold">
        Account
      </AppText>

      <AppCard>
        <View style={styles.identityRow}>
          <View style={styles.avatar}>
            <UserCircle color={colors.primary} size={32} />
          </View>
          <View style={styles.identity}>
            <AppText variant="title" weight="bold">
              {name}
            </AppText>
            {user?.email ? (
              <AppText variant="bodySmall" tone="muted">
                {user.email}
              </AppText>
            ) : null}
          </View>
        </View>
      </AppCard>

      <View style={styles.linksWrap}>
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
      </View>

      <AppButton title="Log out" variant="secondary" loading={loggingOut} onPress={handleLogout} />

      <View style={styles.navWrap}>
        <DriverBottomNav active="Account" />
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: 16
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  identity: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2
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
  },
  navWrap: {
    marginTop: "auto",
    marginHorizontal: -16,
    marginBottom: -16
  }
});

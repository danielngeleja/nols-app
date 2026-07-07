import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Bell, Gift, Shield, ShieldAlert, Tag, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Modal, Switch, View } from "react-native";
import { StyleSheet } from "react-native";

import { useAuth } from "../auth";
import { deleteMyAccount, fetchNotificationPreferences, updateNotificationPreferences } from "../accountPreferences";
import { NotificationPreferences } from "../accountPreferences/types";
import { AppButton, AppCard, AppInput, AppStack, AppText, ConfirmSheet, SafeScreen, ScreenHeader } from "../components";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "AccountPreferences">;
type IconType = typeof Bell;

const TOGGLES: { key: keyof NotificationPreferences; Icon: IconType; title: string; description: string }[] = [
  { key: "bookings", Icon: Bell, title: "Booking updates", description: "Confirmations, reminders, and changes to your rides, stays, and tours." },
  { key: "promotions", Icon: Tag, title: "Offers and promotions", description: "Deals, discounts, and new features from NoLSAF." },
  { key: "referrals", Icon: Gift, title: "Referral activity", description: "Updates when a friend joins using your invite link." }
];

const DELETE_WARNINGS = [
  "Your profile, saved places, and travel history will be permanently deleted.",
  "Any active bookings linked to your account may be cancelled.",
  "You will lose access immediately. No recovery is possible."
];

export function AccountPreferencesScreen({ navigation }: Props) {
  const { token, user, signOut } = useAuth();
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<keyof NotificationPreferences | null>(null);
  const [deleteStep, setDeleteStep] = useState<"confirm" | "verify" | null>(null);
  const [deleteNameInput, setDeleteNameInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const fullName = (user?.fullName || user?.name || "").trim();

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    fetchNotificationPreferences(token)
      .then(setPrefs)
      .catch(() => setPrefs({ bookings: true, promotions: true, referrals: true }))
      .finally(() => setLoading(false));
  }, [token]);

  async function toggle(key: keyof NotificationPreferences, value: boolean) {
    if (!token || !prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    setSavingKey(key);
    try {
      const updated = await updateNotificationPreferences(token, { [key]: value });
      setPrefs(updated);
    } catch {
      setPrefs(previous);
      Alert.alert("Notification preferences", "Could not save this change. Please try again.");
    } finally {
      setSavingKey(null);
    }
  }

  function closeDeleteFlow() {
    setDeleteStep(null);
    setDeleteNameInput("");
  }

  async function confirmDeleteAccount() {
    if (!token) return;
    setDeleting(true);
    try {
      await deleteMyAccount(token);
      await signOut();
    } catch {
      setDeleting(false);
      Alert.alert("Delete account", "Could not delete your account right now. Please try again later.");
      return;
    }
    setDeleting(false);
    closeDeleteFlow();
  }

  return (
    <SafeScreen contentStyle={styles.screen}>
      <View style={styles.content}>
        <ScreenHeader
          title="Account preferences"
          subtitle="Choose what NoLSAF notifies you about, and manage account-level controls."
          onBack={() => navigation.goBack()}
        />

        <AppCard style={styles.section}>
          <AppText variant="titleSm" weight="extraBold">
            Notifications
          </AppText>
          {loading || !prefs ? (
            <ActivityIndicator color={colors.primary} style={styles.loader} />
          ) : (
            <View style={styles.toggleList}>
              {TOGGLES.map(({ key, Icon, title, description }) => (
                <View key={key} style={styles.toggleRow}>
                  <View style={styles.toggleIcon}>
                    <Icon color={colors.primary} size={18} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodySmall" weight="extraBold">
                      {title}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {description}
                    </AppText>
                  </View>
                  {savingKey === key ? (
                    <ActivityIndicator color={colors.primary} />
                  ) : (
                    <Switch
                      value={prefs[key]}
                      onValueChange={(value) => toggle(key, value)}
                      trackColor={{ true: colors.primary, false: colors.border }}
                    />
                  )}
                </View>
              ))}
            </View>
          )}
        </AppCard>

        <AppCard style={styles.dangerSection}>
          <View style={styles.dangerHeader}>
            <View style={styles.dangerIcon}>
              <ShieldAlert color={colors.danger} size={20} />
            </View>
            <View style={styles.flex}>
              <AppText variant="titleSm" weight="extraBold">
                Account controls
              </AppText>
              <AppText variant="caption" tone="muted">
                Permanently delete your NoLSAF account and personal data.
              </AppText>
            </View>
          </View>
          <View style={styles.deleteRow}>
            <Trash2 color={colors.danger} size={18} />
            <AppText variant="bodySmall" weight="extraBold" tone="danger" onPress={() => setDeleteStep("confirm")}>
              Delete my account
            </AppText>
          </View>
        </AppCard>
      </View>

      <ConfirmSheet
        visible={deleteStep === "confirm"}
        title="Delete your account?"
        message={`This action is permanent and irreversible. Before you continue, understand what will be lost:\n\n${DELETE_WARNINGS.map((w) => `• ${w}`).join("\n")}`}
        confirmLabel="Yes, continue"
        cancelLabel="No, keep my account"
        destructive
        onCancel={closeDeleteFlow}
        onConfirm={() => setDeleteStep("verify")}
      />

      <Modal visible={deleteStep === "verify"} transparent animationType="fade" onRequestClose={closeDeleteFlow}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <AppStack gap={4}>
              <View style={styles.verifyIcon}>
                <Shield color={colors.danger} size={20} />
              </View>
              <AppStack gap={1}>
                <AppText variant="title" weight="bold" style={styles.center}>
                  Final confirmation
                </AppText>
                <AppText variant="bodySmall" tone="muted" style={styles.center}>
                  Type your full name exactly as registered to confirm deletion.
                </AppText>
              </AppStack>
              <AppText variant="bodySmall" weight="extraBold" style={[styles.center, styles.nameBadge]}>
                {fullName || "—"}
              </AppText>
              <AppInput
                label="Full name"
                value={deleteNameInput}
                onChangeText={setDeleteNameInput}
                placeholder="Type your full name..."
                autoCapitalize="none"
                autoCorrect={false}
              />
              <AppStack gap={2}>
                <AppButton
                  title={deleting ? "Deleting..." : "Permanently delete my account"}
                  variant="danger"
                  loading={deleting}
                  disabled={!fullName || deleteNameInput.trim() !== fullName}
                  onPress={confirmDeleteAccount}
                />
                <AppButton title="Back" variant="ghost" onPress={() => setDeleteStep("confirm")} />
              </AppStack>
              <AppText variant="caption" tone="muted" style={styles.center}>
                This cannot be undone.
              </AppText>
            </AppStack>
          </View>
        </View>
      </Modal>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingBottom: spacing[10]
  },
  content: {
    gap: spacing[4]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  section: {
    gap: spacing[3]
  },
  loader: {
    paddingVertical: spacing[4]
  },
  toggleList: {
    gap: spacing[3]
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  toggleIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  dangerSection: {
    gap: spacing[3],
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca"
  },
  dangerHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  dangerIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#fecaca"
  },
  deleteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.42)",
    padding: spacing[4]
  },
  sheet: {
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    padding: spacing[5],
    ...shadows.sheet
  },
  verifyIcon: {
    alignSelf: "center",
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca"
  },
  center: {
    textAlign: "center"
  },
  nameBadge: {
    fontFamily: "monospace",
    backgroundColor: "#f1f5f9",
    borderRadius: radius.md,
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3]
  }
});

import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AppButton,
  AppCard,
  AppStack,
  AppText,
  colors,
  deleteNativePasskey,
  formatPasskeyError,
  listNativePasskeys,
  NativePasskeyItem,
  radius,
  registerNativePasskey,
  spacing
} from "@nolsaf/native-ui";
import { ArrowLeft, Fingerprint, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Passkeys">;

const API_BASE = "/api/driver/security/passkeys";

function fmtDate(value?: string | null) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date not recorded" : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function PasskeysScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [items, setItems] = useState<NativePasskeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await listNativePasskeys(API_BASE, token);
      setItems(res.items || []);
    } catch {
      setMessage("Could not load passkeys right now.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function addPasskey() {
    if (!token || registering) return;
    setRegistering(true);
    setMessage(null);
    try {
      const res = await registerNativePasskey(API_BASE, token);
      if (res.item) setItems((current) => [res.item!, ...current.filter((item) => item.id !== res.item!.id)]);
      setMessage("Passkey added.");
      await load();
    } catch (err) {
      Alert.alert("Passkeys", formatPasskeyError(err, "Could not add a passkey. Use your password and try again."));
    } finally {
      setRegistering(false);
    }
  }

  async function removePasskey(id: string) {
    if (!token) return;
    try {
      await deleteNativePasskey(API_BASE, token, id);
      setItems((current) => current.filter((item) => item.id !== id));
      setMessage("Passkey removed.");
    } catch (err) {
      Alert.alert("Passkeys", err instanceof Error ? err.message : "Could not remove this passkey.");
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.headerRow}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color={colors.ink} size={22} />
        </Pressable>
        <AppText variant="title" weight="bold">
          Passkeys
        </AppText>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <AppCard>
          <AppStack gap={4}>
            <View style={styles.heroRow}>
              <View style={styles.heroIcon}>
                <Fingerprint color={colors.primary} size={22} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold">
                  Sign in with this device
                </AppText>
                <AppText variant="caption" tone="muted">
                  Add a passkey to use fingerprint, Face ID, screen lock, or a security key.
                </AppText>
              </View>
            </View>
            <AppButton title="Add passkey" loading={registering} onPress={addPasskey} icon={<Fingerprint color={colors.white} size={16} />} />
          </AppStack>
        </AppCard>

        <AppCard>
          <AppStack gap={3}>
            <View style={styles.sectionHead}>
              <AppText variant="bodySmall" weight="bold">
                Registered passkeys
              </AppText>
              {loading ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
            {!loading && !items.length ? (
              <View style={styles.emptyBox}>
                <Fingerprint color={colors.primary} size={22} />
                <AppText variant="caption" tone="muted" style={styles.centerText}>
                  No passkey has been added yet.
                </AppText>
              </View>
            ) : null}
            {items.map((item) => (
              <View key={item.id} style={styles.passkeyRow}>
                <View style={styles.roundIcon}>
                  <Fingerprint color={colors.primary} size={16} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="bold">
                    {item.name || "Passkey"}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    Created {fmtDate(item.createdAt)}
                  </AppText>
                </View>
                <Pressable accessibilityRole="button" onPress={() => removePasskey(item.id)} style={styles.iconButton}>
                  <Trash2 color={colors.danger} size={17} />
                </Pressable>
              </View>
            ))}
            {message ? (
              <AppText variant="caption" tone="muted">
                {message}
              </AppText>
            ) : null}
          </AppStack>
        </AppCard>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
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
  scrollContent: { gap: spacing[4], padding: spacing[4], paddingBottom: spacing[8] },
  heroRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  emptyBox: {
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[4]
  },
  centerText: { textAlign: "center" },
  passkeyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  roundIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50]
  },
  iconButton: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca"
  }
});

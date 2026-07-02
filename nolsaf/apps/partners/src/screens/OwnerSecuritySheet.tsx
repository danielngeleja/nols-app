import {
  AppButton,
  AppInput,
  AppText,
  apiRequest,
  colors,
  deleteNativePasskey,
  formatPasskeyError,
  getErrorMessage,
  listNativePasskeys,
  NativePasskeyItem,
  radius,
  registerNativePasskey,
  spacing
} from "@nolsaf/native-ui";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Building2,
  CalendarX,
  CheckCircle,
  CircleDollarSign,
  Fingerprint,
  KeyRound,
  MonitorSmartphone,
  ShieldCheck,
  Trash2,
  UserX,
  Users,
  X
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth";
import { clearStoredToken } from "../auth/secureSession";

type Props = {
  visible: boolean;
  onClose: () => void;
};

const PASSKEYS_API_BASE = "/api/account/security/passkeys";

// What gets wiped — shown in the Step 2 warning
const DELETION_CONSEQUENCES = [
  { icon: UserX,            color: colors.danger,           text: "Your profile and account access, permanently revoked" },
  { icon: Building2,        color: colors.accent.amberDark, text: "All property listings and availability settings" },
  { icon: BookOpen,         color: colors.accent.blue,      text: "All booking records and guest history" },
  { icon: CircleDollarSign, color: colors.accent.green,     text: "All revenue records and payout history" },
  { icon: Users,            color: colors.primary,          text: "All Group Stay bids you have submitted" },
  { icon: CalendarX,        color: colors.danger,           text: "All saved preferences and notification settings" },
];

export function OwnerSecuritySheet({ visible, onClose }: Props) {
  const { token, user, signOut } = useAuth();
  const insets = useSafeAreaInsets();

  // Change password
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  // Sessions
  const [sessionLoading, setSessionLoading] = useState(false);

  // Passkeys
  const [passkeys, setPasskeys] = useState<NativePasskeyItem[]>([]);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyRegistering, setPasskeyRegistering] = useState(false);
  const [passkeyMessage, setPasskeyMessage] = useState<string | null>(null);

  // Delete flow: 0 = idle, 1 = warning, 2 = name confirmation
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [nameInput, setNameInput] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmedName = user?.fullName ?? user?.name ?? "";
  const nameMatches = nameInput.trim().toLowerCase() === confirmedName.trim().toLowerCase();

  const resetAll = () => {
    setCurrent(""); setNext(""); setConfirm("");
    setPwError(null); setPwSuccess(false);
    setDeleteStep(0); setNameInput(""); setDeleteError(null);
    setPasskeyMessage(null);
  };

  const handleClose = () => { resetAll(); onClose(); };

  // ── Change password ──────────────────────────────────────────────────────
  const onChangePassword = async () => {
    setPwError(null); setPwSuccess(false);
    if (!current) { setPwError("Enter your current password."); return; }
    if (next.length < 8) { setPwError("New password must be at least 8 characters."); return; }
    if (next !== confirm) { setPwError("Passwords do not match."); return; }
    setPwLoading(true);
    try {
      await apiRequest("/api/account/password", {
        method: "PUT",
        token: token ?? undefined,
        body: { currentPassword: current, newPassword: next }
      });
      setCurrent(""); setNext(""); setConfirm("");
      setPwSuccess(true);
    } catch (err) {
      setPwError(getErrorMessage(err, "Could not update password. Check your current password and try again."));
    } finally {
      setPwLoading(false);
    }
  };

  // ── Sessions ─────────────────────────────────────────────────────────────
  const onSignOutAllDevices = () => {
    Alert.alert(
      "Sign out all devices",
      "This will end all active sessions except this one.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign out all",
          style: "destructive",
          onPress: async () => {
            setSessionLoading(true);
            try {
              await apiRequest("/api/auth/sessions/revoke-all", {
                method: "POST",
                token: token ?? undefined
              });
              Alert.alert("Done", "All other sessions have been signed out.");
            } catch {
              Alert.alert("Error", "Could not sign out other sessions. Try again.");
            } finally {
              setSessionLoading(false);
            }
          }
        }
      ]
    );
  };

  const loadPasskeys = useCallback(async () => {
    if (!token) return;
    setPasskeyLoading(true);
    try {
      const res = await listNativePasskeys(PASSKEYS_API_BASE, token);
      setPasskeys(res.items || []);
    } catch {
      setPasskeyMessage("Could not load passkeys right now.");
    } finally {
      setPasskeyLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (visible) void loadPasskeys();
  }, [loadPasskeys, visible]);

  const onAddPasskey = async () => {
    if (!token || passkeyRegistering) return;
    setPasskeyRegistering(true);
    setPasskeyMessage(null);
    try {
      const res = await registerNativePasskey(PASSKEYS_API_BASE, token);
      if (res.item) setPasskeys((current) => [res.item!, ...current.filter((item) => item.id !== res.item!.id)]);
      setPasskeyMessage("Passkey added.");
      await loadPasskeys();
    } catch (err) {
      Alert.alert("Passkeys", formatPasskeyError(err, "Could not add a passkey. Use password and try again."));
    } finally {
      setPasskeyRegistering(false);
    }
  };

  const onRemovePasskey = async (id: string) => {
    if (!token) return;
    try {
      await deleteNativePasskey(PASSKEYS_API_BASE, token, id);
      setPasskeys((current) => current.filter((item) => item.id !== id));
      setPasskeyMessage("Passkey removed.");
    } catch (err) {
      Alert.alert("Passkeys", err instanceof Error ? err.message : "Could not remove this passkey.");
    }
  };

  // ── Delete account (step 3) ───────────────────────────────────────────────
  const onConfirmDelete = async () => {
    if (!nameMatches) return;
    setDeleteError(null);
    setDeleteLoading(true);
    try {
      await apiRequest("/api/account/delete", {
        method: "DELETE",
        token: token ?? undefined
      });
      await clearStoredToken();
      handleClose();
      await signOut();
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Could not delete account. Please contact support if this persists."));
      setDeleteLoading(false);
    }
  };

  // ── Header label changes per step ────────────────────────────────────────
  const headerTitle =
    deleteStep === 1 ? "What you will lose" :
    deleteStep === 2 ? "Confirm deletion" :
    "Security & Password";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} />

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing[4]) }]}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {deleteStep > 0 ? (
              <Pressable
                onPress={() => setDeleteStep(deleteStep === 2 ? 1 : 0)}
                style={styles.backBtn}
                accessibilityRole="button"
                accessibilityLabel="Back"
              >
                <ArrowLeft size={18} color={colors.mutedText} />
              </Pressable>
            ) : (
              <View style={styles.headerIcon}>
                <ShieldCheck size={18} color={colors.primary} />
              </View>
            )}
            <AppText variant="bodySmall" weight="semiBold">{headerTitle}</AppText>
          </View>
          <Pressable onPress={handleClose} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Close">
            <X size={18} color={colors.mutedText} />
          </Pressable>
        </View>

        {/* ── Step 0: Main security content ───────────────────────────── */}
        {deleteStep === 0 && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>

            {/* Change password */}
            <View style={styles.sectionLabel}>
              <KeyRound size={13} color={colors.softText} />
              <AppText variant="caption" style={styles.sectionLabelText}>CHANGE PASSWORD</AppText>
            </View>
            <View style={styles.card}>
              <AppInput
                label="Current password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="current-password"
                textContentType="password"
                placeholder="Your current password"
                value={current}
                onChangeText={v => { setCurrent(v); setPwError(null); setPwSuccess(false); }}
              />
              <AppInput
                label="New password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                placeholder="At least 8 characters"
                value={next}
                onChangeText={v => { setNext(v); setPwError(null); setPwSuccess(false); }}
              />
              <AppInput
                label="Confirm new password"
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                textContentType="newPassword"
                placeholder="Repeat new password"
                value={confirm}
                onChangeText={v => { setConfirm(v); setPwError(null); setPwSuccess(false); }}
                error={pwError ?? undefined}
              />
              {pwSuccess ? (
                <View style={styles.successRow}>
                  <CheckCircle size={15} color={colors.success} />
                  <AppText variant="caption" style={styles.successText}>Password updated successfully.</AppText>
                </View>
              ) : null}
              <AppButton title="Update password" loading={pwLoading} onPress={onChangePassword} />
            </View>

            {/* Sessions */}
            <View style={styles.sectionLabel}>
              <MonitorSmartphone size={13} color={colors.softText} />
              <AppText variant="caption" style={styles.sectionLabelText}>ACTIVE SESSIONS</AppText>
            </View>
            <View style={styles.card}>
              <View style={styles.sessionRow}>
                <View style={styles.sessionDot} />
                <View style={styles.sessionInfo}>
                  <AppText variant="bodySmall" weight="medium" numberOfLines={1}>This device</AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={1}>Current session · Partners app</AppText>
                </View>
                <View style={styles.activePill}>
                  <AppText variant="caption" style={styles.activePillText}>Active</AppText>
                </View>
              </View>
              <View style={styles.cardDivider} />
              <AppButton
                title={sessionLoading ? "Signing out…" : "Sign out all other devices"}
                variant="secondary"
                onPress={onSignOutAllDevices}
              />
            </View>

            {/* Passkeys */}
            <View style={styles.sectionLabel}>
              <Fingerprint size={13} color={colors.softText} />
              <AppText variant="caption" style={styles.sectionLabelText}>PASSKEYS</AppText>
            </View>
            <View style={styles.card}>
              <View style={styles.passkeyHeader}>
                <View style={styles.sessionInfo}>
                  <AppText variant="bodySmall" weight="medium" numberOfLines={1}>Passwordless sign-in</AppText>
                  <AppText variant="caption" tone="muted">Use fingerprint, Face ID, screen lock, or a security key.</AppText>
                </View>
                {passkeyLoading ? <ActivityIndicator color={colors.primary} /> : null}
              </View>
              {passkeys.length ? (
                <View style={styles.passkeyList}>
                  {passkeys.map((item) => (
                    <View key={item.id} style={styles.passkeyRow}>
                      <View style={styles.passkeyIcon}>
                        <Fingerprint size={15} color={colors.primary} />
                      </View>
                      <View style={styles.sessionInfo}>
                        <AppText variant="caption" weight="semiBold" numberOfLines={1}>{item.name || "Passkey"}</AppText>
                        <AppText variant="caption" tone="muted" numberOfLines={1}>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "Date not recorded"}</AppText>
                      </View>
                      <Pressable accessibilityRole="button" onPress={() => onRemovePasskey(item.id)} style={styles.passkeyRemoveBtn}>
                        <Trash2 size={15} color={colors.danger} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : (
                <AppText variant="caption" tone="muted">No passkey has been added yet.</AppText>
              )}
              {passkeyMessage ? <AppText variant="caption" tone="muted">{passkeyMessage}</AppText> : null}
              <AppButton
                title={passkeyRegistering ? "Adding passkey..." : "Add passkey"}
                loading={passkeyRegistering}
                onPress={onAddPasskey}
              />
            </View>

            {/* Danger zone */}
            <View style={styles.sectionLabel}>
              <AlertTriangle size={13} color={colors.danger} />
              <AppText variant="caption" style={[styles.sectionLabelText, { color: colors.danger }]}>DANGER ZONE</AppText>
            </View>
            <View style={[styles.card, styles.dangerCard]}>
              <View style={styles.dangerRow}>
                <View style={styles.dangerIcon}>
                  <Trash2 size={18} color={colors.danger} />
                </View>
                <View style={styles.dangerText}>
                  <AppText variant="bodySmall" weight="semiBold" style={{ color: colors.danger }}>
                    Delete account
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    Permanently removes your account, all properties and booking history. Cannot be undone.
                  </AppText>
                </View>
              </View>
              <AppButton
                title="Delete my account"
                variant="danger"
                onPress={() => setDeleteStep(1)}
              />
            </View>

            <View style={{ height: spacing[2] }} />
          </ScrollView>
        )}

        {/* ── Step 1: Detailed warning ─────────────────────────────────── */}
        {deleteStep === 1 && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={styles.warningBanner}>
              <AlertTriangle size={22} color={colors.danger} />
              <AppText variant="bodySmall" weight="semiBold" style={styles.warningBannerText}>
                Deleting your account is permanent and cannot be reversed by NoLSAF support.
              </AppText>
            </View>

            <AppText variant="caption" tone="muted" style={styles.warningIntro}>
              The following will be permanently and immediately removed from our systems:
            </AppText>

            <View style={[styles.card, styles.lossCard]}>
              {DELETION_CONSEQUENCES.map((item, i) => (
                <View key={i} style={[styles.lossRow, i < DELETION_CONSEQUENCES.length - 1 && styles.lossRowBorder]}>
                  <View style={[styles.lossIcon, { backgroundColor: `${item.color}18` }]}>
                    <item.icon size={16} color={item.color} />
                  </View>
                  <AppText variant="caption" style={styles.lossText}>{item.text}</AppText>
                </View>
              ))}
            </View>

            <View style={styles.warningNote}>
              <AppText variant="caption" tone="muted" style={{ textAlign: "center" }}>
                Your active bookings will still be honoured by NoLSAF until their completion date, but you will lose access to manage them.
              </AppText>
            </View>

            <AppButton
              title="I understand — continue to delete"
              variant="danger"
              onPress={() => setDeleteStep(2)}
            />
            <AppButton
              title="Go back, keep my account"
              variant="secondary"
              onPress={() => setDeleteStep(0)}
            />
            <View style={{ height: spacing[2] }} />
          </ScrollView>
        )}

        {/* ── Step 2: Name confirmation ────────────────────────────────── */}
        {deleteStep === 2 && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <View style={[styles.warningBanner, styles.warningBannerDark]}>
              <Trash2 size={20} color={colors.danger} />
              <AppText variant="bodySmall" weight="semiBold" style={styles.warningBannerText}>
                This is your final step. There is no undo.
              </AppText>
            </View>

            <View style={styles.namePromptCard}>
              <AppText variant="bodySmall" weight="medium" style={styles.namePromptLabel}>
                Type your full name to confirm
              </AppText>
              <View style={styles.nameHint}>
                <AppText variant="caption" tone="muted">Your name on record: </AppText>
                <AppText variant="caption" weight="semiBold" style={{ color: colors.ink }}>
                  {confirmedName || "—"}
                </AppText>
              </View>

              <TextInput
                value={nameInput}
                onChangeText={v => { setNameInput(v); setDeleteError(null); }}
                placeholder={confirmedName || "Your full name"}
                placeholderTextColor={colors.softText}
                autoCapitalize="words"
                autoCorrect={false}
                style={[
                  styles.nameInput,
                  nameInput.length > 0 && (nameMatches ? styles.nameInputOk : styles.nameInputErr)
                ]}
              />

              {nameInput.length > 0 && !nameMatches && (
                <AppText variant="caption" style={styles.nameErrorText}>
                  Name does not match. Type it exactly as shown above.
                </AppText>
              )}

              {deleteError ? (
                <AppText variant="caption" style={styles.nameErrorText}>{deleteError}</AppText>
              ) : null}
            </View>

            <AppButton
              title={deleteLoading ? "Deleting…" : "Permanently delete my account"}
              variant="danger"
              disabled={!nameMatches || deleteLoading}
              onPress={onConfirmDelete}
            />
            <AppButton
              title="Cancel, keep my account"
              variant="secondary"
              onPress={() => { setDeleteStep(0); setNameInput(""); setDeleteError(null); }}
            />
            <View style={{ height: spacing[2] }} />
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)"
  },
  sheet: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    backgroundColor: colors.white,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: "94%"
  },
  handle: {
    width: 36, height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginTop: spacing[2]
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  headerIcon: {
    width: 30, height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center"
  },
  backBtn: {
    width: 30, height: 30,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  closeBtn: {
    width: 32, height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  scroll: { padding: spacing[4], gap: spacing[3] },
  sectionLabel: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  sectionLabelText: { color: colors.softText, letterSpacing: 1.1, fontSize: 10 },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4],
    gap: spacing[3]
  },
  dangerCard: { borderColor: "#fca5a5", backgroundColor: "#fff8f8" },
  cardDivider: { height: 1, backgroundColor: colors.border },
  successRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  successText: { color: colors.success },
  sessionRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  sessionDot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.success },
  sessionInfo: { flex: 1, minWidth: 0 },
  passkeyHeader: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  passkeyList: { gap: spacing[2] },
  passkeyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[2]
  },
  passkeyIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  passkeyRemoveBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca"
  },
  activePill: {
    paddingHorizontal: spacing[2], paddingVertical: 3,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1, borderColor: colors.brand[100]
  },
  activePillText: { color: colors.primary, fontSize: 10 },
  dangerRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  dangerIcon: {
    width: 36, height: 36,
    borderRadius: radius.sm,
    backgroundColor: "#fef2f2",
    alignItems: "center", justifyContent: "center"
  },
  dangerText: { flex: 1, minWidth: 0, gap: 3 },

  // Warning / consequence styles
  warningBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    backgroundColor: "#fef2f2",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#fca5a5",
    padding: spacing[3]
  },
  warningBannerDark: { backgroundColor: "#fee2e2" },
  warningBannerText: { flex: 1, color: colors.danger },
  warningIntro: { marginTop: spacing[1] },
  lossCard: { gap: 0, padding: 0, overflow: "hidden" },
  lossRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    padding: spacing[3]
  },
  lossRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  lossIcon: {
    width: 32, height: 32,
    borderRadius: radius.sm,
    alignItems: "center", justifyContent: "center"
  },
  lossText: { flex: 1, color: colors.ink },
  warningNote: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[3]
  },

  // Name confirmation styles
  namePromptCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#fca5a5",
    backgroundColor: "#fff8f8",
    padding: spacing[4],
    gap: spacing[2]
  },
  namePromptLabel: { color: colors.ink },
  nameHint: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  nameInput: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing[3],
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.white,
    marginTop: spacing[1]
  },
  nameInputOk: { borderColor: colors.success },
  nameInputErr: { borderColor: colors.danger },
  nameErrorText: { color: colors.danger }
});

import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Smartphone,
  Trash2
} from "lucide-react-native";
import { formatPasskeyError, registerNativePasskey } from "@nolsaf/native-ui";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAuth } from "../auth";
import {
  Account2faStatus,
  AccountPasskey,
  changeAccountPassword,
  deleteAccountPasskey,
  fetchAccount2faStatus,
  fetchAccountPasskeys,
  provisionAccountTotp,
  updateAccount2fa
} from "../auth/authApi";
import { AppButton, AppCard, AppInput, AppStack, AppText, SafeScreen, ScreenHeader } from "../components";
import { getErrorMessage } from "../lib/apiClient";
import { useAppLock } from "../lock";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "AccountSecurity">;
type Mode = "password" | "passkeys" | "2fa" | "applock";

function titleForMode(mode: Mode) {
  if (mode === "password") return "Password";
  if (mode === "passkeys") return "Passkeys";
  if (mode === "applock") return "App Lock";
  return "2FA / MFA";
}

function fmtDate(value?: string | null) {
  if (!value) return "Date not recorded";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Date not recorded" : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export function AccountSecurityScreen({ route, navigation }: Props) {
  const mode = route.params.mode;
  return (
    <SafeScreen contentStyle={styles.screen}>
      <AppStack gap={4}>
        <ScreenHeader
          title={titleForMode(mode)}
          subtitle="Protect your NoLSAF account, payments, documents, and trip access."
          onBack={() => navigation.goBack()}
        />
        {mode === "password" ? <PasswordPanel /> : null}
        {mode === "passkeys" ? <PasskeysPanel /> : null}
        {mode === "2fa" ? <TwoFactorPanel /> : null}
        {mode === "applock" ? <AppLockPanel /> : null}
      </AppStack>
    </SafeScreen>
  );
}

function PasswordPanel() {
  const { token, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!token) return;
    setError(null);
    setMessage(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation do not match.");
      return;
    }
    setLoading(true);
    try {
      const res = await changeAccountPassword(token, { currentPassword, newPassword });
      setMessage(res.message || "Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (res.data?.forceLogout) {
        Alert.alert("Password changed", "Please sign in again with your new password.");
        await signOut();
      }
    } catch (err) {
      setError(getErrorMessage(err, "Could not change password."));
    } finally {
      setLoading(false);
    }
  }

  const passwordChecks = [
    { label: "8 to 12 characters", ok: newPassword.length >= 8 && newPassword.length <= 12 },
    { label: "Uppercase and lowercase letters", ok: /[A-Z]/.test(newPassword) && /[a-z]/.test(newPassword) },
    { label: "At least one number", ok: /\d/.test(newPassword) },
    { label: "At least one symbol", ok: /[^A-Za-z0-9]/.test(newPassword) },
    { label: "Confirmation matches", ok: Boolean(confirmPassword) && newPassword === confirmPassword }
  ];
  const canSubmit = currentPassword.length > 0 && passwordChecks.every((item) => item.ok);

  return (
    <>
      <SecurityHero Icon={KeyRound} title="Change password" text="Use a strong password that is different from recent passwords." />
      <AppCard>
        <AppStack gap={4}>
          <PasswordField label="Current password" value={currentPassword} onChangeText={setCurrentPassword} visible={showCurrent} onToggle={() => setShowCurrent((value) => !value)} />
          <PasswordField label="New password" value={newPassword} onChangeText={setNewPassword} visible={showNew} onToggle={() => setShowNew((value) => !value)} placeholder="8 to 12 characters" />
          {newPassword || confirmPassword ? <PasswordChecklist checks={passwordChecks} /> : null}
          <PasswordField label="Confirm new password" value={confirmPassword} onChangeText={setConfirmPassword} visible={showConfirm} onToggle={() => setShowConfirm((value) => !value)} />
          <View style={styles.noteBox}>
            <AlertTriangle color={colors.warning} size={16} />
            <AppText variant="caption" tone="muted" style={styles.flex}>
              NoLSAF limits password changes for account safety. After a successful change, another change may be delayed briefly.
            </AppText>
          </View>
          {error ? <AppText variant="bodySmall" tone="danger">{error}</AppText> : null}
          {message ? <AppText variant="bodySmall" tone="success">{message}</AppText> : null}
          <AppButton title="Update password" loading={loading} disabled={!canSubmit} onPress={submit} />
        </AppStack>
      </AppCard>
    </>
  );
}

function PasswordField({
  label,
  value,
  onChangeText,
  visible,
  onToggle,
  placeholder
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.passwordWrap}>
      <AppText variant="label" weight="semiBold" tone="muted">
        {label}
      </AppText>
      <View style={styles.passwordInputRow}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          placeholder={placeholder}
          placeholderTextColor={colors.softText}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          style={styles.passwordInput}
        />
        <Pressable accessibilityRole="button" onPress={onToggle} style={styles.eyeButton}>
          {visible ? <EyeOff color={colors.primary} size={20} /> : <Eye color={colors.primary} size={20} />}
        </Pressable>
      </View>
    </View>
  );
}

function PasswordChecklist({ checks }: { checks: Array<{ label: string; ok: boolean }> }) {
  return (
    <View style={styles.ruleList}>
      {checks.map((item) => (
        <View key={item.label} style={styles.ruleRow}>
          <View style={[styles.ruleIcon, item.ok && styles.ruleIconOk]}>
            <CheckCircle2 color={item.ok ? colors.success : colors.softText} size={13} />
          </View>
          <AppText variant="caption" tone={item.ok ? "success" : "muted"} weight={item.ok ? "extraBold" : "regular"}>
            {item.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function PasskeysPanel() {
  const { token } = useAuth();
  const [items, setItems] = useState<AccountPasskey[]>([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetchAccountPasskeys(token);
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

  async function remove(id: string) {
    if (!token) return;
    try {
      await deleteAccountPasskey(token, id);
      setItems((current) => current.filter((item) => item.id !== id));
      setMessage("Passkey removed.");
    } catch (err) {
      Alert.alert("Passkeys", err instanceof Error ? err.message : "Could not remove this passkey.");
    }
  }

  async function addPasskey() {
    if (!token || registering) return;
    setRegistering(true);
    setMessage(null);
    try {
      const res = await registerNativePasskey("/api/account/security/passkeys", token);
      if (res.item) setItems((current) => [res.item!, ...current.filter((item) => item.id !== res.item!.id)]);
      setMessage("Passkey added.");
      await load();
    } catch (err) {
      Alert.alert("Passkeys", formatPasskeyError(err, "Could not add a passkey. Use password or OTP and try again."));
    } finally {
      setRegistering(false);
    }
  }

  return (
    <>
      <SecurityHero Icon={Fingerprint} title="Passkeys and biometrics" text="Use your device passkey to sign in without typing a password." />
      <AppCard>
        <AppStack gap={3}>
          <View style={styles.sectionHead}>
            <AppText variant="titleSm" weight="extraBold">Registered passkeys</AppText>
            {loading ? <ActivityIndicator color={colors.primary} /> : null}
          </View>
          {!loading && !items.length ? (
            <View style={styles.emptyBox}>
              <Fingerprint color={colors.primary} size={22} />
              <AppText variant="bodySmall" weight="extraBold">No passkey registered</AppText>
              <AppText variant="caption" tone="muted">Add one on this device to enable faster sign-in.</AppText>
            </View>
          ) : null}
          {items.map((item) => (
            <View key={item.id} style={styles.passkeyRow}>
              <View style={styles.roundIcon}><Fingerprint color={colors.primary} size={16} /></View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="extraBold">{item.name || "Passkey"}</AppText>
                <AppText variant="caption" tone="muted">Created {fmtDate(item.createdAt)}</AppText>
              </View>
              <Pressable accessibilityRole="button" onPress={() => remove(item.id)} style={styles.iconButton}>
                <Trash2 color={colors.danger} size={17} />
              </Pressable>
            </View>
          ))}
          {message ? <AppText variant="bodySmall" tone="muted">{message}</AppText> : null}
          <AppButton title="Add passkey" loading={registering} onPress={addPasskey} icon={<Fingerprint color={colors.white} size={16} />} />
        </AppStack>
      </AppCard>
    </>
  );
}

function TwoFactorPanel() {
  const { token, refreshProfile } = useAuth();
  const [status, setStatus] = useState<Account2faStatus | null>(null);
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setStatus(await fetchAccount2faStatus(token));
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startSetup() {
    if (!token) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await provisionAccountTotp(token);
      setSecret(res.secret || "");
      setQr(res.qr || null);
      setBackupCodes([]);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not start 2FA setup.");
    } finally {
      setLoading(false);
    }
  }

  async function verifySetup() {
    if (!token) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await updateAccount2fa(token, { action: "enable", code, secret });
      setBackupCodes(res.backupCodes || []);
      setMessage("2FA enabled successfully.");
      setCode("");
      await refreshProfile();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Invalid authenticator code.");
    } finally {
      setLoading(false);
    }
  }

  async function disable() {
    if (!token) return;
    setLoading(true);
    setMessage(null);
    try {
      await updateAccount2fa(token, { action: "disable", code });
      setMessage("2FA disabled.");
      setCode("");
      setSecret("");
      setQr(null);
      await refreshProfile();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not disable 2FA.");
    } finally {
      setLoading(false);
    }
  }

  const enabled = Boolean(status?.totpEnabled || status?.smsEnabled);
  return (
    <>
      <SecurityHero Icon={LockKeyhole} title="Two-factor authentication" text="Add an authenticator-code check before sensitive account access." />
      <AppCard>
        <AppStack gap={4}>
          <View style={styles.statusLine}>
            <View style={[styles.roundIcon, enabled && styles.roundIconSuccess]}>
              {enabled ? <CheckCircle2 color={colors.success} size={17} /> : <LockKeyhole color={colors.primary} size={17} />}
            </View>
            <View style={styles.flex}>
              <AppText variant="bodySmall" weight="extraBold">{enabled ? "2FA is active" : "2FA is not enabled"}</AppText>
              <AppText variant="caption" tone="muted">{enabled ? (status?.smsEnabled ? "SMS verification enabled." : "Authenticator app enabled.") : "Set up TOTP using Google Authenticator, 1Password, iCloud Keychain, or another authenticator."}</AppText>
            </View>
          </View>

          {!enabled && !secret ? (
            <AppButton title="Start authenticator setup" loading={loading} onPress={startSetup} icon={<Smartphone color={colors.white} size={16} />} />
          ) : null}

          {!enabled && secret ? (
            <AppStack gap={3}>
              {qr ? <Image source={{ uri: qr }} style={styles.qr} /> : null}
              <View style={styles.secretBox}>
                <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>Secret key</AppText>
                <AppText variant="bodySmall" weight="mono">{secret}</AppText>
              </View>
              <AppInput label="Authenticator code" value={code} onChangeText={setCode} keyboardType="number-pad" placeholder="6-digit code" maxLength={6} />
              <AppButton title="Verify and enable" loading={loading} onPress={verifySetup} />
            </AppStack>
          ) : null}

          {enabled ? (
            <AppStack gap={3}>
              <AppInput label="Authenticator or backup code" value={code} onChangeText={setCode} placeholder="Code required to disable" />
              <AppButton title="Disable 2FA" variant="danger" loading={loading} onPress={disable} />
            </AppStack>
          ) : null}

          {backupCodes.length ? (
            <View style={styles.backupBox}>
              <AppText variant="bodySmall" weight="extraBold">Backup codes</AppText>
              <AppText variant="caption" tone="muted">Save these codes now. They are shown only once.</AppText>
              {backupCodes.map((item) => <AppText key={item} variant="bodySmall" weight="mono">{item}</AppText>)}
            </View>
          ) : null}
          {message ? <AppText variant="bodySmall" tone={message.toLowerCase().includes("success") || message.toLowerCase().includes("enabled") ? "success" : "muted"}>{message}</AppText> : null}
        </AppStack>
      </AppCard>
    </>
  );
}

function AppLockPanel() {
  const { enabled, supported, biometric, ready, enable, disable } = useAppLock();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (enabled) {
        await disable();
        setMessage("App Lock turned off.");
      } else {
        const ok = await enable();
        setMessage(ok ? "App Lock turned on." : "Could not confirm. App Lock was not turned on.");
      }
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const lockLabel = biometric ? "fingerprint or face" : "device passcode";

  return (
    <>
      <SecurityHero
        Icon={ShieldCheck}
        title="App Lock"
        text={`Require your ${lockLabel} to open NoLSAF, so your bookings and payments stay private on a shared or lost phone.`}
      />
      <AppCard>
        <AppStack gap={4}>
          <View style={styles.statusLine}>
            <View style={[styles.roundIcon, enabled && styles.roundIconSuccess]}>
              {enabled ? <CheckCircle2 color={colors.success} size={17} /> : <LockKeyhole color={colors.primary} size={17} />}
            </View>
            <View style={styles.flex}>
              <AppText variant="bodySmall" weight="extraBold">
                {enabled ? "App Lock is on" : "App Lock is off"}
              </AppText>
              <AppText variant="caption" tone="muted">
                {enabled
                  ? `NoLSAF asks for your ${lockLabel} when you open it or return after a short while.`
                  : "Anyone holding your unlocked phone can open your NoLSAF account."}
              </AppText>
            </View>
          </View>

          <View style={styles.noteBox}>
            <ShieldCheck color={colors.warning} size={16} />
            <AppText variant="caption" tone="muted" style={styles.flex}>
              NoLSAF never sees or stores your fingerprint or face. Your phone checks it and only tells the app yes or no. This is separate from your account password.
            </AppText>
          </View>

          {ready && !supported ? (
            <View style={styles.noteBox}>
              <AlertTriangle color={colors.warning} size={16} />
              <AppText variant="caption" tone="muted" style={styles.flex}>
                This device has no fingerprint, face, or passcode set up. Add a screen lock in your phone settings to use App Lock.
              </AppText>
            </View>
          ) : null}

          {message ? (
            <AppText variant="bodySmall" tone={message.toLowerCase().includes("on") ? "success" : "muted"}>
              {message}
            </AppText>
          ) : null}

          <AppButton
            title={enabled ? "Turn off App Lock" : "Turn on App Lock"}
            variant={enabled ? "danger" : "primary"}
            loading={busy}
            disabled={!ready || (!enabled && !supported)}
            onPress={toggle}
            icon={enabled ? undefined : <ShieldCheck color={colors.white} size={16} />}
          />
        </AppStack>
      </AppCard>
    </>
  );
}

function SecurityHero({ Icon, title, text }: { Icon: typeof KeyRound; title: string; text: string }) {
  return (
    <AppCard style={styles.hero}>
      <View style={styles.heroRow}>
        <View style={styles.heroIcon}><Icon color={colors.primary} size={22} /></View>
        <View style={styles.flex}>
          <AppText variant="titleSm" weight="extraBold">{title}</AppText>
          <AppText variant="bodySmall" tone="muted">{text}</AppText>
        </View>
        <ChevronRight color={colors.softText} size={18} />
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: spacing[8] },
  flex: { flex: 1, minWidth: 0 },
  hero: { borderColor: colors.brand[100], backgroundColor: "#f7fffc" },
  heroRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  heroIcon: { width: 52, height: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.lg, backgroundColor: colors.brand[50], borderWidth: 1, borderColor: colors.brand[100] },
  passwordWrap: { gap: spacing[2], minWidth: 0 },
  passwordInputRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingLeft: spacing[4],
    paddingRight: spacing[2]
  },
  passwordInput: {
    flex: 1,
    minWidth: 0,
    color: colors.ink,
    fontSize: 16,
    paddingVertical: spacing[3]
  },
  eyeButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50]
  },
  ruleList: {
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    padding: spacing[3]
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minWidth: 0
  },
  ruleIcon: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  ruleIconOk: {
    borderColor: colors.brand[100],
    backgroundColor: "#e9f7ef"
  },
  noteBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], borderRadius: radius.md, backgroundColor: "#fff8e6", borderWidth: 1, borderColor: "#fde68a", padding: spacing[3] },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  emptyBox: { alignItems: "center", gap: spacing[2], borderRadius: radius.md, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: colors.border, padding: spacing[4] },
  passkeyRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, padding: spacing[3] },
  roundIcon: { width: 34, height: 34, alignItems: "center", justifyContent: "center", borderRadius: radius.full, borderWidth: 1, borderColor: colors.brand[100], backgroundColor: colors.brand[50] },
  roundIconSuccess: { backgroundColor: "#e9f7ef" },
  iconButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca" },
  statusLine: { flexDirection: "row", alignItems: "center", gap: spacing[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: "#f8fafc", padding: spacing[3] },
  qr: { width: 190, height: 190, alignSelf: "center", borderRadius: radius.md },
  secretBox: { gap: spacing[1], borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand[100], backgroundColor: colors.brand[50], padding: spacing[3] },
  backupBox: { gap: spacing[2], borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand[100], backgroundColor: "#f7fffc", padding: spacing[3] },
  infoLabel: { textTransform: "uppercase", letterSpacing: 1 }
});

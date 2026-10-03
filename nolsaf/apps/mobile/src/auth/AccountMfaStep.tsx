import { KeyRound, LifeBuoy, ShieldCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppButton, AppCard, AppInput, AppStack, AppText } from "../components";
import { ApiError } from "../lib/apiClient";
import { colors, radius, spacing } from "../theme";
import { useAuth } from "./AuthProvider";

/**
 * Second sign-in step for an account with an authenticator app turned on.
 * The API has held the session back; a 6-digit authenticator code, or one of
 * the backup codes (each works once), releases it. Mirrors the web
 * AccountMfaLoginGate so both read and behave the same.
 */
export function AccountMfaStep({ onRestart }: { onRestart: (message: string) => void }) {
  const { pendingMfa, verifyMfa, cancelMfa } = useAuth();
  const [useBackup, setUseBackup] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() => remaining(pendingMfa?.expiresAt));

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft(remaining(pendingMfa?.expiresAt)), 1000);
    return () => clearInterval(timer);
  }, [pendingMfa?.expiresAt]);

  useEffect(() => {
    if (pendingMfa && secondsLeft <= 0) {
      cancelMfa();
      onRestart("That sign-in expired. Sign in again to get a new verification step.");
    }
  }, [cancelMfa, onRestart, pendingMfa, secondsLeft]);

  const ready = useBackup ? code.replace(/[^A-Za-z0-9]/g, "").length >= 8 : code.length === 6;

  async function submit(value = code) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await verifyMfa(value, useBackup);
    } catch (err) {
      const reason = ((err as ApiError)?.payload as { code?: string } | undefined)?.code;
      const message = err instanceof Error ? err.message : "";
      if (reason === "MFA_EXPIRED" || reason === "MFA_ACCOUNT_CHANGED" || reason === "MFA_UNAVAILABLE") {
        onRestart(message || "Sign in again to verify your account.");
        return;
      }
      setError(
        reason === "MFA_INVALID"
          ? useBackup
            ? "That backup code is not valid or has already been used."
            : "That code is not correct. Make sure your phone's time is set automatically, then try the newest code."
          : message || "We could not verify that code. Please try again."
      );
      setCode("");
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setUseBackup((current) => !current);
    setCode("");
    setError(null);
  }

  return (
    <AppCard style={styles.card}>
      <AppStack gap={4}>
        <View style={styles.head}>
          <View style={styles.headIcon}>
            {useBackup ? <LifeBuoy color={colors.primary} size={20} /> : <ShieldCheck color={colors.primary} size={20} />}
          </View>
          <View style={styles.flex}>
            <AppText variant="bodySmall" weight="extraBold">
              {useBackup ? "Use a backup code" : "Enter your authenticator code"}
            </AppText>
            <AppText variant="caption" tone="muted">
              {useBackup
                ? "One of the codes you saved when you turned on the authenticator. Each code works once."
                : "Open your authenticator app and enter the 6-digit code for NoLSAF."}
            </AppText>
          </View>
        </View>

        {useBackup ? (
          <AppInput
            label="Backup code"
            value={code}
            onChangeText={(value) => {
              setCode(value.toUpperCase().replace(/[^A-Z0-9-\s]/g, "").slice(0, 20));
              if (error) setError(null);
            }}
            placeholder="ABCD-EFGH"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            returnKeyType="go"
            onSubmitEditing={() => ready && submit()}
            style={styles.codeInput}
          />
        ) : (
          <AppInput
            label="Authenticator code"
            value={code}
            onChangeText={(value) => {
              const next = value.replace(/\D/g, "").slice(0, 6);
              setCode(next);
              if (error) setError(null);
              // Verifies as soon as all six digits are in, like the sign-in code.
              if (next.length === 6 && next !== code) void submit(next);
            }}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            style={styles.codeInput}
          />
        )}

        {error ? (
          <AppText variant="bodySmall" tone="danger">
            {error}
          </AppText>
        ) : null}

        <AppButton title="Verify and sign in" loading={loading} disabled={!ready} onPress={() => submit()} icon={<KeyRound color={colors.white} size={18} />} />

        <Pressable accessibilityRole="button" onPress={switchMode} disabled={loading} style={styles.switchLink}>
          <AppText variant="bodySmall" weight="bold" tone="primary">
            {useBackup ? "Use the authenticator code instead" : "Lost your phone? Use a backup code"}
          </AppText>
        </Pressable>

        <View style={styles.footer}>
          <AppText variant="caption" tone="soft">
            This step expires in {formatClock(secondsLeft)}.
          </AppText>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={cancelMfa} disabled={loading}>
            <AppText variant="caption" weight="bold" tone="primary">
              Back to sign in
            </AppText>
          </Pressable>
        </View>
      </AppStack>
    </AppCard>
  );
}

function remaining(expiresAt?: number) {
  return expiresAt ? Math.max(0, Math.round((expiresAt - Date.now()) / 1000)) : 0;
}

function formatClock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    padding: spacing[5]
  },
  head: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3]
  },
  headIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  flex: {
    flex: 1,
    minWidth: 0,
    gap: 2
  },
  codeInput: {
    fontSize: 20,
    letterSpacing: 4,
    textAlign: "center"
  },
  switchLink: {
    alignSelf: "center",
    paddingVertical: spacing[1]
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  }
});

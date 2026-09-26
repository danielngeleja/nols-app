import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { KeyRound, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { verifyAccountMfa } from "../auth/authApi";
import { AppButton, AppCard, AppInput, AppStack, AppText, AuthScreen } from "../components";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "AccountMfa">;

export function AccountMfaScreen({ navigation, route }: Props) {
  const { completeOtpSignIn } = useAuth();
  const { challengeId, expiresInSeconds } = route.params;
  const [code, setCode] = useState("");
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedCode = useBackupCode ? code.trim() : code.replace(/\D/g, "").slice(0, 6);
  const codeReady = useBackupCode ? normalizedCode.length >= 6 : normalizedCode.length === 6;

  async function submit() {
    if (!codeReady || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await verifyAccountMfa(challengeId, normalizedCode, useBackupCode);
      if (!response.ok || !response.token) {
        throw new Error(response.message || response.error || "Verification failed. Sign in again.");
      }
      await completeOtpSignIn(response.token, response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Sign in again.");
      setLoading(false);
    }
  }

  function switchCodeType() {
    setUseBackupCode((current) => !current);
    setCode("");
    setError(null);
  }

  return (
    <AuthScreen
      title="Verify it’s you"
      subtitle="Your account is protected with two-step verification."
      onBack={() => navigation.goBack()}
      icon={<ShieldCheck color={colors.white} size={24} />}
    >
      <AppCard style={styles.card}>
        <AppStack gap={4}>
          <View style={styles.iconWrap}>
            <KeyRound color={colors.primary} size={22} />
          </View>
          <View style={styles.copy}>
            <AppText variant="titleSm" weight="extraBold">
              {useBackupCode ? "Enter a backup code" : "Enter authenticator code"}
            </AppText>
            <AppText variant="bodySmall" tone="muted">
              {useBackupCode
                ? "Use one of the recovery codes saved when you enabled two-step verification."
                : `Open your authenticator app and enter its 6-digit code${expiresInSeconds ? ` within ${Math.ceil(expiresInSeconds / 60)} minutes` : ""}.`}
            </AppText>
          </View>
          <AppInput
            label={useBackupCode ? "Backup code" : "Authenticator code"}
            value={code}
            onChangeText={(value) => setCode(useBackupCode ? value : value.replace(/\D/g, "").slice(0, 6))}
            placeholder={useBackupCode ? "Enter recovery code" : "123456"}
            keyboardType={useBackupCode ? "default" : "number-pad"}
            maxLength={useBackupCode ? 128 : 6}
            textContentType="oneTimeCode"
            autoCapitalize="characters"
            style={!useBackupCode ? styles.codeInput : undefined}
          />
          {error ? (
            <AppText variant="bodySmall" tone="danger">
              {error}
            </AppText>
          ) : null}
          <AppButton title="Verify and sign in" onPress={submit} loading={loading} disabled={!codeReady} />
          <Pressable accessibilityRole="button" disabled={loading} onPress={switchCodeType} style={styles.switchButton}>
            <AppText variant="bodySmall" tone="primary" weight="bold">
              {useBackupCode ? "Use authenticator code" : "Use a backup code"}
            </AppText>
          </Pressable>
          <AppButton title="Start sign in again" variant="ghost" disabled={loading} onPress={() => navigation.popTo("Login")} />
        </AppStack>
      </AppCard>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: spacing[5] },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  copy: { gap: spacing[1] },
  codeInput: { textAlign: "center", fontSize: 22, letterSpacing: 10, fontWeight: "700" },
  switchButton: { minHeight: 40, alignItems: "center", justifyContent: "center" }
});

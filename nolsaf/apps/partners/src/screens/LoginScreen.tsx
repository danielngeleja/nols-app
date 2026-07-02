import {
  AppButton,
  AppInput,
  AppText,
  NolsafLogoMark,
  SafeScreen,
  colors,
  formatPasskeyError,
  getErrorMessage,
  spacing
} from "@nolsaf/native-ui";
import { Fingerprint } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useAuth } from "../auth";

// The single Partners login. One login for both Owner and Operator; the role on
// the account decides which dashboard renders (see RoleGateScreen). No
// registration here, partners already hold accounts.
export function LoginScreen() {
  const { signIn, signInWithPasskey } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);

  const onSubmit = async () => {
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setError(getErrorMessage(err, "We could not sign you in. Check your details and try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const onPasskeySubmit = async () => {
    if (submitting || passkeySubmitting) return;
    setPasskeySubmitting(true);
    setError(null);
    try {
      await signInWithPasskey();
    } catch (err) {
      setError(formatPasskeyError(err, "Passkey sign-in failed. Use password, then add a passkey from Security."));
    } finally {
      setPasskeySubmitting(false);
    }
  };

  return (
    <SafeScreen contentStyle={styles.content}>
      <View style={styles.brandRow}>
        <View style={styles.logoFrame}>
          <NolsafLogoMark color={colors.white} width={34} height={34} />
        </View>
        <View style={styles.brandText}>
          <AppText variant="titleSm" weight="bold" style={styles.brandTitle}>
            NoLSAF Partners
          </AppText>
          <AppText variant="bodySmall" tone="muted" style={styles.brandSubtitle}>
            Owners and tour operators
          </AppText>
        </View>
      </View>

      <View style={styles.card}>
        <AppText variant="title" weight="bold">
          Sign in
        </AppText>
        <AppText variant="bodySmall" tone="muted" style={styles.intro}>
          Sign in to access your bookings, earnings, and listings.
        </AppText>

        <View style={styles.form}>
          <AppInput
            label="Email"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
          />
          <AppInput
            label="Password"
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            placeholder="Your password"
            value={password}
            onChangeText={setPassword}
            error={error ?? undefined}
          />
          <AppButton title="Sign in" loading={submitting} onPress={onSubmit} />
          <AppButton
            title="Sign in with passkey"
            variant="secondary"
            loading={passkeySubmitting}
            disabled={submitting}
            onPress={onPasskeySubmit}
            icon={<Fingerprint color={colors.primary} size={16} />}
          />
        </View>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing[5],
    justifyContent: "center"
  },
  brandRow: {
    alignItems: "center",
    gap: spacing[3]
  },
  logoFrame: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  brandText: {
    alignItems: "center"
  },
  brandTitle: {
    textAlign: "center"
  },
  brandSubtitle: {
    textAlign: "center"
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[5],
    gap: spacing[2]
  },
  intro: {
    marginTop: spacing[1]
  },
  form: {
    marginTop: spacing[4],
    gap: spacing[4]
  }
});

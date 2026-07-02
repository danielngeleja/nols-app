import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppButton, AppCard, AppInput, AppStack, AppText, colors, formatPasskeyError, nativePasskeysSupported, NolsafLogoMark, SafeScreen } from "@nolsaf/native-ui";
import { Fingerprint } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { env } from "../lib/env";
import { RootStackParamList } from "../navigation/types";

const LOCKOUT_PATTERN = /try again in\s*(\d+)\s*(second|seconds|minute|minutes)/i;
type Props = NativeStackScreenProps<RootStackParamList, "Login">;

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getLockoutSeconds(message: string | null | undefined) {
  const match = message?.match(LOCKOUT_PATTERN);
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return match[2].toLowerCase().startsWith("second") ? value : value * 60;
}

export function LoginScreen({ navigation }: Props) {
  const { signIn, signInWithPasskey, error: authError } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  // Hidden entirely when the build/platform cannot do passkeys, so nobody
  // ever sees a button that cannot work (web, Expo Go, old builds).
  const passkeyAvailable = useMemo(() => nativePasskeysSupported(), []);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const baseLockoutMessage = useRef<string | null>(null);

  const isLockedOut = lockoutSeconds > 0;
  const canSubmit = email.trim().length > 0 && password.length > 0 && !isLockedOut;

  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds > 0]);

  const combinedError = error || authError;

  useEffect(() => {
    const seconds = getLockoutSeconds(combinedError);
    if (seconds > 0) {
      baseLockoutMessage.current = combinedError ?? null;
      setLockoutSeconds(seconds);
    }
  }, [combinedError]);

  const countdown = formatCountdown(lockoutSeconds);
  const displayError = isLockedOut ? `Too many failed attempts. Please try again in ${countdown}.` : combinedError;

  async function submit() {
    if (!canSubmit || loading) return;
    setLoading(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Login failed. Please try again.";
      const seconds = getLockoutSeconds(message);
      if (seconds > 0) {
        baseLockoutMessage.current = message;
        setLockoutSeconds(seconds);
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function submitPasskey() {
    if (passkeyLoading || loading) return;
    setPasskeyLoading(true);
    setError(null);
    try {
      await signInWithPasskey();
    } catch (e) {
      setError(formatPasskeyError(e, "Passkey sign-in failed. Use your password, then add a passkey from Security."));
    } finally {
      setPasskeyLoading(false);
    }
  }

  function openForgotPassword() {
    navigation.navigate("ForgotPassword");
  }

  function openDriverRegistration() {
    const baseUrl = env.appUrl.replace(/\/$/, "");
    void Linking.openURL(`${baseUrl}/account/register?role=driver`);
  }

  return (
    <SafeScreen contentStyle={styles.content}>
      <View style={styles.brand}>
        <View style={styles.logoMark}>
          <NolsafLogoMark color={colors.white} width={40} height={40} />
        </View>
        <AppStack gap={2} style={styles.brandCopy}>
          <AppText variant="headline" weight="extraBold" style={styles.title}>
            Welcome to NoLSAF Driver Dashboard
          </AppText>
          <AppText variant="bodySmall" tone="muted" style={styles.subtitle}>
            Sign in to manage trips, earnings, and your driver profile.
          </AppText>
        </AppStack>
      </View>

      <AppCard style={styles.card}>
        <AppStack gap={5}>
          {passkeyAvailable ? (
            <View style={styles.passkeyBlock}>
              <AppButton
                title="Continue with passkey"
                loading={passkeyLoading}
                disabled={loading || isLockedOut}
                onPress={submitPasskey}
                icon={<Fingerprint color={colors.white} size={18} />}
              />
              <AppText variant="caption" tone="muted" style={styles.passkeyHint}>
                Face ID or fingerprint, no password needed
              </AppText>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <AppText variant="caption" tone="muted">
                  or
                </AppText>
                <View style={styles.dividerLine} />
              </View>
            </View>
          ) : null}
          <AppInput
            label="Email"
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <AppInput
            label="Password"
            placeholder="Your password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />
          <Pressable accessibilityRole="button" onPress={openForgotPassword} style={styles.forgotLink}>
            <AppText variant="bodySmall" weight="bold" style={styles.forgotText}>
              Forgot password?
            </AppText>
          </Pressable>
          {displayError ? (
            <AppText variant="bodySmall" tone="danger">
              {displayError}
            </AppText>
          ) : null}
          <AppButton
            title={isLockedOut ? `Try again in ${countdown}` : "Log in"}
            loading={loading}
            disabled={!canSubmit || passkeyLoading}
            onPress={submit}
            style={passkeyAvailable ? styles.submitNeutral : undefined}
          />
        </AppStack>
      </AppCard>

      <View style={styles.footer}>
        <AppText variant="caption" tone="soft" style={styles.footerText}>
          New driver?
        </AppText>
        <Pressable accessibilityRole="link" onPress={openDriverRegistration}>
          <AppText variant="caption" weight="bold" style={styles.footerLink}>
            Register on the NoLSAF website
          </AppText>
        </Pressable>
        <AppText variant="caption" tone="soft" style={styles.footerText}>
          After approval, sign in here with the same email and password.
        </AppText>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 36,
    gap: 28
  },
  brand: {
    alignItems: "center",
    width: "100%",
    maxWidth: 520,
    gap: 20
  },
  brandCopy: {
    alignItems: "center",
    gap: 8
  },
  logoMark: {
    width: 76,
    height: 76,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primaryDeep,
    shadowColor: colors.primaryDeep,
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8
  },
  title: {
    maxWidth: 500,
    textAlign: "center",
    lineHeight: 44
  },
  subtitle: {
    maxWidth: 440,
    textAlign: "center",
    lineHeight: 24
  },
  card: {
    width: "100%",
    maxWidth: 440,
    padding: 24,
    borderRadius: 24,
    borderColor: "#dbe6ec"
  },
  passkeyBlock: {
    gap: 8
  },
  passkeyHint: {
    textAlign: "center"
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 8
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border
  },
  // When the passkey button holds the brand color, the form submit steps back
  // to neutral ink so the screen keeps a single accent action.
  submitNeutral: {
    backgroundColor: colors.ink,
    borderColor: colors.ink
  },
  forgotLink: {
    alignSelf: "flex-end",
    marginTop: -10,
    paddingVertical: 2
  },
  forgotText: {
    color: colors.primary
  },
  footer: {
    width: "100%",
    maxWidth: 440,
    alignItems: "center",
    gap: 3,
    marginTop: -4
  },
  footerText: {
    textAlign: "center"
  },
  footerLink: {
    color: colors.primary,
    textAlign: "center"
  }
});

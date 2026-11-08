import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { formatPasskeyError, nativePasskeysSupported } from "@nolsaf/native-ui";
import { Fingerprint, Mail, Phone, ScanFace, ShieldCheck } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";

import { useAuth } from "../auth";
import { AccountMfaStep } from "../auth/AccountMfaStep";
import { sendOtp, verifyOtp } from "../auth/authApi";
import { AppButton, AppInput, AppText, AuthScreen, CodeBoxes } from "../components";
import { useSecureScreen } from "../lib/secureScreen";
import { contactProblem, detectContact, EMAIL_PATTERN, shapeContactInput } from "../lib/contact";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;
/** identify: who are you. password: email accounts only. code: a one-time code by SMS or email. */
type Stage = "identify" | "password" | "code";

const RESEND_COOLDOWN_SEC = 60;
// The icon people already know for unlocking their own phone.
const PasskeyIcon = Platform.OS === "ios" ? ScanFace : Fingerprint;
// The last identifier that signed in on this device (never the password), so a
// returning traveller starts one step further. Kept in the device keychain.
const LAST_LOGIN_KEY = "nolsaf.lastLoginId";

async function readLastLogin(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(LAST_LOGIN_KEY)) || "";
  } catch {
    return "";
  }
}

function rememberLogin(identifier: string) {
  const value = identifier.trim();
  if (value) void SecureStore.setItemAsync(LAST_LOGIN_KEY, value).catch(() => undefined);
}

/** Enough of the identifier to recognise it, never the whole thing on screen. */
function maskIdentifier(value: string) {
  const text = value.trim();
  if (text.includes("@")) {
    const [local, domain] = text.split("@");
    return `${local.slice(0, 2)}•••@${domain ?? ""}`;
  }
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7) return text;
  return `${digits.slice(0, 4)} ••• ${digits.slice(-3)}`;
}

export function LoginScreen({ navigation }: Props) {
  useSecureScreen();
  const { signIn, signInWithPasskey, completeOtpSignIn, pendingMfa, beginMfaChallenge, cancelMfa, error: sessionNotice } = useAuth();

  const [stage, setStage] = useState<Stage>("identify");
  const [identifier, setIdentifier] = useState("");
  // True when the identifier came from this device's last sign-in.
  const [returning, setReturning] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const passwordRef = useRef<TextInput>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  // Hidden entirely when the build or platform cannot do passkeys, so nobody
  // ever sees a button that cannot work (web, Expo Go, old builds).
  const passkeyAvailable = useMemo(() => nativePasskeysSupported(), []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    void readLastLogin().then((last) => {
      if (!alive || !last) return;
      setIdentifier((current) => current || last);
      setReturning(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  function startResendCooldown() {
    setResendIn(RESEND_COOLDOWN_SEC);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setResendIn((current) => {
        if (current <= 1 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        return Math.max(0, current - 1);
      });
    }, 1000);
  }

  const contact = detectContact(identifier);
  // Password sign-in is by email only: one clear identifier, no guessing. A phone always uses a code.
  const isEmail = EMAIL_PATTERN.test(identifier.trim());
  const busy = loading || passkeyLoading;

  function goTo(next: Stage) {
    setStage(next);
    setError(null);
    setCode("");
    if (next !== "password") setPassword("");
  }

  /** Back to the first step with the phone or email still in the field, ready to edit. */
  function editAccount() {
    goTo("identify");
  }

  /** Continue from the first step: an email asks for the password, a phone gets a code. */
  async function continueFromIdentify() {
    if (busy) return;
    if (!contact) {
      setError(contactProblem(identifier) || "Enter your phone number or email.");
      return;
    }
    if (isEmail) {
      goTo("password");
      setTimeout(() => passwordRef.current?.focus(), 250);
      return;
    }
    await sendLoginCode(false);
  }

  async function submitPassword() {
    if (loading) return;
    if (!isEmail) {
      goTo("identify");
      return;
    }
    if (!password) {
      setError("Enter your password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(identifier.trim().toLowerCase(), password);
      rememberLogin(identifier);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign in failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function sendLoginCode(resend = false) {
    if (loading || (resend && resendIn > 0)) return;
    if (!contact) {
      setError(contactProblem(identifier) || "Enter your phone number or email.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // No role: a login code, so the account must already exist.
      await sendOtp(contact.destination);
      startResendCooldown();
      if (!resend) {
        setCode("");
        setStage("code");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitOtp(value = code) {
    if (loading || !contact) return;
    if (value.trim().length !== 6) {
      setError("Enter all 6 digits of the code.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await verifyOtp(contact.destination, value.trim());
      if (beginMfaChallenge(res)) {
        // The account has an authenticator: the next step asks for its code.
        rememberLogin(identifier);
        setLoading(false);
        return;
      }
      if (!res.token) {
        throw new Error(res.message || res.error || "Verification failed. Try again.");
      }
      await completeOtpSignIn(res.token, res.user);
      rememberLogin(identifier);
    } catch (e) {
      // Map the backend's technical messages to short, actionable copy.
      const raw = e instanceof Error ? e.message : "";
      const friendly = /no otp found|expired|not found/i.test(raw)
        ? "That code has expired. Send a new one."
        : /incorrect|invalid|wrong|mismatch/i.test(raw)
          ? "That code isn't right. Check it and try again."
          : "We couldn't verify that code. Try again or send a new one.";
      setError(friendly);
      setLoading(false);
    }
  }

  async function submitPasskey() {
    if (busy) return;
    setPasskeyLoading(true);
    setError(null);
    try {
      await signInWithPasskey();
    } catch (e) {
      setError(formatPasskeyError(e, "Passkey sign-in failed. Use password or OTP, then add a passkey from Security."));
    } finally {
      setPasskeyLoading(false);
    }
  }

  // Headline and one short line for each step.
  const heading = pendingMfa
    ? { title: "Verify it's you", subtitle: "Enter the code from your authenticator app." }
    : stage === "password"
      ? { title: "Enter your password", subtitle: undefined }
      : stage === "code"
        ? { title: "Enter the code", subtitle: contact ? `Sent to ${maskIdentifier(identifier)} if it has a NoLSAF account.` : undefined }
        : returning && identifier
          ? { title: "Welcome back", subtitle: undefined }
          : { title: "Sign in", subtitle: "Stays, tours and rides in one account." };

  const handleBack = () => {
    if (pendingMfa) cancelMfa();
    else if (stage !== "identify") goTo("identify");
    else navigation.goBack();
  };

  const errorLine = error ? (
    <AppText variant="bodySmall" tone="danger" accessibilityLiveRegion="polite">
      {error}
    </AppText>
  ) : null;

  // The account this step is for. Going back edits it, so there is no separate switch here.
  const accountChip = identifier ? (
    <View style={styles.accountChip}>
      <View style={styles.accountIcon}>
        {isEmail ? <Mail color={colors.primary} size={16} /> : <Phone color={colors.primary} size={16} />}
      </View>
      <AppText variant="bodySmall" weight="semiBold" numberOfLines={1} style={styles.flex}>
        {maskIdentifier(identifier)}
      </AppText>
    </View>
  ) : null;

  return (
    <AuthScreen
      title={heading.title}
      subtitle={heading.subtitle}
      onBack={handleBack}
      footer={
        !pendingMfa && stage === "identify" ? (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Register")} style={styles.centerRow}>
            <AppText variant="bodySmall" tone="muted">
              New to NoLSAF?{" "}
            </AppText>
            <AppText variant="bodySmall" tone="primary" weight="bold">
              Create account
            </AppText>
          </Pressable>
        ) : undefined
      }
    >
      {/* Why the last session ended (e.g. an authenticator was turned on), so a sign-out is never silent. */}
      {sessionNotice && !pendingMfa ? (
        <View style={styles.sessionNotice}>
          <ShieldCheck color={colors.primary} size={16} />
          <AppText variant="caption" weight="semiBold" style={styles.flex}>
            {sessionNotice}
          </AppText>
        </View>
      ) : null}

      {pendingMfa ? (
        <AccountMfaStep
          onRestart={(message) => {
            setPassword("");
            setCode("");
            setStage("identify");
            setError(message);
          }}
        />
      ) : stage === "identify" ? (
        <>
          {passkeyAvailable ? (
            <View style={styles.passkeyBlock}>
              {/* Icon only: Face ID on iPhone, fingerprint on Android. Screen readers still hear the full action. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue with passkey"
                accessibilityHint="Uses Face ID or your fingerprint. No password needed."
                disabled={loading || passkeyLoading}
                onPress={submitPasskey}
                hitSlop={6}
                style={({ pressed }) => [styles.passkeyButton, pressed && styles.passkeyPressed, loading && styles.passkeyDisabled]}
              >
                {passkeyLoading ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <PasskeyIcon color={colors.primary} size={30} strokeWidth={1.8} />
                )}
              </Pressable>
              <View style={styles.dividerRow}>
                <View style={styles.dividerLine} />
                <AppText variant="caption" tone="muted">
                  or
                </AppText>
                <View style={styles.dividerLine} />
              </View>
            </View>
          ) : null}

          {/* A remembered account arrives pre-filled; editing the field is how to use another one. */}
          <AppInput
              label="Phone or email"
              value={identifier}
              onChangeText={(value) => {
                // A phone is shaped as it is typed; anything with letters or an @ stays as typed.
                setIdentifier(shapeContactInput(value));
                if (error) setError(null);
              }}
              placeholder="0712 345 678 or you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="username"
              returnKeyType="go"
              onSubmitEditing={continueFromIdentify}
              error={identifier.trim().length >= 6 ? contactProblem(identifier) || undefined : undefined}
            />
          {errorLine}
          {/* Always active: an invalid entry gets a clear message instead of a faded button. */}
          <AppButton title="Continue" loading={loading} disabled={passkeyLoading} onPress={continueFromIdentify} />
        </>
      ) : stage === "password" ? (
        <>
          {accountChip}
          <AppInput
            inputRef={passwordRef}
            label="Password"
            secureTextEntry
            textContentType="password"
            autoComplete="current-password"
            returnKeyType="go"
            onSubmitEditing={submitPassword}
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (error) setError(null);
            }}
            placeholder="Your password"
            error={error || undefined}
          />
          <AppButton title="Sign in" loading={loading} onPress={submitPassword} />
          <View style={styles.linkRow}>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => navigation.navigate("ForgotPassword")}>
              <AppText variant="bodySmall" tone="primary" weight="bold">
                Forgot password
              </AppText>
            </Pressable>
            <Pressable accessibilityRole="button" hitSlop={8} disabled={loading} onPress={() => sendLoginCode(false)}>
              <AppText variant="bodySmall" tone="primary" weight="bold">
                Send a code instead
              </AppText>
            </Pressable>
          </View>
        </>
      ) : (
        <>
          <CodeBoxes
            value={code}
            onChange={(next) => {
              setCode(next);
              if (error) setError(null);
            }}
            onComplete={(next) => void submitOtp(next)}
            error={Boolean(error)}
            editable={!loading}
          />
          {errorLine}
          <AppButton title="Verify and sign in" loading={loading} onPress={() => submitOtp()} />
          <View style={styles.linkRow}>
            <Pressable accessibilityRole="button" hitSlop={8} disabled={resendIn > 0 || loading} onPress={() => sendLoginCode(true)}>
              <AppText variant="bodySmall" tone={resendIn > 0 ? "muted" : "primary"} weight="bold">
                {resendIn > 0 ? `Resend in 0:${String(resendIn).padStart(2, "0")}` : "Send a new code"}
              </AppText>
            </Pressable>
            {isEmail ? (
              <Pressable accessibilityRole="button" hitSlop={8} disabled={loading} onPress={() => goTo("password")}>
                <AppText variant="bodySmall" tone="primary" weight="bold">
                  Use password
                </AppText>
              </Pressable>
            ) : (
              <Pressable accessibilityRole="button" hitSlop={8} disabled={loading} onPress={editAccount}>
                <AppText variant="bodySmall" tone="primary" weight="bold">
                  Use another number
                </AppText>
              </Pressable>
            )}
          </View>
          {resendIn === 0 ? (
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Register")} style={styles.centerRow}>
              <AppText variant="caption" tone="muted" style={styles.centerText}>
                No code? This may not have an account yet.{" "}
                <AppText variant="caption" weight="bold" tone="primary">
                  Create one
                </AppText>
              </AppText>
            </Pressable>
          ) : null}
        </>
      )}
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0
  },
  passkeyBlock: {
    gap: spacing[3],
    alignItems: "stretch"
  },
  passkeyButton: {
    alignSelf: "center",
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[200],
    backgroundColor: colors.brand[50]
  },
  passkeyPressed: {
    backgroundColor: colors.brand[100]
  },
  passkeyDisabled: {
    opacity: 0.5
  },
  dividerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    marginTop: spacing[2]
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border
  },
  accountChip: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3]
  },
  accountIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.white
  },
  sessionNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  centerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center"
  },
  centerText: {
    textAlign: "center"
  }
});

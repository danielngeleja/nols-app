import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { formatPasskeyError, nativePasskeysSupported } from "@nolsaf/native-ui";
import { Fingerprint, KeyRound, Mail, Phone, ShieldCheck } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import * as SecureStore from "expo-secure-store";

import { useAuth } from "../auth";
import { AccountMfaStep } from "../auth/AccountMfaStep";
import { sendOtp, verifyOtp } from "../auth/authApi";
import { AppButton, AppCard, AppInput, AppStack, AppText, AuthScreen } from "../components";
import { useSecureScreen } from "../lib/secureScreen";
import { contactProblem, detectContact, EMAIL_PATTERN, shapeContactInput } from "../lib/contact";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;
type Method = "password" | "otp";
type IconType = typeof Mail;

const RESEND_COOLDOWN_SEC = 60;
// The last identifier that signed in on this device (never the password), so a
// returning traveller only types their password. Kept in the device keychain.
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

export function LoginScreen({ navigation }: Props) {
  useSecureScreen();
  const { signIn, signInWithPasskey, completeOtpSignIn, pendingMfa, beginMfaChallenge, cancelMfa, error: sessionNotice } = useAuth();
  const [method, setMethod] = useState<Method>("password");

  // Password login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // OTP login state
  const [otpContact, setOtpContact] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const [remembered, setRemembered] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  // Hidden entirely when the build/platform cannot do passkeys, so nobody
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
      setOtpContact((current) => current || last);
      // The password form takes an email only, so a remembered phone fills the code tab alone.
      if (last.includes("@")) {
        setEmail((current) => current || last);
        setRemembered(true);
        setTimeout(() => passwordRef.current?.focus(), 350);
      }
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

  // Password sign-in is by email only: one clear identifier, no guessing.
  const emailValid = EMAIL_PATTERN.test(email.trim());
  const canSubmitPassword = emailValid && password.length > 0;
  const contact = detectContact(otpContact);
  const otpContactValid = Boolean(contact);

  async function submitPassword() {
    if (loading) return;
    if (!canSubmitPassword) {
      setError(emailValid ? "Enter your password." : "Enter a valid email address.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(email.trim().toLowerCase(), password);
      rememberLogin(email);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function sendLoginCode(resend = false) {
    if (loading || (resend && resendIn > 0)) return;
    setLoading(true);
    setError(null);
    try {
      // No role: login OTP — the account must already exist.
      if (!contact) return;
      await sendOtp(contact.destination);
      startResendCooldown();
      if (!resend) {
        setCode("");
        setCodeSent(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function submitOtp(value = code) {
    if (loading || value.trim().length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      if (!contact) return;
      const res = await verifyOtp(contact.destination, value.trim());
      if (beginMfaChallenge(res)) {
        // The account has an authenticator: the next step asks for its code.
        rememberLogin(otpContact);
        setLoading(false);
        return;
      }
      if (!res.token) {
        throw new Error(res.message || res.error || "Verification failed. Please try again.");
      }
      await completeOtpSignIn(res.token, res.user);
      rememberLogin(otpContact);
    } catch (e) {
      // Map the backend's technical messages to friendly, actionable copy.
      const raw = e instanceof Error ? e.message : "";
      const friendly = /no otp found|expired|not found/i.test(raw)
        ? "That code has expired or was not found. Tap Resend code to get a new one."
        : /incorrect|invalid|wrong|mismatch/i.test(raw)
          ? "That code is not correct. Check it and try again, or resend a new one."
          : "We could not verify that code. Please try again or resend a new one.";
      setError(friendly);
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
      setError(formatPasskeyError(e, "Passkey sign-in failed. Use password or OTP, then add a passkey from Security."));
    } finally {
      setPasskeyLoading(false);
    }
  }

  function switchMethod(next: Method) {
    if (next === method) return;
    setMethod(next);
    setError(null);
    setCode("");
    setCodeSent(false);
  }

  return (
    <AuthScreen
      title={pendingMfa ? "Verify it's you" : "Welcome back"}
      subtitle={
        pendingMfa
          ? "Your account is protected with an authenticator app."
          : remembered
            ? "Enter your password to continue."
            : "Sign in to book, pay and track your trips."
      }
      onBack={() => (pendingMfa ? cancelMfa() : navigation.goBack())}
      icon={<KeyRound color={colors.white} size={24} />}
      footer={
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Register")}>
          <AppText variant="bodySmall" tone="primary" weight="bold" style={styles.note}>
            New to NoLSAF? Create your traveller account
          </AppText>
        </Pressable>
      }
    >
      <AppStack gap={5}>
          {/* Why the last session ended (e.g. an authenticator was turned on), so a sign-out is never silent. */}
          {sessionNotice && !pendingMfa ? (
            <View style={styles.sessionNotice}>
              <ShieldCheck color={colors.primary} size={16} />
              <AppText variant="caption" weight="semiBold" style={styles.contactHintText}>
                {sessionNotice}
              </AppText>
            </View>
          ) : null}
          {pendingMfa ? (
            <AccountMfaStep
              onRestart={(message) => {
                setPassword("");
                setCode("");
                setCodeSent(false);
                setError(message);
              }}
            />
          ) : (
          <AppCard style={styles.authCard}>
            <AppStack gap={4}>
              {passkeyAvailable ? (
                <View style={styles.passkeyBlock}>
                  <AppButton
                    title="Continue with passkey"
                    loading={passkeyLoading}
                    disabled={loading}
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
              <View style={styles.methodRow}>
                <MethodPill Icon={KeyRound} label="Password" active={method === "password"} onPress={() => switchMethod("password")} />
                <MethodPill Icon={ShieldCheck} label="One-time code" active={method === "otp"} onPress={() => switchMethod("otp")} />
              </View>

              {method === "password" ? (
                <>
                  <AppInput
                    label="Email"
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    textContentType="username"
                    autoComplete="email"
                    returnKeyType="next"
                    submitBehavior="submit"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    value={email}
                    onChangeText={(value) => {
                      setEmail(value);
                      if (error) setError(null);
                    }}
                    placeholder="you@example.com"
                    error={email.trim().length >= 6 && !emailValid ? (email.includes("@") ? "Check the email address." : "Use your email here. For a phone number, use One-time code.") : undefined}
                    hint={
                      remembered && email ? (
                        <Pressable
                          accessibilityRole="button"
                          hitSlop={8}
                          onPress={() => {
                            setEmail("");
                            setRemembered(false);
                            void SecureStore.deleteItemAsync(LAST_LOGIN_KEY).catch(() => undefined);
                          }}
                        >
                          <AppText variant="caption" weight="bold" tone="primary">
                            Not you?
                          </AppText>
                        </Pressable>
                      ) : undefined
                    }
                  />
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
                    placeholder="Enter password"
                  />
                  {error ? (
                    <AppText variant="bodySmall" tone="danger">
                      {error}
                    </AppText>
                  ) : null}
                  <Pressable accessibilityRole="button" onPress={() => navigation.navigate("ForgotPassword")} style={styles.forgotLink}>
                    <AppText variant="bodySmall" tone="primary" weight="bold">
                      Forgot password?
                    </AppText>
                  </Pressable>
                  <AppButton
                    title="Sign in"
                    loading={loading}
                    disabled={passkeyLoading || !canSubmitPassword}
                    onPress={submitPassword}
                    style={passkeyAvailable ? styles.submitNeutral : undefined}
                  />
                </>
              ) : (
                <>
                  {!codeSent ? (
                    <>
                      <AppInput
                        label="Phone or email"
                        value={otpContact}
                        onChangeText={(value) => {
                          // A phone is shaped as it is typed (digits only, never longer than the
                          // prefix allows); anything with letters or an @ is left as typed.
                          setOtpContact(shapeContactInput(value));
                          if (error) setError(null);
                        }}
                        placeholder="0712 345 678 or you@example.com"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        textContentType="username"
                        autoComplete="username"
                        returnKeyType="send"
                        onSubmitEditing={() => otpContactValid && sendLoginCode(false)}
                      />
                      {contactProblem(otpContact) ? (
                        <AppText variant="caption" tone="danger" style={styles.contactInvalid}>
                          {contactProblem(otpContact)}
                        </AppText>
                      ) : null}
                      {contact ? (
                        <View style={styles.contactHint}>
                          {contact.channel === "PHONE" ? <Phone color={colors.primary} size={14} /> : <Mail color={colors.primary} size={14} />}
                          <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.contactHintText}>
                            {contact.channel === "PHONE" ? "We will text a code to " : "We will email a code to "}
                            <AppText variant="caption" weight="bold">{contact.shown}</AppText>
                          </AppText>
                        </View>
                      ) : null}
                      {error ? (
                        <AppText variant="bodySmall" tone="danger">
                          {error}
                        </AppText>
                      ) : null}
                      <AppButton title="Send login code" loading={loading} disabled={!otpContactValid} onPress={() => sendLoginCode(false)} />
                    </>
                  ) : (
                    <>
                      <AppText variant="caption" tone="muted">
                        {/* The API only sends to a destination that has an account, and does not say which (so no one can probe who is registered). The copy stays just as honest. */}
                        {contact ? `If ${contact.shown} belongs to a NoLSAF account, a 6-digit code is on its way. It expires in 5 minutes.` : "If this belongs to a NoLSAF account, a 6-digit code is on its way. It expires in 5 minutes."}
                      </AppText>
                      <AppInput
                        label="Verification code"
                        value={code}
                        onChangeText={(value) => {
                          const next = value.replace(/\D/g, "").slice(0, 6);
                          setCode(next);
                          if (error) setError(null);
                          // No extra tap: the code verifies as soon as all six digits are in.
                          if (next.length === 6 && next !== code) void submitOtp(next);
                        }}
                        placeholder="123456"
                        keyboardType="number-pad"
                        maxLength={6}
                        autoFocus
                        textContentType="oneTimeCode"
                        autoComplete="sms-otp"
                        style={styles.codeInput}
                      />
                      {error ? (
                        <AppText variant="bodySmall" tone="danger">
                          {error}
                        </AppText>
                      ) : null}
                      <AppButton title="Verify and sign in" loading={loading} disabled={code.trim().length !== 6} onPress={() => submitOtp()} />
                      <AppButton
                        title={resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                        variant="ghost"
                        disabled={resendIn > 0 || loading}
                        onPress={() => sendLoginCode(true)}
                      />
                      <AppButton title="Use a different phone or email" variant="ghost" disabled={loading} onPress={() => { setCodeSent(false); setCode(""); setError(null); }} />
                      {resendIn === 0 ? (
                        <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Register")} style={styles.noCodeLink}>
                          <AppText variant="caption" tone="muted" style={styles.noCodeText}>
                            No code? This phone or email may not have an account yet.{" "}
                            <AppText variant="caption" weight="bold" tone="primary">Create one</AppText>
                          </AppText>
                        </Pressable>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </AppStack>
          </AppCard>
          )}
      </AppStack>
    </AuthScreen>
  );
}

/** Primary sign-in method: a segmented control, the chosen option a white raised tab. */
function MethodPill({ Icon, label, active, onPress }: { Icon: IconType; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.methodPill, active && styles.methodPillActive, pressed && !active && styles.pressed]}>
      <Icon color={active ? colors.primary : colors.mutedText} size={15} />
      <AppText variant="caption" weight={active ? "bold" : "semiBold"} tone={active ? "primary" : "muted"} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  authCard: {
    borderRadius: radius.xl,
    padding: spacing[5]
  },
  passkeyBlock: {
    gap: spacing[2]
  },
  passkeyHint: {
    textAlign: "center"
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
  // Segmented control: a quiet tinted track with a white active pill, so the
  // method switch reads as a control instead of competing with the buttons.
  methodRow: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: radius.md + 2,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: "#eef2f1"
  },
  methodPill: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: "transparent"
  },
  methodPillActive: {
    backgroundColor: colors.white,
    borderColor: colors.brand[200],
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1
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
  contactHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: -spacing[2]
  },
  noCodeLink: {
    alignSelf: "center",
    paddingHorizontal: spacing[2]
  },
  noCodeText: {
    textAlign: "center"
  },
  contactInvalid: {
    marginTop: -spacing[2]
  },
  contactHintText: {
    flex: 1,
    minWidth: 0
  },
  // When the passkey button holds the brand color, the form submit steps back
  // to neutral ink so the screen keeps a single accent action.
  submitNeutral: {
    backgroundColor: colors.ink,
    borderColor: colors.ink
  },
  note: {
    textAlign: "center",
    paddingHorizontal: spacing[3]
  },
  codeInput: {
    textAlign: "center",
    fontSize: 22,
    letterSpacing: 10,
    fontWeight: "700"
  },
  forgotLink: {
    alignSelf: "flex-end"
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  }
});

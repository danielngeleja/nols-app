import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { formatPasskeyError, nativePasskeysSupported } from "@nolsaf/native-ui";
import { Fingerprint, KeyRound, Mail, Phone, ShieldCheck } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { sendOtp, verifyOtp } from "../auth/authApi";
import { OtpChannel } from "../auth/types";
import { AppButton, AppCard, AppInput, AppStack, AppText, AuthScreen, PhoneNumberField } from "../components";
import { DEFAULT_PHONE_COUNTRY_CODE, isPhoneLengthValid } from "../lib/phone";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;
type Method = "password" | "otp";
type IconType = typeof Mail;

const RESEND_COOLDOWN_SEC = 60;

export function LoginScreen({ navigation }: Props) {
  const { signIn, signInWithPasskey, completeOtpSignIn } = useAuth();
  const [method, setMethod] = useState<Method>("password");

  // Password login state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // OTP login state
  const [channel, setChannel] = useState<OtpChannel>("PHONE");
  const [otpCountryCode, setOtpCountryCode] = useState(DEFAULT_PHONE_COUNTRY_CODE);
  const [otpPhone, setOtpPhone] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const canSubmitPassword = email.trim().length > 0 && password.length > 0;
  const destination = channel === "PHONE" ? { phone: `${otpCountryCode}${otpPhone.trim()}` } : { email: otpEmail.trim().toLowerCase() };
  const otpContactValid =
    channel === "PHONE" ? isPhoneLengthValid(otpPhone, otpCountryCode) : /^\S+@\S+\.\S{2,}$/.test(otpEmail.trim());

  async function submitPassword() {
    if (loading) return;
    if (!canSubmitPassword) {
      setError("Enter your email and password.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
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
      await sendOtp(destination);
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

  async function submitOtp() {
    if (loading || code.trim().length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await verifyOtp(destination, code.trim());
      if (!res.token) {
        throw new Error(res.message || res.error || "Verification failed. Please try again.");
      }
      await completeOtpSignIn(res.token, res.user);
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
      title="Welcome back"
      subtitle="Your stays, rides and journeys are ready when you are."
      onBack={() => navigation.goBack()}
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
                    label="Email, username or phone"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    textContentType="username"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                  />
                  <AppInput
                    label="Password"
                    secureTextEntry
                    textContentType="password"
                    value={password}
                    onChangeText={setPassword}
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
                    disabled={passkeyLoading}
                    onPress={submitPassword}
                    style={passkeyAvailable ? styles.submitNeutral : undefined}
                  />
                </>
              ) : (
                <>
                  {!codeSent ? (
                    <>
                      <View style={styles.methodRow}>
                        <MethodPill Icon={Phone} label="Phone (SMS)" active={channel === "PHONE"} onPress={() => setChannel("PHONE")} />
                        <MethodPill Icon={Mail} label="Email" active={channel === "EMAIL"} onPress={() => setChannel("EMAIL")} />
                      </View>
                      {channel === "PHONE" ? (
                        <PhoneNumberField
                          label="Phone number"
                          countryCode={otpCountryCode}
                          onCountryCodeChange={setOtpCountryCode}
                          value={otpPhone}
                          onChangeText={setOtpPhone}
                        />
                      ) : (
                        <AppInput
                          label="Email"
                          value={otpEmail}
                          onChangeText={setOtpEmail}
                          placeholder="you@example.com"
                          autoCapitalize="none"
                          keyboardType="email-address"
                          textContentType="emailAddress"
                        />
                      )}
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
                        Enter the 6-digit code we sent you. It expires in 5 minutes.
                      </AppText>
                      <AppInput
                        label="Verification code"
                        value={code}
                        onChangeText={(value) => setCode(value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="123456"
                        keyboardType="number-pad"
                        maxLength={6}
                        textContentType="oneTimeCode"
                        style={styles.codeInput}
                      />
                      {error ? (
                        <AppText variant="bodySmall" tone="danger">
                          {error}
                        </AppText>
                      ) : null}
                      <AppButton title="Verify and login" loading={loading} disabled={code.trim().length !== 6} onPress={submitOtp} />
                      <AppButton
                        title={resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                        variant="ghost"
                        disabled={resendIn > 0 || loading}
                        onPress={() => sendLoginCode(true)}
                      />
                      <AppButton title="Use a different phone or email" variant="ghost" disabled={loading} onPress={() => { setCodeSent(false); setCode(""); setError(null); }} />
                    </>
                  )}
                </>
              )}
            </AppStack>
          </AppCard>
      </AppStack>
    </AuthScreen>
  );
}

function MethodPill({ Icon, label, active, onPress }: { Icon: IconType; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.methodPill, active && styles.methodPillActive, pressed && styles.pressed]}>
      <Icon color={active ? colors.white : colors.mutedText} size={15} />
      <AppText variant="caption" weight={active ? "bold" : "semiBold"} tone={active ? "inverse" : "muted"} numberOfLines={1}>
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
    gap: spacing[1],
    padding: spacing[1],
    borderRadius: radius.lg,
    backgroundColor: colors.brand[100],
    borderWidth: 1,
    borderColor: colors.brand[200]
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
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    shadowColor: "#0f172a",
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2
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

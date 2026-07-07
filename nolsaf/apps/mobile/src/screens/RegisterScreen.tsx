import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Check, CheckCircle2, ChevronLeft, Eye, EyeOff, Mail, Phone, ShieldCheck } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAuth } from "../auth";
import { completeOtpProfile, sendOtp, verifyOtp } from "../auth/authApi";
import { OtpChannel } from "../auth/types";
import { AppButton, AppCard, AppInput, AppStack, AppText, AuthScreen, PhoneNumberField } from "../components";
import { DEFAULT_PHONE_COUNTRY_CODE, isPhoneLengthValid } from "../lib/phone";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;
type Step = "contact" | "otp" | "profile";
type IconType = typeof Phone;

const RESEND_COOLDOWN_SEC = 60;

function maskDestination(channel: OtpChannel, value: string) {
  if (channel === "PHONE") {
    return value.length > 4 ? `••••••${value.slice(-4)}` : value;
  }
  const [local, domain] = value.split("@");
  if (!domain) return value;
  return `${local.slice(0, 2)}****@${domain}`;
}

export function RegisterScreen({ navigation, route }: Props) {
  const { completeOtpSignIn } = useAuth();
  const referralCode = route.params?.ref;

  const [step, setStep] = useState<Step>("contact");
  const [channel, setChannel] = useState<OtpChannel>("PHONE");
  const [countryCode, setCountryCode] = useState(DEFAULT_PHONE_COUNTRY_CODE);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const destination = channel === "PHONE" ? { phone: `${countryCode}${phone.trim()}` } : { email: email.trim().toLowerCase() };
  const destinationValue = channel === "PHONE" ? `${countryCode}${phone.trim()}` : email.trim().toLowerCase();
  const contactValid = channel === "PHONE" ? isPhoneLengthValid(phone, countryCode) : /^\S+@\S+\.\S{2,}$/.test(email.trim());

  async function sendCode(resend = false) {
    if (loading || (resend && resendIn > 0)) return;
    setLoading(true);
    setError(null);
    try {
      await sendOtp(destination, "CUSTOMER");
      startResendCooldown();
      if (!resend) {
        setCode("");
        setStep("otp");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the code. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    if (loading || code.trim().length !== 6) return;
    setLoading(true);
    setError(null);
    try {
      const res = await verifyOtp(destination, code.trim(), "CUSTOMER");
      if (!res.token) {
        throw new Error(res.message || res.error || "Verification failed. Please try again.");
      }
      setSessionToken(res.token);
      setError(null);
      setStep("profile");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const passwordChecks = [
    { label: "8 to 12 characters", ok: password.length >= 8 && password.length <= 12 },
    { label: "Uppercase and lowercase letters", ok: /[A-Z]/.test(password) && /[a-z]/.test(password) },
    { label: "At least one number", ok: /\d/.test(password) },
    { label: "At least one symbol", ok: /[^A-Za-z0-9]/.test(password) },
    { label: "Confirmation matches", ok: Boolean(confirmPassword) && password === confirmPassword }
  ];
  const profileValid = name.trim().length >= 2 && passwordChecks.every((item) => item.ok);

  async function finishProfile() {
    if (loading || !sessionToken || !profileValid) return;
    setLoading(true);
    setError(null);
    try {
      await completeOtpProfile(sessionToken, {
        name: name.trim(),
        password,
        ...(channel === "PHONE" && /^\S+@\S+\.\S{2,}$/.test(email.trim()) ? { email: email.trim().toLowerCase() } : {}),
        ...(referralCode ? { referralCode } : {})
      });
      await completeOtpSignIn(sessionToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish your profile. Please try again.");
      setLoading(false);
    }
  }

  const stepNumber = step === "contact" ? 1 : step === "otp" ? 2 : 3;
  const heroTitle = step === "contact" ? "Join NoLSAF" : step === "otp" ? "Verify your contact" : "Make it yours";
  const heroSubtitle =
    step === "contact"
      ? "One traveller account for verified stays, rides and tours."
      : step === "otp"
        ? "A quick security check keeps your account protected."
        : "Add the essentials now; you can complete the rest later.";

  const handleBack = () => {
    if (step === "contact") navigation.goBack();
    else if (step === "otp") setStep("contact");
    else setStep("otp");
  };

  return (
    <AuthScreen
      title={heroTitle}
      subtitle={heroSubtitle}
      onBack={handleBack}
      icon={<ShieldCheck color={colors.white} size={24} />}
      progress={{ current: stepNumber, total: 3, label: "Account setup" }}
      footer={
        step === "contact" ? (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Login")} style={styles.loginLink}>
            <ChevronLeft color={colors.primary} size={14} />
            <AppText variant="bodySmall" tone="primary" weight="bold">
              Already have an account? Login
            </AppText>
          </Pressable>
        ) : undefined
      }
    >
        <AppStack gap={5}>
          {referralCode ? (
            <AppText variant="bodySmall" tone="primary" weight="bold" style={styles.center}>
              You were invited by a friend
            </AppText>
          ) : null}

          {step === "contact" ? (
            <AppCard style={styles.authCard}>
              <AppStack gap={4}>
                <AppText variant="titleSm" weight="extraBold">
                  Where should we send your code?
                </AppText>
                <View style={styles.channelRow}>
                  <ChannelPill Icon={Phone} label="Phone (SMS)" active={channel === "PHONE"} onPress={() => setChannel("PHONE")} />
                  <ChannelPill Icon={Mail} label="Email" active={channel === "EMAIL"} onPress={() => setChannel("EMAIL")} />
                </View>
                {channel === "PHONE" ? (
                  <PhoneNumberField
                    label="Phone number"
                    countryCode={countryCode}
                    onCountryCodeChange={setCountryCode}
                    value={phone}
                    onChangeText={setPhone}
                  />
                ) : (
                  <AppInput
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                  />
                )}
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed(!agreed)} style={styles.agreeRow}>
                  <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
                    {agreed ? <Check color={colors.white} size={14} /> : null}
                  </View>
                  <AppText variant="caption" tone="muted" style={styles.flex}>
                    I agree to the NoLSAF Terms and Conditions and Privacy Policy.
                  </AppText>
                </Pressable>
                {error ? (
                  <AppText variant="bodySmall" tone="danger">
                    {error}
                  </AppText>
                ) : null}
                <AppButton title="Send code" loading={loading} disabled={!contactValid || !agreed} onPress={() => sendCode(false)} />
              </AppStack>
            </AppCard>
          ) : null}

          {step === "otp" ? (
            <AppCard style={styles.authCard}>
              <AppStack gap={4}>
                <View style={styles.otpHeader}>
                  <View style={styles.otpIcon}>
                    <ShieldCheck color={colors.primary} size={20} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="titleSm" weight="extraBold">
                      Enter your code
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      We sent a 6-digit code to {maskDestination(channel, destinationValue)}. It expires in 5 minutes.
                    </AppText>
                  </View>
                </View>
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
                <AppButton title="Verify" loading={loading} disabled={code.trim().length !== 6} onPress={verifyCode} />
                <AppButton
                  title={resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                  variant="ghost"
                  disabled={resendIn > 0 || loading}
                  onPress={() => sendCode(true)}
                />
              </AppStack>
            </AppCard>
          ) : null}

          {step === "profile" ? (
            <AppCard style={styles.authCard}>
              <AppStack gap={4}>
                <AppText variant="titleSm" weight="extraBold">
                  Finish your profile
                </AppText>
                <AppInput label="Full name" required value={name} onChangeText={setName} placeholder="Your name" textContentType="name" />
                {channel === "PHONE" ? (
                  <AppInput
                    label="Email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    autoCapitalize="none"
                    keyboardType="email-address"
                    textContentType="emailAddress"
                  />
                ) : null}
                <PasswordField
                  label="Password"
                  required
                  value={password}
                  onChangeText={setPassword}
                  placeholder="8 to 12 characters"
                  visible={showPassword}
                  onToggle={() => setShowPassword((value) => !value)}
                />
                {(password || confirmPassword) && !passwordChecks.every((item) => item.ok) ? <PasswordChecklist checks={passwordChecks} /> : null}
                <PasswordField
                  label="Confirm password"
                  required
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Re-enter your password"
                  visible={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword((value) => !value)}
                />
                {error ? (
                  <AppText variant="bodySmall" tone="danger">
                    {error}
                  </AppText>
                ) : null}
                <AppButton title="Finish and login" loading={loading} disabled={!profileValid} onPress={finishProfile} />
              </AppStack>
            </AppCard>
          ) : null}

        </AppStack>
    </AuthScreen>
  );
}

function PasswordField({
  label,
  required,
  value,
  onChangeText,
  visible,
  onToggle,
  placeholder
}: {
  label: string;
  required?: boolean;
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
        {required ? (
          <AppText variant="label" weight="bold" tone="danger">
            {" *"}
          </AppText>
        ) : null}
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
          textContentType="newPassword"
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

function ChannelPill({ Icon, label, active, onPress }: { Icon: IconType; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.channelPill, active && styles.channelPillActive, pressed && styles.pressed]}>
      <Icon color={active ? colors.white : colors.primary} size={16} />
      <AppText variant="caption" weight="extraBold" tone={active ? "inverse" : "primary"}>
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
  flex: {
    flex: 1,
    minWidth: 0
  },
  center: {
    textAlign: "center",
    paddingHorizontal: spacing[3]
  },
  codeInput: {
    textAlign: "center",
    fontSize: 22,
    letterSpacing: 10,
    fontWeight: "700"
  },
  channelRow: {
    flexDirection: "row",
    gap: spacing[2]
  },
  channelPill: {
    flex: 1,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white
  },
  channelPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  agreeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  checkbox: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  otpHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  otpIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  loginLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1]
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  },
  passwordWrap: {
    gap: spacing[2],
    minWidth: 0
  },
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
  }
});

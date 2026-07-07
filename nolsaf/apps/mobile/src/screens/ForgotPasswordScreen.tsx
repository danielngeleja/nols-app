import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CheckCircle2, Eye, EyeOff, Mail, Phone, ShieldCheck } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { resetPassword, sendOtp, verifyOtp } from "../auth/authApi";
import { OtpChannel } from "../auth/types";
import { AppButton, AppCard, AppInput, AppStack, AppText, AuthScreen, PhoneNumberField } from "../components";
import { getErrorMessage } from "../lib/apiClient";
import { formatCooldown, getCooldownUntil } from "../lib/otpCooldown";
import { DEFAULT_PHONE_COUNTRY_CODE, isPhoneLengthValid } from "../lib/phone";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;
type Step = "contact" | "otp" | "password" | "done";
type IconType = typeof Mail;

const RESEND_COOLDOWN_SEC = 60;

function maskDestination(channel: OtpChannel, value: string) {
  if (channel === "PHONE") {
    return value.length > 4 ? `••••••${value.slice(-4)}` : value;
  }
  const [local, domain] = value.split("@");
  if (!domain) return value;
  return `${local.slice(0, 2)}****@${domain}`;
}

export function ForgotPasswordScreen({ navigation }: Props) {
  const [step, setStep] = useState<Step>("contact");
  const [channel, setChannel] = useState<OtpChannel>("PHONE");
  const [countryCode, setCountryCode] = useState(DEFAULT_PHONE_COUNTRY_CODE);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetUserId, setResetUserId] = useState<number | null>(null);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (cooldownTimerRef.current) {
      clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = null;
    }
    if (!cooldownUntil) {
      setCooldownRemaining(0);
      return;
    }
    const tick = () => {
      const remaining = cooldownUntil - Date.now();
      if (remaining <= 0) {
        setCooldownRemaining(0);
        setCooldownUntil(null);
        setRateLimitMessage(null);
        if (cooldownTimerRef.current) {
          clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
        }
        return;
      }
      setCooldownRemaining(remaining);
    };
    tick();
    cooldownTimerRef.current = setInterval(tick, 1000);
    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, [cooldownUntil]);

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
    if (loading || (resend && resendIn > 0) || cooldownRemaining > 0) return;
    setLoading(true);
    setError(null);
    try {
      await sendOtp(destination, "RESET");
      setRateLimitMessage(null);
      setCooldownUntil(null);
      startResendCooldown();
      if (!resend) {
        setCode("");
        setStep("otp");
      }
    } catch (e) {
      const cooldown = getCooldownUntil(e);
      if (cooldown) {
        setRateLimitMessage(e instanceof Error ? e.message : "Too many OTP requests.");
        setCooldownUntil(cooldown);
      } else {
        setError(e instanceof Error ? e.message : "Could not send the code. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    if (loading || code.trim().length !== 6 || cooldownRemaining > 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await verifyOtp(destination, code.trim(), "RESET");
      if (!res.resetToken || !res.user?.id) {
        throw new Error(res.message || res.error || "Verification failed. Please try again.");
      }
      setResetToken(res.resetToken);
      setResetUserId(res.user.id);
      setError(null);
      setStep("password");
    } catch (e) {
      const cooldown = getCooldownUntil(e);
      if (cooldown) {
        setRateLimitMessage(e instanceof Error ? e.message : "Too many verification attempts.");
        setCooldownUntil(cooldown);
      } else {
        setError(e instanceof Error ? e.message : "Verification failed. Please try again.");
      }
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
  const passwordValid = passwordChecks.every((item) => item.ok);

  async function submitNewPassword() {
    if (loading || !resetToken || !resetUserId || !passwordValid) return;
    setLoading(true);
    setError(null);
    try {
      const res = await resetPassword(resetUserId, resetToken, password);
      if (!res.ok) {
        throw new Error(res.message || res.error || "Could not reset your password. Please try again.");
      }
      setStep("done");
    } catch (e) {
      setError(getErrorMessage(e, "Could not reset your password. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  const stepNumber = step === "contact" ? 1 : step === "otp" ? 2 : 3;
  const heroTitle = step === "done" ? "You're secure again" : step === "password" ? "Choose a new password" : "Recover your account";
  const heroSubtitle =
    step === "contact"
      ? "We'll verify that the account belongs to you."
      : step === "otp"
        ? "Enter the private code sent to your verified contact."
        : step === "password"
          ? "Create a strong password you don't use elsewhere."
          : "Your password has been updated successfully.";

  const handleBack = () => {
    if (step === "otp") setStep("contact");
    else if (step === "password") setStep("otp");
    else navigation.goBack();
  };

  return (
    <AuthScreen
      title={heroTitle}
      subtitle={heroSubtitle}
      onBack={handleBack}
      icon={<ShieldCheck color={colors.white} size={24} />}
      progress={{ current: stepNumber, total: 3, label: step === "done" ? "Recovery complete" : "Account recovery" }}
    >
        <AppStack gap={5}>
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
                {error ? (
                  <AppText variant="bodySmall" tone="danger">
                    {error}
                  </AppText>
                ) : null}
                {rateLimitMessage && cooldownRemaining > 0 ? (
                  <AppText variant="bodySmall" tone="danger">
                    {rateLimitMessage} Please wait {formatCooldown(cooldownRemaining)} before requesting another code.
                  </AppText>
                ) : null}
                <AppButton
                  title={cooldownRemaining > 0 ? `Try again in ${formatCooldown(cooldownRemaining)}` : "Send code"}
                  loading={loading}
                  disabled={!contactValid || cooldownRemaining > 0}
                  onPress={() => sendCode(false)}
                />
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
                {rateLimitMessage && cooldownRemaining > 0 ? (
                  <AppText variant="bodySmall" tone="danger">
                    {rateLimitMessage} Please wait {formatCooldown(cooldownRemaining)} before trying again.
                  </AppText>
                ) : null}
                <AppButton title="Verify" loading={loading} disabled={code.trim().length !== 6 || cooldownRemaining > 0} onPress={verifyCode} />
                <AppButton
                  title={
                    cooldownRemaining > 0
                      ? `Try again in ${formatCooldown(cooldownRemaining)}`
                      : resendIn > 0
                        ? `Resend code in ${resendIn}s`
                        : "Resend code"
                  }
                  variant="ghost"
                  disabled={resendIn > 0 || loading || cooldownRemaining > 0}
                  onPress={() => sendCode(true)}
                />
              </AppStack>
            </AppCard>
          ) : null}

          {step === "password" ? (
            <AppCard style={styles.authCard}>
              <AppStack gap={4}>
                <AppText variant="titleSm" weight="extraBold">
                  Choose a new password
                </AppText>
                <PasswordField
                  label="New password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="8 to 12 characters"
                  visible={showPassword}
                  onToggle={() => setShowPassword((value) => !value)}
                />
                {(password || confirmPassword) && !passwordValid ? <PasswordChecklist checks={passwordChecks} /> : null}
                <PasswordField
                  label="Confirm new password"
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
                <AppButton title="Reset password" loading={loading} disabled={!passwordValid} onPress={submitNewPassword} />
              </AppStack>
            </AppCard>
          ) : null}

          {step === "done" ? (
            <AppCard style={styles.authCard}>
              <AppStack gap={3}>
                <View style={styles.otpHeader}>
                  <View style={styles.otpIcon}>
                    <CheckCircle2 color={colors.primary} size={20} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="titleSm" weight="extraBold">
                      Password updated
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      You can now login with your new password.
                    </AppText>
                  </View>
                </View>
                <AppButton title="Back to login" onPress={() => navigation.replace("Login")} />
              </AppStack>
            </AppCard>
          ) : null}
        </AppStack>
    </AuthScreen>
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
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  }
});

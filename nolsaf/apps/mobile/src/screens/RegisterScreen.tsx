import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Check, CheckCircle2, Mail, Phone } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { completeOtpProfile, sendOtp, verifyOtp } from "../auth/authApi";
import { OtpChannel } from "../auth/types";
import { AppButton, AppInput, AppText, AuthScreen, CodeBoxes, PhoneNumberField } from "../components";
import { useSecureScreen } from "../lib/secureScreen";
import { DEFAULT_PHONE_COUNTRY_CODE, isPhoneLengthValid } from "../lib/phone";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Register">;
type Step = "contact" | "otp" | "profile";
type IconType = typeof Phone;

const RESEND_COOLDOWN_SEC = 60;
const EMAIL_RE = /^\S+@\S+\.\S{2,}$/;

function maskDestination(channel: OtpChannel, value: string) {
  if (channel === "PHONE") {
    return value.length > 4 ? `••••••${value.slice(-4)}` : value;
  }
  const [local, domain] = value.split("@");
  if (!domain) return value;
  return `${local.slice(0, 2)}•••@${domain}`;
}

export function RegisterScreen({ navigation, route }: Props) {
  useSecureScreen();
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
  const contactValid = channel === "PHONE" ? isPhoneLengthValid(phone, countryCode) : EMAIL_RE.test(email.trim());

  async function sendCode(resend = false) {
    if (loading || (resend && resendIn > 0)) return;
    if (!contactValid) {
      setError(channel === "PHONE" ? "Enter a valid phone number." : "Enter a valid email address.");
      return;
    }
    if (!agreed) {
      setError("Tick the box to agree to the Terms and Privacy Policy.");
      return;
    }
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
      setError(e instanceof Error ? e.message : "Could not send the code. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode(value = code) {
    if (loading) return;
    if (value.trim().length !== 6) {
      setError("Enter all 6 digits of the code.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await verifyOtp(destination, value.trim(), "CUSTOMER");
      if (!res.token) {
        throw new Error(res.message || res.error || "Verification failed. Try again.");
      }
      setSessionToken(res.token);
      setError(null);
      setStep("profile");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // The server's password rules, unchanged. The show/hide eye replaces a second "confirm" field.
  const passwordChecks = [
    { label: "8 to 12 characters", ok: password.length >= 8 && password.length <= 12 },
    { label: "upper and lower case", ok: /[A-Z]/.test(password) && /[a-z]/.test(password) },
    { label: "a number", ok: /\d/.test(password) },
    { label: "a symbol", ok: /[^A-Za-z0-9]/.test(password) }
  ];
  const passedChecks = passwordChecks.filter((item) => item.ok).length;
  const passwordOk = passedChecks === passwordChecks.length;
  const emailValid = EMAIL_RE.test(email.trim());
  const phoneValid = isPhoneLengthValid(phone, countryCode);
  const profileValid = name.trim().length >= 2 && emailValid && phoneValid && passwordOk;

  async function finishProfile() {
    if (loading || !sessionToken) return;
    if (!profileValid) {
      setError(
        name.trim().length < 2
          ? "Enter your full name."
          : !emailValid
            ? "Enter a valid email address."
            : !phoneValid
              ? "Enter a valid phone number."
              : "Your password still needs: " + passwordChecks.filter((item) => !item.ok).map((item) => item.label).join(", ") + "."
      );
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const completed = await completeOtpProfile(sessionToken, {
        name: name.trim(),
        password,
        email: email.trim().toLowerCase(),
        phone: `${countryCode}${phone.trim()}`,
        ...(referralCode ? { referralCode } : {})
      });
      if (completed.user?.registrationStatus !== "COMPLETE") {
        throw new Error("Your profile is still incomplete. Check your name, email and phone, then try again.");
      }
      await completeOtpSignIn(sessionToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not finish your account. Try again.");
      setLoading(false);
    }
  }

  const stepNumber = step === "contact" ? 1 : step === "otp" ? 2 : 3;
  const heading =
    step === "contact"
      ? { title: "Create your account", subtitle: "We'll send a code to confirm it's you." }
      : step === "otp"
        ? { title: "Enter the code", subtitle: `Sent to ${maskDestination(channel, destinationValue)}` }
        : { title: "Almost done", subtitle: undefined };

  const handleBack = () => {
    setError(null);
    if (step === "contact") navigation.goBack();
    else if (step === "otp") setStep("contact");
    else setStep("otp");
  };

  const errorLine = error ? (
    <AppText variant="bodySmall" tone="danger">
      {error}
    </AppText>
  ) : null;

  return (
    <AuthScreen
      title={heading.title}
      subtitle={heading.subtitle}
      onBack={handleBack}
      progress={{ current: stepNumber, total: 3, label: "Account setup" }}
      footer={
        step === "contact" ? (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Login")} style={styles.centerRow}>
            <AppText variant="bodySmall" tone="muted">
              Have an account?{" "}
            </AppText>
            <AppText variant="bodySmall" tone="primary" weight="bold">
              Sign in
            </AppText>
          </Pressable>
        ) : undefined
      }
    >
      {referralCode ? (
        <View style={styles.inviteNote}>
          <CheckCircle2 color={colors.primary} size={15} />
          <AppText variant="caption" weight="semiBold" tone="primary">
            You were invited by a friend
          </AppText>
        </View>
      ) : null}

      {step === "contact" ? (
        <>
          <View style={styles.segment} accessibilityRole="tablist">
            <SegmentOption Icon={Phone} label="Phone" active={channel === "PHONE"} onPress={() => setChannel("PHONE")} />
            <SegmentOption Icon={Mail} label="Email" active={channel === "EMAIL"} onPress={() => setChannel("EMAIL")} />
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
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
          )}
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed(!agreed)} style={styles.agreeRow}>
            <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
              {agreed ? <Check color={colors.white} size={14} /> : null}
            </View>
            <AppText variant="caption" tone="muted" style={styles.flex}>
              I agree to the <AppText variant="caption" weight="bold" tone="primary">Terms</AppText> and{" "}
              <AppText variant="caption" weight="bold" tone="primary">Privacy Policy</AppText>
            </AppText>
          </Pressable>
          {errorLine}
          <AppButton title="Send code" loading={loading} onPress={() => sendCode(false)} />
        </>
      ) : null}

      {step === "otp" ? (
        <>
          <CodeBoxes
            value={code}
            onChange={(next) => {
              setCode(next);
              if (error) setError(null);
            }}
            onComplete={(next) => void verifyCode(next)}
            error={Boolean(error)}
            editable={!loading}
          />
          {errorLine}
          <AppButton title="Verify" loading={loading} onPress={() => verifyCode()} />
          <View style={styles.linkRow}>
            <Pressable accessibilityRole="button" hitSlop={8} disabled={resendIn > 0 || loading} onPress={() => sendCode(true)}>
              <AppText variant="bodySmall" tone={resendIn > 0 ? "muted" : "primary"} weight="bold">
                {resendIn > 0 ? `Resend in 0:${String(resendIn).padStart(2, "0")}` : "Send a new code"}
              </AppText>
            </Pressable>
            <Pressable accessibilityRole="button" hitSlop={8} disabled={loading} onPress={() => { setError(null); setStep("contact"); }}>
              <AppText variant="bodySmall" tone="primary" weight="bold">
                {channel === "PHONE" ? "Change number" : "Change email"}
              </AppText>
            </Pressable>
          </View>
        </>
      ) : null}

      {step === "profile" ? (
        <>
          {/* The contact just verified: shown, never asked again. */}
          <View style={styles.lockedField}>
            <AppText variant="label" weight="semiBold" tone="muted">
              {channel === "PHONE" ? "Phone" : "Email"}
            </AppText>
            <View style={styles.lockedRow}>
              <AppText variant="body" numberOfLines={1} style={styles.flex}>
                {destinationValue}
              </AppText>
              <View style={styles.verifiedTag}>
                <Check color={colors.success} size={12} />
                <AppText variant="caption" weight="bold" tone="success">
                  Verified
                </AppText>
              </View>
            </View>
          </View>

          <AppInput label="Full name" value={name} onChangeText={setName} placeholder="Your full name" textContentType="name" autoComplete="name" />
          {channel === "PHONE" ? (
            <AppInput
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              error={email.trim().length >= 5 && !emailValid ? "Check the email address." : undefined}
            />
          ) : (
            <PhoneNumberField
              label="Phone number"
              countryCode={countryCode}
              onCountryCodeChange={setCountryCode}
              value={phone}
              onChangeText={setPhone}
            />
          )}

          <View style={styles.passwordBlock}>
            <AppInput
              label="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="8 to 12 characters"
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              autoComplete="new-password"
            />
            {password ? (
              <>
                <View style={styles.meter}>
                  {passwordChecks.map((item, index) => (
                    <View key={item.label} style={[styles.meterBar, index < passedChecks && (passwordOk ? styles.meterStrong : styles.meterPartial)]} />
                  ))}
                </View>
                <AppText variant="caption" tone={passwordOk ? "success" : "muted"} weight={passwordOk ? "bold" : "regular"}>
                  {passwordOk
                    ? "Strong password"
                    : `Still needed: ${passwordChecks.filter((item) => !item.ok).map((item) => item.label).join(", ")}`}
                </AppText>
              </>
            ) : null}
          </View>

          {errorLine}
          <AppButton title="Create account" loading={loading} onPress={finishProfile} />
        </>
      ) : null}
    </AuthScreen>
  );
}

function SegmentOption({ Icon, label, active, onPress }: { Icon: IconType; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.segmentOption, active && styles.segmentOptionActive, pressed && !active && styles.pressed]}
    >
      <Icon color={active ? colors.primary : colors.mutedText} size={16} />
      <AppText variant="bodySmall" weight={active ? "bold" : "semiBold"} tone={active ? "primary" : "muted"}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0
  },
  centerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center"
  },
  inviteNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    alignSelf: "flex-start",
    borderRadius: radius.sm,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: 6
  },
  segment: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: radius.md,
    backgroundColor: "#f1f5f9"
  },
  segmentOption: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.sm
  },
  segmentOptionActive: {
    backgroundColor: colors.white,
    shadowColor: "#0f172a",
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1
  },
  agreeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  checkbox: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  lockedField: {
    gap: spacing[2]
  },
  lockedRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    paddingHorizontal: spacing[4]
  },
  verifiedTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 5,
    backgroundColor: "#ecfdf5",
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  passwordBlock: {
    gap: spacing[2]
  },
  meter: {
    flexDirection: "row",
    gap: 4
  },
  meterBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border
  },
  meterPartial: {
    backgroundColor: colors.warning
  },
  meterStrong: {
    backgroundColor: colors.primary
  },
  pressed: {
    opacity: 0.78
  }
});

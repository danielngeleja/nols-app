import { AppButton, AppInput, AppText, SafeScreen, colors, getErrorMessage, spacing } from "@nolsaf/native-ui";
import { Check } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { completeOwnerSignupProfile, sendOwnerSignupOtp, verifyOwnerSignupOtp } from "../auth/authApi";

type Props = { onBackToSignIn: () => void };
type Step = "details" | "otp";

const normalizePhone = (value: string) => {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");
  return trimmed.startsWith("+") ? `+${digits}` : `+255${digits.replace(/^0+/, "")}`;
};

export function RegisterOwnerScreen({ onBackToSignIn }: Props) {
  const { adoptSession } = useAuth();
  const [step, setStep] = useState<Step>("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("+255");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedPhone = normalizePhone(phone);
  const emailValid = /^\S+@\S+\.\S{2,}$/.test(email.trim());
  const phoneValid = /^\+\d{8,15}$/.test(normalizedPhone);
  const passwordValid =
    password.length >= 8 && password.length <= 12 &&
    /[A-Z]/.test(password) && /[a-z]/.test(password) &&
    /\d/.test(password) && /[^A-Za-z0-9]/.test(password) &&
    password === confirmPassword;
  const detailsValid = name.trim().length >= 2 && emailValid && phoneValid && passwordValid && agreed;

  const sendCode = async () => {
    if (!detailsValid || loading) return;
    setLoading(true);
    setError(null);
    try {
      await sendOwnerSignupOtp(normalizedPhone);
      setStep("otp");
    } catch (err) {
      setError(getErrorMessage(err, "Could not send the verification code."));
    } finally {
      setLoading(false);
    }
  };

  const finish = async () => {
    if (otp.trim().length !== 6 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const verified = await verifyOwnerSignupOtp(normalizedPhone, otp.trim());
      if (!verified.ok || !verified.token || !verified.user) {
        throw new Error(verified.message || verified.error || "Verification failed.");
      }
      const completed = await completeOwnerSignupProfile(verified.token, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: normalizedPhone,
        password
      });
      if (!completed.user || completed.user.registrationStatus !== "COMPLETE") {
        throw new Error(completed.message || completed.error || "Your owner profile is still incomplete.");
      }
      await adoptSession(verified.token, completed.user);
    } catch (err) {
      setError(getErrorMessage(err, "Could not complete owner registration."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeScreen contentStyle={styles.content}>
      <View style={styles.card}>
        <AppText variant="title" weight="bold">Register as property owner</AppText>
        <AppText variant="bodySmall" tone="muted">
          {step === "details" ? "Name, email, and phone are all required so your account, bookings, and support records stay connected." : `Enter the code sent to ${normalizedPhone}.`}
        </AppText>

        {step === "details" ? (
          <View style={styles.form}>
            <AppInput label="Full name" required value={name} onChangeText={setName} />
            <AppInput label="Email" required value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
            <AppInput label="Phone (include country code)" required value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+255712345678" />
            <AppInput label="Password" required value={password} onChangeText={setPassword} secureTextEntry placeholder="8–12 characters" />
            <AppInput label="Confirm password" required value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
            <AppText variant="caption" tone={passwordValid ? "success" : "soft"}>Use uppercase, lowercase, a number, and a symbol.</AppText>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed((value) => !value)} style={styles.agreeRow}>
              <View style={[styles.checkbox, agreed && styles.checked]}>{agreed ? <Check color={colors.white} size={14} /> : null}</View>
              <AppText variant="caption">I agree to the NoLSAF Terms and Privacy Policy.</AppText>
            </Pressable>
            <AppButton title="Send phone verification code" loading={loading} disabled={!detailsValid} onPress={() => void sendCode()} />
          </View>
        ) : (
          <View style={styles.form}>
            <AppInput label="Verification code" required value={otp} onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" maxLength={6} />
            <AppButton title="Verify and open dashboard" loading={loading} disabled={otp.length !== 6} onPress={() => void finish()} />
            <AppButton title="Change details" variant="ghost" onPress={() => setStep("details")} />
          </View>
        )}

        {error ? <AppText variant="caption" tone="danger">{error}</AppText> : null}
        <Pressable accessibilityRole="button" onPress={onBackToSignIn} style={styles.signIn}>
          <AppText variant="bodySmall" weight="bold" tone="primary">Back to sign in</AppText>
        </Pressable>
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: "center" },
  card: { gap: spacing[4], padding: spacing[5], borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.white },
  form: { gap: spacing[4] },
  agreeRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  checkbox: { width: 22, height: 22, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: 6 },
  checked: { backgroundColor: colors.primary, borderColor: colors.primary },
  signIn: { alignItems: "center", paddingVertical: spacing[2] }
});

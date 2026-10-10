import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  ImageIcon,
  LockKeyhole,
  Mail,
  Phone,
  UserRound
} from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, Platform, Pressable, StyleSheet, View } from "react-native";

import { confirmContactChange, requestContactChange } from "../auth/authApi";
import { ContactField } from "../auth/types";
import { useAuth } from "../auth";
import { AppButton, AppInput, AppStack, AppText, PhoneNumberField, SafeScreen, ScreenHeader } from "../components";
import { useSecureScreen } from "../lib/secureScreen";
import { apiUploadFile, getErrorMessage } from "../lib/apiClient";
import { DEFAULT_PHONE_COUNTRY_CODE } from "../lib/phone";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ProfileCompletion">;
type IconType = typeof UserRound;

function fmtDate(value?: string | null) {
  if (!value) return "Not recorded";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Not recorded" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function memberSince(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

const ROLE_LABELS: Record<string, string> = {
  CUSTOMER: "Traveller"
};

function roleLabel(role?: string | null) {
  const key = String(role || "CUSTOMER").toUpperCase();
  return ROLE_LABELS[key] || key;
}

const GENDER_OPTIONS = ["Male", "Female", "Other"] as const;

export function ProfileCompletionScreen({ navigation }: Props) {
  useSecureScreen();
  const { token, user, updateProfile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName || user?.name || "");
  const [address, setAddress] = useState(user?.address || "");
  const [tin, setTin] = useState(user?.tin || "");
  const [nationality, setNationality] = useState(user?.nationality || "");
  const [gender, setGender] = useState(user?.gender || "");
  const [loading, setLoading] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showTin, setShowTin] = useState(false);

  const displayName = user?.fullName || user?.name || user?.email || "NoLSAF customer";
  const initial = String(displayName).trim().charAt(0).toUpperCase() || "N";
  const since = memberSince(user?.createdAt);

  // Same checklist as the web account page, read from what is saved, so both agree on "complete".
  const checks = [
    { done: Boolean(user?.fullName || user?.name), label: "Add your name" },
    { done: Boolean(user?.emailVerifiedAt), label: user?.email ? "Verify your email" : "Add an email" },
    { done: Boolean(user?.phone), label: "Link a phone number" },
    { done: Boolean(user?.avatarUrl), label: "Add a profile photo" },
    { done: Boolean(String(user?.address || "").trim()), label: "Add your address" },
    { done: Boolean(String(user?.nationality || "").trim()), label: "Add your nationality" }
  ];
  const done = checks.filter((c) => c.done).length;
  const percent = Math.round((done / checks.length) * 100);
  const nextStep = checks.find((c) => !c.done);

  const dirty =
    fullName.trim() !== (user?.fullName || user?.name || "").trim() ||
    address.trim() !== (user?.address || "").trim() ||
    nationality.trim() !== (user?.nationality || "").trim() ||
    tin.trim() !== (user?.tin || "").trim() ||
    gender !== (user?.gender || "");

  async function uploadTravellerPhoto() {
    if (!token) {
      Alert.alert("Profile photo", "Please sign in to update your profile photo.");
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png"],
        multiple: false,
        copyToCacheDirectory: true
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      setUploadingPhoto(true);
      const uploaded = await apiUploadFile<{ secure_url?: string; url?: string }>("/api/uploads/cloudinary/upload", {
        token,
        file: {
          uri: asset.uri,
          name: asset.name || `traveller-${user?.id || "profile"}.jpg`,
          type: asset.mimeType || "image/jpeg",
          file: (asset as any).file || null
        },
        fields: { folder: "avatars" }
      });
      const avatarUrl = uploaded.secure_url || uploaded.url;
      if (!avatarUrl) throw new Error("Upload completed without a photo URL.");
      await updateProfile({ avatarUrl });
    } catch (err) {
      Alert.alert("Profile photo", err instanceof Error ? err.message : "Could not update your profile photo.");
    } finally {
      setUploadingPhoto(false);
    }
  }

  async function submit() {
    setLoading(true);
    setSaveStatus(null);
    try {
      await updateProfile({
        fullName: fullName.trim() || undefined,
        name: fullName.trim() || undefined,
        address: address.trim() || undefined,
        tin: tin.trim() || undefined,
        nationality: nationality.trim() || undefined,
        gender: gender || undefined
      });
      setSaveStatus({ type: "success", message: "Your profile has been updated." });
    } catch (e) {
      setSaveStatus({ type: "error", message: getErrorMessage(e, "Failed to update profile. Please try again.") });
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeScreen contentStyle={styles.screen}>
      <View style={styles.content}>
        <ScreenHeader title="My Profile" onBack={() => navigation.goBack()} />

        <View style={styles.hero}>
          <View style={styles.heroRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Change profile photo" onPress={uploadTravellerPhoto} style={styles.avatarWrap}>
              <View style={styles.avatar}>
                {user?.avatarUrl ? (
                  <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <AppText variant="headline" weight="extraBold" tone="inverse">
                    {initial}
                  </AppText>
                )}
                {uploadingPhoto ? (
                  <View style={styles.avatarOverlay}>
                    <ActivityIndicator color={colors.white} />
                  </View>
                ) : null}
              </View>
              <View style={styles.cameraBadge}>
                <Camera color={colors.primary} size={13} strokeWidth={2.5} />
              </View>
            </Pressable>
            <View style={styles.flex}>
              <AppText variant="title" weight="extraBold" tone="inverse" numberOfLines={2}>
                {displayName}
              </AppText>
              <AppText variant="caption" style={styles.heroMeta} numberOfLines={1}>
                {roleLabel(user?.role)}
                {since ? ` · Member since ${since}` : ""}
              </AppText>
            </View>
          </View>

          <View style={styles.heroMeter}>
            <View style={styles.meterTop}>
              <AppText variant="caption" weight="semiBold" style={styles.heroMeta}>
                {nextStep ? `Profile ${percent}% complete` : "Profile complete"}
              </AppText>
              <AppText variant="caption" weight="extraBold" tone="inverse">
                {done}/{checks.length}
              </AppText>
            </View>
            <View style={styles.meterTrack}>
              <View style={[styles.meterFill, { width: `${percent}%` }]} />
            </View>
            {nextStep ? (
              <AppText variant="caption" style={styles.heroMeta}>
                Next: {nextStep.label}
              </AppText>
            ) : null}
          </View>
        </View>

        <Section title="Contact" hint="Used for bookings, receipts and sign-in codes. Changes are confirmed with a code.">
          <View style={styles.group}>
            <ContactChangeRow
              Icon={Mail}
              field="email"
              label="Email"
              currentValue={user?.email}
              verified={Boolean(user?.emailVerifiedAt)}
              placeholder="name@example.com"
              keyboardType="email-address"
              token={token}
              onChanged={refreshProfile}
            />
            <ContactChangeRow
              Icon={Phone}
              field="phone"
              label="Phone"
              currentValue={user?.phone}
              verified={Boolean(user?.phoneVerifiedAt)}
              placeholder="+255..."
              keyboardType="phone-pad"
              token={token}
              onChanged={refreshProfile}
              divider
            />
          </View>
        </Section>

        <Section title="Personal details" hint="Shown on tour documents and invoices. Only you and NoLSAF see them.">
          <View style={[styles.group, styles.form]}>
            <AppInput label="Full name" value={fullName} onChangeText={setFullName} placeholder="Full name" textContentType="name" />
            <AppInput label="Address" value={address} onChangeText={setAddress} placeholder="City, country or billing address" />
            <AppInput
              label="Nationality"
              value={nationality}
              onChangeText={(text) => setNationality(text.replace(/\d+/g, ""))}
              placeholder="e.g. Tanzanian"
              autoCapitalize="words"
            />
            <View style={styles.fieldBlock}>
              <AppText variant="label" weight="semiBold" tone="muted">
                Gender
              </AppText>
              <View style={styles.segment}>
                {GENDER_OPTIONS.map((option) => {
                  const active = gender === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setGender(active ? "" : option)}
                      style={[styles.segmentItem, active && styles.segmentItemOn]}
                    >
                      <AppText variant="caption" weight={active ? "extraBold" : "semiBold"} tone={active ? "primary" : "soft"}>
                        {option}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <AppInput
              label="TIN / tax ID (optional)"
              value={tin}
              onChangeText={setTin}
              placeholder="Optional tax reference"
              autoCapitalize="characters"
              secureTextEntry={Platform.OS !== "web" && !showTin}
              hint={
                Platform.OS !== "web" ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={showTin ? "Hide tax ID" : "Show tax ID"} onPress={() => setShowTin((current) => !current)} hitSlop={8}>
                    {showTin ? <EyeOff color={colors.softText} size={18} /> : <Eye color={colors.softText} size={18} />}
                  </Pressable>
                ) : undefined
              }
            />
            {saveStatus ? (
              <View style={[styles.saveStatus, saveStatus.type === "success" ? styles.saveStatusSuccess : styles.saveStatusError]}>
                {saveStatus.type === "success" ? <CheckCircle2 color={colors.success} size={17} /> : <AlertTriangle color={colors.danger} size={17} />}
                <AppText variant="caption" weight="bold" tone={saveStatus.type === "success" ? "success" : "danger"} style={styles.flex}>
                  {saveStatus.message}
                </AppText>
              </View>
            ) : null}
            <AppButton title="Save changes" loading={loading} disabled={!dirty} onPress={submit} icon={<Check color={colors.white} size={16} />} />
          </View>
        </Section>

        <Section title="Account record">
          <View style={styles.group}>
            <FactRow Icon={UserRound} label="Account type" value={roleLabel(user?.role)} />
            <FactRow Icon={CalendarDays} label="Member since" value={fmtDate(user?.createdAt)} divider />
            <FactRow Icon={ImageIcon} label="Profile photo" value={user?.avatarUrl ? "Uploaded" : "Not uploaded"} divider />
            <FactRow
              Icon={LockKeyhole}
              label="Two-step verification"
              value={user?.twoFactorEnabled ? "On" : "Off"}
              valueTone={user?.twoFactorEnabled ? "success" : "warning"}
              divider
              onPress={() => navigation.navigate("AccountSecurity", { mode: "2fa" })}
            />
          </View>
        </Section>
      </View>
    </SafeScreen>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <AppText variant="titleSm" weight="extraBold">
          {title}
        </AppText>
        {hint ? (
          <AppText variant="caption" tone="soft">
            {hint}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function FactRow({
  Icon,
  label,
  value,
  valueTone = "default",
  divider,
  onPress
}: {
  Icon: IconType;
  label: string;
  value: string;
  valueTone?: "default" | "success" | "warning";
  divider?: boolean;
  onPress?: () => void;
}) {
  const body = (
    <View style={[styles.row, divider && styles.rowDivider]}>
      <View style={styles.rowIcon}>
        <Icon color={colors.primary} size={16} />
      </View>
      <AppText variant="bodySmall" weight="semiBold" style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="caption" weight="bold" tone={valueTone === "default" ? "soft" : valueTone}>
        {value}
      </AppText>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [pressed && styles.rowPressed]}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

function ContactChangeRow({
  Icon,
  field,
  label,
  currentValue,
  verified,
  placeholder,
  keyboardType,
  token,
  onChanged,
  divider
}: {
  Icon: IconType;
  field: ContactField;
  label: string;
  currentValue?: string | null;
  verified: boolean;
  placeholder: string;
  keyboardType: "email-address" | "phone-pad";
  token: string | null;
  onChanged: () => Promise<void>;
  divider?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [step, setStep] = useState<"value" | "otp">("value");
  const [value, setValue] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_PHONE_COUNTRY_CODE);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setEditing(true);
    setStep("value");
    setValue("");
    setOtp("");
    setError(null);
  }

  function cancelEdit() {
    setEditing(false);
    setStep("value");
    setValue("");
    setOtp("");
    setError(null);
  }

  async function sendCode() {
    if (!token) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setError(`Please enter your new ${label.toLowerCase()}.`);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await requestContactChange(token, field, field === "phone" ? `${countryCode}${trimmed}` : trimmed);
      setStep("otp");
    } catch (e) {
      setError(getErrorMessage(e, `Could not send a verification code to your new ${label.toLowerCase()}.`));
    } finally {
      setLoading(false);
    }
  }

  async function startVerify() {
    if (!token || !currentValue) return;
    setEditing(true);
    setStep("otp");
    setValue(currentValue);
    setOtp("");
    setError(null);
    setLoading(true);
    try {
      await requestContactChange(token, field, currentValue);
    } catch (e) {
      setError(getErrorMessage(e, `Could not send a verification code to your ${label.toLowerCase()}.`));
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode() {
    if (!token) return;
    if (!otp.trim()) {
      setError("Please enter the verification code.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await confirmContactChange(token, field, otp.trim());
      await onChanged();
      cancelEdit();
      Alert.alert(`${label} updated`, `Your ${label.toLowerCase()} has been changed and verified.`);
    } catch (e) {
      setError(getErrorMessage(e, "Invalid or expired code. Please try again."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={divider && styles.rowDivider}>
      <View style={styles.row}>
        <View style={styles.rowIcon}>
          <Icon color={colors.primary} size={16} />
        </View>
        <View style={styles.flex}>
          <AppText variant="caption" tone="soft">
            {label}
          </AppText>
          <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
            {currentValue || "Not added"}
          </AppText>
          {currentValue ? (
            <View style={styles.statusLine}>
              {verified ? <CheckCircle2 color={colors.success} size={12} /> : <AlertTriangle color={colors.warning} size={12} />}
              <AppText variant="caption" weight="bold" tone={verified ? "success" : "warning"}>
                {verified ? "Verified" : "Not verified"}
              </AppText>
            </View>
          ) : null}
        </View>
        {!editing ? (
          <View style={styles.rowActions}>
            {currentValue && !verified ? (
              <Pressable accessibilityRole="button" onPress={startVerify} style={[styles.smallBtn, styles.smallBtnPrimary]} hitSlop={4}>
                <AppText variant="caption" weight="extraBold" tone="inverse">
                  Verify
                </AppText>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={startEdit} style={styles.smallBtn} hitSlop={4}>
              <AppText variant="caption" weight="extraBold" tone="primary">
                {currentValue ? "Change" : "Add"}
              </AppText>
            </Pressable>
          </View>
        ) : null}
      </View>

      {editing ? (
        <AppStack gap={2} style={styles.contactEdit}>
          {step === "value" ? (
            <>
              {field === "phone" ? (
                <PhoneNumberField
                  label={`New ${label.toLowerCase()}`}
                  countryCode={countryCode}
                  onCountryCodeChange={setCountryCode}
                  value={value}
                  onChangeText={setValue}
                />
              ) : (
                <AppInput
                  label={`New ${label.toLowerCase()}`}
                  value={value}
                  onChangeText={setValue}
                  placeholder={placeholder}
                  keyboardType={keyboardType}
                  autoCapitalize="none"
                  textContentType="emailAddress"
                />
              )}
              {error ? (
                <AppText variant="caption" tone="danger">
                  {error}
                </AppText>
              ) : null}
              <View style={styles.contactActions}>
                <AppButton title="Cancel" variant="ghost" onPress={cancelEdit} style={styles.flex} />
                <AppButton title="Send code" loading={loading} onPress={sendCode} style={styles.flex} />
              </View>
            </>
          ) : (
            <>
              <AppText variant="caption" tone="muted">
                Enter the code we sent to {value.trim()}.
              </AppText>
              <AppInput label="Verification code" value={otp} onChangeText={setOtp} placeholder="6-digit code" keyboardType="number-pad" />
              {error ? (
                <AppText variant="caption" tone="danger">
                  {error}
                </AppText>
              ) : null}
              <View style={styles.contactActions}>
                <AppButton title="Cancel" variant="ghost" onPress={cancelEdit} style={styles.flex} />
                <AppButton title="Confirm" loading={loading} onPress={confirmCode} style={styles.flex} />
              </View>
            </>
          )}
        </AppStack>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingBottom: spacing[10]
  },
  content: {
    gap: spacing[6]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  hero: {
    gap: spacing[4],
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    padding: spacing[5]
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4]
  },
  avatarWrap: {
    position: "relative"
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.18)"
  },
  avatarImage: {
    width: "100%",
    height: "100%"
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,6,23,0.42)"
  },
  cameraBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.primaryDeep
  },
  heroMeta: {
    color: colors.brand[200],
    marginTop: 2
  },
  heroMeter: {
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.07)",
    padding: spacing[3]
  },
  meterTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  meterTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden"
  },
  meterFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.brand[200]
  },
  section: {
    gap: spacing[3]
  },
  sectionHeader: {
    gap: 2,
    paddingHorizontal: 2
  },
  group: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: "hidden",
    ...shadows.card
  },
  form: {
    gap: spacing[4],
    padding: spacing[4]
  },
  row: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3]
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  rowPressed: {
    backgroundColor: colors.surface
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  statusLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2
  },
  rowActions: {
    flexDirection: "row",
    gap: spacing[2]
  },
  smallBtn: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: 6
  },
  smallBtnPrimary: {
    borderColor: colors.primary,
    backgroundColor: colors.primary
  },
  contactEdit: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[4],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[3]
  },
  contactActions: {
    flexDirection: "row",
    gap: spacing[2]
  },
  fieldBlock: {
    gap: spacing[2]
  },
  segment: {
    flexDirection: "row",
    gap: 4,
    borderRadius: radius.lg,
    backgroundColor: colors.brand[50],
    padding: 4
  },
  segmentItem: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    borderRadius: radius.md
  },
  segmentItemOn: {
    backgroundColor: colors.white,
    ...shadows.card
  },
  saveStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing[3]
  },
  saveStatusSuccess: {
    borderColor: "#bbf0d9",
    backgroundColor: "#e9f7ef"
  },
  saveStatusError: {
    borderColor: "#fad2cf",
    backgroundColor: "#fdecea"
  }
});

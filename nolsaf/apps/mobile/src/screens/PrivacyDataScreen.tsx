import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import {
  AlertTriangle,
  BedDouble,
  CarFront,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  LockKeyhole,
  Mail,
  MessageSquare,
  SlidersHorizontal,
  TicketsPlane,
  Trash2,
  UserRound,
  UsersRound,
  X
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { ActivityIndicator, Linking, Modal, Pressable, Share, StyleSheet, Switch, TextInput, View } from "react-native";

import { useAuth } from "../auth";
import { AppButton, AppText, OptionPickerSheet, SafeScreen, ScreenHeader, StateView } from "../components";
import { KARIBU_DIETARY, KARIBU_DRINKS, setKaribuSharing } from "../karibu";
import { ApiError, getErrorMessage } from "../lib/apiClient";
import { webOrigin } from "../lib/webOrigin";
import { RootStackParamList } from "../navigation/types";
import {
  DATA_EXPORT_COUNTRIES,
  DATA_EXPORT_REASONS,
  DataExportReason,
  DataSummary,
  downloadDataExport,
  fetchDataSummary,
  requestDataExport,
  verifyDataExport
} from "../privacy";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "PrivacyData">;
type IconType = typeof UserRound;

const EAT = "Africa/Dar_es_Salaam";
const DRINK = Object.fromEntries(KARIBU_DRINKS) as Record<string, string>;
const DIET = Object.fromEntries(KARIBU_DIETARY) as Record<string, string>;

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: EAT })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: EAT })} EAT`;
};

/** Who can see each kind of data; same rows as the web privacy page and the policy. */
const ACCESS: { what: string; property: string }[] = [
  { what: "Name and phone", property: "Your stay" },
  { what: "Stays and rides", property: "Their own" },
  { what: "Welcome preferences", property: "If shared" }
];

const isLocked = (err: unknown) => {
  const e = err as ApiError;
  const payload = e?.payload as { code?: string; details?: { code?: string } } | undefined;
  return e?.status === 423 || payload?.code === "DATA_EXPORT_LOCKED" || payload?.details?.code === "DATA_EXPORT_LOCKED";
};

/** Guest privacy: what the account holds, who sees it, a copy on demand, and the way out. */
export function PrivacyDataScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [summary, setSummary] = useState<DataSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setSummary(await fetchDataSummary(token));
      setLoadError(null);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Your privacy settings could not be loaded."));
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function setShare(on: boolean) {
    if (!token || !summary) return;
    const previous = summary;
    setSummary({ ...summary, welcomePreferences: { ...summary.welcomePreferences, shareWithProperty: on } });
    setSharing(true);
    setStatus(null);
    try {
      await setKaribuSharing(token, on);
      setStatus({ ok: true, text: on ? "Sharing turned on" : "Sharing turned off" });
    } catch {
      setSummary(previous);
      setStatus({ ok: false, text: "That change was not saved. Try again." });
    } finally {
      setSharing(false);
    }
  }

  if (!summary) {
    return (
      <SafeScreen contentStyle={styles.screen}>
        <ScreenHeader title="Privacy and your data" onBack={() => navigation.goBack()} />
        {loadError ? (
          <StateView title="Could not load your data" message={loadError} actionLabel="Try again" onAction={load} />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="bodySmall" tone="muted">Loading your data</AppText>
          </View>
        )}
      </SafeScreen>
    );
  }

  const { counts, profile, welcomePreferences: wp } = summary;
  const profileMissing = [!profile.hasName && "name", !profile.hasEmail && "email", !profile.hasPhone && "phone"].filter(Boolean) as string[];
  const sharedItems = [...wp.drinkLikes.map((d) => DRINK[d] ?? d), ...wp.dietaryTags.map((t) => DIET[t] ?? t)];
  const memberSince = new Date(summary.memberSince).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: EAT });

  const holdings: { Icon: IconType; label: string; value: string; hint: string; warn?: boolean; onPress: () => void }[] = [
    { Icon: UserRound, label: "Profile", value: profileMissing.length ? "Incomplete" : "Complete", hint: profileMissing.length ? `Add your ${profileMissing.join(" and ")}` : "Name, email and phone", warn: profileMissing.length > 0, onPress: () => navigation.navigate("ProfileCompletion") },
    { Icon: BedDouble, label: "Stays", value: String(counts.stays), hint: counts.upcomingStays ? `${counts.upcomingStays} upcoming` : `${counts.completedStays} completed`, onPress: () => navigation.navigate("MyBookings") },
    { Icon: TicketsPlane, label: "Tours", value: String(counts.tours ?? 0), hint: (counts.tours ?? 0) === 1 ? "Tour package" : "Tour packages", onPress: () => navigation.navigate("MyTours") },
    { Icon: UsersRound, label: "Group stays", value: String(counts.groupStays ?? 0), hint: "Requested for a group", onPress: () => navigation.navigate("MyGroupStays") },
    { Icon: CarFront, label: "Rides", value: String(counts.rides), hint: counts.rides === 1 ? "Ride booked" : "Rides booked", onPress: () => navigation.navigate("MyRides") },
    { Icon: SlidersHorizontal, label: "Welcome preferences", value: wp.saved ? "Set" : "Not set", hint: wp.saved ? (wp.shareWithProperty ? "Shared with your stay" : "Private to you") : "Optional", onPress: () => navigation.navigate("KaribuStory", { focus: "preferences" }) }
  ];

  return (
    <SafeScreen contentStyle={styles.screen}>
      <View style={styles.content}>
        <ScreenHeader title="Privacy and your data" subtitle={`With NoLSAF since ${memberSince}`} onBack={() => navigation.goBack()} />

        <View style={styles.section}>
          <AppText variant="titleSm" weight="extraBold" style={styles.sectionTitle}>What your account holds</AppText>
          <View style={styles.grid}>
            {holdings.map(({ Icon, label, value, hint, warn, onPress }) => (
              <Pressable key={label} accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.holding, pressed && styles.pressed]}>
                <View style={styles.holdingTop}>
                  <View style={styles.darkTile}><Icon color={colors.brand[200]} size={15} /></View>
                  <ChevronRight color={colors.softText} size={15} />
                </View>
                <AppText variant="caption" tone="soft">{label}</AppText>
                <AppText variant="titleSm" weight="extraBold">{value}</AppText>
                <AppText variant="caption" weight={warn ? "bold" : "regular"} tone={warn ? "warning" : "soft"} numberOfLines={1}>{hint}</AppText>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.titleRow}>
            <AppText variant="titleSm" weight="extraBold" style={styles.sectionTitle}>Your choices</AppText>
            {status ? <AppText variant="caption" weight="bold" tone={status.ok ? "success" : "danger"}>{status.text}</AppText> : null}
          </View>
          <View style={styles.card}>
            <View style={styles.choice}>
              <View style={styles.choiceTop}>
                <View style={styles.darkTile}><SlidersHorizontal color={colors.brand[200]} size={15} /></View>
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="extraBold">Share welcome preferences with the property</AppText>
                  <AppText variant="caption" tone="soft">Staff at the place you are staying see them during your stay only. Off means they see nothing.</AppText>
                </View>
                <Switch value={wp.shareWithProperty} disabled={sharing} onValueChange={(v) => void setShare(v)} trackColor={{ true: colors.primary, false: colors.border }} />
              </View>
              {wp.saved && sharedItems.length > 0 ? (
                <View style={styles.sharedRow}>
                  <AppText variant="caption" weight="bold" tone="soft">{wp.shareWithProperty ? "They see:" : "Would share:"}</AppText>
                  {sharedItems.map((item) => (
                    <View key={item} style={styles.pill}><AppText variant="caption" weight="semiBold">{item}</AppText></View>
                  ))}
                  <Pressable accessibilityRole="button" onPress={() => navigation.navigate("KaribuStory", { focus: "preferences" })} hitSlop={6}>
                    <AppText variant="caption" weight="extraBold" tone="primary">Edit</AppText>
                  </Pressable>
                </View>
              ) : (
                <Pressable accessibilityRole="button" onPress={() => navigation.navigate("KaribuStory", { focus: "preferences" })} style={styles.sharedRow} hitSlop={6}>
                  <AppText variant="caption" tone="soft">Nothing to share yet.</AppText>
                  <AppText variant="caption" weight="extraBold" tone="primary">Add your preferences</AppText>
                </Pressable>
              )}
            </View>

            <View style={[styles.choice, styles.divider]}>
              <View style={styles.choiceTop}>
                <View style={styles.darkTile}><Download color={colors.brand[200]} size={15} /></View>
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="extraBold">Download a copy of your data</AppText>
                  <AppText variant="caption" tone="soft">
                    Your profile and up to 1,000 recent records in each category: stays, tours, group stays, rides, cancellations, reviews, saved stays,
                    trip estimates, notification choices, and Karibu preferences and welcomes.
                  </AppText>
                </View>
              </View>
              {summary.exportLocked ? (
                <View style={styles.lockedBox}>
                  <AlertTriangle color={colors.danger} size={15} />
                  <AppText variant="caption" weight="semiBold" style={styles.lockedText}>
                    Data downloads are locked on your account after too many wrong codes. Contact support@nolsaf.com and we will unlock them once we confirm it is you.
                  </AppText>
                </View>
              ) : null}
              <AppText variant="caption" tone="soft">
                {summary.lastExportAt ? `Last downloaded ${when(summary.lastExportAt)}` : "Never downloaded"}
              </AppText>
              <AppButton
                title="Request my data"
                variant="secondary"
                disabled={Boolean(summary.exportLocked)}
                onPress={() => setRequesting(true)}
                icon={<LockKeyhole color={colors.primary} size={16} />}
              />
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`${webOrigin()}/account/security/privacy`).catch(() => undefined)} style={styles.webLink} hitSlop={6}>
                <FileText color={colors.primary} size={13} />
                <AppText variant="caption" weight="extraBold" tone="primary">Need a readable PDF? Get it on nolsaf.com</AppText>
                <ExternalLink color={colors.primary} size={12} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <AppText variant="titleSm" weight="extraBold" style={styles.sectionTitle}>Who sees what</AppText>
          <View style={styles.card}>
            <View style={[styles.tableRow, styles.tableHead]}>
              <AppText variant="caption" weight="bold" tone="soft" style={styles.tableWhat}> </AppText>
              {["You", "NoLSAF", "Property", "Ads"].map((h) => (
                <AppText key={h} variant="caption" weight="bold" tone="soft" style={styles.tableCell}>{h}</AppText>
              ))}
            </View>
            {ACCESS.map((row) => (
              <View key={row.what} style={[styles.tableRow, styles.divider]}>
                <AppText variant="caption" weight="semiBold" style={styles.tableWhat}>{row.what}</AppText>
                <View style={styles.tableCell}><Check color={colors.success} size={15} strokeWidth={3} /></View>
                <View style={styles.tableCell}><Check color={colors.success} size={15} strokeWidth={3} /></View>
                <AppText variant="caption" weight="bold" tone="warning" style={styles.tableCell}>{row.property}</AppText>
                <View style={styles.tableCell}><X color={colors.danger} size={15} strokeWidth={3} /></View>
              </View>
            ))}
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate("AccountResources", { mode: "policies" })} style={[styles.policyLink, styles.divider]}>
              <FileText color={colors.primary} size={14} />
              <AppText variant="caption" weight="extraBold" tone="primary">Read the privacy policy</AppText>
              <AppText variant="caption" tone="soft" style={styles.flex}> · Your data is never sold.</AppText>
            </Pressable>
          </View>
        </View>

        <View style={[styles.card, styles.dangerCard]}>
          <View style={styles.choiceTop}>
            <View style={styles.dangerTile}><Trash2 color={colors.danger} size={15} /></View>
            <View style={styles.flex}>
              <AppText variant="bodySmall" weight="extraBold">Delete your account</AppText>
              <AppText variant="caption" tone="soft">Closes your account and removes your personal data. Receipts and records we must keep by law are retained as the policy explains.</AppText>
            </View>
          </View>
          {counts.upcomingStays > 0 ? (
            <View style={styles.warnBox}>
              <AlertTriangle color={colors.warning} size={14} />
              <AppText variant="caption" weight="semiBold" tone="warning" style={styles.flex}>
                You have {counts.upcomingStays} upcoming {counts.upcomingStays === 1 ? "stay" : "stays"}. Finish or cancel {counts.upcomingStays === 1 ? "it" : "them"} first.
              </AppText>
            </View>
          ) : null}
          <AppButton title="See how" variant="ghost" onPress={() => navigation.navigate("AccountPreferences")} />
        </View>
      </View>

      {requesting && token ? (
        <DataRequestSheet
          token={token}
          onClose={() => {
            setRequesting(false);
            void load();
          }}
          onDownloaded={() => setStatus({ ok: true, text: "Your copy is ready to save" })}
        />
      ) : null}
    </SafeScreen>
  );
}

/**
 * Before a copy is released: where the person lives, why (optional), then a code
 * sent to a contact already verified on the account. The app receives the
 * machine-readable copy and hands it to the phone's share sheet to save or send.
 */
function DataRequestSheet({ token, onClose, onDownloaded }: { token: string; onClose: () => void; onDownloaded: () => void }) {
  const [step, setStep] = useState<"questions" | "code">("questions");
  const [country, setCountry] = useState("Tanzania");
  const [reason, setReason] = useState<DataExportReason | null>(null);
  const [otherReason, setOtherReason] = useState("");
  const [picker, setPicker] = useState<"country" | "reason" | null>(null);
  const [sentTo, setSentTo] = useState<{ via: "email" | "phone"; to: string; minutes: number } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Three wrong codes lock downloads until support unlocks them.
  const [locked, setLocked] = useState(false);

  async function sendCode() {
    if (reason === "OTHER" && otherReason.trim().length < 3) {
      setError("Tell us briefly why, or choose another reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await requestDataExport(token, {
        country,
        reason,
        otherReason: reason === "OTHER" ? otherReason.trim() : null,
        format: "json"
      });
      setSentTo({ via: res.sentVia, to: res.sentTo, minutes: res.expiresInMinutes ?? 10 });
      setCode("");
      setStep("code");
    } catch (err) {
      if (isLocked(err)) setLocked(true);
      setError(getErrorMessage(err, "We could not send your code. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(entered: string) {
    if (busy || entered.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      const { grant } = await verifyDataExport(token, entered);
      const data = await downloadDataExport(token, grant);
      const date = new Date().toISOString().slice(0, 10);
      await Share.share({ title: `nolsaf-my-data-${date}.json`, message: JSON.stringify(data, null, 2) });
      onDownloaded();
      onClose();
    } catch (err) {
      if (isLocked(err)) setLocked(true);
      setError(getErrorMessage(err, "That code could not be checked. Try again."));
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  const reasonLabel = DATA_EXPORT_REASONS.find(([value]) => value === reason)?.[1];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => { if (!busy) onClose(); }}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <View style={styles.darkTile}><LockKeyhole color={colors.brand[200]} size={16} /></View>
            <View style={styles.flex}>
              <AppText variant="titleSm" weight="extraBold">Request your personal data</AppText>
              <AppText variant="caption" tone="soft">{step === "questions" ? "A few questions first. This keeps your data safe." : "Confirm it is you."}</AppText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} disabled={busy} style={styles.closeBtn}>
              <X color={colors.softText} size={18} />
            </Pressable>
          </View>

          {locked ? (
            <View style={styles.lockedBox}>
              <LockKeyhole color={colors.danger} size={15} />
              <AppText variant="caption" weight="semiBold" style={styles.lockedText}>
                Too many wrong codes were entered, so we locked data downloads on your account to keep your data safe. Contact support@nolsaf.com. Once we confirm it is you, we unlock it and you can try again.
              </AppText>
            </View>
          ) : error ? (
            <AppText variant="caption" weight="bold" tone="danger">{error}</AppText>
          ) : null}

          {locked ? (
            <AppButton title="Close" variant="secondary" onPress={onClose} />
          ) : step === "questions" ? (
            <View style={styles.sheetBody}>
              <FieldButton label="Where do you live?" value={country} onPress={() => setPicker("country")} />
              <FieldButton label="Why do you need it? (optional)" value={reasonLabel || "Choose a reason"} placeholder={!reasonLabel} onPress={() => setPicker("reason")} />
              {reason === "OTHER" ? (
                <TextInput
                  value={otherReason}
                  onChangeText={setOtherReason}
                  maxLength={200}
                  placeholder="Tell us briefly why"
                  placeholderTextColor={colors.softText}
                  style={styles.input}
                />
              ) : null}
              <AppText variant="caption" tone="muted" style={styles.noteBox}>
                We send a code to the email or phone already verified on your account. Your data is released only after you enter it. You get a machine-readable copy (JSON) to save to your files or send. We record the request and download, and alert your verified email or phone.
              </AppText>
              <AppButton title="Send code" loading={busy} onPress={sendCode} />
            </View>
          ) : (
            <View style={styles.sheetBody}>
              <View style={styles.sentBox}>
                {sentTo?.via === "phone" ? <MessageSquare color={colors.primary} size={15} /> : <Mail color={colors.primary} size={15} />}
                <AppText variant="caption" weight="semiBold" tone="primary" style={styles.flex}>
                  We sent a 6-digit code to {sentTo?.to}. It expires in {sentTo?.minutes ?? 10} minutes.
                </AppText>
              </View>
              <TextInput
                value={code}
                onChangeText={(text) => {
                  const digits = text.replace(/\D/g, "").slice(0, 6);
                  setCode(digits);
                  setError(null);
                  if (digits.length === 6) void confirm(digits);
                }}
                editable={!busy}
                autoFocus
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={colors.border}
                style={styles.codeInput}
              />
              <AppText variant="caption" tone={busy ? "primary" : "soft"} style={styles.centerText}>
                {busy ? "Checking your code and preparing your data" : "It confirms on its own once all six digits are in."}
              </AppText>
              <Pressable accessibilityRole="button" onPress={() => { setStep("questions"); setError(null); }} disabled={busy} style={styles.webLink} hitSlop={6}>
                <AppText variant="caption" weight="extraBold" tone="primary">Did not get it? Send a new code</AppText>
              </Pressable>
            </View>
          )}
        </View>
      </View>

      <OptionPickerSheet
        visible={picker === "country"}
        title="Where do you live?"
        options={DATA_EXPORT_COUNTRIES.map((c) => ({ value: c, label: c }))}
        value={country}
        onSelect={(value) => { setCountry(value); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionPickerSheet
        visible={picker === "reason"}
        title="Why do you need it?"
        subtitle="Optional"
        options={DATA_EXPORT_REASONS.map(([value, label]) => ({ value, label }))}
        value={reason ?? undefined}
        onSelect={(value) => { setReason(value as DataExportReason); setError(null); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
    </Modal>
  );
}

function FieldButton({ label, value, placeholder, onPress }: { label: string; value: string; placeholder?: boolean; onPress: () => void }) {
  return (
    <View style={styles.field}>
      <AppText variant="caption" weight="bold">{label}</AppText>
      <Pressable accessibilityRole="button" onPress={onPress} style={styles.input}>
        <AppText variant="bodySmall" weight="semiBold" tone={placeholder ? "soft" : "default"} numberOfLines={1} style={styles.flex}>{value}</AppText>
        <ChevronDown color={colors.softText} size={16} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: spacing[10] },
  content: { gap: spacing[6] },
  loading: { alignItems: "center", gap: spacing[3], padding: spacing[8] },
  flex: { flex: 1, minWidth: 0 },
  centerText: { textAlign: "center" },
  pressed: { opacity: 0.85 },
  section: { gap: spacing[3] },
  sectionTitle: { paddingHorizontal: 2 },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  holding: { flexGrow: 1, flexBasis: "46%", minWidth: 140, gap: 2, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, padding: spacing[3], ...shadows.card },
  holdingTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing[2] },
  darkTile: { width: 34, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryDeep },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: "hidden", ...shadows.card },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  choice: { gap: spacing[3], padding: spacing[4] },
  choiceTop: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  sharedRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing[2], paddingLeft: 46 },
  pill: { borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing[2], paddingVertical: 2 },
  lockedBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], borderRadius: radius.md, borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2", padding: spacing[3] },
  lockedText: { flex: 1, color: "#991b1b" },
  webLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, alignSelf: "center" },
  tableRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
  tableHead: { paddingVertical: spacing[2] },
  tableWhat: { flex: 1.6, minWidth: 0 },
  tableCell: { flex: 1, alignItems: "center", textAlign: "center" },
  policyLink: { flexDirection: "row", alignItems: "center", gap: 6, padding: spacing[3] },
  dangerCard: { gap: spacing[3], padding: spacing[4], borderColor: "#fecaca" },
  dangerTile: { width: 34, height: 34, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: "#fef2f2" },
  warnBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], borderRadius: radius.md, backgroundColor: "#fffbeb", padding: spacing[3] },
  overlay: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(2,12,10,0.58)" },
  sheet: { gap: spacing[4], borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: colors.white, padding: spacing[5], paddingBottom: spacing[8], ...shadows.sheet },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  closeBtn: { width: 36, height: 36, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  sheetBody: { gap: spacing[3] },
  field: { gap: spacing[1] },
  input: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: spacing[2], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing[3], color: colors.ink, fontSize: 14 },
  noteBox: { borderRadius: radius.md, backgroundColor: colors.surface, padding: spacing[3] },
  sentBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], borderRadius: radius.md, backgroundColor: colors.brand[50], padding: spacing[3] },
  codeInput: { height: 60, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.primary, textAlign: "center", fontSize: 28, letterSpacing: 12, fontWeight: "700", color: colors.ink }
});

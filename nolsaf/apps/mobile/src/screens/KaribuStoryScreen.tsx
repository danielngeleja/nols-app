import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import {
  Award,
  BedDouble,
  CalendarHeart,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Coffee,
  Gift,
  MapPin,
  Moon,
  Search,
  SlidersHorizontal,
  Star
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from "react-native";

import { useAuth } from "../auth";
import { AppButton, AppText, OptionPickerSheet, SafeScreen, ScreenHeader, StateView } from "../components";
import {
  KARIBU_DIETARY,
  KARIBU_DRINKS,
  KaribuJourney,
  KaribuMoment,
  KaribuPreferences,
  clearKaribuPreferences,
  fetchKaribuJourney,
  fetchKaribuPreferences,
  saveKaribuPreferences,
  sendKaribuFeedback
} from "../karibu";
import { getErrorMessage } from "../lib/apiClient";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "KaribuStory">;

const EAT = "Africa/Dar_es_Salaam";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
// 29 February is a valid birthday, matching the API's leap-year check.
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const shortDate = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: EAT });
const dayMonth = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: EAT });
const monthYear = (value: string) => new Date(value).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: EAT });
const monthShort = (value: string) => new Date(value).toLocaleDateString("en-GB", { month: "short", timeZone: EAT });
const dayNum = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", timeZone: EAT });

/** "SHERATON HOTEL" reads as "Sheraton Hotel"; mixed-case names stay as written. */
function tidy(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

export function KaribuStoryScreen({ navigation, route }: Props) {
  const { token } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [journey, setJourney] = useState<KaribuJourney | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // null until loaded, or while the preference table is not migrated (card hidden, like web).
  const [preferences, setPreferences] = useState<KaribuPreferences | null>(null);
  const [preferencesY, setPreferencesY] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setError(null);
    try {
      setJourney(await fetchKaribuJourney(token));
    } catch (err) {
      setError(getErrorMessage(err, "Your journey could not be loaded. Try again."));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
      if (token) {
        fetchKaribuPreferences(token)
          .then((res) => setPreferences(res.available ? res.preferences : null))
          .catch(() => undefined);
      }
    }, [load, token])
  );

  // Opened from Privacy or the Account page to edit preferences: scroll straight to the card.
  useEffect(() => {
    if (route.params?.focus === "preferences" && preferencesY != null) {
      scrollRef.current?.scrollTo({ y: Math.max(0, preferencesY - spacing[4]), animated: true });
    }
  }, [route.params?.focus, preferencesY]);

  const stays = journey?.completedStayCount ?? 0;
  const recent = journey?.recentStays ?? [];
  const shownStays = recent.slice(0, 2);
  const upcoming = journey?.upcoming ?? null;

  // A record of what happened, never a countdown: a target would read as a promised reward (doc section 14.1).
  const milestones = useMemo(() => {
    if (!journey) return [];
    const first = journey.firstStay;
    const anniversary = first ? new Date(first.completedAt) : null;
    anniversary?.setUTCFullYear(anniversary.getUTCFullYear() + 1);
    return [
      { title: "First stay", done: stays >= 1, detail: first ? `${tidy(first.property)} · ${shortDate(first.completedAt)}` : "", year: false },
      { title: "Third stay", done: stays >= 3, detail: "Three stays with NoLSAF", year: false },
      { title: "One year with NoLSAF", done: Boolean(anniversary && anniversary.getTime() <= Date.now()), detail: first ? `Since ${shortDate(first.completedAt)}` : "", year: true }
    ].filter((m) => m.done);
  }, [journey, stays]);

  if (loading) {
    return (
      <SafeScreen contentStyle={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <AppText variant="bodySmall" tone="muted">Loading your journey</AppText>
      </SafeScreen>
    );
  }

  if (!journey) {
    return (
      <SafeScreen contentStyle={styles.screen}>
        <ScreenHeader title="My story" onBack={() => navigation.goBack()} />
        <StateView title="Your journey is unavailable" message={error || "Try again in a moment."} actionLabel="Try again" onAction={() => { setLoading(true); void load(); }} />
      </SafeScreen>
    );
  }

  return (
    <SafeScreen contentStyle={styles.screen} scrollRef={scrollRef}>
      <View style={styles.content}>
        <ScreenHeader title="My story" onBack={() => navigation.goBack()} />

        <View style={styles.band}>
          <View>
            <AppText variant="caption" weight="bold" style={styles.bandEyebrow}>Karibu by NoLSAF</AppText>
            <AppText variant="title" weight="extraBold" tone="inverse">Your travel story</AppText>
            <AppText variant="caption" style={styles.bandSub}>Every stay you complete with NoLSAF, in one place.</AppText>
          </View>
          <View style={styles.bandStats}>
            <BandStat Icon={BedDouble} label={stays === 1 ? "Stay" : "Stays"} value={stays} />
            <BandStat Icon={Moon} label={(journey.totals?.nights ?? 0) === 1 ? "Night" : "Nights"} value={journey.totals?.nights ?? 0} />
            <BandStat Icon={MapPin} label={(journey.totals?.places ?? 0) === 1 ? "Place" : "Places"} value={journey.totals?.places ?? 0} />
          </View>
          {journey.firstStay ? (
            <AppText variant="caption" style={styles.bandSub}>
              Travelling with NoLSAF since <AppText variant="caption" weight="bold" tone="inverse">{monthYear(journey.firstStay.completedAt)}</AppText>
            </AppText>
          ) : null}
        </View>

        {error ? <AppText variant="bodySmall" tone="danger">{error}</AppText> : null}

        {upcoming ? (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate("MyBookings")} style={({ pressed }) => [styles.card, styles.nextStay, pressed && styles.pressed]}>
            <View style={styles.iconTile}><BedDouble color={colors.primary} size={20} /></View>
            <View style={styles.flex}>
              <AppText variant="caption" weight="bold" tone="primary">{upcoming.inHouse ? "Staying now" : "Your next stay"}</AppText>
              <AppText variant="body" weight="extraBold" numberOfLines={1}>{tidy(upcoming.property)}</AppText>
              <AppText variant="caption" tone="soft" numberOfLines={1}>
                {upcoming.city ? `${tidy(upcoming.city)} · ` : ""}{dayMonth(upcoming.checkIn)} to {shortDate(upcoming.checkOut)}
              </AppText>
            </View>
            <ChevronRight color={colors.softText} size={18} />
          </Pressable>
        ) : null}

        {journey.moments.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <AppText variant="titleSm" weight="extraBold">Welcomes prepared for you</AppText>
              <AppText variant="caption" tone="soft">A small thank you from NoLSAF, served by the property. You are never charged for it.</AppText>
            </View>
            {journey.moments.map((moment, index) => (
              <MomentRow key={moment.id} moment={moment} first={index === 0} token={token} onSent={load} />
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          <View style={[styles.cardHead, styles.cardHeadRow]}>
            <View style={styles.flex}>
              <AppText variant="titleSm" weight="extraBold">Where you have stayed</AppText>
              <AppText variant="caption" tone="soft">
                {stays > shownStays.length ? `Your latest ${shownStays.length} of ${stays} stays` : "Your completed stays"}
              </AppText>
            </View>
            {stays > 0 ? (
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate("MyBookings")} hitSlop={8}>
                <AppText variant="caption" weight="extraBold" tone="primary">{stays > shownStays.length ? `All ${stays}` : "All stays"}</AppText>
              </Pressable>
            ) : null}
          </View>
          {recent.length === 0 ? (
            <View style={styles.emptyStory}>
              <View style={styles.darkTile}><MapPin color={colors.brand[200]} size={20} /></View>
              <AppText variant="bodySmall" weight="extraBold">Your story starts with your first stay</AppText>
              <AppText variant="caption" tone="soft" style={styles.centerText}>Each stay you complete with NoLSAF is added here.</AppText>
              <AppButton title="Find a stay" onPress={() => navigation.navigate("VerifiedStays")} icon={<Search color={colors.white} size={16} />} />
            </View>
          ) : (
            shownStays.map((stay, index) => {
              const moment = journey.moments.find((m) => m.bookingReference === stay.bookingReference);
              return (
                <Pressable
                  key={stay.bookingReference}
                  accessibilityRole="button"
                  onPress={() => navigation.navigate("MyBookings")}
                  style={({ pressed }) => [styles.stayRow, pressed && styles.rowPressed]}
                >
                  <View style={[styles.dateTile, index === 0 && styles.dateTileLatest]}>
                    <AppText variant="caption" weight="bold" tone={index === 0 ? "primary" : "soft"}>{monthShort(stay.checkIn)}</AppText>
                    <AppText variant="titleSm" weight="extraBold" tone={index === 0 ? "primary" : "default"}>{dayNum(stay.checkIn)}</AppText>
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>{tidy(stay.property)}</AppText>
                    <AppText variant="caption" tone="soft" numberOfLines={1}>
                      {stay.city ? `${tidy(stay.city)} · ` : ""}{stay.nights} {stay.nights === 1 ? "night" : "nights"}
                    </AppText>
                    {stay.welcomed || moment ? (
                      <View style={styles.welcomeTag}>
                        <Gift color={colors.primary} size={11} />
                        <AppText variant="caption" weight="bold" tone="primary">Welcome{moment ? `: ${moment.drink}` : ""}</AppText>
                      </View>
                    ) : null}
                  </View>
                  <ChevronRight color={colors.softText} size={17} />
                </Pressable>
              );
            })
          )}
        </View>

        {milestones.length > 0 ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <AppText variant="titleSm" weight="extraBold">Milestones</AppText>
              <AppText variant="caption" tone="soft">{milestones.length} reached</AppText>
            </View>
            {milestones.map((m) => (
              <View key={m.title} style={styles.milestoneRow}>
                <View style={styles.milestoneIcon}>
                  {m.year ? <CalendarHeart color={colors.primary} size={18} /> : <Award color={colors.primary} size={18} />}
                </View>
                <View style={styles.flex}>
                  <View style={styles.inline}>
                    <AppText variant="bodySmall" weight="extraBold">{m.title}</AppText>
                    <Check color={colors.success} size={14} strokeWidth={3} />
                  </View>
                  {m.detail ? <AppText variant="caption" tone="soft" numberOfLines={1}>{m.detail}</AppText> : null}
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {preferences && token ? (
          <View onLayout={(e) => setPreferencesY(e.nativeEvent.layout.y)}>
            <PreferencesCard token={token} initial={preferences} onChange={setPreferences} />
          </View>
        ) : null}
      </View>
    </SafeScreen>
  );
}

function BandStat({ Icon, label, value }: { Icon: typeof Moon; label: string; value: number }) {
  return (
    <View style={styles.bandStat}>
      <View style={styles.inline}>
        <Icon color={colors.brand[200]} size={13} />
        <AppText variant="caption" style={styles.bandSub}>{label}</AppText>
      </View>
      <AppText variant="headline" weight="extraBold" tone="inverse">{Number(value).toLocaleString()}</AppText>
    </View>
  );
}

function MomentRow({ moment, first, token, onSent }: { moment: KaribuMoment; first: boolean; token: string | null; onSent: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [received, setReceived] = useState<boolean | null>(null);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const served = moment.status === "SERVED";

  async function send() {
    if (!token || received == null || (received && rating === 0)) return;
    setSending(true);
    setError(null);
    try {
      await sendKaribuFeedback(token, moment.id, { received, rating: received ? rating : null, note: note.trim() || null });
      await onSent();
      setOpen(false);
    } catch (err) {
      setError(getErrorMessage(err, "Your feedback could not be saved. Try again."));
    } finally {
      setSending(false);
    }
  }

  return (
    <View style={[styles.momentRow, !first && styles.rowDivider]}>
      <View style={styles.momentTop}>
        <View style={styles.iconTile}><Coffee color={colors.primary} size={18} /></View>
        <View style={styles.flex}>
          <AppText variant="bodySmall" weight="extraBold">{moment.drink} at {tidy(moment.property)}</AppText>
          <AppText variant="caption" tone="soft">{served ? `Served ${shortDate(moment.servedAt || moment.issuedAt)}` : "The property is preparing it now"}</AppText>
        </View>
        <View style={styles.inline}>
          <View style={[styles.dot, { backgroundColor: served ? colors.success : "#0284c7" }]} />
          <AppText variant="caption" weight="bold" style={{ color: served ? colors.success : "#0369a1" }}>{served ? "Served" : "Being prepared"}</AppText>
        </View>
      </View>

      {moment.feedback ? (
        <View style={[styles.inline, styles.indent]}>
          <CheckCircle2 color={colors.success} size={14} />
          <AppText variant="caption" weight="bold" tone="success">
            Thanks for telling us {moment.feedback.received ? `how it was (${moment.feedback.rating}/5)` : "it did not arrive"}.
          </AppText>
        </View>
      ) : served && !open ? (
        <Pressable accessibilityRole="button" onPress={() => { setOpen(true); setReceived(null); setRating(0); setNote(""); setError(null); }} style={styles.indent} hitSlop={6}>
          <AppText variant="caption" weight="extraBold" tone="primary">Did it reach you? Tell us</AppText>
        </Pressable>
      ) : null}

      {open && !moment.feedback ? (
        <View style={styles.feedbackBox}>
          <AppText variant="bodySmall" weight="extraBold">Did your welcome reach you?</AppText>
          <View style={styles.chipRow}>
            {([true, false] as const).map((value) => (
              <Chip key={String(value)} on={received === value} label={value ? "Yes, I received it" : "No, it did not arrive"} onPress={() => { setReceived(value); setRating(0); }} />
            ))}
          </View>
          {received ? (
            <View>
              <AppText variant="caption" weight="bold" tone="muted">How was it?</AppText>
              <View style={styles.stars}>
                {[1, 2, 3, 4, 5].map((value) => (
                  <Pressable key={value} accessibilityRole="button" accessibilityLabel={`${value} of 5 stars`} onPress={() => setRating(value)} hitSlop={4}>
                    <Star color="#f59e0b" fill={value <= rating ? "#f59e0b" : "transparent"} size={28} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={500}
            multiline
            placeholder={received === false ? "What happened (optional)" : "A note about your welcome (optional)"}
            placeholderTextColor={colors.softText}
            style={[styles.textInput, styles.textArea]}
          />
          {error ? <AppText variant="caption" tone="danger">{error}</AppText> : null}
          <View style={styles.actionsRow}>
            <AppButton title="Cancel" variant="ghost" onPress={() => setOpen(false)} style={styles.flex} />
            <AppButton title="Send" loading={sending} disabled={received == null || (received && !rating)} onPress={send} style={styles.flex} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
const comparable = (p: KaribuPreferences) =>
  JSON.stringify({ ...p, updatedAt: null, drinkLikes: [...p.drinkLikes].sort(), dietaryTags: [...p.dietaryTags].sort(), dietaryNote: p.dietaryNote?.trim() || null });

/** Optional guest preferences (doc section 14.2). Everything starts off; one action clears it all. */
function PreferencesCard({ token, initial, onChange }: { token: string; initial: KaribuPreferences; onChange: (next: KaribuPreferences) => void }) {
  const [draft, setDraft] = useState<KaribuPreferences>(initial);
  const [birthdayIsMine, setBirthdayIsMine] = useState(Boolean(initial.birthday));
  const [saving, setSaving] = useState<"" | "save" | "clear">("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [picker, setPicker] = useState<"day" | "month" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setDraft(initial);
    setBirthdayIsMine(Boolean(initial.birthday));
  }, [initial]);

  const dirty = comparable(draft) !== comparable(initial) || (draft.celebrateOptIn && birthdayIsMine !== Boolean(initial.birthday));
  const hasAnything = initial.celebrateOptIn || initial.shareWithProperty || initial.drinkLikes.length > 0 || initial.dietaryTags.length > 0 || Boolean(initial.dietaryNote);
  const birthdayIncomplete = draft.celebrateOptIn && (!draft.birthday || !birthdayIsMine);
  const days = draft.birthday ? DAYS_IN[draft.birthday.month - 1] : 31;
  const set = (patch: Partial<KaribuPreferences>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setStatus(null);
  };

  async function save() {
    if (birthdayIncomplete) {
      setStatus({ ok: false, text: "Add your birthday and confirm it is yours, or switch celebrating off." });
      return;
    }
    setSaving("save");
    try {
      const res = await saveKaribuPreferences(token, {
        celebrateOptIn: draft.celebrateOptIn,
        birthday: draft.birthday,
        birthdayIsMine,
        drinkLikes: draft.drinkLikes,
        dietaryTags: draft.dietaryTags,
        dietaryNote: draft.dietaryNote,
        shareWithProperty: draft.shareWithProperty
      });
      onChange(res.preferences);
      setStatus({ ok: true, text: "Saved" });
    } catch (err) {
      setStatus({ ok: false, text: getErrorMessage(err, "Your preferences could not be saved. Try again.") });
    } finally {
      setSaving("");
    }
  }

  async function clearAll() {
    setSaving("clear");
    try {
      const res = await clearKaribuPreferences(token);
      onChange(res.preferences);
      setConfirmClear(false);
      setStatus({ ok: true, text: "All preferences cleared" });
    } catch (err) {
      setStatus({ ok: false, text: getErrorMessage(err, "Your preferences could not be cleared. Try again.") });
    } finally {
      setSaving("");
    }
  }

  return (
    <View style={styles.card}>
      <View style={[styles.cardHead, styles.cardHeadRow]}>
        <View style={styles.darkTileSmall}><SlidersHorizontal color={colors.brand[200]} size={17} /></View>
        <View style={styles.flex}>
          <AppText variant="titleSm" weight="extraBold">Your preferences</AppText>
          <AppText variant="caption" tone="soft">Optional. Tell us what you enjoy so a welcome suits you.</AppText>
        </View>
      </View>

      <PrefGroup title="Drinks I enjoy" hint="Pick any you like.">
        <View style={styles.chipRow}>
          {KARIBU_DRINKS.map(([key, label]) => (
            <Chip key={key} on={draft.drinkLikes.includes(key)} label={label} onPress={() => set({ drinkLikes: toggle(draft.drinkLikes, key) })} />
          ))}
        </View>
      </PrefGroup>

      <PrefGroup title="Dietary needs or allergies" hint="We never choose a drink that clashes with these.">
        <View style={styles.chipRow}>
          {KARIBU_DIETARY.map(([key, label]) => (
            <Chip key={key} on={draft.dietaryTags.includes(key)} label={label} onPress={() => set({ dietaryTags: toggle(draft.dietaryTags, key) })} />
          ))}
        </View>
        <TextInput
          value={draft.dietaryNote ?? ""}
          onChangeText={(text) => set({ dietaryNote: text })}
          maxLength={200}
          placeholder="Anything else, for example no ice"
          placeholderTextColor={colors.softText}
          style={styles.textInput}
        />
      </PrefGroup>

      <View style={[styles.prefGroup, styles.rowDivider]}>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <AppText variant="bodySmall" weight="extraBold">Celebrate special days</AppText>
            <AppText variant="caption" tone="soft">If a stay falls on your birthday, we may mark it with you.</AppText>
          </View>
          <Switch value={draft.celebrateOptIn} onValueChange={(on) => set({ celebrateOptIn: on })} trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
        {draft.celebrateOptIn ? (
          <View style={styles.birthdayBox}>
            <View style={styles.selectRow}>
              <SelectField label={draft.birthday ? String(draft.birthday.day) : "Day"} placeholder={!draft.birthday} onPress={() => setPicker("day")} style={styles.dayField} />
              <SelectField label={draft.birthday ? MONTHS[draft.birthday.month - 1] : "Month"} placeholder={!draft.birthday} onPress={() => setPicker("month")} style={styles.flex} />
            </View>
            <AppText variant="caption" tone="soft">Day and month only. We never ask for the year.</AppText>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: birthdayIsMine }} onPress={() => { setBirthdayIsMine(!birthdayIsMine); setStatus(null); }} style={styles.checkRow} hitSlop={6}>
              <View style={[styles.checkbox, birthdayIsMine && styles.checkboxOn]}>
                {birthdayIsMine ? <Check color={colors.white} size={12} strokeWidth={3} /> : null}
              </View>
              <AppText variant="caption" weight="semiBold">This is my own birthday</AppText>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={[styles.prefGroup, styles.rowDivider]}>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <AppText variant="bodySmall" weight="extraBold">Share with the property</AppText>
            <AppText variant="caption" tone="soft">Staff see your drinks and dietary needs during your stay only.</AppText>
          </View>
          <Switch value={draft.shareWithProperty} onValueChange={(on) => set({ shareWithProperty: on })} trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
      </View>

      <View style={[styles.prefFooter, styles.rowDivider]}>
        {status ? <AppText variant="caption" weight="bold" tone={status.ok ? "success" : "danger"}>{status.text}</AppText> : null}
        <AppButton title="Save changes" loading={saving === "save"} disabled={!dirty || Boolean(saving) || birthdayIncomplete} onPress={save} icon={<Check color={colors.white} size={16} />} />
        <AppText variant="caption" tone="soft" style={styles.centerText}>
          Only you and NoLSAF see these{draft.shareWithProperty ? ", plus the property while you stay there" : ""}. Never used for marketing.
        </AppText>
        {confirmClear ? (
          <View style={styles.clearConfirm}>
            <AppText variant="caption" tone="muted">Clear everything?</AppText>
            <Pressable accessibilityRole="button" onPress={clearAll} disabled={Boolean(saving)} hitSlop={6}>
              <AppText variant="caption" weight="extraBold" tone="danger">{saving === "clear" ? "Clearing" : "Yes, clear"}</AppText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setConfirmClear(false)} hitSlop={6}>
              <AppText variant="caption" weight="extraBold" tone="soft">Keep</AppText>
            </Pressable>
          </View>
        ) : hasAnything ? (
          <Pressable accessibilityRole="button" onPress={() => setConfirmClear(true)} style={styles.clearLink} hitSlop={6}>
            <AppText variant="caption" weight="extraBold" tone="soft">Clear my preferences</AppText>
          </Pressable>
        ) : null}
      </View>

      <OptionPickerSheet
        visible={picker === "day"}
        title="Birthday day"
        options={Array.from({ length: days }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
        value={draft.birthday ? String(draft.birthday.day) : undefined}
        onSelect={(value) => { set({ birthday: { day: Number(value), month: draft.birthday?.month ?? 1 } }); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionPickerSheet
        visible={picker === "month"}
        title="Birthday month"
        options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
        value={draft.birthday ? String(draft.birthday.month) : undefined}
        onSelect={(value) => {
          const month = Number(value);
          set({ birthday: { month, day: Math.min(draft.birthday?.day ?? 1, DAYS_IN[month - 1]) } });
          setPicker(null);
        }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function PrefGroup({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <View style={[styles.prefGroup, styles.rowDivider]}>
      <AppText variant="bodySmall" weight="extraBold">{title}</AppText>
      <AppText variant="caption" tone="soft">{hint}</AppText>
      <View style={styles.prefBody}>{children}</View>
    </View>
  );
}

function Chip({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={onPress} style={[styles.chip, on && styles.chipOn]}>
      {on ? <Check color={colors.primary} size={13} strokeWidth={3} /> : null}
      <AppText variant="caption" weight={on ? "extraBold" : "semiBold"} tone={on ? "primary" : "default"}>{label}</AppText>
    </Pressable>
  );
}

function SelectField({ label, placeholder, onPress, style }: { label: string; placeholder: boolean; onPress: () => void; style?: object }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.select, style]}>
      <AppText variant="bodySmall" weight="semiBold" tone={placeholder ? "soft" : "default"} numberOfLines={1} style={styles.flex}>{label}</AppText>
      <ChevronDown color={colors.softText} size={16} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: spacing[10] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing[3] },
  content: { gap: spacing[5] },
  flex: { flex: 1, minWidth: 0 },
  inline: { flexDirection: "row", alignItems: "center", gap: 5 },
  centerText: { textAlign: "center" },
  pressed: { opacity: 0.85 },
  band: { gap: spacing[4], borderRadius: radius.xl, backgroundColor: colors.primaryDeep, padding: spacing[5] },
  bandEyebrow: { color: colors.brand[200], marginBottom: 2 },
  bandSub: { color: colors.brand[200] },
  bandStats: { flexDirection: "row", gap: spacing[2] },
  bandStat: { flex: 1, gap: spacing[1], borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", padding: spacing[3] },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: "hidden", ...shadows.card },
  cardHead: { gap: 2, padding: spacing[4] },
  cardHeadRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  nextStay: { flexDirection: "row", alignItems: "center", gap: spacing[3], padding: spacing[4] },
  iconTile: { width: 40, height: 40, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand[50] },
  darkTile: { width: 46, height: 46, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryDeep },
  darkTileSmall: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primaryDeep },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.surface },
  momentRow: { gap: spacing[2], padding: spacing[4] },
  momentTop: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  dot: { width: 6, height: 6, borderRadius: radius.full },
  indent: { marginLeft: 52 },
  feedbackBox: { gap: spacing[3], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: spacing[3] },
  stars: { flexDirection: "row", gap: spacing[1], marginTop: spacing[1] },
  actionsRow: { flexDirection: "row", gap: spacing[2] },
  stayRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], borderTopWidth: 1, borderTopColor: colors.border, padding: spacing[4] },
  dateTile: { width: 48, height: 54, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  dateTileLatest: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  welcomeTag: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderRadius: radius.full, backgroundColor: colors.brand[50], paddingHorizontal: spacing[2], paddingVertical: 2, marginTop: 4 },
  emptyStory: { alignItems: "center", gap: spacing[2], borderTopWidth: 1, borderTopColor: colors.border, padding: spacing[6] },
  milestoneRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], borderTopWidth: 1, borderTopColor: colors.border, padding: spacing[4] },
  milestoneIcon: { width: 40, height: 40, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand[50], borderWidth: 2, borderColor: colors.brand[100] },
  prefGroup: { gap: 2, padding: spacing[4] },
  prefBody: { gap: spacing[3], marginTop: spacing[3] },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing[3] },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  textInput: { minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing[3], paddingVertical: spacing[2], color: colors.ink, fontSize: 14 },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  birthdayBox: { gap: spacing[2], marginTop: spacing[3] },
  selectRow: { flexDirection: "row", gap: spacing[2] },
  dayField: { width: 96 },
  select: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing[2], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing[3] },
  checkRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], alignSelf: "flex-start" },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  checkboxOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  prefFooter: { gap: spacing[3], padding: spacing[4], backgroundColor: colors.surface },
  clearConfirm: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[4] },
  clearLink: { alignSelf: "center" }
});

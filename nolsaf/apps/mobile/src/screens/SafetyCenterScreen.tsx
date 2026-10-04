import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AlertTriangle, CalendarClock, ExternalLink, Mail, MapPin, Phone, Share2, ShieldCheck, Siren, UsersRound } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, Share, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { AppButton, AppCard, AppText, SafeScreen, ScreenHeader, StateView } from "../components";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, shadows, spacing } from "../theme";
import { createTripShare, fetchTripSafety, revokeTripShare, type SafetyTrip, type TripSafetyResponse } from "../tripSafety";

type Props = NativeStackScreenProps<RootStackParamList, "SafetyCenter">;

function dateLabel(value?: string | null) {
  if (!value) return "Time to be confirmed";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function serviceLabel(kind: SafetyTrip["serviceKind"]) {
  return kind === "GROUP_STAY" ? "Group stay" : kind.charAt(0) + kind.slice(1).toLowerCase();
}

export function SafetyCenterScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [data, setData] = useState<TripSafetyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchTripSafety(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load safety information.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const shareTrip = async (trip: SafetyTrip) => {
    if (!token) return;
    const key = `${trip.serviceKind}:${trip.serviceId}`;
    setSharingId(key);
    try {
      const result = await createTripShare(token, trip);
      setData((current) => current ? {
        ...current,
        trips: current.trips.map((item) => item.serviceKind === trip.serviceKind && item.serviceId === trip.serviceId
          ? { ...item, activeShare: { token: result.token, url: result.url, expiresAt: result.expiresAt } }
          : item),
      } : current);
      await Share.share({
        title: `Follow my ${serviceLabel(trip.serviceKind).toLowerCase()}`,
        message: `I am sharing my active NoLSAF trip for safety. Open the secure live link: ${result.url}`,
        url: result.url,
      });
    } catch (cause) {
      Alert.alert("Share my trip", cause instanceof Error ? cause.message : "Could not create the secure trip link.");
    } finally {
      setSharingId(null);
    }
  };

  const turnOffShare = async (trip: SafetyTrip) => {
    if (!token || !trip.activeShare) return;
    try {
      await revokeTripShare(token, trip.activeShare.token);
      setData((current) => current ? {
        ...current,
        trips: current.trips.map((item) => item.serviceKind === trip.serviceKind && item.serviceId === trip.serviceId ? { ...item, activeShare: null } : item),
      } : current);
    } catch (cause) {
      Alert.alert("Turn off trip link", cause instanceof Error ? cause.message : "Could not turn off this link.");
    }
  };

  const openTrip = (trip: SafetyTrip) => {
    if (trip.serviceKind === "STAY") navigation.navigate("MyBookings");
    else if (trip.serviceKind === "TOUR") navigation.navigate("TourDetail", { id: trip.serviceId });
    else if (trip.serviceKind === "GROUP_STAY") navigation.navigate("GroupStayDetail", { id: trip.serviceId });
    else navigation.navigate("RideDetail", { id: trip.serviceId });
  };

  if (loading) return <SafeScreen><View style={styles.loading}><ActivityIndicator color={colors.primary} /><AppText variant="bodySmall" tone="muted">Checking support contacts and your active trips.</AppText></View></SafeScreen>;
  if (error || !data) return <SafeScreen><StateView title="Safety information unavailable" message={error || "Try again."} actionLabel="Retry" onAction={() => void load()} /></SafeScreen>;

  const supportPhone = String(data.support.phone || "").replace(/[^+\d]/g, "");
  const whatsappPhone = supportPhone.replace(/^\+/, "");
  return (
    <SafeScreen contentStyle={styles.screen}>
      <ScreenHeader title="Safety & trip assistance" subtitle="Emergency contacts and secure trip sharing in one place." onBack={() => navigation.goBack()} />

      <AppCard style={styles.hero}>
        <View style={styles.heroIcon}><ShieldCheck color={colors.white} size={26} /></View>
        <View style={styles.flex}>
          <AppText variant="titleSm" weight="extraBold" tone="inverse">Help stays close</AppText>
          <AppText variant="bodySmall" style={styles.heroText}>Call emergency services first when there is immediate danger, then contact your provider and NoLSAF.</AppText>
        </View>
      </AppCard>

      <SectionTitle Icon={Siren} title="Local emergency numbers" />
      <AppCard style={styles.card}>
        {data.emergencyContacts.map((contact, index) => (
          <ContactRow key={`${contact.country}:${contact.phone}:${contact.label}`} title={contact.label} subtitle={contact.country} value={contact.phone} last={index === data.emergencyContacts.length - 1} onPress={() => Linking.openURL(`tel:${contact.phone}`)} />
        ))}
      </AppCard>

      <SectionTitle Icon={Phone} title="NoLSAF support" />
      <AppCard style={styles.card}>
        {supportPhone ? <ContactRow title="Call support" subtitle="Booking and safety assistance" value={supportPhone} onPress={() => Linking.openURL(`tel:${supportPhone}`)} /> : null}
        {whatsappPhone ? <ContactRow title="WhatsApp support" subtitle="Send the booking reference and issue" value={supportPhone} onPress={() => Linking.openURL(`https://wa.me/${whatsappPhone}`)} /> : null}
        {data.support.email ? <ContactRow title="Email support" subtitle="Non-urgent assistance" value={data.support.email} last onPress={() => Linking.openURL(`mailto:${data.support.email}`)} /> : null}
      </AppCard>

      <SectionTitle Icon={Share2} title="Share my trip" />
      <AppText variant="bodySmall" tone="muted" style={styles.sectionCopy}>Share a secure live link with someone you trust. It expires automatically and excludes payment details, documents, access codes, passenger rosters and live location.</AppText>
      {data.trips.length ? data.trips.map((trip) => {
        const key = `${trip.serviceKind}:${trip.serviceId}`;
        return (
          <AppCard key={key} style={styles.tripCard}>
            <View style={styles.tripTop}>
              <View style={styles.kindPill}><AppText variant="caption" weight="extraBold" tone="primary">{serviceLabel(trip.serviceKind)}</AppText></View>
              <AppText variant="caption" weight="bold" tone="success">{trip.status.replace(/_/g, " ")}</AppText>
            </View>
            <AppText variant="titleSm" weight="extraBold">{trip.title}</AppText>
            {trip.destination ? <View style={styles.meta}><MapPin color={colors.softText} size={14} /><AppText variant="bodySmall" tone="muted" style={styles.flex}>{trip.destination}</AppText></View> : null}
            <View style={styles.meta}><CalendarClock color={colors.softText} size={14} /><AppText variant="bodySmall" tone="muted">{dateLabel(trip.startAt)}</AppText></View>
            {trip.provider?.phone ? <Pressable onPress={() => Linking.openURL(`tel:${String(trip.provider.phone).replace(/[^+\d]/g, "")}`)} style={styles.provider}><Phone color={colors.primary} size={14} /><AppText variant="bodySmall" weight="bold" tone="primary">{trip.provider.name || "Provider"}: {trip.provider.phone}</AppText></Pressable> : <AppText variant="caption" tone="muted">Provider emergency contact is not published; use NoLSAF support.</AppText>}
            <View style={styles.actions}>
              <AppButton title="Open trip" variant="secondary" icon={<ExternalLink color={colors.primary} size={16} />} onPress={() => openTrip(trip)} style={styles.flex} />
              <AppButton title={sharingId === key ? "Creating link…" : "Share safely"} icon={<Share2 color={colors.white} size={16} />} onPress={() => shareTrip(trip)} disabled={Boolean(sharingId)} loading={sharingId === key} style={styles.flex} />
            </View>
            {trip.activeShare ? <Pressable accessibilityRole="button" onPress={() => void turnOffShare(trip)} style={styles.revoke}><AppText variant="caption" weight="bold" tone="danger">Turn off shared link</AppText></Pressable> : null}
          </AppCard>
        );
      }) : <AppCard style={styles.empty}><UsersRound color={colors.softText} size={24} /><AppText variant="bodySmall" tone="muted" style={styles.center}>Your upcoming paid stays, tours, group stays and rides will appear here.</AppText></AppCard>}

      <AppCard style={styles.warning}>
        <AlertTriangle color="#a16207" size={20} />
        <AppText variant="caption" style={styles.warningText}>A shared link helps trusted contacts follow the planned service. It is not a replacement for calling local emergency services.</AppText>
      </AppCard>
    </SafeScreen>
  );
}

function SectionTitle({ Icon, title }: { Icon: typeof Phone; title: string }) {
  return <View style={styles.sectionTitle}><Icon color={colors.primary} size={19} /><AppText variant="titleSm" weight="extraBold">{title}</AppText></View>;
}

function ContactRow({ title, subtitle, value, onPress, last = false }: { title: string; subtitle: string; value: string; onPress: () => void; last?: boolean }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.contactRow, !last && styles.divider]}><View style={styles.flex}><AppText variant="bodySmall" weight="extraBold">{title}</AppText><AppText variant="caption" tone="muted">{subtitle}</AppText></View><AppText variant="bodySmall" weight="extraBold" tone="primary">{value}</AppText></Pressable>;
}

const styles = StyleSheet.create({
  screen: { padding: spacing[4], paddingBottom: spacing[8] },
  flex: { flex: 1 },
  hero: { flexDirection: "row", gap: spacing[3], alignItems: "center", backgroundColor: "#064e3b", borderColor: "#064e3b", ...shadows.card },
  heroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  heroText: { color: "rgba(255,255,255,0.8)", marginTop: 3 },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: spacing[2], marginTop: spacing[5], marginBottom: spacing[2] },
  sectionCopy: { marginBottom: spacing[3] },
  card: { paddingVertical: 0 },
  contactRow: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing[3], paddingVertical: spacing[3] },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tripCard: { marginBottom: spacing[3], gap: spacing[2], ...shadows.card },
  tripTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kindPill: { paddingHorizontal: spacing[2], paddingVertical: 5, borderRadius: radius.full, backgroundColor: colors.brand[50] },
  meta: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  provider: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingVertical: spacing[1] },
  actions: { flexDirection: "row", gap: spacing[2], marginTop: spacing[2] },
  revoke: { alignSelf: "center", paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  empty: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[5] },
  center: { textAlign: "center" },
  warning: { marginTop: spacing[4], flexDirection: "row", gap: spacing[3], backgroundColor: "#fffbeb", borderColor: "#fde68a" },
  warningText: { color: "#854d0e", flex: 1 },
  loading: { minHeight: 320, alignItems: "center", justifyContent: "center", gap: spacing[3] },
});

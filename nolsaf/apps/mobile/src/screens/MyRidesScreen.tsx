import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CalendarClock, CarFront, CheckCircle2, ChevronRight, Headset, MapPin, Navigation, Radar, ShieldCheck, Star, User, XCircle } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import { useAuth } from "../auth";
import { AmountText, AppText, CustomerBottomNav, SafeScreen, ScreenHeader, StateView } from "../components";
import { RootStackParamList } from "../navigation/types";
import { fetchMyRides, RideListItem } from "../transport";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "MyRides">;

type RideKind = "scheduled" | "completed" | "expired";
type Filter = "all" | RideKind;

function rideKind(ride: RideListItem): RideKind {
  if (ride.isValid) return "scheduled";
  if (String(ride.status || "").toUpperCase() === "COMPLETED") return "completed";
  return "expired";
}

const KIND_META: Record<RideKind, { label: string; accent: string; tint: string; Icon: typeof CheckCircle2 }> = {
  scheduled: { label: "Scheduled", accent: colors.primary, tint: colors.brand[50], Icon: CheckCircle2 },
  completed: { label: "Completed", accent: colors.success, tint: "#e9f7ef", Icon: CheckCircle2 },
  expired: { label: "Expired", accent: colors.danger, tint: "#fdecec", Icon: XCircle }
};

function formatWhen(iso: string | null) {
  if (!iso) return "Time pending";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const WHATSAPP_GREEN = "#25D366";

/**
 * One gradient wash per trip state, so the traveller can tell them apart at a
 * glance: teal for a ready scheduled ride, amber while we are still finding a
 * driver, green for completed, red for expired. Kept light so text stays clear.
 */
type CardState = "scheduled" | "waiting" | "completed" | "expired";
const CARD_GRADIENT: Record<CardState, [string, string]> = {
  scheduled: ["#e6f4f1", "#ffffff"],
  waiting: ["#fff5e0", "#ffffff"],
  completed: ["#e8f7ee", "#ffffff"],
  expired: ["#fdeeee", "#ffffff"]
};

function CardGradient({ state }: { state: CardState }) {
  const [from, to] = CARD_GRADIENT[state];
  const id = `cardgrad-${state}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={from} />
          <Stop offset="1" stopColor={to} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
    </Svg>
  );
}

/** WhatsApp glyph (lucide dropped brand icons), drawn as a single evenodd path. */
function WhatsAppGlyph({ size = 16, color = colors.white }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        fillRule="evenodd"
        clipRule="evenodd"
        d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413z"
      />
    </Svg>
  );
}

type AssignChip = { Icon: typeof Radar; label: string };
type AssignState =
  | { mode: "assigned" }
  | { mode: "finding"; title: string; detail: string; Icon: typeof Radar; chips: AssignChip[] }
  | { mode: "none" };

const VERIFIED_CHIP: AssignChip = { Icon: ShieldCheck, label: "Verified driver" };

/**
 * How the traveller learns about their driver, in plain language. Scheduled trips
 * read differently from instant pickups: a scheduled driver is locked in ahead of
 * the pickup time, while an instant pickup is matched to the nearest driver now.
 * If nobody accepts in time the NoLSAF team steps in. Once a driver is on, we show
 * their details instead.
 */
function assignState(ride: RideListItem): AssignState {
  if (ride.driver) return { mode: "assigned" };
  // Only active (upcoming) rides are still being matched. Past rides just had no driver.
  if (!ride.isValid) return { mode: "none" };
  const status = String(ride.status || "").toUpperCase();
  if (status === "PENDING_ADMIN_ASSIGNMENT") {
    return {
      mode: "finding",
      title: "Our team is on it",
      detail: "We are hand picking your driver now. Their details show up here once confirmed.",
      Icon: Headset,
      chips: [{ Icon: Headset, label: "Hand picked" }, VERIFIED_CHIP]
    };
  }
  const startsAt = ride.scheduledDate ? new Date(ride.scheduledDate).getTime() : 0;
  const isScheduled = startsAt - Date.now() > 90 * 60 * 1000;
  if (isScheduled) {
    return {
      mode: "finding",
      title: "Driver locked in before pickup",
      detail: "For scheduled trips we confirm your driver ahead of time, so they are ready the moment you arrive.",
      Icon: CalendarClock,
      chips: [{ Icon: CalendarClock, label: "Confirmed ahead" }, VERIFIED_CHIP]
    };
  }
  return {
    mode: "finding",
    title: "Finding your driver",
    detail: "We are matching you with the nearest driver right now.",
    Icon: Radar,
    chips: [{ Icon: Radar, label: "Nearest driver" }, VERIFIED_CHIP]
  };
}

export function MyRidesScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [items, setItems] = useState<RideListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!token) {
        setError("Please sign in to view your rides.");
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await fetchMyRides(token, { page: 1, pageSize: 50 });
        setItems(response.items || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load rides.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [token]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    let scheduled = 0;
    let completed = 0;
    let expired = 0;
    for (const r of items) {
      const k = rideKind(r);
      if (k === "scheduled") scheduled += 1;
      else if (k === "completed") completed += 1;
      else expired += 1;
    }
    return { all: items.length, scheduled, completed, expired };
  }, [items]);

  const filtered = useMemo(
    () => (filter === "all" ? items : items.filter((r) => rideKind(r) === filter)),
    [items, filter]
  );

  const renderRide = useCallback(({ item: ride }: { item: RideListItem }) => {
    const kind = rideKind(ride);
    const meta = KIND_META[kind];
    const destination = ride.toAddress || ride.property?.title || ride.toRegion || "Your booked stay";
    const assign = assignState(ride);
    const cardState: CardState =
      kind === "completed" ? "completed" : kind === "expired" ? "expired" : assign.mode === "assigned" ? "scheduled" : "waiting";
    const messageDriver = () => {
      const phone = ride.driver?.phone?.replace(/[^\d]/g, "");
      if (phone) void Linking.openURL(`https://wa.me/${phone}`);
    };
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate("RideDetail", { id: ride.id })}
        style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      >
        <CardGradient state={cardState} />
        <View style={styles.cardBody}>
          {/* Header */}
          <View style={styles.rowBetween}>
            <View style={styles.rowStart}>
              <View style={[styles.kindIcon, { backgroundColor: meta.tint }]}>
                <CarFront color={meta.accent} size={16} />
              </View>
              <AppText variant="bodySmall" weight="bold" numberOfLines={1} style={styles.flex}>
                {formatWhen(ride.scheduledDate)}
              </AppText>
            </View>
            <View style={[styles.statusPill, { backgroundColor: meta.tint }]}>
              <meta.Icon color={meta.accent} size={12} />
              <AppText variant="caption" weight="bold" style={{ color: meta.accent }}>
                {meta.label}
              </AppText>
            </View>
          </View>

          {/* Route track */}
          <View style={styles.routeRow}>
            <View style={styles.track}>
              <View style={[styles.dot, { backgroundColor: colors.softText }]} />
              <View style={styles.trackLine} />
              <View style={[styles.dot, { backgroundColor: meta.accent }]} />
            </View>
            <View style={styles.routeCol}>
              <View style={[styles.locCard, styles.locFrom]}>
                <View style={styles.locLabel}>
                  <MapPin color={colors.softText} size={12} />
                  <AppText variant="caption" weight="bold" tone="soft" style={styles.locLabelText}>
                    FROM
                  </AppText>
                </View>
                <AppText variant="bodySmall" weight="semiBold" numberOfLines={1}>
                  {ride.fromAddress || "Pickup point"}
                </AppText>
              </View>
              <View style={[styles.locCard, styles.locTo]}>
                <View style={styles.locLabel}>
                  <Navigation color={colors.primary} size={12} />
                  <AppText variant="caption" weight="bold" tone="primary" style={styles.locLabelText}>
                    TO
                  </AppText>
                </View>
                <AppText variant="bodySmall" weight="semiBold" numberOfLines={1}>
                  {destination}
                </AppText>
              </View>
            </View>
          </View>

          {/* Driver assignment: assigned driver, or live "finding" status */}
          {assign.mode === "assigned" && ride.driver ? (
            <View style={styles.driverBlock}>
              <View style={styles.driverHeader}>
                <CheckCircle2 color={colors.success} size={12} />
                <AppText variant="caption" weight="bold" tone="soft" style={styles.driverHeaderText}>
                  YOUR DRIVER
                </AppText>
              </View>
              <View style={styles.driverRow}>
                <View style={styles.driverAvatar}>
                  <User color={colors.white} size={16} />
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                    {ride.driver.name || "Driver assigned"}
                  </AppText>
                  {ride.driver.phone ? (
                    <View style={styles.rowStartTight}>
                      <WhatsAppGlyph size={12} color={WHATSAPP_GREEN} />
                      <AppText variant="caption" tone="soft">
                        {ride.driver.phone}
                      </AppText>
                    </View>
                  ) : null}
                </View>
                {ride.rating != null ? (
                  <View style={styles.ratingChip}>
                    <Star color={colors.warning} size={12} />
                    <AppText variant="caption" weight="bold">
                      {ride.rating.toFixed(1)}
                    </AppText>
                  </View>
                ) : null}
              </View>
              {ride.driver.phone ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={messageDriver}
                  style={({ pressed }) => [styles.whatsappButton, pressed && styles.whatsappButtonPressed]}
                >
                  <WhatsAppGlyph size={16} color={colors.white} />
                  <AppText variant="bodySmall" weight="bold" tone="inverse">
                    Chat on WhatsApp
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          ) : assign.mode === "finding" ? (
            <View style={styles.findingBlock}>
              <View style={styles.findingIcon}>
                <assign.Icon color={colors.primary} size={16} />
              </View>
              <View style={styles.flex}>
                <View style={styles.rowStartTight}>
                  <AppText variant="bodySmall" weight="bold" numberOfLines={1} style={styles.flex}>
                    {assign.title}
                  </AppText>
                  <View style={styles.findingDot} />
                </View>
                <AppText variant="caption" tone="soft">
                  {assign.detail}
                </AppText>
                <View style={styles.findingChips}>
                  {assign.chips.map((c) => (
                    <View key={c.label} style={styles.findingChip}>
                      <c.Icon color={colors.primary} size={11} />
                      <AppText variant="caption" weight="bold" tone="primary">
                        {c.label}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ) : null}

          {/* Fare */}
          {ride.amount != null ? (
            <View style={styles.fareRow}>
              <AppText variant="caption" tone="muted">
                Fare
              </AppText>
              <AmountText amount={ride.amount} variant="titleSm" weight="extraBold" tone="primary" />
            </View>
          ) : null}

          {/* Tap hint */}
          <View style={styles.detailsHint}>
            <AppText variant="caption" weight="bold" tone="primary">
              View full details
            </AppText>
            <ChevronRight color={colors.primary} size={14} />
          </View>
        </View>
      </Pressable>
    );
  }, [navigation]);

  const TABS: Array<{ key: Filter; label: string; count: number }> = [
    { key: "all", label: "All", count: counts.all },
    { key: "scheduled", label: "Scheduled", count: counts.scheduled },
    { key: "completed", label: "Completed", count: counts.completed },
    { key: "expired", label: "Expired", count: counts.expired }
  ];

  return (
    <View style={styles.root}>
      <SafeScreen scroll={false} padded={false} contentStyle={styles.flex}>
        <View style={styles.headerWrap}>
          <ScreenHeader
            centered
            title="My Rides"
            subtitle="Your transport to every booked stay. Schedule a transfer ahead, or get an instant pickup."
          />
        </View>

        {/* Filter tabs */}
        {!loading && !error ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tabsRow}
            style={styles.tabsScroll}
          >
            {TABS.map((t) => {
              const on = filter === t.key;
              return (
                <Pressable
                  key={t.key}
                  accessibilityRole="button"
                  onPress={() => setFilter(t.key)}
                  style={[styles.tab, on && styles.tabOn]}
                >
                  <AppText variant="caption" weight="bold" tone={on ? "inverse" : "muted"}>
                    {t.label}
                  </AppText>
                  <View style={[styles.tabCount, on && styles.tabCountOn]}>
                    <AppText variant="caption" weight="bold" tone={on ? "inverse" : "muted"}>
                      {t.count}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="bodySmall" tone="muted">
              Loading your rides...
            </AppText>
          </View>
        ) : error ? (
          <View style={styles.stateWrap}>
            <StateView title="Could not load rides" message={error} actionLabel="Try again" onAction={() => load()} />
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(r) => String(r.id)}
            renderItem={renderRide}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} colors={[colors.primary]} />
            }
            ListEmptyComponent={
              <View style={styles.stateWrap}>
                {filter === "all" ? (
                  <StateView
                    title="No rides yet"
                    message="A ride brings you to a stay you have booked. Browse stays, book one, then add a scheduled transfer or an instant pickup to it."
                    actionLabel="Browse stays"
                    onAction={() => navigation.navigate("VerifiedStays")}
                  />
                ) : (
                  <StateView
                    title={`No ${filter} rides`}
                    message="Try a different filter to see your other rides."
                    actionLabel="View all rides"
                    onAction={() => setFilter("all")}
                  />
                )}
              </View>
            }
          />
        )}
      </SafeScreen>

      <CustomerBottomNav active="MyRides" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  headerWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[4] },
  tabsScroll: { flexGrow: 0, flexShrink: 0, marginTop: spacing[3], marginBottom: spacing[1] },
  tabsRow: { paddingHorizontal: spacing[4], paddingVertical: spacing[1], gap: spacing[2] },
  list: { flex: 1 },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  tabOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabCount: {
    minWidth: 20,
    alignItems: "center",
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[1]
  },
  tabCountOn: { backgroundColor: "rgba(255,255,255,0.22)" },
  loading: { alignItems: "center", justifyContent: "center", gap: spacing[3], padding: spacing[6] },
  stateWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[5] },
  listContent: { paddingHorizontal: spacing[4], paddingTop: spacing[4], paddingBottom: spacing[10] },
  sep: { height: spacing[5] },
  card: {
    minWidth: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: "hidden",
    ...shadows.card
  },
  cardPressed: { opacity: 0.85 },
  detailsHint: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[3]
  },
  cardBody: { minWidth: 0, padding: spacing[4], gap: spacing[3] },
  rowBetween: { minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  rowStart: { minWidth: 0, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing[2] },
  rowStartTight: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  kindIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center"
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  routeRow: { flexDirection: "row", gap: spacing[3], minWidth: 0 },
  track: { alignItems: "center", paddingVertical: 6 },
  dot: { width: 9, height: 9, borderRadius: radius.full },
  trackLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
  routeCol: { flex: 1, minWidth: 0, gap: spacing[2] },
  locCard: { minWidth: 0, borderRadius: radius.md, paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  locFrom: { backgroundColor: "#f1f5f9" },
  locTo: { backgroundColor: colors.brand[50] },
  locLabel: { flexDirection: "row", alignItems: "center", gap: spacing[1], marginBottom: 2 },
  locLabelText: { letterSpacing: 1 },
  driverBlock: {
    minWidth: 0,
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: "#f3faf9",
    padding: spacing[3]
  },
  driverHeader: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  driverHeaderText: { letterSpacing: 1 },
  driverRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  whatsappButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: WHATSAPP_GREEN,
    paddingVertical: spacing[3]
  },
  whatsappButtonPressed: { opacity: 0.85 },
  findingBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[3]
  },
  findingIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  findingDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary
  },
  findingChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[2]
  },
  findingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  driverAvatar: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  ratingChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  fareRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    minWidth: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[3]
  }
});

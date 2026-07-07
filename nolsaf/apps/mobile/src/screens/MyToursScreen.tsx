import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CalendarDays, CheckCircle2, Clock3, Compass, CreditCard, MapPin, ReceiptText, Search, Users } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, useWindowDimensions, View } from "react-native";

import { useAuth } from "../auth";
import { AmountText, AppButton, AppText, CustomerBottomNav, SafeScreen, ScreenHeader, StateView } from "../components";
import { RootStackParamList } from "../navigation/types";
import { CustomerTourBookingSummary, fetchCustomerTourBooking, fetchCustomerTourBookings } from "../tours";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "MyTours">;
type BucketFilter = "ALL" | "DRAFT" | "PAID_PACKAGES" | "ACTIVE_TIMELINE" | "COMPLETED";

const FILTERS: Array<{ key: BucketFilter; label: string; width: number }> = [
  { key: "ALL", label: "All", width: 86 },
  { key: "DRAFT", label: "Pending", width: 116 },
  { key: "PAID_PACKAGES", label: "Ready", width: 104 },
  { key: "ACTIVE_TIMELINE", label: "Timeline", width: 116 },
  { key: "COMPLETED", label: "Completed", width: 128 }
];

function fmtDate(value?: string | null) {
  if (!value) return "Date pending";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Date pending" : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function operatorName(item: CustomerTourBookingSummary) {
  const snap = item.operatorSnapshot || {};
  return String(snap.companyName || snap.operatorName || snap.name || "NoLSAF tour operator");
}

function statusMeta(item: CustomerTourBookingSummary) {
  const bucket = String(item.dashboardBucket || "").toUpperCase();
  const pay = String(item.paymentStatus || "").toUpperCase();
  const expired = bucket === "DRAFT" && String(item.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
  if (expired) return { label: "Expired", color: colors.danger, tint: "#fee2e2" };
  if (bucket === "COMPLETED") return { label: "Completed", color: colors.success, tint: "#e9f7ef" };
  if (bucket === "ACTIVE_TIMELINE") return { label: "Timeline live", color: "#2563eb", tint: "#eaf2ff" };
  if (bucket === "PAID_PACKAGES" || pay === "PAID") return { label: "Ready", color: colors.primary, tint: colors.brand[50] };
  return { label: "Payment pending", color: colors.warning, tint: "#fff7ed" };
}

function tripStageLabel(item: CustomerTourBookingSummary) {
  const bucket = String(item.dashboardBucket || "").toUpperCase();
  const status = String(item.timelineStatus || item.status || "").toUpperCase();
  const pay = String(item.paymentStatus || "").toUpperCase();
  if (bucket === "COMPLETED") return "Completed";
  if (bucket === "ACTIVE_TIMELINE") return "Timeline live";
  if (bucket === "PAID_PACKAGES" || pay === "PAID") return "Ready for meetup";
  if (bucket === "DRAFT" && String(item.draftExpiryStatus || "").toUpperCase() === "EXPIRED") return "Expired";
  if (status.includes("CANCEL")) return "Cancelled";
  return "Payment pending";
}

export function MyToursScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [items, setItems] = useState<CustomerTourBookingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<BucketFilter>("ALL");
  const [payingId, setPayingId] = useState<number | null>(null);

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (!token) {
      setError("Please sign in to view your tour packages.");
      setLoading(false);
      return;
    }
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetchCustomerTourBookings(token, { page: 1, pageSize: 30 });
      setItems(res.items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tour packages.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = useMemo(() => {
    const next = { ALL: items.length, DRAFT: 0, PAID_PACKAGES: 0, ACTIVE_TIMELINE: 0, COMPLETED: 0 };
    for (const item of items) {
      const key = String(item.dashboardBucket || "").toUpperCase() as BucketFilter;
      if (key in next) next[key] += 1;
    }
    return next;
  }, [items]);

  const visible = filter === "ALL" ? items : items.filter((item) => String(item.dashboardBucket || "").toUpperCase() === filter);

  const openPayment = useCallback(async (bookingId: number) => {
    if (!token || payingId) return;
    setPayingId(bookingId);
    try {
      const detail = await fetchCustomerTourBooking(token, bookingId);
      const accessToken = String(detail.paymentResume?.paymentAccessToken || "");
      const tokenActive = String(detail.paymentResume?.paymentAccessTokenStatus || "").toUpperCase() === "ACTIVE";
      if (accessToken && tokenActive) {
        navigation.navigate("TourBookingPayment", { bookingId, accessToken });
        return;
      }
      Alert.alert("Payment expired", "This payment session has expired. Please book the package again.");
    } catch (err) {
      Alert.alert("Payment", err instanceof Error ? err.message : "Could not open secure payment.");
    } finally {
      setPayingId(null);
    }
  }, [navigation, payingId, token]);

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />}
          contentContainerStyle={styles.scrollContent}
        >
          <ScreenHeader title="My Tour Packages" subtitle="Your package status, payment, documents, and trip timeline in one place." centered />

          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <ReceiptText color={colors.white} size={24} />
            </View>
            <View style={styles.heroText}>
              <AppText variant="titleSm" weight="extraBold" tone="inverse">
                Tour control room
              </AppText>
              <AppText variant="bodySmall" style={styles.heroCopy}>
                Track paid packages, meetup validation, vouchers, receipts, and support requests.
              </AppText>
            </View>
          </View>

          <View style={styles.filterWrap}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRail}>
              {FILTERS.map((item) => {
                const active = filter === item.key;
                return (
                  <Pressable
                    key={item.key}
                    accessibilityRole="button"
                    onPress={() => setFilter(item.key)}
                    style={({ pressed }) => [
                      styles.filterChip,
                      { width: item.width },
                      active && styles.filterChipActive,
                      pressed && styles.filterChipPressed
                    ]}
                  >
                    <View style={styles.filterText}>
                      <AppText variant="caption" weight="extraBold" tone={active ? "inverse" : "muted"} numberOfLines={1}>
                        {item.label}
                      </AppText>
                    </View>
                    <View style={[styles.countPill, active && styles.countPillActive]}>
                      <AppText variant="caption" weight="extraBold" tone={active ? "primary" : "muted"}>
                        {summary[item.key]}
                      </AppText>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="bodySmall" tone="muted">
                Loading your tour packages...
              </AppText>
            </View>
          ) : error ? (
            <StateView title="Could not load tours" message={error} actionLabel="Try again" onAction={() => load()} />
          ) : visible.length === 0 ? (
            <StateView
              title="No tour packages here"
              message={filter === "ALL" ? "Book a tour package first, then manage it here." : "Nothing in this status yet."}
              actionLabel="Browse packages"
              onAction={() => navigation.navigate("TourPackages")}
            />
          ) : (
            <View style={styles.list}>
              {visible.map((item) => (
                <TourCard
                  key={item.id}
                  item={item}
                  onOpen={() => navigation.navigate("TourDetail", { id: item.id })}
                  onBookAgain={() => navigation.navigate("TourPackages")}
                  onPay={() => openPayment(item.id)}
                  paying={payingId === item.id}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeScreen>

      <CustomerBottomNav active="MyBookings" />
    </View>
  );
}

function TourCard({
  item,
  onOpen,
  onPay,
  onBookAgain,
  paying
}: {
  item: CustomerTourBookingSummary;
  onOpen: () => void;
  onPay: () => void;
  onBookAgain: () => void;
  paying?: boolean;
}) {
  const { width } = useWindowDimensions();
  const meta = statusMeta(item);
  const isDraft = String(item.dashboardBucket || "").toUpperCase() === "DRAFT";
  const isExpiredDraft = isDraft && String(item.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
  const isCompleted = String(item.dashboardBucket || "").toUpperCase() === "COMPLETED";
  const amount = Number(item.grossAmount || 0);
  const detailWidth = Math.min(340, Math.max(238, Math.round(width * 0.58)));
  const facts = [
    { Icon: MapPin, label: "Destination", value: item.destination || "Not set" },
    { Icon: CalendarDays, label: "Travel date", value: fmtDate(item.startDate) },
    { Icon: Users, label: "Travellers", value: String(item.travelerCount || 1) },
    { Icon: Clock3, label: "Trip stage", value: tripStageLabel(item) }
  ];
  const factPairs = [
    facts.slice(0, 2),
    facts.slice(2, 4)
  ];

  if (isCompleted) {
    return <CompletedTourCard item={item} onOpen={onOpen} />;
  }

  return (
    <Pressable
      onPress={isExpiredDraft ? onBookAgain : isDraft ? onPay : onOpen}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.cardTop}>
        <View style={styles.cardIcon}>
          <Compass color={colors.primary} size={20} />
        </View>
        <View style={styles.flex}>
          <AppText variant="titleSm" weight="extraBold" numberOfLines={2}>
            {item.title || "Tour package"}
          </AppText>
          <AppText variant="bodySmall" tone="muted" numberOfLines={1}>
            {operatorName(item)}
          </AppText>
        </View>
        <View style={[styles.statusPill, { backgroundColor: meta.tint }]}>
          <AppText variant="caption" weight="bold" style={{ color: meta.color }}>
            {meta.label}
          </AppText>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.factRail}>
        {factPairs.map((pair, index) => (
          <View key={`facts-${index}`} style={[styles.factColumn, { width: detailWidth }]}>
            {pair.map((fact) => (
              <InfoItem key={fact.label} Icon={fact.Icon} label={fact.label} value={fact.value} />
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={styles.cardBottom}>
        {amount > 0 ? (
          <AmountText amount={amount} currency={item.currency || "USD"} variant="titleSm" weight="extraBold" tone="primary" />
        ) : (
          <AppText variant="bodySmall" weight="bold" tone="muted">
            Amount pending
          </AppText>
        )}
        {isExpiredDraft ? (
          <AppButton title="Book again" variant="secondary" onPress={onBookAgain} style={styles.payButton} />
        ) : isDraft ? (
          <AppButton title="Pay now" onPress={onPay} loading={paying} style={styles.payButton} icon={<CreditCard color={colors.white} size={16} />} />
        ) : (
          <View style={styles.openCue}>
            <Search color={colors.primary} size={14} />
            <AppText variant="caption" weight="bold" tone="primary">
              Open
            </AppText>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function CompletedTourCard({ item, onOpen }: { item: CustomerTourBookingSummary; onOpen: () => void }) {
  const ratingCount = Number(item.timelineRatingSummary?.totalRatings || 0);
  const ratingAverage = Number(item.timelineRatingSummary?.averageRating || 0);
  const meetupValidated = Boolean(
    item.pickupValidation?.validated ||
    item.pickupValidation?.validatedAt ||
    item.metadata?.pickupValidationOperator ||
    item.pickupTimeline?.validatedAt
  );
  const completedAt = item.completedAt || item.updatedAt || item.endDate;

  const recommend = () => {
    const title = item.title || "this tour package";
    const destination = item.destination ? ` in ${item.destination}` : "";
    Share.share({
      message: `I completed ${title}${destination} with ${operatorName(item)} on NoLSAF. I recommend checking their approved tour packages.`
    }).catch(() => undefined);
  };

  return (
    <View style={styles.completedCard}>
      <View style={styles.completedTop}>
        <View style={styles.completedMark}>
          <CheckCircle2 color={colors.white} size={22} />
        </View>
        <View style={styles.flex}>
          <AppText variant="titleSm" weight="extraBold" numberOfLines={2}>
            {item.title || "Tour package"}
          </AppText>
          <AppText variant="bodySmall" tone="muted" numberOfLines={1}>
            {operatorName(item)}
          </AppText>
        </View>
        <View style={styles.completedPill}>
          <AppText variant="caption" weight="extraBold" tone="success">
            Total completed
          </AppText>
        </View>
      </View>

      <View style={styles.completedProofGrid}>
        <CompletedMetric Icon={MapPin} label="Destination" value={item.destination || "Not set"} />
        <CompletedMetric Icon={CalendarDays} label="Completed" value={fmtDate(completedAt)} />
        <CompletedMetric Icon={Users} label="Travellers" value={String(item.travelerCount || 1)} />
        <CompletedMetric Icon={CheckCircle2} label="Meetup" value={meetupValidated ? "Validated" : "Not recorded"} tone={meetupValidated ? "success" : "muted"} />
      </View>

      <View style={styles.completedReviewRow}>
        <View style={styles.ratingBox}>
          <View style={styles.ratingIcon}>
            <CheckCircle2 color={colors.warning} size={16} />
          </View>
          <View style={styles.flex}>
            <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
              Traveller rating
            </AppText>
            <AppText variant="bodySmall" weight="extraBold">
              {ratingCount ? `${ratingAverage.toFixed(1)}/5 from ${ratingCount}` : "Waiting for ratings"}
            </AppText>
          </View>
        </View>
        <Pressable accessibilityRole="button" onPress={recommend} style={({ pressed }) => [styles.recommendButton, pressed && styles.filterChipPressed]}>
          <Search color={colors.primary} size={15} />
          <AppText variant="caption" weight="extraBold" tone="primary">
            Recommend
          </AppText>
        </Pressable>
      </View>

      <View style={styles.completedFooter}>
        {item.bookingCode ? (
          <AppText variant="caption" weight="bold" tone="soft" numberOfLines={1}>
            Code {item.bookingCode}
          </AppText>
        ) : null}
        <Pressable accessibilityRole="button" onPress={onOpen} style={styles.completedOpen}>
          <AppText variant="caption" weight="extraBold" tone="primary">
            View record
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

function CompletedMetric({
  Icon,
  label,
  value,
  tone = "default"
}: {
  Icon: typeof CalendarDays;
  label: string;
  value: string;
  tone?: "default" | "success" | "muted";
}) {
  const textTone = tone === "success" ? "success" : tone === "muted" ? "muted" : "default";
  return (
    <View style={styles.completedMetric}>
      <View style={styles.completedMetricIcon}>
        <Icon color={tone === "success" ? colors.success : colors.primary} size={14} />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
          {label}
        </AppText>
        <AppText variant="bodySmall" weight="bold" tone={textTone} numberOfLines={2}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

function InfoItem({ Icon, label, value }: { Icon: typeof CalendarDays; label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <View style={styles.infoIcon}>
        <Icon color={colors.primary} size={14} />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
          {label}
        </AppText>
        <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  screen: { paddingBottom: 0 },
  scrollContent: { paddingBottom: spacing[10], gap: spacing[4] },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    backgroundColor: colors.primaryDeep,
    padding: spacing[4],
    overflow: "hidden"
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)"
  },
  heroText: { flex: 1, minWidth: 0 },
  heroCopy: { color: "rgba(255,255,255,0.78)" },
  filterWrap: {
    marginHorizontal: -spacing[1]
  },
  filterRail: {
    gap: spacing[2],
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[1]
  },
  filterChip: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingLeft: spacing[4],
    paddingRight: spacing[2]
  },
  filterChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  filterChipPressed: {
    transform: [{ scale: 0.98 }]
  },
  filterText: {
    flex: 1,
    minWidth: 0
  },
  countPill: {
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: "#eef4f6",
    paddingHorizontal: spacing[2]
  },
  countPillActive: { backgroundColor: colors.white },
  center: { alignItems: "center", justifyContent: "center", gap: spacing[3], paddingVertical: spacing[8] },
  list: { gap: spacing[4] },
  card: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4],
    ...shadows.card
  },
  pressed: { transform: [{ scale: 0.99 }] },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing[3], minWidth: 0 },
  cardIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  flex: { flex: 1, minWidth: 0 },
  statusPill: { borderRadius: radius.full, paddingHorizontal: spacing[3], paddingVertical: 6 },
  factRail: {
    gap: spacing[2],
    paddingVertical: spacing[1]
  },
  factColumn: {
    gap: spacing[2]
  },
  infoItem: {
    width: "100%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#edf2f7",
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3]
  },
  infoIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  infoLabel: { textTransform: "uppercase", letterSpacing: 0.8 },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    paddingTop: spacing[1]
  },
  payButton: { minHeight: 42, paddingVertical: spacing[2], paddingHorizontal: spacing[3] },
  openCue: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  completedCard: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#bfe8df",
    backgroundColor: colors.white,
    padding: spacing[4],
    ...shadows.card
  },
  completedTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  completedMark: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.success
  },
  completedPill: {
    borderRadius: radius.full,
    backgroundColor: "#e9f7ef",
    paddingHorizontal: spacing[3],
    paddingVertical: 6
  },
  completedProofGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing[2]
  },
  completedMetric: {
    width: "48%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: "#f8fbfa",
    borderWidth: 1,
    borderColor: "#e5f3ef",
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[3]
  },
  completedMetricIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#d8eee9"
  },
  completedReviewRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: spacing[2],
    minWidth: 0
  },
  ratingBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: "#fffaf0",
    borderWidth: 1,
    borderColor: "#fdecc8",
    padding: spacing[3]
  },
  ratingIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white
  },
  recommendButton: {
    minWidth: 112,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3]
  },
  completedFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    paddingTop: spacing[1]
  },
  completedOpen: {
    borderRadius: radius.full,
    backgroundColor: "#eef8f6",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  }
});

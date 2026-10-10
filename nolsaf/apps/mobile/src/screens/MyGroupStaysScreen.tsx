import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Banknote, Calendar, ChevronRight, Clock3, MapPin, Plus, Sparkles, Users } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { AppCard, AppStack, AppText, SafeScreen, ScreenHeader, StateView, StatusBadge } from "../components";
import { ACCOMMODATION_TYPE_OPTIONS, fetchMyGroupBookings, GROUP_TYPE_OPTIONS, GroupBookingListItem } from "../groupStays";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "MyGroupStays">;

/** Four groups so the switch reads on one line: still open, confirmed, and finished either way. */
type FilterKey = "all" | "open" | "confirmed" | "past";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "confirmed", label: "Confirmed" },
  { key: "past", label: "Past" }
];

const OPEN = ["PENDING", "AWAITING_DEPOSIT"];
const CONFIRMED = ["CONFIRMED", "PROCESSING"];
const PAST = ["COMPLETED", "CANCELED", "CANCELLED", "EXPIRED"];

function labelFor(options: { value: string; label: string }[], value: string) {
  return options.find((o) => o.value === value)?.label || value;
}

function toBadgeStatus(status: string): "pending" | "approved" | "completed" | "cancelled" | "awaiting" {
  const s = status.toUpperCase();
  if (s === "AWAITING_DEPOSIT") return "awaiting";
  if (s === "CONFIRMED" || s === "PROCESSING") return "approved";
  if (s === "COMPLETED") return "completed";
  if (s === "CANCELED" || s === "CANCELLED" || s === "EXPIRED") return "cancelled";
  return "pending";
}

function badgeLabel(status: string): string | undefined {
  const s = status.toUpperCase();
  if (s === "AWAITING_DEPOSIT") return "Deposit due";
  if (s === "EXPIRED") return "Expired";
  return undefined;
}

function matchesFilter(status: string, filter: FilterKey) {
  const s = status.toUpperCase();
  if (filter === "open") return OPEN.includes(s);
  if (filter === "confirmed") return CONFIRMED.includes(s);
  if (filter === "past") return PAST.includes(s);
  return true;
}

function formatDates(checkIn?: string | null, checkOut?: string | null, useDates?: boolean) {
  if (!useDates || !checkIn || !checkOut) return "Dates flexible";
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
  };
  return `${fmt(checkIn)} → ${fmt(checkOut)}`;
}

function formatAmount(amount?: number | null, currency?: string | null) {
  if (!amount) return null;
  return `${Number(amount).toLocaleString()} ${currency || "TZS"}`;
}

function formatDueCountdown(ms: number): string {
  if (ms <= 0) return "Offer expired";
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `Expires in ${hours}h ${minutes}m`;
  return `Expires in ${minutes}m`;
}

export function MyGroupStaysScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [items, setItems] = useState<GroupBookingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!token) {
      setError("Please sign in to view your group stay requests.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMyGroupBookings(token, { page: 1, pageSize: 20 });
      setItems(response.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load your group stay requests.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const of = (list: string[]) => items.filter((b) => list.includes(b.status.toUpperCase())).length;
    return {
      all: items.length,
      open: of(OPEN),
      confirmed: of(CONFIRMED),
      past: of(PAST),
      depositDue: of(["AWAITING_DEPOSIT"]),
      waiting: of(["PENDING"])
    };
  }, [items]);

  // The one line worth reading first: what needs the traveller, else where things stand.
  const headline =
    counts.depositDue > 0
      ? { text: `${counts.depositDue === 1 ? "1 offer is" : `${counts.depositDue} offers are`} waiting for your deposit`, alert: true }
      : counts.waiting > 0
        ? { text: `${counts.waiting === 1 ? "1 request is" : `${counts.waiting} requests are`} with our team for offers`, alert: false }
        : counts.confirmed > 0
          ? { text: `${counts.confirmed === 1 ? "1 group stay is" : `${counts.confirmed} group stays are`} confirmed`, alert: false }
          : null;

  const visibleItems = useMemo(() => items.filter((b) => matchesFilter(b.status, filter)), [items, filter]);

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
          <ScreenHeader title="My group stays" onBack={() => navigation.goBack()} />

          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.heroIcon}>
                <Users color={colors.white} size={20} />
              </View>
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="extraBold" tone="inverse">
                  Group stay requests
                </AppText>
                <AppText variant="caption" style={styles.heroSub}>
                  Tell us about your group, we gather offers, you confirm with a deposit.
                </AppText>
              </View>
            </View>
            {headline ? (
              <View style={[styles.heroNote, headline.alert && styles.heroNoteAlert]}>
                <View style={[styles.heroDot, headline.alert && styles.heroDotAlert]} />
                <AppText variant="caption" weight="bold" style={headline.alert ? styles.heroNoteAlertText : styles.heroSub}>
                  {headline.text}
                </AppText>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate("GroupStayRequest")}
              style={({ pressed }) => [styles.newRequest, pressed && styles.cardPressed]}
            >
              <Plus color={colors.primaryDeep} size={17} strokeWidth={2.5} />
              <AppText variant="bodySmall" weight="extraBold" style={styles.newRequestText}>
                New group request
              </AppText>
            </Pressable>
          </View>

          {!loading && !error && items.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <AppText variant="titleSm" weight="extraBold">
                  Your requests
                </AppText>
                <AppText variant="caption" tone="soft">
                  {counts.all} {counts.all === 1 ? "request" : "requests"}
                </AppText>
              </View>

              <View style={styles.segment}>
                {FILTERS.map((f) => {
                  const active = filter === f.key;
                  return (
                    <Pressable
                      key={f.key}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: active }}
                      onPress={() => setFilter(f.key)}
                      style={[styles.segmentItem, active && styles.segmentItemActive]}
                    >
                      <AppText variant="caption" weight={active ? "extraBold" : "semiBold"} tone={active ? "primary" : "soft"} numberOfLines={1}>
                        {f.label}
                      </AppText>
                      <AppText variant="caption" weight="bold" tone={active ? "primary" : "soft"} style={styles.segmentCount}>
                        {counts[f.key]}
                      </AppText>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="bodySmall" tone="muted">
                Loading your group stay requests...
              </AppText>
            </View>
          ) : error ? (
            <StateView title="Could not load your group stay requests" message={error} actionLabel="Try again" onAction={load} />
          ) : items.length === 0 ? (
            <StateView
              title="You don't have any group stay bookings"
              message="Plan a trip for your family, team or group and we will line up accommodation offers for you. Please book now."
              actionLabel="Request a group stay"
              onAction={() => navigation.navigate("GroupStayRequest")}
            />
          ) : visibleItems.length === 0 ? (
            <StateView title="No group stays in this filter" message="Try a different filter to see your other requests." />
          ) : (
            <AppStack gap={3}>
              {visibleItems.map((booking) => {
                const offerCount = booking.recommendedPropertyIds?.length || 0;
                const hasOffers = Boolean(booking.isOpenForClaims) && offerCount > 0 && !booking.confirmedPropertyId;
                const amount = formatAmount(booking.totalAmount, booking.currency);
                const isAwaitingDeposit = booking.status.toUpperCase() === "AWAITING_DEPOSIT" && !booking.depositPaid;
                const depositLabel = formatAmount(booking.depositAmount, booking.currency);
                const depositDueAt = booking.depositDueAt ? new Date(booking.depositDueAt).getTime() : null;
                const msUntilDepositDue = depositDueAt ? depositDueAt - now : null;
                return (
                  <Pressable
                    key={booking.id}
                    accessibilityRole="button"
                    onPress={() => navigation.navigate("GroupStayDetail", { id: booking.id, ref: booking.groupStayReference })}
                    style={({ pressed }) => [pressed && styles.cardPressed]}
                  >
                    <AppCard>
                      <AppStack gap={3}>
                        <View style={styles.headerRow}>
                          <View style={styles.destinationRow}>
                            <View style={styles.destinationIconWrap}>
                              <MapPin color={colors.primary} size={16} />
                            </View>
                            <AppText variant="bodySmall" weight="bold" style={styles.flex} numberOfLines={1}>
                              {[booking.toRegion, booking.toDistrict].filter(Boolean).join(", ") || "Destination pending"}
                            </AppText>
                          </View>
                          <StatusBadge status={toBadgeStatus(booking.status)} label={badgeLabel(booking.status)} />
                        </View>

                        <View style={styles.metaRow}>
                          <Users color={colors.softText} size={14} />
                          <AppText variant="caption" tone="soft" style={styles.flex} numberOfLines={1}>
                            {labelFor(GROUP_TYPE_OPTIONS, booking.groupType)} · {labelFor(ACCOMMODATION_TYPE_OPTIONS, booking.accommodationType)} ·{" "}
                            {booking.headcount} {booking.headcount === 1 ? "person" : "people"}
                          </AppText>
                        </View>
                        <View style={styles.metaRow}>
                          <Calendar color={colors.softText} size={14} />
                          <AppText variant="caption" tone="soft">
                            {formatDates(booking.checkIn, booking.checkOut, booking.useDates)}
                          </AppText>
                        </View>

                        {hasOffers ? (
                          <View style={styles.offerBanner}>
                            <View style={styles.offerBannerIconWrap}>
                              <Sparkles color={colors.primary} size={16} />
                            </View>
                            <View style={styles.flex}>
                              <AppText variant="caption" weight="extraBold" tone="primary">
                                {offerCount} {offerCount === 1 ? "offer" : "offers"} ready to review
                              </AppText>
                              <AppText variant="caption" tone="muted">
                                Property owners responded to your request. Compare and choose one.
                              </AppText>
                            </View>
                            <ChevronRight color={colors.primary} size={16} />
                          </View>
                        ) : null}
                        {isAwaitingDeposit ? (
                          <Pressable
                            accessibilityRole="button"
                            onPress={() => navigation.navigate("GroupStayDeposit", { id: booking.id, ref: booking.groupStayReference })}
                            style={styles.depositBanner}
                          >
                            <View style={styles.depositBannerIconWrap}>
                              <Banknote color="#b45309" size={16} />
                            </View>
                            <View style={styles.flex}>
                              <AppText variant="caption" weight="extraBold" style={styles.depositText}>
                                {depositLabel ? `Pay ${depositLabel} deposit to confirm` : "Deposit required to confirm"}
                              </AppText>
                              <AppText variant="caption" tone="muted">
                                Pay this deposit now to secure your offer with this property.
                              </AppText>
                              {msUntilDepositDue != null ? (
                                <View style={styles.dueRow}>
                                  <Clock3 color={msUntilDepositDue < 3 * 60 * 60 * 1000 ? colors.danger : "#b45309"} size={12} />
                                  <AppText variant="caption" weight="bold" tone={msUntilDepositDue < 3 * 60 * 60 * 1000 ? "danger" : "warning"}>
                                    {formatDueCountdown(msUntilDepositDue)}
                                  </AppText>
                                </View>
                              ) : null}
                            </View>
                            <ChevronRight color="#b45309" size={16} />
                          </Pressable>
                        ) : null}
                        {booking.adminNotes ? (
                          <AppText variant="caption" tone="muted" numberOfLines={2}>
                            Note from NoLSAF: {booking.adminNotes}
                          </AppText>
                        ) : null}

                        <View style={styles.cardFooter}>
                          {amount ? (
                            <AppText variant="bodySmall" weight="extraBold" tone="primary">
                              {amount}
                            </AppText>
                          ) : hasOffers ? (
                            <AppText variant="caption" weight="bold" tone="primary">
                              Offers waiting for you
                            </AppText>
                          ) : (
                            <AppText variant="caption" tone="muted">
                              Estimate pending
                            </AppText>
                          )}
                          <View style={styles.viewDetails}>
                            <AppText variant="caption" weight="bold" tone="primary">
                              View details
                            </AppText>
                            <ChevronRight color={colors.primary} size={16} />
                          </View>
                        </View>
                      </AppStack>
                    </AppCard>
                  </Pressable>
                );
              })}
            </AppStack>
          )}
        </AppStack>
      </SafeScreen>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  screen: { gap: spacing[5] },
  flex: { flex: 1, minWidth: 0 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], justifyContent: "space-between" },
  destinationRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], flex: 1, minWidth: 0 },
  destinationIconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[3]
  },
  viewDetails: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  cardPressed: { opacity: 0.7 },
  loading: { alignItems: "center", gap: spacing[2], paddingVertical: spacing[8] },
  section: {
    gap: spacing[3]
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: spacing[2],
    paddingHorizontal: 2
  },
  segment: {
    flexDirection: "row",
    borderRadius: radius.lg,
    backgroundColor: colors.brand[50],
    padding: 4,
    gap: 4
  },
  segmentItem: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: radius.md,
    paddingVertical: spacing[2],
    paddingHorizontal: 2
  },
  segmentItemActive: {
    backgroundColor: colors.white,
    ...shadows.card
  },
  segmentCount: {
    opacity: 0.8
  },
  hero: {
    gap: spacing[4],
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    padding: spacing[5]
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3]
  },
  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)"
  },
  heroSub: {
    color: colors.brand[200],
    marginTop: 2
  },
  heroNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  heroNoteAlert: {
    backgroundColor: "rgba(252,211,77,0.14)"
  },
  heroNoteAlertText: {
    color: "#fcd34d"
  },
  heroDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.brand[200]
  },
  heroDotAlert: {
    backgroundColor: "#fcd34d"
  },
  newRequest: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    paddingVertical: spacing[3]
  },
  newRequestText: {
    color: colors.primaryDeep
  },
  offerBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  offerBannerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white
  },
  depositBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  depositBannerIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white
  },
  depositText: {
    color: "#b45309"
  },
  dueRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginTop: spacing[1]
  }
});

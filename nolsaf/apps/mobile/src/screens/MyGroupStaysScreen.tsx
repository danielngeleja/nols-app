import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Activity, Banknote, Calendar, ChevronRight, CircleCheck, CircleX, Clock, Clock3, ListChecks, MapPin, Plus, Sparkles, Users } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";

import { useAuth } from "../auth";
import { AppCard, AppStack, AppText, SafeScreen, ScreenHeader, StateView, StatusBadge } from "../components";
import { ACCOMMODATION_TYPE_OPTIONS, fetchMyGroupBookings, GROUP_TYPE_OPTIONS, GroupBookingListItem } from "../groupStays";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "MyGroupStays">;

type FilterKey = "all" | "pending" | "active" | "completed" | "cancelled";

const FILTERS: { key: FilterKey; label: string; icon: LucideIcon }[] = [
  { key: "all", label: "All", icon: ListChecks },
  { key: "pending", label: "Pending", icon: Clock },
  { key: "active", label: "Active", icon: Activity },
  { key: "completed", label: "Completed", icon: CircleCheck },
  { key: "cancelled", label: "Cancelled", icon: CircleX }
];

const STAT_CARDS: { key: "total" | "active" | "pending"; label: string; icon: LucideIcon }[] = [
  { key: "total", label: "Total", icon: ListChecks },
  { key: "active", label: "Active", icon: Activity },
  { key: "pending", label: "Pending", icon: Clock }
];

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
  if (filter === "all") return true;
  if (filter === "pending") return s === "PENDING" || s === "AWAITING_DEPOSIT";
  if (filter === "active") return s === "CONFIRMED" || s === "PROCESSING";
  if (filter === "completed") return s === "COMPLETED";
  if (filter === "cancelled") return s === "CANCELED" || s === "CANCELLED" || s === "EXPIRED";
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
    const total = items.length;
    const pending = items.filter((b) => ["PENDING", "AWAITING_DEPOSIT"].includes(b.status.toUpperCase())).length;
    const active = items.filter((b) => ["CONFIRMED", "PROCESSING"].includes(b.status.toUpperCase())).length;
    const completed = items.filter((b) => b.status.toUpperCase() === "COMPLETED").length;
    const cancelled = items.filter((b) => ["CANCELED", "CANCELLED", "EXPIRED"].includes(b.status.toUpperCase())).length;
    return { all: total, total, pending, active, completed, cancelled };
  }, [items]);

  const visibleItems = useMemo(() => items.filter((b) => matchesFilter(b.status, filter)), [items, filter]);

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
          <ScreenHeader
            title="My group stay"
            subtitle="Track the group stay requests you have sent us."
            onBack={() => navigation.goBack()}
            action={
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate("GroupStayRequest")} style={styles.newButton}>
                <Plus color={colors.white} size={20} />
              </Pressable>
            }
          />

          {!loading && !error && items.length > 0 ? (
            <View style={styles.statsRow}>
              {STAT_CARDS.map(({ key, label, icon: Icon }) => (
                <View key={key} style={styles.statChip}>
                  <View style={styles.statIconWrap}>
                    <Icon color={colors.primary} size={18} />
                  </View>
                  <AppText variant="titleSm" weight="extraBold" tone="primary">
                    {counts[key]}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {label}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}

          {!loading && !error && items.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
              {FILTERS.map((f) => {
                const active = filter === f.key;
                const Icon = f.icon;
                return (
                  <Pressable
                    key={f.key}
                    accessibilityRole="button"
                    onPress={() => setFilter(f.key)}
                    style={[styles.filterPill, active && styles.filterPillActive]}
                  >
                    <Icon color={active ? colors.white : colors.softText} size={14} />
                    <AppText variant="caption" weight="bold" tone={active ? "inverse" : "muted"}>
                      {f.label}
                    </AppText>
                    <View style={[styles.filterCount, active && styles.filterCountActive]}>
                      <AppText variant="caption" weight="extraBold" tone={active ? "primary" : "muted"} style={styles.filterCountText}>
                        {counts[f.key]}
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
                    onPress={() => navigation.navigate("GroupStayDetail", { id: booking.id })}
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
                            onPress={() => navigation.navigate("GroupStayDeposit", { id: booking.id })}
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
  newButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  statsRow: {
    flexDirection: "row",
    gap: spacing[2]
  },
  statChip: {
    flex: 1,
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingVertical: spacing[4]
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    marginBottom: spacing[1]
  },
  filterRow: {
    gap: spacing[2],
    paddingRight: spacing[4]
  },
  filterPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  filterPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  filterCount: {
    minWidth: 20,
    height: 20,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[1],
    backgroundColor: colors.surface
  },
  filterCountActive: {
    backgroundColor: colors.white
  },
  filterCountText: {
    lineHeight: 14
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

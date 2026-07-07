import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { LucideIcon } from "lucide-react-native";
import { Activity, Ban, BedDouble, BookOpen, Calendar, CalendarCheck, ChevronRight, Clock, FileText, ListChecks, MapPin } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { BookingListItem, fetchMyBookings } from "../bookings";
import { AppCard, AppStack, AppText, CodeText, CustomerBottomNav, GetThereSection, SafeScreen, StateView, StatusBadge } from "../components";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "MyBookings">;

type BadgeStatus = "paid" | "pending" | "completed" | "cancelled" | "approved";
type FilterKey = "all" | "active" | "past" | "draft";

const FILTERS: { key: FilterKey; label: string; icon: LucideIcon }[] = [
  { key: "all", label: "All", icon: ListChecks },
  { key: "active", label: "Active", icon: Activity },
  { key: "past", label: "Past", icon: Clock },
  { key: "draft", label: "Draft", icon: FileText }
];

const STATS: { key: "total" | "active" | "draft"; label: string; icon: LucideIcon }[] = [
  { key: "total", label: "Bookings", icon: BookOpen },
  { key: "active", label: "Active", icon: Activity },
  { key: "draft", label: "Draft", icon: FileText }
];

function toBadgeStatus(booking: BookingListItem): BadgeStatus {
  const status = String(booking.status || "").toUpperCase();
  if (status === "CANCELED" || status === "CANCELLED") return "cancelled";
  if (status === "CHECKED_OUT") return "completed";
  if (booking.isPaid) return "paid";
  if (booking.dashboardBucket === "DRAFT") return "pending";
  return "approved";
}

function isDraftBooking(booking: BookingListItem) {
  return booking.dashboardBucket === "DRAFT";
}

function isPastStay(booking: BookingListItem) {
  if (isDraftBooking(booking) || !booking.checkOut) return false;
  const checkOut = new Date(booking.checkOut);
  if (Number.isNaN(checkOut.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  checkOut.setHours(0, 0, 0, 0);
  return checkOut.getTime() < today.getTime();
}

function matchesFilter(booking: BookingListItem, filter: FilterKey) {
  if (filter === "all") return true;
  if (filter === "draft") return isDraftBooking(booking);
  if (isDraftBooking(booking)) return false;
  if (filter === "past") return isPastStay(booking);
  if (filter === "active") return !isPastStay(booking);
  return true;
}

function formatDates(checkIn: string | null, checkOut: string | null) {
  if (!checkIn || !checkOut) return "Dates pending";
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric"
        });
  };
  return `${fmt(checkIn)} -> ${fmt(checkOut)}`;
}

function formatAmount(amount: number | null) {
  if (amount == null) return null;
  return `${Number(amount).toLocaleString()} TZS`;
}

function draftPayability(booking: BookingListItem) {
  if (!isDraftBooking(booking)) return { canPay: false, reason: null as string | null };
  const expired = String(booking.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
  if (expired) return { canPay: false, reason: "Payment session expired. Start a fresh booking for this stay." };
  if (booking.draftAvailability && !booking.draftAvailability.available) {
    return { canPay: false, reason: booking.draftAvailability.message || "This room is no longer available." };
  }
  if (!booking.invoiceId || !booking.invoiceAccessToken) {
    return { canPay: false, reason: "Payment session is not available. Please start this booking again." };
  }
  return { canPay: true, reason: null };
}

function stayStage(booking: BookingListItem) {
  if (isDraftBooking(booking)) {
    const payability = draftPayability(booking);
    const expired = String(booking.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
    const unavailable = Boolean(booking.draftAvailability && !booking.draftAvailability.available);
    return {
      title: expired ? "Payment expired" : unavailable ? "Room unavailable" : "Draft stay",
      detail: payability.canPay ? "Tap to continue payment in the app and confirm this stay." : payability.reason || "This draft needs attention before payment.",
      status: expired || unavailable ? ("cancelled" as BadgeStatus) : ("pending" as BadgeStatus),
      label: expired ? "Expired" : unavailable ? "Unavailable" : "Draft",
      actionLabel: payability.canPay ? "Pay now" : expired ? "Session expired" : "Unavailable",
      iconColor: expired || unavailable ? colors.danger : "#b45309",
      bg: expired || unavailable ? "#fee2e2" : "#fffbeb",
      border: expired || unavailable ? "#fecaca" : "#fde68a",
      canPress: payability.canPay
    };
  }
  if (isPastStay(booking)) {
    return {
      title: "Past stay",
      detail: "This stay has passed. Keep the booking code for your records.",
      status: "completed" as BadgeStatus,
      label: "Past",
      actionLabel: "Record saved",
      iconColor: colors.softText,
      bg: "#f8fafc",
      border: colors.border,
      canPress: false
    };
  }
  return {
    title: "Active stay",
    detail: booking.isPaid ? "Confirmed stay. Tap to add NoLSAF transport for door-to-door pickup." : "Stay is waiting for confirmation.",
    status: booking.isPaid ? ("paid" as BadgeStatus) : ("approved" as BadgeStatus),
    label: booking.isPaid ? "Active" : "Pending",
    actionLabel: booking.isPaid ? "Add transport" : "Pending",
    iconColor: colors.primary,
    bg: colors.brand[50],
    border: colors.brand[100],
    canPress: booking.isPaid
  };
}

export function MyBookingsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [items, setItems] = useState<BookingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  const load = useCallback(async () => {
    if (!token) {
      setError("Please sign in to view your bookings.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMyBookings(token, { page: 1, pageSize: 20 });
      setItems(response.items || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load bookings.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const counts = useMemo(() => {
    const draft = items.filter(isDraftBooking).length;
    const paidStays = items.filter((item) => !isDraftBooking(item));
    const past = paidStays.filter(isPastStay).length;
    const active = paidStays.filter((item) => !isPastStay(item)).length;
    return { all: items.length, total: items.length, active, past, draft };
  }, [items]);

  const visibleItems = useMemo(() => items.filter((item) => matchesFilter(item, filter)), [filter, items]);

  const openBookingAction = useCallback(
    (booking: BookingListItem) => {
      const title = booking.property?.title || "NoLSAF stay";
      const area = [booking.property?.regionName, booking.property?.district, booking.property?.city].filter(Boolean).join(", ");
      if (isDraftBooking(booking)) {
        const payability = draftPayability(booking);
        if (payability.canPay && booking.invoiceId && booking.invoiceAccessToken) {
          navigation.navigate("BookingPayment", { invoiceId: booking.invoiceId, accessToken: booking.invoiceAccessToken });
        }
        return;
      }
      if (booking.isPaid && !isPastStay(booking)) {
        navigation.navigate("AddTransport", {
          bookingId: booking.id,
          mode: "scheduled",
          propertyId: booking.property?.id ?? null,
          propertyTitle: title,
          propertyArea: area
        });
      }
    },
    [navigation]
  );

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
          <View style={styles.hero}>
            <View style={styles.heroIconWrap}>
              <BookOpen color={colors.white} size={26} />
            </View>
            <View style={styles.heroTitleRow}>
              <AppText variant="headline" weight="extraBold" tone="inverse">
                My Stay
              </AppText>
              {items.length > 0 ? (
                <View style={styles.heroCount}>
                  <View style={styles.heroCountDot} />
                  <AppText variant="caption" weight="extraBold" tone="inverse">
                    {items.length} {items.length === 1 ? "booking" : "bookings"}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText variant="bodySmall" style={styles.heroSubtitle}>
              View confirmed stays, draft payments, past bookings, and transport options in one place.
            </AppText>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.primary} />
              <AppText variant="bodySmall" tone="muted">
                Loading your bookings...
              </AppText>
            </View>
          ) : error ? (
            <StateView title="Could not load bookings" message={error} actionLabel="Try again" onAction={load} />
          ) : items.length === 0 ? (
            <StateView
              title="No bookings yet"
              message="Book a verified stay first. Transport is offered on your booked stays, because NoLSAF brings you to them."
              actionLabel="Browse verified stays"
              onAction={() => navigation.navigate("VerifiedStays")}
            />
          ) : (
            <AppStack gap={5}>
              <View style={styles.statsRow}>
                {STATS.map(({ key, label, icon: Icon }) => (
                  <View key={key} style={styles.statChip}>
                    <View style={styles.statIconWrap}>
                      <Icon color={colors.primary} size={17} />
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

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
                {FILTERS.map(({ key, label, icon: Icon }) => {
                  const active = filter === key;
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="button"
                      onPress={() => setFilter(key)}
                      style={[styles.filterPill, active && styles.filterPillActive]}
                    >
                      <Icon color={active ? colors.white : colors.softText} size={14} />
                      <AppText variant="caption" weight="bold" tone={active ? "inverse" : "muted"}>
                        {label}
                      </AppText>
                      <View style={[styles.filterCount, active && styles.filterCountActive]}>
                        <AppText variant="caption" weight="extraBold" tone={active ? "primary" : "muted"} style={styles.filterCountText}>
                          {counts[key]}
                        </AppText>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>

              {visibleItems.length === 0 ? (
                <StateView title="No stays in this view" message="Try a different filter to see the rest of your bookings." />
              ) : null}

              {visibleItems.map((booking) => {
                const stage = stayStage(booking);
                const badge = toBadgeStatus(booking);
                const title = booking.property?.title || "NoLSAF stay";
                const area = [booking.property?.regionName, booking.property?.district, booking.property?.city].filter(Boolean).join(", ");
                const amount = formatAmount(booking.totalAmount);
                const canOpen = stage.canPress;
                return (
                  <AppStack key={booking.id} gap={3}>
                    <Pressable
                      accessibilityRole={canOpen ? "button" : undefined}
                      disabled={!canOpen}
                      onPress={() => openBookingAction(booking)}
                      style={({ pressed }) => [pressed && styles.cardPressed]}
                    >
                      <AppCard style={[styles.bookingCard, { borderColor: stage.border }]}>
                        <AppStack gap={3}>
                          <View style={styles.cardTopRow}>
                            <View style={styles.titleCluster}>
                              <View style={[styles.iconWrap, { backgroundColor: stage.bg }]}>
                                <CalendarCheck color={stage.iconColor} size={21} />
                              </View>
                              <View style={styles.flex}>
                                <AppText variant="caption" weight="extraBold" style={{ color: stage.iconColor }}>
                                  {stage.title}
                                </AppText>
                                <AppText variant="titleSm" weight="bold" numberOfLines={2}>
                                  {title}
                                </AppText>
                              </View>
                            </View>
                            <StatusBadge status={stage.status || badge} label={stage.label} />
                          </View>

                          {area ? (
                            <View style={styles.metaRow}>
                              <MapPin color={colors.softText} size={14} />
                              <AppText variant="bodySmall" tone="muted" numberOfLines={2} style={styles.flex}>
                                {area}
                              </AppText>
                            </View>
                          ) : null}

                          <View style={styles.classificationBox}>
                            <View style={styles.classificationRow}>
                              <Calendar color={colors.primary} size={14} />
                              <AppText variant="caption" weight="bold" tone="primary" style={styles.flex}>
                                {formatDates(booking.checkIn, booking.checkOut)}
                              </AppText>
                            </View>
                            <View style={styles.classificationRow}>
                              <BedDouble color={colors.softText} size={14} />
                              <AppText variant="caption" tone="muted" style={styles.flex}>
                                {stage.detail}
                              </AppText>
                            </View>
                          </View>

                          {booking.bookingCode ? <CodeText value={booking.bookingCode} /> : null}

                          <View style={styles.cardFooter}>
                            <AppText variant="bodySmall" weight="extraBold" tone={amount ? "primary" : "muted"}>
                              {amount || "Amount pending"}
                            </AppText>
                            <View style={styles.footerHint}>
                              <AppText
                                variant="caption"
                                weight="bold"
                                tone={isDraftBooking(booking) && !stage.canPress ? "danger" : isDraftBooking(booking) ? "warning" : isPastStay(booking) ? "muted" : "primary"}
                              >
                                {stage.actionLabel}
                              </AppText>
                              {stage.canPress ? <ChevronRight color={isDraftBooking(booking) ? "#b45309" : colors.primary} size={14} /> : null}
                            </View>
                          </View>
                        </AppStack>
                      </AppCard>
                    </Pressable>

                    {booking.isPaid && !isPastStay(booking) ? (
                      <View style={styles.transportWrap}>
                        <GetThereSection
                          booking={{
                            bookingId: booking.id,
                            propertyId: booking.property?.id ?? null,
                            propertyTitle: title,
                            propertyArea: area
                          }}
                        />
                      </View>
                    ) : !booking.isPaid && !isPastStay(booking) && draftPayability(booking).canPay ? (
                      <AppText variant="caption" tone="muted" style={styles.gateNote}>
                        Complete payment for this stay to add NoLSAF transport.
                      </AppText>
                    ) : null}

                    {booking.isPaid && !isPastStay(booking) && booking.bookingCode ? (
                      <Pressable
                        accessibilityRole="button"
                        onPress={() =>
                          navigation.navigate("CancelBooking", { bookingCode: booking.bookingCode as string, propertyTitle: title })
                        }
                        style={({ pressed }) => [styles.cancelRow, pressed && styles.cardPressed]}
                      >
                        <Ban color={colors.danger} size={14} />
                        <AppText variant="caption" weight="bold" tone="danger">
                          Cancel booking
                        </AppText>
                      </Pressable>
                    ) : null}
                  </AppStack>
                );
              })}
            </AppStack>
          )}
        </AppStack>
      </SafeScreen>

      <CustomerBottomNav active="MyBookings" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  screen: {
    paddingBottom: spacing[8]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  hero: {
    alignItems: "center",
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[6],
    overflow: "hidden"
  },
  heroIconWrap: {
    width: 54,
    height: 54,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    marginBottom: spacing[3]
  },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  heroCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  heroCountDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.brand[300]
  },
  heroSubtitle: {
    color: colors.brand[200],
    textAlign: "center",
    marginTop: spacing[2]
  },
  loading: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    padding: spacing[6]
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
  bookingCard: {
    borderLeftWidth: 3
  },
  cardPressed: {
    opacity: 0.72
  },
  cardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing[3]
  },
  titleCluster: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  iconWrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  classificationBox: {
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  classificationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[3]
  },
  footerHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  transportWrap: {
    borderLeftWidth: 2,
    borderLeftColor: colors.brand[100],
    paddingLeft: spacing[3]
  },
  gateNote: {
    paddingLeft: spacing[1]
  },
  cancelRow: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  }
});

import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import type { LucideIcon } from "lucide-react-native";
import {
  Activity,
  Ban,
  BedDouble,
  BookOpen,
  Calendar,
  CalendarCheck,
  CarFront,
  ChevronRight,
  Clock,
  CreditCard,
  FileText,
  ListChecks,
  MapPin,
  Sparkles,
  TicketsPlane,
  UsersRound
} from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { BookingListItem, fetchMyBookings } from "../bookings";
import { AppCard, AppStack, AppText, CodeText, CustomerBottomNav, GetThereSection, SafeScreen, ShareTripButton, StateView, StatusBadge } from "../components";
import { fetchMyGroupBookings } from "../groupStays";
import { RootStackParamList } from "../navigation/types";
import { fetchCustomerTourBookings } from "../tours";
import { fetchMyRides } from "../transport";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "MyBookings">;

type BadgeStatus = "paid" | "pending" | "completed" | "cancelled" | "approved";
type FilterKey = "all" | "active" | "past" | "draft";
type ServiceCounts = { tours: number | null; groups: number | null; rides: number | null };

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

function activeCountLabel(count: number | null, loading: boolean) {
  if (loading && count == null) return "Checking...";
  if (count == null) return "Open service";
  if (count === 0) return "Ready when you are";
  return `${count} active`;
}

function ServiceShortcut({
  title,
  description,
  cue,
  icon: Icon,
  accent,
  tint,
  onPress
}: {
  title: string;
  description: string;
  cue: string;
  icon: LucideIcon;
  accent: string;
  tint: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${description}. ${cue}`}
      onPress={onPress}
      style={({ pressed }) => [styles.serviceTile, pressed && styles.serviceTilePressed]}
    >
      <View style={styles.serviceTileTop}>
        <View style={[styles.serviceIcon, { backgroundColor: tint }]}>
          <Icon color={accent} size={20} strokeWidth={2.2} />
        </View>
        <View style={[styles.serviceArrow, { borderColor: tint }]}>
          <ChevronRight color={accent} size={15} strokeWidth={2.5} />
        </View>
      </View>
      <AppText variant="body" weight="extraBold" numberOfLines={1}>
        {title}
      </AppText>
      <AppText variant="caption" tone="muted" numberOfLines={2} style={styles.serviceDescription}>
        {description}
      </AppText>
      <View style={[styles.serviceCue, { backgroundColor: tint }]}>
        <View style={[styles.serviceCueDot, { backgroundColor: accent }]} />
        <AppText variant="caption" weight="bold" style={{ color: accent }} numberOfLines={1}>
          {cue}
        </AppText>
      </View>
    </Pressable>
  );
}

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
  if (!isDraftBooking(booking)) return { canPay: false };
  const expired = String(booking.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
  if (expired) return { canPay: false };
  if (booking.draftAvailability && !booking.draftAvailability.available) {
    return { canPay: false };
  }
  if (!booking.invoiceId || !booking.invoiceAccessToken) {
    return { canPay: false };
  }
  return { canPay: true };
}

function stayStage(booking: BookingListItem) {
  if (isDraftBooking(booking)) {
    const payability = draftPayability(booking);
    const expired = String(booking.draftExpiryStatus || "").toUpperCase() === "EXPIRED";
    const unavailable = Boolean(booking.draftAvailability && !booking.draftAvailability.available);
    return {
      title: "Draft stay",
      detail: payability.canPay
        ? "Complete payment to confirm this stay."
        : expired
          ? "Choose new available dates to book this property again."
          : unavailable
            ? "Your previous selection is unavailable. Choose new dates or another room."
            : "Start a fresh booking with the latest availability and price.",
      status: expired || unavailable ? ("cancelled" as BadgeStatus) : ("pending" as BadgeStatus),
      label: expired ? "Expired" : unavailable ? "Update needed" : payability.canPay ? "Payment due" : "Restart",
      actionLabel: payability.canPay ? "Pay now" : "Re-book",
      iconColor: expired || unavailable ? colors.danger : "#b45309",
      bg: expired || unavailable ? "#fee2e2" : "#fffbeb",
      border: expired || unavailable ? "#fecaca" : "#fde68a",
      canPress: payability.canPay || Boolean(booking.property?.id),
      action: payability.canPay ? ("pay" as const) : ("rebook" as const)
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
      canPress: false,
      action: null
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
    canPress: booking.isPaid,
    action: booking.isPaid ? ("transport" as const) : null
  };
}

export function MyBookingsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [items, setItems] = useState<BookingListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [serviceCounts, setServiceCounts] = useState<ServiceCounts>({ tours: null, groups: null, rides: null });
  const [serviceCountsLoading, setServiceCountsLoading] = useState(true);

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

  const loadServiceCounts = useCallback(async () => {
    if (!token) {
      setServiceCounts({ tours: null, groups: null, rides: null });
      setServiceCountsLoading(false);
      return;
    }

    setServiceCountsLoading(true);
    const [tourResult, groupResult, rideResult] = await Promise.allSettled([
      fetchCustomerTourBookings(token, { page: 1, pageSize: 50 }),
      fetchMyGroupBookings(token, { page: 1, pageSize: 50 }),
      fetchMyRides(token, { page: 1, pageSize: 50 })
    ]);

    setServiceCounts((current) => ({
      tours:
        tourResult.status === "fulfilled"
          ? (tourResult.value.items || []).filter((booking) => {
              const status = String(booking.status || "").toUpperCase();
              const bucket = String(booking.dashboardBucket || "").toUpperCase();
              return bucket !== "COMPLETED" && !["CANCELED", "CANCELLED", "COMPLETED", "EXPIRED"].includes(status);
            }).length
          : current.tours,
      groups:
        groupResult.status === "fulfilled"
          ? (groupResult.value.data || []).filter(
              (booking) => !["CANCELED", "CANCELLED", "COMPLETED", "EXPIRED"].includes(String(booking.status || "").toUpperCase())
            ).length
          : current.groups,
      rides:
        rideResult.status === "fulfilled" ? (rideResult.value.items || []).filter((ride) => ride.isValid).length : current.rides
    }));
    setServiceCountsLoading(false);
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
      void loadServiceCounts();
    }, [load, loadServiceCounts])
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
        } else if (booking.property?.id) {
          navigation.navigate("PropertyDetail", {
            id: booking.property.id,
            slug: booking.property.slug || undefined,
            title,
            startBooking: true
          });
        }
        return;
      }
      if (booking.isPaid && !isPastStay(booking)) {
        navigation.navigate("AddTransport", {
          bookingId: booking.id,
          bookingRef: booking.bookingReference,
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

          <View style={styles.travelHub}>
            <View style={styles.travelHubAccent} />
            <View style={styles.travelHubHeader}>
              <View style={styles.travelHubMark}>
                <Sparkles color={colors.primary} size={19} />
              </View>
              <View style={styles.flex}>
                <AppText variant="caption" weight="extraBold" tone="primary" style={styles.travelHubEyebrow}>
                  NOLSAF CONNECT
                </AppText>
                <AppText variant="title" weight="extraBold">
                  My Travel
                </AppText>
                <AppText variant="bodySmall" tone="muted" style={styles.travelHubSubtitle}>
                  Every service keeps its own space. Jump straight to what you need.
                </AppText>
              </View>
            </View>

            <View style={styles.serviceGrid}>
              <ServiceShortcut
                title="Tour packages"
                description="Bookings and trip timelines"
                cue={activeCountLabel(serviceCounts.tours, serviceCountsLoading)}
                icon={TicketsPlane}
                accent="#0369a1"
                tint="#e0f2fe"
                onPress={() => navigation.navigate("MyTours")}
              />
              <ServiceShortcut
                title="Group stays"
                description="Requests, offers and deposits"
                cue={activeCountLabel(serviceCounts.groups, serviceCountsLoading)}
                icon={UsersRound}
                accent="#b45309"
                tint="#fef3c7"
                onPress={() => navigation.navigate("MyGroupStays")}
              />
              <ServiceShortcut
                title="My rides"
                description="Pickups, drivers and routes"
                cue={activeCountLabel(serviceCounts.rides, serviceCountsLoading)}
                icon={CarFront}
                accent={colors.primary}
                tint={colors.brand[50]}
                onPress={() => navigation.navigate("MyRides")}
              />
              <ServiceShortcut
                title="Payments"
                description="Methods and payment guidance"
                cue="Secure options"
                icon={CreditCard}
                accent="#6d28d9"
                tint="#ede9fe"
                onPress={() => navigation.navigate("Payments")}
              />
            </View>
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
                const amountLabel =
                  isDraftBooking(booking) && stage.action === "rebook"
                    ? amount
                      ? `Previous estimate · ${amount}`
                      : "Check current price"
                    : amount || "Amount pending";
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
                            <AppText
                              variant="bodySmall"
                              weight="extraBold"
                              tone={stage.action === "rebook" ? "muted" : amount ? "primary" : "muted"}
                              style={styles.flex}
                              numberOfLines={2}
                            >
                              {amountLabel}
                            </AppText>
                            <View style={[styles.footerHint, stage.action === "rebook" && styles.rebookAction]}>
                              <AppText
                                variant="caption"
                                weight="bold"
                                tone={stage.action === "rebook" ? "primary" : isDraftBooking(booking) ? "warning" : isPastStay(booking) ? "muted" : "primary"}
                              >
                                {stage.actionLabel}
                              </AppText>
                              {stage.canPress ? <ChevronRight color={stage.action === "pay" ? "#b45309" : colors.primary} size={14} /> : null}
                            </View>
                          </View>
                        </AppStack>
                      </AppCard>
                    </Pressable>

                    {booking.isPaid && !isPastStay(booking) ? <ShareTripButton serviceKind="STAY" serviceId={booking.id} /> : null}

                    {booking.isPaid && !isPastStay(booking) ? (
                      <View style={styles.transportWrap}>
                        <GetThereSection
                          booking={{
                            bookingId: booking.id,
                            bookingReference: booking.bookingReference,
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
  travelHub: {
    position: "relative",
    overflow: "hidden",
    gap: spacing[4],
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[4]
  },
  travelHubAccent: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: colors.primary
  },
  travelHubHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    paddingTop: spacing[1]
  },
  travelHubMark: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  travelHubEyebrow: {
    letterSpacing: 1
  },
  travelHubSubtitle: {
    marginTop: 2
  },
  serviceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  serviceTile: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 136,
    minHeight: 166,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[3]
  },
  serviceTilePressed: {
    opacity: 0.76,
    transform: [{ scale: 0.985 }]
  },
  serviceTileTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing[3]
  },
  serviceIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center"
  },
  serviceArrow: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white
  },
  serviceDescription: {
    minHeight: 34,
    marginTop: 2
  },
  serviceCue: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    marginTop: spacing[2],
    paddingHorizontal: spacing[2],
    paddingVertical: 4
  },
  serviceCueDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full
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
  rebookAction: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
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

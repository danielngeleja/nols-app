import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { Building2, ChevronRight, ShoppingCart, TicketsPlane, UsersRound, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "../auth";
import { fetchMyBookings } from "../bookings/bookingsApi";
import type { BookingListItem } from "../bookings/types";
import { fetchMyGroupBookings, GroupBookingListItem } from "../groupStays";
import { useReducedMotion } from "../lib/useReducedMotion";
import { RootStackParamList } from "../navigation/types";
import { CustomerTourBookingSummary, fetchCustomerTourBooking, fetchCustomerTourBookings } from "../tours";
import { colors, radius, spacing } from "../theme";
import { AppText } from "./AppText";

type PendingCartItem =
  | { key: string; kind: "stay"; title: string; detail: string; booking: BookingListItem }
  | { key: string; kind: "tour"; title: string; detail: string; booking: CustomerTourBookingSummary }
  | { key: string; kind: "group"; title: string; detail: string; booking: GroupBookingListItem };

function isFutureOrUnset(value: string | null | undefined, now: number) {
  if (!value) return true;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) || timestamp > now;
}

/**
 * A navigation-level payment cart. It lives above the stack so it stays visible
 * while screens scroll and while the traveller moves between app sections.
 */
export function PendingBookingsCart() {
  const { token } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [stayDrafts, setStayDrafts] = useState<BookingListItem[]>([]);
  const [tourDrafts, setTourDrafts] = useState<CustomerTourBookingSummary[]>([]);
  const [groupDeposits, setGroupDeposits] = useState<GroupBookingListItem[]>([]);
  const [cartVisible, setCartVisible] = useState(false);
  const [openingKey, setOpeningKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const loadSequence = useRef(0);
  const swing = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;

  const load = useCallback(async () => {
    if (!token) {
      setStayDrafts([]);
      setTourDrafts([]);
      setGroupDeposits([]);
      setCartVisible(false);
      return;
    }

    const sequence = ++loadSequence.current;
    const [stayResult, tourResult, groupResult] = await Promise.allSettled([
      fetchMyBookings(token, { page: 1, pageSize: 30 }),
      fetchCustomerTourBookings(token, { page: 1, pageSize: 30 }),
      fetchMyGroupBookings(token, { page: 1, pageSize: 30 })
    ]);
    if (sequence !== loadSequence.current) return;

    if (stayResult.status === "fulfilled") {
      const stays = Array.isArray(stayResult.value.items) ? stayResult.value.items : [];
      setStayDrafts(stays.filter((booking) => !booking.isPaid && booking.dashboardBucket === "DRAFT"));
    }
    if (tourResult.status === "fulfilled") {
      const tours = Array.isArray(tourResult.value.items) ? tourResult.value.items : [];
      setTourDrafts(
        tours.filter(
          (booking) =>
            String(booking.dashboardBucket || "").toUpperCase() === "DRAFT" &&
            String(booking.paymentStatus || "").toUpperCase() !== "PAID"
        )
      );
    }
    if (groupResult.status === "fulfilled") {
      const groups = Array.isArray(groupResult.value.data) ? groupResult.value.data : [];
      setGroupDeposits(groups.filter((booking) => booking.status.toUpperCase() === "AWAITING_DEPOSIT" && !booking.depositPaid));
    }
  }, [token]);

  useEffect(() => {
    void load();
    const unsubscribe = navigation.addListener("state", () => {
      void load();
    });
    return unsubscribe;
  }, [load, navigation]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const items = useMemo<PendingCartItem[]>(
    () => [
      ...stayDrafts
        .filter(
          (booking) =>
            String(booking.draftExpiryStatus || "").toUpperCase() !== "EXPIRED" &&
            booking.draftAvailability?.available !== false &&
            isFutureOrUnset(booking.draftExpiresAt, now) &&
            isFutureOrUnset(booking.checkIn, now)
        )
        .map((booking): PendingCartItem => ({
          key: `stay-${booking.id}`,
          kind: "stay",
          title: booking.property?.title || "Stay booking",
          detail: "Stay · payment required",
          booking
        })),
      ...tourDrafts
        .filter(
          (booking) =>
            String(booking.draftExpiryStatus || "").toUpperCase() !== "EXPIRED" &&
            isFutureOrUnset(booking.draftExpiresAt, now) &&
            isFutureOrUnset(booking.startDate, now)
        )
        .map((booking): PendingCartItem => ({
          key: `tour-${booking.id}`,
          kind: "tour",
          title: booking.title || "Tour package",
          detail: "Tour package · payment required",
          booking
        })),
      ...groupDeposits
        .filter((booking) => isFutureOrUnset(booking.depositDueAt, now))
        .map((booking): PendingCartItem => ({
          key: `group-${booking.id}`,
          kind: "group",
          title: `${booking.toRegion || "Group"} stay`,
          detail: "Group stay · deposit required",
          booking
        }))
    ],
    [groupDeposits, now, stayDrafts, tourDrafts]
  );

  useEffect(() => {
    if (cartVisible && items.length === 0) setCartVisible(false);
  }, [cartVisible, items.length]);

  useEffect(() => {
    if (!items.length) return undefined;
    swing.stopAnimation();
    pop.stopAnimation();
    if (reduceMotion) {
      swing.setValue(0);
      pop.setValue(1);
      return undefined;
    }

    swing.setValue(0);
    pop.setValue(0.72);
    Animated.spring(pop, {
      toValue: 1,
      damping: 8,
      stiffness: 150,
      mass: 0.75,
      useNativeDriver: true
    }).start();
    const breeze = Animated.loop(
      Animated.sequence([
        Animated.timing(swing, { toValue: -1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(swing, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(swing, { toValue: -1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true })
      ])
    );
    breeze.start();
    return () => breeze.stop();
  }, [items.length, pop, reduceMotion, swing]);

  async function openItem(item: PendingCartItem) {
    setOpeningKey(item.key);
    try {
      if (item.kind === "stay") {
        setCartVisible(false);
        if (item.booking.invoiceId && item.booking.invoiceAccessToken) {
          navigation.navigate("BookingPayment", { invoiceId: item.booking.invoiceId, accessToken: item.booking.invoiceAccessToken });
        } else {
          navigation.navigate("MyBookings");
        }
        return;
      }
      if (item.kind === "group") {
        setCartVisible(false);
        navigation.navigate("GroupStayDeposit", { id: item.booking.id, ref: item.booking.groupStayReference });
        return;
      }
      if (!token) return;

      const detail = await fetchCustomerTourBooking(token, item.booking.tourReference || item.booking.id);
      const accessToken = String(detail.paymentResume?.paymentAccessToken || "");
      const tokenActive = String(detail.paymentResume?.paymentAccessTokenStatus || "").toUpperCase() === "ACTIVE";
      setCartVisible(false);
      if (accessToken && tokenActive) {
        navigation.navigate("TourBookingPayment", { bookingId: item.booking.id, accessToken });
      } else {
        navigation.navigate("MyTours");
      }
    } catch {
      setCartVisible(false);
      navigation.navigate(item.kind === "tour" ? "MyTours" : "MyBookings");
    } finally {
      setOpeningKey(null);
    }
  }

  if (!items.length) return null;

  const rotation = swing.interpolate({ inputRange: [-1, 1], outputRange: ["-4deg", "4deg"] });

  return (
    <>
      <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + 58 }]}>
        <View pointerEvents="none" style={styles.anchor}>
          <View style={styles.anchorPin} />
        </View>
        <Animated.View style={[styles.hangingAssembly, { opacity: pop, transform: [{ rotate: rotation }, { scale: pop }] }]}>
          <View pointerEvents="none" style={styles.cord} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${items.length} ${items.length === 1 ? "booking" : "bookings"} waiting for payment`}
            accessibilityHint="Opens your pending booking cart"
            onPress={() => setCartVisible(true)}
            style={({ pressed }) => [styles.cartButton, pressed && styles.cartButtonPressed]}
          >
            <ShoppingCart color={colors.white} size={23} strokeWidth={2.5} />
            <View style={styles.badge}>
              <AppText variant="caption" weight="extraBold" tone="inverse" style={styles.badgeText}>
                {items.length > 9 ? "9+" : String(items.length)}
              </AppText>
            </View>
          </Pressable>
        </Animated.View>
      </View>

      <PendingCartSheet
        visible={cartVisible}
        items={items}
        openingKey={openingKey}
        onClose={() => setCartVisible(false)}
        onOpen={openItem}
      />
    </>
  );
}

function PendingCartSheet({
  visible,
  items,
  openingKey,
  onClose,
  onOpen
}: {
  visible: boolean;
  items: PendingCartItem[];
  openingKey: string | null;
  onClose: () => void;
  onOpen: (item: PendingCartItem) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close pending bookings" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <View style={styles.sheetTitleRow}>
              <View style={styles.sheetIcon}>
                <ShoppingCart color={colors.white} size={20} strokeWidth={2.4} />
              </View>
              <View style={styles.sheetTitleText}>
                <AppText variant="title" weight="extraBold">Pending bookings</AppText>
                <AppText variant="caption" tone="muted">
                  Choose what you want to finish paying
                </AppText>
              </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={styles.closeButton}>
              <X color={colors.primary} size={20} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
            {items.map((item) => {
              const Icon = item.kind === "stay" ? Building2 : item.kind === "tour" ? TicketsPlane : UsersRound;
              const loading = openingKey === item.key;
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="button"
                  accessibilityLabel={`Continue payment for ${item.title}`}
                  disabled={Boolean(openingKey)}
                  onPress={() => onOpen(item)}
                  style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
                >
                  <View style={styles.itemIcon}>
                    <Icon color={colors.primary} size={19} />
                  </View>
                  <View style={styles.itemText}>
                    <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>{item.title}</AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>{item.detail}</AppText>
                  </View>
                  {loading ? <ActivityIndicator color={colors.primary} /> : <ChevronRight color={colors.primary} size={18} />}
                </Pressable>
              );
            })}
          </ScrollView>

          <AppText variant="caption" tone="muted" style={styles.note}>
            Paid, expired, and unavailable bookings disappear automatically.
          </AppText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    left: 7,
    zIndex: 100,
    elevation: 18,
    width: 72,
    height: 112,
    alignItems: "center"
  },
  anchor: {
    zIndex: 2,
    width: 18,
    height: 10,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    alignItems: "center",
    justifyContent: "flex-start",
    backgroundColor: colors.primaryDeep,
    borderWidth: 2,
    borderColor: colors.white
  },
  anchorPin: {
    width: 5,
    height: 5,
    marginTop: 1,
    borderRadius: radius.full,
    backgroundColor: colors.brand[300]
  },
  hangingAssembly: {
    width: 66,
    alignItems: "center",
    transformOrigin: "50% 0%"
  },
  cord: {
    width: 2,
    height: 24,
    backgroundColor: colors.primaryDeep,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 2
  },
  cartButton: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.white,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 12
  },
  cartButtonPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.94 }]
  },
  badge: {
    position: "absolute",
    top: -8,
    right: -8,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.white
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(1,42,38,0.48)"
  },
  sheet: {
    maxHeight: "72%",
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[5],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 12
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginBottom: spacing[3]
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    marginBottom: spacing[4]
  },
  sheetTitleRow: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  sheetIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  sheetTitleText: {
    minWidth: 0,
    flex: 1,
    gap: 2
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  list: {
    gap: spacing[2],
    paddingBottom: spacing[3]
  },
  item: {
    minWidth: 0,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  itemPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  },
  itemIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  itemText: {
    minWidth: 0,
    flex: 1,
    gap: 2
  },
  note: {
    textAlign: "center",
    paddingTop: spacing[2]
  }
});

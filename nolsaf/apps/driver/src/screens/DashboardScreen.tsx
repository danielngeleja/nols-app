import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AmountText,
  AppButton,
  AppCard,
  AppInput,
  AppStack,
  AppText,
  colors,
  radius,
  ResponsiveRow,
  SafeScreen,
  shadows,
  spacing,
  StateView
} from "@nolsaf/native-ui";
import { AlertTriangle, Bell, Car, Clock, Info, MapPin, Settings, Star, Sparkles, TrendingUp } from "lucide-react-native";
import * as Location from "expo-location";
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { AvailabilitySwitch } from "../components/AvailabilitySwitch";
import { DriverBottomNav } from "../components/DriverBottomNav";
import { EarningsLineChart } from "../components/EarningsLineChart";
import { fetchAvailability, fetchDashboard, fetchGoals, fetchNotifications, saveGoals, sendLocationPing, setAvailability } from "../driver/driverApi";
import { DashboardResponse, DriverGoals } from "../driver/types";
import { useDriverSocket } from "../hooks/useDriverSocket";
import { stopBackgroundLocation } from "../lib/backgroundLocationTask";
import { requestTrackingSync } from "../lib/trackingSync";
import { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export function DashboardScreen({ navigation }: Props) {
  const { user, token } = useAuth();
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [available, setAvailableState] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [goals, setGoals] = useState<DriverGoals | null>(null);
  const [showGoalsModal, setShowGoalsModal] = useState(false);
  const [formTrips, setFormTrips] = useState("");
  const [formMoney, setFormMoney] = useState("");
  const [formMoneyUrgent, setFormMoneyUrgent] = useState(false);
  const [savingGoals, setSavingGoals] = useState(false);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!token) {
        setError("Please sign in to view your dashboard.");
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [dashboardData, availabilityData, notificationsData] = await Promise.all([
          fetchDashboard(token),
          fetchAvailability(token),
          fetchNotifications(token, "unread").catch(() => ({ totalUnread: 0 }))
        ]);
        setDashboard(dashboardData);
        setAvailableState(availabilityData.available);
        setUnreadCount(notificationsData.totalUnread ?? 0);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load your dashboard.");
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

  useDriverSocket({
    "driver:availability:update": () => {
      if (!token) return;
      fetchAvailability(token)
        .then((res) => setAvailableState(res.available))
        .catch(() => {});
    }
  });

  useEffect(() => {
    if (!token) return;
    fetchGoals(token)
      .then((res) => { if (res.goals) setGoals(res.goals); })
      .catch(() => {});
  }, [token]);

  function openGoalsModal() {
    setFormTrips(goals?.trips != null ? String(goals.trips) : "");
    setFormMoney(goals?.money != null ? String(goals.money) : "");
    setFormMoneyUrgent(!!goals?.moneyUrgent);
    setShowGoalsModal(true);
  }

  async function persistGoals(next: DriverGoals | null) {
    if (!token) return;
    await saveGoals(token, next);
    setGoals(next);
  }

  async function handleSaveGoals() {
    setSavingGoals(true);
    try {
      const trips = Number(formTrips);
      const money = Number(formMoney);
      const next: DriverGoals = {};
      if (Number.isFinite(trips) && trips > 0) next.trips = trips;
      if (Number.isFinite(money) && money > 0) {
        next.money = money;
        next.moneyUrgent = formMoneyUrgent;
      }
      await persistGoals(Object.keys(next).length ? next : null);
      setShowGoalsModal(false);
    } catch (error) {
      Alert.alert("Goals not saved", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSavingGoals(false);
    }
  }

  async function handleClearGoals() {
    setSavingGoals(true);
    try {
      await persistGoals(null);
      setShowGoalsModal(false);
    } catch (error) {
      Alert.alert("Goals not cleared", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSavingGoals(false);
    }
  }

  async function toggleAvailability(next: boolean) {
    if (!token) return;
    setAvailabilityLoading(true);
    try {
      if (next) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== "granted") throw new Error("Allow location before going Online so dispatch can find you.");
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await sendLocationPing(token, {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracyM: position.coords.accuracy ?? undefined,
        });
      }
      const result = await setAvailability(token, next);
      const confirmed = await fetchAvailability(token);
      if (result.available !== next || confirmed.available !== next) throw new Error("Availability was not saved. Please retry.");
      setAvailableState(confirmed.available);
      requestTrackingSync();
      if (!next) {
        await stopBackgroundLocation().catch(() => {
          Alert.alert("Location sharing", "Please restart the app to confirm location sharing has stopped.");
        });
      }
    } catch (error) {
      const latest = await fetchAvailability(token).catch(() => null);
      if (latest) setAvailableState(latest.available);
      Alert.alert("Availability not updated", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setAvailabilityLoading(false);
    }
  }

  const name = user?.fullName || user?.name || "Driver";
  const firstName = name.split(" ")[0];

  const earningsChart = dashboard?.earningsChart ?? [];
  const weeklyEarnings = earningsChart.reduce((sum, point) => sum + point.amount, 0);

  const moneyGoal = goals?.money ?? dashboard?.todayGoal ?? 0;
  const goalProgress = dashboard
    ? goals?.money
      ? Math.min(Math.round((dashboard.todayEarnings / (goals.money || 1)) * 100), 100)
      : dashboard.goalProgress
    : 0;
  const tripsGoal = goals?.trips;
  const tripsGoalProgress = dashboard && tripsGoal ? Math.min(Math.round((dashboard.todaysRides / tripsGoal) * 100), 100) : null;

  return (
    <View style={styles.root}>
      <SafeScreen scroll={false} contentStyle={styles.content}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} colors={[colors.primary]} />}
        >
          <View style={styles.header}>
            <AppStack gap={1} style={styles.headerText}>
              <AppText variant="bodySmall" tone="muted">
                Good to see you,
              </AppText>
              <AppText variant="headline" weight="extraBold" numberOfLines={1}>
                {firstName}
              </AppText>
            </AppStack>
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Notifications")} style={styles.bellButton}>
              <Bell color={colors.ink} size={20} />
              {unreadCount > 0 ? (
                <View style={styles.badge}>
                  <AppText variant="caption" weight="bold" tone="inverse" style={styles.badgeText}>
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </AppText>
                </View>
              ) : null}
            </Pressable>
          </View>

          <AvailabilitySwitch available={available} loading={availabilityLoading} onToggle={toggleAvailability} />

          {loading ? (
            <View style={styles.stateWrap}>
              <StateView title="Loading your dashboard" message="Fetching today's stats and trips." />
            </View>
          ) : error ? (
            <View style={styles.stateWrap}>
              <StateView title="Could not load dashboard" message={error} actionLabel="Try again" onAction={() => load()} />
            </View>
          ) : dashboard ? (
            <AppStack gap={4}>
              <ResponsiveRow gap={3}>
                <AppCard style={styles.statCard}>
                  <AppStack gap={1}>
                    <View style={styles.goalHeaderRow}>
                      <AppText variant="caption" tone="muted">
                        Today's earnings
                      </AppText>
                      <Pressable accessibilityRole="button" onPress={openGoalsModal} style={styles.goalEditButton}>
                        <Settings color={colors.mutedText} size={14} />
                      </Pressable>
                    </View>
                    <AmountText amount={dashboard.todayEarnings} />
                    <AppText variant="caption" tone="soft">
                      Goal: {moneyGoal.toLocaleString()} TZS ({goalProgress}%)
                    </AppText>
                    {tripsGoal ? (
                      <AppText variant="caption" tone="soft">
                        Trips: {dashboard.todaysRides}/{tripsGoal} ({tripsGoalProgress}%)
                      </AppText>
                    ) : null}
                  </AppStack>
                </AppCard>
                <AppCard style={styles.statCard}>
                  <AppStack gap={1}>
                    <AppText variant="caption" tone="muted">
                      Today's rides
                    </AppText>
                    <AppText variant="title" weight="bold">
                      {dashboard.todaysRides}
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      Acceptance rate {dashboard.acceptanceRate}%
                    </AppText>
                  </AppStack>
                </AppCard>
              </ResponsiveRow>

              <ResponsiveRow gap={3}>
                <AppCard style={styles.statCard}>
                  <AppStack gap={1}>
                    <View style={styles.iconRow}>
                      <Star color={colors.warning} size={16} />
                      <AppText variant="caption" tone="muted">
                        Rating
                      </AppText>
                    </View>
                    <AppText variant="title" weight="bold">
                      {dashboard.rating.toFixed(1)}
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      {dashboard.totalReviews} reviews
                    </AppText>
                  </AppStack>
                </AppCard>
                <AppCard style={styles.statCard}>
                  <AppStack gap={1}>
                    <View style={styles.iconRow}>
                      <TrendingUp color={colors.primary} size={16} />
                      <AppText variant="caption" tone="muted">
                        Online today
                      </AppText>
                    </View>
                    <AppText variant="title" weight="bold">
                      {dashboard.onlineHours}h
                    </AppText>
                  </AppStack>
                </AppCard>
              </ResponsiveRow>

              <AppCard>
                <AppStack gap={3}>
                  <View style={styles.chartHeaderRow}>
                    <AppText variant="titleSm" weight="bold">
                      This week
                    </AppText>
                    <AmountText amount={weeklyEarnings} variant="bodySmall" />
                  </View>
                  <EarningsLineChart data={dashboard.earningsChart} />
                </AppStack>
              </AppCard>

              {dashboard.peakHours?.active ? (
                <AppCard tone="brand">
                  <View style={styles.peakRow}>
                    <Sparkles color={colors.white} size={20} />
                    <AppStack gap={1} style={styles.peakText}>
                      <AppText variant="bodySmall" weight="bold" tone="inverse">
                        Peak hours active: {dashboard.peakHours.multiplier}x earnings
                      </AppText>
                      <AppText variant="caption" tone="inverse">
                        {dashboard.peakHours.start} to {dashboard.peakHours.end} - {dashboard.peakHours.timeLeft} left
                      </AppText>
                    </AppStack>
                  </View>
                </AppCard>
              ) : null}

              <AppStack gap={3}>
                <AppText variant="titleSm" weight="bold">
                  Recent trips
                </AppText>
                {dashboard.recentTrips.length === 0 ? (
                  <StateView title="No trips yet today" message="Your completed trips will appear here." />
                ) : (
                  <AppStack gap={2}>
                    {dashboard.recentTrips.map((trip) => (
                      <AppCard key={trip.id} style={styles.tripCard}>
                        <View style={styles.tripIconBubble}>
                          <Car color={colors.primary} size={18} />
                        </View>
                        <AppStack gap={1} style={styles.tripText}>
                          <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                            {trip.from}
                          </AppText>
                          <AppText variant="caption" tone="muted" numberOfLines={1}>
                            to {trip.to}
                          </AppText>
                          <View style={styles.tripMetaRow}>
                            <Clock color={colors.softText} size={11} />
                            <AppText variant="caption" tone="soft">
                              {trip.time}
                            </AppText>
                            {trip.distance !== "N/A" ? (
                              <>
                                <View style={styles.tripMetaDot} />
                                <MapPin color={colors.softText} size={11} />
                                <AppText variant="caption" tone="soft">
                                  {trip.distance}
                                </AppText>
                              </>
                            ) : null}
                          </View>
                        </AppStack>
                        <View style={styles.tripAmountBadge}>
                          <AmountText amount={trip.amount} variant="caption" weight="bold" tone="primary" style={styles.tripAmountText} />
                        </View>
                      </AppCard>
                    ))}
                  </AppStack>
                )}
              </AppStack>

              {dashboard.reminders.length > 0 ? (
                <AppStack gap={3}>
                  <AppText variant="titleSm" weight="bold">
                    Reminders
                  </AppText>
                  <AppStack gap={2}>
                    {dashboard.reminders.map((reminder) => (
                      <AppCard key={reminder.id} tone={reminder.type === "warning" ? "warning" : "default"}>
                        <View style={styles.reminderRow}>
                          {reminder.type === "warning" ? (
                            <AlertTriangle color={colors.warning} size={18} />
                          ) : (
                            <Info color={colors.primary} size={18} />
                          )}
                          <AppStack gap={1} style={styles.reminderText}>
                            <AppText variant="bodySmall">{reminder.message}</AppText>
                            {reminder.action && reminder.actionLink ? (
                              <Pressable onPress={() => Linking.openURL(reminder.actionLink!)}>
                                <AppText variant="caption" weight="bold" tone="primary">
                                  {reminder.action}
                                </AppText>
                              </Pressable>
                            ) : null}
                          </AppStack>
                        </View>
                      </AppCard>
                    ))}
                  </AppStack>
                </AppStack>
              ) : null}
            </AppStack>
          ) : null}
        </ScrollView>
      </SafeScreen>
      <DriverBottomNav active="Home" />

      <Modal visible={showGoalsModal} transparent animationType="fade" onRequestClose={() => setShowGoalsModal(false)}>
        <View style={styles.goalsOverlay}>
          <View style={styles.goalsSheet}>
            <AppStack gap={4}>
              <AppText variant="title" weight="bold">
                Set your goals
              </AppText>
              <AppInput
                label="Earnings goal (TZS)"
                value={formMoney}
                onChangeText={setFormMoney}
                keyboardType="number-pad"
                placeholder={dashboard ? String(dashboard.todayGoal) : undefined}
              />
              <AppInput label="Trips goal" value={formTrips} onChangeText={setFormTrips} keyboardType="number-pad" placeholder="e.g. 10" />
              <Pressable accessibilityRole="button" onPress={() => setFormMoneyUrgent((v) => !v)} style={styles.urgentRow}>
                <View style={[styles.checkbox, formMoneyUrgent && styles.checkboxChecked]} />
                <AppText variant="bodySmall">Mark this earnings goal as urgent</AppText>
              </Pressable>
              <AppStack gap={2}>
                <AppButton title="Save goals" loading={savingGoals} onPress={handleSaveGoals} />
                <AppButton title="Clear goals" variant="ghost" onPress={handleClearGoals} />
                <AppButton title="Cancel" variant="ghost" onPress={() => setShowGoalsModal(false)} />
              </AppStack>
            </AppStack>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  content: {
    flex: 1,
    minWidth: 0
  },
  scrollContent: {
    gap: spacing[4],
    paddingBottom: spacing[8]
  },
  goalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  goalEditButton: {
    padding: 2
  },
  goalsOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(2,6,23,0.42)",
    padding: spacing[4]
  },
  goalsSheet: {
    borderRadius: radius.xl,
    backgroundColor: colors.white,
    padding: spacing[5],
    ...shadows.sheet
  },
  urgentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  headerText: {
    flexShrink: 1,
    minWidth: 0
  },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card
  },
  badge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: radius.full,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.danger
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 12
  },
  stateWrap: {
    marginTop: spacing[2]
  },
  statCard: {
    flex: 1,
    minWidth: 0
  },
  iconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  chartHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  peakRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  peakText: {
    flexShrink: 1,
    minWidth: 0
  },
  tripCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  tripIconBubble: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center"
  },
  tripText: {
    flex: 1,
    minWidth: 0
  },
  tripMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    marginTop: 2
  },
  tripMetaDot: {
    width: 3,
    height: 3,
    borderRadius: radius.full,
    backgroundColor: colors.border,
    marginHorizontal: 2
  },
  tripAmountBadge: {
    flexShrink: 0,
    backgroundColor: colors.brand[50],
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  tripAmountText: {
    fontSize: 12
  },
  reminderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3]
  },
  reminderText: {
    flexShrink: 1,
    minWidth: 0
  }
});

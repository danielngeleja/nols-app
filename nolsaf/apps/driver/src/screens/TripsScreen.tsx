import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AppCard, AppStack, AppText, colors, spacing, StateView } from "@nolsaf/native-ui";
import { Calendar, History, ListChecks, Star } from "lucide-react-native";
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { DriverBottomNav } from "../components/DriverBottomNav";
import { formatTripWhen, TripCard } from "../components/TripCard";
import { fetchTrips } from "../driver/driverApi";
import { TripListItem } from "../driver/types";
import { RootStackParamList } from "../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Trips">;

const QUICK_LINKS: Array<{
  key: "ScheduledTrips" | "History" | "Reminders" | "Rating";
  label: string;
  icon: (color: string) => ReactElement;
}> = [
  { key: "ScheduledTrips", label: "Scheduled trips", icon: (c) => <Calendar color={c} size={20} /> },
  { key: "History", label: "History", icon: (c) => <History color={c} size={20} /> },
  { key: "Reminders", label: "Reminders", icon: (c) => <ListChecks color={c} size={20} /> },
  { key: "Rating", label: "Rating", icon: (c) => <Star color={c} size={20} /> }
];

export function TripsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [trips, setTrips] = useState<TripListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (!token) {
        setError("Please sign in to view your trips.");
        setLoading(false);
        return;
      }
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const response = await fetchTrips(token);
        setTrips(response.trips || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load your trips.");
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

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <AppText variant="title" weight="bold">
          Trips
        </AppText>

        <View style={styles.quickLinksRow}>
          {QUICK_LINKS.map((link) => (
            <Pressable
              key={link.key}
              accessibilityRole="button"
              onPress={() => navigation.navigate(link.key)}
              style={styles.quickLinkWrap}
            >
              <AppCard style={styles.quickLinkCard}>
                <View style={styles.quickLinkIcon}>{link.icon(colors.primary)}</View>
                <AppText variant="caption" weight="bold" style={styles.quickLinkLabel}>
                  {link.label}
                </AppText>
              </AppCard>
            </Pressable>
          ))}
        </View>

        <AppStack gap={3}>
          <AppText variant="titleSm" weight="bold">
            Active trips
          </AppText>

          {loading ? (
            <StateView title="Loading your trips" message="Fetching trips that need your attention." />
          ) : error ? (
            <StateView title="Could not load trips" message={error} actionLabel="Try again" onAction={() => load()} />
          ) : trips.length === 0 ? (
            <StateView title="No trips need your attention" message="New and assigned trips will show up here." />
          ) : (
            <AppStack gap={2}>
              {trips.map((trip) => (
                <TripCard
                  key={trip.id}
                  status={trip.status}
                  pickup={trip.pickup}
                  dropoff={trip.dropoff}
                  when={formatTripWhen(trip.pickupTime || trip.scheduledDate || trip.date)}
                  tripCode={trip.tripCode}
                  amount={trip.amount}
                  currency={trip.currency}
                  onPress={() => navigation.navigate("TripDetail", { tripId: trip.id })}
                />
              ))}
            </AppStack>
          )}
        </AppStack>
      </ScrollView>
      <DriverBottomNav active="Trips" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  scrollContent: {
    gap: spacing[4],
    padding: spacing[4],
    paddingBottom: spacing[8]
  },
  quickLinksRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3]
  },
  quickLinkWrap: {
    width: "47%"
  },
  quickLinkCard: {
    gap: spacing[2],
    alignItems: "flex-start"
  },
  quickLinkIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  quickLinkLabel: {
    flexShrink: 1
  }
});

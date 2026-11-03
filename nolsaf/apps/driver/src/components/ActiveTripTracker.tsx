import * as Location from "expo-location";
import { useEffect } from "react";
import { Alert, AppState } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { selectTrackableTrip } from "../driver/activeTrip";
import { fetchAvailability, fetchTrips, sendLocationPing } from "../driver/driverApi";
import { LOCATION_TASK_NAME, startBackgroundLocation, stopBackgroundLocation } from "../lib/backgroundLocationTask";
import { onTrackingSync } from "../lib/trackingSync";

const SYNC_INTERVAL_MS = 30_000;
const FOREGROUND_PING_INTERVAL_MS = 10_000;

/** Shares location only while Online or on a live trip, independent of navigation. */
export function ActiveTripTracker({ enabled }: { enabled: boolean }) {
  const { status, token } = useAuth();

  useEffect(() => {
    if (!enabled || status !== "authenticated" || !token) {
      void stopBackgroundLocation();
      return;
    }
    const authToken = token;

    let mounted = true;
    let syncing = false;
    let resyncRequested = false;
    let pinging = false;
    let trackingKey: string | null = null;
    let trackedTripId: number | null = null;
    let trackingMode: "started" | "foreground-only" | "denied" | null = null;

    async function syncTrip() {
      if (syncing) {
        resyncRequested = true;
        return;
      }
      syncing = true;
      try {
        const response = await fetchTrips(authToken);
        if (!mounted) return;
        const trip = selectTrackableTrip(response.trips ?? []);
        const online = trip ? true : (await fetchAvailability(authToken)).available;
        if (!mounted) return;
        const targetKey = trip ? `trip:${trip.id}` : online ? "online" : null;

        if (!targetKey) {
          const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
          if (trackingKey !== null || running) {
            trackingKey = null;
            trackedTripId = null;
            trackingMode = null;
            await stopBackgroundLocation();
          }
          return;
        }

        if (trackingKey === targetKey && trackingMode === "started") {
          const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
          if (running || !mounted) return;
        } else if (trackingKey === targetKey) {
          return;
        }

        await stopBackgroundLocation();
        if (!mounted) return;
        const result = await startBackgroundLocation({ token: authToken, tripId: trip?.id ?? null });
        if (!mounted) {
          await stopBackgroundLocation();
          return;
        }
        trackingKey = targetKey;
        trackedTripId = trip?.id ?? null;
        trackingMode = result;
        if (result === "denied") {
          Alert.alert("Location needed", "Allow location while Online so dispatch can find nearby trips for you.");
        } else if (result === "foreground-only") {
          Alert.alert("Keep NoLSAF Driver open", "Nearby offers and trip tracking may pause in the background until you allow background location.");
          void pingForeground();
        }
      } catch {
        // Keep the existing tracker when the trip list is temporarily unavailable.
      } finally {
        syncing = false;
        if (mounted && resyncRequested) {
          resyncRequested = false;
          void syncTrip();
        }
      }
    }

    async function pingForeground() {
      if (!mounted || pinging || trackingMode !== "foreground-only" || trackingKey === null || AppState.currentState !== "active") return;
      pinging = true;
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!mounted || trackingKey === null) return;
        await sendLocationPing(authToken, {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          headingDeg: position.coords.heading ?? undefined,
          speedMps: position.coords.speed ?? undefined,
          accuracyM: position.coords.accuracy ?? undefined,
          transportBookingId: trackedTripId ?? undefined,
        });
      } catch {
        // The next foreground fix retries.
      } finally {
        pinging = false;
      }
    }

    void syncTrip();
    const syncInterval = setInterval(() => void syncTrip(), SYNC_INTERVAL_MS);
    const pingInterval = setInterval(() => void pingForeground(), FOREGROUND_PING_INTERVAL_MS);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") void syncTrip();
    });
    const unsubscribe = onTrackingSync(() => void syncTrip());
    return () => {
      mounted = false;
      clearInterval(syncInterval);
      clearInterval(pingInterval);
      subscription.remove();
      unsubscribe();
    };
  }, [enabled, status, token]);

  return null;
}

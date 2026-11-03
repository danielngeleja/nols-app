import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

import { fetchAvailability, fetchTripDetail, sendLocationPing } from "../driver/driverApi";

export const LOCATION_TASK_NAME = "nolsaf-driver-active-trip-location";
const ACTIVE_TRIP_KEY = "nolsaf.driver.activeTripPing";

type TrackingCreds = { token: string; tripId: number | null };
let transition: Promise<unknown> = Promise.resolve();
let lastStatusCheckAt = 0;
let failedStatusChecks = 0;

function serializeTransition<T>(action: () => Promise<T>): Promise<T> {
  const next = transition.then(action, action);
  transition = next.catch(() => undefined);
  return next;
}

async function readActiveTrip(): Promise<TrackingCreds | null> {
  try {
    const raw = await SecureStore.getItemAsync(ACTIVE_TRIP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TrackingCreds>;
    if (!parsed.token || (parsed.tripId !== null && (!Number.isInteger(parsed.tripId) || Number(parsed.tripId) <= 0))) return null;
    return { token: parsed.token, tripId: parsed.tripId ?? null };
  } catch {
    return null;
  }
}

// Registered at module load (imported from App.tsx) so the OS can invoke it even
// when the app is backgrounded or relaunched headlessly mid-trip.
TaskManager.defineTask(LOCATION_TASK_NAME, async ({ data, error }) => {
  if (error) return;
  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
  const latest = locations?.[locations.length - 1];
  if (!latest) return;

  const creds = await readActiveTrip();
  if (!creds) {
    // No authenticated tracking session on record - stop draining the battery.
    await stopBackgroundLocation().catch(() => undefined);
    return;
  }

  // A remote cancellation or Offline toggle ends sharing even if the driver
  // does not reopen the app. Repeated verification failures also fail closed.
  if (Date.now() - lastStatusCheckAt >= 60_000) {
    lastStatusCheckAt = Date.now();
    try {
      const stillActive = creds.tripId == null
        ? (await fetchAvailability(creds.token)).available
        : ["CONFIRMED", "IN_PROGRESS"].includes((await fetchTripDetail(creds.token, creds.tripId)).status);
      if (!stillActive) {
        await stopBackgroundLocation();
        return;
      }
      failedStatusChecks = 0;
    } catch {
      failedStatusChecks += 1;
      if (failedStatusChecks >= 3) await stopBackgroundLocation();
      return;
    }
  }

  try {
    await sendLocationPing(creds.token, {
      lat: latest.coords.latitude,
      lng: latest.coords.longitude,
      headingDeg: latest.coords.heading ?? undefined,
      speedMps: latest.coords.speed ?? undefined,
      accuracyM: latest.coords.accuracy ?? undefined,
      transportBookingId: creds.tripId ?? undefined
    });
  } catch {
    // best effort - the next location update retries
  }
});

export type StartBackgroundLocationResult = "started" | "foreground-only" | "denied";

/**
 * Starts OS-level location updates while Online or during an active trip. Returns:
 * - "started": background task is running and will ping even when backgrounded.
 * - "foreground-only": only foreground permission granted; caller should keep
 *   pinging while the app remains open.
 * - "denied": no location permission; caller cannot track this trip.
 */
export function startBackgroundLocation(creds: TrackingCreds): Promise<StartBackgroundLocationResult> {
  return serializeTransition(async () => {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== "granted") return "denied";

    const background = await Location.requestBackgroundPermissionsAsync();
    if (background.status !== "granted") return "foreground-only";

    // Persist only when the OS task can actually use these credentials.
    await SecureStore.setItemAsync(ACTIVE_TRIP_KEY, JSON.stringify(creds), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY
    });

    try {
      const alreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
      if (!alreadyRunning) {
        await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: creds.tripId == null ? 30_000 : 10_000,
          distanceInterval: creds.tripId == null ? 50 : 25,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: creds.tripId == null ? "NoLSAF Driver - online" : "NoLSAF Driver - trip active",
            notificationBody: creds.tripId == null ? "Sharing your location to receive nearby trips." : "Sharing your location with the passenger and dispatch.",
            notificationColor: "#02665e"
          }
        });
      }
      lastStatusCheckAt = 0;
      failedStatusChecks = 0;
      return "started";
    } catch (error) {
      await SecureStore.deleteItemAsync(ACTIVE_TRIP_KEY).catch(() => undefined);
      throw error;
    }
  });
}

export function stopBackgroundLocation(): Promise<void> {
  return serializeTransition(async () => {
    try {
      const running = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME).catch(() => false);
      if (running) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
    } finally {
      await SecureStore.deleteItemAsync(ACTIVE_TRIP_KEY).catch(() => undefined);
      lastStatusCheckAt = 0;
      failedStatusChecks = 0;
    }
  });
}

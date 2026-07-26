import type { Server as SocketServer } from "socket.io";
import { startExpireGroupBookingDeposits } from "./expireGroupBookingDeposits.js";
import { startExpireStaleBookings } from "./expireStaleBookings.js";
import { startOwnerBusinessLicenceExpiryReminders } from "./ownerBusinessLicenceExpiryReminders.js";
import { startTransportAutoDispatch } from "./transportAutoDispatch.js";
import { acquireLeaderLock, setLeadershipLostHandler } from "./leaderLock.js";
import { startLifecycleHealthWorker } from "./lifecycleHealth.js";
import { startGuestSmsCampaignWorker } from "./guestSmsCampaigns.js";
import { startDailyOccupiedHousekeepingWorker } from "./dailyOccupiedHousekeeping.js";
import { startNrmsDunningWorker } from "./nrmsDunning.js";
import { startNrmsPaymentReconcileAlertWorker } from "./nrmsPaymentReconcileAlert.js";
import { startNrmsIntegritySignalsWorker } from "./nrmsIntegritySignals.js";
import { startNrmsRetentionWorker } from "./nrmsRetention.js";
import { startNrmsUsageAccrualWorker } from "./nrmsUsageAccrual.js";
import { startNrmsGuestAutomationWorker } from "./nrmsGuestAutomation.js";
import { startBookingComReservationSyncWorker } from "../lib/channels/bookingComReservationSync.js";
import { startBookingComOutboundDeliveryWorker } from "../lib/channels/bookingComDelivery.js";
import { startChannelOperationsWorker } from "../lib/channels/channelOperations.js";
import { startExpediaReservationSyncWorker } from "../lib/channels/expediaReservationSync.js";
import { startExpediaOutboundDeliveryWorker } from "../lib/channels/expediaDelivery.js";

/**
 * Decide whether this process is *allowed* to run background workers.
 *
 * Policy:
 *   - tests:        always OFF (never run timers, especially the destructive
 *                   stale-booking expiry, during the test suite).
 *   - explicit env: RUN_BACKGROUND_WORKERS, if set, always wins (true/false).
 *                   This is the manual kill-switch / force-on override.
 *   - default:      ON in production, OFF everywhere else. This means a normal
 *                   production deploy runs the workers WITHOUT needing any AWS
 *                   env var, while a developer's machine never runs them by
 *                   accident. Duplicate safety across instances is handled by
 *                   the distributed lease in acquireLeaderLock().
 */
function shouldRunBackgroundWorkers(): boolean {
  if (process.env.NODE_ENV === "test") return false;

  const explicit = String(process.env.RUN_BACKGROUND_WORKERS || "").trim().toLowerCase();
  if (explicit !== "") {
    return ["1", "true", "yes", "on"].includes(explicit);
  }

  return process.env.NODE_ENV === "production";
}

export function startBackgroundWorkers(io: SocketServer): void {
  if (!shouldRunBackgroundWorkers()) {
    if (process.env.NODE_ENV !== "test") {
      console.log(
        "[workers] Background workers disabled for this process (set RUN_BACKGROUND_WORKERS=true to force-enable)."
      );
    }
    return;
  }

  // Timers and in-flight work cannot safely continue after the lease expires.
  // Process exit is the fencing boundary; the supervisor restarts a clean web
  // instance while another process may acquire worker leadership.
  setLeadershipLostHandler((reason) => {
    console.error(`[workers] Stopping process after leadership loss: ${reason}`);
    process.exit(1);
  });

  // This process is allowed to run workers, but only ONE process may actually
  // run them. The distributed lease decides — every instance can attempt this,
  // and exactly one wins, so we're safe on a single instance, under
  // auto-scaling, and during rolling deploys without any AWS configuration.
  void acquireLeaderLock().then((isLeader) => {
    if (!isLeader) {
      console.log(
        "[workers] Another process holds the worker lease; this instance will stay idle (web traffic only)."
      );
      return;
    }

    console.log("[workers] Background workers enabled for this process (worker lease acquired).");

    // Auto-assign near-term paid transport bookings. If no driver is assigned
    // within the grace window, the trip will later become claimable.
    startTransportAutoDispatch({ io });
    startOwnerBusinessLicenceExpiryReminders({ io });
    // Expire NEW bookings that were never paid within 30 minutes (anti-squatting).
    startExpireStaleBookings();
    // Expire group stay offers whose 24h deposit window has passed.
    startExpireGroupBookingDeposits();
    startGuestSmsCampaignWorker();
    startDailyOccupiedHousekeepingWorker();
    startNrmsUsageAccrualWorker();
    startNrmsDunningWorker();
    startNrmsPaymentReconcileAlertWorker();
    startNrmsIntegritySignalsWorker();
    startNrmsRetentionWorker();
    startNrmsGuestAutomationWorker();
    startChannelOperationsWorker();
    if (["1", "true", "yes", "on"].includes(String(process.env.RUN_BOOKING_COM_WORKER || "").trim().toLowerCase())) {
      startBookingComReservationSyncWorker();
      startBookingComOutboundDeliveryWorker();
    } else {
      console.log("[booking-com-reservations] worker disabled (set RUN_BOOKING_COM_WORKER=true to enable)");
    }
    if (["1", "true", "yes", "on"].includes(String(process.env.RUN_EXPEDIA_WORKER || "").trim().toLowerCase())) {
      startExpediaReservationSyncWorker();
      startExpediaOutboundDeliveryWorker();
    } else {
      console.log("[expedia-reservations] worker disabled (set RUN_EXPEDIA_WORKER=true to enable)");
    }
    if (["1", "true", "yes", "on"].includes(String(process.env.RUN_LIFECYCLE_HEALTH_WORKER || "").trim().toLowerCase())) {
      startLifecycleHealthWorker();
    } else {
      console.log("[lifecycle-health] worker disabled (set RUN_LIFECYCLE_HEALTH_WORKER=true to enable)");
    }
  });
}

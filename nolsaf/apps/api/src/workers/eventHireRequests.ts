import { prisma } from "@nolsaf/prisma";
import { runEventRequestLifecycle } from "../lib/eventHireRequests.js";
import { runEventBookingLifecycle } from "../lib/eventHireBookings.js";

export function startEventHireRequestsWorker() {
  if (process.env.EVENT_HIRE_REQUESTS_ENABLED !== "true") return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runEventRequestLifecycle(prisma); await runEventBookingLifecycle(prisma); }
    catch (error: any) { console.error("[event-hire-requests] Lifecycle failed", error?.code || "UNKNOWN"); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref?.();
}

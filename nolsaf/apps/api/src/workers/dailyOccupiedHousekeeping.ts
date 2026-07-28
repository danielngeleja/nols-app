import { prisma } from "@nolsaf/prisma";
import { ensureDailyOccupiedCleaning } from "../lib/nrmsHousekeeping.js";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

const DEFAULT_INTERVAL_MS = 60_000;

export async function processDailyOccupiedHousekeeping(now = new Date()): Promise<{ properties: number; rooms: number }> {
  const properties = await (prisma as any).property.findMany({
    where: {
      nrmsActivatedAt: { not: null },
      housekeepingDailyServiceEnabled: true,
      nrmsReservations: { some: { status: "CHECKED_IN" } },
    },
    select: { id: true },
  });
  let processed = 0;
  let rooms = 0;
  for (const property of properties) {
    const result = await ensureDailyOccupiedCleaning(prisma as any, property.id, now);
    if (result.processed) processed += 1;
    rooms += result.scheduledRooms;
  }
  return { properties: processed, rooms };
}

export function startDailyOccupiedHousekeepingWorker({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await runNrmsWorker("housekeeping", () => processDailyOccupiedHousekeeping());
      if (result.rooms > 0) console.log(`[daily-housekeeping] queued ${result.rooms} occupied room(s) across ${result.properties} property/properties`);
    } catch (error) {
      console.error("[daily-housekeeping] worker failed", error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[daily-housekeeping] Started — interval: ${intervalMs / 1000}s`);
}

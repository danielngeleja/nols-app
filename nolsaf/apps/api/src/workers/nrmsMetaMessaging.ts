import { processMetaMessagingJobs } from "../lib/nrmsMetaWebhookJobs.js";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

export function startNrmsMetaMessagingWorker(): void {
  const intervalMs = Math.max(5_000, Number(process.env.NRMS_META_MESSAGING_INTERVAL_MS || 10_000));
  const run = () => runNrmsWorker("meta-messaging", () => processMetaMessagingJobs()).catch((error) => console.error("[nrms-meta-messaging] worker failed", error));
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[nrms-meta-messaging] Started, interval: ${intervalMs / 1000}s`);
}

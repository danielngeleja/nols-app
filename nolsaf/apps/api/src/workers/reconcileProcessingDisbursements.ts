import { reconcileStalePayouts } from "../services/payouts/reconciliation.js";

const DEFAULT_INTERVAL_MS = 5 * 60_000; // 5 minutes — reconciliation is a fallback, not the primary path (callbacks are)

export function startDisbursementReconciliationWorker({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await reconcileStalePayouts();
      if (result.checked > 0) {
        console.log(
          `[disbursement-reconciliation] checked ${result.checked}, resolved ${result.resolved}, ` +
            `still pending ${result.stillPending}, errors ${result.errors}`
        );
      }
    } catch (error) {
      console.error("[disbursement-reconciliation] worker failed", error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[disbursement-reconciliation] started, interval ${intervalMs / 1000}s`);
}

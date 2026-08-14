/**
 * Authorized Disbursement Batch Processor
 *
 * Submission used to run inline inside the authorize HTTP request. With
 * AzamPay called once per payout and a default concurrency of 1, a batch of
 * any size outlived a normal gateway timeout, and a request that died
 * mid-loop left the batch PROCESSING with the remaining items AUTHORIZED and
 * no route back in: authorizeBatch refused (not DRAFT), processBatch refused
 * (not AUTHORIZED), and the reconciliation worker only looks at payouts that
 * already have a pgReferenceId. That is stranded money owed to partners.
 *
 * Authorization is now the human decision only. This worker performs the
 * submission, picks up anything left AUTHORIZED or PROCESSING, retries items
 * whose submission failed, and closes the batch once every member has
 * settled. Retry is safe because externalReferenceId is allocated before the
 * first call and never changes, so a duplicate reaches AzamPay as a duplicate
 * rather than as a second payment.
 */

import { findBatchesNeedingProcessing, processBatch } from "../services/payouts/batching.js";

// Short, because this is the path money actually travels: an authorized batch
// should start moving within a minute of the click, not on the reconciliation
// worker's 5-minute fallback cadence.
const DEFAULT_INTERVAL_MS = 60_000;

/** Batches handled per pass. Bounded so one enormous backlog cannot monopolise the worker loop. */
const MAX_BATCHES_PER_PASS = 5;

export function startDisbursementBatchWorker({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}): void {
  let running = false;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const batchIds = await findBatchesNeedingProcessing(MAX_BATCHES_PER_PASS);
      for (const batchId of batchIds) {
        try {
          const result = await processBatch(batchId);
          if (result.submitted.length || result.failed.length || result.completed) {
            console.log(
              `[disbursement-batch] batch ${batchId}: submitted ${result.submitted.length}, ` +
                `failed ${result.failed.length}${result.completed ? ", batch completed" : ""}`
            );
          }
          for (const failure of result.failed) {
            console.error(
              `[disbursement-batch] batch ${batchId} disbursement ${failure.disbursementId} did not submit: ${failure.error}`
            );
          }
        } catch (error) {
          // One bad batch must never stop the others from being processed.
          console.error(`[disbursement-batch] batch ${batchId} failed to process`, error);
        }
      }
    } catch (error) {
      console.error("[disbursement-batch] worker failed", error);
    } finally {
      running = false;
    }
  };

  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[disbursement-batch] started, interval ${intervalMs / 1000}s`);
}

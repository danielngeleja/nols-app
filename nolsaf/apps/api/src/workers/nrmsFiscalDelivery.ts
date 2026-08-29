import crypto from "node:crypto";
import { prisma } from "@nolsaf/prisma";
import { applyPendingFiscalDayTransitions, fiscalDateFor, fiscalErrorCode, isFiscalDeadLetter, nextFiscalAttemptAt } from "../lib/nrmsFiscal.js";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

const db = prisma as any;

/**
 * Delivers queued TRA fiscal documents. See docs/NRMS_FISCAL_RECEIPTS.md.
 *
 * The shape of this worker is dictated by TRA's own offline guidance: keep
 * transacting when the service is unreachable, hold each document as pending,
 * and resend the pending ones IN ORDER once it returns. Two consequences that
 * make this different from the channel delivery worker it otherwise resembles:
 *
 *   1. Delivery is strictly FIFO per property. Each document carries a
 *      sequential counter, so sending #42 before #41 is not merely untidy, it is
 *      an invalid submission. Channel deliveries are independent of each other
 *      and can fan out; these cannot.
 *
 *   2. A property whose head-of-queue document is failing does not get its later
 *      documents delivered around it. That is intended. Skipping ahead would
 *      break the sequence, and the escalation ladder exists precisely so a stuck
 *      head becomes loud rather than silently overtaken.
 *
 * Properties are independent of each other, so the outer loop is concurrent
 * across properties and serial within one.
 */

/** How many properties to service in one pass. */
const PROPERTY_BATCH = 25;
/** How many documents to push for one property in one pass, in order. */
const PER_PROPERTY_BATCH = 20;
/** Long enough for a normal call, finite so a crashed worker can be recovered. */
const DELIVERY_LEASE_MS = 5 * 60_000;

type DeliveryOutcome = { sent: number; failed: number; deadLettered: number };

/**
 * The regime adapter. Not implemented: the authoritative TRA specification is
 * issued at registration and is not published openly, so building an XML/PKCS12
 * client against community documentation would be guesswork that looks like
 * compliance. Until milestone 5 lands with the real specification in hand, this
 * throws, documents stay PENDING, and no settle is affected.
 *
 * The signature is the contract the adapter must satisfy.
 */
export type FiscalAdapterResult = {
  fiscalReceiptNumber: string;
  verificationCode: string | null;
  verificationUrl: string | null;
  signature: string | null;
  responseDigest: string | null;
  issuedAt: Date;
};

export type FiscalAdapter = (
  receipt: any,
  connection: any,
  context: { idempotencyKey: string },
) => Promise<FiscalAdapterResult>;

const notImplemented: FiscalAdapter = async () => {
  throw new Error("TRA_ADAPTER_NOT_IMPLEMENTED");
};

let adapter: FiscalAdapter = notImplemented;

/** Registered by the TRA adapter once it exists; kept injectable for tests. */
export function setFiscalAdapter(next: FiscalAdapter): void {
  adapter = next;
}

/**
 * Push one property's queue, oldest first, stopping at the first failure.
 *
 * Stopping is the point. The counters are sequential, so a document that will
 * not go through blocks everything behind it by design.
 */
export async function deliverPropertyQueue(connection: any, now = new Date()): Promise<DeliveryOutcome> {
  const outcome: DeliveryOutcome = { sent: 0, failed: 0, deadLettered: 0 };

  const queued = await db.nrmsFiscalReceipt.findMany({
    where: {
      connectionId: connection.id,
      // Every unresolved state must be visible. Filtering a FAILED head out
      // while it is in backoff would let the next PENDING counter overtake it.
      status: { in: ["PENDING", "FAILED", "SENDING", "DEAD_LETTER"] },
    },
    // Global counter, not createdAt: the counter IS the order TRA expects, and
    // two documents allocated in the same millisecond still have distinct ones.
    orderBy: { globalCounter: "asc" },
    take: PER_PROPERTY_BATCH,
  });

  for (const receipt of queued) {
    if (receipt.status === "DEAD_LETTER") break;
    if (receipt.status === "SENDING" && receipt.deliveryLeaseExpiresAt && new Date(receipt.deliveryLeaseExpiresAt) > now) break;
    if (["PENDING", "FAILED"].includes(receipt.status) && receipt.nextAttemptAt && new Date(receipt.nextAttemptAt) > now) break;

    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + DELIVERY_LEASE_MS);
    const claimed = await db.nrmsFiscalReceipt.updateMany({
      where: {
        id: receipt.id,
        OR: [
          { status: { in: ["PENDING", "FAILED"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { status: "SENDING", OR: [{ deliveryLeaseExpiresAt: null }, { deliveryLeaseExpiresAt: { lte: now } }] },
        ],
      },
      data: {
        status: "SENDING",
        deliveryLeaseToken: leaseToken,
        deliveryLeaseExpiresAt: leaseExpiresAt,
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
        lastError: null,
      },
    });
    // Another worker owns the head. Stop: skipping it would violate FIFO.
    if (Number(claimed.count ?? 0) !== 1) break;

    // Suspension/revocation fences a claim immediately before network I/O. The
    // route also clears every SENDING lease, so a later CAS cannot confirm it.
    const live = await db.nrmsFiscalConnection.findUnique({
      where: { id: connection.id },
      select: { status: true, mode: true },
    });
    if (!live || !["ACTIVE", "FAILED"].includes(live.status) || !["ALWAYS", "ON_REQUEST"].includes(live.mode)) {
      await db.nrmsFiscalReceipt.updateMany({
        where: { id: receipt.id, status: "SENDING", deliveryLeaseToken: leaseToken },
        data: { status: "PENDING", deliveryLeaseToken: null, deliveryLeaseExpiresAt: null, nextAttemptAt: now, lastError: "FISCAL_DELIVERY_INTERRUPTED" },
      });
      break;
    }

    try {
      if (!receipt.submissionKey) throw new Error("FISCAL_DELIVERY_INTERRUPTED");
      const result = await adapter(receipt, connection, { idempotencyKey: receipt.submissionKey });
      const confirmed = await db.nrmsFiscalReceipt.updateMany({
        where: { id: receipt.id, status: "SENDING", deliveryLeaseToken: leaseToken },
        data: {
          status: "CONFIRMED",
          fiscalReceiptNumber: result.fiscalReceiptNumber,
          verificationCode: result.verificationCode,
          verificationUrl: result.verificationUrl,
          signature: result.signature,
          responseDigest: result.responseDigest,
          issuedAt: result.issuedAt,
          lastError: null,
          nextAttemptAt: null,
          deliveryLeaseToken: null,
          deliveryLeaseExpiresAt: null,
        },
      });
      if (Number(confirmed.count ?? 0) !== 1) break;
      outcome.sent += 1;
    } catch (error) {
      const attemptCount = Number(receipt.attemptCount ?? 0) + 1;
      const dead = isFiscalDeadLetter(attemptCount);
      const errorCode = fiscalErrorCode(error);
      const failed = await db.nrmsFiscalReceipt.updateMany({
        where: { id: receipt.id, status: "SENDING", deliveryLeaseToken: leaseToken },
        data: {
          status: dead ? "DEAD_LETTER" : "FAILED",
          lastError: errorCode,
          nextAttemptAt: dead ? null : nextFiscalAttemptAt(attemptCount, now),
          deliveryLeaseToken: null,
          deliveryLeaseExpiresAt: null,
        },
      });
      if (Number(failed.count ?? 0) !== 1) break;
      if (dead) outcome.deadLettered += 1;
      else outcome.failed += 1;

      // Head of queue is stuck. Everything behind it waits, on purpose.
      break;
    }
  }

  await recordConnectionHealth(connection.id, outcome, now);
  return outcome;
}

/**
 * Reflect the pass onto the connection so the owner's health strip and the
 * escalation banner have something to read.
 *
 * `escalatedAt` is only ever set here and cleared on the next success. Section
 * 7.4's ladder needs a first-failure timestamp to measure a shift against, and
 * `lastErrorAt` alone would keep moving with every retry.
 */
async function recordConnectionHealth(connectionId: number, outcome: DeliveryOutcome, now: Date) {
  if (outcome.sent > 0 && outcome.failed === 0 && outcome.deadLettered === 0) {
    await db.nrmsFiscalConnection.updateMany({
      where: { id: connectionId, status: { in: ["ACTIVE", "FAILED"] } },
      data: { lastSuccessAt: now, lastError: null, escalatedAt: null, status: "ACTIVE" },
    });
    return;
  }
  if (outcome.failed === 0 && outcome.deadLettered === 0) return;

  const current = await db.nrmsFiscalConnection.findUnique({
    where: { id: connectionId },
    select: { escalatedAt: true },
  });
  await db.nrmsFiscalConnection.updateMany({
    where: { id: connectionId, status: { in: ["ACTIVE", "FAILED"] } },
    data: {
      lastErrorAt: now,
      // First failure of a streak starts the clock the ladder measures.
      escalatedAt: current?.escalatedAt ?? now,
      ...(outcome.deadLettered > 0 ? { status: "FAILED" } : {}),
    },
  });
}

export async function runNrmsFiscalDelivery(now = new Date()): Promise<DeliveryOutcome & { properties: number }> {
  // Land any scheduled on/off switch first, so a property activating today is
  // already ACTIVE by the time the queue below is selected.
  await applyPendingFiscalDayTransitions(db, new Date(`${fiscalDateFor(now)}T00:00:00.000Z`));

  // Only live connections. A property in OFF, or one whose activation has not
  // reached its business-day boundary yet, has nothing queued and is skipped
  // without a query per property.
  const connections = await db.nrmsFiscalConnection.findMany({
    where: {
      status: { in: ["ACTIVE", "FAILED"] },
      mode: { in: ["ALWAYS", "ON_REQUEST"] },
      receipts: { some: { status: { in: ["PENDING", "FAILED", "SENDING"] } } },
    },
    take: PROPERTY_BATCH,
  });
  if (!connections.length) return { properties: 0, sent: 0, failed: 0, deadLettered: 0 };

  const totals: DeliveryOutcome = { sent: 0, failed: 0, deadLettered: 0 };
  // Serial within a property, independent across properties.
  const results = await Promise.allSettled(connections.map((connection: any) => deliverPropertyQueue(connection, now)));
  for (const result of results) {
    if (result.status !== "fulfilled") {
      console.error("[nrms-fiscal-delivery] property queue failed", fiscalErrorCode(result.reason));
      continue;
    }
    totals.sent += result.value.sent;
    totals.failed += result.value.failed;
    totals.deadLettered += result.value.deadLettered;
  }
  return { properties: connections.length, ...totals };
}

export function startNrmsFiscalDeliveryWorker(): void {
  const intervalMs = Math.max(30_000, Number(process.env.NRMS_FISCAL_DELIVERY_INTERVAL_MS || 60_000));
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runNrmsWorker("fiscal-delivery", () => runNrmsFiscalDelivery());
    } catch (error) {
      console.error("[nrms-fiscal-delivery] worker failed", fiscalErrorCode(error));
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[nrms-fiscal-delivery] Started, interval: ${intervalMs / 1000}s`);
}

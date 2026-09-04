/**
 * Provider event inbox.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * This is the authoritative path by which a payment becomes settled. Nothing
 * else in the core may mark money as collected: an initiation response only
 * ever says a request was accepted.
 *
 * The inbox exists because provider callbacks are not a reliable, ordered,
 * exactly-once stream. They arrive twice, out of order, late, occasionally for
 * something else entirely, and occasionally not at all. Every one of those is
 * normal, so each is handled explicitly rather than treated as an error:
 *
 *   - a repeat is recognised by the unique provider event id and does nothing;
 *   - an event that cannot be matched is parked, never guessed at;
 *   - an event naming a different merchant than the intent is parked, because
 *     applying it would credit a payment to the wrong property;
 *   - an amount that disagrees with the intent is parked rather than trusted;
 *   - a late failure cannot overwrite a settled payment, because the
 *     transition map in types.ts has no such edge.
 *
 * An unverified signature is the one hard rejection. Everything else is
 * acknowledged and then triaged, so a provider is never left retrying an event
 * the system has already safely absorbed.
 */

import type { NormalizedProviderEvent } from "./adapter.js";
import { intentStatusForAttempt } from "./attempts.js";
import { transitionIntent } from "./intents.js";
import { isAttemptStatus, type IntentStatus } from "./types.js";

/** Event types that unwind a settled payment rather than resolving one. */
const REFUND_EVENT = /refund/i;
const REVERSAL_EVENT = /revers|chargeback/i;

export type InboxState = "PROCESSED" | "DUPLICATE" | "UNMATCHED" | "WRONG_MERCHANT" | "REVIEW";

export type IngestResult =
  | {
      ok: true;
      state: "PROCESSED";
      inboxId: number;
      intentId: number;
      intentStatus: IntentStatus;
      /** False when the event repeated a status the intent already held. */
      changed: boolean;
    }
  | { ok: true; state: "DUPLICATE"; inboxId: number; intentId: number | null }
  | {
      ok: true;
      state: "UNMATCHED" | "WRONG_MERCHANT" | "REVIEW";
      inboxId: number;
      intentId: number | null;
      reason: string;
    }
  | { ok: false; code: "signature_not_verified"; message: string };

type IntentRow = {
  id: number;
  status: string;
  amount: unknown;
  currency: string;
  routingSnapshot: { providerMerchantId?: string } | null;
};

/**
 * Decides what an event means for the intent.
 *
 * Refunds and reversals are read from the event TYPE rather than from the
 * status, because a provider reports a completed refund as a success and
 * mapping that straight through would re-settle a payment that was just
 * returned.
 */
export function intentStatusForEvent(
  event: NormalizedProviderEvent,
  intent: { amount: string }
): IntentStatus {
  if (REVERSAL_EVENT.test(event.eventType)) return "REVERSED";

  if (REFUND_EVENT.test(event.eventType)) {
    const refunded = Number(event.money?.amount ?? 0);
    const total = Number(intent.amount);
    // A refund for less than the full amount leaves the rest collected.
    return refunded > 0 && refunded < total ? "PARTIALLY_REFUNDED" : "REFUNDED";
  }

  const status = isAttemptStatus(event.status) ? event.status : "STATUS_UNKNOWN";
  return intentStatusForAttempt(status);
}

function decimalString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * Records and applies one verified provider event.
 *
 * `connectionId` comes from the route that received the callback, not from the
 * event body, so a payload cannot claim to be from a connection other than the
 * one whose signing key just verified it.
 */
export async function ingestProviderEvent(
  db: any,
  connectionId: number,
  event: NormalizedProviderEvent
): Promise<IngestResult> {
  // Fail closed. An adapter that could not verify the signature must never
  // have its payload applied, whatever else the body says.
  if (!event.signatureVerified) {
    return {
      ok: false,
      code: "signature_not_verified",
      message: "Event signature could not be verified.",
    };
  }

  // The unique index on [connectionId, providerEventId] is the deduplication
  // mechanism. Reading first and then writing would leave a window in which
  // two concurrent deliveries of the same event both pass the check.
  let inbox: { id: number; processingState: string; matchedIntentId: number | null };
  try {
    inbox = await db.providerEventInbox.create({
      data: {
        connectionId,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        signatureVerified: true,
        providerOccurredAt: event.providerOccurredAt ?? null,
        payloadDigest: event.payloadDigest,
        processingState: "PENDING",
      },
      select: { id: true, processingState: true, matchedIntentId: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;

    const existing = await db.providerEventInbox.findUnique({
      where: {
        connectionId_providerEventId: {
          connectionId,
          providerEventId: event.providerEventId,
        },
      },
      select: { id: true, processingState: true, matchedIntentId: true },
    });

    // Already handled. Repeats are expected and must be harmless.
    if (!existing || existing.processingState !== "PENDING") {
      return {
        ok: true,
        state: "DUPLICATE",
        inboxId: existing?.id ?? 0,
        intentId: existing?.matchedIntentId ?? null,
      };
    }
    // A previous delivery was recorded but never finished processing, so pick
    // it up rather than dropping this one.
    inbox = existing;
  }

  const park = async (
    state: "UNMATCHED" | "WRONG_MERCHANT" | "REVIEW",
    reason: string,
    intentId: number | null = null
  ): Promise<IngestResult> => {
    await db.providerEventInbox.update({
      where: { id: inbox.id },
      data: { processingState: state, reviewReason: reason.slice(0, 300), matchedIntentId: intentId },
    });
    return { ok: true, state, inboxId: inbox.id, intentId, reason };
  };

  // Correlate on the provider transaction reference, never on amount or payer
  // number, both of which repeat legitimately across different payments.
  const reference = event.originalProviderRef ?? event.providerRef;
  if (!reference) {
    return park("UNMATCHED", "Event carried no provider reference");
  }

  const attempt: { id: number; intentId: number } | null = await db.paymentAttempt.findUnique({
    where: { providerRef: reference },
    select: { id: true, intentId: true },
  });
  if (!attempt) {
    return park("UNMATCHED", `No attempt matches provider reference ${reference}`);
  }

  const intent: IntentRow | null = await db.paymentIntent.findUnique({
    where: { id: attempt.intentId },
    select: { id: true, status: true, amount: true, currency: true, routingSnapshot: true },
  });
  if (!intent) {
    return park("UNMATCHED", "Matched attempt has no intent", null);
  }

  // Applying an event that names a different merchant would credit one
  // property's payment to another.
  const expectedMerchant = intent.routingSnapshot?.providerMerchantId;
  if (event.providerMerchantId && expectedMerchant && event.providerMerchantId !== expectedMerchant) {
    return park(
      "WRONG_MERCHANT",
      `Event merchant ${event.providerMerchantId} does not match intent merchant ${expectedMerchant}`,
      intent.id
    );
  }

  const intentAmount = decimalString(intent.amount);

  if (event.money) {
    if (event.money.currency.toUpperCase() !== intent.currency.toUpperCase()) {
      return park(
        "REVIEW",
        `Event currency ${event.money.currency} does not match intent currency ${intent.currency}`,
        intent.id
      );
    }
    // A refund is legitimately for part of the total, so only a payment event
    // is required to match the intent exactly.
    const isPostPayment = REFUND_EVENT.test(event.eventType) || REVERSAL_EVENT.test(event.eventType);
    if (!isPostPayment && Number(event.money.amount) !== Number(intentAmount)) {
      return park(
        "REVIEW",
        `Event amount ${event.money.amount} does not match intent amount ${intentAmount}`,
        intent.id
      );
    }
  }

  const target = intentStatusForEvent(event, { amount: intentAmount });

  // Keep the attempt in step with the event, but only for payment events: a
  // refund does not change how the original collection resolved.
  if (event.providerRef && !event.originalProviderRef && isAttemptStatus(event.status)) {
    await db.paymentAttempt.update({
      where: { id: attempt.id },
      data: {
        normalizedStatus: event.status,
        providerStatus: event.providerStatus ?? null,
        completedAt: new Date(),
      },
    });
  }

  const transition = await transitionIntent(db, {
    intentId: intent.id,
    to: target,
    reason: `Provider event ${event.eventType}`,
    actorKind: "PROVIDER",
    settledAt: target === "SUCCEEDED" ? (event.providerOccurredAt ?? new Date()) : null,
  });

  if (!transition.ok) {
    // The transition map refused. That is the control working, not a bug: a
    // late failure arriving after settlement lands here and is parked for an
    // operator rather than being applied.
    return park(
      "REVIEW",
      `Cannot apply ${target}: ${transition.code}`,
      intent.id
    );
  }

  await db.providerEventInbox.update({
    where: { id: inbox.id },
    data: {
      processingState: "PROCESSED",
      processedAt: new Date(),
      matchedIntentId: intent.id,
    },
  });

  return {
    ok: true,
    state: "PROCESSED",
    inboxId: inbox.id,
    intentId: intent.id,
    intentStatus: transition.status,
    changed: transition.changed,
  };
}

/** Prisma reports a unique constraint breach as P2002. */
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error) && (error as { code?: string }).code === "P2002";
}

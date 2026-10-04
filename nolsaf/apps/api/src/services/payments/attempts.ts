/**
 * Payment attempt execution.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * This is the only module in the core that causes an external call, and its
 * whole shape is dictated by one rule: never mark anything paid from an
 * initiation response, and never let an uncertain outcome look like a
 * resolved one.
 *
 * Two consequences run through the code below.
 *
 * The attempt row is written BEFORE the provider is called and updated after,
 * rather than being created from the response. A crash, deploy or timeout
 * between the two leaves a durable record that something was sent, which is
 * what reconciliation needs in order to ask "did this move?". Creating the row
 * from the response instead would lose exactly the cases that matter.
 *
 * A transport failure becomes STATUS_UNKNOWN, never FAILED. A thrown fetch
 * means the request may or may not have reached the provider; calling that
 * FAILED would invite an immediate retry and a double charge. Only an explicit
 * provider rejection is a failure.
 *
 * The adapter call deliberately happens outside any database transaction. A
 * transaction held open across network I/O holds row locks for the length of
 * an MNO prompt, which is seconds at best and minutes at worst.
 */

import { createHash } from "node:crypto";

import type { CreateAttemptResult, PaymentProviderAdapter } from "./adapter.js";
import { checkCollectionCapability } from "./capabilities.js";
import { checkOrchestrationGate } from "./config.js";
import { transitionIntent } from "./intents.js";
import {
  allowsNewAttempt,
  isAttemptStatus,
  type AttemptStatus,
  type IntentStatus,
  type PaymentChannel,
} from "./types.js";

export type StartAttemptRefusalCode =
  | "orchestration_disabled"
  | "production_not_authorized"
  | "intent_not_found"
  | "intent_not_eligible"
  | "missing_routing_snapshot"
  | "provider_mismatch"
  | "attempt_in_flight"
  | "channel_not_supported"
  | "currency_not_supported";

export type StartAttemptResult =
  | {
      ok: true;
      attemptId: number;
      status: AttemptStatus;
      intentStatus: IntentStatus;
      providerRef?: string;
      checkoutUrl?: string;
    }
  | { ok: false; code: StartAttemptRefusalCode; message: string };

/**
 * The intent states from which a fresh attempt may begin.
 *
 * INITIATION_PENDING is included because a previous attempt can have left the
 * intent there without reaching a provider at all. Whether that specific
 * situation permits a retry is decided by the in-flight check below, which
 * looks at the attempts themselves rather than at the intent's status.
 */
const STARTABLE_INTENT_STATUSES = new Set<string>(["ELIGIBILITY_CHECKED", "INITIATION_PENDING"]);

/**
 * Non-startable states that mean an earlier attempt is still unresolved,
 * rather than that the payment is over.
 *
 * They are separated from the other non-startable states so the refusal names
 * the real reason. "A payment is already in progress" tells a cashier to wait
 * and check; "this payment can no longer be started" would send them looking
 * for a problem that does not exist. A settled or cancelled intent keeps the
 * latter message, because there the payment genuinely is over.
 */
const UNRESOLVED_INTENT_STATUSES = new Set<string>(["PROCESSING", "STATUS_UNKNOWN"]);

/**
 * Maps a provider attempt outcome onto the intent.
 *
 * REQUIRES_CUSTOMER_ACTION collapses to PROCESSING because the intent tracks
 * the money, not the handset: from the folio's point of view a guest who has
 * been sent a PIN prompt and a guest whose payment is clearing are the same
 * unresolved state.
 */
export function intentStatusForAttempt(status: AttemptStatus): IntentStatus {
  switch (status) {
    case "CREATED":
      return "INITIATION_PENDING";
    case "REQUIRES_CUSTOMER_ACTION":
    case "PROCESSING":
      return "PROCESSING";
    case "SUCCEEDED":
      return "SUCCEEDED";
    case "FAILED":
      return "FAILED";
    case "EXPIRED":
      return "EXPIRED";
    case "CANCELLED":
      return "CANCELLED";
    case "STATUS_UNKNOWN":
    default:
      return "STATUS_UNKNOWN";
  }
}

type IntentRow = {
  id: number;
  reference: string;
  status: string;
  amount: unknown;
  currency: string;
  routingSnapshot: {
    connectionId?: number;
    provider?: string;
    environment?: string;
    providerMerchantId?: string;
    providerWalletId?: string;
  } | null;
};

/**
 * Refuses when any existing attempt on this intent means money may already
 * have moved.
 *
 * This is the hard rule from the design record made executable: an accepted,
 * processing, awaiting-customer or unknown attempt must be reconciled before
 * anything new is sent, on this provider or any other.
 */
async function hasBlockingAttempt(db: any, intentId: number): Promise<boolean> {
  const attempts: Array<{ normalizedStatus: string }> = await db.paymentAttempt.findMany({
    where: { intentId },
    select: { normalizedStatus: true },
  });

  return attempts.some((attempt) => {
    // An unrecognised stored status is treated as blocking. Being wrong in
    // this direction strands a payment for an operator to look at; being wrong
    // in the other direction charges a guest twice.
    if (!isAttemptStatus(attempt.normalizedStatus)) return true;
    return !allowsNewAttempt(attempt.normalizedStatus);
  });
}

function decimalString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * Starts one provider attempt against an eligible intent.
 *
 * The adapter is supplied by the caller rather than looked up here, so this
 * module never imports a provider and stays testable against the simulator.
 */
export async function startPaymentAttempt(
  db: any,
  adapter: PaymentProviderAdapter,
  input: {
    intentId: number;
    channel: PaymentChannel;
    payerReference?: string;
    metadata?: Record<string, string>;
  },
  env: NodeJS.ProcessEnv = process.env
): Promise<StartAttemptResult> {
  const gate = checkOrchestrationGate(env);
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message };

  const intent: IntentRow | null = await db.paymentIntent.findUnique({
    where: { id: input.intentId },
    select: {
      id: true,
      reference: true,
      status: true,
      amount: true,
      currency: true,
      routingSnapshot: true,
    },
  });
  if (!intent) return { ok: false, code: "intent_not_found", message: "Payment not found." };

  if (!STARTABLE_INTENT_STATUSES.has(intent.status)) {
    if (UNRESOLVED_INTENT_STATUSES.has(intent.status)) {
      return {
        ok: false,
        code: "attempt_in_flight",
        message: "A payment for this is already in progress.",
      };
    }
    return {
      ok: false,
      code: "intent_not_eligible",
      message: "This payment can no longer be started.",
    };
  }

  const snapshot = intent.routingSnapshot;
  if (!snapshot?.providerMerchantId || !snapshot.providerWalletId || !snapshot.connectionId) {
    return {
      ok: false,
      code: "missing_routing_snapshot",
      message: "This payment is not ready to be sent.",
    };
  }

  // The adapter must be the one the intent was routed to. Handing an intent to
  // a different provider is precisely the automatic failover the design record
  // forbids, and it would send money to a destination this snapshot never
  // authorised.
  if (snapshot.provider !== adapter.provider || snapshot.environment !== adapter.environment) {
    return {
      ok: false,
      code: "provider_mismatch",
      message: "This payment cannot be sent through that provider.",
    };
  }

  if (await hasBlockingAttempt(db, intent.id)) {
    return {
      ok: false,
      code: "attempt_in_flight",
      message: "A payment for this is already in progress.",
    };
  }

  const capable = checkCollectionCapability(adapter.getCapabilities(), {
    channel: input.channel,
    currency: intent.currency,
  });
  if (!capable.ok) {
    return { ok: false, code: capable.code as StartAttemptRefusalCode, message: capable.message };
  }

  const amount = decimalString(intent.amount);
  const money = { amount, currency: intent.currency };

  // Stable across retries of this same logical call, and distinct per intent,
  // so the provider can recognise a duplicate submission as one.
  const idempotencyKey = `${intent.reference}:${input.channel}`;
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        reference: intent.reference,
        channel: input.channel,
        amount,
        currency: intent.currency,
        destination: snapshot.providerWalletId,
      })
    )
    .digest("hex");

  // Recorded before the call, so a crash between here and the response still
  // leaves evidence that something was sent.
  const attempt = await db.paymentAttempt.create({
    data: {
      intentId: intent.id,
      connectionId: snapshot.connectionId,
      channel: input.channel,
      normalizedStatus: "CREATED" satisfies AttemptStatus,
      requestHash,
      payerMasked: maskPayer(input.payerReference),
    },
    select: { id: true },
  });

  await transitionIntent(db, {
    intentId: intent.id,
    to: "INITIATION_PENDING",
    reason: "Attempt created",
  });

  let result: CreateAttemptResult;
  try {
    result = await adapter.createPaymentAttempt({
      intentReference: intent.reference,
      idempotencyKey,
      channel: input.channel,
      money,
      destination: {
        providerMerchantId: snapshot.providerMerchantId,
        providerWalletId: snapshot.providerWalletId,
      },
      payerReference: input.payerReference,
      metadata: input.metadata,
    });
  } catch (error) {
    // The request may or may not have reached the provider. FAILED would be a
    // claim we cannot support, and would invite an immediate retry.
    result = {
      status: "STATUS_UNKNOWN",
      providerStatus: "transport_error",
      failureCode: String((error as Error)?.message ?? error).slice(0, 60),
    };
  }

  const status: AttemptStatus = isAttemptStatus(result.status) ? result.status : "STATUS_UNKNOWN";
  const completedAt = status === "CREATED" || status === "PROCESSING" ? null : new Date();

  await db.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      normalizedStatus: status,
      providerRef: result.providerRef ?? null,
      providerStatus: result.providerStatus ?? null,
      checkoutUrl: result.checkoutUrl ?? null,
      failureCode: result.failureCode ?? null,
      completedAt,
    },
  });

  const intentStatus = intentStatusForAttempt(status);
  await transitionIntent(db, {
    intentId: intent.id,
    to: intentStatus,
    reason: `Attempt ${status}`,
    actorKind: "PROVIDER",
    settledAt: intentStatus === "SUCCEEDED" ? new Date() : null,
  });

  return {
    ok: true,
    attemptId: attempt.id,
    status,
    intentStatus,
    providerRef: result.providerRef,
    checkoutUrl: result.checkoutUrl,
  };
}

/**
 * Keeps the last three digits only. Enough for a cashier to recognise the
 * number a guest just read out, useless to anyone reading the table.
 */
export function maskPayer(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 3) return "***";
  return `***${trimmed.slice(-3)}`;
}

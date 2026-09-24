/**
 * Payment intent lifecycle.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * Creating an intent is the moment the destination stops being negotiable. The
 * server resolves the merchant, provider account and wallet, freezes that
 * decision onto the row, and from then on the payer can only choose among
 * channels that were already established as valid. Nothing a client sends can
 * influence where the money lands.
 *
 * Transitions are guarded by the state machine in types.ts and applied with a
 * conditional update, so two callbacks racing each other cannot both win.
 */

import { randomBytes } from "node:crypto";

import { checkOrchestrationGate } from "./config.js";
import { resolveMerchantLink, resolvePayableMerchant, type MerchantRefusalCode } from "./merchants.js";
import { resolveRoute, type RoutingRefusalCode, type RoutingSnapshot } from "./routing.js";
import { loadRoutingCandidates } from "./routingStore.js";
import {
  canTransitionIntent,
  isIntentStatus,
  type IntentStatus,
  type PaymentChannel,
  type PaymentPurpose,
  type PaymentSourceType,
} from "./types.js";

export type CreateIntentInput = {
  propertyId: number;
  outletId?: number | null;
  purpose: PaymentPurpose;
  sourceType: PaymentSourceType;
  sourceId: number;
  channel: PaymentChannel;
  /**
   * Server-derived balance as a decimal string. Never a client-supplied figure
   * and never a JavaScript float: the caller reads it from the folio, order or
   * reservation it is collecting against.
   */
  amount: string;
  currency: string;
  idempotencyKey: string;
  businessDate?: Date | null;
  shiftId?: number | null;
  expiresAt?: Date | null;
  createdById?: number | null;
  at?: Date;
};

export type CreateIntentRefusalCode =
  | "orchestration_disabled"
  | "production_not_authorized"
  | "invalid_amount"
  | "idempotency_key_conflict"
  | RoutingRefusalCode
  | MerchantRefusalCode;

export type CreateIntentResult =
  | {
      ok: true;
      /** True when an existing intent was returned instead of a new one. */
      reused: boolean;
      intentId: number;
      reference: string;
      connectionId: number;
      snapshot: RoutingSnapshot;
    }
  | { ok: false; code: CreateIntentRefusalCode; message: string };

/** Public reference. Short enough for the VarChar(40) column and for a receipt. */
function generateReference(): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = randomBytes(4).toString("hex").toUpperCase();
  return `PI-${time}-${random}`;
}

/**
 * Rejects anything that is not a plain positive decimal.
 *
 * Guards against a float arriving as "1e3", a negative collection, and the
 * scientific-notation strings that Number.toString produces for very large or
 * very small values, any of which would be stored as a Decimal that does not
 * mean what the caller intended.
 */
function isValidAmount(value: string): boolean {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) return false;
  return Number(value) > 0;
}

async function withTransaction<T>(db: any, run: (tx: any) => Promise<T>): Promise<T> {
  // A caller inside an interactive transaction passes the tx itself, which has
  // no $transaction method. Nesting one would deadlock, so reuse it.
  if (typeof db.$transaction !== "function") return run(db);
  return db.$transaction(async (tx: any) => run(tx));
}

async function writeAudit(
  tx: any,
  input: {
    entityType: string;
    entityId: number;
    action: string;
    actorKind?: "USER" | "SYSTEM" | "PROVIDER";
    actorUserId?: number | null;
    previousState?: string | null;
    nextState?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  await tx.merchantAuditEvent.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      actorKind: input.actorKind ?? "SYSTEM",
      actorUserId: input.actorUserId ?? null,
      previousState: input.previousState ?? null,
      nextState: input.nextState ?? null,
      reason: input.reason ?? null,
      metadata: (input.metadata ?? null) as any,
    },
  });
}

/**
 * Creates a payment intent, or returns the one this idempotency key already
 * produced.
 *
 * The idempotency branch is what makes a double-submitted checkout safe: the
 * second request resolves to the first intent rather than opening a second
 * collection against the same folio.
 */
export async function createPaymentIntent(
  db: any,
  input: CreateIntentInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<CreateIntentResult> {
  const gate = checkOrchestrationGate(env);
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message };

  if (!isValidAmount(input.amount)) {
    return { ok: false, code: "invalid_amount", message: "The payment amount is not valid." };
  }

  const at = input.at ?? new Date();
  const currency = String(input.currency || "").toUpperCase();

  const existing = await db.paymentIntent.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: {
      id: true,
      reference: true,
      sourceType: true,
      sourceId: true,
      amount: true,
      currency: true,
      routingSnapshot: true,
    },
  });

  if (existing) {
    // Same key, different payment. Returning the original would collect the
    // wrong amount; creating a new one would break the key's promise. Refuse.
    const sameTarget =
      existing.sourceType === input.sourceType &&
      existing.sourceId === input.sourceId &&
      existing.currency === currency &&
      Number(existing.amount) === Number(input.amount);

    if (!sameTarget) {
      return {
        ok: false,
        code: "idempotency_key_conflict",
        message: "This payment reference was already used for a different payment.",
      };
    }

    const snapshot = existing.routingSnapshot as RoutingSnapshot | null;
    return {
      ok: true,
      reused: true,
      intentId: existing.id,
      reference: existing.reference,
      connectionId: snapshot?.connectionId ?? 0,
      snapshot: snapshot as RoutingSnapshot,
    };
  }

  // The merchant link is resolved first because routing rules are scoped by
  // merchant, and validated again below once a connection is chosen. Two cheap
  // reads, in exchange for not having to guess a connection before routing.
  const link = await resolveMerchantLink(db, {
    propertyId: input.propertyId,
    outletId: input.outletId ?? null,
    at,
  });
  if (!link) {
    return {
      ok: false,
      code: "no_merchant_link",
      message: "Online payment is not available for this property.",
    };
  }

  const candidates = await loadRoutingCandidates(db, {
    merchantId: link.merchantId,
    propertyId: input.propertyId,
    outletId: input.outletId ?? null,
  });

  const route = resolveRoute(candidates, {
    merchantId: link.merchantId,
    propertyId: input.propertyId,
    outletId: input.outletId ?? null,
    purpose: input.purpose,
    currency,
    channel: input.channel,
    at,
  });
  if (!route.ok) return { ok: false, code: route.code, message: route.message };

  const payable = await resolvePayableMerchant(db, {
    propertyId: input.propertyId,
    outletId: input.outletId ?? null,
    connectionId: route.connectionId,
    channel: input.channel,
    currency,
    at,
  });
  if (!payable.ok) return { ok: false, code: payable.code, message: payable.message };

  const reference = generateReference();

  const created = await withTransaction(db, async (tx: any) => {
    const intent = await tx.paymentIntent.create({
      data: {
        reference,
        idempotencyKey: input.idempotencyKey,
        merchantId: payable.merchant.merchantId,
        providerAccountId: payable.merchant.providerAccountId,
        walletId: payable.merchant.walletId,
        propertyId: input.propertyId,
        purpose: input.purpose,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        amount: input.amount,
        currency,
        // The route and the destination are both resolved, so eligibility is
        // established rather than merely created.
        status: "ELIGIBILITY_CHECKED" satisfies IntentStatus,
        routingSnapshot: {
          ...route.snapshot,
          providerMerchantId: payable.merchant.providerMerchantId,
          providerWalletId: payable.merchant.providerWalletId,
        } as any,
        businessDate: input.businessDate ?? null,
        shiftId: input.shiftId ?? null,
        expiresAt: input.expiresAt ?? null,
        createdById: input.createdById ?? null,
      },
      select: { id: true, reference: true },
    });

    await writeAudit(tx, {
      entityType: "INTENT",
      entityId: intent.id,
      action: "INTENT_CREATED",
      actorKind: input.createdById ? "USER" : "SYSTEM",
      actorUserId: input.createdById ?? null,
      nextState: "ELIGIBILITY_CHECKED",
      metadata: {
        purpose: input.purpose,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        connectionId: route.connectionId,
        provider: route.provider,
      },
    });

    return intent;
  });

  return {
    ok: true,
    reused: false,
    intentId: created.id,
    reference: created.reference,
    connectionId: route.connectionId,
    snapshot: route.snapshot,
  };
}

export type TransitionRefusalCode = "intent_not_found" | "illegal_transition" | "concurrent_update";

export type TransitionResult =
  | { ok: true; changed: boolean; status: IntentStatus }
  | { ok: false; code: TransitionRefusalCode; message: string; currentStatus?: IntentStatus };

/**
 * Moves an intent to a new status, or refuses.
 *
 * The update is conditional on the status still being what was read, so a
 * second callback arriving concurrently cannot overwrite the first one's
 * result. A repeated event for a status the intent already holds is reported
 * as a successful no-op, because providers resend events routinely and that
 * must be harmless.
 */
export async function transitionIntent(
  db: any,
  input: {
    intentId: number;
    to: IntentStatus;
    reason?: string | null;
    actorKind?: "USER" | "SYSTEM" | "PROVIDER";
    actorUserId?: number | null;
    settledAt?: Date | null;
  }
): Promise<TransitionResult> {
  const current = await db.paymentIntent.findUnique({
    where: { id: input.intentId },
    select: { id: true, status: true },
  });
  if (!current) {
    return { ok: false, code: "intent_not_found", message: "Payment not found." };
  }

  if (!isIntentStatus(current.status)) {
    return {
      ok: false,
      code: "illegal_transition",
      message: "Payment is in an unrecognised state.",
    };
  }

  if (current.status === input.to) {
    return { ok: true, changed: false, status: current.status };
  }

  if (!canTransitionIntent(current.status, input.to)) {
    return {
      ok: false,
      code: "illegal_transition",
      message: "That payment status change is not allowed.",
      currentStatus: current.status,
    };
  }

  return withTransaction(db, async (tx: any) => {
    const applied = await tx.paymentIntent.updateMany({
      // The status predicate is the concurrency control. Without it, two
      // events read the same state and both write, and the later one wins by
      // accident rather than by rule.
      where: { id: input.intentId, status: current.status },
      data: {
        status: input.to,
        ...(input.settledAt ? { settledAt: input.settledAt } : {}),
      },
    });

    if (applied.count === 0) {
      return {
        ok: false as const,
        code: "concurrent_update" as const,
        message: "This payment was updated by another process. Retry.",
        currentStatus: current.status,
      };
    }

    await writeAudit(tx, {
      entityType: "INTENT",
      entityId: input.intentId,
      action: "INTENT_STATUS_CHANGED",
      actorKind: input.actorKind ?? "SYSTEM",
      actorUserId: input.actorUserId ?? null,
      previousState: current.status,
      nextState: input.to,
      reason: input.reason ?? null,
    });

    return { ok: true as const, changed: true, status: input.to };
  });
}

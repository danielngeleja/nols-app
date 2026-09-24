/**
 * End-to-end lifecycle across the whole orchestration core.
 *
 * Every other test file exercises one module. This one wires the real
 * createPaymentIntent, startPaymentAttempt, adapter and ingestProviderEvent
 * together against the simulator and drives a payment from nothing to settled,
 * then re-delivers the callback and delivers a late contradictory one.
 *
 * It exists because the individually-correct-but-jointly-wrong failure is the
 * one that reaches production: a duplicate callback that settles twice, or a
 * late failure that unsettles a paid folio, only shows up when the pieces run
 * together.
 */

import { describe, expect, it } from "vitest";

import { startPaymentAttempt } from "./attempts.js";
import { ingestProviderEvent } from "./inbox.js";
import { createPaymentIntent } from "./intents.js";
import { FakePaymentProvider } from "./providers/fake.js";

const ENABLED = {
  PAYMENTS_ORCHESTRATION_ENABLED: "true",
  PAYMENTS_ORCHESTRATION_ENVIRONMENT: "SANDBOX",
};

const PAST = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-09-04T10:00:00Z");

/** Forces the simulator down the awaiting-customer path, like a real MNO push. */
const REFERENCE = "PI-LIFECYCLE-ACTION";

const CONNECTION = {
  id: 10,
  provider: "FAKE",
  environment: "SANDBOX",
  isEnabled: true,
  capabilities: { channels: ["MNO"], currencies: ["TZS"] },
};

function lifecycleDb() {
  const intents = new Map<number, any>();
  const attempts: any[] = [];
  const inbox = new Map<number, any>();
  const audits: any[] = [];
  let nextIntentId = 500;
  let nextAttemptId = 1;
  let nextInboxId = 1;

  const db: any = {
    _intents: intents,
    _attempts: attempts,
    _inbox: inbox,
    _audits: audits,

    paymentIntent: {
      findUnique: async ({ where }: any) => {
        if (where.id !== undefined) return intents.get(where.id) ?? null;
        if (where.idempotencyKey !== undefined) {
          return [...intents.values()].find((i) => i.idempotencyKey === where.idempotencyKey) ?? null;
        }
        return null;
      },
      create: async ({ data }: any) => {
        const id = nextIntentId++;
        // Pinned so the simulator's scenario directive is under test control.
        const row = { ...data, id, reference: REFERENCE, settledAt: null };
        intents.set(id, row);
        return { id, reference: row.reference };
      },
      updateMany: async ({ where, data }: any) => {
        const row = intents.get(where.id);
        if (!row || (where.status && row.status !== where.status)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },

    paymentAttempt: {
      findMany: async ({ where }: any) =>
        attempts.filter((a) => a.intentId === where.intentId).map((a) => ({
          normalizedStatus: a.normalizedStatus,
        })),
      findUnique: async ({ where }: any) =>
        attempts.find((a) => a.providerRef && a.providerRef === where.providerRef) ?? null,
      create: async ({ data }: any) => {
        const row = { id: nextAttemptId++, providerRef: null, ...data };
        attempts.push(row);
        return { id: row.id };
      },
      update: async ({ where, data }: any) => {
        const row = attempts.find((a) => a.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },

    providerEventInbox: {
      create: async ({ data }: any) => {
        const clash = [...inbox.values()].find(
          (r) => r.connectionId === data.connectionId && r.providerEventId === data.providerEventId
        );
        if (clash) {
          const error: any = new Error("Unique constraint failed");
          error.code = "P2002";
          throw error;
        }
        const row = { id: nextInboxId++, matchedIntentId: null, ...data };
        inbox.set(row.id, row);
        return { id: row.id, processingState: row.processingState, matchedIntentId: null };
      },
      findUnique: async ({ where }: any) => {
        const key = where.connectionId_providerEventId;
        return (
          [...inbox.values()].find(
            (r) => r.connectionId === key.connectionId && r.providerEventId === key.providerEventId
          ) ?? null
        );
      },
      update: async ({ where, data }: any) => {
        const row = inbox.get(where.id);
        Object.assign(row, data);
        return row;
      },
    },

    merchantPropertyLink: {
      findMany: async () => [
        { merchantId: 7, outletId: null, effectiveFrom: PAST, effectiveTo: null },
      ],
    },
    merchantLegalEntity: { findUnique: async () => ({ id: 7, status: "ACTIVE" }) },
    merchantProviderAccount: {
      findUnique: async () => ({ id: 31, status: "ACTIVE", providerMerchantId: "PM-1" }),
    },
    merchantChannelCapability: { findUnique: async () => ({ isEnabled: true }) },
    merchantWallet: {
      findMany: async () => [{ id: 44, providerWalletId: "PW-1", isDefault: true }],
    },
    paymentRoutingRule: {
      findMany: async () => [
        {
          id: 1,
          scopeType: "GLOBAL",
          scopeId: null,
          purpose: null,
          currency: null,
          channel: null,
          priority: 100,
          isActive: true,
          effectiveFrom: PAST,
          effectiveTo: null,
          connection: CONNECTION,
        },
      ],
    },
    merchantAuditEvent: {
      create: async ({ data }: any) => {
        audits.push(data);
        return data;
      },
    },
    $transaction: async (fn: any) => fn(db),
  };

  return db;
}

/** Builds a signed callback and runs it through the adapter's real verifier. */
async function deliver(
  db: any,
  adapter: FakePaymentProvider,
  body: Record<string, unknown>
) {
  const rawBody = JSON.stringify(body);
  const verification = await adapter.verifyAndNormalizeWebhook({
    rawBody,
    headers: { "x-fake-signature": adapter.signPayload(rawBody) },
  });
  expect(verification.ok).toBe(true);
  if (!verification.ok) throw new Error("verification failed");
  return ingestProviderEvent(db, CONNECTION.id, verification.event);
}

describe("a payment from nothing to settled", () => {
  it("carries an MNO push through intent, attempt and callback", async () => {
    const db = lifecycleDb();
    const adapter = new FakePaymentProvider({ environment: "SANDBOX" });

    // 1. The intent resolves its own destination and freezes it.
    const intent = await createPaymentIntent(
      db,
      {
        propertyId: 55,
        purpose: "ACCOMMODATION",
        sourceType: "RESERVATION",
        sourceId: 900,
        channel: "MNO",
        amount: "180000.00",
        currency: "TZS",
        idempotencyKey: "lifecycle-1",
        at: NOW,
      },
      ENABLED
    );
    expect(intent.ok).toBe(true);
    if (!intent.ok) return;
    expect(db._intents.get(intent.intentId).status).toBe("ELIGIBILITY_CHECKED");

    // 2. The attempt reaches the provider; the guest now holds a PIN prompt.
    const attempt = await startPaymentAttempt(
      db,
      adapter,
      { intentId: intent.intentId, channel: "MNO", payerReference: "+255754123456" },
      ENABLED
    );
    expect(attempt).toMatchObject({
      ok: true,
      status: "REQUIRES_CUSTOMER_ACTION",
      intentStatus: "PROCESSING",
    });
    if (!attempt.ok) return;

    // Not settled by the initiation response. This is the rule the whole
    // design turns on.
    expect(db._intents.get(intent.intentId).status).toBe("PROCESSING");
    expect(db._intents.get(intent.intentId).settledAt).toBeNull();

    // 3. The guest enters their PIN and the provider calls back.
    const settled = await deliver(db, adapter, {
      eventId: "evt-settle-1",
      eventType: "PAYMENT",
      status: "SUCCEEDED",
      providerRef: attempt.providerRef,
      merchantId: "PM-1",
      amount: "180000.00",
      currency: "TZS",
      occurredAt: "2026-09-04T10:05:00.000Z",
    });

    expect(settled).toMatchObject({ ok: true, state: "PROCESSED", changed: true });
    expect(db._intents.get(intent.intentId).status).toBe("SUCCEEDED");
    expect(db._intents.get(intent.intentId).settledAt).toEqual(
      new Date("2026-09-04T10:05:00.000Z")
    );

    // 4. The provider redelivers the same event, as providers do.
    const repeat = await deliver(db, adapter, {
      eventId: "evt-settle-1",
      eventType: "PAYMENT",
      status: "SUCCEEDED",
      providerRef: attempt.providerRef,
      merchantId: "PM-1",
      amount: "180000.00",
      currency: "TZS",
      occurredAt: "2026-09-04T10:05:00.000Z",
    });
    expect(repeat).toMatchObject({ ok: true, state: "DUPLICATE" });
    expect(db._intents.get(intent.intentId).status).toBe("SUCCEEDED");

    // 5. A late, contradictory failure arrives out of order.
    const late = await deliver(db, adapter, {
      eventId: "evt-late-fail",
      eventType: "PAYMENT",
      status: "FAILED",
      providerRef: attempt.providerRef,
      merchantId: "PM-1",
      amount: "180000.00",
      currency: "TZS",
    });
    expect(late).toMatchObject({ ok: true, state: "REVIEW" });
    // The paid folio stays paid, and a human gets to look at the contradiction.
    expect(db._intents.get(intent.intentId).status).toBe("SUCCEEDED");

    // 6. No second collection can start against a settled intent.
    const retry = await startPaymentAttempt(
      db,
      adapter,
      { intentId: intent.intentId, channel: "MNO" },
      ENABLED
    );
    expect(retry).toMatchObject({ ok: false, code: "intent_not_eligible" });
    expect(db._attempts).toHaveLength(1);
  });

  it("resolves a double-submitted checkout to one intent and one attempt", async () => {
    const db = lifecycleDb();
    const adapter = new FakePaymentProvider({ environment: "SANDBOX" });

    const input = {
      propertyId: 55,
      purpose: "ACCOMMODATION" as const,
      sourceType: "RESERVATION" as const,
      sourceId: 900,
      channel: "MNO" as const,
      amount: "180000.00",
      currency: "TZS",
      idempotencyKey: "double-submit",
      at: NOW,
    };

    const first = await createPaymentIntent(db, input, ENABLED);
    const second = await createPaymentIntent(db, input, ENABLED);

    expect(first).toMatchObject({ ok: true, reused: false });
    expect(second).toMatchObject({ ok: true, reused: true });
    expect(db._intents.size).toBe(1);

    if (!first.ok) return;
    await startPaymentAttempt(db, adapter, { intentId: first.intentId, channel: "MNO" }, ENABLED);
    const secondAttempt = await startPaymentAttempt(
      db,
      adapter,
      { intentId: first.intentId, channel: "MNO" },
      ENABLED
    );

    expect(secondAttempt).toMatchObject({ ok: false, code: "attempt_in_flight" });
    expect(db._attempts).toHaveLength(1);
  });
});

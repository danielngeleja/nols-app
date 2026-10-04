import { describe, expect, it } from "vitest";

import type { PaymentProviderAdapter } from "./adapter.js";
import { intentStatusForAttempt, maskPayer, startPaymentAttempt } from "./attempts.js";
import { FakePaymentProvider } from "./providers/fake.js";

const ENABLED = {
  PAYMENTS_ORCHESTRATION_ENABLED: "true",
  PAYMENTS_ORCHESTRATION_ENVIRONMENT: "SANDBOX",
};

const SNAPSHOT = {
  connectionId: 10,
  provider: "FAKE",
  environment: "SANDBOX",
  providerMerchantId: "PM-1",
  providerWalletId: "PW-1",
};

/**
 * Small in-memory stand-in. Stateful on purpose: the attempt service drives
 * real intent transitions, so a stubbed-out database would not exercise the
 * guard that matters.
 */
function memoryDb(options: { reference?: string; status?: string; snapshot?: unknown } = {}) {
  const intents = new Map<number, any>();
  intents.set(500, {
    id: 500,
    reference: options.reference ?? "PI-TEST-OK",
    status: options.status ?? "ELIGIBILITY_CHECKED",
    amount: "180000.00",
    currency: "TZS",
    routingSnapshot: options.snapshot === undefined ? SNAPSHOT : options.snapshot,
    settledAt: null,
  });

  const attempts: any[] = [];
  const audits: any[] = [];
  let nextAttemptId = 1;

  const db: any = {
    _attempts: attempts,
    _audits: audits,
    _intent: () => intents.get(500),
    paymentIntent: {
      findUnique: async ({ where }: any) => intents.get(where.id) ?? null,
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
      create: async ({ data }: any) => {
        const row = { id: nextAttemptId++, ...data };
        attempts.push(row);
        return { id: row.id };
      },
      update: async ({ where, data }: any) => {
        const row = attempts.find((a) => a.id === where.id);
        Object.assign(row, data);
        return row;
      },
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

function provider() {
  return new FakePaymentProvider({ environment: "SANDBOX" });
}

/**
 * A real adapter whose initiation throws. Built by delegation rather than by
 * spreading an instance, because class methods live on the prototype and a
 * spread would silently drop them.
 */
function throwingAdapter(message: string): PaymentProviderAdapter {
  const inner = provider();
  return {
    provider: inner.provider,
    environment: inner.environment,
    getCapabilities: () => inner.getCapabilities(),
    createPaymentAttempt: async () => {
      throw new Error(message);
    },
    verifyAndNormalizeWebhook: (request) => inner.verifyAndNormalizeWebhook(request),
  };
}

describe("status mapping", () => {
  it("collapses REQUIRES_CUSTOMER_ACTION onto PROCESSING", () => {
    // The intent tracks the money, not the handset.
    expect(intentStatusForAttempt("REQUIRES_CUSTOMER_ACTION")).toBe("PROCESSING");
    expect(intentStatusForAttempt("PROCESSING")).toBe("PROCESSING");
  });

  it("maps every terminal outcome one to one", () => {
    expect(intentStatusForAttempt("SUCCEEDED")).toBe("SUCCEEDED");
    expect(intentStatusForAttempt("FAILED")).toBe("FAILED");
    expect(intentStatusForAttempt("EXPIRED")).toBe("EXPIRED");
    expect(intentStatusForAttempt("CANCELLED")).toBe("CANCELLED");
    expect(intentStatusForAttempt("STATUS_UNKNOWN")).toBe("STATUS_UNKNOWN");
  });
});

describe("end to end against the simulator", () => {
  it("settles a successful attempt and stamps settledAt", async () => {
    const db = memoryDb({ reference: "PI-1-OK" });
    const result = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);

    expect(result).toMatchObject({ ok: true, status: "SUCCEEDED", intentStatus: "SUCCEEDED" });
    expect(db._intent().status).toBe("SUCCEEDED");
    expect(db._intent().settledAt).toBeInstanceOf(Date);
  });

  it("records an explicit provider rejection as FAILED", async () => {
    const db = memoryDb({ reference: "PI-2-FAIL" });
    const result = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);

    expect(result).toMatchObject({ ok: true, status: "FAILED", intentStatus: "FAILED" });
    expect(db._attempts[0].failureCode).toBe("fake_declined");
  });

  it("leaves an awaiting-customer attempt with the intent PROCESSING and open", async () => {
    const db = memoryDb({ reference: "PI-3-ACTION" });
    const result = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);

    expect(result).toMatchObject({ status: "REQUIRES_CUSTOMER_ACTION", intentStatus: "PROCESSING" });
    expect(db._attempts[0].completedAt).toBeInstanceOf(Date);
    expect(db._intent().settledAt).toBeNull();
  });

  it("returns a checkout url for a redirect channel", async () => {
    const db = memoryDb({ reference: "PI-4-OK" });
    const result = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "CARD" }, ENABLED);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.checkoutUrl).toContain("/checkout/");
  });
});

describe("uncertainty is never reported as failure", () => {
  it("records a thrown transport error as STATUS_UNKNOWN, not FAILED", async () => {
    // A thrown call may or may not have reached the provider. Calling that
    // FAILED would invite an immediate retry and a double charge.
    const db = memoryDb();
    const result = await startPaymentAttempt(
      db,
      throwingAdapter("socket hang up"),
      { intentId: 500, channel: "MNO" },
      ENABLED
    );

    expect(result).toMatchObject({ ok: true, status: "STATUS_UNKNOWN", intentStatus: "STATUS_UNKNOWN" });
    expect(db._intent().status).toBe("STATUS_UNKNOWN");
    expect(db._attempts[0].providerStatus).toBe("transport_error");
  });

  it("still leaves an attempt row behind when the call throws", async () => {
    // The row is written before the call precisely so this evidence survives.
    const db = memoryDb();
    await startPaymentAttempt(db, throwingAdapter("timeout"), { intentId: 500, channel: "MNO" }, ENABLED);

    expect(db._attempts).toHaveLength(1);
    expect(db._attempts[0].requestHash).toHaveLength(64);
  });
});

describe("in-flight protection", () => {
  it("refuses a second attempt while one may already have moved money", async () => {
    const db = memoryDb({ reference: "PI-5-ACTION" });
    const first = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);
    expect(first.ok).toBe(true);

    const second = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);
    expect(second).toMatchObject({ ok: false, code: "attempt_in_flight" });
    expect(db._attempts).toHaveLength(1);
  });

  it("refuses after an unknown attempt, which is the double-charge case", async () => {
    const db = memoryDb({ reference: "PI-6-UNKNOWN" });
    await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);

    const second = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);
    expect(second).toMatchObject({ ok: false, code: "attempt_in_flight" });
  });

  it("treats an unrecognised stored attempt status as blocking", async () => {
    const db = memoryDb();
    db.paymentAttempt.findMany = async () => [{ normalizedStatus: "SOMETHING_NEW" }];

    const result = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);
    expect(result).toMatchObject({ ok: false, code: "attempt_in_flight" });
  });
});

describe("guards before any call", () => {
  it("refuses when the gate is off", async () => {
    const db = memoryDb();
    const result = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, {});
    expect(result).toMatchObject({ ok: false, code: "orchestration_disabled" });
    expect(db._attempts).toHaveLength(0);
  });

  it("refuses an intent that is already settled", async () => {
    const db = memoryDb({ status: "SUCCEEDED" });
    const result = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);
    expect(result).toMatchObject({ ok: false, code: "intent_not_eligible" });
  });

  it("refuses a missing intent", async () => {
    const db = memoryDb();
    const result = await startPaymentAttempt(db, provider(), { intentId: 999, channel: "MNO" }, ENABLED);
    expect(result).toMatchObject({ ok: false, code: "intent_not_found" });
  });

  it("refuses an intent whose routing snapshot is incomplete", async () => {
    const db = memoryDb({ snapshot: { connectionId: 10, provider: "FAKE", environment: "SANDBOX" } });
    const result = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);
    expect(result).toMatchObject({ ok: false, code: "missing_routing_snapshot" });
  });

  it("refuses an adapter that is not the provider the intent was routed to", async () => {
    // Handing an intent to a different provider is the automatic failover the
    // design record forbids.
    const db = memoryDb({ snapshot: { ...SNAPSHOT, provider: "AZAMPAY" } });
    const result = await startPaymentAttempt(db, provider(), { intentId: 500, channel: "MNO" }, ENABLED);
    expect(result).toMatchObject({ ok: false, code: "provider_mismatch" });
    expect(db._attempts).toHaveLength(0);
  });

  it("refuses a channel the provider does not declare", async () => {
    const db = memoryDb();
    const narrow = new FakePaymentProvider({
      environment: "SANDBOX",
      capabilities: { channels: ["CARD"] },
    });
    const result = await startPaymentAttempt(db, narrow, { intentId: 500, channel: "MNO" }, ENABLED);
    expect(result).toMatchObject({ ok: false, code: "channel_not_supported" });
    expect(db._attempts).toHaveLength(0);
  });
});

describe("payer masking", () => {
  it("keeps only the last three digits", () => {
    expect(maskPayer("+255754123456")).toBe("***456");
    expect(maskPayer("12")).toBe("***");
    expect(maskPayer(undefined)).toBeNull();
  });

  it("stores only the masked form on the attempt", async () => {
    const db = memoryDb({ reference: "PI-7-OK" });
    await startPaymentAttempt(
      db,
      provider(),
      { intentId: 500, channel: "MNO", payerReference: "+255754123456" },
      ENABLED
    );
    expect(db._attempts[0].payerMasked).toBe("***456");
  });
});

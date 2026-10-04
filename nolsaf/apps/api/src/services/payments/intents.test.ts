import { describe, expect, it, vi } from "vitest";

import { createPaymentIntent, transitionIntent, type CreateIntentInput } from "./intents.js";

const NOW = new Date("2026-09-04T10:00:00Z");
const PAST = new Date("2026-01-01T00:00:00Z");

const ENABLED = {
  PAYMENTS_ORCHESTRATION_ENABLED: "true",
  PAYMENTS_ORCHESTRATION_ENVIRONMENT: "SANDBOX",
};

const CAPABLE_CONNECTION = {
  id: 10,
  provider: "FAKE",
  environment: "SANDBOX",
  isEnabled: true,
  capabilities: { channels: ["MNO", "CARD"], currencies: ["TZS"] },
};

function fakeDb(overrides: Record<string, any> = {}) {
  const created: any[] = [];
  const audits: any[] = [];

  const db: any = {
    _created: created,
    _audits: audits,
    paymentIntent: {
      findUnique: overrides.existingIntent
        ? async () => overrides.existingIntent
        : async () => null,
      create: async ({ data, select }: any) => {
        created.push(data);
        const row = { id: 500, reference: data.reference };
        return select ? row : { ...data, ...row };
      },
      updateMany: overrides.updateMany ?? (async () => ({ count: 1 })),
    },
    merchantPropertyLink: {
      findMany: async () =>
        overrides.links ?? [
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
      findMany: async () =>
        overrides.rules ?? [
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
            connection: CAPABLE_CONNECTION,
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

  return Object.assign(db, overrides.db ?? {});
}

function input(overrides: Partial<CreateIntentInput> = {}): CreateIntentInput {
  return {
    propertyId: 55,
    outletId: null,
    purpose: "ACCOMMODATION",
    sourceType: "RESERVATION",
    sourceId: 900,
    channel: "MNO",
    amount: "180000.00",
    currency: "TZS",
    idempotencyKey: "idem-1",
    at: NOW,
    ...overrides,
  };
}

describe("the feature gate is checked before anything else", () => {
  it("refuses without touching the database when disabled", async () => {
    const db = fakeDb();
    const spy = vi.spyOn(db.merchantPropertyLink, "findMany");
    const result = await createPaymentIntent(db, input(), {});
    expect(result).toMatchObject({ ok: false, code: "orchestration_disabled" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("amount validation", () => {
  it("rejects zero, negative, over-precise and exponent amounts", async () => {
    const db = fakeDb();
    for (const amount of ["0", "0.00", "-5.00", "1.234", "1e3", "abc", ""]) {
      const result = await createPaymentIntent(db, input({ amount }), ENABLED);
      expect(result, `${amount} must be rejected`).toMatchObject({
        ok: false,
        code: "invalid_amount",
      });
    }
  });

  it("accepts a plain positive decimal", async () => {
    const db = fakeDb();
    expect((await createPaymentIntent(db, input({ amount: "1" }), ENABLED)).ok).toBe(true);
  });
});

describe("intent creation", () => {
  it("freezes the resolved destination onto the row", async () => {
    const db = fakeDb();
    const result = await createPaymentIntent(db, input(), ENABLED);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reused).toBe(false);

    const row = db._created[0];
    expect(row).toMatchObject({
      merchantId: 7,
      providerAccountId: 31,
      walletId: 44,
      status: "ELIGIBILITY_CHECKED",
      currency: "TZS",
    });
    // The provider-native destination is snapshotted, so the question "why did
    // this payment go there?" stays answerable from the row alone.
    expect(row.routingSnapshot).toMatchObject({
      connectionId: 10,
      provider: "FAKE",
      providerMerchantId: "PM-1",
      providerWalletId: "PW-1",
      channel: "MNO",
    });
  });

  it("writes an audit event for the creation", async () => {
    const db = fakeDb();
    await createPaymentIntent(db, input(), ENABLED);
    expect(db._audits[0]).toMatchObject({
      entityType: "INTENT",
      action: "INTENT_CREATED",
      nextState: "ELIGIBILITY_CHECKED",
    });
  });

  it("uppercases the currency before storing and routing", async () => {
    const db = fakeDb();
    await createPaymentIntent(db, input({ currency: "tzs" }), ENABLED);
    expect(db._created[0].currency).toBe("TZS");
  });

  it("refuses when routing finds nothing, without creating a row", async () => {
    const db = fakeDb({ rules: [] });
    const result = await createPaymentIntent(db, input(), ENABLED);
    expect(result).toMatchObject({ ok: false, code: "no_matching_rule" });
    expect(db._created).toHaveLength(0);
  });

  it("refuses when the property has no merchant link", async () => {
    const db = fakeDb({ links: [] });
    const result = await createPaymentIntent(db, input(), ENABLED);
    expect(result).toMatchObject({ ok: false, code: "no_merchant_link" });
    expect(db._created).toHaveLength(0);
  });
});

describe("idempotency", () => {
  const existing = {
    id: 500,
    reference: "PI-EXISTING",
    sourceType: "RESERVATION",
    sourceId: 900,
    amount: "180000.00",
    currency: "TZS",
    routingSnapshot: { connectionId: 10 },
  };

  it("returns the original intent for a repeated key, without creating a second", async () => {
    const db = fakeDb({ existingIntent: existing });
    const result = await createPaymentIntent(db, input(), ENABLED);

    expect(result).toMatchObject({ ok: true, reused: true, intentId: 500, reference: "PI-EXISTING" });
    expect(db._created).toHaveLength(0);
  });

  it("refuses when the same key names a different payment", async () => {
    // Returning the original would collect the wrong amount; creating a new
    // one would break the key's promise. Neither is acceptable.
    const db = fakeDb({ existingIntent: existing });

    const differentAmount = await createPaymentIntent(db, input({ amount: "999.00" }), ENABLED);
    const differentSource = await createPaymentIntent(db, input({ sourceId: 901 }), ENABLED);

    expect(differentAmount).toMatchObject({ ok: false, code: "idempotency_key_conflict" });
    expect(differentSource).toMatchObject({ ok: false, code: "idempotency_key_conflict" });
    expect(db._created).toHaveLength(0);
  });
});

describe("transitions", () => {
  function transitionDb(status: string, updateMany?: any) {
    return fakeDb({
      db: {
        paymentIntent: {
          findUnique: async () => ({ id: 500, status }),
          create: async () => ({ id: 500 }),
          updateMany: updateMany ?? (async () => ({ count: 1 })),
        },
      },
    });
  }

  it("applies a legal transition and audits it", async () => {
    const db = transitionDb("PROCESSING");
    const result = await transitionIntent(db, { intentId: 500, to: "SUCCEEDED" });

    expect(result).toMatchObject({ ok: true, changed: true, status: "SUCCEEDED" });
    expect(db._audits[0]).toMatchObject({
      action: "INTENT_STATUS_CHANGED",
      previousState: "PROCESSING",
      nextState: "SUCCEEDED",
    });
  });

  it("refuses to let a late failure overwrite a settled payment", async () => {
    const db = transitionDb("SUCCEEDED");
    const result = await transitionIntent(db, { intentId: 500, to: "FAILED" });

    expect(result).toMatchObject({ ok: false, code: "illegal_transition", currentStatus: "SUCCEEDED" });
    expect(db._audits).toHaveLength(0);
  });

  it("treats a repeated event as a successful no-op", async () => {
    const db = transitionDb("SUCCEEDED");
    const result = await transitionIntent(db, { intentId: 500, to: "SUCCEEDED" });

    expect(result).toMatchObject({ ok: true, changed: false });
    expect(db._audits).toHaveLength(0);
  });

  it("detects a concurrent update instead of overwriting it", async () => {
    // Two callbacks read the same state; only one may write.
    const db = transitionDb("PROCESSING", async () => ({ count: 0 }));
    const result = await transitionIntent(db, { intentId: 500, to: "SUCCEEDED" });

    expect(result).toMatchObject({ ok: false, code: "concurrent_update" });
    expect(db._audits).toHaveLength(0);
  });

  it("reports a missing intent", async () => {
    const db = fakeDb({
      db: { paymentIntent: { findUnique: async () => null, create: async () => ({}), updateMany: async () => ({ count: 0 }) } },
    });
    expect(await transitionIntent(db, { intentId: 999, to: "SUCCEEDED" })).toMatchObject({
      ok: false,
      code: "intent_not_found",
    });
  });

  it("refuses an unrecognised stored status", async () => {
    const db = transitionDb("SOME_FUTURE_STATE");
    expect(await transitionIntent(db, { intentId: 500, to: "SUCCEEDED" })).toMatchObject({
      ok: false,
      code: "illegal_transition",
    });
  });
});

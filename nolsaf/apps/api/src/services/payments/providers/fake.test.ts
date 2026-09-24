import { describe, expect, it } from "vitest";

import type { CreateAttemptInput } from "../adapter.js";
import { FakePaymentProvider, fakeOutcomeFor } from "./fake.js";

function attemptInput(overrides: Partial<CreateAttemptInput> = {}): CreateAttemptInput {
  return {
    intentReference: "PI-TEST-OK",
    idempotencyKey: "idem-key-1",
    channel: "MNO",
    money: { amount: "180000.00", currency: "TZS" },
    destination: { providerMerchantId: "FAKE-M-1", providerWalletId: "FAKE-W-1" },
    payerReference: "+255754000000",
    ...overrides,
  };
}

describe("production guard", () => {
  it("refuses to construct for a PRODUCTION environment", () => {
    expect(() => new FakePaymentProvider({ environment: "PRODUCTION" })).toThrow(
      /never be constructed in a production environment/
    );
  });

  it("refuses to construct when NODE_ENV is production", () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() => new FakePaymentProvider()).toThrow(/production environment/);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe("deterministic outcomes", () => {
  it("maps a scenario directive to a fixed status", () => {
    expect(fakeOutcomeFor("PI-1-OK")).toBe("SUCCEEDED");
    expect(fakeOutcomeFor("PI-2-FAIL")).toBe("FAILED");
    expect(fakeOutcomeFor("PI-3-UNKNOWN")).toBe("STATUS_UNKNOWN");
    expect(fakeOutcomeFor("PI-4-ACTION")).toBe("REQUIRES_CUSTOMER_ACTION");
    expect(fakeOutcomeFor("PI-5-EXPIRE")).toBe("EXPIRED");
  });

  it("gives an undirected reference the same answer every time", () => {
    // A real sandbox cannot do this: the measured AzamPay disbursement test
    // host returned different results for identical input between runs.
    const first = fakeOutcomeFor("PI-NO-DIRECTIVE-123");
    for (let index = 0; index < 25; index += 1) {
      expect(fakeOutcomeFor("PI-NO-DIRECTIVE-123")).toBe(first);
    }
  });
});

describe("attempt idempotency", () => {
  it("returns the first answer for a repeated idempotency key", async () => {
    const provider = new FakePaymentProvider();
    const first = await provider.createPaymentAttempt(attemptInput());
    const second = await provider.createPaymentAttempt(attemptInput());

    expect(second.providerRef).toBe(first.providerRef);
    expect(second.status).toBe(first.status);
    expect(second.providerStatus).toContain("replayed");
  });

  it("issues a distinct reference for a genuinely different key", async () => {
    const provider = new FakePaymentProvider();
    const first = await provider.createPaymentAttempt(attemptInput({ idempotencyKey: "a" }));
    const second = await provider.createPaymentAttempt(attemptInput({ idempotencyKey: "b" }));
    expect(second.providerRef).not.toBe(first.providerRef);
  });

  it("returns a checkout url only for redirect channels", async () => {
    const provider = new FakePaymentProvider();
    const mno = await provider.createPaymentAttempt(attemptInput({ channel: "MNO" }));
    const card = await provider.createPaymentAttempt(
      attemptInput({ channel: "CARD", idempotencyKey: "card-1" })
    );
    expect(mno.checkoutUrl).toBeUndefined();
    expect(card.checkoutUrl).toContain("/checkout/");
  });
});

describe("status query resolves uncertainty", () => {
  it("settles an attempt that was recorded as unknown", async () => {
    const provider = new FakePaymentProvider();
    const created = await provider.createPaymentAttempt(
      attemptInput({ intentReference: "PI-9-UNKNOWN" })
    );
    expect(created.status).toBe("STATUS_UNKNOWN");

    const status = await provider.getPaymentStatus(created.providerRef!);
    expect(status.status).toBe("SUCCEEDED");
  });

  it("reports notFound for a reference it never issued", async () => {
    const provider = new FakePaymentProvider();
    const status = await provider.getPaymentStatus("FAKE-does-not-exist");
    expect(status).toMatchObject({ status: "STATUS_UNKNOWN", notFound: true });
  });
});

describe("refunds", () => {
  it("refunds a settled payment and is idempotent on the refund reference", async () => {
    const provider = new FakePaymentProvider();
    const created = await provider.createPaymentAttempt(attemptInput());

    const first = await provider.requestRefund({
      providerRef: created.providerRef!,
      refundReference: "RF-1",
      money: { amount: "180000.00", currency: "TZS" },
      reason: "Guest cancelled",
      isPartial: false,
    });
    const second = await provider.requestRefund({
      providerRef: created.providerRef!,
      refundReference: "RF-1",
      money: { amount: "180000.00", currency: "TZS" },
      reason: "Guest cancelled",
      isPartial: false,
    });

    expect(first.status).toBe("COMPLETED");
    expect(second).toEqual(first);
  });

  it("refuses to refund a payment that never settled", async () => {
    const provider = new FakePaymentProvider();
    const created = await provider.createPaymentAttempt(
      attemptInput({ intentReference: "PI-X-FAIL" })
    );
    const refund = await provider.requestRefund({
      providerRef: created.providerRef!,
      refundReference: "RF-2",
      money: { amount: "1.00", currency: "TZS" },
      reason: "test",
      isPartial: true,
    });
    expect(refund).toMatchObject({ status: "FAILED", failureCode: "fake_not_settled" });
  });
});

describe("webhook verification", () => {
  const provider = new FakePaymentProvider();

  function signed(body: Record<string, unknown>) {
    const rawBody = JSON.stringify(body);
    return { rawBody, headers: { "x-fake-signature": provider.signPayload(rawBody) } };
  }

  it("accepts a correctly signed payload and normalizes it", async () => {
    const result = await provider.verifyAndNormalizeWebhook(
      signed({
        eventId: "evt-1",
        eventType: "PAYMENT",
        status: "SUCCEEDED",
        providerRef: "FAKE-abc",
        amount: "180000.00",
        currency: "TZS",
        occurredAt: "2026-09-04T10:00:00.000Z",
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event).toMatchObject({
      provider: "FAKE",
      providerEventId: "evt-1",
      status: "SUCCEEDED",
      signatureVerified: true,
    });
    expect(result.event.payloadDigest).toHaveLength(64);
  });

  it("rejects a missing signature", async () => {
    const result = await provider.verifyAndNormalizeWebhook({
      rawBody: JSON.stringify({ eventId: "evt-2", status: "SUCCEEDED" }),
      headers: {},
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_signature" });
  });

  it("rejects a body altered after signing", async () => {
    // Verification must run over the exact received bytes, never over a
    // re-serialized object.
    const original = signed({ eventId: "evt-3", status: "SUCCEEDED", amount: "100.00" });
    const tampered = {
      rawBody: original.rawBody.replace("100.00", "900.00"),
      headers: original.headers,
    };
    expect(await provider.verifyAndNormalizeWebhook(tampered)).toMatchObject({
      ok: false,
      code: "invalid_signature",
    });
  });

  it("rejects a signed payload carrying an unrecognised status", async () => {
    // Signed third-party data can still be contract-incompatible.
    const result = await provider.verifyAndNormalizeWebhook(
      signed({ eventId: "evt-4", status: "TOTALLY_NEW_STATUS" })
    );
    expect(result).toMatchObject({ ok: false, code: "malformed_payload" });
  });

  it("rejects a signed payload with no event id", async () => {
    const result = await provider.verifyAndNormalizeWebhook(
      signed({ status: "SUCCEEDED" })
    );
    expect(result).toMatchObject({ ok: false, code: "malformed_payload" });
  });

  it("rejects a signed body that is not JSON", async () => {
    const rawBody = "not json at all";
    const result = await provider.verifyAndNormalizeWebhook({
      rawBody,
      headers: { "x-fake-signature": provider.signPayload(rawBody) },
    });
    expect(result).toMatchObject({ ok: false, code: "malformed_payload" });
  });
});

describe("capability narrowing", () => {
  it("can be constructed without refund support to exercise refusal paths", () => {
    const provider = new FakePaymentProvider({ capabilities: { supportsRefund: false } });
    expect(provider.getCapabilities().supportsRefund).toBe(false);
    expect(provider.getCapabilities().channels).toContain("MNO");
  });
});

describe("settlement report", () => {
  it("separates gross, fee and net", async () => {
    const provider = new FakePaymentProvider();
    await provider.createPaymentAttempt(attemptInput({ money: { amount: "1000.00", currency: "TZS" } }));

    const settlements = await provider.fetchSettlements({
      from: new Date("2026-09-01T00:00:00Z"),
      to: new Date("2026-09-30T00:00:00Z"),
    });

    expect(settlements).toHaveLength(1);
    expect(settlements[0]).toMatchObject({
      grossAmount: "1000.00",
      feeAmount: "20.00",
      netAmount: "980.00",
      currency: "TZS",
    });
  });
});

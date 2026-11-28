import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const h = vi.hoisted(() => ({
  prepare: vi.fn(),
  settle: vi.fn(),
  decline: vi.fn(),
  audit: vi.fn(),
  post: vi.fn(),
  parse: vi.fn(),
  decrypt: vi.fn(),
  gate: vi.fn(),
  find: vi.fn(),
  update: vi.fn()
}));
vi.mock("./eventHireBookings.js", async () => {
  const {
    createHash
  } = await import("node:crypto");
  return {
    prepareEventCheckout: h.prepare,
    settleEventCollection: h.settle,
    recordEventDecline: h.decline,
    bookingEvent: h.audit,
    tokenHash: (t: string) => createHash("sha256").update(t).digest("hex"),
    eventFailure: (message: string, code: string, status: number) => {
      throw Object.assign(new Error(message), {
        code,
        status
      });
    }
  };
});
vi.mock("./coralcommerce.helpers.js", () => ({
  coralPostJson64: h.post,
  parseCoralInitiateResponse: h.parse,
  parseCoralEncryptedJson: h.decrypt
}));
vi.mock("./serviceAvailability.js", () => ({
  getPaymentMethodAvailability: h.gate
}));
import { eventCallbackSourceAllowed, handleEventCardCallback, startEventCard, validEventCallbackCapability } from "./eventHireCard.js";
const token = "a".repeat(43),
  ref = `EHV-${"b".repeat(32)}`,
  actor = {
    kind: "CLIENT" as const,
    userId: 10
  };
const db = {
  user: {
    findUnique: vi.fn(async () => ({
      name: "Client",
      email: "client@example.test",
      phone: "+255700000000"
    }))
  },
  eventHireBooking: {
    findUnique: h.find,
    updateMany: h.update
  }
};
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CORAL_UCF_USERNAME", "test-user");
  vi.stubEnv("CORAL_UCF_PASSWORD", "test-password");
  vi.stubEnv("CORAL_UCF_ALIAS", "test-alias");
  vi.stubEnv("CORAL_UCF_SHARED_ENCRYPTION_KEY", "test-key");
  vi.stubEnv("EVENT_HIRE_CARD_CALLBACK_URL", "https://api.example.test/api/event-hire/card-callback");
  vi.stubEnv("WEB_ORIGIN", "https://www.example.test");
  vi.stubEnv("EVENT_HIRE_CARD_CHECKOUT_HOSTS", "pay.example.test");
  vi.stubEnv("EVENT_HIRE_CARD_CALLBACK_ALLOWED_IPS", "");
  vi.stubEnv("EVENT_HIRE_CARD_CALLBACK_VERIFIED", "");
  h.prepare.mockResolvedValue({
    booking: {
      id: 1,
      reference: "ebk_test",
      paymentRef: ref,
      total: 141000,
      requestId: 7,
      request: {
        property: {
          title: "Hall"
        }
      }
    },
    token,
    checkoutUrl: null
  });
  h.post.mockResolvedValue({
    ok: true,
    body: "provider-response"
  });
  h.parse.mockReturnValue({
    code: "000",
    redirectUrl: "https://pay.example.test/session"
  });
  h.gate.mockResolvedValue({
    enabled: true
  });
  h.update.mockResolvedValue({
    count: 1
  });
  h.find.mockResolvedValue({
    id: 1,
    paymentRef: ref,
    total: 141000,
    callbackTokenHash: hash(token)
  });
  h.decrypt.mockReturnValue({
    Identifier: ref,
    Stamp: ref,
    TransactionID: "123456",
    Status: "Success",
    Code: "000",
    ISOCode: "00"
  });
  h.settle.mockResolvedValue({
    reference: "ebk_test",
    status: "CONFIRMED"
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("event card initiation", () => {
  it("sends only server-frozen amounts and a provider-only callback capability", async () => {
    const result = await startEventCard(db, actor, "er_test");
    expect(result.checkoutUrl).toBe("https://pay.example.test/session");
    const transaction = h.post.mock.calls[0][0].Transaction;
    expect(transaction.Order.ProductTotal).toBe(141000);
    const callback = new URL(transaction.UCF.CallbackUrl);
    expect(callback.pathname).toBe("/api/event-hire/card-callback");
    expect(callback.searchParams.get("cap")).toBe(token);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("test-password");
  });
  it("reuses a previously initiated checkout without a second external request", async () => {
    h.prepare.mockResolvedValue({
      booking: {
        reference: "ebk_test"
      },
      checkoutUrl: "https://pay.example.test/existing",
      token: null
    });
    expect((await startEventCard(db, actor, "er_test")).checkoutUrl).toContain("existing");
    expect(h.post).not.toHaveBeenCalled();
  });
  it("does not start a booking when the provider or configuration is unavailable", async () => {
    h.gate.mockResolvedValue({
      enabled: false,
      reason: "Unavailable"
    });
    await expect(startEventCard(db, actor, "er_test")).rejects.toMatchObject({
      status: 503
    });
    expect(h.prepare).not.toHaveBeenCalled();
  });
  it.each(["http://pay.example.test/session", "javascript:alert(1)", "https://attacker.example/session"])("rejects an unsafe provider redirect %s", async url => {
    h.parse.mockReturnValue({
      code: "000",
      redirectUrl: url
    });
    await expect(startEventCard(db, actor, "er_test")).rejects.toMatchObject({
      code: "PAYMENT_STATUS_UNKNOWN"
    });
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        checkoutStatus: "STATUS_UNKNOWN"
      }
    }));
  });
  it("a timeout stays unknown and never triggers an automatic charge retry", async () => {
    h.post.mockRejectedValue(new Error("timeout"));
    await expect(startEventCard(db, actor, "er_test")).rejects.toMatchObject({
      code: "PAYMENT_STATUS_UNKNOWN"
    });
    expect(h.post).toHaveBeenCalledTimes(1);
  });
  it("requires a verified production callback and refuses a sandbox gateway", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(startEventCard(db, actor, "er_test")).rejects.toMatchObject({
      status: 503
    });
    vi.stubEnv("EVENT_HIRE_CARD_CALLBACK_VERIFIED", "true");
    vi.stubEnv("CORAL_UCF_API_URL", "https://dev.coralcommerce.com/Payserver/Service/Execute");
    await expect(startEventCard(db, actor, "er_test")).rejects.toMatchObject({
      status: 503
    });
    expect(h.prepare).not.toHaveBeenCalled();
  });
});
describe("callback capability and provider proof", () => {
  it("requires pinned direct-origin provider addresses in production",()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("EVENT_HIRE_CARD_CALLBACK_ALLOWED_IPS","");
    expect(eventCallbackSourceAllowed({ip:"203.0.113.5"})).toBe(false);
    vi.stubEnv("EVENT_HIRE_CARD_CALLBACK_ALLOWED_IPS","203.0.113.5");
    expect(eventCallbackSourceAllowed({ip:"::ffff:203.0.113.5"})).toBe(true);
    expect(eventCallbackSourceAllowed({ip:"198.51.100.9",headers:{"x-forwarded-for":"203.0.113.5"}})).toBe(false);
    expect(eventCallbackSourceAllowed({ip:"203.0.113.5",headers:{"cf-ray":"edge-request"}})).toBe(false);
  });
  it("uses a fixed-size digest comparison and rejects malformed capabilities", () => {
    expect(validEventCallbackCapability(token, hash(token))).toBe(true);
    for (const t of ["", null, {}, "a".repeat(42), "b".repeat(43)]) expect(validEventCallbackCapability(t, hash(token))).toBe(false);
  });
  it("rejects a wrong capability before trying to decrypt", async () => {
    await expect(handleEventCardCallback(db, ref, "c".repeat(43), "cipher")).rejects.toMatchObject({
      status: 403
    });
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
  });
  it.each([{
    Identifier: "EHV-another"
  }, {
    Stamp: "EHV-another"
  }, {
    TransactionID: "<script>"
  }])("cannot replay provider proof against another target %#", async change => {
    h.decrypt.mockReturnValue({
      ...h.decrypt.getMockImplementation()?.(),
      Identifier: ref,
      Stamp: ref,
      TransactionID: "123456",
      Status: "Success",
      Code: "000",
      ISOCode: "00",
      ...change
    });
    await expect(handleEventCardCallback(db, ref, token, "cipher")).rejects.toMatchObject({
      status: 403
    });
    expect(h.settle).not.toHaveBeenCalled();
  });
  it("browser postback shapes and incomplete success fields never settle", async () => {
    for (const payload of [{
      Result: {
        Identifier: ref,
        TransactionID: "123456",
        Code: "000"
      }
    }, {
      Identifier: ref,
      TransactionID: "123456",
      Code: "000"
    }, {
      Identifier: ref,
      TransactionID: "123456",
      Code: "000",
      Status: "Success",
      ISOCode: "05"
    }]) {
      h.decrypt.mockReturnValue(payload);
      try {
        await handleEventCardCallback(db, ref, token, "cipher");
      } catch {}
      expect(h.settle).not.toHaveBeenCalled();
    }
  });
  it("only final provider success settles the frozen server amount", async () => {
    expect(await handleEventCardCallback(db, ref, token, "cipher")).toMatchObject({
      status: "CONFIRMED"
    });
    expect(h.settle).toHaveBeenCalledWith(db, {
      paymentRef: ref,
      transactionId: "123456",
      amount: 141000,
      currency: "TZS"
    });
  });
  it("a verified decline releases the slot without creating revenue", async () => {
    h.decrypt.mockReturnValue({
      Identifier: ref,
      TransactionID: "123456",
      Status: "Failure",
      Code: "051"
    });
    await handleEventCardCallback(db, ref, token, "cipher");
    expect(h.decline).toHaveBeenCalledWith(db, 1);
    expect(h.settle).not.toHaveBeenCalled();
  });
});

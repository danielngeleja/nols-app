import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  findDisbursement: vi.fn(),
  applyProviderEvent: vi.fn(),
  recordAmountMismatch: vi.fn(),
  recordCorrelationMismatch: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: { disbursement: { findUnique: mocks.findDisbursement } },
}));
vi.mock("../middleware/rateLimit.js", () => ({
  limitAzampayDisbursementCallback: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../routes/webhooks.payments.js", () => ({
  isWebhookIpAllowed: (ip: string, allowed: string[]) => allowed.includes(ip),
}));
vi.mock("../services/payouts/ledger.js", () => ({
  applyProviderEvent: mocks.applyProviderEvent,
  recordAmountMismatch: mocks.recordAmountMismatch,
  recordProviderCorrelationMismatch: mocks.recordCorrelationMismatch,
}));

import callbackRouter from "../routes/payments.azampay.disbursement";

const callback = {
  initiatorReferenceId: "NoLSAF-D-2608081645-D51QVX",
  fspReferenceId: "FSP-77",
  pgReferenceId: "PG-77",
  amount: "150000",
  status: "success",
  message: "Transaction completed",
  operator: "Airtel",
};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/payments/azampay/disbursement", callbackRouter);
  return instance;
}

describe("AzamPay callback attacker controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AZAMPAY_DISBURSE_CALLBACK_ALLOWED_IPS", "");
    vi.stubEnv("AZAMPAY_DISBURSE_CALLBACK_SECRET", "");
    mocks.findDisbursement.mockResolvedValue({
      id: 77,
      externalReferenceId: callback.initiatorReferenceId,
      pgReferenceId: callback.pgReferenceId,
      amount: 150000,
      bankName: "airtel",
    });
    mocks.applyProviderEvent.mockResolvedValue({ status: "PAID" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("fails closed in every environment when no callback authentication is configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await request(app())
      .post("/api/payments/azampay/disbursement/callback")
      .send(callback);

    expect(response.status).toBe(403);
    expect(mocks.findDisbursement).not.toHaveBeenCalled();
    expect(mocks.applyProviderEvent).not.toHaveBeenCalled();
  });

  it("rejects a guessed callback secret before looking up a payout", async () => {
    vi.stubEnv("AZAMPAY_DISBURSE_CALLBACK_SECRET", "correct-provider-secret");

    const response = await request(app())
      .post("/api/payments/azampay/disbursement/callback")
      .set("x-callback-token", "attacker-guess")
      .send(callback);

    expect(response.status).toBe(403);
    expect(mocks.findDisbursement).not.toHaveBeenCalled();
  });

  it("requires both controls when an IP allowlist and shared secret are configured", async () => {
    vi.stubEnv("AZAMPAY_DISBURSE_CALLBACK_SECRET", "correct-provider-secret");
    vi.stubEnv("AZAMPAY_DISBURSE_CALLBACK_ALLOWED_IPS", "196.192.10.4");

    const response = await request(app())
      .post("/api/payments/azampay/disbursement/callback")
      .set("x-callback-token", "correct-provider-secret")
      .send(callback);

    expect(response.status).toBe(403);
    expect(mocks.findDisbursement).not.toHaveBeenCalled();
  });

  it("accepts a correctly authenticated and fully correlated callback", async () => {
    vi.stubEnv("AZAMPAY_DISBURSE_CALLBACK_SECRET", "correct-provider-secret");

    const response = await request(app())
      .post("/api/payments/azampay/disbursement/callback")
      .set("x-callback-token", "correct-provider-secret")
      .send({ ...callback, status: "SUCCESS" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, matched: true });
    expect(mocks.applyProviderEvent).toHaveBeenCalledOnce();
  });

  it("records a pgReferenceId attack and never applies its success status", async () => {
    vi.stubEnv("AZAMPAY_DISBURSE_CALLBACK_SECRET", "correct-provider-secret");

    const response = await request(app())
      .post("/api/payments/azampay/disbursement/callback")
      .set("x-callback-token", "correct-provider-secret")
      .send({ ...callback, pgReferenceId: "PG-ATTACKER" });

    expect(response.status).toBe(200);
    expect(response.body.flagged).toBe("pg_reference_mismatch");
    expect(mocks.recordCorrelationMismatch).toHaveBeenCalledOnce();
    expect(mocks.applyProviderEvent).not.toHaveBeenCalled();
  });

  it("rejects incomplete completion payloads before database access", async () => {
    vi.stubEnv("AZAMPAY_DISBURSE_CALLBACK_SECRET", "correct-provider-secret");
    const { pgReferenceId: _removed, ...missingReference } = callback;

    const response = await request(app())
      .post("/api/payments/azampay/disbursement/callback")
      .set("x-callback-token", "correct-provider-secret")
      .send(missingReference);

    expect(response.status).toBe(200);
    expect(response.body.error).toBe("invalid_payload");
    expect(mocks.findDisbursement).not.toHaveBeenCalled();
  });
});

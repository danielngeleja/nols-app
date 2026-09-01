import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRouteBodyParsers } from "./system.js";
import paymentWebhooksRouter from "./webhooks.payments.js";

const WEBHOOK_SECRET = "payment-webhook-test-secret";
const originalSecret = process.env.AZAMPAY_WEBHOOK_SECRET;
const originalAllowedIps = process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS;

/** Mirrors the production parser and router order in index.ts. */
function buildApp() {
  const app = express();
  registerRouteBodyParsers(app);
  app.use(express.json({ limit: "100kb", strict: true }));
  app.use(express.urlencoded({ extended: true, limit: "100kb", parameterLimit: 50 }));
  app.use("/webhooks", paymentWebhooksRouter);
  return app;
}

function signature(rawBody: string): string {
  return crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
}

function post(rawBody: string, suppliedSignature = signature(rawBody), contentType = "application/json") {
  return request(buildApp())
    .post("/webhooks/azampay")
    .set("Content-Type", contentType)
    .set("X-Azampay-Signature", suppliedSignature)
    .send(rawBody);
}

describe("POST /webhooks/azampay raw signature boundary", () => {
  beforeEach(() => {
    process.env.AZAMPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    delete process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.AZAMPAY_WEBHOOK_SECRET;
    else process.env.AZAMPAY_WEBHOOK_SECRET = originalSecret;
    if (originalAllowedIps === undefined) delete process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS;
    else process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS = originalAllowedIps;
  });

  it("verifies the exact formatted JSON bytes before parsing", async () => {
    const rawBody = `{\n  "status" : "pending",\n  "amount" : 1.50\n}`;
    const response = await post(rawBody).expect(400);

    // Signature verification succeeded and validation advanced to the first
    // required business field. A re-serialized body would fail with 401 here.
    expect(response.body).toEqual({ ok: false, error: "Missing eventId/transactionId" });
  });

  it("preserves exact text/plain callback bytes too", async () => {
    const rawBody = `{ "status": "pending" }`;
    const response = await post(rawBody, signature(rawBody), "text/plain").expect(400);

    expect(response.body.error).toBe("Missing eventId/transactionId");
  });

  it("still rejects a signature for different bytes", async () => {
    const signedBody = `{"status":"pending"}`;
    const changedBody = `{ "status": "pending" }`;
    const response = await post(changedBody, signature(signedBody)).expect(401);

    expect(response.body).toEqual({ ok: false, error: "Invalid signature" });
  });
});

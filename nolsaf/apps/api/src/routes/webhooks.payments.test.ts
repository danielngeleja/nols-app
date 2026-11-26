import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerRouteBodyParsers } from "./system.js";
import paymentWebhooksRouter, {
  arrivedThroughEdgeProxy,
  authenticateAzamPayWebhook,
  callbackFieldNames,
  readAzamPayCallbackFields,
} from "./webhooks.payments.js";
import { redactSensitiveUrl } from "../lib/safeAccessLog.js";

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

const URL_TOKEN = "u".repeat(20) + "0123456789abcdefXYZ";
const BODY = `{"status":"success","amount":89600}`;

function authenticate(overrides: Partial<Parameters<typeof authenticateAzamPayWebhook>[0]> = {}, env: Record<string, string> = {}) {
  return authenticateAzamPayWebhook({
    rawBody: BODY, signature: null, urlToken: null, ip: "196.192.10.4", throughEdge: false,
    env: { AZAMPAY_WEBHOOK_SECRET: WEBHOOK_SECRET, ...env } as NodeJS.ProcessEnv,
    ...overrides,
  });
}

describe("authenticateAzamPayWebhook (callbacks AzamPay sends unsigned)", () => {
  it("refuses an unsigned callback when no other proof is configured (first prod payment)", () => {
    expect(authenticate()).toMatchObject({ ok: false, status: 400 });
  });

  it("accepts the right URL token and refuses a wrong or missing one", () => {
    const env = { AZAMPAY_WEBHOOK_URL_TOKEN: URL_TOKEN };
    expect(authenticate({ urlToken: URL_TOKEN }, env)).toEqual({ ok: true, method: "URL_TOKEN" });
    expect(authenticate({ urlToken: URL_TOKEN.slice(0, -1) + "Q" }, env)).toMatchObject({ ok: false, status: 401 });
    expect(authenticate({ urlToken: null }, env)).toMatchObject({ ok: false, status: 401 });
  });

  it("works through our edge with the URL token (current www callback URL)", () => {
    expect(authenticate({ urlToken: URL_TOKEN, throughEdge: true }, { AZAMPAY_WEBHOOK_URL_TOKEN: URL_TOKEN }))
      .toEqual({ ok: true, method: "URL_TOKEN" });
  });

  it("never lets a wrong signature fall back to the token", () => {
    const result = authenticate({ signature: "00".repeat(32), urlToken: URL_TOKEN }, { AZAMPAY_WEBHOOK_URL_TOKEN: URL_TOKEN });
    expect(result).toMatchObject({ ok: false, status: 401, error: "Invalid signature" });
  });

  it("still accepts a valid signature", () => {
    expect(authenticate({ signature: signature(BODY) })).toEqual({ ok: true, method: "SIGNATURE" });
  });

  it("requires the token once configured, even from an allowlisted address", () => {
    const env = { AZAMPAY_WEBHOOK_URL_TOKEN: URL_TOKEN, AZAMPAY_WEBHOOK_ALLOWED_IPS: "196.192.10.4" };
    expect(authenticate({}, env)).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a token configuration that is too short to be a secret", () => {
    expect(authenticate({ urlToken: "short" }, { AZAMPAY_WEBHOOK_URL_TOKEN: "short" })).toMatchObject({ ok: false, status: 500 });
  });

  it("trusts an allowlisted source address only on a direct call", () => {
    const env = { AZAMPAY_WEBHOOK_ALLOWED_IPS: "196.192.10.4" };
    expect(authenticate({}, env)).toEqual({ ok: true, method: "SOURCE_IP" });
    // Through Cloudflare/Vercel the address is the edge's: anyone could use it.
    expect(authenticate({ throughEdge: true }, env)).toMatchObject({ ok: false, status: 400 });
    expect(authenticate({ ip: "203.0.113.9" }, env)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("POST /webhooks/azampay unsigned callbacks", () => {
  const originalToken = process.env.AZAMPAY_WEBHOOK_URL_TOKEN;
  beforeEach(() => {
    process.env.AZAMPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.AZAMPAY_WEBHOOK_URL_TOKEN = URL_TOKEN;
    delete process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS;
  });
  afterEach(() => {
    if (originalToken === undefined) delete process.env.AZAMPAY_WEBHOOK_URL_TOKEN;
    else process.env.AZAMPAY_WEBHOOK_URL_TOKEN = originalToken;
    if (originalSecret === undefined) delete process.env.AZAMPAY_WEBHOOK_SECRET;
    else process.env.AZAMPAY_WEBHOOK_SECRET = originalSecret;
    if (originalAllowedIps === undefined) delete process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS;
    else process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS = originalAllowedIps;
  });

  // A body with no transaction id stops right after authentication, before
  // any database work: "Missing eventId" proves the request got through.
  const noIdBody = `{"transactionstatus":"success","amount":"89600"}`;

  it("accepts AzamPay's unsigned callback that carries the URL token, through the edge", async () => {
    const response = await request(buildApp())
      .post(`/webhooks/azampay?token=${URL_TOKEN}`)
      .set("Content-Type", "application/json")
      .set("cf-ray", "8f00000000000000-JNB")
      .set("x-vercel-id", "cpt1::abc")
      .send(noIdBody)
      .expect(400);
    expect(response.body.error).toBe("Missing eventId/transactionId");
  });

  it("refuses the same callback without the token", async () => {
    await request(buildApp()).post("/webhooks/azampay").set("Content-Type", "application/json").send(noIdBody).expect(401);
  });

  it("refuses a forged callback with a guessed token", async () => {
    await request(buildApp())
      .post(`/webhooks/azampay?token=${"x".repeat(40)}`)
      .set("Content-Type", "application/json")
      .send(noIdBody)
      .expect(401);
  });

  it("does not let an edge-looking header bypass the IP allowlist into settlement", async () => {
    process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS = "196.192.10.4";
    delete process.env.AZAMPAY_WEBHOOK_URL_TOKEN;
    // An attacker calling the API directly and faking cf-ray skips the address
    // pre-filter but still has no signature or token, so it is refused.
    await request(buildApp())
      .post("/webhooks/azampay")
      .set("Content-Type", "application/json")
      .set("cf-ray", "forged")
      .send(noIdBody)
      .expect(400);
  });
});

describe("AzamPay callback field handling", () => {
  it("reads AzamPay's documented lowercase checkout callback", () => {
    const fields = readAzamPayCallbackFields({
      msisdn: "255700000000", amount: "89600", message: "Success", utilityref: "INV-38-1795350306271",
      operator: "Tigo", reference: "a1b2c3", transactionstatus: "success",
    });
    expect(fields).toEqual({ eventId: "a1b2c3", paymentRef: "INV-38-1795350306271", amount: 89600, status: "success", provider: "Tigo" });
  });

  it("keeps reading the original camelCase shape the same way", () => {
    const fields = readAzamPayCallbackFields({ transactionId: "T1", externalId: "INV-1-1", amount: 1000, status: "SUCCESS", provider: "Airtel" });
    expect(fields).toMatchObject({ eventId: "T1", paymentRef: "INV-1-1", amount: 1000, status: "SUCCESS", provider: "Airtel" });
  });

  it("logs field names only, never values", () => {
    const names = callbackFieldNames({ msisdn: "255712345678", amount: "89600", additionalProperties: { tourBookingId: 9 } });
    expect(names).toBe("msisdn,amount,additionalProperties,additionalProperties.tourBookingId");
    expect(names).not.toMatch(/2557|89600/);
  });

  it("detects our own edge from its headers", () => {
    expect(arrivedThroughEdgeProxy({ "cf-ray": "x" })).toBe(true);
    expect(arrivedThroughEdgeProxy({ "x-vercel-id": "x" })).toBe(true);
    expect(arrivedThroughEdgeProxy({ "user-agent": "AzamPay" })).toBe(false);
  });

  it("keeps the callback token out of the access log", () => {
    expect(redactSensitiveUrl(`/webhooks/azampay?token=${URL_TOKEN}`)).toBe("/webhooks/azampay?token=[REDACTED]");
  });
});

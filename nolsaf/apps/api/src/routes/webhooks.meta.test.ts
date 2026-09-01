import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock("../lib/nrmsMetaWebhookJobs.js", () => ({ enqueueMetaWebhookEvents: mocks.enqueue }));

import { router } from "./webhooks.meta.js";

const APP_SECRET = "meta-app-secret";
const VERIFY_TOKEN = "meta-verify-token";

/**
 * Mirrors the production middleware order in index.ts: the route-scoped raw
 * parser runs before the global JSON parser, so the router sees the exact
 * bytes Meta signed. A regression in that order must fail this suite.
 */
function buildApp() {
  const app = express();
  app.use("/webhooks/meta", express.raw({ type: "application/json", limit: "512kb" }));
  app.use(express.json({ limit: "100kb", strict: true }));
  app.use("/webhooks/meta", router);
  return app;
}

function sign(rawBody: string): string {
  return `sha256=${crypto.createHmac("sha256", APP_SECRET).update(Buffer.from(rawBody, "utf8")).digest("hex")}`;
}

function post(rawBody: string, signature: string | null = sign(rawBody)) {
  const pending = request(buildApp()).post("/webhooks/meta").set("Content-Type", "application/json");
  if (signature) pending.set("X-Hub-Signature-256", signature);
  return pending.send(rawBody);
}

/** The shape Meta documents for the `messages` webhook field. */
function inboundTextPayload(overrides: { phoneNumberId?: string; messageId?: string } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "102290129340398",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "255765012370", phone_number_id: overrides.phoneNumberId ?? "778001122334455" },
          contacts: [{ profile: { name: "Amina" }, wa_id: "255700000001" }],
          messages: [{
            from: "255700000001",
            id: overrides.messageId ?? "wamid.HBgMMjU1NzAwMDAwMDAxFQIAEhgg",
            timestamp: "1788256800",
            type: "text",
            text: { body: "Do you have a room for 2026-09-01 to 2026-09-04?" },
          }],
        },
      }],
    }],
  };
}

describe("POST /webhooks/meta", () => {
  const originalSecret = process.env.META_APP_SECRET;
  const originalInstagramSecret = process.env.META_INSTAGRAM_APP_SECRET;
  const originalVerifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.META_APP_SECRET = APP_SECRET;
    delete process.env.META_INSTAGRAM_APP_SECRET;
    process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
    mocks.enqueue.mockImplementation(async (events: unknown[]) => ({ accepted: events.length }));
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = originalSecret;
    if (originalInstagramSecret === undefined) delete process.env.META_INSTAGRAM_APP_SECRET; else process.env.META_INSTAGRAM_APP_SECRET = originalInstagramSecret;
    if (originalVerifyToken === undefined) delete process.env.META_WEBHOOK_VERIFY_TOKEN; else process.env.META_WEBHOOK_VERIFY_TOKEN = originalVerifyToken;
  });

  it("answers Meta's subscription handshake only with the configured verify token", async () => {
    const app = buildApp();
    const accepted = await request(app)
      .get("/webhooks/meta")
      .query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1158201444" })
      .expect(200);
    expect(accepted.text).toBe("1158201444");
    await request(app).get("/webhooks/meta").query({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "1158201444" }).expect(403);
    await request(app).get("/webhooks/meta").query({ "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "1158201444" }).expect(403);
  });

  it("accepts a signed payload that carries no events without enqueuing anything", async () => {
    const response = await post(JSON.stringify({ object: "whatsapp_business_account", entry: [] })).expect(202);
    expect(response.body).toEqual({ received: true, accepted: 0, events: 0 });
    expect(mocks.enqueue).toHaveBeenCalledWith([]);
  });

  it("parses and enqueues a signed realistic inbound WhatsApp text message", async () => {
    const response = await post(JSON.stringify(inboundTextPayload())).expect(202);
    expect(response.body).toEqual({ received: true, accepted: 1, events: 1 });
    expect(mocks.enqueue).toHaveBeenCalledWith([expect.objectContaining({
      kind: "MESSAGE",
      provider: "WHATSAPP",
      accountId: "778001122334455",
      senderId: "255700000001",
      providerMessageId: "wamid.HBgMMjU1NzAwMDAwMDAxFQIAEhgg",
      senderName: "Amina",
      body: "Do you have a room for 2026-09-01 to 2026-09-04?",
    })]);
  });

  it("verifies the exact received bytes rather than a re-serialized body", async () => {
    // Whitespace and key order that JSON.stringify(JSON.parse(body)) would not reproduce.
    const rawBody = `{\n  "entry" : [],\n  "object":   "whatsapp_business_account"\n}`;
    expect(JSON.stringify(JSON.parse(rawBody))).not.toBe(rawBody);
    await post(rawBody).expect(202);
  });

  it("stays idempotent when Meta redelivers the same message id", async () => {
    const rawBody = JSON.stringify(inboundTextPayload());
    await post(rawBody).expect(202);
    // The durable queue dedupes on a hash of the provider message id, so a
    // redelivery parses one event and accepts none.
    mocks.enqueue.mockResolvedValueOnce({ accepted: 0 });
    const redelivery = await post(rawBody).expect(202);
    expect(redelivery.body).toEqual({ received: true, accepted: 0, events: 1 });
    const [firstEvents] = mocks.enqueue.mock.calls[0] as [Array<{ providerMessageId: string }>];
    const [secondEvents] = mocks.enqueue.mock.calls[1] as [Array<{ providerMessageId: string }>];
    expect(secondEvents[0].providerMessageId).toBe(firstEvents[0].providerMessageId);
  });

  it("rejects a wrong, malformed or missing signature before touching the queue", async () => {
    const rawBody = JSON.stringify(inboundTextPayload());
    await post(rawBody, `sha256=${"0".repeat(64)}`).expect(401);
    await post(rawBody, "sha1=deadbeef").expect(401);
    await post(rawBody, null).expect(401);
    await post(`${rawBody} `, sign(rawBody)).expect(401);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("asks Meta to retry when the durable queue cannot store the event", async () => {
    mocks.enqueue.mockRejectedValueOnce(new Error("Table 'nrms_meta_webhook_job' doesn't exist"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await post(JSON.stringify(inboundTextPayload())).expect(503);
    errorSpy.mockRestore();
  });

  it("refuses to process webhooks when no app secret is configured", async () => {
    delete process.env.META_APP_SECRET;
    await post(JSON.stringify(inboundTextPayload())).expect(503);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

#!/usr/bin/env node
/**
 * Signs a WhatsApp webhook payload exactly the way Meta does and posts it to a
 * NoLSAF callback URL. Use it to prove the ingestion path end to end without
 * waiting for Meta to deliver real guest traffic.
 *
 * The app secret is read from the environment and never printed.
 *
 *   META_APP_SECRET=... node scripts/meta-webhook-selftest.mjs \
 *     --url https://nolsaf-api-staging.onrender.com/webhooks/meta \
 *     --phone-number-id <the connected phone-number ID> \
 *     --case message
 *
 * Cases:
 *   empty      signed payload with entry: []            expect 202 events=0 accepted=0
 *   message    realistic inbound text message           expect 202 events=1 accepted=1
 *   duplicate  the same message id sent twice           expect 202 events=1 accepted=1 then accepted=0
 *   badsig     correct body, wrong signature            expect 401
 *   verify     GET hub.challenge handshake              expect 200 echoing the challenge
 */
import crypto from "node:crypto";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const url = arg("url");
const phoneNumberId = arg("phone-number-id");
const from = arg("from", "255700000001");
const testCase = arg("case", "message");
const appSecret = String(process.env.META_APP_SECRET || "");
const verifyToken = String(process.env.META_WEBHOOK_VERIFY_TOKEN || "");

if (!url) {
  console.error("Missing --url. Example: --url https://nolsaf-api-staging.onrender.com/webhooks/meta");
  process.exit(2);
}

function inboundPayload(messageId) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: arg("waba-id", "0"),
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: arg("display-phone-number", "255765012370"), phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: "NoLSAF self-test" }, wa_id: from }],
          messages: [{ from, id: messageId, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: arg("body", "Self-test inquiry from NoLSAF diagnostics") } }],
        },
      }],
    }],
  };
}

async function send(rawBody, { corruptSignature = false } = {}) {
  const digest = crypto.createHmac("sha256", appSecret).update(Buffer.from(rawBody, "utf8")).digest("hex");
  const signature = corruptSignature ? `sha256=${"0".repeat(64)}` : `sha256=${digest}`;
  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signature, "User-Agent": "NoLSAF-webhook-selftest" },
    body: rawBody,
  });
  const text = await response.text();
  console.log(`POST ${response.status} in ${Date.now() - started}ms :: ${text.slice(0, 400)}`);
  return response.status;
}

async function main() {
  if (testCase === "verify") {
    if (!verifyToken) { console.error("Set META_WEBHOOK_VERIFY_TOKEN to run the verify case."); process.exit(2); }
    const target = new URL(url);
    target.searchParams.set("hub.mode", "subscribe");
    target.searchParams.set("hub.verify_token", verifyToken);
    target.searchParams.set("hub.challenge", "nolsaf-selftest-challenge");
    const response = await fetch(target, { method: "GET" });
    const text = await response.text();
    console.log(`GET ${response.status} :: ${text.slice(0, 200)}`);
    console.log(response.status === 200 && text === "nolsaf-selftest-challenge" ? "PASS: handshake echoes the challenge" : "FAIL: handshake did not echo the challenge");
    return;
  }

  if (!appSecret) { console.error("Set META_APP_SECRET in the environment (it is never printed)."); process.exit(2); }

  if (testCase === "empty") {
    await send(JSON.stringify({ object: "whatsapp_business_account", entry: [] }));
    console.log("Expected: 202 with events=0 accepted=0");
    return;
  }

  if (!phoneNumberId) {
    console.error("Missing --phone-number-id. It must equal nrms_messaging_connection.phoneNumberId for the target property.");
    process.exit(2);
  }

  const messageId = arg("message-id", `wamid.selftest.${crypto.randomBytes(8).toString("hex")}`);
  const rawBody = JSON.stringify(inboundPayload(messageId));

  if (testCase === "badsig") {
    const status = await send(rawBody, { corruptSignature: true });
    console.log(status === 401 ? "PASS: a wrong signature is rejected" : `FAIL: expected 401, received ${status}`);
    return;
  }

  await send(rawBody);
  console.log("Expected: 202 with events=1 accepted=1");

  if (testCase === "duplicate") {
    await send(rawBody);
    console.log("Expected on redelivery: 202 with events=1 accepted=0 (the durable queue deduped it)");
  }

  console.log(`Message id used: ${messageId}`);
  console.log("Next: re-run the property WhatsApp diagnostic. The durable queue check should report COMPLETED and inbound storage should PASS.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

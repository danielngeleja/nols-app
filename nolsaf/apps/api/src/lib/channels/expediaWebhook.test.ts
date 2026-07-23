import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyExpediaWebhook } from "./expediaWebhook.js";

describe("Expedia webhook verification", () => {
  it("validates the API key, timestamp and HMAC v2 signature", () => {
    const timestamp = "1760000000000";
    const body = Buffer.from('{"notification_id":"n-1"}');
    const signature = crypto.createHmac("sha256", "secret").update(Buffer.concat([Buffer.from(`${timestamp}.`), body])).digest("base64");
    expect(verifyExpediaWebhook({ rawBody: body, apiKeyHeader: "api-key", timestampHeader: timestamp, signatureHeader: `sha256=${signature}`, expectedApiKey: "api-key", secrets: ["secret"], now: Number(timestamp) })).toBe(true);
    expect(verifyExpediaWebhook({ rawBody: body, apiKeyHeader: "wrong", timestampHeader: timestamp, signatureHeader: `sha256=${signature}`, expectedApiKey: "api-key", secrets: ["secret"], now: Number(timestamp) })).toBe(false);
  });

  it("accepts either signature during secret rotation", () => {
    const timestamp = "1760000000000";
    const body = Buffer.from("{}");
    const oldSignature = crypto.createHmac("sha256", "old-secret").update(Buffer.concat([Buffer.from(`${timestamp}.`), body])).digest("base64");
    expect(verifyExpediaWebhook({ rawBody: body, apiKeyHeader: "key", timestampHeader: timestamp, signatureHeader: `sha256=invalid,${oldSignature}`, expectedApiKey: "key", secrets: ["new-secret", "old-secret"], now: Number(timestamp) })).toBe(true);
  });
});

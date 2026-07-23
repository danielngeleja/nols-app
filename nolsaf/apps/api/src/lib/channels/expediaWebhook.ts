import crypto from "node:crypto";

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function signatures(value: string): string[] {
  return value.split(",").map((part) => part.trim().replace(/^sha256=/i, "")).filter(Boolean);
}

export function verifyExpediaWebhook(input: {
  rawBody: Buffer;
  apiKeyHeader: string;
  timestampHeader: string;
  signatureHeader: string;
  expectedApiKey: string;
  secrets: string[];
  now?: number;
  toleranceMs?: number;
}): boolean {
  if (!input.rawBody.length || !input.expectedApiKey || !input.apiKeyHeader || !safeEqual(input.apiKeyHeader, input.expectedApiKey)) return false;
  const timestamp = Number(input.timestampHeader);
  const now = input.now ?? Date.now();
  const tolerance = input.toleranceMs ?? 5 * 60_000;
  if (!Number.isFinite(timestamp) || timestamp < now - tolerance || timestamp > now + 60_000) return false;
  const received = signatures(input.signatureHeader);
  if (!received.length) return false;
  const signed = Buffer.concat([Buffer.from(`${input.timestampHeader}.`, "utf8"), input.rawBody]);
  return input.secrets.filter(Boolean).some((secret) => {
    const expected = crypto.createHmac("sha256", secret).update(signed).digest("base64");
    return received.some((candidate) => safeEqual(candidate, expected));
  });
}

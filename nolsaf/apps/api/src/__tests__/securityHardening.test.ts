import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateSecrets } from "../lib/validateSecrets";
import { isCloudinaryFileTypeAllowed } from "../routes/uploads.cloudinary";
import { isCareerResumeFileTypeAllowed } from "../routes/public.careers.apply";
import { bankInitiateSchema } from "../routes/payments.azampay.bank";
import { BANK_PROVIDER_CATALOG } from "../lib/azampay.helpers";
import { isWebhookIpAllowed } from "../routes/webhooks.payments";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function setProductionSecrets(overrides: Record<string, string | undefined> = {}) {
  process.env.NODE_ENV = "production";
  Object.assign(process.env, {
    AZAMPAY_API_KEY: "a".repeat(24),
    AZAMPAY_CLIENT_ID: "client-id",
    AZAMPAY_CLIENT_SECRET: "b".repeat(24),
    AZAMPAY_WEBHOOK_SECRET: "c".repeat(24),
    AZAMPAY_APP_NAME: "nolsaf",
    AZAMPAY_CARD_RETURN_URL: "https://api.nolsaf.com/api/payments/azampay/card/callback",
    DATABASE_URL: "mysql://user:pass@db.nolsaf.com:3306/nolsaf",
    JWT_SECRET: "j".repeat(40),
    ENCRYPTION_KEY: "e".repeat(40),
    INTERNAL_PROXY_SECRET: "p".repeat(40),
    WEB_ORIGIN: "https://www.nolsaf.com",
    APP_ORIGIN: "https://app.nolsaf.com",
    CORS_ORIGIN: "https://www.nolsaf.com,https://app.nolsaf.com",
    CLOUDINARY_CLOUD_NAME: "nolsaf",
    CLOUDINARY_API_KEY: "123456789",
    CLOUDINARY_API_SECRET: "s".repeat(24),
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe("security hardening", () => {
  it("fails closed in production when the internal proxy secret is missing", () => {
    setProductionSecrets({ INTERNAL_PROXY_SECRET: undefined });

    expect(() => validateSecrets()).toThrow(/INTERNAL_PROXY_SECRET/);
  });

  it("rejects placeholder production secrets", () => {
    setProductionSecrets({ JWT_SECRET: "changeme".repeat(6) });

    expect(() => validateSecrets()).toThrow(/placeholder value/);
  });

  it("does not allow the old agent tour revenue route to be mounted again", () => {
    const routesDir = path.resolve(process.cwd(), "src/routes");
    const agentRoute = fs.readFileSync(path.join(routesDir, "agent.ts"), "utf8");

    expect(agentRoute).not.toContain("agent.tourRevenue");
    expect(agentRoute).not.toContain("/api/agent/tour-revenue");
    expect(fs.existsSync(path.join(routesDir, "agent.tourRevenue.ts"))).toBe(false);
  });

  it("keeps Cloudinary uploads restricted to known safe MIME types", () => {
    expect(isCloudinaryFileTypeAllowed("image/png")).toBe(true);
    expect(isCloudinaryFileTypeAllowed("image/webp")).toBe(true);
    expect(isCloudinaryFileTypeAllowed("application/pdf")).toBe(true);
    expect(isCloudinaryFileTypeAllowed("image/svg+xml")).toBe(false);
    expect(isCloudinaryFileTypeAllowed("text/html")).toBe(false);
    expect(isCloudinaryFileTypeAllowed("application/javascript")).toBe(false);
  });

  it("keeps public career resume uploads restricted to document MIME types", () => {
    expect(isCareerResumeFileTypeAllowed("application/pdf")).toBe(true);
    expect(isCareerResumeFileTypeAllowed("application/msword")).toBe(true);
    expect(isCareerResumeFileTypeAllowed("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
    expect(isCareerResumeFileTypeAllowed("text/html")).toBe(false);
    expect(isCareerResumeFileTypeAllowed("image/svg+xml")).toBe(false);
    expect(isCareerResumeFileTypeAllowed("application/javascript")).toBe(false);
  });
});

// ── Group A: Bank checkout schema validation ──────────────────────────────────
describe("AzamPay bank checkout schema", () => {
  const validBankFields = { accountNumber: "0150123456789", merchantMobileNumber: "+255712345678", otp: "123456" };

  it("rejects unknown bank codes", () => {
    const result = bankInitiateSchema.safeParse({
      invoiceId: 1,
      bankCode: "FAKE_BANK",
      ...validBankFields,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty bankCode", () => {
    const result = bankInitiateSchema.safeParse({
      invoiceId: 1,
      bankCode: "",
      ...validBankFields,
    });
    expect(result.success).toBe(false);
  });

  it("accepts CRDB as a valid bank code", () => {
    const result = bankInitiateSchema.safeParse({
      invoiceId: 1,
      bankCode: "CRDB",
      ...validBankFields,
    });
    expect(result.success).toBe(true);
  });

  it("accepts NMB as a valid bank code", () => {
    const result = bankInitiateSchema.safeParse({
      invoiceId: 1,
      bankCode: "NMB",
      ...validBankFields,
    });
    expect(result.success).toBe(true);
  });

  it("catalogues all 15 provider banks but accepts only deliberately published checkout banks", () => {
    expect(BANK_PROVIDER_CATALOG).toHaveLength(15);
    for (const bank of BANK_PROVIDER_CATALOG) {
      const result = bankInitiateSchema.safeParse({ invoiceId: 1, bankCode: bank.code, ...validBankFields });
      expect(result.success, `Unexpected checkout policy for ${bank.code}`).toBe(bank.checkoutEnabled);
    }
  });

  it("rejects accountNumber with special characters", () => {
    const result = bankInitiateSchema.safeParse({
      invoiceId: 1,
      bankCode: "CRDB",
      ...validBankFields,
      accountNumber: "<script>alert(1)</script>",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid accountNumber", () => {
    const result = bankInitiateSchema.safeParse({
      invoiceId: 1,
      bankCode: "CRDB",
      ...validBankFields,
    });
    expect(result.success).toBe(true);
  });
});

// ── Group B: Card return URL validation ───────────────────────────────────────
describe("AzamPay card return URL — production secrets validation", () => {
  it("throws when AZAMPAY_CARD_RETURN_URL is missing in production", () => {
    setProductionSecrets({ AZAMPAY_CARD_RETURN_URL: undefined });
    expect(() => validateSecrets()).toThrow(/AZAMPAY_CARD_RETURN_URL/);
  });

  it("throws when AZAMPAY_CARD_RETURN_URL uses HTTP (not HTTPS) in production", () => {
    setProductionSecrets({ AZAMPAY_CARD_RETURN_URL: "http://api.nolsaf.com/api/payments/azampay/card/callback" });
    expect(() => validateSecrets()).toThrow();
  });

  it("accepts a valid HTTPS AZAMPAY_CARD_RETURN_URL in production", () => {
    setProductionSecrets({ AZAMPAY_CARD_RETURN_URL: "https://api.nolsaf.com/api/payments/azampay/card/callback" });
    expect(() => validateSecrets()).not.toThrow();
  });
});

// ── Group C: Webhook IP allowlist ─────────────────────────────────────────────
describe("webhook IP allowlist (isWebhookIpAllowed)", () => {
  it("allows any IP when allowlist is empty", () => {
    expect(isWebhookIpAllowed("1.2.3.4", [])).toBe(true);
    expect(isWebhookIpAllowed("192.168.0.1", [])).toBe(true);
  });

  it("blocks an IP that is not in the allowlist", () => {
    expect(isWebhookIpAllowed("9.9.9.9", ["1.2.3.4", "5.6.7.8"])).toBe(false);
  });

  it("allows an IP that is in the allowlist", () => {
    expect(isWebhookIpAllowed("1.2.3.4", ["1.2.3.4", "5.6.7.8"])).toBe(true);
  });

  it("strips ::ffff: prefix from IPv4-mapped IPv6 addresses and matches correctly", () => {
    expect(isWebhookIpAllowed("::ffff:1.2.3.4", ["1.2.3.4"])).toBe(true);
    expect(isWebhookIpAllowed("::ffff:9.9.9.9", ["1.2.3.4"])).toBe(false);
  });

  it("does not strip prefix from a non-::ffff: IPv6 address", () => {
    expect(isWebhookIpAllowed("2001:db8::1", ["1.2.3.4"])).toBe(false);
    expect(isWebhookIpAllowed("2001:db8::1", ["2001:db8::1"])).toBe(true);
  });
});

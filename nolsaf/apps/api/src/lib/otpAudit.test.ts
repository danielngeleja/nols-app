import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.JWT_SECRET = "otp-audit-unit-test-secret";
});

describe("OTP audit fields", () => {
  it("correlates a sent code with its use regardless of phone spelling", async () => {
    const { otpAuditEntity } = await import("./otpAudit.js");
    const sent = otpAuditEntity("PHONE", "+255712345678", "483920");
    expect(otpAuditEntity("PHONE", "0712345678", "483920")).toBe(sent);
    expect(otpAuditEntity("PHONE", "0712 345 678", "483920")).toBe(sent);
    expect(otpAuditEntity("PHONE", "+255712345678", "483921")).not.toBe(sent);
    expect(otpAuditEntity("EMAIL", "A@Example.com", "483920")).toBe(otpAuditEntity("EMAIL", "a@example.com", "483920"));
  });

  it("contains no destination digits, code, or plain code hash", async () => {
    const { otpAuditEntity, otpAuditDestinationFields } = await import("./otpAudit.js");
    const text = otpAuditEntity("PHONE", "+255712345678", "483920") + JSON.stringify(otpAuditDestinationFields("PHONE", "+255712345678"));
    expect(text).not.toContain("712345");
    expect(text).not.toContain("483920");
    expect(text).not.toContain(createHash("sha256").update("483920").digest("hex"));
    expect(otpAuditDestinationFields("EMAIL", "daniel@example.com").destination).toBe("da****@example.com");
  });

  it("turns an admin search for a phone or email into the keyed entity prefix", async () => {
    const { otpAuditEntity, otpAuditSearchRefs } = await import("./otpAudit.js");
    const entity = otpAuditEntity("PHONE", "+255712345678", "483920");
    expect(otpAuditSearchRefs("0712 345 678").some((ref) => entity.startsWith(ref))).toBe(true);
    const emailEntity = otpAuditEntity("EMAIL", "a@example.com", "1");
    expect(otpAuditSearchRefs("A@example.com").some((ref) => emailEntity.startsWith(ref))).toBe(true);
  });
});

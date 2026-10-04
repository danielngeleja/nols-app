import { describe, it, expect, vi, afterEach } from "vitest";
import { authenticator } from "otplib";
import { generateBackupCodes, normaliseBackupCode, verifyTotp } from "../lib/totp";

const secret = authenticator.generateSecret();

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyTotp", () => {
  it("accepts the current code, with or without spaces", () => {
    const code = authenticator.generate(secret);
    expect(verifyTotp(code, secret)).toBe(true);
    expect(verifyTotp(`${code.slice(0, 3)} ${code.slice(3)}`, secret)).toBe(true);
  });

  it("tolerates a phone clock one step behind or ahead", () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 8, 16, 10, 0, 15);
    vi.setSystemTime(now - 30_000);
    const previous = authenticator.generate(secret);
    vi.setSystemTime(now + 30_000);
    const next = authenticator.generate(secret);
    vi.setSystemTime(now);
    expect(verifyTotp(previous, secret)).toBe(true);
    expect(verifyTotp(next, secret)).toBe(true);
  });

  it("still rejects a code from minutes ago", () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 8, 16, 10, 0, 15);
    vi.setSystemTime(now - 5 * 60_000);
    const stale = authenticator.generate(secret);
    vi.setSystemTime(now);
    expect(verifyTotp(stale, secret)).toBe(false);
  });

  it("rejects malformed input and a missing secret without throwing", () => {
    expect(verifyTotp("12345", secret)).toBe(false);
    expect(verifyTotp("abcdef", secret)).toBe(false);
    expect(verifyTotp(123456, secret)).toBe(false);
    expect(verifyTotp(authenticator.generate(secret), null)).toBe(false);
  });
});

describe("backup codes", () => {
  it("generates ten unique XXXX-XXXX codes without look-alike characters", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  });

  it("normalises what people type", () => {
    expect(normaliseBackupCode("  ab2c-9xyz ")).toBe("AB2C-9XYZ");
    expect(normaliseBackupCode("AB2C - 9XYZ")).toBe("AB2C-9XYZ");
    expect(normaliseBackupCode(null)).toBe("");
  });
});

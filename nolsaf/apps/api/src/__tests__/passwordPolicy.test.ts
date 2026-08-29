import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_SPECIAL_CHARACTERS,
  validatePasswordStrength,
} from "../lib/security";

describe("password policy", () => {
  it("accepts a password that satisfies every default requirement", () => {
    expect(validatePasswordStrength("CorrectHorse1!")).toEqual({ valid: true, reasons: [] });
  });

  it("does not treat emoji as an accepted special character", () => {
    const result = validatePasswordStrength("CorrectHorse1😀");
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("Password must include at least one special character (e.g. !@#$%)");
  });

  it("does not let whitespace satisfy the special-character requirement", () => {
    const result = validatePasswordStrength("CorrectHorse1 ");
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("Password must not contain spaces");
    expect(result.reasons).toContain("Password must include at least one special character (e.g. !@#$%)");
  });

  it("accepts every character advertised by the policy", () => {
    for (const special of PASSWORD_SPECIAL_CHARACTERS) {
      expect(validatePasswordStrength(`CorrectHorse1${special}`).valid, special).toBe(true);
    }
  });

  it("enforces the common maximum length", () => {
    const result = validatePasswordStrength(`Aa1!${"x".repeat(PASSWORD_MAX_LENGTH)}`);
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters`);
  });
});

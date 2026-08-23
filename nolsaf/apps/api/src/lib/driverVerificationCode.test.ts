import { describe, it, expect, beforeAll } from "vitest";
import { buildDriverVerificationCode, resolveDriverVerificationCode } from "./driverVerificationCode.js";

beforeAll(() => {
  process.env.PUBLIC_LINK_TOKEN_SECRET = "driver-code-test-secret";
});

describe("driver verification code", () => {
  it("round trips a code back to its user id", () => {
    const code = buildDriverVerificationCode(42)!;
    expect(code).toMatch(/^NLS-D-42-[0-9A-Z]{8}$/);
    expect(resolveDriverVerificationCode(code)).toBe(42);
  });

  it("is stable for the same driver", () => {
    expect(buildDriverVerificationCode(7)).toBe(buildDriverVerificationCode(7));
  });

  /**
   * The whole point of the change: the old format let anyone walk the roster by
   * counting. A code for one driver must not be reachable from another's id.
   */
  it("rejects a code whose check segment belongs to a different driver", () => {
    const other = buildDriverVerificationCode(43)!.split("-").pop();
    expect(resolveDriverVerificationCode(`NLS-D-42-${other}`)).toBeNull();
  });

  it("rejects the bare id formats that used to be accepted", () => {
    expect(resolveDriverVerificationCode("NLS-0042-2026")).toBeNull();
    expect(resolveDriverVerificationCode("NLS/D/42/AAAA/2026")).toBeNull();
    expect(resolveDriverVerificationCode("42")).toBeNull();
  });

  it("tolerates how a code is typed off a printed card", () => {
    const code = buildDriverVerificationCode(1234)!;
    const check = code.split("-").pop();
    expect(resolveDriverVerificationCode(code.toLowerCase())).toBe(1234);
    expect(resolveDriverVerificationCode(`  ${code}  `)).toBe(1234);
    expect(resolveDriverVerificationCode(`NLS/D/1234/${check}`)).toBe(1234);
  });

  it("rejects malformed input without throwing", () => {
    for (const value of ["", "   ", "NLS-D--ABCDEFGH", "NLS-D-0-ABCDEFGH", "NLS-D-42-SHORT", "NLS-D-42-TOOOLONGGG"]) {
      expect(resolveDriverVerificationCode(value)).toBeNull();
    }
  });

  it("refuses non-positive and non-integer ids", () => {
    expect(buildDriverVerificationCode(0)).toBeNull();
    expect(buildDriverVerificationCode(-3)).toBeNull();
    expect(buildDriverVerificationCode(1.5)).toBeNull();
  });
});

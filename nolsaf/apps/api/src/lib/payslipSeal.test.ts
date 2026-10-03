import { describe, expect, it } from "vitest";
import { payslipNumberFromToken, payslipVerificationToken } from "./payslipSeal.js";

describe("payslip verification tokens", () => {
  it("round-trips a payslip number", () => {
    const token = payslipVerificationToken("PS-2026-10-NSE-2026-0001");
    expect(payslipNumberFromToken(token)).toBe("PS-2026-10-NSE-2026-0001");
  });

  it("rejects a token pointed at another payslip", () => {
    const token = payslipVerificationToken("PS-2026-10-NSE-2026-0001");
    const signature = token.slice(token.lastIndexOf(".") + 1);
    expect(payslipNumberFromToken(`PS-2026-10-NSE-2026-0002.${signature}`)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(payslipNumberFromToken("")).toBeNull();
    expect(payslipNumberFromToken("PS-2026-10-0001")).toBeNull();
    expect(payslipNumberFromToken("not-a-payslip.abc")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  expectedInvoicePaymentAmount,
  isPaymentAmountWithinTolerance,
  PaymentAmountMismatchError,
} from "./paymentAmount.js";

describe("payment amount validation", () => {
  it("uses the customer-facing invoice total before owner net payable", () => {
    expect(expectedInvoicePaymentAmount({ total: 1_000_000, netPayable: 850_000 })).toBe(1_000_000);
  });

  it("accepts only the bounded gateway tolerance", () => {
    expect(isPaymentAmountWithinTolerance(999_500, 1_000_000)).toBe(true);
    expect(isPaymentAmountWithinTolerance(999_499, 1_000_000)).toBe(false);
    expect(isPaymentAmountWithinTolerance(0, 1_000_000)).toBe(false);
  });

  it("carries auditable expected and received amounts on rejection", () => {
    const error = new PaymentAmountMismatchError(1_000_000, 100);
    expect(error).toMatchObject({ code: "PAYMENT_AMOUNT_MISMATCH", expected: 1_000_000, received: 100 });
  });
});

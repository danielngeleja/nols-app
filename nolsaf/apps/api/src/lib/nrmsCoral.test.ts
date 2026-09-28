import { describe, expect, it } from "vitest";
import {
  CORAL_MAX_PAYMENT_REFERENCE_LENGTH,
  createNrmsCoralPaymentReference,
  createNrmsCoralReferenceFields,
  nrmsTokenFromCoralInitiationPayload,
} from "./nrmsCoral.js";

describe("NRMS Coral payment references", () => {
  it("creates a fresh Coral-safe reference", () => {
    const first = createNrmsCoralPaymentReference();
    const second = createNrmsCoralPaymentReference();

    expect(first).toMatch(/^NRMS-C-[A-F0-9]{32}$/);
    expect(first.length).toBeLessThanOrEqual(CORAL_MAX_PAYMENT_REFERENCE_LENGTH);
    expect(second).not.toBe(first);
  });

  it("uses one identical reference for Coral Stamp and Identifier", () => {
    const fields = createNrmsCoralReferenceFields();

    expect(fields.Submission.Stamp).toBe(fields.paymentRef);
    expect(fields.Identifier).toBe(fields.paymentRef);
    expect(fields.Identifier.length).toBeLessThanOrEqual(CORAL_MAX_PAYMENT_REFERENCE_LENGTH);
  });

  it("only accepts an initiation mapping for the same provider reference", () => {
    const paymentRef = createNrmsCoralPaymentReference();
    const token = "NRMS-1234567890ABCDEF1234567890ABCDEF1234";

    expect(nrmsTokenFromCoralInitiationPayload({ paymentRef, nrmsToken: token }, paymentRef)).toBe(token);
    expect(nrmsTokenFromCoralInitiationPayload({ paymentRef: `${paymentRef}X`, nrmsToken: token }, paymentRef)).toBeNull();
    expect(nrmsTokenFromCoralInitiationPayload({ paymentRef, nrmsToken: "OTHER-123" }, paymentRef)).toBeNull();
  });
});

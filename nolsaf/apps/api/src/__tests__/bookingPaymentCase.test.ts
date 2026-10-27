import { describe, expect, it } from "vitest";
import { paidInvoiceForRepair, paymentCaseEvidenceState, verifiedSuccessForRepair } from "../lib/bookingPaymentCase.js";
import { customerRecordReference, matchesCustomerRecordReference } from "../lib/customerBookingReference.js";

const invoice = {
  id: 9, invoiceNumber: "INV-9", status: "PROCESSING", total: 80_000, netPayable: 70_000,
  paymentEvents: [{ id: 1, eventId: "az-123", provider: "AZAMPAY", status: "SUCCESS", amount: 80_000, currency: "TZS", payload: { webhookVerified: true, webhookAmount: 80_000, webhookCurrency: "TZS" } }],
};

describe("booking payment case evidence", () => {
  it("uses an opaque case reference that cannot be reused for another row", () => {
    const reference = customerRecordReference("payment-case", 19);
    expect(reference).toMatch(/^pc_[A-Za-z0-9_-]{22}$/);
    expect(matchesCustomerRecordReference(reference, "payment-case", 19)).toBe(true);
    expect(matchesCustomerRecordReference(reference, "payment-case", 20)).toBe(false);
  });
  it("accepts only a matched success event on a customer invoice", () => {
    expect(verifiedSuccessForRepair([invoice])?.event.eventId).toBe("az-123");
    expect(verifiedSuccessForRepair([{ ...invoice, invoiceNumber: "OINV-9" }])).toBeNull();
    expect(verifiedSuccessForRepair([{ ...invoice, paymentEvents: [{ ...invoice.paymentEvents[0], amount: 50_000 }] }])).toBeNull();
    expect(verifiedSuccessForRepair([{ ...invoice, paymentEvents: [{ ...invoice.paymentEvents[0], currency: "USD" }] }])).toBeNull();
    expect(verifiedSuccessForRepair([{ ...invoice, paymentEvents: [{ ...invoice.paymentEvents[0], provider: "UNKNOWN" }] }])).toBeNull();
    expect(verifiedSuccessForRepair([{ ...invoice, paymentEvents: [{ ...invoice.paymentEvents[0], payload: {} }] }])).toBeNull();
    expect(verifiedSuccessForRepair([{ ...invoice, paymentEvents: [{ ...invoice.paymentEvents[0], payload: { webhookVerified: true, webhookAmount: 50_000, webhookCurrency: "TZS" } }] }])).toBeNull();
  });

  it("does not treat a processing invoice or customer claim as paid", () => {
    expect(paidInvoiceForRepair([invoice])).toBeNull();
    expect(paidInvoiceForRepair([{ ...invoice, status: "PAID", paymentEvents: [] }])).toBeNull();
    expect(paidInvoiceForRepair([{ ...invoice, status: "PAID" }])?.id).toBe(9);
    expect(verifiedSuccessForRepair([{ ...invoice, paymentEvents: [{ ...invoice.paymentEvents[0], provider: "CORALCOMMERCE" }] }])).toBeNull();
    expect(paidInvoiceForRepair([{ ...invoice, status: "PAID", paymentEvents: [{ ...invoice.paymentEvents[0], provider: "CORALCOMMERCE" }] }])?.id).toBe(9);
    expect(paidInvoiceForRepair([{ ...invoice, status: "CUSTOMER_PAID", receiptNumber: null }])).toBeNull();
    expect(verifiedSuccessForRepair([{ ...invoice, paymentEvents: [{ ...invoice.paymentEvents[0], amount: 79_000 }] }])).toBeNull();
    expect(paymentCaseEvidenceState({ status: "NEW", code: null, invoices: [{ ...invoice, paymentEvents: [] }] })).toBe("PROCESSING");
  });

  it("keeps an existing code ahead of payment repair and a canceled booking closed", () => {
    expect(paymentCaseEvidenceState({ status: "CONFIRMED", code: { status: "ACTIVE" }, invoices: [invoice] })).toBe("CODE_READY");
    expect(paymentCaseEvidenceState({ status: "CANCELED", code: { status: "VOID" }, invoices: [invoice] })).toBe("CLOSED_BOOKING");
  });
});

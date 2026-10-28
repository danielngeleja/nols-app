import { describe, expect, it } from "vitest";
import { paidInvoiceForRepair, paymentCaseEvidenceState, verifiedSuccessForRepair } from "../lib/bookingPaymentCase.js";
import { customerRecordReference, matchesCustomerRecordReference } from "../lib/customerBookingReference.js";
import { paymentReportEligibility } from "../lib/bookingPaymentCaseEligibility.js";

const invoice = {
  id: 9, invoiceNumber: "INV-9", status: "PROCESSING", total: 80_000, netPayable: 70_000,
  paymentEvents: [{ id: 1, eventId: "az-123", provider: "AZAMPAY", status: "SUCCESS", amount: 80_000, currency: "TZS", payload: { webhookVerified: true, webhookAmount: 80_000, webhookCurrency: "TZS" } }],
};

describe("booking payment case evidence", () => {
  it("waits for a pending provider attempt, then permits a report", () => {
    const started = new Date("2026-10-27T10:00:00.000Z");
    const booking = { status: "NEW", code: null, invoices: [{
      invoiceNumber: "INV-9", status: "PROCESSING", receiptNumber: null, updatedAt: started,
      paymentEvents: [{ status: "PENDING", createdAt: started }],
    }] };
    expect(paymentReportEligibility(booking, new Date("2026-10-27T10:14:59.000Z"))).toEqual({ state: "WAITING", availableAt: "2026-10-27T10:15:00.000Z" });
    expect(paymentReportEligibility(booking, new Date("2026-10-27T10:15:00.000Z")).state).toBe("READY");
    expect(paymentReportEligibility({ ...booking, invoices: [{ ...booking.invoices[0], paymentEvents: [{ status: "FAILED", createdAt: started }] }] }).state).toBe("UNVERIFIED");
  });

  it("keeps no-attempt claims unverified and does not invite a report when a code is already available", () => {
    const noAttempt = { status: "NEW", code: null, invoices: [{ invoiceNumber: "INV-9", status: "ISSUED", updatedAt: new Date(), paymentEvents: [] }] };
    expect(paymentReportEligibility(noAttempt).state).toBe("UNVERIFIED");
    expect(paymentReportEligibility({ ...noAttempt, invoices: [{ ...noAttempt.invoices[0], invoiceNumber: "OINV-9", status: "PAID" }] }).state).toBe("UNVERIFIED");
    expect(paymentReportEligibility({ ...noAttempt, code: { status: "ACTIVE" }, status: "CONFIRMED" }).state).toBe("CODE_AVAILABLE");
    expect(paymentReportEligibility({ ...noAttempt, invoices: [{ ...noAttempt.invoices[0], status: "PAID" }] }).state).toBe("READY");
  });
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

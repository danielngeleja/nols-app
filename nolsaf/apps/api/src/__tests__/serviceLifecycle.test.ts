import { describe, expect, it } from "vitest";
import { mapGroupStayLifecycle, mapPropertyLifecycle, mapTourLifecycle } from "../lib/serviceLifecycle";

describe("shared service lifecycle mapper", () => {
  it("maps an unpaid property draft without changing its native status", () => {
    const lifecycle = mapPropertyLifecycle({ bookingStatus: "NEW", invoiceStatus: "DRAFT", hasInvoice: true });
    expect(lifecycle.bookingStage).toBe("AWAITING_PAYMENT");
    expect(lifecycle.paymentStage).toBe("UNPAID");
    expect(lifecycle.requiredAction).toBe("COMPLETE_PAYMENT");
    expect(lifecycle.caseStage).toBe("NOT_LOADED");
  });

  it("maps a paid accommodation booking and available receipt", () => {
    const lifecycle = mapPropertyLifecycle({ bookingStatus: "CONFIRMED", invoiceStatus: "PAID", hasInvoice: true, receiptNumber: "RCPT-1", checkInCodeStatus: "ACTIVE" });
    expect(lifecycle.bookingStage).toBe("CONFIRMED");
    expect(lifecycle.paymentStage).toBe("PAID");
    expect(lifecycle.receiptStage).toBe("AVAILABLE");
    expect(lifecycle.consistency.status).toBe("CONSISTENT");
  });

  it("detects a cancelled accommodation booking with an active check-in code", () => {
    const lifecycle = mapPropertyLifecycle({ bookingStatus: "CANCELED", invoiceStatus: "PAID", hasInvoice: true, receiptNumber: "RCPT-1", checkInCodeStatus: "ACTIVE" });
    expect(lifecycle.consistency.status).toBe("REVIEW_REQUIRED");
    expect(lifecycle.consistency.issues.map((issue) => issue.code)).toContain("ACTIVE_CHECKIN_FOR_CANCELLED_BOOKING");
  });

  it("maps a group stay awaiting its deposit", () => {
    const lifecycle = mapGroupStayLifecycle({ bookingStatus: "AWAITING_DEPOSIT", depositPaid: false, depositAmount: 250000, confirmedPropertyId: 44 });
    expect(lifecycle.bookingStage).toBe("AWAITING_PAYMENT");
    expect(lifecycle.requiredAction).toBe("PAY_DEPOSIT");
    expect(lifecycle.responsibilityStage).toBe("ASSIGNED");
  });

  it("classifies a paid group deposit as partial payment with a receipt", () => {
    const lifecycle = mapGroupStayLifecycle({ bookingStatus: "AWAITING_DEPOSIT", depositPaid: true, depositPaidAt: new Date(), depositAmount: 250000, confirmedPropertyId: 44 });
    expect(lifecycle.bookingStage).toBe("CONFIRMED");
    expect(lifecycle.paymentStage).toBe("PARTIALLY_PAID");
    expect(lifecycle.receiptStage).toBe("AVAILABLE");
  });

  it("does not describe a group deposit as full payment", () => {
    const lifecycle = mapGroupStayLifecycle({ bookingStatus: "CONFIRMED", depositPaid: true, depositPaidAt: new Date(), depositAmount: 250000, confirmedPropertyId: 44 });
    expect(lifecycle.paymentStage).not.toBe("PAID");
  });

  it("flags a cancelled group stay that has no dedicated case record", () => {
    const lifecycle = mapGroupStayLifecycle({ bookingStatus: "CANCELED", cancellationLoaded: true });
    expect(lifecycle.consistency.status).toBe("REVIEW_REQUIRED");
    expect(lifecycle.consistency.issues[0]?.code).toBe("CANCELLED_WITHOUT_CASE_RECORD");
  });

  it("maps an unpaid tour draft", () => {
    const lifecycle = mapTourLifecycle({ bookingStatus: "PENDING_PAYMENT", paymentStatus: "UNPAID", operatorAssigned: true });
    expect(lifecycle.bookingStage).toBe("AWAITING_PAYMENT");
    expect(lifecycle.receiptStage).toBe("NOT_AVAILABLE");
    expect(lifecycle.requiredAction).toBe("COMPLETE_PAYMENT");
  });

  it("maps a paid tour and acknowledges operator receipt", () => {
    const lifecycle = mapTourLifecycle({ bookingStatus: "CONFIRMED", paymentStatus: "PAID", paidAt: new Date(), operatorAssigned: true, operatorReceiptStatus: "RECEIVED" });
    expect(lifecycle.paymentStage).toBe("PAID");
    expect(lifecycle.receiptStage).toBe("AVAILABLE");
    expect(lifecycle.responsibilityStage).toBe("ACKNOWLEDGED");
  });

  it("detects paid timestamp and payment-status disagreement", () => {
    const lifecycle = mapTourLifecycle({ bookingStatus: "PENDING_PAYMENT", paymentStatus: "PENDING", paidAt: new Date(), operatorAssigned: true });
    expect(lifecycle.consistency.status).toBe("REVIEW_REQUIRED");
    expect(lifecycle.requiredAction).toBe("CONTACT_SUPPORT");
  });

  it("detects rejected cancellation combined with cancelled tour", () => {
    const lifecycle = mapTourLifecycle({ bookingStatus: "CANCELED", paymentStatus: "PAID", paidAt: new Date(), operatorAssigned: true, cancellationLoaded: true, cancellationStatus: "REJECTED" });
    expect(lifecycle.consistency.issues.map((issue) => issue.code)).toContain("REJECTED_CANCELLATION_WITH_CANCELLED_BOOKING");
  });
});

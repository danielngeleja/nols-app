import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeApprovalFingerprint } from "../services/payouts/fingerprint";

const mocks = vi.hoisted(() => ({
  findDisbursement: vi.fn(),
  claimDisbursement: vi.fn(),
  transaction: vi.fn(),
  azamPayDisburse: vi.fn(),
  findInvoice: vi.fn(),
  updateInvoiceMany: vi.fn(),
  createNotification: vi.fn(),
  sendMail: vi.fn(),
  generateOwnerDisbursementPdf: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    disbursement: { findUnique: mocks.findDisbursement, updateMany: mocks.claimDisbursement },
    disbursementEvent: { create: vi.fn() },
    invoice: { findUnique: mocks.findInvoice, updateMany: mocks.updateInvoiceMany },
    notification: { create: mocks.createNotification },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../services/azampay/disbursement/client.js", () => ({
  azamPayDisburse: mocks.azamPayDisburse,
}));

vi.mock("../lib/notifications.js", () => ({ notifyUser: vi.fn() }));
vi.mock("../lib/mailer.js", () => ({ sendMail: mocks.sendMail }));
vi.mock("../lib/pdfDocuments.js", () => ({ generateOwnerDisbursementPdf: mocks.generateOwnerDisbursementPdf }));
vi.mock("../lib/bookingEmailTemplates.js", () => ({
  getOwnerDisbursementEmail: vi.fn(() => ({ subject: "Your payout has been sent", html: "<p>Paid</p>" })),
}));

import {
  applyProviderEvent,
  ownerDisbursementReceiptNumber,
  submitToAzamPay,
} from "../services/payouts/ledger";

function ownerDisbursement(status: string) {
  const payoutAccount = {
    id: 9,
    userId: 44,
    type: "MOBILE_MONEY",
    provider: "azampesa",
    accountNumber: "255700000001",
    accountName: "ASHA MTUMWA",
    currency: "TZS",
    isVerified: true,
    verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
    lastVerifiedAt: null,
    destinationChangedAt: new Date("2026-08-01T00:00:00.000Z"),
    isDefault: true,
    isActive: true,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };
  const disbursement: any = {
    id: 77,
    externalReferenceId: "NoLSAF-O-2608081645-D51QVX",
    pgReferenceId: ["PROCESSING", "PAID", "FAILED"].includes(status) ? "PG-77" : null,
    fspReferenceId: null,
    sourceType: "OWNER_INVOICE",
    sourceId: 123,
    activeSourceKey: "OWNER_INVOICE:123",
    payoutAccountId: payoutAccount.id,
    amount: 150000,
    currency: "TZS",
    status,
    provider: "azampay",
    bankName: "azampesa",
    operator: null,
    approvedById: 4,
    approvedAt: new Date("2026-08-08T12:00:00.000Z"),
    submittedAt: null,
    paidAt: null,
    failedAt: null,
    approvalFingerprint: null,
    riskLevel: "LOW",
    riskFlags: [],
    securityReviewReason: null,
    batchId: 5,
    providerMessage: null,
    rawRequest: null,
    rawResponse: null,
    remarks: null,
    createdAt: new Date("2026-08-08T12:00:00.000Z"),
    updatedAt: new Date("2026-08-08T12:00:00.000Z"),
    payoutAccount,
  };
  disbursement.approvalFingerprint = computeApprovalFingerprint(disbursement, payoutAccount);
  return disbursement;
}

describe("owner invoice disbursement write-back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimDisbursement.mockResolvedValue({ count: 1 });
    vi.stubEnv("AZAMPAY_DISBURSE_SOURCE_ACCOUNT", "255700000000");
    vi.stubEnv("AZAMPAY_DISBURSE_TRANSFER_TYPE", "MOBILE_MONEY");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("moves an APPROVED owner invoice to PROCESSING after AzamPay accepts the payout", async () => {
    const authorized = ownerDisbursement("AUTHORIZED");
    const processing = { ...authorized, status: "PROCESSING", pgReferenceId: "PG-77" };
    const invoiceUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      disbursementEvent: { create: vi.fn().mockResolvedValue({}) },
      disbursement: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(processing),
      },
      invoice: { updateMany: invoiceUpdateMany },
    };

    mocks.findDisbursement.mockResolvedValue(authorized);
    mocks.azamPayDisburse.mockResolvedValue({
      pgReferenceId: "PG-77",
      message: "accepted",
      success: true,
      statusCode: 200,
    });
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await submitToAzamPay(authorized.id);

    expect(result.status).toBe("PROCESSING");
    expect(invoiceUpdateMany).toHaveBeenCalledWith({
      where: { id: authorized.sourceId, status: "APPROVED" },
      data: { status: "PROCESSING" },
    });
  });

  it("fails before the provider call when required request configuration is missing", async () => {
    const authorized = ownerDisbursement("AUTHORIZED");
    vi.stubEnv("AZAMPAY_DISBURSE_SOURCE_ACCOUNT", "");
    mocks.findDisbursement.mockResolvedValue(authorized);

    await expect(submitToAzamPay(authorized.id)).rejects.toMatchObject({
      name: "AzamPayDisburseConfigurationError",
      operation: "REQUEST",
      missingKeys: ["AZAMPAY_DISBURSE_SOURCE_ACCOUNT"],
    });
    expect(mocks.azamPayDisburse).not.toHaveBeenCalled();
  });

  it("creates the standard receipt number when provider settlement marks the payout PAID", async () => {
    const processing = ownerDisbursement("PROCESSING");
    const paid = { ...processing, status: "PAID", paidAt: new Date(), fspReferenceId: "FSP-77" };
    const invoiceUpdate = vi.fn().mockResolvedValue({});
    const invoiceForSettlement = {
      id: processing.sourceId,
      ownerId: 44,
      bookingId: 123,
      invoiceNumber: "OINV-202608-000123-0042",
      receiptNumber: null,
      total: 150000,
      commissionPercent: null,
      commissionAmount: null,
      taxPercent: null,
      netPayable: 150000,
      paymentRef: "INVREF-123",
      receiptSnapshot: null,
      receiptIssuedAt: null,
      receiptQrPayload: null,
      owner: { email: "owner@example.com", name: "Asha", fullName: "Asha Mtumwa" },
      booking: {
        code: { codeVisible: "BOOK-123" },
        checkIn: new Date("2026-08-08T12:00:00.000Z"),
        checkOut: new Date("2026-08-10T12:00:00.000Z"),
        property: { title: "NoLSAF Lodge" },
      },
    };
    const tx = {
      disbursement: {
        findUnique: vi.fn().mockResolvedValueOnce(processing).mockResolvedValueOnce(paid),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      disbursementEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      invoice: {
        findUnique: vi.fn().mockResolvedValue(invoiceForSettlement),
        update: invoiceUpdate,
      },
      payoutAccount: { findUnique: vi.fn().mockResolvedValue({ accountNumber: "255700000001" }) },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));
    const receiptSnapshot = {
      version: 1,
      documentType: "OWNER_PAYOUT_CONFIRMATION",
      issuer: "NoLS Africa Co Ltd",
      receiptNumber: "RCPT-202608-0000123",
      invoiceId: 123,
      invoiceNumber: "OINV-202608-000123-0042",
      ownerId: 44,
      ownerName: "Asha Mtumwa",
      ownerEmail: "owner@example.com",
      bookingId: 123,
      bookingCode: "BOOK-123",
      propertyName: "NoLSAF Lodge",
      checkIn: "2026-08-08T12:00:00.000Z",
      checkOut: "2026-08-10T12:00:00.000Z",
      totalRevenue: 150000,
      commissionPercent: null,
      commissionAmount: null,
      taxPercent: null,
      taxAmount: null,
      netPayable: 150000,
      currency: "TZS",
      paymentMethod: "azampesa",
      payoutProvider: "azampay",
      providerReference: "FSP-77",
      nolsafReference: processing.externalReferenceId,
      maskedDestination: "•••••••• 0001",
      settledAt: paid.paidAt.toISOString(),
      issuedAt: paid.paidAt.toISOString(),
      timeZone: "Africa/Dar_es_Salaam",
      disclaimer: "This is a NoLSAF payout confirmation, not an AzamPay, bank, or mobile-network-issued receipt.",
    };
    mocks.findInvoice.mockResolvedValue({
      id: processing.sourceId,
      status: "PAID",
      invoiceNumber: "OINV-202608-000123-0042",
      receiptNumber: "RCPT-202608-0000123",
      total: 150000,
      commissionPercent: null,
      commissionAmount: null,
      netPayable: 150000,
      paymentRef: "INVREF-123",
      paidAt: paid.paidAt,
      receiptSnapshot,
      receiptIssuedAt: paid.paidAt,
      receiptQrPayload: "https://nolsaf.com/verify/payout?t=signed-token",
      receiptQrPng: Buffer.from("qr"),
      owner: { id: 44, email: "owner@example.com", name: "Asha", fullName: "Asha Mtumwa" },
      booking: {
        id: 123,
        codeVisible: "BOOK-123",
        checkIn: new Date("2026-08-08T12:00:00.000Z"),
        checkOut: new Date("2026-08-10T12:00:00.000Z"),
        property: { title: "NoLSAF Lodge" },
      },
    });
    mocks.createNotification.mockResolvedValue({ id: 501 });
    mocks.generateOwnerDisbursementPdf.mockResolvedValue(Buffer.from("pdf"));
    mocks.sendMail.mockResolvedValue({ provider: "test" });

    await applyProviderEvent(processing.id, {
      eventType: "CALLBACK",
      callback: {
        initiatorReferenceId: processing.externalReferenceId,
        fspReferenceId: "FSP-77",
        pgReferenceId: "PG-77",
        amount: "150000",
        status: "success",
        message: "paid",
        operator: "azampesa",
      },
    });

    const update = invoiceUpdate.mock.calls[0][0];
    expect(update.where).toEqual({ id: processing.sourceId });
    expect(update.data.status).toBe("PAID");
    expect(update.data.receiptNumber).toMatch(/^RCPT-\d{6}-0000123$/);
    expect(update.data.receiptSnapshot).toEqual(expect.objectContaining({
      documentType: "OWNER_PAYOUT_CONFIRMATION",
      providerReference: "FSP-77",
      maskedDestination: "•••••••• 0001",
    }));
    expect(update.data.receiptQrPayload).toContain("/verify/payout?t=");
    expect(mocks.generateOwnerDisbursementPdf).toHaveBeenCalledWith(expect.objectContaining({
      receiptNumber: "RCPT-202608-0000123",
      paymentRef: "FSP-77",
      nolsafReference: processing.externalReferenceId,
      maskedDestination: "•••••••• 0001",
      timeZone: "Africa/Dar_es_Salaam",
      qrPng: Buffer.from("qr"),
    }));
    expect(mocks.sendMail).toHaveBeenCalledWith(
      "owner@example.com",
      "Your payout has been sent",
      "<p>Paid</p>",
      [{ filename: "Disbursement-RCPT-202608-0000123.pdf", content: Buffer.from("pdf") }],
      { replyTo: "support@nolsaf.com" }
    );
    expect(mocks.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 44,
          meta: expect.objectContaining({ kind: "owner_payout_disbursed", disbursementId: processing.id }),
        }),
      })
    );
  });

  it("does not notify the owner again when AzamPay replays an applied success event", async () => {
    const paid = { ...ownerDisbursement("PAID"), paidAt: new Date("2026-08-08T13:00:00.000Z") };
    const tx = {
      disbursement: { findUnique: vi.fn().mockResolvedValue(paid) },
      disbursementEvent: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await applyProviderEvent(paid.id, {
      eventType: "CALLBACK",
      callback: {
        initiatorReferenceId: paid.externalReferenceId,
        fspReferenceId: "FSP-77",
        pgReferenceId: "PG-77",
        amount: "150000",
        status: "success",
        message: "paid",
        operator: "azampesa",
      },
    });

    expect(result.status).toBe("PAID");
    expect(mocks.findInvoice).not.toHaveBeenCalled();
    expect(mocks.createNotification).not.toHaveBeenCalled();
    expect(mocks.sendMail).not.toHaveBeenCalled();
  });

  it("returns the invoice to APPROVED when the provider reports failure", async () => {
    const processing = ownerDisbursement("PROCESSING");
    const failed = { ...processing, status: "FAILED", activeSourceKey: null };
    const invoiceUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      disbursement: {
        findUnique: vi.fn().mockResolvedValueOnce(processing).mockResolvedValueOnce(failed),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      disbursementEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      invoice: { updateMany: invoiceUpdateMany },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    await applyProviderEvent(processing.id, {
      eventType: "CALLBACK",
      callback: {
        initiatorReferenceId: processing.externalReferenceId,
        fspReferenceId: "FSP-77",
        pgReferenceId: "PG-77",
        amount: "150000",
        status: "failure",
        message: "rejected",
        operator: "azampesa",
      },
    });

    expect(invoiceUpdateMany).toHaveBeenCalledWith({
      where: { id: processing.sourceId, status: "PROCESSING" },
      data: { status: "APPROVED" },
    });
  });

  it("builds the same premium receipt format used by admin revenue", () => {
    expect(ownerDisbursementReceiptNumber(123, new Date(2026, 7, 8))).toBe("RCPT-202608-0000123");
  });
});

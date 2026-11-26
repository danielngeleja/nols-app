import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeApprovalFingerprint } from "../services/payouts/fingerprint";

const mocks = vi.hoisted(() => ({
  findDisbursement: vi.fn(),
  updateDisbursement: vi.fn(),
  updateManyDisbursement: vi.fn(),
  transaction: vi.fn(),
  eventCreate: vi.fn(),
  azamPayDisburse: vi.fn(),
  banks: vi.fn(),
  payoutAccountFindUnique: vi.fn(),
  loadEligiblePayoutSource: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    disbursement: {
      findUnique: mocks.findDisbursement,
      update: mocks.updateDisbursement,
      updateMany: mocks.updateManyDisbursement,
    },
    disbursementEvent: { create: mocks.eventCreate },
    payoutAccount: { findUnique: mocks.payoutAccountFindUnique },
    invoice: { findUnique: vi.fn() },
    notification: { create: vi.fn() },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../services/azampay/disbursement/client.js", () => ({
  azamPayDisburse: mocks.azamPayDisburse,
  azamPayBankNames: mocks.banks,
}));
vi.mock("../services/payouts/eligibility.js", () => ({
  loadEligiblePayoutSource: mocks.loadEligiblePayoutSource,
}));
vi.mock("../lib/notifications.js", () => ({ notifyUser: vi.fn() }));
vi.mock("../lib/mailer.js", () => ({ sendMail: vi.fn() }));
vi.mock("../lib/pdfDocuments.js", () => ({ generateOwnerDisbursementPdf: vi.fn() }));
vi.mock("../lib/bookingEmailTemplates.js", () => ({
  getOwnerDisbursementEmail: vi.fn(() => ({ subject: "", html: "" })),
}));

import {
  applyProviderEvent,
  PayoutStateError,
  requestDisbursement,
  submitToAzamPay,
} from "../services/payouts/ledger";
import { AzamPayDisburseError } from "../services/azampay/disbursement/errors";

function payout(status: string) {
  const payoutAccount = {
    id: 9,
    userId: 44,
    type: "MOBILE_MONEY",
    provider: "airtel",
    accountNumber: "255688000001",
    accountName: "ASHA MTUMWA",
    currency: "TZS",
    isVerified: true,
    verifiedAt: new Date(),
    lastVerifiedAt: new Date(),
    destinationChangedAt: new Date(),
    isDefault: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const row: any = {
    id: 77,
    externalReferenceId: "NoLSAF-D-2608081645-D51QVX",
    pgReferenceId: status === "AUTHORIZED" ? null : "PG-77",
    fspReferenceId: null,
    sourceType: "DRIVER_TRIP",
    sourceId: 123,
    activeSourceKey: "DRIVER_TRIP:123",
    payoutAccountId: payoutAccount.id,
    amount: 150000,
    currency: "TZS",
    status,
    provider: "azampay",
    bankName: "airtel",
    operator: null,
    approvedById: 4,
    approvedAt: new Date(),
    submittedAt: status === "AUTHORIZED" ? null : new Date(),
    paidAt: status === "PAID" ? new Date() : null,
    failedAt: status === "FAILED" ? new Date() : null,
    approvalFingerprint: null,
    riskLevel: "LOW",
    riskFlags: [],
    securityReviewReason: null,
    batchId: 5,
    providerMessage: null,
    rawRequest: null,
    rawResponse: null,
    remarks: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    payoutAccount,
  };
  row.approvalFingerprint = computeApprovalFingerprint(row, payoutAccount);
  return row;
}

function providerEvent(status: "success" | "failure", overrides: Record<string, unknown> = {}) {
  return {
    eventType: "CALLBACK" as const,
    callback: {
      initiatorReferenceId: "NoLSAF-D-2608081645-D51QVX",
      fspReferenceId: "FSP-77",
      pgReferenceId: "PG-77",
      amount: "150000",
      status,
      message: status === "success" ? "paid" : "failed",
      operator: "Airtel",
      ...overrides,
    },
  };
}

describe("disbursement state-machine attack resistance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AZAMPAY_DISBURSE_SOURCE_ACCOUNT", "255700000000");
    vi.stubEnv("AZAMPAY_DISBURSE_TRANSFER_TYPE", "MOBILE_MONEY");
    mocks.eventCreate.mockResolvedValue({});
    mocks.loadEligiblePayoutSource.mockResolvedValue({
      sourceType: "DRIVER_TRIP",
      sourceId: 123,
      payeeUserId: 44,
      amount: 150000,
      currency: "TZS",
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("keeps driver bank payouts outside the owner and tour payout flows", async () => {
    mocks.payoutAccountFindUnique.mockResolvedValue({
      id: 19,
      userId: 44,
      type: "BANK",
      provider: "CRDB",
      accountNumber: "12345678901234",
      accountName: "ASHA MTUMWA",
      currency: "TZS",
      isVerified: true,
      isActive: true,
    });

    await expect(
      requestDisbursement({
        sourceType: "DRIVER_TRIP",
        sourceId: 123,
        payoutAccountId: 19,
        requestedById: 4,
      })
    ).rejects.toThrow("This bank is unavailable for this payout");

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("pays a sales partner into a bank on the payout directory, and only then", async () => {
    mocks.loadEligiblePayoutSource.mockResolvedValue({ sourceType: "SALES_PAYOUT", sourceId: 55, payeeUserId: 44, amount: 90000, currency: "TZS" });
    mocks.payoutAccountFindUnique.mockResolvedValue({
      id: 19, userId: 44, type: "BANK", provider: "CRDB", accountNumber: "12345678901234",
      accountName: "ASHA MTUMWA", currency: "TZS", isVerified: true, isActive: true,
    });
    (await import("@nolsaf/prisma") as any).prisma.disbursement.findFirst = vi.fn(async () => null);
    mocks.transaction.mockResolvedValue({ id: 501 });

    mocks.banks.mockResolvedValue(["NMB"]);
    await expect(requestDisbursement({ sourceType: "SALES_PAYOUT", sourceId: 55, payoutAccountId: 19, requestedById: 44 }))
      .rejects.toThrow("This bank is unavailable for this payout");
    expect(mocks.transaction).not.toHaveBeenCalled();

    mocks.banks.mockResolvedValue(["CRDB", "NMB"]);
    await expect(requestDisbursement({ sourceType: "SALES_PAYOUT", sourceId: 55, payoutAccountId: 19, requestedById: 44 }))
      .resolves.toEqual({ id: 501 });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("rechecks a removed bank before claiming an authorized tour transfer", async () => {
    const row = payout("AUTHORIZED");
    row.sourceType = "TOUR_BOOKING";
    row.bankName = row.payoutAccount.provider = "Example Bank";
    row.payoutAccount.type = "BANK";
    row.approvalFingerprint = computeApprovalFingerprint(row, row.payoutAccount);
    mocks.findDisbursement.mockResolvedValue(row);
    mocks.banks.mockResolvedValue([]);
    vi.stubEnv("DISBURSEMENTS_ENABLED", "true");
    await expect(submitToAzamPay(row.id)).rejects.toThrow("This bank is unavailable");
    expect(mocks.azamPayDisburse).not.toHaveBeenCalled();
  });

  it("does not let a forged final callback skip authorization and provider submission", async () => {
    const authorized = { ...payout("AUTHORIZED"), pgReferenceId: "PG-77" };
    const flagged = { ...authorized, securityReviewReason: "wrong lifecycle state" };
    const update = vi.fn().mockResolvedValue(flagged);
    const updateMany = vi.fn();
    const tx = {
      disbursement: { findUnique: vi.fn().mockResolvedValue(authorized), update, updateMany },
      disbursementEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await applyProviderEvent(authorized.id, providerEvent("success"));

    expect(result.status).toBe("AUTHORIZED");
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ securityReviewReason: expect.stringContaining("expected PROCESSING") }),
      })
    );
  });

  it("rejects an internally misrouted provider event even if a caller bypasses the HTTP route", async () => {
    const processing = payout("PROCESSING");
    const flagged = { ...processing, securityReviewReason: "reference mismatch" };
    const update = vi.fn().mockResolvedValue(flagged);
    const updateMany = vi.fn();
    const tx = {
      disbursement: { findUnique: vi.fn().mockResolvedValue(processing), update, updateMany },
      disbursementEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await applyProviderEvent(
      processing.id,
      providerEvent("success", { pgReferenceId: "PG-ATTACKER" })
    );

    expect(result.status).toBe("PROCESSING");
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ securityReviewReason: expect.stringContaining("correlation failure") }),
      })
    );
  });

  it("keeps PAID immutable and flags a contradictory late failure", async () => {
    const paid = payout("PAID");
    const conflicted = { ...paid, securityReviewReason: "conflicting failure" };
    const update = vi.fn().mockResolvedValue(conflicted);
    const tx = {
      disbursement: { findUnique: vi.fn().mockResolvedValue(paid), update, updateMany: vi.fn() },
      disbursementEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    const result = await applyProviderEvent(paid.id, providerEvent("failure"));

    expect(result.status).toBe("PAID");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ securityReviewReason: expect.stringContaining("already PAID") }),
      })
    );
  });

  it("allows only one terminal winner when success and failure arrive concurrently", async () => {
    let state = payout("PROCESSING");
    const tx = {
      disbursement: {
        findUnique: vi.fn(async () => ({ ...state })),
        update: vi.fn(async ({ data }: any) => {
          state = { ...state, ...data };
          return { ...state };
        }),
        updateMany: vi.fn(async ({ data }: any) => {
          if (state.status !== "PROCESSING") return { count: 0 };
          state = { ...state, ...data };
          return { count: 1 };
        }),
      },
      disbursementEvent: { createMany: vi.fn(async () => ({ count: 1 })) },
      transportPayout: { update: vi.fn().mockResolvedValue({}) },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    await Promise.all([
      applyProviderEvent(state.id, providerEvent("success")),
      applyProviderEvent(state.id, providerEvent("failure")),
    ]);

    expect(["PAID", "FAILED"]).toContain(state.status);
    // Terminal claims only; the winner also clears any stale correlation note.
    const claimCalls = tx.disbursement.updateMany.mock.calls.filter(
      ([args]: any) => args?.where?.status === "PROCESSING"
    );
    expect(claimCalls).toHaveLength(2);
    const successfulClaims = tx.disbursement.updateMany.mock.results.filter(
      (result) => result.type === "return"
    );
    expect(successfulClaims.length).toBeGreaterThanOrEqual(2);
    expect(state.status).not.toBe("PROCESSING");
  });

  // First production payout, 2026-11-25: a vodacom payout failed inside our
  // funding wallet, AzamPay's status reply named "azampesa", an exact operator
  // compare held it, and every later identical poll was skipped as a duplicate.
  function stuckSourceFailure(status: string) {
    // As left in production by the old rule: held with a correlation note.
    let state: any = {
      ...payout(status), bankName: "vodacom",
      securityReviewReason: "Provider event correlation failure: operator does not match the payout destination",
    };
    const tx = {
      disbursement: {
        findUnique: vi.fn(async () => ({ ...state })),
        update: vi.fn(async ({ data }: any) => { state = { ...state, ...data }; return { ...state }; }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const prefix = where?.securityReviewReason?.startsWith;
          if (prefix !== undefined) {
            if (!String(state.securityReviewReason ?? "").startsWith(prefix)) return { count: 0 };
            state = { ...state, ...data };
            return { count: 1 };
          }
          if (state.status !== "PROCESSING") return { count: 0 };
          state = { ...state, ...data };
          return { count: 1 };
        }),
      },
      // The same poll answer was already recorded on an earlier pass.
      disbursementEvent: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));
    const event = {
      eventType: "STATUS_POLL" as const,
      callback: { ...providerEvent("failure").callback, operator: "azampesa", message: "Balance can not be negative" },
    };
    return { tx, event, current: () => state };
  }

  it("fails a payout that failed in our funding wallet, even on a repeated poll", async () => {
    const { tx, event, current } = stuckSourceFailure("PROCESSING");

    await applyProviderEvent(77, event);

    expect(current().status).toBe("FAILED");
    expect(current().providerMessage).toBe("Balance can not be negative");
    expect(current().activeSourceKey).toBeNull();
    // The red "operator does not match" note is no longer true once it settles.
    expect(current().securityReviewReason).toBeNull();
    expect(tx.disbursement.update).not.toHaveBeenCalled();
  });

  it("keeps a note that is not a correlation hold when the payout settles", async () => {
    const { event, current } = stuckSourceFailure("PROCESSING");
    const note = "AzamPay reported 90000 for a payout of 150000";
    (current() as any).securityReviewReason = note;

    await applyProviderEvent(77, event);

    expect(current().status).toBe("FAILED");
    expect(current().securityReviewReason).toBe(note);
  });

  it("still ignores a repeated event once the payout is final", async () => {
    const { tx, event, current } = stuckSourceFailure("FAILED");

    await applyProviderEvent(77, event);

    expect(current().status).toBe("FAILED");
    expect(tx.disbursement.updateMany).not.toHaveBeenCalled();
    expect(tx.disbursement.update).not.toHaveBeenCalled();
  });

  it("never accepts a success that names our source rail", async () => {
    const { tx, current } = stuckSourceFailure("PROCESSING");
    tx.disbursementEvent.createMany.mockResolvedValue({ count: 1 });

    await applyProviderEvent(77, {
      eventType: "STATUS_POLL",
      callback: { ...providerEvent("success").callback, operator: "azampesa" },
    });

    expect(current().status).toBe("PROCESSING");
    expect(current().securityReviewReason).toContain("operator does not match");
  });
});

describe("disbursement submission attack resistance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISBURSEMENTS_ENABLED", "true");
    vi.stubEnv("AZAMPAY_DISBURSE_SOURCE_ACCOUNT", "255700000000");
    vi.stubEnv("AZAMPAY_DISBURSE_TRANSFER_TYPE", "MOBILE_MONEY");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("blocks an authorized payout at the shared sender boundary while the off switch is set", async () => {
    vi.stubEnv("DISBURSEMENTS_ENABLED", "false");
    mocks.findDisbursement.mockResolvedValue(payout("AUTHORIZED"));

    await expect(submitToAzamPay(77)).rejects.toThrow("DISBURSEMENTS_ENABLED=false");

    expect(mocks.findDisbursement).not.toHaveBeenCalled();
    expect(mocks.updateManyDisbursement).not.toHaveBeenCalled();
    expect(mocks.azamPayDisburse).not.toHaveBeenCalled();
  });

  it.each(["MOBILE_MONEY", "BANK"])("makes concurrent %s submissions share one claim and provider call", async (type) => {
    let state = payout("AUTHORIZED");
    if (type === "BANK") {
      state.sourceType = "TOUR_ADVANCE";
      state.payoutAccount.type = type;
      state.payoutAccount.provider = state.bankName = "Example Commercial Bank";
      state.approvalFingerprint = computeApprovalFingerprint(state, state.payoutAccount);
      mocks.banks.mockResolvedValue([state.bankName]);
    }
    mocks.findDisbursement.mockImplementation(async () => ({ ...state, status: "AUTHORIZED" }));
    mocks.updateManyDisbursement.mockImplementation(async ({ where, data }: any) => {
      if (where.status === "AUTHORIZED") {
        if (state.status !== "AUTHORIZED") return { count: 0 };
        state = { ...state, ...data };
        return { count: 1 };
      }
      return { count: 0 };
    });
    mocks.azamPayDisburse.mockResolvedValue({
      pgReferenceId: "PG-77",
      message: "accepted",
      success: true,
      statusCode: 200,
    });
    const tx = {
      disbursementEvent: { create: vi.fn().mockResolvedValue({}) },
      disbursement: {
        updateMany: vi.fn(async ({ data }: any) => {
          if (state.status !== "SUBMITTED") return { count: 0 };
          state = { ...state, ...data };
          return { count: 1 };
        }),
        findUnique: vi.fn(async () => ({ ...state })),
      },
    };
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));

    const results = await Promise.allSettled([submitToAzamPay(state.id), submitToAzamPay(state.id)]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(mocks.azamPayDisburse).toHaveBeenCalledOnce();
    expect(mocks.azamPayDisburse).toHaveBeenCalledWith(expect.objectContaining({
      destination: expect.objectContaining({ bankName: state.bankName, currency: "TZS" }),
    }));
    expect(state.status).toBe("PROCESSING");
  });

  it("does not automatically retry an unknown provider outcome", async () => {
    let state = payout("AUTHORIZED");
    mocks.findDisbursement.mockImplementation(async () => ({ ...state }));
    mocks.updateManyDisbursement.mockImplementation(async ({ where, data }: any) => {
      if (where.status === "AUTHORIZED") {
        if (state.status !== "AUTHORIZED") return { count: 0 };
        state = { ...state, ...data };
        return { count: 1 };
      }
      if (where.status === "SUBMITTED" && state.status === "SUBMITTED") {
        state = { ...state, ...data };
        return { count: 1 };
      }
      return { count: 0 };
    });
    mocks.eventCreate.mockResolvedValue({});
    mocks.azamPayDisburse.mockRejectedValue(
      new AzamPayDisburseError({
        httpStatus: null,
        providerMessage: "network outcome unknown",
        retryClass: "RECONCILE_FIRST",
        rawBody: null,
      })
    );

    await expect(submitToAzamPay(state.id)).rejects.toBeInstanceOf(AzamPayDisburseError);
    await expect(submitToAzamPay(state.id)).rejects.toBeInstanceOf(PayoutStateError);

    expect(mocks.azamPayDisburse).toHaveBeenCalledOnce();
    expect(state.status).toBe("SUBMITTED");
    expect(state.securityReviewReason).toContain("outcome is unknown");
  });

  it("keeps the submission claimed if local persistence fails after provider acceptance", async () => {
    let state = payout("AUTHORIZED");
    mocks.findDisbursement.mockImplementation(async () => ({ ...state }));
    mocks.updateManyDisbursement.mockImplementation(async ({ where, data }: any) => {
      if (where.status === "AUTHORIZED" && state.status === "AUTHORIZED") {
        state = { ...state, ...data };
        return { count: 1 };
      }
      return { count: 0 };
    });
    mocks.azamPayDisburse.mockResolvedValue({
      pgReferenceId: "PG-77",
      message: "accepted",
      success: true,
      statusCode: 200,
    });
    mocks.transaction.mockRejectedValue(new Error("database unavailable after provider acceptance"));

    await expect(submitToAzamPay(state.id)).rejects.toThrow("database unavailable");

    expect(mocks.azamPayDisburse).toHaveBeenCalledOnce();
    expect(state.status).toBe("SUBMITTED");
    expect(mocks.updateManyDisbursement).toHaveBeenCalledOnce();
  });
});
